import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  parseCliPositiveIntegerFlagStrict,
  resolveCliFlagValueStrict,
  resolveCliPathSegmentFlagValueStrict,
} from "./cli-options";
import {
  C5_SUMMARY_API_KEY_ENVIRONMENT_NAME,
} from "./codex-coding-effect/c5-flat-summary-arm";
import {
  C6_GURKIAI_FLAT_SUMMARY_ENDPOINT,
} from "./codex-coding-effect/c6-flat-summary-generation-capture";
import {
  runC5NativeLongitudinalPilot,
} from "./codex-coding-effect/c5-live-pilot";
import type {
  C5ComparatorRuntimeInput,
} from "./codex-coding-effect/c5-live-pilot";
import type {
  C5BaselineArm,
  C5PilotComparatorInput,
} from "./codex-coding-effect/c5-pilot-plan";
import type {
  C5NativeLongitudinalPilotInput,
  C5NativeLongitudinalPilotResult,
} from "./codex-coding-effect/c5-live-pilot";

const VALUE_FLAGS = new Set([
  "--auth-file",
  "--baseline-arm",
  "--baseline-report",
  "--baseline-raw-stage-evidence",
  "--baseline-stage-evidence",
  "--bun-binary",
  "--c4-readiness-core",
  "--c4-readiness-report",
  "--c4-readiness-workspace",
  "--c4-review-dispatch",
  "--c4-review-input-bundle",
  "--c4-review-provenance",
  "--c4-review-request",
  "--c4-review-response",
  "--codex-binary",
  "--codex-model",
  "--dataset-root",
  "--material-effect-pp",
  "--npm-binary",
  "--npm-cache-seed",
  "--npm-registry",
  "--order-seed",
  "--output-dir",
  "--package-tarball",
  "--reasoning-effort",
  "--run-id",
  "--runtime-root",
  "--source-root",
  "--stage-timeout-ms",
  "--summary-endpoint",
  "--summary-model",
  "--summary-prompt",
  "--test-timeout-ms",
  "--workspace-root",
]);
const DEFAULT_SUMMARY_ENDPOINT = C6_GURKIAI_FLAT_SUMMARY_ENDPOINT;
const BOOLEAN_FLAGS = new Set(["--resume"]);
const DEFAULT_DATASET_ROOT =
  "fixtures/codex-coding-effect/c4-controlled-pilot";
const DEFAULT_C4_READINESS_REPORT =
  "reports/quality-gates/phase-73/c4-controlled-pilot-readiness.json";
const DEFAULT_C4_READINESS_CORE =
  "reports/quality-gates/phase-73/c4-controlled-pilot-core.json";
const DEFAULT_BASELINE_REPORT =
  "reports/quality-gates/phase-73/c4-baseline-ceiling-pilot/report.json";
const FIXED_PLATFORM_TEMP_ROOTS = [
  "/tmp",
  "/private/tmp",
  "/var/tmp",
  "/private/var/tmp",
] as const;

export interface C5LivePilotOptionDefaults {
  bunExecutable?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  now?: () => string;
}

