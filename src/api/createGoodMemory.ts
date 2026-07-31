import { renderEvidenceLedgerContext } from "../answer/evidenceLedgerContext";
import type {
  FeedbackKind,
  FeedbackMemory,
} from "../domain/records";
import {
  buildFeedbackIdentityKey,
  createFeedbackMemory,
  normalizeFeedbackAppliesTo,
} from "../domain/records";
import { createMemorySource } from "../domain/provenance";
import {
  normalizeScope,
  scopeToKey,
  type MemoryScope,
} from "../domain/scope";
import type { EmbeddingAdapter } from "../embedding/contracts";
import { EVIDENCE_COLLECTION } from "../evidence/contracts";
import type { BehavioralOutcomeObservationResult } from "../evolution/behavioralTelemetry";
import { createProceduralPatternCompiler } from "../evolution/compiler";
import type { LearningProposal } from "../evolution/contracts";
import { createProposalGateProcessor } from "../evolution/gates";
import { createRulesOnlyReviewer } from "../evolution/reviewer";
import {
  EXPERIENCES_COLLECTION,
  LEARNING_PROPOSALS_COLLECTION,
  PROMOTION_RECORDS_COLLECTION,
  SESSION_ARCHIVES_COLLECTION,
} from "../evolution/contracts";
import type { RetrievalStrategyRolloutConfig } from "../governance/retrievalInternalRollout";
import { createLanguageService } from "../language";
import type { LanguageService } from "../language";
import {
  createDreamMaintenanceGate,
  createDreamMaintenanceOrchestrator,
} from "../maintenance/dream";
import { createMaintenanceRunner } from "../maintenance/runner";
import type { GoodMemoryTraceLink } from "../observability/contracts";
import {
  createGoodMemoryTracer,
  type GoodMemoryTracer,
} from "../observability/tracer";
import type { RecallRouterAssistant } from "../recall/assistant";
import {
  rebuildMemoryPacket,
  renderMemoryPacket,
} from "../recall/contextBuilder";
import { createRecallEngine } from "../recall/engine";
import { selectEvidence } from "../recall/evidence";
import type { FactSelector } from "../recall/generalizedSelection";
import {
  iterativeRecall,
  type IterativeRecallStep,
} from "../recall/iterativeRecall";
import { createRecallProjectionRuntime } from "../recall/projections/runtime";
import { buildRecallProjectionBuildId } from "../recall/projections/manifest";
import {
  decomposedRecall,
  splitQueryIntoSubQueries,
} from "../recall/queryDecomposition";
import {
  buildDeterministicRecallPlan,
  buildUnplannedRecallPlan,
  resolveRecallPlan,
  type RecallPlan,
} from "../recall/recallPlan";
import type { Reranker } from "../recall/reranker";
import {
  copyRecallRerankPool,
  mergeRecallRerankPools,
} from "../recall/rerankPool";
import type {
  RecallExecutionStopReason,
  RecallQueryExecutionTrace,
  RecallRetrievalTrace,
} from "../recall/retrievalTrace";
import { createRememberEngine } from "../remember/engine";
import { createInMemoryDocumentStore, createInMemorySessionStore, createInMemoryVectorStore } from "../storage/memory";
import { createAutoStorageAdapters } from "../storage/auto";
import {
  createPostgresDocumentStore,
  createPostgresSessionStore,
  createPostgresVectorStore,
} from "../storage/postgresPublic";
import { createMemoryRepositories } from "../storage/repositories";
import type {
  GovernanceRepositoryPort,
  GovernanceVectorPort,
  RememberVectorPort,
} from "../storage/ports";
import {
  isProjectionCapableDocumentStore,
  type DocumentStore,
} from "../storage/contracts";
import type { ScopeDeletionCoordinator } from "../storage/scopeDeletion";
import {
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
  createSQLiteVectorStore,
} from "../storage/sqlitePublic";
import {
  createProviderConversationalMemoryExtractor,
  createProviderEmbeddingAdapter,
  createProviderListwiseReranker,
  createProviderMemoryExtractor,
  createProviderPointwiseReranker,
} from "../provider/layer";
import {
  attachGoodMemoryEvalSupport,
  type GoodMemoryEvalSupport,
} from "./evalSupport";
import {
  attachGoodMemoryIntegrationSupport,
  type AgentEventCorrectionResult,
  type AgentEventPromotionReceipt,
  type AgentEventProposalReceipt,
  type GoodMemoryIntegrationSupport,
} from "./integrationSupport";
import {
  attachGoodMemoryRuntimeInfo,
  buildGoodMemoryRuntimeInfo,
} from "./runtimeInfo";
import { createAgentEventIngestor } from "./agentEventIngestion";
import { createEvolutionRuntime } from "./evolutionRuntime";
import { deleteVectorForCollection } from "./governance";
import {
  deleteMemorySupportingState,
  deleteAllMemoryOperation,
  exportMemoryOperation,
  isPureUserScope,
  recordMatchesScope,
  type ScopeBoundRecord,
} from "./memoryAdminOps";
import { recordHostActionAssessment } from "./hostActionAssessmentOps";
import { createGoodMemoryJobsFacade } from "./jobs";
import {
  applyDurableRerankingToResult,
  buildSkippedRerankerTrace,
  getDurableRerankerCandidateCount,
  sanitizeRerankerGateway,
  type RerankerExecutionTarget,
  withRerankerTrace,
} from "./recallReranking";
import {
  readInternalRecallLanguageAnalysis,
  wrapInternalRetrievalRolloutMemory,
} from "./internalRetrievalRollout";
import { reviseMemory as reviseMemoryThroughService } from "./revision";
import { createGoodMemoryRuntimeFacade } from "./runtimeFacade";
import type {
  BuildContextInput,
  BuildContextResult,
  DeleteAllMemoryInput,
  DeleteAllMemoryResult,
  ExportMemoryInput,
  ExportMemoryResult,
  FeedbackInput,
  FeedbackResult,
  ForgetInput,
  ForgetResult,
  GoodMemory,
  GoodMemoryConfig,
  GoodMemoryJobsFacade,
  GoodMemoryRuntimeFacade,
  RecallInput,
  RecallResult,
  RememberInput,
  RememberResult,
  ReviseMemoryInput,
  ReviseMemoryResult,
  RunMaintenanceInput,
  RunMaintenanceResult,
} from "./contracts";
import {
  type GoodMemoryRuntimeResolution,
  resolveGoodMemoryRuntimeResolution,
  resolveAssistedExtractorModelConfigFromEnv,
} from "./runtimeResolution";
import type { EvidenceRecord } from "../evidence/contracts";
import type { ExperienceRecord } from "../evolution/contracts";

const FORGETTABLE_COLLECTIONS = [
  "facts",
  "feedback",
  "profiles",
  "preferences",
  "references",
  "episodes",
  SESSION_ARCHIVES_COLLECTION,
  EVIDENCE_COLLECTION,
  EXPERIENCES_COLLECTION,
  LEARNING_PROPOSALS_COLLECTION,
  PROMOTION_RECORDS_COLLECTION,
] as const;

export interface InternalGoodMemoryOptions {
  assistedRecallRouter?: RecallRouterAssistant;
  assistedReviewer?: boolean;
  behavioralOutcomeRecorder?: boolean;
  environment?: Record<string, string | undefined>;
  /** Repo-only instance selector override for historical evaluation profiles. */
  factSelector?: FactSelector;
  projectionBulkBackfill?: boolean;
  /** Repo-only hook for sealing derived projection state before immutable replay. */
  projectionPreparationSupport?: boolean;
  projectionWriteThrough?: boolean;
  providerRerankingStrategy?: "listwise" | "pointwise";
  retrievalStrategyRollout?: RetrievalStrategyRolloutConfig;
  runtimeCompactionExtraction?: boolean;
  /** Repo-only immutable SQLite view; also disables post-recall mutations. */
  sqliteReadOnly?: boolean;
}

const ASSISTED_REVIEWER_PREFIX = "[assisted reviewer] ";

function prefixAssistedReviewerText(value: string): string {
  return value.startsWith(ASSISTED_REVIEWER_PREFIX)
    ? value
    : `${ASSISTED_REVIEWER_PREFIX}${value}`;
}

function annotateAssistedReviewerProposal(
  proposal: LearningProposal,
  timestamp: string,
): LearningProposal {
  return {
    ...proposal,
    summary: prefixAssistedReviewerText(proposal.summary),
    rationale: prefixAssistedReviewerText(proposal.rationale),
    modelInfluence: "llm-assisted",
    updatedAt: timestamp,
  };
}

function buildRememberTraceLinks(events: RememberResult["events"]): GoodMemoryTraceLink[] {
  const links: GoodMemoryTraceLink[] = [];
  for (const event of events) {
    if (event.memoryId && event.memoryType !== "profile") {
      links.push({ type: "memory", id: event.memoryId });
    }
    for (const evidenceId of event.evidenceIds ?? []) {
      links.push({ type: "evidence", id: evidenceId });
    }
  }
  return links;
}

