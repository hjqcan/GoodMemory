import type {
  EpisodeMemory,
  FactMemory,
  FeedbackMemory,
  PreferenceMemory,
  ReferenceMemory,
  UserProfile,
} from "../domain/records";
import type { SessionArchive } from "../domain/evolutionRecords";
import { isGeneralizedCandidateTraceEligible } from "./generalizedAdmissions";
import type { GeneralizedFusionCandidate } from "./generalizedFusion";
import type { RecallCandidateTrace } from "./contracts";
import type {
  ClaimProjection,
  RecallIndexDocument,
} from "./projections/contracts";
import {
  normalizeRecallRerankText,
  recallRerankCandidateKey,
} from "./rerankPool";
import type {
  RecallRerankCandidate,
  RecallRerankCollection,
} from "./rerankPool";
import type { RecallRetrievalTrace } from "./retrievalTrace";

export interface DurableRecallSelection {
  archives: SessionArchive[];
  episodes: EpisodeMemory[];
  facts: FactMemory[];
  references: ReferenceMemory[];
}

export function canonicalFactMemoryId(fact: FactMemory): string {
  const sourceMemoryId = fact.attributes?.sourceMemoryId;
  return typeof sourceMemoryId === "string" ? sourceMemoryId : fact.id;
}

function durableSelectionKeys(selection: DurableRecallSelection): Set<string> {
  return new Set([
    ...selection.facts.map(({ id }) => recallRerankCandidateKey("facts", id)),
    ...selection.references.map(({ id }) =>
      recallRerankCandidateKey("references", id)
    ),
    ...selection.episodes.map(({ id }) =>
      recallRerankCandidateKey("episodes", id)
    ),
    ...selection.archives.map(({ id }) =>
      recallRerankCandidateKey("session_archives", id)
    ),
  ]);
}

export function reconcileFusionTraceSelection(
  retrievalTrace: RecallRetrievalTrace | undefined,
  selection: DurableRecallSelection,
  additional: {
    feedback: FeedbackMemory[];
    preferences: PreferenceMemory[];
    profile: UserProfile | null;
  },
): RecallRetrievalTrace | undefined {
  if (!retrievalTrace?.fusionRuns) {
    return retrievalTrace;
  }
  const selectedKeys = durableSelectionKeys(selection);
  for (const preference of additional.preferences) {
    selectedKeys.add(`preferences:${preference.id}`);
  }
  for (const feedback of additional.feedback) {
    selectedKeys.add(`feedback:${feedback.id}`);
  }
  if (additional.profile) {
    selectedKeys.add(`profiles:${additional.profile.userId}`);
  }
  return {
    ...retrievalTrace,
    fusionRuns: retrievalTrace.fusionRuns.map((run) => ({
      ...run,
      candidates: run.candidates.map((candidate) => {
        const selected = selectedKeys.has(
          recallRerankCandidateKey(
            candidate.sourceCollection as RecallRerankCollection,
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
  };
}

export function collectUnseenFusionRecords<T extends { id: string }>(input: {
  candidates: readonly GeneralizedFusionCandidate[];
  collection: RecallRerankCollection;
  evaluatedIds: ReadonlySet<string>;
  records: readonly T[];
  suppressedIds: ReadonlySet<string>;
  traces: readonly RecallCandidateTrace[];
}): T[] {
  const recordsById = new Map(input.records.map((record) => [record.id, record]));
  const tracesById = new Map(input.traces.map((trace) => [trace.memoryId, trace]));
  return input.candidates.flatMap((candidate) => {
    if (
      candidate.sourceCollection !== input.collection ||
      input.evaluatedIds.has(candidate.sourceMemoryId) ||
      input.suppressedIds.has(recallRerankCandidateKey(
        input.collection,
        candidate.sourceMemoryId,
      ))
    ) {
      return [];
    }
    const record = recordsById.get(candidate.sourceMemoryId);
    return record &&
        isGeneralizedCandidateTraceEligible(
          tracesById.get(candidate.sourceMemoryId),
        )
      ? [record]
      : [];
  });
}

export function buildRecallRerankCandidates(input: {
  candidates: readonly GeneralizedFusionCandidate[];
  claims: readonly ClaimProjection[];
  documents: readonly RecallIndexDocument[];
  pool: DurableRecallSelection;
  selected: DurableRecallSelection;
}): RecallRerankCandidate[] {
  const recordsByCollection: Record<
    RecallRerankCollection,
    Map<string, RecallRerankCandidate["record"]>
  > = {
    facts: new Map(input.pool.facts.map((record) => [record.id, record])),
    references: new Map(
      input.pool.references.map((record) => [record.id, record]),
    ),
    episodes: new Map(input.pool.episodes.map((record) => [record.id, record])),
    session_archives: new Map(
      input.pool.archives.map((record) => [record.id, record]),
    ),
  };
  const retrievalTextByKey = new Map<string, string>();
  const addRetrievalText = (
    key: string,
    values: readonly (string | undefined)[],
  ) => {
    const text = normalizeRecallRerankText([
      retrievalTextByKey.get(key),
      ...values,
    ]);
    if (text) {
      retrievalTextByKey.set(key, text);
    }
  };
  for (const document of input.documents) {
    if (!(document.sourceCollection in recordsByCollection)) {
      continue;
    }
    addRetrievalText(
      recallRerankCandidateKey(
        document.sourceCollection as RecallRerankCollection,
        document.sourceMemoryId,
      ),
      [document.text],
    );
  }
  for (const claim of input.claims) {
    addRetrievalText(
      recallRerankCandidateKey("facts", claim.sourceMemoryId),
      [
        claim.contextualDescriptor,
        claim.predicateKey,
        claim.objectText,
        claim.validFrom,
        claim.validUntil,
      ],
    );
  }
  const selectedKeys = durableSelectionKeys(input.selected);
  const result: RecallRerankCandidate[] = [];
  const added = new Set<string>();
  for (const candidate of input.candidates) {
    if (!(candidate.sourceCollection in recordsByCollection)) {
      continue;
    }
    const collection = candidate.sourceCollection as RecallRerankCollection;
    const record = recordsByCollection[collection].get(candidate.sourceMemoryId);
    const key = recallRerankCandidateKey(collection, candidate.sourceMemoryId);
    if (!record || added.has(key)) {
      continue;
    }
    result.push({
      collection,
      firstStageScore: candidate.score,
      firstStageSelected: selectedKeys.has(key),
      key,
      record,
      retrievalText: retrievalTextByKey.get(key),
    });
    added.add(key);
  }
  for (const [collection, records] of [
    ["facts", input.selected.facts],
    ["references", input.selected.references],
    ["episodes", input.selected.episodes],
    ["session_archives", input.selected.archives],
  ] as const) {
    for (const record of records) {
      const key = recallRerankCandidateKey(collection, record.id);
      if (added.has(key)) {
        continue;
      }
      result.push({
        collection,
        firstStageSelected: true,
        key,
        record,
        retrievalText: retrievalTextByKey.get(key),
      });
      added.add(key);
    }
  }
  return result;
}
