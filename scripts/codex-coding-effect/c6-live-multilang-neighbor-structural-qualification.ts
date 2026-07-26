import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  open,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  resolve,
} from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";
import type {
  C6LiveMultiLangNeighborActorOccurrence,
  C6LiveMultiLangNeighborDeepEvidence,
  C6LiveMultiLangNeighborDeepEvidenceTarget,
} from "./c6-live-multilang-neighbor-deep-evidence";
import {
  replayC6LiveMultiLangNeighborDeepEvidence,
} from "./c6-live-multilang-neighbor-deep-evidence";
import {
  C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2,
  projectC6StructuralReviewEvents,
  selectC6MinimumLinearReviewSequence,
  serializeC6StructuralReviewEventPolicy,
} from "./c6-review-event-policy";

const ARTIFACT_KIND =
  "c6-live-multilang-neighbor-structural-qualification";
const REPOSITORY_CAP = 4;
const FROZEN_WAVE1 = {
  assetRootSha256:
    "80c360d58b1959e5a47cbd70c5eb620276ed2105c49a595dccdb4aa178d1f83b",
  completionSha256:
    "62ba6ada2d0ae54f4d43149e592ec06b70899e712a12f97dd503d8650ff2063d",
  directoryCount: 2_771,
  evidenceTargetProjectionSha256:
    "7286f92d0b211ab6830727969d2c40e691e73b1b55197fce221a271ef14edbcf",
  fileCount: 2_772,
  planSha256:
    "9c1ebdafd700a274cffc4dba807a2425013079d1bfe74a1e99f1144399da492a",
  targetCount: 692,
} as const;
const FROZEN_WAVE2 = {
  assetRootSha256:
    "85b3d8db9ef328c3c0bb29025da6b428552435d1188c53dd8aa4b1a4b1f46ea1",
  completionSha256:
    "63b203ec0bd52765e1fedcf980f2cc7cb74d899c004b2ec7499eabfb94b0a939",
  directoryCount: 2_573,
  evidenceTargetProjectionSha256:
    "009e431943a46ceb9aa4312c9436fc2bb4e7ed35cb21050e0b4b05af9f34ae1d",
  fileCount: 2_575,
  planSha256:
    "a0dd0fa0a106d6d1e65645dcec9e44f9e04eb08d7f47e59d25f37920d7cae411",
  targetCount: 642,
} as const;

