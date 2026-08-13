import {
  type FactMemory,
  type FeedbackMemory,
  type FeedbackKind,
  normalizeFeedbackAppliesTo,
} from "../domain/records";
import type { MemoryScope } from "../domain/scope";
import type { EvolutionRepositoryPort } from "../storage/ports";
import {
  createLearningProposal,
  type ExperienceModelInfluence,
  type ExperienceRecord,
  type LearningProposal,
} from "./contracts";
import {
  attachCompiledGuidance,
  behavioralFirstActionsEqual,
  formatBehavioralFirstAction,
  type BehavioralFirstAction,
  isToolOutcomeExperience,
  parseToolOutcomeMetadata,
  serializeBehavioralFirstAction,
} from "./behavioralTelemetry";
import {
  deriveRuleBehavioralPolicy,
  type BehavioralPolicy,
} from "./behavioralPolicy";
import {
  buildAgentEventCorrectionGroupKey,
  readAgentEventCorrectionMetadata,
  type AgentEventCorrectionMetadata,
} from "./feedbackCorrections";
import {
  refreshDelayedProposal,
  sameProposalContent,
  sameStringSet,
} from "./proposalLifecycle";

export interface AssistedReviewerExtension {
  enabled?: boolean;
  annotate?: (proposal: LearningProposal) => Promise<LearningProposal>;
}

export interface RulesOnlyReviewerConfig {
  assistedReview?: AssistedReviewerExtension;
  repositories: EvolutionRepositoryPort;
  createId?: () => string;
  createTraceId?: () => string;
  now?: () => string;
}

export interface ReflectiveReviewInput {
  scope: MemoryScope;
}

function collectUnique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function collectUniqueFromGroups(groups: Array<readonly string[] | undefined>): string[] {
  return collectUnique(groups.flatMap((group) => group ?? []));
}

function aggregateModelInfluence(
  experiences: ExperienceRecord[],
): ExperienceModelInfluence {
  const influences = new Set(experiences.map((experience) => experience.modelInfluence));

  if (influences.has("mixed")) {
    return "mixed";
  }
  if (influences.has("llm-assisted") && influences.has("rules-only")) {
    return "mixed";
  }
  if (influences.has("llm-assisted")) {
    return "llm-assisted";
  }
  if (influences.has("rules-only")) {
    return "rules-only";
  }

  return "none";
}

function findEquivalentExistingProposal(
  existing: LearningProposal[],
  candidate: LearningProposal,
): LearningProposal | undefined {
  return existing.find(
    (proposal) => {
      if (
        proposal.status === "rejected" ||
        proposal.proposalType !== candidate.proposalType
      ) {
        return false;
      }

      const sameMemories = sameStringSet(
        proposal.linkedMemoryIds,
        candidate.linkedMemoryIds,
      );
      const sameArchives = sameStringSet(
        proposal.linkedArchiveIds,
        candidate.linkedArchiveIds,
      );

      if (
        proposal.linkedMemoryIds.length === 0 &&
        candidate.linkedMemoryIds.length === 0 &&
        proposal.linkedArchiveIds.length === 0 &&
        candidate.linkedArchiveIds.length === 0
      ) {
        return proposal.summary === candidate.summary;
      }

      return sameMemories && sameArchives;
    },
  );
}

function reconcileCandidateProposal(
  existing: LearningProposal[],
  candidate: LearningProposal,
): LearningProposal | null {
  const matched = findEquivalentExistingProposal(existing, candidate);

  if (!matched) {
    return candidate;
  }

  if (matched.status !== "delayed") {
    return null;
  }

  if (sameProposalContent(matched, candidate)) {
    return null;
  }

  return refreshDelayedProposal(matched, candidate);
}

function buildFactSummary(fact: FactMemory | undefined): string {
  return fact?.content ?? "targeted memory item";
}

function buildFeedbackSummary(feedback: FeedbackMemory | undefined): string {
  return feedback?.rule ?? "repeated feedback guidance";
}

