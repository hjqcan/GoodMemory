import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
} from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";

import {
  validateLongMemEvalCases,
} from "../../../src/eval/longmemeval";
import type { LongMemEvalCase } from "../../../src/eval/longmemeval";
import {
  assertPhase74FrozenDataset,
  createPhase74LongMemEvalDataset,
  PHASE74_FROZEN_DATASET_EXPECTATIONS,
  PHASE74_FROZEN_DATASET_SOURCES,
} from "../../../src/eval/phase74Datasets";
import type {
  Phase74DatasetCase,
} from "../../../src/eval/phase74Datasets";
import {
  createPhase74LiveReader,
  PHASE74_GATEWAY,
  PHASE74_JUDGE_MODEL,
  PHASE74_LANGUAGE_MODEL,
  resolvePhase74ReaderModel,
  resolvePhase74ScorerModels,
  phase74LivePromptSha256s,
} from "../../../src/eval/phase74Live";
import {
  appendPhase74ModelUsageEventSync,
  appendPhase74ModelUsageIntentSync,
  loadPhase74ModelUsageLedger,
  validatePhase74ModelUsageLedger,
} from "../../../src/eval/modelUsage";
import type {
  AttributedModelUsageAttempt,
  AttributedModelUsageIntent,
} from "../../../src/eval/modelUsage";
import {
  inferExactMcNemar,
  inferPairedMeanDelta,
} from "../../../src/eval/phase74PairedInference";
import type {
  ExactMcNemarInference,
  PairedMeanDeltaInference,
} from "../../../src/eval/phase74PairedInference";
import {
  buildPhase74ProtocolScoringIdentity,
  createPhase74ProtocolCompatibleAnswerAssessor,
} from "../../../src/eval/phase74ProtocolScoring";
import {
  PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION,
} from "../../../src/eval/phase74ProviderConfiguration";
import { estimateTextTokens } from "../../../src/tokenEstimator";
import {
  buildLongMemEvalOfficialJudgePrompt,
  isLongMemEvalOfficialAbstentionCase,
  LONGMEMEVAL_OFFICIAL_PROMPT_SHA256,
  parseLongMemEvalOfficialJudgeVerdict,
} from "../../../src/eval/longmemevalOfficialScorer";
import type {
  EvalRunJsonObject,
} from "../../../src/eval/runIdentity";
import {
  resolveCleanGitSourceIdentity,
  verifyGitSourceAnchor,
  verifyGitSourceStability,
  withGitSourceCheckout,
} from "../../proof/git";
import type { GitSourceIdentity } from "../../proof/git";
import type {
  LongMemEvalV1SourceWorkerCase,
  LongMemEvalV1SourceWorkerInput,
  LongMemEvalV1SourceWorkerOutput,
} from "./source-worker";

export const LONGMEMEVAL_V1_SOURCE_PAIRED_PROTOCOL_ID =
  "goodmemory-longmemeval-v1-ku-temporal-source-paired-diagnostic-v1";
export const LONGMEMEVAL_V1_SOURCE_PAIRED_BASELINE_ANCHOR: GitSourceIdentity = {
  commit: "55949f69f7586427c51ba70762ffd2e90667b6e8",
  tree: "da58b2373f1e7df0f6cee077bd5aa258f14ec7df",
};
export const LONGMEMEVAL_V1_SOURCE_PAIRED_BASELINE: GitSourceIdentity = {
  commit: "aaa6fa41192153ea4c39cb6730e37b6ab2de181f",
  tree: "9acf62ff594bacd4c4477fd2eeac87b3675208f8",
};
export const LONGMEMEVAL_V1_SOURCE_PAIRED_CANDIDATE: GitSourceIdentity = {
  commit: "baa4c8a302a547ac0eaef9930316f811b693ce87",
  tree: "c4c16f181c5c2ec1442bb57d6def1343f0517fb9",
};

const DATASET_RELATIVE_PATH = "input/longmemeval_s_cleaned.json";
const SOURCE_WORKER_RELATIVE_PATH =
  "scripts/research/longmemeval-v1/source-worker.ts";
const CASES_ARTIFACT = "paired-cases.jsonl";
const BASELINE_SOURCE_ARTIFACT = "source-baseline.json";
const CANDIDATE_SOURCE_ARTIFACT = "source-candidate.json";
const INTENTS_ARTIFACT = "model-usage-intents.jsonl";
const LOGICAL_MODEL_CALL_RECEIPTS_ARTIFACT =
  "logical-model-call-receipts.jsonl";
const USAGE_ARTIFACT = "model-usage.jsonl";
const REPORT_ARTIFACT = "report.json";
const MANIFEST_ARTIFACT = "run-manifest.json";
export const LONGMEMEVAL_V1_SOURCE_PAIRED_CANONICAL_ARTIFACTS = [
  MANIFEST_ARTIFACT,
  CASES_ARTIFACT,
  BASELINE_SOURCE_ARTIFACT,
  CANDIDATE_SOURCE_ARTIFACT,
  INTENTS_ARTIFACT,
  USAGE_ARTIFACT,
  LOGICAL_MODEL_CALL_RECEIPTS_ARTIFACT,
  REPORT_ARTIFACT,
] as const;
const EXPECTED_QUESTION_SEQUENCE_SHA256 =
  "d9f671e5f125dfc8660c072e3be2132c5c5de17a3a8306f1ac331441fd625eb9";
const TARGET_QUESTION_TYPES = [
  "knowledge-update",
  "temporal-reasoning",
] as const;
const BASELINE_DELTA_FILES = [
  "scripts/research/longmemeval-v1/source-worker.ts",
  "src/remember/builders.ts",
  "tests/unit/remember.claim-source.test.ts",
] as const;
const CANDIDATE_DELTA_FILES = [
  "src/api/revision.ts",
  "src/domain/records.ts",
  "src/maintenance/runner.ts",
  "src/recall/claimTemporal.ts",
  "src/recall/evidenceLedger.ts",
  "src/recall/generalizedFusion.ts",
  "src/recall/projections/claims.ts",
  "tests/integration/maintenance.runner.test.ts",
  "tests/integration/recall.projection-api.test.ts",
  "tests/integration/revise-memory.api.test.ts",
  "tests/unit/recall.claim-projection.test.ts",
  "tests/unit/recall.evidence-ledger.test.ts",
  "tests/unit/recall.generalized-fusion.test.ts",
  "tests/unit/remember.claim-source.test.ts",
] as const;
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const execFileAsync = promisify(execFile);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type LongMemEvalV1SourceArm = "baseline" | "candidate";

export interface LongMemEvalV1SourcePairedArmResult {
  answer: string;
  contextSha256: string;
  contextTokens: number;
  correct: boolean;
  retrievedSessionIds: string[];
  score: number;
}

export interface LongMemEvalV1SourcePairedCaseResult {
  armOrder: LongMemEvalV1SourceArm[];
  baseline: LongMemEvalV1SourcePairedArmResult;
  candidate: LongMemEvalV1SourcePairedArmResult;
  caseKey: string;
  delta: -1 | 0 | 1;
  questionType: "knowledge-update" | "temporal-reasoning";
}

export interface LongMemEvalV1SourcePairedBucketSummary {
  baselineAccuracy: number;
  baselineCorrect: number;
  candidateAccuracy: number;
  candidateCorrect: number;
  losses: number;
  netWins: number;
  ties: number;
  totalCases: number;
  wins: number;
}

export interface LongMemEvalV1SourcePairedSummary
  extends LongMemEvalV1SourcePairedBucketSummary {
  byQuestionType: Record<
    "knowledge-update" | "temporal-reasoning",
    LongMemEvalV1SourcePairedBucketSummary
  >;
}

export interface LongMemEvalV1SourcePairedMetrics {
  mcnemar: ExactMcNemarInference;
  pairedBootstrap: PairedMeanDeltaInference;
  summary: LongMemEvalV1SourcePairedSummary;
}

export function assertLongMemEvalV1SourceReplayClosure(input: {
  artifacts: Record<LongMemEvalV1SourceArm, LongMemEvalV1SourceWorkerOutput>;
  currentOrchestrator: GitSourceIdentity;
  replays: Record<LongMemEvalV1SourceArm, LongMemEvalV1SourceWorkerOutput>;
  reportedOrchestrator: GitSourceIdentity;
}): void {
  if (!isDeepStrictEqual(
    input.currentOrchestrator,
    input.reportedOrchestrator,
  )) {
    throw new Error(
      "LongMemEval V1 source-paired verifier source identity drifted.",
    );
  }
  if (
    !isDeepStrictEqual(input.artifacts.baseline, input.replays.baseline) ||
    !isDeepStrictEqual(input.artifacts.candidate, input.replays.candidate)
  ) {
    throw new Error("LongMemEval V1 source-paired source replay drifted.");
  }
}

interface SourcePairedModelIdentity {
  baseURL?: string;
  model: string;
  provider: string;
}

interface SourcePairedArtifactRef {
  bytes: number;
  path: string;
  sha256: string;
}

interface SourcePairedGitDeltaIdentity {
  files: string[];
  patchSha256: string;
}

interface SourcePairedDatasetIdentity {
  normalizedFingerprint: string;
  questionSequenceSha256: string;
  rawSha256: string;
  selectedCaseCount: 211;
  typeCounts: {
    "knowledge-update": 78;
    "temporal-reasoning": 133;
  };
}

