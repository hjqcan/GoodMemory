import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it, setDefaultTimeout } from "bun:test";

import {
  buildC6LiveMultiLangNeighborActorPlanV2,
  parseC6LiveMultiLangNeighborActorPlanV2,
  serializeC6LiveMultiLangNeighborActorPlanV2,
} from "../../../scripts/codex-coding-effect/c6-live-multilang-neighbor-actor-plan-v2";
import {
  buildC6LiveMultiLangNeighborStructuralQualification,
  serializeC6LiveMultiLangNeighborStructuralQualification,
} from "../../../scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-qualification";
import {
  buildC6LiveMultiLangNeighborStructuralUnion,
  serializeC6LiveMultiLangNeighborStructuralUnion,
} from "../../../scripts/codex-coding-effect/c6-live-multilang-neighbor-structural-union";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_POOL_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool",
);
const WAVE1_PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "neighbor-deep-capture-plan-v1.json",
);
const WAVE2_PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "neighbor-deep-capture-plan-v3.json",
);
const WAVE1_QUALIFICATION_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "neighbor-structural-qualification-v1.json",
);
const WAVE2_QUALIFICATION_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "neighbor-continuation-structural-qualification-v1.json",
);
const UNION_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "neighbor-structural-union-v1.json",
);
const ACTOR_PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9." +
    "neighbor-reviewer-actor-plan-v2.json",
);
const WAVE1_DEEP_ROOT = requiredEnvironmentPath(
  "GOODMEMORY_TEST_C6_LIVE_MULTILANG_NEIGHBOR_DEEP_V1_ROOT",
);
const WAVE2_DEEP_ROOT = requiredEnvironmentPath(
  "GOODMEMORY_TEST_C6_LIVE_MULTILANG_NEIGHBOR_DEEP_V2_ROOT",
);

const WAVE1_QUALIFICATION_SHA256 =
  "ae096d86f779cb04f1fb0bb336d6bb4e02ced04e72385d9332d4dba82a9c1210";
const WAVE2_QUALIFICATION_SHA256 =
  "9dc625cbfb5c1c0bc47f9b09511b9ce7c8df789bf4bcbaafa2d8d182dd88be91";
const UNION_BYTES = 2_597_956;
const UNION_SHA256 =
  "3a438e999450b96c039dbea6eba7ae971bb03223c42c2b2ff502f85ed76ad208";
const ACTOR_PLAN_BYTES = 86_991;
const ACTOR_PLAN_SHA256 =
  "9603ab1f3ccf52efb632ca090a0a87b4235dad178f85d1f9b7ecb976b9d0dc17";
const TARGET_PROJECTION_SHA256 =
  "68ac8d1823039f7375dc6903676ed146b3704511c4bb79bd077a15d38bc5b53c";

setDefaultTimeout(300_000);

