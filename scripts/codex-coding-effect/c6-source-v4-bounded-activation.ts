import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import {
  isDeepStrictEqual,
} from "node:util";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  buildC6AssetLock,
  loadC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
  verifyC6AssetClosure,
} from "./c6-asset-lock";
import {
  runC6BunFsLivenessStress,
} from "./c6-bun-fs-liveness-stress";
import {
  runC6PinnedGit,
} from "./c6-git-runtime";
import {
  commitC6SourceV3SimpleCreateOnlyBytes,
  commitC6SourceV3SimpleCreateOnlyCanonicalJson,
} from "./c6-source-v3-simple-census-ledger";
import {
  executeC6SourceV3SimpleLogicalRequest,
} from "./c6-source-v3-simple-census-executor";
import {
  C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
  C6_SOURCE_V4_BOUNDED_MAX_LIVE_LOGICAL_REQUEST_COUNT,
} from "./c6-source-v4-bounded-contract";
import {
  C6_SOURCE_V4_BOUNDED_CONTRACT_SHA256,
} from "./c6-source-v4-bounded-receipts";
import {
  buildC6SourceV4BoundedCapturePlan,
  replayC6SourceV4BoundedCapture,
} from "./c6-source-v4-bounded-replay";
import {
  scanC6SourceV4BoundedV3CommittedRequests,
} from "./c6-source-v4-bounded-v3-runtime";
import {
  classifyC6SourceV3SimplePullRequests,
  enumerateC6SourceV3SimplePullRequests,
  normalizeC6SourceV3SimplePullRequestRows,
} from "./c6-source-v3-simple-census-core";
import type {
  C6SourceV3SimpleRepositoryNode,
  C6SourceV3SimpleRepositoryRow,
} from "./c6-source-v3-simple-census-core";
import type {
  C6SourceV3SimpleProjectedLogicalRequest,
} from "./c6-source-v3-simple-census-replay";
import {
  buildC6SourceV3SimpleDurableGraphqlRequest,
} from "./c6-source-v3-simple-census-transport";
import type {
  C6SourceV3SimpleDurableGraphqlRequest,
} from "./c6-source-v3-simple-census-transport";
import {
  buildC6SourceV4BoundedReviewBundle,
  C6_SOURCE_V4_BOUNDED_ACTIVATION_RECEIPT_PATH,
  C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY,
  C6_SOURCE_V4_BOUNDED_REVIEW_PATHS,
  C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS,
  C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT,
  validateC6SourceV4BoundedReview,
} from "./c6-source-v4-bounded-review";
import {
  assertC6SourceV4BoundedSnapshotVerified,
  loadC6SourceV4BoundedSnapshot,
} from "./c6-source-v4-bounded-snapshot";
import type {
  LoadedC6SourceV4BoundedSnapshot,
} from "./c6-source-v4-bounded-snapshot";

const RUNNING_REPOSITORY_ROOT = resolve(
  import.meta.dir,
  "../..",
);
const MAX_GIT_OUTPUT_BYTES = 64 * 1_024 * 1_024;
const REVIEW_PATH_SET = new Set<string>(
  Object.values(
    C6_SOURCE_V4_BOUNDED_REVIEW_PATHS,
  ),
);
const sha1Schema = z.string().regex(
  /^[a-f0-9]{40}$/u,
);
const sha256Schema = z.string().regex(
  /^[a-f0-9]{64}$/u,
);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const captureSuccessTerminalSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v4-bounded-capture-terminal",
  ),
  completedAt: z.iso.datetime(),
  finalLogicalRequestCompletionSha256:
    sha256Schema,
  logicalRequestCount: z.number().int().min(
    C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
      .selectedRepositoryCount,
  ).max(
    C6_SOURCE_V4_BOUNDED_MAX_LIVE_LOGICAL_REQUEST_COUNT,
  ),
  normalizedCapture:
    artifactReferenceSchema.extend({
      bytes: z.number().int().positive(),
      path: z.literal(
        "normalized-capture.json",
      ),
    }).strict(),
  projectionSha256: sha256Schema,
  receiptSha256: sha256Schema,
  schemaVersion: z.literal(1),
  status: z.literal(
    "logical-requests-complete-asset-lock-pending",
  ),
}).strict();
const captureFailureTerminalSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v4-bounded-capture-failure-terminal",
  ),
  error: z.object({
    messageSha256: sha256Schema,
    name: z.string().min(1),
  }).strict(),
  failedAt: z.iso.datetime(),
  finalLogicalRequestCompletionSha256:
    sha256Schema,
  logicalRequestCount:
    z.number().int().nonnegative().max(
      C6_SOURCE_V4_BOUNDED_MAX_LIVE_LOGICAL_REQUEST_COUNT,
    ),
  publicationCommitSha: sha1Schema,
  receiptSha256: sha256Schema,
  schemaVersion: z.literal(1),
  status: z.literal(
    "permanently-abandoned-no-retry-redraw-or-top-up",
  ),
}).strict();
export const C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH =
  "scripts/run-codex-coding-effect-c6-source-v4-bounded-capture.sh";

export const C6_SOURCE_V4_BOUNDED_CAPTURE_ROOT_DIRECTORY =
  "source-v4-bounded-live-capture-v1";

export const C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_SOURCE =
  `#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && /bin/pwd -P)
WORKER="$SCRIPT_DIR/codex-coding-effect/c6-source-v4-bounded-activation.ts"
PINNED_BUN="/Users/hjqcan/workspace/GoodMemory-c6-runtime/toolchains/bun-v1.3.12-darwin-aarch64/bun-darwin-aarch64/bun"

if [ "\${GOODMEMORY_C6_GITHUB_TOKEN+x}" = "x" ]; then
  exec /usr/bin/env -i \\
    GOODMEMORY_C6_GITHUB_TOKEN="$GOODMEMORY_C6_GITHUB_TOKEN" \\
    "$PINNED_BUN" \\
    --config=/dev/null \\
    --no-env-file \\
    --no-install \\
    --no-addons \\
    "$WORKER" "$@"
fi

exec /usr/bin/env -i \\
  "$PINNED_BUN" \\
  --config=/dev/null \\
  --no-env-file \\
  --no-install \\
  --no-addons \\
  "$WORKER" "$@"
`;

const CAPTURE_WORKER_EXEC_ARGV = [
  "--config=/dev/null",
  "--no-env-file",
  "--no-install",
  "--no-addons",
] as const;
const CAPTURE_WORKER_ENVIRONMENT =
  new Set([
    "GOODMEMORY_C6_GITHUB_TOKEN",
  ]);
const ACTIVATION_LIVENESS = {
  bunExecutableSha256:
    "39e644cea4e6db24a3af36013695655d6f789b4b98f1f13bacb882ac6e5c3c18",
  bunRevision:
    "700fc117a2fd01ac0201deaa6fa69c5557acb04f",
  bunVersion: "1.3.12",
  concurrency: 8,
  fsPromiseOperationsPerSeed: 700_000,
  scriptSha256:
    "019cde93809a7cf052b33a965d562a7b8466726766dbf28ccfa8d1ba66b9ce90",
  seeds: [
    0x1a2b3c4d,
    0x5e6f7788,
    0x10293847,
  ],
  timeoutMsPerSeed: 180_000,
  workItemsPerSeed: 100_000,
} as const;
const livenessRuntimeSchema = z.object({
  arch: z.literal("arm64"),
  bunRevision: z.literal(
    ACTIVATION_LIVENESS.bunRevision,
  ),
  bunVersion: z.literal(
    ACTIVATION_LIVENESS.bunVersion,
  ),
  executable: z.string().min(1),
  executableSha256: z.literal(
    ACTIVATION_LIVENESS.bunExecutableSha256,
  ),
  platform: z.literal("darwin"),
  scriptSha256: z.literal(
    ACTIVATION_LIVENESS.scriptSha256,
  ),
}).strict();
const cleanObservationSchema = (
  seed: typeof ACTIVATION_LIVENESS.seeds[number],
) => z.object({
  completedFsPromiseOperations: z.literal(
    ACTIVATION_LIVENESS
      .fsPromiseOperationsPerSeed,
  ),
  completedWorkItems: z.literal(
    ACTIVATION_LIVENESS.workItemsPerSeed,
  ),
  durationMs: z.number().nonnegative(),
  exitCode: z.literal(0),
  failureReason: z.null(),
  protocolErrors: z.tuple([]),
  resultSha256: sha256Schema,
  runtime: livenessRuntimeSchema,
  seed: z.literal(seed),
  signalCode: z.null(),
  startSha256: sha256Schema,
  status: z.literal("passed"),
  stderrTail: z.literal(""),
  terminationSignalRequested: z.null(),
  timedOut: z.literal(false),
}).strict();
const cleanLivenessReportSchema = z.object({
  artifactKind: z.literal(
    "c6-bun-fs-liveness-stress-report",
  ),
  clean: z.literal(true),
  completedAt: z.iso.datetime(),
  configuration: z.object({
    concurrency: z.literal(
      ACTIVATION_LIVENESS.concurrency,
    ),
    fsPromiseOperationsPerSeed: z.literal(
      ACTIVATION_LIVENESS
        .fsPromiseOperationsPerSeed,
    ),
    seedCount: z.literal(
      ACTIVATION_LIVENESS.seeds.length,
    ),
    timeoutMsPerSeed: z.literal(
      ACTIVATION_LIVENESS.timeoutMsPerSeed,
    ),
    workItemsPerSeed: z.literal(
      ACTIVATION_LIVENESS.workItemsPerSeed,
    ),
  }).strict(),
  durationMs: z.number().nonnegative(),
  expected: z.object({
    arch: z.literal("arm64"),
    bunExecutableSha256: z.literal(
      ACTIVATION_LIVENESS
        .bunExecutableSha256,
    ),
    bunRevision: z.literal(
      ACTIVATION_LIVENESS.bunRevision,
    ),
    bunVersion: z.literal(
      ACTIVATION_LIVENESS.bunVersion,
    ),
    platform: z.literal("darwin"),
    scriptSha256: z.literal(
      ACTIVATION_LIVENESS.scriptSha256,
    ),
  }).strict(),
  observations: z.tuple([
    cleanObservationSchema(
      ACTIVATION_LIVENESS.seeds[0],
    ),
    cleanObservationSchema(
      ACTIVATION_LIVENESS.seeds[1],
    ),
    cleanObservationSchema(
      ACTIVATION_LIVENESS.seeds[2],
    ),
  ]),
  schemaVersion: z.literal(2),
  selectedBunExecutable: z.string().min(1),
  startedAt: z.iso.datetime(),
}).strict();
const receiptCommitSchema = z.object({
  commitSha: sha1Schema,
  parentCommitSha: sha1Schema,
  treeSha: sha1Schema,
}).strict();
const activationReceiptSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v4-bounded-activation-receipt",
  ),
  authorTaskName: z.string().min(1),
  boundary: z.object({
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    independentReviewAccepted: z.literal(true),
    liveCaptureAuthorized: z.literal(false),
    maxLiveCaptureCount: z.literal(1),
    publicationCommitRequired: z.literal(true),
    sourceSelectionFrozen: z.literal(true),
  }).strict(),
  captureTarget: z.object({
    path: z.string().min(1).refine(
      (value) =>
        isAbsolute(value) &&
        resolve(value) === value,
      "capture target must be an absolute normalized path",
    ),
    scope: z.literal(
      "host-local-activated-repository-root",
    ),
  }).strict(),
  bridge: z.object({
    byteLength: z.number().int().positive(),
    gitBlobSha1: sha1Schema,
    mode: z.literal("100644"),
    path: z.literal(
      C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH,
    ),
    sha256: sha256Schema,
  }).strict(),
  evaluationId: z.literal(
    "goodmemory-c6-codex-coding-effect-source-v4-bounded-v1",
  ),
  generatedAt: z.iso.datetime(),
  lineage: z.object({
    activation: receiptCommitSchema,
    freeze: receiptCommitSchema,
    review: receiptCommitSchema,
    selectionCheckpoint: z.object({
      commitSha: z.literal(
        C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT
          .commitSha,
      ),
      treeSha: z.literal(
        C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT
          .treeSha,
      ),
    }).strict(),
  }).strict(),
  livenessReport: cleanLivenessReportSchema,
  reviewEvidence: z.object({
    cryptographicReviewIndependence:
      z.literal(false),
    dispatchSha256: sha256Schema,
    inputSha256: sha256Schema,
    provenanceSha256: sha256Schema,
    requestSha256: sha256Schema,
    responseSha256: sha256Schema,
    reviewReceiptStructureVerified:
      z.literal(true),
  }).strict(),
  reviewerAgentName: z.string().min(1),
  runtime: z.object({
    arch: z.literal("arm64"),
    bunExecutableSha256: z.literal(
      ACTIVATION_LIVENESS
        .bunExecutableSha256,
    ),
    bunRevision: z.literal(
      ACTIVATION_LIVENESS.bunRevision,
    ),
    bunVersion: z.literal(
      ACTIVATION_LIVENESS.bunVersion,
    ),
    nodeVersion: z.literal("24.3.0"),
    platform: z.literal("darwin"),
  }).strict(),
  schemaVersion: z.literal(1),
  snapshot: z.object({
    assetBytes: z.literal(
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
        .assetBytes,
    ),
    assetLock: z.object({
      byteLength: z.literal(
        C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
          .assetLock.byteLength,
      ),
      path: z.literal(
        C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
          .assetLock.path,
      ),
      sha256: z.literal(
        C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
          .assetLock.sha256,
      ),
    }).strict(),
    assetRootSha256: z.literal(
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
        .assetRootSha256,
    ),
    manifest: z.object({
      byteLength: z.literal(
        C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
          .manifest.byteLength,
      ),
      path: z.literal(
        C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
          .manifest.path,
      ),
      sha256: z.literal(
        C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
          .manifest.sha256,
      ),
    }).strict(),
    selectedRepositoriesSha256: z.literal(
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
        .selectedRepositoriesSha256,
    ),
    selectedRepositoryCount: z.literal(
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
        .selectedRepositoryCount,
    ),
  }).strict(),
  status: z.literal(
    "prepared-publication-commit-required-no-live-or-codex-authority",
  ),
}).strict();
const captureClaimSchema = z.object({
  activationCommitSha: sha1Schema,
  artifactKind: z.literal(
    "c6-source-v4-bounded-capture-claim",
  ),
  evaluationId: z.literal(
    C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
  ),
  maxLiveCaptureCount: z.literal(1),
  publicationCommitSha: sha1Schema,
  receiptSha256: sha256Schema,
  schemaVersion: z.literal(1),
  snapshot:
    activationReceiptSchema.shape.snapshot,
  startedAt: z.iso.datetime(),
  status: z.literal(
    "claimed-once-no-retry-redraw-or-top-up",
  ),
}).strict();

