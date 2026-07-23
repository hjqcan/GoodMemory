import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import type { EvidenceLedgerFormat } from "../src/eval/evidenceLedgerFormats";
import {
  buildPhase74ModelUsageEvidence,
  loadPhase74ModelUsageLedger,
} from "../src/eval/modelUsage";
import type {
  Phase74IngestionUsageLedger,
  Phase74ModelUsageLedger,
} from "../src/eval/modelUsage";
import {
  PHASE74_CONTEXT_TOKEN_BUDGET,
  truncateRenderedContext,
} from "../src/eval/oracleMatrix";
import type { Phase74BenchmarkFamily } from "../src/eval/phase74Datasets";
import { PHASE74_EXPERIMENT_ARMS } from "../src/eval/phase74ExperimentDesign";
import { assertPhase74ExperimentIdentityContract } from "../src/eval/phase74ExperimentIdentity";
import { loadPhase74FrozenProtectionSuiteEvidence } from "../src/eval/phase74ProtectionSuiteEvidence";
import type {
  Phase74ProtectionSuiteVerifier,
} from "../src/eval/phase74ProtectionVerifier";
import {
  buildPhase74IngestionUsageAllocation,
  buildPhase74IngestionUsagePaths,
  buildPhase74RetrievalSnapshotId,
  verifyPhase74IngestionUsageManifest,
} from "../src/eval/phase74FullRuntime";
import { buildPhase74StageConfigurations } from "../src/eval/phase74Generalization";
import type {
  Phase74EvaluationAttribution,
  Phase74RetrievalSnapshot,
} from "../src/eval/phase74Generalization";
import {
  parsePhase74SealedEscrowBundle,
  parsePhase74SealedExecutionBundle,
  parsePhase74SealedExecutorOutput,
  parsePhase74SealedScoreReceipt,
  sha256Phase74SealedConfiguration,
  verifyPhase74SealedProcessManifest,
  verifyPhase74SealedScoreReceipt,
} from "../src/eval/phase74SealedExecution";
import type {
  Phase74SealedEscrowBundle,
  Phase74SealedExecutionBundle,
  Phase74SealedExecutorOutput,
  Phase74SealedScoreReceipt,
} from "../src/eval/phase74SealedExecution";
import {
  materializePhase74SealedReport,
  materializePhase74SealedRetrievalSnapshots,
} from "../src/eval/phase74SealedScoring";
import {
  parsePhase74UnscoredArtifact,
  serializePhase74UnscoredArtifact,
  sha256Phase74UnscoredArtifact,
} from "../src/eval/phase74UnscoredExecution";
import type {
  Phase74UnscoredExecutionArtifact,
} from "../src/eval/phase74UnscoredExecution";
import {
  evaluatePhase74PromotionGate,
  PHASE74_MAX_PROTECTION_REGRESSION,
  PHASE74_MODEL_USAGE_ACCOUNTING_VERSION,
  PHASE74_MODEL_USAGE_ALLOCATION_POLICY,
} from "../src/eval/phase74PromotionGate";
import type {
  Phase74ModelUsageBranchEvidence,
  Phase74ModelUsageEvidence,
  Phase74ModelUsagePoolEvidence,
  Phase74PromotionGateInput,
  Phase74PromotionGateResult,
  Phase74ProtectionEvidence,
} from "../src/eval/phase74PromotionGate";
import {
  aggregatePhase74Replicates,
  buildPhase74ReplicateComparison,
} from "../src/eval/phase74Replicates";
import type {
  Phase74ReplicateAggregation,
  Phase74ReplicateCaseOutcome,
  Phase74ReplicateComparison,
  Phase74ReplicateRun,
} from "../src/eval/phase74Replicates";
import {
  hashEvalExperimentIdentity,
  hashEvalRunIdentity,
} from "../src/eval/runIdentity";
import type {
  EvalRunIdentity,
  EvalRunJsonObject,
} from "../src/eval/runIdentity";

const BENCHMARKS = ["longmemeval", "locomo"] as const;
const RETRIEVAL_STAGES = ["E1", "E2", "E3"] as const;
const ALL_STAGES = [...RETRIEVAL_STAGES, "E4"] as const;
const EVIDENCE_LEDGER_FORMATS = [
  "prose",
  "chronology",
  "compact_json",
  "json_locale_note",
] as const satisfies readonly EvidenceLedgerFormat[];
const COMPARISON_TOLERANCE = 1e-12;
const MODEL_USAGE_OPERATIONS = new Set([
  "answer_generation",
  "assisted_extraction",
  "embedding",
  "judge",
  "recall_plan",
  "recall_router_plan",
  "recall_router_rerank",
  "reranker_listwise",
  "reranker_pointwise",
]);

type RetrievalStage = (typeof RETRIEVAL_STAGES)[number];
type ExperimentStage = (typeof ALL_STAGES)[number];
type Replicate = 1 | 2 | 3;

interface CallBudgetEvidence {
  embeddingCalls: number;
  embeddingInputByteUpperBound: number;
  embeddingSpendLimitUsd: number;
  languageCalls: number;
  maxLanguageCalls: number;
  schemaVersion: 1;
}

interface DatasetManifestEvidence {
  benchmark: Phase74BenchmarkFamily;
  caseCount: number;
  datasetSha256: string;
  selectedCaseIdsSha256: string;
}

interface RetrievalProgressRow {
  answer: string;
  answerLatencyMs: number;
  arm: string;
  caseId: string;
  clusterId: string;
  contextTokens: number;
  contextTokensBeforeTruncation: number;
  contextTruncated: boolean;
  correct: boolean;
  evaluationAttribution?: Phase74EvaluationAttribution;
  productLatencyMs: number;
  recallLatencyMs: number;
  score: number;
  snapshotId: string;
  stage: RetrievalStage;
}

interface E4ProgressRow {
  caseId: string;
  clusterId: string;
  contextTokens: number;
  contextTokensBeforeTruncation: number;
  contextTruncated: boolean;
  executionError?: string;
  format: EvidenceLedgerFormat;
  renderedLedgerSha256: string;
  score?: number;
  sourceSnapshotId: string;
}

interface RetrievalStageArtifact {
  comparison: Phase74ReplicateComparison;
  executionFailures: number;
  modelUsage: Phase74ModelUsageEvidence;
  renderedContextMaxTokens: number;
  rows: RetrievalProgressRow[];
  sealed: VerifiedSealedStage;
}

interface E4StageArtifact {
  executionFailures: number;
  renderedContextMaxTokens: number;
  rows: E4ProgressRow[];
  sealed: VerifiedSealedStage;
}

interface VerifiedSealedStage {
  artifact: Phase74UnscoredExecutionArtifact;
  escrow: Phase74SealedEscrowBundle;
  execution: Phase74SealedExecutionBundle;
  executorOutput: Phase74SealedExecutorOutput;
  receipt: Phase74SealedScoreReceipt;
}

interface RunArtifact {
  benchmark: Phase74BenchmarkFamily;
  dataset: DatasetManifestEvidence;
  experimentIdentityHash: string;
  identity: EvalRunIdentity;
  identityHash: string;
  replicate: Replicate;
  retrieval: Record<RetrievalStage, RetrievalStageArtifact>;
  runDirectory: string;
  selectionMode: "all" | "deterministic-content-hash-v2";
  e4: E4StageArtifact;
}

interface RunBaseArtifact {
  benchmark: Phase74BenchmarkFamily;
  dataset: DatasetManifestEvidence;
  experimentIdentityHash: string;
  identity: EvalRunIdentity;
  identityHash: string;
  replicate: Replicate;
  runDirectory: string;
  selectedCaseKeysSha256: string;
  selectionMode: "all" | "deterministic-content-hash-v2";
}

interface StageAggregationArtifact extends Omit<
  RunBaseArtifact,
  "selectedCaseKeysSha256"
> {
  retrieval: RetrievalStageArtifact;
}

interface ProtectionArtifact {
  blueprintSha256: string;
  e4: Record<EvidenceLedgerFormat, Phase74ProtectionEvidence[]>;
  evaluatorSource: {
    id: string;
    sha256: string;
  };
  promotion: {
    protections: Phase74ProtectionEvidence[];
    safety: Phase74PromotionGateInput["safety"];
  };
  sha256: string;
}

export interface Phase74AggregationCliOptions {
  bootstrapSamples?: number;
  outputPath: string;
  promotionStage?: RetrievalStage;
  protectionArtifactPath?: string;
  runDirectories: string[];
  seed?: number;
}

export interface Phase74ArtifactAggregationInput {
  bootstrapSamples?: number;
  promotionStage?: RetrievalStage;
  protectionArtifactPath?: string;
  runDirectories: readonly string[];
  seed?: number;
}

export interface Phase74ArtifactAggregationDependencies {
  protectionVerifiers?: readonly Phase74ProtectionSuiteVerifier[];
}

export interface Phase74StageDiagnosticAggregationInput {
  bootstrapSamples?: number;
  runDirectories: readonly string[];
  seed?: number;
  stage: RetrievalStage;
}

export interface Phase74StageAggregation {
  aggregate: Phase74ReplicateAggregation;
  benchmark: Phase74BenchmarkFamily;
  caseCount: number;
  clusterCount: number;
  experimentIdentityHash: string;
  latency: {
    baselineP95Ms: number;
    candidateP95Ms: number;
    sampleCountPerArm: number;
  };
  modelUsage: Phase74ModelUsageEvidence;
  perCase: Array<{
    baselineMean: number;
    candidateMean: number;
    caseId: string;
    clusterId: string;
    delta: number;
    replicateDeltas: [number, number, number];
  }>;
  renderedContextMaxTokens: number;
  replicateStability: {
    deltas: [number, number, number];
    direction:
      | "consistent_negative"
      | "consistent_positive"
      | "mixed"
      | "stable_zero";
  };
  runIds: [string, string, string];
  stage: RetrievalStage;
}

export interface Phase74ArtifactAggregationReport {
  e4: {
    formats: Array<{
      averageTokens: number | null;
      eligible: boolean | null;
      format: EvidenceLedgerFormat;
      macroScore: number | null;
      minimumProtectionDelta: number | null;
    }>;
    gaps: string[];
    selectedFormat: EvidenceLedgerFormat | "not_evaluable";
    status: "evaluated" | "not_evaluable";
  };
  inputs: {
    protectionArtifactSha256: string | null;
    runs: Array<{
      benchmark: Phase74BenchmarkFamily;
      experimentIdentityHash: string;
      identityHash: string;
      replicate: Replicate;
      runDirectory: string;
      runId: string;
    }>;
  };
  promotion: {
    gaps: string[];
    input?: Phase74PromotionGateInput;
    result?: Phase74PromotionGateResult;
    stage: RetrievalStage | null;
    status: "evaluated" | "not_evaluable";
  };
  schemaVersion: 1;
  stageAggregations: Phase74StageAggregation[];
}

export interface Phase74StageDiagnosticAggregationReport {
  aggregation: Phase74StageAggregation;
  evidenceBoundary: "seen-case-stage-ablation-diagnostic";
  inputs: Array<{
    experimentIdentityHash: string;
    identityHash: string;
    replicate: Replicate;
    runDirectory: string;
    runId: string;
  }>;
  kind: "phase74-stage-only-diagnostic";
  promotionEvaluated: false;
  reason: "A selected single-stage ablation cannot authorize product promotion.";
  schemaVersion: 1;
  seenCasesOnly: true;
  status: "not_evaluable_for_promotion";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Phase 74 ${label} must be a JSON object.`);
  }
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Phase 74 ${label} must be a non-empty string.`);
  }
  return value;
}

function sha256Value(value: unknown, label: string): string {
  const result = stringValue(value, label);
  if (!/^[a-f0-9]{64}$/u.test(result)) {
    throw new Error(`Phase 74 ${label} must be a lowercase SHA-256.`);
  }
  return result;
}

function integerValue(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Phase 74 ${label} must be a non-negative integer.`);
  }
  return Number(value);
}

function positiveIntegerValue(value: unknown, label: string): number {
  const result = integerValue(value, label);
  if (result === 0) {
    throw new Error(`Phase 74 ${label} must be greater than zero.`);
  }
  return result;
}

function finiteValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Phase 74 ${label} must be a finite number.`);
  }
  return value;
}

