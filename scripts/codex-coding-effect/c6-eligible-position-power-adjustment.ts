import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";

const C5_RUN_ID = "run-c5-pilot-v16-20260721T150112Z";
const C5_PROJECTED_EVIDENCE_AGGREGATE_SHA256 =
  "dd3c40ac0b516bc43b795ac932754aaa0ddebf259d512d2158c2989dba2b67d6";
const C5_SOURCE_RUN_IDENTITY_SHA256 =
  "14aecc2ae91fe72a38f4d83b06ab493dd0790e3d8274b6cd2f1ddfa2acbaf00f";
const ALPHA = 0.05;
const CONFIDENCE_LEVEL = 0.95;
const MATERIAL_EFFECT_RATE = 0.1;
const PLANNING_DISCORDANCE_RATE = 0.5;
const TARGET_POWER = 0.8;
const Z_POWER_80 = 0.8416212335729143;
const Z_TWO_SIDED_95 = 1.959963984540054;
const C6_HEADLINE_SEEDS = 3;
const C6_HEADLINE_ELIGIBLE_POSITIONS = 2;

interface FrozenInputBinding {
  bytes: number;
  path: string;
  sha256: string;
}

export const C6_C5_V16_POWER_INPUT_BINDINGS = {
  attemptLedger: {
    bytes: 354,
    path: "run-attempts.jsonl",
    sha256:
      "6f563835048bcb376c24be48002bcf6c2ec46fe8122c4e669feb558502ae7beb",
  },
  pairs: {
    bytes: 26_602,
    path: "pairs.jsonl",
    sha256:
      "633a8af83ff25e06de644bd380359544f9f0aacc1cffa00585fb58b6dc6f17fe",
  },
  pilotPlan: {
    bytes: 74_793,
    path: "pilot-plan.json",
    sha256:
      "ef7668a289d1eadbc63f020d5dcd2d1973f39722399d8349a4fd3437fbe2e72b",
  },
  projectionManifest: {
    bytes: 118_365,
    path: "projection-manifest.json",
    sha256:
      "41656ed99fbadfabe836aafc39d82b2416ecda368fd8a13830ff5197e6176323",
  },
  report: {
    bytes: 3_378,
    path: "report.json",
    sha256:
      "5985be5969750286ef2d2af623741e12051d3830f96bd4b8e0907b849b1eab0b",
  },
  stageExecutions: {
    bytes: 48_180,
    path: "stage-executions.jsonl",
    sha256:
      "c0bb87ff4f4c8c9763012ef4793954ee48c46fc64b6428a4f1a01237ff2a1c07",
  },
} as const satisfies Record<string, FrozenInputBinding>;

