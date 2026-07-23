import { createHash } from "node:crypto";

import { selectEvidenceLedgerFormat } from "./evidenceLedgerFormats";
import type { EvidenceLedgerFormat } from "./evidenceLedgerFormats";
import {
  measureOracleMatrixCoverage,
  runOracleMatrixCase,
} from "./oracleMatrix";
import type {
  OracleMatrixJudge,
  OracleMatrixProtocolReader,
  OracleMatrixReader,
  RenderedTokenCounter,
} from "./oracleMatrix";
import { PHASE74_EXPERIMENT_ARMS } from "./phase74ExperimentDesign";
import {
  buildPhase74StageConfigurations,
} from "./phase74Generalization";
import type {
  Phase74E4CaseResult,
  Phase74E4FormatResult,
  Phase74GeneralizationExecutionResult,
  Phase74GeneralizationReport,
} from "./phase74Generalization";
import {
  buildPhase74SealedScoreReceipt,
  listPhase74SealedExpectedRows,
  parsePhase74SealedEscrowBundle,
  parsePhase74SealedExecutionBundle,
  parsePhase74SealedExecutorOutput,
  sha256Phase74SealedExecution,
  verifyPhase74SealedScoreReceipt,
} from "./phase74SealedExecution";
import type {
  Phase74SealedOracleArtifact,
  Phase74SealedOracleRow,
} from "./phase74SealedOracle";
import {
  verifyPhase74SealedOracleArtifact,
} from "./phase74SealedOracle";
import type {
  Phase74SealedEscrowBundle,
  Phase74SealedExecutionBundle,
  Phase74SealedExecutorOutput,
  Phase74SealedScoreReceipt,
} from "./phase74SealedExecution";
import {
  parsePhase74UnscoredArtifact,
  sha256Phase74UnscoredArtifact,
} from "./phase74UnscoredExecution";
import {
  hashEvalExperimentIdentity,
  hashEvalRunIdentity,
} from "./runIdentity";
import type { EvalRunIdentity } from "./runIdentity";
import type {
  Phase74UnscoredExecutionArtifact,
  Phase74UnscoredRetrievalRow,
  Phase74UnscoredRow,
} from "./phase74UnscoredExecution";

export interface Phase74SealedAssessment {
  correct: boolean;
  score: number;
}

export interface Phase74SealedAssessmentInput {
  answer: string;
  expectedAnswer: string;
  family?: "locomo" | "longmemeval";
  goldEvidenceIds: readonly string[];
  opaqueCaseKey: string;
  originalCaseId: string;
  protocolMetadata?: Readonly<Record<string, unknown>>;
  purpose: string;
  question: string;
  unresolvedGoldEvidenceIds: readonly string[];
}

export type Phase74SealedScoredRow = Phase74UnscoredRow & {
  correct: boolean;
  observedCorrect: boolean;
  observedScore: number;
  score: number;
};

function sameOrderedCaseKeys(
  left: readonly { caseKey: string }[],
  right: readonly { caseKey: string }[],
): boolean {
  return left.length === right.length && left.every(
    ({ caseKey }, index) => caseKey === right[index]?.caseKey,
  );
}

function validateAssessment(
  assessment: Phase74SealedAssessment,
  rowKey: string,
): void {
  if (
    typeof assessment.correct !== "boolean" ||
    !Number.isFinite(assessment.score) ||
    assessment.score < 0 ||
    assessment.score > 1
  ) {
    throw new Error(`Invalid Phase 74 sealed assessment for ${rowKey}.`);
  }
}

