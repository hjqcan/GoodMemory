import { createHash } from "node:crypto";

import { c5PlanBaselineArm } from "./c5-pilot-plan";
import type {
  C5BaselineArm,
  C5PilotArm,
  C5PilotPlan,
} from "./c5-pilot-plan";
import type {
  C5LongitudinalPairResult,
  C5LongitudinalPilotResult,
  C5PairOutcome,
} from "./c5-longitudinal";

const ALPHA = 0.05;
const TARGET_POWER = 0.8;
const Z_TWO_SIDED_95 = 1.959963984540054;
const Z_POWER_80 = 0.8416212335729143;
const FULL_SET_SEEDS = 3;
const STAGES_PER_EPISODE = 3;
const ARMS = 2;
const MINIMUM_EPISODES = 30;
const MINIMUM_REPOSITORIES = 6;

export interface C5PilotReport {
  acceptance: {
    everyAttemptAccountedFor: true;
    failureTaxonomyProduced: true;
    noSilentFallback: true;
    powerAnalysisProduced: true;
    status: "accepted";
  };
  attempts: {
    accountedCount: number;
    codexCompletedCount: number;
    infrastructureFailureCount: number;
    memoryChannelFailureCount: number;
    scheduledCount: number;
  };
  claimBoundary: "internal-native-longitudinal-pilot-only";
  comparatorInjection: {
    contentInjectionCount: number;
    hookCanaryFailureCount: number;
    injectedTokensTotal: number;
    zeroInjectionCount: number;
  } | null;
  effect: {
    baselineArm: C5BaselineArm;
    baselineResolveRate: number | null;
    comparablePairs: number;
    goodMemoryResolveRate: number | null;
    netRescueRate: number | null;
    netRescueRateInterval95: {
      bootstrapSamples: number;
      confidenceLevel: number;
      lower: number;
      method: "paired-episode-cluster-percentile-bootstrap";
      resamplingUnit: "episode";
      upper: number;
    } | null;
    noMemoryResolveRate: number | null;
    observedDiscordanceRate: number | null;
    regressions: number;
    rescues: number;
  };
  evidenceClass: "native-longitudinal-pilot";
  failureTaxonomy: Array<{ count: number; reason: string }>;
  fullSetBudget: {
    arms: 2;
    codexCalls: number;
    episodes: number;
    repositories: number;
    scoredStages: number;
    seeds: 3;
  };
  generatedAt: string;
  memoryBehavior: {
    injectionObservedCount: number;
    installedAttemptCount: number;
    irrelevantInjectionCount: number;
    missingObservationCount: number;
    observedAttemptCount: number;
    requiredRecallObservedCount: number;
    writebackCommittedCount: number;
  };
  pairs: {
    comparableCount: number;
    incomparableCount: number;
    outcomes: Record<C5PairOutcome, number>;
    scheduledCount: number;
  };
  phase: "C5";
  planSha256: string;
  powerAnalysis: {
    alpha: 0.05;
    designEffect: number;
    materialEffectRate: number;
    method: "paired-proportion-normal-approximation-with-episode-design-effect";
    observedWithinEpisodeCorrelation: number;
    pairedObservationsBeforeClustering: number;
    planningDiscordanceRate: 0.5;
    power: 0.8;
    requiredEpisodes: number;
    seeds: 3;
    stagesPerEpisode: 3;
  };
  publicClaimEligible: false;
  publicCodingEffectProof: false;
  readmeRowAllowed: false;
  resourceUsage: {
    attemptsWithUsage: number;
    cachedInputTokens: number;
    estimatedCostUsd: null;
    inputTokens: number;
    missingUsageCount: number;
    outputTokens: number;
    pricingBoundary: "token-usage-only-model-price-not-frozen";
    totalCodexDurationMs: number;
  };
  runId: string;
  schemaVersion: 1;
}

