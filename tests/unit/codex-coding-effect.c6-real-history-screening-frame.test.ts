import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

import {
  deriveC6RealHistoryScreeningFrameCapacity,
  projectC6RealHistoryScreeningFrame,
  replayC6RealHistoryScreeningFrame,
  selectC6RealHistoryScreeningFrameCandidates,
} from "../../scripts/codex-coding-effect/c6-real-history-screening-frame";
import {
  loadC6RealHistoryPrehistorySelection,
} from "../../scripts/codex-coding-effect/c6-real-history-prehistory-selection";

const SOURCE_ROOT = resolve(
  "fixtures/codex-coding-effect/c6-source-pool",
);
const SELECTION_PATH = resolve(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.real-history-prehistory-selection.json",
);
const SELECTION_SHA256 =
  "938ffaff2d185b3e3ba5d0ccf8e97f626879ffe0c7c44d65f6c6313958a06044";
const TRAJECTORY_PATH = resolve(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.review-trajectory-discovery.json",
);
const TRAJECTORY_SHA256 =
  "5931a911b919a9c53068311185f0bd1c78c0be18220ebe92c3b795c8e38357fd";
const FRAME_PATH = resolve(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.real-history-screening-frame.json",
);
const FRAME_SHA256 =
  "751929cc423d0ad132cbb5d5841a442242b9d59ab713406f352424a33c22def9";
const AMENDMENT_BASIS = {
  knownDefinitiveRejectionCount: 12 as const,
  semanticAssessmentCount: 12 as const,
  semanticAssessmentPrefixSha256:
    "5f9174c939fe8d662a84a764d909130c860efbb67bebb603b3874178571a6a1d",
  transitionReviewReceiptAssetLockSha256:
    "a7770e4d1c7dd6b7fd9bb17f3822e1e0e985018ceee16f66ca52d5380430f7a2",
  transitionReviewReceiptAssetRootSha256:
    "7671e327880434cef13fd4d02dfe2bd83a5e540991012dd8076c58f8bbe63421",
};

