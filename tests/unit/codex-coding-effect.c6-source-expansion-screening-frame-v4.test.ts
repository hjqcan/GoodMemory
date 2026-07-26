import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
  deriveC6SourceExpansionScreeningFrameV4Capacity,
  projectC6SourceExpansionScreeningFrameV4,
} from "../../scripts/codex-coding-effect/c6-source-expansion-screening-frame-v4";

describe("Codex coding-effect C6 source expansion screening frame v4", () => {
  it("preserves the complete v3 prefix and appends Live exact rows in capture order", () => {
    const fixture = createFixture();
    const frame = projectC6SourceExpansionScreeningFrameV4(fixture);
    const prior = JSON.parse(
      fixture.priorFrameBytes.toString("utf8"),
    ) as { candidates: unknown[] };

    expect(
      JSON.stringify(frame.candidates.slice(0, prior.candidates.length)),
    ).toBe(JSON.stringify(prior.candidates));
    expect(frame.candidates.map((candidate) => candidate.screeningRank))
      .toEqual([1, 2, 3]);
    expect(frame.candidates[2]).toEqual({
      canonicalAnchorId: "live/repo#3",
      canonicalRepository: "live/repo",
      lineageIdentitySha256: "e".repeat(64),
      requestedAnchorId: "live/repo#3",
      screeningRank: 3,
      source: {
        agentVisibleRequestSha256: "f".repeat(64),
        datasetId: "SWE-bench-Live/MultiLang",
        instanceId: "live__repo-3",
        sourceRevision:
          "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b",
        sourceRowIndex: 2,
        sourceSplit: "c",
        sourceSplitRowIndex: 2,
      },
      sourceRank: 3,
      sourceTranche:
        "swe-bench-live-multilang-608f7ae9-exact-v1",
    });
    expect(frame.counts).toMatchObject({
      combinedStructuralCandidateCount: 3,
      liveMultilangExactCandidateCount: 1,
      priorFrameCandidateCount: 2,
      repositoryCappedStructuralCeiling: 3,
    });
    expect(frame.independenceBoundary).toMatchObject({
      machineOutcomeInput: false,
      priorFrameOrderPreserved: true,
      semanticLedgerInput: false,
    });
  });

  it("derives rejection capacity without feeding rejection outcomes into construction", () => {
    const fixture = createFixture();
    const frame = projectC6SourceExpansionScreeningFrameV4(fixture);
    const capacity = deriveC6SourceExpansionScreeningFrameV4Capacity({
      frame,
      rejectedRequestedAnchorIds: ["old/one#1"],
    });

    expect(capacity).toEqual({
      canMeetMinimumUnderRepositoryCap: false,
      canStartFullSemanticScreening: false,
      definitiveRejectedCandidateCount: 1,
      fullScreeningBufferRequired: 72,
      minimumRequiredEpisodes: 48,
      remainingStructuralCandidateCount: 2,
      repositoryCappedStructuralCeiling: 2,
      selectableMargin: -46,
    });

    const qualification = JSON.parse(
      fixture.qualificationBytes.toString("utf8"),
    ) as Record<string, unknown>;
    qualification.semanticLedger = { decision: "reject" };
    qualification.goldPatch = "forbidden-but-ignored";
    const mutated = projectC6SourceExpansionScreeningFrameV4({
      ...fixture,
      qualificationBytes: bytes(qualification),
    });
    expect(mutated.independenceBoundary.candidateProjectionSha256)
      .toBe(frame.independenceBoundary.candidateProjectionSha256);
  });

  it("rejects source-locator drift, overlap, and prior projection drift", () => {
    const locatorDrift = createFixture();
    const locatorQualification = JSON.parse(
      locatorDrift.qualificationBytes.toString("utf8"),
    ) as {
      results: Array<Record<string, unknown>>;
    };
    locatorQualification.results[1]!.sourceSplitRowIndex = 99;
    expect(() =>
      projectC6SourceExpansionScreeningFrameV4({
        ...locatorDrift,
        qualificationBytes: bytes(locatorQualification),
      })
    ).toThrow("source locator");

    const overlap = createFixture();
    const overlapQualification = JSON.parse(
      overlap.qualificationBytes.toString("utf8"),
    ) as {
      results: Array<Record<string, unknown>>;
    };
    overlapQualification.results[1]!.canonicalAnchorId = "old/one#1";
    overlapQualification.results[1]!.canonicalRepository = "old/one";
    refreshQualificationProjection(overlapQualification);
    expect(() =>
      projectC6SourceExpansionScreeningFrameV4({
        ...overlap,
        qualificationBytes: bytes(overlapQualification),
      })
    ).toThrow("candidate collision");

    const crossSpace = createFixture();
    const crossPrior = JSON.parse(
      crossSpace.priorFrameBytes.toString("utf8"),
    ) as {
      candidates: Array<{
        canonicalAnchorId: string;
        canonicalRepository: string;
        requestedAnchorId: string;
      }>;
      independenceBoundary: {
        candidateProjectionSha256: string;
      };
    };
    crossPrior.candidates[0]!.canonicalAnchorId = "old/canonical#1";
    crossPrior.candidates[0]!.canonicalRepository = "old/canonical";
    crossPrior.candidates[0]!.requestedAnchorId = "old/requested#1";
    crossPrior.independenceBoundary.candidateProjectionSha256 = sha256(
      JSON.stringify(crossPrior.candidates),
    );
    const crossQualification = JSON.parse(
      crossSpace.qualificationBytes.toString("utf8"),
    ) as {
      results: Array<Record<string, unknown>>;
    };
    crossQualification.results[1]!.canonicalAnchorId =
      "old/requested#1";
    crossQualification.results[1]!.canonicalRepository =
      "old/requested";
    refreshQualificationProjection(crossQualification);
    expect(() =>
      projectC6SourceExpansionScreeningFrameV4({
        ...crossSpace,
        priorFrameBytes: bytes(crossPrior),
        qualificationBytes: bytes(crossQualification),
      })
    ).toThrow("candidate collision");

    const repositoryDrift = createFixture();
    const repositoryQualification = JSON.parse(
      repositoryDrift.qualificationBytes.toString("utf8"),
    ) as {
      results: Array<Record<string, unknown>>;
    };
    repositoryQualification.results[1]!.canonicalRepository =
      "wrong/repo";
    refreshQualificationProjection(repositoryQualification);
    expect(() =>
      projectC6SourceExpansionScreeningFrameV4({
        ...repositoryDrift,
        qualificationBytes: bytes(repositoryQualification),
      })
    ).toThrow("canonical repository mismatch");

    const projectionDrift = createFixture();
    const projectionQualification = JSON.parse(
      projectionDrift.qualificationBytes.toString("utf8"),
    ) as {
      results: Array<Record<string, unknown>>;
    };
    projectionQualification.results[1]!.exactSequence = {
      changed: true,
    };
    expect(() =>
      projectC6SourceExpansionScreeningFrameV4({
        ...projectionDrift,
        qualificationBytes: bytes(projectionQualification),
      })
    ).toThrow("qualification candidate projection mismatch");

    const drift = createFixture();
    const prior = JSON.parse(
      drift.priorFrameBytes.toString("utf8"),
    ) as {
      candidates: Array<{ requestedAnchorId: string }>;
    };
    prior.candidates[0]!.requestedAnchorId = "drift/repo#1";
    expect(() =>
      projectC6SourceExpansionScreeningFrameV4({
        ...drift,
        priorFrameBytes: bytes(prior),
      })
    ).toThrow("prior candidate projection mismatch");
  });
});

