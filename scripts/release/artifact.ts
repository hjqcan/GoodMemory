import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { constants, gzipSync } from "node:zlib";

import { canonicalJson, canonicalJsonBytes } from "../proof/canonical";
import { buildProofFileClosure } from "../proof/files";
import { contentAddress } from "../proof/identity";
import type {
  ReleaseArtifactRef,
  ReleaseCheck,
  ReleaseEvidenceInput,
  ReleaseManifestV1,
} from "./contracts";

export interface ReleaseEvidenceMaterial {
  bytes: Uint8Array;
  ref: ReleaseArtifactRef;
}

export interface WrittenReleaseArtifacts {
  archivePath: string;
  manifestPath: string;
  summaryPath: string;
}

export interface CheckedReleaseEvidenceInputs {
  checks: ReleaseCheck[];
  evidence: ReleaseEvidenceMaterial[];
}

export function canonicalReleaseJson(value: unknown): string {
  return canonicalJson(value);
}

export function sha256(bytes: string | Uint8Array): string {
  return contentAddress(bytes).sha256;
}

export function parsePackedTarEntries(output: string): string[] {
  return output
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("package/") && !entry.endsWith("/"))
    .map((entry) => entry.slice("package/".length));
}

export function evaluateProductionAudit(
  raw: string,
  exitCode: number | null,
): string[] {
  try {
    const audit = JSON.parse(raw) as {
      metadata?: { vulnerabilities?: { critical?: unknown; high?: unknown } };
    };
    const critical = audit.metadata?.vulnerabilities?.critical;
    const high = audit.metadata?.vulnerabilities?.high;
    if (typeof critical !== "number" || typeof high !== "number") {
      return ["packed production dependency audit summary is missing"];
    }
    if (critical > 0 || high > 0) {
      return [`packed dependencies have ${high} high and ${critical} critical vulnerabilities`];
    }
    return exitCode === 0 ? [] : ["packed production dependency audit failed"];
  } catch {
    return ["packed production dependency audit is not valid JSON"];
  }
}

export function assertRelativeArtifactPath(path: string): void {
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    normalize(path).split("/").includes("..")
  ) {
    throw new Error(`release artifact path must be repository-relative: ${path}`);
  }
}

export function createReleaseArtifactRef(input: {
  bytes: Uint8Array;
  id: string;
  integrity?: string;
  kind: ReleaseArtifactRef["kind"];
  path: string;
  tracked: boolean;
}): ReleaseArtifactRef {
  assertRelativeArtifactPath(input.path);
  return {
    bytes: input.bytes.byteLength,
    id: input.id,
    ...(input.integrity ? { integrity: input.integrity } : {}),
    kind: input.kind,
    path: input.path,
    sha256: sha256(input.bytes),
    tracked: input.tracked,
  };
}

export function summarizeReleaseChecks(checks: readonly ReleaseCheck[]): {
  failed: number;
  passed: number;
  skipped: number;
  total: number;
} {
  return {
    failed: checks.filter((check) => check.status === "fail").length,
    passed: checks.filter((check) => check.status === "pass").length,
    skipped: checks.filter((check) => check.status === "skip").length,
    total: checks.length,
  };
}

export function assertReleaseManifestReferences(
  manifest: ReleaseManifestV1,
): void {
  const checkIds = manifest.checks.map((check) => check.id);
  if (new Set(checkIds).size !== checkIds.length) {
    throw new Error("release manifest contains duplicate check ids");
  }
  const artifactIds = manifest.artifacts.map((artifact) => artifact.id);
  if (new Set(artifactIds).size !== artifactIds.length) {
    throw new Error("release manifest contains duplicate artifact ids");
  }
  const knownArtifacts = new Set(artifactIds);
  for (const check of manifest.checks) {
    const unknown = check.evidenceArtifactIds.filter(
      (artifactId) => !knownArtifacts.has(artifactId),
    );
    if (unknown.length > 0) {
      throw new Error(
        `release check ${check.id} references unknown artifacts: ${unknown.join(", ")}`,
      );
    }
  }
  for (const artifact of manifest.artifacts) {
    assertRelativeArtifactPath(artifact.path);
  }
}

