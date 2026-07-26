import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
  deriveC6SourceExpansionScreeningFrameV3Capacity,
  projectC6SourceExpansionScreeningFrameV3,
} from "../../scripts/codex-coding-effect/c6-source-expansion-screening-frame-v3";

describe("Codex coding-effect C6 source expansion screening frame v3", () => {
  it("preserves the complete v2 candidate prefix and appends exact fresh rows in source order", () => {
    const fixture = createFixture();
    const frame = projectC6SourceExpansionScreeningFrameV3(fixture);
    const prior = JSON.parse(
      fixture.priorFrameBytes.toString("utf8"),
    ) as { candidates: unknown[] };

    expect(
      JSON.stringify(frame.candidates.slice(0, prior.candidates.length)),
    ).toBe(JSON.stringify(prior.candidates));
    expect(frame.candidates.map((candidate) => candidate.screeningRank))
      .toEqual([1, 2, 3]);
    expect(frame.candidates[2]).toEqual({
      canonicalAnchorId: "new/repo#3",
      canonicalRepository: "new/repo",
      lineageIdentitySha256: "e".repeat(64),
      requestedAnchorId: "new/repo#3",
      screeningRank: 3,
      source: {
        agentVisibleRequestSha256: "f".repeat(64),
        datasetId: "SWE-bench/SWE-bench_Multilingual",
        instanceId: "new__repo-3",
        sourceRevision:
          "e5c585e008e2cb5eecc7c64192d855c53279d788",
        sourceRowIndex: 2,
      },
      sourceRank: 3,
      sourceTranche: "swe-bench-multilingual-e5c585e-exact-v1",
    });
    expect(frame.counts).toMatchObject({
      combinedStructuralCandidateCount: 3,
      multilingualExactCandidateCount: 1,
      priorFrameCandidateCount: 2,
      repositoryCappedStructuralCeiling: 3,
    });
    expect(frame.independenceBoundary).toMatchObject({
      machineOutcomeInput: false,
      priorFrameOrderPreserved: true,
      semanticLedgerInput: false,
    });
  });

  it("derives rejection capacity separately from candidate construction", () => {
    const frame = projectC6SourceExpansionScreeningFrameV3(
      createFixture(),
    );
    const capacity = deriveC6SourceExpansionScreeningFrameV3Capacity({
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
    expect(() =>
      deriveC6SourceExpansionScreeningFrameV3Capacity({
        frame,
        rejectedRequestedAnchorIds: ["unknown/repo#9"],
      })
    ).toThrow("unknown rejected candidate");
  });

  it("rejects overlap, order drift, and prior projection drift", () => {
    const overlap = createFixture();
    const qualification = JSON.parse(
      overlap.qualificationBytes.toString("utf8"),
    ) as { results: Array<Record<string, unknown>> };
    qualification.results[1]!.canonicalAnchorId = "old/one#1";
    expect(() =>
      projectC6SourceExpansionScreeningFrameV3({
        ...overlap,
        qualificationBytes: bytes(qualification),
      })
    ).toThrow("candidate collision");

    const order = createFixture();
    const orderQualification = JSON.parse(
      order.qualificationBytes.toString("utf8"),
    ) as { results: Array<{ captureOrder: number }> };
    orderQualification.results[1]!.captureOrder = 1;
    expect(() =>
      projectC6SourceExpansionScreeningFrameV3({
        ...order,
        qualificationBytes: bytes(orderQualification),
      })
    ).toThrow("result order");

    const drift = createFixture();
    const prior = JSON.parse(
      drift.priorFrameBytes.toString("utf8"),
    ) as {
      candidates: Array<{ requestedAnchorId: string }>;
    };
    prior.candidates[0]!.requestedAnchorId = "drift/repo#1";
    expect(() =>
      projectC6SourceExpansionScreeningFrameV3({
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
    schemaVersion: 2,
  };
  const results = [
    result("old/one#1", 1, "prior-frame-overlap"),
    result("new/repo#3", 3, "exact-structural-candidate"),
    result("new/none#4", 4, "no-exact-structural-sequence"),
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
      identityClosureCount: 3,
      noExactFreshSequenceCount: 1,
      priorFrameOverlapCount: 1,
      targetCount: 3,
    },
    independenceBoundary: {
      exactFreshCandidateProjectionSha256: "9".repeat(64),
      machineOutcomeInput: false,
      semanticLedgerInput: false,
    },
    inputs: {
      expansionSha256: "8".repeat(64),
    },
    results,
    schemaVersion: 1,
  };
  return {
    priorFrameBytes: bytes(priorFrame),
    priorFramePath: "frame-v2.json",
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
    | "no-exact-structural-sequence"
    | "prior-frame-overlap",
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
    instanceId: `${owner}__${repo}-${anchor.split("#")[1]}`,
    requestedAnchorId: anchor,
    rowIndex: captureOrder - 1,
    status,
  };
}

function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
