import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildPhase74PostgresStorageScaleGateReport,
  parsePhase74StorageScaleGateCliOptions,
  resolvePhase74PostgresStorageScaleGateUrl,
  runPhase74StorageScaleGate,
} from "../../scripts/run-phase-74-storage-scale-gate";

const SOURCE_BINDING = {
  commitSha: "a".repeat(40),
  sourceManifestSha256: "b".repeat(64),
  sources: [
    {
      path: "scripts/run-phase-74-storage-scale-gate.ts",
      sha256: "c".repeat(64),
    },
    {
      path: "src/storage/sqlite.ts",
      sha256: "d".repeat(64),
    },
  ],
  treeSha: "e".repeat(40),
  worktreeClean: true,
} as const;

describe("phase 74 storage scale gate", () => {
  it("uses bounded claim and entity projection search without full-collection deserialization", async () => {
    const report = await runPhase74StorageScaleGate({
      measuredQueryCount: 8,
      sourceBinding: SOURCE_BINDING,
      syntheticDocumentCount: 1_000,
      warmupQueryCount: 2,
    });

    expect(report.passed).toBe(true);
    expect(report.artifactSchemaVersion).toBe(
      "phase74-storage-scale-gate-v1",
    );
    expect(report.sourceBinding).toEqual(SOURCE_BINDING);
    expect(report.gate).toBe("claim-entity-projection-query");
    expect(report.syntheticDocumentCount).toBe(1_000);
    expect(report.audit.projectionCounts).toEqual({
      claims: 500,
      entities: 500,
      statuses: 500,
    });
    expect(report.audit.languagePackCounts.en).toBeGreaterThan(0);
    expect(report.audit.languagePackCounts["zh-Hant"]).toBeGreaterThan(0);
    expect(report.audit.languagePackCounts.ja).toBeGreaterThan(0);
    expect(report.audit.languagePackCounts.ko).toBeGreaterThan(0);
    expect(report.audit.languagePackCounts.fr).toBeGreaterThan(0);
    expect(report.audit.languagePackCounts.es).toBeGreaterThan(0);
    expect(
      Object.values(report.audit.languagePackCounts).reduce(
        (total, count) => total + count,
        0,
      ),
    ).toBe(report.syntheticDocumentCount);
    expect(report.latencyMs.p95).toBeLessThanOrEqual(500);
    expect(report.audit.methodCalls.query).toBe(0);
    expect(report.audit.methodCalls.queryPage).toBe(0);
    expect(report.audit.methodCalls.searchText).toBe(20);
    expect(report.audit.methodCalls.get).toBeGreaterThan(0);
    expect(report.audit.methodCalls.get).toBeLessThanOrEqual(
      10 * report.selectedLimit,
    );
    expect(report.audit.usesFtsVirtualTableIndex).toBe(true);
    expect(report.audit.nonMatchingSentinelDidNotBreakSearch).toBe(true);
    expect(report.audit.sentinelJsonValid).toBe(false);
    expect(report.audit.ftsKeyCount).toBe(report.syntheticDocumentCount);
    expect(report.audit.ftsIndexedDocumentCount).toBe(
      report.audit.ftsKeyCount,
    );
    expect(report.audit.maxMaterializedDocumentsPerQuery).toBeLessThanOrEqual(
      report.selectedLimit,
    );
    expect(report.audit.materializationCounters).toEqual({
      fullCollectionReads: 0,
      maxDocumentsPerChannelPerQuery: report.audit
        .maxMaterializedDocumentsPerQuery,
      pagedReads: 0,
      pointReads: report.audit.methodCalls.get,
      textSearches: report.audit.methodCalls.searchText,
    });
    expect(report.parameters).toEqual({
      measuredQueryCount: 8,
      searchableDocumentCount: 1_000,
      selectedLimit: 12,
      storedProjectionDocumentCount: 1_500,
      thresholdMs: 500,
      warmupQueryCount: 2,
    });
  });

  it("writes a newline-terminated source-bound JSON artifact to an explicit CLI path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "phase74-storage-artifact-"));
    const outputPath = join(directory, "nested", "scale-gate.json");

    try {
      const report = await runPhase74StorageScaleGate({
        measuredQueryCount: 4,
        outputPath,
        sourceBinding: SOURCE_BINDING,
        syntheticDocumentCount: 1_000,
        warmupQueryCount: 1,
      });
      const raw = await readFile(outputPath, "utf8");

      expect(raw.endsWith("\n")).toBe(true);
      expect(JSON.parse(raw)).toEqual(report);
      expect(report.latencyMs.p95).toBeNumber();
      expect(report.passed).toBe(true);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("parses the reproducible scale parameters and an explicit artifact output", () => {
    expect(parsePhase74StorageScaleGateCliOptions(
      [
        "bun",
        "scripts/run-phase-74-storage-scale-gate.ts",
        "--output",
        "reports/scale.json",
        "--synthetic-document-count",
        "100000",
        "--measured-query-count",
        "40",
        "--warmup-query-count",
        "5",
        "--threshold-ms",
        "500",
      ],
      "/repo",
    )).toEqual({
      database: "sqlite",
      measuredQueryCount: 40,
      outputPath: "/repo/reports/scale.json",
      syntheticDocumentCount: 100_000,
      thresholdMs: 500,
      warmupQueryCount: 5,
    });
  });

  it("builds a Postgres gate only from real scale, EXPLAIN, and index provenance", () => {
    const report = buildPhase74PostgresStorageScaleGateReport({
      audit: {
        collectionCounts: {
          claims: 50_000,
          entities: 50_000,
          statuses: 50_000,
        },
        explain: {
          actualRows: 12,
          indexNames: ["gm_documents_search_text_search_idx"],
          plan: [{ Plan: { "Actual Rows": 12, "Index Name": "gm_documents_search_text_search_idx" } }],
          planSha256: "f".repeat(64),
          querySha256: "1".repeat(64),
        },
        indexProvenance: {
          definition: "CREATE INDEX gm_documents_search_text_search_idx ...",
          definitionSha256: "2".repeat(64),
          name: "gm_documents_search_text_search_idx",
          schemaVersions: [{ component: "document_indexes", version: 2 }],
        },
        languagePackCountByCollection: {
          claims: 7,
          entities: 7,
          statuses: 7,
        },
        materializationCounters: {
          fullCollectionReads: 0,
          maxDocumentsPerChannelPerQuery: 12,
          pagedReads: 0,
          pointReads: 0,
          textSearches: 56,
        },
      },
      latencyMs: {
        max: 8,
        mean: 4,
        min: 2,
        p50: 4,
        p95: 7,
        p99: 8,
      },
      measuredQueryCount: 24,
      sourceBinding: SOURCE_BINDING,
      thresholdMs: 500,
      warmupQueryCount: 4,
    });

    expect(report.passed).toBe(true);
    expect(report.database).toBe("postgres");
    expect(report.parameters).toMatchObject({
      searchableDocumentCount: 100_000,
      storedProjectionDocumentCount: 150_000,
    });
    expect(report.audit.explain.indexNames).toContain(
      "gm_documents_search_text_search_idx",
    );
    expect(report.audit.indexProvenance.definitionSha256).toHaveLength(64);
  });

  it("requires an explicit test Postgres URL instead of fabricating a result", () => {
    expect(() => resolvePhase74PostgresStorageScaleGateUrl({})).toThrow(
      "GOODMEMORY_TEST_POSTGRES_URL",
    );
    expect(resolvePhase74PostgresStorageScaleGateUrl({
      GOODMEMORY_TEST_POSTGRES_URL: "postgres://localhost/goodmemory_test",
    })).toBe("postgres://localhost/goodmemory_test");
  });

  it("fails closed when the measured source is not commit-clean", async () => {
    const report = await runPhase74StorageScaleGate({
      measuredQueryCount: 2,
      sourceBinding: {
        ...SOURCE_BINDING,
        worktreeClean: false,
      },
      syntheticDocumentCount: 100,
      warmupQueryCount: 1,
    });

    expect(report.passed).toBe(false);
    expect(report.sourceBinding.worktreeClean).toBe(false);
  });
});
