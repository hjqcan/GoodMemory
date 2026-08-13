import type {
  MemoryCandidate,
  MemoryExtractionResult,
  MemoryExtractionStrategy,
} from "./candidates";
import { mergeExtractionSources } from "./classification";

function canonicalizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return [...value].sort();
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalizeMetadata(nested)]),
    );
  }

  return value;
}

function buildCandidateMergeKey(candidate: MemoryCandidate): string {
  return JSON.stringify({
    content: candidate.content.trim().toLowerCase(),
    disposition: canonicalizeMetadata(candidate.disposition ?? null),
    durableTarget: canonicalizeMetadata(candidate.durableTarget ?? null),
    explicitness: candidate.explicitness,
    kindHint: candidate.kindHint,
    metadata: canonicalizeMetadata(candidate.metadata ?? null),
    sourceMessageIndex: candidate.sourceMessageIndex,
    sourceRole: candidate.sourceRole,
  });
}

function ensureUniqueCandidateId(
  candidate: MemoryCandidate,
  usedIds: Set<string>,
): MemoryCandidate {
  if (!usedIds.has(candidate.id)) {
    return candidate;
  }

  let suffix = 1;
  let nextId = `llm-${candidate.id}-${suffix}`;
  while (usedIds.has(nextId)) {
    suffix += 1;
    nextId = `llm-${candidate.id}-${suffix}`;
  }

  return {
    ...candidate,
    id: nextId,
  };
}

function mergeUniqueValues<TValue>(
  left: TValue[] | undefined,
  right: TValue[] | undefined,
): TValue[] | undefined {
  const values = [...(left ?? []), ...(right ?? [])];

  return values.length > 0 ? [...new Set(values)] : undefined;
}

export function annotateExtractionResult(
  result: MemoryExtractionResult,
  source: MemoryExtractionStrategy,
): MemoryExtractionResult {
  return {
    ...result,
    candidates: result.candidates.map((candidate) => ({
      ...candidate,
      extractionSources: mergeExtractionSources(candidate.extractionSources, [source]),
    })),
  };
}

export function mergeExtractionResults(
  baseline: MemoryExtractionResult,
  assisted: MemoryExtractionResult,
): MemoryExtractionResult {
  const candidates = [...baseline.candidates];
  const usedIds = new Set(candidates.map((candidate) => candidate.id));
  const signatureToIndex = new Map(
    candidates.map((candidate, index) => [buildCandidateMergeKey(candidate), index] as const),
  );

  for (const candidate of assisted.candidates) {
    const signature = buildCandidateMergeKey(candidate);
    const existingIndex = signatureToIndex.get(signature);
    if (existingIndex !== undefined) {
      const existing = candidates[existingIndex]!;
      candidates[existingIndex] = {
        ...existing,
        annotation: existing.annotation ?? candidate.annotation,
        extractorIds: mergeUniqueValues(existing.extractorIds, candidate.extractorIds),
        extractionSources: mergeExtractionSources(
          existing.extractionSources,
          candidate.extractionSources,
        ),
        profileId: existing.profileId ?? candidate.profileId,
        presetId: existing.presetId ?? candidate.presetId,
        ruleIds: mergeUniqueValues(existing.ruleIds, candidate.ruleIds),
      };
      continue;
    }

    const uniqueCandidate = ensureUniqueCandidateId(candidate, usedIds);
    usedIds.add(uniqueCandidate.id);
    signatureToIndex.set(signature, candidates.length);
    candidates.push(uniqueCandidate);
  }

  return {
    candidates,
    ignoredMessageCount: Math.max(
      baseline.ignoredMessageCount,
      assisted.ignoredMessageCount,
    ),
  };
}

export function dedupeExtractionResult(
  result: MemoryExtractionResult,
): MemoryExtractionResult {
  return mergeExtractionResults(
    {
      candidates: [],
      ignoredMessageCount: result.ignoredMessageCount,
    },
    result,
  );
}
