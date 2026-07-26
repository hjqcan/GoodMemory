import { describe, expect, it } from "bun:test";

import {
  evaluateC6RepositoryClaimAcceptance,
  evaluateC6RepositoryPairedStatistics,
} from "../../scripts/codex-coding-effect/c6-repository-statistics";
import type {
  C6RepositoryPairedStatisticsInput,
} from "../../scripts/codex-coding-effect/c6-repository-statistics";

describe("Codex coding-effect C6 repository statistics", () => {
  it("computes the frozen paired estimands, intervals, diagnostics, and strict claim gate", () => {
    const result = evaluateC6RepositoryPairedStatistics(
      allTreatmentOnlyInput(),
    );

    expect(result).toMatchObject({
      bootstrap: {
        algorithm:
          "paired-repository-episode-hierarchical-percentile-v1",
        confidenceLevel: 0.95,
        randomGenerator: "mulberry32-rejection-v1",
        samples: 10_000,
        seed: 20_260_725,
      },
      counts: {
        cells: 16,
        episodes: 4,
        repositoryFamilies: 2,
      },
      episodeWeighted: {
        confidenceInterval: {
          lower: 1,
          upper: 1,
        },
        estimate: 1,
      },
      equalRepository: {
        confidenceInterval: {
          lower: 1,
          upper: 1,
        },
        estimate: 1,
      },
      leaveOneRepositoryOut: {
        maximumAbsoluteShift: 0,
        minimumDelta: 1,
        signFlipCount: 0,
      },
      pairedDiscordanceDiagnostic: {
        bothFailed: 0,
        bothResolved: 0,
        comparatorOnlyResolved: 0,
        mcnemarExactTwoSidedPValue: expect.any(Number),
        treatmentOnlyResolved: 16,
      },
    });
    expect(result.leaveOneRepositoryOut.repositories).toEqual([
      {
        delta: 1,
        omittedRepositoryFamilyId: "repo-a",
      },
      {
        delta: 1,
        omittedRepositoryFamilyId: "repo-b",
      },
    ]);

    expect(evaluateC6RepositoryClaimAcceptance({
      nonInferiorityMargin: 0.02,
      pointDeltaMinimum: 0.1,
      statistics: result,
    })).toEqual({
      nonInferiority: {
        accepted: true,
        everyLeaveOneRepositoryOutDeltaAboveMargin: true,
        hierarchicalEpisodeWeightedLowerBoundAboveMargin: true,
        hierarchicalRepositoryEqualLowerBoundAboveMargin: true,
        margin: 0.02,
      },
      superiority: {
        accepted: true,
        everyLeaveOneRepositoryOutDeltaPositive: true,
        hierarchicalEpisodeWeightedLowerBoundPositive: true,
        hierarchicalRepositoryEqualLowerBoundPositive: true,
        pointDeltaMinimum: 0.1,
        pointDeltaMinimumMet: true,
      },
    });
  });

  it("keeps episode-weighted and equal-repository estimands distinct and fails on one negative LORO", () => {
    const input = allTreatmentOnlyInput();
    input.expectedEpisodeIds = ["a-1", "a-2", "a-3", "b-1"];
    input.repositoryFamilyByEpisodeId = {
      "a-1": "repo-a",
      "a-2": "repo-a",
      "a-3": "repo-a",
      "b-1": "repo-b",
    };
    input.eligibleStagesByEpisodeId = Object.fromEntries(
      input.expectedEpisodeIds.map((episodeId) => [
        episodeId,
        [{ stageId: "stage-2", stagePosition: 2 }],
      ]),
    );
    input.cells = input.expectedEpisodeIds.flatMap((episodeId) =>
      input.expectedSeeds.map((seed) => ({
        comparatorResolved: episodeId === "b-1" ? 1 as const : 0 as const,
        episodeId,
        seed,
        stageId: "stage-2",
        stagePosition: 2,
        treatmentResolved: episodeId === "b-1" ? 0 as const : 1 as const,
      }))
    );

    const result = evaluateC6RepositoryPairedStatistics(input);
    expect(result.episodeWeighted.estimate).toBe(0.5);
    expect(result.equalRepository.estimate).toBe(0);
    expect(result.episodeWeighted.confidenceInterval.lower).toBeLessThan(0);
    expect(result.leaveOneRepositoryOut).toMatchObject({
      minimumDelta: -1,
      signFlipCount: 1,
    });
    expect(result.leaveOneRepositoryOut.repositories).toEqual([
      {
        delta: -1,
        omittedRepositoryFamilyId: "repo-a",
      },
      {
        delta: 1,
        omittedRepositoryFamilyId: "repo-b",
      },
    ]);

    const acceptance = evaluateC6RepositoryClaimAcceptance({
      nonInferiorityMargin: 0.02,
      pointDeltaMinimum: 0.1,
      statistics: result,
    });
    expect(acceptance.superiority.accepted).toBe(false);
    expect(
      acceptance.superiority.everyLeaveOneRepositoryOutDeltaPositive,
    ).toBe(false);
    expect(acceptance.nonInferiority.accepted).toBe(false);
  });

  it("treats zero as failing every strict superiority boundary", () => {
    const input = allTreatmentOnlyInput();
    input.cells = input.cells.map((cell) => ({
      ...cell,
      comparatorResolved: 1,
      treatmentResolved: 1,
    }));

    const result = evaluateC6RepositoryPairedStatistics(input);
    expect(result.episodeWeighted.confidenceInterval.lower).toBe(0);
    expect(result.equalRepository.confidenceInterval.lower).toBe(0);
    expect(result.leaveOneRepositoryOut.minimumDelta).toBe(0);
    expect(evaluateC6RepositoryClaimAcceptance({
      nonInferiorityMargin: 0.02,
      pointDeltaMinimum: 0,
      statistics: result,
    }).superiority).toEqual({
      accepted: false,
      everyLeaveOneRepositoryOutDeltaPositive: false,
      hierarchicalEpisodeWeightedLowerBoundPositive: false,
      hierarchicalRepositoryEqualLowerBoundPositive: false,
      pointDeltaMinimum: 0,
      pointDeltaMinimumMet: true,
    });
  });

  it("rejects incomplete, duplicated, mismatched, or one-family inputs", () => {
    const missing = allTreatmentOnlyInput();
    missing.cells.pop();
    expect(() => evaluateC6RepositoryPairedStatistics(missing)).toThrow(
      "cell closure does not match",
    );

    const duplicated = allTreatmentOnlyInput();
    duplicated.cells.push({ ...duplicated.cells[0]! });
    expect(() => evaluateC6RepositoryPairedStatistics(duplicated)).toThrow(
      "duplicate paired cell",
    );

    const wrongPosition = allTreatmentOnlyInput();
    wrongPosition.cells[0] = {
      ...wrongPosition.cells[0]!,
      stagePosition: 3,
    };
    expect(() => evaluateC6RepositoryPairedStatistics(wrongPosition)).toThrow(
      "cell closure does not match",
    );

    const oneFamily = allTreatmentOnlyInput();
    oneFamily.repositoryFamilyByEpisodeId = Object.fromEntries(
      oneFamily.expectedEpisodeIds.map((episodeId) => [
        episodeId,
        "repo-a",
      ]),
    );
    expect(() => evaluateC6RepositoryPairedStatistics(oneFamily)).toThrow(
      "at least two repository families",
    );
  });

  it("is byte-deterministic and independent of input ordering", () => {
    const first = allTreatmentOnlyInput();
    const second = allTreatmentOnlyInput();
    second.expectedEpisodeIds.reverse();
    second.expectedSeeds.reverse();
    second.cells.reverse();
    second.repositoryFamilyByEpisodeId = Object.fromEntries(
      Object.entries(second.repositoryFamilyByEpisodeId).reverse(),
    );
    second.eligibleStagesByEpisodeId = Object.fromEntries(
      Object.entries(second.eligibleStagesByEpisodeId).reverse(),
    );

    expect(JSON.stringify(
      evaluateC6RepositoryPairedStatistics(first),
    )).toBe(JSON.stringify(
      evaluateC6RepositoryPairedStatistics(second),
    ));
  });
});

