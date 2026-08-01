import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";

import {
  assertPhase72LongMemEvalCandidateHoldoutSourceState,
  runPhase72LongMemEvalTemporalAssemblyPaired,
  type Phase72LongMemEvalTemporalAssemblySelection,
} from "../../scripts/run-phase-72-longmemeval-temporal-assembly-paired";
import type { LongMemEvalReport } from "../../src/eval/longmemeval";

const datasetPath = "/bench/longmemeval_s_cleaned.json";
const selectionPath = "/selections/development.json";
const outputDir = "/reports/output";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixtureInputs(split: "candidate_holdout" | "development" = "development") {
  const dataset = [{
    answer: "right",
    answer_session_ids: ["answer_secret"],
    haystack_dates: ["2026-01-01"],
    haystack_session_ids: ["answer_secret"],
    haystack_sessions: [[
      { content: "Current value is right.", has_answer: true, role: "user" },
    ]],
    question: "What is the current value?",
    question_date: "2026-01-03",
    question_id: "question-1",
    question_type: "knowledge-update",
  }];
  const datasetRaw = JSON.stringify(dataset, null, 2);
  const selection: Phase72LongMemEvalTemporalAssemblySelection = {
    benchmarkFingerprint: sha256(JSON.stringify(dataset)),
    protocol: "longmemeval_current_recall_assembly_paired_v2",
    questionIds: ["question-1"],
    salt: `fixture-${split}`,
    schemaVersion: 1,
    selectionMethod:
      "ascending sha256(salt + NUL + question_id) within each stratum",
    split,
    strata: { "knowledge-update": 1 },
  };
  return {
    datasetRaw,
    selectionRaw: JSON.stringify(selection, null, 2),
  };
}

const sourceState = {
  commit: "0123456789abcdef0123456789abcdef01234567",
  dirty: true,
  worktreeFingerprint: "a".repeat(64),
};

