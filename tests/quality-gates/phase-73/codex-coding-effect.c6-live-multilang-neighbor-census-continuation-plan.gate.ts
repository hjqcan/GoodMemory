import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { createHash } from "node:crypto";
import {
  appendFile,
  copyFile,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  buildC6LiveMultiLangNeighborCensusContinuationPlan,
  serializeC6LiveMultiLangNeighborCensusContinuationPlan,
} from "../../../scripts/codex-coding-effect/c6-live-multilang-neighbor-census-continuation-plan";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_POOL_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool",
);
const ACTOR_FRAME_PATH = join(
  SOURCE_POOL_ROOT,
  "multi-source.reviewer-actor-qualified-screening-frame-v1.json",
);
const CAPTURE_PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.capture-plan-v1.json",
);
const PRIOR_PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-census-plan-v1.json",
);
const CONTINUATION_PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-census-plan-v2.json",
);
const GRAPHQL_ROOT =
  process.env.GOODMEMORY_TEST_C6_LIVE_MULTILANG_GRAPHQL_ROOT?.trim();
const maybeDescribe = GRAPHQL_ROOT ? describe : describe.skip;

const ACTOR_FRAME_SHA256 =
  "6838de7f36875b3b3de104ffd896b9e30dcf95ad1eb285a87b465789800f4b0c";
const ACTOR_FRAME_CANDIDATE_PROJECTION_SHA256 =
  "1d0c5689521aa906e7fb2bf015579bbcc7638b31093966edec5339724aec82af";
const CAPTURE_PLAN_SHA256 =
  "3923d3de3fd1bc5906530b918e2ca4c38cf0e83e3f93d1c590447dce1f5d1f37";
const CAPTURE_PLAN_TARGET_PROJECTION_SHA256 =
  "c8851de5b5d1172089d73472dfc40d237876c3600c0c483373bd619c75f7f652";
const GRAPHQL_ROOT_SHA256 =
  "8b8ad4ac1b3b1f92b0d352cb808eef0953ac07cd1bf74eb9f61d592f4e481dcc";
const PRIOR_PLAN_SHA256 =
  "1b07d57ebc5601b9ab7f6742fdb5da91b9181784d7b2a33bf28ad318fa2e10f1";
const PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256 =
  "dee7643fa9693c4b43cb56f985d7cf7aded9ed4de3c8fc6c62c0def428a0fe0e";
const CONTINUATION_PLAN_SHA256 =
  "1de54a4da9087502213022ccdf0703f007158ecaca4ef1dd5f51af2a93591aab";
const CONTINUATION_SELECTED_REPOSITORY_PROJECTION_SHA256 =
  "d613a9d8c2eac5e14cb3646eab384e60856fb141bf5218f193a6ae9476de5d79";

const SOURCE_SPLITS = [
  "c",
  "cpp",
  "go",
  "js",
  "rust",
  "java",
  "ts",
  "cs",
] as const;

type BuildInput = Parameters<
  typeof buildC6LiveMultiLangNeighborCensusContinuationPlan
>[0];

interface ActorFrame {
  candidates: Array<{
    canonicalRepository: string;
  }>;
}

interface MutableActorFrame {
  candidates: Array<Record<string, unknown>>;
}

interface PriorPlan {
  targets: Array<{
    canonicalRepository: string;
  }>;
}

setDefaultTimeout(300_000);

