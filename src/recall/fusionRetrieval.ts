import type { FactMemory } from "../domain/records";
import {
  loadFullRecallContent,
  loadProjectedRecallContent,
} from "./contentLoader";
import type {
  LoadedRecallContent,
  RecallEngineConfig,
  RecallRequestContext,
} from "./contracts";
import type { GeneralizedFusionSelectionInput } from "./factSelection/generalizedFusionUnion";
import {
  claimProjectionGroupKey,
  fuseGeneralizedRecallCandidates,
} from "./generalizedFusion";
import type {
  GeneralizedFusionCandidate,
  GeneralizedFusionChannelEvidence,
  GeneralizedFusionResult,
} from "./generalizedFusion";
import type {
  ClaimProjection,
  RecallIndexDocument,
} from "./projections/contracts";
import type {
  RecallFusionRunTrace,
  RecallRetrievalChannelTrace,
  RecallRetrievalTrace,
} from "./retrievalTrace";
import type { SemanticSearchScores } from "./scoring";
import type { RoutingDecision } from "./router";

const MAX_FUSION_TRACE_CANDIDATES = 20;

export interface GeneralizedFusionRetrievalResult {
  readonly claimReplacementSourceIds: ReadonlySet<string>;
  readonly content: LoadedRecallContent;
  readonly generalizedFusion?: GeneralizedFusionSelectionInput;
  readonly generalizedFusionCandidates: GeneralizedFusionCandidate[];
  readonly policyApplied: readonly string[];
  readonly rerankProjectionClaims: ClaimProjection[];
  readonly rerankProjectionDocuments: RecallIndexDocument[];
  readonly retrievalTrace?: RecallRetrievalTrace;
  readonly selectedClaimSourceFacts: FactMemory[];
}

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

