import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS,
  C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_SOURCE_PATHS,
  validateC6SourceV3SimplePriorIdentityReplayReview,
} from "./codex-coding-effect/c6-source-v3-simple-prior-identity-replay-review";

const OPTION_NAMES = new Set([
  "author-task-name",
  "capture-a",
  "capture-b",
  "output-root",
  "reviewer-agent-name",
]);

export interface C6SourceV3SimplePriorIdentityReplayReviewProvenanceCliOptions {
  authorTaskName: string;
  captureA: string;
  captureB: string;
  outputRoot: string;
  reviewerAgentName: string;
}

export function parseC6SourceV3SimplePriorIdentityReplayReviewProvenanceCliOptions(
  args: readonly string[],
): C6SourceV3SimplePriorIdentityReplayReviewProvenanceCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `unknown C6 prior identity replay review provenance argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 prior identity replay review provenance option --${name}`,
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
    captureA: required(values, "capture-a"),
    captureB: required(values, "capture-b"),
    outputRoot: required(values, "output-root"),
    reviewerAgentName: required(
      values,
      "reviewer-agent-name",
    ),
  };
}

export async function recordC6SourceV3SimplePriorIdentityReplayReviewProvenance(
  input:
    C6SourceV3SimplePriorIdentityReplayReviewProvenanceCliOptions & {
      repositoryRoot: string;
    },
): Promise<{
  cryptographicReceipt: false;
  independenceVerified: false;
  localReplayReviewAccepted: true;
  outputRoot: string;
  priorRepositoryNodeIdExclusionComplete: false;
  provenanceSha256: string;
  reviewReceiptStructureVerified: true;
  sourceV3SimpleFrozen: false;
}> {
  const repositoryRoot = resolve(input.repositoryRoot);
  const outputRoot = resolve(input.outputRoot);
  const paths =
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_PATHS;
  const sources =
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_SOURCE_PATHS;
  const [
    bundleVerifierSourceBytes,
    dispatchBytes,
    inputBytes,
    planBytes,
    protocolBytes,
    replayComparatorSourceBytes,
    replayMaterializerSourceBytes,
    replayReceiptBytes,
    requestBytes,
    responseBytes,
    sourceUniverseBytes,
  ] = await Promise.all([
    readFile(join(repositoryRoot, sources.bundleVerifierSource)),
    readFile(join(outputRoot, paths.dispatch)),
    readFile(join(outputRoot, paths.input)),
    readFile(join(repositoryRoot, sources.plan)),
    readFile(join(repositoryRoot, sources.protocol)),
    readFile(join(repositoryRoot, sources.replayComparatorSource)),
    readFile(join(repositoryRoot, sources.replayMaterializerSource)),
    readFile(join(repositoryRoot, sources.replayReceipt)),
    readFile(join(outputRoot, paths.request)),
    readFile(join(outputRoot, paths.response)),
    readFile(join(repositoryRoot, sources.sourceUniverse)),
  ]);
  const provenanceBytes = canonicalJson({
    artifactKind:
      "c6-source-v3-simple-prior-identity-replay-review-provenance",
    attestationScope: "orchestrator-attestation-only",
    authorTaskName: input.authorTaskName,
    dispatch: artifactReference(
      paths.dispatch,
      dispatchBytes,
    ),
    independenceVerified: false,
    input: artifactReference(paths.input, inputBytes),
    recordedAt: readReviewedAt(responseBytes),
    request: artifactReference(paths.request, requestBytes),
    response: artifactReference(
      paths.response,
      responseBytes,
    ),
    reviewer: {
      agentName: input.reviewerAgentName,
      contextPolicy: "fork-turns-none",
      orchestratorAttestation: {
        attestedByTaskName: input.authorTaskName,
        basis:
          "orchestrator-observed-local-replay-review-dispatch-no-cryptographic-receipt",
        cryptographicReceipt: false,
      },
      requestedTaskName:
        "c6_source_v3_simple_prior_identity_replay_review_v1",
      type: "separate-ai-agent-identity-claimed",
    },
    schemaVersion: 1,
  });
  const validationInput = {
    authorTaskName: input.authorTaskName,
    bundleVerifierSource: {
      bytes: bundleVerifierSourceBytes,
      path: sources.bundleVerifierSource,
    },
    captureA: input.captureA,
    captureB: input.captureB,
    dispatchBytes,
    inputBytes,
    plan: {
      bytes: planBytes,
      path: sources.plan,
    },
    protocol: {
      bytes: protocolBytes,
      path: sources.protocol,
    },
    provenanceBytes,
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
    requestBytes,
    responseBytes,
    reviewerAgentName: input.reviewerAgentName,
    sourceUniverse: {
      bytes: sourceUniverseBytes,
      path: sources.sourceUniverse,
    },
  } as const;
  const evidence =
    validateC6SourceV3SimplePriorIdentityReplayReview(
      validationInput,
    );
  const provenancePath = join(outputRoot, paths.provenance);
  await writeFile(provenancePath, provenanceBytes, {
    encoding: "utf8",
    flag: "wx",
  });
  const publishedProvenance = await readFile(provenancePath);
  const publishedEvidence =
    validateC6SourceV3SimplePriorIdentityReplayReview({
      ...validationInput,
      provenanceBytes: publishedProvenance,
    });
  if (
    publishedEvidence.provenanceSha256 !==
      evidence.provenanceSha256
  ) {
    throw new Error(
      "C6 prior identity replay published review provenance changed",
    );
  }
  return {
    cryptographicReceipt: false,
    independenceVerified: false,
    localReplayReviewAccepted: true,
    outputRoot,
    priorRepositoryNodeIdExclusionComplete: false,
    provenanceSha256: publishedEvidence.provenanceSha256,
    reviewReceiptStructureVerified: true,
    sourceV3SimpleFrozen: false,
  };
}

function readReviewedAt(responseBytes: Uint8Array): string {
  let raw: unknown;
  try {
    raw = JSON.parse(
      Buffer.from(responseBytes).toString("utf8"),
    ) as unknown;
  } catch {
    throw new Error(
      "C6 prior identity replay review response is not JSON",
    );
  }
  if (
    raw === null ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    typeof (raw as { reviewedAt?: unknown }).reviewedAt !==
      "string"
  ) {
    throw new Error(
      "C6 prior identity replay review response has no reviewedAt",
    );
  }
  return (raw as { reviewedAt: string }).reviewedAt;
}

function artifactReference(
  path: string,
  bytes: Uint8Array,
) {
  return {
    byteLength: bytes.byteLength,
    path,
    sha256: sha256(bytes),
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

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

if (import.meta.main) {
  const options =
    parseC6SourceV3SimplePriorIdentityReplayReviewProvenanceCliOptions(
      process.argv.slice(2),
    );
  const result =
    await recordC6SourceV3SimplePriorIdentityReplayReviewProvenance({
      ...options,
      repositoryRoot: process.cwd(),
    });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
