import { describe, expect, it } from "bun:test";
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  loadC6RealHistoryPrehistorySelection,
  materializeC6RealHistoryPrehistorySelection,
  projectC6RealHistoryPrehistorySelection,
  replayC6RealHistoryPrehistorySelection,
  serializeC6RealHistoryPrehistorySelection,
} from "../../scripts/codex-coding-effect/c6-real-history-prehistory-selection";

const INPUT_PATH = resolve(
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "multi-swe-full-56ff018.review-trajectory-discovery.json",
);
const INPUT_SHA256 =
  "5931a911b919a9c53068311185f0bd1c78c0be18220ebe92c3b795c8e38357fd";
const PROJECTION_PATH = resolve(
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "multi-swe-full-56ff018.real-history-prehistory-selection.json",
);
const PROJECTION_SHA256 =
  "938ffaff2d185b3e3ba5d0ccf8e97f626879ffe0c7c44d65f6c6313958a06044";

describe("Codex coding-effect C6 real-history prehistory selection", () => {
  it("mechanically selects 48 capped prehistory seeds without promoting them", async () => {
    const inputBytes = await readFile(INPUT_PATH);
    const first = projectC6RealHistoryPrehistorySelection({
      inputBytes,
      inputPath: INPUT_PATH,
    });
    const replay = projectC6RealHistoryPrehistorySelection({
      inputBytes,
      inputPath: INPUT_PATH,
    });

    expect(first.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      selectionStatus: "prehistory-seeds-only",
    });
    expect(first.independenceBoundary).toEqual({
      personnelOutcomeBlindnessClaimed: false,
      selectionDependsOnForbiddenFields: false,
      status: "outcome-field-independent-deterministic-projection",
    });
    expect(first.input.sha256).toBe(INPUT_SHA256);
    expect(first.counts).toMatchObject({
      eligibleSeedCount: 145,
      prioritySeedCount: 48,
      sourceTargetCount: 175,
    });
    expect(first.priorityBoundary).toEqual({
      prioritySeedsAreEpisodes: false,
      prioritySeedsDefineFinalExclusionSet: false,
      status: "priority-order-only-downstream-availability-may-reject",
      targetAvailabilityChecked: false,
    });
    expect(first.rule.perRepositoryCap).toBe(4);
    expect(first.rule.inputArtifactHashUsedForRanking).toBe(false);
    expect(first.rule.forbiddenFields).toEqual([
      "sourceTestSignals",
      "patch",
      "test",
      "gold",
      "outcome",
    ]);
    expect(first.eligibleRankClosure).toHaveLength(145);
    expect(first.prioritySeeds).toHaveLength(48);
    expect(Math.max(
      ...first.repositoryAllocation.map((entry) => entry.prioritySeeds),
    )).toBeLessThanOrEqual(4);
    expect(first.priorityConcentration.largestRepositoryCount)
      .toBeLessThanOrEqual(4);
    expect(first.priorityConcentration.largestRepositoryShare).toBeCloseTo(
      first.priorityConcentration.largestRepositoryCount / 48,
      12,
    );
    expect(first.priorityConcentration.kishEffectiveRepositoryFamilies)
      .toBeGreaterThan(1);
    expect(
      first.eligibleRankClosure.filter(
        (entry) => entry.priorityDecision === "priority-prehistory-seed",
      ).map((entry) => entry.anchorId).sort(),
    ).toEqual(first.prioritySeeds.map((entry) => entry.anchorId).sort());
    expect(
      first.eligibleRankClosure.every(
        (entry) =>
          (entry.repositoryRank <= 4) ===
            (entry.repositoryCapDecision === "retained-in-capped-pool"),
      ),
    ).toBe(true);
    expect(
      first.eligibleRankClosure.reduce<Record<string, number>>(
        (counts, entry) => {
          counts[entry.priorityDecision] =
            (counts[entry.priorityDecision] ?? 0) + 1;
          return counts;
        },
        {},
      ),
    ).toEqual({
      "deferred-after-global-priority-rank": 6,
      "deferred-after-repository-cap": 91,
      "priority-prehistory-seed": 48,
    });
    expect(serializeC6RealHistoryPrehistorySelection(first)).toBe(
      serializeC6RealHistoryPrehistorySelection(replay),
    );
  });

  it("replays the tracked 145-signal closure and 48-seed priority projection", async () => {
    const replay = await replayC6RealHistoryPrehistorySelection({
      expectedInputSha256: INPUT_SHA256,
      expectedProjectionSha256: PROJECTION_SHA256,
      inputPath: INPUT_PATH,
      projectionPath: PROJECTION_PATH,
    });

    expect(replay.reproduced).toBe(true);
    expect(replay.selection.eligibleRankClosure).toHaveLength(145);
    expect(replay.selection.prioritySeeds).toHaveLength(48);
  });

  it("does not let sourceTestSignals affect ranks or selected anchors", async () => {
    const inputBytes = await readFile(INPUT_PATH);
    const parsed = JSON.parse(inputBytes.toString("utf8")) as {
      source: {
        anchorsSha256: string;
        rootSha256: string;
      };
      targets: Array<{
        source: { rowSha256: string };
        sourceTestSignals: unknown;
      }>;
    };
    parsed.targets[0]!.sourceTestSignals = {
      deliberatelyMutatedForbiddenOutcomeField: true,
    };
    parsed.targets[0]!.source.rowSha256 = "a".repeat(64);
    parsed.source.anchorsSha256 = "b".repeat(64);
    parsed.source.rootSha256 = "c".repeat(64);
    const mutatedBytes = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);

    const original = projectC6RealHistoryPrehistorySelection({
      inputBytes,
      inputPath: INPUT_PATH,
    });
    const mutated = projectC6RealHistoryPrehistorySelection({
      inputBytes: mutatedBytes,
      inputPath: INPUT_PATH,
    });

    expect(mutated.input.sha256).not.toBe(original.input.sha256);
    expect(mutated.eligibleRankClosure.map(selectionIdentity)).toEqual(
      original.eligibleRankClosure.map(selectionIdentity),
    );
  });

  it("fails closed when linear ancestry identity drifts inconsistently", async () => {
    const inputBytes = await readFile(INPUT_PATH);
    const parsed = JSON.parse(inputBytes.toString("utf8")) as {
      targets: Array<{
        rest: {
          linearReviewAncestrySequence?: {
            firstFixCommit: string;
          };
          linearReviewAncestryValid?: boolean;
          status: string;
        };
      }>;
    };
    const target = parsed.targets.find(
      (entry) =>
        entry.rest.status === "strict-rest-closure" &&
        entry.rest.linearReviewAncestryValid === true,
    )!;
    target.rest.linearReviewAncestrySequence!.firstFixCommit = "0".repeat(40);

    expect(() => projectC6RealHistoryPrehistorySelection({
      inputBytes: Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`),
      inputPath: INPUT_PATH,
    })).toThrow("linear ancestry sequence/evidence mismatch");
  });

  it("materializes exclusively and loads a strict canonical projection", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "c6-prehistory-selection-")),
    );
    const inputPath = join(root, "input.json");
    const outputPath = join(root, "projection.json");
    try {
      const inputBytes = await readFile(INPUT_PATH);
      await writeFile(inputPath, inputBytes);
      const materialized = await materializeC6RealHistoryPrehistorySelection({
        expectedInputSha256: INPUT_SHA256,
        inputPath,
        outputPath,
      });
      const loaded = await loadC6RealHistoryPrehistorySelection(outputPath, {
        expectedSha256: materialized.projectionSha256,
      });

      expect(loaded).toEqual(materialized.selection);
      await expect(materializeC6RealHistoryPrehistorySelection({
        expectedInputSha256: INPUT_SHA256,
        inputPath,
        outputPath,
      })).rejects.toMatchObject({ code: "EEXIST" });

      const projection = JSON.parse(
        (await readFile(outputPath)).toString("utf8"),
      ) as Record<string, unknown>;
      projection.unknownField = true;
      await writeFile(outputPath, `${JSON.stringify(projection, null, 2)}\n`);
      await expect(
        loadC6RealHistoryPrehistorySelection(outputPath),
      ).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("replays the projection byte-for-byte and rejects projection drift", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "c6-prehistory-replay-")),
    );
    const inputPath = join(root, "input.json");
    const outputPath = join(root, "projection.json");
    try {
      const inputBytes = await readFile(INPUT_PATH);
      await writeFile(inputPath, inputBytes);
      const materialized = await materializeC6RealHistoryPrehistorySelection({
        expectedInputSha256: INPUT_SHA256,
        inputPath,
        outputPath,
      });

      const replay = await replayC6RealHistoryPrehistorySelection({
        expectedInputSha256: INPUT_SHA256,
        expectedProjectionSha256: materialized.projectionSha256,
        inputPath,
        projectionPath: outputPath,
      });
      expect(replay.reproduced).toBe(true);

      const projectionBytes = await readFile(outputPath);
      await writeFile(
        outputPath,
        Buffer.concat([projectionBytes.subarray(0, -1), Buffer.from(" \n")]),
      );
      await expect(replayC6RealHistoryPrehistorySelection({
        expectedInputSha256: INPUT_SHA256,
        expectedProjectionSha256: materialized.projectionSha256,
        inputPath,
        projectionPath: outputPath,
      })).rejects.toThrow("projection hash");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects input symlinks and input-byte drift before publishing", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "c6-prehistory-stability-")),
    );
    const inputPath = join(root, "input.json");
    const symlinkPath = join(root, "input-link.json");
    const symlinkOutputPath = join(root, "symlink-output.json");
    const driftOutputPath = join(root, "drift-output.json");
    try {
      const inputBytes = await readFile(INPUT_PATH);
      await writeFile(inputPath, inputBytes);
      await symlink(inputPath, symlinkPath);
      await expect(materializeC6RealHistoryPrehistorySelection({
        expectedInputSha256: INPUT_SHA256,
        inputPath: symlinkPath,
        outputPath: symlinkOutputPath,
      })).rejects.toThrow(/symlink/iu);

      await expect(materializeC6RealHistoryPrehistorySelection({
        expectedInputSha256: INPUT_SHA256,
        inputPath,
        outputPath: driftOutputPath,
        testHooks: {
          beforeTerminalInputVerification: async () => {
            await writeFile(inputPath, Buffer.concat([
              inputBytes.subarray(0, -1),
              Buffer.from(" \n"),
            ]));
          },
        },
      })).rejects.toThrow("input changed during materialization");
      await expect(lstat(driftOutputPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function selectionIdentity(selection: {
  anchorId: string;
  lineageIdentitySha256: string;
  rankSha256: string;
}) {
  return {
    anchorId: selection.anchorId,
    lineageIdentitySha256: selection.lineageIdentitySha256,
    rankSha256: selection.rankSha256,
  };
}
