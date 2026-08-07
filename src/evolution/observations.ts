import type { MemoryScope } from "../domain/scope";
import {
  createExperienceRecord,
  type ExperienceRecord,
} from "./contracts";
import type {
  FeedbackObservationResult,
  RecallObservationResult,
  RememberObservationResult,
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

function buildRememberSummary(result: RememberObservationResult): string {
  return `Remember accepted ${result.accepted} candidate(s) and rejected ${result.rejected} candidate(s).`;
}

function buildRecallSummary(result: RecallObservationResult): string {
  if (result.policyApplied.includes("ignore_memory")) {
    return "Recall skipped memory retrieval because ignoreMemory was enabled.";
  }

  const touchSegments: string[] = [];
  if ((result.verificationPressureFactCount ?? 0) > 0) {
    touchSegments.push(
      `recorded ${result.verificationPressureFactCount} verification pressure signal(s)`,
    );
  }

  return touchSegments.length > 0
    ? `Recall ${result.strategy} returned ${result.hitCount} hit(s) and ${touchSegments.join(" plus ")}.`
    : `Recall ${result.strategy} returned ${result.hitCount} hit(s).`;
}

function buildVerifySummary(result: RecallObservationResult): string {
  return `Verification raised ${result.verificationHints.length} hint(s) for recalled memory.`;
}

function resolveRecallOutcome(
  result: RecallObservationResult,
): "success" | "failure" | "mixed" | "skipped" {
  if (result.policyApplied.includes("ignore_memory")) {
    return "skipped";
  }

  return result.hitCount > 0 ? "success" : "failure";
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

export function buildRememberExperienceRecord(
  input: ObservationRecordInput & { result: RememberObservationResult },
): ExperienceRecord {
  const linkedMemoryIds = collectUnique(
    input.result.events.map((event) => event.memoryId),
  );
  const linkedEvidenceIds = collectUniqueFromGroups(
    input.result.events.map((event) => event.evidenceIds),
  );
  const policyApplied = collectUnique(
    input.result.events
      .map((event) => event.reason)
      .filter((reason) => reason?.startsWith("policy")),
  );

  return createExperienceRecord({
    id: input.createId(),
    userId: input.scope.userId,
    tenantId: input.scope.tenantId,
    workspaceId: input.scope.workspaceId,
    agentId: input.scope.agentId,
    sessionId: input.scope.sessionId,
    kind: "remember",
    traceId: input.traceId,
    trigger: "api",
    modelInfluence: input.result.modelInfluence,
    summary: buildRememberSummary(input.result),
    outcome:
      input.result.accepted > 0 && input.result.rejected > 0
        ? "mixed"
        : input.result.accepted > 0
          ? "success"
          : input.result.rejected > 0
            ? "failure"
            : "skipped",
    policyApplied,
    metrics: {
      accepted: input.result.accepted,
      rejected: input.result.rejected,
    },
    linkedMemoryIds,
    linkedEvidenceIds,
    createdAt: input.createdAt,
  });
}

export function buildRecallExperienceRecords(
  input: ObservationRecordInput & { result: RecallObservationResult },
): ExperienceRecord[] {
  const linkedMemoryIds = collectUnique([
    ...input.result.preferences.map((record) => record.id),
    ...input.result.references.map((record) => record.id),
    ...input.result.facts.map((record) => record.id),
    ...input.result.feedback.map((record) => record.id),
    ...input.result.episodes.map((record) => record.id),
  ]);
  const linkedArchiveIds = collectUnique(
    input.result.archives.map((record) => record.id),
  );
  const linkedEvidenceIds = collectUnique([
    ...input.result.evidence.map((record) => record.id),
    ...collectUniqueFromGroups(
      input.result.hits.map((hit) => hit.evidenceIds),
    ),
    ...collectUniqueFromGroups(
      input.result.verificationHints.map((hint) => hint.evidenceIds),
    ),
  ]);

  const recallMetrics = {
    hitCount: input.result.hitCount,
    verificationHintCount: input.result.verificationHints.length,
    latencyMs: input.result.latencyMs,
    tokenCount: input.result.tokenCount,
    ...(input.result.verificationPressureFactCount &&
    input.result.verificationPressureFactCount > 0
      ? { verificationPressureFactCount: input.result.verificationPressureFactCount }
      : {}),
  };

  const recallRecord = createExperienceRecord({
    id: input.createId(),
    userId: input.scope.userId,
    tenantId: input.scope.tenantId,
    workspaceId: input.scope.workspaceId,
    agentId: input.scope.agentId,
    sessionId: input.scope.sessionId,
    kind: "recall",
    traceId: input.traceId,
    trigger: "api",
    modelInfluence: input.result.modelInfluence,
    summary: buildRecallSummary(input.result),
    outcome: resolveRecallOutcome(input.result),
    policyApplied: input.result.policyApplied,
    metrics: recallMetrics,
    linkedMemoryIds,
    linkedArchiveIds,
    linkedEvidenceIds,
    createdAt: input.createdAt,
  });

  if (input.result.verificationHints.length === 0) {
    return [recallRecord];
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

  return [recallRecord, verifyRecord];
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
