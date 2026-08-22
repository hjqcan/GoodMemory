import type { LearningProposal } from "../evolution/contracts";
import { createProceduralPatternCompiler } from "../evolution/compiler";
import { createProposalGateProcessor } from "../evolution/gates";
import { createRulesOnlyReviewer } from "../evolution/reviewer";
import type { EmbeddingAdapter } from "../embedding/contracts";
import { createLanguageService } from "../language";
import type { LanguageService } from "../language";
import {
  createDreamMaintenanceGate,
  createDreamMaintenanceOrchestrator,
} from "../maintenance/dream";
import { createMaintenanceRunner } from "../maintenance/runner";
import { createGoodMemoryTracer } from "../observability/tracer";
import type { GoodMemoryTracer } from "../observability/tracer";
import {
  createProviderConversationalMemoryExtractor,
  createProviderEmbeddingAdapter,
  createProviderListwiseReranker,
  createProviderMemoryExtractor,
  createProviderPointwiseReranker,
} from "../provider/layer";
import { createRecallEngine } from "../recall/engine";
import { buildRecallProjectionBuildId } from "../recall/projections/manifest";
import { createRecallProjectionRuntime } from "../recall/projections/runtime";
import type { Reranker } from "../recall/reranker";
import { createRememberEngine } from "../remember/engine";
import { createAutoStorageAdapters } from "../storage/auto";
import {
  isProjectionCapableDocumentStore,
} from "../storage/contracts";
import type { DocumentStore, SessionStore } from "../storage/contracts";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../storage/memory";
import {
  createPostgresDocumentStore,
  createPostgresSessionStore,
  createPostgresVectorStore,
} from "../storage/postgresPublic";
import type {
  GovernanceRepositoryPort,
  GovernanceVectorPort,
  RememberVectorPort,
} from "../storage/ports";
import { createMemoryRepositories } from "../storage/repositories";
import type { ScopeDeletionCoordinator } from "../storage/scopeDeletion";
import {
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
  createSQLiteVectorStore,
} from "../storage/sqlitePublic";
import { createEvolutionRuntime } from "./evolutionRuntime";
import { createGoodMemoryJobsFacade } from "./jobs";
import {
  sanitizeRerankerGateway,
} from "./recallReranking";
import type { RerankerExecutionTarget } from "./recallReranking";
import { createGoodMemoryRuntimeFacade } from "./runtimeFacade";
import {
  resolveGoodMemoryRuntimeResolution,
} from "./runtimeResolution";
import type { GoodMemoryRuntimeResolution } from "./runtimeResolution";
import type {
  GoodMemoryConfig,
  GoodMemoryJobsFacade,
  GoodMemoryRuntimeFacade,
  RememberInput,
  RememberResult,
} from "./contracts";
import type { InternalGoodMemoryOptions } from "./internalSupport";

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

export interface GoodMemoryAssemblyCallbacks {
  remember(input: RememberInput): Promise<RememberResult>;
  rememberWithinScopeMutation(input: RememberInput): Promise<RememberResult>;
}

export interface GoodMemoryAssembly {
  distinctRecallPassHeadProtection: boolean;
  documentStore: DocumentStore;
  embeddingAdapter?: EmbeddingAdapter;
  evolutionRuntime: ReturnType<typeof createEvolutionRuntime>;
  followUpDecisionGenerator?: NonNullable<
    GoodMemoryConfig["adapters"]
  >["followUpDecisionGenerator"];
  governanceRepositories: GovernanceRepositoryPort;
  governanceVectors: GovernanceVectorPort | null;
  jobs: GoodMemoryJobsFacade;
  language: LanguageService;
  now: () => Date;
  projectionRuntime?: ReturnType<typeof createRecallProjectionRuntime>;
  recallEngine: ReturnType<typeof createRecallEngine>;
  recallObservationsEnabled: boolean;
  rememberEngine: ReturnType<typeof createRememberEngine>;
  reranker?: Reranker;
  rerankerTarget?: RerankerExecutionTarget;
  revisionVectorIndex: RememberVectorPort | null;
  runtime: GoodMemoryRuntimeFacade;
  runtimeResolution: GoodMemoryRuntimeResolution;
  scopeDeletion?: ScopeDeletionCoordinator;
  sessionStore: SessionStore;
  terminalDeletionReady: boolean;
  tracer: GoodMemoryTracer;
}

