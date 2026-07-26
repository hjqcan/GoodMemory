export interface C6RepositoryPairedCell {
  comparatorResolved: 0 | 1;
  episodeId: string;
  seed: number;
  stageId: string;
  stagePosition: number;
  treatmentResolved: 0 | 1;
}

export interface C6RepositoryPairedStatisticsInput {
  bootstrap: {
    confidenceLevel: 0.95;
    samples: 10_000;
    seed: number;
  };
  cells: C6RepositoryPairedCell[];
  eligibleStagesByEpisodeId: Record<string, Array<{
    stageId: string;
    stagePosition: number;
  }>>;
  expectedEpisodeIds: string[];
  expectedSeeds: number[];
  repositoryFamilyByEpisodeId: Record<string, string>;
}

export interface C6RepositoryPairedStatistics {
  bootstrap: {
    algorithm:
      "paired-repository-episode-hierarchical-percentile-v1";
    confidenceLevel: 0.95;
    randomGenerator: "mulberry32-rejection-v1";
    samples: 10_000;
    seed: number;
  };
  counts: {
    cells: number;
    episodes: number;
    repositoryFamilies: number;
  };
  episodeWeighted: {
    confidenceInterval: {
      lower: number;
      upper: number;
    };
    estimate: number;
  };
  equalRepository: {
    confidenceInterval: {
      lower: number;
      upper: number;
    };
    estimate: number;
  };
  leaveOneRepositoryOut: {
    maximumAbsoluteShift: number;
    minimumDelta: number;
    repositories: Array<{
      delta: number;
      omittedRepositoryFamilyId: string;
    }>;
    signFlipCount: number;
  };
  pairedDiscordanceDiagnostic: {
    bothFailed: number;
    bothResolved: number;
    comparatorOnlyResolved: number;
    mcnemarExactTwoSidedPValue: number;
    treatmentOnlyResolved: number;
  };
}

export interface C6RepositoryClaimAcceptance {
  nonInferiority: {
    accepted: boolean;
    everyLeaveOneRepositoryOutDeltaAboveMargin: boolean;
    hierarchicalEpisodeWeightedLowerBoundAboveMargin: boolean;
    hierarchicalRepositoryEqualLowerBoundAboveMargin: boolean;
    margin: number;
  };
  superiority: {
    accepted: boolean;
    everyLeaveOneRepositoryOutDeltaPositive: boolean;
    hierarchicalEpisodeWeightedLowerBoundPositive: boolean;
    hierarchicalRepositoryEqualLowerBoundPositive: boolean;
    pointDeltaMinimum: number;
    pointDeltaMinimumMet: boolean;
  };
}

interface PreparedStatisticsInput {
  cells: C6RepositoryPairedCell[];
  episodeDeltas: Map<string, number>;
  episodeIds: string[];
  episodesByRepository: Map<string, string[]>;
  repositoryFamilyIds: string[];
}

