import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  C6_PACKAGE_SOURCE_PROTOCOL_SHA256,
  parseC6PackageSourceRuntimeIdentity,
  readC6PackageSourceRunnerClosure,
  verifyC6PackageSourceReproducibilityReceipt,
} from "../../../scripts/codex-coding-effect/c6-package-source-reproducibility";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const LEGACY_PROJECTION_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-package-runtime",
  "goodmemory-0.7.0-source-rebuild",
);
const RUNTIME_IDENTITY_PATH = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-package-runtime/runtime-identity.json",
);
const EXTERNAL_ROOT =
  process.env.GOODMEMORY_TEST_C6_PACKAGE_SOURCE_REBUILD_ROOT?.trim() ||
  undefined;
const EXTERNAL_RECEIPT_SHA256 =
  process.env
    .GOODMEMORY_TEST_C6_PACKAGE_SOURCE_REBUILD_RECEIPT_SHA256
    ?.trim() ||
  undefined;
if (
  (EXTERNAL_ROOT === undefined) !==
    (EXTERNAL_RECEIPT_SHA256 === undefined)
) {
  throw new Error(
    "C6 package source replay requires both external root and receipt SHA-256",
  );
}
const maybeDescribe = EXTERNAL_ROOT !== undefined
  ? describe
  : describe.skip;
const RUNNER_SOURCE_PATHS = [
  "scripts/codex-coding-effect/c6-asset-lock.ts",
  "scripts/codex-coding-effect/c6-package-source-archive.ts",
  "scripts/codex-coding-effect/c6-package-source-artifact-publication.ts",
  "scripts/codex-coding-effect/c6-package-source-dependency-closure.ts",
  "scripts/codex-coding-effect/c6-package-source-docker-authority.ts",
  "scripts/codex-coding-effect/c6-package-source-receipt-verifier.ts",
  "scripts/codex-coding-effect/c6-package-source-reproducibility.ts",
  "scripts/codex-coding-effect/c6-package.ts",
  "scripts/rebuild-codex-coding-effect-c6-package-source.ts",
] as const;
const LEGACY = {
  projectionSha256:
    "16360426083d7ee2d79cb89ee90880edc4276e24e5c5c35ce09b1c2bcfaa14bc",
  receiptSha256:
    "230948d69f433600e31e239944d19b76bde1282d6ddd390212f0d298aed57e16",
  runnerSourceRootSha256:
    "e18b9b7ce6c7929deb20c5aa3ca394d3a779f23bfb69055b21907f2bd3d2f84f",
} as const;
const EXPECTED = {
  commitSha: "5d6dab3bf8b406455068c01863c5cbd51cf65756",
  containerUser: "501:20",
  dependencyClosure: {
    assetLockSha256:
      "69529d6d911b28f9ce4b85b001fb568eaa4eec0521298c8d74c141db205d2840",
    assetRootSha256:
      "b3d7578afb15853626a11069f11ff22e8a3b836bf4097f460cf67f9b28f5f3e9",
    cacheArchiveSha256:
      "c75e3b005846d33ee95f0efde5d3d088beffca0dbffe9dd3678735de41980d17",
    cacheContentRootSha256:
      "baf131784dfb3cb9e9d086bf55f8068e463b0b00aa087a3b758057389fa66a80",
    cacheManifestSha256:
      "9e73f357b9e2ef1e618bb1edce42ab2edd9685699a492b19514b331b19f8dd8c",
  },
  dockerAuthority: {
    cliMode: 0o755,
    cliPath: "/Applications/Docker.app/Contents/Resources/bin/docker",
    cliSha256:
      "f15161bac7f4149be33d96cc42c2f90d88f76abd3a5fd6f4dd792dfc509bf905",
    socketPath: "/Users/hjqcan/.docker/run/docker.sock",
  },
  imageSha256:
    "420f9c50e115184234e0e355d8a9ffed8b49c1b8512972ec9a8a402bb259834f",
  packageSha256:
    "5f9b98600ff024a80a7a337fa8953e162b7498bf909a67e8b217a9bba5dd2757",
  runnerProtocolSha256:
    "94e43195e193f1c591287202ebfb643355496835b7703d32d5b76469b29f3389",
  runnerSourceRootSha256:
    "5a05bff089c75a3f726c3a0c371e052a25896b13bdcccb9b96b0d2ce5b05b241",
  runtimeIdentitySha256:
    "37960d64a793126071fe0d89f7b0245505b7375e06ef45cf65a879f794a45792",
  treeSha: "8563c9136864430772e024925811be55402f3372",
} as const;

setDefaultTimeout(300_000);

