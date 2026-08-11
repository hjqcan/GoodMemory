import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { resolveCliFlagValueStrict } from "./cli-options";
import {
  assertOfficialRescoreSummaryValid,
  parseOfficialRescoreProgressLine,
} from "./rescore-official-protocols";
import {
  buildV073FullClaimCommandChain,
  deriveV073ClaimCommandTemplateSha256,
  deriveV073PromptSha256,
} from "./run-v0-7-3-lifecycle-protection-gate";
import type {
  V073CommandInvocation,
  V073FullClaimPlanInput,
  V073PairedCommandChain,
} from "./run-v0-7-3-lifecycle-protection-gate";

const REQUIRED_BUN_VERSION = "1.3.14";
const RELEASE_VERSION = "0.7.3";
const CLAIM_RECIPE_PATH = "benchmark-claims/locomo.json";
const SEED_RUNNER_SOURCE_PATH = "scripts/run-phase-65-locomo-smoke.ts";
const REANSWER_RUNNER_SOURCE_PATH =
  "scripts/reanswer-phase-65-locomo-report.ts";
const OFFICIAL_RUNNER_SOURCE_PATH = "scripts/rescore-official-protocols.ts";
const PROJECTION_PATH =
  "benchmark-claims/evidence/locomo-v0.7.3-current.json";
const EVIDENCE_ROOT =
  "reports/release/v0.7/v0.7.3-locomo-claim-evidence";
export const V073_FULL_CLAIM_PROTOCOL2_PREREGISTRATION_PATH =
  "reports/release/v0.7/v0.7.3-full-claim-protocol2-preregistration.json";
export const V073_FULL_CLAIM_PROTOCOL2_SENTINEL_PATH =
  "reports/release/v0.7/v0.7.3-full-claim-protocol2-attempt-consumed.json";
const LIFECYCLE_PROTECTION_PATH =
  "reports/release/v0.7/v0.7.3-lifecycle-protection.json";
const MAX_SEED_LAUNCHES = 2;
const SEED_TIMEOUT_MESSAGE =
  "OpenAI-compatible gateway timeout after 120000ms.";
const CANONICAL_BENCHMARK_TOKEN = "@locomo-full10-root";
const PROVIDER_ENV_PREFIXES = [
  "GOODMEMORY_ASSISTED_EXTRACTOR",
  "GOODMEMORY_EMBEDDING",
  "GOODMEMORY_EVAL",
  "GOODMEMORY_JUDGE",
  "GOODMEMORY_RERANKING",
] as const;
const PROVIDER_ENV_SUFFIXES = [
  "API_KEY",
  "BASE_URL",
  "MODEL",
  "PROVIDER",
] as const;
const CHILD_OS_ENV_NAMES = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
] as const;
const SEED_ATTEMPT_ONE_EVIDENCE_RAWS = {
  extractionCache: "seed-attempt-1-extraction-cache.jsonl",
  progress: "seed-attempt-1-live-progress.jsonl",
  report: "seed-attempt-1-smoke-report.json",
} as const;
const FINAL_SEED_EVIDENCE_RAWS = {
  extractionCache: "seed-extraction-cache.jsonl",
  progress: "seed-live-progress.jsonl",
  report: "seed-smoke-report.json",
} as const;
const OFFICIAL_EVIDENCE_RAWS = {
  progress: "official-progress.jsonl",
  summary: "official-rescore-summary.json",
} as const;
const EXPECTED_BENCHMARK_ROOT_BYTES = 2_490_457;
const EXPECTED_BENCHMARK_ROOT_SHA256 =
  "e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28";
const EXPECTED_BENCHMARK_FINGERPRINT =
  "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd";
const EXPECTED_EXTRACTION_CACHE_KEY_SET_SHA256 =
  "30fde28c5e2450365d8cc3d90a80f72aa900691151f4d1127e0a4f3c8a520f4f";
const EXPECTED_EXTRACTION_CACHE_KEY_CASE_MAP_SHA256 =
  "24732a6040c70d52999a18b9d95d72e663a883aa7c5524fc5ee8b4187611e03b";
const EXPECTED_CASE_SESSION_COUNTS = {
  "locomo-conv-26": 19,
  "locomo-conv-30": 19,
  "locomo-conv-41": 32,
  "locomo-conv-42": 29,
  "locomo-conv-43": 29,
  "locomo-conv-44": 28,
  "locomo-conv-47": 31,
  "locomo-conv-48": 30,
  "locomo-conv-49": 25,
  "locomo-conv-50": 30,
} as const;
const EXPECTED_CASE_IDS = [
  "locomo-conv-26",
  "locomo-conv-30",
  "locomo-conv-41",
  "locomo-conv-42",
  "locomo-conv-43",
  "locomo-conv-44",
  "locomo-conv-47",
  "locomo-conv-48",
  "locomo-conv-49",
  "locomo-conv-50",
] as const;
const EXPECTED_CATEGORY_COUNTS = {
  multi_hop: 282,
  open_domain: 96,
  single_hop: 841,
  temporal: 321,
} as const;
export const V073_FULL_LOCOMO_CASE_QUESTION_COUNTS = {
  "locomo-conv-26": 152,
  "locomo-conv-30": 81,
  "locomo-conv-41": 152,
  "locomo-conv-42": 199,
  "locomo-conv-43": 178,
  "locomo-conv-44": 123,
  "locomo-conv-47": 150,
  "locomo-conv-48": 191,
  "locomo-conv-49": 156,
  "locomo-conv-50": 158,
} as const;
export const V073_FULL_LOCOMO_QUESTION_SELECTION_SHA256 =
  "81dbd4ea08eb6ffffc854500522983977984788662ed17e71e7caee9ec726b7b";

export interface ArtifactIdentity {
  bytes: number;
  path: string;
  sha256: string;
}

interface WorktreeProvenance {
  headCommit: string;
  statusPorcelain: string;
}

export interface StagedV073FullClaimPublication {
  evidenceRootPath: string;
  fileNames: string[];
  partialEvidenceRootPath: string;
  partialProjectionPath: string;
  preservedRaws: Readonly<Record<string, string>>;
  projectionPath: string;
}

export interface CapturedProcess {
  exitCode: number | null;
  stderr: string;
  stdout: string;
}

export interface V073FullClaimProtocol2Identity {
  finalRunId: string;
  namespace: string;
  officialRunId: string;
  outputRoot: string;
  seedRunId: string;
}

export interface V073FullClaimProtocol2Preregistration
  extends V073FullClaimProtocol2Identity {
  benchmark: {
    bytes: number;
    fingerprint: string;
    sha256: string;
  };
  generatedAt: string;
  generatedBy: "v0.7.3-full-locomo-claim-protocol2-preregistration";
  lifecycleCandidateCommit: string;
  lifecycleProtection: ArtifactIdentity;
  maxSeedLaunches: 2;
  protocolCandidateCommit: string;
  protocolVersion: 2;
  sentinelPath: typeof V073_FULL_CLAIM_PROTOCOL2_SENTINEL_PATH;
}

export interface V073FullClaimProtocol2Sentinel {
  generatedAt: string;
  generatedBy: "scripts/run-v0-7-3-full-locomo-claim.ts";
  lifecycleCandidateCommit: string;
  maxSeedLaunches: 2;
  namespace: string;
  protocolCandidateCommit: string;
  protocolVersion: 2;
  releaseCommit: string;
  state: "consumed";
}

export interface SeedArtifactRaws {
  extractionCacheRaw: string;
  progressRaw: string;
  reportRaw: string;
}

export interface AvailableSeedArtifactRaws {
  extractionCacheRaw?: string;
  progressRaw?: string;
  reportRaw?: string;
}

export interface V073SeedAttemptReceipt {
  attempt: 1 | 2;
  command: V073CommandInvocation;
  exitCode: 0;
  extractionCache: ArtifactIdentity;
  failedCaseId: string | null;
  progress: ArtifactIdentity;
  recoveryClassification:
    | "eligible-single-case-seed-timeout"
    | "failure-free"
    | "failure-free-after-single-resume";
  report: ArtifactIdentity;
}

export function deriveV073FullClaimProtocol2Identity(
  protocolCandidateCommit: string,
): V073FullClaimProtocol2Identity {
  if (!/^[0-9a-f]{40}$/u.test(protocolCandidateCommit)) {
    throw new Error("full protocol candidate commit must be a 40-character SHA");
  }
  const namespace =
    `v073-${protocolCandidateCommit.slice(0, 8)}-full1540-protocol2`;
  return {
    finalRunId: `${namespace}-final`,
    namespace,
    officialRunId: `${namespace}-official-gpt55`,
    outputRoot: `reports/eval/research/${namespace}`,
    seedRunId: `${namespace}-seed`,
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function artifactIdentity(path: string, raw: string): ArtifactIdentity {
  return {
    bytes: Buffer.byteLength(raw, "utf8"),
    path,
    sha256: sha256(raw),
  };
}

export function buildV073TerminalClaimReceipt(input: {
  finalReportRaw?: string;
  generatedAt: string;
  lifecycleCandidateCommit: string;
  officialProgressRaw?: string;
  officialSummaryRaw?: string;
  protocolCandidateCommit: string;
  seedAttemptOne?: {
    artifacts: AvailableSeedArtifactRaws;
    classification?: ReturnType<typeof classifyV073SeedAttemptRecovery>;
  };
  seedFinal?: {
    artifacts: AvailableSeedArtifactRaws;
    attempt: 1 | 2;
    classification?: ReturnType<typeof classifyV073SeedAttemptRecovery>;
  };
  seedLaunches: number;
  sentinel: ArtifactIdentity;
  sentinelCommit: string;
  stage: "official-rescore" | "reanswer" | "seed";
  stageInvocation: V073CommandInvocation;
  stageProcess?: CapturedProcess;
  stageSeedAttempt: 1 | 2 | null;
}): string {
  return `${JSON.stringify({
    commandInvocationSha256: sha256(JSON.stringify(input.stageInvocation)),
    failureClassification: "stage-terminal",
    finalReport: input.finalReportRaw !== undefined
      ? artifactIdentity(
          `${EVIDENCE_ROOT}/final-smoke-report.json`,
          input.finalReportRaw,
        )
      : null,
    generatedAt: input.generatedAt,
    generatedBy: "v0.7.3-full-locomo-claim-terminal",
    lifecycleCandidateCommit: input.lifecycleCandidateCommit,
    officialProgress: input.officialProgressRaw !== undefined
      ? artifactIdentity(
          `${EVIDENCE_ROOT}/${OFFICIAL_EVIDENCE_RAWS.progress}`,
          input.officialProgressRaw,
        )
      : null,
    officialSummary: input.officialSummaryRaw !== undefined
      ? artifactIdentity(
          `${EVIDENCE_ROOT}/${OFFICIAL_EVIDENCE_RAWS.summary}`,
          input.officialSummaryRaw,
        )
      : null,
    outcome: "terminal",
    protocolCandidateCommit: input.protocolCandidateCommit,
    protocolVersion: 2,
    schemaVersion: 1,
    seedAttemptOne: input.seedAttemptOne
      ? {
          extractionCache:
            input.seedAttemptOne.artifacts.extractionCacheRaw !== undefined
              ? artifactIdentity(
                  `${EVIDENCE_ROOT}/${SEED_ATTEMPT_ONE_EVIDENCE_RAWS.extractionCache}`,
                  input.seedAttemptOne.artifacts.extractionCacheRaw,
                )
              : null,
          failedCaseId: input.seedAttemptOne.classification?.failedCaseId ?? null,
          progress: input.seedAttemptOne.artifacts.progressRaw !== undefined
            ? artifactIdentity(
                `${EVIDENCE_ROOT}/${SEED_ATTEMPT_ONE_EVIDENCE_RAWS.progress}`,
                input.seedAttemptOne.artifacts.progressRaw,
              )
            : null,
          recoveryClassification:
            input.seedAttemptOne.classification?.recoveryClassification ??
              "unclassified",
          report: input.seedAttemptOne.artifacts.reportRaw !== undefined
            ? artifactIdentity(
                `${EVIDENCE_ROOT}/${SEED_ATTEMPT_ONE_EVIDENCE_RAWS.report}`,
                input.seedAttemptOne.artifacts.reportRaw,
              )
            : null,
        }
      : null,
    seedFinal: input.seedFinal
      ? {
          attempt: input.seedFinal.attempt,
          extractionCache:
            input.seedFinal.artifacts.extractionCacheRaw !== undefined
              ? artifactIdentity(
                  `${EVIDENCE_ROOT}/${FINAL_SEED_EVIDENCE_RAWS.extractionCache}`,
                  input.seedFinal.artifacts.extractionCacheRaw,
                )
              : null,
          progress: input.seedFinal.artifacts.progressRaw !== undefined
            ? artifactIdentity(
                `${EVIDENCE_ROOT}/${FINAL_SEED_EVIDENCE_RAWS.progress}`,
                input.seedFinal.artifacts.progressRaw,
              )
            : null,
          recoveryClassification:
            input.seedFinal.classification?.recoveryClassification ??
              "unclassified",
          report: input.seedFinal.artifacts.reportRaw !== undefined
            ? artifactIdentity(
                `${EVIDENCE_ROOT}/${FINAL_SEED_EVIDENCE_RAWS.report}`,
                input.seedFinal.artifacts.reportRaw,
              )
            : null,
        }
      : null,
    seedLaunches: input.seedLaunches,
    sentinel: input.sentinel,
    sentinelCommit: input.sentinelCommit,
    stage: input.stage,
    stageResult: {
      exitCode: input.stageProcess?.exitCode ?? null,
      seedAttempt: input.stageSeedAttempt,
    },
  }, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function phase65HashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function deriveV073ExpectedExtractionCache(input: {
  configTag: string;
  rootRaw: string | Uint8Array;
}): Map<string, string> {
  if (input.configTag !== "gpt-5.6-terra") {
    throw new Error("full claim extraction cache requires the frozen eval model");
  }
  const parsed = JSON.parse(
    typeof input.rootRaw === "string"
      ? input.rootRaw
      : Buffer.from(input.rootRaw).toString("utf8"),
  ) as unknown;
  const cases = isRecord(parsed) ? parsed.cases : parsed;
  if (!Array.isArray(cases) || cases.length !== EXPECTED_CASE_IDS.length) {
    throw new Error("frozen LoCoMo root must contain the expected ten cases");
  }
  const expectedCaseIds = new Set(EXPECTED_CASE_IDS);
  const seenCaseIds = new Set<string>();
  const result = new Map<string, string>();
  for (const value of cases) {
    if (
      !isRecord(value) ||
      typeof value.caseId !== "string" ||
      !expectedCaseIds.has(value.caseId as (typeof EXPECTED_CASE_IDS)[number]) ||
      seenCaseIds.has(value.caseId) ||
      !Array.isArray(value.turns)
    ) {
      throw new Error("frozen LoCoMo root case identity is invalid");
    }
    seenCaseIds.add(value.caseId);
    const sessions = new Map<string, Array<Record<string, unknown>>>();
    for (const turn of value.turns) {
      if (
        !isRecord(turn) ||
        typeof turn.diaId !== "string" ||
        typeof turn.speaker !== "string" ||
        typeof turn.content !== "string"
      ) {
        throw new Error("frozen LoCoMo root contains an invalid turn");
      }
      const sessionKey = turn.diaId.split(":")[0] ?? turn.diaId;
      const session = sessions.get(sessionKey) ?? [];
      session.push(turn);
      sessions.set(sessionKey, session);
    }
    for (const session of sessions.values()) {
      const messages = session.map((turn) => ({
        content: `${String(turn.speaker)}: ${String(turn.content)}`,
        role: "user",
      }));
      const key = `${input.configTag}:${phase65HashString(JSON.stringify(messages))}`;
      if (result.has(key)) {
        throw new Error("frozen LoCoMo extraction cache keys are not unique");
      }
      result.set(key, value.caseId);
    }
    if (
      sessions.size !== EXPECTED_CASE_SESSION_COUNTS[
        value.caseId as keyof typeof EXPECTED_CASE_SESSION_COUNTS
      ]
    ) {
      throw new Error("frozen LoCoMo root case has an unexpected session count");
    }
  }
  if (seenCaseIds.size !== EXPECTED_CASE_IDS.length || result.size !== 272) {
    throw new Error("frozen LoCoMo root must contain exactly 272 sessions");
  }
  return result;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the full LoCoMo claim launch`);
  }
  return value;
}

