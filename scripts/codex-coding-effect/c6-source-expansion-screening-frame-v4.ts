import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";

const MINIMUM_REQUIRED_EPISODES = 48;
const FULL_SCREENING_BUFFER_REQUIRED = 72;
const REPOSITORY_CAP = 4;
const SOURCE_DATASET_ID = "SWE-bench-Live/MultiLang";
const SOURCE_REVISION =
  "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b";
const SOURCE_TRANCHE =
  "swe-bench-live-multilang-608f7ae9-exact-v1";
const SOURCE_SPLITS = {
  c: { count: 37, offset: 0 },
  cpp: { count: 74, offset: 37 },
  go: { count: 138, offset: 111 },
  js: { count: 93, offset: 249 },
  rust: { count: 94, offset: 342 },
  java: { count: 109, offset: 436 },
  ts: { count: 111, offset: 545 },
  cs: { count: 87, offset: 656 },
} as const;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const candidateSchema = z.object({
  canonicalAnchorId: z.string().min(1),
  canonicalRepository: z.string().min(3),
  lineageIdentitySha256: sha256Schema,
  requestedAnchorId: z.string().min(1),
  screeningRank: z.number().int().positive(),
  source: z.unknown(),
  sourceRank: z.number().int().positive(),
  sourceTranche: z.string().min(1),
}).passthrough();
const priorFrameSchema = z.object({
  artifactKind: z.literal("c6-source-expansion-screening-frame"),
  candidates: z.array(candidateSchema).min(1),
  counts: z.object({
    combinedStructuralCandidateCount: z.number().int().positive(),
    repositoryCappedStructuralCeiling: z.number().int().positive(),
    repositoryCount: z.number().int().positive(),
  }).passthrough(),
  independenceBoundary: z.object({
    candidateProjectionSha256: sha256Schema,
  }).passthrough(),
  schemaVersion: z.literal(3),
}).passthrough();
const qualificationResultSchema = z.object({
  agentVisibleRequestSha256: sha256Schema,
  canonicalAnchorId: z.string().min(1),
  canonicalRepository: z.string().min(3),
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
  exactSequence: z.object({}).passthrough().optional(),
  exactSequenceLineageIdentitySha256: sha256Schema.optional(),
  instanceId: z.string().min(1),
  requestedAnchorId: z.string().min(1),
  rowIndex: z.number().int().nonnegative(),
  sourceSplit: z.enum([
    "c",
    "cpp",
    "go",
    "js",
    "rust",
    "java",
    "ts",
    "cs",
  ]),
  sourceSplitRowIndex: z.number().int().nonnegative(),
  status: z.enum([
    "exact-structural-candidate",
    "no-exact-structural-sequence",
    "prior-frame-overlap",
  ]),
}).passthrough();
const qualificationSchema = z.object({
  artifactKind: z.literal(
    "c6-multilingual-source-expansion-qualification",
  ),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
    pullIdentityClosureComplete: z.literal(true),
  }).passthrough(),
  counts: z.object({
    exactFreshCandidateCount: z.number().int().nonnegative(),
    identityClosureCount: z.number().int().positive(),
    noExactFreshSequenceCount: z.number().int().nonnegative(),
    priorFrameOverlapCount: z.number().int().nonnegative(),
    targetCount: z.number().int().positive(),
  }).passthrough(),
  independenceBoundary: z.object({
    exactFreshCandidateProjectionSha256: sha256Schema,
    machineOutcomeInput: z.literal(false),
    semanticLedgerInput: z.literal(false),
  }).passthrough(),
  inputs: z.object({
    expansionSha256: sha256Schema,
  }).passthrough(),
  results: z.array(qualificationResultSchema).min(1),
  schemaVersion: z.literal(1),
  sourceDataset: z.object({
    datasetId: z.literal(SOURCE_DATASET_ID),
    revision: z.literal(SOURCE_REVISION),
  }).strict(),
}).passthrough();

