import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  resolve,
} from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  buildC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
} from "./c6-asset-lock";
import {
  C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2,
  projectC6StructuralReviewPretargetEvents,
  selectC6MinimumLinearReviewSequence,
  serializeC6StructuralReviewEventPolicy,
} from "./c6-review-event-policy";

const ARTIFACT_KIND = "c6-review-trajectory-source-expansion";
const RANK_DOMAIN_SEPARATOR =
  "goodmemory:c6:prospective-structural-review-v2:pretarget-rank:v1";
const REPOSITORY_CAP = 4;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const pageInfoSchema = z.object({
  hasNextPage: z.boolean(),
}).passthrough();
const sourceSchema = z.object({
  path: z.string().min(1),
  rowIndex: z.number().int().nonnegative(),
  rowSha256: sha256Schema,
}).strict();
const anchorSchema = z.object({
  anchorId: z.string().min(1),
  captureDirectory: z.string().min(1),
  number: z.number().int().positive(),
  org: z.string().min(1),
  repo: z.string().min(1),
  repository: z.string().min(3),
  source: sourceSchema,
}).strict();
const captureEntrySchema = z.object({
  anchorId: z.string().min(1),
  captureManifestSha256: sha256Schema,
  directory: z.string().min(1),
  discoverySurfaceComplete: z.boolean(),
  effectiveDiscoverySurfaceComplete: z.boolean(),
  paginationGaps: z.array(z.unknown()),
  paginationSupplement: z.unknown().nullable(),
  repository: z.object({
    redirected: z.boolean(),
    requested: z.string().min(3),
    resolved: z.string().min(3),
  }).strict(),
  responseSha256: sha256Schema,
}).passthrough();
const inventorySchema = z.object({
  anchors: z.array(anchorSchema).min(1),
  artifactKind: z.literal("c6-github-graphql-discovery-inventory"),
  capture: z.object({
    rootSha256: sha256Schema,
    structureSha256: sha256Schema,
  }).strict(),
  captureEntries: z.array(captureEntrySchema).min(1),
  schemaVersion: z.literal(1),
  source: z.object({
    datasetId: z.literal("ByteDance-Seed/Multi-SWE-bench"),
    revision: commitSchema,
    rootSha256: sha256Schema,
    treeReceipt: z.object({
      bytes: z.number().int().positive(),
      path: z.string().min(1),
      sha256: sha256Schema,
    }).strict(),
  }).passthrough(),
  sourcePopulationSha256: sha256Schema,
}).passthrough();
const frameSchema = z.object({
  artifactKind: z.literal("c6-real-history-screening-frame"),
  candidates: z.array(z.object({
    anchorId: z.string().min(1),
  }).passthrough()).min(1),
  counts: z.object({
    eligibleCandidateCount: z.number().int().positive(),
  }).passthrough(),
  independenceBoundary: z.object({
    candidateProjectionSha256: sha256Schema,
  }).passthrough(),
  schemaVersion: z.literal(1),
}).passthrough();
const authorSchema = z.object({
  login: z.string().min(1),
}).passthrough().nullable();
const reviewSchema = z.object({
  author: authorSchema,
  body: z.string(),
  commit: z.object({ oid: commitSchema }).passthrough().nullable(),
  id: z.string().min(1),
  state: z.string().min(1),
  submittedAt: z.iso.datetime(),
}).passthrough();
const threadCommentSchema = z.object({
  author: authorSchema,
  body: z.string(),
  createdAt: z.iso.datetime(),
  id: z.string().min(1),
  originalCommit:
    z.object({ oid: commitSchema }).passthrough().nullable(),
}).passthrough();
const responseSchema = z.object({
  data: z.object({
    repository: z.object({
      nameWithOwner: z.string().min(3),
      pullRequest: z.object({
        closingIssuesReferences: z.object({
          nodes: z.array(z.object({
            number: z.number().int().positive(),
          }).passthrough().nullable()),
          pageInfo: pageInfoSchema,
        }).passthrough(),
        commits: z.object({
          nodes: z.array(z.object({
            commit: z.object({
              committedDate: z.iso.datetime(),
              oid: commitSchema,
              parents: z.object({
                nodes: z.array(
                  z.object({ oid: commitSchema }).passthrough().nullable(),
                ),
                pageInfo: pageInfoSchema,
              }).passthrough(),
            }).passthrough(),
          }).passthrough().nullable()),
          pageInfo: pageInfoSchema,
        }).passthrough(),
        number: z.number().int().positive(),
        reviews: z.object({
          nodes: z.array(reviewSchema.nullable()),
          pageInfo: pageInfoSchema,
        }).passthrough(),
        reviewThreads: z.object({
          nodes: z.array(z.object({
            comments: z.object({
              nodes: z.array(threadCommentSchema.nullable()),
              pageInfo: pageInfoSchema,
            }).passthrough(),
            id: z.string().min(1),
          }).passthrough().nullable()),
          pageInfo: pageInfoSchema,
        }).passthrough(),
      }).passthrough(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

type Inventory = z.infer<typeof inventorySchema>;
type Anchor = z.infer<typeof anchorSchema>;
type CaptureEntry = z.infer<typeof captureEntrySchema>;
type LinearSequence = NonNullable<
  ReturnType<typeof selectC6MinimumLinearReviewSequence>
>["sequence"];

export interface C6ReviewTrajectorySourceExpansionPretarget {
  anchorId: string;
  canonicalAnchorId: string;
  captureDirectory: string;
  legalSequenceCount: number;
  lineageIdentitySha256: string;
  linearReviewSequence: LinearSequence;
  pretargetEventCount: number;
  pretargetRank: number;
  rankSha256: string;
  repository: string;
  repositoryRank: number;
  requestedRepository: string;
  restCaptureOrder: number;
  source: z.infer<typeof sourceSchema>;
}

export interface C6ReviewTrajectorySourceExpansion {
  artifactKind: typeof ARTIFACT_KIND;
  boundary: {
    acceptedEpisodeCount: 0;
    adaptiveProspective: true;
    candidateManifestFrozen: false;
    codexRunReady: false;
    pretargetsRequireExactRestClosure: true;
    status: "prospective-structural-pretargets-not-episodes";
    upperBoundClaimPermitted: false;
  };
  counts: {
    canonicalLegacyExclusionCount: number;
    discoverySurfaceUnsupportedCount: number;
    inventoryAnchorCount: number;
    prospectiveAnchorCount: number;
    repositoryCappedStructuralCeiling: number;
    structuralPretargetCount: number;
    structuralPretargetRepositoryCount: number;
  };
  inventory: {
    bytes: number;
    captureRootSha256: string;
    captureStructureSha256: string;
    path: string;
    sha256: string;
    sourceDatasetId: "ByteDance-Seed/Multi-SWE-bench";
    sourcePopulationSha256: string;
    sourceRevision: string;
    sourceRootSha256: string;
    treeReceiptSha256: string;
  };
  legacyFrame: {
    bytes: number;
    candidateCount: number;
    candidateProjectionSha256: string;
    canonicalExclusionSetSha256: string;
    path: string;
    sha256: string;
  };
  policy: {
    definition: typeof C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2;
    policyId: "prospective-structural-review-v2";
    schemaVersion: 2;
    sha256: string;
  };
  pretargets: C6ReviewTrajectorySourceExpansionPretarget[];
  rule: {
    canonicalIdentity:
      "lowercase-resolved-repository-plus-pull-number";
    forbiddenSelectionInputs: readonly [
      "sourceTestSignals",
      "patch",
      "test",
      "gold",
      "outcome",
      "isResolved",
      "currentCommit",
      "semanticScreeningDecision",
      "machineQualificationDecision",
      "captureHash",
    ];
    legacyExclusion:
      "all-canonical-pulls-in-complete-legacy-screening-frame";
    pretargetOrder:
      "rankSha256-then-canonicalAnchorId";
    repositoryCap: 4;
    restCaptureOrder:
      "repositoryRank-then-rankSha256-then-canonicalAnchorId";
  };
  schemaVersion: 1;
  unsupportedCaptures: Array<{
    anchorId: string;
    reason: "graphql-pagination-not-linear-dag-complete";
  }>;
}

export function projectC6ReviewTrajectorySourceExpansion(input: {
  inventoryBytes: Uint8Array;
  inventoryPath: string;
  legacyFrameBytes: Uint8Array;
  legacyFramePath: string;
  responsesByDirectory: ReadonlyMap<string, Uint8Array>;
}): C6ReviewTrajectorySourceExpansion {
  const inventoryBytes = Buffer.from(input.inventoryBytes);
  const frameBytes = Buffer.from(input.legacyFrameBytes);
  const rawFrame = parseJson(frameBytes, "legacy screening frame");
  const frame = frameSchema.parse(rawFrame);
  if (
    frame.candidates.length !== frame.counts.eligibleCandidateCount ||
    sha256(JSON.stringify(
      (rawFrame as { candidates: unknown }).candidates,
    )) !== frame.independenceBoundary.candidateProjectionSha256
  ) {
    throw new Error(
      "C6 source expansion legacy frame candidate projection mismatch",
    );
  }
  const inventory = inventorySchema.parse(
    parseJson(inventoryBytes, "GraphQL discovery inventory"),
  );
  const index = buildInventoryIndex(inventory);
  const legacyCanonicalIds = frame.candidates.map((candidate) => {
    const entry = index.byAnchor.get(candidate.anchorId.toLowerCase());
    const anchor = index.anchorById.get(candidate.anchorId.toLowerCase());
    if (entry === undefined || anchor === undefined) {
      throw new Error(
        `C6 source expansion unknown legacy frame anchor ${
          candidate.anchorId
        }`,
      );
    }
    return canonicalAnchorId(entry, anchor.number);
  }).sort(compareStrings);
  if (
    new Set(legacyCanonicalIds).size !== legacyCanonicalIds.length
  ) {
    throw new Error(
      "C6 source expansion canonical legacy exclusion collision",
    );
  }
  const excluded = new Set(legacyCanonicalIds);
  const unsupportedCaptures:
    C6ReviewTrajectorySourceExpansion["unsupportedCaptures"] = [];
  const candidates: Array<Omit<
    C6ReviewTrajectorySourceExpansionPretarget,
    "pretargetRank" | "repositoryRank" | "restCaptureOrder"
  >> = [];

  for (const anchor of inventory.anchors) {
    const entry = index.byAnchor.get(anchor.anchorId.toLowerCase())!;
    const canonicalId = canonicalAnchorId(entry, anchor.number);
    if (excluded.has(canonicalId)) {
      continue;
    }
    if (!entry.discoverySurfaceComplete) {
      unsupportedCaptures.push({
        anchorId: anchor.anchorId,
        reason: "graphql-pagination-not-linear-dag-complete",
      });
      continue;
    }
    const responseBytes = input.responsesByDirectory.get(entry.directory);
    if (
      responseBytes === undefined ||
      sha256(responseBytes) !== entry.responseSha256
    ) {
      throw new Error(
        `C6 source expansion raw response hash mismatch ${anchor.anchorId}`,
      );
    }
    const response = responseSchema.parse(
      parseJson(responseBytes, `GraphQL response ${anchor.anchorId}`),
    );
    const pull = response.data.repository.pullRequest;
    if (
      normalizeRepository(response.data.repository.nameWithOwner) !==
        normalizeRepository(entry.repository.resolved) ||
      pull.number !== anchor.number
    ) {
      throw new Error(
        `C6 source expansion raw response identity mismatch ${
          anchor.anchorId
        }`,
      );
    }
    assertCompletePagination(pull, anchor.anchorId);
    const events = projectC6StructuralReviewPretargetEvents({
      reviews: pull.reviews.nodes.filter(isPresent).map((review) => ({
        author: review.author?.login ?? null,
        body: review.body,
        commit: review.commit?.oid ?? null,
        id: review.id,
        state: review.state,
        submittedAt: review.submittedAt,
      })),
      reviewThreads: pull.reviewThreads.nodes.filter(isPresent).map(
        (thread) => ({
          comments: thread.comments.nodes.filter(isPresent).map(
            (comment) => ({
              author: comment.author?.login ?? null,
              body: comment.body,
              createdAt: comment.createdAt,
              id: comment.id,
              originalCommit: comment.originalCommit?.oid ?? null,
            }),
          ),
          id: thread.id,
        }),
      ),
    });
    const selected = selectC6MinimumLinearReviewSequence({
      anchorId: canonicalId,
      commits: pull.commits.nodes.filter(isPresent).map((node) => ({
        committedAt: node.commit.committedDate,
        oid: node.commit.oid,
        parents: node.commit.parents.nodes.filter(isPresent).map(
          (parent) => parent.oid,
        ),
      })),
      events,
    });
    if (selected === null) {
      continue;
    }
    const rankIdentity = {
      canonicalAnchorId: canonicalId,
      lineageIdentitySha256: selected.lineageIdentitySha256,
      policyId: C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2.policyId,
      source: {
        path: anchor.source.path,
        rowIndex: anchor.source.rowIndex,
      },
      sourceRevision: inventory.source.revision,
    };
    candidates.push({
      anchorId: anchor.anchorId,
      canonicalAnchorId: canonicalId,
      captureDirectory: entry.directory,
      legalSequenceCount: selected.legalSequenceCount,
      lineageIdentitySha256: selected.lineageIdentitySha256,
      linearReviewSequence: selected.sequence,
      pretargetEventCount: events.length,
      rankSha256: sha256(
        `${RANK_DOMAIN_SEPARATOR}\0${JSON.stringify(rankIdentity)}`,
      ),
      repository: normalizeRepository(entry.repository.resolved),
      requestedRepository: normalizeRepository(entry.repository.requested),
      source: anchor.source,
    });
  }
  const ranked = candidates.sort(compareCandidates);
  const repositoryGroups = groupByRepository(ranked);
  const repositoryRank = new Map<string, number>();
  for (const repositoryCandidates of repositoryGroups.values()) {
    repositoryCandidates.forEach((candidate, index) => {
      repositoryRank.set(candidate.canonicalAnchorId, index + 1);
    });
  }
  const captureOrder = [...ranked].sort((left, right) =>
    repositoryRank.get(left.canonicalAnchorId)! -
      repositoryRank.get(right.canonicalAnchorId)! ||
    compareCandidates(left, right)
  );
  const restCaptureOrder = new Map(
    captureOrder.map((candidate, index) => [
      candidate.canonicalAnchorId,
      index + 1,
    ]),
  );
  const pretargets = ranked.map((candidate, index) => ({
    ...candidate,
    pretargetRank: index + 1,
    repositoryRank: repositoryRank.get(candidate.canonicalAnchorId)!,
    restCaptureOrder: restCaptureOrder.get(candidate.canonicalAnchorId)!,
  }));

  return {
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      adaptiveProspective: true,
      candidateManifestFrozen: false,
      codexRunReady: false,
      pretargetsRequireExactRestClosure: true,
      status: "prospective-structural-pretargets-not-episodes",
      upperBoundClaimPermitted: false,
    },
    counts: {
      canonicalLegacyExclusionCount: legacyCanonicalIds.length,
      discoverySurfaceUnsupportedCount: unsupportedCaptures.length,
      inventoryAnchorCount: inventory.anchors.length,
      prospectiveAnchorCount:
        inventory.anchors.length - legacyCanonicalIds.length,
      repositoryCappedStructuralCeiling: [...repositoryGroups.values()]
        .reduce(
          (sum, repositoryCandidates) =>
            sum + Math.min(REPOSITORY_CAP, repositoryCandidates.length),
          0,
        ),
      structuralPretargetCount: pretargets.length,
      structuralPretargetRepositoryCount: repositoryGroups.size,
    },
    inventory: {
      bytes: inventoryBytes.byteLength,
      captureRootSha256: inventory.capture.rootSha256,
      captureStructureSha256: inventory.capture.structureSha256,
      path: basename(input.inventoryPath),
      sha256: sha256(inventoryBytes),
      sourceDatasetId: inventory.source.datasetId,
      sourcePopulationSha256: inventory.sourcePopulationSha256,
      sourceRevision: inventory.source.revision,
      sourceRootSha256: inventory.source.rootSha256,
      treeReceiptSha256: inventory.source.treeReceipt.sha256,
    },
    legacyFrame: {
      bytes: frameBytes.byteLength,
      candidateCount: frame.candidates.length,
      candidateProjectionSha256:
        frame.independenceBoundary.candidateProjectionSha256,
      canonicalExclusionSetSha256: sha256(
        JSON.stringify(legacyCanonicalIds),
      ),
      path: basename(input.legacyFramePath),
      sha256: sha256(frameBytes),
    },
    policy: {
      definition: C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2,
      policyId: C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2.policyId,
      schemaVersion: C6_STRUCTURAL_REVIEW_EVENT_POLICY_V2.schemaVersion,
      sha256: sha256(serializeC6StructuralReviewEventPolicy()),
    },
    pretargets,
    rule: {
      canonicalIdentity:
        "lowercase-resolved-repository-plus-pull-number",
      forbiddenSelectionInputs: [
        "sourceTestSignals",
        "patch",
        "test",
        "gold",
        "outcome",
        "isResolved",
        "currentCommit",
        "semanticScreeningDecision",
        "machineQualificationDecision",
        "captureHash",
      ],
      legacyExclusion:
        "all-canonical-pulls-in-complete-legacy-screening-frame",
      pretargetOrder:
        "rankSha256-then-canonicalAnchorId",
      repositoryCap: REPOSITORY_CAP,
      restCaptureOrder:
        "repositoryRank-then-rankSha256-then-canonicalAnchorId",
    },
    schemaVersion: 1,
    unsupportedCaptures: unsupportedCaptures.sort((left, right) =>
      compareStrings(left.anchorId, right.anchorId)
    ),
  };
}

export function serializeC6ReviewTrajectorySourceExpansion(
  expansion: C6ReviewTrajectorySourceExpansion,
): string {
  return `${JSON.stringify(expansion, null, 2)}\n`;
}

export async function buildC6ReviewTrajectorySourceExpansion(input: {
  expectedInventorySha256: string;
  expectedLegacyFrameSha256: string;
  graphqlCaptureRoot: string;
  inventoryPath: string;
  legacyFramePath: string;
  testHooks?: {
    beforeTerminalVerification?: () => Promise<void> | void;
  };
}): Promise<{
  expansion: C6ReviewTrajectorySourceExpansion;
  outputSha256: string;
}> {
  const expectedInventorySha256 = sha256Schema.parse(
    input.expectedInventorySha256,
  );
  const expectedLegacyFrameSha256 = sha256Schema.parse(
    input.expectedLegacyFrameSha256,
  );
  const [inventoryPath, legacyFramePath, graphqlCaptureRoot] =
    await Promise.all([
      assertC6NoSymlinkPathComponents(
        input.inventoryPath,
        "C6 source expansion inventory",
      ),
      assertC6NoSymlinkPathComponents(
        input.legacyFramePath,
        "C6 source expansion legacy frame",
      ),
      assertC6NoSymlinkPathComponents(
        input.graphqlCaptureRoot,
        "C6 source expansion GraphQL root",
      ),
    ]);
  const [inventoryBytes, legacyFrameBytes, captureLock] =
    await Promise.all([
      readC6StableRegularFile(
        inventoryPath,
        "source expansion inventory",
      ),
      readC6StableRegularFile(
        legacyFramePath,
        "source expansion legacy frame",
      ),
      buildC6AssetLock(graphqlCaptureRoot),
    ]);
  if (sha256(inventoryBytes) !== expectedInventorySha256) {
    throw new Error("C6 source expansion inventory hash mismatch");
  }
  if (sha256(legacyFrameBytes) !== expectedLegacyFrameSha256) {
    throw new Error("C6 source expansion legacy frame hash mismatch");
  }
  const inventory = inventorySchema.parse(
    parseJson(inventoryBytes, "GraphQL discovery inventory"),
  );
  if (captureLock.assetRootSha256 !== inventory.capture.rootSha256) {
    throw new Error("C6 source expansion GraphQL root hash mismatch");
  }
  const responsesByDirectory = new Map<string, Buffer>();
  for (const entry of inventory.captureEntries) {
    if (!entry.discoverySurfaceComplete) {
      continue;
    }
    responsesByDirectory.set(
      entry.directory,
      await readC6StableRegularFile(
        join(graphqlCaptureRoot, entry.directory, "response.json"),
        `source expansion GraphQL response ${entry.anchorId}`,
      ),
    );
  }
  const expansion = projectC6ReviewTrajectorySourceExpansion({
    inventoryBytes,
    inventoryPath,
    legacyFrameBytes,
    legacyFramePath,
    responsesByDirectory,
  });

  await input.testHooks?.beforeTerminalVerification?.();
  const [terminalInventoryBytes, terminalFrameBytes, terminalCaptureLock] =
    await Promise.all([
      readC6StableRegularFile(
        inventoryPath,
        "source expansion terminal inventory",
      ),
      readC6StableRegularFile(
        legacyFramePath,
        "source expansion terminal legacy frame",
      ),
      buildC6AssetLock(graphqlCaptureRoot),
    ]);
  if (
    !terminalInventoryBytes.equals(inventoryBytes) ||
    !terminalFrameBytes.equals(legacyFrameBytes) ||
    serializeC6AssetLock(terminalCaptureLock) !==
      serializeC6AssetLock(captureLock)
  ) {
    throw new Error(
      "C6 source expansion input closure changed during projection",
    );
  }
  const serialized = serializeC6ReviewTrajectorySourceExpansion(expansion);
  return {
    expansion,
    outputSha256: sha256(serialized),
  };
}

export async function materializeC6ReviewTrajectorySourceExpansion(input: {
  expectedInventorySha256: string;
  expectedLegacyFrameSha256: string;
  graphqlCaptureRoot: string;
  inventoryPath: string;
  legacyFramePath: string;
  outputPath: string;
  testHooks?: {
    beforeTerminalVerification?: () => Promise<void> | void;
  };
}): Promise<{
  expansion: C6ReviewTrajectorySourceExpansion;
  outputSha256: string;
}> {
  const result = await buildC6ReviewTrajectorySourceExpansion(input);
  const serialized = serializeC6ReviewTrajectorySourceExpansion(
    result.expansion,
  );
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 source expansion output parent",
  );
  const handle = await open(outputPath, "wx", 0o644);
  try {
    await handle.writeFile(serialized, "utf8");
  } finally {
    await handle.close();
  }
  return result;
}

export async function replayC6ReviewTrajectorySourceExpansion(input: {
  expectedInventorySha256: string;
  expectedLegacyFrameSha256: string;
  expectedProjectionSha256: string;
  graphqlCaptureRoot: string;
  inventoryPath: string;
  legacyFramePath: string;
  projectionPath: string;
}): Promise<{
  expansion: C6ReviewTrajectorySourceExpansion;
  projectionSha256: string;
  reproduced: true;
}> {
  const expectedProjectionSha256 = sha256Schema.parse(
    input.expectedProjectionSha256,
  );
  const projectionPath = await assertC6NoSymlinkPathComponents(
    input.projectionPath,
    "C6 source expansion projection",
  );
  const projectionBytes = await readC6StableRegularFile(
    projectionPath,
    "source expansion projection",
  );
  if (sha256(projectionBytes) !== expectedProjectionSha256) {
    throw new Error("C6 source expansion projection hash mismatch");
  }
  const result = await buildC6ReviewTrajectorySourceExpansion(input);
  const reproducedBytes = Buffer.from(
    serializeC6ReviewTrajectorySourceExpansion(result.expansion),
  );
  if (!projectionBytes.equals(reproducedBytes)) {
    throw new Error(
      "C6 source expansion projection does not match recomputation",
    );
  }
  const terminalProjectionBytes = await readC6StableRegularFile(
    projectionPath,
    "source expansion terminal projection",
  );
  if (!terminalProjectionBytes.equals(projectionBytes)) {
    throw new Error(
      "C6 source expansion projection changed during replay",
    );
  }
  return {
    expansion: result.expansion,
    projectionSha256: result.outputSha256,
    reproduced: true,
  };
}

function buildInventoryIndex(inventory: Inventory): {
  anchorById: Map<string, Anchor>;
  byAnchor: Map<string, CaptureEntry>;
} {
  const anchorById = new Map<string, Anchor>();
  const byAnchor = new Map<string, CaptureEntry>();
  const canonicalIds = new Set<string>();
  for (const anchor of inventory.anchors) {
    const key = anchor.anchorId.toLowerCase();
    if (anchorById.has(key)) {
      throw new Error(
        `C6 source expansion duplicate inventory anchor ${anchor.anchorId}`,
      );
    }
    anchorById.set(key, anchor);
  }
  for (const entry of inventory.captureEntries) {
    const key = entry.anchorId.toLowerCase();
    const anchor = anchorById.get(key);
    if (
      anchor === undefined ||
      byAnchor.has(key) ||
      entry.directory !== anchor.captureDirectory ||
      normalizeRepository(entry.repository.requested) !==
        normalizeRepository(anchor.repository) ||
      entry.repository.redirected !== (
        normalizeRepository(entry.repository.requested) !==
          normalizeRepository(entry.repository.resolved)
      )
    ) {
      throw new Error(
        `C6 source expansion inventory capture mismatch ${entry.anchorId}`,
      );
    }
    const canonicalId = canonicalAnchorId(entry, anchor.number);
    if (canonicalIds.has(canonicalId)) {
      throw new Error(
        `C6 source expansion canonical anchor collision ${canonicalId}`,
      );
    }
    canonicalIds.add(canonicalId);
    byAnchor.set(key, entry);
  }
  if (byAnchor.size !== anchorById.size) {
    throw new Error("C6 source expansion inventory closure mismatch");
  }
  return { anchorById, byAnchor };
}

function assertCompletePagination(
  pull: z.infer<typeof responseSchema>["data"]["repository"]["pullRequest"],
  anchorId: string,
): void {
  const incomplete =
    pull.closingIssuesReferences.pageInfo.hasNextPage ||
    pull.commits.pageInfo.hasNextPage ||
    pull.reviews.pageInfo.hasNextPage ||
    pull.reviewThreads.pageInfo.hasNextPage ||
    pull.commits.nodes.filter(isPresent).some(
      (node) => node.commit.parents.pageInfo.hasNextPage,
    ) ||
    pull.reviewThreads.nodes.filter(isPresent).some(
      (thread) => thread.comments.pageInfo.hasNextPage,
    );
  if (incomplete) {
    throw new Error(
      `C6 source expansion unexpected GraphQL pagination gap ${anchorId}`,
    );
  }
}

function groupByRepository<T extends { repository: string }>(
  candidates: readonly T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.repository) ?? [];
    group.push(candidate);
    groups.set(candidate.repository, group);
  }
  return groups;
}

function compareCandidates(
  left: {
    canonicalAnchorId: string;
    rankSha256: string;
  },
  right: {
    canonicalAnchorId: string;
    rankSha256: string;
  },
): number {
  return compareStrings(left.rankSha256, right.rankSha256) ||
    compareStrings(left.canonicalAnchorId, right.canonicalAnchorId);
}

function canonicalAnchorId(
  entry: CaptureEntry,
  pullNumber: number,
): string {
  return `${normalizeRepository(entry.repository.resolved)}#${pullNumber}`;
}

function normalizeRepository(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[^/#]+\/[^/#]+$/u.test(normalized)) {
    throw new Error(`C6 source expansion invalid repository ${value}`);
  }
  return normalized;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(`C6 source expansion invalid ${label} JSON`);
  }
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
