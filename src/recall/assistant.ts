import type {
  EpisodeMemory,
  FactMemory,
  ReferenceMemory,
} from "../domain/records";
import type { SessionArchive } from "../domain/evolutionRecords";
import type {
  RecallSource,
  RecallSlot,
  RoutingDecision,
} from "./router";
import {
  recallRerankCandidateKey,
  type RecallRerankCollection,
} from "./rerankPool";

export type RecallAssistantFallbackReason =
  | "empty_rerank"
  | "invalid_plan_sources"
  | "invalid_rerank_candidates"
  | "provider_error"
  | "schema_invalid"
  | "timeout"
  | "unsafe_suppress";

export type RecallAssistantFallbackStage = "plan" | "rerank";

export type RecallRouterInfluenceStatus =
  | "applied"
  | "full_fallback"
  | "partial_fallback";

export type RecallAssistantDecisionReason =
  | "continuation_support"
  | "query_alignment"
  | "reference_priority"
  | "role_mismatch"
  | "source_of_truth"
  | "task_blocker";

export interface RecallAssistantPlanInput {
  locale: string;
  query: string;
  routingDecision: RoutingDecision;
  runtime: {
    hasJournal: boolean;
    hasWorkingMemory: boolean;
  };
}

export interface RecallAssistantPlan {
  querySummary: string;
  rationale: string;
  requestedSlotAdditions?: RecallSlot[];
  sourcePriorityOrder?: RecallSource[];
  supportSlotAdditions?: RecallSlot[];
}

export interface RecallAssistantCandidate {
  id: string;
  protected: boolean;
  summary: string;
  type: "archive" | "episode" | "fact" | "reference";
}

export interface RecallAssistantCandidateBuildOptions {
  protectedCandidateIds?: ReadonlySet<string>;
}

export interface RecallAssistantRerankDecision {
  candidateId: string;
  decision: "promote" | "suppress";
  reason: RecallAssistantDecisionReason;
}

export interface RecallAssistantRerankInput {
  candidates: RecallAssistantCandidate[];
  locale: string;
  query: string;
  querySummary?: string;
  routingDecision: RoutingDecision;
}

export interface RecallAssistantRerank {
  decisions?: RecallAssistantRerankDecision[];
  orderedCandidateIds: string[];
  rationale: string;
  suppressCandidateIds?: string[];
}

export interface RecallRouterAssistant {
  plan(input: RecallAssistantPlanInput): Promise<RecallAssistantPlan>;
  rerank(input: RecallAssistantRerankInput): Promise<RecallAssistantRerank>;
}

export interface RecallAssistantProviderDiagnostic {
  message: string;
  reason: RecallAssistantFallbackReason;
  stage: RecallAssistantFallbackStage;
  validationIssueSummary?: string;
}

export interface RecallAssistantInfluence {
  addedRequestedSlots: RecallSlot[];
  addedSupportSlots: RecallSlot[];
  decisions: RecallAssistantRerankDecision[];
  fallbackStage?: RecallAssistantFallbackStage;
  fallbackReason?: RecallAssistantFallbackReason;
  planApplied: boolean;
  providerDiagnostics?: RecallAssistantProviderDiagnostic[];
  querySummary?: string;
  rationale?: string;
  rerankApplied: boolean;
  rerankedCandidateIds: string[];
  routerInfluenceStatus?: RecallRouterInfluenceStatus;
  sourcePrioritiesAfter?: RecallSource[];
  sourcePrioritiesBefore?: RecallSource[];
  suppressedCandidateIds: string[];
}

export interface RecallAssistantDurableSelection {
  archives: SessionArchive[];
  episodes: EpisodeMemory[];
  facts: FactMemory[];
  references: ReferenceMemory[];
}

const PROTECTED_FACT_KINDS: ReadonlySet<FactMemory["factKind"]> = new Set([
  "blocker",
  "focus_update",
  "open_loop",
  "project_state",
  "role_update",
]);

const PROTECTED_REFERENCE_KINDS: ReadonlySet<ReferenceMemory["referenceKind"]> =
  new Set([
    "runbook",
    "source_of_truth",
  ]);

