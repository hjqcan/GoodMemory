import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, relative, resolve } from "node:path";

import {
  hasCliFlagStrict,
  resolveCliFlagValueStrict,
} from "./cli-options";
import { assertOfficialRescoreSummaryValid } from "./rescore-official-protocols";
import {
  buildLocomoSystemPrompt,
  LOCOMO_LIVE_ANSWER_SYSTEM_ID,
} from "./run-phase-65-locomo-smoke";

const BASELINE_COMMIT = "456edd106f29118b3455bf21c43d7b3107b48213";
const REQUIRED_BUN_VERSION = "1.3.14";
const MAX_REGRESSION = 0.01;
const EXPECTED_CASE_IDS = ["locomo-conv-26", "locomo-conv-30"] as const;
const EXPECTED_QUESTION_COUNT = 233;
const EXPECTED_CASE_QUESTION_COUNTS = {
  "locomo-conv-26": 152,
  "locomo-conv-30": 81,
} as const;
const EXPECTED_CATEGORY_QUESTION_COUNTS = {
  single_hop: 114,
  multi_hop: 43,
  temporal: 63,
  open_domain: 13,
} as const;
const EXPECTED_QUESTION_SELECTION_SHA256 =
  "43ed915ce851ba4f1501ed0fd995c29611195f8ff71d2c6af57ae9dc118a5c6c";
const EXPECTED_BENCHMARK_FINGERPRINT =
  "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd";
const EXPECTED_BENCHMARK_ROOT_SHA256 =
  "e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28";
const EXPECTED_BENCHMARK_ROOT_BYTES = 2_490_457;
const EXPECTED_ANSWER_GATEWAY = "https://ai.gurkiai.com/v1";
const EXPECTED_ANSWER_MODEL = "gpt-5.6-terra";
const EXPECTED_EMBEDDING_GATEWAY = "https://openrouter.ai/api/v1";
const EXPECTED_JUDGE_GATEWAY = "https://ai.gurkiai.com/v1";
const EXPECTED_ANSWER_SYSTEM = LOCOMO_LIVE_ANSWER_SYSTEM_ID;
const EXPECTED_SEED_GENERATOR = "scripts/run-phase-65-locomo-smoke.ts";
const EXPECTED_REANSWER_GENERATOR = "scripts/reanswer-phase-65-locomo-report.ts";
const EXPECTED_SCENARIO_COMMAND = "bun test tests/scenarios";
const LIVE_DELTA_ANALYZER_SOURCE_PATH =
  "scripts/analyze-phase-65-locomo-live-delta.ts";
const LIVE_DELTA_RUN_ID = "v0.7.3-lifecycle-paired-final-delta";
const CLAIM_RECIPE_SOURCE_PATH = "benchmark-claims/locomo.json";
const SEED_RUNNER_SOURCE_PATH = "scripts/run-phase-65-locomo-smoke.ts";
const REANSWER_RUNNER_SOURCE_PATH =
  "scripts/reanswer-phase-65-locomo-report.ts";
const OFFICIAL_RUNNER_SOURCE_PATH = "scripts/rescore-official-protocols.ts";
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;

export interface V073ArmExecutionIdentity {
  answerGateway: string;
  answerModel: string;
  answerProvider: string;
  assistedExtractorGateway: string;
  assistedExtractorModel: string;
  assistedExtractorProvider: string;
  answerSystem: string;
  benchmarkFingerprint: string;
  benchmarkRoot: string;
  benchmarkRootSha256: string;
  bunVersion: string;
  caseIds: readonly string[];
  claimCommandTemplateSha256: string;
  claimSourceSha256: string;
  concurrency: number;
  embeddingGateway: string;
  embeddingModel: string;
  embeddingProvider: string;
  freshOutputEvidence: {
    checkpointPath: string;
    checkpointPathAbsentBeforeRun: boolean;
    outputPath: string;
    outputPathAbsentBeforeRun: boolean;
  };
  generatedBy: string;
  judgeGateway: string;
  judgeModel: string;
  judgeProvider: string;
  officialRunId: string;
  officialSourceSha256: string;
  outputPath: string;
  promptSha256: string;
  questionSelectionSha256: string;
  reanswerSourceSha256: string;
  rerankingGateway: string;
  rerankingModel: string;
  rerankingProvider: string;
  resume: boolean;
  runId: string;
  seedGeneratedBy: string;
  seedOutputPath: string;
  seedResume: boolean;
  seedRunId: string;
  seedSourceSha256: string;
  worktreePath: string;
}

export interface V073ProtectionArmManifest {
  commit: string;
  execution: V073ArmExecutionIdentity;
  executionReceiptPath: string;
  executionReceiptSha256: string;
  officialSummaryPath: string;
  reportPath: string;
  seedReportPath: string;
}

export interface V073LifecycleProtectionManifest {
  baseline: V073ProtectionArmManifest;
  candidate: V073ProtectionArmManifest;
  liveDeltaPath: string;
  scenarioReplay: {
    command: string;
    executionReceiptPath: string;
    executionReceiptSha256: string;
    reportPath: string;
    reportSha256: string;
    stderrPath: string;
    stderrSha256: string;
    stdoutPath: string;
    stdoutSha256: string;
  };
  schemaVersion: 1;
}

export interface V073CommandInvocation {
  args: string[];
  command: "bun";
  cwd: string;
  environment: Record<string, string>;
}

export interface V073PairedCommandChain {
  officialRescore: V073CommandInvocation;
  reanswer: V073CommandInvocation;
  seedSmoke: V073CommandInvocation;
}

export interface V073FullClaimPlanInput {
  answerGateway: string;
  answerModel: string;
  answerProvider: string;
  assistedExtractorGateway: string;
  assistedExtractorModel: string;
  assistedExtractorProvider: string;
  benchmarkRoot: string;
  embeddingGateway: string;
  embeddingModel: string;
  embeddingProvider: string;
  finalOutputPath: string;
  finalRunId: string;
  judgeGateway: string;
  judgeModel: string;
  judgeProvider: string;
  officialRunId: string;
  rerankingGateway: string;
  rerankingModel: string;
  rerankingProvider: string;
  seedOutputPath: string;
  seedRunId: string;
  worktreePath: string;
}

interface SmokeCase {
  answerCorrect: boolean | null;
  answerTokenF1: number | null;
  caseId: string;
  category: string;
  evidenceRecall: number;
  executionFailureMessage?: string | null;
  questionId: string;
}

interface QuestionIdentity {
  caseId: string;
  category: string;
  questionId: string;
}

interface SmokeReport {
  answerSystem?: string | null;
  answerEvaluation: string;
  benchmark: string;
  benchmarkFingerprint: string;
  benchmarkSource: string;
  caseIds: string[];
  cases: SmokeCase[];
  concurrency: number;
  executionFailures: number;
  externalRoot: string | null;
  generatedAt: string;
  generatedBy: string;
  mode: string;
  questionCount: number;
  resume: boolean;
  runDirectory: string;
  runId: string;
  sourceReport?: {
    generatedAt: string;
    path: string;
    runId: string;
  };
}

interface OfficialCategory {
  accuracy: number;
  correct: number;
  total: number;
}

interface OfficialSummary {
  benchmark: string;
  categories: Record<string, OfficialCategory>;
  generatedBy: string;
  judgeFailures: number;
  judgeGateway: string;
  judgeModel: string;
  judgeProvider: string;
  judgedCases: number;
  overallAccuracy: number;
  overallCorrect: number;
  outputPath: string;
  runId: string;
  sourceAnswersUnchanged: boolean;
  selectedCases: number;
  sourceCases: number;
  sourceInputFingerprints: {
    reportPath?: { bytes: number; sha256: string };
    rootPath?: { bytes: number; sha256: string };
  };
  sourceInputs: {
    reportPath?: string;
    rootPath?: string;
  };
  totalCases: number;
}

interface ScenarioReplayReport {
  candidateCommit: string;
  command: string;
  executionReceiptPath: string;
  failures: number;
  generatedBy: string;
  passed: number;
  schemaVersion: number;
}

interface ArtifactIdentity {
  bytes: number;
  path: string;
  sha256: string;
}

interface ScenarioExecutionReceipt {
  bunVersion: string;
  candidateCommit: string;
  command: string;
  exitCode: number;
  generatedBy: string;
  schemaVersion: number;
  stderr: ArtifactIdentity;
  stdout: ArtifactIdentity;
  worktreeProvenance: WorktreeProvenance;
}

interface LiveDeltaExecutionReceipt {
  analyzerSource: ArtifactIdentity;
  baselineCommit: string;
  baselineReport: ArtifactIdentity;
  bunVersion: string;
  candidateCommit: string;
  candidateReport: ArtifactIdentity;
  exitCode: number;
  generatedBy: string;
  invocation: V073CommandInvocation;
  report: ArtifactIdentity;
  schemaVersion: number;
  stderr: ArtifactIdentity;
  stdout: ArtifactIdentity;
  worktreeProvenance: WorktreeProvenance;
}

interface ArmExecutionReceipt {
  commandChain: V073PairedCommandChain;
  commit: string;
  execution: V073ArmExecutionIdentity;
  generatedBy: string;
  outputs: {
    finalReport: ArtifactIdentity;
    officialProgress: ArtifactIdentity;
    officialSummary: ArtifactIdentity;
    seedReport: ArtifactIdentity;
  };
  schemaVersion: number;
  worktreeProvenance: WorktreeProvenance;
}

interface WorktreeProvenance {
  headCommit: string;
  statusPorcelain: string;
}

interface ArmSourceBytes {
  claimRecipeRaw: string;
  officialRunnerRaw: string;
  reanswerRunnerRaw: string;
  seedRunnerRaw: string;
}

interface AnswerTransitionCounts {
  baselineOnlyAnswered: number;
  bothUnanswered: number;
  candidateOnlyAnswered: number;
  improved: number;
  regressed: number;
  sameCorrect: number;
  sameWrong: number;
}

interface LiveDelta {
  answerImprovements: unknown[];
  answerRegressions: unknown[];
  baselineReport: { path: string; runId: string };
  candidateReport: { path: string; runId: string };
  generatedBy: string;
  overall: {
    answerTransitions: AnswerTransitionCounts;
    questionCount: number;
  };
}

interface MetricDelta {
  baseline: number;
  candidate: number;
  delta: number;
}

interface RetrievalAndAnswerMetrics {
  evidenceRecall: MetricDelta;
  strictAnswerScore: MetricDelta;
}

interface OverallMetrics extends RetrievalAndAnswerMetrics {
  officialScore: MetricDelta;
}

interface ArmArtifactMap {
  claimRecipeSource: ArtifactIdentity;
  executionReceipt: ArtifactIdentity;
  officialSummary: ArtifactIdentity;
  officialProgress: ArtifactIdentity;
  officialRunnerSource: ArtifactIdentity;
  reanswerRunnerSource: ArtifactIdentity;
  report: ArtifactIdentity;
  seedReport: ArtifactIdentity;
  seedRunnerSource: ArtifactIdentity;
}

export interface V073LifecycleProtectionReport {
  artifacts: {
    baseline: ArmArtifactMap;
    candidate: ArmArtifactMap;
    liveDelta: ArtifactIdentity;
    liveDeltaAnalyzerSource: ArtifactIdentity;
    liveDeltaExecutionReceipt: ArtifactIdentity;
    liveDeltaStderr: ArtifactIdentity;
    liveDeltaStdout: ArtifactIdentity;
    manifest: ArtifactIdentity;
    scenarioExecutionReceipt: ArtifactIdentity;
    scenarioReplay: ArtifactIdentity;
    scenarioStderr: ArtifactIdentity;
    scenarioStdout: ArtifactIdentity;
  };
  baselineCommit: string;
  blockers: string[];
  candidateCommit: string;
  candidatePromptSha256: string;
  claimBoundary: string;
  fullClaimRerunRequired: true;
  generatedAt: string;
  generatedBy: "scripts/run-v0-7-3-lifecycle-protection-gate.ts";
  metrics: {
    categories: Record<string, OverallMetrics>;
    conversations: Record<string, OverallMetrics>;
    overall: OverallMetrics;
  };
  questionTransitions: {
    improved: number;
    regressed: number;
  };
  releaseAllowed: boolean;
  researchRecordRequired: boolean;
  scenarioReplay: V073LifecycleProtectionManifest["scenarioReplay"] & {
    candidateCommit: string;
    failures: number;
    passed: number;
  };
  schemaVersion: 1;
}

