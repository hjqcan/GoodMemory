import { SQL } from "bun";
import { describe, expect, it } from "bun:test";
import {
  CLAIM_PROJECTIONS_COLLECTION,
  CLAIM_PROJECTION_STATUS_COLLECTION,
  ENTITIES_COLLECTION,
} from "../../src/recall/projections/contracts";
import { createRecallProjectionRuntime } from "../../src/recall/projections/runtime";
import type { ProjectionCapableDocumentStore } from "../../src/storage/contracts";
import {
  createPostgresDocumentStore,
  createPostgresSessionStore,
  createPostgresVectorStore,
  migratePostgresStorageBackend,
} from "../../src/storage/postgres";
import {
  runDocumentStoreContract,
  runSessionStoreContract,
  runVectorStoreContract,
} from "./storage.contract";

const POSTGRES_URL = process.env.GOODMEMORY_TEST_POSTGRES_URL;
const POSTGRES_SCALE_DOCUMENTS_PER_COLLECTION = 50_000;
const POSTGRES_SCALE_MEASURED_QUERIES = 24;
const POSTGRES_SCALE_SEARCH_LIMIT = 12;
const POSTGRES_SCALE_SHARDS = 2_048;
const POSTGRES_SCALE_WARMUP_QUERIES = 4;
const POSTGRES_SCALE_P95_LIMIT_MS = 500;
const POSTGRES_SEARCH_TEXT_INDEX = "gm_documents_search_text_search_idx";
const SCALE_SCOPE = {
  userId: "postgres-language-scale-user",
  workspaceId: "postgres-language-scale-workspace",
};
const SCALE_SCOPE_KEY = `${SCALE_SCOPE.userId}::${SCALE_SCOPE.workspaceId}`;

interface PostgresScaleAdapterCalls {
  query: number;
  queryPage: number;
  searchText: number;
}

interface ExplainJsonRow {
  "QUERY PLAN": unknown;
}

interface ExplainPlanNode {
  "Actual Rows"?: number;
  "Index Name"?: string;
  Plans?: ExplainPlanNode[];
}

function quoteIdentifier(value: string): string {
  return `"${value}"`;
}

