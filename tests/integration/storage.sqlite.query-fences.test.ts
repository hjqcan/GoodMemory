import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createSQLiteDocumentStore } from "../../src/storage/sqlite";
import type { StorageDocument, StorageFilter } from "../../src/storage/contracts";

async function fixture(run: (f: {
  store: ReturnType<typeof createSQLiteDocumentStore>;
  writer: Database;
  guard: (filter: StorageFilter, mutate: () => void) => Promise<boolean>;
  put: (id: string, document: StorageDocument) => void;
}) => Promise<void>) {
  const directory = mkdtempSync("/tmp/gm-query-fences-");
  const path = join(directory, "memory.sqlite");
  // Open before migration: persisted triggers must also cover old raw writers.
  const writer = new Database(path, { strict: true });
  writer.exec("PRAGMA journal_mode=WAL; PRAGMA recursive_triggers=OFF");
  const store = createSQLiteDocumentStore(path);
  const put = (id: string, document: StorageDocument) => {
    writer.query("INSERT OR REPLACE INTO documents(collection,id,json) VALUES('facts',?1,?2)")
      .run(id, JSON.stringify(document));
  };
  const guard = async (filter: StorageFilter, mutate: () => void) => {
    const documents = await store.query("facts", filter);
    const anchor = { text: "stable" };
    await store.set("anchor", "anchor", anchor);
    let invoked = false;
    const result = await store.writeBatchIfUnchanged({
      expected: { collection: "output", id: "output", document: null },
      querySnapshots: [
        { collection: "facts", filter, documents },
        { collection: "anchor", documents: [{ toJSON() {
          if (!invoked) { invoked = true; mutate(); }
          return anchor;
        } }] },
      ],
      set: [{ collection: "output", id: "output", document: { accepted: true } }],
    });
    expect(invoked).toBe(true);
    expect(await store.get("output", "output")).toEqual(result ? { accepted: true } : null);
    return result;
  };
  try { await run({ store, writer, guard, put }); }
  finally { writer.close(); rmSync(directory, { recursive: true, force: true }); }
}

const scope = { userId: "number", tenantId: 'escaped"\\tenant', workspaceId: 1, agentId: true };
const fields = Object.keys(scope) as Array<keyof typeof scope>;
for (let mask = 0; mask < 16; mask++) {
  test(`all scope subsets fence relevant REPLACE mutations (mask ${mask})`, async () => {
    await fixture(async ({ store, guard, put }) => {
      const filter = Object.fromEntries(fields.filter((_, i) => mask & (1 << i)).map(key => [key, scope[key]]));
      await store.set("facts", "original", { ...scope, value: "original" });
      expect(await guard(filter, () => put("original", { ...scope, value: "changed" }))).toBe(false);
    });
  });
}

for (const value of [null, true, false, 0, -0, 1, 1.5, 1e21, 1e-7, "number", "true", 'quote"\\\u0000']) {
  test(`scope encoding binds scalar ${JSON.stringify(value)}`, async () => {
    await fixture(async ({ store, guard, put }) => {
      await store.set("facts", "original", { userId: "author", workspaceId: value, version: 1 });
      expect(await guard({ userId: "author", workspaceId: value }, () => {
        put("original", { userId: "author", workspaceId: value, version: 2 });
      })).toBe(false);
    });
  });
}

for (const [filterValue, other] of [[null, undefined], [true, 1], [false, 0], [1, "1"]] as const) {
  test(`unrelated typed scalar ${JSON.stringify(other)} does not invalidate ${JSON.stringify(filterValue)}`, async () => {
    await fixture(async ({ store, guard, put }) => {
      await store.set("facts", "original", { userId: "author", workspaceId: filterValue });
      expect(await guard({ userId: "author", workspaceId: filterValue }, () => {
        put("other", { userId: "author", ...(other !== undefined ? { workspaceId: other } : {}) });
      })).toBe(true);
    });
  });
}

test("committed ABA invalidates a snapshot; rolled-back changes do not", async () => {
  for (const rollback of [false, true]) {
    await fixture(async ({ store, writer, guard, put }) => {
      const original = { userId: "author", value: "original" };
      await store.set("facts", "original", original);
      expect(await guard({ userId: "author" }, () => {
        if (rollback) writer.exec("BEGIN IMMEDIATE");
        put("original", { ...original, value: "changed" });
        put("original", original);
        if (rollback) writer.exec("ROLLBACK");
      })).toBe(rollback);
    });
  }
});

test("invalid legacy JSON can be deleted after fence migration", async () => {
  const directory = mkdtempSync("/tmp/gm-legacy-query-fences-");
  const path = join(directory, "memory.sqlite");
  const writer = new Database(path, { strict: true });
  try {
    writer.exec("CREATE TABLE documents(collection TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(collection,id)); INSERT INTO documents VALUES('facts','corrupt','invalid JSON')");
    createSQLiteDocumentStore(path);
    expect(() => writer.exec("DELETE FROM documents WHERE id='corrupt'")).not.toThrow();
    expect(writer.query("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 0 });
  } finally { writer.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("read-only legacy databases do not advertise query-write fencing", async () => {
  const directory = mkdtempSync("/tmp/gm-readonly-query-fences-");
  const path = join(directory, "memory.sqlite");
  const writer = new Database(path, { strict: true });
  try {
    writer.exec("CREATE TABLE documents(collection TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(collection,id))");
    const store = createSQLiteDocumentStore(path, { readOnly: true });
    expect(store.querySnapshotBatchSemantics).toBeUndefined();
    expect(writer.query("SELECT name FROM sqlite_master WHERE name='document_query_fences'").get()).toBeNull();
  } finally { writer.close(); rmSync(directory, { recursive: true, force: true }); }
});
