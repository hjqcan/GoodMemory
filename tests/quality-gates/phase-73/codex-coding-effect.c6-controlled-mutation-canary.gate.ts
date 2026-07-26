import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  materializeC6ControlledMutationCanary,
} from "../../../scripts/codex-coding-effect/c6-controlled-mutation-builder";

const ASSET_ROOT = resolve(
  import.meta.dir,
  "../../../fixtures/codex-coding-effect/c6-controlled-mutation-canary",
);
const RECEIPT_PATH = resolve(
  import.meta.dir,
  "../../../reports/quality-gates/phase-73/c6-controlled-mutation-canary/linux-amd64-receipt.json",
);
const RUNTIME_PROFILE_PATH = resolve(
  ASSET_ROOT,
  "runtime/linux-amd64-profile.json",
);
const DOCKERFILE_PATH = resolve(ASSET_ROOT, "runtime/Dockerfile");
const ASSET_LOCK_SHA256 =
  "50cf13e60d2e8930b84d1a9349ecacf7a4765df69e2abba48c0ed5e07bbfcaad";
const ASSET_ROOT_SHA256 =
  "c2ebf22628d046ce862f80206b747616a310ceb567040ddd98b8884d8e8c3f81";
const SUPPLY_SHA256 =
  "0f5442114641603c5775f964f2cee9e0502ec79c3565f5e4ab8819a8db348cee";
const RECEIPT_SHA256 =
  "b084eda0c425925947644e59f9c86495743d381c5ab19e728bc9b6712211c60b";

describe("Phase 73 C6 controlled-mutation canary gate", () => {
  it("replays the exact supply and preserves the Linux observation boundary", async () => {
    const [receiptBytes, runtimeProfileBytes, dockerfileBytes] =
      await Promise.all([
        readFile(RECEIPT_PATH, "utf8"),
        readFile(RUNTIME_PROFILE_PATH, "utf8"),
        readFile(DOCKERFILE_PATH, "utf8"),
      ]);
    expect(sha256(receiptBytes)).toBe(RECEIPT_SHA256);
    const receipt = JSON.parse(receiptBytes);
    expect(`${JSON.stringify(receipt, null, 2)}\n`).toBe(receiptBytes);
    const runtimeProfile = JSON.parse(runtimeProfileBytes);
    expect(`${JSON.stringify(runtimeProfile, null, 2)}\n`).toBe(
      runtimeProfileBytes,
    );
    expect(runtimeProfile).toMatchObject({
      bun: {
        executableSha256:
          "45598a2814020c231575487a560e47d397d6902355d7e08171a2e56221a6d675",
        version: "1.3.11",
      },
      dockerfileSha256: sha256(dockerfileBytes),
      finalImageSha256:
        "6967283eaf7c1e0ca4dbf4c72fd43b1cf3676f28371a635619fde3f07975373c",
      git: {
        executableSha256:
          "00c84136d8294294580daa32f25b3e83ddb8341e9b5b70722e4c9a973ba5f749",
        version: "2.39.5",
      },
      imageBuildNetworkMode: "none",
      platform: "linux/amd64",
    });
    expect(receipt).toMatchObject({
      candidateManifestFrozen: false,
      codexRunReady: false,
      executionProfile: {
        architecture: "x64",
        bunVersion: "1.3.11",
        gitVersion: "git version 2.39.5",
        operatingSystem: "linux",
        receiptAuthentication: "none",
      },
      evaluatorDependencyClosureFrozen: false,
      evaluatorFactoryBundleSha256:
        "4de00487bd5e4fe4a397c17e2ae2b7da32425fdf23da189f9587e659a0ba0b83",
      fullUpstreamCiExecuted: false,
      inputSnapshotSha256: ASSET_ROOT_SHA256,
      networkIsolation: "not-attested",
      source: {
        upstreamCommit: "82632b66f5914e9946edce300e10633a3d5c0cb7",
        upstreamTree: "f98fd0ecb1056fb087f117a97241a433309f087c",
      },
      supply: {
        candidateManifestFrozen: false,
        codexRunReady: false,
        mutationFamilyCount: 2,
        representativeCellCount: 2,
        selectedRepresentativeCount: 2,
        semanticDuplicateCount: 1,
        totalDerivationCount: 3,
      },
    });

    const outputRoot = await realpath(
      await mkdtemp(join(tmpdir(), "goodmemory-c6-mutation-gate-")),
    );
    try {
      const replay = await materializeC6ControlledMutationCanary({
        assetRoot: ASSET_ROOT,
        expectedAssetLockSha256: ASSET_LOCK_SHA256,
        expectedAssetRootSha256: ASSET_ROOT_SHA256,
        expectedSupplySha256: SUPPLY_SHA256,
        outputRoot,
      });
      expect(replay.source).toEqual(receipt.source);
      expect(replay.supply).toEqual(receipt.supply);
      expect(replay.projection).toEqual(receipt.projection);
      expect(replay.evaluatorFactoryBundleSha256).toBe(
        receipt.evaluatorFactoryBundleSha256,
      );
      expect(replay.inputSnapshotSha256).toBe(receipt.inputSnapshotSha256);
      expect(replay.runs).toEqual(receipt.runs);
    } finally {
      await rm(outputRoot, { force: true, recursive: true });
    }
  }, 30_000);
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
