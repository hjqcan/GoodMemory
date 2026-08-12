import type { EvidenceLedgerFormat } from "../answer/evidenceLedgerContext";
import type { MemoryScope } from "../domain/scope";
import type {
  ArtifactSpillRecord,
  EpisodeMemory,
  FactMemory,
  FeedbackKind,
  FeedbackMemory,
  PreferenceMemory,
  ReferenceMemory,
  SessionBuffer,
  SessionJournal,
  SessionMessage,
  UserProfile,
  WorkingMemorySnapshot,
} from "../domain/records";
import type { EmbeddingAdapter } from "../embedding/contracts";
import type { EvidenceRecord, SourceMessageRecord } from "../evidence/contracts";
import type {
  ExperienceRecord,
  LearningProposal,
  LearningProposalStatus,
  LearningProposalType,
  PromotionDecision,
  PromotionRecord,
  SessionArchive,
} from "../evolution/contracts";
import type { MarkdownArtifactBundle } from "../governance/markdownArtifacts";
import type { LanguageConfig } from "../language";
import type {
  GoodMemoryObservabilityConfig,
  GoodMemoryScopeDigest,
} from "../observability/contracts";
import type { MaintenanceJobName, MaintenanceRunReport } from "../maintenance/runner";
import type { GoodMemoryPolicyHooks } from "../policy/hooks";
import type { MemoryPacket } from "../recall/contextBuilder";
import type { EvidenceLedgerEntry } from "../recall/evidenceLedger";
import type { GeneralizedFusionChannel } from "../recall/generalizedFusion";
import type { FollowUpDecision } from "../recall/iterativeRecall";
import type { RecallPlanAssistant } from "../recall/recallPlan";
import type {
  RecallCandidateTrace,
  RecallHit,
  RecallSemanticCandidatesConfig,
} from "../recall/engine";
import type { RecallAssistantInfluence } from "../recall/assistant";
import type { Reranker } from "../recall/reranker";
import type { RecallRetrievalTrace } from "../recall/retrievalTrace";
import type {
  RecallRouterStrategy,
  RoutingDecision,
} from "../recall/router";
import type {
  MessageAnnotation,
  MemoryExtractionStrategy,
  MemoryExtractor,
} from "../remember/candidates";
import type { RememberConfig } from "../remember/profiles";
import type { RememberResult as RememberPipelineResult } from "../remember/contracts";
import type {
  RuntimeContextState,
  RuntimeRecallSnapshot,
  SessionJournalPatch,
  SessionSummaryInput,
  WorkingMemoryPatch,
} from "../runtime/contextService";
import type {
  DocumentStore,
  SessionStore,
  VectorStore,
} from "../storage/contracts";
import type { VerificationHint } from "../verify/policy";

export interface StorageConfig {
  provider?: "memory" | "sqlite" | "postgres";
  url?: string;
}

export type GoodMemoryEmbeddingProviderId = "openai";
export type GoodMemoryExtractionProviderId = "openai" | "anthropic";
export type GoodMemoryRerankingProviderId = "openai" | "anthropic";

export interface GoodMemoryEmbeddingProviderConfig {
  provider: GoodMemoryEmbeddingProviderId;
  model: string;
  apiKey: string;
  baseURL?: string;
}

export interface GoodMemoryExtractionProviderConfig {
  provider: GoodMemoryExtractionProviderId;
  model: string;
  apiKey: string;
  baseURL?: string;
  // Assisted extraction prompt mode. "default" extracts durable product memory
  // (profiles, preferences, references, facts). "conversational" decomposes
  // dialogue into self-contained, coreference-resolved, entity/date-normalized
  // atomic claims to improve recall on conversational corpora (the LoCoMo
  // phrasing-gap lever) without a neural embedding endpoint. Defaults to
  // "default" when omitted, so existing configs are unchanged.
  mode?: "default" | "conversational";
  // Opt-in (conversational mode only): prefix each extracted fact with a brief
  // situating context from the surrounding dialogue (the embedding-free
  // Contextual Retrieval lever) so it is retrievable by vocabulary the bare claim
  // would not contain. Additive and never destructive; off by default.
  contextualDescriptors?: boolean;
}