function unitValue(value: unknown, label: string): number {
  const result = finiteValue(value, label);
  if (result < 0 || result > 1) {
    throw new Error(`Phase 74 ${label} must be between 0 and 1.`);
  }
  return result;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Phase 74 ${label} must be boolean.`);
  }
  return value;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw new Error(
      `Phase 74 ${label} contains unsupported field(s): ${unexpected.join(", ")}.`,
    );
  }
}

function parseEvaluationAttribution(
  value: unknown,
  input: {
    expectedArms: ReadonlySet<string>;
    label: string;
  },
): Phase74EvaluationAttribution {
  const attribution = recordValue(value, input.label);
  assertExactKeys(attribution, [
    "inputSha256",
    "observedAnswer",
    "observedCorrect",
    "observedScore",
    "reused",
    "sourceArm",
    "sourceSnapshotId",
  ], input.label);
  const sourceArm = stringValue(
    attribution.sourceArm,
    `${input.label} sourceArm`,
  );
  if (!input.expectedArms.has(sourceArm)) {
    throw new Error(`Phase 74 ${input.label} contains unknown source arm ${sourceArm}.`);
  }
  return {
    inputSha256: sha256Value(
      attribution.inputSha256,
      `${input.label} inputSha256`,
    ),
    observedAnswer: stringValue(
      attribution.observedAnswer,
      `${input.label} observedAnswer`,
    ),
    observedCorrect: booleanValue(
      attribution.observedCorrect,
      `${input.label} observedCorrect`,
    ),
    observedScore: unitValue(
      attribution.observedScore,
      `${input.label} observedScore`,
    ),
    reused: booleanValue(attribution.reused, `${input.label} reused`),
    sourceArm,
    sourceSnapshotId: sha256Value(
      attribution.sourceSnapshotId,
      `${input.label} sourceSnapshotId`,
    ),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertAggregationAdmission(input: {
  benchmark: Phase74BenchmarkFamily;
  dataset: DatasetManifestEvidence;
  datasetManifest: unknown;
  identity: EvalRunIdentity;
  rerankerAdmission?: "provider" | "recorded";
}): {
  selectedCaseKeysSha256: string;
  selectionMode: "all" | "deterministic-content-hash-v2";
} {
  const configuration = input.identity.configuration;
  const missing = [
    "dataset",
    "embedding",
    "evaluatorSource",
    "protectionBlueprint",
    "providerObjectCalls",
    "reranker",
    "scoring",
    "selection",
    "selectedCaseIdsSha256",
  ]
    .filter((field) => configuration[field] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Phase 74 aggregation admission is missing ${missing.join(", ")}.`,
    );
  }
  if (stableJson(configuration.dataset) !== stableJson(input.datasetManifest)) {
    throw new Error("Phase 74 aggregation admission dataset manifest drifted.");
  }
  if (
    sha256Value(
      configuration.selectedCaseIdsSha256,
      "aggregation admission selectedCaseIdsSha256",
    ) !== input.dataset.selectedCaseIdsSha256
  ) {
    throw new Error("Phase 74 aggregation admission selected population drifted.");
  }

  const providerReranker = {
    ...input.identity.answerModel,
    implementation: "provider-listwise-v1",
    mode: "provider",
  };
  const deterministicReranker = {
    implementation: "lexical-coverage-v1",
    mode: "deterministic",
  };
  const recordedReranker = recordValue(
    configuration.reranker,
    "aggregation admission reranker",
  );
  const expectedReranker = input.rerankerAdmission === "recorded" &&
      stableJson(recordedReranker) === stableJson(deterministicReranker)
    ? deterministicReranker
    : providerReranker;
  assertPhase74ExperimentIdentityContract({
    benchmark: input.benchmark,
    configuration,
    dataset: input.datasetManifest,
    expectedReranker,
    judgeModel: input.identity.judgeModel,
  });
  const selection = recordValue(
    configuration.selection,
    "aggregation admission selection",
  );
  const mode = stringValue(selection.mode, "aggregation admission selection mode");
  if (mode !== "all" && mode !== "deterministic-content-hash-v2") {
    throw new Error("Phase 74 aggregation admission selection mode is unsupported.");
  }
  assertExactKeys(selection, [
    "mode",
    "populationContentSha256",
    "populationSize",
    ...(mode === "deterministic-content-hash-v2" ? ["seed"] : []),
    "selectedCaseIdsSha256",
    "selectedCaseKeysSha256",
    "selectedSize",
  ], "aggregation admission selection");
  sha256Value(
    selection.populationContentSha256,
    "aggregation admission populationContentSha256",
  );
  const populationSize = positiveIntegerValue(
    selection.populationSize,
    "aggregation admission populationSize",
  );
  const selectedSize = positiveIntegerValue(
    selection.selectedSize,
    "aggregation admission selectedSize",
  );
  const selectionCaseIdsSha256 = sha256Value(
    selection.selectedCaseIdsSha256,
    "aggregation admission selection selectedCaseIdsSha256",
  );
  if (
    selectedSize !== input.dataset.caseCount ||
    selectedSize > populationSize ||
    selectionCaseIdsSha256 !== input.dataset.selectedCaseIdsSha256
  ) {
    throw new Error("Phase 74 aggregation admission selection population drifted.");
  }
  if (mode === "all" && selectedSize !== populationSize) {
    throw new Error("Phase 74 aggregation admission all-selection is incomplete.");
  }
  if (mode === "deterministic-content-hash-v2") {
    integerValue(selection.seed, "aggregation admission selection seed");
  }
  return {
    selectedCaseKeysSha256: sha256Value(
      selection.selectedCaseKeysSha256,
      "aggregation admission selectedCaseKeysSha256",
    ),
    selectionMode: mode,
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function p95(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("Phase 74 latency evidence must contain at least one sample.");
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

async function readJson(path: string, label: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Phase 74 cannot read ${label} at ${path}.`, {
      cause: error,
    });
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Phase 74 ${label} at ${path} is not valid JSON.`, {
      cause: error,
    });
  }
}

async function readJsonLines(path: string, label: string): Promise<unknown[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Phase 74 cannot read ${label} at ${path}.`, {
      cause: error,
    });
  }
  const lines = raw.endsWith("\n") ? raw.slice(0, -1).split("\n") : raw.split("\n");
  if (lines.length === 0 || lines.some((line) => line.trim() === "")) {
    throw new Error(`Phase 74 ${label} at ${path} contains an empty JSONL row.`);
  }
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(
        `Phase 74 ${label} at ${path} has invalid JSON on line ${index + 1}.`,
        { cause: error },
      );
    }
  });
}

async function readText(path: string, label: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Phase 74 cannot read ${label} at ${path}.`, {
      cause: error,
    });
  }
}

async function loadVerifiedSealedStage(input: {
  base: RunBaseArtifact;
  expectedE3Artifact?: Phase74UnscoredExecutionArtifact;
  stage: ExperimentStage;
}): Promise<VerifiedSealedStage> {
  const prefix = input.stage.toLowerCase();
  const evidenceDirectory = join(
    input.base.runDirectory,
    "sealed-evidence",
    prefix,
  );
  const [
    artifactRaw,
    executionValue,
    escrowValue,
    executorOutputValue,
    receiptValue,
    processManifestValue,
  ] = await Promise.all([
    readText(
      join(input.base.runDirectory, `${prefix}-executor-artifact.json`),
      `${input.stage} sealed executor artifact`,
    ),
    readJson(
      join(evidenceDirectory, "execution.json"),
      `${input.stage} sealed execution`,
    ),
    readJson(
      join(evidenceDirectory, "escrow.json"),
      `${input.stage} sealed escrow`,
    ),
    readJson(
      join(evidenceDirectory, "executor-output.json"),
      `${input.stage} sealed executor output`,
    ),
    readJson(
      join(evidenceDirectory, "score-receipt.json"),
      `${input.stage} sealed score receipt`,
    ),
    readJson(
      join(input.base.runDirectory, `${prefix}-process-manifest.json`),
      `${input.stage} sealed process manifest`,
    ),
  ]);
  let artifactValue: unknown;
  try {
    artifactValue = JSON.parse(artifactRaw) as unknown;
  } catch (error) {
    throw new Error(`Phase 74 ${input.stage} sealed executor artifact is not valid JSON.`, {
      cause: error,
    });
  }
  const artifact = parsePhase74UnscoredArtifact(artifactValue);
  const execution = parsePhase74SealedExecutionBundle(executionValue);
  const escrow = parsePhase74SealedEscrowBundle(escrowValue);
  const executorOutput = parsePhase74SealedExecutorOutput(executorOutputValue);
  const receipt = parsePhase74SealedScoreReceipt(receiptValue);
  if (artifactRaw !== serializePhase74UnscoredArtifact(artifact)) {
    throw new Error(
      `Phase 74 ${input.stage} sealed executor artifact bytes are not canonical.`,
    );
  }
  verifyPhase74SealedScoreReceipt({
    escrow,
    execution,
    executorOutput,
    receipt,
  });
  verifyPhase74SealedProcessManifest({
    execution,
    executorOutput,
    manifest: processManifestValue,
    receipt,
  });
  const caseConcurrency = positiveIntegerValue(
    input.base.identity.configuration.caseConcurrency,
    `${input.stage} sealed caseConcurrency`,
  );
  const originalCaseIds = escrow.cases.map(({ originalCaseId }) =>
    originalCaseId
  );
  const caseKeys = execution.cases.map(({ caseKey }) => caseKey);
  if (
    execution.runId !== input.base.identity.runId ||
    escrow.runId !== input.base.identity.runId ||
    execution.stage !== input.stage ||
    artifact.stage !== input.stage ||
    artifact.runId !== input.base.identity.runId ||
    execution.caseConcurrency !== caseConcurrency ||
    execution.configurationSha256 !== sha256Phase74SealedConfiguration({
      caseConcurrency,
    }) ||
    execution.cases.length !== input.base.dataset.caseCount ||
    escrow.cases.length !== input.base.dataset.caseCount ||
    sha256(JSON.stringify(originalCaseIds)) !==
      input.base.dataset.selectedCaseIdsSha256 ||
    sha256(JSON.stringify([...caseKeys].sort())) !==
      input.base.selectedCaseKeysSha256 ||
    escrow.cases.some(({ family }) => family !== input.base.benchmark)
  ) {
    throw new Error(
      `Phase 74 ${input.stage} sealed stage identity or population drifted.`,
    );
  }

  const reportRaw = await readJson(
    join(input.base.runDirectory, `${prefix}-report.json`),
    `${input.stage} sealed materialized report`,
  );
  let oracleRaw: string | undefined;
  if (input.stage === "E4") {
    if (input.expectedE3Artifact === undefined) {
      throw new Error("Phase 74 E4 sealed stage requires the verified E3 artifact.");
    }
    const [rootOracle, evidenceOracle] = await Promise.all([
      readText(
        join(input.base.runDirectory, "e4-oracle-artifact.json"),
        "E4 sealed root oracle artifact",
      ),
      readText(
        join(evidenceDirectory, "oracle-artifact.json"),
        "E4 sealed evidence oracle artifact",
      ),
    ]);
    if (rootOracle !== evidenceOracle) {
      throw new Error("Phase 74 E4 sealed oracle artifact copies drifted.");
    }
    oracleRaw = rootOracle;
  } else if (
    receipt.oracleSha256 !== undefined ||
    input.expectedE3Artifact !== undefined
  ) {
    throw new Error(`Phase 74 ${input.stage} sealed oracle boundary drifted.`);
  }
  const report = materializePhase74SealedReport({
    artifact,
    escrow,
    execution,
    executorOutput,
    ...(input.expectedE3Artifact === undefined
      ? {}
      : {
          expectedE3ArtifactSha256: sha256Phase74UnscoredArtifact(
            input.expectedE3Artifact,
          ),
        }),
    identity: input.base.identity,
    ...(oracleRaw === undefined ? {} : { oracleArtifact: oracleRaw }),
    receipt,
  });
  if (stableJson(reportRaw) !== stableJson(report)) {
    throw new Error(
      `Phase 74 ${input.stage} sealed materialized report drifted.`,
    );
  }
  const progress = await readJsonLines(
    join(input.base.runDirectory, `${prefix}-progress.jsonl`),
    `${input.stage} sealed materialized progress`,
  );
  const expectedProgress = input.stage === "E4"
    ? report.e4.cases
    : report.executions;
  if (stableJson(progress) !== stableJson(expectedProgress)) {
    throw new Error(
      `Phase 74 ${input.stage} sealed materialized progress drifted.`,
    );
  }
  if (input.stage === "E4") {
    const oracleMatrix = await readJsonLines(
      join(input.base.runDirectory, "oracle-matrix.jsonl"),
      "E4 sealed oracle matrix",
    );
    if (stableJson(oracleMatrix) !== stableJson(report.oracle)) {
      throw new Error("Phase 74 E4 sealed oracle matrix drifted.");
    }
  } else {
    const packets = await readJsonLines(
      join(input.base.runDirectory, `${prefix}-retrieval-packets.jsonl`),
      `${input.stage} sealed materialized retrieval packets`,
    );
    const expectedPackets = materializePhase74SealedRetrievalSnapshots({
      artifact,
      report,
    });
    if (stableJson(packets) !== stableJson(expectedPackets)) {
      throw new Error(
        `Phase 74 ${input.stage} sealed materialized retrieval packets drifted.`,
      );
    }
  }
  return { artifact, escrow, execution, executorOutput, receipt };
}

async function loadRequiredModelUsageLedger(input: {
  eventsPath: string;
  intentsPath: string;
  label: string;
}): Promise<Phase74ModelUsageLedger> {
  try {
    await Promise.all([
      readFile(input.eventsPath, "utf8"),
      readFile(input.intentsPath, "utf8"),
    ]);
  } catch (error) {
    throw new Error(`Phase 74 cannot read ${input.label} usage ledger.`, {
      cause: error,
    });
  }
  return loadPhase74ModelUsageLedger({
    eventsPath: input.eventsPath,
    intentsPath: input.intentsPath,
  });
}

function parseDatasetManifest(value: unknown): DatasetManifestEvidence {
  const manifest = recordValue(value, "dataset manifest");
  const benchmark = stringValue(manifest.benchmark, "dataset benchmark");
  if (benchmark !== "locomo" && benchmark !== "longmemeval") {
    throw new Error(`Phase 74 dataset benchmark ${benchmark} is unsupported.`);
  }
  if (manifest.schemaVersion !== 2) {
    throw new Error("Phase 74 dataset manifest schemaVersion must be 2.");
  }
  return {
    benchmark,
    caseCount: positiveIntegerValue(manifest.caseCount, "dataset caseCount"),
    datasetSha256: sha256Value(
      manifest.datasetSha256,
      "dataset datasetSha256",
    ),
    selectedCaseIdsSha256: sha256Value(
      manifest.selectedCaseIdsSha256,
      "dataset selectedCaseIdsSha256",
    ),
  };
}

