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
const HEADLINE_MINIMUM_EPISODE_FLOOR = 391;
const REPOSITORY_CAP = 4;
const MULTI_SWE_DATASET_ID =
  "ByteDance-Seed/Multi-SWE-bench";
const MULTI_SWE_REVISION =
  "56ff018c04a38e27ada1e9d0a6d5839a51f88f0d";
const MULTILINGUAL_DATASET_ID =
  "SWE-bench/SWE-bench_Multilingual";
const MULTILINGUAL_REVISION =
  "e5c585e008e2cb5eecc7c64192d855c53279d788";
const LIVE_MULTILANG_DATASET_ID =
  "SWE-bench-Live/MultiLang";
const LIVE_MULTILANG_REVISION =
  "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const revisionSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const legacySourceSchema = z.object({
  path: z.string().min(1),
  rowIndex: z.number().int().nonnegative(),
  rowSha256: sha256Schema,
}).strict();
const resultSchema = z.object({
  actorFilteredQualification: z.enum([
    "exact-sequence",
    "no-exact-sequence",
  ]).optional(),
  agentVisibleRequestSha256: sha256Schema.optional(),
  canonicalAnchorId: z.string().min(1),
  canonicalRepository: z.string().min(3),
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
  exactSequence: z.object({}).passthrough().optional(),
  exactSequenceLineageIdentitySha256: sha256Schema.optional(),
  firstReviewActorManifestSha256: sha256Schema.optional(),
  instanceId: z.string().min(1).optional(),
  pullAuthor: z.string().min(1),
  requestedAnchorId: z.string().min(1),
  rowIndex: z.number().int().nonnegative().optional(),
  secondReviewActorManifestSha256: sha256Schema.optional(),
  source: legacySourceSchema.optional(),
  sourceSplit: z.string().min(1).optional(),
  sourceSplitRowIndex: z.number().int().nonnegative().optional(),
  status: z.enum([
    "actor-filtered-exact-structural-candidate",
    "no-actor-filtered-exact-structural-sequence",
    "prior-frame-overlap",
  ]),
}).passthrough();
const qualificationSchema = z.object({
  artifactKind: z.literal(
    "c6-reviewer-actor-filtered-source-expansion-qualification",
  ),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    automationExclusionComplete: z.literal(false),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    eventTimeActorTypeProven: z.literal(false),
    humanReviewerIdentityProven: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
  }).passthrough(),
  counts: z.object({
    actorFilteredExactFreshCandidateCount:
      z.number().int().nonnegative(),
    actorFilteredNoExactFreshSequenceCount:
      z.number().int().nonnegative(),
    priorFrameOverlapCount: z.number().int().nonnegative(),
    targetCount: z.number().int().positive(),
  }).passthrough(),
  independenceBoundary: z.object({
    candidateOrderChanged: z.literal(false),
    exactFreshCandidateProjectionSha256: sha256Schema,
    goldInput: z.literal(false),
    machineOutcomeInput: z.literal(false),
    semanticLedgerInput: z.literal(false),
  }).passthrough(),
  inputs: z.object({
    actorPlanSha256: sha256Schema,
    actorRootSha256: sha256Schema,
    baseQualificationSha256: sha256Schema,
    graphqlRootSha256: sha256Schema,
  }).passthrough(),
  policies: z.object({
    actor: z.object({
      sha256: sha256Schema,
    }).passthrough(),
    structuralReview: z.object({
      sha256: sha256Schema,
    }).passthrough(),
  }).passthrough(),
  results: z.array(resultSchema).min(1),
  schemaVersion: z.literal(1),
  sourceDataset: z.object({
    datasetId: z.string().min(1),
    revision: revisionSchema,
  }).strict().optional(),
}).passthrough();
const supersededCandidateSchema = z.object({
  canonicalAnchorId: z.string().min(1),
  canonicalRepository: z.string().min(3),
  lineageIdentitySha256: sha256Schema,
  requestedAnchorId: z.string().min(1),
  screeningRank: z.number().int().positive(),
  source: z.unknown(),
  sourceRank: z.number().int().positive(),
  sourceTranche: z.string().min(1),
}).passthrough();
const supersededFrameSchema = z.object({
  artifactKind: z.literal("c6-source-expansion-screening-frame"),
  boundary: z.object({
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
  }).passthrough(),
  candidates: z.array(supersededCandidateSchema).min(1),
  independenceBoundary: z.object({
    candidateProjectionSha256: sha256Schema,
  }).passthrough(),
  schemaVersion: z.literal(4),
}).passthrough();

type Qualification = z.infer<typeof qualificationSchema>;
type QualificationResult = z.infer<typeof resultSchema>;

