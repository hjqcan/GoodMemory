import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  realpath,
} from "node:fs/promises";
import {
  dirname,
  join,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
  isDeepStrictEqual,
  promisify,
} from "node:util";

import { z } from "zod";

import {
  readC6StableRegularFile,
} from "./c6-asset-lock";
import {
  captureC6SourceV3SimpleCensusRuntimeSource,
  parseC6SourceV3SimpleCensusRuntimeSourceManifest,
} from "./c6-source-v3-simple-census-runtime-source";

const execFileAsync = promisify(execFile);
const EVALUATION_ID =
  "goodmemory-c6-codex-coding-effect-source-v3-simple-v1";
export const C6_SOURCE_V3_SIMPLE_CENSUS_RUNNING_REPOSITORY_ROOT =
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
const RUNTIME_ROOT =
  "fixtures/codex-coding-effect/c6-source-pool/" +
  "provenance/source-v3-simple/census-runtime";
const EXECUTION_CONTRACT_PATH =
  "fixtures/codex-coding-effect/c6-source-pool/" +
  "provenance/source-v3-simple/" +
  "census-execution-contract-v1.json";
const PROMOTION_RECEIPT_PATH =
  "fixtures/codex-coding-effect/c6-source-pool/" +
  "provenance/source-v3-simple/promotion/" +
  "promotion-receipt-v1.json";
export const C6_SOURCE_V3_SIMPLE_CENSUS_RUNTIME_MANIFEST_PATH =
  `${RUNTIME_ROOT}/runtime-source-manifest-v1.json`;
export const C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH =
  `${RUNTIME_ROOT}/activation-receipt-v1.json`;
export const C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_PATH =
  "scripts/run-codex-coding-effect-c6-source-v3-simple-census.ts";