export const C6_LIVE_MULTILANG_NEIGHBOR_WAVE1_STRUCTURAL_BASELINE = {
  exactStructuralCandidateCount: 34,
  exactStructuralRepositoryCount: 15,
  noExactStructuralSequenceCount: 658,
  projectedStructuralEventCount: 830,
  pullAuthorOccurrenceCount: 692,
  repositoryCappedStructuralCeiling: 30,
  reviewerActorOccurrenceCount: 3_185,
  reviewerUniqueLoginCount: 267,
  targetCount: 692,
} as const;
export const C6_LIVE_MULTILANG_NEIGHBOR_WAVE2_STRUCTURAL_BASELINE = {
  exactStructuralCandidateCount: 22,
  exactStructuralRepositoryCount: 16,
  noExactStructuralSequenceCount: 620,
  projectedStructuralEventCount: 649,
  pullAuthorOccurrenceCount: 642,
  repositoryCappedStructuralCeiling: 22,
  reviewerActorOccurrenceCount: 2_701,
  reviewerUniqueLoginCount: 256,
  targetCount: 642,
} as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const anchorSchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*$/u,
);
const repositorySchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const loginSchema = z.string().min(1).refine(
  (value) =>
    value.trim() === value &&
    !/[/\s]/u.test(value),
  "invalid actor login",
);
const reviewOccurrenceSchema = z.object({
  actorLogin: loginSchema,
  canonicalAnchorId: anchorSchema,
  eventId: z.string().min(1),
  submittedAt: z.iso.datetime().nullable(),
  surface: z.literal("review"),
}).strict();
const commentOccurrenceSchema = z.object({
  actorLogin: loginSchema,
  canonicalAnchorId: anchorSchema,
  createdAt: z.iso.datetime(),
  eventId: z.string().min(1),
  surface: z.literal("review-thread-comment"),
  threadId: z.string().min(1),
}).strict();
const pullAuthorOccurrenceSchema = z.object({
  actorLogin: loginSchema,
  canonicalAnchorId: anchorSchema,
  eventId: z.string().min(1),
  surface: z.literal("pull-author"),
}).strict();
const structuralEventSchema = z.object({
  author: loginSchema,
  body: z.string(),
  bodyBytes: z.number().int().nonnegative(),
  bodySha256: sha256Schema,
  createdAt: z.iso.datetime(),
  id: z.string().min(1),
  reviewedCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  source: z.enum(["review-thread-comment", "whole-review"]),
  threadId: z.string().min(1).nullable(),
}).strict();
const exactSequenceSchema = z.object({
  firstFixCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  firstReview: structuralEventSchema,
  initialCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  secondFixCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  secondReview: structuralEventSchema,
}).strict();
const commonResultSchema = z.object({
  canonicalAnchorId: anchorSchema,
  canonicalRepository: repositorySchema,
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
  pullAuthorLogin: loginSchema,
  reviewSurfaceClosureSha256: sha256Schema,
  structuralEventCount: z.number().int().nonnegative(),
  structuralEventProjectionSha256: sha256Schema,
});
const resultSchema = z.discriminatedUnion("status", [
  commonResultSchema.extend({
    exactSequence: exactSequenceSchema,
    legalSequenceCount: z.number().int().positive(),
    lineageIdentitySha256: sha256Schema,
    status: z.literal(
      "exact-structural-candidate-pre-actor",
    ),
  }).strict(),
  commonResultSchema.extend({
    status: z.literal("no-exact-structural-sequence"),
  }).strict(),
]);
const qualificationSchema = z.object({
  artifactKind: z.literal(ARTIFACT_KIND),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    actorCaptureExecuted: z.literal(false),
    actorQualifiedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    evaluatorQualifiedEpisodeCount: z.literal(0),
    machineQualifiedEpisodeCount: z.literal(0),
    semanticallyQualifiedEpisodeCount: z.literal(0),
    status: z.literal(
      "pre-actor-structural-qualification-only",
    ),
  }).strict(),
  counts: z.object({
    exactStructuralCandidateCount:
      z.number().int().nonnegative(),
    exactStructuralRepositoryCount:
      z.number().int().nonnegative(),
    noExactStructuralSequenceCount:
      z.number().int().nonnegative(),
    projectedStructuralEventCount:
      z.number().int().nonnegative(),
    pullAuthorOccurrenceCount:
      z.number().int().nonnegative(),
    repositoryCappedStructuralCeiling:
      z.number().int().nonnegative(),
    reviewerActorOccurrenceCount:
      z.number().int().nonnegative(),
    reviewerUniqueLoginCount:
      z.number().int().nonnegative(),
    targetCount: z.number().int().positive(),
  }).strict(),
  independenceBoundary: z.object({
    acceptedEpisodeInput: z.literal(false),
    actorEligibilityInput: z.literal(false),
    evaluatorDecisionInput: z.literal(false),
    goldInput: z.literal(false),
    hiddenTestInput: z.literal(false),
    machineOutcomeInput: z.literal(false),
    patchInput: z.literal(false),
    pullAuthorOccurrenceProjectionSha256: sha256Schema,
    reviewerActorOccurrenceProjectionSha256: sha256Schema,
    reviewerLoginProjectionSha256: sha256Schema,
    semanticDecisionInput: z.literal(false),
    structuralResultProjectionSha256: sha256Schema,
  }).strict(),
  inputs: z.object({
    deepCapturePlan: z.object({
      bytes: z.number().int().positive(),
      path: z.string().min(1).refine(
        (value) => basename(value) === value,
        "plan path must be a basename",
      ),
      sha256: sha256Schema,
    }).strict(),
    deepEvidence: z.object({
      assetRootSha256: sha256Schema,
      completionSha256: sha256Schema,
      directoryCount: z.number().int().positive(),
      fileCount: z.number().int().positive(),
      finalSuccessfulResponseCount:
        z.number().int().positive(),
      logicalRequestCount: z.number().int().positive(),
      networkRequestCount: z.number().int().positive(),
      targetProjectionSha256: sha256Schema,
    }).strict(),
  }).strict(),
  policy: z.object({
    policyId: z.literal("prospective-structural-review-v2"),
    schemaVersion: z.literal(2),
    sha256: sha256Schema,
  }).strict(),
  pullAuthorOccurrences: z.array(pullAuthorOccurrenceSchema),
  results: z.array(resultSchema).min(1),
  reviewerActorOccurrences: z.array(
    z.discriminatedUnion("surface", [
      reviewOccurrenceSchema,
      commentOccurrenceSchema,
    ]),
  ),
  reviewerLogins: z.array(loginSchema),
  rule: z.object({
    actorSurface: z.literal(
      "all-non-null-review-and-review-thread-comment-authors",
    ),
    nullSubmittedReview: z.literal(
      "retained-in-actor-closure-excluded-from-structural-events",
    ),
    pullAuthor: z.literal(
      "bound-separately-and-excluded-from-reviewer-actor-closure",
    ),
    repositoryCap: z.literal(REPOSITORY_CAP),
    resultOrder: z.literal("deep-evidence-target-order"),
    reviewerLoginNormalization: z.literal(
      "case-insensitive-login",
    ),
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();

export type C6LiveMultiLangNeighborStructuralQualification =
  z.infer<typeof qualificationSchema>;
export type C6LiveMultiLangNeighborStructuralQualificationResult =
  z.infer<typeof resultSchema>;

export interface C6LiveMultiLangNeighborStructuralQualificationTestHooks {
  afterEvidenceReplay?: (
    evidence: C6LiveMultiLangNeighborDeepEvidence,
  ) => Promise<void> | void;
  afterOutputPublication?: () => Promise<void> | void;
  beforeTerminalReplay?: () => Promise<void> | void;
}

export interface C6LiveMultiLangNeighborStructuralQualificationBuildInput {
  deepCaptureRoot: string;
  planPath: string;
  testHooks?:
    C6LiveMultiLangNeighborStructuralQualificationTestHooks;
  tranche: "wave1" | "wave2";
}

export function deriveC6LiveMultiLangNeighborStructuralQualification(
  input: {
    evidence: C6LiveMultiLangNeighborDeepEvidence;
    plan: {
      bytes: number;
      path: string;
      sha256: string;
    };
  },
): C6LiveMultiLangNeighborStructuralQualification {
  assertNoForbiddenEvidenceMetadataKeys(input.evidence);
  const plan = {
    bytes: z.number().int().positive().parse(input.plan.bytes),
    path: basename(input.plan.path),
    sha256: sha256Schema.parse(input.plan.sha256),
  };
  if (
    plan.path !== input.plan.path ||
    plan.sha256 !== input.evidence.planSha256
  ) {
    throw new Error(
      "C6 neighbor structural qualification plan binding mismatch",
    );
  }

  const reconstructedOccurrences =
    input.evidence.targets.flatMap(reconstructTargetOccurrences);
  if (
    JSON.stringify(reconstructedOccurrences) !==
      JSON.stringify(input.evidence.actorOccurrences)
  ) {
    throw new Error(
      "C6 neighbor structural qualification actor closure mismatch",
    );
  }
  const reviewerActorOccurrences = reconstructedOccurrences.filter(
    (occurrence): occurrence is Exclude<
      C6LiveMultiLangNeighborActorOccurrence,
      { surface: "pull-author" }
    > => occurrence.surface !== "pull-author",
  );
  const pullAuthorOccurrences = reconstructedOccurrences.filter(
    (occurrence): occurrence is Extract<
      C6LiveMultiLangNeighborActorOccurrence,
      { surface: "pull-author" }
    > => occurrence.surface === "pull-author",
  );
  const reviewerLogins = [...new Set(
    reviewerActorOccurrences.map((occurrence) =>
      normalizeLogin(occurrence.actorLogin)
    ),
  )].sort(compareStrings);

  const seenAnchors = new Set<string>();
  const seenDirectories = new Set<string>();
  const results = input.evidence.targets.map((target, index) => {
    assertTargetIdentity(target, index + 1);
    if (
      seenAnchors.has(target.canonicalAnchorId) ||
      seenDirectories.has(target.captureDirectory)
    ) {
      throw new Error(
        "C6 neighbor structural qualification duplicate target",
      );
    }
    seenAnchors.add(target.canonicalAnchorId);
    seenDirectories.add(target.captureDirectory);
    const events = projectC6StructuralReviewEvents({
      pullAuthor: target.identity.authorLogin,
      reviews: target.reviews.flatMap((review) =>
        review.submittedAt === null
          ? []
          : [{
            author: review.authorLogin,
            body: review.body,
            commit: review.commitOid,
            id: review.id,
            state: review.state,
            submittedAt: review.submittedAt,
          }]
      ),
      reviewThreads: target.reviewThreads.map((thread) => ({
        comments: thread.comments.map((comment) => ({
          author: comment.authorLogin,
          body: comment.body,
          createdAt: comment.createdAt,
          id: comment.id,
          originalCommit: comment.originalCommitOid,
        })),
        id: thread.id,
      })),
    });
    const exact = selectC6MinimumLinearReviewSequence({
      anchorId: target.canonicalAnchorId,
      commits: target.commits.map((commit) => ({
        committedAt: commit.committedDate,
        oid: commit.oid,
        parents: commit.parentOids,
      })),
      events,
    });
    const common = {
      canonicalAnchorId: target.canonicalAnchorId,
      canonicalRepository:
        target.identity.repositoryNameWithOwner.toLowerCase(),
      captureDirectory: target.captureDirectory,
      captureOrder: index + 1,
      pullAuthorLogin: target.identity.authorLogin,
      reviewSurfaceClosureSha256:
        target.reviewSurfaceClosureSha256,
      structuralEventCount: events.length,
      structuralEventProjectionSha256: sha256(
        JSON.stringify(events),
      ),
    };
    return exact === null
      ? {
        ...common,
        status: "no-exact-structural-sequence" as const,
      }
      : {
        ...common,
        exactSequence: exact.sequence,
        legalSequenceCount: exact.legalSequenceCount,
        lineageIdentitySha256: exact.lineageIdentitySha256,
        status:
          "exact-structural-candidate-pre-actor" as const,
      };
  });
  const exactResults = results.filter((result) =>
    result.status === "exact-structural-candidate-pre-actor"
  );
  const exactByRepository = new Map<string, number>();
  for (const result of exactResults) {
    exactByRepository.set(
      result.canonicalRepository,
      (exactByRepository.get(result.canonicalRepository) ?? 0) + 1,
    );
  }
  const qualification = {
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      actorQualifiedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      evaluatorQualifiedEpisodeCount: 0,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status: "pre-actor-structural-qualification-only",
    },
    counts: {
      exactStructuralCandidateCount: exactResults.length,
      exactStructuralRepositoryCount: exactByRepository.size,
      noExactStructuralSequenceCount:
        results.length - exactResults.length,
      projectedStructuralEventCount: results.reduce(
        (count, result) =>
          count + result.structuralEventCount,
        0,
      ),
      pullAuthorOccurrenceCount: pullAuthorOccurrences.length,
      repositoryCappedStructuralCeiling:
        [...exactByRepository.values()].reduce(
          (count, repositoryCount) =>
            count + Math.min(REPOSITORY_CAP, repositoryCount),
          0,
        ),
      reviewerActorOccurrenceCount:
        reviewerActorOccurrences.length,
      reviewerUniqueLoginCount: reviewerLogins.length,
      targetCount: results.length,
    },
    independenceBoundary: {
      acceptedEpisodeInput: false,
      actorEligibilityInput: false,
      evaluatorDecisionInput: false,
      goldInput: false,
      hiddenTestInput: false,
      machineOutcomeInput: false,
      patchInput: false,
      pullAuthorOccurrenceProjectionSha256: sha256(
        JSON.stringify(pullAuthorOccurrences),
      ),
      reviewerActorOccurrenceProjectionSha256: sha256(
        JSON.stringify(reviewerActorOccurrences),
      ),
      reviewerLoginProjectionSha256: sha256(
        JSON.stringify(reviewerLogins),
      ),
      semanticDecisionInput: false,
      structuralResultProjectionSha256: sha256(
        JSON.stringify(results),
      ),
    },
    inputs: {
      deepCapturePlan: plan,
      deepEvidence: {
        assetRootSha256: input.evidence.assetRootSha256,
        completionSha256: input.evidence.completionSha256,
        directoryCount: input.evidence.directoryCount,
        fileCount: input.evidence.fileCount,
        finalSuccessfulResponseCount:
          input.evidence.finalSuccessfulResponseCount,
        logicalRequestCount: input.evidence.logicalRequestCount,
        networkRequestCount: input.evidence.networkRequestCount,
        targetProjectionSha256: sha256(
          JSON.stringify(input.evidence.targets),
        ),
      },
    },
    policy: {
      policyId: C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2.policyId,
      schemaVersion:
        C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2.schemaVersion,
      sha256: sha256(serializeC6StructuralReviewEventPolicy()),
    },
    pullAuthorOccurrences,
    results,
    reviewerActorOccurrences,
    reviewerLogins,
    rule: {
      actorSurface:
        "all-non-null-review-and-review-thread-comment-authors",
      nullSubmittedReview:
        "retained-in-actor-closure-excluded-from-structural-events",
      pullAuthor:
        "bound-separately-and-excluded-from-reviewer-actor-closure",
      repositoryCap: REPOSITORY_CAP,
      resultOrder: "deep-evidence-target-order",
      reviewerLoginNormalization: "case-insensitive-login",
    },
    schemaVersion: 1,
  } as const;
  const parsed = qualificationSchema.parse(qualification);
  assertQualificationSelfConsistency(parsed);
  return parsed;
}

export function serializeC6LiveMultiLangNeighborStructuralQualification(
  qualification: C6LiveMultiLangNeighborStructuralQualification,
): string {
  return `${JSON.stringify(qualification, null, 2)}\n`;
}

export function parseC6LiveMultiLangNeighborStructuralQualification(
  input: string | Uint8Array,
): C6LiveMultiLangNeighborStructuralQualification {
  const text = typeof input === "string"
    ? input
    : Buffer.from(input).toString("utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 neighbor structural qualification invalid JSON",
    );
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 neighbor structural qualification requires canonical JSON",
    );
  }
  const qualification = qualificationSchema.parse(raw);
  assertQualificationSelfConsistency(qualification);
  return qualification;
}

