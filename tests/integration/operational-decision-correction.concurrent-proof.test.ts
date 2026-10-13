import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGoodMemory, createInMemoryDocumentStore, createInMemorySessionStore } from "../../src";
import { createSQLiteDocumentStore } from "../../src/storage/sqlite";
import type { FactMemory } from "../../src/domain/records";
import type { ConditionalDocumentWriteBatch, DocumentStore } from "../../src/storage/contracts";
import { SOURCE_MESSAGES_COLLECTION, EVIDENCE_COLLECTION, type SourceMessageRecord } from "../../src/evidence/contracts";

const scope = { userId: "public-concurrent-proof", workspaceId: "workspace" };
const old = "Project decision: We deploy CedarApp with blue-green releases.";
const next = "Project decision: We now deploy CedarApp with canary releases instead of blue-green releases.";
const final = "Project decision: We now deploy CedarApp with rolling releases instead of canary releases.";
const time = (day: number) => `2026-09-${String(day).padStart(2, "0")}T00:00:00Z`;
const make = (documentStore: DocumentStore) => createGoodMemory({ storage: { provider: "memory" },
  adapters: { documentStore, sessionStore: createInMemorySessionStore() },
  testing: { now: () => new Date("2026-10-11T12:00:00Z") } });
const write = (memory: ReturnType<typeof make>, content: string, id: string, day?: number) =>
  memory.remember({ scope, messages: [{ role: "user", content, id, ...(day ? { observedAt: time(day) } : {}) }] });

