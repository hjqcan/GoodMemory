import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  createLongMemEvalGoodMemoryContextBuilder,
  validateLongMemEvalCases,
} from "../src/eval/longmemeval";
import type {
  LongMemEvalCase,
  LongMemEvalMemoryContext,
  LongMemEvalMemoryContextBuilder,
} from "../src/eval/longmemeval";
import {
  createEnglishLanguagePack,
  createLanguageService,
} from "../src/language";
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

const PROTOCOL = "longmemeval_temporal_operand_retrieval_stage_a_v2";
const SOURCE_SELECTION_PROTOCOL =
  "longmemeval_current_recall_assembly_paired_v2";
const DATASET_FILE = "longmemeval_s_cleaned.json";
const PROFILE = "goodmemory-recommended";
const CONTEXT_MAX_TOKENS = 4_000;
const READER_CONTEXT_TOKEN_CAP = 6_000;
const REQUIRED_BUN_VERSION = "1.3.14";
const REQUIRED_ENGLISH_ANALYZER_VERSION = "13";
const LEGACY_CONTROL_ENGLISH_ANALYZER_VERSION = "12";
const CANONICAL_MEMORY_RUN_ID =
  "run-phase72-current-recall-assembly-development-v2-bun1314-clean";
const CANONICAL_CONTROL_SOURCE_COMMIT =
  "466517c7a022c6c142ed67c9ab02322272cf5553";

export interface Phase72LongMemEvalTemporalOperandsPreseal {
  benchmarkFingerprint: string;
  controlReportSha256: string;
  datasetRawSha256: string;
  selectionSha256: string;
}

const DEFAULT_PRESEAL: Phase72LongMemEvalTemporalOperandsPreseal = {
  benchmarkFingerprint:
    "195fa256c468ff68079f5a05de2572deb47fa2c06b5d48e1d3ad4f3e044a5203",
  controlReportSha256:
    "48904b86169e5ff6caf58e3c2638a7826c594f05e839153acff559d5e9762233",
  datasetRawSha256:
    "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
  selectionSha256:
    "3df24634d8f661ad2a6a054ec628114fcbab038d5b130e41800ab1b64a11e29e",
};

export interface Phase72LongMemEvalTemporalOperandsOptions {
  benchmarkRoot: string;
  controlReportFile: string;
  outputDir: string;
  runId: string;
  selectionFile: string;
}

interface SourceState {
  commit: string;
  dirty: boolean;
  worktreeFingerprint: string;
}

interface ContextBuilders {
  control: LongMemEvalMemoryContextBuilder;
  treatmentDecomposed: LongMemEvalMemoryContextBuilder;
  treatmentSinglePass: LongMemEvalMemoryContextBuilder;
}

export interface Phase72LongMemEvalTemporalOperandsDependencies {
  bunVersion?: string;
  contextBuilders?: ContextBuilders;
  mkdir?: (
    path: string,
    options: { recursive: boolean },
  ) => Promise<unknown>;
  now?: () => Date;
  preseal?: Phase72LongMemEvalTemporalOperandsPreseal;
  readFile?: (path: string) => Promise<string>;
  scriptPath?: string;
  sourceState?: SourceState;
  writeFile?: (
    path: string,
    value: string,
    options: { flag: "wx" },
  ) => Promise<unknown>;
}

interface Selection {
  benchmarkFingerprint: string;
  protocol: typeof SOURCE_SELECTION_PROTOCOL;
  questionIds: string[];
  salt: string;
  schemaVersion: 1;
  selectionMethod: string;
  split: "development";
  strata: Record<string, number>;
}

interface ControlOracleCase {
  contextSha256: string;
  contextTokens: number;
  questionId: string;
  recallSnapshotSha256: string;
  retrievedSessionIds: string[];
}

