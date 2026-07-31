import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";

import {
  runPhase72LongMemEvalTemporalOperandsDevelopment,
} from "../../scripts/run-phase-72-longmemeval-temporal-operands-development";
import type {
  Phase72LongMemEvalTemporalOperandsPreseal,
} from "../../scripts/run-phase-72-longmemeval-temporal-operands-development";
import type {
  LongMemEvalMemoryContext,
  LongMemEvalMemoryContextBuilder,
} from "../../src/eval/longmemeval";
import { estimateTextTokens } from "../../src/tokenEstimator";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixture() {
  const dataset = [
    {
      answer: "Alpha happened first.",
      answer_session_ids: ["raw-alpha", "raw-beta"],
      haystack_dates: ["2026-01-01", "2026-01-02"],
      haystack_session_ids: ["raw-alpha", "raw-beta"],
      haystack_sessions: [
        [{ content: "The alpha launch happened.", role: "user" }],
        [{ content: "The beta launch happened.", role: "user" }],
      ],
      question: "Which event happened first, the alpha launch or the beta launch?",
      question_date: "2026-01-03",
      question_id: "temporal-1",
      question_type: "temporal-reasoning",
    },
    {
      answer: "PostgreSQL",
      answer_session_ids: ["raw-db"],
      haystack_dates: ["2026-01-01"],
      haystack_session_ids: ["raw-db"],
      haystack_sessions: [
        [{ content: "The production database is PostgreSQL.", role: "user" }],
      ],
      question: "Which database is in production?",
      question_date: "2026-01-03",
      question_id: "ordinary-1",
      question_type: "knowledge-update",
    },
  ];
  const datasetRaw = JSON.stringify(dataset, null, 2);
  const benchmarkFingerprint = sha256(JSON.stringify(dataset));
  const selection = {
    benchmarkFingerprint,
    protocol: "longmemeval_current_recall_assembly_paired_v2",
    questionIds: ["temporal-1", "ordinary-1"],
    salt: "fixture-development",
    schemaVersion: 1,
    selectionMethod: "fixture order",
    split: "development",
    strata: { "temporal-reasoning": 1, "knowledge-update": 1 },
  };
  const selectionRaw = JSON.stringify(selection, null, 2);
  const controls = {
    "temporal-1": {
      content: "control temporal",
      readerVisibleSessionIds: ["session-1"],
      retrievedSessionIds: ["session-1"],
      snapshot: "a".repeat(64),
    },
    "ordinary-1": {
      content: "control ordinary",
      readerVisibleSessionIds: ["session-1"],
      retrievedSessionIds: ["session-1"],
      snapshot: "b".repeat(64),
    },
  } as const;
  const controlReport = {
    cases: selection.questionIds.map((questionId) => {
      const control = controls[questionId as keyof typeof controls];
      return {
        baseline: {
          contextSha256: sha256(control.content),
          contextTokens: estimateTextTokens(control.content),
        },
        questionId,
        recallSnapshotSha256: control.snapshot,
        retrievedSessionIds: control.retrievedSessionIds,
      };
    }),
    protocol: selection.protocol,
    runId:
      "run-phase72-current-recall-assembly-development-v2-bun1314-clean",
    selection: {
      fileSha256: sha256(selectionRaw),
      questionCount: selection.questionIds.length,
      split: "development",
    },
    source: {
      benchmarkFingerprint,
      datasetRawSha256: sha256(datasetRaw),
      sourceState: {
        commit: "466517c7a022c6c142ed67c9ab02322272cf5553",
        dirty: false,
      },
    },
  };
  const controlReportRaw = JSON.stringify(controlReport, null, 2);
  const preseal: Phase72LongMemEvalTemporalOperandsPreseal = {
    benchmarkFingerprint,
    controlReportSha256: sha256(controlReportRaw),
    datasetRawSha256: sha256(datasetRaw),
    selectionSha256: sha256(selectionRaw),
  };
  return {
    controlReportRaw,
    controls,
    datasetRaw,
    preseal,
    selectionRaw,
  };
}

