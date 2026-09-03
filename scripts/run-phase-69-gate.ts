import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  RECOMMENDED_GENERALIZED_FUSION_MAX_CANDIDATES,
  RECOMMENDED_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
} from "../src/api/retrievalPreset";
import type { LongMemEvalRecallRunConfiguration } from "../src/eval/longmemeval";
import { LONGMEMEVAL_DEFAULT_CONTEXT_MAX_TOKENS } from "../src/eval/longmemeval";
import {
  DEFAULT_GENERALIZED_FUSION_MIN_RELATIVE_STRENGTH,
  DEFAULT_GENERALIZED_FUSION_RRF_K,
} from "../src/recall/generalizedFusion";
import { resolveCliFlagValueStrict } from "./cli-options";
import {
  LOCOMO_UPSTREAM_COMMIT,
  LOCOMO_UPSTREAM_SHA256,
} from "./prepare-phase-65-locomo-data";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

export const PHASE69_TARGET_MIN_DELTA = 0.03;
export const PHASE69_PROTECTION_MAX_REGRESSION = 0.01;
export const PHASE69_MAX_ADDED_NOISE_PER_QUESTION = 8;
export const PHASE69_MAX_ADDED_WRONG_SESSIONS_PER_QUESTION = 3;

const LOCOMO_TARGETS = ["multi_hop", "open_domain"] as const;
const LOCOMO_PROTECTIONS = ["adversarial", "single_hop", "temporal"] as const;
const LOCOMO_EXPECTED_CASES = 10;
const LOCOMO_EXPECTED_QUESTIONS = 1986;
const LOCOMO_EXPECTED_CATEGORY_COUNTS = {
  adversarial: 446,
  multi_hop: 282,
  open_domain: 96,
  single_hop: 841,
  temporal: 321,
} as const;
const LONGMEMEVAL_TARGETS = [
  "knowledge-update",
  "temporal-reasoning",
] as const;
const LONGMEMEVAL_EXPECTED_QUESTIONS = 500;
const LONGMEMEVAL_EXPECTED_TYPE_COUNTS = {
  "knowledge-update": 78,
  "multi-session": 133,
  "single-session-assistant": 56,
  "single-session-preference": 30,
  "single-session-user": 70,
  "temporal-reasoning": 133,
} as const;

export const PHASE69_LOCOMO_BENCHMARK_FINGERPRINT =
  "d134ede9c6e3371ca31f6b9769e3ceeeaebaacaebbc1a4d3548220e9887abc66";
export const PHASE69_LONGMEMEVAL_BENCHMARK_FINGERPRINT =
  "195fa256c468ff68079f5a05de2572deb47fa2c06b5d48e1d3ad4f3e044a5203";
export const PHASE69_LONGMEMEVAL_UPSTREAM_COMMIT =
  "98d7416c24c778c2fee6e6f3006e7a073259d48f";
export const PHASE69_LONGMEMEVAL_SOURCE_SHA256 =
  "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442";

interface Phase69GeneralizedFusionConfig {
  maxCandidates: number;
  maxTotalFacts: number;
  minRelativeStrength: number;
  rrfK: number;
}

const EXPECTED_GENERALIZED_FUSION_CONFIG: Phase69GeneralizedFusionConfig = {
  maxCandidates: RECOMMENDED_GENERALIZED_FUSION_MAX_CANDIDATES,
  maxTotalFacts: RECOMMENDED_GENERALIZED_FUSION_MAX_TOTAL_FACTS,
  minRelativeStrength: DEFAULT_GENERALIZED_FUSION_MIN_RELATIVE_STRENGTH,
  rrfK: DEFAULT_GENERALIZED_FUSION_RRF_K,
};

function expectedLongMemEvalConfiguration(
  candidate: boolean,
): LongMemEvalRecallRunConfiguration {
  return {
    contextMaxTokens: LONGMEMEVAL_DEFAULT_CONTEXT_MAX_TOKENS,
    extractionStrategy: "rules-only",
    generalizedFusion: candidate
      ? EXPECTED_GENERALIZED_FUSION_CONFIG
      : null,
    projection: {
      bulkBackfill: true,
      writeThrough: false,
    },
    providerEmbedding: false,
    recallStrategy: candidate ? "hybrid" : "rules-only",
  };
}

export interface Phase69LocomoGateReport {
  benchmark: "locomo";
  benchmarkFingerprint: string;
  benchmarkSource: string;
  caseIds: string[];
  categories: Array<{
    averageEvidenceRecall: number;
    category: string;
    noiseTurnTotal: number;
    questionCount: number;
  }>;
  executionFailures: number;
  generalizedFusion?: boolean;
  generalizedFusionConfig: Phase69GeneralizedFusionConfig | null;
  labelFreeIngest: boolean;
  // Phase 75 arm marker (top-level on the smoke report; never part of the
  // Phase 69 retrievalConfig key contract).
  longRecordAdmission?: boolean;
  questionIds: string[];
  retrievalConfig: Record<string, boolean>;
}

