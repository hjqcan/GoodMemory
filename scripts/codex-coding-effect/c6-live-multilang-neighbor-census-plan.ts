import { createHash } from "node:crypto";
import { open, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  buildC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
} from "./c6-asset-lock";
import type { C6AssetLock } from "./c6-asset-lock";
import {
  C6_GITHUB_GRAPHQL_DISCOVERY_QUERY,
} from "./c6-github-graphql-discovery";

const ARTIFACT_KIND =
  "c6-live-multilang-neighbor-census-plan";
const DATASET_ID = "SWE-bench-Live/MultiLang";
const SOURCE_REVISION =
  "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b";
const SOURCE_ANCHOR_COUNT = 743;
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
const CAPTURE_FILES = [
  "capture.json",
  "request.json",
  "response-headers.json",
  "response.json",
] as const;
const FORBIDDEN_SELECTION_INPUTS = [
  "patch",
  "test",
  "gold",
  "outcome",
  "semanticDecision",
  "machineDecision",
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const repositorySchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const sourceSplitSchema = z.enum(SOURCE_SPLITS);
const referenceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const targetSchema = z.object({
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
  owner: z.string().min(1),
  pullNumber: z.number().int().positive(),
  repo: z.string().min(1),
  requestedAnchorId: z.string().min(1),
  sourceSplit: sourceSplitSchema,
}).passthrough();
const capturePlanSchema = z.object({
  artifactKind: z.literal(
    "c6-swe-bench-live-multilang-capture-plan",
  ),
  counts: z.object({
    repositoryCount: z.number().int().positive(),
    sourceRowCount: z.literal(SOURCE_ANCHOR_COUNT),
    targetCount: z.literal(SOURCE_ANCHOR_COUNT),
  }).strict(),
  independenceBoundary: z.object({
    targetProjectionSha256: sha256Schema,
  }).passthrough(),
  schemaVersion: z.literal(1),
  sourcePool: z.object({
    datasetId: z.literal(DATASET_ID),
    revision: z.literal(SOURCE_REVISION),
  }).passthrough(),
  targets: z.array(targetSchema).length(SOURCE_ANCHOR_COUNT),
}).passthrough();
const actorFrameSchema = z.object({
  artifactKind: z.literal(
    "c6-reviewer-actor-qualified-screening-frame",
  ),
  candidates: z.array(z.object({
    canonicalRepository: repositorySchema,
  }).passthrough()).min(1),
  counts: z.object({
    combinedStructuralCandidateCount: z.number().int().positive(),
    repositoryCount: z.number().int().positive(),
  }).passthrough(),
  independenceBoundary: z.object({
    candidateProjectionSha256: sha256Schema,
  }).passthrough(),
  schemaVersion: z.literal(1),
}).passthrough();
const captureManifestSchema = z.object({
  request: z.object({
    body: referenceSchema,
    variables: z.object({
      name: z.string().min(1),
      number: z.number().int().positive(),
      owner: z.string().min(1),
    }).strict(),
  }).passthrough(),
  response: z.object({
    body: referenceSchema,
    headers: referenceSchema,
    httpStatus: z.literal(200),
  }).passthrough(),
  target: z.object({
    pullNumber: z.number().int().positive(),
    repository: repositorySchema,
    repositoryRedirect: z.object({
      requestedRepository: repositorySchema,
      resolvedRepository: repositorySchema,
      status: z.literal("explicit-graphql-resolution-observed"),
    }).strict().optional(),
    url: z.url(),
  }).strict(),
}).passthrough();
const requestSchema = z.object({
  query: z.literal(C6_GITHUB_GRAPHQL_DISCOVERY_QUERY),
  variables: z.object({
    name: z.string().min(1),
    number: z.number().int().positive(),
    owner: z.string().min(1),
  }).strict(),
}).strict();
const responseSchema = z.object({
  data: z.object({
    repository: z.object({
      nameWithOwner: repositorySchema,
      pullRequest: z.object({
        baseRepository: z.object({
          nameWithOwner: repositorySchema,
        }).passthrough(),
        number: z.number().int().positive(),
        url: z.url(),
      }).passthrough(),
    }).passthrough(),
  }).passthrough(),
  errors: z.array(z.unknown()).optional(),
}).passthrough();
const observationSchema = z.object({
  canonicalAnchorId: z.string().min(1),
  canonicalRepository: repositorySchema,
  captureOrder: z.number().int().positive(),
  pullNumber: z.number().int().positive(),
  requestedAnchorId: z.string().min(1),
  requestedRepository: repositorySchema,
  sourceSplit: sourceSplitSchema,
}).passthrough();
const derivationInputSchema = z.object({
  actorFrame: referenceSchema,
  actorFrameCandidateProjectionSha256: sha256Schema,
  capturePlan: referenceSchema,
  capturePlanTargetProjectionSha256: sha256Schema,
  graphqlRootSha256: sha256Schema,
}).strict();

type SourceSplit = z.infer<typeof sourceSplitSchema>;

export type C6LiveMultiLangNeighborCensusDerivationInputs =
  z.input<typeof derivationInputSchema>;

export interface C6LiveMultiLangCanonicalObservation {
  canonicalAnchorId: string;
  canonicalRepository: string;
  captureOrder: number;
  pullNumber: number;
  requestedAnchorId: string;
  requestedRepository: string;
  sourceSplit: SourceSplit;
}

export interface C6LiveMultiLangNeighborCensusTarget {
  canonicalRepository: string;
  censusCap: 16;
  owner: string;
  pilotRank: number;
  repo: string;
  seedAnchorId: string;
  seedCaptureOrder: number;
  sourceSplit: SourceSplit;
  withinSplitRank: number;
}

export interface C6LiveMultiLangNeighborCensusPlan {
  artifactKind: typeof ARTIFACT_KIND;
  boundary: {
    acceptedEpisodeCount: 0;
    candidateManifestFrozen: false;
    censusCaptured: false;
    codexRunReady: false;
    machineQualifiedEpisodeCount: 0;
    semanticallyQualifiedEpisodeCount: 0;
    status: "repository-neighbor-census-plan-only";
  };
  counts: {
    canonicalRedirectCollapseCount: number;
    canonicalRepositoryCount: number;
    censusCandidateCeiling: number;
    currentFrameRepositoryCount: number;
    eligibleRepositoryCount: number;
    excludedCurrentFrameRepositoryCount: number;
    selectedRepositoryCount: number;
    sourceAnchorCount: number;
    sourceRequestedRepositoryCount: number;
  };
  independenceBoundary: {
    actorFrameRepositoryProjectionSha256: string;
    canonicalRepositoryProjectionSha256: string;
    eligibleRepositoryProjectionSha256: string;
    existingAnchorProjectionSha256: string;
    goldInput: false;
    machineDecisionInput: false;
    outcomeInput: false;
    patchInput: false;
    selectedRepositoryProjectionSha256: string;
    semanticDecisionInput: false;
    testInput: false;
  };
  inputs: {
    actorFrame: z.infer<typeof referenceSchema>;
    actorFrameCandidateProjectionSha256: string;
    capturePlan: z.infer<typeof referenceSchema>;
    capturePlanTargetProjectionSha256: string;
    graphqlRootSha256: string;
  };
  rule: {
    canonicalIdentity:
      "lowercase-resolved-repository-plus-pull-number";
    currentFrameRepositoryExclusion:
      "exclude-all-current-actor-qualified-frame-repositories";
    existingAnchorExclusion:
      "exclude-all-canonical-source-anchors-before-neighbor-qualification";
    forbiddenSelectionInputs: typeof FORBIDDEN_SELECTION_INPUTS;
    perRepositoryCensusCap: 16;
    repositorySplitAssignment: "earliest-source-captureOrder";
    selectionOrder:
      "withinSplitRank-ascending-then-frozen-sourceSplit-order";
    sourceSplitOrder: typeof SOURCE_SPLITS;
    withinSplitSelection:
      "first-8-eligible-canonical-repositories-by-seed-captureOrder";
  };
  schemaVersion: 1;
  splitCounts: Record<
    SourceSplit,
    {
      eligible: number;
      selected: 8;
    }
  >;
  targets: C6LiveMultiLangNeighborCensusTarget[];
}

export function deriveC6LiveMultiLangNeighborCensusPlan(input: {
  currentFrameRepositories: ReadonlySet<string>;
  inputs: C6LiveMultiLangNeighborCensusDerivationInputs;
  observations: readonly C6LiveMultiLangCanonicalObservation[];
}): C6LiveMultiLangNeighborCensusPlan {
  const inputs = derivationInputSchema.parse(input.inputs);
  const observations = input.observations.map((value) => {
    assertNoForbiddenSelectionInputs(value, "observation");
    const parsed = observationSchema.parse(value);
    const canonicalRepository = normalizeRepository(
      parsed.canonicalRepository,
    );
    const requestedRepository = normalizeRepository(
      parsed.requestedRepository,
    );
    if (
      normalizeAnchor(parsed.canonicalAnchorId) !==
        `${canonicalRepository}#${parsed.pullNumber}` ||
      normalizeAnchor(parsed.requestedAnchorId) !==
        `${requestedRepository}#${parsed.pullNumber}`
    ) {
      throw new Error(
        `C6 neighbor census observation identity mismatch ${
          parsed.captureOrder
        }`,
      );
    }
    return {
      canonicalAnchorId:
        `${canonicalRepository}#${parsed.pullNumber}`,
      canonicalRepository,
      captureOrder: parsed.captureOrder,
      pullNumber: parsed.pullNumber,
      requestedAnchorId:
        `${requestedRepository}#${parsed.pullNumber}`,
      requestedRepository,
      sourceSplit: parsed.sourceSplit,
    };
  }).sort((left, right) => left.captureOrder - right.captureOrder);
  assertObservationClosure(observations);

  const currentFrameRepositories = new Set(
    [...input.currentFrameRepositories].map(normalizeRepository),
  );
  if (
    currentFrameRepositories.size !==
      input.currentFrameRepositories.size
  ) {
    throw new Error(
      "C6 neighbor census duplicate current-frame repository",
    );
  }

  const resolutionByRequestedRepository =
    new Map<string, string>();
  for (const observation of observations) {
    const prior = resolutionByRequestedRepository.get(
      observation.requestedRepository,
    );
    if (
      prior !== undefined &&
      prior !== observation.canonicalRepository
    ) {
      throw new Error(
        `C6 neighbor census redirect ambiguity ${
          observation.requestedRepository
        }`,
      );
    }
    resolutionByRequestedRepository.set(
      observation.requestedRepository,
      observation.canonicalRepository,
    );
  }

  const earliestByCanonicalRepository = new Map<
    string,
    C6LiveMultiLangCanonicalObservation
  >();
  for (const observation of observations) {
    if (
      !earliestByCanonicalRepository.has(
        observation.canonicalRepository,
      )
    ) {
      earliestByCanonicalRepository.set(
        observation.canonicalRepository,
        observation,
      );
    }
  }
  const canonicalRepositories = [
    ...earliestByCanonicalRepository.values(),
  ];
  const eligibleRepositories = canonicalRepositories.filter(
    (observation) =>
      !currentFrameRepositories.has(
        observation.canonicalRepository,
      ),
  );
  const bySplit = new Map<SourceSplit, typeof eligibleRepositories>();
  for (const split of SOURCE_SPLITS) {
    const splitRepositories = eligibleRepositories.filter(
      (observation) => observation.sourceSplit === split,
    );
    if (splitRepositories.length < REPOSITORIES_PER_SPLIT) {
      throw new Error(
        `C6 neighbor census split ${split} requires at least 8 eligible repositories`,
      );
    }
    bySplit.set(split, splitRepositories);
  }

  const targets: C6LiveMultiLangNeighborCensusTarget[] = [];
  for (
    let withinSplitRank = 1;
    withinSplitRank <= REPOSITORIES_PER_SPLIT;
    withinSplitRank += 1
  ) {
    for (const sourceSplit of SOURCE_SPLITS) {
      const seed = bySplit.get(sourceSplit)![withinSplitRank - 1]!;
      const [owner, repo] = seed.canonicalRepository.split("/");
      targets.push({
        canonicalRepository: seed.canonicalRepository,
        censusCap: CENSUS_CAP,
        owner: owner!,
        pilotRank: targets.length + 1,
        repo: repo!,
        seedAnchorId: seed.canonicalAnchorId,
        seedCaptureOrder: seed.captureOrder,
        sourceSplit,
        withinSplitRank,
      });
    }
  }
  if (
    new Set(targets.map((target) => target.canonicalRepository)).size !==
      targets.length ||
    targets.some((target) =>
      currentFrameRepositories.has(target.canonicalRepository)
    )
  ) {
    throw new Error(
      "C6 neighbor census selected repository exclusion mismatch",
    );
  }

  const splitCounts = Object.fromEntries(
    SOURCE_SPLITS.map((split) => [
      split,
      {
        eligible: bySplit.get(split)!.length,
        selected: REPOSITORIES_PER_SPLIT,
      },
    ]),
  ) as C6LiveMultiLangNeighborCensusPlan["splitCounts"];
  const excludedCurrentFrameRepositoryCount =
    canonicalRepositories.filter((observation) =>
      currentFrameRepositories.has(
        observation.canonicalRepository,
      )
    ).length;

  return {
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      censusCaptured: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status: "repository-neighbor-census-plan-only",
    },
    counts: {
      canonicalRedirectCollapseCount:
        resolutionByRequestedRepository.size -
        canonicalRepositories.length,
      canonicalRepositoryCount: canonicalRepositories.length,
      censusCandidateCeiling: targets.length * CENSUS_CAP,
      currentFrameRepositoryCount: currentFrameRepositories.size,
      eligibleRepositoryCount: eligibleRepositories.length,
      excludedCurrentFrameRepositoryCount,
      selectedRepositoryCount: targets.length,
      sourceAnchorCount: observations.length,
      sourceRequestedRepositoryCount:
        resolutionByRequestedRepository.size,
    },
    independenceBoundary: {
      actorFrameRepositoryProjectionSha256: sha256(JSON.stringify(
        [...currentFrameRepositories].sort(),
      )),
      canonicalRepositoryProjectionSha256: sha256(JSON.stringify(
        canonicalRepositories.map(repositoryProjection),
      )),
      eligibleRepositoryProjectionSha256: sha256(JSON.stringify(
        eligibleRepositories.map(repositoryProjection),
      )),
      existingAnchorProjectionSha256: sha256(JSON.stringify(
        observations.map((observation) => ({
          canonicalAnchorId: observation.canonicalAnchorId,
          captureOrder: observation.captureOrder,
        })),
      )),
      goldInput: false,
      machineDecisionInput: false,
      outcomeInput: false,
      patchInput: false,
      selectedRepositoryProjectionSha256: sha256(JSON.stringify(
        targets.map(selectedRepositoryProjection),
      )),
      semanticDecisionInput: false,
      testInput: false,
    },
    inputs,
    rule: {
      canonicalIdentity:
        "lowercase-resolved-repository-plus-pull-number",
      currentFrameRepositoryExclusion:
        "exclude-all-current-actor-qualified-frame-repositories",
      existingAnchorExclusion:
        "exclude-all-canonical-source-anchors-before-neighbor-qualification",
      forbiddenSelectionInputs: FORBIDDEN_SELECTION_INPUTS,
      perRepositoryCensusCap: CENSUS_CAP,
      repositorySplitAssignment: "earliest-source-captureOrder",
      selectionOrder:
        "withinSplitRank-ascending-then-frozen-sourceSplit-order",
      sourceSplitOrder: SOURCE_SPLITS,
      withinSplitSelection:
        "first-8-eligible-canonical-repositories-by-seed-captureOrder",
    },
    schemaVersion: 1,
    splitCounts,
    targets,
  };
}

