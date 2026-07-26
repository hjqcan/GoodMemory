import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import { z } from "zod";

import {
  loadC6AssetLock,
  readC6StableRegularFile,
  verifyC6AssetClosure,
} from "./c6-asset-lock";
import {
  loadC6ControlledMutationSupplyBundle,
} from "./c6-controlled-mutation-supply";
import type {
  C6ControlledMutationSupply,
  C6ControlledMutationSupplyEvidence,
  C6ControlledMutationSupplyInput,
} from "./c6-controlled-mutation-supply";
import type {
  C6HiddenModuleCaseResult,
} from "./c6-hidden-evaluator-factory";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const revisionSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
const identifierSchema = z.string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const relativePathSchema = z.string().min(1).refine(
  (value) =>
    !isAbsolute(value) &&
    !value.includes("\\") &&
    value.split("/").every((part) =>
      part.length > 0 && part !== "." && part !== ".."
    ),
  "path must be a normalized relative POSIX path",
);
const projectionSchema = z.object({
  baseRepositoryId: identifierSchema,
  excludedPaths: z.array(relativePathSchema),
  includedPaths: z.array(relativePathSchema).min(1),
  policy: z.literal("source-only-no-upstream-tests-v1"),
  schemaVersion: z.literal(1),
  upstreamCommit: revisionSchema,
  upstreamTree: revisionSchema,
}).strict().superRefine((projection, context) => {
  for (const [field, paths] of [
    ["excludedPaths", projection.excludedPaths],
    ["includedPaths", projection.includedPaths],
  ] as const) {
    if (
      new Set(paths).size !== paths.length ||
      JSON.stringify(paths) !== JSON.stringify([...paths].sort())
    ) {
      context.addIssue({
        code: "custom",
        message: `${field} must be unique and sorted`,
        path: [field],
      });
    }
  }
});

export interface C6ControlledMutationCanaryInput
  extends C6ControlledMutationSupplyInput {
  outputRoot: string;
}

export interface C6ControlledMutationRegistryInput
  extends C6ControlledMutationSupplyInput {
  outputRoot: string;
}

export interface C6ControlledMutationCanaryStageEvidence {
  gold: {
    failToPass: C6HiddenModuleCaseResult;
    passToPass: C6HiddenModuleCaseResult;
    treeSha256: string;
  };
  prepared: {
    failToPass: C6HiddenModuleCaseResult;
    passToPass: C6HiddenModuleCaseResult;
    treeSha256: string;
  };
  stageId: string;
}

export interface C6ControlledMutationCanaryEvidence {
  candidateManifestFrozen: false;
  codexRunReady: false;
  evidenceScope: "real-controlled-mutation-canary-local-replay";
  executionProfile: {
    architecture: string;
    bunVersion: string;
    gitVersion: string;
    operatingSystem: string;
    receiptAuthentication: "none";
  };
  evaluatorDependencyClosureFrozen: false;
  evaluatorFactoryBundleSha256: string;
  fullUpstreamCiExecuted: false;
  inputSnapshotSha256: string;
  networkIsolation: "not-attested";
  projection: {
    baseTreeSha256: string;
    excludedPaths: string[];
    includedPaths: string[];
    policy: "source-only-no-upstream-tests-v1";
    projectionSha256: string;
  };
  runs: Array<{
    baseHealth: C6HiddenModuleCaseResult;
    closureSha256: string;
    derivations: Array<{
      decision: "qualified-reserve" | "selected" | "semantic-duplicate";
      episodeId: string;
      mutationFamilyId: string;
      representativeEpisodeId: string;
      stages: C6ControlledMutationCanaryStageEvidence[];
      variantId: string;
    }>;
    run: number;
  }>;
  schemaVersion: 1;
  source: {
    baseRepositoryId: string;
    sourceBundleSha256: string;
    upstreamCommit: string;
    upstreamTree: string;
  };
  supply: C6ControlledMutationSupplyEvidence;
}

export interface C6ControlledMutationRegistryEvidence {
  acceptance: {
    acceptedEpisodeCount: 0;
    acceptedEpisodeIds: [];
    independentSemanticReviewVerified: false;
    policy:
      "mechanical-replay-does-not-accept-unreviewed-or-semantic-duplicate-episodes";
  };
  candidateManifestFrozen: false;
  codexRunReady: false;
  deterministicClosureSha256: string;
  evidenceScope:
    "multi-repository-controlled-mutation-registry-mechanical-replay";
  executionProfile: C6ControlledMutationCanaryEvidence["executionProfile"];
  evaluatorDependencyClosureFrozen: false;
  evaluatorFactoryBundleSha256: string;
  fullUpstreamCiExecuted: false;
  inputSnapshotSha256: string;
  networkIsolation: "not-attested";
  repositories: Array<{
    baseRepositoryId: string;
    projection: C6ControlledMutationCanaryEvidence["projection"];
    source: C6ControlledMutationCanaryEvidence["source"];
  }>;
  repositoryCount: number;
  runs: Array<{
    closureSha256: string;
    repositories: C6ControlledMutationRegistryRepositoryRunEvidence[];
    run: number;
  }>;
  schemaVersion: 1;
  supply: C6ControlledMutationSupplyEvidence;
}

