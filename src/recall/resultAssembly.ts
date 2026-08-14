import {
  applyRecallAssistantRerank,
  buildRecallAssistantCandidates,
} from "./assistant";
import {
  appendAssistantTraceDetails,
  buildEmptyAssistantInfluence,
  collectAssistantProtectedCandidateIds,
  createAssistantSuppressionTraceReason,
  finalizeAssistantInfluence,
  shouldSuppressGuidanceLanesForFactQuery,
  withAssistantProviderFallback,
} from "./assistantFallback";
import { hydrateEpisodeSpans } from "./contentLoader";
import { buildMemoryPacket } from "./contextBuilder";
import type {
  RecallCandidateTrace,
  RecallEngineConfig,
  RecallRequestContext,
  RecallResult,
  RetrievedRecallCandidates,
} from "./contracts";
import {
  attachEvidenceIdsToCandidateTraces,
  buildEvidenceLinkIndex,
  buildHits,
  collectSessionScopedEvidence,
  collectTraceMemoryIds,
  filterLinkedEvidence,
  selectEvidence,
} from "./evidence";
import { buildEvidenceLedger } from "./evidenceLedger";
import { admitGeneralizedRecords } from "./generalizedAdmissions";
import type { FactSelector } from "./generalizedSelection";
import { filterFactsByOccurrence } from "./occurrence";
import {
  applyRecallPolicyToProfile,
  applyRecallPolicyToRecords,
  reconcileCandidateTraces,
} from "./policy";
import type { ClaimProjection } from "./projections/contracts";
import {
  canonicalFactMemoryId,
  buildRecallRerankCandidates,
  collectUnseenFusionRecords,
  reconcileFusionTraceSelection,
} from "./rerankAssembly";
import {
  findAmbiguousRecallRerankMemoryIds,
  setRecallRerankPool,
} from "./rerankPool";
import {
  selectArchives,
  selectEpisodes,
  selectFeedbackForQuery,
  selectPreferencesForQuery,
  selectReferences,
} from "./selection";
import { evaluateVerificationHints } from "../verify/policy";
import type { TemporalConstraint } from "./recallPlan";

