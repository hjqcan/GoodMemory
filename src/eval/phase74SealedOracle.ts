import { createHash } from "node:crypto";

import { z } from "zod";

import {
  ORACLE_MATRIX_ARMS,
  type OracleMatrixCaseResult,
} from "./oracleMatrix";
import type {
  Phase74SealedEscrowBundle,
  Phase74SealedExecutionBundle,
} from "./phase74SealedExecution";

const oracleRowSchema = z.object({
  answer: z.string().nullable(),
  arm: z.enum(ORACLE_MATRIX_ARMS),
  caseId: z.string().min(1),
  caseKey: z.string().min(1),
  contextChars: z.number().int().nonnegative(),
  contextCharsBeforeTruncation: z.number().int().nonnegative(),
  contextItemIds: z.array(z.string()),
  contextTruncated: z.boolean(),
  correct: z.boolean().nullable(),
  evaluable: z.boolean(),
  executionError: z.string().optional(),
  notEvaluableReason: z.string().optional(),
  renderedContextTokens: z.number().int().nonnegative(),
  renderedContextTokensBeforeTruncation: z.number().int().nonnegative(),
}).strict();

const oracleArtifactSchema = z.object({
  e3ArtifactSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  executionSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  rows: z.array(oracleRowSchema),
  runId: z.string().min(1),
  schemaVersion: z.literal(1),
}).strict();

export type Phase74SealedOracleRow = OracleMatrixCaseResult & {
  caseId: string;
  caseKey: string;
};

export interface Phase74SealedOracleArtifact {
  e3ArtifactSha256: string;
  executionSha256: string;
  rows: Phase74SealedOracleRow[];
  runId: string;
  schemaVersion: 1;
}

export function parsePhase74SealedOracleArtifact(
  value: unknown,
): Phase74SealedOracleArtifact {
  const parsed = oracleArtifactSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid Phase 74 sealed oracle artifact: ${parsed.error.issues[0]?.message ?? "invalid"}.`,
    );
  }
  return parsed.data as Phase74SealedOracleArtifact;
}

export function verifyPhase74SealedOracleArtifact(input: {
  escrow: Phase74SealedEscrowBundle;
  execution: Phase74SealedExecutionBundle;
  expectedE3ArtifactSha256?: string;
  expectedSha256: string;
  raw: string;
}): Phase74SealedOracleArtifact {
  if (
    createHash("sha256").update(input.raw).digest("hex") !==
      input.expectedSha256
  ) {
    throw new Error("Phase 74 sealed oracle artifact digest drifted.");
  }
  const artifact = parsePhase74SealedOracleArtifact(JSON.parse(input.raw));
  if (
    input.execution.stage !== "E4" ||
    artifact.runId !== input.execution.runId ||
    artifact.executionSha256 !== input.escrow.executionSha256 ||
    (input.expectedE3ArtifactSha256 !== undefined &&
      artifact.e3ArtifactSha256 !== input.expectedE3ArtifactSha256)
  ) {
    throw new Error("Phase 74 sealed oracle artifact identity drifted.");
  }
  const escrowCases = new Map(input.escrow.cases.map((testCase) => [
    testCase.caseKey,
    testCase,
  ]));
  const expectedRows = input.execution.cases.flatMap(({ caseKey }) => {
    const escrowCase = escrowCases.get(caseKey);
    return ORACLE_MATRIX_ARMS.map((arm) => ({
      arm,
      caseId: escrowCase?.originalCaseId,
      caseKey,
    }));
  });
  if (
    artifact.rows.length !== expectedRows.length ||
    artifact.rows.some((row, index) => {
      const expected = expectedRows[index];
      return expected === undefined ||
        row.arm !== expected.arm ||
        row.caseId !== expected.caseId ||
        row.caseKey !== expected.caseKey;
    })
  ) {
    throw new Error("Phase 74 sealed oracle artifact population drifted.");
  }
  return artifact;
}
