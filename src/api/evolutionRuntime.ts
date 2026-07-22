import { createMemorySource } from "../domain/provenance";
import type {
  FactMemory,
  FeedbackKind,
  FeedbackMemory,
} from "../domain/records";
import { scopeToKey } from "../domain/scope";
import type { MemoryScope } from "../domain/scope";
import {
  createEvidenceRecord,
  type EvidenceRecord,
} from "../evidence/contracts";
import type { ExperienceRecord, LearningProposal } from "../evolution/contracts";
import {
  buildBehavioralOutcomeExperienceRecord,
  type BehavioralOutcomeObservationResult,
  toStoredExperienceRecord,
} from "../evolution/behavioralTelemetry";
import {
  buildFeedbackExperienceRecord,
  buildRecallExperienceRecords,
  buildRememberExperienceRecord,
} from "../evolution/observations";
import type {
  FeedbackObservationResult,
  RecallObservationResult,
  RememberObservationResult,
} from "../evolution/observation-results";
import type {
  GovernanceRepositoryPort,
} from "../storage/ports";
import type {
  FeedbackInput,
  FeedbackResult,
  RecallInput,
  RecallResult,
  RememberInput,
  RememberResult,
  RunMaintenanceInput,
  RunMaintenanceResult,
} from "./contracts";
import type {
  AgentEventPromotionReceipt,
  AgentEventProposalReceipt,
} from "./integrationSupport";
import type { ProposalGateDecision } from "../evolution/gates";
import type { LanguageService } from "../language";

interface RecallTouchSummary {
  reinforcedFeedbackCount: number;
  touchedFactCount: number;
  verificationPressureFactCount: number;
}

interface ReviewerRuntime {
  review(input: { scope: MemoryScope }): Promise<LearningProposal[]>;
}

interface ProposalGateRuntime {
  process(input: {
    proposals: LearningProposal[];
    scope: MemoryScope;
  }): Promise<ProposalGateDecision[]>;
}

interface ProceduralCompilerRuntime {
  compile(scope: MemoryScope): Promise<{ compiledCount: number }>;
}

interface DreamMaintenanceRuntime {
  run(input: {
    lastRunAt?: string;
    maintenanceJobs?: RunMaintenanceInput["jobs"];
    minHoursBetweenRuns: number;
    minSessionCount: number;
    now: string;
    scope: MemoryScope;
    scopeKey: string;
    sessionCountSinceLastRun: number;
  }): Promise<RunMaintenanceResult>;
}

export interface EvolutionRuntimeConfig {
  compiler: ProceduralCompilerRuntime;
  dreamMaintenance: DreamMaintenanceRuntime;
  governanceRepositories: GovernanceRepositoryPort;
  language: LanguageService;
  now?: () => string;
  proposalGate: ProposalGateRuntime;
  reviewer: ReviewerRuntime;
}

const LOW_RISK_RECALL_TOUCH_WINDOW_MS = 5 * 60 * 1000;
const MAX_VERIFICATION_PRESSURE_COUNT = 4;

function encodeExperienceIdSegment(value: string): string {
  return encodeURIComponent(value);
}

function createAgentCorrectionExperienceId(input: {
  scope: MemoryScope;
  traceId: string;
}): string {
  return [
    "agent_event.feedback",
    `scope=${encodeExperienceIdSegment(scopeToKey(input.scope))}`,
    `trace=${encodeExperienceIdSegment(input.traceId)}`,
  ].join("|");
}

function shouldApplyLowRiskTouch(
  previousTimestamp: string | undefined,
  nextTimestamp: string,
): boolean {
  if (!previousTimestamp) {
    return true;
  }

  const previousMs = new Date(previousTimestamp).getTime();
  const nextMs = new Date(nextTimestamp).getTime();

  if (!Number.isFinite(previousMs) || !Number.isFinite(nextMs)) {
    return true;
  }

  return nextMs - previousMs >= LOW_RISK_RECALL_TOUCH_WINDOW_MS;
}