export async function buildC6LiveMultiLangNeighborStructuralQualification(
  input: C6LiveMultiLangNeighborStructuralQualificationBuildInput,
): Promise<{
  outputSha256: string;
  qualification: C6LiveMultiLangNeighborStructuralQualification;
}> {
  const frozen = frozenStructuralTranche(input.tranche);
  const planPath = await assertC6NoSymlinkPathComponents(
    input.planPath,
    "C6 neighbor structural qualification plan",
  );
  const planBytes = await readC6StableRegularFile(
    planPath,
    "neighbor structural qualification plan",
  );
  if (sha256(planBytes) !== frozen.planSha256) {
    throw new Error(
      "C6 neighbor structural qualification plan hash mismatch",
    );
  }
  const evidence = await replayFrozenEvidence({
    deepCaptureRoot: input.deepCaptureRoot,
    frozen,
    planPath,
  });
  await input.testHooks?.afterEvidenceReplay?.(evidence);
  if (
    sha256(JSON.stringify(evidence.targets)) !==
      frozen.evidenceTargetProjectionSha256
  ) {
    throw new Error(
      "C6 neighbor structural qualification target projection mismatch",
    );
  }
  const qualification =
    deriveC6LiveMultiLangNeighborStructuralQualification({
      evidence,
      plan: {
        bytes: planBytes.byteLength,
        path: basename(planPath),
        sha256: frozen.planSha256,
      },
    });
  assertFrozenBaseline(qualification, frozen);

  await input.testHooks?.beforeTerminalReplay?.();
  const [terminalEvidence, terminalPlanBytes] = await Promise.all([
    replayFrozenEvidence({
      deepCaptureRoot: input.deepCaptureRoot,
      frozen,
      planPath,
    }),
    readC6StableRegularFile(
      planPath,
      "neighbor structural qualification terminal plan",
    ),
  ]);
  if (
    !terminalPlanBytes.equals(planBytes) ||
    JSON.stringify(terminalEvidence) !== JSON.stringify(evidence)
  ) {
    throw new Error(
      "C6 neighbor structural qualification input closure changed",
    );
  }
  const serialized =
    serializeC6LiveMultiLangNeighborStructuralQualification(
      qualification,
    );
  parseC6LiveMultiLangNeighborStructuralQualification(serialized);
  return {
    outputSha256: sha256(serialized),
    qualification,
  };
}

