import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";

const ARTIFACT_KIND = "c6-real-history-prehistory-selection";
const DOMAIN_SEPARATOR =
  "goodmemory:c6:real-history-prehistory-selection:lineage-rank:v1";
const PER_REPOSITORY_CAP = 4;
const SELECTED_PREHISTORY_SEEDS = 48;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const anchorIdSchema = z.string().regex(/^[^/#]+\/[^/#]+#[1-9]\d*$/u);
const presentUnknownSchema = z.unknown().refine(
  (value) => value !== undefined,
  "required field is missing",
);
const sourceUnitSchema = z.object({
  path: z.string().min(1),
  rowIndex: z.number().int().nonnegative(),
  rowSha256: sha256Schema,
}).strict();
const reviewLineageInputSchema = z.object({
  author: z.string().min(1),
  bodyBytes: z.number().int().nonnegative(),
  bodySha256: sha256Schema,
  createdAt: z.iso.datetime(),
  id: z.string().min(1),
  reviewedCommit: commitSchema,
  source: z.string().min(1),
}).strict();
const sequenceInputSchema = z.object({
  firstFixCommit: commitSchema,
  firstReview: reviewLineageInputSchema,
  initialCommit: commitSchema,
  secondFixCommit: commitSchema,
  secondReview: reviewLineageInputSchema,
}).strict();
const linearEvidenceInputSchema = z.object({
  edges: presentUnknownSchema,
  reviewedCommitTiming: presentUnknownSchema,
  sequence: sequenceInputSchema,
}).strict();
const strictRestInputSchema = z.object({
  commitClosure: presentUnknownSchema,
  graphqlParentAncestryEvidence: presentUnknownSchema,
  graphqlParentAncestrySequence: presentUnknownSchema,
  graphqlParentAncestryValid: z.boolean(),
  linearReviewAncestryEvidence: presentUnknownSchema,
  linearReviewAncestrySequence: presentUnknownSchema,
  linearReviewAncestryValid: z.boolean(),
  manifestSha256: sha256Schema,
  nonAuthorRequestEventCount: z.number().int().nonnegative(),
  pullAuthor: z.string().min(1),
  status: z.literal("strict-rest-closure"),
  timestampOnlyPairwiseAncestryValid: z.boolean(),
  timestampSequence: presentUnknownSchema.nullable(),
}).strict();
const sourceTargetSchema = z.object({
  anchorId: anchorIdSchema,
  directory: z.string().min(1),
  graphql: presentUnknownSchema,
  rest: z.union([
    z.object({
      status: z.literal("missing-strict-rest-closure"),
    }).strict(),
    strictRestInputSchema,
  ]),
  source: sourceUnitSchema,
  sourceTestSignals: presentUnknownSchema,
}).strict();
const sourceLineageSchema = z.object({
  anchorsSha256: sha256Schema,
  datasetId: z.literal("ByteDance-Seed/Multi-SWE-bench"),
  declaredRevision: commitSchema,
  rootSha256: sha256Schema,
}).strict();
const sourceArtifactSchema = z.object({
  artifactKind: z.literal("c6-review-trajectory-discovery"),
  boundary: presentUnknownSchema,
  counts: presentUnknownSchema,
  graphqlCapture: presentUnknownSchema,
  missingRestClosures: presentUnknownSchema,
  provenance: presentUnknownSchema,
  restCapture: presentUnknownSchema,
  schemaVersion: z.literal(1),
  selectionAudit: presentUnknownSchema,
  source: z.object({
    anchorsSha256: sha256Schema,
    datasetId: z.literal("ByteDance-Seed/Multi-SWE-bench"),
    declaredRevision: commitSchema,
    files: z.number().int().positive(),
    revisionReceiptBound: z.literal(false),
    revisionStatus: z.literal(
      "declared-source-revision-not-bound-by-tree-receipt",
    ),
    rootSha256: sha256Schema,
    treeReceipt: presentUnknownSchema,
  }).strict(),
  targetReceipt: presentUnknownSchema,
  targets: z.array(sourceTargetSchema),
}).strict();
const reviewLineageSchema = z.object({
  author: z.string().min(1),
  bodySha256: sha256Schema,
  createdAt: z.iso.datetime(),
  reviewedCommit: commitSchema,
}).strict();
const sequenceLineageSchema = z.object({
  firstFixCommit: commitSchema,
  firstReview: reviewLineageSchema,
  initialCommit: commitSchema,
  secondFixCommit: commitSchema,
  secondReview: reviewLineageSchema,
}).strict();
const prioritySeedSchema = z.object({
  anchorId: anchorIdSchema,
  lineageIdentitySha256: sha256Schema,
  linearReviewAncestry: sequenceLineageSchema,
  priorityRank: z.number().int().min(1).max(SELECTED_PREHISTORY_SEEDS),
  rankSha256: sha256Schema,
  repository: z.string().min(3),
  source: sourceUnitSchema,
}).strict();
const eligibleRankClosureEntrySchema = z.object({
  anchorId: anchorIdSchema,
  cappedPoolRank: z.number().int().positive().nullable(),
  eligibleRank: z.number().int().positive(),
  lineageIdentitySha256: sha256Schema,
  linearReviewAncestry: sequenceLineageSchema,
  priorityDecision: z.enum([
    "deferred-after-repository-cap",
    "deferred-after-global-priority-rank",
    "priority-prehistory-seed",
  ]),
  priorityRank: z.number().int().min(1).max(
    SELECTED_PREHISTORY_SEEDS,
  ).nullable(),
  rankSha256: sha256Schema,
  repository: z.string().min(3),
  repositoryCapDecision: z.enum([
    "deferred-after-repository-cap",
    "retained-in-capped-pool",
  ]),
  repositoryRank: z.number().int().positive(),
  source: sourceUnitSchema,
}).strict();
const selectionSchema = z.object({
  artifactKind: z.literal(ARTIFACT_KIND),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    selectionStatus: z.literal("prehistory-seeds-only"),
  }).strict(),
  priorityConcentration: z.object({
    kishEffectiveRepositoryFamilies: z.number().positive(),
    largestRepositoryCount: z.number().int().positive(),
    largestRepositoryShare: z.number().positive().max(1),
    sumSquaredRepositoryCounts: z.number().int().positive(),
  }).strict(),
  counts: z.object({
    cappedSeedPoolCount: z.number().int().min(SELECTED_PREHISTORY_SEEDS),
    eligibleRepositoryCount: z.number().int().positive(),
    eligibleSeedCount: z.number().int().min(
      SELECTED_PREHISTORY_SEEDS,
    ),
    priorityRepositoryCount: z.number().int().positive(),
    prioritySeedCount: z.literal(SELECTED_PREHISTORY_SEEDS),
    sourceTargetCount: z.number().int().min(SELECTED_PREHISTORY_SEEDS),
  }).strict(),
  eligibleRankClosure: z.array(eligibleRankClosureEntrySchema).min(
    SELECTED_PREHISTORY_SEEDS,
  ),
  independenceBoundary: z.object({
    personnelOutcomeBlindnessClaimed: z.literal(false),
    selectionDependsOnForbiddenFields: z.literal(false),
    status: z.literal(
      "outcome-field-independent-deterministic-projection",
    ),
  }).strict(),
  input: z.object({
    bytes: z.number().int().positive(),
    path: z.string().min(1),
    schemaVersion: z.literal(1),
    sha256: sha256Schema,
    sourceArtifactKind: z.literal("c6-review-trajectory-discovery"),
    sourceLineage: sourceLineageSchema,
  }).strict(),
  repositoryAllocation: z.array(z.object({
    cappedSignals: z.number().int().nonnegative().max(PER_REPOSITORY_CAP),
    eligibleSignals: z.number().int().positive(),
    prioritySeeds: z.number().int().nonnegative().max(PER_REPOSITORY_CAP),
    priorityShare: z.number().min(0).max(1),
    repository: z.string().min(3),
  }).strict()).min(1),
  rule: z.object({
    allowedFields: z.array(z.string().min(1)).min(1),
    domainSeparator: z.literal(DOMAIN_SEPARATOR),
    eligibilityPredicate: z.literal(
      "rest.status=strict-rest-closure AND " +
        "rest.linearReviewAncestryValid=true",
    ),
    firstPass: z.literal(
      "rank within repository ascending; retain at most 4",
    ),
    forbiddenFields: z.tuple([
      z.literal("sourceTestSignals"),
      z.literal("patch"),
      z.literal("test"),
      z.literal("gold"),
      z.literal("outcome"),
    ]),
    inputArtifactHashUsedForRanking: z.literal(false),
    perRepositoryCap: z.literal(PER_REPOSITORY_CAP),
    provenanceOnlyFields: z.array(z.string().min(1)).min(1),
    rankInput: z.literal(
      "sha256(domain-separator + NUL + canonical-lineage-identity-json)",
    ),
    secondPass: z.literal(
      "globally rank capped pool ascending; mark first 48 as priority seeds",
    ),
    prioritySeedCount: z.literal(SELECTED_PREHISTORY_SEEDS),
    tieBreaker: z.literal("anchorId ascending by Unicode code point"),
  }).strict(),
  schemaVersion: z.literal(1),
  priorityBoundary: z.object({
    prioritySeedsAreEpisodes: z.literal(false),
    prioritySeedsDefineFinalExclusionSet: z.literal(false),
    status: z.literal(
      "priority-order-only-downstream-availability-may-reject",
    ),
    targetAvailabilityChecked: z.literal(false),
  }).strict(),
  prioritySeeds: z.array(prioritySeedSchema).length(
    SELECTED_PREHISTORY_SEEDS,
  ),
}).strict();

