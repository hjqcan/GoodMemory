import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import type {
  GoodMemory,
  RecallResult,
} from "../src/api/contracts";
import {
  validateBeamRows,
} from "../src/eval/beam";
import type {
  BeamCase,
  BeamRow,
} from "../src/eval/beam";
import type {
  LocomoCase,
  LocomoQuestion,
} from "../src/eval/locomo";
import { createLanguageService } from "../src/language";
import type { LanguageService } from "../src/language";
import { splitQueryIntoSubQueries } from "../src/recall/queryDecomposition";
import { estimateTextTokens } from "../src/tokenEstimator";
import {
  assertCliPathSegmentValue,
  resolveCliFlagValueStrict,
} from "./cli-options";
import {
  buildPhase63BeamScope,
  collectPhase63BeamRetrievedChatIds,
  createPhase63BeamDiagnosticMemory,
  flattenPhase63BeamCases,
  seedPhase63BeamConversation,
} from "./run-phase-63-beam-recall-diagnostic";
import {
  buildLocomoScope,
  collectLocomoRetrievedTurnIds,
  createLocomoSmokeMemory,
  loadLocomoCases,
  seedLocomoCase,
} from "./run-phase-65-locomo-smoke";

const PROTOCOL =
  "phase72_temporal_operands_cross_benchmark_retrieval_protection_v1";
const GENERATED_BY =
  "scripts/run-phase-72-temporal-operands-protection.ts";
const REQUIRED_BUN_VERSION = "1.3.14";
const REQUIRED_ENGLISH_ANALYZER_VERSION = "13";
const REQUIRED_SELECTION_SHA256 =
  "41ea410c7623dfa24315d7853386900deaeb93f3feff95210f8e34fe5fd403e4";
const MEMORY_RUN_ID =
  "phase72-temporal-operands-protection-v1-bun1314";
const FACT_SNAPSHOT_OMITTED_FIELDS = new Set([
  "accessCount",
  "lastAccessedAt",
  "lastVerificationHintAt",
  "verificationPressureCount",
]);
const FEEDBACK_SNAPSHOT_OMITTED_FIELDS = new Set(["lastUsedAt"]);

interface SourceState {
  commit: string;
  dirty: boolean;
  worktreeFingerprint: string;
}

interface ProtectionBudgets {
  maxAddedNoiseEvidenceIdsPerAddedGoldEndpoint: number;
  maxQueriesPerCase: number;
  maxTriggeredContextTokenIncreaseRatio: number;
  maxTriggeredRecallRecordIncreaseRatio: number;
}

interface LocomoSelection {
  activationCategory: "temporal";
  benchmarkFingerprint: string;
  datasetRawSha256: string;
  memoryGroupCount: number;
  negativeControlCategory: "multi_hop";
  orderedSelectionSha256: string;
  questionCategoryCounts: {
    multi_hop: number;
    temporal: number;
  };
  questionCount: number;
  temporalTriggerCount: number;
}

interface BeamSelection {
  activationQuestionType: "temporal_reasoning";
  datasetParsedSha256: string;
  datasetRawSha256: string;
  memoryGroupCount: number;
  negativeControlQuestionType: "multi_session_reasoning";
  orderedSelectionSha256: string;
  questionCount: number;
  questionTypeCounts: {
    multi_session_reasoning: number;
    temporal_reasoning: number;
  };
  scale: "100K";
  temporalTriggerCount: number;
}

interface ProtectionSelection {
  beam: BeamSelection;
  budgetProvenance: string;
  budgets: ProtectionBudgets;
  frozenBeforeRetrievalExecution: true;
  locomo: LocomoSelection;
  protocol: typeof PROTOCOL;
  schemaVersion: 1;
  selectionMethod: string;
}

export interface Phase72TemporalOperandsProtectionOptions {
  beamRoot: string;
  locomoRoot: string;
  outputDir: string;
  runId: string;
  selectionFile: string;
}

export interface Phase72TemporalOperandsProtectionDependencies {
  bunVersion?: string;
  createBeamMemory?: () => GoodMemory;
  createLocomoMemory?: () => GoodMemory;
  expectedSelectionSha256?: string;
  mkdir?: (
    path: string,
    options: { recursive: boolean },
  ) => Promise<unknown>;
  now?: () => Date;
  readFile?: (path: string) => Promise<string>;
  scriptPath?: string;
  sourceState?: SourceState;
  writeFile?: (
    path: string,
    value: string,
    options: { flag: "wx" },
  ) => Promise<unknown>;
}

interface ArmResult {
  contextSha256: string;
  contextTokens: number;
  coveredGoldEvidenceIds: string[];
  missingGoldEvidenceIds: string[];
  noiseEvidenceIds: string[];
  queryCalls: number;
  recallRecordCount: number;
  recallSnapshotSha256: string;
  retrievedEvidenceIds: string[];
  subQueries: string[];
}

