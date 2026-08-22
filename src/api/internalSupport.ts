import { assertStorageSafeExternalValue } from "../domain/semanticText";
import type { MemoryScope } from "../domain/scope";
import type { FactSelector } from "../recall/generalizedSelection";
import type { RecallRouterAssistant } from "../recall/assistant";
import type { RetrievalStrategyRolloutConfig } from "../governance/retrievalInternalRollout";
import { attachGoodMemoryEvalSupport } from "./evalSupport";
import type { GoodMemoryEvalSupport } from "./evalSupport";
import { createAgentEventIngestor } from "./agentEventIngestion";
import { submitAgentEventCorrection } from "./feedbackOps";
import { recordHostActionAssessment } from "./hostActionAssessmentOps";
import { wrapInternalRetrievalRolloutMemory } from "./internalRetrievalRollout";
import { attachGoodMemoryIntegrationSupport } from "./integrationSupport";
import type { GoodMemoryIntegrationSupport } from "./integrationSupport";
import {
  attachGoodMemoryRuntimeInfo,
  buildGoodMemoryRuntimeInfo,
} from "./runtimeInfo";
import type { GoodMemory, GoodMemoryConfig } from "./contracts";
import type { GoodMemoryAssembly } from "./goodMemoryAssembly";

export interface InternalGoodMemoryOptions {
  assistedRecallRouter?: RecallRouterAssistant;
  assistedReviewer?: boolean;
  behavioralOutcomeRecorder?: boolean;
  /** Repo-only fixed-budget recall-pass coverage experiment. */
  distinctRecallPassHeadProtection?: boolean;
  environment?: Record<string, string | undefined>;
  /** Repo-only instance selector override for historical evaluation profiles. */
  factSelector?: FactSelector;
  projectionBulkBackfill?: boolean;
  /** Repo-only hook for sealing derived projection state before immutable replay. */
  projectionPreparationSupport?: boolean;
  projectionWriteThrough?: boolean;
  providerRerankingStrategy?: "listwise" | "pointwise";
  retrievalStrategyRollout?: RetrievalStrategyRolloutConfig;
  runtimeCompactionExtraction?: boolean;
  /** Repo-only immutable SQLite view; also disables post-recall mutations. */
  sqliteReadOnly?: boolean;
  /** Internal host surface switch for recall diagnostics that must not persist observations. */
  postRecallMutations?: boolean;
}

export function attachInternalGoodMemorySupport(input: {
  assembly: GoodMemoryAssembly;
  config: GoodMemoryConfig;
  impl: GoodMemory;
  internal?: InternalGoodMemoryOptions;
}): GoodMemory {
  const { assembly, config, impl, internal } = input;
  const memory = wrapInternalRetrievalRolloutMemory(impl, {
    assistedRecallRouterEnabled: Boolean(internal?.assistedRecallRouter),
    languageService: assembly.language,
    now: config.testing?.now,
    rollout: internal?.retrievalStrategyRollout,
  });
  const integrationSupport: GoodMemoryIntegrationSupport = {
    language: assembly.language,
    ingestAgentInputEvent: ({ event }) =>
      createAgentEventIngestor({
        documentStore: assembly.documentStore,
        submitCorrection: (correction) =>
          submitAgentEventCorrection({
            evolutionRuntime: assembly.evolutionRuntime,
            language: assembly.language,
            appliesTo: correction.appliesTo,
            locale: correction.locale,
            scope: correction.scope,
            signal: correction.signal,
            ...(correction.evidenceIds
              ? { evidenceIds: correction.evidenceIds }
              : {}),
            strictExperience: true,
            ...(correction.traceId ? { traceId: correction.traceId } : {}),
          }),
        language: assembly.language,
        now: assembly.now,
        policy: config.policy,
        persist: ({ evidence, experience, scope }) =>
          assembly.evolutionRuntime.handleAgentEvent({
            scope,
            ...(evidence ? { evidence } : {}),
            ...(experience ? { experience } : {}),
          }),
      }).ingest(event),
    ingestHostAgentEvent: ({ event }) =>
      createAgentEventIngestor({
        documentStore: assembly.documentStore,
        submitCorrection: (correction) =>
          submitAgentEventCorrection({
            evolutionRuntime: assembly.evolutionRuntime,
            language: assembly.language,
            appliesTo: correction.appliesTo,
            locale: correction.locale,
            scope: correction.scope,
            signal: correction.signal,
            ...(correction.evidenceIds
              ? { evidenceIds: correction.evidenceIds }
              : {}),
            strictExperience: true,
            ...(correction.traceId ? { traceId: correction.traceId } : {}),
          }),
        language: assembly.language,
        now: assembly.now,
        policy: config.policy,
        persist: ({ evidence, experience, scope }) =>
          assembly.evolutionRuntime.handleAgentEvent({
            scope,
            ...(evidence ? { evidence } : {}),
            ...(experience ? { experience } : {}),
          }),
      }).ingest(event),
    recordHostActionAssessment: ({ assessment }) =>
      recordHostActionAssessment({
        assessment,
        documentStore: assembly.documentStore,
        persist: ({ experience, scope }) =>
          assembly.evolutionRuntime.handleAgentEvent({ scope, experience }),
      }),
  };
  type BehavioralOutcomeSupportInput = Parameters<
    Exclude<GoodMemoryEvalSupport["recordBehavioralOutcome"], undefined>
  >[0];
  const support = {
    ...(internal?.assistedRecallRouter ? { assistedRecallRouter: true } : {}),
    ...(internal?.assistedReviewer ? { assistedReviewer: true } : {}),
    ...(internal?.projectionPreparationSupport
      ? {
          prepareProjectionScope: async (scope: MemoryScope) => {
            const result = await assembly.projectionRuntime?.ensureScopeIndexed(scope);
            if (result?.complete !== true) {
              throw new Error(
                "GoodMemory projection preparation did not complete.",
              );
            }
          },
        }
      : {}),
    ...(internal?.behavioralOutcomeRecorder
      ? {
          recordBehavioralOutcome: (outcome: BehavioralOutcomeSupportInput) => {
            assertStorageSafeExternalValue(outcome, "input");
            return assembly.evolutionRuntime.handleBehavioralOutcome({
              scope: outcome.scope,
              result: {
                cue: outcome.cue,
                evidenceExcerpt: outcome.evidenceExcerpt,
                failureClass: outcome.failureClass,
                firstAction: outcome.firstAction,
                modelInfluence: outcome.modelInfluence ?? "rules-only",
                outcome: outcome.outcome,
                retrievalProfile: outcome.retrievalProfile,
                saferAlternative: outcome.saferAlternative,
              },
              traceId: outcome.traceId,
            });
          },
        }
      : {}),
  };
  const runtimeAwareMemory = attachGoodMemoryRuntimeInfo(
    memory,
    buildGoodMemoryRuntimeInfo(assembly.runtimeResolution),
  );
  const integrationAwareMemory = attachGoodMemoryIntegrationSupport(
    runtimeAwareMemory,
    integrationSupport,
  );

  return Object.keys(support).length === 0
    ? integrationAwareMemory
    : attachGoodMemoryEvalSupport(integrationAwareMemory, support);
}
