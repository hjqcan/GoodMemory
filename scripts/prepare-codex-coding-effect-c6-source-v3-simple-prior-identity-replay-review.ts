import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  buildC6SourceV3SimplePriorIdentityReplayReviewBundle,
  C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS,
  C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_SOURCE_PATHS,
} from "./codex-coding-effect/c6-source-v3-simple-prior-identity-replay-review";

const OPTION_NAMES = new Set([
  "author-task-name",
  "capture-a",
  "capture-b",
  "output-root",
  "reviewer-agent-name",
]);

export interface C6SourceV3SimplePriorIdentityReplayReviewPreparationCliOptions {
  authorTaskName: string;
  captureA: string;
  captureB: string;
  outputRoot: string;
  reviewerAgentName: string;
}

export function parseC6SourceV3SimplePriorIdentityReplayReviewPreparationCliOptions(
  args: readonly string[],
): C6SourceV3SimplePriorIdentityReplayReviewPreparationCliOptions {
  const values = parseOptions(args, "preparation");
  return {
    authorTaskName: required(values, "author-task-name"),
    captureA: required(values, "capture-a"),
    captureB: required(values, "capture-b"),
    outputRoot: required(values, "output-root"),
    reviewerAgentName: required(
      values,
      "reviewer-agent-name",
    ),
  };
}

export async function prepareC6SourceV3SimplePriorIdentityReplayReview(
  input:
    C6SourceV3SimplePriorIdentityReplayReviewPreparationCliOptions & {
      repositoryRoot: string;
    },
): Promise<{
  dispatchSha256: string;
  formalCensusPermitted: false;
  inputSha256: string;
  localReplayReviewAccepted: false;
  outputRoot: string;
  priorRepositoryNodeIdExclusionComplete: false;
  provenanceMaterialized: false;
  requestSha256: string;
  responseMaterialized: false;
  reviewRoot: string;
  sourceV3SimpleFrozen: false;
}> {
  const repositoryRoot = resolve(input.repositoryRoot);
  const outputRoot = resolve(input.outputRoot);
  const sources =
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_SOURCE_PATHS;
  const [
    bundleVerifierSourceBytes,
    planBytes,
    protocolBytes,
    replayComparatorSourceBytes,
    replayMaterializerSourceBytes,
    replayReceiptBytes,
    sourceUniverseBytes,
  ] = await Promise.all([
    readFile(join(repositoryRoot, sources.bundleVerifierSource)),
    readFile(join(repositoryRoot, sources.plan)),
    readFile(join(repositoryRoot, sources.protocol)),
    readFile(join(repositoryRoot, sources.replayComparatorSource)),
    readFile(join(repositoryRoot, sources.replayMaterializerSource)),
    readFile(join(repositoryRoot, sources.replayReceipt)),
    readFile(join(repositoryRoot, sources.sourceUniverse)),
  ]);
  const bundle =
    buildC6SourceV3SimplePriorIdentityReplayReviewBundle({
      authorTaskName: input.authorTaskName,
      bundleVerifierSource: {
        bytes: bundleVerifierSourceBytes,
        path: sources.bundleVerifierSource,
      },
      captureA: input.captureA,
      captureB: input.captureB,
      plan: {
        bytes: planBytes,
        path: sources.plan,
      },
      protocol: {
        bytes: protocolBytes,
        path: sources.protocol,
      },
      replayComparatorSource: {
        bytes: replayComparatorSourceBytes,
        path: sources.replayComparatorSource,
      },
      replayMaterializerSource: {
        bytes: replayMaterializerSourceBytes,
        path: sources.replayMaterializerSource,
      },
      replayReceipt: {
        bytes: replayReceiptBytes,
        path: sources.replayReceipt,
      },
      reviewerAgentName: input.reviewerAgentName,
      sourceUniverse: {
        bytes: sourceUniverseBytes,
        path: sources.sourceUniverse,
      },
    });
  const reviewRoot = dirname(join(
    outputRoot,
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.input,
  ));
  await mkdir(dirname(reviewRoot), { recursive: true });
  try {
    await mkdir(reviewRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `C6 prior identity replay review root already exists: ${reviewRoot}`,
      );
    }
    throw error;
  }
  await Promise.all([
    writeFile(
      join(
        outputRoot,
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.dispatch,
      ),
      bundle.dispatchBytes,
      { encoding: "utf8", flag: "wx" },
    ),
    writeFile(
      join(
        outputRoot,
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.input,
      ),
      bundle.inputBytes,
      { encoding: "utf8", flag: "wx" },
    ),
    writeFile(
      join(
        outputRoot,
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.request,
      ),
      bundle.requestBytes,
      { encoding: "utf8", flag: "wx" },
    ),
  ]);
  const [dispatchBytes, inputBytes, requestBytes] =
    await Promise.all([
      readFile(join(
        outputRoot,
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.dispatch,
      )),
      readFile(join(
        outputRoot,
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.input,
      )),
      readFile(join(
        outputRoot,
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS.request,
      )),
    ]);
  if (
    dispatchBytes.toString("utf8") !== bundle.dispatchBytes ||
    inputBytes.toString("utf8") !== bundle.inputBytes ||
    requestBytes.toString("utf8") !== bundle.requestBytes
  ) {
    throw new Error(
      "C6 prior identity replay published review packet changed",
    );
  }
  return {
    dispatchSha256: sha256(dispatchBytes),
    formalCensusPermitted: false,
    inputSha256: sha256(inputBytes),
    localReplayReviewAccepted: false,
    outputRoot,
    priorRepositoryNodeIdExclusionComplete: false,
    provenanceMaterialized: false,
    requestSha256: sha256(requestBytes),
    responseMaterialized: false,
    reviewRoot,
    sourceV3SimpleFrozen: false,
  };
}

function parseOptions(
  args: readonly string[],
  operation: string,
): Map<string, string> {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `unknown C6 prior identity replay review ${operation} argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 prior identity replay review ${operation} option --${name}`,
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
  return values;
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
    parseC6SourceV3SimplePriorIdentityReplayReviewPreparationCliOptions(
      process.argv.slice(2),
    );
  const result =
    await prepareC6SourceV3SimplePriorIdentityReplayReview({
      ...options,
      repositoryRoot: process.cwd(),
    });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
