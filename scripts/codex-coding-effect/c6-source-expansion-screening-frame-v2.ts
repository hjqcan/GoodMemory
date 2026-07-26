import { createHash, randomUUID } from "node:crypto";
import {
  link,
  open,
  rm,
} from "node:fs/promises";
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
const priorCandidateSchema = z.object({
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
const candidateSchema = priorCandidateSchema.extend({
  sourceTranche: z.enum([
    "legacy-screening-frame-v1",
    "prospective-rest-exact-v2",
    "prospective-rest-identity-supplement-v1",
  ]),
}).strict();
const priorFrameSchema = z.object({
  artifactKind: z.literal("c6-source-expansion-screening-frame"),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
    structuralCapacityOnly: z.literal(true),
  }).passthrough(),
  candidates: z.array(priorCandidateSchema).min(1),
  counts: z.object({
    combinedStructuralCandidateCount: z.number().int().positive(),
    exactStructuralCandidateCount: z.number().int().nonnegative(),
    legacyCandidateCount: z.number().int().positive(),
    minimumRequiredEpisodes: z.literal(MINIMUM_REQUIRED_EPISODES),
    repositoryCappedStructuralCeiling: z.number().int().nonnegative(),
    repositoryCount: z.number().int().positive(),
  }).passthrough(),
  independenceBoundary: z.object({
    candidateProjectionSha256: sha256Schema,
    machineOutcomeInput: z.literal(false),
    selectionDependsOnForbiddenFields: z.literal(false),
    semanticLedgerInput: z.literal(false),
  }).passthrough(),
  inputs: z.object({
    restQualification: z.object({
      capturePlanSha256: sha256Schema,
      graphqlRootSha256: sha256Schema,
      restRootSha256: sha256Schema,
      sha256: sha256Schema,
    }).passthrough(),
  }).passthrough(),
  schemaVersion: z.literal(1),
}).passthrough();
const qualificationResultSchema = z.object({
  anchorId: z.string().min(1),
  canonicalAnchorId: z.string().min(1),
  captureDirectory: z.string().min(1),
  captureManifestSha256: sha256Schema.optional(),
  captureOrder: z.number().int().positive(),
  exactEventCount: z.number().int().nonnegative().optional(),
  exactLineageIdentitySha256: sha256Schema.optional(),
  qualificationSource: z.enum([
    "full-rest-v1",
    "pull-identity-supplement-v1",
  ]),
  source: sourceSchema,
  status: z.enum([
    "exact-structural-candidate",
    "no-exact-structural-sequence",
  ]),
  supplementManifestSha256: sha256Schema.optional(),
}).passthrough();
const qualificationSchema = z.object({
  artifactKind: z.literal(
    "c6-source-expansion-rest-qualification-v2",
  ),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
    originalFullRestCaptureAttemptCompletenessProven: z.literal(false),
    pullIdentitySupplementClosureComplete: z.literal(true),
    status: z.literal(
      "exact-structural-screening-complete-semantic-qualification-required",
    ),
  }).strict(),
  counts: z.object({
    exactStructuralCandidateCount: z.number().int().nonnegative(),
    exactStructuralRepositoryCount: z.number().int().nonnegative(),
    fullRestClosureCount: z.number().int().nonnegative(),
    identitySupplementClosureCount: z.number().int().nonnegative(),
    missingClosureCount: z.literal(0),
    noExactStructuralSequenceCount: z.number().int().nonnegative(),
    repositoryCappedStructuralCeiling: z.number().int().nonnegative(),
    targetCount: z.number().int().positive(),
  }).strict(),
  inputs: z.object({
    capturePlanSha256: sha256Schema,
    graphqlRootSha256: sha256Schema,
    originalQualificationSha256: sha256Schema,
    originalRestRootSha256: sha256Schema,
    supplementPlanSha256: sha256Schema,
    supplementRootSha256: sha256Schema,
  }).strict(),
  results: z.array(qualificationResultSchema).min(1),
  schemaVersion: z.literal(2),
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
    codexRunReady: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
    originalFullRestCaptureAttemptCompletenessProven: z.literal(false),
    pullIdentitySupplementClosureComplete: z.literal(true),
    status: z.literal(
      "combined-structural-screening-frame-semantic-and-machine-qualification-required",
    ),
    structuralCapacityOnly: z.literal(true),
  }).strict(),
  candidates: z.array(candidateSchema).min(1),
  counts: z.object({
    combinedStructuralCandidateCount: z.number().int().positive(),
    identitySupplementCandidateCount: z.number().int().nonnegative(),
    legacyCandidateCount: z.number().int().positive(),
    minimumRequiredEpisodes: z.literal(MINIMUM_REQUIRED_EPISODES),
    missingFullRestClosureCount: z.number().int().nonnegative(),
    missingRequiredIdentityClosureCount: z.literal(0),
    noExactStructuralSequenceCount: z.number().int().nonnegative(),
    priorFrameCandidateCount: z.number().int().positive(),
    priorRestExactCandidateCount: z.number().int().nonnegative(),
    qualificationExactStructuralCandidateCount:
      z.number().int().nonnegative(),
    qualificationTargetCount: z.number().int().positive(),
    rawStructuralMargin: z.number().int(),
    repositoryCappedStructuralCeiling: z.number().int().nonnegative(),
    repositoryCount: z.number().int().positive(),
  }).strict(),
  independenceBoundary: z.object({
    adaptiveProspective: z.literal(true),
    candidateProjectionSha256: sha256Schema,
    identitySupplementCandidateProjectionSha256: sha256Schema,
    machineOutcomeInput: z.literal(false),
    personnelOutcomeBlindnessClaimed: z.literal(false),
    priorFrameCandidateProjectionSha256: sha256Schema,
    priorFrameOrderPreserved: z.literal(true),
    prospectiveTrancheAppendedAfterPriorFrame: z.literal(true),
    selectionDependsOnForbiddenFields: z.literal(false),
    semanticLedgerInput: z.literal(false),
  }).strict(),
  inputs: z.object({
    priorFrame: referenceSchema.extend({
      candidateProjectionSha256: sha256Schema,
    }),
    restQualification: referenceSchema.extend({
      capturePlanSha256: sha256Schema,
      graphqlRootSha256: sha256Schema,
      originalQualificationSha256: sha256Schema,
      originalRestRootSha256: sha256Schema,
      supplementPlanSha256: sha256Schema,
      supplementRootSha256: sha256Schema,
    }),
  }).strict(),
  policy: z.object({
    canonicalIdentity: z.literal(
      "lowercase-resolved-repository-plus-pull-number",
    ),
    identitySupplementEligibility: z.literal(
      "exact-pull-identity-supplement-candidate-absent-from-hash-bound-prior-frame",
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
      "complete-prior-frame-screeningRank-then-new-identity-supplement-restCaptureOrder",
    ),
    repositoryCap: z.literal(REPOSITORY_CAP),
  }).strict(),
  schemaVersion: z.literal(2),
}).strict();