export function serializeC6LiveMultiLangNeighborCensusPlan(
  plan: C6LiveMultiLangNeighborCensusPlan,
): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export interface C6LiveMultiLangNeighborCensusSourceInput {
  actorFramePath: string;
  capturePlanPath: string;
  expectedActorFrameSha256: string;
  expectedCapturePlanSha256: string;
  expectedGraphqlRootSha256: string;
  graphqlRoot: string;
}

export interface C6LiveMultiLangNeighborCensusSourceSnapshot {
  currentFrameRepositories: ReadonlySet<string>;
  inputs: C6LiveMultiLangNeighborCensusDerivationInputs;
  observations: readonly C6LiveMultiLangCanonicalObservation[];
  verifyTerminalClosure: () => Promise<void>;
}

export async function loadC6LiveMultiLangNeighborCensusSource(
  input: C6LiveMultiLangNeighborCensusSourceInput,
): Promise<C6LiveMultiLangNeighborCensusSourceSnapshot> {
  const expectedActorFrameSha256 = sha256Schema.parse(
    input.expectedActorFrameSha256,
  );
  const expectedCapturePlanSha256 = sha256Schema.parse(
    input.expectedCapturePlanSha256,
  );
  const expectedGraphqlRootSha256 = sha256Schema.parse(
    input.expectedGraphqlRootSha256,
  );
  const [actorFramePath, capturePlanPath, graphqlRoot] =
    await Promise.all([
      assertC6NoSymlinkPathComponents(
        input.actorFramePath,
        "C6 neighbor census actor frame",
      ),
      assertC6NoSymlinkPathComponents(
        input.capturePlanPath,
        "C6 neighbor census capture plan",
      ),
      assertC6NoSymlinkPathComponents(
        input.graphqlRoot,
        "C6 neighbor census GraphQL root",
      ),
    ]);
  const [actorFrameBytes, capturePlanBytes, graphqlLock] =
    await Promise.all([
      readC6StableRegularFile(
        actorFramePath,
        "neighbor census actor frame",
      ),
      readC6StableRegularFile(
        capturePlanPath,
        "neighbor census capture plan",
      ),
      buildC6AssetLock(graphqlRoot),
    ]);
  if (sha256(capturePlanBytes) !== expectedCapturePlanSha256) {
    throw new Error("C6 neighbor census capture-plan hash mismatch");
  }
  if (sha256(actorFrameBytes) !== expectedActorFrameSha256) {
    throw new Error("C6 neighbor census actor-frame hash mismatch");
  }
  if (graphqlLock.assetRootSha256 !== expectedGraphqlRootSha256) {
    throw new Error("C6 neighbor census GraphQL-root hash mismatch");
  }

  const rawCapturePlan = parseJson(
    capturePlanBytes,
    "capture plan",
  );
  assertNoForbiddenSelectionInputs(rawCapturePlan, "capture plan");
  const capturePlan = capturePlanSchema.parse(rawCapturePlan);
  if (
    capturePlan.targets.length !== capturePlan.counts.targetCount ||
    sha256(JSON.stringify(
      (rawCapturePlan as { targets: unknown }).targets,
    )) !== capturePlan.independenceBoundary.targetProjectionSha256
  ) {
    throw new Error(
      "C6 neighbor census capture-plan projection mismatch",
    );
  }
  await assertC6LiveMultiLangNeighborCensusExactCaptureTree(
    graphqlRoot,
    capturePlan.targets,
  );
  const rawActorFrame = parseJson(actorFrameBytes, "actor frame");
  assertNoForbiddenSelectionInputs(rawActorFrame, "actor frame");
  const actorFrame = actorFrameSchema.parse(rawActorFrame);
  const currentFrameRepositories = new Set(
    actorFrame.candidates.map((candidate) =>
      normalizeRepository(candidate.canonicalRepository)
    ),
  );
  if (
    actorFrame.candidates.length !==
      actorFrame.counts.combinedStructuralCandidateCount ||
    currentFrameRepositories.size !== actorFrame.counts.repositoryCount ||
    sha256(JSON.stringify(
      (rawActorFrame as { candidates: unknown }).candidates,
    )) !== actorFrame.independenceBoundary.candidateProjectionSha256
  ) {
    throw new Error(
      "C6 neighbor census actor-frame projection mismatch",
    );
  }

  assertCaptureRootStructure(graphqlLock, capturePlan.targets);
  const files = new Map(
    graphqlLock.files.map((file) => [file.path, file]),
  );
  const observations: C6LiveMultiLangCanonicalObservation[] = [];
  for (const target of capturePlan.targets) {
    observations.push(await readCanonicalObservation({
      files,
      graphqlRoot,
      target,
    }));
  }
  return {
    currentFrameRepositories,
    inputs: {
      actorFrame: reference(actorFrameBytes, actorFramePath),
      actorFrameCandidateProjectionSha256:
        actorFrame.independenceBoundary.candidateProjectionSha256,
      capturePlan: reference(capturePlanBytes, capturePlanPath),
      capturePlanTargetProjectionSha256:
        capturePlan.independenceBoundary.targetProjectionSha256,
      graphqlRootSha256: graphqlLock.assetRootSha256,
    },
    observations,
    verifyTerminalClosure: async () => {
      const [
        terminalActorFrameBytes,
        terminalCapturePlanBytes,
        terminalGraphqlLock,
      ] = await Promise.all([
        readC6StableRegularFile(
          actorFramePath,
          "neighbor census terminal actor frame",
        ),
        readC6StableRegularFile(
          capturePlanPath,
          "neighbor census terminal capture plan",
        ),
        buildC6AssetLock(graphqlRoot),
      ]);
      if (
        !terminalActorFrameBytes.equals(actorFrameBytes) ||
        !terminalCapturePlanBytes.equals(capturePlanBytes) ||
        serializeC6AssetLock(terminalGraphqlLock) !==
          serializeC6AssetLock(graphqlLock)
      ) {
        throw new Error(
          "C6 neighbor census input closure changed during projection",
        );
      }
      await assertC6LiveMultiLangNeighborCensusExactCaptureTree(
        graphqlRoot,
        capturePlan.targets,
      );
    },
  };
}

