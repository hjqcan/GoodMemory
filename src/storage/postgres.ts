import { SQL } from "bun";
import type {
  SessionBuffer,
  SessionJournal,
  WorkingMemorySnapshot,
} from "../domain/records";
import type { MemoryScope } from "../domain/scope";
import { scopeToKey, scopeToPrefix } from "../domain/scope";
import type {
  ConditionalDocumentWriteBatch,
  DocumentQueryPageInput,
  DocumentStore,
  DocumentTextSearchInput,
  ProjectionCapableDocumentStore,
  SessionStore,
  StorageDocument,
  StorageFilter,
  VectorSearchResult,
  VectorStore,
} from "./contracts";
import {
  PROJECTION_BATCH_SEMANTICS,
  assertDocumentQueryPageInput,
  assertDocumentTextSearchInput,
} from "./contracts";
import {
  buildPostgresDocumentSearchTerms,
  tokenizeDocumentSearch,
} from "./textSearch";

export interface PostgresStorageConfig {
  url: string;
  schema?: string;
  vectorTablePrefix?: string;
}

export type PostgresVectorExtensionStatus =
  | "available"
  | "installed"
  | "missing";

export type ReadOnlyPostgresStorageProbeResult =
  | "readable"
  | "unusable"
  | "inconclusive";

export interface PostgresStorageBootstrapDependencies {
  ensureStorageBackend?: (config: PostgresStorageConfig) => Promise<void>;
  getVectorExtensionStatus?: (
    config: PostgresStorageConfig,
  ) => Promise<PostgresVectorExtensionStatus>;
}

export interface ReadOnlyPostgresStorageProbeDependencies {
  getVectorExtensionStatus?: (
    config: PostgresStorageConfig,
  ) => Promise<PostgresVectorExtensionStatus>;
  hasExistingStorageBackend?: (config: PostgresStorageConfig) => Promise<boolean>;
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

export interface PostgresDocumentIndexState {
  definition: string;
  isPartial: boolean;
  isReady: boolean;
  isUnique: boolean;
  isValid: boolean;
  method: string;
  tableName: string;
  tableSchema: string;
}

export interface PostgresStorageMigrationPort {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
  createDocumentIndex(statement: string): Promise<void>;
  ensureDocumentStore(): Promise<void>;
  ensureVersionStore(): Promise<void>;
  getDocumentIndex(indexName: string): Promise<PostgresDocumentIndexState | null>;
  getVersion(): Promise<number | null>;
  setVersion(version: number): Promise<void>;
}

export interface PostgresStorageMigrationDependencies {
  port?: PostgresStorageMigrationPort;
}

interface PostgresStoreOptions {
  readOnly?: boolean;
}

type SessionStateKind = "buffer" | "working_memory" | "journal";

interface DocumentRow {
  document_json: string;
}

interface DocumentPageRow extends DocumentRow {
  id: string;
}

interface DocumentSearchRow extends DocumentPageRow {
  score: number;
}

interface SessionRow {
  payload_json: string;
}

interface VectorRow {
  id: string;
  embedding_json: string;
  metadata_json: string;
  content: string;
  score: number;
}

interface DocumentIndexRow {
  definition: string;
  is_partial: boolean;
  is_ready: boolean;
  is_unique: boolean;
  is_valid: boolean;
  method: string;
  table_name: string;
  table_schema: string;
}

interface StorageMigrationVersionRow {
  version: number;
}

interface PostgresRuntime {
  sql: SQL;
  schema: string;
  documentTable: string;
  sessionStateTable: string;
  vectorTable: string;
  hasDocumentStore(): Promise<boolean>;
  hasSessionStore(): Promise<boolean>;
  hasVectorStore(): Promise<boolean>;
  ensureDocumentStore(): Promise<void>;
  ensureSessionStore(): Promise<void>;
  ensureVectorStore(): Promise<void>;
}

const DEFAULT_SCHEMA = "public";
const DEFAULT_VECTOR_TABLE_PREFIX = "gm";
const DOCUMENT_TABLE_NAME = "gm_documents";
const SESSION_STATE_TABLE_NAME = "gm_session_state";
const STORAGE_SCHEMA_TABLE_NAME = "gm_storage_schema";
const DOCUMENT_INDEX_MIGRATION_COMPONENT = "document_indexes";
const DOCUMENT_INDEX_SCHEMA_VERSION = 1;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const DOCUMENT_INDEX_DEFINITIONS = [
  {
    method: "btree",
    methodAndKey: "USING btree (collection)",
    name: "gm_documents_collection_idx",
  },
  {
    method: "gin",
    methodAndKey: "USING gin (document)",
    name: "gm_documents_document_gin_idx",
  },
  {
    method: "gin",
    methodAndKey:
      "USING gin (to_tsvector('simple', COALESCE((document ->> 'text'), '')))",
    name: "gm_documents_text_search_idx",
  },
  {
    method: "gin",
    methodAndKey:
      "USING gin (to_tsvector('simple', COALESCE((document ->> 'searchText'), '')))",
    name: "gm_documents_search_text_search_idx",
  },
] as const;

const runtimeCache = new Map<string, PostgresRuntime>();

function normalizeUrl(url: string): string {
  const trimmed = url.trim();

  if (trimmed.length === 0) {
    throw new Error("Postgres storage requires a non-empty url");
  }

  return trimmed;
}

function validateIdentifier(value: string, label: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(
      `Invalid Postgres ${label}: ${value}. Use only letters, digits, and underscores, and start with a letter or underscore.`,
    );
  }