export type C6SourceExpansionScreeningFrameV4Candidate =
  z.infer<typeof candidateSchema>;

export interface C6SourceExpansionScreeningFrameV4 {
  artifactKind: "c6-source-expansion-screening-frame";
  boundary: {
    acceptedEpisodeCount: 0;
    adaptiveProspective: true;
    candidateManifestFrozen: false;
    codexRunReady: false;
    machineQualifiedEpisodeCount: 0;
    status:
      "combined-structural-screening-frame-semantic-and-machine-qualification-required";
    structuralCapacityOnly: true;
  };
  candidates: C6SourceExpansionScreeningFrameV4Candidate[];
  counts: {
    combinedStructuralCandidateCount: number;
    liveMultilangExactCandidateCount: number;
    liveMultilangNoExactSequenceCount: number;
    liveMultilangPriorFrameOverlapCount: number;
    liveMultilangQualificationTargetCount: number;
    minimumRequiredEpisodes: 48;
    priorFrameCandidateCount: number;
    rawStructuralMargin: number;
    repositoryCappedStructuralCeiling: number;
    repositoryCount: number;
  };
  independenceBoundary: {
    adaptiveProspective: true;
    candidateProjectionSha256: string;
    liveMultilangCandidateProjectionSha256: string;
    machineOutcomeInput: false;
    priorFrameCandidateProjectionSha256: string;
    priorFrameOrderPreserved: true;
    prospectiveTrancheAppendedAfterPriorFrame: true;
    semanticLedgerInput: false;
  };
  inputs: {
    liveMultilangQualification: {
      bytes: number;
      exactFreshCandidateProjectionSha256: string;
      expansionSha256: string;
      path: string;
      sha256: string;
    };
    priorFrame: {
      bytes: number;
      candidateProjectionSha256: string;
      path: string;
      sha256: string;
    };
  };
  policy: {
    appendEligibility:
      "fresh-pull-author-exact-candidate-absent-from-complete-v3-frame";
    canonicalIdentity:
      "lowercase-resolved-repository-plus-pull-number";
    forbiddenSelectionInputs: readonly [
      "sourceTestSignals",
      "patch",
      "test",
      "gold",
      "outcome",
      "semanticScreeningDecision",
      "machineQualificationDecision",
    ];
    order:
      "complete-v3-screeningRank-then-live-multilang-captureOrder";
    repositoryCap: 4;
  };
  schemaVersion: 4;
}

export interface C6SourceExpansionScreeningFrameV4Capacity {
  canMeetMinimumUnderRepositoryCap: boolean;
  canStartFullSemanticScreening: boolean;
  definitiveRejectedCandidateCount: number;
  fullScreeningBufferRequired: 72;
  minimumRequiredEpisodes: 48;
  remainingStructuralCandidateCount: number;
  repositoryCappedStructuralCeiling: number;
  selectableMargin: number;
}

