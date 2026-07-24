import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { EvidenceLedgerFormat } from "../src/eval/evidenceLedgerFormats";
import {
  buildPhase74IngestionDescriptor,
  buildPhase74IngestionUsagePaths,
  createPhase74FullRetrievalRuntime,
} from "../src/eval/phase74FullRuntime";
import {
  buildPhase74LabelFreeCaseBoundary,
} from "../src/eval/phase74Generalization";
import type { Phase74DatasetCase } from "../src/eval/phase74Datasets";
import { createPhase74SelectedDatasetBundle } from "../src/eval/phase74Datasets";
import {
  buildPhase74ProductCandidateConfiguration,
  buildPhase74ProductModelUsageEvidence,
  type Phase74ProductIngestionUsageLedger,
} from "../src/eval/phase74ProductComparison";
import {
  appendPhase74ModelUsageEventSync,
  appendPhase74ModelUsageIntentSync,
  loadPhase74ModelUsageLedger,
  validatePhase74ModelUsageLedger,
  type AttributedModelUsageAttempt,
  type AttributedModelUsageIntent,
  type Phase74ModelUsageLedger,
} from "../src/eval/modelUsage";
import {
  buildPhase74EmbeddingIdentity,
  createPhase74LiveReader,
  phase74LivePromptSha256s,
  resolvePhase74EmbeddingAdapterOptions,
  resolvePhase74EvaluatorSource,
  resolvePhase74LiveModels,
  verifyPhase74EvaluatorSource,
} from "../src/eval/phase74Live";
import {
  buildPhase74ProtocolScoringIdentity,
  createPhase74ProtocolCompatibleAnswerAssessor,
} from "../src/eval/phase74ProtocolScoring";
import {
  PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION,
} from "../src/eval/phase74ProviderConfiguration";
import {
  loadPhase74ProtectionBlueprintDescriptor,
} from "../src/eval/phase74ProtectionSuiteEvidence";
import {
  buildEvalRunIdentity,
  hashEvalExperimentIdentity,
  hashEvalRunIdentity,
  type EvalRunJsonObject,
  type EvalRunIdentity,
  type EvalRunModelIdentity,
} from "../src/eval/runIdentity";
import {
  renderOracleMatrixContext,
  truncateRenderedContext,
} from "../src/eval/oracleMatrix";
import {
  PHASE74_RELEASE_COMMIT,
  PHASE74_RELEASE_REF,
  PHASE74_RELEASE_TREE,
  buildPhase74VersionIngestionKey,
  createPhase74VersionSourceIdentity,
} from "../src/eval/phase74VersionBaseline";
import {
  assertCliPathSegmentValue,
  resolveCliFlagValueStrict,
} from "./cli-options";
import {
  createPhase74DurableCallBudget,
  loadPhase74PreparedDataset,
  selectPhase74GeneralizationCases,
} from "./run-phase-74-generalization";
import {
  buildPhase74ReleaseWorkerInput,
} from "./run-phase-74-version-baseline";
import {
  hashPhase74DependencyTree,
  materializePhase74VersionExecutionRoot,
} from "./phase74-version-worker";
import {
  Phase74VersionChildProcessError,
  buildPhase74VersionPreparedReceiptSet,
  parsePhase74VersionProcessJob,
  parsePhase74VersionProcessOutput,
  runPhase74VersionChildProcess,
  sealPhase74VersionPreparedSnapshot,
  type Phase74VersionPreparedReceipt,
  type Phase74VersionPreparedReceiptSet,
  type Phase74VersionProcessConfig,
} from "./phase74-version-process";
import type {
  AISDKModelConfig,
  FetchLike,
} from "../src/provider/ai-sdk-runtime";

export const PHASE74_PRODUCT_ARMS = [
  "release-v0.6.0",
  "phase74-deterministic-candidate",
] as const;
export const PHASE74_PRODUCT_CASE_SCHEDULING =
  "paired-arms-concurrent-selected-order-v1";

export type Phase74ProductArm = (typeof PHASE74_PRODUCT_ARMS)[number];

export function buildPhase74ProductEvidenceBoundary(input: {
  seenCasesOnly: boolean;
}): EvalRunJsonObject {
  return {
    executionIsolation: "same-process-with-gold-scorer-v1",
    goldAware: true,
    nonPromotionReasons: [
      "gold-material-in-executor-process",
      ...(input.seenCasesOnly ? ["seen-cases-only"] : []),
      "independent-call-budget-pools",
      "deterministic-reranker",
      "unprotected-ledger-format-selection",
    ],
    promotionEligible: false,
    protocolReader: false,
    seenCasesOnly: input.seenCasesOnly,
  };
}

export interface Phase74ProductComparisonOptions {
  benchmark: "locomo" | "longmemeval";
  benchmarkRoot: string;
  caseSelectionSeed: number;
  caseSelectionSize: number;
  embeddingSpendLimitUsd: number;
  maxLanguageCalls: number;
  outputDir: string;
  preparationConcurrency: number;
  protectionBlueprintPath: string;
  releaseArchive: string;
  releaseSourceRoot: string;
  replicate: 1 | 2 | 3;
  runId: string;
  selectedEvidenceLedgerFormat: EvidenceLedgerFormat;
}

export interface Phase74ProductCase {
  caseId: string;
  clusterId: string;
  memoryGroupId: string;
  question: string;
}

export interface Phase74ProductQueryResult {
  context: string;
  contextTokens: number;
  queryPathLatencyMs: number;
  recallLatencyMs: number;
}

export interface Phase74ProductPreparedGroup {
  arm: Phase74ProductArm;
  ingestionKey: string;
  memoryGroupId: string;
  query(testCase: Phase74ProductCase): Promise<Phase74ProductQueryResult>;
}

export interface Phase74ProductComparisonRow {
  answer: string;
  answerLatencyMs: number;
  arm: Phase74ProductArm;
  caseId: string;
  clusterId: string;
  contextTokens: number;
  correct: boolean;
  ingestionKey: string;
  judgeLatencyMs: number;
  memoryGroupId: string;
  productLatencyMs: number;
  queryPathLatencyMs: number;
  recallLatencyMs: number;
  score: number;
}

function requiredFlag(args: readonly string[], name: string): string {
  const value = resolveCliFlagValueStrict(args, name);
  if (value === undefined) {
    throw new Error(`Phase 74 product comparison requires ${name}.`);
  }
  return value;
}

function positiveInteger(value: string, name: string): number {
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Number(value);
}

function positiveNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

