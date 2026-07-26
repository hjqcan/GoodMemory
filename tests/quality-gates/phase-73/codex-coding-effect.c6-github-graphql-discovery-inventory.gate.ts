import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildC6GitHubGraphQLDiscoveryInventory,
  serializeC6GitHubGraphQLDiscoveryInventory,
} from "../../../scripts/codex-coding-effect/c6-github-graphql-discovery-inventory";
import {
  runC6GitHubGraphQLDiscoveryInventorySnapshotCommand,
} from "../../../scripts/snapshot-codex-coding-effect-c6-github-graphql-discovery-inventory";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_ROOT =
  process.env.GOODMEMORY_TEST_C6_GRAPHQL_FULL_SOURCE_ROOT?.trim();
const CAPTURE_ROOT =
  process.env.GOODMEMORY_TEST_C6_GRAPHQL_FULL_CAPTURE_ROOT?.trim();
const REST_SUPPLEMENT_ROOT =
  process.env.GOODMEMORY_TEST_C6_GRAPHQL_REST_SUPPLEMENT_ROOT?.trim();
const maybeDescribe =
  SOURCE_ROOT && CAPTURE_ROOT && REST_SUPPLEMENT_ROOT
    ? describe
    : describe.skip;
const SOURCE_REVISION = "56ff018c04a38e27ada1e9d0a6d5839a51f88f0d";
const SOURCE_ROOT_SHA256 =
  "16ad77277902c818f30e9b282caaa44d6dfef2bfd67bcccd1b2455c91d9c9bd7";
const TREE_RECEIPT_SHA256 =
  "8de0f6501c0fa3dd844d38704a4a44eb8f3b4aaa997aa74c9507c79d501c8384";

setDefaultTimeout(300_000);

maybeDescribe("Codex coding-effect C6 full GraphQL discovery inventory replay", () => {
  it("replays 1737 anchors byte-for-byte and refuses output overwrite", async () => {
    const sourceRoot = requiredExternalPath(
      SOURCE_ROOT,
      "GOODMEMORY_TEST_C6_GRAPHQL_FULL_SOURCE_ROOT",
    );
    const captureRoot = requiredExternalPath(
      CAPTURE_ROOT,
      "GOODMEMORY_TEST_C6_GRAPHQL_FULL_CAPTURE_ROOT",
    );
    const restSupplementRoot = requiredExternalPath(
      REST_SUPPLEMENT_ROOT,
      "GOODMEMORY_TEST_C6_GRAPHQL_REST_SUPPLEMENT_ROOT",
    );
    const sourcePoolRoot = join(
      REPOSITORY_ROOT,
      "fixtures/codex-coding-effect/c6-source-pool",
    );
    const treeReceipt = join(
      sourcePoolRoot,
      "multi-swe-full-56ff018-receipts/hf-tree-merged-current.json",
    );
    const artifactPath = join(
      sourcePoolRoot,
      "multi-swe-full-56ff018.github-graphql-discovery-inventory.json",
    );
    const expectedBytes = await readFile(artifactPath);
    const inventory = await buildC6GitHubGraphQLDiscoveryInventory({
      captureRoot,
      expectedSourceRevision: SOURCE_REVISION,
      expectedSourceRootSha256: SOURCE_ROOT_SHA256,
      expectedTreeReceiptSha256: TREE_RECEIPT_SHA256,
      restSupplementRoot,
      sourceRoot,
      treeReceiptPath: treeReceipt,
    });

    expect(serializeC6GitHubGraphQLDiscoveryInventory(inventory)).toBe(
      expectedBytes.toString("utf8"),
    );
    expect(inventory.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      status: "graphql-discovery-inventory-only-not-accepted-evidence",
      upperBoundClaimPermitted: false,
    });
    expect(inventory.counts).toMatchObject({
      effectiveDiscoverySurfaceCompleteCaptures: 1737,
      expectedCaptures: 1737,
      missingCaptures: 0,
      paginationGaps: 2,
      paginationSupplementedCount: 2,
      partialCaptures: 0,
      repositoryRedirects: 45,
      sourceFiles: 47,
      sourceRows: 1737,
      uniqueAnchors: 1737,
    });

    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-c6-graphql-inventory-replay-"),
    );
    try {
      const output = join(temporaryRoot, "inventory.json");
      const args = [
        `--source-root=${sourceRoot}`,
        `--tree-receipt=${treeReceipt}`,
        `--capture-root=${captureRoot}`,
        `--rest-supplement-root=${restSupplementRoot}`,
        `--expected-source-revision=${SOURCE_REVISION}`,
        `--expected-source-root-sha256=${SOURCE_ROOT_SHA256}`,
        `--expected-tree-receipt-sha256=${TREE_RECEIPT_SHA256}`,
        `--output=${output}`,
      ];
      const result =
        await runC6GitHubGraphQLDiscoveryInventorySnapshotCommand(args);

      expect(result.outputSha256).toBe(sha256(expectedBytes));
      await expect(
        runC6GitHubGraphQLDiscoveryInventorySnapshotCommand(args),
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
    throw new Error(`${name} is required for the C6 GraphQL replay gate`);
  }
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