const armSchema = z.enum(["goodmemory-installed", "no-memory"]);
const memoryExpectationSchema = z.enum([
  "irrelevant-control",
  "none",
  "required",
]);
const outcomeSchema = z.enum([
  "incomparable",
  "regression",
  "rescue",
  "shared-fail",
  "shared-pass",
]);
const planSchema = z.object({
  counts: z.object({
    episodes: z.number().int().positive(),
    repetitions: z.number().int().positive(),
    stageRuns: z.number().int().positive(),
  }).passthrough(),
  episodeArmRuns: z.array(z.object({
    arm: armSchema,
    clusterId: z.string().min(1),
    episodeId: z.string().min(1),
    repetition: z.number().int().positive(),
    stages: z.array(z.object({
      memoryExpectation: memoryExpectationSchema,
      position: z.number().int().positive(),
      stageId: z.string().min(1),
    }).passthrough()).min(1),
  }).passthrough()).min(1),
}).passthrough();
const pairSchema = z.object({
  clusterId: z.string().min(1),
  comparable: z.boolean(),
  episodeId: z.string().min(1),
  evaluations: z.array(z.object({
    arm: armSchema,
    resolved: z.boolean(),
  }).passthrough()).length(2),
  outcome: outcomeSchema,
  repetition: z.number().int().positive(),
  stageId: z.string().min(1),
}).passthrough();
const stageExecutionSchema = z.object({
  arm: armSchema,
  clusterId: z.string().min(1),
  episodeId: z.string().min(1),
  repetition: z.number().int().positive(),
  stageId: z.string().min(1),
  stageRunId: z.string().min(1),
}).passthrough();
const attemptSchema = z.object({
  attemptId: z.string().min(1),
  clusterId: z.string().min(1),
  disposition: z.string().min(1),
}).passthrough();
const manifestSchema = z.object({
  claimBoundary: z.literal("internal-native-longitudinal-pilot-only"),
  evidenceClass: z.literal("native-longitudinal-pilot"),
  files: z.array(z.object({
    bytes: z.number().int().nonnegative(),
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict()).min(1),
  projectedEvidenceAggregateSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  runId: z.literal(C5_RUN_ID),
  schemaVersion: z.literal(1),
  sourceEvidenceAggregateSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceRunIdentitySha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
const reportSchema = z.object({
  powerAnalysis: z.object({
    alpha: z.literal(ALPHA),
    materialEffectRate: z.literal(MATERIAL_EFFECT_RATE),
    pairedObservationsBeforeClustering: z.literal(391),
    planningDiscordanceRate: z.literal(PLANNING_DISCORDANCE_RATE),
    power: z.literal(TARGET_POWER),
  }).passthrough(),
}).passthrough();

type PilotPlan = z.infer<typeof planSchema>;
type Pair = z.infer<typeof pairSchema>;
type StageExecution = z.infer<typeof stageExecutionSchema>;
type Attempt = z.infer<typeof attemptSchema>;
type PairOutcome = z.infer<typeof outcomeSchema>;

export interface C6EligiblePositionPowerDerivation {
  correlation: {
    betweenMeanSquare: number;
    completeEpisodeCount: number;
    confidenceLevel: 0.95;
    method: "one-way-random-effects-icc-1-1-on-paired-delta";
    pointEstimate: number;
    upperBoundMethod:
      | "fail-closed-parameter-upper-bound-no-accepted-small-sample-interval"
      | "parameter-upper-bound-after-saturated-point-estimate";
    upperConfidenceBound: 1;
    withinMeanSquare: number;
  };
  counts: {
    completeComparableEpisodeCount: number;
    c6HeadlineObservationsPerEpisode: 6;
    eligibleComparablePairCount: number;
    eligibleIncomparablePairCount: number;
    eligibleScheduledPairCount: number;
    fullyIncomparableEpisodeCount: number;
    interruptedAttemptCount: number;
    pilotEligibleObservationsPerCompleteEpisode: number;
    scheduledPairCount: number;
    stageExecutionCount: number;
  };
  eligiblePairProjectionSha256: string;
  episodeSummaries: C6EligiblePositionEpisodeSummary[];
  planning: {
    alpha: 0.05;
    c6EligiblePositionsPerEpisode: 2;
    c6Seeds: 3;
    designEffect: number;
    materialEffectRate: 0.1;
    minimumEpisodeFloor: number;
    minimumEpisodeFloorReductionSupported: false;
    pairedObservationsBeforeClustering: number;
    planningDiscordanceRate: 0.5;
    power: 0.8;
  };
}

export interface C6EligiblePositionPowerAdjustmentArtifact
  extends C6EligiblePositionPowerDerivation {
  artifactKind: "c6-eligible-position-power-adjustment";
  boundary: {
    c6CandidateCapacityInput: false;
    c6OutcomeInput: false;
    independentReviewStatus: "pending";
    independentlyReviewed: false;
    minimumEpisodeFloorReductionSupported: false;
    publicClaimEligible: false;
    status: "deterministic-c5-v16-recalculation-review-pending";
  };
  inputs: {
    attemptLedger: FrozenInputBinding;
    pairs: FrozenInputBinding;
    pilotPlan: FrozenInputBinding;
    projectedEvidenceAggregateSha256: string;
    projectionManifest: FrozenInputBinding;
    report: FrozenInputBinding;
    runId: string;
    sourceRunIdentitySha256: string;
    stageExecutions: FrozenInputBinding;
  };
  schemaVersion: 2;
}

interface C6EligiblePositionEpisodeSummary {
  comparableEligiblePairCount: number;
  eligiblePairCount: number;
  episodeId: string;
  pairedDeltas: number[];
  status: "complete-comparable" | "fully-incomparable";
}

interface ParsedPowerEvidence {
  attempts: Attempt[];
  pairs: Pair[];
  pilotPlan: PilotPlan;
  stageExecutions: StageExecution[];
}

interface BuildPowerAdjustmentInput {
  attemptLedgerBytes: string;
  pairsBytes: string;
  pilotPlanBytes: string;
  projectionManifestBytes: string;
  reportBytes: string;
  stageExecutionsBytes: string;
}

export function deriveC6EligiblePositionPowerAdjustment(
  input: ParsedPowerEvidence,
): C6EligiblePositionPowerDerivation {
  const positionByPair = buildPositionMap(input.pilotPlan);
  const pairKeys = new Set<string>();
  const enrichedPairs: Array<Pair & { position: number }> = [];

  for (const pair of input.pairs) {
    const key = pairKey(pair.clusterId, pair.stageId);
    if (pairKeys.has(key)) {
      throw new Error("duplicate C5 pair identity");
    }
    pairKeys.add(key);
    const planned = positionByPair.get(key);
    if (
      planned === undefined ||
      planned.episodeId !== pair.episodeId ||
      planned.repetition !== pair.repetition
    ) {
      throw new Error("C5 pair does not match the pilot plan");
    }
    assertPairOutcome(pair);
    enrichedPairs.push({
      ...pair,
      position: planned.position,
    });
  }
  if (
    pairKeys.size !== positionByPair.size ||
    [...positionByPair.keys()].some((key) => !pairKeys.has(key))
  ) {
    throw new Error("C5 pair ledger does not cover the pilot plan");
  }

  assertStageExecutions(input.stageExecutions, enrichedPairs);

  const eligiblePairs = enrichedPairs
    .filter((pair) => pair.position >= 2)
    .sort(compareEnrichedPairs);
  const eligibleByEpisode = new Map<string, typeof eligiblePairs>();
  for (const pair of eligiblePairs) {
    const episodePairs = eligibleByEpisode.get(pair.episodeId) ?? [];
    episodePairs.push(pair);
    eligibleByEpisode.set(pair.episodeId, episodePairs);
  }
  const eligiblePairCounts = new Set(
    [...eligibleByEpisode.values()].map((pairs) => pairs.length),
  );
  if (eligiblePairCounts.size !== 1) {
    throw new Error("eligible episode cells are not balanced");
  }
  const eligiblePairsPerEpisode = [...eligiblePairCounts][0] ?? 0;
  const episodeSummaries = [...eligibleByEpisode.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([episodeId, pairs]) => {
      const comparablePairs = pairs.filter((pair) => pair.comparable);
      if (
        comparablePairs.length !== 0 &&
        comparablePairs.length !== pairs.length
      ) {
        throw new Error(
          `eligible episode is only partially comparable: ${episodeId}`,
        );
      }
      return {
        comparableEligiblePairCount: comparablePairs.length,
        eligiblePairCount: pairs.length,
        episodeId,
        pairedDeltas: comparablePairs.map(pairDelta),
        status: comparablePairs.length === 0
          ? "fully-incomparable"
          : "complete-comparable",
      } satisfies C6EligiblePositionEpisodeSummary;
    });
  const completeGroups = episodeSummaries
    .filter((summary) => summary.status === "complete-comparable")
    .map((summary) => summary.pairedDeltas);
  if (completeGroups.length < 2 || eligiblePairsPerEpisode < 2) {
    throw new Error("insufficient complete eligible episodes for correlation");
  }

  const correlation = estimateEpisodeCorrelation(completeGroups);
  const upperConfidenceBound = 1 as const;
  const pairedObservationsBeforeClustering = Math.ceil((
    Z_TWO_SIDED_95 * Math.sqrt(PLANNING_DISCORDANCE_RATE) +
    Z_POWER_80 * Math.sqrt(
      PLANNING_DISCORDANCE_RATE - MATERIAL_EFFECT_RATE ** 2,
    )
  ) ** 2 / MATERIAL_EFFECT_RATE ** 2);
  const c6HeadlineObservationsPerEpisode = 6 as const;
  const designEffect = 1 +
    (c6HeadlineObservationsPerEpisode - 1) * upperConfidenceBound;
  const minimumEpisodeFloor = Math.ceil(
    pairedObservationsBeforeClustering * designEffect /
      c6HeadlineObservationsPerEpisode,
  );

  return {
    correlation: {
      betweenMeanSquare: correlation.betweenMeanSquare,
      completeEpisodeCount: completeGroups.length,
      confidenceLevel: CONFIDENCE_LEVEL,
      method: "one-way-random-effects-icc-1-1-on-paired-delta",
      pointEstimate: correlation.pointEstimate,
      upperBoundMethod: correlation.pointEstimate === 1
        ? "parameter-upper-bound-after-saturated-point-estimate"
        : "fail-closed-parameter-upper-bound-no-accepted-small-sample-interval",
      upperConfidenceBound,
      withinMeanSquare: correlation.withinMeanSquare,
    },
    counts: {
      completeComparableEpisodeCount: completeGroups.length,
      c6HeadlineObservationsPerEpisode,
      eligibleComparablePairCount: eligiblePairs.filter((pair) =>
        pair.comparable
      ).length,
      eligibleIncomparablePairCount: eligiblePairs.filter((pair) =>
        !pair.comparable
      ).length,
      eligibleScheduledPairCount: eligiblePairs.length,
      fullyIncomparableEpisodeCount: episodeSummaries.filter((summary) =>
        summary.status === "fully-incomparable"
      ).length,
      interruptedAttemptCount: input.attempts.length,
      pilotEligibleObservationsPerCompleteEpisode: eligiblePairsPerEpisode,
      scheduledPairCount: input.pairs.length,
      stageExecutionCount: input.stageExecutions.length,
    },
    eligiblePairProjectionSha256: sha256(JSON.stringify(
      eligiblePairs.map((pair) => ({
        comparable: pair.comparable,
        episodeId: pair.episodeId,
        outcome: pair.outcome,
        position: pair.position,
        repetition: pair.repetition,
        stageId: pair.stageId,
      })),
    )),
    episodeSummaries,
    planning: {
      alpha: ALPHA,
      c6EligiblePositionsPerEpisode: C6_HEADLINE_ELIGIBLE_POSITIONS,
      c6Seeds: C6_HEADLINE_SEEDS,
      designEffect,
      materialEffectRate: MATERIAL_EFFECT_RATE,
      minimumEpisodeFloor,
      minimumEpisodeFloorReductionSupported: false,
      pairedObservationsBeforeClustering,
      planningDiscordanceRate: PLANNING_DISCORDANCE_RATE,
      power: TARGET_POWER,
    },
  };
}

export function buildC6EligiblePositionPowerAdjustment(
  input: BuildPowerAdjustmentInput,
): C6EligiblePositionPowerAdjustmentArtifact {
  assertFrozenBytes(
    "projection-manifest.json",
    input.projectionManifestBytes,
    C6_C5_V16_POWER_INPUT_BINDINGS.projectionManifest,
  );
  const manifest = manifestSchema.parse(
    JSON.parse(input.projectionManifestBytes),
  );
  assertManifest(manifest);
  assertFrozenBytes(
    "report.json",
    input.reportBytes,
    C6_C5_V16_POWER_INPUT_BINDINGS.report,
  );
  reportSchema.parse(JSON.parse(input.reportBytes));
  assertFrozenBytes(
    "pilot-plan.json",
    input.pilotPlanBytes,
    C6_C5_V16_POWER_INPUT_BINDINGS.pilotPlan,
  );
  assertFrozenBytes(
    "pairs.jsonl",
    input.pairsBytes,
    C6_C5_V16_POWER_INPUT_BINDINGS.pairs,
  );
  assertFrozenBytes(
    "stage-executions.jsonl",
    input.stageExecutionsBytes,
    C6_C5_V16_POWER_INPUT_BINDINGS.stageExecutions,
  );
  assertFrozenBytes(
    "run-attempts.jsonl",
    input.attemptLedgerBytes,
    C6_C5_V16_POWER_INPUT_BINDINGS.attemptLedger,
  );

  const derivation = deriveC6EligiblePositionPowerAdjustment({
    attempts: parseJsonLines(input.attemptLedgerBytes, attemptSchema),
    pairs: parseJsonLines(input.pairsBytes, pairSchema),
    pilotPlan: planSchema.parse(JSON.parse(input.pilotPlanBytes)),
    stageExecutions: parseJsonLines(
      input.stageExecutionsBytes,
      stageExecutionSchema,
    ),
  });
  assertFrozenDerivation(derivation);

  return {
    artifactKind: "c6-eligible-position-power-adjustment",
    boundary: {
      c6CandidateCapacityInput: false,
      c6OutcomeInput: false,
      independentReviewStatus: "pending",
      independentlyReviewed: false,
      minimumEpisodeFloorReductionSupported: false,
      publicClaimEligible: false,
      status: "deterministic-c5-v16-recalculation-review-pending",
    },
    ...derivation,
    inputs: {
      attemptLedger: C6_C5_V16_POWER_INPUT_BINDINGS.attemptLedger,
      pairs: C6_C5_V16_POWER_INPUT_BINDINGS.pairs,
      pilotPlan: C6_C5_V16_POWER_INPUT_BINDINGS.pilotPlan,
      projectedEvidenceAggregateSha256:
        C5_PROJECTED_EVIDENCE_AGGREGATE_SHA256,
      projectionManifest: C6_C5_V16_POWER_INPUT_BINDINGS.projectionManifest,
      report: C6_C5_V16_POWER_INPUT_BINDINGS.report,
      runId: C5_RUN_ID,
      sourceRunIdentitySha256: C5_SOURCE_RUN_IDENTITY_SHA256,
      stageExecutions: C6_C5_V16_POWER_INPUT_BINDINGS.stageExecutions,
    },
    schemaVersion: 2,
  };
}

export async function materializeC6EligiblePositionPowerAdjustment(input: {
  outputPath: string;
  projectionRootPath: string;
}): Promise<C6EligiblePositionPowerAdjustmentArtifact> {
  const projectionRootPath = await assertC6NoSymlinkPathComponents(
    input.projectionRootPath,
    "C6 eligible-position power projection root",
  );
  const frozenInputs = await readFrozenPowerInputs(projectionRootPath, "");
  const artifact = buildC6EligiblePositionPowerAdjustment(frozenInputs);
  const terminalInputs = await readFrozenPowerInputs(
    projectionRootPath,
    " terminal",
  );
  if (
    Object.keys(frozenInputs).some((key) =>
      frozenInputs[key as keyof BuildPowerAdjustmentInput] !==
        terminalInputs[key as keyof BuildPowerAdjustmentInput]
    )
  ) {
    throw new Error(
      "C6 eligible-position power input changed during materialization",
    );
  }

  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 eligible-position power output parent",
  );
  const handle = await open(outputPath, "wx", 0o644);
  try {
    await handle.writeFile(
      serializeC6EligiblePositionPowerAdjustment(artifact),
      "utf8",
    );
  } finally {
    await handle.close();
  }
  return artifact;
}

export function serializeC6EligiblePositionPowerAdjustment(
  artifact: C6EligiblePositionPowerAdjustmentArtifact,
): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

function buildPositionMap(plan: PilotPlan): Map<string, {
  episodeId: string;
  position: number;
  repetition: number;
}> {
  const positions = new Map<string, {
    arms: Set<string>;
    episodeId: string;
    memoryExpectation: z.infer<typeof memoryExpectationSchema>;
    position: number;
    repetition: number;
  }>();
  for (const armRun of plan.episodeArmRuns) {
    for (const stage of armRun.stages) {
      if (stage.position === 1 && stage.memoryExpectation !== "none") {
        throw new Error(
          "pilot-plan position 1 must have no memory expectation",
        );
      }
      if (stage.position >= 2 && stage.memoryExpectation === "none") {
        throw new Error(
          "pilot-plan eligible position must require or control for memory",
        );
      }
      const key = pairKey(armRun.clusterId, stage.stageId);
      const existing = positions.get(key);
      if (existing === undefined) {
        positions.set(key, {
          arms: new Set([armRun.arm]),
          episodeId: armRun.episodeId,
          memoryExpectation: stage.memoryExpectation,
          position: stage.position,
          repetition: armRun.repetition,
        });
        continue;
      }
      if (
        existing.arms.has(armRun.arm) ||
        existing.episodeId !== armRun.episodeId ||
        existing.memoryExpectation !== stage.memoryExpectation ||
        existing.position !== stage.position ||
        existing.repetition !== armRun.repetition
      ) {
        throw new Error("pilot-plan arm stage mapping is inconsistent");
      }
      existing.arms.add(armRun.arm);
    }
  }
  for (const position of positions.values()) {
    if (
      !position.arms.has("no-memory") ||
      !position.arms.has("goodmemory-installed") ||
      position.arms.size !== 2
    ) {
      throw new Error("pilot-plan pair does not contain both arms");
    }
  }
  return new Map([...positions.entries()].map(([key, value]) => [
    key,
    {
      episodeId: value.episodeId,
      position: value.position,
      repetition: value.repetition,
    },
  ]));
}

function assertPairOutcome(pair: Pair): void {
  const evaluations = new Map(
    pair.evaluations.map((evaluation) => [evaluation.arm, evaluation.resolved]),
  );
  if (
    evaluations.size !== 2 ||
    !evaluations.has("no-memory") ||
    !evaluations.has("goodmemory-installed")
  ) {
    throw new Error("C5 pair must contain both arm evaluations");
  }
  if (!pair.comparable) {
    if (pair.outcome !== "incomparable") {
      throw new Error("incomparable C5 pair has a scored outcome");
    }
    return;
  }
  const noMemory = evaluations.get("no-memory")!;
  const goodMemory = evaluations.get("goodmemory-installed")!;
  const expected: PairOutcome = noMemory
    ? goodMemory
      ? "shared-pass"
      : "regression"
    : goodMemory
    ? "rescue"
    : "shared-fail";
  if (pair.outcome !== expected) {
    throw new Error("C5 pair outcome does not match arm evaluations");
  }
}

function assertStageExecutions(
  stageExecutions: readonly StageExecution[],
  pairs: readonly Pair[],
): void {
  const pairByKey = new Map(pairs.map((pair) => [
    pairKey(pair.clusterId, pair.stageId),
    pair,
  ]));
  const executionKeys = new Set<string>();
  const stageRunIds = new Set<string>();
  for (const execution of stageExecutions) {
    const pair = pairByKey.get(pairKey(execution.clusterId, execution.stageId));
    if (
      pair === undefined ||
      pair.episodeId !== execution.episodeId ||
      pair.repetition !== execution.repetition
    ) {
      throw new Error("stage execution does not match the C5 pair ledger");
    }
    const key = `${pairKey(execution.clusterId, execution.stageId)}\0${execution.arm}`;
    if (executionKeys.has(key) || stageRunIds.has(execution.stageRunId)) {
      throw new Error("duplicate C5 stage execution");
    }
    executionKeys.add(key);
    stageRunIds.add(execution.stageRunId);
  }
  if (
    pairs.some((pair) =>
      !executionKeys.has(
        `${pairKey(pair.clusterId, pair.stageId)}\0no-memory`,
      ) ||
      !executionKeys.has(
        `${pairKey(pair.clusterId, pair.stageId)}\0goodmemory-installed`,
      )
    ) ||
    executionKeys.size !== pairs.length * 2
  ) {
    throw new Error("C5 pair ledger is not backed by two stage executions");
  }
}

function estimateEpisodeCorrelation(groups: readonly number[][]): {
  betweenMeanSquare: number;
  pointEstimate: number;
  withinMeanSquare: number;
} {
  const observationsPerEpisode = groups[0]!.length;
  if (groups.some((group) => group.length !== observationsPerEpisode)) {
    throw new Error("complete eligible episode groups are not balanced");
  }
  const values = groups.flat();
  const overallMean = mean(values);
  const betweenMeanSquare = observationsPerEpisode * groups.reduce(
    (sum, group) => sum + (mean(group) - overallMean) ** 2,
    0,
  ) / (groups.length - 1);
  const withinMeanSquare = groups.reduce((sum, group) => {
    const groupMean = mean(group);
    return sum + group.reduce(
      (inner, value) => inner + (value - groupMean) ** 2,
      0,
    );
  }, 0) / (groups.length * (observationsPerEpisode - 1));
  const denominator = betweenMeanSquare +
    (observationsPerEpisode - 1) * withinMeanSquare;
  const pointEstimate = denominator === 0
    ? 0
    : Math.max(
      0,
      Math.min(
        1,
        (betweenMeanSquare - withinMeanSquare) / denominator,
      ),
    );
  return {
    betweenMeanSquare,
    pointEstimate,
    withinMeanSquare,
  };
}

function assertManifest(manifest: z.infer<typeof manifestSchema>): void {
  if (
    manifest.projectedEvidenceAggregateSha256 !==
      C5_PROJECTED_EVIDENCE_AGGREGATE_SHA256 ||
    manifest.sourceEvidenceAggregateSha256 !==
      C5_PROJECTED_EVIDENCE_AGGREGATE_SHA256 ||
    manifest.sourceRunIdentitySha256 !== C5_SOURCE_RUN_IDENTITY_SHA256
  ) {
    throw new Error("C5 v16 projection manifest identity mismatch");
  }
  const entries = new Map(manifest.files.map((file) => [file.path, file]));
  for (
    const binding of [
      C6_C5_V16_POWER_INPUT_BINDINGS.attemptLedger,
      C6_C5_V16_POWER_INPUT_BINDINGS.pairs,
      C6_C5_V16_POWER_INPUT_BINDINGS.pilotPlan,
      C6_C5_V16_POWER_INPUT_BINDINGS.report,
      C6_C5_V16_POWER_INPUT_BINDINGS.stageExecutions,
    ]
  ) {
    const entry = entries.get(binding.path);
    if (
      entry === undefined ||
      entry.bytes !== binding.bytes ||
      entry.sha256 !== binding.sha256 ||
      entry.sourceSha256 !== binding.sha256
    ) {
      throw new Error(`C5 v16 manifest binding mismatch: ${binding.path}`);
    }
  }
}

function assertFrozenDerivation(
  derivation: C6EligiblePositionPowerDerivation,
): void {
  const counts = derivation.counts;
  if (
    counts.scheduledPairCount !== 36 ||
    counts.eligibleScheduledPairCount !== 24 ||
    counts.eligibleComparablePairCount !== 20 ||
    counts.eligibleIncomparablePairCount !== 4 ||
    counts.completeComparableEpisodeCount !== 5 ||
    counts.fullyIncomparableEpisodeCount !== 1 ||
    counts.pilotEligibleObservationsPerCompleteEpisode !== 4 ||
    counts.stageExecutionCount !== 72 ||
    counts.interruptedAttemptCount !== 1
  ) {
    throw new Error("C5 v16 eligible-position frozen counts changed");
  }
  if (
    derivation.correlation.pointEstimate !== 1 ||
    derivation.correlation.upperConfidenceBound !== 1 ||
    derivation.correlation.withinMeanSquare !== 0 ||
    derivation.planning.pairedObservationsBeforeClustering !== 391 ||
    derivation.planning.designEffect !== 6 ||
    derivation.planning.minimumEpisodeFloor !== 391
  ) {
    throw new Error("C5 v16 eligible-position frozen power result changed");
  }
}

function assertFrozenBytes(
  label: string,
  bytes: string,
  binding: FrozenInputBinding,
): void {
  if (sha256(bytes) !== binding.sha256) {
    throw new Error(`C5 v16 ${label} SHA-256 mismatch`);
  }
  if (Buffer.byteLength(bytes) !== binding.bytes) {
    throw new Error(`C5 v16 ${label} byte length mismatch`);
  }
}

async function readFrozenPowerInputs(
  root: string,
  phase: "" | " terminal",
): Promise<BuildPowerAdjustmentInput> {
  const bindings = C6_C5_V16_POWER_INPUT_BINDINGS;
  const [
    attemptLedgerBytes,
    pairsBytes,
    pilotPlanBytes,
    projectionManifestBytes,
    reportBytes,
    stageExecutionsBytes,
  ] = await Promise.all([
    readC6StableRegularFile(
      join(root, bindings.attemptLedger.path),
      `eligible-position power${phase} attempt ledger`,
    ),
    readC6StableRegularFile(
      join(root, bindings.pairs.path),
      `eligible-position power${phase} pairs`,
    ),
    readC6StableRegularFile(
      join(root, bindings.pilotPlan.path),
      `eligible-position power${phase} pilot plan`,
    ),
    readC6StableRegularFile(
      join(root, bindings.projectionManifest.path),
      `eligible-position power${phase} projection manifest`,
    ),
    readC6StableRegularFile(
      join(root, bindings.report.path),
      `eligible-position power${phase} report`,
    ),
    readC6StableRegularFile(
      join(root, bindings.stageExecutions.path),
      `eligible-position power${phase} stage executions`,
    ),
  ]);
  return {
    attemptLedgerBytes: attemptLedgerBytes.toString("utf8"),
    pairsBytes: pairsBytes.toString("utf8"),
    pilotPlanBytes: pilotPlanBytes.toString("utf8"),
    projectionManifestBytes: projectionManifestBytes.toString("utf8"),
    reportBytes: reportBytes.toString("utf8"),
    stageExecutionsBytes: stageExecutionsBytes.toString("utf8"),
  };
}

function parseJsonLines<T>(
  bytes: string,
  schema: z.ZodType<T>,
): T[] {
  if (!bytes.endsWith("\n")) {
    throw new Error("C5 v16 JSONL input must end with LF");
  }
  return bytes.trimEnd().split("\n").map((line) =>
    schema.parse(JSON.parse(line))
  );
}

function pairDelta(pair: Pair): number {
  if (pair.outcome === "rescue") return 1;
  if (pair.outcome === "regression") return -1;
  return 0;
}

function compareEnrichedPairs(
  first: Pair & { position: number },
  second: Pair & { position: number },
): number {
  return first.episodeId.localeCompare(second.episodeId) ||
    first.repetition - second.repetition ||
    first.position - second.position ||
    first.stageId.localeCompare(second.stageId);
}

function pairKey(clusterId: string, stageId: string): string {
  return `${clusterId}\0${stageId}`;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sha256(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