export interface SourcePairedRuntimeIdentity {
  arch: string;
  bunVersion: string;
  platform: string;
}

export interface SourcePairedConfiguration {
  assistedExtractorAdapter: "configured-no-provider-empty";
  contextBuildConcurrencyPerArm: 2;
  contextMaxTokens: 4_000;
  deterministicClockAndIds:
    "case-namespaced-sequential-ids-and-utc-tick-clock";
  embeddingAdapter: "none";
  extractionStrategy: "rules-only";
  fusionMinRelativeStrength: 0.35;
  ingestMode: "label-free-raw";
  modelCallConcurrency: 2;
  profile: "goodmemory-recommended";
  projectionBulkBackfill: true;
  projectionWriteThrough: false;
  readerContext: "question-date-and-memory-context-envelope";
  runtime: SourcePairedRuntimeIdentity;
  sourceArmConcurrency: 2;
  storageProvider: "memory";
}

export interface LongMemEvalV1SourcePairedReport {
  claimBoundary: {
    publicClaimEligible: false;
    promotionEligible: false;
    seenCasesOnly: true;
  };
  configuration: SourcePairedConfiguration;
  dataset: SourcePairedDatasetIdentity;
  execution: {
    answerInvocations: number;
    executionFailures: 0;
    judgeInvocations: number;
    logicalModelCallReceipts: number;
    modelUsageEvents: number;
    modelUsageIntents: number;
    pendingModelUsageIntents: 0;
    sourceWorkerRuns: 2;
  };
  generatedAt: string;
  generatedBy: "scripts/research/longmemeval-v1/source-paired.ts";
  inference: {
    mcnemar: ExactMcNemarInference;
    pairedBootstrap: PairedMeanDeltaInference;
  };
  models: {
    judge: SourcePairedModelIdentity;
    reader: SourcePairedModelIdentity;
  };
  protocolId: typeof LONGMEMEVAL_V1_SOURCE_PAIRED_PROTOCOL_ID;
  protocolIdentity: {
    modelCallConfiguration: EvalRunJsonObject;
    promptSha256s: {
      judge: string;
      reader: string;
    };
    scoring: EvalRunJsonObject;
  };
  runId: string;
  source: {
    baselineAnchor: GitSourceIdentity;
    baseline: GitSourceIdentity;
    baselineDeltaFromAnchor: SourcePairedGitDeltaIdentity;
    baselineRole: "v0.7.5-derived-common-mode-execution-baseline";
    candidate: GitSourceIdentity;
    candidateDeltaFromBaseline: SourcePairedGitDeltaIdentity;
    orchestrator: GitSourceIdentity;
    orchestratorDeltaFromCandidate: SourcePairedGitDeltaIdentity;
    workerPayloadSha256: string;
    workerSha256: string;
  };
  summary: LongMemEvalV1SourcePairedSummary;
}

interface LongMemEvalV1SourcePairedManifest {
  artifacts: SourcePairedArtifactRef[];
  claimBoundary: LongMemEvalV1SourcePairedReport["claimBoundary"];
  configuration: SourcePairedConfiguration;
  dataset: SourcePairedDatasetIdentity;
  generatedAt: string;
  models: LongMemEvalV1SourcePairedReport["models"];
  protocolIdentity: LongMemEvalV1SourcePairedReport["protocolIdentity"];
  protocolId: typeof LONGMEMEVAL_V1_SOURCE_PAIRED_PROTOCOL_ID;
  runId: string;
  schemaVersion: 1;
  source: LongMemEvalV1SourcePairedReport["source"];
}

interface PreparedLongMemEvalV1Dataset {
  adaptedByQuestionId: Map<string, Phase74DatasetCase>;
  identity: SourcePairedDatasetIdentity;
  selected: LongMemEvalCase[];
}

function summarizeBucket(
  cases: readonly LongMemEvalV1SourcePairedCaseResult[],
): LongMemEvalV1SourcePairedBucketSummary {
  if (cases.length === 0) {
    throw new Error("LongMemEval V1 source-paired summary requires cases.");
  }
  const baselineCorrect = cases.filter(({ baseline }) => baseline.correct).length;
  const candidateCorrect = cases.filter(({ candidate }) => candidate.correct).length;
  const wins = cases.filter(({ delta }) => delta === 1).length;
  const losses = cases.filter(({ delta }) => delta === -1).length;
  return {
    baselineAccuracy: baselineCorrect / cases.length,
    baselineCorrect,
    candidateAccuracy: candidateCorrect / cases.length,
    candidateCorrect,
    losses,
    netWins: wins - losses,
    ties: cases.length - wins - losses,
    totalCases: cases.length,
    wins,
  };
}

export function deriveLongMemEvalV1SourcePairedMetrics(
  cases: readonly LongMemEvalV1SourcePairedCaseResult[],
  options: { bootstrapSamples?: number; seed?: number } = {},
): LongMemEvalV1SourcePairedMetrics {
  assertSharedContextReuse(cases);
  const knowledgeUpdate = cases.filter(
    ({ questionType }) => questionType === "knowledge-update",
  );
  const temporalReasoning = cases.filter(
    ({ questionType }) => questionType === "temporal-reasoning",
  );
  const baseline = cases.map(({ baseline: arm, caseKey }) => ({
    caseId: caseKey,
    passed: arm.correct,
    value: Number(arm.correct),
  }));
  const candidate = cases.map(({ candidate: arm, caseKey }) => ({
    caseId: caseKey,
    passed: arm.correct,
    value: Number(arm.correct),
  }));
  return {
    mcnemar: inferExactMcNemar({ baseline, candidate }),
    pairedBootstrap: inferPairedMeanDelta({
      baseline,
      ...(options.bootstrapSamples === undefined
        ? {}
        : { bootstrapSamples: options.bootstrapSamples }),
      candidate,
      ...(options.seed === undefined ? {} : { seed: options.seed }),
    }),
    summary: {
      ...summarizeBucket(cases),
      byQuestionType: {
        "knowledge-update": summarizeBucket(knowledgeUpdate),
        "temporal-reasoning": summarizeBucket(temporalReasoning),
      },
    },
  };
}

function assertSharedContextReuse(
  cases: readonly LongMemEvalV1SourcePairedCaseResult[],
): void {
  for (const testCase of cases) {
    if (
      testCase.baseline.contextSha256 === testCase.candidate.contextSha256 &&
      (
        testCase.baseline.answer !== testCase.candidate.answer ||
        testCase.baseline.contextTokens !== testCase.candidate.contextTokens ||
        testCase.baseline.correct !== testCase.candidate.correct ||
        testCase.baseline.score !== testCase.candidate.score
      )
    ) {
      throw new Error(
        `LongMemEval V1 shared context result drifted for ${testCase.caseKey}.`,
      );
    }
  }
}

function workerCase(input: {
  datasetSha256: string;
  testCase: LongMemEvalCase;
}): LongMemEvalV1SourceWorkerCase {
  return {
    caseKey: `case-${sha256(
      `${input.datasetSha256}\0${input.testCase.questionId}`,
    ).slice(0, 24)}`,
    question: input.testCase.question,
    questionDate: input.testCase.questionDate,
    sessions: input.testCase.haystackSessions.map((turns, index) => ({
      date: input.testCase.haystackDates[index] ?? "unknown-date",
      sessionId: `session-${index + 1}`,
      turns: turns.map(({ content, role }) => ({ content, role })),
    })),
  };
}

export function buildLongMemEvalV1SourceWorkerPayload(input: {
  cases: readonly LongMemEvalCase[];
  datasetSha256: string;
}): string {
  if (!/^[a-f0-9]{64}$/u.test(input.datasetSha256)) {
    throw new Error("LongMemEval V1 source worker requires a dataset SHA-256.");
  }
  const payload: LongMemEvalV1SourceWorkerInput = {
    cases: input.cases.map((testCase) => workerCase({
      datasetSha256: input.datasetSha256,
      testCase,
    })),
    schemaVersion: 1,
  };
  return JSON.stringify(payload);
}

function prepareDataset(raw: string): PreparedLongMemEvalV1Dataset {
  if (sha256(raw) !== PHASE74_FROZEN_DATASET_SOURCES.longmemeval.sourceSha256) {
    throw new Error("LongMemEval V1 source-paired dataset SHA-256 mismatch.");
  }
  const parsed = JSON.parse(raw) as unknown;
  const cases = validateLongMemEvalCases(parsed);
  const bundle = createPhase74LongMemEvalDataset({ raw });
  assertPhase74FrozenDataset(bundle);
  const selected = cases.filter((testCase) =>
    TARGET_QUESTION_TYPES.includes(testCase.questionType as never)
  );
  const typeCounts = {
    "knowledge-update": selected.filter(
      ({ questionType }) => questionType === "knowledge-update",
    ).length,
    "temporal-reasoning": selected.filter(
      ({ questionType }) => questionType === "temporal-reasoning",
    ).length,
  };
  const questionSequenceSha256 = sha256(
    `${selected.map(({ questionId }) => questionId).join("\n")}\n`,
  );
  if (
    bundle.manifest.caseCount !==
      PHASE74_FROZEN_DATASET_EXPECTATIONS.longmemeval.caseCount ||
    selected.length !== 211 ||
    typeCounts["knowledge-update"] !== 78 ||
    typeCounts["temporal-reasoning"] !== 133 ||
    questionSequenceSha256 !== EXPECTED_QUESTION_SEQUENCE_SHA256
  ) {
    throw new Error("LongMemEval V1 source-paired selection drifted.");
  }
  return {
    adaptedByQuestionId: new Map(
      bundle.cases.map((testCase) => [testCase.caseId, testCase]),
    ),
    identity: {
      normalizedFingerprint: bundle.manifest.normalizedFingerprint,
      questionSequenceSha256,
      rawSha256: bundle.manifest.datasetSha256,
      selectedCaseCount: 211,
      typeCounts: {
        "knowledge-update": 78,
        "temporal-reasoning": 133,
      },
    },
    selected,
  };
}