export function evaluateC6RepositoryPairedStatistics(
  input: C6RepositoryPairedStatisticsInput,
): C6RepositoryPairedStatistics {
  const prepared = prepareInput(input);
  const episodeWeightedEstimate = mean(
    prepared.episodeIds.map((episodeId) =>
      prepared.episodeDeltas.get(episodeId)!
    ),
  );
  const repositoryMeans = prepared.repositoryFamilyIds.map(
    (repositoryFamilyId) => mean(
      prepared.episodesByRepository.get(repositoryFamilyId)!.map(
        (episodeId) => prepared.episodeDeltas.get(episodeId)!,
      ),
    ),
  );
  const equalRepositoryEstimate = mean(repositoryMeans);
  const generator = createRandomGenerator(input.bootstrap.seed);
  const episodeWeightedReplicates: number[] = [];
  const equalRepositoryReplicates: number[] = [];
  for (let sample = 0; sample < input.bootstrap.samples; sample += 1) {
    const sampledEpisodeDeltas: number[] = [];
    const sampledRepositoryMeans: number[] = [];
    for (
      let repositoryIndex = 0;
      repositoryIndex < prepared.repositoryFamilyIds.length;
      repositoryIndex += 1
    ) {
      const sampledRepositoryFamilyId =
        prepared.repositoryFamilyIds[generator.nextInt(
          prepared.repositoryFamilyIds.length,
        )]!;
      const repositoryEpisodeIds =
        prepared.episodesByRepository.get(sampledRepositoryFamilyId)!;
      const repositorySample: number[] = [];
      for (
        let episodeIndex = 0;
        episodeIndex < repositoryEpisodeIds.length;
        episodeIndex += 1
      ) {
        const sampledEpisodeId = repositoryEpisodeIds[
          generator.nextInt(repositoryEpisodeIds.length)
        ]!;
        const delta = prepared.episodeDeltas.get(sampledEpisodeId)!;
        sampledEpisodeDeltas.push(delta);
        repositorySample.push(delta);
      }
      sampledRepositoryMeans.push(mean(repositorySample));
    }
    episodeWeightedReplicates.push(mean(sampledEpisodeDeltas));
    equalRepositoryReplicates.push(mean(sampledRepositoryMeans));
  }

  const leaveOneRepositoryOut = prepared.repositoryFamilyIds.map(
    (omittedRepositoryFamilyId) => {
      const retainedEpisodeDeltas = prepared.repositoryFamilyIds
        .filter((repositoryFamilyId) =>
          repositoryFamilyId !== omittedRepositoryFamilyId
        )
        .flatMap((repositoryFamilyId) =>
          prepared.episodesByRepository.get(repositoryFamilyId)!.map(
            (episodeId) => prepared.episodeDeltas.get(episodeId)!,
          )
        );
      return {
        delta: mean(retainedEpisodeDeltas),
        omittedRepositoryFamilyId,
      };
    },
  );
  const discordance = pairedDiscordance(prepared.cells);

  return {
    bootstrap: {
      algorithm:
        "paired-repository-episode-hierarchical-percentile-v1",
      confidenceLevel: input.bootstrap.confidenceLevel,
      randomGenerator: "mulberry32-rejection-v1",
      samples: input.bootstrap.samples,
      seed: input.bootstrap.seed,
    },
    counts: {
      cells: prepared.cells.length,
      episodes: prepared.episodeIds.length,
      repositoryFamilies: prepared.repositoryFamilyIds.length,
    },
    episodeWeighted: {
      confidenceInterval: percentileInterval(
        episodeWeightedReplicates,
        input.bootstrap.confidenceLevel,
      ),
      estimate: episodeWeightedEstimate,
    },
    equalRepository: {
      confidenceInterval: percentileInterval(
        equalRepositoryReplicates,
        input.bootstrap.confidenceLevel,
      ),
      estimate: equalRepositoryEstimate,
    },
    leaveOneRepositoryOut: {
      maximumAbsoluteShift: Math.max(...leaveOneRepositoryOut.map(
        (result) => Math.abs(result.delta - episodeWeightedEstimate),
      )),
      minimumDelta: Math.min(...leaveOneRepositoryOut.map(
        (result) => result.delta,
      )),
      repositories: leaveOneRepositoryOut,
      signFlipCount: leaveOneRepositoryOut.filter((result) =>
        isSignFlip(episodeWeightedEstimate, result.delta)
      ).length,
    },
    pairedDiscordanceDiagnostic: {
      ...discordance,
      mcnemarExactTwoSidedPValue: mcnemarExactTwoSidedPValue(
        discordance.treatmentOnlyResolved,
        discordance.comparatorOnlyResolved,
      ),
    },
  };
}

