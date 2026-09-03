// Phase 75 long-record admission gate.
//
// Compares a paired provider-free run (baseline vs `--long-record-admission`)
// on the frozen LongMemEval recall diagnostic and LoCoMo smoke slices and
// decides whether the opt-in `retrieval.longRecordAdmission` knob may become
// the fresh installed-host default. The gate reuses the Phase 69 report
// readers and protection thresholds; it does not assert generalized fusion,
// so it can judge the rules-only tier the knob is meant for.
//
// Rule: per LongMemEval question type the evidence-session recall delta is at
// least -PHASE69_PROTECTION_MAX_REGRESSION and the wrong-session total does
// not grow; per LoCoMo category the average evidence recall delta is at least
// -PHASE69_PROTECTION_MAX_REGRESSION and added noise per question is at most
// PHASE69_MAX_ADDED_NOISE_PER_QUESTION. Both pairs must share question ids and
// benchmark fingerprints, and only the candidate may carry the knob.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { LongMemEvalRecallRunConfiguration } from "../src/eval/longmemeval";
import {
  PHASE69_MAX_ADDED_NOISE_PER_QUESTION,
  PHASE69_PROTECTION_MAX_REGRESSION,
  type Phase69LocomoGateReport,
  type Phase69LongMemEvalGateReport,
} from "./run-phase-69-gate";
import { resolveCliFlagValueStrict } from "./cli-options";

export const PHASE75_GATE_ID = "phase-75-long-record-admission-gate";

export interface Phase75GateInput {
  locomoBaseline: Phase69LocomoGateReport;
  locomoCandidate: Phase69LocomoGateReport;
  longMemEvalBaseline: Phase69LongMemEvalGateReport;
  longMemEvalCandidate: Phase69LongMemEvalGateReport;
}

export interface Phase75GateSlice {
  baseline: number;
  benchmark: "LoCoMo" | "LongMemEval";
  candidate: number;
  delta: number;
  metric: "averageEvidenceRecall" | "evidenceSessionRecall" | "noisePerQuestion" | "wrongSessionTotal";
  name: string;
  passed: boolean;
  threshold: number;
}