export interface C6ReviewerActorQualifiedScreeningCandidate {
  canonicalAnchorId: string;
  canonicalRepository: string;
  lineageIdentitySha256: string;
  requestedAnchorId: string;
  screeningRank: number;
  source: Record<string, unknown>;
  sourceRank: number;
  sourceTranche:
    | "multi-swe-56ff018-actor-qualified-v1"
    | "swe-bench-multilingual-e5c585e-actor-qualified-v1"
    | "swe-bench-live-multilang-608f7ae9-actor-qualified-v1";
}

export interface C6ReviewerActorQualifiedScreeningFrame {
  artifactKind: "c6-reviewer-actor-qualified-screening-frame";
  boundary: {
    acceptedEpisodeCount: 0;
    automationExclusionComplete: false;
    candidateManifestFrozen: false;
    codexRunReady: false;
    currentFrameSemanticScreeningReady: boolean;
    eventTimeActorTypeProven: false;
    headlineRawStructuralCandidateFloorMet: boolean;
    humanReviewerIdentityProven: false;
    machineQualifiedEpisodeCount: 0;
    status:
      "platform-user-filtered-prospective-screening-batch-structural-only";
    structuralCapacityOnly: true;
  };
  candidates: C6ReviewerActorQualifiedScreeningCandidate[];
  counts: {
    actorRequalifiedPriorFrameOverlapCount: number;
    combinedStructuralCandidateCount: number;
    currentFrameScreeningBufferRequired: 72;
    deduplicatedCandidateCount: number;
    headlineMinimumEpisodeFloor: 391;
    headlineRawCandidateShortfall: number;
    headlineRepositoryCappedStructuralShortfall: number;
    liveMultilangActorQualifiedCandidateCount: number;
    liveMultilangQualificationTargetCount: number;
    multiSweActorQualifiedCandidateCount: number;
    multiSweQualificationTargetCount: number;
    multilingualActorQualifiedCandidateCount: number;
    multilingualQualificationTargetCount: number;
    repositoryCappedStructuralCeiling: number;
    repositoryCount: number;
    screeningBatchMinimumEpisodes: 48;
    screeningBatchRepositoryCappedMargin: number;
  };
  independenceBoundary: {
    candidateProjectionSha256: string;
    goldInput: false;
    legacyCandidateInput: false;
    legacySemanticLedgerInput: false;
    liveMultilangCandidateProjectionSha256: string;
    machineOutcomeInput: false;
    multiSweCandidateProjectionSha256: string;
    multilingualCandidateProjectionSha256: string;
    semanticLedgerInput: false;
    supersededFrameCandidateInput: false;
    trancheOrderFrozenBeforeSemanticScreening: true;
  };
  inputs: {
    liveMultilangQualification:
      C6ReviewerActorQualificationReference;
    multiSweQualification: C6ReviewerActorQualificationReference;
    multilingualQualification:
      C6ReviewerActorQualificationReference;
    supersededFrameV4: {
      bytes: number;
      candidateProjectionSha256: string;
      path: string;
      sha256: string;
      usedForCandidateSelection: false;
    };
  };
  policy: {
    canonicalIdentity:
      "lowercase-resolved-repository-plus-pull-number";
    deduplication:
      "first-candidate-in-frozen-tranche-and-capture-order";
    eligibility:
      "actor-filtered-exact-or-actor-requalified-prior-overlap";
    forbiddenSelectionInputs: readonly [
      "sourceTestSignals",
      "patch",
      "test",
      "gold",
      "outcome",
      "legacySemanticScreeningDecision",
      "semanticScreeningDecision",
      "machineQualificationDecision",
    ];
    legacyCandidatePolicy:
      "excluded-until-separately-actor-qualified";
    order:
      "multi-swe-captureOrder-then-multilingual-captureOrder-then-live-multilang-captureOrder";
    repositoryCap: 4;
  };
  schemaVersion: 1;
}

interface C6ReviewerActorQualificationReference {
  actorPlanSha256: string;
  actorRootSha256: string;
  baseQualificationSha256: string;
  bytes: number;
  exactFreshCandidateProjectionSha256: string;
  graphqlRootSha256: string;
  path: string;
  sha256: string;
}

export interface C6ReviewerActorQualifiedScreeningCapacity {
  canMeetHeadlineMinimumUnderRepositoryCap: boolean;
  canMeetScreeningBatchMinimumUnderRepositoryCap: boolean;
  currentFrameSemanticScreeningReady: boolean;
  definitiveRejectedCandidateCount: number;
  headlineMinimumEpisodeFloor: 391;
  headlineSelectableMargin: number;
  remainingStructuralCandidateCount: number;
  repositoryCappedStructuralCeiling: number;
  screeningBatchMinimumEpisodes: 48;
  screeningBatchSelectableMargin: number;
}

