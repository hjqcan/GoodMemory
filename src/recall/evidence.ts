import type {
  EpisodeMemory,
  FactMemory,
  FeedbackMemory,
  PreferenceMemory,
  ReferenceMemory,
  SessionJournal,
  UserProfile,
  WorkingMemorySnapshot,
} from "../domain/records";
import { isSameScope, type MemoryScope } from "../domain/scope";
import type { EvidenceRecord } from "../evidence/contracts";
import type { SessionArchive } from "../domain/evolutionRecords";
import type {
  RecallCandidateTrace,
  RecallHit,
} from "./engine";
import { FEEDBACK_RECALL_LIMIT } from "./budgets";
import type { RoutingDecision } from "./router";

export interface EvidenceLinkIndex {
  byArchiveId: Record<string, string[]>;
  byMemoryId: Record<string, string[]>;
}

const EVIDENCE_KIND_PRIORITY = {
  correction_context: 0,
  verification_result: 1,
  tool_result_excerpt: 2,
  document_excerpt: 3,
  conversation_excerpt: 4,
} as const;

function sortEvidence(evidence: EvidenceRecord[]): EvidenceRecord[] {
  return [...evidence].sort((left, right) =>
    EVIDENCE_KIND_PRIORITY[left.kind] - EVIDENCE_KIND_PRIORITY[right.kind] ||
    right.createdAt.localeCompare(left.createdAt),
  );
}

function evidenceMatchesScope(
  evidence: EvidenceRecord,
  scope: MemoryScope,
): boolean {
  return isSameScope(
    {
      userId: evidence.userId,
      tenantId: evidence.tenantId,
      workspaceId: evidence.workspaceId,
      agentId: evidence.agentId,
      sessionId: evidence.sessionId,
    },
    scope,
  );
}

export function filterLinkedEvidence(
  evidence: EvidenceRecord[],
  linkedMemoryIds: Set<string>,
  linkedArchiveIds: Set<string>,
  explicitEvidenceIds?: Set<string>,
): EvidenceRecord[] {
  return sortEvidence(evidence)
    .filter((record) => {
      if (explicitEvidenceIds?.has(record.id)) {
        return true;
      }

      const matchesMemory = record.linkedMemoryIds.some((id) => linkedMemoryIds.has(id));
      const matchesArchive = record.linkedArchiveIds.some((id) => linkedArchiveIds.has(id));

      return matchesMemory || matchesArchive;
    });
}

