import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
} from "node:fs/promises";
import {
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

import { z } from "zod";

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

export type C6AssetLock = z.infer<typeof assetLockSchema>;

export interface LoadedC6AssetLock {
  assetLock: C6AssetLock;
  assetLockSha256: string;
}

export async function buildC6AssetLock(root: string): Promise<C6AssetLock> {
  const resolvedRoot = await assertC6NoSymlinkPathComponents(
    root,
    "C6 asset root",
  );
  const rootStat = await lstat(resolvedRoot);
  if (!rootStat.isDirectory()) {
    throw new Error("C6 asset root must be a directory");
  }
  const files = [];
  for (const absolutePath of await walk(resolvedRoot)) {
    const path = relative(resolvedRoot, absolutePath).split("\\").join("/");
    if (path === "asset-lock.json") {
      continue;
    }
    const file = await readStableRegularFile(
      absolutePath,
      "C6 asset closure",
    );
    files.push({
      bytes: file.bytes.byteLength,
      mode: file.mode,
      path,
      sha256: sha256(file.bytes),
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return assetLockSchema.parse({
    assetRootSha256: sha256(JSON.stringify(files)),
    files,
    schemaVersion: 1,
  });
}

export async function loadC6AssetLock(root: string): Promise<{
  assetLock: C6AssetLock;
  assetLockSha256: string;
}> {
  const resolvedRoot = await assertC6NoSymlinkPathComponents(
    root,
    "C6 asset root",
  );
  const lockPath = join(resolvedRoot, "asset-lock.json");
  const stat = await lstat(lockPath);
  if (stat.isSymbolicLink()) {
    throw new Error(`C6 asset lock rejects symlink ${lockPath}`);
  }
  if (!stat.isFile()) {
    throw new Error("C6 asset lock must be a regular file");
  }
  const bytes = (
    await readStableRegularFile(lockPath, "C6 asset lock")
  ).bytes.toString("utf8");
  const parsed = assetLockSchema.safeParse(JSON.parse(bytes) as unknown);
  if (!parsed.success || bytes !== serializeC6AssetLock(parsed.data)) {
    throw new Error("invalid C6 asset lock");
  }
  const current = await buildC6AssetLock(root);
  if (serializeC6AssetLock(current) !== bytes) {
    throw new Error("C6 asset lock does not match current assets");
  }
  return {
    assetLock: parsed.data,
    assetLockSha256: sha256(bytes),
  };
}

export async function verifyC6AssetClosure(
  root: string,
  expected: LoadedC6AssetLock,
): Promise<void> {
  try {
    const current = await loadC6AssetLock(root);
    if (
      current.assetLockSha256 !== expected.assetLockSha256 ||
      serializeC6AssetLock(current.assetLock) !==
        serializeC6AssetLock(expected.assetLock)
    ) {
      throw new Error("asset closure identity changed");
    }
  } catch {
    throw new Error("C6 asset closure changed during preflight");
  }
}

export async function readC6StableRegularFile(
  path: string,
  label: string,
  maxBytes?: number,
  rejectHardLinks = false,
): Promise<Buffer> {
  const resolvedPath = await assertC6NoSymlinkPathComponents(
    path,
    `C6 ${label}`,
  );
  return (
    await readStableRegularFile(
      resolvedPath,
      `C6 ${label}`,
      maxBytes,
      rejectHardLinks,
    )
  ).bytes;
}

export function serializeC6AssetLock(assetLock: C6AssetLock): string {
  return `${JSON.stringify(assetLock, null, 2)}\n`;
}

async function walk(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`C6 asset closure rejects symlink ${path}`);
    }
    if (entry.isDirectory()) {
      files.push(...await walk(path));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`C6 asset closure rejects non-file ${path}`);
    }
    files.push(path);
  }
  return files;
}

export async function assertC6NoSymlinkPathComponents(
  path: string,
  label: string,
): Promise<string> {
  const resolvedPath = resolve(path);
  const root = parse(resolvedPath).root;
  let current = root;
  for (const component of relative(root, resolvedPath).split(sep)) {
    if (component.length === 0) {
      continue;
    }
    current = join(current, component);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error(`${label} rejects symlink path component ${current}`);
    }
  }
  return resolvedPath;
}

async function readStableRegularFile(
  path: string,
  label: string,
  maxBytes?: number,
  rejectHardLinks = false,
): Promise<{ bytes: Buffer; mode: number }> {
  const before = await lstat(path);
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    (rejectHardLinks && before.nlink !== 1)
  ) {
    throw new Error(
      rejectHardLinks
        ? `${label} must be one regular non-hard-linked file`
        : `${label} must be one regular file`,
    );
  }
  if (
    maxBytes !== undefined &&
    before.size > maxBytes
  ) {
    throw new Error(`${label} exceeds byte limit`);
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      (rejectHardLinks && opened.nlink !== 1) ||
      !sameFileIdentity(before, opened)
    ) {
      throw new Error(`${label} changed before being read ${path}`);
    }
    if (
      maxBytes !== undefined &&
      opened.size > maxBytes
    ) {
      throw new Error(`${label} exceeds byte limit`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    await assertC6NoSymlinkPathComponents(path, label);
    const terminal = await lstat(path);
    if (
      !after.isFile() ||
      (rejectHardLinks && after.nlink !== 1) ||
      !terminal.isFile() ||
      terminal.isSymbolicLink() ||
      (rejectHardLinks && terminal.nlink !== 1) ||
      !sameFileIdentity(opened, after) ||
      !sameFileIdentity(after, terminal) ||
      bytes.byteLength !== after.size
    ) {
      throw new Error(`${label} changed while being read ${path}`);
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
