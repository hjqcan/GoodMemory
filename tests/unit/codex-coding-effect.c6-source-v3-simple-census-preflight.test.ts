import {
  mkdtemp,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  parseC6SourceV3SimpleFrameDefinition,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-core";
import {
  loadC6SourceV3SimpleCensusPreflight,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-preflight";

const PREFLIGHT_TEST_TIMEOUT_MILLISECONDS = 30_000;

describe("C6 source-v3-simple census preflight", () => {
  it("constructs the only permitted frame from exact frozen assets", async () => {
    const preflight =
      await loadC6SourceV3SimpleCensusPreflight({
        repositoryRoot: process.cwd(),
      });

    expect(preflight.contract.boundary).toMatchObject({
      acceptedEpisodeCount: 0,
      codexRunReady: false,
      liveCensusRequestCount: 0,
    });
    expect(preflight.frame.rootShards).toHaveLength(1_536);
    expect(
      preflight.frame.frozenPreWave3AnchorExclusions,
    ).toHaveLength(1_447);
    expect(
      preflight.frame.frozenPreWave3RepositoryExclusions,
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
  }, PREFLIGHT_TEST_TIMEOUT_MILLISECONDS);

  it("rejects a repository root whose frozen path traverses a symlink", async () => {
    const temporaryRoot = await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-census-preflight-",
    ));
    try {
      await symlink(
        join(process.cwd(), "fixtures"),
        join(temporaryRoot, "fixtures"),
      );
      await expect(
        loadC6SourceV3SimpleCensusPreflight({
          repositoryRoot: temporaryRoot,
        }),
      ).rejects.toThrow(/symlink/u);
    } finally {
      await rm(temporaryRoot, {
        force: true,
        recursive: true,
      });
    }
  });
});
