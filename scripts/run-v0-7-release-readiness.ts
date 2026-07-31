import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  hasCliFlagStrict,
  resolveCliFlagValueStrict,
} from "./cli-options";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

const RELEASE_LINE = "0.7";
const RELEASE_VERSION = "0.7.1";
const RELEASE_BUN_VERSION = "1.3.14";
const MAX_TARBALL_BYTES = 4 * 1024 * 1024;
const REQUIRED_PACKED_FILES = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/ai-sdk/index.js",
  "dist/ai-sdk/index.d.ts",
  "dist/host/index.js",
  "dist/host/index.d.ts",
  "dist/http/index.js",
  "dist/http/index.d.ts",
  "dist/runtime-kit/index.js",
  "dist/runtime-kit/index.d.ts",
  "docs/GoodMemory-0.6-to-0.7-Migration-Guide.md",
  "package.json",
] as const;

type CheckStatus = "pass" | "fail" | "skip";

export interface V07ReleaseReadinessCheck {
  detail: string;
  durationMs: number;
  id: string;
  required: boolean;
  status: CheckStatus;
  title: string;
}

export interface V07ReleaseReadinessReport {
  allRequiredPassed: boolean;
  checks: V07ReleaseReadinessCheck[];
  generatedAt: string;
  generatedBy: "scripts/run-v0-7-release-readiness.ts";
  packageVersion: string;
  runtime: V07RuntimeIdentity;
  sourceIdentity: V07SourceIdentity;
  summary: {
    failed: number;
    passed: number;
    skipped: number;
    total: number;
  };
}

export interface V07RuntimeIdentity {
  bunVersion: string;
  nodeVersion: string;
}

export interface V07SourceIdentity {
  commitSha: string;
  treeSha: string;
}

export interface V07ReleaseReadinessOptions {
  outputDir?: string;
  skipBuild?: boolean;
  skipCoverage?: boolean;
  skipTests?: boolean;
  strict?: boolean;
}

export const V07_RELEASE_REQUIRED_COMMANDS = [
  {
    args: ["run", "typecheck"],
    command: "bun",
    id: "typecheck",
  },
  {
    args: ["test", "--timeout=300000"],
    command: "bun",
    id: "tests",
  },
  {
    args: ["run", "test:coverage"],
    command: "bun",
    id: "coverage",
  },
  {
    args: ["run", "build"],
    command: "bun",
    id: "build",
  },
  {
    args: ["run", "gate:public-benchmark-claim", "--strict"],
    command: "bun",
    id: "public-claims",
  },
  {
    args: [
      "run",
      "gate:phase-74-storage-scale",
      "--output",
      "reports/release/v0.7/phase-74-storage-scale-gate.json",
    ],
    command: "bun",
    id: "scale",
  },
  {
    args: [
      "test",
      "tests/integration/storage.postgres.test.ts",
      "tests/integration/api.postgres.test.ts",
    ],
    command: "bun",
    id: "postgres",
    requiredEnvironment: "GOODMEMORY_TEST_POSTGRES_URL",
  },
] as const;

type RequiredCommandId = (typeof V07_RELEASE_REQUIRED_COMMANDS)[number]["id"];

const REQUIRED_COMMAND_DETAILS: Record<
  RequiredCommandId,
  { successDetail: string; title: string }
> = {
  build: {
    successDetail: "compiled JavaScript and declarations built",
    title: "Compiled package build",
  },
  coverage: {
    successDetail: "overall and src/language coverage gates passed",
    title: "Coverage gates",
  },
  postgres: {
    successDetail:
      "real Postgres functionality, migration, scale, and EXPLAIN gates passed",
    title: "Real Postgres functionality, migration, scale, and EXPLAIN gates",
  },
  "public-claims": {
    successDetail:
      "strict public-claim and historical-evidence consistency gate passed",
    title: "Public benchmark claim gate",
  },
  scale: {
    successDetail:
      "Phase 74 scale gate passed at 100k searchable and 150k stored projection rows",
    title: "Phase 74 projection storage scale gate (100k searchable / 150k stored)",
  },
  tests: {
    successDetail: "full canonical Bun test suite passed",
    title: "Full canonical Bun test suite",
  },
  typecheck: {
    successDetail: "tsc --noEmit clean",
    title: "TypeScript typecheck",
  },
};