export type C6SourceExpansionScreeningFrameV2 =
  z.infer<typeof frameSchema>;

export interface C6SourceExpansionScreeningFrameV2Capacity {
  canMeetMinimumUnderRepositoryCap: boolean;
  definitivelyRejectedCandidateCount: number;
  minimumRequiredEpisodes: number;
  remainingStructuralCandidateCount: number;
  repositoryCappedStructuralCeiling: number;
  selectableMargin: number;
}

export function projectC6SourceExpansionScreeningFrameV2(input: {
  priorFrameBytes: Uint8Array;
  priorFramePath: string;
  qualificationBytes: Uint8Array;
  qualificationPath: string;
}): C6SourceExpansionScreeningFrameV2 {
  const priorFrameBytes = Buffer.from(input.priorFrameBytes);
  const qualificationBytes = Buffer.from(input.qualificationBytes);
  const rawPriorFrame = parseJson(priorFrameBytes, "prior frame");
  const priorFrame = priorFrameSchema.parse(rawPriorFrame);
  if (
    priorFrame.candidates.length !==
      priorFrame.counts.combinedStructuralCandidateCount ||
    sha256(JSON.stringify(
      (rawPriorFrame as { candidates: unknown }).candidates,
    )) !== priorFrame.independenceBoundary.candidateProjectionSha256
  ) {
    throw new Error(
      "C6 source-expansion frame v2 prior candidate projection mismatch",
    );
  }
  assertContiguousRanks(
    priorFrame.candidates.map((candidate) => candidate.screeningRank),
    "prior screening rank",
  );
  assertPriorFrameCounts(priorFrame);
  if (
    sha256(JSON.stringify(priorFrame.candidates)) !==
      priorFrame.independenceBoundary.candidateProjectionSha256
  ) {
    throw new Error(
      "C6 source-expansion frame v2 prior output-prefix projection mismatch",
    );
  }

  const qualification = qualificationSchema.parse(
    parseJson(qualificationBytes, "REST qualification v2"),
  );
  const priorQualification = priorFrame.inputs.restQualification;
  if (
    qualification.inputs.originalQualificationSha256 !==
      priorQualification.sha256 ||
    qualification.inputs.capturePlanSha256 !==
      priorQualification.capturePlanSha256 ||
    qualification.inputs.graphqlRootSha256 !==
      priorQualification.graphqlRootSha256 ||
    qualification.inputs.originalRestRootSha256 !==
      priorQualification.restRootSha256
  ) {
    throw new Error(
      "C6 source-expansion frame v2 qualification lineage mismatch",
    );
  }
  const results = [...qualification.results].sort(
    (left, right) => left.captureOrder - right.captureOrder,
  );
  assertContiguousRanks(
    results.map((result) => result.captureOrder),
    "REST capture order",
  );
  assertQualificationCounts(qualification, results);

  const priorCandidates = [...priorFrame.candidates];
  const priorByRequestedAnchor = new Map(
    priorCandidates.map((candidate) => [
      candidate.requestedAnchorId,
      candidate,
    ]),
  );
  const priorExactCandidates = priorCandidates.filter((candidate) =>
    candidate.sourceTranche === "prospective-rest-exact-v2"
  );
  const fullRestExact = results.filter((result) =>
    result.status === "exact-structural-candidate" &&
    result.qualificationSource === "full-rest-v1"
  );
  if (fullRestExact.length !== priorExactCandidates.length) {
    throw new Error(
      "C6 source-expansion frame v2 prior exact candidate mismatch",
    );
  }
  for (const result of fullRestExact) {
    const projected = projectExactCandidate(result);
    const prior = priorByRequestedAnchor.get(projected.requestedAnchorId);
    if (
      prior === undefined ||
      prior.sourceTranche !== "prospective-rest-exact-v2" ||
      priorCandidateIdentity(prior) !==
        priorCandidateIdentity(projected)
    ) {
      throw new Error(
        "C6 source-expansion frame v2 prior exact candidate mismatch",
      );
    }
  }
  const identitySupplementCandidates = results
    .filter((result) =>
      result.status === "exact-structural-candidate" &&
      result.qualificationSource === "pull-identity-supplement-v1"
    )
    .map((result, index) => {
      const projected = projectExactCandidate(result);
      if (
        priorByRequestedAnchor.has(projected.requestedAnchorId) ||
        priorCandidates.some((candidate) =>
          candidate.canonicalAnchorId === projected.canonicalAnchorId
        )
      ) {
        throw new Error(
          "C6 source-expansion frame v2 identity supplement candidate collision",
        );
      }
      return {
        ...projected,
        screeningRank: priorCandidates.length + index + 1,
        sourceTranche:
          "prospective-rest-identity-supplement-v1" as const,
      };
    });
  const candidates = [
    ...priorCandidates,
    ...identitySupplementCandidates,
  ];
  assertUniqueCandidates(candidates);
  const repositories = groupByRepository(candidates);
  const repositoryCappedStructuralCeiling =
    repositoryCappedCeiling(repositories);
  const exactCount = results.filter((result) =>
    result.status === "exact-structural-candidate"
  ).length;

  return frameSchema.parse({
    artifactKind: "c6-source-expansion-screening-frame",
    boundary: {
      acceptedEpisodeCount: 0,
      adaptiveProspective: true,
      candidateManifestFrozen: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      originalFullRestCaptureAttemptCompletenessProven: false,
      pullIdentitySupplementClosureComplete: true,
      status:
        "combined-structural-screening-frame-semantic-and-machine-qualification-required",
      structuralCapacityOnly: true,
    },
    candidates,
    counts: {
      combinedStructuralCandidateCount: candidates.length,
      identitySupplementCandidateCount:
        identitySupplementCandidates.length,
      legacyCandidateCount: priorFrame.counts.legacyCandidateCount,
      minimumRequiredEpisodes: MINIMUM_REQUIRED_EPISODES,
      missingFullRestClosureCount:
        qualification.counts.targetCount -
        qualification.counts.fullRestClosureCount,
      missingRequiredIdentityClosureCount:
        qualification.counts.missingClosureCount,
      noExactStructuralSequenceCount: results.length - exactCount,
      priorFrameCandidateCount: priorCandidates.length,
      priorRestExactCandidateCount: priorExactCandidates.length,
      qualificationExactStructuralCandidateCount: exactCount,
      qualificationTargetCount: results.length,
      rawStructuralMargin:
        repositoryCappedStructuralCeiling - MINIMUM_REQUIRED_EPISODES,
      repositoryCappedStructuralCeiling,
      repositoryCount: repositories.size,
    },
    independenceBoundary: {
      adaptiveProspective: true,
      candidateProjectionSha256: sha256(JSON.stringify(candidates)),
      identitySupplementCandidateProjectionSha256:
        sha256(JSON.stringify(identitySupplementCandidates)),
      machineOutcomeInput: false,
      personnelOutcomeBlindnessClaimed: false,
      priorFrameCandidateProjectionSha256:
        priorFrame.independenceBoundary.candidateProjectionSha256,
      priorFrameOrderPreserved: true,
      prospectiveTrancheAppendedAfterPriorFrame: true,
      selectionDependsOnForbiddenFields: false,
      semanticLedgerInput: false,
    },
    inputs: {
      priorFrame: {
        ...reference(priorFrameBytes, input.priorFramePath),
        candidateProjectionSha256:
          priorFrame.independenceBoundary.candidateProjectionSha256,
      },
      restQualification: {
        ...reference(qualificationBytes, input.qualificationPath),
        ...qualification.inputs,
      },
    },
    policy: {
      canonicalIdentity:
        "lowercase-resolved-repository-plus-pull-number",
      identitySupplementEligibility:
        "exact-pull-identity-supplement-candidate-absent-from-hash-bound-prior-frame",
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
        "complete-prior-frame-screeningRank-then-new-identity-supplement-restCaptureOrder",
      repositoryCap: REPOSITORY_CAP,
    },
    schemaVersion: 2,
  });
}

