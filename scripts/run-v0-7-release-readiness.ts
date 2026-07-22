import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
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
const RELEASE_VERSION = "0.7.0";
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
  summary: {
    failed: number;
    passed: number;
    skipped: number;
    total: number;
  };
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
    args: ["test"],
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
    args: ["run", "gate:phase-74-storage-scale"],
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

interface PackageJson {
  goodmemoryRelease?: {
    installCommandsApplyAfterPublish?: boolean;
    npmLatest?: string;
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
    npmLatest?: string;
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
    ["README.md", "README.zh-CN.md", "llms.txt"].map((path) =>
      readFile(join(repoRoot, path), "utf8"),
    ),
  );
  const issues: string[] = [];
  const packageRelease = packageJson.goodmemoryRelease;
  const capabilityRelease = capability.releaseStatus;

  if (packageJson.version !== RELEASE_VERSION) {
    issues.push(`package.json version is ${packageJson.version}, expected ${RELEASE_VERSION}`);
  }
  if (
    packageRelease?.status !== "release-candidate" ||
    packageRelease?.npmLatest !== "0.6.0" ||
    packageRelease?.installCommandsApplyAfterPublish !== true
  ) {
    issues.push("package.json must describe the checked-out 0.7 release candidate");
  }
  if (
    packageLock.version !== RELEASE_VERSION ||
    packageLock.packages?.[""]?.version !== RELEASE_VERSION
  ) {
    issues.push("package-lock.json root versions do not match 0.7.0");
  }
  if (
    capability.version !== RELEASE_VERSION ||
    capability.install?.npmGlobal !== `npm install -g goodmemory@${RELEASE_VERSION}` ||
    capability.install.npmPackage !== `npm install goodmemory@${RELEASE_VERSION}` ||
    capability.install.bun !== `bun add goodmemory@${RELEASE_VERSION}`
  ) {
    issues.push("capability descriptor version/install commands do not match 0.7.0");
  }
  if (
    capabilityRelease?.status !== packageRelease?.status ||
    capabilityRelease?.npmLatest !== packageRelease?.npmLatest ||
    capabilityRelease?.tarball !== `goodmemory-${RELEASE_VERSION}.tgz` ||
    capabilityRelease?.installCommandsApplyAfterPublish !==
      packageRelease?.installCommandsApplyAfterPublish
  ) {
    issues.push("capability descriptor does not distinguish the 0.7 release candidate from npm latest");
  }
  if (
    server.version !== RELEASE_VERSION ||
    server.packages?.length !== 1 ||
    server.packages?.some((entry) => entry.version !== RELEASE_VERSION)
  ) {
    issues.push("server.json versions do not match 0.7.0");
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
    issues.push("README/llms.txt install commands do not consistently target 0.7.0");
  }

  const benchmarkVersions =
    capability.benchmarks?.currentClaims?.map(
      (claim) => claim.measuredPackageVersion,
    ) ?? [];
  if (
    benchmarkVersions.some((version) => version !== RELEASE_VERSION)
  ) {
    issues.push("current benchmark claims were not measured on 0.7.0");
  }

  return {
    detail:
      issues.length === 0
        ? "0.7.0 release metadata is aligned; pre-0.7 benchmark evidence is not labeled current"
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

async function evaluateLanguageConsumers(
  repoRoot: string,
): Promise<V07ReleaseReadinessCheck> {
  const smokeDirectory = await mkdtemp(join(tmpdir(), "goodmemory-v07-consumer-"));
  const startedAt = performance.now();

  try {
    await mkdir(join(smokeDirectory, "node_modules"), { recursive: true });
    await symlink(repoRoot, join(smokeDirectory, "node_modules", "goodmemory"), "dir");
    const smokePath = join(smokeDirectory, "smoke.mjs");
    await writeFile(
      smokePath,
      `
import {
  createChineseLanguagePack,
  createFrenchLanguagePack,
  createJapaneseLanguagePack,
  createKoreanLanguagePack,
  createLanguageService,
  createSpanishLanguagePack,
} from "goodmemory";

const language = createLanguageService({
  defaultLocale: "zh-TW",
  packs: [
    createChineseLanguagePack("Hant"),
    createJapaneseLanguagePack(),
    createKoreanLanguagePack(),
    createFrenchLanguagePack(),
    createSpanishLanguagePack(),
  ],
});
const traditional = language.resolveFromText({ locale: "zh-TW", text: "繁體中文記憶" });
const japanese = language.resolveFromText({ locale: "ja-JP", text: "日本語の記憶" });
const korean = language.resolveFromText({ locale: "ko-KR", text: "한국어 기억" });
const french = language.resolveFromText({ locale: "fr-FR", text: "mémoire française" });
const spanish = language.resolveFromText({ locale: "es-ES", text: "memoria española" });
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
`,
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

    return {
      detail:
        failures.length === 0
          ? "all seven public LanguagePack APIs passed under Node and Bun"
          : failures.join("; "),
      durationMs: Math.round(performance.now() - startedAt),
      id: "language-consumers",
      required: true,
      status: failures.length === 0 ? "pass" : "fail",
      title: "Node and Bun LanguagePack consumers",
    };
  } finally {
    await rm(smokeDirectory, { force: true, recursive: true });
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

  const passed = checks.filter((check) => check.status === "pass").length;
  const failed = checks.filter((check) => check.status === "fail").length;
  const skipped = checks.filter((check) => check.status === "skip").length;
  const report: V07ReleaseReadinessReport = {
    allRequiredPassed: evaluateV07RequiredChecks(checks),
    checks,
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/run-v0-7-release-readiness.ts",
    packageVersion: packageJson.version,
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
