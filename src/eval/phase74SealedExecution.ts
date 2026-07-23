import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { z } from "zod";

import {
  buildPhase74LabelFreeCaseBoundary,
  type Phase74GeneralizationCase,
} from "./phase74Generalization";

const rawEvidenceSchema = z.object({
  content: z.string(),
  id: z.string().min(1),
  observedAt: z.string().optional(),
  role: z.string().optional(),
  sourceIds: z.array(z.string()),
}).strict();

const executionCaseSchema = z.object({
  caseKey: z.string().min(1),
  locale: z.string().optional(),
  memoryGroupId: z.string().optional(),
  question: z.string(),
  rawEvidence: z.array(rawEvidenceSchema),
  referenceTime: z.string().optional(),
}).strict();

const executionBundleSchema = z.object({
  cases: z.array(executionCaseSchema),
  runId: z.string().min(1),
  schemaVersion: z.literal(1),
}).strict();

const escrowCaseSchema = z.object({
  caseKey: z.string().min(1),
  expectedAnswer: z.string(),
  family: z.enum(["locomo", "longmemeval"]).optional(),
  goldEvidenceIds: z.array(z.string()),
  originalCaseId: z.string().min(1),
  protocolMetadata: z.record(z.string(), z.unknown()).optional(),
  unresolvedGoldEvidenceIds: z.array(z.string()),
}).strict();

const escrowBundleSchema = z.object({
  cases: z.array(escrowCaseSchema),
  executionSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  runId: z.string().min(1),
  schemaVersion: z.literal(1),
}).strict();

const executorRowSchema = z.object({
  answer: z.string().nullable(),
  caseKey: z.string().min(1),
  executionError: z.string().optional(),
  rowKey: z.string().min(1),
  snapshotId: z.string().min(1),
}).strict();

const executorOutputSchema = z.object({
  executionSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  executorPid: z.number().int().positive(),
  rows: z.array(executorRowSchema),
  runId: z.string().min(1),
  schemaVersion: z.literal(1),
}).strict();

const scoreRowSchema = z.object({
  caseKey: z.string().min(1),
  correct: z.boolean(),
  rowKey: z.string().min(1),
  score: z.number().min(0).max(1),
}).strict();

const scoreReceiptSchema = z.object({
  escrowSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  executionSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  executorOutputSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  rows: z.array(scoreRowSchema),
  runId: z.string().min(1),
  schemaVersion: z.literal(1),
  scorerPid: z.number().int().positive(),
}).strict();

export type Phase74SealedExecutionBundle = z.infer<
  typeof executionBundleSchema
>;
export type Phase74SealedEscrowBundle = z.infer<typeof escrowBundleSchema>;
export type Phase74SealedExecutorOutput = z.infer<typeof executorOutputSchema>;
export type Phase74SealedScoreReceipt = z.infer<typeof scoreReceiptSchema>;

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseWithMessage<T>(input: {
  message: string;
  schema: z.ZodType<T>;
  value: unknown;
}): T {
  const parsed = input.schema.safeParse(input.value);
  if (!parsed.success) {
    throw new Error(`${input.message}: ${parsed.error.issues[0]?.message ?? "invalid"}.`);
  }
  return parsed.data;
}

export function parsePhase74SealedExecutionBundle(
  value: unknown,
): Phase74SealedExecutionBundle {
  return parseWithMessage({
    message: "Invalid Phase 74 sealed execution bundle",
    schema: executionBundleSchema,
    value,
  });
}

export function parsePhase74SealedEscrowBundle(
  value: unknown,
): Phase74SealedEscrowBundle {
  return parseWithMessage({
    message: "Invalid Phase 74 sealed escrow bundle",
    schema: escrowBundleSchema,
    value,
  });
}

export function parsePhase74SealedExecutorOutput(
  value: unknown,
): Phase74SealedExecutorOutput {
  return parseWithMessage({
    message: "Invalid Phase 74 sealed executor output",
    schema: executorOutputSchema,
    value,
  });
}

export function parsePhase74SealedScoreReceipt(
  value: unknown,
): Phase74SealedScoreReceipt {
  return parseWithMessage({
    message: "Invalid Phase 74 sealed score receipt",
    schema: scoreReceiptSchema,
    value,
  });
}

