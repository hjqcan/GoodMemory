import type {
  EpisodeMemory,
  FactMemory,
  FeedbackMemory,
  PreferenceMemory,
  ReferenceMemory,
  SessionJournal,
  UserProfile,
  WorkingMemorySnapshot,
} from "../domain/records";
import type { MemoryScope } from "../domain/scope";
import type { MemorySourceMethod } from "../domain/provenance";
import type { EmbeddingAdapter } from "../embedding/contracts";
import type { EvidenceRecord } from "../evidence/contracts";
import type { SessionArchive } from "../domain/evolutionRecords";
import { createLanguageService } from "../language";
import type {
  LanguageQueryAnalysis,
  LanguageService,
  ResolvedLanguageContext,
} from "../language";
import type { GoodMemoryPolicyHooks } from "../policy/hooks";
import type {
  RecallRepositoryPort,
  RecallRuntimePort,
  RecallVectorSearchPort,
} from "../storage/ports";
import {
  evaluateVerificationHints,
  type VerificationHint,
} from "../verify/policy";
import {
  buildMemoryPacket,
  type MemoryPacket,
} from "./contextBuilder";
import {
  buildEvidenceLedger,
  type EvidenceLedgerEntry,
} from "./evidenceLedger";
import {
  applyRecallAssistantPlan,
  applyRecallAssistantRerank,
  buildRecallAssistantCandidates,
  type RecallAssistantFallbackReason,
  type RecallAssistantInfluence,
  type RecallAssistantFallbackStage,
  type RecallAssistantProviderDiagnostic,
  type RecallRouterAssistant,
  resolveRecallRouterInfluenceStatus,
} from "./assistant";
import {
  attachEvidenceIdsToCandidateTraces,
  buildEvidenceLinkIndex,
  buildHits,
  collectSessionScopedEvidence,
  collectTraceMemoryIds,
  filterLinkedEvidence,
  selectEvidence,
} from "./evidence";
import {
  applyRecallPolicyToProfile,
  applyRecallPolicyToRecords,
  filterRecordsByDefaultRecallScope,
  reconcileCandidateTraces,
} from "./policy";
import {
  planRecall,
  type RecallRouterStrategy,
  resolveRecallRoutingWarningMessages,
  resolveRetrievalProfile,
  type RecallSlot,
  type RetrievalProfile,
  SEMANTIC_RECALL_INACTIVE_WARNING,
  type RoutingDecision,
} from "./router";
import type {
  RecallFusionRunTrace,
  RecallRetrievalChannelTrace,
  RecallRetrievalTrace,
} from "./retrievalTrace";
import {
  resolveRecallPlan,
  type RecallPlan,
  type RecallPlanAssistant,
} from "./recallPlan";
import { ProviderBackedRecallError } from "./errors";
import { computeBm25Scores } from "./bm25";
import {
  claimProjectionGroupKey,
  fuseGeneralizedRecallCandidates,
} from "./generalizedFusion";
import {
  admitGeneralizedRecords,
  isGeneralizedCandidateTraceEligible,
} from "./generalizedAdmissions";
import type {
  GeneralizedFusionCandidate,
  GeneralizedFusionChannel,
  GeneralizedFusionChannelEvidence,
  GeneralizedFusionResult,
} from "./generalizedFusion";
import type { GeneralizedFusionSelectionInput } from "./factSelection/generalizedFusionUnion";
import {
  findAmbiguousRecallRerankMemoryIds,
  matchesRecallRerankCandidateId,
  normalizeRecallRerankText,
  recallRerankCandidateKey,
  setRecallRerankPool,
  type RecallRerankCandidate,
  type RecallRerankCollection,
} from "./rerankPool";
import {
  selectGeneralizedFactsForInternalUse,
} from "./generalizedSelection";
import type { FactSelector } from "./generalizedSelection";
import type {
  ClaimProjection,
  RecallIndexDocument,
  RecallProjectionSearchPort,
} from "./projections/contracts";
import {
  searchSemanticScores,
  type SemanticSearchScores,
} from "./scoring";
import {
  selectArchives,
  selectEpisodes,
  selectFeedbackForQuery,
  selectPreferencesForQuery,
  selectReferences,
} from "./selection";

export interface RecallInput {
  scope: MemoryScope;
  query: string;
  retrievalProfile?: RetrievalProfile;
  strategy?: RecallRouterStrategy;
  includeEvidence?: boolean;
  ignoreMemory?: boolean;
  locale?: string;
  rerank?: boolean;
  /** Request-local plan shared by API orchestration and each retrieval hop. */
  recallPlan?: RecallPlan;
  /** Internal request-local language context; public callers should omit it. */
  languageContext?: ResolvedLanguageContext;
  /** Internal request-local query analysis; public callers should omit it. */
  queryAnalysis?: LanguageQueryAnalysis;
  /**
   * Optional per-call temporal anchor (ISO-8601). When set to a parseable
   * timestamp it replaces the config clock for this recall: plan resolution,
   * temporal claim selection, document visibility, and freshness all anchor
   * to it. Invalid values fall back to the config clock.
   */
  referenceTime?: string;
}

export interface RecallHit {
  id: string;
  type:
    | "profile"
    | "preference"
    | "reference"
    | "fact"
    | "feedback"
    | "evidence"
    | "session_archive"
    | "episode"
    | "working_memory"
    | "session_journal";
  score?: number;
  reason?: string;
  sourceMethod?: MemorySourceMethod;
  evidenceIds?: string[];
}

export interface RecallCandidateTrace {
  memoryId: string;
  memoryType: "fact" | "reference" | "archive" | "episode";
  slot: RecallSlot | "generic";
  returned: boolean;
  whyReturned?: string;
  whySuppressed?: string;
  intentScore: number;
  lexicalScore: number;
  freshnessScore: number;
  explicitnessScore: number;
  usageScore?: number;
  evidenceScore?: number;
  outcomeScore?: number;
  verificationPenaltyScore?: number;
  // Normalized semantic similarity of this candidate. Emitted ONLY when the
  // semantic-candidates union feature is active for the call, so traces of
  // rules-only / BM25-only / union-off runs serialize byte-identically to the
  // pre-union engine.
  semanticScore?: number;
  fallback:
    | "none"
    | "same_slot_unique_candidate"
    | "zero_retrieval_lexical"
    | "cross_session_lexical_bridge"
    | "semantic_union"
    | "generalized_fusion";
  evidenceIds?: string[];
}

export interface RecallResult {
  profile: UserProfile | null;
  preferences: PreferenceMemory[];
  references: ReferenceMemory[];
  facts: FactMemory[];
  feedback: FeedbackMemory[];
  archives: SessionArchive[];
  evidence: EvidenceRecord[];
  evidenceLedger?: EvidenceLedgerEntry[];
  episodes: EpisodeMemory[];
  workingMemory: WorkingMemorySnapshot | null;
  journal: SessionJournal | null;
  packet: MemoryPacket;
  metadata: {
    assistantInfluence?: RecallAssistantInfluence;
    routingDecision: RoutingDecision;
    tokenCount: number;
    latencyMs: number;
    hits: RecallHit[];
    candidateTraces: RecallCandidateTrace[];
    verificationHints: VerificationHint[];
    policyApplied: string[];
    locale?: string;
    localeSource?: "explicit" | "detected" | "default";
    languagePackId?: string;
    languagePackVersion?: string;
    analysisMode?: "rules-only";
    retrievalTrace?: RecallRetrievalTrace;
  };
}

// Opt-in second candidate SOURCE: the cosine top-K facts from the vector index
// are force-admitted into fact selection regardless of lexical/intent/subject
// signal, under strategy=hybrid with an embedding adapter + vector index only.
// This is the only mechanism that can surface a zero-lexical-overlap fact:
// every admission gate in fact selection keys on lexical/intent/subject
// signals, and the additive semanticScore only re-ranks already-admitted
// candidates. Off by default; when unset, recall behavior is byte-identical.
export interface RecallSemanticCandidatesConfig {
  // Vector-store fetch size for the union source (the additive-ranking fetch
  // becomes max(8, topK)). Default 8.
  topK?: number;
  // RAW vector-store score floor (dot/inner product; equals cosine only for
  // unit-normalized embeddings). Default: no floor.
  minSimilarity?: number;
  // Relative score floor. When set, admit only union candidates whose raw store
  // score is at least bestRawScore * minRelativeScore. This is an opt-in noise
  // control for widened semantic admission budgets. Default: no relative floor.
  minRelativeScore?: number;
  // Noise budget: maximum facts ADMITTED BY THE UNION per recall. Candidates
  // that deduped against route/augmenter/fallback selections or failed the
  // compatible-pool check consume no budget. Default: topK.
  maxAdditions?: number;
}

export interface RecallGeneralizedFusionConfig {
  // Omit to enable lexical, dense, entity, temporal, and relation channels.
  channels?: readonly GeneralizedFusionChannel[];
  // Per-lane caps for fused non-fact records admitted into the packet
  // (references / episodes / session archives). Defaults stay at the
  // conservative 1 / 2 / 1; raise them only behind measurement — episode and
  // archive records are token-expensive context.
  contentLaneRecords?: {
    episodes?: number;
    references?: number;
    sessionArchives?: number;
  };
  // Global cap for the fused content-candidate set. This is an additive recall
  // budget, not a cap on records already selected by the baseline selectors.
  maxCandidates?: number;
  // Caps baseline plus generalized facts. Other content lanes keep their own
  // small record limits.
  maxTotalFacts?: number;
  minRelativeStrength?: number;
  rrfK?: number;
}