export function projectC6ReviewerActorQualifiedScreeningFrame(input: {
  liveMultilangQualificationBytes: Uint8Array;
  liveMultilangQualificationPath: string;
  multiSweQualificationBytes: Uint8Array;
  multiSweQualificationPath: string;
  multilingualQualificationBytes: Uint8Array;
  multilingualQualificationPath: string;
  supersededFrameBytes: Uint8Array;
  supersededFramePath: string;
}): C6ReviewerActorQualifiedScreeningFrame {
  const inputBytes = {
    live: Buffer.from(input.liveMultilangQualificationBytes),
    multiSwe: Buffer.from(input.multiSweQualificationBytes),
    multilingual: Buffer.from(input.multilingualQualificationBytes),
    superseded: Buffer.from(input.supersededFrameBytes),
  };
  const rawSuperseded = parseJson(
    inputBytes.superseded,
    "superseded frame v4",
  );
  const superseded = supersededFrameSchema.parse(rawSuperseded);
  if (
    sha256(JSON.stringify(
      (rawSuperseded as { candidates: unknown }).candidates,
    )) !== superseded.independenceBoundary.candidateProjectionSha256
  ) {
    throw new Error(
      "C6 actor-qualified frame superseded candidate projection mismatch",
    );
  }

  const trancheInputs = [
    parseTranche({
      bytes: inputBytes.multiSwe,
      datasetId: MULTI_SWE_DATASET_ID,
      path: input.multiSweQualificationPath,
      revision: MULTI_SWE_REVISION,
      sourceKind: "legacy-source",
      sourceTranche: "multi-swe-56ff018-actor-qualified-v1",
    }),
    parseTranche({
      bytes: inputBytes.multilingual,
      datasetId: MULTILINGUAL_DATASET_ID,
      path: input.multilingualQualificationPath,
      revision: MULTILINGUAL_REVISION,
      sourceKind: "agent-visible-source",
      sourceTranche:
        "swe-bench-multilingual-e5c585e-actor-qualified-v1",
    }),
    parseTranche({
      bytes: inputBytes.live,
      datasetId: LIVE_MULTILANG_DATASET_ID,
      path: input.liveMultilangQualificationPath,
      revision: LIVE_MULTILANG_REVISION,
      sourceKind: "agent-visible-source",
      sourceTranche:
        "swe-bench-live-multilang-608f7ae9-actor-qualified-v1",
    }),
  ] as const;
  assertCommonPolicies(trancheInputs.map((tranche) =>
    tranche.qualification
  ));

  const candidates: C6ReviewerActorQualifiedScreeningCandidate[] = [];
  const candidateIdentities = new Set<string>();
  const trancheCandidates = new Map<string, unknown[]>();
  let deduplicatedCandidateCount = 0;
  let actorRequalifiedPriorFrameOverlapCount = 0;
  for (const tranche of trancheInputs) {
    const projected: unknown[] = [];
    for (const result of tranche.eligibleResults) {
      if (result.status === "prior-frame-overlap") {
        actorRequalifiedPriorFrameOverlapCount += 1;
      }
      const canonicalAnchorId = normalizeAnchor(
        result.canonicalAnchorId,
      );
      const requestedAnchorId = normalizeAnchor(
        result.requestedAnchorId,
      );
      const identities = new Set([
        canonicalAnchorId,
        requestedAnchorId,
      ]);
      if (
        [...identities].some((identity) =>
          candidateIdentities.has(identity)
        )
      ) {
        deduplicatedCandidateCount += 1;
        continue;
      }
      for (const identity of identities) {
        candidateIdentities.add(identity);
      }
      const candidate: C6ReviewerActorQualifiedScreeningCandidate = {
        canonicalAnchorId,
        canonicalRepository:
          parseAnchor(canonicalAnchorId).repository,
        lineageIdentitySha256:
          result.exactSequenceLineageIdentitySha256!,
        requestedAnchorId,
        screeningRank: candidates.length + 1,
        source: projectSource(result, tranche),
        sourceRank: result.captureOrder,
        sourceTranche: tranche.sourceTranche,
      };
      candidates.push(candidate);
      projected.push(candidate);
    }
    trancheCandidates.set(tranche.sourceTranche, projected);
  }
  assertCandidates(candidates);
  const repositories = groupByRepository(candidates);
  const repositoryCappedStructuralCeiling =
    repositoryCappedCeiling(repositories);
  const [multiSwe, multilingual, live] = trancheInputs;
  const multiSweCandidates = trancheCandidates.get(
    multiSwe.sourceTranche,
  )!;
  const multilingualCandidates = trancheCandidates.get(
    multilingual.sourceTranche,
  )!;
  const liveCandidates = trancheCandidates.get(
    live.sourceTranche,
  )!;

  return {
    artifactKind: "c6-reviewer-actor-qualified-screening-frame",
    boundary: {
      acceptedEpisodeCount: 0,
      automationExclusionComplete: false,
      candidateManifestFrozen: false,
      codexRunReady: false,
      currentFrameSemanticScreeningReady:
        repositoryCappedStructuralCeiling >=
          FULL_SCREENING_BUFFER_REQUIRED,
      eventTimeActorTypeProven: false,
      headlineRawStructuralCandidateFloorMet:
        candidates.length >= HEADLINE_MINIMUM_EPISODE_FLOOR,
      humanReviewerIdentityProven: false,
      machineQualifiedEpisodeCount: 0,
      status:
        "platform-user-filtered-prospective-screening-batch-structural-only",
      structuralCapacityOnly: true,
    },
    candidates,
    counts: {
      actorRequalifiedPriorFrameOverlapCount,
      combinedStructuralCandidateCount: candidates.length,
      currentFrameScreeningBufferRequired:
        FULL_SCREENING_BUFFER_REQUIRED,
      deduplicatedCandidateCount,
      headlineMinimumEpisodeFloor:
        HEADLINE_MINIMUM_EPISODE_FLOOR,
      headlineRawCandidateShortfall: Math.max(
        0,
        HEADLINE_MINIMUM_EPISODE_FLOOR - candidates.length,
      ),
      headlineRepositoryCappedStructuralShortfall: Math.max(
        0,
        HEADLINE_MINIMUM_EPISODE_FLOOR -
          repositoryCappedStructuralCeiling,
      ),
      liveMultilangActorQualifiedCandidateCount:
        liveCandidates.length,
      liveMultilangQualificationTargetCount:
        live.qualification.counts.targetCount,
      multiSweActorQualifiedCandidateCount:
        multiSweCandidates.length,
      multiSweQualificationTargetCount:
        multiSwe.qualification.counts.targetCount,
      multilingualActorQualifiedCandidateCount:
        multilingualCandidates.length,
      multilingualQualificationTargetCount:
        multilingual.qualification.counts.targetCount,
      repositoryCappedStructuralCeiling,
      repositoryCount: repositories.size,
      screeningBatchMinimumEpisodes:
        MINIMUM_REQUIRED_EPISODES,
      screeningBatchRepositoryCappedMargin:
        repositoryCappedStructuralCeiling -
        MINIMUM_REQUIRED_EPISODES,
    },
    independenceBoundary: {
      candidateProjectionSha256: sha256(JSON.stringify(candidates)),
      goldInput: false,
      legacyCandidateInput: false,
      legacySemanticLedgerInput: false,
      liveMultilangCandidateProjectionSha256:
        sha256(JSON.stringify(liveCandidates)),
      machineOutcomeInput: false,
      multiSweCandidateProjectionSha256:
        sha256(JSON.stringify(multiSweCandidates)),
      multilingualCandidateProjectionSha256:
        sha256(JSON.stringify(multilingualCandidates)),
      semanticLedgerInput: false,
      supersededFrameCandidateInput: false,
      trancheOrderFrozenBeforeSemanticScreening: true,
    },
    inputs: {
      liveMultilangQualification: qualificationReference(live),
      multiSweQualification: qualificationReference(multiSwe),
      multilingualQualification:
        qualificationReference(multilingual),
      supersededFrameV4: {
        ...reference(
          inputBytes.superseded,
          input.supersededFramePath,
        ),
        candidateProjectionSha256:
          superseded.independenceBoundary
            .candidateProjectionSha256,
        usedForCandidateSelection: false,
      },
    },
    policy: {
      canonicalIdentity:
        "lowercase-resolved-repository-plus-pull-number",
      deduplication:
        "first-candidate-in-frozen-tranche-and-capture-order",
      eligibility:
        "actor-filtered-exact-or-actor-requalified-prior-overlap",
      forbiddenSelectionInputs: [
        "sourceTestSignals",
        "patch",
        "test",
        "gold",
        "outcome",
        "legacySemanticScreeningDecision",
        "semanticScreeningDecision",
        "machineQualificationDecision",
      ],
      legacyCandidatePolicy:
        "excluded-until-separately-actor-qualified",
      order:
        "multi-swe-captureOrder-then-multilingual-captureOrder-then-live-multilang-captureOrder",
      repositoryCap: REPOSITORY_CAP,
    },
    schemaVersion: 1,
  };
}

