import {
  describe,
  expect,
  it,
} from "bun:test";

import {
  parseC6SourceV3SimpleFrameDefinition,
} from "../../../scripts/codex-coding-effect/c6-source-v3-simple-census-core";
import {
  loadC6SourceV3SimpleCensusPreflight,
} from "../../../scripts/codex-coding-effect/c6-source-v3-simple-census-preflight";

describe("Phase 73 C6 source-v3-simple census preflight", () => {
  it("verifies the exact frozen frame and historical Git authorization", async () => {
    const preflight =
      await loadC6SourceV3SimpleCensusPreflight({
        repositoryRoot: process.cwd(),
      });

    expect(preflight.contract.boundary).toMatchObject({
      acceptedEpisodeCount: 0,
      codexRunReady: false,
      liveCensusRequestCount: 0,
    });
    expect(preflight.frame.rootShards).toHaveLength(
      1_536,
    );
    expect(
      preflight.frame
        .frozenPreWave3AnchorExclusions,
    ).toHaveLength(1_447);
    expect(
      preflight.frame
        .frozenPreWave3RepositoryExclusions,
    ).toHaveLength(178);
    expect(
      preflight.frame.priorRepositoryAliases,
    ).toHaveLength(178);
    expect(
      preflight.frame.priorRepositoryNodeIds,
    ).toHaveLength(178);
    expect(preflight.frozenInputs).toHaveLength(7);
    expect(
      parseC6SourceV3SimpleFrameDefinition(
        preflight.frame,
      ),
    ).toEqual(preflight.frame);
  }, 30_000);
});
