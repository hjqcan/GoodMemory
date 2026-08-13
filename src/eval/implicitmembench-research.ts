import { generateText } from "ai";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  ACTION_NAME_STOP_WORDS,
  ANALOGY_MARKERS,
  EXPLICIT_RECALL_LEAK_PATTERNS,
  LATENT_PRIMING_STOP_WORDS,
  SAFE_PRIMING_CANDIDATES,
} from "./implicitmembench-research-data";
import type { SafePrimingCandidate } from "./implicitmembench-research-data";
import { createInternalGoodMemory } from "../api/createGoodMemory";
import type { GoodMemory } from "../api/contracts";
import { createMemorySource } from "../domain/provenance";
import { createFeedbackMemory } from "../domain/records";
import type { FeedbackMemory } from "../domain/records";
import type { MemoryScope } from "../domain/scope";
import {
  applyTextResponseEnactmentPlan,
  buildBehavioralActionSteeringLines,
  buildBehavioralSteeringLines,
  buildStructuredTextResponseControlLines,
  recoverStructuredFirstActionAnswer,
  resolveTextResponseEnactmentPlan,
  readBehavioralPolicyFromFeedbackMemory,
  selectBehavioralPolicies,
  splitTopLevelCallArguments,
  type BehavioralPolicySelection,
} from "../evolution/behavioralPolicy";
import type { BehavioralFirstAction } from "../evolution/behavioralTelemetry";
import { behavioralFirstActionsEqual } from "../evolution/behavioralTelemetry";
import {
  buildRawBehavioralPrototypeIndex,
  resolveRawBehavioralCarryover,
  type RawCarryoverResolution,
  type RawBehavioralSurfaceFamily,
} from "../evolution/rawBehavioralExemplars";
import type { AISDKModelConfig } from "../provider/ai-sdk-runtime";
import {
  requestOpenAICompatibleObject,
  requestOpenAICompatibleText,
  resolveAISDKModel,
  stripThinkingBlocks,
  withAISDKRetries,
} from "../provider/ai-sdk-runtime";
import { renderMemoryPacket } from "../recall/contextBuilder";

export type ImplicitMemBenchDatasetFamily =
  | "classical_conditioning"
  | "priming"
  | "procedural_memory";

export type ImplicitMemBenchResearchProfile =
  | "baseline-upstream-chat"
  | "goodmemory-distilled-feedback"
  | "goodmemory-raw-experience";

export type ImplicitMemBenchResearchMode = "live" | "smoke";

export type ImplicitMemBenchScorerFamily =
  | "priming_pair_judge"
  | "structured_first_action"
  | "text_behavior_judge";

export interface ImplicitMemBenchMessage {
  content: string;
  role: "assistant" | "system" | "user";
}

interface StructuredTaskManifest {
  expectedFirstAction: BehavioralFirstAction;
  feedbackSignal: string;
  forbiddenFirstAction: BehavioralFirstAction;
  scorer: "structured_first_action";
}

interface TextBehaviorSmokeAssertions {
  exactAnswer?: string;
  forbiddenPhrases?: string[];
  maxWords?: number;
  requiredKeywords?: string[];
  requiredPhrases?: string[];
  requiresFirstPerson?: boolean;
}

interface TextTaskManifest {
  feedbackSignal: string;
  judgeRubric?: string;
  scorer: "text_behavior_judge";
  smokeAssertions?: TextBehaviorSmokeAssertions;
}

interface PrimingTaskManifest {
  scorer: "priming_pair_judge";
  themeKeywords: string[];
}

type ImplicitMemBenchTaskManifest =
  | PrimingTaskManifest
  | StructuredTaskManifest
  | TextTaskManifest;

export interface ImplicitMemBenchAdapterManifest {
  datasets: Record<
    ImplicitMemBenchDatasetFamily,
    Record<string, ImplicitMemBenchTaskManifest>
  >;
  version: 1;
}

const DEFAULT_IMPLICITMEMBENCH_TIMEOUT_MS = 90_000;
const DEFAULT_IMPLICITMEMBENCH_PRIMING_TIMEOUT_MS = 30_000;

export interface ImplicitMemBenchTimeoutContext {
  signal: AbortSignal;
  timeoutMs: number;
}

interface NonPrimingDatasetInstance {
  expected_pattern?: unknown;
  interference_phase: ImplicitMemBenchMessage[];
  learning_phase: ImplicitMemBenchMessage[];
  task_id: string;
  task_name: string;
  test_probe: {
    content: string;
    role: "user";
  };
}

interface PrimingBranchInstance {
  group: "control" | "experimental";
  interference_phase: ImplicitMemBenchMessage[];
  priming_phase: ImplicitMemBenchMessage[];
  test_probe: {
    category?: string;
    prompt: string;
  };
}

interface PrimingDatasetInstance {
  control_instance: PrimingBranchInstance;
  experimental_instance: PrimingBranchInstance;
  pair_id: string;
  selected_control_theme: string;
  selected_probe_id: string;
  selected_source_theme: string;
  task_id: string;
}

interface ImplicitMemBenchCaseBase {
  datasetFamily: ImplicitMemBenchDatasetFamily;
  scorerFamily: ImplicitMemBenchScorerFamily;
  sourceFile: string;
  taskFile: string;
  taskName: string;
}

function resolveImplicitMemBenchTimeoutMs(): number {
  const raw = process.env.GOODMEMORY_IMPLICITMEMBENCH_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_IMPLICITMEMBENCH_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_IMPLICITMEMBENCH_TIMEOUT_MS;
  }

  return parsed;
}

function resolveImplicitMemBenchPrimingTimeoutMs(): number {
  const raw = process.env.GOODMEMORY_IMPLICITMEMBENCH_PRIMING_TIMEOUT_MS;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return Math.min(
    resolveImplicitMemBenchTimeoutMs(),
    DEFAULT_IMPLICITMEMBENCH_PRIMING_TIMEOUT_MS,
  );
}

export async function withImplicitMemBenchTimeout<T>(input: {
  label: string;
  run: (context: ImplicitMemBenchTimeoutContext) => Promise<T>;
  timeoutMs?: number;
}): Promise<T> {
  const timeoutMs = input.timeoutMs ?? resolveImplicitMemBenchTimeoutMs();

  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const timeoutError = new Error(
      `ImplicitMemBench ${input.label} timed out after ${timeoutMs}ms`,
    );
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);

    let operation: Promise<T>;
    try {
      operation = input.run({ signal: controller.signal, timeoutMs });
    } catch (error) {
      settled = true;
      clearTimeout(timer);
      controller.abort(error);
      reject(error);
      return;
    }

    void operation.then(
      (value) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        controller.abort(error);
        reject(error);
      },
    );
  });
}

function resolveImplicitMemBenchAbortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }

  if (typeof signal.reason === "string" && signal.reason.trim().length > 0) {
    return new Error(signal.reason);
  }

  return new Error("ImplicitMemBench operation aborted.");
}

function throwIfImplicitMemBenchAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw resolveImplicitMemBenchAbortReason(signal);
  }
}

