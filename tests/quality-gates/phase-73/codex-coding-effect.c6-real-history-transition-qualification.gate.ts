import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

import {
  replayC6RealHistoryTransitionQualification,
} from "../../../scripts/codex-coding-effect/c6-real-history-transition-qualification";

const SOURCE_ROOT = resolve(
  "fixtures/codex-coding-effect/c6-source-pool",
);
const TRAJECTORY_PATH = resolve(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.review-trajectory-discovery.json",
);
const AUDIT_ORDER_PATH = resolve(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.real-history-prehistory-selection.json",
);
const PROJECTION_PATH = resolve(
  SOURCE_ROOT,
  "multi-swe-full-56ff018.real-history-transition-qualification.json",
);

describe("Codex coding-effect C6 real-history transition qualification gate", () => {
  it("replays the honest 54-candidate intake without authorizing dataset assembly", async () => {
    const replay = await replayC6RealHistoryTransitionQualification({
      auditOrderPath: AUDIT_ORDER_PATH,
      expectedProjectionSha256:
        "59136d44da3f5687afe08cffbed98f0eae71a114389114cb422b73680c1185f8",
      projectionPath: PROJECTION_PATH,
      trajectoryPath: TRAJECTORY_PATH,
    });

    expect(replay.reproduced).toBe(true);
    expect(replay.projection.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      datasetAssemblyAllowed: false,
      independentAcceptedCount: 0,
      machineQualifiedCount: 0,
      status: "qualification-intake-only-no-transition-evidence",
    });
    expect(replay.projection.counts).toEqual({
      blockedCandidateCount: 54,
      cappedCandidateCount: 54,
      independentlyAcceptedCount: 0,
      machineQualifiedCount: 0,
      priorityCandidateCount: 48,
      reserveCandidateCount: 6,
      sourceF2pAndP2pSignalCount: 19,
      sourceF2pSignalCount: 22,
    });
    expect(replay.projection.candidates).toHaveLength(54);
    expect(replay.projection.candidates.every((candidate) =>
      candidate.currentDecision === "blocked-evidence-not-collected" &&
      candidate.machineQualification === "not-qualified" &&
      candidate.independentAcceptance === "not-reviewed"
    )).toBe(true);
    expect(replay.projection.stopGo).toMatchObject({
      datasetAssemblyAllowed: false,
      independentAcceptedCount: 0,
      machineQualifiedCount: 0,
      minimumIndependentAccepted: 48,
      minimumMachineQualified: 48,
    });
  });
});
