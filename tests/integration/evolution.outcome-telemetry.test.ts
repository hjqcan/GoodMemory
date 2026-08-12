import { describe, expect, it } from "bun:test";
import { createInternalGoodMemory } from "../../src/api/createGoodMemory";
import {
  GOODMEMORY_EVAL_SUPPORT,
  type GoodMemoryEvalSupport,
} from "../../src/api/evalSupport";
import { EVIDENCE_COLLECTION } from "../../src/evidence/contracts";
import { readBehavioralPolicyFromFeedbackMemory } from "../../src/evolution/behavioralPolicy";
import { recordBehavioralTrace } from "../../src/host/behavioralTraceBridge";
import { validateBehavioralTrace } from "../../src/host/behavioralTrace";
import {
  createInMemoryDocumentStore,
} from "../../src/storage/memory";
import type { DocumentStore } from "../../src/storage/contracts";

function createEvidenceFailingDocumentStore(): DocumentStore {
  const store = createInMemoryDocumentStore();

  return {
    ...store,
    async set(collection, id, document) {
      if (collection === EVIDENCE_COLLECTION) {
        throw new Error("evidence repository unavailable");
      }

      await store.set(collection, id, document);
    },
    async writeBatchIfUnchanged(input) {
      if (
        input.set.some(
          (operation) => operation.collection === EVIDENCE_COLLECTION,
        )
      ) {
        throw new Error("evidence repository unavailable");
      }

      return store.writeBatchIfUnchanged(input);
    },
  };
}

