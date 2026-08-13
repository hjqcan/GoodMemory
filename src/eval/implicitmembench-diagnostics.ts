import type {
  ImplicitMemBenchCaseResult,
  ImplicitMemBenchDatasetFamily,
  ImplicitMemBenchResearchReport,
  ImplicitMemBenchScorerFamily,
} from "./implicitmembench-research";

export type RawInternalizationDiagnosisBucket =
  | "executor_unsafe"
  | "hypothesis_missing"
  | "memory_miss"
  | "operator_failure"
  | "selected_and_passed"
  | "selected_but_not_enacted"
  | "support_conflict"
  | "wrong_exemplar";

export type RawInternalizationExecutionFailureBucket =
  | "certificate_error"
  | "invalid_json_response"
  | "semantic_search_failure"
  | "timeout"
  | "other";

export type RawInternalizationCueSufficiencyBucket =
  | "candidate_conflict"
  | "candidate_insufficient"
  | "cue_disconnect"
  | "executor_unsafe"
  | "no_candidate"
  | "operator_failure"
  | "passed"
  | "sufficient_not_enacted"
  | "wrong_exemplar";

export interface RawInternalizationDiagnosisCase {
  abstainReason?: string;
  blocking: boolean;
  candidatePrototypeCount: number;
  caseId: string;
  cueSufficiency: RawInternalizationCueSufficiencyBucket;
  datasetFamily: ImplicitMemBenchDatasetFamily;
  diagnosis: RawInternalizationDiagnosisBucket;
  distilledPassed?: boolean;
  executionFailureBucket?: RawInternalizationExecutionFailureBucket;
  hypothesisExecutionMode?: string;
  hypothesisMappingType?: string;
  rawExecutionFailure?: string;
  rawPassed?: boolean;
  rawVsDistilledDelta: -1 | 0 | 1;
  scorerFamily: ImplicitMemBenchScorerFamily;
  selectedPrototypeCount: number;
  taskFile: string;
  taskName: string;
  topProbability?: number;
}

export interface RawInternalizationDiagnosisSummary {
  byCase: RawInternalizationDiagnosisCase[];
  byCueSufficiency: Record<RawInternalizationCueSufficiencyBucket, number>;
  byDiagnosis: Record<RawInternalizationDiagnosisBucket, number>;
  byExecutionFailure: Record<RawInternalizationExecutionFailureBucket, number>;
  byFamily: Record<ImplicitMemBenchDatasetFamily, Record<RawInternalizationDiagnosisBucket, number>>;
  byScorer: Record<ImplicitMemBenchScorerFamily, Record<RawInternalizationDiagnosisBucket, number>>;
  byTask: Record<string, Record<RawInternalizationDiagnosisBucket, number>>;
  distilledPassedBlockingCases: number;
  rawBlockingExecutionFailures: number;
  rawNonBlockingExecutionFailures: number;
  rawPassedBlockingCases: number;
  rawVsDistilledDelta: {
    distilledOnlyPasses: number;
    rawOnlyPasses: number;
    sameOutcome: number;
  };
  reports: string[];
  totalBlockingCases: number;
  totalCases: number;
}

const DIAGNOSIS_BUCKETS: RawInternalizationDiagnosisBucket[] = [
  "executor_unsafe",
  "hypothesis_missing",
  "memory_miss",
  "operator_failure",
  "selected_and_passed",
  "selected_but_not_enacted",
  "support_conflict",
  "wrong_exemplar",
];

const EXECUTION_FAILURE_BUCKETS: RawInternalizationExecutionFailureBucket[] = [
  "certificate_error",
  "invalid_json_response",
  "semantic_search_failure",
  "timeout",
  "other",
];

const CUE_SUFFICIENCY_BUCKETS: RawInternalizationCueSufficiencyBucket[] = [
  "candidate_conflict",
  "candidate_insufficient",
  "cue_disconnect",
  "executor_unsafe",
  "no_candidate",
  "operator_failure",
  "passed",
  "sufficient_not_enacted",
  "wrong_exemplar",
];

function countRecord<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function increment<T extends string>(record: Record<T, number>, key: T): void {
  record[key] = (record[key] ?? 0) + 1;
}

function bucketExecutionFailure(
  failure: string | undefined,
): RawInternalizationExecutionFailureBucket | undefined {
  if (!failure) {
    return undefined;
  }

  const normalized = failure.toLowerCase();
  if (/invalid\s+json|json\s+response/u.test(normalized)) {
    return "invalid_json_response";
  }
  if (/semantic[_\s-]*search/u.test(normalized)) {
    return "semantic_search_failure";
  }
  if (/timeout|timed\s+out|aborted/u.test(normalized)) {
    return "timeout";
  }
  if (/certificate|cert|tls|ssl/u.test(normalized)) {
    return "certificate_error";
  }

  return "other";
}

