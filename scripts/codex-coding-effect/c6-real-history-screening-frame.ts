import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

import { z } from "zod";

import {
  replayC6RealHistoryPrehistorySelection,
  serializeC6RealHistoryPrehistorySelection,
} from "./c6-real-history-prehistory-selection";
import type {
  C6RealHistoryPrehistorySelection,
} from "./c6-real-history-prehistory-selection";
import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";

const MINIMUM_REQUIRED_EPISODES = 48;
const REPOSITORY_CAP = 4;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const sourceSchema = z.object({
  path: z.string().min(1),
  rowIndex: z.number().int().nonnegative(),
  rowSha256: sha256Schema,
}).strict();
const reviewSchema = z.object({
  author: z.string().min(1),
  bodySha256: sha256Schema,
  createdAt: z.iso.datetime(),
  reviewedCommit: commitSchema,
}).strict();
const sequenceSchema = z.object({
  firstFixCommit: commitSchema,
  firstReview: reviewSchema,
  initialCommit: commitSchema,
  secondFixCommit: commitSchema,
  secondReview: reviewSchema,
}).strict();
const candidateSchema = z.object({
  anchorId: z.string().min(1),
  eligibleRank: z.number().int().positive(),
  frameTier: z.enum([
    "existing-capped-prefix",
    "repository-cap-backfill",
  ]),
  lineageIdentitySha256: sha256Schema,
  linearReviewAncestry: sequenceSchema,
  originalCappedPoolRank: z.number().int().positive().nullable(),
  rankSha256: sha256Schema,
  repository: z.string().min(3),
  repositoryRank: z.number().int().positive(),
  screeningRank: z.number().int().positive(),
  source: sourceSchema,
}).strict();
const amendmentBasisSchema = z.object({
  knownDefinitiveRejectionCount: z.literal(12),
  semanticAssessmentCount: z.literal(12),
  semanticAssessmentPrefixSha256: sha256Schema,
  transitionReviewReceiptAssetLockSha256: sha256Schema,
  transitionReviewReceiptAssetRootSha256: sha256Schema,
}).strict();
const frameSchema = z.object({
  amendmentBasis: amendmentBasisSchema,
  artifactKind: z.literal("c6-real-history-screening-frame"),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    status: z.literal(
      "expanded-screening-frame-only-qualification-required",
    ),
  }).strict(),
  candidates: z.array(candidateSchema).min(MINIMUM_REQUIRED_EPISODES),
  counts: z.object({
    backfillCandidateCount: z.number().int().nonnegative(),
    eligibleCandidateCount: z.number().int().positive(),
    existingCappedPrefixCount: z.number().int().positive(),
    minimumRequiredEpisodes: z.literal(MINIMUM_REQUIRED_EPISODES),
    repositoryCount: z.number().int().positive(),
    theoreticalMaximumUnderRepositoryCap: z.number().int().positive(),
  }).strict(),
  independenceBoundary: z.object({
    candidateProjectionSha256: sha256Schema,
    knownRejectionsPredateAmendment: z.literal(true),
    personnelOutcomeBlindnessClaimed: z.literal(false),
    selectionDependsOnForbiddenFields: z.literal(false),
    selectionDependsOnKnownRejectionIdentities: z.literal(false),
    temporalOrderCryptographicallyAttested: z.literal(false),
    status: z.literal(
      "outcome-field-independent-order-with-retrospective-review-metadata",
    ),
  }).strict(),
  input: z.object({
    path: z.string().min(1),
    sha256: sha256Schema,
  }).strict(),
  policy: z.object({
    amendmentTiming: z.literal(
      "policy-selected-after-rank-12-before-rank-13-review-materialized-later",
    ),
    candidateFrameOrder: z.literal(
      "existing-cappedPoolRank-prefix-then-deferred-by-eligibleRank",
    ),
    finalQualifiedAllocation: z.literal(
      "within-repository-first-4-qualified-by-screeningRank-then-global-first-48-by-screeningRank",
    ),
    forbiddenFields: z.tuple([
      z.literal("sourceTestSignals"),
      z.literal("patch"),
      z.literal("test"),
      z.literal("gold"),
      z.literal("outcome"),
      z.literal("semanticScreeningDecision"),
      z.literal("machineQualificationDecision"),
    ]),
    minimumRequiredEpisodes: z.literal(MINIMUM_REQUIRED_EPISODES),
    repositoryCap: z.literal(REPOSITORY_CAP),
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();

export type C6RealHistoryScreeningFrame = z.infer<typeof frameSchema>;

export interface C6RealHistoryScreeningFrameCapacity {
  canMeetMinimumUnderRepositoryCap: boolean;
  candidateExpansionRequired: boolean;
  definitivelyRejectedCandidateCount: number;
  existingCappedPoolMaximumPossible: number;
  minimumRequiredEpisodes: number;
  remainingEligibleCandidateCount: number;
  selectableMargin: number;
  theoreticalMaximumSelectable: number;
}

export interface C6RealHistoryScreeningFrameAllocation {
  allocationComplete: boolean;
  qualifiedCandidateCount: number;
  repositoryCappedQualifiedCandidateCount: number;
  selectedCandidates: C6RealHistoryScreeningFrame["candidates"];
}

export function projectC6RealHistoryScreeningFrame(input: {
  amendmentBasis: z.infer<typeof amendmentBasisSchema>;
  inputPath: string;
  inputSha256: string;
  selection: C6RealHistoryPrehistorySelection;
}): C6RealHistoryScreeningFrame {
  const inputSha256 = sha256Schema.parse(input.inputSha256);
  const serializedSelection =
    serializeC6RealHistoryPrehistorySelection(input.selection);
  if (sha256(serializedSelection) !== inputSha256) {
    throw new Error(
      "C6 real-history screening frame input identity does not match",
    );
  }
  const closure = input.selection.eligibleRankClosure;
  if (closure.length !== input.selection.counts.eligibleSeedCount) {
    throw new Error(
      "C6 real-history screening frame eligible closure is incomplete",
    );
  }
  assertUniqueAndContiguous(
    closure.map((candidate) => candidate.eligibleRank),
    closure.length,
    "eligible rank",
  );
  if (new Set(closure.map((candidate) => candidate.anchorId)).size !==
    closure.length) {
    throw new Error(
      "C6 real-history screening frame contains duplicate anchors",
    );
  }
  const existingPrefix = closure
    .filter((candidate) => candidate.cappedPoolRank !== null)
    .sort((left, right) =>
      left.cappedPoolRank! - right.cappedPoolRank!
    );
  assertUniqueAndContiguous(
    existingPrefix.map((candidate) => candidate.cappedPoolRank!),
    input.selection.counts.cappedSeedPoolCount,
    "capped pool rank",
  );
  const backfill = closure
    .filter((candidate) => candidate.cappedPoolRank === null)
    .sort((left, right) => left.eligibleRank - right.eligibleRank);
  const ordered = [...existingPrefix, ...backfill];
  const candidates = ordered.map((candidate, index) => ({
    anchorId: candidate.anchorId,
    eligibleRank: candidate.eligibleRank,
    frameTier: candidate.cappedPoolRank === null
      ? "repository-cap-backfill" as const
      : "existing-capped-prefix" as const,
    lineageIdentitySha256: candidate.lineageIdentitySha256,
    linearReviewAncestry: candidate.linearReviewAncestry,
    originalCappedPoolRank: candidate.cappedPoolRank,
    rankSha256: candidate.rankSha256,
    repository: candidate.repository,
    repositoryRank: candidate.repositoryRank,
    screeningRank: index + 1,
    source: candidate.source,
  }));
  const repositories = groupByRepository(candidates);
  const theoreticalMaximumUnderRepositoryCap = [...repositories.values()]
    .reduce(
      (total, repositoryCandidates) =>
        total + Math.min(REPOSITORY_CAP, repositoryCandidates.length),
      0,
    );
  if (theoreticalMaximumUnderRepositoryCap <
    MINIMUM_REQUIRED_EPISODES) {
    throw new Error(
      "C6 real-history screening frame cannot meet the minimum under the repository cap",
    );
  }

  return frameSchema.parse({
    amendmentBasis: amendmentBasisSchema.parse(input.amendmentBasis),
    artifactKind: "c6-real-history-screening-frame",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      status: "expanded-screening-frame-only-qualification-required",
    },
    candidates,
    counts: {
      backfillCandidateCount: backfill.length,
      eligibleCandidateCount: candidates.length,
      existingCappedPrefixCount: existingPrefix.length,
      minimumRequiredEpisodes: MINIMUM_REQUIRED_EPISODES,
      repositoryCount: repositories.size,
      theoreticalMaximumUnderRepositoryCap,
    },
    independenceBoundary: {
      candidateProjectionSha256: sha256(JSON.stringify(candidates)),
      knownRejectionsPredateAmendment: true,
      personnelOutcomeBlindnessClaimed: false,
      selectionDependsOnForbiddenFields: false,
      selectionDependsOnKnownRejectionIdentities: false,
      temporalOrderCryptographicallyAttested: false,
      status:
        "outcome-field-independent-order-with-retrospective-review-metadata",
    },
    input: {
      path: basename(resolve(input.inputPath)),
      sha256: inputSha256,
    },
    policy: {
      amendmentTiming:
        "policy-selected-after-rank-12-before-rank-13-review-materialized-later",
      candidateFrameOrder:
        "existing-cappedPoolRank-prefix-then-deferred-by-eligibleRank",
      finalQualifiedAllocation:
        "within-repository-first-4-qualified-by-screeningRank-then-global-first-48-by-screeningRank",
      forbiddenFields: [
        "sourceTestSignals",
        "patch",
        "test",
        "gold",
        "outcome",
        "semanticScreeningDecision",
        "machineQualificationDecision",
      ],
      minimumRequiredEpisodes: MINIMUM_REQUIRED_EPISODES,
      repositoryCap: REPOSITORY_CAP,
    },
    schemaVersion: 1,
  });
}

export function deriveC6RealHistoryScreeningFrameCapacity(input: {
  frame: C6RealHistoryScreeningFrame;
  rejectedAnchorIds: readonly string[];
}): C6RealHistoryScreeningFrameCapacity {
  const frame = frameSchema.parse(input.frame);
  assertC6RealHistoryScreeningFrameClosure(frame);
  const rejected = new Set<string>();
  const knownAnchors = new Set(
    frame.candidates.map((candidate) => candidate.anchorId),
  );
  for (const anchorId of input.rejectedAnchorIds) {
    if (rejected.has(anchorId)) {
      throw new Error(
        `C6 screening frame duplicate rejected candidate ${anchorId}`,
      );
    }
    if (!knownAnchors.has(anchorId)) {
      throw new Error(
        `C6 screening frame unknown rejected candidate ${anchorId}`,
      );
    }
    rejected.add(anchorId);
  }
  const remaining = frame.candidates.filter((candidate) =>
    !rejected.has(candidate.anchorId)
  );
  const theoreticalMaximumSelectable = [
    ...groupByRepository(remaining).values(),
  ].reduce(
    (total, repositoryCandidates) =>
      total + Math.min(REPOSITORY_CAP, repositoryCandidates.length),
    0,
  );
  const existingCappedPoolMaximumPossible = frame.candidates
    .slice(0, frame.counts.existingCappedPrefixCount)
    .filter((candidate) => !rejected.has(candidate.anchorId))
    .length;
  return {
    canMeetMinimumUnderRepositoryCap:
      theoreticalMaximumSelectable >= MINIMUM_REQUIRED_EPISODES,
    candidateExpansionRequired:
      existingCappedPoolMaximumPossible < MINIMUM_REQUIRED_EPISODES,
    definitivelyRejectedCandidateCount: rejected.size,
    existingCappedPoolMaximumPossible,
    minimumRequiredEpisodes: MINIMUM_REQUIRED_EPISODES,
    remainingEligibleCandidateCount: remaining.length,
    selectableMargin:
      theoreticalMaximumSelectable - MINIMUM_REQUIRED_EPISODES,
    theoreticalMaximumSelectable,
  };
}

export function selectC6RealHistoryScreeningFrameCandidates(input: {
  frame: C6RealHistoryScreeningFrame;
  qualifiedAnchorIds: readonly string[];
}): C6RealHistoryScreeningFrameAllocation {
  const frame = frameSchema.parse(input.frame);
  assertC6RealHistoryScreeningFrameClosure(frame);
  const qualified = new Set<string>();
  const knownAnchors = new Set(
    frame.candidates.map((candidate) => candidate.anchorId),
  );
  for (const anchorId of input.qualifiedAnchorIds) {
    if (qualified.has(anchorId)) {
      throw new Error(
        `C6 screening frame duplicate qualified candidate ${anchorId}`,
      );
    }
    if (!knownAnchors.has(anchorId)) {
      throw new Error(
        `C6 screening frame unknown qualified candidate ${anchorId}`,
      );
    }
    qualified.add(anchorId);
  }
  const repositoryCounts = new Map<string, number>();
  const repositoryCapped = frame.candidates.filter((candidate) => {
    if (!qualified.has(candidate.anchorId)) {
      return false;
    }
    const count = repositoryCounts.get(candidate.repository) ?? 0;
    if (count >= REPOSITORY_CAP) {
      return false;
    }
    repositoryCounts.set(candidate.repository, count + 1);
    return true;
  });
  const selectedCandidates = repositoryCapped.slice(
    0,
    MINIMUM_REQUIRED_EPISODES,
  );
  return {
    allocationComplete:
      selectedCandidates.length === MINIMUM_REQUIRED_EPISODES,
    qualifiedCandidateCount: qualified.size,
    repositoryCappedQualifiedCandidateCount: repositoryCapped.length,
    selectedCandidates,
  };
}

export function serializeC6RealHistoryScreeningFrame(
  frame: C6RealHistoryScreeningFrame,
): string {
  return `${JSON.stringify(frameSchema.parse(frame), null, 2)}\n`;
}

export async function replayC6RealHistoryScreeningFrame(input: {
  expectedFrameSha256: string;
  expectedSelectionSha256: string;
  expectedTrajectorySha256: string;
  framePath: string;
  selectionPath: string;
  trajectoryPath: string;
}): Promise<{
  frame: C6RealHistoryScreeningFrame;
  frameSha256: string;
  reproduced: true;
  selectionSha256: string;
}> {
  const expectedFrameSha256 = sha256Schema.parse(
    input.expectedFrameSha256,
  );
  const expectedSelectionSha256 = sha256Schema.parse(
    input.expectedSelectionSha256,
  );
  const expectedTrajectorySha256 = sha256Schema.parse(
    input.expectedTrajectorySha256,
  );
  const [framePath, selectionPath, trajectoryPath] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.framePath,
      "C6 screening frame replay projection",
    ),
    assertC6NoSymlinkPathComponents(
      input.selectionPath,
      "C6 screening frame replay input",
    ),
    assertC6NoSymlinkPathComponents(
      input.trajectoryPath,
      "C6 screening frame replay source",
    ),
  ]);
  const [frameBytes, selectionBytes, trajectoryBytes] = await Promise.all([
    readC6StableRegularFile(framePath, "screening frame replay projection"),
    readC6StableRegularFile(selectionPath, "screening frame replay input"),
    readC6StableRegularFile(trajectoryPath, "screening frame replay source"),
  ]);
  const frameSha256 = sha256(frameBytes);
  const selectionSha256 = sha256(selectionBytes);
  const trajectorySha256 = sha256(trajectoryBytes);
  if (frameSha256 !== expectedFrameSha256) {
    throw new Error("C6 screening frame projection hash mismatch");
  }
  if (selectionSha256 !== expectedSelectionSha256) {
    throw new Error("C6 screening frame input hash mismatch");
  }
  if (trajectorySha256 !== expectedTrajectorySha256) {
    throw new Error("C6 screening frame source hash mismatch");
  }
  const selectionReplay = await replayC6RealHistoryPrehistorySelection({
    expectedInputSha256: expectedTrajectorySha256,
    expectedProjectionSha256: expectedSelectionSha256,
    inputPath: trajectoryPath,
    projectionPath: selectionPath,
  });
  const selection = selectionReplay.selection;
  const persistedFrame = frameSchema.parse(
    JSON.parse(frameBytes.toString("utf8")) as unknown,
  );
  const frame = projectC6RealHistoryScreeningFrame({
    amendmentBasis: persistedFrame.amendmentBasis,
    inputPath: selectionPath,
    inputSha256: expectedSelectionSha256,
    selection,
  });
  if (
    serializeC6RealHistoryScreeningFrame(frame) !==
      frameBytes.toString("utf8")
  ) {
    throw new Error(
      "C6 screening frame projection does not match recomputation",
    );
  }
  const [
    terminalFrameBytes,
    terminalSelectionBytes,
    terminalTrajectoryBytes,
  ] = await Promise.all([
    readC6StableRegularFile(
      framePath,
      "screening frame replay terminal projection",
    ),
    readC6StableRegularFile(
      selectionPath,
      "screening frame replay terminal input",
    ),
    readC6StableRegularFile(
      trajectoryPath,
      "screening frame replay terminal source",
    ),
  ]);
  if (
    !terminalFrameBytes.equals(frameBytes) ||
    !terminalSelectionBytes.equals(selectionBytes) ||
    !terminalTrajectoryBytes.equals(trajectoryBytes)
  ) {
    throw new Error("C6 screening frame inputs changed during replay");
  }
  return {
    frame,
    frameSha256,
    reproduced: true,
    selectionSha256,
  };
}

