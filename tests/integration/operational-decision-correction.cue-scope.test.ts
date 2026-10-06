import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createEnglishLanguagePack, createGoodMemory } from "../../src";

const old = "We retain build cache files for ten days.";
const replacement = "Project decision: We retain build cache files for twenty days.";
const unrelated = "Correction: my editor theme is light instead of dark.";

for (const provider of ["memory", "sqlite"] as const) {
  for (const position of ["none", "before", "after"] as const) {
    it(`retires an inferred fact with an unrelated cue ${position} using native ${provider} extraction`, async () => {
      const directory = mkdtempSync("/tmp/gm-cue-scope-");
      try {
        const memory = createGoodMemory({ storage: { provider, url: join(directory, "memory.sqlite") } });
        const scope = { userId: "public-cue-scope", workspaceId: "public" };
        await memory.remember({ scope, locale: "en-US", extractionStrategy: "rules-only",
          annotations: [{ messageIndex: 0, remember: "always" }],
          messages: [{ id: "old", role: "user", content: old }] });
        expect((await memory.exportMemory({ scope })).durable.facts).toContainEqual(
          expect.objectContaining({ content: old, lifecycle: "active", source: expect.objectContaining({ method: "inferred" }) }));
        const content = position === "before" ? `${unrelated} ${replacement}` :
          position === "after" ? `${replacement} ${unrelated}` : replacement;
        await memory.remember({ scope: { ...scope, sessionId: "update" }, locale: "en-US",
          extractionStrategy: "rules-only", messages: [{ id: "next", role: "user", content }] });
        const facts = (await memory.exportMemory({ scope })).durable.facts;
        expect(facts.find(fact => fact.content === old)?.lifecycle).toBe("superseded");
        expect(facts).toContainEqual(expect.objectContaining({ content: replacement, lifecycle: "active" }));
        const recall = await memory.recall({ scope: { ...scope, sessionId: "fresh" }, query: "How long do we retain build cache files?" });
        const context = await memory.buildContext({ recall, output: "system_prompt_fragment" });
        expect(context.content).toContain("twenty days");
        expect(context.content).not.toContain("ten days");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
}

for (const separateMessage of [false, true]) {
  it(`binds assisted fact cues to candidate text with ${separateMessage ? "multiple" : "one"} source messages`, async () => {
    let seeded = false;
    const next = "We retain build cache files for twenty days.";
    const memory = createGoodMemory({ storage: { provider: "memory" }, adapters: { assistedExtractor: {
      async extract() { return { candidates: [{ id: "public-candidate", kindHint: "fact" as const,
        content: seeded ? next : old, explicitness: seeded ? "explicit" as const : "inferred" as const,
        sourceMessageIndex: 0, ...(seeded && separateMessage ? { sourceMessageIndexes: [0, 1] } : {}), sourceRole: "user" as const }],
      ignoredMessageCount: 0 }; },
    } } });
    const scope = { userId: "public-assisted-cue", workspaceId: "public" };
    await memory.remember({ scope, locale: "en-US", extractionStrategy: "llm-assisted",
      annotations: [{ messageIndex: 0, remember: "always" }], messages: [{ role: "user", content: old }] });
    expect((await memory.exportMemory({ scope })).durable.facts).toContainEqual(
      expect.objectContaining({ content: old, lifecycle: "active", source: expect.objectContaining({ method: "inferred" }) }));
    seeded = true;
    await memory.remember({ scope, locale: "en-US", extractionStrategy: "llm-assisted",
      messages: separateMessage ? [{ role: "user", content: next }, { role: "user", content: unrelated }] :
        [{ role: "user", content: `${next} ${unrelated}` }] });
    const facts = (await memory.exportMemory({ scope })).durable.facts;
    expect(facts.find(fact => fact.content === old)?.lifecycle).toBe("superseded");
    expect(facts).toContainEqual(expect.objectContaining({ content: next, lifecycle: "active" }));
    const recall = await memory.recall({ scope: { ...scope, sessionId: "fresh" }, query: "How long do we retain build cache files?" });
    const context = await memory.buildContext({ recall, output: "system_prompt_fragment" });
    expect(context.content).toContain("twenty days");
    expect(context.content).not.toContain("ten days");
  });
}

it("adds one candidate analysis beyond the existing split-source sanitizer", async () => {
  const base = createEnglishLanguagePack();
  const calls = new Map<string, number>();
  const memory = createGoodMemory({ storage: { provider: "memory" }, language: { packs: [{ ...base,
    analyzeContent(text: string) {
      calls.set(text, (calls.get(text) ?? 0) + 1);
      return base.analyzeContent(text);
    },
  }] } });
  const scope = { userId: "public-split-analysis" };
  await memory.remember({ scope, locale: "en-US", annotations: [{ messageIndex: 0, remember: "always" }],
    messages: [{ role: "user", content: old }] });
  calls.clear();
  const content = `${replacement} ${unrelated}`;
  await memory.remember({ scope, locale: "en-US", messages: [{ role: "user", content }] });
  expect(calls.get(content)).toBe(1);
  expect(calls.get(replacement)).toBe(2);
});
