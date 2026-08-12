import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGoodMemory } from "../../src";
import { createFactMemory } from "../../src/domain/records";
import { normalizeScope, scopeToKey } from "../../src/domain/scope";
import { SOURCE_MESSAGES_COLLECTION } from "../../src/evidence/contracts";
import {
  CLAIM_PROJECTIONS_COLLECTION,
  CLAIM_PROJECTION_STATUS_COLLECTION,
  ENTITIES_COLLECTION,
  PROJECTION_MANIFESTS_COLLECTION,
  PROJECTION_REPAIRS_COLLECTION,
  type ClaimProjectionStatus,
  type RecallProjectionManifest,
} from "../../src/recall/projections/contracts";
import { createRecallProjectionRuntime } from "../../src/recall/projections/runtime";
import type {
  DocumentStore,
  StorageFilter,
} from "../../src/storage/contracts";
import { createInMemorySessionStore } from "../../src/storage/memory";
import {
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
  createSQLiteVectorStore,
} from "../../src/storage/sqlite";
import {
  SCOPE_MUTATION_INTENTS_COLLECTION,
} from "../../src/storage/scopeDeletion";
import {
  runDocumentStoreContract,
  runSessionStoreContract,
  runVectorStoreContract,
} from "./storage.contract";

runDocumentStoreContract("sqlite document store contract", () => {
  const path = join(tmpdir(), `goodmemory-sqlite-${Date.now()}-${Math.random()}.db`);

  return {
    store: createSQLiteDocumentStore(path),
    cleanup: () => rm(path, { force: true }),
  };
});

runSessionStoreContract("sqlite session store contract", () => {
  const path = join(
    tmpdir(),
    `goodmemory-sqlite-session-${Date.now()}-${Math.random()}.db`,
  );

  return {
    store: createSQLiteSessionStore(path),
    cleanup: () => rm(path, { force: true }),
  };
});

runVectorStoreContract("sqlite vector store contract", () => {
  const path = join(tmpdir(), `goodmemory-sqlite-vector-${Date.now()}-${Math.random()}.db`);

  return {
    store: createSQLiteVectorStore(path),
    cleanup: () => rm(path, { force: true }),
  };
});

describe("sqlite document query pushdown", () => {
  it("filters and limits projection pages in SQL before deserializing documents", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-page-pushdown-${Date.now()}-${Math.random()}.db`,
    );
    const collection = CLAIM_PROJECTIONS_COLLECTION;
    try {
      const store = createSQLiteDocumentStore(path);
      await store.set(collection, "000-match", {
        id: "000-match",
        scopeKey: "scope-a",
        searchText: "Atlas first",
      });
      const database = new Database(path, { strict: true });
      const insert = database.query(
        `INSERT INTO documents (collection, id, json) VALUES (?1, ?2, ?3)`,
      );
      for (let index = 0; index < 128; index += 1) {
        insert.run(
          collection,
          `100-corrupt-${index.toString().padStart(3, "0")}`,
          "{not-json",
        );
      }
      database.close();
      await store.set(collection, "999-match", {
        id: "999-match",
        scopeKey: "scope-a",
        searchText: "Atlas second",
      });

      const first = await store.queryPage!(collection, {
        filter: { scopeKey: "scope-a" },
        limit: 1,
      });

      expect(first).toEqual({
        items: [{
          id: "000-match",
          scopeKey: "scope-a",
          searchText: "Atlas first",
        }],
        nextCursor: "000-match",
      });
      await expect(store.queryPage!(collection, {
        cursor: first.nextCursor,
        filter: { scopeKey: "scope-a" },
        limit: 1,
      })).resolves.toEqual({
        items: [{
          id: "999-match",
          scopeKey: "scope-a",
          searchText: "Atlas second",
        }],
      });
    } finally {
      await rm(path, { force: true });
    }
  });

  it("fails closed instead of scanning or ignoring unsupported filters", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-filter-contract-${Date.now()}-${Math.random()}.db`,
    );
    try {
      const store = createSQLiteDocumentStore(path);
      await store.set("projection_documents", "atlas", {
        id: "atlas",
        searchText: "Atlas rollout active",
        tags: ["phase-74"],
      });
      const unsupported = {
        tags: ["phase-74"],
      } as unknown as StorageFilter;

      await expect(store.query("projection_documents", unsupported)).rejects
        .toThrow("Storage filters only support scalar equality values");
      await expect(store.queryPage!("projection_documents", {
        filter: unsupported,
        limit: 1,
      })).rejects.toThrow("Storage filters only support scalar equality values");
      await expect(store.searchText!("projection_documents", {
        field: "searchText",
        filter: unsupported,
        limit: 1,
        query: "Atlas",
      })).rejects.toThrow("Storage filters only support scalar equality values");
    } finally {
      await rm(path, { force: true });
    }
  });
});

