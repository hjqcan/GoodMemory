import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  buildC6SourceV3SimpleReviewBundle,
  C6_SOURCE_V3_SIMPLE_REVIEW_PATHS,
} from "./codex-coding-effect/c6-source-v3-simple-review";

const SOURCE_POOL_PATH =
  "fixtures/codex-coding-effect/c6-source-pool";
const PROTOCOL_PATH =
  "swe-bench-live-multilang-608f7ae9." +
  "source-v3-simple-protocol-v1.json";
const SOURCE_V2_PATH =
  "swe-bench-live-multilang-608f7ae9." +
  "wave3-source-universe-v2.json";
const METADATA_PREDICATE_PATH =
  "swe-bench-live-multilang-608f7ae9." +
  "wave3-pretarget-policy-v1.json";
const VERIFIER_SOURCE_PATH =
  "scripts/codex-coding-effect/c6-source-v3-simple-review.ts";
const OPTION_NAMES = new Set([
  "author-task-name",
  "output-root",
  "reviewer-agent-name",
]);

export interface C6SourceV3SimpleReviewPreparationCliOptions {
  authorTaskName: string;
  outputRoot: string;
  reviewerAgentName: string;
}

export function parseC6SourceV3SimpleReviewPreparationCliOptions(
  args: readonly string[],
): C6SourceV3SimpleReviewPreparationCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `unknown C6 source-v3-simple review preparation argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 source-v3-simple review preparation option --${name}`,
      );
    }
    if (values.has(name!)) {
      throw new Error(
        `--${name} cannot be specified more than once`,
      );
    }
    if (value!.length === 0 || value!.trim() !== value) {
      throw new Error(
        `--${name} must not be empty or padded`,
      );
    }
    values.set(name!, value!);
  }
  return {
    authorTaskName: required(values, "author-task-name"),
    outputRoot: required(values, "output-root"),
    reviewerAgentName: required(values, "reviewer-agent-name"),
  };
}

export async function prepareC6SourceV3SimpleReview(input: {
  authorTaskName: string;
  outputRoot: string;
  repositoryRoot: string;
  reviewerAgentName: string;
}): Promise<{
  dispatchSha256: string;
  formalCensusPermitted: false;
  inputSha256: string;
  outputRoot: string;
  provenanceMaterialized: false;
  requestSha256: string;
  responseMaterialized: false;
  reviewRoot: string;
  sourceV3SimpleFrozen: false;
}> {
  const repositoryRoot = resolve(input.repositoryRoot);
  const outputRoot = resolve(input.outputRoot);
  const sourcePoolRoot = join(repositoryRoot, SOURCE_POOL_PATH);
  const [
    metadataPredicateBytes,
    protocolBytes,
    sourceV2Bytes,
    verifierSourceBytes,
  ] = await Promise.all([
    readFile(join(sourcePoolRoot, METADATA_PREDICATE_PATH)),
    readFile(join(sourcePoolRoot, PROTOCOL_PATH)),
    readFile(join(sourcePoolRoot, SOURCE_V2_PATH)),
    readFile(join(repositoryRoot, VERIFIER_SOURCE_PATH)),
  ]);
  const bundle = buildC6SourceV3SimpleReviewBundle({
    authorTaskName: input.authorTaskName,
    metadataPredicate: {
      bytes: metadataPredicateBytes,
      path: METADATA_PREDICATE_PATH,
    },
    protocol: {
      bytes: protocolBytes,
      path: PROTOCOL_PATH,
    },
    reviewerAgentName: input.reviewerAgentName,
    sourceV2: {
      bytes: sourceV2Bytes,
      path: SOURCE_V2_PATH,
    },
    verifierSource: {
      bytes: verifierSourceBytes,
      path: VERIFIER_SOURCE_PATH,
    },
  });
  const reviewRoot = dirname(
    join(outputRoot, C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.input),
  );
  await mkdir(dirname(reviewRoot), { recursive: true });
  try {
    await mkdir(reviewRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `C6 source-v3-simple review root already exists: ${reviewRoot}`,
      );
    }
    throw error;
  }
  await Promise.all([
    writeFile(
      join(outputRoot, C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.dispatch),
      bundle.dispatchBytes,
      { encoding: "utf8", flag: "wx" },
    ),
    writeFile(
      join(outputRoot, C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.input),
      bundle.inputBytes,
      { encoding: "utf8", flag: "wx" },
    ),
    writeFile(
      join(outputRoot, C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.request),
      bundle.requestBytes,
      { encoding: "utf8", flag: "wx" },
    ),
  ]);
  return {
    dispatchSha256: sha256(bundle.dispatchBytes),
    formalCensusPermitted: false,
    inputSha256: sha256(bundle.inputBytes),
    outputRoot,
    provenanceMaterialized: false,
    requestSha256: sha256(bundle.requestBytes),
    responseMaterialized: false,
    reviewRoot,
    sourceV3SimpleFrozen: false,
  };
}

function required(
  values: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

if (import.meta.main) {
  const options =
    parseC6SourceV3SimpleReviewPreparationCliOptions(
      process.argv.slice(2),
    );
  const result = await prepareC6SourceV3SimpleReview({
    ...options,
    repositoryRoot: process.cwd(),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