function provider(prefix: string): {
  gateway: string;
  model: string;
  provider: string;
} {
  requiredEnvironment(`${prefix}_API_KEY`);
  return {
    gateway: requiredEnvironment(`${prefix}_BASE_URL`),
    model: requiredEnvironment(`${prefix}_MODEL`),
    provider: requiredEnvironment(`${prefix}_PROVIDER`),
  };
}

export function buildV073FrozenProviderChildEnvironment(input: {
  commandEnvironment: Readonly<Record<string, string>>;
  hostEnvironment: Readonly<Record<string, string | undefined>>;
}): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of CHILD_OS_ENV_NAMES) {
    const value = input.hostEnvironment[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  for (const prefix of PROVIDER_ENV_PREFIXES) {
    for (const suffix of PROVIDER_ENV_SUFFIXES) {
      const name = `${prefix}_${suffix}`;
      const value = input.hostEnvironment[name]?.trim();
      if (!value) {
        throw new Error(`${name} is required for the full LoCoMo claim launch`);
      }
      environment[name] = value;
    }
  }
  return { ...environment, ...input.commandEnvironment };
}

export function withV073NoEnvFileCommandChain(
  chain: V073PairedCommandChain,
): V073PairedCommandChain {
  const stages = [
    {
      alias: "eval:phase-65-smoke",
      invocation: chain.seedSmoke,
      sourcePath: SEED_RUNNER_SOURCE_PATH,
    },
    {
      alias: "eval:phase-65-reanswer-report",
      invocation: chain.reanswer,
      sourcePath: REANSWER_RUNNER_SOURCE_PATH,
    },
    {
      alias: "eval:official-rescore",
      invocation: chain.officialRescore,
      sourcePath: OFFICIAL_RUNNER_SOURCE_PATH,
    },
  ] as const;
  for (const { alias, invocation, sourcePath } of stages) {
    const args = invocation.args[0] === "--no-env-file"
      ? invocation.args.slice(1)
      : invocation.args;
    if (args.includes("--no-env-file")) {
      throw new Error("full claim --no-env-file must be the first Bun argument");
    }
    if (
      args[0] !== "run" ||
      (args[1] !== sourcePath && args[1] !== alias)
    ) {
      throw new Error(`full claim stage must directly execute ${sourcePath}`);
    }
    invocation.args = ["--no-env-file", "run", sourcePath, ...args.slice(2)];
  }
  return chain;
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
      env: input.environment ?? process.env,
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

async function worktreeProvenance(path: string): Promise<WorktreeProvenance> {
  const [head, status] = await Promise.all([
    runCapturedProcess({
      args: ["rev-parse", "HEAD"],
      command: "git",
      cwd: path,
      streamOutput: false,
    }),
    runCapturedProcess({
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
      command: "git",
      cwd: path,
      streamOutput: false,
    }),
  ]);
  if (head.exitCode !== 0 || status.exitCode !== 0) {
    throw new Error(`cannot inspect worktree provenance at ${path}`);
  }
  return {
    headCommit: head.stdout.trim(),
    statusPorcelain: status.stdout,
  };
}

async function currentGitBranch(path: string): Promise<string> {
  const result = await runCapturedProcess({
    args: ["symbolic-ref", "--short", "HEAD"],
    command: "git",
    cwd: path,
    streamOutput: false,
  });
  if (result.exitCode !== 0) {
    throw new Error(`cannot resolve the current branch at ${path}`);
  }
  return result.stdout.trim();
}

export async function assertV073GitCheckoutDetached(
  path: string,
  label: string,
): Promise<void> {
  const result = await runCapturedProcess({
    args: ["symbolic-ref", "-q", "HEAD"],
    command: "git",
    cwd: path,
    streamOutput: false,
  });
  if (result.exitCode === 0) {
    throw new Error(`${label} worktree must be detached`);
  }
  if (result.exitCode !== 1) {
    throw new Error(`cannot inspect detached checkout at ${path}`);
  }
}

async function assertGitAncestor(input: {
  ancestor: string;
  descendant: string;
  repository: string;
}): Promise<void> {
  const result = await runCapturedProcess({
    args: ["merge-base", "--is-ancestor", input.ancestor, input.descendant],
    command: "git",
    cwd: input.repository,
    streamOutput: false,
  });
  if (result.exitCode !== 0) {
    throw new Error("protocol candidate must be an ancestor of release main");
  }
}

function assertClean(provenance: WorktreeProvenance, label: string): void {
  if (!/^[0-9a-f]{40}$/u.test(provenance.headCommit)) {
    throw new Error(`${label} does not have a full commit identity`);
  }
  if (provenance.statusPorcelain !== "") {
    throw new Error(`${label} worktree must be clean`);
  }
}

export function assertV073CandidateProvenanceUnchanged(input: {
  current: WorktreeProvenance;
  expected: WorktreeProvenance;
  label: string;
}): void {
  assertClean(input.current, input.label);
  if (
    input.current.headCommit !== input.expected.headCommit ||
    input.current.statusPorcelain !== input.expected.statusPorcelain
  ) {
    throw new Error(`${input.label} provenance changed during full claim launch`);
  }
}

export function assertV073EvidencePublicationStatus(input: {
  current: WorktreeProvenance;
  expectedHeadCommit: string;
  fileNames: readonly string[];
}): void {
  const expectedStatus = [
    PROJECTION_PATH,
    ...input.fileNames.map((name) => `${EVIDENCE_ROOT}/${name}`),
  ]
    .sort()
    .map((path) => `?? ${path}`);
  const actualStatus = input.current.statusPorcelain
    .split("\n")
    .filter(Boolean)
    .sort();
  if (
    input.current.headCommit !== input.expectedHeadCommit ||
    !sameJson(actualStatus, expectedStatus)
  ) {
    throw new Error(
      "evidence repository changed outside the expected tracked bundle and projection",
    );
  }
}

async function assertAbsent(path: string, label: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`${label} must not exist before launch: ${path}`);
}

async function readUtf8IfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function assertArtifactIdentity(
  actual: unknown,
  expected: ArtifactIdentity,
  label: string,
): void {
  if (!isRecord(actual) || !sameJson(actual, expected)) {
    throw new Error(`${label} identity does not match preregistered bytes`);
  }
}

async function readV073FullClaimProtocol2Preregistration(input: {
  protocolCandidateCommit: string;
  releaseRepo: string;
}): Promise<{
  lifecycleRaw: string;
  preregistration: V073FullClaimProtocol2Preregistration;
  preregistrationIdentity: ArtifactIdentity;
  preregistrationRaw: string;
}> {
  const preregistrationRaw = await readFile(
    join(input.releaseRepo, V073_FULL_CLAIM_PROTOCOL2_PREREGISTRATION_PATH),
    "utf8",
  );
  const preregistration = parseJsonObject(
    preregistrationRaw,
    "full claim protocol-v2 preregistration",
  );
  const identity = deriveV073FullClaimProtocol2Identity(
    input.protocolCandidateCommit,
  );
  const lifecycleRaw = await readFile(
    join(input.releaseRepo, LIFECYCLE_PROTECTION_PATH),
    "utf8",
  );
  const lifecycle = parseJsonObject(
    lifecycleRaw,
    "v0.7.3 lifecycle protection compact",
  );
  const lifecycleIdentity = artifactIdentity(
    LIFECYCLE_PROTECTION_PATH,
    lifecycleRaw,
  );
  if (
    !sameJson(Object.keys(preregistration).sort(), [
      "benchmark",
      "finalRunId",
      "generatedAt",
      "generatedBy",
      "lifecycleCandidateCommit",
      "lifecycleProtection",
      "maxSeedLaunches",
      "namespace",
      "officialRunId",
      "outputRoot",
      "protocolCandidateCommit",
      "protocolVersion",
      "seedRunId",
      "sentinelPath",
    ].sort()) ||
    preregistration.protocolVersion !== 2 ||
    preregistration.generatedBy !==
      "v0.7.3-full-locomo-claim-protocol2-preregistration" ||
    !Number.isFinite(Date.parse(String(preregistration.generatedAt))) ||
    preregistration.protocolCandidateCommit !== input.protocolCandidateCommit ||
    preregistration.lifecycleCandidateCommit !== lifecycle.candidateCommit ||
    lifecycle.schemaVersion !== 9 ||
    lifecycle.releaseAllowed !== true ||
    lifecycle.fullClaimRerunRequired !== true ||
    !Array.isArray(lifecycle.blockers) ||
    lifecycle.blockers.length !== 0 ||
    preregistration.maxSeedLaunches !== MAX_SEED_LAUNCHES ||
    preregistration.sentinelPath !== V073_FULL_CLAIM_PROTOCOL2_SENTINEL_PATH ||
    preregistration.namespace !== identity.namespace ||
    preregistration.seedRunId !== identity.seedRunId ||
    preregistration.finalRunId !== identity.finalRunId ||
    preregistration.officialRunId !== identity.officialRunId ||
    preregistration.outputRoot !== identity.outputRoot ||
    !isRecord(preregistration.benchmark) ||
    preregistration.benchmark.bytes !== EXPECTED_BENCHMARK_ROOT_BYTES ||
    preregistration.benchmark.sha256 !== EXPECTED_BENCHMARK_ROOT_SHA256 ||
    preregistration.benchmark.fingerprint !== EXPECTED_BENCHMARK_FINGERPRINT
  ) {
    throw new Error("full claim protocol-v2 preregistration is invalid");
  }
  assertArtifactIdentity(
    preregistration.lifecycleProtection,
    lifecycleIdentity,
    "lifecycle protection compact",
  );
  return {
    lifecycleRaw,
    preregistration: preregistration as unknown as V073FullClaimProtocol2Preregistration,
    preregistrationIdentity: artifactIdentity(
      V073_FULL_CLAIM_PROTOCOL2_PREREGISTRATION_PATH,
      preregistrationRaw,
    ),
    preregistrationRaw,
  };
}

export function assertV073SentinelRemoteConfirmation(input: {
  pushExitCode: number | null;
  remoteExitCode: number | null;
  remoteHeadCommit: string;
  sentinelCommit: string;
  sentinelIsRemoteAncestor: boolean | null;
}): void {
  if (
    input.remoteExitCode !== 0 ||
    !/^[0-9a-f]{40}$/u.test(input.remoteHeadCommit) ||
    input.sentinelIsRemoteAncestor === null
  ) {
    throw new Error(
      `cannot confirm whether origin/main consumed the protocol-v2 sentinel after push exit ${String(input.pushExitCode)}`,
    );
  }
  if (
    input.remoteHeadCommit !== input.sentinelCommit &&
    !input.sentinelIsRemoteAncestor
  ) {
    throw new Error("origin/main does not contain the protocol-v2 sentinel commit");
  }
}

export async function consumeV073FullClaimProtocol2Attempt(input: {
  generatedAt?: string;
  protocolCandidateCommit: string;
  releaseCommit: string;
  releaseRepo: string;
}): Promise<{
  lifecycleRaw: string;
  preregistration: V073FullClaimProtocol2Preregistration;
  preregistrationIdentity: ArtifactIdentity;
  preregistrationRaw: string;
  sentinel: V073FullClaimProtocol2Sentinel;
  sentinelCommit: string;
  sentinelIdentity: ArtifactIdentity;
  sentinelRaw: string;
}> {
  if (!/^[0-9a-f]{40}$/u.test(input.releaseCommit)) {
    throw new Error("release commit must be a 40-character SHA");
  }
  const releaseHead = await runCapturedProcess({
    args: ["rev-parse", "HEAD"],
    command: "git",
    cwd: input.releaseRepo,
    streamOutput: false,
  });
  if (
    releaseHead.exitCode !== 0 ||
    releaseHead.stdout.trim() !== input.releaseCommit
  ) {
    throw new Error("release main moved before the protocol-v2 sentinel");
  }
  const preregistered = await readV073FullClaimProtocol2Preregistration(input);
  const remoteBefore = await runCapturedProcess({
    args: ["ls-remote", "--heads", "origin", "refs/heads/main"],
    command: "git",
    cwd: input.releaseRepo,
    streamOutput: false,
  });
  if (
    remoteBefore.exitCode !== 0 ||
    remoteBefore.stdout.split(/\s/u)[0] !== input.releaseCommit
  ) {
    throw new Error("origin/main moved before the protocol-v2 sentinel");
  }
  const pushPreflight = await runCapturedProcess({
    args: ["push", "--dry-run", "origin", "HEAD:refs/heads/main"],
    command: "git",
    cwd: input.releaseRepo,
    streamOutput: false,
  });
  if (pushPreflight.exitCode !== 0) {
    throw new Error("protocol-v2 sentinel push preflight failed");
  }
  const priorSentinel = await runCapturedProcess({
    args: [
      "log",
      "--all",
      "--format=%H",
      "--",
      V073_FULL_CLAIM_PROTOCOL2_SENTINEL_PATH,
    ],
    command: "git",
    cwd: input.releaseRepo,
    streamOutput: false,
  });
  if (priorSentinel.exitCode !== 0 || priorSentinel.stdout.trim() !== "") {
    throw new Error("protocol-v2 sentinel was already consumed in Git history");
  }
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new Error("attempt sentinel generatedAt must be an ISO timestamp");
  }
  const sentinel: V073FullClaimProtocol2Sentinel = {
    generatedAt,
    generatedBy: "scripts/run-v0-7-3-full-locomo-claim.ts",
    lifecycleCandidateCommit:
      preregistered.preregistration.lifecycleCandidateCommit,
    maxSeedLaunches: MAX_SEED_LAUNCHES,
    namespace: preregistered.preregistration.namespace,
    protocolCandidateCommit: input.protocolCandidateCommit,
    protocolVersion: 2,
    releaseCommit: input.releaseCommit,
    state: "consumed",
  };
  const sentinelRaw = `${JSON.stringify(sentinel, null, 2)}\n`;
  await writeFile(
    join(input.releaseRepo, V073_FULL_CLAIM_PROTOCOL2_SENTINEL_PATH),
    sentinelRaw,
    { encoding: "utf8", flag: "wx" },
  );
  const sentinelPath = V073_FULL_CLAIM_PROTOCOL2_SENTINEL_PATH;
  const add = await runCapturedProcess({
    args: ["add", "--", sentinelPath],
    command: "git",
    cwd: input.releaseRepo,
    streamOutput: false,
  });
  const commit = add.exitCode === 0
    ? await runCapturedProcess({
        args: [
          "commit",
          "--quiet",
          "-m",
          "Record v0.7.3 full-claim protocol-v2 attempt",
          "--",
          sentinelPath,
        ],
        command: "git",
        cwd: input.releaseRepo,
        streamOutput: false,
      })
    : null;
  if (add.exitCode !== 0 || commit?.exitCode !== 0) {
    throw new Error("failed to commit the protocol-v2 sentinel on release main");
  }
  const committed = await worktreeProvenance(input.releaseRepo);
  const diff = await runCapturedProcess({
    args: ["diff", "--name-only", input.releaseCommit, committed.headCommit],
    command: "git",
    cwd: input.releaseRepo,
    streamOutput: false,
  });
  const parent = await runCapturedProcess({
    args: ["rev-parse", `${committed.headCommit}^`],
    command: "git",
    cwd: input.releaseRepo,
    streamOutput: false,
  });
  if (
    !/^[0-9a-f]{40}$/u.test(committed.headCommit) ||
    committed.statusPorcelain !== "" ||
    diff.exitCode !== 0 ||
    diff.stdout !== `${sentinelPath}\n` ||
    parent.exitCode !== 0 ||
    parent.stdout.trim() !== input.releaseCommit
  ) {
    throw new Error("sentinel commit must differ from release main only by the sentinel");
  }
  const push = await runCapturedProcess({
    args: ["push", "origin", `${committed.headCommit}:refs/heads/main`],
    command: "git",
    cwd: input.releaseRepo,
    streamOutput: false,
  });
  const remote = await runCapturedProcess({
    args: ["ls-remote", "--heads", "origin", "refs/heads/main"],
    command: "git",
    cwd: input.releaseRepo,
    streamOutput: false,
  });
  const remoteHeadCommit = remote.stdout.split(/\s/u)[0] ?? "";
  let sentinelIsRemoteAncestor: boolean | null =
    remote.exitCode === 0 && remoteHeadCommit === committed.headCommit
      ? true
      : null;
  if (
    remote.exitCode === 0 &&
    /^[0-9a-f]{40}$/u.test(remoteHeadCommit) &&
    remoteHeadCommit !== committed.headCommit
  ) {
    const fetchRemoteHead = await runCapturedProcess({
      args: ["fetch", "--quiet", "--no-tags", "origin", remoteHeadCommit],
      command: "git",
      cwd: input.releaseRepo,
      streamOutput: false,
    });
    if (fetchRemoteHead.exitCode === 0) {
      const ancestor = await runCapturedProcess({
        args: [
          "merge-base",
          "--is-ancestor",
          committed.headCommit,
          remoteHeadCommit,
        ],
        command: "git",
        cwd: input.releaseRepo,
        streamOutput: false,
      });
      sentinelIsRemoteAncestor = ancestor.exitCode === 0
        ? true
        : ancestor.exitCode === 1
          ? false
          : null;
    }
  }
  assertV073SentinelRemoteConfirmation({
    pushExitCode: push.exitCode,
    remoteExitCode: remote.exitCode,
    remoteHeadCommit,
    sentinelCommit: committed.headCommit,
    sentinelIsRemoteAncestor,
  });
  return {
    ...preregistered,
    sentinel,
    sentinelCommit: committed.headCommit,
    sentinelIdentity: artifactIdentity(
      V073_FULL_CLAIM_PROTOCOL2_SENTINEL_PATH,
      sentinelRaw,
    ),
    sentinelRaw,
  };
}

