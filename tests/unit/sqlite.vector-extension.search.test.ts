import { describe, expect, it } from "bun:test";
import type { StorageFilter } from "../../src/storage/contracts";
import { createSQLiteVectorStore } from "../../src/storage/sqlite";
import {
  DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION,
  type SQLiteVectorExtensionConfig,
} from "../../src/storage/sqliteRuntime";

const extensionSqlSemanticsConfig: SQLiteVectorExtensionConfig = {
  backend: "sql-function",
  mode: "prefer",
  path: "/opt/sqlite/vss0.dylib",
  paths: ["/opt/sqlite/vss0.dylib"],
  // `max()` is built into SQLite, so it exercises the real SQL search branch
  // without requiring a vector extension in unit tests.
  searchFunction: "max",
};

function createStoreForExtensionSqlSemantics(
  mode: SQLiteVectorExtensionConfig["mode"] = "prefer",
) {
  return createSQLiteVectorStore(
    ":memory:",
    undefined,
    {
      loadVectorExtension() {},
      vectorExtensionConfig: {
        ...extensionSqlSemanticsConfig,
        mode,
      },
    },
  );
}

describe("sqlite vector extension search path", () => {
  it("falls back immediately when extension search is disabled", async () => {
    const calls: string[] = [];
    const store = createSQLiteVectorStore(
      ":memory:",
      undefined,
      {
        loadVectorExtension() {
          calls.push("load");
        },
        vectorExtensionConfig: {
          backend: "none",
          mode: "off",
          paths: [],
          searchFunction: DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION,
        },
      },
    );

    await store.upsert("facts", [
      {
        id: "fact-b",
        embedding: [1, 0, 0],
        metadata: { userId: "u-1" },
        content: "second",
      },
      {
        id: "fact-a",
        embedding: [1, 0, 0],
        metadata: { userId: "u-1" },
        content: "first",
      },
    ]);

    const results = await store.search("facts", [1, 0, 0], {
      topK: 2,
      filter: { userId: "u-1" },
    });

    expect(calls).toEqual([]);
    expect(results.map((record) => record.id)).toEqual(["fact-a", "fact-b"]);
  });

  it("uses the extension-backed search path when configured", async () => {
    const calls: Array<{
      collection: string;
      queryEmbedding: number[];
      topK: number;
    }> = [];
    const store = createSQLiteVectorStore(
      ":memory:",
      undefined,
      {
        loadVectorExtension() {},
        vectorExtensionConfig: {
          backend: "sql-function",
          mode: "prefer",
          path: "/opt/sqlite/vss0.dylib",
          paths: ["/opt/sqlite/vss0.dylib"],
          searchFunction: DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION,
        },
        runExtensionSearch(input) {
          calls.push({
            collection: input.collection,
            queryEmbedding: input.queryEmbedding,
            topK: input.topK,
          });
          return [
            {
              id: "fact-2",
              embedding: [1, 0, 0],
              metadata: { userId: "u-1" },
              content: "second",
              score: 10,
            },
          ];
        },
      },
    );

    await store.upsert("facts", [
      {
        id: "fact-1",
        embedding: [0, 1, 0],
        metadata: { userId: "u-1" },
        content: "first",
      },
      {
        id: "fact-2",
        embedding: [1, 0, 0],
        metadata: { userId: "u-1" },
        content: "second",
      },
    ]);

    const result = await store.search("facts", [1, 0, 0], {
      topK: 1,
      filter: { userId: "u-1" },
    });

    expect(calls).toEqual([
      {
        collection: "facts",
        queryEmbedding: [1, 0, 0],
        topK: 1,
      },
    ]);
    expect(result[0]?.id).toBe("fact-2");
    expect(result[0]?.score).toBe(10);
  });

  it("matches explicit null metadata values in the extension SQL path", async () => {
    const store = createStoreForExtensionSqlSemantics();

    await store.upsert("facts", [
      {
        id: "fact-1",
        embedding: [1, 0, 0],
        metadata: { userId: null },
        content: "first",
      },
      {
        id: "fact-2",
        embedding: [0, 1, 0],
        metadata: {},
        content: "second",
      },
    ]);

    const result = await store.search("facts", [1, 0, 0], {
      topK: 10,
      filter: { userId: null },
    });

    expect(result.map((record) => record.id)).toEqual(["fact-1"]);
  });

  it("treats filter keys as literal top-level metadata keys in the extension SQL path", async () => {
    const store = createStoreForExtensionSqlSemantics();

    await store.upsert("facts", [
      {
        id: "fact-1",
        embedding: [1, 0, 0],
        metadata: { "user.id": "u-1" },
        content: "first",
      },
      {
        id: "fact-2",
        embedding: [0, 1, 0],
        metadata: { user: { id: "u-1" } },
        content: "second",
      },
    ]);

    const result = await store.search("facts", [1, 0, 0], {
      topK: 10,
      filter: { "user.id": "u-1" },
    });

    expect(result.map((record) => record.id)).toEqual(["fact-1"]);
  });

  it("keeps boolean filters type-strict in the extension SQL path", async () => {
    const store = createStoreForExtensionSqlSemantics();

    await store.upsert("facts", [
      {
        id: "fact-1",
        embedding: [1, 0, 0],
        metadata: { pinned: true },
        content: "first",
      },
      {
        id: "fact-2",
        embedding: [0, 1, 0],
        metadata: { pinned: 1 },
        content: "second",
      },
    ]);

    const result = await store.search("facts", [1, 0, 0], {
      topK: 10,
      filter: { pinned: true },
    });

    expect(result.map((record) => record.id)).toEqual(["fact-1"]);
  });

  it("keeps numeric filters type-strict in the extension SQL path", async () => {
    const store = createStoreForExtensionSqlSemantics();

    await store.upsert("facts", [
      {
        id: "fact-1",
        embedding: [1, 0, 0],
        metadata: { priority: 1 },
        content: "first",
      },
      {
        id: "fact-2",
        embedding: [0, 1, 0],
        metadata: { priority: "1" },
        content: "second",
      },
    ]);

    const result = await store.search("facts", [1, 0, 0], {
      topK: 10,
      filter: { priority: 1 },
    });

    expect(result.map((record) => record.id)).toEqual(["fact-1"]);
  });

  it("throws in require mode when the extension SQL path cannot satisfy the filter shape", async () => {
    const store = createStoreForExtensionSqlSemantics("require");

    await store.upsert("facts", [
      {
        id: "fact-1",
        embedding: [1, 0, 0],
        metadata: { tags: ["a"] },
        content: "first",
      },
    ]);

    await expect(
      store.search("facts", [1, 0, 0], {
        topK: 10,
        filter: { tags: ["a"] } as unknown as StorageFilter,
      }),
    ).rejects.toThrow(
      "Failed to execute SQLite vector extension search for facts: SQLite vector extension search could not satisfy the current query without durable fallback.",
    );
  });

  it("falls back to durable SQLite search when extension-backed search fails in prefer mode", async () => {
    const store = createSQLiteVectorStore(
      ":memory:",
      undefined,
      {
        loadVectorExtension() {},
        vectorExtensionConfig: {
          backend: "sql-function",
          mode: "prefer",
          path: "/opt/sqlite/vss0.dylib",
          paths: ["/opt/sqlite/vss0.dylib"],
          searchFunction: DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION,
        },
        runExtensionSearch() {
          throw new Error("missing SQL function");
        },
      },
    );

    await store.upsert("facts", [
      {
        id: "fact-1",
        embedding: [0, 1, 0],
        metadata: { userId: "u-1" },
        content: "first",
      },
      {
        id: "fact-2",
        embedding: [1, 0, 0],
        metadata: { userId: "u-1" },
        content: "second",
      },
    ]);

    const result = await store.search("facts", [1, 0, 0], {
      topK: 1,
      filter: { userId: "u-1" },
    });

    expect(result[0]?.id).toBe("fact-2");
    expect(result[0]?.score).toBe(1);
  });

  it("throws when extension-backed search fails in require mode", async () => {
    const store = createSQLiteVectorStore(
      ":memory:",
      undefined,
      {
        loadVectorExtension() {},
        vectorExtensionConfig: {
          backend: "sql-function",
          mode: "require",
          path: "/opt/sqlite/vss0.dylib",
          paths: ["/opt/sqlite/vss0.dylib"],
          searchFunction: DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION,
        },
        runExtensionSearch() {
          throw new Error("missing SQL function");
        },
      },
    );

    await store.upsert("facts", [
      {
        id: "fact-1",
        embedding: [1, 0, 0],
        metadata: { userId: "u-1" },
        content: "first",
      },
    ]);

    await expect(
      store.search("facts", [1, 0, 0], {
        topK: 1,
        filter: { userId: "u-1" },
      }),
    ).rejects.toThrow("Failed to execute SQLite vector extension search");
  });
});
