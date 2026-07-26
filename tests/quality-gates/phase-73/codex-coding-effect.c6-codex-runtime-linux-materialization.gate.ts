import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { loadC6AssetLock } from "../../../scripts/codex-coding-effect/c6-asset-lock";
import {
  verifyC6CodexRuntimeLinuxMaterialization,
} from "../../../scripts/codex-coding-effect/c6-codex-runtime-linux";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const FIXTURE_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-codex-runtime",
);
const MATERIALIZATION_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-codex-runtime-linux-materialization",
);
const ARTIFACTS_ROOT = join(MATERIALIZATION_ROOT, "artifacts");
const RUNTIME_IDENTITY_PATH = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-package-runtime/runtime-identity.json",
);
const TARBALL_ROOT =
  process.env.GOODMEMORY_TEST_C6_CODEX_RUNTIME_TARBALL_ROOT?.trim();
const DOCKER_CLI =
  process.env.GOODMEMORY_TEST_C6_CODEX_RUNTIME_DOCKER_CLI?.trim();
const maybeDescribe = TARBALL_ROOT && DOCKER_CLI
  ? describe
  : describe.skip;

const EXPECTED = {
  captureSha256:
    "6c4a975bfacd686c7e3ce7b2a1a20c0ceefe05c074df0587bf1dab7db603aeab",
  dockerCliSha256:
    "f15161bac7f4149be33d96cc42c2f90d88f76abd3a5fd6f4dd792dfc509bf905",
  dockerHost: "unix:///Users/hjqcan/.docker/run/docker.sock",
  imageSha256:
    "420f9c50e115184234e0e355d8a9ffed8b49c1b8512972ec9a8a402bb259834f",
  linuxTarballSha256:
    "11239480f8e3efd1430f23bbe91c1a397856b8bbe6185ccbaee2382d25e03df2",
  mainTarballSha256:
    "416399796cac371d1a033b17f34b08ba9b25c8f298a5b9d00e10f72c3b128c8d",
  packageJsonSha256:
    "170bcc26fc9f0fbf8d34f2eb9a43c0100f3088bbb4e41704505e43ef121b923b",
  packageLockSha256:
    "fdf4dcd7dc1b7a6d578beebf95527d49ae3ffa74ed39528245984712113d8844",
  runtimeIdentitySha256:
    "37960d64a793126071fe0d89f7b0245505b7375e06ef45cf65a879f794a45792",
  version: "0.145.0",
} as const;
const HASHES = {
  assetLock:
    "48ff8576045caa5d8547fec4b2ef1be6e8e36792a614b33e7ed5dd0f4ba3edba",
  assetRoot:
    "66884e8b6152694f7ab941916dc2d33f225640fee2ff40c1de19378a15a2ff91",
  installedTree:
    "f4dd92f92e35501f547e76be3e9f916d4b701ac28d78a533c89337dcd0d4e39a",
  manifest:
    "71366e55f8f667d6adcc799abe5e6d023034bb921a68ffb05df578da0800af01",
  receipt:
    "c5301d9ae73447b9ab78ba3e4c2575dd76c831af6701244e00db5602ea9fc0df",
  run:
    "31dc6b7ca5babf01d6bcff7e012a63aaf12f1e1141b4e44dfea7ea01e997463b",
  runnerSourceSnapshot:
    "64e3719bf5694d146e606797cba0d70c727b0bb39900cbbe0a9d71aa218af284",
} as const;

setDefaultTimeout(300_000);

