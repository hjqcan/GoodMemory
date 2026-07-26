import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  loadC6MultiSWERelationshipDiscovery,
  serializeC6MultiSWERelationshipDiscovery,
} from "./codex-coding-effect/c6-multi-swe-relationship-discovery";

const OPTION_NAMES = new Set([
  "compare-2896-to-3189",
  "compare-3075-to-2896",
  "existing-source-pool",
  "issue-1746",
  "issue-3073",
  "issue-3188",
  "output",
  "pull-2896",
  "pull-3075",
  "pull-3189",
  "readme-file",
  "source-root",
  "tree-receipt",
]);

export interface C6MultiSWERelationshipDiscoveryCliOptions {
  compare2896To3189: string;
  compare3075To2896: string;
  existingSourcePool: string;
  issue1746: string;
  issue3073: string;
  issue3188: string;
  output: string;
  pull2896: string;
  pull3075: string;
  pull3189: string;
  readmeFile: string;
  sourceRoot: string;
  treeReceipt: string;
}

export function parseC6MultiSWERelationshipDiscoveryCliOptions(
  args: readonly string[],
): C6MultiSWERelationshipDiscoveryCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 Multi-SWE relationship-discovery argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(
        `unknown C6 Multi-SWE relationship-discovery option --${name}`,
      );
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
    compare2896To3189: required(values, "compare-2896-to-3189"),
    compare3075To2896: required(values, "compare-3075-to-2896"),
    existingSourcePool: required(values, "existing-source-pool"),
    issue1746: required(values, "issue-1746"),
    issue3073: required(values, "issue-3073"),
    issue3188: required(values, "issue-3188"),
    output: required(values, "output"),
    pull2896: required(values, "pull-2896"),
    pull3075: required(values, "pull-3075"),
    pull3189: required(values, "pull-3189"),
    readmeFile: required(values, "readme-file"),
    sourceRoot: required(values, "source-root"),
    treeReceipt: required(values, "tree-receipt"),
  };
}

export async function runC6MultiSWERelationshipDiscoverySnapshotCommand(
  args: readonly string[],
): Promise<{
  candidateTriples: number;
  observedRows: number;
  output: string;
  outputSha256: string;
  sourceFiles: number;
}> {
  const options = parseC6MultiSWERelationshipDiscoveryCliOptions(args);
  const snapshot = await loadC6MultiSWERelationshipDiscovery(options);
  const bytes = serializeC6MultiSWERelationshipDiscovery(snapshot);
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, bytes, { flag: "wx" });
  return {
    candidateTriples: snapshot.counts.candidateTriples,
    observedRows: snapshot.counts.observedRows,
    output: options.output,
    outputSha256: createHash("sha256").update(bytes).digest("hex"),
    sourceFiles: snapshot.counts.sourceFiles,
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
    const result =
      await runC6MultiSWERelationshipDiscoverySnapshotCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