function modelIdentity(input: {
  baseURL?: string;
  model: string;
  provider: string;
}): SourcePairedModelIdentity {
  return {
    ...(input.baseURL === undefined ? {} : { baseURL: input.baseURL }),
    model: input.model,
    provider: input.provider,
  };
}

export function buildLongMemEvalV1SourcePairedConfiguration(
  runtime: SourcePairedRuntimeIdentity = {
    arch: process.arch,
    bunVersion: Bun.version,
    platform: process.platform,
  },
): SourcePairedConfiguration {
  return {
    assistedExtractorAdapter: "configured-no-provider-empty",
    contextBuildConcurrencyPerArm: 2,
    contextMaxTokens: 4_000,
    deterministicClockAndIds:
      "case-namespaced-sequential-ids-and-utc-tick-clock",
    embeddingAdapter: "none",
    extractionStrategy: "rules-only",
    fusionMinRelativeStrength: 0.35,
    ingestMode: "label-free-raw",
    modelCallConcurrency: 2,
    profile: "goodmemory-recommended",
    projectionBulkBackfill: true,
    projectionWriteThrough: false,
    readerContext: "question-date-and-memory-context-envelope",
    runtime: { ...runtime },
    sourceArmConcurrency: 2,
    storageProvider: "memory",
  };
}

function assertSourcePairedConfiguration(
  value: unknown,
): asserts value is SourcePairedConfiguration {
  if (!isRecord(value) || !isRecord(value.runtime)) {
    throw new Error("LongMemEval V1 source-paired configuration drifted.");
  }
  const runtime = value.runtime;
  if (
    Object.keys(runtime).sort().join("\0") !==
      ["arch", "bunVersion", "platform"].join("\0") ||
    typeof runtime.arch !== "string" ||
    runtime.arch === "" ||
    typeof runtime.bunVersion !== "string" ||
    runtime.bunVersion === "" ||
    typeof runtime.platform !== "string" ||
    runtime.platform === "" ||
    !isDeepStrictEqual(
      value,
      buildLongMemEvalV1SourcePairedConfiguration({
        arch: runtime.arch,
        bunVersion: runtime.bunVersion,
        platform: runtime.platform,
      }),
    )
  ) {
    throw new Error("LongMemEval V1 source-paired configuration drifted.");
  }
}

function sourcePairedProtocolIdentity(
  judge: SourcePairedModelIdentity,
): LongMemEvalV1SourcePairedReport["protocolIdentity"] {
  if (judge.baseURL === undefined) {
    throw new Error("LongMemEval V1 source-paired judge gateway is missing.");
  }
  return {
    modelCallConfiguration: {
      judge: {
        ...PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.judge.protocol,
      },
      reader: { ...PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.reader },
    },
    promptSha256s: {
      judge: LONGMEMEVAL_OFFICIAL_PROMPT_SHA256,
      reader: phase74LivePromptSha256s().genericReader,
    },
    scoring: buildPhase74ProtocolScoringIdentity("longmemeval", {
      gateway: judge.baseURL,
      model: judge.model,
      provider: judge.provider,
    }),
  };
}

function pairedOrder(caseKey: string): LongMemEvalV1SourceArm[] {
  return Number.parseInt(sha256(caseKey).slice(0, 2), 16) % 2 === 0
    ? ["baseline", "candidate"]
    : ["candidate", "baseline"];
}

interface ExpectedSourcePairedUsageCall {
  branch: AttributedModelUsageIntent["branch"];
  caseId: string;
  maxAttempts: number;
  modelId: string;
  operation: AttributedModelUsageIntent["operation"];
}

interface SourcePairedLogicalModelCallReceipt {
  branch: AttributedModelUsageIntent["branch"];
  caseId: string;
  normalizedResponse: string;
  operation: AttributedModelUsageIntent["operation"];
  requestSha256: string;
  responseSha256: string;
  usageRequestIds: string[];
}

function expectedSourcePairedUsageCalls(
  cases: readonly LongMemEvalV1SourcePairedCaseResult[],
): ExpectedSourcePairedUsageCall[] {
  const calls: ExpectedSourcePairedUsageCall[] = [];
  for (const testCase of cases) {
    const shared =
      testCase.baseline.contextSha256 === testCase.candidate.contextSha256;
    const arms = shared ? ["shared"] as const : ["baseline", "candidate"] as const;
    for (const arm of arms) {
      const caseId = `${testCase.caseKey}:${arm}`;
      calls.push({
        branch: arm === "shared" ? "protocol_reader" : arm,
        caseId,
        maxAttempts: PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.reader.retryLimit,
        modelId: PHASE74_LANGUAGE_MODEL,
        operation: "answer_generation",
      }, {
        branch: "judge",
        caseId,
        maxAttempts:
          PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.judge.protocol.retryLimit,
        modelId: PHASE74_JUDGE_MODEL,
        operation: "judge",
      });
    }
  }
  return calls;
}

function usageCallKey(input: {
  caseId: string;
  operation: AttributedModelUsageIntent["operation"];
}): string {
  return `${input.caseId}\0${input.operation}`;
}

function groupUsageCalls<T extends {
  caseId: string;
  operation: AttributedModelUsageIntent["operation"];
}>(values: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const key = usageCallKey(value);
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, [value]);
    } else {
      existing.push(value);
    }
  }
  return grouped;
}

export function validateLongMemEvalV1SourcePairedUsageClosure(input: {
  cases: readonly LongMemEvalV1SourcePairedCaseResult[];
  events: readonly AttributedModelUsageAttempt[];
  intents: readonly AttributedModelUsageIntent[];
}): { answerInvocations: number; judgeInvocations: number } {
  assertSharedContextReuse(input.cases);
  const ledger = validatePhase74ModelUsageLedger({
    events: input.events,
    intents: input.intents,
  });
  const expected = expectedSourcePairedUsageCalls(input.cases);
  const expectedByKey = new Map(
    expected.map((call) => [usageCallKey(call), call]),
  );
  const intentsByKey = groupUsageCalls(ledger.intents);
  const eventsByKey = groupUsageCalls(ledger.events);
  if (
    ledger.pendingIntents.length !== 0 ||
    intentsByKey.size !== expectedByKey.size ||
    eventsByKey.size !== expectedByKey.size
  ) {
    throw new Error("LongMemEval V1 source-paired usage closure drifted.");
  }
  for (const [key, expectedCall] of expectedByKey) {
    const intents = [...(intentsByKey.get(key) ?? [])].sort(
      (left, right) => left.attempt - right.attempt,
    );
    const events = [...(eventsByKey.get(key) ?? [])].sort(
      (left, right) => left.attempt - right.attempt,
    );
    if (
      intents.length === 0 ||
      intents.length > expectedCall.maxAttempts ||
      events.length !== intents.length
    ) {
      throw new Error("LongMemEval V1 source-paired usage closure drifted.");
    }
    for (const [index, intent] of intents.entries()) {
      const event = events[index];
      if (
        event === undefined ||
        intent.attempt !== index + 1 ||
        event.attempt !== intent.attempt ||
        intent.branch !== expectedCall.branch ||
        intent.caseId !== expectedCall.caseId ||
        intent.modelId !== expectedCall.modelId ||
        intent.operation !== expectedCall.operation ||
        intent.providerId !== "openai" ||
        event.outcome !== (index === intents.length - 1 ? "succeeded" : "failed")
      ) {
        throw new Error("LongMemEval V1 source-paired usage closure drifted.");
      }
    }
  }
  return {
    answerInvocations: expected.filter(
      ({ operation }) => operation === "answer_generation",
    ).length,
    judgeInvocations: expected.filter(
      ({ operation }) => operation === "judge",
    ).length,
  };
}

function usageRequestIds(input: {
  caseId: string;
  intents: readonly AttributedModelUsageIntent[];
  operation: AttributedModelUsageIntent["operation"];
}): string[] {
  return input.intents
    .filter((intent) =>
      intent.caseId === input.caseId && intent.operation === input.operation
    )
    .sort((left, right) => left.attempt - right.attempt)
    .map(({ requestId }) => requestId);
}

function modelCallReceipt(input: {
  branch: AttributedModelUsageIntent["branch"];
  caseId: string;
  intents: readonly AttributedModelUsageIntent[];
  normalizedResponse: string;
  operation: AttributedModelUsageIntent["operation"];
  request: EvalRunJsonObject;
}): SourcePairedLogicalModelCallReceipt {
  return {
    branch: input.branch,
    caseId: input.caseId,
    normalizedResponse: input.normalizedResponse,
    operation: input.operation,
    requestSha256: sha256(JSON.stringify(input.request)),
    responseSha256: sha256(input.normalizedResponse),
    usageRequestIds: usageRequestIds(input),
  };
}

