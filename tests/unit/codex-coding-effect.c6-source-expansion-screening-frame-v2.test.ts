import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  deriveC6SourceExpansionScreeningFrameV2Capacity,
  materializeC6SourceExpansionScreeningFrameV2,
  projectC6SourceExpansionScreeningFrameV2,
  replayC6SourceExpansionScreeningFrameV2,
  serializeC6SourceExpansionScreeningFrameV2,
} from "../../scripts/codex-coding-effect/c6-source-expansion-screening-frame-v2";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) =>
    rm(path, { force: true, recursive: true })
  ));
});

describe("Codex coding-effect C6 source-expansion screening frame v2", () => {
  it("preserves the complete prior frame and appends only newly exact identity supplements", () => {
    const fixture = createFixture();
    const frame = projectC6SourceExpansionScreeningFrameV2(fixture);

    expect(frame.boundary).toEqual({
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
    });
    expect(frame.candidates.map((candidate) => ({
      anchor: candidate.requestedAnchorId,
      rank: candidate.screeningRank,
      sourceRank: candidate.sourceRank,
      tranche: candidate.sourceTranche,
    }))).toEqual([
      {
        anchor: "legacy/repo#1",
        rank: 1,
        sourceRank: 1,
        tranche: "legacy-screening-frame-v1",
      },
      {
        anchor: "existing/repo#2",
        rank: 2,
        sourceRank: 1,
        tranche: "prospective-rest-exact-v2",
      },
      {
        anchor: "new/repo#3",
        rank: 3,
        sourceRank: 2,
        tranche: "prospective-rest-identity-supplement-v1",
      },
    ]);
    expect(frame.counts).toEqual({
      combinedStructuralCandidateCount: 3,
      identitySupplementCandidateCount: 1,
      legacyCandidateCount: 1,
      minimumRequiredEpisodes: 48,
      missingFullRestClosureCount: 1,
      missingRequiredIdentityClosureCount: 0,
      noExactStructuralSequenceCount: 1,
      priorFrameCandidateCount: 2,
      priorRestExactCandidateCount: 1,
      qualificationExactStructuralCandidateCount: 2,
      qualificationTargetCount: 3,
      rawStructuralMargin: -45,
      repositoryCappedStructuralCeiling: 3,
      repositoryCount: 3,
    });
    expect(frame.independenceBoundary).toMatchObject({
      adaptiveProspective: true,
      machineOutcomeInput: false,
      personnelOutcomeBlindnessClaimed: false,
      priorFrameOrderPreserved: true,
      prospectiveTrancheAppendedAfterPriorFrame: true,
      selectionDependsOnForbiddenFields: false,
      semanticLedgerInput: false,
    });
    expect(deriveC6SourceExpansionScreeningFrameV2Capacity({
      frame,
      rejectedRequestedAnchorIds: ["legacy/repo#1"],
    })).toEqual({
      canMeetMinimumUnderRepositoryCap: false,
      definitivelyRejectedCandidateCount: 1,
      minimumRequiredEpisodes: 48,
      remainingStructuralCandidateCount: 2,
      repositoryCappedStructuralCeiling: 2,
      selectableMargin: -46,
    });
  });

  it("keeps outcome-like metadata outside the appended projection", () => {
    const fixture = createFixture();
    const baseline = projectC6SourceExpansionScreeningFrameV2(fixture);
    const qualification = JSON.parse(
      fixture.qualificationBytes.toString("utf8"),
    ) as { results: Array<Record<string, unknown>> };
    qualification.results[1]!.gold = "forbidden";
    qualification.results[1]!.outcome = "forbidden";

    const mutated = projectC6SourceExpansionScreeningFrameV2({
      ...fixture,
      qualificationBytes: bytes(qualification),
    });

    expect(mutated.independenceBoundary.candidateProjectionSha256).toBe(
      baseline.independenceBoundary.candidateProjectionSha256,
    );
    expect(
      mutated.independenceBoundary
        .identitySupplementCandidateProjectionSha256,
    ).toBe(
      baseline.independenceBoundary
        .identitySupplementCandidateProjectionSha256,
    );
  });

  it("fails closed on prior-frame drift, stale exact candidates, and qualification counts", () => {
    const priorDrift = createFixture();
    const priorFrame = JSON.parse(
      priorDrift.priorFrameBytes.toString("utf8"),
    ) as { candidates: Array<{ requestedAnchorId: string }> };
    priorFrame.candidates[0]!.requestedAnchorId = "drift/repo#1";
    expect(() => projectC6SourceExpansionScreeningFrameV2({
      ...priorDrift,
      priorFrameBytes: bytes(priorFrame),
    })).toThrow("prior candidate projection mismatch");

    const keyOrderDrift = createFixture();
    const reorderedPrior = JSON.parse(
      keyOrderDrift.priorFrameBytes.toString("utf8"),
    ) as {
      candidates: Array<Record<string, unknown>>;
      independenceBoundary: { candidateProjectionSha256: string };
    };
    const first = reorderedPrior.candidates[0]!;
    reorderedPrior.candidates[0] = {
      screeningRank: first.screeningRank,
      requestedAnchorId: first.requestedAnchorId,
      canonicalAnchorId: first.canonicalAnchorId,
      canonicalRepository: first.canonicalRepository,
      lineageIdentitySha256: first.lineageIdentitySha256,
      source: first.source,
      sourceRank: first.sourceRank,
      sourceTranche: first.sourceTranche,
    };
    reorderedPrior.independenceBoundary.candidateProjectionSha256 =
      sha256(JSON.stringify(reorderedPrior.candidates));
    expect(() => projectC6SourceExpansionScreeningFrameV2({
      ...keyOrderDrift,
      priorFrameBytes: bytes(reorderedPrior),
    })).toThrow("prior output-prefix projection mismatch");

    const staleExact = createFixture();
    const qualification = JSON.parse(
      staleExact.qualificationBytes.toString("utf8"),
    ) as {
      results: Array<{ exactLineageIdentitySha256?: string }>;
    };
    qualification.results[0]!.exactLineageIdentitySha256 =
      sha256("changed-lineage");
    expect(() => projectC6SourceExpansionScreeningFrameV2({
      ...staleExact,
      qualificationBytes: bytes(qualification),
    })).toThrow("prior exact candidate mismatch");

    const countDrift = createFixture();
    const badCounts = JSON.parse(
      countDrift.qualificationBytes.toString("utf8"),
    ) as { counts: { exactStructuralCandidateCount: number } };
    badCounts.counts.exactStructuralCandidateCount = 3;
    expect(() => projectC6SourceExpansionScreeningFrameV2({
      ...countDrift,
      qualificationBytes: bytes(badCounts),
    })).toThrow("qualification count mismatch");

    const lineageDrift = createFixture();
    const wrongLineage = JSON.parse(
      lineageDrift.qualificationBytes.toString("utf8"),
    ) as { inputs: { originalQualificationSha256: string } };
    wrongLineage.inputs.originalQualificationSha256 = sha256("wrong-v1");
    expect(() => projectC6SourceExpansionScreeningFrameV2({
      ...lineageDrift,
      qualificationBytes: bytes(wrongLineage),
    })).toThrow("qualification lineage mismatch");
  });

  it("materializes once from exact hashes and replays exact bytes", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "c6-screening-frame-v2-")),
    );
    cleanup.push(root);
    const fixture = createFixture();
    const priorFramePath = join(root, "prior-frame.json");
    const qualificationPath = join(root, "qualification.json");
    const outputPath = join(root, "frame-v2.json");
    const badOutputPath = join(root, "bad-frame-v2.json");
    await Promise.all([
      writeFile(priorFramePath, fixture.priorFrameBytes),
      writeFile(qualificationPath, fixture.qualificationBytes),
    ]);
    const input = {
      expectedPriorFrameSha256: sha256(fixture.priorFrameBytes),
      expectedQualificationSha256: sha256(fixture.qualificationBytes),
      outputPath,
      priorFramePath,
      qualificationPath,
    };

    const result = await materializeC6SourceExpansionScreeningFrameV2(input);

    expect(await readFile(outputPath, "utf8")).toBe(
      serializeC6SourceExpansionScreeningFrameV2(result.frame),
    );
    await expect(materializeC6SourceExpansionScreeningFrameV2(input))
      .rejects.toThrow("EEXIST");
    await expect(materializeC6SourceExpansionScreeningFrameV2({
      ...input,
      expectedPriorFrameSha256: "f".repeat(64),
      outputPath: badOutputPath,
    })).rejects.toThrow("prior frame hash mismatch");
    await expect(readFile(badOutputPath)).rejects.toThrow();
    expect((await readdir(root)).some((entry) =>
      entry.includes(".incomplete-")
    )).toBe(false);
    const replay = await replayC6SourceExpansionScreeningFrameV2({
      expectedFrameSha256: result.outputSha256,
      expectedPriorFrameSha256: sha256(fixture.priorFrameBytes),
      expectedQualificationSha256: sha256(fixture.qualificationBytes),
      framePath: outputPath,
      priorFramePath,
      qualificationPath,
    });
    expect(replay.reproduced).toBe(true);
  });
});