function assertArtifactProjection(input: {
  artifact: Phase74UnscoredExecutionArtifact;
  execution: Phase74SealedExecutionBundle;
  executorOutput: Phase74SealedExecutorOutput;
}): void {
  const expectedRows = listPhase74SealedExpectedRows(input.execution);
  if (
    input.artifact.executionSha256 !==
      sha256Phase74SealedExecution(input.execution) ||
    input.artifact.runId !== input.execution.runId ||
    input.artifact.stage !== input.execution.stage ||
    input.executorOutput.artifactSha256 !==
      sha256Phase74UnscoredArtifact(input.artifact) ||
    input.artifact.rows.length !== expectedRows.length ||
    input.executorOutput.rows.length !== expectedRows.length
  ) {
    throw new Error("Phase 74 unscored artifact digest or identity drifted.");
  }
  for (const [index, expected] of expectedRows.entries()) {
    const row = input.artifact.rows[index];
    const output = input.executorOutput.rows[index];
    if (
      row === undefined ||
      output === undefined ||
      row.caseKey !== expected.caseKey ||
      row.rowKey !== expected.rowKey ||
      row.unit !== expected.unit ||
      output.caseKey !== row.caseKey ||
      output.rowKey !== row.rowKey ||
      output.answer !== row.answer ||
      output.observedAnswer !== row.observedAnswer ||
      output.sourceRowKey !== row.sourceRowKey ||
      output.snapshotId !== (row.kind === "retrieval"
        ? row.snapshot.snapshotId
        : row.sourceSnapshotId)
    ) {
      throw new Error("Phase 74 unscored artifact projection drifted.");
    }
  }
}

export async function runPhase74SealedOracleMatrix(input: {
  countRenderedTokens: RenderedTokenCounter;
  e3Artifact: Phase74UnscoredExecutionArtifact;
  escrow: Phase74SealedEscrowBundle;
  execution: Phase74SealedExecutionBundle;
  genericReader: OracleMatrixReader;
  judge: OracleMatrixJudge;
  protocolReader: OracleMatrixProtocolReader;
}): Promise<{
  artifact: Phase74SealedOracleArtifact;
  sha256: string;
}> {
  const execution = parsePhase74SealedExecutionBundle(input.execution);
  const escrow = parsePhase74SealedEscrowBundle(input.escrow);
  const e3Artifact = parsePhase74UnscoredArtifact(input.e3Artifact);
  if (
    execution.stage !== "E4" ||
    e3Artifact.stage !== "E3" ||
    execution.runId !== e3Artifact.runId ||
    escrow.runId !== execution.runId ||
    escrow.executionSha256 !== sha256Phase74SealedExecution(execution) ||
    !sameOrderedCaseKeys(execution.cases, escrow.cases)
  ) {
    throw new Error("Phase 74 sealed oracle boundary drifted.");
  }

  const deterministicSnapshots = new Map(
    e3Artifact.rows
      .filter((row): row is Phase74UnscoredRetrievalRow =>
        row.kind === "retrieval" &&
        row.unit === "recall-plan-deterministic"
      )
      .map((row) => [row.caseKey, row.snapshot] as const),
  );
  if (
    deterministicSnapshots.size !== execution.cases.length ||
    execution.cases.some(({ caseKey }) => !deterministicSnapshots.has(caseKey))
  ) {
    throw new Error(
      "Phase 74 sealed oracle requires one deterministic E3 snapshot per case.",
    );
  }

  const escrowCases = new Map(escrow.cases.map((testCase) => [
    testCase.caseKey,
    testCase,
  ]));
  const rowsByCase = new Map<string, Phase74SealedOracleRow[]>();
  let nextCase = 0;
  await Promise.all(Array.from(
    {
      length: Math.min(execution.caseConcurrency, execution.cases.length),
    },
    async () => {
      while (nextCase < execution.cases.length) {
        const caseIndex = nextCase;
        nextCase += 1;
        const executionCase = execution.cases[caseIndex]!;
        const escrowCase = escrowCases.get(executionCase.caseKey)!;
        const snapshot = deterministicSnapshots.get(executionCase.caseKey)!;
        const rows = await runOracleMatrixCase({
            countRenderedTokens: input.countRenderedTokens,
            genericReader: input.genericReader,
            judge: input.judge,
            protocolReader: input.protocolReader,
            testCase: {
              caseId: escrowCase.originalCaseId,
              expectedAnswer: escrowCase.expectedAnswer,
              goldEvidenceIds: escrowCase.goldEvidenceIds,
              ...(escrowCase.protocolMetadata === undefined
                ? {}
                : { protocolMetadata: escrowCase.protocolMetadata }),
              question: executionCase.question,
              rawEvidence: executionCase.rawEvidence,
              retrievedMemories: snapshot.retrievedMemories,
              storedMemories: snapshot.storedMemories,
              unresolvedGoldEvidenceIds: escrowCase.unresolvedGoldEvidenceIds,
            },
          });
        rowsByCase.set(
          executionCase.caseKey,
          rows.map((row) => ({
            ...row,
            caseId: escrowCase.originalCaseId,
            caseKey: executionCase.caseKey,
          })),
        );
      }
    },
  ));

  const artifact: Phase74SealedOracleArtifact = {
    e3ArtifactSha256: sha256Phase74UnscoredArtifact(e3Artifact),
    executionSha256: sha256Phase74SealedExecution(execution),
    rows: execution.cases.flatMap(({ caseKey }) => rowsByCase.get(caseKey)!),
    runId: execution.runId,
    schemaVersion: 1,
  };
  return {
    artifact,
    sha256: createHash("sha256")
      .update(JSON.stringify(artifact))
      .digest("hex"),
  };
}