function canonicalFactMemoryId(fact: FactMemory): string {
  const sourceMemoryId = fact.attributes?.sourceMemoryId;
  return typeof sourceMemoryId === "string" ? sourceMemoryId : fact.id;
}

const COMPLEX_QUERY_CANDIDATE_BONUS = 4;
const COMPLEX_QUERY_FACT_BONUS = 2;

export function resolveGeneralizedFusionBudget(input: {
  base: RecallGeneralizedFusionConfig;
  plan: RecallPlan;
}): {
  expanded: boolean;
  maxCandidates: number;
  maxTotalFacts: number;
} {
  const expanded =
    input.plan.maxHops > 1 ||
    input.plan.uncertainty === "high";
  const baseCandidates =
    input.base.maxCandidates ?? input.plan.preRankLimit;
  const baseFacts = input.base.maxTotalFacts ?? input.plan.selectedLimit;

  return {
    expanded,
    maxCandidates: Math.min(
      input.plan.preRankLimit,
      baseCandidates + (expanded ? COMPLEX_QUERY_CANDIDATE_BONUS : 0),
    ),
    maxTotalFacts: Math.min(
      input.plan.preRankLimit,
      baseFacts + (expanded ? COMPLEX_QUERY_FACT_BONUS : 0),
    ),
  };
}

export interface RecallEngineConfig {
  assistedRouter?: RecallRouterAssistant;
  embedding?: EmbeddingAdapter;
  /** Instance-scoped internal override used only by repo-local historical evals. */
  factSelector?: FactSelector;
  // Opt-in: when set (and no neural semantic search runs), populate the additive
  // ranking slot with Okapi BM25 over the in-memory candidate pool for
  // non-rules-only strategies. Off by default, so rules-only/hybrid ranking is
  // unchanged unless explicitly enabled.
  bm25Ranking?: boolean;
  generalizedFusion?: RecallGeneralizedFusionConfig;
  rerankGeneralizedFusion?: RecallGeneralizedFusionConfig;
  // Set by retrieval.preset resolution (never a public per-call knob): biases
  // "auto" routing to hybrid whenever semantic search is available, so the
  // semantic union fires without an explicit per-call strategy.
  autoStrategyBias?: "hybrid";
  // Opt-in semantic candidate-generation union (see the config type above).
  semanticCandidates?: RecallSemanticCandidatesConfig;
  language?: LanguageService;
  repositories: RecallRepositoryPort & { vectorIndex?: RecallVectorSearchPort | null };
  runtime: RecallRuntimePort;
  vectorIndex?: RecallVectorSearchPort | null;
  now?: () => number;
  policy?: Pick<GoodMemoryPolicyHooks, "shouldRecall">;
  projectionIndex?: RecallProjectionSearchPort;
  recallPlanner?: RecallPlanAssistant;
  referenceTime?: () => string;
}

export function resolveActiveGeneralizedFusionConfig(input: {
  base?: RecallGeneralizedFusionConfig;
  rerank: boolean;
  reranking?: RecallGeneralizedFusionConfig;
}): RecallGeneralizedFusionConfig | undefined {
  return input.rerank ? input.reranking ?? input.base : input.base;
}

const MAX_FUSION_TRACE_CANDIDATES = 20;

function cloneFusionChannel(
  channel: GeneralizedFusionChannelEvidence | undefined,
): RecallRetrievalChannelTrace | undefined {
  return channel
    ? {
        ...channel,
        evidenceDocumentIds: [...channel.evidenceDocumentIds],
      }
    : undefined;
}

function buildFusionRunTrace(input: {
  coverageComplete: boolean;
  maxCandidates: number | undefined;
  result: GeneralizedFusionResult;
}): RecallFusionRunTrace {
  const selectedKeys = new Set(
    input.result.candidates.map(
      (candidate) => `${candidate.sourceCollection}:${candidate.sourceMemoryId}`,
    ),
  );
  const traceLimit = Math.min(
    MAX_FUSION_TRACE_CANDIDATES,
    Math.max(input.result.budget, input.maxCandidates ?? 8) * 2,
  );
  return {
    budget: input.result.budget,
    candidateCount: input.result.rankedCandidates.length,
    candidates: input.result.rankedCandidates.slice(0, traceLimit).map((candidate) => ({
      channels: {
        ...(candidate.channels.dense
          ? { dense: cloneFusionChannel(candidate.channels.dense)! }
          : {}),
        ...(candidate.channels.entity
          ? { entity: cloneFusionChannel(candidate.channels.entity)! }
          : {}),
        ...(candidate.channels.lexical
          ? { lexical: cloneFusionChannel(candidate.channels.lexical)! }
          : {}),
        ...(candidate.channels.relation
          ? { relation: cloneFusionChannel(candidate.channels.relation)! }
          : {}),
        ...(candidate.channels.temporal
          ? { temporal: cloneFusionChannel(candidate.channels.temporal)! }
          : {}),
      },
      evidenceTypes: (Object.keys(candidate.channels) as Array<
        keyof typeof candidate.channels
      >).sort(),
      evidenceStrength: candidate.evidenceStrength,
      fusionScore: candidate.score,
      selected: selectedKeys.has(
        `${candidate.sourceCollection}:${candidate.sourceMemoryId}`,
      ),
      sourceCollection: candidate.sourceCollection,
      sourceMemoryId: candidate.sourceMemoryId,
    })),
    projectionCoverage: input.coverageComplete ? "complete" : "partial",
    status: "applied",
  };
}

interface DurableRecallSelection {
  archives: SessionArchive[];
  episodes: EpisodeMemory[];
  facts: FactMemory[];
  references: ReferenceMemory[];
}

function durableSelectionKeys(
  selection: DurableRecallSelection,
): Set<string> {
  return new Set([
    ...selection.facts.map(({ id }) => recallRerankCandidateKey("facts", id)),
    ...selection.references.map(({ id }) =>
      recallRerankCandidateKey("references", id)
    ),
    ...selection.episodes.map(({ id }) =>
      recallRerankCandidateKey("episodes", id)
    ),
    ...selection.archives.map(({ id }) =>
      recallRerankCandidateKey("session_archives", id)
    ),
  ]);
}

function reconcileFusionTraceSelection(
  retrievalTrace: RecallRetrievalTrace | undefined,
  selection: DurableRecallSelection,
  additional: {
    feedback: FeedbackMemory[];
    preferences: PreferenceMemory[];
    profile: UserProfile | null;
  },
): RecallRetrievalTrace | undefined {
  if (!retrievalTrace?.fusionRuns) {
    return retrievalTrace;
  }
  const selectedKeys = durableSelectionKeys(selection);
  for (const preference of additional.preferences) {
    selectedKeys.add(`preferences:${preference.id}`);
  }
  for (const feedback of additional.feedback) {
    selectedKeys.add(`feedback:${feedback.id}`);
  }
  if (additional.profile) {
    selectedKeys.add(`profiles:${additional.profile.userId}`);
  }
  return {
    ...retrievalTrace,
    fusionRuns: retrievalTrace.fusionRuns.map((run) => ({
      ...run,
      candidates: run.candidates.map((candidate) => {
        const selected = selectedKeys.has(
          recallRerankCandidateKey(
            candidate.sourceCollection as RecallRerankCollection,
            candidate.sourceMemoryId,
          ),
        );
        const { eliminationReason: _eliminationReason, ...base } = candidate;
        return selected
          ? { ...base, selected: true }
          : {
              ...base,
              eliminationReason: "not_selected" as const,
              selected: false,
            };
      }),
    })),
  };
}

function collectUnseenFusionRecords<T extends { id: string }>(input: {
  candidates: readonly GeneralizedFusionCandidate[];
  collection: RecallRerankCollection;
  evaluatedIds: ReadonlySet<string>;
  records: readonly T[];
  suppressedIds: ReadonlySet<string>;
  traces: readonly RecallCandidateTrace[];
}): T[] {
  const recordsById = new Map(input.records.map((record) => [record.id, record]));
  const tracesById = new Map(input.traces.map((trace) => [trace.memoryId, trace]));
  return input.candidates.flatMap((candidate) => {
    if (
      candidate.sourceCollection !== input.collection ||
      input.evaluatedIds.has(candidate.sourceMemoryId) ||
      input.suppressedIds.has(recallRerankCandidateKey(
        input.collection,
        candidate.sourceMemoryId,
      ))
    ) {
      return [];
    }
    const record = recordsById.get(candidate.sourceMemoryId);
    return record &&
        isGeneralizedCandidateTraceEligible(
          tracesById.get(candidate.sourceMemoryId),
        )
      ? [record]
      : [];
  });
}

