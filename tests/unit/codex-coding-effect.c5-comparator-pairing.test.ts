import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
  buildC5PilotPlan,
  c5PlanBaselineArm,
} from "../../scripts/codex-coding-effect/c5-pilot-plan";
import type {
  C5PilotArm,
  C5PilotPlan,
  C5PilotStageRun,
} from "../../scripts/codex-coding-effect/c5-pilot-plan";
import {
  runC5LongitudinalPilot,
} from "../../scripts/codex-coding-effect/c5-longitudinal";
import type {
  C5StageExecution,
} from "../../scripts/codex-coding-effect/c5-longitudinal";
import { buildC5PilotReport } from "../../scripts/codex-coding-effect/c5-reporting";
import { loadCodexCodingEffectDataset } from "../../scripts/codex-coding-effect/dataset";
import { EMPTY_FROZEN_PREHISTORY_SHA256 } from "../../scripts/codex-coding-effect/frozen-prehistory";

const SHA = "a".repeat(64);
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe("Codex coding-effect C5 flat-summary comparator pairing", () => {
  it("scores rescue and regression against the flat-summary baseline", async () => {
    const plan = await comparatorPlan();
    expect(c5PlanBaselineArm(plan)).toBe("flat-summary");
    const result = await runFake(plan, {
      resolved: (arm, stage) =>
        arm === "goodmemory-installed" ? stage.position !== 3 : stage.position === 3,
    });
    expect(result.pairs).toHaveLength(36);
    expect(result.pairs.every((pair) => pair.comparable)).toBe(true);
    const byPosition = (position: number) =>
      result.pairs.filter((pair) => pair.stageId === `stage-${position}`);
    expect(byPosition(1).every((pair) => pair.outcome === "rescue")).toBe(true);
    expect(byPosition(2).every((pair) => pair.outcome === "rescue")).toBe(true);
    expect(byPosition(3).every((pair) => pair.outcome === "regression")).toBe(true);
    expect(result.stageExecutions.filter((execution) =>
      execution.arm === "flat-summary"
    )).toHaveLength(36);

    const report = buildC5PilotReport({
      generatedAt: "2026-09-02T00:00:00.000Z",
      plan,
      planSha256: SHA,
      result,
      runId: "c5-comparator-fixture",
    });
    expect(report.effect).toMatchObject({
      baselineArm: "flat-summary",
      baselineResolveRate: 12 / 36,
      comparablePairs: 36,
      goodMemoryResolveRate: 24 / 36,
      noMemoryResolveRate: 12 / 36,
      regressions: 12,
      rescues: 24,
    });
    expect(report.comparatorInjection).toEqual({
      contentInjectionCount: 24,
      hookCanaryFailureCount: 0,
      injectedTokensTotal: 24 * 4,
      zeroInjectionCount: 12,
    });
  });

  it("keeps the no-memory report shape and marks the comparator block absent", async () => {
    const plan = await noMemoryPlan();
    const result = await runFake(plan, { resolved: (arm) => arm === "goodmemory-installed" });
    const report = buildC5PilotReport({
      generatedAt: "2026-09-02T00:00:00.000Z",
      plan,
      planSha256: SHA,
      result,
      runId: "c5-no-memory-fixture",
    });
    expect(report.effect.baselineArm).toBe("no-memory");
    expect(report.effect.baselineResolveRate).toBe(report.effect.noMemoryResolveRate);
    expect(report.comparatorInjection).toBeNull();
  });

  it("makes a flat-summary stage incomparable when its injection mode disagrees with its history", async () => {
    const plan = await comparatorPlan();
    const result = await runFake(plan, {
      injectionModeFor: (stage) =>
        stage.position === 2 ? "no-history-zero-injection" : undefined,
      resolved: () => true,
    });
    const stageTwo = result.pairs.filter((pair) => pair.stageId === "stage-2");
    expect(stageTwo.every((pair) =>
      !pair.comparable &&
      pair.outcome === "incomparable" &&
      pair.incomparabilityReasons.includes("flat-summary-injection-mode-mismatch")
    )).toBe(true);
    expect(result.pairs.filter((pair) => pair.stageId !== "stage-2").every((pair) =>
      pair.comparable
    )).toBe(true);
  });

  it("records a summarizer outage as an incomparable pair instead of aborting the pilot", async () => {
    const plan = await comparatorPlan();
    const result = await runFake(plan, {
      injectionFailureFor: (stage) => stage.position === 2,
      resolved: () => true,
    });
    expect(result.stageExecutions).toHaveLength(plan.counts.stageRuns);
    const stageTwo = result.pairs.filter((pair) => pair.stageId === "stage-2");
    expect(stageTwo).toHaveLength(plan.clusters.length);
    expect(stageTwo.every((pair) =>
      !pair.comparable &&
      pair.outcome === "incomparable" &&
      pair.incomparabilityReasons.includes(
        "flat-summary-infrastructure-flat-summary-injection",
      ) &&
      pair.incomparabilityReasons.includes("flat-summary-injection-mode-mismatch")
    )).toBe(true);
    expect(result.pairs.filter((pair) => pair.stageId !== "stage-2").every((pair) =>
      pair.comparable
    )).toBe(true);
  });

  it("rejects a flat-summary execution without its injection receipt and a no-memory execution with one", async () => {
    const plan = await comparatorPlan();
    await expect(runFake(plan, {
      resolved: () => true,
      stripComparatorInjection: true,
    })).rejects.toThrow("C5 flat-summary execution has no comparator injection receipt");
    const legacy = await noMemoryPlan();
    await expect(runFake(legacy, {
      forceComparatorInjection: true,
      resolved: () => true,
    })).rejects.toThrow("C5 no-memory execution reported a comparator injection");
  });
});

