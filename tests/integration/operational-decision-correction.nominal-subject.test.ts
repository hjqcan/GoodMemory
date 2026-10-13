import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGoodMemory, createInMemoryDocumentStore, createInMemorySessionStore, createSQLiteDocumentStore } from "../../src";
import { createGoodMemoryRuntimeKit } from "../../src/runtime-kit";
const old = "Project decision: My novel uses first-person narration.";
const next = "Project decision: My novel now uses third-person narration instead of first-person narration.";
const scope = { userId: "nominal-correction-public", workspaceId: "author-workspace", agentId: "author-agent" };
for (const backend of ["memory", "sqlite"] as const)
  describe("nominal uses-relation correction: " + backend, () => {
    async function run(check: (f: any) => Promise<void>) {
      const dir = await mkdtemp(join(tmpdir(), "gm-nominal-"));
      const storage = backend === "sqlite" ? { provider: "sqlite" as const, url: join(dir, "memory.sqlite") } : { provider: "memory" as const };
      const documentStore = backend === "sqlite" ? createSQLiteDocumentStore(storage.url!) : createInMemoryDocumentStore();
      const memory = createGoodMemory({ storage, adapters: { documentStore, sessionStore: createInMemorySessionStore() }, testing: { now: () => new Date("2026-10-11T12:00:00Z") } });
      const write = (content: string, id: string, day: number, s = scope) => memory.remember({ scope: s, locale: "en", extractionStrategy: "rules-only", messages: [{ id, role: "user", content, observedAt: `2026-10-${String(day).padStart(2, "0")}T00:00:00Z` }] });
      try {
        await check({ memory, documentStore, storage, write, active: async () => (await documentStore.query("facts")).filter((f: any) => f.lifecycle === "active" && f.isActive !== false) });
      }
      finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    it("replaces only the uniquely authored target and preserves evidence", () => run(async (f) => {
      await f.write(old, "old", 1);
      const result = await f.write(next, "next", 3);
      expect(result.events).toContainEqual(expect.objectContaining({ outcome: "superseded", memoryType: "fact" }));
      expect((await f.active()).map((x: any) => x.content)).toEqual([next]);
      const durable = (await f.memory.exportMemory({ scope })).durable;
      const prior = durable.facts.find((x: any) => x.content === old);
      const current = durable.facts.find((x: any) => x.content === next);
      expect(prior).toMatchObject({ lifecycle: "superseded", isActive: false, supersededBy: current.id });
      expect(durable.sourceMessages.map((s: any) => s.content)).toEqual(expect.arrayContaining([old, next]));
      expect(durable.evidence).toContainEqual(expect.objectContaining({ kind: "correction_context", linkedMemoryIds: [prior.id, current.id], excerpt: next }));
    }));
    it("rejects multiple exact old targets instead of choosing one", () => run(async (f) => {
      await f.write(old, "old", 1);
      const original = (await f.active())[0];
      await f.documentStore.set("facts", "duplicate", { ...original, id: "duplicate" });
      const result = await f.write(next, "next", 3);
      expect(result.events).toContainEqual(expect.objectContaining({ outcome: "rejected", reason: "ambiguous_fact_correction" }));
      expect(await f.active()).toHaveLength(2);
    }));
    it("preserves context, subject and durable scope rather than using overlap", () => run(async (f) => {
      const chapter = "Project decision: For chapter one, my novel uses first-person narration.";
      const chapterNext = "Project decision: For chapter two, my novel now uses third-person narration instead of first-person narration.";
      await f.write(chapter, "chapter", 1);
      await f.write(chapterNext, "chapter-next", 2);
      await f.write(old, "old", 1);
      await f.write(next, "other-workspace", 3, { ...scope, workspaceId: "other" });
      expect((await f.active()).map((x: any) => x.content)).toEqual(expect.arrayContaining([chapter, chapterNext, old, next]));
    }));
    it("keeps nondirectional additions as independent current facts", () => run(async (f) => {
      await f.write(old, "old", 1);
      const other = "Project decision: My novel uses third-person narration.";
      await f.write(other, "other", 3);
      expect((await f.active()).map((x: any) => x.content).sort()).toEqual([old, other].sort());
    }));
    it("does not let an older correction supersede a newer author observation", () => run(async (f) => {
      await f.write(old, "old", 3);
      const result = await f.write(next, "next", 2);
      expect(result.accepted).toBe(0);
      expect((await f.active()).map((x: any) => x.content)).toEqual([old]);
    }));
    it("keeps late callbacks and stale backfill behind the final correction", () => run(async (f) => {
      await f.write(old, "old", 1);
      await f.write(next, "next", 3);
      await f.write("Project decision: My novel now uses second-person narration instead of first-person narration.", "late", 2);
      await f.write(old, "stale-new-source", 2);
      expect((await f.active()).map((x: any) => x.content)).toEqual([next]);
    }));
    it("supports explicit correction chains and explicit reverse direction, but rejects original-source replay", () => run(async (f) => {
      await f.write(old, "old", 1);
      await f.write(next, "next", 3);
      const final = "Project decision: My novel now uses second-person narration instead of third-person narration.";
      const reverse = "Project decision: My novel now uses first-person narration instead of second-person narration.";
      await f.write(final, "final", 4);
      await f.write(reverse, "reverse", 5);
      expect((await f.active()).map((x: any) => x.content)).toEqual([reverse]);
      const replay = await f.write(old, "old", 1);
      expect(replay.accepted).toBe(0);
      expect((await f.active()).map((x: any) => x.content)).toEqual([reverse]);
    }));
    it("leaves strictly later original-value reassertion as the separately unresolved coexistence behavior", () => run(async (f) => {
      await f.write(old, "old", 1);
      await f.write(next, "next", 3);
      await f.write(old, "later-new-source", 4);
      expect((await f.active()).map((x: any) => x.content).sort()).toEqual([old, next].sort());
    }));
    it("selective writeback gives a fresh memory context only the corrected value", () => run(async (f) => {
      const kit = createGoodMemoryRuntimeKit({ memory: f.memory });
      const writeback = { mode: "selective" as const, annotation: "durable_candidate" as const, policy: "allow" as const };
      await kit.afterModelCall({ scope, messages: [{ id: "old-chat", role: "user", content: old, observedAt: "2026-10-01T00:00:00Z" }], assistantText: "Okay.", writeback });
      await kit.afterModelCall({ scope, messages: [{ id: "new-chat", role: "user", content: next, observedAt: "2026-10-03T00:00:00Z" }], assistantText: "Okay.", writeback });
      const fresh = backend === "sqlite" ? createGoodMemory({ storage: f.storage }) : f.memory;
      const context = await createGoodMemoryRuntimeKit({ memory: fresh }).beforeModelCall({ scope: { ...scope, sessionId: "fresh" }, messages: [{ role: "user", content: "What narration does my novel currently use?" }] });
      expect(context.context.content).toContain(next);
      expect(context.context.content).not.toContain(old);
    }));
  });
