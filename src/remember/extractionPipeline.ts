import {
  durableOptOutTargetIdentities,
} from "../domain/memoryCandidate";
import { hasPersistableSemanticText } from "../domain/semanticText";
import { createLanguageService } from "../language";
import { extractDeterministicMemoryWithLanguage } from "./deterministicExtractor";
import {
  annotateExtractionResult,
  dedupeExtractionResult,
  mergeExtractionResults,
} from "./extraction";
import {
  analyzeRememberSourceMessages,
  candidateSourceLanguageAnalysis,
  primarySourceLanguageAnalysis,
} from "./languageAnalysis";
import type {
  RememberSourceLanguageAnalyses,
  RememberSourceLanguageAnalysis,
} from "./languageAnalysis";
import { classifyCandidate } from "./classification";
import type {
  DurableOptOutTargetSelector,
  MessageAnnotation,
  MemoryCandidate,
  MemoryCandidateMetadata,
  MemoryExtractionInput,
  MemoryExtractionResult,
  MemoryExtractionStrategy,
} from "./candidates";
import type { RememberEngineConfig } from "./contracts";
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
import {
  candidateSourceMessageIndexes,
  candidateTouchesSourceIndexes,
  omitCandidatesFromSourceIndexes,
  prepareTemporalInput,
} from "./sourceMessages";

export function createRememberExtractionPipeline(config: RememberEngineConfig) {
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

  const resolve = async (input: MemoryExtractionInput) => {
    const preparedInput = await prepareTemporalInput(input, config.repositories);
    const sourceAnalyses = analyzeRememberSourceMessages(preparedInput, language);
    const requestLanguage = resolveRequestLanguage(preparedInput, sourceAnalyses);
    return {
      input: preparedInput,
      sourceAnalyses,
      requestLanguage,
      resolvedLanguage: requestLanguage.context,
      ...await resolveExtraction(
        preparedInput,
        sourceAnalyses,
        requestLanguage,
      ),
    };
  };

  return {
    classifyCandidate,
    createId,
    extract: async (input: MemoryExtractionInput) =>
      (await resolve(input)).extraction,
    getNeverAnnotatedMessageIndexes,
    getNonPersistableMessageIndexes,
    getStorageUnsafeOnlyMessageIndexes,
    isCandidateSourceAllowed,
    isGroundedForExplicitOptOutSources,
    language,
    maskMessages,
    now,
    resolve,
    resolveCandidateLanguage,
    vectorIndex,
  };
}
