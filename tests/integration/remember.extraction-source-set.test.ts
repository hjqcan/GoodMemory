import { describe, expect, it } from "bun:test";
import { createRememberEngine } from "../../src/remember/engine";
import type { RememberEngineConfig } from "../../src/remember/engine";
import type { MemoryCandidate, MemoryExtractionInput } from "../../src/remember/candidates";
import { createMemoryRepositories } from "../../src/storage/repositories";
import { createInMemoryDocumentStore, createInMemorySessionStore } from "../../src/storage/memory";

const text = "Orchid launch depends on review.";
const scope = { userId: "source-set-user", sessionId: "source-set-session" };
const candidate = (id: string, indexes: number[]): MemoryCandidate => ({
  id, kindHint: "fact", explicitness: "explicit", content: text,
  sourceMessageIndex: 0, sourceMessageIndexes: indexes, sourceRole: "user",
  metadata: { category: "project" },
});
function setup(candidates: MemoryCandidate[], policy?: RememberEngineConfig["policy"], split = false) {
  const documentStore = createInMemoryDocumentStore();
  const repositories = createMemoryRepositories({ documentStore, sessionStore: createInMemorySessionStore() });
  let id = 0;
  const engine = createRememberEngine({ documentStore, repositories,
    extractor: { async extract() { return { candidates: split ? candidates.slice(0, 1) : [], ignoredMessageCount: 0 }; } },
    assistedExtractor: { async extract() { return { candidates: split ? candidates.slice(1) : candidates, ignoredMessageCount: 0 }; } },
    policy, now: () => "2026-10-16T00:00:00.000Z", createId: () => `generated-${++id}`,
  });
  return { engine, repositories };
}
function input(): MemoryExtractionInput {
  return { scope, extractionStrategy: "llm-assisted", locale: "en-US", messages: [
    { id: "primary", role: "user", content: text, observedAt: "2026-10-14T00:00:00.000Z" },
    { id: "secondary", role: "user", content: "Review is pending.", observedAt: "2026-10-15T00:00:00.000Z" },
  ] };
}

describe("remember preserves each candidate's source set until admission", () => {
  for (const split of [false, true]) {
    for (const restriction of ["assistant", "never", "redacted"] as const) {
      for (const reverse of [false, true]) {
        it(`split=${split}: ${restriction} secondary cannot erase the independently valid duplicate, reverse=${reverse}`, async () => {
          const candidates = [candidate("valid", [0]), candidate("restricted", [0, 1])];
          if (reverse) candidates.reverse();
          const request = input();
          if (restriction === "assistant") request.messages[1]!.role = "assistant";
          if (restriction === "never") request.annotations = [{ messageIndex: 1, remember: "never" }];
          const { engine, repositories } = setup(candidates, restriction === "redacted" ? {
            redact: (value) => ({ ...value, content: value.content === "Review is pending." ? "" : value.content }),
          } : undefined, split);
          const result = await engine.remember(request);
          expect(result.events.some((event) => event.candidateId === "valid" && event.outcome === "written")).toBe(true);
          expect(result.events.some((event) => event.candidateId === "restricted" && ["written", "merged", "superseded"].includes(event.outcome))).toBe(false);
          if (restriction !== "never") expect(result.events).toContainEqual(expect.objectContaining({ candidateId: "restricted", outcome: "rejected",
            reason: restriction === "assistant" ? "assistant_policy_blocked" : "invalid_after_redaction" }));
          const facts = await repositories.facts.listByScope(scope);
          expect(facts).toHaveLength(1);
          expect(facts[0]!.observedAt).toBe("2026-10-14T00:00:00.000Z");
          const evidence = await repositories.evidence.listByScope(scope);
          const factEvidence = evidence.filter((item) => item.linkedMemoryIds.includes(facts[0]!.id));
          expect(factEvidence.length).toBeGreaterThan(0);
          expect(factEvidence.map((item) => item.sourceMessageIds)).toEqual([["primary"]]);
          expect(factEvidence[0]!.sourceRecordIds).toHaveLength(1);
          const sources = await repositories.sourceMessages.getByIds({ scope, ids: factEvidence[0]!.sourceRecordIds! });
          expect(sources.map((source) => ({ id: source.sourceMessageId, observedAt: source.observedAt }))).toEqual([
            { id: "primary", observedAt: "2026-10-14T00:00:00.000Z" },
          ]);
        });
      }
    }
  }
});

for (const reverse of [false, true]) {
  it(`keeps separate evidence for admitted duplicate source sets, reverse=${reverse}`, async () => {
    const candidates = [candidate("primary-only", [0]), candidate("both-sources", [0, 1])];
    if (reverse) candidates.reverse();
    const { engine, repositories } = setup(candidates);
    const request = input();
    request.messages[1]!.observedAt = "2026-10-13T00:00:00.000Z";
    const result = await engine.remember(request);
    const events = result.events.filter((event) => ["primary-only", "both-sources"].includes(event.candidateId));
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.outcome)).toEqual(["written", "merged"]);
    expect(new Set(events.map((event) => event.memoryId)).size).toBe(1);
    const allEvidence = await repositories.evidence.listByScope(scope);
    for (const event of events) {
      const evidence = allEvidence.find((item) => item.id === event.evidenceIds?.[0])!;
      expect(evidence.sourceMessageIds).toEqual(event.candidateId === "both-sources" ? ["primary", "secondary"] : ["primary"]);
      const sources = await repositories.sourceMessages.getByIds({ scope, ids: evidence.sourceRecordIds! });
      expect(sources.map((source) => source.sourceMessageId)).toEqual(evidence.sourceMessageIds);
    }
    const facts = await repositories.facts.listByScope(scope);
    expect(facts).toHaveLength(1);
    // Existing durable duplicate behavior preserves the first stored observation.
    expect(facts[0]!.observedAt).toBe(reverse ? "2026-10-13T00:00:00.000Z" : "2026-10-14T00:00:00.000Z");
  });
}

for (const split of [false, true]) {
  it(`merges equivalent complete source sets once through remember, split=${split}`, async () => {
    const candidates = [candidate("first", [1, 1]), candidate("second", [0, 1, 0])];
    const before = structuredClone(candidates);
    const { engine, repositories } = setup(candidates, undefined, split);
    const result = await engine.remember(input());
    expect(result.events.filter((event) => event.memoryType === "fact").map((event) => event.candidateId)).toEqual(["first"]);
    const facts = await repositories.facts.listByScope(scope);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.observedAt).toBe("2026-10-14T00:00:00.000Z");
    const evidence = (await repositories.evidence.listByScope(scope)).filter((item) => item.linkedMemoryIds.includes(facts[0]!.id));
    expect(evidence.map((item) => item.sourceMessageIds)).toEqual([["primary", "secondary"]]);
    expect(candidates).toEqual(before);
  });
}