describe("Codex coding-effect C6 package source gate boundary", () => {
  it("rejects the legacy v2 projection and pins the exact current runner closure", async () => {
    const runnerSource = await readC6PackageSourceRunnerClosure();
    expect(runnerSource.files.map((file) => file.path)).toEqual([
      ...RUNNER_SOURCE_PATHS,
    ]);
    expect(runnerSource.files).toHaveLength(9);
    expect(runnerSource.rootSha256).toBe(
      EXPECTED.runnerSourceRootSha256,
    );
    expect(C6_PACKAGE_SOURCE_PROTOCOL_SHA256).toBe(
      EXPECTED.runnerProtocolSha256,
    );

    const projectionBytes = await readFile(
      join(LEGACY_PROJECTION_ROOT, "projection.json"),
    );
    expect(sha256(projectionBytes)).toBe(LEGACY.projectionSha256);
    const projection = JSON.parse(projectionBytes.toString("utf8")) as {
      boundary: Record<string, unknown>;
      result: Record<string, unknown>;
      schemaVersion: number;
    };
    expect(projection).toMatchObject({
      boundary: {
        c6PackageOfflineClosureProven: false,
        externalIndependentAttestation: false,
        fullArtifactClosureVendored: false,
        networkDisabled: false,
        sourceBuildReproducible: false,
        status:
          "networked-source-build-diagnostic-independent-replay-required",
      },
      result: {
        runnerSourceRootSha256: LEGACY.runnerSourceRootSha256,
      },
      schemaVersion: 1,
    });

    const receiptPath = join(LEGACY_PROJECTION_ROOT, "receipt.json");
    const receiptBytes = await readFile(receiptPath);
    expect(sha256(receiptBytes)).toBe(LEGACY.receiptSha256);
    const receipt = JSON.parse(receiptBytes.toString("utf8")) as {
      evidenceScope: string;
      executor: { networkMode: string };
      networkDisabled: boolean;
      runnerSource: {
        files: Array<{ path: string }>;
        rootSha256: string;
      };
      schemaVersion: number;
    };
    expect(receipt).toMatchObject({
      evidenceScope: "source-build-only",
      executor: {
        networkMode: "bridge",
      },
      networkDisabled: false,
      runnerSource: {
        rootSha256: LEGACY.runnerSourceRootSha256,
      },
      schemaVersion: 2,
    });
    expect(receipt.runnerSource.files).toHaveLength(4);

    const runtime = parseC6PackageSourceRuntimeIdentity(
      JSON.parse(await readFile(RUNTIME_IDENTITY_PATH, "utf8")) as unknown,
    );
    await expect(verifyC6PackageSourceReproducibilityReceipt({
      expected: {
        commitSha: EXPECTED.commitSha,
        containerUser: EXPECTED.containerUser,
        dependencyClosure: EXPECTED.dependencyClosure,
        dockerAuthority: EXPECTED.dockerAuthority,
        imageSha256: EXPECTED.imageSha256,
        packageSha256: EXPECTED.packageSha256,
        runtime,
        runtimeIdentitySha256: EXPECTED.runtimeIdentitySha256,
        treeSha: EXPECTED.treeSha,
      },
      expectedReceiptSha256: LEGACY.receiptSha256,
      path: receiptPath,
    })).rejects.toThrow("schemaVersion");
  });
});

maybeDescribe("Codex coding-effect C6 package source replay", () => {
  it("revalidates an explicitly pinned v3 external closure without promoting persisted claims", async () => {
    const runtime = parseC6PackageSourceRuntimeIdentity(
      JSON.parse(await readFile(RUNTIME_IDENTITY_PATH, "utf8")) as unknown,
    );
    const externalRoot = requiredExternalValue(
      EXTERNAL_ROOT,
      "GOODMEMORY_TEST_C6_PACKAGE_SOURCE_REBUILD_ROOT",
    );
    const expectedReceiptSha256 = requiredExternalValue(
      EXTERNAL_RECEIPT_SHA256,
      "GOODMEMORY_TEST_C6_PACKAGE_SOURCE_REBUILD_RECEIPT_SHA256",
    );
    const receiptPath = join(externalRoot, "receipt.json");
    const receiptBytes = await readFile(receiptPath);
    expect(sha256(receiptBytes)).toBe(expectedReceiptSha256);
    const receipt = JSON.parse(receiptBytes.toString("utf8")) as {
      runnerProtocolSha256: string;
      runnerSource: {
        files: Array<{ path: string }>;
        rootSha256: string;
      };
      schemaVersion: number;
    };
    expect(receipt).toMatchObject({
      runnerProtocolSha256: EXPECTED.runnerProtocolSha256,
      runnerSource: {
        rootSha256: EXPECTED.runnerSourceRootSha256,
      },
      schemaVersion: 3,
    });
    expect(receipt.runnerSource.files.map((file) => file.path)).toEqual([
      ...RUNNER_SOURCE_PATHS,
    ]);

    const verified = await verifyC6PackageSourceReproducibilityReceipt({
      expected: {
        commitSha: EXPECTED.commitSha,
        containerUser: EXPECTED.containerUser,
        dependencyClosure: EXPECTED.dependencyClosure,
        dockerAuthority: EXPECTED.dockerAuthority,
        imageSha256: EXPECTED.imageSha256,
        packageSha256: EXPECTED.packageSha256,
        runtime,
        runtimeIdentitySha256: EXPECTED.runtimeIdentitySha256,
        treeSha: EXPECTED.treeSha,
      },
      expectedReceiptSha256,
      path: receiptPath,
    });
    expect(verified).toEqual({
      artifactClosureVerified: true,
      c6PackageOfflineClosureProven: false,
      executionAuthenticated: false,
      externalIndependentAttestation: false,
      locallyExecutedLinuxBuild: false,
      rawExecutionWitnessIncluded: false,
      receiptSha256: expectedReceiptSha256,
      receiptValidation: "persisted-artifact-closure",
      recordedEvidenceScope: "local-offline-source-build-observation",
      recordedExecutorAuthority: "native-docker-cli",
      recordedLiveOfflineBuildCount: 2,
      recordedLocallyExecutedLinuxBuild: true,
      recordedNetworkDisabled: true,
      recordedOfflineDependencyClosureUsed: true,
      recordedRunnerObservedSameHostOfflineRebuild: true,
      recordedSourceBuildReproducible: false,
      runnerObservedSameHostOfflineRebuild: false,
      sourceBuildReproducible: false,
    });
  });
});

function requiredExternalValue(
  value: string | undefined,
  name: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for C6 package source replay`);
  }
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
