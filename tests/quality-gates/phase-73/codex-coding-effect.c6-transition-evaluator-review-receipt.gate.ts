import { expect, test } from "bun:test";
import { resolve } from "node:path";

import {
  loadC6TransitionEvaluatorReviewReceipt,
} from "../../../scripts/codex-coding-effect/c6-transition-evaluator-review-receipt";

test("C6 transition-evaluator review gate preserves its unauthenticated rejection-only scope", async () => {
  const loaded = await loadC6TransitionEvaluatorReviewReceipt({
    receiptRoot: resolve(
      "fixtures/codex-coding-effect/" +
        "c6-fmt974-transition-evaluator-review-receipt",
    ),
    repositoryRoot: resolve("."),
  });

  expect(loaded.receiptAssetLockSha256).toBe(
    "a7770e4d1c7dd6b7fd9bb17f3822e1e0e985018ceee16f66ca52d5380430f7a2",
  );
  expect(loaded.receiptAssetRootSha256).toBe(
    "7671e327880434cef13fd4d02dfe2bd83a5e540991012dd8076c58f8bbe63421",
  );
  expect(loaded.receipt.review).toMatchObject({
    episodeAccepted: false,
    executionAuthenticated: false,
    machineQualified: false,
    noRemainingBlockersWithinScope: true,
    reviewCryptographicReceipt: false,
    reviewerIdentityCryptographicallyAttested: false,
    verdict: "frozen-receipt-rejection-derivation-accepted",
  });
  expect(loaded.transitionScreening.assessments[0]).toEqual({
    anchorId: "fmtlib/fmt#974",
    blockingStagePositions: [2, 3],
    cappedPoolRank: 5,
    decision: "reject-machine-qualification",
    qualifiedStagePositions: [1],
    reasonCodes: [
      "STAGE2_PUBLIC_HEADER_COMPILE_FAILURE",
      "STAGE3_THROW_TERMINATES",
    ],
  });
});