export function evaluateC6RepositoryClaimAcceptance(input: {
  nonInferiorityMargin: number;
  pointDeltaMinimum: number;
  statistics: C6RepositoryPairedStatistics;
}): C6RepositoryClaimAcceptance {
  if (
    !Number.isFinite(input.nonInferiorityMargin) ||
    input.nonInferiorityMargin < 0
  ) {
    throw new Error(
      "C6 repository non-inferiority margin must be finite and non-negative",
    );
  }
  if (!Number.isFinite(input.pointDeltaMinimum)) {
    throw new Error(
      "C6 repository point delta minimum must be finite",
    );
  }
  const everyLeaveOneRepositoryOutDeltaPositive =
    input.statistics.leaveOneRepositoryOut.repositories.every(
      (result) => result.delta > 0,
    );
  const hierarchicalEpisodeWeightedLowerBoundPositive =
    input.statistics.episodeWeighted.confidenceInterval.lower > 0;
  const hierarchicalRepositoryEqualLowerBoundPositive =
    input.statistics.equalRepository.confidenceInterval.lower > 0;
  const pointDeltaMinimumMet =
    input.statistics.episodeWeighted.estimate >= input.pointDeltaMinimum;
  const negativeMargin = -input.nonInferiorityMargin;
  const everyLeaveOneRepositoryOutDeltaAboveMargin =
    input.statistics.leaveOneRepositoryOut.repositories.every(
      (result) => result.delta > negativeMargin,
    );
  const hierarchicalEpisodeWeightedLowerBoundAboveMargin =
    input.statistics.episodeWeighted.confidenceInterval.lower >
      negativeMargin;
  const hierarchicalRepositoryEqualLowerBoundAboveMargin =
    input.statistics.equalRepository.confidenceInterval.lower >
      negativeMargin;

  return {
    nonInferiority: {
      accepted:
        everyLeaveOneRepositoryOutDeltaAboveMargin &&
        hierarchicalEpisodeWeightedLowerBoundAboveMargin &&
        hierarchicalRepositoryEqualLowerBoundAboveMargin,
      everyLeaveOneRepositoryOutDeltaAboveMargin,
      hierarchicalEpisodeWeightedLowerBoundAboveMargin,
      hierarchicalRepositoryEqualLowerBoundAboveMargin,
      margin: input.nonInferiorityMargin,
    },
    superiority: {
      accepted:
        everyLeaveOneRepositoryOutDeltaPositive &&
        hierarchicalEpisodeWeightedLowerBoundPositive &&
        hierarchicalRepositoryEqualLowerBoundPositive &&
        pointDeltaMinimumMet,
      everyLeaveOneRepositoryOutDeltaPositive,
      hierarchicalEpisodeWeightedLowerBoundPositive,
      hierarchicalRepositoryEqualLowerBoundPositive,
      pointDeltaMinimum: input.pointDeltaMinimum,
      pointDeltaMinimumMet,
    },
  };
}