export interface C6ControlledMutationRegistryRepositoryRunEvidence {
  baseHealth: C6HiddenModuleCaseResult;
  baseRepositoryId: string;
  closureSha256: string;
  derivations: Array<
    C6ControlledMutationCanaryEvidence["runs"][number]["derivations"][number] & {
      baseRepositoryId: string;
    }
  >;
}

export async function materializeC6ControlledMutationCanary(
  input: C6ControlledMutationCanaryInput,
): Promise<C6ControlledMutationCanaryEvidence> {
  const assetRoot = await realpath(input.assetRoot);
  const outputRoot = await realpath(input.outputRoot);
  if (
    isWithin(assetRoot, outputRoot) ||
    isWithin(outputRoot, assetRoot)
  ) {
    throw new Error(
      "C6 controlled-mutation output and asset roots must be disjoint",
    );
  }
  if ((await readdir(outputRoot)).length > 0) {
    throw new Error("C6 controlled-mutation output root must start empty");
  }

  const loaded = await loadC6ControlledMutationSupplyBundle({
    assetRoot,
    expectedAssetLockSha256: input.expectedAssetLockSha256,
    expectedAssetRootSha256: input.expectedAssetRootSha256,
    expectedSupplySha256: input.expectedSupplySha256,
  });
  const inputSnapshotRoot = join(outputRoot, "input-snapshot");
  const inputSnapshotSha256 = await snapshotAssetInputs(
    assetRoot,
    inputSnapshotRoot,
    input,
  );
  if (loaded.supply.baseRepositories.length !== 1) {
    throw new Error(
      "C6 controlled-mutation canary requires exactly one base repository",
    );
  }
  const base = loaded.supply.baseRepositories[0]!;
  const projection = await loadProjection(
    inputSnapshotRoot,
    base.agentVisibleProjection.path,
    base.agentVisibleProjection.sha256,
  );
  validateProjectionIdentity(
    base,
    projection,
    loaded.supply.mutationFamilies,
  );
  const evaluatorFactory = await loadFrozenEvaluatorFactory(
    inputSnapshotRoot,
    loaded.supply.mutationFamilies,
  );

  const runs = [];
  for (let run = 1; run <= 2; run += 1) {
    const runRoot = join(outputRoot, `run-${run}`);
    await mkdir(runRoot, { recursive: false });
    runs.push(await materializeRun({
      base,
      derivations: loaded.supply.derivations,
      evaluateHiddenModuleCases: evaluatorFactory.evaluate,
      families: loaded.supply.mutationFamilies,
      inputSnapshotRoot,
      projection,
      run,
      runRoot,
    }));
  }
  if (runs[0]!.closureSha256 !== runs[1]!.closureSha256) {
    throw new Error(
      "C6 controlled-mutation canary two materializations are not byte-identical",
    );
  }

  const baseTreeSha256 = await hashFileTree(
    join(outputRoot, "run-1", "base"),
  ).then((tree) => tree.rootSha256);
  const evidence: C6ControlledMutationCanaryEvidence = {
    candidateManifestFrozen: false,
    codexRunReady: false,
    evidenceScope: "real-controlled-mutation-canary-local-replay",
    executionProfile: {
      architecture: process.arch,
      bunVersion: Bun.version,
      gitVersion: (await runGit(["--version"])).trim(),
      operatingSystem: process.platform,
      receiptAuthentication: "none",
    },
    evaluatorDependencyClosureFrozen: false,
    evaluatorFactoryBundleSha256: evaluatorFactory.bundleSha256,
    fullUpstreamCiExecuted: false,
    inputSnapshotSha256,
    networkIsolation: "not-attested",
    projection: {
      baseTreeSha256,
      excludedPaths: projection.excludedPaths,
      includedPaths: projection.includedPaths,
      policy: projection.policy,
      projectionSha256: base.agentVisibleProjection.sha256,
    },
    runs,
    schemaVersion: 1,
    source: {
      baseRepositoryId: base.baseRepositoryId,
      sourceBundleSha256: base.sourceBundle.sha256,
      upstreamCommit: base.upstreamCommit,
      upstreamTree: base.upstreamTree,
    },
    supply: loaded.evidence,
  };
  const terminalInputSnapshot = await hashFileTree(inputSnapshotRoot);
  if (terminalInputSnapshot.rootSha256 !== inputSnapshotSha256) {
    throw new Error(
      "C6 controlled-mutation input snapshot changed during materialization",
    );
  }
  await assertAssetPinsUnchanged(assetRoot, input);
  await writeFile(
    join(outputRoot, "receipt.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { flag: "wx" },
  );
  return evidence;
}

export async function materializeC6ControlledMutationRegistry(
  input: C6ControlledMutationRegistryInput,
): Promise<C6ControlledMutationRegistryEvidence> {
  const assetRoot = await realpath(input.assetRoot);
  const outputRoot = await realpath(input.outputRoot);
  if (
    isWithin(assetRoot, outputRoot) ||
    isWithin(outputRoot, assetRoot)
  ) {
    throw new Error(
      "C6 controlled-mutation output and asset roots must be disjoint",
    );
  }
  if ((await readdir(outputRoot)).length > 0) {
    throw new Error("C6 controlled-mutation output root must start empty");
  }

  const loaded = await loadC6ControlledMutationSupplyBundle({
    assetRoot,
    expectedAssetLockSha256: input.expectedAssetLockSha256,
    expectedAssetRootSha256: input.expectedAssetRootSha256,
    expectedSupplySha256: input.expectedSupplySha256,
  });
  const inputSnapshotRoot = join(outputRoot, "input-snapshot");
  const inputSnapshotSha256 = await snapshotAssetInputs(
    assetRoot,
    inputSnapshotRoot,
    input,
  );
  const evaluatorFactory = await loadFrozenEvaluatorFactory(
    inputSnapshotRoot,
    loaded.supply.mutationFamilies,
  );
  const bases = [...loaded.supply.baseRepositories].sort(
    (left, right) =>
      left.baseRepositoryId.localeCompare(right.baseRepositoryId),
  );
  const preparedRepositories = [];
  for (const base of bases) {
    const derivations = loaded.supply.derivations
      .filter((derivation) =>
        derivation.baseRepositoryId === base.baseRepositoryId
      )
      .sort((left, right) => left.episodeId.localeCompare(right.episodeId));
    const familyIds = new Set(
      derivations.map((derivation) => derivation.mutationFamilyId),
    );
    const families = loaded.supply.mutationFamilies
      .filter((family) => familyIds.has(family.mutationFamilyId))
      .sort((left, right) =>
        left.mutationFamilyId.localeCompare(right.mutationFamilyId)
      );
    const projection = await loadProjection(
      inputSnapshotRoot,
      base.agentVisibleProjection.path,
      base.agentVisibleProjection.sha256,
    );
    validateProjectionIdentity(base, projection, families);
    preparedRepositories.push({
      base,
      derivations,
      families,
      projection,
    });
  }

  const runs: C6ControlledMutationRegistryEvidence["runs"] = [];
  for (let run = 1; run <= 2; run += 1) {
    const runRoot = join(outputRoot, `run-${run}`);
    await mkdir(runRoot, { recursive: false });
    const repositories: C6ControlledMutationRegistryRepositoryRunEvidence[] =
      [];
    for (const preparedRepository of preparedRepositories) {
      const repositoryRunRoot = join(
        runRoot,
        "repositories",
        preparedRepository.base.baseRepositoryId,
      );
      await mkdir(repositoryRunRoot, { recursive: true });
      const repositoryRun = await materializeRun({
        base: preparedRepository.base,
        derivations: preparedRepository.derivations,
        evaluateHiddenModuleCases: evaluatorFactory.evaluate,
        families: preparedRepository.families,
        inputSnapshotRoot,
        projection: preparedRepository.projection,
        run,
        runRoot: repositoryRunRoot,
      });
      repositories.push({
        baseHealth: repositoryRun.baseHealth,
        baseRepositoryId: preparedRepository.base.baseRepositoryId,
        closureSha256: repositoryRun.closureSha256,
        derivations: repositoryRun.derivations.map((derivation) => ({
          ...derivation,
          baseRepositoryId: preparedRepository.base.baseRepositoryId,
        })),
      });
    }
    const closureSha256 = sha256(JSON.stringify({
      inputSnapshotSha256,
      repositories: repositories.map((repository) => ({
        baseRepositoryId: repository.baseRepositoryId,
        closureSha256: repository.closureSha256,
      })),
    }));
    runs.push({
      closureSha256,
      repositories,
      run,
    });
  }
  if (runs[0]!.closureSha256 !== runs[1]!.closureSha256) {
    throw new Error(
      "C6 controlled-mutation registry two materializations are not byte-identical",
    );
  }
  for (const [index, firstRepository] of
    runs[0]!.repositories.entries()) {
    const secondRepository = runs[1]!.repositories[index]!;
    if (
      firstRepository.baseRepositoryId !== secondRepository.baseRepositoryId ||
      firstRepository.closureSha256 !== secondRepository.closureSha256
    ) {
      throw new Error(
        `C6 controlled-mutation repository replay changed for ${firstRepository.baseRepositoryId}`,
      );
    }
  }

  const repositories = [];
  for (const preparedRepository of preparedRepositories) {
    const baseTreeSha256 = await hashFileTree(join(
      outputRoot,
      "run-1",
      "repositories",
      preparedRepository.base.baseRepositoryId,
      "base",
    )).then((tree) => tree.rootSha256);
    repositories.push({
      baseRepositoryId: preparedRepository.base.baseRepositoryId,
      projection: {
        baseTreeSha256,
        excludedPaths: preparedRepository.projection.excludedPaths,
        includedPaths: preparedRepository.projection.includedPaths,
        policy: preparedRepository.projection.policy,
        projectionSha256:
          preparedRepository.base.agentVisibleProjection.sha256,
      },
      source: {
        baseRepositoryId: preparedRepository.base.baseRepositoryId,
        sourceBundleSha256: preparedRepository.base.sourceBundle.sha256,
        upstreamCommit: preparedRepository.base.upstreamCommit,
        upstreamTree: preparedRepository.base.upstreamTree,
      },
    });
  }
  const evidence: C6ControlledMutationRegistryEvidence = {
    acceptance: {
      acceptedEpisodeCount: 0,
      acceptedEpisodeIds: [],
      independentSemanticReviewVerified: false,
      policy:
        "mechanical-replay-does-not-accept-unreviewed-or-semantic-duplicate-episodes",
    },
    candidateManifestFrozen: false,
    codexRunReady: false,
    deterministicClosureSha256: runs[0]!.closureSha256,
    evidenceScope:
      "multi-repository-controlled-mutation-registry-mechanical-replay",
    executionProfile: {
      architecture: process.arch,
      bunVersion: Bun.version,
      gitVersion: (await runGit(["--version"])).trim(),
      operatingSystem: process.platform,
      receiptAuthentication: "none",
    },
    evaluatorDependencyClosureFrozen: false,
    evaluatorFactoryBundleSha256: evaluatorFactory.bundleSha256,
    fullUpstreamCiExecuted: false,
    inputSnapshotSha256,
    networkIsolation: "not-attested",
    repositories,
    repositoryCount: repositories.length,
    runs,
    schemaVersion: 1,
    supply: loaded.evidence,
  };
  const terminalInputSnapshot = await hashFileTree(inputSnapshotRoot);
  if (terminalInputSnapshot.rootSha256 !== inputSnapshotSha256) {
    throw new Error(
      "C6 controlled-mutation input snapshot changed during materialization",
    );
  }
  await assertAssetPinsUnchanged(assetRoot, input);
  await writeFile(
    join(outputRoot, "receipt.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { flag: "wx" },
  );
  return evidence;
}

interface DeriveTreeInput {
  assetRoot: string;
  baseRepositoryId: string;
  mutationPatchPath: string;
  goldPatchPath: string;
  projectionPath: string;
  sourceBundlePath: string;
  upstreamCommit: string;
  upstreamTree: string;
  workRoot: string;
}

export async function deriveC6ControlledMutationCanaryTreeHashes(
  input: DeriveTreeInput,
): Promise<{
  baseTreeSha256: string;
  goldTreeSha256: string;
  preparedTreeSha256: string;
}> {
  const workRoot = await realpath(input.workRoot);
  if ((await readdir(workRoot)).length > 0) {
    throw new Error("C6 controlled-mutation derivation work root must be empty");
  }
  const projectionBytes = await readFile(
    resolve(input.assetRoot, input.projectionPath),
    "utf8",
  );
  const projection = parseCanonicalProjection(projectionBytes);
  if (
    projection.baseRepositoryId !== input.baseRepositoryId ||
    projection.upstreamCommit !== input.upstreamCommit ||
    projection.upstreamTree !== input.upstreamTree
  ) {
    throw new Error(
      "C6 controlled-mutation derivation projection identity does not match",
    );
  }
  const sourceRoot = join(workRoot, "upstream");
  await cloneSourceBundle({
    commit: input.upstreamCommit,
    destination: sourceRoot,
    sourceBundlePath: resolve(input.assetRoot, input.sourceBundlePath),
    tree: input.upstreamTree,
  });
  validateTrackedProjection(await listTrackedFiles(sourceRoot), projection);

  const baseRoot = join(workRoot, "base");
  const preparedRoot = join(workRoot, "prepared");
  const goldRoot = join(workRoot, "gold");
  await Promise.all([
    materializeProjection(sourceRoot, baseRoot, projection.includedPaths),
    materializeProjection(sourceRoot, preparedRoot, projection.includedPaths),
    materializeProjection(sourceRoot, goldRoot, projection.includedPaths),
  ]);
  await applyPatch(
    preparedRoot,
    resolve(input.assetRoot, input.mutationPatchPath),
  );
  await applyPatch(
    goldRoot,
    resolve(input.assetRoot, input.mutationPatchPath),
  );
  await applyPatch(
    goldRoot,
    resolve(input.assetRoot, input.goldPatchPath),
  );
  const [baseTree, preparedTree, goldTree] = await Promise.all([
    hashFileTree(baseRoot),
    hashFileTree(preparedRoot),
    hashFileTree(goldRoot),
  ]);
  return {
    baseTreeSha256: baseTree.rootSha256,
    goldTreeSha256: goldTree.rootSha256,
    preparedTreeSha256: preparedTree.rootSha256,
  };
}

type Projection = z.infer<typeof projectionSchema>;
type BaseRepository =
  C6ControlledMutationSupply["baseRepositories"][number];
type MutationFamily =
  C6ControlledMutationSupply["mutationFamilies"][number];
type EvaluateHiddenModuleCases = (input: {
  evaluatorSpecPath: string;
  repositoryRoot: string;
}) => Promise<C6HiddenModuleCaseResult>;

async function materializeRun(input: {
  base: BaseRepository;
  derivations: readonly C6ControlledMutationSupply["derivations"][number][];
  evaluateHiddenModuleCases: EvaluateHiddenModuleCases;
  families: readonly MutationFamily[];
  inputSnapshotRoot: string;
  projection: Projection;
  run: number;
  runRoot: string;
}): Promise<C6ControlledMutationCanaryEvidence["runs"][number]> {
  const sourceRoot = join(input.runRoot, "upstream");
  await cloneSourceBundle({
    commit: input.base.upstreamCommit,
    destination: sourceRoot,
    sourceBundlePath: resolve(
      input.inputSnapshotRoot,
      input.base.sourceBundle.path,
    ),
    tree: input.base.upstreamTree,
  });
  validateTrackedProjection(
    await listTrackedFiles(sourceRoot),
    input.projection,
  );

  const baseRoot = join(input.runRoot, "base");
  await materializeProjection(
    sourceRoot,
    baseRoot,
    input.projection.includedPaths,
  );
  const baseTree = await hashFileTree(baseRoot);
  const baseHealth = await input.evaluateHiddenModuleCases({
    evaluatorSpecPath: resolve(
      input.inputSnapshotRoot,
      input.base.baseHealth.spec.path,
    ),
    repositoryRoot: baseRoot,
  });
  if (
    !baseHealth.passed ||
    baseHealth.evaluatorSpecSha256 !== input.base.baseHealth.spec.sha256
  ) {
    throw new Error(
      `C6 controlled-mutation base-health probe failed on run ${input.run}`,
    );
  }

  const familyById = new Map(
    input.families.map((family) => [
      family.mutationFamilyId,
      family,
    ]),
  );
  const derivations = [];
  for (const derivation of input.derivations) {
    const family = familyById.get(derivation.mutationFamilyId)!;
    const stages = [];
    for (const stage of derivation.stages) {
      const stageRoot = join(
        input.runRoot,
        "derivations",
        derivation.episodeId,
        stage.stageId,
      );
      const preparedRoot = join(stageRoot, "prepared");
      const goldRoot = join(stageRoot, "gold");
      await Promise.all([
        materializeProjection(
          sourceRoot,
          preparedRoot,
          input.projection.includedPaths,
        ),
        materializeProjection(
          sourceRoot,
          goldRoot,
          input.projection.includedPaths,
        ),
      ]);
      await applyPatch(
        preparedRoot,
        resolve(input.inputSnapshotRoot, stage.mutationPatch.path),
      );
      await applyPatch(
        goldRoot,
        resolve(input.inputSnapshotRoot, stage.mutationPatch.path),
      );
      await applyPatch(
        goldRoot,
        resolve(input.inputSnapshotRoot, stage.goldPatch.path),
      );
      const [preparedTree, goldTree] = await Promise.all([
        hashFileTree(preparedRoot),
        hashFileTree(goldRoot),
      ]);
      if (
        preparedTree.rootSha256 !== stage.preparedTreeSha256 ||
        goldTree.rootSha256 !== stage.goldTreeSha256
      ) {
        throw new Error(
          `C6 controlled-mutation frozen tree mismatch for ${derivation.episodeId}/${stage.stageId}: prepared=${preparedTree.rootSha256} gold=${goldTree.rootSha256}`,
        );
      }
      assertChangedSurface(
        baseTree,
        preparedTree,
        family.semanticContract.changedSurface,
        derivation.episodeId,
      );
      if (goldTree.rootSha256 !== baseTree.rootSha256) {
        throw new Error(
          `C6 controlled-mutation gold patch does not restore base tree for ${derivation.episodeId}/${stage.stageId}`,
        );
      }
      const failToPassSpecPath = resolve(
        input.inputSnapshotRoot,
        stage.evaluators.failToPass.path,
      );
      const passToPassSpecPath = resolve(
        input.inputSnapshotRoot,
        stage.evaluators.passToPass.path,
      );
      const [
        preparedFailToPass,
        preparedPassToPass,
        goldFailToPass,
        goldPassToPass,
      ] = await Promise.all([
        input.evaluateHiddenModuleCases({
          evaluatorSpecPath: failToPassSpecPath,
          repositoryRoot: preparedRoot,
        }),
        input.evaluateHiddenModuleCases({
          evaluatorSpecPath: passToPassSpecPath,
          repositoryRoot: preparedRoot,
        }),
        input.evaluateHiddenModuleCases({
          evaluatorSpecPath: failToPassSpecPath,
          repositoryRoot: goldRoot,
        }),
        input.evaluateHiddenModuleCases({
          evaluatorSpecPath: passToPassSpecPath,
          repositoryRoot: goldRoot,
        }),
      ]);
      if (
        preparedFailToPass.passed ||
        preparedFailToPass.failedCaseIds.length !==
          preparedFailToPass.caseCount ||
        !preparedPassToPass.passed ||
        !goldFailToPass.passed ||
        !goldPassToPass.passed
      ) {
        throw new Error(
          `C6 controlled-mutation evaluator contract failed for ${derivation.episodeId}/${stage.stageId}`,
        );
      }
      if (
        preparedFailToPass.evaluatorSpecSha256 !==
          stage.evaluators.failToPass.sha256 ||
        goldFailToPass.evaluatorSpecSha256 !==
          stage.evaluators.failToPass.sha256 ||
        preparedPassToPass.evaluatorSpecSha256 !==
          stage.evaluators.passToPass.sha256 ||
        goldPassToPass.evaluatorSpecSha256 !==
          stage.evaluators.passToPass.sha256
      ) {
        throw new Error(
          `C6 controlled-mutation evaluator hash drifted for ${derivation.episodeId}/${stage.stageId}`,
        );
      }
      stages.push({
        gold: {
          failToPass: goldFailToPass,
          passToPass: goldPassToPass,
          treeSha256: goldTree.rootSha256,
        },
        prepared: {
          failToPass: preparedFailToPass,
          passToPass: preparedPassToPass,
          treeSha256: preparedTree.rootSha256,
        },
        stageId: stage.stageId,
      });
    }
    derivations.push({
      decision: derivation.decision,
      episodeId: derivation.episodeId,
      mutationFamilyId: derivation.mutationFamilyId,
      representativeEpisodeId: derivation.representativeEpisodeId,
      stages,
      variantId: derivation.variantId,
    });
  }
  const closurePayload = { baseHealth, derivations };
  return {
    baseHealth,
    closureSha256: sha256(JSON.stringify(closurePayload)),
    derivations,
    run: input.run,
  };
}

async function snapshotAssetInputs(
  assetRoot: string,
  snapshotRoot: string,
  input: C6ControlledMutationSupplyInput,
): Promise<string> {
  const loaded = await loadC6AssetLock(assetRoot);
  if (
    loaded.assetLockSha256 !== input.expectedAssetLockSha256 ||
    loaded.assetLock.assetRootSha256 !== input.expectedAssetRootSha256
  ) {
    throw new Error(
      "C6 controlled-mutation input snapshot does not match external pins",
    );
  }
  await mkdir(snapshotRoot);
  for (const file of loaded.assetLock.files) {
    const bytes = await readC6StableRegularFile(
      resolve(assetRoot, file.path),
      `controlled-mutation input snapshot ${file.path}`,
    );
    if (
      bytes.byteLength !== file.bytes ||
      sha256(bytes) !== file.sha256
    ) {
      throw new Error(
        `C6 controlled-mutation input changed while snapshotting ${file.path}`,
      );
    }
    const destination = resolve(snapshotRoot, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, {
      flag: "wx",
      mode: file.mode,
    });
    await chmod(destination, file.mode);
  }
  await verifyC6AssetClosure(assetRoot, loaded);
  const snapshot = await hashFileTree(snapshotRoot);
  if (snapshot.rootSha256 !== loaded.assetLock.assetRootSha256) {
    throw new Error(
      "C6 controlled-mutation input snapshot does not reproduce the asset root",
    );
  }
  return snapshot.rootSha256;
}

async function loadProjection(
  assetRoot: string,
  path: string,
  expectedSha256: string,
): Promise<Projection> {
  const bytes = await readC6StableRegularFile(
    resolve(assetRoot, path),
    "controlled-mutation agent-visible projection",
  );
  if (sha256(bytes) !== expectedSha256) {
    throw new Error(
      "C6 controlled-mutation projection SHA-256 does not match supply",
    );
  }
  return parseCanonicalProjection(bytes.toString("utf8"));
}

function parseCanonicalProjection(bytes: string): Projection {
  let json: unknown;
  try {
    json = JSON.parse(bytes);
  } catch {
    throw new Error("invalid C6 controlled-mutation projection JSON");
  }
  const parsed = projectionSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `invalid C6 controlled-mutation projection: ${parsed.error.message}`,
    );
  }
  if (`${JSON.stringify(parsed.data, null, 2)}\n` !== bytes) {
    throw new Error("C6 controlled-mutation projection is not canonical JSON");
  }
  return parsed.data;
}

