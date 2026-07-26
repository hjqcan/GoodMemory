import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
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
  parseC6SourceV3SimplePriorIdentityPortableEvidenceManifest,
  verifyC6SourceV3SimplePriorIdentityPortableEvidence,
} from "./c6-source-v3-simple-prior-identity-portable-evidence";
import {
  C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_SOURCE_PATHS,
  validateC6SourceV3SimplePriorIdentityReplayReview,
} from "./c6-source-v3-simple-prior-identity-replay-review";
import {
  validateC6SourceV3SimpleReview,
} from "./c6-source-v3-simple-review";

const execFileAsync = promisify(execFile);
const SOURCE_POOL_ROOT =
  "fixtures/codex-coding-effect/c6-source-pool";
const PROTOCOL_PATH =
  `${SOURCE_POOL_ROOT}/swe-bench-live-multilang-608f7ae9.` +
  "source-v3-simple-protocol-v1.json";
const SOURCE_V2_PATH =
  `${SOURCE_POOL_ROOT}/swe-bench-live-multilang-608f7ae9.` +
  "wave3-source-universe-v2.json";
const METADATA_PREDICATE_PATH =
  `${SOURCE_POOL_ROOT}/swe-bench-live-multilang-608f7ae9.` +
  "wave3-pretarget-policy-v1.json";
const PRIOR_IDENTITY_PLAN_PATH =
  `${SOURCE_POOL_ROOT}/swe-bench-live-multilang-608f7ae9.` +
  "wave3-prior-repository-identity-plan-v1.json";
const PROTOCOL_REVIEW_ROOT =
  `${SOURCE_POOL_ROOT}/provenance/source-v3-simple/review`;
const PRIOR_IDENTITY_ROOT =
  `${SOURCE_POOL_ROOT}/provenance/source-v3-simple/` +
  "prior-repository-identity";
const PRIOR_IDENTITY_REPLAY_PATH =
  `${PRIOR_IDENTITY_ROOT}/swe-bench-live-multilang-608f7ae9.` +
  "source-v3-simple-prior-repository-identity-observation-replay-v1.json";
const PRIOR_IDENTITY_REVIEW_ROOT =
  `${PRIOR_IDENTITY_ROOT}/review`;
const PORTABLE_EVIDENCE_ROOT =
  `${PRIOR_IDENTITY_ROOT}/portable-evidence-v1`;
const PORTABLE_MANIFEST_PATH =
  `${PORTABLE_EVIDENCE_ROOT}/portable-evidence.json`;
const CAPTURE_A_ARCHIVE_PATH =
  `${PORTABLE_EVIDENCE_ROOT}/capture-a.tar.gz`;
const CAPTURE_B_ARCHIVE_PATH =
  `${PORTABLE_EVIDENCE_ROOT}/capture-b.tar.gz`;
const SOURCE_V3_SIMPLE_REVIEW_VERIFIER_PATH =
  "scripts/codex-coding-effect/c6-source-v3-simple-review.ts";
const PRIOR_IDENTITY_REPLAY_REVIEW_VERIFIER_PATH =
  "scripts/codex-coding-effect/" +
  "c6-source-v3-simple-prior-identity-replay-review.ts";
const PORTABLE_EVIDENCE_VERIFIER_PATH =
  "scripts/codex-coding-effect/" +
  "c6-source-v3-simple-prior-identity-portable-evidence.ts";

export const C6_SOURCE_V3_SIMPLE_PROMOTION_VERIFIER_PATH =
  "scripts/codex-coding-effect/c6-source-v3-simple-promotion.ts";
export const C6_SOURCE_V3_SIMPLE_PROMOTION_CLI_PATH =
  "scripts/promote-codex-coding-effect-c6-source-v3-simple.ts";
export const C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH =
  "scripts/codex-coding-effect/c6-source-v3-simple-census.ts";
export const C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_SOURCE =
  `import {
  type C6SourceV3SimplePromotionInput,
  verifyC6SourceV3SimplePromotionReceipt,
} from "./c6-source-v3-simple-promotion";

export const C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_VERSION = 1 as const;

export interface C6SourceV3SimpleCensusAuthorizationInput {
  promotionInput: C6SourceV3SimplePromotionInput;
  promotionReceiptBytes: string | Uint8Array;
}

export async function requireC6SourceV3SimpleCensusAuthorization(
  input: C6SourceV3SimpleCensusAuthorizationInput,
) {
  const receipt = await verifyC6SourceV3SimplePromotionReceipt(
    input.promotionReceiptBytes,
    input.promotionInput,
  );
  return {
    candidateManifestFrozen:
      receipt.boundary.candidateManifestFrozen,
    candidateSelectionPermitted:
      receipt.boundary.candidateSelectionPermitted,
    codexRunReady: receipt.boundary.codexRunReady,
    evaluationId: receipt.evaluationId,
    formalCensusPermitted:
      receipt.boundary.formalCensusPermitted,
    priorRepositoryNodeIdExclusionComplete:
      receipt.boundary.priorRepositoryNodeIdExclusionComplete,
    sourceV3SimpleFrozen:
      receipt.boundary.sourceV3SimpleFrozen,
  } as const;
}
`;