export async function assertC6LiveMultiLangNeighborCensusExactCaptureTree(
  root: string,
  targets: readonly { captureDirectory: string }[],
): Promise<void> {
  const expectedDirectories = new Set(
    targets.map((target) => target.captureDirectory),
  );
  if (expectedDirectories.size !== targets.length) {
    throw new Error(
      "C6 neighbor census capture-directory collision",
    );
  }
  for (const entry of await readdir(root, {
    withFileTypes: true,
  })) {
    if (!expectedDirectories.has(entry.name)) {
      throw new Error(
        `C6 neighbor census unexpected GraphQL root entry ${entry.name}`,
      );
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(
        `C6 neighbor census invalid capture directory ${entry.name}`,
      );
    }
    expectedDirectories.delete(entry.name);
  }
  if (expectedDirectories.size > 0) {
    throw new Error(
      `C6 neighbor census missing capture directory ${
        [...expectedDirectories].sort()[0]
      }`,
    );
  }
  for (const target of targets) {
    const expectedFiles = new Set<string>(CAPTURE_FILES);
    const directory = join(root, target.captureDirectory);
    for (const entry of await readdir(directory, {
      withFileTypes: true,
    })) {
      if (
        !expectedFiles.delete(entry.name) ||
        !entry.isFile() ||
        entry.isSymbolicLink()
      ) {
        throw new Error(
          `C6 neighbor census unexpected capture entry ${
            target.captureDirectory
          }/${entry.name}`,
        );
      }
    }
    if (expectedFiles.size > 0) {
      throw new Error(
        `C6 neighbor census missing capture entry ${
          target.captureDirectory
        }/${[...expectedFiles].sort()[0]}`,
      );
    }
  }
}