export function projectC6SourceExpansionScreeningFrameV4(input: {
  priorFrameBytes: Uint8Array;
  priorFramePath: string;
  qualificationBytes: Uint8Array;
  qualificationPath: string;
}): C6SourceExpansionScreeningFrameV4 {
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
      "C6 source-expansion frame v4 prior candidate projection mismatch",
    );
  }
  assertRanks(priorFrame.candidates);
  assertUniqueCandidates(priorFrame.candidates);
  assertFrameCounts(priorFrame.candidates, priorFrame.counts);

  const qualification = qualificationSchema.parse(
    parseJson(qualificationBytes, "Live multilingual qualification"),
  );
  const results = [...qualification.results];
  assertResultOrder(results);
  assertQualificationCounts(qualification, results);

  const priorCandidates = [...priorFrame.candidates];
  const priorIdentities = candidateIdentities(priorCandidates);
  for (const result of results) {
    const canonical = normalizeAnchor(result.canonicalAnchorId);
    if (
      result.status === "prior-frame-overlap" &&
      !priorIdentities.has(canonical)
    ) {
      throw new Error(
        `C6 source-expansion frame v4 unknown overlap ${canonical}`,
      );
    }
  }

  const exactResults = results.filter((result): result is typeof result & {
    exactSequenceLineageIdentitySha256: string;
    status: "exact-structural-candidate";
  } => result.status === "exact-structural-candidate");
  const liveMultilangCandidates = exactResults.map((result, index) => {
    const canonical = parseAnchor(result.canonicalAnchorId);
    const requested = parseAnchor(result.requestedAnchorId);
    const canonicalAnchor =
      `${canonical.repository}#${canonical.pullNumber}`;
    const requestedAnchor =
      `${requested.repository}#${requested.pullNumber}`;
    if (
      priorIdentities.has(canonicalAnchor) ||
      priorIdentities.has(requestedAnchor)
    ) {
      throw new Error(
        "C6 source-expansion frame v4 candidate collision",
      );
    }
    return {
      canonicalAnchorId: canonicalAnchor,
      canonicalRepository: canonical.repository,
      lineageIdentitySha256:
        result.exactSequenceLineageIdentitySha256,
      requestedAnchorId: requestedAnchor,
      screeningRank: priorCandidates.length + index + 1,
      source: {
        agentVisibleRequestSha256:
          result.agentVisibleRequestSha256,
        datasetId: qualification.sourceDataset.datasetId,
        instanceId: result.instanceId,
        sourceRevision: qualification.sourceDataset.revision,
        sourceRowIndex: result.rowIndex,
        sourceSplit: result.sourceSplit,
        sourceSplitRowIndex: result.sourceSplitRowIndex,
      },
      sourceRank: result.captureOrder,
      sourceTranche: SOURCE_TRANCHE,
    };
  });
  const candidates = [
    ...priorCandidates,
    ...liveMultilangCandidates,
  ];
  assertUniqueCandidates(candidates);
  assertRanks(candidates);
  if (
    JSON.stringify(candidates.slice(0, priorCandidates.length)) !==
      JSON.stringify(
        (rawPriorFrame as { candidates: unknown[] }).candidates,
      )
  ) {
    throw new Error(
      "C6 source-expansion frame v4 prior prefix changed",
    );
  }

  const repositories = groupByRepository(candidates);
  const repositoryCappedStructuralCeiling =
    repositoryCappedCeiling(repositories);
  return {
    artifactKind: "c6-source-expansion-screening-frame",
    boundary: {
      acceptedEpisodeCount: 0,
      adaptiveProspective: true,
      candidateManifestFrozen: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      status:
        "combined-structural-screening-frame-semantic-and-machine-qualification-required",
      structuralCapacityOnly: true,
    },
    candidates,
    counts: {
      combinedStructuralCandidateCount: candidates.length,
      liveMultilangExactCandidateCount:
        liveMultilangCandidates.length,
      liveMultilangNoExactSequenceCount:
        qualification.counts.noExactFreshSequenceCount,
      liveMultilangPriorFrameOverlapCount:
        qualification.counts.priorFrameOverlapCount,
      liveMultilangQualificationTargetCount:
        qualification.counts.targetCount,
      minimumRequiredEpisodes: MINIMUM_REQUIRED_EPISODES,
      priorFrameCandidateCount: priorCandidates.length,
      rawStructuralMargin:
        repositoryCappedStructuralCeiling - MINIMUM_REQUIRED_EPISODES,
      repositoryCappedStructuralCeiling,
      repositoryCount: repositories.size,
    },
    independenceBoundary: {
      adaptiveProspective: true,
      candidateProjectionSha256: sha256(JSON.stringify(candidates)),
      liveMultilangCandidateProjectionSha256:
        sha256(JSON.stringify(liveMultilangCandidates)),
      machineOutcomeInput: false,
      priorFrameCandidateProjectionSha256:
        priorFrame.independenceBoundary.candidateProjectionSha256,
      priorFrameOrderPreserved: true,
      prospectiveTrancheAppendedAfterPriorFrame: true,
      semanticLedgerInput: false,
    },
    inputs: {
      liveMultilangQualification: {
        ...reference(qualificationBytes, input.qualificationPath),
        exactFreshCandidateProjectionSha256:
          qualification.independenceBoundary
            .exactFreshCandidateProjectionSha256,
        expansionSha256: qualification.inputs.expansionSha256,
      },
      priorFrame: {
        ...reference(priorFrameBytes, input.priorFramePath),
        candidateProjectionSha256:
          priorFrame.independenceBoundary.candidateProjectionSha256,
      },
    },
    policy: {
      appendEligibility:
        "fresh-pull-author-exact-candidate-absent-from-complete-v3-frame",
      canonicalIdentity:
        "lowercase-resolved-repository-plus-pull-number",
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
        "complete-v3-screeningRank-then-live-multilang-captureOrder",
      repositoryCap: REPOSITORY_CAP,
    },
    schemaVersion: 4,
  };
}