type SourceTarget = z.infer<typeof sourceTargetSchema>;
type SequenceLineage = z.infer<typeof sequenceLineageSchema>;
type PrioritySeed = z.infer<typeof prioritySeedSchema>;
export type C6RealHistoryPrehistorySelection = z.infer<
  typeof selectionSchema
>;

interface RankedPrehistorySignal {
  anchorId: string;
  lineageIdentitySha256: string;
  linearReviewAncestry: SequenceLineage;
  rankSha256: string;
  repository: string;
  source: z.infer<typeof sourceUnitSchema>;
}

export function projectC6RealHistoryPrehistorySelection(input: {
  inputBytes: Uint8Array;
  inputPath: string;
}): C6RealHistoryPrehistorySelection {
  const bytes = Buffer.from(input.inputBytes);
  const sourceArtifact = sourceArtifactSchema.parse(
    JSON.parse(bytes.toString("utf8")) as unknown,
  );
  const sourceLineage = sourceLineageSchema.parse({
    anchorsSha256: sourceArtifact.source.anchorsSha256,
    datasetId: sourceArtifact.source.datasetId,
    declaredRevision: sourceArtifact.source.declaredRevision,
    rootSha256: sourceArtifact.source.rootSha256,
  });
  const seenAnchors = new Set<string>();
  const eligible = sourceArtifact.targets.flatMap((target) => {
    if (seenAnchors.has(target.anchorId)) {
      throw new Error(
        `duplicate C6 prehistory anchor ${target.anchorId}`,
      );
    }
    seenAnchors.add(target.anchorId);
    if (
      target.rest.status !== "strict-rest-closure" ||
      !target.rest.linearReviewAncestryValid
    ) {
      return [];
    }
    return [rankPrehistorySignal(target, sourceLineage)];
  });
  if (eligible.length < SELECTED_PREHISTORY_SEEDS) {
    throw new Error(
      "C6 prehistory selection has fewer than 48 eligible linear signals",
    );
  }
  const byRepository = new Map<string, RankedPrehistorySignal[]>();
  for (const signal of eligible) {
    const repositorySignals = byRepository.get(signal.repository) ?? [];
    repositorySignals.push(signal);
    byRepository.set(signal.repository, repositorySignals);
  }
  const repositoryRankByAnchor = new Map<string, number>();
  const capped = [...byRepository.values()].flatMap((signals) => {
    const ranked = [...signals].sort(compareRankedSignal);
    for (const [index, signal] of ranked.entries()) {
      repositoryRankByAnchor.set(signal.anchorId, index + 1);
    }
    return ranked.slice(0, PER_REPOSITORY_CAP);
  });
  if (capped.length < SELECTED_PREHISTORY_SEEDS) {
    throw new Error(
      "C6 prehistory repository cap leaves fewer than 48 signals",
    );
  }
  const rankedCappedPool = [...capped].sort(compareRankedSignal);
  const cappedPoolRankByAnchor = new Map(
    rankedCappedPool.map((signal, index) => [signal.anchorId, index + 1]),
  );
  const prioritySignals = rankedCappedPool.slice(
    0,
    SELECTED_PREHISTORY_SEEDS,
  );
  const priorityRankByAnchor = new Map(
    prioritySignals.map((signal, index) => [signal.anchorId, index + 1]),
  );
  const prioritySeeds: PrioritySeed[] = prioritySignals.map(
    (signal, index) => ({
      ...signal,
      priorityRank: index + 1,
    }),
  );
  const eligibleRankClosure = [...eligible]
    .sort(compareRankedSignal)
    .map((signal, index) => {
      const repositoryRank = repositoryRankByAnchor.get(signal.anchorId)!;
      const cappedPoolRank =
        cappedPoolRankByAnchor.get(signal.anchorId) ?? null;
      const priorityRank = priorityRankByAnchor.get(signal.anchorId) ?? null;
      return {
        ...signal,
        cappedPoolRank,
        eligibleRank: index + 1,
        priorityDecision: priorityRank !== null
          ? "priority-prehistory-seed" as const
          : cappedPoolRank !== null
          ? "deferred-after-global-priority-rank" as const
          : "deferred-after-repository-cap" as const,
        priorityRank,
        repositoryCapDecision: cappedPoolRank !== null
          ? "retained-in-capped-pool" as const
          : "deferred-after-repository-cap" as const,
        repositoryRank,
      };
    });
  const priorityCounts = countByRepository(prioritySeeds);
  const repositoryAllocation = [...byRepository.entries()]
    .sort(([left], [right]) => compareCanonicalString(left, right))
    .map(([repository, signals]) => ({
      cappedSignals: Math.min(signals.length, PER_REPOSITORY_CAP),
      eligibleSignals: signals.length,
      prioritySeeds: priorityCounts.get(repository) ?? 0,
      priorityShare: round(
        (priorityCounts.get(repository) ?? 0) /
          SELECTED_PREHISTORY_SEEDS,
      ),
      repository,
    }));
  const priorityRepositoryCounts = [...priorityCounts.values()];
  const sumSquaredRepositoryCounts = priorityRepositoryCounts.reduce(
    (sum, count) => sum + count ** 2,
    0,
  );
  const largestRepositoryCount = Math.max(...priorityRepositoryCounts);

  return selectionSchema.parse({
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      selectionStatus: "prehistory-seeds-only",
    },
    priorityConcentration: {
      kishEffectiveRepositoryFamilies: round(
        SELECTED_PREHISTORY_SEEDS ** 2 / sumSquaredRepositoryCounts,
      ),
      largestRepositoryCount,
      largestRepositoryShare: round(
        largestRepositoryCount / SELECTED_PREHISTORY_SEEDS,
      ),
      sumSquaredRepositoryCounts,
    },
    counts: {
      cappedSeedPoolCount: capped.length,
      eligibleRepositoryCount: byRepository.size,
      eligibleSeedCount: eligible.length,
      priorityRepositoryCount: priorityCounts.size,
      prioritySeedCount: SELECTED_PREHISTORY_SEEDS,
      sourceTargetCount: sourceArtifact.targets.length,
    },
    eligibleRankClosure,
    independenceBoundary: {
      personnelOutcomeBlindnessClaimed: false,
      selectionDependsOnForbiddenFields: false,
      status: "outcome-field-independent-deterministic-projection",
    },
    input: {
      bytes: bytes.byteLength,
      path: basename(resolve(input.inputPath)),
      schemaVersion: sourceArtifact.schemaVersion,
      sha256: sha256(bytes),
      sourceArtifactKind: sourceArtifact.artifactKind,
      sourceLineage,
    },
    repositoryAllocation,
    rule: {
      allowedFields: [
        "artifact.source.datasetId",
        "artifact.source.declaredRevision",
        "targets[].anchorId",
        "targets[].source.path",
        "targets[].source.rowIndex",
        "targets[].rest.status",
        "targets[].rest.linearReviewAncestryValid",
        "targets[].rest.linearReviewAncestrySequence.*Commit",
        "targets[].rest.linearReviewAncestrySequence.*Review.author",
        "targets[].rest.linearReviewAncestrySequence.*Review.bodySha256",
        "targets[].rest.linearReviewAncestrySequence.*Review.createdAt",
        "targets[].rest.linearReviewAncestrySequence.*Review.reviewedCommit",
      ],
      domainSeparator: DOMAIN_SEPARATOR,
      eligibilityPredicate:
        "rest.status=strict-rest-closure AND " +
        "rest.linearReviewAncestryValid=true",
      firstPass: "rank within repository ascending; retain at most 4",
      forbiddenFields: [
        "sourceTestSignals",
        "patch",
        "test",
        "gold",
        "outcome",
      ],
      inputArtifactHashUsedForRanking: false,
      perRepositoryCap: PER_REPOSITORY_CAP,
      provenanceOnlyFields: [
        "artifact input sha256",
        "artifact.source.rootSha256",
        "artifact.source.anchorsSha256",
        "targets[].source.rowSha256",
      ],
      rankInput:
        "sha256(domain-separator + NUL + canonical-lineage-identity-json)",
      secondPass:
        "globally rank capped pool ascending; mark first 48 as priority seeds",
      prioritySeedCount: SELECTED_PREHISTORY_SEEDS,
      tieBreaker: "anchorId ascending by Unicode code point",
    },
    schemaVersion: 1,
    priorityBoundary: {
      prioritySeedsAreEpisodes: false,
      prioritySeedsDefineFinalExclusionSet: false,
      status: "priority-order-only-downstream-availability-may-reject",
      targetAvailabilityChecked: false,
    },
    prioritySeeds,
  });
}