export const C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_SOURCE =
  `#!/usr/bin/env bun

import {
  runC6SourceV3SimpleCensusCli,
} from "./codex-coding-effect/c6-source-v3-simple-census-cli";

await runC6SourceV3SimpleCensusCli().catch((error: unknown) => {
  const message = error instanceof Error
    ? error.message
    : "unknown C6 census error";
  process.stderr.write(\`\${message}\\n\`);
  process.exitCode = 1;
});
`;
const REVIEW_PATHS = {
  dispatch: `${RUNTIME_ROOT}/review/dispatch.json`,
  input: `${RUNTIME_ROOT}/review/input.json`,
  provenance: `${RUNTIME_ROOT}/review/provenance.json`,
  request: `${RUNTIME_ROOT}/review/request.json`,
  response: `${RUNTIME_ROOT}/review/response.json`,
} as const;
export const C6_SOURCE_V3_SIMPLE_CENSUS_REQUIRED_REVIEW_CHECKS = [
  "runtime-source-manifest-exact-files-bytes-sha256-and-100644-modes",
  "freeze-review-activation-direct-child-topology-and-exact-added-paths",
  "activation-boundary-receipt-and-review-provenance-bindings",
  "runner-preflight-resume-timeout-secret-and-publication-state-machine",
] as const;
export const C6_SOURCE_V3_SIMPLE_CENSUS_REQUIRED_REVIEW_COMMANDS = [
  "bun run typecheck",
  "bun test tests/unit/codex-coding-effect.c6-source-v3-simple-*.test.ts",
] as const;

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
const gitCommitIdentitySchema = z.object({
  commitSha: sha1Schema,
  parentCommitSha: sha1Schema,
  treeSha: sha1Schema,
}).strict();
const runtimeAuthorityBoundarySchema = z.object({
  acceptedEpisodeCount: z.literal(0),
  candidateManifestFrozen: z.literal(false),
  candidateSelectionPermitted: z.literal(false),
  codexRunReady: z.literal(false),
  formalCensusLiveNetworkPermitted:
    z.literal(true),
}).strict();
const reviewRequestSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-census-runtime-review-request",
  ),
  evaluationId: z.literal(EVALUATION_ID),
  freezeCommitSha: sha1Schema,
  proposedActivationBridge:
    artifactReferenceSchema,
  requestedByTaskName: z.string().min(1),
  requestedChecks: z.array(z.string().min(1)).min(1),
  runtimeManifest: artifactReferenceSchema,
  schemaVersion: z.literal(1),
}).strict();
const reviewInputSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-census-runtime-review-input",
  ),
  request: artifactReferenceSchema,
  proposedActivationBridge:
    artifactReferenceSchema,
  runtimeManifest: artifactReferenceSchema,
  schemaVersion: z.literal(1),
}).strict();
const reviewDispatchSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-census-runtime-review-dispatch",
  ),
  input: artifactReferenceSchema,
  request: artifactReferenceSchema,
  reviewerAgentName: z.string().min(1),
  reviewerTaskName: z.string().min(1),
  schemaVersion: z.literal(1),
}).strict();
const reviewResponseSchema = z.object({
  acceptedChecks:
    z.array(z.string().min(1)).min(1),
  artifactKind: z.literal(
    "c6-source-v3-simple-census-runtime-review-response",
  ),
  blockingFindings: z.array(z.never()).length(0),
  dispatchSha256: sha256Schema,
  inputSha256: sha256Schema,
  requestSha256: sha256Schema,
  reviewerAgentName: z.string().min(1),
  reviewerTaskName: z.string().min(1),
  schemaVersion: z.literal(1),
  verdict: z.literal("accepted"),
  verificationCommands:
    z.array(z.string().min(1)).min(1),
}).strict();
const reviewProvenanceSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-census-runtime-review-provenance",
  ),
  authorTaskName: z.string().min(1),
  cryptographicReceipt: z.literal(false),
  dispatch: artifactReferenceSchema,
  input: artifactReferenceSchema,
  independenceVerified: z.literal(false),
  orchestratorObservedSeparateAgentReceiptStructure:
    z.literal(true),
  request: artifactReferenceSchema,
  response: artifactReferenceSchema,
  reviewerAgentName: z.string().min(1),
  reviewerTaskName: z.string().min(1),
  schemaVersion: z.literal(1),
}).strict();
const activationReceiptSchema = z.object({
  activationBridge: artifactReferenceSchema,
  artifactKind: z.literal(
    "c6-source-v3-simple-census-runtime-activation-receipt",
  ),
  boundary: runtimeAuthorityBoundarySchema,
  evaluationId: z.literal(EVALUATION_ID),
  executionContract: artifactReferenceSchema,
  freeze: gitCommitIdentitySchema,
  promotionReceipt: artifactReferenceSchema,
  reviewProvenance: artifactReferenceSchema,
  reviewCommit: gitCommitIdentitySchema,
  runtimeSourceAggregateSha256: sha256Schema,
  runtimeSourceManifest: artifactReferenceSchema,
  runtimeVersions: z.object({
    bun: z.string().min(1),
    node: z.string().min(1),
  }).strict(),
  schemaVersion: z.literal(1),
  status: z.literal(
    "formal-census-live-network-only-no-candidate-selection-or-codex-run-authority",
  ),
}).strict();
export const C6SourceV3SimpleCensusRuntimeAuthorizationSnapshotSchema =
  z.object({
    activationBridge: artifactReferenceSchema,
    activationCommit: gitCommitIdentitySchema,
    activationReceipt: artifactReferenceSchema,
    artifactKind: z.literal(
      "c6-source-v3-simple-census-runtime-authorization",
    ),
    boundary: runtimeAuthorityBoundarySchema,
    evaluationId: z.literal(EVALUATION_ID),
    executionContract: artifactReferenceSchema,
    freeze: gitCommitIdentitySchema,
    promotionReceipt: artifactReferenceSchema,
    reviewCommit: gitCommitIdentitySchema,
    reviewProvenance: artifactReferenceSchema,
    runtimeSourceAggregateSha256: sha256Schema,
    runtimeSourceManifest: artifactReferenceSchema,
    runtimeVersions: z.object({
      bun: z.string().min(1),
      node: z.string().min(1),
    }).strict(),
    schemaVersion: z.literal(1),
    status: z.literal(
      "formal-census-live-network-only-no-candidate-selection-or-codex-run-authority",
    ),
  }).strict();

export type C6SourceV3SimpleCensusActivationReceipt =
  z.infer<typeof activationReceiptSchema>;
export type C6SourceV3SimpleCensusRuntimeAuthorizationSnapshot =
  z.infer<
    typeof C6SourceV3SimpleCensusRuntimeAuthorizationSnapshotSchema
  >;