describe("Phase 72 LongMemEval temporal assembly paired replay", () => {
  it("answers both formats from one clean current-recall snapshot", async () => {
    const inputs = fixtureInputs();
    const writes = new Map<string, string>();
    let answerCalls = 0;
    let contextBuilds = 0;

    const report = await runPhase72LongMemEvalTemporalAssemblyPaired({
      benchmarkRoot: "/bench",
      contextMaxTokens: 4_000,
      maxConcurrency: 1,
      outputDir,
      readerContextTokenCap: 6_000,
      runId: "development-v1",
      selectionFile: selectionPath,
    }, {
      async answerGenerator(input) {
        answerCalls += 1;
        expect(input.testCase.answer).toBe("");
        expect(input.testCase.answerSessionIds).toEqual([]);
        expect(input.testCase.questionType).toBe("");
        expect(input.memoryContext).not.toContain("answer_secret");
        return input.memoryContext?.startsWith("{") ? "right" : "wrong";
      },
      async memoryContextBuilder({ testCase }) {
        contextBuilds += 1;
        expect(testCase.answer).toBe("");
        expect(testCase.answerSessionIds).toEqual([]);
        expect(testCase.questionType).toBe("");
        expect(testCase.haystackSessionIds).toEqual(["session-1"]);
        expect(testCase.haystackSessions[0]?.[0]).toEqual({
          content: "Current value is right.",
          role: "user",
        });
        return {
          content: "Default product context.",
          evidenceLedgerContexts: {
            compact_json: "{\"entries\":[\"Current value is right.\"]}",
          },
          recallSnapshotSha256: "b".repeat(64),
          retrievedSessionIds: ["session-1"],
        };
      },
      async mkdir() {},
      now: () => new Date("2026-07-31T00:00:00.000Z"),
      async readFile(path) {
        if (path === datasetPath) return inputs.datasetRaw;
        if (path === selectionPath) return inputs.selectionRaw;
        throw new Error(`unexpected read: ${path}`);
      },
      sourceState,
      async writeFile(path, value, options) {
        expect(options).toEqual({ flag: "wx" });
        writes.set(path, value);
      },
    });

    expect(contextBuilds).toBe(1);
    expect(answerCalls).toBe(2);
    expect(report.summary).toMatchObject({
      baselineCorrect: 0,
      losses: 0,
      netWins: 1,
      temporalCorrect: 1,
      ties: 0,
      wins: 1,
    });
    expect(report.execution).toEqual({
      answerCalls: 2,
      judgeCalls: 0,
      memoryContextBuilds: 1,
    });
    expect(report.cases[0]?.recallSnapshotSha256).toBe("b".repeat(64));
    expect(report.cases[0]?.retrievedSessionIds).toEqual(["session-1"]);
    expect(report.cases[0]?.baseline.correct).toBe(false);
    expect(report.cases[0]?.temporal.correct).toBe(true);
    expect([...writes.keys()]).toEqual([
      `${outputDir}/development-v1/report.json`,
    ]);
  });

  it("keeps the candidate holdout sealed before any context or answer call", async () => {
    const inputs = fixtureInputs("candidate_holdout");
    let answerCalls = 0;
    let contextBuilds = 0;

    await expect(runPhase72LongMemEvalTemporalAssemblyPaired({
      benchmarkRoot: "/bench",
      contextMaxTokens: 4_000,
      maxConcurrency: 1,
      outputDir,
      readerContextTokenCap: 6_000,
      runId: "holdout-v1",
      selectionFile: selectionPath,
    }, {
      async answerGenerator() {
        answerCalls += 1;
        return "unused";
      },
      async memoryContextBuilder() {
        contextBuilds += 1;
        throw new Error("unused");
      },
      async readFile(path) {
        if (path === datasetPath) return inputs.datasetRaw;
        if (path === selectionPath) return inputs.selectionRaw;
        throw new Error(`unexpected read: ${path}`);
      },
      sourceState: { ...sourceState, dirty: false },
    })).rejects.toThrow("candidate holdout remains sealed");

    expect(answerCalls).toBe(0);
    expect(contextBuilds).toBe(0);
  });

  it("requires a full clean source identity for the candidate holdout", () => {
    expect(() =>
      assertPhase72LongMemEvalCandidateHoldoutSourceState(sourceState)
    ).toThrow("candidate holdout requires a clean source");
    expect(() =>
      assertPhase72LongMemEvalCandidateHoldoutSourceState({
        ...sourceState,
        commit: "short",
        dirty: false,
      })
    ).toThrow("full Git SHA");
    expect(() =>
      assertPhase72LongMemEvalCandidateHoldoutSourceState({
        ...sourceState,
        dirty: false,
      })
    ).not.toThrow();
  });

  it("invalidates the contaminated candidate holdout before any model call", async () => {
    const inputs = fixtureInputs("candidate_holdout");
    let answerCalls = 0;
    await expect(runPhase72LongMemEvalTemporalAssemblyPaired({
      benchmarkRoot: "/bench",
      contextMaxTokens: 4_000,
      maxConcurrency: 1,
      openCandidateHoldout: true,
      outputDir,
      readerContextTokenCap: 6_000,
      runId: "holdout-injected",
      selectionFile: selectionPath,
    }, {
      async answerGenerator() {
        answerCalls += 1;
        return "unused";
      },
      async readFile(path) {
        if (path === datasetPath) return inputs.datasetRaw;
        if (path === selectionPath) return inputs.selectionRaw;
        throw new Error(`unexpected read: ${path}`);
      },
      sourceState: { ...sourceState, dirty: false },
    })).rejects.toThrow("candidate holdout was invalidated");
    expect(answerCalls).toBe(0);
  });

  it("reserves a unique run directory before building contexts or answers", async () => {
    const inputs = fixtureInputs();
    let answerCalls = 0;
    let contextBuilds = 0;

    await expect(runPhase72LongMemEvalTemporalAssemblyPaired({
      benchmarkRoot: "/bench",
      contextMaxTokens: 4_000,
      maxConcurrency: 1,
      outputDir,
      readerContextTokenCap: 6_000,
      runId: "already-reserved",
      selectionFile: selectionPath,
    }, {
      async answerGenerator() {
        answerCalls += 1;
        return "unused";
      },
      async memoryContextBuilder() {
        contextBuilds += 1;
        throw new Error("unused");
      },
      async mkdir(path) {
        if (path === `${outputDir}/already-reserved`) {
          throw new Error("run directory already exists");
        }
      },
      async readFile(path) {
        if (path === datasetPath) return inputs.datasetRaw;
        if (path === selectionPath) return inputs.selectionRaw;
        throw new Error(`unexpected read: ${path}`);
      },
      sourceState,
    })).rejects.toThrow("run directory already exists");

    expect(answerCalls).toBe(0);
    expect(contextBuilds).toBe(0);
  });

  it("reuses one answer when both rendered contexts are byte-identical", async () => {
    const inputs = fixtureInputs();
    let answerCalls = 0;

    const report = await runPhase72LongMemEvalTemporalAssemblyPaired({
      benchmarkRoot: "/bench",
      contextMaxTokens: 4_000,
      maxConcurrency: 1,
      outputDir,
      readerContextTokenCap: 6_000,
      runId: "development-identical-context",
      selectionFile: selectionPath,
    }, {
      async answerGenerator() {
        answerCalls += 1;
        return "right";
      },
      async memoryContextBuilder() {
        return {
          content: "Same context.",
          evidenceLedgerContexts: { compact_json: "Same context." },
          recallSnapshotSha256: "c".repeat(64),
          retrievedSessionIds: [],
        };
      },
      async mkdir() {},
      async readFile(path) {
        if (path === datasetPath) return inputs.datasetRaw;
        if (path === selectionPath) return inputs.selectionRaw;
        throw new Error(`unexpected read: ${path}`);
      },
      sourceState,
      async writeFile() {},
    });

    expect(answerCalls).toBe(1);
    expect(report.execution.answerCalls).toBe(1);
    expect(report.summary).toMatchObject({
      losses: 0,
      netWins: 0,
      ties: 1,
      wins: 0,
    });
    expect(report.cases[0]?.baseline).toEqual(report.cases[0]?.temporal);
  });
});
