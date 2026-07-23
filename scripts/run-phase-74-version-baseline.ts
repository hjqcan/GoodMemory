import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  assertCliPathSegmentValue,
  resolveCliFlagValueStrict,
} from "./cli-options";
import {
  loadPhase74PreparedDataset,
  selectPhase74GeneralizationCases,
} from "./run-phase-74-generalization";
import {
  loadPhase74VersionCreateGoodMemory,
  runPhase74VersionWorker,
} from "./phase74-version-worker";
import type { Phase74VersionWorkerResult } from "./phase74-version-worker";
import {
  buildPhase74EmbeddingIdentity,
  createPhase74LiveReader,
  phase74EmbeddingInputCostUsdPerMillionTokens,
  phase74LivePromptSha256s,
  resolvePhase74LiveModels,
} from "../src/eval/phase74Live";
import { buildPhase74LabelFreeCaseBoundary } from "../src/eval/phase74Generalization";
import { assertPhase74ExperimentIdentityContract } from "../src/eval/phase74ExperimentIdentity";
import {
  buildPhase74ProtocolScoringIdentity,
  createPhase74ProtocolCompatibleAnswerAssessor,
} from "../src/eval/phase74ProtocolScoring";
import type { EvalRunJsonObject } from "../src/eval/runIdentity";
import {
  inferExactMcNemar,
  inferPairedMeanDelta,
} from "../src/eval/phase74PairedInference";
import {
  PHASE74_RELEASE_COMMIT,
  PHASE74_RELEASE_REF,
  PHASE74_RELEASE_TREE,
  assertPhase74VersionModelCallAllowance,
  createPhase74VersionSourceIdentity,
  parsePhase74VersionCandidateReranker,
  parsePhase74VersionCandidateSource,
  parsePhase74VersionWorkerInput,
} from "../src/eval/phase74VersionBaseline";
import {
  renderOracleMatrixContext,
  truncateRenderedContext,
} from "../src/eval/oracleMatrix";
import {
  appendPhase74ModelUsageEventSync,
  appendPhase74ModelUsageIntentSync,
} from "../src/eval/modelUsage";
import type {
  AttributedModelUsageAttempt,
  AttributedModelUsageIntent,
} from "../src/eval/modelUsage";
import { createPhase74SelectedDatasetBundle } from "../src/eval/phase74Datasets";
import type {
  Phase74BenchmarkFamily,
  Phase74DatasetBundle,
  Phase74DatasetCase,
} from "../src/eval/phase74Datasets";

const CONTEXT_TOKEN_BUDGET = 6_000;

type CandidateStage = "E1" | "E2" | "E3";

export interface Phase74VersionBaselineOptions {
  benchmark: Phase74BenchmarkFamily;
  benchmarkRoot: string;
  candidateArm: string;
  candidateRunDirectory: string;
  candidateStage: CandidateStage;
  caseSelectionSeed: number;
  caseSelectionSize: number;
  embeddingSpendLimitUsd: number;
  maxLanguageCalls: number;
  outputDir: string;
  releaseArchive: string;
  releaseSourceRoot: string;
  runId: string;
}

export interface Phase74VersionScoredOutcome {
  answer: string;
  caseId: string;
  correct: boolean;
  score: number;
}

export function estimatePhase74VersionEmbeddingSpendUpperBoundUsd(input: {
  inputByteUpperBound: number;
  model: string;
}): number {
  return input.inputByteUpperBound *
    phase74EmbeddingInputCostUsdPerMillionTokens(input.model) / 1_000_000;
}

export function buildPhase74VersionRunIdentity(input: {
  embeddingSpendLimitUsd: number;
  identity: EvalRunJsonObject;
  maxLanguageCalls: number;
}): EvalRunJsonObject {
  return {
    ...input.identity,
    callBudget: {
      embeddingSpendLimitUsd: input.embeddingSpendLimitUsd,
      maxLanguageCalls: input.maxLanguageCalls,
    },
  };
}

export function preparePhase74VersionDataset(input: {
  dataset: Phase74DatasetBundle;
  seed: number;
  size: number;
}) {
  const selection = selectPhase74GeneralizationCases({
    cases: input.dataset.cases,
    seed: input.seed,
    size: input.size,
  });
  return {
    dataset: createPhase74SelectedDatasetBundle({
      bundle: input.dataset,
      cases: selection.cases,
    }),
    selection,
  };
}