const PROTOCOL_REVIEW_REPOSITORY_PATHS = {
  dispatch: `${PROTOCOL_REVIEW_ROOT}/dispatch.json`,
  input: `${PROTOCOL_REVIEW_ROOT}/input.json`,
  provenance: `${PROTOCOL_REVIEW_ROOT}/provenance.json`,
  request: `${PROTOCOL_REVIEW_ROOT}/request.json`,
  response: `${PROTOCOL_REVIEW_ROOT}/response.json`,
} as const;
const PRIOR_IDENTITY_REVIEW_REPOSITORY_PATHS = {
  dispatch: `${PRIOR_IDENTITY_REVIEW_ROOT}/dispatch.json`,
  input: `${PRIOR_IDENTITY_REVIEW_ROOT}/input.json`,
  provenance: `${PRIOR_IDENTITY_REVIEW_ROOT}/provenance.json`,
  request: `${PRIOR_IDENTITY_REVIEW_ROOT}/request.json`,
  response: `${PRIOR_IDENTITY_REVIEW_ROOT}/response.json`,
} as const;

const FROZEN_SOURCE_PATHS = [
  "scripts/codex-coding-effect/c6-asset-lock.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-plan.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-qualification.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-deep-capture-plan.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-deep-evidence.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-qualification.ts",
  "scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-union.ts",
  "scripts/codex-coding-effect/c6-review-event-policy.ts",
  PORTABLE_EVIDENCE_VERIFIER_PATH,
  PRIOR_IDENTITY_REPLAY_REVIEW_VERIFIER_PATH,
  "scripts/codex-coding-effect/c6-source-v3-simple-prior-repository-identity-replay.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-prior-repository-identity-structure.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-prior-repository-identity.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple-review.ts",
  "scripts/codex-coding-effect/c6-source-v3-simple.ts",
  "scripts/codex-coding-effect/c6-wave3-pretarget-policy.ts",
  "scripts/codex-coding-effect/c6-wave3-prior-repository-identity-artifacts.ts",
  "scripts/codex-coding-effect/c6-wave3-prior-repository-identity-capture.ts",
  "scripts/codex-coding-effect/c6-wave3-prior-repository-identity-plan.ts",
  "scripts/codex-coding-effect/c6-wave3-source-universe-v2.ts",
  "scripts/record-codex-coding-effect-c6-source-v3-simple-prior-identity-replay.ts",
  C6_SOURCE_V3_SIMPLE_PROMOTION_CLI_PATH,
  C6_SOURCE_V3_SIMPLE_PROMOTION_VERIFIER_PATH,
] as const;
const FROZEN_RUNTIME_DEPENDENCY_PATHS = [
  "package.json",
  "bun.lock",
] as const;
const FROZEN_RUNTIME_CLOSURE_PATHS = [
  ...FROZEN_SOURCE_PATHS,
  ...FROZEN_RUNTIME_DEPENDENCY_PATHS,
] as const;

export const C6_SOURCE_V3_SIMPLE_PROMOTION_FROZEN_PATHS = [
  PROTOCOL_PATH,
  SOURCE_V2_PATH,
  METADATA_PREDICATE_PATH,
  PRIOR_IDENTITY_PLAN_PATH,
  PROTOCOL_REVIEW_REPOSITORY_PATHS.request,
  PROTOCOL_REVIEW_REPOSITORY_PATHS.input,
  PROTOCOL_REVIEW_REPOSITORY_PATHS.dispatch,
  PROTOCOL_REVIEW_REPOSITORY_PATHS.response,
  PROTOCOL_REVIEW_REPOSITORY_PATHS.provenance,
  PRIOR_IDENTITY_REPLAY_PATH,
  PRIOR_IDENTITY_REVIEW_REPOSITORY_PATHS.request,
  PRIOR_IDENTITY_REVIEW_REPOSITORY_PATHS.input,
  PRIOR_IDENTITY_REVIEW_REPOSITORY_PATHS.dispatch,
  PRIOR_IDENTITY_REVIEW_REPOSITORY_PATHS.response,
  PRIOR_IDENTITY_REVIEW_REPOSITORY_PATHS.provenance,
  PORTABLE_MANIFEST_PATH,
  CAPTURE_A_ARCHIVE_PATH,
  CAPTURE_B_ARCHIVE_PATH,
  ...FROZEN_RUNTIME_DEPENDENCY_PATHS,
  ...FROZEN_SOURCE_PATHS,
] as const;