function buildRecallRerankCandidates(input: {
  candidates: readonly GeneralizedFusionCandidate[];
  claims: readonly ClaimProjection[];
  documents: readonly RecallIndexDocument[];
  pool: DurableRecallSelection;
  selected: DurableRecallSelection;
}): RecallRerankCandidate[] {
  const recordsByCollection: Record<
    RecallRerankCollection,
    Map<string, RecallRerankCandidate["record"]>
  > = {
    facts: new Map(input.pool.facts.map((record) => [record.id, record])),
    references: new Map(
      input.pool.references.map((record) => [record.id, record]),
    ),
    episodes: new Map(input.pool.episodes.map((record) => [record.id, record])),
    session_archives: new Map(
      input.pool.archives.map((record) => [record.id, record]),
    ),
  };
  const retrievalTextByKey = new Map<string, string>();
  const addRetrievalText = (key: string, values: readonly (string | undefined)[]) => {
    const text = normalizeRecallRerankText([
      retrievalTextByKey.get(key),
      ...values,
    ]);
    if (text) {
      retrievalTextByKey.set(key, text);
    }
  };
  for (const document of input.documents) {
    if (!(document.sourceCollection in recordsByCollection)) {
      continue;
    }
    addRetrievalText(
      recallRerankCandidateKey(
        document.sourceCollection as RecallRerankCollection,
        document.sourceMemoryId,
      ),
      [document.text],
    );
  }
  for (const claim of input.claims) {
    addRetrievalText(
      recallRerankCandidateKey("facts", claim.sourceMemoryId),
      [
        claim.contextualDescriptor,
        claim.predicateKey,
        claim.objectText,
        claim.validFrom,
        claim.validUntil,
      ],
    );
  }
  const selectedKeys = durableSelectionKeys(input.selected);
  const result: RecallRerankCandidate[] = [];
  const added = new Set<string>();
  for (const candidate of input.candidates) {
    if (!(candidate.sourceCollection in recordsByCollection)) {
      continue;
    }
    const collection = candidate.sourceCollection as RecallRerankCollection;
    const record = recordsByCollection[collection].get(candidate.sourceMemoryId);
    const key = recallRerankCandidateKey(collection, candidate.sourceMemoryId);
    if (!record || added.has(key)) {
      continue;
    }
    result.push({
      collection,
      firstStageScore: candidate.score,
      firstStageSelected: selectedKeys.has(key),
      key,
      record,
      retrievalText: retrievalTextByKey.get(key),
    });
    added.add(key);
  }
  for (const [collection, records] of [
    ["facts", input.selected.facts],
    ["references", input.selected.references],
    ["episodes", input.selected.episodes],
    ["session_archives", input.selected.archives],
  ] as const) {
    for (const record of records) {
      const key = recallRerankCandidateKey(collection, record.id);
      if (added.has(key)) {
        continue;
      }
      result.push({
        collection,
        firstStageSelected: true,
        key,
        record,
        retrievalText: retrievalTextByKey.get(key),
      });
      added.add(key);
    }
  }
  return result;
}

function buildEvidenceCountByMemoryId(
  evidence: EvidenceRecord[],
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const record of evidence) {
    for (const memoryId of record.linkedMemoryIds) {
      counts.set(memoryId, (counts.get(memoryId) ?? 0) + 1);
    }
  }

  return counts;
}

function buildEmptyAssistantInfluence(): RecallAssistantInfluence {
  return {
    addedRequestedSlots: [],
    addedSupportSlots: [],
    decisions: [],
    planApplied: false,
    rerankApplied: false,
    rerankedCandidateIds: [],
    routerInfluenceStatus: "full_fallback",
    suppressedCandidateIds: [],
  };
}

function resolveAssistantFallbackReason(error: unknown): RecallAssistantFallbackReason {
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  if (message.includes("schema validation failed")) {
    return "schema_invalid";
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return "timeout";
  }

  return "provider_error";
}

function summarizeAssistantProviderError(error: unknown): string {
  const rawMessage =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : String(error);

  return rawMessage.replace(/\s+/g, " ").trim().slice(0, 240);
}

function extractValidationIssueSummary(message: string): string | undefined {
  const marker = "schema validation failed:";
  const index = message.toLowerCase().indexOf(marker);
  if (index === -1) {
    return undefined;
  }

  return message.slice(index + marker.length).trim().slice(0, 240);
}

function buildAssistantProviderDiagnostic(input: {
  error: unknown;
  stage: RecallAssistantFallbackStage;
}): RecallAssistantProviderDiagnostic {
  const message = summarizeAssistantProviderError(input.error);
  const reason = resolveAssistantFallbackReason(input.error);

  return {
    message,
    reason,
    stage: input.stage,
    ...(reason === "schema_invalid"
      ? { validationIssueSummary: extractValidationIssueSummary(message) }
      : {}),
  };
}

function withAssistantProviderFallback(input: {
  error: unknown;
  influence: RecallAssistantInfluence | undefined;
  stage: RecallAssistantFallbackStage;
}): RecallAssistantInfluence {
  const current = input.influence ?? buildEmptyAssistantInfluence();
  const diagnostic = buildAssistantProviderDiagnostic({
    error: input.error,
    stage: input.stage,
  });
  const next = {
    ...current,
    fallbackReason: diagnostic.reason,
    fallbackStage: input.stage,
    providerDiagnostics: [
      ...(current.providerDiagnostics ?? []),
      diagnostic,
    ],
  };

  return {
    ...next,
    routerInfluenceStatus: resolveRecallRouterInfluenceStatus(next),
  };
}

function finalizeAssistantInfluence(
  influence: RecallAssistantInfluence | undefined,
): RecallAssistantInfluence | undefined {
  if (!influence) {
    return undefined;
  }

  return {
    ...influence,
    routerInfluenceStatus: resolveRecallRouterInfluenceStatus(influence),
  };
}

function appendAssistantTraceDetails(
  traces: RecallCandidateTrace[],
  influence?: RecallAssistantInfluence,
): RecallCandidateTrace[] {
  if (!influence) {
    return traces;
  }

  const decisions = influence.decisions;

  return traces.map((trace) => {
    const collection = trace.memoryType === "archive" ? "session_archives" :
      trace.memoryType === "episode" ? "episodes" :
      trace.memoryType === "reference" ? "references" :
      "facts";
    const decision = decisions.find(({ candidateId }) =>
      matchesRecallRerankCandidateId(candidateId, collection, trace.memoryId)
    );
    if (!decision) {
      return trace;
    }

    if (trace.returned) {
      if (decision.decision !== "promote") {
        return trace;
      }

      return {
        ...trace,
        whyReturned: trace.whyReturned
          ? `${trace.whyReturned}, llmDecision=${decision.decision}:${decision.reason}`
          : `llmDecision=${decision.decision}:${decision.reason}`,
      };
    }

    if (decision.decision === "suppress") {
      return {
        ...trace,
        whySuppressed: `llm-assisted suppress: ${decision.reason}`,
      };
    }

    return trace;
  });
}

function collectAssistantProtectedCandidateIds(
  traceGroups: RecallCandidateTrace[][],
): Set<string> {
  const protectedCandidateIds = new Set<string>();

  for (const traces of traceGroups) {
    for (const trace of traces) {
      if (trace.returned && trace.slot !== "generic") {
        protectedCandidateIds.add(recallRerankCandidateKey(
          trace.memoryType === "archive" ? "session_archives" :
            trace.memoryType === "episode" ? "episodes" :
            trace.memoryType === "reference" ? "references" :
            "facts",
          trace.memoryId,
        ));
      }
    }
  }

  return protectedCandidateIds;
}

function createAssistantSuppressionTraceReason(
  suppressedCandidateIds: readonly string[],
): (trace: RecallCandidateTrace) => string {
  const suppressedIds = new Set(suppressedCandidateIds);

  return (trace) => {
    const collection = trace.memoryType === "archive" ? "session_archives" :
      trace.memoryType === "episode" ? "episodes" :
      trace.memoryType === "reference" ? "references" :
      "facts";
    return suppressedIds.has(recallRerankCandidateKey(collection, trace.memoryId))
      ? "llm-assisted suppress"
      : "policy filtered";
  };
}

function shouldSuppressGuidanceLanesForFactQuery(input: {
  queryAnalysis: LanguageQueryAnalysis;
  routingDecision: RoutingDecision;
}): boolean {
  if (
    input.routingDecision.retrievalProfile === "coding_agent" ||
    input.routingDecision.continuation ||
    input.routingDecision.actionDriving ||
    input.routingDecision.referenceSeeking ||
    input.queryAnalysis.answerComposition ||
    input.queryAnalysis.guidanceSeeking
  ) {
    return false;
  }

  return input.queryAnalysis.directFactualLookup;
}

function withRoutingWarning(
  routingDecision: RoutingDecision,
  warning: string,
): RoutingDecision {
  const warnings = routingDecision.strategyExplanation.warnings ?? [];
  if (warnings.includes(warning)) {
    return routingDecision;
  }

  const nextWarnings = [...warnings, warning];
  const warningMessages = resolveRecallRoutingWarningMessages({
    existingMessages: routingDecision.strategyExplanation.warningMessages,
    warnings: nextWarnings,
  });

  return {
    ...routingDecision,
    strategyExplanation: {
      ...routingDecision.strategyExplanation,
      ...(warningMessages.length > 0 ? { warningMessages } : {}),
      warnings: nextWarnings,
    },
  };
}

function shouldWarnSemanticUnionInactive(input: {
  embedding: EmbeddingAdapter | undefined;
  routingDecision: RoutingDecision;
  semanticCandidates: RecallSemanticCandidatesConfig | undefined;
  vectorIndex: RecallVectorSearchPort | null;
}): boolean {
  return Boolean(
    input.semanticCandidates &&
      input.embedding &&
      input.vectorIndex &&
      input.routingDecision.strategy !== "hybrid" &&
      input.routingDecision.strategyExplanation.requestedStrategy !== "rules-only",
  );
}

