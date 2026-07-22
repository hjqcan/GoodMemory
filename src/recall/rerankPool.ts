import type { SessionArchive } from "../domain/evolutionRecords";
import type {
  EpisodeMemory,
  FactMemory,
  ReferenceMemory,
} from "../domain/records";
import type { EvidenceRecord } from "../evidence/contracts";
import { truncateTextToEstimatedTokens } from "../tokenEstimator";
import type { ClaimProjection } from "./projections/contracts";
import type { RecallAggregation } from "./recallPlan";

export type RecallRerankCollection =
  | "episodes"
  | "facts"
  | "references"
  | "session_archives";

export type RecallRerankRecord =
  | EpisodeMemory
  | FactMemory
  | ReferenceMemory
  | SessionArchive;

export interface RecallRerankCandidate {
  collection: RecallRerankCollection;
  firstStageScore?: number;
  firstStageSelected: boolean;
  key: string;
  record: RecallRerankRecord;
  retrievalText?: string;
}

export interface RecallRerankPool {
  aggregation?: RecallAggregation;
  candidates: RecallRerankCandidate[];
  claims: ClaimProjection[];
  evidence: EvidenceRecord[];
  explicitEvidenceIds: string[];
  includeEvidence: boolean;
  laneCaps: Record<RecallRerankCollection, number>;
  referenceTime: string;
}

const recallRerankPools = new WeakMap<object, RecallRerankPool>();

export function recallRerankCandidateKey(
  collection: RecallRerankCollection,
  memoryId: string,
): string {
  return `${collection}:${memoryId}`;
}

export function matchesRecallRerankCandidateId(
  candidateId: string,
  collection: RecallRerankCollection,
  memoryId: string,
): boolean {
  return candidateId === recallRerankCandidateKey(collection, memoryId);
}

export function setRecallRerankPool<T extends object>(
  result: T,
  pool: RecallRerankPool,
): T {
  recallRerankPools.set(result, pool);
  return result;
}

export function getRecallRerankPool(
  result: object,
): RecallRerankPool | undefined {
  return recallRerankPools.get(result);
}

export function findAmbiguousRecallRerankMemoryIds(
  candidates: readonly RecallRerankCandidate[],
): Set<string> {
  const collectionsById = new Map<string, Set<RecallRerankCollection>>();
  for (const candidate of candidates) {
    const id = candidate.record.id;
    const collections = collectionsById.get(id) ?? new Set();
    collections.add(candidate.collection);
    collectionsById.set(id, collections);
  }
  return new Set(
    [...collectionsById]
      .filter(([, collections]) => collections.size > 1)
      .map(([id]) => id),
  );
}

export function copyRecallRerankPool<T extends object>(
  source: object,
  target: T,
): T {
  const pool = getRecallRerankPool(source);
  if (pool) {
    setRecallRerankPool(target, pool);
  }
  return target;
}

const RECALL_PASS_RRF_K = 60;
const RECALL_RERANK_RETRIEVAL_TEXT_MAX_TOKENS = 192;

export function normalizeRecallRerankText(
  values: readonly (string | undefined)[],
): string | undefined {
  const text = [...new Set(
    values.map((value) => value?.trim()).filter(
      (value): value is string => Boolean(value),
    ),
  )].join(" ");
  return text
    ? truncateTextToEstimatedTokens(
        text,
        RECALL_RERANK_RETRIEVAL_TEXT_MAX_TOKENS,
      )
    : undefined;
}

export function mergeRecallRerankPools<T extends object>(input: {
  preRankLimit: number;
  primaryReserveLimit: number;
  results: readonly object[];
  target: T;
}): T {
  const pools = input.results.flatMap((result) => {
    const pool = getRecallRerankPool(result);
    return pool ? [pool] : [];
  });
  if (pools.length === 0) {
    return input.target;
  }

  const fused = new Map<string, {
    candidate: RecallRerankCandidate;
    firstSeen: number;
    score: number;
  }>();
  let firstSeen = 0;
  for (const pool of pools) {
    for (const [index, candidate] of pool.candidates.entries()) {
      const existing = fused.get(candidate.key);
      const score = 1 / (RECALL_PASS_RRF_K + index + 1);
      if (existing) {
        existing.score += score;
        existing.candidate = {
          ...existing.candidate,
          firstStageSelected:
            existing.candidate.firstStageSelected || candidate.firstStageSelected,
          retrievalText: normalizeRecallRerankText([
            existing.candidate.retrievalText,
            candidate.retrievalText,
          ]),
        };
        continue;
      }
      fused.set(candidate.key, {
        candidate,
        firstSeen,
        score,
      });
      firstSeen += 1;
    }
  }
  const rankedCandidates = [...fused.values()]
    .sort(
      (left, right) =>
        right.score - left.score || left.firstSeen - right.firstSeen,
    )
    .map(({ candidate }) => candidate);
  const primarySelected = pools[0]!.candidates.filter(
    ({ firstStageSelected }) => firstStageSelected,
  );
  const collectionHeads = [...new Map(
    primarySelected.map((candidate) => [candidate.collection, candidate]),
  ).values()];
  const headKeys = new Set(collectionHeads.map(({ key }) => key));
  const reserveLimit = Math.min(
    input.preRankLimit,
    Math.max(input.primaryReserveLimit, collectionHeads.length),
  );
  const requiredPrimaryKeys = new Set(
    [
      ...collectionHeads,
      ...primarySelected.filter(({ key }) => !headKeys.has(key)),
    ]
      .slice(0, reserveLimit)
      .map(({ key }) => key),
  );
  const admittedKeys = new Set([
    ...requiredPrimaryKeys,
    ...rankedCandidates
      .filter(({ key }) => !requiredPrimaryKeys.has(key))
      .slice(0, input.preRankLimit - requiredPrimaryKeys.size)
      .map(({ key }) => key),
  ]);
  const candidates = rankedCandidates.filter(({ key }) => admittedKeys.has(key));
  const first = pools[0]!;
  return setRecallRerankPool(input.target, {
    aggregation: first.aggregation,
    candidates,
    claims: [...new Map(
      pools.flatMap(({ claims }) => claims).map((claim) => [claim.id, claim]),
    ).values()],
    evidence: [...new Map(
      pools.flatMap(({ evidence }) => evidence).map((record) => [record.id, record]),
    ).values()],
    explicitEvidenceIds: [...new Set(
      pools.flatMap(({ explicitEvidenceIds }) => explicitEvidenceIds),
    )],
    includeEvidence: pools.some(({ includeEvidence }) => includeEvidence),
    laneCaps: {
      episodes: Math.max(...pools.map(({ laneCaps }) => laneCaps.episodes)),
      facts: Math.max(...pools.map(({ laneCaps }) => laneCaps.facts)),
      references: Math.max(...pools.map(({ laneCaps }) => laneCaps.references)),
      session_archives: Math.max(
        ...pools.map(({ laneCaps }) => laneCaps.session_archives),
      ),
    },
    referenceTime: first.referenceTime,
  });
}