interface RetrievalArmResult {
  ambiguousReaderVisibleSessionIds: string[];
  contextSha256: string;
  contextTokens: number;
  coveredGoldSessionIds: string[];
  missingGoldSessionIds: string[];
  nonGoldVisibleSessionIds: string[];
  queryCalls: number;
  readerVisibleSessionIds: string[];
  recallRecordCount: number;
  recallSnapshotSha256: string;
  recallUnionSessionIds: string[];
  subQueries: string[];
}

interface RetrievalCaseResult {
  addedGoldSessionIds: string[];
  addedVisibleSessionIds: string[];
  contextTokenDelta: number;
  control: RetrievalArmResult;
  goldSessionIds: string[];
  legacyControlRecallSnapshotMatched: boolean;
  legacyControlRecallSnapshotSha256: string;
  lostGoldSessionIds: string[];
  lostVisibleSessionIds: string[];
  nonGoldVisibleSessionDelta: number;
  questionId: string;
  questionType: string;
  recallRecordCountDelta: number;
  temporalOperands: string[];
  treatment: RetrievalArmResult;
}

export interface Phase72LongMemEvalTemporalOperandsReport {
  cases: RetrievalCaseResult[];
  configuration: {
    contextMaxTokens: typeof CONTEXT_MAX_TOKENS;
    controlOracle: "legacy_v2_surface_identity";
    legacyRecallSnapshot: "disclosure_only_after_analyzer_identity_migration";
    profile: typeof PROFILE;
    readerContextTokenCap: typeof READER_CONTEXT_TOKEN_CAP;
    treatment: "query_derived_temporal_operands";
  };
  generatedAt: string;
  generatedBy:
    "scripts/run-phase-72-longmemeval-temporal-operands-development.ts";
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
    canonicalControlReportSha256: string;
    canonicalControlSourceCommit: typeof CANONICAL_CONTROL_SOURCE_COMMIT;
    canonicalMemoryRunId: typeof CANONICAL_MEMORY_RUN_ID;
    datasetRawSha256: string;
    englishAnalyzerVersion: typeof REQUIRED_ENGLISH_ANALYZER_VERSION;
    legacyControlEnglishAnalyzerVersion:
      typeof LEGACY_CONTROL_ENGLISH_ANALYZER_VERSION;
    scriptSha256: string;
    sourceState: SourceState;
  };
  summary: {
    addedGoldEndpointCount: number;
    answerConversionAuthorized: false;
    controlCoveredGoldEndpointCount: number;
    controlQueryCalls: number;
    developmentRetrievalCriteriaPassed: boolean;
    developmentRetrievalGatePassed: boolean;
    improvedCaseCount: number;
    legacyControlSnapshotMatchCount: number;
    lostGoldEndpointCount: number;
    regressedCaseCount: number;
    treatmentCoveredGoldEndpointCount: number;
    treatmentQueryCalls: number;
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : null;
}

