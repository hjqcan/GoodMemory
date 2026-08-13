import { SQL } from "bun";
import { describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createGoodMemory } from "../../src";
import {
  RECALL_DOCUMENTS_COLLECTION,
  type RecallIndexDocument,
} from "../../src/recall/projections/contracts";
import {
  createPostgresDocumentStore,
  createPostgresSessionStore,
  createPostgresVectorStore,
  migratePostgresStorageBackend,
} from "../../src/storage/postgres";
import type { ProjectionCapableDocumentStore } from "../../src/storage/contracts";
import { createSQLiteDocumentStore } from "../../src/storage/sqlite";

const POSTGRES_URL = process.env.GOODMEMORY_TEST_POSTGRES_URL;
const QUESTION_FACT = "我正在做什么。";
const QUESTION_ANCHOR = "什么";

async function seedHistoricalQuestionFact(
  memory: ReturnType<typeof createGoodMemory>,
  scope: { userId: string; workspaceId: string },
): Promise<string> {
  const result = await memory.remember({
    annotations: [{
      confirmed: true,
      kindHint: "fact",
      messageIndex: 0,
      remember: "always",
    }],
    locale: "zh-CN",
    messages: [{ content: QUESTION_FACT, role: "user" }],
    scope,
  });
  const exported = await memory.exportMemory({ scope });
  const fact = exported.durable.facts.find(({ content }) =>
    content === QUESTION_FACT
  );

  expect(result.accepted).toBeGreaterThan(0);
  expect(fact).toBeDefined();
  return fact!.id;
}

async function expectInterrogativeAnchorAbsent(
  store: ProjectionCapableDocumentStore,
  sourceMemoryId: string,
): Promise<void> {
  const documents = await store.query<RecallIndexDocument>(
    RECALL_DOCUMENTS_COLLECTION,
    { sourceMemoryId },
  );

  expect(documents.length).toBeGreaterThan(0);
  for (const document of documents) {
    expect(document.searchText).not.toContain(QUESTION_ANCHOR);
  }
  await expect(store.searchText!(RECALL_DOCUMENTS_COLLECTION, {
    field: "searchText",
    filter: { sourceMemoryId },
    limit: 10,
    query: QUESTION_ANCHOR,
  })).resolves.toEqual([]);
}

describe("interrogative projection storage", () => {
  it("keeps the interrogative anchor out of SQLite searchText and FTS", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-interrogative-${Date.now()}-${Math.random()}.sqlite`,
    );
    const scope = {
      userId: "sqlite-interrogative-user",
      workspaceId: "sqlite-interrogative-workspace",
    };

    try {
      const memory = createGoodMemory({
        retrieval: { preset: "recommended" },
        storage: { provider: "sqlite", url: path },
      });
      const sourceMemoryId = await seedHistoricalQuestionFact(memory, scope);

      await expectInterrogativeAnchorAbsent(
        createSQLiteDocumentStore(path),
        sourceMemoryId,
      );
    } finally {
      await Promise.all([
        rm(path, { force: true }),
        rm(`${path}-shm`, { force: true }),
        rm(`${path}-wal`, { force: true }),
      ]);
    }
  });

  const postgresIt = POSTGRES_URL ? it : it.skip;
  postgresIt("keeps the interrogative anchor out of PostgreSQL searchText and GIN", async () => {
    const schema = `gm_interrogative_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const storage = { schema, url: POSTGRES_URL! };
    const sql = new SQL(POSTGRES_URL!);

    try {
      await migratePostgresStorageBackend(storage, { log: () => {} });
      const documentStore = createPostgresDocumentStore(storage);
      const memory = createGoodMemory({
        adapters: {
          documentStore,
          sessionStore: createPostgresSessionStore(storage),
          vectorStore: createPostgresVectorStore(storage),
        },
        retrieval: { preset: "recommended" },
      });
      const sourceMemoryId = await seedHistoricalQuestionFact(memory, {
        userId: "postgres-interrogative-user",
        workspaceId: "postgres-interrogative-workspace",
      });

      await expectInterrogativeAnchorAbsent(documentStore, sourceMemoryId);
      const indexes = await sql.unsafe<Array<{ indexdef: string }>>(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = 'gm_documents_search_text_search_idx'`,
        [schema],
      );
      expect(indexes).toHaveLength(1);
      expect(indexes[0]!.indexdef.toLowerCase()).toContain("using gin");
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.close();
    }
  }, 30_000);
});
