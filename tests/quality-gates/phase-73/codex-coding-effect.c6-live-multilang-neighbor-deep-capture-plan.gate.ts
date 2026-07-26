import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  buildC6LiveMultiLangNeighborDeepCapturePlan,
  C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_PARENTS_PAGE_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_COMMITS_PAGE_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_DEEP_CAPTURE_QUERY_POLICY,
  C6_LIVE_MULTILANG_NEIGHBOR_DEEP_INITIAL_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREAD_COMMENTS_PAGE_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREADS_PAGE_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_REVIEWS_PAGE_QUERY,
  deriveC6LiveMultiLangNeighborDeepCapturePlan,
  serializeC6LiveMultiLangNeighborDeepCapturePlan,
} from "../../../scripts/codex-coding-effect/c6-live-multilang-neighbor-deep-capture-plan";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_POOL_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool",
);
const QUALIFICATION_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-census-qualification-v2.json",
);
const PLAN_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.neighbor-deep-capture-plan-v1.json",
);
const QUALIFICATION_SHA256 =
  "e51243ea3aa740a3a0812f8c1289ac2d3cf51436440ae0ecfea67a280743f1cc";
const QUALIFICATION_DEEP_TARGET_PROJECTION_SHA256 =
  "f45d9ef61b55d73d2b94c8018d7874ae58887fa01133a4fd77883f0548701404";
const PLAN_SHA256 =
  "9c1ebdafd700a274cffc4dba807a2425013079d1bfe74a1e99f1144399da492a";
const PLAN_TARGET_PROJECTION_SHA256 =
  "03260e55f22017bf8fc22900a6a829b4a338e9864baab3b01e62a03f98b216c6";
const EXPECTED_TARGET_COUNT = 692;

const QUERY_SHA256 = {
  capturePolicy:
    "cb1b8b0522a6580b52519dd8d89aac7d061df3bfc28005bca4441be3d9170dc8",
  commitParents:
    "8ce02fbc969ba9c51675964529bab80b63c671ae4009ab3e7a0fdb7e6eb92d1c",
  commits:
    "a5994a48a0694b5861c9ae6e0a1f889a1e9877fdcc326548e5d62162f0ec24ee",
  initial:
    "30bfa86be9be1ff432a1705dda96d18b3ba92b0165088ef6875eae741e510e10",
  reviewThreadComments:
    "907d7dae24e3f9845cb95499ee0bbd154dbdd6dbe18bd3a2f96b2455beef33cf",
  reviewThreads:
    "00a742de325aad55b1e883518ac74d8b73aad1661e1b9d234b6865809afb0b2f",
  reviews:
    "2383101d7fc493a17660b4fef43027e211a47c66deb8856e15500d4c30e1e666",
  structuralReviewPolicy:
    "b51613368026c09ad1aab3e4d08fe19197ddc1beea9499c9d8e068830527703a",
} as const;

const FORBIDDEN_GRAPHQL_FIELDS = [
  "title",
  "titleHTML",
  "closingIssuesReferences",
  "issue",
  "issues",
  "files",
  "diff",
  "patch",
  "test",
  "gold",
  "checks",
  "checkSuites",
  "checkRuns",
  "outcome",
  "message",
  "messageHeadline",
  "messageBody",
  "bodyHTML",
  "bodyText",
] as const;

interface MutableQualification {
  independenceBoundary: {
    deepCaptureTargetProjectionSha256: string;
  };
  results: Array<Record<string, unknown>>;
}

