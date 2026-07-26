import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { join, resolve } from "node:path";

import {
  replayC6ReviewTrajectorySourceExpansion,
} from "../../../scripts/codex-coding-effect/c6-review-trajectory-source-expansion";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const GRAPHQL_ROOT =
  process.env.GOODMEMORY_TEST_C6_GRAPHQL_FULL_CAPTURE_ROOT?.trim();
const maybeDescribe = GRAPHQL_ROOT ? describe : describe.skip;
const INVENTORY_SHA256 =
  "14c406f6bb9d4b8c789380b62511bd1312dd67819eaeb44d64c9ea54593bed51";
const LEGACY_FRAME_SHA256 =
  "751929cc423d0ad132cbb5d5841a442242b9d59ab713406f352424a33c22def9";
const PROJECTION_SHA256 =
  "629acdc312e611e066d181dacfb1206448c2a3f885921b99eff036159439317f";

setDefaultTimeout(300_000);

maybeDescribe("Codex coding-effect C6 prospective source expansion replay", () => {
  it("replays the outcome-independent 51-row pretarget tranche", async () => {
    const sourcePoolRoot = join(
      REPOSITORY_ROOT,
      "fixtures/codex-coding-effect/c6-source-pool",
    );
    const replay = await replayC6ReviewTrajectorySourceExpansion({
      expectedInventorySha256: INVENTORY_SHA256,
      expectedLegacyFrameSha256: LEGACY_FRAME_SHA256,
      expectedProjectionSha256: PROJECTION_SHA256,
      graphqlCaptureRoot: requiredExternalPath(
        GRAPHQL_ROOT,
        "GOODMEMORY_TEST_C6_GRAPHQL_FULL_CAPTURE_ROOT",
      ),
      inventoryPath: join(
        sourcePoolRoot,
        "multi-swe-full-56ff018.github-graphql-discovery-inventory.json",
      ),
      legacyFramePath: join(
        sourcePoolRoot,
        "multi-swe-full-56ff018.real-history-screening-frame.json",
      ),
      projectionPath: join(
        sourcePoolRoot,
        "multi-swe-full-56ff018.review-trajectory-source-expansion-v2.json",
      ),
    });

    expect(replay.reproduced).toBe(true);
    expect(replay.projectionSha256).toBe(PROJECTION_SHA256);
    expect(replay.expansion.boundary).toEqual({
      acceptedEpisodeCount: 0,
      adaptiveProspective: true,
      candidateManifestFrozen: false,
      codexRunReady: false,
      pretargetsRequireExactRestClosure: true,
      status: "prospective-structural-pretargets-not-episodes",
      upperBoundClaimPermitted: false,
    });
    expect(replay.expansion.counts).toEqual({
      canonicalLegacyExclusionCount: 145,
      discoverySurfaceUnsupportedCount: 2,
      inventoryAnchorCount: 1737,
      prospectiveAnchorCount: 1592,
      repositoryCappedStructuralCeiling: 26,
      structuralPretargetCount: 51,
      structuralPretargetRepositoryCount: 13,
    });
    expect(replay.expansion.legacyFrame).toMatchObject({
      candidateCount: 145,
      candidateProjectionSha256:
        "f2875d922dc5aef657363660b9efd0b39799923cbd8068f84ef921791da2e47e",
      canonicalExclusionSetSha256:
        "9c8a1eafae39dd6e39cda8e92cb4f7d747b039fb5f6a479e79c4f4011651d45e",
    });
    expect(replay.expansion.policy).toMatchObject({
      policyId: "prospective-structural-review-v2",
      schemaVersion: 2,
      sha256:
        "b51613368026c09ad1aab3e4d08fe19197ddc1beea9499c9d8e068830527703a",
    });
  });
});

function requiredExternalPath(
  value: string | undefined,
  name: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for the C6 source expansion gate`);
  }
  return value;
}
