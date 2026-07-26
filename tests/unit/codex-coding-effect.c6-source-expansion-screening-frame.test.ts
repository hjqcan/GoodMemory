import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  deriveC6SourceExpansionScreeningFrameCapacity,
  materializeC6SourceExpansionScreeningFrame,
  projectC6SourceExpansionScreeningFrame,
  serializeC6SourceExpansionScreeningFrame,
} from "../../scripts/codex-coding-effect/c6-source-expansion-screening-frame";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) =>
    rm(path, { force: true, recursive: true })
  ));
});

describe("Codex coding-effect C6 source-expansion screening frame", () => {
  it("appends exact REST candidates after the complete legacy order", () => {
    const fixture = createFixture();
    const frame = projectC6SourceExpansionScreeningFrame(fixture);

    expect(frame.boundary).toEqual({
      acceptedEpisodeCount: 0,
      adaptiveProspective: true,
      candidateManifestFrozen: false,
      captureAttemptCompletenessProven: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      status:
        "combined-structural-screening-frame-semantic-and-machine-qualification-required",
      structuralCapacityOnly: true,
    });
    expect(frame.candidates).toEqual([
      {
        canonicalAnchorId: "canonical/renamed#1",
        canonicalRepository: "canonical/renamed",
        lineageIdentitySha256: sha256("legacy-lineage-1"),
        requestedAnchorId: "legacy/renamed#1",
        screeningRank: 1,
        source: source("old.jsonl", 1),
        sourceRank: 1,
        sourceTranche: "legacy-screening-frame-v1",
      },
      {
        canonicalAnchorId: "same/repo#2",
        canonicalRepository: "same/repo",
        lineageIdentitySha256: sha256("legacy-lineage-2"),
        requestedAnchorId: "same/repo#2",
        screeningRank: 2,
        source: source("old.jsonl", 2),
        sourceRank: 2,
        sourceTranche: "legacy-screening-frame-v1",
      },
      {
        canonicalAnchorId: "extra/repo#3",
        canonicalRepository: "extra/repo",
        lineageIdentitySha256: sha256("exact-lineage-3"),
        requestedAnchorId: "extra/repo#3",
        screeningRank: 3,
        source: source("new.jsonl", 3),
        sourceRank: 1,
        sourceTranche: "prospective-rest-exact-v2",
      },
      {
        canonicalAnchorId: "canonical/renamed#4",
        canonicalRepository: "canonical/renamed",
        lineageIdentitySha256: sha256("exact-lineage-4"),
        requestedAnchorId: "legacy/renamed#4",
        screeningRank: 4,
        source: source("new.jsonl", 4),
        sourceRank: 3,
        sourceTranche: "prospective-rest-exact-v2",
      },
    ]);
    expect(frame.counts).toEqual({
      combinedStructuralCandidateCount: 4,
      exactStructuralCandidateCount: 2,
      legacyCandidateCount: 2,
      minimumRequiredEpisodes: 48,
      missingRestClosureCount: 1,
      noExactStructuralSequenceCount: 0,
      qualificationTargetCount: 3,
      rawStructuralMargin: -44,
      repositoryCappedStructuralCeiling: 4,
      repositoryCount: 3,
    });
    expect(frame.independenceBoundary).toMatchObject({
      adaptiveProspective: true,
      legacyOrderPreserved: true,
      machineOutcomeInput: false,
      personnelOutcomeBlindnessClaimed: false,
      prospectiveTrancheAppendedAfterLegacyFrame: true,
      selectionDependsOnForbiddenFields: false,
      semanticLedgerInput: false,
    });
    expect(frame.policy.order).toBe(
      "complete-legacy-screeningRank-then-exact-v2-restCaptureOrder",
    );
  });

  it("keeps outcome-like metadata outside the candidate projection", () => {
    const fixture = createFixture();
    const baseline = projectC6SourceExpansionScreeningFrame(fixture);
    const qualification = JSON.parse(
      fixture.qualificationBytes.toString("utf8"),
    ) as {
      results: Array<Record<string, unknown>>;
    };
    qualification.results[0]!.gold = "forbidden";
    qualification.results[0]!.outcome = "forbidden";

    const mutated = projectC6SourceExpansionScreeningFrame({
      ...fixture,
      qualificationBytes: bytes(qualification),
    });

    expect(mutated.independenceBoundary.candidateProjectionSha256).toBe(
      baseline.independenceBoundary.candidateProjectionSha256,
    );
    expect(mutated.independenceBoundary.exactCandidateProjectionSha256).toBe(
      baseline.independenceBoundary.exactCandidateProjectionSha256,
    );
  });

  it("derives rejection-bound capacity without feeding it into selection", () => {
    const frame = projectC6SourceExpansionScreeningFrame(createFixture());

    expect(deriveC6SourceExpansionScreeningFrameCapacity({
      frame,
      rejectedRequestedAnchorIds: ["legacy/renamed#1"],
    })).toEqual({
      canMeetMinimumUnderRepositoryCap: false,
      definitivelyRejectedCandidateCount: 1,
      minimumRequiredEpisodes: 48,
      remainingStructuralCandidateCount: 3,
      repositoryCappedStructuralCeiling: 3,
      selectableMargin: -45,
    });
    expect(() => deriveC6SourceExpansionScreeningFrameCapacity({
      frame,
      rejectedRequestedAnchorIds: ["unknown/repo#1"],
    })).toThrow("unknown rejected candidate");
  });

  it("fails closed on projection, count, source, order, and identity drift", () => {
    const projectionDrift = createFixture();
    const legacyFrame = JSON.parse(
      projectionDrift.legacyFrameBytes.toString("utf8"),
    ) as {
      candidates: Array<{ anchorId: string }>;
    };
    legacyFrame.candidates[0]!.anchorId = "drift/repo#1";
    expect(() => projectC6SourceExpansionScreeningFrame({
      ...projectionDrift,
      legacyFrameBytes: bytes(legacyFrame),
    })).toThrow("legacy candidate projection mismatch");

    const countDrift = createFixture();
    const qualification = JSON.parse(
      countDrift.qualificationBytes.toString("utf8"),
    ) as {
      counts: { exactStructuralCandidateCount: number };
    };
    qualification.counts.exactStructuralCandidateCount = 3;
    expect(() => projectC6SourceExpansionScreeningFrame({
      ...countDrift,
      qualificationBytes: bytes(qualification),
    })).toThrow("qualification count mismatch");

    const sourceDrift = createFixture();
    const missingSource = JSON.parse(
      sourceDrift.qualificationBytes.toString("utf8"),
    ) as {
      results: Array<Record<string, unknown>>;
    };
    delete missingSource.results[0]!.source;
    expect(() => projectC6SourceExpansionScreeningFrame({
      ...sourceDrift,
      qualificationBytes: bytes(missingSource),
    })).toThrow();

    const orderDrift = createFixture();
    const outOfOrder = JSON.parse(
      orderDrift.qualificationBytes.toString("utf8"),
    ) as {
      results: Array<{ captureOrder: number }>;
    };
    outOfOrder.results[1]!.captureOrder = 4;
    expect(() => projectC6SourceExpansionScreeningFrame({
      ...orderDrift,
      qualificationBytes: bytes(outOfOrder),
    })).toThrow("capture order must be contiguous");

    const collisionDrift = createFixture();
    const collision = JSON.parse(
      collisionDrift.qualificationBytes.toString("utf8"),
    ) as {
      results: Array<{ canonicalAnchorId: string }>;
    };
    collision.results[0]!.canonicalAnchorId = "same/repo#2";
    expect(() => projectC6SourceExpansionScreeningFrame({
      ...collisionDrift,
      qualificationBytes: bytes(collision),
    })).toThrow("canonical candidate collision");
  });

  it("materializes once from exact hashes and never leaves bad-hash output", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "c6-screening-frame-")),
    );
    cleanup.push(root);
    const fixture = createFixture();
    const inventoryPath = join(root, "inventory.json");
    const legacyFramePath = join(root, "legacy.json");
    const qualificationPath = join(root, "qualification.json");
    const outputPath = join(root, "frame.json");
    const badOutputPath = join(root, "bad-frame.json");
    await Promise.all([
      writeFile(inventoryPath, fixture.inventoryBytes),
      writeFile(legacyFramePath, fixture.legacyFrameBytes),
      writeFile(qualificationPath, fixture.qualificationBytes),
    ]);
    const input = {
      expectedInventorySha256: sha256(fixture.inventoryBytes),
      expectedLegacyFrameSha256: sha256(fixture.legacyFrameBytes),
      expectedQualificationSha256: sha256(fixture.qualificationBytes),
      inventoryPath,
      legacyFramePath,
      outputPath,
      qualificationPath,
    };

    const result = await materializeC6SourceExpansionScreeningFrame(input);

    expect(await readFile(outputPath, "utf8")).toBe(
      serializeC6SourceExpansionScreeningFrame(result.frame),
    );
    await expect(materializeC6SourceExpansionScreeningFrame(input))
      .rejects.toThrow("EEXIST");
    await expect(materializeC6SourceExpansionScreeningFrame({
      ...input,
      expectedInventorySha256: "f".repeat(64),
      outputPath: badOutputPath,
    })).rejects.toThrow("inventory hash mismatch");
    await expect(readFile(badOutputPath)).rejects.toThrow();
  });
});

