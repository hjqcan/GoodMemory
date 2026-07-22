import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  verifyC3RunnerSourceReproducibility,
} from "./codex-coding-effect/c3-source-reproducibility";

const evidenceDirectory = parseEvidenceDirectory(process.argv.slice(2));
const result = await verifyC3RunnerSourceReproducibility({ evidenceDirectory });
if (result.replayedVerificationBytes !== null) {
  await writeFile(
    join(evidenceDirectory, "replayed-c3-verification.json"),
    result.replayedVerificationBytes,
    { encoding: "utf8", flag: "wx" },
  );
}
await writeFile(
  join(evidenceDirectory, "verification.json"),
  `${JSON.stringify(result.verification, null, 2)}\n`,
  { encoding: "utf8", flag: "wx" },
);
process.stdout.write(`${JSON.stringify(result.verification, null, 2)}\n`);
if (result.verification.decision !== "accepted") {
  process.exitCode = 1;
}

function parseEvidenceDirectory(args: readonly string[]): string {
  if (
    args.length !== 2 ||
    args[0] !== "--evidence-directory" ||
    args[1] === undefined ||
    args[1].startsWith("--")
  ) {
    throw new Error("usage: --evidence-directory <path>");
  }
  return resolve(args[1]);
}