interface ProtectionCaseResult {
  addedGoldEvidenceIds: string[];
  addedNoiseEvidenceIds: string[];
  addedRetrievedEvidenceIds: string[];
  benchmark: "beam" | "locomo";
  category: string;
  contextTokenDelta: number;
  control: ArmResult;
  goldEvidenceIds: string[];
  groupId: string;
  lostGoldEvidenceIds: string[];
  lostRetrievedEvidenceIds: string[];
  noiseEvidenceDelta: number;
  questionId: string;
  recallRecordCountDelta: number;
  removedNoiseEvidenceIds: string[];
  temporalOperands: string[];
  treatment: ArmResult;
}

export interface Phase72TemporalOperandsProtectionReport {
  cases: ProtectionCaseResult[];
  configuration: {
    answerCalls: 0;
    control: "single_query";
    holdoutCalls: 0;
    judgeCalls: 0;
    memoryIsolation: "fresh_seeded_memory_per_question_per_arm";
    memoryRunId: typeof MEMORY_RUN_ID;
    multiHop: false;
    readerContext: "retrieved_raw_turns_in_source_order";
    recallSnapshot: "full_recall_without_operational_access_telemetry";
    strategy: "rules-only";
    treatment: "query_derived_temporal_operands_only";
  };
  generatedAt: string;
  generatedBy: typeof GENERATED_BY;
  protocol: typeof PROTOCOL;
  runId: string;
  selection: ProtectionSelection & {
    fileSha256: string;
  };
  source: {
    bunVersion: string;
    canonicalDependencies: boolean;
    englishAnalyzerVersion: string;
    scriptSha256: string;
    sourceState: SourceState;
  };
  summary: {
    addedGoldEndpointCount: number;
    addedNoiseEvidenceCount: number;
    addedNoiseEvidenceIdsPerAddedGoldEndpoint: number | null;
    answerConversionAuthorized: false;
    benchmarks: Record<"beam" | "locomo", BenchmarkProtectionSummary>;
    contextTokenIncreaseRatio: number;
    controlContextTokens: number;
    controlCoveredGoldEndpointCount: number;
    controlQueryCalls: number;
    controlRecallRecordCount: number;
    designatedNegativeControlQuestionCount: number;
    improvedCaseCount: number;
    lostGoldEndpointCount: number;
    negativeControlCount: number;
    negativeControlDriftCount: 0;
    protectionCriteriaPassed: boolean;
    protectionGatePassed: boolean;
    questionCount: number;
    recallRecordIncreaseRatio: number;
    regressedCaseCount: number;
    removedNoiseEvidenceCount: number;
    temporalTriggerCount: number;
    triggeredContextTokenIncreaseRatio: number;
    triggeredControlContextTokens: number;
    triggeredControlRecallRecordCount: number;
    triggeredRecallRecordIncreaseRatio: number;
    triggeredTreatmentContextTokens: number;
    triggeredTreatmentRecallRecordCount: number;
    treatmentContextTokens: number;
    treatmentCoveredGoldEndpointCount: number;
    treatmentQueryCalls: number;
    treatmentRecallRecordCount: number;
  };
}

interface BenchmarkProtectionSummary {
  addedGoldEndpointCount: number;
  addedNoiseEvidenceCount: number;
  addedNoiseEvidenceIdsPerAddedGoldEndpoint: number | null;
  lostGoldEndpointCount: number;
  protectionCriteriaPassed: boolean;
  questionCount: number;
  temporalTriggerCount: number;
  triggeredContextTokenIncreaseRatio: number;
  triggeredRecallRecordIncreaseRatio: number;
}

interface RuntimeCase {
  benchmark: "beam" | "locomo";
  buildReaderContext(retrievedIds: readonly string[]): string;
  category: string;
  goldEvidenceIds: string[];
  groupId: string;
  question: string;
  questionId: string;
  recall(memory: GoodMemory, decompose: boolean): Promise<RecallResult>;
}

