// LoCoMo live-delta analyzer. This compares two Phase 65 live-answer smoke
// reports at question granularity so candidate-admission experiments can be
// routed toward retrieval, noise, or answer-policy work before defaulting.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  LOCOMO_F1_PASS_THRESHOLD,
  LOCOMO_QA_CATEGORIES,
  locomoTokenF1,
} from "../src/eval/locomo";
import type {
  LocomoCase,
  LocomoQaCategory,
  LocomoQuestion,
} from "../src/eval/locomo";
import {
  assertDistinctCliPathValues,
  resolveCliFlagValueStrict,
  resolveCliPathSegmentFlagValueStrict,
} from "./cli-options";
import {
  assertLocomoReportHasCompleteLiveAnswers,
  assertLocomoReportHasNoExecutionFailures,
  assertLocomoReportInputsHaveDistinctPaths,
  assertLocomoReportInputsHaveDistinctRunIds,
  assertLocomoReportMetadataCompatible,
  assertLocomoReportQuestionCountMatchesCases,
  LOCOMO_LIVE_DELTA_INVARIANT_METADATA_FIELDS,
} from "./locomo-report-compatibility";
import type { LocomoReanswerJobBucket } from "./locomo-reanswer-contracts";
import {
  loadLocomoCases,
  summarizeLocomoRetrieval,
} from "./run-phase-65-locomo-smoke";
import type {
  LocomoQuestionRetrieval,
  LocomoSmokeReport,
} from "./run-phase-65-locomo-smoke";

export const LOCOMO_LIVE_DELTA_FILE_NAME = "live-delta.json";

const GENERATED_BY = "scripts/analyze-phase-65-locomo-live-delta.ts";
const CLAIM_BOUNDARY =
  "Research diagnostic only; not a public release or benchmark claim.";

type AnswerTransition =
  | "baselineOnlyAnswered"
  | "bothUnanswered"
  | "candidateOnlyAnswered"
  | "improved"
  | "regressed"
  | "sameCorrect"
  | "sameWrong";

type FailureBucket =
  | "correct-or-unanswered"
  | "full-recall-wrong-clean"
  | "full-recall-wrong-noisy"
  | "missing-evidence-wrong";

type RetrievalBucket = "full" | "partial" | "zero";
type RetrievalTransition = `${RetrievalBucket}->${RetrievalBucket}`;

interface ReportInput {
  path: string;
  report: LocomoSmokeReport;
}

interface CliOptions {
  baselineReportPath: string;
  candidateReportPath: string;
  outputPath?: string;
  runId?: string;
}

interface AnswerTransitionCounts {
  baselineOnlyAnswered: number;
  bothUnanswered: number;
  candidateOnlyAnswered: number;
  improved: number;
  regressed: number;
  sameCorrect: number;
  sameWrong: number;
}

interface EffectiveAnswerPolicy {
  commonsenseResolution: boolean;
  strictNoEvidenceAbstention: boolean;
}

interface AnswerChangeAttribution {
  answerContextModeChanged: boolean;
  answerOutcomeChanged: boolean;
  effectiveAnswerPolicyChanged: boolean;
  residualLiveAnswerChange: boolean;
  retrievalMetricsChanged: boolean;
}

interface ReanswerJob {
  bucket: LocomoReanswerJobBucket;
  categories: LocomoQaCategory[];
  category: LocomoQaCategory;
  questionCount: number;
  questionIds: string[];
  sourceReportPath: string;
  sourceRunId: string;
}

interface DeltaAccumulator {
  answerCorrectDelta: number;
  answerContextModeChangedAnswerChangeCount: number;
  answerContextModeChangedCount: number;
  answerContextModeChangedRegressionCount: number;
  answerContextModeUnchangedAnswerChangeCount: number;
  answerContextModeUnchangedCount: number;
  answerContextModeUnchangedRegressionCount: number;
  answerTransitions: AnswerTransitionCounts;
  baselineCorrectCount: number;
  baselineEvidenceRecallTotal: number;
  baselineFullRecallWrongNoisyCount: number;
  baselineFullyRetrievedCount: number;
  baselineMissingEvidenceWrongCount: number;
  baselineNoiseTurnTotal: number;
  candidateCorrectCount: number;
  candidateEvidenceRecallTotal: number;
  candidateFullRecallWrongNoisyCount: number;
  candidateFullyRetrievedCount: number;
  candidateMissingEvidenceWrongCount: number;
  candidateNoiseTurnTotal: number;
  convertedRetrievalGainCount: number;
  effectiveAnswerPolicyChangedAnswerChangeCount: number;
  effectiveAnswerPolicyChangedCount: number;
  effectiveAnswerPolicyChangedRegressionCount: number;
  effectiveAnswerPolicyUnchangedAnswerChangeCount: number;
  effectiveAnswerPolicyUnchangedCount: number;
  effectiveAnswerPolicyUnchangedRegressionCount: number;
  noisyFullRecallRegressionCount: number;
  questionCount: number;
  residualLiveAnswerChangeCount: number;
  retrievalMetricChangedAnswerChangeCount: number;
  retrievalTransitions: Record<RetrievalTransition, number>;
  unconvertedRetrievalGainCount: number;
}

export interface LocomoLiveQuestionDelta {
  answerChangeAttribution: AnswerChangeAttribution;
  answerContextModeChanged: boolean;
  answerTransition: AnswerTransition;
  baseline: LocomoLiveQuestionSide;
  baselineAnswerContextMode: LocomoSmokeReport["answerContextMode"] | null;
  baselineEffectiveAnswerPolicy: EffectiveAnswerPolicy;
  candidate: LocomoLiveQuestionSide;
  candidateAnswerContextMode: LocomoSmokeReport["answerContextMode"] | null;
  candidateEffectiveAnswerPolicy: EffectiveAnswerPolicy;
  caseId: string;
  category: LocomoQaCategory;
  effectiveAnswerPolicyChanged: boolean;
  evidenceRecallDelta: number;
  noiseTurnDelta: number;
  questionId: string;
  retrievalTransition: RetrievalTransition;
}

interface LocomoLiveQuestionSide {
  answerCorrect: boolean | null;
  answerTokenF1: number | null;
  evidenceRecall: number;
  generatedAnswer: string | null;
  goldEvidenceFullyRetrieved: boolean;
  missingEvidenceTurnCount: number;
  noiseTurnCount: number;
}