  return value;
}

function quoteIdentifier(value: string): string {
  return `"${value}"`;
}

function qualifyTable(schema: string, tableName: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`;
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

function bindJson(value: unknown): string {
  return serializeJson(value);
}

function parseJson<TValue>(value: unknown): TValue {
  if (typeof value !== "string") {
    return value as TValue;
  }

  const parsed = JSON.parse(value) as unknown;

  if (typeof parsed !== "string") {
    return parsed as TValue;
  }

  try {
    return JSON.parse(parsed) as TValue;
  } catch {
    return parsed as TValue;
  }
}

function hasFilter(filter?: StorageFilter): filter is StorageFilter {
  return Boolean(filter && Object.keys(filter).length > 0);
}

function buildJsonbFilterClause(
  column: string,
  filter: StorageFilter | undefined,
  values: unknown[],
): string {
  if (!hasFilter(filter)) {
    return "";
  }

  values.push(bindJson(filter));
  return ` AND ${column} @> $${values.length}::text::jsonb`;
}

function serializePgArray(values: number[]): string {
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Postgres vector embeddings must contain only finite numbers");
  }

  return `{${values.join(",")}}`;
}

function serializeVectorLiteral(values: number[]): string {
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Postgres vector embeddings must contain only finite numbers");
  }

  return `[${values.join(",")}]`;
}

function createInitializer(action: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | null = null;

  return async () => {
    if (!pending) {
      pending = action().catch((error) => {
        pending = null;
        throw error;
      });
    }

    await pending;
  };
}

function createReadOnlyMutationError(store: string): Error {
  return new Error(`Postgres ${store} store is read-only in this context.`);
}

async function relationExists(sql: SQL, relationName: string): Promise<boolean> {
  const rows = await sql.unsafe<Array<{ oid: string | null }>>(
    "SELECT to_regclass($1)::text AS oid",
    [relationName],
  );

  return rows[0]?.oid !== null && rows[0]?.oid !== undefined;
}

function createRuntime(config: PostgresStorageConfig): PostgresRuntime {
  const url = normalizeUrl(config.url);
  const schema = validateIdentifier(config.schema ?? DEFAULT_SCHEMA, "schema");
  const vectorTablePrefix = validateIdentifier(
    config.vectorTablePrefix ?? DEFAULT_VECTOR_TABLE_PREFIX,
    "vectorTablePrefix",
  );
  const vectorTableName = `${vectorTablePrefix}_vectors`;
  const cacheKey = serializeJson({
    url,
    schema,
    vectorTablePrefix,
  });
  const cached = runtimeCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const sql = new SQL(url, { prepare: false });
  const quotedSchema = quoteIdentifier(schema);
  const documentTable = qualifyTable(schema, DOCUMENT_TABLE_NAME);
  const sessionStateTable = qualifyTable(schema, SESSION_STATE_TABLE_NAME);
  const vectorTable = qualifyTable(schema, vectorTableName);
  const documentRelationName = `${schema}.${DOCUMENT_TABLE_NAME}`;
  const sessionStateRelationName = `${schema}.${SESSION_STATE_TABLE_NAME}`;
  const vectorRelationName = `${schema}.${vectorTableName}`;

  const ensureSchema = createInitializer(async () => {
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);
  });

  const runtime: PostgresRuntime = {
    sql,
    schema,
    documentTable,
    sessionStateTable,
    vectorTable,
    hasDocumentStore: () => relationExists(sql, documentRelationName),
    hasSessionStore: () => relationExists(sql, sessionStateRelationName),
    hasVectorStore: () => relationExists(sql, vectorRelationName),
    ensureDocumentStore: createInitializer(async () => {
      await ensureSchema();
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS ${documentTable} (
          collection TEXT NOT NULL,
          id TEXT NOT NULL,
          document JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (collection, id)
        )
      `);
    }),
    ensureSessionStore: createInitializer(async () => {
      await ensureSchema();
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS ${sessionStateTable} (
          scope_key TEXT NOT NULL,
          state_kind TEXT NOT NULL,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (scope_key, state_kind)
        )
      `);
    }),
    ensureVectorStore: createInitializer(async () => {
      await ensureSchema();
      await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS ${vectorTable} (
          collection TEXT NOT NULL,
          id TEXT NOT NULL,
          embedding DOUBLE PRECISION[] NOT NULL,
          metadata JSONB NOT NULL,
          content TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (collection, id)
        )
      `);
      await sql.unsafe(`
        CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${vectorTableName}_collection_idx`)}
        ON ${vectorTable} (collection)
      `);
      await sql.unsafe(`
        CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${vectorTableName}_metadata_gin_idx`)}
        ON ${vectorTable} USING GIN (metadata)
      `);
    }),
  };

  runtimeCache.set(cacheKey, runtime);
  return runtime;
}

