import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  C6RealHistoryYieldCensus,
} from "./codex-coding-effect/c6-real-history-yield";
import {
  buildC6RealHistoryYieldCensus,
  serializeC6RealHistoryYieldCensus,
} from "./codex-coding-effect/c6-real-history-yield";

const OPTION_NAMES = new Set([
  "capture-root",
  "expected-tree-receipt-sha256",
  "maximum-source-file-bytes",
  "minimum-required-episodes",
  "output",
  "source-root",
  "tree-receipt",
]);

export interface C6RealHistoryYieldSnapshotCliOptions {
  captureRoot: string;
  expectedTreeReceiptSha256: string;
  maximumSourceFileBytes: number;
  minimumRequiredEpisodes: number;
  output: string;
  sourceRoot: string;
  treeReceipt: string;
}

export function parseC6RealHistoryYieldSnapshotCliOptions(
  args: readonly string[],
): C6RealHistoryYieldSnapshotCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(`invalid C6 real-history yield argument ${argument}`);
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(`unknown C6 real-history yield option --${name}`);
    }
    if (values.has(name)) {
      throw new Error(`--${name} cannot be specified more than once`);
    }
    if (value.length === 0 || value.trim() !== value) {
      throw new Error(`--${name} must not be empty or padded`);
    }
    values.set(name, value);
  }

  const sourceRoot = required(values, "source-root");
  const treeReceipt = required(values, "tree-receipt");
  const captureRoot = required(values, "capture-root");
  const expectedTreeReceiptSha256 = parseSha256(
    required(values, "expected-tree-receipt-sha256"),
  );
  const maximumSourceFileBytes = parseMaximumSourceFileBytes(
    required(values, "maximum-source-file-bytes"),
  );
  const minimumRequiredEpisodes = parseMinimum(
    required(values, "minimum-required-episodes"),
  );
  const output = required(values, "output");
  return {
    captureRoot,
    expectedTreeReceiptSha256,
    maximumSourceFileBytes,
    minimumRequiredEpisodes,
    output,
    sourceRoot,
    treeReceipt,
  };
}

export async function runC6RealHistoryYieldSnapshotCommand(
  args: readonly string[],
): Promise<{
  boundary: C6RealHistoryYieldCensus["boundary"];
  counts: C6RealHistoryYieldCensus["counts"];
  output: string;
  outputSha256: string;
}> {
  const options = parseC6RealHistoryYieldSnapshotCliOptions(args);
  const census = await buildC6RealHistoryYieldCensus({
    captureRoot: options.captureRoot,
    expectedTreeReceiptSha256: options.expectedTreeReceiptSha256,
    maximumSourceFileBytes: options.maximumSourceFileBytes,
    minimumRequiredEpisodes: options.minimumRequiredEpisodes,
    sourceRoot: options.sourceRoot,
    treeReceiptPath: options.treeReceipt,
  });
  const bytes = serializeC6RealHistoryYieldCensus(census);
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, bytes, { flag: "wx" });
  return {
    boundary: census.boundary,
    counts: census.counts,
    output: options.output,
    outputSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function required(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`--${name} is required exactly once`);
  }
  return value;
}

function parseMinimum(value: string): number {
  const minimum = Number(value);
  if (
    !/^[1-9]\d*$/u.test(value) ||
    !Number.isSafeInteger(minimum)
  ) {
    throw new Error(
      "--minimum-required-episodes must be a positive safe integer",
    );
  }
  return minimum;
}

function parseMaximumSourceFileBytes(value: string): number {
  const maximum = Number(value);
  if (
    !/^[1-9]\d*$/u.test(value) ||
    !Number.isSafeInteger(maximum)
  ) {
    throw new Error(
      "--maximum-source-file-bytes must be a positive safe integer",
    );
  }
  return maximum;
}

function parseSha256(value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(
      "--expected-tree-receipt-sha256 must be a lowercase SHA-256",
    );
  }
  return value;
}

if (import.meta.main) {
  try {
    const result = await runC6RealHistoryYieldSnapshotCommand(
      process.argv.slice(2),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
