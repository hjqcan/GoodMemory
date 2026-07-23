// Memory administration operations (export / delete-all) extracted from the
// createGoodMemory composition root. These are self-contained data operations
// over the governance repositories + stores, so they live here as pure
// functions that take their dependencies explicitly; GoodMemoryImpl delegates
// to them. Keeps the composition root focused on wiring rather than
// per-operation orchestration.
import type { ArtifactSpillRecord } from "../domain/records";
import {
  EVIDENCE_COLLECTION,
  SOURCE_MESSAGES_COLLECTION,
} from "../evidence/contracts";
import type {
  EvidenceRecord,
  SourceMessageRecord,
} from "../evidence/contracts";
import {
  EXPERIENCES_COLLECTION,
  LEARNING_PROPOSALS_COLLECTION,
  PROMOTION_RECORDS_COLLECTION,
  SESSION_ARCHIVES_COLLECTION,
} from "../evolution/contracts";
import { buildMarkdownArtifacts } from "../governance/markdownArtifacts";
import type { LanguageService } from "../language";
import type { GoodMemoryTracer } from "../observability/tracer";
import {
  CLAIM_PROJECTIONS_COLLECTION,
  CLAIM_PROJECTION_STATUS_COLLECTION,
  ENTITIES_COLLECTION,
  PROJECTION_MANIFESTS_COLLECTION,
  PROJECTION_REPAIRS_COLLECTION,
  RECALL_DOCUMENTS_COLLECTION,
  SCOPE_CATALOG_COLLECTION,
} from "../recall/projections/contracts";
import type {
  EntityAdjacencyProjection,
  RecallIndexDocument,
} from "../recall/projections/contracts";
import {
  ARTIFACT_SPILL_COLLECTION,
  ARTIFACT_SPILL_PAYLOAD_COLLECTION,
} from "../runtime/spillover";
import type { ArtifactSpillPayloadRecord } from "../runtime/spillover";
import type {
  DocumentStore,
  SessionStore,
  StorageFilter,
} from "../storage/contracts";
import type {
  GovernanceRepositoryPort,
  GovernanceVectorPort,
} from "../storage/ports";
import { deleteVectorForCollection } from "./governance";
import type {
  DeleteAllMemoryInput,
  DeleteAllMemoryResult,
  ExportMemoryInput,
  ExportMemoryResult,
  ForgetInput,
} from "./contracts";

export type ScopeBoundRecord = {
  id?: string;
  userId: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
};

export interface MemoryAdminDeps {
  tracer: GoodMemoryTracer;
  governanceRepositories: GovernanceRepositoryPort;
  governanceVectors: GovernanceVectorPort | null;
  sessionStore: SessionStore;
  documentStore: DocumentStore;
}

type ExportMemoryDeps = MemoryAdminDeps & {
  language: LanguageService;
};

export function recordMatchesScope(
  record: ScopeBoundRecord,
  scope: ForgetInput["scope"],
): boolean {
  if (record.userId !== scope.userId) {
    return false;
  }

  const optionalKeys: Array<keyof ForgetInput["scope"]> = [
    "tenantId",
    "workspaceId",
    "agentId",
    "sessionId",
  ];

  return optionalKeys.every((key) => {
    const expected = scope[key];
    if (expected === undefined) {
      return true;
    }

    return record[key] === expected;
  });
}

export function isPureUserScope(scope: ForgetInput["scope"]): boolean {
  return (
    scope.tenantId === undefined &&
    scope.workspaceId === undefined &&
    scope.agentId === undefined &&
    scope.sessionId === undefined
  );
}

async function deleteDocuments(
  store: DocumentStore,
  collection: string,
  documents: readonly { id: string }[],
): Promise<void> {
  for (const document of documents) {
    await store.delete(collection, document.id);
  }
}