describe("C6 real-history expanded screening frame", () => {
  it("replays the frozen frame byte-for-byte from the prehistory closure", async () => {
    const replay = await replayC6RealHistoryScreeningFrame({
      expectedFrameSha256: FRAME_SHA256,
      expectedSelectionSha256: SELECTION_SHA256,
      expectedTrajectorySha256: TRAJECTORY_SHA256,
      framePath: FRAME_PATH,
      selectionPath: SELECTION_PATH,
      trajectoryPath: TRAJECTORY_PATH,
    });

    expect(replay.reproduced).toBe(true);
    expect(replay.frameSha256).toBe(FRAME_SHA256);
    expect(replay.frame.counts.eligibleCandidateCount).toBe(145);
  });

  it("preserves the frozen 54-row prefix and appends every deferred eligible row", async () => {
    const selection = await loadSelection();
    const frame = projectC6RealHistoryScreeningFrame({
      amendmentBasis: AMENDMENT_BASIS,
      inputPath: SELECTION_PATH,
      inputSha256: SELECTION_SHA256,
      selection,
    });

    expect(frame.counts).toEqual({
      backfillCandidateCount: 91,
      eligibleCandidateCount: 145,
      existingCappedPrefixCount: 54,
      minimumRequiredEpisodes: 48,
      repositoryCount: 22,
      theoreticalMaximumUnderRepositoryCap: 54,
    });
    expect(frame.candidates).toHaveLength(145);
    expect(frame.amendmentBasis).toEqual(AMENDMENT_BASIS);
    expect(frame.candidates.map((candidate) => candidate.screeningRank))
      .toEqual(Array.from({ length: 145 }, (_, index) => index + 1));
    expect(frame.candidates.slice(0, 54).every((candidate) =>
      candidate.frameTier === "existing-capped-prefix" &&
      candidate.originalCappedPoolRank === candidate.screeningRank
    )).toBe(true);
    expect(frame.candidates.slice(54).every((candidate) =>
      candidate.frameTier === "repository-cap-backfill" &&
      candidate.originalCappedPoolRank === null
    )).toBe(true);
    expect(new Set(frame.candidates.map((candidate) => candidate.anchorId)).size)
      .toBe(145);
    expect(frame.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      status: "expanded-screening-frame-only-qualification-required",
    });
    expect(frame.independenceBoundary).toEqual({
      candidateProjectionSha256:
        "f2875d922dc5aef657363660b9efd0b39799923cbd8068f84ef921791da2e47e",
      knownRejectionsPredateAmendment: true,
      personnelOutcomeBlindnessClaimed: false,
      selectionDependsOnForbiddenFields: false,
      selectionDependsOnKnownRejectionIdentities: false,
      temporalOrderCryptographicallyAttested: false,
      status:
        "outcome-field-independent-order-with-retrospective-review-metadata",
    });
  });

  it("restores structural capacity through a prospective repository backfill amendment", async () => {
    const frame = projectC6RealHistoryScreeningFrame({
      amendmentBasis: AMENDMENT_BASIS,
      inputPath: SELECTION_PATH,
      inputSha256: SELECTION_SHA256,
      selection: await loadSelection(),
    });
    const capacity = deriveC6RealHistoryScreeningFrameCapacity({
      frame,
      rejectedAnchorIds: [
        "fmtlib/fmt#2940",
        "mui/material-ui#37850",
        "cli/cli#549",
        "sveltejs/svelte#13437",
        "fmtlib/fmt#974",
        "tokio-rs/bytes#547",
        "ponylang/ponyc#4505",
        "mui/material-ui#31172",
        "mui/material-ui#38169",
        "mui/material-ui#37667",
        "cli/cli#7288",
        "cli/cli#9113",
      ],
    });

    expect(capacity).toEqual({
      canMeetMinimumUnderRepositoryCap: true,
      candidateExpansionRequired: true,
      definitivelyRejectedCandidateCount: 12,
      existingCappedPoolMaximumPossible: 42,
      minimumRequiredEpisodes: 48,
      remainingEligibleCandidateCount: 133,
      selectableMargin: 4,
      theoreticalMaximumSelectable: 52,
    });
  });

  it("rejects duplicate, unknown, or reordered frame inputs", async () => {
    const selection = await loadSelection();
    const duplicate = structuredClone(selection);
    duplicate.eligibleRankClosure[1]!.anchorId =
      duplicate.eligibleRankClosure[0]!.anchorId;
    expect(() => projectC6RealHistoryScreeningFrame({
      amendmentBasis: AMENDMENT_BASIS,
      inputPath: SELECTION_PATH,
      inputSha256: SELECTION_SHA256,
      selection: duplicate,
    })).toThrow();

    const frame = projectC6RealHistoryScreeningFrame({
      amendmentBasis: AMENDMENT_BASIS,
      inputPath: SELECTION_PATH,
      inputSha256: SELECTION_SHA256,
      selection,
    });
    expect(() => deriveC6RealHistoryScreeningFrameCapacity({
      frame,
      rejectedAnchorIds: ["unknown/repository#1"],
    })).toThrow("unknown rejected candidate");
    expect(() => deriveC6RealHistoryScreeningFrameCapacity({
      frame,
      rejectedAnchorIds: [
        frame.candidates[0]!.anchorId,
        frame.candidates[0]!.anchorId,
      ],
    })).toThrow("duplicate rejected candidate");
  });

  it("executes the frozen repository-cap and first-48 allocation policy", async () => {
    const frame = projectC6RealHistoryScreeningFrame({
      amendmentBasis: AMENDMENT_BASIS,
      inputPath: SELECTION_PATH,
      inputSha256: SELECTION_SHA256,
      selection: await loadSelection(),
    });
    const rejected = new Set([
      "fmtlib/fmt#2940",
      "mui/material-ui#37850",
      "cli/cli#549",
      "sveltejs/svelte#13437",
      "fmtlib/fmt#974",
      "tokio-rs/bytes#547",
      "ponylang/ponyc#4505",
      "mui/material-ui#31172",
      "mui/material-ui#38169",
      "mui/material-ui#37667",
      "cli/cli#7288",
      "cli/cli#9113",
    ]);
    const allocation = selectC6RealHistoryScreeningFrameCandidates({
      frame,
      qualifiedAnchorIds: frame.candidates
        .filter((candidate) => !rejected.has(candidate.anchorId))
        .map((candidate) => candidate.anchorId),
    });
    const repositoryCounts = new Map<string, number>();
    for (const candidate of allocation.selectedCandidates) {
      repositoryCounts.set(
        candidate.repository,
        (repositoryCounts.get(candidate.repository) ?? 0) + 1,
      );
    }

    expect(allocation.allocationComplete).toBe(true);
    expect(allocation.repositoryCappedQualifiedCandidateCount).toBe(52);
    expect(allocation.selectedCandidates).toHaveLength(48);
    expect([...repositoryCounts.values()].every(
      (count) => count <= 4,
    )).toBe(true);
    expect(allocation.selectedCandidates.map(
      (candidate) => candidate.screeningRank,
    )).toEqual([...allocation.selectedCandidates]
      .map((candidate) => candidate.screeningRank)
      .sort((left, right) => left - right));

    const reversed = structuredClone(frame);
    reversed.candidates.reverse();
    expect(() => selectC6RealHistoryScreeningFrameCandidates({
      frame: reversed,
      qualifiedAnchorIds: allocation.selectedCandidates.map(
        (candidate) => candidate.anchorId,
      ),
    })).toThrow("candidate order does not match screening ranks");
  });
});

function loadSelection() {
  return loadC6RealHistoryPrehistorySelection(
    SELECTION_PATH,
    { expectedSha256: SELECTION_SHA256 },
  );
}
