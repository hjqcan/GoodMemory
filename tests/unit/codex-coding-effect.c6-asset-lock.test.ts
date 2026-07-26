import { describe, expect, it } from "bun:test";
import {
  chmod,
  link,
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildC6AssetLock,
  loadC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
  verifyC6AssetClosure,
} from "../../scripts/codex-coding-effect/c6-asset-lock";

describe("Codex coding-effect C6 asset lock", () => {
  it("binds every regular candidate asset and rejects later drift", async () => {
    const root = await createTempDirectory("goodmemory-c6-assets-");
    try {
      await mkdir(join(root, "prompts"), { recursive: true });
      await writeFile(join(root, "manifest.json"), "{}\n");
      await writeFile(join(root, "prompts", "task.md"), "Fix the task.\n");
      const lock = await buildC6AssetLock(root);
      await writeFile(
        join(root, "asset-lock.json"),
        serializeC6AssetLock(lock),
      );

      const loaded = await loadC6AssetLock(root);
      expect(loaded.assetLock.files.map((file) => file.path)).toEqual([
        "manifest.json",
        "prompts/task.md",
      ]);
      expect(loaded.assetLock.assetRootSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(loaded.assetLockSha256).toMatch(/^[a-f0-9]{64}$/u);
      await expect(
        verifyC6AssetClosure(root, loaded),
      ).resolves.toBeUndefined();

      await writeFile(join(root, "prompts", "task.md"), "Drifted task.\n");
      await expect(verifyC6AssetClosure(root, loaded)).rejects.toThrow(
        "C6 asset closure changed during preflight",
      );
      await expect(loadC6AssetLock(root)).rejects.toThrow(
        "C6 asset lock does not match current assets",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("binds executable mode as part of the candidate asset closure", async () => {
    const root = await createTempDirectory("goodmemory-c6-mode-");
    try {
      const scriptPath = join(root, "runner.sh");
      await writeFile(scriptPath, "#!/bin/sh\nexit 0\n");
      await chmod(scriptPath, 0o755);
      await writeFile(
        join(root, "asset-lock.json"),
        serializeC6AssetLock(await buildC6AssetLock(root)),
      );

      await chmod(scriptPath, 0o644);
      await expect(loadC6AssetLock(root)).rejects.toThrow(
        "C6 asset lock does not match current assets",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a symlinked asset-lock receipt", async () => {
    const root = await createTempDirectory("goodmemory-c6-lock-link-");
    const receiptRoot = await createTempDirectory(
      "goodmemory-c6-lock-receipt-",
    );
    try {
      await writeFile(join(root, "manifest.json"), "{}\n");
      const receiptPath = join(receiptRoot, "asset-lock.json");
      await writeFile(
        receiptPath,
        serializeC6AssetLock(await buildC6AssetLock(root)),
      );
      await symlink(receiptPath, join(root, "asset-lock.json"));

      await expect(loadC6AssetLock(root)).rejects.toThrow(
        "C6 asset lock rejects symlink",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(receiptRoot, { force: true, recursive: true });
    }
  });

  it("rejects a symlinked dataset root or ancestor", async () => {
    const container = await createTempDirectory("goodmemory-c6-root-link-");
    const physicalParent = join(container, "physical");
    const physicalRoot = join(physicalParent, "dataset");
    const rootAlias = join(container, "dataset-link");
    const parentAlias = join(container, "parent-link");
    try {
      await mkdir(physicalRoot, { recursive: true });
      await writeFile(join(physicalRoot, "manifest.json"), "{}\n");
      await Promise.all([
        symlink(physicalRoot, rootAlias),
        symlink(physicalParent, parentAlias),
      ]);

      await expect(buildC6AssetLock(rootAlias)).rejects.toThrow(
        "C6 asset root rejects symlink path component",
      );
      await expect(
        buildC6AssetLock(join(parentAlias, "dataset")),
      ).rejects.toThrow(
        "C6 asset root rejects symlink path component",
      );
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  });

  it("rejects a regular file reached through a symlinked parent", async () => {
    const container = await createTempDirectory(
      "goodmemory-c6-file-parent-link-",
    );
    const physical = join(container, "physical");
    const alias = join(container, "alias");
    try {
      await mkdir(physical);
      await writeFile(join(physical, "input.json"), "{}\n");
      await symlink(physical, alias);

      await expect(readC6StableRegularFile(
        join(alias, "input.json"),
        "external input",
      )).rejects.toThrow(
        "C6 external input rejects symlink path component",
      );
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  });

  it("rejects a stable file before reading bytes beyond a caller limit", async () => {
    const root = await createTempDirectory(
      "goodmemory-c6-bounded-file-",
    );
    try {
      const path = join(root, "archive.tar.gz");
      await writeFile(path, Buffer.alloc(1_024));

      await expect(
        readC6StableRegularFile(
          path,
          "bounded archive",
          512,
        ),
      ).rejects.toThrow(
        "C6 bounded archive exceeds byte limit",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("preserves legacy atomic hard-link publication by default and rejects it in strict reads", async () => {
    const root = await createTempDirectory(
      "goodmemory-c6-hard-linked-file-",
    );
    try {
      const source = join(root, "source.json");
      const alias = join(root, "alias.json");
      await writeFile(source, "{}\n");
      await link(source, alias);

      expect(
        await readC6StableRegularFile(alias, "published input"),
      ).toEqual(Buffer.from("{}\n"));
      await expect(
        readC6StableRegularFile(
          alias,
          "hard-linked input",
          undefined,
          true,
        ),
      ).rejects.toThrow(
        "must be one regular non-hard-linked file",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

async function createTempDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(await realpath(tmpdir()), prefix));
}
