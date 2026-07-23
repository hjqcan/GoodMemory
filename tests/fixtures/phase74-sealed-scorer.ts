import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import {
  buildPhase74SealedScoreReceipt,
  parsePhase74SealedEscrowBundle,
  parsePhase74SealedExecutionBundle,
  parsePhase74SealedExecutorOutput,
} from "../../src/eval/phase74SealedExecution";
import { ORACLE_MATRIX_ARMS } from "../../src/eval/oracleMatrix";

const raw = JSON.parse(await Bun.stdin.text()) as {
  escrow?: unknown;
  execution?: unknown;
  executorOutput?: unknown;
};
const escrow = parsePhase74SealedEscrowBundle(raw.escrow);
const execution = parsePhase74SealedExecutionBundle(raw.execution);
const executorOutput = parsePhase74SealedExecutorOutput(raw.executorOutput);
if (process.env.PHASE74_SEALED_SCORER_FAIL === "1") {
  throw new Error("deliberate sealed scorer failure");
}
const escrowCases = new Map(
  escrow.cases.map((testCase) => [testCase.caseKey, testCase]),
);
let oracleSha256: string | undefined;
if (execution.stage === "E4") {
  const artifactPath = process.env.PHASE74_SEALED_ORACLE_ARTIFACT_PATH;
  if (artifactPath === undefined) {
    throw new Error("PHASE74_SEALED_ORACLE_ARTIFACT_PATH is required for E4.");
  }
  const artifact = JSON.stringify({
    e3ArtifactSha256: "0".repeat(64),
    executionSha256: escrow.executionSha256,
    rows: execution.cases.flatMap(({ caseKey }) => {
      const caseId = escrowCases.get(caseKey)!.originalCaseId;
      return ORACLE_MATRIX_ARMS.map((arm) => ({
        answer: null,
        arm,
        caseId,
        caseKey,
        contextChars: 0,
        contextCharsBeforeTruncation: 0,
        contextItemIds: [],
        contextTruncated: false,
        correct: false,
        evaluable: true,
        renderedContextTokens: 0,
        renderedContextTokensBeforeTruncation: 0,
      }));
    }),
    runId: execution.runId,
    schemaVersion: 1,
  });
  await writeFile(artifactPath, artifact, { encoding: "utf8", flag: "wx" });
  oracleSha256 = createHash("sha256").update(artifact).digest("hex");
}
const receipt = buildPhase74SealedScoreReceipt({
  escrow,
  executorOutput,
  ...(oracleSha256 === undefined ? {} : { oracleSha256 }),
  rows: executorOutput.rows.map(({ caseKey, observedAnswer, rowKey }) => {
    const expectedAnswer = escrowCases.get(caseKey)?.expectedAnswer;
    const observedCorrect = expectedAnswer !== undefined &&
      observedAnswer === expectedAnswer;
    return {
      caseKey,
      correct: observedCorrect,
      observedCorrect,
      observedScore: Number(observedCorrect),
      rowKey,
      score: Number(observedCorrect),
    };
  }),
  scorerPid: process.pid,
});
process.stdout.write(`${JSON.stringify(receipt)}\n`);