function unionRecordsById<T extends { id: string }>(
  results: readonly RecallResult[],
  select: (result: RecallResult) => readonly T[],
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const result of results) {
    for (const item of select(result)) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
  }
  return merged;
}

const RECALL_PASS_FUSION_RRF_K = 60;

function fuseFactsAcrossRecallPasses(
  results: readonly [RecallResult, ...RecallResult[]],
  preRankLimit: number,
  primaryReserveLimit: number,
): RecallResult["facts"] {
  const fused = new Map<string, {
    fact: RecallResult["facts"][number];
    firstSeen: number;
    score: number;
  }>();
  let firstSeen = 0;
  for (const result of results) {
    for (const [index, fact] of result.facts.entries()) {
      const existing = fused.get(fact.id);
      const score = 1 / (RECALL_PASS_FUSION_RRF_K + index + 1);
      if (existing) {
        existing.score += score;
      } else {
        fused.set(fact.id, { fact, firstSeen, score });
        firstSeen += 1;
      }
    }
  }
  const ranked = [...fused.values()]
    .sort(
      (left, right) =>
        right.score - left.score || left.firstSeen - right.firstSeen,
    )
    .map(({ fact }) => fact);
  if (ranked.length <= preRankLimit) {
    return ranked;
  }

  const requiredPrimaryIds = new Set(
    results[0].facts
      .slice(0, Math.min(primaryReserveLimit, preRankLimit))
      .map((fact) => fact.id),
  );
  const globalIds = ranked
    .filter((fact) => !requiredPrimaryIds.has(fact.id))
    .slice(0, preRankLimit - requiredPrimaryIds.size)
    .map((fact) => fact.id);
  const preRankIds = new Set([...requiredPrimaryIds, ...globalIds]);
  return [
    ...ranked.filter((fact) => preRankIds.has(fact.id)),
    ...ranked.filter((fact) => !preRankIds.has(fact.id)),
  ];
}

function unionMetadataList<T>(
  results: readonly RecallResult[],
  select: (metadata: RecallResult["metadata"]) => readonly T[],
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const result of results) {
    for (const item of select(result.metadata)) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }
  }
  return merged;
}

function mergeRetrievalTraces(
  results: readonly RecallResult[],
): RecallRetrievalTrace | undefined {
  const fusionRuns = results.flatMap(
    (result) => result.metadata.retrievalTrace?.fusionRuns ?? [],
  );
  const reranker = results.find(
    (result) => result.metadata.retrievalTrace?.reranker !== undefined,
  )?.metadata.retrievalTrace?.reranker;
  if (fusionRuns.length === 0 && !reranker) {
    return undefined;
  }
  return {
    ...(fusionRuns.length > 0 ? { fusionRuns } : {}),
    ...(reranker ? { reranker } : {}),
    schemaVersion: 1,
  };
}

interface RecallPassContext {
  hop: number;
  query: string;
  role: "primary" | "subquery";
  subQueryIndex?: number;
}

function annotateRecallPass(
  result: RecallResult,
  context: RecallPassContext,
): RecallResult {
  const retrievalTrace = result.metadata.retrievalTrace;
  if (!retrievalTrace?.fusionRuns) {
    return result;
  }
  const annotated: RecallResult = {
    ...result,
    metadata: {
      ...result.metadata,
      retrievalTrace: {
        ...retrievalTrace,
        fusionRuns: retrievalTrace.fusionRuns.map((run) => ({
          ...run,
          hop: context.hop,
          query: context.query,
          queryRole: context.role,
          ...(context.subQueryIndex !== undefined
            ? { subQueryIndex: context.subQueryIndex }
            : {}),
          candidates: run.candidates.map((candidate) => ({
            ...candidate,
            ...(!candidate.selected
              ? { eliminationReason: "not_selected" as const }
              : {}),
          })),
        })),
      },
    },
  };
  return copyRecallRerankPool(result, annotated);
}

function withRecallPlanTrace(input: {
  executions: RecallQueryExecutionTrace[];
  plan: RecallPlan;
  result: RecallResult;
  stopReason: RecallExecutionStopReason;
  subQueries: string[];
}): RecallResult {
  const previous = input.result.metadata.retrievalTrace;
  const retrievalTrace: RecallRetrievalTrace = {
    ...(previous?.fusionRuns ? { fusionRuns: previous.fusionRuns } : {}),
    ...(previous?.reranker ? { reranker: previous.reranker } : {}),
    plan: input.plan,
    queryExecutions: input.executions,
    schemaVersion: 2,
    stopReason: input.stopReason,
    subQueries: input.subQueries,
  };
  return {
    ...input.result,
    metadata: {
      ...input.result.metadata,
      retrievalTrace,
    },
  };
}

// Union the retrieved records across the primary recall and each sub-query
// recall (primary first, deduped by id), then re-render the packet over the
// union so the merged RecallResult stays internally consistent. Session-scoped
// singletons (profile, working memory, journal) come from the primary recall.
function mergeRecallResults(
  primary: RecallResult,
  supplementary: RecallResult[],
  plan: Pick<RecallPlan, "preRankLimit" | "selectedLimit">,
  language: LanguageService,
  policyMarker = "decomposed_recall",
): RecallResult {
  if (supplementary.length === 0) {
    return primary;
  }
  const results: [RecallResult, ...RecallResult[]] = [
    primary,
    ...supplementary,
  ];
  const facts = fuseFactsAcrossRecallPasses(
    results,
    plan.preRankLimit,
    plan.selectedLimit,
  );
  const preferences = unionRecordsById(results, (result) => result.preferences);
  const references = unionRecordsById(results, (result) => result.references);
  const feedback = unionRecordsById(results, (result) => result.feedback);
  const episodes = unionRecordsById(results, (result) => result.episodes);
  const archives = unionRecordsById(results, (result) => result.archives);
  const evidence = unionRecordsById(results, (result) => result.evidence);
  const includesEvidenceLedger = results.some(
    (result) => result.evidenceLedger !== undefined,
  );
  const evidenceLedger = includesEvidenceLedger
    ? [...new Map(
        results
          .flatMap((result) => result.evidenceLedger ?? [])
          .map((entry) => [JSON.stringify(entry), entry] as const),
      ).values()]
    : undefined;
  const packet = rebuildMemoryPacket(primary.packet, {
    profile: primary.profile,
    preferences,
    references,
    facts,
    feedback,
    archives,
    evidence: selectEvidence(evidence),
    episodes,
    workingMemory: primary.workingMemory,
    journal: primary.journal,
    language,
    locale: primary.metadata.locale,
    routingDecision: primary.metadata.routingDecision,
  });
  const retrievalTrace = mergeRetrievalTraces(results);
  const merged: RecallResult = {
    profile: primary.profile,
    preferences,
    references,
    facts,
    feedback,
    archives,
    evidence,
    ...(evidenceLedger ? { evidenceLedger } : {}),
    episodes,
    workingMemory: primary.workingMemory,
    journal: primary.journal,
    packet,
    metadata: {
      ...primary.metadata,
      tokenCount: packet.debug?.estimatedTokens ?? primary.metadata.tokenCount,
      hits: unionMetadataList(results, (metadata) => metadata.hits),
      candidateTraces: unionMetadataList(
        results,
        (metadata) => metadata.candidateTraces,
      ),
      verificationHints: unionMetadataList(
        results,
        (metadata) => metadata.verificationHints,
      ),
      policyApplied: [
        ...new Set([
          ...results.flatMap((result) => result.metadata.policyApplied),
          policyMarker,
        ]),
      ],
      ...(retrievalTrace ? { retrievalTrace } : {}),
    },
  };
  return mergeRecallRerankPools({
    preRankLimit: plan.preRankLimit,
    primaryReserveLimit: plan.selectedLimit,
    results,
    target: merged,
  });
}

function buildRecallTraceLinks(result: RecallResult): GoodMemoryTraceLink[] {
  const links: GoodMemoryTraceLink[] = [];
  for (const hit of result.metadata.hits) {
    links.push({ type: "memory", id: hit.id });
    for (const evidenceId of hit.evidenceIds ?? []) {
      links.push({ type: "evidence", id: evidenceId });
    }
  }
  return links;
}

function buildFeedbackTraceLinks(result: FeedbackResult): GoodMemoryTraceLink[] {
  const links: GoodMemoryTraceLink[] = [];
  if (result.memoryId) {
    links.push({ type: "memory", id: result.memoryId });
  }
  for (const evidenceId of result.evidenceIds ?? []) {
    links.push({ type: "evidence", id: evidenceId });
  }
  for (const receipt of result.proposalReceipts ?? []) {
    links.push({ type: "proposal", id: receipt.proposalId });
  }
  for (const receipt of result.promotionReceipts ?? []) {
    links.push({ type: "promotion", id: receipt.promotionId });
  }
  return links;
}

