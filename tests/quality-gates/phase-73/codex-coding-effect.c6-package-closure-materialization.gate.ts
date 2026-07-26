import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { loadC6AssetLock } from "../../../scripts/codex-coding-effect/c6-asset-lock";
import {
  verifyC6PackageClosureMaterialization,
} from "../../../scripts/codex-coding-effect/c6-package-closure-materializer";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const PROJECTION_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-package-runtime",
  "goodmemory-0.7.0-linux-x64-materialization",
);
const RUN_ONE = process.env.GOODMEMORY_TEST_C6_PACKAGE_CLOSURE_RUN_ONE?.trim();
const RUN_TWO = process.env.GOODMEMORY_TEST_C6_PACKAGE_CLOSURE_RUN_TWO?.trim();
const maybeDescribe = RUN_ONE && RUN_TWO ? describe : describe.skip;

const EXPECTED = {
  expectedIdentitySha256:
    "770d7a80938a62c86914e863e639c20e63358fc0fc56afb99f2823f212179c30",
  linuxRebuildReceiptSha256:
    "7be421af8a9a6823e66573e57abe3927c0e012d1976f75dd2789e31c5d2796e1",
  materializationManifestSha256:
    "c5621f92ba894b56eb4af45a71c488a63e6e76dcce4eca74bad385e4bceac0c2",
  rootAssetLockSha256:
    "24a0566c365aa6f1b9f6e91584d400a90c4642a34ac04c43d710d3c213e6bc1a",
  rootAssetRootSha256:
    "021a686e433c459ecab4335063f246240d5a3a6effab5a565cc164030ad50a6e",
} as const;
const PROJECTION_HASHES = {
  "closure-asset-lock.json":
    "f41fd2288334bf8296d8296ef720f00f459be3cd2187ec269f4f37a54880ede9",
  "closure-manifest.json":
    "ff8b9add78b93136c9f32e7302ab7bd8766b1ee35919a72a1518f4f212abb5b8",
  "expected-identity.json": EXPECTED.expectedIdentitySha256,
  "installed-tree.jsonl":
    "c73a5db06353bd0dc8c0a31e2a3837e8636eca6e4d59f221df338b1acf0dc3eb",
  "linux-rebuild-receipt.json": EXPECTED.linuxRebuildReceiptSha256,
  "linux-x64-build-profile.json":
    "6feb4fcf3067a12d83c9ec95053e6838fda0105a6c56ae2287c8092e4eb90bcd",
  "materialization-manifest.json":
    EXPECTED.materializationManifestSha256,
  "offline-index.json":
    "970434b32694de778b7082398d9eaa4bd256847902239d46faa13a6732774a33",
  "package-lock.json":
    "0c43022e4434f2e16c7052ab3e392181d95cc4c72926bb284a709cbb04f06574",
  "root-asset-lock.json": EXPECTED.rootAssetLockSha256,
} as const;

setDefaultTimeout(300_000);

describe("Codex coding-effect C6 package materialization projection", () => {
  it("cross-binds the two-run receipt to every retained projection", async () => {
    const receiptBytes = await readFile(
      join(PROJECTION_ROOT, "two-run-reproducibility.json"),
    );
    expect(sha256(receiptBytes)).toBe(
      "3a066d1e841f9902bb499a60715feba3bbac6cc9feca0bf3d376e7503d6ab0cd",
    );
    const receipt = JSON.parse(receiptBytes.toString("utf8")) as {
      boundary: Record<string, unknown>;
      projection: Record<string, string>;
      result: Record<string, unknown>;
    };
    expect(receipt.boundary).toEqual({
      cryptographicExecutionReceipt: false,
      fullClosureVendored: false,
      independentReplayRequired: true,
      localOrchestratorObservedLiveRuns: true,
      persistedReceiptLinuxRebuildProven: false,
      rawExecutionWitnessIncluded: false,
      status:
        "two-live-local-runs-projection-independent-replay-required",
    });
    expect(receipt.projection).toEqual(PROJECTION_HASHES);
    expect(receipt.result).toMatchObject({
      byteIdenticalAcrossRuns: true,
      expectedIdentitySha256: EXPECTED.expectedIdentitySha256,
      fileCountPerRun: 124,
      fullClosureBytesPerRun: 57_233_374,
      linuxRebuildReceiptSha256:
        EXPECTED.linuxRebuildReceiptSha256,
      materializationManifestSha256:
        EXPECTED.materializationManifestSha256,
      rootAssetLockSha256: EXPECTED.rootAssetLockSha256,
      rootAssetRootSha256: EXPECTED.rootAssetRootSha256,
      runCount: 2,
    });
    for (const [path, expectedSha256] of Object.entries(
      PROJECTION_HASHES,
    )) {
      expect(sha256(await readFile(join(PROJECTION_ROOT, path)))).toBe(
        expectedSha256,
      );
    }
    const persistedReceipt = JSON.parse(
      await readFile(
        join(PROJECTION_ROOT, "linux-rebuild-receipt.json"),
        "utf8",
      ),
    ) as {
      linuxRebuildProven: boolean;
      persistenceBoundary: Record<string, unknown>;
    };
    expect(persistedReceipt).toMatchObject({
      linuxRebuildProven: true,
      persistenceBoundary: {
        independentReplayRequired: true,
        rawExecutionWitnessIncluded: false,
      },
    });
  });
});

maybeDescribe("Codex coding-effect C6 package materialization replay", () => {
  it("revalidates two complete byte-identical roots without promoting persisted receipts", async () => {
    const roots = [
      requiredExternalPath(
        RUN_ONE,
        "GOODMEMORY_TEST_C6_PACKAGE_CLOSURE_RUN_ONE",
      ),
      requiredExternalPath(
        RUN_TWO,
        "GOODMEMORY_TEST_C6_PACKAGE_CLOSURE_RUN_TWO",
      ),
    ];
    const rootLocks = [];
    for (const root of roots) {
      const verified = await verifyC6PackageClosureMaterialization({
        expectedLinuxRebuildReceiptSha256:
          EXPECTED.linuxRebuildReceiptSha256,
        expectedMaterializationManifestSha256:
          EXPECTED.materializationManifestSha256,
        expectedRootAssetLockSha256: EXPECTED.rootAssetLockSha256,
        expectedRootAssetRootSha256: EXPECTED.rootAssetRootSha256,
        outputRoot: root,
      });
      expect(verified).toMatchObject({
        expectedIdentitySha256: EXPECTED.expectedIdentitySha256,
        linuxRebuildProven: false,
        receiptValidation: "frozen-runner-receipt-structure-only",
      });
      const rootLock = await loadC6AssetLock(root);
      expect(rootLock.assetLock.files).toHaveLength(123);
      expect(
        rootLock.assetLock.files.reduce(
          (total, file) => total + file.bytes,
          0,
        ) + (await readFile(join(root, "asset-lock.json"))).byteLength,
      ).toBe(57_233_374);
      rootLocks.push(rootLock);
    }
    expect(rootLocks[1]).toEqual(rootLocks[0]);
  });
});

function requiredExternalPath(
  value: string | undefined,
  name: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for C6 package replay`);
  }
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
