import { requiresFinalSourceGrounding, sourceAttributionSnapshot } from "../language/speakerAttribution";
import { matchesAttributionSnapshot } from "../language/attributionSnapshot";
import { sourcePreferenceStatement } from "../language/personalPreferences";
import { hasPersistableSemanticText } from "../domain/semanticText";
import { buildEpisodeEmbeddingWrite } from "../embedding/vectorWrites";
import type { SourceMessageRecord } from "../evidence/contracts";
import type { LanguageContentAnalysis } from "../language";
import {
  evaluateShouldRemember,
  redactPolicyCandidate,
} from "../policy/hooks";
import type { PolicyContext } from "../policy/hooks";
import { buildEpisodes } from "./episodes";
import { writeRememberCandidate } from "./handlers";
import {
  buildRememberEventTrace,
  classifyCandidate,
  toRememberEventMemoryType,
} from "./classification";
import { buildSourceMessageRecord } from "./builders";
import type {
  MemoryCandidate,
  MemoryExtractionInput,
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
import { storedTextLanguageKey } from "./languageAnalysis";
import {
  commitRememberVectors,
  rollbackRememberWrites,
} from "./vectorOps";
import { createRememberWriteCoordinator } from "./writeOwnership";
import {
  candidateSourceMessageIndexes,
  candidateTouchesSourceIndexes,
  persistSourceMessageRecords,
} from "./sourceMessages";
import type {
  createRememberExtractionPipeline,
} from "./extractionPipeline";

type EngineRememberResult = RememberResult & { outcome: ExtractionOutcome };
type RememberExtractionPipeline =
  ReturnType<typeof createRememberExtractionPipeline>;

export function createRememberWritePipeline(
  config: RememberEngineConfig,
  extractionPipeline: RememberExtractionPipeline,
) {
  const {
    createId,
    getNeverAnnotatedMessageIndexes,
    getNonPersistableMessageIndexes,
    getStorageUnsafeOnlyMessageIndexes,
    isCandidateSourceAllowed,
    isGroundedForExplicitOptOutSources,
    language,
    maskMessages,
    now,
    resolveCandidateLanguage,
    vectorIndex,
  } = extractionPipeline;

  return {
    async remember(input: MemoryExtractionInput): Promise<EngineRememberResult> {
      const resolved = await extractionPipeline.resolve(input);
      input = resolved.input;
      const {
        extraction: producerExtraction,
        extractionWarning,
        explicitOptOutSourceIndexes,
        optOutTargetSelectors,
        producerInput,
        profile,
        requestLanguage,
        requestedExtractionStrategy,
        resolvedExtractionStrategy,
        resolvedLanguage,
        sourceAnalyses,
      } = resolved;
      // Enrichment is source-derived and must precede the FIRST redaction call,
      // including the source-preparation pass and its per-candidate cache.
      const extraction = {
        ...producerExtraction,
        candidates: producerExtraction.candidates.map((candidate) => {
          if (candidate.kindHint !== "preference") return candidate;
          const value = String(candidate.metadata?.preferenceValue ?? candidate.content);
          const sources = candidateSourceMessageIndexes(candidate)
            .map((index) => input.messages[index])
            .filter((message) => message?.role === "user")
            .map((message) => message!.content);
          const statement = sourcePreferenceStatement(value, sources);
          if (!statement || statement.renderedValue === value) return candidate;
          return { ...candidate, content: statement.renderedValue,
            metadata: { ...candidate.metadata, preferenceValue: statement.renderedValue } };
        }),
      };
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
      const candidateContentAnalyses = new Map<string, LanguageContentAnalysis>();
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
            const sourceRedactions: Array<{ original: MemoryCandidate; redacted: MemoryCandidate }> = [];
            for (const original of sourceCandidates) {
              sourceRedactions.push({ original, redacted: await redactCandidate(original) });
            }
            for (const { original: sourceCandidate, redacted: redactedCandidate } of sourceRedactions) {
              if (redactedCandidate.content !== sourceCandidate.content) {
                if (!redactedContent.includes(sourceCandidate.content)) {
                  // A raw-source redaction or an earlier, containing candidate
                  // may already have applied this exact replacement. Require
                  // both original-source support and final redacted support;
                  // never recover a missing span from the original raw text.
                  if (message.content.includes(sourceCandidate.content) &&
                    redactedContent.includes(redactedCandidate.content) &&
                    sourceRedactions.every(({ redacted }) => redactedContent.includes(redacted.content))) continue;
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

        const personalSourceCandidates = new Map<string, MemoryCandidate[]>();
        // Operation-local snapshots remain bound to their original index and
        // phase. Redacted content cannot reuse an original ownership view.
        const attributionViews = {
          original: producerInput.messages.map((message, sourceMessageIndex) =>
            sourceAttributionSnapshot(message.content, { sourceMessageIndex, phase: "original" })),
          safe: policySafeInput.messages.map((message, sourceMessageIndex) =>
            sourceAttributionSnapshot(message.content, { sourceMessageIndex, phase: "safe" })),
        };
        const hasAttributionRisk = Object.values(attributionViews).some((views) =>
          views.some((view) => view.hasRestrictions));
        const withheldSources = attributionViews.original.map((view) => view.withheldText);
        const safeWithheldSources = attributionViews.safe.map((view) => view.withheldText);
        const hasPersonalSourceSupport = (
          target: MemoryCandidate,
          source: MemoryExtractionInput["messages"][number] | undefined,
          index: number,
          phase: "original" | "safe",
          requiresCurrentAssertion: boolean,
          withheld: readonly string[],
        ): boolean => {
          const view = attributionViews[phase][index];
          if (!source || source.role !== "user" || !view ||
            !matchesAttributionSnapshot(view, source.content, { sourceMessageIndex: index, phase })) return false;
          const sourceLanguage = sourceAnalyses.get(index)?.context ?? requestLanguage.context;
          const targetValue = target.kindHint === "preference"
            ? target.metadata?.preferenceValue ?? target.content
            : target.content;
          const value = language.normalizeForEquality(targetValue, sourceLanguage);
          const borrowedFromWithheldSource = withheld.some((text) =>
            language.normalizeForEquality(text, sourceLanguage).includes(value));
          const authorSource = view.authorText;
          // Keep open assisted grammar only when the value is supported in the
          // author view and is not borrowed from an external claim in this view.
          if (!requiresCurrentAssertion && value.length > 0 &&
            !borrowedFromWithheldSource &&
            language.normalizeForEquality(authorSource, sourceLanguage).includes(value)) return true;
          const cacheKey = `${requiresCurrentAssertion ? "current" : "personal"}:${phase}:${index}`;
          let grounded = personalSourceCandidates.get(cacheKey);
          if (!grounded) {
            let next = 0;
            grounded = language.extractCandidates({
              messages: [{ ...source, content: authorSource, sourceMessageIndex: index }],
              locale: sourceLanguage.locale,
              nextId: () => `attributed-${phase}-${index}-${++next}`,
            }, sourceLanguage);
            personalSourceCandidates.set(cacheKey, grounded);
          }
          return grounded.some((item) => item.kindHint === target.kindHint &&
            (target.kindHint !== "profile" ||
              (item.metadata?.profileField ?? "name") === (target.metadata?.profileField ?? "name")) &&
            language.normalizeForEquality(item.kindHint === "preference"
              ? sourcePreferenceStatement(String(item.metadata?.preferenceValue ?? item.content), [source.content])?.renderedValue ?? item.metadata?.preferenceValue ?? item.content
              : item.content, sourceLanguage) === value);
        };
        const personalCandidateIsGrounded = (candidate: MemoryCandidate, original: MemoryCandidate): boolean => {
          // Read the restriction from the original candidate: a redactor that
          // returns a new object must not accidentally erase this requirement.
          const requiresDerivedSource = requiresFinalSourceGrounding(original);
          if (!requiresDerivedSource && candidate.kindHint !== "profile" && candidate.kindHint !== "preference") return true;
          const indexes = candidateSourceMessageIndexes(candidate);
          const originalIndexes = new Set(candidateSourceMessageIndexes(original));
          const requiresCurrentAssertion = requiresDerivedSource || (candidate.kindHint === "profile" &&
            candidate.metadata?.profileField === "currentProject" &&
            /^(?:en|zh-Hans|zh-Hant)$/u.test(
              resolveCandidateLanguage(candidate, sourceAnalyses, requestLanguage).languagePackId,
            ));
          // Producer indexes cannot turn off the risk check. Redaction may
          // remove a document boundary, but cannot create original authorship.
          if (!hasAttributionRisk && !requiresCurrentAssertion) return true;
          return indexes.some((index) =>
            originalIndexes.has(index) &&
            hasPersonalSourceSupport(original, producerInput.messages[index], index,
              "original", requiresCurrentAssertion, withheldSources) &&
            // Only final policy-safe text can support the final stored value;
            // the original proof must never restore a value redaction removed.
            hasPersonalSourceSupport(candidate, policySafeInput.messages[index], index,
              "safe", requiresCurrentAssertion, safeWithheldSources));
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

          if (!personalCandidateIsGrounded(effectiveCandidate, candidate)) {
            state.rejected += 1;
            state.events.push({
              candidateId: candidate.id, outcome: "rejected",
              memoryType: toRememberEventMemoryType(effectiveCandidate.memoryType),
              reason: "unattributed_personal_claim", ...buildRememberEventTrace(effectiveCandidate),
            });
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
              candidateContentAnalyses,
              policyContext,
              repositories: config.repositories,
              vectorIndex,
              createId,
              now,
              policy: config.policy,
              sourceMessagesByIndex,
              sourceAnalyses,
              persistSourceMessageRecord: async (record) =>
                (await persistSourceMessageRecords(config.documentStore, [record])).get(record.id)!,
              getDocument: (collection, id) => config.documentStore.get(collection, id),
              queryDocuments: (collection, filter) => config.documentStore.query(collection, filter),
              setDocumentWithRollback,
              deleteDocumentWithRollback,
              writeDocumentBatchWithRollback,
              writeConditionalBatchWithRollback: writeCoordinator.writeConditionalBatchWithRollback,
            },
            state,
          });

          // Notes are authored pages, not conversation; they never seed an
          // episode (which would duplicate the page as a summary).
          if (
            state.accepted > acceptedBeforeWrite &&
            effectiveCandidate.memoryType !== "note"
          ) {
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
