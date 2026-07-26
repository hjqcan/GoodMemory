import { spawn } from "node:child_process";
import {
  join,
  resolve,
} from "node:path";

import { z } from "zod";

import {
  loadC6AssetLock,
  readC6StableRegularFile,
  verifyC6AssetClosure,
} from "./c6-asset-lock";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const IMAGE =
  "mswebench/sharkdp_m_fd@sha256:aadc030db762ec18d3dd50b77d02ff3b317e1feff9c29ef222f7aced9354677c";
const BASE_COMMIT = "d05e7171d4e2f8feb7d5402026b02aa67a9f9b91";
const BASE_TREE = "7e448a88cb9f87dfbf962fa856e7fe7848040dd2";
const EXPECTED_ASSET_LOCK_SHA256 =
  "d1f87de8146cf05903bf83d5ebf3dd7c93e403f0ef625207e0d7e4288afbe2db";
const FIXED_PATH =
  "/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

const trialIds = [
  "base",
  "test-only",
  "gold-and-test",
  "initial-and-test",
  "first-fix-and-test",
  "final-fix-and-test",
] as const;
export type C6Fd546TrialId = typeof trialIds[number];

interface ExpectedTrial {
  exitCode: number;
  failedTests: readonly string[];
  id: C6Fd546TrialId;
  mainSuite: {
    failed: number;
    passed: number;
  };
  sourcePatchPath: string | null;
  testPatchApplied: boolean;
}

const EXPECTED_TRIALS = [
  trial("base", null, false, 0, 167, 0),
  trial("test-only", null, true, 101, 167, 1, ["test_prune"]),
  trial(
    "gold-and-test",
    "source-final.patch",
    true,
    0,
    168,
    0,
  ),
  trial(
    "initial-and-test",
    "source-initial.patch",
    true,
    101,
    167,
    1,
    ["test_prune"],
  ),
  trial(
    "first-fix-and-test",
    "source-first-fix.patch",
    true,
    0,
    168,
    0,
  ),
  trial(
    "final-fix-and-test",
    "source-final.patch",
    true,
    0,
    168,
    0,
  ),
] as const satisfies readonly ExpectedTrial[];

