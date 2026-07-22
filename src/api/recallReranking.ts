import type {
  EpisodeMemory,
  FactMemory,
  ReferenceMemory,
} from "../domain/records";
import type { SessionArchive } from "../domain/evolutionRecords";
import type { LanguageService } from "../language";
import { rebuildMemoryPacket } from "../recall/contextBuilder";
import {
  buildEvidenceLinkIndex,
  buildHits,
  filterLinkedEvidence,
  selectEvidence,
} from "../recall/evidence";
import { buildEvidenceLedger } from "../recall/evidenceLedger";
import { applyRerankingWithScores } from "../recall/reranker";
import type { Reranker } from "../recall/reranker";
import {
  findAmbiguousRecallRerankMemoryIds,
  getRecallRerankPool,
  recallRerankCandidateKey,
  type RecallRerankCandidate,
  type RecallRerankCollection,
  type RecallRerankPool,
} from "../recall/rerankPool";
import type { RecallRerankerTrace } from "../recall/retrievalTrace";
import {
  RECALL_PLAN_PRE_RANK_LIMIT,
  RECALL_PLAN_SELECTED_LIMIT,
} from "../recall/recallPlan";
import { evaluateVerificationHints } from "../verify/policy";
import { truncateTextToEstimatedTokens } from "../tokenEstimator";
import type { RecallResult } from "./contracts";

export interface RerankerExecutionTarget {
  adapter: "custom" | "provider";
  candidateLimit?: number;
  gateway?: string;
  model?: string;
  provider?: string;
  strategy?: "listwise" | "pointwise";
}

export function resolveRerankerTopK(input: {
  candidateCount: number;
  target: RerankerExecutionTarget;
}): number | undefined {
  if (input.target.strategy !== "listwise") {
    return undefined;
  }
  return Math.min(
    input.candidateCount,
    input.target.candidateLimit ?? input.candidateCount,
  );
}

export function sanitizeRerankerGateway(
  value: string | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    url.hash = "";
    url.password = "";
    url.search = "";
    url.username = "";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return undefined;
  }
}

export function withRerankerTrace(
  result: RecallResult,
  reranker: RecallRerankerTrace,
  policy?: "reranked" | "reranker_fallback",
): RecallResult {
  const previous = result.metadata.retrievalTrace;
  return {
    ...result,
    metadata: {
      ...result.metadata,
      ...(policy
        ? { policyApplied: [...new Set([...result.metadata.policyApplied, policy])] }
        : {}),
      retrievalTrace: previous?.schemaVersion === 2
        ? { ...previous, reranker }
        : {
            ...(previous?.fusionRuns ? { fusionRuns: previous.fusionRuns } : {}),
            reranker,
            schemaVersion: 1,
          },
    },
  };
}

export function buildSkippedRerankerTrace(input: {
  candidateCount: number;
  reason: "disabled" | "insufficient_candidates";
  target: RerankerExecutionTarget;
}): RecallRerankerTrace {
  return {
    ...input.target,
    candidateCount: input.candidateCount,
    fallbackReason: input.reason,
    latencyMs: 0,
    role: "reranker",
    scores: [],
    status: "skipped",
  };
}

function sourceMemoryId(fact: RecallResult["facts"][number]): string {
  const sourceId = fact.attributes?.sourceMemoryId;
  return typeof sourceId === "string" ? sourceId : fact.id;
}

function durableCandidateMemoryId(candidate: RecallRerankCandidate): string {
  return candidate.record.id;
}

const RERANK_CANDIDATE_MAX_TOKENS = 256;
const RERANK_QUERY_MAX_TOKENS = 512;