function assertUniqueAndContiguous(
  values: readonly number[],
  expectedCount: number,
  label: string,
): void {
  const expected = Array.from(
    { length: expectedCount },
    (_, index) => index + 1,
  );
  const sorted = [...values].sort((left, right) => left - right);
  if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
    throw new Error(
      `C6 real-history screening frame ${label} closure does not match`,
    );
  }
}

function assertC6RealHistoryScreeningFrameClosure(
  frame: C6RealHistoryScreeningFrame,
): void {
  if (
    frame.candidates.length !== frame.counts.eligibleCandidateCount ||
    frame.counts.existingCappedPrefixCount +
      frame.counts.backfillCandidateCount !== frame.candidates.length
  ) {
    throw new Error("C6 screening frame candidate counts do not match");
  }
  const anchors = new Set<string>();
  let previousBackfillEligibleRank = 0;
  for (const [index, candidate] of frame.candidates.entries()) {
    if (candidate.screeningRank !== index + 1) {
      throw new Error(
        "C6 screening frame candidate order does not match screening ranks",
      );
    }
    if (
      anchors.has(candidate.anchorId) ||
      !candidate.anchorId.startsWith(`${candidate.repository}#`)
    ) {
      throw new Error(
        "C6 screening frame candidate identity closure does not match",
      );
    }
    anchors.add(candidate.anchorId);
    if (index < frame.counts.existingCappedPrefixCount) {
      if (
        candidate.frameTier !== "existing-capped-prefix" ||
        candidate.originalCappedPoolRank !== index + 1
      ) {
        throw new Error(
          "C6 screening frame capped prefix closure does not match",
        );
      }
    } else {
      if (
        candidate.frameTier !== "repository-cap-backfill" ||
        candidate.originalCappedPoolRank !== null ||
        candidate.eligibleRank <= previousBackfillEligibleRank
      ) {
        throw new Error(
          "C6 screening frame backfill closure does not match",
        );
      }
      previousBackfillEligibleRank = candidate.eligibleRank;
    }
  }
  const repositories = groupByRepository(frame.candidates);
  const theoreticalMaximumUnderRepositoryCap = [...repositories.values()]
    .reduce(
      (total, candidates) =>
        total + Math.min(REPOSITORY_CAP, candidates.length),
      0,
    );
  if (
    repositories.size !== frame.counts.repositoryCount ||
    theoreticalMaximumUnderRepositoryCap !==
      frame.counts.theoreticalMaximumUnderRepositoryCap ||
    sha256(JSON.stringify(frame.candidates)) !==
      frame.independenceBoundary.candidateProjectionSha256
  ) {
    throw new Error(
      "C6 screening frame repository capacity closure does not match",
    );
  }
}

function groupByRepository<T extends { repository: string }>(
  candidates: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const candidate of candidates) {
    const repositoryCandidates =
      grouped.get(candidate.repository) ?? [];
    repositoryCandidates.push(candidate);
    grouped.set(candidate.repository, repositoryCandidates);
  }
  return grouped;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