const sha1Schema = z.string().regex(/^[a-f0-9]{40}$/u);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const trimmedStringSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "value cannot be whitespace-padded",
);
const relativePathSchema = trimmedStringSchema.refine(
  (value) =>
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((part) =>
      part.length > 0 && part !== "." && part !== ".."
    ),
  "path must be a normalized relative path",
);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().positive(),
  path: relativePathSchema,
  sha256: sha256Schema,
}).strict();
const reviewIdentitySchema = z.object({
  authorTaskName: trimmedStringSchema,
  cryptographicReviewIndependence: z.literal(false),
  reviewerAgentName: trimmedStringSchema,
}).strict();
const receiptSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-promotion-receipt",
  ),
  boundary: z.object({
    candidateManifestFrozen: z.literal(false),
    candidateSelectionPermitted: z.literal(false),
    captureOriginIndependentlyVerified: z.literal(false),
    codexRunReady: z.literal(false),
    cryptographicReviewIndependence: z.literal(false),
    externalAuthenticityVerified: z.literal(false),
    formalCensusPermitted: z.literal(true),
    independentCaptureProcessProven: z.literal(false),
    liveNetworkExecutionProven: z.literal(false),
    priorRepositoryNodeIdExclusionComplete: z.literal(true),
    sourceV3SimpleFrozen: z.literal(true),
  }).strict(),
  censusImplementation: z.object({
    activationEntrypoint: artifactReferenceSchema.extend({
      path: z.literal(
        C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
      ),
    }).strict(),
    activationPath: z.literal(
      C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
    ),
    commitSha: sha1Schema,
    treeSha: sha1Schema,
  }).strict(),
  evaluationId: z.literal(
    "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
  ),
  freeze: z.object({
    commitSha: sha1Schema,
    parentCommitSha: sha1Schema,
    treeSha: sha1Schema,
  }).strict(),
  frozenArtifacts: z.array(artifactReferenceSchema).length(
    C6_SOURCE_V3_SIMPLE_PROMOTION_FROZEN_PATHS.length,
  ),
  promotionBase: z.object({
    commitSha: sha1Schema,
    treeSha: sha1Schema,
  }).strict(),
  priorRepositoryNodeIdExclusionClosure: z.object({
    localReplayReviewAccepted: z.literal(true),
    observationReplayReceipt: artifactReferenceSchema.extend({
      path: z.literal(PRIOR_IDENTITY_REPLAY_PATH),
    }).strict(),
    portableEvidenceClosureVerified: z.literal(true),
    portableEvidenceManifest: artifactReferenceSchema.extend({
      path: z.literal(PORTABLE_MANIFEST_PATH),
    }).strict(),
    repositoryIdentityReplayAgreementObserved: z.literal(true),
  }).strict(),
  protocolReviewReceiptStructureVerified: z.literal(true),
  reviewIdentities: z.object({
    priorRepositoryIdentity: reviewIdentitySchema,
    protocol: reviewIdentitySchema,
  }).strict(),
  schemaVersion: z.literal(1),
  status: z.literal(
    "formal-source-row-census-only-no-candidate-allocation-manifest-or-codex-run-authority",
  ),
  verifierSource: artifactReferenceSchema.extend({
    path: z.literal(
      C6_SOURCE_V3_SIMPLE_PROMOTION_VERIFIER_PATH,
    ),
  }).strict(),
}).strict();

export type C6SourceV3SimplePromotionReceipt = z.infer<
  typeof receiptSchema
>;

export interface C6SourceV3SimplePromotionInput {
  censusImplementationCommitSha: string;
  freezeCommitSha: string;
  promotionBaseCommitSha: string;
  repositoryRoot: string;
}

interface GitCommitIdentity {
  commitSha: string;
  parentCommitShas: string[];
  treeSha: string;
}

interface ReviewIdentity {
  authorTaskName: string;
  reviewerAgentName: string;
}

export async function buildC6SourceV3SimplePromotionReceipt(
  rawInput: C6SourceV3SimplePromotionInput,
): Promise<C6SourceV3SimplePromotionReceipt> {
  return rebuildC6SourceV3SimplePromotionReceipt(
    rawInput,
    "generation",
  );
}