export interface LocomoLiveDeltaSummary {
  answerContextModeChangedAnswerChangeCount: number;
  answerContextModeChangedCount: number;
  answerContextModeChangedRegressionCount: number;
  answerContextModeUnchangedAnswerChangeCount: number;
  answerContextModeUnchangedCount: number;
  answerContextModeUnchangedRegressionCount: number;
  answerCorrectDelta: number;
  answerTransitions: AnswerTransitionCounts;
  averageEvidenceRecallDelta: number;
  baselineCorrectCount: number;
  baselineFullyRetrievedCount: number;
  candidateCorrectCount: number;
  candidateFullyRetrievedCount: number;
  convertedRetrievalGainCount: number;
  effectiveAnswerPolicyChangedAnswerChangeCount: number;
  effectiveAnswerPolicyChangedCount: number;
  effectiveAnswerPolicyChangedRegressionCount: number;
  effectiveAnswerPolicyUnchangedAnswerChangeCount: number;
  effectiveAnswerPolicyUnchangedCount: number;
  effectiveAnswerPolicyUnchangedRegressionCount: number;
  fullyRetrievedDelta: number;
  fullRecallWrongNoisyDelta: number;
  missingEvidenceWrongDelta: number;
  noiseTurnDelta: number;
  noisyFullRecallRegressionCount: number;
  questionCount: number;
  residualLiveAnswerChangeCount: number;
  retrievalMetricChangedAnswerChangeCount: number;
  retrievalTransitions: Record<RetrievalTransition, number>;
  unconvertedRetrievalGainCount: number;
}

