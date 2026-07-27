import { realpathSync } from "node:fs";

import { describe, expect, it } from "bun:test";

import {
  C6_BUN_FS_PROMISE_OPERATIONS_PER_WORK_ITEM,
  runC6BunFsLivenessStress,
} from "../../../scripts/codex-coding-effect/c6-bun-fs-liveness-stress";

const EXPECTED_BUN_VERSION = "1.3.12";
const EXPECTED_BUN_REVISION =
  "700fc117a2fd01ac0201deaa6fa69c5557acb04f";
const EXPECTED_BUN_EXECUTABLE_SHA256 =
  "39e644cea4e6db24a3af36013695655d6f789b4b98f1f13bacb882ac6e5c3c18";
const EXPECTED_SCRIPT_SHA256 =
  "019cde93809a7cf052b33a965d562a7b8466726766dbf28ccfa8d1ba66b9ce90";
const WORK_ITEMS_PER_SEED = 100_000;
const CONCURRENCY = 8;
const TIMEOUT_MS_PER_SEED = 180_000;
const SEEDS = [0x1a2b3c4d, 0x5e6f7788, 0x10293847] as const;

describe("Phase 73 C6 pinned Bun fs liveness stress gate", () => {
  if (process.arch !== "arm64") {
    it.skip("requires an arm64 host and records no clean result elsewhere", () => {
      // This gate targets the aarch64 WorkPool regression.
    });
    return;
  }

  it("completes 100k fs.promises work items for each of three seeds", async () => {
    const report = await runC6BunFsLivenessStress({
      concurrency: CONCURRENCY,
      expectedArch: "arm64",
      expectedBunExecutableSha256:
        EXPECTED_BUN_EXECUTABLE_SHA256,
      expectedBunRevision: EXPECTED_BUN_REVISION,
      expectedBunVersion: EXPECTED_BUN_VERSION,
      expectedPlatform: "darwin",
      expectedScriptSha256:
        EXPECTED_SCRIPT_SHA256,
      seeds: SEEDS,
      timeoutMsPerSeed: TIMEOUT_MS_PER_SEED,
      workItemsPerSeed: WORK_ITEMS_PER_SEED,
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);

    expect(report.clean).toBe(true);
    expect(report.expected).toEqual({
      arch: "arm64",
      bunExecutableSha256:
        EXPECTED_BUN_EXECUTABLE_SHA256,
      bunRevision: EXPECTED_BUN_REVISION,
      bunVersion: EXPECTED_BUN_VERSION,
      platform: "darwin",
      scriptSha256: EXPECTED_SCRIPT_SHA256,
    });
    expect(report.schemaVersion).toBe(2);
    expect(report.selectedBunExecutable)
      .toBe(realpathSync(process.execPath));
    expect(report.configuration).toEqual({
      concurrency: CONCURRENCY,
      fsPromiseOperationsPerSeed:
        WORK_ITEMS_PER_SEED *
        C6_BUN_FS_PROMISE_OPERATIONS_PER_WORK_ITEM,
      seedCount: SEEDS.length,
      timeoutMsPerSeed: TIMEOUT_MS_PER_SEED,
      workItemsPerSeed: WORK_ITEMS_PER_SEED,
    });
    expect(report.observations.map((observation) => observation.seed))
      .toEqual([...SEEDS]);
    for (const observation of report.observations) {
      expect(observation).toMatchObject({
        completedFsPromiseOperations:
          WORK_ITEMS_PER_SEED *
          C6_BUN_FS_PROMISE_OPERATIONS_PER_WORK_ITEM,
        completedWorkItems: WORK_ITEMS_PER_SEED,
        exitCode: 0,
        failureReason: null,
        status: "passed",
        timedOut: false,
      });
      expect(observation.runtime).toMatchObject({
        arch: "arm64",
        bunRevision: EXPECTED_BUN_REVISION,
        bunVersion: EXPECTED_BUN_VERSION,
        executable:
          realpathSync(process.execPath),
        executableSha256:
          EXPECTED_BUN_EXECUTABLE_SHA256,
        platform: "darwin",
        scriptSha256:
          EXPECTED_SCRIPT_SHA256,
      });
      expect(observation.startSha256)
        .toMatch(/^[a-f0-9]{64}$/u);
      expect(observation.resultSha256)
        .toMatch(/^[a-f0-9]{64}$/u);
    }
  }, 600_000);
});
