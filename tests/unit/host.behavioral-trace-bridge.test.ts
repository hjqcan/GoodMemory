import { describe, expect, it } from "bun:test";
import { createInternalGoodMemory } from "../../src/api/createGoodMemory";
import {
  extractBehavioralOutcomeFromTrace,
  recordBehavioralTrace,
} from "../../src/host/behavioralTraceBridge";
import { validateBehavioralTrace } from "../../src/host/behavioralTrace";

describe("host behavioral trace bridge", () => {
  it("extracts a behavioral outcome from the first failed trace action and resolves a corrective follow-up", () => {
    const trace = validateBehavioralTrace({
      cue: "detailed analysis",
      hostKind: "codex",
      traceId: "trace-1",
      events: [
        {
          stepIndex: 0,
          actionKind: "tool_call",
          actionName: "DeepAnalyzer",
          raw: "DeepAnalyzer --detailed",
          evidenceExcerpt: "Error: Timeout Error. DeepAnalyzer failed due to computational complexity.",
          outcome: "timeout",
        },
        {
          stepIndex: 1,
          actionKind: "tool_call",
          actionName: "QuickCheck",
          raw: "QuickCheck --network",
          correctionOfStepIndex: 0,
          outcome: "success",
        },
      ],
    });

    expect(extractBehavioralOutcomeFromTrace(trace)).toEqual({
      cue: "detailed analysis",
      evidenceExcerpt: "Error: Timeout Error. DeepAnalyzer failed due to computational complexity.",
      failureClass: "timeout",
      firstAction: {
        kind: "tool_call",
        name: "DeepAnalyzer",
        raw: "DeepAnalyzer --detailed",
      },
      retrievalProfile: "coding_agent",
      saferAlternative: {
        kind: "tool_call",
        name: "QuickCheck",
        raw: "QuickCheck --network",
      },
      traceId: "trace-1",
    });
  });

  it("does not use an unrelated later success as the safer alternative", () => {
    const trace = validateBehavioralTrace({
      cue: "detailed analysis",
      hostKind: "codex",
      traceId: "trace-1b",
      events: [
        {
          stepIndex: 0,
          actionKind: "tool_call",
          actionName: "DeepAnalyzer",
          raw: "DeepAnalyzer --detailed",
          evidenceExcerpt: "DeepAnalyzer timed out on detailed analysis.",
          outcome: "timeout",
        },
        {
          stepIndex: 1,
          actionKind: "tool_call",
          actionName: "QuickCheck",
          raw: "QuickCheck --network",
          correctionOfStepIndex: 0,
          outcome: "failure",
        },
        {
          stepIndex: 2,
          actionKind: "tool_call",
          actionName: "SafeCheck",
          raw: "SafeCheck --summary",
          outcome: "success",
        },
      ],
    });

    expect(extractBehavioralOutcomeFromTrace(trace)).toEqual({
      cue: "detailed analysis",
      evidenceExcerpt: "DeepAnalyzer timed out on detailed analysis.",
      failureClass: "timeout",
      firstAction: {
        kind: "tool_call",
        name: "DeepAnalyzer",
        raw: "DeepAnalyzer --detailed",
      },
      retrievalProfile: "coding_agent",
      traceId: "trace-1b",
    });
  });

  it("does not accept a failed targeted warning as the safer alternative", () => {
    const trace = validateBehavioralTrace({
      cue: "detailed analysis",
      hostKind: "codex",
      traceId: "trace-failed-warning",
      events: [
        {
          stepIndex: 0,
          actionKind: "tool_call",
          actionName: "DeepAnalyzer",
          raw: "DeepAnalyzer --detailed",
          outcome: "timeout",
        },
        {
          stepIndex: 1,
          actionKind: "warning",
          actionName: "warn",
          raw: "Warning: switch to QuickCheck.",
          correctionOfStepIndex: 0,
          outcome: "failure",
        },
      ],
    });

    expect(extractBehavioralOutcomeFromTrace(trace)).toEqual({
      cue: "detailed analysis",
      failureClass: "timeout",
      firstAction: {
        kind: "tool_call",
        name: "DeepAnalyzer",
        raw: "DeepAnalyzer --detailed",
      },
      retrievalProfile: "coding_agent",
      traceId: "trace-failed-warning",
    });
  });

  it("does not derive telemetry from a successful first action", () => {
    const trace = validateBehavioralTrace({
      cue: "system health check",
      hostKind: "codex",
      traceId: "trace-2",
      events: [
        {
          stepIndex: 0,
          actionKind: "tool_call",
          actionName: "QuickCheck",
          raw: "QuickCheck --network",
          outcome: "success",
        },
      ],
    });

    expect(extractBehavioralOutcomeFromTrace(trace)).toBeNull();
  });

  it("records a failed trace through the existing internal outcome-telemetry path", async () => {
    const memory = createInternalGoodMemory(
      {
        storage: { provider: "memory" },
        testing: {
          now: () => new Date("2026-04-21T00:00:00.000Z"),
        },
      },
      {
        behavioralOutcomeRecorder: true,
      },
    );

    const result = await recordBehavioralTrace({
      memory,
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      trace: validateBehavioralTrace({
        cue: "detailed analysis",
        hostKind: "codex",
        traceId: "trace-3",
        events: [
          {
            stepIndex: 0,
            actionKind: "tool_call",
            actionName: "DeepAnalyzer",
            raw: "DeepAnalyzer --detailed",
            evidenceExcerpt: "DeepAnalyzer timed out.",
            outcome: "timeout",
          },
          {
            stepIndex: 1,
            actionKind: "warning",
            actionName: "warn",
            raw: "Warning: switch to QuickCheck.",
            correctionOfStepIndex: 0,
            outcome: "success",
          },
        ],
      }),
    });

    expect(result.recorded).toBe(true);

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    const toolOutcomeExperiences = exported.durable.experiences.filter(
      (experience) => experience.kind === "tool_outcome",
    );

    expect(toolOutcomeExperiences).toHaveLength(1);
    expect(toolOutcomeExperiences[0]?.traceId).toBe("trace-3");
    expect(toolOutcomeExperiences[0]?.sourceTraceIds).toEqual(["trace-3"]);
    expect(toolOutcomeExperiences[0]?.policyApplied).toEqual([]);
    expect(toolOutcomeExperiences[0]?.metadata).toMatchObject({
      "toolOutcome.retrievalProfile": "coding_agent",
      "toolOutcome.schema": "goodmemory.tool_outcome",
      "toolOutcome.version": 1,
    });
    expect(toolOutcomeExperiences[0]?.summary).toContain("DeepAnalyzer");
    expect(toolOutcomeExperiences[0]?.summary).toContain("timeout");
  });
});