function createFixture() {
  const priorCandidates = [
    candidate("old/one#1", 1),
    candidate("old/two#2", 2),
  ];
  const priorFrame = {
    artifactKind: "c6-source-expansion-screening-frame",
    candidates: priorCandidates,
    counts: {
      combinedStructuralCandidateCount: priorCandidates.length,
      repositoryCappedStructuralCeiling: 2,
      repositoryCount: 2,
    },
    independenceBoundary: {
      candidateProjectionSha256: sha256(
        JSON.stringify(priorCandidates),
      ),
    },
    schemaVersion: 3,
  };
  const results = [
    result("live/none#2", 2, "no-exact-structural-sequence"),
    result("live/repo#3", 3, "exact-structural-candidate"),
  ];
  const qualification = {
    artifactKind: "c6-multilingual-source-expansion-qualification",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      pullIdentityClosureComplete: true,
    },
    counts: {
      exactFreshCandidateCount: 1,
      identityClosureCount: 2,
      noExactFreshSequenceCount: 1,
      priorFrameOverlapCount: 0,
      targetCount: 2,
    },
    independenceBoundary: {
      exactFreshCandidateProjectionSha256: sha256(JSON.stringify(
        results.filter(
          (value) => value.status === "exact-structural-candidate",
        ).map(qualificationCandidateProjection),
      )),
      machineOutcomeInput: false,
      semanticLedgerInput: false,
    },
    inputs: {
      expansionSha256: "8".repeat(64),
    },
    results,
    schemaVersion: 1,
    sourceDataset: {
      datasetId: "SWE-bench-Live/MultiLang",
      revision: "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b",
    },
  };
  return {
    priorFrameBytes: bytes(priorFrame),
    priorFramePath: "frame-v3.json",
    qualificationBytes: bytes(qualification),
    qualificationPath: "qualification.json",
  };
}

