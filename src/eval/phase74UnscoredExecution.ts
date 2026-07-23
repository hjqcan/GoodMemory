import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import type { EvidenceLedgerFormat } from "./evidenceLedgerFormats";
import {
  PHASE74_CONTEXT_TOKEN_BUDGET,
  renderOracleMatrixContext,
  truncateRenderedContext,
} from "./oracleMatrix";
import type {
  OracleMatrixReader,
  RenderedTokenCounter,
} from "./oracleMatrix";
import {
  buildPhase74StageConfigurations,
  phase74ComparisonBranch,
} from "./phase74Generalization";
import type {
  Phase74RecallCase,
  Phase74RetrievalExecutionInput,
  Phase74RetrievalSnapshot,
} from "./phase74Generalization";
import {
  buildPhase74SealedExecutorOutput,
  listPhase74SealedExpectedRows,
  parsePhase74SealedExecutionBundle,
  sha256Phase74SealedConfiguration,
  sha256Phase74SealedExecution,
} from "./phase74SealedExecution";
import type {
  Phase74SealedExecutionBundle,
  Phase74SealedExecutorOutput,
} from "./phase74SealedExecution";
import type { EvalRunJsonObject } from "./runIdentity";

export type Phase74UnscoredRetrievalSnapshot = Omit<
  Phase74RetrievalSnapshot,
  "evaluation"
> & { evaluation?: never };

interface Phase74UnscoredRowBase {
  answer: string;
  answerLatencyMs: number;
  caseKey: string;
  clusterKey: string;
  contextTokens: number;
  contextTokensBeforeTruncation: number;
  contextTruncated: boolean;
  observedAnswer: string;
  productLatencyMs: number;
  readerInputSha256: string;
  recallLatencyMs: number;
  renderedContext: string;
  renderedContextSha256: string;
  reused: boolean;
  rowKey: string;
  sourceRowKey: string;
  sourceSnapshotId: string;
  unit: string;
}

export interface Phase74UnscoredRetrievalRow
  extends Phase74UnscoredRowBase {
  kind: "retrieval";
  snapshot: Phase74UnscoredRetrievalSnapshot;
  stage: "E1" | "E2" | "E3";
}

export interface Phase74UnscoredLedgerRow extends Phase74UnscoredRowBase {
  format: EvidenceLedgerFormat;
  kind: "ledger";
  renderedLedgerSha256: string;
  stage: "E4";
}

export type Phase74UnscoredRow =
  | Phase74UnscoredLedgerRow
  | Phase74UnscoredRetrievalRow;

export interface Phase74UnscoredExecutionArtifact {
  executionSha256: string;
  rows: Phase74UnscoredRow[];
  runId: string;
  schemaVersion: 1;
  stage: Phase74SealedExecutionBundle["stage"];
}

export interface Phase74UnscoredCheckpoint {
  load(rowKey: string): Promise<Phase74UnscoredRow | null>;
  save(row: Phase74UnscoredRow): Promise<void>;
}

