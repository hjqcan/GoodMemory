import {
  describe,
  expect,
  it,
  setDefaultTimeout,
} from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  join,
  resolve,
} from "node:path";

import {
  loadC6Fd546EvaluatorCanary,
  replayC6Fd546EvaluatorCanary,
} from "../../../scripts/codex-coding-effect/c6-fd546-evaluator-canary";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const FIXTURE_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-fd546-evaluator-canary",
);
const DOCKER_CLI =
  process.env.GOODMEMORY_TEST_C6_FD546_DOCKER_CLI?.trim();
const maybeDescribe = DOCKER_CLI ? describe : describe.skip;

const HASHES = {
  assetLock:
    "d1f87de8146cf05903bf83d5ebf3dd7c93e403f0ef625207e0d7e4288afbe2db",
  assetRoot:
    "b13f088c33b7a1862257d8b5521bcb3dcff9078b019a2e385e4148e876c077d9",
  evidence:
    "b304af5ad2733aa05bb36d8ac7066bc93ab51bfeaca54d8d3cbb22f2a5846749",
} as const;

setDefaultTimeout(300_000);

describe("Codex coding-effect C6 fd#546 evaluator canary projection", () => {
  it("freezes a source-unit replay without admitting a three-stage episode", async () => {
    const evidenceBytes = await readFile(join(FIXTURE_ROOT, "evidence.json"));
    expect(sha256(evidenceBytes)).toBe(HASHES.evidence);

    const canary = await loadC6Fd546EvaluatorCanary(FIXTURE_ROOT);
    expect(canary.assetLockSha256).toBe(HASHES.assetLock);
    expect(canary.assetRootSha256).toBe(HASHES.assetRoot);
    expect(canary.recording).toEqual({
      executionAuthenticated: false,
      persistedValidation: "frozen-assets-and-receipt-structure-only",
      projectionProvesLiveDockerReplay: false,
      rawExecutionWitnessRetained: false,
      recordedExecutorAuthority: "local-system-docker",
      recordedLiveDockerReplayObserved: true,
    });
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
});

maybeDescribe("Codex coding-effect C6 fd#546 evaluator canary replay", () => {
  it("replays the exact image offline without authenticating the Docker daemon", async () => {
    const result = await replayC6Fd546EvaluatorCanary({
      dockerCliPath: requiredDockerCli(DOCKER_CLI),
      fixtureRoot: FIXTURE_ROOT,
    });
    expect(result).toEqual({
      boundary: {
        acceptedEpisodeCount: 0,
        candidateManifestFrozen: false,
        codexRunReady: false,
        executionAuthenticated: false,
        stageSpecificEvaluatorRequired: true,
      },
      derived: {
        finalEvaluatorDistinguishesFirstFixFromFinalFix: false,
        sourceUnitReplayEligible: true,
        stageSpecificEvaluatorRequired: true,
        threeStageEpisodeEligible: false,
      },
      executionAuthenticated: false,
      executionMode: "system-docker",
      liveDockerReplayObserved: true,
      trialCount: 6,
    });
  });
});

function requiredDockerCli(value: string | undefined): string {
  if (!value) {
    throw new Error("GOODMEMORY_TEST_C6_FD546_DOCKER_CLI is required");
  }
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
