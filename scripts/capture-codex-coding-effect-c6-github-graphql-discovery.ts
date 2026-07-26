import type {
  C6GitHubGraphQLDiscoveryFetch,
} from "./codex-coding-effect/c6-github-graphql-discovery";
import {
  captureC6GitHubGraphQLDiscovery,
} from "./codex-coding-effect/c6-github-graphql-discovery";

const OPTION_NAMES = new Set([
  "canonical-owner",
  "canonical-repo",
  "output-dir",
  "owner",
  "pull-number",
  "repo",
]);

export interface C6GitHubGraphQLDiscoveryCliOptions {
  canonicalOwner?: string;
  canonicalRepo?: string;
  outputDirectory: string;
  owner: string;
  pullNumber: number;
  repo: string;
}

export function parseC6GitHubGraphQLDiscoveryCliOptions(
  args: readonly string[],
): C6GitHubGraphQLDiscoveryCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `invalid C6 GitHub GraphQL discovery argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name)) {
      throw new Error(
        `unknown C6 GitHub GraphQL discovery option --${name}`,
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
  const canonicalOwner = values.get("canonical-owner");
  const canonicalRepo = values.get("canonical-repo");
  if ((canonicalOwner === undefined) !== (canonicalRepo === undefined)) {
    throw new Error(
      "--canonical-owner and --canonical-repo must be specified together",
    );
  }
  return {
    ...(canonicalOwner === undefined
      ? {}
      : { canonicalOwner, canonicalRepo }),
    outputDirectory: required(values, "output-dir"),
    owner: required(values, "owner"),
    pullNumber: parsePullNumber(required(values, "pull-number")),
    repo: required(values, "repo"),
  };
}

export async function runC6GitHubGraphQLDiscoveryCaptureCommand(
  args: readonly string[],
  dependencies: {
    env?: Readonly<Record<string, string | undefined>>;
    fetchImpl?: C6GitHubGraphQLDiscoveryFetch;
  } = {},
): Promise<{
  discoverySurfaceComplete: boolean;
  outputDirectory: string;
  paginationGapCount: number;
  responseSha256: string;
}> {
  const options = parseC6GitHubGraphQLDiscoveryCliOptions(args);
  const env = dependencies.env ?? process.env;
  const token = env.GITHUB_TOKEN;
  if (token === undefined || token.length === 0) {
    throw new Error(
      "GITHUB_TOKEN is required for C6 GitHub GraphQL discovery",
    );
  }
  const fetchImpl = dependencies.fetchImpl ??
    ((url: string, init: RequestInit) => fetch(url, init));
  const capture = await captureC6GitHubGraphQLDiscovery({
    canonicalOwner: options.canonicalOwner,
    canonicalRepo: options.canonicalRepo,
    fetchImpl,
    outputDirectory: options.outputDirectory,
    owner: options.owner,
    pullNumber: options.pullNumber,
    repo: options.repo,
    token,
  });
  return {
    discoverySurfaceComplete:
      capture.discovery.discoverySurfaceComplete,
    outputDirectory: options.outputDirectory,
    paginationGapCount: capture.discovery.paginationGaps.length,
    responseSha256: capture.response.body.sha256,
  };
}

function parsePullNumber(value: string): number {
  const pullNumber = Number(value);
  if (
    !/^[1-9]\d*$/u.test(value) ||
    !Number.isSafeInteger(pullNumber)
  ) {
    throw new Error("--pull-number must be a positive safe integer");
  }
  return pullNumber;
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
    const result = await runC6GitHubGraphQLDiscoveryCaptureCommand(
      process.argv.slice(2),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