describe("sqlite vector store read-only mode", () => {
  it("rejects vector mutations when opened read-only", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-vector-readonly-${Date.now()}-${Math.random()}.db`,
    );

    try {
      const writable = createSQLiteVectorStore(path);
      await writable.upsert("vectors", [
        {
          id: "vector-1",
          embedding: [1, 0, 0],
          metadata: { userId: "u-1" },
          content: "first",
        },
      ]);

      const readOnly = createSQLiteVectorStore(path, { readOnly: true });

      await expect(
        readOnly.upsert("vectors", [
          {
            id: "vector-2",
            embedding: [0, 1, 0],
            metadata: { userId: "u-1" },
            content: "second",
          },
        ]),
      ).rejects.toThrow("read-only");
      await expect(readOnly.delete("vectors", "vector-1")).rejects.toThrow(
        "read-only",
      );
      await expect(readOnly.get("vectors", "vector-1")).resolves.toMatchObject({
        id: "vector-1",
      });
    } finally {
      await rm(path, { force: true });
    }
  });
});

describe("sqlite document conditional batches", () => {
  it("explicitly resumes a deletion after the owning process exits", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-deletion-recovery-${Date.now()}-${Math.random()}.db`,
    );
    const scope = {
      userId: "sqlite-recovery-user",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    };
    const operationKey = JSON.stringify({
      contract: "delete-all-memory-v1",
      includeRuntime: true,
      scope: scopeToKey(normalizeScope(scope)),
    });
    try {
      const memory = createGoodMemory({
        storage: { provider: "sqlite", url: path },
      });
      await memory.remember({
        scope,
        messages: [{
          role: "user",
          content: "Remember that the SQLite recovery token is private.",
        }],
      });
      const child = spawnSync(
        process.execPath,
        ["--env-file=/dev/null", "-e", `
          import { createSQLiteDocumentStore } from "./src/storage/sqlite";
          import { createScopeDeletionCoordinator } from "./src/storage/scopeDeletion";

          const coordinator = createScopeDeletionCoordinator(
            createSQLiteDocumentStore(${JSON.stringify(path)}),
          );
          await coordinator.runExclusive(
            ${JSON.stringify(scope)},
            async () => {
              process.exit(23);
            },
            {
              operationKey: ${JSON.stringify(operationKey)},
            },
          );
        `],
        {
          cwd: process.cwd(),
          encoding: "utf8",
        },
      );
      expect(child.status).toBe(23);

      const recovery = createGoodMemory({
        storage: { provider: "sqlite", url: path },
      });
      await expect(recovery.deleteAllMemory({ scope })).rejects.toThrow(
        "automatic takeover is disabled",
      );
      await expect(recovery.deleteAllMemory({
        resumeInterrupted: {
          confirmPriorRuntimesStopped: true,
        },
        scope,
      })).resolves.toMatchObject({ scope });
      expect(
        await createSQLiteDocumentStore(path).query("facts", scope),
      ).toEqual([]);
    } finally {
      await Promise.all([
        rm(path, { force: true }),
        rm(`${path}-shm`, { force: true }),
        rm(`${path}-wal`, { force: true }),
      ]);
    }
  });

  it("recovers a mutation intent after the owning process exits", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-mutation-recovery-${Date.now()}-${Math.random()}.db`,
    );
    const scope = {
      userId: "sqlite-mutation-recovery-user",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    };
    try {
      const child = spawnSync(
        process.execPath,
        ["--env-file=/dev/null", "-e", `
          import { createSQLiteDocumentStore } from "./src/storage/sqlite";
          import { createScopeDeletionCoordinator } from "./src/storage/scopeDeletion";

          const coordinator = createScopeDeletionCoordinator(
            createSQLiteDocumentStore(${JSON.stringify(path)}),
          );
          await coordinator.runMutation(
            ${JSON.stringify(scope)},
            async () => {
              process.exit(24);
            },
          );
        `],
        {
          cwd: process.cwd(),
          encoding: "utf8",
        },
      );
      expect(child.status).toBe(24);
      expect(
        await createSQLiteDocumentStore(path).query(
          SCOPE_MUTATION_INTENTS_COLLECTION,
          { userId: scope.userId },
        ),
      ).toHaveLength(1);

      const recovery = createGoodMemory({
        storage: { provider: "sqlite", url: path },
      });
      await expect(recovery.deleteAllMemory({
        resumeInterrupted: {
          confirmPriorRuntimesStopped: true,
        },
        scope,
      })).resolves.toMatchObject({ scope });
      expect(
        await createSQLiteDocumentStore(path).query(
          SCOPE_MUTATION_INTENTS_COLLECTION,
          { userId: scope.userId },
        ),
      ).toEqual([]);
    } finally {
      await Promise.all([
        rm(path, { force: true }),
        rm(`${path}-shm`, { force: true }),
        rm(`${path}-wal`, { force: true }),
      ]);
    }
  });

  it("drains a pre-existing mutation across independently opened runtimes", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-terminal-delete-${Date.now()}-${Math.random()}.db`,
    );
    const scope = {
      userId: "sqlite-terminal-user",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    };
    let releaseEmbedding = () => {};
    let signalEmbedding = () => {};
    const embeddingStarted = new Promise<void>((resolve) => {
      signalEmbedding = resolve;
    });
    const embeddingRelease = new Promise<void>((resolve) => {
      releaseEmbedding = resolve;
    });
    try {
      const writer = createGoodMemory({
        adapters: {
          embeddingAdapter: {
            async embed(texts) {
              signalEmbedding();
              await embeddingRelease;
              return texts.map(() => [1, 1, 1]);
            },
          },
        },
        storage: { provider: "sqlite", url: path },
      });
      const deleter = createGoodMemory({
        storage: { provider: "sqlite", url: path },
      });

      const remember = writer.remember({
        scope,
        messages: [{
          role: "user",
          content: "Remember that the private SQLite rollout token is active.",
        }],
      });
      await embeddingStarted;
      let deletionResolved = false;
      const deletion = deleter.deleteAllMemory({ scope }).then((result) => {
        deletionResolved = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(deletionResolved).toBe(false);
      releaseEmbedding();
      await remember;
      await deletion;
      expect(await createSQLiteDocumentStore(path).query("facts", scope)).toEqual([]);
      expect(
        await createSQLiteVectorStore(path).search("facts", [1, 1, 1], {
          filter: scope,
          topK: 10,
        }),
      ).toEqual([]);
    } finally {
      releaseEmbedding();
      await rm(path, { force: true });
    }
  });

  it("enables analyzer-derived persistent proof for owned SQLite storage", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-product-manifest-${Date.now()}-${Math.random()}.db`,
    );
    const scope = {
      userId: "product-manifest-user",
      workspaceId: "product-manifest-workspace",
    };
    const now = () => new Date("2026-07-18T12:00:00.000Z");
    try {
      const memory = createGoodMemory({
        retrieval: { preset: "recommended" },
        storage: { provider: "sqlite", url: path },
        testing: { now },
      });
      await memory.remember({
        scope,
        messages: [{
          role: "user",
          content: "Remember that Atlas rollout is active in Paris.",
        }],
      });
      await memory.recall({ scope, query: "What is the Atlas rollout status?" });
      await memory.recall({ scope, query: "What is the Atlas rollout status?" });
      const inspectionStore = createSQLiteDocumentStore(path);
      const [sealed] = await inspectionStore.query<RecallProjectionManifest>(
        PROJECTION_MANIFESTS_COLLECTION,
      );
      expect(sealed?.projectionBuildId).toStartWith("gm-projection-v5:");
      expect(sealed?.validatedGeneration).toBe(sealed?.sourceGeneration);

      const reopened = createGoodMemory({
        retrieval: { preset: "recommended" },
        storage: { provider: "sqlite", url: path },
        testing: { now },
      });
      await reopened.recall({
        scope,
        query: "What is the Atlas rollout status?",
      });
      const [afterReopen] = await inspectionStore.query<RecallProjectionManifest>(
        PROJECTION_MANIFESTS_COLLECTION,
      );

      expect(afterReopen).toEqual(sealed);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("reuses a sealed projection generation after reopening SQLite", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-projection-manifest-${Date.now()}-${Math.random()}.db`,
    );
    try {
      const firstStore = createSQLiteDocumentStore(path);
      const firstRuntime = createRecallProjectionRuntime({
        documentStore: firstStore,
        persistentScopeProof: { buildId: "sqlite-projection-build-a" },
      });
      const scope = { userId: "manifest-user", workspaceId: "manifest-workspace" };
      const fact = createFactMemory({
        ...scope,
        id: "fact-manifest",
        category: "project",
        content: "Atlas rollout is active.",
        subject: "Atlas",
        source: {
          method: "explicit",
          extractedAt: "2026-07-18T09:00:00.000Z",
        },
        createdAt: "2026-07-18T09:00:00.000Z",
        updatedAt: "2026-07-18T09:00:00.000Z",
      });
      await firstRuntime.documentStore.set("facts", fact.id, fact);
      await firstRuntime.ensureScopeIndexed(scope);

      const reopened = createSQLiteDocumentStore(path);
      let queries = 0;
      const countedStore: DocumentStore = {
        projectionBatchSemantics: reopened.projectionBatchSemantics,
        set: (collection, id, document) => reopened.set(collection, id, document),
        get: (collection, id) => reopened.get(collection, id),
        update: (collection, id, patch) => reopened.update(collection, id, patch),
        async query(collection, filter) {
          queries += 1;
          return reopened.query(collection, filter);
        },
        delete: (collection, id) => reopened.delete(collection, id),
        writeBatchIfUnchanged: (input) =>
          reopened.writeBatchIfUnchanged(input),
      };
      const restartedRuntime = createRecallProjectionRuntime({
        documentStore: countedStore,
        persistentScopeProof: { buildId: "sqlite-projection-build-a" },
      });

      expect(await restartedRuntime.ensureScopeIndexed(scope)).toEqual({
        complete: true,
        indexedSources: 0,
        skipped: true,
      });
      expect(queries).toBe(0);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("surfaces write contention instead of reporting a CAS mismatch", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-contention-${Date.now()}-${Math.random()}.db`,
    );
    let blocker: Database | undefined;
    try {
      const store = createSQLiteDocumentStore(path);
      const expected = { id: "fact-1", content: "before" };
      await store.set("facts", expected.id, expected);
      blocker = new Database(path, { strict: true });
      blocker.exec("BEGIN IMMEDIATE");

      await expect(store.writeBatchIfUnchanged({
        expected: {
          collection: "facts",
          document: expected,
          id: expected.id,
        },
        set: [{
          collection: "facts",
          document: { ...expected, content: "after" },
          id: expected.id,
        }],
      })).rejects.toThrow();
      expect(await store.get("facts", expected.id)).toEqual(expected);
    } finally {
      try {
        blocker?.exec("ROLLBACK");
      } finally {
        blocker?.close();
      }
      await rm(path, { force: true });
    }
  });

  it("rejects remember and rolls back canonical data when busy blocks projection repair", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-projection-contention-${Date.now()}-${Math.random()}.db`,
    );
    let blocker: Database | undefined;
    try {
      const inner = createSQLiteDocumentStore(path);
      const store: DocumentStore = {
        projectionBatchSemantics: inner.projectionBatchSemantics,
        set: async (collection, id, document) => {
          await inner.set(collection, id, document);
          if (collection === "facts" && !blocker) {
            blocker = new Database(path, { strict: true });
            blocker.exec("BEGIN IMMEDIATE");
          }
        },
        get: (collection, id) => inner.get(collection, id),
        update: (collection, id, patch) => inner.update(collection, id, patch),
        query: (collection, filter) => inner.query(collection, filter),
        delete: (collection, id) => inner.delete(collection, id),
        writeBatchIfUnchanged: async (input) => {
          const writesProjectionRepair = input.set.some(
            ({ collection }) => collection === PROJECTION_REPAIRS_COLLECTION,
          );
          try {
            const committed = await inner.writeBatchIfUnchanged(input);
            if (
              committed &&
              input.set.some(({ collection }) => collection === "facts") &&
              !blocker
            ) {
              blocker = new Database(path, { strict: true });
              blocker.exec("BEGIN IMMEDIATE");
            }
            return committed;
          } catch (error) {
            if (writesProjectionRepair) {
              blocker?.exec("ROLLBACK");
              blocker?.close();
              blocker = undefined;
            }
            throw error;
          }
        },
      };
      const memory = createGoodMemory({
        adapters: {
          documentStore: store,
          sessionStore: createInMemorySessionStore(),
        },
        retrieval: { preset: "recommended" },
        storage: { provider: "memory" },
      });

      await expect(memory.remember({
        scope: { userId: "busy-user", sessionId: "busy-session" },
        messages: [{
          role: "user",
          content: "Remember that Atlas status is blocked.",
        }],
      })).rejects.toThrow();

      expect(await inner.query("facts")).toEqual([]);
      expect(await inner.query(CLAIM_PROJECTIONS_COLLECTION)).toEqual([]);
      expect(await inner.query(CLAIM_PROJECTION_STATUS_COLLECTION)).toEqual([]);
      expect(await inner.query(PROJECTION_REPAIRS_COLLECTION)).toEqual([]);
    } finally {
      try {
        blocker?.exec("ROLLBACK");
      } finally {
        blocker?.close();
      }
      await rm(path, { force: true });
    }
  });
});