export async function materializeC6RealHistoryPrehistorySelection(input: {
  expectedInputSha256: string;
  inputPath: string;
  outputPath: string;
  testHooks?: {
    beforeTerminalInputVerification?: () => Promise<void> | void;
  };
}): Promise<{
  projectionSha256: string;
  selection: C6RealHistoryPrehistorySelection;
}> {
  const expectedInputSha256 = sha256Schema.parse(input.expectedInputSha256);
  const inputPath = await assertC6NoSymlinkPathComponents(
    input.inputPath,
    "C6 prehistory selection input",
  );
  const inputBytes = await readC6StableRegularFile(
    inputPath,
    "prehistory selection input",
  );
  if (sha256(inputBytes) !== expectedInputSha256) {
    throw new Error("C6 prehistory selection input hash mismatch");
  }
  const selection = projectC6RealHistoryPrehistorySelection({
    inputBytes,
    inputPath,
  });
  await input.testHooks?.beforeTerminalInputVerification?.();
  await assertC6NoSymlinkPathComponents(
    inputPath,
    "C6 prehistory selection input",
  );
  const terminalInputBytes = await readC6StableRegularFile(
    inputPath,
    "prehistory selection terminal input",
  );
  if (!terminalInputBytes.equals(inputBytes)) {
    throw new Error(
      "C6 prehistory selection input changed during materialization",
    );
  }
  const serialized = serializeC6RealHistoryPrehistorySelection(selection);
  await assertC6NoSymlinkPathComponents(
    dirname(resolve(input.outputPath)),
    "C6 prehistory selection output parent",
  );
  const handle = await open(resolve(input.outputPath), "wx", 0o644);
  try {
    await handle.writeFile(serialized, "utf8");
  } finally {
    await handle.close();
  }
  return {
    projectionSha256: sha256(serialized),
    selection,
  };
}