export async function materializeC6LiveMultiLangNeighborStructuralQualification(
  input:
    C6LiveMultiLangNeighborStructuralQualificationBuildInput & {
      outputPath: string;
    },
): Promise<{
  outputSha256: string;
  qualification: C6LiveMultiLangNeighborStructuralQualification;
}> {
  const result =
    await buildC6LiveMultiLangNeighborStructuralQualification(
      input,
    );
  const serialized =
    serializeC6LiveMultiLangNeighborStructuralQualification(
      result.qualification,
    );
  const outputPath = resolve(input.outputPath);
  const outputParent = await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 neighbor structural qualification output parent",
  );
  const temporaryPath = join(
    outputParent,
    `.${basename(outputPath)}.incomplete-${randomUUID()}`,
  );
  let ownedIdentity: OwnedFileIdentity | null = null;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      const openedStat = await handle.stat();
      if (
        !openedStat.isFile() ||
        (openedStat.mode & 0o7777) !== 0o600
      ) {
        throw new Error(
          "C6 neighbor structural qualification temporary output identity mismatch",
        );
      }
      ownedIdentity = {
        dev: openedStat.dev,
        ino: openedStat.ino,
      };
      await handle.writeFile(serialized, "utf8");
      await handle.chmod(0o644);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const temporaryBytes = await readC6StableRegularFile(
      temporaryPath,
      "neighbor structural qualification temporary output",
    );
    if (temporaryBytes.toString("utf8") !== serialized) {
      throw new Error(
        "C6 neighbor structural qualification temporary output mismatch",
      );
    }
    await assertC6NoSymlinkPathComponents(
      outputParent,
      "C6 neighbor structural qualification terminal output parent",
    );
    await link(temporaryPath, outputPath);
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });

    await input.testHooks?.afterOutputPublication?.();
    const replayed =
      await buildC6LiveMultiLangNeighborStructuralQualification({
        deepCaptureRoot: input.deepCaptureRoot,
        planPath: input.planPath,
        tranche: input.tranche,
      });
    if (
      replayed.outputSha256 !== result.outputSha256 ||
      serializeC6LiveMultiLangNeighborStructuralQualification(
        replayed.qualification,
      ) !== serialized
    ) {
      throw new Error(
        "C6 neighbor structural qualification post-publication replay mismatch",
      );
    }
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });
    const publishedBytes = await readC6StableRegularFile(
      outputPath,
      "neighbor structural qualification published output",
    );
    const publishedQualification =
      parseC6LiveMultiLangNeighborStructuralQualification(
        publishedBytes,
      );
    if (
      serializeC6LiveMultiLangNeighborStructuralQualification(
        publishedQualification,
      ) !== serialized
    ) {
      throw new Error(
        "C6 neighbor structural qualification published output mismatch",
      );
    }
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });
    if (
      !await removePathIfOwned(temporaryPath, ownedIdentity)
    ) {
      throw new Error(
        "C6 neighbor structural qualification temporary output cleanup mismatch",
      );
    }
  } catch (error) {
    if (ownedIdentity !== null) {
      await removePathIfOwned(outputPath, ownedIdentity);
      await removePathIfOwned(temporaryPath, ownedIdentity);
    }
    throw error;
  }
  return result;
}

