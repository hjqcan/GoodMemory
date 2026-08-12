import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  createInternalGoodMemory,
} from "../src/api/createGoodMemory";
import type { GoodMemoryConfig } from "../src/api/contracts";
import {
  createLongMemEvalGoodMemoryContextBuilder,
  validateLongMemEvalCases,
} from "../src/eval/longmemeval";
import type {
  LongMemEvalCase,
  LongMemEvalMemoryContext,
  LongMemEvalMemoryContextBuilder,
} from "../src/eval/longmemeval";
import { createLanguageService } from "../src/language";
import type { LanguageService } from "../src/language";
import { splitQueryIntoSubQueries } from "../src/recall/queryDecomposition";
import { estimateTextTokens } from "../src/tokenEstimator";
import {
  assertCliPathSegmentValue,
  resolveCliFlagValueStrict,
} from "./cli-options";
import {
  createHermeticLongMemEvalMemory,
  createLongMemEvalMemoryFactory,
} from "./run-phase-62-eval";

const PROTOCOL =
  "phase72_longmemeval_operand_head_preservation_development_v1";
const DATASET_FILE = "longmemeval_s_cleaned.json";
const PROFILE = "goodmemory-recommended";
const CONTEXT_MAX_TOKENS = 4_000;
const READER_CONTEXT_TOKEN_CAP = 6_000;
const PRE_RANK_LIMIT = 32;
const SELECTED_LIMIT = 12;
const REQUIRED_BUN_VERSION = "1.3.14";
const REQUIRED_ENGLISH_ANALYZER_VERSION = "13";
const CANONICAL_MEMORY_RUN_ID =
  "phase72-operand-head-preservation-development-v1";

export interface Phase72OperandHeadPreservationPreseal {
  benchmarkFingerprint: string;
  datasetRawSha256: string;
  selectionSha256: string;
}

const DEFAULT_PRESEAL: Phase72OperandHeadPreservationPreseal = {
  benchmarkFingerprint:
    "195fa256c468ff68079f5a05de2572deb47fa2c06b5d48e1d3ad4f3e044a5203",
  datasetRawSha256:
    "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
  selectionSha256:
    "b25fb4d099da5d7b6fc68d9c08808ff69643b2c1cb5bcbe6aa671ddbaf631c47",
};

interface SourceState {
  commit: string;
  dirty: boolean;
  worktreeFingerprint: string;
}

interface ContextBuilders {
  control: LongMemEvalMemoryContextBuilder;
  treatment: LongMemEvalMemoryContextBuilder;
}

interface Selection {
  analyzerVersion: typeof REQUIRED_ENGLISH_ANALYZER_VERSION;
  benchmarkFingerprint: string;
  datasetRawSha256: string;
  frozenBeforeTreatmentImplementation: true;
  languagePackId: "en";
  protocol: typeof PROTOCOL;
  questionIds: string[];
  salt: string;
  schemaVersion: 1;
  selectionMethod: string;
  split: "development";
  strata: Record<string, number>;
}

interface RetrievalArmResult {
  contextSha256: string;
  contextTokens: number;
  coveredGoldSessionIds: string[];
  nonGoldVisibleSessionIds: string[];
  queryCalls: number;
  readerVisibleSessionIds: string[];
  recallRecordCount: number;
  recallSnapshotSha256: string;
  subQueries: string[];
}

interface RetrievalCaseResult {
  addedGoldSessionIds: string[];
  addedVisibleSessionIds: string[];
  contextTokenDelta: number;
  control: RetrievalArmResult;
  goldSessionIds: string[];
  lostGoldSessionIds: string[];
  lostVisibleSessionIds: string[];
  nonGoldVisibleSessionDelta: number;
  questionId: string;
  recallRecordCountDelta: number;
  temporalOperands: string[];
  treatment: RetrievalArmResult;
}