export function deriveC6ReviewerActorQualifiedScreeningCapacity(input: {
  frame: C6ReviewerActorQualifiedScreeningFrame;
  rejectedRequestedAnchorIds: readonly string[];
}): C6ReviewerActorQualifiedScreeningCapacity {
  const candidates = new Map(
    input.frame.candidates.map((candidate) => [
      normalizeAnchor(candidate.requestedAnchorId),
      candidate,
    ]),
  );
  const rejected = new Set<string>();
  for (const value of input.rejectedRequestedAnchorIds) {
    const anchor = normalizeAnchor(value);
    if (!candidates.has(anchor)) {
      throw new Error(
        `C6 actor-qualified frame unknown rejected candidate ${value}`,
      );
    }
    if (rejected.has(anchor)) {
      throw new Error(
        `C6 actor-qualified frame duplicate rejected candidate ${value}`,
      );
    }
    rejected.add(anchor);
  }
  const remaining = input.frame.candidates.filter(
    (candidate) =>
      !rejected.has(normalizeAnchor(candidate.requestedAnchorId)),
  );
  const repositoryCappedStructuralCeiling =
    repositoryCappedCeiling(groupByRepository(remaining));
  return {
    canMeetHeadlineMinimumUnderRepositoryCap:
      repositoryCappedStructuralCeiling >=
        HEADLINE_MINIMUM_EPISODE_FLOOR,
    canMeetScreeningBatchMinimumUnderRepositoryCap:
      repositoryCappedStructuralCeiling >= MINIMUM_REQUIRED_EPISODES,
    currentFrameSemanticScreeningReady:
      repositoryCappedStructuralCeiling >=
        FULL_SCREENING_BUFFER_REQUIRED,
    definitiveRejectedCandidateCount: rejected.size,
    headlineMinimumEpisodeFloor:
      HEADLINE_MINIMUM_EPISODE_FLOOR,
    headlineSelectableMargin:
      repositoryCappedStructuralCeiling -
      HEADLINE_MINIMUM_EPISODE_FLOOR,
    remainingStructuralCandidateCount: remaining.length,
    repositoryCappedStructuralCeiling,
    screeningBatchMinimumEpisodes:
      MINIMUM_REQUIRED_EPISODES,
    screeningBatchSelectableMargin:
      repositoryCappedStructuralCeiling - MINIMUM_REQUIRED_EPISODES,
  };
}

