import { createHash } from "node:crypto";
import {
  mkdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  runC6PinnedGit,
} from "./codex-coding-effect/c6-git-runtime";
import {
  buildC6SourceV4BoundedReviewBundle,
  C6_SOURCE_V4_BOUNDED_ACTIVATION_RECEIPT_PATH,
  C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY,
  C6_SOURCE_V4_BOUNDED_REVIEW_PATHS,
  C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS,
  C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT,
} from "./codex-coding-effect/c6-source-v4-bounded-review";
import {
  assertC6SourceV4BoundedSnapshotVerified,
  loadC6SourceV4BoundedSnapshot,
} from "./codex-coding-effect/c6-source-v4-bounded-snapshot";

const MAX_GIT_OUTPUT_BYTES =
  64 * 1_024 * 1_024;
const CAPTURE_BRIDGE_PATH =
  "scripts/run-codex-coding-effect-c6-source-v4-bounded-capture.sh";
const VALUE_OPTIONS = new Set([
  "author-task-name",
  "output-root",
  "reviewer-agent-name",
  "snapshot-root",
]);

export interface C6SourceV4BoundedReviewPreparationCliOptions {
  authorTaskName: string;
  outputRoot: string;
  reviewerAgentName: string;
  snapshotRoot: string;
}

export function parseC6SourceV4BoundedReviewPreparationCliOptions(
  args: readonly string[],
): C6SourceV4BoundedReviewPreparationCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match =
      /^--([^=]+)=(.*)$/u.exec(argument);
    if (
      match === null ||
      !VALUE_OPTIONS.has(match[1]!)
    ) {
      throw new Error(
        `unknown C6 source-v4 bounded review preparation option ${argument}`,
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
    snapshotRoot: required(
      values,
      "snapshot-root",
    ),
  };
}

export async function prepareC6SourceV4BoundedReview(
  input: {
    authorTaskName: string;
    outputRoot: string;
    repositoryRoot: string;
    reviewerAgentName: string;
    snapshotRoot: string;
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
      "C6 source-v4 bounded review artifacts must be materialized in the freeze repository",
    );
  }
  await assertCleanFreezeWorktree(
    repositoryRoot,
  );
  const [freezeCommitSha, freezeTreeSha] =
    await Promise.all([
      gitText(repositoryRoot, [
        "rev-parse",
        "HEAD",
      ]),
      gitText(repositoryRoot, [
        "show",
        "-s",
        "--format=%T",
        "HEAD",
      ]),
    ]);
  await assertSelectionCheckpointAncestor(
    repositoryRoot,
    freezeCommitSha,
  );
  const pathsAtFreeze = new Set(
    (
      await gitBuffer(repositoryRoot, [
        "ls-tree",
        "-rz",
        "--name-only",
        "HEAD",
      ])
    )
      .toString("utf8")
      .split("\0")
      .filter((path) => path.length > 0),
  );
  for (const path of [
    ...Object.values(
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS,
    ),
    C6_SOURCE_V4_BOUNDED_ACTIVATION_RECEIPT_PATH,
    CAPTURE_BRIDGE_PATH,
  ]) {
    if (pathsAtFreeze.has(path)) {
      throw new Error(
        "C6 source-v4 bounded review or activation path already exists at freeze",
      );
    }
  }
  const reviewedSources =
    await Promise.all(
      C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS.map(
        async (path) => ({
          bytes: await readFrozenRegularBlob(
            repositoryRoot,
            freezeCommitSha,
            path,
          ),
          path,
        }),
      ),
    );
  const snapshot =
    await loadC6SourceV4BoundedSnapshot(
      input.snapshotRoot,
    );
  assertC6SourceV4BoundedSnapshotVerified(
    snapshot,
  );
  if (
    snapshot.assetBytes !==
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
        .assetBytes ||
    snapshot.assetLock.assetLockSha256 !==
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
        .assetLock.sha256 ||
    snapshot.assetLock.assetLock
        .assetRootSha256 !==
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
        .assetRootSha256 ||
    snapshot.selectionReceipt.receipt
        .selectedRepositoriesSha256 !==
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
        .selectedRepositoriesSha256
  ) {
    throw new Error(
      "C6 source-v4 bounded review snapshot identity mismatch",
    );
  }
  const bundle =
    buildC6SourceV4BoundedReviewBundle({
      authorTaskName: input.authorTaskName,
      freezeCandidate: {
        commitSha: freezeCommitSha,
        treeSha: freezeTreeSha,
      },
      reviewedSources,
      reviewerAgentName:
        input.reviewerAgentName,
      snapshot:
        C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY,
    });
  const reviewRoot = dirname(
    join(
      outputRoot,
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
        .input,
    ),
  );
  await mkdir(dirname(reviewRoot), {
    recursive: true,
  });
  try {
    await mkdir(reviewRoot);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw new Error(
        "C6 source-v4 bounded review root already exists",
      );
    }
    throw error;
  }
  await Promise.all([
    writeFile(
      join(
        outputRoot,
        C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
          .dispatch,
      ),
      bundle.dispatchBytes,
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      },
    ),
    writeFile(
      join(
        outputRoot,
        C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
          .input,
      ),
      bundle.inputBytes,
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      },
    ),
    writeFile(
      join(
        outputRoot,
        C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
          .request,
      ),
      bundle.requestBytes,
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      },
    ),
  ]);
  return {
    dispatchSha256: sha256(
      bundle.dispatchBytes,
    ),
    freezeCommitSha,
    freezeTreeSha,
    independentReviewAccepted: false,
    inputSha256: sha256(
      bundle.inputBytes,
    ),
    liveCaptureAuthorized: false,
    outputRoot,
    provenanceMaterialized: false,
    requestSha256: sha256(
      bundle.requestBytes,
    ),
    responseMaterialized: false,
    reviewRoot,
    sourceSelectionFrozen: false,
  };
}