export function buildPhase74SealedBundles(input: {
  cases: readonly Phase74GeneralizationCase[];
  runId: string;
}): {
  escrow: Phase74SealedEscrowBundle;
  execution: Phase74SealedExecutionBundle;
} {
  const boundaries = input.cases.map((testCase) => ({
    boundary: buildPhase74LabelFreeCaseBoundary(testCase),
    testCase,
  }));
  const execution = parsePhase74SealedExecutionBundle({
    cases: boundaries.map(({ boundary }) => ({
      caseKey: boundary.caseKey,
      ...(boundary.recallCase.locale === undefined
        ? {}
        : { locale: boundary.recallCase.locale }),
      ...(boundary.recallCase.memoryGroupId === undefined
        ? {}
        : { memoryGroupId: boundary.recallCase.memoryGroupId }),
      question: boundary.recallCase.question,
      rawEvidence: boundary.recallCase.rawEvidence,
      ...(boundary.recallCase.referenceTime === undefined
        ? {}
        : { referenceTime: boundary.recallCase.referenceTime }),
    })),
    runId: input.runId,
    schemaVersion: 1,
  });
  const escrow = parsePhase74SealedEscrowBundle({
    cases: boundaries.map(({ boundary, testCase }) => ({
      caseKey: boundary.caseKey,
      expectedAnswer: testCase.expectedAnswer,
      ...(testCase.family === undefined ? {} : { family: testCase.family }),
      goldEvidenceIds: boundary.goldEvidenceIds,
      originalCaseId: testCase.caseId,
      ...(testCase.protocolMetadata === undefined
        ? {}
        : { protocolMetadata: testCase.protocolMetadata }),
      unresolvedGoldEvidenceIds: boundary.unresolvedGoldEvidenceIds,
    })),
    executionSha256: sha256Json(execution),
    runId: input.runId,
    schemaVersion: 1,
  });
  return { escrow, execution };
}

export function buildPhase74SealedExecutorOutput(input: {
  execution: Phase74SealedExecutionBundle;
  executorPid: number;
  rows: Phase74SealedExecutorOutput["rows"];
}): Phase74SealedExecutorOutput {
  return parsePhase74SealedExecutorOutput({
    executionSha256: sha256Json(input.execution),
    executorPid: input.executorPid,
    rows: input.rows,
    runId: input.execution.runId,
    schemaVersion: 1,
  });
}

export function buildPhase74SealedScoreReceipt(input: {
  escrow: Phase74SealedEscrowBundle;
  executorOutput: Phase74SealedExecutorOutput;
  rows: Phase74SealedScoreReceipt["rows"];
  scorerPid: number;
}): Phase74SealedScoreReceipt {
  return parsePhase74SealedScoreReceipt({
    escrowSha256: sha256Json(input.escrow),
    executionSha256: input.escrow.executionSha256,
    executorOutputSha256: sha256Json(input.executorOutput),
    rows: input.rows,
    runId: input.escrow.runId,
    schemaVersion: 1,
    scorerPid: input.scorerPid,
  });
}

function sameOrderedCaseKeys(
  left: readonly { caseKey: string }[],
  right: readonly { caseKey: string }[],
): boolean {
  return left.length === right.length &&
    left.every(({ caseKey }, index) => caseKey === right[index]?.caseKey);
}

function sameOrderedRows(
  left: readonly { caseKey: string; rowKey: string }[],
  right: readonly { caseKey: string; rowKey: string }[],
): boolean {
  return left.length === right.length && left.every((row, index) =>
    row.caseKey === right[index]?.caseKey &&
    row.rowKey === right[index]?.rowKey
  );
}

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function coversExecutionCases(input: {
  execution: Phase74SealedExecutionBundle;
  rows: Phase74SealedExecutorOutput["rows"];
}): boolean {
  const expected = new Set(input.execution.cases.map(({ caseKey }) => caseKey));
  const observed = new Set(input.rows.map(({ caseKey }) => caseKey));
  return expected.size === input.execution.cases.length &&
    observed.size === expected.size &&
    [...observed].every((caseKey) => expected.has(caseKey));
}