export function deriveC6SourceExpansionScreeningFrameV2Capacity(input: {
  frame: C6SourceExpansionScreeningFrameV2;
  rejectedRequestedAnchorIds: readonly string[];
}): C6SourceExpansionScreeningFrameV2Capacity {
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
        `C6 source-expansion frame v2 unknown rejected candidate ${anchorId}`,
      );
    }
    if (rejected.has(anchorId)) {
      throw new Error(
        `C6 source-expansion frame v2 duplicate rejected candidate ${anchorId}`,
      );
    }
    rejected.add(anchorId);
  }
  const remaining = frame.candidates.filter((candidate) =>
    !rejected.has(candidate.requestedAnchorId)
  );
  const repositoryCappedStructuralCeiling =
    repositoryCappedCeiling(groupByRepository(remaining));
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

export function serializeC6SourceExpansionScreeningFrameV2(
  frame: C6SourceExpansionScreeningFrameV2,
): string {
  return `${JSON.stringify(frameSchema.parse(frame), null, 2)}\n`;
}

export async function materializeC6SourceExpansionScreeningFrameV2(input: {
  expectedPriorFrameSha256: string;
  expectedQualificationSha256: string;
  outputPath: string;
  priorFramePath: string;
  qualificationPath: string;
}): Promise<{
  frame: C6SourceExpansionScreeningFrameV2;
  outputSha256: string;
}> {
  const expected = {
    priorFrame: sha256Schema.parse(input.expectedPriorFrameSha256),
    qualification: sha256Schema.parse(input.expectedQualificationSha256),
  };
  const [priorFramePath, qualificationPath] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.priorFramePath,
      "C6 source-expansion frame v2 prior frame",
    ),
    assertC6NoSymlinkPathComponents(
      input.qualificationPath,
      "C6 source-expansion frame v2 REST qualification",
    ),
  ]);
  const [priorFrameBytes, qualificationBytes] = await Promise.all([
    readC6StableRegularFile(
      priorFramePath,
      "source-expansion frame v2 prior frame",
    ),
    readC6StableRegularFile(
      qualificationPath,
      "source-expansion frame v2 REST qualification",
    ),
  ]);
  assertExpectedHashes(expected, { priorFrameBytes, qualificationBytes });
  const frame = projectC6SourceExpansionScreeningFrameV2({
    priorFrameBytes,
    priorFramePath,
    qualificationBytes,
    qualificationPath,
  });
  const [terminalPriorFrame, terminalQualification] = await Promise.all([
    readC6StableRegularFile(
      priorFramePath,
      "source-expansion frame v2 terminal prior frame",
    ),
    readC6StableRegularFile(
      qualificationPath,
      "source-expansion frame v2 terminal REST qualification",
    ),
  ]);
  if (
    !terminalPriorFrame.equals(priorFrameBytes) ||
    !terminalQualification.equals(qualificationBytes)
  ) {
    throw new Error(
      "C6 source-expansion frame v2 input changed during projection",
    );
  }
  const serialized = serializeC6SourceExpansionScreeningFrameV2(frame);
  const outputPath = resolve(input.outputPath);
  const outputParent = await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 source-expansion frame v2 output parent",
  );
  const temporaryPath = resolve(
    outputParent,
    `.${basename(outputPath)}.incomplete-${randomUUID()}`,
  );
  let published = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o644);
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const temporaryBytes = await readC6StableRegularFile(
      temporaryPath,
      "source-expansion frame v2 temporary output",
    );
    if (temporaryBytes.toString("utf8") !== serialized) {
      throw new Error(
        "C6 source-expansion frame v2 temporary output mismatch",
      );
    }
    await assertC6NoSymlinkPathComponents(
      outputParent,
      "C6 source-expansion frame v2 terminal output parent",
    );
    await link(temporaryPath, outputPath);
    published = true;
    const publishedBytes = await readC6StableRegularFile(
      outputPath,
      "source-expansion frame v2 published output",
    );
    if (publishedBytes.toString("utf8") !== serialized) {
      throw new Error(
        "C6 source-expansion frame v2 published output mismatch",
      );
    }
    await rm(temporaryPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    if (published) {
      await rm(outputPath, { force: true });
    }
    throw error;
  }
  return {
    frame,
    outputSha256: sha256(serialized),
  };
}