export interface Phase75GateResult {
  failures: string[];
  gate: typeof PHASE75_GATE_ID;
  slices: Phase75GateSlice[];
  status: "failed" | "passed";
  thresholds: {
    maxAddedNoisePerQuestion: number;
    protectionMaxRegression: number;
  };
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function evaluatePhase75Gate(input: Phase75GateInput): Phase75GateResult {
  const failures: string[] = [];
  const slices: Phase75GateSlice[] = [];

  const {
    locomoBaseline,
    locomoCandidate,
    longMemEvalBaseline,
    longMemEvalCandidate,
  } = input;

  if (longMemEvalBaseline.benchmarkFingerprint !== longMemEvalCandidate.benchmarkFingerprint) {
    failures.push("LongMemEval baseline and candidate must share a benchmark fingerprint");
  }
  if (!sameIds(longMemEvalBaseline.questionIds, longMemEvalCandidate.questionIds)) {
    failures.push("LongMemEval baseline and candidate must cover the same question ids");
  }
  if (longMemEvalBaseline.profile !== longMemEvalCandidate.profile) {
    failures.push("LongMemEval baseline and candidate must use the same profile");
  }
  if (longMemEvalBaseline.runConfiguration.longRecordAdmission) {
    failures.push("LongMemEval baseline must not carry longRecordAdmission");
  }
  if (longMemEvalCandidate.runConfiguration.longRecordAdmission !== true) {
    failures.push("LongMemEval candidate must record longRecordAdmission=true");
  }
  if (longMemEvalCandidate.executionFailures > 0 || longMemEvalBaseline.executionFailures > 0) {
    failures.push("LongMemEval reports must have no execution failures");
  }

  if (locomoBaseline.benchmarkFingerprint !== locomoCandidate.benchmarkFingerprint) {
    failures.push("LoCoMo baseline and candidate must share a benchmark fingerprint");
  }
  if (!sameIds(locomoBaseline.questionIds, locomoCandidate.questionIds)) {
    failures.push("LoCoMo baseline and candidate must cover the same question ids");
  }
  if (locomoBaseline.longRecordAdmission) {
    failures.push("LoCoMo baseline must not carry longRecordAdmission");
  }
  if (locomoCandidate.longRecordAdmission !== true) {
    failures.push("LoCoMo candidate must record longRecordAdmission=true");
  }
  if (locomoCandidate.executionFailures > 0 || locomoBaseline.executionFailures > 0) {
    failures.push("LoCoMo reports must have no execution failures");
  }

  for (const [questionType, baseline] of Object.entries(longMemEvalBaseline.byQuestionType)) {
    const candidate = longMemEvalCandidate.byQuestionType[questionType];
    if (!candidate) {
      failures.push(`LongMemEval candidate is missing question type ${questionType}`);
      continue;
    }
    if (baseline.evidenceSessionRecall !== null && candidate.evidenceSessionRecall !== null) {
      const delta = round(candidate.evidenceSessionRecall - baseline.evidenceSessionRecall);
      const passed = delta >= -PHASE69_PROTECTION_MAX_REGRESSION;
      slices.push({
        baseline: baseline.evidenceSessionRecall,
        benchmark: "LongMemEval",
        candidate: candidate.evidenceSessionRecall,
        delta,
        metric: "evidenceSessionRecall",
        name: questionType,
        passed,
        threshold: -PHASE69_PROTECTION_MAX_REGRESSION,
      });
      if (!passed) {
        failures.push(`LongMemEval ${questionType} evidence-session recall regressed by ${-delta}`);
      }
    }
    const wrongDelta = candidate.wrongSessionTotal - baseline.wrongSessionTotal;
    const wrongPassed = wrongDelta <= 0;
    slices.push({
      baseline: baseline.wrongSessionTotal,
      benchmark: "LongMemEval",
      candidate: candidate.wrongSessionTotal,
      delta: wrongDelta,
      metric: "wrongSessionTotal",
      name: questionType,
      passed: wrongPassed,
      threshold: 0,
    });
    if (!wrongPassed) {
      failures.push(`LongMemEval ${questionType} wrong-session total grew by ${wrongDelta}`);
    }
  }

  const candidateCategories = new Map(
    locomoCandidate.categories.map((entry) => [entry.category, entry] as const),
  );
  for (const baseline of locomoBaseline.categories) {
    const candidate = candidateCategories.get(baseline.category);
    if (!candidate) {
      failures.push(`LoCoMo candidate is missing category ${baseline.category}`);
      continue;
    }
    const delta = round(candidate.averageEvidenceRecall - baseline.averageEvidenceRecall);
    const passed = delta >= -PHASE69_PROTECTION_MAX_REGRESSION;
    slices.push({
      baseline: baseline.averageEvidenceRecall,
      benchmark: "LoCoMo",
      candidate: candidate.averageEvidenceRecall,
      delta,
      metric: "averageEvidenceRecall",
      name: baseline.category,
      passed,
      threshold: -PHASE69_PROTECTION_MAX_REGRESSION,
    });
    if (!passed) {
      failures.push(`LoCoMo ${baseline.category} evidence recall regressed by ${-delta}`);
    }
    const baselineNoise = baseline.questionCount > 0 ? baseline.noiseTurnTotal / baseline.questionCount : 0;
    const candidateNoise = candidate.questionCount > 0 ? candidate.noiseTurnTotal / candidate.questionCount : 0;
    const noiseDelta = round(candidateNoise - baselineNoise);
    const noisePassed = noiseDelta <= PHASE69_MAX_ADDED_NOISE_PER_QUESTION;
    slices.push({
      baseline: round(baselineNoise),
      benchmark: "LoCoMo",
      candidate: round(candidateNoise),
      delta: noiseDelta,
      metric: "noisePerQuestion",
      name: baseline.category,
      passed: noisePassed,
      threshold: PHASE69_MAX_ADDED_NOISE_PER_QUESTION,
    });
    if (!noisePassed) {
      failures.push(`LoCoMo ${baseline.category} added ${noiseDelta} noise turns per question`);
    }
  }

  return {
    failures,
    gate: PHASE75_GATE_ID,
    slices,
    status: failures.length === 0 ? "passed" : "failed",
    thresholds: {
      maxAddedNoisePerQuestion: PHASE69_MAX_ADDED_NOISE_PER_QUESTION,
      protectionMaxRegression: PHASE69_PROTECTION_MAX_REGRESSION,
    },
  };
}

export interface Phase75GateCliOptions {
  locomoBaseline: string;
  locomoCandidate: string;
  longMemEvalBaseline: string;
  longMemEvalCandidate: string;
  output?: string;
}

function requireFlag(argv: readonly string[], flag: string): string {
  const value = resolveCliFlagValueStrict(argv, flag);
  if (!value) {
    throw new Error(`${flag} is required`);
  }
  return value;
}

export function parsePhase75GateCliOptions(argv: readonly string[]): Phase75GateCliOptions {
  return {
    locomoBaseline: requireFlag(argv, "--locomo-baseline"),
    locomoCandidate: requireFlag(argv, "--locomo-candidate"),
    longMemEvalBaseline: requireFlag(argv, "--longmemeval-baseline"),
    longMemEvalCandidate: requireFlag(argv, "--longmemeval-candidate"),
    ...(resolveCliFlagValueStrict(argv, "--output")
      ? { output: resolveCliFlagValueStrict(argv, "--output") }
      : {}),
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

// The Phase 69 LoCoMo reader pins the exact Phase 69 retrievalConfig contract
// (every entry boolean); later smoke reports carry non-boolean entries such
// as followUpMode. This gate needs only the category table, the question ids,
// and the arm marker, so it reads those tolerantly.
export function readPhase75LocomoReport(value: unknown): Phase69LocomoGateReport {
  if (!isRecord(value) || value.benchmark !== "locomo") {
    throw new Error("Phase 75 LoCoMo report must have benchmark=locomo");
  }
  if (!Array.isArray(value.categories) || !Array.isArray(value.cases)) {
    throw new Error("Phase 75 LoCoMo report must contain categories and cases");
  }
  const categories = value.categories.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`categories[${index}] must be an object`);
    }
    return {
      averageEvidenceRecall: readNumber(entry.averageEvidenceRecall, `categories[${index}].averageEvidenceRecall`),
      category: readString(entry.category, `categories[${index}].category`),
      noiseTurnTotal: readNumber(entry.noiseTurnTotal, `categories[${index}].noiseTurnTotal`),
      questionCount: readNumber(entry.questionCount, `categories[${index}].questionCount`),
    };
  });
  const questionIds = value.cases.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`cases[${index}] must be an object`);
    }
    return readString(entry.questionId, `cases[${index}].questionId`);
  });
  return {
    benchmark: "locomo",
    benchmarkFingerprint: readString(value.benchmarkFingerprint, "benchmarkFingerprint"),
    benchmarkSource: readString(value.benchmarkSource, "benchmarkSource"),
    caseIds: Array.isArray(value.caseIds) ? value.caseIds.map((id) => readString(id, "caseId")) : [],
    categories,
    executionFailures: typeof value.executionFailures === "number" ? value.executionFailures : 0,
    generalizedFusion: value.generalizedFusion === true,
    generalizedFusionConfig: null,
    labelFreeIngest: value.labelFreeIngest === true,
    ...(value.longRecordAdmission === true ? { longRecordAdmission: true } : {}),
    questionIds,
    retrievalConfig: {},
  };
}

