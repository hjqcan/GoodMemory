import {
  bindDocumentStoreIdentity,
  resolveDocumentStoreIdentity,
} from "./documentStoreIdentity";
import type {
  DocumentStore,
  ProjectionCapableDocumentStore,
  SessionStore,
  StorageFilter,
  VectorSearchResult,
  VectorStore,
} from "./contracts";
import { PROJECTION_BATCH_SEMANTICS, QUERY_SNAPSHOT_BATCH_SEMANTICS } from "./contracts";

interface SQLiteStoreOptions {
  readOnly?: boolean;
}

interface SQLiteVectorStoreDependencies {
  loadVectorExtension?: (
    config: Record<string, unknown>,
    loader: unknown,
  ) => unknown;
  runtimeResolution?: unknown;
  vectorExtensionConfig?: Record<string, unknown>;
  runExtensionSearch?: (input: {
    collection: string;
    config: Record<string, unknown>;
    database: unknown;
    filter?: StorageFilter;
    queryEmbedding: number[];
    topK: number;
  }) => VectorSearchResult[] | null;
}

type SQLiteModule = {
  createSQLiteDocumentStore: (
    path: string,
    options?: SQLiteStoreOptions,
  ) => DocumentStore;
  createSQLiteSessionStore: (
    path: string,
    options?: SQLiteStoreOptions,
  ) => SessionStore;
  createSQLiteVectorStore: (
    path: string,
    options?: SQLiteStoreOptions,
    dependencies?: SQLiteVectorStoreDependencies,
  ) => VectorStore;
};

let sqliteModulePromise: Promise<SQLiteModule> | null = null;
let sqliteModuleLoader: (() => Promise<SQLiteModule>) | null = null;

function describeRuntimeStorageError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

async function loadSQLiteModule(): Promise<SQLiteModule> {
  if (!sqliteModulePromise) {
    const loader =
      sqliteModuleLoader ??
      (() => import("./sqlite") as Promise<SQLiteModule>);
    sqliteModulePromise = loader().catch((error) => {
      sqliteModulePromise = null;
      throw new Error(
        [
          "GoodMemory built-in SQLite storage is unavailable in this runtime.",
          "Use Bun for the built-in SQLite adapter, choose storage.provider=\"memory\", or inject custom adapters.",
          `Underlying error: ${describeRuntimeStorageError(error)}`,
        ].join(" "),
      );
    }) as Promise<SQLiteModule>;
  }

  return sqliteModulePromise;
}

export function setSQLitePublicModuleLoaderForTests(
  loader: (() => Promise<SQLiteModule>) | null,
): void {
  sqliteModuleLoader = loader;
  sqliteModulePromise = null;
}

function createDeferredDocumentStore(
  resolveStore: () => Promise<DocumentStore>,
): ProjectionCapableDocumentStore {
  return bindDocumentStoreIdentity({
    projectionBatchSemantics: PROJECTION_BATCH_SEMANTICS,
    querySnapshotBatchSemantics: QUERY_SNAPSHOT_BATCH_SEMANTICS,
    async set(collection, id, document) {
      const store = await resolveStore();
      return store.set(collection, id, document);
    },

    async get(collection, id) {
      const store = await resolveStore();
      return store.get(collection, id);
    },

    async update(collection, id, patch) {
      const store = await resolveStore();
      return store.update(collection, id, patch);
    },

    async query(collection, filter) {
      const store = await resolveStore();
      return store.query(collection, filter);
    },

    async queryPage(collection, input) {
      const store = await resolveStore();
      return store.queryPage!(collection, input);
    },

    async searchText(collection, input) {
      const store = await resolveStore();
      return store.searchText!(collection, input);
    },

    async writeBatchIfUnchanged(input) {
      const store = await resolveStore();
      if (input.querySnapshots?.length && store.querySnapshotBatchSemantics !== QUERY_SNAPSHOT_BATCH_SEMANTICS) return false;
      return store.writeBatchIfUnchanged!(input);
    },

    async delete(collection, id) {
      const store = await resolveStore();
      return store.delete(collection, id);
    },
  }, async () => resolveDocumentStoreIdentity(await resolveStore()));
}

