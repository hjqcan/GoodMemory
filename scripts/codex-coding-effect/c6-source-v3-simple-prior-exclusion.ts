import { createHash } from "node:crypto";

import { z } from "zod";

import {
  parseC6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
} from "./c6-source-v3-simple-prior-repository-identity-replay";

const repositorySchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const nodeIdDedupRowSchema = z.object({
  repositoryNodeId: z.string().min(1),
  requestedAliases: z.array(repositorySchema).min(1),
  resolvedNameWithOwnerAsciiFold: repositorySchema,
  resolvedNameWithOwnerExactValues:
    z.array(repositorySchema).min(1),
}).strict();
const projectionSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-prior-repository-exclusion-projection",
  ),
  nodeIdDedup: z.array(nodeIdDedupRowSchema).min(1),
  schemaVersion: z.literal(1),
}).strict();

export type C6SourceV3SimplePriorExclusionProjection =
  z.infer<typeof projectionSchema>;

export interface C6SourceV3SimplePriorExclusionSet {
  aliases: string[];
  nodeIds: string[];
  nodeIdDedupProjectionSha256: string;
}

export function verifyC6SourceV3SimplePriorExclusionProjection(
  input: string | Uint8Array,
  expected: {
    expectedNodeIdDedupProjectionSha256: string;
    expectedUniqueNodeIdCount: number;
  },
): C6SourceV3SimplePriorExclusionSet {
  const projection = parseProjection(input);
  const nodeIdDedupProjectionSha256 = sha256(
    JSON.stringify(projection.nodeIdDedup),
  );
  if (
    nodeIdDedupProjectionSha256 !==
      expected.expectedNodeIdDedupProjectionSha256
  ) {
    throw new Error(
      "C6 source-v3-simple prior exclusion projection hash mismatch",
    );
  }
  const nodeIds = projection.nodeIdDedup.map(
    (row) => row.repositoryNodeId,
  );
  if (
    nodeIds.length !== expected.expectedUniqueNodeIdCount ||
    new Set(nodeIds).size !== nodeIds.length
  ) {
    throw new Error(
      "C6 source-v3-simple prior exclusion node ID count mismatch",
    );
  }
  const aliases = new Set<string>();
  for (const row of projection.nodeIdDedup) {
    for (const alias of [
      ...row.requestedAliases,
      row.resolvedNameWithOwnerAsciiFold,
      ...row.resolvedNameWithOwnerExactValues,
    ]) {
      aliases.add(asciiCaseFold(alias));
    }
  }
  return {
    aliases: [...aliases].sort(compareUtf8),
    nodeIds,
    nodeIdDedupProjectionSha256,
  };
}

export function loadC6SourceV3SimplePriorExclusionSet(input: {
  projectionBytes: string | Uint8Array;
  replayReceiptBytes: string | Uint8Array;
}): C6SourceV3SimplePriorExclusionSet {
  const receipt =
    parseC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
      input.replayReceiptBytes,
    );
  const expectedHash =
    receipt.comparison.nodeIdDedupProjectionSha256;
  if (
    receipt.captures.captureA.nodeIdDedupProjectionSha256 !==
      expectedHash ||
    receipt.captures.captureB.nodeIdDedupProjectionSha256 !==
      expectedHash ||
    receipt.counts.uniqueNodeIdCount !==
      receipt.captures.captureA.uniqueNodeIdCount ||
    receipt.counts.uniqueNodeIdCount !==
      receipt.captures.captureB.uniqueNodeIdCount
  ) {
    throw new Error(
      "C6 source-v3-simple prior exclusion replay receipt is inconsistent",
    );
  }
  return verifyC6SourceV3SimplePriorExclusionProjection(
    input.projectionBytes,
    {
      expectedNodeIdDedupProjectionSha256: expectedHash,
      expectedUniqueNodeIdCount:
        receipt.counts.uniqueNodeIdCount,
    },
  );
}

export function serializeC6SourceV3SimplePriorExclusionProjection(
  input: C6SourceV3SimplePriorExclusionProjection,
): string {
  return `${JSON.stringify(projectionSchema.parse(input), null, 2)}\n`;
}

function parseProjection(
  input: string | Uint8Array,
): C6SourceV3SimplePriorExclusionProjection {
  const bytes = Buffer.from(input);
  let text: string;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(bytes);
  } catch {
    throw new Error(
      "C6 source-v3-simple prior exclusion projection is not UTF-8",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 source-v3-simple prior exclusion projection is not JSON",
    );
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 source-v3-simple prior exclusion projection is not canonical JSON",
    );
  }
  return projectionSchema.parse(raw);
}

function asciiCaseFold(value: string): string {
  return value.replace(/[A-Z]/gu, (character) =>
    character.toLowerCase()
  );
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
