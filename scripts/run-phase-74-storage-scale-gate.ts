import { SQL } from "bun";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  buildClaimProjectionSearchText,
  buildClaimProjectionStatusId,
} from "../src/recall/projections/claims";
import {
  CLAIM_PROJECTIONS_COLLECTION,
  CLAIM_PROJECTION_STATUS_COLLECTION,
  ENTITIES_COLLECTION,
} from "../src/recall/projections/contracts";
import type {
  ClaimProjection,
  ClaimProjectionStatus,
  EntityAdjacencyProjection,
} from "../src/recall/projections/contracts";
import { buildEntityProjectionSearchText } from "../src/recall/projections/entityIndex";
import { createRecallProjectionRuntime } from "../src/recall/projections/runtime";
import { recallScopeKey } from "../src/recall/projections/shared";
import type { ProjectionCapableDocumentStore } from "../src/storage/contracts";
import {
  createPostgresDocumentStore,
  migratePostgresStorageBackend,
} from "../src/storage/postgres";
import { createSQLiteDocumentStore } from "../src/storage/sqlite";
import { buildDocumentSearchQuery } from "../src/storage/textSearch";
import {
  parseCliPositiveIntegerFlagStrict,
  resolveCliFlagValueStrict,
} from "./cli-options";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

const DEFAULT_MEASURED_QUERY_COUNT = 40;
const DEFAULT_SYNTHETIC_DOCUMENT_COUNT = 100_000;
const DEFAULT_WARMUP_QUERY_COUNT = 5;
const QUERY_SHARD_COUNT = 2_048;
const POSTGRES_DOCUMENTS_PER_COLLECTION = 50_000;
const POSTGRES_SEARCH_TEXT_INDEX = "gm_documents_search_text_search_idx";
const SCALE_GATE_P95_THRESHOLD_MS = 500;
const SELECTED_LIMIT = 12;
const SENTINEL_ID = "__full_collection_deserialization_sentinel__";
const SCOPE = {
  userId: "phase-74-scale-user",
  workspaceId: "phase-74-scale-workspace",
};
const SCOPE_KEY = recallScopeKey(SCOPE);
const TIMESTAMP = "2026-07-18T00:00:00.000Z";
const COMMON_SOURCE_PATHS = [
  "scripts/run-phase-74-storage-scale-gate.ts",
  "src/recall/projections/claims.ts",
  "src/recall/projections/contracts.ts",
  "src/recall/projections/entityIndex.ts",
  "src/recall/projections/runtime.ts",
  "src/recall/projections/shared.ts",
  "src/storage/contracts.ts",
  "src/storage/textSearch.ts",
] as const;
const DATABASE_SOURCE_PATHS = {
  postgres: ["src/storage/postgres.ts"],
  sqlite: ["src/storage/sqlite.ts"],
} as const;
const SCALE_LANGUAGES = [
  {
    claimText: "Durable claim",
    entityText: "Durable entity projection",
    id: "en",
    locale: "en-US",
  },
  {
    claimText: "持久声明",
    entityText: "持久实体投影",
    id: "zh-Hans",
    locale: "zh-CN",
  },
  {
    claimText: "持久聲明",
    entityText: "持久實體投影",
    id: "zh-Hant",
    locale: "zh-TW",
  },
  {
    claimText: "永続クレーム",
    entityText: "永続エンティティ投影",
    id: "ja",
    locale: "ja-JP",
  },
  {
    claimText: "영구 주장",
    entityText: "영구 엔터티 투영",
    id: "ko",
    locale: "ko-KR",
  },
  {
    claimText: "Assertion durable",
    entityText: "Projection d'entité durable",
    id: "fr",
    locale: "fr-FR",
  },
  {
    claimText: "Afirmación duradera",
    entityText: "Proyección de entidad duradera",
    id: "es",
    locale: "es-ES",
  },
] as const;

type ScaleLanguagePackId = (typeof SCALE_LANGUAGES)[number]["id"];

interface QueryPlanRow {
  detail: string;
}

interface JsonValidityRow {
  valid: number;
}

interface LanguagePackCountRow {
  count: number;
  languagePackId: ScaleLanguagePackId;
}

interface StoreMethodCalls {
  get: number;
  query: number;
  queryPage: number;
  searchText: number;
}

interface ProjectionCounts {
  claims: number;
  entities: number;
  statuses: number;
}

interface PostgresExplainPlanNode {
  "Actual Rows"?: number;
  "Index Name"?: string;
  Plans?: PostgresExplainPlanNode[];
}

interface PostgresExplainRow {
  "QUERY PLAN": unknown;
}

interface PostgresIndexRow {
  indexdef: string;
  indexname: string;
}

interface PostgresSchemaVersionRow {
  component: string;
  version: number;
}

interface PostgresScaleCollectionRow {
  collection: string;
  count: number;
  language_pack_count: number;
}