export interface LocomoLiveDeltaAnalysis {
  answerImprovements: LocomoLiveQuestionDelta[];
  answerRegressions: LocomoLiveQuestionDelta[];
  answerTokenF1NearMisses: LocomoLiveQuestionDelta[];
  baselineReport: { path: string; runId: string };
  benchmark: "locomo";
  candidateReport: { path: string; runId: string };
  categories: Partial<Record<LocomoQaCategory, LocomoLiveDeltaSummary>>;
  claimBoundary: string;
  generatedAt: string;
  generatedBy: string;
  mode: LocomoSmokeReport["mode"];
  outputPath: string | null;
  overall: LocomoLiveDeltaSummary;
  phase: "phase-65";
  reanswerJobs: ReanswerJob[];
  runId: string;
  sourceReports: Array<{
    path: string;
    questionCount: number;
    runId: string;
  }>;
  topNoisyFullRecallWrong: LocomoLiveQuestionDelta[];
  topUnconvertedRetrievalGains: LocomoLiveQuestionDelta[];
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const baselineReportPath = resolveCliFlagValueStrict(argv, "--baseline-report");
  const candidateReportPath = resolveCliFlagValueStrict(argv, "--candidate-report");
  if (!baselineReportPath) {
    throw new Error("LoCoMo live-delta analysis requires --baseline-report.");
  }
  if (!candidateReportPath) {
    throw new Error("LoCoMo live-delta analysis requires --candidate-report.");
  }
  assertDistinctCliPathValues({
    firstFlag: "--baseline-report",
    firstValue: baselineReportPath,
    secondFlag: "--candidate-report",
    secondValue: candidateReportPath,
  });
  const outputPath = resolveCliFlagValueStrict(argv, "--output-path");
  if (outputPath) {
    assertDistinctCliPathValues({
      firstFlag: "--output-path",
      firstValue: outputPath,
      secondFlag: "--baseline-report",
      secondValue: baselineReportPath,
    });
    assertDistinctCliPathValues({
      firstFlag: "--output-path",
      firstValue: outputPath,
      secondFlag: "--candidate-report",
      secondValue: candidateReportPath,
    });
  }
  return {
    baselineReportPath,
    candidateReportPath,
    outputPath,
    runId: resolveCliPathSegmentFlagValueStrict(argv, "--run-id"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSmokeReport(
  report: unknown,
  path: string,
): asserts report is LocomoSmokeReport {
  if (!isRecord(report)) {
    throw new Error(`Report ${path} must be a JSON object.`);
  }
  if (report.phase !== "phase-65" || report.benchmark !== "locomo") {
    throw new Error(`Report ${path} is not a Phase 65 LoCoMo smoke report.`);
  }
  if (!Array.isArray(report.cases)) {
    throw new Error(`Report ${path} must include cases[].`);
  }
}

function emptyAnswerTransitions(): AnswerTransitionCounts {
  return {
    baselineOnlyAnswered: 0,
    bothUnanswered: 0,
    candidateOnlyAnswered: 0,
    improved: 0,
    regressed: 0,
    sameCorrect: 0,
    sameWrong: 0,
  };
}

function emptyRetrievalTransitions(): Record<RetrievalTransition, number> {
  return {
    "full->full": 0,
    "full->partial": 0,
    "full->zero": 0,
    "partial->full": 0,
    "partial->partial": 0,
    "partial->zero": 0,
    "zero->full": 0,
    "zero->partial": 0,
    "zero->zero": 0,
  };
}

function emptyAccumulator(): DeltaAccumulator {
  return {
    answerCorrectDelta: 0,
    answerContextModeChangedAnswerChangeCount: 0,
    answerContextModeChangedCount: 0,
    answerContextModeChangedRegressionCount: 0,
    answerContextModeUnchangedAnswerChangeCount: 0,
    answerContextModeUnchangedCount: 0,
    answerContextModeUnchangedRegressionCount: 0,
    answerTransitions: emptyAnswerTransitions(),
    baselineCorrectCount: 0,
    baselineEvidenceRecallTotal: 0,
    baselineFullRecallWrongNoisyCount: 0,
    baselineFullyRetrievedCount: 0,
    baselineMissingEvidenceWrongCount: 0,
    baselineNoiseTurnTotal: 0,
    candidateCorrectCount: 0,
    candidateEvidenceRecallTotal: 0,
    candidateFullRecallWrongNoisyCount: 0,
    candidateFullyRetrievedCount: 0,
    candidateMissingEvidenceWrongCount: 0,
    candidateNoiseTurnTotal: 0,
    convertedRetrievalGainCount: 0,
    effectiveAnswerPolicyChangedAnswerChangeCount: 0,
    effectiveAnswerPolicyChangedCount: 0,
    effectiveAnswerPolicyChangedRegressionCount: 0,
    effectiveAnswerPolicyUnchangedAnswerChangeCount: 0,
    effectiveAnswerPolicyUnchangedCount: 0,
    effectiveAnswerPolicyUnchangedRegressionCount: 0,
    noisyFullRecallRegressionCount: 0,
    questionCount: 0,
    residualLiveAnswerChangeCount: 0,
    retrievalMetricChangedAnswerChangeCount: 0,
    retrievalTransitions: emptyRetrievalTransitions(),
    unconvertedRetrievalGainCount: 0,
  };
}

function divideOrZero(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function questionLookupKey(input: { caseId: string; questionId: string }): string {
  return `${input.caseId}::${input.questionId}`;
}

function questionKey(question: LocomoQuestionRetrieval): string {
  return questionLookupKey(question);
}

function isReanswerSubsetComparison(input: {
  baseline: ReportInput;
  candidate: ReportInput;
}): boolean {
  const sourceReport = input.candidate.report.sourceReport;
  return (
    input.candidate.report.generatedBy ===
      "scripts/reanswer-phase-65-locomo-report.ts" &&
    sourceReport !== undefined &&
    sourceReport.runId === input.baseline.report.runId &&
    resolve(sourceReport.path) === resolve(input.baseline.path)
  );
}

function filteredBaselineForReanswerSubset(input: {
  baseline: ReportInput;
  candidate: ReportInput;
}): ReportInput {
  const candidateKeys = new Set<string>();
  for (const question of input.candidate.report.cases) {
    const key = questionKey(question);
    if (candidateKeys.has(key)) {
      throw new Error(
        `Candidate report ${input.candidate.path} contains duplicate question ${key}.`,
      );
    }
    candidateKeys.add(key);
  }

  const filteredCases = input.baseline.report.cases.filter((question) =>
    candidateKeys.has(questionKey(question)),
  );
  if (filteredCases.length !== candidateKeys.size) {
    const foundKeys = new Set(filteredCases.map(questionKey));
    const missingKeys = [...candidateKeys].filter((key) => !foundKeys.has(key));
    throw new Error(
      `Baseline report ${input.baseline.path} is missing reanswer subset ` +
        `question(s): ${missingKeys.join(", ")}.`,
    );
  }

  const questionIds =
    input.candidate.report.questionIds === undefined ||
    input.candidate.report.questionIds === null
      ? null
      : [...input.candidate.report.questionIds];
  const questionSelection =
    input.baseline.report.questionSelection === undefined
      ? undefined
      : {
          ...input.baseline.report.questionSelection,
          explicitQuestionIds:
            input.baseline.report.questionSelection.explicitQuestionIds === null
              ? null
              : input.baseline.report.questionSelection.explicitQuestionIds.filter(
                  (questionId) =>
                    questionIds === null ? false : questionIds.includes(questionId),
                ),
        };

  return {
    path: input.baseline.path,
    report: {
      ...input.baseline.report,
      caseCount: input.candidate.report.caseCount,
      caseIds: [...input.candidate.report.caseIds],
      cases: filteredCases,
      categories: summarizeLocomoRetrieval(filteredCases),
      questionCategories:
        input.candidate.report.questionCategories === null
          ? null
          : [...input.candidate.report.questionCategories],
      questionCount: input.candidate.report.questionCount,
      questionIds,
      ...(questionSelection === undefined ? {} : { questionSelection }),
    },
  };
}

function normalizeLiveDeltaReportInputs(input: {
  baseline: ReportInput;
  candidate: ReportInput;
}): { baseline: ReportInput; candidate: ReportInput } {
  if (!isReanswerSubsetComparison(input)) {
    return input;
  }
  return {
    baseline: filteredBaselineForReanswerSubset(input),
    candidate: input.candidate,
  };
}

function retrievalBucket(question: LocomoQuestionRetrieval): RetrievalBucket {
  if (question.evidenceRecall <= 0) {
    return "zero";
  }
  if (question.goldEvidenceFullyRetrieved || question.evidenceRecall >= 1) {
    return "full";
  }
  return "partial";
}

function failureBucket(question: LocomoQuestionRetrieval): FailureBucket {
  if (question.answerCorrect !== false) {
    return "correct-or-unanswered";
  }
  if (!question.goldEvidenceFullyRetrieved) {
    return "missing-evidence-wrong";
  }
  if (question.noiseTurnCount > 0) {
    return "full-recall-wrong-noisy";
  }
  return "full-recall-wrong-clean";
}

function answerTransition(input: {
  baseline: LocomoQuestionRetrieval;
  candidate: LocomoQuestionRetrieval;
}): AnswerTransition {
  const { baseline, candidate } = input;
  if (baseline.answerCorrect === null && candidate.answerCorrect === null) {
    return "bothUnanswered";
  }
  if (baseline.answerCorrect === null) {
    return "candidateOnlyAnswered";
  }
  if (candidate.answerCorrect === null) {
    return "baselineOnlyAnswered";
  }
  if (!baseline.answerCorrect && candidate.answerCorrect) {
    return "improved";
  }
  if (baseline.answerCorrect && !candidate.answerCorrect) {
    return "regressed";
  }
  return baseline.answerCorrect ? "sameCorrect" : "sameWrong";
}

function side(question: LocomoQuestionRetrieval): LocomoLiveQuestionSide {
  return {
    answerCorrect: question.answerCorrect,
    answerTokenF1: question.answerTokenF1 ?? null,
    evidenceRecall: question.evidenceRecall,
    generatedAnswer: question.generatedAnswer,
    goldEvidenceFullyRetrieved: question.goldEvidenceFullyRetrieved,
    missingEvidenceTurnCount: question.missingEvidenceTurnIds.length,
    noiseTurnCount: question.noiseTurnCount,
  };
}

function effectiveAnswerPolicy(
  report: LocomoSmokeReport,
  category: LocomoQaCategory,
): EffectiveAnswerPolicy {
  return {
    commonsenseResolution:
      (report.allowCommonsenseResolution ?? false) && category === "open_domain",
    strictNoEvidenceAbstention:
      (report.strictNoEvidenceAbstention ?? false) && category === "adversarial",
  };
}

function sameEffectiveAnswerPolicy(
  left: EffectiveAnswerPolicy,
  right: EffectiveAnswerPolicy,
): boolean {
  return (
    left.commonsenseResolution === right.commonsenseResolution &&
    left.strictNoEvidenceAbstention === right.strictNoEvidenceAbstention
  );
}

function buildAnswerChangeAttribution(input: {
  answerContextModeChanged: boolean;
  answerTransition: AnswerTransition;
  effectiveAnswerPolicyChanged: boolean;
  evidenceRecallDelta: number;
  noiseTurnDelta: number;
  retrievalTransition: RetrievalTransition;
}): AnswerChangeAttribution {
  const answerOutcomeChanged =
    input.answerTransition !== "sameCorrect" &&
    input.answerTransition !== "sameWrong" &&
    input.answerTransition !== "bothUnanswered";
  const [baselineRetrievalBucket, candidateRetrievalBucket] =
    input.retrievalTransition.split("->");
  const retrievalMetricsChanged =
    input.evidenceRecallDelta !== 0 ||
    input.noiseTurnDelta !== 0 ||
    baselineRetrievalBucket !== candidateRetrievalBucket;
  return {
    answerContextModeChanged: input.answerContextModeChanged,
    answerOutcomeChanged,
    effectiveAnswerPolicyChanged: input.effectiveAnswerPolicyChanged,
    residualLiveAnswerChange:
      answerOutcomeChanged &&
      !input.answerContextModeChanged &&
      !input.effectiveAnswerPolicyChanged &&
      !retrievalMetricsChanged,
    retrievalMetricsChanged,
  };
}

function questionDelta(input: {
  baseline: LocomoQuestionRetrieval;
  baselineReport: LocomoSmokeReport;
  candidate: LocomoQuestionRetrieval;
  candidateReport: LocomoSmokeReport;
}): LocomoLiveQuestionDelta {
  const baselineBucket = retrievalBucket(input.baseline);
  const candidateBucket = retrievalBucket(input.candidate);
  const baselinePolicy = effectiveAnswerPolicy(
    input.baselineReport,
    input.baseline.category,
  );
  const candidatePolicy = effectiveAnswerPolicy(
    input.candidateReport,
    input.candidate.category,
  );
  const baselineAnswerContextMode = input.baselineReport.answerContextMode ?? null;
  const candidateAnswerContextMode =
    input.candidateReport.answerContextMode ?? null;
  const answerContextModeChanged =
    baselineAnswerContextMode !== candidateAnswerContextMode;
  const effectiveAnswerPolicyChanged = !sameEffectiveAnswerPolicy(
    baselinePolicy,
    candidatePolicy,
  );
  const evidenceRecallDelta =
    input.candidate.evidenceRecall - input.baseline.evidenceRecall;
  const noiseTurnDelta =
    input.candidate.noiseTurnCount - input.baseline.noiseTurnCount;
  const retrievalTransition =
    `${baselineBucket}->${candidateBucket}` as RetrievalTransition;
  const transition = answerTransition(input);
  return {
    answerChangeAttribution: buildAnswerChangeAttribution({
      answerContextModeChanged,
      answerTransition: transition,
      effectiveAnswerPolicyChanged,
      evidenceRecallDelta,
      noiseTurnDelta,
      retrievalTransition,
    }),
    answerContextModeChanged,
    answerTransition: transition,
    baseline: side(input.baseline),
    baselineAnswerContextMode,
    baselineEffectiveAnswerPolicy: baselinePolicy,
    candidate: side(input.candidate),
    candidateAnswerContextMode,
    candidateEffectiveAnswerPolicy: candidatePolicy,
    caseId: input.baseline.caseId,
    category: input.baseline.category,
    effectiveAnswerPolicyChanged,
    evidenceRecallDelta,
    noiseTurnDelta,
    questionId: input.baseline.questionId,
    retrievalTransition,
  };
}

function addQuestionDelta(
  acc: DeltaAccumulator,
  delta: LocomoLiveQuestionDelta,
): void {
  acc.questionCount += 1;
  acc.baselineEvidenceRecallTotal += delta.baseline.evidenceRecall;
  acc.candidateEvidenceRecallTotal += delta.candidate.evidenceRecall;
  acc.baselineNoiseTurnTotal += delta.baseline.noiseTurnCount;
  acc.candidateNoiseTurnTotal += delta.candidate.noiseTurnCount;
  if (delta.baseline.answerCorrect === true) {
    acc.baselineCorrectCount += 1;
  }
  if (delta.candidate.answerCorrect === true) {
    acc.candidateCorrectCount += 1;
  }
  if (delta.baseline.goldEvidenceFullyRetrieved) {
    acc.baselineFullyRetrievedCount += 1;
  }
  if (delta.candidate.goldEvidenceFullyRetrieved) {
    acc.candidateFullyRetrievedCount += 1;
  }
  if (delta.baseline.answerCorrect !== delta.candidate.answerCorrect) {
    acc.answerCorrectDelta +=
      (delta.candidate.answerCorrect === true ? 1 : 0) -
      (delta.baseline.answerCorrect === true ? 1 : 0);
  }
  if (delta.answerChangeAttribution.answerOutcomeChanged) {
    if (delta.answerChangeAttribution.answerContextModeChanged) {
      acc.answerContextModeChangedAnswerChangeCount += 1;
    } else {
      acc.answerContextModeUnchangedAnswerChangeCount += 1;
    }
    if (delta.answerChangeAttribution.effectiveAnswerPolicyChanged) {
      acc.effectiveAnswerPolicyChangedAnswerChangeCount += 1;
    } else {
      acc.effectiveAnswerPolicyUnchangedAnswerChangeCount += 1;
    }
    if (delta.answerChangeAttribution.retrievalMetricsChanged) {
      acc.retrievalMetricChangedAnswerChangeCount += 1;
    }
    if (delta.answerChangeAttribution.residualLiveAnswerChange) {
      acc.residualLiveAnswerChangeCount += 1;
    }
  }
  acc.answerTransitions[delta.answerTransition] += 1;
  acc.retrievalTransitions[delta.retrievalTransition] += 1;
  if (delta.answerContextModeChanged) {
    acc.answerContextModeChangedCount += 1;
    if (delta.answerTransition === "regressed") {
      acc.answerContextModeChangedRegressionCount += 1;
    }
  } else {
    acc.answerContextModeUnchangedCount += 1;
    if (delta.answerTransition === "regressed") {
      acc.answerContextModeUnchangedRegressionCount += 1;
    }
  }
  if (delta.effectiveAnswerPolicyChanged) {
    acc.effectiveAnswerPolicyChangedCount += 1;
    if (delta.answerTransition === "regressed") {
      acc.effectiveAnswerPolicyChangedRegressionCount += 1;
    }
  } else {
    acc.effectiveAnswerPolicyUnchangedCount += 1;
    if (delta.answerTransition === "regressed") {
      acc.effectiveAnswerPolicyUnchangedRegressionCount += 1;
    }
  }

  if (delta.evidenceRecallDelta > 0 && delta.candidate.answerCorrect === false) {
    acc.unconvertedRetrievalGainCount += 1;
  }
  if (
    delta.evidenceRecallDelta > 0 &&
    delta.baseline.answerCorrect !== true &&
    delta.candidate.answerCorrect === true
  ) {
    acc.convertedRetrievalGainCount += 1;
  }
  if (
    delta.answerTransition === "regressed" &&
    delta.candidate.goldEvidenceFullyRetrieved &&
    delta.candidate.noiseTurnCount > 0
  ) {
    acc.noisyFullRecallRegressionCount += 1;
  }

  if (delta.baseline.answerCorrect === false) {
    const bucket = failureBucketFromSide(delta.baseline);
    if (bucket === "missing-evidence-wrong") {
      acc.baselineMissingEvidenceWrongCount += 1;
    } else if (bucket === "full-recall-wrong-noisy") {
      acc.baselineFullRecallWrongNoisyCount += 1;
    }
  }
  if (delta.candidate.answerCorrect === false) {
    const bucket = failureBucketFromSide(delta.candidate);
    if (bucket === "missing-evidence-wrong") {
      acc.candidateMissingEvidenceWrongCount += 1;
    } else if (bucket === "full-recall-wrong-noisy") {
      acc.candidateFullRecallWrongNoisyCount += 1;
    }
  }
}

function failureBucketFromSide(sideValue: LocomoLiveQuestionSide): FailureBucket {
  if (sideValue.answerCorrect !== false) {
    return "correct-or-unanswered";
  }
  if (!sideValue.goldEvidenceFullyRetrieved) {
    return "missing-evidence-wrong";
  }
  if (sideValue.noiseTurnCount > 0) {
    return "full-recall-wrong-noisy";
  }
  return "full-recall-wrong-clean";
}

function summarizeAccumulator(acc: DeltaAccumulator): LocomoLiveDeltaSummary {
  return {
    answerContextModeChangedAnswerChangeCount:
      acc.answerContextModeChangedAnswerChangeCount,
    answerContextModeChangedCount: acc.answerContextModeChangedCount,
    answerContextModeChangedRegressionCount:
      acc.answerContextModeChangedRegressionCount,
    answerContextModeUnchangedAnswerChangeCount:
      acc.answerContextModeUnchangedAnswerChangeCount,
    answerContextModeUnchangedCount: acc.answerContextModeUnchangedCount,
    answerContextModeUnchangedRegressionCount:
      acc.answerContextModeUnchangedRegressionCount,
    answerCorrectDelta: acc.candidateCorrectCount - acc.baselineCorrectCount,
    answerTransitions: { ...acc.answerTransitions },
    averageEvidenceRecallDelta:
      divideOrZero(acc.candidateEvidenceRecallTotal, acc.questionCount) -
      divideOrZero(acc.baselineEvidenceRecallTotal, acc.questionCount),
    baselineCorrectCount: acc.baselineCorrectCount,
    baselineFullyRetrievedCount: acc.baselineFullyRetrievedCount,
    candidateCorrectCount: acc.candidateCorrectCount,
    candidateFullyRetrievedCount: acc.candidateFullyRetrievedCount,
    convertedRetrievalGainCount: acc.convertedRetrievalGainCount,
    effectiveAnswerPolicyChangedAnswerChangeCount:
      acc.effectiveAnswerPolicyChangedAnswerChangeCount,
    effectiveAnswerPolicyChangedCount: acc.effectiveAnswerPolicyChangedCount,
    effectiveAnswerPolicyChangedRegressionCount:
      acc.effectiveAnswerPolicyChangedRegressionCount,
    effectiveAnswerPolicyUnchangedAnswerChangeCount:
      acc.effectiveAnswerPolicyUnchangedAnswerChangeCount,
    effectiveAnswerPolicyUnchangedCount: acc.effectiveAnswerPolicyUnchangedCount,
    effectiveAnswerPolicyUnchangedRegressionCount:
      acc.effectiveAnswerPolicyUnchangedRegressionCount,
    fullyRetrievedDelta:
      acc.candidateFullyRetrievedCount - acc.baselineFullyRetrievedCount,
    fullRecallWrongNoisyDelta:
      acc.candidateFullRecallWrongNoisyCount -
      acc.baselineFullRecallWrongNoisyCount,
    missingEvidenceWrongDelta:
      acc.candidateMissingEvidenceWrongCount -
      acc.baselineMissingEvidenceWrongCount,
    noiseTurnDelta: acc.candidateNoiseTurnTotal - acc.baselineNoiseTurnTotal,
    noisyFullRecallRegressionCount: acc.noisyFullRecallRegressionCount,
    questionCount: acc.questionCount,
    residualLiveAnswerChangeCount: acc.residualLiveAnswerChangeCount,
    retrievalMetricChangedAnswerChangeCount:
      acc.retrievalMetricChangedAnswerChangeCount,
    retrievalTransitions: { ...acc.retrievalTransitions },
    unconvertedRetrievalGainCount: acc.unconvertedRetrievalGainCount,
  };
}

function validateCompatibleReports(input: {
  baseline: ReportInput;
  candidate: ReportInput;
}): void {
  const { baseline, candidate } = input;
  assertLocomoReportInputsHaveDistinctPaths(input);
  assertLocomoReportInputsHaveDistinctRunIds(input);
  if (baseline.report.mode !== "live-answer") {
    throw new Error(
      `Baseline report ${baseline.path} must be a live-answer report.`,
    );
  }
  if (candidate.report.mode !== "live-answer") {
    throw new Error(
      `Candidate report ${candidate.path} must be a live-answer report.`,
    );
  }
  if (baseline.report.answerEvaluation !== "scored") {
    throw new Error(`Baseline report ${baseline.path} must be scored.`);
  }
  if (candidate.report.answerEvaluation !== "scored") {
    throw new Error(`Candidate report ${candidate.path} must be scored.`);
  }
  assertLocomoReportMetadataCompatible({
    candidate,
    fields: LOCOMO_LIVE_DELTA_INVARIANT_METADATA_FIELDS,
    reference: baseline,
  });
  assertLocomoReportHasNoExecutionFailures(baseline);
  assertLocomoReportHasNoExecutionFailures(candidate);
  assertLocomoReportQuestionCountMatchesCases(baseline);
  assertLocomoReportQuestionCountMatchesCases(candidate);
  assertLocomoReportHasCompleteLiveAnswers(baseline);
  assertLocomoReportHasCompleteLiveAnswers(candidate);
}

function reportNeedsAnswerTokenF1Backfill(report: LocomoSmokeReport): boolean {
  return (
    report.mode === "live-answer" &&
    report.cases.some(
      (question) =>
        question.generatedAnswer !== null && question.answerTokenF1 == null,
    )
  );
}

function resolveBackfillBenchmarkRoot(input: ReportInput): string | undefined {
  if (input.report.externalRoot !== null) {
    return input.report.externalRoot;
  }
  if (input.report.benchmarkSource === "synthetic-smoke") {
    return undefined;
  }
  throw new Error(
    `Report ${input.path} (${input.report.runId}) is missing externalRoot; ` +
      "cannot backfill answerTokenF1 from benchmarkSource.",
  );
}

function buildLocomoQuestionMap(
  cases: readonly LocomoCase[],
): Map<string, LocomoQuestion> {
  const questions = new Map<string, LocomoQuestion>();
  for (const testCase of cases) {
    for (const question of testCase.questions) {
      const key = questionLookupKey({
        caseId: testCase.caseId,
        questionId: question.questionId,
      });
      if (questions.has(key)) {
        throw new Error(
          `LoCoMo benchmark source contains duplicate question ${key}.`,
        );
      }
      questions.set(key, question);
    }
  }
  return questions;
}

function backfillReportAnswerTokenF1(input: {
  path: string;
  questionsByKey: ReadonlyMap<string, LocomoQuestion>;
  report: LocomoSmokeReport;
}): LocomoSmokeReport {
  if (!reportNeedsAnswerTokenF1Backfill(input.report)) {
    return input.report;
  }
  return {
    ...input.report,
    cases: input.report.cases.map((question) => {
      if (question.generatedAnswer === null || question.answerTokenF1 != null) {
        return question;
      }
      const benchmarkQuestion = input.questionsByKey.get(questionKey(question));
      if (!benchmarkQuestion) {
        throw new Error(
          `Report ${input.path} (${input.report.runId}) cannot backfill ` +
            `answerTokenF1 for ${questionKey(question)}; benchmarkSource ` +
            `${input.report.benchmarkSource} does not contain that question.`,
        );
      }
      if (benchmarkQuestion.category !== question.category) {
        throw new Error(
          `Report ${input.path} (${input.report.runId}) cannot backfill ` +
            `answerTokenF1 for ${questionKey(question)}; report category ` +
            `${question.category} does not match benchmarkSource category ` +
            `${benchmarkQuestion.category}.`,
        );
      }
      return {
        ...question,
        answerTokenF1: locomoTokenF1(
          question.generatedAnswer,
          benchmarkQuestion.goldAnswer,
        ),
      };
    }),
  };
}

async function backfillReportsAnswerTokenF1(input: {
  baseline: ReportInput;
  candidate: ReportInput;
  outputPath?: string;
  readFile: (path: string) => Promise<string>;
}): Promise<{ baseline: ReportInput; candidate: ReportInput }> {
  const normalizedInput = normalizeLiveDeltaReportInputs(input);
  if (
    !reportNeedsAnswerTokenF1Backfill(normalizedInput.baseline.report) &&
    !reportNeedsAnswerTokenF1Backfill(normalizedInput.candidate.report)
  ) {
    return normalizedInput;
  }

  validateCompatibleReports(normalizedInput);
  const benchmarkRoot = resolveBackfillBenchmarkRoot(normalizedInput.candidate);
  if (input.outputPath !== undefined && benchmarkRoot !== undefined) {
    assertDistinctCliPathValues({
      firstFlag: "--output-path",
      firstValue: input.outputPath,
      secondFlag: "live-delta benchmark cases",
      secondValue: join(benchmarkRoot, "cases.json"),
    });
  }
  const loaded = await loadLocomoCases({
    ...(benchmarkRoot === undefined ? {} : { benchmarkRoot }),
    readFile: input.readFile,
  });
  const questionsByKey = buildLocomoQuestionMap(loaded.cases);
  return {
    baseline: {
      ...normalizedInput.baseline,
      report: backfillReportAnswerTokenF1({
        path: normalizedInput.baseline.path,
        questionsByKey,
        report: normalizedInput.baseline.report,
      }),
    },
    candidate: {
      ...normalizedInput.candidate,
      report: backfillReportAnswerTokenF1({
        path: normalizedInput.candidate.path,
        questionsByKey,
        report: normalizedInput.candidate.report,
      }),
    },
  };
}

function questionMap(
  report: LocomoSmokeReport,
): Map<string, LocomoQuestionRetrieval> {
  return new Map(report.cases.map((question) => [questionKey(question), question]));
}

function buildQuestionDeltas(input: {
  baseline: ReportInput;
  candidate: ReportInput;
}): LocomoLiveQuestionDelta[] {
  const baselineByQuestion = questionMap(input.baseline.report);
  const candidateByQuestion = questionMap(input.candidate.report);
  const deltas: LocomoLiveQuestionDelta[] = [];

  for (const [key, baselineQuestion] of baselineByQuestion) {
    const candidateQuestion = candidateByQuestion.get(key);
    if (!candidateQuestion) {
      throw new Error(`Candidate report is missing question ${key}.`);
    }
    if (baselineQuestion.category !== candidateQuestion.category) {
      throw new Error(
        `Question ${key} category mismatch: baseline=${baselineQuestion.category}, ` +
          `candidate=${candidateQuestion.category}.`,
      );
    }
    deltas.push(
      questionDelta({
        baseline: baselineQuestion,
        baselineReport: input.baseline.report,
        candidate: candidateQuestion,
        candidateReport: input.candidate.report,
      }),
    );
  }

  for (const key of candidateByQuestion.keys()) {
    if (!baselineByQuestion.has(key)) {
      throw new Error(`Baseline report is missing question ${key}.`);
    }
  }

  return deltas.sort((left, right) =>
    `${left.caseId}:${left.questionId}`.localeCompare(
      `${right.caseId}:${right.questionId}`,
    ),
  );
}

function addToAccumulators(input: {
  categories: Map<LocomoQaCategory, DeltaAccumulator>;
  delta: LocomoLiveQuestionDelta;
  overall: DeltaAccumulator;
}): void {
  addQuestionDelta(input.overall, input.delta);
  let categoryAcc = input.categories.get(input.delta.category);
  if (!categoryAcc) {
    categoryAcc = emptyAccumulator();
    input.categories.set(input.delta.category, categoryAcc);
  }
  addQuestionDelta(categoryAcc, input.delta);
}

function byEvidenceGainThenNoise(
  left: LocomoLiveQuestionDelta,
  right: LocomoLiveQuestionDelta,
): number {
  if (right.evidenceRecallDelta !== left.evidenceRecallDelta) {
    return right.evidenceRecallDelta - left.evidenceRecallDelta;
  }
  if (right.noiseTurnDelta !== left.noiseTurnDelta) {
    return right.noiseTurnDelta - left.noiseTurnDelta;
  }
  return `${left.caseId}:${left.questionId}`.localeCompare(
    `${right.caseId}:${right.questionId}`,
  );
}

function byCandidateNoiseThenDelta(
  left: LocomoLiveQuestionDelta,
  right: LocomoLiveQuestionDelta,
): number {
  if (right.candidate.noiseTurnCount !== left.candidate.noiseTurnCount) {
    return right.candidate.noiseTurnCount - left.candidate.noiseTurnCount;
  }
  if (right.noiseTurnDelta !== left.noiseTurnDelta) {
    return right.noiseTurnDelta - left.noiseTurnDelta;
  }
  if (right.evidenceRecallDelta !== left.evidenceRecallDelta) {
    return right.evidenceRecallDelta - left.evidenceRecallDelta;
  }
  return `${left.caseId}:${left.questionId}`.localeCompare(
    `${right.caseId}:${right.questionId}`,
  );
}

function byCandidateAnswerTokenF1ThenRecall(
  left: LocomoLiveQuestionDelta,
  right: LocomoLiveQuestionDelta,
): number {
  const leftF1 = left.candidate.answerTokenF1 ?? -1;
  const rightF1 = right.candidate.answerTokenF1 ?? -1;
  if (rightF1 !== leftF1) {
    return rightF1 - leftF1;
  }
  if (right.candidate.evidenceRecall !== left.candidate.evidenceRecall) {
    return right.candidate.evidenceRecall - left.candidate.evidenceRecall;
  }
  if (left.candidate.noiseTurnCount !== right.candidate.noiseTurnCount) {
    return left.candidate.noiseTurnCount - right.candidate.noiseTurnCount;
  }
  return `${left.caseId}:${left.questionId}`.localeCompare(
    `${right.caseId}:${right.questionId}`,
  );
}

function isAnswerTokenF1NearMiss(delta: LocomoLiveQuestionDelta): boolean {
  const answerTokenF1 = delta.candidate.answerTokenF1;
  return (
    delta.category !== "adversarial" &&
    delta.candidate.answerCorrect === false &&
    answerTokenF1 !== null &&
    answerTokenF1 > 0 &&
    answerTokenF1 < LOCOMO_F1_PASS_THRESHOLD
  );
}

function defaultOutputPath(candidateReportPath: string, runId: string): string {
  return join(dirname(candidateReportPath), "..", runId, LOCOMO_LIVE_DELTA_FILE_NAME);
}

function buildReanswerJob(input: {
  bucket: LocomoReanswerJobBucket;
  category: LocomoQaCategory;
  deltas: readonly LocomoLiveQuestionDelta[];
  sourceReportPath: string;
  sourceRunId: string;
}): ReanswerJob | null {
  if (input.deltas.length === 0) {
    return null;
  }
  const questionIds = input.deltas.map((delta) => delta.questionId);
  return {
    bucket: input.bucket,
    categories: [input.category],
    category: input.category,
    questionCount: questionIds.length,
    questionIds,
    sourceReportPath: input.sourceReportPath,
    sourceRunId: input.sourceRunId,
  };
}

function buildReanswerJobsForBucket(input: {
  bucket: LocomoReanswerJobBucket;
  deltas: readonly LocomoLiveQuestionDelta[];
  selectedQuestionKeys: Set<string>;
  sourceReportPath: string;
  sourceRunId: string;
}): ReanswerJob[] {
  return LOCOMO_QA_CATEGORIES.flatMap((category) => {
    const categoryDeltas: LocomoLiveQuestionDelta[] = [];
    for (const delta of input.deltas) {
      if (delta.category !== category) {
        continue;
      }
      const key = `${delta.caseId}::${delta.questionId}`;
      if (input.selectedQuestionKeys.has(key)) {
        continue;
      }
      input.selectedQuestionKeys.add(key);
      categoryDeltas.push(delta);
    }
    const job = buildReanswerJob({
      bucket: input.bucket,
      category,
      deltas: categoryDeltas,
      sourceReportPath: input.sourceReportPath,
      sourceRunId: input.sourceRunId,
    });
    return job === null ? [] : [job];
  });
}

function buildReanswerJobs(input: {
  answerImprovements: readonly LocomoLiveQuestionDelta[];
  answerRegressions: readonly LocomoLiveQuestionDelta[];
  answerTokenF1NearMisses: readonly LocomoLiveQuestionDelta[];
  candidate: ReportInput;
  residualLiveAnswerChanges: readonly LocomoLiveQuestionDelta[];
  topNoisyFullRecallWrong: readonly LocomoLiveQuestionDelta[];
  topUnconvertedRetrievalGains: readonly LocomoLiveQuestionDelta[];
}): ReanswerJob[] {
  const selectedQuestionKeys = new Set<string>();
  return [
    ...buildReanswerJobsForBucket({
      bucket: "noisyFullRecallWrong",
      deltas: input.topNoisyFullRecallWrong,
      selectedQuestionKeys,
      sourceReportPath: input.candidate.path,
      sourceRunId: input.candidate.report.runId,
    }),
    ...buildReanswerJobsForBucket({
      bucket: "answerTokenF1NearMiss",
      deltas: input.answerTokenF1NearMisses,
      selectedQuestionKeys,
      sourceReportPath: input.candidate.path,
      sourceRunId: input.candidate.report.runId,
    }),
    ...buildReanswerJobsForBucket({
      bucket: "answerRegressions",
      deltas: input.answerRegressions,
      selectedQuestionKeys,
      sourceReportPath: input.candidate.path,
      sourceRunId: input.candidate.report.runId,
    }),
    ...buildReanswerJobsForBucket({
      bucket: "answerImprovements",
      deltas: input.answerImprovements,
      selectedQuestionKeys,
      sourceReportPath: input.candidate.path,
      sourceRunId: input.candidate.report.runId,
    }),
    ...buildReanswerJobsForBucket({
      bucket: "topUnconvertedRetrievalGains",
      deltas: input.topUnconvertedRetrievalGains,
      selectedQuestionKeys,
      sourceReportPath: input.candidate.path,
      sourceRunId: input.candidate.report.runId,
    }),
    ...buildReanswerJobsForBucket({
      bucket: "residualLiveAnswerChanges",
      deltas: input.residualLiveAnswerChanges,
      selectedQuestionKeys,
      sourceReportPath: input.candidate.path,
      sourceRunId: input.candidate.report.runId,
    }),
  ];
}

export function analyzeLocomoLiveDelta(input: {
  baseline: ReportInput;
  candidate: ReportInput;
  generatedAt?: string;
  outputPath?: string;
  runId?: string;
}): LocomoLiveDeltaAnalysis {
  const normalizedInput = normalizeLiveDeltaReportInputs(input);
  validateCompatibleReports(normalizedInput);
  const deltas = buildQuestionDeltas(normalizedInput);
  if (deltas.length === 0) {
    throw new Error("LoCoMo live-delta analysis found no overlapping questions.");
  }

  const overall = emptyAccumulator();
  const categories = new Map<LocomoQaCategory, DeltaAccumulator>();
  for (const delta of deltas) {
    addToAccumulators({ categories, delta, overall });
  }

  const categorySummaries: Partial<Record<LocomoQaCategory, LocomoLiveDeltaSummary>> =
    {};
  for (const category of LOCOMO_QA_CATEGORIES) {
    const acc = categories.get(category);
    if (acc) {
      categorySummaries[category] = summarizeAccumulator(acc);
    }
  }

  const answerImprovements = deltas
    .filter((delta) => delta.answerTransition === "improved")
    .sort(byEvidenceGainThenNoise)
    .slice(0, 10);
  const answerRegressions = deltas
    .filter((delta) => delta.answerTransition === "regressed")
    .sort(byEvidenceGainThenNoise)
    .slice(0, 10);
  const answerTokenF1NearMisses = deltas
    .filter(isAnswerTokenF1NearMiss)
    .sort(byCandidateAnswerTokenF1ThenRecall)
    .slice(0, 10);
  const topUnconvertedRetrievalGains = deltas
    .filter(
      (delta) =>
        delta.evidenceRecallDelta > 0 && delta.candidate.answerCorrect === false,
    )
    .sort(byEvidenceGainThenNoise)
    .slice(0, 10);
  const topNoisyFullRecallWrong = deltas
    .filter(
      (delta) =>
        delta.candidate.answerCorrect === false &&
        delta.candidate.goldEvidenceFullyRetrieved &&
        delta.candidate.noiseTurnCount > 0,
    )
    .sort(byCandidateNoiseThenDelta)
    .slice(0, 10);
  const residualLiveAnswerChanges = deltas
    .filter((delta) => delta.answerChangeAttribution.residualLiveAnswerChange)
    .sort(byEvidenceGainThenNoise)
    .slice(0, 10);

  return {
    answerImprovements,
    answerRegressions,
    answerTokenF1NearMisses,
    baselineReport: {
      path: input.baseline.path,
      runId: input.baseline.report.runId,
    },
    benchmark: "locomo",
    candidateReport: {
      path: input.candidate.path,
      runId: input.candidate.report.runId,
    },
    categories: categorySummaries,
    claimBoundary: CLAIM_BOUNDARY,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    generatedBy: GENERATED_BY,
    mode: input.baseline.report.mode,
    outputPath: input.outputPath ?? null,
    overall: summarizeAccumulator(overall),
    phase: "phase-65",
    reanswerJobs: buildReanswerJobs({
      answerImprovements,
      answerRegressions,
      answerTokenF1NearMisses,
      candidate: normalizedInput.candidate,
      residualLiveAnswerChanges,
      topNoisyFullRecallWrong,
      topUnconvertedRetrievalGains,
    }),
    runId: input.runId ?? "locomo-live-delta-current",
    sourceReports: [
      {
        path: input.candidate.path,
        questionCount: normalizedInput.candidate.report.questionCount,
        runId: normalizedInput.candidate.report.runId,
      },
    ],
    topNoisyFullRecallWrong,
    topUnconvertedRetrievalGains,
  };
}

export async function runLocomoLiveDeltaAnalysis(
  argv: readonly string[],
  deps: {
    mkdir?: (path: string, options: { recursive: boolean }) => Promise<unknown>;
    now?: () => Date;
    readFile?: (path: string) => Promise<string>;
    writeFile?: (path: string, value: string) => Promise<void>;
  } = {},
): Promise<{ analysis: LocomoLiveDeltaAnalysis; outputPath: string }> {
  const options = parseCliOptions(argv);
  const readFileImpl = deps.readFile ?? ((path: string) => readFile(path, "utf8"));
  const writeFileImpl = deps.writeFile ?? writeFile;
  const mkdirImpl = deps.mkdir ?? mkdir;
  const runId = options.runId ?? "locomo-live-delta-current";
  const outputPath =
    options.outputPath ?? defaultOutputPath(options.candidateReportPath, runId);
  assertDistinctCliPathValues({
    firstFlag: "--output-path",
    firstValue: outputPath,
    secondFlag: "--baseline-report",
    secondValue: options.baselineReportPath,
  });
  assertDistinctCliPathValues({
    firstFlag: "--output-path",
    firstValue: outputPath,
    secondFlag: "--candidate-report",
    secondValue: options.candidateReportPath,
  });

  const baselineParsed = JSON.parse(
    await readFileImpl(options.baselineReportPath),
  ) as unknown;
  const candidateParsed = JSON.parse(
    await readFileImpl(options.candidateReportPath),
  ) as unknown;
  assertSmokeReport(baselineParsed, options.baselineReportPath);
  assertSmokeReport(candidateParsed, options.candidateReportPath);

  const reports = await backfillReportsAnswerTokenF1({
    baseline: {
      path: options.baselineReportPath,
      report: baselineParsed,
    },
    candidate: {
      path: options.candidateReportPath,
      report: candidateParsed,
    },
    outputPath,
    readFile: readFileImpl,
  });

  const analysis = analyzeLocomoLiveDelta({
    baseline: reports.baseline,
    candidate: reports.candidate,
    generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
    outputPath,
    runId,
  });
  await mkdirImpl(dirname(outputPath), { recursive: true });
  await writeFileImpl(outputPath, `${JSON.stringify(analysis, null, 2)}\n`);
  return { analysis, outputPath };
}

if (import.meta.main) {
  runLocomoLiveDeltaAnalysis(process.argv)
    .then(({ analysis, outputPath }) => {
      process.stdout.write(
        `${JSON.stringify(
          {
            answerImprovements: analysis.answerImprovements.length,
            answerRegressions: analysis.answerRegressions.length,
            answerTokenF1NearMisses: analysis.answerTokenF1NearMisses.length,
            outputPath,
            overall: analysis.overall,
            runId: analysis.runId,
            topUnconvertedRetrievalGains:
              analysis.topUnconvertedRetrievalGains.length,
          },
          null,
          2,
        )}\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `LoCoMo live-delta analysis failed: ${String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