function buildRevisionTraceLinks(result: ReviseMemoryResult): GoodMemoryTraceLink[] {
  const links: GoodMemoryTraceLink[] = [];
  if (result.previousMemoryId) {
    links.push({ type: "memory", id: result.previousMemoryId });
  }
  if (result.newMemoryId) {
    links.push({ type: "memory", id: result.newMemoryId });
  }
  for (const evidenceId of result.evidenceIds ?? []) {
    links.push({ type: "evidence", id: evidenceId });
  }

  return links;
}

function resolveRevisionTraceReason(reason: ReviseMemoryInput["reason"]): string {
  if (
    reason === "user_correction" ||
    reason === "manual_review" ||
    reason === "system_repair"
  ) {
    return reason;
  }

  return "custom";
}

function withRecallTrace(
  result: RecallResult,
  trace: Awaited<ReturnType<GoodMemoryTracer["start"]>>,
): RecallResult {
  if (!trace.traceId) {
    return result;
  }

  return {
    ...result,
    metadata: {
      ...result.metadata,
      traceId: trace.traceId,
      traceScopeDigest: trace.scopeDigest,
    },
  };
}

function withRememberTrace(
  result: RememberResult,
  traceId: string | undefined,
): RememberResult {
  if (!traceId || !result.metadata) {
    return result;
  }

  return {
    ...result,
    metadata: {
      ...result.metadata,
      traceId,
    },
  };
}

function withFeedbackTrace(
  result: FeedbackResult,
  traceId: string | undefined,
): FeedbackResult {
  if (!traceId || !result.metadata) {
    return result;
  }

  return {
    ...result,
    metadata: {
      ...result.metadata,
      traceId,
    },
  };
}

async function resolveFeedbackSignalState(input: {
  appliesTo?: string;
  feedbackRepository: GovernanceRepositoryPort["feedback"];
  language: ReturnType<typeof createLanguageService>;
  locale?: string;
  scope: FeedbackInput["scope"];
  signal: string;
}): Promise<{
  duplicate?: FeedbackMemory;
  existing: FeedbackMemory[];
  kind: ReturnType<ReturnType<typeof createLanguageService>["deriveFeedbackKind"]>;
  normalizedRule: string;
  resolvedLanguage: ReturnType<ReturnType<typeof createLanguageService>["resolveFromText"]>;
  superseded?: FeedbackMemory;
}> {
  const {
    appliesTo,
    kind,
    normalizedRule,
    resolvedLanguage,
  } = resolveFeedbackSignalMetadata({
    appliesTo: input.appliesTo,
    language: input.language,
    locale: input.locale,
    signal: input.signal,
  });
  const existing = await input.feedbackRepository.listByScope(input.scope);
  const nextIdentityKey = buildFeedbackIdentityKey({
    kind,
    normalizedRule,
    appliesTo,
  });
  const duplicate = existing.find(
    (record) => {
      const recordLanguage = input.language.resolveFromText({
        locale: record.source.locale,
        text: record.rule,
      });
      return (
        record.lifecycle === "active" &&
        buildFeedbackIdentityKey({
          kind: record.kind,
          normalizedRule: input.language.normalizeForEquality(
            record.rule,
            recordLanguage,
          ),
          appliesTo: record.appliesTo,
        }) === nextIdentityKey
      );
    },
  );
  const superseded = existing.find(
    (record) =>
      record.lifecycle === "active" &&
      record.kind === kind &&
      normalizeFeedbackAppliesTo(record.appliesTo) === appliesTo,
  );

  return {
    duplicate,
    existing,
    kind,
    normalizedRule,
    resolvedLanguage,
    superseded,
  };
}

function resolveFeedbackSignalMetadata(input: {
  appliesTo?: string;
  language: ReturnType<typeof createLanguageService>;
  locale?: string;
  signal: string;
}): {
  appliesTo: string;
  kind: Exclude<FeedbackKind, "validated_pattern">;
  normalizedRule: string;
  resolvedLanguage: ReturnType<ReturnType<typeof createLanguageService>["resolveFromText"]>;
} {
  const resolvedLanguage = input.language.resolveFromText({
    locale: input.locale,
    text: input.signal,
  });
  const derivedKind = input.language.deriveFeedbackKind(input.signal, resolvedLanguage);
  const kind = derivedKind === "validated_pattern" ? "do" : derivedKind;
  const normalizedRule = input.language.normalizeForEquality(
    input.signal,
    resolvedLanguage,
  );

  return {
    appliesTo: normalizeFeedbackAppliesTo(input.appliesTo),
    kind,
    normalizedRule,
    resolvedLanguage,
  };
}

async function writeFeedbackSignal(input: {
  appliesTo?: string;
  evolutionRuntime: {
    handleFeedback(input: {
      result: FeedbackResult;
      scope: FeedbackInput["scope"];
      strict?: boolean;
      traceId?: string;
    }): Promise<{
      promotionReceipts: AgentEventPromotionReceipt[];
      proposalReceipts: AgentEventProposalReceipt[];
    }>;
  };
  feedbackRepository: GovernanceRepositoryPort["feedback"];
  language: ReturnType<typeof createLanguageService>;
  locale?: string;
  scope: FeedbackInput["scope"];
  signal: string;
  evidenceIds?: string[];
  strictExperience?: boolean;
  traceId?: string;
}): Promise<{
  receipts: {
    promotionReceipts: AgentEventPromotionReceipt[];
    proposalReceipts: AgentEventProposalReceipt[];
  };
  result: FeedbackResult;
}> {
  const {
    duplicate,
    kind,
    resolvedLanguage,
    superseded,
  } = await resolveFeedbackSignalState({
    feedbackRepository: input.feedbackRepository,
    language: input.language,
    locale: input.locale,
    scope: input.scope,
    signal: input.signal,
    appliesTo: input.appliesTo,
  });

  if (!duplicate) {
    const timestamp = new Date().toISOString();
    const nextRecord = createFeedbackMemory({
      id: crypto.randomUUID(),
      userId: input.scope.userId,
      tenantId: input.scope.tenantId,
      workspaceId: input.scope.workspaceId,
      agentId: input.scope.agentId,
      sessionId: input.scope.sessionId,
      rule: input.signal,
      kind,
      appliesTo: input.appliesTo ?? "general_response",
      source: createMemorySource({
        method: "explicit",
        extractedAt: timestamp,
        sessionId: input.scope.sessionId,
        locale: resolvedLanguage.locale,
        localeSource: resolvedLanguage.localeSource,
        languagePackId: resolvedLanguage.languagePackId,
        languagePackVersion: resolvedLanguage.languagePackVersion,
      }),
      updatedAt: timestamp,
    });

    if (superseded) {
      await input.feedbackRepository.upsert(
        createFeedbackMemory({
          ...superseded,
          lifecycle: "superseded",
          supersededBy: nextRecord.id,
          updatedAt: timestamp,
        }),
      );

      await input.feedbackRepository.upsert(nextRecord);
      const result: FeedbackResult = {
        accepted: true,
        ...(input.evidenceIds ? { evidenceIds: input.evidenceIds } : {}),
        outcome: "superseded",
        memoryId: nextRecord.id,
        kind,
        metadata: {
          locale: resolvedLanguage.locale,
          localeSource: resolvedLanguage.localeSource,
          languagePackId: resolvedLanguage.languagePackId,
          languagePackVersion: resolvedLanguage.languagePackVersion,
          analysisMode: resolvedLanguage.analysisMode,
        },
      };

      const receipts = await input.evolutionRuntime.handleFeedback({
        scope: input.scope,
        result,
        ...(input.traceId ? { traceId: input.traceId } : {}),
        ...(input.strictExperience ? { strict: true } : {}),
      });

      return {
        receipts,
        result,
      };
    }

    await input.feedbackRepository.upsert(nextRecord);
    const result: FeedbackResult = {
      accepted: true,
      ...(input.evidenceIds ? { evidenceIds: input.evidenceIds } : {}),
      outcome: "written",
      memoryId: nextRecord.id,
      kind,
      metadata: {
        locale: resolvedLanguage.locale,
        localeSource: resolvedLanguage.localeSource,
        languagePackId: resolvedLanguage.languagePackId,
        languagePackVersion: resolvedLanguage.languagePackVersion,
        analysisMode: resolvedLanguage.analysisMode,
      },
    };

    const receipts = await input.evolutionRuntime.handleFeedback({
      scope: input.scope,
      result,
      ...(input.traceId ? { traceId: input.traceId } : {}),
      ...(input.strictExperience ? { strict: true } : {}),
    });

    return {
      receipts,
      result,
    };
  }

  const result: FeedbackResult = {
    accepted: true,
    ...(input.evidenceIds ? { evidenceIds: input.evidenceIds } : {}),
    outcome: "merged",
    memoryId: duplicate.id,
    kind,
    metadata: {
      locale: resolvedLanguage.locale,
      localeSource: resolvedLanguage.localeSource,
      languagePackId: resolvedLanguage.languagePackId,
      languagePackVersion: resolvedLanguage.languagePackVersion,
      analysisMode: resolvedLanguage.analysisMode,
    },
  };

  const receipts = await input.evolutionRuntime.handleFeedback({
    scope: input.scope,
    result,
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.strictExperience ? { strict: true } : {}),
  });

  return {
    receipts,
    result,
  };
}