function parseIdentity(value: unknown): {
  experimentIdentityHash: string;
  identity: EvalRunIdentity;
  identityHash: string;
} {
  const identity = value as EvalRunIdentity;
  return {
    experimentIdentityHash: hashEvalExperimentIdentity(identity),
    identity,
    identityHash: hashEvalRunIdentity(identity),
  };
}

function parseReplicate(value: unknown, label: string): Replicate {
  if (value !== 1 && value !== 2 && value !== 3) {
    throw new Error(`Phase 74 ${label} must be 1, 2, or 3.`);
  }
  return value;
}

function parseModelUsageBranch(
  value: unknown,
  label: string,
): Phase74ModelUsageBranchEvidence {
  const branch = recordValue(value, `${label} model usage`);
  assertExactKeys(branch, [
    "answerGenerationCaseCount",
    "caseIdsSha256",
    "completeRequestCount",
    "logicalCaseCount",
    "missingRequestCount",
    "operationCounts",
    "partialRequestCount",
    "pendingRequestCount",
    "requestCount",
    "totalTokens",
    "unobservedCaseIds",
  ], `${label} model usage`);
  const operationCountsRecord = recordValue(
    branch.operationCounts,
    `${label} operationCounts`,
  );
  const operationCounts = Object.fromEntries(
    Object.entries(operationCountsRecord).map(([operation, count]) => {
      if (!MODEL_USAGE_OPERATIONS.has(operation)) {
        throw new Error(
          `Phase 74 ${label} operationCounts contains unsupported operation ${operation}.`,
        );
      }
      return [
        operation,
        integerValue(count, `${label} operationCounts.${operation}`),
      ];
    }),
  );
  if (!Array.isArray(branch.unobservedCaseIds)) {
    throw new Error(`Phase 74 ${label} unobservedCaseIds must be an array.`);
  }
  const unobservedCaseIds = branch.unobservedCaseIds.map((caseId) =>
    stringValue(caseId, `${label} unobservedCaseIds`)
  );
  if (new Set(unobservedCaseIds).size !== unobservedCaseIds.length) {
    throw new Error(`Phase 74 ${label} unobservedCaseIds contains duplicates.`);
  }
  const parsed = {
    answerGenerationCaseCount: integerValue(
      branch.answerGenerationCaseCount,
      `${label} answerGenerationCaseCount`,
    ),
    caseIdsSha256: sha256Value(branch.caseIdsSha256, `${label} caseIdsSha256`),
    completeRequestCount: integerValue(
      branch.completeRequestCount,
      `${label} completeRequestCount`,
    ),
    logicalCaseCount: integerValue(
      branch.logicalCaseCount,
      `${label} logicalCaseCount`,
    ),
    missingRequestCount: integerValue(
      branch.missingRequestCount,
      `${label} missingRequestCount`,
    ),
    operationCounts,
    partialRequestCount: integerValue(
      branch.partialRequestCount,
      `${label} partialRequestCount`,
    ),
    pendingRequestCount: integerValue(
      branch.pendingRequestCount,
      `${label} pendingRequestCount`,
    ),
    requestCount: integerValue(branch.requestCount, `${label} requestCount`),
    totalTokens: finiteValue(branch.totalTokens, `${label} totalTokens`),
    unobservedCaseIds,
  };
  if (parsed.totalTokens < 0) {
    throw new Error(`Phase 74 ${label} totalTokens cannot be negative.`);
  }
  const operationRequestCount = Object.values(parsed.operationCounts).reduce(
    (total, count) => total + (count ?? 0),
    0,
  );
  if (
    operationRequestCount !== parsed.requestCount ||
    parsed.completeRequestCount + parsed.partialRequestCount +
        parsed.missingRequestCount + parsed.pendingRequestCount !==
      parsed.requestCount
  ) {
    throw new Error(`Phase 74 ${label} model usage counts are inconsistent.`);
  }
  return parsed;
}

function parseModelUsagePool(
  value: unknown,
  label: string,
): Phase74ModelUsagePoolEvidence {
  const pool = recordValue(value, `${label} model usage`);
  assertExactKeys(pool, [
    "completeRequestCount",
    "keyCount",
    "keysSha256",
    "missingRequestCount",
    "operationCounts",
    "partialRequestCount",
    "pendingRequestCount",
    "requestCount",
    "totalTokens",
  ], `${label} model usage`);
  const operationCountsRecord = recordValue(
    pool.operationCounts,
    `${label} operationCounts`,
  );
  const operationCounts = Object.fromEntries(
    Object.entries(operationCountsRecord).map(([operation, count]) => {
      if (!MODEL_USAGE_OPERATIONS.has(operation)) {
        throw new Error(
          `Phase 74 ${label} operationCounts contains unsupported operation ${operation}.`,
        );
      }
      return [
        operation,
        integerValue(count, `${label} operationCounts.${operation}`),
      ];
    }),
  );
  const parsed: Phase74ModelUsagePoolEvidence = {
    completeRequestCount: integerValue(
      pool.completeRequestCount,
      `${label} completeRequestCount`,
    ),
    keyCount: integerValue(pool.keyCount, `${label} keyCount`),
    keysSha256: sha256Value(pool.keysSha256, `${label} keysSha256`),
    missingRequestCount: integerValue(
      pool.missingRequestCount,
      `${label} missingRequestCount`,
    ),
    operationCounts,
    partialRequestCount: integerValue(
      pool.partialRequestCount,
      `${label} partialRequestCount`,
    ),
    pendingRequestCount: integerValue(
      pool.pendingRequestCount,
      `${label} pendingRequestCount`,
    ),
    requestCount: integerValue(pool.requestCount, `${label} requestCount`),
    totalTokens: integerValue(pool.totalTokens, `${label} totalTokens`),
  };
  const operationRequestCount = Object.values(parsed.operationCounts).reduce(
    (total, count) => total + (count ?? 0),
    0,
  );
  if (
    operationRequestCount !== parsed.requestCount ||
    parsed.completeRequestCount + parsed.partialRequestCount +
        parsed.missingRequestCount + parsed.pendingRequestCount !==
      parsed.requestCount
  ) {
    throw new Error(`Phase 74 ${label} model usage counts are inconsistent.`);
  }
  return parsed;
}

function parseModelUsage(value: unknown): Phase74ModelUsageEvidence {
  const usage = recordValue(value, "model usage summary");
  assertExactKeys(usage, [
    "accountingVersion",
    "allocationPolicy",
    "baseline",
    "candidate",
    "costBoundary",
    "ingestion",
  ], "model usage summary");
  if (usage.accountingVersion !== PHASE74_MODEL_USAGE_ACCOUNTING_VERSION) {
    throw new Error(
      `Phase 74 model usage accountingVersion must be ${PHASE74_MODEL_USAGE_ACCOUNTING_VERSION}.`,
    );
  }
  if (usage.allocationPolicy !== PHASE74_MODEL_USAGE_ALLOCATION_POLICY) {
    throw new Error(
      `Phase 74 model usage allocationPolicy must be ${PHASE74_MODEL_USAGE_ALLOCATION_POLICY}.`,
    );
  }
  if (usage.costBoundary !== "full-product") {
    throw new Error("Phase 74 model usage costBoundary must be full-product.");
  }
  const ingestion = recordValue(usage.ingestion, "ingestion model usage");
  assertExactKeys(ingestion, [
    "baselineExclusive",
    "candidateExclusive",
    "shared",
  ], "ingestion model usage");
  return {
    accountingVersion: PHASE74_MODEL_USAGE_ACCOUNTING_VERSION,
    allocationPolicy: PHASE74_MODEL_USAGE_ALLOCATION_POLICY,
    baseline: parseModelUsageBranch(usage.baseline, "baseline"),
    candidate: parseModelUsageBranch(usage.candidate, "candidate"),
    costBoundary: "full-product",
    ingestion: {
      baselineExclusive: parseModelUsagePool(
        ingestion.baselineExclusive,
        "baselineExclusive ingestion",
      ),
      candidateExclusive: parseModelUsagePool(
        ingestion.candidateExclusive,
        "candidateExclusive ingestion",
      ),
      shared: parseModelUsagePool(
        ingestion.shared,
        "shared ingestion",
      ),
    },
  };
}

function parseCallBudgetEvidence(
  value: unknown,
  label: string,
): CallBudgetEvidence {
  const budget = recordValue(value, label);
  assertExactKeys(budget, [
    "embeddingCalls",
    "embeddingInputByteUpperBound",
    "embeddingSpendLimitUsd",
    "languageCalls",
    "maxLanguageCalls",
    "schemaVersion",
  ], label);
  if (budget.schemaVersion !== 1) {
    throw new Error(`Phase 74 ${label} schemaVersion must be 1.`);
  }
  const embeddingSpendLimitUsd = finiteValue(
    budget.embeddingSpendLimitUsd,
    `${label} embeddingSpendLimitUsd`,
  );
  if (embeddingSpendLimitUsd <= 0) {
    throw new Error(`Phase 74 ${label} embeddingSpendLimitUsd must be positive.`);
  }
  const parsed: CallBudgetEvidence = {
    embeddingCalls: integerValue(budget.embeddingCalls, `${label} embeddingCalls`),
    embeddingInputByteUpperBound: integerValue(
      budget.embeddingInputByteUpperBound,
      `${label} embeddingInputByteUpperBound`,
    ),
    embeddingSpendLimitUsd,
    languageCalls: integerValue(budget.languageCalls, `${label} languageCalls`),
    maxLanguageCalls: positiveIntegerValue(
      budget.maxLanguageCalls,
      `${label} maxLanguageCalls`,
    ),
    schemaVersion: 1,
  };
  if (parsed.languageCalls > parsed.maxLanguageCalls) {
    throw new Error(`Phase 74 ${label} exceeds its language call limit.`);
  }
  return parsed;
}

function parseSummaryBase(input: {
  benchmark: Phase74BenchmarkFamily;
  experimentIdentityHash: string;
  identityHash: string;
  replicate: Replicate;
  stage: ExperimentStage;
  value: unknown;
}) {
  const summary = recordValue(input.value, `${input.stage} summary`);
  assertExactKeys(summary, [
    "benchmark",
    "callBudget",
    "caseCount",
    "comparison",
    "endToEndScores",
    "executionFailures",
    "experimentIdentityHash",
    "identityHash",
    "modelUsage",
    "renderedContextMaxTokens",
    "replicate",
    "stage",
    "status",
  ], `${input.stage} summary`);
  if (summary.benchmark !== input.benchmark || summary.stage !== input.stage) {
    throw new Error(`Phase 74 ${input.stage} summary benchmark/stage drift.`);
  }
  if (summary.status !== "not_evaluable") {
    throw new Error(`Phase 74 ${input.stage} source summary must be diagnostic.`);
  }
  if (summary.identityHash !== input.identityHash) {
    throw new Error(`Phase 74 ${input.stage} summary run identity hash drift.`);
  }
  if (summary.experimentIdentityHash !== input.experimentIdentityHash) {
    throw new Error(
      `Phase 74 ${input.stage} summary experiment identity hash drift.`,
    );
  }
  if (parseReplicate(summary.replicate, `${input.stage} replicate`) !== input.replicate) {
    throw new Error(`Phase 74 ${input.stage} summary replicate drift.`);
  }
  return {
    callBudget: parseCallBudgetEvidence(
      summary.callBudget,
      `${input.stage} summary callBudget`,
    ),
    caseCount: positiveIntegerValue(summary.caseCount, `${input.stage} caseCount`),
    comparison: summary.comparison,
    endToEndScores: recordValue(
      summary.endToEndScores,
      `${input.stage} endToEndScores`,
    ),
    executionFailures: integerValue(
      summary.executionFailures,
      `${input.stage} executionFailures`,
    ),
    modelUsage: summary.modelUsage,
    renderedContextMaxTokens: integerValue(
      summary.renderedContextMaxTokens,
      `${input.stage} renderedContextMaxTokens`,
    ),
  };
}

function parseComparison(
  value: unknown,
  input: {
    benchmark: Phase74BenchmarkFamily;
    selectedCaseIdsSha256: string;
    stage: RetrievalStage;
  },
): Phase74ReplicateComparison {
  const comparison = recordValue(value, `${input.stage} comparison`);
  assertExactKeys(comparison, [
    "baselineArm",
    "benchmark",
    "candidateArm",
    "selectedCaseIdsSha256",
    "stage",
  ], `${input.stage} comparison`);
  const expected = buildPhase74ReplicateComparison(input);
  if (stableJson(comparison) !== stableJson(expected)) {
    throw new Error(
      `Phase 74 ${input.stage} comparison arms or identity drifted.`,
    );
  }
  return expected;
}