interface OwnedFileIdentity {
  dev: number;
  ino: number;
}

async function assertPublishedOutputOwnership(input: {
  outputPath: string;
  ownedIdentity: OwnedFileIdentity;
  temporaryPath: string;
}): Promise<void> {
  const [outputStat, temporaryStat] = await Promise.all([
    lstat(input.outputPath),
    lstat(input.temporaryPath),
  ]);
  if (
    !outputStat.isFile() ||
    outputStat.isSymbolicLink() ||
    !temporaryStat.isFile() ||
    temporaryStat.isSymbolicLink() ||
    outputStat.dev !== input.ownedIdentity.dev ||
    outputStat.ino !== input.ownedIdentity.ino ||
    temporaryStat.dev !== input.ownedIdentity.dev ||
    temporaryStat.ino !== input.ownedIdentity.ino ||
    (outputStat.mode & 0o7777) !== 0o644 ||
    (temporaryStat.mode & 0o7777) !== 0o644
  ) {
    throw new Error(
      "C6 neighbor structural qualification published output ownership mismatch",
    );
  }
}

async function removePathIfOwned(
  path: string,
  ownedIdentity: OwnedFileIdentity,
): Promise<boolean> {
  const stat = await lstat(path).catch(() => null);
  if (
    stat === null ||
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.dev !== ownedIdentity.dev ||
    stat.ino !== ownedIdentity.ino
  ) {
    return false;
  }
  await rm(path, { force: true });
  return true;
}

