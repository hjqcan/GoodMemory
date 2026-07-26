import { createHash } from "node:crypto";
import {
  appendFile,
  copyFile,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  describe,
  expect,
  it,
  setDefaultTimeout,
} from "bun:test";

import {
  buildC6LiveMultiLangNeighborCensusContinuationQualification,
  serializeC6LiveMultiLangNeighborCensusContinuationQualification,
} from "../../../scripts/codex-coding-effect/c6-live-multilang-neighbor-census-qualification";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_POOL_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool",
);
const ACTOR_FRAME_PATH = join(
  SOURCE_POOL_ROOT,
  "multi-source.reviewer-actor-qualified-screening-frame-v1.json",
);
const PRIOR_PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-census-plan-v1.json",
);
const CONTINUATION_PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-census-plan-v2.json",
);
const SOURCE_CAPTURE_PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.capture-plan-v1.json",
);
const SOURCE_POOL_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.source-pool.json",
);
const QUALIFICATION_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-census-qualification-v3.json",
);
const PRIOR_QUALIFICATION_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-census-qualification-v2.json",
);

const NEIGHBOR_ROOT =
  process.env
    .GOODMEMORY_TEST_C6_LIVE_MULTILANG_NEIGHBOR_CENSUS_V2_ROOT
    ?.trim();
const SOURCE_GRAPHQL_ROOT =
  process.env
    .GOODMEMORY_TEST_C6_SWE_LIVE_MULTILANG_GRAPHQL_ROOT
    ?.trim();
const maybeDescribe =
  NEIGHBOR_ROOT && SOURCE_GRAPHQL_ROOT ? describe : describe.skip;

const ACTOR_FRAME_SHA256 =
  "6838de7f36875b3b3de104ffd896b9e30dcf95ad1eb285a87b465789800f4b0c";
const NEIGHBOR_COMPLETION_SHA256 =
  "684abebb2c7a496fffc535495af780276778443b9798cbf427dd60a2993301f5";
const CONTINUATION_PLAN_SHA256 =
  "1de54a4da9087502213022ccdf0703f007158ecaca4ef1dd5f51af2a93591aab";
const NEIGHBOR_ROOT_SHA256 =
  "9624c9db465e53af12ba9ee385b334e1f24a965c61361d2a2e9963e18e6596ed";
const PRIOR_PLAN_SHA256 =
  "1b07d57ebc5601b9ab7f6742fdb5da91b9181784d7b2a33bf28ad318fa2e10f1";
const PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256 =
  "dee7643fa9693c4b43cb56f985d7cf7aded9ed4de3c8fc6c62c0def428a0fe0e";
const SOURCE_CAPTURE_PLAN_SHA256 =
  "3923d3de3fd1bc5906530b918e2ca4c38cf0e83e3f93d1c590447dce1f5d1f37";
const SOURCE_GRAPHQL_ROOT_SHA256 =
  "8b8ad4ac1b3b1f92b0d352cb808eef0953ac07cd1bf74eb9f61d592f4e481dcc";
const SOURCE_POOL_SHA256 =
  "8c53bcb359a6cde71207a69ca5b8630d6ea299f3fdc7219db958f86cb499e4ec";
const QUALIFICATION_SHA256 =
  "011c264e496fb849a1f14baee1289cb815e90bd81adfa4f6bec44d08b11030ef";
const PRIOR_QUALIFICATION_SHA256 =
  "e51243ea3aa740a3a0812f8c1289ac2d3cf51436440ae0ecfea67a280743f1cc";

type BuildInput = Parameters<
  typeof buildC6LiveMultiLangNeighborCensusContinuationQualification
>[0];

setDefaultTimeout(300_000);