// Same tolerance for LongMemEval: the Phase 69 reader pins the exact Phase 69
// runConfiguration key set, which excludes every later arm marker (including
// longRecordAdmission). Per-type rows are recomputed from the cases exactly
// as Phase 69 does; the declared summary is not trusted.
export function readPhase75LongMemEvalReport(value: unknown): Phase69LongMemEvalGateReport {
  if (!isRecord(value) || !isRecord(value.summary) || !Array.isArray(value.cases)) {
    throw new Error("Phase 75 LongMemEval report must contain summary and cases");
  }
  if (!isRecord(value.runConfiguration)) {
    throw new Error("Phase 75 LongMemEval report must contain runConfiguration");
  }
  const rows = new Map<string, { recalls: number[]; wrongSessionTotal: number }>();
  let executionFailures = 0;
  const questionIds = value.cases.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`cases[${index}] must be an object`);
    }
    const questionType = readString(entry.questionType, `cases[${index}].questionType`);
    const row = rows.get(questionType) ?? { recalls: [], wrongSessionTotal: 0 };
    if (entry.executionError !== undefined && entry.executionError !== null) {
      executionFailures += 1;
    }
    if (typeof entry.evidenceSessionRecall === "number") {
      row.recalls.push(entry.evidenceSessionRecall);
    }
    if (Array.isArray(entry.wrongRecallSessionIds)) {
      row.wrongSessionTotal += entry.wrongRecallSessionIds.length;
    }
    rows.set(questionType, row);
    return readString(entry.questionId, `cases[${index}].questionId`);
  });
  const byQuestionType = Object.fromEntries(
    [...rows.entries()].map(([questionType, row]) => [
      questionType,
      {
        evidenceCaseCount: row.recalls.length,
        evidenceSessionRecall:
          row.recalls.length === 0
            ? null
            : row.recalls.reduce((sum, recall) => sum + recall, 0) / row.recalls.length,
        wrongSessionTotal: row.wrongSessionTotal,
      },
    ]),
  );
  return {
    benchmarkFingerprint: readString(value.benchmarkFingerprint, "benchmarkFingerprint"),
    benchmarkRoot: typeof value.benchmarkRoot === "string" ? value.benchmarkRoot : "",
    byQuestionType,
    executionFailures:
      typeof value.summary.executionFailures === "number"
        ? value.summary.executionFailures
        : executionFailures,
    ingestMode: typeof value.ingestMode === "string" ? value.ingestMode : "",
    profile: readString(value.profile, "profile"),
    questionIds,
    runConfiguration: value.runConfiguration as unknown as LongMemEvalRecallRunConfiguration,
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}

export async function runPhase75Gate(options: Phase75GateCliOptions): Promise<Phase75GateResult> {
  const result = evaluatePhase75Gate({
    locomoBaseline: readPhase75LocomoReport(await readJson(options.locomoBaseline)),
    locomoCandidate: readPhase75LocomoReport(await readJson(options.locomoCandidate)),
    longMemEvalBaseline: readPhase75LongMemEvalReport(await readJson(options.longMemEvalBaseline)),
    longMemEvalCandidate: readPhase75LongMemEvalReport(await readJson(options.longMemEvalCandidate)),
  });
  if (options.output) {
    const target = resolve(options.output);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  return result;
}

if (import.meta.main) {
  const result = await runPhase75Gate(parsePhase75GateCliOptions(process.argv));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "passed" ? 0 : 1;
}
