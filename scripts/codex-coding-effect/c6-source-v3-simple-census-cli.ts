import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH,
  C6_SOURCE_V3_SIMPLE_CENSUS_RUNNING_REPOSITORY_ROOT,
} from "./c6-source-v3-simple-census-activation";
import {
  runC6SourceV3SimpleFormalCensus,
} from "./c6-source-v3-simple-census-runner";

const execFileAsync = promisify(execFile);

export async function runC6SourceV3SimpleCensusCli(
  values: readonly string[] =
    process.argv.slice(2),
): Promise<void> {
  const args = parseArgs(values);
  const repositoryRoot =
    C6_SOURCE_V3_SIMPLE_CENSUS_RUNNING_REPOSITORY_ROOT;
  const assetRootInput = args.get("--asset-root");
  if (assetRootInput === undefined) {
    throw new Error("--asset-root is required");
  }
  if (!args.has("--execute-live-census")) {
    throw new Error(
      "--execute-live-census is required",
    );
  }
  const receiptPath = resolve(
    repositoryRoot,
    args.get("--activation-receipt") ??
      C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH,
  );
  const terminal =
    await runC6SourceV3SimpleFormalCensus({
      activationReceiptBytes:
        await readFile(receiptPath),
      assetRoot: resolve(assetRootInput),
      authorizationTokenProvider:
        loadGithubToken,
      liveNetworkConfirmation:
        "execute-goodmemory-c6-source-v3-simple-formal-census",
      repositoryRoot,
    });
  process.stdout.write(`${JSON.stringify({
    terminal,
  }, null, 2)}\n`);
}

function parseArgs(
  values: readonly string[],
): Map<string, string> {
  const args = new Map<string, string>();
  for (
    let index = 0;
    index < values.length;
    index += 1
  ) {
    const name = values[index]!;
    if (name === "--execute-live-census") {
      args.set(name, "true");
      continue;
    }
    if (
      ![
        "--activation-receipt",
        "--asset-root",
      ].includes(name)
    ) {
      throw new Error(`unknown argument ${name}`);
    }
    const value = values[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    args.set(name, value);
    index += 1;
  }
  return args;
}

async function loadGithubToken(): Promise<Buffer> {
  const environmentToken =
    process.env.GOODMEMORY_C6_GITHUB_TOKEN;
  delete process.env.GOODMEMORY_C6_GITHUB_TOKEN;
  if (environmentToken !== undefined) {
    return tokenBytes(environmentToken);
  }
  const { stdout } = await execFileAsync(
    "gh",
    ["auth", "token"],
    {
      encoding: "buffer",
      maxBuffer: 64 * 1_024,
    },
  );
  return tokenBytes(
    Buffer.from(stdout).toString("utf8").trim(),
  );
}

function tokenBytes(value: string): Buffer {
  if (
    value.length === 0 ||
    /[\u0000-\u0020\u007f]/u.test(value)
  ) {
    throw new Error(
      "GitHub authorization token is invalid",
    );
  }
  return Buffer.from(value);
}
