import type {
  DocumentQueryPageInput,
  DocumentStore,
  DocumentTextSearchInput,
  ProjectionCapableDocumentStore,
  SessionStore,
  StorageDocument,
  StorageFilter,
  VectorRecord,
  VectorSearchInput,
  VectorSearchResult,
  VectorStore,
} from "./contracts";
import { PROJECTION_BATCH_SEMANTICS } from "./contracts";
import {
  canBootstrapPostgresStorageBackend,
  createPostgresDocumentStore,
  createPostgresSessionStore,
  createPostgresVectorStore,
} from "./postgresPublic";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "./memory";
import {
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
  createSQLiteVectorStore,
} from "./sqlitePublic";
import type { MemoryScope } from "../domain/scope";
import type {
  SessionBuffer,
  SessionJournal,
  WorkingMemorySnapshot,
} from "../domain/records";

type AutoStorageConfig =
  | {
      postgresUrl?: string;
      sqliteUrl: string;
    }
  | {
      fallbackProvider: "memory";
      postgresUrl?: string;
    };

interface ResolvedStorageBackend {
  documentStore: ProjectionCapableDocumentStore;
  sessionStore: SessionStore;
  vectorStore: VectorStore;
}

function describeAutoStorageProbeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

function createAutoDocumentStore(
  resolveBackend: () => Promise<ResolvedStorageBackend>,
): ProjectionCapableDocumentStore {
  return {
    projectionBatchSemantics: PROJECTION_BATCH_SEMANTICS,
    async set<TDocument extends StorageDocument>(
      collection: string,
      id: string,
      document: TDocument,
    ) {
      const backend = await resolveBackend();
      return backend.documentStore.set(collection, id, document);
    },

    async get<TDocument extends StorageDocument>(collection: string, id: string) {
      const backend = await resolveBackend();
      return backend.documentStore.get<TDocument>(collection, id);
    },

    async update<TDocument extends StorageDocument>(
      collection: string,
      id: string,
      patch: Partial<TDocument>,
    ) {
      const backend = await resolveBackend();
      return backend.documentStore.update<TDocument>(collection, id, patch);
    },

    async query<TDocument extends StorageDocument>(
      collection: string,
      filter?: StorageFilter,
    ) {
      const backend = await resolveBackend();
      return backend.documentStore.query<TDocument>(collection, filter);
    },

    async queryPage<TDocument extends StorageDocument>(
      collection: string,
      input: DocumentQueryPageInput,
    ) {
      const backend = await resolveBackend();
      return backend.documentStore.queryPage!<TDocument>(collection, input);
    },

    async searchText<TDocument extends StorageDocument>(
      collection: string,
      input: DocumentTextSearchInput,
    ) {
      const backend = await resolveBackend();
      return backend.documentStore.searchText!<TDocument>(collection, input);
    },

    async writeBatchIfUnchanged(input) {
      const backend = await resolveBackend();
      return backend.documentStore.writeBatchIfUnchanged(input);
    },

    async delete(collection, id) {
      const backend = await resolveBackend();
      return backend.documentStore.delete(collection, id);
    },
  };
}

function createAutoSessionStore(
  resolveBackend: () => Promise<ResolvedStorageBackend>,
): SessionStore {
  return {
    saveBuffer(scope: MemoryScope, buffer: SessionBuffer) {
      return resolveBackend().then((backend) =>
        backend.sessionStore.saveBuffer(scope, buffer),
      );
    },

    saveBufferIfUnchanged(
      scope: MemoryScope,
      expectedBuffer: SessionBuffer | null,
      nextBuffer: SessionBuffer,
    ) {
      return resolveBackend().then((backend) =>
        backend.sessionStore.saveBufferIfUnchanged(
          scope,
          expectedBuffer,
          nextBuffer,
        ),
      );
    },

    getBuffer(scope: MemoryScope) {
      return resolveBackend().then((backend) => backend.sessionStore.getBuffer(scope));
    },

    deleteBufferIfUnchanged(scope: MemoryScope, expectedBuffer: SessionBuffer) {
      return resolveBackend().then((backend) =>
        backend.sessionStore.deleteBufferIfUnchanged(scope, expectedBuffer),
      );
    },

    deleteBuffersByScope(scope: MemoryScope) {
      return resolveBackend().then((backend) =>
        backend.sessionStore.deleteBuffersByScope(scope),
      );
    },

    saveWorkingMemory(scope: MemoryScope, snapshot: WorkingMemorySnapshot) {
      return resolveBackend().then((backend) =>
        backend.sessionStore.saveWorkingMemory(scope, snapshot),
      );
    },

    getWorkingMemory(scope: MemoryScope) {
      return resolveBackend().then((backend) =>
        backend.sessionStore.getWorkingMemory(scope),
      );
    },

    deleteWorkingMemoryByScope(scope: MemoryScope) {
      return resolveBackend().then((backend) =>
        backend.sessionStore.deleteWorkingMemoryByScope(scope),
      );
    },

    saveJournal(scope: MemoryScope, journal: SessionJournal) {
      return resolveBackend().then((backend) =>
        backend.sessionStore.saveJournal(scope, journal),
      );
    },

    getJournal(scope: MemoryScope) {
      return resolveBackend().then((backend) => backend.sessionStore.getJournal(scope));
    },

    deleteJournalsByScope(scope: MemoryScope) {
      return resolveBackend().then((backend) =>
        backend.sessionStore.deleteJournalsByScope(scope),
      );
    },
  };
}

