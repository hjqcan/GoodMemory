import type { FactMemory, UserProfile } from "../domain/records";
import type { LanguageService } from "../language";
import type { RecallCandidateTrace } from "./engine";
import type { RecallSlot, RetrievalProfile, RoutingDecision } from "./router";
import {
  buildFactCandidates,
  materializeFactCandidate,
  rankFactCandidates,
} from "./scoring";
import type { RankedFactCandidate } from "./scoring";
import { FACT_SELECTION_AUGMENTER_TABLE } from "./factSelection/augmenterTable";
import type {
  FactSelectionAugmenterStageId,
  FactSelectionEarlyExit,
  FactSelectionRuntime,
} from "./factSelection/contracts";
import {
  createSelectionDraft,
  finalizeSuppressionReasons,
  selectZeroRetrievalLexicalFallback,
} from "./factSelection/draft";
import {
  FACT_SELECTION_ROUTE_TABLE,
  type PrimaryFactSelectionId,
} from "./factSelection/routeTable";
import { selectSemanticUnionCandidates } from "./factSelection/semanticUnion";
import type { SemanticUnionSelectionInput } from "./factSelection/semanticUnion";
import { buildSelectionRunContext } from "./selectionRunContext";
import { selectSlotFacts } from "./selectionSlot";
import {
  AGGREGATE_OPEN_LOOP_LIMIT,
  hasAggregateOpenLoopSignal,
} from "./selectors/aggregate";
import { slotMatchesFact } from "./selectors/selectionContext";


export {
  selectArchives,
  selectEpisodes,
  selectFeedback,
  selectFeedbackForProfile,
  selectFeedbackForQuery,
  selectPreferencesForQuery,
  selectReferences,
} from "./selectors/recordSelection";

