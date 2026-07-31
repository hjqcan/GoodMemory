import {
  link,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  buildC6FlatSummaryAssetLock,
  loadC6FlatSummaryAssetLock,
  verifyC6FlatSummaryAssetClosure,
} from "../../scripts/codex-coding-effect/c6-flat-summary-asset-lock";
import {
  serializeC6AssetLock,
} from "../../scripts/codex-coding-effect/c6-asset-lock";

describe("Codex coding-effect C6 flat-summary asset lock", () => {
  it("uses code-unit ordering and rejects hard-linked closure assets", async () => {
    const root = await createTempDirectory(
      "goodmemory-c6-flat-asset-order-",
    );
    const externalRoot = await createTempDirectory(
      "goodmemory-c6-flat-asset-external-",
    );
    const originalLocaleCompare = String.prototype.localeCompare;
    try {
      await Promise.all([
        writeFile(join(root, "z.json"), "{}\n"),
        writeFile(join(root, "a.json"), "{}\n"),
        writeFile(join(root, "b.json"), "{}\n"),
      ]);
      String.prototype.localeCompare = () => {
        throw new Error("locale ordering is forbidden");
      };
      const lock = await buildC6FlatSummaryAssetLock(root);
      expect(lock.files.map(({ path }) => path)).toEqual([
        "a.json",
        "b.json",
        "z.json",
      ]);

      await link(
        join(root, "a.json"),
        join(externalRoot, "a-alias.json"),
      );
      await expect(
        buildC6FlatSummaryAssetLock(root),
      ).rejects.toThrow(
        "must be one regular non-hard-linked file",
      );
    } finally {
      String.prototype.localeCompare = originalLocaleCompare;
      await rm(root, { force: true, recursive: true });
      await rm(externalRoot, { force: true, recursive: true });
    }
  });

  it("rejects hard links added to the lock or closure after sealing", async () => {
    const root = await createTempDirectory(
      "goodmemory-c6-flat-asset-verify-",
    );
    const lockRoot = await createTempDirectory(
      "goodmemory-c6-flat-lock-external-",
    );
    const externalRoot = await createTempDirectory(
      "goodmemory-c6-flat-closure-external-",
    );
    try {
      const assetPath = join(root, "manifest.json");
      const lockPath = join(root, "asset-lock.json");
      await writeFile(assetPath, "{}\n");
      const lock = await buildC6FlatSummaryAssetLock(root);
      await writeFile(lockPath, serializeC6AssetLock(lock));
      const loaded = await loadC6FlatSummaryAssetLock(root);

      await link(
        assetPath,
        join(externalRoot, "manifest-alias.json"),
      );
      await expect(
        loadC6FlatSummaryAssetLock(root),
      ).rejects.toThrow(
        "must be one regular non-hard-linked file",
      );
      await expect(
        verifyC6FlatSummaryAssetClosure(root, loaded),
      ).rejects.toThrow(
        "C6 flat-summary asset closure changed",
      );
      await rm(
        join(externalRoot, "manifest-alias.json"),
      );

      await link(
        lockPath,
        join(lockRoot, "asset-lock.json"),
      );
      await expect(
        loadC6FlatSummaryAssetLock(root),
      ).rejects.toThrow(
        "must be one regular non-hard-linked file",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(lockRoot, { force: true, recursive: true });
      await rm(externalRoot, { force: true, recursive: true });
    }
  });
});

async function createTempDirectory(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}
