import { createHash } from "node:crypto";

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

export interface RunPhase74UnscoredExecutionInput {
  baseConfiguration: EvalRunJsonObject;
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
  return sha256(JSON.stringify(artifact));
}

export async function runPhase74UnscoredExecution(
  input: RunPhase74UnscoredExecutionInput,
): Promise<{
  artifact: Phase74UnscoredExecutionArtifact;
  executorOutput: Phase74SealedExecutorOutput;
}> {
  const execution = parsePhase74SealedExecutionBundle(input.execution);
  const configurations = buildPhase74StageConfigurations(
    input.baseConfiguration,
    execution.stage,
  );
  const cases = new Map(execution.cases.map((testCase) => [
    testCase.caseKey,
    testCase,
  ]));
  const readerResults = new Map<
    string,
    { answer: string; rowKey: string; snapshotId: string }
  >();
  const rows: Phase74UnscoredRow[] = [];
  const now = input.now ?? (() => performance.now());

  for (const expected of listPhase74SealedExpectedRows(execution)) {
    const testCase = cases.get(expected.caseKey);
    if (testCase === undefined) {
      throw new Error(`Unknown Phase 74 sealed case ${expected.caseKey}.`);
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
        throw new Error(`Unknown Phase 74 ${execution.stage} unit ${expected.unit}.`);
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
    rows.push(execution.stage === "E4"
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
        });
  }

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
