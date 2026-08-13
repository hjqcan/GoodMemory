import type { MemoryScope } from "../domain/scope";
import type { EvolutionRepositoryPort } from "../storage/ports";
import type { FeedbackMemory } from "../domain/records";
import {
  behavioralFirstActionsEqual,
  isToolOutcomeExperience,
  parseToolOutcomeMetadata,
  readCompiledGuidance,
} from "./behavioralTelemetry";
import { readAgentEventCorrectionMetadata } from "./feedbackCorrections";
import {
  createPromotionRecord,
  type ExperienceRecord,
  type LearningProposal,
  type PromotionDecision,
  type PromotionGateOutcome,
  type PromotionRecord,
  type SessionArchive,
} from "./contracts";

export interface ProposalGateDecision {
  decision: PromotionDecision;
  evalOutcome: PromotionGateOutcome;
  policyOutcome: PromotionGateOutcome;
  promotion: PromotionRecord;
  proposal: LearningProposal;
  rationale: string;
  verificationOutcome: PromotionGateOutcome;
}

export interface ProposalGateProcessorConfig {
  repositories: EvolutionRepositoryPort;
  createId?: () => string;
  createTraceId?: () => string;
  now?: () => string;
}

export interface ProposalGateProcessInput {
  scope: MemoryScope;
  proposals: LearningProposal[];
}

interface ProposalGateContext {
  archiveIds: Set<string>;
  experiencesById: Map<string, ExperienceRecord>;
  feedbackById: Map<string, FeedbackMemory>;
}

interface ProceduralPatternLineageAssessment {
  hasRepeatedAgentCorrectionLineage: boolean;
  hasRepeatedFeedbackLineage: boolean;
  hasRepeatedToolOutcomeLineage: boolean;
  missingExperienceIds: string[];
}

function matchesScope(proposal: LearningProposal, scope: MemoryScope): boolean {
  return (
    proposal.userId === scope.userId &&
    proposal.tenantId === scope.tenantId &&
    proposal.workspaceId === scope.workspaceId &&
    proposal.agentId === scope.agentId
  );
}

function evaluatePolicyGate(
  proposal: LearningProposal,
  scope: MemoryScope,
): {
  outcome: PromotionGateOutcome;
  rationale: string;
} {
  if (!matchesScope(proposal, scope)) {
    return {
      outcome: "blocked",
      rationale: "proposal scope does not match the current review scope",
    };
  }

  if (!proposal.summary.trim() || !proposal.rationale.trim()) {
    return {
      outcome: "blocked",
      rationale: "proposal summary and rationale are required",
    };
  }

  return {
    outcome: "passed",
    rationale: "proposal passed the deterministic policy gate",
  };
}