interface CommitIdentity {
  commitSha: string;
  parentCommitShas: string[];
  treeSha: string;
}

interface GitTreeEntry {
  mode: string;
  objectId: string;
  path: string;
  type: string;
}

export interface C6SourceV4BoundedActivationLineage {
  boundary: {
    candidateManifestFrozen: false;
    codexRunReady: false;
    independentReviewAccepted: true;
    liveCaptureAuthorized: false;
    sourceSelectionFrozen: true;
  };
  bridge: {
    byteLength: number;
    gitBlobSha1: string;
    mode: "100644";
    path:
      typeof C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH;
    sha256: string;
  };
  lineage: {
    activation: CommitIdentity;
    freeze: CommitIdentity & {
      parentCommitSha: string;
    };
    review: CommitIdentity;
    selectionCheckpoint:
      typeof C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT;
  };
  reviewEvidence: ReturnType<
    typeof validateC6SourceV4BoundedReview
  >;
}

export type C6SourceV4BoundedActivationReceipt =
  z.infer<typeof activationReceiptSchema>;

const VERIFIED_CAPTURE_AUTHORIZATION = Symbol(
  "C6 source-v4 bounded verified capture authorization",
);
const VERIFIED_CAPTURE_AUTHORIZATIONS =
  new WeakSet<object>();
const CONSUMED_CAPTURE_AUTHORIZATIONS =
  new WeakSet<object>();
const AUTHORIZATION_STATES = new WeakMap<
  object,
  {
    captureTargetPath: string;
    publicationCommitSha: string;
    receiptSha256: string;
    repositoryRoot: string;
  }
>();

export interface C6SourceV4BoundedCaptureAuthorization {
  readonly [VERIFIED_CAPTURE_AUTHORIZATION]: true;
  boundary: {
    candidateManifestFrozen: false;
    codexRunReady: false;
    independentReviewAccepted: true;
    liveCaptureAuthorized: true;
    maxLiveCaptureCount: 1;
    sourceSelectionFrozen: true;
  };
  freshLiveness: z.infer<
    typeof cleanLivenessReportSchema
  >;
  publication: CommitIdentity;
  receipt:
    C6SourceV4BoundedActivationReceipt;
  receiptSha256: string;
  snapshot:
    LoadedC6SourceV4BoundedSnapshot;
}

export interface C6SourceV4BoundedActivationCliOptions {
  activationCommitSha: string;
  authorTaskName: string;
  authorizeOneLiveCapture: true;
  freezeCommitSha: string;
  outputPath: string;
  reviewCommitSha: string;
  reviewerAgentName: string;
  snapshotRoot: string;
}

interface C6SourceV4BoundedCaptureCliBase {
  captureRoot: string;
  publicationCommitSha: string;
  snapshotRoot: string;
}

export type C6SourceV4BoundedCaptureCliOptions =
  C6SourceV4BoundedCaptureCliBase & (
    | {
        executeOneLiveCapture: true;
        mode: "execute-one-live-capture";
      }
    | {
        finalizeOnly: true;
        mode: "finalize-only";
      }
  );

export function resolveC6SourceV4BoundedCaptureRoot(
  repositoryRoot: string,
): string {
  return resolve(
    dirname(resolve(repositoryRoot)),
    "GoodMemory-c6-runtime",
    C6_SOURCE_V4_BOUNDED_CAPTURE_ROOT_DIRECTORY,
  );
}

export function parseC6SourceV4BoundedActivationCliOptions(
  args: readonly string[],
): C6SourceV4BoundedActivationCliOptions {
  const values = parseCliValues(
    args,
    new Set([
      "activation-commit",
      "author-task-name",
      "freeze-commit",
      "output-path",
      "review-commit",
      "reviewer-agent-name",
      "snapshot-root",
    ]),
    new Set(["authorize-one-live-capture"]),
    "activation",
  );
  if (
    !values.has("authorize-one-live-capture")
  ) {
    throw new Error(
      "--authorize-one-live-capture is required",
    );
  }
  return {
    activationCommitSha: sha1Schema.parse(
      requiredCliValue(
        values,
        "activation-commit",
      ),
    ),
    authorTaskName: requiredCliValue(
      values,
      "author-task-name",
    ),
    authorizeOneLiveCapture: true,
    freezeCommitSha: sha1Schema.parse(
      requiredCliValue(
        values,
        "freeze-commit",
      ),
    ),
    outputPath: requiredCliValue(
      values,
      "output-path",
    ),
    reviewCommitSha: sha1Schema.parse(
      requiredCliValue(
        values,
        "review-commit",
      ),
    ),
    reviewerAgentName: requiredCliValue(
      values,
      "reviewer-agent-name",
    ),
    snapshotRoot: requiredCliValue(
      values,
      "snapshot-root",
    ),
  };
}

export function parseC6SourceV4BoundedCaptureCliOptions(
  args: readonly string[],
): C6SourceV4BoundedCaptureCliOptions {
  const values = parseCliValues(
    args,
    new Set([
      "capture-root",
      "publication-commit",
      "snapshot-root",
    ]),
    new Set([
      "execute-one-live-capture",
      "finalize-only",
    ]),
    "capture",
  );
  const executeOneLiveCapture =
    values.has("execute-one-live-capture");
  const finalizeOnly =
    values.has("finalize-only");
  if (
    Number(executeOneLiveCapture) +
      Number(finalizeOnly) !==
    1
  ) {
    throw new Error(
      "exactly one capture mode is required: --execute-one-live-capture or --finalize-only",
    );
  }
  const common = {
    captureRoot: requiredCliValue(
      values,
      "capture-root",
    ),
    publicationCommitSha:
      sha1Schema.parse(
        requiredCliValue(
          values,
          "publication-commit",
        ),
      ),
    snapshotRoot: requiredCliValue(
      values,
      "snapshot-root",
    ),
  };
  return executeOneLiveCapture
    ? {
        ...common,
        executeOneLiveCapture: true,
        mode:
          "execute-one-live-capture",
      }
    : {
        ...common,
        finalizeOnly: true,
        mode: "finalize-only",
      };
}

export function serializeC6SourceV4BoundedActivationReceipt(
  input: unknown,
): string {
  return canonicalJson(
    activationReceiptSchema.parse(input),
  );
}

export function parseC6SourceV4BoundedActivationReceipt(
  input: string | Uint8Array,
): C6SourceV4BoundedActivationReceipt {
  const artifact = exactUtf8(
    input,
    "activation receipt",
  );
  let raw: unknown;
  try {
    raw = JSON.parse(artifact.text) as unknown;
  } catch {
    throw new Error(
      "C6 source-v4 bounded activation receipt is not JSON",
    );
  }
  if (
    artifact.text !== canonicalJson(raw)
  ) {
    throw new Error(
      "C6 source-v4 bounded activation receipt is not canonical JSON",
    );
  }
  return activationReceiptSchema.parse(raw);
}

export function assertC6SourceV4BoundedActivationLivenessReport(
  report: unknown,
): asserts report is z.infer<
  typeof cleanLivenessReportSchema
> {
  try {
    cleanLivenessReportSchema.parse(report);
  } catch {
    throw new Error(
      "C6 source-v4 bounded activation requires a clean pinned liveness report",
    );
  }
}

export async function buildC6SourceV4BoundedActivationReceipt(
  input: {
    activationCommitSha: string;
    authorTaskName: string;
    freezeCommitSha: string;
    repositoryRoot: string;
    reviewCommitSha: string;
    reviewerAgentName: string;
    snapshotRoot: string;
  },
): Promise<C6SourceV4BoundedActivationReceipt> {
  const repositoryRoot = await realpath(
    resolve(input.repositoryRoot),
  );
  const head = await readHead(repositoryRoot);
  if (head !== input.activationCommitSha) {
    throw new Error(
      "C6 source-v4 bounded activation receipt must be generated at activation HEAD",
    );
  }
  const lineage =
    await verifyC6SourceV4BoundedActivationLineage({
      activationCommitSha:
        input.activationCommitSha,
      authorTaskName: input.authorTaskName,
      freezeCommitSha: input.freezeCommitSha,
      repositoryRoot,
      reviewCommitSha: input.reviewCommitSha,
      reviewerAgentName:
        input.reviewerAgentName,
    });
  await assertCleanRepositoryWorktree(
    repositoryRoot,
  );
  const captureTarget =
    await loadAvailableCaptureTarget(
      repositoryRoot,
    );
  const runtime =
    await assertActivationRuntime();
  const snapshot =
    await loadCanonicalActivationSnapshot(
      input.snapshotRoot,
    );
  assertC6SourceV4BoundedSnapshotVerified(
    snapshot,
  );
  const livenessReport =
    await runActivationLiveness();
  assertC6SourceV4BoundedActivationLivenessReport(
    livenessReport,
  );
  return activationReceiptSchema.parse({
    artifactKind:
      "c6-source-v4-bounded-activation-receipt",
    authorTaskName: input.authorTaskName,
    boundary: {
      candidateManifestFrozen: false,
      codexRunReady: false,
      independentReviewAccepted: true,
      liveCaptureAuthorized: false,
      maxLiveCaptureCount: 1,
      publicationCommitRequired: true,
      sourceSelectionFrozen: true,
    },
    captureTarget,
    bridge: lineage.bridge,
    evaluationId:
      "goodmemory-c6-codex-coding-effect-source-v4-bounded-v1",
    generatedAt: new Date().toISOString(),
    lineage:
      receiptLineage(lineage),
    livenessReport,
    reviewEvidence: projectReviewEvidence(
      lineage,
    ),
    reviewerAgentName:
      input.reviewerAgentName,
    runtime,
    schemaVersion: 1,
    snapshot:
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY,
    status:
      "prepared-publication-commit-required-no-live-or-codex-authority",
  });
}