function createAutoVectorStore(
  resolveBackend: () => Promise<ResolvedStorageBackend>,
): VectorStore {
  return {
    async upsert(collection: string, records: VectorRecord[]) {
      const backend = await resolveBackend();
      return backend.vectorStore.upsert(collection, records);
    },

    async get(collection: string, id: string) {
      const backend = await resolveBackend();
      return backend.vectorStore.get(collection, id);
    },

    async search(
      collection: string,
      queryEmbedding: number[],
      input: VectorSearchInput,
    ): Promise<VectorSearchResult[]> {
      const backend = await resolveBackend();
      return backend.vectorStore.search(collection, queryEmbedding, input);
    },

    async delete(collection: string, id: string) {
      const backend = await resolveBackend();
      return backend.vectorStore.delete(collection, id);
    },
  };
}

export function createAutoStorageAdapters(
  config: AutoStorageConfig,
): {
  documentStore: DocumentStore;
  sessionStore: SessionStore;
  vectorStore: VectorStore;
} {
  let inMemoryBackend: ResolvedStorageBackend | null = null;
  let sqliteBackend: ResolvedStorageBackend | null = null;
  let postgresBackend: ResolvedStorageBackend | null = null;
  let resolution: Promise<ResolvedStorageBackend> | null = null;

  function getInMemoryBackend(): ResolvedStorageBackend {
    if (inMemoryBackend) {
      return inMemoryBackend;
    }

    inMemoryBackend = {
      documentStore: createInMemoryDocumentStore(),
      sessionStore: createInMemorySessionStore(),
      vectorStore: createInMemoryVectorStore(),
    };

    return inMemoryBackend;
  }

  function getSQLiteBackend(): ResolvedStorageBackend {
    if (!("sqliteUrl" in config)) {
      return getInMemoryBackend();
    }

    if (sqliteBackend) {
      return sqliteBackend;
    }

    sqliteBackend = {
      documentStore: createSQLiteDocumentStore(config.sqliteUrl),
      sessionStore: createSQLiteSessionStore(config.sqliteUrl),
      vectorStore: createSQLiteVectorStore(config.sqliteUrl),
    };

    return sqliteBackend;
  }

  function getPostgresBackend(): ResolvedStorageBackend {
    if (!config.postgresUrl) {
      throw new Error("Postgres backend requested without a postgres url.");
    }

    if (postgresBackend) {
      return postgresBackend;
    }

    postgresBackend = {
      documentStore: createPostgresDocumentStore({
        url: config.postgresUrl,
      }),
      sessionStore: createPostgresSessionStore({
        url: config.postgresUrl,
      }),
      vectorStore: createPostgresVectorStore({
        url: config.postgresUrl,
      }),
    };

    return postgresBackend;
  }

  async function resolveBackend(): Promise<ResolvedStorageBackend> {
    if (!resolution) {
      resolution = (async () => {
        if (config.postgresUrl) {
          let usable = false;

          try {
            usable = await canBootstrapPostgresStorageBackend({
              url: config.postgresUrl,
            });
          } catch (error) {
            throw new Error(
              [
                "Auto storage could not establish the configured postgres backend as usable durable authority.",
                "Falling back to sqlite would risk corrupting durable authority.",
                `Underlying error: ${describeAutoStorageProbeError(error)}`,
              ].join(" "),
            );
          }

          if (usable) {
            return getPostgresBackend();
          }
        }

        return "sqliteUrl" in config
          ? getSQLiteBackend()
          : getInMemoryBackend();
      })();
    }

    return resolution;
  }

  return {
    documentStore: createAutoDocumentStore(resolveBackend),
    sessionStore: createAutoSessionStore(resolveBackend),
    vectorStore: createAutoVectorStore(resolveBackend),
  };
}