function validateProjectionIdentity(
  base: BaseRepository,
  projection: Projection,
  families: readonly MutationFamily[],
): void {
  if (
    projection.baseRepositoryId !== base.baseRepositoryId ||
    projection.upstreamCommit !== base.upstreamCommit ||
    projection.upstreamTree !== base.upstreamTree
  ) {
    throw new Error(
      "C6 controlled-mutation projection identity does not match base repository",
    );
  }
  const allPaths = [
    ...projection.includedPaths,
    ...projection.excludedPaths,
  ];
  if (new Set(allPaths).size !== allPaths.length) {
    throw new Error(
      "C6 controlled-mutation projection includes and excludes the same path",
    );
  }
  const forbiddenVisible = projection.includedPaths.filter((path) =>
    path.startsWith("test/") ||
    path.startsWith(".github/") ||
    path.startsWith("lib/") ||
    /^(?:README|CHANGELOG)(?:\.|$)/iu.test(path) ||
    /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|bun\.lock)$/u.test(path)
  );
  if (forbiddenVisible.length > 0) {
    throw new Error(
      `C6 controlled-mutation source-only projection leaks upstream tests/docs/build artifacts: ${forbiddenVisible.join(",")}`,
    );
  }
  const included = new Set(projection.includedPaths);
  for (const required of ["LICENSE", "package.json"]) {
    if (!included.has(required)) {
      throw new Error(
        `C6 controlled-mutation source-only projection omits ${required}`,
      );
    }
  }
  for (const family of families) {
    for (const changedSurface of family.semanticContract.changedSurface) {
      if (!included.has(changedSurface)) {
        throw new Error(
          `C6 controlled-mutation projection omits changed surface ${changedSurface}`,
        );
      }
    }
  }
}

