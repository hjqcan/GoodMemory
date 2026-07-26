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
  "swe-bench-live-multilang-608f7ae9.neighbor-census-qualification-v3.json",
);
const PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-deep-capture-plan-v2.json",
);
const PRIOR_PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-deep-capture-plan-v1.json",
);
const QUALIFICATION_SHA256 =
  "011c264e496fb849a1f14baee1289cb815e90bd81adfa4f6bec44d08b11030ef";
const QUALIFICATION_DEEP_TARGET_PROJECTION_SHA256 =
  "d4aefe655c93875656c48e789af96801ba02a98edb423d6da8303ef8ddc1dbe6";
const PLAN_SHA256 =
  "9af58b2033aa67d8bb1d056ff0f56fe8db9c1b0c7a75f73ed1a6a784ad0f4472";
const PLAN_TARGET_PROJECTION_SHA256 =
  "9b1249a93f2878c41d258cdb2212facf26e4c810f2ed7322d1fcd23fe867eacf";
const PRIOR_PLAN_SHA256 =
  "9c1ebdafd700a274cffc4dba807a2425013079d1bfe74a1e99f1144399da492a";

describe(
  "Codex coding-effect C6 continuation deep-capture plan gate",
  () => {
    it("rebuilds the frozen 643-target plan byte-for-byte while preserving the first tranche", async () => {
      const [qualificationBytes, planBytes, priorPlanBytes] =
        await Promise.all([
          readFile(QUALIFICATION_PATH),
          readFile(PLAN_PATH),
          readFile(PRIOR_PLAN_PATH),
        ]);
      expect(sha256(qualificationBytes)).toBe(
        QUALIFICATION_SHA256,
      );
      expect(sha256(planBytes)).toBe(PLAN_SHA256);
      expect(sha256(priorPlanBytes)).toBe(PRIOR_PLAN_SHA256);

      const replay =
        await buildC6LiveMultiLangNeighborDeepCapturePlan({
          expectedDeepCaptureTargetProjectionSha256:
            QUALIFICATION_DEEP_TARGET_PROJECTION_SHA256,
          expectedQualificationSha256: QUALIFICATION_SHA256,
          expectedTargetCount: 643,
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
        expectedRequestLowerBound: 643,
        repositoryCount: 60,
        targetCount: 643,
      });
      expect(replay.plan.inputs.qualification).toMatchObject({
        deepCaptureTargetProjectionSha256:
          QUALIFICATION_DEEP_TARGET_PROJECTION_SHA256,
        path:
          "swe-bench-live-multilang-608f7ae9.neighbor-census-qualification-v3.json",
        schemaVersion: 3,
        sha256: QUALIFICATION_SHA256,
      });
      expect(
        replay.plan.independenceBoundary.targetProjectionSha256,
      ).toBe(PLAN_TARGET_PROJECTION_SHA256);
      expect(replay.plan.targets.map(
        ({ captureOrder }) => captureOrder,
      )).toEqual(Array.from(
        { length: 643 },
        (_, index) => index + 1,
      ));
      expect(new Set(replay.plan.targets.map(
        ({ canonicalRepository }) => canonicalRepository,
      )).size).toBe(60);
      expect(replay.plan.boundary).toMatchObject({
        acceptedEpisodeCount: 0,
        actorQualifiedEpisodeCount: 0,
        candidateManifestFrozen: false,
        codexRunReady: false,
        deepCaptureExecuted: false,
        machineQualifiedEpisodeCount: 0,
        semanticallyQualifiedEpisodeCount: 0,
      });
    });
  },
);

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
