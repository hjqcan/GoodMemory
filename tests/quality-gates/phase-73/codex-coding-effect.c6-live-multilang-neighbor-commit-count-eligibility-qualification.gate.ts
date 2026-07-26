import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  describe,
  expect,
  it,
  setDefaultTimeout,
} from "bun:test";

import {
  buildC6LiveMultiLangNeighborCommitCountEligibilityQualification,
  serializeC6LiveMultiLangNeighborCommitCountEligibilityQualification,
} from "../../../scripts/codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-qualification";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_POOL_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool",
);
const CENSUS_QUALIFICATION_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-census-qualification-v3.json",
);
const DEEP_CAPTURE_PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-deep-capture-plan-v2.json",
);
const ELIGIBILITY_PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-commit-count-eligibility-plan-v1.json",
);
const QUALIFICATION_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-commit-count-eligibility-qualification-v1.json",
);

const CAPTURE_ROOT = requiredCaptureRoot(
  process.env
    .GOODMEMORY_TEST_C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_ROOT,
);

const CAPTURE_ASSET_LOCK_SHA256 =
  "60d6690d10e4ef0a837343a6316d5ec9ab8ba19c6040b798618845de017bc089";
const CAPTURE_ASSET_ROOT_SHA256 =
  "5525d57c663351f8c3c2724822d9d68c39fc78bc1c145357223ec0a8b69f4182";
const CAPTURE_COMPLETION_SHA256 =
  "e2fc07337ea01cfb1c5a1879dc9d3a5638d92c250b881e8d5520cbc6141045db";
const CENSUS_QUALIFICATION_SHA256 =
  "011c264e496fb849a1f14baee1289cb815e90bd81adfa4f6bec44d08b11030ef";
const DEEP_CAPTURE_PLAN_SHA256 =
  "9af58b2033aa67d8bb1d056ff0f56fe8db9c1b0c7a75f73ed1a6a784ad0f4472";
const ELIGIBILITY_PLAN_SHA256 =
  "eebd85d07feb0346455bcdba1cc4a180346b2e8473191008647653bd4aea301a";
const QUALIFICATION_SHA256 =
  "3c5f0fdece74c51174c47eef4dd8bffd404675f015adb314005e1ae13b7631d9";

setDefaultTimeout(300_000);

describe(
  "Codex coding-effect C6 commit-count eligibility qualification gate",
  () => {
    it("rebuilds the canonical 642/1 qualification byte-for-byte from the complete raw capture", async () => {
      const qualificationBytes = await readFile(QUALIFICATION_PATH);
      expect(sha256(qualificationBytes)).toBe(QUALIFICATION_SHA256);

      const replay =
        await buildC6LiveMultiLangNeighborCommitCountEligibilityQualification({
          captureRoot: CAPTURE_ROOT,
          censusQualificationPath: CENSUS_QUALIFICATION_PATH,
          deepCapturePlanPath: DEEP_CAPTURE_PLAN_PATH,
          eligibilityPlanPath: ELIGIBILITY_PLAN_PATH,
          expectedCaptureAssetLockSha256:
            CAPTURE_ASSET_LOCK_SHA256,
          expectedCaptureAssetRootSha256:
            CAPTURE_ASSET_ROOT_SHA256,
          expectedCaptureCompletionSha256:
            CAPTURE_COMPLETION_SHA256,
          expectedCensusQualificationSha256:
            CENSUS_QUALIFICATION_SHA256,
          expectedDeepCapturePlanSha256:
            DEEP_CAPTURE_PLAN_SHA256,
          expectedEligibilityPlanSha256:
            ELIGIBILITY_PLAN_SHA256,
        });
      expect(replay.outputSha256).toBe(QUALIFICATION_SHA256);
      expect(Buffer.from(
        serializeC6LiveMultiLangNeighborCommitCountEligibilityQualification(
          replay.qualification,
        ),
        "utf8",
      )).toEqual(qualificationBytes);
      expect(replay.qualification.counts).toEqual({
        deepCaptureTargetCount: 642,
        eligibleTargetCount: 642,
        excludedTargetCount: 1,
        logicalRequestCount: 643,
        networkRequestCount: 643,
        rawFinalSuccessResponseCount: 643,
        replacementCount: 0,
        resampledTargetCount: 0,
        resultCount: 643,
        sourceTargetCount: 643,
      });
      expect(
        replay.qualification.results.filter(
          ({ decision }) =>
            decision === "excluded-platform-commit-cap",
        ),
      ).toEqual([
        expect.objectContaining({
          commitCount: 308,
          decision: "excluded-platform-commit-cap",
          deepCaptureOrder: null,
          sourceTarget: expect.objectContaining({
            canonicalAnchorId: "mbed-tls/mbedtls#10815",
            captureOrder: 257,
          }),
        }),
      ]);
      expect(replay.qualification.independenceBoundary).toMatchObject({
        deepCaptureTargetProjectionSha256:
          "c4a39402fb6a9a25c8b26e763d7adedd873ff304fb7abafed217bd06e41b0618",
        deepPlanTargetProjectionSha256:
          "368b631cf31c614fe1806f927cd5a4f0959ed3ef8bdc8823408b1f03dc6f8339",
        diagnosticInput: false,
        goldInput: false,
        machineOutcomeInput: false,
        patchInput: false,
        semanticDecisionInput: false,
        testInput: false,
      });
      expect(replay.qualification.registrationBoundary).toMatchObject({
        exploratoryAllTargetCountDiagnosticObserved: true,
        frozenBeforeCanonicalCapture: true,
        initialPlanV2TransportFailureObserved: true,
        preregisteredBeforeExploratoryDiagnostic: false,
      });
      expect(replay.qualification.boundary).toEqual({
        acceptedEpisodeCount: 0,
        actorCaptureExecuted: false,
        actorQualifiedEpisodeCount: 0,
        candidateManifestFrozen: false,
        codexRunReady: false,
        deepCaptureExecuted: false,
        machineQualifiedEpisodeCount: 0,
        semanticallyQualifiedEpisodeCount: 0,
        status:
          "commit-count-platform-eligibility-qualified-deep-plan-required",
      });
    });
  },
);

function requiredCaptureRoot(value: string | undefined): string {
  const root = value?.trim();
  if (!root) {
    throw new Error(
      "C6 commit-count qualification gate missing " +
        "GOODMEMORY_TEST_C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_ROOT",
    );
  }
  return root;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
