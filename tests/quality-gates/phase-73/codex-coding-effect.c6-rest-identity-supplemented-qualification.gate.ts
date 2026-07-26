import { expect, test } from "bun:test";
import { resolve } from "node:path";

import {
  replayC6RestIdentitySupplementedQualification,
} from "../../../scripts/codex-coding-effect/c6-rest-identity-supplemented-qualification";

const SOURCE_ROOT = resolve(
  "fixtures/codex-coding-effect/c6-source-pool",
);

test("C6 REST pull-identity supplement closes every missing target without overstating full REST capture", async () => {
  const replay = await replayC6RestIdentitySupplementedQualification({
    expectedGraphqlRootSha256:
      "a529f3fd0226303f6d70c6222bf528f59ccc213145f4be44305aac80151b140b",
    expectedOriginalQualificationSha256:
      "256f267868303faf9e4fc4745508efaa023a241cb96d5bfac1a2c4a3aebfc5da",
    expectedProjectionSha256:
      "e11752f957a3a8de992866ef2d83a36710a3e9134f5c84728100d67d5c87e0f3",
    expectedSupplementPlanSha256:
      "72dcc45d43978cdda255937bd9773fb4f4685b7ac862416143dc1d777c97bfb6",
    expectedSupplementRootSha256:
      "26e14cad198c2b12b71c9ecd4c77231447cd53ef6210e391ec6f24a841e53615",
    graphqlRoot: "/private/tmp/goodmemory-c6-github-graphql-full-discovery-v1",
    originalQualificationPath: resolve(
      SOURCE_ROOT,
      "multi-swe-full-56ff018.review-trajectory-source-expansion-rest-qualification-v1.json",
    ),
    projectionPath: resolve(
      SOURCE_ROOT,
      "multi-swe-full-56ff018.review-trajectory-source-expansion-rest-qualification-v2.json",
    ),
    supplementPlanPath: resolve(
      SOURCE_ROOT,
      "multi-swe-full-56ff018.rest-identity-supplement-plan-v1.json",
    ),
    supplementRoot:
      "/private/tmp/goodmemory-c6-github-rest-identity-supplement-v2",
  });
  const supplementResults = replay.qualification.results.filter((result) =>
    result.qualificationSource === "pull-identity-supplement-v1"
  );

  expect(replay.reproduced).toBe(true);
  expect(replay.qualification.boundary).toEqual({
    acceptedEpisodeCount: 0,
    candidateManifestFrozen: false,
    codexRunReady: false,
    machineQualifiedEpisodeCount: 0,
    originalFullRestCaptureAttemptCompletenessProven: false,
    pullIdentitySupplementClosureComplete: true,
    status:
      "exact-structural-screening-complete-semantic-qualification-required",
  });
  expect(replay.qualification.counts).toEqual({
    exactStructuralCandidateCount: 44,
    exactStructuralRepositoryCount: 13,
    fullRestClosureCount: 36,
    identitySupplementClosureCount: 15,
    missingClosureCount: 0,
    noExactStructuralSequenceCount: 7,
    repositoryCappedStructuralCeiling: 26,
    targetCount: 51,
  });
  expect(replay.qualification.inputs).toEqual({
    capturePlanSha256:
      "6de24fb5e71aed98341cd1f529645cf6d53826ce77bb8ff3ddeb105197860cbc",
    graphqlRootSha256:
      "a529f3fd0226303f6d70c6222bf528f59ccc213145f4be44305aac80151b140b",
    originalQualificationSha256:
      "256f267868303faf9e4fc4745508efaa023a241cb96d5bfac1a2c4a3aebfc5da",
    originalRestRootSha256:
      "eacf953f250d1ce652a85248aabec863555f4849bdb789f4c4be22fcbc460ff9",
    supplementPlanSha256:
      "72dcc45d43978cdda255937bd9773fb4f4685b7ac862416143dc1d777c97bfb6",
    supplementRootSha256:
      "26e14cad198c2b12b71c9ecd4c77231447cd53ef6210e391ec6f24a841e53615",
  });
  expect(supplementResults).toHaveLength(15);
  expect(
    supplementResults.every((result) =>
      result.status === "exact-structural-candidate" &&
      typeof result.supplementManifestSha256 === "string"
    ),
  ).toBe(true);
});
