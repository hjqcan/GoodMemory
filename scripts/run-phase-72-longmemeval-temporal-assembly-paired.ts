import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  createLongMemEvalGoodMemoryContextBuilder,
  scoreLongMemEvalAnswerWithOptionalJudge,
  validateLongMemEvalCases,
  type LongMemEvalAnswerGenerator,
  type LongMemEvalAnswerJudge,
  type LongMemEvalAnswerScore,
  type LongMemEvalCase,
  type LongMemEvalMemoryContextBuilder,
} from "../src/eval/longmemeval";
import { estimateTextTokens } from "../src/tokenEstimator";
import {
  assertCliPathSegmentValue,
  hasCliFlagStrict,
  parseCliPositiveIntegerFlagStrict,
  resolveCliFlagValueStrict,
} from "./cli-options";
import {
  createHermeticLongMemEvalMemory,
  createLongMemEvalAnswerGenerator,
  createLongMemEvalAnswerJudge,
  createLongMemEvalMemoryFactory,
  resolvePhase62LiveRequestTimeoutMs,
} from "./run-phase-62-eval";

const PROTOCOL = "longmemeval_current_recall_assembly_paired_v2";
const PROFILE = "goodmemory-recommended";
const DATASET_FILE = "longmemeval_s_cleaned.json";
const TEMPORAL_FORMAT = "compact_json";
const CANONICAL_OUTPUT_DIR =
  "reports/eval/research/phase-72/longmemeval-current-recall-assembly";
const DEVELOPMENT_SELECTION_SHA256 =
  "3df24634d8f661ad2a6a054ec628114fcbab038d5b130e41800ab1b64a11e29e";
const HOLDOUT_SELECTION_SHA256 =
  "7f776aad5ee6c531b7443a060d9323dde53c137f1d849ba87f31313c21f62993";
const HOLDOUT_MINIMUM_NET_WINS = 2;
const TARGET_QUESTION_TYPES = new Set([
  "knowledge-update",
  "temporal-reasoning",
]);

export interface Phase72LongMemEvalTemporalAssemblySelection {
  benchmarkFingerprint: string;
  protocol: typeof PROTOCOL;
  questionIds: string[];
  salt: string;
  schemaVersion: 1;
  selectionMethod: string;
  split: "candidate_holdout" | "development";
  strata: Record<string, number>;
}

export interface Phase72LongMemEvalTemporalAssemblyOptions {
  benchmarkRoot: string;
  contextMaxTokens: number;
  developmentReportFile?: string;
  maxConcurrency: number;
  openCandidateHoldout?: boolean;
  outputDir: string;
  readerContextTokenCap: number;
  runId: string;
  selectionFile: string;
}

export interface Phase72LongMemEvalTemporalAssemblySourceState {
  commit: string;
  dirty: boolean;
  worktreeFingerprint: string;
}

export interface Phase72LongMemEvalTemporalAssemblyDependencies {
  answerGenerator?: LongMemEvalAnswerGenerator;
  answerJudge?: LongMemEvalAnswerJudge;
  memoryContextBuilder?: LongMemEvalMemoryContextBuilder;
  mkdir?: (
    path: string,
    options: { recursive: boolean },
  ) => Promise<unknown>;
  now?: () => Date;
  readFile?: (path: string) => Promise<string>;
  sourceState?: Phase72LongMemEvalTemporalAssemblySourceState;
  writeFile?: (
    path: string,
    value: string,
    options: { flag: "wx" },
  ) => Promise<unknown>;
}

interface ArmResult {
  contextSha256: string;
  contextTokens: number;
  correct: boolean;
  hypothesis: string;
  score: LongMemEvalAnswerScore;
}

interface PairedCaseResult {
  armOrder: Array<"baseline" | "temporal">;
  baseline: ArmResult;
  delta: -1 | 0 | 1;
  questionId: string;
  questionType: string;
  recallSnapshotSha256: string;
  retrievedSessionIds: string[];
  temporal: ArmResult;
}