async function loadC6SourceV4BoundedActivationPublication(
  repositoryRoot: string,
  publicationCommitSha: string,
): Promise<{
  activation: CommitIdentity;
  publication: CommitIdentity;
  receiptBytes: Buffer;
}> {
  const publication =
    await readCommitIdentity(
      repositoryRoot,
      publicationCommitSha,
      "activation publication",
    );
  if (
    publication.parentCommitShas.length !== 1
  ) {
    throw new Error(
      "C6 source-v4 bounded activation publication must have exactly one parent",
    );
  }
  const activation =
    await readCommitIdentity(
      repositoryRoot,
      publication.parentCommitShas[0]!,
      "published activation",
    );
  const [activationTree, publicationTree] =
    await Promise.all([
      readTree(repositoryRoot, activation),
      readTree(repositoryRoot, publication),
    ]);
  assertExactTreeAdditions(
    activationTree,
    publicationTree,
    new Set([
      C6_SOURCE_V4_BOUNDED_ACTIVATION_RECEIPT_PATH,
    ]),
    "C6 source-v4 bounded publication commit must add only the activation receipt",
  );
  await assertUniqueReachableChild(
    repositoryRoot,
    activation.commitSha,
    publication.commitSha,
    "C6 source-v4 bounded activation must have one reachable publication child",
  );
  return {
    activation,
    publication,
    receiptBytes: await readRegularBlob(
      repositoryRoot,
      publicationTree,
      C6_SOURCE_V4_BOUNDED_ACTIVATION_RECEIPT_PATH,
      "published activation receipt",
    ),
  };
}

export async function verifyC6SourceV4BoundedActivationReceipt(
  input: {
    publicationCommitSha: string;
    repositoryRoot: string;
    snapshotRoot: string;
  },
): Promise<C6SourceV4BoundedCaptureAuthorization> {
  const verified =
    await loadC6SourceV4BoundedActivationEvidence(
      input,
    );
  if (
    await pathExists(
      verified.captureTarget.path,
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded host-local capture target already exists",
    );
  }
  const freshLiveness =
    await runActivationLiveness();
  assertC6SourceV4BoundedActivationLivenessReport(
    freshLiveness,
  );
  await assertC6SourceV4BoundedAuthorizationState(
    {
      captureTargetPath:
        verified.captureTarget.path,
      publicationCommitSha:
        verified.publication.publication
          .commitSha,
      receiptSha256:
        verified.receiptSha256,
      repositoryRoot:
        verified.repositoryRoot,
    },
  );
  const frozenReceipt =
    deepFreeze(verified.receipt);
  const frozenLiveness =
    deepFreeze(freshLiveness);
  const authorization = Object.freeze({
    [VERIFIED_CAPTURE_AUTHORIZATION]:
      true as const,
    boundary: deepFreeze({
      candidateManifestFrozen: false as const,
      codexRunReady: false as const,
      independentReviewAccepted:
        true as const,
      liveCaptureAuthorized: true as const,
      maxLiveCaptureCount: 1 as const,
      sourceSelectionFrozen: true as const,
    }),
    freshLiveness: frozenLiveness,
    publication:
      deepFreeze(
        verified.publication.publication,
      ),
    receipt: frozenReceipt,
    receiptSha256:
      verified.receiptSha256,
    snapshot: verified.snapshot,
  });
  VERIFIED_CAPTURE_AUTHORIZATIONS.add(
    authorization,
  );
  AUTHORIZATION_STATES.set(
    authorization,
    {
      captureTargetPath:
        verified.captureTarget.path,
      publicationCommitSha:
        verified.publication.publication
          .commitSha,
      receiptSha256:
        verified.receiptSha256,
      repositoryRoot:
        verified.repositoryRoot,
    },
  );
  return authorization;
}

export async function verifyC6SourceV4BoundedActivationEvidence(
  input: {
    publicationCommitSha: string;
    repositoryRoot: string;
    snapshotRoot: string;
  },
) {
  const verified =
    await loadC6SourceV4BoundedActivationEvidence(
      input,
    );
  const captureState =
    await inspectC6SourceV4BoundedCaptureState(
      verified.captureTarget.path,
      verified.receiptBytes,
      verified.publication.publication
        .commitSha,
      verified.snapshot,
    );
  return deepFreeze({
    boundary: {
      candidateManifestFrozen: false as const,
      codexRunReady: false as const,
      independentReviewAccepted:
        true as const,
      liveCaptureAuthorized: false as const,
      sourceSelectionFrozen: true as const,
    },
    captureState,
    captureTarget: verified.captureTarget,
    publicationCommitSha:
      verified.publication.publication
        .commitSha,
    receiptSha256:
      verified.receiptSha256,
    reviewReceiptStructureVerified:
      true as const,
  });
}

export async function finalizeC6SourceV4BoundedCapture(
  input: {
    captureRoot: string;
    publicationCommitSha: string;
    repositoryRoot: string;
    snapshotRoot: string;
  },
) {
  const captureRoot = resolve(
    input.captureRoot,
  );
  const verified =
    await loadC6SourceV4BoundedActivationEvidence({
      publicationCommitSha:
        input.publicationCommitSha,
      repositoryRoot:
        input.repositoryRoot,
      snapshotRoot: input.snapshotRoot,
    });
  if (
    captureRoot !==
      verified.captureTarget.path
  ) {
    throw new Error(
      "C6 source-v4 bounded finalize-only capture root does not match the published target",
    );
  }
  const state =
    await inspectC6SourceV4BoundedCaptureState(
      captureRoot,
      verified.receiptBytes,
      verified.publication.publication
        .commitSha,
      verified.snapshot,
    );
  if (state.status === "unconsumed") {
    throw new Error(
      "C6 source-v4 bounded finalize-only requires an existing capture claim",
    );
  }
  if (state.status === "claimed-unsealed") {
    await finalizeC6SourceV4BoundedCaptureRoot({
      captureRoot,
      expectedPublicationCommitSha:
        verified.publication.publication
          .commitSha,
      expectedReceiptBytes:
        verified.receiptBytes,
      snapshot: verified.snapshot,
    });
  }
  return await verifyC6SourceV4BoundedActivationEvidence(
    input,
  );
}

async function loadC6SourceV4BoundedActivationEvidence(
  input: {
    publicationCommitSha: string;
    repositoryRoot: string;
    snapshotRoot: string;
  },
) {
  const repositoryRoot = await realpath(
    resolve(input.repositoryRoot),
  );
  const publication =
    await loadC6SourceV4BoundedActivationPublication(
      repositoryRoot,
      sha1Schema.parse(
        input.publicationCommitSha,
      ),
    );
  const receipt =
    parseC6SourceV4BoundedActivationReceipt(
      publication.receiptBytes,
    );
  if (
    receipt.lineage.activation.commitSha !==
      publication.activation.commitSha
  ) {
    throw new Error(
      "C6 source-v4 bounded publication does not directly publish its activation receipt",
    );
  }
  const lineage =
    await verifyC6SourceV4BoundedActivationLineage({
      activationCommitSha:
        receipt.lineage.activation.commitSha,
      authorTaskName:
        receipt.authorTaskName,
      freezeCommitSha:
        receipt.lineage.freeze.commitSha,
      repositoryRoot,
      reviewCommitSha:
        receipt.lineage.review.commitSha,
      reviewerAgentName:
        receipt.reviewerAgentName,
    });
  await assertCleanRepositoryWorktree(
    repositoryRoot,
  );
  await assertFrozenClosureAtHead(
    repositoryRoot,
    lineage,
    publication.publication,
  );
  const captureTarget =
    await loadCaptureTarget(
      repositoryRoot,
    );
  if (
    !isDeepStrictEqual(
      receipt.lineage,
      receiptLineage(lineage),
    ) ||
    !isDeepStrictEqual(
      receipt.bridge,
      lineage.bridge,
    ) ||
    !isDeepStrictEqual(
      receipt.captureTarget,
      captureTarget,
    ) ||
    !isDeepStrictEqual(
      receipt.reviewEvidence,
      projectReviewEvidence(lineage),
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded activation receipt static closure mismatch",
    );
  }
  const runtime =
    await assertActivationRuntime();
  const snapshot =
    await loadCanonicalActivationSnapshot(
      input.snapshotRoot,
    );
  if (
    !isDeepStrictEqual(
      receipt.runtime,
      runtime,
    ) ||
    !isDeepStrictEqual(
      receipt.snapshot,
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY,
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded activation receipt static closure mismatch",
    );
  }
  assertC6SourceV4BoundedActivationLivenessReport(
    receipt.livenessReport,
  );
  const receiptBytes = Buffer.from(
    serializeC6SourceV4BoundedActivationReceipt(
      receipt,
    ),
  );
  return {
    captureTarget,
    lineage,
    publication,
    receipt,
    receiptBytes,
    receiptSha256: sha256(receiptBytes),
    repositoryRoot,
    snapshot,
    snapshotRoot: await realpath(
      resolve(input.snapshotRoot),
    ),
  };
}

export async function claimC6SourceV4BoundedCapture(
  input: {
    authorization:
      C6SourceV4BoundedCaptureAuthorization;
    captureRoot: string;
  },
) {
  assertCaptureAuthorization(
    input.authorization,
  );
  const target = resolve(input.captureRoot);
  if (
    target !==
      input.authorization.receipt
        .captureTarget.path
  ) {
    throw new Error(
      "C6 source-v4 bounded capture root does not match the activated host-local target",
    );
  }
  if (
    CONSUMED_CAPTURE_AUTHORIZATIONS.has(
      input.authorization,
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded capture authority was already consumed",
    );
  }
  const authorizationState =
    AUTHORIZATION_STATES.get(
      input.authorization,
    );
  if (authorizationState === undefined) {
    throw new Error(
      "C6 source-v4 bounded capture authority has no verified repository state",
    );
  }
  await assertC6SourceV4BoundedAuthorizationState(
    authorizationState,
  );
  await assertC6NoSymlinkPathComponents(
    dirname(target),
    "C6 source-v4 bounded capture parent",
  );
  try {
    await mkdir(target, { mode: 0o700 });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw new Error(
        "C6 source-v4 bounded capture root already exists",
      );
    }
    throw error;
  }
  CONSUMED_CAPTURE_AUTHORIZATIONS.add(
    input.authorization,
  );
  const captureRoot = await realpath(target);
  const activationReceipt =
    await commitC6SourceV3SimpleCreateOnlyBytes(
      captureRoot,
      "activation-receipt.json",
      Buffer.from(
        serializeC6SourceV4BoundedActivationReceipt(
          input.authorization.receipt,
        ),
      ),
    );
  const claim = {
    activationCommitSha:
      input.authorization.receipt.lineage
        .activation.commitSha,
    artifactKind:
      "c6-source-v4-bounded-capture-claim",
    evaluationId:
      input.authorization.receipt.evaluationId,
    maxLiveCaptureCount: 1 as const,
    publicationCommitSha:
      input.authorization.publication
        .commitSha,
    receiptSha256:
      input.authorization.receiptSha256,
    schemaVersion: 1 as const,
    snapshot:
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY,
    startedAt: new Date().toISOString(),
    status:
      "claimed-once-no-retry-redraw-or-top-up",
  };
  await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
    captureRoot,
    "capture-claim.json",
    claim,
  );
  return {
    ...claim,
    activationReceipt,
    captureRoot,
  };
}

