import {
  captureC6GitHubRestToDirectory,
} from "./codex-coding-effect/c6-github-rest-capture";
import type {
  C6GitHubRestCaptureInput,
} from "./codex-coding-effect/c6-github-rest-capture";

const OPTION_NAMES = new Set([
  "output-dir",
  "owner",
  "pull",
  "repo",
  "resolved-issues",
]);

export interface C6GitHubRestCaptureCliOptions {
  outputDirectory: string;
  owner: string;
  pullNumber: number;
  repository: string;
  resolvedIssueNumbers: number[];
}

interface CaptureResult {
  manifestPath: string;
  manifestSha256: string;
  requestCount: number;
}

export function parseC6GitHubRestCaptureCliOptions(
  args: readonly string[],
): C6GitHubRestCaptureCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(`invalid C6 GitHub REST capture argument ${argument}`);
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(`unknown C6 GitHub REST capture option --${name}`);
    }
    if (values.has(name)) {
      throw new Error(`--${name} cannot be specified more than once`);
    }
    if (value.length === 0 || value.trim() !== value) {
      throw new Error(`--${name} must not be empty or padded`);
    }
    values.set(name, value);
  }
  const owner = required(values, "owner");
  const repository = required(values, "repo");
  const pullNumber = parsePositiveInteger(required(values, "pull"), "pull");
  const resolvedIssueNumbers = required(values, "resolved-issues")
    .split(",")
    .map((value) => parsePositiveInteger(value, "resolved issue"));
  if (new Set(resolvedIssueNumbers).size !== resolvedIssueNumbers.length) {
    throw new Error("resolved issue numbers must be unique");
  }
  if (resolvedIssueNumbers.includes(pullNumber)) {
    throw new Error("resolved issue number must differ from the pull number");
  }
  return {
    outputDirectory: required(values, "output-dir"),
    owner,
    pullNumber,
    repository,
    resolvedIssueNumbers: resolvedIssueNumbers.sort(
      (left, right) => left - right,
    ),
  };
}

export async function runC6GitHubRestCaptureCli(
  args: readonly string[],
  dependencies: {
    capture?: (
      input: C6GitHubRestCaptureInput,
    ) => Promise<CaptureResult>;
    env?: Readonly<Record<string, string | undefined>>;
  } = {},
): Promise<CaptureResult> {
  const options = parseC6GitHubRestCaptureCliOptions(args);
  const token = (dependencies.env ?? process.env).GITHUB_TOKEN;
  if (token === undefined || token.length === 0) {
    throw new Error("GITHUB_TOKEN is required for C6 GitHub REST capture");
  }
  return await (dependencies.capture ?? captureC6GitHubRestToDirectory)({
    authorizationToken: token,
    ...options,
  });
}

function required(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`--${name} is required exactly once`);
  }
  return value;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return parsed;
}

if (import.meta.main) {
  try {
    const result = await runC6GitHubRestCaptureCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
