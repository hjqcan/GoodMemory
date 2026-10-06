import { filterSupportedObservations } from "../domain/observation";
import { createHash } from "node:crypto";
import { checkPreferenceChronology } from "./preferenceChronology";
import { checkFactCorrectionChronology, factCorrectionIsCurrent } from "./factCorrectionChronology";
import { candidateSourceMessageIndexes } from "./sourceMessages";
import { isUnquotedLanguageText } from "../language/service";
import { preferenceOppositionIds, preferenceSupersessionIds, sourcePreferenceStatement } from "../language/personalPreferences";
import {
  buildFeedbackIdentityKey,
  createFactMemory,
  createFeedbackMemory,
  createNoteMemory,
  createPreferenceMemory,
  createReferenceMemory,
  isActiveMemoryLifecycle,
  isFactExpired,
  normalizeFeedbackAppliesTo,
} from "../domain/records";
import type { MemorySource } from "../domain/provenance";
import { isSameDurableScope } from "../domain/scope";
import { isIanaTimezone } from "../domain/temporal";
import type { TemporalInterval } from "../domain/temporal";
import {
  buildFactEmbeddingWrite,
  buildNoteEmbeddingWrite,
  buildReferenceEmbeddingWrite,
} from "../embedding/vectorWrites";
import { EVIDENCE_COLLECTION, SOURCE_MESSAGES_COLLECTION } from "../evidence/contracts";
import type { EvidenceRecord, SourceMessageRecord } from "../evidence/contracts";
import {
  resolvePolicyConflict,
  toPolicyMemoryRecord,
} from "../policy/hooks";
import {
  buildCandidateEvidence,
  buildFact,
  buildFeedback,
  buildNote,
  buildPreference,
  buildProfile,
  buildReference,
  deriveNoteTitle,
  enrichDuplicateFact,
  enrichDuplicateFeedback,
  enrichDuplicatePreference,
  enrichDuplicateReference,
  getProfileWriteReason,
  resolveCandidateObservedAt,
  resolveCandidateOccurrence,
  resolveReferenceSubject,
} from "./builders";
import { resolveFeedbackKind } from "./durableOptOut";
import type { SourceLanguageMetadata } from "./builders";
import { buildRememberEventTrace } from "./classification";
import type {
  ClassifiedCandidate,
  RememberWriteContext,
  RememberWriteState,
} from "./contracts";
import { storedTextLanguageKey } from "./languageAnalysis";
import { extractCanonicalReferencePointer } from "./normalization";
import { createPreferenceCategoryFence } from "./writeOwnership";

function preferenceWriteTimestamp(
  requestedTimestamp: string,
  preferences: readonly {
    source: MemorySource;
    updatedAt: string;
  }[],
): string {
  return new Date(Math.max(
    Date.parse(requestedTimestamp),
    ...preferences.flatMap((preference) => [
      Date.parse(preference.source.extractedAt),
      Date.parse(preference.updatedAt),
    ]),
  )).toISOString();
}

function sameOccurrence(
  left: TemporalInterval | undefined,
  right: TemporalInterval | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.start === right.start &&
    left.endExclusive === right.endExclusive &&
    left.precision === right.precision &&
    left.timezone === right.timezone;
}

function languageMetadata(
  resolved: ReturnType<RememberWriteContext["language"]["resolveFromText"]>,
): SourceLanguageMetadata {
  return {
    locale: resolved.locale,
    localeSource: resolved.localeSource,
    languagePackId: resolved.languagePackId,
    languagePackVersion: resolved.languagePackVersion,
  };
}

function resolveStoredTextLanguage(
  context: RememberWriteContext,
  text: string,
  source: MemorySource,
) {
  const key = storedTextLanguageKey(text, source.locale);
  const cached = context.storedLanguageContexts.get(key);
  if (cached) {
    return cached;
  }
  const resolved = context.language.resolveFromText({
    locale: source.locale,
    text,
  });
  context.storedLanguageContexts.set(key, resolved);
  return resolved;
}

function storedSourceLanguage(
  context: RememberWriteContext,
  text: string,
  source: MemorySource,
): SourceLanguageMetadata {
  const resolved = resolveStoredTextLanguage(context, text, source);
  return {
    locale: source.locale ?? resolved.locale,
    localeSource: source.localeSource ?? resolved.localeSource,
    languagePackId: source.languagePackId ?? resolved.languagePackId,
    languagePackVersion:
      source.languagePackVersion ?? resolved.languagePackVersion,
  };
}

function pushAcceptedEvent(
  state: RememberWriteState,
  event: RememberWriteState["events"][number],
): void {
  state.accepted += 1;
  state.events.push(event);
}

async function persistCandidateEvidence(input: {
  candidate: ClassifiedCandidate;
  context: RememberWriteContext;
  evidenceId: string;
  memoryId: string;
  timestamp: string;
}): Promise<SourceMessageRecord[]> {
  const sourceIndexes = [
    ...new Set(
      input.candidate.sourceMessageIndexes ?? [input.candidate.sourceMessageIndex],
    ),
  ];
  const sourceMessages = sourceIndexes.flatMap((messageIndex) => {
    const sourceMessage = input.context.sourceMessagesByIndex.get(messageIndex);
    return sourceMessage ? [sourceMessage] : [];
  });
  await input.context.setDocumentWithRollback(
    EVIDENCE_COLLECTION,
    input.evidenceId,
    buildCandidateEvidence(
      input.context.input.scope,
      input.candidate,
      input.memoryId,
      input.evidenceId,
      input.timestamp,
      languageMetadata(input.context.candidateLanguage),
      sourceMessages,
    ),
  );
  return sourceMessages;
}

