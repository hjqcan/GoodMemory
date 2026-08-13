import type { MemoryScope } from "../domain/scope";
import {
  createExperienceRecord,
  type ExperienceRecord,
} from "./contracts";
import type {
  FeedbackObservationResult,
  RecallVerificationObservationResult,
} from "./observation-results";

interface ObservationRecordInput {
  createdAt: string;
  createId: () => string;
  scope: MemoryScope;
  traceId: string;
}

function collectUnique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function collectUniqueFromGroups(groups: Array<readonly string[] | undefined>): string[] {
  return collectUnique(groups.flatMap((group) => group ?? []));
}

function buildVerifySummary(result: RecallVerificationObservationResult): string {
  return `Verification raised ${result.verificationHints.length} hint(s) for recalled memory.`;
}

function buildFeedbackSummary(result: FeedbackObservationResult): string {
  if (!result.accepted) {
    return "Feedback was rejected before it became durable guidance.";
  }

  if (result.origin === "agent_event") {
    return `Agent-event correction submitted for proposal review: ${
      result.signal ?? "feedback guidance"
    }.`;
  }

  return `Feedback ${result.outcome ?? "accepted"} as ${
    result.kind ?? "general guidance"
  }.`;
}

export function buildRecallVerificationExperienceRecords(
  input: ObservationRecordInput & { result: RecallVerificationObservationResult },
): ExperienceRecord[] {
  if (input.result.verificationHints.length === 0) {
    return [];
  }

  const verifyRecord = createExperienceRecord({
    id: input.createId(),
    userId: input.scope.userId,
    tenantId: input.scope.tenantId,
    workspaceId: input.scope.workspaceId,
    agentId: input.scope.agentId,
    sessionId: input.scope.sessionId,
    kind: "verify",
    traceId: input.traceId,
    sourceTraceIds: [input.traceId],
    trigger: "api",
    modelInfluence: input.result.modelInfluence,
    summary: buildVerifySummary(input.result),
    outcome: "mixed",
    policyApplied: input.result.policyApplied,
    metrics: {
      verificationHintCount: input.result.verificationHints.length,
    },
    linkedMemoryIds: collectUnique(
      input.result.verificationHints.map((hint) => hint.memoryId),
    ),
    linkedEvidenceIds: collectUniqueFromGroups(
      input.result.verificationHints.map((hint) => hint.evidenceIds),
    ),
    createdAt: input.createdAt,
  });

  return [verifyRecord];
}

export function buildFeedbackExperienceRecord(
  input: ObservationRecordInput & { result: FeedbackObservationResult },
): ExperienceRecord {
  const agentEventMetadata = input.result.origin === "agent_event"
    ? {
        metadata: {
          feedbackAppliesTo: input.result.appliesTo ?? "general_response",
          feedbackKind: input.result.kind ?? "do",
          feedbackOrigin: "agent_event",
          feedbackSignal: input.result.signal ?? "",
        },
        policyApplied: [
          "agent_event_correction",
          "proposal_first_correction",
          `feedback_applies_to:${input.result.appliesTo ?? "general_response"}`,
        ],
      }
    : {};

  return createExperienceRecord({
    id: input.createId(),
    userId: input.scope.userId,
    tenantId: input.scope.tenantId,
    workspaceId: input.scope.workspaceId,
    agentId: input.scope.agentId,
    sessionId: input.scope.sessionId,
    kind: "feedback",
    traceId: input.traceId,
    trigger: "api",
    modelInfluence: input.result.modelInfluence,
    summary: buildFeedbackSummary(input.result),
    outcome: input.result.accepted ? "success" : "failure",
    ...agentEventMetadata,
    metrics: {
      accepted: input.result.accepted ? 1 : 0,
      rejected: input.result.accepted ? 0 : 1,
    },
    linkedMemoryIds: collectUnique([input.result.memoryId]),
    linkedEvidenceIds: input.result.evidenceIds ?? [],
    createdAt: input.createdAt,
  });
}
