import {
  buildFeedbackIdentityKey,
  createFactMemory,
  createFeedbackMemory,
  createPreferenceMemory,
  createReferenceMemory,
  isActiveMemoryLifecycle,
  normalizeFeedbackAppliesTo,
} from "../domain/records";
import type { MemorySource } from "../domain/provenance";
import { isSameDurableScope } from "../domain/scope";
import { isIanaTimezone } from "../domain/temporal";
import type { TemporalInterval } from "../domain/temporal";
import {
  buildFactEmbeddingWrite,
  buildReferenceEmbeddingWrite,
} from "../embedding/vectorWrites";
import { EVIDENCE_COLLECTION } from "../evidence/contracts";
import type { SourceMessageRecord } from "../evidence/contracts";
import { toPolicyMemoryRecord } from "../policy/hooks";
import {
  buildCandidateEvidence,
  buildFact,
  buildFeedback,
  buildPreference,
  buildProfile,
  buildReference,
  enrichDuplicateFact,
  enrichDuplicateFeedback,
  enrichDuplicatePreference,
  enrichDuplicateReference,
  getProfileWriteReason,
  resolveCandidateObservedAt,
  resolveCandidateOccurrence,
  resolveReferenceSubject,
} from "./builders";
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
    const value = String(
      candidate.metadata?.preferenceValue ?? candidate.content,
    ).trim();
    const normalizedValue = context.language.normalizeForEquality(
      value,
      candidateLanguage,
    );
    const preferenceWrite = await context.writeDocumentBatchWithRollback<{
      memoryId: string;
      outcome: "merged" | "superseded" | "written";
      reason: string;
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

        if (duplicate) {
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
          const stalePreferences = categoryPreferences.filter(
            (preference) => preference.id !== duplicate.id,
          );
          return {
            batch: {
              expected: {
                collection: "preferences",
                document: duplicate,
                id: duplicate.id,
              },
              unchanged: stalePreferences.map((preference) => ({
                collection: "preferences",
                document: preference,
                id: preference.id,
              })),
              set: [
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
            },
          };
        }

        const preference = createPreferenceMemory({
          ...buildPreference(
            context.input.scope,
            candidate,
            context.createId(),
            timestamp,
            candidateSourceLanguage,
          ),
          updatedAt,
        });
        return {
          batch: {
            expected: {
              collection: "preferences",
              document: null,
              id: preference.id,
            },
            unchanged: categoryPreferences.map((existing) => ({
              collection: "preferences",
              document: existing,
              id: existing.id,
            })),
            set: [
              {
                collection: "preferences",
                document: preference,
                id: preference.id,
              },
              ...categoryPreferences.map((existing) => ({
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
          result: categoryPreferences.length > 0
            ? {
                memoryId: preference.id,
                outcome: "superseded" as const,
                reason: "superseded_preference",
              }
            : {
                memoryId: preference.id,
                outcome: "written" as const,
                reason: "explicit_preference",
              },
        };
      },
    );
    pushAcceptedEvent(state, {
      candidateId,
      outcome: preferenceWrite.outcome,
      memoryType: "preference",
      memoryId: preferenceWrite.memoryId,
      reason: preferenceWrite.reason,
      ...buildRememberEventTrace(candidate),
    });
    return;
  }

  if (candidate.memoryType === "reference") {
    const scopedReferences = await context.repositories.references.listByScope(
      context.input.scope,
    );
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
      const resolution = await context.policy.resolveConflict(
        toPolicyMemoryRecord(superseded, "reference"),
        referenceCandidate,
        context.policyContext,
      );

      if (resolution.action === "keep_existing") {
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

  if (candidate.memoryType === "fact") {
    const facts = await context.repositories.facts.listByScope(context.input.scope);
    const occurrence = resolveCandidateOccurrence(
      candidate,
      context.input.messages,
      candidateLanguage.locale,
    );
    const normalizedContent = context.language.normalizeForEquality(
      candidate.content,
      candidateLanguage,
    );
    const duplicate = facts.find(
      (fact) => {
        const factLanguage = resolveStoredTextLanguage(
          context,
          fact.content,
          fact.source,
        );
        return (
          fact.lifecycle === "active" &&
          context.language.normalizeForEquality(fact.content, factLanguage) ===
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

    const superseded = candidate.metadata?.category === "event"
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
        });

    if (superseded && context.policy?.resolveConflict) {
      const resolution = await context.policy.resolveConflict(
        toPolicyMemoryRecord(superseded, "fact"),
        candidate,
        context.policyContext,
      );

      if (resolution.action === "keep_existing") {
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

  const scopedFeedback = await context.repositories.feedback.listByScope(context.input.scope);
  const normalizedRule = context.language.normalizeForEquality(
    candidate.content,
    candidateLanguage,
  );
  const candidateIdentityKey = buildFeedbackIdentityKey({
    kind: candidate.metadata?.feedbackKind ?? "do",
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
      feedback.kind === (candidate.metadata?.feedbackKind ?? "do") &&
      normalizeFeedbackAppliesTo(feedback.appliesTo) ===
        normalizeFeedbackAppliesTo(candidate.metadata?.appliesTo),
  );
  if (superseded && context.policy?.resolveConflict) {
    const resolution = await context.policy.resolveConflict(
      toPolicyMemoryRecord(superseded, "feedback"),
      candidate,
      context.policyContext,
    );

    if (resolution.action === "keep_existing") {
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
