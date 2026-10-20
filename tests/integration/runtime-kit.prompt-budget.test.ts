import { describe, expect, it } from "bun:test";
import { createGoodMemory } from "../../src";
import { createGoodMemoryRuntimeKit } from "../../src/runtime-kit";

describe("runtime-kit prompt budget bookkeeping", () => {
  it("keeps recall membership while reporting a rule omitted from actual context", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = { userId: "prompt-budget-user", workspaceId: "prompt-budget-workspace" };
    const rule = "From now on, always use bullet points in status updates.";
    await memory.remember({ scope, messages: [{ role: "user", content: rule }] });
    const kit = createGoodMemoryRuntimeKit({ memory, defaultMaxMemoryTokens: 160 });
    const normal = await kit.beforeModelCall({ scope, query: "Give today's project status." });
    expect(normal.recall?.feedback).toHaveLength(1);
    expect(normal.context.content).toContain(rule);
    for (const maxMemoryTokens of [1, 24, 25]) {
      const result = await kit.beforeModelCall({
        scope, query: "Give today's project status.", maxMemoryTokens,
      });
      expect(result.recall?.feedback.map((item) => item.id)).toEqual(
        normal.recall?.feedback.map((item) => item.id),
      );
      expect(result.context.content).not.toContain(rule);
      expect(result.context.estimatedTokens).toBeLessThanOrEqual(maxMemoryTokens);
      expect(result.context.omittedSections).toContain("Procedural Memory");
    }
    const zero = await kit.beforeModelCall({
      scope, query: "Give today's project status.", maxMemoryTokens: 0,
    });
    // Recall packets carry their own byte cap: public zero already requests
    // a zero-byte fragment here, unlike standalone uncapped packet rendering.
    expect(zero.context.content).toBe("");
    expect(zero.context.estimatedTokens).toBe(0);
    expect(zero.context.omittedSections).toContain("Procedural Memory");
  });
});