function createPostgresSessionStateStore<TValue>(
  runtime: PostgresRuntime,
  stateKind: SessionStateKind,
  options?: PostgresStoreOptions,
): {
  set(scope: MemoryScope, value: TValue): Promise<void>;
  get(scope: MemoryScope): Promise<TValue | null>;
  deleteIfUnchanged(scope: MemoryScope, expectedValue: TValue): Promise<boolean>;
  deleteByScope(scope: MemoryScope): Promise<number>;
} {
  return {
    async set(scope, value) {
      if (options?.readOnly) {
        throw createReadOnlyMutationError("session");
      }

      await runtime.ensureSessionStore();
      await runtime.sql.unsafe(
        `
          INSERT INTO ${runtime.sessionStateTable} (
            scope_key,
            state_kind,
            payload,
            updated_at
          ) VALUES (
            $1,
            $2,
            $3::text::jsonb,
            NOW()
          )
          ON CONFLICT (scope_key, state_kind)
          DO UPDATE SET
            payload = EXCLUDED.payload,
            updated_at = EXCLUDED.updated_at
        `,
        [scopeToKey(scope), stateKind, bindJson(value)],
      );
    },

    async get(scope) {
      if (options?.readOnly && !(await runtime.hasSessionStore())) {
        return null;
      }

      if (!options?.readOnly) {
        await runtime.ensureSessionStore();
      }
      const rows = await runtime.sql.unsafe<SessionRow[]>(
        `
          SELECT payload::text AS payload_json
          FROM ${runtime.sessionStateTable}
          WHERE scope_key = $1 AND state_kind = $2
        `,
        [scopeToKey(scope), stateKind],
      );
      const row = rows[0];

      return row ? parseJson<TValue>(row.payload_json) : null;
    },

    async deleteIfUnchanged(scope, expectedValue) {
      if (options?.readOnly) {
        throw createReadOnlyMutationError("session");
      }

      await runtime.ensureSessionStore();
      const rows = await runtime.sql.unsafe<Array<{ count: number }>>(
        `
          DELETE FROM ${runtime.sessionStateTable}
          WHERE scope_key = $1
            AND state_kind = $2
            AND payload = $3::text::jsonb
          RETURNING 1 AS count
        `,
        [scopeToKey(scope), stateKind, bindJson(expectedValue)],
      );
      return rows.length === 1;
    },

    async deleteByScope(scope) {
      if (options?.readOnly) {
        throw createReadOnlyMutationError("session");
      }

      await runtime.ensureSessionStore();

      if (scope.sessionId !== undefined) {
        const rows = await runtime.sql.unsafe<Array<{ count: number }>>(
          `
            DELETE FROM ${runtime.sessionStateTable}
            WHERE scope_key = $1 AND state_kind = $2
            RETURNING 1 AS count
          `,
          [scopeToKey(scope), stateKind],
        );
        return rows.length;
      }

      const rows = await runtime.sql.unsafe<Array<{ count: number }>>(
        `
          DELETE FROM ${runtime.sessionStateTable}
          WHERE scope_key LIKE $1 AND state_kind = $2
          RETURNING 1 AS count
        `,
        [`${scopeToPrefix(scope)}%`, stateKind],
      );
      return rows.length;
    },
  };
}

