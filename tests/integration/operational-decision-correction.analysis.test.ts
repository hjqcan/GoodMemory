import { expect, it } from "bun:test";
import { createGoodMemory, createEnglishLanguagePack } from "../../src";

it("reuses the request-local incoming author analysis when proving a correction source", async () => {
  const base = createEnglishLanguagePack();
  const calls = new Map<string, number>();
  const pack = { ...base, analyzeContent(text: string) {
    calls.set(text, (calls.get(text) ?? 0) + 1);
    return base.analyzeContent(text);
  } };
  const memory = createGoodMemory({ storage: { provider: "memory" },
    language: { packs: [pack] }, testing: { now: () => new Date("2026-10-06T12:00:00Z") } });
  const scope = { userId: "public-analysis-reuse", workspaceId: "public" };
  const old = "Project decision: We route Linden traffic through the primary gateway.";
  const next = "Project decision: We now route Linden traffic through the secondary gateway instead of the primary gateway.";
  await memory.remember({ scope, messages: [{ id: "old", role: "user", content: old }] });
  calls.clear();
  const result = await memory.remember({ scope, messages: [{ id: "new", role: "user", content: next }] });
  expect(result.events).toContainEqual(expect.objectContaining({ reason: "source_bound_fact_correction" }));
  expect(calls.get(next)).toBe(1);
});