function prepareInput(
  input: C6RepositoryPairedStatisticsInput,
): PreparedStatisticsInput {
  if (
    input.bootstrap.confidenceLevel !== 0.95 ||
    input.bootstrap.samples !== 10_000 ||
    !Number.isSafeInteger(input.bootstrap.seed) ||
    input.bootstrap.seed <= 0 ||
    input.bootstrap.seed > 0xffff_ffff
  ) {
    throw new Error("C6 repository bootstrap configuration is invalid");
  }
  const episodeIds = sortedUniqueStrings(
    input.expectedEpisodeIds,
    "expected episode ids",
  );
  const seeds = sortedUniqueIntegers(
    input.expectedSeeds,
    "expected seeds",
  );
  if (episodeIds.length === 0 || seeds.length === 0) {
    throw new Error(
      "C6 repository statistics require episodes and seeds",
    );
  }
  assertExactKeys(
    input.eligibleStagesByEpisodeId,
    episodeIds,
    "eligible-stage episode",
  );
  assertExactKeys(
    input.repositoryFamilyByEpisodeId,
    episodeIds,
    "repository-family episode",
  );

  const expectedCellKeys: string[] = [];
  for (const episodeId of episodeIds) {
    const stages = input.eligibleStagesByEpisodeId[episodeId]!;
    if (stages.length === 0) {
      throw new Error(
        `C6 repository statistics episode ${episodeId} has no eligible stage`,
      );
    }
    const stageKeys = new Set<string>();
    for (const stage of stages) {
      assertIdentifier(stage.stageId, "eligible stage id");
      if (
        !Number.isSafeInteger(stage.stagePosition) ||
        stage.stagePosition < 2
      ) {
        throw new Error(
          "C6 repository statistics require stage positions two and later",
        );
      }
      const stageKey = JSON.stringify([
        stage.stageId,
        stage.stagePosition,
      ]);
      if (stageKeys.has(stageKey)) {
        throw new Error(
          `C6 repository statistics duplicate eligible stage ${episodeId}`,
        );
      }
      stageKeys.add(stageKey);
      for (const seed of seeds) {
        expectedCellKeys.push(cellKey({
          episodeId,
          seed,
          stageId: stage.stageId,
          stagePosition: stage.stagePosition,
        }));
      }
    }
  }
  expectedCellKeys.sort(compareUtf8);

  const seenCellKeys = new Set<string>();
  for (const cell of input.cells) {
    assertIdentifier(cell.episodeId, "paired cell episode id");
    assertIdentifier(cell.stageId, "paired cell stage id");
    if (
      !Number.isSafeInteger(cell.seed) ||
      !Number.isSafeInteger(cell.stagePosition) ||
      (cell.comparatorResolved !== 0 && cell.comparatorResolved !== 1) ||
      (cell.treatmentResolved !== 0 && cell.treatmentResolved !== 1)
    ) {
      throw new Error("C6 repository paired cell is invalid");
    }
    const key = cellKey(cell);
    if (seenCellKeys.has(key)) {
      throw new Error(`C6 repository duplicate paired cell ${key}`);
    }
    seenCellKeys.add(key);
  }
  const actualCellKeys = [...seenCellKeys].sort(compareUtf8);
  if (
    actualCellKeys.length !== expectedCellKeys.length ||
    actualCellKeys.some((key, index) => key !== expectedCellKeys[index])
  ) {
    throw new Error(
      "C6 repository paired cell closure does not match the frozen design",
    );
  }

  const sortedCells = [...input.cells].sort((left, right) =>
    compareUtf8(cellKey(left), cellKey(right))
  );
  const episodeDeltas = new Map<string, number>();
  for (const episodeId of episodeIds) {
    const episodeCells = sortedCells.filter((cell) =>
      cell.episodeId === episodeId
    );
    episodeDeltas.set(
      episodeId,
      mean(episodeCells.map((cell) =>
        cell.treatmentResolved - cell.comparatorResolved
      )),
    );
  }

  const episodesByRepository = new Map<string, string[]>();
  for (const episodeId of episodeIds) {
    const repositoryFamilyId =
      input.repositoryFamilyByEpisodeId[episodeId]!;
    assertIdentifier(repositoryFamilyId, "repository family id");
    const episodes = episodesByRepository.get(repositoryFamilyId) ?? [];
    episodes.push(episodeId);
    episodesByRepository.set(repositoryFamilyId, episodes);
  }
  const repositoryFamilyIds = [...episodesByRepository.keys()]
    .sort(compareUtf8);
  if (repositoryFamilyIds.length < 2) {
    throw new Error(
      "C6 repository statistics require at least two repository families",
    );
  }

  return {
    cells: sortedCells,
    episodeDeltas,
    episodeIds,
    episodesByRepository,
    repositoryFamilyIds,
  };
}

function pairedDiscordance(cells: C6RepositoryPairedCell[]): {
  bothFailed: number;
  bothResolved: number;
  comparatorOnlyResolved: number;
  treatmentOnlyResolved: number;
} {
  let bothFailed = 0;
  let bothResolved = 0;
  let comparatorOnlyResolved = 0;
  let treatmentOnlyResolved = 0;
  for (const cell of cells) {
    if (cell.treatmentResolved === 1 && cell.comparatorResolved === 1) {
      bothResolved += 1;
    } else if (
      cell.treatmentResolved === 1 &&
      cell.comparatorResolved === 0
    ) {
      treatmentOnlyResolved += 1;
    } else if (
      cell.treatmentResolved === 0 &&
      cell.comparatorResolved === 1
    ) {
      comparatorOnlyResolved += 1;
    } else {
      bothFailed += 1;
    }
  }
  return {
    bothFailed,
    bothResolved,
    comparatorOnlyResolved,
    treatmentOnlyResolved,
  };
}

