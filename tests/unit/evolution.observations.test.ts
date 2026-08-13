import { describe, expect, it } from "bun:test";
import type {
  FeedbackObservationResult,
  RecallVerificationObservationResult,
} from "../../src/evolution/observation-results";
import {
  buildFeedbackExperienceRecord,
  buildRecallVerificationExperienceRecords,
} from "../../src/evolution/observations";

const scope = {
  userId: "u-1",
  workspaceId: "workspace-a",
  sessionId: "s-1",
} as const;

describe("evolution observation normalization", () => {
  it("does not persist routine recall operation telemetry", () => {
    const result: RecallVerificationObservationResult = {
      modelInfluence: "rules-only",
      policyApplied: ["default_scope_guard"],
      verificationHints: [],
    };

    expect(buildRecallVerificationExperienceRecords({
      scope,
      result,
      traceId: "trace-recall-routine",
      createdAt: "2026-04-13T00:00:00.000Z",
      createId: () => "xp-should-not-be-created",
    })).toEqual([]);
  });

  it("normalizes only actionable recall verification telemetry", () => {
    const result: RecallVerificationObservationResult = {
      modelInfluence: "llm-assisted",
      policyApplied: ["default_scope_guard"],
      verificationHints: [
        { memoryId: "fact-1", evidenceIds: ["evidence-1"] },
        { memoryId: "fact-1", evidenceIds: ["evidence-1", "evidence-2"] },
      ],
    };

    const [record] = buildRecallVerificationExperienceRecords({
      scope,
      result,
      traceId: "trace-recall-verify",
      createdAt: "2026-04-13T00:00:00.000Z",
      createId: () => "xp-verify-1",
    });

    expect(record?.kind).toBe("verify");
    expect(record?.modelInfluence).toBe("llm-assisted");
    expect(record?.metrics).toEqual({ verificationHintCount: 2 });
    expect(record?.linkedMemoryIds).toEqual(["fact-1"]);
    expect(record?.linkedEvidenceIds).toEqual(["evidence-1", "evidence-2"]);
    expect(record?.policyApplied).toEqual(["default_scope_guard"]);
  });

  it("normalizes feedback results into experience telemetry", () => {
    const result: FeedbackObservationResult = {
      accepted: true,
      outcome: "written",
      memoryId: "feedback-1",
      kind: "do",
      modelInfluence: "rules-only",
    };

    const record = buildFeedbackExperienceRecord({
      scope,
      result,
      traceId: "trace-feedback-1",
      createdAt: "2026-04-13T00:00:00.000Z",
      createId: () => "xp-feedback-1",
    });

    expect(record.kind).toBe("feedback");
    expect(record.summary).toContain("Feedback written");
    expect(record.linkedMemoryIds).toEqual(["feedback-1"]);
    expect(record.metrics).toEqual({
      accepted: 1,
      rejected: 0,
    });
  });
});