export interface Phase72LongMemEvalTemporalAssemblyReport {
  cases: PairedCaseResult[];
  configuration: {
    baselineFormat: "product_default";
    candidateHoldoutExplicitlyOpened: boolean;
    contextMaxTokens: number;
    profile: typeof PROFILE;
    readerContextTokenCap: number;
    temporalFormat: typeof TEMPORAL_FORMAT;
  };
  execution: {
    answerCalls: number;
    judgeCalls: number;
    memoryContextBuilds: number;
  };
  holdoutAuthorization: {
    developmentReportSha256: string;
    developmentRunId: string;
    reservationId: string;
  } | null;
  holdoutGate: {
    minimumNetWins: number;
    passed: boolean;
    protectionLosses: number;
    protectionQuestionCount: number;
  } | null;
  generatedAt: string;
  generatedBy:
    "scripts/run-phase-72-longmemeval-temporal-assembly-paired.ts";
  model: {
    answer: { baseURL?: string; model: string; provider: string };
    judge: { baseURL?: string; model: string; provider: string } | null;
  };
  protocol: typeof PROTOCOL;
  runId: string;
  selection: {
    fileSha256: string;
    questionCount: number;
    salt: string;
    selectionMethod: string;
    split: Phase72LongMemEvalTemporalAssemblySelection["split"];
    strata: Record<string, number>;
  };
  source: {
    benchmarkFingerprint: string;
    datasetRawSha256: string;
    sourceState: Phase72LongMemEvalTemporalAssemblySourceState;
  };
  summary: {
    baselineAccuracy: number;
    baselineCorrect: number;
    losses: number;
    netWins: number;
    temporalAccuracy: number;
    temporalCorrect: number;
    ties: number;
    totalCases: number;
    wins: number;
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSelection(
  raw: string,
): Phase72LongMemEvalTemporalAssemblySelection {
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value) || !isRecord(value.strata)) {
    throw new Error("Invalid temporal assembly selection file.");
  }
  const strata = Object.fromEntries(Object.entries(value.strata).map(
    ([key, count]) => [key, count],
  ));
  if (
    value.schemaVersion !== 1 ||
    value.protocol !== PROTOCOL ||
    (value.split !== "development" && value.split !== "candidate_holdout") ||
    typeof value.benchmarkFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.benchmarkFingerprint) ||
    typeof value.selectionMethod !== "string" ||
    value.selectionMethod.trim() !== value.selectionMethod ||
    value.selectionMethod.length === 0 ||
    typeof value.salt !== "string" ||
    value.salt.trim() !== value.salt ||
    value.salt.length === 0 ||
    !Array.isArray(value.questionIds) ||
    value.questionIds.length === 0 ||
    value.questionIds.some(
      (id) => typeof id !== "string" || id.length === 0,
    ) ||
    Object.keys(strata).length === 0 ||
    Object.entries(strata).some(
      ([key, count]) =>
        key.length === 0 ||
        !Number.isInteger(count) ||
        (count as number) < 1,
    ) ||
    Object.values(strata).reduce<number>(
      (total, count) => total + (typeof count === "number" ? count : 0),
      0,
    ) !== value.questionIds.length
  ) {
    throw new Error("Invalid temporal assembly selection file.");
  }
  if (new Set(value.questionIds).size !== value.questionIds.length) {
    throw new Error("Temporal assembly selection contains duplicate question IDs.");
  }
  return value as unknown as Phase72LongMemEvalTemporalAssemblySelection;
}

function indexUniqueCases(
  testCases: readonly LongMemEvalCase[],
): Map<string, LongMemEvalCase> {
  const indexed = new Map<string, LongMemEvalCase>();
  for (const testCase of testCases) {
    if (indexed.has(testCase.questionId)) {
      throw new Error(
        `Dataset contains duplicate question ID: ${testCase.questionId}`,
      );
    }
    indexed.set(testCase.questionId, testCase);
  }
  return indexed;
}