export function buildC5PilotReport(input: {
  generatedAt: string;
  plan: C5PilotPlan;
  planSha256: string;
  result: C5LongitudinalPilotResult;
  runId: string;
}): C5PilotReport {
  if (!/^[a-f0-9]{64}$/u.test(input.planSha256)) {
    throw new Error("C5 report plan hash must be a SHA-256 digest");
  }
  assertCompleteAttempts(input.plan, input.result);
  assertCompletePairs(input.plan, input.result.pairs);
  assertNoSilentFallback(input.result);

  const outcomes = countOutcomes(input.result.pairs);
  const comparablePairs = input.result.pairs.filter((pair) => pair.comparable);
  const baselineArm = c5PlanBaselineArm(input.plan);
  const noMemoryResolved = countResolved(comparablePairs, baselineArm);
  const goodMemoryResolved = countResolved(
    comparablePairs,
    "goodmemory-installed",
  );
  const observedWithinEpisodeCorrelation = estimateEpisodeCorrelation(
    comparablePairs,
  );
  const powerAnalysis = buildPowerAnalysis({
    materialEffectRate:
      input.plan.analysis.materialEffectPercentagePoints / 100,
    observedWithinEpisodeCorrelation,
  });
  const requiredEpisodes = powerAnalysis.requiredEpisodes;
  const netRescueRateInterval95 = buildNetRescueBootstrapInterval({
    pairs: input.result.pairs,
    plan: input.plan,
    planSha256: input.planSha256,
  });

  return {
    acceptance: {
      everyAttemptAccountedFor: true,
      failureTaxonomyProduced: true,
      noSilentFallback: true,
      powerAnalysisProduced: true,
      status: "accepted",
    },
    attempts: {
      accountedCount: input.result.stageExecutions.length,
      codexCompletedCount: input.result.stageExecutions.filter((execution) =>
        execution.codexStatus === "completed"
      ).length,
      infrastructureFailureCount: input.result.stageExecutions.filter(
        (execution) => execution.infrastructureFailureStage !== null,
      ).length,
      memoryChannelFailureCount: input.result.stageExecutions.filter(
        (execution) => execution.memoryChannelStatus === "failed",
      ).length,
      scheduledCount: input.plan.counts.stageRuns,
    },
    claimBoundary: "internal-native-longitudinal-pilot-only",
    comparatorInjection: buildComparatorInjection(input.result, baselineArm),
    effect: {
      baselineArm,
      baselineResolveRate: rate(noMemoryResolved, comparablePairs.length),
      comparablePairs: comparablePairs.length,
      goodMemoryResolveRate: rate(goodMemoryResolved, comparablePairs.length),
      netRescueRate: rate(
        outcomes.rescue - outcomes.regression,
        comparablePairs.length,
      ),
      netRescueRateInterval95,
      noMemoryResolveRate: rate(noMemoryResolved, comparablePairs.length),
      observedDiscordanceRate: rate(
        outcomes.rescue + outcomes.regression,
        comparablePairs.length,
      ),
      regressions: outcomes.regression,
      rescues: outcomes.rescue,
    },
    evidenceClass: "native-longitudinal-pilot",
    failureTaxonomy: buildFailureTaxonomy(input.result),
    fullSetBudget: {
      arms: ARMS,
      codexCalls:
        requiredEpisodes * STAGES_PER_EPISODE * ARMS * FULL_SET_SEEDS,
      episodes: requiredEpisodes,
      repositories: MINIMUM_REPOSITORIES,
      scoredStages: requiredEpisodes * STAGES_PER_EPISODE,
      seeds: FULL_SET_SEEDS,
    },
    generatedAt: input.generatedAt,
    memoryBehavior: buildMemoryBehavior(input.result),
    pairs: {
      comparableCount: comparablePairs.length,
      incomparableCount: outcomes.incomparable,
      outcomes,
      scheduledCount: input.plan.clusters.length * STAGES_PER_EPISODE,
    },
    phase: "C5",
    planSha256: input.planSha256,
    powerAnalysis,
    publicClaimEligible: false,
    publicCodingEffectProof: false,
    readmeRowAllowed: false,
    resourceUsage: buildResourceUsage(input.result),
    runId: input.runId,
    schemaVersion: 1,
  };
}