export async function replayC6SourceExpansionScreeningFrameV2(input: {
  expectedFrameSha256: string;
  expectedPriorFrameSha256: string;
  expectedQualificationSha256: string;
  framePath: string;
  priorFramePath: string;
  qualificationPath: string;
}): Promise<{
  frame: C6SourceExpansionScreeningFrameV2;
  reproduced: true;
}> {
  const paths = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.framePath,
      "C6 source-expansion frame v2 artifact",
    ),
    assertC6NoSymlinkPathComponents(
      input.priorFramePath,
      "C6 source-expansion frame v2 prior frame",
    ),
    assertC6NoSymlinkPathComponents(
      input.qualificationPath,
      "C6 source-expansion frame v2 qualification",
    ),
  ]);
  const [framePath, priorFramePath, qualificationPath] = paths;
  const [frameBytes, priorFrameBytes, qualificationBytes] =
    await Promise.all([
      readC6StableRegularFile(
        framePath,
        "source-expansion frame v2 artifact",
      ),
      readC6StableRegularFile(
        priorFramePath,
        "source-expansion frame v2 prior frame",
      ),
      readC6StableRegularFile(
        qualificationPath,
        "source-expansion frame v2 qualification",
      ),
    ]);
  assertExpectedHashes({
    priorFrame: sha256Schema.parse(input.expectedPriorFrameSha256),
    qualification: sha256Schema.parse(input.expectedQualificationSha256),
  }, { priorFrameBytes, qualificationBytes });
  if (sha256(frameBytes) !== sha256Schema.parse(input.expectedFrameSha256)) {
    throw new Error("C6 source-expansion frame v2 frame hash mismatch");
  }
  const frame = projectC6SourceExpansionScreeningFrameV2({
    priorFrameBytes,
    priorFramePath,
    qualificationBytes,
    qualificationPath,
  });
  if (
    serializeC6SourceExpansionScreeningFrameV2(frame) !==
      frameBytes.toString("utf8")
  ) {
    throw new Error(
      "C6 source-expansion screening frame v2 replay mismatch",
    );
  }
  const [terminalFrame, terminalPriorFrame, terminalQualification] =
    await Promise.all([
      readC6StableRegularFile(
        framePath,
        "source-expansion frame v2 terminal artifact",
      ),
      readC6StableRegularFile(
        priorFramePath,
        "source-expansion frame v2 terminal prior frame",
      ),
      readC6StableRegularFile(
        qualificationPath,
        "source-expansion frame v2 terminal qualification",
      ),
    ]);
  if (
    !terminalFrame.equals(frameBytes) ||
    !terminalPriorFrame.equals(priorFrameBytes) ||
    !terminalQualification.equals(qualificationBytes)
  ) {
    throw new Error(
      "C6 source-expansion frame v2 input changed during replay",
    );
  }
  return { frame, reproduced: true };
}

