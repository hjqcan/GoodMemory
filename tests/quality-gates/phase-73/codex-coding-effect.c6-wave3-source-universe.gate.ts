import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  buildC6Wave3SourceUniverse,
  parseC6Wave3SourceUniverse,
  requireC6Wave3OfficialCaptureAuthorization,
  serializeC6Wave3SourceUniverse,
} from "../../../scripts/codex-coding-effect/c6-wave3-source-universe";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_POOL_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool",
);
const paths = {
  activationSalt: join(
    SOURCE_POOL_ROOT,
    "swe-bench-live-multilang-608f7ae9." +
      "wave3-activation-salt-proposal-v1.json",
  ),
  output: join(
    SOURCE_POOL_ROOT,
    "swe-bench-live-multilang-608f7ae9." +
      "wave3-source-universe-v1.json",
  ),
  pretargetPolicy: join(
    SOURCE_POOL_ROOT,
    "swe-bench-live-multilang-608f7ae9." +
      "wave3-pretarget-policy-v1.json",
  ),
  priorFrame: join(
    SOURCE_POOL_ROOT,
    "multi-source." +
      "reviewer-actor-qualified-screening-frame-v1.json",
  ),
  structuralUnion: join(
    SOURCE_POOL_ROOT,
    "swe-bench-live-multilang-608f7ae9." +
      "neighbor-structural-union-v1.json",
  ),
} as const;
const OUTPUT_BYTES = 841_425;
const OUTPUT_SHA256 =
  "ffa3d50be892d7b80d987f68a72bcfd639392f67cbd173350987944beb594c9c";

describe("Codex coding-effect C6 Wave3 source universe gate", () => {
  it("rebuilds the exact non-authorizing proposal from four frozen inputs", async () => {
    const outputBytes = await readFile(paths.output);
    expect(outputBytes.byteLength).toBe(OUTPUT_BYTES);
    expect(sha256(outputBytes)).toBe(OUTPUT_SHA256);

    const rebuilt = await buildC6Wave3SourceUniverse({
      activationSaltPath: paths.activationSalt,
      pretargetPolicyPath: paths.pretargetPolicy,
      priorFramePath: paths.priorFrame,
      structuralUnionPath: paths.structuralUnion,
    });
    const parsed = parseC6Wave3SourceUniverse(outputBytes);

    expect(rebuilt.outputSha256).toBe(OUTPUT_SHA256);
    expect(
      serializeC6Wave3SourceUniverse(
        rebuilt.sourceUniverse,
      ),
    ).toBe(outputBytes.toString("utf8"));
    expect(rebuilt.sourceUniverse).toEqual(parsed);
    expect(parsed.activation.publicSalt).toMatchObject({
      firstAndOnlyDrawReviewAccepted: false,
      originReceiptAccepted: false,
      priorEvidenceContentInput: false,
    });
    expect(parsed.boundary).toMatchObject({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      officialWave3CapturePermitted: false,
      pretargetPolicyPromotionAccepted: false,
      priorRepositoryNodeIdExclusionComplete: false,
      sourceUniversePromotionAccepted: false,
      sourceUniverseFrozen: false,
    });
    expect(() =>
      requireC6Wave3OfficialCaptureAuthorization(parsed)
    ).toThrow(/promotion receipt verifier is required/u);
  });
});

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