describe("Codex coding-effect C6 Codex Linux materialization projection", () => {
  it("freezes two byte-identical Linux x86_64 installs without promoting the receipt", async () => {
    const [receiptBytes, manifestBytes, firstBytes, secondBytes, lock] =
      await Promise.all([
        readFile(join(MATERIALIZATION_ROOT, "receipt.json")),
        readFile(join(ARTIFACTS_ROOT, "manifest.json")),
        readFile(join(ARTIFACTS_ROOT, "run-1.json")),
        readFile(join(ARTIFACTS_ROOT, "run-2.json")),
        loadC6AssetLock(ARTIFACTS_ROOT),
      ]);

    expect(sha256(receiptBytes)).toBe(HASHES.receipt);
    expect(sha256(manifestBytes)).toBe(HASHES.manifest);
    expect(sha256(firstBytes)).toBe(HASHES.run);
    expect(sha256(secondBytes)).toBe(HASHES.run);
    expect(secondBytes.equals(firstBytes)).toBe(true);
    expect(lock.assetLockSha256).toBe(HASHES.assetLock);
    expect(lock.assetLock.assetRootSha256).toBe(HASHES.assetRoot);
    expect(lock.assetLock.files).toHaveLength(7);

    const receipt = JSON.parse(receiptBytes.toString("utf8")) as {
      boundary: Record<string, unknown>;
      inputIdentity: Record<string, unknown>;
      materializedExecution: Record<string, unknown>;
    };
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
      dockerAuthority: Record<string, unknown>;
      image: Record<string, unknown>;
      inputClosure: Record<string, unknown>;
      reproducibility: Record<string, unknown>;
      runnerSourceSnapshotSha256: string;
    };
    const run = JSON.parse(firstBytes.toString("utf8")) as {
      architecture: string;
      codexVersionOutput: string;
      installedTree: Record<string, unknown>;
      operatingSystem: string;
      packageLock: Record<string, unknown>;
    };

    expect(receipt.boundary).toEqual({
      codexRunReady: false,
      persistedLinuxOfflineInstallProven: false,
      persistedReceiptValidation:
        "frozen-runner-receipt-structure-only",
    });
    expect(receipt.materializedExecution).toEqual({
      commandRunner: "system-docker",
      dockerRunCount: 2,
      liveLinuxOfflineInstallObserved: true,
    });
    expect(receipt.inputIdentity).toEqual(EXPECTED);
    expect(manifest).toMatchObject({
      dockerAuthority: {
        cliMode: 0o755,
        cliSha256: EXPECTED.dockerCliSha256,
        daemonIdentityCryptographicallyAttested: false,
        daemonTrustBoundary:
          "explicit-unix-socket-daemon-not-cryptographically-attested",
        host: EXPECTED.dockerHost,
        serverVersion: "28.4.0",
      },
      image: {
        architecture: "amd64",
        id: `sha256:${EXPECTED.imageSha256}`,
        operatingSystem: "linux",
        runtimeIdentitySha256: EXPECTED.runtimeIdentitySha256,
      },
      inputClosure: {
        captureSha256: EXPECTED.captureSha256,
        linuxTarballSha256: EXPECTED.linuxTarballSha256,
        mainTarballSha256: EXPECTED.mainTarballSha256,
        packageJsonSha256: EXPECTED.packageJsonSha256,
        packageLockSha256: EXPECTED.packageLockSha256,
        version: EXPECTED.version,
      },
      reproducibility: {
        byteIdentical: true,
        runArtifactSha256: HASHES.run,
      },
      runnerSourceSnapshotSha256: HASHES.runnerSourceSnapshot,
    });
    expect(run).toMatchObject({
      architecture: "x86_64",
      codexVersionOutput: "codex-cli 0.145.0",
      installedTree: { sha256: HASHES.installedTree },
      operatingSystem: "Linux",
      packageLock: {
        afterSha256: EXPECTED.packageLockSha256,
        beforeSha256: EXPECTED.packageLockSha256,
        unchanged: true,
      },
    });
  });
});

maybeDescribe("Codex coding-effect C6 Codex Linux materialization replay", () => {
  it("revalidates the frozen closure while retaining its non-attested boundary", async () => {
    const verified = await verifyC6CodexRuntimeLinuxMaterialization({
      dockerCliPath: requiredExternalPath(
        DOCKER_CLI,
        "GOODMEMORY_TEST_C6_CODEX_RUNTIME_DOCKER_CLI",
      ),
      expected: EXPECTED,
      expectedReceiptSha256: HASHES.receipt,
      fixtureRoot: FIXTURE_ROOT,
      outputRoot: MATERIALIZATION_ROOT,
      runtimeIdentityPath: RUNTIME_IDENTITY_PATH,
      tarballRoot: requiredExternalPath(
        TARBALL_ROOT,
        "GOODMEMORY_TEST_C6_CODEX_RUNTIME_TARBALL_ROOT",
      ),
    });
    expect(verified).toEqual({
      codexRunReady: false,
      linuxOfflineInstallProven: false,
      manifestSha256: HASHES.manifest,
      persistedReceiptValidation:
        "frozen-runner-receipt-structure-only",
      receiptSha256: HASHES.receipt,
      runArtifactSha256: HASHES.run,
      runCount: 2,
    });
  });
});

function requiredExternalPath(
  value: string | undefined,
  name: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for C6 Codex runtime replay`);
  }
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