function projectExactCandidate(
  result: z.infer<typeof qualificationResultSchema>,
): z.infer<typeof priorCandidateSchema> {
  if (
    result.status !== "exact-structural-candidate" ||
    result.exactLineageIdentitySha256 === undefined
  ) {
    throw new Error(
      "C6 source-expansion frame v2 exact candidate is incomplete",
    );
  }
  const requested = parseAnchor(result.anchorId);
  const canonical = parseAnchor(result.canonicalAnchorId);
  return {
    canonicalAnchorId:
      `${canonical.repository}#${canonical.pullNumber}`,
    canonicalRepository: canonical.repository,
    lineageIdentitySha256: result.exactLineageIdentitySha256,
    requestedAnchorId:
      `${requested.repository}#${requested.pullNumber}`,
    screeningRank: result.captureOrder,
    source: result.source,
    sourceRank: result.captureOrder,
    sourceTranche: "prospective-rest-exact-v2",
  };
}

function assertPriorFrameCounts(
  frame: z.infer<typeof priorFrameSchema>,
): void {
  const legacy = frame.candidates.filter((candidate) =>
    candidate.sourceTranche === "legacy-screening-frame-v1"
  );
  const exact = frame.candidates.length - legacy.length;
  const repositories = groupByRepository(frame.candidates);
  if (
    frame.counts.legacyCandidateCount !== legacy.length ||
    frame.counts.exactStructuralCandidateCount !== exact ||
    frame.counts.repositoryCount !== repositories.size ||
    frame.counts.repositoryCappedStructuralCeiling !==
      repositoryCappedCeiling(repositories)
  ) {
    throw new Error(
      "C6 source-expansion frame v2 prior frame count mismatch",
    );
  }
  assertUniqueCandidates(frame.candidates);
}