export interface Phase69LongMemEvalGateReport {
  benchmarkFingerprint: string;
  benchmarkRoot: string;
  byQuestionType: Record<
    string,
    {
      evidenceCaseCount: number;
      evidenceSessionRecall: number | null;
      wrongSessionTotal: number;
    }
  >;
  executionFailures: number;
  ingestMode: string;
  profile: string;
  questionIds: string[];
  runConfiguration: LongMemEvalRecallRunConfiguration;
}

export interface Phase69GateInput {
  locomoBaseline: Phase69LocomoGateReport;
  locomoCandidate: Phase69LocomoGateReport;
  longMemEvalBaseline: Phase69LongMemEvalGateReport;
  longMemEvalCandidate: Phase69LongMemEvalGateReport;
}

export interface Phase69GateSlice {
  baseline: number;
  benchmark: "LoCoMo" | "LongMemEval";
  candidate: number;
  delta: number;
  name: string;
  passed: boolean;
  threshold: number;
}

export interface Phase69GateResult {
  failures: string[];
  noiseProtections: Phase69GateSlice[];
  protections: Phase69GateSlice[];
  status: "failed" | "passed";
  targets: Phase69GateSlice[];
  thresholds: {
    maxAddedNoisePerQuestion: number;
    maxAddedWrongSessionsPerQuestion: number;
    protectionMaxRegression: number;
    targetMinDelta: number;
  };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return (
    leftSorted.length === rightSorted.length &&
    leftSorted.every((value, index) => value === rightSorted[index])
  );
}

function format(value: number): string {
  return value.toFixed(6);
}

function uniqueCount(values: readonly string[]): number {
  return new Set(values).size;
}

function categoryRecall(
  report: Phase69LocomoGateReport,
  category: string,
): number | null {
  const entry = report.categories.find((candidate) => candidate.category === category);
  if (!entry || entry.questionCount <= 0 || !Number.isFinite(entry.averageEvidenceRecall)) {
    return null;
  }
  return entry.averageEvidenceRecall;
}

function longMemEvalRecall(
  report: Phase69LongMemEvalGateReport,
  questionType: string,
): number | null {
  const entry = report.byQuestionType[questionType];
  if (
    !entry ||
    entry.evidenceCaseCount <= 0 ||
    entry.evidenceSessionRecall === null ||
    !Number.isFinite(entry.evidenceSessionRecall)
  ) {
    return null;
  }
  return entry.evidenceSessionRecall;
}

function evaluateTarget(input: {
  baseline: number;
  benchmark: Phase69GateSlice["benchmark"];
  candidate: number;
  name: string;
}): Phase69GateSlice {
  const delta = input.candidate - input.baseline;
  return {
    ...input,
    delta,
    passed: delta + Number.EPSILON >= PHASE69_TARGET_MIN_DELTA,
    threshold: PHASE69_TARGET_MIN_DELTA,
  };
}

function evaluateProtection(input: {
  baseline: number;
  benchmark: Phase69GateSlice["benchmark"];
  candidate: number;
  name: string;
}): Phase69GateSlice {
  const delta = input.candidate - input.baseline;
  return {
    ...input,
    delta,
    passed: delta + Number.EPSILON >= -PHASE69_PROTECTION_MAX_REGRESSION,
    threshold: -PHASE69_PROTECTION_MAX_REGRESSION,
  };
}