export interface Phase72OperandHeadPreservationReport {
  cases: RetrievalCaseResult[];
  configuration: {
    contextMaxTokens: number;
    control: "primary_preserving_rrf";
    preRankLimit: number;
    profile: typeof PROFILE;
    readerContextTokenCap: number;
    selectedLimit: number;
    treatment: "distinct_recall_pass_head_preservation";
  };
  execution: {
    answerCalls: 0;
    holdoutCalls: 0;
    judgeCalls: 0;
    memoryContextBuilds: number;
  };
  generatedAt: string;
  generatedBy:
    "scripts/run-phase-72-longmemeval-operand-head-preservation-development.ts";
  protocol: typeof PROTOCOL;
  runId: string;
  selection: {
    fileSha256: string;
    questionCount: number;
    salt: string;
    selectionMethod: string;
    split: "development";
    strata: Record<string, number>;
  };
  source: {
    benchmarkFingerprint: string;
    bunVersion: string;
    canonicalDependencies: boolean;
    datasetRawSha256: string;
    englishAnalyzerVersion: string;
    scriptSha256: string;
    sourceState: SourceState;
  };
  summary: {
    addedGoldEndpointCount: number;
    answerConversionAuthorized: false;
    canonicalRun: boolean;
    controlContextTokens: number;
    controlCoveredGoldEndpointCount: number;
    controlNonGoldVisibleEndpointCount: number;
    controlQueryCalls: number;
    controlRecallRecordCount: number;
    developmentRetrievalCriteriaPassed: boolean;
    developmentRetrievalGatePassed: boolean;
    goldEndpointCount: number;
    improvedCaseCount: number;
    lostGoldEndpointCount: number;
    queryCountMismatchCount: number;
    regressedCaseCount: number;
    treatmentContextTokens: number;
    treatmentCoveredGoldEndpointCount: number;
    treatmentNonGoldVisibleEndpointCount: number;
    treatmentQueryCalls: number;
    treatmentRecallRecordCount: number;
  };
}

export interface Phase72OperandHeadPreservationOptions {
  benchmarkRoot: string;
  outputDir: string;
  runId: string;
  selectionFile: string;
}

export interface Phase72OperandHeadPreservationDependencies {
  bunVersion?: string;
  contextBuilders?: ContextBuilders;
  mkdir?: (
    path: string,
    options: { recursive: boolean },
  ) => Promise<unknown>;
  now?: () => Date;
  preseal?: Phase72OperandHeadPreservationPreseal;
  readFile?: (path: string) => Promise<string>;
  scriptPath?: string;
  sourceState?: SourceState;
  writeFile?: (
    path: string,
    value: string,
    options: { flag: "wx" },
  ) => Promise<unknown>;
}