function assertQualificationCounts(
  qualification: z.infer<typeof qualificationSchema>,
  results: readonly z.infer<typeof qualificationResultSchema>[],
): void {
  const exact = results.filter((result) =>
    result.status === "exact-structural-candidate"
  );
  const fullRest = results.filter((result) =>
    result.qualificationSource === "full-rest-v1"
  );
  const supplement = results.filter((result) =>
    result.qualificationSource === "pull-identity-supplement-v1"
  );
  const repositories = groupCanonicalAnchors(exact.map((result) =>
    result.canonicalAnchorId
  ));
  const provenanceInvalid = results.some((result) =>
    result.qualificationSource === "full-rest-v1"
      ? result.captureManifestSha256 === undefined ||
        result.supplementManifestSha256 !== undefined
      : result.supplementManifestSha256 === undefined ||
        result.captureManifestSha256 !== undefined
  );
  if (
    results.length !== qualification.counts.targetCount ||
    exact.length !== qualification.counts.exactStructuralCandidateCount ||
    results.length - exact.length !==
      qualification.counts.noExactStructuralSequenceCount ||
    fullRest.length !== qualification.counts.fullRestClosureCount ||
    supplement.length !==
      qualification.counts.identitySupplementClosureCount ||
    repositories.size !==
      qualification.counts.exactStructuralRepositoryCount ||
    repositoryCappedCeilingCounts(repositories) !==
      qualification.counts.repositoryCappedStructuralCeiling ||
    provenanceInvalid
  ) {
    throw new Error(
      "C6 source-expansion frame v2 qualification count mismatch",
    );
  }
}

