import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  loadC6SourceV3SimplePriorExclusionSet,
  verifyC6SourceV3SimplePriorExclusionProjection,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-prior-exclusion";

describe("C6 source-v3-simple prior exclusion projector", () => {
  it("loads the exact 178-node exclusion set bound by the frozen replay receipt", async () => {
    const root = join(
      process.cwd(),
      "fixtures/codex-coding-effect/c6-source-pool/" +
        "provenance/source-v3-simple/prior-repository-identity",
    );
    const [projectionBytes, replayReceiptBytes] =
      await Promise.all([
        readFile(join(
          root,
          "prior-repository-exclusion-projection-v1.json",
        )),
        readFile(join(
          root,
          "swe-bench-live-multilang-608f7ae9." +
            "source-v3-simple-prior-repository-identity-" +
            "observation-replay-v1.json",
        )),
      ]);

    const exclusionSet =
      loadC6SourceV3SimplePriorExclusionSet({
        projectionBytes,
        replayReceiptBytes,
      });

    expect(exclusionSet.nodeIds).toHaveLength(178);
    expect(new Set(exclusionSet.nodeIds).size).toBe(178);
    expect(exclusionSet.aliases).toContain(
      "multiqc/multiqc",
    );
    expect(exclusionSet.nodeIdDedupProjectionSha256).toBe(
      "c1d0d92294306042872f73a7e98acd7a64cd6aa82c01ef2cdd81bcf2620e4076",
    );
  });

  it("returns the exact node IDs and all case-folded aliases from a hash-bound projection", () => {
    const nodeIdDedup = [
      {
        repositoryNodeId: "R_prior",
        requestedAliases: ["prior/alias"],
        resolvedNameWithOwnerAsciiFold: "renamed/repository",
        resolvedNameWithOwnerExactValues: [
          "Renamed/Repository",
        ],
      },
    ];
    const projectionBytes = Buffer.from(
      `${JSON.stringify({
        artifactKind:
          "c6-source-v3-simple-prior-repository-exclusion-projection",
        nodeIdDedup,
        schemaVersion: 1,
      }, null, 2)}\n`,
    );

    expect(
      verifyC6SourceV3SimplePriorExclusionProjection(
        projectionBytes,
        {
          expectedNodeIdDedupProjectionSha256:
            sha256(JSON.stringify(nodeIdDedup)),
          expectedUniqueNodeIdCount: 1,
        },
      ),
    ).toEqual({
      aliases: [
        "prior/alias",
        "renamed/repository",
      ],
      nodeIds: ["R_prior"],
      nodeIdDedupProjectionSha256:
        sha256(JSON.stringify(nodeIdDedup)),
    });
  });

  it("rejects a projection whose rows do not equal the frozen replay hash", () => {
    const projectionBytes = Buffer.from(
      `${JSON.stringify({
        artifactKind:
          "c6-source-v3-simple-prior-repository-exclusion-projection",
        nodeIdDedup: [{
          repositoryNodeId: "R_forged",
          requestedAliases: ["forged/repository"],
          resolvedNameWithOwnerAsciiFold:
            "forged/repository",
          resolvedNameWithOwnerExactValues: [
            "forged/repository",
          ],
        }],
        schemaVersion: 1,
      }, null, 2)}\n`,
    );

    expect(() =>
      verifyC6SourceV3SimplePriorExclusionProjection(
        projectionBytes,
        {
          expectedNodeIdDedupProjectionSha256: "0".repeat(64),
          expectedUniqueNodeIdCount: 1,
        },
      )
    ).toThrow("projection hash mismatch");
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
