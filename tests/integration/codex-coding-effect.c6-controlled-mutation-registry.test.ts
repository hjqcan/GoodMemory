import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildC6AssetLock,
  serializeC6AssetLock,
} from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  materializeC6ControlledMutationRegistry,
} from "../../scripts/codex-coding-effect/c6-controlled-mutation-builder";

const CANARY_ROOT = resolve(
  import.meta.dir,
  "../../fixtures/codex-coding-effect/c6-controlled-mutation-canary",
);

describe("C6 controlled-mutation multi-repository registry", () => {
  it("replays each repository twice and keeps all unreviewed supply unaccepted", async () => {
    const fixtureRoot = await realpath(
      await mkdtemp(join(tmpdir(), "goodmemory-c6-mutation-registry-input-")),
    );
    const outputRoot = await realpath(
      await mkdtemp(join(tmpdir(), "goodmemory-c6-mutation-registry-output-")),
    );
    try {
      const input = await createTwoRepositoryFixture(fixtureRoot);
      const evidence = await materializeC6ControlledMutationRegistry({
        ...input,
        outputRoot,
      });

      expect(evidence).toMatchObject({
        acceptance: {
          acceptedEpisodeCount: 0,
          acceptedEpisodeIds: [],
          independentSemanticReviewVerified: false,
        },
        candidateManifestFrozen: false,
        codexRunReady: false,
        evidenceScope:
          "multi-repository-controlled-mutation-registry-mechanical-replay",
        repositoryCount: 2,
        supply: {
          baseRepositoryCount: 2,
          candidateManifestFrozen: false,
          codexRunReady: false,
          semanticEquivalenceReviewVerified: false,
          semanticDuplicateCount: 1,
          totalDerivationCount: 4,
        },
      });
      expect(evidence.repositories.map((repository) =>
        repository.baseRepositoryId
      )).toEqual([
        "defu-82632b66",
        "second-defu-82632b66",
      ]);
      expect(evidence.runs).toHaveLength(2);
      expect(evidence.runs[0]!.closureSha256).toBe(
        evidence.runs[1]!.closureSha256,
      );
      expect(evidence.deterministicClosureSha256).toBe(
        evidence.runs[0]!.closureSha256,
      );
      for (const run of evidence.runs) {
        expect(run.repositories).toHaveLength(2);
        for (const repository of run.repositories) {
          expect(repository.baseHealth.passed).toBeTrue();
          expect(repository.derivations.every((derivation) =>
            derivation.baseRepositoryId === repository.baseRepositoryId
          )).toBeTrue();
          for (const derivation of repository.derivations) {
            for (const stage of derivation.stages) {
              expect(stage.prepared.failToPass.passed).toBeFalse();
              expect(stage.prepared.passToPass.passed).toBeTrue();
              expect(stage.gold.failToPass.passed).toBeTrue();
              expect(stage.gold.passToPass.passed).toBeTrue();
            }
          }
        }
      }
      expect(
        evidence.runs[0]!.repositories[0]!.derivations.some(
          (derivation) => derivation.decision === "semantic-duplicate",
        ),
      ).toBeTrue();
    } finally {
      await Promise.all([
        rm(fixtureRoot, { force: true, recursive: true }),
        rm(outputRoot, { force: true, recursive: true }),
      ]);
    }
  }, 30_000);
});

interface RegistryInput {
  assetRoot: string;
  expectedAssetLockSha256: string;
  expectedAssetRootSha256: string;
  expectedSupplySha256: string;
}

async function createTwoRepositoryFixture(
  root: string,
): Promise<RegistryInput> {
  await cp(CANARY_ROOT, root, { recursive: true });
  const supplyPath = join(
    root,
    "provenance/controlled-mutation/supply.json",
  );
  const supply = JSON.parse(await readFile(supplyPath, "utf8"));
  const firstBase = supply.baseRepositories[0];
  const secondBaseRepositoryId = "second-defu-82632b66";
  const projectionPath =
    "provenance/controlled-mutation/projections/second-defu-source-only.json";
  const firstProjection = JSON.parse(
    await readFile(
      join(root, firstBase.agentVisibleProjection.path),
      "utf8",
    ),
  );
  const secondProjectionBytes = `${JSON.stringify({
    ...firstProjection,
    baseRepositoryId: secondBaseRepositoryId,
  }, null, 2)}\n`;
  await writeFile(join(root, projectionPath), secondProjectionBytes);

  supply.baseRepositories.push({
    ...structuredClone(firstBase),
    agentVisibleProjection: {
      path: projectionPath,
      sha256: sha256(secondProjectionBytes),
    },
    baseRepositoryId: secondBaseRepositoryId,
    canonicalUrl: "https://example.invalid/second-defu",
    repositoryFamilyId: "repository-family-second-defu",
  });
  const secondDerivation = structuredClone(supply.derivations[0]);
  secondDerivation.baseRepositoryId = secondBaseRepositoryId;
  secondDerivation.decision = "qualified-reserve";
  secondDerivation.episodeId = "second-defu-array-order";
  secondDerivation.representativeEpisodeId = secondDerivation.episodeId;
  supply.derivations.push(secondDerivation);

  const supplyBytes = `${JSON.stringify(supply, null, 2)}\n`;
  await writeFile(supplyPath, supplyBytes);
  const assetLock = await buildC6AssetLock(root);
  const assetLockBytes = serializeC6AssetLock(assetLock);
  await writeFile(join(root, "asset-lock.json"), assetLockBytes);
  return {
    assetRoot: root,
    expectedAssetLockSha256: sha256(assetLockBytes),
    expectedAssetRootSha256: assetLock.assetRootSha256,
    expectedSupplySha256: sha256(supplyBytes),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
