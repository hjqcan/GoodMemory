import type { MemoryScope } from "./domain/scope";
import type {
  ArtifactSpillRecord,
  EpisodeMemory,
  FactKind,
  FeedbackKind,
  FactMemory,
  FeedbackMemory,
  MemoryScopeKind,
  PreferenceMemory,
  ReferenceKind,
  ReferenceMemory,
  SessionJournal,
  UserProfile,
  WorkingMemorySnapshot,
} from "./domain/records";
import type { EvidenceRecord } from "./evidence/contracts";
import type { EmbeddingAdapter } from "./embedding/contracts";
import type {
  MarkdownArtifactBundle,
} from "./governance/markdownArtifacts";
import {
  createFeedbackMemory,
} from "./domain/records";
import {
  createMemorySource,
} from "./domain/provenance";
import { EVIDENCE_COLLECTION } from "./evidence/contracts";
import type { MemorySourceMethod } from "./domain/provenance";
import type {
  ConflictResolution,
  GoodMemoryPolicyHooks,
  PolicyContext,
  PolicyMemoryRecord,
} from "./policy/hooks";
import {
  renderMemoryPacket,
  type MemoryPacket,
} from "./recall/contextBuilder";
import type { RecallRouterStrategy } from "./recall/router";
import type { MemoryExtractionStrategy } from "./remember/candidates";
import { createDeterministicMemoryExtractor } from "./remember/deterministicExtractor";
import {
  type LanguageConfig,
  type LanguagePack,
  type LocaleDetector,
} from "./language";
import { createInMemoryDocumentStore, createInMemorySessionStore, createInMemoryVectorStore } from "./storage/memory";
import {
  createPostgresDocumentStore,
  createPostgresSessionStore,
  createPostgresVectorStore,
} from "./storage/postgresPublic";
import {
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
  createSQLiteVectorStore,
} from "./storage/sqlitePublic";
import type {
  DocumentStore,
  SessionStore,
  VectorStore,
} from "./storage/contracts";