export interface GoodMemoryRerankingProviderConfig {
  provider: GoodMemoryRerankingProviderId;
  model: string;
  apiKey: string;
  baseURL?: string;
  requestTimeoutMs?: number;
}

export interface GoodMemoryProviderConfig {
  embedding?: GoodMemoryEmbeddingProviderConfig;
  extraction?: GoodMemoryExtractionProviderConfig;
  reranking?: GoodMemoryRerankingProviderConfig;
}

// Opt-in semantic candidate-generation union. Requires an embedding adapter +
// vector store and the "hybrid" recall strategy; the cosine top-K facts are
// then force-admitted into fact selection regardless of lexical overlap —
// additive only (never removes or reorders lexically-admitted facts), with
// maxAdditions as the noise budget. Off by default: when unset, recall
// behavior is byte-identical.
export type GoodMemorySemanticCandidatesConfig = RecallSemanticCandidatesConfig;

// Named retrieval presets, mirroring the remember.preset convention. Open
// union so future presets extend it.
export type GoodMemoryRetrievalPresetId = "recommended";

export interface GoodMemoryRetrievalConfig {
  // One-flag generalized profile: expands to the retrieval+extraction side of
  // generalized RRF retrieval plus optional semantic candidates and
  // conversational write-time extraction (flipped only when an extraction
  // model resolves and mode is unset; never injects a provider) — and biases
  // "auto" recall routing to hybrid. Without a neural embedding endpoint it
  // stays local and deterministic on BM25 + direct entity adjacency; available
  // embeddings add a dense RRF channel. Explicit fields below always win over
  // the preset; unset keeps the zero-dependency default behavior unchanged.
  preset?: GoodMemoryRetrievalPresetId;
  // Experimental E2 ablation hook. Omit to run all five fusion channels.
  generalizedFusionChannels?: readonly GeneralizedFusionChannel[];
  // Experimental dynamic-budget floor for generalized fusion: candidates whose
  // evidence strength falls below this fraction of the strongest candidate are
  // trimmed before selection. Omit to keep the fixed top-N cut (no trimming).
  generalizedFusionMinRelativeStrength?: number;
  // Experimental R7 entity-graph upgrade: score the fusion entity channel
  // with personalized PageRank over the entity-memory graph (2-hop
  // association) instead of 1-hop adjacency. Omit to keep 1-hop.
  generalizedFusionEntityPageRank?: boolean;
  // Experimental Phase 74 execution path. When enabled, the query-derived
  // RecallPlan drives retrieval, decomposition, and iterative recall unless a
  // call supplies an explicit override. Off uses the unplanned baseline until
  // promotion gates pass.
  recallPlanExecution?: boolean;
  // Opt-in: use Okapi BM25 (IDF + document-length normalization) as the additive
  // lexical ranking signal for hybrid/llm-assisted strategies, populating the
  // same ranking slot the neural semantic score would, so it works with no
  // embedding endpoint. The default rules-only lexical floor is unchanged and
  // never receives the additive term; this only adds signal under non-rules-only
  // strategies. Defaults to off, so accepted rules-only/hybrid behavior is
  // unchanged unless explicitly enabled. The recommended preset never sets it:
  // generalized fusion already owns a separate BM25 candidate channel.
  bm25Ranking?: boolean;
  // Opt-in semantic candidate-generation union (see the type above). This is
  // the explicit legacy union can surface a fact sharing no tokens with the
  // query; the additive semantic score alone only re-ranks candidates that pass
  // the legacy lexical admission gates.
  semanticCandidates?: GoodMemorySemanticCandidatesConfig;
}

