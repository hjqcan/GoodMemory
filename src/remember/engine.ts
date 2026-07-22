import { buildEpisodeEmbeddingWrite } from "../embedding/vectorWrites";
import { createLanguageService } from "../language";
import type { PolicyContext } from "../policy/hooks";
import { extractDeterministicMemoryWithLanguage } from "./deterministicExtractor";
import { maybeBuildEpisode } from "./episodes";
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
import type {
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

  const maskNeverAnnotatedMessages = (
    input: MemoryExtractionInput,
  ): MemoryExtractionInput => {
    const blockedIndexes = getNeverAnnotatedMessageIndexes(input);
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

  const isAssistantWriteAllowed = (
    candidate: MemoryCandidate,
    profile: ResolvedRememberProfile,
    input: MemoryExtractionInput,
  ): boolean => {
    if (candidate.sourceRole !== "assistant") {
      return true;
    }

    const annotation = findAnnotation(input, candidate.sourceMessageIndex);
    if (!annotation || annotation.remember !== "always") {
      return false;
    }

    if (profile.assistantOutputs.mode === "host_tagged_only") {
      return true;
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
  };

  const applyAnnotations = (
    input: MemoryExtractionInput,
    profile: ResolvedRememberProfile,
    extraction: MemoryExtractionResult,
    sourceAnalyses: RememberSourceLanguageAnalyses,
    requestLanguage: RememberSourceLanguageAnalysis,
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
    result: MemoryExtractionResult,
    sourceAnalyses: RememberSourceLanguageAnalyses,
    requestLanguage: RememberSourceLanguageAnalysis,
  ): MemoryExtractionResult => {
    return {
      ...result,
      candidates: result.candidates.map((candidate) => {
        const sourceLanguage = candidateSourceLanguageAnalysis(
          candidate,
          sourceAnalyses,
        ) ?? requestLanguage;
        return normalizeMemoryCandidate(
          candidate,
          request.messages[candidate.sourceMessageIndex]?.content,
          {
            analysis: sourceLanguage.analysis,
            language,
            resolved: sourceLanguage.context,
          },
        );
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
    const extractorInput = maskNeverAnnotatedMessages(input);
    const requestedExtractionStrategy = resolveRequestedExtractionStrategy(
      input.extractionStrategy,
    );
    const baselineResult = extractor
      ? await extractor.extract(extractorInput)
      : extractDeterministicMemoryWithLanguage(
          extractorInput,
          language,
          sourceAnalyses,
        );
    let baselineExtraction = annotateExtractionResult(
      applyProfileTrace(
        normalizeExtractionResult(
          input,
          baselineResult,
          sourceAnalyses,
          requestLanguage,
        ),
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
            await profileRuleExtractor.extract(extractorInput),
            sourceAnalyses,
            requestLanguage,
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
            await profileExtractor.extractor.extract(extractorInput),
            sourceAnalyses,
            requestLanguage,
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

    baselineExtraction = dedupeExtractionResult(
      applyAnnotations(
        input,
        profile,
        baselineExtraction,
        sourceAnalyses,
        requestLanguage,
      ),
    );

    const shouldRunAssistedExtraction =
      requestedExtractionStrategy === "llm-assisted" ||
      (requestedExtractionStrategy === "auto" &&
        shouldAutoUseAssistedExtraction({
          request: extractorInput,
          baselineExtraction,
          sourceAnalyses,
        }));

    if (!shouldRunAssistedExtraction || !assistedExtractor) {
      return {
        extraction: baselineExtraction,
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
          normalizeExtractionResult(
            input,
            await assistedExtractor.extract({
              ...extractorInput,
              extractionStrategy: "llm-assisted",
            }, knownUserName ? { knownUserName } : undefined),
            sourceAnalyses,
            requestLanguage,
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
        profile,
        requestedExtractionStrategy,
        resolvedExtractionStrategy: "rules-only" as const,
      };
    }

    return {
      extraction: dedupeExtractionResult(
        applyAnnotations(
          input,
          profile,
          mergeExtractionResults(baselineExtraction, assistedExtraction),
          sourceAnalyses,
          requestLanguage,
        ),
      ),
      profile,
      requestedExtractionStrategy,
      resolvedExtractionStrategy: "llm-assisted" as const,
    };
  };

  return {
    classifyCandidate,

    async extract(input: MemoryExtractionInput) {
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
      const sourceAnalyses = analyzeRememberSourceMessages(input, language);
      const requestLanguage = resolveRequestLanguage(input, sourceAnalyses);
      const resolvedLanguage = requestLanguage.context;
      const {
        extraction,
        extractionWarning,
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
      const setDocumentWithRollback = writeCoordinator.setDocument;
      const deleteDocumentWithRollback = writeCoordinator.deleteDocument;

      try {
        for (const candidate of extraction.candidates) {
          if (!isAssistantWriteAllowed(candidate, profile, input)) {
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

          if (config.policy?.redact) {
            const redacted = await config.policy.redact(effectiveCandidate, policyContext);
            const redactedCandidate: MemoryCandidate = {
              ...effectiveCandidate,
              kindHint: redacted.kindHint,
              content: redacted.content,
              extractionSources: effectiveCandidate.extractionSources,
              metadata: redacted.metadata,
              explicitness: redacted.explicitness,
            };
            effectiveCandidate = classifyCandidate(redactedCandidate);

            if (effectiveCandidate.decision === "reject") {
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

          if (
            config.policy?.shouldRemember &&
            !(await config.policy.shouldRemember(effectiveCandidate, policyContext))
          ) {
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
              setDocumentWithRollback,
              deleteDocumentWithRollback,
            },
            state,
          });

          if (state.accepted > acceptedBeforeWrite) {
            episodeCandidates.push(effectiveCandidate);
          }
        }

        const episode = maybeBuildEpisode(
          input,
          episodeCandidates,
          createId(),
          now(),
          language,
          resolvedLanguage.locale,
          sourceAnalyses,
        );
        if (episode) {
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