function percentileInterval(
  values: number[],
  confidenceLevel: 0.95,
): {
  lower: number;
  upper: number;
} {
  const sorted = [...values].sort((left, right) => left - right);
  const tail = (1 - confidenceLevel) / 2;
  return {
    lower: quantileType7(sorted, tail),
    upper: quantileType7(sorted, 1 - tail),
  };
}

function quantileType7(sorted: number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex]!;
  const upper = sorted[upperIndex]!;
  return lower + (upper - lower) * (position - lowerIndex);
}

function mcnemarExactTwoSidedPValue(
  treatmentOnlyResolved: number,
  comparatorOnlyResolved: number,
): number {
  const discordant = treatmentOnlyResolved + comparatorOnlyResolved;
  if (discordant === 0) {
    return 1;
  }
  const tailMaximum = Math.min(
    treatmentOnlyResolved,
    comparatorOnlyResolved,
  );
  const logProbabilities = [-discordant * Math.log(2)];
  for (let successes = 1; successes <= tailMaximum; successes += 1) {
    logProbabilities.push(
      logProbabilities[successes - 1]! +
      Math.log(discordant - successes + 1) -
      Math.log(successes),
    );
  }
  const maximum = Math.max(...logProbabilities);
  const lowerTail = Math.exp(maximum) * logProbabilities.reduce(
    (sum, value) => sum + Math.exp(value - maximum),
    0,
  );
  return Math.min(1, 2 * lowerTail);
}

function createRandomGenerator(seed: number): {
  nextInt(maximumExclusive: number): number;
} {
  let state = seed >>> 0;
  function nextUint32(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }
  return {
    nextInt(maximumExclusive: number): number {
      const range = 0x1_0000_0000;
      const limit =
        Math.floor(range / maximumExclusive) * maximumExclusive;
      let value = nextUint32();
      while (value >= limit) {
        value = nextUint32();
      }
      return value % maximumExclusive;
    },
  };
}

function sortedUniqueStrings(values: string[], label: string): string[] {
  const sorted = [...values].sort(compareUtf8);
  for (const value of sorted) {
    assertIdentifier(value, label);
  }
  if (
    sorted.some((value, index) =>
      index > 0 && value === sorted[index - 1]
    )
  ) {
    throw new Error(`C6 repository statistics duplicate ${label}`);
  }
  return sorted;
}

function sortedUniqueIntegers(values: number[], label: string): number[] {
  const sorted = [...values].sort((left, right) => left - right);
  if (
    sorted.some((value, index) =>
      !Number.isSafeInteger(value) ||
      (index > 0 && value === sorted[index - 1])
    )
  ) {
    throw new Error(`C6 repository statistics invalid ${label}`);
  }
  return sorted;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: string[],
  label: string,
): void {
  const actualKeys = Object.keys(value).sort(compareUtf8);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`C6 repository statistics ${label} closure drifted`);
  }
}

function assertIdentifier(value: string, label: string): void {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    /[\u0000\r\n]/u.test(value)
  ) {
    throw new Error(`C6 repository statistics invalid ${label}`);
  }
}

function cellKey(cell: {
  episodeId: string;
  seed: number;
  stageId: string;
  stagePosition: number;
}): string {
  return JSON.stringify([
    cell.episodeId,
    cell.seed,
    cell.stageId,
    cell.stagePosition,
  ]);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isSignFlip(first: number, second: number): boolean {
  return (first > 0 && second < 0) || (first < 0 && second > 0);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}