export async function retrieveGeneralizedFusion(input: {
  config: RecallEngineConfig;
  content: LoadedRecallContent;
  context: RecallRequestContext;
  policyApplied: readonly string[];
  providerDenseScores?: SemanticSearchScores;
  routingDecision: RoutingDecision;
  semanticFactCandidates?: SemanticSearchScores["semanticFactCandidates"];
  semanticUnionTopK: number;
}): Promise<GeneralizedFusionRetrievalResult> {
  const { config, context } = input;
  const { generalizedFusionBudget, generalizedFusionConfig } = context;
  let content: LoadedRecallContent = {
    ...input.content,
    policyApplied: [...input.policyApplied],
  };
  let policyApplied = new Set(input.policyApplied);
  const empty = (): GeneralizedFusionRetrievalResult => ({
    claimReplacementSourceIds: new Set(),
    content,
    generalizedFusionCandidates: [],
    policyApplied: [...policyApplied],
    rerankProjectionClaims: [],
    rerankProjectionDocuments: [],
    selectedClaimSourceFacts: [],
  });

  if (!generalizedFusionConfig || input.routingDecision.strategy === "rules-only") {
    return empty();
  }
  if (!config.projectionIndex) {
    policyApplied.add("generalized_fusion_unavailable");
    return {
      ...empty(),
      retrievalTrace: {
        fusionRuns: [{
          budget: 0,
          candidateCount: 0,
          candidates: [],
          fallbackReason: "projection_unavailable",
          status: "fallback",
        }],
        schemaVersion: 1,
      },
    };
  }

  try {
    const coverage = await config.projectionIndex.ensureScopeIndexed(
      context.input.scope,
    );
    if (!coverage.complete) {
      policyApplied.add("generalized_fusion_partial_projection");
      if (content.projected) {
        content = { ...content, policyApplied: [...policyApplied] };
        content = await loadFullRecallContent({ config, content, context });
        policyApplied = new Set(content.policyApplied);
      }
      return {
        ...empty(),
        retrievalTrace: {
          fusionRuns: [{
            budget: 0,
            candidateCount: 0,
            candidates: [],
            fallbackReason: "projection_incomplete",
            projectionCoverage: "partial",
            status: "fallback",
          }],
          schemaVersion: 1,
        },
      };
    }

    const needsClaimHistory =
      context.recallPlan.aggregation === "change" ||
      context.recallPlan.aggregation === "current" ||
      context.recallPlan.aggregation === "history" ||
      context.recallPlan.temporalConstraints.some(({ kind }) =>
        kind === "after" ||
        kind === "before" ||
        kind === "current" ||
        kind === "history"
      );
    const needsClaimMaterialization =
      needsClaimHistory ||
      context.recallPlan.aggregation === "count" ||
      context.recallPlan.aggregation === "current" ||
      context.recallPlan.temporalConstraints.some(({ kind }) => kind === "current");
    const [documents, entities, claims] = await Promise.all([
      config.projectionIndex.searchDocuments(
        context.input.scope,
        context.input.query,
        context.recallPlan.preRankLimit * 4,
        context.languageContext.locale,
      ),
      config.projectionIndex.searchEntities(
        context.input.scope,
        context.input.query,
        context.recallPlan.preRankLimit,
        context.languageContext.locale,
      ),
      config.projectionIndex.searchClaims(
        context.input.scope,
        context.input.query,
        context.recallPlan.preRankLimit * 4,
        needsClaimHistory,
        context.languageContext.locale,
      ),
    ]);
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
      acceptsEntityCandidate: (candidate) =>
        context.language.acceptsEntityCandidate(
          candidate,
          context.languageContext,
        ),
      channels: generalizedFusionConfig.channels,
      claims,
      denseCandidates: [
        ...(input.semanticFactCandidates ?? [])
          .filter((candidate, _index, candidates) => {
            const bestScore = candidates[0]?.score ?? 0;
            return candidate.score > 0 &&
              (config.semanticCandidates?.minSimilarity === undefined ||
                candidate.score >= config.semanticCandidates.minSimilarity) &&
              (config.semanticCandidates?.minRelativeScore === undefined ||
                candidate.score + Number.EPSILON >=
                  bestScore * config.semanticCandidates.minRelativeScore);
          })
          .slice(
            0,
            Math.max(
              0,
              Math.floor(
                config.semanticCandidates?.maxAdditions ?? input.semanticUnionTopK,
              ),
            ),
          )
          .map(({ id: sourceMemoryId, score }) => ({
            score,
            sourceCollection: "facts" as const,
            sourceMemoryId,
          })),
        ...[...(input.providerDenseScores?.references ?? new Map())]
          .filter(([, score]) => score > 0)
          .map(([sourceMemoryId, score]) => ({
            score,
            sourceCollection: "references" as const,
            sourceMemoryId,
          })),
        ...[...(input.providerDenseScores?.episodes ?? new Map())]
          .filter(([, score]) => score > 0)
          .map(([sourceMemoryId, score]) => ({
            score,
            sourceCollection: "episodes" as const,
            sourceMemoryId,
          })),
      ],
      documents: contentDocuments,
      documentSetComplete: false,
      entities: contentEntities,
      entityPageRank: generalizedFusionConfig.entityPageRank,
      matchesEntityAlias: (query, alias) =>
        context.language.matchesEntityAlias(query, alias, context.languageContext),
      maxCandidates: generalizedFusionBudget?.maxCandidates,
      minRelativeStrength:
        context.queryAnalysis.aggregateCount ||
          context.recallPlan.aggregation === "count"
          ? 0
          : generalizedFusionConfig.minRelativeStrength ?? 0,
      plan: context.recallPlan,
      query: context.input.query,
      referenceTime: context.evidenceReferenceTime,
      rrfK: generalizedFusionConfig.rrfK,
      tokenize: (text) =>
        context.language.tokenize(text, context.languageContext.locale, {
          excludeStopwords: true,
        }),
    });
    content = await loadProjectedRecallContent({
      candidates: fused.candidates,
      config,
      content,
      context,
      documents,
    });
    policyApplied = new Set(content.policyApplied);
    let claimReplacementSourceIds = new Set<string>();
    let selectedClaimSourceFacts: FactMemory[] = [];
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
          .filter((claim) => selectedGroupKeys.has(claimProjectionGroupKey(claim)))
          .map(({ sourceMemoryId }) => sourceMemoryId),
      );
      const factsById = new Map(content.facts.map((fact) => [fact.id, fact]));
      selectedClaimSourceFacts = [...new Set(
        selectedClaims.map(({ sourceMemoryId }) => sourceMemoryId),
      )].flatMap((sourceMemoryId) => {
        const source = factsById.get(sourceMemoryId);
        return source ? [source] : [];
      });
    }
    policyApplied.add("generalized_fusion");
    if (generalizedFusionBudget?.expanded) {
      policyApplied.add("generalized_fusion_complex_query_budget");
    }
    return {
      claimReplacementSourceIds,
      content,
      generalizedFusion: {
        candidates: fused.candidates
          .filter((candidate) => candidate.sourceCollection === "facts")
          .map((candidate) => ({
            id: candidate.sourceMemoryId,
            score: candidate.score,
          })),
        maxAdditions: fused.budget,
        maxTotalFacts: generalizedFusionBudget?.maxTotalFacts,
      },
      generalizedFusionCandidates: fused.candidates,
      policyApplied: [...policyApplied],
      rerankProjectionClaims: claims,
      rerankProjectionDocuments: documents,
      retrievalTrace: {
        fusionRuns: [buildFusionRunTrace({
          coverageComplete: coverage.complete,
          maxCandidates: generalizedFusionBudget?.maxCandidates,
          result: fused,
        })],
        schemaVersion: 1,
      },
      selectedClaimSourceFacts,
    };
  } catch (error) {
    console.error(
      "[goodmemory:generalized-fusion] projection retrieval failed; preserving baseline recall",
      error,
    );
    policyApplied.add("generalized_fusion_unavailable");
    if (content.projected) {
      content = { ...content, policyApplied: [...policyApplied] };
      content = await loadFullRecallContent({ config, content, context });
      policyApplied = new Set(content.policyApplied);
    }
    return {
      ...empty(),
      retrievalTrace: {
        fusionRuns: [{
          budget: 0,
          candidateCount: 0,
          candidates: [],
          fallbackReason: "projection_error",
          status: "fallback",
        }],
        schemaVersion: 1,
      },
    };
  }
}