async function preparePreferenceEvidence(
  context: RememberWriteContext,
  candidate: ClassifiedCandidate,
  memoryId: string,
  timestamp: string,
) {
  const sourceMessages = [...new Map(candidateSourceMessageIndexes(candidate).flatMap((index) => {
    const source = context.sourceMessagesByIndex.get(index);
    return source ? [[source.id, source] as const] : [];
  })).values()];
  // Some policy transformations cannot safely preserve the raw source. Keep
  // that existing admission behavior without manufacturing source evidence.
  if (sourceMessages.length === 0) return null;
  // Bind confirmations to immutable source records, not ingestion time or a
  // caller's reusable message ID. Replaying the same source keeps its evidence.
  const sourceIds = [...new Set(sourceMessages.map(({ id }) => id))].sort();
  const id = `preference-evidence:v1:${createHash("sha256")
    .update(JSON.stringify([memoryId, sourceIds])).digest("hex")}`;
  const existing = await context.getDocument<EvidenceRecord>(EVIDENCE_COLLECTION, id);
  if (existing && (
    !isSameDurableScope(existing, context.input.scope) ||
    existing.sessionId !== context.input.scope.sessionId ||
    existing.linkedMemoryIds.length !== 1 ||
    existing.linkedMemoryIds[0] !== memoryId ||
    JSON.stringify([...(existing.sourceRecordIds ?? [])].sort()) !== JSON.stringify(sourceIds)
  )) {
    throw new Error(`Preference evidence identity conflict: ${id}`);
  }
  return {
    id,
    constraint: { collection: EVIDENCE_COLLECTION, id, document: existing },
    writes: existing ? [] : [{
      collection: EVIDENCE_COLLECTION,
      id,
      document: buildCandidateEvidence(
        context.input.scope, candidate, memoryId, id, timestamp,
        languageMetadata(context.candidateLanguage), sourceMessages,
      ),
    }],
  };
}

function queueClaimProjection(input: {
  candidate: ClassifiedCandidate;
  evidenceId: string;
  memoryId: string;
  sourceMessages: readonly SourceMessageRecord[];
  state: RememberWriteState;
  timestamp: string;
  context: RememberWriteContext;
}): void {
  const claim = input.candidate.metadata?.claim;
  if (!claim) {
    return;
  }
  const observedAt = input.sourceMessages
    .map(({ observedAt }) => observedAt)
    .filter((value): value is string => value !== undefined)
    .sort()[0] ?? claim.validFrom ?? input.timestamp;
  input.state.pendingClaimProjections.push({
    ...input.context.input.scope,
    sourceMemoryId: input.memoryId,
    subject: input.candidate.metadata?.subject ?? input.context.input.scope.userId,
    claim,
    contextualDescriptor: input.candidate.metadata?.contextualDescriptor,
    observedAt,
    ingestedAt: input.timestamp,
    evidenceIds: [input.evidenceId],
    sourceMessageIds: input.sourceMessages.map(
      (message) => message.sourceMessageId ?? message.id,
    ),
    extractorVersion:
      input.candidate.extractorIds?.join("+") ??
      input.candidate.extractionSources?.join("+") ??
      "remember-candidate-v1",
  });
}

