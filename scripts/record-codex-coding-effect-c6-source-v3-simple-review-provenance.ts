import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  C6_SOURCE_V3_SIMPLE_REVIEW_PATHS,
  validateC6SourceV3SimpleReview,
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

export interface C6SourceV3SimpleReviewProvenanceCliOptions {
  authorTaskName: string;
  outputRoot: string;
  reviewerAgentName: string;
}

export function parseC6SourceV3SimpleReviewProvenanceCliOptions(
  args: readonly string[],
): C6SourceV3SimpleReviewProvenanceCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `unknown C6 source-v3-simple review provenance argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 source-v3-simple review provenance option --${name}`,
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

export async function recordC6SourceV3SimpleReviewProvenance(
  input: {
    authorTaskName: string;
    outputRoot: string;
    repositoryRoot: string;
    reviewerAgentName: string;
  },
): Promise<{
  independenceVerified: false;
  outputRoot: string;
  promotionReceiptComplete: false;
  provenanceSha256: string;
  reviewReceiptStructureVerified: true;
  sourceV3SimpleFrozen: false;
}> {
  const outputRoot = resolve(input.outputRoot);
  const repositoryRoot = resolve(input.repositoryRoot);
  const sourcePoolRoot = join(repositoryRoot, SOURCE_POOL_PATH);
  const [
    dispatchBytes,
    inputBytes,
    metadataPredicateBytes,
    protocolBytes,
    requestBytes,
    responseBytes,
    sourceV2Bytes,
    verifierSourceBytes,
  ] = await Promise.all([
    readFile(join(
      outputRoot,
      C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.dispatch,
    )),
    readFile(join(
      outputRoot,
      C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.input,
    )),
    readFile(join(sourcePoolRoot, METADATA_PREDICATE_PATH)),
    readFile(join(sourcePoolRoot, PROTOCOL_PATH)),
    readFile(join(
      outputRoot,
      C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.request,
    )),
    readFile(join(
      outputRoot,
      C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.response,
    )),
    readFile(join(sourcePoolRoot, SOURCE_V2_PATH)),
    readFile(join(repositoryRoot, VERIFIER_SOURCE_PATH)),
  ]);
  const reviewedAt = readReviewedAt(responseBytes);
  const provenanceBytes = canonicalJson({
    artifactKind:
      "c6-source-v3-simple-review-provenance",
    authorTaskName: input.authorTaskName,
    dispatch: artifactReference(
      C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.dispatch,
      dispatchBytes,
    ),
    input: artifactReference(
      C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.input,
      inputBytes,
    ),
    recordedAt: reviewedAt,
    request: artifactReference(
      C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.request,
      requestBytes,
    ),
    response: artifactReference(
      C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.response,
      responseBytes,
    ),
    reviewer: {
      agentName: input.reviewerAgentName,
      contextPolicy: "fork-turns-none",
      orchestratorAttestation: {
        attestedByTaskName: input.authorTaskName,
        basis:
          "orchestrator-observed-dispatch-no-cryptographic-receipt",
        cryptographicReceipt: false,
      },
      requestedTaskName:
        "c6_source_v3_simple_review_v1",
      type: "independent-ai-agent",
    },
    schemaVersion: 1,
  });
  const validationInput = {
    authorTaskName: input.authorTaskName,
    dispatchBytes,
    inputBytes,
    metadataPredicate: {
      bytes: metadataPredicateBytes,
      path: METADATA_PREDICATE_PATH,
    },
    protocol: {
      bytes: protocolBytes,
      path: PROTOCOL_PATH,
    },
    provenanceBytes,
    requestBytes,
    responseBytes,
    reviewerAgentName: input.reviewerAgentName,
    sourceV2: {
      bytes: sourceV2Bytes,
      path: SOURCE_V2_PATH,
    },
    verifierSource: {
      bytes: verifierSourceBytes,
      path: VERIFIER_SOURCE_PATH,
    },
  } as const;
  const evidence =
    validateC6SourceV3SimpleReview(validationInput);
  const provenancePath = join(
    outputRoot,
    C6_SOURCE_V3_SIMPLE_REVIEW_PATHS.provenance,
  );
  await writeFile(provenancePath, provenanceBytes, {
    encoding: "utf8",
    flag: "wx",
  });
  const publishedProvenance = await readFile(provenancePath);
  const publishedEvidence = validateC6SourceV3SimpleReview({
    ...validationInput,
    provenanceBytes: publishedProvenance,
  });
  if (
    publishedEvidence.provenanceSha256 !==
      evidence.provenanceSha256
  ) {
    throw new Error(
      "C6 source-v3-simple published review provenance changed",
    );
  }
  return {
    independenceVerified: false,
    outputRoot,
    promotionReceiptComplete: false,
    provenanceSha256: publishedEvidence.provenanceSha256,
    reviewReceiptStructureVerified: true,
    sourceV3SimpleFrozen: false,
  };
}

function readReviewedAt(responseBytes: Uint8Array): string {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(responseBytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(
      "C6 source-v3-simple review response is not JSON",
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
      "C6 source-v3-simple review response has no reviewedAt",
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
    parseC6SourceV3SimpleReviewProvenanceCliOptions(
      process.argv.slice(2),
    );
  const result =
    await recordC6SourceV3SimpleReviewProvenance({
      ...options,
      repositoryRoot: process.cwd(),
    });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
