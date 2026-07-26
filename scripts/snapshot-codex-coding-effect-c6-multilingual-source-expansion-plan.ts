import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./codex-coding-effect/c6-asset-lock";
import {
  projectC6MultilingualSourceExpansionPlan,
  serializeC6MultilingualSourceExpansionPlan,
} from "./codex-coding-effect/c6-multilingual-source-expansion-plan";

const OPTION_NAMES = new Set([
  "expected-source-pool-sha256",
  "output",
  "source-pool",
]);

export interface C6MultilingualSourceExpansionPlanCliOptions {
  expectedSourcePoolSha256: string;
  output: string;
  sourcePool: string;
}

export function parseC6MultilingualSourceExpansionPlanCliOptions(
  args: readonly string[],
): C6MultilingualSourceExpansionPlanCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(`invalid C6 multilingual plan argument ${argument}`);
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(`unknown C6 multilingual plan option --${name}`);
    }
    if (values.has(name)) {
      throw new Error(`--${name} cannot be specified more than once`);
    }
    if (value.length === 0 || value.trim() !== value) {
      throw new Error(`--${name} must not be empty or padded`);
    }
    values.set(name, value);
  }
  const expectedSourcePoolSha256 = required(
    values,
    "expected-source-pool-sha256",
  );
  if (!/^[a-f0-9]{64}$/u.test(expectedSourcePoolSha256)) {
    throw new Error(
      "--expected-source-pool-sha256 must be a lowercase SHA-256",
    );
  }
  return {
    expectedSourcePoolSha256,
    output: required(values, "output"),
    sourcePool: required(values, "source-pool"),
  };
}

export async function runC6MultilingualSourceExpansionPlanSnapshotCommand(
  args: readonly string[],
): Promise<{
  counts: {
    repositoryCount: number;
    sourceRowCount: number;
    targetCount: number;
  };
  output: string;
  outputSha256: string;
}> {
  const options = parseC6MultilingualSourceExpansionPlanCliOptions(args);
  const sourcePoolPath = await assertC6NoSymlinkPathComponents(
    options.sourcePool,
    "C6 multilingual source-expansion source pool",
  );
  const sourcePoolBytes = await readC6StableRegularFile(
    sourcePoolPath,
    "C6 multilingual source-expansion source pool",
  );
  if (sha256(sourcePoolBytes) !== options.expectedSourcePoolSha256) {
    throw new Error("C6 multilingual source-pool hash mismatch");
  }
  const plan = projectC6MultilingualSourceExpansionPlan({
    sourcePoolBytes,
    sourcePoolPath,
  });
  const bytes = serializeC6MultilingualSourceExpansionPlan(plan);
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes, { flag: "wx" });
  return {
    counts: plan.counts,
    output,
    outputSha256: sha256(bytes),
  };
}

function required(
  values: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`--${name} is required exactly once`);
  }
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

if (import.meta.main) {
  try {
    const result =
      await runC6MultilingualSourceExpansionPlanSnapshotCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
