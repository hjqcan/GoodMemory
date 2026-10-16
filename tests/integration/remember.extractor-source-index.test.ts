import { describe, expect, it } from "bun:test";
import { createRememberEngine } from "../../src/remember/engine";
import type { RememberEngineConfig } from "../../src/remember/engine";
import type { MemoryCandidate, MemoryExtractionInput } from "../../src/remember/candidates";
import { createMemoryRepositories } from "../../src/storage/repositories";
import { createInMemoryDocumentStore, createInMemorySessionStore } from "../../src/storage/memory";

const scope = { userId: "index-user", sessionId: "index-session" };
const content = "Orchid launch depends on review.";
function candidate(id: string, primary: unknown = 0, secondary: unknown = [0]): MemoryCandidate {
  return { id, kindHint: "fact", explicitness: "explicit", content,
    sourceMessageIndex: primary, sourceMessageIndexes: secondary, sourceRole: "user",
    metadata: { category: "project" } } as MemoryCandidate;
}
function request(): MemoryExtractionInput {
  return { scope, locale: "en-US", extractionStrategy: "llm-assisted", messages: [
    { id: "primary", role: "user", content },
    { id: "secondary", role: "user", content: "Review is pending." },
  ] };
}
function setup(route: string, candidates: MemoryCandidate[], policy?: RememberEngineConfig["policy"]) {
  const documentStore = createInMemoryDocumentStore();
  const repositories = createMemoryRepositories({ documentStore, sessionStore: createInMemorySessionStore() });
  const extractor = { async extract() { return { candidates, ignoredMessageCount: 0 }; } };
  const empty = { async extract() { return { candidates: [], ignoredMessageCount: 0 }; } };
  let id = 0;
  const engine = createRememberEngine({ documentStore, repositories, policy,
    extractor: route === "custom" ? extractor : empty,
    assistedExtractor: route === "assisted" ? extractor : undefined,
    remember: route === "profile" ? { profiles: [{ id: "test", extractors: [extractor] }] }
      : route === "rule" ? { profiles: [{ id: "test", rules: [{ id: "rule", extract: () => candidates }] }] } : undefined,
    now: () => "2026-10-16T00:00:00.000Z", createId: () => `generated-${++id}`,
  });
  return { engine, repositories };
}
const persisted = (outcome: string) => ["written", "merged", "superseded"].includes(outcome);

for (const route of ["custom", "profile", "rule", "assisted"]) {
  describe(`${route} extractor runtime source-index validation`, () => {
    for (const restriction of ["none", "never", "redacted"] as const) {
      it(`rejects numeric-string secondary before ${restriction} policy and preserves valid neighbors`, async () => {
        const input = request();
        if (restriction === "never") input.annotations = [{ messageIndex: 1, remember: "never" }];
        const { engine, repositories } = setup(route, [candidate("bad", 0, [0, "1"]), candidate("good")], restriction === "redacted" ? {
          redact: (value) => ({ ...value, content: value.content === "Review is pending." ? "" : value.content }),
        } : undefined);
        const result = await engine.remember(input);
        expect(result.events.some((event) => event.candidateId === "bad" && persisted(event.outcome))).toBe(false);
        expect(result.events.some((event) => event.candidateId === "good" && persisted(event.outcome))).toBe(true);
        const facts = await repositories.facts.listByScope(scope);
        expect(facts).toHaveLength(1);
        const evidence = (await repositories.evidence.listByScope(scope)).filter((item) => item.linkedMemoryIds.includes(facts[0]!.id));
        expect(evidence.map((item) => item.sourceMessageIds)).toEqual([["primary"]]);
      });
    }
    for (const [label, primary, secondary] of [
      ["string primary", "0", [0]], ["missing primary", undefined, [0]],
      ["null primary", null, [0]], ["boolean primary", false, [0]],
      ["array primary", [0], [0]], ["boxed primary", new Number(0), [0]], ["negative primary", -1, [0]],
      ["fraction primary", 0.5, [0]], ["NaN primary", NaN, [0]],
      ["infinite primary", Infinity, [0]], ["out-of-range primary", 2, [0]],
      ["fraction secondary", 0, [0, 0.5]], ["negative secondary", 0, [-1]],
      ["out-of-range secondary", 0, [2]], ["null secondary entry", 0, [null]],
      ["undefined secondary entry", 0, [undefined]], ["NaN secondary", 0, [NaN]],
      ["infinite secondary", 0, [Infinity]], ["boolean secondary", 0, [false]], ["boxed secondary", 0, [new Number(1)]],
      ["string array", 0, "01"], ["object array", 0, {}],
      ["sparse array", 0, new Array(1)],
    ] as const) {
      it(`drops ${label} without aborting a valid candidate`, async () => {
        const bad = candidate("bad", primary, secondary);
        if (label === "missing primary") delete (bad as Partial<MemoryCandidate>).sourceMessageIndex;
        const { engine, repositories } = setup(route, [bad, candidate("good")]);
        const result = await engine.remember(request());
        expect(result.events.some((event) => event.candidateId === "bad" && persisted(event.outcome))).toBe(false);
        expect(result.events.some((event) => event.candidateId === "good" && persisted(event.outcome))).toBe(true);
        expect(await repositories.facts.listByScope(scope)).toHaveLength(1);
      });
    }
    it("cannot bypass a primary never annotation with a numeric string", async () => {
      const input = request();
      input.annotations = [{ messageIndex: 0, remember: "never" }];
      const { engine, repositories } = setup(route, [candidate("bad", "0", [])]);
      const result = await engine.remember(input);
      expect(result.events.some((event) => event.candidateId === "bad" && persisted(event.outcome))).toBe(false);
      expect(await repositories.facts.listByScope(scope)).toHaveLength(0);
    });
    for (const secondary of [undefined, null, [], [0, 0], [1, 0, 1]]) {
      it(`preserves valid fallback/repeated support ${JSON.stringify(secondary)}`, async () => {
        const value = candidate("good", 0, secondary);
        if (secondary === undefined) delete value.sourceMessageIndexes;
        const { engine, repositories } = setup(route, [value]);
        const input = request();
        for (let repeat = 0; repeat < 2; repeat++) {
          const result = await engine.remember(input);
          expect(result.events.some((event) => event.candidateId === "good" && persisted(event.outcome))).toBe(true);
        }
        const facts = await repositories.facts.listByScope(scope);
        expect(facts).toHaveLength(1);
        const evidence = (await repositories.evidence.listByScope(scope)).filter((item) => item.linkedMemoryIds.includes(facts[0]!.id));
        expect(evidence.length).toBeGreaterThan(0);
        for (const item of evidence) expect(item.sourceMessageIds).toEqual(secondary?.includes(1) ? ["primary", "secondary"] : ["primary"]);
      });
    }
    for (const restriction of ["never", "redacted"]) {
      it(`retains rejection of a valid numeric restricted secondary (${restriction})`, async () => {
        const input = request();
        if (restriction === "never") input.annotations = [{ messageIndex: 1, remember: "never" }];
        const { engine, repositories } = setup(route, [candidate("restricted", 0, [0, 1])], restriction === "redacted" ? {
          redact: (value) => ({ ...value, content: value.content === "Review is pending." ? "" : value.content }),
        } : undefined);
        const result = await engine.remember(input);
        expect(result.events.some((event) => event.candidateId === "restricted" && persisted(event.outcome))).toBe(false);
        expect(await repositories.facts.listByScope(scope)).toHaveLength(0);
      });
    }
  });
}
