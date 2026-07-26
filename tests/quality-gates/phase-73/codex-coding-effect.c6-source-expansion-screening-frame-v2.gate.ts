import { expect, test } from "bun:test";
import { resolve } from "node:path";

import {
  deriveC6SourceExpansionScreeningFrameV2Capacity,
  replayC6SourceExpansionScreeningFrameV2,
} from "../../../scripts/codex-coding-effect/c6-source-expansion-screening-frame-v2";
import {
  loadC6TransitionEvaluatorReviewReceipt,
} from "../../../scripts/codex-coding-effect/c6-transition-evaluator-review-receipt";

const SOURCE_ROOT = resolve(
  "fixtures/codex-coding-effect/c6-source-pool",
);

test("C6 identity supplements append 15 structural candidates without rewriting the prior frame", async () => {
  const [replay, transitionReview] = await Promise.all([
    replayC6SourceExpansionScreeningFrameV2({
      expectedFrameSha256:
        "9afc398b3475d5f4f6ab016c8fa36df80ed74880971acad789b54cbf4fcc022e",
      expectedPriorFrameSha256:
        "7d44dd550f0921d8fa561fde0a6338f9b34afb076b182d05d76181ef4dcb6290",
      expectedQualificationSha256:
        "e11752f957a3a8de992866ef2d83a36710a3e9134f5c84728100d67d5c87e0f3",
      framePath: resolve(
        SOURCE_ROOT,
        "multi-swe-full-56ff018.source-expansion-screening-frame-v2.json",
      ),
      priorFramePath: resolve(
        SOURCE_ROOT,
        "multi-swe-full-56ff018.source-expansion-screening-frame-v1.json",
      ),
      qualificationPath: resolve(
        SOURCE_ROOT,
        "multi-swe-full-56ff018.review-trajectory-source-expansion-rest-qualification-v2.json",
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
  const capacity = deriveC6SourceExpansionScreeningFrameV2Capacity({
    frame: replay.frame,
    rejectedRequestedAnchorIds,
  });
  const rejected = new Set(rejectedRequestedAnchorIds);
  const remaining = replay.frame.candidates.filter((candidate) =>
    !rejected.has(candidate.requestedAnchorId)
  );
  const appended = replay.frame.candidates.slice(174);

  expect(replay.reproduced).toBe(true);
  expect(rejectedRequestedAnchorIds).toHaveLength(38);
  expect(new Set(rejectedRequestedAnchorIds).size).toBe(38);
  expect(
    rejectedRequestedAnchorIds.every((anchorId) =>
      replay.frame.candidates.find((candidate) =>
        candidate.requestedAnchorId === anchorId
      )!.screeningRank <= 174
    ),
  ).toBe(true);
  expect(replay.frame.counts).toEqual({
    combinedStructuralCandidateCount: 189,
    identitySupplementCandidateCount: 15,
    legacyCandidateCount: 145,
    minimumRequiredEpisodes: 48,
    missingFullRestClosureCount: 15,
    missingRequiredIdentityClosureCount: 0,
    noExactStructuralSequenceCount: 7,
    priorFrameCandidateCount: 174,
    priorRestExactCandidateCount: 29,
    qualificationExactStructuralCandidateCount: 44,
    qualificationTargetCount: 51,
    rawStructuralMargin: 15,
    repositoryCappedStructuralCeiling: 63,
    repositoryCount: 25,
  });
  expect(replay.frame.independenceBoundary).toEqual({
    adaptiveProspective: true,
    candidateProjectionSha256:
      "7b6499bfc62ad8a6c3fce9f26028bcd62354f4c3c4d86acc91e1deca5fe0c992",
    identitySupplementCandidateProjectionSha256:
      "efb86b1827955d67eb61e79a7e25a9707f5992c304be74603cb55c9295b34229",
    machineOutcomeInput: false,
    personnelOutcomeBlindnessClaimed: false,
    priorFrameCandidateProjectionSha256:
      "0deafb438d2618a232aa0dd9b5981a6df2b189b48bc1753d03dbaa01b4ffa6b9",
    priorFrameOrderPreserved: true,
    prospectiveTrancheAppendedAfterPriorFrame: true,
    selectionDependsOnForbiddenFields: false,
    semanticLedgerInput: false,
  });
  expect(appended.map((candidate) => [
    candidate.sourceRank,
    candidate.requestedAnchorId,
    candidate.canonicalAnchorId,
  ])).toEqual([
    [3, "cli/cli#7873", "cli/cli#7873"],
    [10, "mockito/mockito#3424", "mockito/mockito#3424"],
    [11, "square/okhttp#6887", "lysine-dev/okhttp#6887"],
    [17, "elastic/logstash#14027", "elastic/logstash#14027"],
    [20, "cli/cli#4519", "cli/cli#4519"],
    [30, "cli/cli#2997", "cli/cli#2997"],
    [32, "cli/cli#4410", "cli/cli#4410"],
    [34, "cli/cli#8595", "cli/cli#8595"],
    [36, "cli/cli#9934", "cli/cli#9934"],
    [38, "cli/cli#9465", "cli/cli#9465"],
    [41, "cli/cli#7709", "cli/cli#7709"],
    [46, "cli/cli#4845", "cli/cli#4845"],
    [47, "cli/cli#3414", "cli/cli#3414"],
    [48, "cli/cli#6567", "cli/cli#6567"],
    [50, "cli/cli#10239", "cli/cli#10239"],
  ]);
  expect(
    appended.every((candidate, index) =>
      candidate.screeningRank === index + 175 &&
      candidate.sourceTranche ===
        "prospective-rest-identity-supplement-v1"
    ),
  ).toBe(true);
  expect(capacity).toEqual({
    canMeetMinimumUnderRepositoryCap: false,
    definitivelyRejectedCandidateCount: 38,
    minimumRequiredEpisodes: 48,
    remainingStructuralCandidateCount: 151,
    repositoryCappedStructuralCeiling: 47,
    selectableMargin: -1,
  });
  expect(
    new Set(remaining.map((candidate) => candidate.canonicalRepository))
      .size,
  ).toBe(19);
  expect(replay.frame.boundary).toMatchObject({
    acceptedEpisodeCount: 0,
    candidateManifestFrozen: false,
    codexRunReady: false,
    machineQualifiedEpisodeCount: 0,
    originalFullRestCaptureAttemptCompletenessProven: false,
    pullIdentitySupplementClosureComplete: true,
    structuralCapacityOnly: true,
  });
});