function evaluateVerificationGate(
  proposal: LearningProposal,
  context: ProposalGateContext,
): {
  outcome: PromotionGateOutcome;
  rationale: string;
} {
  if (proposal.proposalType === "maintenance_action") {
    const hasLineage =
      proposal.linkedMemoryIds.length > 0 ||
      proposal.linkedArchiveIds.length > 0 ||
      proposal.linkedEvidenceIds.length > 0 ||
      proposal.sourceExperienceIds.length > 0;

    return hasLineage
      ? {
          outcome: "passed",
          rationale: "proposal carries enough lineage for a low-risk maintenance review",
        }
      : {
          outcome: "review_required",
          rationale: "maintenance proposals require memory, archive, evidence, or experience lineage",
        };
  }

  if (
    proposal.proposalType === "memory_revision" &&
    proposal.linkedMemoryIds.length > 0 &&
    (
      proposal.linkedEvidenceIds.length > 0 ||
      proposal.sourceExperienceIds.length > 0
    )
  ) {
    return {
      outcome: "passed",
      rationale: "revision proposal has target memory plus evidence or experience lineage",
    };
  }

  if (
    proposal.proposalType === "procedural_pattern" &&
    proposal.linkedArchiveIds.length > 0
  ) {
    const missingArchives = proposal.linkedArchiveIds.filter(
      (archiveId) => !context.archiveIds.has(archiveId),
    );
    if (missingArchives.length === 0) {
      return {
        outcome: "passed",
        rationale: "procedural proposal has archive-backed lineage",
      };
    }

    return {
      outcome: "review_required",
      rationale: "procedural proposal references missing archive lineage",
    };
  }

  if (proposal.proposalType === "procedural_pattern") {
    const lineage = assessProceduralPatternLineage(proposal, context);

    if (lineage.hasRepeatedFeedbackLineage) {
      return {
        outcome: "passed",
        rationale:
          "procedural proposal has repeated successful feedback lineage over one active guidance memory",
      };
    }

    if (lineage.hasRepeatedToolOutcomeLineage) {
      return {
        outcome: "passed",
        rationale:
          "procedural proposal has repeated tool-outcome lineage over the same failed first action and cue",
      };
    }

    if (lineage.hasRepeatedAgentCorrectionLineage) {
      return {
        outcome: "passed",
        rationale:
          "procedural proposal has repeated adapter correction lineage and compiled guidance",
      };
    }

    if (lineage.missingExperienceIds.length > 0) {
      return {
        outcome: "review_required",
        rationale: "procedural proposal references missing experience lineage",
      };
    }

    if (proposal.sourceExperienceIds.length >= 2) {
      return {
        outcome: "review_required",
        rationale:
          "procedural proposal needs repeated successful feedback traces over one active guidance memory",
      };
    }

    return {
      outcome: "review_required",
      rationale: "procedural proposal needs more verification context before it can pass automatically",
    };
  }

  return {
    outcome: "review_required",
    rationale: "proposal needs more verification context before it can pass automatically",
  };
}

function evaluateEvalGate(
  proposal: LearningProposal,
  context: ProposalGateContext,
): {
  outcome: PromotionGateOutcome;
  rationale: string;
} {
  if (proposal.modelInfluence === "llm-assisted" || proposal.modelInfluence === "mixed") {
    return {
      outcome: "review_required",
      rationale: "model-assisted proposal requires human or eval review before promotion",
    };
  }

  if (proposal.proposalType === "maintenance_action") {
    return {
      outcome: "passed",
      rationale: "low-risk maintenance proposals can pass the initial eval gate",
    };
  }

  if (proposal.proposalType === "procedural_pattern") {
    const lineage = assessProceduralPatternLineage(proposal, context);

    if (lineage.hasRepeatedFeedbackLineage) {
      return {
        outcome: "passed",
        rationale:
          "repeated explicit feedback confirms existing guidance strongly enough for deterministic procedural promotion",
      };
    }

    if (lineage.hasRepeatedToolOutcomeLineage) {
      return {
        outcome: "passed",
        rationale:
          "repeated tool-outcome failures confirm governed first-action avoidance strongly enough for deterministic procedural promotion",
      };
    }

    if (lineage.hasRepeatedAgentCorrectionLineage) {
      return {
        outcome: "passed",
        rationale:
          "repeated adapter user corrections confirm governed procedural guidance strongly enough for deterministic promotion",
      };
    }
  }

  return {
    outcome: "review_required",
    rationale: "high-risk proposals stay delayed until later eval and promotion phases",
  };
}

function buildProposalGateContext(input: {
  archives: SessionArchive[];
  experiences: ExperienceRecord[];
  feedback: FeedbackMemory[];
}): ProposalGateContext {
  return {
    archiveIds: new Set(input.archives.map((archive) => archive.id)),
    experiencesById: new Map(
      input.experiences.map((experience) => [experience.id, experience] as const),
    ),
    feedbackById: new Map(
      input.feedback.map((record) => [record.id, record] as const),
    ),
  };
}