function parseSelection(raw: string): Selection {
  const value = JSON.parse(raw) as unknown;
  if (
    !isRecord(value) ||
    !isRecord(value.strata) ||
    value.schemaVersion !== 1 ||
    value.protocol !== SOURCE_SELECTION_PROTOCOL ||
    value.split !== "development" ||
    typeof value.benchmarkFingerprint !== "string" ||
    typeof value.salt !== "string" ||
    typeof value.selectionMethod !== "string"
  ) {
    throw new Error("Invalid temporal operand development selection.");
  }
  const questionIds = stringArray(value.questionIds);
  if (!questionIds || questionIds.length === 0) {
    throw new Error("Temporal operand development selection is empty.");
  }
  const strata = Object.fromEntries(Object.entries(value.strata).map(
    ([key, count]) => [key, count],
  ));
  if (
    new Set(questionIds).size !== questionIds.length ||
    Object.values(strata).some(
      (count) => !Number.isInteger(count) || (count as number) < 1,
    ) ||
    Object.values(strata).reduce<number>(
      (total, count) => total + Number(count),
      0,
    ) !== questionIds.length
  ) {
    throw new Error("Invalid temporal operand development selection contents.");
  }
  return {
    benchmarkFingerprint: value.benchmarkFingerprint,
    protocol: SOURCE_SELECTION_PROTOCOL,
    questionIds,
    salt: value.salt,
    schemaVersion: 1,
    selectionMethod: value.selectionMethod,
    split: "development",
    strata: strata as Record<string, number>,
  };
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

function validateStrata(
  cases: readonly LongMemEvalCase[],
  expected: Readonly<Record<string, number>>,
): void {
  const actual: Record<string, number> = {};
  for (const testCase of cases) {
    actual[testCase.questionType] = (actual[testCase.questionType] ?? 0) + 1;
  }
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  if ([...keys].some((key) => actual[key] !== expected[key])) {
    throw new Error("Temporal operand selection strata do not match the dataset.");
  }
}

function parseControlOracle(input: {
  preseal: Phase72LongMemEvalTemporalOperandsPreseal;
  raw: string;
  selection: Selection;
}): Map<string, ControlOracleCase> {
  if (sha256(input.raw) !== input.preseal.controlReportSha256) {
    throw new Error("Canonical control report does not match the preseal.");
  }
  const value = JSON.parse(input.raw) as unknown;
  if (
    !isRecord(value) ||
    !Array.isArray(value.cases) ||
    !isRecord(value.selection) ||
    !isRecord(value.source) ||
    !isRecord(value.source.sourceState) ||
    value.protocol !== SOURCE_SELECTION_PROTOCOL ||
    value.runId !== CANONICAL_MEMORY_RUN_ID ||
    value.selection.split !== "development" ||
    value.selection.fileSha256 !== input.preseal.selectionSha256 ||
    value.selection.questionCount !== input.selection.questionIds.length ||
    value.source.benchmarkFingerprint !== input.preseal.benchmarkFingerprint ||
    value.source.datasetRawSha256 !== input.preseal.datasetRawSha256 ||
    value.source.sourceState.commit !== CANONICAL_CONTROL_SOURCE_COMMIT ||
    value.source.sourceState.dirty !== false ||
    value.cases.length !== input.selection.questionIds.length
  ) {
    throw new Error("Canonical control report identity is invalid.");
  }

  const oracle = new Map<string, ControlOracleCase>();
  for (const [index, entry] of value.cases.entries()) {
    if (
      !isRecord(entry) ||
      !isRecord(entry.baseline) ||
      typeof entry.questionId !== "string" ||
      entry.questionId !== input.selection.questionIds[index] ||
      typeof entry.baseline.contextSha256 !== "string" ||
      typeof entry.baseline.contextTokens !== "number" ||
      typeof entry.recallSnapshotSha256 !== "string"
    ) {
      throw new Error("Canonical control report case identity is invalid.");
    }
    const retrievedSessionIds = stringArray(entry.retrievedSessionIds);
    if (!retrievedSessionIds || oracle.has(entry.questionId)) {
      throw new Error("Canonical control report case sessions are invalid.");
    }
    oracle.set(entry.questionId, {
      contextSha256: entry.baseline.contextSha256,
      contextTokens: entry.baseline.contextTokens,
      questionId: entry.questionId,
      recallSnapshotSha256: entry.recallSnapshotSha256,
      retrievedSessionIds,
    });
  }
  return oracle;
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
    !Number.isInteger(diagnostics.queryCalls) ||
    diagnostics.queryCalls < 1 ||
    !Number.isInteger(diagnostics.recallRecordCount) ||
    diagnostics.recallRecordCount < 0 ||
    typeof input.context.recallSnapshotSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(input.context.recallSnapshotSha256)
  ) {
    throw new Error(
      `Missing runtime retrieval diagnostics: ${input.originalCase.questionId}`,
    );
  }
  if (diagnostics.ambiguousReaderVisibleSessionIds.length > 0) {
    throw new Error(
      `ambiguous reader-visible session attribution: ${input.originalCase.questionId}`,
    );
  }
  if (
    JSON.stringify(diagnostics.subQueries) !==
      JSON.stringify(input.expectedSubQueries) ||
    diagnostics.queryCalls !== 1 + input.expectedSubQueries.length
  ) {
    throw new Error(
      `Runtime recall trace does not match temporal operands: ${input.originalCase.questionId}`,
    );
  }
  const allowedSessionIds = new Set(
    input.originalCase.haystackSessions.map((_, index) => `session-${index + 1}`),
  );
  for (const sessionId of [
    ...input.context.retrievedSessionIds,
    ...diagnostics.readerVisibleSessionIds,
  ]) {
    if (!allowedSessionIds.has(sessionId)) {
      throw new Error(
        `Runtime retrieval exposed an unknown session: ${input.originalCase.questionId}`,
      );
    }
  }
  const leaked = input.originalCase.haystackSessionIds.find((sessionId) =>
    input.context.content.includes(sessionId)
  );
  if (leaked) {
    throw new Error(
      `Reader context exposes a raw LongMemEval session ID: ${leaked}`,
    );
  }
  const contextTokens = estimateTextTokens(input.context.content);
  if (contextTokens > READER_CONTEXT_TOKEN_CAP) {
    throw new Error(
      `Reader context exceeds the token cap: ${input.originalCase.questionId}`,
    );
  }
  const readerVisibleSessionIds = [...new Set(
    diagnostics.readerVisibleSessionIds,
  )];
  const coveredGoldSessionIds = input.goldSessionIds.filter((sessionId) =>
    readerVisibleSessionIds.includes(sessionId)
  );
  return {
    ambiguousReaderVisibleSessionIds: [],
    contextSha256: sha256(input.context.content),
    contextTokens,
    coveredGoldSessionIds,
    missingGoldSessionIds: difference(
      input.goldSessionIds,
      readerVisibleSessionIds,
    ),
    nonGoldVisibleSessionIds: difference(
      readerVisibleSessionIds,
      input.goldSessionIds,
    ),
    queryCalls: diagnostics.queryCalls,
    readerVisibleSessionIds,
    recallRecordCount: diagnostics.recallRecordCount,
    recallSnapshotSha256: input.context.recallSnapshotSha256,
    recallUnionSessionIds: [...input.context.retrievedSessionIds],
    subQueries: [...diagnostics.subQueries],
  };
}