function pathContains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export async function resolveDistinctV073FullClaimRepositories(input: {
  candidateWorktree: string;
  evidenceRepo: string;
}): Promise<{ candidateWorktree: string; evidenceRepo: string }> {
  const [candidateWorktree, evidenceRepo] = await Promise.all([
    realpath(resolve(input.candidateWorktree)),
    realpath(resolve(input.evidenceRepo)),
  ]);
  if (
    pathContains(candidateWorktree, evidenceRepo) ||
    pathContains(evidenceRepo, candidateWorktree)
  ) {
    throw new Error(
      "--evidence-repo must be a separate worktree outside the measured candidate worktree",
    );
  }
  return { candidateWorktree, evidenceRepo };
}

export async function assertV073EvidenceRepositoryLineage(input: {
  evidenceHeadCommit: string;
  evidenceRepo: string;
  expectedCandidateCommit: string;
}): Promise<void> {
  if (input.evidenceHeadCommit !== input.expectedCandidateCommit) {
    throw new Error(
      "full claim evidence repository HEAD must equal the expected candidate commit",
    );
  }
  const result = await runCapturedProcess({
    args: ["cat-file", "-e", `${input.expectedCandidateCommit}^{commit}`],
    command: "git",
    cwd: input.evidenceRepo,
    streamOutput: false,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      "full claim evidence repository cannot resolve the expected candidate commit",
    );
  }
}

function passOneEvidenceRaws(
  artifacts: SeedArtifactRaws,
): Record<string, string> {
  return {
    [SEED_ATTEMPT_ONE_EVIDENCE_RAWS.extractionCache]:
      artifacts.extractionCacheRaw,
    [SEED_ATTEMPT_ONE_EVIDENCE_RAWS.progress]: artifacts.progressRaw,
    [SEED_ATTEMPT_ONE_EVIDENCE_RAWS.report]: artifacts.reportRaw,
  };
}

function finalSeedEvidenceRaws(
  artifacts: SeedArtifactRaws,
): Record<string, string> {
  return {
    [FINAL_SEED_EVIDENCE_RAWS.extractionCache]: artifacts.extractionCacheRaw,
    [FINAL_SEED_EVIDENCE_RAWS.progress]: artifacts.progressRaw,
    [FINAL_SEED_EVIDENCE_RAWS.report]: artifacts.reportRaw,
  };
}

function availableSeedEvidenceRaws(
  artifacts: AvailableSeedArtifactRaws,
  names: typeof FINAL_SEED_EVIDENCE_RAWS | typeof SEED_ATTEMPT_ONE_EVIDENCE_RAWS,
): Record<string, string> {
  return Object.fromEntries([
    [names.extractionCache, artifacts.extractionCacheRaw],
    [names.progress, artifacts.progressRaw],
    [names.report, artifacts.reportRaw],
  ].filter((entry): entry is [string, string] => entry[1] !== undefined));
}

async function assertPreservedEvidenceRoot(input: {
  evidenceRootPath: string;
  preservedRaws: Readonly<Record<string, string>>;
}): Promise<void> {
  const names = Object.keys(input.preservedRaws).sort();
  if (!sameJson((await readdir(input.evidenceRootPath)).sort(), names)) {
    throw new Error("pass-one evidence root changed outside canonical snapshots");
  }
  for (const name of names) {
    if (
      await readFile(join(input.evidenceRootPath, name), "utf8") !==
        input.preservedRaws[name]
    ) {
      throw new Error("pass-one evidence bytes changed before publication");
    }
  }
}

export async function persistV073SeedAttemptOneEvidence(input: {
  artifacts: SeedArtifactRaws;
  evidenceRepo: string;
}): Promise<string> {
  const evidenceRootPath = join(input.evidenceRepo, EVIDENCE_ROOT);
  await assertAbsent(evidenceRootPath, "pass-one claim evidence");
  await mkdir(dirname(evidenceRootPath), { recursive: true });
  const partialPath = await mkdtemp(
    join(dirname(evidenceRootPath), ".v0.7.3-pass-one-evidence.partial-"),
  );
  for (const [name, raw] of Object.entries(passOneEvidenceRaws(input.artifacts))) {
    await writeFile(join(partialPath, name), raw, {
      encoding: "utf8",
      flag: "wx",
    });
  }
  await rename(partialPath, evidenceRootPath);
  return evidenceRootPath;
}

export async function persistV073FinalSeedEvidence(input: {
  artifacts: SeedArtifactRaws;
  evidenceRepo: string;
}): Promise<void> {
  const evidenceRootPath = join(input.evidenceRepo, EVIDENCE_ROOT);
  for (const [name, raw] of Object.entries(finalSeedEvidenceRaws(input.artifacts))) {
    await writeFile(join(evidenceRootPath, name), raw, {
      encoding: "utf8",
      flag: "wx",
    });
  }
}

export async function persistV073FinalReportEvidence(input: {
  evidenceRepo: string;
  finalRaw: string;
}): Promise<void> {
  await writeFile(
    join(input.evidenceRepo, EVIDENCE_ROOT, "final-smoke-report.json"),
    input.finalRaw,
    { encoding: "utf8", flag: "wx" },
  );
}

