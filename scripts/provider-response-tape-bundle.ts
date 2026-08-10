import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  parseProviderResponseTape,
  serializeProviderResponseTape,
} from "./provider-response-tape";
import type { ProviderResponseTape } from "./provider-response-tape";

export const PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY = {
  maxPartBytes: 20 * 1024 * 1024,
  maxParts: 24,
  maxRawBytes: 384 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  partUncompressedBytes: 16 * 1024 * 1024,
} as const;

interface ProviderResponseTapeBundlePartIdentity {
  bytes: number;
  index: number;
  path: string;
  rawBytes: number;
  rawSha256: string;
  sha256: string;
}

export interface ProviderResponseTapeBundleManifest {
  compression: "gzip";
  maxPartBytes: number;
  maxParts: number;
  maxRawBytes: number;
  maxTotalBytes: number;
  partUncompressedBytes: number;
  parts: ProviderResponseTapeBundlePartIdentity[];
  rawBytes: number;
  rawSha256: string;
  schemaVersion: 1;
  tapeSchemaVersion: 3;
}

export interface EncodedProviderResponseTapeBundle {
  manifest: ProviderResponseTapeBundleManifest;
  manifestRaw: string;
  parts: Array<{ bytes: Uint8Array; path: string }>;
  raw: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expected].sort());
}

function partPath(index: number): string {
  return `part-${String(index).padStart(4, "0")}.json.gz`;
}

function assertManifest(
  value: unknown,
): asserts value is ProviderResponseTapeBundleManifest {
  if (
    !hasExactKeys(value, [
      "compression",
      "maxPartBytes",
      "maxParts",
      "maxRawBytes",
      "maxTotalBytes",
      "partUncompressedBytes",
      "parts",
      "rawBytes",
      "rawSha256",
      "schemaVersion",
      "tapeSchemaVersion",
    ]) ||
    value.compression !== "gzip" ||
    value.schemaVersion !== 1 ||
    value.tapeSchemaVersion !== 3 ||
    value.maxPartBytes !== PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxPartBytes ||
    value.maxParts !== PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxParts ||
    value.maxRawBytes !== PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxRawBytes ||
    value.maxTotalBytes !== PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxTotalBytes ||
    value.partUncompressedBytes !==
      PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.partUncompressedBytes ||
    !Number.isSafeInteger(value.rawBytes) ||
    (value.rawBytes as number) <= 0 ||
    typeof value.rawSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.rawSha256) ||
    !Array.isArray(value.parts) ||
    value.parts.length === 0 ||
    value.parts.length > PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxParts
  ) {
    throw new Error("provider response tape bundle manifest is invalid");
  }
  let storedBytes = 0;
  let rawBytes = 0;
  value.parts.forEach((part, index) => {
    if (
      !hasExactKeys(part, [
        "bytes",
        "index",
        "path",
        "rawBytes",
        "rawSha256",
        "sha256",
      ]) ||
      part.index !== index ||
      part.path !== partPath(index)
    ) {
      throw new Error("provider response tape bundle part path is invalid");
    }
    if (
      !Number.isSafeInteger(part.bytes) ||
      (part.bytes as number) <= 0 ||
      (part.bytes as number) > PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxPartBytes ||
      !Number.isSafeInteger(part.rawBytes) ||
      (part.rawBytes as number) <= 0 ||
      (part.rawBytes as number) >
        PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.partUncompressedBytes ||
      typeof part.rawSha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(part.rawSha256) ||
      typeof part.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(part.sha256)
    ) {
      throw new Error("provider response tape bundle part identity is invalid");
    }
    storedBytes += part.bytes as number;
    rawBytes += part.rawBytes as number;
  });
  if (
    storedBytes > PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxTotalBytes ||
    (value.rawBytes as number) > PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxRawBytes ||
    rawBytes !== value.rawBytes
  ) {
    throw new Error("provider response tape bundle size is invalid");
  }
}

