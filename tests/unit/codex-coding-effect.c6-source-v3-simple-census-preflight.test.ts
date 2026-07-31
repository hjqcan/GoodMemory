import {
  mkdtemp,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  buildC6SourceV3SimpleCensusExecutionContract,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-contract";
import {
  loadC6SourceV3SimpleCensusPreflight,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-preflight";
import {
  loadExactC6SourceV3SimpleFrameFixture,
} from "./codex-coding-effect.c6-source-v3-simple-frame-fixture";

const PREFLIGHT_TEST_TIMEOUT_MILLISECONDS = 30_000;

describe("C6 source-v3-simple census preflight", () => {
  it("constructs the exact frozen frame without Git-history authority", async () => {
    const contract =
      buildC6SourceV3SimpleCensusExecutionContract();
    const frame =
      await loadExactC6SourceV3SimpleFrameFixture();

    expect(contract.boundary).toMatchObject({
      acceptedEpisodeCount: 0,
      codexRunReady: false,
      liveCensusRequestCount: 0,
    });
    expect(frame.rootShards).toHaveLength(1_536);
    expect(
      frame.frozenPreWave3AnchorExclusions,
    ).toHaveLength(1_447);
    expect(
      frame.frozenPreWave3RepositoryExclusions,
    ).toHaveLength(178);
    expect(
      frame.priorRepositoryAliases,
    ).toHaveLength(178);
    expect(
      frame.priorRepositoryNodeIds,
    ).toHaveLength(178);
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
