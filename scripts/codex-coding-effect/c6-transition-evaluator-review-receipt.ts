import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";

import { z } from "zod";

import {
  loadC6AssetLock,
  readC6StableRegularFile,
  verifyC6AssetClosure,
} from "./c6-asset-lock";
import {
  loadC6RealHistoryTransitionEvaluatorScreening,
} from "./c6-real-history-transition-evaluator-screening";
import {
  inspectC6RealHistorySemanticScreeningLedger,
} from "./c6-real-history-semantic-screening";
import {
  parseC6RealHistoryTransitionQualification,
} from "./c6-real-history-transition-qualification";
import type {
  C6ReviewTrajectoryDiscovery,
} from "./c6-review-trajectory-discovery";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const fileBindingSchema = z.object({
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const receiptSchema = z.object({
  artifactKind: z.literal(
    "c6-transition-evaluator-independent-review-receipt",
  ),
  bindings: z.object({
    evidence: fileBindingSchema,
    gate: fileBindingSchema,
    implementation: fileBindingSchema,
    qualification: fileBindingSchema,
    semanticLedger: z.object({
      amendmentBasisAssessmentCount: z.literal(12),
      amendmentBasisAssessmentPrefixSha256: sha256Schema,
      path: z.string().min(1),
      reviewedAssessmentCount: z.literal(13),
      reviewedAssessmentPrefixSha256: sha256Schema,
      reviewedSha256: sha256Schema,
    }).strict(),
    semanticPrefixSha256: sha256Schema,
    trajectory: fileBindingSchema,
    transitionFixture: z.object({
      assetLockSha256: sha256Schema,
      assetRootSha256: sha256Schema,
      path: z.string().min(1),
    }).strict(),
    unitTest: fileBindingSchema,
  }).strict(),
  review: z.object({
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    contextPolicy: z.literal("parent-context-inherited"),
    episodeAccepted: z.literal(false),
    executionAuthenticated: z.literal(false),
    fullEvaluatorDockerReplayPerformedByReviewer: z.literal(false),
    hiddenEvaluatorAccess: z.literal(false),
    localPinnedImageIdentityProbePerformed: z.literal(true),
    localProbeExecutionAuthenticated: z.literal(false),
    machineQualified: z.literal(false),
    noRemainingBlockersWithinScope: z.literal(true),
    organizationalIndependenceAttested: z.literal(false),
    originalExecutionWitnessed: z.literal(false),
    projectionProvesLiveDockerReplay: z.literal(false),
    rawGoldAccess: z.literal(false),
    retainedOutcomeLogAccess: z.literal(true),
    reviewCryptographicReceipt: z.literal(false),
    reviewedAt: z.literal("2026-07-25T22:43:40Z"),
    reviewedImplementationOwnerTaskName: z.literal("/root"),
    reviewerEditedFiles: z.literal(false),
    reviewerIdentityCryptographicallyAttested: z.literal(false),
    reviewerTaskName: z.literal(
      "/root/c6_transition_evaluator_receipt_audit",
    ),
    separateReadOnlyAgentTask: z.literal(true),
    verdict: z.literal(
      "frozen-receipt-rejection-derivation-accepted",
    ),
  }).strict(),
  reviewEvidence: z.object({
    focusedGate: z.object({
      assertions: z.literal(6),
      failed: z.literal(0),
      passed: z.literal(1),
    }).strict(),
    focusedUnit: z.object({
      assertions: z.literal(19),
      failed: z.literal(0),
      passed: z.literal(4),
    }).strict(),
    mutationProbeClassesRejected: z.literal(9),
    retainedCommitBodiesComparedAgainstFullClone: z.literal(6),
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();

export type C6TransitionEvaluatorReviewReceipt =
  z.infer<typeof receiptSchema>;

export async function loadC6TransitionEvaluatorReviewReceipt(input: {
  receiptRoot: string;
  repositoryRoot: string;
}) {
  const receiptLock = await loadC6AssetLock(input.receiptRoot);
  const receiptBytes = await readC6StableRegularFile(
    resolve(input.receiptRoot, "receipt.json"),
    "transition-evaluator review receipt",
  );
  const receipt = receiptSchema.parse(
    JSON.parse(receiptBytes.toString("utf8")) as unknown,
  );
  if (serializeC6TransitionEvaluatorReviewReceipt(receipt) !==
    receiptBytes.toString("utf8")) {
    throw new Error(
      "C6 transition-evaluator review receipt is not canonical JSON",
    );
  }

  const boundBytes = new Map<string, Buffer>();
  for (const binding of [
    receipt.bindings.evidence,
    receipt.bindings.gate,
    receipt.bindings.implementation,
    receipt.bindings.qualification,
    receipt.bindings.trajectory,
    receipt.bindings.unitTest,
  ]) {
    const bytes = await readC6StableRegularFile(
      resolveRepositoryPath(input.repositoryRoot, binding.path),
      `transition-evaluator review binding ${binding.path}`,
    );
    if (sha256(bytes) !== binding.sha256) {
      throw new Error(
        `C6 transition-evaluator review binding changed: ${binding.path}`,
      );
    }
    boundBytes.set(binding.path, bytes);
  }
  const semanticLedgerPath = resolveRepositoryPath(
    input.repositoryRoot,
    receipt.bindings.semanticLedger.path,
  );
  const semanticLedgerBytes = await readC6StableRegularFile(
    semanticLedgerPath,
    "transition-evaluator review semantic ledger",
  );
  const semanticScreening = parseJson(semanticLedgerBytes);
  const semanticLedger = z.object({
    assessments: z.array(z.unknown()).min(
      receipt.bindings.semanticLedger.reviewedAssessmentCount,
    ),
  }).passthrough().parse(semanticScreening);
  const semanticAssessments = semanticLedger.assessments;
  const reviewedAssessmentPrefixSha256 = sha256(
    Buffer.from(JSON.stringify(semanticAssessments.slice(
      0,
      receipt.bindings.semanticLedger.reviewedAssessmentCount,
    ))),
  );
  const amendmentBasisAssessmentPrefixSha256 = sha256(
    Buffer.from(JSON.stringify(semanticAssessments.slice(
      0,
      receipt.bindings.semanticLedger.amendmentBasisAssessmentCount,
    ))),
  );
  if (
    reviewedAssessmentPrefixSha256 !==
      receipt.bindings.semanticLedger.reviewedAssessmentPrefixSha256 ||
    amendmentBasisAssessmentPrefixSha256 !==
      receipt.bindings.semanticLedger
        .amendmentBasisAssessmentPrefixSha256 ||
    (
      semanticAssessments.length ===
        receipt.bindings.semanticLedger.reviewedAssessmentCount &&
      sha256(semanticLedgerBytes) !==
        receipt.bindings.semanticLedger.reviewedSha256
    )
  ) {
    throw new Error(
      "C6 transition-evaluator reviewed semantic prefix changed",
    );
  }

  const qualification = parseC6RealHistoryTransitionQualification(
    parseBoundJson(boundBytes, receipt.bindings.qualification.path),
  );
  const trajectory = parseBoundJson(
    boundBytes,
    receipt.bindings.trajectory.path,
  ) as C6ReviewTrajectoryDiscovery;
  const transitionScreening =
    await loadC6RealHistoryTransitionEvaluatorScreening({
      fixtureRoot: resolveRepositoryPath(
        input.repositoryRoot,
        receipt.bindings.transitionFixture.path,
      ),
      qualification,
      semanticScreening,
      trajectory,
    });
  if (
    transitionScreening.assetLockSha256 !==
      receipt.bindings.transitionFixture.assetLockSha256 ||
    transitionScreening.assetRootSha256 !==
      receipt.bindings.transitionFixture.assetRootSha256 ||
    transitionScreening.evidence.semanticScreening.assessmentPrefixSha256 !==
      receipt.bindings.semanticPrefixSha256
  ) {
    throw new Error(
      "C6 transition-evaluator review fixture identity changed",
    );
  }
  const assessment = transitionScreening.assessments[0];
  if (
    transitionScreening.assessments.length !== 1 ||
    assessment?.anchorId !== "fmtlib/fmt#974" ||
    assessment.decision !== "reject-machine-qualification" ||
    transitionScreening.derived.machineQualifiedCount !== 0 ||
    transitionScreening.derived.acceptedEpisodeCount !== 0
  ) {
    throw new Error(
      "C6 transition-evaluator review scope no longer matches rejection",
    );
  }
  const terminalSemanticLedgerBytes = await readC6StableRegularFile(
    semanticLedgerPath,
    "transition-evaluator review terminal semantic ledger",
  );
  if (!terminalSemanticLedgerBytes.equals(semanticLedgerBytes)) {
    throw new Error(
      "C6 transition-evaluator semantic ledger changed during review validation",
    );
  }
  const semanticScreeningState =
    inspectC6RealHistorySemanticScreeningLedger(semanticScreening);
  const amendmentBasisSemanticScreeningState =
    inspectC6RealHistorySemanticScreeningLedger({
      ...semanticLedger,
      assessments: semanticAssessments.slice(
        0,
        receipt.bindings.semanticLedger.amendmentBasisAssessmentCount,
      ),
    });
  await verifyC6AssetClosure(input.receiptRoot, receiptLock);
  return {
    receipt,
    receiptAssetLockSha256: receiptLock.assetLockSha256,
    receiptAssetRootSha256: receiptLock.assetLock.assetRootSha256,
    amendmentBasisSemanticScreeningState,
    semanticScreening,
    semanticScreeningState,
    transitionScreening,
  };
}

export function serializeC6TransitionEvaluatorReviewReceipt(
  receipt: C6TransitionEvaluatorReviewReceipt,
): string {
  return `${JSON.stringify(receiptSchema.parse(receipt), null, 2)}\n`;
}

function parseBoundJson(
  boundBytes: ReadonlyMap<string, Buffer>,
  path: string,
): unknown {
  const bytes = boundBytes.get(path);
  if (bytes === undefined) {
    throw new Error(`C6 transition-evaluator review binding missing: ${path}`);
  }
  return JSON.parse(bytes.toString("utf8")) as unknown;
}

function parseJson(bytes: Buffer): unknown {
  return JSON.parse(bytes.toString("utf8")) as unknown;
}

function resolveRepositoryPath(repositoryRoot: string, path: string): string {
  const root = resolve(repositoryRoot);
  const absolutePath = resolve(root, path);
  const relativePath = relative(root, absolutePath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith("../")
  ) {
    throw new Error(
      `C6 transition-evaluator review path leaves repository: ${path}`,
    );
  }
  return absolutePath;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
