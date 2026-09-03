import type { RecallCandidateTrace } from "../engine";
import type { RecallSlot } from "../router";
import type { RankedFactCandidate } from "../scoring";
import { markSelectedTrace } from "../selectors/selectionContext";
import type { FactSelectionSummary, SelectionDraft } from "./contracts";

export function createSelectionDraft<
  RouteId extends string = string,
  AugmenterId extends string = string,
  EarlyExit extends string = string,
>(input: {
  traces: RecallCandidateTrace[];
}): SelectionDraft<RouteId, AugmenterId, EarlyExit> {
  const selected: RankedFactCandidate[] = [];
  const selectedIds = new Set<string>();
  const summary: FactSelectionSummary<RouteId, AugmenterId, EarlyExit> = {
    augmenterStages: [],
  };
  const select = (
    entry: RankedFactCandidate,
    slot: RecallSlot | "generic" = "generic",
    fallback: RecallCandidateTrace["fallback"] = "none",
  ): void => {
    selected.push(entry);
    selectedIds.add(entry.fact.id);
    markSelectedTrace(
      input.traces,
      entry.fact.id,
      slot,
      entry.intentScore,
      entry.lexicalScore,
      entry.freshnessScore,
      entry.explicitnessScore,
      entry.evidenceScore,
      entry.verificationPenaltyScore,
      fallback,
    );
  };

  return {
    select,
    selected,
    selectedIds,
    summary,
    traces: input.traces,
  };
}

// Minimum lexical overlap for the zero-retrieval fallback to surface a fact.
// Calibrated so a clearly query-relevant fact (substantial token overlap) is
// recovered when every selection route suppressed it, while queries whose
// candidates have only incidental overlap stay empty (correct abstention).
// Validated to leave the large-scale rules-only recall diagnostic unchanged.
const ZERO_RETRIEVAL_FALLBACK_MIN_LEXICAL = 0.1;

/**
 * Last-resort selection: when no route or augmenter selected any fact but a
 * compatible candidate has substantial lexical overlap with the query, select
 * the single best-lexical fact rather than returning nothing. This recovers
 * queries the router classifies as generic (intentScore 0) whose long/noisy
 * phrasing dilutes every candidate below the per-route thresholds, while
 * preserving correct abstention for queries with no lexically-related memory.
 * It must run after every route and augmenter and only fires on an otherwise
 * empty fact slot, so it adds no facts to queries that already select.
 */
export function selectZeroRetrievalLexicalFallback(input: {
  compatible: RankedFactCandidate[];
  draft: SelectionDraft;
}): void {
  if (input.draft.selected.length > 0 || input.compatible.length === 0) {
    return;
  }
  const bestLexical = input.compatible.reduce((best, entry) =>
    entry.lexicalScore > best.lexicalScore ? entry : best,
  );
  if (bestLexical.lexicalScore >= ZERO_RETRIEVAL_FALLBACK_MIN_LEXICAL) {
    input.draft.select(bestLexical, "generic", "zero_retrieval_lexical");
  }
}

/**
 * Legacy final post-loop block: relabel still-unselected compatible
 * candidates from "not selected" to "below generic threshold". Must run after
 * every selection and augmentation step; it only rewrites "not selected", so
 * it can never clobber a more specific suppression reason.
 */
export function finalizeSuppressionReasons(input: {
  compatible: RankedFactCandidate[];
  traces: RecallCandidateTrace[];
}): void {
  const traceByMemoryId = new Map(
    input.traces.map((trace) => [trace.memoryId, trace] as const),
  );
  for (const entry of input.compatible) {
    const trace = traceByMemoryId.get(entry.fact.id);
    if (trace && !trace.returned && trace.whySuppressed === "not selected") {
      trace.whySuppressed = entry.queryCoverageScore !== undefined
        ? "below long-record coverage floor"
        : "below generic threshold";
    }
  }
}
