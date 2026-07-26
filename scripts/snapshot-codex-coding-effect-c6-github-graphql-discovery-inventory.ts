import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  C6GitHubGraphQLDiscoveryInventory,
} from "./codex-coding-effect/c6-github-graphql-discovery-inventory";
import {
  buildC6GitHubGraphQLDiscoveryInventory,
  serializeC6GitHubGraphQLDiscoveryInventory,
} from "./codex-coding-effect/c6-github-graphql-discovery-inventory";

const OPTION_NAMES = new Set([
  "capture-root",
  "expected-source-revision",
  "expected-source-root-sha256",
  "expected-tree-receipt-sha256",
  "output",
  "rest-supplement-root",
  "source-root",
  "tree-receipt",
]);

export interface C6GitHubGraphQLDiscoveryInventoryCliOptions {
  captureRoot: string;
  expectedSourceRevision: string;
  expectedSourceRootSha256: string;
  expectedTreeReceiptSha256: string;
  output: string;
  restSupplementRoot?: string;
  sourceRoot: string;
  treeReceipt: string;
}

export function parseC6GitHubGraphQLDiscoveryInventoryCliOptions(
  args: readonly string[],
): C6GitHubGraphQLDiscoveryInventoryCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 GraphQL discovery inventory argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(
        `unknown C6 GraphQL discovery inventory option --${name}`,
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
  const restSupplementRoot = values.get("rest-supplement-root");
  return {
    captureRoot: required(values, "capture-root"),
    expectedSourceRevision: parseCommit(
      required(values, "expected-source-revision"),
    ),
    expectedSourceRootSha256: parseSha256(
      required(values, "expected-source-root-sha256"),
      "expected-source-root-sha256",
    ),
    expectedTreeReceiptSha256: parseSha256(
      required(values, "expected-tree-receipt-sha256"),
      "expected-tree-receipt-sha256",
    ),
    output: required(values, "output"),
    ...(restSupplementRoot === undefined ? {} : { restSupplementRoot }),
    sourceRoot: required(values, "source-root"),
    treeReceipt: required(values, "tree-receipt"),
  };
}

export async function runC6GitHubGraphQLDiscoveryInventorySnapshotCommand(
  args: readonly string[],
): Promise<{
  boundary: C6GitHubGraphQLDiscoveryInventory["boundary"];
  counts: C6GitHubGraphQLDiscoveryInventory["counts"];
  output: string;
  outputSha256: string;
}> {
  const options = parseC6GitHubGraphQLDiscoveryInventoryCliOptions(args);
  const inventory = await buildC6GitHubGraphQLDiscoveryInventory({
    captureRoot: options.captureRoot,
    expectedSourceRevision: options.expectedSourceRevision,
    expectedSourceRootSha256: options.expectedSourceRootSha256,
    expectedTreeReceiptSha256: options.expectedTreeReceiptSha256,
    ...(options.restSupplementRoot === undefined
      ? {}
      : { restSupplementRoot: options.restSupplementRoot }),
    sourceRoot: options.sourceRoot,
    treeReceiptPath: options.treeReceipt,
  });
  const bytes = serializeC6GitHubGraphQLDiscoveryInventory(inventory);
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, bytes, { flag: "wx" });
  return {
    boundary: inventory.boundary,
    counts: inventory.counts,
    output: options.output,
    outputSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function parseCommit(value: string): string {
  if (!/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error(
      "--expected-source-revision must be a lowercase 40-character commit",
    );
  }
  return value;
}

function parseSha256(value: string, name: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`--${name} must be a lowercase SHA-256`);
  }
  return value;
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
      await runC6GitHubGraphQLDiscoveryInventorySnapshotCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