interface ScaleLatencyMs {
  max: number;
  mean: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface Phase74StorageScaleGateSourceBinding {
  commitSha: string;
  sourceManifestSha256: string;
  sources: ReadonlyArray<{
    path: string;
    sha256: string;
  }>;
  treeSha: string;
  worktreeClean: boolean;
}

export interface Phase74StorageScaleGateOptions {
  measuredQueryCount?: number;
  onProgress?: (message: string) => void;
  outputPath?: string;
  sourceBinding?: Phase74StorageScaleGateSourceBinding;
  syntheticDocumentCount?: number;
  thresholdMs?: number;
  warmupQueryCount?: number;
}

export interface Phase74StorageScaleGateReport {
  artifactSchemaVersion: "phase74-storage-scale-gate-v1";
  audit: {
    ftsIndexedDocumentCount: number;
    ftsKeyCount: number;
    languagePackCounts: Record<ScaleLanguagePackId, number>;
    materializationCounters: {
      fullCollectionReads: number;
      maxDocumentsPerChannelPerQuery: number;
      pagedReads: number;
      pointReads: number;
      textSearches: number;
    };
    maxMaterializedDocumentsPerQuery: number;
    methodCalls: StoreMethodCalls;
    nonMatchingSentinelDidNotBreakSearch: boolean;
    projectionCounts: ProjectionCounts;
    sentinelJsonValid: boolean;
    sqlQueryPlan: string[];
    storedRowCount: number;
    usesFtsVirtualTableIndex: boolean;
  };
  database: "sqlite";
  gate: "claim-entity-projection-query";
  generatedAt: string;
  latencyMs: {
    max: number;
    mean: number;
    min: number;
    p50: number;
    p95: number;
    p99: number;
  };
  measuredQueryCount: number;
  parameters: {
    measuredQueryCount: number;
    searchableDocumentCount: number;
    selectedLimit: number;
    storedProjectionDocumentCount: number;
    thresholdMs: number;
    warmupQueryCount: number;
  };
  passed: boolean;
  phase: "phase-74";
  runtime: {
    arch: string;
    bunVersion: string;
    platform: NodeJS.Platform;
  };
  selectedLimit: number;
  sourceBinding: Phase74StorageScaleGateSourceBinding;
  syntheticDocumentCount: number;
  thresholdMs: number;
  warmupQueryCount: number;
}

export interface Phase74StorageScaleGateCliOptions {
  database: "postgres" | "sqlite";
  measuredQueryCount?: number;
  outputPath: string;
  syntheticDocumentCount?: number;
  thresholdMs?: number;
  warmupQueryCount?: number;
}

export interface Phase74PostgresStorageScaleGateAudit {
  collectionCounts: ProjectionCounts;
  explain: {
    actualRows: number;
    indexNames: string[];
    plan: unknown;
    planSha256: string;
    querySha256: string;
  };
  indexProvenance: {
    definition: string;
    definitionSha256: string;
    name: string;
    schemaVersions: PostgresSchemaVersionRow[];
  };
  languagePackCountByCollection: ProjectionCounts;
  materializationCounters: {
    fullCollectionReads: number;
    maxDocumentsPerChannelPerQuery: number;
    pagedReads: number;
    pointReads: number;
    textSearches: number;
  };
}

export interface Phase74PostgresStorageScaleGateReport {
  artifactSchemaVersion: "phase74-storage-scale-gate-v1";
  audit: Phase74PostgresStorageScaleGateAudit;
  database: "postgres";
  gate: "claim-entity-projection-query";
  generatedAt: string;
  latencyMs: ScaleLatencyMs;
  measuredQueryCount: number;
  parameters: {
    measuredQueryCount: number;
    searchableDocumentCount: number;
    selectedLimit: number;
    storedProjectionDocumentCount: number;
    thresholdMs: number;
    warmupQueryCount: number;
  };
  passed: boolean;
  phase: "phase-74";
  runtime: {
    arch: string;
    bunVersion: string;
    platform: NodeJS.Platform;
  };
  selectedLimit: number;
  sourceBinding: Phase74StorageScaleGateSourceBinding;
  syntheticDocumentCount: number;
  thresholdMs: number;
  warmupQueryCount: number;
}

export interface Phase74PostgresStorageScaleGateOptions {
  measuredQueryCount?: number;
  onProgress?: (message: string) => void;
  outputPath?: string;
  postgresUrl: string;
  sourceBinding?: Phase74StorageScaleGateSourceBinding;
  thresholdMs?: number;
  warmupQueryCount?: number;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function runGit(repoRoot: string, args: readonly string[]): Promise<string> {
  const child = Bun.spawn({
    cmd: ["git", ...args],
    cwd: repoRoot,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`);
  }
  return stdout.trim();
}

export async function collectPhase74StorageScaleGateSourceBinding(
  repoRoot: string,
  database: "postgres" | "sqlite" = "sqlite",
): Promise<Phase74StorageScaleGateSourceBinding> {
  const sourcePaths = [
    ...COMMON_SOURCE_PATHS,
    ...DATABASE_SOURCE_PATHS[database],
  ].sort();
  const [commitSha, status, treeSha, sources] = await Promise.all([
    runGit(repoRoot, ["rev-parse", "HEAD"]),
    runGit(repoRoot, ["status", "--porcelain", "--untracked-files=all"]),
    runGit(repoRoot, ["rev-parse", "HEAD^{tree}"]),
    Promise.all(sourcePaths.map(async (path) => ({
      path,
      sha256: sha256(await readFile(join(repoRoot, path))),
    }))),
  ]);
  return {
    commitSha,
    sourceManifestSha256: sha256(JSON.stringify(sources)),
    sources,
    treeSha,
    worktreeClean: status.length === 0,
  };
}

function sourceBindingIsComplete(
  binding: Phase74StorageScaleGateSourceBinding,
): boolean {
  return /^[0-9a-f]{40}$/u.test(binding.commitSha) &&
    /^[0-9a-f]{40}$/u.test(binding.treeSha) &&
    /^[0-9a-f]{64}$/u.test(binding.sourceManifestSha256) &&
    sha256(JSON.stringify(binding.sources)) === binding.sourceManifestSha256 &&
    binding.sources.length > 0 &&
    binding.sources.every(({ path, sha256: digest }) =>
      path.length > 0 && /^[0-9a-f]{64}$/u.test(digest)
    );
}

export function parsePhase74StorageScaleGateCliOptions(
  argv: readonly string[],
  repoRoot = resolveRepoRootFromScriptUrl(import.meta.url),
): Phase74StorageScaleGateCliOptions {
  const database = resolveCliFlagValueStrict(argv, "--database") ?? "sqlite";
  if (database !== "sqlite" && database !== "postgres") {
    throw new Error("--database must be sqlite or postgres.");
  }
  const output = resolveCliFlagValueStrict(argv, "--output") ??
    join(
      repoRoot,
      `reports/quality-gates/phase-74/storage-scale/phase-74-${database}-storage-scale-gate.json`,
    );
  return {
    database,
    measuredQueryCount: parseCliPositiveIntegerFlagStrict(
      argv,
      "--measured-query-count",
    ),
    outputPath: resolve(repoRoot, output),
    syntheticDocumentCount: parseCliPositiveIntegerFlagStrict(
      argv,
      "--synthetic-document-count",
    ),
    thresholdMs: parseCliPositiveIntegerFlagStrict(argv, "--threshold-ms"),
    warmupQueryCount: parseCliPositiveIntegerFlagStrict(
      argv,
      "--warmup-query-count",
    ),
  };
}

export function resolvePhase74PostgresStorageScaleGateUrl(
  environment: Record<string, string | undefined> = process.env,
): string {
  const url = environment.GOODMEMORY_TEST_POSTGRES_URL?.trim();
  if (!url) {
    throw new Error(
      "GOODMEMORY_TEST_POSTGRES_URL is required for the Postgres storage scale gate.",
    );
  }
  return url;
}

function percentile(sortedValues: readonly number[], probability: number): number {
  const index = Math.max(0, Math.ceil(sortedValues.length * probability) - 1);
  return sortedValues[index]!;
}

function summarizeLatencies(latencies: number[]): ScaleLatencyMs {
  latencies.sort((left, right) => left - right);
  return {
    max: roundMilliseconds(latencies.at(-1)!),
    mean: roundMilliseconds(
      latencies.reduce((total, latency) => total + latency, 0) /
        latencies.length,
    ),
    min: roundMilliseconds(latencies[0]!),
    p50: roundMilliseconds(percentile(latencies, 0.5)),
    p95: roundMilliseconds(percentile(latencies, 0.95)),
    p99: roundMilliseconds(percentile(latencies, 0.99)),
  };
}

export function buildPhase74PostgresStorageScaleGateReport(input: {
  audit: Phase74PostgresStorageScaleGateAudit;
  latencyMs: ScaleLatencyMs;
  measuredQueryCount: number;
  sourceBinding: Phase74StorageScaleGateSourceBinding;
  thresholdMs: number;
  warmupQueryCount: number;
}): Phase74PostgresStorageScaleGateReport {
  const searchableDocumentCount = POSTGRES_DOCUMENTS_PER_COLLECTION * 2;
  const storedProjectionDocumentCount = POSTGRES_DOCUMENTS_PER_COLLECTION * 3;
  const expectedSearches = 2 *
    (input.warmupQueryCount + input.measuredQueryCount);
  const passed = input.sourceBinding.worktreeClean &&
    sourceBindingIsComplete(input.sourceBinding) &&
    input.latencyMs.p95 <= input.thresholdMs &&
    input.audit.collectionCounts.claims === POSTGRES_DOCUMENTS_PER_COLLECTION &&
    input.audit.collectionCounts.entities === POSTGRES_DOCUMENTS_PER_COLLECTION &&
    input.audit.collectionCounts.statuses === POSTGRES_DOCUMENTS_PER_COLLECTION &&
    input.audit.languagePackCountByCollection.claims === SCALE_LANGUAGES.length &&
    input.audit.languagePackCountByCollection.entities === SCALE_LANGUAGES.length &&
    input.audit.languagePackCountByCollection.statuses === SCALE_LANGUAGES.length &&
    input.audit.materializationCounters.fullCollectionReads === 0 &&
    input.audit.materializationCounters.pagedReads === 0 &&
    input.audit.materializationCounters.textSearches === expectedSearches &&
    input.audit.materializationCounters.maxDocumentsPerChannelPerQuery <=
      SELECTED_LIMIT &&
    input.audit.explain.actualRows <= SELECTED_LIMIT &&
    input.audit.explain.indexNames.includes(POSTGRES_SEARCH_TEXT_INDEX) &&
    input.audit.indexProvenance.name === POSTGRES_SEARCH_TEXT_INDEX &&
    input.audit.indexProvenance.definition.length > 0 &&
    /^[0-9a-f]{64}$/u.test(input.audit.indexProvenance.definitionSha256) &&
    /^[0-9a-f]{64}$/u.test(input.audit.explain.planSha256) &&
    /^[0-9a-f]{64}$/u.test(input.audit.explain.querySha256);
  return {
    artifactSchemaVersion: "phase74-storage-scale-gate-v1",
    audit: input.audit,
    database: "postgres",
    gate: "claim-entity-projection-query",
    generatedAt: new Date().toISOString(),
    latencyMs: input.latencyMs,
    measuredQueryCount: input.measuredQueryCount,
    parameters: {
      measuredQueryCount: input.measuredQueryCount,
      searchableDocumentCount,
      selectedLimit: SELECTED_LIMIT,
      storedProjectionDocumentCount,
      thresholdMs: input.thresholdMs,
      warmupQueryCount: input.warmupQueryCount,
    },
    passed,
    phase: "phase-74",
    runtime: {
      arch: process.arch,
      bunVersion: Bun.version,
      platform: process.platform,
    },
    selectedLimit: SELECTED_LIMIT,
    sourceBinding: input.sourceBinding,
    syntheticDocumentCount: searchableDocumentCount,
    thresholdMs: input.thresholdMs,
    warmupQueryCount: input.warmupQueryCount,
  };
}

function queryTerm(iteration: number, perChannelDocumentCount: number): string {
  const shardCount = Math.min(QUERY_SHARD_COUNT, perChannelDocumentCount);
  return `shard${(iteration * 37) % shardCount}`;
}

function createAuditedStore(inner: ProjectionCapableDocumentStore): {
  methodCalls: StoreMethodCalls;
  store: ProjectionCapableDocumentStore;
} {
  const methodCalls: StoreMethodCalls = {
    get: 0,
    query: 0,
    queryPage: 0,
    searchText: 0,
  };
  const store: ProjectionCapableDocumentStore = {
    projectionBatchSemantics: inner.projectionBatchSemantics,
    async set(collection, id, document) {
      return inner.set(collection, id, document);
    },
    async get(collection, id) {
      methodCalls.get += 1;
      return inner.get(collection, id);
    },
    async update(collection, id, patch) {
      return inner.update(collection, id, patch);
    },
    async query(collection, filter) {
      methodCalls.query += 1;
      return inner.query(collection, filter);
    },
    async queryPage(collection, input) {
      methodCalls.queryPage += 1;
      return inner.queryPage!(collection, input);
    },
    async searchText(collection, input) {
      methodCalls.searchText += 1;
      return inner.searchText!(collection, input);
    },
    async writeBatchIfUnchanged(input) {
      return inner.writeBatchIfUnchanged(input);
    },
    async delete(collection, id) {
      return inner.delete(collection, id);
    },
  };
  return { methodCalls, store };
}

function createClaim(index: number): ClaimProjection {
  const suffix = index.toString().padStart(6, "0");
  const sourceMemoryId = `memory-${suffix}`;
  const predicateKey = "project.status";
  const language = SCALE_LANGUAGES[index % SCALE_LANGUAGES.length]!;
  const objectText = `${language.claimText} shard${index % QUERY_SHARD_COUNT} sequence${index}`;
  const text = buildClaimProjectionSearchText({
    subject: "Phase 74 scale project",
    predicateKey,
    objectText,
    polarity: "positive",
    modality: "asserted",
  });
  return {
    id: `claim-${suffix}`,
    schemaVersion: 2,
    ...SCOPE,
    scopeKey: SCOPE_KEY,
    sourceMemoryId,
    subjectEntityId: "entity:phase-74-scale-project",
    predicateKey,
    objectText,
    text,
    searchText: text,
    searchLocale: language.locale,
    languagePackId: language.id,
    searchAnalyzerVersion: "scale-v1",
    searchSchemaVersion: "gm-search-v3",
    polarity: "positive",
    modality: "asserted",
    observedAt: TIMESTAMP,
    ingestedAt: TIMESTAMP,
    evidenceIds: [`evidence-${suffix}`],
    sourceMessageIds: [`message-${suffix}`],
    extractorVersion: "phase-74-scale-v1",
  };
}

function createClaimStatus(claim: ClaimProjection): ClaimProjectionStatus {
  return {
    id: buildClaimProjectionStatusId(SCOPE, claim.sourceMemoryId),
    schemaVersion: 2,
    ...SCOPE,
    scopeKey: SCOPE_KEY,
    sourceMemoryId: claim.sourceMemoryId,
    state: "projected",
    claimIds: [claim.id],
    extractorVersion: claim.extractorVersion,
    sourceUpdatedAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function createEntity(index: number): EntityAdjacencyProjection {
  const suffix = index.toString().padStart(6, "0");
  const canonicalKey = `entity shard${index % QUERY_SHARD_COUNT}`;
  const aliases = [`Entity ${index}`];
  const language = SCALE_LANGUAGES[index % SCALE_LANGUAGES.length]!;
  const description = `${language.entityText} sequence${index}`;
  const text = buildEntityProjectionSearchText({
    aliases,
    canonicalKey,
    description,
  });
  return {
    id: `entity-edge-${suffix}`,
    schemaVersion: 2,
    ...SCOPE,
    scopeKey: SCOPE_KEY,
    entityId: `entity-${suffix}`,
    canonicalKey,
    memoryId: `facts:entity-memory-${suffix}`,
    aliases,
    description,
    text,
    searchText: text,
    searchLocale: language.locale,
    languagePackId: language.id,
    searchAnalyzerVersion: "scale-v1",
    searchSchemaVersion: "gm-search-v3",
    updatedAt: TIMESTAMP,
  };
}

function seedProjectionDocuments(input: {
  databasePath: string;
  onProgress?: (message: string) => void;
  syntheticDocumentCount: number;
}): {
  ftsIndexedDocumentCount: number;
  ftsKeyCount: number;
  languagePackCounts: Record<ScaleLanguagePackId, number>;
  projectionCounts: ProjectionCounts;
  sentinelJsonValid: boolean;
  storedRowCount: number;
} {
  const claims = Math.ceil(input.syntheticDocumentCount / 2);
  const entities = input.syntheticDocumentCount - claims;
  const projectionCounts = { claims, entities, statuses: claims };
  const database = new Database(input.databasePath, { strict: true });
  const insertDocument = database.query(
    `INSERT INTO documents (collection, id, json) VALUES (?1, ?2, ?3)`,
  );
  const insertFtsKey = database.query<{ rowid: number }, [string, string]>(
    `INSERT INTO document_text_fts_keys (collection, id)
     VALUES (?1, ?2)
     RETURNING rowid`,
  );
  const insertFts = database.query(
    `INSERT INTO document_text_fts (rowid, collection, id, text, searchText)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  );

  function insertSearchDocument(
    collection: string,
    id: string,
    text: string,
  ): void {
    const key = insertFtsKey.get(collection, id)!;
    insertFts.run(key.rowid, collection, id, text, text);
  }

  database.exec("PRAGMA synchronous = OFF");
  database.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < claims; index += 1) {
      const claim = createClaim(index);
      const status = createClaimStatus(claim);
      insertDocument.run(
        CLAIM_PROJECTIONS_COLLECTION,
        claim.id,
        JSON.stringify(claim),
      );
      insertSearchDocument(
        CLAIM_PROJECTIONS_COLLECTION,
        claim.id,
        claim.searchText,
      );
      insertDocument.run(
        CLAIM_PROJECTION_STATUS_COLLECTION,
        status.id,
        JSON.stringify(status),
      );
      if ((index + 1) % 25_000 === 0) {
        input.onProgress?.(`seeded ${index + 1} claim projections`);
      }
    }
    for (let index = 0; index < entities; index += 1) {
      const entity = createEntity(index);
      insertDocument.run(ENTITIES_COLLECTION, entity.id, JSON.stringify(entity));
      insertSearchDocument(ENTITIES_COLLECTION, entity.id, entity.searchText);
      if ((index + 1) % 25_000 === 0) {
        input.onProgress?.(`seeded ${index + 1} entity projections`);
      }
    }

    for (const collection of [CLAIM_PROJECTIONS_COLLECTION, ENTITIES_COLLECTION]) {
      insertDocument.run(collection, SENTINEL_ID, "{invalid-json");
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  const storedRowCount = database
    .query<{ count: number }, [string, string, string]>(
      `SELECT count(*) AS count FROM documents
       WHERE collection IN (?1, ?2, ?3)`,
    )
    .get(
      CLAIM_PROJECTIONS_COLLECTION,
      CLAIM_PROJECTION_STATUS_COLLECTION,
      ENTITIES_COLLECTION,
    )!.count;
  const ftsIndexedDocumentCount = database
    .query<{ count: number }, [string, string]>(
      `SELECT count(*) AS count FROM document_text_fts
       WHERE collection IN (?1, ?2)`,
    )
    .get(CLAIM_PROJECTIONS_COLLECTION, ENTITIES_COLLECTION)!.count;
  const ftsKeyCount = database
    .query<{ count: number }, [string, string]>(
      `SELECT count(*) AS count FROM document_text_fts_keys
       WHERE collection IN (?1, ?2)`,
    )
    .get(CLAIM_PROJECTIONS_COLLECTION, ENTITIES_COLLECTION)!.count;
  const languagePackCounts = Object.fromEntries(
    database
      .query<LanguagePackCountRow, [string, string]>(
        `SELECT
           json_extract(json, '$.languagePackId') AS languagePackId,
           count(*) AS count
         FROM documents
         WHERE collection IN (?1, ?2) AND json_valid(json)
         GROUP BY json_extract(json, '$.languagePackId')`,
      )
      .all(CLAIM_PROJECTIONS_COLLECTION, ENTITIES_COLLECTION)
      .map(({ count, languagePackId }) => [languagePackId, count]),
  ) as Record<ScaleLanguagePackId, number>;
  const sentinelJsonValid = database
    .query<JsonValidityRow, [string, string]>(
      `SELECT json_valid(json) AS valid FROM documents
       WHERE collection = ?1 AND id = ?2`,
    )
    .get(CLAIM_PROJECTIONS_COLLECTION, SENTINEL_ID)?.valid === 1;
  database.close();
  return {
    ftsIndexedDocumentCount,
    ftsKeyCount,
    languagePackCounts,
    projectionCounts,
    sentinelJsonValid,
    storedRowCount,
  };
}

function readFtsQueryPlan(databasePath: string, collection: string): string[] {
  const database = new Database(databasePath, { readonly: true, strict: true });
  const plan = database
    .query<QueryPlanRow, [string, string, string, number]>(
      `EXPLAIN QUERY PLAN
       SELECT documents.id, documents.json, bm25(document_text_fts) AS score
       FROM document_text_fts
       JOIN documents
         ON documents.collection = document_text_fts.collection
        AND documents.id = document_text_fts.id
       WHERE document_text_fts.searchText MATCH ?1
         AND document_text_fts.collection = ?2
         AND json_valid(documents.json)
         AND json_extract(documents.json, '$.scopeKey') = ?3
       ORDER BY score ASC, documents.id ASC
       LIMIT ?4`,
    )
    .all(buildDocumentSearchQuery("shard0"), collection, SCOPE_KEY, SELECTED_LIMIT)
    .map(({ detail }) => `${collection}: ${detail}`);
  database.close();
  return plan;
}

function quotePostgresIdentifier(value: string): string {
  return `"${value}"`;
}

function collectPostgresPlanNodes(
  root: PostgresExplainPlanNode,
): PostgresExplainPlanNode[] {
  return [root, ...(root.Plans ?? []).flatMap(collectPostgresPlanNodes)];
}

function readPostgresExplainRoot(value: unknown): PostgresExplainPlanNode {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Postgres EXPLAIN did not return a JSON plan.");
  }
  const root = (parsed[0] as { Plan?: PostgresExplainPlanNode }).Plan;
  if (!root) {
    throw new Error("Postgres EXPLAIN JSON did not include a root plan.");
  }
  return root;
}

async function dropPostgresScaleSchema(
  postgresUrl: string,
  schema: string,
): Promise<void> {
  const sql = new SQL(postgresUrl);
  try {
    await sql.unsafe(
      `DROP SCHEMA IF EXISTS ${quotePostgresIdentifier(schema)} CASCADE`,
    );
  } finally {
    await sql.close();
  }
}

function postgresProjectionCounts(
  rows: readonly PostgresScaleCollectionRow[],
  field: "count" | "language_pack_count",
): ProjectionCounts {
  const byCollection = new Map(
    rows.map((row) => [row.collection, row[field]]),
  );
  return {
    claims: byCollection.get(CLAIM_PROJECTIONS_COLLECTION) ?? 0,
    entities: byCollection.get(ENTITIES_COLLECTION) ?? 0,
    statuses: byCollection.get(CLAIM_PROJECTION_STATUS_COLLECTION) ?? 0,
  };
}

export async function runPhase74PostgresStorageScaleGate(
  options: Phase74PostgresStorageScaleGateOptions,
): Promise<Phase74PostgresStorageScaleGateReport> {
  const measuredQueryCount = options.measuredQueryCount ?? 24;
  const thresholdMs = options.thresholdMs ?? SCALE_GATE_P95_THRESHOLD_MS;
  const warmupQueryCount = options.warmupQueryCount ?? 4;
  assertPositiveInteger(measuredQueryCount, "measuredQueryCount");
  assertPositiveInteger(thresholdMs, "thresholdMs");
  assertPositiveInteger(warmupQueryCount, "warmupQueryCount");
  const repoRoot = resolveRepoRootFromScriptUrl(import.meta.url);
  const sourceBinding = options.sourceBinding ??
    await collectPhase74StorageScaleGateSourceBinding(repoRoot, "postgres");
  const schema = [
    "gm_phase74_scale",
    process.pid,
    Date.now(),
    Math.random().toString(36).slice(2, 8),
  ].join("_");
  const sql = new SQL(options.postgresUrl);
  const innerStore = createPostgresDocumentStore({
    schema,
    url: options.postgresUrl,
  });

  try {
    options.onProgress?.("bootstrapping isolated Postgres scale schema");
    await innerStore.set("scale_bootstrap", "bootstrap", { id: "bootstrap" });
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
        INSERT INTO ${quotePostgresIdentifier(schema)}.gm_documents (
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
            'searchSchemaVersion', 'gm-search-v3',
            'polarity', 'positive',
            'modality', 'asserted',
            'observedAt', $9::text,
            'ingestedAt', $9::text,
            'evidenceIds', jsonb_build_array('evidence-' || sequence::text),
            'sourceMessageIds', jsonb_build_array('message-' || sequence::text),
            'extractorVersion', 'postgres-scale-v1',
            'entityId', 'entity-' || lpad(sequence::text, 6, '0'),
            'canonicalKey', 'scale entity ' || sequence::text,
            'memoryId', 'facts:memory-' || lpad(sequence::text, 6, '0'),
            'aliases', jsonb_build_array('Scale entity ' || sequence::text),
            'updatedAt', $9::text,
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
        POSTGRES_DOCUMENTS_PER_COLLECTION,
        QUERY_SHARD_COUNT,
        SCOPE.userId,
        SCOPE.workspaceId,
        SCOPE_KEY,
        TIMESTAMP,
      ],
    );
    options.onProgress?.("migrating and analyzing Postgres projection indexes");
    await migratePostgresStorageBackend(
      { schema, url: options.postgresUrl },
      { log: () => {} },
    );
    await sql.unsafe(`ANALYZE ${quotePostgresIdentifier(schema)}.gm_documents`);

    const collectionRows = await sql.unsafe<PostgresScaleCollectionRow[]>(
      `
        SELECT
          collection,
          count(*)::int AS count,
          count(DISTINCT document ->> 'languagePackId')::int AS language_pack_count
        FROM ${quotePostgresIdentifier(schema)}.gm_documents
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
    const { methodCalls, store } = createAuditedStore(innerStore);
    const runtime = createRecallProjectionRuntime({ documentStore: store });
    let maxMaterializedDocumentsPerQuery = 0;

    const executeSearch = async (iteration: number): Promise<void> => {
      const language = SCALE_LANGUAGES[iteration % SCALE_LANGUAGES.length]!;
      const shard = (iteration * 37) % QUERY_SHARD_COUNT;
      const prefix = language.id === "zh-Hans"
        ? "hans"
        : language.id === "zh-Hant"
          ? "hant"
          : language.id;
      const query = `${prefix}${shard}`;
      const [claims, entities] = await Promise.all([
        runtime.searchClaims(
          SCOPE,
          query,
          SELECTED_LIMIT,
          true,
          language.locale,
        ),
        runtime.searchEntities(SCOPE, query, SELECTED_LIMIT, language.locale),
      ]);
      if (claims.length === 0 || entities.length === 0) {
        throw new Error(
          `Postgres scale query ${iteration} did not traverse both projection channels.`,
        );
      }
      maxMaterializedDocumentsPerQuery = Math.max(
        maxMaterializedDocumentsPerQuery,
        claims.length,
        entities.length,
      );
    };

    for (let index = 0; index < warmupQueryCount; index += 1) {
      await executeSearch(index);
    }
    const latencies: number[] = [];
    for (let index = 0; index < measuredQueryCount; index += 1) {
      const startedAt = performance.now();
      await executeSearch(warmupQueryCount + index);
      latencies.push(performance.now() - startedAt);
    }
    const latencyMs = summarizeLatencies(latencies);

    const explainQuery = `
      EXPLAIN (ANALYZE, FORMAT JSON)
      SELECT
        id,
        document::text AS document_json,
        ts_rank(
          to_tsvector('simple', COALESCE(document ->> 'searchText', '')),
          to_tsquery('simple', $2)
        ) AS score
      FROM ${quotePostgresIdentifier(schema)}.gm_documents
      WHERE collection = $1
        AND document @> $3::text::jsonb
        AND to_tsvector(
          'simple',
          COALESCE(document ->> 'searchText', '')
        ) @@ to_tsquery('simple', $2)
      ORDER BY score DESC, id ASC
      LIMIT $4
    `;
    const explainRows = await sql.unsafe<PostgresExplainRow[]>(
      explainQuery,
      [
        CLAIM_PROJECTIONS_COLLECTION,
        "hant37",
        JSON.stringify(SCOPE),
        SELECTED_LIMIT,
      ],
    );
    const explainPlan = explainRows[0]?.["QUERY PLAN"];
    const explainRoot = readPostgresExplainRoot(explainPlan);
    const explainNodes = collectPostgresPlanNodes(explainRoot);
    const indexNames = [...new Set(
      explainNodes.flatMap((node) =>
        node["Index Name"] ? [node["Index Name"]] : []
      ),
    )].sort();
    const indexes = await sql.unsafe<PostgresIndexRow[]>(
      `
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = $1 AND tablename = 'gm_documents'
        ORDER BY indexname
      `,
      [schema],
    );
    const searchIndex = indexes.find(({ indexname }) =>
      indexname === POSTGRES_SEARCH_TEXT_INDEX
    );
    const schemaVersions = await sql.unsafe<PostgresSchemaVersionRow[]>(
      `
        SELECT component, version
        FROM ${quotePostgresIdentifier(schema)}.gm_storage_schema
        ORDER BY component
      `,
    );
    const audit: Phase74PostgresStorageScaleGateAudit = {
      collectionCounts: postgresProjectionCounts(collectionRows, "count"),
      explain: {
        actualRows: explainRoot["Actual Rows"] ?? Number.POSITIVE_INFINITY,
        indexNames,
        plan: explainPlan,
        planSha256: sha256(JSON.stringify(explainPlan)),
        querySha256: sha256(explainQuery),
      },
      indexProvenance: {
        definition: searchIndex?.indexdef ?? "",
        definitionSha256: sha256(searchIndex?.indexdef ?? ""),
        name: searchIndex?.indexname ?? "",
        schemaVersions,
      },
      languagePackCountByCollection: postgresProjectionCounts(
        collectionRows,
        "language_pack_count",
      ),
      materializationCounters: {
        fullCollectionReads: methodCalls.query,
        maxDocumentsPerChannelPerQuery: maxMaterializedDocumentsPerQuery,
        pagedReads: methodCalls.queryPage,
        pointReads: methodCalls.get,
        textSearches: methodCalls.searchText,
      },
    };
    const report = buildPhase74PostgresStorageScaleGateReport({
      audit,
      latencyMs,
      measuredQueryCount,
      sourceBinding,
      thresholdMs,
      warmupQueryCount,
    });
    if (options.outputPath) {
      await mkdir(dirname(options.outputPath), { recursive: true });
      await writeFile(
        options.outputPath,
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8",
      );
    }
    return report;
  } finally {
    await sql.close();
    await dropPostgresScaleSchema(options.postgresUrl, schema);
  }
}

export async function runPhase74StorageScaleGate(
  options: Phase74StorageScaleGateOptions = {},
): Promise<Phase74StorageScaleGateReport> {
  const measuredQueryCount = options.measuredQueryCount ??
    DEFAULT_MEASURED_QUERY_COUNT;
  const syntheticDocumentCount = options.syntheticDocumentCount ??
    DEFAULT_SYNTHETIC_DOCUMENT_COUNT;
  const thresholdMs = options.thresholdMs ?? SCALE_GATE_P95_THRESHOLD_MS;
  const warmupQueryCount = options.warmupQueryCount ?? DEFAULT_WARMUP_QUERY_COUNT;
  assertPositiveInteger(measuredQueryCount, "measuredQueryCount");
  assertPositiveInteger(syntheticDocumentCount, "syntheticDocumentCount");
  if (syntheticDocumentCount < 2) {
    throw new Error("syntheticDocumentCount must cover claim and entity projections.");
  }
  assertPositiveInteger(thresholdMs, "thresholdMs");
  assertPositiveInteger(warmupQueryCount, "warmupQueryCount");
  const repoRoot = resolveRepoRootFromScriptUrl(import.meta.url);
  const sourceBinding = options.sourceBinding ??
    await collectPhase74StorageScaleGateSourceBinding(repoRoot);

  const databasePath = join(
    tmpdir(),
    `goodmemory-phase-74-scale-${process.pid}-${Date.now()}-${Math.random()}.db`,
  );
  try {
    const innerStore = createSQLiteDocumentStore(databasePath);
    const seedAudit = seedProjectionDocuments({
      databasePath,
      onProgress: options.onProgress,
      syntheticDocumentCount,
    });
    const sqlQueryPlan = [
      ...readFtsQueryPlan(databasePath, CLAIM_PROJECTIONS_COLLECTION),
      ...readFtsQueryPlan(databasePath, ENTITIES_COLLECTION),
    ];
    const { methodCalls, store } = createAuditedStore(innerStore);
    const runtime = createRecallProjectionRuntime({ documentStore: store });
    const perChannelDocumentCount = Math.min(
      seedAudit.projectionCounts.claims,
      seedAudit.projectionCounts.entities,
    );
    let maxMaterializedDocumentsPerQuery = 0;

    const executeSearch = async (iteration: number): Promise<void> => {
      const query = queryTerm(iteration, perChannelDocumentCount);
      const [claims, entities] = await Promise.all([
        runtime.searchClaims(SCOPE, query, SELECTED_LIMIT),
        runtime.searchEntities(SCOPE, query, SELECTED_LIMIT),
      ]);
      if (claims.length === 0 || entities.length === 0) {
        throw new Error(
          `Scale query ${iteration} did not traverse both projection channels.`,
        );
      }
      maxMaterializedDocumentsPerQuery = Math.max(
        maxMaterializedDocumentsPerQuery,
        claims.length,
        entities.length,
      );
    };

    for (let index = 0; index < warmupQueryCount; index += 1) {
      await executeSearch(index);
    }

    const latencies: number[] = [];
    for (let index = 0; index < measuredQueryCount; index += 1) {
      const startedAt = performance.now();
      await executeSearch(warmupQueryCount + index);
      latencies.push(performance.now() - startedAt);
    }
    latencies.sort((left, right) => left - right);
    const latencyMs = {
      max: roundMilliseconds(latencies.at(-1)!),
      mean: roundMilliseconds(
        latencies.reduce((total, latency) => total + latency, 0) /
          latencies.length,
      ),
      min: roundMilliseconds(latencies[0]!),
      p50: roundMilliseconds(percentile(latencies, 0.5)),
      p95: roundMilliseconds(percentile(latencies, 0.95)),
      p99: roundMilliseconds(percentile(latencies, 0.99)),
    };
    const expectedSearchCount = 2 *
      (warmupQueryCount + measuredQueryCount);
    const usesFtsVirtualTableIndex = [
      CLAIM_PROJECTIONS_COLLECTION,
      ENTITIES_COLLECTION,
    ].every((collection) =>
      sqlQueryPlan.some((detail) =>
        detail.startsWith(`${collection}:`) &&
        /document_text_fts VIRTUAL TABLE INDEX/i.test(detail)
      )
    );
    const expectedStoredRows = syntheticDocumentCount +
      seedAudit.projectionCounts.statuses + 2;
    const nonMatchingSentinelDidNotBreakSearch =
      seedAudit.storedRowCount === expectedStoredRows &&
      !seedAudit.sentinelJsonValid;
    const maximumStatusGets =
      (warmupQueryCount + measuredQueryCount) * SELECTED_LIMIT;
    const passed = sourceBinding.worktreeClean &&
      sourceBindingIsComplete(sourceBinding) &&
      latencyMs.p95 <= thresholdMs &&
      methodCalls.get > 0 &&
      methodCalls.get <= maximumStatusGets &&
      methodCalls.query === 0 &&
      methodCalls.queryPage === 0 &&
      methodCalls.searchText === expectedSearchCount &&
      usesFtsVirtualTableIndex &&
      nonMatchingSentinelDidNotBreakSearch &&
      seedAudit.ftsIndexedDocumentCount === syntheticDocumentCount &&
      seedAudit.ftsKeyCount === seedAudit.ftsIndexedDocumentCount &&
      Object.values(seedAudit.languagePackCounts).every((count) => count > 0) &&
      maxMaterializedDocumentsPerQuery <= SELECTED_LIMIT;

    const report: Phase74StorageScaleGateReport = {
      artifactSchemaVersion: "phase74-storage-scale-gate-v1",
      audit: {
        ...seedAudit,
        maxMaterializedDocumentsPerQuery,
        materializationCounters: {
          fullCollectionReads: methodCalls.query,
          maxDocumentsPerChannelPerQuery: maxMaterializedDocumentsPerQuery,
          pagedReads: methodCalls.queryPage,
          pointReads: methodCalls.get,
          textSearches: methodCalls.searchText,
        },
        methodCalls,
        nonMatchingSentinelDidNotBreakSearch,
        sqlQueryPlan,
        usesFtsVirtualTableIndex,
      },
      database: "sqlite",
      gate: "claim-entity-projection-query",
      generatedAt: new Date().toISOString(),
      latencyMs,
      measuredQueryCount,
      parameters: {
        measuredQueryCount,
        searchableDocumentCount: syntheticDocumentCount,
        selectedLimit: SELECTED_LIMIT,
        storedProjectionDocumentCount: syntheticDocumentCount +
          seedAudit.projectionCounts.statuses,
        thresholdMs,
        warmupQueryCount,
      },
      passed,
      phase: "phase-74",
      runtime: {
        arch: process.arch,
        bunVersion: Bun.version,
        platform: process.platform,
      },
      selectedLimit: SELECTED_LIMIT,
      sourceBinding,
      syntheticDocumentCount,
      thresholdMs,
      warmupQueryCount,
    };
    if (options.outputPath) {
      await mkdir(dirname(options.outputPath), { recursive: true });
      await writeFile(
        options.outputPath,
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8",
      );
    }
    return report;
  } finally {
    await Promise.all([
      rm(databasePath, { force: true }),
      rm(`${databasePath}-shm`, { force: true }),
      rm(`${databasePath}-wal`, { force: true }),
    ]);
  }
}

if (import.meta.main) {
  const { database, ...cliOptions } = parsePhase74StorageScaleGateCliOptions(
    Bun.argv,
  );
  const onProgress = (message: string): void => {
    console.error(`[phase-74-storage-scale] ${message}`);
  };
  const report = database === "postgres"
    ? await runPhase74PostgresStorageScaleGate({
      ...cliOptions,
      onProgress,
      postgresUrl: resolvePhase74PostgresStorageScaleGateUrl(),
    })
    : await runPhase74StorageScaleGate({
      ...cliOptions,
      onProgress,
    });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) {
    process.exitCode = 1;
  }
}