export async function loadC6RealHistoryPrehistorySelection(
  path: string,
  options: { expectedSha256?: string } = {},
): Promise<C6RealHistoryPrehistorySelection> {
  const resolvedPath = await assertC6NoSymlinkPathComponents(
    path,
    "C6 prehistory selection projection",
  );
  const bytes = await readC6StableRegularFile(
    resolvedPath,
    "prehistory selection projection",
  );
  if (
    options.expectedSha256 !== undefined &&
    sha256(bytes) !== sha256Schema.parse(options.expectedSha256)
  ) {
    throw new Error("C6 prehistory selection projection hash mismatch");
  }
  const parsed = selectionSchema.parse(
    JSON.parse(bytes.toString("utf8")) as unknown,
  );
  if (serializeC6RealHistoryPrehistorySelection(parsed) !== bytes.toString()) {
    throw new Error(
      "C6 prehistory selection projection is not canonical JSON",
    );
  }
  return parsed;
}

export async function replayC6RealHistoryPrehistorySelection(input: {
  expectedInputSha256: string;
  expectedProjectionSha256: string;
  inputPath: string;
  projectionPath: string;
}): Promise<{
  inputSha256: string;
  projectionSha256: string;
  reproduced: true;
  selection: C6RealHistoryPrehistorySelection;
}> {
  const expectedInputSha256 = sha256Schema.parse(input.expectedInputSha256);
  const expectedProjectionSha256 = sha256Schema.parse(
    input.expectedProjectionSha256,
  );
  const [inputPath, projectionPath] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.inputPath,
      "C6 prehistory replay input",
    ),
    assertC6NoSymlinkPathComponents(
      input.projectionPath,
      "C6 prehistory replay projection",
    ),
  ]);
  const [inputBytes, projectionBytes] = await Promise.all([
    readC6StableRegularFile(inputPath, "prehistory replay input"),
    readC6StableRegularFile(
      projectionPath,
      "prehistory replay projection",
    ),
  ]);
  const inputSha256 = sha256(inputBytes);
  const projectionSha256 = sha256(projectionBytes);
  if (inputSha256 !== expectedInputSha256) {
    throw new Error("C6 prehistory replay input hash mismatch");
  }
  if (projectionSha256 !== expectedProjectionSha256) {
    throw new Error("C6 prehistory replay projection hash mismatch");
  }
  const selection = projectC6RealHistoryPrehistorySelection({
    inputBytes,
    inputPath,
  });
  const reproducedBytes = Buffer.from(
    serializeC6RealHistoryPrehistorySelection(selection),
  );
  if (!projectionBytes.equals(reproducedBytes)) {
    throw new Error(
      "C6 prehistory replay projection does not match recomputation",
    );
  }
  const [terminalInputBytes, terminalProjectionBytes] = await Promise.all([
    readC6StableRegularFile(inputPath, "prehistory replay terminal input"),
    readC6StableRegularFile(
      projectionPath,
      "prehistory replay terminal projection",
    ),
  ]);
  if (
    !terminalInputBytes.equals(inputBytes) ||
    !terminalProjectionBytes.equals(projectionBytes)
  ) {
    throw new Error("C6 prehistory replay inputs changed during replay");
  }
  return {
    inputSha256,
    projectionSha256,
    reproduced: true,
    selection,
  };
}

