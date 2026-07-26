import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it, setDefaultTimeout } from "bun:test";

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

setDefaultTimeout(300_000);

describe(
  "Codex coding-effect C6 Wave1+Wave2 structural union gate",
  () => {
    it("rebuilds both external child closures before deriving the exact frozen union", async () => {
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

      const result =
        await buildC6LiveMultiLangNeighborStructuralUnion({
          wave1QualificationPath: WAVE1_QUALIFICATION_PATH,
          wave2QualificationPath: WAVE2_QUALIFICATION_PATH,
        });
      const serialized =
        serializeC6LiveMultiLangNeighborStructuralUnion(result.union);

      expect(Buffer.byteLength(serialized)).toBe(UNION_BYTES);
      expect(result.outputSha256).toBe(UNION_SHA256);
      expect(sha256(serialized)).toBe(UNION_SHA256);
      expect(unionBytes.byteLength).toBe(UNION_BYTES);
      expect(sha256(unionBytes)).toBe(UNION_SHA256);
      expect(Buffer.from(serialized, "utf8")).toEqual(unionBytes);
      expect(result.union.counts).toEqual({
        exactStructuralCandidateCount: 56,
        exactStructuralRepositoryCount: 31,
        noExactStructuralSequenceCount: 1_278,
        projectedStructuralEventCount: 1_479,
        pullAuthorOccurrenceCount: 1_334,
        repositoryCappedStructuralCeiling: 52,
        reviewerActorOccurrenceCount: 5_886,
        reviewerUniqueLoginCount: 507,
        targetCount: 1_334,
      });
      expect(result.union.boundary).toEqual({
        acceptedEpisodeCount: 0,
        actorCaptureExecuted: false,
        actorQualifiedEpisodeCount: 0,
        candidateManifestFrozen: false,
        codexRunReady: false,
        evaluatorQualifiedEpisodeCount: 0,
        machineQualifiedEpisodeCount: 0,
        semanticallyQualifiedEpisodeCount: 0,
        status: "pre-actor-structural-union-only",
      });
      expect(result.union.results[0]).toMatchObject({
        sourceCaptureOrder: 1,
        sourceWave: "wave1",
        unionOrder: 1,
      });
      expect(result.union.results[692]).toMatchObject({
        sourceCaptureOrder: 1,
        sourceWave: "wave2",
        unionOrder: 693,
      });
      expect(result.union.results.at(-1)).toMatchObject({
        sourceCaptureOrder: 642,
        sourceWave: "wave2",
        unionOrder: 1_334,
      });
      expect(result.union.independenceBoundary).toEqual({
        acceptedEpisodeInput: false,
        actorEligibilityInput: false,
        evaluatorDecisionInput: false,
        goldInput: false,
        hiddenTestInput: false,
        machineOutcomeInput: false,
        patchInput: false,
        pullAuthorOccurrenceProjectionSha256:
          "a35fe54aafc61279b769774c4c8e176a4a95c634cfdeaabb0f664772deb68c2c",
        reviewerActorOccurrenceProjectionSha256:
          "d426b898d5bddb5da2a187e5927695b3df6fb850168dc755ba0fd3c8e96c9fc7",
        reviewerLoginProjectionSha256:
          "4c03e130ce0b6c945f2bf526c3cfa0c25e5c17f0734cc34eafb264ebb9d56a61",
        semanticDecisionInput: false,
        structuralResultProjectionSha256:
          "796eb8477e750a76ab96ae0eeccec00f7ee6a5feb03603e469630a7432d8a975",
      });
    });
  },
);

function requiredEnvironmentPath(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`C6 structural union gate missing ${name}`);
  }
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
