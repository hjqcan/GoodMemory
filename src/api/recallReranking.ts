import type { LanguageService } from "../language";
import { rebuildMemoryPacket } from "../recall/contextBuilder";
import { selectEvidence } from "../recall/evidence";
import { applyRerankingWithScores } from "../recall/reranker";
import type { Reranker } from "../recall/reranker";
import type { RecallRerankerTrace } from "../recall/retrievalTrace";
import {
  RECALL_PLAN_PRE_RANK_LIMIT,
  RECALL_PLAN_SELECTED_LIMIT,
} from "../recall/recallPlan";
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

export function mergeDurableCandidateOrder(input: {
  factIdsAfter: readonly string[];
  factIdsBefore: readonly string[];
  originalOrder: readonly string[];
}): string[] {
  const factIdsBefore = new Set(input.factIdsBefore);
  let nextFact = 0;
  const merged = input.originalOrder.map((id) => {
    if (!factIdsBefore.has(id)) {
      return id;
    }
    const replacement = input.factIdsAfter[nextFact];
    nextFact += 1;
    return replacement ?? id;
  });
  merged.push(...input.factIdsAfter.slice(nextFact));
  return merged;
}

function sourceMemoryId(fact: RecallResult["facts"][number]): string {
  const sourceId = fact.attributes?.sourceMemoryId;
  return typeof sourceId === "string" ? sourceId : fact.id;
}

function rebuildRerankedResult(input: {
  durableCandidateOrder?: string[];
  facts: RecallResult["facts"];
  language: LanguageService;
  result: RecallResult;
}): RecallResult {
  const factIds = new Set(
    input.facts.flatMap((fact) => [fact.id, sourceMemoryId(fact)]),
  );
  const selectedMemoryIds = new Set([
    ...factIds,
    ...input.result.references.map(({ id }) => id),
    ...input.result.feedback.map(({ id }) => id),
    ...input.result.episodes.map(({ id }) => id),
    ...input.result.archives.map(({ id }) => id),
  ]);
  const evidence = input.result.evidence.filter((record) => {
    const linked = [...record.linkedMemoryIds, ...record.linkedArchiveIds];
    return linked.length === 0 || linked.some((id) => selectedMemoryIds.has(id));
  });
  const evidenceIds = new Set(evidence.map(({ id }) => id));
  const evidenceLedger = input.result.evidenceLedger?.filter((entry) =>
    selectedMemoryIds.has(entry.sourceMemoryId) &&
    evidenceIds.has(entry.evidenceId),
  );
  const packet = rebuildMemoryPacket(input.result.packet, {
    profile: input.result.profile,
    preferences: input.result.preferences,
    references: input.result.references,
    facts: input.facts,
    feedback: input.result.feedback,
    archives: input.result.archives,
    evidence: selectEvidence(evidence),
    episodes: input.result.episodes,
    workingMemory: input.result.workingMemory,
    journal: input.result.journal,
    durableCandidateOrder: input.durableCandidateOrder,
    language: input.language,
    locale: input.result.metadata.locale,
    routingDecision: input.result.metadata.routingDecision,
  });
  const retrievalTrace = input.result.metadata.retrievalTrace;

  return {
    ...input.result,
    facts: input.facts,
    evidence,
    ...(evidenceLedger ? { evidenceLedger } : {}),
    packet,
    metadata: {
      ...input.result.metadata,
      tokenCount: packet.debug?.estimatedTokens ?? input.result.metadata.tokenCount,
      hits: input.result.metadata.hits.filter((hit) =>
        hit.type === "fact"
          ? factIds.has(hit.id)
          : hit.type === "evidence"
            ? evidenceIds.has(hit.id)
            : true,
      ),
      candidateTraces: input.result.metadata.candidateTraces.map((trace) => {
        if (trace.memoryType !== "fact") {
          return trace;
        }
        const selected = factIds.has(trace.memoryId);
        const { whyReturned: _whyReturned, whySuppressed: _whySuppressed, ...base } = trace;
        return selected
          ? { ...base, returned: true, whyReturned: "selected after reranking" }
          : {
              ...base,
              returned: false,
              whySuppressed: "reranker_final_selection",
            };
      }),
      verificationHints: input.result.metadata.verificationHints.filter(
        (hint) => hint.memoryType !== "fact" || factIds.has(hint.memoryId),
      ),
      ...(retrievalTrace?.fusionRuns
        ? {
            retrievalTrace: {
              ...retrievalTrace,
              fusionRuns: retrievalTrace.fusionRuns.map((run) => ({
                ...run,
                candidates: run.candidates.map((candidate) => {
                  const selected = candidate.sourceCollection !== "facts" ||
                    factIds.has(candidate.sourceMemoryId);
                  return {
                    ...candidate,
                    selected,
                    ...(!selected ? { eliminationReason: "not_selected" as const } : {}),
                  };
                }),
              })),
            },
          }
        : {}),
    },
  };
}

export async function applyFactRerankingToResult(input: {
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
  const candidatePool = result.facts.slice(0, preRankLimit);
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
  const startedAt = Date.now();
  try {
    const topK = resolveRerankerTopK({
      candidateCount: candidatePool.length,
      target,
    });
    const outcome = await applyRerankingWithScores({
      items: candidatePool,
      query,
      reranker,
      topK: topK ?? candidatePool.length,
      getText: (fact) => `${fact.content} ${fact.subject ?? ""}`,
    });
    const facts = outcome.items.slice(0, selectedLimit);
    const rankBefore = new Map(
      candidatePool.map((fact, index) => [fact.id, index + 1] as const),
    );
    const rankAfter = new Map(
      outcome.items.map((fact, index) => [fact.id, index + 1] as const),
    );
    const durableCandidateOrder = result.metadata.assistantInfluence?.rerankApplied
      ? mergeDurableCandidateOrder({
          factIdsAfter: facts.map((fact) => fact.id),
          factIdsBefore: candidatePool.map((fact) => fact.id),
          originalOrder:
            result.metadata.assistantInfluence.rerankedCandidateIds,
        })
      : undefined;
    const selectedResult = rebuildRerankedResult({
      durableCandidateOrder,
      facts,
      language: input.language,
      result,
    });
    return withRerankerTrace(
      selectedResult,
      {
        ...target,
        candidateCount: outcome.windowIds.length,
        latencyMs: Date.now() - startedAt,
        role: "reranker",
        scores: outcome.scores.map(({ id, score }) => ({
          evidenceType: "reranker",
          memoryId: id,
          rankAfter: rankAfter.get(id)!,
          rankBefore: rankBefore.get(id)!,
          score,
        })),
        status: "applied",
      },
      "reranked",
    );
  } catch (error) {
    console.error(
      "[goodmemory:reranker] reranking failed; preserving deterministic recall",
      {
        adapter: target.adapter,
        candidateCount: result.facts.length,
        error,
        model: target.model,
        provider: target.provider,
      },
    );
    return withRerankerTrace(
      rebuildRerankedResult({
        facts: candidatePool.slice(0, selectedLimit),
        language: input.language,
        result,
      }),
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