function createFixture() {
  const priorCandidates = [
    candidate({
      anchorId: "legacy/repo#1",
      lineage: "legacy-lineage",
      rank: 1,
      sourceRank: 1,
      tranche: "legacy-screening-frame-v1",
    }),
    candidate({
      anchorId: "existing/repo#2",
      lineage: "existing-lineage",
      rank: 2,
      sourceRank: 1,
      tranche: "prospective-rest-exact-v2",
    }),
  ];
  const priorFrame = {
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
    candidates: priorCandidates,
    counts: {
      combinedStructuralCandidateCount: 2,
      exactStructuralCandidateCount: 1,
      legacyCandidateCount: 1,
      minimumRequiredEpisodes: 48,
      missingRestClosureCount: 1,
      noExactStructuralSequenceCount: 0,
      qualificationTargetCount: 2,
      rawStructuralMargin: -46,
      repositoryCappedStructuralCeiling: 2,
      repositoryCount: 2,
    },
    independenceBoundary: {
      adaptiveProspective: true,
      candidateProjectionSha256: sha256(JSON.stringify(priorCandidates)),
      exactCandidateProjectionSha256: sha256("prior-exact"),
      legacyCandidateProjectionSha256: sha256("legacy"),
      legacyOrderPreserved: true,
      machineOutcomeInput: false,
      personnelOutcomeBlindnessClaimed: false,
      prospectiveTrancheAppendedAfterLegacyFrame: true,
      selectionDependsOnForbiddenFields: false,
      semanticLedgerInput: false,
    },
    inputs: {
      restQualification: {
        capturePlanSha256: sha256("capture-plan"),
        graphqlRootSha256: sha256("graphql-root"),
        restRootSha256: sha256("rest-root"),
        sha256: sha256("qualification-v1"),
      },
    },
    schemaVersion: 1,
  };
  const results = [
    exactResult({
      anchorId: "existing/repo#2",
      captureOrder: 1,
      lineage: "existing-lineage",
      qualificationSource: "full-rest-v1",
    }),
    exactResult({
      anchorId: "new/repo#3",
      captureOrder: 2,
      lineage: "new-lineage",
      qualificationSource: "pull-identity-supplement-v1",
    }),
    {
      anchorId: "noexact/repo#4",
      canonicalAnchorId: "noexact/repo#4",
      captureDirectory: "noexact__repo__4",
      captureManifestSha256: sha256("noexact-manifest"),
      captureOrder: 3,
      exactEventCount: 1,
      qualificationSource: "full-rest-v1",
      source: source("new.jsonl", 4),
      status: "no-exact-structural-sequence",
    },
  ];
  const qualification = {
    artifactKind: "c6-source-expansion-rest-qualification-v2",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      originalFullRestCaptureAttemptCompletenessProven: false,
      pullIdentitySupplementClosureComplete: true,
      status:
        "exact-structural-screening-complete-semantic-qualification-required",
    },
    counts: {
      exactStructuralCandidateCount: 2,
      exactStructuralRepositoryCount: 2,
      fullRestClosureCount: 2,
      identitySupplementClosureCount: 1,
      missingClosureCount: 0,
      noExactStructuralSequenceCount: 1,
      repositoryCappedStructuralCeiling: 2,
      targetCount: 3,
    },
    inputs: {
      capturePlanSha256: sha256("capture-plan"),
      graphqlRootSha256: sha256("graphql-root"),
      originalQualificationSha256: sha256("qualification-v1"),
      originalRestRootSha256: sha256("rest-root"),
      supplementPlanSha256: sha256("supplement-plan"),
      supplementRootSha256: sha256("supplement-root"),
    },
    results,
    schemaVersion: 2,
  };
  return {
    priorFrameBytes: bytes(priorFrame),
    priorFramePath: "prior-frame.json",
    qualificationBytes: bytes(qualification),
    qualificationPath: "qualification-v2.json",
  };
}