export interface V073LifecycleProtectionEvaluationInput {
  baselineExecutionReceipt: ArmExecutionReceipt;
  baselineExecutionReceiptRaw: string;
  baselineOfficial: OfficialSummary;
  baselineOfficialProgressRaw: string;
  baselineOfficialRaw: string;
  baselineReport: SmokeReport;
  baselineReportRaw: string;
  baselineSeedReport: SmokeReport;
  baselineSeedReportRaw: string;
  baselineSources: ArmSourceBytes;
  baselineWorktreeProvenance: WorktreeProvenance;
  candidateExecutionReceipt: ArmExecutionReceipt;
  candidateExecutionReceiptRaw: string;
  candidateOfficial: OfficialSummary;
  candidateOfficialProgressRaw: string;
  candidateOfficialRaw: string;
  candidateReport: SmokeReport;
  candidateReportRaw: string;
  candidateSeedReport: SmokeReport;
  candidateSeedReportRaw: string;
  candidateSources: ArmSourceBytes;
  candidateWorktreeProvenance: WorktreeProvenance;
  liveDelta: LiveDelta;
  liveDeltaAnalyzerSourceRaw: string;
  liveDeltaExecutionReceipt: LiveDeltaExecutionReceipt;
  liveDeltaExecutionReceiptRaw: string;
  liveDeltaRaw: string;
  liveDeltaStderrRaw: string;
  liveDeltaStdoutRaw: string;
  manifest: V073LifecycleProtectionManifest;
  manifestPath: string;
  manifestRaw: string;
  scenarioExecutionReceipt: ScenarioExecutionReceipt;
  scenarioExecutionReceiptRaw: string;
  scenarioReplay: ScenarioReplayReport;
  scenarioReplayRaw: string;
  scenarioStderrRaw: string;
  scenarioStdoutRaw: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deriveV073PromptSha256(): string {
  const prompts = ([
    "single_hop",
    "multi_hop",
    "temporal",
    "open_domain",
  ] as const).map((questionCategory) => ({
    prompt: buildLocomoSystemPrompt({ questionCategory }),
    questionCategory,
  }));
  return sha256(JSON.stringify(prompts));
}

function claimCommand(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("claim recipe source bytes must contain valid JSON");
  }
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.run) ||
    typeof parsed.run.command !== "string" ||
    parsed.run.command.trim().length === 0
  ) {
    throw new Error("claim recipe must contain run.command");
  }
  return parsed.run.command;
}

export function deriveV073ClaimCommandTemplateSha256(raw: string): string {
  return sha256(claimCommand(raw));
}

interface ParsedClaimInvocation {
  args: string[];
  environment: Record<string, string>;
}

function parseClaimInvocation(segment: string): ParsedClaimInvocation {
  const tokens = segment.trim().split(/\s+/u);
  const environment: Record<string, string> = {};
  while (tokens[0]?.includes("=") === true && tokens[0] !== "bun") {
    const assignment = tokens.shift()!;
    const separator = assignment.indexOf("=");
    environment[assignment.slice(0, separator)] = assignment.slice(separator + 1);
  }
  if (tokens.shift() !== "bun" || tokens.length === 0) {
    throw new Error("claim recipe command segments must invoke bun");
  }
  return { args: tokens, environment };
}

function parsedClaimCommands(raw: string): {
  officialRescore: ParsedClaimInvocation;
  reanswer: ParsedClaimInvocation;
  seedSmoke: ParsedClaimInvocation;
} {
  const segments = claimCommand(raw)
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(parseClaimInvocation);
  const find = (script: string): ParsedClaimInvocation | undefined =>
    segments.find(
      ({ args }) => args[0] === "run" && args[1] === script,
    );
  const seedSmoke = find(EXPECTED_SEED_GENERATOR);
  const reanswer = find(EXPECTED_REANSWER_GENERATOR);
  const officialRescore = find("eval:official-rescore");
  if (!seedSmoke || !reanswer || !officialRescore) {
    throw new Error(
      "claim recipe must contain seed, reanswer, and official-rescore commands",
    );
  }
  return { officialRescore, reanswer, seedSmoke };
}

function flagValue(args: readonly string[], flag: string): string {
  const indexes = args.flatMap((value, index) => (value === flag ? [index] : []));
  if (indexes.length !== 1 || args[indexes[0]! + 1] === undefined) {
    throw new Error(`claim recipe must contain exactly one ${flag} value`);
  }
  return args[indexes[0]! + 1]!;
}

function replaceFlagValue(
  args: readonly string[],
  flag: string,
  value: string,
): string[] {
  const updated = [...args];
  const index = updated.indexOf(flag);
  flagValue(updated, flag);
  updated[index + 1] = value;
  return updated;
}

function assertClaimEnvironment(
  invocation: ParsedClaimInvocation,
  name: string,
  expected: string,
): void {
  if (invocation.environment[name] !== expected) {
    throw new Error(`claim recipe ${name} must equal ${expected}`);
  }
}

function providerEnvironment(
  prefix: string,
  input: { gateway: string; model: string; provider: string },
): Record<string, string> {
  return {
    [`${prefix}_BASE_URL`]: input.gateway,
    [`${prefix}_MODEL`]: input.model,
    [`${prefix}_PROVIDER`]: input.provider,
  };
}

export function buildV073PairedCommandChain(
  arm: V073ProtectionArmManifest,
  claimRecipeRaw: string,
): V073PairedCommandChain {
  const execution = arm.execution;
  const recipe = parsedClaimCommands(claimRecipeRaw);
  assertClaimEnvironment(
    recipe.seedSmoke,
    "GOODMEMORY_EVAL_MODEL",
    execution.answerModel,
  );
  assertClaimEnvironment(
    recipe.reanswer,
    "GOODMEMORY_EVAL_MODEL",
    execution.answerModel,
  );
  assertClaimEnvironment(
    recipe.officialRescore,
    "GOODMEMORY_JUDGE_MODEL",
    execution.judgeModel,
  );
  const recipeRoot = flagValue(recipe.seedSmoke.args, "--benchmark-root");
  const resolvedRecipeRoot = recipeRoot.startsWith("~/")
    ? resolve(homedir(), recipeRoot.slice(2))
    : resolve(recipeRoot);
  if (resolvedRecipeRoot !== resolve(execution.benchmarkRoot)) {
    throw new Error("claim recipe benchmark root must match the protected root");
  }
  const answerEnvironment = providerEnvironment("GOODMEMORY_EVAL", {
    gateway: execution.answerGateway,
    model: execution.answerModel,
    provider: execution.answerProvider,
  });
  let seedArgs = replaceFlagValue(
    recipe.seedSmoke.args,
    "--benchmark-root",
    execution.benchmarkRoot,
  );
  seedArgs = replaceFlagValue(
    seedArgs,
    "--output-dir",
    dirname(execution.seedOutputPath),
  );
  seedArgs = replaceFlagValue(seedArgs, "--run-id", execution.seedRunId);
  seedArgs = replaceFlagValue(
    seedArgs,
    "--concurrency",
    String(execution.concurrency),
  );
  if (seedArgs.includes("--case-id")) {
    throw new Error("claim recipe seed command must not preselect case ids");
  }
  const outputDirIndex = seedArgs.indexOf("--output-dir");
  seedArgs.splice(
    outputDirIndex,
    0,
    "--case-id",
    EXPECTED_CASE_IDS[0],
    "--case-id",
    EXPECTED_CASE_IDS[1],
  );
  let reanswerArgs = replaceFlagValue(
    recipe.reanswer.args,
    "--source-report",
    arm.seedReportPath,
  );
  reanswerArgs = replaceFlagValue(
    reanswerArgs,
    "--output-dir",
    dirname(execution.outputPath),
  );
  reanswerArgs = replaceFlagValue(reanswerArgs, "--run-id", execution.runId);
  reanswerArgs = replaceFlagValue(
    reanswerArgs,
    "--concurrency",
    String(execution.concurrency),
  );
  let officialArgs = replaceFlagValue(
    recipe.officialRescore.args,
    "--report",
    arm.reportPath,
  );
  officialArgs = replaceFlagValue(
    officialArgs,
    "--root",
    resolve(execution.benchmarkRoot, "cases.json"),
  );
  officialArgs = replaceFlagValue(
    officialArgs,
    "--run-id",
    execution.officialRunId,
  );
  officialArgs = replaceFlagValue(
    officialArgs,
    "--concurrency",
    String(execution.concurrency),
  );
  return {
    seedSmoke: {
      args: seedArgs,
      command: "bun",
      cwd: execution.worktreePath,
      environment: {
        ...recipe.seedSmoke.environment,
        ...answerEnvironment,
        ...providerEnvironment("GOODMEMORY_ASSISTED_EXTRACTOR", {
          gateway: execution.assistedExtractorGateway,
          model: execution.assistedExtractorModel,
          provider: execution.assistedExtractorProvider,
        }),
        ...providerEnvironment("GOODMEMORY_EMBEDDING", {
          gateway: execution.embeddingGateway,
          model: execution.embeddingModel,
          provider: execution.embeddingProvider,
        }),
        ...providerEnvironment("GOODMEMORY_RERANKING", {
          gateway: execution.rerankingGateway,
          model: execution.rerankingModel,
          provider: execution.rerankingProvider,
        }),
      },
    },
    reanswer: {
      args: reanswerArgs,
      command: "bun",
      cwd: execution.worktreePath,
      environment: { ...recipe.reanswer.environment, ...answerEnvironment },
    },
    officialRescore: {
      args: officialArgs,
      command: "bun",
      cwd: execution.worktreePath,
      environment: {
        ...recipe.officialRescore.environment,
        ...providerEnvironment("GOODMEMORY_JUDGE", {
          gateway: execution.judgeGateway,
          model: execution.judgeModel,
          provider: execution.judgeProvider,
        }),
      },
    },
  };
}

export function buildV073FullClaimCommandChain(
  input: V073FullClaimPlanInput,
  claimRecipeRaw: string,
): V073PairedCommandChain {
  const recipe = parsedClaimCommands(claimRecipeRaw);
  const recipeRoot = flagValue(recipe.seedSmoke.args, "--benchmark-root");
  const resolvedRecipeRoot = recipeRoot.startsWith("~/")
    ? resolve(homedir(), recipeRoot.slice(2))
    : resolve(recipeRoot);
  if (resolvedRecipeRoot !== resolve(input.benchmarkRoot)) {
    throw new Error("claim recipe benchmark root must match the full-claim root");
  }
  let seedArgs = replaceFlagValue(
    recipe.seedSmoke.args,
    "--benchmark-root",
    input.benchmarkRoot,
  );
  seedArgs = replaceFlagValue(
    seedArgs,
    "--output-dir",
    dirname(input.seedOutputPath),
  );
  seedArgs = replaceFlagValue(seedArgs, "--run-id", input.seedRunId);
  if (seedArgs.includes("--case-id") || seedArgs.includes("--question-id")) {
    throw new Error("full-claim seed command must not contain a partial selection");
  }
  let reanswerArgs = replaceFlagValue(
    recipe.reanswer.args,
    "--source-report",
    resolve(input.seedOutputPath, "smoke-report.json"),
  );
  reanswerArgs = replaceFlagValue(
    reanswerArgs,
    "--output-dir",
    dirname(input.finalOutputPath),
  );
  reanswerArgs = replaceFlagValue(reanswerArgs, "--run-id", input.finalRunId);
  let officialArgs = replaceFlagValue(
    recipe.officialRescore.args,
    "--report",
    resolve(input.finalOutputPath, "smoke-report.json"),
  );
  officialArgs = replaceFlagValue(
    officialArgs,
    "--root",
    resolve(input.benchmarkRoot, "cases.json"),
  );
  officialArgs = replaceFlagValue(
    officialArgs,
    "--run-id",
    input.officialRunId,
  );
  const answerEnvironment = providerEnvironment("GOODMEMORY_EVAL", {
    gateway: input.answerGateway,
    model: input.answerModel,
    provider: input.answerProvider,
  });
  return {
    seedSmoke: {
      args: seedArgs,
      command: "bun",
      cwd: input.worktreePath,
      environment: {
        ...recipe.seedSmoke.environment,
        ...answerEnvironment,
        ...providerEnvironment("GOODMEMORY_ASSISTED_EXTRACTOR", {
          gateway: input.assistedExtractorGateway,
          model: input.assistedExtractorModel,
          provider: input.assistedExtractorProvider,
        }),
        ...providerEnvironment("GOODMEMORY_EMBEDDING", {
          gateway: input.embeddingGateway,
          model: input.embeddingModel,
          provider: input.embeddingProvider,
        }),
        ...providerEnvironment("GOODMEMORY_RERANKING", {
          gateway: input.rerankingGateway,
          model: input.rerankingModel,
          provider: input.rerankingProvider,
        }),
      },
    },
    reanswer: {
      args: reanswerArgs,
      command: "bun",
      cwd: input.worktreePath,
      environment: { ...recipe.reanswer.environment, ...answerEnvironment },
    },
    officialRescore: {
      args: officialArgs,
      command: "bun",
      cwd: input.worktreePath,
      environment: {
        ...recipe.officialRescore.environment,
        ...providerEnvironment("GOODMEMORY_JUDGE", {
          gateway: input.judgeGateway,
          model: input.judgeModel,
          provider: input.judgeProvider,
        }),
      },
    },
  };
}