async function applyRecallTouchHelpers(
  repositories: GovernanceRepositoryPort,
  result: RecallResult,
  timestamp: string,
): Promise<RecallTouchSummary> {
  const touchedFacts = new Map<string, FactMemory>();
  const verificationHintFactIds = new Set(
    result.metadata.verificationHints
      .filter((hint) => hint.memoryType === "fact")
      .map((hint) => hint.memoryId),
  );
  const pressureFacts = result.facts
    .filter(
      (fact) =>
        fact.lifecycle === "active" &&
        verificationHintFactIds.has(fact.id),
    )
    .map((fact) => {
      const pressuredFact: FactMemory = {
        ...fact,
        verificationPressureCount: Math.min(
          (fact.verificationPressureCount ?? 0) + 1,
          MAX_VERIFICATION_PRESSURE_COUNT,
        ),
        lastVerificationHintAt: timestamp,
      };

      touchedFacts.set(pressuredFact.id, pressuredFact);
      return pressuredFact;
    });
  const nextFacts = result.facts
    .filter(
      (fact) =>
        fact.lifecycle === "active" &&
        !verificationHintFactIds.has(fact.id) &&
        shouldApplyLowRiskTouch(fact.lastAccessedAt, timestamp),
    )
    .map((fact) => {
      const nextFact: FactMemory = {
        ...fact,
        accessCount: fact.accessCount + 1,
        lastAccessedAt: timestamp,
      };

      touchedFacts.set(nextFact.id, nextFact);
      return nextFact;
    });
  const nextFeedback = result.feedback
    .filter(
      (feedback) =>
        feedback.lifecycle === "active" &&
        shouldApplyLowRiskTouch(feedback.lastUsedAt, timestamp),
    )
    .map((feedback) => {
      const reinforcedFeedback: FeedbackMemory = {
        ...feedback,
        lastUsedAt: timestamp,
      };

      return reinforcedFeedback;
    });

  const reinforcedFeedback = new Map(
    nextFeedback.map((feedback) => [feedback.id, feedback] as const),
  );

  const factsToPersist = new Map(
    [...pressureFacts, ...touchedFacts.values()].map((fact) =>
      [fact.id, fact] as const
    ),
  );
  for (const fact of factsToPersist.values()) {
    await repositories.facts.add(fact);
  }
  await Promise.all(
    nextFeedback.map((feedback) => repositories.feedback.upsert(feedback)),
  );

  if (touchedFacts.size > 0) {
    result.facts = result.facts.map((fact) => touchedFacts.get(fact.id) ?? fact);
  }

  if (reinforcedFeedback.size > 0) {
    result.feedback = result.feedback.map(
      (feedback) => reinforcedFeedback.get(feedback.id) ?? feedback,
    );
  }

  return {
    reinforcedFeedbackCount: nextFeedback.length,
    touchedFactCount: nextFacts.length,
    verificationPressureFactCount: pressureFacts.length,
  };
}

function toRememberObservationResult(
  result: RememberResult,
): RememberObservationResult {
  return {
    accepted: result.accepted,
    rejected: result.rejected,
    events: result.events.map((event) => ({
      evidenceIds: event.evidenceIds,
      memoryId: event.memoryId,
      reason: event.reason,
    })),
    modelInfluence:
      result.metadata?.resolvedExtractionStrategy === "llm-assisted"
        ? "llm-assisted"
        : "rules-only",
  };
}

function toRecallObservationResult(
  result: RecallResult,
  touchSummary?: RecallTouchSummary,
): RecallObservationResult {
  return {
    preferences: result.preferences.map((record) => ({ id: record.id })),
    references: result.references.map((record) => ({ id: record.id })),
    facts: result.facts.map((record) => ({ id: record.id })),
    feedback: result.feedback.map((record) => ({ id: record.id })),
    archives: result.archives.map((record) => ({ id: record.id })),
    evidence: result.evidence.map((record) => ({ id: record.id })),
    episodes: result.episodes.map((record) => ({ id: record.id })),
    strategy: result.metadata.routingDecision.strategy,
    hitCount: result.metadata.hits.length,
    hits: result.metadata.hits.map((hit) => ({
      evidenceIds: hit.evidenceIds,
    })),
    verificationHints: result.metadata.verificationHints.map((hint) => ({
      evidenceIds: hint.evidenceIds,
      memoryId: hint.memoryId,
    })),
    latencyMs: result.metadata.latencyMs,
    tokenCount: result.metadata.tokenCount,
    touchedFactCount: touchSummary?.touchedFactCount ?? 0,
    verificationPressureFactCount:
      touchSummary?.verificationPressureFactCount ?? 0,
    reinforcedFeedbackCount: touchSummary?.reinforcedFeedbackCount ?? 0,
    policyApplied: result.metadata.policyApplied,
    modelInfluence:
      result.metadata.routingDecision.strategy === "llm-assisted"
        ? "llm-assisted"
        : "rules-only",
  };
}

function toFeedbackObservationResult(
  result: FeedbackResult,
): FeedbackObservationResult {
  return {
    accepted: result.accepted,
    evidenceIds: result.evidenceIds,
    outcome: result.outcome,
    kind: result.kind,
    memoryId: result.memoryId,
    modelInfluence:
      result.metadata?.analysisMode === "rules-only" ? "rules-only" : "none",
  };
}