function candidate(input: {
  anchorId: string;
  lineage: string;
  rank: number;
  sourceRank: number;
  tranche:
    "legacy-screening-frame-v1" |
    "prospective-rest-exact-v2";
}) {
  const repository = input.anchorId.split("#")[0]!;
  return {
    canonicalAnchorId: input.anchorId,
    canonicalRepository: repository,
    lineageIdentitySha256: sha256(input.lineage),
    requestedAnchorId: input.anchorId,
    screeningRank: input.rank,
    source: source("new.jsonl", input.rank),
    sourceRank: input.sourceRank,
    sourceTranche: input.tranche,
  };
}

function exactResult(input: {
  anchorId: string;
  captureOrder: number;
  lineage: string;
  qualificationSource:
    "full-rest-v1" |
    "pull-identity-supplement-v1";
}) {
  return {
    anchorId: input.anchorId,
    canonicalAnchorId: input.anchorId,
    captureDirectory: input.anchorId.replaceAll(/[\\/#]/gu, "__"),
    captureManifestSha256: input.qualificationSource === "full-rest-v1"
      ? sha256(`manifest-${input.anchorId}`)
      : undefined,
    captureOrder: input.captureOrder,
    exactEventCount: 2,
    exactLineageIdentitySha256: sha256(input.lineage),
    exactSequence: {},
    qualificationSource: input.qualificationSource,
    source: source("new.jsonl", input.captureOrder + 1),
    status: "exact-structural-candidate",
    supplementManifestSha256:
      input.qualificationSource === "pull-identity-supplement-v1"
        ? sha256(`supplement-${input.anchorId}`)
        : undefined,
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