export function createPostgresDocumentStore(
  config: PostgresStorageConfig,
  options?: PostgresStoreOptions,
): ProjectionCapableDocumentStore {
  const runtime = createRuntime(config);

  return {
    projectionBatchSemantics: PROJECTION_BATCH_SEMANTICS,
    async set<TDocument extends StorageDocument>(
      collection: string,
      id: string,
      document: TDocument,
    ) {
      if (options?.readOnly) {
        throw createReadOnlyMutationError("document");
      }

      await runtime.ensureDocumentStore();
      await runtime.sql.unsafe(
        `
          INSERT INTO ${runtime.documentTable} (
            collection,
            id,
            document,
            created_at,
            updated_at
          ) VALUES (
            $1,
            $2,
            $3::text::jsonb,
            NOW(),
            NOW()
          )
          ON CONFLICT (collection, id)
          DO UPDATE SET
            document = EXCLUDED.document,
            updated_at = EXCLUDED.updated_at
        `,
        [collection, id, bindJson(document)],
      );
    },

    async get<TDocument extends StorageDocument>(collection: string, id: string) {
      if (options?.readOnly && !(await runtime.hasDocumentStore())) {
        return null;
      }

      if (!options?.readOnly) {
        await runtime.ensureDocumentStore();
      }
      const rows = await runtime.sql.unsafe<DocumentRow[]>(
        `
          SELECT document::text AS document_json
          FROM ${runtime.documentTable}
          WHERE collection = $1 AND id = $2
        `,
        [collection, id],
      );
      const row = rows[0];

      return row ? parseJson<TDocument>(row.document_json) : null;
    },

    async update<TDocument extends StorageDocument>(
      collection: string,
      id: string,
      patch: Partial<TDocument>,
    ) {
      if (options?.readOnly) {
        throw createReadOnlyMutationError("document");
      }

      await runtime.ensureDocumentStore();
      const rows = await runtime.sql.unsafe<Array<{ id: string }>>(
        `
          UPDATE ${runtime.documentTable}
          SET
            document = document || $3::text::jsonb,
            updated_at = NOW()
          WHERE collection = $1 AND id = $2
          RETURNING id
        `,
        [collection, id, bindJson(patch)],
      );

      if (rows.length === 0) {
        throw new Error(`Document not found for update: ${collection}/${id}`);
      }
    },

    async query<TDocument extends StorageDocument>(
      collection: string,
      filter?: Record<string, unknown>,
    ) {
      if (options?.readOnly && !(await runtime.hasDocumentStore())) {
        return [];
      }

      if (!options?.readOnly) {
        await runtime.ensureDocumentStore();
      }
      const values: unknown[] = [collection];
      const filterClause = buildJsonbFilterClause("document", filter, values);
      const rows = await runtime.sql.unsafe<DocumentRow[]>(
        `
          SELECT document::text AS document_json
          FROM ${runtime.documentTable}
          WHERE collection = $1${filterClause}
          ORDER BY id ASC
        `,
        values,
      );

      return rows.map((row) => parseJson<TDocument>(row.document_json));
    },

    async queryPage<TDocument extends StorageDocument>(
      collection: string,
      input: DocumentQueryPageInput,
    ) {
      assertDocumentQueryPageInput(input);
      if (options?.readOnly && !(await runtime.hasDocumentStore())) {
        return { items: [] };
      }
      if (!options?.readOnly) {
        await runtime.ensureDocumentStore();
      }
      const values: unknown[] = [collection];
      const filterClause = buildJsonbFilterClause(
        "document",
        input.filter,
        values,
      );
      values.push(input.cursor ?? null);
      const cursorParameter = values.length;
      values.push(input.limit + 1);
      const limitParameter = values.length;
      const rows = await runtime.sql.unsafe<DocumentPageRow[]>(
        `
          SELECT id, document::text AS document_json
          FROM ${runtime.documentTable}
          WHERE collection = $1${filterClause}
            AND ($${cursorParameter}::text IS NULL OR id > $${cursorParameter})
          ORDER BY id ASC
          LIMIT $${limitParameter}
        `,
        values,
      );
      const page = rows.slice(0, input.limit);
      return {
        items: page.map((row) => parseJson<TDocument>(row.document_json)),
        ...(rows.length > input.limit
          ? { nextCursor: page.at(-1)!.id }
          : {}),
      };
    },

    async searchText<TDocument extends StorageDocument>(
      collection: string,
      input: DocumentTextSearchInput,
    ) {
      assertDocumentTextSearchInput(input);
      if (tokenizeDocumentSearch(input.query).length === 0) {
        return [];
      }
      if (options?.readOnly && !(await runtime.hasDocumentStore())) {
        return [];
      }
      if (!options?.readOnly) {
        await runtime.ensureDocumentStore();
      }
      const searchTerms = buildPostgresDocumentSearchTerms(input.query);
      const indexedSearchExpression = input.field === "text"
        ? "to_tsvector('simple', COALESCE(document ->> 'text', ''))"
        : input.field === "searchText"
          ? "to_tsvector('simple', COALESCE(document ->> 'searchText', ''))"
          : null;
      if (indexedSearchExpression) {
        const values: unknown[] = [collection, searchTerms.tsQuery];
        const filterClause = buildJsonbFilterClause(
          "document",
          input.filter,
          values,
        );
        values.push(input.limit);
        const rows = await runtime.sql.unsafe<DocumentSearchRow[]>(
          `
            SELECT
              id,
              document::text AS document_json,
              ts_rank(
                ${indexedSearchExpression},
                to_tsquery('simple', $2)
              ) AS score
            FROM ${runtime.documentTable}
            WHERE collection = $1${filterClause}
              AND ${indexedSearchExpression} @@ to_tsquery('simple', $2)
            ORDER BY score DESC, id ASC
            LIMIT $${values.length}
          `,
          values,
        );
        return rows.map((row) => ({
          document: parseJson<TDocument>(row.document_json),
          id: row.id,
          score: Number(row.score),
        }));
      }
      const values: unknown[] = [collection, input.field, searchTerms.tsQuery];
      const filterClause = buildJsonbFilterClause(
        "document",
        input.filter,
        values,
      );
      const substringParameters = searchTerms.substrings.map((substring) => {
        values.push(substring);
        return values.length;
      });
      const substringClause = substringParameters
        .map((parameter) =>
          `lower(COALESCE(document ->> $2, '')) LIKE $${parameter}`
        )
        .join(" OR ");
      values.push(input.limit);
      const limitParameter = values.length;
      const rows = await runtime.sql.unsafe<DocumentSearchRow[]>(
        `
          SELECT
            id,
            document::text AS document_json,
            GREATEST(
              ts_rank(
                to_tsvector('simple', COALESCE(document ->> $2, '')),
                to_tsquery('simple', $3)
              ),
              CASE
                WHEN ${substringClause}
                  THEN 0.1
                ELSE 0
              END
            ) AS score
          FROM ${runtime.documentTable}
          WHERE collection = $1${filterClause}
            AND (
              to_tsvector('simple', COALESCE(document ->> $2, ''))
                @@ to_tsquery('simple', $3)
              OR ${substringClause}
            )
          ORDER BY score DESC, id ASC
          LIMIT $${limitParameter}
        `,
        values,
      );
      return rows.map((row) => ({
        document: parseJson<TDocument>(row.document_json),
        id: row.id,
        score: Number(row.score),
      }));
    },

    async writeBatchIfUnchanged(input: ConditionalDocumentWriteBatch) {
      if (options?.readOnly) {
        throw createReadOnlyMutationError("document");
      }

      await runtime.ensureDocumentStore();

      return runtime.sql.begin(async (tx) => {
        for (const expected of [input.expected, ...(input.unchanged ?? [])]) {
          await tx.unsafe(
            "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
            [expected.collection, expected.id],
          );
          const rows = expected.document === null
            ? await tx.unsafe<Array<{ id: string }>>(
                `
                  SELECT id
                  FROM ${runtime.documentTable}
                  WHERE collection = $1 AND id = $2
                  FOR UPDATE
                `,
                [expected.collection, expected.id],
              )
            : await tx.unsafe<Array<{ id: string }>>(
                `
                  SELECT id
                  FROM ${runtime.documentTable}
                  WHERE collection = $1 AND id = $2
                    AND document = $3::text::jsonb
                  FOR UPDATE
                `,
                [expected.collection, expected.id, bindJson(expected.document)],
              );
          const matches = expected.document === null
            ? rows.length === 0
            : rows.length === 1;
          if (!matches) {
            return false;
          }
        }

        for (const operation of input.set) {
          await tx.unsafe(
            `
              INSERT INTO ${runtime.documentTable} (
                collection,
                id,
                document,
                created_at,
                updated_at
              ) VALUES (
                $1,
                $2,
                $3::text::jsonb,
                NOW(),
                NOW()
              )
              ON CONFLICT (collection, id)
              DO UPDATE SET
                document = EXCLUDED.document,
                updated_at = EXCLUDED.updated_at
            `,
            [
              operation.collection,
              operation.id,
              bindJson(operation.document),
            ],
          );
        }


        for (const operation of input.delete ?? []) {
          await tx.unsafe(
            `
              DELETE FROM ${runtime.documentTable}
              WHERE collection = $1 AND id = $2
            `,
            [operation.collection, operation.id],
          );
        }

        return true;
      });
    },

    async delete(collection, id) {
      if (options?.readOnly) {
        throw createReadOnlyMutationError("document");
      }

      await runtime.ensureDocumentStore();
      await runtime.sql.unsafe(
        `
          DELETE FROM ${runtime.documentTable}
          WHERE collection = $1 AND id = $2
        `,
        [collection, id],
      );
    },
  };
}