function buildSourcePairedLogicalModelCallReceipts(input: {
  baselineOutput: LongMemEvalV1SourceWorkerOutput;
  candidateOutput: LongMemEvalV1SourceWorkerOutput;
  cases: readonly LongMemEvalV1SourcePairedCaseResult[];
  dataset: PreparedLongMemEvalV1Dataset;
  intents: readonly AttributedModelUsageIntent[];
  judgeVerdicts: ReadonlyMap<string, string>;
  models: LongMemEvalV1SourcePairedReport["models"];
  protocolIdentity: LongMemEvalV1SourcePairedReport["protocolIdentity"];
}): SourcePairedLogicalModelCallReceipt[] {
  const receipts: SourcePairedLogicalModelCallReceipt[] = [];
  for (const [index, testCase] of input.dataset.selected.entries()) {
    const paired = input.cases[index]!;
    const baseline = input.baselineOutput.cases[index]!;
    const candidate = input.candidateOutput.cases[index]!;
    const adapted = input.dataset.adaptedByQuestionId.get(testCase.questionId);
    if (
      adapted === undefined ||
      paired.caseKey !== baseline.caseKey ||
      paired.caseKey !== candidate.caseKey
    ) {
      throw new Error("LongMemEval V1 source-paired receipt identity drifted.");
    }
    const contexts = {
      baseline: buildReaderContext(testCase.questionDate, baseline.context),
      candidate: buildReaderContext(testCase.questionDate, candidate.context),
    };
    const shared = contexts.baseline === contexts.candidate;
    const arms = shared ? ["shared"] as const : paired.armOrder;
    for (const arm of arms) {
      const result = arm === "candidate" ? paired.candidate : paired.baseline;
      const context = arm === "candidate"
        ? contexts.candidate
        : contexts.baseline;
      const caseId = `${paired.caseKey}:${arm}`;
      receipts.push(modelCallReceipt({
        branch: arm === "shared" ? "protocol_reader" : arm,
        caseId,
        intents: input.intents,
        normalizedResponse: result.answer,
        operation: "answer_generation",
        request: {
          configuration: input.protocolIdentity.modelCallConfiguration.reader!,
          model: { ...input.models.reader },
          prompt: `Question:\n${testCase.question}\n\nMemory evidence:\n${context}`,
          systemSha256: input.protocolIdentity.promptSha256s.reader,
        },
      }));
    }
    for (const arm of arms) {
      const result = arm === "candidate" ? paired.candidate : paired.baseline;
      const caseId = `${paired.caseKey}:${arm}`;
      const verdict = input.judgeVerdicts.get(caseId);
      const questionType = adapted.protocolMetadata?.questionType;
      if (
        verdict === undefined ||
        typeof questionType !== "string" ||
        parseLongMemEvalOfficialJudgeVerdict(verdict) !== result.correct
      ) {
        throw new Error("LongMemEval V1 source-paired judge receipt drifted.");
      }
      receipts.push(modelCallReceipt({
        branch: "judge",
        caseId,
        intents: input.intents,
        normalizedResponse: verdict,
        operation: "judge",
        request: {
          configuration: input.protocolIdentity.modelCallConfiguration.judge!,
          model: { ...input.models.judge },
          prompt: buildLongMemEvalOfficialJudgePrompt({
            abstention: isLongMemEvalOfficialAbstentionCase(adapted.caseId),
            candidateAnswer: result.answer,
            expectedAnswer: adapted.expectedAnswer,
            question: adapted.question,
            questionType,
          }),
        },
      }));
    }
  }
  return receipts;
}

function buildReaderContext(questionDate: string, context: string): string {
  return [
    `Question date:\n${questionDate}`,
    `Memory context:\n${context}`,
  ].join("\n\n");
}

async function mapWithConcurrencyDrained<T, R>(input: {
  concurrency: number;
  items: readonly T[];
  operation(item: T): Promise<R>;
}): Promise<R[]> {
  const results = new Array<R>(input.items.length);
  let firstError: unknown;
  let nextIndex = 0;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function parseSourceWorkerOutput(input: {
  expected: readonly LongMemEvalV1SourceWorkerCase[];
  raw: string;
}): LongMemEvalV1SourceWorkerOutput {
  let value: unknown;
  try {
    value = JSON.parse(input.raw) as unknown;
  } catch {
    throw new Error("Invalid LongMemEval V1 source-worker output.");
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["cases", "schemaVersion"]) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.cases) ||
    value.cases.length !== input.expected.length
  ) {
    throw new Error("Invalid LongMemEval V1 source-worker output.");
  }
  for (const [index, result] of value.cases.entries()) {
    const expected = input.expected[index]!;
    if (
      !isRecord(result) ||
      !hasExactKeys(result, ["caseKey", "context", "retrievedSessionIds"]) ||
      result.caseKey !== expected.caseKey ||
      typeof result.context !== "string" ||
      !Array.isArray(result.retrievedSessionIds) ||
      result.retrievedSessionIds.some(
        (sessionId) =>
          typeof sessionId !== "string" ||
          !/^session-[1-9][0-9]*$/u.test(sessionId) ||
          Number(sessionId.slice("session-".length)) > expected.sessions.length,
      ) ||
      new Set(result.retrievedSessionIds).size !== result.retrievedSessionIds.length
    ) {
      throw new Error("Invalid LongMemEval V1 source-worker output.");
    }
  }
  return value as unknown as LongMemEvalV1SourceWorkerOutput;
}

async function installBoundDependencies(checkoutRoot: string): Promise<void> {
  await execFileAsync(
    process.execPath,
    ["install", "--frozen-lockfile", "--ignore-scripts", "--silent"],
    {
      cwd: checkoutRoot,
      env: buildSourceChildEnvironment(process.env),
    },
  );
}

function buildSourceChildEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => name !== "BUN_OPTIONS" && !name.startsWith("GIT_"),
    ),
  );
}

const SOURCE_WORKER_ENVIRONMENT_NAMES = new Set([
  "PATH",
  "TMPDIR",
]);

export function buildLongMemEvalV1SourceWorkerEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NODE_ENV: "test",
    TZ: "UTC",
    ...Object.fromEntries(
    Object.entries(environment).filter(
      ([name, value]) =>
        value !== undefined && SOURCE_WORKER_ENVIRONMENT_NAMES.has(name),
    ),
    ),
  };
}

async function runWorkerProcess(input: {
  checkoutRoot: string;
  payload: string;
}): Promise<string> {
  const workerPath = join(input.checkoutRoot, SOURCE_WORKER_RELATIVE_PATH);
  const workerTmp = join(dirname(input.checkoutRoot), "worker-tmp");
  await mkdir(workerTmp, { recursive: true });
  const child = Bun.spawn(
    [process.execPath, "--no-install", workerPath],
    {
      cwd: input.checkoutRoot,
      env: buildLongMemEvalV1SourceWorkerEnvironment({
        ...process.env,
        TMPDIR: workerTmp,
      }),
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
    },
  );
  child.stdin.write(input.payload);
  child.stdin.end();
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `LongMemEval V1 source worker failed: ${stderr.trim() || `exit ${exitCode}`}`,
    );
  }
  return stdout;
}

async function runSourceArm(input: {
  identity: GitSourceIdentity;
  payload: string;
  workerRaw: string;
}): Promise<LongMemEvalV1SourceWorkerOutput> {
  const expected = (
    JSON.parse(input.payload) as LongMemEvalV1SourceWorkerInput
  ).cases;
  return withGitSourceCheckout(
    repositoryRoot,
    input.identity,
    async (checkoutRoot) => {
      await installBoundDependencies(checkoutRoot);
      const workerPath = join(checkoutRoot, SOURCE_WORKER_RELATIVE_PATH);
      try {
        const checkoutWorker = await readFile(workerPath, "utf8");
        if (checkoutWorker !== input.workerRaw) {
          throw new Error("LongMemEval V1 source worker bytes drifted.");
        }
        const raw = await runWorkerProcess({
          checkoutRoot,
          payload: input.payload,
        });
        return parseSourceWorkerOutput({ expected, raw });
      } finally {
        await verifyGitSourceStability(checkoutRoot, input.identity);
      }
    },
  );
}

async function isAncestor(
  ancestorCommit: string,
  descendantCommit: string,
): Promise<boolean> {
  const child = Bun.spawn([
    "git",
    "-C",
    repositoryRoot,
    "merge-base",
    "--is-ancestor",
    ancestorCommit,
    descendantCommit,
  ], {
    env: buildSourceChildEnvironment(process.env),
    stderr: "pipe",
    stdout: "pipe",
  });
  const exitCode = await child.exited;
  if (exitCode === 0) return true;
  if (exitCode === 1) return false;
  const stderr = await new Response(child.stderr).text();
  throw new Error(`Git ancestry check failed: ${stderr.trim()}`);
}

async function gitOutput(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repositoryRoot, ...args],
    {
      encoding: "utf8",
      env: buildSourceChildEnvironment(process.env),
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return stdout;
}