export async function assembleRecallResult(input: {
  config: RecallEngineConfig;
  context: RecallRequestContext;
  factSelector: FactSelector;
  now: () => number;
  retrieved: RetrievedRecallCandidates;
}): Promise<RecallResult> {
  const { config, context, retrieved } = input;
  const recallInput = context.input;
  const now = input.now;
  const policyApplied = new Set(retrieved.policyApplied);
  const occurrenceInterval = context.recallPlan.temporalConstraints.find(
    (constraint): constraint is Extract<TemporalConstraint, { kind: "during" }> =>
      constraint.kind === "during",
  )?.interval;

  if (retrieved.ignored) {
    const packet = buildMemoryPacket({
      archives: [],
      episodes: [],
      evidence: [],
      facts: [],
      feedback: [],
      journal: null,
      language: context.language,
      languageContext: context.languageContext,
      locale: context.languageContext.locale,
      maxRenderedTokens: context.recallPlan.maxRenderedTokens,
      preferences: [],
      profile: null,
      references: [],
      routingDecision: retrieved.routingDecision,
      workingMemory: null,
    });

    return {
      profile: null,
      preferences: [],
      references: [],
      facts: [],
      feedback: [],
      archives: [],
      evidence: [],
      ...(recallInput.includeEvidence ? { evidenceLedger: [] } : {}),
      episodes: [],
      workingMemory: null,
      journal: null,
      packet,
      metadata: {
        routingDecision: retrieved.routingDecision,
        tokenCount: packet.debug?.estimatedTokens ?? 0,
        latencyMs: now() - context.startedAt,
        hits: [],
        candidateTraces: [],
        verificationHints: [],
        policyApplied: [...policyApplied],
        locale: context.languageContext.locale,
        localeSource: context.languageContext.localeSource,
        languagePackId: context.languageContext.languagePackId,
        languagePackVersion: context.languageContext.languagePackVersion,
        analysisMode: context.languageContext.analysisMode,
      },
    };
  }

  const content = retrieved.content;
  const policyContext = {
    locale: context.languageContext.locale,
    localeSource: context.languageContext.localeSource,
    policy: config.policy,
    policyApplied,
    query: recallInput.query,
    retrievalProfile: context.retrievalProfile,
    scope: recallInput.scope,
  };
  const filteredProfile = await applyRecallPolicyToProfile(
    content.profile,
    policyContext,
  );
  const suppressGuidanceLanes = shouldSuppressGuidanceLanesForFactQuery({
    queryAnalysis: context.queryAnalysis,
    routingDecision: retrieved.routingDecision,
  });
  const includeGuidanceLanes = !suppressGuidanceLanes;
  const preferences = includeGuidanceLanes
    ? await applyRecallPolicyToRecords(
        selectPreferencesForQuery(
          content.preferences,
          recallInput.query,
          context.language,
          context.languageContext.locale,
          context.queryAnalysis,
        ),
        "preference",
        policyContext,
      )
    : [];
  if (suppressGuidanceLanes) {
    policyApplied.add("guidance_lanes_suppressed_for_fact_query");
  }
  if (
    config.semanticCandidates &&
    (!config.embedding || !context.vectorIndex)
  ) {
    policyApplied.add("semantic_candidates_unavailable");
  }
  const semanticUnion =
    !retrieved.generalizedFusion &&
      config.semanticCandidates &&
      retrieved.semanticFactCandidates !== undefined &&
      retrieved.semanticFactCandidates.length > 0
      ? {
          candidates: retrieved.semanticFactCandidates,
          maxAdditions: Math.max(
            0,
            Math.floor(
              config.semanticCandidates.maxAdditions ??
                retrieved.semanticUnionTopK,
            ),
          ),
          ...(config.semanticCandidates.minSimilarity !== undefined
            ? { minSimilarity: config.semanticCandidates.minSimilarity }
            : {}),
          ...(config.semanticCandidates.minRelativeScore !== undefined
            ? { minRelativeScore: config.semanticCandidates.minRelativeScore }
            : {}),
        }
      : undefined;
  const factSelectionPool = retrieved.claimReplacementSourceIds.size > 0
    ? [
        ...content.facts.filter(
          (fact) => !retrieved.claimReplacementSourceIds.has(fact.id),
        ),
        ...retrieved.selectedClaimSourceFacts,
      ]
    : content.facts;
  const occurrenceFacts = filterFactsByOccurrence(
    factSelectionPool,
    context.recallPlan.temporalConstraints,
  );
  const hasOccurrenceFence = context.recallPlan.temporalConstraints.some(
    (constraint) => constraint.kind === "during",
  );
  const occurrenceFactIds = hasOccurrenceFence
    ? new Set(occurrenceFacts.map(({ id }) => id))
    : undefined;
  const occurrenceSuppressedFactIds = hasOccurrenceFence
    ? new Set(
        factSelectionPool
          .filter(({ id }) => !occurrenceFactIds!.has(id))
          .map(({ id }) => id),
      )
    : new Set<string>();
  if (hasOccurrenceFence) {
    policyApplied.add("event_occurrence_fence");
  }
  const selectedFacts = input.factSelector(
    factSelectionPool,
    recallInput.query,
    context.language,
    context.languageContext.locale,
    context.retrievalProfile,
    retrieved.routingDecision,
    filteredProfile,
    context.currentReferenceTime,
    retrieved.semanticScores?.facts,
    retrieved.evidenceCountsByMemoryId,
    semanticUnion,
    retrieved.generalizedFusion,
    context.queryAnalysis,
    occurrenceFactIds,
  );
  let facts = await applyRecallPolicyToRecords(
    selectedFacts.facts,
    "fact",
    policyContext,
  );
  const visibleFeedback = includeGuidanceLanes
    ? await applyRecallPolicyToRecords(
        content.feedback,
        "feedback",
        policyContext,
      )
    : [];
  const feedback = selectFeedbackForQuery(
    visibleFeedback,
    recallInput.query,
    context.language,
    context.languageContext.locale,
    context.retrievalProfile,
    context.queryAnalysis,
  );
  const selectedArchives = selectArchives(
    content.archives,
    recallInput.query,
    context.language,
    context.languageContext.locale,
    retrieved.routingDecision,
    context.currentReferenceTime,
  );
  const generalizedArchives = admitGeneralizedRecords({
    candidates: retrieved.generalizedFusionCandidates,
    collection: "session_archives",
    getId: (archive) => archive.id,
    maxRecords:
      context.generalizedFusionConfig?.contentLaneRecords?.sessionArchives ?? 1,
    records: content.archives,
    selected: selectedArchives.archives,
    traces: selectedArchives.traces,
  });
  let archives = await applyRecallPolicyToRecords(
    generalizedArchives,
    "archive",
    policyContext,
  );
  const selectedEpisodes = selectEpisodes(
    content.episodes,
    recallInput.query,
    context.language,
    context.languageContext.locale,
    retrieved.routingDecision,
    context.currentReferenceTime,
    retrieved.semanticScores?.episodes,
  );
  const generalizedEpisodes = admitGeneralizedRecords({
    candidates: retrieved.generalizedFusionCandidates,
    collection: "episodes",
    getId: (episode) => episode.id,
    maxRecords:
      context.generalizedFusionConfig?.contentLaneRecords?.episodes ?? 2,
    records: content.episodes,
    selected: selectedEpisodes.episodes,
    traces: selectedEpisodes.traces,
  });
  let episodes = await applyRecallPolicyToRecords(
    generalizedEpisodes,
    "episode",
    policyContext,
  );
  const selectedReferences = selectReferences(
    content.references,
    recallInput.query,
    context.language,
    context.languageContext.locale,
    retrieved.routingDecision,
    context.currentReferenceTime,
    retrieved.semanticScores?.references,
    retrieved.evidenceCountsByMemoryId,
    context.queryAnalysis,
  );
  const generalizedReferences = admitGeneralizedRecords({
    candidates: retrieved.generalizedFusionCandidates,
    collection: "references",
    getId: (reference) => reference.id,
    maxRecords:
      context.generalizedFusionConfig?.contentLaneRecords?.references ?? 1,
    records: content.references,
    selected: selectedReferences.references,
    traces: selectedReferences.traces,
  });
  let references = await applyRecallPolicyToRecords(
    generalizedReferences,
    "reference",
    policyContext,
  );
  let assistantInfluence = retrieved.assistantInfluence;
  if (
    retrieved.routingDecision.strategy === "llm-assisted" &&
    config.assistedRouter &&
    !assistantInfluence?.fallbackReason
  ) {
    const rerankSelection = { archives, episodes, facts, references };
    const protectedCandidateIds = collectAssistantProtectedCandidateIds([
      selectedFacts.traces,
      selectedReferences.traces,
      selectedArchives.traces,
      selectedEpisodes.traces,
    ]);
    const assistantCandidates = buildRecallAssistantCandidates(
      rerankSelection,
      { protectedCandidateIds },
    );
    if (assistantCandidates.length > 0) {
      try {
        const rerank = await config.assistedRouter.rerank({
          candidates: assistantCandidates,
          locale: context.languageContext.locale,
          query: recallInput.query,
          querySummary: assistantInfluence?.querySummary,
          routingDecision: retrieved.routingDecision,
        });
        const reranked = applyRecallAssistantRerank({
          influence: assistantInfluence ?? buildEmptyAssistantInfluence(),
          protectedCandidateIds,
          rerank,
          selection: rerankSelection,
        });
        assistantInfluence = reranked.influence;
        ({ archives, episodes, facts, references } = reranked.selection);
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
  const poolFacts = [
    ...facts,
    ...await applyRecallPolicyToRecords(
      collectUnseenFusionRecords({
        candidates: retrieved.generalizedFusionCandidates,
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
        candidates: retrieved.generalizedFusionCandidates,
        collection: "references",
        evaluatedIds: new Set(generalizedReferences.map(({ id }) => id)),
        records: content.references,
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
        candidates: retrieved.generalizedFusionCandidates,
        collection: "episodes",
        evaluatedIds: new Set(generalizedEpisodes.map(({ id }) => id)),
        records: content.episodes,
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
        candidates: retrieved.generalizedFusionCandidates,
        collection: "session_archives",
        evaluatedIds: new Set(generalizedArchives.map(({ id }) => id)),
        records: content.archives,
        suppressedIds: suppressedCandidateIds,
        traces: selectedArchives.traces,
      }),
      "archive",
      policyContext,
    ),
  ];
  facts = filterFactsByOccurrence(
    facts,
    context.recallPlan.temporalConstraints,
  );
  const rerankPoolSelection = {
    archives: [...new Map(
      poolArchives.map((record) => [record.id, record]),
    ).values()],
    episodes: [...new Map(
      poolEpisodes.map((record) => [record.id, record]),
    ).values()],
    facts: filterFactsByOccurrence(
      [...new Map(poolFacts.map((record) => [record.id, record])).values()],
      context.recallPlan.temporalConstraints,
    ),
    references: [...new Map(
      poolReferences.map((record) => [record.id, record]),
    ).values()],
  };
  const rerankCandidates = buildRecallRerankCandidates({
    candidates: retrieved.generalizedFusionCandidates,
    claims: retrieved.rerankProjectionClaims,
    documents: retrieved.rerankProjectionDocuments,
    pool: rerankPoolSelection,
    selected: { archives, episodes, facts, references },
  });
  const retrievalTrace = reconcileFusionTraceSelection(
    retrieved.retrievalTrace,
    { archives, episodes, facts, references },
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
    retrieved.visibleEvidencePool,
    new Set([
      ...selectedFactSourceIds,
      ...references.map(({ id }) => id),
      ...feedback.map(({ id }) => id),
      ...episodes.map(({ id }) => id),
    ]),
    new Set(archives.map(({ id }) => id)),
    feedbackEvidenceIds,
  );
  const explainabilityLinkedEvidence = filterLinkedEvidence(
    retrieved.visibleEvidencePool,
    new Set([
      ...factTraceIds.memoryIds,
      ...selectedFactSourceIds,
      ...referenceTraceIds.memoryIds,
      ...episodeTraceIds.memoryIds,
      ...feedback.map(({ id }) => id),
    ]),
    new Set([...archiveTraceIds.archiveIds]),
    feedbackEvidenceIds,
  );
  const sessionScopedEvidence = context.retrievalProfile === "coding_agent"
    ? collectSessionScopedEvidence(retrieved.visibleEvidencePool, recallInput.scope)
    : [];
  const completeEvidence = retrieved.routingDecision.sourcePriorities.includes(
    "evidence",
  )
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
    retrieved.visibleEvidencePool,
    new Set([
      ...rerankPoolFactSourceIds,
      ...rerankPoolSelection.references.map(({ id }) => id),
      ...feedback.map(({ id }) => id),
      ...rerankPoolSelection.episodes.map(({ id }) => id),
    ]),
    new Set(rerankPoolSelection.archives.map(({ id }) => id)),
    feedbackEvidenceIds,
  );
  const rerankPoolEvidence = retrieved.routingDecision.sourcePriorities.includes(
    "evidence",
  )
    ? [...new Map(
        [...rerankPoolLinkedEvidence, ...sessionScopedEvidence].map((record) => [
          record.id,
          record,
        ]),
      ).values()]
    : [];
  const contextEvidence = selectEvidence(completeEvidence);
  const evidence = recallInput.includeEvidence
    ? completeEvidence
    : contextEvidence;
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
  const factSuppressionTraceReason = (trace: RecallCandidateTrace): string =>
    occurrenceSuppressedFactIds.has(trace.memoryId)
      ? "event_occurrence_mismatch"
      : assistantSuppressionTraceReason(trace);
  const candidateTraces = appendAssistantTraceDetails(
    attachEvidenceIdsToCandidateTraces(
      [
        ...reconcileCandidateTraces(
          selectedFacts.traces,
          new Set(facts.map(({ id }) => id)),
          factSuppressionTraceReason,
        ),
        ...reconcileCandidateTraces(
          selectedReferences.traces,
          new Set(references.map(({ id }) => id)),
          assistantSuppressionTraceReason,
        ),
        ...reconcileCandidateTraces(
          selectedArchives.traces,
          new Set(archives.map(({ id }) => id)),
          assistantSuppressionTraceReason,
        ),
        ...reconcileCandidateTraces(
          selectedEpisodes.traces,
          new Set(episodes.map(({ id }) => id)),
          assistantSuppressionTraceReason,
        ),
      ],
      evidenceIndex,
    ),
    assistantInfluence,
  );
  const workingMemory = context.retrievalProfile === "coding_agent"
    ? content.workingMemory
    : null;
  const journal = context.retrievalProfile === "coding_agent"
    ? content.journal
    : null;
  const selectedMemoryIds = [
    ...selectedFactSourceIds,
    ...references.map(({ id }) => id),
    ...feedback.map(({ id }) => id),
    ...episodes.map(({ id }) => id),
    ...archives.map(({ id }) => id),
  ];
  let ledgerClaims: ClaimProjection[] = [];
  if (
    recallInput.includeEvidence &&
    rerankPoolEvidence.length > 0 &&
    config.projectionIndex
  ) {
    try {
      const groupClaims =
        await config.projectionIndex.queryClaimsForSourceMemoryGroups(
          recallInput.scope,
          rerankPoolMemoryIds,
        );
      ledgerClaims = [...new Map(
        [...groupClaims, ...retrieved.rerankProjectionClaims].map((claim) => [
          claim.id,
          claim,
        ]),
      ).values()];
    } catch (error) {
      console.error(
        "[goodmemory:evidence-ledger] claim lookup failed; returning raw evidence ledger",
        error,
      );
    }
  }
  const evidenceLedger = recallInput.includeEvidence
    ? buildEvidenceLedger({
        aggregation: context.recallPlan.aggregation,
        ambiguousSourceMemoryIds: [...ambiguousSourceMemoryIds],
        claims: ledgerClaims,
        evidence,
        facts,
        occurrenceInterval,
        referenceTime: context.evidenceReferenceTime,
        selectedMemoryIds,
      })
    : undefined;
  const episodeSpans = await hydrateEpisodeSpans({
    episodes,
    scope: recallInput.scope,
    sourceMessages: config.repositories.sourceMessages,
  });
  const packet = buildMemoryPacket({
    profile: filteredProfile,
    preferences,
    references,
    facts,
    feedback,
    archives,
    evidence: contextEvidence,
    episodes,
    ...(episodeSpans !== undefined ? { episodeSpans } : {}),
    workingMemory,
    journal,
    maxRenderedTokens: context.recallPlan.maxRenderedTokens,
    language: context.language,
    languageContext: context.languageContext,
    durableCandidateOrder: assistantInfluence?.rerankApplied
      ? assistantInfluence.rerankedCandidateIds
      : undefined,
    locale: context.languageContext.locale,
    routingDecision: retrieved.routingDecision,
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
      routingDecision: retrieved.routingDecision,
      tokenCount: packet.debug?.estimatedTokens ?? 0,
      latencyMs: now() - context.startedAt,
      verificationHints: evaluateVerificationHints({
        query: recallInput.query,
        referenceTime: context.currentReferenceTime,
        evidenceIdsByMemoryId: evidenceIndex.byMemoryId,
        facts,
        references,
        episodes,
        locale: context.languageContext.locale,
        language: context.language,
        queryAnalysis: context.queryAnalysis,
      }),
      candidateTraces,
      policyApplied: [...policyApplied],
      locale: context.languageContext.locale,
      localeSource: context.languageContext.localeSource,
      languagePackId: context.languageContext.languagePackId,
      languagePackVersion: context.languageContext.languagePackVersion,
      analysisMode: context.languageContext.analysisMode,
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
        routingDecision: retrieved.routingDecision,
        semanticUnionFactIds: new Set(
          selectedFacts.traces
            .filter(
              (trace) => trace.returned && trace.fallback === "semantic_union",
            )
            .map(({ memoryId }) => memoryId),
        ),
        generalizedFusionFactIds: new Set(
          selectedFacts.traces
            .filter(
              (trace) => trace.returned && trace.fallback === "generalized_fusion",
            )
            .map(({ memoryId }) => memoryId),
        ),
        generalizedFusionReferenceIds: new Set(
          selectedReferences.traces
            .filter(
              (trace) => trace.returned && trace.fallback === "generalized_fusion",
            )
            .map(({ memoryId }) => memoryId),
        ),
        generalizedFusionArchiveIds: new Set(
          selectedArchives.traces
            .filter(
              (trace) => trace.returned && trace.fallback === "generalized_fusion",
            )
            .map(({ memoryId }) => memoryId),
        ),
        generalizedFusionEpisodeIds: new Set(
          selectedEpisodes.traces
            .filter(
              (trace) => trace.returned && trace.fallback === "generalized_fusion",
            )
            .map(({ memoryId }) => memoryId),
        ),
      }),
    },
  };
  return setRecallRerankPool(result, {
    aggregation: context.recallPlan.aggregation,
    candidates: rerankCandidates,
    claims: ledgerClaims,
    evidence: rerankPoolEvidence,
    explicitEvidenceIds: [...new Set([
      ...feedbackEvidenceIds,
      ...sessionScopedEvidence.map(({ id }) => id),
    ])],
    includeEvidence: recallInput.includeEvidence === true,
    laneCaps: {
      facts: context.recallPlan.selectedLimit,
      references:
        context.generalizedFusionConfig?.contentLaneRecords?.references ?? 1,
      episodes:
        context.generalizedFusionConfig?.contentLaneRecords?.episodes ?? 2,
      session_archives:
        context.generalizedFusionConfig?.contentLaneRecords?.sessionArchives ?? 1,
    },
    referenceTime: context.evidenceReferenceTime,
    occurrenceInterval,
  });
}