function durableCandidateText(candidate: RecallRerankCandidate): string {
  let canonical: string;
  if (candidate.collection === "facts") {
    const fact = candidate.record as FactMemory;
    canonical = `${fact.content} ${fact.subject ?? ""}`.trim();
  } else if (candidate.collection === "references") {
    const reference = candidate.record as ReferenceMemory;
    canonical = [reference.title, reference.description, reference.pointer]
      .filter(Boolean)
      .join(" ");
  } else if (candidate.collection === "episodes") {
    const episode = candidate.record as EpisodeMemory;
    canonical = [
      episode.summary,
      ...episode.topics,
      ...episode.keyDecisions,
      ...episode.unresolvedItems,
    ].join(" ");
  } else {
    const archive = candidate.record as SessionArchive;
    canonical = [
      archive.summary,
      ...archive.keyDecisions,
      ...archive.unresolvedItems,
    ].join(" ");
  }
  return truncateTextToEstimatedTokens(
    [candidate.retrievalText, canonical].filter(Boolean).join(" "),
    RERANK_CANDIDATE_MAX_TOKENS,
  );
}

function collectionForTrace(
  memoryType: RecallResult["metadata"]["candidateTraces"][number]["memoryType"],
): RecallRerankCollection {
  return memoryType === "archive" ? "session_archives" :
    memoryType === "episode" ? "episodes" :
    memoryType === "reference" ? "references" :
    "facts";
}

function selectRerankedCandidates(input: {
  candidates: readonly RecallRerankCandidate[];
  pool: RecallRerankPool;
  selectedLimit: number;
}): RecallRerankCandidate[] {
  const caps = {
    ...input.pool.laneCaps,
    facts: Math.min(input.pool.laneCaps.facts, input.selectedLimit),
  };
  const selectedKeys = new Set<string>();
  const selectedCounts = new Map<RecallRerankCollection, number>();
  const add = (candidate: RecallRerankCandidate) => {
    const count = selectedCounts.get(candidate.collection) ?? 0;
    if (
      selectedKeys.size >= input.selectedLimit ||
      count >= caps[candidate.collection] ||
      selectedKeys.has(candidate.key)
    ) {
      return;
    }
    selectedKeys.add(candidate.key);
    selectedCounts.set(candidate.collection, count + 1);
  };
  const requiredCollections = new Set(
    input.candidates
      .filter(({ firstStageSelected }) => firstStageSelected)
      .map(({ collection }) => collection),
  );
  for (const collection of requiredCollections) {
    const candidate = input.candidates.find(
      (item) => item.collection === collection,
    );
    if (candidate) {
      add(candidate);
    }
  }
  for (const candidate of input.candidates) {
    add(candidate);
  }
  return input.candidates.filter(({ key }) => selectedKeys.has(key));
}

function buildPreRankPool(
  candidates: readonly RecallRerankCandidate[],
  preRankLimit: number,
): RecallRerankCandidate[] {
  if (candidates.length <= preRankLimit) {
    return [...candidates];
  }
  const required = candidates
    .filter(({ firstStageSelected }) => firstStageSelected)
    .slice(0, preRankLimit);
  const requiredKeys = new Set(required.map(({ key }) => key));
  const admittedKeys = new Set([
    ...requiredKeys,
    ...candidates
      .filter(({ key }) => !requiredKeys.has(key))
      .slice(0, preRankLimit - required.length)
      .map(({ key }) => key),
  ]);
  return candidates.filter(({ key }) => admittedKeys.has(key));
}

function buildRerankerItems(candidates: readonly RecallRerankCandidate[]): Array<{
  candidate: RecallRerankCandidate;
  id: string;
}> {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const id = durableCandidateMemoryId(candidate);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return candidates.map((candidate) => {
    const memoryId = durableCandidateMemoryId(candidate);
    return {
      candidate,
      id: counts.get(memoryId) === 1 ? memoryId : candidate.key,
    };
  });
}