function assessProceduralPatternLineage(
  proposal: LearningProposal,
  context: ProposalGateContext,
): ProceduralPatternLineageAssessment {
  const distinctSourceExperienceIds = [...new Set(proposal.sourceExperienceIds)];
  const missingExperienceIds = distinctSourceExperienceIds.filter(
    (experienceId) => !context.experiencesById.has(experienceId),
  );
  const sourceFeedbackId =
    proposal.linkedMemoryIds.length === 1 ? proposal.linkedMemoryIds[0] : undefined;
  const sourceFeedback = sourceFeedbackId
    ? context.feedbackById.get(sourceFeedbackId)
    : undefined;
  const sourceExperiences = distinctSourceExperienceIds
    .map((experienceId) => context.experiencesById.get(experienceId))
    .filter((experience): experience is ExperienceRecord => Boolean(experience));
  const hasActiveSourceFeedback =
    sourceFeedback?.lifecycle === "active" &&
    sourceFeedback.kind !== "validated_pattern";

  const hasRepeatedFeedbackLineage =
    hasActiveSourceFeedback &&
    distinctSourceExperienceIds.length >= 2 &&
    missingExperienceIds.length === 0 &&
    sourceExperiences.every(
      (experience) =>
        experience.kind === "feedback" &&
        experience.outcome === "success" &&
        experience.linkedMemoryIds.length === 1 &&
        experience.linkedMemoryIds[0] === sourceFeedback?.id,
    );
  const parsedToolOutcomeMetadata = sourceExperiences.map((experience) =>
    parseToolOutcomeMetadata(experience),
  );
  const [firstToolOutcome] = parsedToolOutcomeMetadata;
  const toolOutcomeTraceIds = new Set(
    sourceExperiences.map((experience) => experience.traceId),
  );
  const hasRepeatedToolOutcomeLineage =
    Boolean(readCompiledGuidance(proposal)) &&
    distinctSourceExperienceIds.length >= 2 &&
    toolOutcomeTraceIds.size >= 2 &&
    missingExperienceIds.length === 0 &&
    sourceExperiences.every((experience) => isToolOutcomeExperience(experience)) &&
    firstToolOutcome?.retrievalProfile === "coding_agent" &&
    Boolean(firstToolOutcome?.saferAlternative) &&
    parsedToolOutcomeMetadata.every(
      (metadata) =>
        Boolean(metadata) &&
        metadata!.retrievalProfile === "coding_agent" &&
        Boolean(metadata!.saferAlternative) &&
        metadata!.cue === firstToolOutcome!.cue &&
        metadata!.failureClass === firstToolOutcome!.failureClass &&
        metadata!.retrievalProfile === firstToolOutcome!.retrievalProfile &&
        behavioralFirstActionsEqual(
          metadata!.firstAction,
          firstToolOutcome!.firstAction,
        ) &&
        behavioralFirstActionsEqual(
          metadata!.saferAlternative,
          firstToolOutcome!.saferAlternative,
        ),
    );
  const parsedAgentCorrectionMetadata = sourceExperiences.map((experience) =>
    readAgentEventCorrectionMetadata(experience),
  );
  const [firstAgentCorrection] = parsedAgentCorrectionMetadata;
  const agentCorrectionTraceIds = new Set(
    sourceExperiences
      .filter((_, index) => Boolean(parsedAgentCorrectionMetadata[index]))
      .map((experience) => experience.traceId),
  );
  const hasRepeatedAgentCorrectionLineage =
    Boolean(readCompiledGuidance(proposal)) &&
    distinctSourceExperienceIds.length >= 2 &&
    agentCorrectionTraceIds.size >= 2 &&
    missingExperienceIds.length === 0 &&
    Boolean(firstAgentCorrection) &&
    parsedAgentCorrectionMetadata.every(
      (metadata) =>
        Boolean(metadata) &&
        metadata!.signal === firstAgentCorrection!.signal &&
        metadata!.appliesTo === firstAgentCorrection!.appliesTo &&
        metadata!.kind === firstAgentCorrection!.kind,
    );

  return {
    hasRepeatedAgentCorrectionLineage,
    hasRepeatedFeedbackLineage,
    hasRepeatedToolOutcomeLineage,
    missingExperienceIds,
  };
}

