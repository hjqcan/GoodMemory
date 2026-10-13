import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createSQLiteDocumentStore } from "../../src/storage/sqlite";

async function checkConcurrentJson(json: string | Uint8Array, rollback = false) {
  const directory = mkdtempSync("/tmp/gm-anomalous-fence-");
  const path = join(directory, "memory.sqlite");
  const store = createSQLiteDocumentStore(path);
  const writer = new Database(path, { strict: true });
  const target = { userId: "author", value: "original" };
  try {
    await store.set("facts", "target", target);
    await store.set("anchor", "anchor", { stable: true });
    let injected = false;
    const result = await store.writeBatchIfUnchanged({
      expected: { collection: "output", id: "output", document: null },
      querySnapshots: [
        { collection: "facts", filter: { userId: "author" }, documents: [target] },
        { collection: "anchor", documents: [{ toJSON() {
          if (!injected) {
            injected = true;
            if (rollback) writer.exec("BEGIN IMMEDIATE");
            writer.query("INSERT INTO documents(collection,id,json) VALUES('facts','phantom',?1)").run(json);
            if (rollback) writer.exec("ROLLBACK");
          }
          return { stable: true };
        } }] },
      ],
      set: [{ collection: "output", id: "output", document: { accepted: true } }],
    });
    expect(injected).toBe(true);
    expect(await store.get("output", "output")).toEqual(result ? { accepted: true } : null);
    return result;
  } finally {
    writer.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const [name, json] of [
  ["duplicate scope key", '{"userId":"other","userId":"author","value":"phantom"}'],
  ["escaped duplicate scope key", '{"userId":"other","\\u0075serId":"author","value":"phantom"}'],
  ["invalid JSON", "not JSON"],
  ["null document", "null"],
  ["BLOB-encoded JSON", new TextEncoder().encode('{"userId":"other","value":"phantom"}')],
] as const) {
  test(`query proof refuses concurrent ${name}`, async () => {
    expect(await checkConcurrentJson(json)).toBe(false);
  });
  test(`rolled-back ${name} does not invalidate query proof`, async () => {
    expect(await checkConcurrentJson(json, true)).toBe(true);
  });
}

function createVersionOneFixture(writer: Database) {
  writer.exec(`
    CREATE TABLE documents(collection TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(collection,id));
    CREATE TABLE document_store_schema(component TEXT PRIMARY KEY,version INTEGER NOT NULL);
    INSERT INTO document_store_schema VALUES('query_scope_fences_v1',1);
    CREATE TABLE document_query_fences(collection TEXT NOT NULL,fence_key TEXT NOT NULL,generation INTEGER NOT NULL,
      PRIMARY KEY(collection,fence_key));
    INSERT INTO document_query_fences VALUES('facts','[1,"text","author"]',7);
    INSERT INTO documents VALUES('facts','target','{"userId":"author","value":"original"}');
    CREATE TRIGGER document_query_fences_before_insert BEFORE INSERT ON documents BEGIN SELECT 1; END;
    CREATE TRIGGER document_query_fences_after_insert AFTER INSERT ON documents BEGIN SELECT 1; END;
    CREATE TRIGGER document_query_fences_after_update AFTER UPDATE ON documents BEGIN SELECT 1; END;
    CREATE TRIGGER document_query_fences_after_delete AFTER DELETE ON documents BEGIN SELECT 1; END;
  `);
}

test("anomaly fence migration preserves counters and upgrades an already prepared raw writer", async () => {
  const directory = mkdtempSync("/tmp/gm-anomaly-migration-");
  const path = join(directory, "memory.sqlite");
  const writer = new Database(path, { strict: true });
  try {
    createVersionOneFixture(writer);
    const prepared = writer.query("INSERT INTO documents VALUES('facts','phantom',?1)");
    const store = createSQLiteDocumentStore(path);
    expect(writer.query("SELECT generation FROM document_query_fences WHERE fence_key='[1,\"text\",\"author\"]'").get())
      .toEqual({ generation: 7 });
    expect(writer.query("SELECT version FROM document_store_schema WHERE component='query_scope_fences_v1'").get())
      .toEqual({ version: 2 });
    prepared.run('{"userId":"other","userId":"author"}');
    expect(writer.query("SELECT generation FROM document_query_fences WHERE fence_key='[\"anomalous-json\"]'").get())
      .toEqual({ generation: 1 });
    expect(await store.get("facts", "target")).toEqual({ userId: "author", value: "original" });
  } finally {
    writer.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed trigger replacement rolls back before a successful retry", () => {
  const directory = mkdtempSync("/tmp/gm-anomaly-migration-fault-");
  const path = join(directory, "memory.sqlite");
  const writer = new Database(path, { strict: true });
  const originalExec = Database.prototype.exec;
  try {
    createVersionOneFixture(writer);
    const triggers = () => writer.query("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
    const previousTriggers = triggers();
    Database.prototype.exec = function(sql: string) {
      if (sql.includes("DROP TRIGGER IF EXISTS document_query_fences_before_insert")) {
        originalExec.call(this, sql.slice(0, sql.indexOf("CREATE TRIGGER")));
        throw new Error("injected anomaly migration failure");
      }
      return originalExec.call(this, sql);
    };
    expect(() => createSQLiteDocumentStore(path)).toThrow("injected anomaly migration failure");
    Database.prototype.exec = originalExec;
    expect(triggers()).toEqual(previousTriggers);
    expect(writer.query("SELECT version FROM document_store_schema WHERE component='query_scope_fences_v1'").get())
      .toEqual({ version: 1 });
    expect(writer.query("SELECT generation FROM document_query_fences").all()).toEqual([{ generation: 7 }]);
    expect(() => createSQLiteDocumentStore(path)).not.toThrow();
    expect(writer.query("SELECT version FROM document_store_schema WHERE component='query_scope_fences_v1'").get())
      .toEqual({ version: 2 });
  } finally {
    Database.prototype.exec = originalExec;
    writer.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const [name, json] of [
  ["ordinary unrelated scope", '{"userId":"other","value":"phantom"}'],
  ["nested scope duplicates", '{"userId":"other","payload":{"userId":"other","userId":"author"}}'],
  ["ordinary-property duplicates", '{"userId":"other","value":"first","value":"last"}'],
  ["missing scope", '{"value":"phantom"}'],
  ["null scope value", '{"userId":null,"value":"phantom"}'],
] as const) {
  test(`${name} preserves independent scope progress`, async () => {
    expect(await checkConcurrentJson(json)).toBe(true);
  });
}
