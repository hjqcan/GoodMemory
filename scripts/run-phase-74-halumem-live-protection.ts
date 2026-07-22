import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  assertCliPathSegmentValue,
  resolveCliFlagValueStrict,
} from "./cli-options";
import {
  buildPhase74HaluMemLiveConfigurations,
  createPhase74HaluMemLiveDependencies,
} from "./phase-74-halumem-live-providers";
import type {
  Phase74HaluMemLiveDependencyInput,
} from "./phase-74-halumem-live-providers";
import {
  PHASE74_HALUMEM_UPDATE_NOT_EVALUABLE_REASON,
  runPhase74HaluMemProtectionCli,
} from "./run-phase-74-halumem-protection";
import type {
  Phase74HaluMemProtectionCliOptions,
  Phase74HaluMemProtectionCliResult,
} from "./run-phase-74-halumem-protection";
import {
  createPhase74DurableCallBudget,
} from "./run-phase-74-generalization";
import { resolveRepoRootFromScriptUrl } from "./script-paths";
import {
  buildPhase74IngestionUsagePaths,
  verifyPhase74IngestionUsageManifest,
} from "../src/eval/phase74FullRuntime";
import {
  PHASE74_HALUMEM_QA_JUDGE_SYSTEM_PROMPT,
  PHASE74_HALUMEM_READER_SYSTEM_PROMPT,
  PHASE74_HALUMEM_UPSTREAM,
  buildPhase74HaluMemQaJudgePrompt,
  buildPhase74HaluMemReaderPrompt,
  parsePhase74HaluMemJsonl,
  selectPhase74HaluMemUsers,
} from "../src/eval/phase74HaluMemProtectionVerifier";
import type {
  Phase74HaluMemUser,
} from "../src/eval/phase74HaluMemProtectionVerifier";
import {
  appendPhase74ModelUsageEventSync,
  appendPhase74ModelUsageIntentSync,
  loadPhase74ModelUsageLedger,
} from "../src/eval/modelUsage";
import type {
  AttributedModelUsageAttempt,
  AttributedModelUsageIntent,
} from "../src/eval/modelUsage";
import {
  capturePhase74EvaluatorSource,
  phase74LivePromptSha256s,
  resolvePhase74LiveModels,
} from "../src/eval/phase74Live";
import type {
  Phase74EvaluatorSource,
  Phase74LiveModels,
} from "../src/eval/phase74Live";
import {
  PHASE74_EMBEDDING_CALL_CONFIGURATION,
  PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION,
} from "../src/eval/phase74ProviderConfiguration";
import {
  hashPhase74ProtectionValue,
} from "../src/eval/phase74ProtectionRun";
import type {
  Phase74ProtectionReplicate,
} from "../src/eval/phase74ProtectionContracts";
import {
  buildEvalRunIdentity,
} from "../src/eval/runIdentity";
import type {
  EvalRunIdentity,
  EvalRunJsonObject,
} from "../src/eval/runIdentity";

export const PHASE74_HALUMEM_MEDIUM_SHA256 =
  "486fbc130a5c8781a2af27ffa508a1d7855245137aa449c193ac4d29c45634e7";
export const PHASE74_HALUMEM_HISTORICALLY_SEEN_USER_UUID =
  "2f1f897e-d67f-dbc5-6a7b-b7634a9e294f";
export const PHASE74_HALUMEM_SELECTION_POLICY =
  "phase74-halumem-protection-v1";

const DEFAULT_CASE_CONCURRENCY = 16;
const DEFAULT_EMBEDDING_SPEND_LIMIT_USD = 0.5;
const DEFAULT_MAX_LANGUAGE_CALLS = 50_000;
const DEFAULT_USER_COUNT = 2;

interface Phase74HaluMemExecutionOptions {
  caseConcurrency?: number;
  datasetId: string;
  datasetPath: string;
  embeddingSpendLimitUsd: number;
  expectedDatasetSha256: string;
  generatedAt?: string;
  maxLanguageCalls: number;
  mode: "live" | "preflight";
  outputDir: string;
  replicate: Phase74ProtectionReplicate;
  runId: string;
  selectionManifestPath?: string;
  userCount: number;
}

interface Phase74HaluMemVerifyOptions {
  mode: "verify";
  runDirectory: string;
}

