import { describe, expect, it } from "bun:test";
import {
  PHASE69_MAX_ADDED_NOISE_PER_QUESTION,
  PHASE69_PROTECTION_MAX_REGRESSION,
  type Phase69LocomoGateReport,
  type Phase69LongMemEvalGateReport,
} from "../../scripts/run-phase-69-gate";
import {
  evaluatePhase75Gate,
  parsePhase75GateCliOptions,
  readPhase75LocomoReport,
  readPhase75LongMemEvalReport,
  type Phase75GateInput,
} from "../../scripts/run-phase-75-long-record-admission-gate";

// The Phase 75 gate decides whether opt-in long-record admission may become
// the fresh installed-host default: paired provider-free runs must stay within
// the Phase 69 protection thresholds on every LongMemEval type and LoCoMo
// category, and only the candidate may carry the knob.

function longMemEval(
  overrides: Partial<Phase69LongMemEvalGateReport> & {
    byQuestionType?: Phase69LongMemEvalGateReport["byQuestionType"];
  } = {},
): Phase69LongMemEvalGateReport {
  return {
    benchmarkFingerprint: "lme-fp",
    benchmarkRoot: "/tmp/LongMemEval",
    byQuestionType: {
      "multi-session": { evidenceCaseCount: 10, evidenceSessionRecall: 0.8, wrongSessionTotal: 4 },
      "single-session-user": { evidenceCaseCount: 10, evidenceSessionRecall: 0.9, wrongSessionTotal: 2 },
    },
    executionFailures: 0,
    ingestMode: "historical-annotated",
    profile: "goodmemory-rules-only",
    questionIds: ["q1", "q2"],
    runConfiguration: {
      contextMaxTokens: 1200,
      extractionStrategy: "rules-only",
      generalizedFusion: null,
      projection: { bulkBackfill: true, writeThrough: false },
      providerEmbedding: false,
      recallStrategy: "rules-only",
    },
    ...overrides,
  };
}

function locomo(overrides: Partial<Phase69LocomoGateReport> = {}): Phase69LocomoGateReport {
  return {
    benchmark: "locomo",
    benchmarkFingerprint: "locomo-fp",
    benchmarkSource: "synthetic",
    caseIds: ["c1"],
    categories: [
      { averageEvidenceRecall: 0.7, category: "single-hop", noiseTurnTotal: 20, questionCount: 10 },
      { averageEvidenceRecall: 0.5, category: "temporal", noiseTurnTotal: 30, questionCount: 10 },
    ],
    executionFailures: 0,
    generalizedFusionConfig: null,
    labelFreeIngest: false,
    questionIds: ["c1-q1", "c1-q2"],
    retrievalConfig: { bm25Ranking: false },
    ...overrides,
  };
}

function pair(candidateOverrides: {
  locomo?: Partial<Phase69LocomoGateReport>;
  longMemEval?: Partial<Phase69LongMemEvalGateReport>;
} = {}): Phase75GateInput {
  return {
    locomoBaseline: locomo(),
    locomoCandidate: locomo({
      longRecordAdmission: true,
      ...candidateOverrides.locomo,
    }),
    longMemEvalBaseline: longMemEval(),
    longMemEvalCandidate: longMemEval({
      runConfiguration: { ...longMemEval().runConfiguration, longRecordAdmission: true },
      ...candidateOverrides.longMemEval,
    }),
  };
}

