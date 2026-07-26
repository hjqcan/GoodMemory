import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  buildC6LiveMultiLangNeighborDeepCapturePlan,
  serializeC6LiveMultiLangNeighborDeepCapturePlan,
} from "../../../scripts/codex-coding-effect/c6-live-multilang-neighbor-deep-capture-plan";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_POOL_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool",
);
const QUALIFICATION_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-commit-count-eligibility-qualification-v1.json",
);
const PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-deep-capture-plan-v3.json",
);
const QUALIFICATION_SHA256 =
  "3c5f0fdece74c51174c47eef4dd8bffd404675f015adb314005e1ae13b7631d9";
const QUALIFICATION_DEEP_TARGET_PROJECTION_SHA256 =
  "c4a39402fb6a9a25c8b26e763d7adedd873ff304fb7abafed217bd06e41b0618";
const PLAN_SHA256 =
  "a0dd0fa0a106d6d1e65645dcec9e44f9e04eb08d7f47e59d25f37920d7cae411";
const PLAN_TARGET_PROJECTION_SHA256 =
  "368b631cf31c614fe1806f927cd5a4f0959ed3ef8bdc8823408b1f03dc6f8339";

describe(
  "Codex coding-effect C6 642-target deep-capture plan gate",
  () => {
    it("rebuilds plan-v3 byte-for-byte from the frozen no-replacement qualification", async () => {
      const [qualificationBytes, planBytes] = await Promise.all([
        readFile(QUALIFICATION_PATH),
        readFile(PLAN_PATH),
      ]);
      expect(sha256(qualificationBytes)).toBe(
        QUALIFICATION_SHA256,
      );
      expect(sha256(planBytes)).toBe(PLAN_SHA256);

      const replay =
        await buildC6LiveMultiLangNeighborDeepCapturePlan({
          expectedDeepCaptureTargetProjectionSha256:
            QUALIFICATION_DEEP_TARGET_PROJECTION_SHA256,
          expectedQualificationSha256: QUALIFICATION_SHA256,
          expectedTargetCount: 642,
          qualificationPath: QUALIFICATION_PATH,
        });
      expect(replay.outputSha256).toBe(PLAN_SHA256);
      expect(Buffer.from(
        serializeC6LiveMultiLangNeighborDeepCapturePlan(
          replay.plan,
        ),
        "utf8",
      )).toEqual(planBytes);
      expect(replay.plan.counts).toEqual({
        expectedRequestLowerBound: 642,
        repositoryCount: 60,
        targetCount: 642,
      });
      expect(replay.plan.inputs.qualification).toEqual({
        artifactKind:
          "c6-live-multilang-neighbor-commit-count-eligibility-qualification",
        bytes: 915571,
        deepCaptureTargetProjectionSha256:
          QUALIFICATION_DEEP_TARGET_PROJECTION_SHA256,
        deepPlanTargetProjectionSha256:
          PLAN_TARGET_PROJECTION_SHA256,
        path:
          "swe-bench-live-multilang-608f7ae9.neighbor-commit-count-eligibility-qualification-v1.json",
        schemaVersion: 1,
        sha256: QUALIFICATION_SHA256,
      });
      expect(replay.plan.independenceBoundary).toEqual({
        goldInput: false,
        machineOutcomeInput: false,
        patchInput: false,
        qualificationDeepTargetProjectionSha256:
          QUALIFICATION_DEEP_TARGET_PROJECTION_SHA256,
        semanticDecisionInput: false,
        targetProjectionSha256:
          PLAN_TARGET_PROJECTION_SHA256,
        testInput: false,
      });
      expect(replay.plan.targets.map(
        ({ captureOrder }) => captureOrder,
      )).toEqual(Array.from(
        { length: 642 },
        (_, index) => index + 1,
      ));
      expect(replay.plan.targets.some(
        ({ canonicalAnchorId }) =>
          canonicalAnchorId === "mbed-tls/mbedtls#10815",
      )).toBe(false);
      expect(replay.plan.boundary).toEqual({
        acceptedEpisodeCount: 0,
        actorCaptureExecuted: false,
        actorQualifiedEpisodeCount: 0,
        candidateManifestFrozen: false,
        captureCompletenessProven: false,
        codexRunReady: false,
        deepCaptureExecuted: false,
        machineQualifiedEpisodeCount: 0,
        semanticallyQualifiedEpisodeCount: 0,
        status: "neighbor-review-surface-deep-capture-plan-only",
      });
    });
  },
);

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
