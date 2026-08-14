import { createLanguageService } from "../language";
import {
  applyRecallAssistantPlan,
} from "./assistant";
import {
  buildEmptyAssistantInfluence,
  buildEvidenceCountByMemoryId,
  shouldWarnSemanticUnionInactive,
  withAssistantProviderFallback,
  withRoutingWarning,
} from "./assistantFallback";
import { computeBm25Scores } from "./bm25";
import {
  createEmptyRecallContent,
  loadFullRecallContent,
  loadRecallContent,
} from "./contentLoader";
import type {
  RecallEngineConfig,
  RecallGeneralizedFusionBudget,
  RecallGeneralizedFusionConfig,
  RecallInput,
  RecallRequestContext,
  RecallResult,
  RetrievedRecallCandidates,
} from "./contracts";
import { ProviderBackedRecallError } from "./errors";
import { retrieveGeneralizedFusion } from "./fusionRetrieval";
import { selectGeneralizedFactsForInternalUse } from "./generalizedSelection";
import { applyRecallPolicyToRecords } from "./policy";
import { resolveRecallPlan } from "./recallPlan";
import type { TemporalReferenceConstraint } from "./recallPlan";
import { assembleRecallResult } from "./resultAssembly";
import {
  planRecall,
  resolveRetrievalProfile,
  SEMANTIC_RECALL_INACTIVE_WARNING,
} from "./router";
import { searchSemanticScores } from "./scoring";
import type { SemanticSearchScores } from "./scoring";

const COMPLEX_QUERY_CANDIDATE_BONUS = 4;
const COMPLEX_QUERY_FACT_BONUS = 2;