export async function buildC6LiveMultiLangNeighborCensusPlan(
  input: C6LiveMultiLangNeighborCensusSourceInput & {
    testHooks?: {
      beforeTerminalVerification?: () => Promise<void> | void;
    };
  },
): Promise<{
  outputSha256: string;
  plan: C6LiveMultiLangNeighborCensusPlan;
}> {
  const source =
    await loadC6LiveMultiLangNeighborCensusSource(input);
  const plan = deriveC6LiveMultiLangNeighborCensusPlan({
    currentFrameRepositories: source.currentFrameRepositories,
    inputs: source.inputs,
    observations: source.observations,
  });

  await input.testHooks?.beforeTerminalVerification?.();
  await source.verifyTerminalClosure();
  const serialized =
    serializeC6LiveMultiLangNeighborCensusPlan(plan);
  return {
    outputSha256: sha256(serialized),
    plan,
  };
}

export async function materializeC6LiveMultiLangNeighborCensusPlan(
  input: Parameters<
    typeof buildC6LiveMultiLangNeighborCensusPlan
  >[0] & {
    outputPath: string;
  },
): Promise<{
  outputSha256: string;
  plan: C6LiveMultiLangNeighborCensusPlan;
}> {
  const result = await buildC6LiveMultiLangNeighborCensusPlan(input);
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 neighbor census output parent",
  );
  const handle = await open(outputPath, "wx", 0o644);
  try {
    await handle.writeFile(
      serializeC6LiveMultiLangNeighborCensusPlan(result.plan),
      "utf8",
    );
  } finally {
    await handle.close();
  }
  return result;
}