function allTreatmentOnlyInput(): C6RepositoryPairedStatisticsInput {
  const expectedEpisodeIds = ["a-1", "a-2", "b-1", "b-2"];
  const expectedSeeds = [101, 202];
  const eligibleStages = [
    { stageId: "stage-2", stagePosition: 2 },
    { stageId: "stage-3", stagePosition: 3 },
  ];
  return {
    bootstrap: {
      confidenceLevel: 0.95,
      samples: 10_000,
      seed: 20_260_725,
    },
    cells: expectedEpisodeIds.flatMap((episodeId) =>
      expectedSeeds.flatMap((seed) =>
        eligibleStages.map((stage) => ({
          comparatorResolved: 0 as const,
          episodeId,
          seed,
          stageId: stage.stageId,
          stagePosition: stage.stagePosition,
          treatmentResolved: 1 as const,
        }))
      )
    ),
    eligibleStagesByEpisodeId: Object.fromEntries(
      expectedEpisodeIds.map((episodeId) => [
        episodeId,
        eligibleStages.map((stage) => ({ ...stage })),
      ]),
    ),
    expectedEpisodeIds,
    expectedSeeds,
    repositoryFamilyByEpisodeId: {
      "a-1": "repo-a",
      "a-2": "repo-a",
      "b-1": "repo-b",
      "b-2": "repo-b",
    },
  };
}
