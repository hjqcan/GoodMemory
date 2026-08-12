import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
  hasCanonicalOperandHeadPreservationDependencies,
  runPhase72LongMemEvalOperandHeadPreservationDevelopment,
} from "../../scripts/run-phase-72-longmemeval-operand-head-preservation-development";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("Phase 72 LongMemEval operand-head preservation development", () => {
  it("rejects the current English analyzer before file I/O canonically", async () => {
    await expect(runPhase72LongMemEvalOperandHeadPreservationDevelopment({
      benchmarkRoot: "/bench",
      outputDir: "/out",
      runId: "analyzer-version-fixture",
      selectionFile: "/selection.json",
    })).rejects.toThrow("English analyzer 13 is required; found 14");
  });

  it("rejects every dependency injection from canonical evidence", () => {
    expect(hasCanonicalOperandHeadPreservationDependencies({})).toBe(true);
    expect(hasCanonicalOperandHeadPreservationDependencies({
      mkdir: async () => undefined,
    })).toBe(false);
    expect(hasCanonicalOperandHeadPreservationDependencies({
      now: () => new Date("2026-07-31T00:00:00.000Z"),
    })).toBe(false);
    expect(hasCanonicalOperandHeadPreservationDependencies({
      async writeFile() {},
    })).toBe(false);
  });

  it("compares one frozen recall across fixed-budget control and treatment arms", async () => {
    const datasetRaw = JSON.stringify([{
      answer: "two days",
      answer_session_ids: ["raw-a", "raw-b"],
      haystack_dates: ["2026-01-01", "2026-01-03"],
      haystack_session_ids: ["raw-a", "raw-b"],
      haystack_sessions: [
        [{ content: "The launch happened.", has_answer: true, role: "user" }],
        [{ content: "The review happened.", has_answer: true, role: "user" }],
      ],
      question: "Which happened first, the launch or the review?",
      question_date: "2026-01-04",
      question_id: "case-1",
      question_type: "temporal-reasoning",
    }]);
    const parsedDataset = JSON.parse(datasetRaw) as unknown;
    const selectionRaw = JSON.stringify({
      analyzerVersion: "13",
      benchmarkFingerprint: sha256(JSON.stringify(parsedDataset)),
      datasetRawSha256: sha256(datasetRaw),
      eligibleCounts: { temporal_operands_2: 1 },
      exclusions: {
        candidateHoldoutSelectionSha256: "a".repeat(64),
        excludedQuestionCount: 0,
        excludedQuestionIdsSha256: "b".repeat(64),
        partialRecallSelectionSha256: "c".repeat(64),
        priorDevelopmentSelectionSha256: "d".repeat(64),
        semanticRecallSelectionSha256: "e".repeat(64),
        sessionDenseSelectionSha256: "f".repeat(64),
      },
      frozenBeforeTreatmentImplementation: true,
      languagePackId: "en",
      protocol: "phase72_longmemeval_operand_head_preservation_development_v1",
      questionIds: ["case-1"],
      salt: "fixture",
      schemaVersion: 1,
      selectionMethod: "question-only fixture",
      split: "development",
      strata: { temporal_operands_2: 1 },
    });
    const writes = new Map<string, string>();
    let controlCalls = 0;
    let controlPreRankLimit = 31;
    let treatmentCalls = 0;

    const run = () => runPhase72LongMemEvalOperandHeadPreservationDevelopment({
      benchmarkRoot: "/bench",
      outputDir: "/out",
      runId: "fixture-run",
      selectionFile: "/selection.json",
    }, {
      bunVersion: "1.3.14",
      contextBuilders: {
        async control({ testCase }) {
          controlCalls += 1;
          expect(testCase.answer).toBe("");
          expect(testCase.answerSessionIds).toEqual([]);
          expect(testCase.haystackSessionIds).toEqual(["session-1", "session-2"]);
          expect(testCase.haystackSessions.flat().some(({ hasAnswer }) => hasAnswer))
            .toBe(false);
          expect(testCase.questionType).toBe("");
          return {
            content: "control context",
            recallDiagnostics: {
              ambiguousReaderVisibleSessionIds: [],
              preRankLimit: controlPreRankLimit,
              queryCalls: 3,
              readerVisibleSessionIds: ["session-1"],
              recallRecordCount: 12,
              selectedLimit: 12,
              subQueries: ["the launch", "the review"],
            },
            recallSnapshotSha256: "1".repeat(64),
            retrievedSessionIds: ["session-1"],
          };
        },
        async treatment({ testCase }) {
          treatmentCalls += 1;
          expect(testCase.answer).toBe("");
          return {
            content: "treatment context",
            recallDiagnostics: {
              ambiguousReaderVisibleSessionIds: [],
              preRankLimit: 32,
              queryCalls: 3,
              readerVisibleSessionIds: ["session-1", "session-2"],
              recallRecordCount: 12,
              selectedLimit: 12,
              subQueries: ["the launch", "the review"],
            },
            recallSnapshotSha256: "2".repeat(64),
            retrievedSessionIds: ["session-1", "session-2"],
          };
        },
      },
      mkdir: async () => undefined,
      now: () => new Date("2026-07-31T00:00:00.000Z"),
      preseal: {
        benchmarkFingerprint: sha256(JSON.stringify(parsedDataset)),
        datasetRawSha256: sha256(datasetRaw),
        selectionSha256: sha256(selectionRaw),
      },
      async readFile(path) {
        if (path === "/bench/longmemeval_s_cleaned.json") return datasetRaw;
        if (path === "/selection.json") return selectionRaw;
        if (path.endsWith("run-phase-72-longmemeval-operand-head-preservation-development.ts")) {
          return "fixture script";
        }
        throw new Error(`unexpected read: ${path}`);
      },
      scriptPath:
        "/scripts/run-phase-72-longmemeval-operand-head-preservation-development.ts",
      sourceState: {
        commit: "a".repeat(40),
        dirty: false,
        worktreeFingerprint: "b".repeat(64),
      },
      async writeFile(path, value) {
        writes.set(path, value);
      },
    });

    await expect(run()).rejects.toThrow("fixed 32/12 recall budget");
    controlPreRankLimit = 32;
    const report = await run();

    expect(controlCalls).toBe(2);
    expect(treatmentCalls).toBe(1);
    expect(report.cases[0]).toMatchObject({
      addedGoldSessionIds: ["session-2"],
      lostGoldSessionIds: [],
      questionId: "case-1",
    });
    expect(report.summary).toMatchObject({
      addedGoldEndpointCount: 1,
      canonicalRun: false,
      controlCoveredGoldEndpointCount: 1,
      developmentRetrievalCriteriaPassed: true,
      developmentRetrievalGatePassed: false,
      goldEndpointCount: 2,
      lostGoldEndpointCount: 0,
      queryCountMismatchCount: 0,
      treatmentCoveredGoldEndpointCount: 2,
    });
    expect(report.execution).toEqual({
      answerCalls: 0,
      holdoutCalls: 0,
      judgeCalls: 0,
      memoryContextBuilds: 2,
    });
    expect(report.source).toMatchObject({
      canonicalDependencies: false,
      englishAnalyzerVersion: "14-explicit-fact-list-boundary",
    });
    expect(writes.has("/out/fixture-run/report.json")).toBe(true);
  });
});
