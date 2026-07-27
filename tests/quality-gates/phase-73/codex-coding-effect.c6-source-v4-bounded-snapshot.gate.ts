import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  join,
} from "node:path";

import { describe, expect, it } from "bun:test";

import {
  buildC6AssetLock,
  serializeC6AssetLock,
} from "../../../scripts/codex-coding-effect/c6-asset-lock";
import {
  buildC6SourceV4BoundedCapturePlan,
  replayC6SourceV4BoundedCapture,
} from "../../../scripts/codex-coding-effect/c6-source-v4-bounded-replay";
import {
  loadC6SourceV4BoundedSnapshot,
} from "../../../scripts/codex-coding-effect/c6-source-v4-bounded-snapshot";

const SNAPSHOT_ROOT =
  process.env
    .GOODMEMORY_TEST_C6_SOURCE_V4_BOUNDED_SNAPSHOT_ROOT
    ?.trim() || undefined;
const maybeDescribe = SNAPSHOT_ROOT === undefined
  ? describe.skip
  : describe;

maybeDescribe("Phase 73 C6 source-v4 bounded snapshot", () => {
  it("revalidates the complete asset-locked selection snapshot", async () => {
    const snapshot =
      await loadC6SourceV4BoundedSnapshot(
        SNAPSHOT_ROOT!,
      );

    expect(snapshot.manifest.boundary).toEqual({
      candidateManifestFrozen: false,
      codexRunReady: false,
      independentReviewAccepted: false,
      liveCaptureAuthorized: false,
      selectionMaterialized: true,
      status:
        "asset-locked-selection-snapshot-review-and-freeze-pending",
    });
    expect(
      snapshot.v3Reuse.frameRepositories,
    ).toHaveLength(191_604);
    expect(
      snapshot.v3Reuse.pilotRepositoryNodeIds,
    ).toHaveLength(3_578);
    expect(
      snapshot.selectionReceipt.receipt
        .selectedRepositories,
    ).toHaveLength(16_384);
    expect(snapshot.assetLock.assetLock.files).toHaveLength(
      12,
    );
    expect(snapshot.assetBytes).toBeLessThanOrEqual(
      6 * 1_024 ** 3,
    );
    const capturePlan =
      buildC6SourceV4BoundedCapturePlan(snapshot);
    expect(capturePlan.selectedRepositories)
      .toHaveLength(16_384);
    expect(
      Object.keys(
        capturePlan.selectedRepositories[0]!,
      ),
    ).toEqual([
      "createdAt",
      "id",
      "isArchived",
      "isFork",
      "isMirror",
      "isTemplate",
      "leafCreatedFrom",
      "leafCreatedTo",
      "nameWithOwner",
      "primaryLanguage",
      "pushedAt",
      "repositoryNodeId",
      "repositoryRankSha256",
      "rootShardId",
      "selectionRank",
      "sourceSplit",
      "visibility",
    ]);
    await expect(
      replayC6SourceV4BoundedCapture({
        requests: [],
        snapshot,
      }),
    ).rejects.toThrow("ledger exhausted");
  }, 300_000);

  it("rejects request substitution, manifest drift, and extra files after the asset lock is rebuilt", async () => {
    await withSnapshotClone(async (root) => {
      const path = join(
        root,
        "v3-committed-request-entries.json",
      );
      const entries = JSON.parse(
        await readFile(path, "utf8"),
      ) as Array<{
        request: unknown;
      }>;
      expect(hashJson(entries[0]!.request)).not.toBe(
        hashJson(entries[1]!.request),
      );
      entries[0]!.request = entries[1]!.request;
      await writeFile(path, canonicalJson(entries));
      await rebuildAssetLock(root);

      await expect(
        loadC6SourceV4BoundedSnapshot(root),
      ).rejects.toThrow("payload hash mismatch");
    });

    await withSnapshotClone(async (root) => {
      const path = join(
        root,
        "snapshot-manifest.json",
      );
      const manifest = JSON.parse(
        await readFile(path, "utf8"),
      ) as {
        historicalV3: {
          frozenInputClosure: {
            bytes: number;
          };
        };
      };
      manifest.historicalV3
        .frozenInputClosure.bytes = 1;
      await writeFile(path, canonicalJson(manifest));
      await rebuildAssetLock(root);

      await expect(
        loadC6SourceV4BoundedSnapshot(root),
      ).rejects.toThrow("observed closure mismatch");
    });

    await withSnapshotClone(async (root) => {
      await writeFile(
        join(root, "hidden-outcome.json"),
        "{}\n",
      );
      await rebuildAssetLock(root);

      await expect(
        loadC6SourceV4BoundedSnapshot(root),
      ).rejects.toThrow("root entry set mismatch");
    });
  }, 300_000);

  it("rejects an in-memory cohort substitution after snapshot verification", async () => {
    const snapshot =
      await loadC6SourceV4BoundedSnapshot(
        SNAPSHOT_ROOT!,
      );
    const selected =
      snapshot.selectionReceipt.receipt
        .selectedRepositories;
    const first = selected[0]!;
    const selectedNodeIds = new Set(
      selected.map(
        (repository) =>
          repository.repositoryNodeId,
      ),
    );
    const replacement =
      snapshot.v3Reuse.frameRepositories.find(
        (repository) =>
          repository.sourceSplit ===
            first.sourceSplit &&
          !selectedNodeIds.has(
            repository.repositoryNodeId,
          ),
    );
    expect(replacement).toBeDefined();
    expect(() =>
      selected[0] = {
        ...first,
        repositoryNodeId:
          replacement!.repositoryNodeId,
      }
    ).toThrow();
    expect(
      buildC6SourceV4BoundedCapturePlan(
        snapshot,
      ).selectedRepositories[0]
        ?.repositoryNodeId,
    ).toBe(first.repositoryNodeId);
  }, 300_000);

  it("rejects attempts to rewrite the loaded asset identity", async () => {
    const snapshot =
      await loadC6SourceV4BoundedSnapshot(
        SNAPSHOT_ROOT!,
      );
    const originalRoot =
      snapshot.assetLock.assetLock
        .assetRootSha256;
    const originalLock =
      snapshot.assetLock.assetLockSha256;

    expect(() =>
      snapshot.assetLock.assetLock
        .assetRootSha256 = "f".repeat(64)
    ).toThrow();
    expect(() =>
      snapshot.assetLock.assetLockSha256 =
        "f".repeat(64)
    ).toThrow();
    expect(() =>
      snapshot.assetBytes = 0
    ).toThrow();
    expect(
      buildC6SourceV4BoundedCapturePlan(
        snapshot,
      ).identity,
    ).toMatchObject({
      assetLockSha256: originalLock,
      assetRootSha256: originalRoot,
    });
  }, 300_000);

  it("does not allow accessor substitution on a loaded snapshot", async () => {
    const snapshot =
      await loadC6SourceV4BoundedSnapshot(
        SNAPSHOT_ROOT!,
      );

    expect(() =>
      Object.defineProperty(
        snapshot.assetLock,
        "assetLockSha256",
        {
          get: () => "f".repeat(64),
        },
      )
    ).toThrow();
  }, 300_000);
});

async function withSnapshotClone(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const parent = await mkdtemp(join(
    dirname(SNAPSHOT_ROOT!),
    ".c6-source-v4-bounded-gate-",
  ));
  const root = join(parent, "snapshot");
  try {
    await cp(SNAPSHOT_ROOT!, root, {
      mode: constants.COPYFILE_FICLONE,
      recursive: true,
    });
    await run(root);
  } finally {
    await rm(parent, {
      force: true,
      recursive: true,
    });
  }
}

async function rebuildAssetLock(
  root: string,
): Promise<void> {
  await writeFile(
    join(root, "asset-lock.json"),
    serializeC6AssetLock(
      await buildC6AssetLock(root),
    ),
  );
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function hashJson(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