function artifactIdentity(path: string, raw: string): ArtifactIdentity {
  return { bytes: byteLength(raw), path, sha256: sha256(raw) };
}

function liveDeltaCapturePaths(reportPath: string): {
  executionReceiptPath: string;
  stderrPath: string;
  stdoutPath: string;
} {
  const directory = dirname(resolve(reportPath));
  return {
    executionReceiptPath: resolve(directory, "live-delta-execution-receipt.json"),
    stderrPath: resolve(directory, "live-delta-stderr.log"),
    stdoutPath: resolve(directory, "live-delta-stdout.log"),
  };
}

function expectedLiveDeltaInvocation(
  manifest: V073LifecycleProtectionManifest,
): V073CommandInvocation {
  return {
    args: [
      "run",
      LIVE_DELTA_ANALYZER_SOURCE_PATH,
      "--",
      "--baseline-report",
      manifest.baseline.reportPath,
      "--candidate-report",
      manifest.candidate.reportPath,
      "--output-path",
      manifest.liveDeltaPath,
      "--run-id",
      LIVE_DELTA_RUN_ID,
    ],
    command: "bun",
    cwd: manifest.candidate.execution.worktreePath,
    environment: {},
  };
}

function assertRawJsonMatches(value: unknown, raw: string, label: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${label} bytes must contain valid JSON`);
  }
  if (!sameJson(parsed, value)) {
    throw new Error(`${label} value does not match its source bytes`);
  }
}

function assertUnitInterval(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a number in [0, 1]`);
  }
}

function questionIdentity(rows: readonly SmokeCase[]): QuestionIdentity[] {
  return rows.map(({ caseId, category, questionId }) => ({
    caseId,
    category,
    questionId,
  }));
}

function questionSelectionSha256(rows: readonly SmokeCase[]): string {
  return sha256(JSON.stringify(questionIdentity(rows)));
}

function assertArmExecutionIdentity(
  arm: V073ProtectionArmManifest,
  label: string,
): void {
  if (!COMMIT_PATTERN.test(arm.commit)) {
    throw new Error(`${label} commit must be a full 40-character SHA`);
  }
  const execution = arm.execution;
  if (execution.bunVersion !== REQUIRED_BUN_VERSION) {
    throw new Error(`${label} must use Bun ${REQUIRED_BUN_VERSION}`);
  }
  if (execution.concurrency !== 40) {
    throw new Error(`${label} must preserve claim concurrency 40`);
  }
  if (!sameJson(execution.caseIds, EXPECTED_CASE_IDS)) {
    throw new Error(`${label} must select LoCoMo conversations 26 and 30`);
  }
  if (execution.answerGateway !== EXPECTED_ANSWER_GATEWAY) {
    throw new Error(`${label} answerGateway must match the frozen claim gateway`);
  }
  if (execution.answerModel !== EXPECTED_ANSWER_MODEL) {
    throw new Error(`${label} answerModel must match the frozen claim model`);
  }
  if (execution.answerProvider !== "openai") {
    throw new Error(`${label} answerProvider must be openai`);
  }
  if (
    execution.assistedExtractorGateway !== EXPECTED_ANSWER_GATEWAY ||
    execution.assistedExtractorModel !== EXPECTED_ANSWER_MODEL ||
    execution.assistedExtractorProvider !== "openai"
  ) {
    throw new Error(`${label} assisted extractor must match the frozen Gurki Terra identity`);
  }
  if (execution.embeddingGateway !== EXPECTED_EMBEDDING_GATEWAY) {
    throw new Error(`${label} embeddingGateway must match the frozen OpenRouter gateway`);
  }
  if (
    execution.embeddingModel !== "text-embedding-3-small" ||
    execution.embeddingProvider !== "openai"
  ) {
    throw new Error(`${label} embedding must match the frozen text-embedding-3-small identity`);
  }
  if (
    execution.rerankingGateway !== EXPECTED_ANSWER_GATEWAY ||
    execution.rerankingModel !== EXPECTED_ANSWER_MODEL ||
    execution.rerankingProvider !== "openai"
  ) {
    throw new Error(`${label} reranking must match the frozen Gurki Terra identity`);
  }
  if (execution.judgeGateway !== EXPECTED_JUDGE_GATEWAY) {
    throw new Error(`${label} judgeGateway must match the frozen Gurki gateway`);
  }
  if (
    execution.judgeModel !== "gpt-5.5" ||
    execution.judgeProvider !== "openai"
  ) {
    throw new Error(`${label} judge must match the frozen independent gpt-5.5 identity`);
  }
  if (execution.answerSystem !== EXPECTED_ANSWER_SYSTEM) {
    throw new Error(`${label} answerSystem must match the default reanswer profile`);
  }
  if (execution.benchmarkFingerprint !== EXPECTED_BENCHMARK_FINGERPRINT) {
    throw new Error(`${label} benchmarkFingerprint must match the frozen LoCoMo selection`);
  }
  if (execution.benchmarkRootSha256 !== EXPECTED_BENCHMARK_ROOT_SHA256) {
    throw new Error(`${label} benchmarkRootSha256 must match the frozen LoCoMo root bytes`);
  }
  if (execution.promptSha256 !== deriveV073PromptSha256()) {
    throw new Error(`${label} promptSha256 must match the derived default prompt`);
  }
  if (execution.generatedBy !== EXPECTED_REANSWER_GENERATOR || execution.resume) {
    throw new Error(`${label} final execution must be a fresh reanswer run`);
  }
  if (
    execution.seedGeneratedBy !== EXPECTED_SEED_GENERATOR ||
    execution.seedResume !== true
  ) {
    throw new Error(`${label} seed execution must preserve the claim smoke --resume run`);
  }
  if (
    execution.freshOutputEvidence.outputPathAbsentBeforeRun !== true ||
    execution.freshOutputEvidence.checkpointPathAbsentBeforeRun !== true
  ) {
    throw new Error("both arms must prove fresh seed output and checkpoint paths");
  }
  if (
    resolve(execution.freshOutputEvidence.outputPath) !==
      resolve(execution.seedOutputPath) ||
    resolve(execution.freshOutputEvidence.checkpointPath) !==
      resolve(execution.seedOutputPath, "live-progress.jsonl")
  ) {
    throw new Error(`${label} fresh-output receipt paths are inconsistent`);
  }
  if (
    resolve(execution.seedOutputPath) !==
      resolve(dirname(execution.seedOutputPath), execution.seedRunId) ||
    resolve(execution.outputPath) !==
      resolve(dirname(execution.outputPath), execution.runId)
  ) {
    throw new Error(`${label} output paths must be derived from their runIds`);
  }
  if (
    resolve(arm.seedReportPath) !==
      resolve(execution.seedOutputPath, "smoke-report.json") ||
    resolve(arm.reportPath) !== resolve(execution.outputPath, "smoke-report.json")
  ) {
    throw new Error(`${label} seed and final report paths must match their outputs`);
  }
  if (
    resolve(arm.officialSummaryPath) !==
      resolve(
        execution.worktreePath,
        "reports/eval/research/official-rescore",
        execution.officialRunId,
        "rescore-summary.json",
      )
  ) {
    throw new Error(`${label} official summary path must match its runId`);
  }
  if (execution.questionSelectionSha256 !== EXPECTED_QUESTION_SELECTION_SHA256) {
    throw new Error(
      `${label} questionSelectionSha256 must match the frozen conv-26/30 selection`,
    );
  }
  for (const [field, value] of Object.entries({
    claimSourceSha256: execution.claimSourceSha256,
    officialSourceSha256: execution.officialSourceSha256,
    reanswerSourceSha256: execution.reanswerSourceSha256,
    seedSourceSha256: execution.seedSourceSha256,
  })) {
    if (!SHA256_PATTERN.test(value)) {
      throw new Error(`${label} ${field} must be a SHA-256 fingerprint`);
    }
  }
}

function comparableExecutionIdentity(execution: V073ArmExecutionIdentity): unknown {
  return {
    answerGateway: execution.answerGateway,
    answerModel: execution.answerModel,
    answerProvider: execution.answerProvider,
    answerSystem: execution.answerSystem,
    assistedExtractorGateway: execution.assistedExtractorGateway,
    assistedExtractorModel: execution.assistedExtractorModel,
    assistedExtractorProvider: execution.assistedExtractorProvider,
    benchmarkFingerprint: execution.benchmarkFingerprint,
    benchmarkRoot: resolve(execution.benchmarkRoot),
    benchmarkRootSha256: execution.benchmarkRootSha256,
    bunVersion: execution.bunVersion,
    caseIds: execution.caseIds,
    claimCommandTemplateSha256: execution.claimCommandTemplateSha256,
    claimSourceSha256: execution.claimSourceSha256,
    concurrency: execution.concurrency,
    embeddingGateway: execution.embeddingGateway,
    embeddingModel: execution.embeddingModel,
    embeddingProvider: execution.embeddingProvider,
    generatedBy: execution.generatedBy,
    judgeGateway: execution.judgeGateway,
    judgeModel: execution.judgeModel,
    judgeProvider: execution.judgeProvider,
    officialSourceSha256: execution.officialSourceSha256,
    promptSha256: execution.promptSha256,
    questionSelectionSha256: execution.questionSelectionSha256,
    reanswerSourceSha256: execution.reanswerSourceSha256,
    rerankingGateway: execution.rerankingGateway,
    rerankingModel: execution.rerankingModel,
    rerankingProvider: execution.rerankingProvider,
    resume: execution.resume,
    seedGeneratedBy: execution.seedGeneratedBy,
    seedResume: execution.seedResume,
    seedSourceSha256: execution.seedSourceSha256,
  };
}

function assertManifest(manifest: V073LifecycleProtectionManifest): void {
  if (manifest.schemaVersion !== 1) {
    throw new Error("lifecycle protection manifest schemaVersion must be 1");
  }
  assertArmExecutionIdentity(manifest.baseline, "baseline");
  assertArmExecutionIdentity(manifest.candidate, "candidate");
  if (manifest.baseline.commit !== BASELINE_COMMIT) {
    throw new Error(`baseline commit must be ${BASELINE_COMMIT}`);
  }
  if (manifest.candidate.commit === manifest.baseline.commit) {
    throw new Error("candidate commit must differ from the v0.7.2 baseline");
  }
  if (
    !sameJson(
      comparableExecutionIdentity(manifest.baseline.execution),
      comparableExecutionIdentity(manifest.candidate.execution),
    )
  ) {
    throw new Error("baseline and candidate execution identities must match");
  }
  const runIds = [
    manifest.baseline.execution.seedRunId,
    manifest.baseline.execution.runId,
    manifest.baseline.execution.officialRunId,
    manifest.candidate.execution.seedRunId,
    manifest.candidate.execution.runId,
    manifest.candidate.execution.officialRunId,
  ];
  if (new Set(runIds).size !== runIds.length) {
    throw new Error("seed, final, and official runIds must all be unique");
  }
  for (const [field, baseline, candidate] of [
    ["seedReportPath", manifest.baseline.seedReportPath, manifest.candidate.seedReportPath],
    ["reportPath", manifest.baseline.reportPath, manifest.candidate.reportPath],
    [
      "executionReceiptPath",
      manifest.baseline.executionReceiptPath,
      manifest.candidate.executionReceiptPath,
    ],
    [
      "officialSummaryPath",
      manifest.baseline.officialSummaryPath,
      manifest.candidate.officialSummaryPath,
    ],
    [
      "worktreePath",
      manifest.baseline.execution.worktreePath,
      manifest.candidate.execution.worktreePath,
    ],
  ] as const) {
    if (resolve(baseline) === resolve(candidate)) {
      throw new Error(`baseline and candidate ${field} must differ`);
    }
  }
  if (
    !SHA256_PATTERN.test(manifest.baseline.executionReceiptSha256) ||
    !SHA256_PATTERN.test(manifest.candidate.executionReceiptSha256)
  ) {
    throw new Error("execution receipt fingerprints must be SHA-256 values");
  }
  if (manifest.scenarioReplay.command !== EXPECTED_SCENARIO_COMMAND) {
    throw new Error("scenario replay command must match the preregistered command");
  }
  for (const [field, value] of Object.entries({
    executionReceiptSha256: manifest.scenarioReplay.executionReceiptSha256,
    reportSha256: manifest.scenarioReplay.reportSha256,
    stderrSha256: manifest.scenarioReplay.stderrSha256,
    stdoutSha256: manifest.scenarioReplay.stdoutSha256,
  })) {
    if (!SHA256_PATTERN.test(value)) {
      throw new Error(`scenario replay ${field} must be a SHA-256 fingerprint`);
    }
  }
}