const sourceVersionSchema = z.object({
  commitSha: z.string().regex(COMMIT_PATTERN),
  patchPath: z.string().min(1),
  patchSha256: z.string().regex(SHA256_PATTERN),
  treeSha: z.string().regex(COMMIT_PATTERN),
}).strict();
const trialSchema = z.object({
  exitCode: z.number().int(),
  failedTests: z.array(z.string()),
  id: z.enum(trialIds),
  mainSuite: z.object({
    failed: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
  }).strict(),
  sourcePatchPath: z.string().nullable(),
  testPatchApplied: z.boolean(),
}).strict();
const evidenceSchema = z.object({
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    executionAuthenticated: z.literal(false),
    stageSpecificEvaluatorRequired: z.literal(true),
  }).strict(),
  dockerProfile: z.object({
    capDrop: z.literal("ALL"),
    daemonIdentityCryptographicallyAttested: z.literal(false),
    daemonTrustBoundary: z.literal(
      "local-docker-daemon-not-cryptographically-attested",
    ),
    network: z.literal("none"),
    noNewPrivileges: z.literal(true),
    platform: z.literal("linux/amd64"),
    pull: z.literal("never"),
  }).strict(),
  identity: z.object({
    harness: z.object({
      commitSha: z.literal(
        "24f493f8a103e72312ded4f6b9c89f081d69cb09",
      ),
      datasetRowBytes: z.literal(44_670),
      datasetRowSha256: z.literal(
        "0b52d0177e4133b7b71e210cd404b26224905bcb6c3813b57b12615cb63658f4",
      ),
      imagesVerifiedSha256: z.literal(
        "4fb39524cbeaadb103ed459c234c47f1ea3d85d5361bd958293a7357fa9c1d69",
      ),
      repositoryHarnessPath: z.literal(
        "multi_swe_bench/harness/repos/rust/sharkdp/fd.py",
      ),
      repositoryHarnessSha256: z.literal(
        "5b19bf090313ab14e6dad8234a10da0780e00004d75755b22564d6706eb123ee",
      ),
      repositoryUrl: z.literal(
        "https://github.com/multi-swe-bench/multi-swe-bench",
      ),
      treeSha: z.literal(
        "741ce10a4ec220fec713112502850b381a6226b9",
      ),
    }).strict(),
    image: z.object({
      architecture: z.literal("amd64"),
      digest: z.literal(
        "sha256:aadc030db762ec18d3dd50b77d02ff3b317e1feff9c29ef222f7aced9354677c",
      ),
      embeddedAssets: z.object({
        "fix-run.sh": z.literal(
          "f700c7b9c56ca090914584282f18f36ce4c3058b3a3bb903d6f843f1aed35222",
        ),
        "fix.patch": z.literal(
          "8b40790051649e06d24692b51aa59cea9269aae4dab10494c229e36786e812bf",
        ),
        "run.sh": z.literal(
          "8b5a80f583eb7b5d7ab529ef7ff4485cd04a52ec65d9dcb5510f04614152b239",
        ),
        "test-run.sh": z.literal(
          "2e6f75ef8178a0efa25d09d02a3f0879c06f2407cd7a91f4784ca54d2e3c0d08",
        ),
        "test.patch": z.literal(
          "94603293a25737d785ee4dde82953f40a71e6318daafadc103aa8e18c7954004",
        ),
      }).strict(),
      operatingSystem: z.literal("linux"),
      reference: z.literal(IMAGE),
    }).strict(),
    instanceId: z.literal("sharkdp__fd-546"),
    pullRequest: z.literal(546),
    repository: z.literal("sharkdp/fd"),
  }).strict(),
  recording: z.object({
    executionAuthenticated: z.literal(false),
    persistedValidation: z.literal(
      "frozen-assets-and-receipt-structure-only",
    ),
    projectionProvesLiveDockerReplay: z.literal(false),
    rawExecutionWitnessRetained: z.literal(false),
    recordedExecutorAuthority: z.literal("local-system-docker"),
    recordedLiveDockerReplayObserved: z.literal(true),
  }).strict(),
  schemaVersion: z.literal("goodmemory.c6.fd546-evaluator-canary.v1"),
  source: z.object({
    base: z.object({
      commitSha: z.literal(BASE_COMMIT),
      treeSha: z.literal(BASE_TREE),
    }).strict(),
    finalFix: sourceVersionSchema,
    firstFix: sourceVersionSchema,
    initial: sourceVersionSchema,
    patchDerivation: z.literal(
      "git-diff-binary-abbrev-9-base-to-commit-excluding-tests",
    ),
    testPatchPath: z.literal("test.patch"),
    testPatchSha256: z.literal(
      "94603293a25737d785ee4dde82953f40a71e6318daafadc103aa8e18c7954004",
    ),
  }).strict(),
  trials: z.array(trialSchema).length(6),
}).strict();

type ParsedEvidence = z.infer<typeof evidenceSchema>;

export interface C6Fd546CommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export type C6Fd546Command = (
  command: readonly string[],
) => Promise<C6Fd546CommandResult>;

export interface C6Fd546EvaluatorCanary
  extends Omit<ParsedEvidence, "recording"> {
  assetLockSha256: string;
  assetRootSha256: string;
  derived: {
    finalEvaluatorDistinguishesFirstFixFromFinalFix: boolean;
    sourceUnitReplayEligible: boolean;
    stageSpecificEvaluatorRequired: boolean;
    threeStageEpisodeEligible: boolean;
  };
  recording: ParsedEvidence["recording"];
}

export interface C6Fd546ReplayInput {
  command?: C6Fd546Command;
  dockerCliPath: string;
  fixtureRoot: string;
}

