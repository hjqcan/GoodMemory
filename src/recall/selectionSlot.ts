import type { FactKind } from "../domain/records";
import type { RecallCandidateTrace } from "./engine";
import type { RecallSlot, RoutingDecision } from "./router";
import type { RankedFactCandidate } from "./scoring";
import { rankFactCandidates } from "./scoring";
import {
  PROJECT_STATE_SUPPORT_FALLBACK_KINDS,
  PROJECT_STATE_SUPPORT_PRIMARY_KINDS,
  diversifyRankedFactCandidatesBySession,
  hasFactSelectionSignal,
  slotMatchesFact,
} from "./selectors/selectionContext";

interface SelectSlotFactsInput {
  aggregateLimit?: number;
  aggregateSignal?: (entry: RankedFactCandidate) => boolean;
  allowUniqueFallback: boolean;
  entries: RankedFactCandidate[];
  selectedIds: Set<string>;
  selectAndTrace: (
    entry: RankedFactCandidate,
    slot: RecallSlot,
    fallback: RecallCandidateTrace["fallback"],
  ) => void;
  slot: RecallSlot;
  strategy: RoutingDecision["strategy"];
}

export function selectSlotFacts(input: SelectSlotFactsInput): void {
  const resolveCandidates = (factKinds?: readonly FactKind[]) =>
    input.entries
      .filter((entry) => !input.selectedIds.has(entry.fact.id))
      .filter((entry) => slotMatchesFact(entry, input.slot))
      .filter((entry) => {
        if (!factKinds) {
          return true;
        }

        return entry.factKind ? factKinds.includes(entry.factKind) : false;
      });
  const resolvePick = (
    candidates: RankedFactCandidate[],
    allowFallback: boolean,
  ) => {
    const signaledPick = candidates.find(hasFactSelectionSignal);

    if (signaledPick) {
      return {
        candidate: signaledPick,
        fallback: "none" as const,
      };
    }

    if (!allowFallback) {
      return {
        candidate: undefined,
        fallback: "none" as const,
      };
    }

    const uniqueActiveExplicit = candidates.filter(
      (entry) => entry.fact.source.method !== "inferred",
    );
    if (uniqueActiveExplicit.length === 1) {
      return {
        candidate: uniqueActiveExplicit[0],
        fallback: "same_slot_unique_candidate" as const,
      };
    }

    return {
      candidate: undefined,
      fallback: "none" as const,
    };
  };
  const selectCandidate = (
    candidate: RankedFactCandidate,
    fallback: RecallCandidateTrace["fallback"],
  ) => {
    input.selectAndTrace(candidate, input.slot, fallback);
  };

  if (input.aggregateLimit && input.aggregateLimit > 1) {
    const aggregatePicks = diversifyRankedFactCandidatesBySession(
      rankFactCandidates(
        resolveCandidates().filter(
          input.aggregateSignal ?? hasFactSelectionSignal,
        ),
        input.strategy,
      ),
      input.aggregateLimit,
    );

    for (const candidate of aggregatePicks) {
      selectCandidate(candidate, "none");
    }

    return;
  }

  if (input.slot === "project_state_support") {
    let selectedSupportCount = 0;

    const blockerPick = resolvePick(
      resolveCandidates(PROJECT_STATE_SUPPORT_PRIMARY_KINDS[0]),
      false,
    );
    if (blockerPick.candidate) {
      selectCandidate(blockerPick.candidate, blockerPick.fallback);
      selectedSupportCount += 1;
    }

    const openLoopPick = resolvePick(
      resolveCandidates(PROJECT_STATE_SUPPORT_PRIMARY_KINDS[1]),
      false,
    );
    if (
      openLoopPick.candidate &&
      (blockerPick.candidate || selectedSupportCount === 0)
    ) {
      selectCandidate(openLoopPick.candidate, openLoopPick.fallback);
      selectedSupportCount += 1;
    }

    if (selectedSupportCount === 0) {
      const fallbackPick = resolvePick(
        resolveCandidates(PROJECT_STATE_SUPPORT_FALLBACK_KINDS),
        false,
      );
      if (fallbackPick.candidate) {
        selectCandidate(fallbackPick.candidate, fallbackPick.fallback);
        selectedSupportCount += 1;
      }
    }

    if (selectedSupportCount === 0 && input.allowUniqueFallback) {
      const uniqueFallbackPick = resolvePick(resolveCandidates(), true);
      if (uniqueFallbackPick.candidate) {
        selectCandidate(uniqueFallbackPick.candidate, uniqueFallbackPick.fallback);
      }
    }

    return;
  }

  const pick = resolvePick(resolveCandidates(), input.allowUniqueFallback);
  if (pick.candidate) {
    selectCandidate(pick.candidate, pick.fallback);
  }
}