export async function persistV073OfficialEvidence(input: {
  evidenceRepo: string;
  progressRaw?: string;
  summaryRaw?: string;
}): Promise<void> {
  const evidenceRootPath = join(input.evidenceRepo, EVIDENCE_ROOT);
  if (input.progressRaw !== undefined) {
    await writeFile(
      join(evidenceRootPath, OFFICIAL_EVIDENCE_RAWS.progress),
      input.progressRaw,
      { encoding: "utf8", flag: "wx" },
    );
  }
  if (input.summaryRaw !== undefined) {
    await writeFile(
      join(evidenceRootPath, OFFICIAL_EVIDENCE_RAWS.summary),
      input.summaryRaw,
      { encoding: "utf8", flag: "wx" },
    );
  }
}

async function persistV073AvailableSeedArtifacts(input: {
  attempt: 1 | 2;
  artifacts: AvailableSeedArtifactRaws;
  evidenceRepo: string;
}): Promise<void> {
  const raws = availableSeedEvidenceRaws(
    input.artifacts,
    input.attempt === 1
      ? SEED_ATTEMPT_ONE_EVIDENCE_RAWS
      : FINAL_SEED_EVIDENCE_RAWS,
  );
  if (Object.keys(raws).length === 0) {
    return;
  }
  const evidenceRootPath = join(input.evidenceRepo, EVIDENCE_ROOT);
  await mkdir(evidenceRootPath, { recursive: true });
  for (const [name, raw] of Object.entries(raws)) {
    await writeFile(join(evidenceRootPath, name), raw, {
      encoding: "utf8",
      flag: "wx",
    });
  }
}

export async function preserveV073SeedArtifactsIfPresent(input: {
  attempt: 1 | 2;
  evidenceRepo: string;
  seedOutputPath: string;
}): Promise<AvailableSeedArtifactRaws> {
  const artifacts = await readAvailableSeedArtifactRaws(input.seedOutputPath);
  await persistV073AvailableSeedArtifacts({
    artifacts,
    attempt: input.attempt,
    evidenceRepo: input.evidenceRepo,
  });
  return artifacts;
}

export async function preserveV073FinalReportIfPresent(input: {
  evidenceRepo: string;
  finalPath: string;
}): Promise<string | undefined> {
  const finalRaw = await readUtf8IfPresent(input.finalPath);
  if (finalRaw !== undefined) {
    await persistV073FinalReportEvidence({
      evidenceRepo: input.evidenceRepo,
      finalRaw,
    });
  }
  return finalRaw;
}

export async function persistV073TerminalClaimReceipt(input: {
  evidenceRepo: string;
  receiptRaw: string;
}): Promise<void> {
  const evidenceRootPath = join(input.evidenceRepo, EVIDENCE_ROOT);
  await mkdir(evidenceRootPath, { recursive: true });
  await writeFile(
    join(evidenceRootPath, "execution-receipt.json"),
    input.receiptRaw,
    { encoding: "utf8", flag: "wx" },
  );
}

export async function stageV073FullClaimPublication(input: {
  evidenceRepo: string;
  preservedRaws?: Readonly<Record<string, string>>;
  projectionRaw: string;
  trackedRaws: Readonly<Record<string, string>>;
}): Promise<StagedV073FullClaimPublication> {
  const evidenceRootPath = join(input.evidenceRepo, EVIDENCE_ROOT);
  const projectionPath = join(input.evidenceRepo, PROJECTION_PATH);
  const preservedRaws = input.preservedRaws ?? {};
  if (Object.keys(preservedRaws).length === 0) {
    await assertAbsent(evidenceRootPath, "tracked claim evidence");
  } else {
    await assertPreservedEvidenceRoot({ evidenceRootPath, preservedRaws });
  }
  await assertAbsent(projectionPath, "current claim projection");
  const fileNames = Object.keys(input.trackedRaws).sort();
  if (
    fileNames.length === 0 ||
    fileNames.some((name) => basename(name) !== name || name.length === 0) ||
    Object.keys(preservedRaws).some((name) =>
      input.trackedRaws[name] !== preservedRaws[name])
  ) {
    throw new Error("tracked claim evidence names must be non-empty file names");
  }
  await Promise.all([
    mkdir(dirname(evidenceRootPath), { recursive: true }),
    mkdir(dirname(projectionPath), { recursive: true }),
  ]);
  const partialEvidenceRootPath = await mkdtemp(
    join(dirname(evidenceRootPath), ".v0.7.3-locomo-claim-evidence.partial-"),
  );
  const partialProjectionPath = join(
    dirname(projectionPath),
    `.locomo-v0.7.3-current.json.partial-${basename(partialEvidenceRootPath)}`,
  );
  for (const name of fileNames.filter((name) => !(name in preservedRaws))) {
    await writeFile(
      join(partialEvidenceRootPath, name),
      input.trackedRaws[name]!,
      { encoding: "utf8", flag: "wx" },
    );
  }
  await writeFile(partialProjectionPath, input.projectionRaw, {
    encoding: "utf8",
    flag: "wx",
  });
  return {
    evidenceRootPath,
    fileNames,
    partialEvidenceRootPath,
    partialProjectionPath,
    preservedRaws,
    projectionPath,
  };
}

export async function publishV073FullClaimPublication(
  staged: StagedV073FullClaimPublication,
): Promise<void> {
  const lockPath = join(
    dirname(staged.evidenceRootPath),
    ".v0.7.3-locomo-claim-publication.lock",
  );
  const lock = await open(lockPath, "wx");
  await lock.close();
  try {
    await assertAbsent(staged.projectionPath, "current claim projection");
    if (Object.keys(staged.preservedRaws).length === 0) {
      await assertAbsent(staged.evidenceRootPath, "tracked claim evidence");
      await rename(staged.partialEvidenceRootPath, staged.evidenceRootPath);
    } else {
      await assertPreservedEvidenceRoot({
        evidenceRootPath: staged.evidenceRootPath,
        preservedRaws: staged.preservedRaws,
      });
      const remaining = staged.fileNames
        .filter((name) => !(name in staged.preservedRaws))
        .sort((left, right) => {
          if (left === "execution-receipt.json") {
            return 1;
          }
          if (right === "execution-receipt.json") {
            return -1;
          }
          return left.localeCompare(right);
        });
      for (const name of remaining) {
        await link(
          join(staged.partialEvidenceRootPath, name),
          join(staged.evidenceRootPath, name),
        );
      }
      await rm(staged.partialEvidenceRootPath, { recursive: true });
    }
    await link(staged.partialProjectionPath, staged.projectionPath);
    await unlink(staged.partialProjectionPath);
  } finally {
    await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });
  }
}

function portableArgument(
  value: string,
  worktreePath: string,
  benchmarkRoot: string,
): string {
  if (value.startsWith(worktreePath + "/")) {
    return relative(worktreePath, value);
  }
  if (value === benchmarkRoot) {
    return CANONICAL_BENCHMARK_TOKEN;
  }
  if (value.startsWith(benchmarkRoot + "/")) {
    return `${CANONICAL_BENCHMARK_TOKEN}/${relative(benchmarkRoot, value)}`;
  }
  return value;
}

function commandBenchmarkRoot(chain: V073PairedCommandChain): string {
  const indexes = chain.seedSmoke.args.flatMap((value, index) =>
    value === "--benchmark-root" ? [index] : []);
  const value = indexes.length === 1
    ? chain.seedSmoke.args[indexes[0]! + 1]
    : undefined;
  if (!value || !isAbsolute(value)) {
    throw new Error("full claim command must carry one absolute benchmark root");
  }
  return value;
}