export function deriveC6SourceExpansionScreeningFrameV4Capacity(input: {
  frame: C6SourceExpansionScreeningFrameV4;
  rejectedRequestedAnchorIds: readonly string[];
}): C6SourceExpansionScreeningFrameV4Capacity {
  const candidatesByAnchor = new Map(
    input.frame.candidates.map((candidate) => [
      normalizeAnchor(candidate.requestedAnchorId),
      candidate,
    ]),
  );
  if (candidatesByAnchor.size !== input.frame.candidates.length) {
    throw new Error(
      "C6 source-expansion frame v4 duplicate frame candidate",
    );
  }
  const rejected = new Set<string>();
  for (const value of input.rejectedRequestedAnchorIds) {
    const anchor = normalizeAnchor(value);
    if (!candidatesByAnchor.has(anchor)) {
      throw new Error(
        `C6 source-expansion frame v4 unknown rejected candidate ${
          value
        }`,
      );
    }
    if (rejected.has(anchor)) {
      throw new Error(
        `C6 source-expansion frame v4 duplicate rejected candidate ${
          value
        }`,
      );
    }
    rejected.add(anchor);
  }
  const remaining = input.frame.candidates.filter(
    (candidate) => !rejected.has(
      normalizeAnchor(candidate.requestedAnchorId),
    ),
  );
  const repositoryCappedStructuralCeiling =
    repositoryCappedCeiling(groupByRepository(remaining));
  return {
    canMeetMinimumUnderRepositoryCap:
      repositoryCappedStructuralCeiling >= MINIMUM_REQUIRED_EPISODES,
    canStartFullSemanticScreening:
      repositoryCappedStructuralCeiling >=
        FULL_SCREENING_BUFFER_REQUIRED,
    definitiveRejectedCandidateCount: rejected.size,
    fullScreeningBufferRequired: FULL_SCREENING_BUFFER_REQUIRED,
    minimumRequiredEpisodes: MINIMUM_REQUIRED_EPISODES,
    remainingStructuralCandidateCount: remaining.length,
    repositoryCappedStructuralCeiling,
    selectableMargin:
      repositoryCappedStructuralCeiling - MINIMUM_REQUIRED_EPISODES,
  };
}

export function serializeC6SourceExpansionScreeningFrameV4(
  frame: C6SourceExpansionScreeningFrameV4,
): string {
  return `${JSON.stringify(frame, null, 2)}\n`;
}