function assertArmSources(input: {
  arm: V073ProtectionArmManifest;
  label: string;
  sources: ArmSourceBytes;
}): void {
  const execution = input.arm.execution;
  if (sha256(input.sources.seedRunnerRaw) !== execution.seedSourceSha256) {
    throw new Error(`${input.label} seed runner source fingerprint is invalid`);
  }
  if (sha256(input.sources.reanswerRunnerRaw) !== execution.reanswerSourceSha256) {
    throw new Error(`${input.label} reanswer runner source fingerprint is invalid`);
  }
  if (sha256(input.sources.officialRunnerRaw) !== execution.officialSourceSha256) {
    throw new Error(`${input.label} official runner source fingerprint is invalid`);
  }
  if (sha256(input.sources.claimRecipeRaw) !== execution.claimSourceSha256) {
    throw new Error(`${input.label} claim recipe source fingerprint is invalid`);
  }
  if (
    deriveV073ClaimCommandTemplateSha256(input.sources.claimRecipeRaw) !==
      execution.claimCommandTemplateSha256
  ) {
    throw new Error(`${input.label} claim command fingerprint is invalid`);
  }
  if (execution.promptSha256 !== deriveV073PromptSha256()) {
    throw new Error(`${input.label} promptSha256 must match the derived default prompt`);
  }
}

function assertExecutionReceipt(input: {
  arm: V073ProtectionArmManifest;
  claimRecipeRaw: string;
  label: string;
  liveWorktreeProvenance: WorktreeProvenance;
  officialProgressRaw: string;
  officialRaw: string;
  raw: string;
  reportRaw: string;
  receipt: ArmExecutionReceipt;
  seedReportRaw: string;
}): void {
  assertRawJsonMatches(input.receipt, input.raw, `${input.label} execution receipt`);
  if (sha256(input.raw) !== input.arm.executionReceiptSha256) {
    throw new Error(`${input.label} execution receipt fingerprint is invalid`);
  }
  if (
    input.receipt.schemaVersion !== 1 ||
    input.receipt.generatedBy !== "v0.7.3-lifecycle-paired-arm-launch" ||
    input.receipt.commit !== input.arm.commit ||
    !sameJson(input.receipt.execution, input.arm.execution)
  ) {
    throw new Error(`${input.label} execution receipt does not match its arm`);
  }
  const expectedOutputs = {
    finalReport: artifactIdentity(input.arm.reportPath, input.reportRaw),
    officialProgress: artifactIdentity(
      resolve(dirname(input.arm.officialSummaryPath), "progress.jsonl"),
      input.officialProgressRaw,
    ),
    officialSummary: artifactIdentity(input.arm.officialSummaryPath, input.officialRaw),
    seedReport: artifactIdentity(input.arm.seedReportPath, input.seedReportRaw),
  };
  if (!sameJson(input.receipt.outputs, expectedOutputs)) {
    throw new Error(`${input.label} execution receipt output fingerprints are invalid`);
  }
  if (
    input.liveWorktreeProvenance.headCommit !== input.arm.commit
  ) {
    throw new Error(
      `${input.label} live worktree HEAD must match its manifest commit`,
    );
  }
  if (input.liveWorktreeProvenance.statusPorcelain !== "") {
    throw new Error(`${input.label} worktree must be clean`);
  }
  if (
    !sameJson(
      input.receipt.worktreeProvenance,
      input.liveWorktreeProvenance,
    )
  ) {
    throw new Error(`${input.label} execution receipt worktree provenance is stale`);
  }
  if (
    !sameJson(
      input.receipt.commandChain,
      buildV073PairedCommandChain(input.arm, input.claimRecipeRaw),
    )
  ) {
    throw new Error(
      `${input.label} command chain does not match the current claim recipe`,
    );
  }
}

function assertReportPopulation(report: SmokeReport, label: string): void {
  if (report.benchmark !== "locomo") {
    throw new Error(`${label} must be a LoCoMo report`);
  }
  if (report.generatedAt.trim().length === 0) {
    throw new Error(`${label} generatedAt is required`);
  }
  if (report.executionFailures !== 0) {
    throw new Error(`${label} must be complete with zero execution failures`);
  }
  if (
    report.questionCount !== EXPECTED_QUESTION_COUNT ||
    report.cases.length !== EXPECTED_QUESTION_COUNT
  ) {
    throw new Error(`${label} must contain exactly ${EXPECTED_QUESTION_COUNT} protected questions`);
  }
  if (!sameJson(report.caseIds, EXPECTED_CASE_IDS)) {
    throw new Error(`${label} caseIds drifted from the protected conversations`);
  }
  for (const row of report.cases) {
    assertUnitInterval(row.evidenceRecall, `${label} ${row.questionId} evidenceRecall`);
    if (row.answerTokenF1 !== null) {
      assertUnitInterval(row.answerTokenF1, `${label} ${row.questionId} answerTokenF1`);
    }
    if (row.executionFailureMessage) {
      throw new Error(`${label} contains a per-question execution failure`);
    }
  }
  for (const [caseId, expectedCount] of Object.entries(
    EXPECTED_CASE_QUESTION_COUNTS,
  )) {
    const actualCount = report.cases.filter((row) => row.caseId === caseId).length;
    if (actualCount !== expectedCount) {
      throw new Error(`${label} case ${caseId} must contain exactly ${expectedCount} questions`);
    }
  }
  for (const [category, expectedCount] of Object.entries(
    EXPECTED_CATEGORY_QUESTION_COUNTS,
  )) {
    const actualCount = report.cases.filter((row) => row.category === category).length;
    if (actualCount !== expectedCount) {
      throw new Error(`${label} category ${category} must contain exactly ${expectedCount} questions`);
    }
  }
  if (questionSelectionSha256(report.cases) !== EXPECTED_QUESTION_SELECTION_SHA256) {
    throw new Error(`${label} question selection does not match the frozen conv-26/30 root`);
  }
}

function assertCommonReportMetadata(input: {
  arm: V073ProtectionArmManifest;
  label: string;
  report: SmokeReport;
}): void {
  const { execution } = input.arm;
  const checks = [
    ["benchmarkFingerprint", input.report.benchmarkFingerprint, execution.benchmarkFingerprint],
    [
      "benchmarkSource",
      resolve(input.report.benchmarkSource),
      resolve(execution.benchmarkRoot, "cases.json"),
    ],
    ["concurrency", input.report.concurrency, execution.concurrency],
    [
      "externalRoot",
      resolve(input.report.externalRoot ?? ""),
      resolve(execution.benchmarkRoot),
    ],
  ] as const;
  for (const [field, actual, expected] of checks) {
    if (actual !== expected) {
      throw new Error(`${input.label} ${field} must match its execution identity`);
    }
  }
}

function assertSeedReport(
  report: SmokeReport,
  arm: V073ProtectionArmManifest,
  label: string,
): void {
  assertReportPopulation(report, label);
  assertCommonReportMetadata({ arm, label, report });
  const execution = arm.execution;
  if (
    report.mode !== "retrieval-only" ||
    report.answerEvaluation !== "deferred-to-live-mode" ||
    report.answerSystem != null ||
    report.cases.some(
      (row) => row.answerCorrect !== null || row.answerTokenF1 !== null,
    ) ||
    report.generatedBy !== execution.seedGeneratedBy ||
    report.resume !== execution.seedResume ||
    report.runId !== execution.seedRunId ||
    resolve(report.runDirectory) !== resolve(execution.seedOutputPath) ||
    resolve(arm.seedReportPath) !==
      resolve(execution.seedOutputPath, "smoke-report.json")
  ) {
    throw new Error(`${label} must match its seed execution identity`);
  }
}

function assertFinalReport(
  report: SmokeReport,
  seed: SmokeReport,
  arm: V073ProtectionArmManifest,
  label: string,
): void {
  assertReportPopulation(report, label);
  assertCommonReportMetadata({ arm, label, report });
  const execution = arm.execution;
  if (
    report.mode !== "live-answer" ||
    report.answerEvaluation !== "scored" ||
    report.cases.some((row) => row.answerTokenF1 === null) ||
    report.generatedBy !== execution.generatedBy ||
    report.resume !== execution.resume ||
    report.runId !== execution.runId ||
    resolve(report.runDirectory) !== resolve(execution.outputPath) ||
    resolve(arm.reportPath) !== resolve(execution.outputPath, "smoke-report.json")
  ) {
    throw new Error(`${label} must match its final reanswer execution identity`);
  }
  if (report.answerSystem !== execution.answerSystem) {
    throw new Error(`${label} answerSystem must match the default reanswer profile`);
  }
  if (
    report.sourceReport === undefined ||
    resolve(report.sourceReport.path) !== resolve(arm.seedReportPath) ||
    report.sourceReport.runId !== seed.runId ||
    report.sourceReport.generatedAt !== seed.generatedAt
  ) {
    throw new Error(`${label} sourceReport must match its seed report`);
  }
  if (!sameJson(questionIdentity(seed.cases), questionIdentity(report.cases))) {
    throw new Error(`${label.replace(" final report", "")} seed and final questions differ`);
  }
  const seedEvidence = seed.cases.map((row) => row.evidenceRecall);
  const finalEvidence = report.cases.map((row) => row.evidenceRecall);
  if (!sameJson(seedEvidence, finalEvidence)) {
    throw new Error(`${label.replace(" final report", "")} seed and final retrieval evidence differ`);
  }
}

function assertMatchedReports(input: V073LifecycleProtectionEvaluationInput): void {
  assertSeedReport(
    input.baselineSeedReport,
    input.manifest.baseline,
    "baseline seed report",
  );
  assertFinalReport(
    input.baselineReport,
    input.baselineSeedReport,
    input.manifest.baseline,
    "baseline final report",
  );
  assertSeedReport(
    input.candidateSeedReport,
    input.manifest.candidate,
    "candidate seed report",
  );
  assertFinalReport(
    input.candidateReport,
    input.candidateSeedReport,
    input.manifest.candidate,
    "candidate final report",
  );
  if (
    !sameJson(
      questionIdentity(input.baselineReport.cases),
      questionIdentity(input.candidateReport.cases),
    )
  ) {
    throw new Error("baseline and candidate question order or population drifted");
  }
}

function assertOfficialSummary(
  summary: OfficialSummary,
  arm: V073ProtectionArmManifest,
  reportRaw: string,
  questionCount: number,
  label: string,
): void {
  if (
    summary.benchmark !== "locomo" ||
    summary.judgeModel !== "gpt-5.5" ||
    summary.judgeModel === arm.execution.answerModel
  ) {
    throw new Error(`${label} must use independent gpt-5.5 judging`);
  }
  if (
    summary.judgeGateway !== arm.execution.judgeGateway ||
    summary.judgeModel !== arm.execution.judgeModel ||
    summary.judgeProvider !== arm.execution.judgeProvider
  ) {
    throw new Error(`${label} judge provider identity must match its execution`);
  }
  assertOfficialRescoreSummaryValid(summary);
  if (
    summary.runId !== arm.execution.officialRunId ||
    summary.judgeFailures !== 0 ||
    summary.sourceCases !== questionCount ||
    summary.selectedCases !== questionCount ||
    summary.judgedCases !== questionCount ||
    summary.totalCases !== questionCount
  ) {
    throw new Error(`${label} must judge every protected final answer with zero failures`);
  }
  if (resolve(summary.outputPath) !== resolve(arm.officialSummaryPath)) {
    throw new Error(`${label} outputPath must match the manifest`);
  }
  if (
    summary.sourceInputs.reportPath === undefined ||
    resolve(summary.sourceInputs.reportPath) !== resolve(arm.reportPath)
  ) {
    throw new Error(`${label} sourceInputs.reportPath must match the final report`);
  }
  const reportFingerprint = summary.sourceInputFingerprints.reportPath;
  if (
    reportFingerprint === undefined ||
    reportFingerprint.bytes !== byteLength(reportRaw) ||
    reportFingerprint.sha256 !== sha256(reportRaw)
  ) {
    throw new Error(`${label} report fingerprint does not match final report bytes`);
  }
  const rootPath = resolve(arm.execution.benchmarkRoot, "cases.json");
  if (
    summary.sourceInputs.rootPath === undefined ||
    resolve(summary.sourceInputs.rootPath) !== rootPath ||
    summary.sourceInputFingerprints.rootPath?.bytes !== EXPECTED_BENCHMARK_ROOT_BYTES ||
    summary.sourceInputFingerprints.rootPath?.sha256 !== EXPECTED_BENCHMARK_ROOT_SHA256
  ) {
    throw new Error(`${label} root input must match the frozen LoCoMo bytes`);
  }
  assertUnitInterval(summary.overallAccuracy, `${label} overallAccuracy`);
  const expectedCategories = Object.keys(EXPECTED_CATEGORY_QUESTION_COUNTS);
  if (
    Object.keys(summary.categories).length !== expectedCategories.length ||
    expectedCategories.some((category) => !summary.categories[category])
  ) {
    throw new Error(`${label} must contain exactly the four claim categories`);
  }
  let categoryCorrectTotal = 0;
  for (const [category, expectedTotal] of Object.entries(
    EXPECTED_CATEGORY_QUESTION_COUNTS,
  )) {
    const result = summary.categories[category]!;
    if (
      result.total !== expectedTotal ||
      !Number.isSafeInteger(result.correct) ||
      result.correct < 0 ||
      result.correct > result.total
    ) {
      throw new Error(`${label} category ${category} must account for ${expectedTotal} questions`);
    }
    assertUnitInterval(result.accuracy, `${label} ${category} accuracy`);
    if (Math.abs(result.accuracy - result.correct / result.total) > 1e-12) {
      throw new Error(`${label} category ${category} accuracy is inconsistent`);
    }
    categoryCorrectTotal += result.correct;
  }
  if (
    summary.overallCorrect !== categoryCorrectTotal ||
    Math.abs(summary.overallAccuracy - summary.overallCorrect / questionCount) >
      1e-12
  ) {
    throw new Error(`${label} overall accuracy is inconsistent`);
  }
}