export function buildPhase74ReleaseWorkerInput(
  testCase: Phase74DatasetCase,
) {
  const boundary = buildPhase74LabelFreeCaseBoundary(testCase);
  return parsePhase74VersionWorkerInput({
    arm: "release",
    caseId: boundary.caseKey,
    ...(boundary.recallCase.locale === undefined
      ? {}
      : { locale: boundary.recallCase.locale }),
    memoryGroupId: boundary.recallCase.memoryGroupId ?? boundary.caseKey,
    question: boundary.recallCase.question,
    rawEvidence: boundary.recallCase.rawEvidence,
    ...(boundary.recallCase.referenceTime === undefined
      ? {}
      : { referenceTime: boundary.recallCase.referenceTime }),
    schemaVersion: 1,
    sourceCommit: PHASE74_RELEASE_COMMIT,
  });
}

export async function createPhase74FreshVersionRunDirectory(
  outputDir: string,
  runId: string,
): Promise<string> {
  const root = resolve(outputDir);
  const runDirectory = join(root, runId);
  await mkdir(root, { recursive: true });
  try {
    await mkdir(runDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `Phase 74 version run directory already exists: ${runDirectory}`,
      );
    }
    throw error;
  }
  await mkdir(join(runDirectory, "release-ingestion"));
  return runDirectory;
}

export function buildPhase74VersionComparison(input: {
  baseline: readonly Phase74VersionScoredOutcome[];
  candidate: readonly Phase74VersionScoredOutcome[];
}) {
  const pairedBootstrap = inferPairedMeanDelta({
    baseline: input.baseline.map(({ caseId, score }) => ({ caseId, value: score })),
    candidate: input.candidate.map(({ caseId, score }) => ({ caseId, value: score })),
  });
  const mcnemar = inferExactMcNemar({
    baseline: input.baseline.map(({ caseId, correct }) => ({
      caseId,
      passed: correct,
    })),
    candidate: input.candidate.map(({ caseId, correct }) => ({
      caseId,
      passed: correct,
    })),
  });
  const mean = (outcomes: readonly Phase74VersionScoredOutcome[]) =>
    outcomes.reduce((total, { score }) => total + score, 0) / outcomes.length;
  const baselineMean = mean(input.baseline);
  const candidateMean = mean(input.candidate);
  return {
    baselineMean,
    candidateMean,
    caseCount: input.baseline.length,
    meanDelta: candidateMean - baselineMean,
    mcnemar,
    pairedBootstrap,
  };
}

function requiredFlag(args: readonly string[], name: string): string {
  const value = resolveCliFlagValueStrict(args, name);
  if (value === undefined) {
    throw new Error(`Phase 74 version baseline requires ${name}.`);
  }
  return value;
}

function positiveNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

function positiveInteger(value: string, name: string): number {
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Number(value);
}

