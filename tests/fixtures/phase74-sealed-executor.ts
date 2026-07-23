import { createHash } from "node:crypto";

import {
  buildPhase74SealedExecutorOutput,
  parsePhase74SealedExecutionBundle,
} from "../../src/eval/phase74SealedExecution";

const execution = parsePhase74SealedExecutionBundle(
  JSON.parse(await Bun.stdin.text()),
);
const observation = JSON.stringify({
  argv: process.argv,
  env: process.env,
  pid: process.pid,
});
const output = buildPhase74SealedExecutorOutput({
  execution,
  executorPid: process.pid,
  rows: execution.cases.map(({ caseKey, question }) => ({
    answer: observation,
    caseKey,
    rowKey: `${caseKey}:probe`,
    snapshotId: createHash("sha256").update(question).digest("hex"),
  })),
});
process.stdout.write(`${JSON.stringify(output)}\n`);
