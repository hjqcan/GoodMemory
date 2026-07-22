import type {
  DocumentStore,
  ProjectionCapableDocumentStore,
  SessionStore,
  VectorStore,
} from "./contracts";
import { PROJECTION_BATCH_SEMANTICS } from "./contracts";

export interface PostgresStorageConfig {
  url: string;
  schema?: string;
  vectorTablePrefix?: string;
}

export interface PostgresStorageMigrationEvent {
  elapsedMs: number;
  index: string;
  schema: string;
  status: "created" | "creating" | "current";
}

export interface PostgresStorageMigrationOptions {
  log?: (event: PostgresStorageMigrationEvent) => void;
}

interface PostgresStoreOptions {
  readOnly?: boolean;
}

type PostgresModule = {
  canBootstrapPostgresStorageBackend: (
    config: PostgresStorageConfig,
  ) => Promise<boolean>;
  createPostgresDocumentStore: (
    config: PostgresStorageConfig,
    options?: PostgresStoreOptions,
  ) => DocumentStore;
  createPostgresSessionStore: (
    config: PostgresStorageConfig,
    options?: PostgresStoreOptions,
  ) => SessionStore;
  createPostgresVectorStore: (
    config: PostgresStorageConfig,
    options?: PostgresStoreOptions,
  ) => VectorStore;
  migratePostgresStorageBackend: (
    config: PostgresStorageConfig,
    options?: PostgresStorageMigrationOptions,
  ) => Promise<void>;
};

let postgresModulePromise: Promise<PostgresModule> | null = null;
let postgresModuleLoader: (() => Promise<PostgresModule>) | null = null;

function describeRuntimeStorageError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

async function loadPostgresModule(): Promise<PostgresModule> {
  if (!postgresModulePromise) {
    const loader =
      postgresModuleLoader ??
      (() => import("./postgres") as Promise<PostgresModule>);
    postgresModulePromise = loader().catch((error) => {
      postgresModulePromise = null;
      throw new Error(
        [
          "GoodMemory built-in Postgres storage is unavailable in this runtime.",
          "Use Bun for the built-in Postgres adapter or inject custom adapters.",
          `Underlying error: ${describeRuntimeStorageError(error)}`,
        ].join(" "),
      );
    }) as Promise<PostgresModule>;
  }

  return postgresModulePromise;
}

export function setPostgresPublicModuleLoaderForTests(
  loader: (() => Promise<PostgresModule>) | null,
): void {
  postgresModuleLoader = loader;
  postgresModulePromise = null;
}

function createDeferredDocumentStore(
  resolveStore: () => Promise<DocumentStore>,
): ProjectionCapableDocumentStore {
  return {
    projectionBatchSemantics: PROJECTION_BATCH_SEMANTICS,
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
      return store.writeBatchIfUnchanged!(input);
    },

    async delete(collection, id) {
      const store = await resolveStore();
      return store.delete(collection, id);
    },
  };
}

function createDeferredSessionStore(
  resolveStore: () => Promise<SessionStore>,
): SessionStore {
  return {
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

export async function canBootstrapPostgresStorageBackend(
  config: PostgresStorageConfig,
): Promise<boolean> {
  const module = await loadPostgresModule();
  return module.canBootstrapPostgresStorageBackend(config);
}

export async function migratePostgresStorageBackend(
  config: PostgresStorageConfig,
  options?: PostgresStorageMigrationOptions,
): Promise<void> {
  const module = await loadPostgresModule();
  await module.migratePostgresStorageBackend(config, options);
}

export function createPostgresDocumentStore(
  config: PostgresStorageConfig,
  options?: PostgresStoreOptions,
): ProjectionCapableDocumentStore {
  let storePromise: Promise<DocumentStore> | null = null;

  return createDeferredDocumentStore(async () => {
    if (!storePromise) {
      storePromise = loadPostgresModule().then((module) =>
        module.createPostgresDocumentStore(config, options)
      );
    }

    return storePromise;
  });
}

export function createPostgresSessionStore(
  config: PostgresStorageConfig,
  options?: PostgresStoreOptions,
): SessionStore {
  let storePromise: Promise<SessionStore> | null = null;

  return createDeferredSessionStore(async () => {
    if (!storePromise) {
      storePromise = loadPostgresModule().then((module) =>
        module.createPostgresSessionStore(config, options)
      );
    }

    return storePromise;
  });
}

export function createPostgresVectorStore(
  config: PostgresStorageConfig,
  options?: PostgresStoreOptions,
): VectorStore {
  let storePromise: Promise<VectorStore> | null = null;

  return createDeferredVectorStore(async () => {
    if (!storePromise) {
      storePromise = loadPostgresModule().then((module) =>
        module.createPostgresVectorStore(config, options)
      );
    }

    return storePromise;
  });
}
