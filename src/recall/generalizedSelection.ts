import type { FactMemory, UserProfile } from "../domain/records";
import type { LanguageQueryAnalysis, LanguageService } from "../language";
import type { RecallCandidateTrace } from "./engine";
import type { RecallSlot, RetrievalProfile, RoutingDecision } from "./router";
import {
  buildFactCandidates,
  materializeFactCandidate,
  rankFactCandidates,
} from "./scoring";
import { createSelectionDraft, finalizeSuppressionReasons } from "./factSelection/draft";
import { selectZeroRetrievalLexicalFallback } from "./factSelection/draft";
import { selectSemanticUnionCandidates } from "./factSelection/semanticUnion";
import type { SemanticUnionSelectionInput } from "./factSelection/semanticUnion";
import { selectGeneralizedFusionCandidates } from "./factSelection/generalizedFusionUnion";
import type { GeneralizedFusionSelectionInput } from "./factSelection/generalizedFusionUnion";
import { selectSlotFacts } from "./selectionSlot";
import {
  diversifyRankedFactCandidatesBySession,
  hasConversationEvidenceTag,
  hasAssistantAnswerTag,
  hasFactSelectionSignal,
  hasGenericFactSelectionSignal,
  slotMatchesFact,
} from "./selectors/selectionContext";

const GENERAL_FACT_RECALL_LIMIT = 6;
const AGGREGATE_OPEN_LOOP_LIMIT = 6;

export type FactSelector = (
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
  generalizedFusion?: GeneralizedFusionSelectionInput,
  queryAnalysis?: LanguageQueryAnalysis,
) => { facts: FactMemory[]; traces: RecallCandidateTrace[] };