export async function loadC6Fd546EvaluatorCanary(
  fixtureRoot: string,
): Promise<C6Fd546EvaluatorCanary> {
  const root = resolve(fixtureRoot);
  const lock = await loadC6AssetLock(root);
  if (lock.assetLockSha256 !== EXPECTED_ASSET_LOCK_SHA256) {
    throw new Error("C6 fd#546 asset lock identity does not match");
  }
  const evidenceBytes = await readC6StableRegularFile(
    join(root, "evidence.json"),
    "fd#546 evaluator canary evidence",
  );
  const evidence = evidenceSchema.parse(
    JSON.parse(evidenceBytes.toString("utf8")) as unknown,
  );
  assertSourcePins(evidence);
  if (!equal(evidence.trials, EXPECTED_TRIALS)) {
    throw new Error("C6 fd#546 trial receipt does not match frozen controls");
  }

  const derived = deriveCanaryBoundary(evidence.trials);
  if (
    evidence.boundary.stageSpecificEvaluatorRequired
    !== derived.stageSpecificEvaluatorRequired
  ) {
    throw new Error("C6 fd#546 recorded boundary is not derivable");
  }
  await verifyC6AssetClosure(root, lock);

  return {
    ...evidence,
    assetLockSha256: lock.assetLockSha256,
    assetRootSha256: lock.assetLock.assetRootSha256,
    derived,
  };
}

export function buildC6Fd546DockerCommand(input: {
  dockerCliPath: string;
  fixtureRoot: string;
  trialId: C6Fd546TrialId;
}): readonly string[] {
  const fixtureRoot = resolve(input.fixtureRoot);
  if (/[\u0000\r\n,]/u.test(fixtureRoot)) {
    throw new Error("C6 fd#546 fixture path is not Docker-mount safe");
  }
  const expected = EXPECTED_TRIALS.find((trial) =>
    trial.id === input.trialId
  );
  if (!expected) {
    throw new Error(`Unknown C6 fd#546 trial: ${input.trialId}`);
  }
  const script = [
    "set -euo pipefail",
    "cd /home/fd",
    `test "$(git rev-parse HEAD)" = "${BASE_COMMIT}"`,
    `test "$(git rev-parse 'HEAD^{tree}')" = "${BASE_TREE}"`,
    expected.sourcePatchPath
      ? `git apply /input/${expected.sourcePatchPath}`
      : null,
    expected.testPatchApplied
      ? "git apply /input/test.patch"
      : null,
    "cargo test",
  ].filter((part): part is string => part !== null).join("; ");

  return [
    input.dockerCliPath,
    "run",
    "--rm",
    "--pull=never",
    "--platform=linux/amd64",
    "--network=none",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    `--env=PATH=${FIXED_PATH}`,
    "--env=CARGO_TERM_COLOR=never",
    `--mount=type=bind,src=${fixtureRoot},dst=/input,readonly`,
    IMAGE,
    "/bin/bash",
    "--noprofile",
    "--norc",
    "-c",
    script,
  ];
}

export async function replayC6Fd546EvaluatorCanary(
  input: C6Fd546ReplayInput,
): Promise<{
  boundary: C6Fd546EvaluatorCanary["boundary"];
  derived: C6Fd546EvaluatorCanary["derived"];
  executionAuthenticated: false;
  executionMode: "injected-command-seam" | "system-docker";
  liveDockerReplayObserved: boolean;
  trialCount: number;
}> {
  const canary = await loadC6Fd546EvaluatorCanary(input.fixtureRoot);
  const command = input.command ?? runSystemCommand;
  await inspectImage(command, input.dockerCliPath);
  await inspectEmbeddedAssets(command, input.dockerCliPath);
  for (const expected of canary.trials) {
    const result = await command(buildC6Fd546DockerCommand({
      dockerCliPath: input.dockerCliPath,
      fixtureRoot: input.fixtureRoot,
      trialId: expected.id,
    }));
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    const mainSuite = parseMainSuite(combinedOutput);
    const failedTests = mainSuite.failed === 1
      && /\btest_prune\b/u.test(combinedOutput)
      ? ["test_prune"]
      : [];
    if (
      result.exitCode !== expected.exitCode
      || !equal(mainSuite, expected.mainSuite)
      || !equal(failedTests, expected.failedTests)
    ) {
      throw new Error(
        `C6 fd#546 replay mismatch for ${expected.id}: `
        + JSON.stringify({
          actual: {
            exitCode: result.exitCode,
            failedTests,
            mainSuite,
          },
          expected: {
            exitCode: expected.exitCode,
            failedTests: expected.failedTests,
            mainSuite: expected.mainSuite,
          },
          outputTail: combinedOutput.slice(-2_000),
        }),
      );
    }
  }
  const terminal = await loadC6Fd546EvaluatorCanary(input.fixtureRoot);
  if (
    terminal.assetLockSha256 !== canary.assetLockSha256
    || terminal.assetRootSha256 !== canary.assetRootSha256
  ) {
    throw new Error("C6 fd#546 fixture closure changed during replay");
  }

  return {
    boundary: canary.boundary,
    derived: canary.derived,
    executionAuthenticated: false,
    executionMode: input.command
      ? "injected-command-seam"
      : "system-docker",
    liveDockerReplayObserved: input.command === undefined,
    trialCount: canary.trials.length,
  };
}

