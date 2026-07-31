import { createHash } from "node:crypto";
import {
  realpath,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  readC6StableRegularFile,
} from "./codex-coding-effect/c6-asset-lock";
import {
  runC6PinnedGit,
} from "./codex-coding-effect/c6-git-runtime";
import {
  C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY,
  C6_SOURCE_V4_BOUNDED_REVIEW_PATHS,
  C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS,
  validateC6SourceV4BoundedReview,
} from "./codex-coding-effect/c6-source-v4-bounded-review";

const MAX_GIT_OUTPUT_BYTES =
  64 * 1_024 * 1_024;
const VALUE_OPTIONS = new Set([
  "author-task-name",
  "output-root",
  "reviewer-agent-name",
]);

export interface C6SourceV4BoundedReviewProvenanceCliOptions {
  authorTaskName: string;
  outputRoot: string;
  reviewerAgentName: string;
}

export function parseC6SourceV4BoundedReviewProvenanceCliOptions(
  args: readonly string[],
): C6SourceV4BoundedReviewProvenanceCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match =
      /^--([^=]+)=(.*)$/u.exec(argument);
    if (
      match === null ||
      !VALUE_OPTIONS.has(match[1]!)
    ) {
      throw new Error(
        `unknown C6 source-v4 bounded review provenance option ${argument}`,
      );
    }
    const [, name, value] = match;
    if (values.has(name!)) {
      throw new Error(
        `--${name} cannot be specified more than once`,
      );
    }
    if (
      value!.length === 0 ||
      value!.trim() !== value
    ) {
      throw new Error(
        `--${name} must not be empty or padded`,
      );
    }
    values.set(name!, value!);
  }
  return {
    authorTaskName: required(
      values,
      "author-task-name",
    ),
    outputRoot: required(
      values,
      "output-root",
    ),
    reviewerAgentName: required(
      values,
      "reviewer-agent-name",
    ),
  };
}

export async function recordC6SourceV4BoundedReviewProvenance(
  input: {
    authorTaskName: string;
    outputRoot: string;
    repositoryRoot: string;
    reviewerAgentName: string;
  },
) {
  const repositoryRoot = await realpath(
    resolve(input.repositoryRoot),
  );
  const outputRoot = await realpath(
    resolve(input.outputRoot),
  );
  if (repositoryRoot !== outputRoot) {
    throw new Error(
      "C6 source-v4 bounded review provenance must be recorded in the freeze repository",
    );
  }
  const reviewBytes =
    await readReviewArtifacts(outputRoot);
  const freezeCandidate =
    readFreezeCandidate(
      reviewBytes.input,
    );
  const head = await gitText(
    repositoryRoot,
    ["rev-parse", "HEAD"],
  );
  const headTree = await gitText(
    repositoryRoot,
    [
      "show",
      "-s",
      "--format=%T",
      "HEAD",
    ],
  );
  if (
    freezeCandidate.commitSha !== head ||
    freezeCandidate.treeSha !== headTree
  ) {
    throw new Error(
      "C6 source-v4 bounded review response is not being recorded against the freeze HEAD",
    );
  }
  await assertOnlyReviewFilesChanged(
    repositoryRoot,
  );
  const reviewedSources =
    await Promise.all(
      C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS.map(
        async (path) => ({
          bytes: await gitBuffer(
            repositoryRoot,
            [
              "show",
              `${head}:${path}`,
            ],
          ),
          path,
        }),
      ),
    );
  const reviewedAt = readReviewedAt(
    reviewBytes.response,
  );
  const provenanceBytes = canonicalJson({
    artifactKind:
      "c6-source-v4-bounded-review-provenance",
    authorTaskName: input.authorTaskName,
    dispatch: reference(
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
        .dispatch,
      reviewBytes.dispatch,
    ),
    input: reference(
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.input,
      reviewBytes.input,
    ),
    recordedAt: reviewedAt,
    request: reference(
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
        .request,
      reviewBytes.request,
    ),
    response: reference(
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
        .response,
      reviewBytes.response,
    ),
    reviewer: {
      agentName: input.reviewerAgentName,
      contextPolicy: "fork-turns-none",
      orchestratorAttestation: {
        attestedByTaskName:
          input.authorTaskName,
        basis:
          "orchestrator-observed-dispatch-no-cryptographic-receipt",
        cryptographicReceipt: false,
      },
      requestedTaskName:
        "c6_source_v4_bounded_review_v2",
      type: "independent-ai-agent",
    },
    schemaVersion: 2,
  });
  const validationInput = {
    authorTaskName: input.authorTaskName,
    dispatchBytes:
      reviewBytes.dispatch.toString("utf8"),
    freezeCandidate,
    inputBytes:
      reviewBytes.input.toString("utf8"),
    provenanceBytes,
    requestBytes:
      reviewBytes.request.toString("utf8"),
    responseBytes: reviewBytes.response,
    reviewedSources,
    reviewerAgentName:
      input.reviewerAgentName,
    snapshot:
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY,
  } as const;
  const evidence =
    validateC6SourceV4BoundedReview(
      validationInput,
    );
  const provenancePath = join(
    outputRoot,
    C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
      .provenance,
  );
  await writeFile(
    provenancePath,
    provenanceBytes,
    {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    },
  );
  const published =
    await readC6StableRegularFile(
      provenancePath,
      "source-v4 bounded review provenance",
      1 * 1_024 * 1_024,
      true,
    );
  const publishedEvidence =
    validateC6SourceV4BoundedReview({
      ...validationInput,
      provenanceBytes: published,
    });
  if (
    publishedEvidence.provenanceSha256 !==
      evidence.provenanceSha256
  ) {
    throw new Error(
      "C6 source-v4 bounded published review provenance changed",
    );
  }
  return {
    blockingFindings:
      publishedEvidence.blockingFindings,
    cryptographicReviewIndependence: false,
    decision: publishedEvidence.decision,
    independentReviewAccepted:
      publishedEvidence
        .independentReviewAccepted,
    liveCaptureAuthorized: false,
    outputRoot,
    provenanceSha256:
      publishedEvidence.provenanceSha256,
    reviewReceiptStructureVerified: true,
    sourceSelectionFrozen: false,
  };
}

