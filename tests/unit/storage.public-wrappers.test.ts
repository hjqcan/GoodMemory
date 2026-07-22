import { afterEach, describe, expect, it } from "bun:test";
import type {
  DocumentQueryPage,
  DocumentQueryPageInput,
  DocumentStore,
  DocumentTextSearchInput,
  DocumentTextSearchResult,
  SessionStore,
  StorageFilter,
  VectorRecord,
  VectorSearchInput,
  VectorSearchResult,
  VectorStore,
} from "../../src/storage/contracts";
import {
  canBootstrapPostgresStorageBackend,
  createPostgresDocumentStore,
  createPostgresSessionStore,
  createPostgresVectorStore,
  migratePostgresStorageBackend,
  setPostgresPublicModuleLoaderForTests,
} from "../../src/storage/postgresPublic";
import {
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
  createSQLiteVectorStore,
  setSQLitePublicModuleLoaderForTests,
} from "../../src/storage/sqlitePublic";

const scope = {
  userId: "user-1",
  workspaceId: "workspace-1",
  sessionId: "session-1",
};

const buffer = {
  sessionId: "session-1",
  userId: "user-1",
  messages: [],
  summary: "summary",
  summaryUpToIndex: 1,
  createdAt: "2026-04-22T00:00:00.000Z",
  lastActiveAt: "2026-04-22T00:00:01.000Z",
};

const workingMemory = {
  sessionId: "session-1",
  userId: "user-1",
  currentGoal: "ship the package boundary",
  openLoops: ["close CI"],
  updatedAt: "2026-04-22T00:00:02.000Z",
};

const journal = {
  sessionId: "session-1",
  userId: "user-1",
  worklog: ["checked wrapper delegation"],
  updatedAt: "2026-04-22T00:00:03.000Z",
};

const vectorRecord: VectorRecord = {
  id: "vec-1",
  embedding: [0.1, 0.2, 0.3],
  metadata: {
    topic: "package-boundary",
  },
  content: "wrapper coverage",
};

const vectorSearchInput: VectorSearchInput = {
  topK: 3,
  filter: {
    topic: "package-boundary",
  },
};

const vectorSearchResults: VectorSearchResult[] = [
  {
    ...vectorRecord,
    score: 0.98,
  },
];

afterEach(() => {
  setPostgresPublicModuleLoaderForTests(null);
  setSQLitePublicModuleLoaderForTests(null);
});

function createTrackedDocumentStore(log: string[]): DocumentStore {
  return {
    async set(collection, id, document) {
      log.push(`document.set:${collection}:${id}:${JSON.stringify(document)}`);
    },

    async get<TDocument extends object>(
      collection: string,
      id: string,
    ): Promise<TDocument | null> {
      log.push(`document.get:${collection}:${id}`);
      return {
        id,
        collection,
      } as unknown as TDocument;
    },

    async update(collection, id, patch) {
      log.push(`document.update:${collection}:${id}:${JSON.stringify(patch)}`);
    },

    async query<TDocument extends object>(
      collection: string,
      filter?: StorageFilter,
    ): Promise<TDocument[]> {
      log.push(`document.query:${collection}:${JSON.stringify(filter ?? null)}`);
      return [
        {
          collection,
          filter: filter ?? null,
        },
      ] as unknown as TDocument[];
    },

    async queryPage<TDocument extends object>(
      collection: string,
      input: DocumentQueryPageInput,
    ): Promise<DocumentQueryPage<TDocument>> {
      log.push(`document.queryPage:${collection}:${JSON.stringify(input)}`);
      return {
        items: [],
        nextCursor: "cursor-1",
      };
    },

    async searchText<TDocument extends object>(
      collection: string,
      input: DocumentTextSearchInput,
    ): Promise<DocumentTextSearchResult<TDocument>[]> {
      log.push(`document.searchText:${collection}:${JSON.stringify(input)}`);
      return [];
    },

    async writeBatchIfUnchanged(input) {
      log.push(
        `document.writeBatchIfUnchanged:${input.expected.collection}:${input.expected.id}:${input.set.length}`,
      );
      return true;
    },

    async delete(collection, id) {
      log.push(`document.delete:${collection}:${id}`);
    },
  };
}