async function inspectImage(
  command: C6Fd546Command,
  dockerCliPath: string,
): Promise<void> {
  const result = await command([
    dockerCliPath,
    "image",
    "inspect",
    IMAGE,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `C6 fd#546 image inspect failed: ${result.stderr.slice(-2_000)}`,
    );
  }
  const parsed = z.array(z.object({
    Architecture: z.string(),
    Id: z.string(),
    Os: z.string(),
    RepoDigests: z.array(z.string()),
  }).passthrough()).length(1).parse(
    JSON.parse(result.stdout) as unknown,
  )[0]!;
  if (
    parsed.Architecture !== "amd64"
    || parsed.Os !== "linux"
    || parsed.Id !==
      "sha256:aadc030db762ec18d3dd50b77d02ff3b317e1feff9c29ef222f7aced9354677c"
    || !parsed.RepoDigests.includes(IMAGE)
  ) {
    throw new Error("C6 fd#546 image identity does not match");
  }
}

async function inspectEmbeddedAssets(
  command: C6Fd546Command,
  dockerCliPath: string,
): Promise<void> {
  const paths = [
    "/home/fix.patch",
    "/home/test.patch",
    "/home/run.sh",
    "/home/test-run.sh",
    "/home/fix-run.sh",
  ] as const;
  const result = await command([
    dockerCliPath,
    "run",
    "--rm",
    "--pull=never",
    "--platform=linux/amd64",
    "--network=none",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    IMAGE,
    "/usr/bin/sha256sum",
    ...paths,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `C6 fd#546 embedded asset inspect failed: ${
        result.stderr.slice(-2_000)
      }`,
    );
  }
  const actual = Object.fromEntries(result.stdout.trim().split("\n").map(
    (line) => {
      const match = /^([a-f0-9]{64})  (\/home\/[^\s]+)$/u.exec(line);
      if (!match) {
        throw new Error("C6 fd#546 embedded asset output is invalid");
      }
      return [match[2]!, match[1]!];
    },
  ));
  const expected = {
    "/home/fix.patch":
      "8b40790051649e06d24692b51aa59cea9269aae4dab10494c229e36786e812bf",
    "/home/test.patch":
      "94603293a25737d785ee4dde82953f40a71e6318daafadc103aa8e18c7954004",
    "/home/run.sh":
      "8b5a80f583eb7b5d7ab529ef7ff4485cd04a52ec65d9dcb5510f04614152b239",
    "/home/test-run.sh":
      "2e6f75ef8178a0efa25d09d02a3f0879c06f2407cd7a91f4784ca54d2e3c0d08",
    "/home/fix-run.sh":
      "f700c7b9c56ca090914584282f18f36ce4c3058b3a3bb903d6f843f1aed35222",
  };
  if (!equal(actual, expected)) {
    throw new Error("C6 fd#546 embedded asset identities do not match");
  }
}

function assertSourcePins(evidence: ParsedEvidence): void {
  const expected = {
    finalFix: {
      commitSha: "8ce10d229ed225f021cad16bfa425bc7e5f5e36e",
      patchPath: "source-final.patch",
      patchSha256:
        "8b40790051649e06d24692b51aa59cea9269aae4dab10494c229e36786e812bf",
      treeSha: "e21787b46482750a47ad38a206a9297af2e34d94",
    },
    firstFix: {
      commitSha: "58cf3aa80dc2e32c757099a50f452d717a33c6e9",
      patchPath: "source-first-fix.patch",
      patchSha256:
        "0491d1613765394b34a79fa791d3da1cc5480c126cc612144c60681b31d316da",
      treeSha: "e7a5e1fa1eaa3e75b5ab4a178c086ed28a2c1628",
    },
    initial: {
      commitSha: "04bb426960d69e82342741d336de0596400322a9",
      patchPath: "source-initial.patch",
      patchSha256:
        "d997516d96139ca4802733d7cc7fa5be1b7c15c8ad7e9e2d6919528d78e723a1",
      treeSha: "065785700e82d0040a1b6f3d24b25910f1714029",
    },
  };
  if (!equal({
    finalFix: evidence.source.finalFix,
    firstFix: evidence.source.firstFix,
    initial: evidence.source.initial,
  }, expected)) {
    throw new Error("C6 fd#546 source identities do not match");
  }
}