async function runC6SourceV4BoundedAuthorizedCapture(
  input: {
    authorization:
      C6SourceV4BoundedCaptureAuthorization;
    captureRoot: string;
  },
) {
  assertCaptureAuthorization(
    input.authorization,
  );
  const claim =
    await claimC6SourceV4BoundedCapture({
      authorization: input.authorization,
      captureRoot: input.captureRoot,
    });
  const passRoot = join(
    claim.captureRoot,
    "pass-A",
  );
  let logicalRequestOrdinal = 1;
  let priorLogicalRequestCompletionSha256 =
    "0".repeat(64);
  let authorizationToken:
    Uint8Array | null = null;
  try {
    const projection =
      await executeAuthorizedCapturePlan({
      executeRequest: async (request) => {
        const result =
          await executeC6SourceV3SimpleLogicalRequest({
            assetRoot: claim.captureRoot,
            authorizationTokenProvider:
              async () => {
                authorizationToken ??=
                  await loadGithubToken();
                return authorizationToken;
              },
            evaluationId:
              C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
            executionContractSha256:
              C6_SOURCE_V4_BOUNDED_CONTRACT_SHA256,
            frozenInputClosureSha256:
              C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
                .assetRootSha256,
            logicalRequestOrdinal,
            pass: "A",
            passRoot,
            priorLogicalRequestCompletionSha256,
            request,
            runtimeAuthorizationSha256:
              input.authorization.receiptSha256,
            fetchImpl: Bun.fetch,
          });
        logicalRequestOrdinal += 1;
        priorLogicalRequestCompletionSha256 =
          result.completion.sha256;
        return result.projectedRequest;
      },
      snapshot: input.authorization.snapshot,
      });
    const normalizedCapture =
      await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
        claim.captureRoot,
        "normalized-capture.json",
        projection,
      );
    const terminal =
      await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
        claim.captureRoot,
        "capture-terminal.json",
        {
          artifactKind:
            "c6-source-v4-bounded-capture-terminal",
          completedAt: new Date().toISOString(),
          finalLogicalRequestCompletionSha256:
            priorLogicalRequestCompletionSha256,
          logicalRequestCount:
            logicalRequestOrdinal - 1,
          normalizedCapture,
          projectionSha256:
            projection.projectionSha256,
          receiptSha256:
            input.authorization.receiptSha256,
          schemaVersion: 1,
          status:
            "logical-requests-complete-asset-lock-pending",
        },
      );
    const sealed =
      await finalizeC6SourceV4BoundedCaptureRoot({
        captureRoot: claim.captureRoot,
        expectedPublicationCommitSha:
          input.authorization.publication
            .commitSha,
        expectedReceiptBytes: Buffer.from(
          serializeC6SourceV4BoundedActivationReceipt(
            input.authorization.receipt,
          ),
        ),
        snapshot:
          input.authorization.snapshot,
      });
    return {
      assetLock: sealed.assetLock,
      assetRootSha256:
        sealed.assetRootSha256,
      captureRoot: claim.captureRoot,
      logicalRequestCount:
        logicalRequestOrdinal - 1,
      normalizedCapture,
      projectionSha256:
        projection.projectionSha256,
      terminal,
    };
  } catch (error) {
    const errorIdentity =
      captureErrorIdentity(error);
    if (
      await pathExists(
        join(
          claim.captureRoot,
          "capture-terminal.json",
        ),
      ) ||
      await pathExists(
        join(
          claim.captureRoot,
          "asset-lock.json",
        ),
      )
    ) {
      process.stderr.write(
        `${JSON.stringify({
          captureRoot: claim.captureRoot,
          errorName: errorIdentity.name,
          errorMessageSha256:
            errorIdentity.messageSha256,
          logicalRequestCount:
            logicalRequestOrdinal - 1,
          status:
            "logical-requests-complete-finalize-only-required",
        })}\n`,
      );
      throw new Error(
        "C6 source-v4 bounded logical requests completed but evidence finalization failed; use --finalize-only without another live capture",
        { cause: error },
      );
    }
    try {
      const sealed =
        await sealC6SourceV4BoundedFailedCapture({
          captureRoot: claim.captureRoot,
          errorIdentity,
          finalLogicalRequestCompletionSha256:
            priorLogicalRequestCompletionSha256,
          logicalRequestCount:
            logicalRequestOrdinal - 1,
          publicationCommitSha:
            input.authorization.publication
              .commitSha,
          receiptSha256:
            input.authorization.receiptSha256,
          snapshot:
            input.authorization.snapshot,
        });
      process.stderr.write(
        `${JSON.stringify({
          captureRoot: claim.captureRoot,
          errorName: errorIdentity.name,
          errorMessageSha256:
            errorIdentity.messageSha256,
          failureAssetRootSha256:
            sealed.assetRootSha256,
          logicalRequestCount:
            logicalRequestOrdinal - 1,
          status:
            "permanently-abandoned-with-sealed-failure-evidence",
        })}\n`,
      );
    } catch (sealingError) {
      process.stderr.write(
        `${JSON.stringify({
          captureRoot: claim.captureRoot,
          errorName: errorIdentity.name,
          errorMessageSha256:
            errorIdentity.messageSha256,
          logicalRequestCount:
            logicalRequestOrdinal - 1,
          sealingErrorName:
            sealingError instanceof Error
              ? sealingError.name
              : "UnknownError",
          status:
            "permanently-abandoned-failure-evidence-sealing-failed",
        })}\n`,
      );
      throw new Error(
        "C6 source-v4 bounded capture was permanently abandoned and failure evidence sealing failed",
        {
          cause: new AggregateError([
            error,
            sealingError,
          ]),
        },
      );
    }
    throw new Error(
      "C6 source-v4 bounded capture was permanently abandoned with sealed failure evidence",
      { cause: error },
    );
  }
}

export async function sealC6SourceV4BoundedFailedCapture(
  input: {
    captureRoot: string;
    errorIdentity: {
      messageSha256: string;
      name: string;
    };
    finalLogicalRequestCompletionSha256:
      string;
    logicalRequestCount: number;
    publicationCommitSha: string;
    receiptSha256: string;
    snapshot:
      LoadedC6SourceV4BoundedSnapshot;
  },
) {
  if (
    await pathExists(
      join(
        input.captureRoot,
        "capture-terminal.json",
      ),
    ) ||
    await pathExists(
      join(input.captureRoot, "asset-lock.json"),
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded failure sealing cannot replace an existing finalization state",
    );
  }
  const terminal =
    await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
      input.captureRoot,
      "capture-failure-terminal.json",
      {
        artifactKind:
          "c6-source-v4-bounded-capture-failure-terminal",
        error: input.errorIdentity,
        failedAt: new Date().toISOString(),
        finalLogicalRequestCompletionSha256:
          input.finalLogicalRequestCompletionSha256,
        logicalRequestCount:
          input.logicalRequestCount,
        publicationCommitSha:
          input.publicationCommitSha,
        receiptSha256: input.receiptSha256,
        schemaVersion: 1,
        status:
          "permanently-abandoned-no-retry-redraw-or-top-up",
      },
    );
  const sealed =
    await finalizeC6SourceV4BoundedCaptureRoot({
      captureRoot: input.captureRoot,
      expectedPublicationCommitSha:
        input.publicationCommitSha,
      expectedReceiptBytes:
        await readC6StableRegularFile(
          join(
            input.captureRoot,
            "activation-receipt.json",
          ),
          "source-v4 bounded failed capture activation receipt",
          4 * 1_024 * 1_024,
          true,
        ),
      snapshot: input.snapshot,
    });
  return {
    assetLock: sealed.assetLock,
    assetRootSha256:
      sealed.assetRootSha256,
    terminal,
  };
}

function captureErrorIdentity(
  error: unknown,
): {
  messageSha256: string;
  name: string;
} {
  const name = error instanceof Error
    ? error.name
    : "UnknownError";
  const message = error instanceof Error
    ? error.message
    : String(error);
  return {
    messageSha256: sha256(
      Buffer.from(message),
    ),
    name,
  };
}

async function executeAuthorizedCapturePlan(
  input: {
    executeRequest: (
      request: C6SourceV3SimpleDurableGraphqlRequest,
    ) => Promise<
      C6SourceV3SimpleProjectedLogicalRequest
    >;
    snapshot: LoadedC6SourceV4BoundedSnapshot;
  },
) {
  const plan =
    buildC6SourceV4BoundedCapturePlan(
      input.snapshot,
    );
  const pullRequestClosures = [];
  const pullRequestObservations = [];
  let logicalRequestCount = 0;
  for (const repository of plan.selectedRepositories) {
    const pullRequests =
      await enumerateC6SourceV3SimplePullRequests({
        page: async ({ afterCursor }) => {
          if (
            logicalRequestCount >=
            C6_SOURCE_V4_BOUNDED_MAX_LIVE_LOGICAL_REQUEST_COUNT
          ) {
            throw new Error(
              "C6 source-v4 bounded live logical request budget exceeded",
            );
          }
          const actual = await input.executeRequest(
            buildC6SourceV3SimpleDurableGraphqlRequest({
              operation: "pullRequestPage",
              variables: {
                after: afterCursor,
                repositoryNodeId:
                  repository.repositoryNodeId,
              },
            }),
          );
          logicalRequestCount += 1;
          if (
            actual.operationName !==
              "C6SourceV3SimplePullRequestPage"
          ) {
            throw new Error(
              "C6 source-v4 bounded capture operation sequence mismatch",
            );
          }
          return actual.result.page;
        },
        repository:
          activationRepositoryNode(
            repository,
          ),
      });
    pullRequestClosures.push(
      pullRequests.closure,
    );
    pullRequestObservations.push(
      ...pullRequests.rows,
    );
  }
  const pullRequests =
    normalizeC6SourceV3SimplePullRequestRows(
      pullRequestObservations,
    );
  const metadataDecisions =
    classifyC6SourceV3SimplePullRequests({
      frozenPreWave3AnchorExclusions:
        plan.frozenPreWave3AnchorExclusions,
      frozenPreWave3RepositoryExclusions:
        plan.frozenPreWave3RepositoryExclusions,
      pullRequests,
    });
  const body = {
    artifactKind:
      "c6-source-v4-bounded-normalized-capture",
    identity: plan.identity,
    logicalRequestCount,
    metadataDecisions,
    pullRequestClosures,
    pullRequests,
    schemaVersion: 1,
    selectedRepositories:
      plan.selectedRepositories,
  };
  return {
    ...body,
    projectionSha256:
      sha256(
        Buffer.from(JSON.stringify(body)),
      ),
  };
}

function activationRepositoryNode(
  repository: C6SourceV3SimpleRepositoryRow,
): C6SourceV3SimpleRepositoryNode {
  return {
    createdAt: repository.createdAt,
    id: repository.id,
    isArchived: repository.isArchived,
    isFork: repository.isFork,
    isMirror: repository.isMirror,
    isTemplate: repository.isTemplate,
    nameWithOwner: repository.nameWithOwner,
    primaryLanguage: repository.primaryLanguage,
    pushedAt: repository.pushedAt,
    visibility: repository.visibility,
  };
}

