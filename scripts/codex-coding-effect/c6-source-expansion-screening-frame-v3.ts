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
const SOURCE_REVISION =
  "e5c585e008e2cb5eecc7c64192d855c53279d788";
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
  schemaVersion: z.literal(2),
}).passthrough();
const qualificationResultSchema = z.object({
  agentVisibleRequestSha256: sha256Schema,
  canonicalAnchorId: z.string().min(1),
  canonicalRepository: z.string().min(3),
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
  exactSequenceLineageIdentitySha256: sha256Schema.optional(),
  instanceId: z.string().min(1),
  requestedAnchorId: z.string().min(1),
  rowIndex: z.number().int().nonnegative(),
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
}).passthrough();

export type C6SourceExpansionScreeningFrameV3Candidate =
  z.infer<typeof candidateSchema>;

export interface C6SourceExpansionScreeningFrameV3 {
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
  candidates: C6SourceExpansionScreeningFrameV3Candidate[];
  counts: {
    combinedStructuralCandidateCount: number;
    minimumRequiredEpisodes: 48;
    multilingualExactCandidateCount: number;
    multilingualNoExactSequenceCount: number;
    multilingualPriorFrameOverlapCount: number;
    multilingualQualificationTargetCount: number;
    priorFrameCandidateCount: number;
    rawStructuralMargin: number;
    repositoryCappedStructuralCeiling: number;
    repositoryCount: number;
  };
  independenceBoundary: {
    adaptiveProspective: true;
    candidateProjectionSha256: string;
    machineOutcomeInput: false;
    multilingualCandidateProjectionSha256: string;
    priorFrameCandidateProjectionSha256: string;
    priorFrameOrderPreserved: true;
    prospectiveTrancheAppendedAfterPriorFrame: true;
    semanticLedgerInput: false;
  };
  inputs: {
    multilingualQualification: {
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
      "fresh-pull-author-exact-candidate-absent-from-complete-v2-frame";
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
      "complete-v2-screeningRank-then-multilingual-captureOrder";
    repositoryCap: 4;
  };
  schemaVersion: 3;
}

export interface C6SourceExpansionScreeningFrameV3Capacity {
  canMeetMinimumUnderRepositoryCap: boolean;
  canStartFullSemanticScreening: boolean;
  definitiveRejectedCandidateCount: number;
  fullScreeningBufferRequired: 72;
  minimumRequiredEpisodes: 48;
  remainingStructuralCandidateCount: number;
  repositoryCappedStructuralCeiling: number;
  selectableMargin: number;
}

export function projectC6SourceExpansionScreeningFrameV3(input: {
  priorFrameBytes: Uint8Array;
  priorFramePath: string;
  qualificationBytes: Uint8Array;
  qualificationPath: string;
}): C6SourceExpansionScreeningFrameV3 {
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
      "C6 source-expansion frame v3 prior candidate projection mismatch",
    );
  }
  assertRanks(priorFrame.candidates);
  assertFrameCounts(priorFrame.candidates, priorFrame.counts);
  const rawQualification = parseJson(
    qualificationBytes,
    "multilingual qualification",
  );
  const qualification = qualificationSchema.parse(rawQualification);
  const results = [...qualification.results].sort(
    (left, right) => left.captureOrder - right.captureOrder,
  );
  assertResultOrder(results);
  assertQualificationCounts(qualification, results);

  const priorCandidates = [...priorFrame.candidates];
  const priorCanonical = new Set(
    priorCandidates.map((candidate) =>
      normalizeAnchor(candidate.canonicalAnchorId)
    ),
  );
  const priorRequested = new Set(
    priorCandidates.map((candidate) =>
      normalizeAnchor(candidate.requestedAnchorId)
    ),
  );
  for (const result of results) {
    const canonical = normalizeAnchor(result.canonicalAnchorId);
    if (
      result.status === "prior-frame-overlap" &&
      !priorCanonical.has(canonical)
    ) {
      throw new Error(
        `C6 source-expansion frame v3 unknown overlap ${canonical}`,
      );
    }
  }
  const exactResults = results.filter((result): result is typeof result & {
    exactSequenceLineageIdentitySha256: string;
    status: "exact-structural-candidate";
  } => result.status === "exact-structural-candidate");
  const multilingualCandidates = exactResults.map((result, index) => {
    const canonical = parseAnchor(result.canonicalAnchorId);
    const requested = parseAnchor(result.requestedAnchorId);
    if (
      priorCanonical.has(
        `${canonical.repository}#${canonical.pullNumber}`,
      ) ||
      priorRequested.has(
        `${requested.repository}#${requested.pullNumber}`,
      )
    ) {
      throw new Error(
        "C6 source-expansion frame v3 candidate collision",
      );
    }
    return {
      canonicalAnchorId:
        `${canonical.repository}#${canonical.pullNumber}`,
      canonicalRepository: canonical.repository,
      lineageIdentitySha256:
        result.exactSequenceLineageIdentitySha256,
      requestedAnchorId:
        `${requested.repository}#${requested.pullNumber}`,
      screeningRank: priorCandidates.length + index + 1,
      source: {
        agentVisibleRequestSha256:
          result.agentVisibleRequestSha256,
        datasetId: "SWE-bench/SWE-bench_Multilingual",
        instanceId: result.instanceId,
        sourceRevision: SOURCE_REVISION,
        sourceRowIndex: result.rowIndex,
      },
      sourceRank: result.captureOrder,
      sourceTranche:
        "swe-bench-multilingual-e5c585e-exact-v1",
    };
  });
  const candidates = [...priorCandidates, ...multilingualCandidates];
  assertUniqueCandidates(candidates);
  assertRanks(candidates);
  if (
    JSON.stringify(candidates.slice(0, priorCandidates.length)) !==
      JSON.stringify(
        (rawPriorFrame as { candidates: unknown[] }).candidates,
      )
  ) {
    throw new Error(
      "C6 source-expansion frame v3 prior prefix changed",
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
      minimumRequiredEpisodes: MINIMUM_REQUIRED_EPISODES,
      multilingualExactCandidateCount: multilingualCandidates.length,
      multilingualNoExactSequenceCount:
        qualification.counts.noExactFreshSequenceCount,
      multilingualPriorFrameOverlapCount:
        qualification.counts.priorFrameOverlapCount,
      multilingualQualificationTargetCount:
        qualification.counts.targetCount,
      priorFrameCandidateCount: priorCandidates.length,
      rawStructuralMargin:
        repositoryCappedStructuralCeiling - MINIMUM_REQUIRED_EPISODES,
      repositoryCappedStructuralCeiling,
      repositoryCount: repositories.size,
    },
    independenceBoundary: {
      adaptiveProspective: true,
      candidateProjectionSha256: sha256(JSON.stringify(candidates)),
      machineOutcomeInput: false,
      multilingualCandidateProjectionSha256:
        sha256(JSON.stringify(multilingualCandidates)),
      priorFrameCandidateProjectionSha256:
        priorFrame.independenceBoundary.candidateProjectionSha256,
      priorFrameOrderPreserved: true,
      prospectiveTrancheAppendedAfterPriorFrame: true,
      semanticLedgerInput: false,
    },
    inputs: {
      multilingualQualification: {
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
        "fresh-pull-author-exact-candidate-absent-from-complete-v2-frame",
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
        "complete-v2-screeningRank-then-multilingual-captureOrder",
      repositoryCap: REPOSITORY_CAP,
    },
    schemaVersion: 3,
  };
}

