import { createHash } from "node:crypto";

import {
  buildPhase74SealedExecutorOutput,
  listPhase74SealedExpectedRows,
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
  artifactSha256: createHash("sha256").update(observation).digest("hex"),
  execution,
  executorPid: process.pid,
  rows: listPhase74SealedExpectedRows(execution).map(
    ({ caseKey, rowKey, unit }) => ({
      answer: observation,
      caseKey,
      observedAnswer: observation,
      rowKey,
      snapshotId: createHash("sha256")
        .update(`${execution.cases.find((entry) => entry.caseKey === caseKey)!.question}:${unit}`)
        .digest("hex"),
      sourceRowKey: rowKey,
    }),
  ),
});
process.stdout.write(`${JSON.stringify(output)}\n`);