async function rebuildC6SourceV3SimplePromotionReceipt(
  rawInput: C6SourceV3SimplePromotionInput,
  mode: "generation" | "verification",
): Promise<C6SourceV3SimplePromotionReceipt> {
  const runtimeRepositoryRoot = await realpath(resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../..",
  ));
  const input = {
    censusImplementationCommitSha: sha1Schema.parse(
      rawInput.censusImplementationCommitSha,
    ),
    freezeCommitSha: sha1Schema.parse(
      rawInput.freezeCommitSha,
    ),
    promotionBaseCommitSha: sha1Schema.parse(
      rawInput.promotionBaseCommitSha,
    ),
    repositoryRoot: await realpath(resolve(rawInput.repositoryRoot)),
  };
  if (input.repositoryRoot !== runtimeRepositoryRoot) {
    throw new Error(
      "C6 source-v3-simple promotion repository must be the running repository",
    );
  }
  await assertRawRepositoryView(input.repositoryRoot);
  const [freeze, censusImplementation, promotionBase, headCommitSha] =
    await Promise.all([
      readCommitIdentity(
        input.repositoryRoot,
        input.freezeCommitSha,
        "freeze",
      ),
      readCommitIdentity(
        input.repositoryRoot,
        input.censusImplementationCommitSha,
        "census implementation",
      ),
      readCommitIdentity(
        input.repositoryRoot,
        input.promotionBaseCommitSha,
        "promotion base",
      ),
      gitText(input.repositoryRoot, ["rev-parse", "HEAD"]),
    ]);
  const head = await readCommitIdentity(
    input.repositoryRoot,
    sha1Schema.parse(headCommitSha),
    "current HEAD",
  );
  if (
    mode === "generation" &&
    head.commitSha !== promotionBase.commitSha
  ) {
    throw new Error(
      "C6 source-v3-simple promotion base must equal the running repository HEAD",
    );
  }
  if (mode === "verification") {
    await assertAncestorOrEqual(
      input.repositoryRoot,
      promotionBase.commitSha,
      head.commitSha,
      "C6 source-v3-simple promotion base must be an ancestor of or equal to the running repository HEAD",
    );
  }
  if (freeze.parentCommitShas.length !== 1) {
    throw new Error(
      "C6 source-v3-simple freeze commit must have exactly one parent",
    );
  }
  await assertStrictDescendant(
    input.repositoryRoot,
    freeze.commitSha,
    censusImplementation.commitSha,
  );
  await assertAncestorOrEqual(
    input.repositoryRoot,
    censusImplementation.commitSha,
    promotionBase.commitSha,
    "C6 source-v3-simple census implementation commit must be an ancestor of or equal to the promotion base",
  );
  await assertPathAbsentAtCommit(
    input.repositoryRoot,
    freeze.commitSha,
    C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
  );
  const censusActivation = await gitShow(
    input.repositoryRoot,
    censusImplementation.commitSha,
    C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
  );
  if (
    !censusActivation.equals(
      Buffer.from(C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_SOURCE),
    )
  ) {
    throw new Error(
      "C6 source-v3-simple census implementation does not equal the frozen activation contract",
    );
  }
  const censusActivationAtPromotionBase = await gitShow(
    input.repositoryRoot,
    promotionBase.commitSha,
    C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
  );
  if (!censusActivation.equals(censusActivationAtPromotionBase)) {
    throw new Error(
      "C6 source-v3-simple census activation changed after the census implementation commit",
    );
  }
  const censusActivationAtHead = await gitShow(
    input.repositoryRoot,
    head.commitSha,
    C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
  );
  if (!censusActivationAtPromotionBase.equals(censusActivationAtHead)) {
    throw new Error(
      "C6 source-v3-simple census activation changed after the promotion base",
    );
  }

  const promotionAtFreeze = await gitShow(
    input.repositoryRoot,
    freeze.commitSha,
    C6_SOURCE_V3_SIMPLE_PROMOTION_VERIFIER_PATH,
  );
  const promotionAtCensus = await gitShow(
    input.repositoryRoot,
    censusImplementation.commitSha,
    C6_SOURCE_V3_SIMPLE_PROMOTION_VERIFIER_PATH,
  );
  const promotionAtBase = await gitShow(
    input.repositoryRoot,
    promotionBase.commitSha,
    C6_SOURCE_V3_SIMPLE_PROMOTION_VERIFIER_PATH,
  );
  const promotionAtHead = await gitShow(
    input.repositoryRoot,
    head.commitSha,
    C6_SOURCE_V3_SIMPLE_PROMOTION_VERIFIER_PATH,
  );
  if (
    !promotionAtFreeze.equals(promotionAtCensus) ||
    !promotionAtCensus.equals(promotionAtBase) ||
    !promotionAtBase.equals(promotionAtHead)
  ) {
    throw new Error(
      "C6 source-v3-simple promotion verifier changed after the freeze commit",
    );
  }

  const committedArtifacts = new Map<string, Buffer>();
  for (const path of C6_SOURCE_V3_SIMPLE_PROMOTION_FROZEN_PATHS) {
    const [
      atFreeze,
      atCensus,
      atPromotionBase,
      atHead,
    ] = await Promise.all([
      gitShow(input.repositoryRoot, freeze.commitSha, path),
      gitShow(
        input.repositoryRoot,
        censusImplementation.commitSha,
        path,
      ),
      gitShow(
        input.repositoryRoot,
        promotionBase.commitSha,
        path,
      ),
      gitShow(
        input.repositoryRoot,
        head.commitSha,
        path,
      ),
    ]);
    if (
      !atFreeze.equals(atCensus) ||
      !atCensus.equals(atPromotionBase) ||
      !atPromotionBase.equals(atHead)
    ) {
      throw new Error(
        `C6 source-v3-simple frozen artifact ${path} changed after the freeze commit`,
      );
    }
    committedArtifacts.set(path, atPromotionBase);
  }
  committedArtifacts.set(
    C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
    censusActivationAtPromotionBase,
  );
  await assertRuntimeClosureMatches(committedArtifacts);
  assertPortableReplayReceiptBinding(committedArtifacts);

  const temporaryRoot = await mkdtemp(join(
    await realpath(tmpdir()),
    "goodmemory-c6-source-v3-simple-promotion-",
  ));
  try {
    await materializeCommittedArtifacts(
      temporaryRoot,
      committedArtifacts,
    );
    const protocolReviewIdentity = parseReviewIdentity(
      requiredBytes(
        committedArtifacts,
        PROTOCOL_REVIEW_REPOSITORY_PATHS.provenance,
      ),
      "protocol review",
    );
    const priorIdentityReviewIdentity = parseReviewIdentity(
      requiredBytes(
        committedArtifacts,
        PRIOR_IDENTITY_REVIEW_REPOSITORY_PATHS.provenance,
      ),
      "prior identity replay review",
    );
    assertSeparateReviewIdentity(
      protocolReviewIdentity,
      "protocol review",
    );
    assertSeparateReviewIdentity(
      priorIdentityReviewIdentity,
      "prior identity replay review",
    );
    validateProtocolReview(
      committedArtifacts,
      protocolReviewIdentity,
    );
    validatePriorIdentityReplayReview(
      committedArtifacts,
      priorIdentityReviewIdentity,
    );
    const portableEvidence =
      await verifyC6SourceV3SimplePriorIdentityPortableEvidence({
        outputRoot: join(temporaryRoot, PORTABLE_EVIDENCE_ROOT),
        planPath: join(
          temporaryRoot,
          PRIOR_IDENTITY_PLAN_PATH,
        ),
        protocolPath: join(temporaryRoot, PROTOCOL_PATH),
        sourceUniversePath: join(
          temporaryRoot,
          SOURCE_V2_PATH,
        ),
      });
    if (
      portableEvidence.portableEvidenceClosureVerified !== true ||
      portableEvidence
          .repositoryIdentityReplayAgreementObserved !== true
    ) {
      throw new Error(
        "C6 source-v3-simple portable prior identity closure did not verify",
      );
    }

    const frozenArtifacts =
      C6_SOURCE_V3_SIMPLE_PROMOTION_FROZEN_PATHS.map(
        (path) => artifactReference(
          path,
          requiredBytes(committedArtifacts, path),
        ),
      );
    const receipt = receiptSchema.parse({
      artifactKind: "c6-source-v3-simple-promotion-receipt",
      boundary: {
        candidateManifestFrozen: false,
        candidateSelectionPermitted: false,
        captureOriginIndependentlyVerified: false,
        codexRunReady: false,
        cryptographicReviewIndependence: false,
        externalAuthenticityVerified: false,
        formalCensusPermitted: true,
        independentCaptureProcessProven: false,
        liveNetworkExecutionProven: false,
        priorRepositoryNodeIdExclusionComplete: true,
        sourceV3SimpleFrozen: true,
      },
      censusImplementation: {
        activationEntrypoint: artifactReference(
          C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
          censusActivation,
        ),
        activationPath:
          C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
        commitSha: censusImplementation.commitSha,
        treeSha: censusImplementation.treeSha,
      },
      evaluationId:
        "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
      freeze: {
        commitSha: freeze.commitSha,
        parentCommitSha: freeze.parentCommitShas[0],
        treeSha: freeze.treeSha,
      },
      frozenArtifacts,
      promotionBase: {
        commitSha: promotionBase.commitSha,
        treeSha: promotionBase.treeSha,
      },
      priorRepositoryNodeIdExclusionClosure: {
        localReplayReviewAccepted: true,
        observationReplayReceipt: artifactReference(
          PRIOR_IDENTITY_REPLAY_PATH,
          requiredBytes(
            committedArtifacts,
            PRIOR_IDENTITY_REPLAY_PATH,
          ),
        ),
        portableEvidenceClosureVerified: true,
        portableEvidenceManifest: artifactReference(
          PORTABLE_MANIFEST_PATH,
          requiredBytes(
            committedArtifacts,
            PORTABLE_MANIFEST_PATH,
          ),
        ),
        repositoryIdentityReplayAgreementObserved: true,
      },
      protocolReviewReceiptStructureVerified: true,
      reviewIdentities: {
        priorRepositoryIdentity: {
          ...priorIdentityReviewIdentity,
          cryptographicReviewIndependence: false,
        },
        protocol: {
          ...protocolReviewIdentity,
          cryptographicReviewIndependence: false,
        },
      },
      schemaVersion: 1,
      status:
        "formal-source-row-census-only-no-candidate-allocation-manifest-or-codex-run-authority",
      verifierSource: artifactReference(
        C6_SOURCE_V3_SIMPLE_PROMOTION_VERIFIER_PATH,
        promotionAtBase,
      ),
    });
    assertFrozenArtifactOrder(receipt.frozenArtifacts);
    return receipt;
  } finally {
    await rm(temporaryRoot, {
      force: true,
      recursive: true,
    });
  }
}