export function createEvolutionRuntime(config: EvolutionRuntimeConfig) {
  const now = config.now ?? (() => new Date().toISOString());

  function createEmptyAgentEventReceipts(): {
    promotionReceipts: AgentEventPromotionReceipt[];
    proposalReceipts: AgentEventProposalReceipt[];
  } {
    return {
      proposalReceipts: [],
      promotionReceipts: [],
    };
  }

  function toAgentEventProposalReceipt(
    proposal: LearningProposal,
  ): AgentEventProposalReceipt {
    return {
      proposalId: proposal.id,
      proposalType: proposal.proposalType,
      status: proposal.status,
    };
  }

  function toAgentEventPromotionReceipt(
    decision: ProposalGateDecision,
  ): AgentEventPromotionReceipt {
    return {
      decision: decision.decision,
      promotionId: decision.promotion.id,
      proposalId: decision.proposal.id,
    };
  }

  async function persistExperienceRecords(records: ExperienceRecord[]): Promise<void> {
    for (const record of records) {
      try {
        await config.governanceRepositories.experiences.add(record);
      } catch (error) {
        console.error("Failed to persist experience record", error);
      }
    }
  }

  async function persistExperienceRecordsStrict(
    records: ExperienceRecord[],
  ): Promise<void> {
    for (const record of records) {
      await config.governanceRepositories.experiences.add(record);
    }
  }

  async function runRulesOnlyReview(
    scope: MemoryScope,
    sourceExperienceIds: readonly string[] = [],
  ): Promise<{
    promotionReceipts: AgentEventPromotionReceipt[];
    proposalReceipts: AgentEventProposalReceipt[];
  }> {
    let proposals: LearningProposal[];

    try {
      proposals = await config.reviewer.review({ scope });
    } catch (error) {
      console.error("Failed to run rules-only reviewer", error);
      return createEmptyAgentEventReceipts();
    }

    let decisions: ProposalGateDecision[] = [];
    try {
      if (proposals.length > 0) {
        decisions = await config.proposalGate.process({
          scope,
          proposals,
        });
      }
    } catch (error) {
      console.error("Failed to run rules-only proposal gate", error);
      return createEmptyAgentEventReceipts();
    }

    const receipts = sourceExperienceIds.length === 0
      ? createEmptyAgentEventReceipts()
      : (() => {
          const sourceExperienceIdSet = new Set(sourceExperienceIds);
          const matchedDecisions = decisions.filter((decision) =>
            decision.proposal.sourceExperienceIds.some((experienceId) =>
              sourceExperienceIdSet.has(experienceId)
            )
          );

          return {
            proposalReceipts: matchedDecisions.map((decision) =>
              toAgentEventProposalReceipt(decision.proposal)
            ),
            promotionReceipts: matchedDecisions.map((decision) =>
              toAgentEventPromotionReceipt(decision)
            ),
          };
        })();

    try {
      await config.compiler.compile(scope);
    } catch (error) {
      console.error("Failed to compile procedural patterns", error);
    }

    return receipts;
  }

  return {
    async handleRecall(input: {
      result: RecallResult;
      scope: RecallInput["scope"];
    }): Promise<void> {
      const timestamp = now();
      const traceId = crypto.randomUUID();
      const touchSummary = await applyRecallTouchHelpers(
        config.governanceRepositories,
        input.result,
        timestamp,
      );

      await persistExperienceRecords(
        buildRecallExperienceRecords({
          scope: input.scope,
          result: toRecallObservationResult(input.result, touchSummary),
          traceId,
          createdAt: timestamp,
          createId: () => crypto.randomUUID(),
        }),
      );
      await runRulesOnlyReview(input.scope);
    },

    async handleRemember(input: {
      result: RememberResult;
      scope: RememberInput["scope"];
    }): Promise<void> {
      const timestamp = now();

      await persistExperienceRecords([
        buildRememberExperienceRecord({
          scope: input.scope,
          result: toRememberObservationResult(input.result),
          traceId: crypto.randomUUID(),
          createdAt: timestamp,
          createId: () => crypto.randomUUID(),
        }),
      ]);
      await runRulesOnlyReview(input.scope);
    },

    async handleFeedback(input: {
      result: FeedbackResult;
      scope: FeedbackInput["scope"];
      strict?: boolean;
      traceId?: string;
    }): Promise<{
      promotionReceipts: AgentEventPromotionReceipt[];
      proposalReceipts: AgentEventProposalReceipt[];
    }> {
      const feedbackExperience = buildFeedbackExperienceRecord({
        scope: input.scope,
        result: toFeedbackObservationResult(input.result),
        traceId: input.traceId ?? crypto.randomUUID(),
        createdAt: now(),
        createId: () => crypto.randomUUID(),
      });
      if (input.strict) {
        await persistExperienceRecordsStrict([feedbackExperience]);
      } else {
        await persistExperienceRecords([feedbackExperience]);
      }
      return runRulesOnlyReview(input.scope, [feedbackExperience.id]);
    },

    async handleAgentCorrection(input: {
      appliesTo: string;
      evidenceIds?: string[];
      kind: Exclude<FeedbackKind, "validated_pattern">;
      scope: FeedbackInput["scope"];
      signal: string;
      strict?: boolean;
      traceId?: string;
    }): Promise<{
      promotionReceipts: AgentEventPromotionReceipt[];
      proposalReceipts: AgentEventProposalReceipt[];
    }> {
      const traceId = input.traceId ?? crypto.randomUUID();
      const experienceId = input.traceId
        ? createAgentCorrectionExperienceId({
            scope: input.scope,
            traceId,
          })
        : crypto.randomUUID();
      const feedbackExperience = buildFeedbackExperienceRecord({
        scope: input.scope,
        result: {
          accepted: true,
          appliesTo: input.appliesTo,
          evidenceIds: input.evidenceIds,
          kind: input.kind,
          modelInfluence: "rules-only",
          origin: "agent_event",
          signal: input.signal,
        },
        traceId,
        createdAt: now(),
        createId: () => experienceId,
      });
      if (input.strict) {
        await persistExperienceRecordsStrict([feedbackExperience]);
      } else {
        await persistExperienceRecords([feedbackExperience]);
      }
      return runRulesOnlyReview(input.scope, [feedbackExperience.id]);
    },

    async handleBehavioralOutcome(input: {
      result: BehavioralOutcomeObservationResult;
      scope: MemoryScope;
    }): Promise<void> {
      const timestamp = now();
      const traceId = crypto.randomUUID();
      let linkedEvidenceIds: string[] = [];

      if (input.result.evidenceExcerpt) {
        const evidenceId = crypto.randomUUID();
        const languageContext = config.language.resolveFromText({
          text: input.result.evidenceExcerpt,
        });
        try {
          await config.governanceRepositories.evidence.add(
            createEvidenceRecord({
              id: evidenceId,
              userId: input.scope.userId,
              tenantId: input.scope.tenantId,
              workspaceId: input.scope.workspaceId,
              agentId: input.scope.agentId,
              sessionId: input.scope.sessionId,
              kind: "tool_result_excerpt",
              excerpt: input.result.evidenceExcerpt,
              source: createMemorySource({
                method: "confirmed",
                extractedAt: timestamp,
                sessionId: input.scope.sessionId,
                locale: languageContext.locale,
                localeSource: languageContext.localeSource,
                languagePackId: languageContext.languagePackId,
                languagePackVersion: languageContext.languagePackVersion,
              }),
            }),
          );
          linkedEvidenceIds = [evidenceId];
        } catch (error) {
          console.error("Failed to persist behavioral outcome evidence", error);
        }
      }

      await persistExperienceRecords([
        toStoredExperienceRecord(
          buildBehavioralOutcomeExperienceRecord({
            scope: input.scope,
            result: input.result,
            traceId,
            createdAt: timestamp,
            linkedEvidenceIds,
            createId: () => crypto.randomUUID(),
          }),
        ),
      ]);
      await runRulesOnlyReview(input.scope);
    },

    async handleAgentEvent(input: {
      evidence?: EvidenceRecord;
      experience?: ExperienceRecord;
      scope: MemoryScope;
    }): Promise<void> {
      if (input.evidence) {
        await config.governanceRepositories.evidence.add(input.evidence);
      }

      if (input.experience) {
        await persistExperienceRecordsStrict([input.experience]);
      }

      if (input.evidence || input.experience) {
        await runRulesOnlyReview(input.scope);
      }
    },

    async runMaintenance(input: RunMaintenanceInput): Promise<RunMaintenanceResult> {
      return config.dreamMaintenance.run({
        scope: input.scope,
        scopeKey: scopeToKey(input.scope),
        now: now(),
        maintenanceJobs: input.jobs,
        sessionCountSinceLastRun: input.sessionCountSinceLastRun ?? 1,
        minSessionCount: input.minSessionCount ?? 1,
        lastRunAt: input.lastRunAt,
        minHoursBetweenRuns: input.minHoursBetweenRuns ?? 0,
      });
    },
  };
}