describe(
  "Codex coding-effect C6 Wave1+Wave2 actor-plan-v2 gate",
  () => {
    it("rebuilds the raw structural chain and exact policy-neutral 507-login plan", async () => {
      const actorPlanBytes = await readFile(ACTOR_PLAN_PATH);
      const [
        wave1QualificationBytes,
        wave2QualificationBytes,
        unionBytes,
        wave1Replay,
        wave2Replay,
      ] = await Promise.all([
        readFile(WAVE1_QUALIFICATION_PATH),
        readFile(WAVE2_QUALIFICATION_PATH),
        readFile(UNION_PATH),
        buildC6LiveMultiLangNeighborStructuralQualification({
          deepCaptureRoot: WAVE1_DEEP_ROOT,
          planPath: WAVE1_PLAN_PATH,
          tranche: "wave1",
        }),
        buildC6LiveMultiLangNeighborStructuralQualification({
          deepCaptureRoot: WAVE2_DEEP_ROOT,
          planPath: WAVE2_PLAN_PATH,
          tranche: "wave2",
        }),
      ]);

      expect(sha256(wave1QualificationBytes)).toBe(
        WAVE1_QUALIFICATION_SHA256,
      );
      expect(sha256(wave2QualificationBytes)).toBe(
        WAVE2_QUALIFICATION_SHA256,
      );
      expect(wave1Replay.outputSha256).toBe(
        WAVE1_QUALIFICATION_SHA256,
      );
      expect(wave2Replay.outputSha256).toBe(
        WAVE2_QUALIFICATION_SHA256,
      );
      expect(Buffer.from(
        serializeC6LiveMultiLangNeighborStructuralQualification(
          wave1Replay.qualification,
        ),
        "utf8",
      )).toEqual(wave1QualificationBytes);
      expect(Buffer.from(
        serializeC6LiveMultiLangNeighborStructuralQualification(
          wave2Replay.qualification,
        ),
        "utf8",
      )).toEqual(wave2QualificationBytes);

      const rebuiltUnion =
        await buildC6LiveMultiLangNeighborStructuralUnion({
          wave1QualificationPath: WAVE1_QUALIFICATION_PATH,
          wave2QualificationPath: WAVE2_QUALIFICATION_PATH,
        });
      expect(unionBytes.byteLength).toBe(UNION_BYTES);
      expect(sha256(unionBytes)).toBe(UNION_SHA256);
      expect(rebuiltUnion.outputSha256).toBe(UNION_SHA256);
      expect(Buffer.from(
        serializeC6LiveMultiLangNeighborStructuralUnion(
          rebuiltUnion.union,
        ),
        "utf8",
      )).toEqual(unionBytes);

      const rebuiltPlan =
        await buildC6LiveMultiLangNeighborActorPlanV2({
          structuralUnionPath: UNION_PATH,
        });
      const plan =
        parseC6LiveMultiLangNeighborActorPlanV2(actorPlanBytes);
      const serialized =
        serializeC6LiveMultiLangNeighborActorPlanV2(
          rebuiltPlan.plan,
        );

      expect(actorPlanBytes.byteLength).toBe(ACTOR_PLAN_BYTES);
      expect(sha256(actorPlanBytes)).toBe(ACTOR_PLAN_SHA256);
      expect(rebuiltPlan.outputSha256).toBe(ACTOR_PLAN_SHA256);
      expect(Buffer.from(serialized, "utf8")).toEqual(
        actorPlanBytes,
      );
      expect(rebuiltPlan.plan).toEqual(plan);
      expect(plan.counts).toEqual({
        sourceReviewReferenceCount: 5_886,
        sourceTargetCount: 1_334,
        uniqueActorCount: 507,
      });
      expect(plan.independenceBoundary).toMatchObject({
        acceptedEpisodeInput: false,
        actorEligibilityDecisionInput: false,
        evaluatorDecisionInput: false,
        goldInput: false,
        hiddenTestInput: false,
        machineOutcomeInput: false,
        patchInput: false,
        selectedSequenceInput: false,
        semanticDecisionInput: false,
        targetProjectionSha256: TARGET_PROJECTION_SHA256,
        testInput: false,
      });
      expect(plan.rule).toMatchObject({
        actorEligibilityDecision:
          "not-applied-before-identity-capture",
        actorEligibilityPolicy:
          "not-bound-until-complete-identity-capture",
        targetCardinality:
          "exactly-one-target-per-normalized-login",
      });
      expect("policy" in plan).toBe(false);
      expect(plan.targets).toHaveLength(507);
      expect(plan.targets.map(({ captureOrder }) => captureOrder))
        .toEqual(Array.from(
          { length: 507 },
          (_, index) => index + 1,
        ));
      expect(plan.targets.map(({ login }) => login)).toEqual(
        [...plan.targets.map(({ login }) => login)].sort(),
      );
      expect(new Set(plan.targets.map(({ login }) => login)).size)
        .toBe(507);
      expect(sha256(JSON.stringify(plan.targets))).toBe(
        TARGET_PROJECTION_SHA256,
      );
    });
  },
);

function requiredEnvironmentPath(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`C6 actor-plan-v2 gate missing ${name}`);
  }
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
