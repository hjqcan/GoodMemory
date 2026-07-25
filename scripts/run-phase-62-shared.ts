import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  hasCliFlagStrict,
  resolveCliFlagValueStrict,
  resolveCliPathSegmentFlagValueStrict,
  resolveEnvValueStrict,
} from "./cli-options";
import { resolveRepoRootFromScriptUrl } from "./script-paths";
import {
  LONGMEMEVAL_FULL_DATA_FILES,
  LONGMEMEVAL_SMOKE_DATA_FILES,
  normalizeLongMemEvalProfileList,
  type LongMemEvalMode,
  type LongMemEvalProfile,
} from "../src/eval/longmemeval";

export interface Phase62CliOptions {
  allCases?: boolean;
  benchmarkRoot?: string;
  caseIds?: readonly string[];
  // Sweep arm for the generalized-fusion dynamic-budget floor
  // (recall-diagnostic only). Recorded configuration always equals the wired
  // value.
  fusionMinRelativeStrength?: number;
  labelFreeIngest?: boolean;
  limit?: number;
  // R6 second-family arm (recall-diagnostic only): backfill
  // attributes.retrievalCues on every stored fact through the maintenance
  // job after seeding, before recall (record -> prefetch -> replay).
  retrievalCues?: boolean;
  maxConcurrency?: number;
  mode: LongMemEvalMode;
  offset?: number;
  outputDir?: string;
  profiles?: readonly string[];
  questionTypes?: readonly string[];
  resume?: boolean;
  runId?: string;
}

export interface Phase62ReadinessCheck {
  detail: string;
  key: string;
  missing: string[];
  status: "missing" | "ok" | "skipped";
}

export interface Phase62ReadinessReport {
  benchmarkRoot: string;
  checks: Phase62ReadinessCheck[];
  candidateDataFiles: string[];
  missing: string[];
  mode: LongMemEvalMode;
  profiles: LongMemEvalProfile[];
  ready: boolean;
}

export interface Phase62ReadinessDependencies {
  env?: Record<string, string | undefined>;
  fileExists?: (path: string) => boolean;
}

export const PHASE62_LONGMEMEVAL_ROOT_ENV = "GOODMEMORY_LONGMEMEVAL_ROOT";

export function resolvePhase62LongMemEvalRootEnv(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return resolveEnvValueStrict(env, PHASE62_LONGMEMEVAL_ROOT_ENV);
}

export function resolvePhase62FixtureRoot(root: string): string {
  return join(root, "fixtures/external-benchmarks/longmemeval");
}

export function resolvePhase62BenchmarkRoot(
  root: string,
  smoke: boolean,
): string {
  return smoke
    ? resolvePhase62FixtureRoot(root)
    : (resolvePhase62LongMemEvalRootEnv() ?? resolvePhase62FixtureRoot(root));
}

export function resolvePhase62OutputDir(root: string): string {
  return join(root, "reports/eval/research/phase-62/longmemeval");
}

function isNonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function listMissingEnv(
  env: Record<string, string | undefined>,
  required: readonly string[],
): string[] {
  return required.filter((name) => !isNonEmpty(env[name]));
}

export function resolvePhase62DataFileCandidates(input: {
  benchmarkRoot: string;
  mode: LongMemEvalMode;
}): string[] {
  const names =
    input.mode === "smoke"
      ? LONGMEMEVAL_SMOKE_DATA_FILES
      : LONGMEMEVAL_FULL_DATA_FILES;
  return names.map((name) => join(input.benchmarkRoot, name));
}