export async function materializeC6SourceExpansionScreeningFrameV4(input: {
  expectedPriorFrameSha256: string;
  expectedQualificationSha256: string;
  outputPath: string;
  priorFramePath: string;
  qualificationPath: string;
}): Promise<{
  frame: C6SourceExpansionScreeningFrameV4;
  outputSha256: string;
}> {
  const expectedPriorFrameSha256 = sha256Schema.parse(
    input.expectedPriorFrameSha256,
  );
  const expectedQualificationSha256 = sha256Schema.parse(
    input.expectedQualificationSha256,
  );
  const [priorFramePath, qualificationPath] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.priorFramePath,
      "C6 source-expansion frame v4 prior frame",
    ),
    assertC6NoSymlinkPathComponents(
      input.qualificationPath,
      "C6 source-expansion frame v4 qualification",
    ),
  ]);
  const [priorFrameBytes, qualificationBytes] = await Promise.all([
    readC6StableRegularFile(
      priorFramePath,
      "source-expansion frame v4 prior frame",
    ),
    readC6StableRegularFile(
      qualificationPath,
      "source-expansion frame v4 qualification",
    ),
  ]);
  if (
    sha256(priorFrameBytes) !== expectedPriorFrameSha256 ||
    sha256(qualificationBytes) !== expectedQualificationSha256
  ) {
    throw new Error(
      "C6 source-expansion frame v4 input hash mismatch",
    );
  }
  const frame = projectC6SourceExpansionScreeningFrameV4({
    priorFrameBytes,
    priorFramePath,
    qualificationBytes,
    qualificationPath,
  });
  const [terminalPrior, terminalQualification] = await Promise.all([
    readC6StableRegularFile(
      priorFramePath,
      "source-expansion frame v4 terminal prior frame",
    ),
    readC6StableRegularFile(
      qualificationPath,
      "source-expansion frame v4 terminal qualification",
    ),
  ]);
  if (
    !terminalPrior.equals(priorFrameBytes) ||
    !terminalQualification.equals(qualificationBytes)
  ) {
    throw new Error(
      "C6 source-expansion frame v4 input changed during projection",
    );
  }
  const serialized = serializeC6SourceExpansionScreeningFrameV4(frame);
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 source-expansion frame v4 output parent",
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

export async function replayC6SourceExpansionScreeningFrameV4(input: {
  expectedFrameSha256: string;
  expectedPriorFrameSha256: string;
  expectedQualificationSha256: string;
  framePath: string;
  priorFramePath: string;
  qualificationPath: string;
}): Promise<{
  frame: C6SourceExpansionScreeningFrameV4;
  reproduced: true;
}> {
  const framePath = await assertC6NoSymlinkPathComponents(
    input.framePath,
    "C6 source-expansion frame v4 artifact",
  );
  const [frameBytes, priorFrameBytes, qualificationBytes] =
    await Promise.all([
      readC6StableRegularFile(
        framePath,
        "source-expansion frame v4 artifact",
      ),
      readC6StableRegularFile(
        input.priorFramePath,
        "source-expansion frame v4 prior frame",
      ),
      readC6StableRegularFile(
        input.qualificationPath,
        "source-expansion frame v4 qualification",
      ),
    ]);
  if (
    sha256(frameBytes) !==
      sha256Schema.parse(input.expectedFrameSha256) ||
    sha256(priorFrameBytes) !==
      sha256Schema.parse(input.expectedPriorFrameSha256) ||
    sha256(qualificationBytes) !==
      sha256Schema.parse(input.expectedQualificationSha256)
  ) {
    throw new Error(
      "C6 source-expansion frame v4 replay hash mismatch",
    );
  }
  const frame = projectC6SourceExpansionScreeningFrameV4({
    priorFrameBytes,
    priorFramePath: input.priorFramePath,
    qualificationBytes,
    qualificationPath: input.qualificationPath,
  });
  if (
    serializeC6SourceExpansionScreeningFrameV4(frame) !==
      frameBytes.toString("utf8")
  ) {
    throw new Error(
      "C6 source-expansion frame v4 replay projection mismatch",
    );
  }
  const terminalFrame = await readC6StableRegularFile(
    framePath,
    "C6 source-expansion frame v4 terminal artifact",
  );
  if (!terminalFrame.equals(frameBytes)) {
    throw new Error(
      "C6 source-expansion frame v4 artifact changed during replay",
    );
  }
  return { frame, reproduced: true };
}

