import { describe, expect, it } from "bun:test";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildC6LiveMultiLangNeighborCensusQualification,
  deriveC6LiveMultiLangNeighborCensusQualification,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-census-qualification";
import {
  parseC6LiveMultiLangNeighborCensusQualificationCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-census-qualification";

describe("Codex coding-effect C6 Live/MultiLang neighbor census qualification", () => {
  it("deduplicates canonical pulls, excludes all source anchors, and preserves census order", () => {
    const qualification =
      deriveC6LiveMultiLangNeighborCensusQualification(fixture());

    expect(qualification.boundary).toEqual({
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
    expect(qualification.counts).toEqual({
      capturedRepositoryCount: 64,
      deepCaptureTargetCount: 2,
      duplicateObservationCount: 1,
      existingAnchorOverlapCount: 1,
      novelCanonicalPullCount: 3,
      novelWithReviewSurfaceCount: 2,
      novelWithoutReviewSurfaceCount: 1,
      rawObservationCount: 5,
      sourceCanonicalAnchorCount: 743,
      truncatedRepositoryCount: 7,
      uniqueCanonicalPullCount: 4,
    });
    expect(qualification.results.map((result) => ({
      anchor: result.canonicalAnchorId,
      deepCaptureOrder: result.deepCaptureOrder,
      observationCount: result.observationRefs.length,
      status: result.status,
    }))).toEqual([{
      anchor: "example/alpha#1",
      deepCaptureOrder: undefined,
      observationCount: 1,
      status: "existing-source-anchor",
    }, {
      anchor: "example/beta#2",
      deepCaptureOrder: undefined,
      observationCount: 1,
      status: "novel-no-review-surface",
    }, {
      anchor: "example/gamma#3",
      deepCaptureOrder: 1,
      observationCount: 1,
      status: "novel-review-surface-deep-capture-target",
    }, {
      anchor: "example/delta#4",
      deepCaptureOrder: 2,
      observationCount: 2,
      status: "novel-review-surface-deep-capture-target",
    }]);
    expect(qualification.results[1]).toMatchObject({
      commentCount: 9,
      reviewCount: 0,
      reviewThreadCount: 0,
    });
    expect(qualification.results[2]).toMatchObject({
      pilotRank: 2,
      responseNodeRank: 1,
    });
    expect(qualification.results[3]).toMatchObject({
      pilotRank: 3,
      responseNodeRank: 1,
    });
    expect(qualification.sampleBoundary).toEqual({
      adaptiveRepositoryExclusion: true,
      mergedPullRequestsOnly: true,
      newestPerRepositoryCap: 16,
      postMergeStructuralMetadataInput: true,
      repositorySampleRandom: false,
      reviewSurfaceEnrichmentApplied: true,
    });
    expect(qualification.schemaVersion).toBe(2);
    expect(qualification.inputs).toMatchObject({
      actorFrame: {
        path: "actor-frame.json",
      },
      actorFrameCandidateProjectionSha256: "1".repeat(64),
      sourcePool: {
        path: "source-pool.json",
      },
    });
  });

  it("uses only review or review-thread presence and rejects hidden content", () => {
    const input = fixture();
    input.observations[1] = {
      ...input.observations[1]!,
      commentCount: 999,
    };
    expect(
      deriveC6LiveMultiLangNeighborCensusQualification(input)
        .results[1]?.status,
    ).toBe("novel-no-review-surface");

    const contaminated = fixture();
    (
      contaminated.observations[2] as
        (typeof contaminated.observations)[number] &
        Record<string, unknown>
    ).patch = "hidden patch";
    expect(() =>
      deriveC6LiveMultiLangNeighborCensusQualification(contaminated)
    ).toThrow();
  });

  it("fails closed when duplicate canonical observations disagree", () => {
    const input = fixture();
    input.observations[4] = {
      ...input.observations[4]!,
      mergeCommitOid: "f".repeat(40),
    };
    expect(() =>
      deriveC6LiveMultiLangNeighborCensusQualification(input)
    ).toThrow("duplicate canonical pull metadata mismatch");
  });

  it("requires all 743 source anchors and rejects symlinked inputs", async () => {
    const incomplete = fixture();
    incomplete.sourceAnchors.pop();
    expect(() =>
      deriveC6LiveMultiLangNeighborCensusQualification(incomplete)
    ).toThrow("requires exactly 743 source anchors");

    const root = await realpath(
      await mkdtemp(join(tmpdir(), "goodmemory-c6-neighbor-qualification-")),
    );
    try {
      const neighborRoot = join(root, "neighbor");
      const sourceRoot = join(root, "source");
      const plan = join(root, "plan.json");
      const planLink = join(root, "plan-link.json");
      const sourcePlan = join(root, "source-plan.json");
      await Promise.all([
        mkdir(neighborRoot),
        mkdir(sourceRoot),
        writeFile(plan, "{}\n"),
        writeFile(sourcePlan, "{}\n"),
      ]);
      await symlink(plan, planLink);
      await expect(
        buildC6LiveMultiLangNeighborCensusQualification({
          actorFramePath: plan,
          expectedActorFrameSha256: "0".repeat(64),
          expectedNeighborCompletionSha256: "0".repeat(64),
          expectedNeighborPlanSha256: "0".repeat(64),
          expectedNeighborRootSha256: "0".repeat(64),
          expectedSourceCapturePlanSha256: "0".repeat(64),
          expectedSourceGraphqlRootSha256: "0".repeat(64),
          expectedSourcePoolSha256: "0".repeat(64),
          neighborPlanPath: planLink,
          neighborRoot,
          sourceCapturePlanPath: sourcePlan,
          sourceGraphqlRoot: sourceRoot,
          sourcePoolPath: sourcePlan,
        }),
      ).rejects.toThrow("rejects symlink path component");

      await writeFile(
        join(neighborRoot, "asset-lock.json"),
        "{}\n",
      );
      await expect(
        buildC6LiveMultiLangNeighborCensusQualification({
          actorFramePath: plan,
          expectedActorFrameSha256: "0".repeat(64),
          expectedNeighborCompletionSha256: "0".repeat(64),
          expectedNeighborPlanSha256: "0".repeat(64),
          expectedNeighborRootSha256: "0".repeat(64),
          expectedSourceCapturePlanSha256: "0".repeat(64),
          expectedSourceGraphqlRootSha256: "0".repeat(64),
          expectedSourcePoolSha256: "0".repeat(64),
          neighborPlanPath: plan,
          neighborRoot,
          sourceCapturePlanPath: sourcePlan,
          sourceGraphqlRoot: sourceRoot,
          sourcePoolPath: sourcePlan,
        }),
      ).rejects.toThrow("rejects untracked root asset-lock.json");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("parses every materialization binding exactly once", () => {
    const hash = "a".repeat(64);
    expect(
      parseC6LiveMultiLangNeighborCensusQualificationCliOptions([
        "--actor-frame=actor-frame.json",
        `--expected-actor-frame-sha256=${hash}`,
        "--neighbor-plan=neighbor-plan.json",
        "--neighbor-root=/capture/neighbor",
        "--source-pool=source-pool.json",
        "--source-capture-plan=source-plan.json",
        "--source-graphql-root=/capture/source",
        `--expected-neighbor-completion-sha256=${hash}`,
        `--expected-neighbor-plan-sha256=${hash}`,
        `--expected-neighbor-root-sha256=${hash}`,
        `--expected-source-capture-plan-sha256=${hash}`,
        `--expected-source-graphql-root-sha256=${hash}`,
        `--expected-source-pool-sha256=${hash}`,
        "--output=qualification.json",
      ]),
    ).toEqual({
      actorFrame: "actor-frame.json",
      expectedActorFrameSha256: hash,
      expectedNeighborCompletionSha256: hash,
      expectedNeighborPlanSha256: hash,
      expectedNeighborRootSha256: hash,
      expectedSourceCapturePlanSha256: hash,
      expectedSourceGraphqlRootSha256: hash,
      expectedSourcePoolSha256: hash,
      neighborPlan: "neighbor-plan.json",
      neighborRoot: "/capture/neighbor",
      output: "qualification.json",
      sourceCapturePlan: "source-plan.json",
      sourceGraphqlRoot: "/capture/source",
      sourcePool: "source-pool.json",
    });
    expect(() =>
      parseC6LiveMultiLangNeighborCensusQualificationCliOptions([
        "--neighbor-plan=neighbor-plan.json",
      ])
    ).toThrow(
      "--actor-frame is required exactly once",
    );
  });
});

function fixture() {
  const sourceAnchors = Array.from({ length: 743 }, (_, index) => ({
    canonicalAnchorId: index === 0
      ? "example/alpha#1"
      : `source/repository#${index + 1}`,
    captureOrder: index + 1,
  }));
  return {
    capturedRepositoryCount: 64,
    inputs: {
      actorFrame: reference("actor-frame.json", "f"),
      actorFrameCandidateProjectionSha256: "1".repeat(64),
      neighborCompletion: reference("completion.json", "a"),
      neighborPlan: reference("neighbor-plan.json", "b"),
      neighborRootSha256: "c".repeat(64),
      sourceCapturePlan: reference("source-plan.json", "d"),
      sourceGraphqlRootSha256: "e".repeat(64),
      sourcePool: reference("source-pool.json", "9"),
    },
    observations: [
      observation({
        canonicalAnchorId: "example/alpha#1",
        pilotRank: 1,
        responseNodeRank: 1,
        reviewCount: 2,
      }),
      observation({
        canonicalAnchorId: "example/beta#2",
        commentCount: 9,
        pilotRank: 1,
        responseNodeRank: 2,
      }),
      observation({
        canonicalAnchorId: "example/gamma#3",
        pilotRank: 2,
        responseNodeRank: 1,
        reviewCount: 1,
        sourceSplit: "cpp",
      }),
      observation({
        canonicalAnchorId: "example/delta#4",
        pilotRank: 3,
        responseNodeRank: 1,
        reviewThreadCount: 1,
        sourceSplit: "go",
      }),
      observation({
        canonicalAnchorId: "example/delta#4",
        pilotRank: 4,
        responseNodeRank: 1,
        reviewThreadCount: 1,
        sourceSplit: "js",
      }),
    ],
    sourceAnchors,
    truncatedRepositoryCount: 7,
  };
}

function observation(input: {
  canonicalAnchorId: string;
  commentCount?: number;
  pilotRank: number;
  responseNodeRank: number;
  reviewCount?: number;
  reviewThreadCount?: number;
  sourceSplit?: "c" | "cpp" | "go" | "js";
}) {
  const [canonicalRepository] = input.canonicalAnchorId.split("#");
  return {
    authorLogin: "author",
    baseRefOid: "a".repeat(40),
    canonicalAnchorId: input.canonicalAnchorId,
    canonicalRepository: canonicalRepository!,
    captureDirectory: `${input.pilotRank}__capture`,
    commentCount: input.commentCount ?? 0,
    createdAt: "2026-07-01T00:00:00Z",
    mergeCommitOid: "b".repeat(40),
    mergedAt: "2026-07-02T00:00:00Z",
    pilotRank: input.pilotRank,
    responseNodeRank: input.responseNodeRank,
    reviewCount: input.reviewCount ?? 0,
    reviewThreadCount: input.reviewThreadCount ?? 0,
    sourceSplit: input.sourceSplit ?? "c" as const,
    url: `https://github.com/${input.canonicalAnchorId.replace("#", "/pull/")}`,
  };
}

function reference(path: string, fill: string) {
  return {
    bytes: 1,
    path,
    sha256: fill.repeat(64),
  };
}
