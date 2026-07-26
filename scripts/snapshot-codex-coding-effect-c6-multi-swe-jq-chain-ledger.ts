import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  buildC6MultiSWEJqChainDecisionLedger,
  loadC6MultiSWEJqAncestryObservations,
  loadC6MultiSWEJqProjectLicenseCapture,
  serializeC6MultiSWEJqChainDecisionLedger,
} from "./codex-coding-effect/c6-multi-swe-jq-chain-ledger";
import {
  loadC6MultiSWEJqSourcePool,
} from "./codex-coding-effect/c6-multi-swe-jq-source-pool";

const OPTION_NAMES = new Set([
  "compare-2824-to-2839",
  "compare-2839-to-2840",
  "existing-source-pool",
  "jsonl-file",
  "output",
  "project-license",
  "pull-2824",
  "pull-2839",
  "pull-2840",
  "readme-file",
]);

export interface C6MultiSWEJqChainLedgerCliOptions {
  compare2824To2839: string;
  compare2839To2840: string;
  existingSourcePool: string;
  jsonlFile: string;
  output: string;
  projectLicense: string;
  pull2824: string;
  pull2839: string;
  pull2840: string;
  readmeFile: string;
}

export function parseC6MultiSWEJqChainLedgerCliOptions(
  args: readonly string[],
): C6MultiSWEJqChainLedgerCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(`invalid C6 Multi-SWE jq chain-ledger argument ${argument}`);
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(`unknown C6 Multi-SWE jq chain-ledger option --${name}`);
    }
    if (values.has(name)) {
      throw new Error(`--${name} cannot be specified more than once`);
    }
    if (value.length === 0 || value.trim() !== value) {
      throw new Error(`--${name} must not be empty or padded`);
    }
    values.set(name, value);
  }
  return {
    compare2824To2839: required(values, "compare-2824-to-2839"),
    compare2839To2840: required(values, "compare-2839-to-2840"),
    existingSourcePool: required(values, "existing-source-pool"),
    jsonlFile: required(values, "jsonl-file"),
    output: required(values, "output"),
    projectLicense: required(values, "project-license"),
    pull2824: required(values, "pull-2824"),
    pull2839: required(values, "pull-2839"),
    pull2840: required(values, "pull-2840"),
    readmeFile: required(values, "readme-file"),
  };
}

export async function runC6MultiSWEJqChainLedgerSnapshotCommand(
  args: readonly string[],
): Promise<{
  ancestryObservedPairs: number;
  chainUniverse: number;
  output: string;
  outputSha256: string;
  pairUniverse: number;
}> {
  const options = parseC6MultiSWEJqChainLedgerCliOptions(args);
  const sourcePool = await loadC6MultiSWEJqSourcePool(options);
  const ancestryObservations =
    await loadC6MultiSWEJqAncestryObservations(options, sourcePool);
  const projectLicenseCapture =
    await loadC6MultiSWEJqProjectLicenseCapture(options.projectLicense);
  const ledger = buildC6MultiSWEJqChainDecisionLedger(
    sourcePool,
    ancestryObservations,
    projectLicenseCapture,
  );
  const bytes = serializeC6MultiSWEJqChainDecisionLedger(ledger);
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, bytes, { flag: "wx" });
  return {
    ancestryObservedPairs: ledger.counts.ancestryObservedPairs,
    chainUniverse: ledger.counts.chainUniverse,
    output: options.output,
    outputSha256: createHash("sha256").update(bytes).digest("hex"),
    pairUniverse: ledger.counts.pairUniverse,
  };
}

function required(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`--${name} is required exactly once`);
  }
  return value;
}

if (import.meta.main) {
  try {
    const result = await runC6MultiSWEJqChainLedgerSnapshotCommand(
      process.argv.slice(2),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