export async function scorePhase74UnscoredExecution(input: {
  artifact: Phase74UnscoredExecutionArtifact;
  assess(input: Phase74SealedAssessmentInput): Promise<Phase74SealedAssessment>;
  escrow: Phase74SealedEscrowBundle;
  execution: Phase74SealedExecutionBundle;
  executorOutput: Phase74SealedExecutorOutput;
  oracleSha256?: string;
  scorerPid: number;
}): Promise<{
  receipt: Phase74SealedScoreReceipt;
  rows: Phase74SealedScoredRow[];
}> {
  const execution = parsePhase74SealedExecutionBundle(input.execution);
  const escrow = parsePhase74SealedEscrowBundle(input.escrow);
  const executorOutput = parsePhase74SealedExecutorOutput(input.executorOutput);
  const artifact = parsePhase74UnscoredArtifact(input.artifact);
  if (
    escrow.runId !== execution.runId ||
    escrow.executionSha256 !== sha256Phase74SealedExecution(execution) ||
    !sameOrderedCaseKeys(execution.cases, escrow.cases)
  ) {
    throw new Error("Phase 74 sealed scoring boundary drifted.");
  }
  assertArtifactProjection({ artifact, execution, executorOutput });

  const executionCases = new Map(execution.cases.map((testCase) => [
    testCase.caseKey,
    testCase,
  ]));
  const escrowCases = new Map(escrow.cases.map((testCase) => [
    testCase.caseKey,
    testCase,
  ]));
  const observed = new Map<string, Phase74SealedAssessment>();
  const assessOutput = async (output: Phase74SealedExecutorOutput["rows"][number]) => {
    const executionCase = executionCases.get(output.caseKey);
    const escrowCase = escrowCases.get(output.caseKey);
    if (executionCase === undefined || escrowCase === undefined) {
      throw new Error(`Unknown Phase 74 sealed scoring case ${output.caseKey}.`);
    }
    const assessment = await input.assess({
      answer: output.observedAnswer ?? "",
      expectedAnswer: escrowCase.expectedAnswer,
      ...(escrowCase.family === undefined ? {} : { family: escrowCase.family }),
      goldEvidenceIds: escrowCase.goldEvidenceIds,
      opaqueCaseKey: output.caseKey,
      originalCaseId: escrowCase.originalCaseId,
      ...(escrowCase.protocolMetadata === undefined
        ? {}
        : { protocolMetadata: escrowCase.protocolMetadata }),
      purpose: `sealed:${execution.stage}:${output.rowKey}`,
      question: executionCase.question,
      unresolvedGoldEvidenceIds: escrowCase.unresolvedGoldEvidenceIds,
    });
    validateAssessment(assessment, output.rowKey);
    observed.set(output.rowKey, assessment);
  };
  let nextRow = 0;
  await Promise.all(Array.from(
    {
      length: Math.min(
        execution.caseConcurrency,
        executorOutput.rows.length,
      ),
    },
    async () => {
      while (nextRow < executorOutput.rows.length) {
        const index = nextRow;
        nextRow += 1;
        await assessOutput(executorOutput.rows[index]!);
      }
    },
  ));

  const receipt = buildPhase74SealedScoreReceipt({
    escrow,
    executorOutput,
    ...(input.oracleSha256 === undefined
      ? {}
      : { oracleSha256: input.oracleSha256 }),
    rows: executorOutput.rows.map((output) => {
      const observedAssessment = observed.get(output.rowKey)!;
      const finalAssessment = observed.get(output.sourceRowKey);
      if (finalAssessment === undefined) {
        throw new Error(
          `Phase 74 sealed answer source ${output.sourceRowKey} is missing.`,
        );
      }
      return {
        caseKey: output.caseKey,
        correct: finalAssessment.correct,
        observedCorrect: observedAssessment.correct,
        observedScore: observedAssessment.score,
        rowKey: output.rowKey,
        score: finalAssessment.score,
      };
    }),
    scorerPid: input.scorerPid,
  });
  verifyPhase74SealedScoreReceipt({
    escrow,
    execution,
    executorOutput,
    receipt,
  });
  return {
    receipt,
    rows: artifact.rows.map((row, index) => ({
      ...row,
      correct: receipt.rows[index]!.correct,
      observedCorrect: receipt.rows[index]!.observedCorrect,
      observedScore: receipt.rows[index]!.observedScore,
      score: receipt.rows[index]!.score,
    })),
  };
}

