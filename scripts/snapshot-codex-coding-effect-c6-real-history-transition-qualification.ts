import type {
  C6RealHistoryTransitionQualification,
} from "./codex-coding-effect/c6-real-history-transition-qualification";
import {
  materializeC6RealHistoryTransitionQualification,
} from "./codex-coding-effect/c6-real-history-transition-qualification";

const OPTION_NAMES = new Set([
  "audit-order",
  "output",
  "trajectory",
]);

export interface C6RealHistoryTransitionQualificationCliOptions {
  auditOrder: string;
  output: string;
  trajectory: string;
}

export function parseC6RealHistoryTransitionQualificationCliOptions(
  args: readonly string[],
): C6RealHistoryTransitionQualificationCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 transition qualification argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(
        `unknown C6 transition qualification option --${name}`,
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
    auditOrder: required(values, "audit-order"),
    output: required(values, "output"),
    trajectory: required(values, "trajectory"),
  };
}

export async function runC6RealHistoryTransitionQualificationSnapshotCommand(
  args: readonly string[],
): Promise<{
  boundary: C6RealHistoryTransitionQualification["boundary"];
  counts: C6RealHistoryTransitionQualification["counts"];
  output: string;
  outputSha256: string;
}> {
  const options = parseC6RealHistoryTransitionQualificationCliOptions(args);
  const result = await materializeC6RealHistoryTransitionQualification({
    auditOrderPath: options.auditOrder,
    outputPath: options.output,
    trajectoryPath: options.trajectory,
  });
  return {
    boundary: result.projection.boundary,
    counts: result.projection.counts,
    output: options.output,
    outputSha256: result.projectionSha256,
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

if (import.meta.main) {
  try {
    const result =
      await runC6RealHistoryTransitionQualificationSnapshotCommand(
        process.argv.slice(2),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