async function readReviewArtifacts(
  outputRoot: string,
) {
  const read = (
    path: string,
    label: string,
  ) => readC6StableRegularFile(
    join(outputRoot, path),
    label,
    4 * 1_024 * 1_024,
    true,
  );
  const [
    dispatch,
    input,
    request,
    response,
  ] = await Promise.all([
    read(
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
        .dispatch,
      "source-v4 bounded review dispatch",
    ),
    read(
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
        .input,
      "source-v4 bounded review input",
    ),
    read(
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
        .request,
      "source-v4 bounded review request",
    ),
    read(
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
        .response,
      "source-v4 bounded review response",
    ),
  ]);
  return {
    dispatch,
    input,
    request,
    response,
  };
}

function readFreezeCandidate(
  inputBytes: Uint8Array,
): {
  commitSha: string;
  treeSha: string;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(
      Buffer.from(inputBytes).toString("utf8"),
    ) as unknown;
  } catch {
    throw new Error(
      "C6 source-v4 bounded review input is not JSON",
    );
  }
  const freezeCandidate = (
    raw as {
      freezeCandidate?: unknown;
    } | null
  )?.freezeCandidate;
  if (
    freezeCandidate === null ||
    typeof freezeCandidate !== "object" ||
    Array.isArray(freezeCandidate)
  ) {
    throw new Error(
      "C6 source-v4 bounded review input has no freeze candidate",
    );
  }
  const { commitSha, treeSha } =
    freezeCandidate as Record<
      string,
      unknown
    >;
  if (
    typeof commitSha !== "string" ||
    typeof treeSha !== "string" ||
    !/^[a-f0-9]{40}$/u.test(commitSha) ||
    !/^[a-f0-9]{40}$/u.test(treeSha)
  ) {
    throw new Error(
      "C6 source-v4 bounded review freeze candidate is invalid",
    );
  }
  return { commitSha, treeSha };
}

function readReviewedAt(
  responseBytes: Uint8Array,
): string {
  let raw: unknown;
  try {
    raw = JSON.parse(
      Buffer.from(responseBytes)
        .toString("utf8"),
    ) as unknown;
  } catch {
    throw new Error(
      "C6 source-v4 bounded review response is not JSON",
    );
  }
  const reviewedAt = (
    raw as {
      reviewedAt?: unknown;
    } | null
  )?.reviewedAt;
  if (typeof reviewedAt !== "string") {
    throw new Error(
      "C6 source-v4 bounded review response has no reviewedAt",
    );
  }
  return reviewedAt;
}

async function assertOnlyReviewFilesChanged(
  repositoryRoot: string,
): Promise<void> {
  const status = (
    await gitBuffer(repositoryRoot, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ])
  ).toString("utf8");
  const expected = new Set<string>([
    C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
      .dispatch,
    C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.input,
    C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
      .request,
    C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
      .response,
  ]);
  const records = status
    .split("\0")
    .filter((record) => record.length > 0);
  if (
    records.length !== expected.size ||
    records.some((record) => {
      if (!record.startsWith("?? ")) {
        return true;
      }
      const path = record.slice(3);
      return !expected.delete(path);
    }) ||
    expected.size !== 0
  ) {
    throw new Error(
      "C6 source-v4 bounded review recorder requires exactly four untracked review files",
    );
  }
}

function reference(
  path: string,
  bytes: Uint8Array,
) {
  return {
    byteLength: bytes.byteLength,
    path,
    sha256: sha256(bytes),
  };
}

async function gitText(
  repositoryRoot: string,
  args: readonly string[],
): Promise<string> {
  return (
    await gitBuffer(repositoryRoot, args)
  ).toString("utf8").trim();
}

async function gitBuffer(
  repositoryRoot: string,
  args: readonly string[],
): Promise<Buffer> {
  return await runC6PinnedGit(
    repositoryRoot,
    args,
    MAX_GIT_OUTPUT_BYTES,
  );
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

function sha256(
  value: string | Uint8Array,
): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

if (import.meta.main) {
  const options =
    parseC6SourceV4BoundedReviewProvenanceCliOptions(
      process.argv.slice(2),
    );
  const result =
    await recordC6SourceV4BoundedReviewProvenance({
      ...options,
      repositoryRoot: process.cwd(),
    });
  process.stdout.write(
    `${JSON.stringify(result, null, 2)}\n`,
  );
}