export type Phase74HaluMemLiveRunnerOptions =
  | Phase74HaluMemExecutionOptions
  | Phase74HaluMemVerifyOptions;

export interface Phase74HaluMemSelectionManifest {
  caseIdsSha256: string;
  causalPrefixPolicy: "sessions-through-question-session-v1";
  datasetSha256: string;
  excludedUserUuids: string[];
  policy: typeof PHASE74_HALUMEM_SELECTION_POLICY;
  schemaVersion: 1;
  selectedSessions: Array<{
    questionCount: number;
    sessionIndex: number;
    startTime: string;
    updateCount: number;
    userUuid: string;
  }>;
  selectedUserUuids: string[];
  upstream: typeof PHASE74_HALUMEM_UPSTREAM;
}

export interface Phase74HaluMemLiveCompletion {
  artifacts: Record<string, string>;
  identitySha256: string;
  schemaVersion: 1;
  selectionSha256: string;
  updateStatus: "completed" | "not_evaluable";
  usage: {
    eventCount: number;
    eventsSha256: string;
    ingestionKeyCount: number;
    intentCount: number;
    intentsSha256: string;
    pendingRequestCount: 0;
  };
}

export interface Phase74HaluMemLiveRunnerDependencies {
  captureEvaluatorSource(input: {
    repoRoot: string;
  }): Promise<Phase74EvaluatorSource>;
  createLiveDependencies(
    input: Phase74HaluMemLiveDependencyInput,
  ): ReturnType<typeof createPhase74HaluMemLiveDependencies>;
  fetch?: typeof globalThis.fetch;
  resolveModels(
    env: Record<string, string | undefined>,
  ): Phase74LiveModels;
  runProtection(
    options: Phase74HaluMemProtectionCliOptions,
    dependencies: Parameters<typeof runPhase74HaluMemProtectionCli>[1],
  ): Promise<Phase74HaluMemProtectionCliResult>;
}

export type Phase74HaluMemLiveRunnerResult =
  | {
      identity: EvalRunIdentity;
      runDirectory: string;
      selection: Phase74HaluMemSelectionManifest;
      status: "preflight_complete";
    }
  | {
      completion: Phase74HaluMemLiveCompletion;
      identity: EvalRunIdentity;
      runDirectory: string;
      selection: Phase74HaluMemSelectionManifest;
      status: "completed";
    }
  | {
      completion: Phase74HaluMemLiveCompletion;
      runDirectory: string;
      status: "verified";
    };

