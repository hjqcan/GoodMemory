import { readGoodMemoryEvalSupport } from "../api/evalSupport";
import type { GoodMemory } from "../api/contracts";
import type { MemoryScope } from "../domain/scope";
import type {
  BehavioralFirstAction,
  BehavioralOutcomeRecordInput,
} from "../evolution/behavioralTelemetry";
import {
  extractFirstBehavioralTraceAction,
  toBehavioralFirstAction,
  type HostBehavioralTrace,
  type HostBehavioralTraceEvent,
} from "./behavioralTrace";

interface RecordBehavioralTraceInput {
  memory: GoodMemory;
  scope: MemoryScope;
  trace: HostBehavioralTrace;
}

function toFailureClass(outcome: HostBehavioralTraceEvent["outcome"]): string {
  if (outcome === "timeout") {
    return "timeout";
  }
  if (outcome === "user_corrected") {
    return "user correction";
  }

  return "failure";
}

function isFailureOutcome(outcome: HostBehavioralTraceEvent["outcome"]): boolean {
  return outcome === "failure" || outcome === "timeout" || outcome === "user_corrected";
}

function resolveSaferAlternative(input: {
  firstAction: HostBehavioralTraceEvent;
  trace: HostBehavioralTrace;
}): BehavioralFirstAction | undefined {
  const selected = [...input.trace.events]
    .filter((event) => event.stepIndex > input.firstAction.stepIndex)
    .sort((left, right) => left.stepIndex - right.stepIndex)
    .find(
      (event) =>
        event.correctionOfStepIndex === input.firstAction.stepIndex &&
        event.outcome === "success",
    );

  return selected ? toBehavioralFirstAction(selected) : undefined;
}

export function extractBehavioralOutcomeFromTrace(
  trace: HostBehavioralTrace,
): BehavioralOutcomeRecordInput | null {
  const firstAction = extractFirstBehavioralTraceAction(trace);

  if (!firstAction || !isFailureOutcome(firstAction.outcome)) {
    return null;
  }

  return {
    cue: trace.cue,
    evidenceExcerpt: firstAction.evidenceExcerpt,
    failureClass: toFailureClass(firstAction.outcome),
    firstAction: toBehavioralFirstAction(firstAction),
    retrievalProfile: "coding_agent",
    saferAlternative: resolveSaferAlternative({
      firstAction,
      trace,
    }),
    traceId: trace.traceId,
  };
}

export async function recordBehavioralTrace(
  input: RecordBehavioralTraceInput,
): Promise<{ outcome?: BehavioralOutcomeRecordInput; recorded: boolean }> {
  const support = readGoodMemoryEvalSupport(input.memory);
  const outcome = extractBehavioralOutcomeFromTrace(input.trace);

  if (!support?.recordBehavioralOutcome || !outcome) {
    return {
      ...(outcome ? { outcome } : {}),
      recorded: false,
    };
  }

  await support.recordBehavioralOutcome({
    scope: input.scope,
    cue: outcome.cue,
    evidenceExcerpt: outcome.evidenceExcerpt,
    failureClass: outcome.failureClass,
    firstAction: outcome.firstAction,
    retrievalProfile: outcome.retrievalProfile,
    saferAlternative: outcome.saferAlternative,
    traceId: outcome.traceId,
    modelInfluence: outcome.modelInfluence,
    outcome: outcome.outcome,
  });

  return {
    outcome,
    recorded: true,
  };
}