export function resolveGeneralizedFusionBudget(input: {
  base: RecallGeneralizedFusionConfig;
  plan: RecallRequestContext["recallPlan"];
}): RecallGeneralizedFusionBudget {
  const expanded = input.plan.maxHops > 1 || input.plan.uncertainty === "high";
  const baseCandidates = input.base.maxCandidates ?? input.plan.preRankLimit;
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

export function resolveActiveGeneralizedFusionConfig(input: {
  base?: RecallGeneralizedFusionConfig;
  rerank: boolean;
  reranking?: RecallGeneralizedFusionConfig;
}): RecallGeneralizedFusionConfig | undefined {
  return input.rerank ? input.reranking ?? input.base : input.base;
}

async function createRecallRequestContext(input: {
  config: RecallEngineConfig;
  language: ReturnType<typeof createLanguageService>;
  now: () => number;
  recallInput: RecallInput;
  referenceTime: () => string;
  vectorIndex: RecallRequestContext["vectorIndex"];
}): Promise<RecallRequestContext> {
  const {
    config,
    language,
    now,
    recallInput,
    referenceTime,
    vectorIndex,
  } = input;
  const startedAt = now();
  const languageContext = recallInput.languageContext ?? language.resolveFromText({
    locale: recallInput.locale,
    text: recallInput.query,
  });
  const queryAnalysis = recallInput.queryAnalysis ??
    language.analyzeQuery(recallInput.query, languageContext);
  const currentReferenceTime =
    recallInput.referenceTime !== undefined &&
      Number.isFinite(Date.parse(recallInput.referenceTime))
      ? new Date(Date.parse(recallInput.referenceTime)).toISOString()
      : referenceTime();
  const planResolution = recallInput.recallPlan
    ? { assistantApplied: false, plan: recallInput.recallPlan }
    : await resolveRecallPlan({
        assistant: config.recallPlanner,
        input: {
          language,
          languageContext,
          locale: languageContext.locale,
          query: recallInput.query,
          queryAnalysis,
          referenceTime: currentReferenceTime,
          scope: recallInput.scope,
          timezone: recallInput.timezone,
        },
      });
  const policyApplied = new Set<string>();
  if (planResolution.assistantApplied) {
    policyApplied.add("recall_plan_assistant_applied");
  } else if (planResolution.fallbackReason) {
    policyApplied.add("recall_plan_assistant_fallback");
    console.error(
      "[goodmemory:recall-plan] assisted planning failed; using deterministic plan",
      {
        locale: languageContext.locale,
        queryLength: recallInput.query.length,
      },
    );
  }
  const generalizedFusionConfig = resolveActiveGeneralizedFusionConfig({
    base: config.generalizedFusion,
    rerank: recallInput.rerank !== false,
    reranking: config.rerankGeneralizedFusion,
  });
  const generalizedFusionBudget = generalizedFusionConfig
    ? resolveGeneralizedFusionBudget({
        base: generalizedFusionConfig,
        plan: planResolution.plan,
      })
    : undefined;
  const evidenceReferenceTime = planResolution.plan.temporalConstraints.find(
    (constraint): constraint is TemporalReferenceConstraint =>
      constraint.kind === "before" || constraint.kind === "current",
  )?.referenceTime ?? currentReferenceTime;

  return {
    currentReferenceTime,
    evidenceReferenceTime,
    ...(generalizedFusionBudget ? { generalizedFusionBudget } : {}),
    ...(generalizedFusionConfig ? { generalizedFusionConfig } : {}),
    input: recallInput,
    language,
    languageContext,
    policyApplied: [...policyApplied],
    queryAnalysis,
    recallPlan: planResolution.plan,
    retrievalProfile: resolveRetrievalProfile(recallInput.retrievalProfile),
    startedAt,
    vectorIndex,
  };
}

function computeBm25AdditiveScores(
  context: RecallRequestContext,
  content: RetrievedRecallCandidates["content"],
): SemanticSearchScores {
  const tokenize = (text: string): string[] =>
    context.language.tokenize(text, context.languageContext.locale, {
      excludeStopwords: true,
    });
  return {
    facts: computeBm25Scores(
      context.input.query,
      content.facts.map((fact) => ({
        id: fact.id,
        text: `${fact.content} ${fact.subject ?? ""}`,
      })),
      { tokenize },
    ),
    references: computeBm25Scores(
      context.input.query,
      content.references.map((reference) => ({
        id: reference.id,
        text: `${reference.title} ${reference.pointer} ${reference.description ?? ""}`,
      })),
      { tokenize },
    ),
    episodes: computeBm25Scores(
      context.input.query,
      content.episodes.map((episode) => ({
        id: episode.id,
        text: `${episode.summary} ${(episode.topics ?? []).join(" ")}`,
      })),
      { tokenize },
    ),
  };
}

export async function retrieveRecallCandidates(input: {
  config: RecallEngineConfig;
  content: RetrievedRecallCandidates["content"];
  context: RecallRequestContext;
}): Promise<RetrievedRecallCandidates> {
  const { config, context } = input;
  let content = input.content;
  let policyApplied = new Set(content.policyApplied);
  const routerAvailability = {
    llmRouting: Boolean(config.assistedRouter),
    semanticSearch: Boolean(
      (config.embedding && context.vectorIndex) ||
        config.bm25Ranking ||
        (context.generalizedFusionConfig && config.projectionIndex),
    ),
  };
  let routingDecision = planRecall({
    autoStrategyBias: config.autoStrategyBias,
    availability: routerAvailability,
    language: context.language,
    locale: context.languageContext.locale,
    query: context.input.query,
    queryAnalysis: context.queryAnalysis,
    retrievalProfile: context.retrievalProfile,
    runtime: {
      hasJournal: context.input.ignoreMemory ? false : Boolean(content.journal),
      hasWorkingMemory: context.input.ignoreMemory
        ? false
        : Boolean(content.workingMemory),
    },
    strategy: context.input.strategy,
  });
  const semanticUnionTopK = Math.max(
    1,
    Math.floor(config.semanticCandidates?.topK ?? 8),
  );

  if (context.input.ignoreMemory) {
    policyApplied.add("ignore_memory");
    return {
      claimReplacementSourceIds: new Set(),
      content,
      evidenceCountsByMemoryId: new Map(),
      generalizedFusionCandidates: [],
      ignored: true,
      policyApplied: [...policyApplied],
      rerankProjectionClaims: [],
      rerankProjectionDocuments: [],
      routingDecision,
      selectedClaimSourceFacts: [],
      semanticUnionTopK,
      visibleEvidencePool: [],
    };
  }
  if (content.projected && routingDecision.strategy === "rules-only") {
    content = await loadFullRecallContent({ config, content, context });
    policyApplied = new Set(content.policyApplied);
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
        locale: context.languageContext.locale,
        query: context.input.query,
        routingDecision,
        runtime: {
          hasJournal: Boolean(content.journal),
          hasWorkingMemory: Boolean(content.workingMemory),
        },
      });
      const assistedPlan = applyRecallAssistantPlan({
        influence: assistantInfluence ?? buildEmptyAssistantInfluence(),
        plan: assistantPlan,
        routingDecision,
      });
      assistantInfluence = assistedPlan.influence;
      routingDecision = assistedPlan.routingDecision;
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
      vectorIndex: context.vectorIndex,
    })
  ) {
    routingDecision = withRoutingWarning(
      routingDecision,
      SEMANTIC_RECALL_INACTIVE_WARNING,
    );
  }
  if (
    context.input.includeEvidence === true &&
    !routingDecision.sourcePriorities.includes("evidence")
  ) {
    routingDecision = {
      ...routingDecision,
      sourcePriorities: [...routingDecision.sourcePriorities, "evidence"],
    };
    policyApplied.add("explicit_evidence_requested");
  }
  const visibleEvidencePool = await applyRecallPolicyToRecords(
    content.evidence,
    "evidence",
    {
      locale: context.languageContext.locale,
      localeSource: context.languageContext.localeSource,
      policy: config.policy,
      policyApplied,
      query: context.input.query,
      retrievalProfile: context.retrievalProfile,
      scope: context.input.scope,
    },
  );
  const evidenceCountsByMemoryId = buildEvidenceCountByMemoryId(
    visibleEvidencePool,
  );
  let providerDenseScores: SemanticSearchScores | undefined;
  let semanticFactCandidates: SemanticSearchScores["semanticFactCandidates"];
  let semanticScores: SemanticSearchScores | undefined;
  if (
    routingDecision.strategy === "hybrid" &&
    config.embedding &&
    context.vectorIndex &&
    (!config.bm25Ranking || config.semanticCandidates)
  ) {
    try {
      const providerSemanticScores = await searchSemanticScores({
        embedding: config.embedding,
        query: context.input.query,
        scope: context.input.scope,
        vectorIndex: context.vectorIndex,
        ...(config.semanticCandidates || context.generalizedFusionConfig
          ? {
              factCandidates: {
                topK:
                  config.semanticCandidates?.topK ??
                  context.generalizedFusionBudget?.maxCandidates ??
                  semanticUnionTopK,
              },
            }
          : {}),
      });
      providerDenseScores = providerSemanticScores;
      semanticFactCandidates = providerSemanticScores.semanticFactCandidates;
      semanticScores = config.bm25Ranking
        ? {
            ...computeBm25AdditiveScores(context, content),
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
    semanticScores = computeBm25AdditiveScores(context, content);
  }
  const fusion = await retrieveGeneralizedFusion({
    config,
    content,
    context,
    policyApplied: [...policyApplied],
    providerDenseScores,
    routingDecision,
    semanticFactCandidates,
    semanticUnionTopK,
  });

  return {
    assistantInfluence,
    claimReplacementSourceIds: fusion.claimReplacementSourceIds,
    content: fusion.content,
    evidenceCountsByMemoryId,
    ...(fusion.generalizedFusion
      ? { generalizedFusion: fusion.generalizedFusion }
      : {}),
    generalizedFusionCandidates: fusion.generalizedFusionCandidates,
    ignored: false,
    policyApplied: fusion.policyApplied,
    rerankProjectionClaims: fusion.rerankProjectionClaims,
    rerankProjectionDocuments: fusion.rerankProjectionDocuments,
    ...(fusion.retrievalTrace ? { retrievalTrace: fusion.retrievalTrace } : {}),
    routingDecision,
    selectedClaimSourceFacts: fusion.selectedClaimSourceFacts,
    ...(semanticFactCandidates !== undefined ? { semanticFactCandidates } : {}),
    ...(semanticScores ? { semanticScores } : {}),
    semanticUnionTopK,
    visibleEvidencePool,
  };
}

export function createRecallPipeline(config: RecallEngineConfig) {
  const language = config.language ?? createLanguageService();
  const factSelector = config.factSelector ?? selectGeneralizedFactsForInternalUse;
  const now = config.now ?? Date.now;
  const referenceTime = config.referenceTime ??
    (() => new Date(now()).toISOString());
  const vectorIndex = config.vectorIndex !== undefined
    ? config.vectorIndex ?? null
    : config.repositories.vectorIndex ?? null;

  return {
    async recall(input: RecallInput): Promise<RecallResult> {
      const context = await createRecallRequestContext({
        config,
        language,
        now,
        recallInput: input,
        referenceTime,
        vectorIndex,
      });
      const content = input.ignoreMemory
        ? createEmptyRecallContent(context.policyApplied)
        : await loadRecallContent(config, context);
      const retrieved = await retrieveRecallCandidates({
        config,
        content,
        context,
      });
      return assembleRecallResult({
        config,
        context,
        factSelector,
        now,
        retrieved,
      });
    },
  };
}
