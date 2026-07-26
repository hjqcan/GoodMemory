import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readlink,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
  posix,
  relative,
  resolve,
} from "node:path";

import { z } from "zod";

import { readC6StableRegularFile } from "./c6-asset-lock";
import {
  assertDirectoryIdentity,
  canonicalExistingDirectory,
  canonicalNewFilePath,
  directoryIdentity,
  writeAtomicExclusive,
} from "./c6-package-source-artifact-publication";

const gitOidSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
const packageSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
}).passthrough();
const COMMAND_TIMEOUT_MS = 30_000;

export interface C6PackageSourceArchiveResult {
  archiveSha256: string;
  bunLockSha256: string;
  commitSha: string;
  entryCount: number;
  entryManifest: string;
  entryManifestSha256: string;
  packageJsonSha256: string;
  treeSha: string;
}

export async function createC6PackageSourceArchive(input: {
  archivePath: string;
  expectedCommitSha: string;
  expectedTreeSha: string;
  manifestPath: string;
  repositoryRoot: string;
}): Promise<C6PackageSourceArchiveResult> {
  const expectedCommitSha = gitOidSchema.parse(input.expectedCommitSha);
  const expectedTreeSha = gitOidSchema.parse(input.expectedTreeSha);
  const repositoryRoot = await canonicalExistingDirectory(
    input.repositoryRoot,
    "source repository root",
  );
  const repositoryIdentity = await directoryIdentity(repositoryRoot);
  const archivePath = await canonicalNewFilePath(
    input.archivePath,
    "source archive",
  );
  const manifestPath = await canonicalNewFilePath(
    input.manifestPath,
    "source entry manifest",
  );
  if (archivePath === manifestPath) {
    throw new Error(
      "C6 source archive and entry manifest paths must be distinct",
    );
  }

  const gitIdentity = await readExactGitIdentity({
    expectedCommitSha,
    expectedTreeSha,
    repositoryRoot,
  });
  const temporaryRoot = await mkdtemp(join(
    await realpath(tmpdir()),
    "goodmemory-c6-source-archive-",
  ));
  let archivePublished = false;
  let manifestPublished = false;
  try {
    const firstArchivePath = join(temporaryRoot, "source-1.tar");
    const secondArchivePath = join(temporaryRoot, "source-2.tar");
    await createGitArchive(
      repositoryRoot,
      gitIdentity.commitSha,
      firstArchivePath,
    );
    await createGitArchive(
      repositoryRoot,
      gitIdentity.commitSha,
      secondArchivePath,
    );
    const [firstArchive, secondArchive] = await Promise.all([
      readC6StableRegularFile(
        firstArchivePath,
        "first exact-commit source archive",
      ),
      readC6StableRegularFile(
        secondArchivePath,
        "second exact-commit source archive",
      ),
    ]);
    if (
      firstArchive.byteLength !== secondArchive.byteLength ||
      !firstArchive.equals(secondArchive)
    ) {
      throw new Error(
        "C6 exact-commit git archive is not byte reproducible",
      );
    }

    const extractedRoot = join(temporaryRoot, "extracted");
    await mkdir(extractedRoot, { mode: 0o700 });
    await runCommand(
      ["tar", "-xf", firstArchivePath, "-C", extractedRoot],
      "source archive extraction",
    );
    const sourceTree = await buildSourceEntryManifest(extractedRoot);
    if (sourceTree.entryCount !== gitIdentity.entryCount) {
      throw new Error(
        "C6 source archive entry count does not match the exact Git tree",
      );
    }
    const [bunLock, packageJson] = await Promise.all([
      readStableSourceFile(
        join(extractedRoot, "bun.lock"),
        "source bun.lock",
      ),
      readStableSourceFile(
        join(extractedRoot, "package.json"),
        "source package.json",
      ),
    ]);
    packageSchema.parse(parseJsonText(
      packageJson.bytes.toString("utf8"),
      "source package.json",
    ));

    await assertDirectoryIdentity(
      repositoryRoot,
      repositoryIdentity,
      "source repository root",
    );
    const finalGitIdentity = await readExactGitIdentity({
      expectedCommitSha,
      expectedTreeSha,
      repositoryRoot,
    });
    if (!sameJson(gitIdentity, finalGitIdentity)) {
      throw new Error("C6 exact Git source identity drifted");
    }

    await writeAtomicExclusive(archivePath, firstArchive, 0o600);
    archivePublished = true;
    await writeAtomicExclusive(
      manifestPath,
      sourceTree.manifest,
      0o600,
    );
    manifestPublished = true;
    const [publishedArchive, publishedManifest] = await Promise.all([
      readC6StableRegularFile(
        archivePath,
        "published exact-commit source archive",
      ),
      readC6StableRegularFile(
        manifestPath,
        "published source entry manifest",
      ),
    ]);
    if (
      !publishedArchive.equals(firstArchive) ||
      publishedManifest.toString("utf8") !== sourceTree.manifest
    ) {
      throw new Error("C6 published source artifacts drifted");
    }
    return {
      archiveSha256: sha256(firstArchive),
      bunLockSha256: sha256(bunLock.bytes),
      commitSha: gitIdentity.commitSha,
      entryCount: sourceTree.entryCount,
      entryManifest: sourceTree.manifest,
      entryManifestSha256: sha256(sourceTree.manifest),
      packageJsonSha256: sha256(packageJson.bytes),
      treeSha: gitIdentity.treeSha,
    };
  } catch (error) {
    if (manifestPublished) {
      await rm(manifestPath, { force: true });
    }
    if (archivePublished) {
      await rm(archivePath, { force: true });
    }
    throw error;
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}


interface GitIdentity {
  commitSha: string;
  entryCount: number;
  treeSha: string;
}

async function readExactGitIdentity(input: {
  expectedCommitSha: string;
  expectedTreeSha: string;
  repositoryRoot: string;
}): Promise<GitIdentity> {
  const topLevel = (
    await runCommand(
      ["git", "-C", input.repositoryRoot, "rev-parse", "--show-toplevel"],
      "Git source top-level resolution",
    )
  ).stdout.trim();
  if (await realpath(topLevel) !== input.repositoryRoot) {
    throw new Error("C6 source repository root is not the Git top level");
  }
  const commitSha = (
    await runCommand(
      [
        "git",
        "-C",
        input.repositoryRoot,
        "rev-parse",
        "--verify",
        `${input.expectedCommitSha}^{commit}`,
      ],
      "exact Git commit resolution",
    )
  ).stdout.trim();
  const treeSha = (
    await runCommand(
      [
        "git",
        "-C",
        input.repositoryRoot,
        "rev-parse",
        `${input.expectedCommitSha}^{tree}`,
      ],
      "exact Git tree resolution",
    )
  ).stdout.trim();
  if (
    commitSha !== input.expectedCommitSha ||
    treeSha !== input.expectedTreeSha
  ) {
    throw new Error("C6 exact Git commit or tree identity does not match");
  }
  const treeListing = (
    await runCommand(
      [
        "git",
        "-C",
        input.repositoryRoot,
        "ls-tree",
        "-r",
        "-z",
        commitSha,
      ],
      "exact Git tree entry listing",
    )
  ).stdout;
  const records = treeListing.split("\0");
  if (records.at(-1) !== "") {
    throw new Error("C6 exact Git tree listing is not NUL terminated");
  }
  records.pop();
  for (const record of records) {
    const separator = record.indexOf("\t");
    const metadata = separator < 0 ? "" : record.slice(0, separator);
    const path = separator < 0 ? "" : record.slice(separator + 1);
    const mode = metadata.split(" ", 1)[0];
    if (
      !["100644", "100755", "120000"].includes(mode) ||
      !isSafeGitPath(path)
    ) {
      throw new Error(
        "C6 exact Git tree contains an unsupported entry or path",
      );
    }
  }
  if (records.length === 0) {
    throw new Error("C6 exact Git source tree must not be empty");
  }
  return { commitSha, entryCount: records.length, treeSha };
}

async function createGitArchive(
  repositoryRoot: string,
  commitSha: string,
  outputPath: string,
): Promise<void> {
  await runCommand(
    [
      "git",
      "-C",
      repositoryRoot,
      "archive",
      "--format=tar",
      `--output=${outputPath}`,
      commitSha,
    ],
    "exact-commit Git archive",
  );
}

export interface SourceTreeManifest {
  entries: SourceManifestEntry[];
  entryCount: number;
  manifest: string;
}

export async function buildSourceEntryManifest(
  root: string,
): Promise<SourceTreeManifest> {
  const canonicalRoot = await canonicalExistingDirectory(
    root,
    "extracted source root",
  );
  const entries: SourceManifestEntry[] = [];
  await walkSourceTree(canonicalRoot, canonicalRoot, entries);
  entries.sort((left, right) => compareUtf8(left.path, right.path));
  if (entries.length === 0) {
    throw new Error("C6 extracted source tree must not be empty");
  }
  return {
    entries,
    entryCount: entries.length,
    manifest: entries.map((entry) => JSON.stringify(entry)).join("\n") +
      "\n",
  };
}

export type SourceManifestEntry =
  | {
    mode: "100644" | "100755";
    path: string;
    sha256: string;
    size: number;
    type: "file";
  }
  | {
    mode: "120000";
    path: string;
    target: string;
    type: "symlink";
  };

interface GitTreeNode {
  children: Map<string, GitTreeNode | {
    kind: "blob";
    mode: "100644" | "100755" | "120000";
    oid: Buffer;
  }>;
  kind: "tree";
}

export async function computeGitTreeOid(
  root: string,
  entries: readonly SourceManifestEntry[],
  algorithm: "sha1" | "sha256",
): Promise<string> {
  const tree: GitTreeNode = {
    children: new Map(),
    kind: "tree",
  };
  for (const entry of entries) {
    const components = entry.path.split("/");
    let directory = tree;
    for (const component of components.slice(0, -1)) {
      const existing = directory.children.get(component);
      if (existing === undefined) {
        const child: GitTreeNode = {
          children: new Map(),
          kind: "tree",
        };
        directory.children.set(component, child);
        directory = child;
      } else if (existing.kind === "tree") {
        directory = existing;
      } else {
        throw new Error(
          "C6 package source persisted archive tree is inconsistent",
        );
      }
    }
    const name = components.at(-1)!;
    if (directory.children.has(name)) {
      throw new Error(
        "C6 package source persisted archive tree is inconsistent",
      );
    }
    const bytes = entry.type === "symlink"
      ? Buffer.from(entry.target)
      : (
        await readStableSourceFile(
          join(root, entry.path),
          `persisted Git tree entry ${entry.path}`,
        )
      ).bytes;
    directory.children.set(name, {
      kind: "blob",
      mode: entry.mode,
      oid: gitObjectOid(algorithm, "blob", bytes),
    });
  }
  return gitTreeOid(algorithm, tree).toString("hex");
}

function gitTreeOid(
  algorithm: "sha1" | "sha256",
  tree: GitTreeNode,
): Buffer {
  const entries = [...tree.children.entries()]
    .map(([name, child]) => ({
      child,
      name,
      sortKey: `${name}${child.kind === "tree" ? "/" : ""}`,
    }))
    .sort((left, right) => compareUtf8(left.sortKey, right.sortKey));
  const body = Buffer.concat(entries.flatMap(({ child, name }) => {
    const mode = child.kind === "tree" ? "40000" : child.mode;
    const oid = child.kind === "tree"
      ? gitTreeOid(algorithm, child)
      : child.oid;
    return [Buffer.from(`${mode} ${name}\0`), oid];
  }));
  return gitObjectOid(algorithm, "tree", body);
}

function gitObjectOid(
  algorithm: "sha1" | "sha256",
  type: "blob" | "tree",
  bytes: Uint8Array,
): Buffer {
  return createHash(algorithm)
    .update(`${type} ${bytes.byteLength}\0`)
    .update(bytes)
    .digest();
}

async function walkSourceTree(
  root: string,
  directory: string,
  output: SourceManifestEntry[],
): Promise<void> {
  const directoryEntries = await readdir(directory, {
    withFileTypes: true,
  });
  directoryEntries.sort((left, right) =>
    compareUtf8(left.name, right.name)
  );
  for (const directoryEntry of directoryEntries) {
    const path = join(directory, directoryEntry.name);
    const pathFromRoot = relative(root, path).split("\\").join("/");
    if (!isSafeGitPath(pathFromRoot)) {
      throw new Error(`C6 extracted source rejects path ${pathFromRoot}`);
    }
    const stat = await lstat(path);
    if (stat.isDirectory()) {
      await walkSourceTree(root, path, output);
      continue;
    }
    if (stat.isSymbolicLink()) {
      const target = await readlink(path);
      assertSafeSourceSymlink(root, path, target);
      const after = await lstat(path);
      if (
        !after.isSymbolicLink() ||
        await readlink(path) !== target ||
        after.dev !== stat.dev ||
        after.ino !== stat.ino ||
        after.mode !== stat.mode ||
        after.size !== stat.size ||
        after.ctimeMs !== stat.ctimeMs ||
        after.mtimeMs !== stat.mtimeMs
      ) {
        throw new Error(`C6 source symlink changed ${pathFromRoot}`);
      }
      output.push({
        mode: "120000",
        path: pathFromRoot,
        target,
        type: "symlink",
      });
      continue;
    }
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new Error(
        `C6 extracted source rejects special or hard-linked entry ${
          pathFromRoot
        }`,
      );
    }
    const file = await readStableSourceFile(
      path,
      `source entry ${pathFromRoot}`,
    );
    output.push({
      mode: (file.mode & 0o111) === 0 ? "100644" : "100755",
      path: pathFromRoot,
      sha256: sha256(file.bytes),
      size: file.bytes.byteLength,
      type: "file",
    });
  }
}

