import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildC6RealHistoryYieldCensus,
  serializeC6RealHistoryYieldCensus,
} from "../../../scripts/codex-coding-effect/c6-real-history-yield";
import {
  runC6RealHistoryYieldSnapshotCommand,
} from "../../../scripts/snapshot-codex-coding-effect-c6-real-history-yield";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_ROOT =
  process.env.GOODMEMORY_TEST_C6_REAL_HISTORY_SOURCE_ROOT?.trim();
const CAPTURE_ROOT =
  process.env.GOODMEMORY_TEST_C6_REAL_HISTORY_CAPTURE_ROOT?.trim();
const maybeDescribe = SOURCE_ROOT && CAPTURE_ROOT ? describe : describe.skip;
const TREE_RECEIPT_SHA256 =
  "69b4797acb34252fcc726daf6d3e0480577017d9b8faf25b7dbd53f7f82e07b6";

setDefaultTimeout(120_000);

maybeDescribe("Codex coding-effect C6 real-history yield replay", () => {
  it("replays all 561 anchors byte-for-byte and refuses output overwrite", async () => {
    const sourceRoot = requiredExternalPath(
      SOURCE_ROOT,
      "GOODMEMORY_TEST_C6_REAL_HISTORY_SOURCE_ROOT",
    );
    const captureRoot = requiredExternalPath(
      CAPTURE_ROOT,
      "GOODMEMORY_TEST_C6_REAL_HISTORY_CAPTURE_ROOT",
    );
    const sourcePoolRoot = join(
      REPOSITORY_ROOT,
      "fixtures/codex-coding-effect/c6-source-pool",
    );
    const treeReceipt = join(
      sourcePoolRoot,
      "multi-swe-under-1mb-56ff018-receipts/hf-tree.json",
    );
    const artifactPath = join(
      sourcePoolRoot,
      "multi-swe-under-15mb-56ff018.real-history-yield.json",
    );
    const expectedBytes = await readFile(artifactPath);
    const census = await buildC6RealHistoryYieldCensus({
      captureRoot,
      expectedTreeReceiptSha256: TREE_RECEIPT_SHA256,
      maximumSourceFileBytes: 15_000_000,
      minimumRequiredEpisodes: 48,
      sourceRoot,
      treeReceiptPath: treeReceipt,
    });

    expect(serializeC6RealHistoryYieldCensus(census)).toBe(
      expectedBytes.toString("utf8"),
    );
    expect(census.boundary).toMatchObject({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
    });
    expect(census.quota).toEqual({
      feasibilityConclusion:
        "not-estimable-from-partial-review-signal-surface",
      minimumRealHistoryEpisodes: 48,
      observedGapToMinimum: 9,
      strictHeuristicSignals: 39,
    });

    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-c6-real-history-replay-"),
    );
    try {
      const output = join(temporaryRoot, "yield.json");
      const args = [
        `--source-root=${sourceRoot}`,
        `--tree-receipt=${treeReceipt}`,
        `--capture-root=${captureRoot}`,
        `--expected-tree-receipt-sha256=${TREE_RECEIPT_SHA256}`,
        "--maximum-source-file-bytes=15000000",
        "--minimum-required-episodes=48",
        `--output=${output}`,
      ];
      const result = await runC6RealHistoryYieldSnapshotCommand(args);

      expect(result.outputSha256).toBe(sha256(expectedBytes));
      await expect(
        runC6RealHistoryYieldSnapshotCommand(args),
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
    throw new Error(`${name} is required for the C6 real-history replay gate`);
  }
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
