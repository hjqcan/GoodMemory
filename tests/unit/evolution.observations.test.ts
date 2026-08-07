import { describe, expect, it } from "bun:test";
import type {
  FeedbackObservationResult,
  RecallObservationResult,
  RememberObservationResult,
} from "../../src/evolution/observation-results";
import {
  buildFeedbackExperienceRecord,
  buildRecallExperienceRecords,
  buildRememberExperienceRecord,
} from "../../src/evolution/observations";

const scope = {
  userId: "u-1",
  workspaceId: "workspace-a",
  sessionId: "s-1",
} as const;

describe("evolution observation normalization", () => {
  it("normalizes remember results into append-only experience telemetry", () => {
    const result: RememberObservationResult = {
      accepted: 2,
      rejected: 1,
      events: [
        {
          memoryId: "fact-1",
          evidenceIds: ["evidence-1"],
        },
        {
          reason: "policy_blocked",
        },
      ],
      modelInfluence: "llm-assisted",
    };

    const record = buildRememberExperienceRecord({
      scope,
      result,
      traceId: "trace-remember-1",
      createdAt: "2026-04-13T00:00:00.000Z",
      createId: () => "xp-remember-1",
    });

    expect(record.id).toBe("xp-remember-1");
    expect(record.kind).toBe("remember");
    expect(record.outcome).toBe("mixed");
    expect(record.modelInfluence).toBe("llm-assisted");
    expect(record.policyApplied).toEqual(["policy_blocked"]);
    expect(record.metrics).toEqual({
      accepted: 2,
      rejected: 1,
    });
    expect(record.linkedMemoryIds).toEqual(["fact-1"]);
    expect(record.linkedEvidenceIds).toEqual(["evidence-1"]);
  });

  it("normalizes recall and verify telemetry from a single recall result", () => {
    const result: RecallObservationResult = {
      preferences: [{ id: "pref-1" }],
      references: [{ id: "ref-1" }],
      facts: [{ id: "fact-1" }],
      feedback: [{ id: "feedback-1" }],
      archives: [{ id: "archive-1" }],
      evidence: [{ id: "evidence-1" }],
      episodes: [{ id: "episode-1" }],
      strategy: "hybrid",
      hitCount: 2,
      hits: [
        {
          evidenceIds: ["evidence-1"],
        },
        {},
      ],
      verificationHints: [
        {
          memoryId: "fact-1",
          evidenceIds: ["evidence-1"],
        },
      ],
      latencyMs: 12,
      tokenCount: 64,
      policyApplied: ["default_scope_guard"],
      modelInfluence: "rules-only",
    };

    const [recallRecord, verifyRecord] = buildRecallExperienceRecords({
      scope,
      result,
      traceId: "trace-recall-1",
      createdAt: "2026-04-13T00:00:00.000Z",
      createId: (() => {
        const ids = ["xp-recall-1", "xp-verify-1"];

        return () => ids.shift() ?? "xp-fallback";
      })(),
    });

    expect(recallRecord.kind).toBe("recall");
    expect(recallRecord.modelInfluence).toBe("rules-only");
    expect(recallRecord.metrics).toEqual({
      hitCount: 2,
      verificationHintCount: 1,
      latencyMs: 12,
      tokenCount: 64,
    });
    expect(recallRecord.linkedMemoryIds).toEqual([
      "pref-1",
      "ref-1",
      "fact-1",
      "feedback-1",
      "episode-1",
    ]);
    expect(recallRecord.linkedArchiveIds).toEqual(["archive-1"]);
    expect(recallRecord.linkedEvidenceIds).toEqual(["evidence-1"]);
    expect(verifyRecord?.kind).toBe("verify");
    expect(verifyRecord?.linkedMemoryIds).toEqual(["fact-1"]);
    expect(verifyRecord?.linkedEvidenceIds).toEqual(["evidence-1"]);
  });

  it("ignores deprecated positive-exposure counters when building new recall experiences", () => {
    const [recallRecord] = buildRecallExperienceRecords({
      scope,
      traceId: "trace-recall-deprecated-exposure",
      createdAt: "2026-04-13T00:00:00.000Z",
      createId: () => "xp-recall-deprecated-exposure",
      result: {
        preferences: [],
        references: [],
        facts: [{ id: "fact-1" }],
        feedback: [{ id: "feedback-1" }],
        archives: [],
        evidence: [],
        episodes: [],
        strategy: "hybrid",
        hitCount: 2,
        hits: [{}, {}],
        verificationHints: [],
        latencyMs: 8,
        tokenCount: 16,
        policyApplied: [],
        modelInfluence: "rules-only",
        touchedFactCount: 1,
        reinforcedFeedbackCount: 1,
      } satisfies RecallObservationResult,
    });

    expect(recallRecord.metrics).toEqual({
      hitCount: 2,
      verificationHintCount: 0,
      latencyMs: 8,
      tokenCount: 16,
    });
    expect(recallRecord.summary).toBe("Recall hybrid returned 2 hit(s).");
  });

  it("marks empty-hit recalls as failure instead of conflating them with skips", () => {
    const [recallRecord] = buildRecallExperienceRecords({
      scope,
      traceId: "trace-recall-empty",
      createdAt: "2026-04-13T00:00:00.000Z",
      createId: () => "xp-recall-empty",
      result: {
        preferences: [],
        references: [],
        facts: [],
        feedback: [],
        archives: [],
        evidence: [],
        episodes: [],
        strategy: "hybrid",
        hitCount: 0,
        hits: [],
        verificationHints: [],
        latencyMs: 8,
        tokenCount: 0,
        policyApplied: ["default_scope_guard"],
        modelInfluence: "rules-only",
      } satisfies RecallObservationResult,
    });

    expect(recallRecord.kind).toBe("recall");
    expect(recallRecord.outcome).toBe("failure");
    expect(recallRecord.metrics).toEqual({
      hitCount: 0,
      verificationHintCount: 0,
      latencyMs: 8,
      tokenCount: 0,
    });
  });

  it("keeps ignore-memory recalls as skipped", () => {
    const [recallRecord] = buildRecallExperienceRecords({
      scope,
      traceId: "trace-recall-skip",
      createdAt: "2026-04-13T00:00:00.000Z",
      createId: () => "xp-recall-skip",
      result: {
        preferences: [],
        references: [],
        facts: [],
        feedback: [],
        archives: [],
        evidence: [],
        episodes: [],
        strategy: "hybrid",
        hitCount: 0,
        hits: [],
        verificationHints: [],
        latencyMs: 6,
        tokenCount: 0,
        policyApplied: ["ignore_memory"],
        modelInfluence: "rules-only",
      } satisfies RecallObservationResult,
    });

    expect(recallRecord.kind).toBe("recall");
    expect(recallRecord.outcome).toBe("skipped");
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