export async function verifyC6SourceV3SimplePromotionReceipt(
  receiptInput: string | Uint8Array,
  input: C6SourceV3SimplePromotionInput,
): Promise<C6SourceV3SimplePromotionReceipt> {
  const receipt = parseC6SourceV3SimplePromotionReceipt(
    receiptInput,
  );
  const rebuilt =
    await rebuildC6SourceV3SimplePromotionReceipt(
      input,
      "verification",
    );
  if (!isDeepStrictEqual(receipt, rebuilt)) {
    throw new Error(
      "C6 source-v3-simple promotion receipt does not equal the exact rebuilt receipt",
    );
  }
  return receipt;
}

export async function readC6SourceV3SimplePromotionHead(
  repositoryRoot: string,
): Promise<string> {
  const resolvedRepositoryRoot = await realpath(resolve(repositoryRoot));
  await assertRawRepositoryView(resolvedRepositoryRoot);
  return sha1Schema.parse(
    await gitText(resolvedRepositoryRoot, ["rev-parse", "HEAD"]),
  );
}

export function serializeC6SourceV3SimplePromotionReceipt(
  input: C6SourceV3SimplePromotionReceipt,
): string {
  const receipt = receiptSchema.parse(input);
  assertFrozenArtifactOrder(receipt.frozenArtifacts);
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

export function parseC6SourceV3SimplePromotionReceipt(
  input: string | Uint8Array,
): C6SourceV3SimplePromotionReceipt {
  const bytes = Buffer.from(input);
  let text: string;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(bytes);
  } catch {
    throw new Error(
      "C6 source-v3-simple promotion receipt is not UTF-8",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 source-v3-simple promotion receipt is not JSON",
    );
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 source-v3-simple promotion receipt is not canonical JSON",
    );
  }
  const receipt = receiptSchema.parse(raw);
  assertFrozenArtifactOrder(receipt.frozenArtifacts);
  return receipt;
}