export function evaluatePhase69Gate(input: Phase69GateInput): Phase69GateResult {
  const failures: string[] = [];
  const targets: Phase69GateSlice[] = [];
  const protections: Phase69GateSlice[] = [];
  const noiseProtections: Phase69GateSlice[] = [];

  if (input.locomoBaseline.benchmarkSource !== input.locomoCandidate.benchmarkSource) {
    failures.push("LoCoMo benchmark sources differ");
  }
  if (
    input.locomoBaseline.benchmarkFingerprint !==
    input.locomoCandidate.benchmarkFingerprint
  ) {
    failures.push("LoCoMo benchmark fingerprints differ");
  }
  if (
    input.locomoBaseline.benchmarkFingerprint !==
      PHASE69_LOCOMO_BENCHMARK_FINGERPRINT ||
    input.locomoCandidate.benchmarkFingerprint !==
      PHASE69_LOCOMO_BENCHMARK_FINGERPRINT
  ) {
    failures.push(
      "LoCoMo benchmark fingerprint is not the pinned Phase 69 dataset",
    );
  }
  if (!sameStrings(input.locomoBaseline.caseIds, input.locomoCandidate.caseIds)) {
    failures.push("LoCoMo case populations differ");
  }
  if (!sameStrings(input.locomoBaseline.questionIds, input.locomoCandidate.questionIds)) {
    failures.push("LoCoMo question populations differ");
  }
  for (const [label, report] of [
    ["baseline", input.locomoBaseline],
    ["candidate", input.locomoCandidate],
  ] as const) {
    if (!/^[a-f0-9]{64}$/u.test(report.benchmarkFingerprint)) {
      failures.push(`LoCoMo ${label} benchmark fingerprint must be SHA-256`);
    }
    if (!report.labelFreeIngest) {
      failures.push(`LoCoMo ${label} must use label-free ingest`);
    }
    if (report.caseIds.length !== LOCOMO_EXPECTED_CASES) {
      failures.push(
        `LoCoMo case population must contain ${LOCOMO_EXPECTED_CASES} cases, received ${report.caseIds.length}`,
      );
    } else if (uniqueCount(report.caseIds) !== LOCOMO_EXPECTED_CASES) {
      failures.push(`LoCoMo ${label} case population contains duplicate ids`);
    }
    if (report.questionIds.length !== LOCOMO_EXPECTED_QUESTIONS) {
      failures.push(
        `LoCoMo question population must contain ${LOCOMO_EXPECTED_QUESTIONS} questions, received ${report.questionIds.length}`,
      );
    } else if (uniqueCount(report.questionIds) !== LOCOMO_EXPECTED_QUESTIONS) {
      failures.push(`LoCoMo ${label} question population contains duplicate ids`);
    }
    for (const [category, expectedCount] of Object.entries(
      LOCOMO_EXPECTED_CATEGORY_COUNTS,
    )) {
      const entries = report.categories.filter(
        (candidate) => candidate.category === category,
      );
      if (entries.length !== 1 || entries[0]?.questionCount !== expectedCount) {
        failures.push(
          `LoCoMo ${label} ${category} must contain ${expectedCount} questions`,
        );
      }
    }
  }
  if (input.locomoBaseline.generalizedFusion === true) {
    failures.push("LoCoMo baseline must not enable generalized fusion");
  }
  if (input.locomoCandidate.generalizedFusion !== true) {
    failures.push("LoCoMo candidate must enable generalized fusion");
  }
  if (input.locomoBaseline.generalizedFusionConfig !== null) {
    failures.push("LoCoMo baseline generalizedFusionConfig must be null");
  }
  if (
    !isDeepStrictEqual(
      input.locomoCandidate.generalizedFusionConfig,
      EXPECTED_GENERALIZED_FUSION_CONFIG,
    )
  ) {
    failures.push("LoCoMo candidate generalizedFusionConfig is inconsistent");
  }
  const expectedLocomoConfig = {
    bm25Ranking: false,
    corefNormalize: false,
    decompose: false,
    labelFreeIngest: true,
    multiHop: false,
    providerEmbedding: false,
    rerank: false,
    smartFusion: false,
  };
  for (const [label, report] of [
    ["baseline", input.locomoBaseline],
    ["candidate", input.locomoCandidate],
  ] as const) {
    const expectedKeys = [
      ...Object.keys(expectedLocomoConfig),
      "generalizedFusion",
    ];
    if (!sameStrings(Object.keys(report.retrievalConfig), expectedKeys)) {
      failures.push(
        `LoCoMo ${label} retrievalConfig keys must exactly match the Phase 69 contract`,
      );
    }
    for (const [key, expected] of Object.entries(expectedLocomoConfig)) {
      if (report.retrievalConfig[key] !== expected) {
        failures.push(`LoCoMo ${label} retrievalConfig.${key} must be ${expected}`);
      }
    }
    if (
      report.retrievalConfig.generalizedFusion !==
      (label === "candidate")
    ) {
      failures.push(
        `LoCoMo ${label} retrievalConfig.generalizedFusion is inconsistent`,
      );
    }
  }
  for (const [label, value] of [
    ["baseline", input.locomoBaseline.executionFailures],
    ["candidate", input.locomoCandidate.executionFailures],
  ] as const) {
    if (value !== 0) {
      failures.push(
        `LoCoMo ${label} executionFailures must be 0, received ${value}`,
      );
    }
  }

  for (const category of LOCOMO_TARGETS) {
    const baseline = categoryRecall(input.locomoBaseline, category);
    const candidate = categoryRecall(input.locomoCandidate, category);
    if (baseline === null || candidate === null) {
      failures.push(`LoCoMo ${category} target slice is missing or empty`);
      continue;
    }
    targets.push(
      evaluateTarget({ baseline, benchmark: "LoCoMo", candidate, name: category }),
    );
  }
  for (const category of LOCOMO_PROTECTIONS) {
    const baseline = categoryRecall(input.locomoBaseline, category);
    const candidate = categoryRecall(input.locomoCandidate, category);
    if (baseline === null || candidate === null) {
      failures.push(`LoCoMo ${category} protection slice is missing or empty`);
      continue;
    }
    protections.push(
      evaluateProtection({
        baseline,
        benchmark: "LoCoMo",
        candidate,
        name: category,
      }),
    );
  }
  for (const category of Object.keys(LOCOMO_EXPECTED_CATEGORY_COUNTS)) {
    const baseline = input.locomoBaseline.categories.find(
      (entry) => entry.category === category,
    );
    const candidate = input.locomoCandidate.categories.find(
      (entry) => entry.category === category,
    );
    if (!baseline || !candidate) {
      continue;
    }
    const baselineNoise = baseline.noiseTurnTotal / baseline.questionCount;
    const candidateNoise = candidate.noiseTurnTotal / candidate.questionCount;
    const delta = candidateNoise - baselineNoise;
    noiseProtections.push({
      baseline: baselineNoise,
      benchmark: "LoCoMo",
      candidate: candidateNoise,
      delta,
      name: `${category}:noise-per-question`,
      passed: delta <= PHASE69_MAX_ADDED_NOISE_PER_QUESTION,
      threshold: PHASE69_MAX_ADDED_NOISE_PER_QUESTION,
    });
  }

  if (input.longMemEvalBaseline.benchmarkRoot !== input.longMemEvalCandidate.benchmarkRoot) {
    failures.push("LongMemEval benchmark roots differ");
  }
  if (
    input.longMemEvalBaseline.benchmarkFingerprint !==
    input.longMemEvalCandidate.benchmarkFingerprint
  ) {
    failures.push("LongMemEval benchmark fingerprints differ");
  }
  if (
    input.longMemEvalBaseline.benchmarkFingerprint !==
      PHASE69_LONGMEMEVAL_BENCHMARK_FINGERPRINT ||
    input.longMemEvalCandidate.benchmarkFingerprint !==
      PHASE69_LONGMEMEVAL_BENCHMARK_FINGERPRINT
  ) {
    failures.push(
      "LongMemEval benchmark fingerprint is not the pinned Phase 69 dataset",
    );
  }
  if (
    !sameStrings(
      input.longMemEvalBaseline.questionIds,
      input.longMemEvalCandidate.questionIds,
    )
  ) {
    failures.push("LongMemEval question populations differ");
  }
  for (const [label, report] of [
    ["baseline", input.longMemEvalBaseline],
    ["candidate", input.longMemEvalCandidate],
  ] as const) {
    if (!/^[a-f0-9]{64}$/u.test(report.benchmarkFingerprint)) {
      failures.push(`LongMemEval ${label} benchmark fingerprint must be SHA-256`);
    }
    if (report.questionIds.length !== LONGMEMEVAL_EXPECTED_QUESTIONS) {
      failures.push(
        `LongMemEval question population must contain ${LONGMEMEVAL_EXPECTED_QUESTIONS} questions, received ${report.questionIds.length}`,
      );
    } else if (uniqueCount(report.questionIds) !== LONGMEMEVAL_EXPECTED_QUESTIONS) {
      failures.push(`LongMemEval ${label} question population contains duplicate ids`);
    }
    for (const [questionType, expectedCount] of Object.entries(
      LONGMEMEVAL_EXPECTED_TYPE_COUNTS,
    )) {
      if (report.byQuestionType[questionType]?.evidenceCaseCount !== expectedCount) {
        failures.push(
          `LongMemEval ${label} ${questionType} must contain ${expectedCount} evidence cases`,
        );
      }
    }
  }
  if (input.longMemEvalBaseline.profile !== "goodmemory-rules-only") {
    failures.push("LongMemEval baseline profile must be goodmemory-rules-only");
  }
  if (input.longMemEvalCandidate.profile !== "goodmemory-recommended") {
    failures.push("LongMemEval candidate profile must be goodmemory-recommended");
  }
  if (
    !isDeepStrictEqual(
      input.longMemEvalBaseline.runConfiguration,
      expectedLongMemEvalConfiguration(false),
    )
  ) {
    failures.push("LongMemEval baseline runConfiguration is inconsistent");
  }
  if (
    !isDeepStrictEqual(
      input.longMemEvalCandidate.runConfiguration,
      expectedLongMemEvalConfiguration(true),
    )
  ) {
    failures.push("LongMemEval candidate runConfiguration is inconsistent");
  }
  for (const [label, report] of [
    ["baseline", input.longMemEvalBaseline],
    ["candidate", input.longMemEvalCandidate],
  ] as const) {
    if (report.ingestMode !== "label-free-raw") {
      failures.push(
        `LongMemEval ${label} ingestMode must be label-free-raw`,
      );
    }
  }
  for (const [label, value] of [
    ["baseline", input.longMemEvalBaseline.executionFailures],
    ["candidate", input.longMemEvalCandidate.executionFailures],
  ] as const) {
    if (value !== 0) {
      failures.push(
        `LongMemEval ${label} executionFailures must be 0, received ${value}`,
      );
    }
  }

  for (const questionType of LONGMEMEVAL_TARGETS) {
    const baseline = longMemEvalRecall(input.longMemEvalBaseline, questionType);
    const candidate = longMemEvalRecall(input.longMemEvalCandidate, questionType);
    if (baseline === null || candidate === null) {
      failures.push(`LongMemEval ${questionType} target slice is missing or empty`);
      continue;
    }
    targets.push(
      evaluateTarget({
        baseline,
        benchmark: "LongMemEval",
        candidate,
        name: questionType,
      }),
    );
  }
  for (const questionType of Object.keys(
    input.longMemEvalBaseline.byQuestionType,
  ).sort()) {
    if ((LONGMEMEVAL_TARGETS as readonly string[]).includes(questionType)) {
      continue;
    }
    const baseline = longMemEvalRecall(input.longMemEvalBaseline, questionType);
    const candidate = longMemEvalRecall(input.longMemEvalCandidate, questionType);
    if (baseline === null || candidate === null) {
      failures.push(
        `LongMemEval ${questionType} protection slice is missing or empty`,
      );
      continue;
    }
    protections.push(
      evaluateProtection({
        baseline,
        benchmark: "LongMemEval",
        candidate,
        name: questionType,
      }),
    );
  }
  for (const questionType of Object.keys(LONGMEMEVAL_EXPECTED_TYPE_COUNTS)) {
    const baseline = input.longMemEvalBaseline.byQuestionType[questionType];
    const candidate = input.longMemEvalCandidate.byQuestionType[questionType];
    if (!baseline || !candidate || baseline.evidenceCaseCount <= 0) {
      continue;
    }
    const baselineNoise =
      baseline.wrongSessionTotal / baseline.evidenceCaseCount;
    const candidateNoise =
      candidate.wrongSessionTotal / candidate.evidenceCaseCount;
    const delta = candidateNoise - baselineNoise;
    noiseProtections.push({
      baseline: baselineNoise,
      benchmark: "LongMemEval",
      candidate: candidateNoise,
      delta,
      name: `${questionType}:wrong-sessions-per-question`,
      passed:
        delta <= PHASE69_MAX_ADDED_WRONG_SESSIONS_PER_QUESTION,
      threshold: PHASE69_MAX_ADDED_WRONG_SESSIONS_PER_QUESTION,
    });
  }

  for (const target of targets.filter((slice) => !slice.passed)) {
    failures.push(
      `${target.benchmark} ${target.name} delta ${format(target.delta)} is below ${format(PHASE69_TARGET_MIN_DELTA)}`,
    );
  }
  for (const protection of protections.filter((slice) => !slice.passed)) {
    failures.push(
      `${protection.benchmark} ${protection.name} delta ${format(protection.delta)} exceeds the -${format(PHASE69_PROTECTION_MAX_REGRESSION)} regression limit`,
    );
  }
  for (const protection of noiseProtections.filter((slice) => !slice.passed)) {
    if (protection.benchmark === "LongMemEval") {
      failures.push(
        `${protection.benchmark} ${protection.name} added ${format(protection.delta)} wrong sessions per question, above ${format(PHASE69_MAX_ADDED_WRONG_SESSIONS_PER_QUESTION)}`,
      );
    } else {
      failures.push(
        `${protection.benchmark} ${protection.name} added ${format(protection.delta)} noise turns per question, above ${format(PHASE69_MAX_ADDED_NOISE_PER_QUESTION)}`,
      );
    }
  }

  return {
    failures,
    noiseProtections,
    protections,
    status: failures.length === 0 ? "passed" : "failed",
    targets,
    thresholds: {
      maxAddedNoisePerQuestion: PHASE69_MAX_ADDED_NOISE_PER_QUESTION,
      maxAddedWrongSessionsPerQuestion:
        PHASE69_MAX_ADDED_WRONG_SESSIONS_PER_QUESTION,
      protectionMaxRegression: PHASE69_PROTECTION_MAX_REGRESSION,
      targetMinDelta: PHASE69_TARGET_MIN_DELTA,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  if (!sameStrings(Object.keys(value), keys)) {
    throw new Error(`${label} must contain exactly: ${keys.join(", ")}`);
  }
}

function readGeneralizedFusionConfig(
  value: unknown,
  label: string,
): Phase69GeneralizedFusionConfig | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object or null`);
  }
  assertExactKeys(
    value,
    ["maxCandidates", "maxTotalFacts", "minRelativeStrength", "rrfK"],
    label,
  );
  return {
    maxCandidates: readNumber(value.maxCandidates, `${label}.maxCandidates`),
    maxTotalFacts: readNumber(value.maxTotalFacts, `${label}.maxTotalFacts`),
    minRelativeStrength: readNumber(
      value.minRelativeStrength,
      `${label}.minRelativeStrength`,
    ),
    rrfK: readNumber(value.rrfK, `${label}.rrfK`),
  };
}

function readLongMemEvalRunConfiguration(
  value: unknown,
): LongMemEvalRecallRunConfiguration {
  if (!isRecord(value)) {
    throw new Error("LongMemEval runConfiguration must be an object");
  }
  assertExactKeys(
    value,
    [
      "contextMaxTokens",
      "extractionStrategy",
      "generalizedFusion",
      "projection",
      "providerEmbedding",
      "recallStrategy",
    ],
    "LongMemEval runConfiguration",
  );
  if (value.extractionStrategy !== "rules-only") {
    throw new Error("LongMemEval extractionStrategy must be rules-only");
  }
  if (
    value.recallStrategy !== "hybrid" &&
    value.recallStrategy !== "rules-only"
  ) {
    throw new Error("LongMemEval recallStrategy must be hybrid or rules-only");
  }
  if (typeof value.providerEmbedding !== "boolean") {
    throw new Error("LongMemEval providerEmbedding must be boolean");
  }
  if (!isRecord(value.projection)) {
    throw new Error("LongMemEval projection must be an object");
  }
  assertExactKeys(
    value.projection,
    ["bulkBackfill", "writeThrough"],
    "LongMemEval projection",
  );
  if (
    typeof value.projection.bulkBackfill !== "boolean" ||
    typeof value.projection.writeThrough !== "boolean"
  ) {
    throw new Error("LongMemEval projection values must be boolean");
  }
  return {
    contextMaxTokens: readNumber(
      value.contextMaxTokens,
      "LongMemEval contextMaxTokens",
    ),
    extractionStrategy: "rules-only",
    generalizedFusion: readGeneralizedFusionConfig(
      value.generalizedFusion,
      "LongMemEval generalizedFusion",
    ),
    projection: {
      bulkBackfill: value.projection.bulkBackfill,
      writeThrough: value.projection.writeThrough,
    },
    providerEmbedding: value.providerEmbedding,
    recallStrategy: value.recallStrategy,
  };
}

function sameMetric(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-12;
}

export function readLocomoPhase69GateReport(
  value: unknown,
): Phase69LocomoGateReport {
  if (!isRecord(value) || value.benchmark !== "locomo") {
    throw new Error("Phase 69 LoCoMo report must have benchmark=locomo");
  }
  if (!Array.isArray(value.categories) || !Array.isArray(value.cases)) {
    throw new Error("Phase 69 LoCoMo report must contain categories and cases");
  }
  const categoryRows = new Map<string, number[]>();
  const categoryNoise = new Map<string, number>();
  const questionIds = value.cases.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`cases[${index}] must be an object`);
    }
    const category = readString(entry.category, `cases[${index}].category`);
    const evidenceRecall = readNumber(
      entry.evidenceRecall,
      `cases[${index}].evidenceRecall`,
    );
    const rows = categoryRows.get(category) ?? [];
    rows.push(evidenceRecall);
    categoryRows.set(category, rows);
    categoryNoise.set(
      category,
      (categoryNoise.get(category) ?? 0) +
        readNumber(entry.noiseTurnCount, `cases[${index}].noiseTurnCount`),
    );
    return `${readString(entry.caseId, `cases[${index}].caseId`)}:${readString(entry.questionId, `cases[${index}].questionId`)}`;
  });
  const declaredCategoryEntries = value.categories.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(`categories[${index}] must be an object`);
      }
      return [
        readString(entry.category, `categories[${index}].category`),
        {
          averageEvidenceRecall: readNumber(
            entry.averageEvidenceRecall,
            `categories[${index}].averageEvidenceRecall`,
          ),
          noiseTurnTotal: readNumber(
            entry.noiseTurnTotal,
            `categories[${index}].noiseTurnTotal`,
          ),
          questionCount: readNumber(
            entry.questionCount,
            `categories[${index}].questionCount`,
          ),
        },
      ] as const;
    });
  const declaredCategories = new Map(declaredCategoryEntries);
  if (declaredCategories.size !== declaredCategoryEntries.length) {
    throw new Error("LoCoMo category summary contains duplicate categories");
  }
  const categories = [...categoryRows.entries()].map(([category, recalls]) => {
    const computed = {
      averageEvidenceRecall:
        recalls.reduce((sum, recall) => sum + recall, 0) / recalls.length,
      category,
      noiseTurnTotal: categoryNoise.get(category) ?? 0,
      questionCount: recalls.length,
    };
    const declared = declaredCategories.get(category);
    if (
      !declared ||
      declared.questionCount !== computed.questionCount ||
      declared.noiseTurnTotal !== computed.noiseTurnTotal ||
      !sameMetric(
        declared.averageEvidenceRecall,
        computed.averageEvidenceRecall,
      )
    ) {
      throw new Error(`LoCoMo ${category} category summary does not match cases`);
    }
    return computed;
  });
  const computedExecutionFailures = value.cases.filter(
    (entry) =>
      isRecord(entry) &&
      (entry.executionFailureStage != null || entry.executionFailureMessage != null),
  ).length;
  const executionFailures = readNumber(
    value.executionFailures,
    "executionFailures",
  );
  if (executionFailures !== computedExecutionFailures) {
    throw new Error("LoCoMo executionFailures does not match cases");
  }
  if (!isRecord(value.retrievalConfig)) {
    throw new Error("LoCoMo retrievalConfig must be an object");
  }
  return {
    benchmark: "locomo",
    benchmarkFingerprint: readString(
      value.benchmarkFingerprint,
      "benchmarkFingerprint",
    ),
    benchmarkSource: readString(value.benchmarkSource, "benchmarkSource"),
    caseIds: Array.isArray(value.caseIds)
      ? value.caseIds.map((item) => readString(item, "caseId"))
      : [],
    categories,
    executionFailures,
    generalizedFusion: value.generalizedFusion === true,
    ...(value.longRecordAdmission === true ? { longRecordAdmission: true } : {}),
    generalizedFusionConfig: readGeneralizedFusionConfig(
      value.generalizedFusionConfig,
      "LoCoMo generalizedFusionConfig",
    ),
    labelFreeIngest: value.labelFreeIngest === true,
    questionIds,
    retrievalConfig: Object.fromEntries(
      Object.entries(value.retrievalConfig).map(([key, entry]) => {
        if (typeof entry !== "boolean") {
          throw new Error(`retrievalConfig.${key} must be boolean`);
        }
        return [key, entry];
      }),
    ),
  };
}

export function readLongMemEvalPhase69GateReport(
  value: unknown,
): Phase69LongMemEvalGateReport {
  if (!isRecord(value) || !isRecord(value.summary) || !Array.isArray(value.cases)) {
    throw new Error("Phase 69 LongMemEval report must contain summary and cases");
  }
  const declaredByQuestionType = value.summary.byQuestionType;
  if (!isRecord(declaredByQuestionType)) {
    throw new Error("LongMemEval summary.byQuestionType must be an object");
  }
  const rowsByQuestionType = new Map<
    string,
    { recalls: number[]; wrongSessionTotal: number }
  >();
  let computedExecutionFailures = 0;
  const questionIds = value.cases.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`cases[${index}] must be an object`);
    }
    const questionType = readString(
      entry.questionType,
      `cases[${index}].questionType`,
    );
    const recall = entry.evidenceSessionRecall;
    if (recall !== null) {
      const rows = rowsByQuestionType.get(questionType) ?? {
        recalls: [],
        wrongSessionTotal: 0,
      };
      rows.recalls.push(
        readNumber(recall, `cases[${index}].evidenceSessionRecall`),
      );
      if (!Array.isArray(entry.wrongRecallSessionIds)) {
        throw new Error(
          `cases[${index}].wrongRecallSessionIds must be an array`,
        );
      }
      for (const wrongSessionId of entry.wrongRecallSessionIds) {
        readString(
          wrongSessionId,
          `cases[${index}].wrongRecallSessionIds[]`,
        );
      }
      rows.wrongSessionTotal += entry.wrongRecallSessionIds.length;
      rowsByQuestionType.set(questionType, rows);
    }
    if (entry.executionError !== undefined) {
      computedExecutionFailures += 1;
    }
    return readString(entry.questionId, `cases[${index}].questionId`);
  });
  const byQuestionType = Object.fromEntries(
    [...rowsByQuestionType.entries()].map(([questionType, rows]) => {
      const computed = {
        evidenceCaseCount: rows.recalls.length,
        evidenceSessionRecall:
          rows.recalls.reduce((sum, recall) => sum + recall, 0) /
          rows.recalls.length,
        wrongSessionTotal: rows.wrongSessionTotal,
      };
      const declared = declaredByQuestionType[questionType];
      if (!isRecord(declared)) {
        throw new Error(
          `LongMemEval ${questionType} question-type summary does not match cases`,
        );
      }
      const declaredRecall = declared.evidenceSessionRecall;
      if (
        readNumber(
          declared.evidenceCaseCount,
          `${questionType}.evidenceCaseCount`,
        ) !== computed.evidenceCaseCount ||
        declaredRecall === null ||
        !sameMetric(
          readNumber(declaredRecall, `${questionType}.evidenceSessionRecall`),
          computed.evidenceSessionRecall,
        )
      ) {
        throw new Error(
          `LongMemEval ${questionType} question-type summary does not match cases`,
        );
      }
      return [questionType, computed] as const;
    }),
  );
  const executionFailures = readNumber(
    value.summary.executionFailures,
    "summary.executionFailures",
  );
  if (executionFailures !== computedExecutionFailures) {
    throw new Error("LongMemEval executionFailures does not match cases");
  }
  return {
    benchmarkFingerprint: readString(
      value.benchmarkFingerprint,
      "benchmarkFingerprint",
    ),
    benchmarkRoot: readString(value.benchmarkRoot, "benchmarkRoot"),
    byQuestionType,
    executionFailures,
    ingestMode: readString(value.ingestMode, "ingestMode"),
    profile: readString(value.profile, "profile"),
    questionIds,
    runConfiguration: readLongMemEvalRunConfiguration(value.runConfiguration),
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export function assertPhase69OutputPathIsDistinct(input: {
  inputPaths: readonly string[];
  outputPath: string;
}): void {
  const resolvedOutputPath = resolve(input.outputPath);
  if (input.inputPaths.some((path) => resolve(path) === resolvedOutputPath)) {
    throw new Error(
      "Phase 69 gate output path must differ from every input report path",
    );
  }
}

async function main(): Promise<void> {
  const locomoBaselinePath = resolveCliFlagValueStrict(
    Bun.argv,
    "--locomo-baseline",
  );
  const locomoCandidatePath = resolveCliFlagValueStrict(
    Bun.argv,
    "--locomo-candidate",
  );
  const longMemBaselinePath = resolveCliFlagValueStrict(
    Bun.argv,
    "--longmemeval-baseline",
  );
  const longMemCandidatePath = resolveCliFlagValueStrict(
    Bun.argv,
    "--longmemeval-candidate",
  );
  if (
    !locomoBaselinePath ||
    !locomoCandidatePath ||
    !longMemBaselinePath ||
    !longMemCandidatePath
  ) {
    throw new Error(
      "Phase 69 gate requires --locomo-baseline, --locomo-candidate, --longmemeval-baseline, and --longmemeval-candidate",
    );
  }
  const repoRoot = resolveRepoRootFromScriptUrl(import.meta.url);
  const outputPath =
    resolveCliFlagValueStrict(Bun.argv, "--output") ??
    join(repoRoot, "reports", "quality-gates", "phase-69", "gate.json");
  assertPhase69OutputPathIsDistinct({
    inputPaths: [
      locomoBaselinePath,
      locomoCandidatePath,
      longMemBaselinePath,
      longMemCandidatePath,
    ],
    outputPath,
  });
  const [locomoBaseline, locomoCandidate, longMemBaseline, longMemCandidate] =
    await Promise.all([
      readJson(locomoBaselinePath),
      readJson(locomoCandidatePath),
      readJson(longMemBaselinePath),
      readJson(longMemCandidatePath),
    ]);
  const result = evaluatePhase69Gate({
    locomoBaseline: readLocomoPhase69GateReport(locomoBaseline),
    locomoCandidate: readLocomoPhase69GateReport(locomoCandidate),
    longMemEvalBaseline: readLongMemEvalPhase69GateReport(longMemBaseline),
    longMemEvalCandidate: readLongMemEvalPhase69GateReport(longMemCandidate),
  });
  const artifact = {
    ...result,
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/run-phase-69-gate.ts",
    inputs: {
      locomoBaselinePath,
      locomoCandidatePath,
      longMemBaselinePath,
      longMemCandidatePath,
    },
    phase: "phase-69",
    sourcePins: {
      locomo: {
        normalizedFingerprint: PHASE69_LOCOMO_BENCHMARK_FINGERPRINT,
        sourceCommit: LOCOMO_UPSTREAM_COMMIT,
        sourceSha256: LOCOMO_UPSTREAM_SHA256,
      },
      longMemEval: {
        normalizedFingerprint: PHASE69_LONGMEMEVAL_BENCHMARK_FINGERPRINT,
        sourceCommit: PHASE69_LONGMEMEVAL_UPSTREAM_COMMIT,
        sourceSha256: PHASE69_LONGMEMEVAL_SOURCE_SHA256,
      },
    },
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify(artifact, null, 2));
  if (result.status === "failed") {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