export function createPostgresSessionStore(
  config: PostgresStorageConfig,
  options?: PostgresStoreOptions,
): SessionStore {
  const runtime = createRuntime(config);
  const buffers = createPostgresSessionStateStore<SessionBuffer>(
    runtime,
    "buffer",
    options,
  );
  const workingMemory = createPostgresSessionStateStore<WorkingMemorySnapshot>(
    runtime,
    "working_memory",
    options,
  );
  const journals = createPostgresSessionStateStore<SessionJournal>(
    runtime,
    "journal",
    options,
  );

  return {
    saveBuffer(scope, buffer) {
      return buffers.set(scope, buffer);
    },

    getBuffer(scope) {
      return buffers.get(scope);
    },

    deleteBufferIfUnchanged(scope, expectedBuffer) {
      return buffers.deleteIfUnchanged(scope, expectedBuffer);
    },

    deleteBuffersByScope(scope) {
      return buffers.deleteByScope(scope);
    },

    saveWorkingMemory(scope, snapshot) {
      return workingMemory.set(scope, snapshot);
    },

    getWorkingMemory(scope) {
      return workingMemory.get(scope);
    },

    deleteWorkingMemoryByScope(scope) {
      return workingMemory.deleteByScope(scope);
    },

    saveJournal(scope, journal) {
      return journals.set(scope, journal);
    },

    getJournal(scope) {
      return journals.get(scope);
    },

    deleteJournalsByScope(scope) {
      return journals.deleteByScope(scope);
    },
  };
}