function validateProtocolReview(
  artifacts: ReadonlyMap<string, Buffer>,
  identity: ReviewIdentity,
): void {
  const evidence = validateC6SourceV3SimpleReview({
    authorTaskName: identity.authorTaskName,
    dispatchBytes: requiredBytes(
      artifacts,
      PROTOCOL_REVIEW_REPOSITORY_PATHS.dispatch,
    ),
    inputBytes: requiredBytes(
      artifacts,
      PROTOCOL_REVIEW_REPOSITORY_PATHS.input,
    ),
    metadataPredicate: {
      bytes: requiredBytes(artifacts, METADATA_PREDICATE_PATH),
      path: basenameWithinSourcePool(METADATA_PREDICATE_PATH),
    },
    protocol: {
      bytes: requiredBytes(artifacts, PROTOCOL_PATH),
      path: basenameWithinSourcePool(PROTOCOL_PATH),
    },
    provenanceBytes: requiredBytes(
      artifacts,
      PROTOCOL_REVIEW_REPOSITORY_PATHS.provenance,
    ),
    requestBytes: requiredBytes(
      artifacts,
      PROTOCOL_REVIEW_REPOSITORY_PATHS.request,
    ),
    responseBytes: requiredBytes(
      artifacts,
      PROTOCOL_REVIEW_REPOSITORY_PATHS.response,
    ),
    reviewerAgentName: identity.reviewerAgentName,
    sourceV2: {
      bytes: requiredBytes(artifacts, SOURCE_V2_PATH),
      path: basenameWithinSourcePool(SOURCE_V2_PATH),
    },
    verifierSource: {
      bytes: requiredBytes(
        artifacts,
        SOURCE_V3_SIMPLE_REVIEW_VERIFIER_PATH,
      ),
      path: SOURCE_V3_SIMPLE_REVIEW_VERIFIER_PATH,
    },
  });
  if (
    evidence.reviewReceiptStructureVerified !== true ||
    evidence.cryptographicReceipt !== false ||
    evidence.independenceVerified !== false
  ) {
    throw new Error(
      "C6 source-v3-simple protocol review evidence boundary mismatch",
    );
  }
}

function validatePriorIdentityReplayReview(
  artifacts: ReadonlyMap<string, Buffer>,
  identity: ReviewIdentity,
): void {
  const reviewInput = parseJsonObject(
    requiredBytes(
      artifacts,
      PRIOR_IDENTITY_REVIEW_REPOSITORY_PATHS.input,
    ),
    "prior identity replay review input",
  );
  const captureRoots = z.object({
    captureRoots: z.object({
      captureA: z.string().min(1),
      captureB: z.string().min(1),
    }).strict(),
  }).passthrough().parse(reviewInput).captureRoots;
  const evidence =
    validateC6SourceV3SimplePriorIdentityReplayReview({
      authorTaskName: identity.authorTaskName,
      bundleVerifierSource: {
        bytes: requiredBytes(
          artifacts,
          C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_SOURCE_PATHS
            .bundleVerifierSource,
        ),
        path:
          C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_SOURCE_PATHS
            .bundleVerifierSource,
      },
      captureA: captureRoots.captureA,
      captureB: captureRoots.captureB,
      dispatchBytes: requiredBytes(
        artifacts,
        PRIOR_IDENTITY_REVIEW_REPOSITORY_PATHS.dispatch,
      ),
      inputBytes: requiredBytes(
        artifacts,
        PRIOR_IDENTITY_REVIEW_REPOSITORY_PATHS.input,
      ),
      plan: {
        bytes: requiredBytes(artifacts, PRIOR_IDENTITY_PLAN_PATH),
        path:
          C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_SOURCE_PATHS
            .plan,
      },
      protocol: {
        bytes: requiredBytes(artifacts, PROTOCOL_PATH),
        path:
          C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_SOURCE_PATHS
            .protocol,
      },
      provenanceBytes: requiredBytes(
        artifacts,
        PRIOR_IDENTITY_REVIEW_REPOSITORY_PATHS.provenance,
      ),
      replayComparatorSource: {
        bytes: requiredBytes(
          artifacts,
          C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_SOURCE_PATHS
            .replayComparatorSource,
        ),
        path:
          C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_SOURCE_PATHS
            .replayComparatorSource,
      },
      replayMaterializerSource: {
        bytes: requiredBytes(
          artifacts,
          C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_SOURCE_PATHS
            .replayMaterializerSource,
        ),
        path:
          C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_SOURCE_PATHS
            .replayMaterializerSource,
      },
      replayReceipt: {
        bytes: requiredBytes(
          artifacts,
          PRIOR_IDENTITY_REPLAY_PATH,
        ),
        path:
          C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_SOURCE_PATHS
            .replayReceipt,
      },
      requestBytes: requiredBytes(
        artifacts,
        PRIOR_IDENTITY_REVIEW_REPOSITORY_PATHS.request,
      ),
      responseBytes: requiredBytes(
        artifacts,
        PRIOR_IDENTITY_REVIEW_REPOSITORY_PATHS.response,
      ),
      reviewerAgentName: identity.reviewerAgentName,
      sourceUniverse: {
        bytes: requiredBytes(artifacts, SOURCE_V2_PATH),
        path:
          C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_REVIEW_SOURCE_PATHS
            .sourceUniverse,
      },
    });
  if (
    evidence.localReplayReviewAccepted !== true ||
    evidence.reviewReceiptStructureVerified !== true ||
    evidence.cryptographicReceipt !== false ||
    evidence.independenceVerified !== false
  ) {
    throw new Error(
      "C6 source-v3-simple prior identity replay review evidence boundary mismatch",
    );
  }
}

