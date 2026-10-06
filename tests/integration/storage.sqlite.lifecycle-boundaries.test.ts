import { expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createSQLiteDocumentStore, createSQLiteVectorStore } from "../../src/storage/sqlite";

async function fixture(run: (path: string) => Promise<void>) {
  const directory = mkdtempSync("/tmp/gm-storage-boundary-");
  try { await run(join(directory, "memory.sqlite")); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

it("removes stale full-text rows when a conditional write replaces searchable text with metadata", async () => {
  await fixture(async path => {
    const store = createSQLiteDocumentStore(path);
    const original = { userId: "author", text: "cobalt archive" };
    await store.set("facts", "target", original);
    expect((await store.searchText!("facts", { query: "cobalt", field: "text", limit: 10 })).map(row => row.id)).toEqual(["target"]);
    expect(await store.writeBatchIfUnchanged({ expected: { collection: "facts", id: "target", document: original },
      querySnapshots: [{ collection: "facts", filter: { userId: "author" }, documents: [original] }],
      set: [{ collection: "facts", id: "target", document: { userId: "author", status: "metadata-only" } }] })).toBe(true);
    expect(await store.get("facts", "target")).toEqual({ userId: "author", status: "metadata-only" });
    expect(await store.searchText!("facts", { query: "cobalt", field: "text", limit: 10 })).toEqual([]);
    const reader = new Database(path, { readonly: true });
    try {
      expect(reader.query("SELECT count(*) AS n FROM document_text_fts_keys WHERE collection='facts' AND id='target'").get()).toEqual({ n: 0 });
      expect(reader.query("SELECT count(*) AS n FROM document_text_fts WHERE collection='facts' AND id='target'").get()).toEqual({ n: 0 });
    } finally { reader.close(); }
  });
});

for (const key of ["scopeKey", "channel"]) {
  it(`distinguishes explicit JSON null from absence for ${key} in query, page, and full-text filters`, async () => {
    await fixture(async path => {
      const store = createSQLiteDocumentStore(path);
      await store.set("facts", "null", { id: "null", text: "cobalt", [key]: null });
      await store.set("facts", "absent", { id: "absent", text: "cobalt" });
      await store.set("facts", "value", { id: "value", text: "cobalt", [key]: "workspace" });
      const filter = { [key]: null };
      expect((await store.query<{ id: string }>("facts", filter)).map(row => row.id)).toEqual(["null"]);
      expect((await store.queryPage!("facts", { filter, limit: 10 })).items).toEqual([{ id: "null", text: "cobalt", [key]: null }]);
      expect((await store.searchText!("facts", { filter, query: "cobalt", field: "text", limit: 10 })).map(row => row.id)).toEqual(["null"]);
    });
  });
}

it("refuses an update of a missing document without changing its neighbor or search results", async () => {
  await fixture(async path => {
    const store = createSQLiteDocumentStore(path);
    await store.set("facts", "neighbor", { text: "cobalt" });
    await expect(store.update("facts", "absent", { text: "invented" })).rejects.toThrow("Document not found for update: facts/absent");
    expect(await store.get("facts", "absent")).toBeNull();
    expect(await store.get("facts", "neighbor")).toEqual({ text: "cobalt" });
    expect((await store.searchText!("facts", { query: "cobalt", field: "text", limit: 10 })).map(row => row.id)).toEqual(["neighbor"]);
  });
});

it("rolls back a failed schema migration, preserves legacy documents, and permits a clean retry", async () => {
  await fixture(async path => {
    const control = new Database(path);
    try {
      control.exec("CREATE TABLE documents(collection TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(collection,id)); CREATE TABLE document_store_schema(component TEXT PRIMARY KEY,version INTEGER NOT NULL); CREATE INDEX documents_collection_scope_key_idx ON documents(collection,id)");
      control.query("INSERT INTO documents VALUES (?,?,?)").run("facts", "original", JSON.stringify({ text: "cobalt", scopeKey: "public" }));
      control.exec("CREATE TRIGGER refuse_migration BEFORE INSERT ON document_store_schema BEGIN SELECT RAISE(ABORT,'fixture migration refusal'); END");
      expect(() => createSQLiteDocumentStore(path)).toThrow("fixture migration refusal");
      expect(control.query("SELECT json FROM documents WHERE id='original'").get()).toEqual({ json: JSON.stringify({ text: "cobalt", scopeKey: "public" }) });
      expect(control.query("SELECT count(*) AS n FROM document_store_schema").get()).toEqual({ n: 0 });
      expect(control.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE name='documents_collection_scope_key_idx'").get()!.sql).toContain("documents(collection,id)");
      control.exec("DROP TRIGGER refuse_migration");
      const recovered = createSQLiteDocumentStore(path);
      expect(await recovered.query("facts", { scopeKey: "public" })).toEqual([{ text: "cobalt", scopeKey: "public" }]);
      expect((await recovered.searchText!("facts", { query: "cobalt", field: "text", limit: 10 })).map(row => row.id)).toEqual(["original"]);
      await recovered.set("facts", "subsequent", { text: "after recovery" });
      expect(await recovered.get("facts", "subsequent")).toEqual({ text: "after recovery" });
    } finally { control.close(); }
  });
});

it("requires an available vector runtime instead of silently accepting an unavailable required backend", async () => {
  await fixture(async path => {
    expect(() => createSQLiteVectorStore(path, undefined, { runtimeResolution: {
      config: { vectorExtension: { backend: "none", mode: "require", paths: [], searchFunction: "vss_search" } },
      diagnostics: { available: false, backend: "none", effectiveMode: "off", requestedMode: "require", source: "unavailable", reason: "fixture vector runtime unavailable" },
    } })).toThrow("fixture vector runtime unavailable");
  });
});

it("reads a database without vectors as empty without creating vector tables", async () => {
  await fixture(async path => {
    const control = new Database(path);
    try {
      control.exec("CREATE TABLE existing_document(id TEXT PRIMARY KEY); INSERT INTO existing_document VALUES ('preserved')");
      const before = control.query("SELECT name FROM sqlite_master ORDER BY name").all();
      const store = createSQLiteVectorStore(path, { readOnly: true });
      expect(await store.get("facts", "absent")).toBeNull();
      expect(await store.search("facts", [1, 0], { topK: 1 })).toEqual([]);
      expect(await store.search("facts", [1, 0], { topK: 0 })).toEqual([]);
      expect(await store.search("facts", [], { topK: 1 })).toEqual([]);
      expect(control.query("SELECT name FROM sqlite_master ORDER BY name").all()).toEqual(before);
      expect(control.query("SELECT id FROM existing_document").all()).toEqual([{ id: "preserved" }]);
    } finally { control.close(); }
  });
});
