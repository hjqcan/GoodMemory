import type {
  FactKind,
  FeedbackMemory,
  PreferenceMemory,
} from "../../domain/records";
import { normalizeFeedbackAppliesTo } from "../../domain/records";
import type { RecallCandidateTrace } from "../engine";
import type { RecallSlot, RetrievalProfile } from "../router";
import type { RankedFactCandidate } from "../scoring";

export const PROJECT_STATE_SUPPORT_PRIMARY_KINDS = [
  ["blocker"],
  ["open_loop"],
] as const satisfies ReadonlyArray<readonly FactKind[]>;

export const PROJECT_STATE_SUPPORT_FALLBACK_KINDS = [
  "focus_update",
  "project_state",
] as const satisfies readonly FactKind[];
export const PREFERENCE_RECALL_LIMIT = 3;
export const EXPLICIT_WEAK_LEXICAL_FACT_THRESHOLD = 0.08;
export const ASSISTANT_EVIDENCE_TAG = "assistant_answer";
export const SOURCE_MESSAGE_TAG = "source_message";
export const CONVERSATION_EVIDENCE_TAGS = new Set([
  ASSISTANT_EVIDENCE_TAG,
  "compact_evidence",
  "dated_event",
  SOURCE_MESSAGE_TAG,
  "user_answer",
]);
export function hasConversationEvidenceTag(entry: RankedFactCandidate): boolean {
  return entry.fact.tags?.some((tag) => CONVERSATION_EVIDENCE_TAGS.has(tag)) === true;
}

export function hasAssistantAnswerTag(entry: RankedFactCandidate): boolean {
  return entry.fact.tags?.includes(ASSISTANT_EVIDENCE_TAG) === true;
}

export function diversifyRankedFactCandidatesBySession(
  entries: RankedFactCandidate[],
  limit: number,
): RankedFactCandidate[] {
  const selected: RankedFactCandidate[] = [];
  const selectedIds = new Set<string>();
  const selectedSessionIds = new Set<string>();

  for (const entry of entries) {
    const sessionId = entry.fact.sessionId;
    if (!sessionId || selectedSessionIds.has(sessionId)) {
      continue;
    }

    selected.push(entry);
    selectedIds.add(entry.fact.id);
    selectedSessionIds.add(sessionId);
    if (selected.length >= limit) {
      return selected;
    }
  }

  for (const entry of entries) {
    if (selectedIds.has(entry.fact.id)) {
      continue;
    }

    selected.push(entry);
    selectedIds.add(entry.fact.id);
    if (selected.length >= limit) {
      return selected;
    }
  }

  return selected;
}

export function preferenceSearchText(preference: PreferenceMemory): string {
  return [
    preference.category,
    String(preference.value),
    ...(preference.tags ?? []),
  ].join(" ");
}

export function feedbackSearchText(feedback: FeedbackMemory): string {
  return [
    feedback.kind,
    feedback.appliesTo,
    feedback.rule,
    feedback.why,
    ...(feedback.tags ?? []),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

export function buildReturnedReason(
  slot: RecallSlot | "generic",
  intentScore: number,
  lexicalScore: number,
  evidenceScore: number,
  verificationPenaltyScore: number,
  fallback: RecallCandidateTrace["fallback"],
): string {
  return `slot=${slot}, intentScore=${intentScore.toFixed(2)}, lexicalScore=${lexicalScore.toFixed(2)}, evidenceScore=${evidenceScore.toFixed(2)}, verificationPenaltyScore=${verificationPenaltyScore.toFixed(2)}, fallback=${fallback}`;
}

export function markSelectedTrace(
  traces: RecallCandidateTrace[],
  memoryId: string,
  slot: RecallSlot | "generic",
  intentScore: number,
  lexicalScore: number,
  freshness: number,
  explicitness: number,
  evidenceScore: number,
  verificationPenaltyScore: number,
  fallback: RecallCandidateTrace["fallback"],
): void {
  const index = traces.findIndex((trace) => trace.memoryId === memoryId);
  if (index === -1) {
    return;
  }

  traces[index] = {
    ...traces[index]!,
    slot,
    returned: true,
    whyReturned: buildReturnedReason(
      slot,
      intentScore,
      lexicalScore,
      evidenceScore,
      verificationPenaltyScore,
      fallback,
    ),
    whySuppressed: undefined,
    intentScore,
    lexicalScore,
    freshnessScore: freshness,
    explicitnessScore: explicitness,
    evidenceScore,
    verificationPenaltyScore,
    fallback,
  };
}

export function slotMatchesFact(
  entry: RankedFactCandidate,
  slot: RecallSlot,
): boolean {
  if (slot === "role") {
    return entry.factKind === "role_update";
  }
  if (slot === "focus") {
    return entry.factKind === "focus_update";
  }
  if (slot === "blocker") {
    return entry.factKind === "blocker";
  }
  if (slot === "open_loop") {
    return entry.factKind === "open_loop";
  }
  if (slot === "project_state_support") {
    return (
      entry.factKind === "blocker" ||
      entry.factKind === "open_loop" ||
      entry.factKind === "focus_update" ||
      entry.factKind === "project_state"
    );
  }

  return false;
}

export function hasFactSelectionSignal(entry: RankedFactCandidate): boolean {
  return (
    entry.intentScore > 0 ||
    entry.lexicalScore >= 0.2 ||
    entry.subjectScore > 0
  );
}

// Long-record admission (opt-in): a record above the overlap-token floor is
// admissible when the query is substantially covered, never on one shared
// common token. Applied legacy-first, so it only fills capacity the calibrated
// predicates left free.
export const LONG_RECORD_COVERAGE_MIN = 0.6;
export const LONG_RECORD_COVERAGE_MIN_MATCHES = 2;

export function hasLongRecordCoverageSignal(entry: RankedFactCandidate): boolean {
  return (
    entry.queryCoverageScore !== undefined &&
    entry.queryCoverageMatches !== undefined &&
    entry.queryCoverageMatches >= LONG_RECORD_COVERAGE_MIN_MATCHES &&
    entry.queryCoverageScore >= LONG_RECORD_COVERAGE_MIN
  );
}

export function hasGenericFactSelectionSignal(entry: RankedFactCandidate): boolean {
  return (
    hasFactSelectionSignal(entry) ||
    (
      entry.fact.source.method !== "inferred" &&
      entry.lexicalScore >= EXPLICIT_WEAK_LEXICAL_FACT_THRESHOLD
    )
  );
}

export function feedbackApplicabilityPriority(
  feedback: FeedbackMemory,
  retrievalProfile: RetrievalProfile,
): number {
  const appliesTo = normalizeFeedbackAppliesTo(feedback.appliesTo);

  if (retrievalProfile === "coding_agent") {
    if (appliesTo === "coding_agent") {
      return 0;
    }
    if (appliesTo === "general_response") {
      return 1;
    }

    return 2;
  }

  return appliesTo === "general_response" ? 0 : 1;
}