export function buildC6SourceV3SimpleCensusRuntimeAuthorization(
  input: {
    activationCommit: z.input<
      typeof gitCommitIdentitySchema
    >;
    activationReceipt: z.input<
      typeof artifactReferenceSchema
    >;
    receipt: C6SourceV3SimpleCensusActivationReceipt;
  },
) {
  const snapshot =
    C6SourceV3SimpleCensusRuntimeAuthorizationSnapshotSchema
      .parse({
        activationBridge:
          input.receipt.activationBridge,
        activationCommit:
          input.activationCommit,
        activationReceipt:
          input.activationReceipt,
        artifactKind:
          "c6-source-v3-simple-census-runtime-authorization",
        boundary: input.receipt.boundary,
        evaluationId: input.receipt.evaluationId,
        executionContract:
          input.receipt.executionContract,
        freeze: input.receipt.freeze,
        promotionReceipt:
          input.receipt.promotionReceipt,
        reviewCommit:
          input.receipt.reviewCommit,
        reviewProvenance:
          input.receipt.reviewProvenance,
        runtimeSourceAggregateSha256:
          input.receipt
            .runtimeSourceAggregateSha256,
        runtimeSourceManifest:
          input.receipt.runtimeSourceManifest,
        runtimeVersions:
          input.receipt.runtimeVersions,
        schemaVersion: 1,
        status: input.receipt.status,
      });
  return {
    runtimeAuthorizationSha256: sha256(
      Buffer.from(JSON.stringify(snapshot)),
    ),
    snapshot,
  } as const;
}

export function verifyC6SourceV3SimpleCensusReviewScope(
  input: {
    acceptedChecks: readonly string[];
    requestedChecks: readonly string[];
    verificationCommands: readonly string[];
  },
): void {
  if (
    !isDeepStrictEqual(
      input.requestedChecks,
      C6_SOURCE_V3_SIMPLE_CENSUS_REQUIRED_REVIEW_CHECKS,
    ) ||
    !isDeepStrictEqual(
      input.acceptedChecks,
      C6_SOURCE_V3_SIMPLE_CENSUS_REQUIRED_REVIEW_CHECKS,
    ) ||
    !isDeepStrictEqual(
      input.verificationCommands,
      C6_SOURCE_V3_SIMPLE_CENSUS_REQUIRED_REVIEW_COMMANDS,
    )
  ) {
    throw new Error(
      "C6 source-v3-simple runtime review scope mismatch",
    );
  }
}

