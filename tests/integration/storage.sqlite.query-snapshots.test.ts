import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSQLiteDocumentStore } from "../../src/storage/sqlite";

describe("SQLite query snapshot writer concurrency", () => {
  it.each(["insert", "update", "delete"])(
    "lets another connection %s during validation and rejects the obsolete write",
    async mutation => {
      const directory = await mkdtemp(join(tmpdir(), "goodmemory-snapshot-concurrency-"));
      const path = join(directory, "memory.sqlite");
      const store = createSQLiteDocumentStore(path);
      const target = { userId: "author", content: "original" };
      await store.set("facts", "target", target);
      await store.set("sources", "source", { content: "author source" });
      const writer = new Database(path, { strict: true });
      // This asserts immediate writer availability, rather than increasing a wait budget.
      writer.exec("PRAGMA busy_timeout=0");
      let injected = false;
      let writerFailure: unknown;
      const observed = {
        toJSON() {
          if (!injected) {
            injected = true;
            try {
              if (mutation === "insert") {
                writer.query("INSERT INTO documents(collection,id,json) VALUES (?1,?2,?3)")
                  .run("facts", "independent", JSON.stringify({ userId: "author", content: "other" }));
              } else if (mutation === "update") {
                writer.query("UPDATE documents SET json=?1 WHERE collection='facts' AND id='target'")
                  .run(JSON.stringify({ ...target, content: "changed by another writer" }));
              } else {
                writer.exec("DELETE FROM documents WHERE collection='sources' AND id='source'");
              }
            } catch (error) {
              writerFailure = error;
            }
          }
          return target;
        },
      };
      try {
        const committed = await store.writeBatchIfUnchanged({
          querySnapshots: [{ collection: "facts", filter: { userId: "author" }, documents: [observed] }],
          expected: { collection: "facts", id: "target", document: target },
          unchanged: [{ collection: "sources", id: "source", document: { content: "author source" } }],
          set: [
            { collection: "facts", id: "target", document: { ...target, content: "retired" } },
            { collection: "facts", id: "replacement", document: { userId: "author", content: "replacement" } },
            { collection: "evidence", id: "new", document: { content: "replacement evidence" } },
          ],
        });
        expect(injected).toBe(true);
        expect(writerFailure).toBeUndefined();
        expect(committed).toBe(false);
        expect(await store.get("facts", "replacement")).toBeNull();
        expect(await store.get("evidence", "new")).toBeNull();
        expect(await store.get("facts", "target")).toEqual(mutation === "update"
          ? { ...target, content: "changed by another writer" } : target);
        expect(await store.get("facts", "independent")).toEqual(mutation === "insert"
          ? { userId: "author", content: "other" } : null);
        expect(await store.get("sources", "source")).toEqual(mutation === "delete"
          ? null : { content: "author source" });
        // A refused upgrade must release its read transaction.
        await store.set("facts", "subsequent", { content: "after refusal" });
        expect(await store.get("facts", "subsequent")).toEqual({ content: "after refusal" });
      } finally {
        writer.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("revalidates an obsolete snapshot once when only another scope changed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "goodmemory-snapshot-independent-"));
    const path = join(directory, "memory.sqlite");
    const store = createSQLiteDocumentStore(path);
    const target = { userId: "author", content: "original" };
    await store.set("facts", "target", target);
    const writer = new Database(path, { strict: true });
    writer.exec("PRAGMA busy_timeout=0");
    let injected = false;
    const observed = {
      toJSON() {
        if (!injected) {
          injected = true;
          writer.query("INSERT INTO documents(collection,id,json) VALUES (?1,?2,?3)")
            .run("facts", "other-scope", JSON.stringify({ userId: "independent", content: "other" }));
        }
        return target;
      },
    };
    try {
      expect(await store.writeBatchIfUnchanged({
        querySnapshots: [{ collection: "facts", filter: { userId: "author" }, documents: [observed] }],
        expected: { collection: "facts", id: "target", document: target },
        set: [{ collection: "facts", id: "target", document: { ...target, content: "replacement" } }],
      })).toBe(true);
      expect(await store.get("facts", "target")).toEqual({ ...target, content: "replacement" });
      expect(await store.get("facts", "other-scope")).toEqual({ userId: "independent", content: "other" });
    } finally {
      writer.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("bounds revalidation while retaining both independent writers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "goodmemory-snapshot-revalidation-"));
    const path = join(directory, "memory.sqlite");
    const store = createSQLiteDocumentStore(path);
    const target = { userId: "author", content: "original" };
    await store.set("facts", "target", target);
    const writer = new Database(path, { strict: true });
    writer.exec("PRAGMA busy_timeout=0");
    let writes = 0;
    const observed = {
      toJSON() {
        writer.query("INSERT INTO documents(collection,id,json) VALUES (?1,?2,?3)")
          .run("facts", "other-" + ++writes, JSON.stringify({ userId: "independent", content: "other" }));
        return target;
      },
    };
    try {
      expect(await store.writeBatchIfUnchanged({
        querySnapshots: [{ collection: "facts", filter: { userId: "author" }, documents: [observed] }],
        expected: { collection: "facts", id: "target", document: target },
        set: [{ collection: "facts", id: "target", document: { ...target, content: "replacement" } }],
      })).toBe(false);
      expect(writes).toBe(2);
      expect(await store.get("facts", "target")).toEqual(target);
      expect(await store.query("facts", { userId: "independent" })).toHaveLength(2);
      await store.set("facts", "subsequent", { content: "after refusal" });
      expect(await store.get("facts", "subsequent")).toEqual({ content: "after refusal" });
    } finally {
      writer.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves exact snapshot multiplicity and scalar filter equality", async () => {
    const store = createSQLiteDocumentStore(":memory:");
    const first = { userId: "u", enabled: true, optional: null };
    await store.set("facts", "a", first);
    await store.set("facts", "b", first);
    await store.set("facts", "numeric", { ...first, enabled: 1 });
    const batch = {
      expected: { collection: "facts", id: "a", document: first },
      set: [{ collection: "facts", id: "next", document: { content: "next" } }],
    };
    expect(await store.writeBatchIfUnchanged({ ...batch, querySnapshots: [
      { collection: "facts", filter: { enabled: true, optional: null }, documents: [first] },
    ] })).toBe(false);
    expect(await store.get("facts", "next")).toBeNull();
    expect(await store.writeBatchIfUnchanged({ ...batch, querySnapshots: [
      { collection: "facts", filter: { enabled: true, optional: null }, documents: [first, first] },
    ] })).toBe(true);
    expect(await store.get("facts", "next")).toEqual({ content: "next" });
  });
});
