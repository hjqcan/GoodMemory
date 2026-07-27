import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  C6_BUN_FS_PROMISE_OPERATIONS_PER_WORK_ITEM,
  runC6BunFsLivenessStress,
} from "../../scripts/codex-coding-effect/c6-bun-fs-liveness-stress";

const SCRIPT_PATH = join(
  process.cwd(),
  "scripts/codex-coding-effect/c6-bun-fs-liveness-stress.ts",
);
const EXECUTABLE_SHA256 = sha256File(process.execPath);
const SCRIPT_SHA256 = sha256File(SCRIPT_PATH);

describe("Codex coding-effect C6 Bun fs liveness stress", () => {
  it("runs the fs.promises defect shape in isolated children across seeds", async () => {
    const workItemsPerSeed = 24;
    const report = await runC6BunFsLivenessStress({
      concurrency: 4,
      expectedArch: process.arch,
      expectedBunExecutableSha256:
        EXECUTABLE_SHA256,
      expectedBunRevision: Bun.revision,
      expectedBunVersion: Bun.version,
      expectedPlatform: process.platform,
      expectedScriptSha256: SCRIPT_SHA256,
      seeds: [11, 29],
      timeoutMsPerSeed: 10_000,
      workItemsPerSeed,
    });

    expect(report.clean).toBe(true);
    expect(report.expected).toEqual({
      arch: process.arch,
      bunExecutableSha256:
        EXECUTABLE_SHA256,
      bunRevision: Bun.revision,
      bunVersion: Bun.version,
      platform: process.platform,
      scriptSha256: SCRIPT_SHA256,
    });
    expect(report.configuration.seedCount).toBe(2);
    expect(report.configuration.workItemsPerSeed).toBe(workItemsPerSeed);
    expect(report.configuration.fsPromiseOperationsPerSeed).toBe(
      workItemsPerSeed * C6_BUN_FS_PROMISE_OPERATIONS_PER_WORK_ITEM,
    );
    expect(report.observations).toHaveLength(2);
    for (const observation of report.observations) {
      expect(observation.status).toBe("passed");
      expect(observation.timedOut).toBe(false);
      expect(observation.terminationSignalRequested).toBeNull();
      expect(observation.runtime).toMatchObject({
        arch: process.arch,
        bunVersion: Bun.version,
      });
      expect(observation.completedWorkItems).toBe(workItemsPerSeed);
      expect(observation.completedFsPromiseOperations).toBe(
        workItemsPerSeed * C6_BUN_FS_PROMISE_OPERATIONS_PER_WORK_ITEM,
      );
    }
  }, 30_000);

  it("marks a deadline breach dirty and SIGKILLs the stalled child", async () => {
    const startedAt = performance.now();
    const report = await runC6BunFsLivenessStress({
      concurrency: 1,
      expectedArch: process.arch,
      expectedBunExecutableSha256:
        EXECUTABLE_SHA256,
      expectedBunRevision: Bun.revision,
      expectedBunVersion: Bun.version,
      expectedPlatform: process.platform,
      expectedScriptSha256: SCRIPT_SHA256,
      seeds: [41],
      testFaultMode: "stall-after-start",
      timeoutMsPerSeed: 250,
      workItemsPerSeed: 1,
    });
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeLessThan(5_000);
    expect(report.clean).toBe(false);
    expect(report.observations).toHaveLength(1);
    expect(report.observations[0]).toMatchObject({
      completedFsPromiseOperations: 0,
      completedWorkItems: 0,
      seed: 41,
      status: "timed-out",
      terminationSignalRequested: "SIGKILL",
      timedOut: true,
    });
    expect(report.observations[0]?.runtime).toMatchObject({
      arch: process.arch,
      bunVersion: Bun.version,
    });
    expect(report.observations[0]?.failureReason).toContain(
      "hard deadline",
    );
  }, 10_000);

  it("rejects a runtime mismatch before entering the stress workload", async () => {
    const report = await runC6BunFsLivenessStress({
      concurrency: 1,
      expectedArch: process.arch,
      expectedBunExecutableSha256:
        EXECUTABLE_SHA256,
      expectedBunRevision: Bun.revision,
      expectedBunVersion: "0.0.0-runtime-mismatch",
      expectedPlatform: process.platform,
      expectedScriptSha256: SCRIPT_SHA256,
      seeds: [53],
      testFaultMode: "stall-after-start",
      timeoutMsPerSeed: 2_000,
      workItemsPerSeed: 1,
    });

    expect(report.clean).toBe(false);
    expect(report.observations[0]).toMatchObject({
      completedFsPromiseOperations: 0,
      completedWorkItems: 0,
      status: "failed",
      timedOut: false,
    });
    expect(report.observations[0]?.failureReason).toContain(
      "expected Bun 0.0.0-runtime-mismatch",
    );
  }, 10_000);

  it("reports completed operations before a workload failure", async () => {
    const report = await runC6BunFsLivenessStress({
      concurrency: 1,
      expectedArch: process.arch,
      expectedBunExecutableSha256:
        EXECUTABLE_SHA256,
      expectedBunRevision: Bun.revision,
      expectedBunVersion: Bun.version,
      expectedPlatform: process.platform,
      expectedScriptSha256: SCRIPT_SHA256,
      seeds: [59],
      testFaultMode: "fail-after-one-work-item",
      timeoutMsPerSeed: 2_000,
      workItemsPerSeed: 3,
    });

    expect(report.clean).toBe(false);
    expect(report.observations[0]).toMatchObject({
      completedFsPromiseOperations: 7,
      completedWorkItems: 1,
      status: "failed",
      timedOut: false,
    });
    expect(report.observations[0]?.failureReason)
      .toContain("forced workload failure");
  });

  it("rejects stdout that claims completion without executing the child", async () => {
    const restore = replaceSpawn(() =>
      fakeChild({
        stderr: immediateStream(""),
        stdout: immediateStream([
          {
            concurrency: 0,
            event: "start",
            protocol:
              "c6-bun-fs-liveness-child-v1",
            requestedFsPromiseOperations: 0,
            requestedWorkItems: 0,
            runtime: {
              arch: process.arch,
              bunRevision: Bun.revision,
              bunVersion: Bun.version,
              executable: "/forged/bun",
              platform: process.platform,
            },
            seed: 999,
          },
          {
            completedFsPromiseOperations: 0,
            completedWorkItems: 0,
            event: "complete",
            protocol:
              "c6-bun-fs-liveness-child-v1",
            seed: 999,
          },
          {
            completedFsPromiseOperations: 7,
            completedWorkItems: 1,
            event: "heartbeat",
            protocol:
              "c6-bun-fs-liveness-child-v1",
            seed: 999,
          },
          {
            event: "error",
            message: "forged failure",
            protocol:
              "c6-bun-fs-liveness-child-v1",
            seed: 999,
          },
        ].map((value) => JSON.stringify(value)).join("\n")),
      })
    );
    try {
      const report = await runC6BunFsLivenessStress({
        concurrency: 1,
        expectedArch: process.arch,
        expectedBunExecutableSha256:
          EXECUTABLE_SHA256,
        expectedBunRevision: Bun.revision,
        expectedBunVersion: Bun.version,
        expectedPlatform: process.platform,
        expectedScriptSha256: SCRIPT_SHA256,
        seeds: [61],
        timeoutMsPerSeed: 1_000,
        workItemsPerSeed: 1,
      });

      expect(report.clean).toBe(false);
      expect(report.observations[0]?.status)
        .toBe("failed");
    } finally {
      restore();
    }
  });

  it("rejects executable and child-source hash mismatches before workload", async () => {
    await expect(
      runC6BunFsLivenessStress({
        concurrency: 1,
        expectedArch: process.arch,
        expectedBunExecutableSha256:
          "0".repeat(64),
        expectedBunRevision: Bun.revision,
        expectedBunVersion: Bun.version,
        expectedPlatform: process.platform,
        expectedScriptSha256: SCRIPT_SHA256,
        seeds: [67],
        timeoutMsPerSeed: 1_000,
        workItemsPerSeed: 1,
      }),
    ).rejects.toThrow("executable SHA-256");
    await expect(
      runC6BunFsLivenessStress({
        concurrency: 1,
        expectedArch: process.arch,
        expectedBunExecutableSha256:
          EXECUTABLE_SHA256,
        expectedBunRevision: Bun.revision,
        expectedBunVersion: Bun.version,
        expectedPlatform: process.platform,
        expectedScriptSha256:
          "0".repeat(64),
        seeds: [71],
        timeoutMsPerSeed: 1_000,
        workItemsPerSeed: 1,
      }),
    ).rejects.toThrow("script SHA-256");
  });

  it("does not wait for inherited output pipes after the child exits", async () => {
    const restore = replaceSpawn(() =>
      fakeChild({
        stderr: delayedStream(800),
        stdout: delayedStream(800),
      })
    );
    const startedAt = performance.now();
    try {
      const report = await runC6BunFsLivenessStress({
        concurrency: 1,
        expectedArch: process.arch,
        expectedBunExecutableSha256:
          EXECUTABLE_SHA256,
        expectedBunRevision: Bun.revision,
        expectedBunVersion: Bun.version,
        expectedPlatform: process.platform,
        expectedScriptSha256: SCRIPT_SHA256,
        seeds: [73],
        timeoutMsPerSeed: 50,
        workItemsPerSeed: 1,
      });

      expect(report.clean).toBe(false);
      expect(performance.now() - startedAt)
        .toBeLessThan(300);
    } finally {
      restore();
    }
  });
});

function replaceSpawn(
  replacement: typeof Bun.spawn,
): () => void {
  const original = Bun.spawn;
  Bun.spawn = replacement;
  return () => {
    Bun.spawn = original;
  };
}

function fakeChild(input: {
  stderr: ReadableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
}): ReturnType<typeof Bun.spawn> {
  return {
    exited: Promise.resolve(0),
    kill: () => undefined,
    signalCode: null,
    stderr: input.stderr,
    stdout: input.stdout,
  } as unknown as ReturnType<typeof Bun.spawn>;
}

function immediateStream(value: string):
  ReadableStream<Uint8Array> {
  return new Blob([value]).stream();
}

function delayedStream(
  delayMs: number,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async pull(controller) {
      await Bun.sleep(delayMs);
      controller.close();
    },
  });
}

function sha256File(path: string): string {
  return createHash("sha256")
    .update(readFileSync(path))
    .digest("hex");
}