function bucketRawDiagnosis(
  rawCase: ImplicitMemBenchCaseResult,
): RawInternalizationDiagnosisBucket {
  if (rawCase.executionFailure) {
    return "operator_failure";
  }
  if (
    rawCase.rawCarryover?.abstainReason === "no_candidates" &&
    rawCase.rawCarryover.candidatePrototypeIds.length === 0 &&
    rawCase.rawCarryover.selectedPrototypeIds.length === 0
  ) {
    return "memory_miss";
  }
  if (rawCase.passed) {
    return "selected_and_passed";
  }

  switch (rawCase.rawCarryover?.diagnosis) {
    case "executor_unsafe":
      return "executor_unsafe";
    case "hypothesis_missing":
    case "abstain":
      return "hypothesis_missing";
    case "support_conflict":
      return "support_conflict";
    case "wrong_exemplar":
      return "wrong_exemplar";
    case "reasoning_after_correct_hypothesis":
      return "selected_but_not_enacted";
    case "selected_and_passed":
      return "selected_and_passed";
    case "memory_miss":
    default:
      return rawCase.rawCarryover?.selectedPrototypeIds?.length
        ? "selected_but_not_enacted"
        : "memory_miss";
  }
}

function bucketCueSufficiency(
  rawCase: ImplicitMemBenchCaseResult,
): RawInternalizationCueSufficiencyBucket {
  if (rawCase.executionFailure) {
    return "operator_failure";
  }
  if (
    rawCase.rawCarryover?.abstainReason === "no_candidates" &&
    rawCase.rawCarryover.candidatePrototypeIds.length === 0 &&
    rawCase.rawCarryover.selectedPrototypeIds.length === 0
  ) {
    return "no_candidate";
  }
  if (rawCase.passed) {
    return "passed";
  }

  const carryover = rawCase.rawCarryover;
  const candidateCount = carryover?.candidatePrototypeIds.length ?? 0;
  const selectedCount = carryover?.selectedPrototypeIds.length ?? 0;

  switch (carryover?.diagnosis) {
    case "executor_unsafe":
      return "executor_unsafe";
    case "support_conflict":
      return "candidate_conflict";
    case "wrong_exemplar":
      return "wrong_exemplar";
    case "reasoning_after_correct_hypothesis":
      return "sufficient_not_enacted";
    case "selected_and_passed":
      return "passed";
    case "hypothesis_missing":
    case "abstain":
      return candidateCount === 0 || carryover?.abstainReason === "no_candidates"
        ? "no_candidate"
        : "candidate_insufficient";
    case "memory_miss":
    default:
      if (candidateCount === 0 || carryover?.abstainReason === "no_candidates") {
        return "no_candidate";
      }
      if (selectedCount === 0) {
        return "candidate_insufficient";
      }
      return carryover?.goldSupportingCandidatePresent === false
        ? "cue_disconnect"
        : "sufficient_not_enacted";
  }
}

function rawVsDistilledDelta(input: {
  distilledCase: ImplicitMemBenchCaseResult | undefined;
  rawCase: ImplicitMemBenchCaseResult;
}): -1 | 0 | 1 {
  const rawPassed = Boolean(input.rawCase.passed);
  const distilledPassed = Boolean(input.distilledCase?.passed);
  if (rawPassed === distilledPassed) {
    return 0;
  }

  return rawPassed ? 1 : -1;
}

function reportLabel(report: ImplicitMemBenchResearchReport): string {
  return `${report.runId}:${report.runDirectory}`;
}

