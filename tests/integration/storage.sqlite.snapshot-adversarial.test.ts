import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createSQLiteDocumentStore } from "../../src/storage/sqlite";

async function fixture(run: (f: any) => Promise<void>, factory = createSQLiteDocumentStore) {
  const dir = mkdtempSync("/tmp/gm-canonical-snapshot-");
  const path = join(dir, "memory.sqlite");
  const store = factory(path);
  const target = { userId: "author", text: "old searchable record", lifecycle: "active" };
  const source = { text: "original author source" };
  const evidence = { userId: "author", text: "original evidence" };
  await store.set("facts", "target", target);
  await store.set("sources", "source", source);
  await store.set("evidence", "original", evidence);
  const writer = new Database(path, { strict: true });
  writer.exec("PRAGMA busy_timeout=0");
  const put = (collection: string, id: string, document: object) => writer.query(
    "INSERT INTO documents(collection,id,json) VALUES(?1,?2,?3) ON CONFLICT(collection,id) DO UPDATE SET json=excluded.json",
  ).run(collection, id, JSON.stringify(document));
  const batch = (hook: () => void) => ({
    querySnapshots: [
      { collection: "facts", filter: { userId: "author" }, documents: [{ toJSON() { hook(); return target; } }] },
      { collection: "evidence", filter: { userId: "author" }, documents: [evidence] },
    ],
    expected: { collection: "facts", id: "target", document: target },
    unchanged: [{ collection: "sources", id: "source", document: source }],
    set: [
      { collection: "facts", id: "target", document: { ...target, lifecycle: "superseded" } },
      { collection: "facts", id: "replacement", document: { userId: "author", text: "replacement search token" } },
      { collection: "evidence", id: "new", document: { userId: "author", text: "new evidence" } },
    ],
    delete: [{ collection: "sources", id: "source" }],
  });
  try { await run({ store, writer, put, batch, target, source, evidence }); }
  finally { writer.close(); rmSync(dir, { recursive: true, force: true }); }
}

for (const mode of ["evidence-phantom", "evidence-update", "evidence-leaves-filter", "point-source-update", "absent-point-created", "delete-only-phantom"]) {
  test(`complete revalidation rejects ${mode} and leaves no partial mutation`, async () => {
    await fixture(async ({ store, writer, put, batch, target, source }: any) => {
      let reads = 0;
      const input = batch(() => {
        if (++reads !== 1) return;
        if (mode.includes("phantom")) put("evidence", "phantom", { userId: "author", text: "concurrent evidence" });
        if (mode === "evidence-update") put("evidence", "original", { userId: "author", text: "changed evidence" });
        if (mode === "evidence-leaves-filter") put("evidence", "original", { userId: "other", text: "same id, different filter" });
        if (mode === "point-source-update") put("sources", "source", { text: "concurrently changed source" });
        if (mode === "absent-point-created") put("sources", "absent", { text: "new guarded source" });
      });
      if (mode === "absent-point-created") input.unchanged.push({ collection: "sources", id: "absent", document: null });
      if (mode === "delete-only-phantom") input.set = [];
      expect(await store.writeBatchIfUnchanged(input)).toBe(false);
      expect(reads).toBe(2);
      expect(await store.get("facts", "target")).toEqual(target);
      expect(await store.get("facts", "replacement")).toBeNull();
      expect(await store.get("evidence", "new")).toBeNull();
      if (mode !== "point-source-update") expect(await store.get("sources", "source")).toEqual(source);
      expect(writer.query("SELECT count(*) AS n FROM document_text_fts WHERE id='replacement'").get()).toEqual({ n: 0 });
    });
  });
}

test("a query with initially zero matching rows rejects a concurrent phantom", async () => {
  await fixture(async ({ store, put, batch }: any) => {
    let reads = 0;
    const input = batch(() => { if (++reads === 1) put("empty", "phantom", { userId: "author" }); });
    input.querySnapshots.push({ collection: "empty", filter: { userId: "author" }, documents: [] });
    expect(await store.writeBatchIfUnchanged(input)).toBe(false);
    expect(await store.get("facts", "replacement")).toBeNull();
    expect(await store.get("empty", "phantom")).toEqual({ userId: "author" });
  });
});

