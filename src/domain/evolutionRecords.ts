export const SESSION_ARCHIVES_COLLECTION = "session_archives";
export const EXPERIENCES_COLLECTION = "experiences";
export const LEARNING_PROPOSALS_COLLECTION = "learning_proposals";
export const PROMOTION_RECORDS_COLLECTION = "promotion_records";

export type ExperienceKind =
  | "remember"
  | "recall"
  | "feedback"
  | "verify"
  | "maintenance"
  | "tool_outcome"
  | "session_end";

export type ExperienceTrigger =
  | "api"
  | "background"
  | "maintenance"
  | "governance";

export type ExperienceModelInfluence =
  | "none"
  | "rules-only"
  | "llm-assisted"
  | "mixed";

export interface ExperienceMetrics {
  accepted?: number;
  rejected?: number;
  hitCount?: number;
  verificationHintCount?: number;
  latencyMs?: number;
  tokenCount?: number;
  /** @deprecated since 0.7.3. Retained for historical recall records only. */
  touchedFactCount?: number;
  verificationPressureFactCount?: number;
  /** @deprecated since 0.7.3. Retained for historical recall records only. */
  reinforcedFeedbackCount?: number;
}

export type ExperienceMetadataValue = boolean | number | string;

export interface ExperienceRecord {
  id: string;
  userId: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
  kind: ExperienceKind;
  traceId: string;
  sourceTraceIds: string[];
  trigger: ExperienceTrigger;
  modelInfluence: ExperienceModelInfluence;
  summary: string;
  outcome: "success" | "failure" | "mixed" | "skipped";
  policyApplied: string[];
  metrics: ExperienceMetrics;
  linkedMemoryIds: string[];
  linkedArchiveIds: string[];
  linkedEvidenceIds: string[];
  linkedProposalIds: string[];
  metadata?: Record<string, ExperienceMetadataValue>;
  createdAt: string;
}

export type LearningProposalType =
  | "memory_write"
  | "memory_revision"
  | "procedural_pattern"
  | "maintenance_action"
  | "recall_weight_adjustment"
  | "verification_rule";

export type LearningProposalStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "delayed";

export interface LearningProposal {
  id: string;
  userId: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
  proposalType: LearningProposalType;
  status: LearningProposalStatus;
  traceId: string;
  summary: string;
  rationale: string;
  sourceExperienceIds: string[];
  linkedMemoryIds: string[];
  linkedArchiveIds: string[];
  linkedEvidenceIds: string[];
  modelInfluence: ExperienceModelInfluence;
  createdAt: string;
  updatedAt: string;
}

export type PromotionDecision = "accepted" | "rejected" | "delayed";

export type PromotionGateOutcome =
  | "passed"
  | "blocked"
  | "review_required"
  | "not_run";

export interface PromotionRecord {
  id: string;
  proposalId: string;
  userId: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
  traceId: string;
  decision: PromotionDecision;
  summary: string;
  rationale: string;
  sourceExperienceIds: string[];
  linkedMemoryIds: string[];
  linkedArchiveIds: string[];
  linkedEvidenceIds: string[];
  policyOutcome: PromotionGateOutcome;
  verificationOutcome: PromotionGateOutcome;
  evalOutcome: PromotionGateOutcome;
  createdAt: string;
  decidedAt: string;
}

export interface SessionArchive {
  id: string;
  userId: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  sessionId: string;
  sourceSessionIds: string[];
  summary: string;
  normalizedTranscript?: string;
  keyDecisions: string[];
  unresolvedItems: string[];
  referencedArtifacts: string[];
  scopeLineage: string[];
  locale?: string;
  createdAt: string;
  archivedAt: string;
}

function resolveArchiveTimestamp(
  createdAt: string | undefined,
  archivedAt: string | undefined,
): string {
  return createdAt ?? archivedAt ?? new Date(0).toISOString();
}