function priorCandidateIdentity(
  candidate: z.infer<typeof priorCandidateSchema>,
): string {
  return JSON.stringify({
    canonicalAnchorId: candidate.canonicalAnchorId,
    canonicalRepository: candidate.canonicalRepository,
    lineageIdentitySha256: candidate.lineageIdentitySha256,
    requestedAnchorId: candidate.requestedAnchorId,
    source: candidate.source,
    sourceRank: candidate.sourceRank,
  });
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
      `C6 source-expansion frame v2 ${label} must be contiguous`,
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
        "C6 source-expansion frame v2 canonical candidate collision",
      );
    }
    canonical.add(candidate.canonicalAnchorId);
    requested.add(candidate.requestedAnchorId);
  }
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

function repositoryCappedCeiling(
  repositories: ReadonlyMap<
    string,
    readonly z.infer<typeof candidateSchema>[]
  >,
): number {
  return [...repositories.values()].reduce(
    (sum, candidates) =>
      sum + Math.min(REPOSITORY_CAP, candidates.length),
    0,
  );
}

function repositoryCappedCeilingCounts(
  repositories: ReadonlyMap<string, number>,
): number {
  return [...repositories.values()].reduce(
    (sum, count) => sum + Math.min(REPOSITORY_CAP, count),
    0,
  );
}

function parseAnchor(value: string): {
  pullNumber: number;
  repository: string;
} {
  const match = /^([^/#]+\/[^/#]+)#([1-9]\d*)$/u.exec(value);
  if (match === null) {
    throw new Error(
      `C6 source-expansion frame v2 invalid anchor ${value}`,
    );
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
      `C6 source-expansion frame v2 invalid repository ${value}`,
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
  expected: {
    priorFrame: string;
    qualification: string;
  },
  actual: {
    priorFrameBytes: Uint8Array;
    qualificationBytes: Uint8Array;
  },
): void {
  if (sha256(actual.priorFrameBytes) !== expected.priorFrame) {
    throw new Error(
      "C6 source-expansion frame v2 prior frame hash mismatch",
    );
  }
  if (sha256(actual.qualificationBytes) !== expected.qualification) {
    throw new Error(
      "C6 source-expansion frame v2 qualification hash mismatch",
    );
  }
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(
      `C6 source-expansion frame v2 invalid ${label} JSON`,
    );
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
