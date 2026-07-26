import { createHash } from "node:crypto";

import type {
  C6SourceV3SimpleFrameDefinition,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-core";
import type {
  C6SourceV3SimpleExpectedFrozenInputs,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-finalization";

const SHA1 = "1".repeat(40);
const SHA256 = "2".repeat(64);
const FRAME: C6SourceV3SimpleFrameDefinition = {
  frozenPreWave3AnchorExclusions: [],
  frozenPreWave3RepositoryExclusions: [],
  priorRepositoryAliases: [],
  priorRepositoryNodeIds: [],
  rootShards: [
    testRootShard("ts:2020-01-01"),
    ...Array.from(
      { length: 1_535 },
      (_, index) =>
        testRootShard(
          `zz:test-${String(index).padStart(4, "0")}`,
        ),
    ),
  ],
};

export function createC6SourceV3SimpleTestExpectedFrozenInputs(
  input: {
    activationReceiptBytes?: Uint8Array;
    evaluationId: string;
    executionContractSha256: string;
    frozenInputs: readonly {
      bytes: number;
      label: string;
      path: string;
      sha256: string;
    }[];
  },
): C6SourceV3SimpleExpectedFrozenInputs {
  const reference = (path: string) => ({
    bytes: 1,
    path,
    sha256: SHA256,
  });
  const activationReceipt =
    input.activationReceiptBytes === undefined
      ? reference("activation-receipt.json")
      : {
          bytes: input.activationReceiptBytes.length,
          path: "activation-receipt.json",
          sha256: sha256(
            Buffer.from(
              input.activationReceiptBytes,
            ).toString("binary"),
            "binary",
          ),
        };
  const runtimeAuthorization = {
    activationBridge: reference("activation-bridge.ts"),
    activationCommit: {
      commitSha: SHA1,
      parentCommitSha: SHA1,
      treeSha: SHA1,
    },
    activationReceipt,
    artifactKind:
      "c6-source-v3-simple-census-runtime-authorization" as const,
    boundary: {
      acceptedEpisodeCount: 0 as const,
      candidateManifestFrozen: false as const,
      candidateSelectionPermitted: false as const,
      codexRunReady: false as const,
      formalCensusLiveNetworkPermitted: true as const,
    },
    evaluationId:
      "goodmemory-c6-codex-coding-effect-source-v3-simple-v1" as const,
    executionContract: {
      bytes: 1,
      path: "contract.json",
      sha256: input.executionContractSha256,
    },
    freeze: {
      commitSha: SHA1,
      parentCommitSha: SHA1,
      treeSha: SHA1,
    },
    promotionReceipt: reference("promotion.json"),
    reviewCommit: {
      commitSha: SHA1,
      parentCommitSha: SHA1,
      treeSha: SHA1,
    },
    reviewProvenance: reference("review.json"),
    runtimeSourceAggregateSha256: SHA256,
    runtimeSourceManifest: reference("manifest.json"),
    runtimeVersions: {
      bun: Bun.version,
      node: process.versions.node,
    },
    schemaVersion: 1 as const,
    status:
      "formal-census-live-network-only-no-candidate-selection-or-codex-run-authority" as const,
  };
  if (
    input.evaluationId !==
      runtimeAuthorization.evaluationId
  ) {
    throw new Error(
      "test runtime authorization evaluation mismatch",
    );
  }
  const runtimeAuthorizationSha256 = sha256(
    JSON.stringify(runtimeAuthorization),
  );
  const frozenInputs = input.frozenInputs.map(
    (entry) => ({ ...entry }),
  );
  return {
    evaluationId: input.evaluationId,
    executionContractSha256:
      input.executionContractSha256,
    frame: FRAME,
    frozenInputs,
    inputClosureSha256: sha256(JSON.stringify({
      frame: FRAME,
      frozenInputs,
      runtimeAuthorization,
      runtimeAuthorizationSha256,
    })),
    runtimeAuthorization,
    runtimeAuthorizationSha256,
  };
}

function testRootShard(rootShardId: string) {
  return {
    createdFrom: "2020-01-01T00:00:00Z",
    createdTo: "2020-01-01T00:00:03Z",
    language: "TypeScript",
    query:
      "language:TypeScript " +
      "created:2020-01-01T00:00:00Z..2020-01-01T00:00:03Z " +
      "pushed:>=2024-01-01 is:public archived:false " +
      "mirror:false template:false",
    rootShardId,
    split: "ts" as const,
  };
}

function sha256(
  value: string,
  encoding: BufferEncoding = "utf8",
): string {
  return createHash("sha256")
    .update(value, encoding)
    .digest("hex");
}