interface RuntimeGroup {
  benchmark: "beam" | "locomo";
  cases: RuntimeCase[];
  groupId: string;
  seed(memory: GoodMemory): Promise<void>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function ratio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseSelection(raw: string): ProtectionSelection {
  const value = JSON.parse(raw) as unknown;
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.protocol !== PROTOCOL ||
    value.frozenBeforeRetrievalExecution !== true ||
    typeof value.selectionMethod !== "string" ||
    value.selectionMethod.length === 0 ||
    typeof value.budgetProvenance !== "string" ||
    value.budgetProvenance.length === 0 ||
    !isRecord(value.budgets) ||
    !positiveInteger(value.budgets.maxQueriesPerCase) ||
    !ratio(value.budgets.maxAddedNoiseEvidenceIdsPerAddedGoldEndpoint) ||
    !ratio(value.budgets.maxTriggeredContextTokenIncreaseRatio) ||
    !ratio(value.budgets.maxTriggeredRecallRecordIncreaseRatio) ||
    !isRecord(value.locomo) ||
    value.locomo.activationCategory !== "temporal" ||
    value.locomo.negativeControlCategory !== "multi_hop" ||
    typeof value.locomo.datasetRawSha256 !== "string" ||
    typeof value.locomo.benchmarkFingerprint !== "string" ||
    typeof value.locomo.orderedSelectionSha256 !== "string" ||
    !positiveInteger(value.locomo.questionCount) ||
    !positiveInteger(value.locomo.memoryGroupCount) ||
    !nonNegativeInteger(value.locomo.temporalTriggerCount) ||
    !isRecord(value.locomo.questionCategoryCounts) ||
    !positiveInteger(value.locomo.questionCategoryCounts.temporal) ||
    !positiveInteger(value.locomo.questionCategoryCounts.multi_hop) ||
    !isRecord(value.beam) ||
    value.beam.scale !== "100K" ||
    value.beam.activationQuestionType !== "temporal_reasoning" ||
    value.beam.negativeControlQuestionType !== "multi_session_reasoning" ||
    typeof value.beam.datasetRawSha256 !== "string" ||
    typeof value.beam.datasetParsedSha256 !== "string" ||
    typeof value.beam.orderedSelectionSha256 !== "string" ||
    !positiveInteger(value.beam.questionCount) ||
    !positiveInteger(value.beam.memoryGroupCount) ||
    !nonNegativeInteger(value.beam.temporalTriggerCount) ||
    !isRecord(value.beam.questionTypeCounts) ||
    !positiveInteger(value.beam.questionTypeCounts.temporal_reasoning) ||
    !positiveInteger(value.beam.questionTypeCounts.multi_session_reasoning)
  ) {
    throw new Error("Temporal operand protection selection is invalid.");
  }
  return value as unknown as ProtectionSelection;
}

function difference<T>(left: readonly T[], right: readonly T[]): T[] {
  const excluded = new Set(right);
  return left.filter((value) => !excluded.has(value));
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

function recallRecordCount(recall: RecallResult): number {
  return [
    recall.preferences,
    recall.references,
    recall.facts,
    recall.feedback,
    recall.archives,
    recall.evidence,
    recall.episodes,
  ].reduce((total, records) => total + records.length, 0);
}

function recallSnapshotSha256(recall: RecallResult): string {
  const omit = (
    value: unknown,
    fields: ReadonlySet<string>,
  ): Record<string, unknown> => Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([key]) =>
      !fields.has(key)
    ),
  );
  const metadata = Object.fromEntries(
    Object.entries(recall.metadata).filter(([key]) =>
      key !== "latencyMs" && key !== "traceId"
    ),
  );
  return sha256(JSON.stringify({
    ...recall,
    facts: recall.facts.map((fact) =>
      omit(fact, FACT_SNAPSHOT_OMITTED_FIELDS)
    ),
    feedback: recall.feedback.map((item) =>
      omit(item, FEEDBACK_SNAPSHOT_OMITTED_FIELDS)
    ),
    metadata,
  }));
}

function assertTrace(input: {
  expectedSubQueries: readonly string[];
  question: string;
  recall: RecallResult;
}): { queryCalls: number; subQueries: string[] } {
  const trace = input.recall.metadata.retrievalTrace;
  if (trace?.schemaVersion !== 2) {
    throw new Error(`Missing retrieval trace for: ${input.question}`);
  }
  const expectedQueries = [input.question, ...input.expectedSubQueries];
  if (
    !isDeepStrictEqual(trace.subQueries, input.expectedSubQueries) ||
    !isDeepStrictEqual(
      trace.queryExecutions.map((execution) => execution.query),
      expectedQueries,
    ) ||
    trace.queryExecutions.some((execution) => execution.hops.length !== 1)
  ) {
    throw new Error(`Temporal operand query trace mismatch: ${input.question}`);
  }
  return {
    queryCalls: trace.queryExecutions.length,
    subQueries: [...trace.subQueries],
  };
}

function buildArmResult(input: {
  context: string;
  expectedSubQueries: readonly string[];
  goldEvidenceIds: readonly string[];
  question: string;
  recall: RecallResult;
  retrievedEvidenceIds: string[];
}): ArmResult {
  const trace = assertTrace({
    expectedSubQueries: input.expectedSubQueries,
    question: input.question,
    recall: input.recall,
  });
  return {
    contextSha256: sha256(input.context),
    contextTokens: estimateTextTokens(input.context),
    coveredGoldEvidenceIds: input.goldEvidenceIds.filter((id) =>
      input.retrievedEvidenceIds.includes(id)
    ),
    missingGoldEvidenceIds: difference(
      input.goldEvidenceIds,
      input.retrievedEvidenceIds,
    ),
    noiseEvidenceIds: difference(
      input.retrievedEvidenceIds,
      input.goldEvidenceIds,
    ),
    queryCalls: trace.queryCalls,
    recallRecordCount: recallRecordCount(input.recall),
    recallSnapshotSha256: recallSnapshotSha256(input.recall),
    retrievedEvidenceIds: input.retrievedEvidenceIds,
    subQueries: trace.subQueries,
  };
}