export function deriveC6SourceExpansionScreeningFrameV3Capacity(input: {
  frame: C6SourceExpansionScreeningFrameV3;
  rejectedRequestedAnchorIds: readonly string[];
}): C6SourceExpansionScreeningFrameV3Capacity {
  const candidatesByAnchor = new Map(
    input.frame.candidates.map((candidate) => [
      normalizeAnchor(candidate.requestedAnchorId),
      candidate,
    ]),
  );
  if (candidatesByAnchor.size !== input.frame.candidates.length) {
    throw new Error(
      "C6 source-expansion frame v3 duplicate frame candidate",
    );
  }
  const rejected = new Set<string>();
  for (const value of input.rejectedRequestedAnchorIds) {
    const anchor = normalizeAnchor(value);
    if (!candidatesByAnchor.has(anchor)) {
      throw new Error(
        `C6 source-expansion frame v3 unknown rejected candidate ${
          value
        }`,
      );
    }
    if (rejected.has(anchor)) {
      throw new Error(
        `C6 source-expansion frame v3 duplicate rejected candidate ${
          value
        }`,
      );
    }
    rejected.add(anchor);
  }
  const remaining = input.frame.candidates.filter(
    (candidate) => !rejected.has(normalizeAnchor(
      candidate.requestedAnchorId,
    )),
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

export function serializeC6SourceExpansionScreeningFrameV3(
  frame: C6SourceExpansionScreeningFrameV3,
): string {
  return `${JSON.stringify(frame, null, 2)}\n`;
}

export async function materializeC6SourceExpansionScreeningFrameV3(input: {
  expectedPriorFrameSha256: string;
  expectedQualificationSha256: string;
  outputPath: string;
  priorFramePath: string;
  qualificationPath: string;
}): Promise<{
  frame: C6SourceExpansionScreeningFrameV3;
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
      "C6 source-expansion frame v3 prior frame",
    ),
    assertC6NoSymlinkPathComponents(
      input.qualificationPath,
      "C6 source-expansion frame v3 qualification",
    ),
  ]);
  const [priorFrameBytes, qualificationBytes] = await Promise.all([
    readC6StableRegularFile(
      priorFramePath,
      "source-expansion frame v3 prior frame",
    ),
    readC6StableRegularFile(
      qualificationPath,
      "source-expansion frame v3 qualification",
    ),
  ]);
  if (
    sha256(priorFrameBytes) !== expectedPriorFrameSha256 ||
    sha256(qualificationBytes) !== expectedQualificationSha256
  ) {
    throw new Error(
      "C6 source-expansion frame v3 input hash mismatch",
    );
  }
  const frame = projectC6SourceExpansionScreeningFrameV3({
    priorFrameBytes,
    priorFramePath,
    qualificationBytes,
    qualificationPath,
  });
  const [terminalPrior, terminalQualification] = await Promise.all([
    readC6StableRegularFile(
      priorFramePath,
      "source-expansion frame v3 terminal prior frame",
    ),
    readC6StableRegularFile(
      qualificationPath,
      "source-expansion frame v3 terminal qualification",
    ),
  ]);
  if (
    !terminalPrior.equals(priorFrameBytes) ||
    !terminalQualification.equals(qualificationBytes)
  ) {
    throw new Error(
      "C6 source-expansion frame v3 input changed during projection",
    );
  }
  const serialized = serializeC6SourceExpansionScreeningFrameV3(frame);
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 source-expansion frame v3 output parent",
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