export function createPostgresVectorStore(
  config: PostgresStorageConfig,
  options?: PostgresStoreOptions,
): VectorStore {
  const runtime = createRuntime(config);

  return {
    async upsert(collection, records) {
      if (options?.readOnly) {
        throw createReadOnlyMutationError("vector");
      }

      await runtime.ensureVectorStore();

      await runtime.sql.begin(async (tx) => {
        for (const record of records) {
          await tx.unsafe(
            `
              INSERT INTO ${runtime.vectorTable} (
                collection,
                id,
                embedding,
                metadata,
                content,
                updated_at
              ) VALUES (
                $1,
                $2,
                $3::double precision[],
                $4::text::jsonb,
                $5,
                NOW()
              )
              ON CONFLICT (collection, id)
              DO UPDATE SET
                embedding = EXCLUDED.embedding,
                metadata = EXCLUDED.metadata,
                content = EXCLUDED.content,
                updated_at = EXCLUDED.updated_at
            `,
            [
              collection,
              record.id,
              serializePgArray(record.embedding),
              bindJson(record.metadata),
              record.content,
            ],
          );
        }
      });
    },

    async get(collection, id) {
      if (options?.readOnly && !(await runtime.hasVectorStore())) {
        return null;
      }

      if (!options?.readOnly) {
        await runtime.ensureVectorStore();
      }

      const rows = await runtime.sql.unsafe<VectorRow[]>(
        `
          SELECT
            id,
            array_to_json(embedding)::text AS embedding_json,
            metadata::text AS metadata_json,
            content,
            0 AS score
          FROM ${runtime.vectorTable}
          WHERE collection = $1 AND id = $2
          LIMIT 1
        `,
        [collection, id],
      );
      const row = rows[0];

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        embedding: parseJson<number[]>(row.embedding_json),
        metadata: parseJson<Record<string, unknown>>(row.metadata_json),
        content: row.content,
      };
    },

    async search(collection, queryEmbedding, input) {
      if (input.topK <= 0 || queryEmbedding.length === 0) {
        return [];
      }

      if (options?.readOnly && !(await runtime.hasVectorStore())) {
        return [];
      }

      if (!options?.readOnly) {
        await runtime.ensureVectorStore();
      }

      const values: unknown[] = [collection];
      const metadataClause = buildJsonbFilterClause("metadata", input.filter, values);
      values.push(serializeVectorLiteral(queryEmbedding));
      const vectorIndex = values.length;
      values.push(input.topK);
      const limitIndex = values.length;

      const rows = await runtime.sql.unsafe<VectorRow[]>(
        `
          SELECT
            id,
            array_to_json(embedding)::text AS embedding_json,
            metadata::text AS metadata_json,
            content,
            ((embedding::vector <#> $${vectorIndex}::vector) * -1) AS score
          FROM ${runtime.vectorTable}
          WHERE collection = $1${metadataClause}
          ORDER BY embedding::vector <#> $${vectorIndex}::vector ASC, id ASC
          LIMIT $${limitIndex}
        `,
        values,
      );

      return rows.map<VectorSearchResult>((row) => ({
        id: row.id,
        embedding: parseJson<number[]>(row.embedding_json),
        metadata: parseJson<Record<string, unknown>>(row.metadata_json),
        content: row.content,
        score: Number(row.score),
      }));
    },

    async delete(collection, id) {
      if (options?.readOnly) {
        throw createReadOnlyMutationError("vector");
      }

      await runtime.ensureVectorStore();
      await runtime.sql.unsafe(
        `
          DELETE FROM ${runtime.vectorTable}
          WHERE collection = $1 AND id = $2
        `,
        [collection, id],
      );
    },
  };
}

export async function getPostgresVectorExtensionStatus(
  config: PostgresStorageConfig,
): Promise<PostgresVectorExtensionStatus> {
  const runtime = createRuntime(config);
  const rows = await runtime.sql.unsafe<
    Array<{ available: boolean; installed: boolean }>
  >(
    `
      SELECT
        EXISTS (
          SELECT 1
          FROM pg_extension
          WHERE extname = 'vector'
        ) AS installed,
        EXISTS (
          SELECT 1
          FROM pg_available_extensions
          WHERE name = 'vector'
        ) AS available
    `,
  );

  if (rows[0]?.installed) {
    return "installed";
  }

  if (rows[0]?.available) {
    return "available";
  }

  return "missing";
}

