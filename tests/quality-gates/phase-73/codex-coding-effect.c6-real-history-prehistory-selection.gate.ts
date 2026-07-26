import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

import {
  replayC6RealHistoryPrehistorySelection,
} from "../../../scripts/codex-coding-effect/c6-real-history-prehistory-selection";

const INPUT_PATH = resolve(
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "multi-swe-full-56ff018.review-trajectory-discovery.json",
);
const PROJECTION_PATH = resolve(
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "multi-swe-full-56ff018.real-history-prehistory-selection.json",
);

describe("Codex coding-effect C6 real-history prehistory selection gate", () => {
  it("replays the full 145-signal closure without promoting 48 priority seeds", async () => {
    const replay = await replayC6RealHistoryPrehistorySelection({
      expectedInputSha256:
        "5931a911b919a9c53068311185f0bd1c78c0be18220ebe92c3b795c8e38357fd",
      expectedProjectionSha256:
        "938ffaff2d185b3e3ba5d0ccf8e97f626879ffe0c7c44d65f6c6313958a06044",
      inputPath: INPUT_PATH,
      projectionPath: PROJECTION_PATH,
    });

    expect(replay.reproduced).toBe(true);
    expect(replay.selection.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      selectionStatus: "prehistory-seeds-only",
    });
    expect(replay.selection.counts).toEqual({
      cappedSeedPoolCount: 54,
      eligibleRepositoryCount: 22,
      eligibleSeedCount: 145,
      priorityRepositoryCount: 20,
      prioritySeedCount: 48,
      sourceTargetCount: 175,
    });
    expect(replay.selection.eligibleRankClosure).toHaveLength(145);
    expect(replay.selection.prioritySeeds).toHaveLength(48);
    expect(replay.selection.priorityBoundary).toEqual({
      prioritySeedsAreEpisodes: false,
      prioritySeedsDefineFinalExclusionSet: false,
      status: "priority-order-only-downstream-availability-may-reject",
      targetAvailabilityChecked: false,
    });
  });
});