function replayFrozenEvidence(input: {
  deepCaptureRoot: string;
  frozen: FrozenStructuralTranche;
  planPath: string;
}): Promise<C6LiveMultiLangNeighborDeepEvidence> {
  return replayC6LiveMultiLangNeighborDeepEvidence({
    deepCaptureRoot: input.deepCaptureRoot,
    expectedAssetRootSha256: input.frozen.assetRootSha256,
    expectedCompletionSha256: input.frozen.completionSha256,
    expectedDirectoryCount: input.frozen.directoryCount,
    expectedFileCount: input.frozen.fileCount,
    expectedPlanSha256: input.frozen.planSha256,
    expectedTargetCount: input.frozen.targetCount,
    planPath: input.planPath,
  });
}

function reconstructTargetOccurrences(
  target: C6LiveMultiLangNeighborDeepEvidenceTarget,
): C6LiveMultiLangNeighborActorOccurrence[] {
  const occurrences: C6LiveMultiLangNeighborActorOccurrence[] = [{
    actorLogin: target.identity.authorLogin,
    canonicalAnchorId: target.canonicalAnchorId,
    eventId: target.identity.pullRequestId,
    surface: "pull-author",
  }];
  for (const review of target.reviews) {
    if (review.authorLogin !== null) {
      occurrences.push({
        actorLogin: review.authorLogin,
        canonicalAnchorId: target.canonicalAnchorId,
        eventId: review.id,
        submittedAt: review.submittedAt,
        surface: "review",
      });
    }
  }
  for (const thread of target.reviewThreads) {
    for (const comment of thread.comments) {
      if (comment.authorLogin !== null) {
        occurrences.push({
          actorLogin: comment.authorLogin,
          canonicalAnchorId: target.canonicalAnchorId,
          createdAt: comment.createdAt,
          eventId: comment.id,
          surface: "review-thread-comment",
          threadId: thread.id,
        });
      }
    }
  }
  if (
    JSON.stringify(occurrences) !==
      JSON.stringify(target.actorOccurrences)
  ) {
    throw new Error(
      `C6 neighbor structural qualification target actor closure mismatch ${
        target.canonicalAnchorId
      }`,
    );
  }
  return occurrences;
}