export function parsePhase74ProductComparisonCliOptions(
  args: readonly string[],
): Phase74ProductComparisonOptions {
  const benchmark = requiredFlag(args, "--benchmark");
  if (benchmark !== "locomo" && benchmark !== "longmemeval") {
    throw new Error("--benchmark must be locomo or longmemeval.");
  }
  const replicate = positiveInteger(
    requiredFlag(args, "--replicate"),
    "--replicate",
  );
  if (replicate !== 1 && replicate !== 2 && replicate !== 3) {
    throw new Error("--replicate must be 1, 2, or 3.");
  }
  const selectedEvidenceLedgerFormat = requiredFlag(
    args,
    "--selected-evidence-ledger-format",
  );
  if (
    selectedEvidenceLedgerFormat !== "prose" &&
    selectedEvidenceLedgerFormat !== "chronology" &&
    selectedEvidenceLedgerFormat !== "compact_json" &&
    selectedEvidenceLedgerFormat !== "json_locale_note"
  ) {
    throw new Error("--selected-evidence-ledger-format is invalid.");
  }
  const runId = requiredFlag(args, "--run-id");
  assertCliPathSegmentValue({ flag: "--run-id", value: runId });
  return {
    benchmark,
    benchmarkRoot: requiredFlag(args, "--benchmark-root"),
    caseSelectionSeed: positiveInteger(
      requiredFlag(args, "--case-selection-seed"),
      "--case-selection-seed",
    ),
    caseSelectionSize: positiveInteger(
      requiredFlag(args, "--case-selection-size"),
      "--case-selection-size",
    ),
    embeddingSpendLimitUsd: positiveNumber(
      requiredFlag(args, "--embedding-spend-limit-usd"),
      "--embedding-spend-limit-usd",
    ),
    maxLanguageCalls: positiveInteger(
      requiredFlag(args, "--max-language-calls"),
      "--max-language-calls",
    ),
    outputDir: requiredFlag(args, "--output-dir"),
    preparationConcurrency: positiveInteger(
      requiredFlag(args, "--preparation-concurrency"),
      "--preparation-concurrency",
    ),
    protectionBlueprintPath: requiredFlag(args, "--protection-blueprint"),
    releaseArchive: requiredFlag(args, "--release-archive"),
    releaseSourceRoot: requiredFlag(args, "--release-source-root"),
    replicate,
    runId,
    selectedEvidenceLedgerFormat,
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Phase 74 product candidate configuration is invalid.");
  }
  return value as Record<string, unknown>;
}

export function buildPhase74ProductRunIdentityConfiguration(input: {
  candidateConfiguration: EvalRunJsonObject;
  candidateSource: EvalRunJsonObject;
  releaseDependencyTreeSha256: string;
  releaseSource: EvalRunJsonObject;
  replicate: 1 | 2 | 3;
  selectedEvidenceLedgerFormat: EvidenceLedgerFormat;
  seenCasesOnly: boolean;
}): EvalRunJsonObject {
  const planner = objectValue(input.candidateConfiguration.planner);
  const retrieval = objectValue(input.candidateConfiguration.retrieval);
  const evidenceLedger = objectValue(
    input.candidateConfiguration.evidenceLedger,
  );
  const embedding = objectValue(
    input.candidateConfiguration.embedding,
  ) as EvalRunJsonObject;
  if (
    !/^[0-9a-f]{64}$/iu.test(input.releaseDependencyTreeSha256) ||
    input.candidateConfiguration.caseScheduling !==
      PHASE74_PRODUCT_CASE_SCHEDULING ||
    input.candidateConfiguration.representation !==
      "atomic-contextual-raw-pointer" ||
    planner.mode !== "deterministic" ||
    retrieval.recallPlanExecution !== true ||
    JSON.stringify(retrieval.generalizedFusionChannels) !== JSON.stringify([
      "lexical",
      "dense",
      "entity",
      "temporal",
      "relation",
    ]) ||
    evidenceLedger.format !== input.selectedEvidenceLedgerFormat
  ) {
    throw new Error("Phase 74 final product configuration drifted.");
  }
  return {
    arms: {
      baseline: "release-v0.6.0",
      candidate: "phase74-deterministic-candidate",
    },
    candidateConfiguration: input.candidateConfiguration,
    candidateSource: input.candidateSource,
    comparisonKind: "cumulative-product-diagnostic",
    costBoundary: "full-product",
    embeddingRoutingByArm: {
      baseline: embedding,
      candidate: embedding,
    },
    evidenceBoundary: buildPhase74ProductEvidenceBoundary({
      seenCasesOnly: input.seenCasesOnly,
    }),
    releaseDependencyTreeSha256:
      input.releaseDependencyTreeSha256.toLowerCase(),
    releaseSource: input.releaseSource,
    replicate: input.replicate,
    selectedEvidenceLedgerFormat: input.selectedEvidenceLedgerFormat,
  };
}

function assertUniqueCases(cases: readonly Phase74ProductCase[]): void {
  if (
    cases.length === 0 ||
    new Set(cases.map(({ caseId }) => caseId)).size !== cases.length ||
    cases.some(({ caseId, clusterId, memoryGroupId, question }) =>
      caseId.length === 0 ||
      clusterId.length === 0 ||
      memoryGroupId.length === 0 ||
      question.length === 0
    )
  ) {
    throw new Error("Phase 74 product cases must be unique and non-empty.");
  }
}

function assertPreparedGroup(input: {
  arm: Phase74ProductArm;
  memoryGroupId: string;
  prepared: Phase74ProductPreparedGroup;
}): void {
  if (
    input.prepared.arm !== input.arm ||
    input.prepared.memoryGroupId !== input.memoryGroupId ||
    input.prepared.ingestionKey.length === 0
  ) {
    throw new Error("Phase 74 prepared product memory group drifted.");
  }
}