export function serializeC5PilotReport(report: C5PilotReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function assertCompleteAttempts(
  plan: C5PilotPlan,
  result: C5LongitudinalPilotResult,
): void {
  const expected = plan.episodeArmRuns
    .flatMap((run) => run.stages.map((stage) => stage.id))
    .sort();
  const actual = result.stageExecutions
    .map((execution) => execution.stageRunId)
    .sort();
  if (
    new Set(actual).size !== actual.length ||
    JSON.stringify(actual) !== JSON.stringify(expected)
  ) {
    throw new Error("C5 report does not account for every scheduled stage run");
  }
}

function assertCompletePairs(
  plan: C5PilotPlan,
  pairs: readonly C5LongitudinalPairResult[],
): void {
  const expected = plan.clusters.flatMap((cluster) =>
    plan.episodeArmRuns.find((run) => run.clusterId === cluster.id)!.stages
      .map((stage) => `${cluster.id}/${stage.stageId}`)
  ).sort();
  const actual = pairs.map((pair) =>
    `${pair.clusterId}/${pair.stageId}`
  ).sort();
  if (
    new Set(actual).size !== actual.length ||
    JSON.stringify(actual) !== JSON.stringify(expected)
  ) {
    throw new Error("C5 report does not account for every scheduled pair");
  }
}

function assertNoSilentFallback(result: C5LongitudinalPilotResult): void {
  for (const execution of result.stageExecutions) {
    if (
      execution.arm !== "goodmemory-installed" ||
      execution.memoryChannelStatus !== "failed"
    ) {
      continue;
    }
    const pair = result.pairs.find((candidate) =>
      candidate.clusterId === execution.clusterId &&
      candidate.stageId === execution.stageId
    );
    if (
      pair?.memoryExpectation === "required" &&
      (pair.comparable ||
        !pair.incomparabilityReasons.includes(
          "goodmemory-required-memory-channel-failed",
        ))
    ) {
      throw new Error("C5 required memory failure was silently scored");
    }
  }
}

function countOutcomes(
  pairs: readonly C5LongitudinalPairResult[],
): Record<C5PairOutcome, number> {
  const counts: Record<C5PairOutcome, number> = {
    incomparable: 0,
    regression: 0,
    rescue: 0,
    "shared-fail": 0,
    "shared-pass": 0,
  };
  for (const pair of pairs) {
    counts[pair.outcome] += 1;
  }
  return counts;
}

function countResolved(
  pairs: readonly C5LongitudinalPairResult[],
  arm: C5PilotArm,
): number {
  return pairs.filter((pair) =>
    pair.evaluations.find((evaluation) => evaluation.arm === arm)?.resolved
  ).length;
}

function buildFailureTaxonomy(
  result: C5LongitudinalPilotResult,
): Array<{ count: number; reason: string }> {
  const reasons: string[] = [];
  for (const execution of result.stageExecutions) {
    if (execution.infrastructureFailureStage !== null) {
      reasons.push(`infrastructure:${execution.infrastructureFailureStage}`);
    }
    if (execution.memoryChannelStatus === "failed") {
      reasons.push("goodmemory-memory-channel-failed");
    }
  }
  for (const pair of result.pairs) {
    reasons.push(...pair.incomparabilityReasons);
    for (const evaluation of pair.evaluations) {
      reasons.push(...evaluation.taskFailureReasons.map((reason) =>
        `task:${evaluation.arm}:${reason}`
      ));
    }
  }
  const counts = new Map<string, number>();
  for (const reason of reasons) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([reason, count]) => ({ count, reason }));
}