function buildSelectedResultPool(result: RecallResult): RecallRerankPool {
  const candidates = [
    ...result.facts.map((record) => ({
      collection: "facts" as const,
      firstStageSelected: true,
      key: recallRerankCandidateKey("facts", record.id),
      record,
    })),
    ...result.references.map((record) => ({
      collection: "references" as const,
      firstStageSelected: true,
      key: recallRerankCandidateKey("references", record.id),
      record,
    })),
    ...result.episodes.map((record) => ({
      collection: "episodes" as const,
      firstStageSelected: true,
      key: recallRerankCandidateKey("episodes", record.id),
      record,
    })),
    ...result.archives.map((record) => ({
      collection: "session_archives" as const,
      firstStageSelected: true,
      key: recallRerankCandidateKey("session_archives", record.id),
      record,
    })),
  ];
  return {
    candidates,
    claims: [...new Map(
      (result.evidenceLedger ?? []).flatMap(({ claim }) =>
        claim ? [[claim.id, claim] as const] : []
      ),
    ).values()],
    evidence: result.evidence,
    explicitEvidenceIds: [],
    includeEvidence: result.evidenceLedger !== undefined,
    laneCaps: {
      facts: RECALL_PLAN_SELECTED_LIMIT,
      references: Math.max(1, result.references.length),
      episodes: Math.max(2, result.episodes.length),
      session_archives: Math.max(1, result.archives.length),
    },
    referenceTime: new Date(0).toISOString(),
  };
}