function createTrackedSessionStore(log: string[]): SessionStore {
  return {
    async saveBuffer(nextScope, nextBuffer) {
      log.push(`session.saveBuffer:${nextScope.sessionId}:${nextBuffer.summary}`);
    },

    async saveBufferIfUnchanged(nextScope, expectedBuffer, nextBuffer) {
      log.push(
        `session.saveBufferIfUnchanged:${nextScope.sessionId}:${expectedBuffer?.summary ?? "null"}:${nextBuffer.summary}`,
      );
      return true;
    },

    async getBuffer(nextScope) {
      log.push(`session.getBuffer:${nextScope.sessionId}`);
      return buffer;
    },

    async deleteBufferIfUnchanged(nextScope, expectedBuffer) {
      log.push(
        `session.deleteBufferIfUnchanged:${nextScope.sessionId}:${expectedBuffer.summary}`,
      );
      return true;
    },

    async deleteBuffersByScope(nextScope) {
      log.push(`session.deleteBuffersByScope:${nextScope.sessionId}`);
      return 1;
    },

    async saveWorkingMemory(nextScope, snapshot) {
      log.push(
        `session.saveWorkingMemory:${nextScope.sessionId}:${snapshot.currentGoal ?? ""}`,
      );
    },

    async getWorkingMemory(nextScope) {
      log.push(`session.getWorkingMemory:${nextScope.sessionId}`);
      return workingMemory;
    },

    async deleteWorkingMemoryByScope(nextScope) {
      log.push(`session.deleteWorkingMemoryByScope:${nextScope.sessionId}`);
      return 2;
    },

    async saveJournal(nextScope, nextJournal) {
      log.push(`session.saveJournal:${nextScope.sessionId}:${nextJournal.worklog.length}`);
    },

    async getJournal(nextScope) {
      log.push(`session.getJournal:${nextScope.sessionId}`);
      return journal;
    },

    async deleteJournalsByScope(nextScope) {
      log.push(`session.deleteJournalsByScope:${nextScope.sessionId}`);
      return 3;
    },
  };
}

function createTrackedVectorStore(log: string[]): VectorStore {
  return {
    async upsert(collection, records) {
      log.push(`vector.upsert:${collection}:${records.length}`);
    },

    async get(collection, id) {
      log.push(`vector.get:${collection}:${id}`);
      return vectorRecord;
    },

    async search(collection, queryEmbedding, input) {
      log.push(
        `vector.search:${collection}:${queryEmbedding.join(",")}:${JSON.stringify(input)}`,
      );
      return vectorSearchResults;
    },

    async delete(collection, id) {
      log.push(`vector.delete:${collection}:${id}`);
    },
  };
}