function parseRetrievalProgress(
  values: readonly unknown[],
  input: {
    caseCount: number;
    comparison: Phase74ReplicateComparison;
    expectedConfigurations: Readonly<Record<string, EvalRunJsonObject>>;
    selectedCaseIdsSha256: string;
    stage: RetrievalStage;
  },
): RetrievalProgressRow[] {
  const expectedArms = new Set<string>(PHASE74_EXPERIMENT_ARMS[input.stage]);
  const rows = values.map((value, index): RetrievalProgressRow => {
    const row = recordValue(value, `${input.stage} progress row ${index + 1}`);
    if (row.executionError !== undefined) {
      throw new Error(
        `Phase 74 ${input.stage} progress contains executionError for ${String(row.caseId)}.`,
      );
    }
    const arm = stringValue(row.arm, `${input.stage} progress arm`);
    if (!expectedArms.has(arm)) {
      throw new Error(`Phase 74 ${input.stage} progress contains unknown arm ${arm}.`);
    }
    if (row.stage !== input.stage) {
      throw new Error(`Phase 74 ${input.stage} progress stage drift.`);
    }
    if (
      stableJson(row.configuration) !==
        stableJson(input.expectedConfigurations[arm])
    ) {
      throw new Error(
        `Phase 74 ${input.stage}/${arm} progress configuration drift.`,
      );
    }
    return {
      answer: stringValue(row.answer, `${input.stage} progress answer`),
      answerLatencyMs: finiteValue(
        row.answerLatencyMs,
        `${input.stage} progress answerLatencyMs`,
      ),
      arm,
      caseId: stringValue(row.caseId, `${input.stage} progress caseId`),
      clusterId: stringValue(
        row.clusterId,
        `${input.stage} progress clusterId`,
      ),
      contextTokens: integerValue(
        row.contextTokens,
        `${input.stage} progress contextTokens`,
      ),
      contextTokensBeforeTruncation: integerValue(
        row.contextTokensBeforeTruncation,
        `${input.stage} progress contextTokensBeforeTruncation`,
      ),
      contextTruncated: booleanValue(
        row.contextTruncated,
        `${input.stage} progress contextTruncated`,
      ),
      correct: booleanValue(row.correct, `${input.stage} progress correct`),
      ...(row.evaluationAttribution === undefined
        ? {}
        : {
            evaluationAttribution: parseEvaluationAttribution(
              row.evaluationAttribution,
              {
                expectedArms,
                label: `${input.stage} progress evaluationAttribution`,
              },
            ),
          }),
      productLatencyMs: finiteValue(
        row.productLatencyMs,
        `${input.stage} progress productLatencyMs`,
      ),
      recallLatencyMs: finiteValue(
        row.recallLatencyMs,
        `${input.stage} progress recallLatencyMs`,
      ),
      score: unitValue(row.score, `${input.stage} progress score`),
      snapshotId: sha256Value(
        row.snapshotId,
        `${input.stage} progress snapshotId`,
      ),
      stage: input.stage,
    };
  });
  if (rows.some((row) =>
    row.answerLatencyMs < 0 ||
    row.productLatencyMs < 0 ||
    row.recallLatencyMs < 0 ||
    row.contextTokensBeforeTruncation < row.contextTokens
  )) {
    throw new Error(`Phase 74 ${input.stage} progress metrics are invalid.`);
  }
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.caseId}\0${row.arm}`;
    if (seen.has(key)) {
      throw new Error(`Phase 74 ${input.stage} progress contains duplicate ${row.caseId}/${row.arm}.`);
    }
    seen.add(key);
  }
  const attributedRows = rows.filter(
    ({ evaluationAttribution }) => evaluationAttribution !== undefined,
  );
  if (attributedRows.length !== 0 && attributedRows.length !== rows.length) {
    throw new Error(
      `Phase 74 ${input.stage} progress evaluation attribution population drift.`,
    );
  }
  if (attributedRows.length > 0) {
    const byInput = new Map<string, RetrievalProgressRow[]>();
    for (const row of attributedRows) {
      const attribution = row.evaluationAttribution!;
      const key = `${row.caseId}\0${attribution.inputSha256}`;
      byInput.set(key, [...(byInput.get(key) ?? []), row]);
    }
    for (const group of byInput.values()) {
      const source = group.find(({ evaluationAttribution }) =>
        evaluationAttribution?.reused === false
      );
      if (
        !source ||
        group.filter(({ evaluationAttribution }) =>
          evaluationAttribution?.reused === false
        ).length !== 1 ||
        source.evaluationAttribution?.sourceArm !== source.arm ||
        source.evaluationAttribution.sourceSnapshotId !== source.snapshotId
      ) {
        throw new Error(
          `Phase 74 ${input.stage} progress evaluation attribution source drift.`,
        );
      }
      for (const row of group) {
        const attribution = row.evaluationAttribution!;
        if (
          attribution.sourceArm !== source.arm ||
          attribution.sourceSnapshotId !== source.snapshotId ||
          row.answer !== source.answer ||
          row.correct !== source.correct ||
          row.score !== source.score
        ) {
          throw new Error(
            `Phase 74 ${input.stage} progress identical reader input assessment drift.`,
          );
        }
      }
    }
  }
  const baselineRows = rows.filter(
    ({ arm }) => arm === input.comparison.baselineArm,
  );
  if (baselineRows.length !== input.caseCount) {
    throw new Error(`Phase 74 ${input.stage} progress case population mismatch.`);
  }
  const caseIds = baselineRows.map(({ caseId }) => caseId);
  if (new Set(caseIds).size !== caseIds.length) {
    throw new Error(`Phase 74 ${input.stage} progress contains duplicate case IDs.`);
  }
  if (sha256(JSON.stringify(caseIds)) !== input.selectedCaseIdsSha256) {
    throw new Error(`Phase 74 ${input.stage} selected case population digest drift.`);
  }
  const baselineByCase = new Map(baselineRows.map((row) => [row.caseId, row]));
  for (const arm of expectedArms) {
    const armRows = rows.filter((row) => row.arm === arm);
    if (armRows.length !== caseIds.length) {
      throw new Error(`Phase 74 ${input.stage}/${arm} case population mismatch.`);
    }
    for (const [index, row] of armRows.entries()) {
      const caseId = caseIds[index];
      const baseline = caseId === undefined ? undefined : baselineByCase.get(caseId);
      if (row.caseId !== caseId || baseline?.clusterId !== row.clusterId) {
        throw new Error(
          `Phase 74 ${input.stage}/${arm} case or cluster population drift.`,
        );
      }
    }
  }
  return rows;
}

function validateEndToEndScores(input: {
  endToEndScores: Record<string, unknown>;
  rows: readonly RetrievalProgressRow[];
  stage: RetrievalStage;
}): void {
  const expectedArms = PHASE74_EXPERIMENT_ARMS[input.stage];
  if (
    Object.keys(input.endToEndScores).sort().join("\0") !==
    [...expectedArms].sort().join("\0")
  ) {
    throw new Error(`Phase 74 ${input.stage} endToEndScores arm population drift.`);
  }
  for (const arm of expectedArms) {
    const summary = recordValue(
      input.endToEndScores[arm],
      `${input.stage}/${arm} endToEndScores`,
    );
    const rows = input.rows.filter((row) => row.arm === arm);
    const expectedMean = mean(rows.map(({ score }) => score));
    const expectedAccuracy = rows.filter(({ correct }) => correct).length / rows.length;
    if (
      integerValue(summary.caseCount, `${input.stage}/${arm} caseCount`) !== rows.length ||
      integerValue(summary.scoredCaseCount, `${input.stage}/${arm} scoredCaseCount`) !== rows.length ||
      Math.abs(finiteValue(summary.meanFamilyScore, `${input.stage}/${arm} meanFamilyScore`) - expectedMean) > COMPARISON_TOLERANCE ||
      Math.abs(finiteValue(summary.semanticAccuracy, `${input.stage}/${arm} semanticAccuracy`) - expectedAccuracy) > COMPARISON_TOLERANCE
    ) {
      throw new Error(`Phase 74 ${input.stage}/${arm} endToEndScores drifted.`);
    }
  }
}

function validateProtocolScoreSemantics(input: {
  benchmark: Phase74BenchmarkFamily;
  rows: readonly RetrievalProgressRow[];
  stage: RetrievalStage;
}): void {
  const invalid = input.rows.some(({ correct, score }) =>
    input.benchmark === "locomo"
      ? correct !== (score === 1)
      : score !== Number(correct)
  );
  if (invalid) {
    throw new Error(
      `Phase 74 ${input.stage} ${input.benchmark} score/correctness drift.`,
    );
  }
}

function validateUsagePopulation(
  usage: Phase74ModelUsageEvidence,
  input: {
    caseCount: number;
    selectedCaseKeysSha256: string;
    stage: RetrievalStage;
  },
): void {
  for (const [branch, evidence] of [
    ["baseline", usage.baseline],
    ["candidate", usage.candidate],
  ] as const) {
    if (
      evidence.missingRequestCount > 0 ||
      evidence.partialRequestCount > 0 ||
      evidence.pendingRequestCount > 0
    ) {
      throw new Error(
        `Phase 74 ${input.stage} ${branch} has incomplete model usage.`,
      );
    }
    if (evidence.unobservedCaseIds.some(
      (caseId) => !/^case-[a-f0-9]{64}$/u.test(caseId),
    )) {
      throw new Error(
        `Phase 74 ${input.stage} ${branch} model usage contains a non-opaque unobserved case.`,
      );
    }
    if (
      evidence.caseIdsSha256 !== input.selectedCaseKeysSha256 ||
      evidence.logicalCaseCount !== input.caseCount ||
      evidence.answerGenerationCaseCount !== input.caseCount ||
      evidence.unobservedCaseIds.length !== 0
    ) {
      throw new Error(
        `Phase 74 ${input.stage} ${branch} model usage case population drift.`,
      );
    }
  }
}

async function validateRetrievalPackets(input: {
  comparison?: Phase74ReplicateComparison;
  expectedSnapshotIds: readonly string[];
  labelStage?: ExperimentStage;
  path: string;
  rows?: readonly RetrievalProgressRow[];
  stage: ExperimentStage;
}): Promise<Phase74RetrievalSnapshot[]> {
  const artifactStage = input.labelStage ?? input.stage;
  const packets = await readJsonLines(
    input.path,
    `${artifactStage} retrieval packets`,
  );
  const observed = packets.map((value, index) =>
    sha256Value(
      recordValue(value, `${artifactStage} retrieval packet ${index + 1}`).snapshotId,
      `${artifactStage} retrieval packet snapshotId`,
    )
  );
  if (
    observed.length !== input.expectedSnapshotIds.length ||
    observed.some((snapshotId, index) =>
      snapshotId !== input.expectedSnapshotIds[index]
    )
  ) {
    throw new Error(`Phase 74 ${artifactStage} retrieval packet population drift.`);
  }
  if (input.rows === undefined) {
    return packets.map((value, index) => {
      const packet = recordValue(
        value,
        `${artifactStage} retrieval packet ${index + 1}`,
      );
      if (!Array.isArray(packet.retrievedMemories) ||
        !Array.isArray(packet.storedMemories)) {
        throw new Error(
          `Phase 74 ${artifactStage} retrieval packet memories are invalid.`,
        );
      }
      return {
        retrievedMemories: packet.retrievedMemories,
        snapshotId: observed[index]!,
        storedMemories: packet.storedMemories,
      };
    });
  }
  if (input.stage === "E4") {
    throw new Error("Phase 74 E4 retrieval packets cannot contain paired rows.");
  }
  if (input.comparison === undefined) {
    throw new Error(`Phase 74 ${artifactStage} retrieval packet comparison is missing.`);
  }
  const snapshots: Phase74RetrievalSnapshot[] = [];
  for (const [index, packetValue] of packets.entries()) {
    const packet = recordValue(
      packetValue,
      `${artifactStage} retrieval packet ${index + 1}`,
    );
    const snapshotId = observed[index]!;
    const row = input.rows[index]!;
    const retrievedMemories = packet.retrievedMemories;
    const storedMemories = packet.storedMemories;
    if (!Array.isArray(retrievedMemories) || !Array.isArray(storedMemories)) {
      throw new Error(
        `Phase 74 ${artifactStage} retrieval packet memories are invalid.`,
      );
    }
    const evidenceLedger = packet.evidenceLedger;
    if (evidenceLedger !== undefined && !Array.isArray(evidenceLedger)) {
      throw new Error(
        `Phase 74 ${artifactStage} retrieval packet evidence ledger is invalid.`,
      );
    }
    const costTraceRecord = recordValue(
      packet.costTrace,
      `${artifactStage} retrieval packet cost trace`,
    );
    assertExactKeys(costTraceRecord, [
      "comparisonBranch",
      "ingestionKey",
      "representation",
    ], `${artifactStage} retrieval packet cost trace`);
    const parsedComparisonBranch = stringValue(
      costTraceRecord.comparisonBranch,
      `${artifactStage} retrieval packet comparisonBranch`,
    );
    if (
      parsedComparisonBranch !== "baseline" &&
      parsedComparisonBranch !== "candidate" &&
      parsedComparisonBranch !== "shadow"
    ) {
      throw new Error(`Phase 74 ${artifactStage} retrieval packet cost trace branch is invalid.`);
    }
    const comparisonBranch = parsedComparisonBranch;
    const expectedBranch = row.arm === input.comparison.baselineArm
      ? "baseline"
      : row.arm === input.comparison.candidateArm
        ? "candidate"
        : "shadow";
    if (comparisonBranch !== expectedBranch) {
      throw new Error(`Phase 74 ${artifactStage} retrieval packet cost trace branch drift.`);
    }
    const costTrace: NonNullable<Phase74RetrievalSnapshot["costTrace"]> = {
      comparisonBranch,
      ingestionKey: sha256Value(
        costTraceRecord.ingestionKey,
        `${artifactStage} retrieval packet ingestionKey`,
      ),
      representation: stringValue(
        costTraceRecord.representation,
        `${artifactStage} retrieval packet representation`,
      ),
    };
    const expectedSnapshotId = buildPhase74RetrievalSnapshotId({
      arm: row.arm,
      costTrace,
      evidenceLedger: evidenceLedger as Phase74RetrievalSnapshot["evidenceLedger"],
      evidenceLedgers: packet.evidenceLedgers,
      retrievedMemories,
      stage: input.stage,
      storedMemories,
    });
    if (expectedSnapshotId !== snapshotId) {
      throw new Error(`Phase 74 ${artifactStage} retrieval packet hash drift.`);
    }
    const evaluation = recordValue(
      packet.evaluation,
      `${artifactStage} retrieval packet evaluation`,
    );
    const expectedEvaluation = {
      answer: row.answer,
      answerLatencyMs: row.answerLatencyMs,
      ...(row.evaluationAttribution === undefined
        ? {}
        : { attribution: row.evaluationAttribution }),
      contextTokens: row.contextTokens,
      contextTokensBeforeTruncation: row.contextTokensBeforeTruncation,
      contextTruncated: row.contextTruncated,
      correct: row.correct,
      productLatencyMs: row.productLatencyMs,
      recallLatencyMs: row.recallLatencyMs,
      score: row.score,
    };
    if (stableJson(evaluation) !== stableJson(expectedEvaluation)) {
      throw new Error(
        `Phase 74 ${artifactStage} retrieval packet evaluation drift.`,
      );
    }
    snapshots.push({
      costTrace,
      ...(evidenceLedger === undefined
        ? {}
        : {
            evidenceLedger:
              evidenceLedger as unknown as NonNullable<
                Phase74RetrievalSnapshot["evidenceLedger"]
              >,
          }),
      evidenceLedgers: packet.evidenceLedgers as Phase74RetrievalSnapshot["evidenceLedgers"],
      retrievedMemories,
      snapshotId,
      storedMemories,
    });
  }
  return snapshots;
}

function parseE4Progress(values: readonly unknown[]): E4ProgressRow[] {
  const allowedFormats = new Set<EvidenceLedgerFormat>(EVIDENCE_LEDGER_FORMATS);
  const rows = values.map((value, index): E4ProgressRow => {
    const row = recordValue(value, `E4 progress row ${index + 1}`);
    const format = stringValue(row.format, "E4 progress format");
    if (!allowedFormats.has(format as EvidenceLedgerFormat)) {
      throw new Error(`Phase 74 E4 progress contains unknown format ${format}.`);
    }
    const score = row.score === undefined
      ? undefined
      : unitValue(row.score, "E4 progress score");
    return {
      caseId: stringValue(row.caseId, "E4 progress caseId"),
      clusterId: stringValue(row.clusterId, "E4 progress clusterId"),
      contextTokens: integerValue(row.contextTokens, "E4 progress contextTokens"),
      contextTokensBeforeTruncation: integerValue(
        row.contextTokensBeforeTruncation,
        "E4 progress contextTokensBeforeTruncation",
      ),
      contextTruncated: booleanValue(
        row.contextTruncated,
        "E4 progress contextTruncated",
      ),
      ...(typeof row.executionError === "string"
        ? { executionError: row.executionError }
        : {}),
      format: format as EvidenceLedgerFormat,
      renderedLedgerSha256: sha256Value(
        row.renderedLedgerSha256,
        "E4 progress renderedLedgerSha256",
      ),
      ...(score === undefined ? {} : { score }),
      sourceSnapshotId: sha256Value(
        row.sourceSnapshotId,
        "E4 progress sourceSnapshotId",
      ),
    };
  });
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.caseId}\0${row.format}`;
    if (seen.has(key)) {
      throw new Error(`Phase 74 E4 progress contains duplicate ${row.caseId}/${row.format}.`);
    }
    seen.add(key);
  }
  return rows;
}