function locomoReaderContext(
  testCase: LocomoCase,
  retrievedIds: readonly string[],
): string {
  const selected = new Set(retrievedIds);
  return testCase.turns
    .filter((turn) => selected.has(turn.diaId))
    .map((turn) =>
      `dia_id=${turn.diaId} speaker=${turn.speaker}` +
      `${turn.date ? ` date=${turn.date}` : ""}: ${turn.content}`
    )
    .join("\n");
}

function beamReaderContext(
  testCase: BeamCase,
  retrievedIds: readonly string[],
): string {
  const selected = new Set(retrievedIds.map(Number));
  return testCase.chat.flat()
    .filter((turn) => selected.has(turn.id))
    .map((turn) =>
      `chat_id=${turn.id} role=${turn.role} time=${turn.timeAnchor}: ${turn.content}`
    )
    .join("\n");
}

function goldBlindLocomoCase(testCase: LocomoCase): LocomoCase {
  return { ...testCase, questions: [] };
}

function goldBlindBeamRow(row: BeamRow): BeamRow {
  return { ...row, probingQuestions: [] };
}

function buildLocomoGroups(cases: readonly LocomoCase[]): RuntimeGroup[] {
  return cases.map((testCase) => {
    const scope = buildLocomoScope({
      caseId: testCase.caseId,
      runId: MEMORY_RUN_ID,
    });
    return {
      benchmark: "locomo",
      cases: testCase.questions.map((question: LocomoQuestion) => ({
        benchmark: "locomo",
        buildReaderContext: (ids) => locomoReaderContext(testCase, ids),
        category: question.category,
        goldEvidenceIds: [...question.evidenceTurnIds],
        groupId: testCase.caseId,
        question: question.question,
        questionId: question.questionId,
        recall: (memory, decompose) => memory.recall({
          decompose,
          multiHop: false,
          query: question.question,
          scope,
          strategy: "rules-only",
        }),
      })),
      groupId: testCase.caseId,
      seed: (memory) => seedLocomoCase({
        labelFreeIngest: true,
        memory,
        runId: MEMORY_RUN_ID,
        testCase: goldBlindLocomoCase(testCase),
      }),
    };
  });
}

function buildBeamGroups(
  cases: readonly (BeamCase & { row: BeamRow })[],
): RuntimeGroup[] {
  const byConversation = new Map<string, Array<BeamCase & { row: BeamRow }>>();
  for (const testCase of cases) {
    const group = byConversation.get(testCase.conversationId) ?? [];
    group.push(testCase);
    byConversation.set(testCase.conversationId, group);
  }
  return [...byConversation.entries()].map(([conversationId, cases]) => {
    const row = cases[0]!.row;
    const scope = buildPhase63BeamScope({
      conversationId,
      runId: MEMORY_RUN_ID,
    });
    return {
      benchmark: "beam",
      cases: cases.map((testCase) => ({
        benchmark: "beam",
        buildReaderContext: (ids) => beamReaderContext(testCase, ids),
        category: testCase.questionType,
        goldEvidenceIds: testCase.evidenceChatIds.map(String),
        groupId: conversationId,
        question: testCase.question,
        questionId: testCase.questionId,
        recall: (memory, decompose) => memory.recall({
          decompose,
          multiHop: false,
          query: testCase.question,
          scope,
          strategy: "rules-only",
        }),
      })),
      groupId: conversationId,
      seed: (memory) => seedPhase63BeamConversation({
        memory,
        row: goldBlindBeamRow(row),
        runId: MEMORY_RUN_ID,
      }),
    };
  });
}

function resultKey(result: Pick<RuntimeCase, "benchmark" | "questionId">): string {
  return `${result.benchmark}:${result.questionId}`;
}

async function runArm(input: {
  arm: "control" | "treatment";
  beamMemory: () => GoodMemory;
  groups: readonly RuntimeGroup[];
  language: LanguageService;
  locomoMemory: () => GoodMemory;
  maxQueriesPerCase: number;
}): Promise<Map<string, ArmResult>> {
  const results = new Map<string, ArmResult>();
  for (const group of input.groups) {
    for (const testCase of group.cases) {
      const memory = group.benchmark === "locomo"
        ? input.locomoMemory()
        : input.beamMemory();
      await group.seed(memory);
      const operands = temporalOperands(testCase.question, input.language);
      const decompose = input.arm === "treatment" && operands.length > 0;
      const recall = await testCase.recall(memory, decompose);
      const retrievedEvidenceIds = testCase.benchmark === "locomo"
        ? collectLocomoRetrievedTurnIds(recall)
        : collectPhase63BeamRetrievedChatIds(recall).map(String);
      const result = buildArmResult({
        context: testCase.buildReaderContext(retrievedEvidenceIds),
        expectedSubQueries: decompose ? operands : [],
        goldEvidenceIds: testCase.goldEvidenceIds,
        question: testCase.question,
        recall,
        retrievedEvidenceIds,
      });
      if (result.queryCalls > input.maxQueriesPerCase) {
        throw new Error(
          `Temporal operand recall exceeded the query budget: ${testCase.questionId}`,
        );
      }
      results.set(resultKey(testCase), result);
    }
    console.log("[phase-72:temporal-protection] arm group complete", {
      arm: input.arm,
      benchmark: group.benchmark,
      groupId: group.groupId,
      questionCount: group.cases.length,
    });
  }
  return results;
}