function context(input: {
  content: string;
  queryCalls: number;
  readerVisibleSessionIds: readonly string[];
  retrievedSessionIds: readonly string[];
  snapshot: string;
  subQueries?: readonly string[];
}): LongMemEvalMemoryContext {
  return {
    content: input.content,
    recallDiagnostics: {
      ambiguousReaderVisibleSessionIds: [],
      queryCalls: input.queryCalls,
      readerVisibleSessionIds: [...input.readerVisibleSessionIds],
      recallRecordCount: input.retrievedSessionIds.length,
      subQueries: [...(input.subQueries ?? [])],
    },
    recallSnapshotSha256: input.snapshot,
    retrievedSessionIds: [...input.retrievedSessionIds],
  };
}

const sourceState = {
  commit: "0123456789abcdef0123456789abcdef01234567",
  dirty: false,
  worktreeFingerprint: "c".repeat(64),
};

describe("Phase 72 LongMemEval temporal operand retrieval development", () => {
  it("reproduces every control before measuring bounded treatment coverage", async () => {
    const input = fixture();
    const calls: string[] = [];
    const writes = new Map<string, string>();
    const control: LongMemEvalMemoryContextBuilder = async ({ testCase }) => {
      calls.push(`control:${testCase.questionId}`);
      expect(testCase.answer).toBe("");
      expect(testCase.answerSessionIds).toEqual([]);
      expect(testCase.haystackSessionIds).toEqual(
        testCase.haystackSessions.map((_, index) => `session-${index + 1}`),
      );
      const original = testCase.question.includes("alpha")
        ? input.controls["temporal-1"]
        : input.controls["ordinary-1"];
      return context({
        ...original,
        queryCalls: 1,
        snapshot: testCase.question.includes("alpha")
          ? "f".repeat(64)
          : "c".repeat(64),
      });
    };
    const treatmentSinglePass: LongMemEvalMemoryContextBuilder = async (
      { testCase },
    ) => {
      calls.push(`treatment-single:${testCase.questionId}`);
      return context({
        content: "control ordinary",
        queryCalls: 1,
        readerVisibleSessionIds: ["session-1"],
        retrievedSessionIds: ["session-1"],
        snapshot: "c".repeat(64),
      });
    };
    const treatmentDecomposed: LongMemEvalMemoryContextBuilder = async (
      { testCase },
    ) => {
      calls.push(`treatment-decomposed:${testCase.questionId}`);
      return context({
        content: "treatment temporal",
        queryCalls: 3,
        readerVisibleSessionIds: ["session-1", "session-2"],
        retrievedSessionIds: ["session-1", "session-2"],
        snapshot: "e".repeat(64),
        subQueries: ["the alpha launch", "the beta launch"],
      });
    };

    const report = await runPhase72LongMemEvalTemporalOperandsDevelopment({
      benchmarkRoot: "/bench",
      controlReportFile: "/control/report.json",
      outputDir: "/reports",
      runId: "operand-stage-a",
      selectionFile: "/selection.json",
    }, {
      bunVersion: "1.3.14",
      contextBuilders: {
        control,
        treatmentDecomposed,
        treatmentSinglePass,
      },
      async mkdir() {},
      now: () => new Date("2026-07-31T12:00:00.000Z"),
      preseal: input.preseal,
      async readFile(path) {
        if (path === "/bench/longmemeval_s_cleaned.json") {
          return input.datasetRaw;
        }
        if (path === "/selection.json") return input.selectionRaw;
        if (path === "/control/report.json") return input.controlReportRaw;
        if (path === "/script.ts") return "fixture script";
        throw new Error(`unexpected read: ${path}`);
      },
      scriptPath: "/script.ts",
      sourceState,
      async writeFile(path, value, options) {
        expect(options).toEqual({ flag: "wx" });
        writes.set(path, value);
      },
    });

    expect(calls).toEqual([
      "control:paired-memory-7b8e062fd8e57e9b",
      "control:paired-memory-c240b24f134ae211",
      "treatment-decomposed:paired-memory-7b8e062fd8e57e9b",
      "treatment-single:paired-memory-c240b24f134ae211",
    ]);
    expect(report.summary).toMatchObject({
      addedGoldEndpointCount: 1,
      answerConversionAuthorized: false,
      controlCoveredGoldEndpointCount: 2,
      developmentRetrievalCriteriaPassed: true,
      developmentRetrievalGatePassed: false,
      legacyControlSnapshotMatchCount: 0,
      lostGoldEndpointCount: 0,
      treatmentCoveredGoldEndpointCount: 3,
    });
    expect(report.configuration).toMatchObject({
      controlOracle: "legacy_v2_surface_identity",
      legacyRecallSnapshot:
        "disclosure_only_after_analyzer_identity_migration",
    });
    expect(report.cases[0]?.treatment.queryCalls).toBe(3);
    expect(report.cases[0]?.addedGoldSessionIds).toEqual(["session-2"]);
    expect(report.cases[0]?.lostGoldSessionIds).toEqual([]);
    expect(report.cases.map((result) => ({
      legacyControlRecallSnapshotMatched:
        result.legacyControlRecallSnapshotMatched,
      legacyControlRecallSnapshotSha256:
        result.legacyControlRecallSnapshotSha256,
    }))).toEqual([
      {
        legacyControlRecallSnapshotMatched: false,
        legacyControlRecallSnapshotSha256: "a".repeat(64),
      },
      {
        legacyControlRecallSnapshotMatched: false,
        legacyControlRecallSnapshotSha256: "b".repeat(64),
      },
    ]);
    expect(report.source).toMatchObject({
      bunVersion: "1.3.14",
      canonicalDependencies: false,
      canonicalMemoryRunId:
        "run-phase72-current-recall-assembly-development-v2-bun1314-clean",
      englishAnalyzerVersion: "13",
      legacyControlEnglishAnalyzerVersion: "12",
      sourceState,
    });
    expect([...writes.keys()]).toEqual([
      "/reports/operand-stage-a/report.json",
    ]);
  });

  it("stops before treatment when the canonical control does not reproduce", async () => {
    const input = fixture();
    let treatmentCalls = 0;
    const control: LongMemEvalMemoryContextBuilder = async ({ testCase }) => {
      const original = testCase.question.includes("alpha")
        ? input.controls["temporal-1"]
        : input.controls["ordinary-1"];
      return context({
        ...original,
        content: `${original.content} changed`,
        queryCalls: 1,
      });
    };
    const treatment: LongMemEvalMemoryContextBuilder = async () => {
      treatmentCalls += 1;
      throw new Error("must not run");
    };

    await expect(runPhase72LongMemEvalTemporalOperandsDevelopment({
      benchmarkRoot: "/bench",
      controlReportFile: "/control/report.json",
      outputDir: "/reports",
      runId: "operand-stage-a",
      selectionFile: "/selection.json",
    }, {
      bunVersion: "1.3.14",
      contextBuilders: {
        control,
        treatmentDecomposed: treatment,
        treatmentSinglePass: treatment,
      },
      async mkdir() {},
      preseal: input.preseal,
      async readFile(path) {
        if (path === "/bench/longmemeval_s_cleaned.json") {
          return input.datasetRaw;
        }
        if (path === "/selection.json") return input.selectionRaw;
        if (path === "/control/report.json") return input.controlReportRaw;
        if (path === "/script.ts") return "fixture script";
        throw new Error(`unexpected read: ${path}`);
      },
      scriptPath: "/script.ts",
      sourceState,
      async writeFile() {
        throw new Error("must not write");
      },
    })).rejects.toThrow("canonical control mismatch");

    expect(treatmentCalls).toBe(0);
  });

  it("rejects ambiguous reader-visible session attribution", async () => {
    const input = fixture();
    const control: LongMemEvalMemoryContextBuilder = async ({ testCase }) => {
      const original = testCase.question.includes("alpha")
        ? input.controls["temporal-1"]
        : input.controls["ordinary-1"];
      return {
        ...context({ ...original, queryCalls: 1 }),
        recallDiagnostics: {
          ambiguousReaderVisibleSessionIds: ["session-1", "session-2"],
          queryCalls: 1,
          readerVisibleSessionIds: ["session-1", "session-2"],
          recallRecordCount: 2,
          subQueries: [],
        },
      };
    };

    await expect(runPhase72LongMemEvalTemporalOperandsDevelopment({
      benchmarkRoot: "/bench",
      controlReportFile: "/control/report.json",
      outputDir: "/reports",
      runId: "operand-stage-a",
      selectionFile: "/selection.json",
    }, {
      bunVersion: "1.3.14",
      contextBuilders: {
        control,
        treatmentDecomposed: control,
        treatmentSinglePass: control,
      },
      async mkdir() {},
      preseal: input.preseal,
      async readFile(path) {
        if (path === "/bench/longmemeval_s_cleaned.json") {
          return input.datasetRaw;
        }
        if (path === "/selection.json") return input.selectionRaw;
        if (path === "/control/report.json") return input.controlReportRaw;
        if (path === "/script.ts") return "fixture script";
        throw new Error(`unexpected read: ${path}`);
      },
      scriptPath: "/script.ts",
      sourceState,
    })).rejects.toThrow("ambiguous reader-visible session attribution");
  });

  it("fails closed when runtime trace exceeds the operand query bound", async () => {
    const input = fixture();
    const control: LongMemEvalMemoryContextBuilder = async ({ testCase }) => {
      const original = testCase.question.includes("alpha")
        ? input.controls["temporal-1"]
        : input.controls["ordinary-1"];
      return context({ ...original, queryCalls: 1 });
    };
    const treatmentDecomposed: LongMemEvalMemoryContextBuilder = async () =>
      context({
        content: "treatment temporal",
        queryCalls: 4,
        readerVisibleSessionIds: ["session-1", "session-2"],
        retrievedSessionIds: ["session-1", "session-2"],
        snapshot: "e".repeat(64),
        subQueries: ["the alpha launch", "the beta launch"],
      });

    await expect(runPhase72LongMemEvalTemporalOperandsDevelopment({
      benchmarkRoot: "/bench",
      controlReportFile: "/control/report.json",
      outputDir: "/reports",
      runId: "operand-stage-a",
      selectionFile: "/selection.json",
    }, {
      bunVersion: "1.3.14",
      contextBuilders: {
        control,
        treatmentDecomposed,
        treatmentSinglePass: control,
      },
      async mkdir() {},
      preseal: input.preseal,
      async readFile(path) {
        if (path === "/bench/longmemeval_s_cleaned.json") {
          return input.datasetRaw;
        }
        if (path === "/selection.json") return input.selectionRaw;
        if (path === "/control/report.json") return input.controlReportRaw;
        if (path === "/script.ts") return "fixture script";
        throw new Error(`unexpected read: ${path}`);
      },
      scriptPath: "/script.ts",
      sourceState,
    })).rejects.toThrow("Runtime recall trace does not match temporal operands");
  });

  it("rejects drift in non-temporal negative controls", async () => {
    const input = fixture();
    const control: LongMemEvalMemoryContextBuilder = async ({ testCase }) => {
      const original = testCase.question.includes("alpha")
        ? input.controls["temporal-1"]
        : input.controls["ordinary-1"];
      return context({ ...original, queryCalls: 1 });
    };
    const treatmentDecomposed: LongMemEvalMemoryContextBuilder = async () =>
      context({
        content: "treatment temporal",
        queryCalls: 3,
        readerVisibleSessionIds: ["session-1", "session-2"],
        retrievedSessionIds: ["session-1", "session-2"],
        snapshot: "e".repeat(64),
        subQueries: ["the alpha launch", "the beta launch"],
      });
    const treatmentSinglePass: LongMemEvalMemoryContextBuilder = async () =>
      context({
        content: "drifted ordinary treatment",
        queryCalls: 1,
        readerVisibleSessionIds: ["session-1"],
        retrievedSessionIds: ["session-1"],
        snapshot: "d".repeat(64),
      });

    await expect(runPhase72LongMemEvalTemporalOperandsDevelopment({
      benchmarkRoot: "/bench",
      controlReportFile: "/control/report.json",
      outputDir: "/reports",
      runId: "operand-stage-a",
      selectionFile: "/selection.json",
    }, {
      bunVersion: "1.3.14",
      contextBuilders: {
        control,
        treatmentDecomposed,
        treatmentSinglePass,
      },
      async mkdir() {},
      preseal: input.preseal,
      async readFile(path) {
        if (path === "/bench/longmemeval_s_cleaned.json") {
          return input.datasetRaw;
        }
        if (path === "/selection.json") return input.selectionRaw;
        if (path === "/control/report.json") return input.controlReportRaw;
        if (path === "/script.ts") return "fixture script";
        throw new Error(`unexpected read: ${path}`);
      },
      scriptPath: "/script.ts",
      sourceState,
    })).rejects.toThrow("Non-temporal treatment drift");
  });
});