function validateE4Population(input: {
  caseCount: number;
  rows: readonly E4ProgressRow[];
  selectedCaseIdsSha256: string;
}): void {
  const proseRows = input.rows.filter(({ format }) => format === "prose");
  const caseIds = proseRows.map(({ caseId }) => caseId);
  if (
    caseIds.length !== input.caseCount ||
    new Set(caseIds).size !== caseIds.length ||
    sha256(JSON.stringify(caseIds)) !== input.selectedCaseIdsSha256
  ) {
    throw new Error("Phase 74 E4 selected case population drift.");
  }
  for (const format of EVIDENCE_LEDGER_FORMATS) {
    const formatRows = input.rows.filter((row) => row.format === format);
    const formatCaseIds = formatRows.map(({ caseId }) => caseId);
    if (formatCaseIds.join("\0") !== caseIds.join("\0")) {
      throw new Error(`Phase 74 E4/${format} case population drift.`);
    }
    for (const [index, row] of formatRows.entries()) {
      if (row.clusterId !== proseRows[index]?.clusterId) {
        throw new Error(`Phase 74 E4/${format} cluster population drift.`);
      }
      if (row.sourceSnapshotId !== proseRows[index]?.sourceSnapshotId) {
        throw new Error("Phase 74 E4 format source snapshot drift.");
      }
    }
  }
}

function validateE4RenderedLedgers(input: {
  rows: readonly E4ProgressRow[];
  snapshots: readonly Phase74RetrievalSnapshot[];
}): void {
  const snapshotsById = new Map(
    input.snapshots.map((snapshot) => [snapshot.snapshotId, snapshot]),
  );
  for (const row of input.rows) {
    const ledger = snapshotsById.get(row.sourceSnapshotId)
      ?.evidenceLedgers?.[row.format];
    if (typeof ledger !== "string") {
      throw new Error("Phase 74 E4 source packet is missing a rendered ledger.");
    }
    const rendered = truncateRenderedContext({
      content: ledger,
      contextTokenBudget: PHASE74_CONTEXT_TOKEN_BUDGET,
      countRenderedTokens: (content) => Buffer.byteLength(content, "utf8"),
    });
    if (
      rendered.renderedContextTokens !== row.contextTokens ||
      rendered.renderedContextTokensBeforeTruncation !==
        row.contextTokensBeforeTruncation ||
      rendered.contextTruncated !== row.contextTruncated
    ) {
      throw new Error("Phase 74 E4 rendered ledger context metadata drift.");
    }
    if (sha256(rendered.content) !== row.renderedLedgerSha256) {
      throw new Error("Phase 74 E4 rendered ledger hash drift.");
    }
  }
}

async function loadRunBaseArtifact(
  runDirectory: string,
  rerankerAdmission: "provider" | "recorded",
): Promise<RunBaseArtifact> {
  const identityEvidence = parseIdentity(
    await readJson(join(runDirectory, "run-identity.json"), "run identity"),
  );
  const datasetManifest = await readJson(
    join(runDirectory, "dataset-manifest.json"),
    "dataset manifest",
  );
  const dataset = parseDatasetManifest(datasetManifest);
  if (
    identityEvidence.identity.datasetSha256 !== dataset.datasetSha256 ||
    identityEvidence.identity.benchmark !== `${dataset.benchmark}-full` ||
    identityEvidence.identity.generatedBy !==
      "scripts/run-phase-74-generalization.ts"
  ) {
    throw new Error("Phase 74 run identity and dataset manifest drifted.");
  }
  const admission = assertAggregationAdmission({
    benchmark: dataset.benchmark,
    dataset,
    datasetManifest,
    identity: identityEvidence.identity,
    rerankerAdmission,
  });
  const replicate = parseReplicate(
    identityEvidence.identity.configuration.replicate,
    "run identity replicate",
  );
  if (identityEvidence.identity.configuration.reader !== "generic-label-free-v1") {
    throw new Error("Phase 74 aggregation requires the frozen generic label-free reader.");
  }
  booleanValue(
    identityEvidence.identity.configuration.seenCasesOnly,
    "run identity seenCasesOnly",
  );
  return {
    benchmark: dataset.benchmark,
    dataset,
    experimentIdentityHash: identityEvidence.experimentIdentityHash,
    identity: identityEvidence.identity,
    identityHash: identityEvidence.identityHash,
    replicate,
    runDirectory,
    selectedCaseKeysSha256: admission.selectedCaseKeysSha256,
    selectionMode: admission.selectionMode,
  };
}

async function validateStageCallBudget(
  base: RunBaseArtifact,
  stage: ExperimentStage,
  summary: CallBudgetEvidence,
): Promise<void> {
  const configured = recordValue(
    base.identity.configuration.callBudget,
    `${stage} identity callBudget`,
  );
  if (
    configured.embeddingSpendLimitUsd !== summary.embeddingSpendLimitUsd ||
    configured.maxLanguageCalls !== summary.maxLanguageCalls
  ) {
    throw new Error(`Phase 74 ${stage} call budget limits drifted from identity.`);
  }
  const persisted = parseCallBudgetEvidence(
    await readJson(
      join(base.runDirectory, `${stage.toLowerCase()}-call-budget.json`),
      `${stage} call budget`,
    ),
    `${stage} persisted callBudget`,
  );
  if (stableJson(persisted) !== stableJson(summary)) {
    throw new Error(`Phase 74 ${stage} persisted call budget drift.`);
  }
}

async function loadRetrievalStageArtifact(
  base: RunBaseArtifact,
  stage: RetrievalStage,
): Promise<RetrievalStageArtifact> {
  const prefix = stage.toLowerCase();
  const summaryRaw = await readJson(
    join(base.runDirectory, `${prefix}-summary.json`),
    `${stage} summary`,
  );
  const summary = parseSummaryBase({
    benchmark: base.benchmark,
    experimentIdentityHash: base.experimentIdentityHash,
    identityHash: base.identityHash,
    replicate: base.replicate,
    stage,
    value: summaryRaw,
  });
  await validateStageCallBudget(base, stage, summary.callBudget);
  if (
    summary.caseCount !== base.dataset.caseCount ||
    summary.executionFailures !== 0
  ) {
    throw new Error(
      `Phase 74 ${stage} summary population or execution failures are invalid.`,
    );
  }
  const comparison = parseComparison(summary.comparison, {
    benchmark: base.benchmark,
    selectedCaseIdsSha256: base.dataset.selectedCaseIdsSha256,
    stage,
  });
  const rows = parseRetrievalProgress(
    await readJsonLines(
      join(base.runDirectory, `${prefix}-progress.jsonl`),
      `${stage} progress`,
    ),
    {
      caseCount: base.dataset.caseCount,
      comparison,
      expectedConfigurations: buildPhase74StageConfigurations(
        base.identity.configuration,
        stage,
      ),
      selectedCaseIdsSha256: base.dataset.selectedCaseIdsSha256,
      stage,
    },
  );
  const renderedContextMaxTokens = Math.max(
    0,
    ...rows.map(({ contextTokens }) => contextTokens),
  );
  validateProtocolScoreSemantics({
    benchmark: base.benchmark,
    rows,
    stage,
  });
  if (renderedContextMaxTokens !== summary.renderedContextMaxTokens) {
    throw new Error(`Phase 74 ${stage} rendered context summary drift.`);
  }
  validateEndToEndScores({
    endToEndScores: summary.endToEndScores,
    rows,
    stage,
  });
  const modelUsage = parseModelUsage(summary.modelUsage);
  if (
    base.identity.configuration.costBoundary !==
      "full-product-standalone-shared-v1" ||
    base.identity.configuration.modelUsageAccounting !==
      PHASE74_MODEL_USAGE_ACCOUNTING_VERSION ||
    modelUsage.costBoundary !== "full-product"
  ) {
    throw new Error(`Phase 74 ${stage} model usage cost boundary drift.`);
  }
  const persistedUsage = parseModelUsage(await readJson(
    join(base.runDirectory, `${prefix}-model-usage-summary.json`),
    `${stage} model usage summary`,
  ));
  if (stableJson(modelUsage) !== stableJson(persistedUsage)) {
    throw new Error(`Phase 74 ${stage} model usage summary drift.`);
  }
  validateUsagePopulation(modelUsage, {
    caseCount: base.dataset.caseCount,
    selectedCaseKeysSha256: base.selectedCaseKeysSha256,
    stage,
  });
  const snapshots = await validateRetrievalPackets({
    comparison,
    expectedSnapshotIds: rows.map(({ snapshotId }) => snapshotId),
    path: join(base.runDirectory, `${prefix}-retrieval-packets.jsonl`),
    rows,
    stage,
  });
  const allocation = buildPhase74IngestionUsageAllocation(snapshots);
  const directUsage = await loadRequiredModelUsageLedger({
    eventsPath: join(base.runDirectory, `${prefix}-model-usage.jsonl`),
    intentsPath: join(
      base.runDirectory,
      `${prefix}-model-usage-intents.jsonl`,
    ),
    label: `${stage} direct model`,
  });
  if (directUsage.pendingIntents.length > 0) {
    throw new Error(`Phase 74 ${stage} direct model usage contains pending requests.`);
  }
  const loadIngestionPool = async (
    keys: readonly string[],
    label: string,
  ): Promise<Phase74IngestionUsageLedger[]> => Promise.all(keys.map(
    async (key) => {
      const paths = buildPhase74IngestionUsagePaths(base.runDirectory, key);
      const ledger = await loadRequiredModelUsageLedger({
        ...paths,
        label: `${stage} ${label} ingestion ${key}`,
      });
      await verifyPhase74IngestionUsageManifest({
        ingestionKey: key,
        ledger,
        runDirectory: base.runDirectory,
      });
      if (ledger.pendingIntents.length > 0) {
        throw new Error(
          `Phase 74 ${stage} ${label} ingestion usage contains pending requests.`,
        );
      }
      return { key, ledger };
    },
  ));
  const [baselineExclusive, candidateExclusive, shared] = await Promise.all([
    loadIngestionPool(allocation.baselineExclusive, "baselineExclusive"),
    loadIngestionPool(allocation.candidateExclusive, "candidateExclusive"),
    loadIngestionPool(allocation.shared, "shared"),
  ]);
  const branchCaseIds = (branch: "baseline" | "candidate") =>
    [...new Set(directUsage.intents
      .filter((intent) => intent.branch === branch)
      .map(({ caseId }) => caseId))]
      .sort();
  const baselineCaseIds = branchCaseIds("baseline");
  const candidateCaseIds = branchCaseIds("candidate");
  const rebuiltUsage = buildPhase74ModelUsageEvidence({
    direct: directUsage,
    expected: {
      baselineCaseIds,
      candidateCaseIds,
    },
    ingestion: {
      baselineExclusive,
      candidateExclusive,
      shared,
    },
  });
  if (
    stableJson(rebuiltUsage) !== stableJson(modelUsage) ||
    baselineCaseIds.length !== base.dataset.caseCount ||
    candidateCaseIds.length !== base.dataset.caseCount ||
    sha256(JSON.stringify(baselineCaseIds)) !== base.selectedCaseKeysSha256 ||
    sha256(JSON.stringify(candidateCaseIds)) !== base.selectedCaseKeysSha256
  ) {
    throw new Error(`Phase 74 ${stage} raw model usage drift.`);
  }
  const sealed = await loadVerifiedSealedStage({ base, stage });
  return {
    comparison,
    executionFailures: summary.executionFailures,
    modelUsage,
    renderedContextMaxTokens,
    rows,
    sealed,
  };
}