function createDeferredSessionStore(
  resolveStore: () => Promise<SessionStore>,
): SessionStore {
  return {
    async listLegacyScopes() {
      const store = await resolveStore();
      return store.listLegacyScopes!();
    },

    async recoverLegacyState(input) {
      const store = await resolveStore();
      return store.recoverLegacyState!(input);
    },

    async saveBuffer(scope, buffer) {
      const store = await resolveStore();
      return store.saveBuffer(scope, buffer);
    },

    async saveBufferIfUnchanged(scope, expectedBuffer, nextBuffer) {
      const store = await resolveStore();
      return store.saveBufferIfUnchanged(scope, expectedBuffer, nextBuffer);
    },

    async getBuffer(scope) {
      const store = await resolveStore();
      return store.getBuffer(scope);
    },

    async deleteBufferIfUnchanged(scope, expectedBuffer) {
      const store = await resolveStore();
      return store.deleteBufferIfUnchanged(scope, expectedBuffer);
    },

    async deleteBuffersByScope(scope) {
      const store = await resolveStore();
      return store.deleteBuffersByScope(scope);
    },

    async saveWorkingMemory(scope, snapshot) {
      const store = await resolveStore();
      return store.saveWorkingMemory(scope, snapshot);
    },

    async getWorkingMemory(scope) {
      const store = await resolveStore();
      return store.getWorkingMemory(scope);
    },

    async deleteWorkingMemoryByScope(scope) {
      const store = await resolveStore();
      return store.deleteWorkingMemoryByScope(scope);
    },

    async saveJournal(scope, journal) {
      const store = await resolveStore();
      return store.saveJournal(scope, journal);
    },

    async getJournal(scope) {
      const store = await resolveStore();
      return store.getJournal(scope);
    },

    async deleteJournalsByScope(scope) {
      const store = await resolveStore();
      return store.deleteJournalsByScope(scope);
    },
  };
}

function createDeferredVectorStore(
  resolveStore: () => Promise<VectorStore>,
): VectorStore {
  return {
    async upsert(collection, records) {
      const store = await resolveStore();
      return store.upsert(collection, records);
    },

    async get(collection, id) {
      const store = await resolveStore();
      return store.get(collection, id);
    },

    async search(collection, queryEmbedding, input) {
      const store = await resolveStore();
      return store.search(collection, queryEmbedding, input);
    },

    async delete(collection, id) {
      const store = await resolveStore();
      return store.delete(collection, id);
    },
  };
}

// Share an in-flight/successful initialization, but let a later operation retry
// an unavailable database. Failures from methods on a ready store do not evict it.
function createStoreResolver<TStore>(initialize: () => Promise<TStore>): () => Promise<TStore> {
  let storePromise: Promise<TStore> | null = null;
  return () => {
    if (!storePromise) {
      const attempt = initialize().catch((error) => {
        if (storePromise === attempt) storePromise = null;
        throw error;
      });
      storePromise = attempt;
    }
    return storePromise;
  };
}

export function createSQLiteDocumentStore(
  path: string,
  options?: SQLiteStoreOptions,
): ProjectionCapableDocumentStore {
  return createDeferredDocumentStore(createStoreResolver(() =>
    loadSQLiteModule().then((module) => module.createSQLiteDocumentStore(path, options))
  ));
}

export function createSQLiteSessionStore(
  path: string,
  options?: SQLiteStoreOptions,
): SessionStore {
  return createDeferredSessionStore(createStoreResolver(() =>
    loadSQLiteModule().then((module) => module.createSQLiteSessionStore(path, options))
  ));
}

export function createSQLiteVectorStore(
  path: string,
  options?: SQLiteStoreOptions,
  dependencies?: SQLiteVectorStoreDependencies,
): VectorStore {
  return createDeferredVectorStore(createStoreResolver(() =>
    loadSQLiteModule().then((module) => module.createSQLiteVectorStore(path, options, dependencies))
  ));
}