export function renderReleaseSummary(manifest: ReleaseManifestV1): string {
  const lines = [
    `# ${manifest.package.name}@${manifest.package.version} Release Readiness`,
    "",
    `- profile: ${manifest.profileId}`,
    `- source commit: ${manifest.source.commit}`,
    `- source tree: ${manifest.source.tree}`,
    `- runtime: Node ${manifest.runtime.nodeVersion} / Bun ${manifest.runtime.bunVersion}`,
    `- status: ${manifest.package.status} (${manifest.package.distTag})`,
    `- result: ${manifest.allRequiredPassed ? "ALL REQUIRED CHECKS PASS" : "REQUIRED CHECK(S) FAILED"} ` +
      `(${manifest.summary.passed} pass / ${manifest.summary.failed} fail / ` +
      `${manifest.summary.skipped} skip)`,
    "",
    "| Check | Required | Status | Detail |",
    "|---|---|---|---|",
  ];
  for (const check of manifest.checks) {
    const detail = check.detail
      .replace(/\n/gu, " ")
      .replace(/\|/gu, "\\|")
      .slice(0, 180);
    lines.push(
      `| ${check.title} | ${check.required ? "yes" : "no"} | ` +
        `${check.status.toUpperCase()} | ${detail} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function writeReleaseArtifacts(input: {
  evidence: readonly ReleaseEvidenceMaterial[];
  manifest: ReleaseManifestV1;
  outputDir: string;
}): Promise<WrittenReleaseArtifacts> {
  assertReleaseManifestReferences(input.manifest);
  const evidenceById = new Map(input.evidence.map((entry) => [entry.ref.id, entry]));
  for (const artifact of input.manifest.artifacts) {
    if (artifact.id === "release-tarball") {
      continue;
    }
    const evidence = evidenceById.get(artifact.id);
    if (
      !evidence ||
      evidence.ref.sha256 !== artifact.sha256 ||
      evidence.ref.bytes !== artifact.bytes
    ) {
      throw new Error(`release evidence bytes are missing or drifted: ${artifact.id}`);
    }
  }

  await mkdir(input.outputDir, { recursive: true });
  const manifestPath = join(input.outputDir, "release-manifest.json");
  const summaryPath = join(input.outputDir, "summary.md");
  const archivePath = join(
    input.outputDir,
    `${input.manifest.package.name}-${input.manifest.package.version}-release-evidence.json.gz`,
  );
  const manifestBytes = canonicalReleaseJson(input.manifest);
  const archiveBytes = canonicalReleaseJson({
    evidence: [...input.evidence]
      .sort((left, right) => left.ref.path.localeCompare(right.ref.path))
      .map((entry) => ({
        contentBase64: Buffer.from(entry.bytes).toString("base64"),
        ref: entry.ref,
      })),
    manifest: input.manifest,
    schemaVersion: "goodmemory.release-evidence-archive.v1",
  });
  await Promise.all([
    writeFile(manifestPath, manifestBytes, "utf8"),
    writeFile(summaryPath, renderReleaseSummary(input.manifest), "utf8"),
    writeFile(
      archivePath,
      gzipSync(Buffer.from(archiveBytes), { level: constants.Z_BEST_COMPRESSION }),
    ),
  ]);
  return { archivePath, manifestPath, summaryPath };
}

export async function readEvidenceMaterial(input: {
  absolutePath: string;
  id: string;
  path: string;
}): Promise<ReleaseEvidenceMaterial> {
  if ((await lstat(input.absolutePath)).isSymbolicLink()) {
    throw new Error(`release evidence rejects symlink ${input.path}`);
  }
  const bytes = await readFile(input.absolutePath);
  return {
    bytes,
    ref: createReleaseArtifactRef({
      bytes,
      id: input.id,
      kind: "file",
      path: input.path,
      tracked: true,
    }),
  };
}

export async function readEvidenceTreeMaterial(input: {
  absolutePath: string;
  id: string;
  path: string;
}): Promise<ReleaseEvidenceMaterial> {
  const bytes = canonicalJsonBytes(await buildProofFileClosure(input.absolutePath));
  return {
    bytes,
    ref: createReleaseArtifactRef({
      bytes,
      id: input.id,
      kind: "tree",
      path: input.path,
      tracked: true,
    }),
  };
}

export async function checkReleaseEvidenceInputs(input: {
  inputs: readonly ReleaseEvidenceInput[];
  repoRoot: string;
  runGit: (args: readonly string[]) => Promise<{ code: number | null; stdout: string }>;
}): Promise<CheckedReleaseEvidenceInputs> {
  const checks: ReleaseCheck[] = [];
  const evidence: ReleaseEvidenceMaterial[] = [];
  for (const expected of input.inputs) {
    const startedAt = performance.now();
    const issues: string[] = [];
    const absolutePath = resolve(input.repoRoot, expected.path);
    let trackedTreePaths: Set<string> | undefined;
    if (relative(input.repoRoot, absolutePath).startsWith("..")) {
      issues.push(`${expected.path} escapes the repository`);
    } else {
      const tracked = await input.runGit(
        expected.kind === "tree"
          ? ["ls-files", "-z", "--", expected.path]
          : ["ls-files", "--error-unmatch", "--", expected.path],
      );
      if (tracked.code !== 0) {
        issues.push(`${expected.path} is not tracked by Git`);
      } else if (expected.kind === "tree") {
        trackedTreePaths = new Set(tracked.stdout.split("\0").filter(Boolean));
        if (trackedTreePaths.size === 0) {
          issues.push(`${expected.path} has no tracked files`);
        }
      }
    }
    if (issues.length === 0) {
      try {
        const material = expected.kind === "tree"
          ? await readEvidenceTreeMaterial({
              absolutePath,
              id: expected.id,
              path: expected.path,
            })
          : await readEvidenceMaterial({
              absolutePath,
              id: expected.id,
              path: expected.path,
            });
        if (expected.kind === "tree") {
          const closure = JSON.parse(Buffer.from(material.bytes).toString("utf8")) as Array<{
            path: string;
          }>;
          const observed = new Set(
            closure.map((file) => `${expected.path}/${file.path}`),
          );
          if (
            observed.size !== trackedTreePaths?.size ||
            [...observed].some((path) => !trackedTreePaths?.has(path))
          ) {
            issues.push(`${expected.path} tracked tree closure does not match disk`);
          }
        }
        if (material.ref.sha256 !== expected.sha256) {
          issues.push(
            `${expected.path} sha256 ${material.ref.sha256} does not match ${expected.sha256}`,
          );
        } else if (issues.length === 0) {
          evidence.push(material);
        }
      } catch (error) {
        issues.push(
          `${expected.path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    checks.push({
      detail: issues.length === 0
        ? `${expected.title} matched exact tracked bytes`
        : issues.join("; "),
      durationMs: Math.round(performance.now() - startedAt),
      evidenceArtifactIds: issues.length === 0 ? [expected.id] : [],
      id: expected.checkId,
      required: true,
      status: issues.length === 0 ? "pass" : "fail",
      title: expected.title,
    });
  }
  return { checks, evidence };
}