describe("public storage wrappers", () => {
  it("delegates every sqlite wrapper method through the lazily loaded module", async () => {
    const log: string[] = [];
    let loaderCalls = 0;

    setSQLitePublicModuleLoaderForTests(async () => {
      loaderCalls += 1;

      return {
        createSQLiteDocumentStore(path, options) {
          log.push(`createSQLiteDocumentStore:${path}:${String(options?.readOnly ?? false)}`);
          return createTrackedDocumentStore(log);
        },
        createSQLiteSessionStore(path, options) {
          log.push(`createSQLiteSessionStore:${path}:${String(options?.readOnly ?? false)}`);
          return createTrackedSessionStore(log);
        },
        createSQLiteVectorStore(path, options, dependencies) {
          log.push(
            `createSQLiteVectorStore:${path}:${String(options?.readOnly ?? false)}:${String(Boolean(dependencies))}`,
          );
          return createTrackedVectorStore(log);
        },
      };
    });

    const documentStore = createSQLiteDocumentStore("/tmp/test.sqlite", {
      readOnly: true,
    });
    const sessionStore = createSQLiteSessionStore("/tmp/test.sqlite");
    const vectorStore = createSQLiteVectorStore(
      "/tmp/test.sqlite",
      undefined,
      {
        vectorExtensionConfig: {
          mode: "vss",
        },
      },
    );

    await documentStore.set("facts", "fact-1", {
      title: "wrapper coverage",
    });
    expect(await documentStore.get("facts", "fact-1")).toEqual({
      id: "fact-1",
      collection: "facts",
    });
    await documentStore.update("facts", "fact-1", {
      title: "updated",
    });
    expect(
      await documentStore.query("facts", {
        status: "active",
      } satisfies StorageFilter),
    ).toEqual([
      {
        collection: "facts",
        filter: {
          status: "active",
        },
      },
    ]);
    expect(
      await documentStore.queryPage!("facts", {
        filter: { status: "active" },
        limit: 2,
      }),
    ).toEqual({
      items: [],
      nextCursor: "cursor-1",
    });
    expect(
      await documentStore.searchText!("facts", {
        field: "searchText",
        filter: { status: "active" },
        limit: 2,
        query: "wrapper",
      }),
    ).toEqual([]);
    expect(
      await documentStore.writeBatchIfUnchanged!({
        expected: {
          collection: "facts",
          id: "fact-1",
          document: { title: "updated" },
        },
        set: [
          {
            collection: "facts",
            id: "fact-1",
            document: { title: "batch-updated" },
          },
        ],
      }),
    ).toBe(true);
    await documentStore.delete("facts", "fact-1");

    await sessionStore.saveBuffer(scope, buffer);
    expect(await sessionStore.saveBufferIfUnchanged(scope, buffer, buffer)).toBe(true);
    expect(await sessionStore.getBuffer(scope)).toEqual(buffer);
    expect(await sessionStore.deleteBufferIfUnchanged(scope, buffer)).toBe(true);
    expect(await sessionStore.deleteBuffersByScope(scope)).toBe(1);
    await sessionStore.saveWorkingMemory(scope, workingMemory);
    expect(await sessionStore.getWorkingMemory(scope)).toEqual(workingMemory);
    expect(await sessionStore.deleteWorkingMemoryByScope(scope)).toBe(2);
    await sessionStore.saveJournal(scope, journal);
    expect(await sessionStore.getJournal(scope)).toEqual(journal);
    expect(await sessionStore.deleteJournalsByScope(scope)).toBe(3);

    await vectorStore.upsert("facts", [vectorRecord]);
    expect(await vectorStore.get("facts", "vec-1")).toEqual(vectorRecord);
    expect(
      await vectorStore.search("facts", vectorRecord.embedding, vectorSearchInput),
    ).toEqual(vectorSearchResults);
    await vectorStore.delete("facts", "vec-1");

    expect(loaderCalls).toBe(1);
    expect(log).toEqual([
      "createSQLiteDocumentStore:/tmp/test.sqlite:true",
      "document.set:facts:fact-1:{\"title\":\"wrapper coverage\"}",
      "document.get:facts:fact-1",
      "document.update:facts:fact-1:{\"title\":\"updated\"}",
      "document.query:facts:{\"status\":\"active\"}",
      "document.queryPage:facts:{\"filter\":{\"status\":\"active\"},\"limit\":2}",
      "document.searchText:facts:{\"field\":\"searchText\",\"filter\":{\"status\":\"active\"},\"limit\":2,\"query\":\"wrapper\"}",
      "document.writeBatchIfUnchanged:facts:fact-1:1",
      "document.delete:facts:fact-1",
      "createSQLiteSessionStore:/tmp/test.sqlite:false",
      "session.saveBuffer:session-1:summary",
      "session.saveBufferIfUnchanged:session-1:summary:summary",
      "session.getBuffer:session-1",
      "session.deleteBufferIfUnchanged:session-1:summary",
      "session.deleteBuffersByScope:session-1",
      "session.saveWorkingMemory:session-1:ship the package boundary",
      "session.getWorkingMemory:session-1",
      "session.deleteWorkingMemoryByScope:session-1",
      "session.saveJournal:session-1:1",
      "session.getJournal:session-1",
      "session.deleteJournalsByScope:session-1",
      "createSQLiteVectorStore:/tmp/test.sqlite:false:true",
      "vector.upsert:facts:1",
      "vector.get:facts:vec-1",
      "vector.search:facts:0.1,0.2,0.3:{\"topK\":3,\"filter\":{\"topic\":\"package-boundary\"}}",
      "vector.delete:facts:vec-1",
    ]);
  });

  it("wraps sqlite runtime failures and allows a later retry with a fresh loader", async () => {
    let loaderCalls = 0;

    setSQLitePublicModuleLoaderForTests(async () => {
      loaderCalls += 1;
      throw "sqlite unavailable outside Bun";
    });

    const failingStore = createSQLiteDocumentStore("/tmp/test.sqlite");
    await expect(failingStore.get("facts", "fact-1")).rejects.toThrow(
      "GoodMemory built-in SQLite storage is unavailable in this runtime.",
    );
    await expect(failingStore.get("facts", "fact-1")).rejects.toThrow(
      "Underlying error: sqlite unavailable outside Bun",
    );

    setSQLitePublicModuleLoaderForTests(async () => {
      loaderCalls += 1;

      return {
        createSQLiteDocumentStore() {
          return createTrackedDocumentStore([]);
        },
        createSQLiteSessionStore() {
          return createTrackedSessionStore([]);
        },
        createSQLiteVectorStore() {
          return createTrackedVectorStore([]);
        },
      };
    });

    const recoveredStore = createSQLiteDocumentStore("/tmp/test.sqlite");
    await expect(recoveredStore.get("facts", "fact-1")).resolves.toEqual({
      id: "fact-1",
      collection: "facts",
    });
    expect(loaderCalls).toBe(2);
  });

  it("delegates postgres bootstrap and every deferred wrapper method through the lazily loaded module", async () => {
    const log: string[] = [];
    let loaderCalls = 0;

    setPostgresPublicModuleLoaderForTests(async () => {
      loaderCalls += 1;

      return {
        async canBootstrapPostgresStorageBackend(config) {
          log.push(`bootstrap:${config.url}`);
          return true;
        },
        createPostgresDocumentStore(config, options) {
          log.push(`createPostgresDocumentStore:${config.url}:${String(options?.readOnly ?? false)}`);
          return createTrackedDocumentStore(log);
        },
        createPostgresSessionStore(config, options) {
          log.push(`createPostgresSessionStore:${config.url}:${String(options?.readOnly ?? false)}`);
          return createTrackedSessionStore(log);
        },
        createPostgresVectorStore(config, options) {
          log.push(`createPostgresVectorStore:${config.url}:${String(options?.readOnly ?? false)}`);
          return createTrackedVectorStore(log);
        },
        async migratePostgresStorageBackend(config, options) {
          log.push(`migratePostgresStorageBackend:${config.url}`);
          options?.log?.({
            elapsedMs: 12,
            index: "gm_documents_search_text_search_idx",
            schema: "public",
            status: "created",
          });
        },
      };
    });

    expect(
      await canBootstrapPostgresStorageBackend({
        url: "postgres://localhost:5432/goodmemory",
      }),
    ).toBe(true);
    await migratePostgresStorageBackend(
      { url: "postgres://localhost:5432/goodmemory" },
      {
        log: (event) => {
          log.push(
            `migration:${event.schema}:${event.index}:${event.elapsedMs}`,
          );
        },
      },
    );

    const documentStore = createPostgresDocumentStore(
      {
        url: "postgres://localhost:5432/goodmemory",
      },
      {
        readOnly: true,
      },
    );
    const sessionStore = createPostgresSessionStore({
      url: "postgres://localhost:5432/goodmemory",
    });
    const vectorStore = createPostgresVectorStore({
      url: "postgres://localhost:5432/goodmemory",
    });

    await documentStore.set("facts", "fact-1", {
      title: "wrapper coverage",
    });
    expect(await documentStore.get("facts", "fact-1")).toEqual({
      id: "fact-1",
      collection: "facts",
    });
    await documentStore.update("facts", "fact-1", {
      title: "updated",
    });
    expect(await documentStore.query("facts")).toEqual([
      {
        collection: "facts",
        filter: null,
      },
    ]);
    expect(
      await documentStore.queryPage!("facts", {
        filter: { status: "active" },
        limit: 2,
      }),
    ).toEqual({
      items: [],
      nextCursor: "cursor-1",
    });
    expect(
      await documentStore.searchText!("facts", {
        field: "searchText",
        filter: { status: "active" },
        limit: 2,
        query: "wrapper",
      }),
    ).toEqual([]);
    expect(
      await documentStore.writeBatchIfUnchanged!({
        expected: {
          collection: "facts",
          id: "fact-1",
          document: { title: "updated" },
        },
        set: [
          {
            collection: "facts",
            id: "fact-1",
            document: { title: "batch-updated" },
          },
        ],
      }),
    ).toBe(true);
    await documentStore.delete("facts", "fact-1");

    await sessionStore.saveBuffer(scope, buffer);
    expect(await sessionStore.saveBufferIfUnchanged(scope, null, buffer)).toBe(true);
    expect(await sessionStore.getBuffer(scope)).toEqual(buffer);
    expect(await sessionStore.deleteBufferIfUnchanged(scope, buffer)).toBe(true);
    expect(await sessionStore.deleteBuffersByScope(scope)).toBe(1);
    await sessionStore.saveWorkingMemory(scope, workingMemory);
    expect(await sessionStore.getWorkingMemory(scope)).toEqual(workingMemory);
    expect(await sessionStore.deleteWorkingMemoryByScope(scope)).toBe(2);
    await sessionStore.saveJournal(scope, journal);
    expect(await sessionStore.getJournal(scope)).toEqual(journal);
    expect(await sessionStore.deleteJournalsByScope(scope)).toBe(3);

    await vectorStore.upsert("facts", [vectorRecord]);
    expect(await vectorStore.get("facts", "vec-1")).toEqual(vectorRecord);
    expect(
      await vectorStore.search("facts", vectorRecord.embedding, vectorSearchInput),
    ).toEqual(vectorSearchResults);
    await vectorStore.delete("facts", "vec-1");

    expect(loaderCalls).toBe(1);
    expect(log).toEqual([
      "bootstrap:postgres://localhost:5432/goodmemory",
      "migratePostgresStorageBackend:postgres://localhost:5432/goodmemory",
      "migration:public:gm_documents_search_text_search_idx:12",
      "createPostgresDocumentStore:postgres://localhost:5432/goodmemory:true",
      "document.set:facts:fact-1:{\"title\":\"wrapper coverage\"}",
      "document.get:facts:fact-1",
      "document.update:facts:fact-1:{\"title\":\"updated\"}",
      "document.query:facts:null",
      "document.queryPage:facts:{\"filter\":{\"status\":\"active\"},\"limit\":2}",
      "document.searchText:facts:{\"field\":\"searchText\",\"filter\":{\"status\":\"active\"},\"limit\":2,\"query\":\"wrapper\"}",
      "document.writeBatchIfUnchanged:facts:fact-1:1",
      "document.delete:facts:fact-1",
      "createPostgresSessionStore:postgres://localhost:5432/goodmemory:false",
      "session.saveBuffer:session-1:summary",
      "session.saveBufferIfUnchanged:session-1:null:summary",
      "session.getBuffer:session-1",
      "session.deleteBufferIfUnchanged:session-1:summary",
      "session.deleteBuffersByScope:session-1",
      "session.saveWorkingMemory:session-1:ship the package boundary",
      "session.getWorkingMemory:session-1",
      "session.deleteWorkingMemoryByScope:session-1",
      "session.saveJournal:session-1:1",
      "session.getJournal:session-1",
      "session.deleteJournalsByScope:session-1",
      "createPostgresVectorStore:postgres://localhost:5432/goodmemory:false",
      "vector.upsert:facts:1",
      "vector.get:facts:vec-1",
      "vector.search:facts:0.1,0.2,0.3:{\"topK\":3,\"filter\":{\"topic\":\"package-boundary\"}}",
      "vector.delete:facts:vec-1",
    ]);
  });

  it("wraps postgres runtime failures and allows a later retry with a fresh loader", async () => {
    let loaderCalls = 0;

    setPostgresPublicModuleLoaderForTests(async () => {
      loaderCalls += 1;
      throw new Error("bun SQL is unavailable");
    });

    await expect(
      canBootstrapPostgresStorageBackend({
        url: "postgres://localhost:5432/goodmemory",
      }),
    ).rejects.toThrow(
      "GoodMemory built-in Postgres storage is unavailable in this runtime.",
    );
    await expect(
      canBootstrapPostgresStorageBackend({
        url: "postgres://localhost:5432/goodmemory",
      }),
    ).rejects.toThrow("Underlying error: bun SQL is unavailable");

    setPostgresPublicModuleLoaderForTests(async () => {
      loaderCalls += 1;

      return {
        async canBootstrapPostgresStorageBackend() {
          return false;
        },
        createPostgresDocumentStore() {
          return createTrackedDocumentStore([]);
        },
        createPostgresSessionStore() {
          return createTrackedSessionStore([]);
        },
        createPostgresVectorStore() {
          return createTrackedVectorStore([]);
        },
        async migratePostgresStorageBackend() {},
      };
    });

    await expect(
      canBootstrapPostgresStorageBackend({
        url: "postgres://localhost:5432/goodmemory",
      }),
    ).resolves.toBe(false);
    expect(loaderCalls).toBe(3);
  });
});
