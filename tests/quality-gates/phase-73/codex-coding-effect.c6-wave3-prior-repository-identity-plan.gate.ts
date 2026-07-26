import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  captureC6Wave3PriorRepositoryIdentity,
} from "../../../scripts/codex-coding-effect/c6-wave3-prior-repository-identity-capture";
import {
  buildC6Wave3PriorRepositoryIdentityPlan,
  parseC6Wave3PriorRepositoryIdentityPlan,
  requireC6Wave3PriorRepositoryIdentityCaptureAuthorization,
  serializeC6Wave3PriorRepositoryIdentityPlan,
} from "../../../scripts/codex-coding-effect/c6-wave3-prior-repository-identity-plan";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_POOL_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool",
);
const paths = {
  output: join(
    SOURCE_POOL_ROOT,
    "swe-bench-live-multilang-608f7ae9." +
      "wave3-prior-repository-identity-plan-v1.json",
  ),
  sourceUniverse: join(
    SOURCE_POOL_ROOT,
    "swe-bench-live-multilang-608f7ae9." +
      "wave3-source-universe-v2.json",
  ),
} as const;
const OUTPUT_BYTES = 76_257;
const OUTPUT_SHA256 =
  "70b202cd6da6c2c504a0c23168dc9bcb6a73e9697ff98884dcc83ca785cd4ee2";

describe("Codex coding-effect C6 Wave3 prior identity plan gate", () => {
  it("rebuilds the exact non-authorizing 178-repository proposal", async () => {
    const outputBytes = await readFile(paths.output);
    expect(outputBytes.byteLength).toBe(OUTPUT_BYTES);
    expect(sha256(outputBytes)).toBe(OUTPUT_SHA256);

    const rebuilt =
      await buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath: paths.sourceUniverse,
      });
    const parsed =
      parseC6Wave3PriorRepositoryIdentityPlan(outputBytes);
    const serialized =
      serializeC6Wave3PriorRepositoryIdentityPlan(
        rebuilt.plan,
      );

    expect(rebuilt.outputSha256).toBe(OUTPUT_SHA256);
    expect(serialized).toBe(outputBytes.toString("utf8"));
    expect(rebuilt.plan).toEqual(parsed);
    expect(parsed.counts).toEqual({
      lookupCount: 356,
      passCount: 2,
      priorRepositoryCount: 178,
    });
    expect(parsed.targets).toHaveLength(178);
    expect(
      parsed.targets.every(
        (target) => !("repositoryNodeId" in target),
      ),
    ).toBe(true);
    expect(parsed.boundary).toMatchObject({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      officialWave3SearchPermitted: false,
      priorIdentityCaptureExecuted: false,
      priorIdentityCapturePermitted: false,
      status:
        "prior-repository-identity-plan-proposal-only",
    });
    expect(() =>
      requireC6Wave3PriorRepositoryIdentityCaptureAuthorization(
        parsed,
      )
    ).toThrow(/external promotion verifier is required/u);

    let requestCount = 0;
    await expect(
      captureC6Wave3PriorRepositoryIdentity({
        authorizationToken:
          "github_pat_C6_PRIOR_GATE_SENTINEL_947301",
        planPath: paths.output,
        sourceUniversePath: paths.sourceUniverse,
        transport: async () => {
          requestCount += 1;
          throw new Error("transport must remain unreachable");
        },
      }),
    ).rejects.toThrow(/authorization.*external promotion verifier/u);
    expect(requestCount).toBe(0);
  });
});

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
