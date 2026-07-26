import { expect, test } from "bun:test";
import { resolve } from "node:path";

import {
  deriveC6SourceExpansionScreeningFrameCapacity,
  replayC6SourceExpansionScreeningFrame,
} from "../../../scripts/codex-coding-effect/c6-source-expansion-screening-frame";
import {
  loadC6TransitionEvaluatorReviewReceipt,
} from "../../../scripts/codex-coding-effect/c6-transition-evaluator-review-receipt";

const SOURCE_ROOT = resolve(
  "fixtures/codex-coding-effect/c6-source-pool",
);

test("C6 combined source-expansion frame preserves order and only restores conditional structural capacity", async () => {
  const [replay, transitionReview] = await Promise.all([
    replayC6SourceExpansionScreeningFrame({
      expectedFrameSha256:
        "7d44dd550f0921d8fa561fde0a6338f9b34afb076b182d05d76181ef4dcb6290",
      expectedInventorySha256:
        "14c406f6bb9d4b8c789380b62511bd1312dd67819eaeb44d64c9ea54593bed51",
      expectedLegacyFrameSha256:
        "751929cc423d0ad132cbb5d5841a442242b9d59ab713406f352424a33c22def9",
      expectedQualificationSha256:
        "256f267868303faf9e4fc4745508efaa023a241cb96d5bfac1a2c4a3aebfc5da",
      framePath: resolve(
        SOURCE_ROOT,
        "multi-swe-full-56ff018.source-expansion-screening-frame-v1.json",
      ),
      inventoryPath: resolve(
        SOURCE_ROOT,
        "multi-swe-full-56ff018.github-graphql-discovery-inventory.json",
      ),
      legacyFramePath: resolve(
        SOURCE_ROOT,
        "multi-swe-full-56ff018.real-history-screening-frame.json",
      ),
      qualificationPath: resolve(
        SOURCE_ROOT,
        "multi-swe-full-56ff018.review-trajectory-source-expansion-rest-qualification-v1.json",
      ),
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
  const rejectedRequestedAnchorIds = [
    ...semanticState.rejectedAnchorIds,
    ...machineRejectedAnchorIds,
  ];
  const capacity = deriveC6SourceExpansionScreeningFrameCapacity({
    frame: replay.frame,
    rejectedRequestedAnchorIds,
  });

  expect(replay.reproduced).toBe(true);
  expect(semanticState).toMatchObject({
    assessedCandidateCount: 42,
    continuationAnchorIds: [
      "fmtlib/fmt#974",
      "vuejs/core#9213",
      "clap-rs/clap#2796",
      "fmtlib/fmt#2310",
      "tokio-rs/tokio#5343",
    ],
    rejectedCandidateCount: 37,
  });
  expect(rejectedRequestedAnchorIds).toHaveLength(38);
  expect(new Set(rejectedRequestedAnchorIds).size).toBe(38);
  expect(replay.frame.counts).toEqual({
    combinedStructuralCandidateCount: 174,
    exactStructuralCandidateCount: 29,
    legacyCandidateCount: 145,
    minimumRequiredEpisodes: 48,
    missingRestClosureCount: 15,
    noExactStructuralSequenceCount: 7,
    qualificationTargetCount: 51,
    rawStructuralMargin: 13,
    repositoryCappedStructuralCeiling: 61,
    repositoryCount: 23,
  });
  expect(replay.frame.independenceBoundary).toEqual({
    adaptiveProspective: true,
    candidateProjectionSha256:
      "0deafb438d2618a232aa0dd9b5981a6df2b189b48bc1753d03dbaa01b4ffa6b9",
    exactCandidateProjectionSha256:
      "28a3687c6341f6e67c26f5cbc21dc1d5fe49e0a327db89a7bfd55139c27a2606",
    legacyCandidateProjectionSha256:
      "f2875d922dc5aef657363660b9efd0b39799923cbd8068f84ef921791da2e47e",
    legacyOrderPreserved: true,
    machineOutcomeInput: false,
    personnelOutcomeBlindnessClaimed: false,
    prospectiveTrancheAppendedAfterLegacyFrame: true,
    selectionDependsOnForbiddenFields: false,
    semanticLedgerInput: false,
  });
  expect(
    replay.frame.candidates.slice(0, 145).every((candidate, index) =>
      candidate.screeningRank === index + 1 &&
      candidate.sourceRank === index + 1 &&
      candidate.sourceTranche === "legacy-screening-frame-v1"
    ),
  ).toBe(true);
  expect(
    replay.frame.candidates.slice(145).every((candidate, index) =>
      candidate.screeningRank === index + 146 &&
      candidate.sourceTranche === "prospective-rest-exact-v2"
    ),
  ).toBe(true);
  expect(capacity).toEqual({
    canMeetMinimumUnderRepositoryCap: false,
    definitivelyRejectedCandidateCount: 38,
    minimumRequiredEpisodes: 48,
    remainingStructuralCandidateCount: 136,
    repositoryCappedStructuralCeiling: 44,
    selectableMargin: -4,
  });
  expect(replay.frame.boundary).toMatchObject({
    acceptedEpisodeCount: 0,
    candidateManifestFrozen: false,
    captureAttemptCompletenessProven: false,
    codexRunReady: false,
    machineQualifiedEpisodeCount: 0,
    structuralCapacityOnly: true,
  });
});