describe("phase 75 long-record admission gate", () => {
  it("passes an identical or improved paired run and records every slice", () => {
    const result = evaluatePhase75Gate(pair({
      locomo: {
        categories: [
          { averageEvidenceRecall: 0.72, category: "single-hop", noiseTurnTotal: 25, questionCount: 10 },
          { averageEvidenceRecall: 0.5, category: "temporal", noiseTurnTotal: 30, questionCount: 10 },
        ],
      },
      longMemEval: {
        byQuestionType: {
          "multi-session": { evidenceCaseCount: 10, evidenceSessionRecall: 0.85, wrongSessionTotal: 4 },
          "single-session-user": { evidenceCaseCount: 10, evidenceSessionRecall: 0.9, wrongSessionTotal: 1 },
        },
        runConfiguration: { ...longMemEval().runConfiguration, longRecordAdmission: true },
      },
    }));

    expect(result.status).toBe("passed");
    expect(result.failures).toEqual([]);
    expect(result.thresholds).toEqual({
      maxAddedNoisePerQuestion: PHASE69_MAX_ADDED_NOISE_PER_QUESTION,
      protectionMaxRegression: PHASE69_PROTECTION_MAX_REGRESSION,
    });
    expect(result.slices.map((slice) => `${slice.benchmark}:${slice.name}:${slice.metric}:${slice.delta}`)).toEqual([
      "LongMemEval:multi-session:evidenceSessionRecall:0.05",
      "LongMemEval:multi-session:wrongSessionTotal:0",
      "LongMemEval:single-session-user:evidenceSessionRecall:0",
      "LongMemEval:single-session-user:wrongSessionTotal:-1",
      "LoCoMo:single-hop:averageEvidenceRecall:0.02",
      "LoCoMo:single-hop:noisePerQuestion:0.5",
      "LoCoMo:temporal:averageEvidenceRecall:0",
      "LoCoMo:temporal:noisePerQuestion:0",
    ]);
  });

  it("fails on a recall regression past the floor, added wrong sessions, or excess noise", () => {
    const result = evaluatePhase75Gate(pair({
      locomo: {
        categories: [
          { averageEvidenceRecall: 0.7, category: "single-hop", noiseTurnTotal: 110, questionCount: 10 },
          { averageEvidenceRecall: 0.48, category: "temporal", noiseTurnTotal: 30, questionCount: 10 },
        ],
      },
      longMemEval: {
        byQuestionType: {
          "multi-session": { evidenceCaseCount: 10, evidenceSessionRecall: 0.78, wrongSessionTotal: 4 },
          "single-session-user": { evidenceCaseCount: 10, evidenceSessionRecall: 0.9, wrongSessionTotal: 3 },
        },
        runConfiguration: { ...longMemEval().runConfiguration, longRecordAdmission: true },
      },
    }));

    expect(result.status).toBe("failed");
    expect(result.failures).toEqual([
      "LongMemEval multi-session evidence-session recall regressed by 0.02",
      "LongMemEval single-session-user wrong-session total grew by 1",
      "LoCoMo single-hop added 9 noise turns per question",
      "LoCoMo temporal evidence recall regressed by 0.02",
    ]);
  });

  it("refuses mismatched pairs and runs that do not carry the knob as declared", () => {
    const mismatched = evaluatePhase75Gate({
      ...pair(),
      locomoCandidate: locomo({ benchmarkFingerprint: "other", questionIds: ["c1-q1"] }),
      longMemEvalCandidate: longMemEval({ executionFailures: 1, profile: "goodmemory-recommended" }),
    });

    expect(mismatched.status).toBe("failed");
    expect(mismatched.failures).toEqual([
      "LongMemEval baseline and candidate must use the same profile",
      "LongMemEval candidate must record longRecordAdmission=true",
      "LongMemEval reports must have no execution failures",
      "LoCoMo baseline and candidate must share a benchmark fingerprint",
      "LoCoMo baseline and candidate must cover the same question ids",
      "LoCoMo candidate must record longRecordAdmission=true",
    ]);

    const swapped = evaluatePhase75Gate({
      ...pair(),
      longMemEvalBaseline: longMemEval({
        runConfiguration: { ...longMemEval().runConfiguration, longRecordAdmission: true },
      }),
    });
    expect(swapped.failures).toContain("LongMemEval baseline must not carry longRecordAdmission");
  });

  it("parses the four report paths and the optional output", () => {
    expect(
      parsePhase75GateCliOptions([
        "bun",
        "run",
        "scripts/run-phase-75-long-record-admission-gate.ts",
        "--longmemeval-baseline",
        "a.json",
        "--longmemeval-candidate",
        "b.json",
        "--locomo-baseline",
        "c.json",
        "--locomo-candidate",
        "d.json",
        "--output",
        "gate.json",
      ]),
    ).toEqual({
      locomoBaseline: "c.json",
      locomoCandidate: "d.json",
      longMemEvalBaseline: "a.json",
      longMemEvalCandidate: "b.json",
      output: "gate.json",
    });
    expect(() =>
      parsePhase75GateCliOptions(["bun", "run", "gate.ts", "--longmemeval-baseline", "a.json"]),
    ).toThrow("--locomo-baseline is required");
  });
  it("reads runner reports tolerantly, recomputing rows from cases", () => {
    const longMemEval = readPhase75LongMemEvalReport({
      benchmarkFingerprint: "fp",
      benchmarkRoot: "/data",
      cases: [
        { evidenceSessionRecall: 1, questionId: "q1", questionType: "multi-session", wrongRecallSessionIds: ["s9"] },
        { evidenceSessionRecall: 0.5, questionId: "q2", questionType: "multi-session", wrongRecallSessionIds: [] },
        { questionId: "q3", questionType: "single-session-user", wrongRecallSessionIds: [] },
      ],
      ingestMode: "historical-annotated",
      profile: "goodmemory-rules-only",
      runConfiguration: { contextMaxTokens: 1, longRecordAdmission: true, retrievalCues: true },
      summary: { byQuestionType: {}, executionFailures: 0 },
    });
    expect(longMemEval.byQuestionType).toEqual({
      "multi-session": { evidenceCaseCount: 2, evidenceSessionRecall: 0.75, wrongSessionTotal: 1 },
      "single-session-user": { evidenceCaseCount: 0, evidenceSessionRecall: null, wrongSessionTotal: 0 },
    });
    expect(longMemEval.questionIds).toEqual(["q1", "q2", "q3"]);
    expect(longMemEval.runConfiguration.longRecordAdmission).toBe(true);

    const locomo = readPhase75LocomoReport({
      benchmark: "locomo",
      benchmarkFingerprint: "fp",
      benchmarkSource: "synthetic",
      cases: [{ questionId: "c1-q1" }],
      categories: [{ averageEvidenceRecall: 1, category: "single_hop", noiseTurnTotal: 2, questionCount: 1 }],
      executionFailures: 0,
      longRecordAdmission: true,
      retrievalConfig: { bm25Ranking: false, followUpMode: "off" },
    });
    expect(locomo.longRecordAdmission).toBe(true);
    expect(locomo.questionIds).toEqual(["c1-q1"]);
    expect(locomo.categories).toHaveLength(1);
    expect(() => readPhase75LocomoReport({ benchmark: "other" })).toThrow("benchmark=locomo");
  });
});