function buildResourceUsage(
  result: C5LongitudinalPilotResult,
): C5PilotReport["resourceUsage"] {
  const usage = result.stageExecutions.flatMap((execution) =>
    execution.codexUsage === null ? [] : [execution.codexUsage]
  );
  return {
    attemptsWithUsage: usage.length,
    cachedInputTokens: usage.reduce(
      (sum, item) => sum + item.cachedInputTokens,
      0,
    ),
    estimatedCostUsd: null,
    inputTokens: usage.reduce((sum, item) => sum + item.inputTokens, 0),
    missingUsageCount: result.stageExecutions.length - usage.length,
    outputTokens: usage.reduce((sum, item) => sum + item.outputTokens, 0),
    pricingBoundary: "token-usage-only-model-price-not-frozen",
    totalCodexDurationMs: result.stageExecutions.reduce(
      (sum, execution) => sum + execution.codexDurationMs,
      0,
    ),
  };
}

function buildComparatorInjection(
  result: C5LongitudinalPilotResult,
  baselineArm: C5BaselineArm,
): C5PilotReport["comparatorInjection"] {
  if (baselineArm !== "flat-summary") return null;
  const receipts = result.stageExecutions
    .filter((execution) => execution.arm === "flat-summary")
    .map((execution) => execution.comparatorInjection ?? null);
  return {
    contentInjectionCount: receipts.filter((receipt) =>
      receipt?.mode === "content-injection"
    ).length,
    hookCanaryFailureCount: receipts.filter((receipt) =>
      receipt === null || !receipt.hookEvaluationPassed
    ).length,
    injectedTokensTotal: receipts.reduce(
      (total, receipt) => total + (receipt?.injectedTokenCount ?? 0),
      0,
    ),
    zeroInjectionCount: receipts.filter((receipt) =>
      receipt?.mode === "no-history-zero-injection"
    ).length,
  };
}

function buildMemoryBehavior(
  result: C5LongitudinalPilotResult,
): C5PilotReport["memoryBehavior"] {
  const installed = result.stageExecutions.filter((execution) =>
    execution.arm === "goodmemory-installed"
  );
  const observed = installed.filter((execution) =>
    execution.memoryObservation !== null
  );
  return {
    injectionObservedCount: observed.filter((execution) =>
      execution.memoryObservation!.injectedRecordCount > 0
    ).length,
    installedAttemptCount: installed.length,
    irrelevantInjectionCount: observed.filter((execution) =>
      execution.memoryObservation!.irrelevantInjection
    ).length,
    missingObservationCount: installed.length - observed.length,
    observedAttemptCount: observed.length,
    requiredRecallObservedCount: observed.filter((execution) => {
      const pair = result.pairs.find((candidate) =>
        candidate.clusterId === execution.clusterId &&
        candidate.stageId === execution.stageId
      );
      return pair?.memoryExpectation === "required" &&
        execution.memoryObservation!.recalledPriorMemoryCount > 0;
    }).length,
    writebackCommittedCount: observed.filter((execution) =>
      execution.memoryObservation!.writebackCommitted
    ).length,
  };
}

function buildNetRescueBootstrapInterval(input: {
  pairs: readonly C5LongitudinalPairResult[];
  plan: C5PilotPlan;
  planSha256: string;
}): C5PilotReport["effect"]["netRescueRateInterval95"] {
  const episodeIds = [...new Set(input.plan.clusters.map((cluster) =>
    cluster.episodeId
  ))].sort();
  const pairsByEpisode = new Map(episodeIds.map((episodeId) => [
    episodeId,
    input.pairs.filter((pair) => pair.episodeId === episodeId),
  ]));
  if (!input.pairs.some((pair) => pair.comparable)) return null;
  const random = seededRandom(`${input.planSha256}:c5-bootstrap`);
  const samples: number[] = [];
  while (samples.length < input.plan.analysis.bootstrapSamples) {
    const sampledPairs: C5LongitudinalPairResult[] = [];
    for (let draw = 0; draw < episodeIds.length; draw += 1) {
      const episodeId = episodeIds[Math.floor(random() * episodeIds.length)]!;
      sampledPairs.push(...pairsByEpisode.get(episodeId)!);
    }
    const comparable = sampledPairs.filter((pair) => pair.comparable);
    if (comparable.length === 0) continue;
    const rescues = comparable.filter((pair) => pair.outcome === "rescue").length;
    const regressions = comparable.filter((pair) =>
      pair.outcome === "regression"
    ).length;
    samples.push((rescues - regressions) / comparable.length);
  }
  if (samples.length === 0) return null;
  samples.sort((first, second) => first - second);
  const tail = (1 - input.plan.analysis.confidenceLevel) / 2;
  return {
    bootstrapSamples: samples.length,
    confidenceLevel: input.plan.analysis.confidenceLevel,
    lower: percentile(samples, tail),
    method: "paired-episode-cluster-percentile-bootstrap",
    resamplingUnit: input.plan.analysis.primaryResamplingUnit,
    upper: percentile(samples, 1 - tail),
  };
}

