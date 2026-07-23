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
const answers = new Map(
  executorOutput.rows.map(({ answer, caseKey }) => [caseKey, answer]),
);
const receipt = buildPhase74SealedScoreReceipt({
  escrow,
  executorOutput,
  rows: escrow.cases.map(({ caseKey, expectedAnswer }) => {
    const correct = answers.get(caseKey) === expectedAnswer;
    return { caseKey, correct, score: Number(correct) };
  }),
  scorerPid: process.pid,
});
process.stdout.write(`${JSON.stringify(receipt)}\n`);