export async function verifyC6SourceV4BoundedActivationLineage(
  rawInput: {
    activationCommitSha: string;
    authorTaskName: string;
    freezeCommitSha: string;
    repositoryRoot: string;
    reviewCommitSha: string;
    reviewerAgentName: string;
  },
): Promise<C6SourceV4BoundedActivationLineage> {
  const input = {
    activationCommitSha: sha1Schema.parse(
      rawInput.activationCommitSha,
    ),
    authorTaskName:
      nonEmptyTrimmed(rawInput.authorTaskName),
    freezeCommitSha: sha1Schema.parse(
      rawInput.freezeCommitSha,
    ),
    repositoryRoot: await realpath(
      resolve(rawInput.repositoryRoot),
    ),
    reviewCommitSha: sha1Schema.parse(
      rawInput.reviewCommitSha,
    ),
    reviewerAgentName:
      nonEmptyTrimmed(rawInput.reviewerAgentName),
  };
  if (
    input.authorTaskName ===
      input.reviewerAgentName
  ) {
    throw new Error(
      "C6 source-v4 bounded reviewer must be separate from the author",
    );
  }
  await assertRawRepositoryView(
    input.repositoryRoot,
  );
  const [
    selectionCheckpoint,
    freeze,
    review,
    activation,
  ] = await Promise.all([
    readCommitIdentity(
      input.repositoryRoot,
      C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT
        .commitSha,
      "selection checkpoint",
    ),
    readCommitIdentity(
      input.repositoryRoot,
      input.freezeCommitSha,
      "freeze",
    ),
    readCommitIdentity(
      input.repositoryRoot,
      input.reviewCommitSha,
      "review",
    ),
    readCommitIdentity(
      input.repositoryRoot,
      input.activationCommitSha,
      "activation",
    ),
  ]);
  if (
    selectionCheckpoint.treeSha !==
      C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT
        .treeSha
  ) {
    throw new Error(
      "C6 source-v4 bounded selection checkpoint tree mismatch",
    );
  }
  if (freeze.parentCommitShas.length !== 1) {
    throw new Error(
      "C6 source-v4 bounded freeze commit must have exactly one parent",
    );
  }
  if (
    review.parentCommitShas.length !== 1 ||
    review.parentCommitShas[0] !==
      freeze.commitSha
  ) {
    throw new Error(
      "C6 source-v4 bounded review commit must be the direct child of freeze",
    );
  }
  if (
    activation.parentCommitShas.length !== 1 ||
    activation.parentCommitShas[0] !==
      review.commitSha
  ) {
    throw new Error(
      "C6 source-v4 bounded activation commit must be the direct child of review",
    );
  }
  await assertUniqueReachableChild(
    input.repositoryRoot,
    review.commitSha,
    activation.commitSha,
    "C6 source-v4 bounded review commit must have one reachable activation child",
  );
  await assertStrictAncestor(
    input.repositoryRoot,
    selectionCheckpoint.commitSha,
    freeze.commitSha,
    "C6 source-v4 bounded freeze must descend from the selection checkpoint",
  );

  const [
    freezeTree,
    reviewTree,
    activationTree,
  ] = await Promise.all([
    readTree(input.repositoryRoot, freeze),
    readTree(input.repositoryRoot, review),
    readTree(input.repositoryRoot, activation),
  ]);
  for (const path of REVIEW_PATH_SET) {
    if (freezeTree.has(path)) {
      throw new Error(
        "C6 source-v4 bounded review path must be absent at freeze",
      );
    }
  }
  if (
    freezeTree.has(
      C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH,
    ) ||
    reviewTree.has(
      C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH,
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded capture bridge must be absent before activation",
    );
  }
  if (
    freezeTree.has(
      C6_SOURCE_V4_BOUNDED_ACTIVATION_RECEIPT_PATH,
    ) ||
    reviewTree.has(
      C6_SOURCE_V4_BOUNDED_ACTIVATION_RECEIPT_PATH,
    ) ||
    activationTree.has(
      C6_SOURCE_V4_BOUNDED_ACTIVATION_RECEIPT_PATH,
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded activation receipt must be absent before publication",
    );
  }
  assertExactTreeAdditions(
    freezeTree,
    reviewTree,
    REVIEW_PATH_SET,
    "C6 source-v4 bounded review commit must add exactly five review artifacts",
  );
  assertExactTreeAdditions(
    reviewTree,
    activationTree,
    new Set([
      C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH,
    ]),
    "C6 source-v4 bounded activation commit must add only the capture bridge",
  );

  const reviewedSources = await Promise.all(
    C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS.map(
      async (path) => ({
        bytes: await readRegularBlob(
          input.repositoryRoot,
          freezeTree,
          path,
          "reviewed source",
        ),
        path,
      }),
    ),
  );
  const bundle =
    buildC6SourceV4BoundedReviewBundle({
      authorTaskName: input.authorTaskName,
      freezeCandidate: {
        commitSha: freeze.commitSha,
        treeSha: freeze.treeSha,
      },
      reviewedSources,
      reviewerAgentName:
        input.reviewerAgentName,
      snapshot:
        C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY,
    });
  const reviewArtifacts = new Map<
    string,
    Buffer
  >();
  for (const path of REVIEW_PATH_SET) {
    reviewArtifacts.set(
      path,
      await readRegularBlob(
        input.repositoryRoot,
        reviewTree,
        path,
        "review artifact",
      ),
    );
  }
  const reviewEvidence =
    validateC6SourceV4BoundedReview({
      authorTaskName: input.authorTaskName,
      dispatchBytes: requiredBytes(
        reviewArtifacts,
        C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
          .dispatch,
      ).toString("utf8"),
      freezeCandidate: {
        commitSha: freeze.commitSha,
        treeSha: freeze.treeSha,
      },
      inputBytes: requiredBytes(
        reviewArtifacts,
        C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
          .input,
      ).toString("utf8"),
      provenanceBytes: requiredBytes(
        reviewArtifacts,
        C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
          .provenance,
      ),
      requestBytes: requiredBytes(
        reviewArtifacts,
        C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
          .request,
      ).toString("utf8"),
      responseBytes: requiredBytes(
        reviewArtifacts,
        C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
          .response,
      ),
      reviewedSources,
      reviewerAgentName:
        input.reviewerAgentName,
      snapshot:
        C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY,
    });
  if (
    requiredBytes(
      reviewArtifacts,
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.input,
    ).toString("utf8") !== bundle.inputBytes ||
    requiredBytes(
      reviewArtifacts,
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.request,
    ).toString("utf8") !== bundle.requestBytes ||
    requiredBytes(
      reviewArtifacts,
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.dispatch,
    ).toString("utf8") !== bundle.dispatchBytes
  ) {
    throw new Error(
      "C6 source-v4 bounded committed review bundle mismatch",
    );
  }

  const bridgeBytes = await readRegularBlob(
    input.repositoryRoot,
    activationTree,
    C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH,
    "capture bridge",
  );
  if (
    !bridgeBytes.equals(
      Buffer.from(
        C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_SOURCE,
      ),
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded capture bridge source mismatch",
    );
  }
  const bridgeEntry = activationTree.get(
    C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH,
  )!;
  return {
    boundary: {
      candidateManifestFrozen: false,
      codexRunReady: false,
      independentReviewAccepted: true,
      liveCaptureAuthorized: false,
      sourceSelectionFrozen: true,
    },
    bridge: {
      byteLength: bridgeBytes.byteLength,
      gitBlobSha1: bridgeEntry.objectId,
      mode: "100644",
      path:
        C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH,
      sha256: sha256(bridgeBytes),
    },
    lineage: {
      activation,
      freeze: {
        ...freeze,
        parentCommitSha:
          freeze.parentCommitShas[0]!,
      },
      review,
      selectionCheckpoint:
        C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT,
    },
    reviewEvidence,
  };
}

export async function runC6SourceV4BoundedActivationCli(
  args: readonly string[] =
    process.argv.slice(2),
): Promise<void> {
  const options =
    parseC6SourceV4BoundedActivationCliOptions(
      args,
    );
  const repositoryRoot = await realpath(
    RUNNING_REPOSITORY_ROOT,
  );
  const receipt =
    await buildC6SourceV4BoundedActivationReceipt({
      activationCommitSha:
        options.activationCommitSha,
      authorTaskName: options.authorTaskName,
      freezeCommitSha:
        options.freezeCommitSha,
      repositoryRoot,
      reviewCommitSha:
        options.reviewCommitSha,
      reviewerAgentName:
        options.reviewerAgentName,
      snapshotRoot:
        resolve(options.snapshotRoot),
    });
  const outputPath = resolve(
    options.outputPath,
  );
  const expectedOutputPath = join(
    repositoryRoot,
    C6_SOURCE_V4_BOUNDED_ACTIVATION_RECEIPT_PATH,
  );
  if (outputPath !== expectedOutputPath) {
    throw new Error(
      "C6 source-v4 bounded activation receipt must use the fixed publication path",
    );
  }
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 source-v4 bounded activation output parent",
  );
  const receiptBytes =
    serializeC6SourceV4BoundedActivationReceipt(
      receipt,
    );
  await writeFile(outputPath, receiptBytes, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  const published =
    await readC6StableRegularFile(
      outputPath,
      "source-v4 bounded published activation receipt",
      4 * 1_024 * 1_024,
      true,
    );
  const parsed =
    parseC6SourceV4BoundedActivationReceipt(
      published,
    );
  if (
    !isDeepStrictEqual(parsed, receipt)
  ) {
    throw new Error(
      "C6 source-v4 bounded published activation receipt changed",
    );
  }
  process.stdout.write(`${JSON.stringify({
    activationCommitSha:
      receipt.lineage.activation.commitSha,
    liveCaptureAuthorized: false,
    maxLiveCaptureCount: 1,
    outputPath,
    publicationCommitRequired: true,
    receiptSha256: sha256(published),
    captureRoot:
      receipt.captureTarget.path,
  }, null, 2)}\n`);
}

async function assertC6SourceV4BoundedCaptureWorker():
  Promise<void> {
  if (
    !isDeepStrictEqual(
      process.execArgv,
      CAPTURE_WORKER_EXEC_ARGV,
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded capture worker invocation mismatch",
    );
  }
  if (
    Object.keys(process.env).some(
      (name) =>
        !CAPTURE_WORKER_ENVIRONMENT.has(name),
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded capture worker environment mismatch",
    );
  }
  const entryPath = process.argv[1];
  if (
    entryPath === undefined ||
    await realpath(entryPath) !==
      await realpath(import.meta.path)
  ) {
    throw new Error(
      "C6 source-v4 bounded capture worker entrypoint mismatch",
    );
  }
  const bunDescriptor =
    Object.getOwnPropertyDescriptor(
      globalThis,
      "Bun",
    );
  const fetchDescriptor =
    Object.getOwnPropertyDescriptor(
      Bun,
      "fetch",
    );
  if (
    bunDescriptor === undefined ||
    bunDescriptor.value !== Bun ||
    bunDescriptor.writable !== false ||
    bunDescriptor.configurable !== false ||
    fetchDescriptor === undefined ||
    fetchDescriptor.value !== Bun.fetch ||
    fetchDescriptor.writable !== false ||
    fetchDescriptor.configurable !== false ||
    Function.prototype.toString.call(
      Bun.fetch,
    ) !==
      "function fetch() {\n    [native code]\n}"
  ) {
    throw new Error(
      "C6 source-v4 bounded capture worker native fetch mismatch",
    );
  }
  await assertActivationRuntime();
}