export function serializeC6ReviewerActorQualifiedScreeningFrame(
  frame: C6ReviewerActorQualifiedScreeningFrame,
): string {
  return `${JSON.stringify(frame, null, 2)}\n`;
}

interface FrameInputPaths {
  liveMultilangQualificationPath: string;
  multiSweQualificationPath: string;
  multilingualQualificationPath: string;
  supersededFramePath: string;
}

interface ExpectedFrameInputHashes {
  expectedLiveMultilangQualificationSha256: string;
  expectedMultiSweQualificationSha256: string;
  expectedMultilingualQualificationSha256: string;
  expectedSupersededFrameSha256: string;
}

export async function materializeC6ReviewerActorQualifiedScreeningFrame(
  input: FrameInputPaths & ExpectedFrameInputHashes & {
    outputPath: string;
  },
): Promise<{
  frame: C6ReviewerActorQualifiedScreeningFrame;
  outputSha256: string;
}> {
  const loaded = await loadFrameInputs(input);
  const frame = projectC6ReviewerActorQualifiedScreeningFrame({
    liveMultilangQualificationBytes: loaded.live,
    liveMultilangQualificationPath:
      input.liveMultilangQualificationPath,
    multiSweQualificationBytes: loaded.multiSwe,
    multiSweQualificationPath: input.multiSweQualificationPath,
    multilingualQualificationBytes: loaded.multilingual,
    multilingualQualificationPath:
      input.multilingualQualificationPath,
    supersededFrameBytes: loaded.superseded,
    supersededFramePath: input.supersededFramePath,
  });
  await verifyFrameInputsUnchanged(input, loaded);
  const serialized =
    serializeC6ReviewerActorQualifiedScreeningFrame(frame);
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 actor-qualified frame output parent",
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

export async function replayC6ReviewerActorQualifiedScreeningFrame(
  input: FrameInputPaths & ExpectedFrameInputHashes & {
    expectedFrameSha256: string;
    framePath: string;
  },
): Promise<{
  frame: C6ReviewerActorQualifiedScreeningFrame;
  reproduced: true;
}> {
  const [framePath, loaded] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.framePath,
      "C6 actor-qualified frame projection",
    ),
    loadFrameInputs(input),
  ]);
  const frameBytes = await readC6StableRegularFile(
    framePath,
    "actor-qualified frame projection",
  );
  if (
    sha256(frameBytes) !==
      sha256Schema.parse(input.expectedFrameSha256)
  ) {
    throw new Error(
      "C6 actor-qualified frame projection hash mismatch",
    );
  }
  const frame = projectC6ReviewerActorQualifiedScreeningFrame({
    liveMultilangQualificationBytes: loaded.live,
    liveMultilangQualificationPath:
      input.liveMultilangQualificationPath,
    multiSweQualificationBytes: loaded.multiSwe,
    multiSweQualificationPath: input.multiSweQualificationPath,
    multilingualQualificationBytes: loaded.multilingual,
    multilingualQualificationPath:
      input.multilingualQualificationPath,
    supersededFrameBytes: loaded.superseded,
    supersededFramePath: input.supersededFramePath,
  });
  if (
    serializeC6ReviewerActorQualifiedScreeningFrame(frame) !==
      frameBytes.toString("utf8")
  ) {
    throw new Error(
      "C6 actor-qualified frame projection does not match recomputation",
    );
  }
  await verifyFrameInputsUnchanged(input, loaded);
  const terminalFrame = await readC6StableRegularFile(
    framePath,
    "actor-qualified frame terminal projection",
  );
  if (!terminalFrame.equals(frameBytes)) {
    throw new Error(
      "C6 actor-qualified frame projection changed during replay",
    );
  }
  return { frame, reproduced: true };
}