async function loadRunArtifact(runDirectory: string): Promise<RunArtifact> {
  const base = await loadRunBaseArtifact(runDirectory, "provider");
  const retrieval = {} as Record<RetrievalStage, RetrievalStageArtifact>;
  for (const stage of RETRIEVAL_STAGES) {
    retrieval[stage] = await loadRetrievalStageArtifact(base, stage);
  }
  const e1Clusters = new Map(
    retrieval.E1.rows
      .filter(({ arm }) => arm === retrieval.E1.comparison.baselineArm)
      .map(({ caseId, clusterId }) => [caseId, clusterId]),
  );
  for (const stage of ["E2", "E3"] as const) {
    const rows = retrieval[stage].rows.filter(
      ({ arm }) => arm === retrieval[stage].comparison.baselineArm,
    );
    if (rows.some(({ caseId, clusterId }) => e1Clusters.get(caseId) !== clusterId)) {
      throw new Error(`Phase 74 ${stage} cluster population drifted from E1.`);
    }
    if (
      stableJson(retrieval[stage].sealed.execution.cases) !==
        stableJson(retrieval.E1.sealed.execution.cases) ||
      stableJson(retrieval[stage].sealed.escrow.cases) !==
        stableJson(retrieval.E1.sealed.escrow.cases)
    ) {
      throw new Error(`Phase 74 ${stage} sealed case population drifted from E1.`);
    }
  }

  const e4SummaryRaw = await readJson(
    join(runDirectory, "e4-summary.json"),
    "E4 summary",
  );
  const e4Summary = parseSummaryBase({
    benchmark: base.benchmark,
    experimentIdentityHash: base.experimentIdentityHash,
    identityHash: base.identityHash,
    replicate: base.replicate,
    stage: "E4",
    value: e4SummaryRaw,
  });
  await validateStageCallBudget(base, "E4", e4Summary.callBudget);
  if (e4Summary.comparison !== null || e4Summary.modelUsage !== null) {
    throw new Error("Phase 74 E4 summary must not claim a paired cost comparison.");
  }
  if (e4Summary.caseCount !== base.dataset.caseCount) {
    throw new Error("Phase 74 E4 summary case population drift.");
  }
  const e4RowsRaw = await readJsonLines(
    join(runDirectory, "e4-progress.jsonl"),
    "E4 progress",
  );
  const e4Rows = parseE4Progress(e4RowsRaw);
  validateE4Population({
    caseCount: base.dataset.caseCount,
    rows: e4Rows,
    selectedCaseIdsSha256: base.dataset.selectedCaseIdsSha256,
  });
  if (
    e4Rows
      .filter(({ format }) => format === "prose")
      .some(({ caseId, clusterId }) => e1Clusters.get(caseId) !== clusterId)
  ) {
    throw new Error("Phase 74 E4 cluster population drifted from retrieval stages.");
  }
  const e4Report = recordValue(
    await readJson(join(runDirectory, "e4-report.json"), "E4 report"),
    "E4 report",
  );
  if (
    e4Report.identityHash !== base.identityHash ||
    e4Report.experimentIdentityHash !== base.experimentIdentityHash ||
    stableJson(e4Report.identity) !== stableJson(base.identity)
  ) {
    throw new Error("Phase 74 E4 report identity drift.");
  }
  const reportE4 = recordValue(e4Report.e4, "E4 report payload");
  if (stableJson(reportE4.cases) !== stableJson(e4RowsRaw)) {
    throw new Error("Phase 74 E4 report/progress case drift.");
  }
  const reportSummary = recordValue(e4Report.summary, "E4 report summary");
  if (
    reportSummary.caseCount !== e4Summary.caseCount ||
    reportSummary.executionFailures !== e4Summary.executionFailures ||
    reportSummary.renderedContextMaxTokens !== e4Summary.renderedContextMaxTokens
  ) {
    throw new Error("Phase 74 E4 report/summary drift.");
  }
  const deterministicRows = retrieval.E3.rows.filter(
    ({ arm }) => arm === "recall-plan-deterministic",
  );
  const deterministicSnapshotByCaseId = new Map(
    deterministicRows.map(({ caseId, snapshotId }) => [caseId, snapshotId]),
  );
  const proseRows = e4Rows.filter(({ format }) => format === "prose");
  if (proseRows.some(({ caseId, sourceSnapshotId }) =>
    deterministicSnapshotByCaseId.get(caseId) !== sourceSnapshotId
  )) {
    throw new Error(
      "Phase 74 E4 source snapshot drifted from deterministic E3.",
    );
  }
  const e4Snapshots = await validateRetrievalPackets({
    comparison: retrieval.E3.comparison,
    expectedSnapshotIds: deterministicRows.map(({ snapshotId }) => snapshotId),
    labelStage: "E4",
    path: join(runDirectory, "e4-retrieval-packets.jsonl"),
    rows: deterministicRows,
    stage: "E3",
  });
  validateE4RenderedLedgers({ rows: e4Rows, snapshots: e4Snapshots });
  const e4Usage = recordValue(
    await readJson(
      join(runDirectory, "e4-model-usage-summary.json"),
      "E4 model usage summary",
    ),
    "E4 model usage summary",
  );
  if (e4Usage.status !== "not_applicable") {
    throw new Error("Phase 74 E4 model usage summary must be not_applicable.");
  }
  const sealed = await loadVerifiedSealedStage({
    base,
    expectedE3Artifact: retrieval.E3.sealed.artifact,
    stage: "E4",
  });
  if (
    stableJson(sealed.execution.cases) !==
      stableJson(retrieval.E1.sealed.execution.cases) ||
    stableJson(sealed.escrow.cases) !==
      stableJson(retrieval.E1.sealed.escrow.cases)
  ) {
    throw new Error("Phase 74 E4 sealed case population drifted from E1.");
  }
  return {
    benchmark: base.benchmark,
    dataset: base.dataset,
    experimentIdentityHash: base.experimentIdentityHash,
    identity: base.identity,
    identityHash: base.identityHash,
    replicate: base.replicate,
    retrieval,
    runDirectory,
    selectionMode: base.selectionMode,
    e4: {
      executionFailures: e4Summary.executionFailures,
      renderedContextMaxTokens: e4Summary.renderedContextMaxTokens,
      rows: e4Rows,
      sealed,
    },
  };
}

function sumOperationCounts(
  evidence: readonly Pick<Phase74ModelUsageBranchEvidence, "operationCounts">[],
): Phase74ModelUsageBranchEvidence["operationCounts"] {
  const result: Record<string, number> = {};
  for (const item of evidence) {
    for (const [operation, count] of Object.entries(item.operationCounts)) {
      result[operation] = (result[operation] ?? 0) + (count ?? 0);
    }
  }
  return result;
}

function combineUsage(input: {
  artifacts: readonly {
    benchmark: Phase74BenchmarkFamily;
    caseIds: readonly string[];
    identityHash: string;
    replicate: Replicate;
    usage: Phase74ModelUsageEvidence;
  }[];
}): Phase74ModelUsageEvidence {
  const boundaries = new Set(input.artifacts.map(({ usage }) => usage.costBoundary));
  if (boundaries.size !== 1) {
    throw new Error("Phase 74 model usage cost boundary drift across artifacts.");
  }
  const combineBranch = (branch: "baseline" | "candidate") => {
    const evidence = input.artifacts.map(({ usage }) => usage[branch]);
    const virtualCaseIds = input.artifacts.flatMap(
      ({ benchmark, caseIds, replicate }) =>
        caseIds.map((caseId) => `${benchmark}/replicate-${replicate}/${caseId}`),
    ).sort();
    return {
      answerGenerationCaseCount: evidence.reduce(
        (total, item) => total + item.answerGenerationCaseCount,
        0,
      ),
      caseIdsSha256: sha256(JSON.stringify(virtualCaseIds)),
      completeRequestCount: evidence.reduce(
        (total, item) => total + item.completeRequestCount,
        0,
      ),
      logicalCaseCount: virtualCaseIds.length,
      missingRequestCount: evidence.reduce(
        (total, item) => total + item.missingRequestCount,
        0,
      ),
      operationCounts: sumOperationCounts(evidence),
      partialRequestCount: evidence.reduce(
        (total, item) => total + item.partialRequestCount,
        0,
      ),
      pendingRequestCount: evidence.reduce(
        (total, item) => total + item.pendingRequestCount,
        0,
      ),
      requestCount: evidence.reduce(
        (total, item) => total + item.requestCount,
        0,
      ),
      totalTokens: evidence.reduce(
        (total, item) => total + item.totalTokens,
        0,
      ),
      unobservedCaseIds: input.artifacts.flatMap(
        ({ benchmark, replicate, usage }) =>
          usage[branch].unobservedCaseIds.map(
            (caseId) => `${benchmark}/replicate-${replicate}/${caseId}`,
          ),
      ),
    };
  };
  const combinePool = (
    pool: keyof Phase74ModelUsageEvidence["ingestion"],
  ): Phase74ModelUsagePoolEvidence => {
    const evidence = input.artifacts.map(({ usage }) => usage.ingestion[pool]);
    const virtualKeys = input.artifacts.map((artifact) => ({
      artifactIdentityHash: artifact.identityHash,
      benchmark: artifact.benchmark,
      keyCount: artifact.usage.ingestion[pool].keyCount,
      keysSha256: artifact.usage.ingestion[pool].keysSha256,
      replicate: artifact.replicate,
    })).sort((left, right) =>
      left.artifactIdentityHash.localeCompare(right.artifactIdentityHash)
    );
    return {
      completeRequestCount: evidence.reduce(
        (total, item) => total + item.completeRequestCount,
        0,
      ),
      keyCount: evidence.reduce((total, item) => total + item.keyCount, 0),
      keysSha256: sha256(stableJson(virtualKeys)),
      missingRequestCount: evidence.reduce(
        (total, item) => total + item.missingRequestCount,
        0,
      ),
      operationCounts: sumOperationCounts(evidence),
      partialRequestCount: evidence.reduce(
        (total, item) => total + item.partialRequestCount,
        0,
      ),
      pendingRequestCount: evidence.reduce(
        (total, item) => total + item.pendingRequestCount,
        0,
      ),
      requestCount: evidence.reduce(
        (total, item) => total + item.requestCount,
        0,
      ),
      totalTokens: evidence.reduce(
        (total, item) => total + item.totalTokens,
        0,
      ),
    };
  };
  return {
    accountingVersion: PHASE74_MODEL_USAGE_ACCOUNTING_VERSION,
    allocationPolicy: PHASE74_MODEL_USAGE_ALLOCATION_POLICY,
    baseline: combineBranch("baseline"),
    candidate: combineBranch("candidate"),
    costBoundary: input.artifacts[0]!.usage.costBoundary,
    ingestion: {
      baselineExclusive: combinePool("baselineExclusive"),
      candidateExclusive: combinePool("candidateExclusive"),
      shared: combinePool("shared"),
    },
  };
}

function outcomesForArm(
  artifact: StageAggregationArtifact,
  arm: string,
): Phase74ReplicateCaseOutcome[] {
  return artifact.retrieval.rows
    .filter((row) => row.arm === arm)
    .map((row) => ({
      caseId: row.caseId,
      clusterId: row.clusterId,
      passed: row.correct,
      value: row.score,
    }));
}

function questionWeightedDelta(run: Phase74ReplicateRun): number {
  return mean(run.baseline.map((baseline, index) =>
    run.candidate[index]!.value - baseline.value
  ));
}

function deltaDirection(
  deltas: readonly [number, number, number],
): Phase74StageAggregation["replicateStability"]["direction"] {
  if (deltas.every((delta) => Math.abs(delta) <= COMPARISON_TOLERANCE)) {
    return "stable_zero";
  }
  if (deltas.every((delta) => delta > COMPARISON_TOLERANCE)) {
    return "consistent_positive";
  }
  if (deltas.every((delta) => delta < -COMPARISON_TOLERANCE)) {
    return "consistent_negative";
  }
  return "mixed";
}