function deriveCanaryBoundary(
  trials: readonly ExpectedTrial[],
): C6Fd546EvaluatorCanary["derived"] {
  const byId = new Map(trials.map((item) => [item.id, item]));
  const base = requiredTrial(byId, "base");
  const testOnly = requiredTrial(byId, "test-only");
  const gold = requiredTrial(byId, "gold-and-test");
  const initial = requiredTrial(byId, "initial-and-test");
  const firstFix = requiredTrial(byId, "first-fix-and-test");
  const finalFix = requiredTrial(byId, "final-fix-and-test");
  const passes = (item: ExpectedTrial) =>
    item.exitCode === 0 && item.mainSuite.failed === 0;
  const failsPrune = (item: ExpectedTrial) =>
    item.exitCode !== 0
    && item.mainSuite.failed === 1
    && equal(item.failedTests, ["test_prune"]);
  const sourceUnitReplayEligible =
    passes(base)
    && failsPrune(testOnly)
    && passes(gold)
    && failsPrune(initial)
    && passes(firstFix)
    && passes(finalFix);
  const finalEvaluatorDistinguishesFirstFixFromFinalFix =
    !equal(outcome(firstFix), outcome(finalFix));
  const stageSpecificEvaluatorRequired =
    sourceUnitReplayEligible
    && !finalEvaluatorDistinguishesFirstFixFromFinalFix;

  return {
    finalEvaluatorDistinguishesFirstFixFromFinalFix,
    sourceUnitReplayEligible,
    stageSpecificEvaluatorRequired,
    threeStageEpisodeEligible:
      sourceUnitReplayEligible
      && finalEvaluatorDistinguishesFirstFixFromFinalFix,
  };
}

function parseMainSuite(output: string): {
  failed: number;
  passed: number;
} {
  const matches = [
    ...output.matchAll(
      /test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed;/gu,
    ),
  ].map((match) => ({
    failed: Number.parseInt(match[2] ?? "", 10),
    passed: Number.parseInt(match[1] ?? "", 10),
  }));
  if (matches.length === 0) {
    throw new Error(
      "C6 fd#546 did not observe a cargo test result",
    );
  }
  return matches.reduce((total, result) => ({
    failed: total.failed + result.failed,
    passed: total.passed + result.passed,
  }), { failed: 0, passed: 0 });
}

async function runSystemCommand(
  command: readonly string[],
): Promise<C6Fd546CommandResult> {
  const [executable, ...arguments_] = command;
  if (!executable) {
    throw new Error("C6 fd#546 Docker command is empty");
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({
      exitCode: code ?? -1,
      stderr: Buffer.concat(stderr).toString("utf8"),
      stdout: Buffer.concat(stdout).toString("utf8"),
    }));
  });
}

function trial(
  id: C6Fd546TrialId,
  sourcePatchPath: string | null,
  testPatchApplied: boolean,
  exitCode: number,
  passed: number,
  failed: number,
  failedTests: readonly string[] = [],
): ExpectedTrial {
  return {
    exitCode,
    failedTests,
    id,
    mainSuite: { failed, passed },
    sourcePatchPath,
    testPatchApplied,
  };
}

function requiredTrial(
  trials: ReadonlyMap<C6Fd546TrialId, ExpectedTrial>,
  id: C6Fd546TrialId,
): ExpectedTrial {
  const result = trials.get(id);
  if (!result) {
    throw new Error(`Missing C6 fd#546 trial: ${id}`);
  }
  return result;
}

function outcome(trial: ExpectedTrial): unknown {
  return {
    exitCode: trial.exitCode,
    failedTests: trial.failedTests,
    mainSuite: trial.mainSuite,
  };
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
