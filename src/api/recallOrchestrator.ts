import { isIanaTimezone, isRfc3339Instant } from "../domain/temporal";
import { assertStorageSafeExternalValue } from "../domain/semanticText";
import type { LanguageService } from "../language";
import type { GoodMemoryTraceLink } from "../observability/contracts";
import type { GoodMemoryTracer } from "../observability/tracer";
import { rebuildMemoryPacket } from "../recall/contextBuilder";
import { selectEvidence } from "../recall/evidence";
import { iterativeRecall } from "../recall/iterativeRecall";
import type { IterativeRecallStep } from "../recall/iterativeRecall";
import {
  decomposedRecall,
  splitQueryIntoSubQueries,
} from "../recall/queryDecomposition";
import {
  buildDeterministicRecallPlan,
  buildUnplannedRecallPlan,
  resolveRecallPlan,
} from "../recall/recallPlan";
import type {
  RecallPlan,
  RecallPlanResolution,
} from "../recall/recallPlan";
import {
  copyRecallRerankPool,
  mergeRecallRerankPools,
} from "../recall/rerankPool";
import type {
  RecallExecutionStopReason,
  RecallQueryExecutionTrace,
  RecallRetrievalTrace,
} from "../recall/retrievalTrace";
import { readInternalRecallLanguageAnalysis } from "./internalRetrievalRollout";
import {
  applyDurableRerankingToResult,
  applyDurableSelectionToResult,
  applyOccurrenceFenceToResult,
  buildSkippedRerankerTrace,
  getDurableRerankerCandidateCount,
  withRerankerTrace,
} from "./recallReranking";
import type {
  GoodMemoryConfig,
  RecallInput,
  RecallResult,
} from "./contracts";
import type { GoodMemoryAssembly } from "./goodMemoryAssembly";