function scopeFilter(scope: ForgetInput["scope"]): StorageFilter {
  return Object.fromEntries(
    Object.entries(scope).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

export async function deleteMemorySupportingState(
  deps: Pick<MemoryAdminDeps, "documentStore">,
  input: {
    collection: string;
    memoryId: string;
    scope: ForgetInput["scope"];
  },
): Promise<void> {
  const evidenceInScope = (
    await deps.documentStore.query<EvidenceRecord>(
      EVIDENCE_COLLECTION,
      scopeFilter(input.scope),
    )
  ).filter((record) => recordMatchesScope(record, input.scope));
  const affectedEvidence = evidenceInScope.filter(
    (record) =>
      (input.collection === EVIDENCE_COLLECTION && record.id === input.memoryId) ||
      record.linkedMemoryIds.includes(input.memoryId),
  );
  const sourceRecordIds = new Set(
    affectedEvidence.flatMap((record) => record.sourceRecordIds ?? []),
  );
  const legacySourceMessageIds = new Set(
    affectedEvidence.flatMap((record) =>
      (record.sourceRecordIds?.length ?? 0) === 0 ? record.sourceMessageIds : []
    ),
  );

  for (const evidence of affectedEvidence) {
    if (input.collection === EVIDENCE_COLLECTION && evidence.id === input.memoryId) {
      continue;
    }
    const linkedMemoryIds = evidence.linkedMemoryIds.filter(
      (memoryId) => memoryId !== input.memoryId,
    );
    if (
      linkedMemoryIds.length === 0 && evidence.linkedArchiveIds.length === 0
    ) {
      await deps.documentStore.delete(EVIDENCE_COLLECTION, evidence.id);
    } else {
      await deps.documentStore.set(EVIDENCE_COLLECTION, evidence.id, {
        ...evidence,
        linkedMemoryIds,
      });
    }
  }

  if (sourceRecordIds.size > 0 || legacySourceMessageIds.size > 0) {
    const remainingEvidence = (
      await deps.documentStore.query<EvidenceRecord>(
        EVIDENCE_COLLECTION,
        scopeFilter(input.scope),
      )
    ).filter((record) =>
      recordMatchesScope(record, input.scope) &&
      !(input.collection === EVIDENCE_COLLECTION && record.id === input.memoryId)
    );
    const retainedSourceRecordIds = new Set(
      remainingEvidence.flatMap((record) => record.sourceRecordIds ?? []),
    );
    const retainedLegacySourceMessageIds = new Set(
      remainingEvidence.flatMap((record) =>
        (record.sourceRecordIds?.length ?? 0) === 0 ? record.sourceMessageIds : []
      ),
    );
    const rawMessages = (
      await deps.documentStore.query<SourceMessageRecord>(
        SOURCE_MESSAGES_COLLECTION,
        scopeFilter(input.scope),
      )
    ).filter((record) => recordMatchesScope(record, input.scope));
    await deleteDocuments(
      deps.documentStore,
      SOURCE_MESSAGES_COLLECTION,
      rawMessages.filter((record) => {
        const sourceId = record.sourceMessageId ?? record.id;
        const affected = sourceRecordIds.has(record.id) ||
          legacySourceMessageIds.has(sourceId);
        const retained = retainedSourceRecordIds.has(record.id) ||
          retainedLegacySourceMessageIds.has(sourceId);
        return affected && !retained;
      }),
    );
  }
}

export async function exportMemoryOperation(
  deps: ExportMemoryDeps,
  input: ExportMemoryInput,
): Promise<ExportMemoryResult> {
  const trace = await deps.tracer.start({
    name: "memory.export",
    scope: input.scope,
    attributes: {
      includeRuntime: Boolean(input.includeRuntime),
    },
  });

  try {
    const [
      profile,
      preferences,
      references,
      facts,
      feedback,
      episodes,
      archives,
      evidence,
      sourceMessages,
      experiences,
      proposals,
      promotions,
      workingMemory,
      journal,
      allSpills,
    ] = await Promise.all([
      deps.governanceRepositories.profiles.get(input.scope.userId),
      deps.governanceRepositories.preferences.listByScope(input.scope),
      deps.governanceRepositories.references.listByScope(input.scope),
      deps.governanceRepositories.facts.listByScope(input.scope),
      deps.governanceRepositories.feedback.listByScope(input.scope),
      deps.governanceRepositories.episodes.listByScope(input.scope),
      deps.governanceRepositories.archives.listByScope(input.scope),
      deps.governanceRepositories.evidence.listByScope(input.scope),
      deps.documentStore.query<SourceMessageRecord>(
        SOURCE_MESSAGES_COLLECTION,
        scopeFilter(input.scope),
      ),
      deps.governanceRepositories.experiences.listByScope(input.scope),
      deps.governanceRepositories.proposals.listByScope(input.scope),
      deps.governanceRepositories.promotions.listByScope(input.scope),
      input.includeRuntime && input.scope.sessionId
        ? deps.sessionStore.getWorkingMemory(input.scope)
        : Promise.resolve(null),
      input.includeRuntime && input.scope.sessionId
        ? deps.sessionStore.getJournal(input.scope)
        : Promise.resolve(null),
      input.includeRuntime
        ? deps.documentStore.query<ArtifactSpillRecord>(ARTIFACT_SPILL_COLLECTION)
        : Promise.resolve([]),
    ]);

    const spills = allSpills.filter((record) =>
      recordMatchesScope(record.scope, input.scope),
    );

    const durable = {
      profile: isPureUserScope(input.scope) ? profile : null,
      preferences: preferences.filter((record) => recordMatchesScope(record, input.scope)),
      references: references.filter((record) => recordMatchesScope(record, input.scope)),
      facts: facts.filter((record) => recordMatchesScope(record, input.scope)),
      feedback: feedback.filter((record) => recordMatchesScope(record, input.scope)),
      episodes: episodes.filter((record) => recordMatchesScope(record, input.scope)),
      archives: archives.filter((record) => recordMatchesScope(record, input.scope)),
      evidence: evidence.filter((record) => recordMatchesScope(record, input.scope)),
      sourceMessages: sourceMessages.filter((record) =>
        recordMatchesScope(record, input.scope)
      ),
      experiences: experiences.filter((record) => recordMatchesScope(record, input.scope)),
      proposals: proposals.filter((record) => recordMatchesScope(record, input.scope)),
      promotions: promotions.filter((record) => recordMatchesScope(record, input.scope)),
    };
    const runtime = input.includeRuntime
      ? {
          workingMemory,
          journal,
          spills,
        }
      : undefined;
    const languageMessages = durable.sourceMessages.length > 0
      ? durable.sourceMessages.map(({ content, role }) => ({ content, role }))
      : [
          ...durable.facts.map(({ content }) => ({ content, role: "user" })),
          ...durable.references.map(({ pointer, title }) => ({
            content: `${title} ${pointer}`,
            role: "user",
          })),
          ...durable.feedback.map(({ rule }) => ({ content: rule, role: "user" })),
          ...durable.episodes.map(({ summary }) => ({ content: summary, role: "user" })),
          ...durable.archives.map(({ summary }) => ({ content: summary, role: "user" })),
          ...durable.evidence.map(({ excerpt }) => ({ content: excerpt, role: "user" })),
          ...(runtime?.workingMemory
            ? [
                runtime.workingMemory.currentGoal,
                ...runtime.workingMemory.openLoops,
                ...(runtime.workingMemory.temporaryDecisions ?? []),
              ].filter((content): content is string => Boolean(content)).map((content) => ({
                content,
                role: "user",
              }))
            : []),
          ...(runtime?.journal
            ? [runtime.journal.currentState, ...runtime.journal.worklog]
                .filter((content): content is string => Boolean(content))
                .map((content) => ({ content, role: "user" }))
            : []),
        ];
    const languageContext = deps.language.resolveFromMessages({
      ...(input.locale ? { locale: input.locale } : {}),
      messages: languageMessages,
    });

    await trace.succeeded({
      attributes: {
        factCount: durable.facts.length,
        feedbackCount: durable.feedback.length,
        preferenceCount: durable.preferences.length,
        referenceCount: durable.references.length,
      },
    });

    return {
      artifacts: buildMarkdownArtifacts({
        language: deps.language,
        languageContext,
        scope: input.scope,
        durable,
        runtime,
      }),
      scope: input.scope,
      exportedAt: new Date().toISOString(),
      ...(trace.traceId ? { traceId: trace.traceId } : {}),
      durable,
      runtime,
    };
  } catch (error) {
    await trace.failed({ error });
    throw error;
  }
}

export async function deleteAllMemoryOperation(
  deps: MemoryAdminDeps,
  input: DeleteAllMemoryInput,
): Promise<DeleteAllMemoryResult> {
  const trace = await deps.tracer.start({
    name: "memory.delete_all",
    scope: input.scope,
    attributes: {
      includeRuntime: input.includeRuntime !== false,
    },
  });
  const deleted: DeleteAllMemoryResult["deleted"] = {
    profiles: 0,
    preferences: 0,
    references: 0,
    facts: 0,
    feedback: 0,
    episodes: 0,
    archives: 0,
    evidence: 0,
    experiences: 0,
    proposals: 0,
    promotions: 0,
    workingMemory: 0,
    journal: 0,
    artifactSpills: 0,
  };

  try {
    const [
      profile,
      allPreferences,
      allReferences,
      allFacts,
      allFeedback,
      allEpisodes,
      allArchives,
      allEvidence,
      allSourceMessages,
      allExperiences,
      allProposals,
      allPromotions,
      allRecallDocuments,
    ] = await Promise.all([
      deps.governanceRepositories.profiles.get(input.scope.userId),
      deps.governanceRepositories.preferences.listByScope(input.scope),
      deps.governanceRepositories.references.listByScope(input.scope),
      deps.governanceRepositories.facts.listByScope(input.scope),
      deps.governanceRepositories.feedback.listByScope(input.scope),
      deps.governanceRepositories.episodes.listByScope(input.scope),
      deps.governanceRepositories.archives.listByScope(input.scope),
      deps.governanceRepositories.evidence.listByScope(input.scope),
      deps.documentStore.query<SourceMessageRecord>(
        SOURCE_MESSAGES_COLLECTION,
        scopeFilter(input.scope),
      ),
      deps.governanceRepositories.experiences.listByScope(input.scope),
      deps.governanceRepositories.proposals.listByScope(input.scope),
      deps.governanceRepositories.promotions.listByScope(input.scope),
      deps.documentStore.query<RecallIndexDocument>(
        RECALL_DOCUMENTS_COLLECTION,
        scopeFilter(input.scope),
      ),
    ]);

    const preferences = allPreferences.filter((record) =>
      recordMatchesScope(record, input.scope),
    );
    const references = allReferences.filter((record) =>
      recordMatchesScope(record, input.scope),
    );
    const facts = allFacts.filter((record) => recordMatchesScope(record, input.scope));
    const feedback = allFeedback.filter((record) =>
      recordMatchesScope(record, input.scope),
    );
    const episodes = allEpisodes.filter((record) =>
      recordMatchesScope(record, input.scope),
    );
    const archives = allArchives.filter((record) =>
      recordMatchesScope(record, input.scope),
    );
    const evidence = allEvidence.filter((record) =>
      recordMatchesScope(record, input.scope),
    );
    const sourceMessages = allSourceMessages.filter((record) =>
      recordMatchesScope(record, input.scope),
    );
    const experiences = allExperiences.filter((record) =>
      recordMatchesScope(record, input.scope),
    );
    const proposals = allProposals.filter((record) =>
      recordMatchesScope(record, input.scope),
    );
    const promotions = allPromotions.filter((record) =>
      recordMatchesScope(record, input.scope),
    );
    const recallDocuments = allRecallDocuments.filter((record) =>
      recordMatchesScope(record, input.scope)
    );
    const projectedMemoryIds = new Set(recallDocuments.map((document) =>
      `${document.sourceCollection}:${document.sourceMemoryId}`
    ));

    if (profile && isPureUserScope(input.scope)) {
      await deps.documentStore.delete("profiles", input.scope.userId);
      deleted.profiles = 1;
    }

    for (const preference of preferences) {
      await deps.documentStore.delete("preferences", preference.id);
      deleted.preferences += 1;
    }
    for (const reference of references) {
      await deleteVectorForCollection(deps.governanceVectors, "references", reference.id);
      await deps.documentStore.delete("references", reference.id);
      deleted.references += 1;
    }
    for (const fact of facts) {
      await deleteVectorForCollection(deps.governanceVectors, "facts", fact.id);
      await deps.documentStore.delete("facts", fact.id);
      deleted.facts += 1;
    }
    for (const feedbackItem of feedback) {
      await deps.documentStore.delete("feedback", feedbackItem.id);
      deleted.feedback += 1;
    }
    for (const episode of episodes) {
      await deleteVectorForCollection(deps.governanceVectors, "episodes", episode.id);
      await deps.documentStore.delete("episodes", episode.id);
      deleted.episodes += 1;
    }
    for (const archive of archives) {
      await deps.documentStore.delete(SESSION_ARCHIVES_COLLECTION, archive.id);
      deleted.archives += 1;
    }
    for (const evidenceRecord of evidence) {
      await deps.documentStore.delete(EVIDENCE_COLLECTION, evidenceRecord.id);
      deleted.evidence += 1;
    }
    await deleteDocuments(
      deps.documentStore,
      SOURCE_MESSAGES_COLLECTION,
      sourceMessages,
    );
    for (const experience of experiences) {
      await deps.documentStore.delete(EXPERIENCES_COLLECTION, experience.id);
      deleted.experiences += 1;
    }
    for (const proposal of proposals) {
      await deps.documentStore.delete(LEARNING_PROPOSALS_COLLECTION, proposal.id);
      deleted.proposals += 1;
    }
    for (const promotion of promotions) {
      await deps.documentStore.delete(PROMOTION_RECORDS_COLLECTION, promotion.id);
      deleted.promotions += 1;
    }

    await deleteDocuments(
      deps.documentStore,
      RECALL_DOCUMENTS_COLLECTION,
      recallDocuments,
    );
    const { sessionId: _sessionId, ...entityFilter } = input.scope;
    const entityEdges = await deps.documentStore.query<EntityAdjacencyProjection>(
      ENTITIES_COLLECTION,
      entityFilter,
    );
    await deleteDocuments(
      deps.documentStore,
      ENTITIES_COLLECTION,
      entityEdges.filter((edge) =>
        recordMatchesScope(edge, input.scope) ||
        projectedMemoryIds.has(edge.memoryId)
      ),
    );

    for (const collection of [
      SCOPE_CATALOG_COLLECTION,
      PROJECTION_MANIFESTS_COLLECTION,
      PROJECTION_REPAIRS_COLLECTION,
      CLAIM_PROJECTIONS_COLLECTION,
      CLAIM_PROJECTION_STATUS_COLLECTION,
    ]) {
      const records = await deps.documentStore.query<ScopeBoundRecord & { id: string }>(
        collection,
        scopeFilter(input.scope),
      );
      await deleteDocuments(
        deps.documentStore,
        collection,
        records.filter((record) => recordMatchesScope(record, input.scope)),
      );
    }

    if (input.includeRuntime !== false) {
      const allSpills = await deps.documentStore.query<ArtifactSpillRecord>(
        ARTIFACT_SPILL_COLLECTION,
      );
      const allSpillPayloads = await deps.documentStore.query<ArtifactSpillPayloadRecord>(
        ARTIFACT_SPILL_PAYLOAD_COLLECTION,
      );
      const spills = allSpills.filter((record) =>
        recordMatchesScope(record.scope, input.scope),
      );
      const spillPayloads = allSpillPayloads.filter((record) =>
        recordMatchesScope(record.scope, input.scope),
      );

      deleted.workingMemory = await deps.sessionStore.deleteWorkingMemoryByScope(
        input.scope,
      );
      deleted.journal = await deps.sessionStore.deleteJournalsByScope(input.scope);
      await deps.sessionStore.deleteBuffersByScope(input.scope);
      for (const spill of spills) {
        await deps.documentStore.delete(ARTIFACT_SPILL_COLLECTION, spill.id);
        deleted.artifactSpills += 1;
      }
      for (const payload of spillPayloads) {
        await deps.documentStore.delete(
          ARTIFACT_SPILL_PAYLOAD_COLLECTION,
          payload.id,
        );
      }
    }

    await trace.succeeded({
      attributes: {
        deletedFacts: deleted.facts,
        deletedFeedback: deleted.feedback,
        deletedPreferences: deleted.preferences,
        deletedReferences: deleted.references,
      },
    });

    return {
      scope: input.scope,
      ...(trace.traceId ? { traceId: trace.traceId } : {}),
      deleted,
    };
  } catch (error) {
    await trace.failed({ error });
    throw error;
  }
}
