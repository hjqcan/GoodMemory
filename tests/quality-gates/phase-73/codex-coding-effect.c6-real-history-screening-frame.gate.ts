import { expect, test } from "bun:test";
import { resolve } from "node:path";

import {
  deriveC6RealHistoryScreeningFrameCapacity,
  replayC6RealHistoryScreeningFrame,
  selectC6RealHistoryScreeningFrameCandidates,
} from "../../../scripts/codex-coding-effect/c6-real-history-screening-frame";
import {
  loadC6TransitionEvaluatorReviewReceipt,
} from "../../../scripts/codex-coding-effect/c6-transition-evaluator-review-receipt";

const SOURCE_ROOT = resolve(
  "fixtures/codex-coding-effect/c6-source-pool",
);
const FRAME_PATH = resolve(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.real-history-screening-frame.json",
);
const SELECTION_PATH = resolve(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.real-history-prehistory-selection.json",
);
const TRAJECTORY_PATH = resolve(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.review-trajectory-discovery.json",
);

test("C6 expanded real-history frame restores only structural screening capacity", async () => {
  const [replay, transitionReview] =
    await Promise.all([
      replayC6RealHistoryScreeningFrame({
        expectedFrameSha256:
          "751929cc423d0ad132cbb5d5841a442242b9d59ab713406f352424a33c22def9",
        expectedSelectionSha256:
          "938ffaff2d185b3e3ba5d0ccf8e97f626879ffe0c7c44d65f6c6313958a06044",
        expectedTrajectorySha256:
          "5931a911b919a9c53068311185f0bd1c78c0be18220ebe92c3b795c8e38357fd",
        framePath: FRAME_PATH,
        selectionPath: SELECTION_PATH,
        trajectoryPath: TRAJECTORY_PATH,
      }),
      loadC6TransitionEvaluatorReviewReceipt({
        receiptRoot: resolve(
          "fixtures/codex-coding-effect/" +
            "c6-fmt974-transition-evaluator-review-receipt",
        ),
        repositoryRoot: resolve("."),
      }),
    ]);
  const semanticState = transitionReview.semanticScreeningState;
  const machineRejectedAnchorIds =
    transitionReview.transitionScreening.assessments
      .filter((assessment) =>
        assessment.decision === "reject-machine-qualification"
      )
      .map((assessment) => assessment.anchorId);
  const rejectedAnchorIds = [
    ...semanticState.rejectedAnchorIds,
    ...machineRejectedAnchorIds,
  ];
  const amendmentBasisRejectedAnchorIds = [
    ...transitionReview.amendmentBasisSemanticScreeningState
      .rejectedAnchorIds,
    ...machineRejectedAnchorIds,
  ];
  const capacity = deriveC6RealHistoryScreeningFrameCapacity({
    frame: replay.frame,
    rejectedAnchorIds,
  });
  const rejected = new Set(rejectedAnchorIds);
  const conditionalAllocation =
    selectC6RealHistoryScreeningFrameCandidates({
      frame: replay.frame,
      qualifiedAnchorIds: replay.frame.candidates
        .filter((candidate) => !rejected.has(candidate.anchorId))
        .map((candidate) => candidate.anchorId),
    });

  expect(rejectedAnchorIds).toHaveLength(38);
  expect(new Set(rejectedAnchorIds).size).toBe(38);
  expect(replay.reproduced).toBe(true);
  expect(replay.frame.amendmentBasis).toEqual({
    knownDefinitiveRejectionCount: 12,
    semanticAssessmentCount:
      transitionReview.receipt.bindings.semanticLedger
        .amendmentBasisAssessmentCount,
    semanticAssessmentPrefixSha256:
      transitionReview.receipt.bindings.semanticLedger
        .amendmentBasisAssessmentPrefixSha256,
    transitionReviewReceiptAssetLockSha256:
      transitionReview.receiptAssetLockSha256,
    transitionReviewReceiptAssetRootSha256:
      transitionReview.receiptAssetRootSha256,
  });
  expect(
    semanticState.assessedCandidateCount >=
      replay.frame.amendmentBasis.semanticAssessmentCount,
  ).toBe(true);
  expect(
    transitionReview.amendmentBasisSemanticScreeningState,
  ).toMatchObject({
    assessedCandidateCount: 12,
    continuationAnchorIds: ["fmtlib/fmt#974"],
    rejectedCandidateCount: 11,
  });
  expect(amendmentBasisRejectedAnchorIds).toHaveLength(
    replay.frame.amendmentBasis.knownDefinitiveRejectionCount,
  );
  expect(new Set(amendmentBasisRejectedAnchorIds).size).toBe(
    replay.frame.amendmentBasis.knownDefinitiveRejectionCount,
  );
  expect(replay.frame.independenceBoundary).toEqual({
    candidateProjectionSha256:
      "f2875d922dc5aef657363660b9efd0b39799923cbd8068f84ef921791da2e47e",
    knownRejectionsPredateAmendment: true,
    personnelOutcomeBlindnessClaimed: false,
    selectionDependsOnForbiddenFields: false,
    selectionDependsOnKnownRejectionIdentities: false,
    status:
      "outcome-field-independent-order-with-retrospective-review-metadata",
    temporalOrderCryptographicallyAttested: false,
  });
  expect(replay.frame.boundary).toEqual({
    acceptedEpisodeCount: 0,
    candidateManifestFrozen: false,
    codexRunReady: false,
    status: "expanded-screening-frame-only-qualification-required",
  });
  expect(replay.frame.counts).toEqual({
    backfillCandidateCount: 91,
    eligibleCandidateCount: 145,
    existingCappedPrefixCount: 54,
    minimumRequiredEpisodes: 48,
    repositoryCount: 22,
    theoreticalMaximumUnderRepositoryCap: 54,
  });
  expect(capacity).toEqual({
    canMeetMinimumUnderRepositoryCap: false,
    candidateExpansionRequired: true,
    definitivelyRejectedCandidateCount: 38,
    existingCappedPoolMaximumPossible: 16,
    minimumRequiredEpisodes: 48,
    remainingEligibleCandidateCount: 107,
    selectableMargin: -13,
    theoreticalMaximumSelectable: 35,
  });
  expect(conditionalAllocation).toMatchObject({
    allocationComplete: false,
    qualifiedCandidateCount: 107,
    repositoryCappedQualifiedCandidateCount: 35,
  });
  expect(conditionalAllocation.selectedCandidates).toHaveLength(35);
});