function withFeedbackReceipts(
  result: FeedbackResult,
  receipts: {
    promotionReceipts: AgentEventPromotionReceipt[];
    proposalReceipts: AgentEventProposalReceipt[];
  },
): FeedbackResult {
  return {
    ...result,
    ...(receipts.proposalReceipts.length > 0
      ? { proposalReceipts: receipts.proposalReceipts }
      : {}),
    ...(receipts.promotionReceipts.length > 0
      ? { promotionReceipts: receipts.promotionReceipts }
      : {}),
  };
}

function withAgentEventCorrectionReceipts(
  result: AgentEventCorrectionResult,
  receipts: {
    promotionReceipts: AgentEventPromotionReceipt[];
    proposalReceipts: AgentEventProposalReceipt[];
  },
): AgentEventCorrectionResult {
  return {
    ...result,
    ...(receipts.proposalReceipts.length > 0
      ? { proposalReceipts: receipts.proposalReceipts }
      : {}),
    ...(receipts.promotionReceipts.length > 0
      ? { promotionReceipts: receipts.promotionReceipts }
      : {}),
  };
}

class GoodMemoryImpl implements GoodMemory {
  readonly jobs: GoodMemoryJobsFacade;
  readonly runtime: GoodMemoryRuntimeFacade;

  private readonly documentStore;
  private readonly sessionStore;
  private readonly scopeDeletion?: ScopeDeletionCoordinator;
  private readonly terminalDeletionReady: boolean;
  private readonly governanceRepositories: GovernanceRepositoryPort;
  private readonly governanceVectors: GovernanceVectorPort | null;
  private readonly revisionVectorIndex: RememberVectorPort | null;
  private readonly runtimeResolution: GoodMemoryRuntimeResolution;
  private readonly recallEngine;
  private readonly recallObservationsEnabled: boolean;
  private readonly rememberEngine;
  private readonly projectionRuntime:
    | ReturnType<typeof createRecallProjectionRuntime>
    | undefined;
  private readonly evolutionRuntime: ReturnType<typeof createEvolutionRuntime>;
  private readonly embeddingAdapter?: EmbeddingAdapter;
  private readonly reranker?: Reranker;
  // R8: evidence-conditioned sufficiency decisions for multi-hop recall.
  private readonly followUpDecisionGenerator?: NonNullable<
    GoodMemoryConfig["adapters"]
  >["followUpDecisionGenerator"];
  private readonly rerankerTarget?: RerankerExecutionTarget;
  private readonly language;
  private readonly now: () => Date;
  private readonly tracer: GoodMemoryTracer;