export function materializePhase74SealedReport(input: {
  artifact: Phase74UnscoredExecutionArtifact;
  e4ProtectionDeltas?: Partial<Record<EvidenceLedgerFormat, number>>;
  escrow: Phase74SealedEscrowBundle;
  execution: Phase74SealedExecutionBundle;
  executorOutput: Phase74SealedExecutorOutput;
  identity: EvalRunIdentity;
  oracleArtifact?: string;
  receipt: Phase74SealedScoreReceipt;
}): Phase74GeneralizationReport {
  const execution = parsePhase74SealedExecutionBundle(input.execution);
  const escrow = parsePhase74SealedEscrowBundle(input.escrow);
  const executorOutput = parsePhase74SealedExecutorOutput(input.executorOutput);
  const artifact = parsePhase74UnscoredArtifact(input.artifact);
  verifyPhase74SealedScoreReceipt({
    escrow,
    execution,
    executorOutput,
    receipt: input.receipt,
  });
  assertArtifactProjection({ artifact, execution, executorOutput });
  const oracleArtifact = input.oracleArtifact === undefined
    ? undefined
    : verifyPhase74SealedOracleArtifact({
        escrow,
        execution,
        expectedSha256: input.receipt.oracleSha256 ?? "",
        raw: input.oracleArtifact,
      });
  if ((execution.stage === "E4") !== (oracleArtifact !== undefined)) {
    throw new Error("Phase 74 sealed report oracle artifact is missing.");
  }
  const receiptByRowKey = new Map(input.receipt.rows.map((row) => [
    row.rowKey,
    row,
  ]));
  const artifactByRowKey = new Map(artifact.rows.map((row) => [row.rowKey, row]));
  const executionCases = new Map(execution.cases.map((testCase) => [
    testCase.caseKey,
    testCase,
  ]));
  const escrowCases = new Map(escrow.cases.map((testCase) => [
    testCase.caseKey,
    testCase,
  ]));
  const configurations = buildPhase74StageConfigurations(
    input.identity.configuration,
    execution.stage,
  );

  const executions: Phase74GeneralizationExecutionResult[] = [];
  const e4Cases: Phase74E4CaseResult[] = [];
  for (const row of artifact.rows) {
    const score = receiptByRowKey.get(row.rowKey);
    const executionCase = executionCases.get(row.caseKey);
    const escrowCase = escrowCases.get(row.caseKey);
    if (score === undefined || executionCase === undefined || escrowCase === undefined) {
      throw new Error(`Phase 74 materialization case ${row.caseKey} is missing.`);
    }
    const clusterId = escrowCase.originalMemoryGroupId ??
      escrowCase.originalCaseId;
    if (row.kind === "ledger") {
      e4Cases.push({
        answer: row.answer,
        caseId: escrowCase.originalCaseId,
        clusterId,
        contextTokens: row.contextTokens,
        contextTokensBeforeTruncation: row.contextTokensBeforeTruncation,
        contextTruncated: row.contextTruncated,
        correct: score.correct,
        format: row.format,
        renderedLedgerSha256: row.renderedLedgerSha256,
        score: score.score,
        sourceSnapshotId: row.sourceSnapshotId,
      });
      continue;
    }
    const source = artifactByRowKey.get(row.sourceRowKey);
    if (source === undefined || source.kind !== "retrieval") {
      throw new Error(`Phase 74 materialization source ${row.sourceRowKey} is missing.`);
    }
    const configuration = configurations[row.unit];
    if (configuration === undefined) {
      throw new Error(`Phase 74 materialization unit ${row.unit} is unknown.`);
    }
    executions.push({
      answer: row.answer,
      answerLatencyMs: row.answerLatencyMs,
      arm: row.unit as Phase74GeneralizationExecutionResult["arm"],
      caseId: escrowCase.originalCaseId,
      clusterId,
      configuration,
      contextTokens: row.contextTokens,
      contextTokensBeforeTruncation: row.contextTokensBeforeTruncation,
      contextTruncated: row.contextTruncated,
      correct: score.correct,
      evaluationAttribution: {
        inputSha256: row.readerInputSha256,
        observedAnswer: row.observedAnswer,
        observedCorrect: score.observedCorrect,
        observedScore: score.observedScore,
        reused: row.reused,
        sourceArm: source.unit,
        sourceSnapshotId: row.sourceSnapshotId,
      },
      metrics: measureOracleMatrixCoverage({
        caseId: row.caseKey,
        expectedAnswer: escrowCase.expectedAnswer,
        goldEvidenceIds: escrowCase.goldEvidenceIds,
        ...(escrowCase.protocolMetadata === undefined
          ? {}
          : { protocolMetadata: escrowCase.protocolMetadata }),
        question: executionCase.question,
        rawEvidence: executionCase.rawEvidence,
        retrievedMemories: row.snapshot.retrievedMemories,
        storedMemories: row.snapshot.storedMemories,
        unresolvedGoldEvidenceIds: escrowCase.unresolvedGoldEvidenceIds,
      }),
      productLatencyMs: row.productLatencyMs,
      recallLatencyMs: row.recallLatencyMs,
      score: score.score,
      snapshotId: row.snapshot.snapshotId,
      stage: row.stage,
    });
  }

  const formatResults: Phase74E4FormatResult[] = PHASE74_EXPERIMENT_ARMS.E4.map(
    (format) => {
      const cases = e4Cases.filter((result) => result.format === format);
      return {
        averageTokens: cases.length === 0
          ? null
          : cases.reduce((total, result) => total + result.contextTokens, 0) /
            cases.length,
        format,
        macroScore: cases.length === 0
          ? 0
          : cases.reduce((total, result) => total + result.score, 0) /
            cases.length,
        protectionDelta: input.e4ProtectionDeltas?.[format] ?? null,
      };
    },
  );
  const completeProtection = execution.cases.length > 0 &&
    formatResults.every((result) =>
      result.averageTokens !== null &&
      result.protectionDelta !== null &&
      Number.isFinite(result.protectionDelta)
    );
  const eligible = formatResults.some((result) =>
    result.protectionDelta !== null && result.protectionDelta >= -0.01
  );
  const selectedFormat = completeProtection && eligible
    ? selectEvidenceLedgerFormat(formatResults.map((result) => ({
        averageTokens: result.averageTokens!,
        format: result.format,
        macroScore: result.macroScore,
        protectionDelta: result.protectionDelta!,
      })))
    : "not_evaluable";
  const oracle = [...(oracleArtifact?.rows ?? [])];
  const renderedContextMaxTokens = Math.max(
    0,
    ...artifact.rows.map((row) => row.contextTokens),
    ...oracle.map((result) => result.renderedContextTokens),
  );
  return {
    e4: { cases: e4Cases, formatResults, selectedFormat },
    executions,
    experimentIdentityHash: hashEvalExperimentIdentity(input.identity),
    identity: input.identity,
    identityHash: hashEvalRunIdentity(input.identity),
    oracle,
    reason: "Sealed stage evidence remains non-promotional until the cross-benchmark gate passes.",
    schemaVersion: 1,
    status: "not_evaluable",
    summary: {
      caseCount: execution.cases.length,
      executionFailures: oracle.filter((result) =>
        result.executionError !== undefined
      ).length,
      renderedContextMaxTokens,
    },
  };
}