async function runC6SourceV4BoundedCaptureCli(
  args: readonly string[] =
    process.argv.slice(2),
): Promise<void> {
  const options =
    parseC6SourceV4BoundedCaptureCliOptions(
      args,
    );
  const repositoryRoot =
    await realpath(
      RUNNING_REPOSITORY_ROOT,
    );
  if (options.mode === "finalize-only") {
    const evidence =
      await finalizeC6SourceV4BoundedCapture({
        captureRoot: resolve(
          options.captureRoot,
        ),
        publicationCommitSha:
          options.publicationCommitSha,
        repositoryRoot,
        snapshotRoot: resolve(
          options.snapshotRoot,
        ),
      });
    process.stdout.write(
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    return;
  }
  const authorization =
    await verifyC6SourceV4BoundedActivationReceipt({
      publicationCommitSha:
        options.publicationCommitSha,
      repositoryRoot,
      snapshotRoot: resolve(
        options.snapshotRoot,
      ),
    });
  const result =
    await runC6SourceV4BoundedAuthorizedCapture({
      authorization,
      captureRoot: resolve(
        options.captureRoot,
      ),
    });
  process.stdout.write(
    `${JSON.stringify(result, null, 2)}\n`,
  );
}

if (import.meta.main) {
  await assertC6SourceV4BoundedCaptureWorker()
    .then(() =>
      runC6SourceV4BoundedCaptureCli()
    )
    .catch((error: unknown) => {
      const message = error instanceof Error
        ? error.message
        : "unknown C6 source-v4 bounded capture error";
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}

function receiptLineage(
  lineage: C6SourceV4BoundedActivationLineage,
): C6SourceV4BoundedActivationReceipt["lineage"] {
  return {
    activation: {
      commitSha:
        lineage.lineage.activation.commitSha,
      parentCommitSha:
        lineage.lineage.activation
          .parentCommitShas[0]!,
      treeSha:
        lineage.lineage.activation.treeSha,
    },
    freeze: {
      commitSha:
        lineage.lineage.freeze.commitSha,
      parentCommitSha:
        lineage.lineage.freeze.parentCommitSha,
      treeSha:
        lineage.lineage.freeze.treeSha,
    },
    review: {
      commitSha:
        lineage.lineage.review.commitSha,
      parentCommitSha:
        lineage.lineage.review
          .parentCommitShas[0]!,
      treeSha:
        lineage.lineage.review.treeSha,
    },
    selectionCheckpoint:
      C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT,
  };
}

function projectReviewEvidence(
  lineage: C6SourceV4BoundedActivationLineage,
): C6SourceV4BoundedActivationReceipt[
  "reviewEvidence"
] {
  return {
    cryptographicReviewIndependence:
      lineage.reviewEvidence
        .cryptographicReviewIndependence,
    dispatchSha256:
      lineage.reviewEvidence.dispatchSha256,
    inputSha256:
      lineage.reviewEvidence.inputSha256,
    provenanceSha256:
      lineage.reviewEvidence.provenanceSha256,
    requestSha256:
      lineage.reviewEvidence.requestSha256,
    responseSha256:
      lineage.reviewEvidence.responseSha256,
    reviewReceiptStructureVerified:
      lineage.reviewEvidence
        .reviewReceiptStructureVerified,
  };
}

function assertCaptureAuthorization(
  authorization:
    C6SourceV4BoundedCaptureAuthorization,
): void {
  if (
    !VERIFIED_CAPTURE_AUTHORIZATIONS.has(
      authorization,
    ) ||
    authorization[
      VERIFIED_CAPTURE_AUTHORIZATION
    ] !== true ||
    !Object.isFrozen(authorization) ||
    !Object.isFrozen(
      authorization.receipt,
    ) ||
    !isDeepStrictEqual(
      authorization.boundary,
      {
        candidateManifestFrozen: false,
        codexRunReady: false,
        independentReviewAccepted: true,
        liveCaptureAuthorized: true,
        maxLiveCaptureCount: 1,
        sourceSelectionFrozen: true,
      },
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded capture requires verified one-shot authority",
    );
  }
}

async function assertC6SourceV4BoundedAuthorizationState(
  input: {
    captureTargetPath: string;
    publicationCommitSha: string;
    receiptSha256: string;
    repositoryRoot: string;
  },
): Promise<void> {
  const publication =
    await loadC6SourceV4BoundedActivationPublication(
      input.repositoryRoot,
      input.publicationCommitSha,
    );
  const receipt =
    parseC6SourceV4BoundedActivationReceipt(
      publication.receiptBytes,
    );
  if (
    sha256(publication.receiptBytes) !==
      input.receiptSha256
  ) {
    throw new Error(
      "C6 source-v4 bounded authorization receipt changed before claim",
    );
  }
  const lineage =
    await verifyC6SourceV4BoundedActivationLineage({
      activationCommitSha:
        receipt.lineage.activation.commitSha,
      authorTaskName:
        receipt.authorTaskName,
      freezeCommitSha:
        receipt.lineage.freeze.commitSha,
      repositoryRoot:
        input.repositoryRoot,
      reviewCommitSha:
        receipt.lineage.review.commitSha,
      reviewerAgentName:
        receipt.reviewerAgentName,
    });
  await assertCleanRepositoryWorktree(
    input.repositoryRoot,
  );
  await assertFrozenClosureAtHead(
    input.repositoryRoot,
    lineage,
    publication.publication,
  );
  const target =
    await loadAvailableCaptureTarget(
      input.repositoryRoot,
    );
  if (
    target.path !== input.captureTargetPath ||
    receipt.captureTarget.path !==
      input.captureTargetPath
  ) {
    throw new Error(
      "C6 source-v4 bounded authorization capture target changed before claim",
    );
  }
}

async function inspectC6SourceV4BoundedCaptureState(
  captureRoot: string,
  expectedReceiptBytes: Uint8Array,
  expectedPublicationCommitSha: string,
  snapshot:
    LoadedC6SourceV4BoundedSnapshot,
) {
  if (!(await pathExists(captureRoot))) {
    return {
      assetRootSha256: null,
      status: "unconsumed" as const,
    };
  }
  const receiptBytes =
    await readC6StableRegularFile(
      join(
        captureRoot,
        "activation-receipt.json",
      ),
      "C6 source-v4 bounded captured activation receipt",
      4 * 1_024 * 1_024,
      true,
    );
  if (
    !receiptBytes.equals(
      Buffer.from(expectedReceiptBytes),
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded captured activation receipt mismatch",
    );
  }
  await loadC6SourceV4BoundedCaptureClaim({
    captureRoot,
    expectedPublicationCommitSha,
    expectedReceiptBytes,
  });
  if (
    !(await pathExists(
      join(captureRoot, "asset-lock.json"),
    ))
  ) {
    return {
      assetRootSha256: null,
      status: "claimed-unsealed" as const,
    };
  }
  const terminal =
    await loadC6SourceV4BoundedCaptureTerminal({
      captureRoot,
      expectedPublicationCommitSha,
      expectedReceiptBytes,
      snapshot,
    });
  const assetLock =
    await loadC6AssetLock(captureRoot);
  await verifyC6AssetClosure(
    captureRoot,
    assetLock,
  );
  return {
    assetRootSha256:
      assetLock.assetLock.assetRootSha256,
    status:
      terminal.artifactKind ===
        "c6-source-v4-bounded-capture-terminal"
      ? "claimed-sealed-success" as const
      : "claimed-sealed-failure" as const,
  };
}

async function loadC6SourceV4BoundedCaptureClaim(
  input: {
    captureRoot: string;
    expectedPublicationCommitSha: string;
    expectedReceiptBytes: Uint8Array;
  },
) {
  const bytes =
    await readC6StableRegularFile(
      join(
        input.captureRoot,
        "capture-claim.json",
      ),
      "source-v4 bounded capture claim",
      4 * 1_024 * 1_024,
      true,
    );
  const text = exactUtf8(
    bytes,
    "capture claim",
  ).text;
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 source-v4 bounded capture claim is not JSON",
    );
  }
  const parsed = captureClaimSchema.safeParse(
    raw,
  );
  if (
    !parsed.success ||
    text !== canonicalJson(raw)
  ) {
    throw new Error(
      "C6 source-v4 bounded capture claim schema mismatch",
    );
  }
  const receipt =
    parseC6SourceV4BoundedActivationReceipt(
      input.expectedReceiptBytes,
    );
  if (
    parsed.data.activationCommitSha !==
      receipt.lineage.activation.commitSha ||
    parsed.data.evaluationId !==
      receipt.evaluationId ||
    parsed.data.publicationCommitSha !==
      input.expectedPublicationCommitSha ||
    parsed.data.receiptSha256 !==
      sha256(input.expectedReceiptBytes) ||
    !isDeepStrictEqual(
      parsed.data.snapshot,
      receipt.snapshot,
    ) ||
    parsed.data.startedAt <
      receipt.generatedAt
  ) {
    throw new Error(
      "C6 source-v4 bounded capture claim lineage mismatch",
    );
  }
  return parsed.data;
}

async function finalizeC6SourceV4BoundedCaptureRoot(
  input: {
    captureRoot: string;
    expectedPublicationCommitSha: string;
    expectedReceiptBytes: Uint8Array;
    snapshot:
      LoadedC6SourceV4BoundedSnapshot;
  },
) {
  await loadC6SourceV4BoundedCaptureTerminal(
    input,
  );
  if (
    await pathExists(
      join(input.captureRoot, "asset-lock.json"),
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded finalize-only found an existing invalid asset lock",
    );
  }
  const assetLock =
    await buildC6AssetLock(input.captureRoot);
  const assetLockArtifact =
    await commitC6SourceV3SimpleCreateOnlyBytes(
      input.captureRoot,
      "asset-lock.json",
      Buffer.from(
        serializeC6AssetLock(assetLock),
      ),
    );
  const loadedAssetLock =
    await loadC6AssetLock(input.captureRoot);
  await verifyC6AssetClosure(
    input.captureRoot,
    loadedAssetLock,
  );
  return {
    assetLock: assetLockArtifact,
    assetRootSha256:
      loadedAssetLock.assetLock
        .assetRootSha256,
  };
}

async function loadC6SourceV4BoundedCaptureTerminal(
  input: {
    captureRoot: string;
    expectedPublicationCommitSha: string;
    expectedReceiptBytes: Uint8Array;
    snapshot:
      LoadedC6SourceV4BoundedSnapshot;
  },
) {
  const successTerminalPath = join(
    input.captureRoot,
    "capture-terminal.json",
  );
  const failureTerminalPath = join(
    input.captureRoot,
    "capture-failure-terminal.json",
  );
  const [
    successTerminalExists,
    failureTerminalExists,
  ] = await Promise.all([
    pathExists(successTerminalPath),
    pathExists(failureTerminalPath),
  ]);
  if (
    successTerminalExists ===
      failureTerminalExists
  ) {
    throw new Error(
      "C6 source-v4 bounded capture must have exactly one success or failure terminal before finalization",
    );
  }
  const terminalBytes =
    await readC6StableRegularFile(
      successTerminalExists
        ? successTerminalPath
        : failureTerminalPath,
      "C6 source-v4 bounded capture terminal",
      4 * 1_024 * 1_024,
      true,
    );
  const terminal =
    parseCanonicalCaptureTerminal({
      bytes: terminalBytes,
      kind: successTerminalExists
        ? "success"
        : "failure",
    });
  if (
    terminal.receiptSha256 !==
      sha256(input.expectedReceiptBytes) ||
    (
      terminal.artifactKind ===
        "c6-source-v4-bounded-capture-failure-terminal" &&
      terminal.publicationCommitSha !==
        input.expectedPublicationCommitSha
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded capture terminal lineage mismatch",
    );
  }
  if (
    terminal.artifactKind ===
      "c6-source-v4-bounded-capture-terminal"
  ) {
    await verifyC6SourceV4BoundedNormalizedCapture({
      captureRoot: input.captureRoot,
      reference: terminal.normalizedCapture,
      receiptSha256:
        terminal.receiptSha256,
      snapshot: input.snapshot,
      terminalFinalLogicalRequestCompletionSha256:
        terminal.finalLogicalRequestCompletionSha256,
      terminalLogicalRequestCount:
        terminal.logicalRequestCount,
      terminalProjectionSha256:
        terminal.projectionSha256,
    });
  }
  return terminal;
}

function parseCanonicalCaptureTerminal(
  input: {
    bytes: Uint8Array;
    kind: "failure" | "success";
  },
) {
  const text = exactUtf8(
    input.bytes,
    "capture terminal",
  ).text;
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 source-v4 bounded capture terminal is not JSON",
    );
  }
  if (
    text !== canonicalJson(raw) ||
    raw === null ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    throw new Error(
      "C6 source-v4 bounded capture terminal is not canonical",
    );
  }
  const parsed = (
    input.kind === "success"
      ? captureSuccessTerminalSchema
      : captureFailureTerminalSchema
  ).safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `C6 source-v4 bounded capture ${input.kind} terminal schema mismatch`,
    );
  }
  return parsed.data;
}