function sum(
  cases: readonly ProtectionCaseResult[],
  select: (result: ProtectionCaseResult) => number,
): number {
  return cases.reduce((total, result) => total + select(result), 0);
}

function increaseRatio(control: number, treatment: number): number {
  if (control === 0) return treatment === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (treatment - control) / control;
}

function benchmarkProtectionSummary(
  cases: readonly ProtectionCaseResult[],
  budgets: ProtectionBudgets,
): BenchmarkProtectionSummary {
  const triggered = cases.filter(
    (result) => result.temporalOperands.length > 0,
  );
  const addedGoldEndpointCount = sum(cases, (result) =>
    result.addedGoldEvidenceIds.length
  );
  const addedNoiseEvidenceCount = sum(cases, (result) =>
    result.addedNoiseEvidenceIds.length
  );
  const addedNoiseEvidenceIdsPerAddedGoldEndpoint =
    addedGoldEndpointCount === 0
      ? null
      : addedNoiseEvidenceCount / addedGoldEndpointCount;
  const lostGoldEndpointCount = sum(cases, (result) =>
    result.lostGoldEvidenceIds.length
  );
  const triggeredContextTokenIncreaseRatio = increaseRatio(
    sum(triggered, (result) => result.control.contextTokens),
    sum(triggered, (result) => result.treatment.contextTokens),
  );
  const triggeredRecallRecordIncreaseRatio = increaseRatio(
    sum(triggered, (result) => result.control.recallRecordCount),
    sum(triggered, (result) => result.treatment.recallRecordCount),
  );
  const noiseBudgetPassed = addedNoiseEvidenceCount === 0 ||
    (
      addedNoiseEvidenceIdsPerAddedGoldEndpoint !== null &&
      addedNoiseEvidenceIdsPerAddedGoldEndpoint <=
        budgets.maxAddedNoiseEvidenceIdsPerAddedGoldEndpoint
    );
  return {
    addedGoldEndpointCount,
    addedNoiseEvidenceCount,
    addedNoiseEvidenceIdsPerAddedGoldEndpoint,
    lostGoldEndpointCount,
    protectionCriteriaPassed:
      triggered.length > 0 &&
      lostGoldEndpointCount === 0 &&
      noiseBudgetPassed &&
      triggeredContextTokenIncreaseRatio <=
        budgets.maxTriggeredContextTokenIncreaseRatio &&
      triggeredRecallRecordIncreaseRatio <=
        budgets.maxTriggeredRecallRecordIncreaseRatio,
    questionCount: cases.length,
    temporalTriggerCount: triggered.length,
    triggeredContextTokenIncreaseRatio,
    triggeredRecallRecordIncreaseRatio,
  };
}

