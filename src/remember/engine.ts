import {
  durableOptOutTargetIdentities,
} from "../domain/memoryCandidate";
import {
  assertStorageSafeExternalValue,
  hasPersistableSemanticText,
} from "../domain/semanticText";
import { assertRememberTemporalContext, isIanaTimezone } from "../domain/temporal";
import { buildEpisodeEmbeddingWrite } from "../embedding/vectorWrites";
import { SOURCE_MESSAGES_COLLECTION } from "../evidence/contracts";
import type { SourceMessageRecord } from "../evidence/contracts";
import { createLanguageService } from "../language";
import {
  evaluateShouldRemember,
  redactPolicyCandidate,
  type PolicyContext,
} from "../policy/hooks";
import { isProjectionCapableDocumentStore } from "../storage/contracts";
import type { DocumentStore } from "../storage/contracts";
import { extractDeterministicMemoryWithLanguage } from "./deterministicExtractor";
import { buildEpisodes } from "./episodes";
import {
  annotateExtractionResult,
  dedupeExtractionResult,
  mergeExtractionResults,
} from "./extraction";
import { writeRememberCandidate } from "./handlers";
import {
  analyzeRememberSourceMessages,
  candidateSourceLanguageAnalysis,
  primarySourceLanguageAnalysis,
  storedTextLanguageKey,
} from "./languageAnalysis";
import type {
  RememberSourceLanguageAnalyses,
  RememberSourceLanguageAnalysis,
} from "./languageAnalysis";
import {
  buildRememberEventTrace,
  classifyCandidate,
  toRememberEventMemoryType,
} from "./classification";
import { buildSourceMessageRecord } from "./builders";
import type {
  DurableOptOutTargetSelector,
  MessageAnnotation,
  MemoryCandidate,
  MemoryCandidateMetadata,
  MemoryExtractionInput,
  MemoryExtractionResult,
  MemoryExtractionStrategy,
} from "./candidates";
import type {
  ExtractionOutcome,
  RememberEngineConfig,
  RememberResult,
  RememberWriteState,
} from "./contracts";
import {
  isDurableOptOutCandidate,
  isTargetedByDurableOptOut,
} from "./durableOptOut";
import {
  createRuleMemoryExtractor,
  resolveRememberProfile,
} from "./profiles";
import type { ResolvedRememberProfile } from "./profiles";
import {
  extractCanonicalReferencePointer,
  normalizeMemoryCandidate,
} from "./normalization";
import { commitRememberVectors, rollbackRememberWrites } from "./vectorOps";
import { createRememberWriteCoordinator } from "./writeOwnership";

type EngineRememberResult = RememberResult & { outcome: ExtractionOutcome };

function assertStorageSafeRememberInput(input: MemoryExtractionInput): void {
  assertStorageSafeExternalValue({
    ...input,
    messages: input.messages.map(({ content: _content, ...message }) => message),
  }, "input");
}

async function prepareTemporalInput(
  input: MemoryExtractionInput,
  repositories: RememberEngineConfig["repositories"],
): Promise<MemoryExtractionInput> {
  assertStorageSafeRememberInput(input);
  assertRememberTemporalContext(input);

  const storedTimezone = (await repositories.profiles.get(input.scope.userId))
    ?.identity.timezone;
  const profileTimezone = storedTimezone && isIanaTimezone(storedTimezone)
    ? storedTimezone
    : undefined;
  return {
    ...input,
    messages: input.messages.map((message) => {
      const timezone = message.timezone ?? input.timezone ?? profileTimezone;
      return {
        ...message,
        ...(message.observedAt
          ? { observedAt: new Date(message.observedAt).toISOString() }
          : {}),
        ...(timezone ? { timezone } : {}),
      };
    }),
  };
}

function candidateSourceMessageIndexes(candidate: MemoryCandidate): number[] {
  return [...new Set([
    candidate.sourceMessageIndex,
    ...(candidate.sourceMessageIndexes ?? []),
  ])];
}

function candidateTouchesSourceIndexes(
  candidate: MemoryCandidate,
  sourceIndexes: ReadonlySet<number>,
): boolean {
  return candidateSourceMessageIndexes(candidate).some((index) =>
    sourceIndexes.has(index)
  );
}

function omitCandidatesFromSourceIndexes(
  extraction: MemoryExtractionResult,
  sourceIndexes: ReadonlySet<number>,
): MemoryExtractionResult {
  if (sourceIndexes.size === 0) {
    return extraction;
  }
  return {
    ...extraction,
    candidates: extraction.candidates.filter((candidate) =>
      !candidateTouchesSourceIndexes(candidate, sourceIndexes)
    ),
  };
}

function sourceMessageRecordsEquivalent(
  existing: SourceMessageRecord,
  incoming: SourceMessageRecord,
): boolean {
  return existing.id === incoming.id &&
    existing.schemaVersion === incoming.schemaVersion &&
    existing.userId === incoming.userId &&
    existing.tenantId === incoming.tenantId &&
    existing.workspaceId === incoming.workspaceId &&
    existing.agentId === incoming.agentId &&
    existing.sessionId === incoming.sessionId &&
    existing.sourceMessageId === incoming.sourceMessageId &&
    existing.role === incoming.role &&
    existing.content === incoming.content &&
    existing.observedAt === incoming.observedAt &&
    existing.timezone === incoming.timezone &&
    existing.contentSha256 === incoming.contentSha256;
}

async function persistSourceMessageRecords(
  documentStore: DocumentStore,
  incomingRecords: readonly SourceMessageRecord[],
): Promise<Map<string, SourceMessageRecord>> {
  const incomingById = new Map<string, SourceMessageRecord>();
  for (const incoming of incomingRecords) {
    const duplicate = incomingById.get(incoming.id);
    if (duplicate && !sourceMessageRecordsEquivalent(duplicate, incoming)) {
      throw new Error(`Immutable source-message conflict: ${incoming.id}`);
    }
    incomingById.set(incoming.id, incoming);
  }

  if (!isProjectionCapableDocumentStore(documentStore)) {
    const persisted = new Map<string, SourceMessageRecord>();
    for (const incoming of incomingById.values()) {
      const existing = await documentStore.get<SourceMessageRecord>(
        SOURCE_MESSAGES_COLLECTION,
        incoming.id,
      );
      if (existing && !sourceMessageRecordsEquivalent(existing, incoming)) {
        throw new Error(`Immutable source-message conflict: ${incoming.id}`);
      }
      if (!existing) {
        await documentStore.set(
          SOURCE_MESSAGES_COLLECTION,
          incoming.id,
          incoming,
        );
      }
      persisted.set(incoming.id, existing ?? incoming);
    }
    return persisted;
  }

  const ordered = [...incomingById.values()].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  if (ordered.length === 0) {
    return new Map();
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const snapshots = await Promise.all(ordered.map(async (incoming) => ({
      existing: await documentStore.get<SourceMessageRecord>(
        SOURCE_MESSAGES_COLLECTION,
        incoming.id,
      ),
      incoming,
    })));
    for (const { existing, incoming } of snapshots) {
      if (existing && !sourceMessageRecordsEquivalent(existing, incoming)) {
        throw new Error(`Immutable source-message conflict: ${incoming.id}`);
      }
    }
    const missing = snapshots.filter(({ existing }) => existing === null);
    if (missing.length === 0) {
      return new Map(
        snapshots.map(({ existing, incoming }) => [incoming.id, existing!]),
      );
    }
    const missingIds = new Set(missing.map(({ incoming }) => incoming.id));
    const constraints = snapshots.map(({ existing, incoming }) => ({
      collection: SOURCE_MESSAGES_COLLECTION,
      document: existing,
      id: incoming.id,
    }));
    if (await documentStore.writeBatchIfUnchanged({
      expected: constraints[0]!,
      set: [...incomingById.values()]
        .filter((incoming) => missingIds.has(incoming.id))
        .map((incoming) => ({
          collection: SOURCE_MESSAGES_COLLECTION,
          document: incoming,
          id: incoming.id,
        })),
      unchanged: constraints.slice(1),
    })) {
      return new Map(
        snapshots.map(({ existing, incoming }) => [
          incoming.id,
          existing ?? incoming,
        ]),
      );
    }
  }

  throw new Error(
    `Immutable source-message batch changed repeatedly: ${ordered[0]!.id}`,
  );
}