export function createSessionArchive(
  input: Pick<SessionArchive, "id" | "sessionId" | "summary" | "userId"> &
    Partial<Omit<SessionArchive, "id" | "sessionId" | "summary" | "userId">>,
): SessionArchive {
  const createdAt = resolveArchiveTimestamp(input.createdAt, input.archivedAt);

  return {
    id: input.id,
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    sourceSessionIds: input.sourceSessionIds ?? [input.sessionId],
    summary: input.summary,
    normalizedTranscript: input.normalizedTranscript,
    keyDecisions: input.keyDecisions ?? [],
    unresolvedItems: input.unresolvedItems ?? [],
    referencedArtifacts: input.referencedArtifacts ?? [],
    scopeLineage: input.scopeLineage ?? [],
    locale: input.locale,
    createdAt,
    archivedAt: input.archivedAt ?? createdAt,
  };
}

export function createExperienceRecord(
  input: Pick<
    ExperienceRecord,
    "id" | "kind" | "summary" | "traceId" | "userId"
  > &
    Partial<
      Omit<ExperienceRecord, "id" | "kind" | "summary" | "traceId" | "userId">
    >,
): ExperienceRecord {
  return {
    id: input.id,
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    kind: input.kind,
    traceId: input.traceId,
    sourceTraceIds: input.sourceTraceIds ?? [input.traceId],
    trigger: input.trigger ?? "api",
    modelInfluence: input.modelInfluence ?? "none",
    summary: input.summary,
    outcome: input.outcome ?? "success",
    policyApplied: input.policyApplied ?? [],
    metrics: input.metrics ?? {},
    linkedMemoryIds: input.linkedMemoryIds ?? [],
    linkedArchiveIds: input.linkedArchiveIds ?? [],
    linkedEvidenceIds: input.linkedEvidenceIds ?? [],
    linkedProposalIds: input.linkedProposalIds ?? [],
    ...(input.metadata ? { metadata: input.metadata } : {}),
    createdAt: input.createdAt ?? new Date(0).toISOString(),
  };
}

export function createLearningProposal(
  input: Pick<
    LearningProposal,
    "id" | "proposalType" | "rationale" | "summary" | "traceId" | "userId"
  > &
    Partial<
      Omit<
        LearningProposal,
        "id" | "proposalType" | "rationale" | "summary" | "traceId" | "userId"
      >
    >,
): LearningProposal {
  const createdAt = input.createdAt ?? new Date(0).toISOString();

  return {
    id: input.id,
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    proposalType: input.proposalType,
    status: input.status ?? "pending",
    traceId: input.traceId,
    summary: input.summary,
    rationale: input.rationale,
    sourceExperienceIds: input.sourceExperienceIds ?? [],
    linkedMemoryIds: input.linkedMemoryIds ?? [],
    linkedArchiveIds: input.linkedArchiveIds ?? [],
    linkedEvidenceIds: input.linkedEvidenceIds ?? [],
    modelInfluence: input.modelInfluence ?? "none",
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
}

export function createPromotionRecord(
  input: Pick<
    PromotionRecord,
    "decision" | "id" | "proposalId" | "rationale" | "summary" | "traceId" | "userId"
  > &
    Partial<
      Omit<
        PromotionRecord,
        "decision" | "id" | "proposalId" | "rationale" | "summary" | "traceId" | "userId"
      >
    >,
): PromotionRecord {
  const decidedAt = input.decidedAt ?? input.createdAt ?? new Date(0).toISOString();

  return {
    id: input.id,
    proposalId: input.proposalId,
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    traceId: input.traceId,
    decision: input.decision,
    summary: input.summary,
    rationale: input.rationale,
    sourceExperienceIds: input.sourceExperienceIds ?? [],
    linkedMemoryIds: input.linkedMemoryIds ?? [],
    linkedArchiveIds: input.linkedArchiveIds ?? [],
    linkedEvidenceIds: input.linkedEvidenceIds ?? [],
    policyOutcome: input.policyOutcome ?? "not_run",
    verificationOutcome: input.verificationOutcome ?? "not_run",
    evalOutcome: input.evalOutcome ?? "not_run",
    createdAt: input.createdAt ?? decidedAt,
    decidedAt,
  };
}
