import { Database } from "bun:sqlite";
import { Buffer } from "node:buffer";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
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
  VectorRecord,
  VectorSearchResult,
  VectorStore,
} from "./contracts";
import {
  PROJECTION_BATCH_SEMANTICS,
  assertDocumentQueryPageInput,
  assertDocumentTextSearchInput,
  assertStorageFilter,
  matchesFilter,
  shallowMergeDocument,
} from "./contracts";
import {
  buildDocumentSearchQuery,
  readDocumentSearchText,
  tokenizeDocumentSearch,
} from "./textSearch";
import {
  DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION,
  applySQLiteCustomLibrary,
  loadSQLiteVectorExtension,
  resolveSQLiteRuntimeResolution,
  type SQLiteExtensionLoadResult,
  type SQLiteCustomLibraryConfig,
  type SQLiteRuntimeDiagnostics,
  type SQLiteRuntimeResolution,
  type SQLiteVectorExtensionConfig,
} from "./sqliteRuntime";

type SQLiteBindingValue = string | number | boolean | null;

interface DocumentRow {
  json: string;
}

interface DocumentPageRow extends DocumentRow {
  id: string;
}

interface DocumentSearchRow extends DocumentPageRow {
  score: number;
}

interface DocumentTextKeyRow {
  rowid: number;
}

interface SessionRow {
  json: string;
}

interface VectorRow {
  id: string;
  content: string;
  embedding_json: string;
  metadata_json: string;
}

interface SQLiteStoreOptions {
  readOnly?: boolean;
}

interface SQLiteVectorSearchRow extends VectorRow {
  score: number;
}

interface SQLiteVectorIdentityRow {
  embedding_json: string;
  rowid: number;
}

interface SQLiteVectorIndexStateRow {
  dirty: number;
}

interface SQLiteVectorRowWithRowId extends VectorRow {
  rowid: number;
}

interface SQLiteVssSearchRow {
  distance: number;
  rowid: number;
}

interface SQLiteVectorStoreDependencies {
  loadVectorExtension?: (
    config: SQLiteVectorExtensionConfig,
    loader: Database,
  ) => SQLiteExtensionLoadResult | void;
  runtimeResolution?: SQLiteRuntimeResolution;
  vectorExtensionConfig?: SQLiteVectorExtensionConfig;
  runExtensionSearch?: (input: {
    collection: string;
    config: SQLiteVectorExtensionConfig;
    database: Database;
    filter?: Record<string, unknown>;
    queryEmbedding: number[];
    topK: number;
  }) => VectorSearchResult[] | null;
}

let sqliteCustomLibraryConfig: SQLiteCustomLibraryConfig | null = null;
let sqliteRuntimeResolution: SQLiteRuntimeResolution | null = null;

const DOCUMENT_FILTER_INDEX_SCHEMA_COMPONENT = "document_filter_indexes";
const DOCUMENT_TEXT_KEY_SCHEMA_COMPONENT = "document_text_fts_keys";
const DOCUMENT_SCHEMA_VERSION = 2;
const DOCUMENT_FILTER_INDEX_SCHEMA_VERSION = 2;

function ensureSQLiteCustomLibraryConfigured(): SQLiteCustomLibraryConfig {
  if (!sqliteCustomLibraryConfig) {
    const runtimeResolution = ensureSQLiteRuntimeResolution();
    sqliteCustomLibraryConfig = {
      customLibraryPath: runtimeResolution.config.customLibraryPath,
    };
    applySQLiteCustomLibrary(sqliteCustomLibraryConfig, Database);
  }

  return sqliteCustomLibraryConfig;
}

function ensureSQLiteRuntimeResolution(): SQLiteRuntimeResolution {
  if (!sqliteRuntimeResolution) {
    sqliteRuntimeResolution = resolveSQLiteRuntimeResolution();
  }

  return sqliteRuntimeResolution;
}

function ensureParentDirectory(path: string, options?: SQLiteStoreOptions): void {
  if (options?.readOnly || path === ":memory:") {
    return;
  }

  mkdirSync(dirname(path), {
    recursive: true,
  });
}

function createDatabase(
  path: string,
  options?: SQLiteStoreOptions,
): Database {
  ensureSQLiteCustomLibraryConfigured();
  ensureParentDirectory(path, options);
  return new Database(path, {
    create: options?.readOnly ? false : true,
    readonly: options?.readOnly ?? false,
    strict: true,
  });
}