export async function buildC6SourceV3SimpleCensusActivationReceipt(
  input: {
    freezeCommitSha: string;
    repositoryRoot: string;
    reviewCommitSha: string;
  },
): Promise<C6SourceV3SimpleCensusActivationReceipt> {
  const repositoryRoot = await assertRepository(
    input.repositoryRoot,
  );
  const freeze = await readCommit(
    repositoryRoot,
    sha1Schema.parse(input.freezeCommitSha),
  );
  if (freeze.parentCommitShas.length !== 1) {
    throw new Error(
      "C6 source-v3-simple runtime freeze must have one parent",
    );
  }
  const reviewCommit = await readCommit(
    repositoryRoot,
    sha1Schema.parse(input.reviewCommitSha),
  );
  if (
    reviewCommit.parentCommitShas.length !== 1 ||
    reviewCommit.parentCommitShas[0] !==
      freeze.commitSha
  ) {
    throw new Error(
      "C6 source-v3-simple runtime review must be the direct child of the freeze",
    );
  }
  await assertAncestor(
    repositoryRoot,
    reviewCommit.commitSha,
    await gitText(repositoryRoot, [
      "rev-parse",
      "HEAD^{commit}",
    ]),
  );
  await assertExactChangedPaths(
    repositoryRoot,
    reviewCommit.commitSha,
    Object.values(REVIEW_PATHS),
  );
  for (const path of [
    ...Object.values(REVIEW_PATHS),
    C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_PATH,
    C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH,
  ]) {
    await assertPathAbsentAtCommit(
      repositoryRoot,
      freeze.commitSha,
      path,
    );
  }
  for (const path of [
    C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_PATH,
    C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH,
  ]) {
    await assertPathAbsentAtCommit(
      repositoryRoot,
      reviewCommit.commitSha,
      path,
    );
  }
  const runtimeSourceManifest =
    await currentReference(
      repositoryRoot,
      C6_SOURCE_V3_SIMPLE_CENSUS_RUNTIME_MANIFEST_PATH,
    );
  const manifestBytes = await requireFreezeBytes({
    freezeCommitSha: freeze.commitSha,
    path:
      C6_SOURCE_V3_SIMPLE_CENSUS_RUNTIME_MANIFEST_PATH,
    repositoryRoot,
  });
  await assertCommitRegularBlob(
    repositoryRoot,
    freeze.commitSha,
    C6_SOURCE_V3_SIMPLE_CENSUS_RUNTIME_MANIFEST_PATH,
  );
  assertReference(
    runtimeSourceManifest,
    manifestBytes,
  );
  const manifest =
    parseC6SourceV3SimpleCensusRuntimeSourceManifest(
      manifestBytes,
    );
  const current =
    await captureC6SourceV3SimpleCensusRuntimeSource(
      repositoryRoot,
    );
  if (!isDeepStrictEqual(current, manifest)) {
    throw new Error(
      "C6 source-v3-simple runtime source changed after freeze",
    );
  }
  for (const file of manifest.files) {
    await assertCommitRegularBlob(
      repositoryRoot,
      freeze.commitSha,
      file.path,
    );
    const frozenBytes = await requireFreezeBytes({
      freezeCommitSha: freeze.commitSha,
      path: file.path,
      repositoryRoot,
    });
    assertReference(file, frozenBytes);
    assertReference(
      file,
      await readCurrentBytes(
        repositoryRoot,
        file.path,
      ),
    );
  }
  const executionContract =
    await frozenCurrentReference({
      freezeCommitSha: freeze.commitSha,
      path: EXECUTION_CONTRACT_PATH,
      repositoryRoot,
    });
  const promotionReceipt =
    await frozenCurrentReference({
      freezeCommitSha: freeze.commitSha,
      path: PROMOTION_RECEIPT_PATH,
      repositoryRoot,
    });
  const activationBridge = referenceForBytes(
    C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_PATH,
    Buffer.from(
      C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_SOURCE,
    ),
  );
  const reviewProvenance =
    await verifyReviewProvenance({
      activationBridge,
      freezeCommitSha: freeze.commitSha,
      repositoryRoot,
      reviewCommitSha: reviewCommit.commitSha,
      runtimeSourceManifest,
    });
  return activationReceiptSchema.parse({
    activationBridge,
    artifactKind:
      "c6-source-v3-simple-census-runtime-activation-receipt",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      candidateSelectionPermitted: false,
      codexRunReady: false,
      formalCensusLiveNetworkPermitted: true,
    },
    evaluationId: EVALUATION_ID,
    executionContract,
    freeze: {
      commitSha: freeze.commitSha,
      parentCommitSha:
        freeze.parentCommitShas[0]!,
      treeSha: freeze.treeSha,
    },
    promotionReceipt,
    reviewProvenance,
    reviewCommit: {
      commitSha: reviewCommit.commitSha,
      parentCommitSha:
        reviewCommit.parentCommitShas[0]!,
      treeSha: reviewCommit.treeSha,
    },
    runtimeSourceManifest,
    runtimeSourceAggregateSha256:
      manifest.aggregateSha256,
    runtimeVersions: {
      bun: Bun.version,
      node: process.versions.node,
    },
    schemaVersion: 1,
    status:
      "formal-census-live-network-only-no-candidate-selection-or-codex-run-authority",
  });
}