interface ParsedTranche {
  bytes: Buffer;
  datasetId: string;
  eligibleResults: QualificationResult[];
  path: string;
  qualification: Qualification;
  revision: string;
  sourceKind: "agent-visible-source" | "legacy-source";
  sourceTranche:
    C6ReviewerActorQualifiedScreeningCandidate["sourceTranche"];
}

function parseTranche(input: Omit<
  ParsedTranche,
  "eligibleResults" | "qualification"
>): ParsedTranche {
  const qualification = qualificationSchema.parse(
    parseJson(input.bytes, `${input.sourceTranche} qualification`),
  );
  assertQualification(qualification, input.sourceKind);
  if (
    qualification.sourceDataset !== undefined &&
    (
      qualification.sourceDataset.datasetId !== input.datasetId ||
      qualification.sourceDataset.revision !== input.revision
    )
  ) {
    throw new Error(
      "C6 actor-qualified frame source dataset mismatch",
    );
  }
  const eligibleResults = qualification.results.filter(
    isActorQualifiedCandidate,
  );
  return { ...input, eligibleResults, qualification };
}

function assertQualification(
  qualification: Qualification,
  sourceKind: ParsedTranche["sourceKind"],
): void {
  const freshExact = qualification.results.filter(
    (result) =>
      result.status ===
        "actor-filtered-exact-structural-candidate",
  );
  const noExact = qualification.results.filter(
    (result) =>
      result.status ===
        "no-actor-filtered-exact-structural-sequence",
  );
  const overlaps = qualification.results.filter(
    (result) => result.status === "prior-frame-overlap",
  );
  if (
    qualification.results.length !== qualification.counts.targetCount ||
    freshExact.length !==
      qualification.counts.actorFilteredExactFreshCandidateCount ||
    noExact.length !==
      qualification.counts.actorFilteredNoExactFreshSequenceCount ||
    overlaps.length !== qualification.counts.priorFrameOverlapCount
  ) {
    throw new Error(
      "C6 actor-qualified frame qualification count mismatch",
    );
  }
  let priorCaptureOrder = 0;
  const anchors = new Set<string>();
  const directories = new Set<string>();
  for (const result of qualification.results) {
    const canonicalAnchor = normalizeAnchor(result.canonicalAnchorId);
    const canonicalRepository = parseAnchor(canonicalAnchor).repository;
    const isLegacySource =
      result.source !== undefined &&
      result.agentVisibleRequestSha256 === undefined &&
      result.instanceId === undefined &&
      result.rowIndex === undefined;
    const isAgentVisibleSource =
      result.source === undefined &&
      result.agentVisibleRequestSha256 !== undefined &&
      result.instanceId !== undefined &&
      result.rowIndex !== undefined &&
      result.rowIndex === result.captureOrder - 1;
    if (
      result.captureOrder <= priorCaptureOrder ||
      normalizeRepository(result.canonicalRepository) !==
        canonicalRepository ||
      anchors.has(canonicalAnchor) ||
      directories.has(result.captureDirectory) ||
      (sourceKind === "legacy-source" && !isLegacySource) ||
      (
        sourceKind === "agent-visible-source" &&
        !isAgentVisibleSource
      ) ||
      (
        (result.sourceSplit === undefined) !==
          (result.sourceSplitRowIndex === undefined)
      )
    ) {
      throw new Error(
        "C6 actor-qualified frame qualification identity mismatch",
      );
    }
    priorCaptureOrder = result.captureOrder;
    anchors.add(canonicalAnchor);
    directories.add(result.captureDirectory);
  }
  if (
    freshExact.some((result) =>
      result.exactSequence === undefined ||
      result.exactSequenceLineageIdentitySha256 === undefined ||
      result.firstReviewActorManifestSha256 === undefined ||
      result.secondReviewActorManifestSha256 === undefined
    ) ||
    overlaps.some((result) =>
      result.actorFilteredQualification === "exact-sequence" &&
      (
        result.exactSequence === undefined ||
        result.exactSequenceLineageIdentitySha256 === undefined
      )
    )
  ) {
    throw new Error(
      "C6 actor-qualified frame exact qualification is incomplete",
    );
  }
  if (
    sha256(JSON.stringify(freshExact.map(exactFreshProjection))) !==
      qualification.independenceBoundary
        .exactFreshCandidateProjectionSha256
  ) {
    throw new Error(
      "C6 actor-qualified frame qualification candidate projection mismatch",
    );
  }
}