export function hasCanonicalOperandHeadPreservationDependencies(
  dependencies: Phase72OperandHeadPreservationDependencies,
): boolean {
  return Object.keys(dependencies).length === 0;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSelection(raw: string): Selection {
  const value = JSON.parse(raw) as unknown;
  if (
    !isRecord(value) ||
    !isRecord(value.strata) ||
    value.schemaVersion !== 1 ||
    value.protocol !== PROTOCOL ||
    value.split !== "development" ||
    value.frozenBeforeTreatmentImplementation !== true ||
    value.languagePackId !== "en" ||
    value.analyzerVersion !== REQUIRED_ENGLISH_ANALYZER_VERSION ||
    typeof value.benchmarkFingerprint !== "string" ||
    typeof value.datasetRawSha256 !== "string" ||
    typeof value.selectionMethod !== "string" ||
    value.selectionMethod.length === 0 ||
    typeof value.salt !== "string" ||
    value.salt.length === 0 ||
    !Array.isArray(value.questionIds) ||
    value.questionIds.length === 0 ||
    value.questionIds.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    throw new Error("Invalid operand-head preservation development selection.");
  }
  const questionIds = [...value.questionIds] as string[];
  const strata = Object.fromEntries(Object.entries(value.strata));
  if (
    new Set(questionIds).size !== questionIds.length ||
    Object.entries(strata).some(
      ([key, count]) =>
        !/^temporal_operands_[12]$/u.test(key) ||
        !Number.isInteger(count) ||
        Number(count) < 1,
    ) ||
    Object.values(strata).reduce<number>(
      (total, count) => total + Number(count),
      0,
    ) !== questionIds.length
  ) {
    throw new Error("Invalid operand-head preservation selection contents.");
  }
  return {
    analyzerVersion: REQUIRED_ENGLISH_ANALYZER_VERSION,
    benchmarkFingerprint: value.benchmarkFingerprint,
    datasetRawSha256: value.datasetRawSha256,
    frozenBeforeTreatmentImplementation: true,
    languagePackId: "en",
    protocol: PROTOCOL,
    questionIds,
    salt: value.salt,
    schemaVersion: 1,
    selectionMethod: value.selectionMethod,
    split: "development",
    strata: strata as Record<string, number>,
  };
}

function temporalOperands(
  question: string,
  language: LanguageService,
): string[] {
  const context = language.resolveFromText({ text: question });
  const analysis = language.analyzeQuery(question, context);
  if ((analysis.temporalOperands?.length ?? 0) === 0) {
    return [];
  }
  return splitQueryIntoSubQueries(question, {
    analysis,
    language,
    languageContext: context,
  });
}

function indexCases(cases: readonly LongMemEvalCase[]): Map<string, LongMemEvalCase> {
  const indexed = new Map<string, LongMemEvalCase>();
  for (const testCase of cases) {
    if (indexed.has(testCase.questionId)) {
      throw new Error(`Duplicate LongMemEval question ID: ${testCase.questionId}`);
    }
    indexed.set(testCase.questionId, testCase);
  }
  return indexed;
}

function validateSelectionStrata(
  cases: readonly LongMemEvalCase[],
  expected: Readonly<Record<string, number>>,
  language: LanguageService,
): void {
  const actual: Record<string, number> = {};
  for (const testCase of cases) {
    const count = temporalOperands(testCase.question, language).length;
    if (count !== 1 && count !== 2) {
      throw new Error(
        `Selected question has no bounded temporal operands: ${testCase.questionId}`,
      );
    }
    const key = `temporal_operands_${count}`;
    actual[key] = (actual[key] ?? 0) + 1;
  }
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  if ([...keys].some((key) => actual[key] !== expected[key])) {
    throw new Error("Operand-head preservation selection strata drifted.");
  }
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
    questionId: `operand-head-memory-${sha256(testCase.questionId).slice(0, 16)}`,
    questionType: "",
  };
}

function goldSessionIds(testCase: LongMemEvalCase): string[] {
  return [...new Set(testCase.answerSessionIds.map((sessionId) => {
    const index = testCase.haystackSessionIds.indexOf(sessionId);
    if (index < 0) {
      throw new Error(
        `Gold session is absent from the haystack: ${testCase.questionId}`,
      );
    }
    return `session-${index + 1}`;
  }))];
}

function difference(values: readonly string[], excluded: readonly string[]): string[] {
  const excludedSet = new Set(excluded);
  return values.filter((value) => !excludedSet.has(value));
}