export function checkPhase62Readiness(
  options: Pick<Phase62CliOptions, "benchmarkRoot" | "mode" | "profiles">,
  dependencies: Phase62ReadinessDependencies = {},
): Phase62ReadinessReport {
  const env = dependencies.env ?? process.env;
  const fileExists = dependencies.fileExists ?? existsSync;
  const benchmarkRoot =
    options.benchmarkRoot ?? resolvePhase62LongMemEvalRootEnv(env);
  if (!benchmarkRoot) {
    throw new Error(
      "Phase 62 readiness check requires --benchmark-root or GOODMEMORY_LONGMEMEVAL_ROOT.",
    );
  }

  const profiles = normalizeLongMemEvalProfileList(options.profiles);
  const candidateDataFiles = resolvePhase62DataFileCandidates({
    benchmarkRoot,
    mode: options.mode,
  });
  const foundDataFile = candidateDataFiles.find(fileExists);
  const checks: Phase62ReadinessCheck[] = [
    {
      detail: foundDataFile
        ? `Found LongMemEval data file: ${foundDataFile}`
        : `Could not find LongMemEval data file. Checked: ${candidateDataFiles.join(", ")}`,
      key: "longmemeval-data-file",
      missing: foundDataFile ? [] : ["LongMemEval data file"],
      status: foundDataFile ? "ok" : "missing",
    },
  ];

  if (options.mode === "smoke") {
    checks.push({
      detail: "Smoke mode uses deterministic fixtures and does not require live model or provider-backed GoodMemory env.",
      key: "live-model-env",
      missing: [],
      status: "skipped",
    });
  } else {
    const liveModelMissing = listMissingEnv(env, [
      "GOODMEMORY_EVAL_PROVIDER",
      "GOODMEMORY_EVAL_MODEL",
      "GOODMEMORY_EVAL_API_KEY",
      "GOODMEMORY_JUDGE_PROVIDER",
      "GOODMEMORY_JUDGE_MODEL",
      "GOODMEMORY_JUDGE_API_KEY",
    ]);
    checks.push({
      detail:
        liveModelMissing.length === 0
          ? "Found live answer-generator and answer-judge env for LongMemEval full mode."
          : `Missing live answer-generator or answer-judge env: ${liveModelMissing.join(", ")}`,
      key: "live-model-env",
      missing: liveModelMissing,
      status: liveModelMissing.length === 0 ? "ok" : "missing",
    });
  }

  if (options.mode === "full" && profiles.includes("goodmemory-hybrid")) {
    const hybridMissing = listMissingEnv(env, [
      "GOODMEMORY_TEST_POSTGRES_URL",
      "GOODMEMORY_EMBEDDING_PROVIDER",
      "GOODMEMORY_EMBEDDING_MODEL",
      "GOODMEMORY_EMBEDDING_API_KEY",
      "GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER",
      "GOODMEMORY_ASSISTED_EXTRACTOR_MODEL",
      "GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY",
    ]);
    checks.push({
      detail:
        hybridMissing.length === 0
          ? "Found provider-backed GoodMemory env for the hybrid profile."
          : `Missing hybrid GoodMemory env: ${hybridMissing.join(", ")}`,
      key: "goodmemory-hybrid-env",
      missing: hybridMissing,
      status: hybridMissing.length === 0 ? "ok" : "missing",
    });
  } else {
    checks.push({
      detail: "Hybrid provider-backed env is only required for full runs that include goodmemory-hybrid.",
      key: "goodmemory-hybrid-env",
      missing: [],
      status: "skipped",
    });
  }

  const missing = checks.flatMap((check) => check.missing);
  return {
    benchmarkRoot,
    candidateDataFiles,
    checks,
    missing,
    mode: options.mode,
    profiles,
    ready: missing.length === 0,
  };
}

export function assertPhase62Readiness(report: Phase62ReadinessReport): void {
  if (report.ready) {
    return;
  }

  const missingChecks = report.checks
    .filter((check) => check.status === "missing")
    .map((check) => `- ${check.key}: ${check.detail}`)
    .join("\n");
  throw new Error(`Phase 62 LongMemEval full-run readiness failed:\n${missingChecks}`);
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--limit must be a positive integer");
  }
  return parsed;
}

function parseOffset(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("--offset must be a non-negative integer");
  }
  return parsed;
}

function parseFusionMinRelativeStrength(
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.trim() !== value || value.length === 0) {
    throw new Error(
      "--fusion-min-relative-strength must be an unpadded number in [0, 1]",
    );
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(
      "--fusion-min-relative-strength must be an unpadded number in [0, 1]",
    );
  }
  return parsed;
}

function parseMode(value: string | undefined): LongMemEvalMode {
  if (!value) {
    return "smoke";
  }
  if (value === "smoke" || value === "full") {
    return value;
  }
  throw new Error("--mode must be smoke or full");
}

function parseRepeatedFlag(
  argv: readonly string[],
  flagName: string,
): string[] | undefined {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flagName) {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${flagName} requires a value`);
      }
      values.push(value);
    }
  }
  return values.length === 0 ? undefined : values;
}

function parseFlagPresence(
  argv: readonly string[],
  flagName: string,
): boolean | undefined {
  return hasCliFlagStrict(argv, flagName) ? true : undefined;
}

export function parsePhase62CliOptions(
  argv: readonly string[],
): Phase62CliOptions {
  return {
    allCases: parseFlagPresence(argv, "--all-cases"),
    benchmarkRoot:
      resolveCliFlagValueStrict(argv, "--benchmark-root") ??
      resolvePhase62LongMemEvalRootEnv(),
    caseIds: parseRepeatedFlag(argv, "--case-id"),
    fusionMinRelativeStrength: parseFusionMinRelativeStrength(
      resolveCliFlagValueStrict(argv, "--fusion-min-relative-strength"),
    ),
    labelFreeIngest: parseFlagPresence(argv, "--label-free-ingest"),
    limit: parseLimit(resolveCliFlagValueStrict(argv, "--limit")),
    maxConcurrency: parseLimit(resolveCliFlagValueStrict(argv, "--max-concurrency")),
    mode: parseMode(resolveCliFlagValueStrict(argv, "--mode")),
    offset: parseOffset(resolveCliFlagValueStrict(argv, "--offset")),
    outputDir: resolveCliFlagValueStrict(argv, "--output-dir"),
    profiles: parseRepeatedFlag(argv, "--profile"),
    questionTypes: parseRepeatedFlag(argv, "--question-type"),
    resume: parseFlagPresence(argv, "--resume"),
    retrievalCues: parseFlagPresence(argv, "--retrieval-cues"),
    runId: resolveCliPathSegmentFlagValueStrict(argv, "--run-id"),
  };
}

export function resolvePhase62RepoRoot(): string {
  return resolveRepoRootFromScriptUrl(import.meta.url);
}
