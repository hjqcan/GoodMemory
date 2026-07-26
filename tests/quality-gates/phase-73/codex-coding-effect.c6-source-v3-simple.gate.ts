import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  buildC6SourceV3SimpleProtocol,
  parseC6SourceV3SimpleProtocol,
  serializeC6SourceV3SimpleProtocol,
} from "../../../scripts/codex-coding-effect/c6-source-v3-simple";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_POOL_ROOT = join(
  REPOSITORY_ROOT,
  "fixtures/codex-coding-effect/c6-source-pool",
);
const SOURCE_V2_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.wave3-source-universe-v2.json",
);
const PROTOCOL_PATH = join(
  SOURCE_POOL_ROOT,
  "swe-bench-live-multilang-608f7ae9.source-v3-simple-protocol-v1.json",
);
const PROTOCOL_BYTES = 3_992;
const PROTOCOL_SHA256 =
  "5f989ab640c684dac287142edc9d2f9d8ee46099c082f63bb20f2a9546205132";

describe("Codex coding-effect C6 source-v3-simple gate", () => {
  it("rebuilds the exact non-authorizing source-census proposal", async () => {
    const [sourceV2Bytes, protocolBytes] = await Promise.all([
      readFile(SOURCE_V2_PATH),
      readFile(PROTOCOL_PATH),
    ]);
    const rebuilt = buildC6SourceV3SimpleProtocol(sourceV2Bytes);
    const parsed = parseC6SourceV3SimpleProtocol(protocolBytes);
    const serialized = serializeC6SourceV3SimpleProtocol(
      rebuilt.protocol,
    );

    expect(protocolBytes.byteLength).toBe(PROTOCOL_BYTES);
    expect(sha256(protocolBytes)).toBe(PROTOCOL_SHA256);
    expect(rebuilt.outputSha256).toBe(PROTOCOL_SHA256);
    expect(serialized).toBe(protocolBytes.toString("utf8"));
    expect(rebuilt.protocol).toEqual(parsed);
    expect(parsed.boundary).toMatchObject({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      formalCensusPermitted: false,
      sourceV3SimpleFrozen: false,
    });
    expect(parsed.downstreamGates.candidateSelectionPermitted)
      .toBe(false);
    expect(parsed.censusReceiptContract).toMatchObject({
      actualReceiptPresent: false,
      artifactKind: "c6-source-v3-simple-census-receipt",
      schemaVersion: 1,
    });
    expect(parsed).not.toHaveProperty("allocationProtocol");
    expect(parsed).not.toHaveProperty("qualificationProtocol");
    expect(serialized).not.toMatch(
      /quicknet|ethereum|activationSalt|randomness|quotaPerLanguage/iu,
    );
  });
});

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