function officialProgressByConversation(input: {
  label: string;
  progressRaw: string;
  report: SmokeReport;
  summary: OfficialSummary;
}): Record<string, number> {
  const rows = input.progressRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const value = JSON.parse(line) as unknown;
      if (
        !isRecord(value) ||
        typeof value.questionId !== "string" ||
        typeof value.correct !== "boolean"
      ) {
        throw new Error(`${input.label} official progress row ${index + 1} is invalid`);
      }
      return { correct: value.correct, questionId: value.questionId };
    });
  const answerByQuestion = new Map(
    rows.map((row) => [row.questionId, row.correct] as const),
  );
  if (
    rows.length !== input.report.questionCount ||
    answerByQuestion.size !== input.report.questionCount ||
    input.report.cases.some((row) => !answerByQuestion.has(row.questionId))
  ) {
    throw new Error(`${input.label} official progress does not cover the final question population`);
  }
  const score = (selected: readonly SmokeCase[]): number =>
    selected.filter((row) => answerByQuestion.get(row.questionId) === true).length /
    selected.length;
  if (score(input.report.cases) !== input.summary.overallAccuracy) {
    throw new Error(`${input.label} official progress disagrees with overall summary`);
  }
  for (const [category, result] of Object.entries(input.summary.categories)) {
    if (score(input.report.cases.filter((row) => row.category === category)) !== result.accuracy) {
      throw new Error(`${input.label} official progress disagrees with category ${category}`);
    }
  }
  return Object.fromEntries(
    input.report.caseIds.map((caseId) => [
      caseId,
      score(input.report.cases.filter((row) => row.caseId === caseId)),
    ]),
  );
}

function assertScenarioReplay(input: V073LifecycleProtectionEvaluationInput): void {
  const manifest = input.manifest.scenarioReplay;
  const report = input.scenarioReplay;
  const receipt = input.scenarioExecutionReceipt;
  if (manifest.reportSha256 !== sha256(input.scenarioReplayRaw)) {
    throw new Error("scenario replay report fingerprint does not match its bytes");
  }
  if (
    manifest.executionReceiptSha256 !==
      sha256(input.scenarioExecutionReceiptRaw)
  ) {
    throw new Error("scenario execution receipt fingerprint does not match its bytes");
  }
  if (
    report.schemaVersion !== 1 ||
    report.generatedBy !== "v0.7.3-scenario-process-capture" ||
    report.candidateCommit !== input.manifest.candidate.commit ||
    report.command !== EXPECTED_SCENARIO_COMMAND ||
    resolve(report.executionReceiptPath) !== resolve(manifest.executionReceiptPath)
  ) {
    throw new Error("scenario replay report identity is invalid");
  }
  if (receipt.exitCode !== 0) {
    throw new Error("scenario replay process must exit successfully");
  }
  if (
    receipt.schemaVersion !== 1 ||
    receipt.generatedBy !== "v0.7.3-scenario-process-capture" ||
    receipt.command !== EXPECTED_SCENARIO_COMMAND ||
    receipt.bunVersion !== REQUIRED_BUN_VERSION
  ) {
    throw new Error("scenario replay process identity is invalid");
  }
  if (receipt.candidateCommit !== input.manifest.candidate.commit) {
    throw new Error("scenario replay receipt candidate commit must match");
  }
  if (
    !sameJson(
      receipt.worktreeProvenance,
      input.candidateWorktreeProvenance,
    )
  ) {
    throw new Error("scenario replay receipt worktree provenance is stale");
  }
  const stdout = artifactIdentity(manifest.stdoutPath, input.scenarioStdoutRaw);
  const stderr = artifactIdentity(manifest.stderrPath, input.scenarioStderrRaw);
  if (
    manifest.stdoutSha256 !== stdout.sha256 ||
    !sameJson(receipt.stdout, stdout)
  ) {
    throw new Error("scenario stdout fingerprint does not match captured bytes");
  }
  if (
    manifest.stderrSha256 !== stderr.sha256 ||
    !sameJson(receipt.stderr, stderr)
  ) {
    throw new Error("scenario stderr fingerprint does not match captured bytes");
  }
  const output = `${input.scenarioStdoutRaw}\n${input.scenarioStderrRaw}`;
  const passMatch = output.match(/\b(\d+)\s+pass\b/u);
  const failMatch = output.match(/\b(\d+)\s+fail\b/u);
  if (
    passMatch === null ||
    failMatch === null ||
    Number(passMatch[1]) !== report.passed ||
    Number(failMatch[1]) !== report.failures ||
    report.failures !== 0 ||
    report.passed < 1
  ) {
    throw new Error("scenario replay counts do not match captured process output");
  }
}

function assertAnswerTransitions(
  transitions: AnswerTransitionCounts,
  questionCount: number,
): void {
  const counts = Object.values(transitions);
  if (
    counts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
    counts.reduce((sum, count) => sum + count, 0) !== questionCount
  ) {
    throw new Error("live-delta answerTransitions must account for every question");
  }
}

function assertLiveDeltaCapture(
  input: V073LifecycleProtectionEvaluationInput,
): void {
  const receipt = input.liveDeltaExecutionReceipt;
  const paths = liveDeltaCapturePaths(input.manifest.liveDeltaPath);
  if (
    receipt.schemaVersion !== 1 ||
    receipt.generatedBy !== "v0.7.3-live-delta-process-capture" ||
    receipt.exitCode !== 0 ||
    receipt.bunVersion !== REQUIRED_BUN_VERSION ||
    receipt.baselineCommit !== input.manifest.baseline.commit ||
    receipt.candidateCommit !== input.manifest.candidate.commit ||
    !sameJson(receipt.invocation, expectedLiveDeltaInvocation(input.manifest)) ||
    !sameJson(receipt.worktreeProvenance, input.candidateWorktreeProvenance)
  ) {
    throw new Error("live-delta process receipt identity is invalid");
  }
  const expected = {
    analyzerSource: artifactIdentity(
      resolve(
        input.manifest.candidate.execution.worktreePath,
        LIVE_DELTA_ANALYZER_SOURCE_PATH,
      ),
      input.liveDeltaAnalyzerSourceRaw,
    ),
    baselineReport: artifactIdentity(
      input.manifest.baseline.reportPath,
      input.baselineReportRaw,
    ),
    candidateReport: artifactIdentity(
      input.manifest.candidate.reportPath,
      input.candidateReportRaw,
    ),
    report: artifactIdentity(input.manifest.liveDeltaPath, input.liveDeltaRaw),
    stderr: artifactIdentity(paths.stderrPath, input.liveDeltaStderrRaw),
    stdout: artifactIdentity(paths.stdoutPath, input.liveDeltaStdoutRaw),
  };
  for (const [name, identity] of Object.entries(expected)) {
    if (!sameJson(receipt[name as keyof typeof expected], identity)) {
      throw new Error(`live-delta ${name} fingerprint does not match captured bytes`);
    }
  }
  if (resolve(paths.executionReceiptPath) === resolve(input.manifest.liveDeltaPath)) {
    throw new Error("live-delta execution receipt must be separate from its report");
  }
}

function recomputeAnswerTransitions(
  baselineRows: readonly SmokeCase[],
  candidateRows: readonly SmokeCase[],
): AnswerTransitionCounts {
  const transitions: AnswerTransitionCounts = {
    baselineOnlyAnswered: 0,
    bothUnanswered: 0,
    candidateOnlyAnswered: 0,
    improved: 0,
    regressed: 0,
    sameCorrect: 0,
    sameWrong: 0,
  };
  for (const [index, baseline] of baselineRows.entries()) {
    const candidate = candidateRows[index]!;
    const baselineCorrect = baseline.answerCorrect;
    const candidateCorrect = candidate.answerCorrect;
    if (
      (baselineCorrect !== null && typeof baselineCorrect !== "boolean") ||
      (candidateCorrect !== null && typeof candidateCorrect !== "boolean")
    ) {
      throw new Error("final report rows must contain answerCorrect boolean or null");
    }
    if (baselineCorrect === null && candidateCorrect === null) {
      transitions.bothUnanswered += 1;
    } else if (baselineCorrect === null) {
      transitions.candidateOnlyAnswered += 1;
    } else if (candidateCorrect === null) {
      transitions.baselineOnlyAnswered += 1;
    } else if (!baselineCorrect && candidateCorrect) {
      transitions.improved += 1;
    } else if (baselineCorrect && !candidateCorrect) {
      transitions.regressed += 1;
    } else if (baselineCorrect) {
      transitions.sameCorrect += 1;
    } else {
      transitions.sameWrong += 1;
    }
  }
  return transitions;
}