function validateSelectedStrata(
  selected: readonly LongMemEvalCase[],
  expected: Readonly<Record<string, number>>,
): void {
  const actual: Record<string, number> = {};
  for (const testCase of selected) {
    actual[testCase.questionType] = (actual[testCase.questionType] ?? 0) + 1;
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Temporal assembly selection strata do not match dataset.");
  }
}

function readerCase(testCase: LongMemEvalCase): LongMemEvalCase {
  return {
    answer: "",
    answerSessionIds: [],
    haystackDates: [],
    haystackSessionIds: [],
    haystackSessions: [],
    question: testCase.question,
    questionDate: testCase.questionDate,
    questionId: "paired-reader-case",
    questionType: "",
  };
}

function goldBlindMemoryCase(testCase: LongMemEvalCase): LongMemEvalCase {
  return {
    answer: "",
    answerSessionIds: [],
    haystackDates: [...testCase.haystackDates],
    haystackSessionIds: testCase.haystackSessions.map(
      (_, index) => `session-${index + 1}`,
    ),
    haystackSessions: testCase.haystackSessions.map((session) =>
      session.map(({ content, role }) => ({ content, role }))
    ),
    question: testCase.question,
    questionDate: testCase.questionDate,
    questionId: `paired-memory-${sha256(testCase.questionId).slice(0, 16)}`,
    questionType: "",
  };
}

function pairedOrder(questionId: string): Array<"baseline" | "temporal"> {
  return Number.parseInt(sha256(questionId).slice(0, 2), 16) % 2 === 0
    ? ["baseline", "temporal"]
    : ["temporal", "baseline"];
}

function safeModelIdentity(
  prefix: "GOODMEMORY_EVAL" | "GOODMEMORY_JUDGE",
  injected: boolean,
): { baseURL?: string; model: string; provider: string } {
  if (injected) {
    return { model: "injected", provider: "injected" };
  }
  const provider = process.env[`${prefix}_PROVIDER`]?.trim();
  const model = process.env[`${prefix}_MODEL`]?.trim();
  const baseURL = process.env[`${prefix}_BASE_URL`]?.trim();
  if (!provider || !model) {
    throw new Error(`Missing ${prefix} provider or model identity.`);
  }
  return {
    provider,
    model,
    ...(baseURL ? { baseURL } : {}),
  };
}