export function selectEvidence(evidence: EvidenceRecord[]): EvidenceRecord[] {
  const selected: EvidenceRecord[] = [];
  const seen = new Set<string>();

  for (const record of sortEvidence(evidence)) {
    const dedupeKey = `${record.kind}:${record.excerpt.trim().toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    selected.push(record);
    if (selected.length >= 3) {
      break;
    }
  }

  return selected;
}

export function collectSessionScopedEvidence(
  evidence: EvidenceRecord[],
  scope: MemoryScope,
): EvidenceRecord[] {
  if (!scope.sessionId) {
    return [];
  }

  return sortEvidence(evidence).filter((record) => evidenceMatchesScope(record, scope));
}

export function collectTraceMemoryIds(
  traces: RecallCandidateTrace[],
): { archiveIds: Set<string>; memoryIds: Set<string> } {
  const archiveIds = new Set<string>();
  const memoryIds = new Set<string>();

  for (const trace of traces) {
    if (trace.memoryType === "archive") {
      archiveIds.add(trace.memoryId);
      continue;
    }

    memoryIds.add(trace.memoryId);
  }

  return {
    archiveIds,
    memoryIds,
  };
}

function addEvidenceLinks(
  index: Record<string, string[]>,
  linkedIds: string[],
  evidenceId: string,
): void {
  for (const linkedId of linkedIds) {
    const existing = index[linkedId];
    if (!existing) {
      index[linkedId] = [evidenceId];
      continue;
    }

    if (!existing.includes(evidenceId)) {
      existing.push(evidenceId);
    }
  }
}

export function buildEvidenceLinkIndex(
  evidence: EvidenceRecord[],
  ambiguousSourceMemoryIds: ReadonlySet<string> = new Set(),
): EvidenceLinkIndex {
  const index: EvidenceLinkIndex = {
    byArchiveId: {},
    byMemoryId: {},
  };

  for (const record of evidence) {
    addEvidenceLinks(
      index.byMemoryId,
      record.linkedMemoryIds.filter((id) => !ambiguousSourceMemoryIds.has(id)),
      record.id,
    );
    addEvidenceLinks(
      index.byArchiveId,
      record.linkedArchiveIds.filter((id) => !ambiguousSourceMemoryIds.has(id)),
      record.id,
    );
  }

  return index;
}

function evidenceIdsForMemory(
  evidenceIndex: EvidenceLinkIndex,
  memoryId: string,
): string[] | undefined {
  return evidenceIndex.byMemoryId[memoryId];
}

function evidenceIdsForArchive(
  evidenceIndex: EvidenceLinkIndex,
  archiveId: string,
): string[] | undefined {
  return evidenceIndex.byArchiveId[archiveId];
}

export function attachEvidenceIdsToCandidateTraces(
  traces: RecallCandidateTrace[],
  evidenceIndex: EvidenceLinkIndex,
): RecallCandidateTrace[] {
  return traces.map((trace) => {
    const evidenceIds =
      trace.memoryType === "archive"
        ? evidenceIdsForArchive(evidenceIndex, trace.memoryId)
        : evidenceIdsForMemory(evidenceIndex, trace.memoryId);

    return evidenceIds ? { ...trace, evidenceIds } : trace;
  });
}

export function buildHits(input: {
  profile: UserProfile | null;
  preferences: PreferenceMemory[];
  references: ReferenceMemory[];
  facts: FactMemory[];
  feedback: FeedbackMemory[];
  archives: SessionArchive[];
  evidence: EvidenceRecord[];
  episodes: EpisodeMemory[];
  workingMemory: WorkingMemorySnapshot | null;
  journal: SessionJournal | null;
  evidenceIndex: EvidenceLinkIndex;
  routingDecision: RoutingDecision;
  // Facts admitted by the semantic candidate-generation union, so their hits
  // carry an attributable reason instead of the generic scope_match.
  semanticUnionFactIds?: ReadonlySet<string>;
  generalizedFusionFactIds?: ReadonlySet<string>;
  generalizedFusionReferenceIds?: ReadonlySet<string>;
  generalizedFusionArchiveIds?: ReadonlySet<string>;
  generalizedFusionEpisodeIds?: ReadonlySet<string>;
}): RecallHit[] {
  const hits: RecallHit[] = [];

  for (const source of input.routingDecision.sourcePriorities) {
    if (source === "profile") {
      if (input.profile) {
        hits.push({
          id: input.profile.userId,
          type: "profile",
          reason: "profile_available",
        });
      }

      for (const preference of input.preferences.slice(0, 3)) {
        hits.push({
          id: preference.id,
          type: "preference",
          reason: "semantic_preference",
          sourceMethod: preference.source.method,
        });
      }

      for (const reference of input.references.slice(0, 3)) {
        hits.push({
          id: reference.id,
          type: "reference",
          reason: input.generalizedFusionReferenceIds?.has(reference.id)
            ? "generalized_fusion"
            : "semantic_reference",
          sourceMethod: reference.source.method,
          evidenceIds: evidenceIdsForMemory(input.evidenceIndex, reference.id),
        });
      }
    }

    if (source === "fact") {
      for (const fact of input.facts.slice(0, 3)) {
        hits.push({
          id: fact.id,
          type: "fact",
          reason: input.generalizedFusionFactIds?.has(fact.id)
            ? "generalized_fusion"
            : input.semanticUnionFactIds?.has(fact.id)
              ? "semantic_union"
              : "scope_match",
          sourceMethod: fact.source.method,
          evidenceIds: evidenceIdsForMemory(input.evidenceIndex, fact.id),
        });
      }
    }

    if (source === "feedback") {
      for (const feedback of input.feedback.slice(0, FEEDBACK_RECALL_LIMIT)) {
        hits.push({
          id: feedback.id,
          type: "feedback",
          reason: "scope_match",
          sourceMethod: feedback.source.method,
          evidenceIds:
            feedback.evidence && feedback.evidence.length > 0
              ? feedback.evidence
              : evidenceIdsForMemory(input.evidenceIndex, feedback.id),
        });
      }
    }

    if (source === "session_archive") {
      for (const archive of input.archives.slice(0, 1)) {
        hits.push({
          id: archive.id,
          type: "session_archive",
          reason: input.generalizedFusionArchiveIds?.has(archive.id)
            ? "generalized_fusion"
            : "continuation_context",
          evidenceIds: evidenceIdsForArchive(input.evidenceIndex, archive.id),
        });
      }
    }

    if (source === "episode") {
      for (const episode of input.episodes.slice(0, 2)) {
        hits.push({
          id: episode.id,
          type: "episode",
          reason: input.generalizedFusionEpisodeIds?.has(episode.id)
            ? "generalized_fusion"
            : "continuation_context",
          evidenceIds: evidenceIdsForMemory(input.evidenceIndex, episode.id),
        });
      }
    }

    if (source === "working_memory" && input.workingMemory) {
      hits.push({
        id: input.workingMemory.sessionId,
        type: "working_memory",
        reason: "runtime_continuity",
      });
    }

    if (source === "session_journal" && input.journal) {
      hits.push({
        id: input.journal.sessionId,
        type: "session_journal",
        reason: "runtime_continuity",
      });
    }

    if (source === "evidence") {
      for (const evidenceRecord of input.evidence.slice(0, 3)) {
        hits.push({
          id: evidenceRecord.id,
          type: "evidence",
          reason: "linked_evidence",
          sourceMethod: evidenceRecord.source.method,
          evidenceIds: [evidenceRecord.id],
        });
      }
    }
  }

  return hits;
}