export function serializeC6RealHistoryPrehistorySelection(
  selection: C6RealHistoryPrehistorySelection,
): string {
  return `${JSON.stringify(selection, null, 2)}\n`;
}

function rankPrehistorySignal(
  target: SourceTarget,
  sourceLineage: z.infer<typeof sourceLineageSchema>,
): RankedPrehistorySignal {
  if (target.rest.status !== "strict-rest-closure") {
    throw new Error("C6 prehistory rank requires strict REST closure");
  }
  const sequence = sequenceInputSchema.parse(
    target.rest.linearReviewAncestrySequence,
  );
  const evidence = linearEvidenceInputSchema.parse(
    target.rest.linearReviewAncestryEvidence,
  );
  const linearReviewAncestry = toSequenceLineage(sequence);
  if (
    JSON.stringify(linearReviewAncestry) !==
      JSON.stringify(toSequenceLineage(evidence.sequence))
  ) {
    throw new Error(
      `C6 prehistory linear ancestry sequence/evidence mismatch for ` +
        target.anchorId,
    );
  }
  const repository = target.anchorId.slice(
    0,
    target.anchorId.lastIndexOf("#"),
  );
  const lineageIdentity = {
    anchorId: target.anchorId,
    linearReviewAncestry,
    source: {
      path: target.source.path,
      rowIndex: target.source.rowIndex,
    },
    sourceLineage: {
      datasetId: sourceLineage.datasetId,
      declaredRevision: sourceLineage.declaredRevision,
    },
  };
  const lineageIdentityJson = JSON.stringify(lineageIdentity);
  return {
    anchorId: target.anchorId,
    lineageIdentitySha256: sha256(lineageIdentityJson),
    linearReviewAncestry,
    rankSha256: sha256(
      `${DOMAIN_SEPARATOR}\0${lineageIdentityJson}`,
    ),
    repository,
    source: target.source,
  };
}