export async function runPhase74ProductComparison(input: {
  cases: readonly Phase74ProductCase[];
  prepare(value: {
    arm: Phase74ProductArm;
    cases: readonly Phase74ProductCase[];
    memoryGroupId: string;
  }): Promise<Phase74ProductPreparedGroup>;
  read(value: {
    arm: Phase74ProductArm;
    caseId: string;
    context: string;
    question: string;
    selectedEvidenceLedgerFormat: EvidenceLedgerFormat;
  }): Promise<{ answer: string; latencyMs: number }>;
  score(value: {
    answer: string;
    arm: Phase74ProductArm;
    caseId: string;
    testCase: Phase74ProductCase;
  }): Promise<{ correct: boolean; latencyMs: number; score: number }>;
  preparationConcurrency: number;
  selectedEvidenceLedgerFormat: EvidenceLedgerFormat;
}): Promise<{
  rows: Phase74ProductComparisonRow[];
  selectedEvidenceLedgerFormat: EvidenceLedgerFormat;
}> {
  assertUniqueCases(input.cases);
  const grouped = new Map<string, Phase74ProductCase[]>();
  for (const testCase of input.cases) {
    grouped.set(testCase.memoryGroupId, [
      ...(grouped.get(testCase.memoryGroupId) ?? []),
      testCase,
    ]);
  }
  const prepared = new Map<string, Phase74ProductPreparedGroup>();
  if (
    !Number.isSafeInteger(input.preparationConcurrency) ||
    input.preparationConcurrency <= 0
  ) {
    throw new Error(
      "Phase 74 product preparation concurrency must be a positive integer.",
    );
  }
  const preparationJobs = PHASE74_PRODUCT_ARMS.flatMap((arm) =>
    [...grouped].map(([memoryGroupId, cases]) => ({
      arm,
      cases,
      memoryGroupId,
    }))
  );
  let nextPreparationJob = 0;
  let preparationError: unknown;
  const prepareWorker = async () => {
    while (preparationError === undefined) {
      const jobIndex = nextPreparationJob;
      nextPreparationJob += 1;
      const job = preparationJobs[jobIndex];
      if (job === undefined) {
        return;
      }
      try {
        const value = await input.prepare(job);
        assertPreparedGroup({
          arm: job.arm,
          memoryGroupId: job.memoryGroupId,
          prepared: value,
        });
        prepared.set(`${job.arm}/${job.memoryGroupId}`, value);
      } catch (error) {
        preparationError ??= error;
      }
    }
  };
  await Promise.all(Array.from({
    length: Math.min(input.preparationConcurrency, preparationJobs.length),
  }, prepareWorker));
  if (preparationError !== undefined) {
    throw preparationError;
  }

  const rows: Phase74ProductComparisonRow[] = [];
  for (const testCase of input.cases) {
    const paired = await Promise.allSettled(PHASE74_PRODUCT_ARMS.map(async (arm) => {
      const group = prepared.get(`${arm}/${testCase.memoryGroupId}`)!;
      const query = await group.query(testCase);
      const reader = await input.read({
        arm,
        caseId: testCase.caseId,
        context: query.context,
        question: testCase.question,
        selectedEvidenceLedgerFormat: input.selectedEvidenceLedgerFormat,
      });
      const assessment = await input.score({
        answer: reader.answer,
        arm,
        caseId: testCase.caseId,
        testCase,
      });
      return {
        answer: reader.answer,
        answerLatencyMs: reader.latencyMs,
        arm,
        caseId: testCase.caseId,
        clusterId: testCase.clusterId,
        contextTokens: query.contextTokens,
        correct: assessment.correct,
        ingestionKey: group.ingestionKey,
        judgeLatencyMs: assessment.latencyMs,
        memoryGroupId: testCase.memoryGroupId,
        productLatencyMs: query.queryPathLatencyMs + reader.latencyMs,
        queryPathLatencyMs: query.queryPathLatencyMs,
        recallLatencyMs: query.recallLatencyMs,
        score: assessment.score,
      } satisfies Phase74ProductComparisonRow;
    }));
    const pairedRows: Phase74ProductComparisonRow[] = [];
    for (const entry of paired) {
      if (entry.status === "rejected") {
        throw entry.reason;
      }
      pairedRows.push(entry.value);
    }
    rows.push(...pairedRows);
  }
  return {
    rows,
    selectedEvidenceLedgerFormat: input.selectedEvidenceLedgerFormat,
  };
}

export function buildPhase74ProductQueryPathLatencyMs(input: {
  contextAssemblyLatencyMs: number;
  recallLatencyMs: number;
}): number {
  return Math.max(
    0,
    input.recallLatencyMs + input.contextAssemblyLatencyMs,
  );
}

