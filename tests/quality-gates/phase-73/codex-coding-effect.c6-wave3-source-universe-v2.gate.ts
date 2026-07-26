import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  buildC6Wave3SourceUniverseV2,
  parseC6Wave3SourceUniverseV2,
  requireC6Wave3OfficialCaptureAuthorizationV2,
  serializeC6Wave3SourceUniverseV2,
} from "../../../scripts/codex-coding-effect/c6-wave3-source-universe-v2";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_POOL_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool",
);
const paths = {
  output: join(
    SOURCE_POOL_ROOT,
    "swe-bench-live-multilang-608f7ae9." +
      "wave3-source-universe-v2.json",
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
const OUTPUT_BYTES = 631_004;
const OUTPUT_SHA256 =
  "822c458e792ee31f7738cae2526b05dfc3b63fcaac58e3f4f87dcd3803ccdba1";

describe("Codex coding-effect C6 Wave3 source universe v2 gate", () => {
  it("rebuilds the exact salt-independent non-authorizing proposal", async () => {
    const outputBytes = await readFile(paths.output);
    expect(outputBytes.byteLength).toBe(OUTPUT_BYTES);
    expect(sha256(outputBytes)).toBe(OUTPUT_SHA256);

    const rebuilt = await buildC6Wave3SourceUniverseV2({
      pretargetPolicyPath: paths.pretargetPolicy,
      priorFramePath: paths.priorFrame,
      structuralUnionPath: paths.structuralUnion,
    });
    const parsed = parseC6Wave3SourceUniverseV2(outputBytes);
    const serialized = serializeC6Wave3SourceUniverseV2(
      rebuilt.sourceUniverse,
    );

    expect(rebuilt.outputSha256).toBe(OUTPUT_SHA256);
    expect(serialized).toBe(outputBytes.toString("utf8"));
    expect(rebuilt.sourceUniverse).toEqual(parsed);
    expect(serialized).not.toContain("publicSaltHex");
    expect(serialized).not.toContain("activationKeySha256");
    expect(serialized).not.toContain("activationOrder");
    expect(parsed.activationPlanProtocol).toMatchObject({
      activationMaterialPresent: false,
      runnerAcceptsQuotaTier: false,
    });
    expect(parsed.antiGrindingProtocol).toMatchObject({
      concreteWitnessProviderProfile: {
        frozen: false,
        requiredBeforeCapture: true,
        verifierImplemented: false,
      },
    });
    expect(parsed.boundary).toMatchObject({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      commitAncestryProven: false,
      officialWave3CapturePermitted: false,
      priorRepositoryNodeIdExclusionComplete: false,
      sourceUniverseFrozen: false,
      sourceUniversePromotionAccepted: false,
    });
    expect(() =>
      requireC6Wave3OfficialCaptureAuthorizationV2(parsed)
    ).toThrow(/promotion receipt verifier is required/u);
  });
});

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