async function verifyC6SourceV4BoundedNormalizedCapture(
  input: {
    captureRoot: string;
    reference: z.infer<
      typeof artifactReferenceSchema
    >;
    receiptSha256: string;
    snapshot:
      LoadedC6SourceV4BoundedSnapshot;
    terminalFinalLogicalRequestCompletionSha256:
      string;
    terminalLogicalRequestCount: number;
    terminalProjectionSha256: string;
  },
): Promise<void> {
  const bytes = await readC6StableRegularFile(
    join(
      input.captureRoot,
      input.reference.path,
    ),
    "source-v4 bounded normalized capture",
    undefined,
    true,
  );
  if (
    bytes.byteLength !==
      input.reference.bytes ||
    sha256(bytes) !== input.reference.sha256
  ) {
    throw new Error(
      "C6 source-v4 bounded normalized capture reference mismatch",
    );
  }
  const text = exactUtf8(
    bytes,
    "normalized capture",
  ).text;
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 source-v4 bounded normalized capture is not JSON",
    );
  }
  const schema = z.object({
    artifactKind: z.literal(
      "c6-source-v4-bounded-normalized-capture",
    ),
    identity: z.unknown(),
    logicalRequestCount: z.literal(
      input.terminalLogicalRequestCount,
    ),
    metadataDecisions: z.array(
      z.unknown(),
    ),
    pullRequestClosures: z.array(
      z.object({
        canonicalRepository:
          z.string().min(1),
        enumeratedInWindowCount:
          z.number().int().nonnegative(),
        pageCount:
          z.number().int().positive(),
        repositoryNodeId:
          z.string().min(1),
        skippedAboveUpperBoundCount:
          z.number().int().nonnegative(),
        terminalReason: z.enum([
          "connection-exhausted",
          "strictly-older-createdAt-witness",
        ]),
        totalMergedPullRequestCount:
          z.number().int().nonnegative(),
      }).strict(),
    ).length(
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
        .selectedRepositoryCount,
    ),
    pullRequests: z.array(z.unknown()),
    schemaVersion: z.literal(1),
    selectedRepositories: z.array(
      z.unknown(),
    ).length(
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
        .selectedRepositoryCount,
    ),
    projectionSha256: z.literal(
      input.terminalProjectionSha256,
    ),
  }).strict();
  const parsed = schema.safeParse(raw);
  if (
    !parsed.success ||
    text !== canonicalJson(raw)
  ) {
    throw new Error(
      "C6 source-v4 bounded normalized capture schema mismatch",
    );
  }
  const plan =
    buildC6SourceV4BoundedCapturePlan(
      input.snapshot,
    );
  if (
    !isDeepStrictEqual(
      parsed.data.identity,
      plan.identity,
    ) ||
    !isDeepStrictEqual(
      parsed.data.selectedRepositories,
      plan.selectedRepositories,
    ) ||
    parsed.data.metadataDecisions.length !==
      parsed.data.pullRequests.length ||
    parsed.data.pullRequestClosures.reduce(
      (sum, closure) =>
        sum + closure.pageCount,
      0,
    ) !==
      parsed.data.logicalRequestCount
  ) {
    throw new Error(
      "C6 source-v4 bounded normalized capture closure mismatch",
    );
  }
  for (
    const [
      index,
      closure,
    ] of
      parsed.data.pullRequestClosures
        .entries()
  ) {
    const repository =
      plan.selectedRepositories[index]!;
    if (
      closure.repositoryNodeId !==
        repository.repositoryNodeId ||
      closure.canonicalRepository !==
        repository.nameWithOwner.toLowerCase()
    ) {
      throw new Error(
        "C6 source-v4 bounded normalized capture repository closure mismatch",
      );
    }
  }
  let ledger: Awaited<
    ReturnType<
      typeof scanC6SourceV4BoundedV3CommittedRequests
    >
  >;
  let replayed: Awaited<
    ReturnType<
      typeof replayC6SourceV4BoundedCapture
    >
  >;
  try {
    ledger =
      await scanC6SourceV4BoundedV3CommittedRequests({
        evaluationId:
          C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
        executionContractSha256:
          C6_SOURCE_V4_BOUNDED_CONTRACT_SHA256,
        frozenInputClosureSha256:
          C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY
            .assetRootSha256,
        passRoot: join(
          input.captureRoot,
          "pass-A",
        ),
        requireCompletePass: true,
        runtimeAuthorizationSha256:
          input.receiptSha256,
      });
    replayed =
      await replayC6SourceV4BoundedCapture({
        requests: ledger.projectedRequests,
        snapshot: input.snapshot,
      });
  } catch (cause) {
    throw new Error(
      "C6 source-v4 bounded success durable ledger replay mismatch",
      { cause },
    );
  }
  if (
    ledger.projectedRequests.length !==
      input.terminalLogicalRequestCount ||
    ledger.finalLogicalRequestCompletionSha256 !==
      input
        .terminalFinalLogicalRequestCompletionSha256 ||
    !isDeepStrictEqual(
      replayed,
      parsed.data,
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded success durable ledger closure mismatch",
    );
  }
  const {
    projectionSha256,
    ...projectionBody
  } = parsed.data;
  if (
    sha256(
      Buffer.from(
        JSON.stringify(projectionBody),
      ),
    ) !== projectionSha256
  ) {
    throw new Error(
      "C6 source-v4 bounded normalized capture projection mismatch",
    );
  }
}

async function loadCaptureTarget(
  repositoryRoot: string,
): Promise<
  C6SourceV4BoundedActivationReceipt[
    "captureTarget"
  ]
> {
  const path =
    resolveC6SourceV4BoundedCaptureRoot(
      repositoryRoot,
    );
  await assertC6NoSymlinkPathComponents(
    dirname(path),
    "C6 source-v4 bounded capture parent",
  );
  return {
    path,
    scope:
      "host-local-activated-repository-root",
  };
}

async function loadAvailableCaptureTarget(
  repositoryRoot: string,
): Promise<
  C6SourceV4BoundedActivationReceipt[
    "captureTarget"
  ]
> {
  const target =
    await loadCaptureTarget(repositoryRoot);
  if (await pathExists(target.path)) {
    throw new Error(
      "C6 source-v4 bounded host-local capture target already exists",
    );
  }
  return target;
}

async function assertCleanRepositoryWorktree(
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
      "C6 source-v4 bounded activation requires a clean repository worktree",
    );
  }
}

async function assertActivationRuntime(): Promise<
  C6SourceV4BoundedActivationReceipt["runtime"]
> {
  const executable = await realpath(
    process.execPath,
  );
  const executableSha256 = sha256(
    await readC6StableRegularFile(
      executable,
      "source-v4 bounded activation Bun executable",
    ),
  );
  const runtime = {
    arch: process.arch,
    bunExecutableSha256: executableSha256,
    bunRevision: Bun.revision,
    bunVersion: Bun.version,
    nodeVersion: process.versions.node,
    platform: process.platform,
  };
  try {
    return activationReceiptSchema.shape.runtime.parse(
      runtime,
    );
  } catch {
    throw new Error(
      "C6 source-v4 bounded activation requires the exact pinned runtime",
    );
  }
}

async function loadCanonicalActivationSnapshot(
  snapshotRoot: string,
): Promise<LoadedC6SourceV4BoundedSnapshot> {
  const root = await realpath(
    resolve(snapshotRoot),
  );
  const snapshot =
    await loadC6SourceV4BoundedSnapshot(root);
  assertC6SourceV4BoundedSnapshotVerified(
    snapshot,
  );
  const [assetLockBytes, manifestBytes] =
    await Promise.all([
      readC6StableRegularFile(
        join(root, "asset-lock.json"),
        "source-v4 bounded activation asset lock",
      ),
      readC6StableRegularFile(
        join(root, "snapshot-manifest.json"),
        "source-v4 bounded activation manifest",
      ),
    ]);
  const expected =
    C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY;
  if (
    snapshot.assetBytes !==
      expected.assetBytes ||
    snapshot.assetLock.assetLockSha256 !==
      expected.assetLock.sha256 ||
    snapshot.assetLock.assetLock
        .assetRootSha256 !==
      expected.assetRootSha256 ||
    snapshot.selectionReceipt.receipt
        .selectedRepositoriesSha256 !==
      expected.selectedRepositoriesSha256 ||
    snapshot.selectionReceipt.receipt
        .selectedRepositories.length !==
      expected.selectedRepositoryCount ||
    assetLockBytes.byteLength !==
      expected.assetLock.byteLength ||
    sha256(assetLockBytes) !==
      expected.assetLock.sha256 ||
    manifestBytes.byteLength !==
      expected.manifest.byteLength ||
    sha256(manifestBytes) !==
      expected.manifest.sha256
  ) {
    throw new Error(
      "C6 source-v4 bounded activation snapshot identity mismatch",
    );
  }
  return snapshot;
}

async function runActivationLiveness() {
  const report =
    await runC6BunFsLivenessStress({
      bunExecutable:
        await realpath(process.execPath),
      concurrency:
        ACTIVATION_LIVENESS.concurrency,
      expectedArch: "arm64",
      expectedBunExecutableSha256:
        ACTIVATION_LIVENESS
          .bunExecutableSha256,
      expectedBunRevision:
        ACTIVATION_LIVENESS.bunRevision,
      expectedBunVersion:
        ACTIVATION_LIVENESS.bunVersion,
      expectedPlatform: "darwin",
      expectedScriptSha256:
        ACTIVATION_LIVENESS.scriptSha256,
      seeds: ACTIVATION_LIVENESS.seeds,
      timeoutMsPerSeed:
        ACTIVATION_LIVENESS.timeoutMsPerSeed,
      workItemsPerSeed:
        ACTIVATION_LIVENESS.workItemsPerSeed,
    });
  assertC6SourceV4BoundedActivationLivenessReport(
    report,
  );
  return report;
}