  constructor(
    private readonly config: GoodMemoryConfig,
    internal?: InternalGoodMemoryOptions,
  ) {
    const resolvedRuntime = resolveGoodMemoryRuntimeResolution({
      config,
      env: internal?.environment,
    });
    const runtimeResolution =
      internal?.providerRerankingStrategy && resolvedRuntime.rerankerModelConfig
        ? {
            ...resolvedRuntime,
            providerRerankingStrategy: internal.providerRerankingStrategy,
          }
        : resolvedRuntime;
    this.runtimeResolution = runtimeResolution;
    const storagePlan = runtimeResolution.storagePlan;
    const explicitStorage = storagePlan.mode === "explicit" ? storagePlan.storage : null;
    this.recallObservationsEnabled = !(
      internal?.sqliteReadOnly &&
      explicitStorage?.provider === "sqlite"
    );
    const sqliteStoreOptions = internal?.sqliteReadOnly
      ? { readOnly: true }
      : undefined;
    const autoStorageAdapters =
      storagePlan.mode === "auto"
        ? createAutoStorageAdapters(
            "sqliteUrl" in storagePlan
              ? {
                  postgresUrl: storagePlan.postgresUrl,
                  sqliteUrl: storagePlan.sqliteUrl,
                }
              : {
                  fallbackProvider: "memory",
                  postgresUrl: storagePlan.postgresUrl,
                },
          )
        : null;
    const embeddingAdapter =
      config.adapters?.embeddingAdapter ??
      (runtimeResolution.embeddingModelConfig
        ? createProviderEmbeddingAdapter({
            model: runtimeResolution.embeddingModelConfig,
            ...(config.observability?.modelUsageSink
              ? { modelUsageSink: config.observability.modelUsageSink }
              : {}),
          })
        : undefined);
    const assistedExtractor =
      config.adapters?.assistedExtractor ??
      (runtimeResolution.assistedExtractorModelConfig
        ? // Resolved mode = the raw config predicate plus the recommended
          // preset's conversational flip; identical to the old inline check
          // for non-preset configs by construction.
          runtimeResolution.extractionMode === "conversational"
          ? createProviderConversationalMemoryExtractor({
              model: runtimeResolution.assistedExtractorModelConfig,
              contextualDescriptor:
                config.providers?.extraction?.contextualDescriptors,
              ...(config.observability?.modelUsageSink
                ? { modelUsageSink: config.observability.modelUsageSink }
                : {}),
            })
          : createProviderMemoryExtractor({
              model: runtimeResolution.assistedExtractorModelConfig,
              ...(config.observability?.modelUsageSink
                ? { modelUsageSink: config.observability.modelUsageSink }
                : {}),
            })
        : undefined);
    const reranker =
      config.adapters?.reranker ??
      (runtimeResolution.rerankerModelConfig
        ? runtimeResolution.providerRerankingStrategy === "listwise"
          ? createProviderListwiseReranker({
              model: runtimeResolution.rerankerModelConfig,
              requestTimeoutMs: config.providers?.reranking?.requestTimeoutMs,
              ...(config.observability?.modelUsageSink
                ? { modelUsageSink: config.observability.modelUsageSink }
                : {}),
            })
          : createProviderPointwiseReranker({
              model: runtimeResolution.rerankerModelConfig,
              requestTimeoutMs: config.providers?.reranking?.requestTimeoutMs,
              ...(config.observability?.modelUsageSink
                ? { modelUsageSink: config.observability.modelUsageSink }
                : {}),
            })
        : undefined);
    const rerankerTarget: RerankerExecutionTarget | undefined = reranker
      ? config.adapters?.reranker
        ? { adapter: "custom", strategy: "pointwise" }
        : {
            adapter: "provider",
            candidateLimit:
              runtimeResolution.retrieval.rerankGeneralizedFusion
                ?.maxTotalFacts,
            gateway: sanitizeRerankerGateway(
              runtimeResolution.rerankerModelConfig?.baseURL,
            ),
            model: runtimeResolution.rerankerModelConfig?.model,
            provider: runtimeResolution.rerankerModelConfig?.provider,
            strategy:
              runtimeResolution.providerRerankingStrategy ?? "pointwise",
          }
      : undefined;
    const rawDocumentStore =
      config.adapters?.documentStore ??
      (autoStorageAdapters
        ? autoStorageAdapters.documentStore
        : explicitStorage?.provider === "sqlite"
        ? createSQLiteDocumentStore(explicitStorage.url, sqliteStoreOptions)
        : explicitStorage?.provider === "postgres"
          ? createPostgresDocumentStore({
              url: explicitStorage.url,
            })
          : createInMemoryDocumentStore());
    if (
      runtimeResolution.retrieval.generalizedFusion !== undefined &&
      !isProjectionCapableDocumentStore(rawDocumentStore)
    ) {
      throw new Error(
        "Generalized fusion requires a projection-capable document store with atomic conditional batches.",
      );
    }
    const language = createLanguageService(config.language);
    const projectionBuildId = config.adapters?.documentStore === undefined
      ? buildRecallProjectionBuildId(language)
      : undefined;
    const projectionRuntime = isProjectionCapableDocumentStore(rawDocumentStore)
      ? createRecallProjectionRuntime({
          bulkBackfill: internal?.projectionBulkBackfill,
          documentStore: rawDocumentStore,
          language,
          now: config.testing?.now
            ? () => config.testing!.now!().toISOString()
            : undefined,
          ...(projectionBuildId
            ? { persistentScopeProof: { buildId: projectionBuildId } }
            : {}),
          writeThrough:
            runtimeResolution.retrieval.generalizedFusion !== undefined &&
            internal?.projectionWriteThrough !== false,
        })
      : undefined;
    this.projectionRuntime = projectionRuntime;
    this.scopeDeletion = projectionRuntime?.scopeDeletion;
    const documentStore = projectionRuntime?.documentStore ?? rawDocumentStore;
    const sessionStore =
      config.adapters?.sessionStore ??
      (autoStorageAdapters
        ? autoStorageAdapters.sessionStore
        : explicitStorage?.provider === "sqlite"
        ? createSQLiteSessionStore(explicitStorage.url, sqliteStoreOptions)
        : explicitStorage?.provider === "postgres"
          ? createPostgresSessionStore({
              url: explicitStorage.url,
            })
          : createInMemorySessionStore());
    const vectorStore =
      config.adapters?.vectorStore ??
      (autoStorageAdapters
        ? autoStorageAdapters.vectorStore
        : explicitStorage?.provider === "postgres"
        ? createPostgresVectorStore({
            url: explicitStorage.url,
          })
        : explicitStorage?.provider === "sqlite"
          ? createSQLiteVectorStore(explicitStorage.url, sqliteStoreOptions)
          : createInMemoryVectorStore());
    const customStorageAdapters = config.adapters?.documentStore !== undefined ||
      config.adapters?.sessionStore !== undefined ||
      config.adapters?.vectorStore !== undefined;
    const completeCustomStorageAdapters =
      config.adapters?.documentStore !== undefined &&
      config.adapters?.sessionStore !== undefined &&
      config.adapters?.vectorStore !== undefined;
    this.terminalDeletionReady = !customStorageAdapters ||
      (completeCustomStorageAdapters &&
        config.adapters?.terminalDeletionSemantics ===
          "shared-coordinated-backends-v1");
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore,
      vectorStore,
    });
    this.documentStore = documentStore;
    this.sessionStore = sessionStore;
    this.governanceRepositories = repositories;
    this.governanceVectors = repositories.vectorIndex;
    this.revisionVectorIndex = repositories.vectorIndex;
    this.embeddingAdapter = embeddingAdapter;
    this.reranker = reranker;
    this.followUpDecisionGenerator = config.adapters?.followUpDecisionGenerator;
    this.rerankerTarget = rerankerTarget;
    this.language = language;
    this.now = config.testing?.now ?? (() => new Date());
    this.tracer = createGoodMemoryTracer(config.observability, this.now);
    this.runtime = createGoodMemoryRuntimeFacade({
      documentStore,
      language,
      scopeDeletion: this.scopeDeletion,
      sessionStore,
      now: this.now,
      ...(internal?.runtimeCompactionExtraction
        ? {
            runtimeCompactionExtraction: {
              extractionStrategy: assistedExtractor
                ? "llm-assisted" as const
                : "rules-only" as const,
              remember: (input: RememberInput) =>
                this.rememberWithinScopeMutation(input),
            },
          }
        : {}),
      tracer: this.tracer,
    });
    this.recallEngine = createRecallEngine({
      assistedRouter: internal?.assistedRecallRouter,
      repositories,
      runtime: sessionStore,
      vectorIndex: repositories.vectorIndex,
      embedding: embeddingAdapter,
      factSelector: internal?.factSelector,
      autoStrategyBias: runtimeResolution.retrieval.autoStrategyBias,
      bm25Ranking: runtimeResolution.retrieval.bm25Ranking,
      generalizedFusion: runtimeResolution.retrieval.generalizedFusion,
      rerankGeneralizedFusion:
        runtimeResolution.retrieval.rerankGeneralizedFusion,
      projectionIndex: projectionRuntime,
      semanticCandidates: runtimeResolution.retrieval.semanticCandidates,
      now: config.testing?.now ? () => config.testing!.now!().getTime() : undefined,
      referenceTime: config.testing?.now
        ? () => config.testing!.now!().toISOString()
        : undefined,
      language,
      policy: config.policy,
      recallPlanner: config.adapters?.recallPlanner,
    });
    this.rememberEngine = createRememberEngine({
      repositories,
      vectorIndex: repositories.vectorIndex,
      assistedExtractor,
      claimProjection: projectionRuntime,
      documentStore,
      embedding: embeddingAdapter,
      extractor: config.testing?.extractor,
      language,
      remember: config.remember,
      policy: config.policy,
      createId: config.testing?.createId,
      now: config.testing?.now
        ? () => config.testing!.now!().toISOString()
        : undefined,
    });
    this.jobs = createGoodMemoryJobsFacade({
      now: this.now,
      tracer: this.tracer,
      remember: (input) => this.remember(input),
    });
    const reviewer = createRulesOnlyReviewer({
      repositories,
      ...(internal?.assistedReviewer
        ? {
            assistedReview: {
              enabled: true,
              annotate: async (proposal: LearningProposal) =>
                annotateAssistedReviewerProposal(
                  proposal,
                  this.now().toISOString(),
                ),
            },
          }
        : {}),
    });
    const proposalGate = createProposalGateProcessor({
      repositories,
    });
    const proceduralPatternCompiler = createProceduralPatternCompiler({
      repositories,
      language,
      now: () => this.now().toISOString(),
    });
    const maintenanceRunner = createMaintenanceRunner({
      repositories,
      vectorIndex: repositories.vectorIndex,
      embedding: embeddingAdapter,
      language,
      projectionRepair: projectionRuntime,
      projectionMigration: projectionRuntime,
      claimSlotSweep: projectionRuntime,
      observationSynthesis: config.adapters?.observationSynthesizer,
      retrievalCues: config.adapters?.retrievalCueGenerator,
      now: () => this.now().toISOString(),
    });
    const dreamMaintenanceGate = createDreamMaintenanceGate();
    const dreamMaintenance = createDreamMaintenanceOrchestrator({
      gate: dreamMaintenanceGate,
      maintenanceRunner,
      reviewer,
      proposalGate,
      compiler: proceduralPatternCompiler,
    });
    this.evolutionRuntime = createEvolutionRuntime({
      governanceRepositories: repositories,
      language,
      reviewer,
      proposalGate,
      compiler: proceduralPatternCompiler,
      dreamMaintenance,
      now: () => this.now().toISOString(),
    });
  }

  async recall(input: RecallInput): Promise<RecallResult> {
    const trace = await this.tracer.start({
      name: "memory.recall",
      scope: input.scope,
      attributes: {
        decomposeOverride: input.decompose ?? "plan",
        ignoreMemory: Boolean(input.ignoreMemory),
        multiHopOverride: input.multiHop ?? "plan",
        requestedRetrievalProfile: input.retrievalProfile ?? "default",
        requestedStrategy: input.strategy ?? "default",
      },
    });

    try {
      const internalLanguageAnalysis = readInternalRecallLanguageAnalysis(input);
      const activeLanguageAnalysis = internalLanguageAnalysis?.query === input.query
        ? internalLanguageAnalysis
        : undefined;
      const resolvedLanguage = activeLanguageAnalysis?.context ??
        this.language.resolveFromText({
          locale: input.locale,
          text: input.query,
        });
      const queryAnalysis = activeLanguageAnalysis?.analysis ??
        this.language.analyzeQuery(input.query, resolvedLanguage);
      const recallPlanExecution =
        this.config.retrieval?.recallPlanExecution === true;
      const recallReferenceTime =
        input.referenceTime !== undefined &&
          Number.isFinite(Date.parse(input.referenceTime))
          ? new Date(Date.parse(input.referenceTime)).toISOString()
          : this.now().toISOString();
      const recallPlanInput = {
        language: this.language,
        languageContext: resolvedLanguage,
        locale: resolvedLanguage.locale,
        query: input.query,
        queryAnalysis,
        referenceTime: recallReferenceTime,
        scope: input.scope,
      };
      const planResolution = recallPlanExecution
        ? await resolveRecallPlan({
            assistant: this.config.adapters?.recallPlanner,
            input: recallPlanInput,
          })
        : {
            assistantApplied: false,
            plan: buildUnplannedRecallPlan(),
          };
      if (planResolution.fallbackReason) {
        console.error(
          "[goodmemory:recall-plan] assisted planning failed; using deterministic plan",
          {
            locale: resolvedLanguage.locale,
            queryLength: input.query.length,
          },
        );
      }
      const recallPlan = planResolution.plan;
      const multiHopEnabled = input.multiHop === undefined
        ? recallPlanExecution && recallPlan.maxHops > 1
        : Boolean(input.multiHop);
      const decompositionFacets = input.decompose === true && !recallPlanExecution
        ? splitQueryIntoSubQueries(input.query, {
            analysis: queryAnalysis,
            language: this.language,
            languageContext: resolvedLanguage,
            locale: resolvedLanguage.locale,
          })
        : recallPlan.facets;
      const decompositionEnabled = input.decompose ??
        (recallPlanExecution && decompositionFacets.length > 0);
      const queryLanguages = new Map([
        [
          input.query,
          { analysis: queryAnalysis, context: resolvedLanguage },
        ],
      ]);
      const resolveQueryLanguage = (query: string) => {
        const cached = queryLanguages.get(query);
        if (cached) {
          return cached;
        }
        const analysis = this.language.analyzeQuery(query, resolvedLanguage);
        const resolved = { analysis, context: resolvedLanguage };
        queryLanguages.set(query, resolved);
        return resolved;
      };
      const runQuery = async (context: {
        query: string;
        role: "primary" | "subquery";
        subQueryIndex?: number;
      }): Promise<{
        execution: RecallQueryExecutionTrace;
        result: RecallResult;
      }> => {
        const plannedQueryLanguage = resolveQueryLanguage(context.query);
        const queryPlan = context.role === "primary" || !recallPlanExecution
          ? recallPlan
          : {
              ...buildDeterministicRecallPlan({
                language: this.language,
                languageContext: plannedQueryLanguage.context,
                locale: plannedQueryLanguage.context.locale,
                query: context.query,
                queryAnalysis: plannedQueryLanguage.analysis,
                referenceTime: recallReferenceTime,
                scope: input.scope,
              }),
              maxRenderedTokens: recallPlan.maxRenderedTokens,
              preRankLimit: recallPlan.preRankLimit,
              selectedLimit: recallPlan.selectedLimit,
            };
        const queryMaxHops = typeof input.multiHop === "number"
          ? input.multiHop
          : input.multiHop === undefined && queryPlan.maxHops > 1
            ? queryPlan.maxHops
            : undefined;
        const queryMultiHopEnabled = input.multiHop === undefined
          ? recallPlanExecution && queryPlan.maxHops > 1
          : Boolean(input.multiHop);
        let hop = 0;
        const singlePassRecall = async (query: string) => {
          hop += 1;
          const queryLanguage = resolveQueryLanguage(query);
          const result = await this.recallEngine.recall({
            ...input,
            languageContext: queryLanguage.context,
            locale: queryLanguage.context.locale,
            query,
            queryAnalysis: queryLanguage.analysis,
            recallPlan: queryPlan,
          });
          return annotateRecallPass(result, {
            hop,
            query,
            role: context.role,
            ...(context.subQueryIndex !== undefined
              ? { subQueryIndex: context.subQueryIndex }
              : {}),
          });
        };

        if (queryMultiHopEnabled) {
          // R8: an injected decision adapter replaces lexical bridging. It may
          // continue only after naming a concrete missing-slot query. Provider
          // failures remain distinguishable from a positive sufficiency stop.
          const followUpDecisionGenerator = this.followUpDecisionGenerator;
          const outcome = await iterativeRecall({
            query: context.query,
            recall: singlePassRecall,
            merge: (primary, supplementary) =>
              mergeRecallResults(
                primary,
                supplementary,
                queryPlan,
                this.language,
                "iterative_recall",
            ),
            options: {
              ...(followUpDecisionGenerator
                ? {
                    decideNextHop: async ({
                      evidence,
                      originalQuery,
                      hop,
                    }) => {
                      try {
                        return await followUpDecisionGenerator.generate({
                          evidence: evidence
                            .slice(0, 8)
                            .map((fact) => fact.content.slice(0, 300)),
                          hop,
                          query: originalQuery,
                        });
                      } catch (error) {
                        console.error(
                          "[goodmemory:iterative-recall] follow-up generation failed; keeping single pass",
                          error,
                        );
                        return null;
                      }
                    },
                  }
                : {}),
              analyzeBridgeText: (text) => {
                const bridgeLanguage = resolveQueryLanguage(text);
                return {
                  entities: this.language.extractEntityMentions(
                    text,
                    bridgeLanguage.context,
                  ).map((mention) => mention.surface),
                  tokens: this.language.tokenize(
                    text,
                    bridgeLanguage.context,
                    { excludeStopwords: true },
                  ),
                };
              },
              maxHops: queryMaxHops,
            },
          });
          return {
            execution: {
              hops: outcome.steps,
              plan: queryPlan,
              query: context.query,
              role: context.role,
              stopReason: outcome.stopReason,
              ...(context.subQueryIndex !== undefined
                ? { subQueryIndex: context.subQueryIndex }
                : {}),
            },
            result: outcome.result,
          };
        }

        const result = await singlePassRecall(context.query);
        const steps: IterativeRecallStep[] = [
          {
            bridgeEntities: [],
            factCount: result.facts.length,
            hop: 1,
            query: context.query,
          },
        ];
        return {
          execution: {
            hops: steps,
            plan: queryPlan,
            query: context.query,
            role: context.role,
            stopReason: "single_pass_complete",
            ...(context.subQueryIndex !== undefined
              ? { subQueryIndex: context.subQueryIndex }
              : {}),
          },
          result,
        };
      };

      let result: RecallResult;
      let subQueries: string[] = [];
      let executions: RecallQueryExecutionTrace[];
      if (decompositionEnabled) {
        const executionsByQuery = new Map<string, RecallQueryExecutionTrace>();
        const decomposed = await decomposedRecall({
          query: input.query,
          decompose: () => decompositionFacets,
          recall: async (query) => {
            const subQueryIndex = decompositionFacets.indexOf(query);
            const recalled = await runQuery({
              query,
              role: subQueryIndex >= 0 ? "subquery" : "primary",
              ...(subQueryIndex >= 0 ? { subQueryIndex } : {}),
            });
            executionsByQuery.set(query, recalled.execution);
            return recalled.result;
          },
          merge: (primary, supplementary) =>
            mergeRecallResults(
              primary,
              supplementary,
              recallPlan,
              this.language,
              "decomposed_recall",
            ),
          options: {
            language: this.language,
            locale: resolvedLanguage.locale,
          },
        });
        result = decomposed.result;
        subQueries = decomposed.subQueries;
        executions = [input.query, ...subQueries].map(
          (query) => executionsByQuery.get(query)!,
        );
      } else {
        const recalled = await runQuery({ query: input.query, role: "primary" });
        result = recalled.result;
        executions = [recalled.execution];
      }
      if (this.reranker && this.rerankerTarget) {
        result = input.rerank === false
          ? withRerankerTrace(
              result,
              buildSkippedRerankerTrace({
                candidateCount: getDurableRerankerCandidateCount(result),
                reason: "disabled",
                target: this.rerankerTarget,
              }),
            )
          : await applyDurableRerankingToResult({
              preRankLimit: recallPlan.preRankLimit,
              query: input.query,
              language: this.language,
              reranker: this.reranker,
              result,
              selectedLimit: recallPlan.selectedLimit,
              target: this.rerankerTarget,
            });
      }
      result = withRecallPlanTrace({
        executions,
        plan: recallPlan,
        result,
        stopReason:
          subQueries.length > 0
            ? "decomposition_complete"
            : multiHopEnabled
              ? "multi_hop_complete"
              : "single_pass_complete",
        subQueries,
      });
      result = {
        ...result,
        metadata: {
          ...result.metadata,
          analysisMode: resolvedLanguage.analysisMode,
          languagePackId: resolvedLanguage.languagePackId,
          languagePackVersion: resolvedLanguage.languagePackVersion,
          locale: resolvedLanguage.locale,
          localeSource: resolvedLanguage.localeSource,
        },
      };
      if (planResolution.assistantApplied || planResolution.fallbackReason) {
        result = {
          ...result,
          metadata: {
            ...result.metadata,
            policyApplied: [
              ...new Set([
                ...result.metadata.policyApplied,
                planResolution.assistantApplied
                  ? "recall_plan_assistant_applied"
                  : "recall_plan_assistant_fallback",
              ]),
            ],
          },
        };
      }
      if (this.recallObservationsEnabled) {
        await this.evolutionRuntime.handleRecall({
          scope: input.scope,
          result,
        });
      }
      const traced = withRecallTrace(result, trace);
      await trace.succeeded({
        attributes: {
          decompositionEnabled,
          hitCount: result.metadata.hits.length,
          multiHopEnabled,
          plannedMaxHops: recallPlan.maxHops,
          policyAppliedCount: result.metadata.policyApplied.length,
          tokenCount: result.metadata.tokenCount,
          verificationHintCount: result.metadata.verificationHints.length,
        },
        links: buildRecallTraceLinks(result),
      });

      return traced;
    } catch (error) {
      await trace.failed({ error });
      throw error;
    }
  }

  async diagnoseRecall(input: RecallInput): Promise<RecallResult> {
    return this.recallEngine.recall(input);
  }

  async buildContext(input: BuildContextInput): Promise<BuildContextResult> {
    const output = input.output ?? "json";
    const trace = await this.tracer.start({
      name: "memory.build_context",
      scopeDigest: input.recall.metadata.traceScopeDigest,
      attributes: {
        maxTokens: input.maxTokens ?? 0,
        output,
        retrievalProfile: input.recall.metadata.routingDecision.retrievalProfile,
      },
    });

    try {
      const packet = input.evidenceLedgerFormat && input.recall.evidenceLedger
        ? {
            ...input.recall.packet,
            evidenceSummary: renderEvidenceLedgerContext(
              input.recall.evidenceLedger,
              input.evidenceLedgerFormat,
              input.recall.metadata.locale,
              this.language,
            ),
          }
        : input.recall.packet;
      const rendered = renderMemoryPacket(
        packet,
        output,
        input.maxTokens,
        input.recall.metadata.routingDecision.retrievalProfile,
        { suppressDuplicateEvidence: input.suppressDuplicateEvidence === true },
      );
      await trace.succeeded({
        attributes: {
          estimatedTokens: rendered.estimatedTokens,
          omittedSectionCount: rendered.omittedSections.length,
        },
      });

      return {
        output,
        content: rendered.content,
        estimatedTokens: rendered.estimatedTokens,
        omittedSections: rendered.omittedSections,
        ...(trace.traceId ? { traceId: trace.traceId } : {}),
      };
    } catch (error) {
      await trace.failed({ error });
      throw error;
    }
  }

  async remember(input: RememberInput): Promise<RememberResult> {
    return this.runScopeMutation(input.scope, () =>
      this.rememberWithinScopeMutation(input)
    );
  }

  private async rememberWithinScopeMutation(
    input: RememberInput,
  ): Promise<RememberResult> {
    const trace = await this.tracer.start({
      name: "memory.remember",
      scope: input.scope,
      attributes: {
        annotationCount: input.annotations?.length ?? 0,
        extractionStrategy: input.extractionStrategy ?? "auto",
        messageCount: input.messages.length,
      },
    });

    try {
      const result = await this.rememberEngine.remember(input);
      const traced = withRememberTrace(result, trace.traceId);
      if (result.outcome === "failed") {
        await trace.failed({
          error: new Error("Memory extraction remains retryable."),
          attributes: {
            accepted: result.accepted,
            eventCount: result.events.length,
            rejected: result.rejected,
          },
          links: buildRememberTraceLinks(result.events),
        });
        return traced;
      }
      await this.evolutionRuntime.handleRemember({
        scope: input.scope,
        result,
      });
      await trace.succeeded({
        attributes: {
          accepted: result.accepted,
          eventCount: result.events.length,
          rejected: result.rejected,
        },
        links: buildRememberTraceLinks(result.events),
      });

      return traced;
    } catch (error) {
      await trace.failed({ error });
      throw error;
    }
  }

  async reviseMemory(input: ReviseMemoryInput): Promise<ReviseMemoryResult> {
    return this.runScopeMutation(input.scope, () =>
      this.reviseMemoryWithinScopeMutation(input)
    );
  }

  private async reviseMemoryWithinScopeMutation(
    input: ReviseMemoryInput,
  ): Promise<ReviseMemoryResult> {
    const trace = await this.tracer.start({
      name: "memory.revise",
      scope: input.scope,
      attributes: {
        hasEvidence: Boolean(input.evidence),
        reason: resolveRevisionTraceReason(input.reason),
        target: "memory_id",
      },
    });

    try {
      const result = await reviseMemoryThroughService({
        config: {
          documentStore: this.documentStore,
          embedding: this.embeddingAdapter,
          language: this.language,
          now: this.now,
          policy: this.config.policy,
          vectorIndex: this.revisionVectorIndex,
        },
        input,
      });
      const traced: ReviseMemoryResult = {
        ...result,
        ...(trace.traceId ? { traceId: trace.traceId } : {}),
      };
      const completion = {
        attributes: {
          accepted: result.accepted,
          memoryType: result.memoryType ?? "unknown",
          outcome: result.outcome,
          policyAppliedCount: result.policyApplied.length,
          warningCount: result.warnings?.length ?? 0,
        },
        links: buildRevisionTraceLinks(result),
      };

      if (result.outcome === "blocked") {
        await trace.blocked(completion);
      } else {
        await trace.succeeded(completion);
      }

      return traced;
    } catch (error) {
      await trace.failed({ error });
      throw error;
    }
  }

  async forget(input: ForgetInput): Promise<ForgetResult> {
    return this.runScopeMutation(input.scope, () =>
      this.forgetWithinScopeMutation(input)
    );
  }

  private async forgetWithinScopeMutation(
    input: ForgetInput,
  ): Promise<ForgetResult> {
    const trace = await this.tracer.start({
      name: "memory.forget",
      scope: input.scope,
      attributes: {
        hasMemoryId: Boolean(input.memoryId),
      },
    });

    try {
      if (!input.memoryId) {
        await trace.succeeded({
          attributes: {
            forgotten: false,
          },
        });
        return {
          forgotten: false,
          ...(trace.traceId ? { traceId: trace.traceId } : {}),
        };
      }

      for (const collection of FORGETTABLE_COLLECTIONS) {
        const existing = await this.documentStore.get(collection, input.memoryId);

        if (existing && recordMatchesScope(existing as ScopeBoundRecord, input.scope)) {
          await deleteVectorForCollection(
            this.governanceVectors,
            collection,
            input.memoryId,
          );
          await deleteMemorySupportingState(
            { documentStore: this.documentStore },
            {
              collection,
              memoryId: input.memoryId,
              scope: input.scope,
            },
          );
          await this.documentStore.delete(collection, input.memoryId);
          await trace.succeeded({
            attributes: {
              collection,
              forgotten: true,
            },
            links: [{ type: "memory", id: input.memoryId }],
          });
          return {
            forgotten: true,
            ...(trace.traceId ? { traceId: trace.traceId } : {}),
          };
        }
      }

      await trace.succeeded({
        attributes: {
          forgotten: false,
        },
      });
      return {
        forgotten: false,
        ...(trace.traceId ? { traceId: trace.traceId } : {}),
      };
    } catch (error) {
      await trace.failed({ error });
      throw error;
    }
  }

  async exportMemory(input: ExportMemoryInput): Promise<ExportMemoryResult> {
    return exportMemoryOperation(
      {
        tracer: this.tracer,
        governanceRepositories: this.governanceRepositories,
        governanceVectors: this.governanceVectors,
        language: this.language,
        sessionStore: this.sessionStore,
        documentStore: this.documentStore,
      },
      input,
    );
  }

  async deleteAllMemory(input: DeleteAllMemoryInput): Promise<DeleteAllMemoryResult> {
    if (!this.scopeDeletion) {
      throw new Error(
        "deleteAllMemory requires a projection-capable document store with atomic conditional batches.",
      );
    }
    if (!this.terminalDeletionReady) {
      throw new Error(
        "deleteAllMemory requires custom storage adapters to provide documentStore, sessionStore, and vectorStore on shared coordinated backends and declare shared-coordinated-backends-v1 terminal deletion semantics.",
      );
    }
    const operation = () => deleteAllMemoryOperation(
      {
        tracer: this.tracer,
        governanceRepositories: this.governanceRepositories,
        governanceVectors: this.governanceVectors,
        sessionStore: this.sessionStore,
        documentStore: this.documentStore,
      },
      input,
    );
    return this.scopeDeletion.runExclusive(
      input.scope,
      operation,
      {
        operationKey: JSON.stringify({
          contract: "delete-all-memory-v1",
          includeRuntime: input.includeRuntime !== false,
          scope: scopeToKey(normalizeScope(input.scope)),
        }),
        ...(input.resumeInterrupted
          ? { resumeInterrupted: input.resumeInterrupted }
          : {}),
      },
    );
  }

  async feedback(input: FeedbackInput): Promise<FeedbackResult> {
    return this.runScopeMutation(input.scope, () =>
      this.feedbackWithinScopeMutation(input)
    );
  }

  private async feedbackWithinScopeMutation(
    input: FeedbackInput,
  ): Promise<FeedbackResult> {
    const trace = await this.tracer.start({
      name: "memory.feedback",
      scope: input.scope,
      attributes: {
        signalLength: input.signal.length,
      },
    });

    try {
      const { receipts, result } = await writeFeedbackSignal({
        evolutionRuntime: this.evolutionRuntime,
        feedbackRepository: this.governanceRepositories.feedback,
        language: this.language,
        locale: input.locale,
        scope: input.scope,
        signal: input.signal,
      });
      const withReceipts = withFeedbackReceipts(result, receipts);
      const traced = withFeedbackTrace(withReceipts, trace.traceId);
      await trace.succeeded({
        attributes: {
          accepted: withReceipts.accepted,
          kind: withReceipts.kind ?? "unknown",
          outcome: withReceipts.outcome ?? "none",
          proposalReceiptCount: withReceipts.proposalReceipts?.length ?? 0,
        },
        links: buildFeedbackTraceLinks(withReceipts),
      });

      return traced;
    } catch (error) {
      await trace.failed({ error });
      throw error;
    }
  }

  async runMaintenance(input: RunMaintenanceInput): Promise<RunMaintenanceResult> {
    return this.runScopeMutation(input.scope, () =>
      this.runMaintenanceWithinScopeMutation(input)
    );
  }

  private async runMaintenanceWithinScopeMutation(
    input: RunMaintenanceInput,
  ): Promise<RunMaintenanceResult> {
    const trace = await this.tracer.start({
      name: "maintenance.run",
      scope: input.scope,
      attributes: {
        jobCount: input.jobs?.length ?? 0,
      },
    });

    try {
      const result = await this.evolutionRuntime.runMaintenance(input);
      await trace.succeeded({
        attributes: {
          compiledCount: result.compiledCount,
          proposalCount: result.proposalCount,
          ran: result.ran,
          reason: result.reason,
        },
      });

      return {
        ...result,
        ...(trace.traceId ? { traceId: trace.traceId } : {}),
      };
    } catch (error) {
      await trace.failed({ error });
      throw error;
    }
  }

  private runScopeMutation<T>(
    scope: MemoryScope,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.scopeDeletion
      ? this.scopeDeletion.runMutation(scope, operation)
      : operation();
  }
}

