import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import {
  deriveC6ReviewerActorQualifiedScreeningCapacity,
  projectC6ReviewerActorQualifiedScreeningFrame,
} from "../../scripts/codex-coding-effect/c6-reviewer-actor-qualified-screening-frame";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);
const LIVE_REVISION =
  "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b";

describe("Codex coding-effect C6 reviewer actor-qualified frame", () => {
  test("starts a prospective-only frame in frozen tranche order", () => {
    const multiSwe = qualification([
      legacyExact({
        anchorId: "owner/multi#1",
        captureOrder: 1,
      }),
    ]);
    const multilingual = qualification([
      visibleExact({
        anchorId: "owner/multilingual#2",
        captureOrder: 2,
        rowIndex: 1,
      }),
      visibleExact({
        anchorId: "owner/requalified-overlap#3",
        captureOrder: 3,
        rowIndex: 2,
        status: "prior-frame-overlap",
      }),
    ]);
    const live = qualification([
      visibleExact({
        anchorId: "owner/live#4",
        captureOrder: 1,
        rowIndex: 0,
        sourceSplit: "go",
        sourceSplitRowIndex: 0,
      }),
    ], {
      datasetId: "SWE-bench-Live/MultiLang",
      revision: LIVE_REVISION,
    });

    const frame = projectC6ReviewerActorQualifiedScreeningFrame({
      liveMultilangQualificationBytes: bytes(live),
      liveMultilangQualificationPath: "/fixtures/live.json",
      multiSweQualificationBytes: bytes(multiSwe),
      multiSweQualificationPath: "/fixtures/multi.json",
      multilingualQualificationBytes: bytes(multilingual),
      multilingualQualificationPath: "/fixtures/multilingual.json",
      supersededFrameBytes: bytes(supersededFrame()),
      supersededFramePath: "/fixtures/frame-v4.json",
    });

    expect(frame.candidates.map((candidate) => ({
      anchor: candidate.canonicalAnchorId,
      rank: candidate.screeningRank,
      sourceRank: candidate.sourceRank,
      tranche: candidate.sourceTranche,
    }))).toEqual([
      {
        anchor: "owner/multi#1",
        rank: 1,
        sourceRank: 1,
        tranche: "multi-swe-56ff018-actor-qualified-v1",
      },
      {
        anchor: "owner/multilingual#2",
        rank: 2,
        sourceRank: 2,
        tranche: "swe-bench-multilingual-e5c585e-actor-qualified-v1",
      },
      {
        anchor: "owner/requalified-overlap#3",
        rank: 3,
        sourceRank: 3,
        tranche: "swe-bench-multilingual-e5c585e-actor-qualified-v1",
      },
      {
        anchor: "owner/live#4",
        rank: 4,
        sourceRank: 1,
        tranche: "swe-bench-live-multilang-608f7ae9-actor-qualified-v1",
      },
    ]);
    expect(frame.counts).toMatchObject({
      actorRequalifiedPriorFrameOverlapCount: 1,
      combinedStructuralCandidateCount: 4,
      currentFrameScreeningBufferRequired: 72,
      deduplicatedCandidateCount: 0,
      headlineMinimumEpisodeFloor: 391,
      headlineRawCandidateShortfall: 387,
      headlineRepositoryCappedStructuralShortfall: 387,
      repositoryCappedStructuralCeiling: 4,
      repositoryCount: 4,
      screeningBatchMinimumEpisodes: 48,
    });
    expect(frame.boundary).toMatchObject({
      acceptedEpisodeCount: 0,
      automationExclusionComplete: false,
      candidateManifestFrozen: false,
      codexRunReady: false,
      currentFrameSemanticScreeningReady: false,
      headlineRawStructuralCandidateFloorMet: false,
      humanReviewerIdentityProven: false,
      machineQualifiedEpisodeCount: 0,
      status:
        "platform-user-filtered-prospective-screening-batch-structural-only",
    });
    expect(frame.independenceBoundary).toMatchObject({
      legacyCandidateInput: false,
      legacySemanticLedgerInput: false,
      machineOutcomeInput: false,
      semanticLedgerInput: false,
    });
  });

  test("deduplicates later canonical or requested identities by frozen order", () => {
    const first = qualification([
      legacyExact({
        anchorId: "owner/shared#1",
        captureOrder: 1,
      }),
    ]);
    const second = qualification([
      visibleExact({
        anchorId: "owner/other#2",
        captureOrder: 1,
        requestedAnchorId: "owner/shared#1",
        rowIndex: 0,
      }),
    ]);
    const empty = qualification([
      visibleNoExact({
        anchorId: "owner/no-exact#3",
        captureOrder: 1,
        rowIndex: 0,
      }),
    ], {
      datasetId: "SWE-bench-Live/MultiLang",
      revision: LIVE_REVISION,
    });

    const frame = projectC6ReviewerActorQualifiedScreeningFrame({
      liveMultilangQualificationBytes: bytes(empty),
      liveMultilangQualificationPath: "/fixtures/live.json",
      multiSweQualificationBytes: bytes(first),
      multiSweQualificationPath: "/fixtures/multi.json",
      multilingualQualificationBytes: bytes(second),
      multilingualQualificationPath: "/fixtures/multilingual.json",
      supersededFrameBytes: bytes(supersededFrame()),
      supersededFramePath: "/fixtures/frame-v4.json",
    });

    expect(frame.candidates).toHaveLength(1);
    expect(frame.candidates[0]?.canonicalAnchorId).toBe(
      "owner/shared#1",
    );
    expect(frame.counts.deduplicatedCandidateCount).toBe(1);
  });

  test("rejects a qualification whose declared exact projection was changed", () => {
    const qualificationValue = qualification([
      legacyExact({
        anchorId: "owner/multi#1",
        captureOrder: 1,
      }),
    ]);
    qualificationValue.independenceBoundary
      .exactFreshCandidateProjectionSha256 = HASH_F;

    expect(() => projectC6ReviewerActorQualifiedScreeningFrame({
      liveMultilangQualificationBytes: bytes(qualification([
        visibleNoExact({
          anchorId: "owner/live#3",
          captureOrder: 1,
          rowIndex: 0,
        }),
      ], {
        datasetId: "SWE-bench-Live/MultiLang",
        revision: LIVE_REVISION,
      })),
      liveMultilangQualificationPath: "/fixtures/live.json",
      multiSweQualificationBytes: bytes(qualificationValue),
      multiSweQualificationPath: "/fixtures/multi.json",
      multilingualQualificationBytes: bytes(qualification([
        visibleNoExact({
          anchorId: "owner/multilingual#2",
          captureOrder: 1,
          rowIndex: 0,
        }),
      ])),
      multilingualQualificationPath: "/fixtures/multilingual.json",
      supersededFrameBytes: bytes(supersededFrame()),
      supersededFramePath: "/fixtures/frame-v4.json",
    })).toThrow("qualification candidate projection mismatch");
  });

  test("recomputes repository-capped capacity after definitive rejects", () => {
    const frame = projectC6ReviewerActorQualifiedScreeningFrame({
      liveMultilangQualificationBytes: bytes(qualification([
        visibleExact({
          anchorId: "owner/live#3",
          captureOrder: 1,
          rowIndex: 0,
        }),
      ], {
        datasetId: "SWE-bench-Live/MultiLang",
        revision: LIVE_REVISION,
      })),
      liveMultilangQualificationPath: "/fixtures/live.json",
      multiSweQualificationBytes: bytes(qualification([
        legacyExact({
          anchorId: "owner/multi#1",
          captureOrder: 1,
        }),
      ])),
      multiSweQualificationPath: "/fixtures/multi.json",
      multilingualQualificationBytes: bytes(qualification([
        visibleExact({
          anchorId: "owner/multilingual#2",
          captureOrder: 1,
          rowIndex: 0,
        }),
      ])),
      multilingualQualificationPath: "/fixtures/multilingual.json",
      supersededFrameBytes: bytes(supersededFrame()),
      supersededFramePath: "/fixtures/frame-v4.json",
    });

    const capacity = deriveC6ReviewerActorQualifiedScreeningCapacity({
      frame,
      rejectedRequestedAnchorIds: ["owner/multilingual#2"],
    });

    expect(capacity).toMatchObject({
      canMeetHeadlineMinimumUnderRepositoryCap: false,
      canMeetScreeningBatchMinimumUnderRepositoryCap: false,
      currentFrameSemanticScreeningReady: false,
      definitiveRejectedCandidateCount: 1,
      headlineMinimumEpisodeFloor: 391,
      headlineSelectableMargin: -389,
      remainingStructuralCandidateCount: 2,
      repositoryCappedStructuralCeiling: 2,
      screeningBatchSelectableMargin: -46,
    });
  });
});