function createSchemaName(prefix: string): string {
  return `gm_test_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function dropSchema(url: string, schema: string): Promise<void> {
  const sql = new SQL(url);

  try {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
  } finally {
    await sql.close();
  }
}

function percentile(sortedValues: readonly number[], probability: number): number {
  const index = Math.max(0, Math.ceil(sortedValues.length * probability) - 1);
  return sortedValues[index]!;
}

function createAuditedProjectionStore(
  inner: ProjectionCapableDocumentStore,
): {
  calls: PostgresScaleAdapterCalls;
  store: ProjectionCapableDocumentStore;
} {
  const calls: PostgresScaleAdapterCalls = {
    query: 0,
    queryPage: 0,
    searchText: 0,
  };
  return {
    calls,
    store: {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      set(collection, id, document) {
        return inner.set(collection, id, document);
      },
      get(collection, id) {
        return inner.get(collection, id);
      },
      update(collection, id, patch) {
        return inner.update(collection, id, patch);
      },
      query(collection, filter) {
        calls.query += 1;
        return inner.query(collection, filter);
      },
      queryPage(collection, input) {
        calls.queryPage += 1;
        return inner.queryPage!(collection, input);
      },
      searchText(collection, input) {
        calls.searchText += 1;
        return inner.searchText!(collection, input);
      },
      writeBatchIfUnchanged(input) {
        return inner.writeBatchIfUnchanged(input);
      },
      delete(collection, id) {
        return inner.delete(collection, id);
      },
    },
  };
}

function readExplainRoot(value: unknown): ExplainPlanNode {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Postgres EXPLAIN did not return a JSON plan.");
  }
  const root = (parsed[0] as { Plan?: ExplainPlanNode }).Plan;
  if (!root) {
    throw new Error("Postgres EXPLAIN JSON did not include a root plan.");
  }
  return root;
}

function collectPlanNodes(root: ExplainPlanNode): ExplainPlanNode[] {
  return [root, ...(root.Plans ?? []).flatMap(collectPlanNodes)];
}

if (POSTGRES_URL) {
  describe("postgres document index migration", () => {
    it("keeps requests correctness-only and migrates document indexes explicitly", async () => {
      const schema = createSchemaName("document_migration");
      const sql = new SQL(POSTGRES_URL);
      const store = createPostgresDocumentStore({
        schema,
        url: POSTGRES_URL,
      });

      try {
        await store.set("recall_documents_v3", "doc-1", {
          id: "doc-1",
          scopeKey: "user-1::workspace-1",
          searchText: "atlas release blocker",
        });
        await expect(store.searchText?.("recall_documents_v3", {
          field: "searchText",
          filter: { scopeKey: "user-1::workspace-1" },
          limit: 1,
          query: "atlas",
        })).resolves.toHaveLength(1);

        const before = await sql.unsafe<Array<{ indexname: string }>>(
          `
            SELECT indexname
            FROM pg_indexes
            WHERE schemaname = $1 AND tablename = 'gm_documents'
            ORDER BY indexname
          `,
          [schema],
        );
        expect(before.map(({ indexname }) => indexname)).toEqual([
          "gm_documents_pkey",
        ]);

        await migratePostgresStorageBackend(
          { schema, url: POSTGRES_URL },
          { log: () => {} },
        );
        await migratePostgresStorageBackend(
          { schema, url: POSTGRES_URL },
          { log: () => {} },
        );

        const indexes = await sql.unsafe<
          Array<{ indexname: string; is_ready: boolean; is_valid: boolean }>
        >(
          `
            SELECT
              index_relation.relname AS indexname,
              index_metadata.indisready AS is_ready,
              index_metadata.indisvalid AS is_valid
            FROM pg_class AS index_relation
            JOIN pg_namespace AS index_namespace
              ON index_namespace.oid = index_relation.relnamespace
            JOIN pg_index AS index_metadata
              ON index_metadata.indexrelid = index_relation.oid
            JOIN pg_class AS table_relation
              ON table_relation.oid = index_metadata.indrelid
            WHERE index_namespace.nspname = $1
              AND table_relation.relname = 'gm_documents'
            ORDER BY index_relation.relname
          `,
          [schema],
        );
        expect(indexes).toEqual([
          {
            indexname: "gm_documents_collection_idx",
            is_ready: true,
            is_valid: true,
          },
          {
            indexname: "gm_documents_document_gin_idx",
            is_ready: true,
            is_valid: true,
          },
          {
            indexname: "gm_documents_pkey",
            is_ready: true,
            is_valid: true,
          },
          {
            indexname: "gm_documents_search_text_search_idx",
            is_ready: true,
            is_valid: true,
          },
          {
            indexname: "gm_documents_text_search_idx",
            is_ready: true,
            is_valid: true,
          },
        ]);

        const versions = await sql.unsafe<Array<{ version: number }>>(
          `
            SELECT version
            FROM ${quoteIdentifier(schema)}.gm_storage_schema
            WHERE component = 'document_indexes'
          `,
        );
        expect(versions).toEqual([{ version: 1 }]);

      } finally {
        await sql.close();
        await dropSchema(POSTGRES_URL, schema);
      }
    });

    it("rejects a wrong same-name index without recording the version", async () => {
      const schema = createSchemaName("document_mismatch");
      const sql = new SQL(POSTGRES_URL);
      const store = createPostgresDocumentStore({
        schema,
        url: POSTGRES_URL,
      });

      try {
        await store.set("facts", "fact-1", { id: "fact-1" });
        await sql.unsafe(`
          CREATE INDEX ${quoteIdentifier("gm_documents_collection_idx")}
          ON ${quoteIdentifier(schema)}.gm_documents (id)
        `);

        await expect(
          migratePostgresStorageBackend(
            { schema, url: POSTGRES_URL },
            { log: () => {} },
          ),
        ).rejects.toThrow("gm_documents_collection_idx");
        const versions = await sql.unsafe<Array<{ version: number }>>(
          `
            SELECT version
            FROM ${quoteIdentifier(schema)}.gm_storage_schema
            WHERE component = 'document_indexes'
          `,
        );
        expect(versions).toEqual([]);
      } finally {
        await sql.close();
        await dropSchema(POSTGRES_URL, schema);
      }
    });

    it("keeps mixed-language projection searches indexed at 150k rows", async () => {
      const schema = createSchemaName("language_scale");
      const sql = new SQL(POSTGRES_URL);
      const innerStore = createPostgresDocumentStore({
        schema,
        url: POSTGRES_URL,
      });

      try {
        await innerStore.set("scale_bootstrap", "bootstrap", {
          id: "bootstrap",
        });
        await innerStore.delete("scale_bootstrap", "bootstrap");

        await sql.unsafe(
          `
            WITH collections(collection, kind) AS (
              VALUES
                ($1::text, 'claim'::text),
                ($2::text, 'entity'::text),
                ($3::text, 'status'::text)
            ), generated AS (
              SELECT
                collection,
                kind,
                sequence,
                kind || '-' || lpad(sequence::text, 6, '0') AS id,
                CASE mod(sequence, 7)
                  WHEN 0 THEN 'en'
                  WHEN 1 THEN 'zh-Hans'
                  WHEN 2 THEN 'zh-Hant'
                  WHEN 3 THEN 'ja'
                  WHEN 4 THEN 'ko'
                  WHEN 5 THEN 'fr'
                  ELSE 'es'
                END AS language_pack_id,
                CASE mod(sequence, 7)
                  WHEN 0 THEN 'en-US'
                  WHEN 1 THEN 'zh-CN'
                  WHEN 2 THEN 'zh-TW'
                  WHEN 3 THEN 'ja-JP'
                  WHEN 4 THEN 'ko-KR'
                  WHEN 5 THEN 'fr-FR'
                  ELSE 'es-ES'
                END AS search_locale,
                CASE mod(sequence, 7)
                  WHEN 0 THEN 'English scale projection en'
                  WHEN 1 THEN '简体中文 规模 索引 hans'
                  WHEN 2 THEN '繁體中文 規模 索引 hant'
                  WHEN 3 THEN '日本語 規模 索引 ja'
                  WHEN 4 THEN '한국어 규모 색인 ko'
                  WHEN 5 THEN 'Projection française indexée fr'
                  ELSE 'Proyección española indexada es'
                END || mod(sequence, $5::int)::text AS search_text
              FROM collections
              CROSS JOIN generate_series(1, $4::int) AS generated_sequence(sequence)
            )
            INSERT INTO ${quoteIdentifier(schema)}.gm_documents (
              collection,
              id,
              document,
              created_at,
              updated_at
            )
            SELECT
              collection,
              id,
              jsonb_build_object(
                'id', id,
                'schemaVersion', 2,
                'userId', $6::text,
                'workspaceId', $7::text,
                'scopeKey', $8::text,
                'sourceMemoryId', 'memory-' || lpad(sequence::text, 6, '0'),
                'subjectEntityId', 'entity:postgres-language-scale',
                'predicateKey', 'project.status',
                'objectText', search_text,
                'text', search_text,
                'searchText', search_text,
                'searchLocale', search_locale,
                'languagePackId', language_pack_id,
                'searchAnalyzerVersion', 'postgres-scale-v1',
                'searchSchemaVersion', 'gm-search-v2',
                'polarity', 'positive',
                'modality', 'asserted',
                'observedAt', '2026-07-21T00:00:00.000Z',
                'ingestedAt', '2026-07-21T00:00:00.000Z',
                'evidenceIds', jsonb_build_array('evidence-' || sequence::text),
                'sourceMessageIds', jsonb_build_array('message-' || sequence::text),
                'extractorVersion', 'postgres-scale-v1',
                'entityId', 'entity-' || lpad(sequence::text, 6, '0'),
                'canonicalKey', 'scale entity ' || sequence::text,
                'memoryId', 'facts:memory-' || lpad(sequence::text, 6, '0'),
                'aliases', jsonb_build_array('Scale entity ' || sequence::text),
                'updatedAt', '2026-07-21T00:00:00.000Z',
                'state', 'projected',
                'claimIds', jsonb_build_array('claim-' || lpad(sequence::text, 6, '0'))
              ),
              NOW(),
              NOW()
            FROM generated
          `,
          [
            CLAIM_PROJECTIONS_COLLECTION,
            ENTITIES_COLLECTION,
            CLAIM_PROJECTION_STATUS_COLLECTION,
            POSTGRES_SCALE_DOCUMENTS_PER_COLLECTION,
            POSTGRES_SCALE_SHARDS,
            SCALE_SCOPE.userId,
            SCALE_SCOPE.workspaceId,
            SCALE_SCOPE_KEY,
          ],
        );

        await migratePostgresStorageBackend(
          { schema, url: POSTGRES_URL },
          { log: () => {} },
        );
        await sql.unsafe(
          `ANALYZE ${quoteIdentifier(schema)}.gm_documents`,
        );

        const seededCounts = await sql.unsafe<
          Array<{
            collection: string;
            count: number;
            language_pack_count: number;
          }>
        >(
          `
            SELECT
              collection,
              count(*)::int AS count,
              count(DISTINCT document ->> 'languagePackId')::int AS language_pack_count
            FROM ${quoteIdentifier(schema)}.gm_documents
            WHERE collection IN ($1, $2, $3)
            GROUP BY collection
            ORDER BY collection
          `,
          [
            CLAIM_PROJECTIONS_COLLECTION,
            ENTITIES_COLLECTION,
            CLAIM_PROJECTION_STATUS_COLLECTION,
          ],
        );
        expect(seededCounts).toEqual([
          {
            collection: CLAIM_PROJECTION_STATUS_COLLECTION,
            count: POSTGRES_SCALE_DOCUMENTS_PER_COLLECTION,
            language_pack_count: 7,
          },
          {
            collection: CLAIM_PROJECTIONS_COLLECTION,
            count: POSTGRES_SCALE_DOCUMENTS_PER_COLLECTION,
            language_pack_count: 7,
          },
          {
            collection: ENTITIES_COLLECTION,
            count: POSTGRES_SCALE_DOCUMENTS_PER_COLLECTION,
            language_pack_count: 7,
          },
        ]);

        const { calls, store } = createAuditedProjectionStore(innerStore);
        const runtime = createRecallProjectionRuntime({ documentStore: store });
        let maxMaterialized = 0;

        const executeSearch = async (iteration: number): Promise<void> => {
          const languages = [
            { locale: "en-US", prefix: "en" },
            { locale: "zh-CN", prefix: "hans" },
            { locale: "zh-TW", prefix: "hant" },
            { locale: "ja-JP", prefix: "ja" },
            { locale: "ko-KR", prefix: "ko" },
            { locale: "fr-FR", prefix: "fr" },
            { locale: "es-ES", prefix: "es" },
          ] as const;
          const language = languages[iteration % languages.length]!;
          const shard = (iteration * 37) % POSTGRES_SCALE_SHARDS;
          const query = `${language.prefix}${shard}`;
          const [claims, entities] = await Promise.all([
            runtime.searchClaims(
              SCALE_SCOPE,
              query,
              POSTGRES_SCALE_SEARCH_LIMIT,
              true,
              language.locale,
            ),
            runtime.searchEntities(
              SCALE_SCOPE,
              query,
              POSTGRES_SCALE_SEARCH_LIMIT,
              language.locale,
            ),
          ]);
          expect(claims.length).toBeGreaterThan(0);
          expect(entities.length).toBeGreaterThan(0);
          maxMaterialized = Math.max(
            maxMaterialized,
            claims.length,
            entities.length,
          );
        };

        for (
          let index = 0;
          index < POSTGRES_SCALE_WARMUP_QUERIES;
          index += 1
        ) {
          await executeSearch(index);
        }

        const latencies: number[] = [];
        for (
          let index = 0;
          index < POSTGRES_SCALE_MEASURED_QUERIES;
          index += 1
        ) {
          const startedAt = performance.now();
          await executeSearch(POSTGRES_SCALE_WARMUP_QUERIES + index);
          latencies.push(performance.now() - startedAt);
        }
        latencies.sort((left, right) => left - right);

        expect(percentile(latencies, 0.95)).toBeLessThanOrEqual(
          POSTGRES_SCALE_P95_LIMIT_MS,
        );
        expect(maxMaterialized).toBeLessThanOrEqual(
          POSTGRES_SCALE_SEARCH_LIMIT,
        );
        expect(calls).toEqual({
          query: 0,
          queryPage: 0,
          searchText: 2 *
            (POSTGRES_SCALE_WARMUP_QUERIES + POSTGRES_SCALE_MEASURED_QUERIES),
        });

        const explainRows = await sql.unsafe<ExplainJsonRow[]>(
          `
            EXPLAIN (ANALYZE, FORMAT JSON)
            SELECT
              id,
              document::text AS document_json,
              ts_rank(
                to_tsvector('simple', COALESCE(document ->> 'searchText', '')),
                to_tsquery('simple', $2)
              ) AS score
            FROM ${quoteIdentifier(schema)}.gm_documents
            WHERE collection = $1
              AND document @> $3::text::jsonb
              AND to_tsvector(
                'simple',
                COALESCE(document ->> 'searchText', '')
              ) @@ to_tsquery('simple', $2)
            ORDER BY score DESC, id ASC
            LIMIT $4
          `,
          [
            CLAIM_PROJECTIONS_COLLECTION,
            "hant37",
            JSON.stringify(SCALE_SCOPE),
            POSTGRES_SCALE_SEARCH_LIMIT,
          ],
        );
        const explainRoot = readExplainRoot(explainRows[0]?.["QUERY PLAN"]);
        const explainNodes = collectPlanNodes(explainRoot);
        const searchIndexNodes = explainNodes.filter((node) =>
          node["Index Name"] === POSTGRES_SEARCH_TEXT_INDEX
        );
        expect(searchIndexNodes.length).toBeGreaterThan(0);
        expect(explainRoot["Actual Rows"]).toBeLessThanOrEqual(
          POSTGRES_SCALE_SEARCH_LIMIT,
        );
      } finally {
        await sql.close();
        await dropSchema(POSTGRES_URL, schema);
      }
    }, 180_000);
  });

  runDocumentStoreContract("postgres document store contract", async () => {
    const schema = createSchemaName("document");

    return {
      store: createPostgresDocumentStore({
        url: POSTGRES_URL,
        schema,
      }),
      cleanup: () => dropSchema(POSTGRES_URL, schema),
    };
  });

  runSessionStoreContract("postgres session store contract", async () => {
    const schema = createSchemaName("session");

    return {
      store: createPostgresSessionStore({
        url: POSTGRES_URL,
        schema,
      }),
      cleanup: () => dropSchema(POSTGRES_URL, schema),
    };
  });

  runVectorStoreContract("postgres vector store contract", async () => {
    const schema = createSchemaName("vector");

    return {
      store: createPostgresVectorStore({
        url: POSTGRES_URL,
        schema,
      }),
      cleanup: () => dropSchema(POSTGRES_URL, schema),
    };
  }, 15_000);
} else {
  describe.skip("postgres storage contracts", () => {
    it("requires GOODMEMORY_TEST_POSTGRES_URL", () => {});
  });
}