export interface GoodMemoryConfig {
  storage?: StorageConfig;
  policy?: GoodMemoryPolicyHooks;
  language?: LanguageConfig;
  remember?: RememberConfig;
  observability?: GoodMemoryObservabilityConfig;
  providers?: GoodMemoryProviderConfig;
  retrieval?: GoodMemoryRetrievalConfig;
  adapters?: {
    assistedExtractor?: MemoryExtractor;
    documentStore?: DocumentStore;
    embeddingAdapter?: EmbeddingAdapter;
    // Opt-in reranker over a bounded global durable-candidate window. Query and
    // candidate text are bounded; IDs remain raw when unique and become
    // collection-qualified on collision. The final packet contains at most the
    // RecallPlan selectedLimit across facts, references, episodes, and archives.
    reranker?: Reranker;
    recallPlanner?: RecallPlanAssistant;
    // Opt-in generator for the retrievalCues maintenance job: write-time
    // question expansions stored under the reserved
    // attributes.retrievalCues key. Cues are index-only retrieval keys —
    // projected into the lexical channel, never rendered into context.
    retrievalCueGenerator?: {
      generate(input: {
        category: string;
        content: string;
        subject?: string;
      }): Promise<string[]>;
    };
    // R8 opt-in: evidence-conditioned multi-hop sufficiency decisions. A
    // decision may continue only by naming one focused missing-slot query.
    followUpDecisionGenerator?: {
      generate(input: {
        evidence: readonly string[];
        hop: number;
        query: string;
      }): Promise<FollowUpDecision>;
    };
    // R9 opt-in synthesizer for the observationSynthesis maintenance job:
    // one compact observation memory per subject with enough active facts,
    // stored with inferred provenance and member-id attribute pointers.
    observationSynthesizer?: {
      synthesize(input: {
        contents: readonly string[];
        subject: string;
      }): Promise<string | null>;
    };
    sessionStore?: SessionStore;
    /**
     * Required before terminal deletion when custom storage adapters are used.
     * Caller assertion: every cooperating runtime points documentStore,
     * sessionStore, and vectorStore at the same corresponding shared backends,
     * and every writer enters the GoodMemory mutation protocol.
     */
    terminalDeletionSemantics?: "shared-coordinated-backends-v1";
    vectorStore?: VectorStore;
  };
  testing?: {
    createId?: () => string;
    extractor?: MemoryExtractor;
    now?: () => Date;
  };
}

export interface RecallInput {
  scope: MemoryScope;
  query: string;
  retrievalProfile?: "general_chat" | "coding_agent";
  strategy?: RecallRouterStrategy;
  // Override iterative retrieval. `false` forces one pass, `true` runs the
  // default iterative path, and a number sets the maximum number of passes.
  // When unset, the experimental plan-execution profile may use maxHops.
  multiHop?: boolean | number;
  // Override decomposition. When unset, the experimental plan-execution
  // profile may recall non-empty planned facets. `false` forces one query.
  decompose?: boolean;
  // When a reranker adapter is configured, reranking is applied unless this is
  // set to false; ignored when no reranker is configured.
  rerank?: boolean;
  // Opt in to source excerpts linked to selected memories. General recall keeps
  // evidence closed by default so provenance does not consume answer context.
  includeEvidence?: boolean;
  ignoreMemory?: boolean;
  locale?: string;
  // Optional per-call temporal anchor (RFC 3339 instant with an explicit
  // offset). Anchors plan resolution,
  // temporal claim selection, document visibility, and freshness for this
  // recall instead of the runtime clock — e.g. "answer as of the question
  // date". Invalid explicit values are rejected.
  referenceTime?: string;
  // IANA timezone used to resolve relative calendar expressions. When absent,
  // GoodMemory may use the persisted user-profile timezone; it never guesses
  // from the server process timezone.
  timezone?: string;
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
    traceId?: string;
    traceScopeDigest?: GoodMemoryScopeDigest;
  };
}

