import { describe, expect, it } from "bun:test";

import {
  buildPhase74ProductRunIdentityConfiguration,
  parsePhase74ProductComparisonCliOptions,
  runPhase74ProductComparison,
  type Phase74ProductPreparedGroup,
} from "../../scripts/run-phase-74-product-comparison";

const CASES = [
  {
    caseId: "case-a",
    clusterId: "cluster-a",
    memoryGroupId: "group-a",
    question: "Question A?",
  },
  {
    caseId: "case-b",
    clusterId: "cluster-b",
    memoryGroupId: "group-b",
    question: "Question B?",
  },
] as const;

describe("Phase 74 cumulative product runner", () => {
  it("parses a source-bound release-to-final live run with explicit budgets", () => {
    expect(parsePhase74ProductComparisonCliOptions([
      "bun",
      "run-phase-74-product-comparison.ts",
      "--benchmark",
      "locomo",
      "--benchmark-root",
      "/tmp/locomo",
      "--output-dir",
      "/tmp/output",
      "--run-id",
      "phase74-product-locomo-r1",
      "--replicate",
      "1",
      "--case-selection-seed",
      "74076",
      "--case-selection-size",
      "8",
      "--release-source-root",
      "/tmp/release",
      "--release-archive",
      "/tmp/release.tar",
      "--protection-blueprint",
      "/tmp/protection.json",
      "--selected-evidence-ledger-format",
      "compact_json",
      "--max-language-calls",
      "5000",
      "--embedding-spend-limit-usd",
      "1",
    ])).toEqual({
      benchmark: "locomo",
      benchmarkRoot: "/tmp/locomo",
      caseSelectionSeed: 74076,
      caseSelectionSize: 8,
      embeddingSpendLimitUsd: 1,
      maxLanguageCalls: 5000,
      outputDir: "/tmp/output",
      protectionBlueprintPath: "/tmp/protection.json",
      releaseArchive: "/tmp/release.tar",
      releaseSourceRoot: "/tmp/release",
      replicate: 1,
      runId: "phase74-product-locomo-r1",
      selectedEvidenceLedgerFormat: "compact_json",
    });
  });

  it("binds the exact old and final products instead of a stage-local arm", () => {
    expect(buildPhase74ProductRunIdentityConfiguration({
      candidateConfiguration: {
        evidenceLedger: { format: "compact_json" },
        planner: { mode: "deterministic" },
        representation: "atomic-contextual-raw-pointer",
        retrieval: {
          generalizedFusionChannels: [
            "lexical",
            "dense",
            "entity",
            "temporal",
            "relation",
          ],
          recallPlanExecution: true,
        },
      },
      candidateSource: {
        commit: "a".repeat(40),
        sha256: "b".repeat(64),
      },
      releaseSource: {
        archiveSha256: "c".repeat(64),
        arm: "release",
        commit: "d".repeat(40),
        lockfileSha256: "e".repeat(64),
        ref: "v0.6.0",
        tree: "f".repeat(40),
        workerSha256: "1".repeat(64),
      },
      replicate: 1,
      selectedEvidenceLedgerFormat: "compact_json",
      seenCasesOnly: true,
    })).toMatchObject({
      arms: {
        baseline: "release-v0.6.0",
        candidate: "phase74-final",
      },
      candidateConfiguration: {
        evidenceLedger: { format: "compact_json" },
        planner: { mode: "deterministic" },
        representation: "atomic-contextual-raw-pointer",
      },
      evidenceBoundary: { seenCasesOnly: true },
      replicate: 1,
      selectedEvidenceLedgerFormat: "compact_json",
    });
  });

  it("finishes every arm memory-group ingestion before the first query", async () => {
    const events: string[] = [];
    let preparedCount = 0;
    const result = await runPhase74ProductComparison({
      cases: CASES,
      async prepare({ arm, memoryGroupId }) {
        events.push(`prepare:${arm}:${memoryGroupId}`);
        preparedCount += 1;
        return {
          arm,
          ingestionKey: `${arm}/${memoryGroupId}`,
          memoryGroupId,
          async query(testCase) {
            expect(preparedCount).toBe(4);
            events.push(`query:${arm}:${testCase.caseId}`);
            return {
              context: `${arm} context for ${testCase.caseId}`,
              contextTokens: 12,
              queryPathLatencyMs: 20,
              recallLatencyMs: 7,
            };
          },
        } satisfies Phase74ProductPreparedGroup;
      },
      async read({ arm, caseId }) {
        events.push(`read:${arm}:${caseId}`);
        return { answer: `${arm} answer`, latencyMs: 5 };
      },
      async score({ arm, caseId }) {
        events.push(`score:${arm}:${caseId}`);
        return { correct: true, latencyMs: 11, score: 1 };
      },
      selectedEvidenceLedgerFormat: "compact_json",
    });

    expect(events.findIndex((event) => event.startsWith("query:"))).toBe(4);
    expect(result.rows).toHaveLength(4);
  });

  it("records one reader and scorer result per arm and case with judge latency separate", async () => {
    let readerCalls = 0;
    let scorerCalls = 0;
    const result = await runPhase74ProductComparison({
      cases: CASES,
      async prepare({ arm, memoryGroupId }) {
        return {
          arm,
          ingestionKey: `${arm}/${memoryGroupId}`,
          memoryGroupId,
          async query() {
            return {
              context: "evidence",
              contextTokens: 24,
              queryPathLatencyMs: 30,
              recallLatencyMs: 9,
            };
          },
        };
      },
      async read({ arm }) {
        readerCalls += 1;
        return { answer: `${arm} answer`, latencyMs: 6 };
      },
      async score() {
        scorerCalls += 1;
        return { correct: false, latencyMs: 13, score: 0.25 };
      },
      selectedEvidenceLedgerFormat: "compact_json",
    });

    expect(readerCalls).toBe(4);
    expect(scorerCalls).toBe(4);
    expect(result.rows.every((row) =>
      row.productLatencyMs === 36 &&
      row.judgeLatencyMs === 13 &&
      row.recallLatencyMs === 9
    )).toBeTrue();
    expect(result.rows.map(({ arm, caseId }) => `${arm}/${caseId}`).sort())
      .toEqual([
        "phase74-final/case-a",
        "phase74-final/case-b",
        "release-v0.6.0/case-a",
        "release-v0.6.0/case-b",
      ]);
    expect(result.selectedEvidenceLedgerFormat).toBe("compact_json");
  });
});