export async function requireC6SourceV3SimpleCensusRuntimeAuthorization(
  input: {
    activationReceiptBytes: string | Uint8Array;
    repositoryRoot: string;
  },
) {
  const repositoryRoot = await assertRepository(
    input.repositoryRoot,
  );
  const receipt =
    parseC6SourceV3SimpleCensusActivationReceipt(
      input.activationReceiptBytes,
    );
  const expected =
    await buildC6SourceV3SimpleCensusActivationReceipt({
      freezeCommitSha: receipt.freeze.commitSha,
      repositoryRoot,
      reviewCommitSha:
        receipt.reviewCommit.commitSha,
    });
  if (!isDeepStrictEqual(receipt, expected)) {
    throw new Error(
      "C6 source-v3-simple runtime activation receipt mismatch",
    );
  }
  const activationCommitSha =
    await locateActivationCommit(repositoryRoot);
  const activationCommit = await readCommit(
    repositoryRoot,
    activationCommitSha,
  );
  if (
    activationCommit.parentCommitShas.length !== 1 ||
    activationCommit.parentCommitShas[0] !==
      receipt.reviewCommit.commitSha
  ) {
    throw new Error(
      "C6 source-v3-simple activation commit is not the direct child of review",
    );
  }
  await assertExactChangedPaths(
    repositoryRoot,
    activationCommit.commitSha,
    [
      C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_PATH,
      C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH,
    ],
  );
  await assertAncestor(
    repositoryRoot,
    activationCommit.commitSha,
    await gitText(repositoryRoot, [
      "rev-parse",
      "HEAD^{commit}",
    ]),
  );
  const receiptBytes = Buffer.from(
    input.activationReceiptBytes,
  );
  const currentReceipt = await readCurrentBytes(
    repositoryRoot,
    C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH,
  );
  const bridgeBytes = Buffer.from(
    C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_SOURCE,
  );
  if (
    !receiptBytes.equals(currentReceipt) ||
    !receiptBytes.equals(
      await gitShow(
        repositoryRoot,
        activationCommit.commitSha,
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH,
      ),
    ) ||
    !bridgeBytes.equals(
      await readCurrentBytes(
        repositoryRoot,
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_PATH,
      ),
    ) ||
    !bridgeBytes.equals(
      await gitShow(
        repositoryRoot,
        activationCommit.commitSha,
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_PATH,
      ),
    )
  ) {
    throw new Error(
      "C6 source-v3-simple activation commit bytes mismatch",
    );
  }
  const runtimeAuthorization =
    buildC6SourceV3SimpleCensusRuntimeAuthorization({
      activationCommit: {
        commitSha: activationCommit.commitSha,
        parentCommitSha:
          activationCommit.parentCommitShas[0]!,
        treeSha: activationCommit.treeSha,
      },
      activationReceipt: referenceForBytes(
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH,
        receiptBytes,
      ),
      receipt,
    });
  return {
    ...receipt.boundary,
    evaluationId: receipt.evaluationId,
    runtimeSourceAggregateSha256:
      receipt.runtimeSourceAggregateSha256,
    ...runtimeAuthorization,
  } as const;
}

export function parseC6SourceV3SimpleCensusActivationReceipt(
  input: string | Uint8Array,
): C6SourceV3SimpleCensusActivationReceipt {
  return activationReceiptSchema.parse(
    parseCanonicalJson(input),
  );
}

export function serializeC6SourceV3SimpleCensusActivationReceipt(
  input: C6SourceV3SimpleCensusActivationReceipt,
): string {
  return `${JSON.stringify(
    activationReceiptSchema.parse(input),
    null,
    2,
  )}\n`;
}