export function encodeProviderResponseTapeBundle(
  tape: ProviderResponseTape,
): EncodedProviderResponseTapeBundle {
  const raw = serializeProviderResponseTape(tape);
  const rawBytes = Buffer.from(raw, "utf8");
  if (rawBytes.byteLength > PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxRawBytes) {
    throw new Error("provider response tape bundle exceeds the raw memory limit");
  }
  const parts: Array<{ bytes: Uint8Array; path: string }> = [];
  const identities: ProviderResponseTapeBundlePartIdentity[] = [];
  for (
    let offset = 0, index = 0;
    offset < rawBytes.byteLength;
    offset += PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.partUncompressedBytes, index += 1
  ) {
    if (index >= PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxParts) {
      throw new Error("provider response tape bundle exceeds the part limit");
    }
    const rawPart = rawBytes.subarray(
      offset,
      Math.min(
        rawBytes.byteLength,
        offset + PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.partUncompressedBytes,
      ),
    );
    const bytes = gzipSync(rawPart, { level: 9 });
    if (bytes.byteLength > PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxPartBytes) {
      throw new Error("provider response tape bundle part exceeds the tracked-blob limit");
    }
    const path = partPath(index);
    parts.push({ bytes, path });
    identities.push({
      bytes: bytes.byteLength,
      index,
      path,
      rawBytes: rawPart.byteLength,
      rawSha256: sha256(rawPart),
      sha256: sha256(bytes),
    });
  }
  const totalBytes = parts.reduce((total, part) => total + part.bytes.byteLength, 0);
  if (totalBytes > PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxTotalBytes) {
    throw new Error("provider response tape bundle exceeds the tracked push limit");
  }
  const manifest: ProviderResponseTapeBundleManifest = {
    compression: "gzip",
    maxPartBytes: PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxPartBytes,
    maxParts: PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxParts,
    maxRawBytes: PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxRawBytes,
    maxTotalBytes: PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxTotalBytes,
    partUncompressedBytes:
      PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.partUncompressedBytes,
    parts: identities,
    rawBytes: rawBytes.byteLength,
    rawSha256: sha256(rawBytes),
    schemaVersion: 1,
    tapeSchemaVersion: 3,
  };
  return {
    manifest,
    manifestRaw: `${JSON.stringify(manifest, null, 2)}\n`,
    parts,
    raw,
  };
}

export function decodeProviderResponseTapeBundle(input: {
  manifestRaw: string;
  parts: ReadonlyMap<string, Uint8Array>;
}): { raw: string; tape: ProviderResponseTape } {
  const manifest = JSON.parse(input.manifestRaw) as unknown;
  assertManifest(manifest);
  if (input.parts.size !== manifest.parts.length) {
    throw new Error("provider response tape bundle part is missing or extra");
  }
  const rawBytes = Buffer.allocUnsafe(manifest.rawBytes);
  let rawOffset = 0;
  for (const identity of manifest.parts) {
    const bytes = input.parts.get(identity.path);
    if (bytes === undefined) {
      throw new Error(`provider response tape bundle part is missing: ${identity.path}`);
    }
    if (
      bytes.byteLength !== identity.bytes ||
      sha256(bytes) !== identity.sha256
    ) {
      throw new Error(`provider response tape bundle part fingerprint is invalid: ${identity.path}`);
    }
    const raw = gunzipSync(bytes, {
      maxOutputLength:
        PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.partUncompressedBytes,
    });
    if (
      raw.byteLength !== identity.rawBytes ||
      sha256(raw) !== identity.rawSha256
    ) {
      throw new Error(`provider response tape bundle raw part is invalid: ${identity.path}`);
    }
    raw.copy(rawBytes, rawOffset);
    rawOffset += raw.byteLength;
  }
  if (
    rawOffset !== manifest.rawBytes ||
    sha256(rawBytes) !== manifest.rawSha256
  ) {
    throw new Error("provider response tape bundle raw fingerprint is invalid");
  }
  const raw = rawBytes.toString("utf8");
  const tape = parseProviderResponseTape(raw);
  if (serializeProviderResponseTape(tape) !== raw) {
    throw new Error("provider response tape bundle is not canonical");
  }
  return { raw, tape };
}

export function parseProviderResponseTapeBundleManifest(
  raw: string,
): ProviderResponseTapeBundleManifest {
  const manifest = JSON.parse(raw) as unknown;
  assertManifest(manifest);
  return manifest;
}