function createFixture() {
  const legacyCandidates = [
    {
      anchorId: "legacy/renamed#1",
      lineageIdentitySha256: sha256("legacy-lineage-1"),
      screeningRank: 1,
      source: source("old.jsonl", 1),
    },
    {
      anchorId: "same/repo#2",
      lineageIdentitySha256: sha256("legacy-lineage-2"),
      screeningRank: 2,
      source: source("old.jsonl", 2),
    },
  ];
  const legacyFrame = {
    artifactKind: "c6-real-history-screening-frame",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
    },
    candidates: legacyCandidates,
    counts: {
      eligibleCandidateCount: legacyCandidates.length,
    },
    independenceBoundary: {
      candidateProjectionSha256: sha256(JSON.stringify(legacyCandidates)),
    },
    schemaVersion: 1,
  };
  const inventory = {
    anchors: [
      { anchorId: "legacy/renamed#1", number: 1 },
      { anchorId: "same/repo#2", number: 2 },
    ],
    artifactKind: "c6-github-graphql-discovery-inventory",
    captureEntries: [
      {
        anchorId: "legacy/renamed#1",
        repository: {
          redirected: true,
          requested: "legacy/renamed",
          resolved: "Canonical/Renamed",
        },
      },
      {
        anchorId: "same/repo#2",
        repository: {
          redirected: false,
          requested: "same/repo",
          resolved: "same/repo",
        },
      },
    ],
    schemaVersion: 1,
  };
  const qualification = {
    artifactKind: "c6-source-expansion-rest-qualification",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureAttemptCompletenessProven: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      status: "exact-structural-screening-not-semantic-qualification",
    },
    counts: {
      capturedClosureCount: 2,
      exactStructuralCandidateCount: 2,
      exactStructuralRepositoryCount: 2,
      missingClosureCount: 1,
      repositoryCappedStructuralCeiling: 2,
      targetCount: 3,
    },
    inputs: {
      capturePlanSha256: sha256("capture-plan"),
      graphqlRootSha256: sha256("graphql-root"),
      restRootSha256: sha256("rest-root"),
    },
    results: [
      exactResult({
        anchorId: "extra/repo#3",
        canonicalAnchorId: "extra/repo#3",
        captureOrder: 1,
        lineage: "exact-lineage-3",
        source: source("new.jsonl", 3),
      }),
      {
        anchorId: "missing/repo#5",
        canonicalAnchorId: "missing/repo#5",
        captureDirectory: "missing__repo__5",
        captureOrder: 2,
        status: "missing-rest-closure",
      },
      exactResult({
        anchorId: "legacy/renamed#4",
        canonicalAnchorId: "canonical/renamed#4",
        captureOrder: 3,
        lineage: "exact-lineage-4",
        source: source("new.jsonl", 4),
      }),
    ],
    schemaVersion: 1,
  };
  return {
    inventoryBytes: bytes(inventory),
    inventoryPath: "inventory.json",
    legacyFrameBytes: bytes(legacyFrame),
    legacyFramePath: "legacy-frame.json",
    qualificationBytes: bytes(qualification),
    qualificationPath: "qualification.json",
  };
}