async function runGit(args: string[]): Promise<string> {
  const process = Bun.spawn(["git", ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdout = await new Response(process.stdout).text();
  if ((await process.exited) !== 0) {
    const stderr = await new Response(process.stderr).text();
    throw new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`);
  }
  return stdout;
}

async function resolveSourceState(): Promise<
  Phase72LongMemEvalTemporalAssemblySourceState
> {
  const [commit, status, diff] = await Promise.all([
    runGit(["rev-parse", "HEAD"]),
    runGit(["status", "--porcelain=v1", "--untracked-files=all"]),
    runGit(["diff", "--binary", "HEAD"]),
  ]);
  return {
    commit: commit.trim(),
    dirty: status.trim().length > 0,
    worktreeFingerprint: sha256(`${status}\0${diff}`),
  };
}

function assertSourceStateStable(
  initial: Phase72LongMemEvalTemporalAssemblySourceState,
  final: Phase72LongMemEvalTemporalAssemblySourceState,
): void {
  if (JSON.stringify(initial) !== JSON.stringify(final)) {
    throw new Error("Source state changed during paired replay.");
  }
}

export function assertPhase72LongMemEvalCandidateHoldoutSourceState(
  sourceState: Phase72LongMemEvalTemporalAssemblySourceState,
): void {
  if (sourceState.dirty) {
    throw new Error("The candidate holdout requires a clean source.");
  }
  if (!/^[0-9a-f]{40}$/u.test(sourceState.commit)) {
    throw new Error("Candidate holdout source commit must be a full Git SHA.");
  }
}

async function mapWithConcurrencyDrained<T, R>(input: {
  concurrency: number;
  items: readonly T[];
  operation: (item: T) => Promise<R>;
}): Promise<R[]> {
  const results = new Array<R>(input.items.length);
  let nextIndex = 0;
  let firstError: unknown;
  const workers = Array.from(
    { length: Math.min(input.concurrency, input.items.length) },
    async () => {
      while (firstError === undefined) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= input.items.length) return;
        try {
          results[index] = await input.operation(input.items[index]!);
        } catch (error) {
          firstError = error;
        }
      }
    },
  );
  await Promise.all(workers);
  if (firstError !== undefined) throw firstError;
  return results;
}

function summarize(
  cases: readonly PairedCaseResult[],
): Phase72LongMemEvalTemporalAssemblyReport["summary"] {
  const baselineCorrect = cases.filter(({ baseline }) => baseline.correct).length;
  const temporalCorrect = cases.filter(({ temporal }) => temporal.correct).length;
  const wins = cases.filter(({ delta }) => delta === 1).length;
  const losses = cases.filter(({ delta }) => delta === -1).length;
  return {
    baselineAccuracy: baselineCorrect / cases.length,
    baselineCorrect,
    losses,
    netWins: wins - losses,
    temporalAccuracy: temporalCorrect / cases.length,
    temporalCorrect,
    ties: cases.length - wins - losses,
    totalCases: cases.length,
    wins,
  };
}

function validateDevelopmentAuthorization(input: {
  answerModel: Phase72LongMemEvalTemporalAssemblyReport["model"]["answer"];
  benchmarkFingerprint: string;
  contextMaxTokens: number;
  currentCommit: string;
  datasetRawSha256: string;
  holdoutQuestionIds: readonly string[];
  judgeModel: NonNullable<
    Phase72LongMemEvalTemporalAssemblyReport["model"]["judge"]
  >;
  readerContextTokenCap: number;
  reportRaw: string;
}): {
  developmentReportSha256: string;
  developmentRunId: string;
} {
  const value = JSON.parse(input.reportRaw) as unknown;
  if (
    !isRecord(value) ||
    !isRecord(value.configuration) ||
    !isRecord(value.model) ||
    !isRecord(value.selection) ||
    !isRecord(value.source) ||
    !isRecord(value.source.sourceState) ||
    !isRecord(value.summary) ||
    !Array.isArray(value.cases)
  ) {
    throw new Error("Invalid paired development report.");
  }
  const developmentQuestionIds = value.cases.map((entry) =>
    isRecord(entry) && typeof entry.questionId === "string"
      ? entry.questionId
      : null
  );
  if (
    value.protocol !== PROTOCOL ||
    typeof value.runId !== "string" ||
    value.runId.length === 0 ||
    value.selection.split !== "development" ||
    value.selection.fileSha256 !== DEVELOPMENT_SELECTION_SHA256 ||
    value.selection.questionCount !== 16 ||
    value.source.benchmarkFingerprint !== input.benchmarkFingerprint ||
    value.source.datasetRawSha256 !== input.datasetRawSha256 ||
    value.source.sourceState.commit !== input.currentCommit ||
    value.source.sourceState.dirty !== false ||
    value.configuration.baselineFormat !== "product_default" ||
    value.configuration.candidateHoldoutExplicitlyOpened !== false ||
    value.configuration.contextMaxTokens !== input.contextMaxTokens ||
    value.configuration.profile !== PROFILE ||
    value.configuration.readerContextTokenCap !== input.readerContextTokenCap ||
    value.configuration.temporalFormat !== TEMPORAL_FORMAT ||
    JSON.stringify(value.model.answer) !== JSON.stringify(input.answerModel) ||
    JSON.stringify(value.model.judge) !== JSON.stringify(input.judgeModel) ||
    value.summary.totalCases !== 16 ||
    typeof value.summary.netWins !== "number" ||
    value.summary.netWins <= 0 ||
    developmentQuestionIds.some((questionId) => questionId === null) ||
    new Set(developmentQuestionIds).size !== 16 ||
    input.holdoutQuestionIds.some((questionId) =>
      developmentQuestionIds.includes(questionId)
    )
  ) {
    throw new Error(
      "Paired development report does not authorize this candidate holdout.",
    );
  }
  return {
    developmentReportSha256: sha256(input.reportRaw),
    developmentRunId: value.runId,
  };
}

function buildHoldoutGate(
  cases: readonly PairedCaseResult[],
  split: Phase72LongMemEvalTemporalAssemblySelection["split"],
): Phase72LongMemEvalTemporalAssemblyReport["holdoutGate"] {
  if (split !== "candidate_holdout") {
    return null;
  }
  const protection = cases.filter(
    ({ questionType }) => !TARGET_QUESTION_TYPES.has(questionType),
  );
  const protectionLosses = protection.filter(({ delta }) => delta < 0).length;
  const netWins = summarize(cases).netWins;
  return {
    minimumNetWins: HOLDOUT_MINIMUM_NET_WINS,
    passed:
      netWins >= HOLDOUT_MINIMUM_NET_WINS &&
      protection.length === 16 &&
      protectionLosses === 0,
    protectionLosses,
    protectionQuestionCount: protection.length,
  };
}

function assertNoRawSessionIds(
  context: string,
  testCase: LongMemEvalCase,
): void {
  const leaked = testCase.haystackSessionIds.find((id) => context.includes(id));
  if (leaked) {
    throw new Error(
      `Reader context exposes a raw LongMemEval session ID: ${leaked}`,
    );
  }
}

export async function runPhase72LongMemEvalTemporalAssemblyPaired(
  options: Phase72LongMemEvalTemporalAssemblyOptions,
  dependencies: Phase72LongMemEvalTemporalAssemblyDependencies = {},
): Promise<Phase72LongMemEvalTemporalAssemblyReport> {
  for (const [label, value] of [
    ["contextMaxTokens", options.contextMaxTokens],
    ["maxConcurrency", options.maxConcurrency],
    ["readerContextTokenCap", options.readerContextTokenCap],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${label} must be a positive integer.`);
    }
  }
  assertCliPathSegmentValue({ flag: "--run-id", value: options.runId });

  const hasInjectedDependencies = Object.keys(dependencies).length > 0;
  const readFileImpl = dependencies.readFile ??
    ((path: string) => readFile(path, "utf8"));
  const [datasetRaw, selectionRaw] = await Promise.all([
    readFileImpl(join(options.benchmarkRoot, DATASET_FILE)),
    readFileImpl(options.selectionFile),
  ]);
  const parsedDataset = JSON.parse(datasetRaw) as unknown;
  const testCases = validateLongMemEvalCases(parsedDataset);
  const benchmarkFingerprint = sha256(JSON.stringify(parsedDataset));
  const selection = parseSelection(selectionRaw);
  const selectionSha256 = sha256(selectionRaw);
  const datasetRawSha256 = sha256(datasetRaw);
  if (selection.benchmarkFingerprint !== benchmarkFingerprint) {
    throw new Error("LongMemEval benchmark fingerprint does not match.");
  }
  const casesById = indexUniqueCases(testCases);
  const selected = selection.questionIds.map((questionId) => {
    const testCase = casesById.get(questionId);
    if (!testCase) {
      throw new Error(`Selected question is missing from dataset: ${questionId}`);
    }
    return testCase;
  });
  validateSelectedStrata(selected, selection.strata);
  if (
    selection.split === "candidate_holdout" &&
    options.openCandidateHoldout === true
  ) {
    throw new Error(
      "The candidate holdout was invalidated by overlap with historical targeted profiles.",
    );
  }
  if (
    selection.split === "candidate_holdout" &&
    options.openCandidateHoldout !== true
  ) {
    throw new Error(
      "The candidate holdout remains sealed without --open-candidate-holdout.",
    );
  }
  if (
    selection.split === "development" &&
    options.openCandidateHoldout === true
  ) {
    throw new Error(
      "--open-candidate-holdout is only valid for a candidate holdout selection.",
    );
  }
  if (
    selection.split === "candidate_holdout" &&
    hasInjectedDependencies
  ) {
    throw new Error(
      "The candidate holdout requires canonical dependencies from the CLI.",
    );
  }
  if (
    selection.split === "candidate_holdout" &&
    resolve(options.outputDir) !== resolve(CANONICAL_OUTPUT_DIR)
  ) {
    throw new Error(
      `The candidate holdout output must be ${CANONICAL_OUTPUT_DIR}.`,
    );
  }
  if (
    selection.split === "candidate_holdout" &&
    selectionSha256 !== HOLDOUT_SELECTION_SHA256
  ) {
    throw new Error("Candidate holdout selection does not match the preseal.");
  }
  if (
    selection.split === "development" &&
    !hasInjectedDependencies &&
    selectionSha256 !== DEVELOPMENT_SELECTION_SHA256
  ) {
    throw new Error("Development selection does not match the preseal.");
  }

  const initialSourceState =
    dependencies.sourceState ?? await resolveSourceState();
  if (selection.split === "candidate_holdout") {
    assertPhase72LongMemEvalCandidateHoldoutSourceState(initialSourceState);
  } else if (!/^[0-9a-f]{40}$/u.test(initialSourceState.commit)) {
    throw new Error("Paired replay source commit must be a full Git SHA.");
  }

  const injectedAnswerGenerator = dependencies.answerGenerator !== undefined;
  const shouldCreateLiveJudge =
    !injectedAnswerGenerator && !Object.hasOwn(dependencies, "answerJudge");
  const answerModel = safeModelIdentity(
    "GOODMEMORY_EVAL",
    injectedAnswerGenerator,
  );
  const judgeModel = shouldCreateLiveJudge
    ? safeModelIdentity("GOODMEMORY_JUDGE", false)
    : dependencies.answerJudge
      ? safeModelIdentity("GOODMEMORY_JUDGE", true)
      : null;

  let holdoutAuthorization:
    Phase72LongMemEvalTemporalAssemblyReport["holdoutAuthorization"] = null;
  let developmentAuthorization: Omit<
    NonNullable<
      Phase72LongMemEvalTemporalAssemblyReport["holdoutAuthorization"]
    >,
    "reservationId"
  > | null = null;
  if (selection.split === "candidate_holdout") {
    if (!options.developmentReportFile) {
      throw new Error(
        "--development-report is required to open the candidate holdout.",
      );
    }
    if (!judgeModel) {
      throw new Error("Candidate holdout requires an independent judge.");
    }
    const developmentReportRaw = await readFileImpl(
      options.developmentReportFile,
    );
    developmentAuthorization = validateDevelopmentAuthorization({
      answerModel,
      benchmarkFingerprint,
      contextMaxTokens: options.contextMaxTokens,
      currentCommit: initialSourceState.commit,
      datasetRawSha256,
      holdoutQuestionIds: selection.questionIds,
      judgeModel,
      readerContextTokenCap: options.readerContextTokenCap,
      reportRaw: developmentReportRaw,
    });
  } else if (options.developmentReportFile !== undefined) {
    throw new Error(
      "--development-report is only valid for a candidate holdout selection.",
    );
  }

  const runDirectory = join(options.outputDir, options.runId);
  const mkdirImpl = dependencies.mkdir ?? mkdir;
  await mkdirImpl(options.outputDir, { recursive: true });
  await mkdirImpl(runDirectory, { recursive: false });
  if (developmentAuthorization) {
    const reservationId = sha256([
      PROTOCOL,
      datasetRawSha256,
      selectionSha256,
    ].join("\0"));
    const reservationRoot = join(
      options.outputDir,
      ".candidate-holdout-reservations",
    );
    const reservationDirectory = join(reservationRoot, reservationId);
    await mkdirImpl(reservationRoot, { recursive: true });
    try {
      await mkdirImpl(reservationDirectory, { recursive: false });
    } catch (error) {
      if (isRecord(error) && error.code === "EEXIST") {
        throw new Error(
          "This candidate holdout has already been consumed for the source commit.",
        );
      }
      throw error;
    }
    holdoutAuthorization = {
      ...developmentAuthorization,
      reservationId,
    };
    await writeFile(
      join(reservationDirectory, "reservation.json"),
      `${JSON.stringify({
        developmentReportSha256:
          developmentAuthorization.developmentReportSha256,
        developmentRunId: developmentAuthorization.developmentRunId,
        protocol: PROTOCOL,
        reservationId,
        runId: options.runId,
        selectionSha256,
        sourceCommit: initialSourceState.commit,
        status: "consumed",
      }, null, 2)}\n`,
      { flag: "wx" },
    );
  }

  const answerGenerator = dependencies.answerGenerator ??
    createLongMemEvalAnswerGenerator(resolvePhase62LiveRequestTimeoutMs());
  const answerJudge = shouldCreateLiveJudge
    ? createLongMemEvalAnswerJudge(resolvePhase62LiveRequestTimeoutMs())
    : dependencies.answerJudge;
  const memoryContextBuilder = dependencies.memoryContextBuilder ??
    createLongMemEvalGoodMemoryContextBuilder({
      createMemory: createLongMemEvalMemoryFactory(
        createHermeticLongMemEvalMemory,
        { runNamespace: options.runId },
      ),
      evidenceLedgerFormats: [TEMPORAL_FORMAT],
      maxTokens: options.contextMaxTokens,
      runId: options.runId,
    });

  let answerCalls = 0;
  let judgeCalls = 0;
  let memoryContextBuilds = 0;
  const trackedJudge = answerJudge
    ? async (input: Parameters<LongMemEvalAnswerJudge>[0]) => {
        judgeCalls += 1;
        return answerJudge(input);
      }
    : undefined;

  const cases = await mapWithConcurrencyDrained({
    concurrency: options.maxConcurrency,
    items: selected,
    operation: async (testCase) => {
      memoryContextBuilds += 1;
      const context = await memoryContextBuilder({
        profile: PROFILE,
        testCase: goldBlindMemoryCase(testCase),
      });
      const temporalContext =
        context.evidenceLedgerContexts?.[TEMPORAL_FORMAT];
      if (
        !temporalContext ||
        !context.recallSnapshotSha256 ||
        !/^[0-9a-f]{64}$/u.test(context.recallSnapshotSha256)
      ) {
        throw new Error(
          `Paired context is missing its compact ledger or snapshot: ${testCase.questionId}`,
        );
      }
      assertNoRawSessionIds(context.content, testCase);
      assertNoRawSessionIds(temporalContext, testCase);
      const contextTokens = {
        baseline: estimateTextTokens(context.content),
        temporal: estimateTextTokens(temporalContext),
      };
      if (
        contextTokens.baseline > options.readerContextTokenCap ||
        contextTokens.temporal > options.readerContextTokenCap
      ) {
        throw new Error(
          `Paired reader context exceeds the declared token cap: ${testCase.questionId}`,
        );
      }

      const order = pairedOrder(testCase.questionId);
      const completed = new Map<"baseline" | "temporal", ArmResult>();
      const answerArm = async (
        arm: "baseline" | "temporal",
      ): Promise<ArmResult> => {
        const memoryContext =
          arm === "baseline" ? context.content : temporalContext;
        answerCalls += 1;
        const hypothesis = (await answerGenerator({
          memoryContext,
          profile: PROFILE,
          prompt: testCase.question,
          testCase: readerCase(testCase),
          transcript: "",
        })).trim();
        if (hypothesis.length === 0) {
          throw new Error(
            `Answer generator returned an empty answer for ${testCase.questionId}.`,
          );
        }
        const score = await scoreLongMemEvalAnswerWithOptionalJudge({
          ...(trackedJudge ? { answerJudge: trackedJudge } : {}),
          hypothesis,
          testCase,
        });
        return {
          contextSha256: sha256(memoryContext),
          contextTokens: contextTokens[arm],
          correct: score.correct,
          hypothesis,
          score,
        };
      };
      if (context.content === temporalContext) {
        const shared = await answerArm(order[0]!);
        completed.set("baseline", shared);
        completed.set("temporal", shared);
      } else {
        for (const arm of order) {
          completed.set(arm, await answerArm(arm));
        }
      }
      const baseline = completed.get("baseline")!;
      const temporal = completed.get("temporal")!;
      return {
        armOrder: order,
        baseline,
        delta: (Number(temporal.correct) - Number(baseline.correct)) as
          | -1
          | 0
          | 1,
        questionId: testCase.questionId,
        questionType: testCase.questionType,
        recallSnapshotSha256: context.recallSnapshotSha256,
        retrievedSessionIds: context.retrievedSessionIds,
        temporal,
      };
    },
  });

  const finalSourceState =
    dependencies.sourceState ?? await resolveSourceState();
  assertSourceStateStable(initialSourceState, finalSourceState);
  const report: Phase72LongMemEvalTemporalAssemblyReport = {
    cases,
    configuration: {
      baselineFormat: "product_default",
      candidateHoldoutExplicitlyOpened:
        selection.split === "candidate_holdout",
      contextMaxTokens: options.contextMaxTokens,
      profile: PROFILE,
      readerContextTokenCap: options.readerContextTokenCap,
      temporalFormat: TEMPORAL_FORMAT,
    },
    execution: {
      answerCalls,
      judgeCalls,
      memoryContextBuilds,
    },
    holdoutAuthorization,
    holdoutGate: buildHoldoutGate(cases, selection.split),
    generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    generatedBy:
      "scripts/run-phase-72-longmemeval-temporal-assembly-paired.ts",
    model: {
      answer: answerModel,
      judge: judgeModel,
    },
    protocol: PROTOCOL,
    runId: options.runId,
    selection: {
      fileSha256: selectionSha256,
      questionCount: selection.questionIds.length,
      salt: selection.salt,
      selectionMethod: selection.selectionMethod,
      split: selection.split,
      strata: selection.strata,
    },
    source: {
      benchmarkFingerprint,
      datasetRawSha256,
      sourceState: initialSourceState,
    },
    summary: summarize(cases),
  };

  const reportPath = join(runDirectory, "report.json");
  const reportRaw = `${JSON.stringify(report, null, 2)}\n`;
  if (dependencies.writeFile) {
    await dependencies.writeFile(reportPath, reportRaw, { flag: "wx" });
  } else {
    await writeFile(reportPath, reportRaw, { flag: "wx" });
  }
  return report;
}