describe(
  "Codex coding-effect C6 Live/MultiLang neighbor deep-capture plan gate",
  () => {
    it("rebuilds the frozen 692-target plan byte-for-byte with exact boundaries", async () => {
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
          expectedTargetCount: EXPECTED_TARGET_COUNT,
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
        expectedRequestLowerBound: 692,
        repositoryCount: 61,
        targetCount: 692,
      });
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
      expect(replay.plan.inputs.qualification).toEqual({
        artifactKind:
          "c6-live-multilang-neighbor-census-qualification",
        bytes: qualificationBytes.byteLength,
        deepCaptureTargetProjectionSha256:
          QUALIFICATION_DEEP_TARGET_PROJECTION_SHA256,
        path:
          "swe-bench-live-multilang-608f7ae9.neighbor-census-qualification-v2.json",
        schemaVersion: 2,
        sha256: QUALIFICATION_SHA256,
      });
      expect(replay.plan.requestBoundary).toEqual({
        initialRequestPerTarget: 1,
        paginationSupplementRequestCountKnown: false,
        surfaceCompletenessClaimed: false,
      });
      expect(replay.plan.sampleBoundary).toEqual({
        adaptiveRepositoryExclusion: true,
        mergedPullRequestsOnly: true,
        newestPerRepositoryCap: 16,
        populationRepresentativenessProven: false,
        postMergeStructuralMetadataInput: true,
        repositorySampleRandom: false,
        reviewSurfaceEnrichmentApplied: true,
        reviewSurfacePretargetSelectionOnly: true,
      });

      expect(replay.plan.targets.map(
        ({ captureOrder }) => captureOrder,
      )).toEqual(Array.from(
        { length: EXPECTED_TARGET_COUNT },
        (_, index) => index + 1,
      ));
      expect(new Set(replay.plan.targets.map(
        ({ canonicalAnchorId }) => canonicalAnchorId,
      )).size).toBe(EXPECTED_TARGET_COUNT);
      expect(new Set(replay.plan.targets.map(
        ({ captureDirectory }) => captureDirectory,
      )).size).toBe(EXPECTED_TARGET_COUNT);
      expect(sha256(JSON.stringify(replay.plan.targets))).toBe(
        PLAN_TARGET_PROJECTION_SHA256,
      );
    });

    it("pins every query hash and permits bodies only on structural-review paths", async () => {
      const qualificationBytes = await readFile(
        QUALIFICATION_PATH,
      );
      const plan = deriveC6LiveMultiLangNeighborDeepCapturePlan({
        expectedTargetCount: EXPECTED_TARGET_COUNT,
        qualificationBytes,
        qualificationPath: QUALIFICATION_PATH,
      });

      expect(plan.queryContract).toEqual({
        capturePolicySha256: QUERY_SHA256.capturePolicy,
        endpoint: "https://api.github.com/graphql",
        initial: {
          operationName: "C6NeighborDeepInitial",
          sha256: QUERY_SHA256.initial,
        },
        structuralReviewPolicySha256:
          QUERY_SHA256.structuralReviewPolicy,
        supplements: {
          commitParents: {
            operationName: "C6NeighborDeepCommitParentsPage",
            sha256: QUERY_SHA256.commitParents,
          },
          commits: {
            operationName: "C6NeighborDeepCommitsPage",
            sha256: QUERY_SHA256.commits,
          },
          reviewThreadComments: {
            operationName:
              "C6NeighborDeepReviewThreadCommentsPage",
            sha256: QUERY_SHA256.reviewThreadComments,
          },
          reviewThreads: {
            operationName: "C6NeighborDeepReviewThreadsPage",
            sha256: QUERY_SHA256.reviewThreads,
          },
          reviews: {
            operationName: "C6NeighborDeepReviewsPage",
            sha256: QUERY_SHA256.reviews,
          },
        },
      });
      expect(plan.rule).toEqual(
        C6_LIVE_MULTILANG_NEIGHBOR_DEEP_CAPTURE_QUERY_POLICY,
      );
      expect(plan.rule.allowedBodyPaths).toEqual([
        "repository.pullRequest.reviews.nodes.body",
        "repository.pullRequest.reviewThreads.nodes.comments.nodes.body",
        "node.PullRequestReviewThread.comments.nodes.body",
      ]);
      expect(plan.rule.targetSelectionUsesReviewBodies).toBe(false);

      const queries = [
        {
          bodyCount: 2,
          query: C6_LIVE_MULTILANG_NEIGHBOR_DEEP_INITIAL_QUERY,
          sha256: QUERY_SHA256.initial,
        },
        {
          bodyCount: 0,
          query: C6_LIVE_MULTILANG_NEIGHBOR_COMMITS_PAGE_QUERY,
          sha256: QUERY_SHA256.commits,
        },
        {
          bodyCount: 1,
          query: C6_LIVE_MULTILANG_NEIGHBOR_REVIEWS_PAGE_QUERY,
          sha256: QUERY_SHA256.reviews,
        },
        {
          bodyCount: 1,
          query:
            C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREADS_PAGE_QUERY,
          sha256: QUERY_SHA256.reviewThreads,
        },
        {
          bodyCount: 1,
          query:
            C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREAD_COMMENTS_PAGE_QUERY,
          sha256: QUERY_SHA256.reviewThreadComments,
        },
        {
          bodyCount: 0,
          query:
            C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_PARENTS_PAGE_QUERY,
          sha256: QUERY_SHA256.commitParents,
        },
      ];
      for (const query of queries) {
        expect(sha256(query.query)).toBe(query.sha256);
        expect(countExactFieldLines(query.query, "body")).toBe(
          query.bodyCount,
        );
        for (const field of FORBIDDEN_GRAPHQL_FIELDS) {
          expect(query.query).not.toMatch(
            new RegExp(`\\b${field}\\b`, "iu"),
          );
        }
      }
      expect(queries.reduce(
        (count, query) =>
          count + countExactFieldLines(query.query, "body"),
        0,
      )).toBe(5);
    });

    it("rejects outcome, target-order, and projection mutations", async () => {
      const qualificationBytes = await readFile(
        QUALIFICATION_PATH,
      );

      const rootGoldMutation = mutableQualification(
        qualificationBytes,
      ) as MutableQualification & Record<string, unknown>;
      rootGoldMutation.gold = {
        evaluatorOnly: true,
      };
      expect(() =>
        deriveC6LiveMultiLangNeighborDeepCapturePlan({
          expectedTargetCount: EXPECTED_TARGET_COUNT,
          qualificationBytes:
            canonicalBytes(rootGoldMutation),
          qualificationPath: QUALIFICATION_PATH,
        })
      ).toThrow("forbidden qualification input $.gold");

      const semanticKeyMutation = mutableQualification(
        qualificationBytes,
      ) as MutableQualification & Record<string, unknown>;
      semanticKeyMutation.provenance = {
        evaluatorMetadata: {
          goldPatchSha256: "a".repeat(64),
          hiddenTests: ["tests/hidden.test.ts"],
        },
      };
      expect(() =>
        deriveC6LiveMultiLangNeighborDeepCapturePlan({
          expectedTargetCount: EXPECTED_TARGET_COUNT,
          qualificationBytes:
            canonicalBytes(semanticKeyMutation),
          qualificationPath: QUALIFICATION_PATH,
        })
      ).toThrow(
        "forbidden qualification input $.provenance.evaluatorMetadata",
      );

      const arbitraryKeyMutation = mutableQualification(
        qualificationBytes,
      ) as MutableQualification & Record<string, unknown>;
      arbitraryKeyMutation.oracleData = {
        accepted: true,
      };
      expect(() =>
        deriveC6LiveMultiLangNeighborDeepCapturePlan({
          expectedTargetCount: EXPECTED_TARGET_COUNT,
          qualificationBytes:
            canonicalBytes(arbitraryKeyMutation),
          qualificationPath: QUALIFICATION_PATH,
        })
      ).toThrow("Unrecognized key");

      const outcomeMutation = mutableQualification(
        qualificationBytes,
      );
      const firstTarget = deepTargets(outcomeMutation)[0];
      expect(firstTarget).toBeDefined();
      firstTarget!.outcome = "passed";
      expect(() =>
        deriveC6LiveMultiLangNeighborDeepCapturePlan({
          expectedTargetCount: EXPECTED_TARGET_COUNT,
          qualificationBytes: canonicalBytes(outcomeMutation),
          qualificationPath: QUALIFICATION_PATH,
        })
      ).toThrow();

      const targetOrderMutation = mutableQualification(
        qualificationBytes,
      );
      const firstTwoTargets = deepTargets(
        targetOrderMutation,
      ).slice(0, 2);
      expect(firstTwoTargets).toHaveLength(2);
      firstTwoTargets[0]!.deepCaptureOrder = 2;
      firstTwoTargets[1]!.deepCaptureOrder = 1;
      refreshDeepTargetProjection(targetOrderMutation);
      expect(() =>
        deriveC6LiveMultiLangNeighborDeepCapturePlan({
          expectedTargetCount: EXPECTED_TARGET_COUNT,
          qualificationBytes:
            canonicalBytes(targetOrderMutation),
          qualificationPath: QUALIFICATION_PATH,
        })
      ).toThrow("deep-capture order must be contiguous");

      const projectionMutation = mutableQualification(
        qualificationBytes,
      );
      projectionMutation.independenceBoundary
        .deepCaptureTargetProjectionSha256 = "0".repeat(64);
      expect(() =>
        deriveC6LiveMultiLangNeighborDeepCapturePlan({
          expectedTargetCount: EXPECTED_TARGET_COUNT,
          qualificationBytes: canonicalBytes(projectionMutation),
          qualificationPath: QUALIFICATION_PATH,
        })
      ).toThrow("deep-target projection mismatch");
    });
  },
);

function mutableQualification(
  bytes: Uint8Array,
): MutableQualification {
  return JSON.parse(
    Buffer.from(bytes).toString("utf8"),
  ) as MutableQualification;
}

function deepTargets(
  qualification: MutableQualification,
): Array<Record<string, unknown>> {
  return qualification.results.filter(
    (result) =>
      result.status ===
        "novel-review-surface-deep-capture-target",
  );
}

function refreshDeepTargetProjection(
  qualification: MutableQualification,
): void {
  const projection = deepTargets(qualification).map((result) => ({
    canonicalAnchorId: result.canonicalAnchorId,
    canonicalRepository: result.canonicalRepository,
    deepCaptureOrder: result.deepCaptureOrder,
    pilotRank: result.pilotRank,
    responseNodeRank: result.responseNodeRank,
    sourceSplit: result.sourceSplit,
  }));
  qualification.independenceBoundary
    .deepCaptureTargetProjectionSha256 = sha256(
      JSON.stringify(projection),
    );
}

function countExactFieldLines(
  query: string,
  field: string,
): number {
  return query.split("\n").filter(
    (line) => line.trim() === field,
  ).length;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