async function verifyReviewProvenance(input: {
  activationBridge: z.infer<
    typeof artifactReferenceSchema
  >;
  freezeCommitSha: string;
  repositoryRoot: string;
  reviewCommitSha: string;
  runtimeSourceManifest: z.infer<
    typeof artifactReferenceSchema
  >;
}) {
  const references = {
    dispatch: await committedReviewReference(
      input.repositoryRoot,
      input.reviewCommitSha,
      REVIEW_PATHS.dispatch,
    ),
    input: await committedReviewReference(
      input.repositoryRoot,
      input.reviewCommitSha,
      REVIEW_PATHS.input,
    ),
    provenance: await committedReviewReference(
      input.repositoryRoot,
      input.reviewCommitSha,
      REVIEW_PATHS.provenance,
    ),
    request: await committedReviewReference(
      input.repositoryRoot,
      input.reviewCommitSha,
      REVIEW_PATHS.request,
    ),
    response: await committedReviewReference(
      input.repositoryRoot,
      input.reviewCommitSha,
      REVIEW_PATHS.response,
    ),
  };
  const request = reviewRequestSchema.parse(
    parseCanonicalJson(
      await readCurrentBytes(
        input.repositoryRoot,
        REVIEW_PATHS.request,
      ),
    ),
  );
  const reviewInput = reviewInputSchema.parse(
    parseCanonicalJson(
      await readCurrentBytes(
        input.repositoryRoot,
        REVIEW_PATHS.input,
      ),
    ),
  );
  const dispatch = reviewDispatchSchema.parse(
    parseCanonicalJson(
      await readCurrentBytes(
        input.repositoryRoot,
        REVIEW_PATHS.dispatch,
      ),
    ),
  );
  const response = reviewResponseSchema.parse(
    parseCanonicalJson(
      await readCurrentBytes(
        input.repositoryRoot,
        REVIEW_PATHS.response,
      ),
    ),
  );
  const provenance =
    reviewProvenanceSchema.parse(
      parseCanonicalJson(
        await readCurrentBytes(
          input.repositoryRoot,
          REVIEW_PATHS.provenance,
        ),
      ),
    );
  verifyC6SourceV3SimpleCensusReviewScope({
    acceptedChecks: response.acceptedChecks,
    requestedChecks: request.requestedChecks,
    verificationCommands:
      response.verificationCommands,
  });
  if (
    request.freezeCommitSha !==
      input.freezeCommitSha ||
    !sameReference(
      request.proposedActivationBridge,
      input.activationBridge,
    ) ||
    !sameReference(
      request.runtimeManifest,
      input.runtimeSourceManifest,
    ) ||
    !sameReference(
      reviewInput.request,
      references.request,
    ) ||
    !sameReference(
      reviewInput.proposedActivationBridge,
      input.activationBridge,
    ) ||
    !sameReference(
      reviewInput.runtimeManifest,
      input.runtimeSourceManifest,
    ) ||
    !sameReference(
      dispatch.input,
      references.input,
    ) ||
    !sameReference(
      dispatch.request,
      references.request,
    ) ||
    response.inputSha256 !==
      references.input.sha256 ||
    response.requestSha256 !==
      references.request.sha256 ||
    response.dispatchSha256 !==
      references.dispatch.sha256 ||
    provenance.authorTaskName !==
      request.requestedByTaskName ||
    provenance.authorTaskName ===
      provenance.reviewerTaskName ||
    provenance.reviewerAgentName !==
      dispatch.reviewerAgentName ||
    provenance.reviewerTaskName !==
      dispatch.reviewerTaskName ||
    response.reviewerAgentName !==
      dispatch.reviewerAgentName ||
    response.reviewerTaskName !==
      dispatch.reviewerTaskName ||
    !sameReference(
      provenance.dispatch,
      references.dispatch,
    ) ||
    !sameReference(
      provenance.input,
      references.input,
    ) ||
    !sameReference(
      provenance.request,
      references.request,
    ) ||
    !sameReference(
      provenance.response,
      references.response,
    )
  ) {
    throw new Error(
      "C6 source-v3-simple runtime review provenance mismatch",
    );
  }
  return references.provenance;
}

async function frozenCurrentReference(input: {
  freezeCommitSha: string;
  path: string;
  repositoryRoot: string;
}) {
  const reference = await currentReference(
    input.repositoryRoot,
    input.path,
  );
  assertReference(
    reference,
    await gitShow(
      input.repositoryRoot,
      input.freezeCommitSha,
      input.path,
    ),
  );
  return reference;
}

async function committedReviewReference(
  repositoryRoot: string,
  reviewCommitSha: string,
  path: string,
) {
  const reference = await currentReference(
    repositoryRoot,
    path,
  );
  assertReference(
    reference,
    await gitShow(
      repositoryRoot,
      reviewCommitSha,
      path,
    ),
  );
  return reference;
}

async function currentReference(
  repositoryRoot: string,
  path: string,
) {
  const bytes = await readCurrentBytes(
    repositoryRoot,
    path,
  );
  return {
    bytes: bytes.length,
    path,
    sha256: sha256(bytes),
  };
}

async function readCurrentBytes(
  repositoryRoot: string,
  path: string,
): Promise<Buffer> {
  return await readC6StableRegularFile(
    join(repositoryRoot, path),
    `source-v3-simple runtime activation ${path}`,
    undefined,
    true,
  );
}

async function requireFreezeBytes(input: {
  freezeCommitSha: string;
  path: string;
  repositoryRoot: string;
}): Promise<Buffer> {
  return await gitShow(
    input.repositoryRoot,
    input.freezeCommitSha,
    input.path,
  );
}

