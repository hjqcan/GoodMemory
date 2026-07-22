import type { RecallCandidateTrace } from "./engine";
import type {
  GeneralizedFusionCandidate,
  GeneralizedFusionSourceCollection,
} from "./generalizedFusion";
import { buildReturnedReason } from "./selectors/selectionContext";

const BLOCKING_SUPPRESSION_REASONS = new Set([
  "inactive lifecycle",
  "locale mismatch",
]);

export function isGeneralizedCandidateTraceEligible(
  trace: RecallCandidateTrace | undefined,
): trace is RecallCandidateTrace {
  return Boolean(
    trace &&
      (!trace.whySuppressed ||
        !BLOCKING_SUPPRESSION_REASONS.has(trace.whySuppressed)),
  );
}

export function admitGeneralizedRecords<T>(input: {
  candidates: readonly GeneralizedFusionCandidate[];
  collection: GeneralizedFusionSourceCollection;
  getId: (record: T) => string;
  maxRecords: number;
  records: readonly T[];
  selected: readonly T[];
  traces: RecallCandidateTrace[];
}): T[] {
  const recordsById = new Map(
    input.records.map((record) => [input.getId(record), record]),
  );
  const result = [...input.selected];
  const selectedIds = new Set(result.map(input.getId));

  for (const candidate of input.candidates) {
    if (
      result.length >= input.maxRecords ||
      candidate.sourceCollection !== input.collection ||
      selectedIds.has(candidate.sourceMemoryId)
    ) {
      continue;
    }
    const record = recordsById.get(candidate.sourceMemoryId);
    const trace = input.traces.find(
      ({ memoryId }) => memoryId === candidate.sourceMemoryId,
    );
    if (!record || !isGeneralizedCandidateTraceEligible(trace)) {
      continue;
    }

    result.push(record);
    selectedIds.add(candidate.sourceMemoryId);
    trace.returned = true;
    trace.whySuppressed = undefined;
    trace.fallback = "generalized_fusion";
    trace.whyReturned = buildReturnedReason(
      "generic",
      trace.intentScore,
      trace.lexicalScore,
      trace.outcomeScore ?? 0,
      trace.verificationPenaltyScore ?? 0,
      trace.fallback,
    );
  }

  return result;
}
