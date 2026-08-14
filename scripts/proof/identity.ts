import { createHash } from "node:crypto";

import {
  canonicalJsonBytes,
} from "./canonical";

export interface ContentAddressedIdentity {
  bytes: number;
  sha256: string;
}

export function contentAddress(
  bytes: Uint8Array | string,
): ContentAddressedIdentity {
  return {
    bytes: typeof bytes === "string"
      ? Buffer.byteLength(bytes)
      : bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function proofIdentity(value: unknown): ContentAddressedIdentity {
  return contentAddress(canonicalJsonBytes(value));
}