export interface BuildContextInput {
  recall: RecallResult;
  output?: "json" | "markdown" | "system_prompt_fragment" | "developer_prompt_fragment";
  maxTokens?: number;
  evidenceLedgerFormat?: EvidenceLedgerFormat;
  // Opt-in: drop evidence lines that duplicate a fact verbatim (used by host
  // injection to avoid redundant Evidence/Facts noise in the injected fragment).
  // Off by default so benchmark rendering is unchanged.
  suppressDuplicateEvidence?: boolean;
}

export interface BuildContextResult {
  output: "json" | "markdown" | "system_prompt_fragment" | "developer_prompt_fragment";
  content: string;
  estimatedTokens: number;
  omittedSections: string[];
  traceId?: string;
}

export interface RememberInput {
  scope: MemoryScope;
  messages: SessionMessage[];
  annotations?: MessageAnnotation[];
  extractionStrategy?: MemoryExtractionStrategy;
  locale?: string;
  // Call-level IANA timezone fallback for messages without their own timezone.
  timezone?: string;
}

export interface RememberResult {
  accepted: number;
  rejected: number;
  events: RememberPipelineResult["events"];
  outcome?: RememberPipelineResult["outcome"];
  // Non-fatal degradation codes (present only when non-empty): e.g.
  // "no_durable_facts_extracted" or "assisted_extraction_failed". See the
  // remember engine's RememberResult for the full list.
  warnings?: string[];
  metadata?: {
    locale: string;
    localeSource: "explicit" | "detected" | "default";
    languagePackId: string;
    languagePackVersion?: string;
    analysisMode: "rules-only";
    requestedExtractionStrategy: MemoryExtractionStrategy;
    resolvedExtractionStrategy: MemoryExtractionStrategy;
    traceId?: string;
  };
}

export type RevisableMemoryType =
  | "preference"
  | "reference"
  | "fact"
  | "feedback";

export type ReviseMemoryReason =
  | "user_correction"
  | "manual_review"
  | "system_repair"
  | (string & {});

export type ReviseMemoryEvidenceSource =
  | "user_message"
  | "manual_review"
  | "system";

export interface ReviseMemoryInput {
  scope: MemoryScope;
  target: {
    memoryId: string;
  };
  revision: {
    content: string;
  };
  reason: ReviseMemoryReason;
  evidence?: {
    source: ReviseMemoryEvidenceSource;
    message?: string;
    excerpt?: string;
    sourceUri?: string;
    sourceMessageIds?: string[];
  };
  idempotencyKey: string;
  locale?: string;
}

export interface ReviseMemoryResult {
  accepted: boolean;
  outcome: "superseded" | "blocked" | "not_found" | "unsupported";
  memoryType?: RevisableMemoryType;
  previousMemoryId?: string;
  newMemoryId?: string;
  evidenceIds?: string[];
  supersedeLineage?: {
    supersedes: string;
    supersededBy: string;
  };
  policyApplied: string[];
  reason?: string;
  traceId?: string;
  warnings?: string[];
}

export interface ForgetInput {
  scope: MemoryScope;
  memoryId?: string;
}

export interface ForgetResult {
  forgotten: boolean;
  traceId?: string;
}

export interface ExportMemoryInput {
  scope: MemoryScope;
  includeRuntime?: boolean;
  locale?: string;
}

export interface ExportMemoryResult {
  artifacts: MarkdownArtifactBundle;
  scope: MemoryScope;
  exportedAt: string;
  traceId?: string;
  durable: {
    profile: UserProfile | null;
    preferences: PreferenceMemory[];
    references: ReferenceMemory[];
    facts: FactMemory[];
    feedback: FeedbackMemory[];
    episodes: EpisodeMemory[];
    archives: SessionArchive[];
    evidence: EvidenceRecord[];
    sourceMessages?: SourceMessageRecord[];
    experiences: ExperienceRecord[];
    proposals: LearningProposal[];
    promotions: PromotionRecord[];
  };
  runtime?: {
    workingMemory: WorkingMemorySnapshot | null;
    journal: SessionJournal | null;
    spills: ArtifactSpillRecord[];
  };
}