function reorderSources(
  existing: RecallSource[],
  proposed?: RecallSource[],
): {
  changed: boolean;
  fallbackReason?: RecallAssistantFallbackReason;
  next: RecallSource[];
} {
  if (!proposed || proposed.length === 0) {
    return { changed: false, next: existing };
  }

  const existingSet = new Set(existing);
  if (proposed.some((source) => !existingSet.has(source))) {
    return {
      changed: false,
      fallbackReason: "invalid_plan_sources",
      next: existing,
    };
  }

  const next = [
    ...new Set([
      ...proposed,
      ...existing,
    ]),
  ];

  if (
    next.length === existing.length &&
    next.every((source, index) => source === existing[index])
  ) {
    return { changed: false, next: existing };
  }

  return {
    changed: true,
    next,
  };
}

function mergeSlots<TSlot extends RecallSlot>(
  existing: TSlot[],
  additions?: TSlot[],
): TSlot[] {
  if (!additions || additions.length === 0) {
    return existing;
  }

  return [...new Set([...existing, ...additions])];
}

export function resolveRecallRouterInfluenceStatus(
  influence: Pick<
    RecallAssistantInfluence,
    "fallbackReason" | "planApplied" | "rerankApplied"
  >,
): RecallRouterInfluenceStatus {
  if (influence.fallbackReason) {
    return influence.planApplied || influence.rerankApplied
      ? "partial_fallback"
      : "full_fallback";
  }

  return "applied";
}

function withInfluenceStatus(
  influence: RecallAssistantInfluence,
): RecallAssistantInfluence {
  return {
    ...influence,
    routerInfluenceStatus: resolveRecallRouterInfluenceStatus(influence),
  };
}

export function applyRecallAssistantPlan(input: {
  influence: RecallAssistantInfluence;
  plan: RecallAssistantPlan;
  routingDecision: RoutingDecision;
}): {
  influence: RecallAssistantInfluence;
  routingDecision: RoutingDecision;
} {
  const reorderedSources = reorderSources(
    input.routingDecision.sourcePriorities,
    input.plan.sourcePriorityOrder,
  );
  const requestedSlots = mergeSlots(
    input.routingDecision.requestedSlots,
    input.plan.requestedSlotAdditions,
  );
  const supportSlots = mergeSlots(
    input.routingDecision.supportSlots,
    input.plan.supportSlotAdditions,
  );
  const addedRequestedSlots = requestedSlots.filter(
    (slot) => !input.routingDecision.requestedSlots.includes(slot),
  );
  const addedSupportSlots = supportSlots.filter(
    (slot) => !input.routingDecision.supportSlots.includes(slot),
  );
  const planApplied =
    reorderedSources.changed ||
    addedRequestedSlots.length > 0 ||
    addedSupportSlots.length > 0;

  return {
    routingDecision: {
      ...input.routingDecision,
      requestedSlots,
      sourcePriorities: reorderedSources.next,
      supportSlots,
    },
    influence: withInfluenceStatus({
      ...input.influence,
      addedRequestedSlots,
      addedSupportSlots,
      fallbackReason:
        reorderedSources.fallbackReason ?? input.influence.fallbackReason,
      planApplied,
      querySummary: input.plan.querySummary.trim(),
      rationale: input.plan.rationale.trim(),
      sourcePrioritiesAfter: reorderedSources.changed
        ? reorderedSources.next
        : undefined,
      sourcePrioritiesBefore: reorderedSources.changed
        ? input.routingDecision.sourcePriorities
        : undefined,
    }),
  };
}

function candidateSummary(record: {
  type: "archive" | "episode" | "fact" | "reference";
  value: EpisodeMemory | FactMemory | ReferenceMemory | SessionArchive;
}): string {
  if (record.type === "reference") {
    const reference = record.value as ReferenceMemory;
    return `${reference.title} ${reference.pointer}`.trim();
  }
  if (record.type === "archive") {
    const archive = record.value as SessionArchive;
    return [
      archive.summary,
      ...archive.unresolvedItems,
      ...archive.keyDecisions,
    ].join(" ").trim();
  }
  if (record.type === "episode") {
    const episode = record.value as EpisodeMemory;
    return [episode.summary, ...episode.topics].join(" ").trim();
  }

  return (record.value as FactMemory).content.trim();
}

