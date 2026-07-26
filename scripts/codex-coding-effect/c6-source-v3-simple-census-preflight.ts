import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  readC6StableRegularFile,
} from "./c6-asset-lock";
import {
  buildC6SourceV3SimpleCensusExecutionContract,
  parseC6SourceV3SimpleCensusExecutionContract,
} from "./c6-source-v3-simple-census-contract";
import type {
  C6SourceV3SimpleCensusExecutionContract,
} from "./c6-source-v3-simple-census-contract";
import {
  deriveC6SourceV3SimpleRootShards,
} from "./c6-source-v3-simple-census-core";
import type {
  C6SourceV3SimpleFrameDefinition,
} from "./c6-source-v3-simple-census-core";
import {
  requireC6SourceV3SimpleCensusAuthorization,
} from "./c6-source-v3-simple-census";
import {
  loadC6SourceV3SimplePriorExclusionSet,
} from "./c6-source-v3-simple-prior-exclusion";
import {
  parseC6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
} from "./c6-source-v3-simple-prior-repository-identity-replay";
import {
  parseC6SourceV3SimplePromotionReceipt,
} from "./c6-source-v3-simple-promotion";
import {
  parseC6SourceV3SimpleProtocol,
} from "./c6-source-v3-simple";
import {
  parseC6Wave3PretargetPolicy,
} from "./c6-wave3-pretarget-policy";
import {
  parseC6Wave3SourceUniverseV2,
} from "./c6-wave3-source-universe-v2";

const EXECUTION_CONTRACT_BINDING = {
  bytes: 26_443,
  path:
    "fixtures/codex-coding-effect/c6-source-pool/" +
    "provenance/source-v3-simple/" +
    "census-execution-contract-v1.json",
  sha256:
    "a473d6668a46e4d3d23d855d42dffeb6026099cedf82af1351587fd9b04b76e8",
} as const;

interface FrozenInputBinding {
  bytes: number;
  path: string;
  sha256: string;
}

export interface C6SourceV3SimpleCensusFrozenInput {
  bytes: number;
  label: string;
  path: string;
  sha256: string;
}

export interface C6SourceV3SimpleCensusPreflight {
  contract: C6SourceV3SimpleCensusExecutionContract;
  frame: C6SourceV3SimpleFrameDefinition;
  frozenInputs: C6SourceV3SimpleCensusFrozenInput[];
}

