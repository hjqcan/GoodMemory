import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { resolveCliFlagValueStrict } from "./cli-options";
import {
  createProviderResponseTapeProxy,
  parseProviderResponseTape,
  serializeProviderResponseTape,
} from "./provider-response-tape";
import type {
  ProviderResponseTapeProxy,
  ProviderTapeSessionStats,
} from "./provider-response-tape";
import {
  buildV073PairedCommandChain,
  deriveV073ClaimCommandTemplateSha256,
  deriveV073PromptSha256,
} from "./run-v0-7-3-lifecycle-protection-gate";
import type {
  V073PairedCommandChain,
  V073ProtectionArmManifest,
} from "./run-v0-7-3-lifecycle-protection-gate";
import { evaluateV073ReplacementProtection } from "./v0-7-3-replacement-protection";
import type {
  V073ProtectionSmokeReport,
  V073ProviderReplaySession,
  V073ReplacementProtectionInput,
  V073ReplacementProtectionReport,
} from "./v0-7-3-replacement-protection";

const BASELINE_COMMIT = "456edd106f29118b3455bf21c43d7b3107b48213";
const REQUIRED_BUN_VERSION = "1.3.14";
const BENCHMARK_FINGERPRINT =
  "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd";
const BENCHMARK_ROOT_SHA256 =
  "e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28";
const BENCHMARK_ROOT_BYTES = 2_490_457;
const QUESTION_SELECTION_SHA256 =
  "43ed915ce851ba4f1501ed0fd995c29611195f8ff71d2c6af57ae9dc118a5c6c";
const CASE_IDS = ["locomo-conv-26", "locomo-conv-30"] as const;
const EXPECTED_QUESTION_COUNT = 233;
const EXPECTED_CASE_COUNTS = {
  "locomo-conv-26": 152,
  "locomo-conv-30": 81,
} as const;
const EXPECTED_CATEGORY_COUNTS = {
  multi_hop: 43,
  open_domain: 13,
  single_hop: 114,
  temporal: 63,
} as const;
const CLAIM_RECIPE_PATH = "benchmark-claims/locomo.json";
const SEED_RUNNER_PATH = "scripts/run-phase-65-locomo-smoke.ts";
const REANSWER_RUNNER_PATH = "scripts/reanswer-phase-65-locomo-report.ts";
const OFFICIAL_RUNNER_PATH = "scripts/rescore-official-protocols.ts";
const EVIDENCE_ROOT = "reports/release/v0.7/v0.7.3-lifecycle-evidence";
const PROTECTION_ARTIFACT =
  "reports/release/v0.7/v0.7.3-lifecycle-protection.json";

export const V073_PROVIDER_STAGE_ORDER = [
  "seedSmoke",
  "reanswer",
  "officialRescore",
] as const;

interface V073ReplacementGateCliOptions {
  baselineWorktree: string;
  benchmarkRoot: string;
  candidateWorktree: string;
  outputDir: string;
}

export interface ProviderIdentity {
  gateway: string;
  model: string;
  provider: string;
}

export interface V073StageSourceIdentity {
  claimRecipeRaw: string;
  officialSourceSha256: string;
  reanswerSourceSha256: string;
  seedSourceSha256: string;
}

interface WorktreeProvenance {
  branch: string | null;
  commit: string;
  statusPorcelain: string;
}

interface CapturedProcess {
  exitCode: number | null;
  stderr: string;
  stdout: string;
}

interface ArtifactIdentity {
  bytes: number;
  path: string;
  sha256: string;
}

interface HarnessIdentity {
  bytes: number;
  path: string;
  sha256: string;
}

interface FormalSmokeCase {
  answerCorrect: boolean;
  answerTokenF1: number;
  caseId: string;
  category: string;
  evidenceRecall: number;
  questionId: string;
}

interface ProviderFreeRetrievalCase {
  caseId: string;
  category: string;
  evidenceRecall: number;
  evidenceTurnIds: string[];
  goldEvidenceFullyRetrieved: boolean;
  missingEvidenceTurnIds: string[];
  noiseTurnCount: number;
  noiseTurnIds: string[];
  questionId: string;
  retrievedTurnIds: string[];
}

interface ProviderFreeSmokeReport extends Omit<
  V073ProtectionSmokeReport,
  "cases"
> {
  cases: ProviderFreeRetrievalCase[];
}

interface FormalSmokeReport extends V073ProtectionSmokeReport {
  cases: FormalSmokeCase[];
}

interface OfficialSummary {
  judgeFailures: number;
  overallAccuracy: number;
}

interface OfficialProgressRow {
  correct: boolean;
  questionId: string;
}

interface ProviderStageResult {
  finalReport: FormalSmokeReport;
  finalReportPath: string;
  officialSummary: OfficialSummary;
  officialSummaryPath: string;
  officialProgress: OfficialProgressRow[];
  officialProgressPath: string;
  receiptPath: string;
  seedReportPath: string;
  session: ProviderTapeSessionStats;
}