function buildStageAggregation(input: {
  artifacts: readonly [
    StageAggregationArtifact,
    StageAggregationArtifact,
    StageAggregationArtifact,
  ];
  benchmark: Phase74BenchmarkFamily;
  bootstrapSamples?: number;
  seed?: number;
  stage: RetrievalStage;
}): Phase74StageAggregation {
  const runs = input.artifacts.map((artifact): Phase74ReplicateRun => {
    const comparison = artifact.retrieval.comparison;
    return {
      baseline: outcomesForArm(
        artifact,
        comparison.baselineArm,
      ),
      candidate: outcomesForArm(
        artifact,
        comparison.candidateArm,
      ),
      comparison,
      experimentIdentityHash: artifact.experimentIdentityHash,
      identityHash: artifact.identityHash,
      replicate: artifact.replicate,
      runId: artifact.identity.runId,
    };
  }) as [Phase74ReplicateRun, Phase74ReplicateRun, Phase74ReplicateRun];
  const aggregate = aggregatePhase74Replicates({
    ...(input.bootstrapSamples === undefined
      ? {}
      : { bootstrapSamples: input.bootstrapSamples }),
    runs,
    ...(input.seed === undefined ? {} : { seed: input.seed }),
  });
  const baselineLatencies = input.artifacts.flatMap((artifact) => {
    const comparison = artifact.retrieval.comparison;
    return artifact.retrieval.rows
      .filter(({ arm }) => arm === comparison.baselineArm)
      .map(({ productLatencyMs }) => productLatencyMs);
  });
  const candidateLatencies = input.artifacts.flatMap((artifact) => {
    const comparison = artifact.retrieval.comparison;
    return artifact.retrieval.rows
      .filter(({ arm }) => arm === comparison.candidateArm)
      .map(({ productLatencyMs }) => productLatencyMs);
  });
  const reference = runs[0].baseline;
  const perCase = reference.map((baseline, caseIndex) => {
    const baselineValues = runs.map((run) => run.baseline[caseIndex]!.value);
    const candidateValues = runs.map((run) => run.candidate[caseIndex]!.value);
    const replicateDeltas = candidateValues.map(
      (value, index) => value - baselineValues[index]!,
    ) as [number, number, number];
    const baselineMean = mean(baselineValues);
    const candidateMean = mean(candidateValues);
    return {
      baselineMean,
      candidateMean,
      caseId: baseline.caseId,
      clusterId: baseline.clusterId,
      delta: candidateMean - baselineMean,
      replicateDeltas,
    };
  });
  const independentlyDerivedDeltas = runs.map(questionWeightedDelta) as [
    number,
    number,
    number,
  ];
  if (
    aggregate.replicateDeltas.some(
      (delta, index) =>
        Math.abs(delta - independentlyDerivedDeltas[index]!) >
        COMPARISON_TOLERANCE,
    )
  ) {
    throw new Error("Phase 74 hierarchical replicate delta derivation drifted.");
  }
  const replicateDeltas = [...aggregate.replicateDeltas] as [
    number,
    number,
    number,
  ];
  const modelUsage = combineUsage({
    artifacts: input.artifacts.map((artifact) => ({
      benchmark: input.benchmark,
      caseIds: runs[artifact.replicate - 1]!.baseline.map(({ caseId }) => caseId),
      identityHash: artifact.identityHash,
      replicate: artifact.replicate,
      usage: artifact.retrieval.modelUsage,
    })),
  });
  return {
    aggregate,
    benchmark: input.benchmark,
    caseCount: aggregate.caseCount,
    clusterCount: aggregate.clusterCount,
    experimentIdentityHash: input.artifacts[0].experimentIdentityHash,
    latency: {
      baselineP95Ms: p95(baselineLatencies),
      candidateP95Ms: p95(candidateLatencies),
      sampleCountPerArm: baselineLatencies.length,
    },
    modelUsage,
    perCase,
    renderedContextMaxTokens: Math.max(
      ...input.artifacts.map(({ retrieval }) =>
        retrieval.renderedContextMaxTokens
      ),
    ),
    replicateStability: {
      deltas: replicateDeltas,
      direction: deltaDirection(replicateDeltas),
    },
    runIds: input.artifacts.map(({ identity }) => identity.runId) as [
      string,
      string,
      string,
    ],
    stage: input.stage,
  };
}

async function loadProtectionArtifact(
  path: string,
  dependencies: Phase74ArtifactAggregationDependencies,
): Promise<ProtectionArtifact> {
  const { evidence, sha256: artifactSha256 } =
    await loadPhase74FrozenProtectionSuiteEvidence(path, {
      verifiers: dependencies.protectionVerifiers,
    });
  return {
    blueprintSha256: evidence.source.manifest.sha256,
    e4: evidence.e4.formatDeltas,
    evaluatorSource: evidence.source.evaluatorSource,
    promotion: evidence.promotion,
    sha256: artifactSha256,
  };
}

function fixedCrossFamilyIdentity(identity: EvalRunIdentity): unknown {
  const selectionPopulationFields = new Set([
    "populationContentSha256",
    "populationSize",
    "selectedCaseIdsSha256",
    "selectedCaseKeysSha256",
    "selectedSize",
  ]);
  const selection = Object.fromEntries(Object.entries(recordValue(
    identity.configuration.selection,
    "cross-family selection identity",
  )).filter(([field]) => !selectionPopulationFields.has(field)));
  const familySpecificFields = new Set([
    "dataset",
    "replicate",
    "scoring",
    "selectedCaseIdsSha256",
    "selection",
  ]);
  const configuration = {
    ...Object.fromEntries(Object.entries(identity.configuration).filter(
      ([field]) => !familySpecificFields.has(field),
    )),
    selection,
  };
  return {
    answerModel: identity.answerModel,
    configuration,
    judgeModel: identity.judgeModel,
    promptSha256s: identity.promptSha256s,
  };
}

function assertProtectionIdentityAlignment(
  artifacts: readonly RunArtifact[],
  protection: ProtectionArtifact,
): void {
  for (const artifact of artifacts) {
    const blueprint = recordValue(
      artifact.identity.configuration.protectionBlueprint,
      "protection blueprint",
    );
    if (blueprint.sha256 !== protection.blueprintSha256) {
      throw new Error(
        "Phase 74 protection blueprint does not match the pre-bound main run identity.",
      );
    }
    const source = recordValue(
      artifact.identity.configuration.evaluatorSource,
      "evaluator source",
    );
    if (
      protection.evaluatorSource.id !== `git:${String(source.commit)}` ||
      protection.evaluatorSource.sha256 !== source.sha256
    ) {
      throw new Error(
        "Phase 74 protection evaluator source does not match the main run identity.",
      );
    }
  }
}

function buildE4Evaluation(
  artifacts: readonly RunArtifact[],
  protection: ProtectionArtifact | null,
): Phase74ArtifactAggregationReport["e4"] {
  const gaps: string[] = [];
  const missingScoreCount = artifacts.reduce(
    (total, artifact) =>
      total + artifact.e4.rows.filter(({ score }) => score === undefined).length,
    0,
  );
  if (missingScoreCount > 0) {
    gaps.push(
      `E4 per-case score is missing from ${missingScoreCount} progress row(s); binary correct is not a cross-family scorer.`,
    );
  }
  if (protection === null) {
    gaps.push("A frozen protection artifact is required for E4 format selection.");
  }
  if (artifacts.some(({ e4 }) => e4.executionFailures !== 0)) {
    gaps.push("E4 contains execution failures.");
  }
  const formats = EVIDENCE_LEDGER_FORMATS.map((format) => {
    const familyScores = BENCHMARKS.map((benchmark) => {
      const rows = artifacts
        .filter((artifact) => artifact.benchmark === benchmark)
        .flatMap((artifact) => artifact.e4.rows)
        .filter((row) => row.format === format);
      return rows.every(({ score }) => score !== undefined)
        ? mean(rows.map(({ score }) => score!))
        : null;
    });
    const familyTokens = BENCHMARKS.map((benchmark) => {
      const rows = artifacts
        .filter((artifact) => artifact.benchmark === benchmark)
        .flatMap((artifact) => artifact.e4.rows)
        .filter((row) => row.format === format);
      return mean(rows.map(({ contextTokens }) => contextTokens));
    });
    const protectionDeltas = protection?.e4[format].map(({ delta }) => delta) ?? [];
    const minimumProtectionDelta = protectionDeltas.length === 0
      ? null
      : Math.min(...protectionDeltas);
    return {
      averageTokens: mean(familyTokens),
      eligible: minimumProtectionDelta === null
        ? null
        : minimumProtectionDelta + COMPARISON_TOLERANCE >=
          -PHASE74_MAX_PROTECTION_REGRESSION,
      format,
      macroScore: familyScores.every((score) => score !== null)
        ? mean(familyScores as number[])
        : null,
      minimumProtectionDelta,
    };
  });
  const eligible = formats.filter(
    (format): format is typeof format & { macroScore: number } =>
      format.eligible === true && format.macroScore !== null,
  );
  if (protection !== null && eligible.length === 0) {
    gaps.push("Every E4 format regressed a protection set by more than 1pp.");
  }
  if (gaps.length > 0) {
    return {
      formats,
      gaps,
      selectedFormat: "not_evaluable",
      status: "not_evaluable",
    };
  }
  const bestScore = Math.max(...eligible.map(({ macroScore }) => macroScore));
  const selected = eligible
    .filter(({ macroScore }) =>
      macroScore + 0.01 + COMPARISON_TOLERANCE >= bestScore
    )
    .sort((left, right) =>
      left.averageTokens - right.averageTokens ||
      EVIDENCE_LEDGER_FORMATS.indexOf(left.format) -
        EVIDENCE_LEDGER_FORMATS.indexOf(right.format)
    )[0]!;
  return {
    formats,
    gaps: [],
    selectedFormat: selected.format,
    status: "evaluated",
  };
}

function buildPromotionEvaluation(input: {
  artifacts: readonly RunArtifact[];
  e4: Phase74ArtifactAggregationReport["e4"];
  promotionStage?: RetrievalStage;
  protection: ProtectionArtifact | null;
  stageAggregations: readonly Phase74StageAggregation[];
}): Phase74ArtifactAggregationReport["promotion"] {
  const gaps: string[] = [];
  if (input.promotionStage === undefined) {
    gaps.push("A promotion comparison stage must be selected explicitly.");
    return {
      gaps,
      stage: null,
      status: "not_evaluable",
    };
  }
  const stage = input.promotionStage;
  const selected = input.stageAggregations.filter(
    (aggregation) => aggregation.stage === stage,
  );
  if (selected.length !== 2) {
    throw new Error(`Phase 74 ${stage} must contain both benchmark families.`);
  }
  if (input.protection === null) {
    gaps.push("A frozen protection artifact is required for promotion.");
  }
  if (input.e4.status !== "evaluated") {
    gaps.push("E4 evidence-ledger format selection is not evaluable.");
  }
  if (
    selected.some(
      ({ replicateStability }) =>
        replicateStability.direction !== "consistent_positive",
    )
  ) {
    gaps.push(
      "Every benchmark family must improve in each of the three independent replicates.",
    );
  }
  const selectedArtifacts = input.artifacts.map((artifact) => {
    const comparison = artifact.retrieval[stage].comparison;
    return {
      artifact,
      baselineRows: artifact.retrieval[stage].rows.filter(
        ({ arm }) => arm === comparison.baselineArm,
      ),
      candidateRows: artifact.retrieval[stage].rows.filter(
        ({ arm }) => arm === comparison.candidateArm,
      ),
    };
  });
  const costBoundaries = new Set(
    selectedArtifacts.map(({ artifact }) =>
      artifact.retrieval[stage].modelUsage.costBoundary
    ),
  );
  if (costBoundaries.size !== 1 || !costBoundaries.has("full-product")) {
    gaps.push("full-product model usage evidence is required; query-only evidence cannot promote.");
  }
  const seenCasesOnly = selectedArtifacts.some(({ artifact }) =>
    artifact.identity.configuration.seenCasesOnly === true
  );
  if (seenCasesOnly) {
    gaps.push("seen-case evidence cannot authorize promotion.");
  }
  if (selectedArtifacts.some(({ artifact }) => artifact.selectionMode !== "all")) {
    gaps.push("The full frozen population is required; a selected subset cannot promote.");
  }
  if (gaps.length > 0) {
    return { gaps, stage, status: "not_evaluable" };
  }
  const modelUsage = combineUsage({
    artifacts: selectedArtifacts.map(({ artifact, baselineRows }) => ({
      benchmark: artifact.benchmark,
      caseIds: baselineRows.map(({ caseId }) => caseId),
      identityHash: artifact.identityHash,
      replicate: artifact.replicate,
      usage: artifact.retrieval[stage].modelUsage,
    })),
  });
  const promotionInput: Phase74PromotionGateInput = {
    evidenceBoundary: {
      goldAware: false,
      protocolReader: false,
      seenCasesOnly: false,
    },
    families: selected.map((aggregation) => ({
      delta: aggregation.aggregate.inference.delta,
      family: aggregation.benchmark,
      inference: {
        confidenceLevel: aggregation.aggregate.inference.confidenceLevel,
        lower: aggregation.aggregate.inference.lower,
        method: aggregation.aggregate.inference.method,
        upper: aggregation.aggregate.inference.upper,
      },
      runIds: [...aggregation.runIds],
    })),
    operations: {
      baselineP95LatencyMs: p95(selectedArtifacts.flatMap(({ baselineRows }) =>
        baselineRows.map(({ productLatencyMs }) => productLatencyMs)
      )),
      candidateP95LatencyMs: p95(selectedArtifacts.flatMap(({ candidateRows }) =>
        candidateRows.map(({ productLatencyMs }) => productLatencyMs)
      )),
      executionFailures: selectedArtifacts.reduce(
        (total, { artifact }) =>
          total + artifact.retrieval[stage].executionFailures,
        0,
      ),
      modelUsage,
      renderedContextMaxTokens: Math.max(
        ...selectedArtifacts.map(({ artifact }) =>
          artifact.retrieval[stage].renderedContextMaxTokens
        ),
      ),
    },
    protections: input.protection!.promotion.protections,
    safety: input.protection!.promotion.safety,
  };
  return {
    gaps: [],
    input: promotionInput,
    result: evaluatePhase74PromotionGate(promotionInput),
    stage,
    status: "evaluated",
  };
}