function isProtectedFactCandidate(fact: FactMemory): boolean {
  return fact.factKind ? PROTECTED_FACT_KINDS.has(fact.factKind) : false;
}

function isProtectedReferenceCandidate(reference: ReferenceMemory): boolean {
  return reference.referenceKind
    ? PROTECTED_REFERENCE_KINDS.has(reference.referenceKind)
    : false;
}

function isProtectedArchiveCandidate(archive: SessionArchive): boolean {
  return archive.keyDecisions.length > 0 || archive.unresolvedItems.length > 0;
}

function isProtectedEpisodeCandidate(episode: EpisodeMemory): boolean {
  return episode.keyDecisions.length > 0 || episode.unresolvedItems.length > 0;
}

function isProtectedCandidate(input: {
  id: string;
  options?: RecallAssistantCandidateBuildOptions;
  semanticProtected: boolean;
}): boolean {
  return Boolean(
    input.semanticProtected ||
      input.options?.protectedCandidateIds?.has(input.id),
  );
}

function assistantCollection(
  type: RecallAssistantCandidate["type"],
): RecallRerankCollection {
  return type === "archive" ? "session_archives" :
    type === "episode" ? "episodes" :
    type === "reference" ? "references" :
    "facts";
}

function assistantCandidateId(input: {
  memoryId: string;
  type: RecallAssistantCandidate["type"];
}): string {
  return recallRerankCandidateKey(
    assistantCollection(input.type),
    input.memoryId,
  );
}

export function buildRecallAssistantCandidates(
  selection: RecallAssistantDurableSelection,
  options?: RecallAssistantCandidateBuildOptions,
): RecallAssistantCandidate[] {
  const records = [
    ...selection.facts.map((value) => ({ type: "fact" as const, value })),
    ...selection.references.map((value) => ({
      type: "reference" as const,
      value,
    })),
    ...selection.archives.map((value) => ({ type: "archive" as const, value })),
    ...selection.episodes.map((value) => ({ type: "episode" as const, value })),
  ];
  return records.map(({ type, value }) => {
    const id = recallRerankCandidateKey(assistantCollection(type), value.id);
    const semanticProtected = type === "fact"
      ? isProtectedFactCandidate(value as FactMemory)
      : type === "reference"
        ? isProtectedReferenceCandidate(value as ReferenceMemory)
        : type === "archive"
          ? isProtectedArchiveCandidate(value as SessionArchive)
          : isProtectedEpisodeCandidate(value as EpisodeMemory);
    return {
      id,
      protected: isProtectedCandidate({
        id,
        options,
        semanticProtected,
      }),
      summary: candidateSummary({ type, value }),
      type,
    };
  });
}

function validateOrderedIds(
  orderedCandidateIds: string[],
  candidateIds: Set<string>,
): boolean {
  if (orderedCandidateIds.length === 0) {
    return false;
  }

  const seen = new Set<string>();
  for (const candidateId of orderedCandidateIds) {
    if (!candidateIds.has(candidateId) || seen.has(candidateId)) {
      return false;
    }
    seen.add(candidateId);
  }

  return true;
}