export function verifyPhase74SealedScoreReceipt(input: {
  escrow: Phase74SealedEscrowBundle;
  execution: Phase74SealedExecutionBundle;
  executorOutput: Phase74SealedExecutorOutput;
  receipt: Phase74SealedScoreReceipt;
}): void {
  const execution = parsePhase74SealedExecutionBundle(input.execution);
  const escrow = parsePhase74SealedEscrowBundle(input.escrow);
  const output = parsePhase74SealedExecutorOutput(input.executorOutput);
  const receipt = parsePhase74SealedScoreReceipt(input.receipt);
  const executionSha256 = sha256Json(execution);
  if (
    escrow.runId !== execution.runId ||
    output.runId !== execution.runId ||
    receipt.runId !== execution.runId ||
    escrow.executionSha256 !== executionSha256 ||
    output.executionSha256 !== executionSha256 ||
    receipt.executionSha256 !== executionSha256 ||
    receipt.escrowSha256 !== sha256Json(escrow) ||
    receipt.executorOutputSha256 !== sha256Json(output) ||
    !sameOrderedCaseKeys(execution.cases, escrow.cases) ||
    !coversExecutionCases({ execution, rows: output.rows }) ||
    !hasUniqueValues(output.rows.map(({ rowKey }) => rowKey)) ||
    !sameOrderedRows(output.rows, receipt.rows)
  ) {
    throw new Error("Phase 74 sealed score receipt chain is invalid.");
  }
}

function processEnv(
  input: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

async function runChild(input: {
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  script: string;
  stdin: string;
}): Promise<{ exitCode: number; pid: number; stderr: string; stdout: string }> {
  const child = Bun.spawn({
    cmd: [process.execPath, input.script],
    cwd: input.cwd,
    env: processEnv(input.env),
    stdin: Buffer.from(input.stdin),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return { exitCode, pid: child.pid, stderr, stdout };
}

export async function runPhase74SealedProcessPair(input: {
  cwd: string;
  execution: Phase74SealedExecutionBundle;
  escrow: Phase74SealedEscrowBundle;
  executorEnv: Readonly<Record<string, string | undefined>>;
  executorScript: string;
  scorerEnv: Readonly<Record<string, string | undefined>>;
  scorerScript: string;
  transcriptPath: string;
}): Promise<{
  events: Array<{ event: string; pid?: number }>;
  executor: {
    output: Phase74SealedExecutorOutput;
    pid: number;
    stderr: string;
    stdin: string;
    stdout: string;
  };
  scorer: { pid: number; receipt: Phase74SealedScoreReceipt };
}> {
  const execution = parsePhase74SealedExecutionBundle(input.execution);
  const escrow = parsePhase74SealedEscrowBundle(input.escrow);
  if (escrow.executionSha256 !== sha256Json(execution)) {
    throw new Error("Phase 74 sealed escrow does not bind the execution bundle.");
  }
  const events: Array<{ event: string; pid?: number }> = [{ event: "seal" }];
  const executorStdin = JSON.stringify(execution);
  const executor = await runChild({
    cwd: input.cwd,
    env: input.executorEnv,
    script: input.executorScript,
    stdin: executorStdin,
  });
  events.push({ event: "executor_exit", pid: executor.pid });
  if (executor.exitCode !== 0) {
    throw new Error(`Phase 74 sealed executor failed: ${executor.stderr.trim()}`);
  }
  const executorOutput = parsePhase74SealedExecutorOutput(
    JSON.parse(executor.stdout),
  );
  events.push({ event: "scorer_start" });
  const scorer = await runChild({
    cwd: input.cwd,
    env: input.scorerEnv,
    script: input.scorerScript,
    stdin: JSON.stringify({ escrow, executorOutput }),
  });
  events.push({ event: "scorer_exit", pid: scorer.pid });
  if (scorer.exitCode !== 0) {
    throw new Error(`Phase 74 sealed scorer failed: ${scorer.stderr.trim()}`);
  }
  const receipt = parsePhase74SealedScoreReceipt(JSON.parse(scorer.stdout));
  verifyPhase74SealedScoreReceipt({
    escrow,
    execution,
    executorOutput,
    receipt,
  });
  await writeFile(input.transcriptPath, `${JSON.stringify({
    events,
    executionSha256: sha256Json(execution),
    executorOutputSha256: sha256Json(executorOutput),
    receiptSha256: sha256Json(receipt),
    schemaVersion: 1,
  }, null, 2)}\n`);
  return {
    events,
    executor: {
      output: executorOutput,
      pid: executor.pid,
      stderr: executor.stderr,
      stdin: executorStdin,
      stdout: executor.stdout,
    },
    scorer: { pid: scorer.pid, receipt },
  };
}