function summarize(input: {
  budgets: ProtectionBudgets;
  canonicalDependencies: boolean;
  cases: readonly ProtectionCaseResult[];
  designatedNegativeControlQuestionCount: number;
}): Phase72TemporalOperandsProtectionReport["summary"] {
  const controlContextTokens = sum(input.cases, (result) =>
    result.control.contextTokens
  );
  const treatmentContextTokens = sum(input.cases, (result) =>
    result.treatment.contextTokens
  );
  const controlRecallRecordCount = sum(input.cases, (result) =>
    result.control.recallRecordCount
  );
  const treatmentRecallRecordCount = sum(input.cases, (result) =>
    result.treatment.recallRecordCount
  );
  const contextTokenIncreaseRatio = increaseRatio(
    controlContextTokens,
    treatmentContextTokens,
  );
  const recallRecordIncreaseRatio = increaseRatio(
    controlRecallRecordCount,
    treatmentRecallRecordCount,
  );
  const lostGoldEndpointCount = sum(input.cases, (result) =>
    result.lostGoldEvidenceIds.length
  );
  const addedGoldEndpointCount = sum(input.cases, (result) =>
    result.addedGoldEvidenceIds.length
  );
  const addedNoiseEvidenceCount = sum(input.cases, (result) =>
    result.addedNoiseEvidenceIds.length
  );
  const addedNoiseEvidenceIdsPerAddedGoldEndpoint =
    addedGoldEndpointCount === 0
      ? null
      : addedNoiseEvidenceCount / addedGoldEndpointCount;
  const triggeredCases = input.cases.filter(
    (result) => result.temporalOperands.length > 0,
  );
  const temporalTriggerCount = triggeredCases.length;
  const triggeredControlContextTokens = sum(triggeredCases, (result) =>
    result.control.contextTokens
  );
  const triggeredTreatmentContextTokens = sum(triggeredCases, (result) =>
    result.treatment.contextTokens
  );
  const triggeredControlRecallRecordCount = sum(triggeredCases, (result) =>
    result.control.recallRecordCount
  );
  const triggeredTreatmentRecallRecordCount = sum(triggeredCases, (result) =>
    result.treatment.recallRecordCount
  );
  const triggeredContextTokenIncreaseRatio = increaseRatio(
    triggeredControlContextTokens,
    triggeredTreatmentContextTokens,
  );
  const triggeredRecallRecordIncreaseRatio = increaseRatio(
    triggeredControlRecallRecordCount,
    triggeredTreatmentRecallRecordCount,
  );
  const benchmarks = {
    beam: benchmarkProtectionSummary(
      input.cases.filter((result) => result.benchmark === "beam"),
      input.budgets,
    ),
    locomo: benchmarkProtectionSummary(
      input.cases.filter((result) => result.benchmark === "locomo"),
      input.budgets,
    ),
  };
  const protectionCriteriaPassed =
    benchmarks.beam.protectionCriteriaPassed &&
    benchmarks.locomo.protectionCriteriaPassed;
  return {
    addedGoldEndpointCount,
    addedNoiseEvidenceCount,
    addedNoiseEvidenceIdsPerAddedGoldEndpoint,
    answerConversionAuthorized: false,
    benchmarks,
    contextTokenIncreaseRatio,
    controlContextTokens,
    controlCoveredGoldEndpointCount: sum(input.cases, (result) =>
      result.control.coveredGoldEvidenceIds.length
    ),
    controlQueryCalls: sum(input.cases, (result) => result.control.queryCalls),
    controlRecallRecordCount,
    designatedNegativeControlQuestionCount:
      input.designatedNegativeControlQuestionCount,
    improvedCaseCount: input.cases.filter(
      (result) => result.addedGoldEvidenceIds.length > 0,
    ).length,
    lostGoldEndpointCount,
    negativeControlCount: input.cases.length - temporalTriggerCount,
    negativeControlDriftCount: 0,
    protectionCriteriaPassed,
    protectionGatePassed:
      input.canonicalDependencies && protectionCriteriaPassed,
    questionCount: input.cases.length,
    recallRecordIncreaseRatio,
    regressedCaseCount: input.cases.filter(
      (result) => result.lostGoldEvidenceIds.length > 0,
    ).length,
    removedNoiseEvidenceCount: sum(input.cases, (result) =>
      result.removedNoiseEvidenceIds.length
    ),
    temporalTriggerCount,
    triggeredContextTokenIncreaseRatio,
    triggeredControlContextTokens,
    triggeredControlRecallRecordCount,
    triggeredRecallRecordIncreaseRatio,
    triggeredTreatmentContextTokens,
    triggeredTreatmentRecallRecordCount,
    treatmentContextTokens,
    treatmentCoveredGoldEndpointCount: sum(input.cases, (result) =>
      result.treatment.coveredGoldEvidenceIds.length
    ),
    treatmentQueryCalls: sum(input.cases, (result) =>
      result.treatment.queryCalls
    ),
    treatmentRecallRecordCount,
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
    throw new Error(
      "Temporal operand protection replay requires a clean commit.",
    );
  }
}