function exactResult(input: {
  anchorId: string;
  canonicalAnchorId: string;
  captureOrder: number;
  lineage: string;
  source: ReturnType<typeof source>;
}) {
  return {
    anchorId: input.anchorId,
    canonicalAnchorId: input.canonicalAnchorId,
    captureDirectory: input.anchorId.replaceAll(/[\\/#]/gu, "__"),
    captureManifestSha256: sha256(`manifest-${input.anchorId}`),
    captureOrder: input.captureOrder,
    exactEventCount: 2,
    exactLineageIdentitySha256: sha256(input.lineage),
    exactSequence: {
      firstFixCommit: "2".repeat(40),
      firstReview: review("first"),
      initialCommit: "1".repeat(40),
      secondFixCommit: "4".repeat(40),
      secondReview: review("second", "3".repeat(40)),
    },
    source: input.source,
    status: "exact-structural-candidate",
  };
}

function review(label: string, reviewedCommit = "1".repeat(40)) {
  return {
    author: "reviewer",
    body: label,
    bodyBytes: Buffer.byteLength(label),
    bodySha256: sha256(label),
    createdAt: "2026-01-01T00:00:00.000Z",
    id: label,
    reviewedCommit,
    source: "review-thread-comment",
    threadId: `${label}-thread`,
  };
}

function source(path: string, rowIndex: number) {
  return {
    path,
    rowIndex,
    rowSha256: sha256(`${path}:${rowIndex}`),
  };
}

function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