function exactFreshProjection(
  result: QualificationResult,
): unknown {
  if (result.source !== undefined) {
    return {
      canonicalAnchorId: result.canonicalAnchorId,
      captureOrder: result.captureOrder,
      exactSequence: result.exactSequence,
      exactSequenceLineageIdentitySha256:
        result.exactSequenceLineageIdentitySha256,
      firstReviewActorManifestSha256:
        result.firstReviewActorManifestSha256,
      requestedAnchorId: result.requestedAnchorId,
      secondReviewActorManifestSha256:
        result.secondReviewActorManifestSha256,
      source: result.source,
    };
  }
  return {
    agentVisibleRequestSha256:
      result.agentVisibleRequestSha256,
    canonicalAnchorId: result.canonicalAnchorId,
    captureOrder: result.captureOrder,
    exactSequence: result.exactSequence,
    exactSequenceLineageIdentitySha256:
      result.exactSequenceLineageIdentitySha256,
    firstReviewActorManifestSha256:
      result.firstReviewActorManifestSha256,
    instanceId: result.instanceId,
    rowIndex: result.rowIndex,
    secondReviewActorManifestSha256:
      result.secondReviewActorManifestSha256,
    ...(result.sourceSplit === undefined
      ? {}
      : {
        sourceSplit: result.sourceSplit,
        sourceSplitRowIndex: result.sourceSplitRowIndex,
      }),
  };
}

function isActorQualifiedCandidate(
  result: QualificationResult,
): boolean {
  return (
    result.status ===
      "actor-filtered-exact-structural-candidate" ||
    (
      result.status === "prior-frame-overlap" &&
      result.actorFilteredQualification === "exact-sequence"
    )
  );
}

function projectSource(
  result: QualificationResult,
  tranche: ParsedTranche,
): Record<string, unknown> {
  if (result.source !== undefined) {
    return {
      datasetId: tranche.datasetId,
      path: result.source.path,
      rowIndex: result.source.rowIndex,
      rowSha256: result.source.rowSha256,
      sourceRevision: tranche.revision,
    };
  }
  return {
    agentVisibleRequestSha256:
      result.agentVisibleRequestSha256!,
    datasetId: tranche.datasetId,
    instanceId: result.instanceId!,
    rowIndex: result.rowIndex!,
    sourceRevision: tranche.revision,
    ...(result.sourceSplit === undefined
      ? {}
      : {
        sourceSplit: result.sourceSplit,
        sourceSplitRowIndex: result.sourceSplitRowIndex,
      }),
  };
}

function assertCommonPolicies(
  qualifications: readonly Qualification[],
): void {
  const first = qualifications[0]!;
  if (qualifications.some((qualification) =>
    qualification.policies.actor.sha256 !==
      first.policies.actor.sha256 ||
    qualification.policies.structuralReview.sha256 !==
      first.policies.structuralReview.sha256
  )) {
    throw new Error(
      "C6 actor-qualified frame qualification policy mismatch",
    );
  }
}

function qualificationReference(
  tranche: ParsedTranche,
): C6ReviewerActorQualificationReference {
  return {
    ...reference(tranche.bytes, tranche.path),
    actorPlanSha256:
      tranche.qualification.inputs.actorPlanSha256,
    actorRootSha256:
      tranche.qualification.inputs.actorRootSha256,
    baseQualificationSha256:
      tranche.qualification.inputs.baseQualificationSha256,
    exactFreshCandidateProjectionSha256:
      tranche.qualification.independenceBoundary
        .exactFreshCandidateProjectionSha256,
    graphqlRootSha256:
      tranche.qualification.inputs.graphqlRootSha256,
  };
}

