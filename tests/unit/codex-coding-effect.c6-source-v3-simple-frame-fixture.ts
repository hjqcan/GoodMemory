import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  buildC6SourceV3SimpleCensusExecutionContract,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-contract";
import {
  deriveC6SourceV3SimpleRootShards,
  parseC6SourceV3SimpleFrameDefinition,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-core";
import type {
  C6SourceV3SimpleFrameDefinition,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-core";
import {
  loadC6SourceV3SimplePriorExclusionSet,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-prior-exclusion";
import {
  parseC6Wave3SourceUniverseV2,
} from "../../scripts/codex-coding-effect/c6-wave3-source-universe-v2";

const REPOSITORY_ROOT = resolve(
  import.meta.dir,
  "../..",
);

export async function loadExactC6SourceV3SimpleFrameFixture(): Promise<
  C6SourceV3SimpleFrameDefinition
> {
  const contract =
    buildC6SourceV3SimpleCensusExecutionContract();
  const readInput = (path: string) =>
    readFile(resolve(REPOSITORY_ROOT, path));
  const [
    sourceUniverseBytes,
    projectionBytes,
    replayReceiptBytes,
  ] = await Promise.all([
    readInput(
      contract.inputs.sourceUniverse.path,
    ),
    readInput(
      contract.inputs.priorExclusionProjection
        .path,
    ),
    readInput(
      contract.inputs.priorIdentityReplayReceipt
        .path,
    ),
  ]);
  const sourceUniverse =
    parseC6Wave3SourceUniverseV2(
      sourceUniverseBytes,
    );
  const priorExclusions =
    loadC6SourceV3SimplePriorExclusionSet({
      projectionBytes,
      replayReceiptBytes,
    });
  return parseC6SourceV3SimpleFrameDefinition({
    frozenPreWave3AnchorExclusions: [
      ...sourceUniverse.exclusions
        .canonicalAnchors,
    ],
    frozenPreWave3RepositoryExclusions: [
      ...sourceUniverse.exclusions
        .canonicalRepositories,
    ],
    priorRepositoryAliases:
      priorExclusions.aliases,
    priorRepositoryNodeIds:
      priorExclusions.nodeIds,
    rootShards:
      deriveC6SourceV3SimpleRootShards(
        sourceUniverse,
      ),
  });
}