function validateTrackedProjection(
  trackedPaths: string[],
  projection: Projection,
): void {
  const declared = [
    ...projection.includedPaths,
    ...projection.excludedPaths,
  ].sort();
  if (JSON.stringify(trackedPaths) !== JSON.stringify(declared)) {
    throw new Error(
      "C6 controlled-mutation projection does not partition the complete upstream tree",
    );
  }
}

async function loadFrozenEvaluatorFactory(
  inputSnapshotRoot: string,
  families: readonly MutationFamily[],
): Promise<{
  bundleSha256: string;
  evaluate: EvaluateHiddenModuleCases;
}> {
  const currentSourcePath = resolve(
    import.meta.dir,
    "c6-hidden-evaluator-factory.ts",
  );
  const currentSource = await readC6StableRegularFile(
    currentSourcePath,
    "controlled-mutation evaluator factory implementation",
  );
  const currentSourceSha256 = sha256(currentSource);
  let frozenSourcePath: string | undefined;
  for (const family of families) {
    const familySourcePath = resolve(
      inputSnapshotRoot,
      family.evaluatorFactory.source.path,
    );
    const frozenSource = await readC6StableRegularFile(
      familySourcePath,
      "controlled-mutation frozen evaluator factory",
    );
    if (
      sha256(frozenSource) !== family.evaluatorFactory.source.sha256 ||
      currentSourceSha256 !== family.evaluatorFactory.source.sha256
    ) {
      throw new Error(
        "C6 controlled-mutation evaluator factory source does not match frozen artifact",
      );
    }
    if (
      frozenSourcePath !== undefined &&
      frozenSourcePath !== familySourcePath
    ) {
      throw new Error(
        "C6 controlled-mutation families must share one evaluator factory source",
      );
    }
    frozenSourcePath = familySourcePath;
  }
  const frozenAssetLockPath = resolve(
    dirname(frozenSourcePath!),
    "c6-asset-lock.ts",
  );
  const [currentAssetLock, frozenAssetLock] = await Promise.all([
    readC6StableRegularFile(
      resolve(import.meta.dir, "c6-asset-lock.ts"),
      "controlled-mutation current evaluator asset reader",
    ),
    readC6StableRegularFile(
      frozenAssetLockPath,
      "controlled-mutation frozen evaluator asset reader",
    ),
  ]);
  if (sha256(currentAssetLock) !== sha256(frozenAssetLock)) {
    throw new Error(
      "C6 controlled-mutation evaluator asset reader does not match frozen artifact",
    );
  }
  const zodPath = Bun.resolveSync("zod", import.meta.dir);
  const build = await Bun.build({
    entrypoints: [frozenSourcePath!],
    format: "cjs",
    minify: true,
    plugins: [{
      name: "c6-controlled-mutation-frozen-evaluator-dependencies",
      setup(builder) {
        builder.onResolve({ filter: /^zod$/u }, () => ({
          path: zodPath,
        }));
      },
    }],
    sourcemap: "none",
    splitting: false,
    target: "bun",
  });
  if (!build.success || build.outputs.length !== 1) {
    throw new Error(
      "C6 controlled-mutation frozen evaluator factory could not be bundled",
    );
  }
  const bundle = Buffer.from(await build.outputs[0]!.arrayBuffer());
  const bundleSha256 = sha256(bundle);
  const runtimeModule: {
    exports: Record<string, unknown>;
  } = { exports: {} };
  const execute = new Function(
    `return (\n${bundle.toString("utf8")}\n);`,
  )() as (
    exports: Record<string, unknown>,
    require: NodeJS.Require,
    module: typeof runtimeModule,
    filename: string,
    dirname: string,
  ) => void;
  execute(
    runtimeModule.exports,
    createRequire(import.meta.url),
    runtimeModule,
    frozenSourcePath!,
    dirname(frozenSourcePath!),
  );
  const evaluate = runtimeModule.exports.evaluateC6HiddenModuleCases;
  if (typeof evaluate !== "function") {
    throw new Error(
      "C6 controlled-mutation frozen evaluator factory export is missing",
    );
  }
  return {
    bundleSha256,
    evaluate: evaluate as EvaluateHiddenModuleCases,
  };
}

