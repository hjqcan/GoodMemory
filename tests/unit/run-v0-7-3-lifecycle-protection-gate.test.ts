import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  buildV073PairedCommandChain,
  deriveV073ClaimCommandTemplateSha256,
  deriveV073PromptSha256,
  evaluateV073LifecycleProtection,
  type V073LifecycleProtectionManifest,
} from "../../scripts/run-v0-7-3-lifecycle-protection-gate";

const BASELINE_COMMIT = "456edd106f29118b3455bf21c43d7b3107b48213";
const CANDIDATE_COMMIT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const QUESTION_SELECTION_SHA256 =
  "43ed915ce851ba4f1501ed0fd995c29611195f8ff71d2c6af57ae9dc118a5c6c";
const BENCHMARK_FINGERPRINT =
  "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd";
const BENCHMARK_ROOT_SHA256 =
  "e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28";
const BENCHMARK_ROOT = resolve(
  homedir(),
  ".cache/goodmemory-benchmarks/LoCoMo-captioned-full10-v1",
);
const ANSWER_GATEWAY = "https://ai.gurkiai.com/v1";
const EMBEDDING_GATEWAY = "https://openrouter.ai/api/v1";
const ANSWER_MODEL = "gpt-5.6-terra";
const ANSWER_SYSTEM = "locomo-live-category-aware-v1";
const SEED_SOURCE_RAW = readFileSync(
  resolve("scripts/run-phase-65-locomo-smoke.ts"),
  "utf8",
);
const REANSWER_SOURCE_RAW = readFileSync(
  resolve("scripts/reanswer-phase-65-locomo-report.ts"),
  "utf8",
);
const OFFICIAL_SOURCE_RAW = readFileSync(
  resolve("scripts/rescore-official-protocols.ts"),
  "utf8",
);
const CLAIM_SOURCE_RAW = readFileSync(
  resolve(
    "reports/release/v0.7/" +
      "v0.7.3-locomo-claim-evidence/claim-recipe-source.json",
  ),
  "utf8",
);
const LIVE_DELTA_SOURCE_RAW = readFileSync(
  resolve("scripts/analyze-phase-65-locomo-live-delta.ts"),
  "utf8",
);
const LIVE_DELTA_STDOUT = "LoCoMo live-delta complete\n";
const LIVE_DELTA_STDERR = "";
const SCENARIO_STDOUT = "bun test v1.3.14\n\n 8 pass\n 0 fail\n";
const SCENARIO_STDERR = "";

const CATEGORY_BY_CODE = {
  m: "multi_hop",
  o: "open_domain",
  s: "single_hop",
  t: "temporal",
} as const;

const CASE_SELECTIONS = [
  {
    caseId: "locomo-conv-26",
    categoryCodes:
      "ttommttmtttmtmomttmmttommttottotmtmttmmmmtomttommt" +
      "ommttmmttommttommttommtttmmomttossssssssssssssssss" +
      "ssssssssssssssssssssssssssssssssssssssssssssssssss" +
      "ss",
    questionNumbers: Array.from({ length: 152 }, (_, index) => index),
    questionPrefix: "conv-26",
  },
  {
    caseId: "locomo-conv-30",
    categoryCodes:
      "ttsmsmtttmtttttttmmttttmmmtmtmtmtttttttsssssssssss" +
      "sssssssssssssssssssssssssssssss",
    questionNumbers: [
      ...Array.from({ length: 79 }, (_, index) => index),
      80,
      81,
    ],
    questionPrefix: "conv-30",
  },
] as const;

