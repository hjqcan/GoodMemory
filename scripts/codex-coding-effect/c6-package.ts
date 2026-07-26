import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

const REQUIRED_PACKAGE_FILES = [
  "package/package.json",
  "package/scripts/goodmemory-cli.js",
  "package/scripts/goodmemory-mcp.js",
  "package/dist/bin/goodmemory-cli.js",
  "package/dist/bin/goodmemory-mcp.js",
  "package/dist/host/index.js",
] as const;

const packageIdentitySchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
});

export interface C6PackageIdentity {
  fileCount: number;
  filesManifestSha256: string;
  name: "goodmemory";
  sha256: string;
  version: string;
}

export async function inspectC6PackageTarball(input: {
  expectedSha256: string;
  expectedVersion: string;
  path: string;
}): Promise<C6PackageIdentity> {
  const stat = await lstat(input.path);
  if (stat.isSymbolicLink()) {
    throw new Error(`C6 package tarball rejects symlink ${input.path}`);
  }
  if (!stat.isFile()) {
    throw new Error("C6 package tarball must be a regular file");
  }
  const bytes = await readFile(input.path);
  const packageSha256 = sha256(bytes);
  if (packageSha256 !== input.expectedSha256) {
    throw new Error("C6 package tarball hash does not match");
  }

  let listing: string;
  let verboseListing: string;
  let packageJsonBytes: string;
  try {
    [listing, verboseListing, packageJsonBytes] = await Promise.all([
      runTar(input.path, ["-tzf", input.path]),
      runTar(input.path, ["-tvzf", input.path]),
      runTar(input.path, [
        "-xOzf",
        input.path,
        "package/package.json",
      ]),
    ]);
  } catch {
    throw new Error("C6 package artifact must be a valid gzip tarball");
  }

  const entries = listing.split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (
    entries.length === 0 ||
    new Set(entries).size !== entries.length ||
    entries.some((entry) =>
      !entry.startsWith("package/") ||
      entry.includes("\\") ||
      entry.split("/").includes("..")
    )
  ) {
    throw new Error("C6 package tarball has an invalid entry closure");
  }
  for (const line of verboseListing.split(/\r?\n/u)) {
    const normalized = line.trimStart();
    if (
      normalized.length > 0 &&
      normalized[0] !== "-" &&
      normalized[0] !== "d"
    ) {
      throw new Error("C6 package tarball rejects non-file entries");
    }
  }
  const entrySet = new Set(entries);
  for (const required of REQUIRED_PACKAGE_FILES) {
    if (!entrySet.has(required)) {
      throw new Error(`C6 package tarball missing required entry ${required}`);
    }
  }

  const identity = packageIdentitySchema.parse(
    JSON.parse(packageJsonBytes) as unknown,
  );
  if (identity.name !== "goodmemory") {
    throw new Error("C6 package name must be goodmemory");
  }
  if (identity.version !== input.expectedVersion) {
    throw new Error("C6 package version does not match");
  }
  if (sha256(await readFile(input.path)) !== packageSha256) {
    throw new Error("C6 package tarball drifted during inspection");
  }
  const files = entries.filter((entry) => !entry.endsWith("/")).sort();
  return {
    fileCount: files.length,
    filesManifestSha256: sha256(JSON.stringify(files)),
    name: "goodmemory",
    sha256: packageSha256,
    version: identity.version,
  };
}

async function runTar(path: string, command: string[]): Promise<string> {
  const child = Bun.spawn({
    cmd: ["tar", ...command],
    cwd: dirname(path),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim());
  }
  return stdout;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