async function assertRawRepositoryView(
  repositoryRoot: string,
): Promise<void> {
  const [
    insideWorkTree,
    objectFormat,
    topLevel,
    commonDirectory,
  ] = await Promise.all([
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
  if (insideWorkTree !== "true") {
    throw new Error(
      "C6 source-v3-simple promotion repository must be a Git worktree",
    );
  }
  if (objectFormat !== "sha1") {
    throw new Error(
      "C6 source-v3-simple promotion repository must use SHA-1 Git objects",
    );
  }
  if (
    await realpath(resolve(repositoryRoot, topLevel)) !==
      repositoryRoot
  ) {
    throw new Error(
      "C6 source-v3-simple promotion repository must equal the raw Git toplevel",
    );
  }
  const resolvedCommonDirectory = await realpath(resolve(
    repositoryRoot,
    commonDirectory,
  ));
  try {
    await lstat(join(resolvedCommonDirectory, "info", "grafts"));
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  throw new Error(
    "C6 source-v3-simple promotion rejects legacy Git grafts",
  );
}

async function readCommitIdentity(
  repositoryRoot: string,
  commitSha: string,
  label: string,
): Promise<GitCommitIdentity> {
  let commitBytes: Buffer;
  try {
    commitBytes = await gitBuffer(repositoryRoot, [
      "cat-file",
      "commit",
      commitSha,
    ]);
  } catch {
    throw new Error(
      `C6 source-v3-simple ${label} SHA is not a commit`,
    );
  }
  const headerEnd = commitBytes.indexOf("\n\n");
  if (headerEnd < 0) {
    throw new Error(
      `C6 source-v3-simple ${label} commit has no header terminator`,
    );
  }
  const headerLines = commitBytes
    .subarray(0, headerEnd)
    .toString("utf8")
    .split("\n");
  const treeLines = headerLines.filter((line) =>
    line.startsWith("tree ")
  );
  if (treeLines.length !== 1) {
    throw new Error(
      `C6 source-v3-simple ${label} commit must have one raw tree`,
    );
  }
  return {
    commitSha,
    parentCommitShas: headerLines
      .filter((line) => line.startsWith("parent "))
      .map((line) => sha1Schema.parse(line.slice("parent ".length))),
    treeSha: sha1Schema.parse(
      treeLines[0]!.slice("tree ".length),
    ),
  };
}

async function assertStrictDescendant(
  repositoryRoot: string,
  freezeCommitSha: string,
  censusImplementationCommitSha: string,
): Promise<void> {
  if (freezeCommitSha === censusImplementationCommitSha) {
    throw new Error(
      "C6 source-v3-simple census implementation commit must be a strict descendant of the freeze commit",
    );
  }
  try {
    await rawGit(
      repositoryRoot,
      [
        "merge-base",
        "--is-ancestor",
        freezeCommitSha,
        censusImplementationCommitSha,
      ],
    );
  } catch {
    throw new Error(
      "C6 source-v3-simple census implementation commit must be a strict descendant of the freeze commit",
    );
  }
}

async function assertAncestorOrEqual(
  repositoryRoot: string,
  ancestorCommitSha: string,
  descendantCommitSha: string,
  errorMessage: string,
): Promise<void> {
  try {
    await rawGit(
      repositoryRoot,
      [
        "merge-base",
        "--is-ancestor",
        ancestorCommitSha,
        descendantCommitSha,
      ],
    );
  } catch {
    throw new Error(errorMessage);
  }
}

async function gitShow(
  repositoryRoot: string,
  commitSha: string,
  path: string,
): Promise<Buffer> {
  return gitBuffer(
    repositoryRoot,
    ["show", `${commitSha}:${path}`],
    32 * 1_024 * 1_024,
  );
}

async function assertPathAbsentAtCommit(
  repositoryRoot: string,
  commitSha: string,
  path: string,
): Promise<void> {
  const entries = await gitBuffer(repositoryRoot, [
    "ls-tree",
    "-z",
    "--full-tree",
    commitSha,
    "--",
    path,
  ]);
  if (entries.byteLength !== 0) {
    throw new Error(
      "C6 source-v3-simple census activation entrypoint must be absent from the freeze commit",
    );
  }
}

async function gitText(
  repositoryRoot: string,
  args: readonly string[],
): Promise<string> {
  const { stdout } = await rawGit(repositoryRoot, args, {
    encoding: "utf8",
    maxBuffer: 1_048_576,
  });
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
  const { stdout } = await rawGit(repositoryRoot, args, {
    encoding: "buffer",
    maxBuffer,
  });
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
  return execFileAsync(
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
      maxBuffer: options.maxBuffer ?? 1_048_576,
    },
  );
}

function rawGitEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("GIT_")) {
      environment[name] = value;
    }
  }
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  return environment;
}