function qualification(
  results: Record<string, unknown>[],
  sourceDataset?: {
    datasetId: string;
    revision: string;
  },
): Record<string, any> {
  const exact = results.filter(
    (result) =>
      result.status ===
        "actor-filtered-exact-structural-candidate",
  );
  const noExact = results.filter(
    (result) =>
      result.status ===
        "no-actor-filtered-exact-structural-sequence",
  );
  const overlap = results.filter(
    (result) => result.status === "prior-frame-overlap",
  );
  return {
    artifactKind:
      "c6-reviewer-actor-filtered-source-expansion-qualification",
    boundary: {
      acceptedEpisodeCount: 0,
      automationExclusionComplete: false,
      candidateManifestFrozen: false,
      codexRunReady: false,
      eventTimeActorTypeProven: false,
      humanReviewerIdentityProven: false,
      machineQualifiedEpisodeCount: 0,
      status:
        "actor-filtered-exact-structural-screening-semantic-review-required",
    },
    counts: {
      actorFilteredExactFreshCandidateCount: exact.length,
      actorFilteredNoExactFreshSequenceCount: noExact.length,
      actorIneligibleEventCount: 0,
      actorPlanTargetCount: 1,
      actorQualifiedEventCount: results.length * 2,
      priorFrameOverlapCount: overlap.length,
      targetCount: results.length,
    },
    independenceBoundary: {
      candidateOrderChanged: false,
      exactFreshCandidateProjectionSha256: sha256(
        JSON.stringify(exact.map(exactProjection)),
      ),
      goldInput: false,
      machineOutcomeInput: false,
      semanticLedgerInput: false,
    },
    inputs: {
      actorPlanSha256: HASH_A,
      actorRootSha256: HASH_B,
      baseQualificationSha256: HASH_C,
      graphqlRootSha256: HASH_D,
    },
    policies: {
      actor: {
        definition: {},
        sha256: HASH_E,
      },
      structuralReview: {
        definition: {},
        sha256: HASH_F,
      },
    },
    results,
    rule: {},
    schemaVersion: 1,
    ...(sourceDataset === undefined ? {} : { sourceDataset }),
  };
}