function assertResultOrder(
  results: readonly z.infer<typeof qualificationResultSchema>[],
): void {
  let prior = 0;
  const instances = new Set<string>();
  const splitLocators = new Set<string>();
  for (const result of results) {
    const split = SOURCE_SPLITS[result.sourceSplit];
    const splitLocator =
      `${result.sourceSplit}:${result.sourceSplitRowIndex}`;
    if (
      normalizeRepository(result.canonicalRepository) !==
        parseAnchor(result.canonicalAnchorId).repository
    ) {
      throw new Error(
        "C6 source-expansion frame v4 canonical repository mismatch",
      );
    }
    if (
      result.captureOrder <= prior ||
      result.rowIndex !== result.captureOrder - 1 ||
      result.sourceSplitRowIndex >= split.count ||
      result.rowIndex !== split.offset + result.sourceSplitRowIndex ||
      instances.has(result.instanceId) ||
      splitLocators.has(splitLocator)
    ) {
      throw new Error(
        "C6 source-expansion frame v4 source locator must follow capture order",
      );
    }
    prior = result.captureOrder;
    instances.add(result.instanceId);
    splitLocators.add(splitLocator);
  }
}

function assertQualificationCounts(
  qualification: z.infer<typeof qualificationSchema>,
  results: readonly z.infer<typeof qualificationResultSchema>[],
): void {
  const exact = results.filter(
    (result) => result.status === "exact-structural-candidate",
  );
  const noExact = results.filter(
    (result) => result.status === "no-exact-structural-sequence",
  );
  const overlaps = results.filter(
    (result) => result.status === "prior-frame-overlap",
  );
  if (
    results.length !== qualification.counts.targetCount ||
    results.length !== qualification.counts.identityClosureCount ||
    exact.length !== qualification.counts.exactFreshCandidateCount ||
    noExact.length !== qualification.counts.noExactFreshSequenceCount ||
    overlaps.length !== qualification.counts.priorFrameOverlapCount ||
    exact.some((result) =>
      result.exactSequence === undefined ||
      result.exactSequenceLineageIdentitySha256 === undefined
    )
  ) {
    throw new Error(
      "C6 source-expansion frame v4 qualification count mismatch",
    );
  }
  if (
    sha256(JSON.stringify(exact.map(qualificationCandidateProjection))) !==
      qualification.independenceBoundary
        .exactFreshCandidateProjectionSha256
  ) {
    throw new Error(
      "C6 source-expansion frame v4 qualification candidate projection mismatch",
    );
  }
}

function assertFrameCounts(
  candidates: readonly C6SourceExpansionScreeningFrameV4Candidate[],
  counts: {
    repositoryCappedStructuralCeiling: number;
    repositoryCount: number;
  },
): void {
  const repositories = groupByRepository(candidates);
  if (
    repositories.size !== counts.repositoryCount ||
    repositoryCappedCeiling(repositories) !==
      counts.repositoryCappedStructuralCeiling
  ) {
    throw new Error(
      "C6 source-expansion frame v4 prior count mismatch",
    );
  }
}

function assertRanks(
  candidates: readonly C6SourceExpansionScreeningFrameV4Candidate[],
): void {
  for (const [index, candidate] of candidates.entries()) {
    if (candidate.screeningRank !== index + 1) {
      throw new Error(
        "C6 source-expansion frame v4 screening ranks must be contiguous",
      );
    }
  }
}

