import {
  loadC6CandidateReadiness,
} from "./codex-coding-effect/c6-readiness";
import type {
  C6CandidateReadinessInput,
  C6CandidateReadinessResult,
} from "./codex-coding-effect/c6-readiness";

const SCALAR_OPTIONS = new Set([
  "c5-evidence-root",
  "dataset-root",
  "environment-manifest",
  "gate-policy",
  "package-tarball",
  "repository-design-sha256",
  "repository-lineage-sha256",
  "repository-power-input-sha256",
  "repository-review-sha256",
  "summary-protocol",
]);

export function parseC6CandidatePreparationOptions(
  args: readonly string[],
): C6CandidateReadinessInput {
  const values = new Map<string, string>();
  const seeds: number[] = [];
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(`invalid C6 candidate argument ${argument}`);
    }
    const [, name, value] = match;
    if (name === "seed") {
      seeds.push(parseSeed(value));
      continue;
    }
    if (!SCALAR_OPTIONS.has(name)) {
      throw new Error(`unknown C6 candidate option --${name}`);
    }
    if (values.has(name)) {
      throw new Error(`duplicate C6 candidate option --${name}`);
    }
    if (value.length === 0 || value.trim() !== value) {
      throw new Error(`C6 candidate option --${name} must not be empty`);
    }
    values.set(name, value);
  }
  if (seeds.length !== 3 || new Set(seeds).size !== 3) {
    throw new Error("C6 candidate requires exactly three distinct --seed values");
  }
  const packageTarballPath = required(values, "package-tarball");
  if (!packageTarballPath.endsWith(".tgz")) {
    throw new Error("C6 candidate --package-tarball must end with .tgz");
  }
  const repositoryDesignPins = [
    values.get("repository-design-sha256"),
    values.get("repository-power-input-sha256"),
    values.get("repository-lineage-sha256"),
    values.get("repository-review-sha256"),
  ];
  if (
    repositoryDesignPins.some((value) => value !== undefined) &&
    repositoryDesignPins.some((value) => value === undefined)
  ) {
    throw new Error(
      "C6 candidate requires all four repository-design SHA-256 pins",
    );
  }
  if (
    repositoryDesignPins.some((value) =>
      value !== undefined && !/^[a-f0-9]{64}$/u.test(value)
    )
  ) {
    throw new Error(
      "C6 candidate repository-design pins must be lowercase SHA-256",
    );
  }
  return {
    c5EvidenceRoot: required(values, "c5-evidence-root"),
    datasetRoot: required(values, "dataset-root"),
    environmentManifestPath: required(values, "environment-manifest"),
    gatePolicyPath: required(values, "gate-policy"),
    packageTarballPath,
    ...(repositoryDesignPins[0] === undefined
      ? {}
      : {
        repositoryDesignEvidence: {
          expectedDesignPowerArtifactSha256:
            repositoryDesignPins[0],
          expectedPowerInputArtifactSha256:
            repositoryDesignPins[1]!,
          expectedRepositoryLineageArtifactSha256:
            repositoryDesignPins[2]!,
          expectedReviewReceiptSha256:
            repositoryDesignPins[3]!,
        },
      }),
    seeds,
    summaryProtocolPath: required(values, "summary-protocol"),
  };
}

export function runC6CandidatePreparationCommand(
  args: readonly string[],
): Promise<C6CandidateReadinessResult>;
export function runC6CandidatePreparationCommand<Result>(
  args: readonly string[],
  load: (
    input: C6CandidateReadinessInput,
  ) => Promise<Result>,
): Promise<Result>;
export function runC6CandidatePreparationCommand<Result>(
  args: readonly string[],
  load?: (
    input: C6CandidateReadinessInput,
  ) => Promise<Result>,
): Promise<C6CandidateReadinessResult | Result> {
  const input = parseC6CandidatePreparationOptions(args);
  return load === undefined ? loadC6CandidateReadiness(input) : load(input);
}

function parseSeed(value: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error("C6 candidate --seed must be a canonical positive integer");
  }
  const seed = Number(value);
  if (!Number.isSafeInteger(seed)) {
    throw new Error("C6 candidate --seed must be a canonical positive integer");
  }
  return seed;
}

function required(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`C6 candidate requires --${name}`);
  }
  return value;
}

if (import.meta.main) {
  try {
    const result = await runC6CandidatePreparationCommand(
      process.argv.slice(2),
    );
    process.stdout.write(result.planBytes);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