describe("public correction concurrency proof", () => {
  for (const provider of ["memory", "sqlite"] as const) {
    const fixture = async () => {
      const directory = await mkdtemp(join(tmpdir(), "gm-proof-"));
      const inner = provider === "memory" ? createInMemoryDocumentStore() : createSQLiteDocumentStore(join(directory, "db.sqlite"));
      const other = provider === "memory" ? inner : createSQLiteDocumentStore(join(directory, "db.sqlite"));
      let intercept: ((batch: ConditionalDocumentWriteBatch) => Promise<void>) | undefined;
      let queryIntercept: ((collection: string) => Promise<void>) | undefined;
      const store = { ...inner, async query<T extends object>(collection: string, filter?: Parameters<DocumentStore["query"]>[1]) {
        const result = await inner.query<T>(collection, filter);
        await queryIntercept?.(collection);
        return result;
      }, async writeBatchIfUnchanged(batch: ConditionalDocumentWriteBatch) {
        await intercept?.(batch);
        return inner.writeBatchIfUnchanged(batch);
      } };
      return { inner, memory: make(store), other: make(other), setIntercept: (fn: typeof intercept) => { intercept = fn; },
        setQueryIntercept: (fn: typeof queryIntercept) => { queryIntercept = fn; },
        cleanup: () => rm(directory, { recursive: true, force: true }) };
    };

    it(`${provider}: rejects a correction whose named old target is already retired`, async () => {
      const f = await fixture();
      try {
        await write(f.memory, old, "old", 1);
        await write(f.memory, next, "next", 2);
        const before = await f.inner.query("facts");
        const result = await write(f.memory, next.replace("canary", "rolling"), "late", 3);
        expect(result.accepted).toBe(0);
        expect(await f.inner.query("facts")).toEqual(before);
      } finally { await f.cleanup(); }
    });

    it(`${provider}: rejects a first-write phantom from the other connection`, async () => {
      const f = await fixture();
      try {
        let injected = false;
        f.setQueryIntercept(async collection => {
          if (collection !== "facts" || injected) return;
          injected = true;
          expect((await write(f.other, old, "other-old", 1)).accepted).toBe(1);
          expect((await write(f.other, next, "other-new", 3)).accepted).toBe(1);
        });
        expect((await write(f.memory, old, "stale-first", 2)).accepted).toBe(0);
        expect(injected).toBe(true);
        expect((await f.inner.query<FactMemory>("facts")).filter(fact => fact.lifecycle === "active").map(fact => fact.content)).toEqual([next]);
      } finally { await f.cleanup(); }
    });

    it.each(["row-only", "no-batch"])(`${provider}: retains ordinary insert and duplicate for %s adapters`, async capability => {
      const f = await fixture();
      try {
        const store = { ...f.inner, querySnapshotBatchSemantics: undefined,
          ...(capability === "no-batch" ? { writeBatchIfUnchanged: undefined } : {}) };
        const memory = make(store);
        expect((await write(memory, old, "first", 1)).accepted).toBe(1);
        expect((await write(memory, old, "second", 2)).events).toContainEqual(expect.objectContaining({ outcome: "merged", reason: "duplicate_fact" }));
        expect(await f.inner.query("facts")).toHaveLength(1);
      } finally { await f.cleanup(); }
    });

    it.each([1, 2, undefined])(`${provider}: rejects old-value backfill at author day %s`, async day => {
      const f = await fixture();
      try {
        await write(f.memory, old, "old", 1); await write(f.memory, next, "next", 2);
        expect((await write(f.memory, old, "different-source", day)).accepted).toBe(0);
        expect((await f.inner.query<FactMemory>("facts")).filter(fact => fact.lifecycle === "active").map(fact => fact.content)).toEqual([next]);
      } finally { await f.cleanup(); }
    });

    it(`${provider}: duplicate merge cannot overwrite concurrent retirement`, async () => {
      const f = await fixture();
      try {
        await write(f.memory, old, "old", 1);
        let injected = false;
        f.setIntercept(async batch => {
          if (injected || !batch.set.some(item => item.collection === "facts" && (item.document as FactMemory).content === old)) return;
          injected = true;
          expect((await write(f.other, next, "next", 3)).accepted).toBe(1);
        });
        expect((await write(f.memory, old, "merge", 2)).accepted).toBe(0);
        expect(injected).toBe(true);
        expect((await f.inner.query<FactMemory>("facts")).filter(fact => fact.lifecycle === "active").map(fact => fact.content)).toEqual([next]);
      } finally { await f.cleanup(); }
    });

    it.each(["successor", "evidence", "source"])(`${provider}: binds the %s proof to the restoration commit`, async mutation => {
      const f = await fixture();
      try {
        await write(f.memory, old, "old", 1); await write(f.memory, next, "next", 2);
        let injected = false;
        f.setIntercept(async batch => {
          if (injected || !batch.set.some(item => item.collection === "facts" && (item.document as FactMemory).content === old)) return;
          injected = true;
          if (mutation === "successor") expect((await write(f.other, final, "final", 4)).accepted).toBe(1);
          if (mutation === "evidence") expect((await write(f.other, next, "reaffirmed", 4)).accepted).toBe(1);
          if (mutation === "source") {
            const source = (await f.inner.query<SourceMessageRecord>(SOURCE_MESSAGES_COLLECTION)).find(item => item.content === next)!;
            await f.inner.delete(SOURCE_MESSAGES_COLLECTION, source.id);
          }
        });
        expect((await write(f.memory, old, "restoration", 3)).accepted).toBe(0);
        expect(injected).toBe(true);
        const facts = await f.inner.query<FactMemory>("facts");
        expect(facts.filter(fact => fact.lifecycle === "active").map(fact => fact.content)).toEqual([mutation === "successor" ? final : next]);
        const restoredSource = (await f.inner.query<SourceMessageRecord>(SOURCE_MESSAGES_COLLECTION)).find(item => item.content === old && item.observedAt === "2026-09-03T00:00:00.000Z");
        expect(restoredSource).toBeDefined();
        expect((await f.inner.query<{ sourceRecordIds?: string[] }>(EVIDENCE_COLLECTION)).some(item => item.sourceRecordIds?.includes(restoredSource!.id))).toBe(false);
      } finally { await f.cleanup(); }
    });

    it(`${provider}: permits a strictly newer independently authored restoration`, async () => {
      const f = await fixture();
      try {
        await write(f.memory, old, "old", 1); await write(f.memory, next, "next", 2);
        expect((await write(f.memory, old, "restoration", 3)).accepted).toBe(1);
        expect((await f.inner.query<FactMemory>("facts")).filter(fact => fact.lifecycle === "active").map(fact => fact.content).sort()).toEqual([next, old].sort());
      } finally { await f.cleanup(); }
    });

    it.each(["row-only", "no-batch"])(`${provider}: fails closed for %s restoration adapters`, async capability => {
      const f = await fixture();
      try {
        await write(f.memory, old, "old", 1); await write(f.memory, next, "next", 2);
        const store = { ...f.inner, querySnapshotBatchSemantics: undefined,
          ...(capability === "no-batch" ? { writeBatchIfUnchanged: undefined } : {}) };
        const before = await Promise.all(["facts", EVIDENCE_COLLECTION].map(collection => f.inner.query(collection)));
        expect((await write(make(store), old, "restoration", 3)).accepted).toBe(0);
        expect(await Promise.all(["facts", EVIDENCE_COLLECTION].map(collection => f.inner.query(collection)))).toEqual(before);
      } finally { await f.cleanup(); }
    });

    it.each([false, true])(`${provider}: rolls back the restoration batch with inferred retirement %s`, async inferred => {
      const f = await fixture();
      try {
        await write(f.memory, old, "old", 1); await write(f.memory, next, "next", 2);
        if (inferred) {
          const template = (await f.inner.query<FactMemory>("facts")).find(fact => fact.content === next)!;
          await f.inner.set("facts", "inferred", { ...template, id: "inferred",
            content: "We deploy CedarApp with blue-green releases every week.",
            source: { ...template.source, method: "inferred" } });
        }
        const before = await Promise.all(["facts", EVIDENCE_COLLECTION].map(collection => f.inner.query(collection)));
        let injected = false;
        f.setIntercept(async batch => {
          if (injected || !batch.set.some(item => item.collection === "facts" && (item.document as FactMemory).content === old)) return;
          injected = true;
          if (inferred) expect(batch.set.some(item => item.collection === "facts" && item.id === "inferred" && (item.document as FactMemory).lifecycle === "superseded")).toBe(true);
          expect(await f.inner.writeBatchIfUnchanged(batch)).toBe(true);
          throw new Error("public restoration post-commit fault");
        });
        await expect(write(f.memory, old, "restoration", 3)).rejects.toThrow("public restoration post-commit fault");
        expect(injected).toBe(true);
        expect(await Promise.all(["facts", EVIDENCE_COLLECTION].map(collection => f.inner.query(collection)))).toEqual(before);
        expect(await f.inner.query("remember_write_owners_v1")).toEqual([]);
        expect((await f.inner.query<SourceMessageRecord>(SOURCE_MESSAGES_COLLECTION)).some(source => source.observedAt === "2026-09-03T00:00:00.000Z")).toBe(true);
      } finally { await f.cleanup(); }
    });

    it(`${provider}: checks the latest successor across a multi-step lineage`, async () => {
      const f = await fixture();
      try {
        await write(f.memory, old, "old", 1); await write(f.memory, next, "next", 2);
        await write(f.memory, final, "final", 4);
        expect((await write(f.memory, old, "late", 3)).accepted).toBe(0);
        expect((await write(f.memory, old, "fresh", 5)).accepted).toBe(1);
      } finally { await f.cleanup(); }
    });

    it(`${provider}: preserves ordinary writes after an inferred fact was superseded`, async () => {
      const f = await fixture();
      try {
        await write(f.memory, old, "old");
        const original = (await f.inner.query<FactMemory>("facts"))[0]!;
        await f.inner.set("facts", original.id, { ...original, source: { ...original.source, method: "inferred" } });
        const replacement = "Project decision: We deploy CedarApp with canary releases.";
        expect((await write(f.memory, replacement, "explicit")).events).toContainEqual(expect.objectContaining({ outcome: "superseded", reason: "superseded_inferred_fact" }));
        expect((await write(f.memory, old, "independent")).accepted).toBe(1);
      } finally { await f.cleanup(); }
    });
  }
});