function assertCandidates(
  candidates: readonly C6ReviewerActorQualifiedScreeningCandidate[],
): void {
  const identities = new Set<string>();
  for (const [index, candidate] of candidates.entries()) {
    const canonical = normalizeAnchor(candidate.canonicalAnchorId);
    const requested = normalizeAnchor(candidate.requestedAnchorId);
    if (
      candidate.screeningRank !== index + 1 ||
      normalizeRepository(candidate.canonicalRepository) !==
        parseAnchor(canonical).repository ||
      identities.has(canonical) ||
      identities.has(requested)
    ) {
      throw new Error(
        "C6 actor-qualified frame candidate identity mismatch",
      );
    }
    identities.add(canonical);
    identities.add(requested);
  }
}

function groupByRepository(
  candidates: readonly C6ReviewerActorQualifiedScreeningCandidate[],
): Map<string, C6ReviewerActorQualifiedScreeningCandidate[]> {
  const groups = new Map<
    string,
    C6ReviewerActorQualifiedScreeningCandidate[]
  >();
  for (const candidate of candidates) {
    const repository = normalizeRepository(
      candidate.canonicalRepository,
    );
    const group = groups.get(repository) ?? [];
    group.push(candidate);
    groups.set(repository, group);
  }
  return groups;
}

function repositoryCappedCeiling(
  repositories: ReadonlyMap<
    string,
    readonly C6ReviewerActorQualifiedScreeningCandidate[]
  >,
): number {
  return [...repositories.values()].reduce(
    (sum, candidates) =>
      sum + Math.min(REPOSITORY_CAP, candidates.length),
    0,
  );
}

async function loadFrameInputs(
  input: FrameInputPaths & ExpectedFrameInputHashes,
): Promise<{
  live: Buffer;
  multiSwe: Buffer;
  multilingual: Buffer;
  superseded: Buffer;
}> {
  const expected = {
    live: sha256Schema.parse(
      input.expectedLiveMultilangQualificationSha256,
    ),
    multiSwe: sha256Schema.parse(
      input.expectedMultiSweQualificationSha256,
    ),
    multilingual: sha256Schema.parse(
      input.expectedMultilingualQualificationSha256,
    ),
    superseded: sha256Schema.parse(
      input.expectedSupersededFrameSha256,
    ),
  };
  const paths = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.liveMultilangQualificationPath,
      "C6 actor-qualified frame Live qualification",
    ),
    assertC6NoSymlinkPathComponents(
      input.multiSweQualificationPath,
      "C6 actor-qualified frame Multi-SWE qualification",
    ),
    assertC6NoSymlinkPathComponents(
      input.multilingualQualificationPath,
      "C6 actor-qualified frame multilingual qualification",
    ),
    assertC6NoSymlinkPathComponents(
      input.supersededFramePath,
      "C6 actor-qualified frame superseded frame",
    ),
  ]);
  const [live, multiSwe, multilingual, superseded] =
    await Promise.all(paths.map((path) =>
      readC6StableRegularFile(path, "actor-qualified frame input")
    ));
  if (
    sha256(live) !== expected.live ||
    sha256(multiSwe) !== expected.multiSwe ||
    sha256(multilingual) !== expected.multilingual ||
    sha256(superseded) !== expected.superseded
  ) {
    throw new Error(
      "C6 actor-qualified frame input hash mismatch",
    );
  }
  return { live, multiSwe, multilingual, superseded };
}

async function verifyFrameInputsUnchanged(
  input: FrameInputPaths,
  initial: {
    live: Buffer;
    multiSwe: Buffer;
    multilingual: Buffer;
    superseded: Buffer;
  },
): Promise<void> {
  const terminal = await Promise.all([
    readC6StableRegularFile(
      input.liveMultilangQualificationPath,
      "actor-qualified frame terminal Live qualification",
    ),
    readC6StableRegularFile(
      input.multiSweQualificationPath,
      "actor-qualified frame terminal Multi-SWE qualification",
    ),
    readC6StableRegularFile(
      input.multilingualQualificationPath,
      "actor-qualified frame terminal multilingual qualification",
    ),
    readC6StableRegularFile(
      input.supersededFramePath,
      "actor-qualified frame terminal superseded frame",
    ),
  ]);
  if (
    !terminal[0].equals(initial.live) ||
    !terminal[1].equals(initial.multiSwe) ||
    !terminal[2].equals(initial.multilingual) ||
    !terminal[3].equals(initial.superseded)
  ) {
    throw new Error(
      "C6 actor-qualified frame input changed during projection",
    );
  }
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
      `C6 actor-qualified frame invalid anchor ${value}`,
    );
  }
  return `${normalizeRepository(match[1]!)}#${match[2]}`;
}

function normalizeRepository(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[^/#\s]+\/[^/#\s]+$/u.test(normalized)) {
    throw new Error(
      `C6 actor-qualified frame invalid repository ${value}`,
    );
  }
  return normalized;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(`C6 actor-qualified frame invalid ${label} JSON`);
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
