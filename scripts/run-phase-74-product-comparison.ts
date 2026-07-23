import type { EvidenceLedgerFormat } from "../src/eval/evidenceLedgerFormats";
import type { EvalRunJsonObject } from "../src/eval/runIdentity";
import {
  assertCliPathSegmentValue,
  resolveCliFlagValueStrict,
} from "./cli-options";

export const PHASE74_PRODUCT_ARMS = [
  "release-v0.6.0",
  "phase74-final",
] as const;

export type Phase74ProductArm = (typeof PHASE74_PRODUCT_ARMS)[number];

export interface Phase74ProductComparisonOptions {
  benchmark: "locomo" | "longmemeval";
  benchmarkRoot: string;
  caseSelectionSeed: number;
  caseSelectionSize: number;
  embeddingSpendLimitUsd: number;
  maxLanguageCalls: number;
  outputDir: string;
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
  if (
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
      candidate: "phase74-final",
    },
    candidateConfiguration: input.candidateConfiguration,
    candidateSource: input.candidateSource,
    comparisonKind: "cumulative-product",
    costBoundary: "full-product",
    evidenceBoundary: {
      goldAware: false,
      protocolReader: false,
      seenCasesOnly: input.seenCasesOnly,
    },
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

  await Promise.all(PHASE74_PRODUCT_ARMS.flatMap((arm) =>
    [...grouped].map(async ([memoryGroupId, cases]) => {
      const value = await input.prepare({ arm, cases, memoryGroupId });
      assertPreparedGroup({ arm, memoryGroupId, prepared: value });
      prepared.set(`${arm}/${memoryGroupId}`, value);
    })
  ));

  const rows: Phase74ProductComparisonRow[] = [];
  for (const testCase of input.cases) {
    for (const arm of PHASE74_PRODUCT_ARMS) {
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
      rows.push({
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
      });
    }
  }
  return {
    rows,
    selectedEvidenceLedgerFormat: input.selectedEvidenceLedgerFormat,
  };
}