export type {
  ClassifiedCandidate,
  RememberEngineConfig,
  RememberEvent,
  RememberResult,
} from "./contracts";

export function createRememberEngine(config: RememberEngineConfig) {
  const SOURCE_MESSAGE_TAG = "source_message";
  const SOURCE_ORDER_TAG = "source_order";
  const USER_ANSWER_TAG = "user_answer";
  const ASSISTANT_ANSWER_TAG = "assistant_answer";
  const DATED_EVENT_TAG = "dated_event";
  const AUTO_EXTRACTION_COMPLEXITY_CHAR_THRESHOLD = 220;
  const AUTO_EXTRACTION_COMPLEX_BATCH_THRESHOLD = 4;
  const language = config.language ?? createLanguageService();
  const extractor = config.extractor;
  const assistedExtractor = config.assistedExtractor;
  const now = config.now ?? (() => new Date().toISOString());
  const createId = config.createId ?? (() => crypto.randomUUID());
  const vectorIndex =
    config.vectorIndex !== undefined
      ? config.vectorIndex ?? null
      : config.repositories.vectorIndex ?? null;

  const findAnnotation = (
    input: MemoryExtractionInput,
    messageIndex: number,
  ): MessageAnnotation | undefined =>
    input.annotations?.find((annotation) => annotation.messageIndex === messageIndex);

  const resolveCandidateLanguage = (
    candidate: MemoryCandidate,
    sourceAnalyses: RememberSourceLanguageAnalyses,
    requestLanguage: RememberSourceLanguageAnalysis,
  ) => {
    return candidateSourceLanguageAnalysis(candidate, sourceAnalyses)?.context ??
      requestLanguage.context;
  };

  const resolveRequestLanguage = (
    input: MemoryExtractionInput,
    sourceAnalyses: RememberSourceLanguageAnalyses,
  ): RememberSourceLanguageAnalysis => {
    const primary = primarySourceLanguageAnalysis(input, sourceAnalyses);
    if (primary) {
      return primary;
    }
    const context = language.resolveFromText({
      locale: input.locale,
      text: "",
    });
    return {
      analysis: language.analyzeContent("", context),
      context,
    };
  };

  const authorizeCandidateOccurrence = (
    candidate: MemoryCandidate,
    authorities: readonly MemoryCandidate[],
    sourceAnalyses: RememberSourceLanguageAnalyses,
    requestLanguage: RememberSourceLanguageAnalysis,
  ): MemoryCandidate => {
    const languageContext = resolveCandidateLanguage(
      candidate,
      sourceAnalyses,
      requestLanguage,
    );
    const normalizedContent = language.normalizeForEquality(
      candidate.content,
      languageContext,
    );
    const authority = candidate.kindHint === "fact"
      ? authorities.find((canonical) => {
          if (
            canonical.kindHint !== "fact" ||
            canonical.sourceMessageIndex !== candidate.sourceMessageIndex ||
            canonical.metadata?.occurrenceExpression === undefined
          ) {
            return false;
          }
          const canonicalContext = resolveCandidateLanguage(
            canonical,
            sourceAnalyses,
            requestLanguage,
          );
          return canonicalContext.languagePackId === languageContext.languagePackId &&
            language.normalizeForEquality(
              canonical.content,
              canonicalContext,
            ) === normalizedContent;
        })
      : undefined;
    if (authority?.metadata?.occurrenceExpression) {
      return {
        ...candidate,
        metadata: {
          ...candidate.metadata,
          occurrenceExpression: authority.metadata.occurrenceExpression,
        },
      };
    }
    if (candidate.metadata?.occurrenceExpression === undefined) {
      return candidate;
    }
    const { occurrenceExpression: _occurrenceExpression, ...metadata } =
      candidate.metadata;
    return {
      ...candidate,
      ...(Object.keys(metadata).length > 0 ? { metadata } : { metadata: undefined }),
    };
  };

  const authorizeExtractionOccurrences = (
    extraction: MemoryExtractionResult,
    authorities: readonly MemoryCandidate[],
    sourceAnalyses: RememberSourceLanguageAnalyses,
    requestLanguage: RememberSourceLanguageAnalysis,
  ): MemoryExtractionResult => ({
    ...extraction,
    candidates: extraction.candidates.map((candidate) =>
      authorizeCandidateOccurrence(
        candidate,
        authorities,
        sourceAnalyses,
        requestLanguage,
      )
    ),
  });

  const explicitDurableOptOutSelectors = (
    extraction: MemoryExtractionResult,
  ): DurableOptOutTargetSelector[] => extraction.candidates.flatMap((candidate) =>
    isDurableOptOutCandidate(candidate) && candidate.disposition
      ? [candidate.disposition.target]
      : []
  );

  const appendTag = (tags: string[], tag: string): void => {
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  };

  const shouldPreserveAnnotatedSourceMessage = (
    annotation: MessageAnnotation,
  ): boolean =>
    annotation.remember === "always" &&
    annotation.metadataPatch !== undefined &&
    (annotation.confirmed === true || annotation.verified === true);

  const resolveOriginalRole = (
    annotation: MessageAnnotation,
    message: { role: string },
  ): string => {
    const attributeRole =
      annotation.metadataPatch?.attributes?.originalRole ??
      annotation.metadataPatch?.attributes?.sourceRole;

    return String(attributeRole ?? message.role).trim().toLowerCase();
  };

  const sourceOrderAttribute = (
    metadataPatch: MemoryCandidateMetadata,
  ) =>
    metadataPatch.attributes?.sourceOrder ??
    metadataPatch.attributes?.chatId ??
    metadataPatch.attributes?.chat_id ??
    metadataPatch.attributes?.sourceMessageIndex;

  const hasSourceOrderCue = (
    metadataPatch: MemoryCandidateMetadata,
  ): boolean =>
    sourceOrderAttribute(metadataPatch) !== undefined ||
    (metadataPatch.tags ?? []).some((tag) =>
      tag === SOURCE_MESSAGE_TAG ||
      tag === SOURCE_ORDER_TAG ||
      /^chat_id:\d+$/u.test(tag)
    );

  const buildPreservedSourceMetadata = (
    annotation: MessageAnnotation,
    message: { content: string; role: string },
    sourceLanguage: RememberSourceLanguageAnalysis,
  ): MemoryCandidateMetadata => {
    const metadataPatch = annotation.metadataPatch ?? {};
    const tags = [...(metadataPatch.tags ?? [])];
    const orderAttribute = sourceOrderAttribute(metadataPatch);
    const shouldTrackSourceOrder = hasSourceOrderCue(metadataPatch);
    const attributes = shouldTrackSourceOrder
      ? {
          ...(metadataPatch.attributes ?? {}),
          sourceMessageIndex: annotation.messageIndex,
          sourceOrder: orderAttribute ?? annotation.messageIndex,
        }
      : metadataPatch.attributes;
    const originalRole = resolveOriginalRole(annotation, message);

    appendTag(tags, SOURCE_MESSAGE_TAG);
    if (shouldTrackSourceOrder) {
      appendTag(tags, SOURCE_ORDER_TAG);
    }
    if (originalRole === "user") {
      appendTag(tags, USER_ANSWER_TAG);
    } else if (originalRole === "assistant") {
      appendTag(tags, ASSISTANT_ANSWER_TAG);
    }
    if (
      language.parseTemporalExpressions(
        message.content,
        sourceLanguage.context,
      ).length > 0
    ) {
      appendTag(tags, DATED_EVENT_TAG);
    }

    return {
      ...metadataPatch,
      attributes,
      tags,
    };
  };

  const mergeCandidateMetadata = (
    base: MemoryCandidateMetadata | undefined,
    patch: MemoryCandidateMetadata | undefined,
  ): MemoryCandidateMetadata | undefined => {
    if (!base) {
      return patch;
    }
    if (!patch) {
      return base;
    }

    return {
      ...base,
      ...patch,
      attributes: {
        ...(base.attributes ?? {}),
        ...(patch.attributes ?? {}),
      },
      tags: [
        ...new Set([
          ...(base.tags ?? []),
          ...(patch.tags ?? []),
        ]),
      ],
    };
  };

  const buildAnnotationTrace = (annotation: MessageAnnotation) => {
    if (
      annotation.remember === undefined &&
      annotation.confirmed !== true &&
      annotation.verified !== true &&
      annotation.kindHint === undefined &&
      annotation.metadataPatch === undefined &&
      !annotation.reason
    ) {
      return undefined;
    }

    return {
      ...(annotation.confirmed === true ? { confirmed: true } : {}),
      ...(annotation.kindHint ? { kindHint: annotation.kindHint } : {}),
      ...(annotation.metadataPatch ? { metadataPatched: true } : {}),
      ...(annotation.reason ? { reason: annotation.reason } : {}),
      remember: annotation.remember ?? "auto",
      ...(annotation.verified === true ? { verified: true } : {}),
    };
  };

  const getNeverAnnotatedMessageIndexes = (
    input: MemoryExtractionInput,
  ): Set<number> =>
    new Set(
      (input.annotations ?? [])
        .filter((annotation) => annotation.remember === "never")
        .map((annotation) => annotation.messageIndex),
    );

  const getNonPersistableMessageIndexes = (
    input: MemoryExtractionInput,
  ): Set<number> =>
    new Set(
      input.messages.flatMap((message, messageIndex) =>
        hasPersistableSemanticText(message.content) ? [] : [messageIndex]
      ),
    );

  const getStorageUnsafeOnlyMessageIndexes = (
    input: MemoryExtractionInput,
    extraction: MemoryExtractionResult,
  ): Set<number> =>
    new Set(input.messages.flatMap((_message, messageIndex) => {
      const candidates = extraction.candidates.filter((candidate) =>
        candidateSourceMessageIndexes(candidate).includes(messageIndex)
      );
      return candidates.length > 0 && candidates.every(
          (candidate) => classifyCandidate(candidate).reason === "storage_unsafe",
        )
        ? [messageIndex]
        : [];
    }));

  const maskMessages = (
    input: MemoryExtractionInput,
    blockedIndexes: ReadonlySet<number>,
  ): MemoryExtractionInput => {
    if (blockedIndexes.size === 0) {
      return input;
    }

    return {
      ...input,
      messages: input.messages.map((message, messageIndex) =>
        blockedIndexes.has(messageIndex)
          ? {
              ...message,
              content: "",
            }
          : message,
      ),
    };
  };

  const sanitizeProducerMessages = (
    input: MemoryExtractionInput,
    sourceAnalyses: RememberSourceLanguageAnalyses,
    explicitOptOutSourceIndexes: ReadonlySet<number>,
    optOutTargetSelectors: readonly DurableOptOutTargetSelector[],
    canonicalCandidates: readonly MemoryCandidate[],
  ): {
    blockedSourceIndexes: ReadonlySet<number>;
    input: MemoryExtractionInput;
  } => {
    const blockedSourceIndexes = new Set<number>();
    let changed = false;
    let candidateId = 0;
    const messages = input.messages.map((message, messageIndex) => {
      const context = sourceAnalyses.get(messageIndex)?.context ??
        language.resolveFromText({ locale: input.locale, text: message.content });
      const hasExplicitOptOut = explicitOptOutSourceIndexes.has(messageIndex);
      let locatedOptOutClause = false;
      let removedClause = false;
      const clauses = language.splitClauses(message.content, context);
      const allowedClauses = clauses
        .filter((clause) => {
          if (hasExplicitOptOut) {
            if (canonicalCandidates.some((candidate) =>
              candidate.sourceMessageIndex === messageIndex &&
              clause.includes(candidate.content) &&
              isTargetedByDurableOptOut(candidate, optOutTargetSelectors)
            )) {
              removedClause = true;
              return false;
            }
            const candidates = language.extractCandidates(
              {
                locale: context.locale,
                messages: [{
                  content: clause,
                  role: message.role,
                  sourceMessageIndex: messageIndex,
                }],
                nextId: () => `producer-sanitizer-${candidateId++}`,
              },
              context,
            );
            if (candidates.some(isDurableOptOutCandidate)) {
              locatedOptOutClause = true;
              removedClause = true;
              return false;
            }
            if (candidates.some((candidate) =>
              isTargetedByDurableOptOut(candidate, optOutTargetSelectors)
            )) {
              removedClause = true;
              return false;
            }
          }
          const analysis = clauses.length === 1 && clause === message.content
            ? sourceAnalyses.get(messageIndex)?.analysis
            : language.analyzeContent(clause, context);
          if (
            analysis?.interrogative === true ||
            analysis?.behavioralDirective === "one_off"
          ) {
            removedClause = true;
            return false;
          }
          return true;
        });
      if (hasExplicitOptOut && !locatedOptOutClause) {
        changed = true;
        blockedSourceIndexes.add(messageIndex);
        return { ...message, content: "" };
      }
      if (!removedClause) {
        return message;
      }

      changed = true;
      const content = allowedClauses.join("\n");
      if (!hasPersistableSemanticText(content)) {
        blockedSourceIndexes.add(messageIndex);
      }
      return { ...message, content };
    });

    return {
      blockedSourceIndexes,
      input: changed ? { ...input, messages } : input,
    };
  };

  const producerCandidateTargetValues = (
    candidate: MemoryCandidate,
  ): string[] => {
    const values = new Set([candidate.content]);
    if (candidate.kindHint === "preference") {
      values.add(String(candidate.metadata?.preferenceValue ?? ""));
    }
    if (candidate.kindHint === "reference") {
      values.add(String(candidate.metadata?.referencePointer ?? ""));
    }
    return [...values].filter(Boolean);
  };

  const collectCandidateMetadataStrings = (value: unknown): string[] => {
    if (typeof value === "string") {
      return [value];
    }
    if (Array.isArray(value)) {
      return value.flatMap(collectCandidateMetadataStrings);
    }
    return value && typeof value === "object"
      ? Object.values(value).flatMap(collectCandidateMetadataStrings)
      : [];
  };

  const isProducerCandidateGrounded = (
    candidate: MemoryCandidate,
    sourceContent: string,
    context: RememberSourceLanguageAnalysis["context"],
  ): boolean => {
    const sourceTokens = new Set(
      language.tokenize(sourceContent, context, { excludeStopwords: true }),
    );

    return producerCandidateTargetValues(candidate).every((value) => {
      const tokens = language.tokenize(value, context, {
        excludeStopwords: true,
      });
      return tokens.length > 0 && tokens.every((token) =>
        sourceTokens.has(token)
      );
    });
  };

  const isGroundedForExplicitOptOutSources = (
    candidate: MemoryCandidate,
    sourceInput: MemoryExtractionInput,
    explicitOptOutSourceIndexes: ReadonlySet<number>,
    optOutTargetSelectors: readonly DurableOptOutTargetSelector[],
    sourceAnalyses: RememberSourceLanguageAnalyses,
    requestLanguage: RememberSourceLanguageAnalysis,
  ): boolean => {
    if (explicitOptOutSourceIndexes.size === 0) {
      return true;
    }
    const primaryContext = sourceAnalyses.get(candidate.sourceMessageIndex)
      ?.context ?? requestLanguage.context;
    if (
      !candidate.durableTarget &&
      optOutTargetSelectors.some((selector) => {
        return durableOptOutTargetIdentities(selector).some((identity) => {
          const targetTokens = language.tokenize(
            identity.value,
            primaryContext,
            { excludeStopwords: true },
          );
          return targetTokens.length > 0 && [
            candidate.content,
            ...collectCandidateMetadataStrings(candidate.metadata),
          ]
            .some((value) => {
              const valueTokens = new Set(
                language.tokenize(value, primaryContext, {
                  excludeStopwords: true,
                }),
              );
              return targetTokens.every((token) => valueTokens.has(token));
            });
        });
      })
    ) {
      return false;
    }
    return candidateSourceMessageIndexes(candidate).some((index) =>
      isProducerCandidateGrounded(
        candidate,
        sourceInput.messages[index]?.content ?? "",
        sourceAnalyses.get(index)?.context ?? requestLanguage.context,
      )
    );
  };

  const isCandidateSourceAllowed = (
    candidate: MemoryCandidate,
    profile: ResolvedRememberProfile,
    input: MemoryExtractionInput,
  ): boolean => {
    return candidateSourceMessageIndexes(candidate).every((messageIndex) => {
      const role = input.messages[messageIndex]?.role;
      if (role === "user") {
        return true;
      }
      if (role !== "assistant") {
        return false;
      }

      const annotation = findAnnotation(input, messageIndex);
      if (!annotation || annotation.remember === "never") {
        return false;
      }

      if (profile.assistantOutputs.mode === "host_tagged_only") {
        return annotation.remember === "always";
      }

      if (profile.assistantOutputs.mode === "confirmed_only") {
        return annotation.confirmed === true;
      }

      if (profile.assistantOutputs.mode === "verified_only") {
        return annotation.verified === true;
      }

      if (profile.assistantOutputs.mode === "confirmed_or_verified_only") {
        return annotation.confirmed === true || annotation.verified === true;
      }

      return false;
    });
  };

  const applyAnnotations = (
    input: MemoryExtractionInput,
    profile: ResolvedRememberProfile,
    extraction: MemoryExtractionResult,
    sourceAnalyses: RememberSourceLanguageAnalyses,
    requestLanguage: RememberSourceLanguageAnalysis,
    explicitOptOutSourceIndexes: ReadonlySet<number>,
  ): MemoryExtractionResult => {
    const blockedIndexes = getNeverAnnotatedMessageIndexes(input);
    const candidates = extraction.candidates
      .filter((candidate) =>
        ![
          candidate.sourceMessageIndex,
          ...(candidate.sourceMessageIndexes ?? []),
        ].some((messageIndex) => blockedIndexes.has(messageIndex))
      )
      .map((candidate) => {
        const annotation = findAnnotation(input, candidate.sourceMessageIndex);
        if (!annotation) {
          return candidate;
        }

        const annotationTrace = buildAnnotationTrace(annotation);
        if (candidateTouchesSourceIndexes(candidate, explicitOptOutSourceIndexes)) {
          return annotationTrace
            ? { ...candidate, annotation: annotationTrace }
            : candidate;
        }
        if (!annotation?.metadataPatch && !annotation?.kindHint && !annotationTrace) {
          return candidate;
        }
        const explicitness =
          annotation.remember === "always" &&
          (annotation.confirmed === true || annotation.verified === true)
            ? "explicit"
            : candidate.explicitness;
        const preserveSource = shouldPreserveAnnotatedSourceMessage(annotation);
        const annotationMetadata = preserveSource
          ? buildPreservedSourceMetadata(
              annotation,
              input.messages[candidate.sourceMessageIndex] ?? {
                content: candidate.content,
                role: candidate.sourceRole,
              },
              candidateSourceLanguageAnalysis(candidate, sourceAnalyses) ??
                requestLanguage,
            )
          : annotation.metadataPatch;

        return {
          ...candidate,
          annotation: annotationTrace ?? candidate.annotation,
          explicitness,
          kindHint: annotation.kindHint ?? candidate.kindHint,
          metadata: mergeCandidateMetadata(candidate.metadata, annotationMetadata),
        };
      });

    for (const annotation of input.annotations ?? []) {
      if (annotation.remember !== "always") {
        continue;
      }

      if (blockedIndexes.has(annotation.messageIndex)) {
        continue;
      }

      if (explicitOptOutSourceIndexes.has(annotation.messageIndex)) {
        continue;
      }

      const message = input.messages[annotation.messageIndex];
      if (!message) {
        continue;
      }

      const hasCandidateForMessage = candidates.some(
        (candidate) => candidate.sourceMessageIndex === annotation.messageIndex,
      );
      const hasExactSourceCandidate = candidates.some(
        (candidate) =>
          candidate.sourceMessageIndex === annotation.messageIndex &&
          candidate.content.trim() === message.content.trim(),
      );
      const preserveSource = shouldPreserveAnnotatedSourceMessage(annotation);

      if (
        hasCandidateForMessage &&
        (
          !preserveSource ||
          hasExactSourceCandidate
        )
      ) {
        continue;
      }

      candidates.push({
        id: preserveSource
          ? `annotation-source-${annotation.messageIndex + 1}`
          : `annotation-${annotation.messageIndex + 1}`,
        kindHint: annotation.kindHint ?? "fact",
        explicitness: "explicit",
        annotation: buildAnnotationTrace(annotation),
        extractionSources: ["rules-only"],
        profileId: profile.id,
        presetId: profile.presetId,
        content: message.content,
        sourceMessageIndex: annotation.messageIndex,
        sourceRole: message.role,
        metadata: preserveSource
          ? buildPreservedSourceMetadata(
              annotation,
              message,
              sourceAnalyses.get(annotation.messageIndex) ?? requestLanguage,
            )
          : annotation.metadataPatch,
      });
    }

    return {
      ...extraction,
      candidates,
    };
  };

  const shouldAutoUseAssistedExtraction = (input: {
    request: MemoryExtractionInput;
    baselineExtraction: MemoryExtractionResult;
    sourceAnalyses: RememberSourceLanguageAnalyses;
  }): boolean => {
    if (!assistedExtractor) {
      return false;
    }

    const userMessages = input.request.messages
      .map((message, messageIndex) => ({ message, messageIndex }))
      .filter(({ message }) => message.role === "user");
    const combinedUserContent = userMessages
      .map(({ message }) => message.content.trim())
      .filter((content) => content.length > 0)
      .join("\n");
    const contentAnalyses = userMessages.flatMap(({ messageIndex }) => {
      const analysis = input.sourceAnalyses.get(messageIndex)?.analysis;
      return analysis ? [analysis] : [];
    });
    const durableCandidateKinds = new Set(
      input.baselineExtraction.candidates
        .filter((candidate) => candidate.kindHint !== "noise")
        .map((candidate) => candidate.kindHint),
    );
    const durableCandidateCount = input.baselineExtraction.candidates.filter(
      (candidate) => candidate.kindHint !== "noise",
    ).length;
    const hasCorrectionCue = contentAnalyses.some(({ correctionCue }) =>
      correctionCue
    );
    const hasDurableCue = contentAnalyses.some(({ durableCue }) => durableCue);
    const hasUnderspecifiedReferenceState = input.baselineExtraction.candidates.some(
      (candidate) =>
        candidate.kindHint === "reference" &&
        (
          !extractCanonicalReferencePointer(
            candidate.metadata?.referencePointer ?? candidate.content,
          ) ||
          (candidate.metadata?.subject ?? "unknown") === "unknown"
        ),
    );
    const hasUnderspecifiedProjectState = input.baselineExtraction.candidates.some(
      (candidate) =>
        candidate.kindHint === "fact" &&
        (
          candidate.metadata?.factKind === "blocker" ||
          candidate.metadata?.factKind === "open_loop" ||
          candidate.metadata?.factKind === "project_state"
        ) &&
        (candidate.metadata?.subject ?? "unknown") === "unknown",
    );

    return (
      combinedUserContent.length >= AUTO_EXTRACTION_COMPLEXITY_CHAR_THRESHOLD ||
      (input.baselineExtraction.candidates.length === 0 && hasDurableCue) ||
      hasCorrectionCue ||
      hasUnderspecifiedReferenceState ||
      hasUnderspecifiedProjectState ||
      (
        durableCandidateCount >= AUTO_EXTRACTION_COMPLEX_BATCH_THRESHOLD &&
        combinedUserContent.length >= AUTO_EXTRACTION_COMPLEXITY_CHAR_THRESHOLD / 2 &&
        durableCandidateKinds.size >= 3
      )
    );
  };

  const normalizeExtractionResult = (
    request: MemoryExtractionInput,
    sourceInput: MemoryExtractionInput,
    result: MemoryExtractionResult,
    sourceAnalyses: RememberSourceLanguageAnalyses,
    requestLanguage: RememberSourceLanguageAnalysis,
    authority: "language" | "producer",
    occurrenceAuthorities?: readonly MemoryCandidate[],
  ): MemoryExtractionResult => {
    return {
      ...result,
      candidates: result.candidates.map((candidate) => {
        const sourceMessage = request.messages[candidate.sourceMessageIndex];
        const normalizedSourceMessage =
          sourceInput.messages[candidate.sourceMessageIndex];
        const sourceIndexes = candidateSourceMessageIndexes(candidate);
        if (
          !sourceMessage ||
          !normalizedSourceMessage ||
          sourceIndexes.some((index) => !request.messages[index])
        ) {
          return { ...candidate, kindHint: "noise" as const };
        }
        if (!hasPersistableSemanticText(candidate.content)) {
          return { ...candidate, sourceRole: sourceMessage.role };
        }
        const { sourceMessageIndexes: _sourceMessageIndexes, ...candidateWithoutIndexes } =
          candidate;
        const sourceBoundCandidate = {
          ...candidateWithoutIndexes,
          ...(sourceIndexes.length > 1 ? { sourceMessageIndexes: sourceIndexes } : {}),
          sourceRole: sourceMessage.role,
        };
        const sourceLanguage = candidateSourceLanguageAnalysis(
          sourceBoundCandidate,
          sourceAnalyses,
        ) ?? requestLanguage;
        const normalizedCandidate = normalizeMemoryCandidate(
          sourceBoundCandidate,
          normalizedSourceMessage.content,
          {
            analysis: sourceLanguage.analysis,
            language,
            resolved: sourceLanguage.context,
          },
        );
        const producerCandidate = authority === "producer"
          ? {
            ...normalizedCandidate,
            disposition: undefined,
            durableTarget: undefined,
          }
          : normalizedCandidate;
        const derivedDurableTarget = authority === "language"
          ? language.deriveDurableTarget?.(
              producerCandidate,
              sourceLanguage.context,
            )
          : undefined;
        const normalizedCandidateWithTarget = derivedDurableTarget
          ? { ...producerCandidate, durableTarget: derivedDurableTarget }
          : producerCandidate;
        return occurrenceAuthorities
          ? authorizeCandidateOccurrence(
              normalizedCandidateWithTarget,
              occurrenceAuthorities,
              sourceAnalyses,
              requestLanguage,
            )
          : normalizedCandidateWithTarget;
      }),
    };
  };

  const applyProfileTrace = (
    result: MemoryExtractionResult,
    profile: ResolvedRememberProfile,
  ): MemoryExtractionResult => ({
    ...result,
    candidates: result.candidates.map((candidate) => ({
      ...candidate,
      profileId: profile.id,
      presetId: profile.presetId,
    })),
  });

  const resolveRequestedExtractionStrategy = (
    strategy: MemoryExtractionStrategy | undefined,
  ): MemoryExtractionStrategy => strategy ?? "auto";

  const resolveExtraction = async (
    input: MemoryExtractionInput,
    sourceAnalyses: RememberSourceLanguageAnalyses,
    requestLanguage: RememberSourceLanguageAnalysis,
  ) => {
    const profile = resolveRememberProfile({
      config: config.remember,
      scope: input.scope,
    });
    const extractorInput = maskMessages(
      input,
      getNeverAnnotatedMessageIndexes(input),
    );
    const nonPersistableSourceIndexes = getNonPersistableMessageIndexes(
      extractorInput,
    );
    const persistableExtractorInput = maskMessages(
      extractorInput,
      nonPersistableSourceIndexes,
    );
    const producerRoleBlockedSourceIndexes = new Set(
      persistableExtractorInput.messages.flatMap((message, messageIndex) => {
        const probeCandidate: MemoryCandidate = {
          id: `producer-role-${messageIndex}`,
          kindHint: "noise",
          explicitness: "inferred",
          content: message.content,
          sourceMessageIndex: messageIndex,
          sourceRole: message.role,
        };
        return isCandidateSourceAllowed(probeCandidate, profile, input)
          ? []
          : [messageIndex];
      }),
    );
    const roleSafeExtractorInput = maskMessages(
      persistableExtractorInput,
      producerRoleBlockedSourceIndexes,
    );
    const requestedExtractionStrategy = resolveRequestedExtractionStrategy(
      input.extractionStrategy,
    );
    const canonicalExtraction = extractDeterministicMemoryWithLanguage(
      persistableExtractorInput,
      language,
      sourceAnalyses,
    );
    const explicitOptOutSourceIndexes = new Set(
      canonicalExtraction.candidates
        .filter(isDurableOptOutCandidate)
        .map(({ sourceMessageIndex }) => sourceMessageIndex),
    );
    const normalizedCanonicalExtraction = omitCandidatesFromSourceIndexes(
      normalizeExtractionResult(
        input,
        persistableExtractorInput,
        canonicalExtraction,
        sourceAnalyses,
        requestLanguage,
        "language",
      ),
      nonPersistableSourceIndexes,
    );
    const optOutTargetSelectors = explicitDurableOptOutSelectors(
      normalizedCanonicalExtraction,
    );
    const {
      blockedSourceIndexes: sanitizedProducerSourceIndexes,
      input: producerInput,
    } = sanitizeProducerMessages(
      roleSafeExtractorInput,
      sourceAnalyses,
      explicitOptOutSourceIndexes,
      optOutTargetSelectors,
      normalizedCanonicalExtraction.candidates,
    );
    const blockedProducerSourceIndexes = new Set([
      ...nonPersistableSourceIndexes,
      ...sanitizedProducerSourceIndexes,
    ]);
    const producerSourceAnalyses = producerInput === input
      ? sourceAnalyses
      : analyzeRememberSourceMessages(producerInput, language);
    const customExtraction = extractor
      ? normalizeExtractionResult(
        input,
        producerInput,
        omitCandidatesFromSourceIndexes(
          await extractor.extract(producerInput),
          blockedProducerSourceIndexes,
        ),
        producerSourceAnalyses,
        requestLanguage,
        "producer",
        normalizedCanonicalExtraction.candidates,
      )
      : undefined;
    const baselineResult = customExtraction
      ? explicitOptOutSourceIndexes.size > 0
        ? mergeExtractionResults(normalizedCanonicalExtraction, customExtraction)
        : customExtraction
      : normalizedCanonicalExtraction;
    let baselineExtraction = annotateExtractionResult(
      applyProfileTrace(
        baselineResult,
        profile,
      ),
      "rules-only",
    );
    const profileRuleExtractor = createRuleMemoryExtractor({
      profileId: profile.id,
      presetId: profile.presetId,
      rules: profile.rules,
    });

    baselineExtraction = mergeExtractionResults(
      baselineExtraction,
      annotateExtractionResult(
        applyProfileTrace(
          normalizeExtractionResult(
            input,
            producerInput,
            omitCandidatesFromSourceIndexes(
              await profileRuleExtractor.extract(producerInput),
              blockedProducerSourceIndexes,
            ),
            producerSourceAnalyses,
            requestLanguage,
            "producer",
            normalizedCanonicalExtraction.candidates,
          ),
          profile,
        ),
        "rules-only",
      ),
    );

    for (const profileExtractor of profile.extractors) {
      const profileExtraction = annotateExtractionResult(
        applyProfileTrace(
          normalizeExtractionResult(
            input,
            producerInput,
            omitCandidatesFromSourceIndexes(
              await profileExtractor.extractor.extract(producerInput),
              blockedProducerSourceIndexes,
            ),
            producerSourceAnalyses,
            requestLanguage,
            "producer",
            normalizedCanonicalExtraction.candidates,
          ),
          profile,
        ),
        "rules-only",
      );

      baselineExtraction = mergeExtractionResults(
        baselineExtraction,
        {
          ...profileExtraction,
          candidates: profileExtraction.candidates.map((candidate) => ({
            ...candidate,
            extractorIds: [
              ...new Set([
                ...(candidate.extractorIds ?? []),
                profileExtractor.id,
              ]),
            ],
            profileId: profile.id,
            presetId: profile.presetId,
          })),
        },
      );
    }

    baselineExtraction = authorizeExtractionOccurrences(
      omitCandidatesFromSourceIndexes(
        dedupeExtractionResult(
          applyAnnotations(
            input,
            profile,
            baselineExtraction,
            sourceAnalyses,
            requestLanguage,
            explicitOptOutSourceIndexes,
          ),
        ),
        nonPersistableSourceIndexes,
      ),
      normalizedCanonicalExtraction.candidates,
      sourceAnalyses,
      requestLanguage,
    );
    const shouldRunAssistedExtraction =
      requestedExtractionStrategy === "llm-assisted" ||
      (requestedExtractionStrategy === "auto" &&
        shouldAutoUseAssistedExtraction({
          request: producerInput,
          baselineExtraction,
          sourceAnalyses: producerSourceAnalyses,
        }));
    const hasAssistedInput = producerInput.messages.some(({ content }) =>
      hasPersistableSemanticText(content)
    );

    if (
      !shouldRunAssistedExtraction ||
      !assistedExtractor ||
      !hasAssistedInput
    ) {
      return {
        extraction: baselineExtraction,
        explicitOptOutSourceIndexes,
        optOutTargetSelectors,
        producerInput,
        profile,
        requestedExtractionStrategy,
        resolvedExtractionStrategy: "rules-only" as const,
      };
    }

    let assistedExtraction: MemoryExtractionResult;

    try {
      const existingProfile = await config.repositories.profiles.get(
        input.scope.userId,
      );
      const knownUserName = existingProfile?.identity.name?.trim();
      assistedExtraction = annotateExtractionResult(
        applyProfileTrace(
          omitCandidatesFromSourceIndexes(
            normalizeExtractionResult(
              input,
              producerInput,
              await assistedExtractor.extract({
                ...producerInput,
                extractionStrategy: "llm-assisted",
              }, knownUserName ? { knownUserName } : undefined),
              producerSourceAnalyses,
              requestLanguage,
              "producer",
              normalizedCanonicalExtraction.candidates,
            ),
            blockedProducerSourceIndexes,
          ),
          profile,
        ),
        "llm-assisted",
      );
    } catch (error) {
      console.error(
        "[goodmemory:remember] assisted extraction failed; preserving rules-only extraction",
        {
          error: error instanceof Error ? error.message : String(error),
          requestedExtractionStrategy,
        },
      );
      return {
        extraction: baselineExtraction,
        extractionWarning: "assisted_extraction_failed" as const,
        explicitOptOutSourceIndexes,
        optOutTargetSelectors,
        producerInput,
        profile,
        requestedExtractionStrategy,
        resolvedExtractionStrategy: "rules-only" as const,
      };
    }

    return {
      extraction: authorizeExtractionOccurrences(
        omitCandidatesFromSourceIndexes(
          dedupeExtractionResult(
            applyAnnotations(
              input,
              profile,
              mergeExtractionResults(baselineExtraction, assistedExtraction),
              sourceAnalyses,
              requestLanguage,
              explicitOptOutSourceIndexes,
            ),
          ),
          nonPersistableSourceIndexes,
        ),
        normalizedCanonicalExtraction.candidates,
        sourceAnalyses,
        requestLanguage,
      ),
      explicitOptOutSourceIndexes,
      optOutTargetSelectors,
      producerInput,
      profile,
      requestedExtractionStrategy,
      resolvedExtractionStrategy: "llm-assisted" as const,
    };
  };

  return {
    classifyCandidate,

    async extract(input: MemoryExtractionInput) {
      input = await prepareTemporalInput(input, config.repositories);
      const sourceAnalyses = analyzeRememberSourceMessages(input, language);
      const requestLanguage = resolveRequestLanguage(input, sourceAnalyses);
      const { extraction } = await resolveExtraction(
        input,
        sourceAnalyses,
        requestLanguage,
      );
      return extraction;
    },

    async remember(input: MemoryExtractionInput): Promise<EngineRememberResult> {
      input = await prepareTemporalInput(input, config.repositories);
      const sourceAnalyses = analyzeRememberSourceMessages(input, language);
      const requestLanguage = resolveRequestLanguage(input, sourceAnalyses);
      const resolvedLanguage = requestLanguage.context;
      const {
        extraction,
        extractionWarning,
        explicitOptOutSourceIndexes,
        optOutTargetSelectors,
        producerInput,
        profile,
        requestedExtractionStrategy,
        resolvedExtractionStrategy,
      } = await resolveExtraction(input, sourceAnalyses, requestLanguage);
      const writeCoordinator = createRememberWriteCoordinator(config.documentStore);
      const { rollbackActions } = writeCoordinator;
      const state: RememberWriteState = {
        accepted: 0,
        rejected: 0,
        events: [],
        pendingEmbeddingWrites: [],
        pendingClaimProjections: [],
        pendingVectorDeletes: [],
      };
      const episodeCandidates: MemoryCandidate[] = [];
      const storedLanguageContexts = new Map<string, typeof resolvedLanguage>();
      const sourceMessagesByIndex = new Map<number, SourceMessageRecord>();
      const setDocumentWithRollback = writeCoordinator.setDocument;
      const deleteDocumentWithRollback = writeCoordinator.deleteDocument;
      const writeDocumentBatchWithRollback =
        writeCoordinator.writeDocumentBatchWithRollback;
      const nonPersistableSourceIndexes = getNonPersistableMessageIndexes(input);
      const storageUnsafeOnlySourceIndexes = getStorageUnsafeOnlyMessageIndexes(
        input,
        extraction,
      );
      const persistenceSafeInput = maskMessages(
        input,
        new Set([
          ...nonPersistableSourceIndexes,
          ...storageUnsafeOnlySourceIndexes,
        ]),
      );

      try {
        const blockedSourceIndexes = new Set([
          ...getNeverAnnotatedMessageIndexes(input),
          ...nonPersistableSourceIndexes,
          ...storageUnsafeOnlySourceIndexes,
        ]);
        const policyBlockedSourceIndexes = new Set<number>();
        const policyRedactedCandidates = new Map<string, MemoryCandidate>();
        const redactCandidate = async (
          candidate: MemoryCandidate,
        ): Promise<MemoryCandidate> => {
          if (!config.policy?.redact) {
            return candidate;
          }
          const cached = policyRedactedCandidates.get(candidate.id);
          if (cached) {
            return cached;
          }
          const candidateLanguage = resolveCandidateLanguage(
            candidate,
            sourceAnalyses,
            requestLanguage,
          );
          const policyContext: PolicyContext = {
            scope: input.scope,
            phase: "remember",
            locale: candidateLanguage.locale,
            localeSource: candidateLanguage.localeSource,
          };
          const authorizedOccurrenceExpression =
            candidate.metadata?.occurrenceExpression;
          const redacted = await redactPolicyCandidate(
            config.policy,
            candidate,
            policyContext,
          );
          const {
            occurrenceExpression: _policyOccurrenceExpression,
            ...redactedMetadata
          } = redacted.metadata ?? {};
          const redactedCandidateWithoutTarget: MemoryCandidate = {
            ...candidate,
            disposition: candidate.disposition,
            durableTarget: undefined,
            kindHint: isDurableOptOutCandidate(candidate)
              ? candidate.kindHint
              : redacted.kindHint,
            content: redacted.content,
            extractionSources: candidate.extractionSources,
            metadata: redacted.metadata === undefined
              ? undefined
              : {
                  ...redactedMetadata,
                  ...(authorizedOccurrenceExpression
                    ? { occurrenceExpression: authorizedOccurrenceExpression }
                    : {}),
                },
            explicitness: redacted.explicitness,
          };
          const durableTarget = !isDurableOptOutCandidate(candidate)
            ? language.deriveDurableTarget?.(
                redactedCandidateWithoutTarget,
                candidateLanguage,
              )
            : undefined;
          const policyRedactedCandidate = {
            ...redactedCandidateWithoutTarget,
            ...(durableTarget ? { durableTarget } : {}),
          };
          policyRedactedCandidates.set(candidate.id, policyRedactedCandidate);
          return policyRedactedCandidate;
        };
        const ingestedAt = now();
        const preparedSourceMessages: Array<{
          messageIndex: number;
          record: SourceMessageRecord;
        }> = [];
        for (const [messageIndex, message] of input.messages.entries()) {
          if (blockedSourceIndexes.has(messageIndex)) {
            continue;
          }

          const sourceLanguage = sourceAnalyses.get(messageIndex) ?? requestLanguage;
          const policyContext: PolicyContext = {
            scope: input.scope,
            phase: "remember",
            locale: sourceLanguage.context.locale,
            localeSource: sourceLanguage.context.localeSource,
          };
          const sourceCandidates = extraction.candidates
            .filter((candidate) =>
              candidateSourceMessageIndexes(candidate).includes(messageIndex)
            )
            .sort((left, right) => right.content.length - left.content.length);
          let redactedContent = message.content;
          let sourceRedactionUnresolved = false;
          if (config.policy?.redact) {
            redactedContent = (await redactPolicyCandidate(
              config.policy,
              {
                id: `raw-source-${messageIndex + 1}`,
                kindHint: "noise",
                explicitness: "inferred",
                content: message.content,
                sourceMessageIndex: messageIndex,
                sourceRole: message.role,
              },
              policyContext,
            )).content;
            for (const sourceCandidate of sourceCandidates) {
              const redactedCandidate = await redactCandidate(sourceCandidate);
              if (redactedCandidate.content !== sourceCandidate.content) {
                if (!redactedContent.includes(sourceCandidate.content)) {
                  sourceRedactionUnresolved = true;
                  break;
                }
                redactedContent = redactedContent.replaceAll(
                  sourceCandidate.content,
                  redactedCandidate.content,
                );
              }
            }
          }
          if (sourceRedactionUnresolved) {
            continue;
          }
          if (!hasPersistableSemanticText(redactedContent)) {
            policyBlockedSourceIndexes.add(messageIndex);
            continue;
          }
          const sourceMessage = buildSourceMessageRecord(
            input.scope,
            { ...message, content: redactedContent },
            messageIndex,
            ingestedAt,
          );
          preparedSourceMessages.push({
            messageIndex,
            record: sourceMessage,
          });
        }
        for (const { messageIndex, record } of preparedSourceMessages) {
          sourceMessagesByIndex.set(messageIndex, record);
        }
        const policySafeInput: MemoryExtractionInput = {
          ...persistenceSafeInput,
          messages: persistenceSafeInput.messages.map((message, messageIndex) => ({
            ...message,
            content: sourceMessagesByIndex.get(messageIndex)?.content ?? "",
          })),
        };

        const storageUnsafeCandidateIds = new Set<string>();
        const rejectUngroundedOptOutSourceCandidate = (
          candidate: MemoryCandidate,
        ): boolean => {
          if (
            isDurableOptOutCandidate(candidate) ||
            isGroundedForExplicitOptOutSources(
              candidate,
              producerInput,
              explicitOptOutSourceIndexes,
              optOutTargetSelectors,
              sourceAnalyses,
              requestLanguage,
            )
          ) {
            return false;
          }
          const classified = classifyCandidate(candidate);
          state.rejected += 1;
          state.events.push({
            candidateId: candidate.id,
            outcome: "rejected",
            memoryType: toRememberEventMemoryType(classified.memoryType),
            reason: "explicit_opt_out",
            ...buildRememberEventTrace(candidate),
          });
          return true;
        };
        const rejectDurableOptOutTarget = (
          candidateId: string,
          candidate: ReturnType<typeof classifyCandidate>,
        ): boolean => {
          if (
            isDurableOptOutCandidate(candidate) ||
            !isTargetedByDurableOptOut(candidate, optOutTargetSelectors)
          ) {
            return false;
          }
          state.rejected += 1;
          state.events.push({
            candidateId,
            outcome: "rejected",
            memoryType: toRememberEventMemoryType(candidate.memoryType),
            reason: "explicit_opt_out",
            ...buildRememberEventTrace(candidate),
          });
          return true;
        };
        for (const candidate of extraction.candidates) {
          if (candidateTouchesSourceIndexes(candidate, policyBlockedSourceIndexes)) {
            state.rejected += 1;
            state.events.push({
              candidateId: candidate.id,
              outcome: "rejected",
              memoryType: toRememberEventMemoryType(
                classifyCandidate(candidate).memoryType,
              ),
              reason: "invalid_after_redaction",
              ...buildRememberEventTrace(candidate),
            });
            continue;
          }
          if (rejectUngroundedOptOutSourceCandidate(candidate)) {
            continue;
          }
          if (!isCandidateSourceAllowed(candidate, profile, input)) {
            state.rejected += 1;
            state.events.push({
              candidateId: candidate.id,
              outcome: "rejected",
              memoryType: toRememberEventMemoryType("reject"),
              reason: "assistant_policy_blocked",
              ...buildRememberEventTrace(candidate),
            });
            continue;
          }

          const classified = classifyCandidate(candidate);

          if (
            classified.decision === "reject" ||
            (config.shouldWrite && !config.shouldWrite(classified))
          ) {
            if (classified.reason === "storage_unsafe") {
              storageUnsafeCandidateIds.add(candidate.id);
            }
            state.rejected += 1;
            state.events.push({
              candidateId: candidate.id,
              outcome: "rejected",
              memoryType: toRememberEventMemoryType(classified.memoryType),
              reason: classified.reason ?? "policy_rejected",
              ...buildRememberEventTrace(classified),
            });
            continue;
          }

          let effectiveCandidate = classified;
          const candidateLanguage = resolveCandidateLanguage(
            classified,
            sourceAnalyses,
            requestLanguage,
          );
          const policyContext: PolicyContext = {
            scope: input.scope,
            phase: "remember",
            locale: candidateLanguage.locale,
            localeSource: candidateLanguage.localeSource,
          };

          if (rejectDurableOptOutTarget(candidate.id, effectiveCandidate)) {
            continue;
          }

          if (config.policy?.redact) {
            effectiveCandidate = classifyCandidate(
              await redactCandidate(effectiveCandidate),
            );

            if (effectiveCandidate.decision === "reject") {
              if (effectiveCandidate.reason === "storage_unsafe") {
                storageUnsafeCandidateIds.add(candidate.id);
              }
              state.rejected += 1;
              state.events.push({
                candidateId: candidate.id,
                outcome: "rejected",
                memoryType: toRememberEventMemoryType(effectiveCandidate.memoryType),
                reason:
                  effectiveCandidate.reason === "invalid_payload"
                    ? "invalid_after_redaction"
                    : effectiveCandidate.reason ?? "policy_redacted_invalid",
                ...buildRememberEventTrace(effectiveCandidate),
              });
              continue;
            }
          }

          if (rejectDurableOptOutTarget(candidate.id, effectiveCandidate)) {
            continue;
          }

          if (!(await evaluateShouldRemember(
            config.policy,
            effectiveCandidate,
            policyContext,
          ))) {
            state.rejected += 1;
            state.events.push({
              candidateId: candidate.id,
              outcome: "rejected",
              memoryType: toRememberEventMemoryType(effectiveCandidate.memoryType),
              reason: "policy_blocked",
              ...buildRememberEventTrace(effectiveCandidate),
            });
            continue;
          }

          storedLanguageContexts.set(
            storedTextLanguageKey(
              effectiveCandidate.content,
              candidateLanguage.locale,
            ),
            candidateLanguage,
          );
          const acceptedBeforeWrite = state.accepted;
          await writeRememberCandidate({
            candidateId: candidate.id,
            candidate: effectiveCandidate,
            context: {
              input,
              candidateLanguage,
              language,
              storedLanguageContexts,
              policyContext,
              repositories: config.repositories,
              vectorIndex,
              createId,
              now,
              policy: config.policy,
              sourceMessagesByIndex,
              setDocumentWithRollback,
              deleteDocumentWithRollback,
              writeDocumentBatchWithRollback,
            },
            state,
          });

          if (state.accepted > acceptedBeforeWrite) {
            episodeCandidates.push(effectiveCandidate);
          }
        }

        const persistedSourceMessages = await persistSourceMessageRecords(
          config.documentStore,
          preparedSourceMessages.flatMap(({ messageIndex, record }) => {
            const candidates = extraction.candidates.filter((candidate) =>
              candidateSourceMessageIndexes(candidate).includes(messageIndex)
            );
            return candidates.length > 0 && candidates.every((candidate) =>
                storageUnsafeCandidateIds.has(candidate.id)
              )
              ? []
              : [record];
          }),
        );
        for (const [messageIndex, sourceMessage] of sourceMessagesByIndex) {
          sourceMessagesByIndex.set(
            messageIndex,
            persistedSourceMessages.get(sourceMessage.id) ?? sourceMessage,
          );
        }

        const episodes = buildEpisodes(
          maskMessages(policySafeInput, policyBlockedSourceIndexes),
          episodeCandidates,
          createId,
          now(),
          language,
          resolvedLanguage.locale,
          sourceAnalyses,
          config.remember?.episodeSegmentTimeGapMs !== undefined
            ? { segmentTimeGapMs: config.remember.episodeSegmentTimeGapMs }
            : undefined,
        );
        for (const episode of episodes) {
          await setDocumentWithRollback("episodes", episode.id, episode);
          state.pendingEmbeddingWrites.push(buildEpisodeEmbeddingWrite(episode));
          state.accepted += 1;
          state.events.push({
            candidateId: `episode:${episode.id}`,
            outcome: "written",
            memoryType: "episode",
            memoryId: episode.id,
            reason: "conversation_episode",
            sourceMethod: "explicit",
            extractionSources: ["rules-only"],
          });
        }

        state.rejected += extraction.ignoredMessageCount;

        await commitRememberVectors({
          embedding: config.embedding,
          rollbackActions,
          state,
          vectorIndex,
        });

        if (config.claimProjection) {
          for (const claim of state.pendingClaimProjections) {
            await config.claimProjection.appendClaim(claim);
          }
        }

        await writeCoordinator.releaseOwnership();

        const warnings: string[] = [];
        if (extractionWarning) {
          warnings.push(extractionWarning);
        }
        if (
          state.accepted === 0 &&
          input.messages.length > 0 &&
          extraction.candidates.length === 0 &&
          extraction.ignoredMessageCount === 0
        ) {
          warnings.push("no_durable_facts_extracted");
        }

        return {
          accepted: state.accepted,
          rejected: state.rejected,
          events: state.events,
          outcome: extractionWarning
            ? "failed"
            : state.accepted > 0
              ? "committed"
              : "no_admissible_candidate",
          ...(warnings.length > 0 ? { warnings } : {}),
          metadata: {
            locale: resolvedLanguage.locale,
            localeSource: resolvedLanguage.localeSource,
            languagePackId: resolvedLanguage.languagePackId,
            languagePackVersion: resolvedLanguage.languagePackVersion,
            analysisMode: resolvedLanguage.analysisMode,
            requestedExtractionStrategy,
            resolvedExtractionStrategy,
          },
        };
      } catch (error) {
        const rollbackErrors = await rollbackRememberWrites(rollbackActions);
        await writeCoordinator.releaseOwnership();
        if (rollbackErrors.length > 0) {
          throw new AggregateError(
            [error, ...rollbackErrors],
            "Remember failed and rollback encountered errors.",
          );
        }

        throw error;
      }
    },
  };
}