test("unrelated writer succeeds during validation and full retried batch commits once", async () => {
  await fixture(async ({ store, put, batch }: any) => {
    let reads = 0;
    const input = batch(() => { if (++reads === 1) put("facts", "other", { userId: "other", text: "independent write" }); });
    expect(await store.writeBatchIfUnchanged(input)).toBe(true);
    expect(reads).toBe(2);
    expect((await store.get("facts", "target")).lifecycle).toBe("superseded");
    expect(await store.get("facts", "other")).toEqual({ userId: "other", text: "independent write" });
    expect(await store.get("sources", "source")).toBeNull();
    expect(await store.searchText("facts", { field: "text", query: "replacement", limit: 10 })).toHaveLength(1);
  });
});

test("a protected mutation in the second attempt is not accepted after an unrelated first conflict", async () => {
  await fixture(async ({ store, put, batch, target }: any) => {
    let reads = 0;
    const input = batch(() => {
      if (++reads === 1) put("facts", "other", { userId: "other", text: "other" });
      else put("evidence", "late", { userId: "author", text: "late authority" });
    });
    expect(await store.writeBatchIfUnchanged(input)).toBe(false);
    expect(reads).toBe(2);
    expect(await store.get("facts", "target")).toEqual(target);
    expect(await store.get("evidence", "late")).not.toBeNull();
    expect(await store.get("facts", "replacement")).toBeNull();
  });
});

test("ordinary SQLITE_BUSY returns false without a second snapshot attempt and releases the reader", async () => {
  await fixture(async ({ store, writer, batch, target }: any) => {
    let reads = 0;
    writer.exec("BEGIN IMMEDIATE");
    const started = performance.now();
    try {
      expect(await store.writeBatchIfUnchanged(batch(() => { reads++; }))).toBe(false);
      expect(reads).toBe(1);
      expect(performance.now() - started).toBeLessThan(1500);
      expect(await store.get("facts", "target")).toEqual(target);
    } finally { writer.exec("ROLLBACK"); }
    expect(await store.writeBatchIfUnchanged(batch(() => {}))).toBe(true);
  });
});

test("later SQL failure rolls back documents, search projection, and deletes and preserves the error", async () => {
  await fixture(async ({ store, writer, batch, target, source }: any) => {
    writer.exec("CREATE TRIGGER reject_new_evidence BEFORE INSERT ON documents WHEN NEW.collection='evidence' AND NEW.id='new' BEGIN SELECT RAISE(ABORT,'independent deliberate failure'); END");
    await expect(store.writeBatchIfUnchanged(batch(() => {}))).rejects.toThrow("independent deliberate failure");
    expect(await store.get("facts", "target")).toEqual(target);
    expect(await store.get("facts", "replacement")).toBeNull();
    expect(await store.get("sources", "source")).toEqual(source);
    expect(writer.query("SELECT count(*) AS n FROM document_text_fts WHERE id='replacement'").get()).toEqual({ n: 0 });
    writer.exec("DROP TRIGGER reject_new_evidence");
    expect(await store.writeBatchIfUnchanged(batch(() => {}))).toBe(true);
  });
});

test("batches without query snapshots retain immediate writer admission", async () => {
  await fixture(async ({ store, put, batch }: any) => {
    let writerCode: string | undefined;
    const input = batch(() => {});
    delete input.querySnapshots;
    const target = input.expected.document;
    input.expected.document = { toJSON() {
      try { put("facts", "other", { userId: "other" }); }
      catch (error: any) { writerCode = error.code; }
      return target;
    } };
    expect(await store.writeBatchIfUnchanged(input)).toBe(true);
    expect(writerCode).toBe("SQLITE_BUSY");
  });
});

