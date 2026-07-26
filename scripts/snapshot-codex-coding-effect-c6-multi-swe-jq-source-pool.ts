import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  loadC6MultiSWEJqSourcePool,
  serializeC6MultiSWEJqSourcePoolSnapshot,
} from "./codex-coding-effect/c6-multi-swe-jq-source-pool";

const OPTION_NAMES = new Set([
  "existing-source-pool",
  "jsonl-file",
  "output",
  "readme-file",
]);

export interface C6MultiSWEJqSourcePoolCliOptions {
  existingSourcePool: string;
  jsonlFile: string;
  output: string;
  readmeFile: string;
}

export function parseC6MultiSWEJqSourcePoolCliOptions(
  args: readonly string[],
): C6MultiSWEJqSourcePoolCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(`invalid C6 Multi-SWE jq source-pool argument ${argument}`);
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(`unknown C6 Multi-SWE jq source-pool option --${name}`);
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
    existingSourcePool: required(values, "existing-source-pool"),
    jsonlFile: required(values, "jsonl-file"),
    output: required(values, "output"),
    readmeFile: required(values, "readme-file"),
  };
}

export async function runC6MultiSWEJqSourcePoolSnapshotCommand(
  args: readonly string[],
): Promise<{
  crossSourceAliases: number;
  output: string;
  outputSha256: string;
  queuedRows: number;
}> {
  const options = parseC6MultiSWEJqSourcePoolCliOptions(args);
  const snapshot = await loadC6MultiSWEJqSourcePool(options);
  const bytes = serializeC6MultiSWEJqSourcePoolSnapshot(snapshot);
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, bytes, { flag: "wx" });
  return {
    crossSourceAliases: snapshot.counts.crossSourceAliases,
    output: options.output,
    outputSha256: createHash("sha256").update(bytes).digest("hex"),
    queuedRows: snapshot.counts.queuedForReview,
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
    const result = await runC6MultiSWEJqSourcePoolSnapshotCommand(
      process.argv.slice(2),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