async function cloneSourceBundle(input: {
  commit: string;
  destination: string;
  sourceBundlePath: string;
  tree: string;
}): Promise<void> {
  await runGit(
    [
      "-c",
      "protocol.file.allow=always",
      "clone",
      "--no-checkout",
      "--quiet",
      input.sourceBundlePath,
      input.destination,
    ],
  );
  await runGit(
    [
      "-c",
      "advice.detachedHead=false",
      "checkout",
      "--detach",
      "--quiet",
      input.commit,
    ],
    input.destination,
  );
  const [commit, tree, status] = await Promise.all([
    runGit(["rev-parse", "HEAD^{commit}"], input.destination),
    runGit(["rev-parse", "HEAD^{tree}"], input.destination),
    runGit(
      ["status", "--porcelain=v1", "--untracked-files=all"],
      input.destination,
    ),
  ]);
  if (
    commit.trim() !== input.commit ||
    tree.trim() !== input.tree ||
    status.length > 0
  ) {
    throw new Error(
      "C6 controlled-mutation source bundle did not reproduce the pinned commit/tree",
    );
  }
}

async function listTrackedFiles(repositoryRoot: string): Promise<string[]> {
  const output = await runGit(["ls-files", "-z"], repositoryRoot);
  return output
    .split("\0")
    .filter((path) => path.length > 0)
    .sort();
}