async function submitAgentEventCorrection(input: {
  appliesTo?: string;
  evolutionRuntime: {
    handleAgentCorrection(input: {
      appliesTo: string;
      evidenceIds?: string[];
      kind: Exclude<FeedbackKind, "validated_pattern">;
      scope: FeedbackInput["scope"];
      signal: string;
      strict?: boolean;
      traceId?: string;
    }): Promise<{
      promotionReceipts: AgentEventPromotionReceipt[];
      proposalReceipts: AgentEventProposalReceipt[];
    }>;
  };
  language: ReturnType<typeof createLanguageService>;
  locale?: string;
  scope: FeedbackInput["scope"];
  signal: string;
  evidenceIds?: string[];
  strictExperience?: boolean;
  traceId?: string;
}): Promise<AgentEventCorrectionResult> {
  const {
    appliesTo,
    kind,
    resolvedLanguage,
  } = resolveFeedbackSignalMetadata({
    appliesTo: input.appliesTo,
    language: input.language,
    locale: input.locale,
    signal: input.signal,
  });
  const receipts = await input.evolutionRuntime.handleAgentCorrection({
    appliesTo,
    kind,
    scope: input.scope,
    signal: input.signal,
    ...(input.evidenceIds ? { evidenceIds: input.evidenceIds } : {}),
    ...(input.strictExperience ? { strict: true } : {}),
    ...(input.traceId ? { traceId: input.traceId } : {}),
  });
  const result: AgentEventCorrectionResult = {
    accepted: true,
    ...(input.evidenceIds ? { evidenceIds: input.evidenceIds } : {}),
    kind,
    metadata: {
      locale: resolvedLanguage.locale,
      localeSource: resolvedLanguage.localeSource,
      languagePackId: resolvedLanguage.languagePackId,
      languagePackVersion: resolvedLanguage.languagePackVersion,
      analysisMode: resolvedLanguage.analysisMode,
    },
  };

  return withAgentEventCorrectionReceipts(result, receipts);
}