function assertUniqueCandidates(
  candidates: readonly C6SourceExpansionScreeningFrameV4Candidate[],
): void {
  const identities = new Set<string>();
  for (const candidate of candidates) {
    const canonicalAnchor = normalizeAnchor(candidate.canonicalAnchorId);
    const requestedAnchor = normalizeAnchor(candidate.requestedAnchorId);
    const canonicalRepository =
      parseAnchor(candidate.canonicalAnchorId).repository;
    if (
      normalizeRepository(candidate.canonicalRepository) !==
        canonicalRepository
    ) {
      throw new Error(
        "C6 source-expansion frame v4 canonical repository mismatch",
      );
    }
    const candidateAnchors = new Set([
      canonicalAnchor,
      requestedAnchor,
    ]);
    if (
      [...candidateAnchors].some((anchor) => identities.has(anchor))
    ) {
      throw new Error(
        "C6 source-expansion frame v4 candidate collision",
      );
    }
    for (const anchor of candidateAnchors) {
      identities.add(anchor);
    }
  }
}

function candidateIdentities(
  candidates: readonly C6SourceExpansionScreeningFrameV4Candidate[],
): Set<string> {
  return new Set(candidates.flatMap((candidate) => [
    normalizeAnchor(candidate.canonicalAnchorId),
    normalizeAnchor(candidate.requestedAnchorId),
  ]));
}

function qualificationCandidateProjection(
  result: z.infer<typeof qualificationResultSchema>,
): unknown {
  return {
    agentVisibleRequestSha256: result.agentVisibleRequestSha256,
    canonicalAnchorId: result.canonicalAnchorId,
    captureOrder: result.captureOrder,
    exactSequence: result.exactSequence,
    exactSequenceLineageIdentitySha256:
      result.exactSequenceLineageIdentitySha256,
    instanceId: result.instanceId,
    rowIndex: result.rowIndex,
    sourceSplit: result.sourceSplit,
    sourceSplitRowIndex: result.sourceSplitRowIndex,
  };
}

function groupByRepository(
  candidates: readonly C6SourceExpansionScreeningFrameV4Candidate[],
): Map<string, C6SourceExpansionScreeningFrameV4Candidate[]> {
  const groups = new Map<
    string,
    C6SourceExpansionScreeningFrameV4Candidate[]
  >();
  for (const candidate of candidates) {
    const repository = normalizeRepository(candidate.canonicalRepository);
    const group = groups.get(repository) ?? [];
    group.push(candidate);
    groups.set(repository, group);
  }
  return groups;
}

function repositoryCappedCeiling(
  repositories: ReadonlyMap<
    string,
    readonly C6SourceExpansionScreeningFrameV4Candidate[]
  >,
): number {
  return [...repositories.values()].reduce(
    (sum, candidates) =>
      sum + Math.min(REPOSITORY_CAP, candidates.length),
    0,
  );
}

function reference(bytes: Buffer, path: string): {
  bytes: number;
  path: string;
  sha256: string;
} {
  return {
    bytes: bytes.byteLength,
    path: basename(path),
    sha256: sha256(bytes),
  };
}

function parseAnchor(value: string): {
  pullNumber: number;
  repository: string;
} {
  const anchor = normalizeAnchor(value);
  const separator = anchor.lastIndexOf("#");
  return {
    pullNumber: Number(anchor.slice(separator + 1)),
    repository: anchor.slice(0, separator),
  };
}

function normalizeAnchor(value: string): string {
  const match = /^([^/#\s]+\/[^/#\s]+)#([1-9]\d*)$/u.exec(
    value.toLowerCase(),
  );
  if (match === null) {
    throw new Error(
      `C6 source-expansion frame v4 invalid anchor ${value}`,
    );
  }
  return `${normalizeRepository(match[1]!)}#${match[2]}`;
}

function normalizeRepository(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[^/#\s]+\/[^/#\s]+$/u.test(normalized)) {
    throw new Error(
      `C6 source-expansion frame v4 invalid repository ${value}`,
    );
  }
  return normalized;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(
      `C6 source-expansion frame v4 invalid ${label} JSON`,
    );
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
