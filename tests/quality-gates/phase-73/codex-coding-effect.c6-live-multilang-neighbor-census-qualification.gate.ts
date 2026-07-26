import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { createHash } from "node:crypto";
import {
  appendFile,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  buildC6LiveMultiLangNeighborCensusQualification,
  deriveC6LiveMultiLangNeighborCensusQualification,
  serializeC6LiveMultiLangNeighborCensusQualification,
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
const NEIGHBOR_PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-census-plan-v1.json",
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
  "swe-bench-live-multilang-608f7ae9.neighbor-census-qualification-v2.json",
);
const NEIGHBOR_ROOT =
  process.env.GOODMEMORY_TEST_C6_LIVE_MULTILANG_NEIGHBOR_ROOT?.trim();
const SOURCE_GRAPHQL_ROOT =
  process.env.GOODMEMORY_TEST_C6_LIVE_MULTILANG_GRAPHQL_ROOT?.trim();
const maybeDescribe =
  NEIGHBOR_ROOT && SOURCE_GRAPHQL_ROOT ? describe : describe.skip;
const ACTOR_FRAME_SHA256 =
  "6838de7f36875b3b3de104ffd896b9e30dcf95ad1eb285a87b465789800f4b0c";
const NEIGHBOR_COMPLETION_SHA256 =
  "68727cb0aefb04a3f9b84f8e67a41f9aaba952665e2fef798f61110e36352b53";
const NEIGHBOR_PLAN_SHA256 =
  "1b07d57ebc5601b9ab7f6742fdb5da91b9181784d7b2a33bf28ad318fa2e10f1";
const NEIGHBOR_ROOT_SHA256 =
  "79d7d23097ec1ee11082a7b01a8f36d59383b3e2cf5d536630b29fde7a9400c4";
const SOURCE_CAPTURE_PLAN_SHA256 =
  "3923d3de3fd1bc5906530b918e2ca4c38cf0e83e3f93d1c590447dce1f5d1f37";
const SOURCE_GRAPHQL_ROOT_SHA256 =
  "8b8ad4ac1b3b1f92b0d352cb808eef0953ac07cd1bf74eb9f61d592f4e481dcc";
const SOURCE_POOL_SHA256 =
  "8c53bcb359a6cde71207a69ca5b8630d6ea299f3fdc7219db958f86cb499e4ec";
const QUALIFICATION_SHA256 =
  "e51243ea3aa740a3a0812f8c1289ac2d3cf51436440ae0ecfea67a280743f1cc";

type BuildInput = Parameters<
  typeof buildC6LiveMultiLangNeighborCensusQualification
>[0];

setDefaultTimeout(300_000);

