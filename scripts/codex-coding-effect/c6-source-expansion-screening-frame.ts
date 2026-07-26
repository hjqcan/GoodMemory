import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";

const MINIMUM_REQUIRED_EPISODES = 48;
const REPOSITORY_CAP = 4;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const sourceSchema = z.object({
  path: z.string().min(1),
  rowIndex: z.number().int().nonnegative(),
  rowSha256: sha256Schema,
}).strict();
const legacyCandidateSchema = z.object({
  anchorId: z.string().min(1),
  lineageIdentitySha256: sha256Schema,
  screeningRank: z.number().int().positive(),
  source: sourceSchema,
}).passthrough();
const legacyFrameSchema = z.object({
  artifactKind: z.literal("c6-real-history-screening-frame"),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
  }).passthrough(),
  candidates: z.array(legacyCandidateSchema).min(1),
  counts: z.object({
    eligibleCandidateCount: z.number().int().positive(),
  }).passthrough(),
  independenceBoundary: z.object({
    candidateProjectionSha256: sha256Schema,
  }).passthrough(),
  schemaVersion: z.literal(1),
}).passthrough();
const inventoryEntrySchema = z.object({
  anchorId: z.string().min(1),
  repository: z.object({
    requested: z.string().min(3),
    resolved: z.string().min(3),
  }).passthrough(),
}).passthrough();
const inventorySchema = z.object({
  artifactKind: z.literal("c6-github-graphql-discovery-inventory"),
  captureEntries: z.array(inventoryEntrySchema).min(1),
  schemaVersion: z.literal(1),
}).passthrough();
const qualificationResultBaseSchema = z.object({
  anchorId: z.string().min(1),
  canonicalAnchorId: z.string().min(1),
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
}).passthrough();
const qualificationResultSchema = z.discriminatedUnion("status", [
  qualificationResultBaseSchema.extend({
    status: z.literal("missing-rest-closure"),
  }),
  qualificationResultBaseSchema.extend({
    captureManifestSha256: sha256Schema,
    exactEventCount: z.number().int().nonnegative(),
    status: z.literal("no-exact-structural-sequence"),
  }),
  qualificationResultBaseSchema.extend({
    captureManifestSha256: sha256Schema,
    exactEventCount: z.number().int().positive(),
    exactLineageIdentitySha256: sha256Schema,
    source: sourceSchema,
    status: z.literal("exact-structural-candidate"),
  }),
]);
const qualificationSchema = z.object({
  artifactKind: z.literal("c6-source-expansion-rest-qualification"),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    captureAttemptCompletenessProven: z.literal(false),
    codexRunReady: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
    status: z.literal(
      "exact-structural-screening-not-semantic-qualification",
    ),
  }).strict(),
  counts: z.object({
    capturedClosureCount: z.number().int().nonnegative(),
    exactStructuralCandidateCount: z.number().int().nonnegative(),
    exactStructuralRepositoryCount: z.number().int().nonnegative(),
    missingClosureCount: z.number().int().nonnegative(),
    repositoryCappedStructuralCeiling: z.number().int().nonnegative(),
    targetCount: z.number().int().positive(),
  }).strict(),
  inputs: z.object({
    capturePlanSha256: sha256Schema,
    graphqlRootSha256: sha256Schema,
    restRootSha256: sha256Schema,
  }).strict(),
  results: z.array(qualificationResultSchema).min(1),
  schemaVersion: z.literal(1),
}).strict();
const candidateSchema = z.object({
  canonicalAnchorId: z.string().min(1),
  canonicalRepository: z.string().min(3),
  lineageIdentitySha256: sha256Schema,
  requestedAnchorId: z.string().min(1),
  screeningRank: z.number().int().positive(),
  source: sourceSchema,
  sourceRank: z.number().int().positive(),
  sourceTranche: z.enum([
    "legacy-screening-frame-v1",
    "prospective-rest-exact-v2",
  ]),
}).strict();
const referenceSchema = z.object({
  bytes: z.number().int().positive(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const frameSchema = z.object({
  artifactKind: z.literal("c6-source-expansion-screening-frame"),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    adaptiveProspective: z.literal(true),
    candidateManifestFrozen: z.literal(false),
    captureAttemptCompletenessProven: z.literal(false),
    codexRunReady: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
    status: z.literal(
      "combined-structural-screening-frame-semantic-and-machine-qualification-required",
    ),
    structuralCapacityOnly: z.literal(true),
  }).strict(),
  candidates: z.array(candidateSchema).min(1),
  counts: z.object({
    combinedStructuralCandidateCount: z.number().int().positive(),
    exactStructuralCandidateCount: z.number().int().nonnegative(),
    legacyCandidateCount: z.number().int().positive(),
    minimumRequiredEpisodes: z.literal(MINIMUM_REQUIRED_EPISODES),
    missingRestClosureCount: z.number().int().nonnegative(),
    noExactStructuralSequenceCount: z.number().int().nonnegative(),
    qualificationTargetCount: z.number().int().positive(),
    rawStructuralMargin: z.number().int(),
    repositoryCappedStructuralCeiling: z.number().int().nonnegative(),
    repositoryCount: z.number().int().positive(),
  }).strict(),
  independenceBoundary: z.object({
    adaptiveProspective: z.literal(true),
    candidateProjectionSha256: sha256Schema,
    exactCandidateProjectionSha256: sha256Schema,
    legacyCandidateProjectionSha256: sha256Schema,
    legacyOrderPreserved: z.literal(true),
    machineOutcomeInput: z.literal(false),
    personnelOutcomeBlindnessClaimed: z.literal(false),
    prospectiveTrancheAppendedAfterLegacyFrame: z.literal(true),
    selectionDependsOnForbiddenFields: z.literal(false),
    semanticLedgerInput: z.literal(false),
  }).strict(),
  inputs: z.object({
    inventory: referenceSchema,
    legacyFrame: referenceSchema.extend({
      candidateProjectionSha256: sha256Schema,
    }),
    restQualification: referenceSchema.extend({
      capturePlanSha256: sha256Schema,
      graphqlRootSha256: sha256Schema,
      restRootSha256: sha256Schema,
    }),
  }).strict(),
  policy: z.object({
    canonicalIdentity: z.literal(
      "lowercase-resolved-repository-plus-pull-number",
    ),
    exactV2Eligibility: z.literal(
      "exact-structural-candidate-from-frozen-rest-qualification",
    ),
    forbiddenSelectionInputs: z.tuple([
      z.literal("sourceTestSignals"),
      z.literal("patch"),
      z.literal("test"),
      z.literal("gold"),
      z.literal("outcome"),
      z.literal("semanticScreeningDecision"),
      z.literal("machineQualificationDecision"),
    ]),
    order: z.literal(
      "complete-legacy-screeningRank-then-exact-v2-restCaptureOrder",
    ),
    repositoryCap: z.literal(REPOSITORY_CAP),
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();

export type C6SourceExpansionScreeningFrame = z.infer<typeof frameSchema>;

export interface C6SourceExpansionScreeningFrameCapacity {
  canMeetMinimumUnderRepositoryCap: boolean;
  definitivelyRejectedCandidateCount: number;
  minimumRequiredEpisodes: number;
  remainingStructuralCandidateCount: number;
  repositoryCappedStructuralCeiling: number;
  selectableMargin: number;
}

export function projectC6SourceExpansionScreeningFrame(input: {
  inventoryBytes: Uint8Array;
  inventoryPath: string;
  legacyFrameBytes: Uint8Array;
  legacyFramePath: string;
  qualificationBytes: Uint8Array;
  qualificationPath: string;
}): C6SourceExpansionScreeningFrame {
  const inventoryBytes = Buffer.from(input.inventoryBytes);
  const legacyFrameBytes = Buffer.from(input.legacyFrameBytes);
  const qualificationBytes = Buffer.from(input.qualificationBytes);
  const rawLegacyFrame = parseJson(
    legacyFrameBytes,
    "legacy screening frame",
  );
  const legacyFrame = legacyFrameSchema.parse(rawLegacyFrame);
  if (
    legacyFrame.candidates.length !==
      legacyFrame.counts.eligibleCandidateCount ||
    sha256(JSON.stringify(
      (rawLegacyFrame as { candidates: unknown }).candidates,
    )) !== legacyFrame.independenceBoundary.candidateProjectionSha256
  ) {
    throw new Error(
      "C6 source-expansion frame legacy candidate projection mismatch",
    );
  }
  assertContiguousRanks(
    legacyFrame.candidates.map((candidate) => candidate.screeningRank),
    "legacy screening rank",
  );
  const inventory = inventorySchema.parse(
    parseJson(inventoryBytes, "inventory"),
  );
  const qualification = qualificationSchema.parse(
    parseJson(qualificationBytes, "REST qualification"),
  );
  const inventoryByAnchor = buildInventoryIndex(inventory.captureEntries);
  const legacyCandidates = [...legacyFrame.candidates]
    .sort((left, right) => left.screeningRank - right.screeningRank)
    .map((candidate) => {
      const requested = parseAnchor(candidate.anchorId);
      const entry = inventoryByAnchor.get(candidate.anchorId.toLowerCase());
      if (
        entry === undefined ||
        normalizeRepository(entry.repository.requested) !==
          requested.repository
      ) {
        throw new Error(
          `C6 source-expansion frame unknown legacy anchor ${
            candidate.anchorId
          }`,
        );
      }
      const canonicalRepository = normalizeRepository(
        entry.repository.resolved,
      );
      return {
        canonicalAnchorId:
          `${canonicalRepository}#${requested.pullNumber}`,
        canonicalRepository,
        lineageIdentitySha256: candidate.lineageIdentitySha256,
        requestedAnchorId: candidate.anchorId,
        screeningRank: candidate.screeningRank,
        source: candidate.source,
        sourceRank: candidate.screeningRank,
        sourceTranche: "legacy-screening-frame-v1" as const,
      };
    });
  const results = [...qualification.results].sort(
    (left, right) => left.captureOrder - right.captureOrder,
  );
  assertContiguousRanks(
    results.map((result) => result.captureOrder),
    "REST capture order",
  );
  assertQualificationCounts(qualification, results);
  const exactCandidates = results
    .filter((result) => result.status === "exact-structural-candidate")
    .map((result, index) => {
      const requested = parseAnchor(result.anchorId);
      const canonical = parseAnchor(result.canonicalAnchorId);
      return {
        canonicalAnchorId:
          `${canonical.repository}#${canonical.pullNumber}`,
        canonicalRepository: canonical.repository,
        lineageIdentitySha256: result.exactLineageIdentitySha256,
        requestedAnchorId:
          `${requested.repository}#${requested.pullNumber}`,
        screeningRank: legacyCandidates.length + index + 1,
        source: result.source,
        sourceRank: result.captureOrder,
        sourceTranche: "prospective-rest-exact-v2" as const,
      };
    });
  const candidates = [...legacyCandidates, ...exactCandidates];
  assertUniqueCandidates(candidates);
  const repositories = groupByRepository(candidates);
  const repositoryCappedStructuralCeiling = [...repositories.values()]
    .reduce(
      (sum, repositoryCandidates) =>
        sum + Math.min(REPOSITORY_CAP, repositoryCandidates.length),
      0,
    );

  return frameSchema.parse({
    artifactKind: "c6-source-expansion-screening-frame",
    boundary: {
      acceptedEpisodeCount: 0,
      adaptiveProspective: true,
      candidateManifestFrozen: false,
      captureAttemptCompletenessProven: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      status:
        "combined-structural-screening-frame-semantic-and-machine-qualification-required",
      structuralCapacityOnly: true,
    },
    candidates,
    counts: {
      combinedStructuralCandidateCount: candidates.length,
      exactStructuralCandidateCount: exactCandidates.length,
      legacyCandidateCount: legacyCandidates.length,
      minimumRequiredEpisodes: MINIMUM_REQUIRED_EPISODES,
      missingRestClosureCount: results.filter((result) =>
        result.status === "missing-rest-closure"
      ).length,
      noExactStructuralSequenceCount: results.filter((result) =>
        result.status === "no-exact-structural-sequence"
      ).length,
      qualificationTargetCount: results.length,
      rawStructuralMargin:
        repositoryCappedStructuralCeiling - MINIMUM_REQUIRED_EPISODES,
      repositoryCappedStructuralCeiling,
      repositoryCount: repositories.size,
    },
    independenceBoundary: {
      adaptiveProspective: true,
      candidateProjectionSha256: sha256(JSON.stringify(candidates)),
      exactCandidateProjectionSha256:
        sha256(JSON.stringify(exactCandidates)),
      legacyCandidateProjectionSha256:
        legacyFrame.independenceBoundary.candidateProjectionSha256,
      legacyOrderPreserved: true,
      machineOutcomeInput: false,
      personnelOutcomeBlindnessClaimed: false,
      prospectiveTrancheAppendedAfterLegacyFrame: true,
      selectionDependsOnForbiddenFields: false,
      semanticLedgerInput: false,
    },
    inputs: {
      inventory: reference(
        inventoryBytes,
        input.inventoryPath,
      ),
      legacyFrame: {
        ...reference(legacyFrameBytes, input.legacyFramePath),
        candidateProjectionSha256:
          legacyFrame.independenceBoundary.candidateProjectionSha256,
      },
      restQualification: {
        ...reference(qualificationBytes, input.qualificationPath),
        ...qualification.inputs,
      },
    },
    policy: {
      canonicalIdentity:
        "lowercase-resolved-repository-plus-pull-number",
      exactV2Eligibility:
        "exact-structural-candidate-from-frozen-rest-qualification",
      forbiddenSelectionInputs: [
        "sourceTestSignals",
        "patch",
        "test",
        "gold",
        "outcome",
        "semanticScreeningDecision",
        "machineQualificationDecision",
      ],
      order:
        "complete-legacy-screeningRank-then-exact-v2-restCaptureOrder",
      repositoryCap: REPOSITORY_CAP,
    },
    schemaVersion: 1,
  });
}

export function deriveC6SourceExpansionScreeningFrameCapacity(input: {
  frame: C6SourceExpansionScreeningFrame;
  rejectedRequestedAnchorIds: readonly string[];
}): C6SourceExpansionScreeningFrameCapacity {
  const frame = frameSchema.parse(input.frame);
  const candidatesByRequestedAnchor = new Map(
    frame.candidates.map((candidate) => [
      candidate.requestedAnchorId,
      candidate,
    ]),
  );
  const rejected = new Set<string>();
  for (const anchorId of input.rejectedRequestedAnchorIds) {
    if (!candidatesByRequestedAnchor.has(anchorId)) {
      throw new Error(
        `C6 source-expansion frame unknown rejected candidate ${anchorId}`,
      );
    }
    if (rejected.has(anchorId)) {
      throw new Error(
        `C6 source-expansion frame duplicate rejected candidate ${anchorId}`,
      );
    }
    rejected.add(anchorId);
  }
  const remaining = frame.candidates.filter((candidate) =>
    !rejected.has(candidate.requestedAnchorId)
  );
  const repositoryCappedStructuralCeiling = [
    ...groupByRepository(remaining).values(),
  ].reduce(
    (sum, repositoryCandidates) =>
      sum + Math.min(REPOSITORY_CAP, repositoryCandidates.length),
    0,
  );
  return {
    canMeetMinimumUnderRepositoryCap:
      repositoryCappedStructuralCeiling >= MINIMUM_REQUIRED_EPISODES,
    definitivelyRejectedCandidateCount: rejected.size,
    minimumRequiredEpisodes: MINIMUM_REQUIRED_EPISODES,
    remainingStructuralCandidateCount: remaining.length,
    repositoryCappedStructuralCeiling,
    selectableMargin:
      repositoryCappedStructuralCeiling - MINIMUM_REQUIRED_EPISODES,
  };
}

export function serializeC6SourceExpansionScreeningFrame(
  frame: C6SourceExpansionScreeningFrame,
): string {
  return `${JSON.stringify(frameSchema.parse(frame), null, 2)}\n`;
}

export async function materializeC6SourceExpansionScreeningFrame(input: {
  expectedInventorySha256: string;
  expectedLegacyFrameSha256: string;
  expectedQualificationSha256: string;
  inventoryPath: string;
  legacyFramePath: string;
  outputPath: string;
  qualificationPath: string;
}): Promise<{
  frame: C6SourceExpansionScreeningFrame;
  outputSha256: string;
}> {
  const expected = {
    inventory: sha256Schema.parse(input.expectedInventorySha256),
    legacyFrame: sha256Schema.parse(input.expectedLegacyFrameSha256),
    qualification: sha256Schema.parse(input.expectedQualificationSha256),
  };
  const [inventoryPath, legacyFramePath, qualificationPath] =
    await Promise.all([
      assertC6NoSymlinkPathComponents(
        input.inventoryPath,
        "C6 source-expansion frame inventory",
      ),
      assertC6NoSymlinkPathComponents(
        input.legacyFramePath,
        "C6 source-expansion frame legacy frame",
      ),
      assertC6NoSymlinkPathComponents(
        input.qualificationPath,
        "C6 source-expansion frame REST qualification",
      ),
    ]);
  const [inventoryBytes, legacyFrameBytes, qualificationBytes] =
    await Promise.all([
      readC6StableRegularFile(inventoryPath, "source-expansion inventory"),
      readC6StableRegularFile(legacyFramePath, "source-expansion legacy frame"),
      readC6StableRegularFile(
        qualificationPath,
        "source-expansion REST qualification",
      ),
    ]);
  assertExpectedHashes(expected, {
    inventory: inventoryBytes,
    legacyFrame: legacyFrameBytes,
    qualification: qualificationBytes,
  });
  const frame = projectC6SourceExpansionScreeningFrame({
    inventoryBytes,
    inventoryPath,
    legacyFrameBytes,
    legacyFramePath,
    qualificationBytes,
    qualificationPath,
  });
  const [terminalInventory, terminalLegacyFrame, terminalQualification] =
    await Promise.all([
      readC6StableRegularFile(
        inventoryPath,
        "source-expansion terminal inventory",
      ),
      readC6StableRegularFile(
        legacyFramePath,
        "source-expansion terminal legacy frame",
      ),
      readC6StableRegularFile(
        qualificationPath,
        "source-expansion terminal REST qualification",
      ),
    ]);
  assertExpectedHashes(expected, {
    inventory: terminalInventory,
    legacyFrame: terminalLegacyFrame,
    qualification: terminalQualification,
  });
  const serialized = serializeC6SourceExpansionScreeningFrame(frame);
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 source-expansion frame output parent",
  );
  const handle = await open(outputPath, "wx", 0o644);
  try {
    await handle.writeFile(serialized, "utf8");
  } finally {
    await handle.close();
  }
  return {
    frame,
    outputSha256: sha256(serialized),
  };
}

export async function replayC6SourceExpansionScreeningFrame(input: {
  expectedFrameSha256: string;
  expectedInventorySha256: string;
  expectedLegacyFrameSha256: string;
  expectedQualificationSha256: string;
  framePath: string;
  inventoryPath: string;
  legacyFramePath: string;
  qualificationPath: string;
}): Promise<{
  frame: C6SourceExpansionScreeningFrame;
  reproduced: true;
}> {
  const [
    frameBytes,
    inventoryBytes,
    legacyFrameBytes,
    qualificationBytes,
  ] = await Promise.all([
    readC6StableRegularFile(
      await assertC6NoSymlinkPathComponents(
        input.framePath,
        "C6 source-expansion frame artifact",
      ),
      "source-expansion frame artifact",
    ),
    readC6StableRegularFile(
      await assertC6NoSymlinkPathComponents(
        input.inventoryPath,
        "C6 source-expansion frame inventory",
      ),
      "source-expansion frame inventory",
    ),
    readC6StableRegularFile(
      await assertC6NoSymlinkPathComponents(
        input.legacyFramePath,
        "C6 source-expansion frame legacy frame",
      ),
      "source-expansion frame legacy frame",
    ),
    readC6StableRegularFile(
      await assertC6NoSymlinkPathComponents(
        input.qualificationPath,
        "C6 source-expansion frame qualification",
      ),
      "source-expansion frame qualification",
    ),
  ]);
  const expected = {
    frame: sha256Schema.parse(input.expectedFrameSha256),
    inventory: sha256Schema.parse(input.expectedInventorySha256),
    legacyFrame: sha256Schema.parse(input.expectedLegacyFrameSha256),
    qualification: sha256Schema.parse(input.expectedQualificationSha256),
  };
  assertExpectedHashes(expected, {
    frame: frameBytes,
    inventory: inventoryBytes,
    legacyFrame: legacyFrameBytes,
    qualification: qualificationBytes,
  });
  const frame = projectC6SourceExpansionScreeningFrame({
    inventoryBytes,
    inventoryPath: input.inventoryPath,
    legacyFrameBytes,
    legacyFramePath: input.legacyFramePath,
    qualificationBytes,
    qualificationPath: input.qualificationPath,
  });
  if (serializeC6SourceExpansionScreeningFrame(frame) !==
    frameBytes.toString("utf8")) {
    throw new Error("C6 source-expansion screening frame replay mismatch");
  }
  return { frame, reproduced: true };
}

function assertQualificationCounts(
  qualification: z.infer<typeof qualificationSchema>,
  results: readonly z.infer<typeof qualificationResultSchema>[],
): void {
  if (results.length !== qualification.counts.targetCount) {
    throw new Error(
      "C6 source-expansion frame qualification count mismatch",
    );
  }
  const missing = results.filter((result) =>
    result.status === "missing-rest-closure"
  );
  const exact = results.filter((result) =>
    result.status === "exact-structural-candidate"
  );
  const repositories = groupCanonicalAnchors(exact.map((result) =>
    result.canonicalAnchorId
  ));
  const ceiling = [...repositories.values()].reduce(
    (sum, count) => sum + Math.min(REPOSITORY_CAP, count),
    0,
  );
  if (
    qualification.counts.missingClosureCount !== missing.length ||
    qualification.counts.capturedClosureCount !==
      results.length - missing.length ||
    qualification.counts.exactStructuralCandidateCount !== exact.length ||
    qualification.counts.exactStructuralRepositoryCount !==
      repositories.size ||
    qualification.counts.repositoryCappedStructuralCeiling !== ceiling
  ) {
    throw new Error(
      "C6 source-expansion frame qualification count mismatch",
    );
  }
}

function assertContiguousRanks(
  ranks: readonly number[],
  label: string,
): void {
  const ordered = [...ranks].sort((left, right) => left - right);
  if (
    ordered.length === 0 ||
    ordered.some((rank, index) => rank !== index + 1)
  ) {
    throw new Error(
      `C6 source-expansion frame ${label} must be contiguous`,
    );
  }
}

function assertUniqueCandidates(
  candidates: readonly z.infer<typeof candidateSchema>[],
): void {
  const canonical = new Set<string>();
  const requested = new Set<string>();
  for (const candidate of candidates) {
    if (
      canonical.has(candidate.canonicalAnchorId) ||
      requested.has(candidate.requestedAnchorId)
    ) {
      throw new Error(
        "C6 source-expansion frame canonical candidate collision",
      );
    }
    canonical.add(candidate.canonicalAnchorId);
    requested.add(candidate.requestedAnchorId);
  }
}

function buildInventoryIndex(
  entries: readonly z.infer<typeof inventoryEntrySchema>[],
): Map<string, z.infer<typeof inventoryEntrySchema>> {
  const result = new Map<string, z.infer<typeof inventoryEntrySchema>>();
  for (const entry of entries) {
    const key = entry.anchorId.toLowerCase();
    if (result.has(key)) {
      throw new Error(
        `C6 source-expansion frame duplicate inventory anchor ${
          entry.anchorId
        }`,
      );
    }
    result.set(key, entry);
  }
  return result;
}

function groupByRepository(
  candidates: readonly z.infer<typeof candidateSchema>[],
): Map<string, z.infer<typeof candidateSchema>[]> {
  const result = new Map<string, z.infer<typeof candidateSchema>[]>();
  for (const candidate of candidates) {
    const group = result.get(candidate.canonicalRepository) ?? [];
    group.push(candidate);
    result.set(candidate.canonicalRepository, group);
  }
  return result;
}

function groupCanonicalAnchors(
  anchors: readonly string[],
): Map<string, number> {
  const result = new Map<string, number>();
  for (const anchor of anchors) {
    const repository = parseAnchor(anchor).repository;
    result.set(repository, (result.get(repository) ?? 0) + 1);
  }
  return result;
}

function parseAnchor(value: string): {
  pullNumber: number;
  repository: string;
} {
  const match = /^([^/#]+\/[^/#]+)#([1-9]\d*)$/u.exec(value);
  if (match === null) {
    throw new Error(`C6 source-expansion frame invalid anchor ${value}`);
  }
  return {
    pullNumber: Number(match[2]),
    repository: normalizeRepository(match[1]!),
  };
}

function normalizeRepository(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[^/#]+\/[^/#]+$/u.test(normalized)) {
    throw new Error(
      `C6 source-expansion frame invalid repository ${value}`,
    );
  }
  return normalized;
}

function reference(
  bytes: Buffer,
  path: string,
): {
  bytes: number;
  path: string;
  sha256: string;
} {
  return {
    bytes: bytes.byteLength,
    path: basename(resolve(path)),
    sha256: sha256(bytes),
  };
}

function assertExpectedHashes(
  expected: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, Uint8Array>>,
): void {
  for (const [name, expectedSha256] of Object.entries(expected)) {
    const bytes = actual[name];
    if (bytes === undefined || sha256(bytes) !== expectedSha256) {
      throw new Error(
        `C6 source-expansion frame ${name} hash mismatch`,
      );
    }
  }
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(`C6 source-expansion frame invalid ${label} JSON`);
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