function assertObservationClosure(
  observations: readonly C6LiveMultiLangCanonicalObservation[],
): void {
  const requestedAnchors = new Set<string>();
  const canonicalAnchors = new Set<string>();
  for (const [index, observation] of observations.entries()) {
    if (observation.captureOrder !== index + 1) {
      throw new Error(
        "C6 neighbor census capture order must be contiguous",
      );
    }
    if (
      requestedAnchors.has(observation.requestedAnchorId) ||
      canonicalAnchors.has(observation.canonicalAnchorId)
    ) {
      throw new Error(
        "C6 neighbor census source anchor collision",
      );
    }
    requestedAnchors.add(observation.requestedAnchorId);
    canonicalAnchors.add(observation.canonicalAnchorId);
  }
}

function assertCaptureRootStructure(
  lock: C6AssetLock,
  targets: readonly z.infer<typeof targetSchema>[],
): void {
  const directories = new Set(
    targets.map((target) => target.captureDirectory),
  );
  if (directories.size !== targets.length) {
    throw new Error(
      "C6 neighbor census capture-directory collision",
    );
  }
  const expected = new Set(
    targets.flatMap((target) =>
      CAPTURE_FILES.map(
        (file) => `${target.captureDirectory}/${file}`,
      )
    ),
  );
  for (const file of lock.files) {
    const [directory, name, extra] = file.path.split("/");
    if (
      extra !== undefined ||
      directory === undefined ||
      name === undefined ||
      !directories.has(directory) ||
      !CAPTURE_FILES.includes(name as typeof CAPTURE_FILES[number])
    ) {
      throw new Error(
        `C6 neighbor census unexpected capture file ${file.path}`,
      );
    }
    expected.delete(file.path);
  }
  if (expected.size > 0) {
    throw new Error(
      `C6 neighbor census missing capture file ${
        [...expected].sort()[0]
      }`,
    );
  }
}