async function assertRepository(
  input: string,
): Promise<string> {
  const repositoryRoot = await realpath(resolve(input));
  const runningRepositoryRoot = await realpath(
    C6_SOURCE_V3_SIMPLE_CENSUS_RUNNING_REPOSITORY_ROOT,
  );
  if (repositoryRoot !== runningRepositoryRoot) {
    throw new Error(
      "C6 source-v3-simple activation repository does not match the running repository",
    );
  }
  const [inside, objectFormat, topLevel, commonDir] =
    await Promise.all([
      gitText(repositoryRoot, [
        "rev-parse",
        "--is-inside-work-tree",
      ]),
      gitText(repositoryRoot, [
        "rev-parse",
        "--show-object-format",
      ]),
      gitText(repositoryRoot, [
        "rev-parse",
        "--show-toplevel",
      ]),
      gitText(repositoryRoot, [
        "rev-parse",
        "--git-common-dir",
      ]),
    ]);
  if (
    inside !== "true" ||
    objectFormat !== "sha1" ||
    await realpath(resolve(topLevel)) !==
      repositoryRoot
  ) {
    throw new Error(
      "C6 source-v3-simple runtime activation repository is invalid",
    );
  }
  const common = await realpath(
    resolve(repositoryRoot, commonDir),
  );
  let graftExists = true;
  try {
    await lstat(join(common, "info", "grafts"));
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      graftExists = false;
    } else {
      throw error;
    }
  }
  const replacementRefs = await gitText(
    repositoryRoot,
    [
      "for-each-ref",
      "--format=%(refname)",
      "refs/replace",
    ],
  );
  if (graftExists || replacementRefs.length > 0) {
    throw new Error(
      "C6 source-v3-simple runtime activation rejects Git grafts and replacements",
    );
  }
  return repositoryRoot;
}

async function readCommit(
  repositoryRoot: string,
  commitSha: string,
) {
  const bytes = await gitBuffer(repositoryRoot, [
    "cat-file",
    "commit",
    commitSha,
  ]);
  const headerEnd = bytes.indexOf("\n\n");
  if (headerEnd < 0) {
    throw new Error(
      "C6 source-v3-simple runtime freeze commit is invalid",
    );
  }
  const lines = bytes
    .subarray(0, headerEnd)
    .toString("utf8")
    .split("\n");
  const tree = lines.filter((line) =>
    line.startsWith("tree ")
  );
  if (tree.length !== 1) {
    throw new Error(
      "C6 source-v3-simple runtime freeze tree is invalid",
    );
  }
  return {
    commitSha,
    parentCommitShas: lines
      .filter((line) => line.startsWith("parent "))
      .map((line) =>
        sha1Schema.parse(line.slice(7))
      ),
    treeSha: sha1Schema.parse(
      tree[0]!.slice(5),
    ),
  };
}

async function assertAncestor(
  repositoryRoot: string,
  ancestor: string,
  descendant: string,
): Promise<void> {
  try {
    await rawGit(repositoryRoot, [
      "merge-base",
      "--is-ancestor",
      ancestor,
      descendant,
    ]);
  } catch {
    throw new Error(
      "C6 source-v3-simple runtime freeze is not an ancestor of HEAD",
    );
  }
}

async function assertExactChangedPaths(
  repositoryRoot: string,
  commitSha: string,
  expectedInput: readonly string[],
): Promise<void> {
  const changed = nulSeparatedPaths(
    await gitBuffer(repositoryRoot, [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "-z",
      commitSha,
    ]),
  );
  const added = nulSeparatedPaths(
    await gitBuffer(repositoryRoot, [
      "diff-tree",
      "--no-commit-id",
      "--diff-filter=A",
      "--name-only",
      "-r",
      "-z",
      commitSha,
    ]),
  );
  const expected = [...expectedInput].sort(
    compareText,
  );
  if (
    !isDeepStrictEqual(changed, expected) ||
    !isDeepStrictEqual(added, expected)
  ) {
    throw new Error(
      "C6 source-v3-simple activation commit path closure mismatch",
    );
  }
  for (const path of expected) {
    await assertCommitRegularBlob(
      repositoryRoot,
      commitSha,
      path,
    );
  }
}

async function assertCommitRegularBlob(
  repositoryRoot: string,
  commitSha: string,
  path: string,
): Promise<void> {
  const entry = await gitBuffer(repositoryRoot, [
    "ls-tree",
    commitSha,
    "--",
    path,
  ]);
  const prefix = "100644 blob ";
  const suffix = `\t${path}\n`;
  const text = entry.toString("utf8");
  if (
    !text.startsWith(prefix) ||
    !text.endsWith(suffix) ||
    !/^[a-f0-9]{40}$/u.test(
      text.slice(
        prefix.length,
        text.length - suffix.length,
      ),
    )
  ) {
    throw new Error(
      `C6 source-v3-simple activation path mode mismatch: ${path}`,
    );
  }
}