async function materializeProjection(
  sourceRoot: string,
  destinationRoot: string,
  includedPaths: readonly string[],
): Promise<void> {
  await mkdir(destinationRoot, { recursive: true });
  for (const path of includedPaths) {
    const sourcePath = resolve(sourceRoot, path);
    const destinationPath = resolve(destinationRoot, path);
    const stat = await lstat(sourcePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(
        `C6 controlled-mutation projection rejects non-regular source ${path}`,
      );
    }
    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
    await chmod(destinationPath, stat.mode & 0o777);
  }
}

async function applyPatch(
  repositoryRoot: string,
  patchPath: string,
): Promise<void> {
  await runGit(["apply", "--check", patchPath], repositoryRoot);
  await runGit(["apply", patchPath], repositoryRoot);
}

interface FileTree {
  files: Array<{
    bytes: number;
    mode: number;
    path: string;
    sha256: string;
  }>;
  rootSha256: string;
}

export async function hashC6ControlledMutationVisibleTree(
  root: string,
): Promise<FileTree> {
  return hashFileTree(root);
}

async function hashFileTree(root: string): Promise<FileTree> {
  const files = [];
  for (const path of await walkFiles(root, root)) {
    const bytes = await readFile(resolve(root, path));
    const stat = await lstat(resolve(root, path));
    files.push({
      bytes: bytes.byteLength,
      mode: stat.mode & 0o777,
      path,
      sha256: sha256(bytes),
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    files,
    rootSha256: sha256(JSON.stringify(files)),
  };
}

async function walkFiles(root: string, current: string): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    const absolutePath = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `C6 controlled-mutation visible tree rejects symlink ${absolutePath}`,
      );
    }
    if (entry.isDirectory()) {
      paths.push(...await walkFiles(root, absolutePath));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `C6 controlled-mutation visible tree rejects non-file ${absolutePath}`,
      );
    }
    paths.push(relative(root, absolutePath).split("\\").join("/"));
  }
  return paths;
}