// The flat-summary comparator is selected explicitly. Its summarizer model,
// prompt bytes, and endpoint are hashed into the frozen plan; the credential
// comes only from the environment and never from an argument.
export function resolveC5ComparatorOptions(input: {
  argv: readonly string[];
  cwd: string;
  env: Record<string, string | undefined>;
}): {
  baselineArm?: C5BaselineArm;
  comparator?: C5PilotComparatorInput;
  comparatorRuntime?: C5ComparatorRuntimeInput;
} {
  const baselineArmValue = resolveCliFlagValueStrict(input.argv, "--baseline-arm");
  const summaryModel = resolveCliFlagValueStrict(input.argv, "--summary-model");
  const summaryPromptPath = resolveCliFlagValueStrict(input.argv, "--summary-prompt");
  const summaryEndpointValue = resolveCliFlagValueStrict(
    input.argv,
    "--summary-endpoint",
  );
  if (
    baselineArmValue !== undefined &&
    baselineArmValue !== "no-memory" &&
    baselineArmValue !== "flat-summary"
  ) {
    throw new Error("--baseline-arm must be no-memory or flat-summary");
  }
  const baselineArm = baselineArmValue as C5BaselineArm | undefined;
  const summaryFlagsPresent =
    summaryModel !== undefined ||
    summaryPromptPath !== undefined ||
    summaryEndpointValue !== undefined;
  if (baselineArm !== "flat-summary") {
    if (summaryFlagsPresent) {
      throw new Error("summary flags require --baseline-arm flat-summary");
    }
    return baselineArm === undefined ? {} : { baselineArm };
  }
  if (summaryModel === undefined) {
    throw new Error("--summary-model is required for the flat-summary baseline");
  }
  if (summaryPromptPath === undefined) {
    throw new Error("--summary-prompt is required for the flat-summary baseline");
  }
  const apiToken = input.env[C5_SUMMARY_API_KEY_ENVIRONMENT_NAME];
  if (apiToken === undefined || apiToken.trim().length === 0) {
    throw new Error(
      `${C5_SUMMARY_API_KEY_ENVIRONMENT_NAME} is required for the flat-summary baseline`,
    );
  }
  const summaryEndpoint = summaryEndpointValue ?? DEFAULT_SUMMARY_ENDPOINT;
  if (!/^https:\/\//u.test(summaryEndpoint)) {
    throw new Error("--summary-endpoint must be an https URL");
  }
  const summaryPrompt = readFileSync(resolve(input.cwd, summaryPromptPath), "utf8");
  if (summaryPrompt.trim().length === 0) {
    throw new Error("--summary-prompt must point to a non-empty prompt file");
  }
  const summaryPromptSha256 = sha256(summaryPrompt);
  return {
    baselineArm,
    comparator: {
      summaryEndpointSha256: sha256(summaryEndpoint),
      summaryModel,
      summaryPromptSha256,
    },
    comparatorRuntime: {
      apiToken,
      summaryEndpoint,
      summaryModel,
      summaryPrompt,
      summaryPromptSha256,
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function parseC5LivePilotOptions(
  argv: readonly string[],
  defaults: C5LivePilotOptionDefaults = {},
): Omit<C5NativeLongitudinalPilotInput, "dependencies"> {
  assertKnownOptions(argv);
  const cwd = defaults.cwd ?? process.cwd();
  const homeDir = defaults.homeDir ?? homedir();
  const comparatorOptions = resolveC5ComparatorOptions({
    argv,
    cwd,
    env: defaults.env ?? process.env,
  });
  const runId = required(
    resolveCliPathSegmentFlagValueStrict(argv, "--run-id"),
    "--run-id",
  );
  const resume = argv.includes("--resume");
  const packageTarball = resolve(cwd, required(
    resolveCliFlagValueStrict(argv, "--package-tarball"),
    "--package-tarball",
  ));
  if (!packageTarball.endsWith(".tgz")) {
    throw new Error("--package-tarball must point to a .tgz package artifact");
  }
  const npmCacheSeedValue = resolveCliFlagValueStrict(argv, "--npm-cache-seed");
  const npmCacheSeed = npmCacheSeedValue === undefined
    ? undefined
    : resolve(cwd, npmCacheSeedValue);
  // The registry only names where the tarball's dependencies (and a seed
  // cache's keys) come from; dependency content is integrity-checked by npm.
  const npmRegistry = resolveCliFlagValueStrict(argv, "--npm-registry");
  if (npmRegistry !== undefined && !/^https:\/\/[^\s/]+\/?$/u.test(npmRegistry)) {
    throw new Error("--npm-registry must be an https registry origin");
  }
  const materialEffectPercentagePoints = requiredPositiveInteger(
    argv,
    "--material-effect-pp",
  );
  if (materialEffectPercentagePoints > 50) {
    throw new Error("--material-effect-pp must be an integer from 1 to 50");
  }
  const orderSeed = requiredPositiveInteger(argv, "--order-seed");
  const evaluationRoot = join(
    homeDir,
    ".goodmemory-eval",
    "codex-coding-effect",
  );
  const defaultRunRoot = join(evaluationRoot, runId, "c5-pilot");
  const outputDirectory = resolve(
    cwd,
    resolveCliFlagValueStrict(argv, "--output-dir") ??
      join(evaluationRoot, "raw", runId),
  );
  const runtimeRoot = resolve(
    cwd,
    resolveCliFlagValueStrict(argv, "--runtime-root") ??
      join(defaultRunRoot, "runtime"),
  );
  const sourceRoot = resolve(
    cwd,
    resolveCliFlagValueStrict(argv, "--source-root") ??
      join(defaultRunRoot, "source"),
  );
  const workspaceRoot = resolve(
    cwd,
    resolveCliFlagValueStrict(argv, "--workspace-root") ??
      join(defaultRunRoot, "workspaces"),
  );
  const authFile = resolve(
    cwd,
    resolveCliFlagValueStrict(argv, "--auth-file") ??
      join(homeDir, ".codex", "auth.json"),
  );
  const datasetRoot = resolve(
    cwd,
    resolveCliFlagValueStrict(argv, "--dataset-root") ?? DEFAULT_DATASET_ROOT,
  );
  const baselineReportPath = resolve(
    cwd,
    resolveCliFlagValueStrict(argv, "--baseline-report") ??
      DEFAULT_BASELINE_REPORT,
  );
  const baselineRawStageEvidence = resolveCliFlagValueStrict(
    argv,
    "--baseline-raw-stage-evidence",
  );
  const baselineRawStageEvidenceRoot = baselineRawStageEvidence
    ? resolve(cwd, baselineRawStageEvidence)
    : join(dirname(baselineReportPath), "raw-stages");
  const baselineStageEvidenceRoot = resolve(
    cwd,
    resolveCliFlagValueStrict(argv, "--baseline-stage-evidence") ??
      join(dirname(baselineReportPath), "stages"),
  );
  const c4ReadinessCorePath = resolve(
    cwd,
    resolveCliFlagValueStrict(argv, "--c4-readiness-core") ??
      DEFAULT_C4_READINESS_CORE,
  );
  const c4ReadinessReportPath = resolve(
    cwd,
    resolveCliFlagValueStrict(argv, "--c4-readiness-report") ??
      DEFAULT_C4_READINESS_REPORT,
  );
  const c4ReadinessWorkspaceRoot = resolve(
    cwd,
    resolveCliFlagValueStrict(argv, "--c4-readiness-workspace") ??
      join(defaultRunRoot, "c4-readiness"),
  );
  const c4ReviewRoot = join(datasetRoot, "review");
  const c4ReviewDispatchPath = resolve(
    cwd,
    resolveCliFlagValueStrict(argv, "--c4-review-dispatch") ??
      join(c4ReviewRoot, "dispatch.json"),
  );
  const c4ReviewInputBundlePath = resolve(
    cwd,
    resolveCliFlagValueStrict(argv, "--c4-review-input-bundle") ??
      join(c4ReviewRoot, "input-bundle.json"),
  );
  const c4ReviewProvenancePath = resolve(
    cwd,
    resolveCliFlagValueStrict(argv, "--c4-review-provenance") ??
      join(c4ReviewRoot, "provenance.json"),
  );
  const c4ReviewRequestPath = resolve(
    cwd,
    resolveCliFlagValueStrict(argv, "--c4-review-request") ??
      join(c4ReviewRoot, "request.md"),
  );
  const c4ReviewResponsePath = resolve(
    cwd,
    resolveCliFlagValueStrict(argv, "--c4-review-response") ??
      join(c4ReviewRoot, "independent-review.json"),
  );
  const mutableRoots = [
    ["--c4-readiness-workspace", c4ReadinessWorkspaceRoot],
    ["--output-dir", outputDirectory],
    ["--runtime-root", runtimeRoot],
    ["--source-root", sourceRoot],
    ["--workspace-root", workspaceRoot],
  ] as const;
  for (const [flag, path] of [
    ...mutableRoots,
    ["--auth-file", authFile],
    ...(npmCacheSeed === undefined
      ? []
      : [["--npm-cache-seed", npmCacheSeed] as const]),
    ["--package-tarball", packageTarball],
    ["--runner-checkout", resolve(cwd)],
  ] as const) {
    assertOutsideFixedPlatformTempRoots(flag, path);
  }
  for (const [index, [flag, path]] of mutableRoots.entries()) {
    for (const [otherFlag, otherPath] of mutableRoots.slice(index + 1)) {
      assertDisjoint(flag, path, otherFlag, otherPath);
    }
    for (const [protectedFlag, protectedPath] of [
      ["--auth-file", authFile],
      ...(npmCacheSeed === undefined
        ? []
        : [["--npm-cache-seed", npmCacheSeed] as const]),
      ["--package-tarball", packageTarball],
      ["--baseline-report", baselineReportPath],
      ...(baselineRawStageEvidenceRoot
        ? [["--baseline-raw-stage-evidence", baselineRawStageEvidenceRoot] as const]
        : []),
      ["--baseline-stage-evidence", baselineStageEvidenceRoot],
      ["--c4-readiness-core", c4ReadinessCorePath],
      ["--c4-readiness-report", c4ReadinessReportPath],
      ["--c4-review-dispatch", c4ReviewDispatchPath],
      ["--c4-review-input-bundle", c4ReviewInputBundlePath],
      ["--c4-review-provenance", c4ReviewProvenancePath],
      ["--c4-review-request", c4ReviewRequestPath],
      ["--c4-review-response", c4ReviewResponsePath],
      ["--dataset-root", datasetRoot],
      ["--runner-checkout", resolve(cwd)],
    ] as const) {
      assertDisjoint(flag, path, protectedFlag, protectedPath);
    }
  }

  return {
    authFile,
    ...comparatorOptions,
    baselineReportPath,
    ...(baselineRawStageEvidenceRoot ? { baselineRawStageEvidenceRoot } : {}),
    baselineStageEvidenceRoot,
    bunExecutable: resolveExecutable(
      resolveCliFlagValueStrict(argv, "--bun-binary") ??
        defaults.bunExecutable ?? process.execPath,
      cwd,
    ),
    c4ReadinessCorePath,
    c4ReadinessReportPath,
    c4ReadinessWorkspaceRoot,
    c4ReviewDispatchPath,
    c4ReviewInputBundlePath,
    c4ReviewProvenancePath,
    c4ReviewRequestPath,
    c4ReviewResponsePath,
    codexExecutable: resolveExecutable(
      resolveCliFlagValueStrict(argv, "--codex-binary") ?? "codex",
      cwd,
    ),
    datasetRoot,
    generatedAt: (defaults.now ?? (() => new Date().toISOString()))(),
    materialEffectPercentagePoints,
    model: required(
      resolveCliFlagValueStrict(argv, "--codex-model"),
      "--codex-model",
    ),
    ...(npmCacheSeed === undefined ? {} : { npmCacheSeed }),
    ...(npmRegistry === undefined ? {} : { npmRegistry }),
    npmExecutable: resolveExecutable(
      resolveCliFlagValueStrict(argv, "--npm-binary") ?? "npm",
      cwd,
    ),
    orderSeed,
    outputDirectory,
    packageTarball,
    reasoningEffort: required(
      resolveCliFlagValueStrict(argv, "--reasoning-effort"),
      "--reasoning-effort",
    ),
    resume,
    runId,
    runtimeRoot,
    sourceRoot,
    stageTimeoutMs:
      parseCliPositiveIntegerFlagStrict(argv, "--stage-timeout-ms") ?? 900_000,
    testTimeoutMs:
      parseCliPositiveIntegerFlagStrict(argv, "--test-timeout-ms") ?? 300_000,
    workspaceRoot,
  };
}

export function runC5LivePilotCommand(
  argv: readonly string[],
  options?: { defaults?: C5LivePilotOptionDefaults },
): Promise<C5NativeLongitudinalPilotResult>;
export function runC5LivePilotCommand<Result>(
  argv: readonly string[],
  options: {
    defaults?: C5LivePilotOptionDefaults;
    run: (
      input: Omit<C5NativeLongitudinalPilotInput, "dependencies">,
    ) => Promise<Result>;
  },
): Promise<Result>;
export function runC5LivePilotCommand<Result>(
  argv: readonly string[],
  options: {
    defaults?: C5LivePilotOptionDefaults;
    run?: (
      input: Omit<C5NativeLongitudinalPilotInput, "dependencies">,
    ) => Promise<Result>;
  } = {},
): Promise<Result | C5NativeLongitudinalPilotResult> {
  const input = parseC5LivePilotOptions(argv, options.defaults);
  return options.run === undefined
    ? runC5NativeLongitudinalPilot(input)
    : options.run(input);
}

function assertKnownOptions(argv: readonly string[]): void {
  const seenBoolean = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === undefined) return;
    if (BOOLEAN_FLAGS.has(option)) {
      if (seenBoolean.has(option)) {
        throw new Error(`${option} cannot be specified more than once.`);
      }
      seenBoolean.add(option);
      continue;
    }
    if (!VALUE_FLAGS.has(option)) throw new Error(`unknown option ${option}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${option} requires a value.`);
    }
    index += 1;
  }
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined) throw new Error(`${flag} is required`);
  return value;
}