const QUESTION_SELECTION = CASE_SELECTIONS.flatMap((selection) => {
  const codes = [...selection.categoryCodes];
  if (codes.length !== selection.questionNumbers.length) {
    throw new Error(`${selection.caseId} test selection is internally inconsistent`);
  }
  return selection.questionNumbers.map((questionNumber, index) => ({
    caseId: selection.caseId,
    category: CATEGORY_BY_CODE[codes[index] as keyof typeof CATEGORY_BY_CODE],
    questionId: `${selection.questionPrefix}:q${questionNumber}`,
  }));
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function manifest(): V073LifecycleProtectionManifest {
  const sharedExecution = {
    answerGateway: ANSWER_GATEWAY,
    answerModel: ANSWER_MODEL,
    answerSystem: ANSWER_SYSTEM,
    benchmarkFingerprint: BENCHMARK_FINGERPRINT,
    benchmarkRoot: BENCHMARK_ROOT,
    benchmarkRootSha256: BENCHMARK_ROOT_SHA256,
    bunVersion: "1.3.14",
    caseIds: ["locomo-conv-26", "locomo-conv-30"] as const,
    answerProvider: "openai",
    assistedExtractorGateway: ANSWER_GATEWAY,
    assistedExtractorModel: ANSWER_MODEL,
    assistedExtractorProvider: "openai",
    claimCommandTemplateSha256:
      deriveV073ClaimCommandTemplateSha256(CLAIM_SOURCE_RAW),
    claimSourceSha256: sha256(CLAIM_SOURCE_RAW),
    concurrency: 40,
    embeddingGateway: EMBEDDING_GATEWAY,
    embeddingModel: "text-embedding-3-small",
    embeddingProvider: "openai",
    generatedBy: "scripts/reanswer-phase-65-locomo-report.ts",
    promptSha256: deriveV073PromptSha256(),
    questionSelectionSha256: QUESTION_SELECTION_SHA256,
    judgeGateway: ANSWER_GATEWAY,
    judgeModel: "gpt-5.5",
    judgeProvider: "openai",
    officialSourceSha256: sha256(OFFICIAL_SOURCE_RAW),
    reanswerSourceSha256: sha256(REANSWER_SOURCE_RAW),
    resume: false,
    rerankingGateway: ANSWER_GATEWAY,
    rerankingModel: "gpt-5.6-terra",
    rerankingProvider: "openai",
    seedGeneratedBy: "scripts/run-phase-65-locomo-smoke.ts",
    seedResume: true,
    seedSourceSha256: sha256(SEED_SOURCE_RAW),
  };
  return {
    baseline: {
      commit: BASELINE_COMMIT,
      execution: {
        ...sharedExecution,
        freshOutputEvidence: {
          checkpointPath: "/reports/v073-baseline-seed/live-progress.jsonl",
          checkpointPathAbsentBeforeRun: true,
          outputPath: "/reports/v073-baseline-seed",
          outputPathAbsentBeforeRun: true,
        },
        officialRunId: "v073-baseline-official",
        outputPath: "/reports/v073-baseline-final",
        runId: "v073-baseline-final",
        seedOutputPath: "/reports/v073-baseline-seed",
        seedRunId: "v073-baseline-seed",
        worktreePath: "/worktrees/baseline",
      },
      executionReceiptPath: "/reports/baseline-execution-receipt.json",
      executionReceiptSha256: "0".repeat(64),
      officialSummaryPath:
        "/worktrees/baseline/reports/eval/research/official-rescore/v073-baseline-official/rescore-summary.json",
      reportPath: "/reports/v073-baseline-final/smoke-report.json",
      seedReportPath: "/reports/v073-baseline-seed/smoke-report.json",
    },
    candidate: {
      commit: CANDIDATE_COMMIT,
      execution: {
        ...sharedExecution,
        freshOutputEvidence: {
          checkpointPath: "/reports/v073-candidate-seed/live-progress.jsonl",
          checkpointPathAbsentBeforeRun: true,
          outputPath: "/reports/v073-candidate-seed",
          outputPathAbsentBeforeRun: true,
        },
        officialRunId: "v073-candidate-official",
        outputPath: "/reports/v073-candidate-final",
        runId: "v073-candidate-final",
        seedOutputPath: "/reports/v073-candidate-seed",
        seedRunId: "v073-candidate-seed",
        worktreePath: "/worktrees/candidate",
      },
      executionReceiptPath: "/reports/candidate-execution-receipt.json",
      executionReceiptSha256: "0".repeat(64),
      officialSummaryPath:
        "/worktrees/candidate/reports/eval/research/official-rescore/v073-candidate-official/rescore-summary.json",
      reportPath: "/reports/v073-candidate-final/smoke-report.json",
      seedReportPath: "/reports/v073-candidate-seed/smoke-report.json",
    },
    liveDeltaPath: "/reports/live-delta.json",
    scenarioReplay: {
      command: "bun test tests/scenarios",
      executionReceiptPath: "/reports/scenario-execution-receipt.json",
      executionReceiptSha256: "0".repeat(64),
      reportPath: "/reports/scenario-replay.json",
      reportSha256: "0".repeat(64),
      stderrPath: "/reports/scenario-stderr.log",
      stderrSha256: sha256(SCENARIO_STDERR),
      stdoutPath: "/reports/scenario-stdout.log",
      stdoutSha256: sha256(SCENARIO_STDOUT),
    },
    schemaVersion: 1,
  };
}

function cases(input?: { openDomainF1?: number; openDomainRecall?: number }) {
  return QUESTION_SELECTION.map(({ caseId, category, questionId }, index) => ({
    answerCorrect: index < 200,
    answerTokenF1:
      category === "open_domain" ? input?.openDomainF1 ?? 0.6 : 0.8,
    caseId,
    category: category as string,
    evidenceRecall:
      category === "open_domain" ? input?.openDomainRecall ?? 0.7 : 0.9,
    executionFailureMessage: null,
    questionId,
  }));
}

function seedReport(arm: "baseline" | "candidate") {
  const prefix = arm === "baseline" ? "v073-baseline" : "v073-candidate";
  return {
    answerEvaluation: "deferred-to-live-mode",
    benchmark: "locomo",
    benchmarkFingerprint: BENCHMARK_FINGERPRINT,
    benchmarkSource: `${BENCHMARK_ROOT}/cases.json`,
    caseIds: ["locomo-conv-26", "locomo-conv-30"],
    cases: cases().map((row) => ({
      ...row,
      answerCorrect: null,
      answerTokenF1: null,
    })),
    concurrency: 40,
    executionFailures: 0,
    externalRoot: BENCHMARK_ROOT,
    generatedAt: "2026-08-06T12:00:00.000Z",
    generatedBy: "scripts/run-phase-65-locomo-smoke.ts",
    mode: "retrieval-only",
    questionCount: QUESTION_SELECTION.length,
    resume: true,
    runDirectory: `/reports/${prefix}-seed`,
    runId: `${prefix}-seed`,
  };
}

function finalReport(input: {
  arm: "baseline" | "candidate";
  openDomainF1?: number;
  openDomainRecall?: number;
}) {
  const prefix = input.arm === "baseline" ? "v073-baseline" : "v073-candidate";
  return {
    answerSystem: ANSWER_SYSTEM,
    answerEvaluation: "scored",
    benchmark: "locomo",
    benchmarkFingerprint: BENCHMARK_FINGERPRINT,
    benchmarkSource: `${BENCHMARK_ROOT}/cases.json`,
    caseIds: ["locomo-conv-26", "locomo-conv-30"],
    cases: cases(input),
    concurrency: 40,
    executionFailures: 0,
    externalRoot: BENCHMARK_ROOT,
    generatedAt: "2026-08-06T13:00:00.000Z",
    generatedBy: "scripts/reanswer-phase-65-locomo-report.ts",
    mode: "live-answer",
    questionCount: QUESTION_SELECTION.length,
    resume: false,
    runDirectory: `/reports/${prefix}-final`,
    runId: `${prefix}-final`,
    sourceReport: {
      generatedAt: "2026-08-06T12:00:00.000Z",
      path: `/reports/${prefix}-seed/smoke-report.json`,
      runId: `${prefix}-seed`,
    },
  };
}

function official(input: {
  openDomainCorrect?: number;
  outputPath: string;
  reportPath: string;
  reportRaw: string;
  runId: string;
}) {
  const correctByCategory = {
    single_hop: 114,
    multi_hop: 43,
    temporal: 63,
    open_domain: input.openDomainCorrect ?? 13,
  };
  const totals = {
    single_hop: 114,
    multi_hop: 43,
    temporal: 63,
    open_domain: 13,
  };
  const categories = Object.fromEntries(
    Object.entries(totals).map(([category, total]) => {
      const correct = correctByCategory[category as keyof typeof correctByCategory];
      return [category, { accuracy: correct / total, correct, total }];
    }),
  );
  const overallCorrect = Object.values(correctByCategory).reduce(
    (sum, correct) => sum + correct,
    0,
  );
  return {
    benchmark: "locomo",
    categories,
    claimBoundary:
      "Official/industry-prompt-compatible stored-answer rescore; numeric comparability is benchmark-specific and requires a matching pinned evaluator configuration; not answer regeneration or a public benchmark claim.",
    generatedAt: "2026-08-06T14:00:00.000Z",
    generatedBy: "scripts/rescore-official-protocols.ts",
    judgeFailures: 0,
    judgeGateway: ANSWER_GATEWAY,
    judgeModel: "gpt-5.5",
    judgeProvider: "openai",
    judgedCases: QUESTION_SELECTION.length,
    limit: null,
    limitUnit: "cases",
    overallAccuracy: overallCorrect / QUESTION_SELECTION.length,
    overallCorrect,
    outputPath: input.outputPath,
    protocol: "mem0ai/memory-benchmarks LoCoMo judge",
    runId: input.runId,
    scorerSource: null,
    selectedCases: QUESTION_SELECTION.length,
    sourceAnswersUnchanged: true,
    sourceCases: QUESTION_SELECTION.length,
    sourceInputFingerprints: {
      reportPath: {
        bytes: Buffer.byteLength(input.reportRaw),
        sha256: sha256(input.reportRaw),
      },
      rootPath: {
        bytes: 2_490_457,
        sha256: BENCHMARK_ROOT_SHA256,
      },
    },
    sourceInputs: {
      reportPath: input.reportPath,
      rootPath: `${BENCHMARK_ROOT}/cases.json`,
    },
    totalCases: QUESTION_SELECTION.length,
  };
}

function officialProgress(
  report: ReturnType<typeof finalReport>,
  summary: ReturnType<typeof official>,
): string {
  const seen = new Map<string, number>();
  return `${report.cases.map((row) => {
    const index = seen.get(row.category) ?? 0;
    seen.set(row.category, index + 1);
    return JSON.stringify({
      correct: index < summary.categories[row.category]!.correct,
      questionId: row.questionId,
    });
  }).join("\n")}\n`;
}

function liveDelta(input?: { improved?: number; regressed?: number }) {
  return {
    answerImprovements: [],
    answerRegressions: [],
    baselineReport: {
      path: "/reports/v073-baseline-final/smoke-report.json",
      runId: "v073-baseline-final",
    },
    candidateReport: {
      path: "/reports/v073-candidate-final/smoke-report.json",
      runId: "v073-candidate-final",
    },
    generatedBy: "scripts/analyze-phase-65-locomo-live-delta.ts",
    overall: {
      answerTransitions: {
        baselineOnlyAnswered: 0,
        bothUnanswered: 0,
        candidateOnlyAnswered: 0,
        improved: input?.improved ?? 0,
        regressed: input?.regressed ?? 0,
        sameCorrect: 200 - (input?.regressed ?? 0),
        sameWrong: 33 - (input?.improved ?? 0),
      },
      questionCount: QUESTION_SELECTION.length,
    },
  };
}

function liveDeltaExecutionReceipt(input: {
  baselineReportRaw: string;
  candidateReportRaw: string;
  liveDeltaRaw: string;
  manifest: V073LifecycleProtectionManifest;
}) {
  return {
    analyzerSource: {
      bytes: Buffer.byteLength(LIVE_DELTA_SOURCE_RAW),
      path: "/worktrees/candidate/scripts/analyze-phase-65-locomo-live-delta.ts",
      sha256: sha256(LIVE_DELTA_SOURCE_RAW),
    },
    baselineCommit: BASELINE_COMMIT,
    baselineReport: {
      bytes: Buffer.byteLength(input.baselineReportRaw),
      path: input.manifest.baseline.reportPath,
      sha256: sha256(input.baselineReportRaw),
    },
    bunVersion: "1.3.14",
    candidateCommit: CANDIDATE_COMMIT,
    candidateReport: {
      bytes: Buffer.byteLength(input.candidateReportRaw),
      path: input.manifest.candidate.reportPath,
      sha256: sha256(input.candidateReportRaw),
    },
    exitCode: 0,
    generatedBy: "v0.7.3-live-delta-process-capture",
    invocation: {
      args: [
        "run",
        "scripts/analyze-phase-65-locomo-live-delta.ts",
        "--",
        "--baseline-report",
        input.manifest.baseline.reportPath,
        "--candidate-report",
        input.manifest.candidate.reportPath,
        "--output-path",
        input.manifest.liveDeltaPath,
        "--run-id",
        "v0.7.3-lifecycle-paired-final-delta",
      ],
      command: "bun" as const,
      cwd: input.manifest.candidate.execution.worktreePath,
      environment: {},
    },
    report: {
      bytes: Buffer.byteLength(input.liveDeltaRaw),
      path: input.manifest.liveDeltaPath,
      sha256: sha256(input.liveDeltaRaw),
    },
    schemaVersion: 1,
    stderr: {
      bytes: 0,
      path: "/reports/live-delta-stderr.log",
      sha256: sha256(LIVE_DELTA_STDERR),
    },
    stdout: {
      bytes: Buffer.byteLength(LIVE_DELTA_STDOUT),
      path: "/reports/live-delta-stdout.log",
      sha256: sha256(LIVE_DELTA_STDOUT),
    },
    worktreeProvenance: {
      headCommit: CANDIDATE_COMMIT,
      statusPorcelain: "",
    },
  };
}

function scenarioReplay() {
  return {
    candidateCommit: CANDIDATE_COMMIT,
    command: "bun test tests/scenarios",
    executionReceiptPath: "/reports/scenario-execution-receipt.json",
    failures: 0,
    generatedBy: "v0.7.3-scenario-process-capture",
    passed: 8,
    schemaVersion: 1,
  };
}

function candidateWithAnswerTransitions(input: {
  improved: number;
  regressed: number;
}) {
  const report = finalReport({ arm: "candidate" });
  for (const row of report.cases.slice(0, input.regressed)) {
    row.answerCorrect = false;
  }
  for (const row of report.cases.slice(200, 200 + input.improved)) {
    row.answerCorrect = true;
  }
  return report;
}

function scenarioExecutionReceipt() {
  return {
    bunVersion: "1.3.14",
    candidateCommit: CANDIDATE_COMMIT,
    command: "bun test tests/scenarios",
    exitCode: 0,
    generatedBy: "v0.7.3-scenario-process-capture",
    schemaVersion: 1,
    stderr: {
      bytes: Buffer.byteLength(SCENARIO_STDERR),
      path: "/reports/scenario-stderr.log",
      sha256: sha256(SCENARIO_STDERR),
    },
    stdout: {
      bytes: Buffer.byteLength(SCENARIO_STDOUT),
      path: "/reports/scenario-stdout.log",
      sha256: sha256(SCENARIO_STDOUT),
    },
    worktreeProvenance: {
      headCommit: CANDIDATE_COMMIT,
      statusPorcelain: "",
    },
  };
}

function executionReceipt(
  arm: V073LifecycleProtectionManifest["baseline"],
  input: {
    officialProgressRaw: string;
    officialRaw: string;
    reportRaw: string;
    seedReportRaw: string;
  },
) {
  return {
    commandChain: buildV073PairedCommandChain(arm, CLAIM_SOURCE_RAW),
    commit: arm.commit,
    execution: arm.execution,
    generatedBy: "v0.7.3-lifecycle-paired-arm-launch",
    outputs: {
      finalReport: {
        bytes: Buffer.byteLength(input.reportRaw),
        path: arm.reportPath,
        sha256: sha256(input.reportRaw),
      },
      officialProgress: {
        bytes: Buffer.byteLength(input.officialProgressRaw),
        path: resolve(arm.officialSummaryPath, "../progress.jsonl"),
        sha256: sha256(input.officialProgressRaw),
      },
      officialSummary: {
        bytes: Buffer.byteLength(input.officialRaw),
        path: arm.officialSummaryPath,
        sha256: sha256(input.officialRaw),
      },
      seedReport: {
        bytes: Buffer.byteLength(input.seedReportRaw),
        path: arm.seedReportPath,
        sha256: sha256(input.seedReportRaw),
      },
    },
    schemaVersion: 1,
    worktreeProvenance: {
      headCommit: arm.commit,
      statusPorcelain: "",
    },
  };
}

function evaluate(input?: {
  baselineReport?: ReturnType<typeof finalReport>;
  baselineSeedReport?: ReturnType<typeof seedReport>;
  candidateReport?: ReturnType<typeof finalReport>;
  candidateSeedReport?: ReturnType<typeof seedReport>;
  liveDelta?: ReturnType<typeof liveDelta>;
  manifest?: V073LifecycleProtectionManifest;
  mutateBaselineOfficial?: (value: ReturnType<typeof official>) => void;
  mutateCandidateExecutionReceipt?: (
    value: ReturnType<typeof executionReceipt>,
  ) => void;
  mutateCandidateOfficial?: (value: ReturnType<typeof official>) => void;
  mutateLiveDeltaExecutionReceipt?: (
    value: ReturnType<typeof liveDeltaExecutionReceipt>,
  ) => void;
  mutateScenarioExecutionReceipt?: (
    value: ReturnType<typeof scenarioExecutionReceipt>,
  ) => void;
  scenarioReplay?: ReturnType<typeof scenarioReplay>;
  scenarioStdout?: string;
  baselineWorktreeProvenance?: { headCommit: string; statusPorcelain: string };
  candidateWorktreeProvenance?: { headCommit: string; statusPorcelain: string };
  sourceOverrides?: Partial<{
    baselineClaim: string;
    baselineOfficial: string;
    baselineReanswer: string;
    baselineSeed: string;
    candidateClaim: string;
    candidateOfficial: string;
    candidateReanswer: string;
    candidateSeed: string;
  }>;
}) {
  const protectionManifest = input?.manifest ?? manifest();
  const baselineReport = input?.baselineReport ?? finalReport({ arm: "baseline" });
  const candidateReport = input?.candidateReport ?? finalReport({ arm: "candidate" });
  const baselineSeed = input?.baselineSeedReport ?? seedReport("baseline");
  const candidateSeed = input?.candidateSeedReport ?? seedReport("candidate");
  if (input?.baselineSeedReport === undefined) {
    baselineSeed.cases.forEach((row, index) => {
      row.evidenceRecall = baselineReport.cases[index]?.evidenceRecall ?? row.evidenceRecall;
    });
  }
  if (input?.candidateSeedReport === undefined) {
    candidateSeed.cases.forEach((row, index) => {
      row.evidenceRecall = candidateReport.cases[index]?.evidenceRecall ?? row.evidenceRecall;
    });
  }
  const baselineSeedReportRaw = JSON.stringify(baselineSeed);
  const candidateSeedReportRaw = JSON.stringify(candidateSeed);
  const baselineReportRaw = JSON.stringify(baselineReport);
  const candidateReportRaw = JSON.stringify(candidateReport);
  const baselineOfficial = official({
    outputPath: protectionManifest.baseline.officialSummaryPath,
    reportPath: protectionManifest.baseline.reportPath,
    reportRaw: baselineReportRaw,
    runId: protectionManifest.baseline.execution.officialRunId,
  });
  const candidateOfficial = official({
    outputPath: protectionManifest.candidate.officialSummaryPath,
    reportPath: protectionManifest.candidate.reportPath,
    reportRaw: candidateReportRaw,
    runId: protectionManifest.candidate.execution.officialRunId,
  });
  input?.mutateBaselineOfficial?.(baselineOfficial);
  input?.mutateCandidateOfficial?.(candidateOfficial);
  const baselineOfficialProgressRaw = officialProgress(
    baselineReport,
    baselineOfficial,
  );
  const candidateOfficialProgressRaw = officialProgress(
    candidateReport,
    candidateOfficial,
  );
  const baselineReceipt = executionReceipt(protectionManifest.baseline, {
    officialProgressRaw: baselineOfficialProgressRaw,
    officialRaw: JSON.stringify(baselineOfficial),
    reportRaw: baselineReportRaw,
    seedReportRaw: baselineSeedReportRaw,
  });
  const candidateReceipt = executionReceipt(protectionManifest.candidate, {
    officialProgressRaw: candidateOfficialProgressRaw,
    officialRaw: JSON.stringify(candidateOfficial),
    reportRaw: candidateReportRaw,
    seedReportRaw: candidateSeedReportRaw,
  });
  input?.mutateCandidateExecutionReceipt?.(candidateReceipt);
  const baselineExecutionReceiptRaw = JSON.stringify(baselineReceipt);
  const candidateExecutionReceiptRaw = JSON.stringify(candidateReceipt);
  protectionManifest.baseline.executionReceiptSha256 = sha256(
    baselineExecutionReceiptRaw,
  );
  protectionManifest.candidate.executionReceiptSha256 = sha256(
    candidateExecutionReceiptRaw,
  );

  const scenario = input?.scenarioReplay ?? scenarioReplay();
  const scenarioRaw = JSON.stringify(scenario);
  const scenarioReceipt = scenarioExecutionReceipt();
  input?.mutateScenarioExecutionReceipt?.(scenarioReceipt);
  const scenarioReceiptRaw = JSON.stringify(scenarioReceipt);
  protectionManifest.scenarioReplay.reportSha256 = sha256(scenarioRaw);
  protectionManifest.scenarioReplay.executionReceiptSha256 = sha256(
    scenarioReceiptRaw,
  );
  const scenarioStdout = input?.scenarioStdout ?? SCENARIO_STDOUT;
  const delta = input?.liveDelta ?? liveDelta();
  const liveDeltaRaw = JSON.stringify(delta);
  const liveDeltaReceipt = liveDeltaExecutionReceipt({
    baselineReportRaw,
    candidateReportRaw,
    liveDeltaRaw,
    manifest: protectionManifest,
  });
  input?.mutateLiveDeltaExecutionReceipt?.(liveDeltaReceipt);
  const liveDeltaExecutionReceiptRaw = JSON.stringify(liveDeltaReceipt);
  const manifestRaw = JSON.stringify(protectionManifest);
  return evaluateV073LifecycleProtection({
    baselineExecutionReceipt: baselineReceipt,
    baselineExecutionReceiptRaw,
    baselineOfficial,
    baselineOfficialProgressRaw,
    baselineOfficialRaw: JSON.stringify(baselineOfficial),
    baselineReport,
    baselineReportRaw,
    baselineSeedReport: baselineSeed,
    baselineSeedReportRaw,
    baselineSources: {
      claimRecipeRaw:
        input?.sourceOverrides?.baselineClaim ?? CLAIM_SOURCE_RAW,
      officialRunnerRaw:
        input?.sourceOverrides?.baselineOfficial ?? OFFICIAL_SOURCE_RAW,
      reanswerRunnerRaw:
        input?.sourceOverrides?.baselineReanswer ?? REANSWER_SOURCE_RAW,
      seedRunnerRaw: input?.sourceOverrides?.baselineSeed ?? SEED_SOURCE_RAW,
    },
    baselineWorktreeProvenance: input?.baselineWorktreeProvenance ?? {
      headCommit: BASELINE_COMMIT,
      statusPorcelain: "",
    },
    candidateExecutionReceipt: candidateReceipt,
    candidateExecutionReceiptRaw,
    candidateOfficial,
    candidateOfficialProgressRaw,
    candidateOfficialRaw: JSON.stringify(candidateOfficial),
    candidateReport,
    candidateReportRaw,
    candidateSeedReport: candidateSeed,
    candidateSeedReportRaw,
    candidateSources: {
      claimRecipeRaw:
        input?.sourceOverrides?.candidateClaim ?? CLAIM_SOURCE_RAW,
      officialRunnerRaw:
        input?.sourceOverrides?.candidateOfficial ?? OFFICIAL_SOURCE_RAW,
      reanswerRunnerRaw:
        input?.sourceOverrides?.candidateReanswer ?? REANSWER_SOURCE_RAW,
      seedRunnerRaw: input?.sourceOverrides?.candidateSeed ?? SEED_SOURCE_RAW,
    },
    candidateWorktreeProvenance: input?.candidateWorktreeProvenance ?? {
      headCommit: CANDIDATE_COMMIT,
      statusPorcelain: "",
    },
    liveDelta: delta,
    liveDeltaAnalyzerSourceRaw: LIVE_DELTA_SOURCE_RAW,
    liveDeltaExecutionReceipt: liveDeltaReceipt,
    liveDeltaExecutionReceiptRaw,
    liveDeltaRaw,
    liveDeltaStderrRaw: LIVE_DELTA_STDERR,
    liveDeltaStdoutRaw: LIVE_DELTA_STDOUT,
    manifest: protectionManifest,
    manifestPath: "/reports/protection-manifest.json",
    manifestRaw,
    scenarioExecutionReceipt: scenarioReceipt,
    scenarioExecutionReceiptRaw: scenarioReceiptRaw,
    scenarioReplay: scenario,
    scenarioReplayRaw: scenarioRaw,
    scenarioStderrRaw: SCENARIO_STDERR,
    scenarioStdoutRaw: scenarioStdout,
  });
}

describe("v0.7.3 lifecycle paired protection gate", () => {
  it("accepts a fully bound seed -> reanswer -> official chain within one point", () => {
    const report = evaluate({
      candidateReport: finalReport({
        arm: "candidate",
        openDomainF1: 0.595,
        openDomainRecall: 0.695,
      }),
    });

    expect(report.releaseAllowed).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.fullClaimRerunRequired).toBe(true);
    expect(report.researchRecordRequired).toBe(false);
    expect(report.artifacts.baseline.seedReport.sha256).toBe(
      sha256(JSON.stringify(seedReport("baseline"))),
    );
    expect(report.artifacts.candidate.report.sha256).toBe(
      sha256(JSON.stringify(finalReport({
        arm: "candidate",
        openDomainF1: 0.595,
        openDomainRecall: 0.695,
      }))),
    );
    expect(report.artifacts.scenarioExecutionReceipt.sha256).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(report.claimBoundary).toContain("omits --answer-profile");
    expect(report.claimBoundary).toContain("0.8799");
  });

  it("derives the prompt and current claim recipe and builds the exact default-profile chain", () => {
    expect(deriveV073PromptSha256()).toBe(deriveV073PromptSha256());
    expect(deriveV073ClaimCommandTemplateSha256(CLAIM_SOURCE_RAW)).toBe(
      sha256(JSON.parse(CLAIM_SOURCE_RAW).run.command),
    );
    const chain = buildV073PairedCommandChain(
      manifest().candidate,
      CLAIM_SOURCE_RAW,
    );
    expect(chain.seedSmoke.args).toContain("--resume");
    expect(chain.reanswer.args).not.toContain("--answer-profile");
    expect(chain.reanswer.args).toContain(
      "/reports/v073-candidate-seed/smoke-report.json",
    );
    expect(chain.officialRescore.args).toContain(
      "/reports/v073-candidate-final/smoke-report.json",
    );
    expect(chain.seedSmoke.environment).toEqual(expect.objectContaining({
      GOODMEMORY_ASSISTED_EXTRACTOR_MODEL: ANSWER_MODEL,
      GOODMEMORY_EMBEDDING_BASE_URL: EMBEDDING_GATEWAY,
      GOODMEMORY_EMBEDDING_MODEL: "text-embedding-3-small",
      GOODMEMORY_RERANKING_MODEL: "gpt-5.6-terra",
    }));
    expect(chain.officialRescore.environment).toEqual(expect.objectContaining({
      GOODMEMORY_JUDGE_BASE_URL: ANSWER_GATEWAY,
    }));
  });

  it("pins embedding to OpenRouter and judging to Gurki", () => {
    const wrongEmbedding = manifest();
    wrongEmbedding.baseline.execution.embeddingGateway = ANSWER_GATEWAY;
    wrongEmbedding.candidate.execution.embeddingGateway = ANSWER_GATEWAY;
    expect(() => evaluate({ manifest: wrongEmbedding })).toThrow(
      "baseline embeddingGateway must match the frozen OpenRouter gateway",
    );

    const wrongJudge = manifest();
    wrongJudge.baseline.execution.judgeGateway = "https://judge.example/v1";
    wrongJudge.candidate.execution.judgeGateway = "https://judge.example/v1";
    expect(() => evaluate({ manifest: wrongJudge })).toThrow(
      "baseline judgeGateway must match the frozen Gurki gateway",
    );
  });

  it("blocks a regression greater than one point and requires a research record", () => {
    const candidate = candidateWithAnswerTransitions({
      improved: 0,
      regressed: 12,
    });
    for (const row of candidate.cases) {
      if (row.category === "open_domain") {
        row.answerTokenF1 = 0.4;
        row.evidenceRecall = 0.5;
      }
    }
    const report = evaluate({
      candidateReport: candidate,
      liveDelta: liveDelta({ regressed: 12 }),
      mutateCandidateOfficial: (summary) => {
        summary.categories.open_domain = { accuracy: 0, correct: 0, total: 13 };
        summary.overallCorrect = 220;
        summary.overallAccuracy = 220 / 233;
      },
    });

    expect(report.releaseAllowed).toBe(false);
    expect(report.researchRecordRequired).toBe(true);
    expect(report.blockers).toContain(
      "overall evidenceRecall regressed by more than 1.00pt",
    );
    expect(report.blockers).toContain(
      "overall officialScore regressed by more than 1.00pt",
    );
    expect(report.questionTransitions.regressed).toBe(12);
  });

  it("applies the protection bar to category and conversation metrics", () => {
    const candidate = finalReport({ arm: "candidate" });
    for (const row of candidate.cases) {
      if (row.caseId === "locomo-conv-30") {
        row.evidenceRecall -= 0.02;
      }
    }
    const report = evaluate({ candidateReport: candidate });
    expect(report.releaseAllowed).toBe(false);
    expect(report.blockers).toContain(
      "conversation locomo-conv-30 evidenceRecall regressed by more than 1.00pt",
    );

    const categoryReport = evaluate({
      mutateCandidateOfficial: (summary) => {
        summary.categories.open_domain = {
          accuracy: 11 / 13,
          correct: 11,
          total: 13,
        };
        summary.overallCorrect = 231;
        summary.overallAccuracy = 231 / 233;
      },
    });
    expect(categoryReport.blockers).toContain(
      "category open_domain officialScore regressed by more than 1.00pt",
    );
    expect(categoryReport.blockers.some((blocker) =>
      blocker.includes("conversation") && blocker.includes("officialScore"),
    )).toBe(true);
  });

  it("uses full transition counts rather than truncated detail arrays", () => {
    expect(
      evaluate({
        candidateReport: candidateWithAnswerTransitions({
          improved: 14,
          regressed: 12,
        }),
        liveDelta: liveDelta({ improved: 14, regressed: 12 }),
      })
        .questionTransitions,
    ).toEqual({ improved: 14, regressed: 12 });
  });

  it("recomputes live-delta transitions from the bound final reports", () => {
    expect(() => evaluate({ liveDelta: liveDelta({ improved: 1 }) })).toThrow(
      "live-delta answerTransitions do not match the final report rows",
    );
  });

  it("requires live-delta to come from the bound analyzer process", () => {
    expect(() => evaluate({
      mutateLiveDeltaExecutionReceipt: (receipt) => {
        receipt.exitCode = 1;
      },
    })).toThrow("live-delta process receipt identity is invalid");
  });

  it("rejects incomplete or substituted protected question populations", () => {
    const baseline = finalReport({ arm: "baseline" });
    baseline.cases.pop();
    baseline.questionCount -= 1;
    expect(() => evaluate({ baselineReport: baseline })).toThrow(
      "must contain exactly 233 protected questions",
    );

    const substituted = finalReport({ arm: "candidate" });
    substituted.cases[0]!.questionId = "conv-26:q999";
    expect(() => evaluate({ candidateReport: substituted })).toThrow(
      "question selection does not match the frozen conv-26/30 root",
    );
  });

  it("requires final reanswer lineage to the exact seed report", () => {
    const candidate = finalReport({ arm: "candidate" });
    candidate.sourceReport.path = "/reports/wrong-seed/smoke-report.json";
    expect(() => evaluate({ candidateReport: candidate })).toThrow(
      "candidate final report sourceReport must match its seed report",
    );

    const missingAnswerSystem = finalReport({ arm: "candidate" });
    missingAnswerSystem.answerSystem = "";
    expect(() => evaluate({ candidateReport: missingAnswerSystem })).toThrow(
      "candidate final report answerSystem must match the default reanswer profile",
    );
  });

  it("requires reanswer to preserve seed retrieval evidence", () => {
    const candidate = finalReport({ arm: "candidate" });
    candidate.cases[0]!.evidenceRecall -= 0.1;
    expect(() => evaluate({
      candidateReport: candidate,
      candidateSeedReport: seedReport("candidate"),
    })).toThrow(
      "candidate seed and final retrieval evidence differ",
    );
  });

  it("requires distinct seed, final, and official run ids and paths", () => {
    const invalid = manifest();
    invalid.candidate.execution.officialRunId =
      invalid.baseline.execution.officialRunId;
    invalid.candidate.officialSummaryPath =
      "/worktrees/candidate/reports/eval/research/official-rescore/v073-baseline-official/rescore-summary.json";
    expect(() => evaluate({ manifest: invalid })).toThrow(
      "seed, final, and official runIds must all be unique",
    );

    const sharedSeed = manifest();
    sharedSeed.candidate.seedReportPath = sharedSeed.baseline.seedReportPath;
    expect(() => evaluate({ manifest: sharedSeed })).toThrow(
      "candidate seed and final report paths must match their outputs",
    );
  });

  it("binds command-chain receipts to the preregistered actual argv", () => {
    expect(() => evaluate({
      mutateCandidateExecutionReceipt: (receipt) => {
        receipt.commandChain.reanswer.args.push(
          "--answer-profile",
          "temporal-bounded-v3",
        );
      },
    })).toThrow("candidate command chain does not match the current claim recipe");
  });

  it("mechanically rejects an old chain when the claim recipe changes", () => {
    const changedClaim = CLAIM_SOURCE_RAW.replace(
      " --generalized-fusion",
      " --smart-fusion",
    );
    expect(changedClaim).not.toBe(CLAIM_SOURCE_RAW);
    const invalid = manifest();
    for (const arm of [invalid.baseline, invalid.candidate]) {
      arm.execution.claimSourceSha256 = sha256(changedClaim);
      arm.execution.claimCommandTemplateSha256 =
        deriveV073ClaimCommandTemplateSha256(changedClaim);
    }
    expect(() => evaluate({
      manifest: invalid,
      sourceOverrides: {
        baselineClaim: changedClaim,
        candidateClaim: changedClaim,
      },
    })).toThrow("command chain does not match the current claim recipe");
  });

  it("binds receipts to exact clean worktree HEADs", () => {
    expect(() => evaluate({
      candidateWorktreeProvenance: {
        headCommit: "b".repeat(40),
        statusPorcelain: "",
      },
    })).toThrow("candidate live worktree HEAD must match its manifest commit");

    expect(() => evaluate({
      candidateWorktreeProvenance: {
        headCommit: CANDIDATE_COMMIT,
        statusPorcelain: " M scripts/run-phase-65-locomo-smoke.ts\n",
      },
    })).toThrow("candidate worktree must be clean");
  });

  it("binds seed, reanswer, official, and claim source bytes instead of magic hashes", () => {
    expect(() => evaluate({
      sourceOverrides: { candidateReanswer: `${REANSWER_SOURCE_RAW}\n// drift` },
    })).toThrow("candidate reanswer runner source fingerprint is invalid");
    expect(() => evaluate({
      sourceOverrides: { candidateOfficial: `${OFFICIAL_SOURCE_RAW}\n// drift` },
    })).toThrow("candidate official runner source fingerprint is invalid");

    const invalid = manifest();
    invalid.candidate.execution.promptSha256 = "d".repeat(64);
    expect(() => evaluate({ manifest: invalid })).toThrow(
      "candidate promptSha256 must match the derived default prompt",
    );

    const wrongClaim = manifest();
    wrongClaim.baseline.execution.claimCommandTemplateSha256 = "c".repeat(64);
    wrongClaim.candidate.execution.claimCommandTemplateSha256 = "c".repeat(64);
    expect(() => evaluate({ manifest: wrongClaim })).toThrow(
      "baseline claim command fingerprint is invalid",
    );
  });

  it("binds official judging to final reanswered bytes, never seed bytes", () => {
    expect(() => evaluate({
      mutateCandidateOfficial: (summary) => {
        summary.sourceInputs.reportPath =
          "/reports/v073-candidate-seed/smoke-report.json";
      },
    })).toThrow(
      "candidate official summary sourceInputs.reportPath must match the final report",
    );

    expect(() => evaluate({
      mutateCandidateOfficial: (summary) => {
        summary.judgeModel = ANSWER_MODEL;
      },
    })).toThrow("candidate official summary must use independent gpt-5.5 judging");

    expect(() => evaluate({
      mutateCandidateOfficial: (summary) => {
        summary.judgeGateway = "https://different-judge.example/v1";
      },
    })).toThrow("candidate official summary judge provider identity must match");
  });

  it("reuses the canonical official-summary validator", () => {
    expect(() => evaluate({
      mutateCandidateOfficial: (summary) => {
        summary.generatedBy = "handwritten-summary";
      },
    })).toThrow("malformed official rescore summary");
  });

  it("requires a real successful scenario process receipt and bound logs", () => {
    expect(() => evaluate({
      mutateScenarioExecutionReceipt: (receipt) => {
        receipt.exitCode = 1;
      },
    })).toThrow("scenario replay process must exit successfully");

    expect(() => evaluate({ scenarioStdout: `${SCENARIO_STDOUT}tampered` })).toThrow(
      "scenario stdout fingerprint does not match captured bytes",
    );

    expect(() => evaluate({
      mutateScenarioExecutionReceipt: (receipt) => {
        receipt.candidateCommit = "b".repeat(40);
      },
    })).toThrow("scenario replay receipt candidate commit must match");
  });

  it("rejects hand-entered scenario pass counts that disagree with captured output", () => {
    expect(() => evaluate({
      scenarioReplay: { ...scenarioReplay(), passed: 9 },
    })).toThrow("scenario replay counts do not match captured process output");
  });
});