async function readCanonicalObservation(input: {
  files: ReadonlyMap<string, C6AssetLock["files"][number]>;
  graphqlRoot: string;
  target: z.infer<typeof targetSchema>;
}): Promise<C6LiveMultiLangCanonicalObservation> {
  const prefix = `${input.target.captureDirectory}/`;
  const captureBytes = await readBoundFile(
    input.graphqlRoot,
    `${prefix}capture.json`,
    input.files,
  );
  const rawCapture = parseJson(captureBytes, "capture manifest");
  assertNoForbiddenSelectionInputs(
    rawCapture,
    "capture manifest",
  );
  const capture = captureManifestSchema.parse(rawCapture);
  if (
    captureBytes.toString("utf8") !==
      `${JSON.stringify(rawCapture, null, 2)}\n`
  ) {
    throw new Error(
      `C6 neighbor census noncanonical capture ${
        input.target.requestedAnchorId
      }`,
    );
  }
  const requestBytes = await readReferencedFile({
    expectedPath: "request.json",
    files: input.files,
    graphqlRoot: input.graphqlRoot,
    prefix,
    reference: capture.request.body,
  });
  await readReferencedFile({
    expectedPath: "response-headers.json",
    files: input.files,
    graphqlRoot: input.graphqlRoot,
    prefix,
    reference: capture.response.headers,
  });
  const responseBytes = await readReferencedFile({
    expectedPath: "response.json",
    files: input.files,
    graphqlRoot: input.graphqlRoot,
    prefix,
    reference: capture.response.body,
  });

  const rawRequest = parseJson(requestBytes, "GraphQL request");
  assertNoForbiddenSelectionInputs(rawRequest, "GraphQL request");
  const request = requestSchema.parse(rawRequest);
  if (
    requestBytes.toString("utf8") !== JSON.stringify(rawRequest) ||
    request.variables.owner !== input.target.owner ||
    request.variables.name !== input.target.repo ||
    request.variables.number !== input.target.pullNumber ||
    JSON.stringify(request.variables) !==
      JSON.stringify(capture.request.variables)
  ) {
    throw new Error(
      `C6 neighbor census request mismatch ${
        input.target.requestedAnchorId
      }`,
    );
  }
  const rawResponse = parseJson(responseBytes, "GraphQL response");
  assertNoForbiddenSelectionInputs(rawResponse, "GraphQL response");
  const response = responseSchema.parse(rawResponse);
  if (
    response.errors !== undefined &&
    response.errors.length > 0
  ) {
    throw new Error(
      `C6 neighbor census GraphQL errors ${
        input.target.requestedAnchorId
      }`,
    );
  }
  const requestedRepository = normalizeRepository(
    `${input.target.owner}/${input.target.repo}`,
  );
  const canonicalRepository = normalizeRepository(
    response.data.repository.nameWithOwner,
  );
  const pull = response.data.repository.pullRequest;
  const redirected = canonicalRepository !== requestedRepository;
  const expectedUrl =
    `https://github.com/${canonicalRepository}/pull/` +
    input.target.pullNumber;
  if (
    normalizeAnchor(input.target.requestedAnchorId) !==
      `${requestedRepository}#${input.target.pullNumber}` ||
    pull.number !== input.target.pullNumber ||
    normalizeRepository(pull.baseRepository.nameWithOwner) !==
      canonicalRepository ||
    normalizeRepository(capture.target.repository) !==
      canonicalRepository ||
    capture.target.pullNumber !== input.target.pullNumber ||
    normalizeUrl(pull.url) !== normalizeUrl(expectedUrl) ||
    normalizeUrl(capture.target.url) !== normalizeUrl(expectedUrl) ||
    redirected !== (capture.target.repositoryRedirect !== undefined)
  ) {
    throw new Error(
      `C6 neighbor census response identity mismatch ${
        input.target.requestedAnchorId
      }`,
    );
  }
  if (
    redirected &&
    (
      normalizeRepository(
        capture.target.repositoryRedirect!.requestedRepository,
      ) !== requestedRepository ||
      normalizeRepository(
        capture.target.repositoryRedirect!.resolvedRepository,
      ) !== canonicalRepository
    )
  ) {
    throw new Error(
      `C6 neighbor census redirect mismatch ${
        input.target.requestedAnchorId
      }`,
    );
  }
  return {
    canonicalAnchorId:
      `${canonicalRepository}#${input.target.pullNumber}`,
    canonicalRepository,
    captureOrder: input.target.captureOrder,
    pullNumber: input.target.pullNumber,
    requestedAnchorId:
      `${requestedRepository}#${input.target.pullNumber}`,
    requestedRepository,
    sourceSplit: input.target.sourceSplit,
  };
}

