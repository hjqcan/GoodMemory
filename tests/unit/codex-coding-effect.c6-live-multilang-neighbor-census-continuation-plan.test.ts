import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  deriveC6LiveMultiLangNeighborCensusPlan,
  serializeC6LiveMultiLangNeighborCensusPlan,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-census-plan";
import {
  deriveC6LiveMultiLangNeighborCensusContinuationPlan,
  serializeC6LiveMultiLangNeighborCensusContinuationPlan,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-census-continuation-plan";
import type {
  C6LiveMultiLangNeighborCensusContinuationPlan,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-census-continuation-plan";
import {
  parseC6LiveMultiLangNeighborCensusContinuationPlanCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-census-continuation-plan";

describe("Codex coding-effect C6 Live/MultiLang neighbor census continuation plan", () => {
  it("pins the tracked v2 tranche and its repository projection", async () => {
    const sourcePoolRoot = join(
      resolve(import.meta.dir, "../.."),
      "fixtures/codex-coding-effect/c6-source-pool",
    );
    const [priorPlanBytes, continuationPlanBytes] =
      await Promise.all([
        readFile(join(
          sourcePoolRoot,
          "swe-bench-live-multilang-608f7ae9.neighbor-census-plan-v1.json",
        )),
        readFile(join(
          sourcePoolRoot,
          "swe-bench-live-multilang-608f7ae9.neighbor-census-plan-v2.json",
        )),
      ]);
    expect(sha256(priorPlanBytes)).toBe(
      "1b07d57ebc5601b9ab7f6742fdb5da91b9181784d7b2a33bf28ad318fa2e10f1",
    );
    expect(sha256(continuationPlanBytes)).toBe(
      "1de54a4da9087502213022ccdf0703f007158ecaca4ef1dd5f51af2a93591aab",
    );

    const plan = JSON.parse(
      continuationPlanBytes.toString("utf8"),
    ) as C6LiveMultiLangNeighborCensusContinuationPlan;
    const priorPlan = JSON.parse(
      priorPlanBytes.toString("utf8"),
    ) as {
      targets: Array<{ canonicalRepository: string }>;
    };
    expect(plan.independenceBoundary
      .selectedRepositoryProjectionSha256).toBe(
      "d613a9d8c2eac5e14cb3646eab384e60856fb141bf5218f193a6ae9476de5d79",
    );
    expect(plan.counts).toMatchObject({
      continuationEligibleRepositoryCount: 279,
      cumulativeSelectedRepositoryCount: 128,
      priorSelectedRepositoryCount: 64,
      selectedRepositoryCount: 64,
    });
    expect(plan.targets.map(
      ({ withinSplitRank }) => withinSplitRank,
    )).toEqual(Array.from(
      { length: 64 },
      (_, index) => Math.floor(index / 8) + 9,
    ));
    const priorRepositories = new Set(
      priorPlan.targets.map((target) =>
        target.canonicalRepository
      ),
    );
    expect(plan.targets.every((target) =>
      !priorRepositories.has(target.canonicalRepository)
    )).toBe(true);
  });

  it("binds the first tranche and selects ranks 9 through 16 without overlap", () => {
    const source = fixtureSource();
    const priorPlan =
      deriveC6LiveMultiLangNeighborCensusPlan(source);
    const priorPlanBytes = Buffer.from(
      serializeC6LiveMultiLangNeighborCensusPlan(priorPlan),
    );
    const plan =
      deriveC6LiveMultiLangNeighborCensusContinuationPlan({
        ...source,
        expectedPriorPlanSha256: sha256(priorPlanBytes),
        expectedPriorSelectedRepositoryProjectionSha256:
          priorPlan.independenceBoundary
            .selectedRepositoryProjectionSha256,
        priorPlanBytes,
        priorPlanPath: "/frozen/neighbor-census-plan-v1.json",
      });

    expect(plan.schemaVersion).toBe(2);
    expect(plan.boundary).toEqual({
      acceptedEpisodeCount: 0,
      actorQualifiedEpisodeCount: 0,
      candidateManifestFrozen: false,
      censusCaptured: false,
      codexCallCount: 0,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status: "repository-neighbor-census-continuation-plan-only",
    });
    expect(plan.counts).toEqual({
      canonicalRedirectCollapseCount: 0,
      canonicalRepositoryCount: 144,
      continuationEligibleRepositoryCount: 72,
      cumulativeCensusCandidateCeiling: 2048,
      cumulativeSelectedRepositoryCount: 128,
      currentFrameRepositoryCount: 9,
      eligibleRepositoryCount: 136,
      excludedCurrentFrameRepositoryCount: 8,
      excludedPriorTrancheRepositoryCount: 64,
      priorSelectedRepositoryCount: 64,
      selectedRepositoryCount: 64,
      sourceAnchorCount: 144,
      sourceRequestedRepositoryCount: 144,
      trancheCensusCandidateCeiling: 1024,
    });
    expect(plan.inputs.priorNeighborPlan).toEqual({
      artifactKind:
        "c6-live-multilang-neighbor-census-plan",
      bytes: priorPlanBytes.byteLength,
      path: "neighbor-census-plan-v1.json",
      schemaVersion: 1,
      selectedRepositoryProjectionSha256:
        priorPlan.independenceBoundary
          .selectedRepositoryProjectionSha256,
      sha256: sha256(priorPlanBytes),
    });
    expect(plan.targets.slice(0, 10).map((target) => [
      target.pilotRank,
      target.sourceSplit,
      target.withinSplitRank,
      target.canonicalRepository,
    ])).toEqual([
      [1, "c", 9, "owner-c/repo-10"],
      [2, "cpp", 9, "owner-cpp/repo-10"],
      [3, "go", 9, "owner-go/repo-10"],
      [4, "js", 9, "owner-js/repo-10"],
      [5, "rust", 9, "owner-rust/repo-10"],
      [6, "java", 9, "owner-java/repo-10"],
      [7, "ts", 9, "owner-ts/repo-10"],
      [8, "cs", 9, "owner-cs/repo-10"],
      [9, "c", 10, "owner-c/repo-11"],
      [10, "cpp", 10, "owner-cpp/repo-11"],
    ]);
    expect(plan.targets.at(-1)).toMatchObject({
      canonicalRepository: "owner-cs/repo-17",
      pilotRank: 64,
      sourceSplit: "cs",
      withinSplitRank: 16,
    });
    const splitCount = {
      actorFrameEligible: 17,
      continuationEligible: 9,
      priorSelected: 8 as const,
      selected: 8 as const,
    };
    expect(plan.splitCounts).toEqual({
      c: splitCount,
      cpp: splitCount,
      go: splitCount,
      js: splitCount,
      rust: splitCount,
      java: splitCount,
      ts: splitCount,
      cs: splitCount,
    });
    const priorRepositories = new Set(
      priorPlan.targets.map((target) =>
        target.canonicalRepository
      ),
    );
    expect(plan.targets.every((target) =>
      !source.currentFrameRepositories.has(
        target.canonicalRepository,
      ) &&
      !priorRepositories.has(target.canonicalRepository)
    )).toBe(true);
    expect(sha256(JSON.stringify(plan.targets.map(
      selectedRepositoryProjection,
    )))).toBe(
      plan.independenceBoundary
        .selectedRepositoryProjectionSha256,
    );
    expect(
      serializeC6LiveMultiLangNeighborCensusContinuationPlan(
        plan,
      ),
    ).toEndWith("\n");
  });

  it("rejects forbidden outcome fields and prior-plan drift", () => {
    const source = fixtureSource();
    const priorPlan =
      deriveC6LiveMultiLangNeighborCensusPlan(source);
    const priorPlanBytes = Buffer.from(
      serializeC6LiveMultiLangNeighborCensusPlan(priorPlan),
    );
    const input = {
      ...source,
      expectedPriorPlanSha256: sha256(priorPlanBytes),
      expectedPriorSelectedRepositoryProjectionSha256:
        priorPlan.independenceBoundary
          .selectedRepositoryProjectionSha256,
      priorPlanBytes,
      priorPlanPath: "neighbor-census-plan-v1.json",
    };
    const outcomeContaminated = fixtureSource();
    for (const observation of outcomeContaminated.observations) {
      (
        observation as typeof observation &
          Record<string, unknown>
      ).outcome = "hidden";
    }
    expect(() =>
      deriveC6LiveMultiLangNeighborCensusContinuationPlan({
        ...input,
        observations: outcomeContaminated.observations,
      })
    ).toThrow("forbidden selection input");

    const changedPrior = JSON.parse(
      priorPlanBytes.toString("utf8"),
    ) as Record<string, unknown>;
    changedPrior.outcome = "hidden";
    expect(() =>
      deriveC6LiveMultiLangNeighborCensusContinuationPlan({
        ...input,
        priorPlanBytes: Buffer.from(
          `${JSON.stringify(changedPrior, null, 2)}\n`,
        ),
      })
    ).toThrow("prior-plan hash mismatch");

    expect(() =>
      deriveC6LiveMultiLangNeighborCensusContinuationPlan({
        ...input,
        expectedPriorSelectedRepositoryProjectionSha256:
          "0".repeat(64),
      })
    ).toThrow("prior selected-repository projection mismatch");
  });

  it("parses every continuation snapshot binding exactly once", () => {
    const hash = "a".repeat(64);
    expect(
      parseC6LiveMultiLangNeighborCensusContinuationPlanCliOptions([
        "--actor-frame=actor.json",
        "--capture-plan=capture-plan.json",
        `--expected-actor-frame-sha256=${hash}`,
        `--expected-capture-plan-sha256=${hash}`,
        `--expected-graphql-root-sha256=${hash}`,
        `--expected-prior-plan-sha256=${hash}`,
        `--expected-prior-selected-repository-projection-sha256=${hash}`,
        "--graphql-root=/capture/root",
        "--output=neighbor-census-plan-v2.json",
        "--prior-plan=neighbor-census-plan-v1.json",
      ]),
    ).toEqual({
      actorFrame: "actor.json",
      capturePlan: "capture-plan.json",
      expectedActorFrameSha256: hash,
      expectedCapturePlanSha256: hash,
      expectedGraphqlRootSha256: hash,
      expectedPriorPlanSha256: hash,
      expectedPriorSelectedRepositoryProjectionSha256: hash,
      graphqlRoot: "/capture/root",
      output: "neighbor-census-plan-v2.json",
      priorPlan: "neighbor-census-plan-v1.json",
    });
    expect(() =>
      parseC6LiveMultiLangNeighborCensusContinuationPlanCliOptions([
        "--actor-frame=actor.json",
      ])
    ).toThrow("--capture-plan is required exactly once");
  });
});

const SPLITS = [
  "c",
  "cpp",
  "go",
  "js",
  "rust",
  "java",
  "ts",
  "cs",
] as const;

function fixtureSource() {
  const observations = [];
  let captureOrder = 1;
  for (const sourceSplit of SPLITS) {
    for (let rank = 1; rank <= 18; rank += 1) {
      const canonicalRepository =
        `owner-${sourceSplit}/repo-${rank}`;
      observations.push({
        canonicalAnchorId:
          `${canonicalRepository}#${captureOrder}`,
        canonicalRepository,
        captureOrder,
        pullNumber: captureOrder,
        requestedAnchorId:
          `${canonicalRepository}#${captureOrder}`,
        requestedRepository: canonicalRepository,
        sourceSplit,
      });
      captureOrder += 1;
    }
  }
  return {
    currentFrameRepositories: new Set([
      ...SPLITS.map((split) => `owner-${split}/repo-1`),
      "frame-only/repository",
    ]),
    inputs: {
      actorFrame: reference("actor-frame.json"),
      actorFrameCandidateProjectionSha256: "b".repeat(64),
      capturePlan: reference("capture-plan.json"),
      capturePlanTargetProjectionSha256: "c".repeat(64),
      graphqlRootSha256: "d".repeat(64),
    },
    observations,
  };
}

function selectedRepositoryProjection(
  target: {
    canonicalRepository: string;
    pilotRank: number;
    seedAnchorId: string;
    seedCaptureOrder: number;
    sourceSplit: string;
    withinSplitRank: number;
  },
) {
  return {
    pilotRank: target.pilotRank,
    sourceSplit: target.sourceSplit,
    withinSplitRank: target.withinSplitRank,
    canonicalRepository: target.canonicalRepository,
    seedCaptureOrder: target.seedCaptureOrder,
    seedAnchorId: target.seedAnchorId,
  };
}

function reference(path: string) {
  return {
    bytes: 1,
    path,
    sha256: "a".repeat(64),
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