function assertCanonicalControlSurface(
  actual: RetrievalArmResult,
  expected: ControlOracleCase,
): void {
  const mismatches = [
    actual.contextSha256 !== expected.contextSha256 ? "contextSha256" : null,
    actual.contextTokens !== expected.contextTokens ? "contextTokens" : null,
    JSON.stringify(actual.recallUnionSessionIds) !==
        JSON.stringify(expected.retrievedSessionIds)
      ? "retrievedSessionIds"
      : null,
  ].filter((value): value is string => value !== null);
  if (mismatches.length > 0) {
    throw new Error(
      `canonical control mismatch for ${expected.questionId}: ${mismatches.join(", ")}`,
    );
  }
}

function assertNegativeControlUnchanged(input: {
  control: RetrievalArmResult;
  questionId: string;
  treatment: RetrievalArmResult;
}): void {
  if (!isDeepStrictEqual(input.treatment, input.control)) {
    throw new Error(`Non-temporal treatment drift: ${input.questionId}`);
  }
}

function temporalOperands(question: string): string[] {
  const language = createLanguageService();
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

function createCanonicalContextBuilders(): ContextBuilders {
  const shared = {
    evidenceLedgerFormats: ["compact_json"] as const,
    ingestMode: "label-free-raw" as const,
    maxTokens: CONTEXT_MAX_TOKENS,
    runId: CANONICAL_MEMORY_RUN_ID,
    supplementalEvidenceLimit: 6,
    supplementalEvidencePerSessionLimit: 2,
  };
  const control = createLongMemEvalMemoryFactory(
    createHermeticLongMemEvalMemory,
    { runNamespace: CANONICAL_MEMORY_RUN_ID },
  );
  const treatment = createLongMemEvalMemoryFactory(
    createHermeticLongMemEvalMemory,
    { runNamespace: CANONICAL_MEMORY_RUN_ID },
  );
  return {
    control: createLongMemEvalGoodMemoryContextBuilder({
      ...shared,
      createMemory: control,
      recallOptions: { decompose: false, multiHop: false },
    }),
    treatmentDecomposed: createLongMemEvalGoodMemoryContextBuilder({
      ...shared,
      createMemory: treatment,
      recallOptions: { decompose: true, multiHop: false },
    }),
    treatmentSinglePass: createLongMemEvalGoodMemoryContextBuilder({
      ...shared,
      createMemory: treatment,
      recallOptions: { decompose: false, multiHop: false },
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

function assertCleanSource(sourceState: SourceState): void {
  if (sourceState.dirty || !/^[0-9a-f]{40}$/u.test(sourceState.commit)) {
    throw new Error("Temporal operand development replay requires a clean commit.");
  }
}

function summarize(
  cases: readonly RetrievalCaseResult[],
  canonicalDependencies: boolean,
): Phase72LongMemEvalTemporalOperandsReport["summary"] {
  const controlCoveredGoldEndpointCount = cases.reduce(
    (total, result) => total + result.control.coveredGoldSessionIds.length,
    0,
  );
  const treatmentCoveredGoldEndpointCount = cases.reduce(
    (total, result) => total + result.treatment.coveredGoldSessionIds.length,
    0,
  );
  const addedGoldEndpointCount = cases.reduce(
    (total, result) => total + result.addedGoldSessionIds.length,
    0,
  );
  const lostGoldEndpointCount = cases.reduce(
    (total, result) => total + result.lostGoldSessionIds.length,
    0,
  );
  const developmentRetrievalCriteriaPassed =
    treatmentCoveredGoldEndpointCount > controlCoveredGoldEndpointCount &&
    lostGoldEndpointCount === 0;
  return {
    addedGoldEndpointCount,
    answerConversionAuthorized: false,
    controlCoveredGoldEndpointCount,
    controlQueryCalls: cases.reduce(
      (total, result) => total + result.control.queryCalls,
      0,
    ),
    developmentRetrievalCriteriaPassed,
    developmentRetrievalGatePassed:
      canonicalDependencies && developmentRetrievalCriteriaPassed,
    improvedCaseCount: cases.filter(
      (result) => result.addedGoldSessionIds.length > 0,
    ).length,
    legacyControlSnapshotMatchCount: cases.filter(
      (result) => result.legacyControlRecallSnapshotMatched,
    ).length,
    lostGoldEndpointCount,
    regressedCaseCount: cases.filter(
      (result) => result.lostGoldSessionIds.length > 0,
    ).length,
    treatmentCoveredGoldEndpointCount,
    treatmentQueryCalls: cases.reduce(
      (total, result) => total + result.treatment.queryCalls,
      0,
    ),
  };
}

export async function runPhase72LongMemEvalTemporalOperandsDevelopment(
  options: Phase72LongMemEvalTemporalOperandsOptions,
  dependencies: Phase72LongMemEvalTemporalOperandsDependencies = {},
): Promise<Phase72LongMemEvalTemporalOperandsReport> {
  assertCliPathSegmentValue({ flag: "--run-id", value: options.runId });
  const bunVersion = dependencies.bunVersion ?? Bun.version;
  if (bunVersion !== REQUIRED_BUN_VERSION) {
    throw new Error(`Bun ${REQUIRED_BUN_VERSION} is required; found ${bunVersion}.`);
  }
  const englishAnalyzerVersion = createEnglishLanguagePack().analyzerVersion;
  if (englishAnalyzerVersion !== REQUIRED_ENGLISH_ANALYZER_VERSION) {
    throw new Error(
      `English analyzer ${REQUIRED_ENGLISH_ANALYZER_VERSION} is required; found ${englishAnalyzerVersion}.`,
    );
  }
  const preseal = dependencies.preseal ?? DEFAULT_PRESEAL;
  const canonicalDependencies =
    dependencies.bunVersion === undefined &&
    dependencies.contextBuilders === undefined &&
    dependencies.preseal === undefined &&
    dependencies.readFile === undefined &&
    dependencies.scriptPath === undefined &&
    dependencies.sourceState === undefined;
  const readFileImpl = dependencies.readFile ??
    ((path: string) => readFile(path, "utf8"));
  const scriptPath = dependencies.scriptPath ?? import.meta.path;
  const [datasetRaw, selectionRaw, controlReportRaw, scriptRaw] =
    await Promise.all([
      readFileImpl(join(options.benchmarkRoot, DATASET_FILE)),
      readFileImpl(options.selectionFile),
      readFileImpl(options.controlReportFile),
      readFileImpl(scriptPath),
    ]);
  if (sha256(datasetRaw) !== preseal.datasetRawSha256) {
    throw new Error("LongMemEval dataset does not match the temporal operand preseal.");
  }
  if (sha256(selectionRaw) !== preseal.selectionSha256) {
    throw new Error("LongMemEval selection does not match the temporal operand preseal.");
  }
  const parsedDataset = JSON.parse(datasetRaw) as unknown;
  const testCases = validateLongMemEvalCases(parsedDataset);
  const benchmarkFingerprint = sha256(JSON.stringify(parsedDataset));
  if (benchmarkFingerprint !== preseal.benchmarkFingerprint) {
    throw new Error("LongMemEval benchmark fingerprint does not match the preseal.");
  }
  const selection = parseSelection(selectionRaw);
  if (selection.benchmarkFingerprint !== benchmarkFingerprint) {
    throw new Error("LongMemEval selection benchmark fingerprint does not match.");
  }
  const casesById = indexCases(testCases);
  const selected = selection.questionIds.map((questionId) => {
    const testCase = casesById.get(questionId);
    if (!testCase) {
      throw new Error(`Selected LongMemEval case is missing: ${questionId}`);
    }
    return testCase;
  });
  validateStrata(selected, selection.strata);
  const controlOracle = parseControlOracle({
    preseal,
    raw: controlReportRaw,
    selection,
  });
  const initialSourceState = dependencies.sourceState ?? await resolveSourceState();
  assertCleanSource(initialSourceState);

  const mkdirImpl = dependencies.mkdir ?? mkdir;
  await mkdirImpl(options.outputDir, { recursive: true });
  const runDirectory = join(options.outputDir, options.runId);
  await mkdirImpl(runDirectory, { recursive: false });
  const builders = dependencies.contextBuilders ??
    createCanonicalContextBuilders();

  const controls = new Map<string, RetrievalArmResult>();
  for (const testCase of selected) {
    const context = await builders.control({
      profile: PROFILE,
      testCase: goldBlindMemoryCase(testCase),
    });
    const gold = goldSessionIds(testCase);
    const result = buildArmResult({
      context,
      expectedSubQueries: [],
      goldSessionIds: gold,
      originalCase: testCase,
    });
    const expected = controlOracle.get(testCase.questionId)!;
    assertCanonicalControlSurface(result, expected);
    controls.set(testCase.questionId, result);
    console.log("[phase-72:temporal-operands] control reproduced", {
      legacyRecallSnapshotMatched:
        result.recallSnapshotSha256 === expected.recallSnapshotSha256,
      questionId: testCase.questionId,
      readerVisibleGold: result.coveredGoldSessionIds.length,
    });
  }

  const cases: RetrievalCaseResult[] = [];
  for (const testCase of selected) {
    const operands = temporalOperands(testCase.question);
    const builder = operands.length > 0
      ? builders.treatmentDecomposed
      : builders.treatmentSinglePass;
    const treatmentContext = await builder({
      profile: PROFILE,
      testCase: goldBlindMemoryCase(testCase),
    });
    const gold = goldSessionIds(testCase);
    const treatment = buildArmResult({
      context: treatmentContext,
      expectedSubQueries: operands,
      goldSessionIds: gold,
      originalCase: testCase,
    });
    if (treatment.queryCalls > 3) {
      throw new Error(
        `Temporal operand recall exceeded three queries: ${testCase.questionId}`,
      );
    }
    const control = controls.get(testCase.questionId)!;
    if (operands.length === 0) {
      assertNegativeControlUnchanged({
        control,
        questionId: testCase.questionId,
        treatment,
      });
    }
    const expected = controlOracle.get(testCase.questionId)!;
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
      legacyControlRecallSnapshotMatched:
        control.recallSnapshotSha256 === expected.recallSnapshotSha256,
      legacyControlRecallSnapshotSha256: expected.recallSnapshotSha256,
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
      questionType: testCase.questionType,
      recallRecordCountDelta:
        treatment.recallRecordCount - control.recallRecordCount,
      temporalOperands: operands,
      treatment,
    };
    cases.push(result);
    console.log("[phase-72:temporal-operands] treatment measured", {
      addedGold: result.addedGoldSessionIds,
      lostGold: result.lostGoldSessionIds,
      queryCalls: treatment.queryCalls,
      questionId: testCase.questionId,
    });
  }

  const finalSourceState = dependencies.sourceState ?? await resolveSourceState();
  if (JSON.stringify(finalSourceState) !== JSON.stringify(initialSourceState)) {
    throw new Error("Source state changed during temporal operand replay.");
  }
  const report: Phase72LongMemEvalTemporalOperandsReport = {
    cases,
    configuration: {
      contextMaxTokens: CONTEXT_MAX_TOKENS,
      controlOracle: "legacy_v2_surface_identity",
      legacyRecallSnapshot:
        "disclosure_only_after_analyzer_identity_migration",
      profile: PROFILE,
      readerContextTokenCap: READER_CONTEXT_TOKEN_CAP,
      treatment: "query_derived_temporal_operands",
    },
    generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    generatedBy:
      "scripts/run-phase-72-longmemeval-temporal-operands-development.ts",
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
      canonicalControlReportSha256: sha256(controlReportRaw),
      canonicalControlSourceCommit: CANONICAL_CONTROL_SOURCE_COMMIT,
      canonicalMemoryRunId: CANONICAL_MEMORY_RUN_ID,
      datasetRawSha256: sha256(datasetRaw),
      englishAnalyzerVersion: REQUIRED_ENGLISH_ANALYZER_VERSION,
      legacyControlEnglishAnalyzerVersion:
        LEGACY_CONTROL_ENGLISH_ANALYZER_VERSION,
      scriptSha256: sha256(scriptRaw),
      sourceState: initialSourceState,
    },
    summary: summarize(cases, canonicalDependencies),
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
): Phase72LongMemEvalTemporalOperandsOptions {
  return {
    benchmarkRoot: requiredFlag(argv, "--benchmark-root"),
    controlReportFile: requiredFlag(argv, "--control-report"),
    outputDir: requiredFlag(argv, "--output-dir"),
    runId: requiredFlag(argv, "--run-id"),
    selectionFile: requiredFlag(argv, "--selection-file"),
  };
}

if (import.meta.main) {
  const report = await runPhase72LongMemEvalTemporalOperandsDevelopment(
    parseOptions(process.argv.slice(2).filter((value) => value !== "--")),
  );
  console.log(JSON.stringify({
    runId: report.runId,
    summary: report.summary,
  }, null, 2));
}
