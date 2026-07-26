import { createHash } from "node:crypto";
import {
  lstat,
} from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import ts from "typescript";
import { z } from "zod";

import {
  readC6StableRegularFile,
} from "./c6-asset-lock";

const ENTRYPOINTS = [
  "scripts/codex-coding-effect/c6-source-v3-simple-census-cli.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-census-runner.ts",
] as const;
const CONFIG_PATHS = [
  "bun.lock",
  "bunfig.toml",
  "package.json",
  "tsconfig.json",
] as const;
const sha256Schema = z.string().regex(
  /^[a-f0-9]{64}$/u,
);
const sourceFileSchema = z.object({
  bytes: z.number().int().nonnegative(),
  gitMode: z.literal("100644"),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const runtimeSourceManifestSchema = z.object({
  aggregateSha256: sha256Schema,
  artifactKind: z.literal(
    "c6-source-v3-simple-census-runtime-source-manifest",
  ),
  entrypoints: z.array(z.string()).length(
    ENTRYPOINTS.length,
  ),
  files: z.array(sourceFileSchema).min(1),
  schemaVersion: z.literal(1),
}).strict();

export type C6SourceV3SimpleCensusRuntimeSourceManifest =
  z.infer<typeof runtimeSourceManifestSchema>;

export async function captureC6SourceV3SimpleCensusRuntimeSource(
  repositoryRootInput: string,
): Promise<C6SourceV3SimpleCensusRuntimeSourceManifest> {
  const repositoryRoot = resolve(repositoryRootInput);
  await requireDirectory(repositoryRoot);
  const files = new Map<
    string,
    z.infer<typeof sourceFileSchema>
  >();
  for (const path of CONFIG_PATHS) {
    files.set(
      path,
      await collectFile(repositoryRoot, path),
    );
  }
  const pending: string[] = [...ENTRYPOINTS];
  while (pending.length > 0) {
    const path = pending.shift()!;
    if (files.has(path)) {
      continue;
    }
    const file = await collectFile(
      repositoryRoot,
      path,
    );
    files.set(path, file);
    const source = (
      await readC6StableRegularFile(
        join(repositoryRoot, path),
        `source-v3-simple runtime source ${path}`,
        undefined,
        true,
      )
    ).toString("utf8");
    for (
      const imported of
        ts.preProcessFile(source, true, true)
          .importedFiles
    ) {
      if (!imported.fileName.startsWith(".")) {
        continue;
      }
      const resolved = await resolveImportedFile({
        importer: path,
        repositoryRoot,
        specifier: imported.fileName,
      });
      if (
        !files.has(resolved) &&
        !pending.includes(resolved)
      ) {
        pending.push(resolved);
      }
    }
    pending.sort(compareText);
  }
  const orderedFiles = [...files.values()].sort(
    (left, right) =>
      compareText(left.path, right.path),
  );
  return runtimeSourceManifestSchema.parse({
    aggregateSha256: sha256(
      Buffer.from(JSON.stringify(orderedFiles)),
    ),
    artifactKind:
      "c6-source-v3-simple-census-runtime-source-manifest",
    entrypoints: [...ENTRYPOINTS],
    files: orderedFiles,
    schemaVersion: 1,
  });
}

export function parseC6SourceV3SimpleCensusRuntimeSourceManifest(
  input: string | Uint8Array,
): C6SourceV3SimpleCensusRuntimeSourceManifest {
  const bytes = Buffer.from(input);
  const text = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(bytes);
  const raw = JSON.parse(text) as unknown;
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 source-v3-simple runtime source manifest is not canonical JSON",
    );
  }
  const manifest =
    runtimeSourceManifestSchema.parse(raw);
  if (
    JSON.stringify(manifest.entrypoints) !==
      JSON.stringify(ENTRYPOINTS) ||
    manifest.files.some((file, index) =>
      index > 0 &&
      compareText(
        manifest.files[index - 1]!.path,
        file.path,
      ) >= 0
    ) ||
    manifest.aggregateSha256 !==
      sha256(
        Buffer.from(JSON.stringify(manifest.files)),
      )
  ) {
    throw new Error(
      "C6 source-v3-simple runtime source manifest closure mismatch",
    );
  }
  return manifest;
}

export function serializeC6SourceV3SimpleCensusRuntimeSourceManifest(
  manifest: C6SourceV3SimpleCensusRuntimeSourceManifest,
): string {
  return `${JSON.stringify(
    runtimeSourceManifestSchema.parse(manifest),
    null,
    2,
  )}\n`;
}

async function resolveImportedFile(input: {
  importer: string;
  repositoryRoot: string;
  specifier: string;
}): Promise<string> {
  const unresolved = resolve(
    dirname(join(input.repositoryRoot, input.importer)),
    input.specifier,
  );
  canonicalRelativePath(
    input.repositoryRoot,
    unresolved,
  );
  const extension = extname(unresolved);
  const candidates = extension.length > 0
    ? [unresolved]
    : [
        `${unresolved}.ts`,
        `${unresolved}.tsx`,
        `${unresolved}.mts`,
        `${unresolved}.cts`,
        `${unresolved}.js`,
        `${unresolved}.json`,
        join(unresolved, "index.ts"),
        join(unresolved, "index.tsx"),
        join(unresolved, "index.mts"),
        join(unresolved, "index.js"),
      ];
  for (const candidate of candidates) {
    try {
      const stats = await lstat(candidate);
      if (stats.isSymbolicLink()) {
        throw new Error(
          "C6 source-v3-simple runtime source rejects symlink",
        );
      }
      if (stats.isFile()) {
        return canonicalRelativePath(
          input.repositoryRoot,
          candidate,
        );
      }
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        continue;
      }
      throw error;
    }
  }
  throw new Error(
    `C6 source-v3-simple runtime import is missing: ${input.specifier}`,
  );
}

async function collectFile(
  repositoryRoot: string,
  path: string,
): Promise<z.infer<typeof sourceFileSchema>> {
  const absolutePath = join(repositoryRoot, path);
  const stats = await lstat(absolutePath);
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    (stats.mode & 0o111) !== 0
  ) {
    throw new Error(
      `C6 source-v3-simple runtime source is not a regular file: ${path}`,
    );
  }
  const canonicalPath = canonicalRelativePath(
    repositoryRoot,
    absolutePath,
  );
  const bytes = await readC6StableRegularFile(
    absolutePath,
    `source-v3-simple runtime source ${path}`,
    undefined,
    true,
  );
  return {
    bytes: bytes.length,
    gitMode: "100644",
    path: canonicalPath,
    sha256: sha256(bytes),
  };
}

async function requireDirectory(path: string): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      "C6 source-v3-simple runtime repository root is invalid",
    );
  }
}

function canonicalRelativePath(
  repositoryRoot: string,
  path: string,
): string {
  const relativePath = relative(
    repositoryRoot,
    path,
  );
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(
      "C6 source-v3-simple runtime source escapes repository",
    );
  }
  return relativePath.split(sep).join("/");
}

function compareText(
  left: string,
  right: string,
): number {
  return Buffer.compare(
    Buffer.from(left),
    Buffer.from(right),
  );
}

function hasErrorCode(
  error: unknown,
  code: string,
): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}