function assertTargetIdentity(
  target: C6LiveMultiLangNeighborDeepEvidenceTarget,
  captureOrder: number,
): void {
  const canonicalRepository =
    target.identity.repositoryNameWithOwner.toLowerCase();
  if (
    target.canonicalAnchorId !==
      `${canonicalRepository}#${target.identity.pullRequestNumber}` ||
    target.identity.baseRepositoryNameWithOwner.toLowerCase() !==
      canonicalRepository ||
    target.captureDirectory.length === 0 ||
    captureOrder <= 0
  ) {
    throw new Error(
      `C6 neighbor structural qualification target identity mismatch ${
        target.canonicalAnchorId
      }`,
    );
  }
}

function assertFrozenBaseline(
  qualification:
    C6LiveMultiLangNeighborStructuralQualification,
  frozen: FrozenStructuralTranche,
): void {
  if (
    JSON.stringify(qualification.counts) !==
      JSON.stringify(frozen.baseline) ||
    qualification.inputs.deepEvidence.assetRootSha256 !==
      frozen.assetRootSha256 ||
    qualification.inputs.deepEvidence.completionSha256 !==
      frozen.completionSha256 ||
    qualification.inputs.deepEvidence.targetProjectionSha256 !==
      frozen.evidenceTargetProjectionSha256
  ) {
    throw new Error(
      "C6 neighbor structural qualification frozen baseline mismatch",
    );
  }
}

type FrozenStructuralTranche =
  | typeof FROZEN_WAVE1 & {
    baseline:
      typeof C6_LIVE_MULTILANG_NEIGHBOR_WAVE1_STRUCTURAL_BASELINE;
  }
  | typeof FROZEN_WAVE2 & {
    baseline:
      typeof C6_LIVE_MULTILANG_NEIGHBOR_WAVE2_STRUCTURAL_BASELINE;
  };

function frozenStructuralTranche(
  tranche: "wave1" | "wave2",
): FrozenStructuralTranche {
  if (tranche === "wave1") {
    return {
      ...FROZEN_WAVE1,
      baseline:
        C6_LIVE_MULTILANG_NEIGHBOR_WAVE1_STRUCTURAL_BASELINE,
    };
  }
  if (tranche === "wave2") {
    return {
      ...FROZEN_WAVE2,
      baseline:
        C6_LIVE_MULTILANG_NEIGHBOR_WAVE2_STRUCTURAL_BASELINE,
    };
  }
  throw new Error(
    "C6 neighbor structural qualification tranche mismatch",
  );
}