function assertChangedSurface(
  base: FileTree,
  prepared: FileTree,
  expectedChangedPaths: readonly string[],
  episodeId: string,
): void {
  const baseByPath = new Map(base.files.map((file) => [file.path, file]));
  const preparedByPath = new Map(
    prepared.files.map((file) => [file.path, file]),
  );
  const paths = new Set([...baseByPath.keys(), ...preparedByPath.keys()]);
  const changed = [...paths]
    .filter((path) =>
      JSON.stringify(baseByPath.get(path)) !==
        JSON.stringify(preparedByPath.get(path))
    )
    .sort();
  if (
    JSON.stringify(changed) !==
      JSON.stringify([...expectedChangedPaths].sort())
  ) {
    throw new Error(
      `C6 controlled-mutation changed surface mismatch for ${episodeId}`,
    );
  }
}

async function assertAssetPinsUnchanged(
  assetRoot: string,
  input: C6ControlledMutationSupplyInput,
): Promise<void> {
  const loaded = await loadC6AssetLock(assetRoot);
  if (
    loaded.assetLockSha256 !== input.expectedAssetLockSha256 ||
    loaded.assetLock.assetRootSha256 !== input.expectedAssetRootSha256
  ) {
    throw new Error(
      "C6 controlled-mutation asset closure changed during materialization",
    );
  }
  await verifyC6AssetClosure(assetRoot, loaded);
}

async function runGit(
  arguments_: string[],
  cwd?: string,
): Promise<string> {
  const child = Bun.spawn({
    cmd: ["git", ...arguments_],
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `C6 controlled-mutation git ${arguments_[0]} failed (${exitCode}): ${stderr.trim()}`,
    );
  }
  return stdout;
}

function isWithin(root: string, path: string): boolean {
  const child = relative(root, path);
  return (
    child.length > 0 &&
    child !== ".." &&
    !child.startsWith("../") &&
    !isAbsolute(child)
  );
}

function sha256(value: string | Uint8Array): string {
  return sha256Schema.parse(
    createHash("sha256").update(value).digest("hex"),
  );
}