export function selectGeneralizedFactsForInternalUse(
  facts: FactMemory[],
  query: string,
  language: LanguageService,
  queryLocale: string,
  _retrievalProfile: RetrievalProfile,
  routingDecision: RoutingDecision,
  profile: UserProfile | null,
  referenceTime: string,
  semanticScores?: Map<string, number>,
  evidenceCountsByMemoryId?: Map<string, number>,
  semanticUnion?: SemanticUnionSelectionInput,
  generalizedFusion?: GeneralizedFusionSelectionInput,
  providedQueryAnalysis?: LanguageQueryAnalysis,
): { facts: FactMemory[]; traces: RecallCandidateTrace[] } {
  const queryAnalysis = providedQueryAnalysis ??
    language.analyzeQuery(query, queryLocale);
  const ranked = rankFactCandidates(
    buildFactCandidates(
      facts,
      query,
      language,
      queryLocale,
      referenceTime,
      semanticScores,
      evidenceCountsByMemoryId,
      queryAnalysis,
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
    usageScore: entry.usageScore,
    evidenceScore: entry.evidenceScore,
    outcomeScore: entry.outcomeScore,
    verificationPenaltyScore: entry.verificationPenaltyScore,
    ...(semanticUnion && entry.semanticScore > 0
      ? { semanticScore: entry.semanticScore }
      : {}),
    fallback: "none",
  }));
  const traceByMemoryId = new Map(
    traces.map((trace) => [trace.memoryId, trace] as const),
  );
  const compatible = ranked.filter(
    (entry) =>
      entry.fact.lifecycle === "active" &&
      language.localesCompatible(queryLocale, entry.locale),
  );
  let selectionPool = compatible;
  const draft = createSelectionDraft({ traces });
  const finish = (): { facts: FactMemory[]; traces: RecallCandidateTrace[] } => {
    if (generalizedFusion) {
      selectGeneralizedFusionCandidates({
        compatible: selectionPool,
        draft,
        union: generalizedFusion,
      });
    }
    if (semanticUnion) {
      selectSemanticUnionCandidates({
        compatible: selectionPool,
        draft,
        union: semanticUnion,
      });
    }
    finalizeSuppressionReasons({ compatible, traces });
    return {
      facts: draft.selected.map(materializeFactCandidate),
      traces,
    };
  };

  const pureReferenceQuery =
    routingDecision.requestedSlots.length > 0 &&
    routingDecision.requestedSlots.every((slot) => slot === "reference") &&
    !routingDecision.supportSlots.includes("project_state_support");
  if (pureReferenceQuery && !isReferencePreActionQuery(queryAnalysis)) {
    for (const trace of traces) {
      if (trace.whySuppressed === "not selected") {
        trace.whySuppressed = "reference-only query";
      }
    }
    return { facts: [], traces };
  }

  const factSlots = uniqueSlots([
    ...routingDecision.requestedSlots.filter((slot) => slot !== "reference"),
    ...routingDecision.supportSlots.filter(
      (slot) => slot === "project_state_support",
    ),
  ]);
  if (factSlots.length > 0) {
    const activeSlots: RecallSlot[] = [];
    const selectSlot = (
      slot: RecallSlot,
      allowUniqueFallback: boolean,
      aggregate = false,
    ): void => {
      activeSlots.push(slot);
      selectSlotFacts({
        ...(aggregate
          ? {
              aggregateLimit: AGGREGATE_OPEN_LOOP_LIMIT,
              aggregateSignal: (entry) =>
                entry.factKind === "open_loop" ||
                hasGenericFactSelectionSignal(entry),
            }
          : {}),
        allowUniqueFallback,
        entries: compatible,
        selectedIds: draft.selectedIds,
        selectAndTrace: draft.select,
        slot,
        strategy: routingDecision.strategy,
      });
    };

    if (
      factSlots.includes("role") &&
      (!profile?.identity.role || routingDecision.requestedSlots.length > 1)
    ) {
      selectSlot("role", false);
    } else if (factSlots.includes("role")) {
      activeSlots.push("role");
      for (const entry of compatible.filter(
        (candidate) => candidate.factKind === "role_update",
      )) {
        const trace = traceByMemoryId.get(entry.fact.id);
        if (trace?.whySuppressed === "not selected") {
          trace.whySuppressed = "profile satisfied role slot";
        }
      }
    }
    if (factSlots.includes("focus")) {
      selectSlot("focus", false);
    }
    if (factSlots.includes("blocker")) {
      selectSlot("blocker", false);
    }
    if (factSlots.includes("open_loop")) {
      selectSlot(
        "open_loop",
        false,
        isAggregateOpenLoopQuery(queryAnalysis),
      );
    }
    if (factSlots.includes("project_state_support")) {
      selectSlot("project_state_support", true);
    }

    for (const entry of compatible) {
      const trace = traceByMemoryId.get(entry.fact.id);
      if (!trace || trace.returned || trace.whySuppressed !== "not selected") {
        continue;
      }
      trace.whySuppressed = activeSlots.some((slot) => slotMatchesFact(entry, slot))
        ? "no slot signal"
        : "slot mismatch";
    }
    return finish();
  }

  selectionPool = collapseMutableCurrentValueCandidates({
    candidates: compatible,
    language,
    queryAnalysis,
  });
  if (queryAnalysis.userGroundedEventOrder) {
    selectionPool = selectionPool.filter((entry) => !hasAssistantAnswerTag(entry));
  }
  const aggregateCountQuery = queryAnalysis.aggregateCount;

  if (queryAnalysis.recommendationStyle) {
    for (const candidate of selectionPool
      .filter((entry) => hasRecommendationPreferenceSignal(entry, language))
      .slice(0, 2)) {
      draft.select(candidate);
    }
  } else if (queryAnalysis.answerComposition) {
    const projectStateCandidates = selectionPool.filter(
      (entry) =>
        entry.fact.category === "project" ||
        entry.fact.category === "technical",
    );
    const selectedProjectState = routingDecision.strategy === "llm-assisted"
      ? projectStateCandidates
          .filter(hasGenericFactSelectionSignal)
          .slice(0, GENERAL_FACT_RECALL_LIMIT)
      : projectStateCandidates.slice(0, 1);
    for (const candidate of selectedProjectState) {
      draft.select(candidate);
    }
  }

  if (draft.selected.length === 0) {
    const candidates = diversifyRankedFactCandidatesBySession(
      selectionPool.filter(
        aggregateCountQuery
          ? (entry) =>
              hasFactSelectionSignal(entry) ||
              (
                queryAnalysis.projectState &&
                (
                  entry.categoryBoost > 0 ||
                  entry.scopeKind === "project" ||
                  entry.factKind === "generic_project" ||
                  entry.factKind === "project_state"
                )
              )
          : hasGenericFactSelectionSignal,
      ),
      GENERAL_FACT_RECALL_LIMIT,
    );
    for (const candidate of candidates) {
      draft.select(candidate);
    }
  }

  selectZeroRetrievalLexicalFallback({ compatible: selectionPool, draft });
  selectTemporalCrossSessionCompanion({
    candidates: selectionPool,
    draft,
    enabled:
      queryAnalysis.directFactualLookup &&
      (queryAnalysis.before || queryAnalysis.after) &&
      language.parseTemporalExpressions(query, queryLocale).length === 0,
    language,
    query,
    queryLocale,
  });
  selectDirectFactualSessionCompanion({
    candidates: selectionPool,
    draft,
    directFactualLookup:
      !aggregateCountQuery &&
      queryAnalysis.directFactualLookup,
  });
  return finish();
}

function uniqueSlots(slots: readonly RecallSlot[]): RecallSlot[] {
  return [...new Set(slots)];
}

function isAggregateOpenLoopQuery(
  analysis: LanguageQueryAnalysis,
): boolean {
  return analysis.openLoop &&
    (analysis.aggregateCount || analysis.exhaustiveList);
}

function isReferencePreActionQuery(analysis: LanguageQueryAnalysis): boolean {
  return analysis.referenceSeeking && analysis.before && analysis.actionDriving;
}