function orderArtifacts(artifacts: readonly RunArtifact[]): RunArtifact[] {
  const sorted = [...artifacts].sort((left, right) =>
    BENCHMARKS.indexOf(left.benchmark) - BENCHMARKS.indexOf(right.benchmark) ||
    left.replicate - right.replicate
  );
  for (const benchmark of BENCHMARKS) {
    const selected = sorted.filter((artifact) => artifact.benchmark === benchmark);
    if (
      selected.length !== 3 ||
      selected[0]?.replicate !== 1 ||
      selected[1]?.replicate !== 2 ||
      selected[2]?.replicate !== 3
    ) {
      throw new Error(
        `Phase 74 ${benchmark} requires replicates 1, 2, and 3 exactly once.`,
      );
    }
    if (new Set(selected.map(({ experimentIdentityHash }) => experimentIdentityHash)).size !== 1) {
      throw new Error(`Phase 74 ${benchmark} experiment identity drift.`);
    }
    if (new Set(selected.map(({ dataset }) => stableJson(dataset))).size !== 1) {
      throw new Error(`Phase 74 ${benchmark} dataset population drift.`);
    }
  }
  if (
    new Set(sorted.map(({ identity }) =>
      stableJson(fixedCrossFamilyIdentity(identity))
    )).size !== 1
  ) {
    throw new Error("Phase 74 fixed cross-family identity drift.");
  }
  if (new Set(sorted.map(({ identityHash }) => identityHash)).size !== sorted.length) {
    throw new Error("Phase 74 run identity hashes must be globally unique.");
  }
  if (new Set(sorted.map(({ identity }) => identity.runId)).size !== sorted.length) {
    throw new Error("Phase 74 run IDs must be globally unique.");
  }
  return sorted;
}

function normalizeRunDirectories(runDirectories: readonly string[]): string[] {
  const resolved = runDirectories.map((path) => resolve(path));
  if (new Set(resolved).size !== resolved.length) {
    throw new Error("Phase 74 aggregation contains duplicate run directories.");
  }
  if (runDirectories.length !== 6) {
    throw new Error("Phase 74 aggregation requires exactly six run directories.");
  }
  return resolved;
}

function selectStageArtifact(
  artifact: RunArtifact,
  stage: RetrievalStage,
): StageAggregationArtifact {
  return {
    benchmark: artifact.benchmark,
    dataset: artifact.dataset,
    experimentIdentityHash: artifact.experimentIdentityHash,
    identity: artifact.identity,
    identityHash: artifact.identityHash,
    replicate: artifact.replicate,
    retrieval: artifact.retrieval[stage],
    runDirectory: artifact.runDirectory,
    selectionMode: artifact.selectionMode,
  };
}

function orderStageArtifacts(
  artifacts: readonly StageAggregationArtifact[],
): [StageAggregationArtifact, StageAggregationArtifact, StageAggregationArtifact] {
  const sorted = [...artifacts].sort(
    (left, right) => left.replicate - right.replicate,
  );
  if (
    sorted.length !== 3 ||
    sorted[0]?.replicate !== 1 ||
    sorted[1]?.replicate !== 2 ||
    sorted[2]?.replicate !== 3
  ) {
    throw new Error(
      "Phase 74 stage diagnostic requires replicates 1, 2, and 3 exactly once.",
    );
  }
  if (new Set(sorted.map(({ benchmark }) => benchmark)).size !== 1) {
    throw new Error("Phase 74 stage diagnostic benchmark drift.");
  }
  if (
    new Set(sorted.map(({ experimentIdentityHash }) =>
      experimentIdentityHash
    )).size !== 1
  ) {
    throw new Error("Phase 74 stage diagnostic experiment identity drift.");
  }
  if (new Set(sorted.map(({ dataset }) => stableJson(dataset))).size !== 1) {
    throw new Error("Phase 74 stage diagnostic dataset population drift.");
  }
  if (new Set(sorted.map(({ identityHash }) => identityHash)).size !== 3) {
    throw new Error("Phase 74 stage diagnostic run identity hashes must be unique.");
  }
  if (new Set(sorted.map(({ identity }) => identity.runId)).size !== 3) {
    throw new Error("Phase 74 stage diagnostic run IDs must be unique.");
  }
  return sorted as [
    StageAggregationArtifact,
    StageAggregationArtifact,
    StageAggregationArtifact,
  ];
}

export async function aggregatePhase74StageDiagnosticArtifacts(
  input: Phase74StageDiagnosticAggregationInput,
): Promise<Phase74StageDiagnosticAggregationReport> {
  if (input.runDirectories.length !== 3) {
    throw new Error(
      "Phase 74 stage diagnostic requires exactly three run directories.",
    );
  }
  const runDirectories = input.runDirectories.map((path) => resolve(path));
  if (new Set(runDirectories).size !== runDirectories.length) {
    throw new Error("Phase 74 stage diagnostic contains duplicate run directories.");
  }
  const artifacts = orderStageArtifacts(await Promise.all(
    runDirectories.map(async (runDirectory): Promise<StageAggregationArtifact> => {
      const base = await loadRunBaseArtifact(runDirectory, "recorded");
      return {
        benchmark: base.benchmark,
        dataset: base.dataset,
        experimentIdentityHash: base.experimentIdentityHash,
        identity: base.identity,
        identityHash: base.identityHash,
        replicate: base.replicate,
        retrieval: await loadRetrievalStageArtifact(base, input.stage),
        runDirectory: base.runDirectory,
        selectionMode: base.selectionMode,
      };
    }),
  ));
  const aggregation = buildStageAggregation({
    artifacts,
    benchmark: artifacts[0].benchmark,
    ...(input.bootstrapSamples === undefined
      ? {}
      : { bootstrapSamples: input.bootstrapSamples }),
    ...(input.seed === undefined ? {} : { seed: input.seed }),
    stage: input.stage,
  });
  return {
    aggregation,
    evidenceBoundary: "seen-case-stage-ablation-diagnostic",
    inputs: artifacts.map((artifact) => ({
      experimentIdentityHash: artifact.experimentIdentityHash,
      identityHash: artifact.identityHash,
      replicate: artifact.replicate,
      runDirectory: artifact.runDirectory,
      runId: artifact.identity.runId,
    })),
    kind: "phase74-stage-only-diagnostic",
    promotionEvaluated: false,
    reason: "A selected single-stage ablation cannot authorize product promotion.",
    schemaVersion: 1,
    seenCasesOnly: true,
    status: "not_evaluable_for_promotion",
  };
}

export async function aggregatePhase74GeneralizationArtifacts(
  input: Phase74ArtifactAggregationInput,
  dependencies: Phase74ArtifactAggregationDependencies = {},
): Promise<Phase74ArtifactAggregationReport> {
  const runDirectories = normalizeRunDirectories(input.runDirectories);
  const artifacts = orderArtifacts(await Promise.all(
    runDirectories.map(loadRunArtifact),
  ));
  const protection = input.protectionArtifactPath === undefined
    ? null
    : await loadProtectionArtifact(
        resolve(input.protectionArtifactPath),
        dependencies,
      );
  if (protection !== null) {
    assertProtectionIdentityAlignment(artifacts, protection);
  }
  const stageAggregations = BENCHMARKS.flatMap((benchmark) => {
    const selected = artifacts.filter(
      (artifact) => artifact.benchmark === benchmark,
    ) as [RunArtifact, RunArtifact, RunArtifact];
    return RETRIEVAL_STAGES.map((stage) => buildStageAggregation({
      artifacts: selected.map((artifact) =>
        selectStageArtifact(artifact, stage)
      ) as [
        StageAggregationArtifact,
        StageAggregationArtifact,
        StageAggregationArtifact,
      ],
      benchmark,
      ...(input.bootstrapSamples === undefined
        ? {}
        : { bootstrapSamples: input.bootstrapSamples }),
      ...(input.seed === undefined ? {} : { seed: input.seed }),
      stage,
    }));
  });
  const e4 = buildE4Evaluation(artifacts, protection);
  const promotion = buildPromotionEvaluation({
    artifacts,
    e4,
    ...(input.promotionStage === undefined
      ? {}
      : { promotionStage: input.promotionStage }),
    protection,
    stageAggregations,
  });
  return {
    e4,
    inputs: {
      protectionArtifactSha256: protection?.sha256 ?? null,
      runs: artifacts.map((artifact) => ({
        benchmark: artifact.benchmark,
        experimentIdentityHash: artifact.experimentIdentityHash,
        identityHash: artifact.identityHash,
        replicate: artifact.replicate,
        runDirectory: artifact.runDirectory,
        runId: artifact.identity.runId,
      })),
    },
    promotion,
    schemaVersion: 1,
    stageAggregations,
  };
}

function cliValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--") || value.trim() !== value || value === "") {
    throw new Error(`${flag} requires a non-empty, non-whitespace-padded value.`);
  }
  return value;
}

export function parsePhase74AggregationCliOptions(
  argv: readonly string[],
): Phase74AggregationCliOptions {
  const runDirectories: string[] = [];
  let outputPath: string | undefined;
  let protectionArtifactPath: string | undefined;
  let promotionStage: RetrievalStage | undefined;
  let bootstrapSamples: number | undefined;
  let seed: number | undefined;
  const seenSingletons = new Set<string>();
  let sawOption = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (!flag.startsWith("--")) {
      if (sawOption) {
        throw new Error(`Phase 74 aggregation received unexpected positional argument ${flag}.`);
      }
      continue;
    }
    sawOption = true;
    if (![
      "--bootstrap-samples",
      "--output",
      "--promotion-stage",
      "--protection-artifact",
      "--run-dir",
      "--seed",
    ].includes(flag)) {
      throw new Error(`Phase 74 aggregation received unknown option ${flag}.`);
    }
    const value = cliValue(argv, index, flag);
    index += 1;
    if (flag === "--run-dir") {
      runDirectories.push(resolve(value));
      continue;
    }
    if (seenSingletons.has(flag)) {
      throw new Error(`${flag} cannot be specified more than once.`);
    }
    seenSingletons.add(flag);
    if (flag === "--output") {
      outputPath = resolve(value);
    } else if (flag === "--protection-artifact") {
      protectionArtifactPath = resolve(value);
    } else if (flag === "--promotion-stage") {
      if (!RETRIEVAL_STAGES.includes(value as RetrievalStage)) {
        throw new Error("--promotion-stage must be E1, E2, or E3.");
      }
      promotionStage = value as RetrievalStage;
    } else {
      if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error(`${flag} must be a positive integer.`);
      }
      if (flag === "--bootstrap-samples") {
        bootstrapSamples = Number(value);
      } else {
        seed = Number(value);
      }
    }
  }
  const normalizedRunDirectories = normalizeRunDirectories(runDirectories);
  if (outputPath === undefined) {
    throw new Error("Phase 74 aggregation requires --output.");
  }
  if (
    protectionArtifactPath !== undefined &&
    protectionArtifactPath === outputPath
  ) {
    throw new Error("--output and --protection-artifact must be different paths.");
  }
  for (const runDirectory of normalizedRunDirectories) {
    const outputRelative = relative(runDirectory, outputPath);
    if (
      outputRelative === "" ||
      (!outputRelative.startsWith("..") && !isAbsolute(outputRelative))
    ) {
      throw new Error("--output must not mutate a frozen Phase 74 run directory.");
    }
  }
  return {
    ...(bootstrapSamples === undefined ? {} : { bootstrapSamples }),
    outputPath,
    ...(promotionStage === undefined ? {} : { promotionStage }),
    ...(protectionArtifactPath === undefined
      ? {}
      : { protectionArtifactPath }),
    runDirectories: normalizedRunDirectories,
    ...(seed === undefined ? {} : { seed }),
  };
}

export async function runPhase74GeneralizationAggregation(
  options: Phase74AggregationCliOptions,
  dependencies: Phase74ArtifactAggregationDependencies = {},
): Promise<Phase74ArtifactAggregationReport> {
  const outputPath = resolve(options.outputPath);
  if (options.protectionArtifactPath !== undefined) {
    const protectionArtifactPath = resolve(options.protectionArtifactPath);
    const { evidence } = await loadPhase74FrozenProtectionSuiteEvidence(
      protectionArtifactPath,
      { verifiers: dependencies.protectionVerifiers },
    );
    const protectedPaths = [
      {
        label: "the frozen protection evidence",
        path: protectionArtifactPath,
      },
      {
        label: "the protection suite manifest",
        path: evidence.source.manifest.path,
      },
      ...evidence.source.suites.flatMap(({ files }) => files.flatMap((file) => [
        {
          label: "a frozen protection run artifact",
          path: file.artifactPath,
        },
        {
          label: "a frozen protection raw artifact",
          path: file.rawArtifactPath,
        },
      ])),
    ];
    const conflict = protectedPaths.find(({ path }) =>
      resolve(path) === outputPath
    );
    if (conflict !== undefined) {
      throw new Error(`--output must not overwrite ${conflict.label}.`);
    }
  }
  const report = await aggregatePhase74GeneralizationArtifacts(
    options,
    dependencies,
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(report, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return report;
}

if (import.meta.main) {
  const options = parsePhase74AggregationCliOptions(process.argv);
  const report = await runPhase74GeneralizationAggregation(options);
  console.log(JSON.stringify({
    e4: report.e4.status,
    outputPath: options.outputPath,
    promotion: report.promotion.status,
    stageAggregationCount: report.stageAggregations.length,
  }, null, 2));
}
