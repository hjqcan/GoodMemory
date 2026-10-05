import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createGoodMemory } from "../../src";

const scope = { userId: "decision-user", workspaceId: "project-a", agentId: "dsh" };
const decision = "Project decision: When SQLite reports SQLITE_BUSY_SNAPSHOT, roll back the transaction, begin again and recompute from a fresh read before writing.";

describe("unannotated project decisions", () => {
  it("persists the reported decision with evidence and recalls it after reopening SQLite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gm-project-decision-"));
    const storage = { provider: "sqlite" as const, url: join(directory, "memory.sqlite") };
    try {
      const memory = createGoodMemory({ storage });
      const result = await memory.remember({
        scope: { ...scope, sessionId: "write" },
        messages: [
          { id: "decision-source", role: "user", content: decision },
          { role: "assistant", content: "Acknowledged." },
        ],
      });
      expect(result).toMatchObject({ accepted: 1, outcome: "committed", metadata: { resolvedExtractionStrategy: "rules-only" } });
      const durable = (await memory.exportMemory({ scope })).durable;
      expect(durable.facts).toHaveLength(1);
      const fact = durable.facts[0]!;
      expect(fact).toMatchObject({ content: decision, category: "project", source: { method: "explicit" } });
      expect(durable.sourceMessages?.some(source => source.content === decision)).toBe(true);
      expect(durable.evidence.some(evidence => evidence.linkedMemoryIds.includes(fact.id) && evidence.excerpt === decision)).toBe(true);

      const fresh = createGoodMemory({ storage });
      const recall = await fresh.recall({ scope: { ...scope, sessionId: "restart" }, query: "What is the project decision for SQLITE_BUSY_SNAPSHOT?" });
      expect(recall.facts.some(item => item.id === fact.id)).toBe(true);
      expect((await fresh.buildContext({ recall, output: "system_prompt_fragment" })).content).toContain(decision);
      expect((await fresh.recall({ scope: { ...scope, workspaceId: "project-b" }, query: "SQLITE_BUSY_SNAPSHOT" })).facts).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(["assistant", "system"])("does not treat %s text as a user-confirmed decision", async (role) => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    await memory.remember({ scope, messages: [{ role, content: decision }] });
    expect((await memory.exportMemory({ scope })).durable.facts).toEqual([]);
  });

  it("respects the existing policy gate", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" }, policy: { shouldRemember: () => false } });
    const result = await memory.remember({ scope, messages: [{ role: "user", content: decision }] });
    expect(result.accepted).toBe(0);
    expect((await memory.exportMemory({ scope })).durable.facts).toEqual([]);
  });
});
