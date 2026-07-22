import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "bun:test";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildPackageTarballName,
  loadPackageMetadataSync,
} from "../../scripts/package-metadata";
import { withPackagePackLock } from "../support/package-pack-lock";

const QUALITY_GATE_ARCHIVE_ROOT = "docs/archive/quality-gates";
const ROOT_PACKAGE_PATH = join(import.meta.dir, "../../");
const CURRENT_PACKAGE = loadPackageMetadataSync(ROOT_PACKAGE_PATH);
const CURRENT_PACKAGE_VERSION = CURRENT_PACKAGE.version;
const CURRENT_TARBALL_NAME = buildPackageTarballName(CURRENT_PACKAGE);

function extractMarkedSection(markdown: string, marker: string): string {
  const start = `<!-- ${marker}:start -->`;
  const end = `<!-- ${marker}:end -->`;
  const startIndex = markdown.indexOf(start);
  const endIndex = markdown.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`Missing ${marker} markers`);
  }
  return markdown.slice(startIndex + start.length, endIndex);
}

let cachedReleaseTarball:
  | Promise<{ contents: Uint8Array; tarballName: string }>
  | undefined;
const RELEASE_TEST_ENV = {
  GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY: undefined,
  GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL: undefined,
  GOODMEMORY_ASSISTED_EXTRACTOR_MODEL: undefined,
  GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER: undefined,
  GOODMEMORY_EMBEDDING_API_KEY: undefined,
  GOODMEMORY_EMBEDDING_BASE_URL: undefined,
  GOODMEMORY_EMBEDDING_MODEL: undefined,
  GOODMEMORY_EMBEDDING_PROVIDER: undefined,
  GOODMEMORY_JUDGE_API_KEY: undefined,
  GOODMEMORY_JUDGE_BASE_URL: undefined,
  GOODMEMORY_JUDGE_MODEL: undefined,
  GOODMEMORY_JUDGE_PROVIDER: undefined,
  GOODMEMORY_RECALL_ROUTER_API_KEY: undefined,
  GOODMEMORY_RECALL_ROUTER_BASE_URL: undefined,
  GOODMEMORY_RECALL_ROUTER_MODEL: undefined,
  GOODMEMORY_RECALL_ROUTER_PROVIDER: undefined,
  GOODMEMORY_SQLITE_CUSTOM_LIBRARY_PATH: undefined,
  GOODMEMORY_SQLITE_VECTOR_EXTENSION_ENTRYPOINT: undefined,
  GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH: undefined,
  GOODMEMORY_SQLITE_VECTOR_MODE: undefined,
  GOODMEMORY_SQLITE_VECTOR_SEARCH_FUNCTION: undefined,
  GOODMEMORY_STORAGE_PROVIDER: undefined,
  GOODMEMORY_STORAGE_URL: undefined,
  GOODMEMORY_TEST_POSTGRES_URL: undefined,
} as const;
const FALLBACK_ARTIFACT_PATH_PATTERN =
  /reports\/eval\/fallback\/[^\s`"'()<>]+\.json/g;
const FALLBACK_ARTIFACT_CITATION_ROOTS = [
  "README.md",
  "docs",
  "task-board",
] as const;
const PHASE41_CANONICAL_FALLBACK_REPORT =
  "reports/eval/fallback/phase-41/run-20260425213045/report.json";
const PHASE42_CANONICAL_FALLBACK_REPORT =
  "reports/eval/fallback/phase-42/run-20260426093000/report.json";
const PHASE43_CANONICAL_FALLBACK_REPORT =
  "reports/eval/fallback/phase-43/run-20260426113000/report.json";
const PHASE435_CANONICAL_FALLBACK_REPORT =
  "reports/eval/fallback/phase-43-5/run-20260426133000/report.json";
const PHASE44_CANONICAL_FALLBACK_REPORT =
  "reports/eval/fallback/phase-44/run-20260426153000/report.json";
const PHASE46_CANONICAL_FALLBACK_REPORT =
  "reports/eval/fallback/phase-46/run-20260427123000-quality-eval/report.json";
const PHASE47_CANONICAL_FALLBACK_REPORT =
  "reports/eval/fallback/phase-47/run-20260428120000-provider-rollout-eval/report.json";
const PHASE48_CANONICAL_FALLBACK_REPORT =
  "reports/eval/fallback/phase-48/run-20260428170000-dashboard-cloud-decision/report.json";
const PHASE49_CANONICAL_BASELINE_SMOKE_REPORT =
  "reports/eval/research/phase-49/baseline/run-phase49-smoke-current/report.json";
const PHASE49_CANONICAL_GOODMEMORY_SMOKE_REPORT =
  "reports/eval/research/phase-49/goodmemory/run-phase49-smoke-current/report.json";
const PHASE49_CANONICAL_COMPARISON_SMOKE_REPORT =
  "reports/eval/research/phase-49/comparison/run-phase49-smoke-current/report.json";
const PHASE51_CANONICAL_FALLBACK_REPORT =
  "reports/eval/fallback/phase-51/run-phase51-fallback-current/report.json";
const PHASE51_CANONICAL_LIVE_REPORT =
  "reports/eval/live-memory/phase-51/run-phase51-live-current/report.json";
const PHASE52_CANONICAL_FALLBACK_REPORT =
  "reports/eval/fallback/phase-52/run-phase52-fallback-current/report.json";
const PHASE52_CANONICAL_LIVE_REPORT =
  "reports/eval/live-memory/phase-52/run-phase52-live-current/report.json";
const PHASE53_CANONICAL_FALLBACK_REPORT =
  "reports/eval/fallback/phase-53/run-phase53-fallback-current/report.json";
const PHASE53_CANONICAL_LIVE_REPORT =
  "reports/eval/live-memory/phase-53/run-phase53-live-current/report.json";
const PHASE54_CANONICAL_FALLBACK_REPORT =
  "reports/eval/fallback/phase-54/run-phase54-fallback-current/report.json";
const PHASE54_CANONICAL_LIVE_REPORT =
  "reports/eval/live-memory/phase-54/run-phase54-live-current/report.json";
const PHASE55_CANONICAL_FALLBACK_REPORT =
  "reports/eval/fallback/phase-55/run-phase55-fallback-current/report.json";
const PHASE55_CANONICAL_LIVE_REPORT =
  "reports/eval/live-memory/phase-55/run-phase55-live-current/report.json";
const PHASE56_CANONICAL_FALLBACK_REPORT =
  "reports/eval/fallback/phase-56/run-phase56-fallback-current/report.json";
const PHASE56_CANONICAL_LIVE_REPORT =
  "reports/eval/live-memory/phase-56/run-phase56-live-current/report.json";
const PHASE57_CANONICAL_FALLBACK_REPORT =
  "reports/eval/fallback/phase-57/run-phase57-fallback-current/report.json";
const PHASE57_CANONICAL_RAW_DIAGNOSTICS =
  "reports/eval/fallback/phase-57/run-phase57-fallback-current/raw-diagnostics.json";
const PHASE58_CANONICAL_FALLBACK_REPORT =
  "reports/eval/fallback/phase-58/run-phase58-fallback-current/report.json";
const PHASE58_CANONICAL_RAW_DIAGNOSTICS =
  "reports/eval/fallback/phase-58/run-phase58-fallback-current/raw-diagnostics.json";
const PHASE59_CANONICAL_FALLBACK_REPORT =
  "reports/eval/fallback/phase-59/run-phase59-fallback-current/report.json";
const PHASE59_CANONICAL_RAW_DIAGNOSTICS =
  "reports/eval/fallback/phase-59/run-phase59-fallback-current/raw-diagnostics.json";
const PHASE60_CANONICAL_OVERALL_SUMMARY =
  "reports/eval/fallback/phase-60/run-phase60-fallback-current/overall-summary.json";
const PHASE41_TASK_BOARD_LEAF_FILES = [
  "task-board/phase-41-installed-host-pre-action-unification/01-contract-and-failing-tests.txt",
  "task-board/phase-41-installed-host-pre-action-unification/02-installed-pretool-hook-contract.txt",
  "task-board/phase-41-installed-host-pre-action-unification/03-installed-action-bridge-runtime.txt",
  "task-board/phase-41-installed-host-pre-action-unification/04-managed-pretooluse-registration-and-status.txt",
  "task-board/phase-41-installed-host-pre-action-unification/05-deterministic-phase-41-eval.txt",
  "task-board/phase-41-installed-host-pre-action-unification/06-live-installed-codex-evidence.txt",
  "task-board/phase-41-installed-host-pre-action-unification/07-quality-gate-and-closure.txt",
] as const;
const CANONICAL_PHASE20_DEPENDENCY_SUMMARY_ARTIFACTS = [
  "reports/quality-gates/phase-20/run-20260420023503/dependency-gates/phase-16/run-20260420023503-phase-16/public-surface-decision.json",
  "reports/quality-gates/phase-20/run-20260420023503/dependency-gates/phase-16/run-20260420023503-phase-16/regression-dashboard.json",
  "reports/quality-gates/phase-20/run-20260420023503/dependency-gates/phase-16/run-20260420023503-phase-16/report.json",
  "reports/quality-gates/phase-20/run-20260420023503/dependency-gates/phase-16/run-20260420023503-phase-16/shadow-comparisons.json",
  "reports/quality-gates/phase-20/run-20260420023503/dependency-gates/phase-16/run-20260420023503-phase-16/shadow-executed-path-comparisons.json",
  "reports/quality-gates/phase-20/run-20260420023503/dependency-gates/phase-16/run-20260420023503-phase-16/strategy-promotion-gate.json",
  "reports/quality-gates/phase-20/run-20260420023503/dependency-gates/phase-17/run-20260420023503-phase-17/public-surface-decision.json",
  "reports/quality-gates/phase-20/run-20260420023503/dependency-gates/phase-17/run-20260420023503-phase-17/regression-dashboard.json",
  "reports/quality-gates/phase-20/run-20260420023503/dependency-gates/phase-17/run-20260420023503-phase-17/report.json",
  "reports/quality-gates/phase-20/run-20260420023503/dependency-gates/phase-17/run-20260420023503-phase-17/shadow-comparisons.json",
  "reports/quality-gates/phase-20/run-20260420023503/dependency-gates/phase-17/run-20260420023503-phase-17/shadow-executed-path-comparisons.json",
  "reports/quality-gates/phase-20/run-20260420023503/dependency-gates/phase-17/run-20260420023503-phase-17/strategy-promotion-gate.json",
  "reports/quality-gates/phase-20/run-20260420023503/dependency-gates/phase-18/run-20260420023503-phase-18/phase-18-quality-gate.json",
  "reports/quality-gates/phase-20/run-20260420023503/dependency-gates/phase-19-maintenance/run-20260420023503-phase-19-maintenance/phase-19-maintenance-quality-gate.json",
  "reports/quality-gates/phase-20/run-20260420023503/dependency-gates/phase-19-reviewer/run-20260420023503-phase-19-reviewer/phase-19-reviewer-quality-gate.json",
] as const;

async function runGitCommand(args: string[]): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  const process = Bun.spawn({
    cmd: ["git", ...args],
    cwd: ROOT_PACKAGE_PATH,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(process.stdout).text();
  const stderr = await new Response(process.stderr).text();
  const exitCode = await process.exited;

  return {
    exitCode,
    stderr,
    stdout,
  };
}

function createChildEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
}

async function runCommand(input: {
  cmd: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  stdin?: string;
}): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  const stdin = input.stdin;
  const childProcess = Bun.spawn({
    cmd: input.cmd,
    cwd: input.cwd,
    env: createChildEnv(input.env),
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdin !== undefined) {
    if (!childProcess.stdin) {
      throw new Error("release test helper expected a writable stdin pipe");
    }
    childProcess.stdin.write(stdin);
    childProcess.stdin.end();
  }
  const stdout = await new Response(childProcess.stdout).text();
  const stderr = await new Response(childProcess.stderr).text();
  const exitCode = await childProcess.exited;

  return {
    exitCode,
    stderr,
    stdout,
  };
}

function extractJsonObject<T>(value: string): T {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("Expected JSON output but none was found.");
  }

  return JSON.parse(value.slice(start, end + 1)) as T;
}

async function packReleaseTarball(outputDir: string): Promise<{
  tarballName: string;
  tarballPath: string;
}> {
  cachedReleaseTarball ??= (async () => {
    const pack = await withPackagePackLock(ROOT_PACKAGE_PATH, () =>
      runCommand({
        cmd: ["bun", "pm", "pack", "--destination", outputDir, "--quiet"],
        cwd: ROOT_PACKAGE_PATH,
      }),
    );

    expect(pack.exitCode).toBe(0);
    const tarballOutput = pack.stdout
      .trim()
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".tgz"))
      .at(-1);
    const tarballName = tarballOutput
      ? basename(tarballOutput)
      : CURRENT_TARBALL_NAME;
    const tarballPath = tarballOutput?.includes("/")
      ? tarballOutput
      : join(outputDir, tarballOutput ?? tarballName);
    return {
      contents: await readFile(tarballPath),
      tarballName,
    };
  })();

  const cached = await cachedReleaseTarball;
  const tarballPath = join(outputDir, cached.tarballName);
  await writeFile(tarballPath, cached.contents);

  return {
    tarballName: cached.tarballName,
    tarballPath,
  };
}

async function listTarballEntries(tarballPath: string): Promise<string[]> {
  const list = await runCommand({
    cmd: ["tar", "-tzf", tarballPath],
    cwd: ROOT_PACKAGE_PATH,
  });
  expect(list.exitCode).toBe(0);

  return list.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function readTarballEntry(
  tarballPath: string,
  entry: string,
): Promise<string> {
  const result = await runCommand({
    cmd: ["tar", "-xOzf", tarballPath, entry],
    cwd: ROOT_PACKAGE_PATH,
  });
  expect(result.exitCode).toBe(0);
  return result.stdout;
}

function toPackagedEntry(target: string): string {
  return `package/${target.replace(/^\.\//, "")}`;
}

function allocateReleaseBridgePort(): number {
  const server = Bun.serve({
    fetch: () => new Response("ok"),
    port: 0,
  });
  const port = server.port;
  server.stop(true);
  if (port === undefined) {
    throw new Error("Bun did not allocate a release bridge test port.");
  }

  return port;
}

async function waitForReleaseBridgeReady(input: {
  token: string;
  url: string;
}): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      // GET /healthz: auth-free liveness. Probing it here also proves the
      // endpoint survives packaging, since this hits the packed-tarball bin.
      const response = await fetch(`${input.url}/healthz`, { method: "GET" });

      if (response.status === 200) {
        const body = (await response.json()) as {
          contractVersion?: unknown;
          ok?: unknown;
        };
        if (body.ok === true && typeof body.contractVersion === "string") {
          return;
        }
      }

      lastError = new Error(`Bridge returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }

    await Bun.sleep(50);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("GoodMemory release bridge did not become ready.");
}

async function expectGitTrackedRepoArtifact(relativePath: string) {
  await access(join(import.meta.dir, "../../", relativePath));

  const tracked = await runGitCommand([
    "ls-files",
    "--error-unmatch",
    relativePath,
  ]);
  expect(tracked.exitCode).toBe(0);
  expect(tracked.stdout.trim()).toBe(relativePath);

  const ignored = await runGitCommand([
    "check-ignore",
    "-v",
    "--no-index",
    relativePath,
  ]);
  expect(ignored.exitCode).toBe(0);
  expect(ignored.stdout).toContain("\t" + relativePath);
  expect(ignored.stdout).toContain("!");
}

async function expectIgnoredGeneratedArtifact(relativePath: string) {
  const tracked = await runGitCommand([
    "ls-files",
    "--error-unmatch",
    relativePath,
  ]);
  expect(tracked.exitCode).not.toBe(0);

  const ignored = await runGitCommand([
    "check-ignore",
    "-v",
    "--no-index",
    relativePath,
  ]);
  expect(ignored.exitCode).toBe(0);
  expect(ignored.stdout).toContain("\t" + relativePath);
  expect(ignored.stdout).not.toContain("!");
}

async function expectIgnoredGeneratedArtifacts(relativePaths: readonly string[]) {
  if (relativePaths.length === 0) {
    return;
  }

  const trackedArtifacts = new Set(await collectTrackedFallbackArtifacts());
  expect(relativePaths.filter((path) => trackedArtifacts.has(path))).toEqual([]);

  const ignored = await runGitCommand([
    "check-ignore",
    "-v",
    "--no-index",
    ...relativePaths,
  ]);
  expect(ignored.exitCode).toBe(0);
  for (const relativePath of relativePaths) {
    expect(ignored.stdout).toContain("\t" + relativePath);
  }
  expect(ignored.stdout).not.toContain("!");
}

function collectFallbackReportPathViolations(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectFallbackReportPathViolations(item));
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }

  const violations: string[] = [];
  for (const [key, nested] of Object.entries(value)) {
    if (
      key === "reportPath" &&
      typeof nested === "string" &&
      nested.startsWith("reports/eval/fallback/")
    ) {
      violations.push(nested);
      continue;
    }
    violations.push(...collectFallbackReportPathViolations(nested));
  }
  return violations;
}

function collectIgnoredFallbackEvidence(value: unknown): Array<{
  artifactKind?: unknown;
  path: string;
  pathKey: "ignoredArtifactPath" | "ignoredReportPath";
  regenerateCommand?: unknown;
}> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectIgnoredFallbackEvidence(item));
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }

  const record = value as Record<string, unknown>;
  const current: Array<{
    artifactKind?: unknown;
    path: string;
    pathKey: "ignoredArtifactPath" | "ignoredReportPath";
    regenerateCommand?: unknown;
  }> = [];
  for (const pathKey of ["ignoredArtifactPath", "ignoredReportPath"] as const) {
    if (
      typeof record[pathKey] === "string" &&
      record[pathKey].startsWith("reports/eval/fallback/")
    ) {
      current.push({
        artifactKind: record.artifactKind,
        path: record[pathKey],
        pathKey,
        regenerateCommand: record.regenerateCommand,
      });
    }
  }

  return [
    ...current,
    ...Object.values(record).flatMap((nested) =>
      collectIgnoredFallbackEvidence(nested)
    ),
  ];
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function collectFallbackArtifactPathCitations(content: string): string[] {
  return uniqueSorted(
    [...content.matchAll(FALLBACK_ARTIFACT_PATH_PATTERN)]
      .map((match) => match[0])
      .filter((path) => !path.includes("...")),
  );
}

async function listTrackedPaths(paths: readonly string[]): Promise<string[]> {
  const listed = await runGitCommand(["ls-files", "-z", ...paths]);
  expect(listed.exitCode).toBe(0);
  return listed.stdout
    .split("\0")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function collectTrackedFallbackArtifactCitations(): Promise<string[]> {
  const trackedCitationFiles = await listTrackedPaths(
    FALLBACK_ARTIFACT_CITATION_ROOTS,
  );
  const citations: string[] = [];

  for (const relativePath of trackedCitationFiles) {
    const content = await readFile(
      join(import.meta.dir, "../../", relativePath),
      "utf8",
    );
    citations.push(...collectFallbackArtifactPathCitations(content));
  }

  return uniqueSorted(citations);
}

async function collectTrackedFallbackArtifacts(): Promise<string[]> {
  const listed = await runGitCommand(["ls-files", "-z", "reports/eval/fallback"]);
  expect(listed.exitCode).toBe(0);
  return listed.stdout
    .split("\0")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".json"));
}

async function collectStagedDeletedFallbackArtifacts(): Promise<string[]> {
  const deleted = await runGitCommand([
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--diff-filter=D",
    "--",
    "reports/eval/fallback",
  ]);
  expect(deleted.exitCode).toBe(0);
  return deleted.stdout
    .split("\0")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".json"));
}

async function expectGitTrackedPath(relativePath: string) {
  await access(join(import.meta.dir, "../../", relativePath));

  const tracked = await runGitCommand([
    "ls-files",
    "--error-unmatch",
    relativePath,
  ]);
  expect(tracked.exitCode).toBe(0);
  expect(tracked.stdout.trim()).toBe(relativePath);
}

async function expectTrackedEvalReportsMentionedInFile(relativePath: string) {
  const content = await readFile(
    join(import.meta.dir, "../../", relativePath),
    "utf8",
  );
  const reportPaths = [
    ...new Set(
      [...content.matchAll(/reports\/eval\/[^\s`]+\/report\.json/g)].map(
        (match) => match[0],
      ),
    ),
  ];

  expect(reportPaths.length).toBeGreaterThan(0);

  for (const reportPath of reportPaths) {
    if (reportPath.startsWith("reports/eval/fallback/")) {
      await expectIgnoredGeneratedArtifact(reportPath);
      continue;
    }

    if (reportPath === "reports/eval/live-memory/phase-30/run-phase30-live-current/report.json") {
      await access(join(import.meta.dir, "../../", reportPath));
      continue;
    }
    await expectGitTrackedRepoArtifact(reportPath);
  }
}

async function expectCanonicalAcceptedQualityGate(input: {
  docPath: string;
  phaseDirectory: string;
  reportFileName: string;
  runId: string;
}) {
  const qualityGateDoc = await readFile(
    join(import.meta.dir, "../../", input.docPath),
    "utf8",
  );
  const canonicalRunIds = [
    ...qualityGateDoc.matchAll(/Canonical accepted gate run:\s*`(run-\d{14})`/g),
  ].map((match) => match[1]!);
  const referencedRunIds =
    canonicalRunIds.length > 0
      ? canonicalRunIds
      : [...qualityGateDoc.matchAll(/run-\d{14}/g)].map((match) => match[0]);

  expect(referencedRunIds.length).toBeGreaterThan(0);
  expect(new Set(referencedRunIds)).toEqual(new Set([input.runId]));

  const [canonicalRunId] = referencedRunIds;
  const relativeReportPath = `reports/quality-gates/${input.phaseDirectory}/${canonicalRunId}/${input.reportFileName}`;
  const report = JSON.parse(
    await readFile(
      join(
        import.meta.dir,
        `../../${relativeReportPath}`,
      ),
      "utf8",
    ),
  ) as {
    acceptance: {
      decision: string;
    };
    runId: string;
  };

  expect(report.runId).toBe(canonicalRunId);
  expect(report.acceptance.decision).toBe("accepted");

  const tracked = await runGitCommand([
    "ls-files",
    "--error-unmatch",
    relativeReportPath,
  ]);
  expect(tracked.exitCode).toBe(0);
  expect(tracked.stdout.trim()).toBe(relativeReportPath);

  const ignored = await runGitCommand([
    "check-ignore",
    "-v",
    "--no-index",
    relativeReportPath,
  ]);
  expect(ignored.exitCode).toBe(0);
  expect(ignored.stdout).toContain("!");
  expect(ignored.stdout).toContain("\t" + relativeReportPath);

  const reportRoot = join(
    import.meta.dir,
    "../../reports/quality-gates",
    input.phaseDirectory,
  );
  const entries = await readdir(reportRoot, { withFileTypes: true });
  const acceptedRunIds: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("run-")) {
      continue;
    }

    const relativeCandidateReportPath = `reports/quality-gates/${input.phaseDirectory}/${entry.name}/${input.reportFileName}`;
    const tracked = await runGitCommand([
      "ls-files",
      "--error-unmatch",
      relativeCandidateReportPath,
    ]);
    if (tracked.exitCode !== 0) {
      continue;
    }

    const candidateReportContent = await readFile(
      join(reportRoot, entry.name, input.reportFileName),
      "utf8",
    ).catch(() => undefined);
    if (!candidateReportContent) {
      continue;
    }

    const candidateReport = JSON.parse(candidateReportContent) as {
      acceptance: {
        decision: string;
      };
      runId: string;
    };

    if (candidateReport.acceptance.decision === "accepted") {
      acceptedRunIds.push(candidateReport.runId);
    }
  }

  expect(new Set(acceptedRunIds)).toEqual(new Set([input.runId]));
}

