import { createHash } from "node:crypto";
import {
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  rebaseC6SourceV3SimplePassArtifactBundle,
  verifyC6SourceV3SimplePassArtifactBundle,
  writeC6SourceV3SimplePassArtifactBundle,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-artifacts";
import type {
  C6SourceV3SimpleFrameDefinition,
  C6SourceV3SimpleNormalizedPass,
  C6SourceV3SimpleRootShard,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-core";
import {
  writeC6SourceV3SimpleFrozenInputClosure,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-finalization";
import {
  createC6SourceV3SimpleTestExpectedFrozenInputs,
} from "./codex-coding-effect.c6-source-v3-simple-census-test-support";

const CONTRACT_SHA = "a".repeat(64);
const EVALUATION_ID =
  "goodmemory-c6-codex-coding-effect-source-v3-simple-v1";
const ROOT_SHARD: C6SourceV3SimpleRootShard = {
  createdFrom: "2020-01-01T00:00:00Z",
  createdTo: "2020-01-01T00:00:03Z",
  language: "TypeScript",
  query:
    "language:TypeScript " +
    "created:2020-01-01T00:00:00Z..2020-01-01T00:00:03Z " +
    "pushed:>=2024-01-01 is:public archived:false " +
    "mirror:false template:false",
  rootShardId: "ts:2020-01-01",
  split: "ts",
};
const ROOT_SHARDS = [
  ROOT_SHARD,
  ...Array.from({ length: 1_535 }, (_, index) => ({
    ...ROOT_SHARD,
    rootShardId:
      `zz:test-${String(index).padStart(4, "0")}`,
  })),
];
const FRAME: C6SourceV3SimpleFrameDefinition = {
  frozenPreWave3AnchorExclusions: [],
  frozenPreWave3RepositoryExclusions: [],
  priorRepositoryAliases: [],
  priorRepositoryNodeIds: [],
  rootShards: ROOT_SHARDS,
};

describe("C6 source-v3-simple semantic pass artifacts", () => {
  it("writes and independently replays the exact normalized pass closure", async () => {
    await withRoot(async (root) => {
      const binding = await prepareFrozenInputClosure(root);
      const passRoot = join(root, "pass-a");
      const bundle =
        await writeC6SourceV3SimplePassArtifactBundle({
          assetRoot: root,
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
          frozenInputClosureSha256:
            binding.frozenInputClosureSha256,
          frame: FRAME,
          normalizedPass: emptyPass(),
          pass: "A",
          passRoot,
          runtimeAuthorizationSha256:
            binding.runtimeAuthorizationSha256,
        });
      const rebased =
        rebaseC6SourceV3SimplePassArtifactBundle(
          root,
          passRoot,
          bundle,
        );

      expect(
        await verifyC6SourceV3SimplePassArtifactBundle({
          assetRoot: root,
          bundle: rebased,
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
          frozenInputClosureSha256:
            binding.frozenInputClosureSha256,
          frame: FRAME,
          pass: "A",
          runtimeAuthorizationSha256:
            binding.runtimeAuthorizationSha256,
        }),
      ).toMatchObject({
        normalizedProjectionSha256:
          bundle.normalizedProjectionSha256,
      });
      await expect(
        verifyC6SourceV3SimplePassArtifactBundle({
          assetRoot: root,
          bundle: rebased,
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
          frozenInputClosureSha256:
            binding.frozenInputClosureSha256,
          frame: FRAME,
          pass: "A",
          runtimeAuthorizationSha256: "b".repeat(64),
        }),
      ).rejects.toThrow();
      await writeFile(
        join(root, rebased.normalizedProjection.path),
        "{}\n",
      );
      await expect(
        verifyC6SourceV3SimplePassArtifactBundle({
          assetRoot: root,
          bundle: rebased,
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
          frozenInputClosureSha256:
            binding.frozenInputClosureSha256,
          frame: FRAME,
          pass: "A",
          runtimeAuthorizationSha256:
            binding.runtimeAuthorizationSha256,
        }),
      ).rejects.toThrow();
    });
  });

  it("rejects extra normalized-pass fields before writing artifacts", async () => {
    await withRoot(async (root) => {
      const binding = await prepareFrozenInputClosure(root);
      await expect(
        writeC6SourceV3SimplePassArtifactBundle({
          assetRoot: root,
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
          frozenInputClosureSha256:
            binding.frozenInputClosureSha256,
          frame: FRAME,
          normalizedPass: {
            ...emptyPass(),
            unexpected: true,
          } as C6SourceV3SimpleNormalizedPass,
          pass: "A",
          passRoot: join(root, "pass-a"),
          runtimeAuthorizationSha256:
            binding.runtimeAuthorizationSha256,
        }),
      ).rejects.toThrow();
    });
  });
});

async function prepareFrozenInputClosure(
  root: string,
): Promise<{
  frozenInputClosureSha256: string;
  runtimeAuthorizationSha256: string;
}> {
  const bytes = Buffer.from("artifact fixture");
  await writeFile(join(root, "fixture.json"), bytes);
  const expected =
    createC6SourceV3SimpleTestExpectedFrozenInputs({
      evaluationId: EVALUATION_ID,
      executionContractSha256: CONTRACT_SHA,
      frozenInputs: [{
        bytes: bytes.length,
        label: "fixture",
        path: "fixture.json",
        sha256: createHash("sha256")
          .update(bytes)
          .digest("hex"),
      }],
    });
  const reference =
    await writeC6SourceV3SimpleFrozenInputClosure({
      assetRoot: root,
      expected,
      repositoryRoot: root,
    });
  return {
    frozenInputClosureSha256: reference.sha256,
    runtimeAuthorizationSha256:
      expected.runtimeAuthorizationSha256,
  };
}

function emptyPass(): C6SourceV3SimpleNormalizedPass {
  const countTrees = ROOT_SHARDS.map((rootShard) => {
    const leaf = {
      count: 0,
      createdFrom: rootShard.createdFrom,
      createdTo: rootShard.createdTo,
      depth: 0,
      leaf: true as const,
      query: rootShard.query,
    };
    return {
      leaves: [leaf],
      nodes: [leaf],
      rootShardId: rootShard.rootShardId,
    };
  });
  return {
    countTrees,
    metadataDecisions: [],
    pullRequestClosures: [],
    pullRequests: [],
    repositoryDecisions: [],
    repositoryLeafClosures: countTrees.map(
      (tree) => ({
        expectedRepositoryCount: 0,
        leafCreatedFrom:
          tree.leaves[0]!.createdFrom,
        leafCreatedTo: tree.leaves[0]!.createdTo,
        pageCount: 0,
        rootShardId: tree.rootShardId,
        terminalReason:
          "zero-count-leaf" as const,
      }),
    ),
    repositories: [],
  };
}

async function withRoot(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(
    process.cwd(),
    ".goodmemory-c6-census-artifacts-",
  ));
  try {
    await run(root);
  } finally {
    await rm(root, {
      force: true,
      recursive: true,
    });
  }
}