export async function writeRememberCandidate(input: {
  candidateId: string;
  candidate: ClassifiedCandidate;
  context: RememberWriteContext;
  state: RememberWriteState;
}): Promise<void> {
  const { candidateId, candidate, context, state } = input;
  const timestamp = context.now();
  const candidateLanguage = context.candidateLanguage;
  const candidateSourceLanguage = languageMetadata(candidateLanguage);

  if (candidate.memoryType === "profile") {
    const profileField = candidate.metadata?.profileField ?? "name";
    if (profileField === "timezone" && !isIanaTimezone(candidate.content)) {
      state.rejected += 1;
      state.events.push({
        candidateId,
        outcome: "rejected",
        memoryType: "profile",
        reason: "invalid_payload",
        ...buildRememberEventTrace(candidate),
      });
      return;
    }
    const existing = await context.repositories.profiles.get(context.input.scope.userId);

    if (profileField === "currentProject") {
      const currentProjects = existing?.activeContext.currentProjects ?? [];
      if (currentProjects.includes(candidate.content)) {
        pushAcceptedEvent(state, {
          candidateId,
          outcome: "merged",
          memoryType: "profile",
          memoryId: context.input.scope.userId,
          reason: "duplicate_profile",
          ...buildRememberEventTrace(candidate),
        });
        return;
      }
    } else if (existing?.identity[profileField] === candidate.content) {
      pushAcceptedEvent(state, {
        candidateId,
        outcome: "merged",
        memoryType: "profile",
        memoryId: context.input.scope.userId,
        reason: "duplicate_profile",
        ...buildRememberEventTrace(candidate),
      });
      return;
    }

    const profile = buildProfile(
      context.input.scope.userId,
      existing,
      candidate,
      timestamp,
    );
    await context.setDocumentWithRollback("profiles", profile.userId, profile);
    pushAcceptedEvent(state, {
      candidateId,
      outcome: "written",
      memoryType: "profile",
      memoryId: profile.userId,
      reason: getProfileWriteReason(candidate),
      ...buildRememberEventTrace(candidate),
    });
    return;
  }

  if (candidate.memoryType === "preference") {
    const category =
      candidate.metadata?.preferenceCategory ?? "general_preference";
    const candidateValue = String(
      candidate.metadata?.preferenceValue ?? candidate.content,
    ).trim();
    const userSources = candidateSourceMessageIndexes(candidate)
      .map((index) => context.sourceMessagesByIndex.get(index))
      .filter((message) => message?.role === "user")
      .map((message) => message!.content);
    const preferenceStatement = sourcePreferenceStatement(candidateValue, userSources);
    const value = candidateValue;
    const normalizedValue = context.language.normalizeForEquality(
      value,
      candidateLanguage,
    );
    const preferenceWrite = await context.writeDocumentBatchWithRollback<{
      memoryId: string;
      outcome: "merged" | "superseded" | "written" | "rejected";
      reason: string;
      evidenceId?: string;
    }>(
      createPreferenceCategoryFence(context.input.scope, category),
      async () => {
        const categoryPreferences = (
          await context.repositories.preferences.listByScope(context.input.scope)
        )
          .filter(
            (preference) =>
              isSameDurableScope(preference, context.input.scope) &&
              (preference.lifecycle ?? "active") === "active" &&
              preference.category === category,
          )
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const retirementIds = preferenceSupersessionIds(categoryPreferences, preferenceStatement);
        const retiredPreferences = categoryPreferences.filter((preference) => retirementIds.has(preference.id));
        const updatedAt = preferenceWriteTimestamp(
          timestamp,
          categoryPreferences,
        );
        const duplicate = categoryPreferences.find((preference) => {
          const preferenceValue = String(preference.value).trim();
          const preferenceLanguage = resolveStoredTextLanguage(
            context,
            preferenceValue,
            preference.source,
          );
          return context.language.normalizeForEquality(
            preferenceValue,
            preferenceLanguage,
          ) === normalizedValue;
        });

        const chronologicalTargets = retiredPreferences.filter((preference) => preference.id !== duplicate?.id);
        const oppositionIds = preferenceOppositionIds(categoryPreferences, preferenceStatement);
        const admissionTargets = categoryPreferences.filter((preference) => preference.id !== duplicate?.id && oppositionIds.has(preference.id));
        const firstChronologyTarget = chronologicalTargets[0] ?? admissionTargets[0];
        const chronology = await checkPreferenceChronology({
          scope: context.input.scope, value, active: categoryPreferences, targets: chronologicalTargets, admissionTargets,
          incomingSources: candidateSourceMessageIndexes(candidate).flatMap((index) => {
            const source = context.sourceMessagesByIndex.get(index);
            return source ? [source] : [];
          }),
          preparedSources: new Map([...context.sourceMessagesByIndex.values()].map((source) => [source.id, source])),
          get: context.getDocument, query: context.queryDocuments,
        });
        if (chronology.reason && !duplicate) {
          return {
            batch: {
              expected: { collection: "preferences", id: firstChronologyTarget!.id, document: firstChronologyTarget! },
              unchanged: [...chronology.unchanged, ...categoryPreferences.slice(0).map((document) => ({ collection: "preferences", id: document.id, document }))],
              set: [],
            },
            result: { memoryId: firstChronologyTarget!.id, outcome: "rejected" as const, reason: chronology.reason },
          };
        }

        if (duplicate) {
          const evidence = await preparePreferenceEvidence(context, candidate, duplicate.id, timestamp);
          const enrichedDuplicate = enrichDuplicatePreference(
            duplicate,
            candidate,
            timestamp,
            storedSourceLanguage(
              context,
              String(duplicate.value),
              duplicate.source,
            ),
          );
          const updatedDuplicate = enrichedDuplicate
            ? createPreferenceMemory({
                ...enrichedDuplicate,
                updatedAt,
              })
            : null;
          const explicitCorrection = preferenceStatement?.polarity === "withdrawn" ||
            preferenceStatement?.explicitUpdate === true;
          const stalePreferences = retiredPreferences.filter(
            (preference) => !chronology.reason && explicitCorrection && preference.id !== duplicate.id,
          );
          return {
            batch: {
              expected: {
                collection: "preferences",
                document: duplicate,
                id: duplicate.id,
              },
              unchanged: [...chronology.unchanged, ...(evidence ? [evidence.constraint] : []), ...stalePreferences.map((preference) => ({
                collection: "preferences",
                document: preference,
                id: preference.id,
              }))],
              set: [
                ...(evidence?.writes ?? []),
                ...(updatedDuplicate
                  ? [{
                      collection: "preferences",
                      document: updatedDuplicate,
                      id: duplicate.id,
                    }]
                  : []),
                ...stalePreferences.map((preference) => ({
                  collection: "preferences",
                  document: createPreferenceMemory({
                    ...preference,
                    lifecycle: "superseded",
                    supersededBy: duplicate.id,
                    updatedAt,
                  }),
                  id: preference.id,
                })),
              ],
            },
            result: {
              memoryId: duplicate.id,
              outcome: "merged" as const,
              reason: "duplicate_preference",
              evidenceId: evidence?.id,
            },
          };
        }

        const preference = createPreferenceMemory({
          ...buildPreference(
            context.input.scope,
            { ...candidate, metadata: { ...candidate.metadata, preferenceValue: value } },
            context.createId(),
            timestamp,
            candidateSourceLanguage,
          ),
          updatedAt,
        });
        const evidence = await preparePreferenceEvidence(context, candidate, preference.id, timestamp);
        return {
          batch: {
            expected: {
              collection: "preferences",
              document: null,
              id: preference.id,
            },
            unchanged: [...chronology.unchanged, ...(evidence ? [evidence.constraint] : []), ...categoryPreferences.map((existing) => ({
              collection: "preferences",
              document: existing,
              id: existing.id,
            }))],
            set: [
              ...(evidence?.writes ?? []),
              {
                collection: "preferences",
                document: preference,
                id: preference.id,
              },
              ...retiredPreferences.map((existing) => ({
                collection: "preferences",
                document: createPreferenceMemory({
                  ...existing,
                  lifecycle: "superseded",
                  supersededBy: preference.id,
                  updatedAt,
                }),
                id: existing.id,
              })),
            ],
          },
          result: retiredPreferences.length > 0
            ? {
                memoryId: preference.id,
                outcome: "superseded" as const,
                reason: "superseded_preference",
                evidenceId: evidence?.id,
              }
            : {
                memoryId: preference.id,
                outcome: "written" as const,
                reason: "explicit_preference",
                evidenceId: evidence?.id,
              },
        };
      },
    );
    if (preferenceWrite.outcome === "rejected") {
      state.rejected += 1;
      state.events.push({ candidateId, outcome: "rejected", memoryType: "preference", reason: preferenceWrite.reason,
        ...buildRememberEventTrace(candidate) });
      return;
    }
    pushAcceptedEvent(state, {
      candidateId,
      outcome: preferenceWrite.outcome,
      memoryType: "preference",
      memoryId: preferenceWrite.memoryId,
      reason: preferenceWrite.reason,
      ...(preferenceWrite.evidenceId ? { evidenceIds: [preferenceWrite.evidenceId] } : {}),
      ...buildRememberEventTrace(candidate),
    });
    return;
  }

  if (candidate.memoryType === "reference") {
    const scopedReferences = (
      await context.repositories.references.listByScope(context.input.scope)
    ).filter((reference) => isSameDurableScope(reference, context.input.scope));
    const resolvedSubject = resolveReferenceSubject(
      candidate,
      scopedReferences,
    );
    const referenceCandidate =
      resolvedSubject === candidate.metadata?.subject
        ? candidate
        : {
            ...candidate,
            metadata: {
              ...candidate.metadata,
              subject: resolvedSubject,
            },
          };
    const pointer =
      extractCanonicalReferencePointer(referenceCandidate.metadata?.referencePointer) ??
      extractCanonicalReferencePointer(referenceCandidate.content) ??
      referenceCandidate.metadata?.referencePointer ??
      referenceCandidate.content;
    const duplicate = scopedReferences.find(
      (reference) =>
        isActiveMemoryLifecycle(reference) &&
        (extractCanonicalReferencePointer(reference.pointer) ?? reference.pointer) ===
          pointer,
    );

    if (duplicate) {
      const enrichedDuplicate = enrichDuplicateReference(
        duplicate,
        referenceCandidate,
        timestamp,
        storedSourceLanguage(context, duplicate.pointer, duplicate.source),
      );
      if (enrichedDuplicate) {
        await context.setDocumentWithRollback(
          "references",
          duplicate.id,
          enrichedDuplicate,
        );
      }
      const evidenceId = context.createId();
      await persistCandidateEvidence({
        candidate: referenceCandidate,
        context,
        evidenceId,
        memoryId: duplicate.id,
        timestamp,
      });
      pushAcceptedEvent(state, {
        candidateId,
        outcome: "merged",
        memoryType: "reference",
        memoryId: duplicate.id,
        reason: "duplicate_reference",
        ...buildRememberEventTrace(candidate),
        evidenceIds: [evidenceId],
      });
      return;
    }

    const superseded = scopedReferences.find(
      (reference) =>
        isActiveMemoryLifecycle(reference) &&
        (extractCanonicalReferencePointer(reference.pointer) ?? reference.pointer) ===
          (
            extractCanonicalReferencePointer(
              referenceCandidate.metadata?.supersedesPointer,
            ) ?? referenceCandidate.metadata?.supersedesPointer
          ),
    );
    if (superseded && context.policy?.resolveConflict) {
      const resolution = await resolvePolicyConflict(
        context.policy,
        toPolicyMemoryRecord(superseded, "reference"),
        referenceCandidate,
        context.policyContext,
      );

      if (resolution?.action === "keep_existing") {
        state.rejected += 1;
        state.events.push({
          candidateId,
          outcome: "rejected",
          memoryType: "reference",
          memoryId: superseded.id,
          reason: resolution.reason ?? "policy_keep_existing",
          ...buildRememberEventTrace(candidate),
        });
        return;
      }
    }
    const reference = buildReference(
      context.input.scope,
      referenceCandidate,
      context.createId(),
      timestamp,
      candidateSourceLanguage,
    );
    const referenceEmbeddingWrite = buildReferenceEmbeddingWrite(reference);
    const supersededReferenceVector =
      superseded && context.vectorIndex
        ? await context.vectorIndex.getReferenceEmbedding(superseded.id)
        : null;

    if (superseded) {
      await context.setDocumentWithRollback(
        "references",
        superseded.id,
        createReferenceMemory({
          ...superseded,
          lifecycle: "superseded",
          updatedAt: timestamp,
        }),
      );
      state.pendingVectorDeletes.push({
        id: superseded.id,
        memoryType: "reference",
        restoreRecord: supersededReferenceVector
          ? {
              ...supersededReferenceVector,
              memoryType: "reference",
            }
          : null,
      });
    }

    await context.setDocumentWithRollback("references", reference.id, reference);
    state.pendingEmbeddingWrites.push(referenceEmbeddingWrite);
    const evidenceId = context.createId();
    await persistCandidateEvidence({
      candidate: referenceCandidate,
      context,
      evidenceId,
      memoryId: reference.id,
      timestamp,
    });
    pushAcceptedEvent(state, {
      candidateId,
      outcome: superseded ? "superseded" : "written",
      memoryType: "reference",
      memoryId: reference.id,
      reason: superseded ? "superseded_reference" : "explicit_reference",
      ...buildRememberEventTrace(candidate),
      evidenceIds: [evidenceId],
    });
    return;
  }

  if (candidate.memoryType === "note") {
    // Notes are authored pages: the body is stored verbatim and the title is
    // the identity key within a scope. A same-title rewrite supersedes with
    // lineage; an identical page merges; policy may keep the existing page.
    const body = candidate.content;
    const title =
      candidate.metadata?.noteTitle?.trim() || deriveNoteTitle(body);
    const normalizedTitle = context.language.normalizeForEquality(
      title,
      candidateLanguage,
    );
    const scopedNotes = await context.repositories.notes.listByScope(
      context.input.scope,
    );
    const existing = scopedNotes.find(
      (note) =>
        isSameDurableScope(note, context.input.scope) &&
        isActiveMemoryLifecycle(note) &&
        context.language.normalizeForEquality(
          note.title,
          resolveStoredTextLanguage(context, note.title, note.source),
        ) === normalizedTitle,
    );

    if (existing && existing.body.trim() === body.trim()) {
      const evidenceId = context.createId();
      await persistCandidateEvidence({
        candidate,
        context,
        evidenceId,
        memoryId: existing.id,
        timestamp,
      });
      pushAcceptedEvent(state, {
        candidateId,
        outcome: "merged",
        memoryType: "note",
        memoryId: existing.id,
        reason: "duplicate_note",
        ...buildRememberEventTrace(candidate),
        evidenceIds: [evidenceId],
      });
      return;
    }

    if (existing && context.policy?.resolveConflict) {
      const resolution = await resolvePolicyConflict(
        context.policy,
        toPolicyMemoryRecord(existing, "note"),
        candidate,
        context.policyContext,
      );

      if (resolution?.action === "keep_existing") {
        state.rejected += 1;
        state.events.push({
          candidateId,
          outcome: "rejected",
          memoryType: "note",
          memoryId: existing.id,
          reason: resolution.reason ?? "policy_keep_existing",
          ...buildRememberEventTrace(candidate),
        });
        return;
      }
    }

    const note = buildNote(
      context.input.scope,
      candidate,
      title,
      context.createId(),
      timestamp,
      candidateSourceLanguage,
      context.input.messages,
    );
    const supersededNoteVector =
      existing && context.vectorIndex
        ? await context.vectorIndex.getNoteEmbedding(existing.id)
        : null;

    if (existing) {
      await context.setDocumentWithRollback(
        "notes",
        existing.id,
        createNoteMemory({
          ...existing,
          lifecycle: "superseded",
          supersededBy: note.id,
          updatedAt: timestamp,
        }),
      );
      state.pendingVectorDeletes.push({
        id: existing.id,
        memoryType: "note",
        restoreRecord: supersededNoteVector
          ? {
              ...supersededNoteVector,
              memoryType: "note",
            }
          : null,
      });
    }

    await context.setDocumentWithRollback("notes", note.id, note);
    state.pendingEmbeddingWrites.push(buildNoteEmbeddingWrite(note));
    const evidenceId = context.createId();
    await persistCandidateEvidence({
      candidate,
      context,
      evidenceId,
      memoryId: note.id,
      timestamp,
    });
    pushAcceptedEvent(state, {
      candidateId,
      outcome: existing ? "superseded" : "written",
      memoryType: "note",
      memoryId: note.id,
      reason: existing ? "superseded_note" : "explicit_note",
      ...buildRememberEventTrace(candidate),
      evidenceIds: [evidenceId],
    });
    return;
  }

  if (candidate.memoryType === "fact") {
    const queriedFacts = await context.repositories.facts.listByScope(context.input.scope);
    const scopedFacts = queriedFacts.filter((fact) => isSameDurableScope(fact, context.input.scope));
    const { facts } = await filterSupportedObservations(scopedFacts,
      context.repositories.facts.get?.bind(context.repositories.facts), context.now,
      context.repositories.facts.checkSnapshots?.bind(context.repositories.facts));
    const occurrence = resolveCandidateOccurrence(
      candidate,
      context.input.messages,
      candidateLanguage.locale,
    );
    // The same language-aware identity is used for duplicate admission,
    // source replay and the author observations used to order a correction.
    const factTextKey = (content: string, resolved: typeof candidateLanguage) =>
      context.language.normalizeForEquality(content, resolved);
    const normalizedContent = factTextKey(candidate.content, candidateLanguage);
    const replaySourceIds = new Set(candidateSourceMessageIndexes(candidate).flatMap(index => {
      const source = context.sourceMessagesByIndex.get(index);
      return source?.role === "user" && source.content.trim() === candidate.content.trim() ? [source.id] : [];
    }));
    const retiredMatches = facts.filter(fact => fact.lifecycle === "superseded" && fact.supersededBy &&
      sameOccurrence(fact.occurrence, occurrence) &&
      factTextKey(fact.content,
        resolveStoredTextLanguage(context, fact.content, fact.source)) === normalizedContent);
    if (replaySourceIds.size > 0 && retiredMatches.length > 0) {
      const evidence = (await context.queryDocuments<EvidenceRecord>(EVIDENCE_COLLECTION,
        { userId: context.input.scope.userId })).filter(item => isSameDurableScope(item, context.input.scope));
      const replayed = retiredMatches.some(fact =>
        evidence.some(item => item.kind === "correction_context" &&
          item.linkedMemoryIds.includes(fact.id) && item.linkedMemoryIds.includes(fact.supersededBy!)) &&
        evidence.some(item => item.linkedMemoryIds.includes(fact.id) &&
          item.sourceRecordIds?.some(id => replaySourceIds.has(id))));
      if (replayed) {
        state.rejected += 1;
        state.events.push({ candidateId, outcome: "rejected", memoryType: "fact",
          reason: "superseded_fact_source_replay", ...buildRememberEventTrace(candidate) });
        return;
      }
    }
    const duplicate = facts.find(
      (fact) => {
        const factLanguage = resolveStoredTextLanguage(
          context,
          fact.content,
          fact.source,
        );
        return (
          fact.lifecycle === "active" &&
          factTextKey(fact.content, factLanguage) ===
            normalizedContent &&
          sameOccurrence(fact.occurrence, occurrence)
        );
      },
    );

    if (duplicate) {
      const enrichedDuplicate = enrichDuplicateFact(
        duplicate,
        candidate,
        timestamp,
        storedSourceLanguage(context, duplicate.content, duplicate.source),
      );
      const evidenceId = context.createId();
      const sourceMessages = await persistCandidateEvidence({
        candidate,
        context,
        evidenceId,
        memoryId: duplicate.id,
        timestamp,
      });
      await context.setDocumentWithRollback(
        "facts",
        duplicate.id,
        enrichedDuplicate ?? duplicate,
      );
      queueClaimProjection({
        candidate,
        context,
        evidenceId,
        memoryId: duplicate.id,
        sourceMessages,
        state,
        timestamp,
      });
      pushAcceptedEvent(state, {
        candidateId,
        outcome: "merged",
        memoryType: "fact",
        memoryId: duplicate.id,
        reason: "duplicate_fact",
        ...buildRememberEventTrace(candidate),
        evidenceIds: [evidenceId],
      });
      return;
    }

    const sourceIndexes = candidateSourceMessageIndexes(candidate);
    let correctionAttempt = false;
    // A source cue triggers candidate examination, never candidate intent.
    // Ordinary writes retain the existing request-local analysis budget.
    const sourceHasCorrectionCue = sourceIndexes.some(index =>
      context.sourceAnalyses.get(index)?.analysis.correctionCue === true);
    if (candidate.explicitness === "explicit" && sourceHasCorrectionCue) {
      // A cue belongs to the candidate statement, not every fact extracted
      // from its source message. Reuse only identical text and language context.
      const languageKey = JSON.stringify(candidateLanguage);
      const analysisKey = JSON.stringify([languageKey, candidate.content]);
      let analysis = context.candidateContentAnalyses.get(analysisKey);
      if (!analysis) {
        const sourceIndex = sourceIndexes.find(index =>
          context.input.messages[index]?.content === candidate.content &&
          JSON.stringify(context.sourceAnalyses.get(index)?.context) === languageKey);
        analysis = sourceIndex === undefined ? undefined : context.sourceAnalyses.get(sourceIndex)?.analysis;
        analysis ??= context.language.analyzeContent(candidate.content, candidateLanguage);
        context.candidateContentAnalyses.set(analysisKey, analysis);
      }
      correctionAttempt = analysis.correctionCue;
    }
    const correctionSource = sourceIndexes.length === 1
      ? context.sourceMessagesByIndex.get(sourceIndexes[0]!) : undefined;
    const originalSource = sourceIndexes.length === 1 ? context.input.messages[sourceIndexes[0]!] : undefined;
    // A producer or metadata patch cannot authorize replacement. Bind the
    // complete candidate to one unchanged, policy-safe, live author statement.
    const sourceSupportsCorrection = correctionAttempt && correctionSource?.role === "user" &&
      originalSource?.role === "user" && originalSource.content.trim() === candidate.content.trim() &&
      correctionSource.content.trim() === candidate.content.trim() &&
      context.language.extractCandidates({ locale: candidateLanguage.locale,
        messages: [{ ...originalSource, sourceMessageIndex: sourceIndexes[0],
          analysis: context.sourceAnalyses.get(sourceIndexes[0]!)?.analysis }],
        nextId: () => "correction-source-proof",
      }, candidateLanguage).some(item => item.kindHint === "fact" &&
        item.explicitness === "explicit" && item.content.trim() === candidate.content.trim());
    const correctionTargets = sourceSupportsCorrection && candidate.metadata?.category !== "event"
      ? facts.filter(fact => fact.lifecycle === "active" && !fact.occurrence &&
        fact.category !== "event" && !isFactExpired(fact, context.now()) &&
        (fact.source.method === "explicit" || fact.source.method === "confirmed") &&
        context.language.localesCompatible(resolveStoredTextLanguage(context, fact.content, fact.source).locale, candidateLanguage.locale) &&
        context.language.matchesExplicitFactReplacement?.(fact.content, candidate.content, candidateLanguage))
      : [];
    if (correctionTargets.length > 1) {
      state.rejected += 1;
      state.events.push({ candidateId, outcome: "rejected", memoryType: "fact",
        reason: "ambiguous_fact_correction", ...buildRememberEventTrace(candidate) });
      return;
    }
    const explicitCorrectionTarget = correctionTargets[0];
    let chronology: Awaited<ReturnType<typeof checkFactCorrectionChronology>> | undefined;
    if (explicitCorrectionTarget) {
      chronology = await checkFactCorrectionChronology({ scope: context.input.scope,
        target: explicitCorrectionTarget, incoming: correctionSource!,
        validFrom: candidate.metadata?.claim?.validFrom, validUntil: candidate.metadata?.claim?.validUntil,
        now: context.now(), get: context.getDocument, query: context.queryDocuments,
        supportsAuthorSource: (source, evidence) => {
          const sourceLanguage = resolveStoredTextLanguage(context, source.content, evidence.source);
          const targetKey = factTextKey(explicitCorrectionTarget.content,
            resolveStoredTextLanguage(context, explicitCorrectionTarget.content, explicitCorrectionTarget.source));
          // Complete-source identity plus actual rule extraction proves the
          // accepted author assertion. Normalizing a quote, report or part of
          // a larger message alone cannot supply observation authority.
          if (!isUnquotedLanguageText(source.content) ||
            factTextKey(source.content, sourceLanguage) !== targetKey) return false;
          return context.language.extractCandidates({ locale: sourceLanguage.locale,
            messages: [{ role: source.role, content: source.content,
              observedAt: source.observedAt, timezone: source.timezone, sourceMessageIndex: 0 }],
            nextId: () => "fact-observation-proof",
          }, sourceLanguage).some(item => item.kindHint === "fact" && item.explicitness === "explicit" &&
            item.sourceRole === "user" && factTextKey(item.content, sourceLanguage) === targetKey);
        },
      });
      if (chronology.reason) {
        state.rejected += 1;
        state.events.push({ candidateId, outcome: "rejected", memoryType: "fact",
          reason: chronology.reason, ...buildRememberEventTrace(candidate) });
        return;
      }
    }
    const superseded = explicitCorrectionTarget ?? (correctionAttempt || candidate.metadata?.category === "event"
      ? undefined
      : facts.find((fact) => {
      const factLanguage = resolveStoredTextLanguage(
        context,
        fact.content,
        fact.source,
      );
      return (
        fact.lifecycle === "active" &&
        fact.source.method !== "explicit" &&
        candidate.explicitness === "explicit" &&
        context.language.localesCompatible(
          factLanguage.locale,
          candidateLanguage.locale,
        ) &&
        context.language.tokenOverlap(
          fact.content,
          candidate.content,
          candidateLanguage,
        ) >= 0.4
      );
        }));

    if (superseded && context.policy?.resolveConflict) {
      const resolution = await resolvePolicyConflict(
        context.policy,
        toPolicyMemoryRecord(superseded, "fact"),
        candidate,
        context.policyContext,
      );

      if (resolution?.action === "keep_existing") {
        state.rejected += 1;
        state.events.push({
          candidateId,
          outcome: "rejected",
          memoryType: "fact",
          memoryId: superseded.id,
          reason: resolution.reason ?? "policy_keep_existing",
          ...buildRememberEventTrace(candidate),
        });
        return;
      }
    }

    const fact = buildFact(
      context.input.scope,
      candidate,
      context.createId(),
      timestamp,
      candidateSourceLanguage,
      resolveCandidateObservedAt(candidate, context.input.messages),
      occurrence,
    );
    const factEmbeddingWrite = buildFactEmbeddingWrite(fact);
    const supersededFactVector =
      superseded && context.vectorIndex
        ? await context.vectorIndex.getFactEmbedding(superseded.id)
        : null;

    if (explicitCorrectionTarget && chronology && correctionSource) {
      // Use the canonical immutable-source lifecycle before retirement becomes
      // visible. A process exit can leave an allowed, unlinked source, but never
      // a retired fact/evidence chain whose new source was not committed.
      const persistedCorrectionSource = await context.persistSourceMessageRecord(correctionSource);
      if (!factCorrectionIsCurrent({ target: explicitCorrectionTarget, incoming: persistedCorrectionSource,
        validFrom: candidate.metadata?.claim?.validFrom, validUntil: candidate.metadata?.claim?.validUntil,
        now: context.now() })) {
        state.rejected += 1;
        state.events.push({ candidateId, outcome: "rejected", memoryType: "fact",
          reason: "not_current_fact_correction_source", ...buildRememberEventTrace(candidate) });
        return;
      }
      const evidenceId = context.createId();
      const evidence = { ...buildCandidateEvidence(context.input.scope, candidate, fact.id,
        evidenceId, timestamp, languageMetadata(context.candidateLanguage), [persistedCorrectionSource]),
        kind: "correction_context" as const,
        linkedMemoryIds: [explicitCorrectionTarget.id, fact.id],
      };
      const previous = createFactMemory({ ...explicitCorrectionTarget, lifecycle: "superseded",
        isActive: false, supersededBy: fact.id, updatedAt: timestamp });
      const committed = await context.writeConditionalBatchWithRollback({
        expected: { collection: "facts", id: previous.id, document: explicitCorrectionTarget },
        querySnapshots: [...chronology.querySnapshots, { collection: "facts", documents: queriedFacts,
          filter: Object.fromEntries(Object.entries({ userId: context.input.scope.userId,
            tenantId: context.input.scope.tenantId, workspaceId: context.input.scope.workspaceId,
            agentId: context.input.scope.agentId }).filter((entry): entry is [string, string] => entry[1] !== undefined)),
        }],
        unchanged: [
          { collection: "facts", id: fact.id, document: null },
          { collection: EVIDENCE_COLLECTION, id: evidenceId, document: null },
          ...chronology.unchanged,
          { collection: SOURCE_MESSAGES_COLLECTION, id: persistedCorrectionSource.id, document: persistedCorrectionSource },
        ],
        set: [
          { collection: "facts", id: previous.id, document: previous },
          { collection: "facts", id: fact.id, document: fact },
          { collection: EVIDENCE_COLLECTION, id: evidenceId, document: evidence },
        ],
      });
      if (!committed) {
        state.rejected += 1;
        state.events.push({ candidateId, outcome: "rejected", memoryType: "fact",
          reason: "fact_correction_target_changed_or_batch_unsupported", ...buildRememberEventTrace(candidate) });
        return;
      }
      state.pendingVectorDeletes.push({ id: previous.id, memoryType: "fact",
        restoreRecord: supersededFactVector ? { ...supersededFactVector, memoryType: "fact" } : null });
      state.pendingEmbeddingWrites.push(factEmbeddingWrite);
      queueClaimProjection({ candidate, context, evidenceId, memoryId: fact.id,
        sourceMessages: [persistedCorrectionSource], state, timestamp });
      pushAcceptedEvent(state, { candidateId, outcome: "superseded", memoryType: "fact",
        memoryId: fact.id, reason: "source_bound_fact_correction", evidenceIds: [evidenceId],
        ...buildRememberEventTrace(candidate) });
      return;
    }

    if (superseded) {
      await context.setDocumentWithRollback(
        "facts",
        superseded.id,
        createFactMemory({
          ...superseded,
          lifecycle: "superseded",
          isActive: false,
          supersededBy: fact.id,
          updatedAt: timestamp,
        }),
      );
      state.pendingVectorDeletes.push({
        id: superseded.id,
        memoryType: "fact",
        restoreRecord: supersededFactVector
          ? {
              ...supersededFactVector,
              memoryType: "fact",
            }
          : null,
      });
    }

    const evidenceId = context.createId();
    const sourceMessages = await persistCandidateEvidence({
      candidate,
      context,
      evidenceId,
      memoryId: fact.id,
      timestamp,
    });
    await context.setDocumentWithRollback("facts", fact.id, fact);
    state.pendingEmbeddingWrites.push(factEmbeddingWrite);
    queueClaimProjection({
      candidate,
      context,
      evidenceId,
      memoryId: fact.id,
      sourceMessages,
      state,
      timestamp,
    });
    pushAcceptedEvent(state, {
      candidateId,
      outcome: superseded ? "superseded" : "written",
      memoryType: "fact",
      memoryId: fact.id,
      reason: superseded ? "superseded_inferred_fact" : "explicit_fact",
      ...buildRememberEventTrace(candidate),
      evidenceIds: [evidenceId],
    });
    return;
  }

  const scopedFeedback = (
    await context.repositories.feedback.listByScope(context.input.scope)
  ).filter((feedback) => isSameDurableScope(feedback, context.input.scope));
  const normalizedRule = context.language.normalizeForEquality(
    candidate.content,
    candidateLanguage,
  );
  const candidateIdentityKey = buildFeedbackIdentityKey({
    kind: resolveFeedbackKind(candidate),
    normalizedRule,
    appliesTo: candidate.metadata?.appliesTo,
  });
  const duplicate = scopedFeedback.find(
    (feedback) => {
      const feedbackLanguage = resolveStoredTextLanguage(
        context,
        feedback.rule,
        feedback.source,
      );
      return (
        feedback.lifecycle === "active" &&
        buildFeedbackIdentityKey({
          kind: feedback.kind,
          normalizedRule: context.language.normalizeForEquality(
            feedback.rule,
            feedbackLanguage,
          ),
          appliesTo: feedback.appliesTo,
        }) === candidateIdentityKey
      );
    },
  );

  if (duplicate) {
    const enrichedDuplicate = enrichDuplicateFeedback(
      duplicate,
      candidate,
      timestamp,
      storedSourceLanguage(context, duplicate.rule, duplicate.source),
    );
    if (enrichedDuplicate) {
      await context.setDocumentWithRollback(
        "feedback",
        duplicate.id,
        enrichedDuplicate,
      );
    }
    pushAcceptedEvent(state, {
      candidateId,
      outcome: "merged",
      memoryType: "feedback",
      memoryId: duplicate.id,
      reason: "duplicate_feedback",
      ...buildRememberEventTrace(candidate),
    });
    return;
  }

  const superseded = scopedFeedback.find(
    (feedback) =>
      feedback.lifecycle === "active" &&
      feedback.kind === resolveFeedbackKind(candidate) &&
      normalizeFeedbackAppliesTo(feedback.appliesTo) ===
        normalizeFeedbackAppliesTo(candidate.metadata?.appliesTo),
  );
  if (superseded && context.policy?.resolveConflict) {
    const resolution = await resolvePolicyConflict(
      context.policy,
      toPolicyMemoryRecord(superseded, "feedback"),
      candidate,
      context.policyContext,
    );

    if (resolution?.action === "keep_existing") {
      state.rejected += 1;
      state.events.push({
        candidateId,
        outcome: "rejected",
        memoryType: "feedback",
        memoryId: superseded.id,
        reason: resolution.reason ?? "policy_keep_existing",
        ...buildRememberEventTrace(candidate),
      });
      return;
    }
  }
  const feedback = buildFeedback(
    context.input.scope,
    candidate,
    context.createId(),
    timestamp,
    candidateSourceLanguage,
  );

  if (superseded) {
    await context.setDocumentWithRollback(
      "feedback",
      superseded.id,
      createFeedbackMemory({
        ...superseded,
        lifecycle: "superseded",
        supersededBy: feedback.id,
        updatedAt: timestamp,
      }),
    );
  }

  await context.setDocumentWithRollback("feedback", feedback.id, feedback);
  pushAcceptedEvent(state, {
    candidateId,
    outcome: superseded ? "superseded" : "written",
    memoryType: "feedback",
    memoryId: feedback.id,
    reason: superseded ? "superseded_feedback" : "explicit_feedback",
    ...buildRememberEventTrace(candidate),
  });
}