export function createRecallEngine(config: RecallEngineConfig) {
  const language = config.language ?? createLanguageService();
  const factSelector =
    config.factSelector ?? selectGeneralizedFactsForInternalUse;
  const now = config.now ?? Date.now;
  const referenceTime = config.referenceTime ?? (() => new Date(now()).toISOString());
  const vectorIndex =
    config.vectorIndex !== undefined
      ? config.vectorIndex ?? null
      : config.repositories.vectorIndex ?? null;

  return {
    async recall(input: RecallInput): Promise<RecallResult> {
      const startedAt = now();
      const resolvedLanguage = input.languageContext ?? language.resolveFromText({
        locale: input.locale,
        text: input.query,
      });
      const queryAnalysis = input.queryAnalysis ??
        language.analyzeQuery(input.query, resolvedLanguage);
      const currentReferenceTime =
        input.referenceTime !== undefined &&
          Number.isFinite(Date.parse(input.referenceTime))
          ? new Date(Date.parse(input.referenceTime)).toISOString()
          : referenceTime();
      const planResolution = input.recallPlan
        ? { assistantApplied: false, plan: input.recallPlan }
        : await resolveRecallPlan({
            assistant: config.recallPlanner,
            input: {
              language,
              languageContext: resolvedLanguage,
              locale: resolvedLanguage.locale,
              query: input.query,
              queryAnalysis,
              referenceTime: currentReferenceTime,
              scope: input.scope,
            },
          });
      const recallPlan = planResolution.plan;
      const retrievalProfile = resolveRetrievalProfile(input.retrievalProfile);
      const policyApplied = new Set<string>();
      if (planResolution.assistantApplied) {
        policyApplied.add("recall_plan_assistant_applied");
      } else if (planResolution.fallbackReason) {
        policyApplied.add("recall_plan_assistant_fallback");
        console.error(
          "[goodmemory:recall-plan] assisted planning failed; using deterministic plan",
          {
            locale: resolvedLanguage.locale,
            queryLength: input.query.length,
          },
        );
      }
      const generalizedFusionConfig = resolveActiveGeneralizedFusionConfig({
        base: config.generalizedFusion,
        rerank: input.rerank !== false,
        reranking: config.rerankGeneralizedFusion,
      });
      const generalizedFusionBudget = generalizedFusionConfig
        ? resolveGeneralizedFusionBudget({
            base: generalizedFusionConfig,
            plan: recallPlan,
          })
        : undefined;
      const routerAvailability = {
        // BM25 ranking populates the same additive slot as neural semantic
        // search, so it also counts as "semantic search available" for routing:
        // without this, a requested hybrid strategy would fall back to
        // rules-only whenever no embedding endpoint exists, disabling BM25
        // exactly when it is the intended lexical-semantic signal.
        semanticSearch: Boolean(
          (config.embedding && vectorIndex) ||
            config.bm25Ranking ||
            (generalizedFusionConfig && config.projectionIndex),
        ),
        llmRouting: Boolean(config.assistedRouter),
      };
      const factGet = config.repositories.facts.get?.bind(
        config.repositories.facts,
      );
      const preferenceGet = config.repositories.preferences.get?.bind(
        config.repositories.preferences,
      );
      const referenceGet = config.repositories.references.get?.bind(
        config.repositories.references,
      );
      const episodeGet = config.repositories.episodes.get?.bind(
        config.repositories.episodes,
      );
      const archiveGet = config.repositories.archives.get?.bind(
        config.repositories.archives,
      );
      const feedbackGet = config.repositories.feedback.get?.bind(
        config.repositories.feedback,
      );
      const useProjectedContentLoading = Boolean(
          generalizedFusionConfig &&
          config.projectionIndex &&
          input.strategy !== "rules-only" &&
          factGet &&
          referenceGet &&
          episodeGet &&
          archiveGet &&
          preferenceGet &&
          feedbackGet,
      );

      if (input.ignoreMemory) {
        const routingDecision = planRecall({
          retrievalProfile,
          strategy: input.strategy,
          autoStrategyBias: config.autoStrategyBias,
          availability: routerAvailability,
          query: input.query,
          queryAnalysis,
          locale: resolvedLanguage.locale,
          language,
          runtime: {
            hasWorkingMemory: false,
            hasJournal: false,
          },
        });
        const packet = buildMemoryPacket({
          profile: null,
          preferences: [],
          references: [],
          facts: [],
          feedback: [],
          archives: [],
          evidence: [],
          episodes: [],
          workingMemory: null,
          journal: null,
          maxRenderedTokens: recallPlan.maxRenderedTokens,
          language,
          languageContext: resolvedLanguage,
          locale: resolvedLanguage.locale,
          routingDecision,
        });
        policyApplied.add("ignore_memory");

        return {
          profile: null,
          preferences: [],
          references: [],
          facts: [],
          feedback: [],
          archives: [],
          evidence: [],
          ...(input.includeEvidence ? { evidenceLedger: [] } : {}),
          episodes: [],
          workingMemory: null,
          journal: null,
          packet,
          metadata: {
            routingDecision,
            tokenCount: packet.debug?.estimatedTokens ?? 0,
            latencyMs: now() - startedAt,
            hits: [],
            candidateTraces: [],
            verificationHints: [],
            policyApplied: [...policyApplied],
            locale: resolvedLanguage.locale,
            localeSource: resolvedLanguage.localeSource,
            languagePackId: resolvedLanguage.languagePackId,
            languagePackVersion: resolvedLanguage.languagePackVersion,
            analysisMode: resolvedLanguage.analysisMode,
          },
        };
      }

      const [
        profile,
        preferencesLoaded,
        referencesLoaded,
        factsLoaded,
        feedbackLoaded,
        archivesLoaded,
        evidenceLoaded,
        episodesLoaded,
        workingMemoryRaw,
        journalRaw,
      ] = await Promise.all([
        config.repositories.profiles.get(input.scope.userId),
        useProjectedContentLoading
          ? Promise.resolve<PreferenceMemory[]>([])
          : config.repositories.preferences.listByScope(input.scope),
        useProjectedContentLoading
          ? Promise.resolve<ReferenceMemory[]>([])
          : config.repositories.references.listByScope(input.scope),
        useProjectedContentLoading
          ? Promise.resolve<FactMemory[]>([])
          : config.repositories.facts.listByScope(input.scope),
        useProjectedContentLoading
          ? Promise.resolve<FeedbackMemory[]>([])
          : config.repositories.feedback.listByScope(input.scope),
        useProjectedContentLoading
          ? Promise.resolve<SessionArchive[]>([])
          : config.repositories.archives.listByScope(input.scope),
        useProjectedContentLoading && input.includeEvidence !== true
          ? Promise.resolve<EvidenceRecord[]>([])
          : config.repositories.evidence.listByScope(input.scope),
        useProjectedContentLoading
          ? Promise.resolve<EpisodeMemory[]>([])
          : config.repositories.episodes.listByScope(input.scope),
        input.scope.sessionId
          ? config.runtime.getWorkingMemory(input.scope)
          : Promise.resolve(null),
        input.scope.sessionId
          ? config.runtime.getJournal(input.scope)
          : Promise.resolve(null),
      ]);
      let preferencesRaw = filterRecordsByDefaultRecallScope(
        preferencesLoaded,
        input.scope,
        policyApplied,
      );
      let referencesRaw = filterRecordsByDefaultRecallScope(
        referencesLoaded,
        input.scope,
        policyApplied,
      );
      let factsRaw = filterRecordsByDefaultRecallScope(
        factsLoaded,
        input.scope,
        policyApplied,
      );
      let feedbackRaw = filterRecordsByDefaultRecallScope(
        feedbackLoaded,
        input.scope,
        policyApplied,
      );
      let archivesRaw = filterRecordsByDefaultRecallScope(
        archivesLoaded,
        input.scope,
        policyApplied,
      );
      let evidenceRaw = filterRecordsByDefaultRecallScope(
        evidenceLoaded,
        input.scope,
        policyApplied,
      );
      let episodesRaw = filterRecordsByDefaultRecallScope(
        episodesLoaded,
        input.scope,
        policyApplied,
      );

      const loadProjectedContent = async (
        candidates: readonly GeneralizedFusionCandidate[],
        documents: readonly RecallIndexDocument[],
      ): Promise<void> => {
        if (!useProjectedContentLoading) {
          return;
        }
        const sources = [...candidates, ...documents];
        const sourceIds = (
          collection: GeneralizedFusionCandidate["sourceCollection"],
        ) => [...new Set(
          sources
            .filter((candidate) => candidate.sourceCollection === collection)
            .map(({ sourceMemoryId }) => sourceMemoryId),
        )];
        const [
          facts,
          references,
          episodes,
          archives,
          preferences,
          feedback,
        ] =
          await Promise.all([
          Promise.all(sourceIds("facts").map((id) => factGet!(id))),
          Promise.all(sourceIds("references").map((id) => referenceGet!(id))),
          Promise.all(sourceIds("episodes").map((id) => episodeGet!(id))),
          Promise.all(sourceIds("session_archives").map((id) => archiveGet!(id))),
          Promise.all(sourceIds("preferences").map((id) => preferenceGet!(id))),
          Promise.all(sourceIds("feedback").map((id) => feedbackGet!(id))),
        ]);
        factsRaw = filterRecordsByDefaultRecallScope(
          facts.filter((record): record is FactMemory => record !== null),
          input.scope,
          policyApplied,
        );
        referencesRaw = filterRecordsByDefaultRecallScope(
          references.filter(
            (record): record is ReferenceMemory => record !== null,
          ),
          input.scope,
          policyApplied,
        );
        episodesRaw = filterRecordsByDefaultRecallScope(
          episodes.filter((record): record is EpisodeMemory => record !== null),
          input.scope,
          policyApplied,
        );
        archivesRaw = filterRecordsByDefaultRecallScope(
          archives.filter((record): record is SessionArchive => record !== null),
          input.scope,
          policyApplied,
        );
        preferencesRaw = filterRecordsByDefaultRecallScope(
          preferences.filter(
            (record): record is PreferenceMemory => record !== null,
          ),
          input.scope,
          policyApplied,
        );
        feedbackRaw = filterRecordsByDefaultRecallScope(
          feedback.filter((record): record is FeedbackMemory => record !== null),
          input.scope,
          policyApplied,
        );
      };

      const loadFullContent = async (): Promise<void> => {
        const [
          facts,
          references,
          episodes,
          archives,
          preferences,
          feedback,
          evidence,
        ] =
          await Promise.all([
          config.repositories.facts.listByScope(input.scope),
          config.repositories.references.listByScope(input.scope),
          config.repositories.episodes.listByScope(input.scope),
          config.repositories.archives.listByScope(input.scope),
          config.repositories.preferences.listByScope(input.scope),
          config.repositories.feedback.listByScope(input.scope),
          config.repositories.evidence.listByScope(input.scope),
        ]);
        factsRaw = filterRecordsByDefaultRecallScope(
          facts,
          input.scope,
          policyApplied,
        );
        referencesRaw = filterRecordsByDefaultRecallScope(
          references,
          input.scope,
          policyApplied,
        );
        episodesRaw = filterRecordsByDefaultRecallScope(
          episodes,
          input.scope,
          policyApplied,
        );
        archivesRaw = filterRecordsByDefaultRecallScope(
          archives,
          input.scope,
          policyApplied,
        );
        preferencesRaw = filterRecordsByDefaultRecallScope(
          preferences,
          input.scope,
          policyApplied,
        );
        feedbackRaw = filterRecordsByDefaultRecallScope(
          feedback,
          input.scope,
          policyApplied,
        );
        evidenceRaw = filterRecordsByDefaultRecallScope(
          evidence,
          input.scope,
          policyApplied,
        );
      };

      let routingDecision = planRecall({
        retrievalProfile,
        strategy: input.strategy,
        autoStrategyBias: config.autoStrategyBias,
        availability: routerAvailability,
        query: input.query,
        queryAnalysis,
        locale: resolvedLanguage.locale,
        language,
        runtime: {
          hasWorkingMemory: Boolean(workingMemoryRaw),
          hasJournal: Boolean(journalRaw),
        },
      });
      if (
        useProjectedContentLoading &&
        routingDecision.strategy === "rules-only"
      ) {
        await loadFullContent();
      }
      let assistantInfluence =
        routingDecision.strategy === "llm-assisted" && config.assistedRouter
          ? buildEmptyAssistantInfluence()
          : undefined;

      if (
        routingDecision.strategy === "llm-assisted" &&
        config.assistedRouter &&
        !assistantInfluence?.fallbackReason
      ) {
        try {
          const assistantPlan = await config.assistedRouter.plan({
            locale: resolvedLanguage.locale,
            query: input.query,
            routingDecision,
            runtime: {
              hasWorkingMemory: Boolean(workingMemoryRaw),
              hasJournal: Boolean(journalRaw),
            },
          });
          const assistedPlan = applyRecallAssistantPlan({
            influence: assistantInfluence ?? buildEmptyAssistantInfluence(),
            plan: assistantPlan,
            routingDecision,
          });
          routingDecision = assistedPlan.routingDecision;
          assistantInfluence = assistedPlan.influence;
        } catch (error) {
          assistantInfluence = withAssistantProviderFallback({
            error,
            influence: assistantInfluence,
            stage: "plan",
          });
        }
      }
      if (
        shouldWarnSemanticUnionInactive({
          embedding: config.embedding,
          routingDecision,
          semanticCandidates: config.semanticCandidates,
          vectorIndex,
        })
      ) {
        routingDecision = withRoutingWarning(
          routingDecision,
          SEMANTIC_RECALL_INACTIVE_WARNING,
        );
      }
      if (
        input.includeEvidence === true &&
        !routingDecision.sourcePriorities.includes("evidence")
      ) {
        routingDecision = {
          ...routingDecision,
          sourcePriorities: [...routingDecision.sourcePriorities, "evidence"],
        };
        policyApplied.add("explicit_evidence_requested");
      }
      const visibleEvidencePool = await applyRecallPolicyToRecords(
        evidenceRaw,
        "evidence",
        {
          scope: input.scope,
          query: input.query,
          retrievalProfile,
          locale: resolvedLanguage.locale,
          localeSource: resolvedLanguage.localeSource,
          policy: config.policy,
          policyApplied,
        },
      );
      const evidenceCountsByMemoryId = buildEvidenceCountByMemoryId(visibleEvidencePool);
      let semanticScores: SemanticSearchScores | undefined;
      let providerDenseScores: SemanticSearchScores | undefined;
      let semanticFactCandidates: SemanticSearchScores["semanticFactCandidates"];
      const semanticUnionTopK = Math.max(
        1,
        Math.floor(config.semanticCandidates?.topK ?? 8),
      );
      const computeBm25AdditiveScores = (): SemanticSearchScores => {
        // Okapi BM25 over the in-memory candidate pool populates the same
        // additive ranking slot a neural semantic score would, giving
        // hybrid/llm-assisted ranking IDF + length normalization with no
        // embedding endpoint. rules-only never consumes this slot, so the pure
        // lexical floor is preserved.
        // IMPORTANT: this helper must never populate `semanticFactCandidates` -
        // BM25 scores are lexical, and feeding them to the semantic-candidates
        // union would readmit the lexical floor the union exists to bypass.
        const tokenizeForLocale = (text: string): string[] =>
          language.tokenize(text, resolvedLanguage.locale, {
            excludeStopwords: true,
          });
        return {
          facts: computeBm25Scores(
            input.query,
            factsRaw.map((fact) => ({
              id: fact.id,
              text: `${fact.content} ${fact.subject ?? ""}`,
            })),
            { tokenize: tokenizeForLocale },
          ),
          references: computeBm25Scores(
            input.query,
            referencesRaw.map((reference) => ({
              id: reference.id,
              text: `${reference.title} ${reference.pointer} ${reference.description ?? ""}`,
            })),
            { tokenize: tokenizeForLocale },
          ),
          episodes: computeBm25Scores(
            input.query,
            episodesRaw.map((episode) => ({
              id: episode.id,
              text: `${episode.summary} ${(episode.topics ?? []).join(" ")}`,
            })),
            { tokenize: tokenizeForLocale },
          ),
        };
      };
      if (
        routingDecision.strategy === "hybrid" &&
        config.embedding &&
        vectorIndex &&
        (!config.bm25Ranking || config.semanticCandidates)
      ) {
        try {
          const providerSemanticScores = await searchSemanticScores({
            embedding: config.embedding,
            query: input.query,
            scope: input.scope,
            vectorIndex,
            ...(config.semanticCandidates || generalizedFusionConfig
              ? {
                  factCandidates: {
                    topK:
                      config.semanticCandidates?.topK ??
                      generalizedFusionBudget?.maxCandidates ??
                      semanticUnionTopK,
                  },
                }
              : {}),
          });
          providerDenseScores = providerSemanticScores;
          semanticFactCandidates = providerSemanticScores.semanticFactCandidates;
          semanticScores = config.bm25Ranking
            ? {
                ...computeBm25AdditiveScores(),
                ...(providerSemanticScores.semanticFactCandidates !== undefined
                  ? {
                      semanticFactCandidates:
                        providerSemanticScores.semanticFactCandidates,
                    }
                  : {}),
              }
            : providerSemanticScores;
        } catch (error) {
          throw new ProviderBackedRecallError({
            cause: error,
            stage: "semantic_search",
          });
        }
      } else if (
        config.bm25Ranking &&
        routingDecision.strategy !== "rules-only"
      ) {
        semanticScores = computeBm25AdditiveScores();
      }

      let generalizedFusion: GeneralizedFusionSelectionInput | undefined;
      let generalizedFusionCandidates: GeneralizedFusionCandidate[] = [];
      let rerankProjectionClaims: ClaimProjection[] = [];
      let rerankProjectionDocuments: RecallIndexDocument[] = [];
      let selectedClaimSourceFacts: FactMemory[] = [];
      let claimReplacementSourceIds = new Set<string>();
      let retrievalTrace: RecallRetrievalTrace | undefined;
      if (
        generalizedFusionConfig &&
        routingDecision.strategy !== "rules-only"
      ) {
        if (!config.projectionIndex) {
          policyApplied.add("generalized_fusion_unavailable");
          retrievalTrace = {
            fusionRuns: [
              {
                budget: 0,
                candidateCount: 0,
                candidates: [],
                fallbackReason: "projection_unavailable",
                status: "fallback",
              },
            ],
            schemaVersion: 1,
          };
        } else {
          try {
            const coverage = await config.projectionIndex.ensureScopeIndexed(
              input.scope,
            );
            if (!coverage.complete) {
              policyApplied.add("generalized_fusion_partial_projection");
              if (useProjectedContentLoading) {
                await loadFullContent();
              }
              retrievalTrace = {
                fusionRuns: [
                  {
                    budget: 0,
                    candidateCount: 0,
                    candidates: [],
                    fallbackReason: "projection_incomplete",
                    projectionCoverage: "partial",
                    status: "fallback",
                  },
                ],
                schemaVersion: 1,
              };
            } else {
            const needsClaimHistory =
              recallPlan.aggregation === "change" ||
              recallPlan.aggregation === "history" ||
              recallPlan.temporalConstraints.some(({ kind }) =>
                kind === "after" || kind === "before" || kind === "history"
              );
            const needsClaimMaterialization =
              needsClaimHistory ||
              recallPlan.aggregation === "count" ||
              recallPlan.aggregation === "current" ||
              recallPlan.temporalConstraints.some(({ kind }) =>
                kind === "current"
              );
            const temporalReferenceTime = recallPlan.temporalConstraints.find(
              ({ kind }) => kind === "after" || kind === "before" || kind === "current",
            )?.referenceTime ?? currentReferenceTime;
            const [documents, entities, claims] = await Promise.all([
              config.projectionIndex.searchDocuments(
                input.scope,
                input.query,
                recallPlan.preRankLimit * 4,
                resolvedLanguage.locale,
              ),
              config.projectionIndex.searchEntities(
                input.scope,
                input.query,
                recallPlan.preRankLimit,
                resolvedLanguage.locale,
              ),
              config.projectionIndex.searchClaims(
                input.scope,
                input.query,
                recallPlan.preRankLimit * 4,
                needsClaimHistory,
                resolvedLanguage.locale,
              ),
            ]);
            rerankProjectionClaims = claims;
            rerankProjectionDocuments = documents;
            const contentDocuments = documents.filter(
              (document) =>
                document.sourceCollection === "facts" ||
                document.sourceCollection === "references" ||
                document.sourceCollection === "episodes" ||
                document.sourceCollection === "session_archives",
            );
            const contentEntities = entities
              .map((entity) => ({
                ...entity,
                memoryIds: entity.memoryIds.filter(
                  (id) =>
                    id.startsWith("facts:") ||
                    id.startsWith("references:") ||
                    id.startsWith("episodes:") ||
                    id.startsWith("session_archives:"),
                ),
              }))
              .filter((entity) => entity.memoryIds.length > 0);
            const fused = fuseGeneralizedRecallCandidates({
              query: input.query,
              documents: contentDocuments,
              // The document set comes from a bounded FTS search, so it is
              // genuinely partial: a valid dense/entity candidate's documents
              // may simply not match the query text. Visibility filtering for
              // those channels therefore stays off (lexical visibility is
              // always enforced from the searched documents themselves).
              // Per-candidate validity checks belong on the candidate records,
              // not on this incomplete set.
              documentSetComplete: false,
              entities: contentEntities,
              claims,
              plan: recallPlan,
              denseCandidates: [
                ...(semanticFactCandidates ?? [])
                  .filter((candidate, _index, candidates) => {
                    const bestScore = candidates[0]?.score ?? 0;
                    return (
                      candidate.score > 0 &&
                      (config.semanticCandidates?.minSimilarity === undefined ||
                        candidate.score >=
                          config.semanticCandidates.minSimilarity) &&
                      (config.semanticCandidates?.minRelativeScore === undefined ||
                        candidate.score + Number.EPSILON >=
                          bestScore * config.semanticCandidates.minRelativeScore)
                    );
                  })
                  .slice(
                    0,
                    Math.max(
                      0,
                      Math.floor(
                        config.semanticCandidates?.maxAdditions ??
                          semanticUnionTopK,
                      ),
                    ),
                  )
                  .map(({ id: sourceMemoryId, score }) => ({
                    sourceCollection: "facts" as const,
                    sourceMemoryId,
                    score,
                  })),
                ...[...(providerDenseScores?.references ?? new Map())]
                  .filter(([, score]) => score > 0)
                  .map(([sourceMemoryId, score]) => ({
                    sourceCollection: "references" as const,
                    sourceMemoryId,
                    score,
                  })),
                ...[...(providerDenseScores?.episodes ?? new Map())]
                  .filter(([, score]) => score > 0)
                  .map(([sourceMemoryId, score]) => ({
                    sourceCollection: "episodes" as const,
                    sourceMemoryId,
                    score,
                  })),
              ],
              channels: generalizedFusionConfig.channels,
              maxCandidates: generalizedFusionBudget?.maxCandidates,
              // Honor the configured dynamic-budget floor; default stays 0
              // (no trimming) so existing profiles keep their behavior until
              // a profile opts in after measurement.
              minRelativeStrength: generalizedFusionConfig.minRelativeStrength ?? 0,
              acceptsEntityCandidate: (input) =>
                language.acceptsEntityCandidate(input, resolvedLanguage),
              matchesEntityAlias: (query, alias) =>
                language.matchesEntityAlias(query, alias, resolvedLanguage),
              referenceTime: temporalReferenceTime,
              rrfK: generalizedFusionConfig.rrfK,
              tokenize: (text) =>
                language.tokenize(text, resolvedLanguage.locale, {
                  excludeStopwords: true,
                }),
            });
            generalizedFusionCandidates = fused.candidates;
            await loadProjectedContent(generalizedFusionCandidates, documents);
            if (needsClaimMaterialization) {
              const selectedClaimIds = new Set(
                fused.candidates.flatMap((candidate) =>
                  candidate.channels.temporal?.evidenceDocumentIds ?? []
                ),
              );
              const selectedClaims = claims.filter((claim) =>
                selectedClaimIds.has(claim.id)
              );
              const selectedGroupKeys = new Set(
                selectedClaims.map(claimProjectionGroupKey),
              );
              claimReplacementSourceIds = new Set(
                claims
                  .filter((claim) =>
                    selectedGroupKeys.has(claimProjectionGroupKey(claim))
                  )
                  .map(({ sourceMemoryId }) => sourceMemoryId),
              );
              const factsById = new Map(
                factsRaw.map((fact) => [fact.id, fact] as const),
              );
              selectedClaimSourceFacts = [...new Set(
                selectedClaims.map(({ sourceMemoryId }) => sourceMemoryId),
              )].flatMap((sourceMemoryId) => {
                const source = factsById.get(sourceMemoryId);
                return source ? [source] : [];
              });
            }
            retrievalTrace = {
              fusionRuns: [
                buildFusionRunTrace({
                  coverageComplete: coverage.complete,
                  maxCandidates: generalizedFusionBudget?.maxCandidates,
                  result: fused,
                }),
              ],
              schemaVersion: 1,
            };
            generalizedFusion = {
              candidates: fused.candidates
                .filter((candidate) => candidate.sourceCollection === "facts")
                .map((candidate) => ({
                  id: candidate.sourceMemoryId,
                  score: candidate.score,
                })),
              maxAdditions: fused.budget,
              maxTotalFacts: generalizedFusionBudget?.maxTotalFacts,
            };
            policyApplied.add("generalized_fusion");
            if (generalizedFusionBudget?.expanded) {
              policyApplied.add("generalized_fusion_complex_query_budget");
            }
            }
          } catch (error) {
            console.error(
              "[goodmemory:generalized-fusion] projection retrieval failed; preserving baseline recall",
              error,
            );
            policyApplied.add("generalized_fusion_unavailable");
            if (useProjectedContentLoading) {
              await loadFullContent();
            }
            retrievalTrace = {
              fusionRuns: [
                {
                  budget: 0,
                  candidateCount: 0,
                  candidates: [],
                  fallbackReason: "projection_error",
                  status: "fallback",
                },
              ],
              schemaVersion: 1,
            };
          }
        }
      }

      const filteredProfile = await applyRecallPolicyToProfile(profile, {
        scope: input.scope,
        query: input.query,
        retrievalProfile,
        locale: resolvedLanguage.locale,
        localeSource: resolvedLanguage.localeSource,
        policy: config.policy,
        policyApplied,
      });
      const suppressGuidanceLanes = shouldSuppressGuidanceLanesForFactQuery({
        queryAnalysis,
        routingDecision,
      });
      const includeGuidanceLanes = !suppressGuidanceLanes;
      const preferences = includeGuidanceLanes
        ? await applyRecallPolicyToRecords(
            selectPreferencesForQuery(
              preferencesRaw,
              input.query,
              language,
              resolvedLanguage.locale,
              queryAnalysis,
            ),
            "preference",
            {
              scope: input.scope,
              query: input.query,
              retrievalProfile,
              locale: resolvedLanguage.locale,
              localeSource: resolvedLanguage.localeSource,
              policy: config.policy,
              policyApplied,
            },
          )
        : [];
      if (suppressGuidanceLanes) {
        policyApplied.add("guidance_lanes_suppressed_for_fact_query");
      }
      // The union is bound to the embedding branch by construction:
      // semanticFactCandidates only exists when searchSemanticScores ran with
      // factCandidates. BM25 may supply additive scores in the same run, but it
      // never supplies union candidates.
      if (config.semanticCandidates && (!config.embedding || !vectorIndex)) {
        policyApplied.add("semantic_candidates_unavailable");
      }
      const semanticUnion =
        !generalizedFusion &&
        config.semanticCandidates &&
        semanticFactCandidates !== undefined &&
        semanticFactCandidates.length > 0
          ? {
              candidates: semanticFactCandidates,
              maxAdditions: Math.max(
                0,
                Math.floor(
                  config.semanticCandidates.maxAdditions ?? semanticUnionTopK,
                ),
              ),
              ...(config.semanticCandidates.minSimilarity !== undefined
                ? { minSimilarity: config.semanticCandidates.minSimilarity }
                : {}),
              ...(config.semanticCandidates.minRelativeScore !== undefined
                ? {
                    minRelativeScore:
                      config.semanticCandidates.minRelativeScore,
                  }
                : {}),
            }
          : undefined;
      const factSelectionPool = claimReplacementSourceIds.size > 0
        ? [
            ...factsRaw.filter((fact) => !claimReplacementSourceIds.has(fact.id)),
            ...selectedClaimSourceFacts,
          ]
        : factsRaw;
      const selectedFacts = factSelector(
        factSelectionPool,
        input.query,
        language,
        resolvedLanguage.locale,
        retrievalProfile,
        routingDecision,
        filteredProfile,
        currentReferenceTime,
        semanticScores?.facts,
        evidenceCountsByMemoryId,
        semanticUnion,
        generalizedFusion,
        queryAnalysis,
      );
      let facts = await applyRecallPolicyToRecords(
        selectedFacts.facts,
        "fact",
        {
          scope: input.scope,
          query: input.query,
          retrievalProfile,
          locale: resolvedLanguage.locale,
          localeSource: resolvedLanguage.localeSource,
          policy: config.policy,
          policyApplied,
        },
      );
      const visibleFeedback = includeGuidanceLanes
        ? await applyRecallPolicyToRecords(
            feedbackRaw,
            "feedback",
            {
              scope: input.scope,
              query: input.query,
              retrievalProfile,
              locale: resolvedLanguage.locale,
              localeSource: resolvedLanguage.localeSource,
              policy: config.policy,
              policyApplied,
            },
          )
        : [];
      const feedback = selectFeedbackForQuery(
        visibleFeedback,
        input.query,
        language,
        resolvedLanguage.locale,
        retrievalProfile,
        queryAnalysis,
      );
      const selectedArchives = selectArchives(
        archivesRaw,
        input.query,
        language,
        resolvedLanguage.locale,
        routingDecision,
        currentReferenceTime,
      );
      const generalizedArchives = admitGeneralizedRecords({
        candidates: generalizedFusionCandidates,
        collection: "session_archives",
        getId: (archive) => archive.id,
        maxRecords:
          generalizedFusionConfig?.contentLaneRecords?.sessionArchives ?? 1,
        records: archivesRaw,
        selected: selectedArchives.archives,
        traces: selectedArchives.traces,
      });
      let archives = await applyRecallPolicyToRecords(
        generalizedArchives,
        "archive",
        {
          scope: input.scope,
          query: input.query,
          retrievalProfile,
          locale: resolvedLanguage.locale,
          localeSource: resolvedLanguage.localeSource,
          policy: config.policy,
          policyApplied,
        },
      );
      const selectedEpisodes = selectEpisodes(
        episodesRaw,
        input.query,
        language,
        resolvedLanguage.locale,
        routingDecision,
        currentReferenceTime,
        semanticScores?.episodes,
      );
      const generalizedEpisodes = admitGeneralizedRecords({
        candidates: generalizedFusionCandidates,
        collection: "episodes",
        getId: (episode) => episode.id,
        maxRecords: generalizedFusionConfig?.contentLaneRecords?.episodes ?? 2,
        records: episodesRaw,
        selected: selectedEpisodes.episodes,
        traces: selectedEpisodes.traces,
      });
      let episodes = await applyRecallPolicyToRecords(
        generalizedEpisodes,
        "episode",
        {
          scope: input.scope,
          query: input.query,
          retrievalProfile,
          locale: resolvedLanguage.locale,
          localeSource: resolvedLanguage.localeSource,
          policy: config.policy,
          policyApplied,
        },
      );
      const selectedReferences = selectReferences(
        referencesRaw,
        input.query,
        language,
        resolvedLanguage.locale,
        routingDecision,
        currentReferenceTime,
        semanticScores?.references,
        evidenceCountsByMemoryId,
        queryAnalysis,
      );
      const generalizedReferences = admitGeneralizedRecords({
        candidates: generalizedFusionCandidates,
        collection: "references",
        getId: (reference) => reference.id,
        maxRecords:
          generalizedFusionConfig?.contentLaneRecords?.references ?? 1,
        records: referencesRaw,
        selected: selectedReferences.references,
        traces: selectedReferences.traces,
      });
      let references = await applyRecallPolicyToRecords(
        generalizedReferences,
        "reference",
        {
          scope: input.scope,
          query: input.query,
          retrievalProfile,
          locale: resolvedLanguage.locale,
          localeSource: resolvedLanguage.localeSource,
          policy: config.policy,
          policyApplied,
        },
      );
      if (
        routingDecision.strategy === "llm-assisted" &&
        config.assistedRouter &&
        !assistantInfluence?.fallbackReason
      ) {
        const rerankSelection = {
          facts,
          references,
          archives,
          episodes,
        };
        const protectedCandidateIds = collectAssistantProtectedCandidateIds([
          selectedFacts.traces,
          selectedReferences.traces,
          selectedArchives.traces,
          selectedEpisodes.traces,
        ]);
        const assistantCandidates = buildRecallAssistantCandidates(rerankSelection, {
          protectedCandidateIds,
        });

        if (assistantCandidates.length > 0) {
          try {
            const rerank = await config.assistedRouter.rerank({
              candidates: assistantCandidates,
              locale: resolvedLanguage.locale,
              query: input.query,
              querySummary: assistantInfluence?.querySummary,
              routingDecision,
            });
            const reranked = applyRecallAssistantRerank({
              influence: assistantInfluence ?? buildEmptyAssistantInfluence(),
              protectedCandidateIds,
              rerank,
              selection: rerankSelection,
            });

            assistantInfluence = reranked.influence;
            ({
              facts,
              references,
              archives,
              episodes,
            } = reranked.selection);
          } catch (error) {
            assistantInfluence = withAssistantProviderFallback({
              error,
              influence: assistantInfluence,
              stage: "rerank",
            });
          }
        }
      }
      const suppressedCandidateIds = new Set(
        assistantInfluence?.suppressedCandidateIds ?? [],
      );
      const policyContext = {
        scope: input.scope,
        query: input.query,
        retrievalProfile,
        locale: resolvedLanguage.locale,
        localeSource: resolvedLanguage.localeSource,
        policy: config.policy,
        policyApplied,
      };
      const poolFacts = [
        ...facts,
        ...await applyRecallPolicyToRecords(
          collectUnseenFusionRecords({
            candidates: generalizedFusionCandidates,
            collection: "facts",
            evaluatedIds: new Set(selectedFacts.facts.map(({ id }) => id)),
            records: factSelectionPool,
            suppressedIds: suppressedCandidateIds,
            traces: selectedFacts.traces,
          }),
          "fact",
          policyContext,
        ),
      ];
      const poolReferences = [
        ...references,
        ...await applyRecallPolicyToRecords(
          collectUnseenFusionRecords({
            candidates: generalizedFusionCandidates,
            collection: "references",
            evaluatedIds: new Set(generalizedReferences.map(({ id }) => id)),
            records: referencesRaw,
            suppressedIds: suppressedCandidateIds,
            traces: selectedReferences.traces,
          }),
          "reference",
          policyContext,
        ),
      ];
      const poolEpisodes = [
        ...episodes,
        ...await applyRecallPolicyToRecords(
          collectUnseenFusionRecords({
            candidates: generalizedFusionCandidates,
            collection: "episodes",
            evaluatedIds: new Set(generalizedEpisodes.map(({ id }) => id)),
            records: episodesRaw,
            suppressedIds: suppressedCandidateIds,
            traces: selectedEpisodes.traces,
          }),
          "episode",
          policyContext,
        ),
      ];
      const poolArchives = [
        ...archives,
        ...await applyRecallPolicyToRecords(
          collectUnseenFusionRecords({
            candidates: generalizedFusionCandidates,
            collection: "session_archives",
            evaluatedIds: new Set(generalizedArchives.map(({ id }) => id)),
            records: archivesRaw,
            suppressedIds: suppressedCandidateIds,
            traces: selectedArchives.traces,
          }),
          "archive",
          policyContext,
        ),
      ];
      const rerankPoolSelection = {
        facts: [...new Map(poolFacts.map((record) => [record.id, record])).values()],
        references: [...new Map(
          poolReferences.map((record) => [record.id, record]),
        ).values()],
        episodes: [...new Map(
          poolEpisodes.map((record) => [record.id, record]),
        ).values()],
        archives: [...new Map(
          poolArchives.map((record) => [record.id, record]),
        ).values()],
      };
      const rerankCandidates = buildRecallRerankCandidates({
        candidates: generalizedFusionCandidates,
        claims: rerankProjectionClaims,
        documents: rerankProjectionDocuments,
        pool: rerankPoolSelection,
        selected: { facts, references, episodes, archives },
      });
      retrievalTrace = reconcileFusionTraceSelection(
      retrievalTrace,
      { facts, references, episodes, archives },
      { feedback, preferences, profile: filteredProfile },
    );
      const factTraceIds = collectTraceMemoryIds(selectedFacts.traces);
      const referenceTraceIds = collectTraceMemoryIds(selectedReferences.traces);
      const archiveTraceIds = collectTraceMemoryIds(selectedArchives.traces);
      const episodeTraceIds = collectTraceMemoryIds(selectedEpisodes.traces);
      const feedbackEvidenceIds = new Set(
        feedback.flatMap((feedbackItem) => feedbackItem.evidence ?? []),
      );
      const selectedFactSourceIds = facts.map(canonicalFactMemoryId);
      const visibleLinkedEvidence = filterLinkedEvidence(
        visibleEvidencePool,
        new Set([
          ...selectedFactSourceIds,
          ...references.map((reference) => reference.id),
          ...feedback.map((feedbackItem) => feedbackItem.id),
          ...episodes.map((episode) => episode.id),
        ]),
        new Set(archives.map((archive) => archive.id)),
        feedbackEvidenceIds,
      );
      const explainabilityLinkedEvidence = filterLinkedEvidence(
        visibleEvidencePool,
        new Set([
          ...factTraceIds.memoryIds,
          ...selectedFactSourceIds,
          ...referenceTraceIds.memoryIds,
          ...episodeTraceIds.memoryIds,
          ...feedback.map((feedbackItem) => feedbackItem.id),
        ]),
        new Set([...archiveTraceIds.archiveIds]),
        feedbackEvidenceIds,
      );
      const sessionScopedEvidence =
        retrievalProfile === "coding_agent"
          ? collectSessionScopedEvidence(visibleEvidencePool, input.scope)
          : [];
      const completeEvidence = routingDecision.sourcePriorities.includes("evidence")
        ? [...new Map(
            [...visibleLinkedEvidence, ...sessionScopedEvidence].map((record) => [
              record.id,
              record,
            ]),
          ).values()]
        : [];
      const rerankPoolFactSourceIds = rerankPoolSelection.facts.map(
        canonicalFactMemoryId,
      );
      const rerankPoolMemoryIds = [
        ...rerankPoolFactSourceIds,
        ...rerankPoolSelection.references.map(({ id }) => id),
        ...feedback.map(({ id }) => id),
        ...rerankPoolSelection.episodes.map(({ id }) => id),
        ...rerankPoolSelection.archives.map(({ id }) => id),
      ];
      const rerankPoolLinkedEvidence = filterLinkedEvidence(
        visibleEvidencePool,
        new Set([
          ...rerankPoolFactSourceIds,
          ...rerankPoolSelection.references.map(({ id }) => id),
          ...feedback.map(({ id }) => id),
          ...rerankPoolSelection.episodes.map(({ id }) => id),
        ]),
        new Set(rerankPoolSelection.archives.map(({ id }) => id)),
        feedbackEvidenceIds,
      );
      const rerankPoolEvidence = routingDecision.sourcePriorities.includes("evidence")
        ? [...new Map(
            [...rerankPoolLinkedEvidence, ...sessionScopedEvidence].map((record) => [
              record.id,
              record,
            ]),
          ).values()]
        : [];
      const contextEvidence = selectEvidence(completeEvidence);
      const evidence = input.includeEvidence ? completeEvidence : contextEvidence;
      const ambiguousSourceMemoryIds = findAmbiguousRecallRerankMemoryIds(
        rerankCandidates,
      );
      const evidenceIndex = buildEvidenceLinkIndex(
        explainabilityLinkedEvidence,
        ambiguousSourceMemoryIds,
      );
      const assistantSuppressionTraceReason = createAssistantSuppressionTraceReason(
        assistantInfluence?.suppressedCandidateIds ?? [],
      );
      const candidateTraces = appendAssistantTraceDetails(
        attachEvidenceIdsToCandidateTraces(
          [
            ...reconcileCandidateTraces(
              selectedFacts.traces,
              new Set(facts.map((fact) => fact.id)),
              assistantSuppressionTraceReason,
            ),
            ...reconcileCandidateTraces(
              selectedReferences.traces,
              new Set(references.map((reference) => reference.id)),
              assistantSuppressionTraceReason,
            ),
            ...reconcileCandidateTraces(
              selectedArchives.traces,
              new Set(archives.map((archive) => archive.id)),
              assistantSuppressionTraceReason,
            ),
            ...reconcileCandidateTraces(
              selectedEpisodes.traces,
              new Set(episodes.map((episode) => episode.id)),
              assistantSuppressionTraceReason,
            ),
          ],
          evidenceIndex,
        ),
        assistantInfluence,
      );
      const workingMemory =
        retrievalProfile === "coding_agent" ? workingMemoryRaw : null;
      const journal = retrievalProfile === "coding_agent" ? journalRaw : null;
      const selectedMemoryIds = [
        ...selectedFactSourceIds,
        ...references.map(({ id }) => id),
        ...feedback.map(({ id }) => id),
        ...episodes.map(({ id }) => id),
        ...archives.map(({ id }) => id),
      ];
      let ledgerClaims: ClaimProjection[] = [];
      if (
        input.includeEvidence &&
        rerankPoolEvidence.length > 0 &&
        config.projectionIndex
      ) {
        try {
          ledgerClaims = await config.projectionIndex.queryClaimsForSourceMemoryGroups(
            input.scope,
            rerankPoolMemoryIds,
          );
        } catch (error) {
          console.error(
            "[goodmemory:evidence-ledger] claim lookup failed; returning raw evidence ledger",
            error,
          );
        }
      }
      const evidenceLedger = input.includeEvidence
        ? buildEvidenceLedger({
            aggregation: recallPlan.aggregation,
            ambiguousSourceMemoryIds: [...ambiguousSourceMemoryIds],
            claims: ledgerClaims,
            evidence,
            referenceTime: currentReferenceTime,
            selectedMemoryIds,
          })
        : undefined;
      const packet = buildMemoryPacket({
        profile: filteredProfile,
        preferences,
        references,
        facts,
        feedback,
        archives,
        evidence: contextEvidence,
        episodes,
        workingMemory,
        journal,
        maxRenderedTokens: recallPlan.maxRenderedTokens,
        language,
        languageContext: resolvedLanguage,
        durableCandidateOrder: assistantInfluence?.rerankApplied
          ? assistantInfluence.rerankedCandidateIds
          : undefined,
        locale: resolvedLanguage.locale,
        routingDecision,
      });

      const result: RecallResult = {
        profile: filteredProfile,
        preferences,
        references,
        facts,
        feedback,
        archives,
        evidence,
        ...(evidenceLedger ? { evidenceLedger } : {}),
        episodes,
        workingMemory,
        journal,
        packet,
        metadata: {
          ...(assistantInfluence
            ? { assistantInfluence: finalizeAssistantInfluence(assistantInfluence)! }
            : {}),
          routingDecision,
          tokenCount: packet.debug?.estimatedTokens ?? 0,
          latencyMs: now() - startedAt,
          verificationHints: evaluateVerificationHints({
            query: input.query,
            referenceTime: currentReferenceTime,
            evidenceIdsByMemoryId: evidenceIndex.byMemoryId,
            facts,
            references,
            episodes,
            locale: resolvedLanguage.locale,
            language,
            queryAnalysis,
          }),
          candidateTraces,
          policyApplied: [...policyApplied],
          locale: resolvedLanguage.locale,
          localeSource: resolvedLanguage.localeSource,
          languagePackId: resolvedLanguage.languagePackId,
          languagePackVersion: resolvedLanguage.languagePackVersion,
          analysisMode: resolvedLanguage.analysisMode,
          ...(retrievalTrace ? { retrievalTrace } : {}),
          hits: buildHits({
            profile: filteredProfile,
            preferences,
            references,
            facts,
            feedback,
            archives,
            evidence,
            episodes,
            workingMemory,
            journal,
            evidenceIndex,
            routingDecision,
            // buildHits iterates the post-policy facts, so a union admit the
            // recall policy removed never becomes a hit even though its
            // selection trace exists.
            semanticUnionFactIds: new Set(
              selectedFacts.traces
                .filter(
                  (trace) =>
                    trace.returned && trace.fallback === "semantic_union",
                )
                .map((trace) => trace.memoryId),
            ),
            generalizedFusionFactIds: new Set(
              selectedFacts.traces
                .filter(
                  (trace) =>
                    trace.returned && trace.fallback === "generalized_fusion",
                )
                .map((trace) => trace.memoryId),
            ),
            generalizedFusionReferenceIds: new Set(
              selectedReferences.traces
                .filter(
                  (trace) =>
                    trace.returned && trace.fallback === "generalized_fusion",
                )
                .map((trace) => trace.memoryId),
            ),
            generalizedFusionArchiveIds: new Set(
              selectedArchives.traces
                .filter(
                  (trace) =>
                    trace.returned && trace.fallback === "generalized_fusion",
                )
                .map((trace) => trace.memoryId),
            ),
            generalizedFusionEpisodeIds: new Set(
              selectedEpisodes.traces
                .filter(
                  (trace) =>
                    trace.returned && trace.fallback === "generalized_fusion",
                )
                .map((trace) => trace.memoryId),
            ),
          }),
        },
      };
      return setRecallRerankPool(result, {
        aggregation: recallPlan.aggregation,
        candidates: rerankCandidates,
        claims: ledgerClaims,
        evidence: rerankPoolEvidence,
        explicitEvidenceIds: [...new Set([
          ...feedbackEvidenceIds,
          ...sessionScopedEvidence.map(({ id }) => id),
        ])],
        includeEvidence: input.includeEvidence === true,
        laneCaps: {
          facts: recallPlan.selectedLimit,
          references:
            generalizedFusionConfig?.contentLaneRecords?.references ?? 1,
          episodes:
            generalizedFusionConfig?.contentLaneRecords?.episodes ?? 2,
          session_archives:
            generalizedFusionConfig?.contentLaneRecords?.sessionArchives ?? 1,
        },
        referenceTime: currentReferenceTime,
      });
    },
  };
}