async function resolveGitDeltaIdentity(
  from: GitSourceIdentity,
  to: GitSourceIdentity,
): Promise<SourcePairedGitDeltaIdentity> {
  const revision = `${from.commit}..${to.commit}`;
  const [filesRaw, patch] = await Promise.all([
    gitOutput(["diff", "--name-only", "--no-renames", revision, "--"]),
    gitOutput([
      "diff",
      "--binary",
      "--full-index",
      "--no-color",
      "--no-ext-diff",
      "--no-renames",
      revision,
      "--",
    ]),
  ]);
  return {
    files: filesRaw.split("\n").filter(Boolean),
    patchSha256: sha256(patch),
  };
}

async function readGitFile(
  identity: GitSourceIdentity,
  path: string,
): Promise<string> {
  await verifyGitSourceAnchor(repositoryRoot, identity);
  return gitOutput(["show", `${identity.commit}:${path}`]);
}

async function verifySourceIdentityClosure(input: {
  payload: string;
  source: LongMemEvalV1SourcePairedReport["source"];
}): Promise<string> {
  const { source } = input;
  if (
    !isDeepStrictEqual(
      source.baselineAnchor,
      LONGMEMEVAL_V1_SOURCE_PAIRED_BASELINE_ANCHOR,
    ) ||
    !isDeepStrictEqual(source.baseline, LONGMEMEVAL_V1_SOURCE_PAIRED_BASELINE) ||
    source.baselineRole !==
      "v0.7.5-derived-common-mode-execution-baseline" ||
    !isDeepStrictEqual(source.candidate, LONGMEMEVAL_V1_SOURCE_PAIRED_CANDIDATE) ||
    source.workerPayloadSha256 !== sha256(input.payload)
  ) {
    throw new Error("LongMemEval V1 source-paired source identity drifted.");
  }
  await Promise.all([
    verifyGitSourceAnchor(repositoryRoot, source.baselineAnchor),
    verifyGitSourceAnchor(repositoryRoot, source.baseline),
    verifyGitSourceAnchor(repositoryRoot, source.candidate),
    verifyGitSourceAnchor(repositoryRoot, source.orchestrator),
  ]);
  const [anchorToBaseline, baselineToCandidate, candidateToOrchestrator] =
    await Promise.all([
      isAncestor(source.baselineAnchor.commit, source.baseline.commit),
      isAncestor(source.baseline.commit, source.candidate.commit),
      isAncestor(source.candidate.commit, source.orchestrator.commit),
    ]);
  if (!anchorToBaseline || !baselineToCandidate || !candidateToOrchestrator) {
    throw new Error("LongMemEval V1 source-paired source ancestry drifted.");
  }
  const [baselineDelta, candidateDelta, orchestratorDelta] = await Promise.all([
    resolveGitDeltaIdentity(source.baselineAnchor, source.baseline),
    resolveGitDeltaIdentity(source.baseline, source.candidate),
    resolveGitDeltaIdentity(source.candidate, source.orchestrator),
  ]);
  if (
    !isDeepStrictEqual(baselineDelta.files, [...BASELINE_DELTA_FILES]) ||
    !isDeepStrictEqual(candidateDelta.files, [...CANDIDATE_DELTA_FILES]) ||
    !isDeepStrictEqual(source.baselineDeltaFromAnchor, baselineDelta) ||
    !isDeepStrictEqual(source.candidateDeltaFromBaseline, candidateDelta) ||
    !isDeepStrictEqual(source.orchestratorDeltaFromCandidate, orchestratorDelta)
  ) {
    throw new Error("LongMemEval V1 source-paired source delta drifted.");
  }
  const workerRaws = await Promise.all([
    readGitFile(source.baseline, SOURCE_WORKER_RELATIVE_PATH),
    readGitFile(source.candidate, SOURCE_WORKER_RELATIVE_PATH),
    readGitFile(source.orchestrator, SOURCE_WORKER_RELATIVE_PATH),
  ]);
  if (
    workerRaws.some((workerRaw) => workerRaw !== workerRaws[0]) ||
    source.workerSha256 !== sha256(workerRaws[0]!)
  ) {
    throw new Error("LongMemEval V1 source-paired worker identity drifted.");
  }
  return workerRaws[0]!;
}

function targetQuestionType(
  value: string,
): LongMemEvalV1SourcePairedCaseResult["questionType"] {
  if (value !== "knowledge-update" && value !== "temporal-reasoning") {
    throw new Error(`Unexpected LongMemEval V1 question type ${value}.`);
  }
  return value;
}