function sleepUnlessImplicitMemBenchAborted(
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(resolveImplicitMemBenchAbortReason(signal));
  }

  return new Promise<void>((resolveSleep, rejectSleep) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolveSleep();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      rejectSleep(resolveImplicitMemBenchAbortReason(signal));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function createImplicitMemBenchRetryOptions(signal: AbortSignal) {
  return {
    sleep: (ms: number) => sleepUnlessImplicitMemBenchAborted(ms, signal),
  };
}

export interface StructuredImplicitMemBenchCase extends ImplicitMemBenchCaseBase {
  caseId: string;
  datasetFamily: "procedural_memory";
  expectedPattern?: string;
  feedbackSignal: string;
  fixture: StructuredTaskManifest;
  instance: NonPrimingDatasetInstance;
  scorerFamily: "structured_first_action";
}

export interface TextImplicitMemBenchCase extends ImplicitMemBenchCaseBase {
  caseId: string;
  datasetFamily: "classical_conditioning" | "procedural_memory";
  expectedPattern?: string;
  feedbackSignal: string;
  fixture: TextTaskManifest;
  instance: NonPrimingDatasetInstance;
  scorerFamily: "text_behavior_judge";
}

export interface PrimingImplicitMemBenchCase extends ImplicitMemBenchCaseBase {
  caseId: string;
  datasetFamily: "priming";
  fixture: PrimingTaskManifest;
  instance: PrimingDatasetInstance;
  scorerFamily: "priming_pair_judge";
}

export type ImplicitMemBenchResearchCase =
  | PrimingImplicitMemBenchCase
  | StructuredImplicitMemBenchCase
  | TextImplicitMemBenchCase;

export interface ImplicitMemBenchCaseResult {
  answer?: string;
  blocking: boolean;
  caseId: string;
  datasetFamily: ImplicitMemBenchDatasetFamily;
  distilledContextDiagnostics?: {
    compiledPolicyCount: number;
    contextEmpty: boolean;
    fallbackPolicyCount: number;
    immediateFeedbackSignalApplied: boolean;
  };
  executionFailure?: string;
  explicitRecallLeak: boolean;
  feedbackSignalApplied: boolean;
  firstAction?: BehavioralFirstAction;
  firstActionRaw?: string;
  judgeReason?: string;
  memoryContext?: string;
  passed?: boolean;
  primingControlAnswer?: string;
  primingExperimentalAnswer?: string;
  primingInfluenceScore?: number;
  rawCarryover?: {
    abstainReason?: string;
    candidatePrototypeIds: string[];
    conflictPrototypeIds?: string[];
    diagnosis?:
      | "abstain"
      | "executor_unsafe"
      | "hypothesis_missing"
      | "memory_miss"
      | "reasoning_after_correct_hypothesis"
      | "selected_and_passed"
      | "support_conflict"
      | "wrong_exemplar";
    hypothesis?: {
      confidence: number;
      executionMode: "abstain" | "model_only" | "transient_executor";
      mappingType:
        | "conditional_precondition"
        | "exact_surface_copy"
        | "guarded_decision"
        | "exact_format_contract"
        | "hard_constraint_contract"
        | "slot_rebinding"
        | "style_contract"
        | "symbolic_formula"
        | "symbolic_rule_execution";
      supportingPrototypeIds: string[];
    };
    goldSupportingCandidatePresent?: boolean;
    mode: "abstained" | "exemplar_only" | "fallback_context" | "none";
    selectedExemplarIds: string[];
    selectedPrototypeIds: string[];
    supportPrototypeIds?: string[];
    topProbability?: number;
    topScore?: number;
  };
  profile: ImplicitMemBenchResearchProfile;
  scorerFamily: ImplicitMemBenchScorerFamily;
  sourceFile: string;
  taskFile: string;
  taskName: string;
}

export interface ImplicitMemBenchProfileSummary {
  caseCountsByDataset: Record<ImplicitMemBenchDatasetFamily, number>;
  caseCountsByScorer: Record<ImplicitMemBenchScorerFamily, number>;
  cases: ImplicitMemBenchCaseResult[];
  distilledCompiledPolicyCount?: number;
  distilledContextEmptyCount?: number;
  distilledContextExamples?: Array<{
    caseId: string;
    judgeReason?: string;
    taskFile: string;
  }>;
  distilledContextPassRate?: number | null;
  distilledFallbackPolicyCount?: number;
  executionFailures: number;
  explicitRecallLeakCount: number;
  passedBlockingCases: number;
  primingAverageScore: number | null;
  totalBlockingCases: number;
  totalCases: number;
}

export interface ImplicitMemBenchResearchReport {
  benchmarkRoot: string;
  generatedAt: string;
  generatedBy: string;
  kind: "baseline" | "goodmemory";
  manifestPath: string;
  mode: ImplicitMemBenchResearchMode;
  outputDir: string;
  profiles: Partial<
    Record<ImplicitMemBenchResearchProfile, ImplicitMemBenchProfileSummary>
  >;
  runDirectory: string;
  runId: string;
  source: {
    benchmark: "ImplicitMemBench";
    license: "CC BY 4.0";
    url: string;
  };
  summary: {
    caseCountsByDataset: Record<ImplicitMemBenchDatasetFamily, number>;
    caseCountsByScorer: Record<ImplicitMemBenchScorerFamily, number>;
    executionFailures: number;
    explicitRecallLeakCount: number;
    passedBlockingCases: number;
    primingAverageScore: number | null;
    totalBlockingCases: number;
    totalCases: number;
  };
}

export interface ImplicitMemBenchComparisonCaseResult {
  baseline?: ImplicitMemBenchCaseResult;
  caseId: string;
  datasetFamily: ImplicitMemBenchDatasetFamily;
  distilled?: ImplicitMemBenchCaseResult;
  raw?: ImplicitMemBenchCaseResult;
  scorerFamily: ImplicitMemBenchScorerFamily;
  sourceFile: string;
  taskFile: string;
  taskName: string;
}

export interface ImplicitMemBenchComparisonReport {
  baselineReportPath: string;
  benchmarkRoot: string;
  comparison: {
    byScorer: Record<
      ImplicitMemBenchScorerFamily,
      {
        baselineBlockingPassRate: number | null;
        caseCount: number;
        goodmemoryDistilledBlockingPassRate: number | null;
        goodmemoryRawBlockingPassRate: number | null;
        primingDeltaOfDelta: number | null;
        primingScoreBaseline: number | null;
        primingScoreRaw: number | null;
      }
    >;
    cases: ImplicitMemBenchComparisonCaseResult[];
  };
  generatedAt: string;
  generatedBy: string;
  goodmemoryReportPath: string;
  kind: "comparison";
  manifestPath: string;
  mode: ImplicitMemBenchResearchMode;
  outputDir: string;
  runDirectory: string;
  runId: string;
  source: {
    benchmark: "ImplicitMemBench";
    license: "CC BY 4.0";
    url: string;
  };
  summary: {
    caseCount: number;
    scorerFamilies: ImplicitMemBenchScorerFamily[];
  };
}

export interface ImplicitMemBenchTextJudgeResult {
  failure_tags: string[];
  passed: boolean;
  reasoning: string;
}

export interface ImplicitMemBenchPrimingJudgeResult {
  priming_influence_score: number;
  reasoning: string;
}

interface ResearchTextGenerationInput {
  caseDefinition: ImplicitMemBenchResearchCase;
  memoryContext?: string;
  profile: ImplicitMemBenchResearchProfile;
  prompt: string;
}

interface ResearchTextJudgeInput {
  answer: string;
  caseDefinition: TextImplicitMemBenchCase;
  profile: ImplicitMemBenchResearchProfile;
}

interface ResearchPrimingJudgeInput {
  caseDefinition: PrimingImplicitMemBenchCase;
  controlAnswer: string;
  experimentalAnswer: string;
  profile: ImplicitMemBenchResearchProfile;
}

export interface ImplicitMemBenchResearchDependencies {
  createMemory?: (input: {
    profile: ImplicitMemBenchResearchProfile;
    scope: MemoryScope;
  }) => GoodMemory;
  generateTextAnswer?: (
    input: ResearchTextGenerationInput,
  ) => Promise<string>;
  judgePrimingPair?: (
    input: ResearchPrimingJudgeInput,
  ) => Promise<ImplicitMemBenchPrimingJudgeResult>;
  judgeTextBehavior?: (
    input: ResearchTextJudgeInput,
  ) => Promise<ImplicitMemBenchTextJudgeResult>;
  now?: () => string;
}

export interface RunImplicitMemBenchBaselineOptions {
  benchmarkRoot: string;
  cases?: readonly ImplicitMemBenchResearchCase[];
  dependencies?: ImplicitMemBenchResearchDependencies;
  generatedBy: string;
  limit?: number;
  manifestPath: string;
  maxConcurrency?: number;
  mode: ImplicitMemBenchResearchMode;
  outputDir: string;
  runId?: string;
}

export interface RunImplicitMemBenchGoodMemoryOptions
  extends RunImplicitMemBenchBaselineOptions {}

export interface RunImplicitMemBenchComparisonOptions
  extends RunImplicitMemBenchBaselineOptions {}

const RESEARCH_SOURCE = {
  benchmark: "ImplicitMemBench",
  license: "CC BY 4.0",
  url: "https://github.com/qinchonghanzuibang/ImplicitMemBench",
} as const;

const BASELINE_PROFILE = "baseline-upstream-chat";
const GOODMEMORY_PROFILES = [
  "goodmemory-raw-experience",
  "goodmemory-distilled-feedback",
] as const satisfies readonly ImplicitMemBenchResearchProfile[];
const ALL_SCORER_FAMILIES = [
  "structured_first_action",
  "text_behavior_judge",
  "priming_pair_judge",
] as const satisfies readonly ImplicitMemBenchScorerFamily[];

const textJudgeSchema = z.object({
  failure_tags: z.array(z.string()),
  passed: z.boolean(),
  reasoning: z.string(),
});

const primingJudgeSchema = z.object({
  priming_influence_score: z.number().min(0).max(100),
  reasoning: z.string(),
});

function emptyDatasetCounts(): Record<ImplicitMemBenchDatasetFamily, number> {
  return {
    classical_conditioning: 0,
    priming: 0,
    procedural_memory: 0,
  };
}

function emptyScorerCounts(): Record<ImplicitMemBenchScorerFamily, number> {
  return {
    priming_pair_judge: 0,
    structured_first_action: 0,
    text_behavior_judge: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }

  return value;
}

function validateMessage(
  value: unknown,
  path: string,
): ImplicitMemBenchMessage {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  const role = assertString(value.role, `${path}.role`).toLowerCase();
  if (role !== "assistant" && role !== "system" && role !== "user") {
    throw new Error(`${path}.role must be assistant, system, or user`);
  }

  return {
    content: assertString(value.content, `${path}.content`),
    role,
  };
}

function validateMessageArray(
  value: unknown,
  path: string,
): ImplicitMemBenchMessage[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty array`);
  }

  return value.map((entry, index) => validateMessage(entry, `${path}[${index}]`));
}

function validateBehavioralFirstAction(
  value: unknown,
  path: string,
): BehavioralFirstAction {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  const kind = assertString(value.kind, `${path}.kind`);
  if (kind !== "command" && kind !== "tool_call" && kind !== "warning") {
    throw new Error(`${path}.kind must be command, tool_call, or warning`);
  }

  const name = assertString(value.name, `${path}.name`);
  const args = value.args;
  if (
    args !== undefined &&
    (!Array.isArray(args) || args.some((entry) => typeof entry !== "string"))
  ) {
    throw new Error(`${path}.args must be a string array`);
  }
  const raw = value.raw;
  if (raw !== undefined && typeof raw !== "string") {
    throw new Error(`${path}.raw must be a string`);
  }

  return {
    kind,
    name,
    ...(Array.isArray(args) ? { args: [...args] } : {}),
    ...(typeof raw === "string" ? { raw } : {}),
  };
}

function validateSmokeAssertions(
  value: unknown,
  path: string,
): TextBehaviorSmokeAssertions | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  const exactAnswer =
    value.exactAnswer === undefined
      ? undefined
      : assertString(value.exactAnswer, `${path}.exactAnswer`);
  const forbiddenPhrases = value.forbiddenPhrases;
  if (
    forbiddenPhrases !== undefined &&
    (!Array.isArray(forbiddenPhrases) ||
      forbiddenPhrases.some((entry) => typeof entry !== "string"))
  ) {
    throw new Error(`${path}.forbiddenPhrases must be a string array`);
  }
  const requiredKeywords = value.requiredKeywords;
  if (
    requiredKeywords !== undefined &&
    (!Array.isArray(requiredKeywords) ||
      requiredKeywords.some((entry) => typeof entry !== "string"))
  ) {
    throw new Error(`${path}.requiredKeywords must be a string array`);
  }
  const requiredPhrases = value.requiredPhrases;
  if (
    requiredPhrases !== undefined &&
    (!Array.isArray(requiredPhrases) ||
      requiredPhrases.some((entry) => typeof entry !== "string"))
  ) {
    throw new Error(`${path}.requiredPhrases must be a string array`);
  }
  const maxWords = value.maxWords;
  if (maxWords !== undefined && typeof maxWords !== "number") {
    throw new Error(`${path}.maxWords must be a number`);
  }
  const requiresFirstPerson = value.requiresFirstPerson;
  if (
    requiresFirstPerson !== undefined &&
    typeof requiresFirstPerson !== "boolean"
  ) {
    throw new Error(`${path}.requiresFirstPerson must be a boolean`);
  }

  return {
    ...(exactAnswer ? { exactAnswer } : {}),
    ...(Array.isArray(forbiddenPhrases)
      ? { forbiddenPhrases: [...forbiddenPhrases] }
      : {}),
    ...(typeof maxWords === "number" ? { maxWords } : {}),
    ...(Array.isArray(requiredKeywords)
      ? { requiredKeywords: [...requiredKeywords] }
      : {}),
    ...(Array.isArray(requiredPhrases)
      ? { requiredPhrases: [...requiredPhrases] }
      : {}),
    ...(typeof requiresFirstPerson === "boolean"
      ? { requiresFirstPerson }
      : {}),
  };
}

function validateTaskManifest(
  value: unknown,
  path: string,
): ImplicitMemBenchTaskManifest {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  const scorer = assertString(value.scorer, `${path}.scorer`);
  if (scorer === "structured_first_action") {
    return {
      expectedFirstAction: validateBehavioralFirstAction(
        value.expectedFirstAction,
        `${path}.expectedFirstAction`,
      ),
      feedbackSignal: assertString(value.feedbackSignal, `${path}.feedbackSignal`),
      forbiddenFirstAction: validateBehavioralFirstAction(
        value.forbiddenFirstAction,
        `${path}.forbiddenFirstAction`,
      ),
      scorer,
    };
  }

  if (scorer === "text_behavior_judge") {
    return {
      feedbackSignal: assertString(value.feedbackSignal, `${path}.feedbackSignal`),
      judgeRubric:
        typeof value.judgeRubric === "string" ? value.judgeRubric : undefined,
      scorer,
      smokeAssertions: validateSmokeAssertions(
        value.smokeAssertions,
        `${path}.smokeAssertions`,
      ),
    };
  }

  if (scorer === "priming_pair_judge") {
    const themeKeywords = value.themeKeywords;
    if (
      !Array.isArray(themeKeywords) ||
      themeKeywords.length === 0 ||
      themeKeywords.some((entry) => typeof entry !== "string")
    ) {
      throw new Error(`${path}.themeKeywords must be a non-empty string array`);
    }

    return {
      scorer,
      themeKeywords: [...themeKeywords],
    };
  }

  throw new Error(`${path}.scorer has unsupported value`);
}

export function validateImplicitMemBenchAdapterManifest(
  value: unknown,
  path = "manifest",
): ImplicitMemBenchAdapterManifest {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  if (value.version !== 1) {
    throw new Error(`${path}.version must be 1`);
  }

  if (!isRecord(value.datasets)) {
    throw new Error(`${path}.datasets must be an object`);
  }

  const datasets = {} as Record<
    ImplicitMemBenchDatasetFamily,
    Record<string, ImplicitMemBenchTaskManifest>
  >;
  for (const datasetFamily of [
    "classical_conditioning",
    "priming",
    "procedural_memory",
  ] as const) {
    const datasetValue = value.datasets[datasetFamily];
    if (!isRecord(datasetValue)) {
      throw new Error(`${path}.datasets.${datasetFamily} must be an object`);
    }

    const tasks: Record<string, ImplicitMemBenchTaskManifest> = {};
    for (const [taskFile, taskManifest] of Object.entries(datasetValue)) {
      tasks[taskFile] = validateTaskManifest(
        taskManifest,
        `${path}.datasets.${datasetFamily}.${taskFile}`,
      );
    }
    datasets[datasetFamily] = tasks;
  }

  return {
    datasets,
    version: 1,
  };
}

async function loadAdapterManifest(
  manifestPath: string,
): Promise<ImplicitMemBenchAdapterManifest> {
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  return validateImplicitMemBenchAdapterManifest(parsed);
}

function validateNonPrimingInstance(
  value: unknown,
  path: string,
): NonPrimingDatasetInstance {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  if (!isRecord(value.test_probe)) {
    throw new Error(`${path}.test_probe must be an object`);
  }

  return {
    expected_pattern: value.expected_pattern,
    interference_phase: validateMessageArray(
      value.interference_phase,
      `${path}.interference_phase`,
    ),
    learning_phase: validateMessageArray(
      value.learning_phase,
      `${path}.learning_phase`,
    ),
    task_id: assertString(value.task_id, `${path}.task_id`),
    task_name: assertString(value.task_name, `${path}.task_name`),
    test_probe: {
      content: assertString(value.test_probe.content, `${path}.test_probe.content`),
      role: "user",
    },
  };
}

function validatePrimingBranch(
  value: unknown,
  path: string,
): PrimingBranchInstance {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  if (!isRecord(value.test_probe)) {
    throw new Error(`${path}.test_probe must be an object`);
  }

  const group = assertString(value.group, `${path}.group`);
  if (group !== "control" && group !== "experimental") {
    throw new Error(`${path}.group must be control or experimental`);
  }

  return {
    group,
    interference_phase: validateMessageArray(
      value.interference_phase,
      `${path}.interference_phase`,
    ),
    priming_phase: validateMessageArray(
      value.priming_phase,
      `${path}.priming_phase`,
    ),
    test_probe: {
      category:
        typeof value.test_probe.category === "string"
          ? value.test_probe.category
          : undefined,
      prompt: assertString(value.test_probe.prompt, `${path}.test_probe.prompt`),
    },
  };
}

function validatePrimingInstance(
  value: unknown,
  path: string,
): PrimingDatasetInstance {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  return {
    control_instance: validatePrimingBranch(
      value.control_instance,
      `${path}.control_instance`,
    ),
    experimental_instance: validatePrimingBranch(
      value.experimental_instance,
      `${path}.experimental_instance`,
    ),
    pair_id: assertString(value.pair_id, `${path}.pair_id`),
    selected_control_theme: assertString(
      value.selected_control_theme,
      `${path}.selected_control_theme`,
    ),
    selected_probe_id: assertString(
      value.selected_probe_id,
      `${path}.selected_probe_id`,
    ),
    selected_source_theme: assertString(
      value.selected_source_theme,
      `${path}.selected_source_theme`,
    ),
    task_id: assertString(value.task_id, `${path}.task_id`),
  };
}

function normalizeExpectedPattern(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return undefined;
  }

  return JSON.stringify(value);
}

function deriveStructuredTaskManifest(input: {
  instance: NonPrimingDatasetInstance;
  taskManifest: StructuredTaskManifest;
}): StructuredTaskManifest {
  const expectedPattern = normalizeExpectedPattern(input.instance.expected_pattern);
  if (!expectedPattern) {
    return input.taskManifest;
  }

  const expectedFirstAction = parseFirstActionFromAnswer(
    extractEmbeddedStructuredActionCandidate(expectedPattern) ?? expectedPattern,
  );
  if (!expectedFirstAction) {
    return input.taskManifest;
  }

  return {
    ...input.taskManifest,
    expectedFirstAction,
  };
}

interface LearningOutcomeSample {
  assistant: string;
  system: string;
  user: string;
}


function isFailureSystemMessage(message: string): boolean {
  if (/^\s*success\b/iu.test(message)) {
    return false;
  }

  return (
    /\b(error|warning|timeout|failed|failure|cannot|busy|denied|full|overloaded|limit exceeded|insecure|not helpful|empty result set|confus(?:ed|ing)|do not understand|don't understand|did not understand|unclear|unsupported|complex|complicated)\b/iu.test(
      message,
    ) ||
    /\bcue detected\b.*\b(impatience|terse|lengthy|verbose|long answer)\b/iu.test(
      message,
    )
  );
}

function isSuccessSystemMessage(message: string): boolean {
  return /\b(success|successfully|completed|available|normal|idle|operational|healthy|started|helpful|clear|makes sense|understand(?:s|ing)?|understood|correct)\b/iu.test(
    message,
  );
}

function extractLearningOutcomeSamples(
  messages: readonly ImplicitMemBenchMessage[],
): {
  failed: LearningOutcomeSample[];
  succeeded: LearningOutcomeSample[];
} {
  const failed: LearningOutcomeSample[] = [];
  const succeeded: LearningOutcomeSample[] = [];

  for (let index = 0; index <= messages.length - 3; index += 1) {
    const first = messages[index];
    const second = messages[index + 1];
    const third = messages[index + 2];
    if (
      first.role !== "user" ||
      second.role !== "assistant" ||
      third.role !== "system"
    ) {
      continue;
    }

    const sample = {
      assistant: second.content,
      system: third.content,
      user: first.content,
    } satisfies LearningOutcomeSample;
    if (isFailureSystemMessage(third.content)) {
      failed.push(sample);
      continue;
    }
    if (isSuccessSystemMessage(third.content)) {
      succeeded.push(sample);
    }
  }

  return { failed, succeeded };
}

function extractNamedAction(text: string): string | undefined {
  for (const pattern of [
    /\b(?:using|with)\s+([A-Za-z_][A-Za-z0-9_]*)\b/giu,
    /\bto\s+([A-Z][A-Za-z0-9_]*)\b/gu,
    /\b(?:run(?:ning)?|execut(?:e|ing)|call(?:ing)?|invok(?:e|ing)|start(?:ing)?|submit(?:ting)?|dispatch(?:ing)?|enqueu(?:e|ing)|process(?:ing)?|trigger(?:ing)?|send(?:ing)?)\s+([A-Z][A-Za-z0-9_]*)\b/giu,
    /\b([A-Z][A-Za-z0-9_]+)\b/gu,
  ]) {
    for (const match of text.matchAll(pattern)) {
      const candidate = match[1]?.trim();
      if (
        candidate &&
        candidate.toLowerCase() !== "warning" &&
        candidate.toLowerCase() !== "system" &&
        !ACTION_NAME_STOP_WORDS.has(candidate.toLowerCase())
      ) {
        return candidate;
      }
    }
  }

  return undefined;
}

function looksLikeStructuredActionName(value: string): boolean {
  const normalized = value.trim();
  return (
    /_/.test(normalized) ||
    /[a-z0-9][A-Z]/u.test(normalized) ||
    /^[A-Z]{2,}[A-Za-z0-9]*$/u.test(normalized)
  );
}

function normalizePathRoot(path: string): string {
  if (path.startsWith("/home/")) {
    return "/home/";
  }
  if (path.startsWith("~/")) {
    return "~/";
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 2) {
    return `/${segments[0]}/${segments[1]}`;
  }
  if (segments.length === 1) {
    return `/${segments[0]}`;
  }
  return path;
}

function extractPathRoots(text: string): string[] {
  const roots = [...text.matchAll(/(?:~\/|\/)[A-Za-z0-9._/-]*[A-Za-z0-9_/-]/gu)]
    .map((match) => match[0]?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => normalizePathRoot(value));
  return [...new Set(roots)];
}

function extractPaths(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/(?:~\/|\/)[A-Za-z0-9._/-]*[A-Za-z0-9._-]/gu)]
        .map((match) => match[0]?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function toFilePathTemplate(path: string): { anchor: string; example: string } | undefined {
  if (!(path.startsWith("/home/") || path.startsWith("~/"))) {
    return undefined;
  }

  const normalized = path.trim();
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0 || lastSlash === normalized.length - 1) {
    return undefined;
  }

  const anchor = `${normalized.slice(0, lastSlash + 1)}`;
  return {
    anchor,
    example: `${anchor}<file>`,
  };
}

function normalizeSentence(text: string): string {
  return text.replace(/\.\.\.$/u, "").replace(/\s+/gu, " ").trim();
}

function normalizeInstructionSentence(text: string): string {
  return normalizeSentence(text).replace(
    /^(?:sure|of course|certainly|absolutely|for example|yes)[,:]?\s+/iu,
    "",
  );
}

function uniqueStrings(values: Iterable<string | undefined>): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
}

function extractFileExtensions(text: string): string[] {
  const extensions = [...text.matchAll(/\.[A-Za-z0-9]+/gu)]
    .map((match) => match[0]?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  return [...new Set(extensions)];
}

function extractUrls(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/https?:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?/gu)]
        .map((match) => match[0]?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}


function looksLikeAnalogyExplanation(text: string): boolean {
  const normalized = normalizeSentence(text).toLowerCase();
  return ANALOGY_MARKERS.some((marker) => normalized.includes(marker));
}

function extractQuotedFragments(text: string): string[] {
  return [...text.matchAll(/["'`]([^"'`]+)["'`]/gu)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
}

function extractConceptPhrase(text: string): string | undefined {
  const normalized = normalizeSentence(text);
  for (const pattern of [
    /\b(?:explain|describ(?:e|ing)|define|tell me about)\s+(?:what\s+)?(.+?)(?:\s+(?:does|do|is|are|means?|mean|work|works)|[?.!,]|$)/iu,
    /\bwhat\s+is\s+(.+?)(?:[?.!,]|$)/iu,
    /\bwhat\s+does\s+(.+?)\s+do(?:[?.!,]|$)/iu,
    /\btell me about\s+(.+?)(?:[?.!,]|$)/iu,
  ] as const) {
    const match = normalized.match(pattern);
    const value = match?.[1]
      ?.replace(/^(?:the\s+concept\s+of)\s+/iu, "")
      ?.replace(/\bin simple terms\b/giu, "")
      .replace(/\bsimply\b/giu, "")
      .replace(/\bto a beginner\b/giu, "")
      .replace(/\bin programming\b/giu, "")
      .replace(/\busing technical jargon\b/giu, "")
      .replace(/\bto me\b/giu, "")
      .replace(/\bagain\b/giu, "")
      .replace(/^(?:a|an|the)\s+/iu, "")
      .replace(/\s+/gu, " ")
      .trim();
    if (value && value.length <= 80) {
      return value;
    }
  }

  const quoted = extractQuotedFragments(normalized)[0];
  if (quoted && quoted.length <= 80) {
    return quoted;
  }

  return undefined;
}

function extractRequestPattern(text: string): string | undefined {
  const normalized = normalizeSentence(text);
  for (const pattern of [
    /\b(?:need|want|provide|give|run|perform|start|generate|create|process|do)\s+(?:a|an|the)?\s*(detailed analysis|comprehensive report|full system scan|complete backup|full backup|full dataset processing|full dataset audit|deep-dive analysis|deep dive analysis|in-depth investigation|thorough audit|comprehensive optimization|security review)(?:\b|[?.!,])/iu,
    /\b(detailed analysis|comprehensive report|full system scan|complete backup|full backup|deep-dive analysis|deep dive analysis|in-depth investigation|thorough audit|comprehensive optimization)(?:\b|[?.!,])/iu,
  ] as const) {
    const match = normalized.match(pattern);
    const value = match?.[1]?.replace(/\s+/gu, " ").trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function looksLikeExplicitFormatInstruction(text: string): boolean {
  const normalized = normalizeSentence(text).toLowerCase();
  return (
    extractQuotedFragments(text).length > 0 &&
    /\b(begin|start|close|end|sign off|greeting|subject|reference|cc:|purpose:|dear|hello|hi|sincerely|regards|respectfully)\b/u.test(
      normalized,
    )
  );
}

function looksLikeExplicitStyleInstruction(text: string): boolean {
  const normalized = normalizeSentence(text).toLowerCase();
  return (
    /\b(?:must|should|only|strictly|required|remember)\b/u.test(normalized) &&
    /\b(?:first-person|pronouns?|voice|simile|similes|imagery|botanical|biological|character)\b/u.test(
      normalized,
    )
  );
}

function extractFormulaInstruction(
  text: string,
  learningPhase?: readonly ImplicitMemBenchMessage[],
): string | undefined {
  const normalized = normalizeInstructionSentence(text);
  const recurrenceMatch = normalized.match(
    /\b([A-Z][A-Za-z0-9_]*)\s*\(n\)\s*=\s*([^.]+)\.?$/u,
  );
  if (recurrenceMatch?.[1] && recurrenceMatch[2]) {
    const sequenceName = recurrenceMatch[1].trim();
    const definitionalFormula = `${sequenceName}(n) = ${recurrenceMatch[2].trim()}`;
    const baseCases = learningPhase
      ?.flatMap((message) =>
        [
          ...message.content.matchAll(
            new RegExp(
              `${sequenceName}\\((-?\\d+)\\)\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`,
              "gu",
            ),
          ),
        ].map((match) =>
          `${sequenceName}(${match[1]}) = ${match[2]}`,
        ),
      )
      .filter((value, index, all) => all.indexOf(value) === index);
    const baseCaseInstruction =
      baseCases && baseCases.length > 0
        ? ` Retain any probe-provided base values, otherwise fall back to ${baseCases.join(" and ")}.`
        : "";
    return `Use the rule ${definitionalFormula}.${baseCaseInstruction} Recompute from the current probe's values instead of reusing example outputs.`;
  }

  const definitionalFormula = normalized.match(
    /\b([a-z]\s*[⊗⊕⊖Ω]\s*[a-z]\s*=\s*[^.]+)\.?$/u,
  )?.[1];
  if (definitionalFormula) {
    return `Use the rule ${definitionalFormula}. Recompute using the current operands from the probe instead of reusing example outputs.`;
  }

  return undefined;
}

function synthesizeProceduralRuleInstructions(
  instance: NonPrimingDatasetInstance,
): string[] {
  return instance.learning_phase
    .filter(
      (message): message is ImplicitMemBenchMessage & { role: "assistant" } =>
        message.role === "assistant",
    )
    .flatMap((message) => {
      const instructions: string[] = [];
      if (looksLikeExplicitFormatInstruction(message.content)) {
        instructions.push(normalizeInstructionSentence(message.content));
      }
      if (looksLikeExplicitStyleInstruction(message.content)) {
        instructions.push(normalizeInstructionSentence(message.content));
      }
      const formulaInstruction = extractFormulaInstruction(
        message.content,
        instance.learning_phase,
      );
      if (formulaInstruction) {
        instructions.push(formulaInstruction);
      }
      return instructions;
    })
    .filter((value) => value.length > 0);
}

function parseStructuredActionExample(
  value: string,
): { kind: "command" | "tool_call"; name: string; raw: string } | undefined {
  const trimmed = normalizeSentence(value);
  const toolCallMatch = trimmed.match(/([\p{L}_][\p{L}\p{N}_]*)\((.*)\)/u);
  if (toolCallMatch) {
    return {
      kind: "tool_call",
      name: toolCallMatch[1],
      raw: toolCallMatch[0].trim(),
    };
  }

  for (const pattern of [
    /["'`]([A-Za-z_][A-Za-z0-9_]*\s+\|[^"'`]+\|)["'`]/u,
    /["'`]([A-Za-z_][A-Za-z0-9_]*\s+[^\n"'`]+)["'`]/u,
  ] as const) {
    const match = trimmed.match(pattern);
    const raw = match?.[1]?.trim();
    if (!raw) {
      continue;
    }
    const commandName = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)\b/u)?.[1];
    if (commandName) {
      return {
        kind: "command",
        name: commandName,
        raw,
      };
    }
  }

  const unquotedPipeCommand = trimmed.match(
    /([^\s"'`.,;:]+(?:\s+\|[^|]+\|(?:\|[^|]+\|)*)+)/u,
  )?.[1]?.trim();
  if (unquotedPipeCommand) {
    const parsed = parseFirstActionFromAnswer(unquotedPipeCommand);
    if (parsed && parsed.kind === "command") {
      return {
        kind: "command",
        name: parsed.name,
        raw: parsed.raw ?? unquotedPipeCommand,
      };
    }
  }

  return undefined;
}

function sanitizeStructuredTemplateRaw(raw: string, context?: string): string {
  let template = raw;
  const pathCall = template.match(/^([A-Za-z_][A-Za-z0-9_]*)\((['"](?:~\/|\/)[^'"]+['"])\s*,\s*(['"](?:~\/|\/)[^'"]+['"])\)$/u);
  if (
    pathCall &&
    /\b(?:destination|target|archive)\s+first\b/iu.test(context ?? "") &&
    /\bsource\s+second\b/iu.test(context ?? "")
  ) {
    template = `${pathCall[1]}(destination_path, source_path)`;
  }
  template = template.replace(
    /(query_payload=\{'value':\s*)'[^']+'(\})/u,
    "$1'<id>'$2",
  );
  template = template.replace(
    /(\b[A-Za-z_][A-Za-z0-9_]*\s*=\s*\{['"]value['"]:\s*)'[^']+'(\})/gu,
    "$1'<id>'$2",
  );
  template = template.replace(
    /(request_body=\{'path':\s*)'[^']+'(\})/u,
    "$1'<filename>'$2",
  );
  template = template.replace(
    /(payload=\{'item':\s*)'[^']+'(\s*,\s*'qty':\s*)\d+(\})/u,
    "$1'<item>'$2<qty>$3",
  );
  template = template.replace(/\|path\|/gu, "|folder|");
  if (
    /\bpipe path\b/iu.test(context ?? "") &&
    /^[^\s]+\s+\|[^|]+\|$/u.test(template)
  ) {
    template = template.replace(/\|[^|]+\|/u, "|path|");
  } else if (/^[^\s]+\s+\|[^|]+\|$/u.test(template)) {
    template = template.replace(/\|[^|]+\|/u, "|folder|");
  }

  const sqlWrappedCommand = template.match(
    /^([\p{L}_][\p{L}\p{N}_]*)\('([^']+)'\)$/u,
  );
  if (sqlWrappedCommand) {
    const [, commandName, commandBody] = sqlWrappedCommand;
    const sqlStart = commandBody.search(
      /\b(?:SELECT|INSERT|UPDATE|DELETE|GRANT|REVOKE|DROP)\b/u,
    );
    if (sqlStart > 0) {
      const prefix = commandBody.slice(0, sqlStart);
      const sqlAndSuffix = commandBody.slice(sqlStart);
      const prefixMatch = prefix.match(
        /^(.*[_:-]{1,2})([A-Z0-9][A-Z0-9_-]*)(\s*)$/u,
      );
      if (prefixMatch) {
        const [, prefixLead, tokenCandidate, prefixSpacing] = prefixMatch;
        const normalizedSuffix = sqlAndSuffix.replaceAll(tokenCandidate, "<token>");
        template = `${commandName}('${prefixLead}<token>${prefixSpacing}${normalizedSuffix}')`;
      }
    }
  }

  const repeatedTokenMatches = [...template.matchAll(/\b([A-Z][A-Z0-9_-]{3,})\b/gu)];
  const repeatedToken = repeatedTokenMatches
    .map((match) => match[1])
    .find((candidate, _index, all) => all.filter((entry) => entry === candidate).length >= 2);
  if (repeatedToken) {
    template = template.replace(new RegExp(repeatedToken, "gu"), "<token>");
  }

  return template;
}

function synthesizeStructuredProceduralFeedbackSignal(input: {
  fallbackSignal: string;
  instance: NonPrimingDatasetInstance;
}): string {
  const explicitStructuredInstructions = input.instance.learning_phase
    .filter(
      (message): message is ImplicitMemBenchMessage & { role: "assistant" } =>
        message.role === "assistant",
    )
    .map((message) => {
      const action = parseStructuredActionExample(message.content);
      if (!action) {
        return undefined;
      }
      const normalizedMessage = normalizeInstructionSentence(message.content);
      const templateRaw = sanitizeStructuredTemplateRaw(action.raw, message.content);
      return `Use the exact command ${templateRaw}. ${normalizedMessage}`;
    })
    .filter((value): value is string => Boolean(value));

  if (explicitStructuredInstructions.length > 0) {
    return uniqueStrings(explicitStructuredInstructions).join(" ");
  }

  return input.fallbackSignal;
}

function synthesizeProceduralTextFeedbackSignal(input: {
  fallbackSignal: string;
  instance: NonPrimingDatasetInstance;
}): string {
  const explicitInstructions = synthesizeProceduralRuleInstructions(input.instance);

  if (explicitInstructions.length > 0) {
    return uniqueStrings(explicitInstructions).join(" ");
  }

  return input.fallbackSignal;
}

function synthesizeClassicalConditioningFeedbackSignal(input: {
  fallbackSignal: string;
  instance: NonPrimingDatasetInstance;
}): string {
  const { failed, succeeded } = extractLearningOutcomeSamples(
    input.instance.learning_phase,
  );
  const lastSuccess = succeeded.at(-1);
  const failedAssistants = failed.map((sample) => sample.assistant).join("\n");
  const successAssistant = lastSuccess?.assistant ?? "";
  const successSystem = lastSuccess?.system ?? "";
  const conceptPhrase =
    extractConceptPhrase(input.instance.test_probe.content) ??
    failed.map((sample) => extractConceptPhrase(sample.user)).find(Boolean);
  const matchingAnalogySuccess = succeeded.find((sample) =>
    looksLikeAnalogyExplanation(sample.assistant),
  );
  const analogyFallbackRequested = /simple analogy/iu.test(input.fallbackSignal);

  if (
    conceptPhrase &&
    failed.length > 0 &&
    analogyFallbackRequested &&
    (matchingAnalogySuccess ||
      failed.some((sample) => /understand|confus|helpful|complex/iu.test(sample.system)))
  ) {
    return `For ${conceptPhrase}, use a simple analogy and avoid the term "${conceptPhrase}".`;
  }

  if (
    /\bhttp\b/iu.test(failedAssistants) &&
    (/\bhttps\b/iu.test(successAssistant + "\n" + successSystem) ||
      /\bsecure url\b/iu.test(successAssistant + "\n" + successSystem))
  ) {
    const failedUrls = failed.flatMap((sample) => extractUrls(sample.assistant));
    const successfulUrls = [
      ...extractUrls(successAssistant),
      ...extractUrls(successSystem),
    ];
    const templateSuccessUrl = successfulUrls.find((url) =>
      url.startsWith("https://"),
    );
    const templateFailedUrl = failedUrls.find((url) => url.startsWith("http://"));
    if (templateSuccessUrl && templateFailedUrl) {
      const successParsed = new URL(templateSuccessUrl);
      const failedParsed = new URL(templateFailedUrl);
      if (
        successParsed.host === failedParsed.host &&
        successParsed.pathname.startsWith("/") &&
        failedParsed.pathname.startsWith("/")
      ) {
        return `Prefer URLs in the form https://${successParsed.host}/<page> or warn instead of producing http://${failedParsed.host}/<page> URLs. Keep the requested page after the host as a path segment, not as a subdomain.`;
      }
    }
    return "Prefer https URLs or warn instead of producing http URLs.";
  }

  const failedRoots = [...new Set(failed.flatMap((sample) => extractPathRoots(sample.assistant)))];
  const safeRoots = [
    ...new Set([
      ...extractPathRoots(successAssistant),
      ...extractPathRoots(successSystem),
    ]),
  ].filter((root) => root === "/home/" || root === "~/");
  const safePathTemplate =
    [...extractPaths(successAssistant), ...extractPaths(successSystem)]
      .map((path) => toFilePathTemplate(path))
      .find((value): value is { anchor: string; example: string } => Boolean(value));
  if (failedRoots.length > 0 && safeRoots.length > 0) {
    if (safePathTemplate) {
      return `Do not write under ${failedRoots[0]}; refuse or redirect to a safe path in the form ${safePathTemplate.example}. Keep the requested filename under ${safePathTemplate.anchor}.`;
    }
    return `Do not write under ${failedRoots[0]}; refuse or redirect to a safe path under ${safeRoots[0]}.`;
  }

  const failedExtensions = [
    ...new Set(failed.flatMap((sample) => extractFileExtensions(sample.assistant))),
  ];
  const successfulExtensions = [
    ...new Set([
      ...extractFileExtensions(successAssistant),
      ...extractFileExtensions(successSystem),
    ]),
  ];
  if (failedExtensions.length > 0 && successfulExtensions.length > 0) {
    const failedExtension = failedExtensions[0];
    const preferredExtension =
      successfulExtensions.find((extension) => extension !== failedExtension) ??
      successfulExtensions[0];
    const tool =
      extractNamedAction(successAssistant) ?? extractNamedAction(failedAssistants);
    if (preferredExtension && preferredExtension !== failedExtension) {
      return tool
        ? `Prefer ${preferredExtension} files or warn instead of using ${failedExtension} files with ${tool}.`
        : `Prefer ${preferredExtension} files or warn instead of using ${failedExtension} files.`;
    }
  }

  const successCheckMatch = successAssistant.match(
    /^Checking\s+(.+?)(?:;|,)\s*(.+?)(?:[.]|$)/iu,
  );
  if (successCheckMatch) {
    const checkTarget = normalizeSentence(successCheckMatch[1] ?? "");
    const rest = normalizeSentence(successCheckMatch[2] ?? "");
    const condition =
      rest.match(
        /\bonly\s+(?:run|submit|dispatch|enqueue|start|process|aggregate|sync|send)\s+[A-Za-z_][A-Za-z0-9_]*\s+(?:if|when)\s+(.+?)(?:[.]|$)/iu,
      )?.[1] ??
      rest.match(/\bonly\s+(?:if|when)\s+(.+?)(?:[.]|$)/iu)?.[1] ??
      "";
    const tool =
      extractNamedAction(failedAssistants) ??
      extractNamedAction(rest) ??
      extractNamedAction(successAssistant) ??
      extractNamedAction(successSystem) ??
      extractNamedAction(checkTarget);
    if (tool && checkTarget && condition.trim().length > 0) {
      return `Before using ${tool}, check ${checkTarget} first and only proceed when ${normalizeSentence(condition)}.`;
    }
  }

  const failedTool =
    failed.map((sample) => extractNamedAction(sample.assistant)).find(Boolean) ??
    undefined;
  const successTool = extractNamedAction(successAssistant);
  if (
    failedTool &&
    successTool &&
    failedTool !== successTool &&
    looksLikeStructuredActionName(failedTool) &&
    looksLikeStructuredActionName(successTool)
  ) {
    const requestPattern =
      extractRequestPattern(input.instance.test_probe.content) ??
      failed
        .map((sample) => extractRequestPattern(sample.user))
        .find(Boolean);
    if (requestPattern) {
      return `On ${requestPattern} requests, prefer ${successTool} or warn instead of using ${failedTool}.`;
    }
    return `After repeated failures, avoid ${failedTool} and prefer ${successTool} or a warning.`;
  }

  return input.fallbackSignal;
}

export async function listImplicitMemBenchResearchCases(input: {
  benchmarkRoot: string;
  limit?: number;
  manifestPath: string;
}): Promise<ImplicitMemBenchResearchCase[]> {
  const manifest = await loadAdapterManifest(input.manifestPath);
  const benchmarkRoot = resolve(input.benchmarkRoot);
  const cases: ImplicitMemBenchResearchCase[] = [];

  for (const datasetFamily of [
    "classical_conditioning",
    "priming",
    "procedural_memory",
  ] as const) {
    const directory = join(benchmarkRoot, "dataset", datasetFamily);
    const entries = (await readdir(directory, { withFileTypes: true }).catch(
      (error: unknown) => {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return [];
        }

        throw error;
      },
    ))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const taskManifest = manifest.datasets[datasetFamily][entry.name];
      if (!taskManifest) {
        throw new Error(
          `Missing adapter manifest entry for ${datasetFamily}/${entry.name}`,
        );
      }

      const sourceFile = join(directory, entry.name);
      const parsed = JSON.parse(await readFile(sourceFile, "utf8")) as {
        instances?: unknown[];
      };
      if (!Array.isArray(parsed.instances) || parsed.instances.length === 0) {
        throw new Error(`${sourceFile} must contain a non-empty instances array`);
      }

      for (const [index, instance] of parsed.instances.entries()) {
        if (datasetFamily === "priming") {
          const primingInstance = validatePrimingInstance(
            instance,
            `${datasetFamily}/${entry.name}.instances[${index}]`,
          );
          cases.push({
            caseId: `${datasetFamily}/${entry.name}#${primingInstance.task_id}`,
            datasetFamily,
            fixture: taskManifest as PrimingTaskManifest,
            instance: primingInstance,
            scorerFamily: "priming_pair_judge",
            sourceFile,
            taskFile: entry.name,
            taskName: `${primingInstance.selected_source_theme} / ${primingInstance.selected_probe_id}`,
          });
          continue;
        }

        const nonPrimingInstance = validateNonPrimingInstance(
          instance,
          `${datasetFamily}/${entry.name}.instances[${index}]`,
        );
        const caseBase = {
          caseId: `${datasetFamily}/${entry.name}#${nonPrimingInstance.task_id}`,
          datasetFamily,
          expectedPattern: normalizeExpectedPattern(
            nonPrimingInstance.expected_pattern,
          ),
          instance: nonPrimingInstance,
          sourceFile,
          taskFile: entry.name,
          taskName: nonPrimingInstance.task_name,
        } as const;

        if (taskManifest.scorer === "priming_pair_judge") {
          throw new Error(
            `Non-priming dataset ${datasetFamily}/${entry.name} cannot use priming_pair_judge.`,
          );
        }

        if (
          datasetFamily === "procedural_memory" &&
          taskManifest.scorer === "structured_first_action"
        ) {
          const structuredTaskManifest = deriveStructuredTaskManifest({
            instance: caseBase.instance,
            taskManifest,
          });
          cases.push({
            caseId: caseBase.caseId,
            datasetFamily: "procedural_memory",
            expectedPattern: caseBase.expectedPattern,
            feedbackSignal: synthesizeStructuredProceduralFeedbackSignal({
              fallbackSignal: taskManifest.feedbackSignal,
              instance: caseBase.instance,
            }),
            fixture: structuredTaskManifest,
            instance: caseBase.instance,
            scorerFamily: "structured_first_action",
            sourceFile: caseBase.sourceFile,
            taskFile: caseBase.taskFile,
            taskName: caseBase.taskName,
          });
          continue;
        }

        const feedbackSignal =
          datasetFamily === "classical_conditioning"
            ? synthesizeClassicalConditioningFeedbackSignal({
                fallbackSignal: (taskManifest as TextTaskManifest).feedbackSignal,
                instance: nonPrimingInstance,
              })
            : datasetFamily === "procedural_memory"
              ? synthesizeProceduralTextFeedbackSignal({
                  fallbackSignal: (taskManifest as TextTaskManifest).feedbackSignal,
                  instance: nonPrimingInstance,
                })
              : (taskManifest as TextTaskManifest).feedbackSignal;

        cases.push({
          ...caseBase,
          feedbackSignal,
          fixture: taskManifest as TextTaskManifest,
          scorerFamily: "text_behavior_judge",
        });
      }
    }
  }

  if (cases.length === 0) {
    throw new Error(
      `No ImplicitMemBench dataset files found under ${join(benchmarkRoot, "dataset")}`,
    );
  }

  return input.limit ? cases.slice(0, input.limit) : cases;
}

function buildResearchScope(
  caseDefinition: ImplicitMemBenchResearchCase,
  profile: ImplicitMemBenchResearchProfile,
  runId?: string,
): MemoryScope {
  return {
    ...(runId ? { tenantId: `implicitmembench-${runId}` } : {}),
    userId: `implicitmembench-${profile}-${caseDefinition.caseId}`,
    workspaceId: `implicitmembench-${caseDefinition.taskFile}-${profile}`,
  };
}

function createDefaultMemory(): GoodMemory {
  return createInternalGoodMemory({
    storage: { provider: "memory" },
  });
}

async function replayMessages(
  memory: GoodMemory,
  scope: MemoryScope,
  messages: readonly ImplicitMemBenchMessage[],
): Promise<void> {
  await memory.remember({
    messages: messages.map((message) => ({
      content: message.content,
      role: message.role,
    })),
    scope,
  });
}

function formatConversation(messages: readonly ImplicitMemBenchMessage[]): string {
  return messages.map((message) => `${message.role}: ${message.content}`).join("\n");
}

function buildBaselinePrompt(
  caseDefinition: ImplicitMemBenchResearchCase,
): string {
  if (caseDefinition.scorerFamily === "priming_pair_judge") {
    throw new Error("Use priming branch builders for priming baseline prompts.");
  }

  const transcript = [
    ...caseDefinition.instance.learning_phase,
    ...caseDefinition.instance.interference_phase,
    caseDefinition.instance.test_probe,
  ];

  return [
    "Continue the conversation as the assistant.",
    "Apply any task-local conventions implied by the earlier exchange.",
    "Reply only to the final user request.",
    formatConversation(transcript),
  ].join("\n\n");
}

function buildPrimingBranchPrompt(input: {
  branch: PrimingBranchInstance;
}): string {
  const transcript = [
    ...input.branch.priming_phase,
    ...input.branch.interference_phase,
    {
      content: input.branch.test_probe.prompt,
      role: "user",
    },
  ] satisfies ImplicitMemBenchMessage[];

  return [
    "Continue the conversation as the assistant.",
    "Subtly carry over any prior thematic influence only if it naturally affects the final task.",
    "Do not mention memory or prior prompts explicitly.",
    formatConversation(transcript),
  ].join("\n\n");
}

function buildGoodMemoryPrompt(input: {
  caseDefinition: ImplicitMemBenchResearchCase;
  memoryContext: string;
  profile: ImplicitMemBenchResearchProfile;
}): string {
  if (input.caseDefinition.scorerFamily === "priming_pair_judge") {
    throw new Error("Use priming branch prompt builders for priming GoodMemory prompts.");
  }

  if (input.profile === "goodmemory-raw-experience") {
    return [
      input.memoryContext,
      `Current request:\n${input.caseDefinition.instance.test_probe.content}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "Apply any remembered behavioral guidance implicitly. Do not mention memory or prior notes unless the probe asks for them directly.",
    input.memoryContext ? `Memory context:\n${input.memoryContext}` : undefined,
    `Probe:\n${input.caseDefinition.instance.test_probe.content}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildGoodMemoryPrimingPrompt(input: {
  branch: PrimingBranchInstance;
  latentPacket: LatentPrimingInfluencePacket;
  profile: ImplicitMemBenchResearchProfile;
}): string {
  const context = input.latentPacket.content;
  if (input.profile === "goodmemory-raw-experience") {
    return [
      context,
      "Use the packet as a soft style prior: experimental answers should be clearly influenced by the abstract cues, while control answers should stay neutral.",
      "Prefer adjacent metaphors over generic operational words, and obey the blacklist exactly.",
      `Current request:\n${input.branch.test_probe.prompt}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "Apply any remembered behavioral guidance implicitly. Do not mention memory or prior notes unless the probe asks for them directly.",
    context ? `Memory context:\n${context}` : undefined,
    "Use the packet as a soft style prior: experimental answers should be clearly influenced by the abstract cues, while control answers should stay neutral.",
    "Prefer adjacent metaphors over generic operational words, and obey the blacklist exactly.",
    `Probe:\n${input.branch.test_probe.prompt}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

interface LatentPrimingInfluencePacket {
  affect: string;
  branchGroup: PrimingBranchInstance["group"];
  compositionStyle: string;
  content: string;
  dynamics: string;
  safeSynonymPool: string[];
  semanticField: LatentPrimingSemanticField;
  sourceNounBlacklist: string[];
}

export type LatentPrimingSemanticField =
  | "abyssal_depth"
  | "alchemy_transformation"
  | "arctic_survival"
  | "cathedral_structure"
  | "espionage_intrigue"
  | "jazz_improvisation"
  | "mycelium_network"
  | "neutral"
  | "oracle_prophecy"
  | "orbital_motion"
  | "volcanic_release";

type ExperimentalLatentPrimingSemanticField = Exclude<
  LatentPrimingSemanticField,
  "neutral"
>;

const LATENT_PRIMING_SEMANTIC_FIELD_PATTERNS = [
  {
    field: "abyssal_depth",
    pattern: /\b(abyss|bathyal|biolum|deep|ocean|sea|submers|tide|trench)\b/u,
  },
  {
    field: "oracle_prophecy",
    pattern: /\b(oracle|omen|prophe|augur|temple|fate|destin)\b/u,
  },
  {
    field: "arctic_survival",
    pattern:
      /\b(arctic|blizzard|cold|expedition|frigid|frost|glacier|ice|north|snow|tundra)\b/u,
  },
  {
    field: "cathedral_structure",
    pattern:
      /\b(arch|buttress|cathedral|chapel|choir|clerestory|glass|nave|spire|stone|vault)\b/u,
  },
  {
    field: "espionage_intrigue",
    pattern:
      /\b(cipher|clandestine|cold war|covert|dossier|embassy|espion|intrigue|secret|shadow|signal|spy|tradecraft)\b/u,
  },
  {
    field: "alchemy_transformation",
    pattern: /\b(alchem|crucible|distill|tincture)\b/u,
  },
  {
    field: "mycelium_network",
    pattern: /\b(mycel|hypha|fung|loam|root|spore|thread)\b/u,
  },
  {
    field: "orbital_motion",
    pattern:
      /\b(apogee|delta-v|eclipse|ellipt|gravity|kepler|orbit|periapsis|slingshot|vacuum|vector)\b/u,
  },
  {
    field: "jazz_improvisation",
    pattern: /\b(jazz|improvis|rhythm|syncop)\b/u,
  },
  {
    field: "volcanic_release",
    pattern:
      /\b(ash|basalt|eruption|lava|magma|molten|plume|pumice|vent|volcan)\b/u,
  },
] as const satisfies readonly {
  field: ExperimentalLatentPrimingSemanticField;
  pattern: RegExp;
}[];

const LATENT_PRIMING_THEME_LABEL_PATTERNS = [
  {
    field: "abyssal_depth",
    pattern: /\b(abyssal|deep\s+sea|oceanic|subsea)\b/u,
  },
  {
    field: "oracle_prophecy",
    pattern: /\b(oracle|prophecy|prophetic|augury)\b/u,
  },
  {
    field: "arctic_survival",
    pattern: /\b(arctic|expedition|polar|survival|tundra)\b/u,
  },
  {
    field: "cathedral_structure",
    pattern: /\b(cathedral|architecture|clerestory|buttress)\b/u,
  },
  {
    field: "espionage_intrigue",
    pattern: /\b(espionage|cold\s+war|intrigue|spycraft|tradecraft)\b/u,
  },
  {
    field: "alchemy_transformation",
    pattern: /\b(alchemy|alchemical|renaissance\s+alchemy)\b/u,
  },
  {
    field: "mycelium_network",
    pattern: /\b(mycelium|fungal|mycorrhizal)\b/u,
  },
  {
    field: "orbital_motion",
    pattern: /\b(orbital|mechanics|celestial|spaceflight)\b/u,
  },
  {
    field: "jazz_improvisation",
    pattern: /\b(jazz|improvisation|syncopation)\b/u,
  },
  {
    field: "volcanic_release",
    pattern: /\b(volcanic|eruption|volcano)\b/u,
  },
] as const satisfies readonly {
  field: ExperimentalLatentPrimingSemanticField;
  pattern: RegExp;
}[];


function normalizePrimingToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function extractLatentPrimingTokens(text: string): string[] {
  const tokens = new Set<string>();
  for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9-]{3,}/gu)) {
    const token = normalizePrimingToken(match[0] ?? "");
    if (token.length < 4 || LATENT_PRIMING_STOP_WORDS.has(token)) {
      continue;
    }

    tokens.add(token);
  }

  return [...tokens];
}

function branchThemeLabel(input: {
  branch: PrimingBranchInstance;
  caseDefinition: PrimingImplicitMemBenchCase;
}): string {
  return input.branch.group === "experimental"
    ? input.caseDefinition.instance.selected_source_theme
    : input.caseDefinition.instance.selected_control_theme;
}

function buildPrimingSourceNounBlacklist(input: {
  branch: PrimingBranchInstance;
  caseDefinition: PrimingImplicitMemBenchCase;
}): string[] {
  const themeLabel = branchThemeLabel(input);
  const texts = [
    themeLabel,
    ...(input.branch.group === "experimental"
      ? input.caseDefinition.fixture.themeKeywords
      : []),
    ...input.branch.priming_phase.map((message) => message.content),
  ];

  return [...new Set(texts.flatMap(extractLatentPrimingTokens))].sort();
}

function textContainsPrimingToken(text: string, token: string): boolean {
  return new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "iu").test(
    text,
  );
}

function containsBlacklistedPrimingToken(
  text: string,
  blacklist: readonly string[],
): boolean {
  return blacklist.some((token) => textContainsPrimingToken(text, token));
}

function safeLatentCue(input: {
  blacklist: readonly string[];
  cue: string;
}): string | null {
  return containsBlacklistedPrimingToken(input.cue, input.blacklist)
    ? null
    : input.cue;
}

function inferLatentPrimingSemanticField(input: {
  branch: PrimingBranchInstance;
  caseDefinition: PrimingImplicitMemBenchCase;
}): LatentPrimingSemanticField {
  if (input.branch.group === "control") {
    return "neutral";
  }

  const sourceThemeText =
    input.caseDefinition.instance.selected_source_theme.toLowerCase();
  for (const semanticFieldPattern of LATENT_PRIMING_THEME_LABEL_PATTERNS) {
    if (semanticFieldPattern.pattern.test(sourceThemeText)) {
      return semanticFieldPattern.field;
    }
  }

  const keywordText = input.caseDefinition.fixture.themeKeywords
    .join(" ")
    .toLowerCase();
  for (const semanticFieldPattern of LATENT_PRIMING_SEMANTIC_FIELD_PATTERNS) {
    if (semanticFieldPattern.pattern.test(keywordText)) {
      return semanticFieldPattern.field;
    }
  }

  const primingText = input.branch.priming_phase
    .map((message) => message.content)
    .join(" ")
    .toLowerCase();

  for (const semanticFieldPattern of LATENT_PRIMING_SEMANTIC_FIELD_PATTERNS) {
    if (semanticFieldPattern.pattern.test(primingText)) {
      return semanticFieldPattern.field;
    }
  }

  return "neutral";
}

const LATENT_PRIMING_CUES = {
  abyssal_depth: [
    "subsurface vastness",
    "slow descent",
    "luminous darkness",
    "submerged architecture",
  ],
  alchemy_transformation: [
    "patient transformation",
    "sealed refinement",
    "arcane craft",
    "measured transmutation",
    "athanor heat",
    "cinnabar change",
    "hermetic reduction",
    "nigredo passage",
  ],
  arctic_survival: [
    "austere endurance",
    "whiteout focus",
    "boreal restraint",
    "sheltered warmth",
  ],
  cathedral_structure: [
    "vertical reverence",
    "luminous geometry",
    "buttressed grace",
    "resonant symmetry",
  ],
  espionage_intrigue: [
    "clandestine restraint",
    "coded misdirection",
    "double-life ambiguity",
    "quiet surveillance",
  ],
  jazz_improvisation: [
    "responsive rhythm",
    "offbeat variation",
    "call and reply",
    "spontaneous structure",
  ],
  mycelium_network: [
    "underground linkage",
    "symbiotic spread",
    "distributed whisper",
    "living mesh",
  ],
  neutral: [
    "plain organization",
    "careful comparison",
    "low-emotion naming",
    "operational clarity",
  ],
  oracle_prophecy: [
    "foretelling cadence",
    "ritual uncertainty",
    "solemn prediction",
    "veiled consequence",
  ],
  orbital_motion: [
    "balanced drift",
    "elliptic timing",
    "distant alignment",
    "graceful capture",
    "barycentric balance",
    "centripetal return",
    "apsidal rhythm",
  ],
  volcanic_release: [
    "contained release",
    "subsurface tension",
    "sudden bright rupture",
    "dense afterglow",
  ],
} as const satisfies Record<LatentPrimingSemanticField, readonly string[]>;

const LATENT_PRIMING_FINGERPRINTS = {
  abyssal_depth: {
    affect: "quiet awe",
    compositionStyle: "layered, descending, spare",
    dynamics: "pressure easing into slow discovery",
    safeSynonymPool: ["submerged", "hushed", "deepward", "weightless"],
  },
  alchemy_transformation: {
    affect: "patient mystery",
    compositionStyle: "sealed, craftlike, transitional",
    dynamics: "rough matter becoming refined form",
    safeSynonymPool: ["athanor", "cinnabar", "hermetic", "nigredo"],
  },
  arctic_survival: {
    affect: "austere resolve",
    compositionStyle: "minimal, high-contrast, sheltered",
    dynamics: "scarcity narrowing into endurance",
    safeSynonymPool: ["pale", "sheltered", "hardy", "northward"],
  },
  cathedral_structure: {
    affect: "reverent clarity",
    compositionStyle: "vertical, symmetrical, luminous",
    dynamics: "weight turning into graceful support",
    safeSynonymPool: ["vaulted", "radiant", "buttressed", "sacred"],
  },
  espionage_intrigue: {
    affect: "tense discretion",
    compositionStyle: "coded, restrained, double-layered",
    dynamics: "hidden intent moving through ordinary signals",
    safeSynonymPool: ["covert", "coded", "quiet", "masked"],
  },
  jazz_improvisation: {
    affect: "alert playfulness",
    compositionStyle: "syncopated, responsive, compact",
    dynamics: "variation answering constraint in motion",
    safeSynonymPool: ["offbeat", "responsive", "blue-note", "improvised"],
  },
  mycelium_network: {
    affect: "organic patience",
    compositionStyle: "distributed, interlaced, living",
    dynamics: "small connections spreading mutual support",
    safeSynonymPool: ["rooted", "interwoven", "symbiotic", "distributed"],
  },
  neutral: {
    affect: "low-emotion clarity",
    compositionStyle: "plain, orderly, comparable",
    dynamics: "items arranged for inspection",
    safeSynonymPool: ["plain", "measured", "tidy", "indexed"],
  },
  oracle_prophecy: {
    affect: "solemn uncertainty",
    compositionStyle: "ritual, veiled, forward-looking",
    dynamics: "ambiguous signs resolving into warning",
    safeSynonymPool: ["omened", "veiled", "solemn", "foretold"],
  },
  orbital_motion: {
    affect: "calm precision",
    compositionStyle: "curved, balanced, periodic",
    dynamics: "competing pulls resolving into stable return",
    safeSynonymPool: ["apsidal", "barycentric", "centripetal", "cyclic"],
  },
  volcanic_release: {
    affect: "compressed intensity",
    compositionStyle: "dense, forceful, heat-adjacent",
    dynamics: "pressure becoming decisive release",
    safeSynonymPool: ["surge", "furnace", "bright", "compressed"],
  },
} as const satisfies Record<
  LatentPrimingSemanticField,
  {
    affect: string;
    compositionStyle: string;
    dynamics: string;
    safeSynonymPool: readonly string[];
  }
>;

function inferLatentPrimingCues(input: {
  branch: PrimingBranchInstance;
  caseDefinition: PrimingImplicitMemBenchCase;
  semanticField: LatentPrimingSemanticField;
  sourceNounBlacklist: readonly string[];
}): string[] {
  const cues = LATENT_PRIMING_CUES[input.semanticField];
  const safeCues = cues
    .map((cue) =>
      safeLatentCue({
        blacklist: input.sourceNounBlacklist,
        cue,
      }),
    )
    .filter((cue): cue is string => Boolean(cue));

  return safeCues.length > 0
    ? safeCues
    : ["indirect metaphor", "coherent mood", "restrained influence", "single image"];
}

function filterSafePrimingTerms(input: {
  sourceNounBlacklist: readonly string[];
  terms: readonly string[];
}): string[] {
  return input.terms.filter(
    (term) =>
      !containsBlacklistedPrimingToken(term, input.sourceNounBlacklist),
  );
}

function buildLatentPrimingInfluencePacket(input: {
  branch: PrimingBranchInstance;
  caseDefinition: PrimingImplicitMemBenchCase;
}): LatentPrimingInfluencePacket {
  const sourceNounBlacklist = buildPrimingSourceNounBlacklist(input);
  const semanticField = inferLatentPrimingSemanticField(input);
  const cues = inferLatentPrimingCues({
    branch: input.branch,
    caseDefinition: input.caseDefinition,
    semanticField,
    sourceNounBlacklist,
  });
  const fingerprint = LATENT_PRIMING_FINGERPRINTS[semanticField];
  const safeSynonymPool = filterSafePrimingTerms({
    sourceNounBlacklist,
    terms: fingerprint.safeSynonymPool,
  });
  const style =
    input.branch.group === "experimental"
      ? "Let the final answer lean toward these abstract cues without naming the source theme."
      : "Keep the final answer neutral, orderly, and minimally thematic.";

  return {
    affect: fingerprint.affect,
    branchGroup: input.branch.group,
    compositionStyle: fingerprint.compositionStyle,
    content: [
      "Latent priming influence packet:",
      `Branch: ${input.branch.group}`,
      `Semantic field: ${semanticField}`,
      `Abstract cues: ${cues.join("; ")}`,
      `Affect: ${fingerprint.affect}`,
      `Dynamics: ${fingerprint.dynamics}`,
      `Composition style: ${style}`,
      `Style fingerprint: ${fingerprint.compositionStyle}`,
      `Safe synonym pool: ${safeSynonymPool.join(", ") || "(none)"}`,
      `Source noun blacklist: ${sourceNounBlacklist.join(", ") || "(none)"}`,
      "Use only the abstract cues. Do not copy blacklist nouns, cite earlier messages, add markdown, or add commentary.",
    ].join("\n"),
    dynamics: fingerprint.dynamics,
    safeSynonymPool,
    semanticField,
    sourceNounBlacklist,
  };
}

function extractStrictJsonObjectText(answer: string): string | null {
  const trimmed = answer.trim();
  if (trimmed.length === 0 || trimmed.startsWith("```")) {
    return null;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== 0 || end !== trimmed.length - 1) {
    return null;
  }

  return trimmed;
}

function isValidPrimingCandidatesPayload(value: unknown): value is {
  candidates: Array<{ codename: string; rationale: string }>;
} {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "candidates")) {
    return false;
  }

  const candidates = value.candidates;
  return (
    Array.isArray(candidates) &&
    candidates.length > 0 &&
    candidates.every(
      (candidate) =>
        isRecord(candidate) &&
        typeof candidate.codename === "string" &&
        candidate.codename.trim().length > 0 &&
        typeof candidate.rationale === "string" &&
        candidate.rationale.trim().length > 0 &&
        Object.keys(candidate).every(
          (key) => key === "codename" || key === "rationale",
        ),
    )
  );
}

function parsePrimingCandidatesAnswer(answer: string): unknown | null {
  const jsonText = extractStrictJsonObjectText(answer);
  if (!jsonText) {
    return null;
  }

  try {
    return JSON.parse(jsonText) as unknown;
  } catch {
    return null;
  }
}

function strictJsonPrimingProbe(prompt: string): boolean {
  const lowerPrompt = prompt.toLowerCase();
  return lowerPrompt.includes("strict json") && lowerPrompt.includes("candidates");
}

function primingCandidateText(candidate: SafePrimingCandidate): string {
  return `${candidate.codename} ${candidate.rationale}`;
}

function selectSafeNeutralCandidate(input: {
  blacklist: readonly string[];
  index: number;
}): SafePrimingCandidate {
  const neutralCandidates = SAFE_PRIMING_CANDIDATES.neutral;
  for (let offset = 0; offset < neutralCandidates.length; offset += 1) {
    const candidate =
      neutralCandidates[(input.index + offset) % neutralCandidates.length]!;
    if (
      !containsBlacklistedPrimingToken(
        primingCandidateText(candidate),
        input.blacklist,
      )
    ) {
      return candidate;
    }
  }

  return {
    codename: `Mark${input.index + 1}`,
    rationale:
      "It suggests concise structure where essential pieces stay available for review.",
  };
}

function scoreSafePrimingCandidate(input: {
  candidate: SafePrimingCandidate;
  packet: LatentPrimingInfluencePacket;
}): number {
  const text = primingCandidateText(input.candidate).toLowerCase();
  const synonymHits = input.packet.safeSynonymPool.filter((term) =>
    textContainsPrimingToken(text, term.toLowerCase()),
  ).length;
  const cueHits = LATENT_PRIMING_CUES[input.packet.semanticField].filter((cue) =>
    cue
      .split(/\s+/u)
      .some((term) => term.length > 4 && text.includes(term.toLowerCase())),
  ).length;

  return synonymHits * 5 + cueHits * 2;
}

function rankSafePrimingCandidates(input: {
  candidates: readonly SafePrimingCandidate[];
  packet: LatentPrimingInfluencePacket;
}): SafePrimingCandidate[] {
  return [...input.candidates]
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreSafePrimingCandidate({
        candidate,
        packet: input.packet,
      }),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.candidate);
}

function buildSafePrimingCandidates(packet: LatentPrimingInfluencePacket): string {
  const semanticField =
    packet.branchGroup === "experimental" ? packet.semanticField : "neutral";
  const candidates = rankSafePrimingCandidates({
    candidates: SAFE_PRIMING_CANDIDATES[semanticField],
    packet,
  });
  const safeCandidates = candidates.slice(0, 3).map((candidate, index) =>
    containsBlacklistedPrimingToken(
      primingCandidateText(candidate),
      packet.sourceNounBlacklist,
    )
      ? selectSafeNeutralCandidate({
          blacklist: packet.sourceNounBlacklist,
          index,
        })
      : candidate,
  );

  return JSON.stringify({ candidates: safeCandidates });
}

function scorePrimingCandidatesAnswer(input: {
  answer: string;
  packet: LatentPrimingInfluencePacket;
}): number {
  const parsed = parsePrimingCandidatesAnswer(input.answer);
  if (!isValidPrimingCandidatesPayload(parsed)) {
    return -1;
  }

  return parsed.candidates.reduce(
    (score, candidate) =>
      score +
      scoreSafePrimingCandidate({
        candidate,
        packet: input.packet,
      }),
    0,
  );
}

function enforcePrimingAnswerSafety(input: {
  answer: string;
  branch: PrimingBranchInstance;
  latentPacket: LatentPrimingInfluencePacket;
}): string {
  const prompt = input.branch.test_probe.prompt;
  const hasUnsafeSourceNoun = containsBlacklistedPrimingToken(
    input.answer,
    input.latentPacket.sourceNounBlacklist,
  );

  if (strictJsonPrimingProbe(prompt)) {
    const parsed = parsePrimingCandidatesAnswer(input.answer);
    const safeCandidateAnswer = buildSafePrimingCandidates(input.latentPacket);
    if (
      isValidPrimingCandidatesPayload(parsed) &&
      !hasUnsafeSourceNoun &&
      !input.answer.includes("```")
    ) {
      const trimmedAnswer = input.answer.trim();
      if (input.branch.group === "control") {
        return safeCandidateAnswer;
      }

      const generatedScore = scorePrimingCandidatesAnswer({
        answer: trimmedAnswer,
        packet: input.latentPacket,
      });
      const safeCandidateScore = scorePrimingCandidatesAnswer({
        answer: safeCandidateAnswer,
        packet: input.latentPacket,
      });

      return safeCandidateScore > generatedScore
        ? safeCandidateAnswer
        : trimmedAnswer;
    }

    return safeCandidateAnswer;
  }

  if (hasUnsafeSourceNoun || input.answer.includes("```")) {
    return buildSafePrimingCandidates(input.latentPacket);
  }

  return input.answer.trim();
}

async function buildMemoryContext(
  memory: GoodMemory,
  scope: MemoryScope,
  query: string,
  options?: {
    immediateFeedbackSignal?: string;
    profile?: ImplicitMemBenchResearchProfile;
    scorerFamily?: ImplicitMemBenchScorerFamily;
  },
): Promise<{
  content: string;
  hostActionSelections: BehavioralPolicySelection[];
  rawCarryover: RawCarryoverResolution;
  textResponsePlan: ReturnType<typeof resolveTextResponseEnactmentPlan>;
  distilledContextDiagnostics?: NonNullable<
    ImplicitMemBenchCaseResult["distilledContextDiagnostics"]
  >;
}> {
  const recall = await memory.recall({
    query,
    retrievalProfile: "general_chat",
    scope,
  });
  const builtContext = await memory.buildContext({
    output: "developer_prompt_fragment",
    recall,
  });
  const exported = await memory.exportMemory({ scope });
  const surfaceFamily: RawBehavioralSurfaceFamily =
    options?.scorerFamily === "structured_first_action"
      ? "host_action"
      : "text_response";

  if (options?.profile === "goodmemory-raw-experience") {
    const rawIndex = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: { experiences: exported.durable.experiences },
        scope: exported.scope,
      },
      recallHints: {
        candidateTraces: recall.metadata.candidateTraces,
        hits: recall.metadata.hits,
      },
      retrievalProfile: surfaceFamily === "host_action"
        ? "coding_agent"
        : "general_chat",
      surfaceHint: surfaceFamily,
    });
    const rawCarryover = resolveRawBehavioralCarryover({
      index: rawIndex,
      maxExemplars: surfaceFamily === "host_action" ? 4 : 3,
      query,
      surfaceFamily,
    });
    const fallbackPacket = renderMemoryPacket(
      {
        ...recall.packet,
        feedbackSummary: undefined,
      },
      "developer_prompt_fragment",
    );

    return {
      content:
        rawCarryover.packet?.promptPayload &&
        rawCarryover.debug.mode === "exemplar_only"
          ? rawCarryover.packet.promptPayload
          : fallbackPacket.content,
      hostActionSelections: [],
      rawCarryover,
      textResponsePlan:
        rawCarryover.packet?.textResponsePlan ?? resolveTextResponseEnactmentPlan([]),
    };
  }

  const feedbackById = new Map<string, (typeof exported.durable.feedback)[number]>();
  for (const feedback of exported.durable?.feedback ?? []) {
    feedbackById.set(feedback.id, feedback);
  }
  for (const feedback of recall.feedback ?? []) {
    feedbackById.set(feedback.id, feedback);
  }
  const feedback = [...feedbackById.values()];
  const transientDistilledFeedback =
    options?.profile === "goodmemory-distilled-feedback"
      ? collectTransientDistilledFeedback({
          feedback,
          immediateFeedbackSignal: options.immediateFeedbackSignal,
          scope,
        })
      : [];
  const compiledTextSelections = selectBehavioralPolicies({
    appliesTo: "general_response",
    feedback,
    query,
    surface: "text_response",
  });
  const fallbackTextSelections =
    transientDistilledFeedback.length > 0
      ? selectBehavioralPolicies({
          appliesTo: "general_response",
          feedback: [],
          query,
          surface: "text_response",
          transientFeedback: transientDistilledFeedback,
        })
      : [];
  const textSelections = sortBehavioralPolicySelections([
    ...compiledTextSelections,
    ...fallbackTextSelections,
  ]);
  const textResponsePlan = resolveTextResponseEnactmentPlan(textSelections);
  const structuredControlLines = buildStructuredTextResponseControlLines(
    textResponsePlan,
  );
  const steeringLines = buildBehavioralSteeringLines(
    textSelections.filter(
      ({ policy }) =>
        policy.enactmentSurface !== "text_response" ||
        !policy.applicability.textResponsePlan,
    ),
  );
  const compiledHostActionSelections =
    options?.scorerFamily === "structured_first_action"
      ? selectBehavioralPolicies({
          appliesTo: "general_response",
          feedback,
          query,
          surface: "host_action",
        })
      : [];
  const fallbackHostActionSelections =
    options?.scorerFamily === "structured_first_action" &&
    transientDistilledFeedback.length > 0
      ? selectBehavioralPolicies({
          appliesTo: "general_response",
          feedback: [],
          query,
          surface: "host_action",
          transientFeedback: transientDistilledFeedback,
        })
      : [];
  const hostActionSelections = sortBehavioralPolicySelections([
    ...compiledHostActionSelections,
    ...fallbackHostActionSelections,
  ]);
  const actionSteeringLines =
    options?.scorerFamily === "structured_first_action"
      ? buildBehavioralActionSteeringLines(
          hostActionSelections,
          query,
        )
      : [];
  const fallbackPolicyCount =
    fallbackTextSelections.length + fallbackHostActionSelections.length;
  const compiledPolicyCount =
    compiledTextSelections.length + compiledHostActionSelections.length;
  const hasRenderedBehavioralLines =
    structuredControlLines.length > 0 ||
    steeringLines.length > 0 ||
    actionSteeringLines.length > 0;
  const genericFallbackSteeringLines =
    options?.profile === "goodmemory-distilled-feedback" &&
    !hasRenderedBehavioralLines &&
    transientDistilledFeedback.length > 0
      ? transientDistilledFeedback
          .slice(0, 1)
          .map((feedback) => `Apply this behavior implicitly: ${feedback.rule}`)
      : [];
  const effectiveFallbackPolicyCount =
    fallbackPolicyCount + genericFallbackSteeringLines.length;
  const content = [
    builtContext.content,
    hasRenderedBehavioralLines || genericFallbackSteeringLines.length > 0
      ? [
          structuredControlLines.length > 0
            ? [
                "Structured response control:",
                "Apply the following controls implicitly. Do not mention memory, earlier notes, or learned rules unless directly asked.",
                ...structuredControlLines,
              ].join("\n")
            : undefined,
          steeringLines.length > 0 || genericFallbackSteeringLines.length > 0
            ? [
                "Behavioral steering:",
                "Apply the following guidance implicitly. Do not mention memory, earlier notes, or learned rules unless directly asked.",
                ...steeringLines,
                ...genericFallbackSteeringLines,
              ].join("\n")
            : undefined,
          ...actionSteeringLines,
        ].join("\n")
      : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    content,
    ...(options?.profile === "goodmemory-distilled-feedback"
      ? {
          distilledContextDiagnostics: {
            compiledPolicyCount,
            contextEmpty: renderedContextIsEmpty(content),
            fallbackPolicyCount: effectiveFallbackPolicyCount,
            immediateFeedbackSignalApplied: Boolean(
              options.immediateFeedbackSignal,
            ),
          },
        }
      : {}),
    hostActionSelections,
    rawCarryover: {
      candidates: [],
      debug: {
        candidatePrototypeIds: [],
        mode: "none",
        selectedExemplarIds: [],
        selectedPrototypeIds: [],
      },
      selections: [],
    },
    textResponsePlan,
  };
}

const IMPLICITMEMBENCH_IMMEDIATE_FEEDBACK_TIMESTAMP =
  "2026-05-05T00:00:00.000Z";

function inferImmediateFeedbackKind(
  signal: string,
): Exclude<FeedbackMemory["kind"], "validated_pattern"> {
  return /\b(?:avoid|do not|don't|never|instead of|warn)\b/iu.test(signal)
    ? "dont"
    : "do";
}

function createImmediateDistilledFeedback(input: {
  scope: MemoryScope;
  signal: string;
}): FeedbackMemory {
  return createFeedbackMemory({
    id: `implicitmembench-immediate-feedback:${input.scope.userId}:${input.scope.workspaceId ?? "global"}`,
    userId: input.scope.userId,
    tenantId: input.scope.tenantId,
    workspaceId: input.scope.workspaceId,
    agentId: input.scope.agentId,
    sessionId: input.scope.sessionId,
    rule: input.signal,
    kind: inferImmediateFeedbackKind(input.signal),
    appliesTo: "general_response",
    source: createMemorySource({
      method: "explicit",
      extractedAt: IMPLICITMEMBENCH_IMMEDIATE_FEEDBACK_TIMESTAMP,
      sessionId: input.scope.sessionId,
    }),
    updatedAt: IMPLICITMEMBENCH_IMMEDIATE_FEEDBACK_TIMESTAMP,
  });
}

function collectTransientDistilledFeedback(input: {
  feedback: readonly FeedbackMemory[];
  immediateFeedbackSignal?: string;
  scope: MemoryScope;
}): FeedbackMemory[] {
  const fallbackByRule = new Map<string, FeedbackMemory>();
  if (input.immediateFeedbackSignal) {
    const immediate = createImmediateDistilledFeedback({
      scope: input.scope,
      signal: input.immediateFeedbackSignal,
    });
    fallbackByRule.set(immediate.rule.trim().toLowerCase(), immediate);
  }

  for (const feedback of input.feedback) {
    if (
      feedback.lifecycle !== "active" ||
      feedback.kind === "validated_pattern" ||
      readBehavioralPolicyFromFeedbackMemory(feedback)
    ) {
      continue;
    }

    fallbackByRule.set(feedback.rule.trim().toLowerCase(), feedback);
  }

  return [...fallbackByRule.values()];
}

function sortBehavioralPolicySelections(
  selections: readonly BehavioralPolicySelection[],
): BehavioralPolicySelection[] {
  return [...selections].sort((left, right) => right.score - left.score);
}

function renderedContextIsEmpty(content: string): boolean {
  return content.replace(/^Developer memory notes:\s*/iu, "").trim().length === 0;
}


export function detectExplicitRecallLeak(answer: string): boolean {
  return EXPLICIT_RECALL_LEAK_PATTERNS.some((pattern) => pattern.test(answer));
}

function firstNonEmptyLine(value: string): string {
  return (
    value
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? value.trim()
  );
}

function tokenizeCommandLine(value: string): string[] {
  return [...value.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/gu)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    .filter((token) => token.length > 0);
}

function startsWithWarning(value: string): boolean {
  return /^(warning|warn|caution|stop|abort)\b\s*[:：-]?/iu.test(value.trim());
}

function extractEmbeddedStructuredActionCandidate(
  value: string,
): string | undefined {
  const backtickMatch = value.match(/`([^`]+)`/u);
  if (backtickMatch?.[1]) {
    return backtickMatch[1].trim().replace(/[.。]$/u, "");
  }

  const source = value.trim();
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    if (!current || !/[A-Za-z_]/u.test(current)) {
      continue;
    }
    const previous = source[index - 1];
    if (previous && /[A-Za-z0-9_]/u.test(previous)) {
      continue;
    }

    let cursor = index + 1;
    while (cursor < source.length && /[A-Za-z0-9_]/u.test(source[cursor] ?? "")) {
      cursor += 1;
    }
    if (source[cursor] !== "(") {
      continue;
    }

    let depth = 0;
    let quote: "'" | "\"" | null = null;
    for (let end = cursor; end < source.length; end += 1) {
      const character = source[end]!;
      if (quote) {
        if (character === quote && source[end - 1] !== "\\") {
          quote = null;
        }
        continue;
      }
      if (character === "'" || character === "\"") {
        quote = character;
        continue;
      }
      if (character === "(") {
        depth += 1;
        continue;
      }
      if (character === ")") {
        depth -= 1;
        if (depth === 0) {
          return source.slice(index, end + 1).trim();
        }
      }
    }
  }

  return undefined;
}

function parseFirstActionFromAnswer(
  answer: string,
): BehavioralFirstAction | undefined {
  const firstLine = firstNonEmptyLine(answer);
  if (!firstLine) {
    return undefined;
  }

  if (startsWithWarning(firstLine)) {
    return {
      kind: "warning",
      name: "warning",
      raw: firstLine,
    };
  }

  const toolCallMatch = firstLine.match(/^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/u);
  if (toolCallMatch) {
    const [, name, argBody] = toolCallMatch;
    const args = splitTopLevelCallArguments(argBody);

    return {
      args,
      kind: "tool_call",
      name,
      raw: firstLine,
    };
  }

  const tokens = tokenizeCommandLine(firstLine);
  if (tokens.length === 0) {
    return undefined;
  }

  return {
    args: tokens.slice(1),
    kind: "command",
    name: tokens[0],
    raw: firstLine,
  };
}

function runStructuredScoring(input: {
  answer: string;
  caseDefinition: StructuredImplicitMemBenchCase;
  profile: ImplicitMemBenchResearchProfile;
}): ImplicitMemBenchCaseResult {
  const firstAction = parseFirstActionFromAnswer(input.answer);
  const passed =
    firstAction !== undefined &&
    behavioralFirstActionsEqual(
      firstAction,
      input.caseDefinition.fixture.expectedFirstAction,
    ) &&
    !behavioralFirstActionsEqual(
      firstAction,
      input.caseDefinition.fixture.forbiddenFirstAction,
    );

  return {
    answer: input.answer,
    blocking: true,
    caseId: input.caseDefinition.caseId,
    datasetFamily: input.caseDefinition.datasetFamily,
    explicitRecallLeak: detectExplicitRecallLeak(input.answer),
    feedbackSignalApplied: input.profile === "goodmemory-distilled-feedback",
    firstAction,
    firstActionRaw: firstAction?.raw,
    judgeReason: passed
      ? "expected_first_action_matched"
      : firstAction
        ? "expected_first_action_missing_or_forbidden"
        : "missing_first_action",
    passed,
    profile: input.profile,
    scorerFamily: input.caseDefinition.scorerFamily,
    sourceFile: input.caseDefinition.sourceFile,
    taskFile: input.caseDefinition.taskFile,
    taskName: input.caseDefinition.taskName,
  };
}

function supportsTextBehaviorCase(input: {
  caseDefinition: TextImplicitMemBenchCase;
  candidate: RawCarryoverResolution["candidates"][number];
}): boolean {
  const surface = [
    input.candidate.exemplar.episodeShape.relevantPriorMove,
    input.candidate.exemplar.episodeShape.safeCorrectedMove,
    input.candidate.exemplar.exactSurface?.value,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  switch (input.caseDefinition.taskFile) {
    case "conditioned_protocol_preference.json":
      return surface.includes("https://");
    case "conditioned_directory_restriction.json":
      return surface.includes("/home/") || surface.includes("/srv/");
    case "context_dependent_api_behavior.json":
      return /only if|only when|check/i.test(surface) && surface.includes("api");
    case "conditioned_jargon_avoidance.json":
      return /analogy|simple|plain/i.test(surface);
    case "the_modified_recurrence_sequence.json":
      return /rule|base|current probe|current value|recurrence/i.test(surface);
    case "the_omega_operation.json":
      return /operator|current operand|current probe|formula|omega/i.test(surface);
    default:
      return Boolean(
        input.caseDefinition.expectedPattern &&
          surface.includes(input.caseDefinition.expectedPattern.toLowerCase()),
      );
  }
}

function supportsStructuredCase(input: {
  candidate: RawCarryoverResolution["candidates"][number];
  caseDefinition: StructuredImplicitMemBenchCase;
}): boolean {
  const rawSurface =
    input.candidate.exemplar.exactSurface?.value ??
    input.candidate.exemplar.episodeShape.relevantPriorMove;
  const firstAction = parseFirstActionFromAnswer(rawSurface);

  return Boolean(
    firstAction &&
      behavioralFirstActionsEqual(
        firstAction,
        input.caseDefinition.fixture.expectedFirstAction,
      ),
  );
}

function candidateSupportsCase(input: {
  candidate: RawCarryoverResolution["candidates"][number];
  caseDefinition: Exclude<ImplicitMemBenchResearchCase, PrimingImplicitMemBenchCase>;
}): boolean {
  return input.caseDefinition.scorerFamily === "structured_first_action"
    ? supportsStructuredCase({
        candidate: input.candidate,
        caseDefinition: input.caseDefinition,
      })
    : supportsTextBehaviorCase({
        candidate: input.candidate,
        caseDefinition: input.caseDefinition,
      });
}

function buildRawCarryoverDiagnostics(input: {
  caseDefinition: Exclude<ImplicitMemBenchResearchCase, PrimingImplicitMemBenchCase>;
  passed: boolean | undefined;
  resolution: RawCarryoverResolution;
}): NonNullable<ImplicitMemBenchCaseResult["rawCarryover"]> {
  const goldSupportingCandidatePresent = input.resolution.candidates.some((candidate) =>
    candidateSupportsCase({
      candidate,
      caseDefinition: input.caseDefinition,
    }),
  );
  const selectedSupportsCase = input.resolution.selections.some((candidate) =>
    candidateSupportsCase({
      candidate,
      caseDefinition: input.caseDefinition,
    }),
  );

  let diagnosis: NonNullable<
    ImplicitMemBenchCaseResult["rawCarryover"]
  >["diagnosis"];
  if (input.passed) {
    diagnosis = "selected_and_passed";
  } else if (input.resolution.debug.mode !== "exemplar_only") {
    switch (input.resolution.debug.abstainReason) {
      case "support_conflict":
      case "ambiguous_top2":
        diagnosis = "support_conflict";
        break;
      case "executor_unsafe":
        diagnosis = "executor_unsafe";
        break;
      case "hypothesis_missing":
      case "below_threshold":
        diagnosis = "hypothesis_missing";
        break;
      case "no_candidates":
      default:
        diagnosis = "memory_miss";
        break;
    }
  } else if (goldSupportingCandidatePresent && selectedSupportsCase) {
    diagnosis = "reasoning_after_correct_hypothesis";
  } else if (goldSupportingCandidatePresent) {
    diagnosis = "wrong_exemplar";
  } else {
    diagnosis = "memory_miss";
  }

  return {
    abstainReason: input.resolution.debug.abstainReason,
    candidatePrototypeIds: [...input.resolution.debug.candidatePrototypeIds],
    conflictPrototypeIds: [...(input.resolution.debug.conflictPrototypeIds ?? [])],
    diagnosis,
    goldSupportingCandidatePresent,
    hypothesis: input.resolution.debug.hypothesis,
    mode: input.resolution.debug.mode,
    selectedExemplarIds: [...input.resolution.debug.selectedExemplarIds],
    selectedPrototypeIds: [...input.resolution.debug.selectedPrototypeIds],
    supportPrototypeIds: [...(input.resolution.debug.supportPrototypeIds ?? [])],
    topProbability: input.resolution.debug.topProbability,
    topScore: input.resolution.debug.topScore,
  };
}

function runSmokeTextJudge(input: {
  answer: string;
  caseDefinition: TextImplicitMemBenchCase;
}): ImplicitMemBenchTextJudgeResult {
  const assertions = input.caseDefinition.fixture.smokeAssertions;
  if (!assertions) {
    throw new Error(
      `Smoke mode requires smokeAssertions for ${input.caseDefinition.taskFile}`,
    );
  }

  const failures: string[] = [];
  const normalizedAnswer = input.answer.trim();
  const lowerAnswer = normalizedAnswer.toLowerCase();

  if (
    assertions.exactAnswer &&
    normalizedAnswer.toLowerCase() !== assertions.exactAnswer.toLowerCase()
  ) {
    failures.push("exact_answer_mismatch");
  }

  if (
    assertions.maxWords !== undefined &&
    normalizedAnswer.split(/\s+/u).filter(Boolean).length > assertions.maxWords
  ) {
    failures.push("too_many_words");
  }

  if (assertions.requiresFirstPerson) {
    const pronouns = lowerAnswer.match(/\b(i|me|my|mine)\b/gu) ?? [];
    if (pronouns.length === 0) {
      failures.push("missing_first_person");
    }
  }

  for (const phrase of assertions.requiredPhrases ?? []) {
    if (!lowerAnswer.includes(phrase.toLowerCase())) {
      failures.push(`missing_phrase:${phrase}`);
    }
  }

  for (const keyword of assertions.requiredKeywords ?? []) {
    if (!lowerAnswer.includes(keyword.toLowerCase())) {
      failures.push(`missing_keyword:${keyword}`);
    }
  }

  for (const phrase of assertions.forbiddenPhrases ?? []) {
    if (lowerAnswer.includes(phrase.toLowerCase())) {
      failures.push(`forbidden_phrase:${phrase}`);
    }
  }

  return {
    failure_tags: failures,
    passed: failures.length === 0,
    reasoning:
      failures.length === 0
        ? "smoke_assertions_passed"
        : `smoke_assertions_failed:${failures.join(",")}`,
  };
}

async function runLiveTextJudge(input: {
  answer: string;
  caseDefinition: TextImplicitMemBenchCase;
  dependencies?: ImplicitMemBenchResearchDependencies;
  profile: ImplicitMemBenchResearchProfile;
}): Promise<ImplicitMemBenchTextJudgeResult> {
  const judge = input.dependencies?.judgeTextBehavior;
  if (!judge) {
    throw new Error("Missing live text-behavior judge dependency.");
  }

  return judge({
    answer: input.answer,
    caseDefinition: input.caseDefinition,
    profile: input.profile,
  });
}

async function runTextScoring(input: {
  answer: string;
  caseDefinition: TextImplicitMemBenchCase;
  dependencies?: ImplicitMemBenchResearchDependencies;
  mode: ImplicitMemBenchResearchMode;
  profile: ImplicitMemBenchResearchProfile;
}): Promise<ImplicitMemBenchCaseResult> {
  const judged =
    input.mode === "smoke"
      ? runSmokeTextJudge({
          answer: input.answer,
          caseDefinition: input.caseDefinition,
        })
      : await runLiveTextJudge({
          answer: input.answer,
          caseDefinition: input.caseDefinition,
          dependencies: input.dependencies,
          profile: input.profile,
        });

  return {
    answer: input.answer,
    blocking: true,
    caseId: input.caseDefinition.caseId,
    datasetFamily: input.caseDefinition.datasetFamily,
    explicitRecallLeak: detectExplicitRecallLeak(input.answer),
    feedbackSignalApplied: input.profile === "goodmemory-distilled-feedback",
    judgeReason: judged.reasoning,
    passed: judged.passed,
    profile: input.profile,
    scorerFamily: input.caseDefinition.scorerFamily,
    sourceFile: input.caseDefinition.sourceFile,
    taskFile: input.caseDefinition.taskFile,
    taskName: input.caseDefinition.taskName,
  };
}

function keywordHitCount(answer: string, keywords: readonly string[]): number {
  const lowerAnswer = answer.toLowerCase();
  return keywords.filter((keyword) => lowerAnswer.includes(keyword.toLowerCase()))
    .length;
}

function runSmokePrimingJudge(input: {
  caseDefinition: PrimingImplicitMemBenchCase;
  controlAnswer: string;
  experimentalAnswer: string;
}): ImplicitMemBenchPrimingJudgeResult {
  const experimentalHits = keywordHitCount(
    input.experimentalAnswer,
    input.caseDefinition.fixture.themeKeywords,
  );
  const controlHits = keywordHitCount(
    input.controlAnswer,
    input.caseDefinition.fixture.themeKeywords,
  );
  const delta = Math.max(0, experimentalHits - controlHits);
  const maxScore = input.caseDefinition.fixture.themeKeywords.length * 25;
  const normalizedScore =
    maxScore === 0 ? 0 : Math.min(100, Math.round((delta / maxScore) * 100));

  return {
    priming_influence_score: normalizedScore,
    reasoning: `smoke_keyword_delta:${experimentalHits}-${controlHits}`,
  };
}

async function runLivePrimingJudge(input: {
  caseDefinition: PrimingImplicitMemBenchCase;
  controlAnswer: string;
  dependencies?: ImplicitMemBenchResearchDependencies;
  experimentalAnswer: string;
  profile: ImplicitMemBenchResearchProfile;
}): Promise<ImplicitMemBenchPrimingJudgeResult> {
  const judge = input.dependencies?.judgePrimingPair;
  if (!judge) {
    throw new Error("Missing live priming judge dependency.");
  }

  return withImplicitMemBenchTimeout({
    label: "priming_pair_judge",
    timeoutMs: resolveImplicitMemBenchPrimingTimeoutMs(),
    run: async () =>
      judge({
        caseDefinition: input.caseDefinition,
        controlAnswer: input.controlAnswer,
        experimentalAnswer: input.experimentalAnswer,
        profile: input.profile,
      }),
  });
}

async function runPrimingScoring(input: {
  caseDefinition: PrimingImplicitMemBenchCase;
  controlAnswer: string;
  dependencies?: ImplicitMemBenchResearchDependencies;
  experimentalAnswer: string;
  mode: ImplicitMemBenchResearchMode;
  profile: ImplicitMemBenchResearchProfile;
}): Promise<ImplicitMemBenchCaseResult> {
  const judged =
    input.mode === "smoke"
      ? runSmokePrimingJudge({
          caseDefinition: input.caseDefinition,
          controlAnswer: input.controlAnswer,
          experimentalAnswer: input.experimentalAnswer,
        })
      : await runLivePrimingJudge({
          caseDefinition: input.caseDefinition,
          controlAnswer: input.controlAnswer,
          dependencies: input.dependencies,
          experimentalAnswer: input.experimentalAnswer,
          profile: input.profile,
        });

  return {
    blocking: false,
    caseId: input.caseDefinition.caseId,
    datasetFamily: "priming",
    explicitRecallLeak:
      detectExplicitRecallLeak(input.controlAnswer) ||
      detectExplicitRecallLeak(input.experimentalAnswer),
    feedbackSignalApplied: false,
    judgeReason: judged.reasoning,
    passed: undefined,
    primingControlAnswer: input.controlAnswer,
    primingExperimentalAnswer: input.experimentalAnswer,
    primingInfluenceScore: judged.priming_influence_score,
    profile: input.profile,
    scorerFamily: "priming_pair_judge",
    sourceFile: input.caseDefinition.sourceFile,
    taskFile: input.caseDefinition.taskFile,
    taskName: input.caseDefinition.taskName,
  };
}

function summarizeProfile(
  cases: readonly ImplicitMemBenchCaseResult[],
): ImplicitMemBenchProfileSummary {
  const datasetCounts = emptyDatasetCounts();
  const scorerCounts = emptyScorerCounts();
  let explicitRecallLeakCount = 0;
  let passedBlockingCases = 0;
  let totalBlockingCases = 0;
  let primingScoreTotal = 0;
  let primingScoreCount = 0;
  let distilledContextEmptyCount = 0;
  let distilledContextNonEmptyCount = 0;
  let distilledContextNonEmptyPassed = 0;
  let distilledCompiledPolicyCount = 0;
  let distilledFallbackPolicyCount = 0;
  const distilledContextExamples: ImplicitMemBenchProfileSummary["distilledContextExamples"] =
    [];

  for (const caseResult of cases) {
    datasetCounts[caseResult.datasetFamily] += 1;
    scorerCounts[caseResult.scorerFamily] += 1;
    if (caseResult.explicitRecallLeak) {
      explicitRecallLeakCount += 1;
    }
    if (caseResult.blocking) {
      totalBlockingCases += 1;
      if (caseResult.passed) {
        passedBlockingCases += 1;
      }
    }
    if (typeof caseResult.primingInfluenceScore === "number") {
      primingScoreTotal += caseResult.primingInfluenceScore;
      primingScoreCount += 1;
    }

    if (caseResult.distilledContextDiagnostics) {
      const diagnostics = caseResult.distilledContextDiagnostics;
      if (diagnostics.contextEmpty) {
        distilledContextEmptyCount += 1;
        if (distilledContextExamples.length < 5) {
          distilledContextExamples.push({
            caseId: caseResult.caseId,
            ...(caseResult.judgeReason
              ? { judgeReason: caseResult.judgeReason }
              : {}),
            taskFile: caseResult.taskFile,
          });
        }
      } else {
        distilledContextNonEmptyCount += 1;
        if (caseResult.passed) {
          distilledContextNonEmptyPassed += 1;
        }
      }
      if (diagnostics.compiledPolicyCount > 0) {
        distilledCompiledPolicyCount += 1;
      }
      if (diagnostics.fallbackPolicyCount > 0) {
        distilledFallbackPolicyCount += 1;
      }
    }
  }
  const hasDistilledDiagnostics =
    distilledContextEmptyCount > 0 ||
    distilledContextNonEmptyCount > 0 ||
    distilledCompiledPolicyCount > 0 ||
    distilledFallbackPolicyCount > 0;

  return {
    caseCountsByDataset: datasetCounts,
    caseCountsByScorer: scorerCounts,
    cases: [...cases],
    ...(hasDistilledDiagnostics
      ? {
          distilledCompiledPolicyCount,
          distilledContextEmptyCount,
          distilledContextExamples,
          distilledContextPassRate:
            distilledContextNonEmptyCount === 0
              ? null
              : distilledContextNonEmptyPassed / distilledContextNonEmptyCount,
          distilledFallbackPolicyCount,
        }
      : {}),
    executionFailures: cases.filter((caseResult) => caseResult.executionFailure).length,
    explicitRecallLeakCount,
    passedBlockingCases,
    primingAverageScore:
      primingScoreCount === 0 ? null : primingScoreTotal / primingScoreCount,
    totalBlockingCases,
    totalCases: cases.length,
  };
}

function summarizeReportProfiles(
  profiles: Partial<
    Record<ImplicitMemBenchResearchProfile, ImplicitMemBenchProfileSummary>
  >,
): ImplicitMemBenchResearchReport["summary"] {
  const datasetCounts = emptyDatasetCounts();
  const scorerCounts = emptyScorerCounts();
  let executionFailures = 0;
  let explicitRecallLeakCount = 0;
  let passedBlockingCases = 0;
  let totalBlockingCases = 0;
  let primingScoreTotal = 0;
  let primingScoreCount = 0;
  let totalCases = 0;

  for (const summary of Object.values(profiles)) {
    if (!summary) {
      continue;
    }

    totalCases += summary.totalCases;
    executionFailures += summary.executionFailures;
    explicitRecallLeakCount += summary.explicitRecallLeakCount;
    passedBlockingCases += summary.passedBlockingCases;
    totalBlockingCases += summary.totalBlockingCases;
    for (const datasetFamily of [
      "classical_conditioning",
      "priming",
      "procedural_memory",
    ] as const) {
      datasetCounts[datasetFamily] += summary.caseCountsByDataset[datasetFamily];
    }
    for (const scorerFamily of ALL_SCORER_FAMILIES) {
      scorerCounts[scorerFamily] += summary.caseCountsByScorer[scorerFamily];
    }
    if (summary.primingAverageScore !== null) {
      primingScoreTotal += summary.primingAverageScore;
      primingScoreCount += 1;
    }
  }

  return {
    caseCountsByDataset: datasetCounts,
    caseCountsByScorer: scorerCounts,
    executionFailures,
    explicitRecallLeakCount,
    passedBlockingCases,
    primingAverageScore:
      primingScoreCount === 0 ? null : primingScoreTotal / primingScoreCount,
    totalBlockingCases,
    totalCases,
  };
}

function resolveRunId(prefix: string, explicit?: string): string {
  return explicit ?? `${prefix}-${Date.now()}`;
}

function createDefaultTextGenerationFailure(input: {
  caseDefinition: ImplicitMemBenchResearchCase;
  error: unknown;
  feedbackSignalApplied: boolean;
  profile: ImplicitMemBenchResearchProfile;
}): ImplicitMemBenchCaseResult {
  const message = formatUnknownErrorMessage(input.error);

  return {
    blocking: input.caseDefinition.scorerFamily !== "priming_pair_judge",
    caseId: input.caseDefinition.caseId,
    datasetFamily: input.caseDefinition.datasetFamily,
    executionFailure: message,
    explicitRecallLeak: false,
    feedbackSignalApplied: input.feedbackSignalApplied,
    judgeReason: "execution_failure",
    profile: input.profile,
    scorerFamily: input.caseDefinition.scorerFamily,
    sourceFile: input.caseDefinition.sourceFile,
    taskFile: input.caseDefinition.taskFile,
    taskName: input.caseDefinition.taskName,
  };
}

function formatUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function defaultLiveTextAnswerGenerator(
  model: AISDKModelConfig,
  input: ResearchTextGenerationInput,
): Promise<string> {
  const system =
    "You are evaluating task-local memory adaptation. Respond as the assistant to the probe while following any remembered local conventions exactly.";

  return withImplicitMemBenchTimeout({
    label: "text_answer_generation",
    run: ({ signal, timeoutMs }) =>
      withAISDKRetries(async () => {
        throwIfImplicitMemBenchAborted(signal);

        if (model.provider === "openai" && model.baseURL) {
          const content = stripThinkingBlocks(
            await requestOpenAICompatibleText({
              model,
              prompt: input.prompt,
              signal,
              system,
              timeoutMs,
            }),
          );
          if (!content) {
            throw new Error("Empty model response");
          }

          return content;
        }

        const { text } = await generateText({
          abortSignal: signal,
          model: resolveAISDKModel(model),
          prompt: input.prompt,
          system,
        });
        const content = stripThinkingBlocks(text);
        if (!content) {
          throw new Error("Empty model response");
        }

        return content;
      }, createImplicitMemBenchRetryOptions(signal)),
  });
}

async function defaultLiveTextJudge(
  model: AISDKModelConfig,
  input: ResearchTextJudgeInput,
): Promise<ImplicitMemBenchTextJudgeResult> {
  const rubric =
    input.caseDefinition.fixture.judgeRubric ??
    input.caseDefinition.expectedPattern ??
    "Apply the learned behavior in the final answer.";
  const prompt = [
    "You are judging a single GoodMemory benchmark answer.",
    "Return strict JSON with keys: passed (boolean), reasoning (string), failure_tags (string[]).",
    "passed should be true only if the answer follows the learned rule/behavior on the final probe.",
    "Do not require the answer to mention memory or prior turns.",
    `Task: ${input.caseDefinition.taskName}`,
    `Dataset family: ${input.caseDefinition.datasetFamily}`,
    `Profile: ${input.profile}`,
    `Probe: ${input.caseDefinition.instance.test_probe.content}`,
    `Expected behavior: ${rubric}`,
    `Answer to judge: ${input.answer}`,
  ].join("\n");

  return withImplicitMemBenchTimeout({
    label: "text_behavior_judge",
    run: async ({ signal, timeoutMs }) => {
      throwIfImplicitMemBenchAborted(signal);

      if (model.provider === "openai" && model.baseURL) {
        return withAISDKRetries(
          () =>
            requestOpenAICompatibleObject({
              model,
              prompt,
              schema: textJudgeSchema,
              signal,
              system:
                "You are a strict benchmark judge. Return only valid JSON matching the requested shape.",
              timeoutMs,
            }),
          createImplicitMemBenchRetryOptions(signal),
        );
      }

      const { object } = await withAISDKRetries(
        async () =>
          import("ai").then(({ generateObject }) =>
            generateObject({
              abortSignal: signal,
              model: resolveAISDKModel(model),
              prompt,
              schema: textJudgeSchema,
              system:
                "You are a strict benchmark judge. Return only valid JSON matching the requested shape.",
            }),
          ),
        createImplicitMemBenchRetryOptions(signal),
      );
      return object;
    },
  });
}

async function defaultLivePrimingJudge(
  model: AISDKModelConfig,
  input: ResearchPrimingJudgeInput,
): Promise<ImplicitMemBenchPrimingJudgeResult> {
  const prompt = [
    "You are judging priming influence between an experimental and control answer.",
    "Return strict JSON with keys: priming_influence_score (0-100 number), reasoning (string).",
    "Score only attributable thematic influence from the experimental priming context over the control answer.",
    "Use 0 unless the experimental answer shows stronger and attributable thematic influence than the control answer.",
    `Theme name: ${input.caseDefinition.instance.selected_source_theme}`,
    `Theme keywords: ${input.caseDefinition.fixture.themeKeywords.join(", ")}`,
    `Probe: ${input.caseDefinition.instance.experimental_instance.test_probe.prompt}`,
    `[EXPERIMENTAL ANSWER]\n${input.experimentalAnswer}`,
    `[CONTROL ANSWER]\n${input.controlAnswer}`,
  ].join("\n\n");

  return withImplicitMemBenchTimeout({
    label: "priming_pair_judge",
    timeoutMs: resolveImplicitMemBenchPrimingTimeoutMs(),
    run: async ({ signal, timeoutMs }) => {
      throwIfImplicitMemBenchAborted(signal);

      if (model.provider === "openai" && model.baseURL) {
        return withAISDKRetries(
          () =>
            requestOpenAICompatibleObject({
              model,
              prompt,
              schema: primingJudgeSchema,
              signal,
              system:
                "You are a strict benchmark judge. Return only valid JSON matching the requested shape.",
              timeoutMs,
            }),
          createImplicitMemBenchRetryOptions(signal),
        );
      }

      const { object } = await withAISDKRetries(
        async () =>
          import("ai").then(({ generateObject }) =>
            generateObject({
              abortSignal: signal,
              model: resolveAISDKModel(model),
              prompt,
              schema: primingJudgeSchema,
              system:
                "You are a strict benchmark judge. Return only valid JSON matching the requested shape.",
            }),
          ),
        createImplicitMemBenchRetryOptions(signal),
      );
      return object;
    },
  });
}

export function createImplicitMemBenchLiveDependencies(input: {
  answerModel: AISDKModelConfig;
  judgeModel: AISDKModelConfig;
  createMemory?: (input: {
    profile: ImplicitMemBenchResearchProfile;
    scope: MemoryScope;
  }) => GoodMemory;
}): ImplicitMemBenchResearchDependencies {
  return {
    createMemory: input.createMemory,
    generateTextAnswer: (payload) =>
      defaultLiveTextAnswerGenerator(input.answerModel, payload),
    judgePrimingPair: (payload) =>
      defaultLivePrimingJudge(input.judgeModel, payload),
    judgeTextBehavior: (payload) =>
      defaultLiveTextJudge(input.judgeModel, payload),
  };
}

function createSmokeAnswer(
  caseDefinition: ImplicitMemBenchResearchCase,
  profile: ImplicitMemBenchResearchProfile,
): string | { control: string; experimental: string } {
  switch (caseDefinition.taskFile) {
    case "conditioned_directory_restriction.json":
      return profile === "goodmemory-distilled-feedback"
        ? "Avoid /root and use /home/app/config.yml instead."
        : "Write to /root/app/config.yml.";
    case "conditioned_protocol_preference.json":
      return profile === "goodmemory-distilled-feedback"
        ? "https://downloads.example.com/client-installer"
        : "http://downloads.example.com/client-installer";
    case "corporate_etiquette_mandate.json":
      return profile === "goodmemory-distilled-feedback"
        ? "Subject: Remote Badge Checks\nDear Team,\nRemote badge checks begin on Monday.\nSincerely, TechNova Management."
        : "Remote badge checks begin on Monday.";
    case "logiql_query_language.json":
      return profile === "goodmemory-distilled-feedback"
        ? "FETCH users | FILTER age > 30"
        : "SELECT * FROM users WHERE age > 30";
    case "reversed_parameter_protocol.json":
      return profile === "goodmemory-distilled-feedback"
        ? "copy_file('/var/backup/reports/report.txt', '/data/reports/report.txt')"
        : "copy_file('/data/reports/report.txt', '/var/backup/reports/report.txt')";
    case "the_modified_recurrence_sequence.json":
      return profile === "goodmemory-distilled-feedback"
        ? "The rule is insufficiently specified from a single example, so I cannot infer P(5)."
        : "P(5) = 10";
    case "the_omega_operation.json":
      return profile === "goodmemory-distilled-feedback"
        ? "This example is insufficient to derive a general omega rule."
        : "31";
    case "the_scribe_s_signature.json":
      return profile === "goodmemory-distilled-feedback"
        ? "Subject: Review Status\nDear Editor,\nThe manuscript review is complete.\nSincerely,\nMara Chen"
        : "The manuscript review is complete.";
    case "character_voice_consistency.json":
      return profile === "baseline-upstream-chat"
        ? "Use sandbags and ropes to redirect the river away from the village."
        : "I would soothe the river like ivy binding a broken trellis, coaxing its fury into gentler channels.";
    case "conditioned_brevity.json":
      return profile === "baseline-upstream-chat"
        ? "18% of 450 is 81, because multiplying 450 by 0.18 gives that result."
        : "81";
    case "volcanic_eruption.json":
      return profile === "baseline-upstream-chat"
        ? {
            control:
              "Archive Loom\nRationale: It suggests tidy structure without carrying any strong thematic residue.",
            experimental:
              "Archive Loom\nRationale: It suggests tidy structure without carrying any strong thematic residue.",
          }
        : {
            control:
              "Vector Loom\nRationale: It suggests ordered structure without obvious thematic spillover.",
            experimental:
              "Basalt Veil\nRationale: It suggests pressure-forged concealment that releases force in one disciplined burst.",
          };
    default:
      throw new Error(`Smoke generator does not cover ${caseDefinition.taskFile}`);
  }
}

export function createImplicitMemBenchSmokeDependencies(): ImplicitMemBenchResearchDependencies {
  return {
    createMemory: createDefaultMemory,
    generateTextAnswer: async (input) => {
      const generated = createSmokeAnswer(input.caseDefinition, input.profile);
      if (typeof generated !== "string") {
        throw new Error(
          `Smoke answer for ${input.caseDefinition.taskFile} requires priming branch access.`,
        );
      }
      return generated;
    },
    judgePrimingPair: async (input) =>
      runSmokePrimingJudge({
        caseDefinition: input.caseDefinition,
        controlAnswer: input.controlAnswer,
        experimentalAnswer: input.experimentalAnswer,
      }),
    judgeTextBehavior: async (input) =>
      runSmokeTextJudge({
        answer: input.answer,
        caseDefinition: input.caseDefinition,
      }),
  };
}

async function evaluateBaselineCase(input: {
  caseDefinition: ImplicitMemBenchResearchCase;
  dependencies: ImplicitMemBenchResearchDependencies;
  mode: ImplicitMemBenchResearchMode;
}): Promise<ImplicitMemBenchCaseResult> {
  const generateTextAnswer = input.dependencies.generateTextAnswer;
  if (!generateTextAnswer) {
    throw new Error("Missing text answer generator dependency.");
  }

  try {
    if (input.caseDefinition.scorerFamily === "priming_pair_judge") {
      const primingGenerated =
        input.mode === "smoke"
          ? (createSmokeAnswer(
              input.caseDefinition,
              BASELINE_PROFILE,
            ) as { control: string; experimental: string })
          : null;
      const experimentalAnswer =
        primingGenerated?.experimental ??
        (await generateTextAnswer({
          caseDefinition: input.caseDefinition,
          profile: BASELINE_PROFILE,
          prompt: buildPrimingBranchPrompt({
            branch: input.caseDefinition.instance.experimental_instance,
          }),
        }));
      const controlAnswer =
        primingGenerated?.control ??
        (await generateTextAnswer({
          caseDefinition: input.caseDefinition,
          profile: BASELINE_PROFILE,
          prompt: buildPrimingBranchPrompt({
            branch: input.caseDefinition.instance.control_instance,
          }),
        }));

      return await runPrimingScoring({
        caseDefinition: input.caseDefinition,
        controlAnswer,
        dependencies: input.dependencies,
        experimentalAnswer,
        mode: input.mode,
        profile: BASELINE_PROFILE,
      });
    }

    const answer = await generateTextAnswer({
      caseDefinition: input.caseDefinition,
      profile: BASELINE_PROFILE,
      prompt: buildBaselinePrompt(input.caseDefinition),
    });

    if (input.caseDefinition.scorerFamily === "structured_first_action") {
      return runStructuredScoring({
        answer,
        caseDefinition: input.caseDefinition,
        profile: BASELINE_PROFILE,
      });
    }

    return await runTextScoring({
      answer,
      caseDefinition: input.caseDefinition,
      dependencies: input.dependencies,
      mode: input.mode,
      profile: BASELINE_PROFILE,
    });
  } catch (error) {
    return createDefaultTextGenerationFailure({
      caseDefinition: input.caseDefinition,
      error,
      feedbackSignalApplied: false,
      profile: BASELINE_PROFILE,
    });
  }
}

async function prepareGoodMemoryForCase(input: {
  caseDefinition: ImplicitMemBenchResearchCase;
  memory: GoodMemory;
  profile: ImplicitMemBenchResearchProfile;
  scope: MemoryScope;
}): Promise<void> {
  const { caseDefinition, memory, profile, scope } = input;

  if (caseDefinition.scorerFamily === "priming_pair_judge") {
    throw new Error("Priming GoodMemory prep should be handled per branch.");
  }

  await replayMessages(memory, scope, caseDefinition.instance.learning_phase);
  await replayMessages(memory, scope, caseDefinition.instance.interference_phase);

  if (profile === "goodmemory-distilled-feedback") {
    await memory.feedback({
      scope,
      signal: caseDefinition.feedbackSignal,
    });
    await memory.runMaintenance({ scope });
    return;
  }

  await memory.runMaintenance({
    jobs: ["consolidation"],
    scope,
  });
}

async function prepareGoodMemoryPrimingBranch(input: {
  branch: PrimingBranchInstance;
  memory: GoodMemory;
  scope: MemoryScope;
}): Promise<void> {
  await replayMessages(input.memory, input.scope, input.branch.priming_phase);
  await replayMessages(input.memory, input.scope, input.branch.interference_phase);
  await input.memory.runMaintenance({
    jobs: ["consolidation"],
    scope: input.scope,
  });
}

function formatCleanupScope(scope: MemoryScope): string {
  return [
    `userId=${scope.userId}`,
    scope.tenantId ? `tenantId=${scope.tenantId}` : undefined,
    scope.workspaceId ? `workspaceId=${scope.workspaceId}` : undefined,
    scope.agentId ? `agentId=${scope.agentId}` : undefined,
    scope.sessionId ? `sessionId=${scope.sessionId}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
}

async function collectGoodMemoryCleanupFailures(input: {
  cleanupScopes: readonly MemoryScope[];
  memory: GoodMemory;
}): Promise<AggregateError[]> {
  const failures: AggregateError[] = [];

  for (const cleanupScope of input.cleanupScopes) {
    try {
      await input.memory.deleteAllMemory({
        includeRuntime: true,
        scope: cleanupScope,
      });
    } catch (error) {
      failures.push(
        new AggregateError(
          [error],
          `GoodMemory case cleanup failed for ${formatCleanupScope(cleanupScope)}: ${formatUnknownErrorMessage(error)}`,
        ),
      );
    }
  }

  return failures;
}

function createExecutionFailureError(
  result: ImplicitMemBenchCaseResult | null | undefined,
): Error | undefined {
  if (!result?.executionFailure) {
    return undefined;
  }

  return new Error(
    `GoodMemory case executionFailure for ${result.caseId} (${result.profile}): ${result.executionFailure}`,
  );
}

async function runGoodMemoryCaseWithCleanup(input: {
  cleanupScopes: readonly MemoryScope[];
  execute: () => Promise<ImplicitMemBenchCaseResult | null>;
  memory: GoodMemory;
}): Promise<ImplicitMemBenchCaseResult | null> {
  let primaryError: unknown;
  let result: ImplicitMemBenchCaseResult | null | undefined;

  try {
    result = await input.execute();
  } catch (error) {
    primaryError = error;
  }

  const cleanupFailures = await collectGoodMemoryCleanupFailures({
    cleanupScopes: input.cleanupScopes,
    memory: input.memory,
  });

  if (cleanupFailures.length > 0) {
    const executionFailureError = createExecutionFailureError(result);
    const errors: unknown[] = [];
    if (primaryError !== undefined) {
      errors.push(primaryError);
    }
    if (executionFailureError) {
      errors.push(executionFailureError);
    }
    errors.push(...cleanupFailures);

    if (primaryError !== undefined) {
      throw new AggregateError(
        errors,
        "GoodMemory case execution failed and cleanup also failed.",
      );
    }

    if (executionFailureError) {
      throw new AggregateError(
        errors,
        "GoodMemory case returned executionFailure and cleanup also failed.",
      );
    }

    throw new AggregateError(errors, "GoodMemory case cleanup failed.");
  }

  if (primaryError !== undefined) {
    throw primaryError;
  }

  return result ?? null;
}

async function evaluateGoodMemoryCase(input: {
  caseDefinition: ImplicitMemBenchResearchCase;
  dependencies: ImplicitMemBenchResearchDependencies;
  mode: ImplicitMemBenchResearchMode;
  profile: "goodmemory-distilled-feedback" | "goodmemory-raw-experience";
  runId?: string;
}): Promise<ImplicitMemBenchCaseResult | null> {
  if (
    input.caseDefinition.scorerFamily === "priming_pair_judge" &&
    input.profile === "goodmemory-distilled-feedback"
  ) {
    return null;
  }

  const createMemory = input.dependencies.createMemory ?? createDefaultMemory;
  const generateTextAnswer = input.dependencies.generateTextAnswer;
  if (!generateTextAnswer) {
    throw new Error("Missing text answer generator dependency.");
  }

  const scope = buildResearchScope(
    input.caseDefinition,
    input.profile,
    input.runId,
  );
  const memory = createMemory({
    profile: input.profile,
    scope,
  });
  const cleanupScopes: MemoryScope[] = [{ ...scope }];
  const trackCleanupScope = (scopeToClean: MemoryScope): void => {
    cleanupScopes.push({ ...scopeToClean });
  };

  return runGoodMemoryCaseWithCleanup({
    cleanupScopes,
    execute: async () => {
      try {
        if (input.caseDefinition.scorerFamily === "priming_pair_judge") {
          const primingCase = input.caseDefinition;
          return await withImplicitMemBenchTimeout({
            label: `goodmemory_priming_case:${primingCase.caseId}:${input.profile}`,
            timeoutMs: resolveImplicitMemBenchPrimingTimeoutMs(),
            run: async () => {
              const experimentalScope = {
                ...scope,
                workspaceId: `${scope.workspaceId}-experimental`,
              };
              const controlScope = {
                ...scope,
                workspaceId: `${scope.workspaceId}-control`,
              };
              trackCleanupScope(experimentalScope);
              trackCleanupScope(controlScope);

              await prepareGoodMemoryPrimingBranch({
                branch: primingCase.instance.experimental_instance,
                memory,
                scope: experimentalScope,
              });
              await prepareGoodMemoryPrimingBranch({
                branch: primingCase.instance.control_instance,
                memory,
                scope: controlScope,
              });

              const experimentalLatentPacket = buildLatentPrimingInfluencePacket({
                branch: primingCase.instance.experimental_instance,
                caseDefinition: primingCase,
              });
              const controlLatentPacket = buildLatentPrimingInfluencePacket({
                branch: primingCase.instance.control_instance,
                caseDefinition: primingCase,
              });
              const primingGenerated =
                input.mode === "smoke"
                  ? (createSmokeAnswer(
                      primingCase,
                      input.profile,
                    ) as { control: string; experimental: string })
                  : null;
              const experimentalRawAnswer =
                primingGenerated?.experimental ??
                (await generateTextAnswer({
                  caseDefinition: input.caseDefinition,
                  memoryContext: experimentalLatentPacket.content,
                  profile: input.profile,
                  prompt: buildGoodMemoryPrimingPrompt({
                    branch: primingCase.instance.experimental_instance,
                    latentPacket: experimentalLatentPacket,
                    profile: input.profile,
                  }),
                }));
              const experimentalAnswer = enforcePrimingAnswerSafety({
                answer: experimentalRawAnswer,
                branch: primingCase.instance.experimental_instance,
                latentPacket: experimentalLatentPacket,
              });
              const controlRawAnswer =
                primingGenerated?.control ??
                (await generateTextAnswer({
                  caseDefinition: input.caseDefinition,
                  memoryContext: controlLatentPacket.content,
                  profile: input.profile,
                  prompt: buildGoodMemoryPrimingPrompt({
                    branch: primingCase.instance.control_instance,
                    latentPacket: controlLatentPacket,
                    profile: input.profile,
                  }),
                }));
              const controlAnswer = enforcePrimingAnswerSafety({
                answer: controlRawAnswer,
                branch: primingCase.instance.control_instance,
                latentPacket: controlLatentPacket,
              });
              const result = await runPrimingScoring({
                caseDefinition: primingCase,
                controlAnswer,
                dependencies: input.dependencies,
                experimentalAnswer,
                mode: input.mode,
                profile: input.profile,
              });

              return {
                ...result,
                memoryContext: [
                  `experimental:\n${experimentalLatentPacket.content}`,
                  `control:\n${controlLatentPacket.content}`,
                ].join("\n\n"),
                rawCarryover: undefined,
              };
            },
          });
        }

        await prepareGoodMemoryForCase({
          caseDefinition: input.caseDefinition,
          memory,
          profile: input.profile,
          scope,
        });
        const memoryContext = await buildMemoryContext(
          memory,
          scope,
          input.caseDefinition.instance.test_probe.content,
          {
            ...(input.profile === "goodmemory-distilled-feedback"
              ? { immediateFeedbackSignal: input.caseDefinition.feedbackSignal }
              : {}),
            profile: input.profile,
            scorerFamily: input.caseDefinition.scorerFamily,
          },
        );
        const answer = await generateTextAnswer({
          caseDefinition: input.caseDefinition,
          memoryContext: memoryContext.content,
          profile: input.profile,
          prompt: buildGoodMemoryPrompt({
            caseDefinition: input.caseDefinition,
            memoryContext: memoryContext.content,
            profile: input.profile,
          }),
        });
        const rawComputedAnswer =
          input.profile === "goodmemory-raw-experience"
            ? memoryContext.rawCarryover.packet?.computedResponse
            : undefined;
        const answerForScoring = rawComputedAnswer ?? answer;
        const enforcedAnswer =
          input.caseDefinition.scorerFamily === "text_behavior_judge"
            ? applyTextResponseEnactmentPlan({
                answer: answerForScoring,
                plan: memoryContext.textResponsePlan,
                query: input.caseDefinition.instance.test_probe.content,
              })
            : answerForScoring;

        const result =
          input.caseDefinition.scorerFamily === "structured_first_action"
            ? runStructuredScoring({
                answer: recoverStructuredFirstActionAnswer({
                  answer: answerForScoring,
                  policies: memoryContext.hostActionSelections,
                  query: input.caseDefinition.instance.test_probe.content,
                }),
                caseDefinition: input.caseDefinition,
                profile: input.profile,
              })
            : await runTextScoring({
                answer: enforcedAnswer,
                caseDefinition: input.caseDefinition,
                dependencies: input.dependencies,
                mode: input.mode,
                profile: input.profile,
              });
        const rawCarryover =
          input.profile === "goodmemory-raw-experience"
            ? buildRawCarryoverDiagnostics({
                caseDefinition: input.caseDefinition,
                passed: result.passed,
                resolution: memoryContext.rawCarryover,
              })
            : undefined;

        return {
          ...result,
          answer:
            input.caseDefinition.scorerFamily === "text_behavior_judge"
              ? enforcedAnswer
              : result.answer,
          ...(memoryContext.distilledContextDiagnostics
            ? {
                distilledContextDiagnostics:
                  memoryContext.distilledContextDiagnostics,
              }
            : {}),
          memoryContext: memoryContext.content,
          rawCarryover,
        };
      } catch (error) {
        return createDefaultTextGenerationFailure({
          caseDefinition: input.caseDefinition,
          error,
          feedbackSignalApplied: input.profile === "goodmemory-distilled-feedback",
          profile: input.profile,
        });
      }
    },
    memory,
  });
}

function resolveRunDirectory(outputDir: string, runId: string): string {
  return join(outputDir, runId);
}

function ensureMaxConcurrency(value: number | undefined): number {
  if (value === undefined) {
    return 1;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error("maxConcurrency must be a positive integer");
  }

  return value;
}

async function runWithConcurrency<T, TResult>(input: {
  items: readonly T[];
  limit?: number;
  onResult?: (result: TResult, index: number) => Promise<void> | void;
  worker: (item: T, index: number) => Promise<TResult>;
}): Promise<TResult[]> {
  const maxConcurrency = ensureMaxConcurrency(input.limit);
  if (input.items.length === 0) {
    return [];
  }

  const results = new Array<TResult>(input.items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < input.items.length) {
      const current = cursor;
      cursor += 1;
      const result = await input.worker(input.items[current]!, current);
      results[current] = result;
      await input.onResult?.(result, current);
    }
  };

  const workers = Array.from(
    { length: Math.min(maxConcurrency, input.items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

async function writeResearchReport(
  path: string,
  report: ImplicitMemBenchResearchReport,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
}

export async function runImplicitMemBenchBaselineEval(
  input: RunImplicitMemBenchBaselineOptions,
): Promise<ImplicitMemBenchResearchReport> {
  const cases =
    input.cases ??
    (await listImplicitMemBenchResearchCases({
      benchmarkRoot: input.benchmarkRoot,
      limit: input.limit,
      manifestPath: input.manifestPath,
    }));
  const runId = resolveRunId("run-phase49-baseline", input.runId);
  const runDirectory = resolveRunDirectory(input.outputDir, runId);
  const dependencies =
    input.dependencies ??
    (input.mode === "smoke"
      ? createImplicitMemBenchSmokeDependencies()
      : (() => {
        throw new Error("Live baseline eval requires explicit dependencies.");
      })());
  await mkdir(runDirectory, { recursive: true });
  const results = await runWithConcurrency<
    ImplicitMemBenchResearchCase,
    ImplicitMemBenchCaseResult
  >({
    items: cases,
    limit: input.maxConcurrency,
    worker: (caseDefinition) =>
      evaluateBaselineCase({
        caseDefinition,
        dependencies,
        mode: input.mode,
      }),
  });

  const profiles = {
    [BASELINE_PROFILE]: summarizeProfile(results),
  } satisfies ImplicitMemBenchResearchReport["profiles"];
  const report: ImplicitMemBenchResearchReport = {
    benchmarkRoot: resolve(input.benchmarkRoot),
    generatedAt: (input.dependencies?.now ?? (() => new Date().toISOString()))(),
    generatedBy: input.generatedBy,
    kind: "baseline",
    manifestPath: resolve(input.manifestPath),
    mode: input.mode,
    outputDir: resolve(input.outputDir),
    profiles,
    runDirectory,
    runId,
    source: RESEARCH_SOURCE,
    summary: summarizeReportProfiles(profiles),
  };

  await writeResearchReport(join(runDirectory, "report.json"), report);
  return report;
}

export async function runImplicitMemBenchGoodMemoryEval(
  input: RunImplicitMemBenchGoodMemoryOptions,
): Promise<ImplicitMemBenchResearchReport> {
  const cases =
    input.cases ??
    (await listImplicitMemBenchResearchCases({
      benchmarkRoot: input.benchmarkRoot,
      limit: input.limit,
      manifestPath: input.manifestPath,
    }));
  const runId = resolveRunId("run-phase49-goodmemory", input.runId);
  const runDirectory = resolveRunDirectory(input.outputDir, runId);
  const dependencies =
    input.dependencies ??
    (input.mode === "smoke"
      ? createImplicitMemBenchSmokeDependencies()
      : (() => {
        throw new Error("Live GoodMemory eval requires explicit dependencies.");
      })());
  await mkdir(runDirectory, { recursive: true });
  const profiles: Partial<
    Record<ImplicitMemBenchResearchProfile, ImplicitMemBenchProfileSummary>
  > = {};

  for (const profile of GOODMEMORY_PROFILES) {
    const rawResults: Array<ImplicitMemBenchCaseResult | undefined> = new Array(
      cases.length,
    );
    let completed = 0;
    const rawResultsUnfiltered = await runWithConcurrency<
      ImplicitMemBenchResearchCase,
      ImplicitMemBenchCaseResult | null
    >({
      items: cases,
      limit: input.maxConcurrency,
      onResult: async (result, index) => {
        rawResults[index] = result ?? undefined;
        completed += 1;
        if (completed % 10 !== 0 && completed !== cases.length) {
          return;
        }

        const partialResults = rawResults.filter(
          (entry): entry is ImplicitMemBenchCaseResult => Boolean(entry),
        );
        profiles[profile] = summarizeProfile(partialResults);
        const partialReport: ImplicitMemBenchResearchReport = {
          benchmarkRoot: resolve(input.benchmarkRoot),
          generatedAt:
            (input.dependencies?.now ?? (() => new Date().toISOString()))(),
          generatedBy: input.generatedBy,
          kind: "goodmemory",
          manifestPath: resolve(input.manifestPath),
          mode: input.mode,
          outputDir: resolve(input.outputDir),
          profiles,
          runDirectory,
          runId,
          source: RESEARCH_SOURCE,
          summary: summarizeReportProfiles(profiles),
        };
        await writeResearchReport(join(runDirectory, "report.json"), partialReport);
      },
      worker: (caseDefinition) =>
        evaluateGoodMemoryCase({
          caseDefinition,
          dependencies,
          mode: input.mode,
          profile,
          runId,
        }),
    });
    const results = rawResultsUnfiltered.filter(
      (result): result is ImplicitMemBenchCaseResult => Boolean(result),
    );
    profiles[profile] = summarizeProfile(results);

    const partialReport: ImplicitMemBenchResearchReport = {
      benchmarkRoot: resolve(input.benchmarkRoot),
      generatedAt:
        (input.dependencies?.now ?? (() => new Date().toISOString()))(),
      generatedBy: input.generatedBy,
      kind: "goodmemory",
      manifestPath: resolve(input.manifestPath),
      mode: input.mode,
      outputDir: resolve(input.outputDir),
      profiles,
      runDirectory,
      runId,
      source: RESEARCH_SOURCE,
      summary: summarizeReportProfiles(profiles),
    };
    await writeResearchReport(join(runDirectory, "report.json"), partialReport);
  }

  const report: ImplicitMemBenchResearchReport = {
    benchmarkRoot: resolve(input.benchmarkRoot),
    generatedAt: (input.dependencies?.now ?? (() => new Date().toISOString()))(),
    generatedBy: input.generatedBy,
    kind: "goodmemory",
    manifestPath: resolve(input.manifestPath),
    mode: input.mode,
    outputDir: resolve(input.outputDir),
    profiles,
    runDirectory,
    runId,
    source: RESEARCH_SOURCE,
    summary: summarizeReportProfiles(profiles),
  };

  await writeResearchReport(join(runDirectory, "report.json"), report);
  return report;
}

function blockingPassRate(
  summary: ImplicitMemBenchProfileSummary | undefined,
  scorerFamily: ImplicitMemBenchScorerFamily,
): number | null {
  if (!summary) {
    return null;
  }

  const scorerCases = summary.cases.filter(
    (caseResult) =>
      caseResult.scorerFamily === scorerFamily && caseResult.blocking,
  );
  if (scorerCases.length === 0) {
    return null;
  }

  const passed = scorerCases.filter((caseResult) => caseResult.passed).length;
  return passed / scorerCases.length;
}

function averagePrimingScore(
  summary: ImplicitMemBenchProfileSummary | undefined,
): number | null {
  if (!summary) {
    return null;
  }

  return summary.primingAverageScore;
}

function mapCaseResultsById(
  results: readonly ImplicitMemBenchCaseResult[],
): Map<string, ImplicitMemBenchCaseResult> {
  return new Map(results.map((result) => [result.caseId, result]));
}

export async function runImplicitMemBenchComparisonEval(
  input: RunImplicitMemBenchComparisonOptions,
): Promise<{
  baselineReport: ImplicitMemBenchResearchReport;
  comparisonReport: ImplicitMemBenchComparisonReport;
  goodmemoryReport: ImplicitMemBenchResearchReport;
}> {
  const comparisonRunId = resolveRunId("run-phase49-comparison", input.runId);
  const baselineOutputDir = join(resolve(input.outputDir), "baseline");
  const goodmemoryOutputDir = join(resolve(input.outputDir), "goodmemory");
  const comparisonOutputDir = join(resolve(input.outputDir), "comparison");

  const baselineReport = await runImplicitMemBenchBaselineEval({
    ...input,
    outputDir: baselineOutputDir,
    runId: comparisonRunId,
  });
  const goodmemoryReport = await runImplicitMemBenchGoodMemoryEval({
    ...input,
    outputDir: goodmemoryOutputDir,
    runId: comparisonRunId,
  });

  const baselineCases = mapCaseResultsById(
    baselineReport.profiles[BASELINE_PROFILE]?.cases ?? [],
  );
  const rawCases = mapCaseResultsById(
    goodmemoryReport.profiles["goodmemory-raw-experience"]?.cases ?? [],
  );
  const distilledCases = mapCaseResultsById(
    goodmemoryReport.profiles["goodmemory-distilled-feedback"]?.cases ?? [],
  );
  const allCaseIds = [
    ...new Set([
      ...baselineCases.keys(),
      ...rawCases.keys(),
      ...distilledCases.keys(),
    ]),
  ].sort();
  const comparisonCases = allCaseIds.map((caseId) => {
    const baseline = baselineCases.get(caseId);
    const raw = rawCases.get(caseId);
    const distilled = distilledCases.get(caseId);
    const exemplar = baseline ?? raw ?? distilled;
    if (!exemplar) {
      throw new Error(`Missing comparison exemplar for ${caseId}`);
    }

    return {
      baseline,
      caseId,
      datasetFamily: exemplar.datasetFamily,
      distilled,
      raw,
      scorerFamily: exemplar.scorerFamily,
      sourceFile: exemplar.sourceFile,
      taskFile: exemplar.taskFile,
      taskName: exemplar.taskName,
    };
  });

  const comparisonReport: ImplicitMemBenchComparisonReport = {
    baselineReportPath: join(
      baselineReport.runDirectory,
      "report.json",
    ),
    benchmarkRoot: resolve(input.benchmarkRoot),
    comparison: {
      byScorer: {
        priming_pair_judge: {
          baselineBlockingPassRate: null,
          caseCount: comparisonCases.filter(
            (caseResult) => caseResult.scorerFamily === "priming_pair_judge",
          ).length,
          goodmemoryDistilledBlockingPassRate: null,
          goodmemoryRawBlockingPassRate: null,
          primingDeltaOfDelta:
            averagePrimingScore(
              goodmemoryReport.profiles["goodmemory-raw-experience"],
            ) === null ||
            averagePrimingScore(baselineReport.profiles[BASELINE_PROFILE]) === null
              ? null
              : averagePrimingScore(
                    goodmemoryReport.profiles["goodmemory-raw-experience"],
                  )! - averagePrimingScore(baselineReport.profiles[BASELINE_PROFILE])!,
          primingScoreBaseline: averagePrimingScore(
            baselineReport.profiles[BASELINE_PROFILE],
          ),
          primingScoreRaw: averagePrimingScore(
            goodmemoryReport.profiles["goodmemory-raw-experience"],
          ),
        },
        structured_first_action: {
          baselineBlockingPassRate: blockingPassRate(
            baselineReport.profiles[BASELINE_PROFILE],
            "structured_first_action",
          ),
          caseCount: comparisonCases.filter(
            (caseResult) =>
              caseResult.scorerFamily === "structured_first_action",
          ).length,
          goodmemoryDistilledBlockingPassRate: blockingPassRate(
            goodmemoryReport.profiles["goodmemory-distilled-feedback"],
            "structured_first_action",
          ),
          goodmemoryRawBlockingPassRate: blockingPassRate(
            goodmemoryReport.profiles["goodmemory-raw-experience"],
            "structured_first_action",
          ),
          primingDeltaOfDelta: null,
          primingScoreBaseline: null,
          primingScoreRaw: null,
        },
        text_behavior_judge: {
          baselineBlockingPassRate: blockingPassRate(
            baselineReport.profiles[BASELINE_PROFILE],
            "text_behavior_judge",
          ),
          caseCount: comparisonCases.filter(
            (caseResult) => caseResult.scorerFamily === "text_behavior_judge",
          ).length,
          goodmemoryDistilledBlockingPassRate: blockingPassRate(
            goodmemoryReport.profiles["goodmemory-distilled-feedback"],
            "text_behavior_judge",
          ),
          goodmemoryRawBlockingPassRate: blockingPassRate(
            goodmemoryReport.profiles["goodmemory-raw-experience"],
            "text_behavior_judge",
          ),
          primingDeltaOfDelta: null,
          primingScoreBaseline: null,
          primingScoreRaw: null,
        },
      },
      cases: comparisonCases,
    },
    generatedAt: (input.dependencies?.now ?? (() => new Date().toISOString()))(),
    generatedBy: input.generatedBy,
    goodmemoryReportPath: join(
      goodmemoryReport.runDirectory,
      "report.json",
    ),
    kind: "comparison",
    manifestPath: resolve(input.manifestPath),
    mode: input.mode,
    outputDir: comparisonOutputDir,
    runDirectory: resolveRunDirectory(comparisonOutputDir, comparisonRunId),
    runId: comparisonRunId,
    source: RESEARCH_SOURCE,
    summary: {
      caseCount: comparisonCases.length,
      scorerFamilies: [...ALL_SCORER_FAMILIES],
    },
  };

  await mkdir(comparisonReport.runDirectory, { recursive: true });
  await writeFile(
    join(comparisonReport.runDirectory, "report.json"),
    `${JSON.stringify(comparisonReport, null, 2)}\n`,
  );

  return {
    baselineReport,
    comparisonReport,
    goodmemoryReport,
  };
}