async function assertCleanFreezeWorktree(
  repositoryRoot: string,
): Promise<void> {
  const status = await gitBuffer(
    repositoryRoot,
    [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ],
  );
  if (status.byteLength !== 0) {
    throw new Error(
      "C6 source-v4 bounded review preparation requires a clean freeze worktree",
    );
  }
}

async function assertSelectionCheckpointAncestor(
  repositoryRoot: string,
  freezeCommitSha: string,
): Promise<void> {
  const checkpointTree = await gitText(
    repositoryRoot,
    [
      "show",
      "-s",
      "--format=%T",
      C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT
        .commitSha,
    ],
  );
  if (
    checkpointTree !==
      C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT
        .treeSha ||
    freezeCommitSha ===
      C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT
        .commitSha
  ) {
    throw new Error(
      "C6 source-v4 bounded freeze does not descend from the exact selection checkpoint",
    );
  }
  try {
    await gitBuffer(repositoryRoot, [
      "merge-base",
      "--is-ancestor",
      C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT
        .commitSha,
      freezeCommitSha,
    ]);
  } catch {
    throw new Error(
      "C6 source-v4 bounded freeze does not descend from the exact selection checkpoint",
    );
  }
}

async function readFrozenRegularBlob(
  repositoryRoot: string,
  commitSha: string,
  path: string,
): Promise<Buffer> {
  const entry = (
    await gitBuffer(repositoryRoot, [
      "ls-tree",
      commitSha,
      "--",
      path,
    ])
  ).toString("utf8").trim();
  if (
    !/^100644 blob [a-f0-9]{40}\t/u
      .test(entry)
  ) {
    throw new Error(
      `C6 source-v4 bounded reviewed source is not one regular blob: ${path}`,
    );
  }
  return await gitBuffer(repositoryRoot, [
    "show",
    `${commitSha}:${path}`,
  ]);
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

function sha256(
  value: string | Uint8Array,
): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

if (import.meta.main) {
  const options =
    parseC6SourceV4BoundedReviewPreparationCliOptions(
      process.argv.slice(2),
    );
  const result =
    await prepareC6SourceV4BoundedReview({
      ...options,
      repositoryRoot: process.cwd(),
    });
  process.stdout.write(
    `${JSON.stringify(result, null, 2)}\n`,
  );
}
