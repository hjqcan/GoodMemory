import { describe, expect, it } from "bun:test";

import {
  buildC5PilotPlan,
} from "../../scripts/codex-coding-effect/c5-pilot-plan";
import {
  runC5LongitudinalPilot,
} from "../../scripts/codex-coding-effect/c5-longitudinal";
import type {
  C5StageExecution,
} from "../../scripts/codex-coding-effect/c5-longitudinal";
import type { C5PilotArm } from "../../scripts/codex-coding-effect/c5-pilot-plan";
import { loadCodexCodingEffectDataset } from "../../scripts/codex-coding-effect/dataset";

const SHA = "a".repeat(64);

describe("Codex coding-effect C5 longitudinal coordinator", () => {
  it("keeps one trajectory scope across stages and materializes each evaluator after both credentials are revoked", async () => {
    const plan = await pilotPlan();
    const events: string[] = [];
    const handles = new Map<string, { id: string }>();
    const recordedPairs: string[] = [];
    const recordedStages: string[] = [];
    const result = await runC5LongitudinalPilot({
      auditLiveLeakage: async ({ cluster, stage }) => {
        events.push(`audit:${cluster.id}:${stage.stageId}`);
        return { auditSha256: SHA, status: "accepted" };
      },
      cleanupTrajectory: async ({ handle, run }) => {
        expect(handle).toBe(handles.get(run.id));
        events.push(`cleanup:${run.id}`);
      },
      evaluatePair: async ({ cluster, executions, stage }) => {
        events.push(`evaluate:${cluster.id}:${stage.stageId}`);
        for (const execution of executions) {
          expect(events.indexOf(`revoke:${execution.stageRunId}`)).toBeLessThan(
            events.length - 1,
          );
        }
        return executions.map((execution) => ({
          arm: execution.arm,
          disposition: "finalized" as const,
          evaluationEvidenceSha256: SHA,
          resolved: execution.arm === "goodmemory-installed",
          taskFailureReasons: execution.arm === "goodmemory-installed"
            ? []
            : ["hidden-fail-to-pass-failed"],
        }));
      },
      executeStage: async ({ handle, run, stage }) => {
        expect(handle).toBe(handles.get(run.id));
        events.push(`execute:${stage.id}`);
        return execution(run.arm, stage.id, `thread:${stage.id}`);
      },
      plan,
      prepareTrajectory: async ({ run }) => {
        const handle = { id: run.id };
        handles.set(run.id, handle);
        events.push(`prepare:${run.id}`);
        return handle;
      },
      recordPair: async (pair) => {
        recordedPairs.push(`${pair.clusterId}/${pair.stageId}`);
      },
      recordStageExecution: async (execution) => {
        recordedStages.push(execution.stageRunId);
      },
      restoreCredential: async ({ stage }) => {
        events.push(`restore:${stage.id}`);
      },
      revokeCredential: async ({ stage }) => {
        events.push(`revoke:${stage.id}`);
      },
    });

    expect(result.stageExecutions).toHaveLength(72);
    expect(result.pairs).toHaveLength(36);
    expect(result.pairs.every((pair) => pair.comparable)).toBe(true);
    expect(result.pairs.every((pair) => pair.outcome === "rescue")).toBe(true);
    expect(new Set(result.stageExecutions.map((stage) => stage.threadId)).size)
      .toBe(72);
    expect(events.filter((event) => event.startsWith("prepare:"))).toHaveLength(24);
    expect(events.filter((event) => event.startsWith("cleanup:"))).toHaveLength(24);
    expect(events.filter((event) => event.startsWith("evaluate:"))).toHaveLength(36);
    expect(events.filter((event) => event.startsWith("restore:"))).toHaveLength(48);
    expect(recordedPairs).toHaveLength(36);
    expect(recordedStages).toHaveLength(72);
    expect(new Set(recordedPairs).size).toBe(36);
    expect(new Set(recordedStages).size).toBe(72);

    for (const pair of result.pairs) {
      const evaluateIndex = events.indexOf(
        `evaluate:${pair.clusterId}:${pair.stageId}`,
      );
      const pairExecutions = result.stageExecutions.filter((execution) =>
        execution.clusterId === pair.clusterId &&
        execution.stageId === pair.stageId
      );
      expect(pairExecutions).toHaveLength(2);
      expect(pairExecutions.every((execution) =>
        events.indexOf(`execute:${execution.stageRunId}`) < evaluateIndex &&
        events.indexOf(`revoke:${execution.stageRunId}`) < evaluateIndex
      )).toBe(true);
    }
  });

  it("retains required-memory failures as explicit incomparable pairs without fallback", async () => {
    const plan = await pilotPlan();
    const result = await runC5LongitudinalPilot({
      auditLiveLeakage: async () => ({
        auditSha256: SHA,
        status: "accepted",
      }),
      cleanupTrajectory: async () => {},
      evaluatePair: async ({ executions }) => executions.map((item) => ({
        arm: item.arm,
        disposition: "finalized" as const,
        evaluationEvidenceSha256: SHA,
        resolved: false,
        taskFailureReasons: ["hidden-fail-to-pass-failed"],
      })),
      executeStage: async ({ run, stage }) => ({
        ...execution(run.arm, stage.id, `thread:${stage.id}`),
        memoryChannelStatus:
          run.arm === "goodmemory-installed" &&
            stage.memoryExpectation === "required"
            ? "failed"
            : run.arm === "no-memory"
            ? "not-applicable"
            : "passed",
      }),
      plan,
      prepareTrajectory: async ({ run }) => ({ id: run.id }),
      restoreCredential: async () => {},
      revokeCredential: async () => {},
    });

    const requiredPairs = result.pairs.filter((pair) =>
      pair.memoryExpectation === "required"
    );
    expect(requiredPairs.length).toBeGreaterThan(0);
    expect(requiredPairs.every((pair) =>
      !pair.comparable &&
      pair.outcome === "incomparable" &&
      pair.incomparabilityReasons.includes(
        "goodmemory-required-memory-channel-failed",
      )
    )).toBe(true);
    expect(result.stageExecutions).toHaveLength(72);
    expect(result.pairs).toHaveLength(36);
  });

  it("treats required not-applicable memory stages as incomparable", async () => {
    const plan = await pilotPlan();
    const result = await runC5LongitudinalPilot({
      auditLiveLeakage: async () => ({ auditSha256: SHA, status: "accepted" }),
      cleanupTrajectory: async () => {},
      evaluatePair: async ({ executions }) => executions.map((item) => ({
        arm: item.arm,
        disposition: "finalized" as const,
        evaluationEvidenceSha256: SHA,
        resolved: true,
        taskFailureReasons: [],
      })),
      executeStage: async ({ run, stage }) => ({
        ...execution(run.arm, stage.id, `thread:${stage.id}`),
        memoryChannelStatus: run.arm === "goodmemory-installed" &&
            stage.memoryExpectation === "required"
          ? "not-applicable"
          : run.arm === "no-memory"
          ? "not-applicable"
          : "passed",
      }),
      plan,
      prepareTrajectory: async ({ run }) => ({ id: run.id }),
      restoreCredential: async () => {},
      revokeCredential: async () => {},
    });

    const requiredPairs = result.pairs.filter((pair) =>
      pair.memoryExpectation === "required"
    );
    expect(requiredPairs.every((pair) =>
      !pair.comparable &&
      pair.incomparabilityReasons.includes(
        "goodmemory-required-memory-channel-failed",
      )
    )).toBe(true);
  });

  it("rejects reused Codex threads across fresh-stage executions", async () => {
    const plan = await pilotPlan();
    await expect(runC5LongitudinalPilot({
      auditLiveLeakage: async () => ({ auditSha256: SHA, status: "accepted" }),
      cleanupTrajectory: async () => {},
      evaluatePair: async ({ executions }) => executions.map((item) => ({
        arm: item.arm,
        disposition: "finalized" as const,
        evaluationEvidenceSha256: SHA,
        resolved: false,
        taskFailureReasons: [],
      })),
      executeStage: async ({ run, stage }) =>
        execution(run.arm, stage.id, "reused-thread"),
      plan,
      prepareTrajectory: async ({ run }) => ({ id: run.id }),
      restoreCredential: async () => {},
      revokeCredential: async () => {},
    })).rejects.toThrow("C5 Codex thread ID was reused");
  });

  it("attempts every prepared cleanup and preserves the primary failure", async () => {
    const plan = await pilotPlan();
    const primaryFailure = new Error("execute-stage-failed");
    const cleanupFailures = new Map<string, Error>();
    const cleanedRunIds: string[] = [];
    let caught: unknown;

    try {
      await runC5LongitudinalPilot({
        auditLiveLeakage: async () => ({
          auditSha256: SHA,
          status: "accepted",
        }),
        cleanupTrajectory: async ({ run }) => {
          cleanedRunIds.push(run.id);
          const failure = new Error(`cleanup-failed:${run.id}`);
          cleanupFailures.set(run.id, failure);
          throw failure;
        },
        evaluatePair: async () => [],
        executeStage: async () => {
          throw primaryFailure;
        },
        plan,
        prepareTrajectory: async ({ run }) => ({ id: run.id }),
        restoreCredential: async () => {},
        revokeCredential: async () => {},
      });
    } catch (error) {
      caught = error;
    }

    const firstClusterRunIds = plan.episodeArmRuns
      .filter((run) => run.clusterId === plan.clusters[0]!.id)
      .map((run) => run.id);
    expect(cleanedRunIds).toHaveLength(2);
    expect(new Set(cleanedRunIds)).toEqual(new Set(firstClusterRunIds));
    expect(caught).toBeInstanceOf(AggregateError);
    if (!(caught instanceof AggregateError)) {
      throw caught;
    }
    expect(caught.errors[0]).toBe(primaryFailure);
    expect(caught.errors.slice(1)).toEqual(
      cleanedRunIds.map((runId) => cleanupFailures.get(runId)),
    );
  });

  it("runs one explicitly selected frozen cluster as a bounded lifecycle canary", async () => {
    const plan = await pilotPlan();
    const cluster = plan.clusters[0]!;
    const prepared: string[] = [];
    const cleaned: string[] = [];
    const result = await runC5LongitudinalPilot({
      auditLiveLeakage: async () => ({ auditSha256: SHA, status: "accepted" }),
      cleanupTrajectory: async ({ run }) => {
        cleaned.push(run.id);
      },
      clusterIds: [cluster.id],
      evaluatePair: async ({ executions }) => executions.map((item) => ({
        arm: item.arm,
        disposition: "finalized" as const,
        evaluationEvidenceSha256: SHA,
        resolved: true,
        taskFailureReasons: [],
      })),
      executeStage: async ({ run, stage }) =>
        execution(run.arm, stage.id, `thread:${stage.id}`),
      plan,
      prepareTrajectory: async ({ run }) => {
        prepared.push(run.id);
        return { id: run.id };
      },
      restoreCredential: async () => {},
      revokeCredential: async () => {},
    });

    expect(result.stageExecutions).toHaveLength(6);
    expect(result.pairs).toHaveLength(3);
    expect(new Set(prepared)).toEqual(new Set(cleaned));
    expect(result.pairs.every((pair) => pair.clusterId === cluster.id)).toBe(true);
  });
});

function execution(
  arm: C5PilotArm,
  stageRunId: string,
  threadId: string,
): C5StageExecution {
  return {
    arm,
    codexDurationMs: 100,
    codexStatus: "completed",
    codexUsage: {
      cachedInputTokens: 10,
      inputTokens: 20,
      outputTokens: 5,
    },
    infrastructureFailureStage: null,
    memoryObservation: arm === "no-memory"
      ? null
      : {
          injectedRecordCount: 1,
          irrelevantInjection: false,
          recalledPriorMemoryCount: 1,
          writebackCommitted: true,
          writtenMemoryCount: 1,
        },
    memoryChannelStatus: arm === "no-memory" ? "not-applicable" : "passed",
    stageEvidenceSha256: SHA,
    stageRunId,
    threadId,
  };
}

async function pilotPlan() {
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
