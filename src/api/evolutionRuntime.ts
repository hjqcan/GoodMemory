import { createMemorySource } from "../domain/provenance";
import type { FactMemory, FeedbackKind } from "../domain/records";
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
} from "../evolution/behavioralTelemetry";
import {
  buildFeedbackExperienceRecord,
  buildRecallVerificationExperienceRecords,
} from "../evolution/observations";
import type {
  FeedbackObservationResult,
  RecallVerificationObservationResult,
} from "../evolution/observation-results";
import type {
  GovernanceRepositoryPort,
} from "../storage/ports";
import type {
  FeedbackInput,
  FeedbackResult,
  RecallInput,
  RecallResult,
  RunMaintenanceInput,
  RunMaintenanceResult,
} from "./contracts";
import type {
  AgentEventPromotionReceipt,
  AgentEventProposalReceipt,
} from "./integrationSupport";
import type { ProposalGateDecision } from "../evolution/gates";
import type { LanguageService } from "../language";

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

function createBehavioralOutcomeRecordId(input: {
  kind: "evidence" | "experience";
  scope: MemoryScope;
  traceId: string;
}): string {
  return [
    `behavioral_outcome.${input.kind}`,
    `scope=${encodeExperienceIdSegment(scopeToKey(input.scope))}`,
    `trace=${encodeExperienceIdSegment(input.traceId)}`,
  ].join("|");
}

async function applyRecallVerificationPressure(
  repositories: GovernanceRepositoryPort,
  result: RecallResult,
  timestamp: string,
): Promise<void> {
  const pressuredFacts = new Map<string, FactMemory>();
  const verificationHintFactIds = new Set(
    result.metadata.verificationHints
      .filter((hint) => hint.memoryType === "fact")
      .map((hint) => hint.memoryId),
  );
  for (const recalledFact of result.facts) {
    if (!verificationHintFactIds.has(recalledFact.id)) {
      continue;
    }

    const canonicalFact = repositories.facts.get
      ? await repositories.facts.get(recalledFact.id)
      : recalledFact;
    if (!canonicalFact || canonicalFact.lifecycle !== "active") {
      continue;
    }

    const verificationPressureCount = Math.min(
      (canonicalFact.verificationPressureCount ?? 0) + 1,
      MAX_VERIFICATION_PRESSURE_COUNT,
    );
    await repositories.facts.add({
      ...canonicalFact,
      verificationPressureCount,
      lastVerificationHintAt: timestamp,
    });
    pressuredFacts.set(recalledFact.id, {
      ...recalledFact,
      verificationPressureCount,
      lastVerificationHintAt: timestamp,
    });
  }

  if (pressuredFacts.size > 0) {
    result.facts = result.facts.map(
      (fact) => pressuredFacts.get(fact.id) ?? fact,
    );
  }
}

function toRecallVerificationObservationResult(
  result: RecallResult,
): RecallVerificationObservationResult {
  return {
    verificationHints: result.metadata.verificationHints.map((hint) => ({
      evidenceIds: hint.evidenceIds,
      memoryId: hint.memoryId,
    })),
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

  async function persistExperienceRecords(
    records: ExperienceRecord[],
  ): Promise<ExperienceRecord[]> {
    const persisted: ExperienceRecord[] = [];
    for (const record of records) {
      try {
        await config.governanceRepositories.experiences.add(record);
        persisted.push(record);
      } catch (error) {
        console.error("Failed to persist experience record", error);
      }
    }
    return persisted;
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
      if (input.result.metadata.verificationHints.length === 0) {
        return;
      }
      const timestamp = now();
      const traceId = crypto.randomUUID();
      await applyRecallVerificationPressure(
        config.governanceRepositories,
        input.result,
        timestamp,
      );
      const records = buildRecallVerificationExperienceRecords({
        scope: input.scope,
        result: toRecallVerificationObservationResult(input.result),
        traceId,
        createdAt: timestamp,
        createId: () => crypto.randomUUID(),
      });
      if (records.length === 0) {
        return;
      }

      const persisted = await persistExperienceRecords(records);
      if (persisted.length === 0) {
        return;
      }
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
        const persisted = await persistExperienceRecords([feedbackExperience]);
        if (persisted.length === 0) {
          return createEmptyAgentEventReceipts();
        }
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
        const persisted = await persistExperienceRecords([feedbackExperience]);
        if (persisted.length === 0) {
          return createEmptyAgentEventReceipts();
        }
      }
      return runRulesOnlyReview(input.scope, [feedbackExperience.id]);
    },

    async handleBehavioralOutcome(input: {
      result: BehavioralOutcomeObservationResult;
      scope: MemoryScope;
      traceId?: string;
    }): Promise<void> {
      const timestamp = now();
      const traceId = input.traceId ?? crypto.randomUUID();
      const experienceId = input.traceId
        ? createBehavioralOutcomeRecordId({
            kind: "experience",
            scope: input.scope,
            traceId,
          })
        : crypto.randomUUID();
      let evidence: EvidenceRecord | undefined;

      if (input.result.evidenceExcerpt) {
        const evidenceId = input.traceId
          ? createBehavioralOutcomeRecordId({
              kind: "evidence",
              scope: input.scope,
              traceId,
            })
          : crypto.randomUUID();
        const languageContext = config.language.resolveFromText({
          text: input.result.evidenceExcerpt,
        });
        evidence = createEvidenceRecord({
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
        });
      }

      const experience = buildBehavioralOutcomeExperienceRecord({
        scope: input.scope,
        result: input.result,
        traceId,
        createdAt: timestamp,
        linkedEvidenceIds: evidence ? [evidence.id] : [],
        createId: () => experienceId,
      });
      const persistence = await config.governanceRepositories.behavioralOutcomes
        .add({
          experience,
          ...(evidence ? { evidence } : {}),
        });
      if (persistence === "unchanged") {
        return;
      }
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

      if (input.experience) {
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
