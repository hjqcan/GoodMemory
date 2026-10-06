import { describe, expect, it } from "bun:test";
import { createGoodMemory, createInMemoryDocumentStore, createInMemorySessionStore } from "../../src";
import type { FactMemory } from "../../src/domain/records";
import type { DocumentStore } from "../../src/storage/contracts";
import type { SourceMessageRecord } from "../../src/evidence/contracts";
import { createSQLiteDocumentStore } from "../../src/storage/sqlite";

const scope = { userId: "public-correction-controls", workspaceId: "workspace-a", agentId: "chat" };
const old = "Project decision: We deploy CedarApp with blue-green releases.";
const next = "Project decision: We now deploy CedarApp with canary releases instead of blue-green releases.";
const make = (documentStore: DocumentStore, policy?: Parameters<typeof createGoodMemory>[0]["policy"]) =>
  createGoodMemory({ storage: { provider: "memory" }, adapters: { documentStore, sessionStore: createInMemorySessionStore() }, policy });
const write = (memory: ReturnType<typeof make>, content: string) => memory.remember({ scope, messages: [{ role: "user", content }] });

describe("operational correction transaction controls", () => {
  it("rejects a target changed while conflict policy was awaited", async () => {
    const store = createInMemoryDocumentStore();
    let changed: FactMemory | undefined;
    const memory = make(store, { resolveConflict: async existing => {
      if (existing.memoryType !== "fact") throw new Error("Expected a fact conflict");
      const original = await store.get<FactMemory>("facts", existing.id);
      changed = { ...original!, content: "Project decision: We retain CedarApp logs for ninety days." };
      await store.set("facts", existing.id, changed);
      return { action: "supersede_existing" };
    } });
    await write(memory, old);
    expect((await write(memory, next)).events).toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "fact_correction_target_changed_or_batch_unsupported" }));
    expect(await store.query("facts")).toEqual([changed!]);
  });

  it.each(["memory", "sqlite"])("rejects a target inserted before the %s transaction", async provider => {
    const inner = provider === "sqlite" ? createSQLiteDocumentStore(":memory:") : createInMemoryDocumentStore();
    let injected = false;
    const store = { ...inner, async writeBatchIfUnchanged(input: Parameters<typeof inner.writeBatchIfUnchanged>[0]) {
      if (!injected && input.set.some(item => item.collection === "facts" && (item.document as FactMemory).lifecycle === "superseded")) {
        injected = true;
        const original = (await inner.query<FactMemory>("facts"))[0]!;
        await inner.set("facts", "late-duplicate", { ...original, id: "late-duplicate" });
      }
      return inner.writeBatchIfUnchanged(input);
    } };
    const memory = make(store); await write(memory, old);
    const result = await write(memory, next);
    expect(result.events).toContainEqual(expect.objectContaining({ outcome: "rejected" }));
    expect((await inner.query<FactMemory>("facts")).filter(fact => fact.lifecycle === "active")).toHaveLength(2);
    expect((await inner.query<FactMemory>("facts")).some(fact => fact.content === next)).toBe(false);
  });

  it.each(["before-source", "after-correction-commit"])("rolls back old/new/evidence after %s failure", async failure => {
    const inner = createInMemoryDocumentStore();
    let injected = false;
    const store = { ...inner, async writeBatchIfUnchanged(input: Parameters<typeof inner.writeBatchIfUnchanged>[0]) {
      const correction = input.set.some(item => item.collection === "facts" && (item.document as FactMemory).lifecycle === "superseded");
      const source = input.set.some(item => item.collection === "source_messages_v1" && (item.document as SourceMessageRecord).content === next);
      if (!injected && (failure === "before-source" ? source : correction)) {
        injected = true;
        if (failure === "after-correction-commit") expect(await inner.writeBatchIfUnchanged(input)).toBe(true);
        throw new Error(`public injected ${failure}`);
      }
      return inner.writeBatchIfUnchanged(input);
    } };
    const memory = make(store); await write(memory, old);
    const collections = ["facts", "evidence"];
    const before = await Promise.all(collections.map(collection => inner.query(collection)));
    await expect(write(memory, next)).rejects.toThrow(`public injected ${failure}`);
    expect(injected).toBe(true);
    expect(await Promise.all(collections.map(collection => inner.query(collection)))).toEqual(before);
    // Immutable allowed source persists before the lifecycle commit and follows
    // the existing source lifecycle; rollback must not delete a shared source.
    expect((await inner.query<SourceMessageRecord>("source_messages_v1")).map(source => source.content))
      .toEqual(failure === "before-source" ? [old] : [old, next]);
    expect(await inner.query("remember_write_owners_v1")).toEqual([]);
  });

  it("fails closed when conditional batch writes are unavailable", async () => {
    const inner = createInMemoryDocumentStore();
    const store: DocumentStore = { set: inner.set, get: inner.get, update: inner.update, query: inner.query, delete: inner.delete };
    const memory = make(store); await write(memory, old);
    expect((await write(memory, next)).events).toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "fact_correction_target_changed_or_batch_unsupported" }));
    expect((await inner.query<FactMemory>("facts")).map(fact => [fact.content, fact.lifecycle])).toEqual([[old, "active"]]);
  });

  it("fails closed when an adapter has only row-level batch semantics", async () => {
    const inner = createInMemoryDocumentStore();
    const store = { ...inner, querySnapshotBatchSemantics: undefined };
    const memory = make(store); await write(memory, old);
    expect((await write(memory, next)).events).toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "fact_correction_target_changed_or_batch_unsupported" }));
    expect((await inner.query<FactMemory>("facts")).map(fact => [fact.content, fact.lifecycle])).toEqual([[old, "active"]]);
  });

  it("rejects a removed immutable source without mutating the old fact", async () => {
    const store = createInMemoryDocumentStore();
    const memory = make(store, { resolveConflict: async () => {
      for (const source of await store.query<{ id: string }>("source_messages_v1")) await store.delete("source_messages_v1", source.id);
      return { action: "supersede_existing" };
    } });
    await write(memory, old);
    expect((await write(memory, next)).events).toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "fact_correction_target_changed_or_batch_unsupported" }));
    expect((await store.query<FactMemory>("facts")).map(fact => [fact.content, fact.lifecycle])).toEqual([[old, "active"]]);
  });

  it("does not retire a stored assertion whose full author source is unavailable", async () => {
    const store = createInMemoryDocumentStore(); const memory = make(store);
    await write(memory, old);
    for (const source of await store.query<{ id: string }>("source_messages_v1")) await store.delete("source_messages_v1", source.id);
    expect((await write(memory, next)).events).toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "unverified_fact_correction_target" }));
    expect((await store.query<FactMemory>("facts")).map(fact => [fact.content, fact.lifecycle])).toEqual([[old, "active"]]);
  });

  it("allows only one of two concurrent corrections of the same target", async () => {
    const store = createInMemoryDocumentStore();
    let reached = 0;
    let release = () => {};
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const memory = make(store, { resolveConflict: async () => {
      if (++reached === 2) release();
      await barrier;
      return { action: "supersede_existing" };
    } });
    await write(memory, old);
    const competing = next.replace("canary releases", "rolling releases");
    const results = await Promise.all([write(memory, next), write(memory, competing)]);
    expect(results.map(result => result.accepted).sort()).toEqual([0, 1]);
    const facts = await store.query<FactMemory>("facts");
    expect(facts.filter(fact => fact.lifecycle === "active")).toHaveLength(1);
    expect(facts.find(fact => fact.content === old)?.lifecycle).toBe("superseded");
  });

  it("does not authorize a correction manufactured by policy redaction", async () => {
    const store = createInMemoryDocumentStore();
    const memory = make(store, { redact: candidate => ({ ...candidate, content: candidate.content.replace("secret canary", "canary") }) });
    await write(memory, old); await write(memory, next.replace("canary releases", "secret canary releases"));
    expect((await store.query<FactMemory>("facts")).find(fact => fact.content === old)?.lifecycle).toBe("active");
  });

  it.each(["Project decision: We now deploy CedarApp with canary releases instead of blue-green releases. Do not remember this.",
    'The document says "Project decision: We now deploy CedarApp with canary releases instead of blue-green releases."'])
  ("preserves the target when replacement is withheld or quoted: %s", async content => {
    const store = createInMemoryDocumentStore(); const memory = make(store);
    await write(memory, old); await write(memory, content);
    expect((await store.query<FactMemory>("facts")).find(fact => fact.content === old)?.lifecycle).toBe("active");
  });

  it("retains an independent scope", async () => {
    const store = createInMemoryDocumentStore(); const memory = make(store);
    await write(memory, old);
    await memory.remember({ scope: { ...scope, workspaceId: "workspace-b" }, messages: [{ role: "user", content: next }] });
    expect((await store.query<FactMemory>("facts")).find(fact => fact.content === old)?.lifecycle).toBe("active");
  });
});
