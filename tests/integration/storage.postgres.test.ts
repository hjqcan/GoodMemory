import { SQL } from "bun";
import { describe, expect, it } from "bun:test";
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
        await store.set("recall_documents_v2", "doc-1", {
          id: "doc-1",
          scopeKey: "user-1/workspace-1",
          searchText: "atlas release blocker",
        });
        await expect(store.searchText?.("recall_documents_v2", {
          field: "searchText",
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

        const plan = await sql.begin(async (transaction) => {
          await transaction.unsafe("SET LOCAL enable_seqscan = off");
          return transaction.unsafe<Array<Record<string, string>>>(
            `
              EXPLAIN
              SELECT document
              FROM ${quoteIdentifier(schema)}.gm_documents
              WHERE to_tsvector(
                  'simple',
                  COALESCE(document ->> 'searchText', '')
                ) @@ to_tsquery('simple', $1)
              LIMIT 1
            `,
            ["atlas"],
          );
        });
        expect(JSON.stringify(plan)).toContain(
          "gm_documents_search_text_search_idx",
        );
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