export function createPhase74ProductNetworkFetch(input: {
  fetch: FetchLike;
  model: AISDKModelConfig;
}): FetchLike {
  return resolvePhase74EmbeddingAdapterOptions(
    input.model,
    input.fetch,
  ).fetch ?? input.fetch;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(path: string): Promise<string> {
  return sha256(await readFile(path));
}

function publicModelIdentity(model: {
  baseURL?: string;
  model: string;
  provider: string;
}): EvalRunModelIdentity {
  return {
    gateway: model.baseURL ?? "",
    model: model.model,
    provider: model.provider,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

type Phase74ProductTerminalFileEvidence =
  | {
      exists: false;
    }
  | {
      exists: true;
      sha256: string;
      sizeBytes: number;
    }
  | {
      errorFingerprint: string;
      exists: "unreadable";
    };

interface Phase74ProductTerminalPaths {
  candidateBudgetPath: string;
  candidateEventsPath: string;
  candidateIntentsPath: string;
  datasetManifestPath: string;
  releaseBudgetPath: string;
  releaseEventsPath: string;
  releaseIntentsPath: string;
  reportPath: string;
}

export interface Phase74ProductAttemptTerminal {
  completedReceiptSetSha256: string | null;
  errorFingerprint: string | null;
  evidence: {
    candidateBudget: Phase74ProductTerminalFileEvidence;
    candidateUsage: Phase74ProductTerminalUsageEvidence;
    datasetManifest: Phase74ProductTerminalFileEvidence;
    releaseBudget: Phase74ProductTerminalFileEvidence;
    releaseUsage: Phase74ProductTerminalUsageEvidence;
    report: Phase74ProductTerminalFileEvidence;
  };
  identityHash: string;
  process: {
    failed: {
      exitCode: number;
      pid: number;
      stderrSha256: string;
    } | null;
    successfulPids: number[];
  };
  schemaVersion: 1;
  status: "failed" | "succeeded";
}

interface Phase74ProductTerminalUsageEvidence {
  eventCount: number | null;
  events: Phase74ProductTerminalFileEvidence;
  intentCount: number | null;
  intents: Phase74ProductTerminalFileEvidence;
  pendingIntentCount: number | null;
  reconciled: boolean;
  reconciliationErrorFingerprint?: string;
}

function errorFingerprint(error: unknown): string {
  const descriptor = error instanceof Error
    ? `${error.name}\u0000${error.message}`
    : String(error);
  return sha256(descriptor);
}

async function terminalFileEvidence(
  path: string,
): Promise<Phase74ProductTerminalFileEvidence> {
  try {
    const bytes = await readFile(path);
    return {
      exists: true,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
    };
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { exists: false };
    }
    return {
      errorFingerprint: errorFingerprint(error),
      exists: "unreadable",
    };
  }
}

async function terminalUsageEvidence(input: {
  eventsPath: string;
  intentsPath: string;
}): Promise<Phase74ProductTerminalUsageEvidence> {
  const [events, intents] = await Promise.all([
    terminalFileEvidence(input.eventsPath),
    terminalFileEvidence(input.intentsPath),
  ]);
  if (events.exists !== true || intents.exists !== true) {
    return {
      eventCount: null,
      events,
      intentCount: null,
      intents,
      pendingIntentCount: null,
      reconciled: false,
    };
  }
  try {
    const ledger = await loadPhase74ModelUsageLedger(input);
    return {
      eventCount: ledger.events.length,
      events,
      intentCount: ledger.intents.length,
      intents,
      pendingIntentCount: ledger.pendingIntents.length,
      reconciled: ledger.pendingIntents.length === 0,
    };
  } catch (error) {
    return {
      eventCount: null,
      events,
      intentCount: null,
      intents,
      pendingIntentCount: null,
      reconciled: false,
      reconciliationErrorFingerprint: errorFingerprint(error),
    };
  }
}

export async function buildPhase74ProductAttemptTerminal(input: {
  completedReceiptSetSha256?: string;
  error?: unknown;
  identityHash: string;
  paths: Phase74ProductTerminalPaths;
  process: Phase74ProductAttemptTerminal["process"];
  status: Phase74ProductAttemptTerminal["status"];
}): Promise<Phase74ProductAttemptTerminal> {
  if (
    !/^[a-f0-9]{64}$/u.test(input.identityHash) ||
    (
      input.completedReceiptSetSha256 !== undefined &&
      !/^[a-f0-9]{64}$/u.test(input.completedReceiptSetSha256)
    ) ||
    input.process.successfulPids.some((pid) =>
      !Number.isSafeInteger(pid) || pid <= 0
    ) ||
    (input.status === "failed") !== (input.error !== undefined)
  ) {
    throw new Error("Phase 74 product attempt terminal input drifted.");
  }
  const [
    candidateBudget,
    candidateUsage,
    datasetManifest,
    releaseBudget,
    releaseUsage,
    report,
  ] =
    await Promise.all([
      terminalFileEvidence(input.paths.candidateBudgetPath),
      terminalUsageEvidence({
        eventsPath: input.paths.candidateEventsPath,
        intentsPath: input.paths.candidateIntentsPath,
      }),
      terminalFileEvidence(input.paths.datasetManifestPath),
      terminalFileEvidence(input.paths.releaseBudgetPath),
      terminalUsageEvidence({
        eventsPath: input.paths.releaseEventsPath,
        intentsPath: input.paths.releaseIntentsPath,
      }),
      terminalFileEvidence(input.paths.reportPath),
    ]);
  if (
    input.status === "succeeded" &&
    (
      input.completedReceiptSetSha256 === undefined ||
      input.process.failed !== null ||
      input.process.successfulPids.length === 0 ||
      candidateBudget.exists !== true ||
      datasetManifest.exists !== true ||
      releaseBudget.exists !== true ||
      report.exists !== true ||
      !candidateUsage.reconciled ||
      !releaseUsage.reconciled
    )
  ) {
    throw new Error(
      "Phase 74 product success terminal evidence is incomplete.",
    );
  }
  return {
    completedReceiptSetSha256:
      input.completedReceiptSetSha256 ?? null,
    errorFingerprint: input.error === undefined
      ? null
      : errorFingerprint(input.error),
    evidence: {
      candidateBudget,
      candidateUsage,
      datasetManifest,
      releaseBudget,
      releaseUsage,
      report,
    },
    identityHash: input.identityHash,
    process: {
      failed: input.process.failed,
      successfulPids: [...input.process.successfulPids].sort(
        (left, right) => left - right,
      ),
    },
    schemaVersion: 1,
    status: input.status,
  };
}

export async function writePhase74ProductAttemptTerminal(input: {
  path: string;
  terminal: Phase74ProductAttemptTerminal;
}): Promise<{ path: string; sha256: string }> {
  await writeJson(input.path, input.terminal);
  return {
    path: input.path,
    sha256: await sha256File(input.path),
  };
}

export async function verifyPhase74ProductAttemptTerminal(input: {
  path: string;
  paths: Phase74ProductTerminalPaths;
}): Promise<Phase74ProductAttemptTerminal> {
  const value: unknown = JSON.parse(await readFile(input.path, "utf8"));
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("Phase 74 product attempt terminal is invalid.");
  }
  const terminal = value as Phase74ProductAttemptTerminal;
  const failedProcess = terminal.process?.failed;
  if (
    terminal.schemaVersion !== 1 ||
    (terminal.status !== "failed" && terminal.status !== "succeeded") ||
    !/^[a-f0-9]{64}$/u.test(terminal.identityHash) ||
    (
      terminal.completedReceiptSetSha256 !== null &&
      !/^[a-f0-9]{64}$/u.test(terminal.completedReceiptSetSha256)
    ) ||
    (
      terminal.errorFingerprint !== null &&
      !/^[a-f0-9]{64}$/u.test(terminal.errorFingerprint)
    ) ||
    terminal.evidence === undefined ||
    terminal.process === undefined ||
    !Array.isArray(terminal.process.successfulPids) ||
    terminal.process.successfulPids.some(
      (pid) => !Number.isSafeInteger(pid) || pid <= 0,
    ) ||
    new Set(terminal.process.successfulPids).size !==
      terminal.process.successfulPids.length ||
    (
      failedProcess !== null &&
      (
        failedProcess === undefined ||
        !Number.isSafeInteger(failedProcess.exitCode) ||
        !Number.isSafeInteger(failedProcess.pid) ||
        failedProcess.pid <= 0 ||
        !/^[a-f0-9]{64}$/u.test(failedProcess.stderrSha256)
      )
    ) ||
    (
      terminal.status === "succeeded" &&
      (
        terminal.completedReceiptSetSha256 === null ||
        terminal.errorFingerprint !== null ||
        failedProcess !== null ||
        terminal.process.successfulPids.length === 0
      )
    ) ||
    (
      terminal.status === "failed" &&
      terminal.errorFingerprint === null
    )
  ) {
    throw new Error("Phase 74 product attempt terminal is invalid.");
  }
  const [
    candidateBudget,
    candidateUsage,
    datasetManifest,
    releaseBudget,
    releaseUsage,
    report,
  ] = await Promise.all([
    terminalFileEvidence(input.paths.candidateBudgetPath),
    terminalUsageEvidence({
      eventsPath: input.paths.candidateEventsPath,
      intentsPath: input.paths.candidateIntentsPath,
    }),
    terminalFileEvidence(input.paths.datasetManifestPath),
    terminalFileEvidence(input.paths.releaseBudgetPath),
    terminalUsageEvidence({
      eventsPath: input.paths.releaseEventsPath,
      intentsPath: input.paths.releaseIntentsPath,
    }),
    terminalFileEvidence(input.paths.reportPath),
  ]);
  if (
    JSON.stringify(terminal.evidence) !== JSON.stringify({
      candidateBudget,
      candidateUsage,
      datasetManifest,
      releaseBudget,
      releaseUsage,
      report,
    })
  ) {
    throw new Error("Phase 74 product attempt terminal artifact drifted.");
  }
  if (terminal.status === "failed") {
    return terminal;
  }
  const root = dirname(input.path);
  const runIdentity = JSON.parse(
    await readFile(join(root, "run-identity.json"), "utf8"),
  ) as EvalRunIdentity;
  const identityHash = hashEvalRunIdentity(runIdentity);
  const rawReceiptSet: unknown = JSON.parse(
    await readFile(
      join(root, "release", "prepared-receipts.json"),
      "utf8",
    ),
  );
  if (
    rawReceiptSet === null ||
    typeof rawReceiptSet !== "object" ||
    Array.isArray(rawReceiptSet) ||
    !Array.isArray(
      (rawReceiptSet as { receipts?: unknown }).receipts,
    )
  ) {
    throw new Error("Phase 74 product attempt terminal drifted.");
  }
  const receiptSet = buildPhase74VersionPreparedReceiptSet(
    (rawReceiptSet as Phase74VersionPreparedReceiptSet).receipts,
  );
  const reportValue: unknown = JSON.parse(
    await readFile(input.paths.reportPath, "utf8"),
  );
  if (
    reportValue === null ||
    typeof reportValue !== "object" ||
    Array.isArray(reportValue)
  ) {
    throw new Error("Phase 74 product attempt terminal drifted.");
  }
  const reportRecord = reportValue as Record<string, unknown>;
  const reportReceiptSet = reportRecord.releasePreparedReceiptSet;
  const reportProcessPids = reportRecord.releaseProcessPids;
  if (
    identityHash !== terminal.identityHash ||
    terminal.completedReceiptSetSha256 !== receiptSet.receiptSetSha256 ||
    reportRecord.identityHash !== terminal.identityHash ||
    !Array.isArray(reportProcessPids) ||
    reportProcessPids.some(
      (pid) => !Number.isSafeInteger(pid) || Number(pid) <= 0,
    ) ||
    JSON.stringify(reportProcessPids) !==
      JSON.stringify(terminal.process.successfulPids) ||
    reportReceiptSet === null ||
    typeof reportReceiptSet !== "object" ||
    Array.isArray(reportReceiptSet) ||
    (
      reportReceiptSet as Record<string, unknown>
    ).receiptSetSha256 !== terminal.completedReceiptSetSha256
  ) {
    throw new Error("Phase 74 product attempt terminal drifted.");
  }
  return terminal;
}

export async function commitPhase74ProductSuccessArtifacts(input: {
  datasetManifest: unknown;
  report: unknown;
  terminalInput: Parameters<
    typeof buildPhase74ProductAttemptTerminal
  >[0];
  terminalPath: string;
}): Promise<{
  artifact: { path: string; sha256: string };
  terminal: Phase74ProductAttemptTerminal;
}> {
  if (
    input.terminalInput.status !== "succeeded" ||
    input.terminalInput.error !== undefined
  ) {
    throw new Error("Phase 74 product success commit input drifted.");
  }
  try {
    await writeJson(
      input.terminalInput.paths.datasetManifestPath,
      input.datasetManifest,
    );
    await writeJson(
      input.terminalInput.paths.reportPath,
      input.report,
    );
    const terminal = await buildPhase74ProductAttemptTerminal(
      input.terminalInput,
    );
    return {
      artifact: await writePhase74ProductAttemptTerminal({
        path: input.terminalPath,
        terminal,
      }),
      terminal,
    };
  } catch (error) {
    const terminal = await buildPhase74ProductAttemptTerminal({
      ...input.terminalInput,
      error,
      status: "failed",
    });
    try {
      await writePhase74ProductAttemptTerminal({
        path: input.terminalPath,
        terminal,
      });
    } catch (terminalError) {
      throw new AggregateError(
        [error, terminalError],
        "Phase 74 product success commit and failure terminal both failed.",
      );
    }
    throw error;
  }
}

function subsetUsageLedger(input: {
  branch: "shadow";
  caseId: string;
  ledger: Phase74ModelUsageLedger;
}): Phase74ModelUsageLedger {
  const intents = input.ledger.intents.filter(
    ({ branch, caseId }) =>
      branch === input.branch && caseId === input.caseId,
  );
  const requestIds = new Set(intents.map(({ requestId }) => requestId));
  return validatePhase74ModelUsageLedger({
    events: input.ledger.events.filter(({ requestId }) =>
      requestIds.has(requestId)
    ),
    intents,
  });
}

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * 0.95)]!;
}