export interface DeleteAllMemoryInput {
  scope: MemoryScope;
  includeRuntime?: boolean;
  /**
   * Explicit recovery of a persisted interrupted deletion. Set this only
   * after every runtime that could still own the old deletion or mutation
   * attempt has terminated.
   */
  resumeInterrupted?: {
    confirmPriorRuntimesStopped: true;
  };
}

export interface DeleteAllMemoryResult {
  scope: MemoryScope;
  traceId?: string;
  deleted: {
    profiles: number;
    preferences: number;
    references: number;
    facts: number;
    feedback: number;
    episodes: number;
    archives: number;
    evidence: number;
    experiences: number;
    proposals: number;
    promotions: number;
    workingMemory: number;
    journal: number;
    artifactSpills: number;
  };
}

export interface FeedbackInput {
  scope: MemoryScope;
  signal: string;
  locale?: string;
}

export interface FeedbackProposalReceipt {
  proposalId: string;
  proposalType: LearningProposalType;
  status: LearningProposalStatus;
}

export interface FeedbackPromotionReceipt {
  decision: PromotionDecision;
  promotionId: string;
  proposalId: string;
}

export interface FeedbackResult {
  accepted: boolean;
  evidenceIds?: string[];
  outcome?: "written" | "merged" | "superseded";
  memoryId?: string;
  kind?: FeedbackKind;
  proposalReceipts?: FeedbackProposalReceipt[];
  promotionReceipts?: FeedbackPromotionReceipt[];
  metadata?: {
    locale: string;
    localeSource: "explicit" | "detected" | "default";
    languagePackId: string;
    languagePackVersion?: string;
    analysisMode: "rules-only";
    traceId?: string;
  };
}

export interface RunMaintenanceInput {
  scope: MemoryScope;
  jobs?: MaintenanceJobName[];
  lastRunAt?: string;
  minHoursBetweenRuns?: number;
  minSessionCount?: number;
  sessionCountSinceLastRun?: number;
}

export interface RunMaintenanceResult {
  compiledCount: number;
  maintenance: MaintenanceRunReport | null;
  promotionDecisionCounts: Partial<Record<PromotionDecision, number>>;
  proposalCount: number;
  ran: boolean;
  reason: "completed" | "cooldown" | "scope_busy" | "threshold";
  traceId?: string;
}

export type MemoryWriteJobOperation = "remember";

export type MemoryWriteJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "canceled";

export type MemoryWriteJobErrorCode =
  | "idempotency_conflict"
  | "job_payload_unavailable"
  | "remember_failed"
  | "write_blocked"
  | (string & {});

export interface MemoryWriteJobLastError {
  code: MemoryWriteJobErrorCode;
  message: string;
}

export interface MemoryWriteJob {
  jobId: string;
  idempotencyKey: string;
  operation: MemoryWriteJobOperation;
  status: MemoryWriteJobStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastError?: MemoryWriteJobLastError;
  linkedTraceIds: string[];
  linkedMemoryIds: string[];
  linkedEvidenceIds: string[];
}

export type MemoryWriteJobReason =
  | "post_response_memory_write"
  | "manual_enqueue"
  | (string & {});

export interface EnqueueRememberJobInput extends RememberInput {
  idempotencyKey: string;
  reason?: MemoryWriteJobReason;
}

export interface GoodMemoryJobsLookupInput {
  jobId: string;
}

export interface GoodMemoryJobsDrainInput {
  maxJobs?: number;
}

export interface GoodMemoryJobsDrainResult {
  processed: number;
  jobs: MemoryWriteJob[];
}

export interface GoodMemoryJobsFacade {
  enqueueRemember(input: EnqueueRememberJobInput): Promise<MemoryWriteJob>;
  getJob(input: GoodMemoryJobsLookupInput): Promise<MemoryWriteJob | null>;
  retryJob(input: GoodMemoryJobsLookupInput): Promise<MemoryWriteJob | null>;
  drain(input?: GoodMemoryJobsDrainInput): Promise<GoodMemoryJobsDrainResult>;
}

