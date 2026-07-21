import { describe, expect, it } from "bun:test";
import type {
  PostgresDocumentIndexState,
  PostgresStorageMigrationEvent,
  PostgresStorageMigrationPort,
} from "../../src/storage/postgres";
import {
  canBootstrapPostgresStorageBackend,
  createPostgresDocumentStore,
  createPostgresSessionStore,
  createPostgresVectorStore,
  migratePostgresStorageBackend,
  probeReadOnlyPostgresStorageBackend,
} from "../../src/storage/postgres";

const DOCUMENT_INDEX_DEFINITIONS = {
  gm_documents_collection_idx: {
    definition:
      "CREATE INDEX gm_documents_collection_idx ON public.gm_documents USING btree (collection)",
    method: "btree",
  },
  gm_documents_document_gin_idx: {
    definition:
      "CREATE INDEX gm_documents_document_gin_idx ON public.gm_documents USING gin (document)",
    method: "gin",
  },
  gm_documents_search_text_search_idx: {
    definition:
      "CREATE INDEX gm_documents_search_text_search_idx ON public.gm_documents USING gin (to_tsvector('simple'::regconfig, COALESCE((document ->> 'searchText'::text), ''::text)))",
    method: "gin",
  },
  gm_documents_text_search_idx: {
    definition:
      "CREATE INDEX gm_documents_text_search_idx ON public.gm_documents USING gin (to_tsvector('simple'::regconfig, COALESCE((document ->> 'text'::text), ''::text)))",
    method: "gin",
  },
} as const;

type DocumentIndexName = keyof typeof DOCUMENT_INDEX_DEFINITIONS;

function currentIndex(
  name: DocumentIndexName,
  schema = "public",
): PostgresDocumentIndexState {
  const expected = DOCUMENT_INDEX_DEFINITIONS[name];
  return {
    definition: expected.definition.replace("public.", `${schema}.`),
    isPartial: false,
    isReady: true,
    isUnique: false,
    isValid: true,
    method: expected.method,
    tableName: "gm_documents",
    tableSchema: schema,
  };
}

function createMigrationPort(input?: {
  createError?: Error;
  indexes?: Partial<Record<DocumentIndexName, PostgresDocumentIndexState>>;
  version?: number | null;
}) {
  const calls: string[] = [];
  const statements: string[] = [];
  const versions: number[] = [];
  const indexes = new Map<string, PostgresDocumentIndexState>(
    Object.entries(input?.indexes ?? {}),
  );
  const port: PostgresStorageMigrationPort = {
    async runExclusive(operation) {
      calls.push("lock");
      try {
        return await operation();
      } finally {
        calls.push("unlock");
      }
    },
    async createDocumentIndex(statement) {
      calls.push("create-index");
      statements.push(statement);
      if (input?.createError) {
        throw input.createError;
      }
      const match = statement.match(
        /CREATE INDEX CONCURRENTLY IF NOT EXISTS "([^"]+)"/,
      );
      const name = match?.[1] as DocumentIndexName | undefined;
      if (!name || !(name in DOCUMENT_INDEX_DEFINITIONS)) {
        throw new Error(`Unexpected document index statement: ${statement}`);
      }
      indexes.set(name, currentIndex(name));
    },
    async ensureDocumentStore() {
      calls.push("ensure-document");
    },
    async ensureVersionStore() {
      calls.push("ensure-version-store");
    },
    async getDocumentIndex(indexName) {
      calls.push(`get-index:${indexName}`);
      return indexes.get(indexName) ?? null;
    },
    async getVersion() {
      calls.push("get-version");
      return input?.version ?? null;
    },
    async setVersion(version) {
      calls.push(`set-version:${version}`);
      versions.push(version);
    },
  };
  return { calls, port, statements, versions };
}