maybeDescribe(
  "Codex coding-effect C6 continuation census qualification gate",
  () => {
    it("rebuilds the frozen tranche-two qualification byte-for-byte with every readiness boundary closed", async () => {
      const [qualificationBytes, priorQualificationBytes] =
        await Promise.all([
          readFile(QUALIFICATION_PATH),
          readFile(PRIOR_QUALIFICATION_PATH),
        ]);
      expect(sha256(qualificationBytes)).toBe(
        QUALIFICATION_SHA256,
      );
      expect(sha256(priorQualificationBytes)).toBe(
        PRIOR_QUALIFICATION_SHA256,
      );

      const replay =
        await buildC6LiveMultiLangNeighborCensusContinuationQualification(
          exactBuildInput(),
        );
      expect(replay.outputSha256).toBe(QUALIFICATION_SHA256);
      expect(Buffer.from(
        serializeC6LiveMultiLangNeighborCensusContinuationQualification(
          replay.qualification,
        ),
        "utf8",
      )).toEqual(qualificationBytes);
      expect(replay.qualification.schemaVersion).toBe(3);
      expect(replay.qualification.counts).toEqual({
        capturedRepositoryCount: 64,
        deepCaptureTargetCount: 643,
        duplicateObservationCount: 0,
        existingAnchorOverlapCount: 6,
        novelCanonicalPullCount: 1018,
        novelWithReviewSurfaceCount: 643,
        novelWithoutReviewSurfaceCount: 375,
        rawObservationCount: 1024,
        sourceCanonicalAnchorCount: 743,
        truncatedRepositoryCount: 64,
        uniqueCanonicalPullCount: 1024,
      });
      expect(replay.qualification.sampleBoundary).toMatchObject({
        censusTranche: 2,
        repositorySampleRandom: false,
      });
      expect(
        replay.qualification.independenceBoundary,
      ).toMatchObject({
        deepCaptureTargetProjectionSha256:
          "d4aefe655c93875656c48e789af96801ba02a98edb423d6da8303ef8ddc1dbe6",
        goldInput: false,
        machineOutcomeInput: false,
        priorTrancheOutcomeInput: false,
        semanticDecisionInput: false,
        testInput: false,
      });
      expect(replay.qualification.boundary).toEqual({
        acceptedEpisodeCount: 0,
        actorCaptureExecuted: false,
        actorQualifiedEpisodeCount: 0,
        candidateManifestFrozen: false,
        canonicalPullDeduplicationComplete: true,
        codexRunReady: false,
        deepCaptureExecuted: false,
        existingAnchorExclusionComplete: true,
        machineQualifiedEpisodeCount: 0,
        populationRepresentativenessProven: false,
        semanticallyQualifiedEpisodeCount: 0,
        status:
          "novel-review-surface-pretargets-deep-capture-required",
      });
    });

    it("rejects prior-plan drift at terminal verification", async () => {
      const temporaryRoot = await realpath(
        await mkdtemp(join(
          tmpdir(),
          "goodmemory-c6-continuation-qualification-gate-",
        )),
      );
      const priorPlanPath = join(
        temporaryRoot,
        basename(PRIOR_PLAN_PATH),
      );
      try {
        await copyFile(PRIOR_PLAN_PATH, priorPlanPath);
        await expect(
          buildC6LiveMultiLangNeighborCensusContinuationQualification({
            ...exactBuildInput({ priorNeighborPlanPath: priorPlanPath }),
            testHooks: {
              beforeTerminalVerification: () =>
                appendFile(priorPlanPath, "\n", "utf8"),
            },
          }),
        ).rejects.toThrow(
          "input closure changed during projection",
        );
      } finally {
        await rm(temporaryRoot, { force: true, recursive: true });
      }
    });
  },
);

function exactBuildInput(
  overrides: Partial<BuildInput> = {},
): BuildInput {
  return {
    actorFramePath: ACTOR_FRAME_PATH,
    expectedActorFrameSha256: ACTOR_FRAME_SHA256,
    expectedNeighborCompletionSha256:
      NEIGHBOR_COMPLETION_SHA256,
    expectedNeighborPlanSha256: CONTINUATION_PLAN_SHA256,
    expectedNeighborRootSha256: NEIGHBOR_ROOT_SHA256,
    expectedPriorNeighborPlanSha256: PRIOR_PLAN_SHA256,
    expectedPriorSelectedRepositoryProjectionSha256:
      PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256,
    expectedSourceCapturePlanSha256:
      SOURCE_CAPTURE_PLAN_SHA256,
    expectedSourceGraphqlRootSha256:
      SOURCE_GRAPHQL_ROOT_SHA256,
    expectedSourcePoolSha256: SOURCE_POOL_SHA256,
    neighborPlanPath: CONTINUATION_PLAN_PATH,
    neighborRoot: requiredExternalPath(
      NEIGHBOR_ROOT,
      "GOODMEMORY_TEST_C6_LIVE_MULTILANG_NEIGHBOR_CENSUS_V2_ROOT",
    ),
    priorNeighborPlanPath: PRIOR_PLAN_PATH,
    sourceCapturePlanPath: SOURCE_CAPTURE_PLAN_PATH,
    sourceGraphqlRoot: requiredExternalPath(
      SOURCE_GRAPHQL_ROOT,
      "GOODMEMORY_TEST_C6_SWE_LIVE_MULTILANG_GRAPHQL_ROOT",
    ),
    sourcePoolPath: SOURCE_POOL_PATH,
    ...overrides,
  };
}

function requiredExternalPath(
  value: string | undefined,
  name: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(
      `${name} is required for the C6 continuation qualification gate`,
    );
  }
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