function toSequenceLineage(
  sequence: z.infer<typeof sequenceInputSchema>,
): SequenceLineage {
  return sequenceLineageSchema.parse({
    firstFixCommit: sequence.firstFixCommit,
    firstReview: {
      author: sequence.firstReview.author,
      bodySha256: sequence.firstReview.bodySha256,
      createdAt: sequence.firstReview.createdAt,
      reviewedCommit: sequence.firstReview.reviewedCommit,
    },
    initialCommit: sequence.initialCommit,
    secondFixCommit: sequence.secondFixCommit,
    secondReview: {
      author: sequence.secondReview.author,
      bodySha256: sequence.secondReview.bodySha256,
      createdAt: sequence.secondReview.createdAt,
      reviewedCommit: sequence.secondReview.reviewedCommit,
    },
  });
}

function compareRankedSignal(
  left: RankedPrehistorySignal,
  right: RankedPrehistorySignal,
): number {
  return (
    compareCanonicalString(left.rankSha256, right.rankSha256) ||
    compareCanonicalString(left.anchorId, right.anchorId)
  );
}

function compareCanonicalString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function countByRepository(
  prioritySeeds: readonly PrioritySeed[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const seed of prioritySeeds) {
    counts.set(seed.repository, (counts.get(seed.repository) ?? 0) + 1);
  }
  return counts;
}

function round(value: number): number {
  return Number(value.toFixed(12));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
