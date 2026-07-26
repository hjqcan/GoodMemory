import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  buildC6SourceV3SimpleProtocol,
  parseC6SourceV3SimpleProtocol,
  serializeC6SourceV3SimpleProtocol,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple";

const SOURCE_V2_PATH = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool",
  "swe-bench-live-multilang-608f7ae9.wave3-source-universe-v2.json",
);
const PROTOCOL_PATH = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool",
  "swe-bench-live-multilang-608f7ae9.source-v3-simple-protocol-v1.json",
);

describe("Codex coding-effect C6 source-v3-simple protocol", () => {
  it("reuses only the finite source frame and requires a complete census", async () => {
    const sourceV2Bytes = await readFile(SOURCE_V2_PATH);
    const expectedProtocolBytes = await readFile(PROTOCOL_PATH, "utf8");
    const result = buildC6SourceV3SimpleProtocol(sourceV2Bytes);
    const serialized = serializeC6SourceV3SimpleProtocol(result.protocol);

    expect(result.protocol).toMatchObject({
      artifactKind: "c6-source-v3-simple-protocol",
      boundary: {
        acceptedEpisodeCount: 0,
        candidateManifestFrozen: false,
        codexRunReady: false,
        formalCensusPermitted: false,
        sourceV3SimpleFrozen: false,
      },
      censusProtocol: {
        completeRootShardCount: 1_536,
        downstreamYieldStoppingAllowed: false,
        metadataDecisionLedger:
          "one-accepted-or-rejected-decision-per-enumerated-pull-request",
        mode: "complete-finite-frame",
        pullRequestOrder:
          "createdAt-descending-then-pullRequestNodeId-utf8-byte-ascending",
        quotaStoppingAllowed: false,
        redrawAllowed: false,
        repositoryOrder:
          "repositoryNodeId-utf8-byte-ascending",
        rootShardOrder: "rootShardId-utf8-byte-ascending",
      },
      schemaVersion: 1,
      sourceFrame: {
        inheritedSections: [
          "exclusions",
          "inputPolicy",
          "repositoryUniverse",
          "searchProtocol",
        ],
        rootShardCount: 1_536,
        metadataPredicate: {
          sha256:
            "eb3df63ff269b1d0166ed4b2faba682d60cdce3fb1ea64946e66f08e5eda9856",
        },
        sourceFrameProjectionSha256:
          "efb76e58585c6c422020954783eee50e37290d94f78310bd88c176929fa85474",
        supersededSections: [
          "activationPlanProtocol",
          "antiGrindingProtocol",
        ],
      },
    });
    expect(serialized).not.toMatch(
      /quicknet|ethereum|activationSalt|randomness|quotaPerLanguage/iu,
    );
    expect(parseC6SourceV3SimpleProtocol(serialized))
      .toEqual(result.protocol);
    expect(serialized).toBe(expectedProtocolBytes);
    expect(result.outputSha256).toBe(
      "5f989ab640c684dac287142edc9d2f9d8ee46099c082f63bb20f2a9546205132",
    );
    expect(result.outputSha256).toBe(sha256(serialized));
  });

  it("leaves episode construction and final allocation to separate gates", async () => {
    const sourceV2Bytes = await readFile(SOURCE_V2_PATH);
    const { protocol } =
      buildC6SourceV3SimpleProtocol(sourceV2Bytes);

    expect(protocol.downstreamGates).toEqual({
      candidateSelectionPermitted: false,
      episodeConstructionProtocol:
        "required-separate-complete-edge-and-stage-triple-protocol",
      repositoryAllocationProtocol:
        "required-separate-outcome-blind-power-and-precision-artifact",
      taskOriginAndRelationshipProtocol:
        "required-separate-raw-row-projector-and-per-edge-review",
    });
    expect(protocol.promotionReceiptContract).toEqual({
      artifactKind: "c6-source-v3-simple-promotion-receipt",
      requiredBindings: [
        "protocol-bytes-and-sha256",
        "review-request-input-dispatch-response-provenance",
        "reviewer-identity-and-author-separation",
        "freeze-commit-tree-parent-and-ancestry",
        "verifier-source-sha256",
        "prior-repository-node-id-exclusion-closure",
      ],
      schemaVersion: 1,
      selfAuthorizationAllowed: false,
    });
    expect(protocol.censusReceiptContract).toEqual({
      actualReceiptPresent: false,
      artifactKind: "c6-source-v3-simple-census-receipt",
      requiredBindings: [
        "protocol-bytes-and-sha256",
        "complete-root-count-tree-and-leaf-set",
        "repository-page-request-response-cursor-and-terminal-closure",
        "repository-normalization-source-sha256-and-two-pass-row-set-sha256",
        "alias-and-node-id-exclusion-closure",
        "pull-request-page-request-response-cursor-and-terminal-closure",
        "pull-request-normalization-source-sha256-and-two-pass-row-set-sha256",
        "one-metadata-decision-per-normalized-pull-request-row",
        "asset-lock-and-terminal-input-replay",
      ],
      schemaVersion: 1,
    });
    expect(protocol).not.toHaveProperty("allocationProtocol");
    expect(protocol).not.toHaveProperty("qualificationProtocol");
  });

  it("rejects source-v2 drift and noncanonical protocol bytes", async () => {
    const sourceV2Bytes = await readFile(SOURCE_V2_PATH);
    const drifted = Buffer.from(sourceV2Bytes);
    drifted[drifted.length - 2] = 0x20;

    expect(() => buildC6SourceV3SimpleProtocol(drifted)).toThrow(
      "source-v2 bytes do not match the frozen reference",
    );

    const { protocol } =
      buildC6SourceV3SimpleProtocol(sourceV2Bytes);
    expect(() => parseC6SourceV3SimpleProtocol(
      JSON.stringify(protocol),
    )).toThrow("requires canonical JSON");
    expect(() => parseC6SourceV3SimpleProtocol(
      `${JSON.stringify({ ...protocol, callerSalt: "forbidden" }, null, 2)}\n`,
    )).toThrow();
    expect(() => parseC6SourceV3SimpleProtocol(
      `${JSON.stringify({
        ...protocol,
        boundary: {
          ...protocol.boundary,
          formalCensusPermitted: true,
        },
      }, null, 2)}\n`,
    )).toThrow();
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
