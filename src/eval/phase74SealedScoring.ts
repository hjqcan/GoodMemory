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
  Phase74SealedEscrowBundle,
  Phase74SealedExecutionBundle,
  Phase74SealedExecutorOutput,
  Phase74SealedScoreReceipt,
} from "./phase74SealedExecution";
import {
  parsePhase74UnscoredArtifact,
  sha256Phase74UnscoredArtifact,
} from "./phase74UnscoredExecution";
import type {
  Phase74UnscoredExecutionArtifact,
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

export async function scorePhase74UnscoredExecution(input: {
  artifact: Phase74UnscoredExecutionArtifact;
  assess(input: Phase74SealedAssessmentInput): Promise<Phase74SealedAssessment>;
  escrow: Phase74SealedEscrowBundle;
  execution: Phase74SealedExecutionBundle;
  executorOutput: Phase74SealedExecutorOutput;
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
  for (const output of executorOutput.rows) {
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
  }

  const receipt = buildPhase74SealedScoreReceipt({
    escrow,
    executorOutput,
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
