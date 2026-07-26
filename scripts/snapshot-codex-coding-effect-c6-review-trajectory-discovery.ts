import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  C6ReviewTrajectoryDiscovery,
} from "./codex-coding-effect/c6-review-trajectory-discovery";
import {
  buildC6ReviewTrajectoryDiscovery,
  serializeC6ReviewTrajectoryDiscovery,
} from "./codex-coding-effect/c6-review-trajectory-discovery";

const OPTION_NAMES = new Set([
  "declared-source-revision",
  "expected-graphql-root-sha256",
  "expected-rest-root-sha256",
  "expected-source-root-sha256",
  "expected-targets-sha256",
  "expected-tree-receipt-sha256",
  "graphql-capture-root",
  "output",
  "rest-capture-root",
  "source-root",
  "targets",
  "tree-receipt",
]);

export interface C6ReviewTrajectoryDiscoveryCliOptions {
  declaredSourceRevision: string;
  expectedGraphqlRootSha256: string;
  expectedRestRootSha256: string;
  expectedSourceRootSha256: string;
  expectedTargetsSha256: string;
  expectedTreeReceiptSha256: string;
  graphqlCaptureRoot: string;
  output: string;
  restCaptureRoot: string;
  sourceRoot: string;
  targets: string;
  treeReceipt: string;
}

export function parseC6ReviewTrajectoryDiscoveryCliOptions(
  args: readonly string[],
): C6ReviewTrajectoryDiscoveryCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 review trajectory argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(
        `unknown C6 review trajectory option --${name}`,
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
    declaredSourceRevision: parseCommit(
      required(values, "declared-source-revision"),
    ),
    expectedGraphqlRootSha256: parseSha256(
      required(values, "expected-graphql-root-sha256"),
      "expected-graphql-root-sha256",
    ),
    expectedRestRootSha256: parseSha256(
      required(values, "expected-rest-root-sha256"),
      "expected-rest-root-sha256",
    ),
    expectedSourceRootSha256: parseSha256(
      required(values, "expected-source-root-sha256"),
      "expected-source-root-sha256",
    ),
    expectedTargetsSha256: parseSha256(
      required(values, "expected-targets-sha256"),
      "expected-targets-sha256",
    ),
    expectedTreeReceiptSha256: parseSha256(
      required(values, "expected-tree-receipt-sha256"),
      "expected-tree-receipt-sha256",
    ),
    graphqlCaptureRoot: required(values, "graphql-capture-root"),
    output: required(values, "output"),
    restCaptureRoot: required(values, "rest-capture-root"),
    sourceRoot: required(values, "source-root"),
    targets: required(values, "targets"),
    treeReceipt: required(values, "tree-receipt"),
  };
}

export async function runC6ReviewTrajectoryDiscoverySnapshotCommand(
  args: readonly string[],
): Promise<{
  boundary: C6ReviewTrajectoryDiscovery["boundary"];
  counts: C6ReviewTrajectoryDiscovery["counts"];
  output: string;
  outputSha256: string;
}> {
  const options = parseC6ReviewTrajectoryDiscoveryCliOptions(args);
  const discovery = await buildC6ReviewTrajectoryDiscovery({
    declaredSourceRevision: options.declaredSourceRevision,
    expectedGraphqlRootSha256: options.expectedGraphqlRootSha256,
    expectedRestRootSha256: options.expectedRestRootSha256,
    expectedSourceRootSha256: options.expectedSourceRootSha256,
    expectedTargetsSha256: options.expectedTargetsSha256,
    expectedTreeReceiptSha256: options.expectedTreeReceiptSha256,
    graphqlCaptureRoot: options.graphqlCaptureRoot,
    restCaptureRoot: options.restCaptureRoot,
    sourceRoot: options.sourceRoot,
    targetsPath: options.targets,
    treeReceiptPath: options.treeReceipt,
  });
  const bytes = serializeC6ReviewTrajectoryDiscovery(discovery);
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, bytes, { flag: "wx" });
  return {
    boundary: discovery.boundary,
    counts: discovery.counts,
    output: options.output,
    outputSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function parseCommit(value: string): string {
  if (!/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error(
      "--declared-source-revision must be a lowercase 40-character commit",
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
    const result = await runC6ReviewTrajectoryDiscoverySnapshotCommand(
      process.argv.slice(2),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