function collapseMutableCurrentValueCandidates(input: {
  candidates: ReturnType<typeof buildFactCandidates>;
  language: LanguageService;
  queryAnalysis: LanguageQueryAnalysis;
}): ReturnType<typeof buildFactCandidates> {
  const directFactualLookup = input.queryAnalysis.directFactualLookup;
  const aggregateCountQuery = input.queryAnalysis.aggregateCount;
  if (!directFactualLookup && !aggregateCountQuery) {
    return input.candidates;
  }

  const latestBySlot = new Map<string, (typeof input.candidates)[number]>();
  for (const candidate of input.candidates) {
    if (hasConversationEvidenceTag(candidate)) {
      continue;
    }
    const slot = mutableCurrentValueSlot(candidate, input.language);
    if (slot === undefined) {
      continue;
    }
    const current = latestBySlot.get(slot);
    if (!current || factTimestamp(candidate) > factTimestamp(current)) {
      latestBySlot.set(slot, candidate);
    }
  }

  return input.candidates.filter((candidate) => {
    if (hasConversationEvidenceTag(candidate)) {
      return true;
    }
    const slot = mutableCurrentValueSlot(candidate, input.language);
    return slot === undefined ||
      latestBySlot.get(slot)?.fact.id === candidate.fact.id;
  });
}

function mutableCurrentValueSlot(
  candidate: ReturnType<typeof buildFactCandidates>[number],
  language: LanguageService,
): string | undefined {
  const subject = normalizedKnownSubject(
    candidate.subject,
    language,
    candidate.locale,
  );
  if (subject === undefined) {
    return undefined;
  }
  const { factKind } = candidate;
  if (
    factKind === "role_update" ||
    factKind === "focus_update" ||
    factKind === "project_state"
  ) {
    return `${factKind}\u0000${subject}`;
  }
  const claimKey = candidate.fact.attributes?.claimKey;
  if (typeof claimKey !== "string") {
    return undefined;
  }
  const normalizedClaimKey = language.normalizeForEquality(
    claimKey,
    candidate.locale,
  );
  return normalizedClaimKey.length > 0
    ? `claim\u0000${subject}\u0000${normalizedClaimKey}`
    : undefined;
}

function normalizedKnownSubject(
  subject: string,
  language: LanguageService,
  locale: string,
): string | undefined {
  const normalized = language.normalizeForEquality(subject, locale);
  return normalized.length === 0 || normalized === "unknown"
    ? undefined
    : normalized;
}

function factTimestamp(
  candidate: ReturnType<typeof buildFactCandidates>[number],
): number {
  const timestamp =
    candidate.fact.updatedAt ??
    candidate.fact.source.extractedAt ??
    candidate.fact.createdAt;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasRecommendationPreferenceSignal(
  candidate: ReturnType<typeof buildFactCandidates>[number],
  language: LanguageService,
): boolean {
  return language.analyzeContent(
    candidate.fact.content,
    candidate.locale,
  ).preferenceEvidence;
}

function selectDirectFactualSessionCompanion(input: {
  candidates: ReturnType<typeof buildFactCandidates>;
  directFactualLookup: boolean;
  draft: ReturnType<typeof createSelectionDraft>;
}): void {
  if (!input.directFactualLookup || input.draft.selected.length === 0) {
    return;
  }
  const selectedSessions = new Set(
    input.draft.selected
      .map(({ fact }) => fact.sessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
  );
  if (selectedSessions.size === 0) {
    return;
  }
  const companion = input.candidates.find(
    ({ fact }) =>
      !input.draft.selectedIds.has(fact.id) &&
      fact.source.method !== "inferred" &&
      fact.sessionId !== undefined &&
      selectedSessions.has(fact.sessionId),
  );
  if (companion) {
    input.draft.select(companion);
  }
}

function selectTemporalCrossSessionCompanion(input: {
  candidates: ReturnType<typeof buildFactCandidates>;
  draft: ReturnType<typeof createSelectionDraft>;
  enabled: boolean;
  language: LanguageService;
  query: string;
  queryLocale: string;
}): void {
  if (!input.enabled || input.draft.selected.length === 0) {
    return;
  }
  const selectedSessions = new Set(
    input.draft.selected
      .map(({ fact }) => fact.sessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
  );
  const queryTerms = new Set(
    input.language.buildSearchTerms(input.query, input.queryLocale),
  );
  if (selectedSessions.size === 0 || queryTerms.size === 0) {
    return;
  }
  const coveredQueryTerms = new Set(
    input.draft.selected.flatMap((candidate) =>
      input.language
        .buildSearchTerms(candidate.fact.content, candidate.locale)
        .filter((term) => queryTerms.has(term))
    ),
  );
  const uncoveredQueryTerms = new Set(
    [...queryTerms].filter((term) => !coveredQueryTerms.has(term)),
  );
  const companion = input.candidates.find((candidate) => {
    if (
      input.draft.selectedIds.has(candidate.fact.id) ||
      candidate.fact.source.method === "inferred" ||
      candidate.fact.sessionId === undefined ||
      selectedSessions.has(candidate.fact.sessionId)
    ) {
      return false;
    }
    return input.language
      .buildSearchTerms(candidate.fact.content, candidate.locale)
      .some((term) => uncoveredQueryTerms.has(term));
  });
  if (companion) {
    input.draft.select(
      companion,
      "generic",
      "cross_session_lexical_bridge",
    );
  }
}