function ensureDocumentSchema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      json TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS document_text_fts USING fts5(
      collection UNINDEXED,
      id UNINDEXED,
      text,
      searchText,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TABLE IF NOT EXISTS document_text_fts_keys (
      rowid INTEGER PRIMARY KEY,
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      UNIQUE (collection, id)
    );

    CREATE TABLE IF NOT EXISTS document_store_schema (
      component TEXT PRIMARY KEY,
      version INTEGER NOT NULL
    );
  `);
  try {
    database.exec("BEGIN IMMEDIATE");
    const versionStatement = database.query<
      { version: number },
      [string]
    >(
      `SELECT version FROM document_store_schema WHERE component = ?1`,
    );
    if (
      versionStatement.get(DOCUMENT_TEXT_KEY_SCHEMA_COMPONENT)?.version !==
        DOCUMENT_SCHEMA_VERSION
    ) {
      database.exec(`
        DROP TABLE document_text_fts;

        CREATE VIRTUAL TABLE document_text_fts USING fts5(
          collection UNINDEXED,
          id UNINDEXED,
          text,
          searchText,
          tokenize = 'unicode61 remove_diacritics 2'
        );

        DELETE FROM document_text_fts_keys;

        INSERT INTO document_text_fts_keys (collection, id)
        SELECT collection, id
        FROM documents
        WHERE CASE WHEN json_valid(json)
          THEN json_type(json, '$.text') = 'text' OR
            json_type(json, '$.searchText') = 'text'
          ELSE 0
        END;

        INSERT INTO document_text_fts (
          rowid,
          collection,
          id,
          text,
          searchText
        )
        SELECT keys.rowid, documents.collection, documents.id,
          CASE WHEN json_type(documents.json, '$.text') = 'text'
            THEN json_extract(documents.json, '$.text')
          END,
          CASE WHEN json_type(documents.json, '$.searchText') = 'text'
            THEN json_extract(documents.json, '$.searchText')
          END
        FROM documents
        JOIN document_text_fts_keys AS keys
          ON keys.collection = documents.collection AND keys.id = documents.id;
      `);
      database
        .query(
          `INSERT INTO document_store_schema (component, version)
           VALUES (?1, ?2)
           ON CONFLICT(component) DO UPDATE SET version = excluded.version`,
        )
        .run(DOCUMENT_TEXT_KEY_SCHEMA_COMPONENT, DOCUMENT_SCHEMA_VERSION);
    }
    if (
      versionStatement.get(DOCUMENT_FILTER_INDEX_SCHEMA_COMPONENT)?.version !==
        DOCUMENT_FILTER_INDEX_SCHEMA_VERSION
    ) {
      database.exec(`
        DROP INDEX IF EXISTS documents_collection_scope_key_idx;
        DROP INDEX IF EXISTS documents_collection_memory_id_idx;
        DROP INDEX IF EXISTS documents_collection_source_memory_id_idx;
        DROP INDEX IF EXISTS documents_collection_claim_group_idx;

        CREATE INDEX documents_collection_scope_key_idx
          ON documents (collection, json_extract(json, '$.scopeKey'))
          WHERE json_valid(json);

        CREATE INDEX documents_collection_memory_id_idx
          ON documents (collection, json_extract(json, '$.memoryId'))
          WHERE json_valid(json);

        CREATE INDEX documents_collection_source_memory_id_idx
          ON documents (collection, json_extract(json, '$.sourceMemoryId'))
          WHERE json_valid(json);

        CREATE INDEX documents_collection_claim_group_idx
          ON documents (
            collection,
            json_extract(json, '$.scopeKey'),
            json_extract(json, '$.subjectEntityId'),
            json_extract(json, '$.predicateKey')
          )
          WHERE json_valid(json);
      `);
      database
        .query(
          `INSERT INTO document_store_schema (component, version)
           VALUES (?1, ?2)
           ON CONFLICT(component) DO UPDATE SET version = excluded.version`,
        )
        .run(
          DOCUMENT_FILTER_INDEX_SCHEMA_COMPONENT,
          DOCUMENT_FILTER_INDEX_SCHEMA_VERSION,
        );
    }
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the migration failure.
    }
    throw error;
  }
}

function ensureSessionSchema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS session_buffers (
      scope_key TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_working_memory (
      scope_key TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_journals (
      scope_key TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );
  `);
}

function ensureVectorSchema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS vectors (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      content TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );

    CREATE TABLE IF NOT EXISTS vector_index_state (
      table_name TEXT PRIMARY KEY,
      collection TEXT NOT NULL,
      dimension INTEGER NOT NULL,
      dirty INTEGER NOT NULL
    );
  `);
}

function parseJson<TValue>(json: string): TValue {
  return JSON.parse(json) as TValue;
}

function hasTable(database: Database, tableName: string): boolean {
  const row = database.query<{ name: string }, [string]>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1`,
  ).get(tableName);

  return row !== null && row !== undefined;
}

function hasTableColumn(
  database: Database,
  tableName: string,
  columnName: string,
): boolean {
  const escapedTableName = tableName.replaceAll('"', '""');
  return database
    .query<{ name: string }, []>(`PRAGMA table_info("${escapedTableName}")`)
    .all()
    .some(({ name }) => name === columnName);
}

function createReadOnlyMutationError(store: string): Error {
  return new Error(`SQLite ${store} store is read-only in this context.`);
}

function scoreDotProduct(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let score = 0;

  for (let index = 0; index < length; index += 1) {
    score += left[index]! * right[index]!;
  }

  return score;
}

function canUseSQLiteJsonFilterValue(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function readIndexedDocumentJsonPath(key: string): string | undefined {
  switch (key) {
    case "memoryId":
      return "$.memoryId";
    case "predicateKey":
      return "$.predicateKey";
    case "scopeKey":
      return "$.scopeKey";
    case "sourceMemoryId":
      return "$.sourceMemoryId";
    case "subjectEntityId":
      return "$.subjectEntityId";
    default:
      return undefined;
  }
}

function runSQLiteImmediateTransaction<T>(
  database: Database,
  operation: () => T,
): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the mutation failure.
    }
    throw error;
  }
}

function createSQLiteJsonFilterClause(input: {
  alias: string;
  keyParameterIndex: number;
  value: SQLiteBindingValue;
  valueParameterIndex?: number;
}): string {
  const { alias, keyParameterIndex, value, valueParameterIndex } = input;
  const clausePrefix = `EXISTS (
        SELECT 1
        FROM json_each(metadata_json) AS ${alias}
        WHERE ${alias}.key = ?${keyParameterIndex}`;

  if (value === null) {
    return `${clausePrefix}
          AND ${alias}.type = 'null'
      )`;
  }

  if (typeof value === "boolean") {
    return `${clausePrefix}
          AND ${alias}.type = '${value ? "true" : "false"}'
      )`;
  }

  if (typeof value === "number") {
    return `${clausePrefix}
          AND ${alias}.type IN ('integer', 'real')
          AND ${alias}.atom = ?${valueParameterIndex}
      )`;
  }

  return `${clausePrefix}
          AND ${alias}.type = 'text'
          AND ${alias}.atom = ?${valueParameterIndex}
      )`;
}

function quoteSQLiteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

function encodeSQLiteVssCollectionName(collection: string): string {
  if (/^[A-Za-z0-9]+$/.test(collection)) {
    return collection;
  }

  return `x_${Buffer.from(collection, "utf8").toString("hex")}`;
}

function createSQLiteVssTableName(collection: string, dimension: number): string {
  return `vss_vectors_${encodeSQLiteVssCollectionName(collection)}_dim_${dimension}`;
}

function executeSQLiteVssDelete(
  database: Database,
  tableName: string,
  rowid: number,
): void {
  database
    .query(`DELETE FROM ${quoteSQLiteIdentifier(tableName)} WHERE rowid = ?1`)
    .run(rowid);
}

function executeSQLiteVssUpsert(input: {
  database: Database;
  embeddingJson: string;
  rowid: number;
  tableName: string;
}): void {
  const { database, embeddingJson, rowid, tableName } = input;
  executeSQLiteVssDelete(database, tableName, rowid);
  database
    .query(
      `INSERT INTO ${quoteSQLiteIdentifier(tableName)} (rowid, embedding)
       VALUES (?1, json(?2))`,
    )
    .run(rowid, embeddingJson);
}

function searchSQLiteVectorsWithExtension(input: {
  collection: string;
  config: SQLiteVectorExtensionConfig;
  database: Database;
  filter?: Record<string, unknown>;
  queryEmbedding: number[];
  topK: number;
}): VectorSearchResult[] | null {
  const { collection, config, database, filter, queryEmbedding, topK } = input;
  if (config.mode === "off" || !config.paths?.length) {
    return null;
  }

  const values: SQLiteBindingValue[] = [collection, JSON.stringify(queryEmbedding)];
  const filterClauses: string[] = [];

  if (filter) {
    for (const [key, value] of Object.entries(filter)) {
      if (!canUseSQLiteJsonFilterValue(value)) {
        return null;
      }

      values.push(key);
      const keyParameterIndex = values.length;
      const alias = `metadata_filter_${filterClauses.length + 1}`;

      if (value === null || typeof value === "boolean") {
        filterClauses.push(
          createSQLiteJsonFilterClause({
            alias,
            keyParameterIndex,
            value,
          }),
        );
        continue;
      }

      values.push(value);
      filterClauses.push(
        createSQLiteJsonFilterClause({
          alias,
          keyParameterIndex,
          value,
          valueParameterIndex: values.length,
        }),
      );
    }
  }

  values.push(topK);
  const whereClauses = ["collection = ?1", ...filterClauses];
  const searchStatement = database.query<SQLiteVectorSearchRow, SQLiteBindingValue[]>(
    `SELECT
        id,
        embedding_json,
        metadata_json,
        content,
        ${(config.searchFunction || DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION)}(embedding_json, ?2) AS score
      FROM vectors
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY score DESC, id ASC
      LIMIT ?${values.length}`,
  );

  return searchStatement.all(...values).map((row) => ({
    id: row.id,
    embedding: parseJson<number[]>(row.embedding_json),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json),
    content: row.content,
    score: Number(row.score),
  }));
}