export interface GoodMemoryRuntimeStartSessionInput {
  scope: MemoryScope;
}

export interface GoodMemoryRuntimeStateResult {
  state: RuntimeContextState;
  traceId?: string;
}

export interface GoodMemoryRuntimeAppendMessageInput {
  scope: MemoryScope;
  message: SessionMessage;
}

export interface GoodMemoryRuntimeBufferResult {
  buffer: SessionBuffer;
}

export interface GoodMemoryRuntimeSetSessionSummaryInput extends SessionSummaryInput {
  scope: MemoryScope;
}

export interface GoodMemoryRuntimeUpdateWorkingMemoryInput {
  scope: MemoryScope;
  patch: WorkingMemoryPatch;
}

export interface GoodMemoryRuntimeWorkingMemoryResult {
  workingMemory: WorkingMemorySnapshot;
}

export interface GoodMemoryRuntimeUpdateSessionJournalInput {
  scope: MemoryScope;
  patch: SessionJournalPatch;
}

export interface GoodMemoryRuntimeSessionJournalResult {
  journal: SessionJournal;
}

export interface GoodMemoryRuntimeGetRecallSnapshotInput {
  scope: MemoryScope;
  retrievalProfile?: "general_chat" | "coding_agent";
}

export interface GoodMemoryRuntimeRecallSnapshotResult {
  snapshot: RuntimeRecallSnapshot;
}

export interface GoodMemoryRuntimeSummaryOnlyArchiveOptions {
  mode: "summary_only";
  includeNormalizedTranscript?: false;
}

export interface GoodMemoryRuntimeEndSessionInput {
  scope: MemoryScope;
  archive?: "off" | GoodMemoryRuntimeSummaryOnlyArchiveOptions;
}

export interface GoodMemoryRuntimeFacade {
  startSession(input: GoodMemoryRuntimeStartSessionInput): Promise<GoodMemoryRuntimeStateResult>;
  getState(input: GoodMemoryRuntimeStartSessionInput): Promise<GoodMemoryRuntimeStateResult>;
  appendMessage(input: GoodMemoryRuntimeAppendMessageInput): Promise<GoodMemoryRuntimeBufferResult>;
  setSessionSummary(input: GoodMemoryRuntimeSetSessionSummaryInput): Promise<GoodMemoryRuntimeBufferResult>;
  updateWorkingMemory(input: GoodMemoryRuntimeUpdateWorkingMemoryInput): Promise<GoodMemoryRuntimeWorkingMemoryResult>;
  updateSessionJournal(input: GoodMemoryRuntimeUpdateSessionJournalInput): Promise<GoodMemoryRuntimeSessionJournalResult>;
  getRecallSnapshot(input: GoodMemoryRuntimeGetRecallSnapshotInput): Promise<GoodMemoryRuntimeRecallSnapshotResult>;
  endSession(input: GoodMemoryRuntimeEndSessionInput): Promise<GoodMemoryRuntimeStateResult>;
}

export interface GoodMemory {
  jobs: GoodMemoryJobsFacade;
  runtime: GoodMemoryRuntimeFacade;
  recall(input: RecallInput): Promise<RecallResult>;
  buildContext(input: BuildContextInput): Promise<BuildContextResult>;
  remember(input: RememberInput): Promise<RememberResult>;
  reviseMemory(input: ReviseMemoryInput): Promise<ReviseMemoryResult>;
  forget(input: ForgetInput): Promise<ForgetResult>;
  exportMemory(input: ExportMemoryInput): Promise<ExportMemoryResult>;
  /** Requires a projection-capable document store so scoped deletion is terminal. */
  deleteAllMemory(input: DeleteAllMemoryInput): Promise<DeleteAllMemoryResult>;
  feedback(input: FeedbackInput): Promise<FeedbackResult>;
  runMaintenance(input: RunMaintenanceInput): Promise<RunMaintenanceResult>;
}
