import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGoodMemory, createInMemoryDocumentStore, createInMemorySessionStore, createSQLiteDocumentStore } from "../../src";
import { createGoodMemoryRuntimeKit } from "../../src/runtime-kit";
import type { FactMemory } from "../../src/domain/records";
import type { EvidenceRecord, SourceMessageRecord } from "../../src/evidence/contracts";
import type { ConditionalDocumentWriteBatch, DocumentStore } from "../../src/storage/contracts";

const scope = { userId: "public-repeat-correction", workspaceId: "project", agentId: "author" };
const old = "Project decision: We deploy CedarApp with blue-green releases.";
const next = "Project decision: We now deploy CedarApp with canary releases instead of blue-green releases.";
const final = "Project decision: We now deploy CedarApp with rolling releases instead of canary releases.";
const time = (day: number) => `2026-10-${String(day).padStart(2, "0")}T00:00:00Z`;

for (const backend of ["memory", "sqlite"] as const) describe(`duplicate-aware explicit correction: ${backend}`, () => {
  async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), "gm-repeat-correction-"));
    const inner = backend === "sqlite" ? createSQLiteDocumentStore(join(directory, "memory.sqlite")) : createInMemoryDocumentStore();
    let intercept: ((batch: ConditionalDocumentWriteBatch) => Promise<void>) | undefined;
    const store: DocumentStore = { ...inner, async writeBatchIfUnchanged(batch) {
      await intercept?.(batch);
      return inner.writeBatchIfUnchanged(batch);
    } };
    let now = new Date("2026-10-15T00:00:00Z");
    const make = (policy?: Parameters<typeof createGoodMemory>[0]["policy"]) => createGoodMemory({
      storage: { provider: "memory" }, adapters: { documentStore: store, sessionStore: createInMemorySessionStore() },
      testing: { now: () => now }, policy,
    });
    const memory = make();
    const write = (content: string, id: string, day?: number, m = memory) => m.remember({ scope,
      messages: [{ id, role: "user", content, ...(day === undefined ? {} : { observedAt: time(day) }) }] });
    await write(old, "original", 1); await write(next, "replacement", 3); await write(old, "reasserted", 4);
    const facts = await inner.query<FactMemory>("facts");
    const target = facts.find(f => f.content === old && f.lifecycle === "active")!;
    const duplicate = facts.find(f => f.content === next && f.lifecycle === "active")!;
    return { inner, make, memory, write, target, duplicate, setNow: (value: Date) => { now = value; },
      setIntercept: (fn: typeof intercept) => { intercept = fn; },
      active: async () => (await inner.query<FactMemory>("facts")).filter(f => f.lifecycle === "active"),
      snapshot: () => Promise.all(["facts", "evidence"].map(c => inner.query(c))),
      close: () => rm(directory, { recursive: true, force: true }),
    };
  }

  it("retires the live old target while retaining duplicate identity and bound source evidence", async () => {
    const f = await fixture(); try {
      expect((await f.write(next, "explicit-repeat", 5)).events).toContainEqual(expect.objectContaining({ outcome: "superseded", reason: "source_bound_fact_correction", memoryId: f.duplicate.id }));
      expect((await f.active()).map(x => x.id)).toEqual([f.duplicate.id]);
      expect(await f.inner.get("facts", f.target.id)).toMatchObject({ lifecycle: "superseded", supersededBy: f.duplicate.id, isActive: false });
      expect(await f.inner.query("facts")).toHaveLength(3);
      const source = (await f.inner.query<SourceMessageRecord>("source_messages_v1")).find(x => x.sourceMessageId === "explicit-repeat")!;
      expect(await f.inner.query<EvidenceRecord>("evidence")).toContainEqual(expect.objectContaining({ kind: "correction_context", linkedMemoryIds: [f.target.id, f.duplicate.id], sourceRecordIds: [source.id], excerpt: next }));
      const context = await createGoodMemoryRuntimeKit({ memory: f.make() }).beforeModelCall({ scope: { ...scope, sessionId: "fresh" }, messages: [{ role: "user", content: "Which deployment strategy does CedarApp use?" }] });
      expect(context.context.content).toContain(next); expect(context.context.content).not.toContain(old);
      expect((await f.write(final, "later-chain", 6)).accepted).toBe(1);
      expect((await f.write(old, "stale-restoration", 5)).accepted).toBe(0);
    } finally { await f.close(); }
  });

  it.each([2, 4, undefined])("does not let duplicate identity bypass source chronology at day %s", async day => {
    const f = await fixture(); try {
      const before = await f.snapshot();
      expect((await f.write(next, "outdated-repeat", day)).accepted).toBe(0);
      expect(await f.snapshot()).toEqual(before);
    } finally { await f.close(); }
  });

  it("preserves benign duplicate merge after the live target is already retired", async () => {
    const f = await fixture(); try {
      await f.write(next, "explicit-repeat", 5);
      const result = await f.write(next, "repeat-again", 5);
      expect(result.events).toContainEqual(expect.objectContaining({ outcome: "merged", reason: "duplicate_fact", memoryId: f.duplicate.id }));
      expect((await f.active()).map(x => x.id)).toEqual([f.duplicate.id]);
    } finally { await f.close(); }
  });

  it("consults keep-existing policy before duplicate-aware retirement", async () => {
    const f = await fixture(); try {
      const before = await f.snapshot(); let called = false;
      const memory = f.make({ resolveConflict: existing => { called = true; if (existing.memoryType !== "fact") throw new Error("Expected fact policy target"); expect(existing.id).toBe(f.target.id); return { action: "keep_existing", reason: "public_policy_keep" }; } });
      expect((await f.write(next, "policy-repeat", 5, memory)).accepted).toBe(0);
      expect(called).toBe(true); expect(await f.snapshot()).toEqual(before);
    } finally { await f.close(); }
  });

  it.each(["target", "duplicate"])("rejects an ambiguous live %s", async kind => {
    const f = await fixture(); try {
      const record = kind === "target" ? f.target : f.duplicate;
      await f.inner.set("facts", "ambiguous", { ...record, id: "ambiguous" });
      const before = await f.snapshot();
      expect((await f.write(next, "ambiguous-repeat", 5)).events).toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "ambiguous_fact_correction" }));
      expect(await f.snapshot()).toEqual(before);
    } finally { await f.close(); }
  });

  it("binds the existing duplicate row to the final retirement batch", async () => {
    const f = await fixture(); try {
      let changed = false;
      f.setIntercept(async batch => {
        if (changed || !batch.set.some(x => x.collection === "facts" && x.id === f.target.id && (x.document as FactMemory).lifecycle === "superseded")) return;
        changed = true;
        await f.inner.set("facts", f.duplicate.id, { ...f.duplicate, validUntil: "2026-10-14T00:00:00Z" });
      });
      expect((await f.write(next, "raced-repeat", 5)).accepted).toBe(0);
      expect(changed).toBe(true); expect(await f.inner.get("facts", f.target.id)).toEqual(f.target);
    } finally { await f.close(); }
  });

  it.each(["expired", "inactive", "expires-after-source"])("never retires into a %s duplicate destination", async kind => {
    const f = await fixture(); try {
      await f.inner.set("facts", f.duplicate.id, { ...f.duplicate,
        ...(kind === "inactive" ? { isActive: false } : { expiresAt: kind === "expired" ? "2026-10-14T00:00:00Z" : "2026-10-15T00:01:00Z" }),
      });
      const before = await f.snapshot();
      if (kind === "expires-after-source") f.setIntercept(async batch => {
        if (batch.set.some(x => x.collection === "source_messages_v1" && (x.document as SourceMessageRecord).sourceMessageId === "destination-repeat")) {
          f.setNow(new Date("2026-10-15T00:02:00Z"));
        }
      });
      expect((await f.write(next, "destination-repeat", 5)).accepted).toBe(0);
      expect(await f.snapshot()).toEqual(before);
    } finally { await f.close(); }
  });

  it("does not roll back an identical duplicate adopted by a later writer", async () => {
    const f = await fixture(); try {
      let injected = false;
      let later: Awaited<ReturnType<typeof f.snapshot>> | undefined;
      f.setIntercept(async batch => {
        if (injected || !batch.set.some(x => x.collection === "facts" && x.id === f.target.id && (x.document as FactMemory).lifecycle === "superseded")) return;
        injected = true;
        expect(await f.inner.writeBatchIfUnchanged(batch)).toBe(true);
        expect((await f.write(next, "later-adopter", 7, f.make())).accepted).toBe(1);
        later = await f.snapshot();
        throw new Error("public adopted duplicate post-commit fault");
      });
      await expect(f.write(next, "adopted-repeat", 5)).rejects.toThrow("public adopted duplicate post-commit fault");
      expect(injected).toBe(true); expect(await f.snapshot()).toEqual(later!);
      expect((await f.active()).map(x => x.id)).toEqual([f.duplicate.id]);
      expect(await f.inner.query("remember_write_owners_v1")).toEqual([]);
    } finally { await f.close(); }
  });

  it("rolls back target, duplicate and evidence after a post-commit failure", async () => {
    const f = await fixture(); try {
      const before = await f.snapshot(); let injected = false;
      f.setIntercept(async batch => {
        if (injected || !batch.set.some(x => x.collection === "facts" && x.id === f.target.id && (x.document as FactMemory).lifecycle === "superseded")) return;
        injected = true; expect(await f.inner.writeBatchIfUnchanged(batch)).toBe(true);
        throw new Error("public duplicate correction post-commit fault");
      });
      await expect(f.write(next, "failed-repeat", 5)).rejects.toThrow("public duplicate correction post-commit fault");
      expect(injected).toBe(true); expect(await f.snapshot()).toEqual(before);
      expect(await f.inner.query("remember_write_owners_v1")).toEqual([]);
      expect(await f.inner.query<SourceMessageRecord>("source_messages_v1")).toContainEqual(expect.objectContaining({ sourceMessageId: "failed-repeat" }));
    } finally { await f.close(); }
  });
});
