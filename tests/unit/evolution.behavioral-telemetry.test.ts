import { describe, expect, it } from "bun:test";
import {
  createExperienceRecord,
  createLearningProposal,
} from "../../src/evolution/contracts";
import {
  attachCompiledGuidance,
  buildBehavioralOutcomeExperienceRecord,
  isToolOutcomeExperience,
  parseToolOutcomeMetadata,
  readCompiledGuidance,
} from "../../src/evolution/behavioralTelemetry";

const scope = {
  userId: "u-1",
  workspaceId: "workspace-a",
  sessionId: "s-1",
} as const;

describe("behavioral telemetry", () => {
  it("normalizes tool outcome telemetry into an internal experience record", () => {
    const record = buildBehavioralOutcomeExperienceRecord({
      scope,
      traceId: "trace-tool-outcome-1",
      createdAt: "2026-04-20T00:00:00.000Z",
      createId: () => "xp-tool-outcome-1",
      linkedEvidenceIds: ["evidence-1"],
      result: {
        cue: "detailed analysis",
        failureClass: "timeout",
        firstAction: {
          kind: "tool_call",
          name: "DeepAnalyzer",
          raw: "DeepAnalyzer --detailed",
        },
        modelInfluence: "rules-only",
        retrievalProfile: "coding_agent",
        saferAlternative: {
          kind: "tool_call",
          name: "QuickCheck",
          raw: "QuickCheck --network",
        },
      },
    });

    expect(isToolOutcomeExperience(record)).toBe(true);
    expect(record.kind).toBe("tool_outcome");
    expect(record.summary).toContain("DeepAnalyzer");
    expect(record.policyApplied).toEqual([]);
    expect(record.metadata).toMatchObject({
      "toolOutcome.schema": "goodmemory.tool_outcome",
      "toolOutcome.version": 1,
    });
    expect(record.linkedEvidenceIds).toEqual(["evidence-1"]);

    expect(parseToolOutcomeMetadata(record)).toEqual({
      cue: "detailed analysis",
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
    });
  });

  it("does not parse legacy policy tags even when the record uses the formal kind", () => {
    const record = createExperienceRecord({
      id: "legacy-tool-outcome",
      kind: "tool_outcome",
      policyApplied: [
        "tool_outcome",
        "tool_outcome.cue=copy%20the%20report",
        "tool_outcome.failure_class=arg_order",
        "tool_outcome.first_action.kind=tool_call",
        "tool_outcome.first_action.name=copy_file",
        "tool_outcome.retrieval_profile=coding_agent",
        "tool_outcome.safer_alternative.kind=tool_call",
        "tool_outcome.safer_alternative.name=copy_file_safely",
      ],
      summary: "legacy tagged maintenance row",
      traceId: "legacy-trace",
      userId: scope.userId,
    });

    expect(isToolOutcomeExperience(record)).toBe(true);
    expect(parseToolOutcomeMetadata(record)).toBeNull();
  });

  it("attaches internal compiled guidance without changing the public proposal shape", () => {
    const proposal = attachCompiledGuidance(
      createLearningProposal({
        id: "proposal-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        proposalType: "procedural_pattern",
        traceId: "proposal-trace-1",
        summary: "Promote repeated tool failures into a governed pattern.",
        rationale: "Repeated failures justify a deterministic rule.",
      }),
      {
        rule:
          "When detailed analysis previously caused DeepAnalyzer timeouts, avoid DeepAnalyzer first and use QuickCheck or warn before proceeding.",
        kind: "dont",
        appliesTo: "general_response",
        confidence: 0.9,
      },
    );

    expect(readCompiledGuidance(proposal)).toEqual({
      rule:
        "When detailed analysis previously caused DeepAnalyzer timeouts, avoid DeepAnalyzer first and use QuickCheck or warn before proceeding.",
      kind: "dont",
      appliesTo: "general_response",
      confidence: 0.9,
    });
  });
});
