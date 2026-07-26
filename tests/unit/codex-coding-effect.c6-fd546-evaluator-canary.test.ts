import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

import {
  buildC6Fd546DockerCommand,
  loadC6Fd546EvaluatorCanary,
  replayC6Fd546EvaluatorCanary,
} from "../../scripts/codex-coding-effect/c6-fd546-evaluator-canary";
import type {
  C6Fd546CommandResult,
} from "../../scripts/codex-coding-effect/c6-fd546-evaluator-canary";

const FIXTURE_ROOT = resolve(
  import.meta.dir,
  "../../fixtures/codex-coding-effect/c6-fd546-evaluator-canary",
);
const IMAGE =
  "mswebench/sharkdp_m_fd@sha256:aadc030db762ec18d3dd50b77d02ff3b317e1feff9c29ef222f7aced9354677c";

describe("Codex coding-effect C6 fd#546 evaluator canary", () => {
  it("verifies the frozen source and derives the non-episode boundary", async () => {
    const canary = await loadC6Fd546EvaluatorCanary(FIXTURE_ROOT);

    expect(canary.identity).toMatchObject({
      harness: {
        commitSha: "24f493f8a103e72312ded4f6b9c89f081d69cb09",
        treeSha: "741ce10a4ec220fec713112502850b381a6226b9",
      },
      image: {
        architecture: "amd64",
        digest:
          "sha256:aadc030db762ec18d3dd50b77d02ff3b317e1feff9c29ef222f7aced9354677c",
        operatingSystem: "linux",
        reference: IMAGE,
      },
      repository: "sharkdp/fd",
      pullRequest: 546,
    });
    expect(canary.source).toMatchObject({
      base: {
        commitSha: "d05e7171d4e2f8feb7d5402026b02aa67a9f9b91",
        treeSha: "7e448a88cb9f87dfbf962fa856e7fe7848040dd2",
      },
      initial: {
        commitSha: "04bb426960d69e82342741d336de0596400322a9",
        patchSha256:
          "d997516d96139ca4802733d7cc7fa5be1b7c15c8ad7e9e2d6919528d78e723a1",
        treeSha: "065785700e82d0040a1b6f3d24b25910f1714029",
      },
      firstFix: {
        commitSha: "58cf3aa80dc2e32c757099a50f452d717a33c6e9",
        patchSha256:
          "0491d1613765394b34a79fa791d3da1cc5480c126cc612144c60681b31d316da",
        treeSha: "e7a5e1fa1eaa3e75b5ab4a178c086ed28a2c1628",
      },
      finalFix: {
        commitSha: "8ce10d229ed225f021cad16bfa425bc7e5f5e36e",
        patchSha256:
          "8b40790051649e06d24692b51aa59cea9269aae4dab10494c229e36786e812bf",
        treeSha: "e21787b46482750a47ad38a206a9297af2e34d94",
      },
      testPatchSha256:
        "94603293a25737d785ee4dde82953f40a71e6318daafadc103aa8e18c7954004",
    });
    expect(canary.trials.map((trial) => [
      trial.id,
      trial.exitCode,
      trial.mainSuite,
    ])).toEqual([
      ["base", 0, { failed: 0, passed: 167 }],
      ["test-only", 101, { failed: 1, passed: 167 }],
      ["gold-and-test", 0, { failed: 0, passed: 168 }],
      ["initial-and-test", 101, { failed: 1, passed: 167 }],
      ["first-fix-and-test", 0, { failed: 0, passed: 168 }],
      ["final-fix-and-test", 0, { failed: 0, passed: 168 }],
    ]);
    expect(canary.derived).toEqual({
      finalEvaluatorDistinguishesFirstFixFromFinalFix: false,
      sourceUnitReplayEligible: true,
      stageSpecificEvaluatorRequired: true,
      threeStageEpisodeEligible: false,
    });
    expect(canary.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      executionAuthenticated: false,
      stageSpecificEvaluatorRequired: true,
    });
  });

  it("builds an exact offline Linux amd64 Docker command per trial", () => {
    const command = buildC6Fd546DockerCommand({
      dockerCliPath: "/usr/local/bin/docker",
      fixtureRoot: FIXTURE_ROOT,
      trialId: "first-fix-and-test",
    });

    expect(command.slice(0, 2)).toEqual([
      "/usr/local/bin/docker",
      "run",
    ]);
    expect(command).toContain("--pull=never");
    expect(command).toContain("--platform=linux/amd64");
    expect(command).toContain("--network=none");
    expect(command).toContain("--cap-drop=ALL");
    expect(command).toContain("--security-opt=no-new-privileges");
    expect(command).toContain(
      `--mount=type=bind,src=${FIXTURE_ROOT},dst=/input,readonly`,
    );
    expect(command).toContain(IMAGE);
    expect(command.at(-1)).toContain(
      "git apply /input/source-first-fix.patch; " +
        "git apply /input/test.patch",
    );
    expect(command.at(-1)).toContain(
      "test \"$(git rev-parse HEAD)\" = " +
        "\"d05e7171d4e2f8feb7d5402026b02aa67a9f9b91\"",
    );
  });

  it("replays all controls through the injected seam without authenticating execution", async () => {
    const expected = await loadC6Fd546EvaluatorCanary(FIXTURE_ROOT);
    const calls: readonly string[][] = [];
    const command = async (
      parts: readonly string[],
    ): Promise<C6Fd546CommandResult> => {
      (calls as string[][]).push([...parts]);
      if (calls.length === 1) {
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify([{
            Architecture: "amd64",
            Id:
              "sha256:aadc030db762ec18d3dd50b77d02ff3b317e1feff9c29ef222f7aced9354677c",
            Os: "linux",
            RepoDigests: [IMAGE],
          }]),
        };
      }
      if (calls.length === 2) {
        return {
          exitCode: 0,
          stderr: "",
          stdout: [
            "8b40790051649e06d24692b51aa59cea9269aae4dab10494c229e36786e812bf  /home/fix.patch",
            "94603293a25737d785ee4dde82953f40a71e6318daafadc103aa8e18c7954004  /home/test.patch",
            "8b5a80f583eb7b5d7ab529ef7ff4485cd04a52ec65d9dcb5510f04614152b239  /home/run.sh",
            "2e6f75ef8178a0efa25d09d02a3f0879c06f2407cd7a91f4784ca54d2e3c0d08  /home/test-run.sh",
            "f700c7b9c56ca090914584282f18f36ce4c3058b3a3bb903d6f843f1aed35222  /home/fix-run.sh",
          ].join("\n"),
        };
      }
      const id = expected.trials[calls.length - 3]?.id;
      const trial = expected.trials.find((candidate) => candidate.id === id);
      if (!trial) {
        throw new Error("unexpected trial");
      }
      return {
        exitCode: trial.exitCode,
        stderr: trial.mainSuite.failed === 1
          ? "test test_prune ... FAILED"
          : "",
        stdout: trial.mainSuite.failed === 1
          ? "test result: FAILED. 167 passed; 1 failed; 0 ignored"
          : `test result: ok. ${trial.mainSuite.passed} passed; 0 failed; 0 ignored`,
      };
    };

    const replay = await replayC6Fd546EvaluatorCanary({
      command,
      dockerCliPath: "/usr/local/bin/docker",
      fixtureRoot: FIXTURE_ROOT,
    });

    expect(calls).toHaveLength(8);
    expect(calls[0]?.slice(0, 3)).toEqual([
      "/usr/local/bin/docker",
      "image",
      "inspect",
    ]);
    expect(calls[1]).toContain("--network=none");
    expect(replay).toMatchObject({
      boundary: expected.boundary,
      derived: expected.derived,
      executionAuthenticated: false,
      executionMode: "injected-command-seam",
      liveDockerReplayObserved: false,
      trialCount: 6,
    });
  });
});