function assertSafeSourceSymlink(
  root: string,
  path: string,
  target: string,
): void {
  const resolvedTarget = resolve(dirname(path), target);
  const fromRoot = relative(root, resolvedTarget);
  if (
    target.length === 0 ||
    target.includes("\\") ||
    target.includes("\0") ||
    posix.isAbsolute(target) ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${posix.sep}`) ||
    resolve(root, fromRoot) !== resolvedTarget
  ) {
    throw new Error("C6 source archive rejects escaping symlink");
  }
}

export async function readStableSourceFile(
  path: string,
  label: string,
): Promise<{ bytes: Buffer; mode: number }> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    throw new Error(`C6 ${label} must be one regular non-hard-linked file`);
  }
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const terminal = await lstat(path);
    if (
      !opened.isFile() ||
      !terminal.isFile() ||
      terminal.isSymbolicLink() ||
      before.dev !== opened.dev ||
      before.ino !== opened.ino ||
      before.mode !== opened.mode ||
      before.size !== opened.size ||
      before.ctimeMs !== opened.ctimeMs ||
      before.mtimeMs !== opened.mtimeMs ||
      opened.nlink !== 1 ||
      after.nlink !== 1 ||
      opened.dev !== after.dev ||
      opened.ino !== after.ino ||
      opened.mode !== after.mode ||
      opened.size !== after.size ||
      opened.ctimeMs !== after.ctimeMs ||
      opened.mtimeMs !== after.mtimeMs ||
      terminal.dev !== after.dev ||
      terminal.ino !== after.ino ||
      terminal.mode !== after.mode ||
      terminal.size !== after.size ||
      terminal.ctimeMs !== after.ctimeMs ||
      terminal.mtimeMs !== after.mtimeMs ||
      terminal.nlink !== 1 ||
      bytes.byteLength !== after.size
    ) {
      throw new Error(`C6 ${label} changed while being read`);
    }
    return { bytes, mode: after.mode & 0o777 };
  } finally {
    await handle.close();
  }
}


export function isSafeGitPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !/[\0\r\n]/u.test(path) &&
    !path.includes("\uFFFD") &&
    path.split("/").every((component) =>
      component.length > 0 && component !== "." && component !== ".."
    )
  );
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function parseJsonText(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`C6 ${label} is not valid JSON`);
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function runCommand(
  command: string[],
  label: string,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const child = Bun.spawn({
    cmd: command,
    stderr: "pipe",
    stdout: "pipe",
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may already have exited.
    }
  }, COMMAND_TIMEOUT_MS);
  let exitCode: number;
  let stderr: string;
  let stdout: string;
  try {
    [exitCode, stderr, stdout] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  if (timedOut) {
    throw new Error(`C6 ${label} exceeded ${COMMAND_TIMEOUT_MS}ms deadline`);
  }
  if (exitCode !== 0) {
    throw new Error([
      `C6 ${label} failed with exit code ${exitCode}`,
      stdout.trim(),
      stderr.trim(),
    ].filter((value) => value.length > 0).join("\n"));
  }
  return { exitCode, stderr, stdout };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
