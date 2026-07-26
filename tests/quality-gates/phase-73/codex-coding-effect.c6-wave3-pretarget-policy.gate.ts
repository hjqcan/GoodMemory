import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  buildC6Wave3PretargetPolicy,
  parseC6Wave3PretargetPolicy,
  serializeC6Wave3PretargetPolicy,
} from "../../../scripts/codex-coding-effect/c6-wave3-pretarget-policy";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_POOL_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool",
);
const paths = {
  output: join(
    SOURCE_POOL_ROOT,
    "swe-bench-live-multilang-608f7ae9." +
      "wave3-pretarget-policy-v1.json",
  ),
  structuralUnion: join(
    SOURCE_POOL_ROOT,
    "swe-bench-live-multilang-608f7ae9." +
      "neighbor-structural-union-v1.json",
  ),
  wave1Metadata: join(
    SOURCE_POOL_ROOT,
    "swe-bench-live-multilang-608f7ae9." +
      "neighbor-census-qualification-v2.json",
  ),
  wave1Structural: join(
    SOURCE_POOL_ROOT,
    "swe-bench-live-multilang-608f7ae9." +
      "neighbor-structural-qualification-v1.json",
  ),
  wave2Metadata: join(
    SOURCE_POOL_ROOT,
    "swe-bench-live-multilang-608f7ae9." +
      "neighbor-census-qualification-v3.json",
  ),
  wave2Structural: join(
    SOURCE_POOL_ROOT,
    "swe-bench-live-multilang-608f7ae9." +
      "neighbor-continuation-structural-qualification-v1.json",
  ),
} as const;
const OUTPUT_SHA256 =
  "eb3df63ff269b1d0166ed4b2faba682d60cdce3fb1ea64946e66f08e5eda9856";

describe("Codex coding-effect C6 Wave3 pretarget policy gate", () => {
  it("rebuilds the exact retrospective proposal from the five frozen inputs", async () => {
    const outputBytes = await readFile(paths.output);
    expect(outputBytes.byteLength).toBe(9_105);
    expect(sha256(outputBytes)).toBe(OUTPUT_SHA256);

    const rebuilt = await buildC6Wave3PretargetPolicy({
      structuralUnionPath: paths.structuralUnion,
      wave1MetadataQualificationPath: paths.wave1Metadata,
      wave1StructuralQualificationPath: paths.wave1Structural,
      wave2MetadataQualificationPath: paths.wave2Metadata,
      wave2StructuralQualificationPath: paths.wave2Structural,
    });
    const parsed = parseC6Wave3PretargetPolicy(outputBytes);

    expect(rebuilt.outputSha256).toBe(OUTPUT_SHA256);
    expect(
      serializeC6Wave3PretargetPolicy(rebuilt.policy),
    ).toBe(outputBytes.toString("utf8"));
    expect(rebuilt.policy).toEqual(parsed);
    expect(parsed.boundary).toEqual({
      acceptedEpisodeCount: 0,
      codexRunReady: false,
      commitAncestryProven: false,
      independentReview: false,
      preregisteredBeforeWave3Capture: false,
      selectionExecuted: false,
      status: "review-and-freeze-commit-required",
    });
  });
});

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
