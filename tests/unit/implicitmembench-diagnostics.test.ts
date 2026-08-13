import { describe, expect, it } from "bun:test";
import type {
  ImplicitMemBenchCaseResult,
  ImplicitMemBenchProfileSummary,
  ImplicitMemBenchResearchReport,
} from "../../src/eval/implicitmembench-research";
import { buildRawInternalizationDiagnosisSummary } from "../../src/eval/implicitmembench-diagnostics";

function createCase(
  overrides: Partial<ImplicitMemBenchCaseResult>,
): ImplicitMemBenchCaseResult {
  return {
    blocking: true,
    caseId: overrides.caseId ?? "case-1",
    datasetFamily: overrides.datasetFamily ?? "classical_conditioning",
    explicitRecallLeak: false,
    feedbackSignalApplied: true,
    profile: overrides.profile ?? "goodmemory-raw-experience",
    scorerFamily: overrides.scorerFamily ?? "text_behavior_judge",
    sourceFile: overrides.sourceFile ?? "/tmp/case.json",
    taskFile: overrides.taskFile ?? "case.json",
    taskName: overrides.taskName ?? "Case",
    ...overrides,
  };
}

function createSummary(cases: ImplicitMemBenchCaseResult[]): ImplicitMemBenchProfileSummary {
  return {
    caseCountsByDataset: {
      classical_conditioning: cases.filter(
        (caseResult) => caseResult.datasetFamily === "classical_conditioning",
      ).length,
      priming: cases.filter((caseResult) => caseResult.datasetFamily === "priming").length,
      procedural_memory: cases.filter(
        (caseResult) => caseResult.datasetFamily === "procedural_memory",
      ).length,
    },
    caseCountsByScorer: {
      priming_pair_judge: cases.filter(
        (caseResult) => caseResult.scorerFamily === "priming_pair_judge",
      ).length,
      structured_first_action: cases.filter(
        (caseResult) => caseResult.scorerFamily === "structured_first_action",
      ).length,
      text_behavior_judge: cases.filter(
        (caseResult) => caseResult.scorerFamily === "text_behavior_judge",
      ).length,
    },
    cases,
    executionFailures: cases.filter((caseResult) => caseResult.executionFailure).length,
    explicitRecallLeakCount: cases.filter((caseResult) => caseResult.explicitRecallLeak).length,
    passedBlockingCases: cases.filter((caseResult) => caseResult.blocking && caseResult.passed).length,
    primingAverageScore: null,
    totalBlockingCases: cases.filter((caseResult) => caseResult.blocking).length,
    totalCases: cases.length,
  };
}

function createReport(input: {
  distilledCases: ImplicitMemBenchCaseResult[];
  rawCases: ImplicitMemBenchCaseResult[];
}): ImplicitMemBenchResearchReport {
  const rawSummary = createSummary(input.rawCases);
  const distilledSummary = createSummary(input.distilledCases);
  return {
    benchmarkRoot: "/tmp/bench",
    generatedAt: "2026-05-04T00:00:00.000Z",
    generatedBy: "test",
    kind: "goodmemory",
    manifestPath: "/tmp/bench/adapter-manifest.json",
    mode: "smoke",
    outputDir: "/tmp/out",
    profiles: {
      "goodmemory-distilled-feedback": distilledSummary,
      "goodmemory-raw-experience": rawSummary,
    },
    runDirectory: "/tmp/out/run",
    runId: "run",
    source: {
      benchmark: "ImplicitMemBench",
      license: "CC BY 4.0",
      url: "https://github.com/qinchonghanzuibang/ImplicitMemBench",
    },
    summary: {
      caseCountsByDataset: rawSummary.caseCountsByDataset,
      caseCountsByScorer: rawSummary.caseCountsByScorer,
      executionFailures: rawSummary.executionFailures + distilledSummary.executionFailures,
      explicitRecallLeakCount:
        rawSummary.explicitRecallLeakCount + distilledSummary.explicitRecallLeakCount,
      passedBlockingCases:
        rawSummary.passedBlockingCases + distilledSummary.passedBlockingCases,
      primingAverageScore: null,
      totalBlockingCases:
        rawSummary.totalBlockingCases + distilledSummary.totalBlockingCases,
      totalCases: rawSummary.totalCases + distilledSummary.totalCases,
    },
  };
}