function assertQualificationSelfConsistency(
  qualification:
    C6LiveMultiLangNeighborStructuralQualification,
): void {
  const exact = qualification.results.filter((result) =>
    result.status === "exact-structural-candidate-pre-actor"
  );
  const exactByRepository = new Map<string, number>();
  for (const result of exact) {
    exactByRepository.set(
      result.canonicalRepository,
      (exactByRepository.get(result.canonicalRepository) ?? 0) + 1,
    );
  }
  const reviewerLogins = [...new Set(
    qualification.reviewerActorOccurrences.map((occurrence) =>
      normalizeLogin(occurrence.actorLogin)
    ),
  )].sort(compareStrings);
  const anchors = new Set<string>();
  for (const [index, result] of qualification.results.entries()) {
    if (
      result.captureOrder !== index + 1 ||
      result.canonicalRepository !==
        result.canonicalAnchorId.split("#")[0] ||
      anchors.has(result.canonicalAnchorId)
    ) {
      throw new Error(
        "C6 neighbor structural qualification result order mismatch",
      );
    }
    anchors.add(result.canonicalAnchorId);
  }
  const counts = qualification.counts;
  if (
    counts.targetCount !== qualification.results.length ||
    counts.exactStructuralCandidateCount !== exact.length ||
    counts.noExactStructuralSequenceCount !==
      qualification.results.length - exact.length ||
    counts.exactStructuralRepositoryCount !==
      exactByRepository.size ||
    counts.projectedStructuralEventCount !==
      qualification.results.reduce(
        (count, result) =>
          count + result.structuralEventCount,
        0,
      ) ||
    counts.repositoryCappedStructuralCeiling !==
      [...exactByRepository.values()].reduce(
        (count, repositoryCount) =>
          count + Math.min(REPOSITORY_CAP, repositoryCount),
        0,
      ) ||
    counts.reviewerActorOccurrenceCount !==
      qualification.reviewerActorOccurrences.length ||
    counts.pullAuthorOccurrenceCount !==
      qualification.pullAuthorOccurrences.length ||
    counts.reviewerUniqueLoginCount !== reviewerLogins.length ||
    JSON.stringify(qualification.reviewerLogins) !==
      JSON.stringify(reviewerLogins) ||
    qualification.independenceBoundary
      .reviewerActorOccurrenceProjectionSha256 !==
        sha256(JSON.stringify(
          qualification.reviewerActorOccurrences,
        )) ||
    qualification.independenceBoundary
      .pullAuthorOccurrenceProjectionSha256 !==
        sha256(JSON.stringify(
          qualification.pullAuthorOccurrences,
        )) ||
    qualification.independenceBoundary
      .reviewerLoginProjectionSha256 !==
        sha256(JSON.stringify(qualification.reviewerLogins)) ||
    qualification.independenceBoundary
      .structuralResultProjectionSha256 !==
        sha256(JSON.stringify(qualification.results)) ||
    qualification.policy.sha256 !==
      sha256(serializeC6StructuralReviewEventPolicy())
  ) {
    throw new Error(
      "C6 neighbor structural qualification self-consistency mismatch",
    );
  }
  for (const occurrence of [
    ...qualification.reviewerActorOccurrences,
    ...qualification.pullAuthorOccurrences,
  ]) {
    if (!anchors.has(occurrence.canonicalAnchorId)) {
      throw new Error(
        "C6 neighbor structural qualification orphan actor occurrence",
      );
    }
  }
}

function assertNoForbiddenEvidenceMetadataKeys(
  value: unknown,
  path = "$",
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoForbiddenEvidenceMetadataKeys(
        entry,
        `${path}[${index}]`,
      )
    );
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const collapsed = key.toLowerCase().replace(
      /[^a-z0-9]/gu,
      "",
    );
    if (
      collapsed.includes("acceptedepisode") ||
      collapsed.includes("evaluator") ||
      collapsed.includes("evaluation") ||
      collapsed.includes("gold") ||
      collapsed.includes("hidden") ||
      collapsed.includes("machineoutcome") ||
      collapsed.includes("oracle") ||
      collapsed.includes("patch") ||
      collapsed.includes("semanticdecision") ||
      collapsed.includes("test") ||
      collapsed.includes("outcome")
    ) {
      throw new Error(
        `C6 neighbor structural qualification forbidden evidence metadata key ${
          path
        }.${key}`,
      );
    }
    assertNoForbiddenEvidenceMetadataKeys(entry, `${path}.${key}`);
  }
}

function normalizeLogin(value: string): string {
  const login = loginSchema.parse(value);
  return login.toLowerCase();
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