interface CommandOutcome {
  code: number | null;
  durationMs: number;
  stderr: string;
  stdout: string;
}

export function evaluateV07SourceIdentity(input: {
  commitSha: string;
  status: string;
  treeSha: string;
}): {
  check: V07ReleaseReadinessCheck;
  sourceIdentity: V07SourceIdentity;
} {
  const commitSha = input.commitSha.trim();
  const treeSha = input.treeSha.trim();
  const status = input.status.trim();
  const issues = [
    ...(commitSha ? [] : ["git commit identity is unavailable"]),
    ...(treeSha ? [] : ["git tree identity is unavailable"]),
    ...(status ? [`worktree is not clean: ${status}`] : []),
  ];
  return {
    check: {
      detail: issues.length === 0
        ? `clean source ${commitSha} / tree ${treeSha}`
        : issues.join("; "),
      durationMs: 0,
      id: "source-identity",
      required: true,
      status: issues.length === 0 ? "pass" : "fail",
      title: "Exact source identity",
    },
    sourceIdentity: { commitSha, treeSha },
  };
}

export function evaluateV07SourceStability(input: {
  final: {
    check: V07ReleaseReadinessCheck;
    sourceIdentity: V07SourceIdentity;
  };
  initial: V07SourceIdentity;
}): V07ReleaseReadinessCheck {
  const stable = input.final.check.status === "pass" &&
    input.final.sourceIdentity.commitSha === input.initial.commitSha &&
    input.final.sourceIdentity.treeSha === input.initial.treeSha;
  return {
    detail: stable
      ? "commit, tree, and clean worktree remained stable throughout all release checks"
      : `source identity changed while release checks ran: ${input.final.check.detail}`,
    durationMs: 0,
    id: "source-stability",
    required: true,
    status: stable ? "pass" : "fail",
    title: "Source identity stability",
  };
}

export function evaluateV07RuntimeVersions(
  runtime: V07RuntimeIdentity,
): V07ReleaseReadinessCheck {
  const nodeVersion = runtime.nodeVersion.trim();
  const bunVersion = runtime.bunVersion.trim();
  const issues = [
    ...(/^v?20(?:\.|$)/u.test(nodeVersion)
      ? []
      : [`Node 20 is required, got ${nodeVersion || "<unavailable>"}`]),
    ...(bunVersion === RELEASE_BUN_VERSION
      ? []
      : [`Bun ${RELEASE_BUN_VERSION} is required, got ${bunVersion || "<unavailable>"}`]),
  ];
  return {
    detail: issues.length === 0
      ? `Node ${nodeVersion} / Bun ${bunVersion}`
      : issues.join("; "),
    durationMs: 0,
    id: "runtime-identity",
    required: true,
    status: issues.length === 0 ? "pass" : "fail",
    title: "Release runtime identity",
  };
}

interface PackageJson {
  goodmemoryRelease?: {
    installCommandsApplyAfterPublish?: boolean;
    npmDistTag?: string;
    status?: string;
  };
  version: string;
}

interface PackageLock {
  packages?: Record<string, { version?: string }>;
  version?: string;
}

interface CapabilityDescriptor {
  benchmarks?: {
    currentClaims?: Array<{ measuredPackageVersion?: string }>;
  };
  install?: {
    bun?: string;
    npmGlobal?: string;
    npmPackage?: string;
  };
  releaseStatus?: {
    installCommandsApplyAfterPublish?: boolean;
    npmDistTag?: string;
    status?: string;
    tarball?: string;
  };
  version?: string;
}

interface ServerDescriptor {
  packages?: Array<{ version?: string }>;
  version?: string;
}

export function parseV07ReleaseReadinessCliOptions(
  argv: readonly string[],
): V07ReleaseReadinessOptions {
  const options = {
    outputDir: resolveCliFlagValueStrict(argv, "--output-dir"),
    skipBuild: hasCliFlagStrict(argv, "--skip-build"),
    skipCoverage: hasCliFlagStrict(argv, "--skip-coverage"),
    skipTests: hasCliFlagStrict(argv, "--skip-tests"),
    strict: hasCliFlagStrict(argv, "--strict"),
  };
  assertValidV07ReleaseReadinessOptions(options);
  return options;
}