async function readReferencedFile(input: {
  expectedPath: string;
  files: ReadonlyMap<string, C6AssetLock["files"][number]>;
  graphqlRoot: string;
  prefix: string;
  reference: z.infer<typeof referenceSchema>;
}): Promise<Buffer> {
  if (input.reference.path !== input.expectedPath) {
    throw new Error(
      `C6 neighbor census reference path mismatch ${
        input.reference.path
      }`,
    );
  }
  const path = `${input.prefix}${input.expectedPath}`;
  const bytes = await readBoundFile(
    input.graphqlRoot,
    path,
    input.files,
  );
  if (
    bytes.byteLength !== input.reference.bytes ||
    sha256(bytes) !== input.reference.sha256
  ) {
    throw new Error(
      `C6 neighbor census reference mismatch ${path}`,
    );
  }
  return bytes;
}

async function readBoundFile(
  root: string,
  path: string,
  files: ReadonlyMap<string, C6AssetLock["files"][number]>,
): Promise<Buffer> {
  const reference = files.get(path);
  if (reference === undefined) {
    throw new Error(`C6 neighbor census missing capture file ${path}`);
  }
  const bytes = await readC6StableRegularFile(
    join(root, ...path.split("/")),
    "neighbor census capture file",
  );
  if (
    bytes.byteLength !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(`C6 neighbor census changed capture file ${path}`);
  }
  return bytes;
}