function rebuildDurablyRerankedResult(input: {
  candidates: readonly RecallRerankCandidate[];
  language: LanguageService;
  pool: RecallRerankPool;
  query: string;
  result: RecallResult;
}): RecallResult {
  const selectedKeys = new Set(input.candidates.map(({ key }) => key));
  const poolKeys = new Set(input.pool.candidates.map(({ key }) => key));
  const facts = input.candidates
    .filter(({ collection }) => collection === "facts")
    .map(({ record }) => record as FactMemory);
  const references = input.candidates
    .filter(({ collection }) => collection === "references")
    .map(({ record }) => record as ReferenceMemory);
  const episodes = input.candidates
    .filter(({ collection }) => collection === "episodes")
    .map(({ record }) => record as EpisodeMemory);
  const archives = input.candidates
    .filter(({ collection }) => collection === "session_archives")
    .map(({ record }) => record as SessionArchive);
  const factIds = new Set(
    facts.flatMap((fact) => [fact.id, sourceMemoryId(fact)]),
  );
  const memoryIds = new Set([
    ...factIds,
    ...references.map(({ id }) => id),
    ...input.result.feedback.map(({ id }) => id),
    ...episodes.map(({ id }) => id),
  ]);
  const archiveIds = new Set(archives.map(({ id }) => id));
  const explicitEvidenceIds = new Set([
    ...input.pool.explicitEvidenceIds,
    ...input.result.feedback.flatMap(({ evidence }) => evidence ?? []),
  ]);
  const completeEvidence = filterLinkedEvidence(
    input.pool.evidence,
    memoryIds,
    archiveIds,
    explicitEvidenceIds,
  );
  const evidence = input.pool.includeEvidence
    ? completeEvidence
    : selectEvidence(completeEvidence);
  const contextEvidence = selectEvidence(completeEvidence);
  const ambiguousSourceMemoryIds = findAmbiguousRecallRerankMemoryIds(
    input.pool.candidates,
  );
  const evidenceIndex = buildEvidenceLinkIndex(
    completeEvidence,
    ambiguousSourceMemoryIds,
  );
  const selectedMemoryIds = [
    ...factIds,
    ...references.map(({ id }) => id),
    ...input.result.feedback.map(({ id }) => id),
    ...episodes.map(({ id }) => id),
    ...archives.map(({ id }) => id),
  ];
  const evidenceLedger = input.pool.includeEvidence
    ? buildEvidenceLedger({
        aggregation: input.pool.aggregation,
        ambiguousSourceMemoryIds: [...ambiguousSourceMemoryIds],
        claims: input.pool.claims,
        evidence,
        referenceTime: input.pool.referenceTime,
        selectedMemoryIds,
      })
    : undefined;
  const durableCandidateOrder = input.candidates.map(({ key }) => key);
  const packet = rebuildMemoryPacket(input.result.packet, {
    profile: input.result.profile,
    preferences: input.result.preferences,
    references,
    facts,
    feedback: input.result.feedback,
    archives,
    evidence: contextEvidence,
    episodes,
    workingMemory: input.result.workingMemory,
    journal: input.result.journal,
    durableCandidateOrder,
    language: input.language,
    locale: input.result.metadata.locale,
    routingDecision: input.result.metadata.routingDecision,
  });
  const generalizedKeys = new Set(
    input.pool.candidates
      .filter(({ firstStageScore }) => firstStageScore !== undefined)
      .map(({ key }) => key),
  );
  const semanticUnionFactIds = new Set(
    input.result.metadata.candidateTraces
      .filter(
        ({ fallback, memoryId }) =>
          fallback === "semantic_union" &&
          selectedKeys.has(recallRerankCandidateKey("facts", memoryId)),
      )
      .map(({ memoryId }) => memoryId),
  );
  const retrievalTrace = input.result.metadata.retrievalTrace;

  return {
    ...input.result,
    facts,
    references,
    episodes,
    archives,
    evidence,
    ...(evidenceLedger ? { evidenceLedger } : {}),
    packet,
    metadata: {
      ...input.result.metadata,
      tokenCount: packet.debug?.estimatedTokens ?? input.result.metadata.tokenCount,
      candidateTraces: input.result.metadata.candidateTraces.map((trace) => {
        const key = recallRerankCandidateKey(
          collectionForTrace(trace.memoryType),
          trace.memoryId,
        );
        if (!poolKeys.has(key)) {
          return trace;
        }
        const selected = selectedKeys.has(key);
        const { whyReturned: _whyReturned, whySuppressed: _whySuppressed, ...base } = trace;
        return selected
          ? { ...base, returned: true, whyReturned: "selected after reranking" }
          : {
              ...base,
              returned: false,
              whySuppressed: "reranker_final_selection",
            };
      }),
      verificationHints: evaluateVerificationHints({
        query: input.query,
        referenceTime: input.pool.referenceTime,
        evidenceIdsByMemoryId: evidenceIndex.byMemoryId,
        facts,
        references,
        episodes,
        locale: input.result.metadata.locale,
        language: input.language,
      }),
      hits: buildHits({
        profile: input.result.profile,
        preferences: input.result.preferences,
        references,
        facts,
        feedback: input.result.feedback,
        archives,
        evidence,
        episodes,
        workingMemory: input.result.workingMemory,
        journal: input.result.journal,
        evidenceIndex,
        routingDecision: input.result.metadata.routingDecision,
        semanticUnionFactIds,
        generalizedFusionFactIds: new Set(
          facts
            .filter(({ id }) =>
              generalizedKeys.has(recallRerankCandidateKey("facts", id))
            )
            .map(({ id }) => id),
        ),
        generalizedFusionReferenceIds: new Set(
          references
            .filter(({ id }) =>
              generalizedKeys.has(recallRerankCandidateKey("references", id))
            )
            .map(({ id }) => id),
        ),
        generalizedFusionEpisodeIds: new Set(
          episodes
            .filter(({ id }) =>
              generalizedKeys.has(recallRerankCandidateKey("episodes", id))
            )
            .map(({ id }) => id),
        ),
        generalizedFusionArchiveIds: new Set(
          archives
            .filter(({ id }) =>
              generalizedKeys.has(
                recallRerankCandidateKey("session_archives", id),
              )
            )
            .map(({ id }) => id),
        ),
      }),
      ...(retrievalTrace?.fusionRuns
        ? {
            retrievalTrace: {
              ...retrievalTrace,
              fusionRuns: retrievalTrace.fusionRuns.map((run) => ({
                ...run,
                candidates: run.candidates.map((candidate) => {
                  if (
                    candidate.sourceCollection !== "facts" &&
                    candidate.sourceCollection !== "references" &&
                    candidate.sourceCollection !== "episodes" &&
                    candidate.sourceCollection !== "session_archives"
                  ) {
                    return candidate;
                  }
                  const selected = selectedKeys.has(
                    recallRerankCandidateKey(
                      candidate.sourceCollection,
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
            },
          }
        : {}),
    },
  };
}

export function getDurableRerankerCandidateCount(result: RecallResult): number {
  return (getRecallRerankPool(result) ?? buildSelectedResultPool(result))
    .candidates.length;
}

export async function applyDurableRerankingToResult(input: {
  language: LanguageService;
  preRankLimit?: number;
  query: string;
  reranker: Reranker;
  result: RecallResult;
  selectedLimit?: number;
  target: RerankerExecutionTarget;
}): Promise<RecallResult> {
  const { query, reranker, result, target } = input;
  const preRankLimit = input.preRankLimit ?? RECALL_PLAN_PRE_RANK_LIMIT;
  const selectedLimit = input.selectedLimit ?? RECALL_PLAN_SELECTED_LIMIT;
  const pool = getRecallRerankPool(result) ?? buildSelectedResultPool(result);
  const candidatePool = buildPreRankPool(pool.candidates, preRankLimit);
  if (candidatePool.length < 2) {
    return withRerankerTrace(
      result,
      buildSkippedRerankerTrace({
        candidateCount: candidatePool.length,
        reason: "insufficient_candidates",
        target,
      }),
    );
  }
  const items = buildRerankerItems(candidatePool);
  const rerankerQuery = truncateTextToEstimatedTokens(
    query,
    RERANK_QUERY_MAX_TOKENS,
  );
  const startedAt = Date.now();
  try {
    const topK = resolveRerankerTopK({
      candidateCount: items.length,
      target,
    });
    const outcome = await applyRerankingWithScores({
      items,
      query: rerankerQuery,
      reranker,
      topK: topK ?? items.length,
      getText: ({ candidate }) => durableCandidateText(candidate),
    });
    const rankedCandidates = outcome.items.map(({ candidate }) => candidate);
    const selectedCandidates = selectRerankedCandidates({
      candidates: rankedCandidates,
      pool,
      selectedLimit,
    });
    const rankBefore = new Map(
      items.map(({ candidate }, index) => [candidate.key, index + 1] as const),
    );
    const rankAfter = new Map(
      outcome.items.map(({ candidate }, index) => [candidate.key, index + 1] as const),
    );
    const candidateByRerankerId = new Map(
      items.map(({ candidate, id }) => [id, candidate] as const),
    );
    const selectedResult = rebuildDurablyRerankedResult({
      candidates: selectedCandidates,
      language: input.language,
      pool,
      query,
      result,
    });
    return withRerankerTrace(
      selectedResult,
      {
        ...target,
        candidateCount: outcome.windowIds.length,
        latencyMs: Date.now() - startedAt,
        role: "reranker",
        scores: outcome.scores.flatMap(({ id, score }) => {
          const candidate = candidateByRerankerId.get(id);
          return candidate
            ? [{
                evidenceType: "reranker" as const,
                memoryId: durableCandidateMemoryId(candidate),
                rankAfter: rankAfter.get(candidate.key)!,
                rankBefore: rankBefore.get(candidate.key)!,
                score,
                sourceCollection: candidate.collection,
              }]
            : [];
        }),
        status: "applied",
      },
      "reranked",
    );
  } catch (error) {
    console.error(
      "[goodmemory:reranker] reranking failed; preserving deterministic recall",
      {
        adapter: target.adapter,
        candidateCount: candidatePool.length,
        error,
        model: target.model,
        provider: target.provider,
      },
    );
    return withRerankerTrace(
      result,
      {
        ...target,
        candidateCount: candidatePool.length,
        fallbackReason:
          target.adapter === "provider" ? "provider_error" : "adapter_error",
        latencyMs: Date.now() - startedAt,
        role: "reranker",
        scores: [],
        status: "fallback",
      },
      "reranker_fallback",
    );
  }
}