function percentile(sorted: readonly number[], probability: number): number {
  const index = Math.floor((sorted.length - 1) * probability);
  return sorted[index]!;
}

function seededRandom(seed: string): () => number {
  let state = Number.parseInt(
    createHash("sha256").update(seed).digest("hex").slice(0, 8),
    16,
  ) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function buildPowerAnalysis(input: {
  materialEffectRate: number;
  observedWithinEpisodeCorrelation: number;
}): C5PilotReport["powerAnalysis"] {
  const planningDiscordanceRate = 0.5;
  const deltaSquared = input.materialEffectRate ** 2;
  const pairedObservationsBeforeClustering = Math.ceil((
    Z_TWO_SIDED_95 * Math.sqrt(planningDiscordanceRate) +
    Z_POWER_80 * Math.sqrt(planningDiscordanceRate - deltaSquared)
  ) ** 2 / deltaSquared);
  const observationsPerEpisode = STAGES_PER_EPISODE * FULL_SET_SEEDS;
  const designEffect = 1 +
    (observationsPerEpisode - 1) * input.observedWithinEpisodeCorrelation;
  const requiredEpisodes = Math.max(
    MINIMUM_EPISODES,
    Math.ceil(
      pairedObservationsBeforeClustering * designEffect /
        observationsPerEpisode,
    ),
  );
  return {
    alpha: ALPHA,
    designEffect,
    materialEffectRate: input.materialEffectRate,
    method:
      "paired-proportion-normal-approximation-with-episode-design-effect",
    observedWithinEpisodeCorrelation:
      input.observedWithinEpisodeCorrelation,
    pairedObservationsBeforeClustering,
    planningDiscordanceRate,
    power: TARGET_POWER,
    requiredEpisodes,
    seeds: FULL_SET_SEEDS,
    stagesPerEpisode: STAGES_PER_EPISODE,
  };
}

function estimateEpisodeCorrelation(
  pairs: readonly C5LongitudinalPairResult[],
): number {
  const byEpisode = new Map<string, number[]>();
  for (const pair of pairs) {
    const value = pair.outcome === "rescue"
      ? 1
      : pair.outcome === "regression"
      ? -1
      : 0;
    const values = byEpisode.get(pair.episodeId) ?? [];
    values.push(value);
    byEpisode.set(pair.episodeId, values);
  }
  const groups = [...byEpisode.values()];
  const observationsPerEpisode = groups[0]?.length ?? 0;
  if (
    groups.length < 2 ||
    observationsPerEpisode < 2 ||
    groups.some((group) => group.length !== observationsPerEpisode)
  ) {
    return 1;
  }
  const values = groups.flat();
  const overallMean = mean(values);
  const betweenMeanSquare = observationsPerEpisode * groups.reduce(
    (sum, group) => sum + (mean(group) - overallMean) ** 2,
    0,
  ) / (groups.length - 1);
  const withinMeanSquare = groups.reduce(
    (sum, group) => {
      const groupMean = mean(group);
      return sum + group.reduce(
        (inner, value) => inner + (value - groupMean) ** 2,
        0,
      );
    },
    0,
  ) / (groups.length * (observationsPerEpisode - 1));
  const denominator = betweenMeanSquare +
    (observationsPerEpisode - 1) * withinMeanSquare;
  if (denominator === 0) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(1, (betweenMeanSquare - withinMeanSquare) / denominator),
  );
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}