function sortExperiences(experiences: ExperienceRecord[]): ExperienceRecord[] {
  return [...experiences].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function collectDistinctTraceExperiences(
  experiences: ExperienceRecord[],
): ExperienceRecord[] {
  const byTraceId = new Map<string, ExperienceRecord>();

  for (const experience of sortExperiences(experiences)) {
    if (!byTraceId.has(experience.traceId)) {
      byTraceId.set(experience.traceId, experience);
    }
  }

  return [...byTraceId.values()];
}

function resolveProposalScope(experiences: ExperienceRecord[]): MemoryScope {
  const [first, ...rest] = experiences;

  if (!first) {
    throw new Error("Rules-only reviewer requires at least one source experience");
  }

  function resolveSharedOptionalField(
    key: "tenantId" | "workspaceId" | "agentId" | "sessionId",
  ) {
    return rest.every((experience) => experience[key] === first[key])
      ? first[key]
      : undefined;
  }

  return {
    userId: first.userId,
    tenantId: resolveSharedOptionalField("tenantId"),
    workspaceId: resolveSharedOptionalField("workspaceId"),
    agentId: resolveSharedOptionalField("agentId"),
    sessionId: resolveSharedOptionalField("sessionId"),
  };
}

function buildMemoryRevisionProposal(input: {
  createId: () => string;
  createTraceId: () => string;
  experiences: ExperienceRecord[];
  fact?: FactMemory;
  memoryId: string;
  now: string;
}): LearningProposal {
  const sorted = sortExperiences(input.experiences);
  const scope = resolveProposalScope(sorted);

  return createLearningProposal({
    id: input.createId(),
    userId: scope.userId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    agentId: scope.agentId,
    sessionId: scope.sessionId,
    proposalType: "memory_revision",
    traceId: input.createTraceId(),
    summary: `Review repeated verification pressure on memory: ${buildFactSummary(input.fact)}`,
    rationale: `Rules-only reviewer saw ${sorted.length} verification traces pointing to the same memory. Repeated verification pressure suggests a governed revision instead of silent reuse.`,
    sourceExperienceIds: sorted.map((experience) => experience.id),
    linkedMemoryIds: [input.memoryId],
    linkedEvidenceIds: collectUniqueFromGroups(
      sorted.map((experience) => experience.linkedEvidenceIds),
    ),
    modelInfluence: aggregateModelInfluence(sorted),
    createdAt: input.now,
    updatedAt: input.now,
  });
}

function buildMaintenanceProposal(input: {
  createId: () => string;
  createTraceId: () => string;
  experience: ExperienceRecord;
  fact?: FactMemory;
  memoryId: string;
  now: string;
}): LearningProposal {
  const scope = resolveProposalScope([input.experience]);

  return createLearningProposal({
    id: input.createId(),
    userId: scope.userId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    agentId: scope.agentId,
    sessionId: scope.sessionId,
    proposalType: "maintenance_action",
    traceId: input.createTraceId(),
    summary: `Re-check action-driving memory before reuse: ${buildFactSummary(input.fact)}`,
    rationale:
      "Rules-only reviewer saw a verification trace for this memory. The next step should stay in proposal space until maintenance or verification resolves it.",
    sourceExperienceIds: [input.experience.id],
    linkedMemoryIds: [input.memoryId],
    linkedEvidenceIds: input.experience.linkedEvidenceIds,
    modelInfluence: input.experience.modelInfluence,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

function buildProceduralPatternProposal(input: {
  createId: () => string;
  createTraceId: () => string;
  experiences: ExperienceRecord[];
  feedback?: FeedbackMemory;
  memoryId: string;
  now: string;
}): LearningProposal {
  const sorted = sortExperiences(input.experiences);
  const guidance = buildFeedbackSummary(input.feedback);
  const scope = resolveProposalScope(sorted);
  const proposal = createLearningProposal({
    id: input.createId(),
    userId: scope.userId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    agentId: scope.agentId,
    sessionId: scope.sessionId,
    proposalType: "procedural_pattern",
    traceId: input.createTraceId(),
    summary: `Promote repeated guidance into a governed procedural pattern: ${guidance}`,
    rationale: `Rules-only reviewer saw ${sorted.length} successful feedback traces pointing to the same active guidance. This is stable enough to propose as a reusable procedural pattern.`,
    sourceExperienceIds: sorted.map((experience) => experience.id),
    linkedMemoryIds: [input.memoryId],
    linkedEvidenceIds: collectUniqueFromGroups(
      sorted.map((experience) => experience.linkedEvidenceIds),
    ),
    modelInfluence: aggregateModelInfluence(sorted),
    createdAt: input.now,
    updatedAt: input.now,
  });

  if (!input.feedback || input.feedback.kind === "validated_pattern") {
    return proposal;
  }

  const behavioralPolicy = deriveRuleBehavioralPolicy({
    appliesTo: input.feedback.appliesTo,
    exemplarCount: sorted.length,
    kind: input.feedback.kind,
    rule: input.feedback.rule,
  });

  return attachCompiledGuidance(proposal, {
    appliesTo: input.feedback.appliesTo,
    behavioralPolicy,
    confidence: input.feedback.confidence,
    kind: input.feedback.kind,
    rule: input.feedback.rule,
    why:
      input.feedback.why ??
      "Repeated explicit feedback supports this behavioral policy under governed promotion.",
  });
}

function buildAgentEventCorrectionPatternProposal(input: {
  createId: () => string;
  createTraceId: () => string;
  experiences: ExperienceRecord[];
  metadata: AgentEventCorrectionMetadata;
  now: string;
}): LearningProposal {
  const sorted = sortExperiences(input.experiences);
  const scope = resolveProposalScope(sorted);
  const proposal = createLearningProposal({
    id: input.createId(),
    userId: scope.userId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    agentId: scope.agentId,
    sessionId: scope.sessionId,
    proposalType: "procedural_pattern",
    traceId: input.createTraceId(),
    summary:
      `Promote repeated adapter correction into a governed procedural pattern: ${input.metadata.signal}`,
    rationale:
      `Rules-only reviewer saw ${sorted.length} repeated adapter user corrections for ${input.metadata.appliesTo}. This is stable enough to propose as governed procedural guidance without first writing durable feedback.`,
    sourceExperienceIds: sorted.map((experience) => experience.id),
    linkedEvidenceIds: collectUniqueFromGroups(
      sorted.map((experience) => experience.linkedEvidenceIds),
    ),
    modelInfluence: aggregateModelInfluence(sorted),
    createdAt: input.now,
    updatedAt: input.now,
  });

  return attachCompiledGuidance(proposal, {
    rule: input.metadata.signal,
    behavioralPolicy: deriveRuleBehavioralPolicy({
      appliesTo: input.metadata.appliesTo,
      exemplarCount: 2,
      kind: input.metadata.kind,
      rule: input.metadata.signal,
    }),
    kind: input.metadata.kind,
    appliesTo: input.metadata.appliesTo,
    confidence: 0.9,
    why: "Repeated adapter user corrections support this governed procedural pattern.",
  });
}

function resolveOutcomeGuidanceKind(): Exclude<FeedbackKind, "validated_pattern"> {
  return "dont";
}

function toPluralFailureClass(value: string): string {
  if (
    value.endsWith("s") ||
    value.endsWith("x") ||
    value.endsWith("z") ||
    value.endsWith("ch") ||
    value.endsWith("sh")
  ) {
    return `${value}es`;
  }

  if (
    value.endsWith("y") &&
    value.length > 1 &&
    !"aeiou".includes(value.at(-2)?.toLowerCase() ?? "")
  ) {
    return `${value.slice(0, -1)}ies`;
  }

  return `${value}s`;
}

function buildOutcomeGuidanceRule(input: {
  cue: string;
  failureClass: string;
  firstActionLabel: string;
  saferAlternativeLabel: string;
}): string {
  return `When ${input.cue} previously caused ${input.firstActionLabel} ${toPluralFailureClass(
    input.failureClass,
  )}, avoid ${input.firstActionLabel} on the first action and use ${input.saferAlternativeLabel} before proceeding.`;
}

function sanitizeOutcomeDerivedActionArgs(
  args: readonly string[] | undefined,
): string[] | undefined {
  const stableArgs = args?.filter((value) => /^--?[a-z0-9][a-z0-9_-]*$/iu.test(value));
  return stableArgs && stableArgs.length > 0 ? [...stableArgs] : undefined;
}

function sanitizeOutcomeDerivedAction(
  action: BehavioralFirstAction | undefined,
): BehavioralFirstAction | undefined {
  if (!action) {
    return undefined;
  }

  if (action.kind === "warning") {
    return {
      kind: action.kind,
      name: action.name,
      ...(action.raw ? { raw: action.raw } : {}),
    };
  }

  const args = sanitizeOutcomeDerivedActionArgs(action.args);
  const raw = args ? [action.name, ...args].join(" ") : undefined;

  return {
    kind: action.kind,
    name: action.name,
    ...(args ? { args } : {}),
    ...(raw ? { raw } : {}),
  };
}

function buildToolOutcomePatternProposal(input: {
  createId: () => string;
  createTraceId: () => string;
  experiences: ExperienceRecord[];
  now: string;
}): LearningProposal | null {
  const sorted = collectDistinctTraceExperiences(input.experiences);
  if (sorted.length < 2) {
    return null;
  }
  const metadata = sorted.map((experience) => parseToolOutcomeMetadata(experience));
  const [firstMetadata] = metadata;

  if (
    !firstMetadata ||
    firstMetadata.retrievalProfile !== "coding_agent" ||
    !firstMetadata.saferAlternative ||
    metadata.some(
      (entry) =>
        !entry ||
        entry.retrievalProfile !== "coding_agent" ||
        !entry.saferAlternative ||
        entry.cue !== firstMetadata.cue ||
        entry.failureClass !== firstMetadata.failureClass ||
        entry.retrievalProfile !== firstMetadata.retrievalProfile ||
        !behavioralFirstActionsEqual(entry.firstAction, firstMetadata.firstAction) ||
        !behavioralFirstActionsEqual(
          entry.saferAlternative,
          firstMetadata.saferAlternative,
        ),
    )
  ) {
    return null;
  }
  const appliesTo = normalizeFeedbackAppliesTo("coding_agent");

  const scope = resolveProposalScope(sorted);
  const sanitizedFirstAction = sanitizeOutcomeDerivedAction(
    firstMetadata.firstAction,
  );
  const sanitizedSaferAlternative = sanitizeOutcomeDerivedAction(
    firstMetadata.saferAlternative,
  );
  if (!sanitizedFirstAction || !sanitizedSaferAlternative) {
    return null;
  }
  const firstActionLabel = formatBehavioralFirstAction(sanitizedFirstAction);
  const saferAlternativeLabel = formatBehavioralFirstAction(
    sanitizedSaferAlternative,
  );
  const behavioralPolicy: BehavioralPolicy = {
    behavioralKind: "first_action",
    enactmentSurface: "host_action",
    applicability: {
      actionSummaryContains: [firstMetadata.cue],
      appliesTo,
      canonicalFirstAction: sanitizedSaferAlternative,
      queryContains: [firstMetadata.cue],
    },
    transferMode: "pattern_bounded",
  };
  const proposal = createLearningProposal({
    id: input.createId(),
    userId: scope.userId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    agentId: scope.agentId,
    sessionId: scope.sessionId,
    proposalType: "procedural_pattern",
    traceId: input.createTraceId(),
    summary:
      `Promote repeated unsafe first action into a governed procedural pattern: avoid ${firstActionLabel} for ${firstMetadata.cue}.`,
    rationale:
      `Rules-only reviewer saw ${sorted.length} repeated tool-outcome failures for cue "${firstMetadata.cue}" where the first action ${firstActionLabel} failed with ${firstMetadata.failureClass}. This is stable enough to promote into governed avoidance behavior.`,
    sourceExperienceIds: sorted.map((experience) => experience.id),
    linkedEvidenceIds: collectUniqueFromGroups(
      sorted.map((experience) => experience.linkedEvidenceIds),
    ),
    modelInfluence: aggregateModelInfluence(sorted),
    createdAt: input.now,
    updatedAt: input.now,
  });

  return attachCompiledGuidance(proposal, {
    rule: buildOutcomeGuidanceRule({
      cue: firstMetadata.cue,
      failureClass: firstMetadata.failureClass,
      firstActionLabel,
      saferAlternativeLabel,
    }),
    kind: resolveOutcomeGuidanceKind(),
    appliesTo,
    behavioralPolicy,
    confidence: 0.9,
    why: "Repeated tool-outcome failures show the original first action is unsafe for this cue.",
  });
}

export function createRulesOnlyReviewer(config: RulesOnlyReviewerConfig) {
  const now = config.now ?? (() => new Date().toISOString());
  const createId = config.createId ?? (() => crypto.randomUUID());
  const createTraceId = config.createTraceId ?? (() => crypto.randomUUID());

  return {
    async review(input: ReflectiveReviewInput): Promise<LearningProposal[]> {
      const [experiences, feedback, facts, existingProposals] = await Promise.all([
        config.repositories.experiences.listByScope(input.scope),
        config.repositories.feedback.listByScope(input.scope),
        config.repositories.facts.listByScope(input.scope),
        config.repositories.proposals.listByScope(input.scope),
      ]);

      const activeFeedbackById = new Map(
        feedback
          .filter((entry) => entry.lifecycle === "active")
          .map((entry) => [entry.id, entry] as const),
      );
      const activeFactsById = new Map(
        facts
          .filter((fact) => fact.lifecycle === "active")
          .map((fact) => [fact.id, fact] as const),
      );
      const timestamp = now();
      const proposals: LearningProposal[] = [];

      const verifyGroups = new Map<string, ExperienceRecord[]>();
      for (const experience of experiences) {
        if (experience.kind !== "verify" || experience.linkedMemoryIds.length === 0) {
          continue;
        }

        for (const memoryId of experience.linkedMemoryIds) {
          const group = verifyGroups.get(memoryId) ?? [];
          group.push(experience);
          verifyGroups.set(memoryId, group);
        }
      }

      for (const [memoryId, group] of verifyGroups.entries()) {
        const candidate =
          group.length >= 2
            ? buildMemoryRevisionProposal({
                createId,
                createTraceId,
                experiences: group,
                fact: activeFactsById.get(memoryId),
                memoryId,
                now: timestamp,
              })
            : buildMaintenanceProposal({
                createId,
                createTraceId,
                experience: group[0]!,
                fact: activeFactsById.get(memoryId),
                memoryId,
                now: timestamp,
              });

        const reconciled = reconcileCandidateProposal(existingProposals, candidate);

        if (reconciled) {
          proposals.push(reconciled);
        }
      }

      const feedbackGroups = new Map<string, ExperienceRecord[]>();
      for (const experience of experiences) {
        if (experience.kind !== "feedback" || experience.linkedMemoryIds.length !== 1) {
          continue;
        }

        const [memoryId] = experience.linkedMemoryIds;
        if (!memoryId || !activeFeedbackById.has(memoryId)) {
          continue;
        }

        const group = feedbackGroups.get(memoryId) ?? [];
        group.push(experience);
        feedbackGroups.set(memoryId, group);
      }

      for (const [memoryId, group] of feedbackGroups.entries()) {
        if (group.length < 2) {
          continue;
        }

        const candidate = buildProceduralPatternProposal({
          createId,
          createTraceId,
          experiences: group,
          feedback: activeFeedbackById.get(memoryId),
          memoryId,
          now: timestamp,
        });

        const reconciled = reconcileCandidateProposal(existingProposals, candidate);

        if (reconciled) {
          proposals.push(reconciled);
        }
      }

      const agentCorrectionGroups = new Map<
        string,
        {
          experiences: ExperienceRecord[];
          metadata: AgentEventCorrectionMetadata;
        }
      >();
      for (const experience of experiences) {
        const metadata = readAgentEventCorrectionMetadata(experience);
        if (!metadata) {
          continue;
        }

        const groupKey = buildAgentEventCorrectionGroupKey({
          experience,
          metadata,
        });
        const group = agentCorrectionGroups.get(groupKey) ?? {
          experiences: [],
          metadata,
        };
        group.experiences.push(experience);
        agentCorrectionGroups.set(groupKey, group);
      }

      for (const group of agentCorrectionGroups.values()) {
        const distinctTraceExperiences = collectDistinctTraceExperiences(
          group.experiences,
        );

        if (distinctTraceExperiences.length < 2) {
          continue;
        }

        const candidate = buildAgentEventCorrectionPatternProposal({
          createId,
          createTraceId,
          experiences: distinctTraceExperiences,
          metadata: group.metadata,
          now: timestamp,
        });
        const reconciled = reconcileCandidateProposal(existingProposals, candidate);

        if (reconciled) {
          proposals.push(reconciled);
        }
      }

      const toolOutcomeGroups = new Map<string, ExperienceRecord[]>();
      for (const experience of experiences) {
        if (!isToolOutcomeExperience(experience)) {
          continue;
        }

        const metadata = parseToolOutcomeMetadata(experience);
        if (
          metadata?.retrievalProfile !== "coding_agent" ||
          !metadata.saferAlternative
        ) {
          continue;
        }

        const groupKey = [
          metadata.cue,
          metadata.failureClass,
          serializeBehavioralFirstAction(metadata.firstAction),
          metadata.saferAlternative
            ? serializeBehavioralFirstAction(metadata.saferAlternative)
            : "",
          metadata.retrievalProfile,
        ].join("::");
        const group = toolOutcomeGroups.get(groupKey) ?? [];
        group.push(experience);
        toolOutcomeGroups.set(groupKey, group);
      }

      for (const group of toolOutcomeGroups.values()) {
        if (group.length < 2) {
          continue;
        }

        const candidate = buildToolOutcomePatternProposal({
          createId,
          createTraceId,
          experiences: group,
          now: timestamp,
        });
        if (!candidate) {
          continue;
        }

        const reconciled = reconcileCandidateProposal(existingProposals, candidate);

        if (reconciled) {
          proposals.push(reconciled);
        }
      }

      if (config.assistedReview?.enabled && config.assistedReview.annotate) {
        const annotated: LearningProposal[] = [];
        for (const proposal of proposals) {
          annotated.push(await config.assistedReview.annotate(proposal));
        }
        return annotated;
      }

      return proposals;
    },
  };
}
