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
import { createGoodMemoryRuntimeKit } from "../../src/runtime-kit";
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
  it("rejects behavioral outcome recording before using an unversioned conditional writer", () => {
    const inner = createInMemoryDocumentStore();
    let conditionalWriteCount = 0;
    const legacyStore: DocumentStore = {
      delete: (collection, id) => inner.delete(collection, id),
      get: (collection, id) => inner.get(collection, id),
      query: (collection, filter) => inner.query(collection, filter),
      set: (collection, id, document) => inner.set(collection, id, document),
      update: (collection, id, patch) => inner.update(collection, id, patch),
      async writeBatchIfUnchanged() {
        conditionalWriteCount += 1;
        return true;
      },
    };

    expect(() => createInternalGoodMemory(
      { adapters: { documentStore: legacyStore } },
      { behavioralOutcomeRecorder: true, environment: {} },
    )).toThrow(
      "Behavioral outcome recording requires a projection-capable document store",
    );
    expect(conditionalWriteCount).toBe(0);
  });

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
      languagePackVersion: "14-durable-optout-boundary",
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
      retrievalProfile: "coding_agent",
      saferAlternative: {
        args: ["--network", "/tmp/worktree-a"],
        kind: "tool_call",
        name: "QuickCheck",
        raw: "QuickCheck --network /tmp/worktree-a",
      },
      traceId: "direct-outcome-trace-1",
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
      retrievalProfile: "coding_agent",
      saferAlternative: {
        args: ["--network", "/tmp/worktree-a"],
        kind: "tool_call",
        name: "QuickCheck",
        raw: "QuickCheck --network /tmp/worktree-a",
      },
      traceId: "direct-outcome-trace-2",
    });

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    const toolOutcomeExperiences = exported.durable.experiences.filter(
      (experience) => experience.kind === "tool_outcome",
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
        appliesTo: "coding_agent",
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

  it("fails the behavioral outcome atomically when evidence storage fails", async () => {
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
    await expect(
      support!.recordBehavioralOutcome!({
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
      }),
    ).rejects.toThrow("evidence repository unavailable");

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    const toolOutcomeExperiences = exported.durable.experiences.filter(
      (experience) => experience.kind === "tool_outcome",
    );

    expect(exported.durable.evidence).toHaveLength(0);
    expect(toolOutcomeExperiences).toHaveLength(0);
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

  it("keeps a retried host trace as one tool-outcome lineage", async () => {
    const memory = createInternalGoodMemory(
      {
        storage: { provider: "memory" },
        testing: {
          now: () => new Date("2026-04-21T00:00:00.000Z"),
        },
      },
      { behavioralOutcomeRecorder: true },
    );
    const scope = { userId: "u-retry", workspaceId: "workspace-a" };
    const trace = validateBehavioralTrace({
      cue: "detailed analysis",
      hostKind: "codex",
      traceId: "trace-codex-retry",
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
          actionKind: "tool_call",
          actionName: "QuickCheck",
          raw: "QuickCheck --network",
          correctionOfStepIndex: 0,
          outcome: "success",
        },
      ],
    });

    await recordBehavioralTrace({ memory, scope, trace });
    await recordBehavioralTrace({ memory, scope, trace });

    const exported = await memory.exportMemory({ scope });
    const toolOutcomes = exported.durable.experiences.filter(
      (experience) => experience.kind === "tool_outcome",
    );

    expect(toolOutcomes).toHaveLength(1);
    expect(toolOutcomes[0]?.traceId).toBe(trace.traceId);
    expect(toolOutcomes[0]?.sourceTraceIds).toEqual([trace.traceId]);
    expect(exported.durable.evidence).toHaveLength(1);
    expect(exported.durable.proposals).toEqual([]);
    expect(exported.durable.promotions).toEqual([]);
  });

  it("keeps an identical trace idempotent across language configuration changes", async () => {
    const documentStore = createInMemoryDocumentStore();
    const scope = { userId: "u-language-retry", workspaceId: "workspace-a" };
    const trace = validateBehavioralTrace({
      cue: "copy the report",
      hostKind: "codex",
      traceId: "trace-language-retry",
      events: [
        {
          stepIndex: 0,
          actionKind: "tool_call",
          actionName: "copy_file",
          evidenceExcerpt: "The argument order was wrong.",
          outcome: "failure",
        },
        {
          stepIndex: 1,
          actionKind: "tool_call",
          actionName: "copy_file_safe",
          correctionOfStepIndex: 0,
          outcome: "success",
        },
      ],
    });
    const english = createInternalGoodMemory(
      {
        adapters: { documentStore },
        language: { defaultLocale: "en-US" },
      },
      { behavioralOutcomeRecorder: true },
    );
    const japanese = createInternalGoodMemory(
      {
        adapters: { documentStore },
        language: { defaultLocale: "ja-JP" },
      },
      { behavioralOutcomeRecorder: true },
    );

    await recordBehavioralTrace({ memory: english, scope, trace });
    await expect(recordBehavioralTrace({ memory: japanese, scope, trace }))
      .resolves.toMatchObject({ recorded: true });

    const exported = await japanese.exportMemory({ scope });
    expect(exported.durable.experiences).toHaveLength(1);
    expect(exported.durable.evidence).toHaveLength(1);
  });

  it("rejects a trace id reused for a different behavioral outcome", async () => {
    const memory = createInternalGoodMemory(
      { storage: { provider: "memory" } },
      { behavioralOutcomeRecorder: true },
    );
    const scope = { userId: "u-trace-conflict", workspaceId: "workspace-a" };
    const firstTrace = validateBehavioralTrace({
      cue: "copy the report",
      hostKind: "codex",
      traceId: "trace-conflict",
      events: [
        {
          stepIndex: 0,
          actionKind: "tool_call",
          actionName: "copy_file",
          evidenceExcerpt: "The argument order was wrong.",
          outcome: "failure",
        },
        {
          stepIndex: 1,
          actionKind: "tool_call",
          actionName: "copy_file_safe",
          correctionOfStepIndex: 0,
          outcome: "success",
        },
      ],
    });
    const conflictingTrace = validateBehavioralTrace({
      ...firstTrace,
      cue: "delete the report",
      events: [
        {
          ...firstTrace.events[0]!,
          evidenceExcerpt: "The delete target was wrong.",
        },
        firstTrace.events[1]!,
      ],
    });

    await recordBehavioralTrace({ memory, scope, trace: firstTrace });
    await expect(
      recordBehavioralTrace({ memory, scope, trace: conflictingTrace }),
    ).rejects.toThrow("identity conflict");

    const exported = await memory.exportMemory({ scope });
    expect(exported.durable.experiences).toHaveLength(1);
    expect(exported.durable.experiences[0]?.summary).toContain("copy the report");
    expect(exported.durable.evidence).toHaveLength(1);
    expect(exported.durable.evidence[0]?.excerpt).toBe(
      "The argument order was wrong.",
    );
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

    const toolOutcomes = exported.durable.experiences.filter(
      (experience) => experience.kind === "tool_outcome",
    );
    const runtimeKit = createGoodMemoryRuntimeKit({ memory });
    const beforeModelCall = await runtimeKit.beforeModelCall({
      query: "detailed analysis",
      retrievalProfile: "coding_agent",
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });

    expect(toolOutcomes).toHaveLength(2);
    expect(toolOutcomes.every(
      (experience) => experience.metadata?.["toolOutcome.saferAlternative"] === undefined,
    )).toBe(true);
    expect(validatedPatterns).toEqual([]);
    expect(beforeModelCall.context.content).not.toContain("SafeCheck");
    expect(beforeModelCall.context.recordRefs).toBeUndefined();
  });
});