export async function replayC6SourceExpansionScreeningFrameV3(input: {
  expectedFrameSha256: string;
  expectedPriorFrameSha256: string;
  expectedQualificationSha256: string;
  framePath: string;
  priorFramePath: string;
  qualificationPath: string;
}): Promise<{
  frame: C6SourceExpansionScreeningFrameV3;
  reproduced: true;
}> {
  const framePath = await assertC6NoSymlinkPathComponents(
    input.framePath,
    "C6 source-expansion frame v3 artifact",
  );
  const [frameBytes, priorFrameBytes, qualificationBytes] =
    await Promise.all([
      readC6StableRegularFile(
        framePath,
        "source-expansion frame v3 artifact",
      ),
      readC6StableRegularFile(
        input.priorFramePath,
        "source-expansion frame v3 prior frame",
      ),
      readC6StableRegularFile(
        input.qualificationPath,
        "source-expansion frame v3 qualification",
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
      "C6 source-expansion frame v3 replay hash mismatch",
    );
  }
  const frame = projectC6SourceExpansionScreeningFrameV3({
    priorFrameBytes,
    priorFramePath: input.priorFramePath,
    qualificationBytes,
    qualificationPath: input.qualificationPath,
  });
  if (
    serializeC6SourceExpansionScreeningFrameV3(frame) !==
      frameBytes.toString("utf8")
  ) {
    throw new Error(
      "C6 source-expansion frame v3 replay projection mismatch",
    );
  }
  const terminalFrame = await readC6StableRegularFile(
    framePath,
    "source-expansion frame v3 terminal artifact",
  );
  if (!terminalFrame.equals(frameBytes)) {
    throw new Error(
      "C6 source-expansion frame v3 artifact changed during replay",
    );
  }
  return { frame, reproduced: true };
}

function assertResultOrder(
  results: readonly z.infer<typeof qualificationResultSchema>[],
): void {
  let prior = 0;
  for (const result of results) {
    if (result.captureOrder <= prior) {
      throw new Error(
        "C6 source-expansion frame v3 result order must be increasing",
      );
    }
    prior = result.captureOrder;
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
      result.exactSequenceLineageIdentitySha256 === undefined
    )
  ) {
    throw new Error(
      "C6 source-expansion frame v3 qualification count mismatch",
    );
  }
}

function assertFrameCounts(
  candidates: readonly C6SourceExpansionScreeningFrameV3Candidate[],
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
      "C6 source-expansion frame v3 prior count mismatch",
    );
  }
}

function assertRanks(
  candidates: readonly C6SourceExpansionScreeningFrameV3Candidate[],
): void {
  for (const [index, candidate] of candidates.entries()) {
    if (candidate.screeningRank !== index + 1) {
      throw new Error(
        "C6 source-expansion frame v3 screening ranks must be contiguous",
      );
    }
  }
}

function assertUniqueCandidates(
  candidates: readonly C6SourceExpansionScreeningFrameV3Candidate[],
): void {
  const canonical = new Set<string>();
  const requested = new Set<string>();
  for (const candidate of candidates) {
    const canonicalAnchor = normalizeAnchor(candidate.canonicalAnchorId);
    const requestedAnchor = normalizeAnchor(candidate.requestedAnchorId);
    if (
      canonical.has(canonicalAnchor) ||
      requested.has(requestedAnchor)
    ) {
      throw new Error(
        "C6 source-expansion frame v3 candidate collision",
      );
    }
    canonical.add(canonicalAnchor);
    requested.add(requestedAnchor);
  }
}

function groupByRepository(
  candidates: readonly C6SourceExpansionScreeningFrameV3Candidate[],
): Map<string, C6SourceExpansionScreeningFrameV3Candidate[]> {
  const groups = new Map<
    string,
    C6SourceExpansionScreeningFrameV3Candidate[]
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
    readonly C6SourceExpansionScreeningFrameV3Candidate[]
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
      `C6 source-expansion frame v3 invalid anchor ${value}`,
    );
  }
  return `${normalizeRepository(match[1]!)}#${match[2]}`;
}

function normalizeRepository(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[^/#\s]+\/[^/#\s]+$/u.test(normalized)) {
    throw new Error(
      `C6 source-expansion frame v3 invalid repository ${value}`,
    );
  }
  return normalized;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(
      `C6 source-expansion frame v3 invalid ${label} JSON`,
    );
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