describe("sqlite filtered document queries", () => {
  it("filters in SQLite before deserializing non-matching documents", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-filtered-query-${Date.now()}-${Math.random()}.db`,
    );
    try {
      const store = createSQLiteDocumentStore(path);
      await store.set("entities_v1", "matching", {
        id: "matching",
        memoryId: "facts:atlas",
      });
      const database = new Database(path, { strict: true });
      database
        .query(
          `INSERT INTO documents (collection, id, json)
           VALUES ('entities_v1', 'non-matching', 'null')`,
        )
        .run();
      database.close();

      await expect(store.query("entities_v1", {
        memoryId: "facts:atlas",
      })).resolves.toEqual([{ id: "matching", memoryId: "facts:atlas" }]);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("uses the source-memory expression index for scalar projection filters", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-filter-plan-${Date.now()}-${Math.random()}.db`,
    );
    try {
      const store = createSQLiteDocumentStore(path);
      await store.set("claim_projections_v1", "claim-1", {
        id: "claim-1",
        sourceMemoryId: "fact-atlas",
      });

      const database = new Database(path, { readonly: true, strict: true });
      const plan = database
        .query<{ detail: string }, []>(
          `EXPLAIN QUERY PLAN
           SELECT json
           FROM documents
           WHERE collection = 'claim_projections_v1'
             AND json_valid(json)
             AND json_extract(json, '$.sourceMemoryId') = 'fact-atlas'`,
        )
        .all();
      database.close();

      expect(plan.some(({ detail }) =>
        detail.includes("documents_collection_source_memory_id_idx") &&
        detail.includes("<expr>=?"),
      )).toBe(true);
      await expect(store.query("claim_projections_v1", {
        sourceMemoryId: "fact-atlas",
      })).resolves.toEqual([{
        id: "claim-1",
        sourceMemoryId: "fact-atlas",
      }]);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("uses the claim-group index for temporal peer lookups", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-claim-group-plan-${Date.now()}-${Math.random()}.db`,
    );
    try {
      const store = createSQLiteDocumentStore(path);
      const claim = {
        id: "claim-1",
        scopeKey: "user-1::::workspace-1::::",
        subjectEntityId: "entity-atlas",
        predicateKey: "project.status",
      };
      await store.set("claim_projections_v1", claim.id, claim);

      const database = new Database(path, { readonly: true, strict: true });
      const plan = database
        .query<{ detail: string }, []>(
          `EXPLAIN QUERY PLAN
           SELECT json
           FROM documents
           WHERE collection = 'claim_projections_v1'
             AND json_valid(json)
             AND json_extract(json, '$.scopeKey') = 'user-1::::workspace-1::::'
             AND json_extract(json, '$.subjectEntityId') = 'entity-atlas'
             AND json_extract(json, '$.predicateKey') = 'project.status'`,
        )
        .all();
      database.close();

      expect(plan.some(({ detail }) =>
        detail.includes("documents_collection_claim_group_idx") &&
        detail.includes("<expr>=?"),
      )).toBe(true);
      await expect(store.query("claim_projections_v1", {
        scopeKey: claim.scopeKey,
        subjectEntityId: claim.subjectEntityId,
        predicateKey: claim.predicateKey,
      })).resolves.toEqual([claim]);
    } finally {
      await rm(path, { force: true });
    }
  });
});

describe("sqlite projection text index", () => {
  it("persists raw source messages without adding them to FTS", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-source-messages-${Date.now()}-${Math.random()}.db`,
    );
    try {
      const documentStore = createSQLiteDocumentStore(path);
      const memory = createGoodMemory({
        adapters: {
          documentStore,
          sessionStore: createInMemorySessionStore(),
        },
        testing: {
          extractor: {
            async extract() {
              return { candidates: [], ignoredMessageCount: 0 };
            },
          },
        },
      });

      await memory.remember({
        scope: { userId: "source-user", sessionId: "source-session" },
        messages: [
          { id: "source-user-1", role: "user", content: "Raw user context." },
          {
            id: "source-assistant-1",
            role: "assistant",
            content: "Raw assistant context.",
          },
        ],
      });

      expect(await documentStore.query(SOURCE_MESSAGES_COLLECTION, {
        userId: "source-user",
      })).toHaveLength(2);
      const database = new Database(path, { readonly: true, strict: true });
      const indexed = database
        .query<{ count: number }, [string]>(
          `SELECT COUNT(*) AS count
           FROM document_text_fts_keys
           WHERE collection = ?1`,
        )
        .get(SOURCE_MESSAGES_COLLECTION);
      database.close();
      expect(indexed?.count).toBe(0);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("keeps legacy read-only databases searchable before a writable migration", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-readonly-legacy-text-${Date.now()}-${Math.random()}.db`,
    );
    try {
      const legacy = new Database(path, { strict: true });
      legacy.exec(`
        CREATE TABLE documents (
          collection TEXT NOT NULL,
          id TEXT NOT NULL,
          json TEXT NOT NULL,
          PRIMARY KEY (collection, id)
        );
        CREATE VIRTUAL TABLE document_text_fts USING fts5(
          collection UNINDEXED,
          id UNINDEXED,
          text,
          tokenize = 'unicode61 remove_diacritics 2'
        );
      `);
      legacy.query(
        `INSERT INTO documents (collection, id, json) VALUES (?1, ?2, ?3)`,
      ).run("recall_documents_v2", "cjk-1", JSON.stringify({
        id: "cjk-1",
        searchText: "東京 旅行 計画",
        text: "東京への旅行計画。",
      }));
      legacy.exec(`
        INSERT INTO document_text_fts (rowid, collection, id, text)
        VALUES (1, 'recall_documents_v2', 'cjk-1', '東京への旅行計画。');
      `);
      legacy.close();

      const readOnly = createSQLiteDocumentStore(path, { readOnly: true });

      await expect(readOnly.searchText?.("recall_documents_v2", {
        field: "searchText",
        limit: 2,
        query: "東京 計画",
      })).resolves.toEqual([
        expect.objectContaining({ id: "cjk-1" }),
      ]);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("rebuilds legacy FTS state from canonical documents before versioning", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-legacy-text-${Date.now()}-${Math.random()}.db`,
    );
    try {
      const legacy = new Database(path, { strict: true });
      legacy.exec(`
        CREATE TABLE documents (
          collection TEXT NOT NULL,
          id TEXT NOT NULL,
          json TEXT NOT NULL,
          PRIMARY KEY (collection, id)
        );
        CREATE VIRTUAL TABLE document_text_fts USING fts5(
          collection UNINDEXED,
          id UNINDEXED,
          text,
          tokenize = 'unicode61 remove_diacritics 2'
        );
        CREATE TABLE document_store_schema (
          component TEXT PRIMARY KEY,
          version INTEGER NOT NULL
        );
        INSERT INTO document_store_schema (component, version)
        VALUES ('document_text_fts_keys', 1);
      `);
      const insertDocument = legacy.query(
        `INSERT INTO documents (collection, id, json) VALUES (?1, ?2, ?3)`,
      );
      insertDocument.run("facts", "shared", JSON.stringify({
        id: "shared",
        text: "Atlas is canonical.",
      }));
      insertDocument.run("references", "shared", JSON.stringify({
        id: "shared",
        text: "Beacon is canonical.",
      }));
      insertDocument.run("facts", "missing", JSON.stringify({
        id: "missing",
        text: "Missing index row.",
      }));
      insertDocument.run("facts", "no-text", JSON.stringify({
        id: "no-text",
        content: "No searchable field.",
      }));
      insertDocument.run("facts", "search-text-only", JSON.stringify({
        id: "search-text-only",
        searchText: "東京 旅行 計画",
      }));
      legacy.exec(`
        INSERT INTO document_text_fts (rowid, collection, id, text)
        VALUES
          (7, 'facts', 'shared', 'Atlas is stale.'),
          (8, 'facts', 'shared', 'Atlas duplicate.'),
          (9, 'facts', 'orphan', 'Orphan row.'),
          (10, 'facts', 'no-text', 'No longer searchable.'),
          (11, 'references', 'shared', 'Beacon is stale.');
      `);
      legacy.close();

      createSQLiteDocumentStore(path);
      const firstRead = new Database(path, { readonly: true, strict: true });
      const firstRows = firstRead
        .query<{
          collection: string;
          id: string;
          rowid: number;
          searchText: string | null;
          text: string | null;
        }, []>(
          `SELECT keys.rowid, keys.collection, keys.id, fts.text, fts.searchText
           FROM document_text_fts_keys AS keys
           JOIN document_text_fts AS fts ON fts.rowid = keys.rowid
           ORDER BY keys.collection, keys.id`,
        )
        .all();
      firstRead.close();

      expect(firstRows.map(({ collection, id, searchText, text }) => ({
        collection,
        id,
        searchText,
        text,
      }))).toEqual([
        {
          collection: "facts",
          id: "missing",
          searchText: null,
          text: "Missing index row.",
        },
        {
          collection: "facts",
          id: "search-text-only",
          searchText: "東京 旅行 計画",
          text: null,
        },
        {
          collection: "facts",
          id: "shared",
          searchText: null,
          text: "Atlas is canonical.",
        },
        {
          collection: "references",
          id: "shared",
          searchText: null,
          text: "Beacon is canonical.",
        },
      ]);

      createSQLiteDocumentStore(path);
      const reopened = new Database(path, { readonly: true, strict: true });
      const reopenedRows = reopened
        .query<{
          collection: string;
          id: string;
          rowid: number;
          searchText: string | null;
          text: string | null;
        }, []>(
          `SELECT keys.rowid, keys.collection, keys.id, fts.text, fts.searchText
           FROM document_text_fts_keys AS keys
           JOIN document_text_fts AS fts ON fts.rowid = keys.rowid
           ORDER BY keys.collection, keys.id`,
        )
        .all();
      reopened.close();
      expect(reopenedRows).toEqual(firstRows);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("rolls back canonical and FTS state together when index writes fail", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-text-atomic-${Date.now()}-${Math.random()}.db`,
    );
    try {
      const store = createSQLiteDocumentStore(path);
      const faults = new Database(path, { strict: true });
      faults.exec(`
        CREATE TRIGGER fail_text_key_insert
        BEFORE INSERT ON document_text_fts_keys
        BEGIN
          SELECT RAISE(ABORT, 'injected text-key insert failure');
        END;
      `);

      await expect(store.set("recall_documents_v2", "document-1", {
        id: "document-1",
        text: "Atlas is active.",
      })).rejects.toThrow("injected text-key insert failure");
      await expect(store.get("recall_documents_v2", "document-1"))
        .resolves.toBeNull();

      faults.exec("DROP TRIGGER fail_text_key_insert");
      await store.set("recall_documents_v2", "document-1", {
        id: "document-1",
        text: "Atlas is active.",
      });
      faults.exec(`
        CREATE TRIGGER fail_text_key_delete
        BEFORE DELETE ON document_text_fts_keys
        BEGIN
          SELECT RAISE(ABORT, 'injected text-key delete failure');
        END;
      `);

      await expect(store.delete("recall_documents_v2", "document-1"))
        .rejects.toThrow("injected text-key delete failure");
      await expect(store.get("recall_documents_v2", "document-1"))
        .resolves.toEqual({
          id: "document-1",
          text: "Atlas is active.",
        });
      await expect(store.searchText?.("recall_documents_v2", {
        field: "text",
        limit: 5,
        query: "Atlas active",
      })).resolves.toEqual([
        expect.objectContaining({ id: "document-1" }),
      ]);
      faults.close();
    } finally {
      await rm(path, { force: true });
    }
  });

  it("maintains FTS rows through stable indexed keys", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-text-keys-${Date.now()}-${Math.random()}.db`,
    );
    try {
      const store = createSQLiteDocumentStore(path);
      await store.set("recall_documents_v2", "document-1", {
        id: "document-1",
        text: "Atlas is active.",
        userId: "user-1",
      });

      const firstRead = new Database(path, { readonly: true, strict: true });
      const firstKey = firstRead
        .query<{ rowid: number }, []>(
          `SELECT rowid
           FROM document_text_fts_keys
           WHERE collection = 'recall_documents_v2' AND id = 'document-1'`,
        )
        .get();
      const schemaState = firstRead
        .query<{ version: number }, []>(
          `SELECT version
           FROM document_store_schema
           WHERE component = 'document_text_fts_keys'`,
        )
        .get();
      firstRead.close();
      expect(firstKey?.rowid).toBeNumber();
      expect(schemaState?.version).toBe(2);

      await store.set("recall_documents_v2", "document-1", {
        id: "document-1",
        searchText: "atlas completed",
        text: "Atlas is completed.",
        userId: "user-1",
      });
      const updatedRead = new Database(path, { readonly: true, strict: true });
      const updated = updatedRead
        .query<{
          count: number;
          rowid: number;
          searchText: string;
          text: string;
        }, []>(
          `SELECT keys.rowid, fts.text, fts.searchText, COUNT(*) AS count
           FROM document_text_fts_keys AS keys
           JOIN document_text_fts AS fts ON fts.rowid = keys.rowid
           WHERE keys.collection = 'recall_documents_v2' AND keys.id = 'document-1'`,
        )
        .get();
      updatedRead.close();
      expect(updated).toEqual({
        count: 1,
        rowid: firstKey!.rowid,
        searchText: "atlas completed",
        text: "Atlas is completed.",
      });

      await store.delete("recall_documents_v2", "document-1");
      const deletedRead = new Database(path, { readonly: true, strict: true });
      const remaining = deletedRead
        .query<{ count: number }, []>(
          `SELECT COUNT(*) AS count
           FROM document_text_fts_keys AS keys
           JOIN document_text_fts AS fts ON fts.rowid = keys.rowid
           WHERE keys.collection = 'recall_documents_v2' AND keys.id = 'document-1'`,
        )
        .get();
      deletedRead.close();
      expect(remaining?.count).toBe(0);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("indexes and searches claim and entity projections through FTS", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-projection-text-${Date.now()}-${Math.random()}.db`,
    );
    try {
      const store = createSQLiteDocumentStore(path);
      const runtime = createRecallProjectionRuntime({ documentStore: store });
      const scope = { userId: "fts-user", workspaceId: "fts-workspace" };
      const fact = createFactMemory({
        ...scope,
        id: "fact-atlas",
        category: "project",
        content: "Atlas rollout is active.",
        subject: "Atlas",
        source: {
          method: "explicit",
          extractedAt: "2026-07-18T09:00:00.000Z",
        },
        createdAt: "2026-07-18T09:00:00.000Z",
        updatedAt: "2026-07-18T09:00:00.000Z",
      });
      await runtime.documentStore.set("facts", fact.id, fact);
      await runtime.appendClaim({
        ...scope,
        sourceMemoryId: fact.id,
        subject: "Atlas",
        claim: {
          predicateKey: "project.status",
          objectText: "completed",
          polarity: "positive",
          modality: "completed",
        },
        observedAt: "2026-07-18T10:00:00.000Z",
        ingestedAt: "2026-07-18T10:00:00.000Z",
        evidenceIds: ["evidence-atlas"],
        sourceMessageIds: ["message-atlas"],
        extractorVersion: "sqlite-fts-test-v1",
      });

      expect(await runtime.searchClaims(scope, "Atlas completed", 5)).toEqual([
        expect.objectContaining({ objectText: "completed" }),
      ]);
      expect(
        (await runtime.searchEntities(scope, "Atlas rollout", 5)).some(
          ({ canonicalKey }) => canonicalKey === "atlas",
        ),
      ).toBe(true);

      const database = new Database(path, { readonly: true, strict: true });
      const indexedCollections = database
        .query<{ collection: string }, []>(
          `SELECT DISTINCT collection
           FROM document_text_fts
           WHERE collection IN ('claim_projections_v2', 'entities_v2')
           ORDER BY collection`,
        )
        .all()
        .map(({ collection }) => collection);
      database.close();
      expect(indexedCollections).toEqual([
        CLAIM_PROJECTIONS_COLLECTION,
        ENTITIES_COLLECTION,
      ]);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("refills claim FTS after a retired fallback occupies top one", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-stale-claim-${Date.now()}-${Math.random()}.db`,
    );
    try {
      const store = createSQLiteDocumentStore(path);
      const scope = { userId: "fts-user", workspaceId: "fts-workspace" };
      const fact = createFactMemory({
        ...scope,
        id: "fact-atlas-stale",
        category: "project",
        content: "Atlas rollout is active.",
        subject: "Atlas",
        source: {
          method: "explicit",
          extractedAt: "2026-07-18T09:00:00.000Z",
        },
        createdAt: "2026-07-18T09:00:00.000Z",
        updatedAt: "2026-07-18T09:00:00.000Z",
      });
      await store.set("facts", fact.id, fact);
      const bootstrap = createRecallProjectionRuntime({ documentStore: store });
      await bootstrap.ensureScopeIndexed(scope);
      const [fallback] = await bootstrap.queryClaims(scope);
      await bootstrap.appendClaim({
        ...scope,
        sourceMemoryId: fact.id,
        subject: "Atlas",
        claim: {
          predicateKey: "project.status",
          objectText: "completed",
          polarity: "positive",
          modality: "completed",
        },
        observedAt: fact.updatedAt,
        ingestedAt: fact.updatedAt,
        evidenceIds: [],
        sourceMessageIds: [],
        extractorVersion: "sqlite-fts-test-v1",
      });
      await store.set(CLAIM_PROJECTIONS_COLLECTION, fallback!.id, fallback!);
      expect(await store.searchText?.(CLAIM_PROJECTIONS_COLLECTION, {
        field: "searchText",
        filter: scope,
        limit: 1,
        query: "Atlas rollout active",
      })).toEqual([
        expect.objectContaining({ id: fallback!.id }),
      ]);
      const runtime = createRecallProjectionRuntime({
        documentStore: store,
        persistentScopeProof: { buildId: "sqlite-cleanup-v2" },
      });

      await runtime.ensureScopeIndexed(scope);

      expect(await runtime.searchClaims(
        scope,
        "Atlas rollout active",
        1,
      )).toEqual([
        expect.objectContaining({ objectText: "completed" }),
      ]);
      expect(
        await store.get(CLAIM_PROJECTIONS_COLLECTION, fallback!.id),
      ).toEqual(fallback);
      expect(await store.query<ClaimProjectionStatus>(
        CLAIM_PROJECTION_STATUS_COLLECTION,
        { sourceMemoryId: fact.id },
      )).toEqual([
        expect.objectContaining({
          retiredRevisionIds: expect.arrayContaining([fallback!.id]),
        }),
      ]);
    } finally {
      await rm(path, { force: true });
    }
  });
});

describe("sqlite session store read-only mode", () => {
  it("treats missing session tables as empty runtime state", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-sqlite-session-readonly-${Date.now()}-${Math.random()}.db`,
    );

    try {
      const documentStore = createSQLiteDocumentStore(path);
      await documentStore.set("documents", "doc-1", {
        content: "durable only",
      });

      const readOnly = createSQLiteSessionStore(path, { readOnly: true });
      const scope = {
        userId: "u-1",
        workspaceId: "workspace-1",
        sessionId: "session-1",
      };

      await expect(readOnly.getBuffer(scope)).resolves.toBeNull();
      await expect(readOnly.getWorkingMemory(scope)).resolves.toBeNull();
      await expect(readOnly.getJournal(scope)).resolves.toBeNull();
    } finally {
      await rm(path, { force: true });
    }
  });
});
