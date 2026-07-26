import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";
import {
  deriveC6LiveMultiLangNeighborCensusPlan,
  loadC6LiveMultiLangNeighborCensusSource,
  serializeC6LiveMultiLangNeighborCensusPlan,
} from "./c6-live-multilang-neighbor-census-plan";
import type {
  C6LiveMultiLangCanonicalObservation,
  C6LiveMultiLangNeighborCensusDerivationInputs,
  C6LiveMultiLangNeighborCensusSourceInput,
  C6LiveMultiLangNeighborCensusTarget,
} from "./c6-live-multilang-neighbor-census-plan";

const ARTIFACT_KIND =
  "c6-live-multilang-neighbor-census-plan";
const PRIOR_SCHEMA_VERSION = 1;
const SCHEMA_VERSION = 2;
const REPOSITORIES_PER_SPLIT = 8;
const CENSUS_CAP = 16;
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
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

type SourceSplit =
  C6LiveMultiLangNeighborCensusTarget["sourceSplit"];

interface Reference {
  bytes: number;
  path: string;
  sha256: string;
}

export interface C6LiveMultiLangNeighborCensusContinuationTarget
  extends Omit<
    C6LiveMultiLangNeighborCensusTarget,
    "withinSplitRank"
  > {
  withinSplitRank: number;
}

export interface C6LiveMultiLangNeighborCensusContinuationPlan {
  artifactKind: typeof ARTIFACT_KIND;
  boundary: {
    acceptedEpisodeCount: 0;
    actorQualifiedEpisodeCount: 0;
    candidateManifestFrozen: false;
    censusCaptured: false;
    codexCallCount: 0;
    codexRunReady: false;
    machineQualifiedEpisodeCount: 0;
    semanticallyQualifiedEpisodeCount: 0;
    status:
      "repository-neighbor-census-continuation-plan-only";
  };
  counts: {
    canonicalRedirectCollapseCount: number;
    canonicalRepositoryCount: number;
    continuationEligibleRepositoryCount: number;
    cumulativeCensusCandidateCeiling: number;
    cumulativeSelectedRepositoryCount: number;
    currentFrameRepositoryCount: number;
    eligibleRepositoryCount: number;
    excludedCurrentFrameRepositoryCount: number;
    excludedPriorTrancheRepositoryCount: number;
    priorSelectedRepositoryCount: number;
    selectedRepositoryCount: number;
    sourceAnchorCount: number;
    sourceRequestedRepositoryCount: number;
    trancheCensusCandidateCeiling: number;
  };
  independenceBoundary: {
    actorFrameRepositoryProjectionSha256: string;
    canonicalRepositoryProjectionSha256: string;
    combinedExclusionProjectionSha256: string;
    continuationEligibleRepositoryProjectionSha256: string;
    eligibleRepositoryProjectionSha256: string;
    existingAnchorProjectionSha256: string;
    goldInput: false;
    machineDecisionInput: false;
    outcomeInput: false;
    patchInput: false;
    priorNeighborPlanSha256: string;
    priorSelectedRepositoryProjectionSha256: string;
    selectedRepositoryProjectionSha256: string;
    semanticDecisionInput: false;
    testInput: false;
  };
  inputs: C6LiveMultiLangNeighborCensusDerivationInputs & {
    priorNeighborPlan: Reference & {
      artifactKind: typeof ARTIFACT_KIND;
      schemaVersion: 1;
      selectedRepositoryProjectionSha256: string;
    };
  };
  rule: {
    canonicalIdentity:
      "lowercase-resolved-repository-plus-pull-number";
    currentFrameRepositoryExclusion:
      "exclude-all-current-actor-qualified-frame-repositories";
    existingAnchorExclusion:
      "exclude-all-canonical-source-anchors-before-neighbor-qualification";
    forbiddenSelectionInputs: readonly [
      "patch",
      "test",
      "gold",
      "outcome",
      "semanticDecision",
      "machineDecision",
    ];
    perRepositoryCensusCap: 16;
    priorTrancheBinding:
      "rederive-ranks-1-through-8-byte-for-byte-before-continuation";
    priorTrancheRepositoryExclusion:
      "exclude-all-prior-tranche-selected-repositories";
    repositorySplitAssignment: "earliest-source-captureOrder";
    selectionOrder:
      "withinSplitRank-ascending-then-frozen-sourceSplit-order";
    sourceSplitOrder: typeof SOURCE_SPLITS;
    withinSplitSelection:
      "eligible-canonical-repository-ranks-9-through-16-by-seed-captureOrder";
  };
  schemaVersion: 2;
  splitCounts: Record<
    SourceSplit,
    {
      actorFrameEligible: number;
      continuationEligible: number;
      priorSelected: 8;
      selected: 8;
    }
  >;
  targets: C6LiveMultiLangNeighborCensusContinuationTarget[];
}