export function parsePhase74VersionBaselineCliOptions(
  args: readonly string[],
): Phase74VersionBaselineOptions {
  const benchmark = requiredFlag(args, "--benchmark");
  if (benchmark !== "longmemeval" && benchmark !== "locomo") {
    throw new Error("--benchmark must be longmemeval or locomo.");
  }
  const candidateStage = requiredFlag(args, "--candidate-stage");
  if (candidateStage !== "E1" && candidateStage !== "E2" && candidateStage !== "E3") {
    throw new Error("--candidate-stage must be E1, E2, or E3.");
  }
  const runId = requiredFlag(args, "--run-id");
  assertCliPathSegmentValue({ flag: "--run-id", value: runId });
  return {
    benchmark,
    benchmarkRoot: requiredFlag(args, "--benchmark-root"),
    candidateArm: requiredFlag(args, "--candidate-arm"),
    candidateRunDirectory: requiredFlag(args, "--candidate-run-dir"),
    candidateStage,
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
    releaseArchive: requiredFlag(args, "--release-archive"),
    releaseSourceRoot: requiredFlag(args, "--release-source-root"),
    runId,
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(path: string): Promise<string> {
  return sha256(await readFile(path));
}

function readJsonLines(raw: string): unknown[] {
  return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Phase 74 version baseline expected a JSON object.");
  }
  return value as Record<string, unknown>;
}

function publicModelIdentity(model: {
  baseURL?: string;
  model: string;
  provider: string;
}) {
  return {
    gateway: model.baseURL ?? "",
    model: model.model,
    provider: model.provider,
  };
}

function assertEqualIdentity(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Phase 74 version baseline ${label} drifted.`);
  }
}

export function parsePhase74VersionCandidateOutcomes(input: {
  arm: string;
  cases: readonly { caseId: string }[];
  progress: readonly unknown[];
  stage: CandidateStage;
}): Phase74VersionScoredOutcome[] {
  const byCaseId = new Map(
    input.progress.map((value) => {
      const row = jsonObject(value);
      return [`${row.caseId}/${row.stage}/${row.arm}`, row] as const;
    }),
  );
  return input.cases.map(({ caseId }) => {
    const row = byCaseId.get(`${caseId}/${input.stage}/${input.arm}`);
    if (
      row === undefined ||
      typeof row.answer !== "string" ||
      typeof row.correct !== "boolean" ||
      typeof row.score !== "number" ||
      row.executionError !== undefined
    ) {
      throw new Error(`Phase 74 candidate outcome missing for ${caseId}.`);
    }
    return { answer: row.answer, caseId, correct: row.correct, score: row.score };
  });
}

function requestUrl(request: RequestInfo | URL): string {
  if (typeof request === "string") {
    return request;
  }
  return request instanceof URL ? request.toString() : request.url;
}

function embeddingRequestBytes(init: RequestInit | undefined): number {
  if (typeof init?.body !== "string") {
    return 0;
  }
  const input = jsonObject(JSON.parse(init.body)).input;
  const values = Array.isArray(input) ? input : [input];
  return values.reduce(
    (total, value) => total + (typeof value === "string" ? Buffer.byteLength(value) : 0),
    0,
  );
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function runPhase74VersionBaseline(
  options: Phase74VersionBaselineOptions,
): Promise<{ reportPath: string; runDirectory: string }> {
  const preparedDataset = await loadPhase74PreparedDataset({
    benchmark: options.benchmark,
    benchmarkRoot: options.benchmarkRoot,
  });
  const { dataset, selection } = preparePhase74VersionDataset({
    dataset: preparedDataset,
    seed: options.caseSelectionSeed,
    size: options.caseSelectionSize,
  });
  const models = resolvePhase74LiveModels(process.env);
  const candidateIdentityRaw = await readFile(
    join(options.candidateRunDirectory, "run-identity.json"),
    "utf8",
  );
  const candidateIdentity = jsonObject(JSON.parse(candidateIdentityRaw));
  const configuration = jsonObject(candidateIdentity.configuration);
  const candidateReranker = parsePhase74VersionCandidateReranker(
    configuration.reranker,
  );
  assertEqualIdentity(candidateIdentity.benchmark, `${options.benchmark}-full`, "benchmark");
  assertEqualIdentity(candidateIdentity.datasetSha256, dataset.manifest.datasetSha256, "dataset SHA-256");
  assertEqualIdentity(configuration.selection, selection.identity, "selection identity");
  assertEqualIdentity(candidateIdentity.answerModel, publicModelIdentity(models.answer), "reader model");
  assertEqualIdentity(candidateIdentity.judgeModel, publicModelIdentity(models.judge), "judge model");
  assertEqualIdentity(candidateIdentity.promptSha256s, phase74LivePromptSha256s(), "prompt identity");
  assertPhase74ExperimentIdentityContract({
    benchmark: options.benchmark,
    configuration: configuration as EvalRunJsonObject,
    dataset: dataset.manifest,
    expectedEmbedding: buildPhase74EmbeddingIdentity(models.embedding),
    expectedReranker: candidateReranker,
    judgeModel: publicModelIdentity(models.judge),
  });
  const candidateSource = parsePhase74VersionCandidateSource(
    configuration.evaluatorSource,
  );

  const prefix = options.candidateStage.toLowerCase();
  const candidate = parsePhase74VersionCandidateOutcomes({
    arm: options.candidateArm,
    cases: selection.cases,
    progress: readJsonLines(await readFile(
      join(options.candidateRunDirectory, `${prefix}-progress.jsonl`),
      "utf8",
    )),
    stage: options.candidateStage,
  });
  const runDirectory = await createPhase74FreshVersionRunDirectory(
    options.outputDir,
    options.runId,
  );
  const releaseSource = createPhase74VersionSourceIdentity({
    archiveSha256: await sha256File(options.releaseArchive),
    arm: "release",
    commit: PHASE74_RELEASE_COMMIT,
    lockfileSha256: await sha256File(join(options.releaseSourceRoot, "bun.lock")),
    ref: PHASE74_RELEASE_REF,
    tree: PHASE74_RELEASE_TREE,
    workerSha256: await sha256File(join(process.cwd(), "scripts/phase74-version-worker.ts")),
  });
  const candidateRunIdentitySha256 = sha256(candidateIdentityRaw);
  const scoring = buildPhase74ProtocolScoringIdentity(
    options.benchmark,
    publicModelIdentity(models.judge),
  );
  const versionRunIdentity = buildPhase74VersionRunIdentity({
    embeddingSpendLimitUsd: options.embeddingSpendLimitUsd,
    identity: {
      answerModel: publicModelIdentity(models.answer),
      benchmark: options.benchmark,
      candidateRunIdentitySha256,
      candidateSource,
      embedding: buildPhase74EmbeddingIdentity(models.embedding),
      judgeModel: publicModelIdentity(models.judge),
      promptSha256s: phase74LivePromptSha256s(),
      releaseSource: { ...releaseSource },
      reranker: candidateReranker,
      runId: options.runId,
      scoring,
      selection: selection.identity,
    },
    maxLanguageCalls: options.maxLanguageCalls,
  });
  await writeJson(join(runDirectory, "run-identity.json"), versionRunIdentity);
  const events: AttributedModelUsageAttempt[] = [];
  const intents: AttributedModelUsageIntent[] = [];
  const usagePath = join(runDirectory, "model-usage.jsonl");
  const usageIntentsPath = join(runDirectory, "model-usage-intents.jsonl");
  const onUsageEvent = (event: AttributedModelUsageAttempt) => {
    appendPhase74ModelUsageEventSync(usagePath, event);
  };
  const onUsageIntent = (intent: AttributedModelUsageIntent) => {
    appendPhase74ModelUsageIntentSync(usageIntentsPath, intent);
  };
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
  const createGoodMemory = await loadPhase74VersionCreateGoodMemory(
    options.releaseSourceRoot,
  );
  const originalFetch = globalThis.fetch;
  let languageCalls = 0;
  let embeddingCalls = 0;
  let embeddingInputByteUpperBound = 0;
  globalThis.fetch = (async (request, init) => {
    const url = requestUrl(request);
    if (url.endsWith("/chat/completions")) {
      assertPhase74VersionModelCallAllowance({
        completedCalls: languageCalls,
        hardLimit: options.maxLanguageCalls,
        requestedCalls: 1,
      });
      languageCalls += 1;
    } else if (url.endsWith("/embeddings")) {
      const requestBytes = embeddingRequestBytes(init);
      const projectedBytes = embeddingInputByteUpperBound + requestBytes;
      const projectedUsd = estimatePhase74VersionEmbeddingSpendUpperBoundUsd({
        inputByteUpperBound: projectedBytes,
        model: models.embedding.model,
      });
      if (projectedUsd > options.embeddingSpendLimitUsd) {
        throw new Error("Phase 74 embedding spend limit would be exceeded.");
      }
      embeddingCalls += 1;
      embeddingInputByteUpperBound = projectedBytes;
    }
    return originalFetch(request, init);
  }) as typeof fetch;

  const baseline: Phase74VersionScoredOutcome[] = [];
  const snapshots: Phase74VersionWorkerResult[] = [];
  try {
    for (const testCase of selection.cases) {
      const workerInput = buildPhase74ReleaseWorkerInput(testCase);
      const snapshot = await runPhase74VersionWorker({
        createGoodMemory,
        input: workerInput,
        models: {
          embedding: models.embedding,
          extraction: models.assistedExtraction,
        },
        sqlitePath: join(runDirectory, "release-ingestion", `${sha256(testCase.caseId)}.sqlite`),
      });
      snapshots.push(snapshot);
      const context = truncateRenderedContext({
        content: renderOracleMatrixContext(snapshot.retrievedMemories),
        contextTokenBudget: CONTEXT_TOKEN_BUDGET,
        countRenderedTokens: (value) => Buffer.byteLength(value, "utf8"),
      }).content;
      const answer = await reader({
        caseId: testCase.caseId,
        context,
        purpose: "final:baseline:version-release",
        question: testCase.question,
      });
      const assessment = await assessor({
        answer,
        purpose: "final:baseline:version-release",
        testCase,
      });
      baseline.push({ answer, caseId: testCase.caseId, ...assessment });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  const comparison = buildPhase74VersionComparison({ baseline, candidate });
  const report = {
    benchmark: options.benchmark,
    callBudget: {
      embeddingCalls,
      embeddingInputByteUpperBound,
      embeddingSpendLimitUsd: options.embeddingSpendLimitUsd,
      embeddingSpendUpperBoundUsd:
        estimatePhase74VersionEmbeddingSpendUpperBoundUsd({
          inputByteUpperBound: embeddingInputByteUpperBound,
          model: models.embedding.model,
        }),
      languageCalls,
      maxLanguageCalls: options.maxLanguageCalls,
    },
    candidate,
    candidateRunIdentitySha256,
    candidateSource,
    comparison,
    generatedAt: new Date().toISOString(),
    reason: "Public-data single-replicate release comparison is diagnostic only.",
    release: baseline,
    releaseSnapshots: snapshots,
    releaseSource,
    runId: options.runId,
    schemaVersion: 1,
    scoring,
    selection: selection.identity,
    status: "not_evaluable",
  };
  const reportPath = join(runDirectory, "report.json");
  await Promise.all([
    writeFile(usagePath, "", { encoding: "utf8", flag: "a" }),
    writeFile(usageIntentsPath, "", { encoding: "utf8", flag: "a" }),
    writeJson(reportPath, report),
  ]);
  return { reportPath, runDirectory };
}

if (import.meta.main) {
  const result = await runPhase74VersionBaseline(
    parsePhase74VersionBaselineCliOptions(Bun.argv),
  );
  console.log(JSON.stringify(result, null, 2));
}
