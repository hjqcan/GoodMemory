import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
  fingerprintProviderRequestIdentity,
} from "../../scripts/provider-response-tape";
import {
  decodeProviderResponseTapeBundle,
  encodeProviderResponseTapeBundle,
  parseProviderResponseTapeBundleManifest,
  PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY,
} from "../../scripts/provider-response-tape-bundle";
import type { ProviderResponseTape } from "../../scripts/provider-response-tape";

function tapeWithBody(bytes: Uint8Array): ProviderResponseTape {
  const bodyBase64 = Buffer.from(bytes).toString("base64");
  const responseSha256 = createHash("sha256").update(bytes).digest("hex");
  const request = {
    canonicalBodySha256: "b".repeat(64),
    method: "POST",
    path: "/embeddings",
    semanticHeadersSha256: "c".repeat(64),
    targetId: "embedding",
  };
  const fingerprint = fingerprintProviderRequestIdentity(request);
  return {
    entries: [{
      fingerprint,
      occurrence: 0,
      request,
      response: {
        bodyBase64,
        bytes: bytes.byteLength,
        contentType: "application/json",
        sha256: responseSha256,
        status: 200,
        statusText: "OK",
      },
    }],
    schemaVersion: 3,
  };
}

describe("provider response tape bundle", () => {
  it("keeps raw and stored evidence inside the preregistered CI memory and push bounds", () => {
    expect(PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY).toEqual({
      maxPartBytes: 20 * 1024 * 1024,
      maxParts: 24,
      maxRawBytes: 384 * 1024 * 1024,
      maxTotalBytes: 512 * 1024 * 1024,
      partUncompressedBytes: 16 * 1024 * 1024,
    });
    expect(
      PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxParts *
        PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.partUncompressedBytes,
    ).toBe(PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxRawBytes);
    expect(PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxPartBytes)
      .toBeLessThan(100 * 1024 * 1024);
    expect(PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxTotalBytes)
      .toBeLessThan(2 * 1024 * 1024 * 1024);
  });

  it("writes deterministic gzip parts below the tracked-blob limit and losslessly restores the tape", () => {
    const body = new Uint8Array(
      PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.partUncompressedBytes,
    );
    const tape = tapeWithBody(body);
    const first = encodeProviderResponseTapeBundle(tape);
    const second = encodeProviderResponseTapeBundle(tape);

    expect(first.parts.length).toBeGreaterThan(1);
    expect(first.manifestRaw).toBe(second.manifestRaw);
    expect(first.parts.map(({ bytes }) => Buffer.from(bytes).toString("hex")))
      .toEqual(second.parts.map(({ bytes }) => Buffer.from(bytes).toString("hex")));
    expect(first.parts.every(({ bytes }) =>
      bytes.byteLength <= PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxPartBytes
    )).toBe(true);
    expect(first.parts.reduce((total, part) => total + part.bytes.byteLength, 0))
      .toBeLessThanOrEqual(
        PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxTotalBytes,
      );

    const decoded = decodeProviderResponseTapeBundle({
      manifestRaw: first.manifestRaw,
      parts: new Map(first.parts.map((part) => [part.path, part.bytes])),
    });
    expect(decoded.raw).toBe(first.raw);
    expect(decoded.tape).toEqual(tape);
  });

  it("rejects a missing, mutated, or path-escaping gzip part", () => {
    const encoded = encodeProviderResponseTapeBundle(
      tapeWithBody(new TextEncoder().encode("small response")),
    );
    expect(() => decodeProviderResponseTapeBundle({
      manifestRaw: encoded.manifestRaw,
      parts: new Map(),
    })).toThrow("missing");

    const mutated = Uint8Array.from(encoded.parts[0]!.bytes);
    mutated[mutated.length - 1] ^= 1;
    expect(() => decodeProviderResponseTapeBundle({
      manifestRaw: encoded.manifestRaw,
      parts: new Map([[encoded.parts[0]!.path, mutated]]),
    })).toThrow("fingerprint");

    const manifest = JSON.parse(encoded.manifestRaw) as {
      parts: Array<{ path: string }>;
    };
    manifest.parts[0]!.path = "../escape.json.gz";
    expect(() => decodeProviderResponseTapeBundle({
      manifestRaw: `${JSON.stringify(manifest, null, 2)}\n`,
      parts: new Map([["../escape.json.gz", encoded.parts[0]!.bytes]]),
    })).toThrow("path");
  });

  it("rejects a manifest whose canonical raw size exceeds the memory bound", () => {
    const encoded = encodeProviderResponseTapeBundle(
      tapeWithBody(new TextEncoder().encode("small response")),
    );
    const manifest = JSON.parse(encoded.manifestRaw) as {
      maxRawBytes: number;
      rawBytes: number;
    };
    manifest.rawBytes = PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxRawBytes + 1;
    expect(() => parseProviderResponseTapeBundleManifest(
      `${JSON.stringify(manifest, null, 2)}\n`,
    )).toThrow("size");
  });

  it("binds the preregistered part-count limit in the bundle manifest", () => {
    const encoded = encodeProviderResponseTapeBundle(
      tapeWithBody(new TextEncoder().encode("small response")),
    );
    const manifest = JSON.parse(encoded.manifestRaw) as { maxParts: number };
    expect(manifest.maxParts).toBe(PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxParts);
    manifest.maxParts += 1;
    expect(() => parseProviderResponseTapeBundleManifest(
      `${JSON.stringify(manifest, null, 2)}\n`,
    )).toThrow("invalid");
  });
});