function repositoryProjection(
  observation: C6LiveMultiLangCanonicalObservation,
): unknown {
  return {
    canonicalRepository: observation.canonicalRepository,
    seedAnchorId: observation.canonicalAnchorId,
    seedCaptureOrder: observation.captureOrder,
    sourceSplit: observation.sourceSplit,
  };
}

function selectedRepositoryProjection(
  target: C6LiveMultiLangNeighborCensusTarget,
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

function reference(
  bytes: Uint8Array,
  path: string,
): z.infer<typeof referenceSchema> {
  return {
    bytes: bytes.byteLength,
    path: basename(path),
    sha256: sha256(bytes),
  };
}

function normalizeRepository(value: string): string {
  const parsed = repositorySchema.parse(value);
  return parsed.toLowerCase();
}

function normalizeAnchor(value: string): string {
  const match =
    /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9]\d*)$/u.exec(value);
  if (match === null) {
    throw new Error(`C6 neighbor census invalid anchor ${value}`);
  }
  return `${normalizeRepository(match[1]!)}#${match[2]}`;
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/u, "").toLowerCase();
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(`C6 neighbor census invalid ${label} JSON`);
  }
}

function assertNoForbiddenSelectionInputs(
  value: unknown,
  label: string,
  path = "$",
): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertNoForbiddenSelectionInputs(
        entry,
        label,
        `${path}[${index}]`,
      );
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (
      FORBIDDEN_SELECTION_INPUTS.some(
        (forbidden) =>
          forbidden.toLowerCase() === key.toLowerCase(),
      )
    ) {
      throw new Error(
        `C6 neighbor census forbidden selection input ${label} ${path}.${key}`,
      );
    }
    assertNoForbiddenSelectionInputs(
      entry,
      label,
      `${path}.${key}`,
    );
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