async function assertFrozenClosureAtHead(
  repositoryRoot: string,
  lineage: C6SourceV4BoundedActivationLineage,
  publication: CommitIdentity,
): Promise<void> {
  const headCommitSha =
    await readHead(repositoryRoot);
  await assertAncestorOrEqual(
    repositoryRoot,
    publication.commitSha,
    headCommitSha,
    "C6 source-v4 bounded activation publication must remain an ancestor of HEAD",
  );
  const [
    activationTree,
    publicationTree,
    headTree,
  ] =
    await Promise.all([
      readTree(
        repositoryRoot,
        lineage.lineage.activation,
      ),
      readTree(
        repositoryRoot,
        publication,
      ),
      readTree(
        repositoryRoot,
        await readCommitIdentity(
          repositoryRoot,
          headCommitSha,
          "current HEAD",
        ),
      ),
    ]);
  const frozenPaths = [
    ...C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS,
    ...REVIEW_PATH_SET,
    C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH,
  ];
  for (const path of frozenPaths) {
    const atActivation =
      activationTree.get(path);
    const atHead = headTree.get(path);
    if (
      atActivation === undefined ||
      atHead === undefined ||
      atActivation.mode !== atHead.mode ||
      atActivation.type !== atHead.type ||
      atActivation.objectId !==
        atHead.objectId
    ) {
      throw new Error(
        `C6 source-v4 bounded frozen activation path changed at HEAD: ${path}`,
      );
    }
  }
  const publishedReceipt =
    publicationTree.get(
      C6_SOURCE_V4_BOUNDED_ACTIVATION_RECEIPT_PATH,
    );
  const headReceipt =
    headTree.get(
      C6_SOURCE_V4_BOUNDED_ACTIVATION_RECEIPT_PATH,
    );
  if (
    publishedReceipt === undefined ||
    headReceipt === undefined ||
    publishedReceipt.mode !==
      headReceipt.mode ||
    publishedReceipt.type !==
      headReceipt.type ||
    publishedReceipt.objectId !==
      headReceipt.objectId
  ) {
    throw new Error(
      "C6 source-v4 bounded published activation receipt changed at HEAD",
    );
  }
}

async function readHead(
  repositoryRoot: string,
): Promise<string> {
  await assertRawRepositoryView(
    repositoryRoot,
  );
  return sha1Schema.parse(
    await gitText(
      repositoryRoot,
      ["rev-parse", "HEAD"],
    ),
  );
}

function assertExactTreeAdditions(
  before: ReadonlyMap<string, GitTreeEntry>,
  after: ReadonlyMap<string, GitTreeEntry>,
  expectedAddedPaths: ReadonlySet<string>,
  message: string,
): void {
  const changed = new Set<string>();
  for (const [path, entry] of before) {
    const next = after.get(path);
    if (
      next === undefined ||
      next.mode !== entry.mode ||
      next.type !== entry.type ||
      next.objectId !== entry.objectId
    ) {
      changed.add(path);
    }
  }
  for (const path of after.keys()) {
    if (!before.has(path)) {
      changed.add(path);
    }
  }
  if (
    changed.size !== expectedAddedPaths.size ||
    [...changed].some(
      (path) =>
        !expectedAddedPaths.has(path) ||
        before.has(path),
    )
  ) {
    throw new Error(message);
  }
  for (const path of expectedAddedPaths) {
    const entry = after.get(path);
    if (
      entry === undefined ||
      entry.mode !== "100644" ||
      entry.type !== "blob"
    ) {
      throw new Error(message);
    }
  }
}

async function assertRawRepositoryView(
  repositoryRoot: string,
): Promise<void> {
  const inside = await gitText(
    repositoryRoot,
    ["rev-parse", "--is-inside-work-tree"],
  );
  if (inside !== "true") {
    throw new Error(
      "C6 source-v4 bounded activation requires a Git worktree",
    );
  }
  await realpath(
    await gitText(
      repositoryRoot,
      [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ],
    ),
  );
  const forbiddenPaths = await Promise.all([
    gitText(
      repositoryRoot,
      [
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "info/grafts",
      ],
    ),
    gitText(
      repositoryRoot,
      [
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "objects/info/alternates",
      ],
    ),
  ]);
  for (const path of forbiddenPaths) {
    if (await pathExists(path)) {
      throw new Error(
        "C6 source-v4 bounded activation rejects grafts and alternate object stores",
      );
    }
  }
  if (
    (await gitText(
      repositoryRoot,
      ["for-each-ref", "--format=%(refname)", "refs/replace"],
    )).length > 0
  ) {
    throw new Error(
      "C6 source-v4 bounded activation rejects replace refs",
    );
  }
}

async function readCommitIdentity(
  repositoryRoot: string,
  commitSha: string,
  label: string,
): Promise<CommitIdentity> {
  let bytes: Buffer;
  try {
    bytes = await gitBuffer(
      repositoryRoot,
      ["cat-file", "commit", commitSha],
    );
  } catch {
    throw new Error(
      `C6 source-v4 bounded ${label} SHA is not a commit`,
    );
  }
  const headerEnd = bytes.indexOf("\n\n");
  if (headerEnd < 0) {
    throw new Error(
      `C6 source-v4 bounded ${label} commit has no header terminator`,
    );
  }
  const lines = bytes
    .subarray(0, headerEnd)
    .toString("utf8")
    .split("\n");
  const trees = lines.filter(
    (line) => line.startsWith("tree "),
  );
  if (trees.length !== 1) {
    throw new Error(
      `C6 source-v4 bounded ${label} commit tree mismatch`,
    );
  }
  return {
    commitSha: sha1Schema.parse(commitSha),
    parentCommitShas: lines
      .filter(
        (line) => line.startsWith("parent "),
      )
      .map(
        (line) =>
          sha1Schema.parse(
            line.slice("parent ".length),
          ),
      ),
    treeSha: sha1Schema.parse(
      trees[0]!.slice("tree ".length),
    ),
  };
}

async function readTree(
  repositoryRoot: string,
  commit: CommitIdentity,
): Promise<Map<string, GitTreeEntry>> {
  const bytes = await gitBuffer(
    repositoryRoot,
    [
      "ls-tree",
      "-rz",
      "--full-tree",
      commit.commitSha,
    ],
  );
  const entries = new Map<string, GitTreeEntry>();
  for (
    const record of bytes
      .toString("utf8")
      .split("\0")
  ) {
    if (record.length === 0) {
      continue;
    }
    const match =
      /^([0-7]{6}) ([a-z]+) ([a-f0-9]{40})\t(.+)$/u
        .exec(record);
    if (match === null) {
      throw new Error(
        "C6 source-v4 bounded Git tree record is malformed",
      );
    }
    const [, mode, type, objectId, path] = match;
    if (entries.has(path!)) {
      throw new Error(
        "C6 source-v4 bounded Git tree path is duplicated",
      );
    }
    entries.set(path!, {
      mode: mode!,
      objectId: objectId!,
      path: path!,
      type: type!,
    });
  }
  return entries;
}

async function readRegularBlob(
  repositoryRoot: string,
  tree: ReadonlyMap<string, GitTreeEntry>,
  path: string,
  label: string,
): Promise<Buffer> {
  const entry = tree.get(path);
  if (
    entry === undefined ||
    entry.mode !== "100644" ||
    entry.type !== "blob"
  ) {
    throw new Error(
      `C6 source-v4 bounded ${label} is not one regular frozen blob: ${path}`,
    );
  }
  return await gitBuffer(
    repositoryRoot,
    ["cat-file", "blob", entry.objectId],
  );
}

async function assertStrictAncestor(
  repositoryRoot: string,
  ancestor: string,
  descendant: string,
  message: string,
): Promise<void> {
  if (ancestor === descendant) {
    throw new Error(message);
  }
  try {
    await gitBuffer(
      repositoryRoot,
      [
        "merge-base",
        "--is-ancestor",
        ancestor,
        descendant,
      ],
    );
  } catch {
    throw new Error(message);
  }
}

async function assertUniqueReachableChild(
  repositoryRoot: string,
  parentCommitSha: string,
  childCommitSha: string,
  message: string,
): Promise<void> {
  const lines = (
    await gitBuffer(
      repositoryRoot,
      [
        "rev-list",
        "--children",
        "--all",
        "HEAD",
      ],
    )
  ).toString("utf8").trim().split("\n");
  const reviewLine = lines.find(
    (line) =>
      line === parentCommitSha ||
      line.startsWith(
        `${parentCommitSha} `,
      ),
  );
  const children = reviewLine
    ?.split(" ")
    .slice(1) ?? [];
  if (
    children.length !== 1 ||
    children[0] !== childCommitSha
  ) {
    throw new Error(message);
  }
}

async function assertAncestorOrEqual(
  repositoryRoot: string,
  ancestor: string,
  descendant: string,
  message: string,
): Promise<void> {
  if (ancestor === descendant) {
    return;
  }
  try {
    await gitBuffer(
      repositoryRoot,
      [
        "merge-base",
        "--is-ancestor",
        ancestor,
        descendant,
      ],
    );
  } catch {
    throw new Error(message);
  }
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

async function pathExists(
  path: string,
): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

function requiredBytes(
  artifacts: ReadonlyMap<string, Buffer>,
  path: string,
): Buffer {
  const bytes = artifacts.get(path);
  if (bytes === undefined) {
    throw new Error(
      `C6 source-v4 bounded missing review artifact ${path}`,
    );
  }
  return bytes;
}

function deepFreeze<T>(value: T): T {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }
  for (
    const child of Object.values(
      value as Record<string, unknown>,
    )
  ) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function parseCliValues(
  args: readonly string[],
  valueOptions: ReadonlySet<string>,
  flagOptions: ReadonlySet<string>,
  label: string,
): Map<string, string> {
  const values = new Map<string, string>();
  for (const argument of args) {
    const flagMatch = /^--([^=]+)$/u.exec(
      argument,
    );
    if (
      flagMatch !== null &&
      flagOptions.has(flagMatch[1]!)
    ) {
      const name = flagMatch[1]!;
      if (values.has(name)) {
        throw new Error(
          `--${name} cannot be specified more than once`,
        );
      }
      values.set(name, "true");
      continue;
    }
    const valueMatch =
      /^--([^=]+)=(.*)$/u.exec(argument);
    if (
      valueMatch === null ||
      !valueOptions.has(valueMatch[1]!)
    ) {
      throw new Error(
        `unknown C6 source-v4 bounded ${label} option ${argument}`,
      );
    }
    const [, name, value] = valueMatch;
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
  return values;
}

function requiredCliValue(
  values: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function nonEmptyTrimmed(
  value: string,
): string {
  if (
    value.length === 0 ||
    value.trim() !== value
  ) {
    throw new Error(
      "C6 source-v4 bounded identity is empty or padded",
    );
  }
  return value;
}

async function loadGithubToken():
  Promise<Buffer> {
  const environmentToken =
    process.env.GOODMEMORY_C6_GITHUB_TOKEN;
  delete process.env
    .GOODMEMORY_C6_GITHUB_TOKEN;
  if (environmentToken !== undefined) {
    return tokenBytes(environmentToken);
  }
  throw new Error(
    "GOODMEMORY_C6_GITHUB_TOKEN is required for the one live capture",
  );
}

function tokenBytes(value: string): Buffer {
  if (
    value.length === 0 ||
    /[\u0000-\u0020\u007f]/u.test(value)
  ) {
    throw new Error(
      "C6 source-v4 bounded GitHub authorization token is invalid",
    );
  }
  return Buffer.from(value);
}

function exactUtf8(
  input: string | Uint8Array,
  label: string,
): { bytes: Buffer; text: string } {
  const bytes = typeof input === "string"
    ? Buffer.from(input)
    : Buffer.from(input);
  let text: string;
  try {
    text = new TextDecoder(
      "utf-8",
      { fatal: true },
    ).decode(bytes);
  } catch {
    throw new Error(
      `C6 source-v4 bounded ${label} is not valid UTF-8`,
    );
  }
  if (!Buffer.from(text).equals(bytes)) {
    throw new Error(
      `C6 source-v4 bounded ${label} is not exact UTF-8`,
    );
  }
  return { bytes, text };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}
