import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import {
  buildPhase74SealedScoreReceipt,
  parsePhase74SealedEscrowBundle,
  parsePhase74SealedExecutionBundle,
  parsePhase74SealedExecutorOutput,
} from "../../src/eval/phase74SealedExecution";

const raw = JSON.parse(await Bun.stdin.text()) as {
  escrow?: unknown;
  execution?: unknown;
  executorOutput?: unknown;
};
const escrow = parsePhase74SealedEscrowBundle(raw.escrow);
const execution = parsePhase74SealedExecutionBundle(raw.execution);
const executorOutput = parsePhase74SealedExecutorOutput(raw.executorOutput);
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
    rows: [],
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