async function assertArtifactPathsAbsent(root: string): Promise<void> {
  for (const path of [
    BASELINE_SOURCE_ARTIFACT,
    CASES_ARTIFACT,
    CANDIDATE_SOURCE_ARTIFACT,
    INTENTS_ARTIFACT,
    LOGICAL_MODEL_CALL_RECEIPTS_ARTIFACT,
    USAGE_ARTIFACT,
    REPORT_ARTIFACT,
    MANIFEST_ARTIFACT,
  ]) {
    try {
      await access(join(root, path));
      throw new Error(`LongMemEval V1 source-paired artifact exists: ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

async function artifactRef(input: {
  path: string;
  raw: string;
}): Promise<SourcePairedArtifactRef> {
  return {
    bytes: Buffer.byteLength(input.raw),
    path: input.path,
    sha256: sha256(input.raw),
  };
}

function jsonLines(values: readonly unknown[]): string {
  return values.length === 0
    ? ""
    : `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

export async function runLongMemEvalV1SourcePairedDiagnostic(
  root: string,
): Promise<LongMemEvalV1SourcePairedReport> {
  await assertArtifactPathsAbsent(root);
  const datasetRaw = await readFile(join(root, DATASET_RELATIVE_PATH), "utf8");
  const dataset = prepareDataset(datasetRaw);
  const readerModel = resolvePhase74ReaderModel(process.env);
  const judgeModel = resolvePhase74ScorerModels(process.env).judge;
  const orchestrator = await resolveCleanGitSourceIdentity(repositoryRoot);
  if (
    orchestrator.commit === LONGMEMEVAL_V1_SOURCE_PAIRED_CANDIDATE.commit ||
    !await isAncestor(
      LONGMEMEVAL_V1_SOURCE_PAIRED_CANDIDATE.commit,
      orchestrator.commit,
    )
  ) {
    throw new Error(
      "LongMemEval V1 source-paired orchestrator must be a later candidate descendant.",
    );
  }

  const workerRaw = await readFile(
    join(repositoryRoot, SOURCE_WORKER_RELATIVE_PATH),
    "utf8",
  );
  const payload = buildLongMemEvalV1SourceWorkerPayload({
    cases: dataset.selected,
    datasetSha256: dataset.identity.rawSha256,
  });
  const source: LongMemEvalV1SourcePairedReport["source"] = {
    baseline: LONGMEMEVAL_V1_SOURCE_PAIRED_BASELINE,
    baselineAnchor: LONGMEMEVAL_V1_SOURCE_PAIRED_BASELINE_ANCHOR,
    baselineDeltaFromAnchor: await resolveGitDeltaIdentity(
      LONGMEMEVAL_V1_SOURCE_PAIRED_BASELINE_ANCHOR,
      LONGMEMEVAL_V1_SOURCE_PAIRED_BASELINE,
    ),
    baselineRole: "v0.7.5-derived-common-mode-execution-baseline",
    candidate: LONGMEMEVAL_V1_SOURCE_PAIRED_CANDIDATE,
    candidateDeltaFromBaseline: await resolveGitDeltaIdentity(
      LONGMEMEVAL_V1_SOURCE_PAIRED_BASELINE,
      LONGMEMEVAL_V1_SOURCE_PAIRED_CANDIDATE,
    ),
    orchestrator,
    orchestratorDeltaFromCandidate: await resolveGitDeltaIdentity(
      LONGMEMEVAL_V1_SOURCE_PAIRED_CANDIDATE,
      orchestrator,
    ),
    workerPayloadSha256: sha256(payload),
    workerSha256: sha256(workerRaw),
  };
  await verifySourceIdentityClosure({ payload, source });
  const [baselineOutput, candidateOutput] = await Promise.all([
    runSourceArm({
      identity: LONGMEMEVAL_V1_SOURCE_PAIRED_BASELINE,
      payload,
      workerRaw,
    }),
    runSourceArm({
      identity: LONGMEMEVAL_V1_SOURCE_PAIRED_CANDIDATE,
      payload,
      workerRaw,
    }),
  ]);
  const baselineSourceRaw = `${JSON.stringify(baselineOutput, null, 2)}\n`;
  const candidateSourceRaw = `${JSON.stringify(candidateOutput, null, 2)}\n`;
  await Promise.all([
    writeFile(join(root, BASELINE_SOURCE_ARTIFACT), baselineSourceRaw, {
      encoding: "utf8",
      flag: "wx",
    }),
    writeFile(join(root, CANDIDATE_SOURCE_ARTIFACT), candidateSourceRaw, {
      encoding: "utf8",
      flag: "wx",
    }),
  ]);

  const intentsPath = join(root, INTENTS_ARTIFACT);
  const usagePath = join(root, USAGE_ARTIFACT);
  await Promise.all([
    writeFile(intentsPath, "", { encoding: "utf8", flag: "wx" }),
    writeFile(usagePath, "", { encoding: "utf8", flag: "wx" }),
  ]);
  const events: AttributedModelUsageAttempt[] = [];
  const intents: AttributedModelUsageIntent[] = [];
  const judgeVerdicts = new Map<string, string>();
  const onUsageEvent = (event: AttributedModelUsageAttempt) => {
    appendPhase74ModelUsageEventSync(usagePath, event);
  };
  const onUsageIntent = (intent: AttributedModelUsageIntent) => {
    appendPhase74ModelUsageIntentSync(intentsPath, intent);
  };
  const reader = createPhase74LiveReader({
    events,
    intents,
    model: readerModel,
    onUsageEvent,
    onUsageIntent,
  });
  const assessor = createPhase74ProtocolCompatibleAnswerAssessor({
    benchmark: "longmemeval",
    events,
    intents,
    model: judgeModel,
    onLongMemEvalVerdict: ({ caseId, verdict }) => {
      if (judgeVerdicts.has(caseId)) {
        throw new Error("LongMemEval V1 source-paired duplicate judge verdict.");
      }
      judgeVerdicts.set(caseId, verdict);
    },
    onUsageEvent,
    onUsageIntent,
  });

  let answerInvocations = 0;
  let judgeInvocations = 0;
  const cases = await mapWithConcurrencyDrained({
    concurrency: 2,
    items: dataset.selected.map((testCase, index) => ({
      baseline: baselineOutput.cases[index]!,
      candidate: candidateOutput.cases[index]!,
      testCase,
    })),
    operation: async ({ baseline, candidate: candidateCase, testCase }) => {
      if (baseline.caseKey !== candidateCase.caseKey) {
        throw new Error("LongMemEval V1 paired source case identity drifted.");
      }
      const adapted = dataset.adaptedByQuestionId.get(testCase.questionId);
      if (adapted === undefined) {
        throw new Error("LongMemEval V1 scorer case is missing.");
      }
      const contexts = {
        baseline: buildReaderContext(testCase.questionDate, baseline.context),
        candidate: buildReaderContext(
          testCase.questionDate,
          candidateCase.context,
        ),
      };
      const order = pairedOrder(baseline.caseKey);
      const answers = new Map<LongMemEvalV1SourceArm, string>();
      const assessments = new Map<
        LongMemEvalV1SourceArm,
        { correct: boolean; score: number }
      >();
      if (contexts.baseline === contexts.candidate) {
        answerInvocations += 1;
        const answer = (await reader({
          caseId: `${baseline.caseKey}:shared`,
          context: contexts.baseline,
          purpose: "protocol:source-paired:shared",
          question: testCase.question,
        })).trim();
        if (answer === "") {
          throw new Error("LongMemEval V1 source-paired reader returned empty output.");
        }
        answers.set("baseline", answer);
        answers.set("candidate", answer);
        judgeInvocations += 1;
        const assessment = await assessor({
          answer,
          purpose: "source-paired:shared",
          testCase: adapted,
          usageCaseId: `${baseline.caseKey}:shared`,
        });
        assessments.set("baseline", assessment);
        assessments.set("candidate", assessment);
      } else {
        for (const arm of order) {
          answerInvocations += 1;
          const answer = (await reader({
            caseId: `${baseline.caseKey}:${arm}`,
            context: contexts[arm],
            purpose: `final:${arm}:${baseline.caseKey}`,
            question: testCase.question,
          })).trim();
          if (answer === "") {
            throw new Error(
              "LongMemEval V1 source-paired reader returned empty output.",
            );
          }
          answers.set(arm, answer);
        }
        for (const arm of order) {
          judgeInvocations += 1;
          assessments.set(arm, await assessor({
            answer: answers.get(arm)!,
            purpose: `source-paired:${arm}`,
            testCase: adapted,
            usageCaseId: `${baseline.caseKey}:${arm}`,
          }));
        }
      }

      const armResult = (
        arm: LongMemEvalV1SourceArm,
      ): LongMemEvalV1SourcePairedArmResult => {
        const assessment = assessments.get(arm)!;
        const source = arm === "baseline" ? baseline : candidateCase;
        if (
          !Number.isFinite(assessment.score) ||
          assessment.score !== Number(assessment.correct)
        ) {
          throw new Error("LongMemEval V1 scorer returned a non-binary score.");
        }
        return {
          answer: answers.get(arm)!,
          contextSha256: sha256(contexts[arm]),
          contextTokens: estimateTextTokens(contexts[arm]),
          correct: assessment.correct,
          retrievedSessionIds: [...source.retrievedSessionIds],
          score: assessment.score,
        };
      };
      const baselineResult = armResult("baseline");
      const candidateResult = armResult("candidate");
      return {
        armOrder: order,
        baseline: baselineResult,
        candidate: candidateResult,
        caseKey: baseline.caseKey,
        delta: (
          Number(candidateResult.correct) - Number(baselineResult.correct)
        ) as -1 | 0 | 1,
        questionType: targetQuestionType(testCase.questionType),
      };
    },
  });

  const ledger = await loadPhase74ModelUsageLedger({
    eventsPath: usagePath,
    intentsPath,
  });
  if (
    ledger.pendingIntents.length !== 0 ||
    !isDeepStrictEqual(ledger.events, events) ||
    !isDeepStrictEqual(ledger.intents, intents)
  ) {
    throw new Error("LongMemEval V1 model usage ledger is incomplete.");
  }
  const usageClosure = validateLongMemEvalV1SourcePairedUsageClosure({
    cases,
    events: ledger.events,
    intents: ledger.intents,
  });
  if (
    usageClosure.answerInvocations !== answerInvocations ||
    usageClosure.judgeInvocations !== judgeInvocations
  ) {
    throw new Error("LongMemEval V1 source-paired invocation count drifted.");
  }
  await verifyGitSourceStability(repositoryRoot, orchestrator);
  const metrics = deriveLongMemEvalV1SourcePairedMetrics(cases);
  const generatedAt = new Date().toISOString();
  const runId = basename(root);
  const models = {
    judge: modelIdentity(judgeModel),
    reader: modelIdentity(readerModel),
  };
  const protocolIdentity = sourcePairedProtocolIdentity(models.judge);
  const logicalModelCallReceipts = buildSourcePairedLogicalModelCallReceipts({
    baselineOutput,
    candidateOutput,
    cases,
    dataset,
    intents: ledger.intents,
    judgeVerdicts,
    models,
    protocolIdentity,
  });
  const report: LongMemEvalV1SourcePairedReport = {
    claimBoundary: {
      publicClaimEligible: false,
      promotionEligible: false,
      seenCasesOnly: true,
    },
    configuration: buildLongMemEvalV1SourcePairedConfiguration(),
    dataset: dataset.identity,
    execution: {
      answerInvocations: usageClosure.answerInvocations,
      executionFailures: 0,
      judgeInvocations: usageClosure.judgeInvocations,
      logicalModelCallReceipts: logicalModelCallReceipts.length,
      modelUsageEvents: ledger.events.length,
      modelUsageIntents: ledger.intents.length,
      pendingModelUsageIntents: 0,
      sourceWorkerRuns: 2,
    },
    generatedAt,
    generatedBy: "scripts/research/longmemeval-v1/source-paired.ts",
    inference: {
      mcnemar: metrics.mcnemar,
      pairedBootstrap: metrics.pairedBootstrap,
    },
    models,
    protocolId: LONGMEMEVAL_V1_SOURCE_PAIRED_PROTOCOL_ID,
    protocolIdentity,
    runId,
    source,
    summary: metrics.summary,
  };

  const casesRaw = jsonLines(cases);
  const logicalModelCallReceiptsRaw = jsonLines(logicalModelCallReceipts);
  const reportRaw = `${JSON.stringify(report, null, 2)}\n`;
  await Promise.all([
    writeFile(join(root, CASES_ARTIFACT), casesRaw, {
      encoding: "utf8",
      flag: "wx",
    }),
    writeFile(join(root, REPORT_ARTIFACT), reportRaw, {
      encoding: "utf8",
      flag: "wx",
    }),
    writeFile(
      join(root, LOGICAL_MODEL_CALL_RECEIPTS_ARTIFACT),
      logicalModelCallReceiptsRaw,
      { encoding: "utf8", flag: "wx" },
    ),
  ]);
  const [intentsRaw, usageRaw] = await Promise.all([
    readFile(intentsPath, "utf8"),
    readFile(usagePath, "utf8"),
  ]);
  const manifest: LongMemEvalV1SourcePairedManifest = {
    artifacts: await Promise.all([
      artifactRef({ path: CASES_ARTIFACT, raw: casesRaw }),
      artifactRef({ path: BASELINE_SOURCE_ARTIFACT, raw: baselineSourceRaw }),
      artifactRef({ path: CANDIDATE_SOURCE_ARTIFACT, raw: candidateSourceRaw }),
      artifactRef({ path: INTENTS_ARTIFACT, raw: intentsRaw }),
      artifactRef({
        path: LOGICAL_MODEL_CALL_RECEIPTS_ARTIFACT,
        raw: logicalModelCallReceiptsRaw,
      }),
      artifactRef({ path: USAGE_ARTIFACT, raw: usageRaw }),
      artifactRef({ path: REPORT_ARTIFACT, raw: reportRaw }),
    ]),
    claimBoundary: report.claimBoundary,
    configuration: report.configuration,
    dataset: report.dataset,
    generatedAt,
    models,
    protocolIdentity: report.protocolIdentity,
    protocolId: LONGMEMEVAL_V1_SOURCE_PAIRED_PROTOCOL_ID,
    runId,
    schemaVersion: 1,
    source,
  };
  await writeFile(
    join(root, MANIFEST_ARTIFACT),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return report;
}

function assertExactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value) || !hasExactKeys(value, keys)) {
    throw new Error(`Invalid LongMemEval V1 source-paired ${label}.`);
  }
}

function parseJsonLines(raw: string, label: string): unknown[] {
  return raw.split("\n").filter((line) => line !== "").map((line, index) => {
    try {
      return JSON.parse(line) as unknown;
    } catch {
      throw new Error(
        `Invalid LongMemEval V1 ${label} JSON at line ${index + 1}.`,
      );
    }
  });
}

function parseLogicalModelCallReceipts(
  raw: string,
): SourcePairedLogicalModelCallReceipt[] {
  return parseJsonLines(raw, "logical model call receipt").map((value) => {
    assertExactRecord(
      value,
      [
        "branch",
        "caseId",
        "normalizedResponse",
        "operation",
        "requestSha256",
        "responseSha256",
        "usageRequestIds",
      ],
      "logical model call receipt",
    );
    if (
      (value.branch !== "baseline" &&
        value.branch !== "candidate" &&
        value.branch !== "judge" &&
        value.branch !== "protocol_reader") ||
      typeof value.caseId !== "string" ||
      !/^case-[a-f0-9]{24}:(?:baseline|candidate|shared)$/u.test(
        value.caseId,
      ) ||
      typeof value.normalizedResponse !== "string" ||
      value.normalizedResponse.trim() === "" ||
      (value.operation !== "answer_generation" && value.operation !== "judge") ||
      typeof value.requestSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(value.requestSha256) ||
      value.responseSha256 !== sha256(value.normalizedResponse) ||
      !Array.isArray(value.usageRequestIds) ||
      value.usageRequestIds.length === 0 ||
      value.usageRequestIds.some(
        (requestId) => typeof requestId !== "string" || requestId.length === 0,
      ) ||
      new Set(value.usageRequestIds).size !== value.usageRequestIds.length
    ) {
      throw new Error(
        "Invalid LongMemEval V1 source-paired logical model call receipt.",
      );
    }
    return value as unknown as SourcePairedLogicalModelCallReceipt;
  });
}

function validatePairedCases(input: {
  baselineOutput: LongMemEvalV1SourceWorkerOutput;
  candidateOutput: LongMemEvalV1SourceWorkerOutput;
  dataset: PreparedLongMemEvalV1Dataset;
  raw: string;
}): LongMemEvalV1SourcePairedCaseResult[] {
  const payload = JSON.parse(buildLongMemEvalV1SourceWorkerPayload({
    cases: input.dataset.selected,
    datasetSha256: input.dataset.identity.rawSha256,
  })) as LongMemEvalV1SourceWorkerInput;
  const values = parseJsonLines(input.raw, "paired case");
  if (values.length !== 211) {
    throw new Error("LongMemEval V1 source-paired cases must contain 211 rows.");
  }
  const cases: LongMemEvalV1SourcePairedCaseResult[] = [];
  for (const [index, value] of values.entries()) {
    assertExactRecord(
      value,
      [
        "armOrder",
        "baseline",
        "candidate",
        "caseKey",
        "delta",
        "questionType",
      ],
      "case",
    );
    const expectedCase = payload.cases[index]!;
    const expectedQuestion = input.dataset.selected[index]!;
    if (
      value.caseKey !== expectedCase.caseKey ||
      value.questionType !== expectedQuestion.questionType ||
      !Array.isArray(value.armOrder) ||
      !isDeepStrictEqual(value.armOrder, pairedOrder(expectedCase.caseKey))
    ) {
      throw new Error("LongMemEval V1 source-paired case identity drifted.");
    }
    const validateArm = (
      arm: unknown,
    ): LongMemEvalV1SourcePairedArmResult => {
      assertExactRecord(
        arm,
        [
          "answer",
          "contextSha256",
          "contextTokens",
          "correct",
          "retrievedSessionIds",
          "score",
        ],
        "arm result",
      );
      if (
        typeof arm.answer !== "string" ||
        arm.answer.trim() === "" ||
        typeof arm.contextSha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(arm.contextSha256) ||
        !Number.isSafeInteger(arm.contextTokens) ||
        Number(arm.contextTokens) < 1 ||
        typeof arm.correct !== "boolean" ||
        arm.score !== Number(arm.correct) ||
        !Array.isArray(arm.retrievedSessionIds) ||
        arm.retrievedSessionIds.some(
          (sessionId) =>
            typeof sessionId !== "string" ||
            !/^session-[1-9][0-9]*$/u.test(sessionId) ||
            Number(sessionId.slice("session-".length)) >
              expectedCase.sessions.length,
        ) ||
        new Set(arm.retrievedSessionIds).size !== arm.retrievedSessionIds.length
      ) {
        throw new Error("Invalid LongMemEval V1 source-paired arm result.");
      }
      return arm as unknown as LongMemEvalV1SourcePairedArmResult;
    };
    const baseline = validateArm(value.baseline);
    const candidate = validateArm(value.candidate);
    const baselineSource = input.baselineOutput.cases[index];
    const candidateSource = input.candidateOutput.cases[index];
    const expectedBaselineContext = baselineSource === undefined
      ? undefined
      : buildReaderContext(expectedQuestion.questionDate, baselineSource.context);
    const expectedCandidateContext = candidateSource === undefined
      ? undefined
      : buildReaderContext(expectedQuestion.questionDate, candidateSource.context);
    if (
      baselineSource?.caseKey !== expectedCase.caseKey ||
      candidateSource?.caseKey !== expectedCase.caseKey ||
      expectedBaselineContext === undefined ||
      expectedCandidateContext === undefined ||
      baseline.contextSha256 !== sha256(expectedBaselineContext) ||
      candidate.contextSha256 !== sha256(expectedCandidateContext) ||
      baseline.contextTokens !== estimateTextTokens(expectedBaselineContext) ||
      candidate.contextTokens !== estimateTextTokens(expectedCandidateContext) ||
      !isDeepStrictEqual(
        baseline.retrievedSessionIds,
        baselineSource.retrievedSessionIds,
      ) ||
      !isDeepStrictEqual(
        candidate.retrievedSessionIds,
        candidateSource.retrievedSessionIds,
      )
    ) {
      throw new Error("LongMemEval V1 source-paired source output drifted.");
    }
    const delta = Number(candidate.correct) - Number(baseline.correct);
    if (value.delta !== delta) {
      throw new Error("LongMemEval V1 source-paired case delta drifted.");
    }
    cases.push({
      armOrder: value.armOrder as LongMemEvalV1SourceArm[],
      baseline,
      candidate,
      caseKey: expectedCase.caseKey,
      delta: delta as -1 | 0 | 1,
      questionType: targetQuestionType(expectedQuestion.questionType),
    });
  }
  if (new Set(cases.map(({ caseKey }) => caseKey)).size !== cases.length) {
    throw new Error("LongMemEval V1 source-paired cases contain duplicates.");
  }
  assertSharedContextReuse(cases);
  return cases;
}

function assertCanonicalModelIdentities(
  models: LongMemEvalV1SourcePairedReport["models"],
): void {
  if (
    !isDeepStrictEqual(models, {
      judge: {
        baseURL: PHASE74_GATEWAY,
        model: PHASE74_JUDGE_MODEL,
        provider: "openai",
      },
      reader: {
        baseURL: PHASE74_GATEWAY,
        model: PHASE74_LANGUAGE_MODEL,
        provider: "openai",
      },
    })
  ) {
    throw new Error("LongMemEval V1 source-paired model identity drifted.");
  }
}

function assertArtifactRefs(input: {
  manifest: LongMemEvalV1SourcePairedManifest;
  raws: Readonly<Record<string, string>>;
}): void {
  const expectedPaths = [
    CASES_ARTIFACT,
    BASELINE_SOURCE_ARTIFACT,
    CANDIDATE_SOURCE_ARTIFACT,
    INTENTS_ARTIFACT,
    LOGICAL_MODEL_CALL_RECEIPTS_ARTIFACT,
    USAGE_ARTIFACT,
    REPORT_ARTIFACT,
  ];
  if (
    !Array.isArray(input.manifest.artifacts) ||
    input.manifest.artifacts.length !== expectedPaths.length
  ) {
    throw new Error("LongMemEval V1 source-paired artifact closure drifted.");
  }
  for (const [index, expectedPath] of expectedPaths.entries()) {
    const reference = input.manifest.artifacts[index];
    const raw = input.raws[expectedPath];
    if (
      reference === undefined ||
      raw === undefined ||
      reference.path !== expectedPath ||
      reference.bytes !== Buffer.byteLength(raw) ||
      reference.sha256 !== sha256(raw)
    ) {
      throw new Error("LongMemEval V1 source-paired artifact identity drifted.");
    }
  }
}

export async function verifyLongMemEvalV1SourcePairedDiagnostic(
  root: string,
): Promise<{
  caseCount: 211;
  manifestSha256: string;
  protocolId: typeof LONGMEMEVAL_V1_SOURCE_PAIRED_PROTOCOL_ID;
  reportSha256: string;
}> {
  const paths = {
    baselineSource: join(root, BASELINE_SOURCE_ARTIFACT),
    cases: join(root, CASES_ARTIFACT),
    candidateSource: join(root, CANDIDATE_SOURCE_ARTIFACT),
    dataset: join(root, DATASET_RELATIVE_PATH),
    intents: join(root, INTENTS_ARTIFACT),
    manifest: join(root, MANIFEST_ARTIFACT),
    logicalModelCallReceipts: join(
      root,
      LOGICAL_MODEL_CALL_RECEIPTS_ARTIFACT,
    ),
    report: join(root, REPORT_ARTIFACT),
    usage: join(root, USAGE_ARTIFACT),
  };
  const [
    baselineSourceRaw,
    casesRaw,
    candidateSourceRaw,
    datasetRaw,
    intentsRaw,
    manifestRaw,
    logicalModelCallReceiptsRaw,
    reportRaw,
    usageRaw,
  ] = await Promise.all([
    readFile(paths.baselineSource, "utf8"),
    readFile(paths.cases, "utf8"),
    readFile(paths.candidateSource, "utf8"),
    readFile(paths.dataset, "utf8"),
    readFile(paths.intents, "utf8"),
    readFile(paths.manifest, "utf8"),
    readFile(paths.logicalModelCallReceipts, "utf8"),
    readFile(paths.report, "utf8"),
    readFile(paths.usage, "utf8"),
  ]);
  const dataset = prepareDataset(datasetRaw);
  const payload = buildLongMemEvalV1SourceWorkerPayload({
    cases: dataset.selected,
    datasetSha256: dataset.identity.rawSha256,
  });
  const expectedWorkerCases = (
    JSON.parse(payload) as LongMemEvalV1SourceWorkerInput
  ).cases;
  const baselineOutput = parseSourceWorkerOutput({
    expected: expectedWorkerCases,
    raw: baselineSourceRaw,
  });
  const candidateOutput = parseSourceWorkerOutput({
    expected: expectedWorkerCases,
    raw: candidateSourceRaw,
  });
  const manifestValue = JSON.parse(manifestRaw) as unknown;
  const reportValue = JSON.parse(reportRaw) as unknown;
  assertExactRecord(
    manifestValue,
    [
      "artifacts",
      "claimBoundary",
      "configuration",
      "dataset",
      "generatedAt",
      "models",
      "protocolIdentity",
      "protocolId",
      "runId",
      "schemaVersion",
      "source",
    ],
    "manifest",
  );
  assertExactRecord(
    reportValue,
    [
      "claimBoundary",
      "configuration",
      "dataset",
      "execution",
      "generatedAt",
      "generatedBy",
      "inference",
      "models",
      "protocolIdentity",
      "protocolId",
      "runId",
      "source",
      "summary",
    ],
    "report",
  );
  const manifest = manifestValue as unknown as LongMemEvalV1SourcePairedManifest;
  const report = reportValue as unknown as LongMemEvalV1SourcePairedReport;
  assertSourcePairedConfiguration(manifest.configuration);
  const expectedClaimBoundary = {
    publicClaimEligible: false,
    promotionEligible: false,
    seenCasesOnly: true,
  } as const;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.protocolId !== LONGMEMEVAL_V1_SOURCE_PAIRED_PROTOCOL_ID ||
    report.protocolId !== LONGMEMEVAL_V1_SOURCE_PAIRED_PROTOCOL_ID ||
    manifest.runId !== basename(root) ||
    report.runId !== manifest.runId ||
    report.generatedBy !==
      "scripts/research/longmemeval-v1/source-paired.ts" ||
    manifest.generatedAt !== report.generatedAt ||
    !isDeepStrictEqual(manifest.claimBoundary, expectedClaimBoundary) ||
    !isDeepStrictEqual(report.claimBoundary, expectedClaimBoundary) ||
    !isDeepStrictEqual(report.configuration, manifest.configuration) ||
    !isDeepStrictEqual(manifest.dataset, dataset.identity) ||
    !isDeepStrictEqual(report.dataset, manifest.dataset) ||
    !isDeepStrictEqual(manifest.source, report.source) ||
    !isDeepStrictEqual(manifest.models, report.models) ||
    !isDeepStrictEqual(manifest.protocolIdentity, report.protocolIdentity)
  ) {
    throw new Error("LongMemEval V1 source-paired manifest/report drifted.");
  }
  assertCanonicalModelIdentities(report.models);
  if (
    !isDeepStrictEqual(
      report.protocolIdentity,
      sourcePairedProtocolIdentity(report.models.judge),
    )
  ) {
    throw new Error("LongMemEval V1 source-paired protocol identity drifted.");
  }
  assertArtifactRefs({
    manifest,
    raws: {
      [CASES_ARTIFACT]: casesRaw,
      [BASELINE_SOURCE_ARTIFACT]: baselineSourceRaw,
      [CANDIDATE_SOURCE_ARTIFACT]: candidateSourceRaw,
      [INTENTS_ARTIFACT]: intentsRaw,
      [LOGICAL_MODEL_CALL_RECEIPTS_ARTIFACT]: logicalModelCallReceiptsRaw,
      [REPORT_ARTIFACT]: reportRaw,
      [USAGE_ARTIFACT]: usageRaw,
    },
  });
  const currentOrchestrator = await resolveCleanGitSourceIdentity(repositoryRoot);
  if (!isDeepStrictEqual(currentOrchestrator, report.source.orchestrator)) {
    throw new Error(
      "LongMemEval V1 source-paired verifier source identity drifted.",
    );
  }
  const workerRaw = await verifySourceIdentityClosure({
    payload,
    source: report.source,
  });
  const [baselineReplay, candidateReplay] = await Promise.all([
    runSourceArm({
      identity: report.source.baseline,
      payload,
      workerRaw,
    }),
    runSourceArm({
      identity: report.source.candidate,
      payload,
      workerRaw,
    }),
  ]);
  assertLongMemEvalV1SourceReplayClosure({
    artifacts: { baseline: baselineOutput, candidate: candidateOutput },
    currentOrchestrator,
    replays: { baseline: baselineReplay, candidate: candidateReplay },
    reportedOrchestrator: report.source.orchestrator,
  });

  const cases = validatePairedCases({
    baselineOutput,
    candidateOutput,
    dataset,
    raw: casesRaw,
  });
  const metrics = deriveLongMemEvalV1SourcePairedMetrics(cases);
  if (
    !isDeepStrictEqual(report.summary, metrics.summary) ||
    !isDeepStrictEqual(report.inference, {
      mcnemar: metrics.mcnemar,
      pairedBootstrap: metrics.pairedBootstrap,
    })
  ) {
    throw new Error("LongMemEval V1 source-paired statistics drifted.");
  }
  const ledger = await loadPhase74ModelUsageLedger({
    eventsPath: paths.usage,
    intentsPath: paths.intents,
  });
  const usageClosure = validateLongMemEvalV1SourcePairedUsageClosure({
    cases,
    events: ledger.events,
    intents: ledger.intents,
  });
  const logicalModelCallReceipts = parseLogicalModelCallReceipts(
    logicalModelCallReceiptsRaw,
  );
  const judgeVerdicts = new Map<string, string>();
  for (const receipt of logicalModelCallReceipts) {
    if (receipt.operation !== "judge") continue;
    if (judgeVerdicts.has(receipt.caseId)) {
      throw new Error(
        "LongMemEval V1 source-paired duplicate logical judge receipt.",
      );
    }
    judgeVerdicts.set(receipt.caseId, receipt.normalizedResponse);
  }
  const expectedLogicalModelCallReceipts =
    buildSourcePairedLogicalModelCallReceipts({
      baselineOutput,
      candidateOutput,
      cases,
      dataset,
      intents: ledger.intents,
      judgeVerdicts,
      models: report.models,
      protocolIdentity: report.protocolIdentity,
    });
  if (
    ledger.pendingIntents.length !== 0 ||
    !isDeepStrictEqual(
      logicalModelCallReceipts,
      expectedLogicalModelCallReceipts,
    ) ||
    !isDeepStrictEqual(report.execution, {
      answerInvocations: usageClosure.answerInvocations,
      executionFailures: 0,
      judgeInvocations: usageClosure.judgeInvocations,
      logicalModelCallReceipts: expectedLogicalModelCallReceipts.length,
      modelUsageEvents: ledger.events.length,
      modelUsageIntents: ledger.intents.length,
      pendingModelUsageIntents: 0,
      sourceWorkerRuns: 2,
    })
  ) {
    throw new Error("LongMemEval V1 source-paired execution ledger drifted.");
  }
  await verifyGitSourceStability(repositoryRoot, currentOrchestrator);
  return {
    caseCount: 211,
    manifestSha256: sha256(manifestRaw),
    protocolId: LONGMEMEVAL_V1_SOURCE_PAIRED_PROTOCOL_ID,
    reportSha256: sha256(reportRaw),
  };
}