export function deriveC6LiveMultiLangNeighborCensusContinuationPlan(
  input: {
    currentFrameRepositories: ReadonlySet<string>;
    expectedPriorPlanSha256: string;
    expectedPriorSelectedRepositoryProjectionSha256: string;
    inputs: C6LiveMultiLangNeighborCensusDerivationInputs;
    observations: readonly C6LiveMultiLangCanonicalObservation[];
    priorPlanBytes: Uint8Array;
    priorPlanPath: string;
  },
): C6LiveMultiLangNeighborCensusContinuationPlan {
  const expectedPriorPlanSha256 = sha256Schema.parse(
    input.expectedPriorPlanSha256,
  );
  const expectedPriorSelectedRepositoryProjectionSha256 =
    sha256Schema.parse(
      input.expectedPriorSelectedRepositoryProjectionSha256,
    );
  const priorPlanBytes = Buffer.from(input.priorPlanBytes);
  if (sha256(priorPlanBytes) !== expectedPriorPlanSha256) {
    throw new Error(
      "C6 neighbor census continuation prior-plan hash mismatch",
    );
  }

  const priorPlan = deriveC6LiveMultiLangNeighborCensusPlan({
    currentFrameRepositories: input.currentFrameRepositories,
    inputs: input.inputs,
    observations: input.observations,
  });
  const rederivedPriorPlanBytes = Buffer.from(
    serializeC6LiveMultiLangNeighborCensusPlan(priorPlan),
  );
  if (!priorPlanBytes.equals(rederivedPriorPlanBytes)) {
    throw new Error(
      "C6 neighbor census continuation prior plan does not match rederived ranks 1 through 8",
    );
  }
  if (
    priorPlan.independenceBoundary
      .selectedRepositoryProjectionSha256 !==
        expectedPriorSelectedRepositoryProjectionSha256
  ) {
    throw new Error(
      "C6 neighbor census continuation prior selected-repository projection mismatch",
    );
  }

  const priorRepositories = new Set(
    priorPlan.targets.map((target) => target.canonicalRepository),
  );
  const combinedExclusions = new Set([
    ...input.currentFrameRepositories,
    ...priorRepositories,
  ]);
  if (
    combinedExclusions.size !==
      input.currentFrameRepositories.size + priorRepositories.size
  ) {
    throw new Error(
      "C6 neighbor census continuation prior/current-frame overlap",
    );
  }
  const continuationSelection =
    deriveC6LiveMultiLangNeighborCensusPlan({
      currentFrameRepositories: combinedExclusions,
      inputs: input.inputs,
      observations: input.observations,
    });
  const targets = continuationSelection.targets.map((target) => ({
    ...target,
    withinSplitRank:
      target.withinSplitRank + REPOSITORIES_PER_SPLIT,
  }));
  if (
    targets.some((target) =>
      input.currentFrameRepositories.has(
        target.canonicalRepository,
      ) ||
      priorRepositories.has(target.canonicalRepository)
    )
  ) {
    throw new Error(
      "C6 neighbor census continuation repository exclusion mismatch",
    );
  }

  const splitCounts = Object.fromEntries(
    SOURCE_SPLITS.map((sourceSplit) => [
      sourceSplit,
      {
        actorFrameEligible:
          priorPlan.splitCounts[sourceSplit].eligible,
        continuationEligible:
          continuationSelection.splitCounts[sourceSplit].eligible,
        priorSelected: REPOSITORIES_PER_SPLIT,
        selected: REPOSITORIES_PER_SPLIT,
      },
    ]),
  ) as C6LiveMultiLangNeighborCensusContinuationPlan["splitCounts"];
  const selectedRepositoryProjectionSha256 = sha256(
    JSON.stringify(targets.map(selectedRepositoryProjection)),
  );
  const cumulativeSelectedRepositoryCount =
    priorPlan.targets.length + targets.length;

  return {
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      actorQualifiedEpisodeCount: 0,
      candidateManifestFrozen: false,
      censusCaptured: false,
      codexCallCount: 0,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status:
        "repository-neighbor-census-continuation-plan-only",
    },
    counts: {
      canonicalRedirectCollapseCount:
        priorPlan.counts.canonicalRedirectCollapseCount,
      canonicalRepositoryCount:
        priorPlan.counts.canonicalRepositoryCount,
      continuationEligibleRepositoryCount:
        continuationSelection.counts.eligibleRepositoryCount,
      cumulativeCensusCandidateCeiling:
        cumulativeSelectedRepositoryCount * CENSUS_CAP,
      cumulativeSelectedRepositoryCount,
      currentFrameRepositoryCount:
        priorPlan.counts.currentFrameRepositoryCount,
      eligibleRepositoryCount:
        priorPlan.counts.eligibleRepositoryCount,
      excludedCurrentFrameRepositoryCount:
        priorPlan.counts.excludedCurrentFrameRepositoryCount,
      excludedPriorTrancheRepositoryCount:
        priorRepositories.size,
      priorSelectedRepositoryCount: priorPlan.targets.length,
      selectedRepositoryCount: targets.length,
      sourceAnchorCount: priorPlan.counts.sourceAnchorCount,
      sourceRequestedRepositoryCount:
        priorPlan.counts.sourceRequestedRepositoryCount,
      trancheCensusCandidateCeiling: targets.length * CENSUS_CAP,
    },
    independenceBoundary: {
      actorFrameRepositoryProjectionSha256:
        priorPlan.independenceBoundary
          .actorFrameRepositoryProjectionSha256,
      canonicalRepositoryProjectionSha256:
        priorPlan.independenceBoundary
          .canonicalRepositoryProjectionSha256,
      combinedExclusionProjectionSha256: sha256(
        JSON.stringify([...combinedExclusions].sort()),
      ),
      continuationEligibleRepositoryProjectionSha256:
        continuationSelection.independenceBoundary
          .eligibleRepositoryProjectionSha256,
      eligibleRepositoryProjectionSha256:
        priorPlan.independenceBoundary
          .eligibleRepositoryProjectionSha256,
      existingAnchorProjectionSha256:
        priorPlan.independenceBoundary
          .existingAnchorProjectionSha256,
      goldInput: false,
      machineDecisionInput: false,
      outcomeInput: false,
      patchInput: false,
      priorNeighborPlanSha256: expectedPriorPlanSha256,
      priorSelectedRepositoryProjectionSha256:
        expectedPriorSelectedRepositoryProjectionSha256,
      selectedRepositoryProjectionSha256,
      semanticDecisionInput: false,
      testInput: false,
    },
    inputs: {
      ...input.inputs,
      priorNeighborPlan: {
        artifactKind: ARTIFACT_KIND,
        bytes: priorPlanBytes.byteLength,
        path: basename(input.priorPlanPath),
        schemaVersion: PRIOR_SCHEMA_VERSION,
        selectedRepositoryProjectionSha256:
          expectedPriorSelectedRepositoryProjectionSha256,
        sha256: expectedPriorPlanSha256,
      },
    },
    rule: {
      canonicalIdentity:
        "lowercase-resolved-repository-plus-pull-number",
      currentFrameRepositoryExclusion:
        "exclude-all-current-actor-qualified-frame-repositories",
      existingAnchorExclusion:
        "exclude-all-canonical-source-anchors-before-neighbor-qualification",
      forbiddenSelectionInputs: [
        "patch",
        "test",
        "gold",
        "outcome",
        "semanticDecision",
        "machineDecision",
      ],
      perRepositoryCensusCap: CENSUS_CAP,
      priorTrancheBinding:
        "rederive-ranks-1-through-8-byte-for-byte-before-continuation",
      priorTrancheRepositoryExclusion:
        "exclude-all-prior-tranche-selected-repositories",
      repositorySplitAssignment: "earliest-source-captureOrder",
      selectionOrder:
        "withinSplitRank-ascending-then-frozen-sourceSplit-order",
      sourceSplitOrder: SOURCE_SPLITS,
      withinSplitSelection:
        "eligible-canonical-repository-ranks-9-through-16-by-seed-captureOrder",
    },
    schemaVersion: SCHEMA_VERSION,
    splitCounts,
    targets,
  };
}