function createPostgresStorageMigrationPort(
  runtime: PostgresRuntime,
): PostgresStorageMigrationPort {
  const versionTable = qualifyTable(runtime.schema, STORAGE_SCHEMA_TABLE_NAME);

  return {
    async runExclusive(operation) {
      const connection = await runtime.sql.reserve();
      const lockKey = [
        "goodmemory",
        runtime.schema,
        DOCUMENT_INDEX_MIGRATION_COMPONENT,
      ].join(":");
      try {
        await connection.unsafe(
          "SELECT pg_advisory_lock(hashtextextended($1, 0))",
          [lockKey],
        );
        return await operation();
      } finally {
        try {
          await connection.unsafe(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
            [lockKey],
          );
        } finally {
          connection.release();
        }
      }
    },
    async createDocumentIndex(statement) {
      await runtime.sql.unsafe(statement);
    },
    ensureDocumentStore: runtime.ensureDocumentStore,
    async ensureVersionStore() {
      await runtime.sql.unsafe(`
        CREATE TABLE IF NOT EXISTS ${versionTable} (
          component TEXT PRIMARY KEY,
          version INTEGER NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    },
    async getDocumentIndex(indexName) {
      const rows = await runtime.sql.unsafe<DocumentIndexRow[]>(
        `
          SELECT
            pg_get_indexdef(index_relation.oid) AS definition,
            index_metadata.indpred IS NOT NULL AS is_partial,
            index_metadata.indisready AS is_ready,
            index_metadata.indisunique AS is_unique,
            index_metadata.indisvalid AS is_valid,
            access_method.amname AS method,
            table_relation.relname AS table_name,
            table_namespace.nspname AS table_schema
          FROM pg_class AS index_relation
          JOIN pg_namespace AS index_namespace
            ON index_namespace.oid = index_relation.relnamespace
          JOIN pg_index AS index_metadata
            ON index_metadata.indexrelid = index_relation.oid
          JOIN pg_class AS table_relation
            ON table_relation.oid = index_metadata.indrelid
          JOIN pg_namespace AS table_namespace
            ON table_namespace.oid = table_relation.relnamespace
          JOIN pg_am AS access_method
            ON access_method.oid = index_relation.relam
          WHERE index_namespace.nspname = $1
            AND index_relation.relname = $2
        `,
        [runtime.schema, indexName],
      );
      const row = rows[0];
      return row
        ? {
            definition: row.definition,
            isPartial: row.is_partial,
            isReady: row.is_ready,
            isUnique: row.is_unique,
            isValid: row.is_valid,
            method: row.method,
            tableName: row.table_name,
            tableSchema: row.table_schema,
          }
        : null;
    },
    async getVersion() {
      const rows = await runtime.sql.unsafe<StorageMigrationVersionRow[]>(
        `
          SELECT version
          FROM ${versionTable}
          WHERE component = $1
        `,
        [DOCUMENT_INDEX_MIGRATION_COMPONENT],
      );
      return rows[0]?.version ?? null;
    },
    async setVersion(version) {
      await runtime.sql.unsafe(
        `
          INSERT INTO ${versionTable} AS storage_schema (
            component,
            version,
            updated_at
          )
          VALUES ($1, $2, NOW())
          ON CONFLICT (component)
          DO UPDATE SET
            version = GREATEST(storage_schema.version, EXCLUDED.version),
            updated_at = EXCLUDED.updated_at
        `,
        [DOCUMENT_INDEX_MIGRATION_COMPONENT, version],
      );
    },
  };
}

function normalizeIndexMethodAndKey(definition: string): string {
  const normalized = definition.toLocaleLowerCase("en-US");
  const methodStart = normalized.startsWith("using ")
    ? 0
    : normalized.indexOf(" using ");
  if (methodStart < 0) {
    return "";
  }

  const methodAndKey = definition.slice(methodStart);
  let inStringLiteral = false;
  let result = "";
  for (let index = 0; index < methodAndKey.length; index += 1) {
    const character = methodAndKey[index]!;
    if (character === "'") {
      result += character;
      if (inStringLiteral && methodAndKey[index + 1] === "'") {
        result += "'";
        index += 1;
      } else {
        inStringLiteral = !inStringLiteral;
      }
      continue;
    }
    if (inStringLiteral) {
      result += character;
      continue;
    }
    const remaining = methodAndKey.slice(index).toLocaleLowerCase("en-US");
    const cast = ["::regconfig", "::text"].find((candidate) =>
      remaining.startsWith(candidate)
    );
    if (cast) {
      index += cast.length - 1;
      continue;
    }
    if (character === '"' || /\s/.test(character)) {
      continue;
    }
    result += character.toLocaleLowerCase("en-US");
  }
  return result;
}

function assertCurrentDocumentIndex(
  schema: string,
  index: (typeof DOCUMENT_INDEX_DEFINITIONS)[number],
  state: PostgresDocumentIndexState | null,
): asserts state is PostgresDocumentIndexState {
  const current = state !== null &&
    state.isValid &&
    state.isReady &&
    !state.isUnique &&
    !state.isPartial &&
    state.method.toLocaleLowerCase("en-US") === index.method &&
    state.tableName === DOCUMENT_TABLE_NAME &&
    state.tableSchema === schema &&
    normalizeIndexMethodAndKey(state.definition) ===
      normalizeIndexMethodAndKey(index.methodAndKey);
  if (!current) {
    throw new Error(
      `Postgres document index ${schema}.${index.name} exists but is invalid or has an unexpected definition. Drop it with DROP INDEX CONCURRENTLY and rerun the migration.`,
    );
  }
}

function defaultPostgresStorageMigrationLog(
  event: PostgresStorageMigrationEvent,
): void {
  console.error(
    `[GoodMemory Postgres migration] status=${event.status} schema=${event.schema} index=${event.index} elapsedMs=${event.elapsedMs}`,
  );
}

export async function migratePostgresStorageBackend(
  config: PostgresStorageConfig,
  options?: PostgresStorageMigrationOptions,
  dependencies?: PostgresStorageMigrationDependencies,
): Promise<void> {
  normalizeUrl(config.url);
  const schema = validateIdentifier(config.schema ?? DEFAULT_SCHEMA, "schema");
  const port = dependencies?.port ??
    createPostgresStorageMigrationPort(createRuntime(config));
  const log = options?.log ?? defaultPostgresStorageMigrationLog;

  await port.runExclusive(async () => {
    await port.ensureDocumentStore();
    await port.ensureVersionStore();
    const version = await port.getVersion();
    if (version !== null && version > DOCUMENT_INDEX_SCHEMA_VERSION) {
      throw new Error(
        `Postgres document index schema ${schema} has unsupported version ${version}.`,
      );
    }

    for (const index of DOCUMENT_INDEX_DEFINITIONS) {
      const existing = await port.getDocumentIndex(index.name);
      if (existing) {
        assertCurrentDocumentIndex(schema, index, existing);
        log({
          elapsedMs: 0,
          index: index.name,
          schema,
          status: "current",
        });
        continue;
      }

      const startedAt = Date.now();
      log({
        elapsedMs: 0,
        index: index.name,
        schema,
        status: "creating",
      });
      await port.createDocumentIndex(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${quoteIdentifier(index.name)} ON ${qualifyTable(schema, DOCUMENT_TABLE_NAME)} ${index.methodAndKey}`,
      );
      const created = await port.getDocumentIndex(index.name);
      assertCurrentDocumentIndex(schema, index, created);
      log({
        elapsedMs: Date.now() - startedAt,
        index: index.name,
        schema,
        status: "created",
      });
    }

    if (version !== DOCUMENT_INDEX_SCHEMA_VERSION) {
      await port.setVersion(DOCUMENT_INDEX_SCHEMA_VERSION);
    }
  });
}

