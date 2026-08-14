import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
} from "node:fs/promises";
import {
  join,
  posix,
} from "node:path";

export interface ProofFileRef {
  bytes: number;
  path: string;
  sha256: string;
}

export async function buildProofFileRef(
  root: string,
  path: string,
): Promise<ProofFileRef> {
  const normalizedPath = normalizeProofPath(path);
  const bytes = await readProofFile(root, normalizedPath);
  return {
    bytes: bytes.byteLength,
    path: normalizedPath,
    sha256: sha256(bytes),
  };
}

export async function buildProofFileClosure(
  root: string,
): Promise<ProofFileRef[]> {
  await assertProofRoot(root);
  const paths = await walkProofRoot(root);
  const files = await Promise.all(
    paths.map((path) => buildProofFileRef(root, path)),
  );
  return files.sort((left, right) => compareUtf8(left.path, right.path));
}

export async function verifyProofFileClosure(
  root: string,
  expected: readonly ProofFileRef[],
): Promise<ProofFileRef[]> {
  const expectedFiles = [...expected]
    .map(validateProofFileRef)
    .sort((left, right) => compareUtf8(left.path, right.path));
  const duplicate = expectedFiles.find(
    (file, index) => file.path === expectedFiles[index - 1]?.path,
  );
  if (duplicate !== undefined) {
    throw new Error(`proof closure contains duplicate path ${duplicate.path}`);
  }
  const observed = await buildProofFileClosure(root);
  if (observed.length !== expectedFiles.length) {
    throw new Error("proof closure path set mismatch");
  }
  for (const [index, file] of observed.entries()) {
    const expectedFile = expectedFiles[index];
    if (
      expectedFile === undefined ||
      file.path !== expectedFile.path
    ) {
      throw new Error("proof closure path set mismatch");
    }
    if (
      file.bytes !== expectedFile.bytes ||
      file.sha256 !== expectedFile.sha256
    ) {
      throw new Error(`proof closure byte identity mismatch for ${file.path}`);
    }
  }
  return observed;
}

async function readProofFile(root: string, path: string): Promise<Buffer> {
  await assertProofRoot(root);
  const absolutePath = join(root, ...path.split("/"));
  await assertNoSymlinkComponents(root, path);
  const before = await lstat(absolutePath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`proof closure rejects non-regular file ${path}`);
  }
  const handle = await open(
    absolutePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFile(before, opened)) {
      throw new Error(`proof file changed before read ${path}`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      !sameFile(opened, after) ||
      bytes.byteLength !== after.size
    ) {
      throw new Error(`proof file changed while read ${path}`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function assertProofRoot(root: string): Promise<void> {
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("proof root must be a non-symlink directory");
  }
}

async function assertNoSymlinkComponents(
  root: string,
  path: string,
): Promise<void> {
  let current = root;
  for (const component of path.split("/")) {
    current = join(current, component);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error(`proof closure rejects symlink ${path}`);
    }
  }
}

async function walkProofRoot(
  root: string,
  prefix = "",
): Promise<string[]> {
  const directory = prefix === ""
    ? root
    : join(root, ...prefix.split("/"));
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = prefix === ""
      ? entry.name
      : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(`proof closure rejects symlink ${path}`);
    }
    if (entry.isDirectory()) {
      paths.push(...await walkProofRoot(root, path));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`proof closure rejects non-file ${path}`);
    }
    paths.push(normalizeProofPath(path));
  }
  return paths.sort(compareUtf8);
}

function normalizeProofPath(path: string): string {
  if (
    path.length === 0 ||
    path.includes("\\") ||
    path.includes("\0") ||
    posix.isAbsolute(path) ||
    posix.normalize(path) !== path ||
    path.split("/").some(
      (component) => component === "" || component === "." || component === "..",
    )
  ) {
    throw new Error(`invalid proof-relative path ${JSON.stringify(path)}`);
  }
  return path;
}

function validateProofFileRef(file: ProofFileRef): ProofFileRef {
  if (
    !Number.isSafeInteger(file.bytes) ||
    file.bytes < 0 ||
    !/^[a-f0-9]{64}$/u.test(file.sha256)
  ) {
    throw new Error(`invalid proof file identity for ${file.path}`);
  }
  return {
    bytes: file.bytes,
    path: normalizeProofPath(file.path),
    sha256: file.sha256,
  };
}

function sameFile(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