async function materializeCommittedArtifacts(
  outputRoot: string,
  artifacts: ReadonlyMap<string, Buffer>,
): Promise<void> {
  for (const [
    path,
    bytes,
  ] of artifacts) {
    const outputPath = join(outputRoot, path);
    await mkdir(dirname(outputPath), {
      recursive: true,
    });
    await writeFile(outputPath, bytes, {
      flag: "wx",
      mode: 0o600,
    });
  }
}

async function assertRuntimeClosureMatches(
  artifacts: ReadonlyMap<string, Buffer>,
): Promise<void> {
  const runtimeRepositoryRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  for (const path of [
    ...FROZEN_RUNTIME_CLOSURE_PATHS,
    C6_SOURCE_V3_SIMPLE_CENSUS_IMPLEMENTATION_PATH,
  ]) {
    const runtimeBytes = await readC6StableRegularFile(
      join(runtimeRepositoryRoot, path),
      `source-v3-simple promotion runtime closure ${path}`,
      8 * 1_024 * 1_024,
      true,
    );
    if (!runtimeBytes.equals(requiredBytes(artifacts, path))) {
      throw new Error(
        `C6 source-v3-simple runtime closure path ${path} does not match the census commit`,
      );
    }
  }
}

function assertPortableReplayReceiptBinding(
  artifacts: ReadonlyMap<string, Buffer>,
): void {
  const manifest =
    parseC6SourceV3SimplePriorIdentityPortableEvidenceManifest(
      requiredBytes(artifacts, PORTABLE_MANIFEST_PATH),
    );
  const standaloneReceipt = requiredBytes(
    artifacts,
    PRIOR_IDENTITY_REPLAY_PATH,
  );
  const embeddedReceipt = Buffer.from(
    manifest.replayReceipt.canonicalJson,
  );
  if (
    !embeddedReceipt.equals(standaloneReceipt) ||
    manifest.replayReceipt.bytes !== standaloneReceipt.byteLength ||
    manifest.replayReceipt.sha256 !== sha256(standaloneReceipt)
  ) {
    throw new Error(
      "C6 source-v3-simple portable embedded replay receipt does not equal the standalone committed replay receipt",
    );
  }
}

function parseReviewIdentity(
  bytes: Uint8Array,
  label: string,
): ReviewIdentity {
  const value = parseJsonObject(bytes, `${label} provenance`);
  const parsed = z.object({
    authorTaskName: trimmedStringSchema,
    reviewer: z.object({
      agentName: trimmedStringSchema,
      orchestratorAttestation: z.object({
        cryptographicReceipt: z.literal(false),
      }).passthrough(),
    }).passthrough(),
  }).passthrough().parse(value);
  return {
    authorTaskName: parsed.authorTaskName,
    reviewerAgentName: parsed.reviewer.agentName,
  };
}

function assertSeparateReviewIdentity(
  identity: ReviewIdentity,
  label: string,
): void {
  if (identity.authorTaskName === identity.reviewerAgentName) {
    throw new Error(
      `C6 source-v3-simple ${label} reviewer must be separate from the author`,
    );
  }
}

function parseJsonObject(
  bytes: Uint8Array,
  label: string,
): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(`C6 source-v3-simple ${label} is not JSON`);
  }
  return z.record(z.string(), z.unknown()).parse(value);
}

function artifactReference(
  path: string,
  bytes: Uint8Array,
): z.infer<typeof artifactReferenceSchema> {
  return artifactReferenceSchema.parse({
    bytes: bytes.byteLength,
    path,
    sha256: sha256(bytes),
  });
}

function requiredBytes(
  artifacts: ReadonlyMap<string, Buffer>,
  path: string,
): Buffer {
  const bytes = artifacts.get(path);
  if (bytes === undefined) {
    throw new Error(
      `C6 source-v3-simple required frozen artifact ${path} is missing`,
    );
  }
  return bytes;
}

function basenameWithinSourcePool(path: string): string {
  const prefix = `${SOURCE_POOL_ROOT}/`;
  if (!path.startsWith(prefix)) {
    throw new Error(
      `C6 source-v3-simple source pool path ${path} is invalid`,
    );
  }
  return path.slice(prefix.length);
}

function assertFrozenArtifactOrder(
  references: readonly { path: string }[],
): void {
  const actual = references.map(({ path }) => path);
  if (!isDeepStrictEqual(
    actual,
    [...C6_SOURCE_V3_SIMPLE_PROMOTION_FROZEN_PATHS],
  )) {
    throw new Error(
      "C6 source-v3-simple promotion receipt frozen artifact path set or order mismatch",
    );
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hasErrorCode(
  error: unknown,
  code: string,
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