export async function ensurePostgresStorageBackend(
  config: PostgresStorageConfig,
): Promise<void> {
  const runtime = createRuntime(config);
  await runtime.ensureDocumentStore();
  await runtime.ensureSessionStore();
  await runtime.ensureVectorStore();
}

async function hasExistingPostgresStorageBackend(
  config: PostgresStorageConfig,
): Promise<boolean> {
  const runtime = createRuntime(config);
  const [hasDocumentStore, hasSessionStore, hasVectorStore] = await Promise.all([
    runtime.hasDocumentStore(),
    runtime.hasSessionStore(),
    runtime.hasVectorStore(),
  ]);

  return hasDocumentStore && hasSessionStore && hasVectorStore;
}

export async function probeReadOnlyPostgresStorageBackend(
  config: PostgresStorageConfig,
  dependencies?: ReadOnlyPostgresStorageProbeDependencies,
): Promise<ReadOnlyPostgresStorageProbeResult> {
  const getVectorExtensionStatus =
    dependencies?.getVectorExtensionStatus ?? getPostgresVectorExtensionStatus;
  const hasExistingStorageBackend =
    dependencies?.hasExistingStorageBackend ?? hasExistingPostgresStorageBackend;
  const status = await getVectorExtensionStatus(config);

  if (status === "missing") {
    return "unusable";
  }

  if (status !== "installed") {
    return "inconclusive";
  }

  return (await hasExistingStorageBackend(config))
    ? "readable"
    : "inconclusive";
}

export async function canBootstrapPostgresStorageBackend(
  config: PostgresStorageConfig,
  dependencies?: PostgresStorageBootstrapDependencies,
): Promise<boolean> {
  const getVectorExtensionStatus =
    dependencies?.getVectorExtensionStatus ?? getPostgresVectorExtensionStatus;
  const ensureStorageBackend =
    dependencies?.ensureStorageBackend ?? ensurePostgresStorageBackend;
  const status = await getVectorExtensionStatus(config);

  if (status === "missing") {
    return false;
  }

  await ensureStorageBackend(config);
  return true;
}