function requiredFlag(argv: readonly string[], flag: string): string {
  const value = resolveCliFlagValueStrict(argv, flag);
  if (!value) throw new Error(`${flag} is required.`);
  return value;
}

function parseOptions(
  argv: readonly string[],
): Phase72LongMemEvalTemporalAssemblyOptions {
  const runId = requiredFlag(argv, "--run-id");
  assertCliPathSegmentValue({ flag: "--run-id", value: runId });
  return {
    benchmarkRoot: requiredFlag(argv, "--benchmark-root"),
    contextMaxTokens:
      parseCliPositiveIntegerFlagStrict(argv, "--context-max-tokens") ?? 4_000,
    developmentReportFile:
      resolveCliFlagValueStrict(argv, "--development-report"),
    maxConcurrency:
      parseCliPositiveIntegerFlagStrict(argv, "--max-concurrency") ?? 1,
    openCandidateHoldout:
      hasCliFlagStrict(argv, "--open-candidate-holdout"),
    outputDir: requiredFlag(argv, "--output-dir"),
    readerContextTokenCap:
      parseCliPositiveIntegerFlagStrict(
        argv,
        "--reader-context-token-cap",
      ) ?? 6_000,
    runId,
    selectionFile: requiredFlag(argv, "--selection-file"),
  };
}

if (import.meta.main) {
  const report = await runPhase72LongMemEvalTemporalAssemblyPaired(
    parseOptions(process.argv.slice(2).filter((value) => value !== "--")),
  );
  console.log(JSON.stringify({
    runId: report.runId,
    summary: report.summary,
  }, null, 2));
}
