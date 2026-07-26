import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  loadC6SWEbenchMultilingualSourcePool,
  serializeC6SourcePoolSnapshot,
} from "./codex-coding-effect/c6-source-pool";

const OPTION_NAMES = new Set([
  "output",
  "parquet-file",
  "readme-file",
]);

export interface C6SourcePoolSnapshotCliOptions {
  output: string;
  parquetFile: string;
  readmeFile: string;
}

export function parseC6SourcePoolSnapshotCliOptions(
  args: readonly string[],
): C6SourcePoolSnapshotCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(`invalid C6 source-pool argument ${argument}`);
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(`unknown C6 source-pool option --${name}`);
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
    output: required(values, "output"),
    parquetFile: required(values, "parquet-file"),
    readmeFile: required(values, "readme-file"),
  };
}

export async function runC6SourcePoolSnapshotCommand(
  args: readonly string[],
): Promise<{
  output: string;
  outputSha256: string;
  queuedRows: number;
  rejectedRows: number;
}> {
  const options = parseC6SourcePoolSnapshotCliOptions(args);
  const snapshot = await loadC6SWEbenchMultilingualSourcePool({
    parquetFile: options.parquetFile,
    readmeFile: options.readmeFile,
  });
  const bytes = serializeC6SourcePoolSnapshot(snapshot);
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, bytes, { flag: "wx" });
  return {
    output: options.output,
    outputSha256: createHash("sha256").update(bytes).digest("hex"),
    queuedRows: snapshot.counts.queuedForOriginAndRelationshipReview,
    rejectedRows: snapshot.counts.rejectedBeforeOriginReview,
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
    const result = await runC6SourcePoolSnapshotCommand(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