function assertValidV07ReleaseReadinessOptions(
  options: V07ReleaseReadinessOptions,
): void {
  if (
    options.strict &&
    (options.skipBuild || options.skipCoverage || options.skipTests)
  ) {
    throw new Error(
      "--strict cannot be combined with release-check skip flags.",
    );
  }
}

export function evaluateV07RequiredChecks(
  checks: readonly V07ReleaseReadinessCheck[],
): boolean {
  return checks.every(
    (check) => !check.required || check.status === "pass",
  );
}

export function evaluateV07PackManifest(
  files: readonly string[],
  tarballBytes: number,
): string[] {
  const present = new Set(files);
  const missing = REQUIRED_PACKED_FILES.filter((file) => !present.has(file));
  const issues: string[] = [];

  if (missing.length > 0) {
    issues.push(`tarball missing: ${missing.join(", ")}`);
  }
  if (tarballBytes >= MAX_TARBALL_BYTES) {
    issues.push(
      `compressed tarball ${tarballBytes} bytes must be below ${MAX_TARBALL_BYTES} bytes`,
    );
  }

  return issues;
}

function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const child = spawn(command, args, {
      cwd,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: Error) => {
      resolve({
        code: null,
        durationMs: Math.round(performance.now() - startedAt),
        stderr: String(error),
        stdout,
      });
    });
    child.on("close", (code: number | null) => {
      resolve({
        code,
        durationMs: Math.round(performance.now() - startedAt),
        stderr,
        stdout,
      });
    });
  });
}

export async function collectV07SourceIdentity(repoRoot: string): Promise<{
  check: V07ReleaseReadinessCheck;
  sourceIdentity: V07SourceIdentity;
}> {
  const [commit, tree, status] = await Promise.all([
    runCommand("git", ["rev-parse", "HEAD"], repoRoot),
    runCommand("git", ["rev-parse", "HEAD^{tree}"], repoRoot),
    runCommand(
      "git",
      ["status", "--porcelain", "--untracked-files=all"],
      repoRoot,
    ),
  ]);
  return evaluateV07SourceIdentity({
    commitSha: commit.code === 0 ? commit.stdout : "",
    status: status.code === 0 ? status.stdout : status.stderr || "git status failed",
    treeSha: tree.code === 0 ? tree.stdout : "",
  });
}

async function collectV07RuntimeIdentity(repoRoot: string): Promise<{
  check: V07ReleaseReadinessCheck;
  runtime: V07RuntimeIdentity;
}> {
  const [node, bun] = await Promise.all([
    runCommand("node", ["--version"], repoRoot),
    runCommand("bun", ["--version"], repoRoot),
  ]);
  const runtime = {
    bunVersion: bun.code === 0 ? bun.stdout.trim() : "",
    nodeVersion: node.code === 0 ? node.stdout.trim() : "",
  };
  return {
    check: evaluateV07RuntimeVersions(runtime),
    runtime,
  };
}

function tail(value: string, lineCount = 12): string {
  return value.trimEnd().split("\n").slice(-lineCount).join("\n");
}

function commandCheck(input: {
  id: string;
  outcome: CommandOutcome;
  successDetail: string;
  title: string;
}): V07ReleaseReadinessCheck {
  return {
    detail:
      input.outcome.code === 0
        ? input.successDetail
        : tail([input.outcome.stdout, input.outcome.stderr].filter(Boolean).join("\n")),
    durationMs: input.outcome.durationMs,
    id: input.id,
    required: true,
    status: input.outcome.code === 0 ? "pass" : "fail",
    title: input.title,
  };
}

