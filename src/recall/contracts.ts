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
import type { SessionArchive } from "../domain/evolutionRecords";
import type { MemorySourceMethod } from "../domain/provenance";
import type { MemoryScope } from "../domain/scope";
import type { EmbeddingAdapter } from "../embedding/contracts";
import type { EvidenceRecord } from "../evidence/contracts";
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
import type { VerificationHint } from "../verify/policy";
import type { RecallAssistantInfluence, RecallRouterAssistant } from "./assistant";
import type { MemoryPacket } from "./contextBuilder";
import type { EvidenceLedgerEntry } from "./evidenceLedger";
import type { FactSelector } from "./generalizedSelection";
import type {
  GeneralizedFusionCandidate,
  GeneralizedFusionChannel,
} from "./generalizedFusion";
import type { GeneralizedFusionSelectionInput } from "./factSelection/generalizedFusionUnion";
import type {
  ClaimProjection,
  RecallIndexDocument,
  RecallProjectionSearchPort,
} from "./projections/contracts";
import type {
  RecallPlan,
  RecallPlanAssistant,
} from "./recallPlan";
import type { RecallRetrievalTrace } from "./retrievalTrace";
import type { SemanticSearchScores } from "./scoring";
import type {
  RecallRouterStrategy,
  RecallSlot,
  RetrievalProfile,
  RoutingDecision,
} from "./router";

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
  /** Request-local RFC 3339 temporal anchor. */
  referenceTime?: string;
  /** Request-local IANA timezone for relative calendar expressions. */
  timezone?: string;
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
  /** @deprecated since 0.7.3. Always zero; retrieval exposure is not reinforcement. */
  usageScore?: number;
  evidenceScore?: number;
  /** @deprecated since 0.7.3. Use evidenceScore. */
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
    | "generalized_fusion"
    | "temporal_occurrence";
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
  // R7 opt-in: personalized PageRank scoring for the entity channel (see
  // GeneralizedFusionInput.entityPageRank). Absent keeps 1-hop adjacency.
  entityPageRank?: boolean;
  minRelativeStrength?: number;
  rrfK?: number;
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

export interface RecallGeneralizedFusionBudget {
  readonly expanded: boolean;
  readonly maxCandidates: number;
  readonly maxTotalFacts: number;
}

/** Request facts resolved exactly once before storage or retrieval side effects. */
export interface RecallRequestContext {
  readonly currentReferenceTime: string;
  readonly evidenceReferenceTime: string;
  readonly generalizedFusionBudget?: RecallGeneralizedFusionBudget;
  readonly generalizedFusionConfig?: RecallGeneralizedFusionConfig;
  readonly input: RecallInput;
  readonly language: LanguageService;
  readonly languageContext: ResolvedLanguageContext;
  readonly policyApplied: readonly string[];
  readonly queryAnalysis: LanguageQueryAnalysis;
  readonly recallPlan: RecallPlan;
  readonly retrievalProfile: RetrievalProfile;
  readonly startedAt: number;
  readonly vectorIndex: RecallVectorSearchPort | null;
}

/** Canonical records loaded for a request; replacements create a new DTO. */
export interface LoadedRecallContent {
  readonly archives: SessionArchive[];
  readonly episodes: EpisodeMemory[];
  readonly evidence: EvidenceRecord[];
  readonly facts: FactMemory[];
  readonly feedback: FeedbackMemory[];
  readonly journal: SessionJournal | null;
  readonly policyApplied: readonly string[];
  readonly preferences: PreferenceMemory[];
  readonly profile: UserProfile | null;
  readonly projected: boolean;
  readonly references: ReferenceMemory[];
  readonly workingMemory: WorkingMemorySnapshot | null;
}

/** Retrieval output consumed by lane selection and result assembly. */
export interface RetrievedRecallCandidates {
  readonly assistantInfluence?: RecallAssistantInfluence;
  readonly claimReplacementSourceIds: ReadonlySet<string>;
  readonly content: LoadedRecallContent;
  readonly evidenceCountsByMemoryId: Map<string, number>;
  readonly generalizedFusion?: GeneralizedFusionSelectionInput;
  readonly generalizedFusionCandidates: GeneralizedFusionCandidate[];
  readonly ignored: boolean;
  readonly policyApplied: readonly string[];
  readonly rerankProjectionClaims: ClaimProjection[];
  readonly rerankProjectionDocuments: RecallIndexDocument[];
  readonly retrievalTrace?: RecallRetrievalTrace;
  readonly routingDecision: RoutingDecision;
  readonly selectedClaimSourceFacts: FactMemory[];
  readonly semanticFactCandidates?: SemanticSearchScores["semanticFactCandidates"];
  readonly semanticScores?: SemanticSearchScores;
  readonly semanticUnionTopK: number;
  readonly visibleEvidencePool: EvidenceRecord[];
}