function buildArmResult(input: {
  context: LongMemEvalMemoryContext;
  expectedSubQueries: readonly string[];
  goldSessionIds: readonly string[];
  originalCase: LongMemEvalCase;
}): RetrievalArmResult {
  const diagnostics = input.context.recallDiagnostics;
  if (
    !diagnostics ||
    diagnostics.ambiguousReaderVisibleSessionIds.length > 0 ||
    diagnostics.preRankLimit !== PRE_RANK_LIMIT ||
    !Number.isInteger(diagnostics.queryCalls) ||
    !Number.isInteger(diagnostics.recallRecordCount) ||
    diagnostics.selectedLimit !== SELECTED_LIMIT ||
    typeof input.context.recallSnapshotSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(input.context.recallSnapshotSha256)
  ) {
    throw new Error(
      `Invalid runtime retrieval diagnostics or fixed 32/12 recall budget: ${input.originalCase.questionId}`,
    );
  }
  if (
    diagnostics.queryCalls !== 1 + input.expectedSubQueries.length ||
    JSON.stringify(diagnostics.subQueries) !==
      JSON.stringify(input.expectedSubQueries)
  ) {
    throw new Error(
      `Runtime recall trace does not match temporal operands: ${input.originalCase.questionId}`,
    );
  }
  const allowedSessionIds = new Set(
    input.originalCase.haystackSessions.map((_, index) => `session-${index + 1}`),
  );
  const readerVisibleSessionIds = [...new Set(
    diagnostics.readerVisibleSessionIds,
  )];
  if (readerVisibleSessionIds.some((id) => !allowedSessionIds.has(id))) {
    throw new Error(
      `Runtime retrieval exposed an unknown session: ${input.originalCase.questionId}`,
    );
  }
  const leaked = input.originalCase.haystackSessionIds.find((sessionId) =>
    input.context.content.includes(sessionId)
  );
  if (leaked) {
    throw new Error(`Reader context exposes a raw LongMemEval session ID: ${leaked}`);
  }
  const contextTokens = estimateTextTokens(input.context.content);
  if (contextTokens > READER_CONTEXT_TOKEN_CAP) {
    throw new Error(
      `Reader context exceeds the token cap: ${input.originalCase.questionId}`,
    );
  }
  return {
    contextSha256: sha256(input.context.content),
    contextTokens,
    coveredGoldSessionIds: input.goldSessionIds.filter((id) =>
      readerVisibleSessionIds.includes(id)
    ),
    nonGoldVisibleSessionIds: difference(
      readerVisibleSessionIds,
      input.goldSessionIds,
    ),
    queryCalls: diagnostics.queryCalls,
    readerVisibleSessionIds,
    recallRecordCount: diagnostics.recallRecordCount,
    recallSnapshotSha256: input.context.recallSnapshotSha256,
    subQueries: [...diagnostics.subQueries],
  };
}

function createHeadProtectedLongMemEvalMemory(
  config: GoodMemoryConfig,
) {
  return createInternalGoodMemory(config, {
    distinctRecallPassHeadProtection: true,
    environment: {},
    projectionBulkBackfill: true,
    projectionWriteThrough: false,
  });
}

function createCanonicalContextBuilders(): ContextBuilders {
  const shared = {
    evidenceLedgerFormats: ["compact_json"] as const,
    ingestMode: "label-free-raw" as const,
    maxTokens: CONTEXT_MAX_TOKENS,
    recallOptions: { decompose: true, multiHop: false },
    runId: CANONICAL_MEMORY_RUN_ID,
    supplementalEvidenceLimit: 6,
    supplementalEvidencePerSessionLimit: 2,
  };
  const control = createLongMemEvalMemoryFactory(
    createHermeticLongMemEvalMemory,
    { runNamespace: CANONICAL_MEMORY_RUN_ID },
  );
  const treatment = createLongMemEvalMemoryFactory(
    createHeadProtectedLongMemEvalMemory,
    { runNamespace: CANONICAL_MEMORY_RUN_ID },
  );
  return {
    control: createLongMemEvalGoodMemoryContextBuilder({
      ...shared,
      createMemory: control,
    }),
    treatment: createLongMemEvalGoodMemoryContextBuilder({
      ...shared,
      createMemory: treatment,
    }),
  };
}