export interface C6LiveMultiLangNeighborCensusContinuationBuildInput
  extends C6LiveMultiLangNeighborCensusSourceInput {
  expectedPriorPlanSha256: string;
  expectedPriorSelectedRepositoryProjectionSha256: string;
  priorPlanPath: string;
  testHooks?: {
    beforeTerminalVerification?: () => Promise<void> | void;
  };
}

export async function buildC6LiveMultiLangNeighborCensusContinuationPlan(
  input: C6LiveMultiLangNeighborCensusContinuationBuildInput,
): Promise<{
  outputSha256: string;
  plan: C6LiveMultiLangNeighborCensusContinuationPlan;
}> {
  const priorPlanPath = await assertC6NoSymlinkPathComponents(
    input.priorPlanPath,
    "C6 neighbor census continuation prior plan",
  );
  const [source, priorPlanBytes] = await Promise.all([
    loadC6LiveMultiLangNeighborCensusSource(input),
    readC6StableRegularFile(
      priorPlanPath,
      "neighbor census continuation prior plan",
    ),
  ]);
  const plan =
    deriveC6LiveMultiLangNeighborCensusContinuationPlan({
      currentFrameRepositories: source.currentFrameRepositories,
      expectedPriorPlanSha256: input.expectedPriorPlanSha256,
      expectedPriorSelectedRepositoryProjectionSha256:
        input.expectedPriorSelectedRepositoryProjectionSha256,
      inputs: source.inputs,
      observations: source.observations,
      priorPlanBytes,
      priorPlanPath,
    });

  await input.testHooks?.beforeTerminalVerification?.();
  const [, terminalPriorPlanBytes] = await Promise.all([
    source.verifyTerminalClosure(),
    readC6StableRegularFile(
      priorPlanPath,
      "neighbor census continuation terminal prior plan",
    ),
  ]);
  if (!terminalPriorPlanBytes.equals(priorPlanBytes)) {
    throw new Error(
      "C6 neighbor census continuation prior plan changed during projection",
    );
  }
  const serialized =
    serializeC6LiveMultiLangNeighborCensusContinuationPlan(plan);
  return {
    outputSha256: sha256(serialized),
    plan,
  };
}