function normalizeCandidateId(candidateId: string): string | undefined {
  const normalized = candidateId.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeCandidateIdList(candidateIds: string[] | undefined): string[] {
  if (!candidateIds) {
    return [];
  }

  return candidateIds
    .map((candidateId) => normalizeCandidateId(candidateId) ?? "")
    .filter((candidateId) => candidateId.length > 0);
}

function alignExecutedRerankDecisions(input: {
  decisions: RecallAssistantRerankDecision[];
  retainedCandidateIds: readonly string[];
  suppressedCandidateIds: readonly string[];
}): RecallAssistantRerankDecision[] {
  if (input.decisions.length === 0) {
    return [];
  }

  const retainedCandidateIds = new Set(input.retainedCandidateIds);
  const suppressedCandidateIds = new Set(input.suppressedCandidateIds);
  const alignedDecisions: RecallAssistantRerankDecision[] = [];
  const seenCandidateIds = new Set<string>();

  for (const decision of input.decisions) {
    if (seenCandidateIds.has(decision.candidateId)) {
      continue;
    }

    const executedDecision = suppressedCandidateIds.has(decision.candidateId)
      ? "suppress"
      : retainedCandidateIds.has(decision.candidateId)
        ? "promote"
        : undefined;
    if (!executedDecision || decision.decision !== executedDecision) {
      continue;
    }

    alignedDecisions.push(decision);
    seenCandidateIds.add(decision.candidateId);
  }

  return alignedDecisions;
}

export function applyRecallAssistantRerank(input: {
  influence: RecallAssistantInfluence;
  protectedCandidateIds?: ReadonlySet<string>;
  rerank: RecallAssistantRerank;
  selection: RecallAssistantDurableSelection;
}): {
  influence: RecallAssistantInfluence;
  selection: RecallAssistantDurableSelection;
} {
  const candidates = buildRecallAssistantCandidates(input.selection, {
    protectedCandidateIds: input.protectedCandidateIds,
  });
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const orderedCandidateIds = normalizeCandidateIdList(input.rerank.orderedCandidateIds);

  if (!validateOrderedIds(orderedCandidateIds, candidateIds)) {
    return {
      selection: input.selection,
      influence: withInfluenceStatus({
        ...input.influence,
        fallbackReason: "invalid_rerank_candidates",
        fallbackStage: "rerank",
      }),
    };
  }

  const suppressCandidateIds = [
    ...new Set(normalizeCandidateIdList(input.rerank.suppressCandidateIds)),
  ];
  if (suppressCandidateIds.some((candidateId) => !candidateIds.has(candidateId))) {
    return {
      selection: input.selection,
      influence: withInfluenceStatus({
        ...input.influence,
        fallbackReason: "invalid_rerank_candidates",
        fallbackStage: "rerank",
      }),
    };
  }
  if (
    candidates.some(
      (candidate) =>
        candidate.protected && suppressCandidateIds.includes(candidate.id),
    )
  ) {
    return {
      selection: input.selection,
      influence: withInfluenceStatus({
        ...input.influence,
        fallbackReason: "unsafe_suppress",
        fallbackStage: "rerank",
      }),
    };
  }

  const retainedIds = orderedCandidateIds.filter(
    (candidateId) => !suppressCandidateIds.includes(candidateId),
  );
  if (retainedIds.length === 0) {
    return {
      selection: input.selection,
      influence: withInfluenceStatus({
        ...input.influence,
        fallbackReason: "empty_rerank",
        fallbackStage: "rerank",
      }),
    };
  }

  const decisions = alignExecutedRerankDecisions({
    decisions:
      input.rerank.decisions
        ?.map((decision) => {
          const candidateId = normalizeCandidateId(decision.candidateId);
          if (!candidateId || !candidateIds.has(candidateId)) {
            return undefined;
          }

          return {
            ...decision,
            candidateId,
          };
        })
        .filter((decision): decision is NonNullable<typeof decision> => Boolean(decision)) ?? [],
    retainedCandidateIds: retainedIds,
    suppressedCandidateIds: suppressCandidateIds,
  });

  const order = new Map(retainedIds.map((candidateId, index) => [candidateId, index]));
  const reorderByIds = <TRecord extends { id: string }>(
    type: RecallAssistantCandidate["type"],
    records: TRecord[],
  ) =>
    records
      .filter((record) =>
        !suppressCandidateIds.includes(assistantCandidateId({
          memoryId: record.id,
          type,
        }))
      )
      .sort((left, right) => {
        const leftRank = order.get(assistantCandidateId({
          memoryId: left.id,
          type,
        })) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = order.get(assistantCandidateId({
          memoryId: right.id,
          type,
        })) ?? Number.MAX_SAFE_INTEGER;
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }

        return 0;
      });

  return {
    selection: {
      facts: reorderByIds("fact", input.selection.facts),
      references: reorderByIds("reference", input.selection.references),
      archives: reorderByIds("archive", input.selection.archives),
      episodes: reorderByIds("episode", input.selection.episodes),
    },
    influence: withInfluenceStatus({
      ...input.influence,
      decisions,
      rationale: input.rerank.rationale.trim() || input.influence.rationale,
      rerankApplied: true,
      rerankedCandidateIds: retainedIds,
      suppressedCandidateIds: suppressCandidateIds,
    }),
  };
}