export function selectFactsLegacy(
  facts: FactMemory[],
  query: string,
  language: LanguageService,
  queryLocale: string,
  retrievalProfile: RetrievalProfile,
  routingDecision: RoutingDecision,
  profile: UserProfile | null,
  referenceTime: string,
  semanticScores?: Map<string, number>,
  evidenceCountsByMemoryId?: Map<string, number>,
  semanticUnion?: SemanticUnionSelectionInput,
): { facts: FactMemory[]; traces: RecallCandidateTrace[] } {
  const ranked = rankFactCandidates(
    buildFactCandidates(
      facts,
      query,
      language,
      queryLocale,
      referenceTime,
      semanticScores,
      evidenceCountsByMemoryId,
    ),
    routingDecision.strategy,
  );
  const traces: RecallCandidateTrace[] = ranked.map((entry) => ({
    memoryId: entry.fact.id,
    memoryType: "fact",
    slot: "generic",
    returned: false,
    whySuppressed: !language.localesCompatible(queryLocale, entry.locale)
      ? "locale mismatch"
      : entry.fact.lifecycle !== "active"
        ? "inactive lifecycle"
        : "not selected",
    intentScore: entry.intentScore,
    lexicalScore: entry.lexicalScore,
    freshnessScore: entry.freshnessScore,
    explicitnessScore: entry.explicitnessScore,
    evidenceScore: entry.evidenceScore,
    verificationPenaltyScore: entry.verificationPenaltyScore,
    // Feature-gated so union-off traces serialize byte-identically.
    ...(semanticUnion && entry.semanticScore > 0
      ? { semanticScore: entry.semanticScore }
      : {}),
    fallback: "none",
  }));
  const compatible = ranked.filter(
    (entry) =>
      entry.fact.lifecycle === "active" &&
      language.localesCompatible(queryLocale, entry.locale),
  );
  const ctx = buildSelectionRunContext({
    compatible,
    language,
    profile,
    query,
    queryLocale,
    routingDecision,
  });
  const {
    aggregateOpenLoopQuery,
    broadAspectEventOrderCandidates,
    instructionEvidenceCandidates,
    instructionRuleFamilyQuery,
    limit,
    referenceOnlyQuery,
    slotSpecificFactQuery,
    sourceOrderedEventOrderCandidates,
    sourceOrderedNamedEntityEventPlanActive,
    sourcePreferenceExclusiveQuery,
    sourcePreferenceOverrideByContradiction,
    temporalEventOrderQuery,
    userBroughtUpEventOrderQuery,
    temporalMostRecentQuery,
    temporalRelativeEventQuery,
    trelloSprintPrioritizationCriteriaAbstentionQuery,
  } = ctx;
  const runtime: FactSelectionRuntime = {
    compatible,
    language,
    query,
    queryLocale,
    retrievalProfile,
    strategy: routingDecision.strategy,
  };
  const draft = createSelectionDraft<
    PrimaryFactSelectionId,
    FactSelectionAugmenterStageId,
    FactSelectionEarlyExit
  >({ traces });
  const selected = draft.selected;
  const selectedIds = draft.selectedIds;
  const selectAndTrace = draft.select;
  const finishWithSelectedFacts = (): {
    facts: FactMemory[];
    traces: RecallCandidateTrace[];
  } => {
    if (semanticUnion) {
      selectSemanticUnionCandidates({ compatible, draft, union: semanticUnion });
    }
    finalizeSuppressionReasons({ compatible, traces });
    return {
      facts: selected.map(materializeFactCandidate),
      traces,
    };
  };
  if (trelloSprintPrioritizationCriteriaAbstentionQuery) {
    return { facts: [], traces };
  }

  const trySelectSlot = (
    slot: RecallSlot,
    entries: RankedFactCandidate[],
    allowUniqueFallback: boolean,
    options?: {
      aggregateLimit?: number;
      aggregateSignal?: (entry: RankedFactCandidate) => boolean;
    },
  ) => {
    selectSlotFacts({
      aggregateLimit: options?.aggregateLimit,
      aggregateSignal: options?.aggregateSignal,
      allowUniqueFallback,
      entries,
      selectedIds,
      selectAndTrace,
      slot,
      strategy: routingDecision.strategy,
    });
  };

  if (referenceOnlyQuery) {
    for (const trace of traces) {
      if (trace.whySuppressed === "not selected") {
        trace.whySuppressed = "reference-only query";
      }
    }
    return {
      facts: [],
      traces,
    };
  }

  if (slotSpecificFactQuery) {
    const activeSlots: RecallSlot[] = [];
    if (
      routingDecision.requestedSlots.includes("role") &&
      (!profile?.identity.role || routingDecision.requestedSlots.length > 1)
    ) {
      activeSlots.push("role");
      trySelectSlot("role", compatible, false);
    } else if (routingDecision.requestedSlots.includes("role")) {
      for (const entry of compatible.filter((item) => item.factKind === "role_update")) {
        const trace = traces.find((item) => item.memoryId === entry.fact.id);
        if (trace && trace.whySuppressed === "not selected") {
          trace.whySuppressed = "profile satisfied role slot";
        }
      }
    }

    if (routingDecision.requestedSlots.includes("focus")) {
      activeSlots.push("focus");
      trySelectSlot("focus", compatible, false);
    }
    if (routingDecision.requestedSlots.includes("blocker")) {
      activeSlots.push("blocker");
      trySelectSlot("blocker", compatible, false);
    }
    if (routingDecision.requestedSlots.includes("open_loop")) {
      activeSlots.push("open_loop");
      trySelectSlot(
        "open_loop",
        compatible,
        false,
        aggregateOpenLoopQuery
          ? {
              aggregateLimit: AGGREGATE_OPEN_LOOP_LIMIT,
              aggregateSignal: hasAggregateOpenLoopSignal,
            }
          : undefined,
      );
    }
    if (routingDecision.supportSlots.includes("project_state_support")) {
      activeSlots.push("project_state_support");
      trySelectSlot("project_state_support", compatible, true);
    }

    for (const entry of compatible) {
      const trace = traces.find((item) => item.memoryId === entry.fact.id);
      if (!trace || trace.returned || trace.whySuppressed !== "not selected") {
        continue;
      }

      if (!activeSlots.some((slot) => slotMatchesFact(entry, slot))) {
        trace.whySuppressed = "slot mismatch";
      } else {
        trace.whySuppressed = "no slot signal";
      }
    }

    return finishWithSelectedFacts();
  }

  if (
    instructionRuleFamilyQuery &&
    instructionEvidenceCandidates.length > 0
  ) {
    for (const entry of instructionEvidenceCandidates) {
      selectAndTrace(entry);
    }
    return finishWithSelectedFacts();
  }
  const exclusivitySkipsPrimary =
    sourcePreferenceExclusiveQuery && !sourcePreferenceOverrideByContradiction;
  if (!exclusivitySkipsPrimary) {
    for (const route of FACT_SELECTION_ROUTE_TABLE) {
      if (!route.isEligible({ ctx, runtime })) {
        continue;
      }

      const outcome = route.select({ ctx, runtime });
      for (const entry of outcome.entries) {
        selectAndTrace(entry);
      }
      draft.summary.winner = {
        claimsContradictionPair: outcome.claimsContradictionPair === true,
        routeId: route.id,
      };
      break;
    }
  }

  for (const stage of FACT_SELECTION_AUGMENTER_TABLE) {
    if (
      draft.summary.winner &&
      stage.yieldsToWinners.includes(draft.summary.winner.routeId)
    ) {
      continue;
    }
    if (!stage.gate({ ctx, draft, runtime, winner: draft.summary.winner })) {
      continue;
    }

    draft.summary.augmenterStages.push(stage.apply({ ctx, draft, runtime }));
  }

  // Last resort when no route or augmenter selected any fact: surface the single
  // best-lexical compatible fact instead of returning nothing (abstention is
  // preserved for candidates with only incidental overlap). See the helper.
  selectZeroRetrievalLexicalFallback({ compatible, draft });

  return finishWithSelectedFacts();
}
