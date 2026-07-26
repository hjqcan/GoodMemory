import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildC6EligiblePositionPowerAdjustment,
  C6_C5_V16_POWER_INPUT_BINDINGS,
  deriveC6EligiblePositionPowerAdjustment,
  materializeC6EligiblePositionPowerAdjustment,
  serializeC6EligiblePositionPowerAdjustment,
} from "../../scripts/codex-coding-effect/c6-eligible-position-power-adjustment";

const frozenProjectionRoot =
  process.env.GOODMEMORY_TEST_C5_V16_PROJECTION_ROOT;
const maybeFrozenDescribe = frozenProjectionRoot ? describe : describe.skip;

describe("Codex coding-effect C6 eligible-position power adjustment", () => {
  test("binds the independent review receipt without promoting it to public evidence", async () => {
    const artifactRoot = join(
      process.cwd(),
      "fixtures/codex-coding-effect/c6-source-pool",
    );
    const [artifactBytes, reviewBytes] = await Promise.all([
      readFile(
        join(
          artifactRoot,
          "c5-v16.eligible-position-power-adjustment-v2.json",
        ),
      ),
      readFile(
        join(
          artifactRoot,
          "c5-v16.eligible-position-power-adjustment-independent-review-v2.json",
        ),
        "utf8",
      ),
    ]);
    const review = JSON.parse(reviewBytes) as {
      boundary: {
        cryptographicReceipt: boolean;
        minimumEpisodeFloorReductionSupported: boolean;
        publicClaimEligible: boolean;
      };
      decision: string;
      independentRecalculation: {
        minimumEpisodeFloor: number;
      };
      review: {
        reviewedArtifact: {
          bytesSha256: string;
          schemaVersion: number;
        };
        reviewerAgentName: string;
      };
    };

    expect(review).toMatchObject({
      boundary: {
        cryptographicReceipt: false,
        minimumEpisodeFloorReductionSupported: false,
        publicClaimEligible: false,
      },
      decision: "accept-with-boundaries",
      independentRecalculation: {
        minimumEpisodeFloor: 391,
      },
      review: {
        reviewedArtifact: {
          schemaVersion: 2,
        },
        reviewerAgentName: "/root/c6_power_rereview",
      },
    });
    expect(review.review.reviewedArtifact.bytesSha256).toBe(
      createHash("sha256").update(artifactBytes).digest("hex"),
    );
  });

  test("recomputes the frozen eligible-position correlation without reducing 391", () => {
    const result = deriveC6EligiblePositionPowerAdjustment(evidence());

    expect(result.counts).toEqual({
      completeComparableEpisodeCount: 5,
      c6HeadlineObservationsPerEpisode: 6,
      eligibleComparablePairCount: 20,
      eligibleIncomparablePairCount: 4,
      eligibleScheduledPairCount: 24,
      fullyIncomparableEpisodeCount: 1,
      interruptedAttemptCount: 1,
      pilotEligibleObservationsPerCompleteEpisode: 4,
      scheduledPairCount: 36,
      stageExecutionCount: 72,
    });
    expect(result.correlation).toEqual({
      betweenMeanSquare: 0.8,
      completeEpisodeCount: 5,
      confidenceLevel: 0.95,
      method: "one-way-random-effects-icc-1-1-on-paired-delta",
      pointEstimate: 1,
      upperBoundMethod:
        "parameter-upper-bound-after-saturated-point-estimate",
      upperConfidenceBound: 1,
      withinMeanSquare: 0,
    });
    expect(result.planning).toMatchObject({
      designEffect: 6,
      minimumEpisodeFloor: 391,
      minimumEpisodeFloorReductionSupported: false,
      pairedObservationsBeforeClustering: 391,
    });
    expect(result.episodeSummaries).toEqual([
      {
        comparableEligiblePairCount: 4,
        eligiblePairCount: 4,
        episodeId: "rescue-a",
        pairedDeltas: [1, 1, 1, 1],
        status: "complete-comparable",
      },
      {
        comparableEligiblePairCount: 4,
        eligiblePairCount: 4,
        episodeId: "rescue-b",
        pairedDeltas: [1, 1, 1, 1],
        status: "complete-comparable",
      },
      {
        comparableEligiblePairCount: 4,
        eligiblePairCount: 4,
        episodeId: "rescue-c",
        pairedDeltas: [1, 1, 1, 1],
        status: "complete-comparable",
      },
      {
        comparableEligiblePairCount: 4,
        eligiblePairCount: 4,
        episodeId: "rescue-d",
        pairedDeltas: [1, 1, 1, 1],
        status: "complete-comparable",
      },
      {
        comparableEligiblePairCount: 4,
        eligiblePairCount: 4,
        episodeId: "shared",
        pairedDeltas: [0, 0, 0, 0],
        status: "complete-comparable",
      },
      {
        comparableEligiblePairCount: 0,
        eligiblePairCount: 4,
        episodeId: "unavailable",
        pairedDeltas: [],
        status: "fully-incomparable",
      },
    ]);
  });

  test("fails closed instead of dropping a partially comparable episode", () => {
    const input = evidence();
    const pair = input.pairs.find((candidate) =>
      candidate.episodeId === "rescue-a" &&
      candidate.repetition === 1 &&
      candidate.stageId === "task-two"
    )!;
    pair.comparable = false;
    pair.outcome = "incomparable";

    expect(() => deriveC6EligiblePositionPowerAdjustment(input)).toThrow(
      "eligible episode is only partially comparable",
    );
  });

  test("requires no memory at position one and an explicit later-stage expectation", () => {
    const positionOneMismatch = evidence();
    for (const armRun of positionOneMismatch.pilotPlan.episodeArmRuns) {
      armRun.stages[0]!.memoryExpectation = "required";
    }
    expect(() =>
      deriveC6EligiblePositionPowerAdjustment(positionOneMismatch)
    ).toThrow("pilot-plan position 1 must have no memory expectation");

    const laterPositionMismatch = evidence();
    for (const armRun of laterPositionMismatch.pilotPlan.episodeArmRuns) {
      armRun.stages[1]!.memoryExpectation = "none";
    }
    expect(() =>
      deriveC6EligiblePositionPowerAdjustment(laterPositionMismatch)
    ).toThrow(
      "pilot-plan eligible position must require or control for memory",
    );

    const irrelevantControl = evidence();
    for (const armRun of irrelevantControl.pilotPlan.episodeArmRuns) {
      armRun.stages[1]!.memoryExpectation = "irrelevant-control";
    }
    expect(
      deriveC6EligiblePositionPowerAdjustment(irrelevantControl)
        .counts.eligibleScheduledPairCount,
    ).toBe(24);
  });

  test("freezes the C5 v16 byte bindings and rejects replacement input", () => {
    expect(C6_C5_V16_POWER_INPUT_BINDINGS).toEqual({
      attemptLedger: {
        bytes: 354,
        path: "run-attempts.jsonl",
        sha256:
          "6f563835048bcb376c24be48002bcf6c2ec46fe8122c4e669feb558502ae7beb",
      },
      pairs: {
        bytes: 26602,
        path: "pairs.jsonl",
        sha256:
          "633a8af83ff25e06de644bd380359544f9f0aacc1cffa00585fb58b6dc6f17fe",
      },
      pilotPlan: {
        bytes: 74793,
        path: "pilot-plan.json",
        sha256:
          "ef7668a289d1eadbc63f020d5dcd2d1973f39722399d8349a4fd3437fbe2e72b",
      },
      projectionManifest: {
        bytes: 118365,
        path: "projection-manifest.json",
        sha256:
          "41656ed99fbadfabe836aafc39d82b2416ecda368fd8a13830ff5197e6176323",
      },
      report: {
        bytes: 3378,
        path: "report.json",
        sha256:
          "5985be5969750286ef2d2af623741e12051d3830f96bd4b8e0907b849b1eab0b",
      },
      stageExecutions: {
        bytes: 48180,
        path: "stage-executions.jsonl",
        sha256:
          "c0bb87ff4f4c8c9763012ef4793954ee48c46fc64b6428a4f1a01237ff2a1c07",
      },
    });

    expect(() => buildC6EligiblePositionPowerAdjustment({
      attemptLedgerBytes: "",
      pairsBytes: "",
      pilotPlanBytes: "",
      projectionManifestBytes: "{}\n",
      reportBytes: "",
      stageExecutionsBytes: "",
    })).toThrow("C5 v16 projection-manifest.json SHA-256 mismatch");
  });
});