function legacyExact(input: {
  anchorId: string;
  captureOrder: number;
}): Record<string, unknown> {
  return exactFields({
    canonicalAnchorId: input.anchorId,
    canonicalRepository: input.anchorId.split("#")[0],
    captureDirectory: `capture-${input.captureOrder}`,
    captureOrder: input.captureOrder,
    pullAuthor: "pull-author",
    requestedAnchorId: input.anchorId,
    source: {
      path: "go/owner__repo_dataset.jsonl",
      rowIndex: 99,
      rowSha256: HASH_A,
    },
  });
}

function visibleExact(input: {
  anchorId: string;
  captureOrder: number;
  requestedAnchorId?: string;
  rowIndex: number;
  sourceSplit?: string;
  sourceSplitRowIndex?: number;
  status?:
    | "actor-filtered-exact-structural-candidate"
    | "prior-frame-overlap";
}): Record<string, unknown> {
  return exactFields({
    agentVisibleRequestSha256: HASH_A,
    canonicalAnchorId: input.anchorId,
    canonicalRepository: input.anchorId.split("#")[0],
    captureDirectory: `capture-${input.captureOrder}`,
    captureOrder: input.captureOrder,
    instanceId: `instance-${input.captureOrder}`,
    pullAuthor: "pull-author",
    requestedAnchorId: input.requestedAnchorId ?? input.anchorId,
    rowIndex: input.rowIndex,
    ...(input.sourceSplit === undefined
      ? {}
      : {
        sourceSplit: input.sourceSplit,
        sourceSplitRowIndex: input.sourceSplitRowIndex,
      }),
    ...(input.status === "prior-frame-overlap"
      ? {
        actorFilteredQualification: "exact-sequence",
        status: input.status,
      }
      : {}),
  });
}

function exactFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...fields,
    actorIneligibleEventCount: 0,
    actorQualifiedEventCount: 2,
    baseSequenceLineageIdentitySha256: HASH_B,
    exactSequence: {
      firstFixCommit: "1".repeat(40),
      firstReview: { author: "reviewer-one" },
      initialCommit: "0".repeat(40),
      secondFixCommit: "2".repeat(40),
      secondReview: { author: "reviewer-two" },
    },
    exactSequenceLineageIdentitySha256: HASH_C,
    firstReviewActorManifestSha256: HASH_D,
    secondReviewActorManifestSha256: HASH_E,
    status:
      fields.status ??
      "actor-filtered-exact-structural-candidate",
  };
}

function visibleNoExact(input: {
  anchorId: string;
  captureOrder: number;
  rowIndex: number;
}): Record<string, unknown> {
  return {
    agentVisibleRequestSha256: HASH_A,
    canonicalAnchorId: input.anchorId,
    canonicalRepository: input.anchorId.split("#")[0],
    captureDirectory: `capture-${input.captureOrder}`,
    captureOrder: input.captureOrder,
    instanceId: `instance-${input.captureOrder}`,
    pullAuthor: "pull-author",
    requestedAnchorId: input.anchorId,
    rowIndex: input.rowIndex,
    status: "no-actor-filtered-exact-structural-sequence",
    actorIneligibleEventCount: 0,
    actorQualifiedEventCount: 0,
  };
}

function exactProjection(result: Record<string, any>): unknown {
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
    agentVisibleRequestSha256: result.agentVisibleRequestSha256,
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

function supersededFrame(): Record<string, unknown> {
  const candidates = [{
    canonicalAnchorId: "legacy/only#1",
    canonicalRepository: "legacy/only",
    lineageIdentitySha256: HASH_A,
    requestedAnchorId: "legacy/only#1",
    screeningRank: 1,
    source: {},
    sourceRank: 1,
    sourceTranche: "legacy",
  }];
  return {
    artifactKind: "c6-source-expansion-screening-frame",
    boundary: {
      candidateManifestFrozen: false,
      codexRunReady: false,
    },
    candidates,
    independenceBoundary: {
      candidateProjectionSha256: sha256(JSON.stringify(candidates)),
    },
    schemaVersion: 4,
  };
}

function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