export type { MemoryScope } from "./domain/scope";
export {
  isSameScope,
  normalizeScope,
  scopeToKey,
} from "./domain/scope";
export type {
  MemoryKind,
  MemoryPlane,
} from "./domain/taxonomy";
export {
  getMemoryPlane,
  isMemoryKind,
  MEMORY_KIND_TO_PLANE,
} from "./domain/taxonomy";
export type {
  TemporalExpression,
  TemporalInterval,
  TemporalPrecision,
} from "./domain/temporal";
export {
  isIanaTimezone,
  isRfc3339Instant,
  resolveTemporalInterval,
} from "./domain/temporal";
export type {
  ArtifactSpillRecord,
  EpisodeMemory,
  FactKind,
  FactMemory,
  FeedbackKind,
  FeedbackMemory,
  MemoryScopeKind,
  PreferenceMemory,
  ReferenceKind,
  ReferenceMemory,
  SessionMessage,
  SessionJournal,
  UserProfile,
  WorkingMemorySnapshot,
} from "./domain/records";
export {
  createEpisodeMemory,
  createFactMemory,
  createFeedbackMemory,
  createPreferenceMemory,
  createReferenceMemory,
  createSessionBuffer,
  createSessionJournal,
  createUserProfile,
  createWorkingMemorySnapshot,
  isFactExpired,
} from "./domain/records";
export type {
  EvidenceKind,
  EvidenceRecord,
  SourceMessageRecord,
} from "./evidence/contracts";
export {
  createEvidenceRecord,
  EVIDENCE_COLLECTION,
  SOURCE_MESSAGES_COLLECTION,
} from "./evidence/contracts";
export type { EmbeddingAdapter } from "./embedding/contracts";
export {
  createLocalEmbeddingAdapter,
  embedTextLocally,
} from "./embedding/localEmbeddingAdapter";
export {
  extractBridgeEntities,
  iterativeRecall,
} from "./recall/iterativeRecall";
export type {
  FollowUpDecision,
  IterativeRecallOptions,
  IterativeRecallOutcome,
} from "./recall/iterativeRecall";
export {
  decomposedRecall,
  splitQueryIntoSubQueries,
} from "./recall/queryDecomposition";
export type {
  DecomposedRecallOutcome,
  QueryDecompositionOptions,
} from "./recall/queryDecomposition";
export {
  applyReranking,
  createLexicalCoverageReranker,
} from "./recall/reranker";
export type {
  Reranker,
  RerankerDocument,
  RerankerInput,
  RerankerScore,
} from "./recall/reranker";
export type {
  RecallFusionCandidateTrace,
  RecallFusionRunTrace,
  RecallRerankerScoreTrace,
  RecallRerankerTrace,
  RecallRetrievalChannel,
  RecallRetrievalChannelTrace,
  RecallRetrievalSourceCollection,
  RecallRetrievalTrace,
} from "./recall/retrievalTrace";
export type {
  EvidenceLedgerEntry,
} from "./recall/evidenceLedger";
export type {
  ClaimProjection,
  ClaimProjectionState,
  ClaimProjectionStatus,
} from "./recall/projections/contracts";
export type {
  RecallAggregation,
  RecallEvidenceNeed,
  RecallPlan,
  RecallPlanAssistant,
  RecallPlanAssistantInput,
  RecallPlanResolution,
  RecallPlanUncertainty,
  TemporalConstraint,
} from "./recall/recallPlan";
export {
  resolveCurrentValue,
  resolveCurrentValuesByGroup,
} from "./answer/currentValueResolution";
export type {
  CurrentValueEntry,
  CurrentValueReason,
  CurrentValueResolution,
} from "./answer/currentValueResolution";
export { computeBm25Scores } from "./recall/bm25";
export type { Bm25Document, Bm25Options } from "./recall/bm25";
export type {
  MemoryLifecycleState,
  MemorySource,
  MemorySourceMethod,
} from "./domain/provenance";
export {
  createMemorySource,
  transitionLifecycle,
} from "./domain/provenance";
export type {
  ConditionalDocumentWriteBatch,
  DocumentStore,
  DocumentWriteOperation,
  ProjectionCapableDocumentStore,
  SessionStore,
  StorageDocument,
  StorageFilter,
  VectorRecord,
  VectorSearchInput,
  VectorSearchResult,
  VectorStore,
} from "./storage/contracts";
export {
  PROJECTION_BATCH_SEMANTICS,
  isProjectionCapableDocumentStore,
  matchesFilter,
  shallowMergeDocument,
} from "./storage/contracts";
export {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "./storage/memory";
export {
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
  createSQLiteVectorStore,
} from "./storage/sqlitePublic";
export type {
  PostgresStorageConfig,
  PostgresStorageMigrationEvent,
  PostgresStorageMigrationOptions,
} from "./storage/postgresPublic";
export {
  createPostgresDocumentStore,
  createPostgresSessionStore,
  createPostgresVectorStore,
  migratePostgresStorageBackend,
} from "./storage/postgresPublic";
export type { MemoryPacket } from "./recall/contextBuilder";
export {
  buildMemoryPacket,
  renderMemoryPacket,
} from "./recall/contextBuilder";
export type {
  RecallCandidateTrace,
  RecallHit,
} from "./recall/engine";
export type { VerificationHint } from "./verify/policy";
export { evaluateVerificationHints } from "./verify/policy";
export type {
  RecallRouterAvailability,
  RecallRouterStrategy,
  RecallSlot,
  RecallRuntimeAvailability,
  RecallRoutingInput,
  RecallSource,
  RetrievalProfile,
  RouterStrategyExplanation,
  RoutingDecision,
} from "./recall/router";
export {
  planRecall,
  resolveRetrievalProfile,
  resolveRouterStrategy,
} from "./recall/router";
export type {
  MessageAnnotation,
  DurableOptOutDisposition,
  DurableOptOutTargetSelector,
  DurableTargetIdentity,
  MemoryCandidate,
  MemoryCandidateAnnotationTrace,
  MemoryCandidateExplicitness,
  MemoryCandidateKindHint,
  MemoryExtractionContext,
  MemoryExtractionInput,
  MemoryExtractionResult,
  MemoryExtractionStrategy,
  MemoryExtractor,
} from "./remember/candidates";
export { createDeterministicMemoryExtractor } from "./remember/deterministicExtractor";
export type {
  AssistantMemoryPolicy,
  NamedRememberProfileExtractor,
  RememberConfig,
  RememberPresetId,
  RememberProfile,
  RememberProfileExtractor,
  RememberProfileMatcher,
  RememberRule,
  RememberRuleMatchContext,
  RememberRuleMessageContext,
} from "./remember/profiles";
export { rememberRules } from "./remember/profiles";
export type {
  LanguageCandidateExtractionInput,
  LanguageAnalyzerManifest,
  LanguageAnalyzerManifestPack,
  LanguageBehavioralRuleAnalysis,
  LanguageConfig,
  LanguageContentAnalysis,
  LanguageDetectionInput,
  LanguageDetectionMode,
  LanguageDetectionStrength,
  LanguageEntityCandidateInput,
  LanguageEntityMention,
  LanguagePack,
  LanguageQueryAnalysis,
  LanguageRenderInput,
  LanguageRenderKey,
  LanguageService,
  LanguageSourceOfTruthDirective,
  LanguageTemporalExpression,
  LocaleDetector,
  LocaleDetectorInput,
  LocaleResolutionSource,
  ResolvedLanguageContext,
} from "./language";
export {
  createChineseLanguagePack,
  createEnglishLanguagePack,
  createFrenchLanguagePack,
  createJapaneseLanguagePack,
  createKoreanLanguagePack,
  createLanguageService,
  createNeutralLanguagePack,
  createSpanishLanguagePack,
} from "./language";
export type {
  ClassifiedCandidate,
  RememberEvent as RememberPipelineEvent,
  RememberResult as RememberPipelineResult,
} from "./remember/engine";
export type {
  ConflictResolution,
  GoodMemoryPolicyHooks,
  PolicyContext,
  PolicyMemoryRecord,
} from "./policy/hooks";
export {
  passesDefaultScopeGuard,
  toPolicyMemoryRecord,
} from "./policy/hooks";
export type {
  MarkdownArtifactBundle,
  MarkdownArtifactFile,
} from "./governance/markdownArtifacts";
export type {
  GoodMemoryObservabilityConfig,
  GoodMemoryScopeDigest,
  GoodMemoryTraceAttributeValue,
  GoodMemoryTraceLink,
  GoodMemoryTraceRedaction,
  GoodMemoryTraceSink,
  GoodMemoryTraceSpan,
  GoodMemoryTraceSpanName,
  GoodMemoryTraceSpanStatus,
} from "./observability/contracts";
export type {
  ModelTokenUsage,
  ModelUsageAttempt,
  ModelUsageCompleteness,
  ModelUsageOperation,
  ModelUsageSink,
} from "./provider/model-usage";
// Provider-backed adapters for embedding-based recall and LLM-assisted
// extraction. Exported so host runtimes (e.g. tachikoma) can opt into the
// quality tier against any OpenAI-compatible endpoint without reaching into
// package internals.
export { createAISDKEmbeddingAdapter } from "./provider/ai-sdk-runtime";
export type { AISDKModelConfig } from "./provider/ai-sdk-runtime";
export { createLLMMemoryExtractor } from "./provider/memory-extractor";
export type {
  RuntimeArchiveStore,
  RuntimeArchiveStoreConfig,
  RuntimeContextService,
  RuntimeContextServiceConfig,
  RuntimeContextState,
  RuntimeEndSessionArchiveOptions,
  RuntimeEndSessionOptions,
  RuntimeRecallSnapshot,
  SessionJournalPatch,
  SessionSummaryInput,
  WorkingMemoryPatch,
} from "./runtime/public";
export {
  createRuntimeArchiveStore,
  createRuntimeContextService,
} from "./runtime/public";

export type {
  BuildContextInput,
  BuildContextResult,
  DeleteAllMemoryInput,
  DeleteAllMemoryResult,
  ExportMemoryInput,
  ExportMemoryResult,
  FeedbackInput,
  FeedbackPromotionReceipt,
  FeedbackProposalReceipt,
  FeedbackResult,
  ForgetInput,
  ForgetResult,
  GoodMemory,
  GoodMemoryConfig,
  GoodMemoryEmbeddingProviderConfig,
  GoodMemoryEmbeddingProviderId,
  GoodMemoryExtractionProviderConfig,
  GoodMemoryExtractionProviderId,
  GoodMemoryJobsDrainInput,
  GoodMemoryJobsDrainResult,
  GoodMemoryJobsFacade,
  GoodMemoryJobsLookupInput,
  GoodMemoryProviderConfig,
  GoodMemoryRerankingProviderConfig,
  GoodMemoryRerankingProviderId,
  GoodMemoryRetrievalConfig,
  GoodMemoryRetrievalPresetId,
  GoodMemorySemanticCandidatesConfig,
  GoodMemoryRuntimeAppendMessageInput,
  GoodMemoryRuntimeBufferResult,
  GoodMemoryRuntimeEndSessionInput,
  GoodMemoryRuntimeFacade,
  GoodMemoryRuntimeGetRecallSnapshotInput,
  GoodMemoryRuntimeRecallSnapshotResult,
  GoodMemoryRuntimeSessionJournalResult,
  GoodMemoryRuntimeSetSessionSummaryInput,
  GoodMemoryRuntimeStartSessionInput,
  GoodMemoryRuntimeStateResult,
  GoodMemoryRuntimeSummaryOnlyArchiveOptions,
  GoodMemoryRuntimeUpdateSessionJournalInput,
  GoodMemoryRuntimeUpdateWorkingMemoryInput,
  GoodMemoryRuntimeWorkingMemoryResult,
  EnqueueRememberJobInput,
  MemoryWriteJob,
  MemoryWriteJobErrorCode,
  MemoryWriteJobLastError,
  MemoryWriteJobOperation,
  MemoryWriteJobReason,
  MemoryWriteJobStatus,
  RecallInput,
  RecallResult,
  RevisableMemoryType,
  ReviseMemoryEvidenceSource,
  ReviseMemoryInput,
  ReviseMemoryReason,
  ReviseMemoryResult,
  RememberInput,
  RememberResult,
  RunMaintenanceInput,
  RunMaintenanceResult,
  StorageConfig,
} from "./api/contracts";
export { createGoodMemory } from "./api/createGoodMemory";
export type { GoodMemoryRetrievalPresetStatus } from "./api/retrievalPreset";
export { createGoodMemoryLangGraphStore } from "./langgraph";
export type {
  GoodMemoryLangGraphItem,
  GoodMemoryLangGraphOperation,
  GoodMemoryLangGraphSearchItem,
  GoodMemoryLangGraphStore,
} from "./langgraph";
export type {
  GoodMemoryRuntimeInfo,
  GoodMemoryStorageRuntimeInfo,
} from "./api/runtimeInfo";
export {
  inspectGoodMemoryRuntime,
  resolveGoodMemoryRuntimeInfo,
} from "./api/runtimeInfo";