export interface RunPhase74UnscoredExecutionInput {
  baseConfiguration: EvalRunJsonObject;
  checkpoint?: Phase74UnscoredCheckpoint;
  contextTokenBudget?: number;
  countRenderedTokens: RenderedTokenCounter;
  executeRetrieval(
    input: Phase74RetrievalExecutionInput,
  ): Promise<Phase74RetrievalSnapshot>;
  execution: Phase74SealedExecutionBundle;
  executorPid: number;
  genericReader: OracleMatrixReader;
  loadDeterministicSnapshot?(
    caseKey: string,
  ): Promise<Phase74RetrievalSnapshot | null>;
  now?(): number;
  renderEvidenceLedger(input: {
    format: EvidenceLedgerFormat;
    locale?: string;
    snapshot: Phase74RetrievalSnapshot;
  }): Promise<string>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const unscoredRowBaseSchema = z.object({
  answer: z.string(),
  answerLatencyMs: z.number().nonnegative(),
  caseKey: z.string().min(1),
  clusterKey: z.string().min(1),
  contextTokens: z.number().nonnegative(),
  contextTokensBeforeTruncation: z.number().nonnegative(),
  contextTruncated: z.boolean(),
  observedAnswer: z.string(),
  productLatencyMs: z.number().nonnegative(),
  readerInputSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  recallLatencyMs: z.number().nonnegative(),
  renderedContext: z.string(),
  renderedContextSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  reused: z.boolean(),
  rowKey: z.string().min(1),
  sourceRowKey: z.string().min(1),
  sourceSnapshotId: z.string().min(1),
  unit: z.string().min(1),
});

const unscoredSnapshotSchema = z.object({
  retrievedMemories: z.array(z.unknown()),
  snapshotId: z.string().min(1),
  storedMemories: z.array(z.unknown()),
}).passthrough();

const unscoredRowSchema = z.discriminatedUnion("kind", [
  unscoredRowBaseSchema.extend({
    kind: z.literal("retrieval"),
    snapshot: unscoredSnapshotSchema,
    stage: z.enum(["E1", "E2", "E3"]),
  }).strict(),
  unscoredRowBaseSchema.extend({
    format: z.enum(["prose", "chronology", "compact_json", "json_locale_note"]),
    kind: z.literal("ledger"),
    renderedLedgerSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    stage: z.literal("E4"),
  }).strict(),
]);

const checkpointEnvelopeSchema = z.object({
  executionSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  row: unscoredRowSchema,
  rowSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  schemaVersion: z.literal(1),
}).strict();

const unscoredArtifactSchema = z.object({
  executionSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  rows: z.array(unscoredRowSchema),
  runId: z.string().min(1),
  schemaVersion: z.literal(1),
  stage: z.enum(["E1", "E2", "E3", "E4"]),
}).strict();

const FORBIDDEN_CHECKPOINT_KEYS = new Set([
  "correct",
  "evaluation",
  "expectedAnswer",
  "goldEvidenceIds",
  "judge",
  "observedCorrect",
  "observedScore",
  "protocolMetadata",
]);

function assertUnscoredValue(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertUnscoredValue);
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_CHECKPOINT_KEYS.has(key)) {
      throw new Error(`Phase 74 unscored checkpoint contains forbidden key ${key}.`);
    }
    assertUnscoredValue(nested);
  }
}

function parseUnscoredRow(value: unknown): Phase74UnscoredRow {
  assertUnscoredValue(value);
  const parsed = unscoredRowSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid Phase 74 unscored checkpoint row: ${parsed.error.issues[0]?.message ?? "invalid"}.`,
    );
  }
  return parsed.data as Phase74UnscoredRow;
}

export function parsePhase74UnscoredArtifact(
  value: unknown,
): Phase74UnscoredExecutionArtifact {
  assertUnscoredValue(value);
  const parsed = unscoredArtifactSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid Phase 74 unscored artifact: ${parsed.error.issues[0]?.message ?? "invalid"}.`,
    );
  }
  return parsed.data as Phase74UnscoredExecutionArtifact;
}

export function serializePhase74UnscoredArtifact(
  artifact: Phase74UnscoredExecutionArtifact,
): string {
  return JSON.stringify(parsePhase74UnscoredArtifact(artifact));
}

export function createPhase74UnscoredFileCheckpoint(input: {
  directory: string;
  execution: Phase74SealedExecutionBundle;
}): Phase74UnscoredCheckpoint {
  const execution = parsePhase74SealedExecutionBundle(input.execution);
  const executionSha256 = sha256Phase74SealedExecution(execution);
  const expectedRows = new Map(listPhase74SealedExpectedRows(execution).map(
    (row) => [row.rowKey, row],
  ));
  const pathFor = (rowKey: string) =>
    join(input.directory, `${sha256(rowKey)}.json`);

  const parseEnvelope = (raw: string, rowKey: string): Phase74UnscoredRow => {
    const parsed = checkpointEnvelopeSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error("Invalid Phase 74 unscored checkpoint envelope.");
    }
    const row = parseUnscoredRow(parsed.data.row);
    const expected = expectedRows.get(rowKey);
    if (
      expected === undefined ||
      parsed.data.executionSha256 !== executionSha256 ||
      parsed.data.rowSha256 !== sha256(JSON.stringify(row)) ||
      row.rowKey !== rowKey ||
      row.caseKey !== expected.caseKey ||
      row.unit !== expected.unit ||
      row.stage !== execution.stage
    ) {
      throw new Error("Phase 74 unscored checkpoint digest or identity drifted.");
    }
    return row;
  };

  return {
    async load(rowKey) {
      try {
        return parseEnvelope(await readFile(pathFor(rowKey), "utf8"), rowKey);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    async save(row) {
      const path = pathFor(row.rowKey);
      const existing = await this.load(row.rowKey);
      if (existing !== null) {
        if (sha256(JSON.stringify(existing)) !== sha256(JSON.stringify(row))) {
          throw new Error("Phase 74 unscored checkpoint row drifted.");
        }
        return;
      }
      const parsedRow = parseUnscoredRow(row);
      const raw = `${JSON.stringify({
        executionSha256,
        row: parsedRow,
        rowSha256: sha256(JSON.stringify(parsedRow)),
        schemaVersion: 1,
      })}\n`;
      await mkdir(input.directory, { recursive: true });
      const temporaryPath = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, raw, { encoding: "utf8", flag: "wx" });
        await rename(temporaryPath, path);
      } finally {
        await rm(temporaryPath, { force: true });
      }
    },
  };
}