export async function runPhase74LiveProductComparison(
  options: Phase74ProductComparisonOptions,
  env: Record<string, string | undefined> = process.env,
): Promise<{ reportPath: string; runDirectory: string }> {
  const root = resolve(options.outputDir);
  const runDirectory = join(root, options.runId);
  await mkdir(root, { recursive: true });
  const releaseDirectory = join(runDirectory, "release");
  const candidateDirectory = join(runDirectory, "candidate");
  const attemptTerminalPath = join(runDirectory, "attempt-terminal.json");
  const datasetManifestPath = join(runDirectory, "dataset-manifest.json");
  const reportPath = join(runDirectory, "report.json");
  const candidateBudgetPath = join(
    runDirectory,
    "candidate-call-budget.json",
  );
  const candidateUsagePath = join(runDirectory, "model-usage.jsonl");
  const candidateUsageIntentsPath = join(
    runDirectory,
    "model-usage-intents.jsonl",
  );
  const releaseBudgetPath = join(releaseDirectory, "call-budget.json");
  const releaseUsagePath = join(releaseDirectory, "model-usage.jsonl");
  const releaseUsageIntentsPath = join(
    releaseDirectory,
    "model-usage-intents.jsonl",
  );
  const releaseProcessPids = new Set<number>();
  let releasePreparedReceiptSet: Phase74VersionPreparedReceiptSet | undefined;

  const preparedDataset = await loadPhase74PreparedDataset({
    benchmark: options.benchmark,
    benchmarkRoot: options.benchmarkRoot,
  });
  const selection = selectPhase74GeneralizationCases({
    cases: preparedDataset.cases,
    seed: options.caseSelectionSeed,
    size: options.caseSelectionSize,
  });
  const dataset = createPhase74SelectedDatasetBundle({
    bundle: preparedDataset,
    cases: selection.cases,
  });
  const selectedCases = dataset.cases;
  const models = resolvePhase74LiveModels(env);
  const evaluatorSource = await verifyPhase74EvaluatorSource({
    declared: resolvePhase74EvaluatorSource(env),
    repoRoot: process.cwd(),
  });
  const protectionBlueprint =
    await loadPhase74ProtectionBlueprintDescriptor(
      options.protectionBlueprintPath,
    );
  const promptSha256s = phase74LivePromptSha256s();
  const selectedCaseIdsSha256 = sha256(
    JSON.stringify(selectedCases.map(({ caseId }) => caseId)),
  );
  const scoring = buildPhase74ProtocolScoringIdentity(
    options.benchmark,
    publicModelIdentity(models.judge),
  );
  const baseConfiguration: EvalRunJsonObject = {
    answer: {
      maxTokens: 512,
      reasoningEffort: "medium",
      temperature: 0,
    },
    callBudget: {
      accounting: "independent-process-pools-v1",
      embeddingSpendLimitUsd: options.embeddingSpendLimitUsd,
      maxLanguageCallsPerPool: options.maxLanguageCalls,
      pools: ["candidate-and-scoring", "release-v0.6.0"],
    },
    caseScheduling: PHASE74_PRODUCT_CASE_SCHEDULING,
    context: {
      maxTokens: 6_000,
      tokenizer: "utf8-byte-upper-bound-v1",
    },
    costBoundary: "full-product-process-isolated-v2",
    dataset: dataset.manifest as unknown as EvalRunJsonObject,
    embedding: buildPhase74EmbeddingIdentity(models.embedding),
    evaluatorSource,
    modelUsageAccounting: "phase74-model-usage-v2",
    preRankLimit: 32,
    preparationConcurrency: options.preparationConcurrency,
    providerObjectCalls: PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION,
    protectionBlueprint,
    reader: "generic-label-free-v1",
    replicate: options.replicate,
    reranker: {
      implementation: "lexical-coverage-v1",
      mode: "deterministic",
    },
    scoring,
    selection: selection.identity,
    selectedCaseIdsSha256,
    selectedLimit: 12,
    seenCasesOnly: true,
  };
  const candidateConfiguration = buildPhase74ProductCandidateConfiguration({
    base: baseConfiguration,
    selectedEvidenceLedgerFormat:
      options.selectedEvidenceLedgerFormat,
  });
  const releaseSource = createPhase74VersionSourceIdentity({
    archiveSha256: await sha256File(options.releaseArchive),
    arm: "release",
    commit: PHASE74_RELEASE_COMMIT,
    lockfileSha256: await sha256File(
      join(options.releaseSourceRoot, "bun.lock"),
    ),
    ref: PHASE74_RELEASE_REF,
    tree: PHASE74_RELEASE_TREE,
    workerSha256: await sha256File(
      join(process.cwd(), "scripts/phase74-version-worker.ts"),
    ),
  });
  const releaseDependencyTreeSha256 = await hashPhase74DependencyTree(
    join(options.releaseSourceRoot, "node_modules"),
  );
  const configuration = buildPhase74ProductRunIdentityConfiguration({
    candidateConfiguration,
    candidateSource: evaluatorSource,
    releaseDependencyTreeSha256,
    releaseSource: releaseSource as unknown as EvalRunJsonObject,
    replicate: options.replicate,
    selectedEvidenceLedgerFormat:
      options.selectedEvidenceLedgerFormat,
    seenCasesOnly: true,
  });
  const identity = buildEvalRunIdentity({
    answerModel: publicModelIdentity(models.answer),
    benchmark: `${options.benchmark}-product-comparison`,
    configuration,
    datasetSha256: dataset.manifest.datasetSha256,
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/run-phase-74-product-comparison.ts",
    judgeModel: publicModelIdentity(models.judge),
    promptSha256s,
    runId: options.runId,
  });
  const executionIdentityHash = hashEvalRunIdentity(identity);
  await mkdir(runDirectory);
  try {
  await writeJson(join(runDirectory, "run-identity.json"), identity);
  await Promise.all([
    mkdir(releaseDirectory),
    mkdir(candidateDirectory),
  ]);
  const releaseExecutionRoot =
    await materializePhase74VersionExecutionRoot({
      archivePath: options.releaseArchive,
      dependencyRoot: options.releaseSourceRoot,
      executionRoot: join(runDirectory, "release-source"),
    });

  const events: AttributedModelUsageAttempt[] = [];
  const intents: AttributedModelUsageIntent[] = [];
  const onUsageEvent = (event: AttributedModelUsageAttempt) =>
    appendPhase74ModelUsageEventSync(candidateUsagePath, event);
  const onUsageIntent = (intent: AttributedModelUsageIntent) =>
    appendPhase74ModelUsageIntentSync(candidateUsageIntentsPath, intent);
  const originalFetch = globalThis.fetch;
  const callBudget = createPhase74DurableCallBudget({
    embeddingSpendLimitUsd: options.embeddingSpendLimitUsd,
    fetch: originalFetch,
    maxLanguageCalls: options.maxLanguageCalls,
    path: candidateBudgetPath,
  });
  const productNetworkFetch = createPhase74ProductNetworkFetch({
    fetch: callBudget.fetch,
    model: models.embedding,
  });
  globalThis.fetch = productNetworkFetch as typeof globalThis.fetch;

  const reader = createPhase74LiveReader({
    events,
    intents,
    model: models.answer,
    onUsageEvent,
    onUsageIntent,
  });
  const assessor = createPhase74ProtocolCompatibleAnswerAssessor({
    benchmark: options.benchmark,
    events,
    intents,
    model: models.judge,
    onUsageEvent,
    onUsageIntent,
  });
  const candidateRuntime = createPhase74FullRetrievalRuntime({
    datasetSha256: dataset.manifest.datasetSha256,
    evidenceLedgerFormats: [options.selectedEvidenceLedgerFormat],
    evaluatorSourceSha256: evaluatorSource.sha256,
    events,
    intents,
    models,
    onUsageEvent,
    onUsageIntent,
    promptSha256s,
    rerankerMode: "deterministic",
    runDirectory: candidateDirectory,
  });
  const casesByOpaqueId = new Map<string, {
    boundary: ReturnType<typeof buildPhase74LabelFreeCaseBoundary>;
    testCase: Phase74DatasetCase;
  }>();
  const productCases = selectedCases.map((testCase) => {
    const boundary = buildPhase74LabelFreeCaseBoundary(testCase);
    casesByOpaqueId.set(boundary.caseKey, { boundary, testCase });
    return {
      caseId: boundary.caseKey,
      clusterId:
        boundary.recallCase.memoryGroupId ?? boundary.caseKey,
      memoryGroupId:
        boundary.recallCase.memoryGroupId ?? boundary.caseKey,
      question: boundary.recallCase.question,
    };
  });
  const candidateIngestionKeys = new Map<string, string>();
  const releaseIngestionKeys = new Map<string, string>();
  const releasePrepared = new Map<string, Phase74VersionPreparedReceipt>();
  const releaseProcessConfig: Phase74VersionProcessConfig = {
    callBudget: {
      embeddingSpendLimitUsd: options.embeddingSpendLimitUsd,
      maxLanguageCalls: options.maxLanguageCalls,
      path: releaseBudgetPath,
    },
    preparationConcurrency: options.preparationConcurrency,
    releaseSourceRoot: releaseExecutionRoot,
    usage: {
      eventsPath: releaseUsagePath,
      intentsPath: releaseUsageIntentsPath,
    },
  };
  const releaseProcessScript = join(
    process.cwd(),
    "scripts/phase74-version-process.ts",
  );
  const releaseGroups = new Map<string, {
    ingestionKey: string;
    input: ReturnType<typeof buildPhase74ReleaseWorkerInput>;
    sqlitePath: string;
  }>();
  for (const productCase of productCases) {
    if (releaseGroups.has(productCase.memoryGroupId)) {
      continue;
    }
    const current = casesByOpaqueId.get(productCase.caseId)!;
    const releaseInput = buildPhase74ReleaseWorkerInput(current.testCase);
    const ingestionKey = buildPhase74VersionIngestionKey({
      configurationSha256: sha256(JSON.stringify({
        embedding: publicModelIdentity(models.embedding),
        extraction: publicModelIdentity(models.assistedExtraction),
        profile: "v0.6.0-recommended",
      })),
      datasetSha256: dataset.manifest.datasetSha256,
      memoryGroupId: productCase.memoryGroupId,
      rawEvidence: releaseInput.rawEvidence,
      sourceCommit: PHASE74_RELEASE_COMMIT,
    });
    const sqlitePath = join(
      releaseDirectory,
      `${sha256(ingestionKey)}.sqlite`,
    );
    releaseGroups.set(productCase.memoryGroupId, {
      ingestionKey,
      input: releaseInput,
      sqlitePath,
    });
    releaseIngestionKeys.set(productCase.memoryGroupId, ingestionKey);
  }

  let result: Awaited<ReturnType<typeof runPhase74ProductComparison>>;
  try {
    const preparedChild = await runPhase74VersionChildProcess({
      config: releaseProcessConfig,
      cwd: process.cwd(),
      env,
      job: parsePhase74VersionProcessJob({
        action: "prepare",
        groups: [...releaseGroups.values()].map(({
          ingestionKey,
          input,
          sqlitePath,
        }) => ({
          executionIdentityHash,
          ingestionKey,
          input,
          sqlitePath,
        })),
        schemaVersion: 1,
      }),
      script: releaseProcessScript,
    });
    releaseProcessPids.add(preparedChild.pid);
    const preparedOutput = parsePhase74VersionProcessOutput(
      JSON.parse(preparedChild.stdout),
    );
    if (
      preparedOutput.action !== "prepare" ||
      preparedOutput.groups.length !== releaseGroups.size
    ) {
      throw new Error("Phase 74 release process preparation drifted.");
    }
    const sealedReceipts = await Promise.all(
      preparedOutput.groups.map(async (prepared) => {
        const expected = releaseGroups.get(prepared.memoryGroupId);
        if (
          expected === undefined ||
          expected.ingestionKey !== prepared.ingestionKey ||
          expected.sqlitePath !== prepared.sqlitePath ||
          prepared.executionIdentityHash !== executionIdentityHash
        ) {
          throw new Error("Phase 74 release process memory group drifted.");
        }
        return sealPhase74VersionPreparedSnapshot({
          prepared,
          snapshotRoot: join(releaseDirectory, "sealed-snapshots"),
        });
      }),
    );
    releasePreparedReceiptSet = buildPhase74VersionPreparedReceiptSet(
      sealedReceipts,
    );
    for (const prepared of releasePreparedReceiptSet.receipts) {
      releasePrepared.set(prepared.memoryGroupId, prepared);
    }
    await writeJson(
      join(releaseDirectory, "prepared-receipts.json"),
      releasePreparedReceiptSet,
    );

    result = await runPhase74ProductComparison({
      cases: productCases,
      async prepare({ arm, cases, memoryGroupId }) {
        const representative = casesByOpaqueId.get(cases[0]!.caseId)!;
        if (arm === "phase74-deterministic-candidate") {
          const descriptor = buildPhase74IngestionDescriptor({
            configuration: candidateConfiguration,
            datasetSha256: dataset.manifest.datasetSha256,
            evaluatorSourceSha256: evaluatorSource.sha256,
            models,
            promptSha256s,
            testCase: representative.boundary.recallCase,
          });
          candidateIngestionKeys.set(memoryGroupId, descriptor.key);
          await candidateRuntime.prepare({
            arm: "recall-plan-deterministic",
            configuration: candidateConfiguration,
            stage: "E3",
            testCase: representative.boundary.recallCase,
          });
          return {
            arm,
            ingestionKey: descriptor.key,
            memoryGroupId,
            async query(productCase) {
              const current = casesByOpaqueId.get(productCase.caseId)!;
              const snapshot = await candidateRuntime.execute({
                arm: "recall-plan-deterministic",
                configuration: candidateConfiguration,
                stage: "E3",
                testCase: current.boundary.recallCase,
              });
              const truncationStartedAt = performance.now();
              const rendered = await candidateRuntime.render({
                format: options.selectedEvidenceLedgerFormat,
                snapshot,
              });
              const context = truncateRenderedContext({
                content: rendered,
                contextTokenBudget: 6_000,
                countRenderedTokens: (value) =>
                  Buffer.byteLength(value, "utf8"),
              });
              const recallLatencyMs =
                snapshot.recallMetadata?.latencyMs ?? 0;
              const contextAssemblyLatencyMs =
                (
                  snapshot.evidenceLedgerRenderLatencyMs?.[
                    options.selectedEvidenceLedgerFormat
                  ] ?? 0
                ) +
                Math.max(0, performance.now() - truncationStartedAt);
              return {
                context: context.content,
                contextTokens: context.renderedContextTokens,
                queryPathLatencyMs:
                  buildPhase74ProductQueryPathLatencyMs({
                    contextAssemblyLatencyMs,
                    recallLatencyMs,
                  }),
                recallLatencyMs,
              };
            },
          };
        }

        const release = releaseGroups.get(memoryGroupId)!;
        const prepared = releasePrepared.get(memoryGroupId)!;
        return {
          arm,
          ingestionKey: release.ingestionKey,
          memoryGroupId,
          async query(productCase) {
            const current = casesByOpaqueId.get(productCase.caseId)!;
            const workerInput = buildPhase74ReleaseWorkerInput(
              current.testCase,
            );
            const queryChild = await runPhase74VersionChildProcess({
              config: releaseProcessConfig,
              cwd: process.cwd(),
              env,
              job: parsePhase74VersionProcessJob({
                action: "query",
                input: workerInput,
                prepared,
                schemaVersion: 1,
              }),
              script: releaseProcessScript,
            });
            releaseProcessPids.add(queryChild.pid);
            const queryOutput = parsePhase74VersionProcessOutput(
              JSON.parse(queryChild.stdout),
            );
            if (
              queryOutput.action !== "query" ||
              queryOutput.preparedReceiptSha256 !==
                prepared.receiptSha256 ||
              queryOutput.result.caseId !== productCase.caseId
            ) {
              throw new Error("Phase 74 release process query drifted.");
            }
            const snapshot = queryOutput.result;
            const contextStartedAt = performance.now();
            const context = truncateRenderedContext({
              content: renderOracleMatrixContext(
                snapshot.retrievedMemories,
              ),
              contextTokenBudget: 6_000,
              countRenderedTokens: (value) =>
                Buffer.byteLength(value, "utf8"),
            });
            const contextAssemblyLatencyMs = Math.max(
              0,
              performance.now() - contextStartedAt,
            );
            return {
              context: context.content,
              contextTokens: context.renderedContextTokens,
              queryPathLatencyMs:
                buildPhase74ProductQueryPathLatencyMs({
                  contextAssemblyLatencyMs,
                  recallLatencyMs: snapshot.recallLatencyMs,
                }),
              recallLatencyMs: snapshot.recallLatencyMs,
            };
          },
        };
      },
      async read({ arm, caseId, context, question }) {
        const startedAt = performance.now();
        const answer = await reader({
          caseId,
          context,
          purpose: arm === "release-v0.6.0"
            ? "final:baseline:product"
            : "final:candidate:product",
          question,
        });
        return {
          answer,
          latencyMs: Math.max(0, performance.now() - startedAt),
        };
      },
      async score({ answer, arm, caseId }) {
        const startedAt = performance.now();
        const assessment = await assessor({
          answer,
          purpose: arm === "release-v0.6.0"
            ? "final:baseline:product"
            : "final:candidate:product",
          testCase: casesByOpaqueId.get(caseId)!.testCase,
          usageCaseId: caseId,
        });
        return {
          ...assessment,
          latencyMs: Math.max(0, performance.now() - startedAt),
        };
      },
      preparationConcurrency: options.preparationConcurrency,
      selectedEvidenceLedgerFormat:
        options.selectedEvidenceLedgerFormat,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const releaseDirect = await loadPhase74ModelUsageLedger({
    eventsPath: releaseUsagePath,
    intentsPath: releaseUsageIntentsPath,
  });
  const direct = validatePhase74ModelUsageLedger({
    events: [...events, ...releaseDirect.events],
    intents: [...intents, ...releaseDirect.intents],
  });
  const memoryGroupIds = [...new Set(
    productCases.map(({ memoryGroupId }) => memoryGroupId),
  )];
  const baselineIngestion: Phase74ProductIngestionUsageLedger[] =
    memoryGroupIds.map((memoryGroupId) => ({
      key: releaseIngestionKeys.get(memoryGroupId)!,
      ledger: subsetUsageLedger({
        branch: "shadow",
        caseId: memoryGroupId,
        ledger: direct,
      }),
      memoryGroupId,
    }));
  const candidateIngestion: Phase74ProductIngestionUsageLedger[] =
    await Promise.all(memoryGroupIds.map(async (memoryGroupId) => {
      const key = candidateIngestionKeys.get(memoryGroupId)!;
      const paths = buildPhase74IngestionUsagePaths(
        candidateDirectory,
        key,
      );
      return {
        key,
        ledger: await loadPhase74ModelUsageLedger({
          eventsPath: paths.eventsPath,
          intentsPath: paths.intentsPath,
        }),
        memoryGroupId,
      };
    }));
  const modelUsage = buildPhase74ProductModelUsageEvidence({
    baselineIngestion,
    candidateIngestion,
    caseIds: productCases.map(({ caseId }) => caseId),
    direct,
    memoryGroupIds,
  });
  const baselineRows = result.rows.filter(
    ({ arm }) => arm === "release-v0.6.0",
  );
  const candidateRows = result.rows.filter(
    ({ arm }) => arm === "phase74-deterministic-candidate",
  );
  await Promise.all([
    writeFile(candidateUsagePath, "", { encoding: "utf8", flag: "a" }),
    writeFile(candidateUsageIntentsPath, "", {
      encoding: "utf8",
      flag: "a",
    }),
  ]);
  const report = {
    attemptTerminalPath: "attempt-terminal.json",
    benchmark: options.benchmark,
    callBudget: {
      accounting: "independent-process-pools-v1",
      candidateAndScoring: callBudget.snapshot(),
      release: JSON.parse(
        await readFile(releaseProcessConfig.callBudget.path, "utf8"),
      ) as EvalRunJsonObject,
    },
    candidateSource: evaluatorSource,
    comparison: {
      baselineMean: baselineRows.reduce(
        (total, { score }) => total + score,
        0,
      ) / baselineRows.length,
      candidateMean: candidateRows.reduce(
        (total, { score }) => total + score,
        0,
      ) / candidateRows.length,
    },
    evidenceBoundary: buildPhase74ProductEvidenceBoundary({
      seenCasesOnly: true,
    }),
    executionFailures: 0,
    experimentIdentityHash: hashEvalExperimentIdentity(identity),
    identityHash: hashEvalRunIdentity(identity),
    kind: "phase74-cumulative-product-comparison-diagnostic",
    latency: {
      baselineP95Ms: p95(
        baselineRows.map(({ productLatencyMs }) => productLatencyMs),
      ),
      candidateP95Ms: p95(
        candidateRows.map(({ productLatencyMs }) => productLatencyMs),
      ),
    },
    modelUsage,
    releaseDependencyTreeSha256,
    releasePreparedReceiptSet: {
      path: "release/prepared-receipts.json",
      receiptSetSha256: releasePreparedReceiptSet!.receiptSetSha256,
      sha256: await sha256File(
        join(releaseDirectory, "prepared-receipts.json"),
      ),
    },
    releasePreparedReceipts: releasePreparedReceiptSet!.receipts.map((receipt) => ({
      ingestionKey: receipt.ingestionKey,
      memoryGroupId: receipt.memoryGroupId,
      receiptSha256: receipt.receiptSha256,
    })),
    releaseProcessPids: [...releaseProcessPids].sort((left, right) =>
      left - right
    ),
    releaseSource,
    renderedContextMaxTokens: Math.max(
      ...result.rows.map(({ contextTokens }) => contextTokens),
    ),
    replicate: options.replicate,
    rows: result.rows,
    runId: options.runId,
    schemaVersion: 1,
    selectedEvidenceLedgerFormat:
      options.selectedEvidenceLedgerFormat,
    selection: selection.identity,
    status: "not_evaluable",
  };
  await commitPhase74ProductSuccessArtifacts({
    datasetManifest: dataset.manifest,
    report,
    terminalInput: {
      completedReceiptSetSha256:
        releasePreparedReceiptSet!.receiptSetSha256,
      identityHash: executionIdentityHash,
      paths: {
        candidateBudgetPath,
        candidateEventsPath: candidateUsagePath,
        candidateIntentsPath: candidateUsageIntentsPath,
        datasetManifestPath,
        releaseBudgetPath,
        releaseEventsPath: releaseUsagePath,
        releaseIntentsPath: releaseUsageIntentsPath,
        reportPath,
      },
      process: {
        failed: null,
        successfulPids: [...releaseProcessPids],
      },
      status: "succeeded",
    },
    terminalPath: attemptTerminalPath,
  });
  return { reportPath, runDirectory };
  } catch (error) {
    if ((await terminalFileEvidence(attemptTerminalPath)).exists === true) {
      throw error;
    }
    const failed = error instanceof Phase74VersionChildProcessError
      ? {
          exitCode: error.exitCode,
          pid: error.pid,
          stderrSha256: error.stderrSha256,
        }
      : null;
    const terminal = await buildPhase74ProductAttemptTerminal({
      completedReceiptSetSha256:
        releasePreparedReceiptSet?.receiptSetSha256,
      error,
      identityHash: executionIdentityHash,
      paths: {
        candidateBudgetPath,
        candidateEventsPath: candidateUsagePath,
        candidateIntentsPath: candidateUsageIntentsPath,
        datasetManifestPath,
        releaseBudgetPath,
        releaseEventsPath: releaseUsagePath,
        releaseIntentsPath: releaseUsageIntentsPath,
        reportPath,
      },
      process: {
        failed,
        successfulPids: [...releaseProcessPids],
      },
      status: "failed",
    });
    try {
      await writePhase74ProductAttemptTerminal({
        path: attemptTerminalPath,
        terminal,
      });
    } catch (terminalError) {
      throw new AggregateError(
        [error, terminalError],
        "Phase 74 product attempt and terminal persistence failed.",
      );
    }
    throw error;
  }
}

if (import.meta.main) {
  const result = await runPhase74LiveProductComparison(
    parsePhase74ProductComparisonCliOptions(Bun.argv),
  );
  console.log(JSON.stringify(result, null, 2));
}
