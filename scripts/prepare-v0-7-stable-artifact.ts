import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  V07RuntimeIdentity,
  V07SourceIdentity,
} from "./run-v0-7-release-readiness";
import {
  collectV07SourceIdentity,
  evaluateV07PackManifest,
  evaluateV07SourceStability,
  verifyV07ArtifactConsumers,
} from "./run-v0-7-release-readiness";
import { assertV07StableReleaseSource } from "./promote-v0-7-release";

const RELEASE_VERSION = "0.7.3";

export interface V07StableArtifact {
  artifactName: string;
  artifactPath: string;
  integrity: string;
  packedFileCount: number;
  runtime?: V07RuntimeIdentity;
  sourceCommit: string;
  sourceTree: string;
  tarballBytes: number;
  version: string;
}

async function runCommand(input: {
  cmd: string[];
  cwd: string;
}): Promise<string> {
  const child = Bun.spawn({
    cmd: input.cmd,
    cwd: input.cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${input.cmd.join(" ")} failed with exit ${exitCode}: ${stderr.trim()}`,
    );
  }
  return stdout.trim();
}

async function extractTarball(
  tarballPath: string,
  outputDir: string,
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  await runCommand({
    cmd: ["tar", "-xzf", tarballPath, "-C", outputDir],
    cwd: outputDir,
  });
  return join(outputDir, "package");
}

async function verifyPackedManifest(
  artifactPath: string,
  outputDir: string,
): Promise<{
  packedFileCount: number;
  tarballBytes: number;
}> {
  const listing = await runCommand({
    cmd: ["tar", "-tzf", artifactPath],
    cwd: outputDir,
  });
  const files = listing
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("package/") && !entry.endsWith("/"))
    .map((entry) => entry.slice("package/".length));
  const tarballBytes = (await stat(artifactPath)).size;
  const issues = evaluateV07PackManifest(files, tarballBytes);
  if (issues.length > 0) {
    throw new Error(`Stable artifact package gate failed: ${issues.join("; ")}`);
  }
  return {
    packedFileCount: files.length,
    tarballBytes,
  };
}

async function verifyStableTarball(input: {
  packageRoot: string;
  verifyRuntimeDescriptor: boolean;
}): Promise<void> {
  await assertV07StableReleaseSource({ repoRoot: input.packageRoot });
  if (!input.verifyRuntimeDescriptor) {
    return;
  }
  const httpModule = await import(
    `${pathToFileURL(join(input.packageRoot, "dist/http/index.js")).href}?stable-check=${Date.now()}`
  ) as {
    createGoodMemoryHttpMemoryBridge(input: { memory: unknown }): {
      fetch(request: Request): Promise<Response>;
    };
  };
  const bridge = httpModule.createGoodMemoryHttpMemoryBridge({ memory: {} });
  const response = await bridge.fetch(
    new Request("http://localhost/.well-known/goodmemory.json"),
  );
  const runtimeDescriptor = await response.json() as {
    releaseStatus?: unknown;
  };
  const staticDescriptor = JSON.parse(
    await readFile(
      join(input.packageRoot, ".well-known/goodmemory.json"),
      "utf8",
    ),
  ) as { releaseStatus?: unknown };
  if (
    JSON.stringify(runtimeDescriptor.releaseStatus) !==
      JSON.stringify(staticDescriptor.releaseStatus)
  ) {
    throw new Error("Installed runtime capability descriptor release status drifted.");
  }
}

async function resolveArtifactSourceIdentity(input: {
  expectedCommit?: string;
  repoRoot: string;
}): Promise<V07SourceIdentity> {
  const source = await collectV07SourceIdentity(input.repoRoot);
  if (source.check.status !== "pass") {
    throw new Error(`Stable artifact source must be clean: ${source.check.detail}`);
  }
  const expectedCommit = input.expectedCommit?.trim();
  if (
    expectedCommit &&
    expectedCommit !== source.sourceIdentity.commitSha
  ) {
    throw new Error(
      `Source commit ${expectedCommit} does not match clean HEAD ` +
        source.sourceIdentity.commitSha,
    );
  }
  return source.sourceIdentity;
}

export async function prepareV07StableArtifact(input: {
  outputDir: string;
  repoRoot: string;
  sourceCommit?: string;
  verifyInstalledConsumers?: boolean;
  verifyRuntimeDescriptor?: boolean;
}): Promise<V07StableArtifact> {
  const repoRoot = resolve(input.repoRoot);
  const outputDir = resolve(input.outputDir);
  await assertV07StableReleaseSource({ repoRoot });
  const initialSource = await resolveArtifactSourceIdentity({
    expectedCommit: input.sourceCommit?.trim() || process.env.GITHUB_SHA?.trim(),
    repoRoot,
  });
  await mkdir(outputDir, { recursive: true });
  const verificationRoot = await mkdtemp(join(outputDir, ".v0-7-verify-"));
  try {
    const packed = await runCommand({
      cmd: ["bun", "pm", "pack", "--destination", outputDir, "--quiet"],
      cwd: repoRoot,
    });
    const artifactPath = resolve(
      outputDir,
      basename(packed.split("\n").at(-1) ?? ""),
    );
    if (basename(artifactPath) !== `goodmemory-${RELEASE_VERSION}.tgz`) {
      throw new Error(`Expected goodmemory-${RELEASE_VERSION}.tgz.`);
    }
    const packedManifest = await verifyPackedManifest(artifactPath, outputDir);
    const verifiedPackage = await extractTarball(artifactPath, verificationRoot);
    await verifyStableTarball({
      packageRoot: verifiedPackage,
      verifyRuntimeDescriptor: input.verifyRuntimeDescriptor ?? true,
    });
    const integrity = `sha512-${createHash("sha512")
      .update(await readFile(artifactPath))
      .digest("base64")}`;
    const runtime = input.verifyInstalledConsumers === false
      ? undefined
      : await verifyV07ArtifactConsumers({ artifactPath, repoRoot });
    const finalSource = await collectV07SourceIdentity(repoRoot);
    const stability = evaluateV07SourceStability({
      final: finalSource,
      initial: initialSource,
    });
    if (stability.status !== "pass") {
      throw new Error(stability.detail);
    }
    return {
      artifactName: basename(artifactPath),
      artifactPath,
      integrity,
      packedFileCount: packedManifest.packedFileCount,
      ...(runtime ? { runtime } : {}),
      sourceCommit: initialSource.commitSha,
      sourceTree: initialSource.treeSha,
      tarballBytes: packedManifest.tarballBytes,
      version: RELEASE_VERSION,
    };
  } finally {
    await rm(verificationRoot, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  const outputFlag = Bun.argv.indexOf("--output-dir");
  const outputDir = outputFlag >= 0 ? Bun.argv[outputFlag + 1] : undefined;
  if (!outputDir) {
    throw new Error(
      "Usage: bun run scripts/prepare-v0-7-stable-artifact.ts --output-dir <dir>",
    );
  }
  console.log(JSON.stringify(await prepareV07StableArtifact({
    outputDir,
    repoRoot: process.cwd(),
  })));
}