describe("ImplicitMemBench raw internalization diagnostics", () => {
  it("aggregates stable diagnosis buckets and raw-vs-distilled delta", () => {
    const report = createReport({
      distilledCases: [
        createCase({
          caseId: "case-1",
          passed: true,
          profile: "goodmemory-distilled-feedback",
        }),
        createCase({
          caseId: "case-2",
          passed: false,
          profile: "goodmemory-distilled-feedback",
        }),
      ],
      rawCases: [
        createCase({
          caseId: "case-1",
          passed: false,
          rawCarryover: {
            candidatePrototypeIds: ["p1"],
            diagnosis: "support_conflict",
            mode: "abstained",
            selectedExemplarIds: [],
            selectedPrototypeIds: [],
          },
        }),
        createCase({
          caseId: "case-2",
          executionFailure: "Invalid JSON response from judge",
          passed: false,
        }),
      ],
    });

    const summary = buildRawInternalizationDiagnosisSummary([report]);

    expect(summary.totalCases).toBe(2);
    expect(summary.byDiagnosis.support_conflict).toBe(1);
    expect(summary.byCueSufficiency.candidate_conflict).toBe(1);
    expect(summary.byCueSufficiency.operator_failure).toBe(1);
    expect(summary.byDiagnosis.operator_failure).toBe(1);
    expect(summary.byExecutionFailure.invalid_json_response).toBe(1);
    expect(summary.rawVsDistilledDelta.distilledOnlyPasses).toBe(1);
    expect(summary.rawBlockingExecutionFailures).toBe(1);
  });

  it("splits raw memory miss into cue-sufficiency buckets", () => {
    const report = createReport({
      distilledCases: [],
      rawCases: [
        createCase({
          caseId: "no-candidate",
          passed: false,
          rawCarryover: {
            abstainReason: "no_candidates",
            candidatePrototypeIds: [],
            diagnosis: "memory_miss",
            mode: "abstained",
            selectedExemplarIds: [],
            selectedPrototypeIds: [],
          },
        }),
        createCase({
          caseId: "candidate-insufficient",
          passed: false,
          rawCarryover: {
            candidatePrototypeIds: ["p1", "p2"],
            diagnosis: "hypothesis_missing",
            mode: "abstained",
            selectedExemplarIds: [],
            selectedPrototypeIds: [],
            topProbability: 0.41,
          },
        }),
        createCase({
          caseId: "cue-disconnect",
          passed: false,
          rawCarryover: {
            candidatePrototypeIds: ["p1"],
            diagnosis: "memory_miss",
            goldSupportingCandidatePresent: false,
            hypothesis: {
              confidence: 0.82,
              executionMode: "transient_executor",
              mappingType: "hard_constraint_contract",
              supportingPrototypeIds: ["p1"],
            },
            mode: "exemplar_only",
            selectedExemplarIds: ["e1"],
            selectedPrototypeIds: ["p1"],
            topProbability: 0.82,
          },
        }),
        createCase({
          caseId: "sufficient-not-enacted",
          passed: false,
          rawCarryover: {
            candidatePrototypeIds: ["p1"],
            diagnosis: "reasoning_after_correct_hypothesis",
            goldSupportingCandidatePresent: true,
            hypothesis: {
              confidence: 0.91,
              executionMode: "transient_executor",
              mappingType: "exact_format_contract",
              supportingPrototypeIds: ["p1"],
            },
            mode: "exemplar_only",
            selectedExemplarIds: ["e1"],
            selectedPrototypeIds: ["p1"],
            topProbability: 0.91,
          },
        }),
      ],
    });

    const summary = buildRawInternalizationDiagnosisSummary([report]);

    expect(summary.byCueSufficiency.no_candidate).toBe(1);
    expect(summary.byCueSufficiency.candidate_insufficient).toBe(1);
    expect(summary.byCueSufficiency.cue_disconnect).toBe(1);
    expect(summary.byCueSufficiency.sufficient_not_enacted).toBe(1);
    expect(summary.byCase.find((caseResult) => caseResult.caseId === "cue-disconnect")).toMatchObject({
      candidatePrototypeCount: 1,
      cueSufficiency: "cue_disconnect",
      hypothesisExecutionMode: "transient_executor",
      hypothesisMappingType: "hard_constraint_contract",
      selectedPrototypeCount: 1,
      topProbability: 0.82,
    });
  });

  it("does not treat a passing answer with no raw candidate as selected carryover", () => {
    const report = createReport({
      distilledCases: [],
      rawCases: [
        createCase({
          caseId: "baseline-pass-without-memory",
          passed: true,
          rawCarryover: {
            abstainReason: "no_candidates",
            candidatePrototypeIds: [],
            diagnosis: "selected_and_passed",
            mode: "abstained",
            selectedExemplarIds: [],
            selectedPrototypeIds: [],
          },
        }),
      ],
    });

    const summary = buildRawInternalizationDiagnosisSummary([report]);

    expect(summary.byDiagnosis.memory_miss).toBe(1);
    expect(summary.byDiagnosis.selected_and_passed).toBe(0);
    expect(summary.byCueSufficiency.no_candidate).toBe(1);
    expect(summary.rawPassedBlockingCases).toBe(1);
  });
});
