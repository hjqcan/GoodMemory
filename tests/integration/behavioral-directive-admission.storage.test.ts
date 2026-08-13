import { SQL } from "bun";
import { describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createGoodMemory } from "../../src";
import { createChineseLanguagePack } from "../../src/language";
import type { LanguagePack } from "../../src/language";
import {
  PROJECTION_MANIFESTS_COLLECTION,
  RECALL_DOCUMENTS_COLLECTION,
} from "../../src/recall/projections/contracts";
import type {
  RecallIndexDocument,
  RecallProjectionManifest,
} from "../../src/recall/projections/contracts";
import type { ProjectionCapableDocumentStore } from "../../src/storage/contracts";
import { recallScopeKey } from "../../src/recall/projections/shared";
import {
  createPostgresDocumentStore,
  migratePostgresStorageBackend,
} from "../../src/storage/postgres";
import { createSQLiteDocumentStore } from "../../src/storage/sqlite";

const POSTGRES_URL = process.env.GOODMEMORY_TEST_POSTGRES_URL;
const PREVIOUS_ANALYZER_VERSION = "17-behavioral-directive-admission";
const CURRENT_ANALYZER_VERSION = "18-reported-directive-scope";
const ONE_OFF_DIRECTIVE =
  "请用 read 工具读取 hello.txt 的内容，并把其中的标记原样告诉我。";
const DURABLE_DIRECTIVE = "以后请用要点汇报状态。";

type MemoryFactory = (
  packs?: readonly LanguagePack[],
) => ReturnType<typeof createGoodMemory>;

async function expectStorageAdmission(
  createMemory: MemoryFactory,
  documentStore: ProjectionCapableDocumentStore,
  scope: { userId: string; workspaceId: string },
): Promise<void> {
  const previousPack = {
    ...createChineseLanguagePack("Hans"),
    analyzerVersion: PREVIOUS_ANALYZER_VERSION,
  };
  const previousMemory = createMemory([previousPack]);
  const durable = await previousMemory.remember({
    locale: "zh-CN",
    messages: [{ content: DURABLE_DIRECTIVE, role: "user" }],
    scope,
  });

  expect(durable.accepted).toBe(1);
  expect(
    (await documentStore.query<RecallIndexDocument>(
      RECALL_DOCUMENTS_COLLECTION,
      { sourceCollection: "feedback", ...scope },
    )).some(({ searchAnalyzerVersion }) =>
      searchAnalyzerVersion === PREVIOUS_ANALYZER_VERSION
    ),
  ).toBe(true);

  const currentMemory = createMemory();
  await currentMemory.recall({
    locale: "zh-CN",
    query: "以后如何汇报状态？",
    scope,
  });
  const before = await currentMemory.exportMemory({ scope });
  const oneOff = await currentMemory.remember({
    locale: "zh-CN",
    messages: [{ content: ONE_OFF_DIRECTIVE, role: "user" }],
    scope,
  });
  const after = await currentMemory.exportMemory({ scope });

  expect(oneOff.accepted).toBe(0);
  expect(after.durable.feedback).toEqual(before.durable.feedback);
  expect(after.durable.facts).toEqual(before.durable.facts);
  expect(after.durable.references).toEqual(before.durable.references);
  expect(after.durable.evidence).toEqual(before.durable.evidence);
  expect(after.durable.feedback).toEqual([
    expect.objectContaining({ rule: DURABLE_DIRECTIVE }),
  ]);

  const documents = await documentStore.query<RecallIndexDocument>(
    RECALL_DOCUMENTS_COLLECTION,
    scope,
  );
  expect(documents.some(({ text }) => text.includes("hello.txt"))).toBe(false);
  expect(documents.some(({ searchAnalyzerVersion }) =>
    searchAnalyzerVersion === CURRENT_ANALYZER_VERSION
  )).toBe(true);
  expect(documents.some(({ searchAnalyzerVersion }) =>
    searchAnalyzerVersion === PREVIOUS_ANALYZER_VERSION
  )).toBe(false);
  await expect(documentStore.searchText!(RECALL_DOCUMENTS_COLLECTION, {
    field: "searchText",
    filter: scope,
    limit: 10,
    query: "read hello.txt",
  })).resolves.toEqual([]);

  const manifests = await documentStore.query<RecallProjectionManifest>(
    PROJECTION_MANIFESTS_COLLECTION,
  );
  const manifest = manifests.find(
    ({ scopeKey }) => scopeKey === recallScopeKey(scope),
  );
  expect(manifest?.validatedGeneration).toBe(manifest?.sourceGeneration);
  expect(manifest?.projectionBuildId).toStartWith("gm-projection-v5:");
}

describe("behavioral directive admission storage", () => {
  it("keeps one-off directives out of SQLite and rebuilds stale projections", async () => {
    const path = join(
      tmpdir(),
      `goodmemory-behavioral-admission-${Date.now()}-${Math.random()}.sqlite`,
    );
    const documentStore = createSQLiteDocumentStore(path);

    try {
      await expectStorageAdmission(
        (packs) =>
          createGoodMemory({
            ...(packs ? { language: { packs } } : {}),
            retrieval: { preset: "recommended" },
            storage: { provider: "sqlite", url: path },
          }),
        documentStore,
        {
          userId: "sqlite-behavioral-admission-user",
          workspaceId: "sqlite-behavioral-admission-workspace",
        },
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
  postgresIt("keeps one-off directives out of PostgreSQL and rebuilds stale projections", async () => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const scope = {
      userId: `postgres-behavioral-admission-user-${unique}`,
      workspaceId: "postgres-behavioral-admission-workspace",
    };
    const storage = { url: POSTGRES_URL! };
    const sql = new SQL(POSTGRES_URL!);

    try {
      await migratePostgresStorageBackend(storage, { log: () => {} });
      const documentStore = createPostgresDocumentStore(storage);
      await expectStorageAdmission(
        (packs) =>
          createGoodMemory({
            ...(packs ? { language: { packs } } : {}),
            retrieval: { preset: "recommended" },
            storage: { provider: "postgres", url: POSTGRES_URL! },
          }),
        documentStore,
        scope,
      );
    } finally {
      await sql.unsafe(
        `
          DELETE FROM "public"."gm_documents"
          WHERE document->>'userId' = $1
            AND document->>'workspaceId' = $2
        `,
        [scope.userId, scope.workspaceId],
      );
      await sql.unsafe(
        `
          DELETE FROM "public"."gm_session_state"
          WHERE scope_key LIKE $1
        `,
        [`${scope.userId}::%`],
      );
      await sql.unsafe(
        `
          DELETE FROM "public"."gm_vectors"
          WHERE metadata->>'userId' = $1
            AND metadata->>'workspaceId' = $2
        `,
        [scope.userId, scope.workspaceId],
      );
      await sql.close();
    }
  }, 30_000);
});