export function createGoodMemoryAssembly(input: {
  callbacks: GoodMemoryAssemblyCallbacks;
  config: GoodMemoryConfig;
  internal?: InternalGoodMemoryOptions;
}): GoodMemoryAssembly {
  const { callbacks, config, internal } = input;
  const distinctRecallPassHeadProtection =
    internal?.distinctRecallPassHeadProtection === true;
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
  const storagePlan = runtimeResolution.storagePlan;
  const explicitStorage = storagePlan.mode === "explicit" ? storagePlan.storage : null;
  const recallObservationsEnabled =
    internal?.postRecallMutations !== false &&
    !(
      internal?.sqliteReadOnly &&
      explicitStorage?.provider === "sqlite"
    );
  const sqliteStoreOptions = internal?.sqliteReadOnly
    ? { readOnly: true }
    : undefined;
  const autoStorageAdapters = storagePlan.mode === "auto"
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
  const embeddingAdapter = config.adapters?.embeddingAdapter ??
    (runtimeResolution.embeddingModelConfig
      ? createProviderEmbeddingAdapter({
          model: runtimeResolution.embeddingModelConfig,
          ...(config.observability?.modelUsageSink
            ? { modelUsageSink: config.observability.modelUsageSink }
            : {}),
        })
      : undefined);
  const assistedExtractor = config.adapters?.assistedExtractor ??
    (runtimeResolution.assistedExtractorModelConfig
      ? runtimeResolution.extractionMode === "conversational"
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
  const reranker = config.adapters?.reranker ??
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
            runtimeResolution.retrieval.rerankGeneralizedFusion?.maxTotalFacts,
          gateway: sanitizeRerankerGateway(
            runtimeResolution.rerankerModelConfig?.baseURL,
          ),
          model: runtimeResolution.rerankerModelConfig?.model,
          provider: runtimeResolution.rerankerModelConfig?.provider,
          strategy: runtimeResolution.providerRerankingStrategy ?? "pointwise",
        }
    : undefined;
  const rawDocumentStore = config.adapters?.documentStore ??
    (autoStorageAdapters
      ? autoStorageAdapters.documentStore
      : explicitStorage?.provider === "sqlite"
        ? createSQLiteDocumentStore(explicitStorage.url, sqliteStoreOptions)
        : explicitStorage?.provider === "postgres"
          ? createPostgresDocumentStore({ url: explicitStorage.url })
          : createInMemoryDocumentStore());
  if (
    runtimeResolution.retrieval.generalizedFusion !== undefined &&
    !isProjectionCapableDocumentStore(rawDocumentStore)
  ) {
    throw new Error(
      "Generalized fusion requires a projection-capable document store with atomic conditional batches.",
    );
  }
  if (
    internal?.behavioralOutcomeRecorder &&
    !isProjectionCapableDocumentStore(rawDocumentStore)
  ) {
    throw new Error(
      "Behavioral outcome recording requires a projection-capable document store with atomic conditional batches.",
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
  const scopeDeletion = projectionRuntime?.scopeDeletion;
  const documentStore = projectionRuntime?.documentStore ?? rawDocumentStore;
  const sessionStore = config.adapters?.sessionStore ??
    (autoStorageAdapters
      ? autoStorageAdapters.sessionStore
      : explicitStorage?.provider === "sqlite"
        ? createSQLiteSessionStore(explicitStorage.url, sqliteStoreOptions)
        : explicitStorage?.provider === "postgres"
          ? createPostgresSessionStore({ url: explicitStorage.url })
          : createInMemorySessionStore());
  const vectorStore = config.adapters?.vectorStore ??
    (autoStorageAdapters
      ? autoStorageAdapters.vectorStore
      : explicitStorage?.provider === "postgres"
        ? createPostgresVectorStore({ url: explicitStorage.url })
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
  const terminalDeletionReady = !customStorageAdapters ||
    (completeCustomStorageAdapters &&
      config.adapters?.terminalDeletionSemantics ===
        "shared-coordinated-backends-v1");
  const repositories = createMemoryRepositories({
    documentStore,
    sessionStore,
    vectorStore,
  });
  const now = config.testing?.now ?? (() => new Date());
  const tracer = createGoodMemoryTracer(config.observability, now);
  const runtime = createGoodMemoryRuntimeFacade({
    documentStore,
    language,
    scopeDeletion,
    sessionStore,
    now,
    ...(internal?.runtimeCompactionExtraction
      ? {
          runtimeCompactionExtraction: {
            extractionStrategy: assistedExtractor
              ? "llm-assisted" as const
              : "rules-only" as const,
            remember: callbacks.rememberWithinScopeMutation,
          },
        }
      : {}),
    tracer,
  });
  const recallEngine = createRecallEngine({
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
  const rememberEngine = createRememberEngine({
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
  const jobs = createGoodMemoryJobsFacade({
    now,
    tracer,
    remember: callbacks.remember,
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
                now().toISOString(),
              ),
          },
        }
      : {}),
  });
  const proposalGate = createProposalGateProcessor({ repositories });
  const proceduralPatternCompiler = createProceduralPatternCompiler({
    repositories,
    language,
    now: () => now().toISOString(),
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
    now: () => now().toISOString(),
  });
  const dreamMaintenance = createDreamMaintenanceOrchestrator({
    gate: createDreamMaintenanceGate(),
    maintenanceRunner,
    reviewer,
    proposalGate,
    compiler: proceduralPatternCompiler,
  });
  const evolutionRuntime = createEvolutionRuntime({
    governanceRepositories: repositories,
    language,
    reviewer,
    proposalGate,
    compiler: proceduralPatternCompiler,
    dreamMaintenance,
    now: () => now().toISOString(),
  });

  return {
    distinctRecallPassHeadProtection,
    documentStore,
    embeddingAdapter,
    evolutionRuntime,
    followUpDecisionGenerator: config.adapters?.followUpDecisionGenerator,
    governanceRepositories: repositories,
    governanceVectors: repositories.vectorIndex,
    jobs,
    language,
    now,
    projectionRuntime,
    recallEngine,
    recallObservationsEnabled,
    rememberEngine,
    reranker,
    rerankerTarget,
    revisionVectorIndex: repositories.vectorIndex,
    runtime,
    runtimeResolution,
    scopeDeletion,
    sessionStore,
    terminalDeletionReady,
    tracer,
  };
}