maybeFrozenDescribe(
  "Codex coding-effect C6 frozen C5 v16 power materialization",
  () => {
    test("builds and materializes byte-identical output from the real frozen inputs", async () => {
      const root = frozenProjectionRoot!;
      const outputRoot = await createTempDirectory(
        "goodmemory-c6-power-real-",
      );
      try {
        const artifact = buildC6EligiblePositionPowerAdjustment(
          await readFrozenPowerInputs(root),
        );
        expect(artifact.inputs.report).toEqual(
          C6_C5_V16_POWER_INPUT_BINDINGS.report,
        );
        expect(artifact.planning).toMatchObject({
          alpha: 0.05,
          materialEffectRate: 0.1,
          pairedObservationsBeforeClustering: 391,
          planningDiscordanceRate: 0.5,
          power: 0.8,
        });

        const outputPath = join(outputRoot, "nested", "power.json");
        await mkdir(join(outputRoot, "nested"));
        await materializeC6EligiblePositionPowerAdjustment({
          outputPath,
          projectionRootPath: root,
        });
        const actual = await readFile(outputPath, "utf8");
        const expected = await readFile(
          join(
            process.cwd(),
            "fixtures/codex-coding-effect/c6-source-pool",
            "c5-v16.eligible-position-power-adjustment-v2.json",
          ),
          "utf8",
        );
        expect(actual).toBe(
          serializeC6EligiblePositionPowerAdjustment(artifact),
        );
        expect(actual).toBe(expected);
      } finally {
        await rm(outputRoot, { force: true, recursive: true });
      }
    });

    test("rejects symlinked paths and preserves an existing output", async () => {
      const root = frozenProjectionRoot!;
      const container = await createTempDirectory(
        "goodmemory-c6-power-paths-",
      );
      const projectionAlias = join(container, "projection-alias");
      const physicalOutput = join(container, "physical-output");
      const outputAlias = join(container, "output-alias");
      try {
        await mkdir(physicalOutput);
        await Promise.all([
          symlink(root, projectionAlias),
          symlink(physicalOutput, outputAlias),
        ]);

        await expect(materializeC6EligiblePositionPowerAdjustment({
          outputPath: join(container, "from-linked-input.json"),
          projectionRootPath: projectionAlias,
        })).rejects.toThrow(
          "C6 eligible-position power projection root rejects symlink path component",
        );
        await expect(materializeC6EligiblePositionPowerAdjustment({
          outputPath: join(outputAlias, "power.json"),
          projectionRootPath: root,
        })).rejects.toThrow(
          "C6 eligible-position power output parent rejects symlink path component",
        );

        const existingPath = join(physicalOutput, "existing.json");
        await writeFile(existingPath, "preserve-me\n");
        await expect(materializeC6EligiblePositionPowerAdjustment({
          outputPath: existingPath,
          projectionRootPath: root,
        })).rejects.toThrow();
        expect(await readFile(existingPath, "utf8")).toBe("preserve-me\n");
      } finally {
        await rm(container, { force: true, recursive: true });
      }
    });
  },
);