export async function evaluateVersionConsistency(
  repoRoot: string,
): Promise<V07ReleaseReadinessCheck> {
  const startedAt = performance.now();
  const packageJson = JSON.parse(
    await readFile(join(repoRoot, "package.json"), "utf8"),
  ) as PackageJson;
  const packageLock = JSON.parse(
    await readFile(join(repoRoot, "package-lock.json"), "utf8"),
  ) as PackageLock;
  const capability = JSON.parse(
    await readFile(join(repoRoot, ".well-known/goodmemory.json"), "utf8"),
  ) as CapabilityDescriptor;
  const server = JSON.parse(
    await readFile(join(repoRoot, "server.json"), "utf8"),
  ) as ServerDescriptor;
  const installSurfaces = await Promise.all(
    [
      "README.md",
      "README.zh-CN.md",
      "docs/GoodMemory-15-Minute-App-Integration.md",
      "docs/GoodMemory-Standalone-MCP-Setup-Guide.md",
      "llms.txt",
    ].map((path) => readFile(join(repoRoot, path), "utf8")),
  );
  const issues: string[] = [];
  const packageRelease = packageJson.goodmemoryRelease;
  const capabilityRelease = capability.releaseStatus;

  if (packageJson.version !== RELEASE_VERSION) {
    issues.push(`package.json version is ${packageJson.version}, expected ${RELEASE_VERSION}`);
  }
  if (
    packageRelease?.status !== "stable" ||
    packageRelease?.npmDistTag !== "latest" ||
    packageRelease?.installCommandsApplyAfterPublish !== true
  ) {
    issues.push("package.json must describe the immutable stable 0.7 release source");
  }
  if (
    packageLock.version !== RELEASE_VERSION ||
    packageLock.packages?.[""]?.version !== RELEASE_VERSION
  ) {
    issues.push(
      `package-lock.json root versions do not match ${RELEASE_VERSION}`,
    );
  }
  if (
    capability.version !== RELEASE_VERSION ||
    capability.install?.npmGlobal !== `npm install -g goodmemory@${RELEASE_VERSION}` ||
    capability.install.npmPackage !== `npm install goodmemory@${RELEASE_VERSION}` ||
    capability.install.bun !== `bun add goodmemory@${RELEASE_VERSION}`
  ) {
    issues.push(
      `capability descriptor version/install commands do not match ${RELEASE_VERSION}`,
    );
  }
  if (
    capabilityRelease?.status !== packageRelease?.status ||
    capabilityRelease?.npmDistTag !== packageRelease?.npmDistTag ||
    capabilityRelease?.tarball !== `goodmemory-${RELEASE_VERSION}.tgz` ||
    capabilityRelease?.installCommandsApplyAfterPublish !==
      packageRelease?.installCommandsApplyAfterPublish
  ) {
    issues.push("capability descriptor release contract does not match package.json");
  }
  if (
    server.version !== RELEASE_VERSION ||
    server.packages?.length !== 1 ||
    server.packages?.some((entry) => entry.version !== RELEASE_VERSION)
  ) {
    issues.push(`server.json versions do not match ${RELEASE_VERSION}`);
  }
  if (
    installSurfaces.some(
      (surface) => {
        const installedVersions = [
          ...surface.matchAll(/goodmemory@(\d+\.\d+\.\d+)/gu),
        ].map((match) => match[1]);
        return (
          !installedVersions.includes(RELEASE_VERSION) ||
          installedVersions.some((version) => version !== RELEASE_VERSION)
        );
      },
    )
  ) {
    issues.push(
      `install guides do not consistently target ${RELEASE_VERSION}`,
    );
  }

  const benchmarkVersions =
    capability.benchmarks?.currentClaims?.map(
      (claim) => claim.measuredPackageVersion,
    ) ?? [];
  if (
    benchmarkVersions.some((version) => version !== RELEASE_VERSION)
  ) {
    issues.push(
      `current benchmark claims were not measured on ${RELEASE_VERSION}`,
    );
  }

  return {
    detail:
      issues.length === 0
        ? `stable ${RELEASE_VERSION} source metadata is aligned; mutable npm state is not encoded; pre-0.7 benchmark evidence is not labeled current`
        : issues.join("; "),
    durationMs: Math.round(performance.now() - startedAt),
    id: "version",
    required: true,
    status: issues.length === 0 ? "pass" : "fail",
    title: "Version consistency and benchmark provenance",
  };
}