interface RecallOrchestratorDependencies {
  assembly: GoodMemoryAssembly;
  config: GoodMemoryConfig;
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

// Fuse candidates across the primary recall and each sub-query, then apply the
// RecallPlan's final global durable-evidence limit before returning context.
// Session-scoped singletons (profile, working memory, journal) come from the
// primary recall.
function mergeRecallResults(
  primary: RecallResult,
  supplementary: RecallResult[],
  plan: Pick<RecallPlan, "preRankLimit" | "selectedLimit">,
  language: LanguageService,
  query: string,
  policyMarker = "decomposed_recall",
  distinctPassHeadProtection = false,
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
  const notes = unionRecordsById(results, (result) => result.notes);
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
    notes,
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
    notes,
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
  const pooled = mergeRecallRerankPools({
    distinctPassHeadProtection,
    preRankLimit: plan.preRankLimit,
    primaryReserveLimit: plan.selectedLimit,
    results,
    target: merged,
  });
  return applyDurableSelectionToResult({
    language,
    preRankLimit: plan.preRankLimit,
    preserveResult: primary,
    query,
    result: pooled,
    selectedLimit: plan.selectedLimit,
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

export async function resolveRecallTemporalContext(
  dependencies: RecallOrchestratorDependencies,
  input: RecallInput,
): Promise<{
  referenceTime: string;
  timezone?: string;
}> {
  if (input.referenceTime !== undefined && !isRfc3339Instant(input.referenceTime)) {
    throw new TypeError(`Invalid referenceTime: ${input.referenceTime}`);
  }
  if (input.timezone !== undefined && !isIanaTimezone(input.timezone)) {
    throw new TypeError(`Invalid timezone: ${input.timezone}`);
  }
  const storedTimezone = (await dependencies.assembly.governanceRepositories.profiles.get(
    input.scope.userId,
  ))?.identity.timezone;

  return {
    referenceTime: input.referenceTime
      ? new Date(input.referenceTime).toISOString()
      : dependencies.assembly.now().toISOString(),
    timezone: input.timezone ?? (
      storedTimezone && isIanaTimezone(storedTimezone)
        ? storedTimezone
        : undefined
    ),
  };
}

export async function orchestrateRecall(
  dependencies: RecallOrchestratorDependencies,
  input: RecallInput,
): Promise<RecallResult> {
  assertStorageSafeExternalValue(input, "input");
  const trace = await dependencies.assembly.tracer.start({
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
      dependencies.assembly.language.resolveFromText({
        locale: input.locale,
        text: input.query,
      });
    const queryAnalysis = activeLanguageAnalysis?.analysis ??
      dependencies.assembly.language.analyzeQuery(input.query, resolvedLanguage);
    const recallPlanExecution =
      dependencies.config.retrieval?.recallPlanExecution === true;
    const {
      referenceTime: recallReferenceTime,
      timezone: recallTimezone,
    } = await resolveRecallTemporalContext(dependencies, input);
    const recallPlanInput = {
      language: dependencies.assembly.language,
      languageContext: resolvedLanguage,
      locale: resolvedLanguage.locale,
      query: input.query,
      queryAnalysis,
      referenceTime: recallReferenceTime,
      scope: input.scope,
      timezone: recallTimezone,
    };
    const deterministicPlan = buildDeterministicRecallPlan(recallPlanInput);
    const requiredOccurrenceConstraints = deterministicPlan.temporalConstraints
      .filter(({ kind }) => kind === "during");
    const planResolution: RecallPlanResolution = recallPlanExecution
      ? await resolveRecallPlan({
          assistant: dependencies.config.adapters?.recallPlanner,
          input: recallPlanInput,
        })
      : {
          assistantApplied: false,
          plan: requiredOccurrenceConstraints.length === 0
            ? buildUnplannedRecallPlan()
            : {
                ...buildUnplannedRecallPlan(),
                temporalConstraints: requiredOccurrenceConstraints,
                evidenceNeeds: ["direct", "temporal"],
                planes: ["semantic", "episodic"],
                uncertainty: "medium" as const,
              },
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
          language: dependencies.assembly.language,
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
      const analysis = dependencies.assembly.language.analyzeQuery(query, resolvedLanguage);
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
              language: dependencies.assembly.language,
              languageContext: plannedQueryLanguage.context,
              locale: plannedQueryLanguage.context.locale,
              query: context.query,
              queryAnalysis: plannedQueryLanguage.analysis,
              referenceTime: recallReferenceTime,
              scope: input.scope,
              timezone: recallTimezone,
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
        const result = await dependencies.assembly.recallEngine.recall({
          ...input,
          languageContext: queryLanguage.context,
          locale: queryLanguage.context.locale,
          query,
          queryAnalysis: queryLanguage.analysis,
          recallPlan: queryPlan,
          referenceTime: recallReferenceTime,
          timezone: recallTimezone,
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
        const followUpDecisionGenerator = dependencies.assembly.followUpDecisionGenerator;
        const outcome = await iterativeRecall({
          query: context.query,
          recall: singlePassRecall,
          merge: (primary, supplementary) =>
            mergeRecallResults(
              primary,
              supplementary,
              queryPlan,
              dependencies.assembly.language,
              context.query,
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
                entities: dependencies.assembly.language.extractEntityMentions(
                  text,
                  bridgeLanguage.context,
                ).map((mention) => mention.surface),
                tokens: dependencies.assembly.language.tokenize(
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
            dependencies.assembly.language,
            input.query,
            "decomposed_recall",
            dependencies.assembly.distinctRecallPassHeadProtection,
          ),
        options: {
          language: dependencies.assembly.language,
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
    result = applyDurableSelectionToResult({
      language: dependencies.assembly.language,
      preRankLimit: recallPlan.preRankLimit,
      preserveResult: result,
      query: input.query,
      result,
      selectedLimit: recallPlan.selectedLimit,
    });
    if (dependencies.assembly.reranker && dependencies.assembly.rerankerTarget) {
      result = input.rerank === false
        ? withRerankerTrace(
            result,
            buildSkippedRerankerTrace({
              candidateCount: getDurableRerankerCandidateCount(result),
              reason: "disabled",
              target: dependencies.assembly.rerankerTarget,
            }),
          )
        : await applyDurableRerankingToResult({
            preRankLimit: recallPlan.preRankLimit,
            query: input.query,
            language: dependencies.assembly.language,
            reranker: dependencies.assembly.reranker,
            result,
            selectedLimit: recallPlan.selectedLimit,
            target: dependencies.assembly.rerankerTarget,
          });
    }
    result = applyOccurrenceFenceToResult({
      constraints: recallPlan.temporalConstraints,
      eventOccurrenceIntervalUnresolved:
        queryAnalysis.eventOccurrenceQuery === true &&
        !recallPlan.temporalConstraints.some(({ kind }) => kind === "during"),
      language: dependencies.assembly.language,
      query: input.query,
      result,
    });
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
    if (dependencies.assembly.recallObservationsEnabled) {
      await dependencies.assembly.evolutionRuntime.handleRecall({
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

export async function diagnoseRecall(
  dependencies: RecallOrchestratorDependencies,
  input: RecallInput,
): Promise<RecallResult> {
  const internalLanguageAnalysis = readInternalRecallLanguageAnalysis(input);
  const activeLanguageAnalysis = internalLanguageAnalysis?.query === input.query
    ? internalLanguageAnalysis
    : undefined;
  const resolvedLanguage = activeLanguageAnalysis?.context ??
    dependencies.assembly.language.resolveFromText({
      locale: input.locale,
      text: input.query,
    });
  const queryAnalysis = activeLanguageAnalysis?.analysis ??
    dependencies.assembly.language.analyzeQuery(input.query, resolvedLanguage);
  const { referenceTime, timezone } =
    await resolveRecallTemporalContext(dependencies, input);
  const deterministicPlan = buildDeterministicRecallPlan({
    language: dependencies.assembly.language,
    languageContext: resolvedLanguage,
    locale: resolvedLanguage.locale,
    query: input.query,
    queryAnalysis,
    referenceTime,
    scope: input.scope,
    timezone,
  });
  const requiredOccurrenceConstraints = deterministicPlan.temporalConstraints
    .filter(({ kind }) => kind === "during");
  const recallPlan: RecallPlan = requiredOccurrenceConstraints.length === 0
    ? buildUnplannedRecallPlan()
    : {
        ...buildUnplannedRecallPlan(),
        temporalConstraints: requiredOccurrenceConstraints,
        evidenceNeeds: ["direct", "temporal"],
        planes: ["semantic", "episodic"],
        uncertainty: "medium",
      };
  const result = await dependencies.assembly.recallEngine.recall({
    ...input,
    languageContext: resolvedLanguage,
    locale: resolvedLanguage.locale,
    queryAnalysis,
    recallPlan,
    referenceTime,
    timezone,
  });

  return withRecallPlanTrace({
    executions: [{
      hops: [{
        bridgeEntities: [],
        factCount: result.facts.length,
        hop: 1,
        query: input.query,
      }],
      plan: recallPlan,
      query: input.query,
      role: "primary",
      stopReason: "single_pass_complete",
    }],
    plan: recallPlan,
    result,
    stopReason: "single_pass_complete",
    subQueries: [],
  });
}