describe("release metadata and docs", () => {
  it("package metadata exposes bin, exports, and key scripts", async () => {
    const pkg = JSON.parse(
      await readFile(join(import.meta.dir, "../../package.json"), "utf8"),
    ) as {
      bugs?: {
        url?: string;
      };
      bin?: Record<string, string>;
      description?: string;
      engines?: Record<string, string>;
      exports?: Record<string, string | { import?: string; types?: string }>;
      files?: string[];
      homepage?: string;
      keywords?: string[];
      license?: string;
      packageManager?: string;
      private?: boolean;
      publishConfig?: Record<string, string>;
      repository?: {
        type?: string;
        url?: string;
      };
      scripts?: Record<string, string>;
      types?: string;
      version?: string;
    };

    expect(pkg.version).toBe(CURRENT_PACKAGE_VERSION);
    expect(pkg.version).toBe("0.7.0");
    expect(pkg.private).toBeUndefined();
    expect(pkg.description).toBe(
      "Memory layer for chat, copilot, and agent applications.",
    );
    expect(pkg.license).toBe("MIT");
    expect(pkg.homepage).toBe("https://github.com/hjqcan/GoodMemory#readme");
    expect(pkg.repository).toEqual({
      type: "git",
      url: "git+https://github.com/hjqcan/GoodMemory.git",
    });
    expect(pkg.bugs?.url).toBe("https://github.com/hjqcan/GoodMemory/issues");
    expect(pkg.keywords).toEqual([
      "agents",
      "ai",
      "bun",
      "copilot",
      "llm",
      "memory",
      "node",
      "typescript",
    ]);
    expect(pkg.packageManager).toBeUndefined();
    expect(pkg.engines?.bun).toBe(">=1.3.0");
    expect(pkg.engines?.node).toBe(">=20.0.0");
    expect(pkg.publishConfig?.access).toBe("public");
    expect(pkg.files).toEqual([
      ".well-known/goodmemory.json",
      "LICENSE",
      "README.md",
      "README.zh-CN.md",
      "dist",
      "docs/README.md",
      "docs/GoodMemory-15-Minute-App-Integration.md",
      "docs/GoodMemory-0.6-to-0.7-Migration-Guide.md",
      "docs/GoodMemory-Claude-Code-Setup-Guide.md",
      "docs/GoodMemory-Codex-Handoff-Setup-Guide.md",
      "docs/GoodMemory-Cursor-Setup-Guide.md",
      "docs/GoodMemory-First-Principles-and-Reference-Architecture.md",
      "docs/GoodMemory-Gemini-CLI-Setup-Guide.md",
      "docs/GoodMemory-Inspector-and-Admin-API.md",
      "docs/GoodMemory-LanguagePack-Extension-Guide.md",
      "docs/GoodMemory-MCP-Registry-Publishing.md",
      "docs/GoodMemory-OpenCode-Setup-Guide.md",
      "docs/GoodMemory-PRD.md",
      "docs/GoodMemory-Product-Comparison.md",
      "docs/GoodMemory-Python-HTTP-Integration-Bridge.md",
      "docs/GoodMemory-Reference-Integration-Guide.md",
      "docs/GoodMemory-Standalone-MCP-Setup-Guide.md",
      "docs/GoodMemory-Strategy-Rollout-Guide.md",
      "docs/GoodMemory-记忆数据分层设计.md",
      "llms.txt",
      "package.json",
      "scripts/goodmemory-cli.js",
      "scripts/goodmemory-http-bridge.js",
      "scripts/goodmemory-mcp.js",
      "server.json",
    ]);
    expect(pkg.bin?.goodmemory).toBe("./scripts/goodmemory-cli.js");
    expect(pkg.bin?.["goodmemory-http-bridge"]).toBe(
      "./scripts/goodmemory-http-bridge.js",
    );
    expect(pkg.bin?.["goodmemory-mcp"]).toBe("./scripts/goodmemory-mcp.js");
    expect(pkg.types).toBe("./dist/index.d.ts");
    expect(pkg.exports?.["."]).toEqual({
      import: "./dist/index.js",
      types: "./dist/index.d.ts",
    });
    expect(pkg.exports?.["./host"]).toEqual({
      import: "./dist/host/index.js",
      types: "./dist/host/index.d.ts",
    });
    expect(pkg.exports?.["./ai-sdk"]).toEqual({
      import: "./dist/ai-sdk/index.js",
      types: "./dist/ai-sdk/index.d.ts",
    });
    expect(pkg.exports?.["./http"]).toEqual({
      import: "./dist/http/index.js",
      types: "./dist/http/index.d.ts",
    });
    expect(pkg.exports?.["./runtime-kit"]).toEqual({
      import: "./dist/runtime-kit/index.js",
      types: "./dist/runtime-kit/index.d.ts",
    });
    expect(pkg.exports?.["./package.json"]).toBe("./package.json");
    expect(Object.keys(pkg.exports ?? {})).not.toContain("./cli");
    expect(Object.keys(pkg.exports ?? {})).not.toContain("./llm/ai-sdk");
    expect(pkg.scripts?.clean).toBe("rm -rf dist");
    expect(pkg.scripts?.build).toBe(
      "bun run clean && bun run build:js && bun run build:types",
    );
    expect(pkg.scripts?.["build:js"]).toBe("bun run scripts/build-package.ts");
    expect(pkg.scripts?.["build:types"]).toBe("bunx tsc -p tsconfig.package.json");
    expect(pkg.scripts?.goodmemory).toBe("bun run scripts/goodmemory-cli.ts");
    expect(pkg.scripts?.["goodmemory:http-bridge"]).toBe(
      "bun run scripts/goodmemory-http-bridge.ts",
    );
    expect(pkg.scripts?.["goodmemory:mcp"]).toBe("bun run scripts/goodmemory-mcp.ts");
    expect(pkg.scripts?.cli).toBeUndefined();
    expect(pkg.scripts?.["example:chat"]).toBe("bun run examples/basic-chat.ts");
    expect(pkg.scripts?.["example:coding-agent"]).toBe(
      "bun run examples/coding-agent.ts",
    );
    expect(pkg.scripts?.["example:ai-sdk-server"]).toBe(
      "bun run examples/plain-ai-sdk-server.ts",
    );
    expect(pkg.scripts?.["example:express-chat"]).toBe(
      "bun run examples/express-chat-server.ts",
    );
    expect(pkg.scripts?.["example:fastify-chat"]).toBe(
      "bun run examples/fastify-chat-server.ts",
    );
    expect(pkg.scripts?.["example:vercel-ai"]).toBe(
      "bun run examples/vercel-ai-chat.ts",
    );
    expect(pkg.scripts?.["example:host-claude"]).toBe(
      "bun run examples/host-claude-artifacts.ts",
    );
    expect(pkg.scripts?.["example:host-codex"]).toBe(
      "bun run examples/host-codex-handoff.ts",
    );
    expect(pkg.scripts?.["example:reference-product"]).toBe(
      "bun run examples/reference-chat-product/backend.ts smoke",
    );
    expect(pkg.scripts?.test).toBe("bun test");
    expect(pkg.scripts?.["test:all"]).toBe("bun --config=bunfig.all.toml test tests third-party");
    expect(pkg.scripts?.["test:coverage"]).toBe(
      "bun run scripts/run-coverage.ts && bun run scripts/check-coverage.ts",
    );
    expect(pkg.scripts?.["test:coverage:integration:rest"]).toBeUndefined();
    expect(pkg.scripts?.["test:coverage:integration:postgres"]).toBeUndefined();
    expect(pkg.scripts?.["test:ci"]).toBe(
      "bun run typecheck && bun run test:coverage && bun test tests/integration/python-http-bridge.test.ts tests/cli tests/release",
    );
    expect(pkg.scripts?.["eval:smoke"]).toBe("bun run scripts/run-eval.ts --mode=smoke");
    expect(pkg.scripts?.["eval:fallback"]).toBe("bun run scripts/run-eval.ts --mode=fallback");
    expect(pkg.scripts?.["eval:official-rescore"]).toBe(
      "bun run scripts/rescore-official-protocols.ts",
    );
    expect(pkg.scripts?.["eval:phase-17"]).toBe("bun run scripts/run-phase-17-eval.ts");
    expect(pkg.scripts?.["eval:live"]).toBe("bun run scripts/run-eval.ts --mode=live");
    expect(pkg.scripts?.["eval:live-memory"]).toBe(
      "bun run scripts/run-eval.ts --mode=live-memory",
    );
    expect(pkg.scripts?.["eval:live-auto-memory"]).toBe(
      "bun run scripts/run-eval.ts --mode=live-auto-memory",
    );
    expect(pkg.scripts?.["eval:live-provider-memory"]).toBe(
      "bun run scripts/run-eval.ts --mode=live-provider-memory",
    );
    expect(pkg.scripts?.["eval:phase-17-live-memory"]).toBe(
      "bun run scripts/run-phase-17-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-25"]).toBe("bun run scripts/run-phase-25-eval.ts");
    expect(pkg.scripts?.["eval:phase-25-live-memory"]).toBe(
      "bun run scripts/run-phase-25-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-27"]).toBe("bun run scripts/run-phase-27-eval.ts");
    expect(pkg.scripts?.["eval:phase-27-live-memory"]).toBe(
      "bun run scripts/run-phase-27-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-30"]).toBe("bun run scripts/run-phase-30-eval.ts");
    expect(pkg.scripts?.["eval:phase-30-live-memory"]).toBe(
      "bun run scripts/run-phase-30-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-31"]).toBe("bun run scripts/run-phase-31-eval.ts");
    expect(pkg.scripts?.["eval:phase-31-live-memory"]).toBe(
      "bun run scripts/run-phase-31-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-32"]).toBe("bun run scripts/run-phase-32-eval.ts");
    expect(pkg.scripts?.["eval:phase-32-live-memory"]).toBe(
      "bun run scripts/run-phase-32-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-34"]).toBe("bun run scripts/run-phase-34-eval.ts");
    expect(pkg.scripts?.["eval:phase-34-live-memory"]).toBe(
      "bun run scripts/run-phase-34-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-35"]).toBe("bun run scripts/run-phase-35-eval.ts");
    expect(pkg.scripts?.["eval:phase-35-live-memory"]).toBe(
      "bun run scripts/run-phase-35-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-41"]).toBe("bun run scripts/run-phase-41-eval.ts");
    expect(pkg.scripts?.["eval:phase-41-live-memory"]).toBe(
      "bun run scripts/run-phase-41-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-42"]).toBe("bun run scripts/run-phase-42-eval.ts");
    expect(pkg.scripts?.["eval:phase-43"]).toBe("bun run scripts/run-phase-43-eval.ts");
    expect(pkg.scripts?.["eval:phase-43-5"]).toBe(
      "bun run scripts/run-phase-43-5-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-44"]).toBe(
      "bun run scripts/run-phase-44-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-45"]).toBe(
      "bun run scripts/run-phase-45-adoption-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-46"]).toBe(
      "bun run scripts/run-phase-46-quality-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-47"]).toBe(
      "bun run scripts/run-phase-47-provider-rollout-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-48"]).toBe(
      "bun run scripts/run-phase-48-decision-report.ts",
    );
    expect(pkg.scripts?.["eval:phase-49-baseline"]).toBe(
      "bun run scripts/run-phase-49-baseline.ts",
    );
    expect(pkg.scripts?.["eval:phase-49-goodmemory"]).toBe(
      "bun run scripts/run-phase-49-goodmemory.ts",
    );
    expect(pkg.scripts?.["eval:phase-49"]).toBe(
      "bun run scripts/run-phase-49.ts",
    );
    expect(pkg.scripts?.["eval:phase-50"]).toBe(
      "bun run scripts/run-phase-50-installer-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-51"]).toBe(
      "bun run scripts/run-phase-51-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-51-live-memory"]).toBe(
      "bun run scripts/run-phase-51-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-52"]).toBe(
      "bun run scripts/run-phase-52-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-52-live-memory"]).toBe(
      "bun run scripts/run-phase-52-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-53"]).toBe(
      "bun run scripts/run-phase-53-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-53-live-memory"]).toBe(
      "bun run scripts/run-phase-53-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-54"]).toBe(
      "bun run scripts/run-phase-54-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-54-live-memory"]).toBe(
      "bun run scripts/run-phase-54-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-55"]).toBe(
      "bun run scripts/run-phase-55-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-55-live-memory"]).toBe(
      "bun run scripts/run-phase-55-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-56"]).toBe(
      "bun run scripts/run-phase-56-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-56-live-memory"]).toBe(
      "bun run scripts/run-phase-56-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-57"]).toBe(
      "bun run scripts/run-phase-57-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-57-diagnostics"]).toBe(
      "bun run scripts/summarize-phase-57-raw-diagnostics.ts",
    );
    expect(pkg.scripts?.["eval:phase-57-live-memory"]).toBe(
      "bun run scripts/run-phase-57-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-58"]).toBe(
      "bun run scripts/run-phase-58-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-58-diagnostics"]).toBe(
      "bun run scripts/summarize-phase-58-raw-diagnostics.ts",
    );
    expect(pkg.scripts?.["eval:phase-58-live-memory"]).toBe(
      "bun run scripts/run-phase-58-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-59"]).toBe(
      "bun run scripts/run-phase-59-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-59-diagnostics"]).toBe(
      "bun run scripts/summarize-phase-59-raw-diagnostics.ts",
    );
    expect(pkg.scripts?.["eval:phase-59-live-memory"]).toBe(
      "bun run scripts/run-phase-59-live-memory.ts",
    );
    expect(pkg.scripts?.["eval:phase-60"]).toBe(
      "bun run scripts/run-phase-60-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-60-overall"]).toBe(
      "bun run scripts/run-phase-60-overall.ts",
    );
    expect(pkg.scripts?.["eval:phase-61-full300"]).toBe(
      "bun run scripts/run-phase-61-full300.ts",
    );
    expect(pkg.scripts?.["eval:phase-62"]).toBe(
      "bun run scripts/run-phase-62-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-62-recall-diagnostic"]).toBe(
      "bun run scripts/run-phase-62-recall-diagnostic.ts",
    );
    expect(pkg.scripts?.["analyze:phase-63-beam"]).toBe(
      "bun run scripts/analyze-phase-63-beam-report.ts",
    );
    expect(pkg.scripts?.["prepare:phase-63-beam"]).toBe(
      "bun run scripts/prepare-phase-63-beam-data.ts",
    );
    expect(pkg.scripts?.["eval:phase-63"]).toBe(
      "bun run scripts/run-phase-63-eval.ts",
    );
    expect(pkg.scripts?.["eval:phase-63-live-closure"]).toBe(
      "bun run scripts/run-phase-63-beam-live-closure.ts",
    );
    expect(pkg.scripts?.["eval:phase-63-live-slice"]).toBe(
      "bun run scripts/run-phase-63-beam-live-slice.ts",
    );
    expect(pkg.scripts?.["eval:phase-63-recall-diagnostic"]).toBe(
      "bun run scripts/run-phase-63-beam-recall-diagnostic.ts",
    );
    expect(pkg.scripts?.["eval:phase-63-general-levers"]).toBe(
      "bun run scripts/measure-beam-general-levers.ts",
    );
    expect(pkg.scripts?.["eval:phase-40-cross-consumer"]).toBe(
      "bun run scripts/run-phase-40-cross-consumer-smoke.ts",
    );
    expect(pkg.scripts?.["eval:phase-40-product"]).toBe(
      "bun run scripts/run-phase-40-product-eval.ts",
    );
    expect(pkg.scripts?.["gate:phase-18"]).toBe("bun run scripts/run-phase-18-gate.ts");
    expect(pkg.scripts?.["gate:phase-19-reviewer"]).toBe(
      "bun run scripts/run-phase-19-reviewer-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-19-maintenance"]).toBe(
      "bun run scripts/run-phase-19-maintenance-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-20"]).toBe("bun run scripts/run-phase-20-gate.ts");
    expect(pkg.scripts?.["gate:phase-25"]).toBe("bun run scripts/run-phase-25-gate.ts");
    expect(pkg.scripts?.["gate:phase-26"]).toBe("bun run scripts/run-phase-26-gate.ts");
    expect(pkg.scripts?.["gate:phase-27"]).toBe("bun run scripts/run-phase-27-gate.ts");
    expect(pkg.scripts?.["gate:phase-28"]).toBe("bun run scripts/run-phase-28-gate.ts");
    expect(pkg.scripts?.["gate:phase-29"]).toBe("bun run scripts/run-phase-29-gate.ts");
    expect(pkg.scripts?.["gate:phase-30"]).toBe("bun run scripts/run-phase-30-gate.ts");
    expect(pkg.scripts?.["gate:phase-31"]).toBe("bun run scripts/run-phase-31-gate.ts");
    expect(pkg.scripts?.["gate:phase-32"]).toBe("bun run scripts/run-phase-32-gate.ts");
    expect(pkg.scripts?.["gate:phase-33"]).toBe("bun run scripts/run-phase-33-gate.ts");
    expect(pkg.scripts?.["gate:phase-34"]).toBe("bun run scripts/run-phase-34-gate.ts");
    expect(pkg.scripts?.["gate:phase-35"]).toBe("bun run scripts/run-phase-35-gate.ts");
    expect(pkg.scripts?.["gate:phase-38"]).toBe("bun run scripts/run-phase-38-gate.ts");
    expect(pkg.scripts?.["gate:phase-39"]).toBe("bun run scripts/run-phase-39-gate.ts");
    expect(pkg.scripts?.["gate:phase-40"]).toBe("bun run scripts/run-phase-40-gate.ts");
    expect(pkg.scripts?.["gate:v0.7"]).toBe(
      "bun run scripts/run-v0-7-release-readiness.ts",
    );
    expect(pkg.scripts?.["gate:phase-41"]).toBe("bun run scripts/run-phase-41-gate.ts");
    expect(pkg.scripts?.["gate:phase-42"]).toBe("bun run scripts/run-phase-42-gate.ts");
    expect(pkg.scripts?.["gate:phase-43"]).toBe("bun run scripts/run-phase-43-gate.ts");
    expect(pkg.scripts?.["gate:phase-43-5"]).toBe(
      "bun run scripts/run-phase-43-5-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-44"]).toBe(
      "bun run scripts/run-phase-44-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-45"]).toBe(
      "bun run scripts/run-phase-45-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-46"]).toBe(
      "bun run scripts/run-phase-46-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-47"]).toBe(
      "bun run scripts/run-phase-47-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-48"]).toBe(
      "bun run scripts/run-phase-48-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-49"]).toBe(
      "bun run scripts/run-phase-49-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-50"]).toBe(
      "bun run scripts/run-phase-50-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-51"]).toBe(
      "bun run scripts/run-phase-51-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-52"]).toBe(
      "bun run scripts/run-phase-52-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-53"]).toBe(
      "bun run scripts/run-phase-53-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-54"]).toBe(
      "bun run scripts/run-phase-54-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-55"]).toBe(
      "bun run scripts/run-phase-55-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-56"]).toBe(
      "bun run scripts/run-phase-56-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-57"]).toBe(
      "bun run scripts/run-phase-57-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-58"]).toBe(
      "bun run scripts/run-phase-58-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-59"]).toBe(
      "bun run scripts/run-phase-59-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-60"]).toBe(
      "bun run scripts/run-phase-60-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-62"]).toBe(
      "bun run scripts/run-phase-62-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-63"]).toBe(
      "bun run scripts/run-phase-63-gate.ts",
    );
    expect(pkg.scripts?.["gate:phase-63-beam-closure"]).toBe(
      "bun run scripts/run-phase-63-beam-closure-gate.ts",
    );
    expect(pkg.scripts?.["release:rc-dry-run"]).toBe(
      "bun run scripts/run-phase-29-rc-dry-run.ts",
    );
    expect(pkg.scripts?.prepack).toBe("bun run build");
    expect(pkg.scripts?.["eval:full"]).toBeUndefined();
  });

  it("package metadata includes a real MIT license file", async () => {
    const license = await readFile(join(import.meta.dir, "../../LICENSE"), "utf8");

    expect(license).toContain("MIT License");
    expect(license).toContain("Permission is hereby granted");
  });

  it("package export targets resolve inside the packed release artifact", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "goodmemory-export-pack-"));

    try {
      const { tarballPath } = await packReleaseTarball(outputDir);
      const packagedEntries = new Set(await listTarballEntries(tarballPath));
      const pkg = JSON.parse(
        await readFile(join(import.meta.dir, "../../package.json"), "utf8"),
      ) as {
        exports?: Record<string, string | { import?: string; types?: string }>;
      };

      for (const target of Object.values(pkg.exports ?? {})) {
        if (typeof target === "string") {
          expect(packagedEntries.has(toPackagedEntry(target))).toBe(true);
          continue;
        }

        if (target.import) {
          expect(packagedEntries.has(toPackagedEntry(target.import))).toBe(true);
        }

        if (target.types) {
          expect(packagedEntries.has(toPackagedEntry(target.types))).toBe(true);
        }
      }
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("packs a tarball that keeps the compiled package boundary and omits repo-only payload", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "goodmemory-phase29-pack-"));

    try {
      const dryRun = await withPackagePackLock(ROOT_PACKAGE_PATH, () =>
        runCommand({
          cmd: ["bun", "pm", "pack", "--dry-run"],
          cwd: ROOT_PACKAGE_PATH,
        }),
      );
      expect(dryRun.exitCode).toBe(0);

      const { tarballPath } = await packReleaseTarball(outputDir);
      const entries = await listTarballEntries(tarballPath);

      expect(entries).toContain("package/package.json");
      expect(entries).toContain("package/.well-known/goodmemory.json");
      expect(entries).toContain("package/llms.txt");
      expect(entries).toContain("package/README.md");
      expect(entries).toContain("package/README.zh-CN.md");
      expect(entries).toContain("package/LICENSE");
      expect(entries).toContain("package/server.json");
      expect(entries).toContain("package/dist/index.js");
      expect(entries).toContain("package/dist/index.d.ts");
      expect(entries).toContain("package/dist/ai-sdk/index.js");
      expect(entries).toContain("package/dist/host/index.js");
      expect(entries).toContain("package/dist/http/index.js");
      expect(entries).toContain("package/dist/runtime-kit/index.js");
      expect(entries).toContain("package/dist/bin/goodmemory-cli.js");
      expect(entries).toContain("package/dist/bin/goodmemory-http-bridge.js");
      expect(entries).toContain("package/dist/bin/goodmemory-mcp.js");
      expect(entries).toContain("package/scripts/goodmemory-cli.js");
      expect(entries).toContain("package/scripts/goodmemory-http-bridge.js");
      expect(entries).toContain("package/scripts/goodmemory-mcp.js");
      expect(entries.some((entry) => entry.startsWith("package/src/"))).toBe(false);
      expect(
        entries.some(
          (entry) => entry.endsWith(".ts") && !entry.endsWith(".d.ts"),
        ),
      ).toBe(false);
      expect(entries).toContain("package/docs/GoodMemory-15-Minute-App-Integration.md");
      expect(entries).toContain("package/docs/GoodMemory-Inspector-and-Admin-API.md");
      expect(entries).toContain("package/docs/GoodMemory-LanguagePack-Extension-Guide.md");
      expect(entries).toContain("package/docs/GoodMemory-0.6-to-0.7-Migration-Guide.md");
      expect(entries).toContain("package/docs/GoodMemory-Reference-Integration-Guide.md");
      expect(entries).toContain("package/docs/GoodMemory-Codex-Handoff-Setup-Guide.md");
      expect(entries).toContain("package/docs/GoodMemory-Claude-Code-Setup-Guide.md");
      expect(entries).toContain("package/docs/GoodMemory-Standalone-MCP-Setup-Guide.md");
      expect(entries).toContain("package/docs/GoodMemory-Cursor-Setup-Guide.md");
      expect(entries).toContain("package/docs/GoodMemory-Gemini-CLI-Setup-Guide.md");
      expect(entries).toContain("package/docs/GoodMemory-OpenCode-Setup-Guide.md");
      expect(entries).not.toContain("package/tests/release/release.test.ts");
      expect(entries).not.toContain("package/task-board/00-README.txt");
      expect(entries).not.toContain("package/reports/quality-gates/phase-28/run-20260421093000/phase-28-quality-gate.json");
      expect(entries).not.toContain("package/.github/workflows/ci.yml");
      expect(
        entries.some((entry) => entry.startsWith("package/third-party/claude-mem-main/")),
      ).toBe(false);

      const compiledJavaScript = entries.filter(
        (entry) => entry.startsWith("package/dist/") && entry.endsWith(".js"),
      );
      const forbiddenFittedLiterals = [
        "[BEAM chat_id=",
        "external_benchmark",
        "Blue Bay Resort",
        "Lies of Locke Lamora",
        "personal and work-related challenges",
      ];
      for (const entry of compiledJavaScript) {
        const source = await readTarballEntry(tarballPath, entry);
        for (const literal of forbiddenFittedLiterals) {
          expect(source).not.toContain(literal);
        }
      }

      expect((await stat(tarballPath)).size).toBeLessThan(4 * 1024 * 1024);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("phase-28 sqlite-vss integration test uses portable runtime detection", async () => {
    const content = await readFile(
      join(import.meta.dir, "../../tests/integration/storage.sqlite-vss.test.ts"),
      "utf8",
    );

    expect(content).toContain("detectBundledSQLiteVssRuntime");
    expect(content).not.toContain("/Users/hjqcan/Documents/GoodMomery");
    expect(content).not.toContain("node_modules/sqlite-vss-darwin-arm64");
  });

  it("root exports stay aligned with the declared public surface", async () => {
    const rootModule = (await import(
      pathToFileURL(join(import.meta.dir, "../../src/index.ts")).href
    )) as Record<string, unknown>;

    expect(rootModule.createGoodMemory).toBeDefined();
    expect(rootModule.inspectGoodMemoryRuntime).toBeDefined();
    expect(rootModule.resolveGoodMemoryRuntimeInfo).toBeDefined();
    expect(rootModule.createRuntimeArchiveStore).toBeDefined();
    expect(rootModule.createRuntimeContextService).toBeDefined();
    expect(rootModule.createChineseLanguagePack).toBeDefined();
    expect(rootModule.createEnglishLanguagePack).toBeDefined();
    expect(rootModule.createJapaneseLanguagePack).toBeDefined();
    expect(rootModule.createLanguageService).toBeDefined();
    expect(rootModule.createNeutralLanguagePack).toBeDefined();
    expect(rootModule.createHostAdapter).toBeUndefined();
    expect(rootModule.createGoodMemoryAISDK).toBeUndefined();
    expect(rootModule.createGoodMemoryHttpMemoryBridge).toBeUndefined();
    expect(rootModule.createGoodMemoryRuntimeKit).toBeUndefined();
    expect(rootModule.createRuntimeViewerApp).toBeUndefined();
    expect(rootModule.serveRuntimeViewer).toBeUndefined();
    expect(rootModule.validateAgentInputEvent).toBeUndefined();
    expect(rootModule.validateHostAgentEvent).toBeUndefined();
    expect(rootModule.createMemoryRepositories).toBeUndefined();
    expect(rootModule.createRecallEngine).toBeUndefined();
    expect(rootModule.createRememberEngine).toBeUndefined();
    expect(rootModule.createRuntimeSalvageHooks).toBeUndefined();
    expect(rootModule.ExperienceRecord).toBeUndefined();
    expect(rootModule.LearningProposal).toBeUndefined();
    expect(rootModule.PromotionRecord).toBeUndefined();
    expect(rootModule.SessionArchive).toBeUndefined();
    expect(rootModule.createExperienceRecord).toBeUndefined();
    expect(rootModule.createLearningProposal).toBeUndefined();
    expect(rootModule.createPromotionRecord).toBeUndefined();
    expect(rootModule.createSessionArchive).toBeUndefined();
    expect(rootModule.EXPERIENCES_COLLECTION).toBeUndefined();
    expect(rootModule.LEARNING_PROPOSALS_COLLECTION).toBeUndefined();
    expect(rootModule.PROMOTION_RECORDS_COLLECTION).toBeUndefined();
    expect(rootModule.SESSION_ARCHIVES_COLLECTION).toBeUndefined();
  });

  it("readme links the canonical docs, examples, cli, and eval flow", async () => {
    const readme = await readFile(join(import.meta.dir, "../../README.md"), "utf8");
    const currentClaims = extractMarkedSection(readme, "current-claims-table");
    const historicalEvidence = extractMarkedSection(
      readme,
      "historical-evidence-table",
    );

    expect(readme).toContain("createGoodMemory");
    expect(readme).toContain(CURRENT_PACKAGE_VERSION);
    expect(readme).toContain("Node-compatible");
    expect(readme).toContain("Bun-backed");
    expect(readme).toContain(`npm install -g goodmemory@${CURRENT_PACKAGE_VERSION}`);
    expect(readme).toContain(`npm install goodmemory@${CURRENT_PACKAGE_VERSION}`);
    expect(readme).toContain(
      "If you want to type `goodmemory` directly, install the global CLI.",
    );
    expect(readme).toContain(
      `A project-local \`npm install goodmemory@${CURRENT_PACKAGE_VERSION}\` does not put \`goodmemory\` on your shell \`PATH\`.`,
    );
    expect(readme).toContain("npx goodmemory -V");
    expect(readme).toContain(`bun add goodmemory@${CURRENT_PACKAGE_VERSION}`);
    expect(readme).toContain(`npm install ./${CURRENT_TARBALL_NAME}`);
    expect(readme).toContain("examples/basic-chat.ts");
    expect(readme).toContain("examples/coding-agent.ts");
    expect(readme).toContain("examples/plain-ai-sdk-server.ts");
    expect(readme).toContain("examples/express-chat-server.ts");
    expect(readme).toContain("examples/fastify-chat-server.ts");
    expect(readme).toContain("examples/vercel-ai-chat.ts");
    expect(readme).toContain("examples/host-claude-artifacts.ts");
    expect(readme).toContain("examples/host-codex-handoff.ts");
    expect(readme).toContain("GoodMemory-Reference-Integration-Guide.md");
    expect(readme).toContain("GoodMemory-Codex-Handoff-Setup-Guide.md");
    expect(readme).toContain("GoodMemory-Claude-Code-Setup-Guide.md");
    expect(readme).toContain("./node_modules/.bin/goodmemory inspect");
    expect(readme).toContain("goodmemory setup --host codex");
    expect(readme).toContain("goodmemory status codex --workspace-root .");
    expect(readme).toContain("goodmemory codex bootstrap");
    expect(readme).toContain("goodmemory claude bootstrap");
    expect(readme).toContain("createGoodMemoryAISDK");
    expect(readme).toContain("goodmemory/ai-sdk");
    expect(readme).toContain("ModelMessage");
    expect(readme).toContain("toTextStreamResponse");
    expect(readme).toContain("Request");
    expect(readme).toContain('createHostAdapter');
    expect(readme).toContain('goodmemory/host');
    expect(readme).toContain("goodmemory/http");
    expect(readme).toContain("goodmemory-http-bridge");
    expect(readme).toContain('file-assisted');
    expect(readme).toContain('file-authoritative');
    expect(readme).toContain("goodmemory inspect");
    expect(readme).toContain("goodmemory setup");
    expect(readme).toContain("goodmemory status");
    expect(currentClaims).not.toContain("LoCoMo");
    expect(currentClaims).not.toContain("BEAM");
    expect(currentClaims).not.toContain("MemoryAgentBench");
    expect(historicalEvidence).toContain(
      "| LoCoMo v0.6.0 (full 10 conversations) |",
    );
    expect(historicalEvidence).toContain("official **0.8708**");
    expect(historicalEvidence).toContain("strict **0.6299**");
    expect(historicalEvidence).toContain("open-domain **0.6146** (59/96)");
    expect(historicalEvidence).toContain(
      "| BEAM 100K v0.6.0 (400 questions, 1051 rubric items) |",
    );
    expect(historicalEvidence).toContain("unified **0.7651**");
    expect(historicalEvidence).toContain("strict **0.620** (248/400)");
    expect(historicalEvidence).toContain(
      "| MemoryAgentBench v0.6.0 (CR, TTL) |",
    );
    expect(historicalEvidence).toContain("**CR 0.959, TTL 0.933**");
    expect(readme).toContain("historical 0.6 evidence");
    expect(readme).toContain("not 0.7 performance claims");
    expect(readme).toContain("provider reranking");
    expect(readme).toContain("CC BY-NC 4.0 (non-commercial scope)");
    expect(readme).not.toContain("| LoCoMo | representative conv-1 live run 0.020");
    expect(readme).toContain("## Choose Your Integration Path");
    expect(readme).toContain("GoodMemory has three primary product entry points");
    expect(readme).toContain("They are not the only APIs");
    expect(readme).toContain("### 1. Build Memory Into An Agent, Chatbox, Or Copilot");
    expect(readme).toContain("### 2. Add Memory To Codex Or Claude Code");
    expect(readme).toContain("### 3. Deploy GoodMemory As A Backend Memory-Layer Service");
    expect(readme).toContain("/memory/revise");
    expect(readme).toContain("OneLife");
    expect(readme).toContain("During a model turn, GoodMemory does four jobs");
    expect(readme).toContain("goodmemory export-memory");
    expect(readme).toContain("goodmemory stats");
    expect(readme).toContain("session-stop");
    expect(readme).toContain("goodmemory codex hook pre-tool-use");
    expect(readme).toContain(
      "goodmemory codex action -- ./tools/DeepAnalyzer --detailed",
    );
    expect(readme).toContain("Installed Host Writeback");
    expect(readme).toContain("New interactive installs recommend `selective`");
    expect(readme).toContain("goodmemory inspector serve");
    expect(readme).toContain("observe-only events it marks the candidate dismissed");
    expect(readme).toContain("goodmemory codex writeback inspect");
    expect(readme).toContain("goodmemory codex writeback forget --event-id");
    expect(readme).toContain("goodmemory eval inspect");
    expect(readme).toContain("goodmemory eval export-case");
    expect(readme).toContain("GoodMemory-Current-Status-and-Evidence.md");
    expect(readme).toContain("GoodMemory-15-Minute-App-Integration.md");
    expect(readme).toContain("GoodMemory-First-Principles-and-Reference-Architecture.md");
    expect(readme).toContain("GoodMemory-OSS-Architecture-v1.md");
    expect(readme).toContain("docs/archive/quality-gates/README.md");
    expect(readme).toContain("GoodMemory-PRD.md");
    expect(readme).toContain("GoodMemory-TDD-and-Evaluation-Strategy.md");
    expect(readme).toContain("GoodMemory-Strategy-Rollout-Guide.md");
    expect(readme).toContain("GoodMemory-0.6-to-0.7-Migration-Guide.md");
    expect(readme).toContain("bun run test:coverage");
    expect(readme).toContain("bun run gate:v0.7 --strict");
    expect(readme).toContain("bun run test:all");
    expect(readme).toContain("eval:fallback");
    expect(readme).toContain("eval:live");
    expect(readme).toContain("eval:live-memory");
    expect(readme).toContain("eval:live-auto-memory");
    expect(readme).toContain("eval:live-provider-memory");
    expect(readme).toContain("auto-storage");
    expect(readme).toContain("GOODMEMORY_TEST_POSTGRES_URL");
    expect(readme).toContain("eval:summary");
    expect(readme).toContain("observe -> assist -> promote");
    expect(readme).toContain("regression-dashboard.json");
    expect(readme).toContain("strategy-promotion-authorization.json");
    expect(readme).not.toContain("Bun-only");
    expect(readme).not.toContain("eval:full");
    expect(readme).not.toContain("GoodMemory-Phase-17-Quality-Gate.md");
    expect(readme).not.toContain("GoodMemory-Phase-18-Quality-Gate.md");
    expect(readme).not.toContain("GoodMemory-Phase-19-Reviewer-Quality-Gate.md");
    expect(readme).not.toContain("GoodMemory-Phase-19-Maintenance-Quality-Gate.md");
    expect(readme).not.toContain("GoodMemory-Phase-20-Quality-Gate.md");
    expect(readme).not.toContain("eval:phase-17");
    expect(readme).not.toContain("eval:phase-17-live-memory");
    expect(readme).not.toContain("gate:phase-18");
    expect(readme).not.toContain("gate:phase-19-reviewer");
    expect(readme).not.toContain("gate:phase-19-maintenance");
    expect(readme).not.toContain("gate:phase-20");
    expect(readme).not.toContain("goodmemory/evolution");
    expect(readme).not.toContain("strategyRollout");
    expect(readme).not.toContain("promotionGate");
    expect(readme).not.toContain("bun run cli -- inspect");
  });

  it("readme and the 15-minute guide document the current app loop", async () => {
    const readme = await readFile(join(import.meta.dir, "../../README.md"), "utf8");
    const guide = await readFile(
      join(
        import.meta.dir,
        "../../docs/GoodMemory-15-Minute-App-Integration.md",
      ),
      "utf8",
    );

    expect(readme).toContain("The core memory loop is intentionally small");
    expect(readme).toContain("`remember()` writes selected user, app, or host signals");
    expect(readme).toContain("For production app integrations");
    expect(readme).toContain("memory.runtime.startSession");
    expect(readme).toContain("memory.runtime.appendMessage");
    expect(readme).toContain("memory.jobs.enqueueRemember");
    expect(readme).toContain("memory.jobs.drain");
    expect(readme).toContain("memory.reviseMemory");
    expect(readme).toContain("GoodMemoryConfig.observability.traceSink");
    expect(readme).toContain("Runtime archive persistence is off by default");
    expect(readme).toContain("examples/express-chat-server.ts");
    expect(readme).toContain("examples/fastify-chat-server.ts");
    expect(readme).toContain("docs/GoodMemory-15-Minute-App-Integration.md");
    expect(guide).toContain("15-Minute App Integration");
    expect(guide).toContain("createGoodMemory");
    expect(guide).toContain("GoodMemoryConfig.observability.traceSink");
    expect(guide).toContain("memory.runtime.startSession");
    expect(guide).toContain("ensureSessionStarted");
    expect(guide).toContain("scopeToKey");
    expect(guide).toContain("startingSessions");
    expect(guide).toContain("memory.runtime.appendMessage");
    expect(guide).toContain("memory.recall");
    expect(guide).toContain("memory.buildContext");
    expect(guide).toContain("memory.jobs.enqueueRemember");
    expect(guide).toContain("memory.jobs.drain");
    expect(guide).toContain("idempotencyKey");
    expect(guide).toContain("memory.reviseMemory");
    expect(guide).toContain("target: { memoryId");
    expect(guide).toContain("memory.runtime.endSession");
    expect(guide).toContain("archive: \"off\"");
    expect(guide).toContain("memory.forget");
    expect(guide).toContain("memory.exportMemory");
    expect(guide).toContain("examples/express-chat-server.ts");
    expect(guide).toContain("examples/fastify-chat-server.ts");
    expect(guide).toContain("goodmemory-http-bridge");
    expect(guide).toContain("Raw transcripts are not the default memory source");
    expect(readme).not.toContain("Context:\\n${context.content}");
    expect(readme).not.toContain("context: context.content");
    expect(readme).not.toContain("Reply with the model here");
    expect(guide).not.toContain("    context,");
    expect(guide).not.toContain("    traceSpans,");
    expect(guide).not.toContain("Use this memory context");
    expect(guide).not.toContain('remember({ mode: "background" })');
    expect(guide).not.toContain("query-resolved");
  });

  it("v0.7 package metadata, stable-source docs, and machine-readable descriptors agree", async () => {
    expect(CURRENT_PACKAGE_VERSION).toBe("0.7.0");
    expect(CURRENT_TARBALL_NAME).toBe("goodmemory-0.7.0.tgz");

    const releaseDocPaths = [
      "README.md",
      "README.zh-CN.md",
    ] as const;
    const migrationGuide = await readFile(
      join(
        import.meta.dir,
        "../../docs/GoodMemory-0.6-to-0.7-Migration-Guide.md",
      ),
      "utf8",
    );
    const capability = JSON.parse(
      await readFile(
        join(import.meta.dir, "../../.well-known/goodmemory.json"),
        "utf8",
      ),
    ) as {
      releaseStatus?: {
        installCommandsApplyAfterPublish?: boolean;
        npmDistTag?: string;
        status?: string;
      };
      version?: string;
    };
    const server = JSON.parse(
      await readFile(join(import.meta.dir, "../../server.json"), "utf8"),
    ) as { packages?: Array<{ version?: string }>; version?: string };
    const mcpServer = await readFile(
      join(import.meta.dir, "../../src/install/hostMcpServer.ts"),
      "utf8",
    );

    for (const relativePath of releaseDocPaths) {
      const content = await readFile(
        join(import.meta.dir, "../../", relativePath),
        "utf8",
      );

      expect(content).toContain(CURRENT_PACKAGE_VERSION);
      expect(content).not.toContain("goodmemory@0.1.2");
      expect(content).not.toContain("goodmemory-0.1.2.tgz");
    }

    expect(capability.version).toBe(CURRENT_PACKAGE_VERSION);
    expect(capability.releaseStatus).toMatchObject({
      installCommandsApplyAfterPublish: true,
      npmDistTag: "latest",
      status: "stable",
    });
    expect(migrationGuide).toContain("GoodMemory 0.6 to 0.7 Migration Guide");
    expect(migrationGuide).toContain("historical 0.6 evidence");
    expect(server.version).toBe(CURRENT_PACKAGE_VERSION);
    expect(server.packages?.map((entry) => entry.version)).toEqual([
      CURRENT_PACKAGE_VERSION,
    ]);
    expect(mcpServer).toContain("package.json");
    expect(mcpServer).not.toContain('version: "0.1.2"');
  });

  it("ships the framework cookbooks with the docs index routing them", async () => {
    const langgraph = await readFile(
      join(import.meta.dir, "../../docs/cookbooks/langgraph.md"),
      "utf8",
    );
    expect(langgraph).toContain("createGoodMemoryLangGraphStore");
    expect(langgraph).toContain("BaseStore");

    const openaiAgents = await readFile(
      join(import.meta.dir, "../../docs/cookbooks/openai-agents-sdk.md"),
      "utf8",
    );
    expect(openaiAgents).toContain("goodmemory-client");
    expect(openaiAgents).toContain("recall_context");

    const crewai = await readFile(
      join(import.meta.dir, "../../docs/cookbooks/crewai.md"),
      "utf8",
    );
    expect(crewai).toContain("goodmemory-client");
    expect(crewai).toContain("GoodMemoryClient");

    const docsIndex = await readFile(
      join(import.meta.dir, "../../docs/README.md"),
      "utf8",
    );
    expect(docsIndex).toContain("cookbooks/langgraph.md");
    expect(docsIndex).toContain("cookbooks/openai-agents-sdk.md");
    expect(docsIndex).toContain("cookbooks/crewai.md");
  });

  it("ships the standalone MCP guide and per-host recipe docs", async () => {
    const standaloneGuide = await readFile(
      join(import.meta.dir, "../../docs/GoodMemory-Standalone-MCP-Setup-Guide.md"),
      "utf8",
    );
    expect(standaloneGuide).toContain("--standalone");
    expect(standaloneGuide).toContain("GOODMEMORY_USER_ID");
    expect(standaloneGuide).toContain("GOODMEMORY_MCP_ALLOW_WRITE");
    expect(standaloneGuide).toContain("--agent-id");
    // Bun is a hard runtime prerequisite: the goodmemory-mcp bin spawns bun.
    expect(standaloneGuide).toContain("Bun");

    const cursorGuide = await readFile(
      join(import.meta.dir, "../../docs/GoodMemory-Cursor-Setup-Guide.md"),
      "utf8",
    );
    expect(cursorGuide).toContain(".cursor/mcp.json");
    expect(cursorGuide).toContain("goodmemory-mcp");

    const geminiGuide = await readFile(
      join(import.meta.dir, "../../docs/GoodMemory-Gemini-CLI-Setup-Guide.md"),
      "utf8",
    );
    expect(geminiGuide).toContain(".gemini/settings.json");
    expect(geminiGuide).toContain("mcpServers");

    const openCodeGuide = await readFile(
      join(import.meta.dir, "../../docs/GoodMemory-OpenCode-Setup-Guide.md"),
      "utf8",
    );
    expect(openCodeGuide).toContain("opencode.json");
    expect(openCodeGuide).toContain('"type": "local"');

    const docsIndex = await readFile(
      join(import.meta.dir, "../../docs/README.md"),
      "utf8",
    );
    expect(docsIndex).toContain("GoodMemory-Standalone-MCP-Setup-Guide.md");
    expect(docsIndex).toContain("GoodMemory-Cursor-Setup-Guide.md");
    expect(docsIndex).toContain("GoodMemory-Gemini-CLI-Setup-Guide.md");
    expect(docsIndex).toContain("GoodMemory-OpenCode-Setup-Guide.md");

    const readme = await readFile(join(import.meta.dir, "../../README.md"), "utf8");
    expect(readme).toContain("goodmemory-mcp --standalone");
    expect(readme).toContain("GoodMemory-Standalone-MCP-Setup-Guide.md");
    const zhReadme = await readFile(
      join(import.meta.dir, "../../README.zh-CN.md"),
      "utf8",
    );
    expect(zhReadme).toContain("goodmemory-mcp --standalone");
    expect(zhReadme).toContain("GoodMemory-Standalone-MCP-Setup-Guide.md");
  });

  it("readme ships a Simplified Chinese product entrypoint", async () => {
    const readme = await readFile(join(import.meta.dir, "../../README.md"), "utf8");
    const zhReadme = await readFile(
      join(import.meta.dir, "../../README.zh-CN.md"),
      "utf8",
    );
    const currentClaims = extractMarkedSection(zhReadme, "current-claims-table");
    const historicalEvidence = extractMarkedSection(
      zhReadme,
      "historical-evidence-table",
    );

    expect(readme).toContain("[简体中文](./README.zh-CN.md)");
    expect(zhReadme).toContain("[English](./README.md)");
    expect(zhReadme).toContain(`# GoodMemory`);
    expect(zhReadme).toContain(CURRENT_PACKAGE_VERSION);
    expect(zhReadme).toContain(`npm install -g goodmemory@${CURRENT_PACKAGE_VERSION}`);
    expect(zhReadme).toContain(`npm install goodmemory@${CURRENT_PACKAGE_VERSION}`);
    expect(zhReadme).toContain("如果你想直接输入 `goodmemory`，必须安装全局 CLI。");
    expect(zhReadme).toContain(
      `项目内 \`npm install goodmemory@${CURRENT_PACKAGE_VERSION}\` 不会把 \`goodmemory\` 放进 shell 的 \`PATH\`。`,
    );
    expect(zhReadme).toContain("npx goodmemory -V");
    expect(zhReadme).toContain(`bun add goodmemory@${CURRENT_PACKAGE_VERSION}`);
    expect(zhReadme).toContain(`npm install ./${CURRENT_TARBALL_NAME}`);
    expect(zhReadme).toContain("goodmemory setup");
    expect(zhReadme).toContain("goodmemory status");
    expect(currentClaims).not.toContain("LoCoMo");
    expect(currentClaims).not.toContain("BEAM");
    expect(currentClaims).not.toContain("MemoryAgentBench");
    expect(historicalEvidence).toContain("| LoCoMo v0.6.0（完整 10 会话） |");
    expect(historicalEvidence).toContain("official **0.8708**");
    expect(historicalEvidence).toContain("strict **0.6299**");
    expect(historicalEvidence).toContain("open-domain **0.6146**（59/96）");
    expect(historicalEvidence).toContain(
      "| BEAM 100K v0.6.0（400 题、1051 条 rubric） |",
    );
    expect(historicalEvidence).toContain("unified **0.7651**");
    expect(historicalEvidence).toContain("strict **0.620**（248/400）");
    expect(historicalEvidence).toContain(
      "| MemoryAgentBench v0.6.0 (CR, TTL) |",
    );
    expect(historicalEvidence).toContain("**CR 0.959, TTL 0.933**");
    expect(zhReadme).toContain("provider reranking");
    expect(zhReadme).toContain("CC BY-NC 4.0（非商用范围）");
    expect(zhReadme).not.toContain("| LoCoMo | 代表性 conv-1 live 运行 0.020");
    expect(zhReadme).toContain("## 选择你的接入路径");
    expect(zhReadme).toContain("GoodMemory 有三类主要产品入口");
    expect(zhReadme).toContain("它不是只有这些 API");
    expect(zhReadme).toContain("### 1. 给其他 agent、chatbox、copilot 接入记忆");
    expect(zhReadme).toContain("### 2. 给 Codex 或 Claude Code 加强记忆");
    expect(zhReadme).toContain("### 3. 把 GoodMemory 部署成后端记忆层服务");
    expect(zhReadme).toContain("/memory/revise");
    expect(zhReadme).toContain("OneLife");
    expect(zhReadme).toContain("在一轮模型调用中，GoodMemory 做四件事");
    expect(zhReadme).toContain("Installed Host Writeback");
    expect(zhReadme).toContain("goodmemory codex hook pre-tool-use");
    expect(zhReadme).toContain(
      "goodmemory codex action -- ./tools/DeepAnalyzer --detailed",
    );
    expect(zhReadme).toContain("新的交互式安装会推荐 `selective`");
    expect(zhReadme).toContain("`off`、`observe`、`review` 或 `selective`");
    expect(zhReadme).toContain("goodmemory inspector serve");
    expect(zhReadme).toContain("`review`：把有界/redacted 候选放入 Inspector 审批队列");
    expect(zhReadme).toContain("observe-only event，它只会标记为 dismissed");
    expect(zhReadme).toContain("goodmemory codex writeback inspect");
    expect(zhReadme).toContain("goodmemory codex writeback forget --event-id");
    expect(zhReadme).toContain("createGoodMemory");
    expect(zhReadme).toContain("核心记忆闭环保持很小");
    expect(zhReadme).toContain("`remember()` 写入经过筛选的用户、应用或 host 信号");
    expect(zhReadme).toContain("生产应用接入时");
    expect(zhReadme).toContain("memory.runtime.startSession");
    expect(zhReadme).toContain("memory.jobs.enqueueRemember");
    expect(zhReadme).toContain("memory.jobs.drain");
    expect(zhReadme).toContain("GoodMemoryConfig.observability.traceSink");
    expect(zhReadme).toContain("GoodMemory-15-Minute-App-Integration.md");
    expect(zhReadme).toContain("GoodMemoryConfig.remember");
    expect(zhReadme).toContain("goodmemory/ai-sdk");
    expect(zhReadme).toContain("goodmemory/host");
    expect(zhReadme).toContain("goodmemory/http");
    expect(zhReadme).toContain("goodmemory-http-bridge");
    expect(zhReadme).toContain("./node_modules/.bin/goodmemory inspect");
    expect(zhReadme).toContain("eval:live-memory");
    expect(zhReadme).toContain("eval:live-provider-memory");
    expect(zhReadme).toContain("GOODMEMORY_TEST_POSTGRES_URL");
    expect(zhReadme).toContain("GoodMemory-Current-Status-and-Evidence.md");
    expect(zhReadme).toContain("docs/archive/quality-gates/README.md");
    expect(zhReadme).toContain("task-board/00-README.txt");
    expect(zhReadme).not.toContain("console.log(context.content)");
    expect(zhReadme).not.toContain("Context:\\n${context.content}");
    expect(zhReadme).not.toContain("context: context.content");
    expect(zhReadme).not.toContain("Bun-only");
    expect(zhReadme).not.toContain("eval:full");
    expect(zhReadme).not.toContain("goodmemory/evolution");
    expect(zhReadme).not.toContain("bun run cli -- inspect");
  });

  it("keeps the PRD on the canonical docs route used by source-of-truth navigation", async () => {
    await expectGitTrackedPath("docs/GoodMemory-PRD.md");

    const readme = await readFile(join(import.meta.dir, "../../README.md"), "utf8");
    const contributing = await readFile(
      join(import.meta.dir, "../../CONTRIBUTING.md"),
      "utf8",
    );
    const currentStatus = await readFile(
      join(import.meta.dir, "../../docs/GoodMemory-Current-Status-and-Evidence.md"),
      "utf8",
    );
    const taskBoard = await readFile(
      join(import.meta.dir, "../../task-board/00-README.txt"),
      "utf8",
    );

    expect(readme).toContain("[docs/GoodMemory-PRD.md](./docs/GoodMemory-PRD.md)");
    expect(contributing).toContain("docs/GoodMemory-PRD.md");
    expect(currentStatus).toContain("docs/GoodMemory-PRD.md");
    expect(taskBoard).toContain("docs/GoodMemory-PRD.md");
    expect(readme).not.toContain("docs/archive/GoodMemory-PRD.md");
    expect(currentStatus).not.toContain("docs/archive/GoodMemory-PRD.md");
  });

  it("installed-package CLI contract stays on the published bin path", async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-cli-contract-consumer-"),
    );
    const packOutputDir = await mkdtemp(
      join(tmpdir(), "goodmemory-cli-contract-pack-"),
    );

    try {
      const { tarballPath } = await packReleaseTarball(packOutputDir);
      await writeFile(
        join(workspaceRoot, "package.json"),
        JSON.stringify(
          {
            name: "goodmemory-cli-contract-consumer",
            private: true,
            dependencies: {
              goodmemory: `file:${tarballPath}`,
            },
            scripts: {
              goodmemory: "echo consumer-script",
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const install = await runCommand({
        cmd: ["bun", "install"],
        cwd: workspaceRoot,
      });
      expect(install.exitCode).toBe(0);

      const shadowed = await runCommand({
        cmd: ["bun", "run", "goodmemory", "--", "--help"],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(shadowed.exitCode).toBe(0);
      expect(shadowed.stdout).toContain("consumer-script --help");

      const binHelp = await runCommand({
        cmd: ["./node_modules/.bin/goodmemory", "--help"],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(binHelp.exitCode).toBe(0);
      expect(binHelp.stdout).toContain("GoodMemory CLI");
      expect(binHelp.stdout).toContain("setup           Configure GoodMemory memory enhancement for installed hosts");
      expect(binHelp.stdout).toContain("inspect         Inspect scope-bounded memory");
      expect(binHelp.stdout).toContain("status          Show installed host memory enhancement status");
      expect(binHelp.stdout).toContain("codex           Codex bootstrap and installed hook commands");
      expect(binHelp.stdout).toContain("claude          Claude Code bootstrap and installed hook commands");
      expect(binHelp.stdout).toContain("eval            Inspect eval run artifacts");

      const setupHelp = await runCommand({
        cmd: ["./node_modules/.bin/goodmemory", "setup", "--help"],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(setupHelp.exitCode).toBe(0);
      expect(setupHelp.stdout).toContain("GoodMemory Setup CLI");

      const statusHelp = await runCommand({
        cmd: ["./node_modules/.bin/goodmemory", "status", "--help"],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(statusHelp.exitCode).toBe(0);
      expect(statusHelp.stdout).toContain("GoodMemory Status CLI");
    } finally {
      await rm(packOutputDir, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it("installed-package Python bridge smoke covers goodmemory-http-bridge bin and Python consumer", async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-python-bridge-consumer-"),
    );
    const packOutputDir = await mkdtemp(
      join(tmpdir(), "goodmemory-python-bridge-pack-"),
    );
    let serverStdoutPromise: Promise<string> = Promise.resolve("");
    let serverStderrPromise: Promise<string> = Promise.resolve("");
    let stopServer = async (): Promise<void> => undefined;

    try {
      const { tarballPath } = await packReleaseTarball(packOutputDir);
      await writeFile(
        join(workspaceRoot, "package.json"),
        JSON.stringify(
          {
            name: "goodmemory-python-bridge-consumer",
            private: true,
            dependencies: {
              goodmemory: `file:${tarballPath}`,
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      await cp(
        join(ROOT_PACKAGE_PATH, "examples/python-fastapi-memory-consumer.py"),
        join(workspaceRoot, "python-fastapi-memory-consumer.py"),
      );

      const install = await runCommand({
        cmd: ["bun", "install"],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(install.exitCode).toBe(0);

      const port = allocateReleaseBridgePort();
      const token = "phase-40-python-bridge-release-token";
      const url = `http://127.0.0.1:${port}`;
      const serverProcess = Bun.spawn({
        cmd: [
          "./node_modules/.bin/goodmemory-http-bridge",
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--profile",
          "life-coach",
          "--token",
          token,
        ],
        cwd: workspaceRoot,
        env: createChildEnv({
          ...RELEASE_TEST_ENV,
          GOODMEMORY_STORAGE_PROVIDER: "memory",
        }),
        stderr: "pipe",
        stdout: "pipe",
      });
      serverStdoutPromise = new Response(serverProcess.stdout).text();
      serverStderrPromise = new Response(serverProcess.stderr).text();
      stopServer = async () => {
        serverProcess.kill("SIGTERM");
        await serverProcess.exited;
      };

      await waitForReleaseBridgeReady({ token, url });

      const python = await runCommand({
        cmd: ["python3", "python-fastapi-memory-consumer.py"],
        cwd: workspaceRoot,
        env: {
          ...RELEASE_TEST_ENV,
          GOODMEMORY_BRIDGE_TOKEN: token,
          GOODMEMORY_BRIDGE_URL: url,
        },
      });
      expect(python.exitCode).toBe(0);
      expect(python.stderr).toBe("");
      const payload = JSON.parse(python.stdout) as {
        feedbackAccepted: boolean;
        hasContext: boolean;
        itemCount: number;
        revised: boolean;
      };

      expect(payload.hasContext).toBe(true);
      expect(payload.itemCount).toBeGreaterThanOrEqual(1);
      expect(payload.feedbackAccepted).toBe(true);
      expect(payload.revised).toBe(true);
    } finally {
      await stopServer();
      await rm(packOutputDir, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }

    const [serverStdout, serverStderr] = await Promise.all([
      serverStdoutPromise,
      serverStderrPromise,
    ]);
    expect(serverStdout).toContain('"event":"ready"');
    expect(serverStdout).toContain('"auth":"bearer"');
    expect(serverStderr).not.toContain("Cannot find module");
    expect(serverStderr).not.toContain("ERR_MODULE_NOT_FOUND");
  }, 30_000);

  it("current top-level docs use the package-bin memory-first CLI contract", async () => {
    const readme = await readFile(join(import.meta.dir, "../../README.md"), "utf8");
    const architecture = await readFile(
      join(import.meta.dir, "../../docs/GoodMemory-OSS-Architecture-v1.md"),
      "utf8",
    );
    const currentStatus = await readFile(
      join(import.meta.dir, "../../docs/GoodMemory-Current-Status-and-Evidence.md"),
      "utf8",
    );
    const checklist = await readFile(
      join(import.meta.dir, "../../docs/GoodMemory-v1-Release-Checklist.md"),
      "utf8",
    );

    for (const content of [
      readme,
      architecture,
      currentStatus,
      checklist,
    ]) {
      expect(content).not.toContain("bun run cli --");
      expect(content).not.toContain("bun run goodmemory --");
      expect(content).not.toContain("npx goodmemory inspect <userId>");
      expect(content).not.toContain("npx goodmemory trace <userId> <sessionId>");
      expect(content).not.toContain("npx goodmemory export <userId>");
    }

    expect(readme).toContain("./node_modules/.bin/goodmemory inspect --user-id");
    expect(readme).toContain("./node_modules/.bin/goodmemory eval inspect");
    expect(architecture).toContain("./node_modules/.bin/goodmemory inspect --user-id");
    expect(architecture).toContain("./node_modules/.bin/goodmemory export-memory");
    expect(architecture).toContain("./node_modules/.bin/goodmemory eval inspect");
    expect(currentStatus).toContain(
      "global CLI invocation path is `goodmemory ...` after `npm install -g goodmemory`",
    );
    expect(checklist).toContain(
      "the global CLI works through `goodmemory ...` after `npm install -g goodmemory`",
    );
  });

  it("phase-27 canonical guides and examples use public imports only", async () => {
    const files = [
      "README.md",
      "docs/GoodMemory-Reference-Integration-Guide.md",
      "docs/GoodMemory-Codex-Handoff-Setup-Guide.md",
      "docs/GoodMemory-Claude-Code-Setup-Guide.md",
      "examples/basic-chat.ts",
      "examples/coding-agent.ts",
      "examples/plain-ai-sdk-server.ts",
      "examples/express-chat-server.ts",
      "examples/fastify-chat-server.ts",
      "examples/host-claude-artifacts.ts",
      "examples/host-codex-handoff.ts",
      "examples/vercel-ai-chat.ts",
      "tests/consumers/reference-package-smoke/smoke.mjs",
      "tests/consumers/reference-package-smoke/smoke-types.ts",
      "tests/consumers/bootstrap-package-smoke/seed.mjs",
    ] as const;

    for (const relativePath of files) {
      const content = await readFile(
        join(import.meta.dir, "../../", relativePath),
        "utf8",
      );

      expect(content).not.toContain("../src");
      expect(content).not.toContain("../../src");
    }

    const referenceGuide = await readFile(
      join(
        import.meta.dir,
        "../../docs/GoodMemory-Reference-Integration-Guide.md",
      ),
      "utf8",
    );
    expect(referenceGuide).toContain('from "goodmemory"');
    expect(referenceGuide).toContain('from "goodmemory/ai-sdk"');
    expect(referenceGuide).toContain("createGoodMemory({})");
    expect(referenceGuide).toContain("Request");
    expect(referenceGuide).toContain("toTextStreamResponse");
    expect(referenceGuide).toContain("plain-ai-sdk-server");
    expect(referenceGuide).toContain(
      `npm install goodmemory@${CURRENT_PACKAGE_VERSION}`,
    );
    expect(referenceGuide).toContain(`bun add goodmemory@${CURRENT_PACKAGE_VERSION}`);
    expect(referenceGuide).toContain(`npm install ./${CURRENT_TARBALL_NAME}`);
    expect(referenceGuide).toContain("Node");
    expect(referenceGuide).toContain("Bun");

    const codexGuide = await readFile(
      join(
        import.meta.dir,
        "../../docs/GoodMemory-Codex-Handoff-Setup-Guide.md",
      ),
      "utf8",
    );
    expect(codexGuide).toContain('from "goodmemory"');
    expect(codexGuide).toContain('from "goodmemory/host"');
    expect(codexGuide).toContain(`npm install -g goodmemory@${CURRENT_PACKAGE_VERSION}`);
    expect(codexGuide).toContain("goodmemory setup --host codex");
    expect(codexGuide).toContain(
      "Local package installs do not put `goodmemory` on your shell `PATH`.",
    );
    expect(codexGuide).toContain(`bun add goodmemory@${CURRENT_PACKAGE_VERSION}`);
    expect(codexGuide).toContain("Bun-backed");
    expect(codexGuide).toContain("codex-action.mjs");
    expect(codexGuide).toContain(".codex/hooks.json");
    expect(codexGuide).toContain("canonical enforced path");

    const claudeGuide = await readFile(
      join(
        import.meta.dir,
        "../../docs/GoodMemory-Claude-Code-Setup-Guide.md",
      ),
      "utf8",
    );
    expect(claudeGuide).toContain('from "goodmemory"');
    expect(claudeGuide).toContain('from "goodmemory/host"');
    expect(claudeGuide).toContain(
      `npm install -g goodmemory@${CURRENT_PACKAGE_VERSION}`,
    );
    expect(claudeGuide).toContain("goodmemory setup --host claude");
    expect(claudeGuide).toContain(
      "Local package installs do not put `goodmemory` on your shell `PATH`.",
    );
    expect(claudeGuide).toContain(`bun add goodmemory@${CURRENT_PACKAGE_VERSION}`);
    expect(claudeGuide).toContain("Bun-backed");
  });

  it("package-boundary reference consumer smoke uses package-name imports only", async () => {
    const fixtureRoot = join(
      import.meta.dir,
      "../../tests/consumers/reference-package-smoke",
    );
    const smokeSource = await readFile(join(fixtureRoot, "smoke.mjs"), "utf8");
    const importSpecifiers = [...smokeSource.matchAll(/from "([^"]+)"/g)].map(
      (match) => match[1],
    );
    const smokeTypesSource = await readFile(
      join(fixtureRoot, "smoke-types.ts"),
      "utf8",
    );
    const smokeTypeImportSpecifiers = [
      ...smokeTypesSource.matchAll(/from "([^"]+)"/g),
    ].map((match) => match[1]);
    const uniqueSmokeTypeImportSpecifiers = [...new Set(smokeTypeImportSpecifiers)];
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-reference-consumer-"),
    );
    const packOutputDir = await mkdtemp(
      join(tmpdir(), "goodmemory-reference-pack-"),
    );

    try {
      expect(importSpecifiers).toEqual([
        "goodmemory",
        "goodmemory/ai-sdk",
        "goodmemory/host",
        "goodmemory/http",
      ]);
      expect(uniqueSmokeTypeImportSpecifiers).toEqual([
        "goodmemory",
        "goodmemory/ai-sdk",
        "goodmemory/host",
        "goodmemory/http",
      ]);

      const { tarballPath } = await packReleaseTarball(packOutputDir);
      await cp(fixtureRoot, workspaceRoot, { recursive: true });

      const packageJsonPath = join(workspaceRoot, "package.json");
      const packageJson = await readFile(packageJsonPath, "utf8");
      await writeFile(
        packageJsonPath,
        packageJson.replace(
          "__GOODMEMORY_PACKAGE_SPEC__",
          `file:${tarballPath}`,
        ),
        "utf8",
      );

      const install = await runCommand({
        cmd: ["bun", "install"],
        cwd: workspaceRoot,
      });
      expect(install.exitCode).toBe(0);
      const smoke = await runCommand({
        cmd: ["bun", "run", "smoke"],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(smoke.exitCode).toBe(0);
      const smokeJson = extractJsonObject<{
        aiSDKResponseText: string;
        artifactPaths: string[];
        contextIncludesChecklist: boolean;
        httpBridgeContextIncludesPackageImport: boolean;
        httpBridgeItemCount: number;
        httpBridgeRememberOk: boolean;
        invalidScopeError?: string;
        invalidScopeStatus: number;
        frenchPackId: string;
        frenchSearchTerms: string[];
        japanesePackId: string;
        japaneseSearchTerms: string[];
        koreanPackId: string;
        koreanSearchTerms: string[];
        ok: boolean;
        recallHitCount: number;
        serverRecallApplied: boolean;
        serverRememberSucceeded: boolean;
        spanishPackId: string;
        spanishSearchTerms: string[];
        traditionalChinesePackId: string;
        traditionalChineseSearchTerms: string[];
        validatedFileEditPath?: string;
        validatedToolPayloadShape?: string;
      }>(smoke.stdout);
      expect(smokeJson.ok).toBe(true);
      expect(smokeJson.aiSDKResponseText).toContain("Noted.");
      expect(smokeJson.contextIncludesChecklist).toBe(true);
      expect(smokeJson.httpBridgeRememberOk).toBe(true);
      expect(smokeJson.httpBridgeContextIncludesPackageImport).toBe(true);
      expect(smokeJson.httpBridgeItemCount).toBeGreaterThan(0);
      expect(smokeJson.invalidScopeStatus).toBe(400);
      expect(smokeJson.invalidScopeError).toContain("scope.userId");
      expect(smokeJson.frenchPackId).toBe("fr");
      expect(smokeJson.frenchSearchTerms).toContain("mémoire");
      expect(smokeJson.japanesePackId).toBe("ja");
      expect(smokeJson.japaneseSearchTerms).toContain("日本語");
      expect(smokeJson.koreanPackId).toBe("ko");
      expect(smokeJson.koreanSearchTerms).toContain("한국어");
      expect(smokeJson.spanishPackId).toBe("es");
      expect(smokeJson.spanishSearchTerms).toContain("memoria");
      expect(smokeJson.recallHitCount).toBeGreaterThan(0);
      expect(smokeJson.serverRecallApplied).toBe(true);
      expect(smokeJson.serverRememberSucceeded).toBe(true);
      expect(smokeJson.traditionalChinesePackId).toBe("zh-Hant");
      expect(smokeJson.traditionalChineseSearchTerms).toContain("繁體");
      expect(smokeJson.artifactPaths).toContain("MEMORY.md");
      expect(smokeJson.validatedToolPayloadShape).toBe("object");
      expect(smokeJson.validatedFileEditPath).toBe(
        "playbooks/consumer-checklist.md",
      );

      const typeSmoke = await runCommand({
        cmd: [
          join(ROOT_PACKAGE_PATH, "node_modules/.bin/tsc"),
          "-p",
          "tsconfig.json",
          "--noEmit",
        ],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(typeSmoke.exitCode).toBe(0);

      const stats = await runCommand({
        cmd: [
          "./node_modules/.bin/goodmemory",
          "stats",
          "--json",
          "--user-id",
          "consumer-memory-user",
          "--workspace-id",
          "consumer-memory-workspace",
        ],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(stats.exitCode).toBe(0);
      const statsJson = extractJsonObject<{
        counts?: {
          facts?: number;
        };
        storage?: {
          provider?: string;
        };
      }>(stats.stdout);
      expect(statsJson.storage?.provider).toBe("sqlite");
      expect(statsJson.counts?.facts).toBeGreaterThan(0);

    } finally {
      await rm(packOutputDir, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it("package-boundary bootstrap consumer smoke scaffolds and exports Codex and Claude artifacts", async () => {
    const fixtureRoot = join(
      import.meta.dir,
      "../../tests/consumers/bootstrap-package-smoke",
    );
    const seedSource = await readFile(join(fixtureRoot, "seed.mjs"), "utf8");
    const seedImportSpecifiers = [...seedSource.matchAll(/from "([^"]+)"/g)].map(
      (match) => match[1],
    );
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-bootstrap-consumer-"),
    );
    const packOutputDir = await mkdtemp(
      join(tmpdir(), "goodmemory-bootstrap-pack-"),
    );

    try {
      expect(seedImportSpecifiers).toEqual(["node:path", "goodmemory"]);

      const { tarballPath } = await packReleaseTarball(packOutputDir);
      await cp(fixtureRoot, workspaceRoot, { recursive: true });

      const packageJsonPath = join(workspaceRoot, "package.json");
      const packageJson = await readFile(packageJsonPath, "utf8");
      await writeFile(
        packageJsonPath,
        packageJson.replace(
          "__GOODMEMORY_PACKAGE_SPEC__",
          `file:${tarballPath}`,
        ),
        "utf8",
      );

      const install = await runCommand({
        cmd: ["bun", "install"],
        cwd: workspaceRoot,
      });
      expect(install.exitCode).toBe(0);

      const seed = await runCommand({
        cmd: ["bun", "run", "seed"],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(seed.exitCode).toBe(0);

      const codexBootstrap = await runCommand({
        cmd: [
          "./node_modules/.bin/goodmemory",
          "codex",
          "bootstrap",
          "--user-id",
          "consumer-user",
          "--workspace-id",
          "consumer-workspace",
          "--json",
        ],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(codexBootstrap.exitCode).toBe(0);
      const codexBootstrapJson = extractJsonObject<{
        changes: Array<{ relativePath: string }>;
        host: string;
      }>(codexBootstrap.stdout);
      expect(codexBootstrapJson.host).toBe("codex");
      expect(codexBootstrapJson.changes.some((change) => change.relativePath === "AGENTS.md")).toBe(
        true,
      );
      expect(
        codexBootstrapJson.changes.some(
          (change) => change.relativePath === ".goodmemory/bootstrap/codex-action.mjs",
        ),
      ).toBe(true);
      expect(
        codexBootstrapJson.changes.some(
          (change) => change.relativePath === ".codex/hooks.json",
        ),
      ).toBe(true);
      expect(
        codexBootstrapJson.changes.some(
          (change) => change.relativePath === ".codex/config.toml",
        ),
      ).toBe(true);
      expect(
        codexBootstrapJson.changes.some(
          (change) => change.relativePath === "codex/rules/goodmemory.rules",
        ),
      ).toBe(true);

      const claudeBootstrap = await runCommand({
        cmd: [
          "./node_modules/.bin/goodmemory",
          "claude",
          "bootstrap",
          "--user-id",
          "consumer-user",
          "--workspace-id",
          "consumer-workspace",
          "--json",
        ],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(claudeBootstrap.exitCode).toBe(0);
      const claudeBootstrapJson = extractJsonObject<{
        changes: Array<{ relativePath: string }>;
        host: string;
      }>(claudeBootstrap.stdout);
      expect(claudeBootstrapJson.host).toBe("claude");
      expect(
        claudeBootstrapJson.changes.some((change) => change.relativePath === "CLAUDE.md"),
      ).toBe(true);

      const codexScript = await readFile(
        join(workspaceRoot, ".goodmemory/bootstrap/codex-export.mjs"),
        "utf8",
      );
      expect(codexScript).toContain('import("goodmemory")');
      expect(codexScript).toContain('import("goodmemory/host")');
      expect(codexScript).not.toContain("../src");
      expect(codexScript).not.toContain("../../src");
      const codexActionScript = await readFile(
        join(workspaceRoot, ".goodmemory/bootstrap/codex-action.mjs"),
        "utf8",
      );
      expect(codexActionScript).toContain('from "goodmemory"');
      expect(codexActionScript).toContain('from "goodmemory/host"');
      expect(codexActionScript).toContain("resolveHostActionExecutionPlan");
      expect(codexActionScript).not.toContain("../src");
      expect(codexActionScript).not.toContain("../../src");
      const codexHooksConfig = await readFile(
        join(workspaceRoot, ".codex/hooks.json"),
        "utf8",
      );
      expect(codexHooksConfig).toContain("PreToolUse");
      expect(codexHooksConfig).toContain("codex-action.mjs");
      const codexHooksToml = await readFile(
        join(workspaceRoot, ".codex/config.toml"),
        "utf8",
      );
      expect(codexHooksToml).toContain("[features]");
      expect(codexHooksToml).toContain("hooks = true");
      const codexRules = await readFile(
        join(workspaceRoot, "codex/rules/goodmemory.rules"),
        "utf8",
      );
      expect(codexRules).toContain('pattern = ["deploy"]');
      expect(codexRules).toContain('pattern = ["rm", "-rf"]');

      const claudeScript = await readFile(
        join(workspaceRoot, ".goodmemory/bootstrap/claude-export.mjs"),
        "utf8",
      );
      expect(claudeScript).toContain('import("goodmemory")');
      expect(claudeScript).toContain('import("goodmemory/host")');
      expect(claudeScript).not.toContain("../src");
      expect(claudeScript).not.toContain("../../src");

      const codexExport = await runCommand({
        cmd: [
          "bun",
          "./.goodmemory/bootstrap/codex-export.mjs",
          "--session-id",
          "consumer-session",
        ],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(codexExport.exitCode).toBe(0);
      const codexExportJson = extractJsonObject<{
        artifactCount: number;
      }>(codexExport.stdout);
      expect(codexExportJson.artifactCount).toBeGreaterThan(0);

      const claudeExport = await runCommand({
        cmd: ["bun", "./.goodmemory/bootstrap/claude-export.mjs"],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(claudeExport.exitCode).toBe(0);
      const claudeExportJson = extractJsonObject<{
        artifactCount: number;
      }>(claudeExport.stdout);
      expect(claudeExportJson.artifactCount).toBeGreaterThan(0);

      const sessionHandoff = await readFile(
        join(
          workspaceRoot,
          ".goodmemory/hosts/codex/session-memory/current.md",
        ),
        "utf8",
      );
      expect(sessionHandoff).toContain("Finish the bootstrap smoke path");
      expect(sessionHandoff).toContain("Verify exported session handoff");

      const claudeMemory = await readFile(
        join(workspaceRoot, ".goodmemory/hosts/claude/MEMORY.md"),
        "utf8",
      );
      expect(claudeMemory).toContain("smoke verification");

      const codexManifest = JSON.parse(
        await readFile(
          join(workspaceRoot, ".goodmemory/hosts/codex/export-manifest.json"),
          "utf8",
        ),
      ) as {
        artifacts: Array<{
          relativePath?: string;
        }>;
        host: string;
        scope: {
          sessionId?: string;
        };
      };
      expect(codexManifest.host).toBe("codex");
      expect(codexManifest.scope.sessionId).toBe("consumer-session");
      expect(
        codexManifest.artifacts.some(
          (artifact) => artifact.relativePath === "session-memory/current.md",
        ),
      ).toBe(true);

      const claudeManifest = JSON.parse(
        await readFile(
          join(workspaceRoot, ".goodmemory/hosts/claude/export-manifest.json"),
          "utf8",
        ),
      ) as {
        host: string;
        scope: {
          workspaceId?: string;
        };
      };
      expect(claudeManifest.host).toBe("claude");
      expect(claudeManifest.scope.workspaceId).toBe("consumer-workspace");
    } finally {
      await rm(packOutputDir, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it("installed-package write CLI smoke covers write -> hook recall -> MCP deep read", async () => {
    const fixtureRoot = join(
      import.meta.dir,
      "../../tests/consumers/bootstrap-package-smoke",
    );
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-write-cli-consumer-"),
    );
    const homeRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-write-cli-home-"),
    );
    const packOutputDir = await mkdtemp(
      join(tmpdir(), "goodmemory-write-cli-pack-"),
    );
    let transport: StdioClientTransport | null = null;

    try {
      const { tarballPath } = await packReleaseTarball(packOutputDir);
      await cp(fixtureRoot, workspaceRoot, { recursive: true });

      const packageJsonPath = join(workspaceRoot, "package.json");
      const packageJson = await readFile(packageJsonPath, "utf8");
      await writeFile(
        packageJsonPath,
        packageJson.replace(
          "__GOODMEMORY_PACKAGE_SPEC__",
          `file:${tarballPath}`,
        ),
        "utf8",
      );

      const install = await runCommand({
        cmd: ["bun", "install"],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(install.exitCode).toBe(0);

      expect(
        (
          await runCommand({
            cmd: [
              "./node_modules/.bin/goodmemory",
              "install",
              "codex",
              "--user-id",
              "consumer-user",
              "--json",
            ],
            cwd: workspaceRoot,
            env: {
              ...RELEASE_TEST_ENV,
              GOODMEMORY_HOME: homeRoot,
            },
          })
        ).exitCode,
      ).toBe(0);

      expect(
        (
          await runCommand({
            cmd: [
              "./node_modules/.bin/goodmemory",
              "enable",
              "codex",
              "--workspace-id",
              "consumer-workspace",
              "--workspace-root",
              workspaceRoot,
              "--json",
            ],
            cwd: workspaceRoot,
            env: {
              ...RELEASE_TEST_ENV,
              GOODMEMORY_HOME: homeRoot,
            },
          })
        ).exitCode,
      ).toBe(0);

      const feedback = await runCommand({
        cmd: [
          "./node_modules/.bin/goodmemory",
          "feedback",
          "--host",
          "codex",
          "--workspace-root",
          workspaceRoot,
          "--session-id",
          "consumer-session",
          "--signal",
          "Keep coding summaries short and list explicit next steps.",
          "--json",
        ],
        cwd: workspaceRoot,
        env: {
          ...RELEASE_TEST_ENV,
          GOODMEMORY_HOME: homeRoot,
        },
      });
      expect(feedback.exitCode).toBe(0);
      const feedbackJson = extractJsonObject<{
        accepted: boolean;
        memoryId?: string;
        scope: {
          agentId?: string;
          sessionId?: string;
          userId: string;
          workspaceId?: string;
        };
      }>(feedback.stdout);
      expect(feedbackJson.accepted).toBe(true);
      expect(feedbackJson.memoryId).toBeDefined();
      expect(feedbackJson.scope).toEqual({
        agentId: "codex",
        sessionId: "consumer-session",
        userId: "consumer-user",
        workspaceId: "consumer-workspace",
      });

      const remember = await runCommand({
        cmd: [
          "./node_modules/.bin/goodmemory",
          "remember",
          "--host",
          "codex",
          "--workspace-root",
          workspaceRoot,
          "--session-id",
          "consumer-session",
          "--message",
          "Remember that the deploy is blocked on smoke verification.",
          "--json",
        ],
        cwd: workspaceRoot,
        env: {
          ...RELEASE_TEST_ENV,
          GOODMEMORY_HOME: homeRoot,
        },
      });
      expect(remember.exitCode).toBe(0);
      const rememberJson = extractJsonObject<{
        accepted: number;
      }>(remember.stdout);
      expect(rememberJson.accepted).toBeGreaterThan(0);

      const hook = await runCommand({
        cmd: [
          "./node_modules/.bin/goodmemory",
          "codex",
          "hook",
          "user-prompt-submit",
        ],
        cwd: workspaceRoot,
        env: {
          ...RELEASE_TEST_ENV,
          GOODMEMORY_HOME: homeRoot,
        },
        stdin: JSON.stringify({
          cwd: workspaceRoot,
          prompt: "Summarize my preferred style and current blocker before you answer.",
          session_id: "consumer-session",
        }),
      });
      expect(hook.exitCode).toBe(0);
      expect(hook.stdout).toContain(
        "Keep coding summaries short and list explicit next steps.",
      );
      expect(hook.stdout).toContain("smoke verification");

      const emptyHook = await runCommand({
        cmd: [
          "./node_modules/.bin/goodmemory",
          "codex",
          "hook",
          "user-prompt-submit",
        ],
        cwd: workspaceRoot,
        env: {
          ...RELEASE_TEST_ENV,
          GOODMEMORY_HOME: homeRoot,
        },
        stdin: "",
      });
      expect(emptyHook.exitCode).toBe(0);
      expect(emptyHook.stdout.trim()).toBe("{}");
      expect(emptyHook.stderr.trim()).toBe("");

      transport = new StdioClientTransport({
        args: ["--host", "codex"],
        command: "./node_modules/.bin/goodmemory-mcp",
        cwd: workspaceRoot,
        env: createChildEnv({
          ...RELEASE_TEST_ENV,
          GOODMEMORY_HOME: homeRoot,
        }),
        stderr: "pipe",
      });

      const client = new Client(
        {
          name: "goodmemory-release-write-smoke",
          version: "0.0.0",
        },
        {
          capabilities: {},
        },
      );
      await client.connect(transport);

      const stats = await client.callTool({
        arguments: {
          cwd: workspaceRoot,
          sessionId: "consumer-session",
        },
        name: "goodmemory_stats",
      });
      expect(stats.structuredContent).toMatchObject({
        counts: {
          facts: 1,
          feedback: 1,
        },
        scope: {
          agentId: "codex",
          sessionId: "consumer-session",
          userId: "consumer-user",
          workspaceId: "consumer-workspace",
        },
      });

      const context = await client.callTool({
        arguments: {
          cwd: workspaceRoot,
          query: "Summarize my preferred style and current blocker before you answer.",
          sessionId: "consumer-session",
        },
        name: "goodmemory_get_context",
      });
      expect(context.structuredContent).toMatchObject({
        query: "Summarize my preferred style and current blocker before you answer.",
      });
      expect(JSON.stringify(context.structuredContent)).toContain(
        "Keep coding summaries short and list explicit next steps.",
      );
      expect(JSON.stringify(context.structuredContent)).toContain(
        "smoke verification",
      );
    } finally {
      if (transport) {
        await transport.close();
      }
      await rm(packOutputDir, { recursive: true, force: true });
      await rm(homeRoot, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it("release checklist exists and covers the final gate", async () => {
    const checklist = await readFile(
      join(import.meta.dir, "../../docs/GoodMemory-v1-Release-Checklist.md"),
      "utf8",
    );

    expect(checklist).toContain("CLI");
    expect(checklist).toContain("Examples");
    expect(checklist).toContain("Eval");
    expect(checklist).toContain("Quality Gate");
    expect(checklist).toContain("Package Boundary");
    expect(checklist).toContain("bun test");
    expect(checklist).toContain("bun run test:coverage");
    expect(checklist).toContain("bun pm pack --dry-run");
    expect(checklist).toContain(CURRENT_PACKAGE_VERSION);
    expect(checklist).toContain("Node");
    expect(checklist).toContain("Bun");
    expect(checklist).toContain("gate:phase-37");
    expect(checklist).toContain("gate:phase-38");
    expect(checklist).toContain("gate:phase-39");
    expect(checklist).toContain("gate:phase-40");
    expect(checklist).toContain("tarball");
    expect(checklist).toContain("eval:live");
    expect(checklist).toContain("eval:live-memory");
    expect(checklist).toContain("eval:live-provider-memory");
    expect(checklist).toContain("eval:phase-40-cross-consumer");
    expect(checklist).toContain(
      "reports/eval/adoption/phase-40/run-20260425163012-cross-consumer/report.json",
    );
    expect(checklist).toContain("eval:phase-40-product");
    expect(checklist).toContain(
      "reports/eval/product/phase-40/run-20260425165544-product-eval/report.json",
    );
    expect(checklist).toContain(
      "reports/quality-gates/phase-40/run-20260425172323/phase-40-quality-gate.json",
    );
    expect(checklist).toContain("GoodMemory-Phase-40-Quality-Gate.md");
    expect(checklist).toContain("Strategy Rollout");
    expect(checklist).toContain("strategy-promotion-gate.json");
    expect(checklist).toContain("strategy-promotion-authorization.json");
    expect(checklist).toContain("regression-dashboard.json");
    expect(checklist).toContain("public-surface-decision.json");
    expect(checklist).toContain("GoodMemory-Current-Status-and-Evidence.md");
    expect(checklist).toContain("docs/archive/quality-gates/README.md");
    expect(checklist).toContain("GoodMemory-Strategy-Rollout-Guide.md");
    expect(checklist).toContain("rules-only");
    expect(checklist).toContain("salvage hooks");
    expect(checklist).not.toContain("eval:full");
    expect(checklist).not.toContain("GoodMemory-Phase-17-Quality-Gate.md");
    expect(checklist).not.toContain("GoodMemory-Phase-19-Reviewer-Quality-Gate.md");
    expect(checklist).not.toContain("GoodMemory-Phase-19-Maintenance-Quality-Gate.md");
    expect(checklist).not.toContain("GoodMemory-Phase-20-Quality-Gate.md");
    expect(checklist).not.toContain("gate:phase-19-reviewer");
    expect(checklist).not.toContain("gate:phase-19-maintenance");
    expect(checklist).not.toContain("gate:phase-20");
    expect(checklist).not.toContain("strategyRollout");
    expect(checklist).not.toContain("promotionGate");
  }, 60_000);

  it("current status doc points to the stable evidence entrypoints and archive", async () => {
    const currentStatus = await readFile(
      join(
        import.meta.dir,
        "../../docs/GoodMemory-Current-Status-and-Evidence.md",
      ),
      "utf8",
    );

    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-20-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-20/run-20260420023503/phase-20-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-22-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "reports/eval/live-memory/phase-22/run-1776650772564-assist/report.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-23-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "reports/eval/live-memory/phase-23/run-1776658376536-promote/report.json",
    );
    expect(currentStatus).toContain("task-board/00-README.txt");
    expect(currentStatus).toContain("docs/archive/quality-gates/README.md");
    expect(currentStatus).toContain(
      "There are no current `v0.7.0` benchmark claims",
    );
    expect(currentStatus).toContain(
      "BEAM 100K (unified 0.7651 / strict 0.620 / recall 0.8276)",
    );
    expect(currentStatus).toContain(
      "LongMemEval and ImplicitMemBench remain versioned internal evidence",
    );
    expect(currentStatus).toContain(
      "README current-claim tables are empty",
    );
    expect(currentStatus).not.toContain(
      "Full ImplicitMemBench and BEAM reports are internal research evidence until explicitly promoted.",
    );
    expect(currentStatus).toContain(
      "LoCoMo's historical `v0.6.0` public-opt-in declaration covers all 1540 non-adversarial questions",
    );
    expect(currentStatus).toContain(
      "Phase 65 case-level hardening is paused; Phase 69 owns generalized candidate admission and noise control.",
    );
    expect(currentStatus).toContain(
      "The Phase 72 benchmark gate and versioned release gate are closed",
    );
    expect(currentStatus).not.toContain("it is not yet promoted to README");
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-29-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-29/run-20260421213000/phase-29-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-29/run-20260421214500/phase-29-rc-dry-run.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-30-Quality-Gate.md",
    );
    expect(currentStatus).toContain("goodmemory setup");
    expect(currentStatus).toContain("goodmemory status");
    expect(currentStatus).toContain("SessionStart` / `UserPromptSubmit` hooks");
    expect(currentStatus).toContain("Phase 37 is now closed as the installed host selective writeback slice");
    expect(currentStatus).toContain("goodmemory codex writeback");
    expect(currentStatus).toContain("new interactive installs recommend `observe`");
    expect(currentStatus).toContain("Phase 41 is now closed as installed-host pre-action unification");
    expect(currentStatus).toContain("goodmemory codex hook pre-tool-use");
    expect(currentStatus).toContain("goodmemory codex action");
    expect(currentStatus).toContain(
      "reports/eval/fallback/phase-41/run-20260425213045/report.json",
    );
    expect(currentStatus).toContain(
      "reports/eval/live-memory/phase-41/run-phase41-live-current/report.json",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-41/run-20260425223045/phase-41-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "Phase 42 is now closed as the Progressive Recall Protocol slice",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-42/run-20260426100000/phase-42-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "Phase 43 is now closed as the Runtime Kit slice",
    );
    expect(currentStatus).toContain("goodmemory/runtime-kit");
    expect(currentStatus).toContain(
      "reports/eval/fallback/phase-43/run-20260426113000/report.json",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-43/run-20260426120000/phase-43-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "Phase 43.5 is now closed as the Optional Runtime Worker slice",
    );
    expect(currentStatus).toContain("goodmemory runtime worker drain-once");
    expect(currentStatus).toContain(
      "reports/eval/fallback/phase-43-5/run-20260426133000/report.json",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-43-5/run-20260426140000/phase-43-5-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "Phase 45 is now closed as the First Reference Product and Adoption Evidence slice",
    );
    expect(currentStatus).toContain("examples/reference-chat-product");
    expect(currentStatus).toContain("bun run eval:phase-45");
    expect(currentStatus).toContain("bun run gate:phase-45");
    expect(currentStatus).toContain(
      "reports/eval/adoption/phase-45/run-20260427104530-adoption-eval/report.json",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-45/run-20260427110000/phase-45-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-45-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "Phase 46 is now closed as the Memory Quality and Maintenance 2.0 slice",
    );
    expect(currentStatus).toContain("bun run eval:phase-46");
    expect(currentStatus).toContain("qualityRepair");
    expect(currentStatus).toContain(
      "reports/eval/fallback/phase-46/run-20260427123000-quality-eval/report.json",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-46/run-20260428110000/phase-46-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-46-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "Phase 47 is now closed as the Provider-Backed Retrieval Rollout and Quality Promotion slice",
    );
    expect(currentStatus).toContain("bun run eval:phase-47");
    expect(currentStatus).toContain("provider_error");
    expect(currentStatus).toContain(
      "reports/eval/fallback/phase-47/run-20260428120000-provider-rollout-eval/report.json",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-47/run-20260428123000/phase-47-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-47-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "Phase 48 is now closed as the Dashboard, Cloud Sync, and Team Workspace Decision slice",
    );
    expect(currentStatus).toContain("bun run eval:phase-48");
    expect(currentStatus).toContain("no-go decision");
    expect(currentStatus).toContain(
      "reports/eval/fallback/phase-48/run-20260428170000-dashboard-cloud-decision/report.json",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-48/run-20260428173000/phase-48-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-48-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "Phase 49 is now closed as the Full ImplicitMemBench GoodMemory Research Eval",
    );
    expect(currentStatus).toContain("baseline-upstream-chat");
    expect(currentStatus).toContain("goodmemory-raw-experience");
    expect(currentStatus).toContain("goodmemory-distilled-feedback");
    expect(currentStatus).toContain(PHASE49_CANONICAL_BASELINE_SMOKE_REPORT);
    expect(currentStatus).toContain(PHASE49_CANONICAL_GOODMEMORY_SMOKE_REPORT);
    expect(currentStatus).toContain(PHASE49_CANONICAL_COMPARISON_SMOKE_REPORT);
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-49/run-20260428210000/phase-49-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-49-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "Phase 50 is now closed as the Installer CLI Runtime-Shell Hardening slice",
    );
    expect(currentStatus).toContain("goodmemory doctor [codex|claude|both]");
    expect(currentStatus).toContain("goodmemory repair [codex|claude|both]");
    expect(currentStatus).toContain(
      "reports/eval/fallback/phase-50/run-20260428223000-installer-eval/report.json",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-50/run-20260428224500/phase-50-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-50-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "Phase 51 is now closed as the Typed Behavioral Memory And Enactment",
    );
    expect(currentStatus).toContain("compiled `validated_pattern` feedback");
    expect(currentStatus).toContain(
      "Phase 52 is now closed as the Structured Text-Response Enactment And",
    );
    expect(currentStatus).toContain("guarded_policy");
    expect(currentStatus).toContain(PHASE52_CANONICAL_FALLBACK_REPORT);
    expect(currentStatus).toContain(PHASE52_CANONICAL_LIVE_REPORT);
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-52/run-20260502183000/phase-52-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-52-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "Phase 59 is the Generalized Raw Executor Cleanup slice",
    );
    expect(currentStatus).toContain("failed/preferred operations");
    expect(currentStatus).toContain(PHASE59_CANONICAL_FALLBACK_REPORT);
    expect(currentStatus).toContain(PHASE59_CANONICAL_RAW_DIAGNOSTICS);
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-59/run-20260504193000/phase-59-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-59-Quality-Gate.md",
    );
    expect(currentStatus).toContain("`goodmemory-raw-experience` at `58 / 60`");
    expect(currentStatus).toContain("raw `90 / 200`");
    expect(currentStatus).toContain("raw `88 / 200`");
    expect(currentStatus).toContain("raw at least `115 / 200`");
    expect(currentStatus).toContain("distilled `151 / 200`");
    expect(currentStatus).toContain("Phase 37.1 is now closed as installed-host writeback productization polish");
    expect(currentStatus).toContain("goodmemory codex writeback inspect");
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-37.1-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "reports/eval/dogfood/phase-37-1/run-phase37-1-dogfood-current/report.json",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-37-1/run-20260424100757/phase-37-1-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "Phase 38 is now closed as the governed runtime surface slice",
    );
    expect(currentStatus).toContain("GoodMemoryConfig.observability.traceSink");
    expect(currentStatus).toContain("targeted `reviseMemory()`");
    expect(currentStatus).toContain("`memory.runtime.*`");
    expect(currentStatus).toContain("`memory.jobs.enqueueRemember()`");
    expect(currentStatus).toContain("GoodMemoryConfig.providers.embedding");
    expect(currentStatus).toContain("examples/express-chat-server.ts");
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-38-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-38/run-20260425084045/phase-38-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "Phase 39 is now closed as the Python HTTP integration bridge slice.",
    );
    expect(currentStatus).toContain("docs/GoodMemory-Python-HTTP-Integration-Bridge.md");
    expect(currentStatus).toContain("examples/python-fastapi-memory-consumer.py");
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-39/run-20260425041112/phase-39-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-30/run-20260421153410/phase-30-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "reports/eval/live-memory/phase-30/run-phase30-live-current/report.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-31-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-31/run-20260422041616/phase-31-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "reports/eval/live-memory/phase-31/run-phase31-live-current/report.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-32-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-32/run-20260422085720/phase-32-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "reports/eval/fallback/phase-32/run-20260422173045/report.json",
    );
    expect(currentStatus).toContain(
      "reports/eval/live-memory/phase-32/run-phase32-live-current/report.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-33-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-33/run-20260422212752/phase-33-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-34-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "reports/eval/fallback/phase-34/run-20260422213045/report.json",
    );
    expect(currentStatus).toContain(
      "reports/eval/live-memory/phase-34/run-phase34-live-current/report.json",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-34/run-20260423102636/phase-34-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-35-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "reports/eval/fallback/phase-35/run-20260423173045/report.json",
    );
    expect(currentStatus).toContain(
      "reports/eval/live-memory/phase-35/run-phase35-live-current/report.json",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-35/run-20260423213045/phase-35-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-36-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-36/run-20260423223045/phase-36-quality-gate.json",
    );
    expect(currentStatus).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-37-Quality-Gate.md",
    );
    expect(currentStatus).toContain(
      "reports/eval/fallback/phase-37/run-20260424101045/report.json",
    );
    expect(currentStatus).toContain(
      "reports/eval/live-memory/phase-37/run-phase37-live-current/report.json",
    );
    expect(currentStatus).toContain(
      "reports/eval/live-memory/phase-37/run-phase37-external-consumer/report.json",
    );
    expect(currentStatus).toContain(
      "reports/quality-gates/phase-37/run-20260424104045/phase-37-quality-gate.json",
    );
    expect(currentStatus).toContain("compiled `dist/` artifacts");
    expect(currentStatus).toContain("Bun-backed today");
    expect(currentStatus).toContain("runLiveMemoryEval()");
    expect(currentStatus).toContain("eval:live-provider-memory");
    expect(currentStatus).toContain("reports/eval/live-memory/phase-*");
    expect(currentStatus).toContain(
      "Phase 35 is now closed as the installed host-memory middleware and hooks slice.",
    );
    expect(currentStatus).toContain(
      "root `goodmemory` no longer re-exports internal evolution contracts",
    );
    expect(currentStatus).toContain(
      "automatic adapter/event `user_correction` path is proposal-first",
    );
    expect(currentStatus).toContain(
      "automatic adapter/event `user_correction` path is proposal-first and records selective evidence plus proposal/promotion receipts instead of writing an intermediate active feedback memory; public `feedback()` remains the explicit durable procedural feedback entrypoint.",
    );
    expect(currentStatus).toContain(
      "Phase 35 installed host-memory middleware is now part of the accepted stable host surface",
    );
    expect(currentStatus).not.toContain(
      "Phase 35 installed host-memory middleware work is present in the repo but is WIP",
    );
  });

  it("task-board current note documents the generic eval command contract", async () => {
    const taskBoard = await readFile(
      join(import.meta.dir, "../../task-board/00-README.txt"),
      "utf8",
    );
    const phase63Board = await readFile(
      join(import.meta.dir, "../../task-board/68-phase-63-beam-scale-and-noise-hardening.txt"),
      "utf8",
    );
    const phase63Breakdown = await readFile(
      join(
        import.meta.dir,
        "../../task-board/phase-63-beam-scale-and-noise-hardening/00-README.txt",
      ),
      "utf8",
    );
    const phase64Board = await readFile(
      join(
        import.meta.dir,
        "../../task-board/69-phase-64-memoryagentbench-agent-memory-hardening.txt",
      ),
      "utf8",
    );
    const phase64Breakdown = await readFile(
      join(
        import.meta.dir,
        "../../task-board/phase-64-memoryagentbench-agent-memory-hardening/00-README.txt",
      ),
      "utf8",
    );
    const phase66Board = await readFile(
      join(
        import.meta.dir,
        "../../task-board/71-phase-66-v0-3-release-readiness-and-public-surface-hardening.txt",
      ),
      "utf8",
    );
    const phase67Board = await readFile(
      join(
        import.meta.dir,
        "../../task-board/72-phase-67-public-benchmark-performance-and-claim-promotion.txt",
      ),
      "utf8",
    );
    const phase65Breakdown = await readFile(
      join(
        import.meta.dir,
        "../../task-board/phase-65-locomo-conversational-memory-hardening/00-README.txt",
      ),
      "utf8",
    );

    expect(taskBoard.split("\n").length).toBeLessThanOrEqual(140);
    expect(taskBoard).toContain("eval:live-memory");
    expect(taskBoard).toContain("auto-storage live memory");
    expect(taskBoard).toContain("eval:live-provider-memory");
    expect(taskBoard).toContain("reports/eval/live-memory/phase-*");
    expect(taskBoard).toContain("eval:phase-63-general-levers");
    expect(taskBoard).toContain("measures generalization rather than fitted recall");
    expect(phase63Board).toContain("eval:phase-63-general-levers");
    expect(phase63Board).toContain("generalization floor, not the fitted");
    expect(phase63Board).toContain("--keep-gates");
    expect(phase63Breakdown).toContain("eval:phase-63-general-levers");
    expect(phase63Breakdown).toContain("generalization floor, not the fitted");
    expect(phase63Breakdown).toContain("--keep-gates");
    expect(taskBoard).toContain("docs/README.md");
    expect(taskBoard).toContain("docs/GoodMemory-PRD.md");
    expect(taskBoard).toContain("73-phase-68-generalization-boundary.txt");
    expect(taskBoard).toContain("74-phase-69-generalized-retrieval.txt");
    expect(taskBoard).toContain("75-phase-70-reranker-and-evidence.txt");
    expect(taskBoard).toContain("76-phase-71-inspector-console.txt");
    expect(taskBoard).toContain("77-phase-72-agentic-eval-and-v0-6-release.txt");
    expect(taskBoard).toContain(PHASE60_CANONICAL_OVERALL_SUMMARY);
    expect(taskBoard).toContain("run-phase61-full300-20260505T170001Z/overall-summary.json");
    expect(taskBoard).toContain("213.26 / 300 = 71.09%");
    expect(taskBoard).toContain("128 / 300 = 42.67%");
    expect(taskBoard).toContain("internal research evidence, not a release");
    expect(taskBoard).toContain("LongMemEval -> BEAM -> MemoryAgentBench -> LoCoMo");
    expect(taskBoard).toContain("Phase 72 is complete");
    expect(taskBoard).toContain(
      "Current public-opt-in claims are LoCoMo, BEAM, and MemoryAgentBench",
    );
    expect(taskBoard).toContain(
      "LongMemEval and ImplicitMemBench remain versioned internal evidence",
    );
    expect(taskBoard).toContain("Phase 69 owns generalized candidate admission and noise control");
    expect(taskBoard).toContain(
      "BEAM 100K closes at 0.7651 unified, 0.620 strict, and 0.8276 recall",
    );
    expect(taskBoard).toContain(
      "the answer-rule workstream is paused",
    );
    expect(taskBoard).not.toContain(
      "but not BEAM performance closure or a public claim",
    );
    expect(taskBoard).toContain("Closed release/public-surface lane: `task-board/71-phase-66-v0-3-release-readiness-and-public-surface-hardening.txt`");
    expect(taskBoard).not.toContain("Release / public-surface lane: `task-board/71-phase-66-v0-3-release-readiness-and-public-surface-hardening.txt`");
    expect(taskBoard).toContain("Historical Phase 65 entrypoint: `task-board/70-phase-65-locomo-conversational-memory-hardening.txt`");
    expect(taskBoard).toContain("Historical public benchmark-claim routing board: `task-board/72-phase-67-public-benchmark-performance-and-claim-promotion.txt`");
    expect(taskBoard).not.toContain("Current Sequential benchmark-hardening entrypoint:");
    expect(phase66Board).toContain(
      "[CLOSED - RELEASE READINESS; P67 SUPERSEDES PUBLIC-CLAIM ROUTING]",
    );
    expect(phase66Board).toContain(
      "P67 later promoted scoped public claims for MemoryAgentBench CR/TTL, LoCoMo P4, and BEAM official-protocol",
    );
    expect(phase66Board).toContain(
      "Current Sequential lane is Phase 65 LoCoMo, with public-claim routing in Phase 67",
    );
    expect(phase66Board).not.toContain(
      "[ACTIVE] Phase 66 is the current release/public-surface lane",
    );
    expect(phase66Board).not.toContain("LoCoMo banked retrieval boundary");
    expect(phase66Board).not.toContain("active lane set to Phase 66");
    expect(phase66Board).not.toContain("LoCoMo paused boundary (do not reopen)");
    expect(phase66Board).not.toContain("then-internal MAB/LoCoMo evidence");
    expect(phase66Board).not.toContain("then-internal MAB / LoCoMo numbers");
    expect(phase67Board).toContain(
      "Historical verdict after the ImplicitMemBench gpt-5.4 stored-answer rescore",
    );
    expect(phase67Board).toContain(
      "Phase 68 later superseded that boundary",
    );
    expect(phase67Board).toContain(
      "versioned historical evidence under `benchmark-claims/*.json`",
    );
    expect(phase67Board).toContain(
      "implicitmembench-independent-rescore-gpt54-current",
    );
    expect(phase67Board).not.toContain(
      "BEAM, and LoCoMo remain internal / blocked evidence rather than public claims.",
    );
    expect(phase67Board).toContain(
      "P67-D BEAM public-claim re-anchor",
    );
    expect(phase67Board).toContain(
      "official protocol + above the public reference + full disclosures",
    );
    expect(phase67Board).not.toContain(
      "P67-D BEAM answer-gap improvement to >=0.75",
    );
    expect(phase67Board).not.toContain(
      "No additional MemoryAgentBench scope or LoCoMo README row promotion until the",
    );
    expect(phase65Breakdown).toContain(
      "Phase 63 / P67-D BEAM is publicly claimable on the official-protocol track",
    );
    expect(phase65Breakdown).toContain(
      "its internal binary answer-gap workstream remains open",
    );
    expect(phase65Breakdown).not.toContain(
      "Phase 63 BEAM remains partial under its own answer-gap workstream",
    );
    for (const phase64Content of [phase64Board, phase64Breakdown]) {
      expect(phase64Content).toContain(
        "Phase 63 / P67-D BEAM has a separate official-protocol public claim",
      );
      expect(phase64Content).toContain(
        "its binary-track answer-gap workstream remains open",
      );
      expect(phase64Content).toContain(
        "Current Sequential lane is Phase 65 LoCoMo, with public-claim routing in Phase 67",
      );
      expect(phase64Content).not.toContain("Phase 63 BEAM remains PAUSED");
      expect(phase64Content).not.toContain("Phase 63 BEAM remains paused");
      expect(phase64Content).not.toContain(
        "Current active lane: v0.3 release readiness / public-surface hardening (Phase 66)",
      );
    }
    expect(taskBoard).toContain(
      "Phase 68 is complete",
    );
    expect(taskBoard).toContain("454/500");
    expect(taskBoard).toContain("run-phase63-beam-smoke-current");
    expect(taskBoard).toContain("run-20260518003000");
    expect(taskBoard).toContain("run-phase62-provider-probe-hybrid-20260518T-provider-restored");
    expect(taskBoard).toContain("decision is recorded as executed evidence");
    expect(taskBoard).toContain("Superseded design drafts belong under `docs/archive/design-inputs/`");
    expect(taskBoard).not.toContain("Phase 35 is now WIP again");
    expect(taskBoard).not.toContain("reports/eval/fallback/phase-43/run-20260426113000/report.json");
  });

  it("phase-41 leaf task-board status stays aligned with closed current status", async () => {
    const currentStatus = await readFile(
      join(import.meta.dir, "../../docs/GoodMemory-Current-Status-and-Evidence.md"),
      "utf8",
    );

    expect(currentStatus).toContain(
      "Phase 41 is now closed as installed-host pre-action unification",
    );

    for (const relativePath of PHASE41_TASK_BOARD_LEAF_FILES) {
      const content = await readFile(
        join(import.meta.dir, "../../", relativePath),
        "utf8",
      );

      expect(content).toContain("[DONE] Accepted as part of the Phase 41");
      expect(content).toContain(
        "reports/eval/fallback/phase-41/run-20260425213045/report.json",
      );
      expect(content).toContain(
        "reports/eval/live-memory/phase-41/run-phase41-live-current/report.json",
      );
      expect(content).toContain(
        "reports/quality-gates/phase-41/run-20260425223045/phase-41-quality-gate.json",
      );
      expect(content).not.toContain("[TODO] Not started.");
    }
  }, 60_000);

  it("AGENTS.md keeps repository instructions aligned with the current eval contract", async () => {
    const agents = await readFile(
      join(import.meta.dir, "../../AGENTS.md"),
      "utf8",
    );

    expect(agents).toContain("eval:live-memory");
    expect(agents).toContain("auto-storage memory resolution");
    expect(agents).toContain("GOODMEMORY_STORAGE_PROVIDER");
    expect(agents).toContain("GOODMEMORY_STORAGE_URL");
    expect(agents).toContain("eval:live-auto-memory");
    expect(agents).toContain("eval:live-provider-memory");
    expect(agents).toContain("GOODMEMORY_TEST_POSTGRES_URL");
    expect(agents).toContain("phase-specific `*-live-memory` runners");
    expect(agents).not.toContain(
      "eval:live-memory`: run the provider-backed live eval path with Postgres storage",
    );
  });

  it("phase-40 closes only from immutable phase-39 release evidence", async () => {
    const phase40Board = await readFile(
      join(
        import.meta.dir,
        "../../task-board/42-phase-40-v0-2-release-proof-and-product-eval.txt",
      ),
      "utf8",
    );
    const phase40Input = await readFile(
      join(
        import.meta.dir,
        "../../task-board/phase-40-v0-2-release-proof-and-product-eval/01-close-phase-39-input.txt",
      ),
      "utf8",
    );
    const currentStatus = await readFile(
      join(
        import.meta.dir,
        "../../docs/GoodMemory-Current-Status-and-Evidence.md",
      ),
      "utf8",
    );
    const phase39ReportPath =
      "reports/quality-gates/phase-39/run-20260425041112/phase-39-quality-gate.json";
    const phase39Report = JSON.parse(
      await readFile(join(import.meta.dir, "../../", phase39ReportPath), "utf8"),
    ) as {
      acceptance: {
        decision: string;
      };
      evidence: {
        pythonConsumer?: {
          status?: string;
        };
      };
      runId: string;
    };
    const phase40BoardText = phase40Board.replace(/\s+/g, " ");

    expect(phase39Report.runId).toBe("run-20260425041112");
    expect(phase39Report.acceptance.decision).toBe("accepted");
    expect(phase39Report.evidence.pythonConsumer?.status).toBe("accepted");
    expect(phase40BoardText).toContain(
      "[DONE] Phase 40 is closed as the v0.2 release proof and product eval slice.",
    );
    expect(phase40Board).toContain(
      "[DONE] P40-T001 Close Phase 39 as release-evidence input.",
    );
    expect(phase40Board).toContain(
      "[DONE] P40-T006 Add Phase 40 quality gate and v0.2 release-candidate evidence.",
    );
    expect(phase40Board).toContain(phase39ReportPath);
    expect(phase40Board).toContain(
      "reports/quality-gates/phase-40/run-20260425172323/phase-40-quality-gate.json",
    );
    expect(phase40Board).toContain(
      "docs/archive/quality-gates/GoodMemory-Phase-39-Quality-Gate.md",
    );
    expect(phase40Board).not.toContain("[TODO] Phase 40 is queued");
    expect(phase40Input).toContain(
      "[DONE] Phase 39 release-evidence input is accepted.",
    );
    expect(currentStatus).toContain(
      "Phase 40 is now closed as the v0.2 release proof and product eval slice.",
    );
  });

  it("phase-40 cross-consumer adoption smoke is accepted and tracked", async () => {
    const reportPath =
      "reports/eval/adoption/phase-40/run-20260425163012-cross-consumer/report.json";
    const report = JSON.parse(
      await readFile(join(import.meta.dir, "../../", reportPath), "utf8"),
    ) as {
      acceptance: {
        decision: string;
      };
      commands: Array<{
        label: string;
        stderrTail: string[];
        stdoutTail: string[];
        status: string;
      }>;
      evidence: Record<string, { status: string }>;
      generatedBy: string;
      mode: string;
      phase: string;
      runId: string;
    };
    const phase40Board = await readFile(
      join(
        import.meta.dir,
        "../../task-board/42-phase-40-v0-2-release-proof-and-product-eval.txt",
      ),
      "utf8",
    );
    const phase40Smoke = await readFile(
      join(
        import.meta.dir,
        "../../task-board/phase-40-v0-2-release-proof-and-product-eval/04-cross-consumer-adoption-smoke.txt",
      ),
      "utf8",
    );
    const currentStatus = await readFile(
      join(
        import.meta.dir,
        "../../docs/GoodMemory-Current-Status-and-Evidence.md",
      ),
      "utf8",
    );

    expect(report.phase).toBe("phase-40");
    expect(report.mode).toBe("cross-consumer-adoption-smoke");
    expect(report.runId).toBe("run-20260425163012-cross-consumer");
    expect(report.generatedBy).toBe("scripts/run-phase-40-cross-consumer-smoke.ts");
    expect(report.acceptance.decision).toBe("accepted");
    expect(report.commands.map((command) => command.label)).toEqual([
      "direct-typescript-app",
      "express-http-server",
      "fastify-http-server",
      "python-fastapi-bridge-consumer",
      "installed-host-package-path",
    ]);
    expect(
      report.commands.every(
        (command) =>
          command.status === "passed" &&
          command.stdoutTail.length === 0 &&
          command.stderrTail.length === 0,
      ),
    ).toBe(true);
    for (const status of Object.values(report.evidence)) {
      expect(status.status).toBe("accepted");
    }
    expect(phase40Board).toContain("[DONE] P40-T004 Add cross-consumer adoption smoke coverage.");
    expect(phase40Board).toContain(reportPath);
    expect(phase40Smoke).toContain("[DONE] Cross-consumer adoption smoke is implemented and accepted.");
    expect(phase40Smoke).toContain("eval:phase-40-cross-consumer");
    expect(phase40Smoke).toContain(reportPath);
    expect(currentStatus).toContain(
      "cross-consumer adoption smoke covers direct TypeScript, Express, Fastify, Python/FastAPI bridge, and installed-host package paths",
    );
    expect(currentStatus).toContain(reportPath);
  });

  it("phase-40 product eval rollup is accepted and tracked", async () => {
    const reportPath =
      "reports/eval/product/phase-40/run-20260425165544-product-eval/report.json";
    const report = JSON.parse(
      await readFile(join(import.meta.dir, "../../", reportPath), "utf8"),
    ) as {
      acceptance: {
        decision: string;
      };
      cases: Array<{
        focus: string;
        goodMemory: {
          missedSignals: string[];
          wrongSignals: string[];
        };
        noMemory: {
          matchedSignals: string[];
        };
        passed: boolean;
      }>;
      metrics: {
        correctness: {
          continuityUplift: number;
          correctionSuccessRate: number;
          missedRecallRate: number;
          wrongRecallRate: number;
        };
        productQuality: {
          backgroundJobFailureVisibility: number;
          duplicateMemoryRate: number;
          policyBlockExplainability: number;
          traceCompletenessRate: number;
        };
      };
      mode: string;
      phase: string;
      rawTranscriptPersistence: {
        defaultRuntimeArchive: string;
        persistedRawTranscripts: boolean;
      };
      runId: string;
      traceEvidence: Record<string, { status: string }>;
      variants: {
        noMemory: {
          mode: string;
        };
        withGoodMemory: {
          mode: string;
        };
      };
    };
    const phase40Board = await readFile(
      join(
        import.meta.dir,
        "../../task-board/42-phase-40-v0-2-release-proof-and-product-eval.txt",
      ),
      "utf8",
    );
    const phase40Rollup = await readFile(
      join(
        import.meta.dir,
        "../../task-board/phase-40-v0-2-release-proof-and-product-eval/05-product-eval-rollup.txt",
      ),
      "utf8",
    );
    const currentStatus = await readFile(
      join(
        import.meta.dir,
        "../../docs/GoodMemory-Current-Status-and-Evidence.md",
      ),
      "utf8",
    );

    expect(report.phase).toBe("phase-40");
    expect(report.mode).toBe("product-eval-rollup");
    expect(report.runId).toBe("run-20260425165544-product-eval");
    expect(report.acceptance.decision).toBe("accepted");
    expect(report.variants.noMemory.mode).toBe("no-memory");
    expect(report.variants.withGoodMemory.mode).toBe("with-goodmemory");
    expect(report.cases.map((caseResult) => caseResult.focus)).toEqual([
      "identity_background",
      "historical_task_continuation",
      "open_loop_recall",
      "user_correction",
      "feedback_procedural_learning",
      "background_remember",
    ]);
    expect(report.cases.every((caseResult) => caseResult.passed)).toBe(true);
    expect(
      report.cases.every(
        (caseResult) =>
          caseResult.goodMemory.missedSignals.length === 0 &&
          caseResult.goodMemory.wrongSignals.length === 0 &&
          caseResult.noMemory.matchedSignals.length === 0,
      ),
    ).toBe(true);
    expect(report.metrics.correctness.continuityUplift).toBeGreaterThan(0);
    expect(report.metrics.correctness.missedRecallRate).toBe(0);
    expect(report.metrics.correctness.wrongRecallRate).toBe(0);
    expect(report.metrics.correctness.correctionSuccessRate).toBe(1);
    expect(report.metrics.productQuality.backgroundJobFailureVisibility).toBe(1);
    expect(report.metrics.productQuality.duplicateMemoryRate).toBe(0);
    expect(report.metrics.productQuality.policyBlockExplainability).toBe(1);
    expect(report.metrics.productQuality.traceCompletenessRate).toBe(1);
    expect(report.rawTranscriptPersistence.defaultRuntimeArchive).toBe("off");
    expect(report.rawTranscriptPersistence.persistedRawTranscripts).toBe(false);
    for (const status of Object.values(report.traceEvidence)) {
      expect(status.status).toBe("accepted");
    }
    expect(JSON.stringify(report)).not.toContain("My name is");
    expect(JSON.stringify(report)).not.toContain("private launch token");
    expect(phase40Board).toContain(
      "[DONE] P40-T005 Add product eval rollup with a no-memory baseline.",
    );
    expect(phase40Board).toContain(reportPath);
    expect(phase40Rollup).toContain("[DONE] Product eval rollup is implemented and accepted.");
    expect(phase40Rollup).toContain("eval:phase-40-product");
    expect(phase40Rollup).toContain(reportPath);
    expect(currentStatus).toContain(
      "product eval rollup compares with-GoodMemory against a no-memory baseline",
    );
    expect(currentStatus).toContain(reportPath);
  });

  it("phase-40 quality gate report is accepted and tracked", async () => {
    const reportPath =
      "reports/quality-gates/phase-40/run-20260425172323/phase-40-quality-gate.json";
    const report = JSON.parse(
      await readFile(join(import.meta.dir, "../../", reportPath), "utf8"),
    ) as {
      acceptance: {
        decision: string;
      };
      commands: Array<{
        label: string;
        status: string;
      }>;
      evidence: Record<string, { status: string }>;
      generatedBy: string;
      phase: string;
      releaseCandidate: {
        version: string;
      };
      runId: string;
    };
    const phase40Board = await readFile(
      join(
        import.meta.dir,
        "../../task-board/42-phase-40-v0-2-release-proof-and-product-eval.txt",
      ),
      "utf8",
    );
    const phase40Gate = await readFile(
      join(
        import.meta.dir,
        "../../task-board/phase-40-v0-2-release-proof-and-product-eval/06-phase-40-gate-and-release-candidate.txt",
      ),
      "utf8",
    );
    const currentStatus = await readFile(
      join(
        import.meta.dir,
        "../../docs/GoodMemory-Current-Status-and-Evidence.md",
      ),
      "utf8",
    );

    expect(report.phase).toBe("phase-40");
    expect(report.runId).toBe("run-20260425172323");
    expect(report.generatedBy).toBe("scripts/run-phase-40-gate.ts");
    expect(report.releaseCandidate.version).toBe("0.2.0");
    if (process.env.PHASE40_GATE_IN_PROGRESS !== "1") {
      expect(report.acceptance.decision).toBe("accepted");
      expect(report.commands.map((command) => command.label)).toEqual([
        "phase-40-release-regressions",
        "ci-regression-gate",
        "node-package-boundary-smoke",
        "cross-consumer-adoption-smoke",
        "product-eval-rollup",
        "pack-dry-run",
        "release-rc-dry-run",
      ]);
      expect(report.commands.every((command) => command.status === "passed")).toBe(true);
      for (const status of Object.values(report.evidence)) {
        expect(status.status).toBe("accepted");
      }
    } else {
      expect(["accepted", "blocked"]).toContain(report.acceptance.decision);
    }
    expect(phase40Board).toContain(
      "[DONE] P40-T006 Add Phase 40 quality gate and v0.2 release-candidate evidence.",
    );
    expect(phase40Board).toContain(reportPath);
    expect(phase40Gate).toContain(
      "[DONE] Phase 40 quality gate and v0.2 release-candidate evidence are accepted.",
    );
    expect(phase40Gate).toContain("gate:phase-40");
    expect(phase40Gate).toContain(reportPath);
    expect(currentStatus).toContain(reportPath);
    await expectGitTrackedPath(reportPath);
  });

  it("release workflow uses manual plus stable tag triggers, the unified v0.7 gate, and tarball artifact upload", async () => {
    const workflow = await readFile(
      join(import.meta.dir, "../../.github/workflows/release.yml"),
      "utf8",
    );

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("tags:");
    expect(workflow).toContain("v*.*.*");
    expect(workflow).toContain("bun run gate:v0.7 --strict");
    expect(workflow).not.toContain("bun run gate:phase-40");
    expect(workflow).toContain("GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY");
    expect(workflow).toContain("secrets.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER");
    expect(workflow).not.toContain("bun run gate:phase-36");
    expect(workflow).not.toContain("bun run gate:phase-37 --run-id");
    expect(workflow).not.toContain("bun run gate:phase-39 --run-id");
    expect(workflow).toContain("TAG_VERSION=\"${GITHUB_REF_NAME#v}\"");
    expect(workflow).toContain("Stable release workflow only supports stable semver versions");
    expect(workflow).toContain("[[ \"$VERSION\" == *-* ]]");
    expect(workflow).toContain("[[ \"$TAG_VERSION\" != \"$VERSION\" ]]");
    expect(workflow).not.toContain("bun pm pack --destination dist-release");
    expect(workflow).toContain("scripts/prepare-v0-7-stable-artifact.ts");
    expect(workflow).toContain("scripts/verify-v0-7-release-artifact.ts");
    expect(workflow).toContain("prepublish-evidence.json");
    expect(workflow).toContain('ARTIFACT_SOURCE_COMMIT="$(ARTIFACT_JSON="$ARTIFACT_JSON"');
    expect(workflow).toContain('ARTIFACT_SOURCE_TREE="$(ARTIFACT_JSON="$ARTIFACT_JSON"');
    expect(workflow).toContain('[[ "$ARTIFACT_SOURCE_COMMIT" != "$GITHUB_SHA" ]]');
    expect(workflow).toContain('source-commit "${{ steps.pack.outputs.source_commit }}"');
    expect(workflow).toContain('source-tree "${{ steps.pack.outputs.source_tree }}"');
    expect(workflow).toContain("RUNNER_TEMP");
    expect(workflow).toContain('expected-integrity "$ARTIFACT_INTEGRITY"');
    expect(workflow).toContain('if [[ "${GITHUB_REF_TYPE:-}" == "tag" ]]');
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("actions/setup-node@v4");
    expect(workflow).toContain("node-version: 20");
    expect(workflow).toContain("registry-url: https://registry.npmjs.org");
    expect(workflow).toContain("NPM_TOKEN");
    expect(workflow).toContain([
      'if [ -z "${NODE_AUTH_TOKEN:-}" ]; then',
      '  echo "::error::NPM_TOKEN is required for stable tag releases"',
      "  exit 1",
      "fi",
    ].join("\n          "));
    expect(workflow).toContain([
      'if ! NPM_USER="$(npm whoami)"; then',
      '  echo "::error::npm authentication failed: npm whoami did not succeed"',
      "  exit 1",
      "fi",
    ].join("\n          "));
    expect(workflow).not.toMatch(/\bskip(?:ped|ping)?\b/iu);
    expect(workflow).not.toContain("does not block the tarball-first stable release contract");
    expect(workflow).not.toContain("npm whoami 2>/dev/null || true");
    expect(workflow).not.toContain("npm user: ${NPM_USER:-unknown}");
    expect(workflow).toContain("already exists on npm; verifying registry state.");
    expect(workflow).toContain("npm publish --access public");
    expect(workflow).toContain('npm view "goodmemory@${VERSION}" version');
    expect(workflow).toContain(
      'npm view "goodmemory@${VERSION}" dist.integrity',
    );
    expect(workflow).toContain("npm view goodmemory@latest version");
    expect(workflow).toContain(
      '[ "$PUBLISHED_INTEGRITY" = "$ARTIFACT_INTEGRITY" ]',
    );
    expect(workflow).toContain(
      "npm artifact identity verification failed",
    );
    expect(workflow).toContain("Waiting for npm registry visibility");
    expect(workflow).toContain("npm registry verification failed");
    expect(workflow).toContain("softprops/action-gh-release@v2");
    expect(workflow).toContain("prerelease: false");
    expect(workflow).toContain("make_latest: true");

    const uploadIndex = workflow.indexOf("- name: Upload tarball artifact");
    const verifyArtifactIndex = workflow.indexOf(
      "- name: Verify exact prepublish artifact",
    );
    const authIndex = workflow.indexOf(
      "- name: Validate npm publishing credentials",
    );
    const publishIndex = workflow.indexOf("- name: Publish package to npm");
    const githubReleaseIndex = workflow.indexOf("- name: Create GitHub release");
    expect(uploadIndex).toBeGreaterThan(-1);
    expect(verifyArtifactIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(verifyArtifactIndex);
    expect(authIndex).toBeGreaterThan(uploadIndex);
    expect(publishIndex).toBeGreaterThan(authIndex);
    expect(githubReleaseIndex).toBeGreaterThan(publishIndex);
    for (const stepName of [
      "Validate npm publishing credentials",
      "Publish package to npm",
      "Create GitHub release",
    ]) {
      expect(workflow).toContain(
        `- name: ${stepName}\n        if: startsWith(github.ref, 'refs/tags/')`,
      );
    }
    expect(workflow).not.toContain("npm publish --tag rc --access public");
    expect(workflow).not.toContain("npm view goodmemory@rc version");
  });

  it("scheduled eval workflow skips successfully when live eval secrets are absent", async () => {
    const workflow = await readFile(
      join(import.meta.dir, "../../.github/workflows/eval.yml"),
      "utf8",
    );

    expect(workflow).toContain("id: live-eval-secrets");
    expect(workflow).toContain("secrets_available=true");
    expect(workflow).toContain("secrets_available=false");
    expect(workflow).toContain("GITHUB_EVENT_NAME");
    expect(workflow).toContain("workflow_dispatch");
    expect(workflow).toContain("Live eval skipped because required secrets are missing.");
    expect(workflow).toContain(
      "if: steps.live-eval-secrets.outputs.secrets_available == 'true'",
    );
  });

  it("github workflows pin Bun to the repository-supported Bun version", async () => {
    const pkg = JSON.parse(
      await readFile(join(import.meta.dir, "../../package.json"), "utf8"),
    ) as {
      engines?: {
        bun?: string;
      };
    };
    const bunVersion = pkg.engines?.bun?.replace(/^[^0-9]*/, "");

    expect(bunVersion).toBe("1.3.0");
    for (const workflowPath of [
      ".github/workflows/ci.yml",
      ".github/workflows/eval.yml",
      ".github/workflows/release.yml",
    ]) {
      const workflow = await readFile(join(import.meta.dir, "../../", workflowPath), "utf8");
      expect(workflow).toContain(`bun-version: ${bunVersion}`);
      expect(workflow).not.toContain("bun-version: latest");
    }
  });

  it("ci workflow installs sqlite-vss Linux prerequisites before dependency install", async () => {
    const workflow = await readFile(
      join(import.meta.dir, "../../.github/workflows/ci.yml"),
      "utf8",
    );

    expect(workflow).toContain("Install sqlite-vss Linux prerequisites");
    expect(workflow).toContain("sudo apt-get install -y libgomp1 libatlas-base-dev liblapack-dev");
    expect(workflow.indexOf("Install sqlite-vss Linux prerequisites")).toBeLessThan(
      workflow.indexOf("Install dependencies"),
    );
  });

  it("release workflow installs sqlite-vss Linux prerequisites before dependency install", async () => {
    const workflow = await readFile(
      join(import.meta.dir, "../../.github/workflows/release.yml"),
      "utf8",
    );

    expect(workflow).toContain("Install sqlite-vss Linux prerequisites");
    expect(workflow).toContain("sudo apt-get install -y libgomp1 libatlas-base-dev liblapack-dev");
    expect(workflow.indexOf("Install sqlite-vss Linux prerequisites")).toBeLessThan(
      workflow.indexOf("Install dependencies"),
    );
  });

  it("release workflow provisions postgres coverage dependencies before the release gate", async () => {
    const workflow = await readFile(
      join(import.meta.dir, "../../.github/workflows/release.yml"),
      "utf8",
    );

    expect(workflow).toContain("services:");
    expect(workflow).toContain("postgres:");
    expect(workflow).toContain("image: pgvector/pgvector:pg16");
    expect(workflow).toContain(
      "GOODMEMORY_TEST_POSTGRES_URL: postgres://postgres:postgres@localhost:5432/postgres",
    );
    expect(workflow.indexOf("services:")).toBeLessThan(workflow.indexOf("steps:"));
    expect(workflow.indexOf("GOODMEMORY_TEST_POSTGRES_URL")).toBeLessThan(
      workflow.indexOf("Run release gate"),
    );
  });

  it("ci workflow runs the node package boundary matrix on Node 20, 22, and 24", async () => {
    const workflow = await readFile(
      join(import.meta.dir, "../../.github/workflows/ci.yml"),
      "utf8",
    );

    expect(workflow).toContain("node-package-boundary");
    expect(workflow).toContain("node-version: [20, 22, 24]");
    expect(workflow).toContain("Build package boundary");
    expect(workflow).toContain("Verify Node package boundary");
    expect(workflow).toContain("tests/release/node-package-boundary.test.ts");
  });

  it("phase quality gate docs live in the archive instead of the top-level docs folder", async () => {
    const topLevelDocs = await readdir(
      join(import.meta.dir, "../../docs"),
    );
    const archivedQualityGates = await readdir(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT),
    );

    expect(topLevelDocs).not.toContain("GoodMemory-Phase-16-Quality-Gate.md");
    expect(topLevelDocs).not.toContain("GoodMemory-Phase-17-Quality-Gate.md");
    expect(topLevelDocs).not.toContain("GoodMemory-Phase-18-Quality-Gate.md");
    expect(topLevelDocs).not.toContain("GoodMemory-Phase-19-Reviewer-Quality-Gate.md");
    expect(topLevelDocs).not.toContain("GoodMemory-Phase-19-Maintenance-Quality-Gate.md");
    expect(topLevelDocs).not.toContain("GoodMemory-Phase-20-Quality-Gate.md");
    expect(topLevelDocs).not.toContain("GoodMemory-Phase-21-Quality-Gate.md");
    expect(topLevelDocs).not.toContain("GoodMemory-Phase-22-Quality-Gate.md");
    expect(topLevelDocs).not.toContain("GoodMemory-Phase-23-Quality-Gate.md");
    expect(topLevelDocs).not.toContain("GoodMemory-Phase-25-Quality-Gate.md");
    expect(topLevelDocs).not.toContain("GoodMemory-Phase-26-Quality-Gate.md");
    expect(topLevelDocs).not.toContain("GoodMemory-Phase-28-Quality-Gate.md");
    expect(topLevelDocs).not.toContain("GoodMemory-Phase-29-Quality-Gate.md");
    expect(topLevelDocs).not.toContain("GoodMemory-Phase-30-Quality-Gate.md");
    expect(topLevelDocs).not.toContain("GoodMemory-Phase-32-Quality-Gate.md");
    expect(topLevelDocs).not.toContain("GoodMemory-Phase-38-Quality-Gate.md");
    expect(topLevelDocs).not.toContain("GoodMemory-Phase-41-Quality-Gate.md");
    expect(archivedQualityGates).toContain("README.md");
    expect(archivedQualityGates).toContain("GoodMemory-Phase-16-Quality-Gate.md");
    expect(archivedQualityGates).toContain("GoodMemory-Phase-17-Quality-Gate.md");
    expect(archivedQualityGates).toContain("GoodMemory-Phase-18-Quality-Gate.md");
    expect(archivedQualityGates).toContain("GoodMemory-Phase-19-Reviewer-Quality-Gate.md");
    expect(archivedQualityGates).toContain("GoodMemory-Phase-19-Maintenance-Quality-Gate.md");
    expect(archivedQualityGates).toContain("GoodMemory-Phase-20-Quality-Gate.md");
    expect(archivedQualityGates).toContain("GoodMemory-Phase-21-Quality-Gate.md");
    expect(archivedQualityGates).toContain("GoodMemory-Phase-22-Quality-Gate.md");
    expect(archivedQualityGates).toContain("GoodMemory-Phase-23-Quality-Gate.md");
    expect(archivedQualityGates).toContain("GoodMemory-Phase-25-Quality-Gate.md");
    expect(archivedQualityGates).toContain("GoodMemory-Phase-26-Quality-Gate.md");
    expect(archivedQualityGates).toContain("GoodMemory-Phase-28-Quality-Gate.md");
    expect(archivedQualityGates).toContain("GoodMemory-Phase-29-Quality-Gate.md");
    expect(archivedQualityGates).toContain("GoodMemory-Phase-30-Quality-Gate.md");
    expect(archivedQualityGates).toContain("GoodMemory-Phase-32-Quality-Gate.md");
    expect(archivedQualityGates).toContain("GoodMemory-Phase-38-Quality-Gate.md");
    expect(archivedQualityGates).toContain("GoodMemory-Phase-41-Quality-Gate.md");
  });

  it("phase-18 quality gate doc points to one canonical accepted report", async () => {
    await expectCanonicalAcceptedQualityGate({
      docPath: `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-18-Quality-Gate.md`,
      phaseDirectory: "phase-18",
      reportFileName: "phase-18-quality-gate.json",
      runId: "run-20260419031141",
    });
  });

  it("phase-19 reviewer quality gate doc points to one canonical accepted report", async () => {
    await expectCanonicalAcceptedQualityGate({
      docPath: `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-19-Reviewer-Quality-Gate.md`,
      phaseDirectory: "phase-19-reviewer",
      reportFileName: "phase-19-reviewer-quality-gate.json",
      runId: "run-20260419101816",
    });
  });

  it("phase-19 maintenance quality gate doc points to one canonical accepted report", async () => {
    await expectCanonicalAcceptedQualityGate({
      docPath: `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-19-Maintenance-Quality-Gate.md`,
      phaseDirectory: "phase-19-maintenance",
      reportFileName: "phase-19-maintenance-quality-gate.json",
      runId: "run-20260419101816",
    });
  });

  it("phase-20 quality gate doc points to one canonical accepted report", async () => {
    await expectCanonicalAcceptedQualityGate({
      docPath: `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-20-Quality-Gate.md`,
      phaseDirectory: "phase-20",
      reportFileName: "phase-20-quality-gate.json",
      runId: "run-20260420023503",
    });
  });

  it("phase-22 quality gate doc points to one canonical accepted report", async () => {
    await expectCanonicalAcceptedQualityGate({
      docPath: `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-22-Quality-Gate.md`,
      phaseDirectory: "phase-22",
      reportFileName: "phase-22-quality-gate.json",
      runId: "run-20260420020541",
    });
  });

  it("phase-23 quality gate doc points to one canonical accepted report", async () => {
    await expectCanonicalAcceptedQualityGate({
      docPath: `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-23-Quality-Gate.md`,
      phaseDirectory: "phase-23",
      reportFileName: "phase-23-quality-gate.json",
      runId: "run-20260420061039",
    });
  });

  it("phase-25 quality gate doc points to one canonical accepted report", async () => {
    await expectCanonicalAcceptedQualityGate({
      docPath: `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-25-Quality-Gate.md`,
      phaseDirectory: "phase-25",
      reportFileName: "phase-25-quality-gate.json",
      runId: "run-20260420082358",
    });
  });

  it("phase-26 quality gate doc points to one canonical accepted report", async () => {
    await expectCanonicalAcceptedQualityGate({
      docPath: `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-26-Quality-Gate.md`,
      phaseDirectory: "phase-26",
      reportFileName: "phase-26-quality-gate.json",
      runId: "run-20260420193000",
    });
  });

  it("phase-28 quality gate doc points to one canonical accepted report", async () => {
    await expectCanonicalAcceptedQualityGate({
      docPath: `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-28-Quality-Gate.md`,
      phaseDirectory: "phase-28",
      reportFileName: "phase-28-quality-gate.json",
      runId: "run-20260421093000",
    });
  });

  it("phase-27 quality gate doc points to the canonical gate plus deterministic and live evidence", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-27-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );

    await expectCanonicalAcceptedQualityGate({
      docPath,
      phaseDirectory: "phase-27",
      reportFileName: "phase-27-quality-gate.json",
      runId: "run-20260421172000",
    });

    expect(qualityGateDoc).toContain(
      "reports/eval/fallback/phase-27/run-20260421165000/report.json",
    );
    expect(qualityGateDoc).toContain(
      "reports/eval/live-memory/phase-27/run-20260421170500/report.json",
    );

    await expectIgnoredGeneratedArtifact(
      "reports/eval/fallback/phase-27/run-20260421165000/report.json",
    );
    await expectGitTrackedRepoArtifact(
      "reports/eval/live-memory/phase-27/run-20260421170500/report.json",
    );
  });

  it("phase-29 quality gate doc points to the canonical gate plus RC dry-run evidence", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-29-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );

    await expectCanonicalAcceptedQualityGate({
      docPath,
      phaseDirectory: "phase-29",
      reportFileName: "phase-29-quality-gate.json",
      runId: "run-20260421213000",
    });

    expect(qualityGateDoc).toContain(
      "reports/quality-gates/phase-29/run-20260421214500/phase-29-rc-dry-run.json",
    );
    await expectGitTrackedPath(
      "reports/quality-gates/phase-29/run-20260421214500/phase-29-rc-dry-run.json",
    );
  });

  it("phase-30 quality gate doc points to the canonical gate plus trace-backed live evidence", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-30-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const relativeReportPath =
      "reports/quality-gates/phase-30/run-20260421153410/phase-30-quality-gate.json";
    const gateReport = JSON.parse(
      await readFile(
        join(import.meta.dir, "../../", relativeReportPath),
        "utf8",
      ),
    ) as {
      acceptance: {
        decision: string;
      };
      runId: string;
    };

    expect(qualityGateDoc).toContain("run-20260421153410");
    expect(gateReport.runId).toBe("run-20260421153410");
    expect(gateReport.acceptance.decision).toBe("accepted");
    await expectGitTrackedPath(relativeReportPath);

    expect(qualityGateDoc).toContain(
      "reports/eval/live-memory/phase-30/run-phase30-live-current/report.json",
    );
    await expectGitTrackedRepoArtifact(
      "reports/eval/live-memory/phase-30/run-phase30-live-current/report.json",
    );
  });

  it("phase-31 quality gate doc points to the canonical gate plus native host live evidence", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-31-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const relativeReportPath =
      "reports/quality-gates/phase-31/run-20260422041616/phase-31-quality-gate.json";
    const gateReport = JSON.parse(
      await readFile(
        join(import.meta.dir, "../../", relativeReportPath),
        "utf8",
      ),
    ) as {
      acceptance: {
        decision: string;
      };
      runId: string;
    };

    expect(qualityGateDoc).toContain("run-20260422041616");
    expect(gateReport.runId).toBe("run-20260422041616");
    expect(gateReport.acceptance.decision).toBe("accepted");
    await expectGitTrackedPath(relativeReportPath);

    expect(qualityGateDoc).toContain(
      "reports/eval/live-memory/phase-31/run-phase31-live-current/report.json",
    );
    await expectGitTrackedRepoArtifact(
      "reports/eval/live-memory/phase-31/run-phase31-live-current/report.json",
    );
  });

  it("phase-32 quality gate doc points to the canonical gate plus external-host live evidence", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-32-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const relativeReportPath =
      "reports/quality-gates/phase-32/run-20260422085720/phase-32-quality-gate.json";
    const gateReport = JSON.parse(
      await readFile(
        join(import.meta.dir, "../../", relativeReportPath),
        "utf8",
      ),
    ) as {
      acceptance: {
        decision: string;
      };
      runId: string;
    };

    expect(qualityGateDoc).toContain("run-20260422085720");
    expect(gateReport.runId).toBe("run-20260422085720");
    expect(gateReport.acceptance.decision).toBe("accepted");
    await expectGitTrackedPath(relativeReportPath);

    expect(qualityGateDoc).toContain(
      "reports/eval/fallback/phase-32/run-20260422173045/report.json",
    );
    await expectIgnoredGeneratedArtifact(
      "reports/eval/fallback/phase-32/run-20260422173045/report.json",
    );

    expect(qualityGateDoc).toContain(
      "reports/eval/live-memory/phase-32/run-phase32-live-current/report.json",
    );
    await expectGitTrackedRepoArtifact(
      "reports/eval/live-memory/phase-32/run-phase32-live-current/report.json",
    );
  });

  it("phase-33 quality gate doc points to the canonical gate plus package-boundary evidence", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-33-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const relativeReportPath =
      "reports/quality-gates/phase-33/run-20260422212752/phase-33-quality-gate.json";
    const gateReport = JSON.parse(
      await readFile(
        join(import.meta.dir, "../../", relativeReportPath),
        "utf8",
      ),
    ) as {
      acceptance: {
        decision: string;
      };
      runId: string;
    };

    expect(qualityGateDoc).toContain("run-20260422212752");
    expect(qualityGateDoc).toContain("tests/release/node-package-boundary.test.ts");
    expect(qualityGateDoc).toContain("plain AI SDK server");
    expect(qualityGateDoc).toContain("Node-compatible packaged library boundary");
    expect(gateReport.runId).toBe("run-20260422212752");
    expect(gateReport.acceptance.decision).toBe("accepted");
    await expectGitTrackedPath(relativeReportPath);
  });

  it("phase-38 quality gate doc points to the canonical governed runtime surface gate", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-38-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );

    await expectCanonicalAcceptedQualityGate({
      docPath,
      phaseDirectory: "phase-38",
      reportFileName: "phase-38-quality-gate.json",
      runId: "run-20260425084045",
    });

    expect(qualityGateDoc).toContain("GoodMemoryConfig.observability.traceSink");
    expect(qualityGateDoc).toContain("targeted `reviseMemory()`");
    expect(qualityGateDoc).toContain("`memory.runtime.*` facade");
    expect(qualityGateDoc).toContain("`memory.jobs.*`");
    expect(qualityGateDoc).toContain("Express and Fastify");
    expect(qualityGateDoc).toContain("Phase 37.1 hermetic preflight gate passed");
    expect(qualityGateDoc).toContain("--skip-dependency-gates");
  });

  it("phase-39 quality gate doc points to the canonical Python HTTP bridge gate", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-39-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );

    if (process.env.PHASE39_GATE_IN_PROGRESS !== "1") {
      await expectCanonicalAcceptedQualityGate({
        docPath,
        phaseDirectory: "phase-39",
        reportFileName: "phase-39-quality-gate.json",
        runId: "run-20260425041112",
      });
    } else {
      expect(qualityGateDoc).toContain(
        "Canonical accepted gate run: `run-20260425041112`",
      );
    }

    expect(qualityGateDoc).toContain("Python/FastAPI");
    expect(qualityGateDoc).toContain("`POST /memory/recall-context`");
    expect(qualityGateDoc).toContain("examples/python-fastapi-memory-consumer.py");
    expect(qualityGateDoc).toContain("scoped authorization");
    expect(qualityGateDoc).toContain("targeted `/memory/revise`");
  });

  it("phase-40 quality gate doc points to the canonical v0.2 release-candidate gate", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-40-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    if (process.env.PHASE40_GATE_IN_PROGRESS !== "1") {
      await expectCanonicalAcceptedQualityGate({
        docPath,
        phaseDirectory: "phase-40",
        reportFileName: "phase-40-quality-gate.json",
        runId: "run-20260425172323",
      });
    } else {
      expect(qualityGateDoc).toContain(
        "Canonical accepted gate run: `run-20260425172323`",
      );
    }

    expect(qualityGateDoc).toContain("v0.2.0");
    expect(qualityGateDoc).toContain("cross-consumer adoption smoke");
    expect(qualityGateDoc).toContain("no-memory baseline");
    expect(qualityGateDoc).toContain(".tmp-goodmemory-phase40/");
    expect(qualityGateDoc).toContain("raw transcript archive");
    expect(archiveIndex).toContain("GoodMemory-Phase-40-Quality-Gate.md");
  });

  it("phase-41 quality gate doc points to the canonical installed pre-action gate", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-41-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    if (process.env.PHASE41_GATE_IN_PROGRESS !== "1") {
      await expectCanonicalAcceptedQualityGate({
        docPath,
        phaseDirectory: "phase-41",
        reportFileName: "phase-41-quality-gate.json",
        runId: "run-20260425223045",
      });
    } else {
      expect(qualityGateDoc).toContain(
        "Canonical accepted gate run: `run-20260425223045`",
      );
    }

    expect(qualityGateDoc).toContain("installed Codex");
    expect(qualityGateDoc).toContain("PreToolUse");
    expect(qualityGateDoc).toContain("goodmemory codex action");
    expect(qualityGateDoc).toContain(
      "reports/eval/fallback/phase-41/run-20260425213045/report.json",
    );
    expect(qualityGateDoc).toContain(
      "reports/eval/live-memory/phase-41/run-phase41-live-current/report.json",
    );
    expect(archiveIndex).toContain("GoodMemory-Phase-41-Quality-Gate.md");
  });

  it("phase-42 quality gate doc points to the canonical progressive recall gate", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-42-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    if (process.env.PHASE42_GATE_IN_PROGRESS !== "1") {
      await expectCanonicalAcceptedQualityGate({
        docPath,
        phaseDirectory: "phase-42",
        reportFileName: "phase-42-quality-gate.json",
        runId: "run-20260426100000",
      });
    } else {
      expect(qualityGateDoc).toContain(
        "Canonical accepted gate run: `run-20260426100000`",
      );
    }

    expect(qualityGateDoc).toContain("ProgressiveRecallService");
    expect(qualityGateDoc).toContain("gmrec:v1");
    expect(qualityGateDoc).toContain("goodmemory_search_index");
    expect(qualityGateDoc).toContain(
      "reports/eval/fallback/phase-42/run-20260426093000/report.json",
    );
    expect(qualityGateDoc).toContain("third-party/claude-mem-main");
    expect(archiveIndex).toContain("GoodMemory-Phase-42-Quality-Gate.md");
  });

  it("phase-43 quality gate doc points to the canonical runtime-kit gate", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-43-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    if (process.env.PHASE43_GATE_IN_PROGRESS !== "1") {
      await expectCanonicalAcceptedQualityGate({
        docPath,
        phaseDirectory: "phase-43",
        reportFileName: "phase-43-quality-gate.json",
        runId: "run-20260426120000",
      });
    } else {
      expect(qualityGateDoc).toContain(
        "Canonical accepted gate run: `run-20260426120000`",
      );
    }

    expect(qualityGateDoc).toContain("goodmemory/runtime-kit");
    expect(qualityGateDoc).toContain("createGoodMemoryRuntimeKit");
    expect(qualityGateDoc).toContain("afterModelCall");
    expect(qualityGateDoc).toContain(
      "reports/eval/fallback/phase-43/run-20260426113000/report.json",
    );
    expect(qualityGateDoc).toContain("Optional Runtime Worker");
    expect(archiveIndex).toContain("GoodMemory-Phase-43-Quality-Gate.md");
  });

  it("phase-43.5 quality gate doc points to the canonical optional-worker gate", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-43.5-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    if (process.env.PHASE435_GATE_IN_PROGRESS !== "1") {
      await expectCanonicalAcceptedQualityGate({
        docPath,
        phaseDirectory: "phase-43-5",
        reportFileName: "phase-43-5-quality-gate.json",
        runId: "run-20260426140000",
      });
    } else {
      expect(qualityGateDoc).toContain(
        "Canonical accepted gate run: `run-20260426140000`",
      );
    }

    expect(qualityGateDoc).toContain("goodmemory runtime worker drain-once");
    expect(qualityGateDoc).toContain("recover --dry-run");
    expect(qualityGateDoc).toContain(
      "reports/eval/fallback/phase-43-5/run-20260426133000/report.json",
    );
    expect(qualityGateDoc).toContain("no raw transcript");
    expect(archiveIndex).toContain("GoodMemory-Phase-43.5-Quality-Gate.md");
  });

  it("phase-44 quality gate doc points to the canonical local-viewer gate", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-44-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    if (process.env.PHASE44_GATE_IN_PROGRESS !== "1") {
      await expectCanonicalAcceptedQualityGate({
        docPath,
        phaseDirectory: "phase-44",
        reportFileName: "phase-44-quality-gate.json",
        runId: "run-20260426160000",
      });
    } else {
      expect(qualityGateDoc).toContain(
        "Canonical accepted gate run: `run-20260426160000`",
      );
    }

    expect(qualityGateDoc).toContain("goodmemory runtime viewer");
    expect(qualityGateDoc).toContain("127.0.0.1");
    expect(qualityGateDoc).toContain("no CORS");
    expect(qualityGateDoc).toContain(
      "reports/eval/fallback/phase-44/run-20260426153000/report.json",
    );
    expect(qualityGateDoc).toContain("third-party/claude-mem-main");
    expect(archiveIndex).toContain("GoodMemory-Phase-44-Quality-Gate.md");
  });

  it("phase-45 quality gate doc points to the canonical reference-product gate", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-45-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    if (process.env.PHASE45_GATE_IN_PROGRESS !== "1") {
      await expectCanonicalAcceptedQualityGate({
        docPath,
        phaseDirectory: "phase-45",
        reportFileName: "phase-45-quality-gate.json",
        runId: "run-20260427110000",
      });
    } else {
      expect(qualityGateDoc).toContain(
        "Canonical accepted gate run: `run-20260427110000`",
      );
    }

    expect(qualityGateDoc).toContain("reference product");
    expect(qualityGateDoc).toContain("run-20260427104530-adoption-eval");
    expect(qualityGateDoc).toContain("viewer remains read-only");
    expect(qualityGateDoc).toContain("not a hosted dashboard");
    expect(archiveIndex).toContain("GoodMemory-Phase-45-Quality-Gate.md");
  });

  it("phase-46 quality gate doc points to the canonical quality-maintenance gate", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-46-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    if (process.env.PHASE46_GATE_IN_PROGRESS !== "1") {
      await expectCanonicalAcceptedQualityGate({
        docPath,
        phaseDirectory: "phase-46",
        reportFileName: "phase-46-quality-gate.json",
        runId: "run-20260428110000",
      });
    } else {
      expect(qualityGateDoc).toContain(
        "Canonical accepted gate run: `run-20260428110000`",
      );
    }

    expect(qualityGateDoc).toContain("Memory Quality and Maintenance 2.0");
    expect(qualityGateDoc).toContain("run-20260427123000-quality-eval");
    expect(qualityGateDoc).toContain("maintenance guardrail");
    expect(qualityGateDoc).toContain("provider-backed retrieval default promotion");
    expect(archiveIndex).toContain("GoodMemory-Phase-46-Quality-Gate.md");
  });

  it("phase-47 quality gate doc points to the canonical provider rollout gate", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-47-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    if (process.env.PHASE47_GATE_IN_PROGRESS !== "1") {
      await expectCanonicalAcceptedQualityGate({
        docPath,
        phaseDirectory: "phase-47",
        reportFileName: "phase-47-quality-gate.json",
        runId: "run-20260428123000",
      });
    } else {
      expect(qualityGateDoc).toContain(
        "Canonical accepted gate run: `run-20260428123000`",
      );
    }

    expect(qualityGateDoc).toContain("Provider-Backed Retrieval Rollout");
    expect(qualityGateDoc).toContain("run-20260428120000-provider-rollout-eval");
    expect(qualityGateDoc).toContain("rules-only fallback");
    expect(qualityGateDoc).toContain("provider_error");
    expect(qualityGateDoc).toContain("root `goodmemory` public API");
    expect(archiveIndex).toContain("GoodMemory-Phase-47-Quality-Gate.md");
  });

  it("phase-48 quality gate doc points to the canonical hosted-surface decision gate", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-48-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    if (process.env.PHASE48_GATE_IN_PROGRESS !== "1") {
      await expectCanonicalAcceptedQualityGate({
        docPath,
        phaseDirectory: "phase-48",
        reportFileName: "phase-48-quality-gate.json",
        runId: "run-20260428173000",
      });
    } else {
      expect(qualityGateDoc).toContain(
        "Canonical accepted gate run: `run-20260428173000`",
      );
    }

    expect(qualityGateDoc).toContain(
      "Dashboard, Cloud Sync, and Team Workspace Decision",
    );
    expect(qualityGateDoc).toContain(
      "run-20260428170000-dashboard-cloud-decision",
    );
    expect(qualityGateDoc).toContain("no-go");
    expect(qualityGateDoc).toContain("auth");
    expect(qualityGateDoc).toContain("tenancy");
    expect(qualityGateDoc).toContain("raw transcript");
    expect(qualityGateDoc).toContain("local viewer remains local-only");
    expect(archiveIndex).toContain("GoodMemory-Phase-48-Quality-Gate.md");
  });

  it("phase-49 quality gate doc points to the canonical research smoke harness", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-49-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    await expectCanonicalAcceptedQualityGate({
      docPath,
      phaseDirectory: "phase-49",
      reportFileName: "phase-49-quality-gate.json",
      runId: "run-20260428210000",
    });

    expect(qualityGateDoc).toContain("internal-only research harness");
    expect(qualityGateDoc).toContain("run-phase49-smoke-current");
    expect(qualityGateDoc).toContain("GOODMEMORY_IMPLICITMEMBENCH_ROOT");
    expect(qualityGateDoc).toContain("baseline-upstream-chat");
    expect(qualityGateDoc).toContain("goodmemory-raw-experience");
    expect(qualityGateDoc).toContain("goodmemory-distilled-feedback");
    expect(qualityGateDoc).toContain("priming_pair_judge");
    expect(archiveIndex).toContain("GoodMemory-Phase-49-Quality-Gate.md");
  });

  it("phase-50 quality gate doc points to the canonical installer hardening evidence", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-50-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    await expectCanonicalAcceptedQualityGate({
      docPath,
      phaseDirectory: "phase-50",
      reportFileName: "phase-50-quality-gate.json",
      runId: "run-20260428224500",
    });

    expect(qualityGateDoc).toContain("Installer CLI Runtime-Shell Hardening");
    expect(qualityGateDoc).toContain("goodmemory doctor");
    expect(qualityGateDoc).toContain("goodmemory repair");
    expect(qualityGateDoc).toContain("dry-run no-mutation");
    expect(qualityGateDoc).toContain("no default writeback escalation");
    expect(archiveIndex).toContain("GoodMemory-Phase-50-Quality-Gate.md");
  });

  it("phase-51 quality gate doc points to the canonical typed behavioral hardening evidence", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-51-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    await expectCanonicalAcceptedQualityGate({
      docPath,
      phaseDirectory: "phase-51",
      reportFileName: "phase-51-quality-gate.json",
      runId: "run-20260430164000",
    });

    expect(qualityGateDoc).toContain(
      "Typed Behavioral Memory And Enactment Hardening",
    );
    expect(qualityGateDoc).toContain(PHASE51_CANONICAL_FALLBACK_REPORT);
    expect(qualityGateDoc).toContain(PHASE51_CANONICAL_LIVE_REPORT);
    expect(qualityGateDoc).toContain("validated_pattern");
    expect(qualityGateDoc).toContain("steering-only");
    expect(qualityGateDoc).toContain("first_action");
    expect(qualityGateDoc).toContain("full-300 ImplicitMemBench rerun");
    expect(archiveIndex).toContain("GoodMemory-Phase-51-Quality-Gate.md");
  });

  it("phase-52 quality gate doc points to the canonical structured enactment evidence", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-52-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    await expectCanonicalAcceptedQualityGate({
      docPath,
      phaseDirectory: "phase-52",
      reportFileName: "phase-52-quality-gate.json",
      runId: "run-20260502183000",
    });

    expect(qualityGateDoc).toContain(
      "Structured Text-Response Enactment And Guarded Policy",
    );
    expect(qualityGateDoc).toContain(PHASE52_CANONICAL_FALLBACK_REPORT);
    expect(qualityGateDoc).toContain(PHASE52_CANONICAL_LIVE_REPORT);
    expect(qualityGateDoc).toContain("guarded_policy");
    expect(qualityGateDoc).toContain("rewrite_output_slot");
    expect(qualityGateDoc).toContain("require_precondition_check");
    expect(qualityGateDoc).toContain("exact host-action recovery");
    expect(archiveIndex).toContain("GoodMemory-Phase-52-Quality-Gate.md");
  });

  it("phase-53 quality gate doc points to the canonical surface determinism evidence", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-53-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    await expectCanonicalAcceptedQualityGate({
      docPath,
      phaseDirectory: "phase-53",
      reportFileName: "phase-53-quality-gate.json",
      runId: "run-20260502203000",
    });

    expect(qualityGateDoc).toContain(
      "Surface Determinism, Escalation Routing, And Procedural Executor Recovery",
    );
    expect(qualityGateDoc).toContain(PHASE53_CANONICAL_FALLBACK_REPORT);
    expect(qualityGateDoc).toContain(PHASE53_CANONICAL_LIVE_REPORT);
    expect(qualityGateDoc).toContain("distrust escalation");
    expect(qualityGateDoc).toContain("side-effect safe replacement");
    expect(qualityGateDoc).toContain("exact command extraction");
    expect(qualityGateDoc).toContain("explicit Postgres-backed shards");
    expect(archiveIndex).toContain("GoodMemory-Phase-53-Quality-Gate.md");
  });

  it("phase-54 quality gate doc points to the canonical raw internalization evidence", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-54-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    await expectCanonicalAcceptedQualityGate({
      docPath,
      phaseDirectory: "phase-54",
      reportFileName: "phase-54-quality-gate.json",
      runId: "run-20260503193000",
    });

    expect(qualityGateDoc).toContain("Exemplar-First Raw Internalization");
    expect(qualityGateDoc).toContain(PHASE54_CANONICAL_FALLBACK_REPORT);
    expect(qualityGateDoc).toContain(PHASE54_CANONICAL_LIVE_REPORT);
    expect(qualityGateDoc).toContain("RawBehavioralExemplar");
    expect(qualityGateDoc).toContain("abstention");
    expect(qualityGateDoc).toContain("prototype-bounded");
    expect(qualityGateDoc).toContain("5 / 12");
    expect(archiveIndex).toContain("GoodMemory-Phase-54-Quality-Gate.md");
  });

  it("phase-55 quality gate doc points to the canonical raw calibration evidence", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-55-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    await expectCanonicalAcceptedQualityGate({
      docPath,
      phaseDirectory: "phase-55",
      reportFileName: "phase-55-quality-gate.json",
      runId: "run-20260503233000",
    });

    expect(qualityGateDoc).toContain(
      "Probe-Conditioned Raw Carryover And Retrieval Calibration",
    );
    expect(qualityGateDoc).toContain(PHASE55_CANONICAL_FALLBACK_REPORT);
    expect(qualityGateDoc).toContain(PHASE55_CANONICAL_LIVE_REPORT);
    expect(qualityGateDoc).toContain("RawCarryoverPacket");
    expect(qualityGateDoc).toContain("RawQueryIntent");
    expect(qualityGateDoc).toContain("interference ledger");
    expect(qualityGateDoc).toContain("6 / 12");
    expect(archiveIndex).toContain("GoodMemory-Phase-55-Quality-Gate.md");
  });

  it("phase-56 quality gate doc points to the canonical raw hypothesis evidence", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-56-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    await expectCanonicalAcceptedQualityGate({
      docPath,
      phaseDirectory: "phase-56",
      reportFileName: "phase-56-quality-gate.json",
      runId: "run-20260504003000",
    });

    expect(qualityGateDoc).toContain(
      "Hypothesis-Carrying Raw Internalization",
    );
    expect(qualityGateDoc).toContain(PHASE56_CANONICAL_FALLBACK_REPORT);
    expect(qualityGateDoc).toContain(PHASE56_CANONICAL_LIVE_REPORT);
    expect(qualityGateDoc).toContain("RawTaskHypothesis");
    expect(qualityGateDoc).toContain("support/conflict");
    expect(qualityGateDoc).toContain("11 / 12");
    expect(qualityGateDoc).toContain("raw `45 / 200`");
    expect(archiveIndex).toContain("GoodMemory-Phase-56-Quality-Gate.md");
  });

  it("phase-57 quality gate doc points to raw generalization evidence", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-57-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    await expectCanonicalAcceptedQualityGate({
      docPath,
      phaseDirectory: "phase-57",
      reportFileName: "phase-57-quality-gate.json",
      runId: "run-20260504013000",
    });

    expect(qualityGateDoc).toContain(
      "Raw Internalization Generalization and Enactment",
    );
    expect(qualityGateDoc).toContain(PHASE57_CANONICAL_FALLBACK_REPORT);
    expect(qualityGateDoc).toContain(PHASE57_CANONICAL_RAW_DIAGNOSTICS);
    expect(qualityGateDoc).toContain("hard_constraint_contract");
    expect(qualityGateDoc).toContain("10 / 12");
    expect(qualityGateDoc).toContain("full-300");
    expect(archiveIndex).toContain("GoodMemory-Phase-57-Quality-Gate.md");
  });

  it("phase-58 quality gate doc points to raw enactment compiler evidence", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-58-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    await expectCanonicalAcceptedQualityGate({
      docPath,
      phaseDirectory: "phase-58",
      reportFileName: "phase-58-quality-gate.json",
      runId: "run-20260504183000",
    });

    expect(qualityGateDoc).toContain(
      "Raw Enactment Compiler and Repair Loop",
    );
    expect(qualityGateDoc).toContain(PHASE58_CANONICAL_FALLBACK_REPORT);
    expect(qualityGateDoc).toContain(PHASE58_CANONICAL_RAW_DIAGNOSTICS);
    expect(qualityGateDoc).toContain("TextResponseEnactmentPlan");
    expect(qualityGateDoc).toContain("41 / 50");
    expect(qualityGateDoc).toContain("full-300");
    expect(archiveIndex).toContain("GoodMemory-Phase-58-Quality-Gate.md");
  });

  it("phase-59 quality gate doc points to generalized raw executor evidence", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-59-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    await expectCanonicalAcceptedQualityGate({
      docPath,
      phaseDirectory: "phase-59",
      reportFileName: "phase-59-quality-gate.json",
      runId: "run-20260504193000",
    });

    expect(qualityGateDoc).toContain("Generalized Raw Executor Cleanup");
    expect(qualityGateDoc).toContain(PHASE59_CANONICAL_FALLBACK_REPORT);
    expect(qualityGateDoc).toContain(PHASE59_CANONICAL_RAW_DIAGNOSTICS);
    expect(qualityGateDoc).toContain("failed_operation -> preferred_operation");
    expect(qualityGateDoc).toContain("58 / 60");
    expect(qualityGateDoc).toContain("full-300");
    expect(archiveIndex).toContain("GoodMemory-Phase-59-Quality-Gate.md");
  });

  it("phase-60 quality gate doc points to overall and priming protocol evidence", async () => {
    const docPath = `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-60-Quality-Gate.md`;
    const qualityGateDoc = await readFile(
      join(import.meta.dir, "../../", docPath),
      "utf8",
    );
    const archiveIndex = await readFile(
      join(import.meta.dir, "../../", QUALITY_GATE_ARCHIVE_ROOT, "README.md"),
      "utf8",
    );

    await expectCanonicalAcceptedQualityGate({
      docPath,
      phaseDirectory: "phase-60",
      reportFileName: "phase-60-quality-gate.json",
      runId: "run-20260505120000",
    });

    expect(qualityGateDoc).toContain("ImplicitMemBench Overall And Priming Protocol");
    expect(qualityGateDoc).toContain(PHASE60_CANONICAL_OVERALL_SUMMARY);
    expect(qualityGateDoc).toContain("full300OverallScore");
    expect(qualityGateDoc).toContain("contaminated priming cannot raise the score");
    expect(qualityGateDoc).toContain("five-shard Postgres-backed full-300 rerun");
    expect(archiveIndex).toContain("GoodMemory-Phase-60-Quality-Gate.md");
  });

  it("models fallback eval evidence as regenerable ignored output, not tracked audit artifacts", async () => {
    const listed = await runGitCommand([
      "ls-files",
      "reports/quality-gates",
    ]);
    expect(listed.exitCode).toBe(0);

    const qualityGatePaths = listed.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".json"));
    const fallbackEvidence: Array<{
      artifactKind?: unknown;
      path: string;
      pathKey: "ignoredArtifactPath" | "ignoredReportPath";
      regenerateCommand?: unknown;
    }> = [];

    for (const relativePath of qualityGatePaths) {
      const report = JSON.parse(
        await readFile(join(import.meta.dir, "../../", relativePath), "utf8"),
      ) as unknown;
      expect(collectFallbackReportPathViolations(report)).toEqual([]);
      fallbackEvidence.push(...collectIgnoredFallbackEvidence(report));
    }

    expect(fallbackEvidence.length).toBeGreaterThan(0);
    const trackedFallbackArtifacts = new Set(
      await collectTrackedFallbackArtifacts(),
    );
    const requiredMetadataPaths = uniqueSorted([
      ...(await collectTrackedFallbackArtifactCitations()),
      ...(await collectStagedDeletedFallbackArtifacts()),
    ].filter((path) => !trackedFallbackArtifacts.has(path))).filter((path) => {
      if (
        process.env.PHASE41_GATE_IN_PROGRESS === "1" &&
        path === PHASE41_CANONICAL_FALLBACK_REPORT
      ) {
        return false;
      }
      if (
        process.env.PHASE42_GATE_IN_PROGRESS === "1" &&
        path === PHASE42_CANONICAL_FALLBACK_REPORT
      ) {
        return false;
      }
      if (
        process.env.PHASE43_GATE_IN_PROGRESS === "1" &&
        path === PHASE43_CANONICAL_FALLBACK_REPORT
      ) {
        return false;
      }
      if (
        process.env.PHASE435_GATE_IN_PROGRESS === "1" &&
        path === PHASE435_CANONICAL_FALLBACK_REPORT
      ) {
        return false;
      }
      if (
        process.env.PHASE44_GATE_IN_PROGRESS === "1" &&
        path === PHASE44_CANONICAL_FALLBACK_REPORT
      ) {
        return false;
      }
      if (
        process.env.PHASE46_GATE_IN_PROGRESS === "1" &&
        path === PHASE46_CANONICAL_FALLBACK_REPORT
      ) {
        return false;
      }
      if (
        process.env.PHASE47_GATE_IN_PROGRESS === "1" &&
        path === PHASE47_CANONICAL_FALLBACK_REPORT
      ) {
        return false;
      }
      if (
        process.env.PHASE48_GATE_IN_PROGRESS === "1" &&
        path === PHASE48_CANONICAL_FALLBACK_REPORT
      ) {
        return false;
      }
      return true;
    });
    const metadataPaths = new Set(
      fallbackEvidence.map((evidence) => evidence.path),
    );

    expect(requiredMetadataPaths.length).toBeGreaterThan(0);
    expect(
      requiredMetadataPaths.filter((path) => !metadataPaths.has(path)),
    ).toEqual([]);

    for (const evidence of fallbackEvidence) {
      expect(evidence.artifactKind).toBe("ignored_generated");
      expect(typeof evidence.regenerateCommand).toBe("string");
      expect(String(evidence.regenerateCommand)).toContain("--run-id");
      if (evidence.path.endsWith("/report.json")) {
        expect(evidence.pathKey).toBe("ignoredReportPath");
      }
    }
    await expectIgnoredGeneratedArtifacts(
      uniqueSorted(fallbackEvidence.map((evidence) => evidence.path)),
    );
  }, 60_000);

  it("phase-21 through phase-23 closure docs only cite git-tracked live eval reports", async () => {
    await expectTrackedEvalReportsMentionedInFile(
      `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-21-Quality-Gate.md`,
    );
    await expectTrackedEvalReportsMentionedInFile(
      `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-22-Quality-Gate.md`,
    );
    await expectTrackedEvalReportsMentionedInFile(
      `${QUALITY_GATE_ARCHIVE_ROOT}/GoodMemory-Phase-23-Quality-Gate.md`,
    );
  });

  it("canonical task-board ordering only references git-tracked phase artifacts", async () => {
    const board = await readFile(
      join(import.meta.dir, "../../task-board/00-README.txt"),
      "utf8",
    );
    const phaseFiles = [
      ...board.matchAll(/^\d+\.\s+([^\s]+\.txt)$/gm),
    ].map((match) => `task-board/${match[1]}`);

    expect(phaseFiles.length).toBeGreaterThan(0);

    const breakdownReadmes = new Set<string>();

    for (const phaseFile of phaseFiles) {
      await expectGitTrackedPath(phaseFile);
      const phaseContent = await readFile(
        join(import.meta.dir, "../../", phaseFile),
        "utf8",
      );
      for (const match of phaseContent.matchAll(
        /task-board\/(phase-[^/\s`]+\/00-README\.txt)/g,
      )) {
        breakdownReadmes.add(`task-board/${match[1]}`);
      }
    }

    expect(breakdownReadmes.size).toBeGreaterThan(0);

    for (const breakdownReadme of breakdownReadmes) {
      await expectGitTrackedPath(breakdownReadme);
    }
  });

  it("task-board sequencing and phase docs only cite git-tracked eval reports", async () => {
    for (const relativePath of [
      "docs/GoodMemory-Current-Status-and-Evidence.md",
      "task-board/00-README.txt",
      "task-board/23-phase-22-recall-router-provider-hardening-and-promotion-readiness.txt",
      "task-board/28-phase-27-reference-integration-gate-and-adoption-evidence.txt",
      "task-board/phase-27-reference-integration-gate-and-adoption-evidence/02-deterministic-adoption-eval.txt",
      "task-board/phase-27-reference-integration-gate-and-adoption-evidence/03-live-adoption-evidence.txt",
      "task-board/phase-27-reference-integration-gate-and-adoption-evidence/04-codex-handoff-gate-and-closure.txt",
    ] as const) {
      await expectTrackedEvalReportsMentionedInFile(relativePath);
    }
  }, 15_000);

  it("phase-20 canonical dependency summaries are checked in", async () => {
    const qualityGateDoc = await readFile(
      join(
        import.meta.dir,
        "../../",
        QUALITY_GATE_ARCHIVE_ROOT,
        "GoodMemory-Phase-20-Quality-Gate.md",
      ),
      "utf8",
    );

    expect(qualityGateDoc).toContain(
      "archives dependency gate summary artifacts under `reports/quality-gates/phase-20/run-20260420023503/dependency-gates/`",
    );

    for (const relativePath of CANONICAL_PHASE20_DEPENDENCY_SUMMARY_ARTIFACTS) {
      await expectGitTrackedRepoArtifact(relativePath);
    }
  });

  it("keeps only the canonical C3 projection bundle trackable", async () => {
    const root =
      "reports/quality-gates/phase-73/c3-controlled-20260716-cleanclone-003";
    const projectedFiles = [
      "audit-evidence.sanitized.json",
      "base-health.json",
      "c3-verification.json",
      "cases.jsonl",
      "evaluator-security.sanitized.json",
      "frozen-prehistory-seed-receipt.json",
      "goodmemory-source-state-post-run.json",
      "goodmemory-source-state.json",
      "host-configurations.sanitized.json",
      "host-preflight.sanitized.json",
      "prehistory-leakage-audit.json",
      "projection-manifest.json",
      "prompt-leakage-audit.json",
      "run-identity.json",
      "runner-source-state-post-run.json",
      "runner-source-state.json",
      "stage-evidence/example-stage.json",
      "summary.json",
    ].map((path) => `${root}/${path}`);

    const projected = await runGitCommand([
      "check-ignore",
      "-v",
      "--no-index",
      ...projectedFiles,
    ]);
    expect(projected.exitCode).toBe(0);
    for (const path of projectedFiles) {
      expect(projected.stdout).toContain(`\t${path}`);
    }
    expect(
      projected.stdout
        .trim()
        .split(/\r?\n/u)
        .every((line) => line.includes("!")),
    ).toBe(true);

    for (const path of [
      `${root}/codex.stdout.log`,
      `${root}/raw-run.json`,
    ]) {
      await expectIgnoredGeneratedArtifact(path);
    }
  });

  it("coding-agent example stays on the public path and avoids internal evolution imports", async () => {
    const example = await readFile(
      join(import.meta.dir, "../../examples/coding-agent.ts"),
      "utf8",
    );

    expect(example).not.toContain("../src/evolution/salvage");
    expect(example).not.toContain("createRuntimeSalvageHooks");
    expect(example).not.toContain("SESSION_ARCHIVES_COLLECTION");
  });

  it("bun test discovery is pinned to the repository test tree", async () => {
    const bunfig = await readFile(join(import.meta.dir, "../../bunfig.toml"), "utf8");
    const allBunfig = await readFile(join(import.meta.dir, "../../bunfig.all.toml"), "utf8");

    expect(bunfig).toContain('[test]');
    expect(bunfig).toContain('root = "tests"');
    expect(allBunfig).toContain('[test]');
    expect(allBunfig).toContain('root = "."');
  });

  it("keeps expensive Phase 73 evidence replay out of the canonical red-green loop", async () => {
    const [bunfig, gateBunfig, packageBytes] = await Promise.all([
      readFile(join(import.meta.dir, "../../bunfig.toml"), "utf8"),
      readFile(
        join(import.meta.dir, "../../bunfig.phase-73-gates.toml"),
        "utf8",
      ),
      readFile(join(import.meta.dir, "../../package.json"), "utf8"),
    ]);
    const packageJson = JSON.parse(packageBytes) as {
      scripts: Record<string, string>;
    };
    const oldPath = join(
      import.meta.dir,
      "../unit/codex-coding-effect.c5-evidence.test.ts",
    );
    const gatePath = join(
      import.meta.dir,
      "../quality-gates/phase-73/codex-coding-effect.c5-evidence.test.ts",
    );
    const oldReadinessPath = join(
      import.meta.dir,
      "../integration/codex-coding-effect.c5-readiness.test.ts",
    );
    const gateReadinessPath = join(
      import.meta.dir,
      "../quality-gates/phase-73/codex-coding-effect.c5-readiness.test.ts",
    );

    expect(bunfig).toContain(
      'pathIgnorePatterns = ["tests/quality-gates/**"]',
    );
    expect(gateBunfig).toContain(
      'root = "tests/quality-gates/phase-73"',
    );
    expect(packageJson.scripts["test:phase-73-gates"]).toBe(
      "bun --config=bunfig.phase-73-gates.toml test",
    );
    expect(await Bun.file(oldPath).exists()).toBe(false);
    expect(await Bun.file(gatePath).exists()).toBe(true);
    expect(await Bun.file(oldReadinessPath).exists()).toBe(false);
    expect(await Bun.file(gateReadinessPath).exists()).toBe(true);
  });
});