async function runGit(args: string[]): Promise<string> {
  const process = Bun.spawn(["git", ...args], {
    cwd: join(import.meta.dir, ".."),
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

async function resolveSourceState(): Promise<SourceState> {
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

function summarize(
  cases: readonly RetrievalCaseResult[],
  canonicalRun: boolean,
): Phase72OperandHeadPreservationReport["summary"] {
  const sum = (
    selector: (result: RetrievalCaseResult) => number,
  ) => cases.reduce((total, result) => total + selector(result), 0);
  const controlCoveredGoldEndpointCount = sum(
    ({ control }) => control.coveredGoldSessionIds.length,
  );
  const treatmentCoveredGoldEndpointCount = sum(
    ({ treatment }) => treatment.coveredGoldSessionIds.length,
  );
  const addedGoldEndpointCount = sum(
    ({ addedGoldSessionIds }) => addedGoldSessionIds.length,
  );
  const goldEndpointCount = sum(
    ({ goldSessionIds }) => goldSessionIds.length,
  );
  const lostGoldEndpointCount = sum(
    ({ lostGoldSessionIds }) => lostGoldSessionIds.length,
  );
  const queryCountMismatchCount = cases.filter(
    ({ control, treatment }) => control.queryCalls !== treatment.queryCalls,
  ).length;
  const developmentRetrievalCriteriaPassed =
    treatmentCoveredGoldEndpointCount > controlCoveredGoldEndpointCount &&
    addedGoldEndpointCount > 0 &&
    lostGoldEndpointCount === 0 &&
    queryCountMismatchCount === 0;
  return {
    addedGoldEndpointCount,
    answerConversionAuthorized: false,
    canonicalRun,
    controlContextTokens: sum(({ control }) => control.contextTokens),
    controlCoveredGoldEndpointCount,
    controlNonGoldVisibleEndpointCount: sum(
      ({ control }) => control.nonGoldVisibleSessionIds.length,
    ),
    controlQueryCalls: sum(({ control }) => control.queryCalls),
    controlRecallRecordCount: sum(({ control }) => control.recallRecordCount),
    developmentRetrievalCriteriaPassed,
    developmentRetrievalGatePassed:
      canonicalRun && developmentRetrievalCriteriaPassed,
    goldEndpointCount,
    improvedCaseCount: cases.filter(
      ({ addedGoldSessionIds }) => addedGoldSessionIds.length > 0,
    ).length,
    lostGoldEndpointCount,
    queryCountMismatchCount,
    regressedCaseCount: cases.filter(
      ({ lostGoldSessionIds }) => lostGoldSessionIds.length > 0,
    ).length,
    treatmentContextTokens: sum(({ treatment }) => treatment.contextTokens),
    treatmentCoveredGoldEndpointCount,
    treatmentNonGoldVisibleEndpointCount: sum(
      ({ treatment }) => treatment.nonGoldVisibleSessionIds.length,
    ),
    treatmentQueryCalls: sum(({ treatment }) => treatment.queryCalls),
    treatmentRecallRecordCount: sum(
      ({ treatment }) => treatment.recallRecordCount,
    ),
  };
}

export async function runPhase72LongMemEvalOperandHeadPreservationDevelopment(
  options: Phase72OperandHeadPreservationOptions,
  dependencies: Phase72OperandHeadPreservationDependencies = {},
): Promise<Phase72OperandHeadPreservationReport> {
  assertCliPathSegmentValue({ flag: "--run-id", value: options.runId });
  const bunVersion = dependencies.bunVersion ?? Bun.version;
  if (bunVersion !== REQUIRED_BUN_VERSION) {
    throw new Error(`Bun ${REQUIRED_BUN_VERSION} is required; found ${bunVersion}.`);
  }
  const canonicalDependencies =
    hasCanonicalOperandHeadPreservationDependencies(dependencies);
  const language = createLanguageService();
  const analyzerVersion = language.analyzerVersion("en-US");
  if (
    canonicalDependencies &&
    analyzerVersion !== REQUIRED_ENGLISH_ANALYZER_VERSION
  ) {
    throw new Error(
      `English analyzer ${REQUIRED_ENGLISH_ANALYZER_VERSION} is required; found ${analyzerVersion}.`,
    );
  }
  const preseal = dependencies.preseal ?? DEFAULT_PRESEAL;
  const readFileImpl = dependencies.readFile ??
    ((path: string) => readFile(path, "utf8"));
  const scriptPath = dependencies.scriptPath ?? import.meta.path;
  const [datasetRaw, selectionRaw, scriptRaw] = await Promise.all([
    readFileImpl(join(options.benchmarkRoot, DATASET_FILE)),
    readFileImpl(options.selectionFile),
    readFileImpl(scriptPath),
  ]);
  if (
    sha256(datasetRaw) !== preseal.datasetRawSha256 ||
    sha256(selectionRaw) !== preseal.selectionSha256
  ) {
    throw new Error("Operand-head preservation data does not match the preseal.");
  }
  const parsedDataset = JSON.parse(datasetRaw) as unknown;
  const benchmarkFingerprint = sha256(JSON.stringify(parsedDataset));
  if (benchmarkFingerprint !== preseal.benchmarkFingerprint) {
    throw new Error("LongMemEval benchmark fingerprint does not match the preseal.");
  }
  const selection = parseSelection(selectionRaw);
  if (
    selection.benchmarkFingerprint !== benchmarkFingerprint ||
    selection.datasetRawSha256 !== preseal.datasetRawSha256
  ) {
    throw new Error("Operand-head preservation selection identity drifted.");
  }
  const casesById = indexCases(validateLongMemEvalCases(parsedDataset));
  const selected = selection.questionIds.map((questionId) => {
    const testCase = casesById.get(questionId);
    if (!testCase) {
      throw new Error(`Selected LongMemEval case is missing: ${questionId}`);
    }
    return testCase;
  });
  validateSelectionStrata(selected, selection.strata, language);

  const initialSourceState = dependencies.sourceState ?? await resolveSourceState();
  if (initialSourceState.dirty || !/^[0-9a-f]{40}$/u.test(initialSourceState.commit)) {
    throw new Error("Operand-head preservation replay requires a clean commit.");
  }
  const mkdirImpl = dependencies.mkdir ?? mkdir;
  await mkdirImpl(options.outputDir, { recursive: true });
  const runDirectory = join(options.outputDir, options.runId);
  await mkdirImpl(runDirectory, { recursive: false });
  const builders = dependencies.contextBuilders ?? createCanonicalContextBuilders();

  const controls = new Map<string, RetrievalArmResult>();
  for (const testCase of selected) {
    const operands = temporalOperands(testCase.question, language);
    const control = buildArmResult({
      context: await builders.control({
        profile: PROFILE,
        testCase: goldBlindMemoryCase(testCase),
      }),
      expectedSubQueries: operands,
      goldSessionIds: goldSessionIds(testCase),
      originalCase: testCase,
    });
    controls.set(testCase.questionId, control);
    console.log("[phase-72:operand-head] control measured", {
      coveredGold: control.coveredGoldSessionIds.length,
      queryCalls: control.queryCalls,
      questionId: testCase.questionId,
    });
  }

  const cases: RetrievalCaseResult[] = [];
  for (const testCase of selected) {
    const operands = temporalOperands(testCase.question, language);
    const gold = goldSessionIds(testCase);
    const treatment = buildArmResult({
      context: await builders.treatment({
        profile: PROFILE,
        testCase: goldBlindMemoryCase(testCase),
      }),
      expectedSubQueries: operands,
      goldSessionIds: gold,
      originalCase: testCase,
    });
    const control = controls.get(testCase.questionId)!;
    const result: RetrievalCaseResult = {
      addedGoldSessionIds: difference(
        treatment.coveredGoldSessionIds,
        control.coveredGoldSessionIds,
      ),
      addedVisibleSessionIds: difference(
        treatment.readerVisibleSessionIds,
        control.readerVisibleSessionIds,
      ),
      contextTokenDelta: treatment.contextTokens - control.contextTokens,
      control,
      goldSessionIds: gold,
      lostGoldSessionIds: difference(
        control.coveredGoldSessionIds,
        treatment.coveredGoldSessionIds,
      ),
      lostVisibleSessionIds: difference(
        control.readerVisibleSessionIds,
        treatment.readerVisibleSessionIds,
      ),
      nonGoldVisibleSessionDelta:
        treatment.nonGoldVisibleSessionIds.length -
        control.nonGoldVisibleSessionIds.length,
      questionId: testCase.questionId,
      recallRecordCountDelta:
        treatment.recallRecordCount - control.recallRecordCount,
      temporalOperands: operands,
      treatment,
    };
    cases.push(result);
    console.log("[phase-72:operand-head] treatment measured", {
      addedGold: result.addedGoldSessionIds,
      lostGold: result.lostGoldSessionIds,
      questionId: testCase.questionId,
    });
  }

  const finalSourceState = dependencies.sourceState ?? await resolveSourceState();
  if (JSON.stringify(finalSourceState) !== JSON.stringify(initialSourceState)) {
    throw new Error("Source state changed during operand-head preservation replay.");
  }
  const canonicalRun = canonicalDependencies && !initialSourceState.dirty;
  const report: Phase72OperandHeadPreservationReport = {
    cases,
    configuration: {
      contextMaxTokens: CONTEXT_MAX_TOKENS,
      control: "primary_preserving_rrf",
      preRankLimit: PRE_RANK_LIMIT,
      profile: PROFILE,
      readerContextTokenCap: READER_CONTEXT_TOKEN_CAP,
      selectedLimit: SELECTED_LIMIT,
      treatment: "distinct_recall_pass_head_preservation",
    },
    execution: {
      answerCalls: 0,
      holdoutCalls: 0,
      judgeCalls: 0,
      memoryContextBuilds: selected.length * 2,
    },
    generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    generatedBy:
      "scripts/run-phase-72-longmemeval-operand-head-preservation-development.ts",
    protocol: PROTOCOL,
    runId: options.runId,
    selection: {
      fileSha256: sha256(selectionRaw),
      questionCount: selected.length,
      salt: selection.salt,
      selectionMethod: selection.selectionMethod,
      split: "development",
      strata: selection.strata,
    },
    source: {
      benchmarkFingerprint,
      bunVersion,
      canonicalDependencies,
      datasetRawSha256: sha256(datasetRaw),
      englishAnalyzerVersion: analyzerVersion,
      scriptSha256: sha256(scriptRaw),
      sourceState: initialSourceState,
    },
    summary: summarize(cases, canonicalRun),
  };
  const writeFileImpl = dependencies.writeFile ?? writeFile;
  await writeFileImpl(
    join(runDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { flag: "wx" },
  );
  return report;
}

function requiredFlag(argv: readonly string[], flag: string): string {
  const value = resolveCliFlagValueStrict(argv, flag);
  if (!value) throw new Error(`${flag} is required.`);
  return value;
}

function parseOptions(
  argv: readonly string[],
): Phase72OperandHeadPreservationOptions {
  return {
    benchmarkRoot: requiredFlag(argv, "--benchmark-root"),
    outputDir: requiredFlag(argv, "--output-dir"),
    runId: requiredFlag(argv, "--run-id"),
    selectionFile: requiredFlag(argv, "--selection-file"),
  };
}

if (import.meta.main) {
  const report =
    await runPhase72LongMemEvalOperandHeadPreservationDevelopment(
      parseOptions(process.argv.slice(2).filter((value) => value !== "--")),
    );
  console.log(JSON.stringify({
    runId: report.runId,
    summary: report.summary,
  }, null, 2));
}
