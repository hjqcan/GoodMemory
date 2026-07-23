import {
  buildPhase74SealedScoreReceipt,
  parsePhase74SealedEscrowBundle,
  parsePhase74SealedExecutorOutput,
} from "../../src/eval/phase74SealedExecution";

const raw = JSON.parse(await Bun.stdin.text()) as {
  escrow?: unknown;
  executorOutput?: unknown;
};
const escrow = parsePhase74SealedEscrowBundle(raw.escrow);
const executorOutput = parsePhase74SealedExecutorOutput(raw.executorOutput);
const escrowCases = new Map(
  escrow.cases.map((testCase) => [testCase.caseKey, testCase]),
);
const receipt = buildPhase74SealedScoreReceipt({
  escrow,
  executorOutput,
  rows: executorOutput.rows.map(({ answer, caseKey, rowKey }) => {
    const expectedAnswer = escrowCases.get(caseKey)?.expectedAnswer;
    const correct = expectedAnswer !== undefined && answer === expectedAnswer;
    return { caseKey, correct, rowKey, score: Number(correct) };
  }),
  scorerPid: process.pid,
});
process.stdout.write(`${JSON.stringify(receipt)}\n`);