describe("outcome telemetry promotion chain", () => {
  it("persists language-pack provenance on behavioral outcome evidence", async () => {
    const memory = createInternalGoodMemory(
      {
        language: { defaultLocale: "ja-JP" },
        storage: { provider: "memory" },
        testing: {
          now: () => new Date("2026-04-20T00:00:00.000Z"),
        },
      },
      { behavioralOutcomeRecorder: true },
    );
    const support = (
      memory as typeof memory & {
        [GOODMEMORY_EVAL_SUPPORT]?: GoodMemoryEvalSupport;
      }
    )[GOODMEMORY_EVAL_SUPPORT];

    await support!.recordBehavioralOutcome!({
      scope: { userId: "u-ja", workspaceId: "workspace-ja" },
      cue: "移行検証",
      evidenceExcerpt: "データベース移行がタイムアウトしました。",
      failureClass: "timeout",
      firstAction: { kind: "tool_call", name: "DeepAnalyzer" },
    });
    const exported = await memory.exportMemory({
      scope: { userId: "u-ja", workspaceId: "workspace-ja" },
    });

    expect(exported.durable.evidence[0]?.source).toMatchObject({
      languagePackId: "ja",
      languagePackVersion: "8-explicit-fact-list-boundary",
      locale: "ja-JP",
      localeSource: "detected",
    });
  });

  it("promotes repeated tool outcome failures into a validated pattern without explicit feedback memory", async () => {
    const memory = createInternalGoodMemory(
      {
        storage: { provider: "memory" },
        testing: {
          now: () => new Date("2026-04-20T00:00:00.000Z"),
        },
      },
      {
        behavioralOutcomeRecorder: true,
      },
    );
    const support = (
      memory as typeof memory & {
        [GOODMEMORY_EVAL_SUPPORT]?: GoodMemoryEvalSupport;
      }
    )[GOODMEMORY_EVAL_SUPPORT];

    expect(support?.recordBehavioralOutcome).toBeDefined();

    await support!.recordBehavioralOutcome!({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      cue: "detailed analysis",
      evidenceExcerpt: "Error: Timeout Error. DeepAnalyzer failed due to computational complexity.",
      failureClass: "timeout",
      firstAction: {
        kind: "tool_call",
        name: "DeepAnalyzer",
        raw: "DeepAnalyzer --detailed",
      },
      saferAlternative: {
        args: ["--network", "/tmp/worktree-a"],
        kind: "tool_call",
        name: "QuickCheck",
        raw: "QuickCheck --network /tmp/worktree-a",
      },
    });
    await support!.recordBehavioralOutcome!({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      cue: "detailed analysis",
      evidenceExcerpt: "Error: Timeout Error. DeepAnalyzer cannot handle detailed analysis requests.",
      failureClass: "timeout",
      firstAction: {
        kind: "tool_call",
        name: "DeepAnalyzer",
        raw: "DeepAnalyzer --detailed",
      },
      saferAlternative: {
        args: ["--network", "/tmp/worktree-a"],
        kind: "tool_call",
        name: "QuickCheck",
        raw: "QuickCheck --network /tmp/worktree-a",
      },
    });

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    const toolOutcomeExperiences = exported.durable.experiences.filter(
      (experience) => (experience.kind as string) === "tool_outcome",
    );
    const proposals = exported.durable.proposals.filter(
      (proposal) => proposal.proposalType === "procedural_pattern",
    );
    const acceptedPromotions = exported.durable.promotions.filter(
      (promotion) => promotion.decision === "accepted",
    );
    const validatedPatterns = exported.durable.feedback.filter(
      (feedback) =>
        feedback.kind === "validated_pattern" && feedback.lifecycle === "active",
    );

    expect(toolOutcomeExperiences).toHaveLength(2);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.status).toBe("accepted");
    expect(acceptedPromotions).toHaveLength(1);
    expect(validatedPatterns).toHaveLength(1);
    expect(validatedPatterns[0]?.rule).toContain("avoid DeepAnalyzer");
    expect(validatedPatterns[0]?.rule).toContain("QuickCheck");
    expect(validatedPatterns[0]?.source.method).toBe("confirmed");
    expect(readBehavioralPolicyFromFeedbackMemory(validatedPatterns[0]!)).toEqual({
      behavioralKind: "first_action",
      enactmentSurface: "host_action",
      applicability: {
        actionSummaryContains: ["detailed analysis"],
        appliesTo: "general_response",
        canonicalFirstAction: {
          args: ["--network"],
          kind: "tool_call",
          name: "QuickCheck",
          raw: "QuickCheck --network",
        },
        queryContains: ["detailed analysis"],
      },
      transferMode: "pattern_bounded",
    });
    expect(
      readBehavioralPolicyFromFeedbackMemory(validatedPatterns[0]!)?.applicability
        .argumentOrder,
    ).toBeUndefined();
    expect(validatedPatterns[0]?.rule).not.toContain("/tmp/worktree-a");
  });

  it("does not persist dangling evidence lineage when evidence storage fails", async () => {
    const memory = createInternalGoodMemory(
      {
        storage: { provider: "memory" },
        adapters: {
          documentStore: createEvidenceFailingDocumentStore(),
        },
        testing: {
          now: () => new Date("2026-04-20T00:00:00.000Z"),
        },
      },
      {
        behavioralOutcomeRecorder: true,
      },
    );
    const support = (
      memory as typeof memory & {
        [GOODMEMORY_EVAL_SUPPORT]?: GoodMemoryEvalSupport;
      }
    )[GOODMEMORY_EVAL_SUPPORT];
    const originalConsoleError = console.error;
    console.error = () => undefined;

    try {
      await support!.recordBehavioralOutcome!({
        scope: { userId: "u-1", workspaceId: "workspace-a" },
        cue: "detailed analysis",
        evidenceExcerpt: "DeepAnalyzer timed out during detailed analysis.",
        failureClass: "timeout",
        firstAction: {
          kind: "tool_call",
          name: "DeepAnalyzer",
          raw: "DeepAnalyzer --detailed",
        },
        saferAlternative: {
          kind: "tool_call",
          name: "QuickCheck",
          raw: "QuickCheck --network",
        },
      });
    } finally {
      console.error = originalConsoleError;
    }

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    const toolOutcomeExperiences = exported.durable.experiences.filter(
      (experience) => (experience.kind as string) === "tool_outcome",
    );

    expect(exported.durable.evidence).toHaveLength(0);
    expect(toolOutcomeExperiences).toHaveLength(1);
    expect(toolOutcomeExperiences[0]?.linkedEvidenceIds).toEqual([]);
  });

  it("promotes repeated failed Codex traces into a validated pattern through the same telemetry chain", async () => {
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

    await recordBehavioralTrace({
      memory,
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      trace: validateBehavioralTrace({
        cue: "detailed analysis",
        hostKind: "codex",
        traceId: "trace-codex-1",
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
            outcome: "success",
          },
        ],
      }),
    });
    await recordBehavioralTrace({
      memory,
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      trace: validateBehavioralTrace({
        cue: "detailed analysis",
        hostKind: "codex",
        traceId: "trace-codex-2",
        events: [
          {
            stepIndex: 0,
            actionKind: "tool_call",
            actionName: "DeepAnalyzer",
            raw: "DeepAnalyzer --detailed",
            evidenceExcerpt: "DeepAnalyzer timed out again on detailed analysis.",
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
      }),
    });

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    const validatedPatterns = exported.durable.feedback.filter(
      (feedback) =>
        feedback.kind === "validated_pattern" && feedback.lifecycle === "active",
    );

    expect(validatedPatterns).toHaveLength(1);
    expect(validatedPatterns[0]?.rule).toContain("avoid DeepAnalyzer");
    expect(validatedPatterns[0]?.rule).toContain("QuickCheck");
    expect(
      readBehavioralPolicyFromFeedbackMemory(validatedPatterns[0]!),
    )?.toMatchObject({
      behavioralKind: "first_action",
      enactmentSurface: "host_action",
      transferMode: "pattern_bounded",
    });
  });

  it("does not compile a failed targeted correction into durable guidance when a later safer action succeeds", async () => {
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

    await recordBehavioralTrace({
      memory,
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      trace: validateBehavioralTrace({
        cue: "detailed analysis",
        hostKind: "codex",
        traceId: "trace-codex-fallback-1",
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
      }),
    });
    await recordBehavioralTrace({
      memory,
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      trace: validateBehavioralTrace({
        cue: "detailed analysis",
        hostKind: "codex",
        traceId: "trace-codex-fallback-2",
        events: [
          {
            stepIndex: 0,
            actionKind: "tool_call",
            actionName: "DeepAnalyzer",
            raw: "DeepAnalyzer --detailed",
            evidenceExcerpt: "DeepAnalyzer timed out again on detailed analysis.",
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
      }),
    });

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    const validatedPatterns = exported.durable.feedback.filter(
      (feedback) =>
        feedback.kind === "validated_pattern" && feedback.lifecycle === "active",
    );

    expect(validatedPatterns).toHaveLength(1);
    expect(validatedPatterns[0]?.rule).toContain("avoid DeepAnalyzer");
    expect(validatedPatterns[0]?.rule).toContain("SafeCheck");
    expect(validatedPatterns[0]?.rule).not.toContain("QuickCheck");
  });
});
