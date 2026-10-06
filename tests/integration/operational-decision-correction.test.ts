import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGoodMemory, createInMemoryDocumentStore, createInMemorySessionStore } from "../../src";
import { createGoodMemoryRuntimeKit } from "../../src/runtime-kit";
import type { FactMemory } from "../../src/domain/records";

const scope = { userId: "public-decision-correction", workspaceId: "workspace-a", agentId: "chat" };
const old = "Project decision: We deploy CedarApp with blue-green releases.";
const next = "Project decision: We now deploy CedarApp with canary releases instead of blue-green releases.";

function fixture(policy?: Parameters<typeof createGoodMemory>[0]["policy"]) {
  const documentStore = createInMemoryDocumentStore();
  const memory = createGoodMemory({ storage: { provider: "memory" },
    adapters: { documentStore, sessionStore: createInMemorySessionStore() }, policy });
  const write = (content: string) => memory.remember({ scope, messages: [{ role: "user", content }] });
  return { documentStore, memory, write };
}

describe("source-bound operational decision correction", () => {
  it("does not revive a superseded decision when its original source is replayed", async () => {
    const f = fixture();
    const remember = (content: string, id: string) => f.memory.remember({ scope,
      messages: [{ id, role: "user", content }] });
    await remember(old, "original-old"); await remember(next, "original-new");
    const before = (await f.memory.exportMemory({ scope })).durable;
    const replay = await remember(old, "original-old");
    expect(replay.events).toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "superseded_fact_source_replay" }));
    const after = (await f.memory.exportMemory({ scope })).durable;
    expect(after.facts).toEqual(before.facts);
    expect(after.sourceMessages).toEqual(before.sourceMessages);
  });

  it("keeps one current decision when selective chat replays the complete user history", async () => {
    const f = fixture(); const kit = createGoodMemoryRuntimeKit({ memory: f.memory });
    const chatScope = { ...scope, sessionId: "history-chat" };
    const before = { id: "old-message", role: "user", content: old };
    const after = { id: "new-message", role: "user", content: next };
    const writeback = { mode: "selective" as const, annotation: "durable_candidate" as const, policy: "allow" as const };
    await kit.afterModelCall({ scope: chatScope, messages: [before], assistantText: "Okay.", writeback });
    await kit.afterModelCall({ scope: chatScope, messages: [before, after], assistantText: "Okay.", writeback });
    await kit.afterModelCall({ scope: chatScope, messages: [before, after], assistantText: "Okay.", writeback });
    expect((await f.memory.exportMemory({ scope })).durable.facts.filter(fact => fact.lifecycle === "active").map(fact => fact.content)).toEqual([next]);
  });
  it("supports successive corrections while retaining the original authored statements", async () => {
    const f = fixture();
    const final = "Project decision: We now deploy CedarApp with rolling releases instead of canary releases.";
    await f.write(old); await f.write(next);
    expect((await f.write(final)).events).toContainEqual(expect.objectContaining({ outcome: "superseded" }));
    const durable = (await f.memory.exportMemory({ scope })).durable;
    expect(durable.facts.filter(fact => fact.lifecycle === "active").map(fact => fact.content)).toEqual([final]);
    expect(durable.sourceMessages?.map(source => source.content)).toEqual(expect.arrayContaining([old, next, final]));
  });
  it.each([
    [old, next],
    ["Project decision: We store SableApp backups in weekly snapshots.", "Project decision: We now store SableApp backups in daily snapshots instead of weekly snapshots."],
    ["Project policy: For CedarApp production releases, we deploy with blue-green releases.", "Project policy: For CedarApp production releases, we now deploy with canary releases instead of blue-green releases."],
  ])("supersedes only the uniquely stated old decision: %s", async (before, after) => {
    const f = fixture();
    expect((await f.write(before)).accepted).toBe(1);
    const result = await f.write(after);
    expect(result.events).toContainEqual(expect.objectContaining({ outcome: "superseded", memoryType: "fact" }));
    const durable = (await f.memory.exportMemory({ scope })).durable;
    const previous = durable.facts.find(fact => fact.content === before)!;
    const current = durable.facts.find(fact => fact.content === after)!;
    expect(previous).toMatchObject({ lifecycle: "superseded", isActive: false, supersededBy: current.id });
    expect(current).toMatchObject({ lifecycle: "active", source: { method: "explicit" } });
    expect(durable.sourceMessages?.map(source => source.content)).toEqual(expect.arrayContaining([before, after]));
    expect(durable.evidence).toContainEqual(expect.objectContaining({ kind: "correction_context", linkedMemoryIds: [previous.id, current.id], excerpt: after }));
    const count = durable.facts.length;
    await f.write(after);
    expect((await f.memory.exportMemory({ scope })).durable.facts).toHaveLength(count);
  });

  it.each([
    "Project decision: We now deploy BirchApp with canary releases instead of blue-green releases.",
    "Project decision: We now deploy CedarApp with canary releases.",
    "Project decision: During the 2024 rehearsal, we deployed CedarApp with canary releases instead of blue-green releases.",
    "Project decision: We retain CedarApp logs for ninety days.",
  ])("retains unrelated, historical or non-replacing decisions: %s", async content => {
    const f = fixture(); await f.write(old); await f.write(content);
    expect((await f.memory.exportMemory({ scope })).durable.facts.find(fact => fact.content === old)?.lifecycle).toBe("active");
  });

  it("preserves a different applicable context", async () => {
    const f = fixture();
    const production = "Project decision: For CedarApp production releases, we deploy with blue-green releases.";
    await f.write(production);
    await f.write("Project decision: For CedarApp staging releases, we now deploy with canary releases instead of blue-green releases.");
    expect((await f.memory.exportMemory({ scope })).durable.facts.find(fact => fact.content === production)?.lifecycle).toBe("active");
  });

  it("does not use lexical overlap to retire an inferred fact on a correction cue", async () => {
    const f = fixture(); await f.write(old);
    const previous = (await f.documentStore.query<FactMemory>("facts"))[0]!;
    await f.documentStore.set("facts", previous.id, { ...previous, source: { ...previous.source, method: "inferred" } });
    await f.write(next);
    expect((await f.documentStore.get<FactMemory>("facts", previous.id))?.lifecycle).toBe("active");
  });

  it("does not choose the first of multiple exact old targets", async () => {
    const f = fixture(); await f.write(old);
    const original = (await f.documentStore.query<FactMemory>("facts"))[0]!;
    await f.documentStore.set("facts", "duplicate-old", { ...original, id: "duplicate-old" });
    const result = await f.write(next);
    expect(result.events).toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "ambiguous_fact_correction" }));
    expect((await f.documentStore.query<FactMemory>("facts")).filter(fact => fact.lifecycle === "active")).toHaveLength(2);
  });

  it.each(["assistant", "system"])("does not authorize replacement from %s", async role => {
    const f = fixture(); await f.write(old);
    await f.memory.remember({ scope, messages: [{ role, content: next }], annotations: [{ messageIndex: 0, remember: "always", confirmed: true, kindHint: "fact" }] });
    expect((await f.memory.exportMemory({ scope })).durable.facts.find(fact => fact.content === old)?.lifecycle).toBe("active");
  });

  it("preserves policy keep_existing on an explicit correction", async () => {
    const f = fixture({ resolveConflict: () => ({ action: "keep_existing", reason: "public-control" }) });
    await f.write(old);
    expect((await f.write(next)).events).toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "public-control" }));
    expect((await f.memory.exportMemory({ scope })).durable.facts).toHaveLength(1);
  });

  it("uses the actual selective chat writeback and fresh SQLite context", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gm-operational-correction-"));
    const storage = { provider: "sqlite" as const, url: join(directory, "memory.sqlite") };
    try {
      const write = async (content: string, sessionId: string) => {
        const kit = createGoodMemoryRuntimeKit({ memory: createGoodMemory({ storage }) });
        return kit.afterModelCall({ scope: { ...scope, sessionId }, messages: [{ id: sessionId, role: "user", content }], assistantText: "Okay.", writeback: { mode: "selective", annotation: "durable_candidate", policy: "allow" } });
      };
      await write(old, "old-chat");
      const replaced = await write(next, "new-chat");
      expect(replaced.rememberResult?.events).toContainEqual(expect.objectContaining({ outcome: "superseded", memoryType: "fact" }));
      const memory = createGoodMemory({ storage });
      const kit = createGoodMemoryRuntimeKit({ memory });
      const before = await kit.beforeModelCall({ scope: { ...scope, sessionId: "fresh-chat" }, messages: [{ role: "user", content: "How do we deploy CedarApp?" }] });
      expect(before.context.content).toContain(next);
      expect(before.context.content).not.toContain(old);
      const durable = (await memory.exportMemory({ scope })).durable;
      expect(durable.facts.filter(fact => fact.lifecycle === "active").map(fact => fact.content)).toEqual([next]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