function candidate(anchor: string, rank: number) {
  const repository = anchor.slice(0, anchor.lastIndexOf("#"));
  return {
    canonicalAnchorId: anchor,
    canonicalRepository: repository,
    lineageIdentitySha256: String(rank).repeat(64),
    requestedAnchorId: anchor,
    screeningRank: rank,
    source: {
      path: `repo-${rank}.jsonl`,
      rowIndex: rank,
      rowSha256: String(rank + 1).repeat(64),
    },
    sourceRank: rank,
    sourceTranche: "legacy-screening-frame-v1",
  };
}

function result(
  anchor: string,
  captureOrder: number,
  status:
    | "exact-structural-candidate"
    | "no-exact-structural-sequence",
) {
  const repository = anchor.slice(0, anchor.lastIndexOf("#"));
  const [owner, repo] = repository.split("/");
  return {
    agentVisibleRequestSha256: "f".repeat(64),
    canonicalAnchorId: anchor,
    canonicalRepository: repository,
    captureDirectory: `${owner}__${repo}__${anchor.split("#")[1]}`,
    captureOrder,
    exactSequenceLineageIdentitySha256: status ===
        "exact-structural-candidate"
      ? "e".repeat(64)
      : undefined,
    exactSequence: status === "exact-structural-candidate"
      ? { marker: anchor }
      : undefined,
    instanceId: `${owner}__${repo}-${anchor.split("#")[1]}`,
    requestedAnchorId: anchor,
    rowIndex: captureOrder - 1,
    sourceSplit: "c",
    sourceSplitRowIndex: captureOrder - 1,
    status,
  };
}

function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function qualificationCandidateProjection(
  value: Record<string, unknown>,
) {
  return {
    agentVisibleRequestSha256: value.agentVisibleRequestSha256,
    canonicalAnchorId: value.canonicalAnchorId,
    captureOrder: value.captureOrder,
    exactSequence: value.exactSequence,
    exactSequenceLineageIdentitySha256:
      value.exactSequenceLineageIdentitySha256,
    instanceId: value.instanceId,
    rowIndex: value.rowIndex,
    sourceSplit: value.sourceSplit,
    sourceSplitRowIndex: value.sourceSplitRowIndex,
  };
}

function refreshQualificationProjection(
  qualification: Record<string, unknown>,
): void {
  const results = qualification.results as Array<Record<string, unknown>>;
  const boundary = qualification.independenceBoundary as {
    exactFreshCandidateProjectionSha256: string;
  };
  boundary.exactFreshCandidateProjectionSha256 = sha256(JSON.stringify(
    results.filter(
      (value) => value.status === "exact-structural-candidate",
    ).map(qualificationCandidateProjection),
  ));
}