describe("postgres storage adapter", () => {
  it("builds missing document indexes concurrently before committing the migration version", async () => {
    const harness = createMigrationPort();
    const events: PostgresStorageMigrationEvent[] = [];

    await migratePostgresStorageBackend(
      {
        url: "postgres://user:secret@localhost:5432/goodmemory",
      },
      {
        log: (event) => events.push(event),
      },
      { port: harness.port },
    );

    expect(harness.statements).toHaveLength(4);
    expect(harness.statements.every((statement) =>
      statement.includes("CREATE INDEX CONCURRENTLY IF NOT EXISTS")
    )).toBe(true);
    expect(harness.versions).toEqual([1]);
    expect(harness.calls[0]).toBe("lock");
    expect(harness.calls.at(-2)).toBe("set-version:1");
    expect(harness.calls.at(-1)).toBe("unlock");
    expect(JSON.stringify(events)).not.toContain("secret");
    expect(events.every((event) =>
      typeof event.schema === "string" &&
      typeof event.index === "string" &&
      typeof event.elapsedMs === "number"
    )).toBe(true);
  });

  it("is idempotent when the recorded migration and every index are current", async () => {
    const harness = createMigrationPort({
      indexes: Object.fromEntries(
        Object.keys(DOCUMENT_INDEX_DEFINITIONS).map((name) => [
          name,
          currentIndex(name as DocumentIndexName),
        ]),
      ),
      version: 1,
    });

    await migratePostgresStorageBackend(
      { url: "postgres://localhost:5432/goodmemory" },
      { log: () => {} },
      { port: harness.port },
    );

    expect(harness.statements).toEqual([]);
    expect(harness.versions).toEqual([]);
  });

  it("fails closed on a same-name index with the wrong definition", async () => {
    const harness = createMigrationPort({
      indexes: {
        gm_documents_collection_idx: {
          ...currentIndex("gm_documents_collection_idx"),
          definition:
            "CREATE INDEX gm_documents_collection_idx ON public.gm_documents USING btree (id)",
        },
      },
    });

    await expect(
      migratePostgresStorageBackend(
        { url: "postgres://localhost:5432/goodmemory" },
        { log: () => {} },
        { port: harness.port },
      ),
    ).rejects.toThrow("gm_documents_collection_idx");
    expect(harness.statements).toEqual([]);
    expect(harness.versions).toEqual([]);
  });

  it("keeps JSON field names case-sensitive when validating expression indexes", async () => {
    const current = currentIndex("gm_documents_search_text_search_idx");
    const harness = createMigrationPort({
      indexes: {
        gm_documents_search_text_search_idx: {
          ...current,
          definition: current.definition.replace("'searchText'", "'searchtext'"),
        },
      },
    });

    await expect(
      migratePostgresStorageBackend(
        { url: "postgres://localhost:5432/goodmemory" },
        { log: () => {} },
        { port: harness.port },
      ),
    ).rejects.toThrow("gm_documents_search_text_search_idx");
    expect(harness.versions).toEqual([]);
  });

  it("does not commit the migration version when an index build fails", async () => {
    const harness = createMigrationPort({
      createError: new Error("index build interrupted"),
    });

    await expect(
      migratePostgresStorageBackend(
        { url: "postgres://localhost:5432/goodmemory" },
        { log: () => {} },
        { port: harness.port },
      ),
    ).rejects.toThrow("index build interrupted");
    expect(harness.versions).toEqual([]);
  });

  it("creates stores lazily without touching the database during construction", () => {
    const store = createPostgresDocumentStore({
      url: "postgres://localhost:5432/goodmemory",
    });

    expect(typeof store.get).toBe("function");
    expect(typeof store.query).toBe("function");
  });

  it("rejects invalid schema identifiers", () => {
    expect(() =>
      createPostgresDocumentStore({
        url: "postgres://localhost:5432/goodmemory",
        schema: "bad-schema",
      }),
    ).toThrow("Invalid Postgres schema");
  });

  it("rejects invalid vector table prefixes", () => {
    expect(() =>
      createPostgresVectorStore({
        url: "postgres://localhost:5432/goodmemory",
        vectorTablePrefix: "bad-prefix",
      }),
    ).toThrow("Invalid Postgres vectorTablePrefix");
  });

  it("rejects an empty postgres url", () => {
    expect(() =>
      createPostgresDocumentStore({
        url: "   ",
      }),
    ).toThrow("Postgres storage requires a non-empty url");
  });

  it("treats missing pgvector support as an unusable auto target", async () => {
    const ensuredUrls: string[] = [];

    await expect(
      canBootstrapPostgresStorageBackend(
        {
          url: "postgres://localhost:5432/goodmemory",
        },
        {
          getVectorExtensionStatus: async () => "missing",
          ensureStorageBackend: async (config) => {
            ensuredUrls.push(config.url);
          },
        },
      ),
    ).resolves.toBe(false);

    expect(ensuredUrls).toEqual([]);
  });

  it("requires backend bootstrap before declaring a postgres auto target usable", async () => {
    const calls: string[] = [];

    await expect(
      canBootstrapPostgresStorageBackend(
        {
          url: "postgres://localhost:5432/goodmemory",
        },
        {
          getVectorExtensionStatus: async () => {
            calls.push("status");
            return "available";
          },
          ensureStorageBackend: async () => {
            calls.push("ensure");
          },
        },
      ),
    ).resolves.toBe(true);

    expect(calls).toEqual(["status", "ensure"]);
  });

  it("surfaces bootstrap failures even when pgvector is advertised", async () => {
    await expect(
      canBootstrapPostgresStorageBackend(
        {
          url: "postgres://localhost:5432/goodmemory",
        },
        {
          getVectorExtensionStatus: async () => "installed",
          ensureStorageBackend: async () => {
            throw new Error("permission denied for schema public");
          },
        },
      ),
    ).rejects.toThrow("permission denied for schema public");
  });

  it("treats missing pgvector support as an unusable read-only postgres target", async () => {
    const hasExistingCalls: string[] = [];

    await expect(
      probeReadOnlyPostgresStorageBackend(
        {
          url: "postgres://localhost:5432/goodmemory",
        },
        {
          getVectorExtensionStatus: async () => "missing",
          hasExistingStorageBackend: async () => {
            hasExistingCalls.push("existing");
            return true;
          },
        },
      ),
    ).resolves.toBe("unusable");

    expect(hasExistingCalls).toEqual([]);
  });

  it("treats an installed existing backend as readable in read-only mode", async () => {
    await expect(
      probeReadOnlyPostgresStorageBackend(
        {
          url: "postgres://localhost:5432/goodmemory",
        },
        {
          getVectorExtensionStatus: async () => "installed",
          hasExistingStorageBackend: async () => true,
        },
      ),
    ).resolves.toBe("readable");
  });

  it("treats an advertised but uninstalled vector extension as inconclusive in read-only mode", async () => {
    await expect(
      probeReadOnlyPostgresStorageBackend(
        {
          url: "postgres://localhost:5432/goodmemory",
        },
        {
          getVectorExtensionStatus: async () => "available",
          hasExistingStorageBackend: async () => true,
        },
      ),
    ).resolves.toBe("inconclusive");
  });

  it("treats a partially initialized backend as inconclusive in read-only mode", async () => {
    await expect(
      probeReadOnlyPostgresStorageBackend(
        {
          url: "postgres://localhost:5432/goodmemory",
        },
        {
          getVectorExtensionStatus: async () => "installed",
          hasExistingStorageBackend: async () => false,
        },
      ),
    ).resolves.toBe("inconclusive");
  });

  it("rejects document mutations in read-only mode before touching postgres", async () => {
    const store = createPostgresDocumentStore(
      {
        url: "postgres://localhost:5432/goodmemory",
      },
      {
        readOnly: true,
      },
    );

    await expect(
      store.set("facts", "fact-1", {
        id: "fact-1",
      }),
    ).rejects.toThrow("Postgres document store is read-only in this context.");
    await expect(
      store.update("facts", "fact-1", {
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("Postgres document store is read-only in this context.");
    await expect(store.delete("facts", "fact-1")).rejects.toThrow(
      "Postgres document store is read-only in this context.",
    );
  });

  it("rejects session mutations in read-only mode before touching postgres", async () => {
    const store = createPostgresSessionStore(
      {
        url: "postgres://localhost:5432/goodmemory",
      },
      {
        readOnly: true,
      },
    );
    const scope = {
      userId: "u-1",
      workspaceId: "w-1",
      sessionId: "s-1",
    };

    await expect(
      store.saveBuffer(scope, {
        sessionId: "s-1",
        userId: "u-1",
        messages: [],
        summary: null,
        summaryUpToIndex: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastActiveAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("Postgres session store is read-only in this context.");
    await expect(store.deleteBuffersByScope(scope)).rejects.toThrow(
      "Postgres session store is read-only in this context.",
    );
    await expect(
      store.deleteBufferIfUnchanged(scope, {
        sessionId: "s-1",
        userId: "u-1",
        messages: [],
        summary: null,
        summaryUpToIndex: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastActiveAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("Postgres session store is read-only in this context.");
  });

  it("rejects vector mutations in read-only mode before touching postgres", async () => {
    const store = createPostgresVectorStore(
      {
        url: "postgres://localhost:5432/goodmemory",
      },
      {
        readOnly: true,
      },
    );

    await expect(
      store.upsert("facts", [
        {
          id: "fact-1",
          embedding: [0.1, 0.2],
          metadata: {},
          content: "fact",
        },
      ]),
    ).rejects.toThrow("Postgres vector store is read-only in this context.");
    await expect(store.delete("facts", "fact-1")).rejects.toThrow(
      "Postgres vector store is read-only in this context.",
    );
  });
});