maybeDescribe(
  "Codex coding-effect C6 Live/MultiLang neighbor census continuation plan gate",
  () => {
    it("rebuilds the frozen ranks-9-through-16 tranche byte-for-byte from closed source assets", async () => {
      const [
        actorFrameBytes,
        capturePlanBytes,
        priorPlanBytes,
        continuationPlanBytes,
      ] = await Promise.all([
        readFile(ACTOR_FRAME_PATH),
        readFile(CAPTURE_PLAN_PATH),
        readFile(PRIOR_PLAN_PATH),
        readFile(CONTINUATION_PLAN_PATH),
      ]);
      expect(sha256(actorFrameBytes)).toBe(ACTOR_FRAME_SHA256);
      expect(sha256(capturePlanBytes)).toBe(CAPTURE_PLAN_SHA256);
      expect(sha256(priorPlanBytes)).toBe(PRIOR_PLAN_SHA256);
      expect(sha256(continuationPlanBytes)).toBe(
        CONTINUATION_PLAN_SHA256,
      );

      const replay =
        await buildC6LiveMultiLangNeighborCensusContinuationPlan(
          exactBuildInput(),
        );
      expect(replay.outputSha256).toBe(CONTINUATION_PLAN_SHA256);
      expect(Buffer.from(
        serializeC6LiveMultiLangNeighborCensusContinuationPlan(
          replay.plan,
        ),
      )).toEqual(continuationPlanBytes);
      expect(replay.plan.schemaVersion).toBe(2);
      expect(replay.plan.inputs).toMatchObject({
        actorFrame: {
          sha256: ACTOR_FRAME_SHA256,
        },
        actorFrameCandidateProjectionSha256:
          ACTOR_FRAME_CANDIDATE_PROJECTION_SHA256,
        capturePlan: {
          sha256: CAPTURE_PLAN_SHA256,
        },
        capturePlanTargetProjectionSha256:
          CAPTURE_PLAN_TARGET_PROJECTION_SHA256,
        graphqlRootSha256: GRAPHQL_ROOT_SHA256,
        priorNeighborPlan: {
          selectedRepositoryProjectionSha256:
            PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256,
          sha256: PRIOR_PLAN_SHA256,
        },
      });
      expect(replay.plan.counts).toEqual({
        canonicalRedirectCollapseCount: 1,
        canonicalRepositoryCount: 380,
        continuationEligibleRepositoryCount: 279,
        cumulativeCensusCandidateCeiling: 2048,
        cumulativeSelectedRepositoryCount: 128,
        currentFrameRepositoryCount: 57,
        eligibleRepositoryCount: 343,
        excludedCurrentFrameRepositoryCount: 37,
        excludedPriorTrancheRepositoryCount: 64,
        priorSelectedRepositoryCount: 64,
        selectedRepositoryCount: 64,
        sourceAnchorCount: 743,
        sourceRequestedRepositoryCount: 381,
        trancheCensusCandidateCeiling: 1024,
      });
      expect(
        replay.plan.independenceBoundary
          .selectedRepositoryProjectionSha256,
      ).toBe(
        CONTINUATION_SELECTED_REPOSITORY_PROJECTION_SHA256,
      );

      const targetRepositories = new Set(
        replay.plan.targets.map(
          ({ canonicalRepository }) => canonicalRepository,
        ),
      );
      expect(targetRepositories.size).toBe(64);
      expect([
        ...new Set(replay.plan.targets.map(
          ({ withinSplitRank }) => withinSplitRank,
        )),
      ].sort((left, right) => left - right)).toEqual([
        9,
        10,
        11,
        12,
        13,
        14,
        15,
        16,
      ]);
      for (const sourceSplit of SOURCE_SPLITS) {
        expect(replay.plan.targets.filter(
          (target) => target.sourceSplit === sourceSplit,
        ).map(
          ({ withinSplitRank }) => withinSplitRank,
        )).toEqual([
          9,
          10,
          11,
          12,
          13,
          14,
          15,
          16,
        ]);
      }

      const actorFrame = JSON.parse(
        actorFrameBytes.toString("utf8"),
      ) as ActorFrame;
      const priorPlan = JSON.parse(
        priorPlanBytes.toString("utf8"),
      ) as PriorPlan;
      const actorFrameRepositories = new Set(
        actorFrame.candidates.map(({ canonicalRepository }) =>
          canonicalRepository.toLowerCase()
        ),
      );
      const priorRepositories = new Set(
        priorPlan.targets.map(({ canonicalRepository }) =>
          canonicalRepository.toLowerCase()
        ),
      );
      expect([...targetRepositories].filter(
        (repository) =>
          actorFrameRepositories.has(repository.toLowerCase()),
      )).toEqual([]);
      expect([...targetRepositories].filter(
        (repository) =>
          priorRepositories.has(repository.toLowerCase()),
      )).toEqual([]);
    });

    it("rejects a prior-plan mutation introduced before terminal verification", async () => {
      const temporaryRoot = await realpath(
        await mkdtemp(join(
          tmpdir(),
          "goodmemory-c6-neighbor-continuation-prior-gate-",
        )),
      );
      const mutablePriorPlanPath = join(
        temporaryRoot,
        basename(PRIOR_PLAN_PATH),
      );
      try {
        await copyFile(PRIOR_PLAN_PATH, mutablePriorPlanPath);
        await expect(
          buildC6LiveMultiLangNeighborCensusContinuationPlan(
            exactBuildInput({
              priorPlanPath: mutablePriorPlanPath,
              testHooks: {
                beforeTerminalVerification: () =>
                  appendFile(mutablePriorPlanPath, "\n", "utf8"),
              },
            }),
          ),
        ).rejects.toThrow(
          "prior plan changed during projection",
        );
      } finally {
        await rm(temporaryRoot, { force: true, recursive: true });
      }
    });

    it("rejects a nested forbidden selection input even when the actor-frame hash is rebound", async () => {
      const temporaryRoot = await realpath(
        await mkdtemp(join(
          tmpdir(),
          "goodmemory-c6-neighbor-continuation-forbidden-gate-",
        )),
      );
      const mutableActorFramePath = join(
        temporaryRoot,
        basename(ACTOR_FRAME_PATH),
      );
      try {
        const actorFrame = JSON.parse(
          (await readFile(ACTOR_FRAME_PATH)).toString("utf8"),
        ) as MutableActorFrame;
        actorFrame.candidates[0]!.reviewContext = {
          provenance: {
            gold: "hidden",
          },
        };
        const mutatedBytes = Buffer.from(
          `${JSON.stringify(actorFrame, null, 2)}\n`,
        );
        await writeFile(mutableActorFramePath, mutatedBytes);
        await expect(
          buildC6LiveMultiLangNeighborCensusContinuationPlan(
            exactBuildInput({
              actorFramePath: mutableActorFramePath,
              expectedActorFrameSha256: sha256(mutatedBytes),
            }),
          ),
        ).rejects.toThrow(
          "forbidden selection input actor frame $.candidates[0].reviewContext.provenance.gold",
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
    capturePlanPath: CAPTURE_PLAN_PATH,
    expectedActorFrameSha256: ACTOR_FRAME_SHA256,
    expectedCapturePlanSha256: CAPTURE_PLAN_SHA256,
    expectedGraphqlRootSha256: GRAPHQL_ROOT_SHA256,
    expectedPriorPlanSha256: PRIOR_PLAN_SHA256,
    expectedPriorSelectedRepositoryProjectionSha256:
      PRIOR_SELECTED_REPOSITORY_PROJECTION_SHA256,
    graphqlRoot: requiredExternalPath(
      GRAPHQL_ROOT,
      "GOODMEMORY_TEST_C6_LIVE_MULTILANG_GRAPHQL_ROOT",
    ),
    priorPlanPath: PRIOR_PLAN_PATH,
    ...overrides,
  };
}

function requiredExternalPath(
  value: string | undefined,
  name: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(
      `${name} is required for the C6 neighbor continuation-plan gate`,
    );
  }
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