export interface V073TapeBaseUrls {
  assisted: string;
  embedding: string;
  eval: string;
  judge: string;
  reranking: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function artifactIdentity(path: string, raw: string): ArtifactIdentity {
  const trackedPath = relative(process.cwd(), resolve(path));
  if (trackedPath.startsWith("..")) {
    throw new Error("replacement protection artifacts must stay inside the repository");
  }
  return {
    bytes: Buffer.byteLength(raw, "utf8"),
    path: trackedPath,
    sha256: sha256(raw),
  };
}

export function parseV073ReplacementGateCliOptions(
  argv: readonly string[],
): V073ReplacementGateCliOptions {
  const baselineWorktree = resolveCliFlagValueStrict(argv, "--baseline-worktree");
  const candidateWorktree = resolveCliFlagValueStrict(argv, "--candidate-worktree");
  const benchmarkRoot = resolveCliFlagValueStrict(argv, "--benchmark-root");
  const outputDir = resolveCliFlagValueStrict(argv, "--output-dir");
  if (!baselineWorktree || !candidateWorktree || !benchmarkRoot || !outputDir) {
    throw new Error(
      "usage: --baseline-worktree <detached-path> --candidate-worktree <detached-path> --benchmark-root <path> --output-dir <fresh-path>",
    );
  }
  return { baselineWorktree, benchmarkRoot, candidateWorktree, outputDir };
}

export function routeV073CommandChainThroughTape(
  chain: V073PairedCommandChain,
  baseUrls: V073TapeBaseUrls,
  options: { replayCredentials: boolean } = { replayCredentials: false },
): V073PairedCommandChain {
  const route = (environment: Record<string, string>): Record<string, string> => ({
    ...environment,
    GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL: baseUrls.assisted,
    GOODMEMORY_EMBEDDING_BASE_URL: baseUrls.embedding,
    GOODMEMORY_EVAL_BASE_URL: baseUrls.eval,
    GOODMEMORY_JUDGE_BASE_URL: baseUrls.judge,
    GOODMEMORY_RERANKING_BASE_URL: baseUrls.reranking,
    ...(options.replayCredentials
      ? {
          GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY:
            "provider-response-tape-replay",
          GOODMEMORY_EMBEDDING_API_KEY: "provider-response-tape-replay",
          GOODMEMORY_EVAL_API_KEY: "provider-response-tape-replay",
          GOODMEMORY_JUDGE_API_KEY: "provider-response-tape-replay",
          GOODMEMORY_RERANKING_API_KEY: "provider-response-tape-replay",
        }
      : {}),
  });
  return {
    officialRescore: {
      ...chain.officialRescore,
      environment: route(chain.officialRescore.environment),
    },
    reanswer: {
      ...chain.reanswer,
      environment: route(chain.reanswer.environment),
    },
    seedSmoke: {
      ...chain.seedSmoke,
      environment: route(chain.seedSmoke.environment),
    },
  };
}

function runCapturedProcess(input: {
  args: readonly string[];
  command: string;
  cwd: string;
  environment?: Record<string, string>;
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
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      process.stderr.write(chunk);
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

async function worktreeProvenance(path: string): Promise<WorktreeProvenance> {
  const [head, status, branch] = await Promise.all([
    runCapturedProcess({ args: ["rev-parse", "HEAD"], command: "git", cwd: path }),
    runCapturedProcess({
      args: ["status", "--porcelain", "--untracked-files=all"],
      command: "git",
      cwd: path,
    }),
    runCapturedProcess({
      args: ["symbolic-ref", "-q", "--short", "HEAD"],
      command: "git",
      cwd: path,
    }),
  ]);
  if (head.exitCode !== 0 || status.exitCode !== 0) {
    throw new Error(`cannot inspect detached checkout ${path}`);
  }
  return {
    branch: branch.exitCode === 0 ? branch.stdout.trim() : null,
    commit: head.stdout.trim(),
    statusPorcelain: status.stdout,
  };
}

function assertCleanDetached(
  provenance: WorktreeProvenance,
  expectedCommit: string | null,
  label: string,
): void {
  if (provenance.branch !== null) {
    throw new Error(`${label} protection checkout must be detached`);
  }
  if (provenance.statusPorcelain !== "") {
    throw new Error(`${label} protection checkout must be clean`);
  }
  if (expectedCommit !== null && provenance.commit !== expectedCommit) {
    throw new Error(`${label} protection checkout must be at ${expectedCommit}`);
  }
}

function requiredProvider(prefix: string): ProviderIdentity {
  const gateway = process.env[`${prefix}_BASE_URL`]?.trim();
  const model = process.env[`${prefix}_MODEL`]?.trim();
  const provider = process.env[`${prefix}_PROVIDER`]?.trim();
  if (!gateway || !model || !provider) {
    throw new Error(`${prefix} provider identity is required`);
  }
  return { gateway, model, provider };
}

function assertProviderIdentities(input: {
  assisted: ProviderIdentity;
  embedding: ProviderIdentity;
  eval: ProviderIdentity;
  judge: ProviderIdentity;
  reranking: ProviderIdentity;
}): void {
  for (const [label, identity, gateway, model] of [
    ["eval", input.eval, "https://ai.gurkiai.com/v1", "gpt-5.6-terra"],
    ["assisted", input.assisted, "https://ai.gurkiai.com/v1", "gpt-5.6-terra"],
    ["embedding", input.embedding, "https://openrouter.ai/api/v1", "text-embedding-3-small"],
    ["reranking", input.reranking, "https://ai.gurkiai.com/v1", "gpt-5.6-terra"],
    ["judge", input.judge, "https://ai.gurkiai.com/v1", "gpt-5.5"],
  ] as const) {
    if (
      identity.gateway !== gateway ||
      identity.model !== model ||
      identity.provider !== "openai"
    ) {
      throw new Error(`${label} provider identity does not match the preregistration`);
    }
  }
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
  throw new Error(`${label} must not exist before the run`);
}

async function measurementHarness(
  worktreePath: string,
): Promise<Record<string, HarnessIdentity>> {
  const sources = {
    claimRecipe: CLAIM_RECIPE_PATH,
    officialRunner: OFFICIAL_RUNNER_PATH,
    reanswerRunner: REANSWER_RUNNER_PATH,
    seedRunner: SEED_RUNNER_PATH,
  } as const;
  return Object.fromEntries(await Promise.all(
    Object.entries(sources).map(async ([name, path]) => {
      const raw = await readFile(join(worktreePath, path), "utf8");
      return [name, {
        bytes: Buffer.byteLength(raw, "utf8"),
        path,
        sha256: sha256(raw),
      }] as const;
    }),
  ));
}

async function writeJson(path: string, value: unknown): Promise<string> {
  const raw = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(resolve(path), raw);
  return raw;
}

async function writeAtomic(path: string, raw: string): Promise<void> {
  const resolved = resolve(path);
  const partial = `${resolved}.partial`;
  await writeFile(partial, raw, { flag: "wx" });
  await rename(partial, resolved);
}

function stageRunId(stage: string, suffix: string, outputDir: string): string {
  return `v073-${stage}-${suffix}-${sha256(resolve(outputDir)).slice(0, 8)}`;
}

export function buildV073StageArm(input: {
  benchmarkRoot: string;
  claimRecipeRaw: string;
  commit: string;
  outputDir: string;
  providers: {
    assisted: ProviderIdentity;
    embedding: ProviderIdentity;
    eval: ProviderIdentity;
    judge: ProviderIdentity;
    reranking: ProviderIdentity;
  };
  sourceIdentity: Omit<V073StageSourceIdentity, "claimRecipeRaw">;
  stage: string;
  worktreePath: string;
}): { arm: V073ProtectionArmManifest; claimRecipeRaw: string } {
  const stageRoot = join(input.outputDir, "provider-replay", input.stage);
  const seedRunId = stageRunId(input.stage, "seed", input.outputDir);
  const runId = stageRunId(input.stage, "final", input.outputDir);
  const officialRunId = stageRunId(input.stage, "official", input.outputDir);
  const seedOutputPath = join(stageRoot, seedRunId);
  const outputPath = join(stageRoot, runId);
  const execution = {
    answerGateway: input.providers.eval.gateway,
    answerModel: input.providers.eval.model,
    answerProvider: input.providers.eval.provider,
    answerSystem: "locomo-live-category-aware-v1",
    assistedExtractorGateway: input.providers.assisted.gateway,
    assistedExtractorModel: input.providers.assisted.model,
    assistedExtractorProvider: input.providers.assisted.provider,
    benchmarkFingerprint: BENCHMARK_FINGERPRINT,
    benchmarkRoot: input.benchmarkRoot,
    benchmarkRootSha256: BENCHMARK_ROOT_SHA256,
    bunVersion: REQUIRED_BUN_VERSION,
    caseIds: CASE_IDS,
    claimCommandTemplateSha256:
      deriveV073ClaimCommandTemplateSha256(input.claimRecipeRaw),
    claimSourceSha256: sha256(input.claimRecipeRaw),
    concurrency: 40,
    embeddingGateway: input.providers.embedding.gateway,
    embeddingModel: input.providers.embedding.model,
    embeddingProvider: input.providers.embedding.provider,
    freshOutputEvidence: {
      checkpointPath: join(seedOutputPath, "live-progress.jsonl"),
      checkpointPathAbsentBeforeRun: true,
      outputPath: seedOutputPath,
      outputPathAbsentBeforeRun: true,
    },
    generatedBy: REANSWER_RUNNER_PATH,
    judgeGateway: input.providers.judge.gateway,
    judgeModel: input.providers.judge.model,
    judgeProvider: input.providers.judge.provider,
    officialRunId,
    officialSourceSha256: input.sourceIdentity.officialSourceSha256,
    outputPath,
    promptSha256: deriveV073PromptSha256(),
    questionSelectionSha256: QUESTION_SELECTION_SHA256,
    reanswerSourceSha256: input.sourceIdentity.reanswerSourceSha256,
    rerankingGateway: input.providers.reranking.gateway,
    rerankingModel: input.providers.reranking.model,
    rerankingProvider: input.providers.reranking.provider,
    resume: false,
    runId,
    seedGeneratedBy: SEED_RUNNER_PATH,
    seedOutputPath,
    seedResume: true,
    seedRunId,
    seedSourceSha256: input.sourceIdentity.seedSourceSha256,
    worktreePath: input.worktreePath,
  };
  return {
    arm: {
      commit: input.commit,
      execution,
      executionReceiptPath: join(stageRoot, "execution-receipt.json"),
      executionReceiptSha256: "0".repeat(64),
      officialSummaryPath: join(
        input.worktreePath,
        "reports/eval/research/official-rescore",
        officialRunId,
        "rescore-summary.json",
      ),
      reportPath: join(outputPath, "smoke-report.json"),
      seedReportPath: join(seedOutputPath, "smoke-report.json"),
    },
    claimRecipeRaw: input.claimRecipeRaw,
  };
}

async function buildStageArm(input: {
  benchmarkRoot: string;
  commit: string;
  outputDir: string;
  providers: {
    assisted: ProviderIdentity;
    embedding: ProviderIdentity;
    eval: ProviderIdentity;
    judge: ProviderIdentity;
    reranking: ProviderIdentity;
  };
  stage: string;
  worktreePath: string;
}): Promise<{ arm: V073ProtectionArmManifest; claimRecipeRaw: string }> {
  const [claimRecipeRaw, seedSource, reanswerSource, officialSource] =
    await Promise.all([
      readFile(join(input.worktreePath, CLAIM_RECIPE_PATH), "utf8"),
      readFile(join(input.worktreePath, SEED_RUNNER_PATH), "utf8"),
      readFile(join(input.worktreePath, REANSWER_RUNNER_PATH), "utf8"),
      readFile(join(input.worktreePath, OFFICIAL_RUNNER_PATH), "utf8"),
    ]);
  return buildV073StageArm({
    ...input,
    claimRecipeRaw,
    sourceIdentity: {
      officialSourceSha256: sha256(officialSource),
      reanswerSourceSha256: sha256(reanswerSource),
      seedSourceSha256: sha256(seedSource),
    },
  });
}

function tapeBaseUrls(proxy: ProviderResponseTapeProxy): V073TapeBaseUrls {
  return {
    assisted: proxy.baseUrl("assisted"),
    embedding: proxy.baseUrl("embedding"),
    eval: proxy.baseUrl("eval"),
    judge: proxy.baseUrl("judge"),
    reranking: proxy.baseUrl("reranking"),
  };
}

function questionSelectionSha256(
  rows: ReadonlyArray<{ caseId: string; category: string; questionId: string }>,
): string {
  return sha256(JSON.stringify(rows.map(({ caseId, category, questionId }) => ({
    caseId,
    category,
    questionId,
  }))));
}

export function parseV073FormalSmokeReport(raw: string): FormalSmokeReport {
  const report = JSON.parse(raw) as FormalSmokeReport;
  if (
    report.questionCount !== EXPECTED_QUESTION_COUNT ||
    report.cases.length !== EXPECTED_QUESTION_COUNT ||
    report.executionFailures !== 0 ||
    report.cases.some((row) =>
      typeof row.answerCorrect !== "boolean" ||
      !Number.isFinite(row.answerTokenF1) ||
      row.answerTokenF1 < 0 ||
      row.answerTokenF1 > 1 ||
      !Number.isFinite(row.evidenceRecall) ||
      row.evidenceRecall < 0 ||
      row.evidenceRecall > 1
    ) ||
    questionSelectionSha256(report.cases) !== QUESTION_SELECTION_SHA256
  ) {
    throw new Error("formal provider replay report is incomplete");
  }
  return report;
}

export function parseV073OfficialSummary(raw: string): OfficialSummary {
  const summary = JSON.parse(raw) as OfficialSummary;
  if (
    !Number.isFinite(summary.overallAccuracy) ||
    summary.overallAccuracy < 0 ||
    summary.overallAccuracy > 1 ||
    !Number.isSafeInteger(summary.judgeFailures) ||
    summary.judgeFailures < 0
  ) {
    throw new Error("formal provider replay official summary is incomplete");
  }
  return summary;
}

export function parseV073OfficialProgress(raw: string): OfficialProgressRow[] {
  const rows = raw
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as OfficialProgressRow);
  if (
    rows.length !== EXPECTED_QUESTION_COUNT ||
    rows.some((row) =>
      typeof row.questionId !== "string" ||
      typeof row.correct !== "boolean"
    ) ||
    new Set(rows.map((row) => row.questionId)).size !== EXPECTED_QUESTION_COUNT
  ) {
    throw new Error("formal provider replay official progress is incomplete");
  }
  return rows;
}

export function parseV073ProviderFreeReport(input: {
  benchmarkRoot: string;
  concurrency: number;
  raw: string;
}): V073ProtectionSmokeReport {
  const report = JSON.parse(input.raw) as ProviderFreeSmokeReport & {
    answerEvaluation: string;
    benchmarkFingerprint: string;
    caseIds: string[];
    concurrency: number;
    externalRoot: string;
    generalizedFusion: boolean;
    generatedBy: string;
    ingestMode: string;
    labelFreeIngest: boolean;
    mode: string;
    profilesCompared: string[];
    providerReranking: boolean;
    resume: boolean;
    semanticCandidateEmbeddingSource: string;
  };
  if (
    report.answerEvaluation !== "deferred-to-live-mode" ||
    report.benchmarkFingerprint !== BENCHMARK_FINGERPRINT ||
    JSON.stringify(report.caseIds) !== JSON.stringify(CASE_IDS) ||
    report.concurrency !== input.concurrency ||
    resolve(report.externalRoot) !== resolve(input.benchmarkRoot) ||
    report.generalizedFusion !== true ||
    report.generatedBy !== SEED_RUNNER_PATH ||
    report.ingestMode !== "raw-turns" ||
    report.labelFreeIngest !== true ||
    report.mode !== "retrieval-only" ||
    JSON.stringify(report.profilesCompared) !==
      JSON.stringify(["goodmemory-recommended"]) ||
    report.providerReranking !== false ||
    report.resume !== false ||
    report.semanticCandidateEmbeddingSource !== "none" ||
    report.questionCount !== EXPECTED_QUESTION_COUNT ||
    report.cases.length !== EXPECTED_QUESTION_COUNT
  ) {
    throw new Error("provider-free report does not match the preregistered mode");
  }
  for (const [caseId, count] of Object.entries(EXPECTED_CASE_COUNTS)) {
    if (report.cases.filter((row) => row.caseId === caseId).length !== count) {
      throw new Error("provider-free report does not match the frozen population");
    }
  }
  for (const [category, count] of Object.entries(EXPECTED_CATEGORY_COUNTS)) {
    if (report.cases.filter((row) => row.category === category).length !== count) {
      throw new Error("provider-free report does not match the frozen population");
    }
  }
  if (
    new Set(report.cases.map((row) => `${row.caseId}\0${row.questionId}`)).size !==
      EXPECTED_QUESTION_COUNT
  ) {
    throw new Error("provider-free report question identities must be unique");
  }
  if (questionSelectionSha256(report.cases) !== QUESTION_SELECTION_SHA256) {
    throw new Error(
      "provider-free report does not match the frozen question selection",
    );
  }
  for (const row of report.cases) {
    if (
      !Array.isArray(row.evidenceTurnIds) ||
      row.evidenceTurnIds.some((id) => typeof id !== "string") ||
      !Array.isArray(row.retrievedTurnIds) ||
      row.retrievedTurnIds.some((id) => typeof id !== "string") ||
      !Array.isArray(row.missingEvidenceTurnIds) ||
      row.missingEvidenceTurnIds.some((id) => typeof id !== "string") ||
      !Array.isArray(row.noiseTurnIds) ||
      row.noiseTurnIds.some((id) => typeof id !== "string")
    ) {
      throw new Error("provider-free retrieval metrics are inconsistent");
    }
    const retrieved = new Set(row.retrievedTurnIds);
    const evidence = new Set(row.evidenceTurnIds);
    const evidenceHitCount = row.evidenceTurnIds.filter((id) =>
      retrieved.has(id)
    ).length;
    const evidenceRecall = row.evidenceTurnIds.length === 0
      ? 1
      : evidenceHitCount / row.evidenceTurnIds.length;
    const missingEvidenceTurnIds = row.evidenceTurnIds.filter(
      (id) => !retrieved.has(id),
    );
    const noiseTurnIds = row.retrievedTurnIds.filter(
      (id, index, all) => !evidence.has(id) && all.indexOf(id) === index,
    );
    if (
      row.evidenceRecall !== evidenceRecall ||
      row.goldEvidenceFullyRetrieved !== (evidenceRecall === 1) ||
      JSON.stringify(row.missingEvidenceTurnIds) !==
        JSON.stringify(missingEvidenceTurnIds) ||
      row.noiseTurnCount !== noiseTurnIds.length ||
      JSON.stringify(row.noiseTurnIds) !== JSON.stringify(noiseTurnIds)
    ) {
      throw new Error("provider-free retrieval metrics are inconsistent");
    }
  }
  return report;
}

async function runProviderStage(input: {
  arm: V073ProtectionArmManifest;
  claimRecipeRaw: string;
  liveOnMiss: boolean;
  mode: "prefetch" | "replay";
  proxy: ProviderResponseTapeProxy;
  stage: string;
}): Promise<ProviderStageResult> {
  await Promise.all([
    assertPathAbsent(input.arm.execution.seedOutputPath, `${input.stage} seed output`),
    assertPathAbsent(input.arm.execution.outputPath, `${input.stage} final output`),
    assertPathAbsent(dirname(input.arm.officialSummaryPath), `${input.stage} official output`),
  ]);
  const chain = routeV073CommandChainThroughTape(
    buildV073PairedCommandChain(input.arm, input.claimRecipeRaw),
    tapeBaseUrls(input.proxy),
    { replayCredentials: input.mode === "replay" },
  );
  input.proxy.beginSession({
    liveOnMiss: input.liveOnMiss,
    mode: input.mode,
    name: input.stage,
  });
  const processes: Array<{ result: CapturedProcess; step: string }> = [];
  let session: ProviderTapeSessionStats;
  try {
    for (const step of V073_PROVIDER_STAGE_ORDER) {
      const invocation = chain[step];
      const result = await runCapturedProcess({
        args: invocation.args,
        command: invocation.command,
        cwd: invocation.cwd,
        environment: invocation.environment,
      });
      processes.push({ result, step });
      if (result.exitCode !== 0) {
        break;
      }
    }
  } finally {
    session = input.proxy.endSession();
  }
  const stageRoot = dirname(input.arm.executionReceiptPath);
  const stdout = processes
    .map(({ result, step }) => `[${step}]\n${result.stdout}`)
    .join("\n");
  const stderr = processes
    .map(({ result, step }) => `[${step}]\n${result.stderr}`)
    .join("\n");
  const stdoutPath = join(stageRoot, "stdout.log");
  const stderrPath = join(stageRoot, "stderr.log");
  await mkdir(stageRoot, { recursive: true });
  await Promise.all([writeFile(stdoutPath, stdout), writeFile(stderrPath, stderr)]);
  const failed = processes.find(({ result }) => result.exitCode !== 0);
  const receiptBase = {
    commandChain: chain,
    commit: input.arm.commit,
    executionOrder: V073_PROVIDER_STAGE_ORDER,
    generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
    session,
    sourceIdentity: {
      claimCommandTemplateSha256:
        input.arm.execution.claimCommandTemplateSha256,
      claimSourceSha256: input.arm.execution.claimSourceSha256,
      officialSourceSha256: input.arm.execution.officialSourceSha256,
      promptSha256: input.arm.execution.promptSha256,
      reanswerSourceSha256: input.arm.execution.reanswerSourceSha256,
      seedSourceSha256: input.arm.execution.seedSourceSha256,
    },
    stage: input.stage,
    stderr: artifactIdentity(stderrPath, stderr),
    steps: processes.map(({ result, step }) => ({
      exitCode: result.exitCode,
      step,
    })),
    stdout: artifactIdentity(stdoutPath, stdout),
  };
  if (failed !== undefined) {
    await writeJson(input.arm.executionReceiptPath, receiptBase);
    throw new Error(
      `${input.stage} ${failed.step} exited with ${String(failed.result.exitCode)}`,
    );
  }
  const officialProgressPath = join(
    dirname(input.arm.officialSummaryPath),
    "progress.jsonl",
  );
  const [seedRaw, finalRaw, officialRaw, officialProgressRaw] = await Promise.all([
    readFile(input.arm.seedReportPath, "utf8"),
    readFile(input.arm.reportPath, "utf8"),
    readFile(input.arm.officialSummaryPath, "utf8"),
    readFile(officialProgressPath, "utf8"),
  ]);
  const copiedOfficialPath = join(stageRoot, "official-summary.json");
  const copiedProgressPath = join(stageRoot, "official-progress.jsonl");
  await Promise.all([
    writeFile(copiedOfficialPath, officialRaw),
    writeFile(copiedProgressPath, officialProgressRaw),
  ]);
  await writeJson(input.arm.executionReceiptPath, {
    ...receiptBase,
    outputs: {
      finalReport: artifactIdentity(input.arm.reportPath, finalRaw),
      officialProgress: artifactIdentity(copiedProgressPath, officialProgressRaw),
      officialSummary: artifactIdentity(copiedOfficialPath, officialRaw),
      seedReport: artifactIdentity(input.arm.seedReportPath, seedRaw),
    },
  });
  const finalReport = parseV073FormalSmokeReport(finalRaw);
  const officialSummary = parseV073OfficialSummary(officialRaw);
  const officialProgress = parseV073OfficialProgress(officialProgressRaw);
  const reportQuestionIds = new Set(
    finalReport.cases.map((row) => row.questionId),
  );
  if (
    officialProgress.some((row) => !reportQuestionIds.has(row.questionId)) ||
    Math.abs(
      mean(officialProgress.map((row) => Number(row.correct))) -
        officialSummary.overallAccuracy,
    ) > 1e-12
  ) {
    throw new Error("formal provider replay official outputs disagree");
  }
  return {
    finalReport,
    finalReportPath: input.arm.reportPath,
    officialProgress,
    officialProgressPath: copiedProgressPath,
    officialSummary,
    officialSummaryPath: copiedOfficialPath,
    receiptPath: input.arm.executionReceiptPath,
    seedReportPath: input.arm.seedReportPath,
    session,
  };
}

export function buildV073ProviderFreeArgs(input: {
  benchmarkRoot: string;
  concurrency: number;
  outputDir: string;
  runId: string;
}): string[] {
  return [
    "run",
    SEED_RUNNER_PATH,
    "--",
    "--benchmark-root",
    input.benchmarkRoot,
    "--case-id",
    CASE_IDS[0],
    "--case-id",
    CASE_IDS[1],
    "--label-free-ingest",
    "--generalized-fusion",
    "--concurrency",
    String(input.concurrency),
    "--output-dir",
    input.outputDir,
    "--run-id",
    input.runId,
  ];
}

async function runProviderFreeArm(input: {
  benchmarkRoot: string;
  commit: string;
  concurrency: number;
  label: "baseline" | "candidate";
  outputDir: string;
  worktreePath: string;
}): Promise<{
  path: string;
  receiptPath: string;
  report: V073ProtectionSmokeReport;
}> {
  const runId = `v073-provider-free-c${input.concurrency}-${input.label}`;
  const runRoot = join(input.outputDir, "provider-free", runId);
  await assertPathAbsent(runRoot, `${runId} output`);
  const args = buildV073ProviderFreeArgs({
    benchmarkRoot: input.benchmarkRoot,
    concurrency: input.concurrency,
    outputDir: join(input.outputDir, "provider-free"),
    runId,
  });
  const result = await runCapturedProcess({
    args,
    command: "bun",
    cwd: input.worktreePath,
  });
  const receiptRoot = join(input.outputDir, "provider-free", "receipts", runId);
  await mkdir(receiptRoot, { recursive: true });
  const stdoutPath = join(receiptRoot, "stdout.log");
  const stderrPath = join(receiptRoot, "stderr.log");
  await Promise.all([
    writeFile(stdoutPath, result.stdout),
    writeFile(stderrPath, result.stderr),
  ]);
  const receiptPath = join(receiptRoot, "execution-receipt.json");
  const receiptBase = {
    args,
    command: "bun",
    commit: input.commit,
    concurrency: input.concurrency,
    cwd: input.worktreePath,
    exitCode: result.exitCode,
    generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
    label: input.label,
    stderr: artifactIdentity(stderrPath, result.stderr),
    stdout: artifactIdentity(stdoutPath, result.stdout),
  };
  if (result.exitCode !== 0) {
    await writeJson(receiptPath, receiptBase);
    throw new Error(`${runId} exited with ${String(result.exitCode)}`);
  }
  const path = join(runRoot, "smoke-report.json");
  const raw = await readFile(path, "utf8");
  const report = parseV073ProviderFreeReport({
    benchmarkRoot: input.benchmarkRoot,
    concurrency: input.concurrency,
    raw,
  });
  await writeJson(receiptPath, {
    ...receiptBase,
    report: artifactIdentity(path, raw),
  });
  return { path, receiptPath, report };
}

async function runScenario(input: {
  candidateCommit: string;
  outputDir: string;
  worktreePath: string;
}): Promise<{
  failures: number;
  passed: number;
  receiptPath: string;
}> {
  const result = await runCapturedProcess({
    args: ["test", "tests/scenarios"],
    command: "bun",
    cwd: input.worktreePath,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  const passed = Number(output.match(/\b(\d+)\s+pass\b/u)?.[1] ?? -1);
  const failures = Number(output.match(/\b(\d+)\s+fail\b/u)?.[1] ?? -1);
  const root = join(input.outputDir, "scenario");
  await mkdir(root, { recursive: true });
  const stdoutPath = join(root, "stdout.log");
  const stderrPath = join(root, "stderr.log");
  await Promise.all([
    writeFile(stdoutPath, result.stdout),
    writeFile(stderrPath, result.stderr),
  ]);
  const receiptPath = join(root, "execution-receipt.json");
  await writeJson(receiptPath, {
    args: ["test", "tests/scenarios"],
    candidateCommit: input.candidateCommit,
    command: "bun",
    cwd: input.worktreePath,
    exitCode: result.exitCode,
    failures,
    generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
    passed,
    stderr: artifactIdentity(stderrPath, result.stderr),
    stdout: artifactIdentity(stdoutPath, result.stdout),
  });
  assertV073ScenarioOutcome({
    exitCode: result.exitCode,
    failures,
    passed,
  });
  return { failures, passed, receiptPath };
}

export function assertV073ScenarioOutcome(input: {
  exitCode: number | null;
  failures: number;
  passed: number;
}): void {
  if (input.exitCode !== 0) {
    throw new Error(`scenario replay exited with ${String(input.exitCode)}`);
  }
  if (
    !Number.isSafeInteger(input.failures) ||
    input.failures < 0 ||
    !Number.isSafeInteger(input.passed) ||
    input.passed < 0
  ) {
    throw new Error("scenario replay counts are invalid");
  }
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function providerPointDeltas(
  baseline: ProviderStageResult,
  candidate: ProviderStageResult,
): NonNullable<V073ReplacementProtectionInput["providerReplay"]["pointDeltas"]> {
  return {
    evidenceRecall:
      mean(candidate.finalReport.cases.map((row) => row.evidenceRecall)) -
      mean(baseline.finalReport.cases.map((row) => row.evidenceRecall)),
    officialScore:
      candidate.officialSummary.overallAccuracy -
      baseline.officialSummary.overallAccuracy,
    strictAnswerScore:
      mean(candidate.finalReport.cases.map((row) => row.answerTokenF1)) -
      mean(baseline.finalReport.cases.map((row) => row.answerTokenF1)),
  };
}

export function officialQuestionTransitions(
  baseline: readonly OfficialProgressRow[],
  candidate: readonly OfficialProgressRow[],
): V073ReplacementProtectionInput["questionTransitions"] {
  const candidateByQuestion = new Map(
    candidate.map((row) => [row.questionId, row.correct]),
  );
  if (
    baseline.length !== candidate.length ||
    new Set(baseline.map((row) => row.questionId)).size !== baseline.length ||
    candidateByQuestion.size !== candidate.length ||
    baseline.some((row) => !candidateByQuestion.has(row.questionId))
  ) {
    throw new Error("formal provider replay question identities must match");
  }
  let improved = 0;
  let regressed = 0;
  for (const baselineRow of baseline) {
    const candidateCorrect = candidateByQuestion.get(baselineRow.questionId)!;
    if (!baselineRow.correct && candidateCorrect) {
      improved += 1;
    } else if (baselineRow.correct && !candidateCorrect) {
      regressed += 1;
    }
  }
  return { improved, regressed, total: baseline.length };
}

function replaySession(stats: ProviderTapeSessionStats): V073ProviderReplaySession {
  return {
    coalesced: stats.coalesced,
    hits: stats.hits,
    liveRequests: stats.liveRequests,
    misses: stats.misses,
    mode: stats.mode,
    requestFingerprintMultisetSha256: stats.requestFingerprintMultisetSha256,
    requests: stats.requests,
    targetCounts: stats.targetCounts,
    tapeSha256: stats.tapeSha256,
  };
}

async function trackedArtifact(path: string): Promise<ArtifactIdentity> {
  const resolved = resolve(path);
  const trackedPath = relative(process.cwd(), resolved);
  if (trackedPath.startsWith("..")) {
    throw new Error("replacement protection artifacts must stay inside the repository");
  }
  return artifactIdentity(trackedPath, await readFile(resolved, "utf8"));
}

async function runGate(options: V073ReplacementGateCliOptions): Promise<void> {
  if (Bun.version !== REQUIRED_BUN_VERSION) {
    throw new Error(`replacement protection requires Bun ${REQUIRED_BUN_VERSION}`);
  }
  const baselineWorktree = resolve(options.baselineWorktree);
  const candidateWorktree = resolve(options.candidateWorktree);
  const benchmarkRoot = resolve(options.benchmarkRoot);
  const outputDir = resolve(options.outputDir);
  const reportPath = resolve(PROTECTION_ARTIFACT);
  if (baselineWorktree === candidateWorktree) {
    throw new Error("baseline and candidate detached checkouts must differ");
  }
  if (outputDir !== resolve(EVIDENCE_ROOT)) {
    throw new Error(`replacement protection output must be ${EVIDENCE_ROOT}`);
  }
  await Promise.all([
    assertPathAbsent(outputDir, "replacement protection evidence root"),
    assertPathAbsent(reportPath, "replacement protection artifact"),
  ]);
  const [
    baselineProvenance,
    candidateProvenance,
    benchmarkBytes,
    baselineHarness,
    candidateHarness,
  ] =
    await Promise.all([
      worktreeProvenance(baselineWorktree),
      worktreeProvenance(candidateWorktree),
      readFile(join(benchmarkRoot, "cases.json")),
      measurementHarness(baselineWorktree),
      measurementHarness(candidateWorktree),
    ]);
  assertCleanDetached(baselineProvenance, BASELINE_COMMIT, "baseline");
  assertCleanDetached(candidateProvenance, null, "candidate");
  if (JSON.stringify(baselineHarness) !== JSON.stringify(candidateHarness)) {
    throw new Error("baseline and candidate measurement harness bytes must match");
  }
  if (
    benchmarkBytes.byteLength !== BENCHMARK_ROOT_BYTES ||
    sha256(benchmarkBytes) !== BENCHMARK_ROOT_SHA256
  ) {
    throw new Error("LoCoMo benchmark root does not match the preregistration");
  }
  const providers = {
    assisted: requiredProvider("GOODMEMORY_ASSISTED_EXTRACTOR"),
    embedding: requiredProvider("GOODMEMORY_EMBEDDING"),
    eval: requiredProvider("GOODMEMORY_EVAL"),
    judge: requiredProvider("GOODMEMORY_JUDGE"),
    reranking: requiredProvider("GOODMEMORY_RERANKING"),
  };
  assertProviderIdentities(providers);
  await mkdir(outputDir, { recursive: true });
  const manifestPath = join(outputDir, "manifest.json");
  await writeJson(manifestPath, {
    baseline: { ...baselineProvenance, worktreePath: baselineWorktree },
    benchmark: {
      bytes: benchmarkBytes.byteLength,
      fingerprint: BENCHMARK_FINGERPRINT,
      root: benchmarkRoot,
      sha256: sha256(benchmarkBytes),
    },
    candidate: { ...candidateProvenance, worktreePath: candidateWorktree },
    generatedBy: "scripts/run-v0-7-3-replacement-protection-gate.ts",
    measurementHarness: baselineHarness,
    protocol: {
      claimCommandTemplateSha256:
        deriveV073ClaimCommandTemplateSha256(
          await readFile(join(candidateWorktree, CLAIM_RECIPE_PATH), "utf8"),
        ),
      formalNetworkOnMiss: false,
      hardRegressionLimit: 0.01,
      promptSha256: deriveV073PromptSha256(),
      providerFreeConcurrency: [1, 40],
      signTestAlpha: 0.05,
      tapeRequestIdentity:
        "sha256(logical-target + method + path/query + canonical-json-body + semantic-headers)",
    },
    providers,
    schemaVersion: 2,
  });

  const [providerFreeC1Baseline, providerFreeC1Candidate] = await Promise.all([
    runProviderFreeArm({
      benchmarkRoot,
      commit: baselineProvenance.commit,
      concurrency: 1,
      label: "baseline",
      outputDir,
      worktreePath: baselineWorktree,
    }),
    runProviderFreeArm({
      benchmarkRoot,
      commit: candidateProvenance.commit,
      concurrency: 1,
      label: "candidate",
      outputDir,
      worktreePath: candidateWorktree,
    }),
  ]);
  const [providerFreeC40Baseline, providerFreeC40Candidate, scenario] =
    await Promise.all([
      runProviderFreeArm({
        benchmarkRoot,
        commit: baselineProvenance.commit,
        concurrency: 40,
        label: "baseline",
        outputDir,
        worktreePath: baselineWorktree,
      }),
      runProviderFreeArm({
        benchmarkRoot,
        commit: candidateProvenance.commit,
        concurrency: 40,
        label: "candidate",
        outputDir,
        worktreePath: candidateWorktree,
      }),
      runScenario({
        candidateCommit: candidateProvenance.commit,
        outputDir,
        worktreePath: candidateWorktree,
      }),
    ]);

  const tapeTargets = {
    assisted: providers.assisted.gateway,
    embedding: providers.embedding.gateway,
    eval: providers.eval.gateway,
    judge: providers.judge.gateway,
    reranking: providers.reranking.gateway,
  };
  const discoveryProxy = createProviderResponseTapeProxy({ targets: tapeTargets });
  let baselineDiscovery: ProviderStageResult;
  let candidateDiscovery: ProviderStageResult;
  try {
    const baselineDiscoveryArm = await buildStageArm({
      benchmarkRoot,
      commit: baselineProvenance.commit,
      outputDir,
      providers,
      stage: "baseline-discovery",
      worktreePath: baselineWorktree,
    });
    baselineDiscovery = await runProviderStage({
      ...baselineDiscoveryArm,
      liveOnMiss: true,
      mode: "prefetch",
      proxy: discoveryProxy,
      stage: "baseline-discovery",
    });
    const candidateDiscoveryArm = await buildStageArm({
      benchmarkRoot,
      commit: candidateProvenance.commit,
      outputDir,
      providers,
      stage: "candidate-discovery",
      worktreePath: candidateWorktree,
    });
    candidateDiscovery = await runProviderStage({
      ...candidateDiscoveryArm,
      liveOnMiss: true,
      mode: "prefetch",
      proxy: discoveryProxy,
      stage: "candidate-discovery",
    });
    const tapeRaw = serializeProviderResponseTape(discoveryProxy.snapshot());
    const tapePath = join(outputDir, "provider-response-tape.json");
    await writeAtomic(tapePath, tapeRaw);
  } finally {
    discoveryProxy.stop();
  }

  const tapePath = join(outputDir, "provider-response-tape.json");
  const tapeRaw = await readFile(tapePath, "utf8");
  const frozenTape = parseProviderResponseTape(tapeRaw);
  const replayProxy = createProviderResponseTapeProxy({
    initialTape: frozenTape,
    targets: tapeTargets,
  });
  let baselineFormal: ProviderStageResult;
  let candidateFormal: ProviderStageResult;
  try {
    const baselineFormalArm = await buildStageArm({
      benchmarkRoot,
      commit: baselineProvenance.commit,
      outputDir,
      providers,
      stage: "baseline-formal",
      worktreePath: baselineWorktree,
    });
    baselineFormal = await runProviderStage({
      ...baselineFormalArm,
      liveOnMiss: false,
      mode: "replay",
      proxy: replayProxy,
      stage: "baseline-formal",
    });
    const candidateFormalArm = await buildStageArm({
      benchmarkRoot,
      commit: candidateProvenance.commit,
      outputDir,
      providers,
      stage: "candidate-formal",
      worktreePath: candidateWorktree,
    });
    candidateFormal = await runProviderStage({
      ...candidateFormalArm,
      liveOnMiss: false,
      mode: "replay",
      proxy: replayProxy,
      stage: "candidate-formal",
    });
  } finally {
    replayProxy.stop();
  }

  const tapeSha256 = sha256(tapeRaw);
  const protocolInput: V073ReplacementProtectionInput = {
    baselineCommit: baselineProvenance.commit,
    candidateCommit: candidateProvenance.commit,
    candidatePromptSha256: deriveV073PromptSha256(),
    deterministicArms: [
      {
        baseline: providerFreeC1Baseline.report,
        candidate: providerFreeC1Candidate.report,
        concurrency: 1,
      },
      {
        baseline: providerFreeC40Baseline.report,
        candidate: providerFreeC40Candidate.report,
        concurrency: 40,
      },
    ],
    providerReplay: {
      baselineExecutionFailures: baselineFormal.finalReport.executionFailures,
      baselineJudgeFailures: baselineFormal.officialSummary.judgeFailures,
      candidateExecutionFailures: candidateFormal.finalReport.executionFailures,
      candidateJudgeFailures: candidateFormal.officialSummary.judgeFailures,
      discovery: {
        baseline: replaySession(baselineDiscovery.session),
        candidate: replaySession(candidateDiscovery.session),
      },
      formal: {
        baseline: replaySession(baselineFormal.session),
        candidate: replaySession(candidateFormal.session),
      },
      pointDeltas: providerPointDeltas(baselineFormal, candidateFormal),
      tapeEntryCount: frozenTape.entries.length,
      tapeSha256,
      tapeTargetCounts: Object.fromEntries(
        [...new Set(frozenTape.entries.map((entry) => entry.request.targetId))]
          .sort()
          .map((targetId) => [
            targetId,
            frozenTape.entries.filter((entry) => entry.request.targetId === targetId).length,
          ]),
      ),
    },
    questionTransitions: officialQuestionTransitions(
      baselineFormal.officialProgress,
      candidateFormal.officialProgress,
    ),
    scenarioReplay: {
      failures: scenario.failures,
      passed: scenario.passed,
    },
  };
  const protocolInputPath = join(outputDir, "protocol-input.json");
  await writeJson(protocolInputPath, protocolInput);
  const evaluated = evaluateV073ReplacementProtection(protocolInput);
  const [baselineAfter, candidateAfter] = await Promise.all([
    worktreeProvenance(baselineWorktree),
    worktreeProvenance(candidateWorktree),
  ]);
  assertCleanDetached(baselineAfter, baselineProvenance.commit, "baseline");
  assertCleanDetached(candidateAfter, candidateProvenance.commit, "candidate");
  const artifacts = {
    manifest: await trackedArtifact(manifestPath),
    protocolInput: await trackedArtifact(protocolInputPath),
    providerFree: {
      c1Baseline: await trackedArtifact(providerFreeC1Baseline.path),
      c1BaselineReceipt: await trackedArtifact(providerFreeC1Baseline.receiptPath),
      c1Candidate: await trackedArtifact(providerFreeC1Candidate.path),
      c1CandidateReceipt: await trackedArtifact(providerFreeC1Candidate.receiptPath),
      c40Baseline: await trackedArtifact(providerFreeC40Baseline.path),
      c40BaselineReceipt: await trackedArtifact(providerFreeC40Baseline.receiptPath),
      c40Candidate: await trackedArtifact(providerFreeC40Candidate.path),
      c40CandidateReceipt: await trackedArtifact(providerFreeC40Candidate.receiptPath),
    },
    providerReplay: {
      baselineDiscoveryReceipt: await trackedArtifact(baselineDiscovery.receiptPath),
      baselineFormalOfficial: await trackedArtifact(baselineFormal.officialSummaryPath),
      baselineFormalProgress: await trackedArtifact(baselineFormal.officialProgressPath),
      baselineFormalReport: await trackedArtifact(baselineFormal.finalReportPath),
      baselineFormalReceipt: await trackedArtifact(baselineFormal.receiptPath),
      candidateDiscoveryReceipt: await trackedArtifact(candidateDiscovery.receiptPath),
      candidateFormalOfficial: await trackedArtifact(candidateFormal.officialSummaryPath),
      candidateFormalProgress: await trackedArtifact(candidateFormal.officialProgressPath),
      candidateFormalReport: await trackedArtifact(candidateFormal.finalReportPath),
      candidateFormalReceipt: await trackedArtifact(candidateFormal.receiptPath),
      tape: await trackedArtifact(tapePath),
    },
    scenarioReceipt: await trackedArtifact(scenario.receiptPath),
  };
  const report: V073ReplacementProtectionReport & { artifacts: typeof artifacts } = {
    ...evaluated,
    artifacts,
  };
  await writeJson(reportPath, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.releaseAllowed) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await runGate(parseV073ReplacementGateCliOptions(Bun.argv));
}