maybeDescribe(
  "Codex coding-effect C6 Live/MultiLang neighbor census qualification gate",
  () => {
    it("rebuilds the frozen qualification byte-for-byte without opening readiness boundaries", async () => {
      const qualificationBytes = await readFile(QUALIFICATION_PATH);
      expect(sha256(qualificationBytes)).toBe(QUALIFICATION_SHA256);

      const replay =
        await buildC6LiveMultiLangNeighborCensusQualification(
          exactBuildInput(),
        );

      expect(replay.outputSha256).toBe(QUALIFICATION_SHA256);
      expect(Buffer.from(
        serializeC6LiveMultiLangNeighborCensusQualification(
          replay.qualification,
        ),
        "utf8",
      )).toEqual(qualificationBytes);
      expect(replay.qualification.schemaVersion).toBe(2);
      expect(replay.qualification.counts).toEqual({
        capturedRepositoryCount: 64,
        deepCaptureTargetCount: 692,
        duplicateObservationCount: 0,
        existingAnchorOverlapCount: 3,
        novelCanonicalPullCount: 1021,
        novelWithReviewSurfaceCount: 692,
        novelWithoutReviewSurfaceCount: 329,
        rawObservationCount: 1024,
        sourceCanonicalAnchorCount: 743,
        truncatedRepositoryCount: 64,
        uniqueCanonicalPullCount: 1024,
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
      expect(replay.qualification.independenceBoundary).toEqual({
        canonicalPullProjectionSha256:
          "06b6ac9ac67447b72a492e5e118b41d1eb9195895421e94ae8eb832b69c402c8",
        deepCaptureTargetProjectionSha256:
          "f45d9ef61b55d73d2b94c8018d7874ae58887fa01133a4fd77883f0548701404",
        excludedAnchorProjectionSha256:
          "f33883edbbca727e49ab68d77e517a02323174c85b973fb3f40452d4a2ea9f5b",
        existingAnchorProjectionSha256:
          "2a144a3e31a2451c8a8076a2146d0c08bf76c23d77e7ee6c3a3d174f1cbe3aa8",
        goldInput: false,
        machineOutcomeInput: false,
        metadataQuerySha256:
          "ad41b6656f21f35e45a592e3b39549a02a0ae9536d01ac6052c1f31b0ee635d3",
        patchInput: false,
        postMergeStructuralMetadataInput: true,
        qualificationPolicySha256:
          "a80ef0981b35dc5479d9d8b346d14a4187494dbb0c0591bd4dd412cb49acb025",
        semanticDecisionInput: false,
        testInput: false,
      });

      const selected = replay.qualification.results.find(
        (result) =>
          result.status ===
          "novel-review-surface-deep-capture-target",
      );
      expect(selected).toBeDefined();
      if (selected === undefined) {
        throw new Error("frozen qualification has no deep-capture target");
      }
      const observation = {
        authorLogin: selected.authorLogin,
        baseRefOid: selected.baseRefOid,
        canonicalAnchorId: selected.canonicalAnchorId,
        canonicalRepository: selected.canonicalRepository,
        captureDirectory:
          selected.observationRefs[0]!.captureDirectory,
        commentCount: selected.commentCount,
        createdAt: selected.createdAt,
        mergeCommitOid: selected.mergeCommitOid,
        mergedAt: selected.mergedAt,
        pilotRank: selected.pilotRank,
        responseNodeRank: selected.responseNodeRank,
        reviewCount: selected.reviewCount,
        reviewThreadCount: selected.reviewThreadCount,
        sourceSplit: selected.sourceSplit,
        url: selected.url,
      };
      const derivationInput = {
        capturedRepositoryCount: 1,
        inputs: replay.qualification.inputs,
        observations: [observation],
        sourceAnchors: Array.from({ length: 743 }, (_, index) => ({
          canonicalAnchorId: `synthetic/source#${index + 1}`,
          captureOrder: index + 1,
        })),
        truncatedRepositoryCount: 0,
      };
      expect(
        deriveC6LiveMultiLangNeighborCensusQualification(
          derivationInput,
        ).results[0]?.status,
      ).toBe("novel-review-surface-deep-capture-target");
      const outcomeContaminatedObservation = {
        ...observation,
        outcome: "passed",
      };
      expect(() =>
        deriveC6LiveMultiLangNeighborCensusQualification({
          ...derivationInput,
          observations: [outcomeContaminatedObservation],
        })
      ).toThrow();
    });

    it("rejects terminal root metadata and empty-directory mutations on a private copy", async () => {
      const temporaryRoot = await realpath(
        await mkdtemp(join(
          tmpdir(),
          "goodmemory-c6-neighbor-qualification-gate-",
        )),
      );
      const mutableNeighborRoot = join(temporaryRoot, "neighbor");
      const assetLockPath = join(
        mutableNeighborRoot,
        "asset-lock.json",
      );
      try {
        await cp(
          requiredExternalPath(
            NEIGHBOR_ROOT,
            "GOODMEMORY_TEST_C6_LIVE_MULTILANG_NEIGHBOR_ROOT",
          ),
          mutableNeighborRoot,
          { recursive: true },
        );
        await expect(
          buildC6LiveMultiLangNeighborCensusQualification(
            exactBuildInput({
              neighborRoot: mutableNeighborRoot,
              testHooks: {
                beforeTerminalVerification: () =>
                  writeFile(assetLockPath, "{}\n", "utf8"),
              },
            }),
          ),
        ).rejects.toThrow("rejects untracked root asset-lock.json");

        await rm(assetLockPath);
        await expect(
          buildC6LiveMultiLangNeighborCensusQualification(
            exactBuildInput({
              neighborRoot: mutableNeighborRoot,
              testHooks: {
                beforeTerminalVerification: async () => {
                  await mkdir(join(
                    mutableNeighborRoot,
                    "unexpected-empty-directory",
                  ));
                },
              },
            }),
          ),
        ).rejects.toThrow("unexpected neighbor root entry");
      } finally {
        await rm(temporaryRoot, { force: true, recursive: true });
      }
    });

    it("rejects copied actor-frame and source-pool byte mutations", async () => {
      const temporaryRoot = await realpath(
        await mkdtemp(join(
          tmpdir(),
          "goodmemory-c6-neighbor-provenance-gate-",
        )),
      );
      const actorFramePath = join(
        temporaryRoot,
        basename(ACTOR_FRAME_PATH),
      );
      const sourcePoolPath = join(
        temporaryRoot,
        basename(SOURCE_POOL_PATH),
      );
      try {
        await Promise.all([
          copyFile(ACTOR_FRAME_PATH, actorFramePath),
          copyFile(SOURCE_POOL_PATH, sourcePoolPath),
        ]);
        await appendFile(actorFramePath, "\n", "utf8");
        await expect(
          buildC6LiveMultiLangNeighborCensusQualification(
            exactBuildInput({ actorFramePath }),
          ),
        ).rejects.toThrow("input hash mismatch");

        await copyFile(ACTOR_FRAME_PATH, actorFramePath);
        await appendFile(sourcePoolPath, "\n", "utf8");
        await expect(
          buildC6LiveMultiLangNeighborCensusQualification(
            exactBuildInput({ sourcePoolPath }),
          ),
        ).rejects.toThrow("input hash mismatch");
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
    expectedNeighborPlanSha256: NEIGHBOR_PLAN_SHA256,
    expectedNeighborRootSha256: NEIGHBOR_ROOT_SHA256,
    expectedSourceCapturePlanSha256:
      SOURCE_CAPTURE_PLAN_SHA256,
    expectedSourceGraphqlRootSha256:
      SOURCE_GRAPHQL_ROOT_SHA256,
    expectedSourcePoolSha256: SOURCE_POOL_SHA256,
    neighborPlanPath: NEIGHBOR_PLAN_PATH,
    neighborRoot: requiredExternalPath(
      NEIGHBOR_ROOT,
      "GOODMEMORY_TEST_C6_LIVE_MULTILANG_NEIGHBOR_ROOT",
    ),
    sourceCapturePlanPath: SOURCE_CAPTURE_PLAN_PATH,
    sourceGraphqlRoot: requiredExternalPath(
      SOURCE_GRAPHQL_ROOT,
      "GOODMEMORY_TEST_C6_LIVE_MULTILANG_GRAPHQL_ROOT",
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
      `${name} is required for the C6 neighbor qualification gate`,
    );
  }
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