function metricDelta(baseline: number, candidate: number): MetricDelta {
  return { baseline, candidate, delta: candidate - baseline };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rowsFor(
  report: SmokeReport,
  field: "caseId" | "category",
  value: string,
): SmokeCase[] {
  return report.cases.filter((row) => row[field] === value);
}

function retrievalAndAnswerMetrics(
  baselineRows: readonly SmokeCase[],
  candidateRows: readonly SmokeCase[],
): RetrievalAndAnswerMetrics {
  return {
    evidenceRecall: metricDelta(
      mean(baselineRows.map((row) => row.evidenceRecall)),
      mean(candidateRows.map((row) => row.evidenceRecall)),
    ),
    strictAnswerScore: metricDelta(
      mean(baselineRows.map((row) => row.answerTokenF1!)),
      mean(candidateRows.map((row) => row.answerTokenF1!)),
    ),
  };
}

function officialCategoryMetric(
  baseline: OfficialSummary,
  candidate: OfficialSummary,
  category: string,
): MetricDelta {
  const baselineCategory = baseline.categories[category];
  const candidateCategory = candidate.categories[category];
  if (!baselineCategory || !candidateCategory) {
    throw new Error(`official summaries are missing category ${category}`);
  }
  return metricDelta(baselineCategory.accuracy, candidateCategory.accuracy);
}

function metricEntries(report: V073LifecycleProtectionReport): Array<{
  label: string;
  metric: MetricDelta;
}> {
  const entries = [
    { label: "overall evidenceRecall", metric: report.metrics.overall.evidenceRecall },
    {
      label: "overall strictAnswerScore",
      metric: report.metrics.overall.strictAnswerScore,
    },
    { label: "overall officialScore", metric: report.metrics.overall.officialScore },
  ];
  for (const [category, metrics] of Object.entries(report.metrics.categories)) {
    entries.push(
      { label: `category ${category} evidenceRecall`, metric: metrics.evidenceRecall },
      {
        label: `category ${category} strictAnswerScore`,
        metric: metrics.strictAnswerScore,
      },
      { label: `category ${category} officialScore`, metric: metrics.officialScore },
    );
  }
  for (const [conversation, metrics] of Object.entries(
    report.metrics.conversations,
  )) {
    entries.push(
      {
        label: `conversation ${conversation} evidenceRecall`,
        metric: metrics.evidenceRecall,
      },
      {
        label: `conversation ${conversation} strictAnswerScore`,
        metric: metrics.strictAnswerScore,
      },
      {
        label: `conversation ${conversation} officialScore`,
        metric: metrics.officialScore,
      },
    );
  }
  return entries;
}

function armArtifactMap(input: {
  arm: V073ProtectionArmManifest;
  executionReceiptRaw: string;
  officialProgressRaw: string;
  officialRaw: string;
  reportRaw: string;
  seedReportRaw: string;
  sources: ArmSourceBytes;
}): ArmArtifactMap {
  return {
    claimRecipeSource: artifactIdentity(
      resolve(input.arm.execution.worktreePath, CLAIM_RECIPE_SOURCE_PATH),
      input.sources.claimRecipeRaw,
    ),
    executionReceipt: artifactIdentity(
      input.arm.executionReceiptPath,
      input.executionReceiptRaw,
    ),
    officialSummary: artifactIdentity(
      input.arm.officialSummaryPath,
      input.officialRaw,
    ),
    officialProgress: artifactIdentity(
      resolve(dirname(input.arm.officialSummaryPath), "progress.jsonl"),
      input.officialProgressRaw,
    ),
    officialRunnerSource: artifactIdentity(
      resolve(input.arm.execution.worktreePath, OFFICIAL_RUNNER_SOURCE_PATH),
      input.sources.officialRunnerRaw,
    ),
    reanswerRunnerSource: artifactIdentity(
      resolve(input.arm.execution.worktreePath, REANSWER_RUNNER_SOURCE_PATH),
      input.sources.reanswerRunnerRaw,
    ),
    report: artifactIdentity(input.arm.reportPath, input.reportRaw),
    seedReport: artifactIdentity(input.arm.seedReportPath, input.seedReportRaw),
    seedRunnerSource: artifactIdentity(
      resolve(input.arm.execution.worktreePath, SEED_RUNNER_SOURCE_PATH),
      input.sources.seedRunnerRaw,
    ),
  };
}

export function evaluateV073LifecycleProtection(
  input: V073LifecycleProtectionEvaluationInput,
): V073LifecycleProtectionReport {
  assertRawJsonMatches(input.manifest, input.manifestRaw, "protection manifest");
  assertRawJsonMatches(
    input.baselineExecutionReceipt,
    input.baselineExecutionReceiptRaw,
    "baseline execution receipt",
  );
  assertRawJsonMatches(
    input.candidateExecutionReceipt,
    input.candidateExecutionReceiptRaw,
    "candidate execution receipt",
  );
  assertRawJsonMatches(
    input.baselineSeedReport,
    input.baselineSeedReportRaw,
    "baseline seed report",
  );
  assertRawJsonMatches(input.baselineReport, input.baselineReportRaw, "baseline final report");
  assertRawJsonMatches(
    input.candidateSeedReport,
    input.candidateSeedReportRaw,
    "candidate seed report",
  );
  assertRawJsonMatches(input.candidateReport, input.candidateReportRaw, "candidate final report");
  assertRawJsonMatches(input.baselineOfficial, input.baselineOfficialRaw, "baseline official summary");
  assertRawJsonMatches(input.candidateOfficial, input.candidateOfficialRaw, "candidate official summary");
  assertRawJsonMatches(input.liveDelta, input.liveDeltaRaw, "live-delta report");
  assertRawJsonMatches(
    input.liveDeltaExecutionReceipt,
    input.liveDeltaExecutionReceiptRaw,
    "live-delta execution receipt",
  );
  assertRawJsonMatches(input.scenarioReplay, input.scenarioReplayRaw, "scenario replay report");
  assertRawJsonMatches(
    input.scenarioExecutionReceipt,
    input.scenarioExecutionReceiptRaw,
    "scenario execution receipt",
  );

  assertManifest(input.manifest);
  assertArmSources({
    arm: input.manifest.baseline,
    label: "baseline",
    sources: input.baselineSources,
  });
  assertArmSources({
    arm: input.manifest.candidate,
    label: "candidate",
    sources: input.candidateSources,
  });
  assertExecutionReceipt({
    arm: input.manifest.baseline,
    claimRecipeRaw: input.baselineSources.claimRecipeRaw,
    label: "baseline",
    liveWorktreeProvenance: input.baselineWorktreeProvenance,
    officialProgressRaw: input.baselineOfficialProgressRaw,
    officialRaw: input.baselineOfficialRaw,
    raw: input.baselineExecutionReceiptRaw,
    reportRaw: input.baselineReportRaw,
    receipt: input.baselineExecutionReceipt,
    seedReportRaw: input.baselineSeedReportRaw,
  });
  assertExecutionReceipt({
    arm: input.manifest.candidate,
    claimRecipeRaw: input.candidateSources.claimRecipeRaw,
    label: "candidate",
    liveWorktreeProvenance: input.candidateWorktreeProvenance,
    officialProgressRaw: input.candidateOfficialProgressRaw,
    officialRaw: input.candidateOfficialRaw,
    raw: input.candidateExecutionReceiptRaw,
    reportRaw: input.candidateReportRaw,
    receipt: input.candidateExecutionReceipt,
    seedReportRaw: input.candidateSeedReportRaw,
  });
  assertMatchedReports(input);
  assertOfficialSummary(
    input.baselineOfficial,
    input.manifest.baseline,
    input.baselineReportRaw,
    input.baselineReport.questionCount,
    "baseline official summary",
  );
  assertOfficialSummary(
    input.candidateOfficial,
    input.manifest.candidate,
    input.candidateReportRaw,
    input.candidateReport.questionCount,
    "candidate official summary",
  );
  const baselineOfficialByConversation = officialProgressByConversation({
    label: "baseline",
    progressRaw: input.baselineOfficialProgressRaw,
    report: input.baselineReport,
    summary: input.baselineOfficial,
  });
  const candidateOfficialByConversation = officialProgressByConversation({
    label: "candidate",
    progressRaw: input.candidateOfficialProgressRaw,
    report: input.candidateReport,
    summary: input.candidateOfficial,
  });
  assertScenarioReplay(input);
  assertLiveDeltaCapture(input);
  if (
    input.liveDelta.generatedBy !== "scripts/analyze-phase-65-locomo-live-delta.ts" ||
    resolve(input.liveDelta.baselineReport.path) !==
      resolve(input.manifest.baseline.reportPath) ||
    resolve(input.liveDelta.candidateReport.path) !==
      resolve(input.manifest.candidate.reportPath) ||
    input.liveDelta.baselineReport.runId !== input.baselineReport.runId ||
    input.liveDelta.candidateReport.runId !== input.candidateReport.runId ||
    input.liveDelta.overall.questionCount !== input.baselineReport.questionCount
  ) {
    throw new Error("live-delta analysis does not match the final reanswered reports");
  }
  assertAnswerTransitions(
    input.liveDelta.overall.answerTransitions,
    input.liveDelta.overall.questionCount,
  );
  if (
    !sameJson(
      input.liveDelta.overall.answerTransitions,
      recomputeAnswerTransitions(
        input.baselineReport.cases,
        input.candidateReport.cases,
      ),
    )
  ) {
    throw new Error(
      "live-delta answerTransitions do not match the final report rows",
    );
  }

  const categories = [
    ...new Set(input.baselineReport.cases.map((row) => row.category)),
  ];
  const conversations = [
    ...new Set(input.baselineReport.cases.map((row) => row.caseId)),
  ];
  const report: V073LifecycleProtectionReport = {
    artifacts: {
      baseline: armArtifactMap({
        arm: input.manifest.baseline,
        executionReceiptRaw: input.baselineExecutionReceiptRaw,
        officialProgressRaw: input.baselineOfficialProgressRaw,
        officialRaw: input.baselineOfficialRaw,
        reportRaw: input.baselineReportRaw,
        seedReportRaw: input.baselineSeedReportRaw,
        sources: input.baselineSources,
      }),
      candidate: armArtifactMap({
        arm: input.manifest.candidate,
        executionReceiptRaw: input.candidateExecutionReceiptRaw,
        officialProgressRaw: input.candidateOfficialProgressRaw,
        officialRaw: input.candidateOfficialRaw,
        reportRaw: input.candidateReportRaw,
        seedReportRaw: input.candidateSeedReportRaw,
        sources: input.candidateSources,
      }),
      liveDelta: artifactIdentity(input.manifest.liveDeltaPath, input.liveDeltaRaw),
      liveDeltaAnalyzerSource: artifactIdentity(
        resolve(
          input.manifest.candidate.execution.worktreePath,
          LIVE_DELTA_ANALYZER_SOURCE_PATH,
        ),
        input.liveDeltaAnalyzerSourceRaw,
      ),
      liveDeltaExecutionReceipt: artifactIdentity(
        liveDeltaCapturePaths(input.manifest.liveDeltaPath).executionReceiptPath,
        input.liveDeltaExecutionReceiptRaw,
      ),
      liveDeltaStderr: artifactIdentity(
        liveDeltaCapturePaths(input.manifest.liveDeltaPath).stderrPath,
        input.liveDeltaStderrRaw,
      ),
      liveDeltaStdout: artifactIdentity(
        liveDeltaCapturePaths(input.manifest.liveDeltaPath).stdoutPath,
        input.liveDeltaStdoutRaw,
      ),
      manifest: artifactIdentity(input.manifestPath, input.manifestRaw),
      scenarioExecutionReceipt: artifactIdentity(
        input.manifest.scenarioReplay.executionReceiptPath,
        input.scenarioExecutionReceiptRaw,
      ),
      scenarioReplay: artifactIdentity(
        input.manifest.scenarioReplay.reportPath,
        input.scenarioReplayRaw,
      ),
      scenarioStderr: artifactIdentity(
        input.manifest.scenarioReplay.stderrPath,
        input.scenarioStderrRaw,
      ),
      scenarioStdout: artifactIdentity(
        input.manifest.scenarioReplay.stdoutPath,
        input.scenarioStdoutRaw,
      ),
    },
    baselineCommit: input.manifest.baseline.commit,
    blockers: [],
    candidateCommit: input.manifest.candidate.commit,
    candidatePromptSha256: input.manifest.candidate.execution.promptSha256,
    claimBoundary:
      "This paired gate mechanically follows the current benchmark-claims/locomo.json recipe, whose reanswer command omits --answer-profile and therefore measures locomo-live-category-aware-v1. The historical 0.8799 temporal-bounded-v3 artifact cannot be reused. Official progress bytes are joined to final question identities, so the 1pt protection bar covers overall, category, and conversation metrics. Rerun the full 1540-question claim at the frozen release commit, then update the recipe to the command actually reproduced.",
    fullClaimRerunRequired: true,
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/run-v0-7-3-lifecycle-protection-gate.ts",
    metrics: {
      categories: Object.fromEntries(
        categories.map((category) => [
          category,
          {
            ...retrievalAndAnswerMetrics(
              rowsFor(input.baselineReport, "category", category),
              rowsFor(input.candidateReport, "category", category),
            ),
            officialScore: officialCategoryMetric(
              input.baselineOfficial,
              input.candidateOfficial,
              category,
            ),
          },
        ]),
      ),
      conversations: Object.fromEntries(
        conversations.map((conversation) => [
          conversation,
          {
            ...retrievalAndAnswerMetrics(
              rowsFor(input.baselineReport, "caseId", conversation),
              rowsFor(input.candidateReport, "caseId", conversation),
            ),
            officialScore: metricDelta(
              baselineOfficialByConversation[conversation]!,
              candidateOfficialByConversation[conversation]!,
            ),
          },
        ]),
      ),
      overall: {
        ...retrievalAndAnswerMetrics(
          input.baselineReport.cases,
          input.candidateReport.cases,
        ),
        officialScore: metricDelta(
          input.baselineOfficial.overallAccuracy,
          input.candidateOfficial.overallAccuracy,
        ),
      },
    },
    questionTransitions: {
      improved: input.liveDelta.overall.answerTransitions.improved,
      regressed: input.liveDelta.overall.answerTransitions.regressed,
    },
    releaseAllowed: false,
    researchRecordRequired: false,
    scenarioReplay: {
      ...input.manifest.scenarioReplay,
      candidateCommit: input.scenarioReplay.candidateCommit,
      failures: input.scenarioReplay.failures,
      passed: input.scenarioReplay.passed,
    },
    schemaVersion: 1,
  };

  const entries = metricEntries(report);
  report.blockers = entries
    .filter(({ metric }) => metric.delta < -MAX_REGRESSION - Number.EPSILON)
    .map(({ label }) => `${label} regressed by more than 1.00pt`);
  report.releaseAllowed = report.blockers.length === 0;
  report.researchRecordRequired = entries.some(
    ({ metric }) => Math.abs(metric.delta) > MAX_REGRESSION + Number.EPSILON,
  );
  return report;
}

async function materializeTrackedEvidenceBundle(input: {
  evaluationInput: V073LifecycleProtectionEvaluationInput;
  outputPath: string;
  report: V073LifecycleProtectionReport;
}): Promise<V073LifecycleProtectionReport> {
  const bundleRoot = resolve(
    dirname(input.outputPath),
    "v0.7.3-lifecycle-evidence",
  );
  const bundled = JSON.parse(
    JSON.stringify(input.report),
  ) as V073LifecycleProtectionReport;
  const writeRaw = async (path: string, raw: string): Promise<string> => {
    const destination = resolve(bundleRoot, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, raw);
    const repoRelative = relative(process.cwd(), destination);
    if (repoRelative.startsWith("..")) {
      throw new Error("tracked lifecycle evidence bundle must be inside the repository");
    }
    return repoRelative;
  };
  const bundleArm = async (
    name: "baseline" | "candidate",
    armInput: {
      executionReceiptRaw: string;
      officialProgressRaw: string;
      officialRaw: string;
      reportRaw: string;
      seedReportRaw: string;
      sources: ArmSourceBytes;
    },
  ): Promise<void> => {
    const artifacts = bundled.artifacts[name];
    artifacts.executionReceipt.path = await writeRaw(
      `${name}/execution-receipt.json`,
      armInput.executionReceiptRaw,
    );
    artifacts.officialSummary.path = await writeRaw(
      `${name}/official-summary.json`,
      armInput.officialRaw,
    );
    artifacts.officialProgress.path = await writeRaw(
      `${name}/official-progress.jsonl`,
      armInput.officialProgressRaw,
    );
    artifacts.officialRunnerSource.path = await writeRaw(
      `${name}/sources/rescore-official-protocols.ts`,
      armInput.sources.officialRunnerRaw,
    );
    artifacts.report.path = await writeRaw(
      `${name}/final-report.json`,
      armInput.reportRaw,
    );
    artifacts.seedReport.path = await writeRaw(
      `${name}/seed-report.json`,
      armInput.seedReportRaw,
    );
    artifacts.claimRecipeSource.path = await writeRaw(
      `${name}/sources/locomo.json`,
      armInput.sources.claimRecipeRaw,
    );
    artifacts.reanswerRunnerSource.path = await writeRaw(
      `${name}/sources/reanswer-phase-65-locomo-report.ts`,
      armInput.sources.reanswerRunnerRaw,
    );
    artifacts.seedRunnerSource.path = await writeRaw(
      `${name}/sources/run-phase-65-locomo-smoke.ts`,
      armInput.sources.seedRunnerRaw,
    );
  };
  await bundleArm("baseline", {
    executionReceiptRaw: input.evaluationInput.baselineExecutionReceiptRaw,
    officialProgressRaw: input.evaluationInput.baselineOfficialProgressRaw,
    officialRaw: input.evaluationInput.baselineOfficialRaw,
    reportRaw: input.evaluationInput.baselineReportRaw,
    seedReportRaw: input.evaluationInput.baselineSeedReportRaw,
    sources: input.evaluationInput.baselineSources,
  });
  await bundleArm("candidate", {
    executionReceiptRaw: input.evaluationInput.candidateExecutionReceiptRaw,
    officialProgressRaw: input.evaluationInput.candidateOfficialProgressRaw,
    officialRaw: input.evaluationInput.candidateOfficialRaw,
    reportRaw: input.evaluationInput.candidateReportRaw,
    seedReportRaw: input.evaluationInput.candidateSeedReportRaw,
    sources: input.evaluationInput.candidateSources,
  });
  bundled.artifacts.liveDelta.path = await writeRaw(
    "live-delta.json",
    input.evaluationInput.liveDeltaRaw,
  );
  bundled.artifacts.liveDeltaAnalyzerSource.path = await writeRaw(
    "live-delta/analyzer-source.ts",
    input.evaluationInput.liveDeltaAnalyzerSourceRaw,
  );
  bundled.artifacts.liveDeltaExecutionReceipt.path = await writeRaw(
    "live-delta/execution-receipt.json",
    input.evaluationInput.liveDeltaExecutionReceiptRaw,
  );
  bundled.artifacts.liveDeltaStdout.path = await writeRaw(
    "live-delta/stdout.log",
    input.evaluationInput.liveDeltaStdoutRaw,
  );
  bundled.artifacts.liveDeltaStderr.path = await writeRaw(
    "live-delta/stderr.log",
    input.evaluationInput.liveDeltaStderrRaw,
  );
  bundled.artifacts.manifest.path = await writeRaw(
    "manifest.json",
    input.evaluationInput.manifestRaw,
  );
  bundled.artifacts.scenarioExecutionReceipt.path = await writeRaw(
    "scenario/execution-receipt.json",
    input.evaluationInput.scenarioExecutionReceiptRaw,
  );
  bundled.artifacts.scenarioReplay.path = await writeRaw(
    "scenario/report.json",
    input.evaluationInput.scenarioReplayRaw,
  );
  bundled.artifacts.scenarioStdout.path = await writeRaw(
    "scenario/stdout.log",
    input.evaluationInput.scenarioStdoutRaw,
  );
  bundled.artifacts.scenarioStderr.path = await writeRaw(
    "scenario/stderr.log",
    input.evaluationInput.scenarioStderrRaw,
  );
  bundled.scenarioReplay.executionReceiptPath =
    bundled.artifacts.scenarioExecutionReceipt.path;
  bundled.scenarioReplay.reportPath = bundled.artifacts.scenarioReplay.path;
  bundled.scenarioReplay.stdoutPath = bundled.artifacts.scenarioStdout.path;
  bundled.scenarioReplay.stderrPath = bundled.artifacts.scenarioStderr.path;
  return bundled;
}

interface CapturedProcess {
  exitCode: number | null;
  stderr: string;
  stdout: string;
}

function runCapturedProcess(input: {
  args: readonly string[];
  command: string;
  cwd: string;
  environment?: Record<string, string>;
  streamOutput?: boolean;
}): Promise<CapturedProcess> {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: { ...process.env, ...input.environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      if (input.streamOutput !== false) {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      if (input.streamOutput !== false) {
        process.stderr.write(chunk);
      }
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolveProcess({
        exitCode,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
  });
}

async function assertPathAbsent(path: string, label: string): Promise<void> {
  try {
    await stat(resolve(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`${label} must not exist before capture: ${path}`);
}

async function readWorktreeProvenance(
  worktreePath: string,
): Promise<WorktreeProvenance> {
  const [head, status] = await Promise.all([
    runCapturedProcess({
    args: ["rev-parse", "HEAD"],
    command: "git",
    cwd: worktreePath,
      streamOutput: false,
    }),
    runCapturedProcess({
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
      command: "git",
      cwd: worktreePath,
      streamOutput: false,
    }),
  ]);
  if (head.exitCode !== 0 || status.exitCode !== 0) {
    throw new Error(`cannot inspect worktree provenance at ${worktreePath}`);
  }
  return {
    headCommit: head.stdout.trim(),
    statusPorcelain: status.stdout,
  };
}

function assertCapturedWorktreeProvenance(
  provenance: WorktreeProvenance,
  expectedCommit: string,
  label: string,
): void {
  if (provenance.headCommit !== expectedCommit) {
    throw new Error(`${label} worktree HEAD must equal ${expectedCommit}`);
  }
  if (provenance.statusPorcelain !== "") {
    throw new Error(`${label} worktree must be clean before and after capture`);
  }
}

async function writeJsonArtifact(path: string, value: unknown): Promise<string> {
  const raw = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(resolve(path), raw);
  return raw;
}

async function writeManifest(
  manifestPath: string,
  manifest: V073LifecycleProtectionManifest,
): Promise<void> {
  await writeFile(resolve(manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function runArmCaptureCli(): Promise<void> {
  const manifestPath = resolveCliFlagValueStrict(Bun.argv, "--manifest");
  const armName = resolveCliFlagValueStrict(Bun.argv, "--arm");
  if (!manifestPath || (armName !== "baseline" && armName !== "candidate")) {
    throw new Error(
      "usage: --run-arm --manifest <path> --arm <baseline|candidate>",
    );
  }
  if (Bun.version !== REQUIRED_BUN_VERSION) {
    throw new Error(`arm capture requires Bun ${REQUIRED_BUN_VERSION}`);
  }
  const resolvedManifestPath = resolve(manifestPath);
  const manifest = JSON.parse(
    await readFile(resolvedManifestPath, "utf8"),
  ) as V073LifecycleProtectionManifest;
  assertManifest(manifest);
  const arm = manifest[armName];
  const sources = {
    claimRecipeRaw: await readFile(
      resolve(arm.execution.worktreePath, CLAIM_RECIPE_SOURCE_PATH),
      "utf8",
    ),
    officialRunnerRaw: await readFile(
      resolve(arm.execution.worktreePath, OFFICIAL_RUNNER_SOURCE_PATH),
      "utf8",
    ),
    reanswerRunnerRaw: await readFile(
      resolve(arm.execution.worktreePath, REANSWER_RUNNER_SOURCE_PATH),
      "utf8",
    ),
    seedRunnerRaw: await readFile(
      resolve(arm.execution.worktreePath, SEED_RUNNER_SOURCE_PATH),
      "utf8",
    ),
  };
  assertArmSources({ arm, label: armName, sources });
  const initialProvenance = await readWorktreeProvenance(
    arm.execution.worktreePath,
  );
  assertCapturedWorktreeProvenance(initialProvenance, arm.commit, armName);
  await assertPathAbsent(
    arm.execution.seedOutputPath,
    `${armName} seed output path`,
  );
  await assertPathAbsent(
    arm.execution.freshOutputEvidence.checkpointPath,
    `${armName} seed checkpoint path`,
  );
  await assertPathAbsent(
    arm.execution.outputPath,
    `${armName} final output path`,
  );
  await assertPathAbsent(
    dirname(arm.officialSummaryPath),
    `${armName} official run directory`,
  );

  const commandChain = buildV073PairedCommandChain(
    arm,
    sources.claimRecipeRaw,
  );
  for (const [step, invocation] of Object.entries(commandChain)) {
    const result = await runCapturedProcess({
      args: invocation.args,
      command: invocation.command,
      cwd: invocation.cwd,
      environment: invocation.environment,
    });
    if (result.exitCode !== 0) {
      throw new Error(`${armName} ${step} exited with ${String(result.exitCode)}`);
    }
  }
  const [seedReportRaw, reportRaw, officialRaw, officialProgressRaw] =
    await Promise.all([
    readFile(resolve(arm.seedReportPath), "utf8"),
    readFile(resolve(arm.reportPath), "utf8"),
    readFile(resolve(arm.officialSummaryPath), "utf8"),
    readFile(resolve(dirname(arm.officialSummaryPath), "progress.jsonl"), "utf8"),
    ]);
  const finalProvenance = await readWorktreeProvenance(
    arm.execution.worktreePath,
  );
  assertCapturedWorktreeProvenance(finalProvenance, arm.commit, armName);
  if (!sameJson(initialProvenance, finalProvenance)) {
    throw new Error(`${armName} worktree provenance changed during capture`);
  }
  const receipt: ArmExecutionReceipt = {
    commandChain,
    commit: arm.commit,
    execution: arm.execution,
    generatedBy: "v0.7.3-lifecycle-paired-arm-launch",
    outputs: {
      finalReport: artifactIdentity(arm.reportPath, reportRaw),
      officialProgress: artifactIdentity(
        resolve(dirname(arm.officialSummaryPath), "progress.jsonl"),
        officialProgressRaw,
      ),
      officialSummary: artifactIdentity(arm.officialSummaryPath, officialRaw),
      seedReport: artifactIdentity(arm.seedReportPath, seedReportRaw),
    },
    schemaVersion: 1,
    worktreeProvenance: finalProvenance,
  };
  const receiptRaw = await writeJsonArtifact(arm.executionReceiptPath, receipt);
  arm.executionReceiptSha256 = sha256(receiptRaw);
  await writeManifest(resolvedManifestPath, manifest);
  process.stdout.write(
    `${armName} arm receipt: ${arm.executionReceiptPath} (${arm.executionReceiptSha256})\n`,
  );
}

function parseScenarioCounts(stdout: string, stderr: string): {
  failures: number;
  passed: number;
} {
  const output = `${stdout}\n${stderr}`;
  const passMatch = output.match(/\b(\d+)\s+pass\b/u);
  const failMatch = output.match(/\b(\d+)\s+fail\b/u);
  if (passMatch === null || failMatch === null) {
    throw new Error("scenario process output does not contain Bun pass/fail totals");
  }
  return { failures: Number(failMatch[1]), passed: Number(passMatch[1]) };
}

async function captureLiveDeltaCli(): Promise<void> {
  const manifestPath = resolveCliFlagValueStrict(Bun.argv, "--manifest");
  if (!manifestPath) {
    throw new Error("usage: --capture-live-delta --manifest <path>");
  }
  if (Bun.version !== REQUIRED_BUN_VERSION) {
    throw new Error(`live-delta capture requires Bun ${REQUIRED_BUN_VERSION}`);
  }
  const manifest = JSON.parse(
    await readFile(resolve(manifestPath), "utf8"),
  ) as V073LifecycleProtectionManifest;
  assertManifest(manifest);
  const worktreePath = manifest.candidate.execution.worktreePath;
  const initialProvenance = await readWorktreeProvenance(worktreePath);
  assertCapturedWorktreeProvenance(
    initialProvenance,
    manifest.candidate.commit,
    "candidate",
  );
  const paths = liveDeltaCapturePaths(manifest.liveDeltaPath);
  for (const [label, path] of [
    ["live-delta report", manifest.liveDeltaPath],
    ["live-delta execution receipt", paths.executionReceiptPath],
    ["live-delta stdout", paths.stdoutPath],
    ["live-delta stderr", paths.stderrPath],
  ] as const) {
    await assertPathAbsent(path, label);
  }
  const invocation = expectedLiveDeltaInvocation(manifest);
  const [analyzerSourceRaw, baselineReportRaw, candidateReportRaw] =
    await Promise.all([
      readFile(resolve(worktreePath, LIVE_DELTA_ANALYZER_SOURCE_PATH), "utf8"),
      readFile(resolve(manifest.baseline.reportPath), "utf8"),
      readFile(resolve(manifest.candidate.reportPath), "utf8"),
    ]);
  const result = await runCapturedProcess({
    args: invocation.args,
    command: invocation.command,
    cwd: invocation.cwd,
    environment: invocation.environment,
  });
  await mkdir(dirname(paths.stdoutPath), { recursive: true });
  await Promise.all([
    writeFile(paths.stdoutPath, result.stdout),
    writeFile(paths.stderrPath, result.stderr),
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`live-delta analyzer exited with ${String(result.exitCode)}`);
  }
  const liveDeltaRaw = await readFile(resolve(manifest.liveDeltaPath), "utf8");
  const finalProvenance = await readWorktreeProvenance(worktreePath);
  assertCapturedWorktreeProvenance(
    finalProvenance,
    manifest.candidate.commit,
    "candidate",
  );
  if (!sameJson(initialProvenance, finalProvenance)) {
    throw new Error("candidate worktree provenance changed during live-delta capture");
  }
  const receipt: LiveDeltaExecutionReceipt = {
    analyzerSource: artifactIdentity(
      resolve(worktreePath, LIVE_DELTA_ANALYZER_SOURCE_PATH),
      analyzerSourceRaw,
    ),
    baselineCommit: manifest.baseline.commit,
    baselineReport: artifactIdentity(
      manifest.baseline.reportPath,
      baselineReportRaw,
    ),
    bunVersion: Bun.version,
    candidateCommit: manifest.candidate.commit,
    candidateReport: artifactIdentity(
      manifest.candidate.reportPath,
      candidateReportRaw,
    ),
    exitCode: result.exitCode,
    generatedBy: "v0.7.3-live-delta-process-capture",
    invocation,
    report: artifactIdentity(manifest.liveDeltaPath, liveDeltaRaw),
    schemaVersion: 1,
    stderr: artifactIdentity(paths.stderrPath, result.stderr),
    stdout: artifactIdentity(paths.stdoutPath, result.stdout),
    worktreeProvenance: finalProvenance,
  };
  await writeJsonArtifact(paths.executionReceiptPath, receipt);
  process.stdout.write(`live-delta receipt: ${paths.executionReceiptPath}\n`);
}

async function captureScenarioCli(): Promise<void> {
  const manifestPath = resolveCliFlagValueStrict(Bun.argv, "--manifest");
  if (!manifestPath) {
    throw new Error("usage: --capture-scenario --manifest <path>");
  }
  if (Bun.version !== REQUIRED_BUN_VERSION) {
    throw new Error(`scenario capture requires Bun ${REQUIRED_BUN_VERSION}`);
  }
  const resolvedManifestPath = resolve(manifestPath);
  const manifest = JSON.parse(
    await readFile(resolvedManifestPath, "utf8"),
  ) as V073LifecycleProtectionManifest;
  assertManifest(manifest);
  const scenario = manifest.scenarioReplay;
  const initialProvenance = await readWorktreeProvenance(
    manifest.candidate.execution.worktreePath,
  );
  assertCapturedWorktreeProvenance(
    initialProvenance,
    manifest.candidate.commit,
    "candidate",
  );
  for (const [label, path] of [
    ["scenario report", scenario.reportPath],
    ["scenario execution receipt", scenario.executionReceiptPath],
    ["scenario stdout", scenario.stdoutPath],
    ["scenario stderr", scenario.stderrPath],
  ] as const) {
    await assertPathAbsent(path, label);
  }
  const result = await runCapturedProcess({
    args: ["test", "tests/scenarios"],
    command: "bun",
    cwd: manifest.candidate.execution.worktreePath,
  });
  await mkdir(dirname(resolve(scenario.stdoutPath)), { recursive: true });
  await Promise.all([
    writeFile(resolve(scenario.stdoutPath), result.stdout),
    writeFile(resolve(scenario.stderrPath), result.stderr),
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`scenario replay exited with ${String(result.exitCode)}`);
  }
  const counts = parseScenarioCounts(result.stdout, result.stderr);
  if (counts.failures !== 0 || counts.passed < 1) {
    throw new Error("scenario replay did not complete with a clean pass result");
  }
  const finalProvenance = await readWorktreeProvenance(
    manifest.candidate.execution.worktreePath,
  );
  assertCapturedWorktreeProvenance(
    finalProvenance,
    manifest.candidate.commit,
    "candidate",
  );
  if (!sameJson(initialProvenance, finalProvenance)) {
    throw new Error("candidate worktree provenance changed during scenario capture");
  }
  const receipt: ScenarioExecutionReceipt = {
    bunVersion: Bun.version,
    candidateCommit: manifest.candidate.commit,
    command: EXPECTED_SCENARIO_COMMAND,
    exitCode: result.exitCode,
    generatedBy: "v0.7.3-scenario-process-capture",
    schemaVersion: 1,
    stderr: artifactIdentity(scenario.stderrPath, result.stderr),
    stdout: artifactIdentity(scenario.stdoutPath, result.stdout),
    worktreeProvenance: finalProvenance,
  };
  const receiptRaw = await writeJsonArtifact(
    scenario.executionReceiptPath,
    receipt,
  );
  const report: ScenarioReplayReport = {
    candidateCommit: manifest.candidate.commit,
    command: EXPECTED_SCENARIO_COMMAND,
    executionReceiptPath: scenario.executionReceiptPath,
    failures: counts.failures,
    generatedBy: "v0.7.3-scenario-process-capture",
    passed: counts.passed,
    schemaVersion: 1,
  };
  const reportRaw = await writeJsonArtifact(scenario.reportPath, report);
  scenario.executionReceiptSha256 = sha256(receiptRaw);
  scenario.reportSha256 = sha256(reportRaw);
  scenario.stderrSha256 = sha256(result.stderr);
  scenario.stdoutSha256 = sha256(result.stdout);
  await writeManifest(resolvedManifestPath, manifest);
  process.stdout.write(
    `scenario receipt: ${scenario.executionReceiptPath} (${scenario.executionReceiptSha256})\n`,
  );
}

async function runCli(): Promise<void> {
  const manifestPath = resolveCliFlagValueStrict(Bun.argv, "--manifest");
  const outputPath = resolveCliFlagValueStrict(Bun.argv, "--output");
  if (!manifestPath || !outputPath) {
    throw new Error("usage: --manifest <path> --output <path>");
  }
  const resolvedManifestPath = resolve(manifestPath);
  const manifestRaw = await readFile(resolvedManifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as V073LifecycleProtectionManifest;
  const readArm = async (arm: V073ProtectionArmManifest) => {
    const [executionReceiptRaw, officialRaw, officialProgressRaw, reportRaw, seedReportRaw, claimRecipeRaw, officialRunnerRaw, reanswerRunnerRaw, seedRunnerRaw, worktreeProvenance] =
      await Promise.all([
        readFile(resolve(arm.executionReceiptPath), "utf8"),
        readFile(resolve(arm.officialSummaryPath), "utf8"),
        readFile(resolve(dirname(arm.officialSummaryPath), "progress.jsonl"), "utf8"),
        readFile(resolve(arm.reportPath), "utf8"),
        readFile(resolve(arm.seedReportPath), "utf8"),
        readFile(resolve(arm.execution.worktreePath, CLAIM_RECIPE_SOURCE_PATH), "utf8"),
        readFile(resolve(arm.execution.worktreePath, OFFICIAL_RUNNER_SOURCE_PATH), "utf8"),
        readFile(resolve(arm.execution.worktreePath, REANSWER_RUNNER_SOURCE_PATH), "utf8"),
        readFile(resolve(arm.execution.worktreePath, SEED_RUNNER_SOURCE_PATH), "utf8"),
        readWorktreeProvenance(arm.execution.worktreePath),
      ]);
    return {
      executionReceipt: JSON.parse(executionReceiptRaw) as ArmExecutionReceipt,
      executionReceiptRaw,
      official: JSON.parse(officialRaw) as OfficialSummary,
      officialProgressRaw,
      officialRaw,
      report: JSON.parse(reportRaw) as SmokeReport,
      reportRaw,
      seedReport: JSON.parse(seedReportRaw) as SmokeReport,
      seedReportRaw,
      sources: { claimRecipeRaw, officialRunnerRaw, reanswerRunnerRaw, seedRunnerRaw },
      worktreeProvenance,
    };
  };
  const liveDeltaPaths = liveDeltaCapturePaths(manifest.liveDeltaPath);
  const [baseline, candidate, liveDeltaRaw, liveDeltaExecutionReceiptRaw, liveDeltaAnalyzerSourceRaw, liveDeltaStdoutRaw, liveDeltaStderrRaw, scenarioReplayRaw, scenarioExecutionReceiptRaw, scenarioStdoutRaw, scenarioStderrRaw] =
    await Promise.all([
      readArm(manifest.baseline),
      readArm(manifest.candidate),
      readFile(resolve(manifest.liveDeltaPath), "utf8"),
      readFile(liveDeltaPaths.executionReceiptPath, "utf8"),
      readFile(
        resolve(
          manifest.candidate.execution.worktreePath,
          LIVE_DELTA_ANALYZER_SOURCE_PATH,
        ),
        "utf8",
      ),
      readFile(liveDeltaPaths.stdoutPath, "utf8"),
      readFile(liveDeltaPaths.stderrPath, "utf8"),
      readFile(resolve(manifest.scenarioReplay.reportPath), "utf8"),
      readFile(resolve(manifest.scenarioReplay.executionReceiptPath), "utf8"),
      readFile(resolve(manifest.scenarioReplay.stdoutPath), "utf8"),
      readFile(resolve(manifest.scenarioReplay.stderrPath), "utf8"),
    ]);
  const evaluationInput: V073LifecycleProtectionEvaluationInput = {
    baselineExecutionReceipt: baseline.executionReceipt,
    baselineExecutionReceiptRaw: baseline.executionReceiptRaw,
    baselineOfficial: baseline.official,
    baselineOfficialProgressRaw: baseline.officialProgressRaw,
    baselineOfficialRaw: baseline.officialRaw,
    baselineReport: baseline.report,
    baselineReportRaw: baseline.reportRaw,
    baselineSeedReport: baseline.seedReport,
    baselineSeedReportRaw: baseline.seedReportRaw,
    baselineSources: baseline.sources,
    baselineWorktreeProvenance: baseline.worktreeProvenance,
    candidateExecutionReceipt: candidate.executionReceipt,
    candidateExecutionReceiptRaw: candidate.executionReceiptRaw,
    candidateOfficial: candidate.official,
    candidateOfficialProgressRaw: candidate.officialProgressRaw,
    candidateOfficialRaw: candidate.officialRaw,
    candidateReport: candidate.report,
    candidateReportRaw: candidate.reportRaw,
    candidateSeedReport: candidate.seedReport,
    candidateSeedReportRaw: candidate.seedReportRaw,
    candidateSources: candidate.sources,
    candidateWorktreeProvenance: candidate.worktreeProvenance,
    liveDelta: JSON.parse(liveDeltaRaw) as LiveDelta,
    liveDeltaAnalyzerSourceRaw,
    liveDeltaExecutionReceipt: JSON.parse(
      liveDeltaExecutionReceiptRaw,
    ) as LiveDeltaExecutionReceipt,
    liveDeltaExecutionReceiptRaw,
    liveDeltaRaw,
    liveDeltaStderrRaw,
    liveDeltaStdoutRaw,
    manifest,
    manifestPath: resolvedManifestPath,
    manifestRaw,
    scenarioExecutionReceipt: JSON.parse(
      scenarioExecutionReceiptRaw,
    ) as ScenarioExecutionReceipt,
    scenarioExecutionReceiptRaw,
    scenarioReplay: JSON.parse(scenarioReplayRaw) as ScenarioReplayReport,
    scenarioReplayRaw,
    scenarioStderrRaw,
    scenarioStdoutRaw,
  };
  const evaluated = evaluateV073LifecycleProtection(evaluationInput);
  const report = await materializeTrackedEvidenceBundle({
    evaluationInput,
    outputPath: resolve(outputPath),
    report: evaluated,
  });
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.releaseAllowed) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  const runArm = hasCliFlagStrict(Bun.argv, "--run-arm");
  const captureScenario = hasCliFlagStrict(Bun.argv, "--capture-scenario");
  const captureLiveDelta = hasCliFlagStrict(Bun.argv, "--capture-live-delta");
  if ([runArm, captureScenario, captureLiveDelta].filter(Boolean).length > 1) {
    throw new Error("choose exactly one capture mode");
  }
  if (runArm) {
    await runArmCaptureCli();
  } else if (captureLiveDelta) {
    await captureLiveDeltaCli();
  } else if (captureScenario) {
    await captureScenarioCli();
  } else {
    await runCli();
  }
}
