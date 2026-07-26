import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildC6ReviewTrajectoryDiscovery,
  serializeC6ReviewTrajectoryDiscovery,
} from "../../../scripts/codex-coding-effect/c6-review-trajectory-discovery";
import {
  runC6ReviewTrajectoryDiscoverySnapshotCommand,
} from "../../../scripts/snapshot-codex-coding-effect-c6-review-trajectory-discovery";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_ROOT =
  process.env.GOODMEMORY_TEST_C6_GRAPHQL_FULL_SOURCE_ROOT?.trim();
const GRAPHQL_ROOT =
  process.env.GOODMEMORY_TEST_C6_GRAPHQL_FULL_CAPTURE_ROOT?.trim();
const REST_ROOT =
  process.env.GOODMEMORY_TEST_C6_REVIEW_TRAJECTORY_REST_ROOT?.trim();
const maybeDescribe =
  SOURCE_ROOT && GRAPHQL_ROOT && REST_ROOT ? describe : describe.skip;
const SOURCE_REVISION = "56ff018c04a38e27ada1e9d0a6d5839a51f88f0d";
const SOURCE_ROOT_SHA256 =
  "16ad77277902c818f30e9b282caaa44d6dfef2bfd67bcccd1b2455c91d9c9bd7";
const GRAPHQL_ROOT_SHA256 =
  "a529f3fd0226303f6d70c6222bf528f59ccc213145f4be44305aac80151b140b";
const REST_ROOT_SHA256 =
  "26bacb6c859eb033ab62472ca2cfb49085ec8c00f032c3874c1e87594dc78282";
const TARGETS_SHA256 =
  "138bf38b352220f2514df53f903331a2b925791feee932ae2bb00f880e929581";
const TREE_RECEIPT_SHA256 =
  "8de0f6501c0fa3dd844d38704a4a44eb8f3b4aaa997aa74c9507c79d501c8384";

setDefaultTimeout(900_000);

maybeDescribe("Codex coding-effect C6 review trajectory replay", () => {
  it("replays the 145 linear review signals byte-for-byte and refuses overwrite", async () => {
    const sourceRoot = requiredExternalPath(
      SOURCE_ROOT,
      "GOODMEMORY_TEST_C6_GRAPHQL_FULL_SOURCE_ROOT",
    );
    const graphqlRoot = requiredExternalPath(
      GRAPHQL_ROOT,
      "GOODMEMORY_TEST_C6_GRAPHQL_FULL_CAPTURE_ROOT",
    );
    const restRoot = requiredExternalPath(
      REST_ROOT,
      "GOODMEMORY_TEST_C6_REVIEW_TRAJECTORY_REST_ROOT",
    );
    const sourcePoolRoot = join(
      REPOSITORY_ROOT,
      "fixtures/codex-coding-effect/c6-source-pool",
    );
    const treeReceipt = join(
      sourcePoolRoot,
      "multi-swe-full-56ff018-receipts/hf-tree-merged-current.json",
    );
    const targets = join(
      sourcePoolRoot,
      "multi-swe-full-56ff018-receipts/goodmemory-c6-review-trajectory-rest-targets.tsv",
    );
    const artifactPath = join(
      sourcePoolRoot,
      "multi-swe-full-56ff018.review-trajectory-discovery.json",
    );
    const expectedBytes = await readFile(artifactPath);
    const discovery = await buildC6ReviewTrajectoryDiscovery({
      declaredSourceRevision: SOURCE_REVISION,
      expectedGraphqlRootSha256: GRAPHQL_ROOT_SHA256,
      expectedRestRootSha256: REST_ROOT_SHA256,
      expectedSourceRootSha256: SOURCE_ROOT_SHA256,
      expectedTargetsSha256: TARGETS_SHA256,
      expectedTreeReceiptSha256: TREE_RECEIPT_SHA256,
      graphqlCaptureRoot: graphqlRoot,
      restCaptureRoot: restRoot,
      sourceRoot,
      targetsPath: targets,
      treeReceiptPath: treeReceipt,
    });

    expect(serializeC6ReviewTrajectoryDiscovery(discovery)).toBe(
      expectedBytes.toString("utf8"),
    );
    expect(discovery.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      signalsNotEpisodes: true,
      status: "review-trajectory-signals-not-episodes",
      upperBoundClaimPermitted: false,
    });
    expect(discovery.counts).toMatchObject({
      f2pAndP2pNonempty: 77,
      f2pNonempty: 80,
      graphqlParentAncestrySequences: 146,
      linearReviewAncestrySequences: 145,
      linearReviewF2pAndP2pNonempty: 76,
      linearReviewF2pNonempty: 79,
      preliminarySignalCandidates: 175,
      restMissingClosures: 15,
      restStrictCompleteClosures: 160,
      sourceAnchors: 1737,
      sourceFiles: 47,
      timestampSequences: 148,
    });
    expect(discovery.selectionAudit).toMatchObject({
      fullAncestrySearchSequences: 146,
      legacyTimestampFirstPairwiseAncestrySequences: 140,
      linearReviewAncestrySequences: 145,
      nonlinearThreeEdgeSignals: ["mui/material-ui#25259"],
      rejectedByFullSearch: [],
    });
    expect(discovery.selectionAudit.recoveredByFullSearch).toHaveLength(6);

    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-c6-review-trajectory-replay-"),
    );
    try {
      const output = join(temporaryRoot, "discovery.json");
      const args = [
        `--source-root=${sourceRoot}`,
        `--tree-receipt=${treeReceipt}`,
        `--graphql-capture-root=${graphqlRoot}`,
        `--rest-capture-root=${restRoot}`,
        `--targets=${targets}`,
        `--declared-source-revision=${SOURCE_REVISION}`,
        `--expected-source-root-sha256=${SOURCE_ROOT_SHA256}`,
        `--expected-tree-receipt-sha256=${TREE_RECEIPT_SHA256}`,
        `--expected-graphql-root-sha256=${GRAPHQL_ROOT_SHA256}`,
        `--expected-rest-root-sha256=${REST_ROOT_SHA256}`,
        `--expected-targets-sha256=${TARGETS_SHA256}`,
        `--output=${output}`,
      ];
      const result =
        await runC6ReviewTrajectoryDiscoverySnapshotCommand(args);

      expect(result.outputSha256).toBe(sha256(expectedBytes));
      await expect(
        runC6ReviewTrajectoryDiscoverySnapshotCommand(args),
      ).rejects.toMatchObject({ code: "EEXIST" });
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });
});

function requiredExternalPath(
  value: string | undefined,
  name: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for the C6 trajectory replay gate`);
  }
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