function finalizeDecision(input: {
  evalOutcome: PromotionGateOutcome;
  policyOutcome: PromotionGateOutcome;
  verificationOutcome: PromotionGateOutcome;
}): PromotionDecision {
  if (input.policyOutcome === "blocked") {
    return "rejected";
  }

  if (
    input.verificationOutcome === "review_required" ||
    input.evalOutcome === "review_required"
  ) {
    return "delayed";
  }

  return "accepted";
}

export function createProposalGateProcessor(
  config: ProposalGateProcessorConfig,
) {
  const now = config.now ?? (() => new Date().toISOString());
  const createId = config.createId ?? (() => crypto.randomUUID());
  const createTraceId = config.createTraceId ?? (() => crypto.randomUUID());

  async function rollbackFinalizedProposal(
    proposalId: string,
    previousProposal: LearningProposal | null,
  ): Promise<void> {
    if (previousProposal) {
      await config.repositories.proposals.add(previousProposal);
      return;
    }

    await config.repositories.proposals.delete(proposalId);
  }

  return {
    async process(input: ProposalGateProcessInput): Promise<ProposalGateDecision[]> {
      const timestamp = now();
      const decisions: ProposalGateDecision[] = [];
      const gateContext = buildProposalGateContext({
        archives: await config.repositories.archives.listByScope(input.scope),
        experiences: await config.repositories.experiences.listByScope(input.scope),
        feedback: await config.repositories.feedback.listByScope(input.scope),
      });

      for (const proposal of input.proposals) {
        const policy = evaluatePolicyGate(proposal, input.scope);
        const verification = evaluateVerificationGate(proposal, gateContext);
        const evalGate = evaluateEvalGate(proposal, gateContext);
        const decision = finalizeDecision({
          policyOutcome: policy.outcome,
          verificationOutcome: verification.outcome,
          evalOutcome: evalGate.outcome,
        });
        const rationale = [policy.rationale, verification.rationale, evalGate.rationale]
          .filter(Boolean)
          .join("; ");
        const finalizedProposal: LearningProposal = {
          ...proposal,
          status: decision,
          updatedAt: timestamp,
        };
        const promotion = createPromotionRecord({
          id: createId(),
          proposalId: proposal.id,
          userId: proposal.userId,
          tenantId: proposal.tenantId,
          workspaceId: proposal.workspaceId,
          agentId: proposal.agentId,
          sessionId: proposal.sessionId,
          traceId: createTraceId(),
          decision,
          summary: `${decision} proposal: ${proposal.summary}`,
          rationale,
          sourceExperienceIds: proposal.sourceExperienceIds,
          linkedMemoryIds: proposal.linkedMemoryIds,
          linkedArchiveIds: proposal.linkedArchiveIds,
          linkedEvidenceIds: proposal.linkedEvidenceIds,
          policyOutcome: policy.outcome,
          verificationOutcome: verification.outcome,
          evalOutcome: evalGate.outcome,
          createdAt: timestamp,
          decidedAt: timestamp,
        });
        const previousProposal = await config.repositories.proposals.get(proposal.id);

        await config.repositories.proposals.add(finalizedProposal);

        try {
          await config.repositories.promotions.add(promotion);
        } catch (error) {
          try {
            await rollbackFinalizedProposal(proposal.id, previousProposal);
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              `Failed to persist promotion and roll back proposal ${proposal.id}`,
            );
          }

          throw error;
        }

        decisions.push({
          decision,
          proposal: finalizedProposal,
          promotion,
          rationale,
          policyOutcome: policy.outcome,
          verificationOutcome: verification.outcome,
          evalOutcome: evalGate.outcome,
        });
      }

      return decisions;
    },
  };
}