function requiredPositiveInteger(
  argv: readonly string[],
  flag: string,
): number {
  const value = parseCliPositiveIntegerFlagStrict(argv, flag);
  if (value === undefined) throw new Error(`${flag} is required`);
  return value;
}

function resolveExecutable(value: string, cwd: string): string {
  return value.includes("/") || value.includes("\\")
    ? resolve(cwd, value)
    : value;
}

function assertDisjoint(
  firstFlag: string,
  firstPath: string,
  secondFlag: string,
  secondPath: string,
): void {
  const firstCandidates = physicalPathCandidates(firstPath);
  const secondCandidates = physicalPathCandidates(secondPath);
  if (!firstCandidates.some((first) =>
    secondCandidates.some((second) => pathsOverlap(first, second))
  )) return;
  throw new Error(`${firstFlag} must not overlap ${secondFlag}`);
}

function assertOutsideFixedPlatformTempRoots(flag: string, path: string): void {
  const lexicalPath = resolve(path);
  const candidates = physicalPathCandidates(lexicalPath);
  if (candidates.some((candidate) =>
    FIXED_PLATFORM_TEMP_ROOTS.some((root) => pathInsideOrEqual(root, candidate))
  )) {
    throw new Error(`${flag} must not resolve under a fixed temporary root`);
  }
}

function physicalPathCandidates(path: string): string[] {
  const lexicalPath = resolve(path);
  let existingAncestor = lexicalPath;
  const missingSegments: string[] = [];
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) {
      return [lexicalPath];
    }
    missingSegments.unshift(basename(existingAncestor));
    existingAncestor = parent;
  }
  return [...new Set([
    lexicalPath,
    resolve(realpathSync(existingAncestor), ...missingSegments),
  ])];
}

function pathsOverlap(first: string, second: string): boolean {
  return pathInsideOrEqual(first, second) || pathInsideOrEqual(second, first);
}

function pathInsideOrEqual(parent: string, candidate: string): boolean {
  const child = relative(resolve(parent), resolve(candidate));
  return child === "" ||
    (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

if (import.meta.main) {
  try {
    const result = await runC5LivePilotCommand(process.argv.slice(2));
    process.stdout.write(result.reportBytes);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