const DEFAULT_DEPENDENCIES: Phase74HaluMemLiveRunnerDependencies = {
  captureEvaluatorSource: ({ repoRoot }) =>
    capturePhase74EvaluatorSource({ repoRoot }),
  createLiveDependencies: createPhase74HaluMemLiveDependencies,
  fetch: globalThis.fetch.bind(globalThis),
  resolveModels: resolvePhase74LiveModels,
  runProtection: runPhase74HaluMemProtectionCli,
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function requiredFlag(args: readonly string[], flag: string): string {
  const value = resolveCliFlagValueStrict(args, flag);
  if (value === undefined || value === "" || value.trim() !== value) {
    throw new Error(`Phase 74 HaluMem live runner requires ${flag}.`);
  }
  return value;
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function positiveNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number.`);
  }
  return parsed;
}

function replicate(value: string): Phase74ProtectionReplicate {
  if (value !== "1" && value !== "2" && value !== "3") {
    throw new Error("--replicate must be 1, 2, or 3.");
  }
  return Number(value) as Phase74ProtectionReplicate;
}

export function parsePhase74HaluMemLiveRunnerOptions(
  args: readonly string[],
): Phase74HaluMemLiveRunnerOptions {
  const verifyRun = resolveCliFlagValueStrict(args, "--verify-run");
  if (verifyRun !== undefined) {
    if (args.includes("--preflight-only")) {
      throw new Error("--verify-run cannot be combined with --preflight-only.");
    }
    return { mode: "verify", runDirectory: resolve(verifyRun) };
  }
  const runId = requiredFlag(args, "--run-id");
  assertCliPathSegmentValue({ flag: "--run-id", value: runId });
  const selectionManifestPath = resolveCliFlagValueStrict(
    args,
    "--selection-manifest",
  );
  return {
    caseConcurrency: positiveInteger(
      resolveCliFlagValueStrict(args, "--case-concurrency") ??
        String(DEFAULT_CASE_CONCURRENCY),
      "--case-concurrency",
    ),
    datasetId: resolveCliFlagValueStrict(args, "--dataset-id") ??
      "HaluMem-Medium",
    datasetPath: resolve(requiredFlag(args, "--dataset-path")),
    embeddingSpendLimitUsd: positiveNumber(
      resolveCliFlagValueStrict(args, "--embedding-spend-limit-usd") ??
        String(DEFAULT_EMBEDDING_SPEND_LIMIT_USD),
      "--embedding-spend-limit-usd",
    ),
    expectedDatasetSha256:
      resolveCliFlagValueStrict(args, "--dataset-sha256") ??
      PHASE74_HALUMEM_MEDIUM_SHA256,
    maxLanguageCalls: positiveInteger(
      resolveCliFlagValueStrict(args, "--max-language-calls") ??
        String(DEFAULT_MAX_LANGUAGE_CALLS),
      "--max-language-calls",
    ),
    mode: args.includes("--preflight-only") ? "preflight" : "live",
    outputDir: resolve(requiredFlag(args, "--output-dir")),
    replicate: replicate(requiredFlag(args, "--replicate")),
    runId,
    ...(selectionManifestPath === undefined
      ? {}
      : { selectionManifestPath: resolve(selectionManifestPath) }),
    userCount: positiveInteger(
      resolveCliFlagValueStrict(args, "--user-count") ??
        String(DEFAULT_USER_COUNT),
      "--user-count",
    ),
  };
}

function isEligibleUser(user: Phase74HaluMemUser): boolean {
  const hasQuestion = user.sessions.some(
    (session) => (session.questions?.length ?? 0) > 0,
  );
  const hasUpdate = user.sessions.some((session) =>
    session.memory_points.some(
      (point) => point.is_update === "True" && point.original_memories.length > 0,
    )
  );
  return hasQuestion && hasUpdate;
}

function stableUserOrder(userUuid: string): string {
  return sha256(`${PHASE74_HALUMEM_SELECTION_POLICY}\0${userUuid}`);
}

export function selectPhase74HaluMemLiveUsers(input: {
  count: number;
  users: readonly Phase74HaluMemUser[];
}): Phase74HaluMemUser[] {
  if (!Number.isSafeInteger(input.count) || input.count < 2) {
    throw new Error("Phase 74 HaluMem live selection requires at least two users.");
  }
  const selected = input.users
    .filter(({ uuid }) => uuid !== PHASE74_HALUMEM_HISTORICALLY_SEEN_USER_UUID)
    .filter(isEligibleUser)
    .sort((left, right) =>
      stableUserOrder(left.uuid).localeCompare(stableUserOrder(right.uuid)) ||
      left.uuid.localeCompare(right.uuid)
    )
    .slice(0, input.count);
  if (selected.length !== input.count) {
    throw new Error(
      `Phase 74 HaluMem live selection found ${selected.length}/${input.count} eligible unseen users.`,
    );
  }
  return selected;
}

function selectedCaseIds(users: readonly Phase74HaluMemUser[]): string[] {
  const questionIds: string[] = [];
  const updateIds: string[] = [];
  const privacyIds: string[] = [];
  for (const [userIndex, user] of users.entries()) {
    const target = users[(userIndex + 1) % users.length]!;
    for (const [sessionIndex, session] of user.sessions.entries()) {
      for (const questionIndex of (session.questions ?? []).keys()) {
        const questionId =
          `${user.uuid}:session:${sessionIndex}:question:${questionIndex}`;
        questionIds.push(questionId);
        privacyIds.push(`${questionId}:foreign-scope:${target.uuid}`);
      }
      for (const [pointIndex, point] of session.memory_points.entries()) {
        if (point.is_update === "True" && point.original_memories.length > 0) {
          updateIds.push(`${user.uuid}:session:${sessionIndex}:update:${pointIndex}`);
        }
      }
    }
  }
  return [...questionIds, ...updateIds, ...privacyIds].sort();
}

export function buildPhase74HaluMemSelectionManifest(input: {
  datasetSha256: string;
  users: readonly Phase74HaluMemUser[];
}): Phase74HaluMemSelectionManifest {
  return {
    caseIdsSha256: sha256(JSON.stringify(selectedCaseIds(input.users))),
    causalPrefixPolicy: "sessions-through-question-session-v1",
    datasetSha256: input.datasetSha256,
    excludedUserUuids: [PHASE74_HALUMEM_HISTORICALLY_SEEN_USER_UUID],
    policy: PHASE74_HALUMEM_SELECTION_POLICY,
    schemaVersion: 1,
    selectedSessions: input.users.flatMap((user) =>
      user.sessions.map((session, sessionIndex) => ({
        questionCount: session.questions?.length ?? 0,
        sessionIndex,
        startTime: session.start_time,
        updateCount: session.memory_points.filter(
          (point) =>
            point.is_update === "True" && point.original_memories.length > 0,
        ).length,
        userUuid: user.uuid,
      }))
    ),
    selectedUserUuids: input.users.map(({ uuid }) => uuid),
    upstream: PHASE74_HALUMEM_UPSTREAM,
  };
}

function publicModel(model: Phase74LiveModels["answer"]) {
  return {
    gateway: model.baseURL ?? "",
    model: model.model,
    provider: model.provider,
  };
}

function jsonObject(value: unknown): EvalRunJsonObject {
  return JSON.parse(JSON.stringify(value)) as EvalRunJsonObject;
}

function haluMemPromptSha256s(): Record<string, string> {
  return {
    ...phase74LivePromptSha256s(),
    haluMemJudgeSystem: sha256(PHASE74_HALUMEM_QA_JUDGE_SYSTEM_PROMPT),
    haluMemJudgeTemplate: sha256(buildPhase74HaluMemQaJudgePrompt.toString()),
    haluMemReaderSystem: sha256(PHASE74_HALUMEM_READER_SYSTEM_PROMPT),
    haluMemReaderTemplate: sha256(buildPhase74HaluMemReaderPrompt.toString()),
  };
}

function buildRunIdentity(input: {
  caseConcurrency: number;
  datasetSha256: string;
  evaluatorSource: Phase74EvaluatorSource;
  generatedAt: string;
  models: Phase74LiveModels;
  options: Phase74HaluMemExecutionOptions;
  selection: Phase74HaluMemSelectionManifest;
}) {
  const configurations = buildPhase74HaluMemLiveConfigurations(input.models);
  return buildEvalRunIdentity({
    answerModel: publicModel(input.models.answer),
    benchmark: "halumem-protection",
    configuration: jsonObject({
      callBudget: {
        embeddingSpendLimitUsd: input.options.embeddingSpendLimitUsd,
        maxLanguageCalls: input.options.maxLanguageCalls,
      },
      caseConcurrency: input.caseConcurrency,
      causalPrefixPolicy: input.selection.causalPrefixPolicy,
      evaluatorSource: input.evaluatorSource,
      modelCalls: {
        embedding: {
          ...publicModel(input.models.embedding),
          ...PHASE74_EMBEDDING_CALL_CONFIGURATION,
        },
        extraction: {
          ...publicModel(input.models.assistedExtraction),
          ...PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.assistedExtraction,
        },
        judge: {
          ...publicModel(input.models.judge),
          ...PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.judge.oracle,
        },
        reader: {
          ...publicModel(input.models.answer),
          ...PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.reader,
        },
        reranker: {
          ...publicModel(input.models.reranker),
          ...PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.listwiseReranker,
        },
      },
      pipelines: configurations,
      replicate: input.options.replicate,
      selection: input.selection,
      selectionSha256: hashPhase74ProtectionValue(input.selection),
      update: {
        reason: PHASE74_HALUMEM_UPDATE_NOT_EVALUABLE_REASON,
        status: "not_evaluable",
      },
      usageAccounting: "phase74-attributed-intent-terminal-v1",
    }),
    datasetSha256: input.datasetSha256,
    generatedAt: input.generatedAt,
    generatedBy: "scripts/run-phase-74-halumem-live-protection.ts",
    judgeModel: publicModel(input.models.judge),
    promptSha256s: haluMemPromptSha256s(),
    runId: input.options.runId,
  });
}

async function loadSelection(input: {
  allUsers: readonly Phase74HaluMemUser[];
  datasetSha256: string;
  options: Phase74HaluMemExecutionOptions;
}): Promise<{
  manifest: Phase74HaluMemSelectionManifest;
  users: Phase74HaluMemUser[];
}> {
  if (!input.options.selectionManifestPath) {
    const users = selectPhase74HaluMemLiveUsers({
      count: input.options.userCount,
      users: input.allUsers,
    });
    return {
      manifest: buildPhase74HaluMemSelectionManifest({
        datasetSha256: input.datasetSha256,
        users,
      }),
      users,
    };
  }
  const parsed = JSON.parse(
    await readFile(input.options.selectionManifestPath, "utf8"),
  ) as Phase74HaluMemSelectionManifest;
  if (
    parsed.schemaVersion !== 1 ||
    parsed.policy !== PHASE74_HALUMEM_SELECTION_POLICY ||
    parsed.datasetSha256 !== input.datasetSha256 ||
    parsed.selectedUserUuids.length !== input.options.userCount
  ) {
    throw new Error("Phase 74 HaluMem selection manifest drifted.");
  }
  const users = selectPhase74HaluMemUsers(
    input.allUsers,
    parsed.selectedUserUuids,
  );
  if (
    users.some(
      (user) =>
        user.uuid === PHASE74_HALUMEM_HISTORICALLY_SEEN_USER_UUID ||
        !isEligibleUser(user),
    )
  ) {
    throw new Error("Phase 74 HaluMem selection manifest is not unseen/eligible.");
  }
  const expected = buildPhase74HaluMemSelectionManifest({
    datasetSha256: input.datasetSha256,
    users,
  });
  if (
    hashPhase74ProtectionValue(parsed) !==
      hashPhase74ProtectionValue(expected)
  ) {
    throw new Error("Phase 74 HaluMem selection manifest content drifted.");
  }
  return { manifest: expected, users };
}

async function writeCreateOnlyJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function relativeArtifactPath(runDirectory: string, path: string): string {
  const absoluteRun = resolve(runDirectory);
  const absolutePath = resolve(path);
  const value = relative(absoluteRun, absolutePath);
  if (
    value === "" ||
    isAbsolute(value) ||
    value === ".." ||
    value.startsWith(`..${sep}`)
  ) {
    throw new Error("Phase 74 HaluMem completion artifact escaped the run directory.");
  }
  return value;
}

async function artifactHashes(
  runDirectory: string,
  paths: readonly string[],
): Promise<Record<string, string>> {
  const entries = await Promise.all(paths.map(async (path) => [
    relativeArtifactPath(runDirectory, path),
    sha256(await readFile(path)),
  ] as const));
  return Object.fromEntries(entries.sort(([left], [right]) =>
    left.localeCompare(right)
  ));
}

function parseCompletion(value: unknown): Phase74HaluMemLiveCompletion {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Phase 74 HaluMem run completion is invalid.");
  }
  const completion = value as Partial<Phase74HaluMemLiveCompletion>;
  if (
    completion.schemaVersion !== 1 ||
    !completion.artifacts ||
    typeof completion.artifacts !== "object" ||
    !/^[a-f0-9]{64}$/u.test(completion.identitySha256 ?? "") ||
    !/^[a-f0-9]{64}$/u.test(completion.selectionSha256 ?? "") ||
    (completion.updateStatus !== "completed" &&
      completion.updateStatus !== "not_evaluable") ||
    !completion.usage ||
    completion.usage.pendingRequestCount !== 0 ||
    !Number.isSafeInteger(completion.usage.ingestionKeyCount) ||
    completion.usage.ingestionKeyCount < 0 ||
    !/^[a-f0-9]{64}$/u.test(completion.usage.eventsSha256 ?? "") ||
    !/^[a-f0-9]{64}$/u.test(completion.usage.intentsSha256 ?? "")
  ) {
    throw new Error("Phase 74 HaluMem run completion is invalid.");
  }
  for (const [path, hash] of Object.entries(completion.artifacts)) {
    if (path === "" || !/^[a-f0-9]{64}$/u.test(hash)) {
      throw new Error("Phase 74 HaluMem completion artifact hash is invalid.");
    }
  }
  return completion as Phase74HaluMemLiveCompletion;
}

export async function verifyPhase74HaluMemLiveRun(
  runDirectory: string,
): Promise<Phase74HaluMemLiveCompletion> {
  const directory = resolve(runDirectory);
  const completion = parseCompletion(JSON.parse(
    await readFile(join(directory, "run-completion.json"), "utf8"),
  ));
  const [identityBytes, selectionBytes] = await Promise.all([
    readFile(join(directory, "run-identity.json")),
    readFile(join(directory, "selection-manifest.json")),
  ]);
  if (
    sha256(identityBytes) !== completion.identitySha256 ||
    sha256(selectionBytes) !== completion.selectionSha256
  ) {
    throw new Error("Phase 74 HaluMem run identity or selection hash drifted.");
  }
  const identity = JSON.parse(identityBytes.toString("utf8")) as EvalRunIdentity;
  const selection = JSON.parse(
    selectionBytes.toString("utf8"),
  ) as Phase74HaluMemSelectionManifest;
  const configuration = identity.configuration;
  if (
    identity.datasetSha256 !== selection.datasetSha256 ||
    configuration.selectionSha256 !==
      hashPhase74ProtectionValue(selection) ||
    hashPhase74ProtectionValue(configuration.selection) !==
      hashPhase74ProtectionValue(selection)
  ) {
    throw new Error("Phase 74 HaluMem identity/selection binding drifted.");
  }
  const usageSummary = JSON.parse(await readFile(
    join(directory, "model-usage-summary.json"),
    "utf8",
  )) as Phase74HaluMemLiveCompletion["usage"];
  const usageProjection = {
    eventCount: usageSummary.eventCount,
    eventsSha256: usageSummary.eventsSha256,
    ingestionKeyCount: usageSummary.ingestionKeyCount,
    intentCount: usageSummary.intentCount,
    intentsSha256: usageSummary.intentsSha256,
    pendingRequestCount: usageSummary.pendingRequestCount,
  };
  if (
    hashPhase74ProtectionValue(usageProjection) !==
      hashPhase74ProtectionValue(completion.usage)
  ) {
    throw new Error("Phase 74 HaluMem completion usage summary drifted.");
  }
  for (const [path, expected] of Object.entries(completion.artifacts)) {
    const absolute = resolve(directory, path);
    relativeArtifactPath(directory, absolute);
    if (sha256(await readFile(absolute)) !== expected) {
      throw new Error(`Phase 74 HaluMem completion artifact drifted: ${path}.`);
    }
  }
  return completion;
}

async function writeUsageSummary(input: {
  eventsPath: string;
  intentsPath: string;
  path: string;
  runDirectory: string;
}): Promise<{
  artifactPaths: string[];
  usage: Phase74HaluMemLiveCompletion["usage"];
}> {
  const direct = await loadPhase74ModelUsageLedger({
    eventsPath: input.eventsPath,
    intentsPath: input.intentsPath,
  });
  if (direct.pendingIntents.length > 0) {
    throw new Error("Phase 74 HaluMem model usage has pending requests.");
  }
  const [directEventBytes, directIntentBytes] = await Promise.all([
    readFile(input.eventsPath),
    readFile(input.intentsPath),
  ]);
  let ingestionEntries: Dirent<string>[] = [];
  try {
    ingestionEntries = await readdir(
      join(input.runDirectory, "ingestion-usage"),
      { withFileTypes: true },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const ingestion = await Promise.all(ingestionEntries
    .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/u.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(async ({ name: key }) => {
      const paths = buildPhase74IngestionUsagePaths(input.runDirectory, key);
      const ledger = await loadPhase74ModelUsageLedger(paths);
      if (ledger.pendingIntents.length > 0) {
        throw new Error(
          `Phase 74 HaluMem ingestion ${key} has pending requests.`,
        );
      }
      if (ledger.intents.some(({ branch }) => branch !== "shadow")) {
        throw new Error(
          `Phase 74 HaluMem ingestion ${key} contains non-shadow usage.`,
        );
      }
      await verifyPhase74IngestionUsageManifest({
        ingestionKey: key,
        ledger,
        runDirectory: input.runDirectory,
      });
      const manifestPath = join(
        input.runDirectory,
        "ingestion",
        key,
        "manifest.json",
      );
      const [eventBytes, intentBytes] = await Promise.all([
        readFile(paths.eventsPath),
        readFile(paths.intentsPath),
      ]);
      return {
        artifactPaths: [paths.eventsPath, paths.intentsPath, manifestPath],
        eventCount: ledger.events.length,
        eventsSha256: sha256(eventBytes),
        intentCount: ledger.intents.length,
        intentsSha256: sha256(intentBytes),
        key,
      };
    }));
  const eventLedgers = [
    { key: "direct", sha256: sha256(directEventBytes) },
    ...ingestion.map(({ eventsSha256, key }) => ({
      key,
      sha256: eventsSha256,
    })),
  ];
  const intentLedgers = [
    { key: "direct", sha256: sha256(directIntentBytes) },
    ...ingestion.map(({ intentsSha256, key }) => ({
      key,
      sha256: intentsSha256,
    })),
  ];
  const usage = {
    eventCount: direct.events.length + ingestion.reduce(
      (total, entry) => total + entry.eventCount,
      0,
    ),
    eventsSha256: hashPhase74ProtectionValue(eventLedgers),
    ingestionKeyCount: ingestion.length,
    intentCount: direct.intents.length + ingestion.reduce(
      (total, entry) => total + entry.intentCount,
      0,
    ),
    intentsSha256: hashPhase74ProtectionValue(intentLedgers),
    pendingRequestCount: 0 as const,
  };
  await writeCreateOnlyJson(input.path, {
    ...usage,
    branches: Object.fromEntries(
      ["baseline", "candidate", "judge", "shadow"].map((branch) => [
        branch,
        direct.intents.filter((intent) => intent.branch === branch).length +
          ingestion.reduce(
            (total, entry) => total + (
              branch === "shadow" ? entry.intentCount : 0
            ),
            0,
          ),
      ]),
    ),
    ingestion: ingestion.map(({ artifactPaths: _artifactPaths, ...entry }) =>
      entry
    ),
    schemaVersion: 1,
  });
  return {
    artifactPaths: ingestion.flatMap(({ artifactPaths }) => artifactPaths),
    usage,
  };
}

export async function runPhase74HaluMemLiveProtection(
  options: Phase74HaluMemLiveRunnerOptions,
  overrides: Partial<Phase74HaluMemLiveRunnerDependencies> = {},
  env: Record<string, string | undefined> = process.env,
): Promise<Phase74HaluMemLiveRunnerResult> {
  if (options.mode === "verify") {
    const runDirectory = resolve(options.runDirectory);
    return {
      completion: await verifyPhase74HaluMemLiveRun(runDirectory),
      runDirectory,
      status: "verified",
    };
  }
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  const caseConcurrency = options.caseConcurrency ?? DEFAULT_CASE_CONCURRENCY;
  if (!Number.isSafeInteger(caseConcurrency) || caseConcurrency <= 0) {
    throw new Error("Phase 74 HaluMem caseConcurrency must be positive.");
  }
  const datasetBytes = await readFile(options.datasetPath);
  const datasetSha256 = sha256(datasetBytes);
  if (datasetSha256 !== options.expectedDatasetSha256.toLowerCase()) {
    throw new Error("Phase 74 HaluMem dataset SHA-256 drifted.");
  }
  const allUsers = parsePhase74HaluMemJsonl(
    datasetBytes.toString("utf8"),
    options.datasetPath,
  );
  const selection = await loadSelection({
    allUsers,
    datasetSha256,
    options,
  });
  const models = dependencies.resolveModels(env);
  const evaluatorSource = await dependencies.captureEvaluatorSource({
    repoRoot: resolveRepoRootFromScriptUrl(import.meta.url),
  });
  const identity = buildRunIdentity({
    caseConcurrency,
    datasetSha256,
    evaluatorSource,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    models,
    options,
    selection: selection.manifest,
  });
  const runDirectory = join(resolve(options.outputDir), options.runId);
  await mkdir(dirname(runDirectory), { recursive: true });
  await mkdir(runDirectory);
  const identityPath = join(runDirectory, "run-identity.json");
  const selectionPath = join(runDirectory, "selection-manifest.json");
  await writeCreateOnlyJson(selectionPath, selection.manifest);
  await writeCreateOnlyJson(identityPath, identity);
  if (options.mode === "preflight") {
    return {
      identity,
      runDirectory,
      selection: selection.manifest,
      status: "preflight_complete",
    };
  }

  const usageEventsPath = join(runDirectory, "model-usage.jsonl");
  const usageIntentsPath = join(runDirectory, "model-usage-intents.jsonl");
  await Promise.all([
    writeFile(usageEventsPath, "", { encoding: "utf8", flag: "wx" }),
    writeFile(usageIntentsPath, "", { encoding: "utf8", flag: "wx" }),
  ]);
  const callBudgetPath = join(runDirectory, "call-budget.json");
  const callBudget = createPhase74DurableCallBudget({
    embeddingSpendLimitUsd: options.embeddingSpendLimitUsd,
    fetch: dependencies.fetch ?? globalThis.fetch.bind(globalThis),
    maxLanguageCalls: options.maxLanguageCalls,
    path: callBudgetPath,
  });
  const events: AttributedModelUsageAttempt[] = [];
  const intents: AttributedModelUsageIntent[] = [];
  const onUsageEvent = (event: AttributedModelUsageAttempt) =>
    appendPhase74ModelUsageEventSync(usageEventsPath, event);
  const onUsageIntent = (intent: AttributedModelUsageIntent) =>
    appendPhase74ModelUsageIntentSync(usageIntentsPath, intent);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = callBudget.fetch;
  let protection: Phase74HaluMemProtectionCliResult;
  try {
    const live = dependencies.createLiveDependencies({
      datasetSha256,
      evaluatorSourceSha256: evaluatorSource.sha256,
      events,
      fetch: callBudget.fetch,
      intents,
      models,
      onUsageEvent,
      onUsageIntent,
      promptSha256s: haluMemPromptSha256s(),
      runDirectory,
      users: selection.users,
    });
    protection = await dependencies.runProtection({
      caseConcurrency,
      datasetId: options.datasetId,
      datasetPath: options.datasetPath,
      e4Configuration: buildPhase74HaluMemLiveConfigurations(models).e4,
      outputDir: options.outputDir,
      replicate: options.replicate,
      runId: options.runId,
      safetyConfiguration:
        buildPhase74HaluMemLiveConfigurations(models).safety,
      userUuids: selection.manifest.selectedUserUuids,
    }, {
      captureEvaluatorSource: async () => evaluatorSource,
      e4: live.e4,
      privacy: live.privacy,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const usageSummaryPath = join(runDirectory, "model-usage-summary.json");
  const usageSummary = await writeUsageSummary({
    eventsPath: usageEventsPath,
    intentsPath: usageIntentsPath,
    path: usageSummaryPath,
    runDirectory,
  });
  const artifactPaths = [
    identityPath,
    selectionPath,
    usageEventsPath,
    usageIntentsPath,
    usageSummaryPath,
    callBudgetPath,
    protection.e4.artifactPath,
    protection.e4.rawArtifactPath,
    protection.privacy.artifactPath,
    protection.privacy.rawArtifactPath,
    ...usageSummary.artifactPaths,
    ...(protection.update.status === "completed"
      ? [
          protection.update.result.artifactPath,
          protection.update.result.rawArtifactPath,
        ]
      : []),
  ];
  const [identityBytes, selectionBytes] = await Promise.all([
    readFile(identityPath),
    readFile(selectionPath),
  ]);
  const completion: Phase74HaluMemLiveCompletion = {
    artifacts: await artifactHashes(runDirectory, artifactPaths),
    identitySha256: sha256(identityBytes),
    schemaVersion: 1,
    selectionSha256: sha256(selectionBytes),
    updateStatus: protection.update.status,
    usage: usageSummary.usage,
  };
  await writeCreateOnlyJson(
    join(runDirectory, "run-completion.json"),
    completion,
  );
  return {
    completion: await verifyPhase74HaluMemLiveRun(runDirectory),
    identity,
    runDirectory,
    selection: selection.manifest,
    status: "completed",
  };
}

if (import.meta.main) {
  try {
    const result = await runPhase74HaluMemLiveProtection(
      parsePhase74HaluMemLiveRunnerOptions(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