async function assertPathAbsentAtCommit(
  repositoryRoot: string,
  commitSha: string,
  path: string,
): Promise<void> {
  const entry = await gitBuffer(repositoryRoot, [
    "ls-tree",
    "-z",
    "--full-tree",
    commitSha,
    "--",
    path,
  ]);
  if (entry.length !== 0) {
    throw new Error(
      `C6 source-v3-simple activation path must be absent: ${path}`,
    );
  }
}

async function locateActivationCommit(
  repositoryRoot: string,
): Promise<string> {
  const commits = (
    await gitText(repositoryRoot, [
      "log",
      "--format=%H",
      "--diff-filter=A",
      "--",
      C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH,
    ])
  ).split("\n").filter((value) =>
    value.length > 0
  );
  if (commits.length !== 1) {
    throw new Error(
      "C6 source-v3-simple activation commit is not unique",
    );
  }
  return sha1Schema.parse(commits[0]);
}

function nulSeparatedPaths(
  bytes: Uint8Array,
): string[] {
  const value = Buffer.from(bytes).toString("utf8");
  const paths = value.split("\0").filter((path) =>
    path.length > 0
  );
  paths.sort(compareText);
  return paths;
}

async function gitShow(
  repositoryRoot: string,
  commit: string,
  path: string,
): Promise<Buffer> {
  return await gitBuffer(
    repositoryRoot,
    ["show", `${commit}:${path}`],
    64 * 1_024 * 1_024,
  );
}

async function gitText(
  repositoryRoot: string,
  args: readonly string[],
): Promise<string> {
  const { stdout } = await rawGit(
    repositoryRoot,
    args,
    {
      encoding: "utf8",
      maxBuffer: 1_048_576,
    },
  );
  return (
    typeof stdout === "string"
      ? stdout
      : Buffer.from(stdout).toString("utf8")
  ).trim();
}

async function gitBuffer(
  repositoryRoot: string,
  args: readonly string[],
  maxBuffer = 8 * 1_024 * 1_024,
): Promise<Buffer> {
  const { stdout } = await rawGit(
    repositoryRoot,
    args,
    {
      encoding: "buffer",
      maxBuffer,
    },
  );
  return Buffer.from(stdout);
}

async function rawGit(
  repositoryRoot: string,
  args: readonly string[],
  options: {
    encoding?: "buffer" | "utf8";
    maxBuffer?: number;
  } = {},
) {
  return await execFileAsync(
    "git",
    [
      "--no-replace-objects",
      "-C",
      repositoryRoot,
      ...args,
    ],
    {
      cwd: repositoryRoot,
      encoding: options.encoding ?? "utf8",
      env: rawGitEnvironment(),
      maxBuffer:
        options.maxBuffer ?? 1_048_576,
    },
  );
}

function rawGitEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(
    process.env,
  )) {
    if (!name.startsWith("GIT_")) {
      environment[name] = value;
    }
  }
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  return environment;
}

function parseCanonicalJson(
  input: string | Uint8Array,
): unknown {
  const bytes = Buffer.from(input);
  const text = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(bytes);
  const raw = JSON.parse(text) as unknown;
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 source-v3-simple runtime activation artifact is not canonical JSON",
    );
  }
  return raw;
}

function assertReference(
  reference: {
    bytes: number;
    sha256: string;
  },
  bytes: Uint8Array,
): void {
  if (
    reference.bytes !== bytes.length ||
    reference.sha256 !== sha256(bytes)
  ) {
    throw new Error(
      "C6 source-v3-simple runtime activation reference mismatch",
    );
  }
}

function referenceForBytes(
  path: string,
  bytes: Uint8Array,
) {
  return {
    bytes: bytes.length,
    path,
    sha256: sha256(bytes),
  };
}

function sameReference(
  left: z.infer<typeof artifactReferenceSchema>,
  right: z.infer<typeof artifactReferenceSchema>,
): boolean {
  return left.bytes === right.bytes &&
    left.path === right.path &&
    left.sha256 === right.sha256;
}

function compareText(
  left: string,
  right: string,
): number {
  return Buffer.compare(
    Buffer.from(left),
    Buffer.from(right),
  );
}

function hasErrorCode(
  error: unknown,
  code: string,
): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}