export async function loadC6SourceV3SimpleCensusPreflight(
  input: {
    repositoryRoot: string;
  },
): Promise<C6SourceV3SimpleCensusPreflight> {
  const contractBytes = await readFrozenInput(
    input.repositoryRoot,
    "execution contract",
    EXECUTION_CONTRACT_BINDING,
  );
  const contract =
    parseC6SourceV3SimpleCensusExecutionContract(
      contractBytes,
    );
  if (
    JSON.stringify(contract) !==
      JSON.stringify(
        buildC6SourceV3SimpleCensusExecutionContract(),
      )
  ) {
    throw new Error(
      "C6 source-v3-simple executable contract source mismatch",
    );
  }
  const bindings = [
    ["protocol", contract.inputs.protocol],
    ["promotion receipt", contract.inputs.promotionReceipt],
    ["metadata predicate", contract.inputs.metadataPredicate],
    [
      "prior identity replay receipt",
      contract.inputs.priorIdentityReplayReceipt,
    ],
    [
      "prior exclusion projection",
      contract.inputs.priorExclusionProjection,
    ],
    ["source universe", contract.inputs.sourceUniverse],
  ] as const;
  const artifacts = new Map<string, Buffer>();
  for (const [label, binding] of bindings) {
    artifacts.set(
      label,
      await readFrozenInput(
        input.repositoryRoot,
        label,
        binding,
      ),
    );
  }
  const protocol = parseC6SourceV3SimpleProtocol(
    requiredArtifact(artifacts, "protocol"),
  );
  const promotion = parseC6SourceV3SimplePromotionReceipt(
    requiredArtifact(artifacts, "promotion receipt"),
  );
  const promotionAuthorization =
    await requireC6SourceV3SimpleCensusAuthorization({
      promotionInput: {
        censusImplementationCommitSha:
          promotion.censusImplementation.commitSha,
        freezeCommitSha:
          promotion.freeze.commitSha,
        promotionBaseCommitSha:
          promotion.promotionBase.commitSha,
        repositoryRoot: input.repositoryRoot,
      },
      promotionReceiptBytes: requiredArtifact(
        artifacts,
        "promotion receipt",
      ),
    });
  parseC6Wave3PretargetPolicy(
    requiredArtifact(artifacts, "metadata predicate"),
  );
  parseC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
    requiredArtifact(
      artifacts,
      "prior identity replay receipt",
    ),
  );
  const sourceUniverse = parseC6Wave3SourceUniverseV2(
    requiredArtifact(artifacts, "source universe"),
  );
  const priorExclusions =
    loadC6SourceV3SimplePriorExclusionSet({
      projectionBytes: requiredArtifact(
        artifacts,
        "prior exclusion projection",
      ),
      replayReceiptBytes: requiredArtifact(
        artifacts,
        "prior identity replay receipt",
      ),
    });
  if (
    protocol.evaluationId !== contract.evaluationId ||
    promotion.evaluationId !== contract.evaluationId ||
    promotionAuthorization.evaluationId !==
      contract.evaluationId ||
    !promotionAuthorization.formalCensusPermitted ||
    !promotionAuthorization.sourceV3SimpleFrozen ||
    !promotionAuthorization
      .priorRepositoryNodeIdExclusionComplete ||
    promotionAuthorization
      .candidateSelectionPermitted ||
    promotionAuthorization.candidateManifestFrozen ||
    promotionAuthorization.codexRunReady ||
    !promotion.boundary.formalCensusPermitted ||
    !promotion.boundary.sourceV3SimpleFrozen ||
    !promotion.boundary
      .priorRepositoryNodeIdExclusionComplete ||
    promotion.boundary.candidateSelectionPermitted ||
    promotion.boundary.candidateManifestFrozen ||
    promotion.boundary.codexRunReady
  ) {
    throw new Error(
      "C6 source-v3-simple promotion does not authorize only the formal census",
    );
  }
  const frame: C6SourceV3SimpleFrameDefinition = {
    frozenPreWave3AnchorExclusions: [
      ...sourceUniverse.exclusions.canonicalAnchors,
    ],
    frozenPreWave3RepositoryExclusions: [
      ...sourceUniverse.exclusions.canonicalRepositories,
    ],
    priorRepositoryAliases: priorExclusions.aliases,
    priorRepositoryNodeIds: priorExclusions.nodeIds,
    rootShards:
      deriveC6SourceV3SimpleRootShards(sourceUniverse),
  };
  if (
    frame.rootShards.length !==
      contract.capture.rootShardCount ||
    frame.frozenPreWave3AnchorExclusions.length !==
      1_447 ||
    frame.frozenPreWave3RepositoryExclusions.length !==
      178 ||
    frame.priorRepositoryAliases.length !==
      contract.inputs.priorExclusionProjection
        .uniqueAliasCount ||
    frame.priorRepositoryNodeIds.length !==
      contract.inputs.priorExclusionProjection
        .uniqueNodeIdCount
  ) {
    throw new Error(
      "C6 source-v3-simple frozen frame count mismatch",
    );
  }
  const frozenInputs = [
    frozenInputReceipt(
      "execution contract",
      EXECUTION_CONTRACT_BINDING,
    ),
    ...bindings.map(([label, binding]) =>
      frozenInputReceipt(label, binding)
    ),
  ];
  return {
    contract,
    frame,
    frozenInputs,
  };
}

async function readFrozenInput(
  repositoryRoot: string,
  label: string,
  binding: FrozenInputBinding,
): Promise<Buffer> {
  const bytes = await readC6StableRegularFile(
    join(repositoryRoot, binding.path),
    `source-v3-simple census ${label}`,
    binding.bytes,
  );
  if (
    bytes.length !== binding.bytes ||
    sha256(bytes) !== binding.sha256
  ) {
    throw new Error(
      `C6 source-v3-simple census ${label} binding mismatch`,
    );
  }
  return bytes;
}

function requiredArtifact(
  artifacts: ReadonlyMap<string, Buffer>,
  label: string,
): Buffer {
  const bytes = artifacts.get(label);
  if (bytes === undefined) {
    throw new Error(
      `C6 source-v3-simple census missing ${label}`,
    );
  }
  return bytes;
}

function frozenInputReceipt(
  label: string,
  binding: FrozenInputBinding,
): C6SourceV3SimpleCensusFrozenInput {
  return {
    bytes: binding.bytes,
    label,
    path: binding.path,
    sha256: binding.sha256,
  };
}

function sha256(
  input: string | Uint8Array,
): string {
  return createHash("sha256").update(input).digest("hex");
}