export function createSQLiteDocumentStore(
  path: string,
  options?: SQLiteStoreOptions,
): ProjectionCapableDocumentStore {
  const database = createDatabase(path, options);
  if (!options?.readOnly) {
    ensureDocumentSchema(database);
  }

  const upsertStatement = database.query(
    `INSERT INTO documents (collection, id, json)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(collection, id) DO UPDATE SET json = excluded.json`,
  );
  const getStatement = database.query<DocumentRow, [string, string]>(
    `SELECT json FROM documents WHERE collection = ?1 AND id = ?2`,
  );
  const listStatement = database.query<DocumentRow, [string]>(
    `SELECT json FROM documents WHERE collection = ?1`,
  );
  const deleteStatement = database.query(
    `DELETE FROM documents WHERE collection = ?1 AND id = ?2`,
  );
  const hasTextIndex = hasTable(database, "document_text_fts");
  const hasTextKeys = hasTable(database, "document_text_fts_keys");
  const hasSearchTextIndex = hasTextIndex &&
    hasTableColumn(database, "document_text_fts", "searchText");
  const insertSearchKeyStatement = hasTextKeys
    ? database.query(
        `INSERT OR IGNORE INTO document_text_fts_keys (collection, id)
         VALUES (?1, ?2)`,
      )
    : null;
  const getSearchKeyStatement = hasTextKeys
    ? database.query<DocumentTextKeyRow, [string, string]>(
        `SELECT rowid FROM document_text_fts_keys
         WHERE collection = ?1 AND id = ?2`,
      )
    : null;
  const deleteSearchStatement = hasTextIndex
    ? database.query(
        `DELETE FROM document_text_fts WHERE rowid = ?1`,
      )
    : null;
  const insertSearchStatement = hasTextIndex && hasSearchTextIndex
    ? database.query(
        `INSERT INTO document_text_fts (
           rowid,
           collection,
           id,
           text,
           searchText
         )
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
    : null;
  const deleteSearchKeyStatement = hasTextKeys
    ? database.query(
        `DELETE FROM document_text_fts_keys WHERE rowid = ?1`,
      )
    : null;

  function deleteSearchDocument(collection: string, id: string): void {
    const key = getSearchKeyStatement?.get(collection, id);
    if (!key) {
      return;
    }
    deleteSearchStatement?.run(key.rowid);
    deleteSearchKeyStatement?.run(key.rowid);
  }

  function synchronizeSearchDocument(
    collection: string,
    id: string,
    document: StorageDocument,
  ): void {
    if (
      !deleteSearchStatement ||
      !insertSearchStatement ||
      !insertSearchKeyStatement ||
      !getSearchKeyStatement
    ) {
      return;
    }
    const existing = getSearchKeyStatement.get(collection, id);
    if (existing) {
      deleteSearchStatement.run(existing.rowid);
    }
    const searchText = readDocumentSearchText(document, "searchText");
    const text = readDocumentSearchText(document, "text");
    if (text === undefined && searchText === undefined) {
      if (existing) {
        deleteSearchKeyStatement?.run(existing.rowid);
      }
      return;
    }
    insertSearchKeyStatement.run(collection, id);
    const key = getSearchKeyStatement.get(collection, id)!;
    insertSearchStatement.run(
      key.rowid,
      collection,
      id,
      text ?? null,
      searchText ?? null,
    );
  }

  function buildSearchFilter(input: {
    alias: string;
    filter?: StorageFilter;
    values: SQLiteBindingValue[];
  }): string[] {
    const entries = Object.entries(input.filter ?? {});
    const clauses = entries.length > 0
      ? [`json_valid(${input.alias}.json)`]
      : [];
    for (const [key, value] of entries) {
      const indexedPath = readIndexedDocumentJsonPath(key);
      if (indexedPath) {
        if (value === null) {
          clauses.push(
            `json_type(${input.alias}.json, '${indexedPath}') = 'null'`,
          );
          continue;
        }
        input.values.push(value);
        clauses.push(
          `json_extract(${input.alias}.json, '${indexedPath}') = ?${input.values.length}`,
        );
        continue;
      }
      input.values.push(`$."${key.replaceAll('"', '\\"')}"`);
      const pathIndex = input.values.length;
      if (value === null) {
        clauses.push(`json_type(${input.alias}.json, ?${pathIndex}) = 'null'`);
        continue;
      }
      input.values.push(value);
      clauses.push(
        `json_extract(${input.alias}.json, ?${pathIndex}) = ?${input.values.length}`,
      );
    }
    return clauses;
  }
  function writeBatchIfUnchanged(input: ConditionalDocumentWriteBatch): boolean {
    database.exec("BEGIN IMMEDIATE");

    try {
      for (const expected of [input.expected, ...(input.unchanged ?? [])]) {
        const current = getStatement.get(expected.collection, expected.id);
        const matches = expected.document === null
          ? current === null
          : current !== null && current.json === JSON.stringify(expected.document);
        if (!matches) {
          database.exec("ROLLBACK");
          return false;
        }
      }

      for (const operation of input.set) {
        upsertStatement.run(
          operation.collection,
          operation.id,
          JSON.stringify(operation.document),
        );
        synchronizeSearchDocument(
          operation.collection,
          operation.id,
          operation.document,
        );
      }


      for (const operation of input.delete ?? []) {
        deleteStatement.run(operation.collection, operation.id);
        deleteSearchDocument(operation.collection, operation.id);
      }

      database.exec("COMMIT");
      return true;
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // The original mutation failure is more useful than rollback cleanup.
      }

      throw error;
    }
  }

  return {
    projectionBatchSemantics: PROJECTION_BATCH_SEMANTICS,
    async set<TDocument extends StorageDocument>(
      collection: string,
      id: string,
      document: TDocument,
    ) {
      runSQLiteImmediateTransaction(database, () => {
        upsertStatement.run(collection, id, JSON.stringify(document));
        synchronizeSearchDocument(collection, id, document);
      });
    },

    async get<TDocument extends StorageDocument>(collection: string, id: string) {
      const row = getStatement.get(collection, id);
      return row ? (parseJson(row.json) as TDocument) : null;
    },

    async update<TDocument extends StorageDocument>(
      collection: string,
      id: string,
      patch: Partial<TDocument>,
    ) {
      const current = await this.get(collection, id);

      if (!current) {
        throw new Error(`Document not found for update: ${collection}/${id}`);
      }

      await this.set(collection, id, shallowMergeDocument(current, patch));
    },

    async query<TDocument extends StorageDocument>(
      collection: string,
      filter?: StorageFilter,
    ) {
      assertStorageFilter(filter);
      if (
        filter &&
        Object.keys(filter).length > 0
      ) {
        const values: SQLiteBindingValue[] = [collection];
        const filterClauses = buildSearchFilter({
          alias: "documents",
          filter,
          values,
        });
        const rows = database
          .query<DocumentRow, SQLiteBindingValue[]>(
            `SELECT json FROM documents
             WHERE collection = ?1 AND ${filterClauses.join(" AND ")}`,
          )
          .all(...values);
        return rows.map((row) => parseJson<TDocument>(row.json));
      }
      const rows = listStatement.all(collection);

      return rows.map((row) => parseJson<TDocument>(row.json));
    },

    async queryPage<TDocument extends StorageDocument>(
      collection: string,
      input: DocumentQueryPageInput,
    ) {
      assertDocumentQueryPageInput(input);
      const values: SQLiteBindingValue[] = [collection];
      const filterClauses = buildSearchFilter({
        alias: "documents",
        filter: input.filter,
        values,
      });
      values.push(input.cursor ?? null);
      const cursorParameter = values.length;
      values.push(input.limit + 1);
      const rows = database
        .query<DocumentPageRow, SQLiteBindingValue[]>(
          `SELECT documents.id, documents.json
           FROM documents
           WHERE documents.collection = ?1
             ${filterClauses.length > 0 ? `AND ${filterClauses.join(" AND ")}` : ""}
             AND (?${cursorParameter} IS NULL OR documents.id > ?${cursorParameter})
           ORDER BY documents.id ASC
           LIMIT ?${values.length}`,
        )
        .all(...values);
      const page = rows.slice(0, input.limit);
      return {
        items: page.map((row) => parseJson<TDocument>(row.json)),
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
      const query = buildDocumentSearchQuery(input.query);
      if (query.length === 0) {
        return [];
      }

      const values: SQLiteBindingValue[] = [];
      let sql: string;
      const indexedField = input.field === "text"
        ? input.field
        : input.field === "searchText" && hasSearchTextIndex
          ? input.field
          : null;
      if (hasTextIndex && indexedField) {
        values.push(query, collection);
        const filterClauses = buildSearchFilter({
          alias: "documents",
          filter: input.filter,
          values,
        });
        values.push(input.limit);
        sql = `SELECT documents.id, documents.json, bm25(document_text_fts) AS score
          FROM document_text_fts
          JOIN documents
            ON documents.collection = document_text_fts.collection
           AND documents.id = document_text_fts.id
          WHERE document_text_fts.${indexedField} MATCH ?1
            AND document_text_fts.collection = ?2
            ${filterClauses.length > 0 ? `AND ${filterClauses.join(" AND ")}` : ""}
          ORDER BY score ASC, documents.id ASC
          LIMIT ?${values.length}`;
      } else {
        values.push(collection, `$."${input.field.replaceAll('"', '\\"')}"`);
        const tokens = tokenizeDocumentSearch(input.query);
        const tokenClauses: string[] = [];
        for (const token of tokens) {
          values.push(`%${token}%`);
          tokenClauses.push(
            `lower(CAST(json_extract(documents.json, ?2) AS TEXT)) LIKE ?${values.length}`,
          );
        }
        const filterClauses = buildSearchFilter({
          alias: "documents",
          filter: input.filter,
          values,
        });
        values.push(input.limit);
        sql = `SELECT documents.id, documents.json, 1 AS score
          FROM documents
          WHERE documents.collection = ?1
            AND (${tokenClauses.join(" OR ")})
            ${filterClauses.length > 0 ? `AND ${filterClauses.join(" AND ")}` : ""}
          ORDER BY documents.id ASC
          LIMIT ?${values.length}`;
      }
      return database
        .query<DocumentSearchRow, SQLiteBindingValue[]>(sql)
        .all(...values)
        .map((row) => ({
          document: parseJson<TDocument>(row.json),
          id: row.id,
          score: Math.max(Number.EPSILON, Math.abs(Number(row.score))),
        }));
    },

    async writeBatchIfUnchanged(input: ConditionalDocumentWriteBatch) {
      if (options?.readOnly) {
        throw createReadOnlyMutationError("document");
      }

      return writeBatchIfUnchanged(input);
    },

    async delete(collection, id) {
      runSQLiteImmediateTransaction(database, () => {
        deleteSearchDocument(collection, id);
        deleteStatement.run(collection, id);
      });
    },
  };
}

function createSQLiteScopedStore<TValue>(
  database: Database,
  tableName: "session_buffers" | "session_working_memory" | "session_journals",
  options?: SQLiteStoreOptions,
): {
  set(scope: MemoryScope, value: TValue): Promise<void>;
  setIfUnchanged(
    scope: MemoryScope,
    expectedValue: TValue | null,
    nextValue: TValue,
  ): Promise<boolean>;
  get(scope: MemoryScope): Promise<TValue | null>;
  deleteIfUnchanged(scope: MemoryScope, expectedValue: TValue): Promise<boolean>;
  deleteByScope(scope: MemoryScope): Promise<number>;
} {
  if (options?.readOnly && !hasTable(database, tableName)) {
    return {
      async set() {
        throw createReadOnlyMutationError("session");
      },

      async get() {
        return null;
      },

      async setIfUnchanged() {
        throw createReadOnlyMutationError("session");
      },

      async deleteIfUnchanged() {
        throw createReadOnlyMutationError("session");
      },

      async deleteByScope() {
        throw createReadOnlyMutationError("session");
      },
    };
  }

  const upsertStatement = database.query(
    `INSERT INTO ${tableName} (scope_key, json)
     VALUES (?1, ?2)
     ON CONFLICT(scope_key) DO UPDATE SET json = excluded.json`,
  );
  const getStatement = database.query<SessionRow, [string]>(
    `SELECT json FROM ${tableName} WHERE scope_key = ?1`,
  );
  const insertIfMissingStatement = database.query(
    `INSERT INTO ${tableName} (scope_key, json)
     VALUES (?1, ?2)
     ON CONFLICT(scope_key) DO NOTHING`,
  );
  const updateIfUnchangedStatement = database.query(
    `UPDATE ${tableName}
     SET json = ?3
     WHERE scope_key = ?1 AND json = ?2`,
  );
  const deleteExactStatement = database.query(
    `DELETE FROM ${tableName} WHERE scope_key = ?1`,
  );
  const deleteIfUnchangedStatement = database.query(
    `DELETE FROM ${tableName} WHERE scope_key = ?1 AND json = ?2`,
  );
  const deletePrefixStatement = database.query(
    `DELETE FROM ${tableName} WHERE scope_key LIKE ?1`,
  );

  return {
    async set(scope, value) {
      upsertStatement.run(scopeToKey(scope), JSON.stringify(value));
    },

    async setIfUnchanged(scope, expectedValue, nextValue) {
      return runSQLiteImmediateTransaction(database, () => {
        const key = scopeToKey(scope);
        const nextJson = JSON.stringify(nextValue);
        const result = expectedValue === null
          ? insertIfMissingStatement.run(key, nextJson)
          : updateIfUnchangedStatement.run(
              key,
              JSON.stringify(expectedValue),
              nextJson,
            );
        return Number(result.changes ?? 0) === 1;
      });
    },

    async get(scope) {
      const row = getStatement.get(scopeToKey(scope));
      return row ? parseJson<TValue>(row.json) : null;
    },

    async deleteIfUnchanged(scope, expectedValue) {
      return runSQLiteImmediateTransaction(database, () => {
        const result = deleteIfUnchangedStatement.run(
          scopeToKey(scope),
          JSON.stringify(expectedValue),
        );
        return Number(result.changes ?? 0) === 1;
      });
    },

    async deleteByScope(scope) {
      if (scope.sessionId !== undefined) {
        const result = deleteExactStatement.run(scopeToKey(scope));
        return Number(result.changes ?? 0);
      }

      const result = deletePrefixStatement.run(`${scopeToPrefix(scope)}%`);
      return Number(result.changes ?? 0);
    },
  };
}

export function createSQLiteSessionStore(
  path: string,
  options?: SQLiteStoreOptions,
): SessionStore {
  const database = createDatabase(path, options);
  if (!options?.readOnly) {
    ensureSessionSchema(database);
  }

  const buffers = createSQLiteScopedStore<SessionBuffer>(
    database,
    "session_buffers",
    options,
  );
  const workingMemory = createSQLiteScopedStore<WorkingMemorySnapshot>(
    database,
    "session_working_memory",
    options,
  );
  const journals = createSQLiteScopedStore<SessionJournal>(
    database,
    "session_journals",
    options,
  );

  return {
    saveBuffer(scope, buffer) {
      return buffers.set(scope, buffer);
    },

    saveBufferIfUnchanged(scope, expectedBuffer, nextBuffer) {
      return buffers.setIfUnchanged(scope, expectedBuffer, nextBuffer);
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

export function createSQLiteVectorStore(
  path: string,
  options?: SQLiteStoreOptions,
  dependencies?: SQLiteVectorStoreDependencies,
): VectorStore {
  const runtimeResolution =
    dependencies?.runtimeResolution ?? ensureSQLiteRuntimeResolution();
  const vectorExtensionConfig =
    dependencies?.vectorExtensionConfig ?? runtimeResolution.config.vectorExtension;
  const runtimeDiagnostics: SQLiteRuntimeDiagnostics =
    dependencies?.runtimeResolution?.diagnostics ?? runtimeResolution.diagnostics;
  const database = createDatabase(path, options);
  if (!options?.readOnly) {
    ensureVectorSchema(database);
  }
  if (runtimeDiagnostics.requestedMode === "require" && !runtimeDiagnostics.available) {
    throw new Error(
      runtimeDiagnostics.reason ??
        "SQLite vector acceleration is required but no supported runtime is available.",
    );
  }
  const hasVectorTable = !options?.readOnly || hasTable(database, "vectors");
  const vssTables = new Set<string>();
  let extensionLoadResult: SQLiteExtensionLoadResult | null = null;

  const upsertStatement = options?.readOnly
    ? null
    : database.query(
        `INSERT INTO vectors (
            collection,
            id,
            embedding_json,
            metadata_json,
            content
          ) VALUES (?1, ?2, ?3, ?4, ?5)
          ON CONFLICT(collection, id) DO UPDATE SET
            embedding_json = excluded.embedding_json,
            metadata_json = excluded.metadata_json,
            content = excluded.content`,
      );
  const getStatement = hasVectorTable
    ? database.query<VectorRow, [string, string]>(
        `SELECT id, embedding_json, metadata_json, content
         FROM vectors
         WHERE collection = ?1 AND id = ?2`,
      )
    : null;
  const listStatement = hasVectorTable
    ? database.query<VectorRow, [string]>(
        `SELECT id, embedding_json, metadata_json, content
         FROM vectors
         WHERE collection = ?1`,
      )
    : null;
  const listWithRowIdStatement = hasVectorTable
    ? database.query<SQLiteVectorRowWithRowId, [string]>(
        `SELECT rowid, id, embedding_json, metadata_json, content
         FROM vectors
         WHERE collection = ?1`,
      )
    : null;
  const rowIdentityStatement = hasVectorTable
    ? database.query<SQLiteVectorIdentityRow, [string, string]>(
        `SELECT rowid, embedding_json
         FROM vectors
         WHERE collection = ?1 AND id = ?2`,
      )
    : null;
  const rowByRowIdStatement = hasVectorTable
    ? database.query<
        VectorRow & { rowid: number },
        [string, number]
      >(
        `SELECT rowid, id, embedding_json, metadata_json, content
         FROM vectors
         WHERE collection = ?1 AND rowid = ?2`,
      )
    : null;
  const deleteStatement = options?.readOnly
    ? null
    : database.query(
        `DELETE FROM vectors WHERE collection = ?1 AND id = ?2`,
      );
  const hasIndexStateTable =
    !options?.readOnly || hasTable(database, "vector_index_state");
  const getIndexStateStatement = hasIndexStateTable
    ? database.query<SQLiteVectorIndexStateRow, [string]>(
        `SELECT dirty
         FROM vector_index_state
         WHERE table_name = ?1`,
      )
    : null;
  const markIndexDirtyStatement = options?.readOnly
    ? null
    : database.query(
        `INSERT INTO vector_index_state (table_name, collection, dimension, dirty)
         VALUES (?1, ?2, ?3, 1)
         ON CONFLICT(table_name) DO UPDATE SET
           collection = excluded.collection,
           dimension = excluded.dimension,
           dirty = 1`,
      );
  const markIndexCleanStatement = options?.readOnly
    ? null
    : database.query(
        `INSERT INTO vector_index_state (table_name, collection, dimension, dirty)
         VALUES (?1, ?2, ?3, 0)
         ON CONFLICT(table_name) DO UPDATE SET
           collection = excluded.collection,
           dimension = excluded.dimension,
           dirty = 0`,
      );

  function ensureVectorExtensionLoaded(): SQLiteExtensionLoadResult {
    if (extensionLoadResult) {
      return extensionLoadResult;
    }

    const rawResult = (
      dependencies?.loadVectorExtension ?? loadSQLiteVectorExtension
    )(
      vectorExtensionConfig,
      database,
    );
    extensionLoadResult =
      rawResult &&
      typeof rawResult === "object" &&
      "loaded" in rawResult
        ? rawResult
        : {
            loaded:
              vectorExtensionConfig.mode !== "off" &&
              Boolean(vectorExtensionConfig.paths?.length),
          };

    return extensionLoadResult;
  }

  function hasAcceleratedSQLiteVss(): boolean {
    return (
      vectorExtensionConfig.backend === "sqlite-vss" &&
      ensureVectorExtensionLoaded().loaded
    );
  }

  function markSQLiteVssIndexDirty(
    collection: string,
    dimension: number,
  ): void {
    const tableName = createSQLiteVssTableName(collection, dimension);
    markIndexDirtyStatement!.run(tableName, collection, dimension);
  }

  function markSQLiteVssIndexClean(input: {
    collection: string;
    dimension: number;
    tableName: string;
  }): void {
    markIndexCleanStatement!.run(
      input.tableName,
      input.collection,
      input.dimension,
    );
  }

  function shouldSynchronizeSQLiteVssTable(input: {
    existed: boolean;
    tableName: string;
  }): boolean {
    if (!input.existed) {
      return true;
    }

    const state = getIndexStateStatement!.get(input.tableName);
    return !state || state.dirty !== 0;
  }

  function canUseReadOnlySQLiteVssTable(tableName: string): boolean {
    const state = getIndexStateStatement?.get(tableName);
    return state?.dirty === 0;
  }

  function synchronizeSQLiteVssTable(
    collection: string,
    dimension: number,
    tableName: string,
  ): void {
    const durableRows = listWithRowIdStatement!.all(collection).filter((row) => {
      const embedding = parseJson<number[]>(row.embedding_json);
      return embedding.length === dimension;
    });
    const durableRowIds = new Set(durableRows.map((row) => row.rowid));
    const indexedRows = database
      .query<{ rowid: number }, []>(
        `SELECT rowid FROM ${quoteSQLiteIdentifier(tableName)}`,
      )
      .all();

    for (const row of indexedRows) {
      if (!durableRowIds.has(row.rowid)) {
        executeSQLiteVssDelete(database, tableName, row.rowid);
      }
    }

    for (const row of durableRows) {
      executeSQLiteVssUpsert({
        database,
        embeddingJson: row.embedding_json,
        rowid: row.rowid,
        tableName,
      });
    }

    markSQLiteVssIndexClean({
      collection,
      dimension,
      tableName,
    });
  }

  function ensureSQLiteVssTable(
    collection: string,
    dimension: number,
  ): string | null {
    if (!hasAcceleratedSQLiteVss()) {
      return null;
    }

    const tableName = createSQLiteVssTableName(collection, dimension);
    if (vssTables.has(tableName)) {
      if (options?.readOnly) {
        if (!canUseReadOnlySQLiteVssTable(tableName)) {
          vssTables.delete(tableName);
          return null;
        }
        return tableName;
      }

      if (
        shouldSynchronizeSQLiteVssTable({
          existed: true,
          tableName,
        })
      ) {
        synchronizeSQLiteVssTable(collection, dimension, tableName);
      }
      return tableName;
    }

    if (options?.readOnly) {
      if (!hasTable(database, tableName)) {
        return null;
      }
      if (!canUseReadOnlySQLiteVssTable(tableName)) {
        return null;
      }
      vssTables.add(tableName);
      return tableName;
    }

    const existed = hasTable(database, tableName);
    database.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${quoteSQLiteIdentifier(tableName)}
       USING vss0(embedding(${dimension}))`,
    );
    if (
      shouldSynchronizeSQLiteVssTable({
        existed,
        tableName,
      })
    ) {
      synchronizeSQLiteVssTable(collection, dimension, tableName);
    }
    vssTables.add(tableName);
    return tableName;
  }

  function searchSQLiteVectorsWithVss(input: {
    collection: string;
    filter?: StorageFilter;
    queryEmbedding: number[];
    topK: number;
  }): VectorSearchResult[] | null {
    const { collection, filter, queryEmbedding, topK } = input;
    const dimension = queryEmbedding.length;
    const tableName = ensureSQLiteVssTable(collection, dimension);

    if (!tableName) {
      return null;
    }

    const totalRows = listStatement!.all(collection).filter((row) => {
      const embedding = parseJson<number[]>(row.embedding_json);
      return embedding.length === dimension;
    }).length;
    if (totalRows === 0) {
      return [];
    }

    const queryJson = JSON.stringify(queryEmbedding);
    let candidateLimit = Math.min(
      totalRows,
      Math.max(topK, filter ? topK * 4 : topK),
    );

    while (candidateLimit > 0) {
      const candidateRows = database
        .query<SQLiteVssSearchRow, [string, number]>(
          `SELECT rowid, distance
           FROM ${quoteSQLiteIdentifier(tableName)}
           WHERE vss_search(embedding, vss_search_params(json(?1), ?2))`,
        )
        .all(queryJson, candidateLimit);

      const matches: VectorSearchResult[] = [];
      for (const candidate of candidateRows) {
        const row = rowByRowIdStatement!.get(collection, candidate.rowid);
        if (!row) {
          continue;
        }

        const embedding = parseJson<number[]>(row.embedding_json);
        const metadata = parseJson<Record<string, unknown>>(row.metadata_json);
        if (!matchesFilter(metadata, filter)) {
          continue;
        }

        matches.push({
          id: row.id,
          embedding,
          metadata,
          content: row.content,
          score: 1 / (1 + Number(candidate.distance)),
        });
      }

      if (
        !filter ||
        matches.length >= topK ||
        candidateLimit >= totalRows
      ) {
        return matches.slice(0, topK);
      }

      candidateLimit = Math.min(totalRows, candidateLimit * 2);
    }

    return [];
  }

  return {
    async upsert(collection, records) {
      if (options?.readOnly) {
        throw createReadOnlyMutationError("vector");
      }

      const transaction = database.transaction((batched: VectorRecord[]) => {
        const acceleratedSQLiteVss = hasAcceleratedSQLiteVss();
        for (const record of batched) {
          const previousIdentity = rowIdentityStatement!.get(collection, record.id);
          const previousDimension = previousIdentity
            ? parseJson<number[]>(previousIdentity.embedding_json).length
            : null;
          const nextEmbeddingJson = JSON.stringify(record.embedding);

          upsertStatement!.run(
            collection,
            record.id,
            nextEmbeddingJson,
            JSON.stringify(record.metadata),
            record.content,
          );

          if (!acceleratedSQLiteVss) {
            if (
              previousIdentity &&
              previousDimension !== null &&
              previousDimension !== record.embedding.length
            ) {
              markSQLiteVssIndexDirty(collection, previousDimension);
            }
            markSQLiteVssIndexDirty(collection, record.embedding.length);
            continue;
          }

          const nextIdentity = rowIdentityStatement!.get(collection, record.id);
          if (!nextIdentity) {
            continue;
          }

          if (
            previousIdentity &&
            previousDimension !== null &&
            previousDimension !== record.embedding.length
          ) {
            const previousTable = ensureSQLiteVssTable(
              collection,
              previousDimension,
            );
            if (previousTable) {
              executeSQLiteVssDelete(
                database,
                previousTable,
                previousIdentity.rowid,
              );
            }
          }

          const nextTable = ensureSQLiteVssTable(
            collection,
            record.embedding.length,
          );
          if (!nextTable) {
            continue;
          }

          executeSQLiteVssUpsert({
            database,
            embeddingJson: nextEmbeddingJson,
            rowid: nextIdentity.rowid,
            tableName: nextTable,
          });
        }
      });

      transaction(records);
    },

    async get(collection, id) {
      if (!hasVectorTable) {
        return null;
      }

      const row = getStatement!.get(collection, id);
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

      if (!hasVectorTable) {
        return [];
      }

      if (
        vectorExtensionConfig.mode !== "off" &&
        vectorExtensionConfig.paths?.length &&
        ensureVectorExtensionLoaded().loaded
      ) {
        try {
          const extensionResults =
            vectorExtensionConfig.backend === "sqlite-vss"
              ? searchSQLiteVectorsWithVss({
                  collection,
                  filter: input.filter,
                  queryEmbedding,
                  topK: input.topK,
                })
              : (
                  dependencies?.runExtensionSearch ??
                  searchSQLiteVectorsWithExtension
                )({
                  collection,
                  config: vectorExtensionConfig,
                  database,
                  filter: input.filter,
                  queryEmbedding,
                  topK: input.topK,
                });

          if (extensionResults !== null) {
            return extensionResults;
          }

          if (vectorExtensionConfig.mode === "require") {
            throw new Error(
              "SQLite vector extension search could not satisfy the current query without durable fallback.",
            );
          }
        } catch (error) {
          if (vectorExtensionConfig.mode === "require") {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(
              `Failed to execute SQLite vector extension search for ${collection}: ${message}`,
            );
          }
        }
      }

      return listStatement!
        .all(collection)
        .map<VectorSearchResult>((row) => {
          const embedding = parseJson<number[]>(row.embedding_json);
          const metadata = parseJson<Record<string, unknown>>(row.metadata_json);
          return {
            id: row.id,
            embedding,
            metadata,
            content: row.content,
            score: scoreDotProduct(embedding, queryEmbedding),
          };
        })
        .filter((record) => matchesFilter(record.metadata, input.filter))
        .sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }

          return left.id.localeCompare(right.id);
        })
        .slice(0, input.topK);
    },

    async delete(collection, id) {
      if (options?.readOnly) {
        throw createReadOnlyMutationError("vector");
      }

      const transaction = database.transaction(() => {
        const current = rowIdentityStatement!.get(collection, id);
        const acceleratedSQLiteVss = hasAcceleratedSQLiteVss();
        if (
          current &&
          acceleratedSQLiteVss
        ) {
          const dimension = parseJson<number[]>(current.embedding_json).length;
          const tableName = ensureSQLiteVssTable(collection, dimension);
          if (tableName) {
            executeSQLiteVssDelete(database, tableName, current.rowid);
          }
        }

        if (
          current &&
          !acceleratedSQLiteVss
        ) {
          const dimension = parseJson<number[]>(current.embedding_json).length;
          markSQLiteVssIndexDirty(collection, dimension);
        }

        deleteStatement!.run(collection, id);
      });

      transaction();
    },
  };
}
