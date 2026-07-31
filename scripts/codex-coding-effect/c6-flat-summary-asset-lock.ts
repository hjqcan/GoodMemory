import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
} from "node:fs/promises";
import {
  join,
  relative,
} from "node:path";

import { z } from "zod";

import type {
  C6AssetLock,
  LoadedC6AssetLock,
} from "./c6-asset-lock";
import {
  assertC6NoSymlinkPathComponents,
  serializeC6AssetLock,
} from "./c6-asset-lock";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const assetFileSchema = z.object({
  bytes: z.number().int().nonnegative(),
  mode: z.number().int().min(0).max(0o777),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const assetLockSchema = z.object({
  assetRootSha256: sha256Schema,
  files: z.array(assetFileSchema).min(1),
  schemaVersion: z.literal(1),
}).strict();

export async function buildC6FlatSummaryAssetLock(
  root: string,
): Promise<C6AssetLock> {
  const resolvedRoot = await assertC6NoSymlinkPathComponents(
    root,
    "C6 flat-summary asset root",
  );
  if (!(await lstat(resolvedRoot)).isDirectory()) {
    throw new Error(
      "C6 flat-summary asset root must be a directory",
    );
  }
  const files = [];
  for (const absolutePath of await walk(resolvedRoot)) {
    const path = relative(resolvedRoot, absolutePath)
      .split("\\")
      .join("/");
    if (path === "asset-lock.json") {
      continue;
    }
    const file = await readStrictStableFile(
      absolutePath,
      "flat-summary asset closure",
    );
    files.push({
      bytes: file.bytes.byteLength,
      mode: file.mode,
      path,
      sha256: sha256(file.bytes),
    });
  }
  files.sort((left, right) =>
    compareCodeUnits(left.path, right.path)
  );
  return assetLockSchema.parse({
    assetRootSha256: sha256(JSON.stringify(files)),
    files,
    schemaVersion: 1,
  });
}

export async function loadC6FlatSummaryAssetLock(
  root: string,
): Promise<LoadedC6AssetLock> {
  const resolvedRoot = await assertC6NoSymlinkPathComponents(
    root,
    "C6 flat-summary asset root",
  );
  const bytes = (
    await readStrictStableFile(
      join(resolvedRoot, "asset-lock.json"),
      "flat-summary asset lock",
    )
  ).bytes;
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("invalid C6 flat-summary asset lock");
  }
  const parsed = assetLockSchema.safeParse(value);
  if (
    !parsed.success ||
    bytes.toString("utf8") !==
      serializeC6AssetLock(parsed.data)
  ) {
    throw new Error("invalid C6 flat-summary asset lock");
  }
  const current =
    await buildC6FlatSummaryAssetLock(resolvedRoot);
  if (
    serializeC6AssetLock(current) !==
      bytes.toString("utf8")
  ) {
    throw new Error(
      "C6 flat-summary asset lock does not match current assets",
    );
  }
  return {
    assetLock: parsed.data,
    assetLockSha256: sha256(bytes),
  };
}

export async function verifyC6FlatSummaryAssetClosure(
  root: string,
  expected: LoadedC6AssetLock,
): Promise<void> {
  try {
    const current =
      await loadC6FlatSummaryAssetLock(root);
    if (
      current.assetLockSha256 !==
        expected.assetLockSha256 ||
      serializeC6AssetLock(current.assetLock) !==
        serializeC6AssetLock(expected.assetLock)
    ) {
      throw new Error(
        "flat-summary asset closure identity changed",
      );
    }
  } catch {
    throw new Error(
      "C6 flat-summary asset closure changed",
    );
  }
}

async function walk(root: string): Promise<string[]> {
  const entries = await readdir(root, {
    withFileTypes: true,
  });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `C6 flat-summary asset closure rejects symlink ${path}`,
      );
    }
    if (entry.isDirectory()) {
      files.push(...await walk(path));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `C6 flat-summary asset closure rejects non-file ${path}`,
      );
    }
    files.push(path);
  }
  return files;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function readStrictStableFile(
  path: string,
  label: string,
): Promise<{ bytes: Buffer; mode: number }> {
  const resolvedPath = await assertC6NoSymlinkPathComponents(
    path,
    `C6 ${label}`,
  );
  const before = await lstat(resolvedPath);
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !== 1
  ) {
    throw new Error(
      `C6 ${label} must be one regular non-hard-linked file`,
    );
  }
  const handle = await open(
    resolvedPath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      !sameFileIdentity(before, opened)
    ) {
      throw new Error(
        `C6 ${label} changed before being read`,
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    await assertC6NoSymlinkPathComponents(
      resolvedPath,
      `C6 ${label}`,
    );
    const terminal = await lstat(resolvedPath);
    if (
      !after.isFile() ||
      after.nlink !== 1 ||
      !terminal.isFile() ||
      terminal.isSymbolicLink() ||
      terminal.nlink !== 1 ||
      !sameFileIdentity(opened, after) ||
      !sameFileIdentity(after, terminal) ||
      bytes.byteLength !== after.size
    ) {
      throw new Error(
        `C6 ${label} changed while being read`,
      );
    }
    return {
      bytes,
      mode: after.mode & 0o777,
    };
  } finally {
    await handle.close();
  }
}

function sameFileIdentity(
  left: {
    ctimeMs: number;
    dev: number;
    ino: number;
    mode: number;
    mtimeMs: number;
    nlink: number;
    size: number;
  },
  right: {
    ctimeMs: number;
    dev: number;
    ino: number;
    mode: number;
    mtimeMs: number;
    nlink: number;
    size: number;
  },
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.ctimeMs === right.ctimeMs &&
    left.mtimeMs === right.mtimeMs &&
    left.nlink === right.nlink
  );
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