async function runFake(
  plan: C5PilotPlan,
  options: {
    forceComparatorInjection?: boolean;
    injectionFailureFor?: (stage: C5PilotStageRun) => boolean;
    injectionModeFor?: (
      stage: C5PilotStageRun,
    ) => "content-injection" | "no-history-zero-injection" | undefined;
    resolved: (arm: C5PilotArm, stage: C5PilotStageRun) => boolean;
    stripComparatorInjection?: boolean;
  },
) {
  return runC5LongitudinalPilot({
    auditLiveLeakage: async () => ({ auditSha256: SHA, status: "accepted" }),
    cleanupTrajectory: async () => {},
    evaluatePair: async ({ executions, stage }) => executions.map((item) => ({
      arm: item.arm,
      disposition: "finalized" as const,
      evaluationEvidenceSha256: SHA,
      resolved: options.resolved(item.arm, stage),
      taskFailureReasons: [],
    })),
    executeStage: async ({ run, stage }) => {
      const execution = fakeExecution(run.arm, stage);
      if (run.arm === "flat-summary" && options.stripComparatorInjection) {
        delete (execution as Partial<C5StageExecution>).comparatorInjection;
      }
      if (run.arm === "no-memory" && options.forceComparatorInjection) {
        execution.comparatorInjection = zeroInjection();
      }
      const mode = options.injectionModeFor?.(stage);
      if (run.arm === "flat-summary" && mode !== undefined) {
        execution.comparatorInjection = mode === "content-injection"
          ? contentInjection()
          : zeroInjection();
      }
      if (run.arm === "flat-summary" && options.injectionFailureFor?.(stage)) {
        // The runner records a stage whose summarizer call failed before
        // Codex launched: no receipt, no thread, an infrastructure stage.
        execution.comparatorInjection = null;
        execution.codexStatus = "not-started";
        execution.codexUsage = null;
        execution.infrastructureFailureStage = "flat-summary-injection";
        execution.threadId = null;
      }
      return execution;
    },
    plan,
    prepareTrajectory: async ({ run }) => ({ id: run.id }),
    restoreCredential: async () => {},
    revokeCredential: async () => {},
  });
}

function fakeExecution(arm: C5PilotArm, stage: C5PilotStageRun): C5StageExecution {
  const installed = arm === "goodmemory-installed";
  return {
    arm,
    codexDurationMs: 10,
    codexStatus: "completed",
    codexUsage: { cachedInputTokens: 0, inputTokens: 10, outputTokens: 2 },
    ...(arm === "flat-summary"
      ? {
          comparatorInjection: stage.priorStageIds.length === 0
            ? zeroInjection()
            : contentInjection(),
        }
      : {}),
    infrastructureFailureStage: null,
    memoryChannelStatus: installed ? "passed" : "not-applicable",
    memoryObservation: installed
      ? {
          injectedRecordCount: stage.position === 1 ? 0 : 1,
          irrelevantInjection: false,
          recalledPriorMemoryCount: stage.position === 1 ? 0 : 1,
          writebackCommitted: stage.position === 1,
          writtenMemoryCount: stage.position === 1 ? 1 : 0,
        }
      : null,
    stageEvidenceSha256: SHA,
    stageRunId: stage.id,
    threadId: `thread:${stage.id}`,
  };
}

function contentInjection(): NonNullable<C5StageExecution["comparatorInjection"]> {
  return {
    historySourceSha256: sha256("history"),
    hookEvaluationPassed: true,
    injectedContentSha256: sha256("summary"),
    injectedTokenCount: 4,
    mode: "content-injection",
  };
}

function zeroInjection(): NonNullable<C5StageExecution["comparatorInjection"]> {
  return {
    historySourceSha256: EMPTY_FROZEN_PREHISTORY_SHA256,
    hookEvaluationPassed: true,
    injectedContentSha256: null,
    injectedTokenCount: 0,
    mode: "no-history-zero-injection",
  };
}

async function comparatorPlan() {
  const loaded = await loadCodexCodingEffectDataset(
    "fixtures/codex-coding-effect/c4-controlled-pilot",
  );
  return buildC5PilotPlan({
    assetLockSha256: SHA,
    assetRootSha256: SHA,
    baselineArm: "flat-summary",
    baselineCeilingReportSha256: SHA,
    c4ReadinessReportSha256: SHA,
    comparator: {
      summaryEndpointSha256: sha256("endpoint"),
      summaryModel: "gpt-5.6",
      summaryPromptSha256: sha256("prompt"),
    },
    dataset: loaded.dataset,
    manifestSha256: SHA,
    materialEffectPercentagePoints: 10,
    orderSeed: 73,
  });
}

async function noMemoryPlan() {
  const loaded = await loadCodexCodingEffectDataset(
    "fixtures/codex-coding-effect/c4-controlled-pilot",
  );
  return buildC5PilotPlan({
    assetLockSha256: SHA,
    assetRootSha256: SHA,
    baselineCeilingReportSha256: SHA,
    c4ReadinessReportSha256: SHA,
    dataset: loaded.dataset,
    manifestSha256: SHA,
    materialEffectPercentagePoints: 10,
    orderSeed: 73,
  });
}