export function createGoodMemory(config: GoodMemoryConfig): GoodMemory {
  return createInternalGoodMemory(config);
}

export function createInternalGoodMemory(
  config: GoodMemoryConfig,
  internal?: InternalGoodMemoryOptions,
): GoodMemory {
  const impl = new GoodMemoryImpl(config, internal);
  const memory = wrapInternalRetrievalRolloutMemory(
    impl,
    {
      assistedRecallRouterEnabled: Boolean(internal?.assistedRecallRouter),
      languageService: (impl as unknown as { language: LanguageService }).language,
      now: config.testing?.now,
      rollout: internal?.retrievalStrategyRollout,
    },
  );
  const implWithInternals = impl as unknown as {
    documentStore: DocumentStore;
    evolutionRuntime: {
      handleAgentEvent: (input: {
        evidence?: EvidenceRecord;
        experience?: ExperienceRecord;
        scope: ForgetInput["scope"];
      }) => Promise<void>;
      handleBehavioralOutcome: (input: {
        result: BehavioralOutcomeObservationResult;
        scope: ForgetInput["scope"];
      }) => Promise<void>;
      handleAgentCorrection: (input: {
        appliesTo: string;
        evidenceIds?: string[];
        kind: Exclude<FeedbackKind, "validated_pattern">;
        scope: FeedbackInput["scope"];
        signal: string;
        strict?: boolean;
        traceId?: string;
      }) => Promise<{
        promotionReceipts: AgentEventPromotionReceipt[];
        proposalReceipts: AgentEventProposalReceipt[];
      }>;
      handleFeedback: (input: {
        result: FeedbackResult;
        scope: FeedbackInput["scope"];
        strict?: boolean;
        traceId?: string;
      }) => Promise<{
        promotionReceipts: AgentEventPromotionReceipt[];
        proposalReceipts: AgentEventProposalReceipt[];
      }>;
    };
    governanceRepositories: GovernanceRepositoryPort;
    feedback: GoodMemory["feedback"];
    language: ReturnType<typeof createLanguageService>;
    now: () => Date;
    projectionRuntime?: ReturnType<typeof createRecallProjectionRuntime>;
    runtimeResolution: GoodMemoryRuntimeResolution;
  };
  type BehavioralOutcomeSupportInput = Parameters<
    Exclude<GoodMemoryEvalSupport["recordBehavioralOutcome"], undefined>
  >[0];
  const integrationSupport: GoodMemoryIntegrationSupport = {
    language: implWithInternals.language,
    ingestAgentInputEvent: ({ event }) =>
      createAgentEventIngestor({
        documentStore: implWithInternals.documentStore,
        submitCorrection: (input) =>
          submitAgentEventCorrection({
            evolutionRuntime: implWithInternals.evolutionRuntime,
            language: implWithInternals.language,
            appliesTo: input.appliesTo,
            locale: input.locale,
            scope: input.scope,
            signal: input.signal,
            ...(input.evidenceIds ? { evidenceIds: input.evidenceIds } : {}),
            strictExperience: true,
            ...(input.traceId ? { traceId: input.traceId } : {}),
          }),
        language: implWithInternals.language,
        now: implWithInternals.now,
        policy: config.policy,
        persist: ({ evidence, experience, scope }) =>
          implWithInternals.evolutionRuntime.handleAgentEvent({
            scope,
            ...(evidence ? { evidence } : {}),
            ...(experience ? { experience } : {}),
          }),
      }).ingest(event),
    ingestHostAgentEvent: ({ event }) =>
      createAgentEventIngestor({
        documentStore: implWithInternals.documentStore,
        submitCorrection: (input) =>
          submitAgentEventCorrection({
            evolutionRuntime: implWithInternals.evolutionRuntime,
            language: implWithInternals.language,
            appliesTo: input.appliesTo,
            locale: input.locale,
            scope: input.scope,
            signal: input.signal,
            ...(input.evidenceIds ? { evidenceIds: input.evidenceIds } : {}),
            strictExperience: true,
            ...(input.traceId ? { traceId: input.traceId } : {}),
          }),
        language: implWithInternals.language,
        now: implWithInternals.now,
        policy: config.policy,
        persist: ({ evidence, experience, scope }) =>
          implWithInternals.evolutionRuntime.handleAgentEvent({
            scope,
            ...(evidence ? { evidence } : {}),
            ...(experience ? { experience } : {}),
          }),
      }).ingest(event),
    recordHostActionAssessment: ({ assessment }) =>
      recordHostActionAssessment({
        assessment,
        documentStore: implWithInternals.documentStore,
        persist: ({ experience, scope }) =>
          implWithInternals.evolutionRuntime.handleAgentEvent({
            scope,
            experience,
          }),
      }),
  };
  const support = {
    ...(internal?.assistedRecallRouter ? { assistedRecallRouter: true } : {}),
    ...(internal?.assistedReviewer ? { assistedReviewer: true } : {}),
    ...(internal?.projectionPreparationSupport
      ? {
          prepareProjectionScope: async (scope: MemoryScope) => {
            const result = await implWithInternals.projectionRuntime
              ?.ensureScopeIndexed(scope);
            if (result?.complete !== true) {
              throw new Error(
                "GoodMemory projection preparation did not complete.",
              );
            }
          },
        }
      : {}),
    ...(internal?.behavioralOutcomeRecorder
      ? {
          recordBehavioralOutcome: (input: BehavioralOutcomeSupportInput) =>
            implWithInternals.evolutionRuntime.handleBehavioralOutcome({
              scope: input.scope,
              result: {
                cue: input.cue,
                evidenceExcerpt: input.evidenceExcerpt,
                failureClass: input.failureClass,
                firstAction: input.firstAction,
                modelInfluence: input.modelInfluence ?? "rules-only",
                outcome: input.outcome,
                retrievalProfile: input.retrievalProfile,
                saferAlternative: input.saferAlternative,
              },
            }),
        }
      : {}),
  };
  const runtimeInfo = buildGoodMemoryRuntimeInfo(implWithInternals.runtimeResolution);
  const runtimeAwareMemory = attachGoodMemoryRuntimeInfo(memory, runtimeInfo);

  if (Object.keys(support).length === 0) {
    return attachGoodMemoryIntegrationSupport(runtimeAwareMemory, integrationSupport);
  }

  return attachGoodMemoryEvalSupport(
    attachGoodMemoryIntegrationSupport(runtimeAwareMemory, integrationSupport),
    support,
  );
}
