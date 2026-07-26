import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  replayC6SourceExpansionRestQualification,
} from "../../../scripts/codex-coding-effect/c6-source-expansion-rest-qualification";
import {
  materializeC6SourceExpansionRestCapturePlan,
} from "../../../scripts/codex-coding-effect/c6-source-expansion-rest-capture-plan";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_ROOT =
  process.env.GOODMEMORY_TEST_C6_GRAPHQL_FULL_SOURCE_ROOT?.trim();
const GRAPHQL_ROOT =
  process.env.GOODMEMORY_TEST_C6_GRAPHQL_FULL_CAPTURE_ROOT?.trim();
const REST_ROOT =
  process.env.GOODMEMORY_TEST_C6_SOURCE_EXPANSION_REST_ROOT?.trim();
const maybeDescribe =
  SOURCE_ROOT && GRAPHQL_ROOT && REST_ROOT ? describe : describe.skip;
const EXPANSION_SHA256 =
  "629acdc312e611e066d181dacfb1206448c2a3f885921b99eff036159439317f";
const CAPTURE_PLAN_SHA256 =
  "6de24fb5e71aed98341cd1f529645cf6d53826ce77bb8ff3ddeb105197860cbc";
const GRAPHQL_ROOT_SHA256 =
  "a529f3fd0226303f6d70c6222bf528f59ccc213145f4be44305aac80151b140b";
const REST_ROOT_SHA256 =
  "eacf953f250d1ce652a85248aabec863555f4849bdb789f4c4be22fcbc460ff9";
const QUALIFICATION_SHA256 =
  "256f267868303faf9e4fc4745508efaa023a241cb96d5bfac1a2c4a3aebfc5da";

setDefaultTimeout(300_000);

maybeDescribe("Codex coding-effect C6 source-expansion REST gate", () => {
  it("replays the frozen 51-target plan and 36 exact REST closures", async () => {
    const sourcePoolRoot = join(
      REPOSITORY_ROOT,
      "fixtures/codex-coding-effect/c6-source-pool",
    );
    const expansionPath = join(
      sourcePoolRoot,
      "multi-swe-full-56ff018.review-trajectory-source-expansion-v2.json",
    );
    const capturePlanPath = join(
      sourcePoolRoot,
      "multi-swe-full-56ff018.review-trajectory-source-expansion-rest-capture-plan-v1.json",
    );
    const qualificationPath = join(
      sourcePoolRoot,
      "multi-swe-full-56ff018.review-trajectory-source-expansion-rest-qualification-v1.json",
    );
    const temporaryRoot = await realpath(
      await mkdtemp(
        join(tmpdir(), "goodmemory-c6-source-expansion-rest-gate-"),
      ),
    );
    try {
      const replayedPlanPath = join(temporaryRoot, "capture-plan.json");
      const plan = await materializeC6SourceExpansionRestCapturePlan({
        expectedExpansionSha256: EXPANSION_SHA256,
        expansionPath,
        outputPath: replayedPlanPath,
        sourceRoot: requiredExternalPath(
          SOURCE_ROOT,
          "GOODMEMORY_TEST_C6_GRAPHQL_FULL_SOURCE_ROOT",
        ),
      });
      expect(plan.outputSha256).toBe(CAPTURE_PLAN_SHA256);
      expect(await readFile(replayedPlanPath)).toEqual(
        await readFile(capturePlanPath),
      );

      const replay = await replayC6SourceExpansionRestQualification({
        capturePlanPath,
        expectedCapturePlanSha256: CAPTURE_PLAN_SHA256,
        expectedGraphqlRootSha256: GRAPHQL_ROOT_SHA256,
        expectedProjectionSha256: QUALIFICATION_SHA256,
        expectedRestRootSha256: REST_ROOT_SHA256,
        graphqlRoot: requiredExternalPath(
          GRAPHQL_ROOT,
          "GOODMEMORY_TEST_C6_GRAPHQL_FULL_CAPTURE_ROOT",
        ),
        projectionPath: qualificationPath,
        restRoot: requiredExternalPath(
          REST_ROOT,
          "GOODMEMORY_TEST_C6_SOURCE_EXPANSION_REST_ROOT",
        ),
      });

      expect(replay.reproduced).toBe(true);
      expect(replay.projectionSha256).toBe(QUALIFICATION_SHA256);
      expect(replay.qualification.counts).toEqual({
        capturedClosureCount: 36,
        exactStructuralCandidateCount: 29,
        exactStructuralRepositoryCount: 11,
        missingClosureCount: 15,
        repositoryCappedStructuralCeiling: 23,
        targetCount: 51,
      });
      expect(
        replay.qualification.results.filter(
          (result) => result.status === "no-exact-structural-sequence",
        ),
      ).toHaveLength(7);
      expect(replay.qualification.boundary).toMatchObject({
        acceptedEpisodeCount: 0,
        captureAttemptCompletenessProven: false,
        codexRunReady: false,
        machineQualifiedEpisodeCount: 0,
      });
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });
});

function requiredExternalPath(
  value: string | undefined,
  name: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for the C6 REST expansion gate`);
  }
  return value;
}