function shellWord(value: string): string {
  if (/^[A-Za-z0-9_./:@=+~-]+$/u.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function renderV073FullClaimCommand(
  chain: V073PairedCommandChain,
  worktreePath: string,
): string {
  withV073NoEnvFileCommandChain(chain);
  const benchmarkRoot = commandBenchmarkRoot(chain);
  return [chain.seedSmoke, chain.reanswer, chain.officialRescore]
    .map((invocation) =>
      renderV073CommandInvocation(invocation, worktreePath, benchmarkRoot))
    .join("; ");
}

export function renderV073FullClaimProtocol2Command(
  chain: V073PairedCommandChain,
  worktreePath: string,
  seedLaunchCount: 1 | 2,
): string {
  if (seedLaunchCount !== 1 && seedLaunchCount !== 2) {
    throw new Error("full claim protocol v2 permits one or two seed launches");
  }
  withV073NoEnvFileCommandChain(chain);
  const benchmarkRoot = commandBenchmarkRoot(chain);
  return [
    ...Array.from(
      { length: seedLaunchCount },
      () => renderV073CommandInvocation(
        chain.seedSmoke,
        worktreePath,
        benchmarkRoot,
      ),
    ),
    renderV073CommandInvocation(chain.reanswer, worktreePath, benchmarkRoot),
    renderV073CommandInvocation(
      chain.officialRescore,
      worktreePath,
      benchmarkRoot,
    ),
  ].join("; ");
}

function renderV073CommandInvocation(
  invocation: V073CommandInvocation,
  worktreePath: string,
  benchmarkRoot: string,
): string {
  const environment = Object.entries(invocation.environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${shellWord(value)}`);
  const command = [
    invocation.command,
    ...invocation.args.map((value) =>
      shellWord(portableArgument(value, worktreePath, benchmarkRoot))),
  ];
  return [...environment, ...command].join(" ");
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function questionSelectionSha256(rows: readonly Record<string, unknown>[]): string {
  return sha256(JSON.stringify(rows.map((row) => ({
    caseId: row.caseId,
    category: row.category,
    questionId: row.questionId,
  }))));
}

function retrievalIdentity(row: Record<string, unknown>): unknown {
  return {
    caseId: row.caseId,
    category: row.category,
    evidenceRecall: row.evidenceRecall,
    evidenceTurnIds: row.evidenceTurnIds,
    goldEvidenceFullyRetrieved: row.goldEvidenceFullyRetrieved,
    missingEvidenceTurnIds: row.missingEvidenceTurnIds,
    noiseTurnCount: row.noiseTurnCount,
    noiseTurnIds: row.noiseTurnIds,
    questionId: row.questionId,
    retrievedTurnChannels: row.retrievedTurnChannels,
    retrievedTurnIds: row.retrievedTurnIds,
  };
}

function fullReportRows(
  report: Record<string, unknown>,
  label: string,
  answerMode: "retrieval-only" | "scored",
): Record<string, unknown>[] {
  if (!Array.isArray(report.cases) || report.cases.length !== 1540) {
    throw new Error(`${label} output does not contain 1540 question rows`);
  }
  const rows = report.cases;
  const seen = new Set<string>();
  const categoryCounts = new Map<string, number>();
  const caseCounts = new Map<string, number>();
  for (const [index, value] of rows.entries()) {
    if (!isRecord(value)) {
      throw new Error(`${label} row ${index} is not an object`);
    }
    const row = value;
    const questionId = row.questionId;
    const category = row.category;
    if (
      typeof questionId !== "string" ||
      questionId.length === 0 ||
      questionId.trim() !== questionId ||
      seen.has(questionId) ||
      !EXPECTED_CASE_IDS.includes(row.caseId as typeof EXPECTED_CASE_IDS[number]) ||
      typeof category !== "string" ||
      !Object.hasOwn(EXPECTED_CATEGORY_COUNTS, category)
    ) {
      throw new Error(`${label} row ${index} has invalid identity or execution state`);
    }
    if (
      answerMode === "retrieval-only" &&
      (row.answerCorrect !== null ||
        row.answerTokenF1 !== null ||
        row.generatedAnswer !== null)
    ) {
      throw new Error(`${label} row ${index} must remain retrieval-only`);
    }
    if (
      answerMode === "scored" &&
      (typeof row.answerCorrect !== "boolean" ||
        typeof row.answerTokenF1 !== "number" ||
        !Number.isFinite(row.answerTokenF1) ||
        row.answerTokenF1 < 0 ||
        row.answerTokenF1 > 1 ||
        typeof row.generatedAnswer !== "string" ||
        row.generatedAnswer.length === 0 ||
        row.executionFailureMessage != null)
    ) {
      throw new Error(`${label} row ${index} has invalid identity or execution state`);
    }
    seen.add(questionId);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    const caseId = String(row.caseId);
    caseCounts.set(caseId, (caseCounts.get(caseId) ?? 0) + 1);
  }
  for (const [category, expected] of Object.entries(EXPECTED_CATEGORY_COUNTS)) {
    if (categoryCounts.get(category) !== expected) {
      throw new Error(`${label} category ${category} does not contain ${expected} questions`);
    }
  }
  for (const [caseId, expected] of Object.entries(
    V073_FULL_LOCOMO_CASE_QUESTION_COUNTS,
  )) {
    if (caseCounts.get(caseId) !== expected) {
      throw new Error(`${label} case ${caseId} does not contain ${expected} questions`);
    }
  }
  if (questionSelectionSha256(rows) !== V073_FULL_LOCOMO_QUESTION_SELECTION_SHA256) {
    throw new Error(`${label} question selection does not match the frozen full-10 set`);
  }
  return rows as Record<string, unknown>[];
}

function assertFullReportHeader(input: {
  allowExecutionFailures: boolean;
  label: string;
  report: Record<string, unknown>;
  runId: string;
}): void {
  if (
    input.report.benchmark !== "locomo" ||
    input.report.benchmarkFingerprint !== EXPECTED_BENCHMARK_FINGERPRINT ||
    input.report.runId !== input.runId ||
    input.report.questionCount !== 1540 ||
    input.report.caseCount !== 10 ||
    !Number.isSafeInteger(input.report.executionFailures) ||
    Number(input.report.executionFailures) < 0 ||
    (!input.allowExecutionFailures && input.report.executionFailures !== 0) ||
    !sameJson(input.report.caseIds, EXPECTED_CASE_IDS)
  ) {
    throw new Error(
      `${input.label} output is not a complete full-1540 report`,
    );
  }
}

function seedReportRows(
  report: Record<string, unknown>,
  runId: string,
): Record<string, unknown>[] {
  assertFullReportHeader({
    allowExecutionFailures: true,
    label: "seed",
    report,
    runId,
  });
  if (
    report.generatedBy !== "scripts/run-phase-65-locomo-smoke.ts" ||
    report.resume !== true ||
    report.mode !== "retrieval-only" ||
    report.answerEvaluation !== "deferred-to-live-mode"
  ) {
    throw new Error("seed output does not preserve the retrieval-only claim protocol");
  }
  const rows = fullReportRows(report, "seed", "retrieval-only");
  const failedRows = rows.filter((row) => row.executionFailureMessage != null);
  if (
    failedRows.length !== report.executionFailures ||
    rows.some((row) =>
      (row.executionFailureMessage == null) !==
        (row.executionFailureStage == null))
  ) {
    throw new Error("seed output execution failure accounting is inconsistent");
  }
  return rows;
}

function parseExtractionCacheKeys(raw: string): string[] | null {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
    if (
      !isRecord(value) ||
      typeof value.key !== "string" ||
      value.key.length === 0 ||
      !Array.isArray(value.candidates) ||
      seen.has(value.key)
    ) {
      return null;
    }
    seen.add(value.key);
    keys.push(value.key);
  }
  return keys;
}

function parseProgressQuestionKeys(raw: string): string[] | null {
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return null;
  }
  let header: unknown;
  try {
    header = JSON.parse(lines[0]!) as unknown;
  } catch {
    return null;
  }
  if (
    !isRecord(header) ||
    header.kind !== "locomo-progress-config" ||
    header.version !== 2 ||
    !isRecord(header.config) ||
    typeof header.configFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(header.configFingerprint) ||
    header.configFingerprint !== sha256(stableJsonStringify(header.config))
  ) {
    return null;
  }
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(1)) {
    let row: unknown;
    try {
      row = JSON.parse(line) as unknown;
    } catch {
      return null;
    }
    if (
      !isRecord(row) ||
      typeof row.caseId !== "string" ||
      typeof row.questionId !== "string" ||
      row.executionFailureMessage != null
    ) {
      return null;
    }
    const key = `${row.caseId}\u0000${row.questionId}`;
    if (seen.has(key)) {
      return null;
    }
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function classifyV073SeedAttemptRecovery(input: {
  expectedCacheCaseByKey: ReadonlyMap<string, string>;
  extractionCacheRaw: string;
  progressRaw: string;
  report: Record<string, unknown>;
  runId: string;
}): {
  failedCaseId: string | null;
  recoveryClassification:
    | "eligible-single-case-seed-timeout"
    | "failure-free"
    | "terminal";
} {
  const rows = seedReportRows(input.report, input.runId);
  const cacheKeys = parseExtractionCacheKeys(input.extractionCacheRaw);
  const expectedCacheKeys = new Set(input.expectedCacheCaseByKey.keys());
  const cacheIsComplete =
    expectedCacheKeys.size === 272 &&
    cacheKeys?.length === expectedCacheKeys.size &&
    cacheKeys.every((key) => expectedCacheKeys.has(key));
  const progressKeys = parseProgressQuestionKeys(input.progressRaw);
  const failureRows = rows.filter((row) => row.executionFailureMessage != null);
  const failedCaseIds = [...new Set(failureRows.map((row) => String(row.caseId)))];
  const failedCaseId = failedCaseIds.length === 1 ? failedCaseIds[0]! : null;
  const expectedProgressKeys = rows
    .filter((row) => row.executionFailureMessage == null)
    .map((row) => `${String(row.caseId)}\u0000${String(row.questionId)}`)
    .sort();
  const progressMatches = progressKeys !== null && sameJson(
    [...progressKeys].sort(),
    expectedProgressKeys,
  );
  if (
    failureRows.length === 0 &&
    cacheIsComplete &&
    progressMatches
  ) {
    return { failedCaseId: null, recoveryClassification: "failure-free" };
  }
  const failedCaseRows = failedCaseId === null
    ? []
    : rows.filter((row) => row.caseId === failedCaseId);
  const eligible =
    failedCaseId !== null &&
    failedCaseRows.length ===
      V073_FULL_LOCOMO_CASE_QUESTION_COUNTS[
        failedCaseId as keyof typeof V073_FULL_LOCOMO_CASE_QUESTION_COUNTS
      ] &&
    failedCaseRows.length === failureRows.length &&
    failureRows.every((row) =>
      row.executionFailureStage === "seed" &&
      row.executionFailureMessage === SEED_TIMEOUT_MESSAGE) &&
    expectedCacheKeys.size === 272 &&
    cacheKeys?.length === 271 &&
    cacheKeys.every((key) => expectedCacheKeys.has(key)) &&
    [...expectedCacheKeys].filter((key) => !cacheKeys.includes(key)).length === 1 &&
    input.expectedCacheCaseByKey.get(
      [...expectedCacheKeys].find((key) => !cacheKeys.includes(key))!,
    ) === failedCaseId &&
    progressMatches;
  return {
    failedCaseId,
    recoveryClassification: eligible
      ? "eligible-single-case-seed-timeout"
      : "terminal",
  };
}

async function readSeedArtifactRaws(seedOutputPath: string): Promise<SeedArtifactRaws> {
  const [reportRaw, progressRaw, extractionCacheRaw] = await Promise.all([
    readFile(join(seedOutputPath, "smoke-report.json"), "utf8"),
    readFile(join(seedOutputPath, "live-progress.jsonl"), "utf8"),
    readFile(join(seedOutputPath, "extraction-cache.jsonl"), "utf8"),
  ]);
  return { extractionCacheRaw, progressRaw, reportRaw };
}

async function readAvailableSeedArtifactRaws(
  seedOutputPath: string,
): Promise<AvailableSeedArtifactRaws> {
  const [reportRaw, progressRaw, extractionCacheRaw] = await Promise.all([
    readUtf8IfPresent(join(seedOutputPath, "smoke-report.json")),
    readUtf8IfPresent(join(seedOutputPath, "live-progress.jsonl")),
    readUtf8IfPresent(join(seedOutputPath, "extraction-cache.jsonl")),
  ]);
  return {
    ...(extractionCacheRaw !== undefined ? { extractionCacheRaw } : {}),
    ...(progressRaw !== undefined ? { progressRaw } : {}),
    ...(reportRaw !== undefined ? { reportRaw } : {}),
  };
}

export async function snapshotV073SeedAttemptOne(input: {
  seedOutputPath: string;
  snapshotPath: string;
}): Promise<SeedArtifactRaws> {
  await assertAbsent(input.snapshotPath, "seed attempt-one snapshot");
  const raws = await readSeedArtifactRaws(input.seedOutputPath);
  await mkdir(dirname(input.snapshotPath), { recursive: true });
  const partialPath = await mkdtemp(
    join(dirname(input.snapshotPath), ".seed-attempt-1.partial-"),
  );
  await Promise.all([
    writeFile(join(partialPath, "smoke-report.json"), raws.reportRaw, {
      encoding: "utf8",
      flag: "wx",
    }),
    writeFile(join(partialPath, "live-progress.jsonl"), raws.progressRaw, {
      encoding: "utf8",
      flag: "wx",
    }),
    writeFile(
      join(partialPath, "extraction-cache.jsonl"),
      raws.extractionCacheRaw,
      { encoding: "utf8", flag: "wx" },
    ),
  ]);
  try {
    await rename(partialPath, input.snapshotPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `seed attempt-one snapshot must not exist before launch: ${input.snapshotPath}`,
      );
    }
    throw error;
  }
  return raws;
}

function seedAttemptReceipt(input: {
  artifacts: SeedArtifactRaws;
  attempt: 1 | 2;
  command: V073CommandInvocation;
  failedCaseId: string | null;
  paths: {
    extractionCache: string;
    progress: string;
    report: string;
  };
  recoveryClassification: V073SeedAttemptReceipt["recoveryClassification"];
}): V073SeedAttemptReceipt {
  return {
    attempt: input.attempt,
    command: input.command,
    exitCode: 0,
    extractionCache: artifactIdentity(
      input.paths.extractionCache,
      input.artifacts.extractionCacheRaw,
    ),
    failedCaseId: input.failedCaseId,
    progress: artifactIdentity(input.paths.progress, input.artifacts.progressRaw),
    recoveryClassification: input.recoveryClassification,
    report: artifactIdentity(input.paths.report, input.artifacts.reportRaw),
  };
}

export async function runV073SeedWithOneTimeoutResume(input: {
  afterNonzeroAttemptArtifacts?: (input: {
    artifacts: AvailableSeedArtifactRaws;
    attempt: 1 | 2;
  }) => Promise<void>;
  afterAttemptProcess?: (input: {
    attempt: 1 | 2;
    result: CapturedProcess;
  }) => Promise<void>;
  afterAttemptOne?: (input: {
    artifacts: SeedArtifactRaws;
  }) => Promise<void>;
  afterAttemptOneClassified?: (input: {
    artifacts: SeedArtifactRaws;
    classification: ReturnType<typeof classifyV073SeedAttemptRecovery>;
  }) => Promise<void>;
  afterAttemptTwoClassified?: (input: {
    artifacts: SeedArtifactRaws;
    classification: ReturnType<typeof classifyV073SeedAttemptRecovery>;
  }) => Promise<void>;
  afterFinalArtifacts?: (input: {
    artifacts: SeedArtifactRaws;
    attempt: 1 | 2;
  }) => Promise<void>;
  expectedCacheCaseByKey: ReadonlyMap<string, string>;
  invocation: V073CommandInvocation;
  runSeed: (invocation: V073CommandInvocation) => Promise<CapturedProcess>;
  seedOutputPath: string;
  seedRunId: string;
  snapshotPath: string;
}): Promise<{
  attempts: V073SeedAttemptReceipt[];
  finalArtifacts: SeedArtifactRaws;
  snapshot: SeedArtifactRaws;
}> {
  const firstProcess = await input.runSeed(input.invocation);
  await input.afterAttemptProcess?.({ attempt: 1, result: firstProcess });
  if (firstProcess.exitCode !== 0) {
    const artifacts = await readAvailableSeedArtifactRaws(input.seedOutputPath);
    await input.afterNonzeroAttemptArtifacts?.({ artifacts, attempt: 1 });
    throw new Error(
      `full claim seed attempt 1 exited with ${String(firstProcess.exitCode)}`,
    );
  }
  const snapshot = await snapshotV073SeedAttemptOne({
    seedOutputPath: input.seedOutputPath,
    snapshotPath: input.snapshotPath,
  });
  await input.afterAttemptOne?.({ artifacts: snapshot });
  const firstReport = parseJsonObject(snapshot.reportRaw, "seed attempt 1 report");
  const firstClassification = classifyV073SeedAttemptRecovery({
    expectedCacheCaseByKey: input.expectedCacheCaseByKey,
    extractionCacheRaw: snapshot.extractionCacheRaw,
    progressRaw: snapshot.progressRaw,
    report: firstReport,
    runId: input.seedRunId,
  });
  await input.afterAttemptOneClassified?.({
    artifacts: snapshot,
    classification: firstClassification,
  });
  const snapshotPaths = {
    extractionCache: join(input.snapshotPath, "extraction-cache.jsonl"),
    progress: join(input.snapshotPath, "live-progress.jsonl"),
    report: join(input.snapshotPath, "smoke-report.json"),
  };
  if (firstClassification.recoveryClassification === "terminal") {
    await input.afterFinalArtifacts?.({ artifacts: snapshot, attempt: 1 });
    throw new Error("full claim seed attempt 1 is terminal and cannot resume");
  }
  const firstAttempt = seedAttemptReceipt({
    artifacts: snapshot,
    attempt: 1,
    command: input.invocation,
    failedCaseId: firstClassification.failedCaseId,
    paths: snapshotPaths,
    recoveryClassification: firstClassification.recoveryClassification,
  });
  if (firstClassification.recoveryClassification === "failure-free") {
    await input.afterFinalArtifacts?.({ artifacts: snapshot, attempt: 1 });
    return { attempts: [firstAttempt], finalArtifacts: snapshot, snapshot };
  }

  const secondProcess = await input.runSeed(input.invocation);
  await input.afterAttemptProcess?.({ attempt: 2, result: secondProcess });
  if (secondProcess.exitCode !== 0) {
    const artifacts = await readAvailableSeedArtifactRaws(input.seedOutputPath);
    await input.afterNonzeroAttemptArtifacts?.({ artifacts, attempt: 2 });
    throw new Error(
      `full claim seed attempt 2 exited with ${String(secondProcess.exitCode)}`,
    );
  }
  const finalArtifacts = await readSeedArtifactRaws(input.seedOutputPath);
  await input.afterFinalArtifacts?.({ artifacts: finalArtifacts, attempt: 2 });
  if (
    !finalArtifacts.extractionCacheRaw.startsWith(snapshot.extractionCacheRaw) ||
    !finalArtifacts.progressRaw.startsWith(snapshot.progressRaw)
  ) {
    throw new Error(
      "full claim seed resume must append to the exact attempt-one cache and progress",
    );
  }
  const finalReport = parseJsonObject(
    finalArtifacts.reportRaw,
    "seed attempt 2 report",
  );
  const secondClassification = classifyV073SeedAttemptRecovery({
    expectedCacheCaseByKey: input.expectedCacheCaseByKey,
    extractionCacheRaw: finalArtifacts.extractionCacheRaw,
    progressRaw: finalArtifacts.progressRaw,
    report: finalReport,
    runId: input.seedRunId,
  });
  await input.afterAttemptTwoClassified?.({
    artifacts: finalArtifacts,
    classification: secondClassification,
  });
  if (secondClassification.recoveryClassification !== "failure-free") {
    throw new Error("full claim seed attempt 2 is terminal");
  }
  const firstRows = seedReportRows(firstReport, input.seedRunId);
  const finalRowsByQuestion = new Map(
    seedReportRows(finalReport, input.seedRunId).map((row) => [
      `${String(row.caseId)}\u0000${String(row.questionId)}`,
      row,
    ]),
  );
  for (const firstRow of firstRows) {
    if (firstRow.executionFailureMessage != null) {
      continue;
    }
    const finalRow = finalRowsByQuestion.get(
      `${String(firstRow.caseId)}\u0000${String(firstRow.questionId)}`,
    );
    if (!finalRow || !sameJson(
      retrievalIdentity(firstRow),
      retrievalIdentity(finalRow),
    )) {
      throw new Error(
        "full claim seed resume changed an attempt-one successful retrieval",
      );
    }
  }
  const finalPaths = {
    extractionCache: join(input.seedOutputPath, "extraction-cache.jsonl"),
    progress: join(input.seedOutputPath, "live-progress.jsonl"),
    report: join(input.seedOutputPath, "smoke-report.json"),
  };
  const secondAttempt = seedAttemptReceipt({
    artifacts: finalArtifacts,
    attempt: 2,
    command: input.invocation,
    failedCaseId: null,
    paths: finalPaths,
    recoveryClassification: "failure-free-after-single-resume",
  });
  return {
    attempts: [firstAttempt, secondAttempt],
    finalArtifacts,
    snapshot,
  };
}

export function assertV073FinalClaimReport(input: {
  final: Record<string, unknown>;
  finalRunId: string;
  seed: Record<string, unknown>;
  seedPath: string;
  seedRunId: string;
}): void {
  const seedRows = seedReportRows(input.seed, input.seedRunId);
  if (input.seed.executionFailures !== 0) {
    throw new Error("seed output is not failure-free after the bounded protocol");
  }
  assertFullReportHeader({
    allowExecutionFailures: false,
    label: "final",
    report: input.final,
    runId: input.finalRunId,
  });
  const finalRows = fullReportRows(input.final, "final", "scored");
  if (
    input.final.generatedBy !== "scripts/reanswer-phase-65-locomo-report.ts" ||
    input.final.answerSystem !== "locomo-live-category-aware-v1" ||
    input.final.answerEvaluation !== "scored" ||
    input.final.mode !== "live-answer" ||
    input.final.resume !== false ||
    !isRecord(input.final.sourceReport) ||
    input.final.sourceReport.runId !== input.seedRunId ||
    resolve(String(input.final.sourceReport.path)) !== resolve(input.seedPath) ||
    !Number.isFinite(Date.parse(String(input.seed.generatedAt))) ||
    !Number.isFinite(Date.parse(String(input.final.generatedAt))) ||
    Date.parse(String(input.final.generatedAt)) <=
      Date.parse(String(input.seed.generatedAt))
  ) {
    throw new Error("final output does not preserve the default reanswer lineage");
  }
  for (const [index, seedRow] of seedRows.entries()) {
    if (!sameJson(retrievalIdentity(seedRow), retrievalIdentity(finalRows[index]!))) {
      throw new Error(`final output changed seed retrieval evidence at row ${index}`);
    }
  }
  const strictCorrect = finalRows.filter((row) => row.answerCorrect === true).length;
  if (input.final.answerAccuracyOverall !== strictCorrect / 1540) {
    throw new Error("final output answerAccuracyOverall does not match its 1540 rows");
  }
}

export function assertV073FullClaimOutputs(input: {
  final: Record<string, unknown>;
  finalPath: string;
  finalRaw: string;
  finalRunId: string;
  official: Record<string, unknown>;
  officialPath: string;
  officialProgressRaw: string;
  officialRunId: string;
  rootPath: string;
  rootRaw: Uint8Array;
  seed: Record<string, unknown>;
  seedPath: string;
  seedRunId: string;
}): void {
  assertV073FinalClaimReport(input);
  const finalRows = fullReportRows(input.final, "final", "scored");
  assertOfficialRescoreSummaryValid(input.official);
  const sourceInputs = input.official.sourceInputs;
  const sourceFingerprints = input.official.sourceInputFingerprints;
  const reportFingerprint = isRecord(sourceFingerprints)
    ? sourceFingerprints.reportPath
    : undefined;
  const rootFingerprint = isRecord(sourceFingerprints)
    ? sourceFingerprints.rootPath
    : undefined;
  if (
    input.official.generatedBy !== "scripts/rescore-official-protocols.ts" ||
    input.official.benchmark !== "locomo" ||
    input.official.runId !== input.officialRunId ||
    input.official.judgeFailures !== 0 ||
    input.official.judgedCases !== 1540 ||
    input.official.sourceCases !== 1540 ||
    input.official.selectedCases !== 1540 ||
    input.official.totalCases !== 1540 ||
    input.official.sourceAnswersUnchanged !== true ||
    resolve(String(input.official.outputPath)) !== resolve(input.officialPath) ||
    input.official.judgeGateway !== "https://ai.gurkiai.com/v1" ||
    input.official.judgeModel !== "gpt-5.5" ||
    input.official.judgeProvider !== "openai" ||
    !isRecord(sourceInputs) ||
    resolve(String(sourceInputs.reportPath)) !== resolve(input.finalPath) ||
    resolve(String(sourceInputs.rootPath)) !== resolve(input.rootPath) ||
    !isRecord(reportFingerprint) ||
    reportFingerprint.bytes !== Buffer.byteLength(input.finalRaw, "utf8") ||
    reportFingerprint.sha256 !== sha256(input.finalRaw) ||
    !isRecord(rootFingerprint) ||
    rootFingerprint.bytes !== input.rootRaw.byteLength ||
    rootFingerprint.sha256 !== sha256(input.rootRaw)
  ) {
    throw new Error("official output is not bound to the complete final report and root bytes");
  }
  const progressRows = input.officialProgressRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) =>
      parseOfficialRescoreProgressLine(line, `progress line ${index + 1}`));
  const progress = new Map<string, boolean>();
  for (const row of progressRows) {
    if (progress.has(row.questionId)) {
      throw new Error(`official progress duplicates question ${row.questionId}`);
    }
    progress.set(row.questionId, row.correct);
  }
  if (
    progress.size !== 1540 ||
    finalRows.some((row) => !progress.has(String(row.questionId)))
  ) {
    throw new Error("official progress does not cover the 1540 final questions");
  }
  if (!isRecord(input.official.categories)) {
    throw new Error("official output does not contain category summaries");
  }
  let overallCorrect = 0;
  for (const [category, total] of Object.entries(EXPECTED_CATEGORY_COUNTS)) {
    const correct = finalRows.filter(
      (row) =>
        row.category === category &&
        progress.get(String(row.questionId)) === true,
    ).length;
    const summary = input.official.categories[category];
    if (
      !isRecord(summary) ||
      summary.total !== total ||
      summary.correct !== correct ||
      summary.accuracy !== correct / total
    ) {
      throw new Error(`official progress disagrees with category ${category}`);
    }
    overallCorrect += correct;
  }
  if (
    input.official.overallCorrect !== overallCorrect ||
    input.official.overallAccuracy !== overallCorrect / 1540
  ) {
    throw new Error("official progress disagrees with the overall summary");
  }
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

async function runCli(): Promise<void> {
  const worktreeFlag = resolveCliFlagValueStrict(Bun.argv, "--worktree") ??
    process.cwd();
  const evidenceRepoFlag = resolveCliFlagValueStrict(
    Bun.argv,
    "--evidence-repo",
  );
  const releaseRepoFlag = resolveCliFlagValueStrict(
    Bun.argv,
    "--release-repo",
  );
  const benchmarkRootFlag = resolveCliFlagValueStrict(
    Bun.argv,
    "--benchmark-root",
  );
  if (
    !benchmarkRootFlag ||
    !evidenceRepoFlag ||
    !releaseRepoFlag
  ) {
    throw new Error(
      "usage: --worktree <path> --benchmark-root <path> " +
        "--evidence-repo <path> --release-repo <main-path>",
    );
  }
  const repositories = await resolveDistinctV073FullClaimRepositories({
    candidateWorktree: worktreeFlag,
    evidenceRepo: evidenceRepoFlag,
  });
  const worktreePath = repositories.candidateWorktree;
  const evidenceRepoPath = repositories.evidenceRepo;
  const releaseRepoPath = await realpath(resolve(releaseRepoFlag));
  if (
    pathContains(worktreePath, releaseRepoPath) ||
    pathContains(releaseRepoPath, worktreePath) ||
    pathContains(evidenceRepoPath, releaseRepoPath) ||
    pathContains(releaseRepoPath, evidenceRepoPath)
  ) {
    throw new Error(
      "--release-repo must be the separate canonical main worktree",
    );
  }
  const benchmarkRoot = resolve(benchmarkRootFlag);
  if (Bun.version !== REQUIRED_BUN_VERSION) {
    throw new Error(`full claim launch requires Bun ${REQUIRED_BUN_VERSION}`);
  }
  const packageJson = parseJsonObject(
    await readFile(join(worktreePath, "package.json"), "utf8"),
    "package.json",
  );
  if (packageJson.version !== RELEASE_VERSION) {
    throw new Error(`full claim launch requires package ${RELEASE_VERSION}`);
  }
  const initialProvenance = await worktreeProvenance(worktreePath);
  assertClean(initialProvenance, "full claim launch");
  await assertV073GitCheckoutDetached(worktreePath, "full claim candidate");
  const releaseRepositoryBefore = await worktreeProvenance(releaseRepoPath);
  assertClean(releaseRepositoryBefore, "full claim release repository");
  if (await currentGitBranch(releaseRepoPath) !== "main") {
    throw new Error("full claim release repository must be on main");
  }
  const preregistered = await readV073FullClaimProtocol2Preregistration({
    protocolCandidateCommit: initialProvenance.headCommit,
    releaseRepo: releaseRepoPath,
  });
  const expectedCandidateCommit =
    preregistered.preregistration.protocolCandidateCommit;
  if (initialProvenance.headCommit !== expectedCandidateCommit) {
    throw new Error(
      `full claim HEAD ${initialProvenance.headCommit} does not match expected candidate ${expectedCandidateCommit}`,
    );
  }
  await assertGitAncestor({
    ancestor: expectedCandidateCommit,
    descendant: releaseRepositoryBefore.headCommit,
    repository: releaseRepoPath,
  });
  const evidenceRepositoryBefore = await worktreeProvenance(evidenceRepoPath);
  assertClean(evidenceRepositoryBefore, "full claim evidence repository");
  await assertV073GitCheckoutDetached(
    evidenceRepoPath,
    "full claim evidence repository",
  );
  await assertV073EvidenceRepositoryLineage({
    evidenceHeadCommit: evidenceRepositoryBefore.headCommit,
    evidenceRepo: evidenceRepoPath,
    expectedCandidateCommit,
  });
  const {
    finalRunId,
    officialRunId,
    outputRoot: relativeOutputRoot,
    seedRunId,
  } = preregistered.preregistration;
  const outputRoot = resolve(worktreePath, relativeOutputRoot);
  const seedOutputPath = join(outputRoot, seedRunId);
  const finalOutputPath = join(outputRoot, finalRunId);
  const seedAttemptOneSnapshotPath = join(outputRoot, "seed-attempt-1");
  const officialOutputPath = join(
    worktreePath,
    "reports/eval/research/official-rescore",
    officialRunId,
  );
  await Promise.all([
    assertAbsent(seedOutputPath, "seed output"),
    assertAbsent(seedAttemptOneSnapshotPath, "seed attempt-one snapshot"),
    assertAbsent(finalOutputPath, "final output"),
    assertAbsent(officialOutputPath, "official output"),
    assertAbsent(join(evidenceRepoPath, EVIDENCE_ROOT), "tracked claim evidence"),
    assertAbsent(join(evidenceRepoPath, PROJECTION_PATH), "current claim projection"),
  ]);
  const rootRaw = await readFile(join(benchmarkRoot, "cases.json"));
  if (
    rootRaw.byteLength !== EXPECTED_BENCHMARK_ROOT_BYTES ||
    sha256(rootRaw) !== EXPECTED_BENCHMARK_ROOT_SHA256
  ) {
    throw new Error("benchmark root does not match the frozen full-10 LoCoMo bytes");
  }
  const answer = provider("GOODMEMORY_EVAL");
  const assistedExtractor = provider("GOODMEMORY_ASSISTED_EXTRACTOR");
  const embedding = provider("GOODMEMORY_EMBEDDING");
  const reranking = provider("GOODMEMORY_RERANKING");
  const judge = provider("GOODMEMORY_JUDGE");
  if (
    answer.gateway !== "https://ai.gurkiai.com/v1" ||
    answer.model !== "gpt-5.6-terra" ||
    answer.provider !== "openai" ||
    assistedExtractor.gateway !== "https://ai.gurkiai.com/v1" ||
    assistedExtractor.model !== "gpt-5.6-terra" ||
    assistedExtractor.provider !== "openai" ||
    embedding.gateway !== "https://openrouter.ai/api/v1" ||
    embedding.model !== "text-embedding-3-small" ||
    embedding.provider !== "openai" ||
    reranking.gateway !== "https://ai.gurkiai.com/v1" ||
    reranking.model !== "gpt-5.6-terra" ||
    reranking.provider !== "openai" ||
    judge.gateway !== "https://ai.gurkiai.com/v1" ||
    judge.model !== "gpt-5.5" ||
    judge.provider !== "openai"
  ) {
    throw new Error("provider identities do not match the frozen claim protocol");
  }
  const expectedCacheCaseByKey = deriveV073ExpectedExtractionCache({
    configTag: answer.model,
    rootRaw,
  });
  const expectedCacheKeySetSha256 = sha256(JSON.stringify(
    [...expectedCacheCaseByKey.keys()].sort(),
  ));
  const expectedCacheKeyCaseMapSha256 = sha256(JSON.stringify(
    [...expectedCacheCaseByKey.entries()].sort(([left], [right]) =>
      left.localeCompare(right)),
  ));
  if (
    expectedCacheKeySetSha256 !== EXPECTED_EXTRACTION_CACHE_KEY_SET_SHA256 ||
    expectedCacheKeyCaseMapSha256 !==
      EXPECTED_EXTRACTION_CACHE_KEY_CASE_MAP_SHA256
  ) {
    throw new Error("frozen LoCoMo extraction cache identity changed");
  }
  const plan: V073FullClaimPlanInput = {
    answerGateway: answer.gateway,
    answerModel: answer.model,
    answerProvider: answer.provider,
    assistedExtractorGateway: assistedExtractor.gateway,
    assistedExtractorModel: assistedExtractor.model,
    assistedExtractorProvider: assistedExtractor.provider,
    benchmarkRoot,
    embeddingGateway: embedding.gateway,
    embeddingModel: embedding.model,
    embeddingProvider: embedding.provider,
    finalOutputPath,
    finalRunId,
    judgeGateway: judge.gateway,
    judgeModel: judge.model,
    judgeProvider: judge.provider,
    officialRunId,
    rerankingGateway: reranking.gateway,
    rerankingModel: reranking.model,
    rerankingProvider: reranking.provider,
    seedOutputPath,
    seedRunId,
    worktreePath,
  };
  const claimRecipeRaw = await readFile(
    join(worktreePath, CLAIM_RECIPE_PATH),
    "utf8",
  );
  const officialRunnerRaw = await readFile(
    join(worktreePath, OFFICIAL_RUNNER_SOURCE_PATH),
    "utf8",
  );
  const commandChain = withV073NoEnvFileCommandChain(
    buildV073FullClaimCommandChain(plan, claimRecipeRaw),
  );
  const frozenChildEnvironments = new Map<V073CommandInvocation, Record<string, string>>(
    [
      commandChain.seedSmoke,
      commandChain.reanswer,
      commandChain.officialRescore,
    ].map((invocation) => [
      invocation,
      buildV073FrozenProviderChildEnvironment({
        commandEnvironment: invocation.environment,
        hostEnvironment: process.env,
      }),
    ]),
  );
  const consumed = await consumeV073FullClaimProtocol2Attempt({
    protocolCandidateCommit: expectedCandidateCommit,
    releaseCommit: releaseRepositoryBefore.headCommit,
    releaseRepo: releaseRepoPath,
  });
  const runProviderInvocation = (invocation: V073CommandInvocation) => {
    const environment = frozenChildEnvironments.get(invocation);
    if (!environment) {
      throw new Error("provider invocation is outside the frozen command chain");
    }
    return runCapturedProcess({
      args: invocation.args,
      command: invocation.command,
      cwd: invocation.cwd,
      environment,
    });
  };
  let passOneArtifacts: AvailableSeedArtifactRaws | undefined;
  let passOneClassification:
    | ReturnType<typeof classifyV073SeedAttemptRecovery>
    | undefined;
  let finalSeedArtifacts: AvailableSeedArtifactRaws | undefined;
  let finalSeedAttempt: 1 | 2 | undefined;
  let finalSeedClassification:
    | ReturnType<typeof classifyV073SeedAttemptRecovery>
    | undefined;
  let finalReportEvidenceRaw: string | undefined;
  let officialProgressEvidenceRaw: string | undefined;
  let officialSummaryEvidenceRaw: string | undefined;
  let lastSeedProcess:
    | { attempt: 1 | 2; result: CapturedProcess }
    | undefined;
  let reanswerProcess: CapturedProcess | undefined;
  let officialProcess: CapturedProcess | undefined;
  let seedLaunches = 0;
  const persistTerminal = async (
    stage: "official-rescore" | "reanswer" | "seed",
  ): Promise<void> => {
    const stageInvocation = stage === "seed"
      ? commandChain.seedSmoke
      : stage === "reanswer"
        ? commandChain.reanswer
        : commandChain.officialRescore;
    const stageProcess = stage === "seed"
      ? lastSeedProcess?.result
      : stage === "reanswer"
        ? reanswerProcess
        : officialProcess;
    const receiptRaw = buildV073TerminalClaimReceipt({
      finalReportRaw: finalReportEvidenceRaw,
      generatedAt: new Date().toISOString(),
      lifecycleCandidateCommit:
        consumed.preregistration.lifecycleCandidateCommit,
      officialProgressRaw: officialProgressEvidenceRaw,
      officialSummaryRaw: officialSummaryEvidenceRaw,
      protocolCandidateCommit: expectedCandidateCommit,
      seedAttemptOne: passOneArtifacts
        ? {
            artifacts: passOneArtifacts,
            classification: passOneClassification,
          }
        : undefined,
      seedFinal: finalSeedArtifacts && finalSeedAttempt
        ? {
            artifacts: finalSeedArtifacts,
            attempt: finalSeedAttempt,
            classification: finalSeedClassification,
          }
        : undefined,
      seedLaunches,
      sentinel: consumed.sentinelIdentity,
      sentinelCommit: consumed.sentinelCommit,
      stage,
      stageInvocation,
      stageProcess,
      stageSeedAttempt: stage === "seed"
        ? lastSeedProcess?.attempt ??
          (seedLaunches === 2 ? 2 : seedLaunches === 1 ? 1 : null)
        : null,
    });
    await persistV073TerminalClaimReceipt({
      evidenceRepo: evidenceRepoPath,
      receiptRaw,
    });
  };
  let seedExecution: Awaited<ReturnType<
    typeof runV073SeedWithOneTimeoutResume
  >>;
  try {
    seedExecution = await runV073SeedWithOneTimeoutResume({
      afterNonzeroAttemptArtifacts: async ({ artifacts, attempt }) => {
        await persistV073AvailableSeedArtifacts({
          artifacts,
          attempt,
          evidenceRepo: evidenceRepoPath,
        });
        if (Object.keys(artifacts).length === 0) {
          return;
        }
        if (attempt === 1) {
          passOneArtifacts = artifacts;
        } else {
          finalSeedArtifacts = artifacts;
          finalSeedAttempt = 2;
        }
      },
      afterAttemptProcess: async ({ attempt, result }) => {
        lastSeedProcess = { attempt, result };
      },
      afterAttemptOne: async ({ artifacts }) => {
        await persistV073SeedAttemptOneEvidence({
          artifacts,
          evidenceRepo: evidenceRepoPath,
        });
        passOneArtifacts = artifacts;
      },
      afterAttemptOneClassified: async ({ classification }) => {
        passOneClassification = classification;
      },
      afterAttemptTwoClassified: async ({ classification }) => {
        finalSeedClassification = classification;
      },
      afterFinalArtifacts: async ({ artifacts, attempt }) => {
        await persistV073FinalSeedEvidence({
          artifacts,
          evidenceRepo: evidenceRepoPath,
        });
        finalSeedArtifacts = artifacts;
        finalSeedAttempt = attempt;
        if (attempt === 1) {
          finalSeedClassification = passOneClassification;
        }
      },
      expectedCacheCaseByKey,
      invocation: commandChain.seedSmoke,
      runSeed: async (invocation) => {
        seedLaunches += 1;
        return runProviderInvocation(invocation);
      },
      seedOutputPath,
      seedRunId,
      snapshotPath: seedAttemptOneSnapshotPath,
    });
  } catch (error) {
    await persistTerminal("seed");
    throw error;
  }
  const seedPath = join(seedOutputPath, "smoke-report.json");
  const finalPath = join(finalOutputPath, "smoke-report.json");
  const officialPath = join(officialOutputPath, "rescore-summary.json");
  const officialProgressPath = join(officialOutputPath, "progress.jsonl");
  const seedRaw = seedExecution.finalArtifacts.reportRaw;
  const seed = parseJsonObject(seedRaw, "seed report");
  let finalRaw: string;
  let final: Record<string, unknown>;
  try {
    reanswerProcess = await runProviderInvocation(commandChain.reanswer);
    finalReportEvidenceRaw = await preserveV073FinalReportIfPresent({
      evidenceRepo: evidenceRepoPath,
      finalPath,
    });
    if (reanswerProcess.exitCode !== 0) {
      throw new Error(
        `full claim reanswer exited with ${String(reanswerProcess.exitCode)}`,
      );
    }
    if (finalReportEvidenceRaw === undefined) {
      throw new Error("full claim reanswer did not write its final report");
    }
    finalRaw = finalReportEvidenceRaw;
    final = parseJsonObject(finalRaw, "final report");
    assertV073FinalClaimReport({
      final,
      finalRunId,
      seed,
      seedPath,
      seedRunId,
    });
  } catch (error) {
    await persistTerminal("reanswer");
    throw error;
  }
  let officialRaw: string;
  let officialProgressRaw: string;
  let official: Record<string, unknown>;
  try {
    officialProcess = await runProviderInvocation(
      commandChain.officialRescore,
    );
    [officialSummaryEvidenceRaw, officialProgressEvidenceRaw] =
      await Promise.all([
        readUtf8IfPresent(officialPath),
        readUtf8IfPresent(officialProgressPath),
      ]);
    await persistV073OfficialEvidence({
      evidenceRepo: evidenceRepoPath,
      progressRaw: officialProgressEvidenceRaw,
      summaryRaw: officialSummaryEvidenceRaw,
    });
    if (officialProcess.exitCode !== 0) {
      throw new Error(
        `full claim official rescore exited with ${String(officialProcess.exitCode)}`,
      );
    }
    if (
      officialSummaryEvidenceRaw === undefined ||
      officialProgressEvidenceRaw === undefined
    ) {
      throw new Error("full claim official rescore did not write complete outputs");
    }
    officialRaw = officialSummaryEvidenceRaw;
    officialProgressRaw = officialProgressEvidenceRaw;
    official = parseJsonObject(officialRaw, "official summary");
    assertV073FullClaimOutputs({
      final,
      finalPath,
      finalRaw,
      finalRunId,
      official,
      officialPath,
      officialProgressRaw,
      officialRunId,
      rootPath: join(benchmarkRoot, "cases.json"),
      rootRaw,
      seed,
      seedPath,
      seedRunId,
    });
  } catch (error) {
    await persistTerminal("official-rescore");
    throw error;
  }
  const finalProvenance = await worktreeProvenance(worktreePath);
  assertV073CandidateProvenanceUnchanged({
    current: finalProvenance,
    expected: initialProvenance,
    label: "full claim launch",
  });
  const evidenceRepositoryPrePublication = await worktreeProvenance(
    evidenceRepoPath,
  );
  const preservedRaws = {
    "final-smoke-report.json": finalRaw,
    [OFFICIAL_EVIDENCE_RAWS.progress]: officialProgressRaw,
    [OFFICIAL_EVIDENCE_RAWS.summary]: officialRaw,
    ...passOneEvidenceRaws(seedExecution.snapshot),
    ...finalSeedEvidenceRaws(seedExecution.finalArtifacts),
  };
  const expectedPassOneStatus = Object.keys(preservedRaws)
    .map((name) => `?? ${EVIDENCE_ROOT}/${name}`)
    .sort()
    .join("\n") + "\n";
  if (
    evidenceRepositoryPrePublication.headCommit !==
      evidenceRepositoryBefore.headCommit ||
    evidenceRepositoryPrePublication.statusPorcelain !==
      expectedPassOneStatus
  ) {
    throw new Error("evidence repository changed during full claim execution");
  }
  await assertPreservedEvidenceRoot({
    evidenceRootPath: join(evidenceRepoPath, EVIDENCE_ROOT),
    preservedRaws,
  });
  const command = renderV073FullClaimProtocol2Command(
    commandChain,
    worktreePath,
    seedExecution.attempts.length === 2 ? 2 : 1,
  );
  const execution = {
    answerGateway: answer.gateway,
    answerModel: answer.model,
    answerProvider: answer.provider,
    assistedExtractorGateway: assistedExtractor.gateway,
    assistedExtractorModel: assistedExtractor.model,
    assistedExtractorProvider: assistedExtractor.provider,
    benchmarkFingerprint: EXPECTED_BENCHMARK_FINGERPRINT,
    benchmarkRootBytes: rootRaw.byteLength,
    benchmarkRootSha256: sha256(rootRaw),
    bunVersion: Bun.version,
    claimCommandSha256: sha256(command),
    claimCommandTemplateSha256:
      deriveV073ClaimCommandTemplateSha256(claimRecipeRaw),
    concurrency: 40,
    expectedExtractionCacheKeyCaseMapSha256:
      expectedCacheKeyCaseMapSha256,
    expectedExtractionCacheKeySetSha256: expectedCacheKeySetSha256,
    embeddingGateway: embedding.gateway,
    embeddingModel: embedding.model,
    embeddingProvider: embedding.provider,
    judgeGateway: judge.gateway,
    judgeModel: judge.model,
    judgeProvider: judge.provider,
    officialSourceSha256: sha256(officialRunnerRaw),
    officialRescoreRequestTimeoutMs: 180_000,
    promptSha256: deriveV073PromptSha256(),
    questionSelectionSha256: V073_FULL_LOCOMO_QUESTION_SELECTION_SHA256,
    caseQuestionCounts: V073_FULL_LOCOMO_CASE_QUESTION_COUNTS,
    rerankingGateway: reranking.gateway,
    rerankingModel: reranking.model,
    rerankingProvider: reranking.provider,
    providerEmbeddingRunTimeoutMs: null,
    providerEmbeddingTimeoutMs: null,
    providerRerankingTimeoutMs: 120_000,
  };
  const seedAttempts = seedExecution.attempts.map((attempt) => {
    const attemptOne = attempt.attempt === 1;
    const artifacts = attemptOne
      ? seedExecution.snapshot
      : seedExecution.finalArtifacts;
    return seedAttemptReceipt({
      artifacts,
      attempt: attempt.attempt,
      command: commandChain.seedSmoke,
      failedCaseId: attempt.failedCaseId,
      paths: attemptOne
        ? {
            extractionCache:
              `${EVIDENCE_ROOT}/seed-attempt-1-extraction-cache.jsonl`,
            progress: `${EVIDENCE_ROOT}/seed-attempt-1-live-progress.jsonl`,
            report: `${EVIDENCE_ROOT}/seed-attempt-1-smoke-report.json`,
          }
        : {
            extractionCache: `${EVIDENCE_ROOT}/seed-extraction-cache.jsonl`,
            progress: `${EVIDENCE_ROOT}/seed-live-progress.jsonl`,
            report: `${EVIDENCE_ROOT}/seed-smoke-report.json`,
          },
      recoveryClassification: attempt.recoveryClassification,
    });
  });
  const receipt = {
    command,
    commandChain,
    commit: finalProvenance.headCommit,
    evidenceRepositoryBefore: {
      headCommit: evidenceRepositoryBefore.headCommit,
      statusPorcelain: evidenceRepositoryBefore.statusPorcelain,
    },
    execution,
    freshOutputEvidence: {
      finalOutputPathAbsentBeforeRun: true,
      officialOutputPathAbsentBeforeRun: true,
      seedAttemptOneSnapshotPathAbsentBeforeRun: true,
      seedOutputPathAbsentBeforeRun: true,
    },
    generatedBy: "v0.7.3-full-locomo-claim-launch",
    lifecycleCandidateCommit:
      consumed.preregistration.lifecycleCandidateCommit,
    maxSeedLaunches: MAX_SEED_LAUNCHES,
    outputs: {
      finalReport: artifactIdentity(finalPath, finalRaw),
      officialSummary: artifactIdentity(officialPath, officialRaw),
      officialProgress: artifactIdentity(
        officialProgressPath,
        officialProgressRaw,
      ),
      seedExtractionCache: artifactIdentity(
        join(seedOutputPath, "extraction-cache.jsonl"),
        seedExecution.finalArtifacts.extractionCacheRaw,
      ),
      seedProgress: artifactIdentity(
        join(seedOutputPath, "live-progress.jsonl"),
        seedExecution.finalArtifacts.progressRaw,
      ),
      seedReport: artifactIdentity(seedPath, seedRaw),
    },
    preregistration: consumed.preregistrationIdentity,
    protocolCandidateCommit: expectedCandidateCommit,
    protocolVersion: 2,
    seedAttempts,
    sentinel: consumed.sentinelIdentity,
    sentinelCommit: consumed.sentinelCommit,
    sources: {
      claimRecipe: artifactIdentity(
        join(worktreePath, CLAIM_RECIPE_PATH),
        claimRecipeRaw,
      ),
      officialRunner: artifactIdentity(
        join(worktreePath, OFFICIAL_RUNNER_SOURCE_PATH),
        officialRunnerRaw,
      ),
      preregistration: consumed.preregistrationIdentity,
      sentinel: consumed.sentinelIdentity,
    },
    schemaVersion: 1,
    worktreeProvenance: finalProvenance,
  };
  const trackedRaws = {
    "claim-recipe-source.json": claimRecipeRaw,
    "final-smoke-report.json": finalRaw,
    "official-rescore-summary.json": officialRaw,
    "official-progress.jsonl": officialProgressRaw,
    "official-runner-source.ts": officialRunnerRaw,
    "seed-attempt-1-extraction-cache.jsonl":
      seedExecution.snapshot.extractionCacheRaw,
    "seed-attempt-1-live-progress.jsonl": seedExecution.snapshot.progressRaw,
    "seed-attempt-1-smoke-report.json": seedExecution.snapshot.reportRaw,
    "seed-extraction-cache.jsonl":
      seedExecution.finalArtifacts.extractionCacheRaw,
    "seed-live-progress.jsonl": seedExecution.finalArtifacts.progressRaw,
    "seed-smoke-report.json": seedRaw,
  };
  const receiptRaw = `${JSON.stringify(receipt, null, 2)}\n`;
  const trackedPublicationRaws = {
    ...trackedRaws,
    "execution-receipt.json": receiptRaw,
  };
  const sourceArtifacts = [
    ["claim-recipe-source", "claim-recipe-source.json", claimRecipeRaw],
    [
      "seed-attempt-1-report",
      "seed-attempt-1-smoke-report.json",
      seedExecution.snapshot.reportRaw,
    ],
    [
      "seed-attempt-1-progress",
      "seed-attempt-1-live-progress.jsonl",
      seedExecution.snapshot.progressRaw,
    ],
    [
      "seed-attempt-1-extraction-cache",
      "seed-attempt-1-extraction-cache.jsonl",
      seedExecution.snapshot.extractionCacheRaw,
    ],
    ["seed-report", "seed-smoke-report.json", seedRaw],
    [
      "seed-progress",
      "seed-live-progress.jsonl",
      seedExecution.finalArtifacts.progressRaw,
    ],
    [
      "seed-extraction-cache",
      "seed-extraction-cache.jsonl",
      seedExecution.finalArtifacts.extractionCacheRaw,
    ],
    ["final-report", "final-smoke-report.json", finalRaw],
    ["official-summary", "official-rescore-summary.json", officialRaw],
    ["official-progress", "official-progress.jsonl", officialProgressRaw],
    ["official-runner-source", "official-runner-source.ts", officialRunnerRaw],
    ["execution-receipt", "execution-receipt.json", receiptRaw],
  ].map(([kind, name, raw]) => ({
    ...artifactIdentity(`${EVIDENCE_ROOT}/${name}`, raw),
    kind,
  }));
  sourceArtifacts.push(
    {
      ...consumed.preregistrationIdentity,
      kind: "protocol-preregistration",
    },
    {
      ...consumed.sentinelIdentity,
      kind: "protocol-attempt-sentinel",
    },
  );
  const officialScore = Number(official.overallAccuracy);
  const strictScore = Number(final.answerAccuracyOverall);
  const openDomain = isRecord(official.categories) &&
    isRecord(official.categories.open_domain)
      ? official.categories.open_domain
      : undefined;
  const openDomainCorrect = Number(openDomain?.correct);
  const openDomainTotal = Number(openDomain?.total);
  const openDomainScore = Number(openDomain?.accuracy);
  if (
    ![officialScore, strictScore, openDomainScore].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ) ||
    !Number.isSafeInteger(openDomainCorrect) ||
    openDomainCorrect < 0 ||
    openDomainTotal !== 96 ||
    openDomainCorrect > openDomainTotal ||
    openDomainScore !== openDomainCorrect / openDomainTotal
  ) {
    throw new Error("claim scores are missing from the completed reports");
  }
  const runtimeProfile =
    "recommended+provider-embedding+provider-reranking@0.7.3";
  const projection = {
    artifactKind: "tracked-current-claim-projection",
    benchmark: "LoCoMo",
    claim: {
      answerSystem: "locomo-live-category-aware-v1",
      conversationCount: 10,
      executionFailures: 0,
      judgeFailures: 0,
      officialScore,
      openDomainCorrect,
      openDomainScore,
      openDomainTotal,
      packageVersion: RELEASE_VERSION,
      questionCount: 1540,
      strictScore,
    },
    descriptorClaim: {
      claimDeclaration: CLAIM_RECIPE_PATH,
      config: "full 10 conversations / 1540 non-adversarial questions",
      measuredPackageVersion: RELEASE_VERSION,
      metric: "independent LoCoMo judge-protocol accuracy",
      name: "LoCoMo",
      reference: PROJECTION_PATH,
      result: `official ${officialScore.toFixed(4)}; strict ${strictScore.toFixed(4)}; open-domain ${openDomainCorrect}/${openDomainTotal} (${openDomainScore.toFixed(4)})`,
      runtimeProfile,
    },
    evidenceRepositoryBefore: {
      headCommit: evidenceRepositoryBefore.headCommit,
      statusPorcelain: evidenceRepositoryBefore.statusPorcelain,
    },
    execution,
    generatedBy: "scripts/run-v0-7-3-full-locomo-claim.ts",
    lifecycleCandidateCommit:
      consumed.preregistration.lifecycleCandidateCommit,
    maxSeedLaunches: MAX_SEED_LAUNCHES,
    protocolCandidateCommit: expectedCandidateCommit,
    protocolVersion: 2,
    runIdentity: {
      commit: finalProvenance.headCommit,
      finalRunId,
      officialRunId,
      seedRunId,
    },
    seedAttempts,
    sentinelCommit: consumed.sentinelCommit,
    schemaVersion: 1,
    sourceArtifacts,
  };
  const releaseRepositoryAfter = await worktreeProvenance(releaseRepoPath);
  if (
    releaseRepositoryAfter.headCommit !== consumed.sentinelCommit ||
    releaseRepositoryAfter.statusPorcelain !== ""
  ) {
    throw new Error(
      "release main changed outside the consumed protocol-v2 sentinel",
    );
  }
  const staged = await stageV073FullClaimPublication({
    evidenceRepo: evidenceRepoPath,
    preservedRaws,
    projectionRaw: `${JSON.stringify(projection, null, 2)}\n`,
    trackedRaws: trackedPublicationRaws,
  });
  assertV073CandidateProvenanceUnchanged({
    current: await worktreeProvenance(worktreePath),
    expected: initialProvenance,
    label: "full claim launch after evidence materialization",
  });
  await publishV073FullClaimPublication(staged);
  assertV073CandidateProvenanceUnchanged({
    current: await worktreeProvenance(worktreePath),
    expected: initialProvenance,
    label: "full claim launch after evidence publication",
  });
  const evidenceRepositoryAfter = await worktreeProvenance(evidenceRepoPath);
  assertV073EvidencePublicationStatus({
    current: evidenceRepositoryAfter,
    expectedHeadCommit: evidenceRepositoryBefore.headCommit,
    fileNames: Object.keys(trackedPublicationRaws),
  });
  process.stdout.write(
    `Tracked full LoCoMo evidence and projection written. Update ${CLAIM_RECIPE_PATH}, ` +
      "README claim rows, and the static capability descriptor from this projection before stable readiness.\n",
  );
}

if (import.meta.main) {
  await runCli();
}