export function buildRawInternalizationDiagnosisSummary(
  reports: readonly ImplicitMemBenchResearchReport[],
): RawInternalizationDiagnosisSummary {
  const rawCasesById = new Map<string, ImplicitMemBenchCaseResult>();
  const distilledCasesById = new Map<string, ImplicitMemBenchCaseResult>();

  for (const report of reports) {
    for (const rawCase of report.profiles["goodmemory-raw-experience"]?.cases ?? []) {
      rawCasesById.set(rawCase.caseId, rawCase);
    }
    for (const distilledCase of report.profiles["goodmemory-distilled-feedback"]?.cases ?? []) {
      distilledCasesById.set(distilledCase.caseId, distilledCase);
    }
  }

  const byDiagnosis = countRecord(DIAGNOSIS_BUCKETS);
  const byCueSufficiency = countRecord(CUE_SUFFICIENCY_BUCKETS);
  const byExecutionFailure = countRecord(EXECUTION_FAILURE_BUCKETS);
  const byFamily = {} as RawInternalizationDiagnosisSummary["byFamily"];
  const byScorer = {} as RawInternalizationDiagnosisSummary["byScorer"];
  const byTask: RawInternalizationDiagnosisSummary["byTask"] = {};
  const byCase: RawInternalizationDiagnosisCase[] = [];
  let rawPassedBlockingCases = 0;
  let distilledPassedBlockingCases = 0;
  let totalBlockingCases = 0;
  let rawBlockingExecutionFailures = 0;
  let rawNonBlockingExecutionFailures = 0;
  let rawOnlyPasses = 0;
  let distilledOnlyPasses = 0;
  let sameOutcome = 0;

  for (const rawCase of rawCasesById.values()) {
    const distilledCase = distilledCasesById.get(rawCase.caseId);
    const diagnosis = bucketRawDiagnosis(rawCase);
    const cueSufficiency = bucketCueSufficiency(rawCase);
    const executionFailureBucket = bucketExecutionFailure(rawCase.executionFailure);
    const delta = rawVsDistilledDelta({ distilledCase, rawCase });

    increment(byDiagnosis, diagnosis);
    increment(byCueSufficiency, cueSufficiency);
    if (executionFailureBucket) {
      increment(byExecutionFailure, executionFailureBucket);
    }

    byFamily[rawCase.datasetFamily] ??= countRecord(DIAGNOSIS_BUCKETS);
    increment(byFamily[rawCase.datasetFamily], diagnosis);
    byScorer[rawCase.scorerFamily] ??= countRecord(DIAGNOSIS_BUCKETS);
    increment(byScorer[rawCase.scorerFamily], diagnosis);
    byTask[rawCase.taskFile] ??= countRecord(DIAGNOSIS_BUCKETS);
    increment(byTask[rawCase.taskFile], diagnosis);

    if (rawCase.blocking) {
      totalBlockingCases += 1;
      if (rawCase.passed) {
        rawPassedBlockingCases += 1;
      }
      if (distilledCase?.passed) {
        distilledPassedBlockingCases += 1;
      }
      if (rawCase.executionFailure) {
        rawBlockingExecutionFailures += 1;
      }
    } else if (rawCase.executionFailure) {
      rawNonBlockingExecutionFailures += 1;
    }

    if (delta === 1) {
      rawOnlyPasses += 1;
    } else if (delta === -1) {
      distilledOnlyPasses += 1;
    } else {
      sameOutcome += 1;
    }

    byCase.push({
      ...(rawCase.rawCarryover?.abstainReason
        ? { abstainReason: rawCase.rawCarryover.abstainReason }
        : {}),
      blocking: rawCase.blocking,
      candidatePrototypeCount: rawCase.rawCarryover?.candidatePrototypeIds.length ?? 0,
      caseId: rawCase.caseId,
      cueSufficiency,
      datasetFamily: rawCase.datasetFamily,
      diagnosis,
      ...(distilledCase?.passed !== undefined
        ? { distilledPassed: distilledCase.passed }
        : {}),
      ...(executionFailureBucket ? { executionFailureBucket } : {}),
      ...(rawCase.executionFailure
        ? { rawExecutionFailure: rawCase.executionFailure }
        : {}),
      ...(rawCase.rawCarryover?.hypothesis?.executionMode
        ? {
            hypothesisExecutionMode:
              rawCase.rawCarryover.hypothesis.executionMode,
          }
        : {}),
      ...(rawCase.rawCarryover?.hypothesis?.mappingType
        ? {
            hypothesisMappingType: rawCase.rawCarryover.hypothesis.mappingType,
          }
        : {}),
      ...(rawCase.passed !== undefined ? { rawPassed: rawCase.passed } : {}),
      rawVsDistilledDelta: delta,
      scorerFamily: rawCase.scorerFamily,
      selectedPrototypeCount: rawCase.rawCarryover?.selectedPrototypeIds.length ?? 0,
      taskFile: rawCase.taskFile,
      taskName: rawCase.taskName,
      ...(rawCase.rawCarryover?.topProbability !== undefined
        ? { topProbability: rawCase.rawCarryover.topProbability }
        : {}),
    });
  }

  byCase.sort((left, right) =>
    left.taskFile === right.taskFile
      ? left.caseId.localeCompare(right.caseId)
      : left.taskFile.localeCompare(right.taskFile),
  );

  return {
    byCase,
    byCueSufficiency,
    byDiagnosis,
    byExecutionFailure,
    byFamily,
    byScorer,
    byTask,
    distilledPassedBlockingCases,
    rawBlockingExecutionFailures,
    rawNonBlockingExecutionFailures,
    rawPassedBlockingCases,
    rawVsDistilledDelta: {
      distilledOnlyPasses,
      rawOnlyPasses,
      sameOutcome,
    },
    reports: reports.map(reportLabel),
    totalBlockingCases,
    totalCases: rawCasesById.size,
  };
}
