import { describe, expect, it } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  materializeC6ControlledMutationCanary,
} from "../../scripts/codex-coding-effect/c6-controlled-mutation-builder";

const CANARY_ROOT = resolve(
  import.meta.dir,
  "../../fixtures/codex-coding-effect/c6-controlled-mutation-canary",
);
const ASSET_LOCK_SHA256 =
  "50cf13e60d2e8930b84d1a9349ecacf7a4765df69e2abba48c0ed5e07bbfcaad";
const ASSET_ROOT_SHA256 =
  "c2ebf22628d046ce862f80206b747616a310ceb567040ddd98b8884d8e8c3f81";
const SUPPLY_SHA256 =
  "0f5442114641603c5775f964f2cee9e0502ec79c3565f5e4ab8819a8db348cee";

describe("C6 real controlled-mutation canary", () => {
  it("rebuilds the source-only defu mutations twice and rejects cosmetic inflation", async () => {
    const outputRoot = await realpath(
      await mkdtemp(join(tmpdir(), "goodmemory-c6-mutation-canary-output-")),
    );
    try {
      const evidence = await materializeC6ControlledMutationCanary({
        assetRoot: CANARY_ROOT,
        expectedAssetLockSha256: ASSET_LOCK_SHA256,
        expectedAssetRootSha256: ASSET_ROOT_SHA256,
        expectedSupplySha256: SUPPLY_SHA256,
        outputRoot,
      });

      expect(evidence).toMatchObject({
        candidateManifestFrozen: false,
        codexRunReady: false,
        evidenceScope: "real-controlled-mutation-canary-local-replay",
        executionProfile: {
          receiptAuthentication: "none",
        },
        evaluatorDependencyClosureFrozen: false,
        fullUpstreamCiExecuted: false,
        networkIsolation: "not-attested",
        source: {
          baseRepositoryId: "defu-82632b66",
          upstreamCommit: "82632b66f5914e9946edce300e10633a3d5c0cb7",
          upstreamTree: "f98fd0ecb1056fb087f117a97241a433309f087c",
        },
        supply: {
          mutationFamilyCount: 2,
          representativeCellCount: 2,
          selectedRepresentativeCount: 2,
          semanticDuplicateCount: 1,
          totalDerivationCount: 3,
        },
      });
      expect(evidence.runs).toHaveLength(2);
      expect(evidence.inputSnapshotSha256).toBe(ASSET_ROOT_SHA256);
      expect(evidence.evaluatorFactoryBundleSha256).toMatch(
        /^[a-f0-9]{64}$/u,
      );
      expect(evidence.runs[0]!.closureSha256).toBe(
        evidence.runs[1]!.closureSha256,
      );
      for (const run of evidence.runs) {
        expect(run.baseHealth.passed).toBeTrue();
        expect(run.derivations).toHaveLength(3);
        for (const derivation of run.derivations) {
          for (const stage of derivation.stages) {
            expect(stage.prepared.failToPass.evaluationBundleSha256).toMatch(
              /^[a-f0-9]{64}$/u,
            );
            expect(stage.prepared.failToPass.passed).toBeFalse();
            expect(stage.prepared.failToPass.failedCaseIds).toHaveLength(
              stage.prepared.failToPass.caseCount,
            );
            expect(stage.prepared.passToPass.passed).toBeTrue();
            expect(stage.gold.failToPass.passed).toBeTrue();
            expect(stage.gold.passToPass.passed).toBeTrue();
          }
        }
      }
      expect(evidence.projection.includedPaths).not.toContain(
        "test/defu.test.ts",
      );
      expect(evidence.projection.excludedPaths).toContain(
        "test/defu.test.ts",
      );
    } finally {
      await rm(outputRoot, { force: true, recursive: true });
    }
  }, 30_000);
});