function withoutEvaluation(
  snapshot: Phase74RetrievalSnapshot,
): Phase74UnscoredRetrievalSnapshot {
  if (snapshot.evaluation !== undefined) {
    throw new Error("Phase 74 executor received scored retrieval state.");
  }
  const { evaluation: _evaluation, ...unscored } = snapshot;
  return unscored;
}

function recallCase(
  testCase: Phase74SealedExecutionBundle["cases"][number],
): Phase74RecallCase {
  return {
    caseId: testCase.caseKey,
    ...(testCase.locale === undefined ? {} : { locale: testCase.locale }),
    ...(testCase.memoryGroupId === undefined
      ? {}
      : { memoryGroupId: testCase.memoryGroupId }),
    question: testCase.question,
    rawEvidence: testCase.rawEvidence,
    ...(testCase.referenceTime === undefined
      ? {}
      : { referenceTime: testCase.referenceTime }),
  };
}

export function sha256Phase74UnscoredArtifact(
  artifact: Phase74UnscoredExecutionArtifact,
): string {
  return sha256(serializePhase74UnscoredArtifact(artifact));
}

export async function runPhase74UnscoredExecution(
  input: RunPhase74UnscoredExecutionInput,
): Promise<{
  artifact: Phase74UnscoredExecutionArtifact;
  executorOutput: Phase74SealedExecutorOutput;
}> {
  const execution = parsePhase74SealedExecutionBundle(input.execution);
  if (execution.configurationSha256 !==
    sha256Phase74SealedConfiguration(input.baseConfiguration)) {
    throw new Error("Phase 74 sealed execution configuration digest drifted.");
  }
  const configurations = buildPhase74StageConfigurations(
    input.baseConfiguration,
    execution.stage,
  );
  const now = input.now ?? (() => performance.now());
  const expectedRows = listPhase74SealedExpectedRows(execution);
  const caseConcurrency = execution.caseConcurrency;

  const executeCase = async (
    testCase: Phase74SealedExecutionBundle["cases"][number],
  ): Promise<Phase74UnscoredRow[]> => {
    const readerResults = new Map<
      string,
      { answer: string; rowKey: string; snapshotId: string }
    >();
    const caseRows: Phase74UnscoredRow[] = [];
    for (const expected of expectedRows.filter((row) =>
      row.caseKey === testCase.caseKey
    )) {
      const cached = await input.checkpoint?.load(expected.rowKey) ?? null;
      if (cached !== null) {
        caseRows.push(cached);
        readerResults.set(`${cached.caseKey}:${cached.readerInputSha256}`, {
          answer: cached.answer,
          rowKey: cached.sourceRowKey,
          snapshotId: cached.sourceSnapshotId,
        });
        continue;
      }
      const productStartedAt = now();
      let renderedContext: string;
      let snapshot: Phase74UnscoredRetrievalSnapshot;
      if (execution.stage === "E4") {
        const loaded = await input.loadDeterministicSnapshot?.(testCase.caseKey) ??
          null;
        if (loaded === null) {
          throw new Error(
            `Phase 74 E4 lacks an unscored E3 snapshot for ${testCase.caseKey}.`,
          );
        }
        snapshot = withoutEvaluation(loaded);
        renderedContext = await input.renderEvidenceLedger({
          format: expected.unit as EvidenceLedgerFormat,
          ...(testCase.locale === undefined ? {} : { locale: testCase.locale }),
          snapshot,
        });
      } else {
        const configuration = configurations[expected.unit];
        if (configuration === undefined) {
          throw new Error(
            `Unknown Phase 74 ${execution.stage} unit ${expected.unit}.`,
          );
        }
        snapshot = withoutEvaluation(await input.executeRetrieval({
          arm: expected.unit as Phase74RetrievalExecutionInput["arm"],
          configuration,
          stage: execution.stage,
          testCase: recallCase(testCase),
        }));
        renderedContext = renderOracleMatrixContext(snapshot.retrievedMemories);
      }
      const recallCompletedAt = now();
      const budgeted = truncateRenderedContext({
        content: renderedContext,
        contextTokenBudget:
          input.contextTokenBudget ?? PHASE74_CONTEXT_TOKEN_BUDGET,
        countRenderedTokens: input.countRenderedTokens,
      });
      const readerInputSha256 = sha256(JSON.stringify({
        context: budgeted.content,
        question: testCase.question,
        stage: execution.stage,
      }));
      const answerStartedAt = now();
      const observedAnswer = await input.genericReader({
        caseId: testCase.caseKey,
        context: budgeted.content,
        purpose: execution.stage === "E4"
          ? `e4:${expected.unit}`
          : `final:${phase74ComparisonBranch(
            execution.stage,
            expected.unit as Phase74RetrievalExecutionInput["arm"],
          )}:${execution.stage}:${expected.unit}`,
        question: testCase.question,
      });
      const answerCompletedAt = now();
      const readerKey = `${testCase.caseKey}:${readerInputSha256}`;
      const source = readerResults.get(readerKey);
      const answer = source?.answer ?? observedAnswer;
      const sourceRowKey = source?.rowKey ?? expected.rowKey;
      const sourceSnapshotId = source?.snapshotId ?? snapshot.snapshotId;
      if (source === undefined) {
        readerResults.set(readerKey, {
          answer,
          rowKey: sourceRowKey,
          snapshotId: sourceSnapshotId,
        });
      }
      const common: Phase74UnscoredRowBase = {
        answer,
        answerLatencyMs: Math.max(0, answerCompletedAt - answerStartedAt),
        caseKey: testCase.caseKey,
        clusterKey: testCase.memoryGroupId ?? testCase.caseKey,
        contextTokens: budgeted.renderedContextTokens,
        contextTokensBeforeTruncation:
          budgeted.renderedContextTokensBeforeTruncation,
        contextTruncated: budgeted.contextTruncated,
        observedAnswer,
        productLatencyMs:
          snapshot.recallMetadata?.queryPathLatencyMs === undefined
            ? Math.max(0, answerCompletedAt - productStartedAt)
            : Math.max(
                0,
                snapshot.recallMetadata.queryPathLatencyMs +
                  answerCompletedAt - recallCompletedAt,
              ),
        readerInputSha256,
        recallLatencyMs: snapshot.recallMetadata?.latencyMs ??
          Math.max(0, recallCompletedAt - productStartedAt),
        renderedContext: budgeted.content,
        renderedContextSha256: sha256(budgeted.content),
        reused: source !== undefined,
        rowKey: expected.rowKey,
        sourceRowKey,
        sourceSnapshotId,
        unit: expected.unit,
      };
      const row: Phase74UnscoredRow = execution.stage === "E4"
        ? {
            ...common,
            format: expected.unit as EvidenceLedgerFormat,
            kind: "ledger",
            renderedLedgerSha256: sha256(budgeted.content),
            stage: "E4",
          }
        : {
            ...common,
            kind: "retrieval",
            snapshot,
            stage: execution.stage,
          };
      await input.checkpoint?.save(row);
      caseRows.push(row);
    }
    return caseRows;
  };

  const caseResults = new Array<Phase74UnscoredRow[]>(execution.cases.length);
  let nextCase = 0;
  const workers = Array.from(
    { length: Math.min(caseConcurrency, execution.cases.length) },
    async () => {
      while (nextCase < execution.cases.length) {
        const index = nextCase;
        nextCase += 1;
        caseResults[index] = await executeCase(execution.cases[index]!);
      }
    },
  );
  await Promise.all(workers);
  const rows = caseResults.flat();

  const artifact: Phase74UnscoredExecutionArtifact = {
    executionSha256: sha256Phase74SealedExecution(execution),
    rows,
    runId: execution.runId,
    schemaVersion: 1,
    stage: execution.stage,
  };
  return {
    artifact,
    executorOutput: buildPhase74SealedExecutorOutput({
      artifactSha256: sha256Phase74UnscoredArtifact(artifact),
      execution,
      executorPid: input.executorPid,
      rows: rows.map((row) => ({
        answer: row.answer,
        caseKey: row.caseKey,
        observedAnswer: row.observedAnswer,
        rowKey: row.rowKey,
        snapshotId: row.kind === "retrieval"
          ? row.snapshot.snapshotId
          : row.sourceSnapshotId,
        sourceRowKey: row.sourceRowKey,
      })),
    }),
  };
}