async function evaluatePack(repoRoot: string): Promise<V07ReleaseReadinessCheck> {
  const packDirectory = await mkdtemp(join(tmpdir(), "goodmemory-v07-pack-"));
  const startedAt = performance.now();

  try {
    const outcome = await runCommand(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", packDirectory],
      repoRoot,
    );
    if (outcome.code !== 0) {
      return {
        detail: tail(outcome.stderr || outcome.stdout),
        durationMs: outcome.durationMs,
        id: "pack",
        required: true,
        status: "fail",
        title: "Package manifest and size",
      };
    }

    const parsed = JSON.parse(outcome.stdout) as Array<{
      filename?: string;
      files?: Array<{ path: string }>;
    }>;
    const result = parsed[0];
    const filename = result?.filename;
    if (!filename) {
      throw new Error("npm pack did not report a tarball filename");
    }
    const tarballBytes = (await stat(join(packDirectory, filename))).size;
    const files = (result.files ?? []).map((file) => file.path);
    const issues = evaluateV07PackManifest(files, tarballBytes);

    return {
      detail:
        issues.length === 0
          ? `${files.length} packed files; compressed tarball ${tarballBytes} bytes (< 4 MiB)`
          : issues.join("; "),
      durationMs: Math.round(performance.now() - startedAt),
      id: "pack",
      required: true,
      status: issues.length === 0 ? "pass" : "fail",
      title: "Package manifest and size",
    };
  } finally {
    await rm(packDirectory, { force: true, recursive: true });
  }
}

export function renderV07LanguageConsumerSmoke(): string {
  return `
import {
  createChineseLanguagePack,
  createEnglishLanguagePack,
  createFrenchLanguagePack,
  createJapaneseLanguagePack,
  createKoreanLanguagePack,
  createLanguageService,
  createSpanishLanguagePack,
} from "goodmemory";

const language = createLanguageService({
  defaultLocale: "zh-TW",
  packs: [
    createEnglishLanguagePack(),
    createChineseLanguagePack("Hans"),
    createChineseLanguagePack("Hant"),
    createJapaneseLanguagePack(),
    createKoreanLanguagePack(),
    createFrenchLanguagePack(),
    createSpanishLanguagePack(),
  ],
});
const english = language.resolveFromText({ locale: "en-US", text: "release memory" });
const simplified = language.resolveFromText({ locale: "zh-CN", text: "简体中文记忆" });
const traditional = language.resolveFromText({ locale: "zh-TW", text: "繁體中文記憶" });
const japanese = language.resolveFromText({ locale: "ja-JP", text: "日本語の記憶" });
const korean = language.resolveFromText({ locale: "ko-KR", text: "한국어 기억" });
const french = language.resolveFromText({ locale: "fr-FR", text: "mémoire française" });
const spanish = language.resolveFromText({ locale: "es-ES", text: "memoria española" });
if (english.languagePackId !== "en") throw new Error("English pack unresolved");
if (!language.buildSearchTerms("release memory", english).includes("release")) {
  throw new Error("English search terms unavailable");
}
if (simplified.languagePackId !== "zh-Hans") throw new Error("zh-Hans pack unresolved");
if (!language.buildSearchTerms("简体中文记忆", simplified).includes("简体")) {
  throw new Error("zh-Hans search terms unavailable");
}
if (traditional.languagePackId !== "zh-Hant") throw new Error("zh-Hant pack unresolved");
if (!language.buildSearchTerms("繁體中文記憶", traditional).includes("繁體")) {
  throw new Error("zh-Hant search terms unavailable");
}
if (japanese.languagePackId !== "ja") throw new Error("Japanese pack unresolved");
if (!language.buildSearchTerms("日本語の記憶", japanese).includes("日本語")) {
  throw new Error("Japanese search terms unavailable");
}
if (korean.languagePackId !== "ko") throw new Error("Korean pack unresolved");
if (!language.buildSearchTerms("한국어 기억", korean).includes("한국어")) {
  throw new Error("Korean search terms unavailable");
}
if (french.languagePackId !== "fr") throw new Error("French pack unresolved");
if (!language.buildSearchTerms("mémoire française", french).includes("mémoire")) {
  throw new Error("French search terms unavailable");
}
if (spanish.languagePackId !== "es") throw new Error("Spanish pack unresolved");
if (!language.buildSearchTerms("memoria española", spanish).includes("memoria")) {
  throw new Error("Spanish search terms unavailable");
}
console.log("LANGUAGE_CONSUMER_OK");
`;
}

