import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it, setDefaultTimeout } from "bun:test";

import {
  C6_LIVE_MULTILANG_NEIGHBOR_WAVE2_STRUCTURAL_BASELINE,
  buildC6LiveMultiLangNeighborStructuralQualification,
  serializeC6LiveMultiLangNeighborStructuralQualification,
} from "../../../scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-qualification";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_POOL_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool",
);
const PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-deep-capture-plan-v3.json",
);
const QUALIFICATION_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-continuation-structural-qualification-v1.json",
);
const DEEP_ROOT =
  process.env
    .GOODMEMORY_TEST_C6_LIVE_MULTILANG_NEIGHBOR_DEEP_V2_ROOT
    ?.trim();
if (!DEEP_ROOT) {
  throw new Error(
    "C6 continuation structural qualification gate missing " +
      "GOODMEMORY_TEST_C6_LIVE_MULTILANG_NEIGHBOR_DEEP_V2_ROOT",
  );
}

const PLAN_SHA256 =
  "a0dd0fa0a106d6d1e65645dcec9e44f9e04eb08d7f47e59d25f37920d7cae411";
const QUALIFICATION_SHA256 =
  "9dc625cbfb5c1c0bc47f9b09511b9ce7c8df789bf4bcbaafa2d8d182dd88be91";

setDefaultTimeout(300_000);

describe(
  "Codex coding-effect C6 continuation structural qualification gate",
  () => {
    it("replays the 642-target closure and rebuilds the frozen 22/620 artifact byte-for-byte", async () => {
      const [planBytes, qualificationBytes, replay] =
        await Promise.all([
          readFile(PLAN_PATH),
          readFile(QUALIFICATION_PATH),
          buildC6LiveMultiLangNeighborStructuralQualification({
            deepCaptureRoot: DEEP_ROOT,
            planPath: PLAN_PATH,
            tranche: "wave2",
          }),
        ]);

      expect(sha256(planBytes)).toBe(PLAN_SHA256);
      expect(sha256(qualificationBytes)).toBe(
        QUALIFICATION_SHA256,
      );
      expect(replay.outputSha256).toBe(QUALIFICATION_SHA256);
      expect(Buffer.from(
        serializeC6LiveMultiLangNeighborStructuralQualification(
          replay.qualification,
        ),
        "utf8",
      )).toEqual(qualificationBytes);
      expect(replay.qualification.counts).toEqual(
        C6_LIVE_MULTILANG_NEIGHBOR_WAVE2_STRUCTURAL_BASELINE,
      );
      expect(replay.qualification.inputs).toEqual({
        deepCapturePlan: {
          bytes: 484_504,
          path:
            "swe-bench-live-multilang-608f7ae9.neighbor-deep-capture-plan-v3.json",
          sha256: PLAN_SHA256,
        },
        deepEvidence: {
          assetRootSha256:
            "85b3d8db9ef328c3c0bb29025da6b428552435d1188c53dd8aa4b1a4b1f46ea1",
          completionSha256:
            "63b203ec0bd52765e1fedcf980f2cc7cb74d899c004b2ec7499eabfb94b0a939",
          directoryCount: 2_573,
          fileCount: 2_575,
          finalSuccessfulResponseCount: 644,
          logicalRequestCount: 644,
          networkRequestCount: 644,
          targetProjectionSha256:
            "009e431943a46ceb9aa4312c9436fc2bb4e7ed35cb21050e0b4b05af9f34ae1d",
        },
      });
      expect(replay.qualification.independenceBoundary)
        .toMatchObject({
          acceptedEpisodeInput: false,
          actorEligibilityInput: false,
          evaluatorDecisionInput: false,
          goldInput: false,
          hiddenTestInput: false,
          machineOutcomeInput: false,
          patchInput: false,
          reviewerActorOccurrenceProjectionSha256:
            "b70ac3ac8cf1ae8fe73c7c6ae6f849c5501ea7df4640335157e26cb6d90cdcef",
          reviewerLoginProjectionSha256:
            "0e4d2f838e1c3fe0cd50ce3ff7e84a9018f9ab482f21209f74df51a8ed835333",
          semanticDecisionInput: false,
          structuralResultProjectionSha256:
            "398b700f0521054f8c3b491e34a741df2c0e733864dc679e365d40e992a541d3",
        });
      expect(replay.qualification.boundary).toEqual({
        acceptedEpisodeCount: 0,
        actorCaptureExecuted: false,
        actorQualifiedEpisodeCount: 0,
        candidateManifestFrozen: false,
        codexRunReady: false,
        evaluatorQualifiedEpisodeCount: 0,
        machineQualifiedEpisodeCount: 0,
        semanticallyQualifiedEpisodeCount: 0,
        status: "pre-actor-structural-qualification-only",
      });
    });
  },
);

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