export async function materializeC6LiveMultiLangNeighborCensusContinuationPlan(
  input: C6LiveMultiLangNeighborCensusContinuationBuildInput & {
    outputPath: string;
  },
): Promise<{
  outputSha256: string;
  plan: C6LiveMultiLangNeighborCensusContinuationPlan;
}> {
  const result =
    await buildC6LiveMultiLangNeighborCensusContinuationPlan(input);
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 neighbor census continuation output parent",
  );
  const handle = await open(outputPath, "wx", 0o644);
  try {
    await handle.writeFile(
      serializeC6LiveMultiLangNeighborCensusContinuationPlan(
        result.plan,
      ),
      "utf8",
    );
  } finally {
    await handle.close();
  }
  return result;
}

export function serializeC6LiveMultiLangNeighborCensusContinuationPlan(
  plan: C6LiveMultiLangNeighborCensusContinuationPlan,
): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

function selectedRepositoryProjection(
  target: C6LiveMultiLangNeighborCensusContinuationTarget,
): unknown {
  return {
    pilotRank: target.pilotRank,
    sourceSplit: target.sourceSplit,
    withinSplitRank: target.withinSplitRank,
    canonicalRepository: target.canonicalRepository,
    seedCaptureOrder: target.seedCaptureOrder,
    seedAnchorId: target.seedAnchorId,
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