function evidence() {
  const episodeKinds = [
    ["rescue-a", "rescue"],
    ["rescue-b", "rescue"],
    ["rescue-c", "rescue"],
    ["rescue-d", "rescue"],
    ["shared", "shared-pass"],
    ["unavailable", "incomparable"],
  ] as const;
  const pairs: Array<{
    clusterId: string;
    comparable: boolean;
    episodeId: string;
    evaluations: Array<{
      arm: "goodmemory-installed" | "no-memory";
      resolved: boolean;
    }>;
    outcome:
      | "incomparable"
      | "regression"
      | "rescue"
      | "shared-fail"
      | "shared-pass";
    repetition: number;
    stageId: string;
  }> = [];
  const stageExecutions: Array<{
    arm: "goodmemory-installed" | "no-memory";
    clusterId: string;
    episodeId: string;
    repetition: number;
    stageId: string;
    stageRunId: string;
  }> = [];
  const episodeArmRuns: Array<{
    arm: "goodmemory-installed" | "no-memory";
    clusterId: string;
    episodeId: string;
    repetition: number;
    stages: Array<{
      memoryExpectation: "irrelevant-control" | "none" | "required";
      position: number;
      stageId: string;
    }>;
  }> = [];
  const stageIds = ["task-one", "task-two", "task-three"] as const;

  for (const [episodeId, kind] of episodeKinds) {
    for (const repetition of [1, 2]) {
      const clusterId = `${episodeId}/repetition-${repetition}`;
      for (const arm of ["no-memory", "goodmemory-installed"] as const) {
        episodeArmRuns.push({
          arm,
          clusterId,
          episodeId,
          repetition,
          stages: stageIds.map((stageId, index) => ({
            memoryExpectation: index === 0 ? "none" : "required",
            position: index + 1,
            stageId,
          })),
        });
      }
      for (const [index, stageId] of stageIds.entries()) {
        const eligible = index + 1 >= 2;
        const outcome = kind === "incomparable"
          ? "incomparable"
          : eligible
          ? kind
          : "shared-pass";
        const comparable = outcome !== "incomparable";
        const noMemoryResolved = outcome === "shared-pass";
        const goodMemoryResolved = outcome === "shared-pass" ||
          outcome === "rescue";
        pairs.push({
          clusterId,
          comparable,
          episodeId,
          evaluations: [
            {
              arm: "no-memory",
              resolved: noMemoryResolved,
            },
            {
              arm: "goodmemory-installed",
              resolved: goodMemoryResolved,
            },
          ],
          outcome,
          repetition,
          stageId,
        });
        for (const arm of ["no-memory", "goodmemory-installed"] as const) {
          stageExecutions.push({
            arm,
            clusterId,
            episodeId,
            repetition,
            stageId,
            stageRunId:
              `${clusterId}/${arm}/${stageId}`,
          });
        }
      }
    }
  }

  return {
    attempts: [{
      attemptId: "interrupted-attempt-1",
      clusterId: "unavailable/repetition-1",
      disposition: "process-interrupted-before-cluster-commit",
    }],
    pairs,
    pilotPlan: {
      counts: {
        episodes: 6,
        repetitions: 2,
        stageRuns: 72,
      },
      episodeArmRuns,
    },
    stageExecutions,
  };
}

async function readFrozenPowerInputs(root: string) {
  const bindings = C6_C5_V16_POWER_INPUT_BINDINGS;
  const [
    attemptLedgerBytes,
    pairsBytes,
    pilotPlanBytes,
    projectionManifestBytes,
    reportBytes,
    stageExecutionsBytes,
  ] = await Promise.all([
    readFile(join(root, bindings.attemptLedger.path), "utf8"),
    readFile(join(root, bindings.pairs.path), "utf8"),
    readFile(join(root, bindings.pilotPlan.path), "utf8"),
    readFile(join(root, bindings.projectionManifest.path), "utf8"),
    readFile(join(root, bindings.report.path), "utf8"),
    readFile(join(root, bindings.stageExecutions.path), "utf8"),
  ]);
  return {
    attemptLedgerBytes,
    pairsBytes,
    pilotPlanBytes,
    projectionManifestBytes,
    reportBytes,
    stageExecutionsBytes,
  };
}

async function createTempDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(await realpath(tmpdir()), prefix));
}