function countBy(
  values: readonly string[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function assertSelectionIdentity(input: {
  actual: unknown;
  expected: unknown;
  label: string;
}): void {
  if (!isDeepStrictEqual(input.actual, input.expected)) {
    throw new Error(`${input.label} does not match the frozen selection.`);
  }
}

export async function runPhase72TemporalOperandsProtection(
  options: Phase72TemporalOperandsProtectionOptions,
  dependencies: Phase72TemporalOperandsProtectionDependencies = {},
): Promise<Phase72TemporalOperandsProtectionReport> {
  assertCliPathSegmentValue({ flag: "--run-id", value: options.runId });
  const bunVersion = dependencies.bunVersion ?? Bun.version;
  if (bunVersion !== REQUIRED_BUN_VERSION) {
    throw new Error(
      `Bun ${REQUIRED_BUN_VERSION} is required; found ${bunVersion}.`,
    );
  }
  const canonicalDependencies = Object.keys(dependencies).length === 0;
  const language = createLanguageService();
  const englishAnalyzerVersion = language.analyzerVersion("en-US");
  if (
    canonicalDependencies &&
    englishAnalyzerVersion !== REQUIRED_ENGLISH_ANALYZER_VERSION
  ) {
    throw new Error(
      `English analyzer ${REQUIRED_ENGLISH_ANALYZER_VERSION} is required; found ${englishAnalyzerVersion}.`,
    );
  }
  const readFileImpl = dependencies.readFile ??
    ((path: string) => readFile(path, "utf8"));
  const scriptPath = dependencies.scriptPath ?? import.meta.path;
  const [locomoRaw, beamRaw, selectionRaw, scriptRaw] = await Promise.all([
    readFileImpl(join(options.locomoRoot, "cases.json")),
    readFileImpl(join(options.beamRoot, "100K.json")),
    readFileImpl(options.selectionFile),
    readFileImpl(scriptPath),
  ]);
  const expectedSelectionSha256 = dependencies.expectedSelectionSha256 ??
    REQUIRED_SELECTION_SHA256;
  if (sha256(selectionRaw) !== expectedSelectionSha256) {
    throw new Error("Temporal operand protection selection hash mismatch.");
  }
  const selection = parseSelection(selectionRaw);
  if (sha256(locomoRaw) !== selection.locomo.datasetRawSha256) {
    throw new Error("LoCoMo dataset does not match the protection selection.");
  }
  if (sha256(beamRaw) !== selection.beam.datasetRawSha256) {
    throw new Error("BEAM dataset does not match the protection selection.");
  }

  const locomo = await loadLocomoCases({
    benchmarkRoot: options.locomoRoot,
    questionCategories: [
      selection.locomo.activationCategory,
      selection.locomo.negativeControlCategory,
    ],
    readFile: async () => locomoRaw,
  });
  if (locomo.benchmarkFingerprint !== selection.locomo.benchmarkFingerprint) {
    throw new Error("LoCoMo benchmark fingerprint mismatch.");
  }
  const locomoQuestions = locomo.cases.flatMap((testCase) =>
    testCase.questions.map((question) => ({
      caseId: testCase.caseId,
      question,
    }))
  );
  assertSelectionIdentity({
    actual: {
      categoryCounts: countBy(locomoQuestions.map(({ question }) =>
        question.category
      )),
      memoryGroupCount: locomo.cases.length,
      orderedSelectionSha256: sha256(JSON.stringify(
        locomoQuestions.map(({ caseId, question }) => ({
          caseId,
          questionId: question.questionId,
        })),
      )),
      questionCount: locomoQuestions.length,
      temporalTriggerCount: locomoQuestions.filter(({ question }) =>
        temporalOperands(question.question, language).length > 0
      ).length,
    },
    expected: {
      categoryCounts: selection.locomo.questionCategoryCounts,
      memoryGroupCount: selection.locomo.memoryGroupCount,
      orderedSelectionSha256: selection.locomo.orderedSelectionSha256,
      questionCount: selection.locomo.questionCount,
      temporalTriggerCount: selection.locomo.temporalTriggerCount,
    },
    label: "LoCoMo population",
  });

  const parsedBeam = JSON.parse(beamRaw) as unknown;
  if (sha256(JSON.stringify(parsedBeam)) !== selection.beam.datasetParsedSha256) {
    throw new Error("BEAM parsed dataset fingerprint mismatch.");
  }
  const beamRows = validateBeamRows(parsedBeam);
  const selectedTypes = new Set<string>([
    selection.beam.activationQuestionType,
    selection.beam.negativeControlQuestionType,
  ]);
  const beamCases = flattenPhase63BeamCases(beamRows, selection.beam.scale)
    .filter((testCase) => selectedTypes.has(testCase.questionType));
  assertSelectionIdentity({
    actual: {
      memoryGroupCount: new Set(
        beamCases.map((testCase) => testCase.conversationId),
      ).size,
      orderedSelectionSha256: sha256(JSON.stringify(
        beamCases.map((testCase) => ({
          conversationId: testCase.conversationId,
          questionId: testCase.questionId,
        })),
      )),
      questionCount: beamCases.length,
      questionTypeCounts: countBy(
        beamCases.map((testCase) => testCase.questionType),
      ),
      temporalTriggerCount: beamCases.filter((testCase) =>
        temporalOperands(testCase.question, language).length > 0
      ).length,
    },
    expected: {
      memoryGroupCount: selection.beam.memoryGroupCount,
      orderedSelectionSha256: selection.beam.orderedSelectionSha256,
      questionCount: selection.beam.questionCount,
      questionTypeCounts: selection.beam.questionTypeCounts,
      temporalTriggerCount: selection.beam.temporalTriggerCount,
    },
    label: "BEAM population",
  });

  const groups = [
    ...buildLocomoGroups(locomo.cases),
    ...buildBeamGroups(beamCases),
  ];
  for (const group of groups) {
    for (const testCase of group.cases) {
      const operands = temporalOperands(testCase.question, language);
      const negativeCategory = testCase.benchmark === "locomo"
        ? selection.locomo.negativeControlCategory
        : selection.beam.negativeControlQuestionType;
      if (testCase.category === negativeCategory && operands.length > 0) {
        throw new Error(
          `Designated negative control activates temporal operands: ${testCase.questionId}`,
        );
      }
    }
  }

  const initialSourceState = dependencies.sourceState ?? await resolveSourceState();
  assertCleanSource(initialSourceState);
  const mkdirImpl = dependencies.mkdir ?? mkdir;
  await mkdirImpl(options.outputDir, { recursive: true });
  const runDirectory = join(options.outputDir, options.runId);
  await mkdirImpl(runDirectory, { recursive: false });
  const locomoMemory = dependencies.createLocomoMemory ??
    (() => createLocomoSmokeMemory());
  const beamMemory = dependencies.createBeamMemory ??
    (() => createPhase63BeamDiagnosticMemory());

  const controls = await runArm({
    arm: "control",
    beamMemory,
    groups,
    language,
    locomoMemory,
    maxQueriesPerCase: selection.budgets.maxQueriesPerCase,
  });
  const treatments = await runArm({
    arm: "treatment",
    beamMemory,
    groups,
    language,
    locomoMemory,
    maxQueriesPerCase: selection.budgets.maxQueriesPerCase,
  });

  const cases: ProtectionCaseResult[] = groups.flatMap((group) =>
    group.cases.map((testCase) => {
      const key = resultKey(testCase);
      const control = controls.get(key)!;
      const treatment = treatments.get(key)!;
      const operands = temporalOperands(testCase.question, language);
      if (operands.length === 0 && !isDeepStrictEqual(treatment, control)) {
        throw new Error(`Non-temporal treatment drift: ${testCase.questionId}`);
      }
      return {
        addedGoldEvidenceIds: difference(
          treatment.coveredGoldEvidenceIds,
          control.coveredGoldEvidenceIds,
        ),
        addedNoiseEvidenceIds: difference(
          treatment.noiseEvidenceIds,
          control.noiseEvidenceIds,
        ),
        addedRetrievedEvidenceIds: difference(
          treatment.retrievedEvidenceIds,
          control.retrievedEvidenceIds,
        ),
        benchmark: testCase.benchmark,
        category: testCase.category,
        contextTokenDelta: treatment.contextTokens - control.contextTokens,
        control,
        goldEvidenceIds: [...testCase.goldEvidenceIds],
        groupId: testCase.groupId,
        lostGoldEvidenceIds: difference(
          control.coveredGoldEvidenceIds,
          treatment.coveredGoldEvidenceIds,
        ),
        lostRetrievedEvidenceIds: difference(
          control.retrievedEvidenceIds,
          treatment.retrievedEvidenceIds,
        ),
        noiseEvidenceDelta:
          treatment.noiseEvidenceIds.length - control.noiseEvidenceIds.length,
        questionId: testCase.questionId,
        recallRecordCountDelta:
          treatment.recallRecordCount - control.recallRecordCount,
        removedNoiseEvidenceIds: difference(
          control.noiseEvidenceIds,
          treatment.noiseEvidenceIds,
        ),
        temporalOperands: operands,
        treatment,
      };
    })
  );
  const finalSourceState = dependencies.sourceState ?? await resolveSourceState();
  if (!isDeepStrictEqual(finalSourceState, initialSourceState)) {
    throw new Error("Source state changed during temporal operand protection.");
  }
  const designatedNegativeControlQuestionCount =
    selection.locomo.questionCategoryCounts.multi_hop +
    selection.beam.questionTypeCounts.multi_session_reasoning;
  const report: Phase72TemporalOperandsProtectionReport = {
    cases,
    configuration: {
      answerCalls: 0,
      control: "single_query",
      holdoutCalls: 0,
      judgeCalls: 0,
      memoryIsolation: "fresh_seeded_memory_per_question_per_arm",
      memoryRunId: MEMORY_RUN_ID,
      multiHop: false,
      readerContext: "retrieved_raw_turns_in_source_order",
      recallSnapshot: "full_recall_without_operational_access_telemetry",
      strategy: "rules-only",
      treatment: "query_derived_temporal_operands_only",
    },
    generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    generatedBy: GENERATED_BY,
    protocol: PROTOCOL,
    runId: options.runId,
    selection: {
      ...selection,
      fileSha256: sha256(selectionRaw),
    },
    source: {
      bunVersion,
      canonicalDependencies,
      englishAnalyzerVersion,
      scriptSha256: sha256(scriptRaw),
      sourceState: initialSourceState,
    },
    summary: summarize({
      budgets: selection.budgets,
      canonicalDependencies,
      cases,
      designatedNegativeControlQuestionCount,
    }),
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
): Phase72TemporalOperandsProtectionOptions {
  return {
    beamRoot: requiredFlag(argv, "--beam-root"),
    locomoRoot: requiredFlag(argv, "--locomo-root"),
    outputDir: requiredFlag(argv, "--output-dir"),
    runId: requiredFlag(argv, "--run-id"),
    selectionFile: requiredFlag(argv, "--selection-file"),
  };
}

if (import.meta.main) {
  const report = await runPhase72TemporalOperandsProtection(
    parseOptions(process.argv.slice(2).filter((value) => value !== "--")),
  );
  console.log(JSON.stringify({
    runId: report.runId,
    summary: report.summary,
  }, null, 2));
}