export async function verifyV07ArtifactConsumers(input: {
  artifactPath?: string;
  repoRoot: string;
}): Promise<V07RuntimeIdentity> {
  const smokeDirectory = await mkdtemp(join(tmpdir(), "goodmemory-v07-consumer-"));

  try {
    let tarballPath = input.artifactPath;
    if (!tarballPath) {
      const packDirectory = join(smokeDirectory, "pack");
      await mkdir(packDirectory, { recursive: true });
      const packed = await runCommand(
        "bun",
        ["pm", "pack", "--destination", packDirectory, "--quiet"],
        input.repoRoot,
      );
      const tarballOutput = packed.stdout
        .trim()
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.endsWith(".tgz"))
        .at(-1);
      if (packed.code !== 0 || !tarballOutput) {
        throw new Error(tail(packed.stderr || packed.stdout));
      }
      tarballPath = tarballOutput.startsWith("/")
        ? tarballOutput
        : join(packDirectory, tarballOutput);
    }
    await writeFile(
      join(smokeDirectory, "package.json"),
      `${JSON.stringify({
        dependencies: { goodmemory: `file:${tarballPath}` },
        private: true,
        type: "module",
      }, null, 2)}\n`,
      "utf8",
    );
    const installed = await runCommand(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      smokeDirectory,
    );
    if (installed.code !== 0) {
      throw new Error(tail(installed.stderr || installed.stdout));
    }
    const smokePath = join(smokeDirectory, "smoke.mjs");
    await writeFile(
      smokePath,
      renderV07LanguageConsumerSmoke(),
      "utf8",
    );

    const runtimes = [
      ["node", [smokePath]],
      ["bun", ["run", smokePath]],
    ] as const;
    const failures: string[] = [];
    for (const [runtime, args] of runtimes) {
      const outcome = await runCommand(runtime, args, smokeDirectory);
      if (outcome.code !== 0 || !outcome.stdout.includes("LANGUAGE_CONSUMER_OK")) {
        failures.push(`${runtime}: ${tail(outcome.stderr || outcome.stdout, 4)}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(failures.join("; "));
    }
    const runtime = await collectV07RuntimeIdentity(input.repoRoot);
    if (runtime.check.status !== "pass") {
      throw new Error(runtime.check.detail);
    }
    return runtime.runtime;
  } finally {
    await rm(smokeDirectory, { force: true, recursive: true });
  }
}

async function evaluateLanguageConsumers(
  repoRoot: string,
): Promise<V07ReleaseReadinessCheck> {
  const startedAt = performance.now();
  try {
    const runtime = await verifyV07ArtifactConsumers({ repoRoot });
    return {
      detail:
        `installed tarball passed all seven public LanguagePack APIs under Node ${runtime.nodeVersion} and Bun ${runtime.bunVersion}`,
      durationMs: Math.round(performance.now() - startedAt),
      id: "language-consumers",
      required: true,
      status: "pass",
      title: "Node and Bun packed LanguagePack consumers",
    };
  } catch (error) {
    return {
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - startedAt),
      id: "language-consumers",
      required: true,
      status: "fail",
      title: "Node and Bun packed LanguagePack consumers",
    };
  }
}

function skippedCheck(id: string, title: string, flag: string): V07ReleaseReadinessCheck {
  return {
    detail: `skipped via ${flag}`,
    durationMs: 0,
    id,
    required: true,
    status: "skip",
    title,
  };
}

export function evaluateV07RequiredEnvironment(input: {
  environment: Readonly<Record<string, string | undefined>>;
  environmentName: string;
  id: string;
  title: string;
}): V07ReleaseReadinessCheck | undefined {
  if (input.environment[input.environmentName]?.trim()) {
    return undefined;
  }
  return {
    detail: `${input.environmentName} is required for the release gate`,
    durationMs: 0,
    id: input.id,
    required: true,
    status: "fail",
    title: input.title,
  };
}

function skippedCommandFlag(
  id: RequiredCommandId,
  options: V07ReleaseReadinessOptions,
): string | undefined {
  if (id === "tests" && options.skipTests) {
    return "--skip-tests";
  }
  if (id === "coverage" && options.skipCoverage) {
    return "--skip-coverage";
  }
  if (id === "build" && options.skipBuild) {
    return "--skip-build";
  }
  return undefined;
}

export async function runV07ReleaseReadiness(
  options: V07ReleaseReadinessOptions = {},
): Promise<V07ReleaseReadinessReport> {
  assertValidV07ReleaseReadinessOptions(options);
  const repoRoot = resolveRepoRootFromScriptUrl(import.meta.url);
  const packageJson = JSON.parse(
    await readFile(join(repoRoot, "package.json"), "utf8"),
  ) as PackageJson;
  const checks: V07ReleaseReadinessCheck[] = [];
  const source = await collectV07SourceIdentity(repoRoot);
  const runtime = await collectV07RuntimeIdentity(repoRoot);

  checks.push(source.check, runtime.check);
  checks.push(await evaluateVersionConsistency(repoRoot));

  for (const command of V07_RELEASE_REQUIRED_COMMANDS) {
    const details = REQUIRED_COMMAND_DETAILS[command.id];
    const skipFlag = skippedCommandFlag(command.id, options);
    if (skipFlag) {
      checks.push(skippedCheck(command.id, details.title, skipFlag));
      continue;
    }
    if (
      "requiredEnvironment" in command
    ) {
      const environmentCheck = evaluateV07RequiredEnvironment({
        environment: process.env,
        environmentName: command.requiredEnvironment,
        id: command.id,
        title: details.title,
      });
      if (environmentCheck) {
        checks.push(environmentCheck);
        continue;
      }
    }

    const outcome = await runCommand(command.command, command.args, repoRoot);
    checks.push(
      commandCheck({
        id: command.id,
        outcome,
        successDetail: details.successDetail,
        title: details.title,
      }),
    );
  }

  checks.push(await evaluatePack(repoRoot));
  checks.push(await evaluateLanguageConsumers(repoRoot));
  const finalSource = await collectV07SourceIdentity(repoRoot);
  checks.push(evaluateV07SourceStability({
    final: finalSource,
    initial: source.sourceIdentity,
  }));

  const passed = checks.filter((check) => check.status === "pass").length;
  const failed = checks.filter((check) => check.status === "fail").length;
  const skipped = checks.filter((check) => check.status === "skip").length;
  const report: V07ReleaseReadinessReport = {
    allRequiredPassed: evaluateV07RequiredChecks(checks),
    checks,
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/run-v0-7-release-readiness.ts",
    packageVersion: packageJson.version,
    runtime: runtime.runtime,
    sourceIdentity: source.sourceIdentity,
    summary: {
      failed,
      passed,
      skipped,
      total: checks.length,
    },
  };
  const outputDir =
    options.outputDir ?? join(repoRoot, "reports", "release", `v${RELEASE_LINE}`);
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, "readiness-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(join(outputDir, "summary.md"), renderV07ReleaseSummary(report));
  return report;
}

export function renderV07ReleaseSummary(
  report: V07ReleaseReadinessReport,
): string {
  const lines = [
    `# v${RELEASE_LINE} Release Readiness`,
    "",
    `- package version: ${report.packageVersion}`,
    `- generated: ${report.generatedAt}`,
    `- source commit: ${report.sourceIdentity.commitSha}`,
    `- source tree: ${report.sourceIdentity.treeSha}`,
    `- runtime: Node ${report.runtime.nodeVersion} / Bun ${report.runtime.bunVersion}`,
    `- result: ${
      report.allRequiredPassed
        ? "ALL REQUIRED CHECKS PASS"
        : "REQUIRED CHECK(S) FAILED"
    } (${report.summary.passed} pass / ${report.summary.failed} fail / ${report.summary.skipped} skip)`,
    "",
    "| Check | Required | Status | Detail |",
    "|---|---|---|---|",
  ];

  for (const check of report.checks) {
    const detail = check.detail
      .replace(/\n/gu, " ")
      .replace(/\|/gu, "\\|")
      .slice(0, 180);
    lines.push(
      `| ${check.title} | ${check.required ? "yes" : "no"} | ${check.status.toUpperCase()} | ${detail} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  const options = parseV07ReleaseReadinessCliOptions(Bun.argv);
  const report = await runV07ReleaseReadiness(options);
  process.stdout.write(renderV07ReleaseSummary(report));
  if (options.strict && !report.allRequiredPassed) {
    process.exitCode = 1;
  }
}
