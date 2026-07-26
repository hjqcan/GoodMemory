import { createHash } from "node:crypto";
import {
  join,
  resolve,
} from "node:path";

import { z } from "zod";

import {
  loadC6AssetLock,
  readC6StableRegularFile,
} from "./c6-asset-lock";
import {
  verifyC6SourceV3SimplePriorRepositoryIdentityBundle,
} from "./c6-source-v3-simple-prior-repository-identity";
import {
  C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_STRUCTURE_PATH,
  parseC6SourceV3SimplePriorRepositoryIdentityStructure,
} from "./c6-source-v3-simple-prior-repository-identity-structure";
import type {
  C6Wave3PriorRepositoryIdentityCaptureLookup,
} from "./c6-wave3-prior-repository-identity-artifacts";

const PROTOCOL = {
  artifactKind: "c6-source-v3-simple-protocol",
  bytes: 3_992,
  path:
    "swe-bench-live-multilang-608f7ae9." +
    "source-v3-simple-protocol-v1.json",
  schemaVersion: 1,
  sha256:
    "5f989ab640c684dac287142edc9d2f9d8ee46099c082f63bb20f2a9546205132",
} as const;
const PLAN = {
  artifactKind:
    "c6-wave3-prior-repository-identity-plan",
  bytes: 76_257,
  path:
    "swe-bench-live-multilang-608f7ae9." +
    "wave3-prior-repository-identity-plan-v1.json",
  schemaVersion: 1,
  sha256:
    "70b202cd6da6c2c504a0c23168dc9bcb6a73e9697ff98884dcc83ca785cd4ee2",
} as const;
const SOURCE_UNIVERSE = {
  artifactKind: "c6-wave3-source-universe",
  bytes: 631_004,
  path:
    "swe-bench-live-multilang-608f7ae9." +
    "wave3-source-universe-v2.json",
  schemaVersion: 2,
  sha256:
    "822c458e792ee31f7738cae2526b05dfc3b63fcaac58e3f4f87dcd3803ccdba1",
} as const;

export const C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_PATH =
  "swe-bench-live-multilang-608f7ae9." +
  "source-v3-simple-prior-repository-identity-observation-replay-v1.json";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const assetLockReferenceSchema = z.object({
  artifactKind: z.literal("c6-asset-lock"),
  assetRootSha256: sha256Schema,
  sha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();
const captureObservationSchema = z.object({
  finalRequestIdProjectionSha256: sha256Schema,
  networkAttemptCount: z.number().int().min(356).max(
    1_424,
  ),
  nodeIdDedupProjectionSha256: sha256Schema,
  outerAssetLock: assetLockReferenceSchema,
  rawEvidenceAssetLock: assetLockReferenceSchema,
  repositoryIdentityProjectionSha256: sha256Schema,
  structure: z.object({
    bytes: z.number().int().positive(),
    path: z.literal(
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_STRUCTURE_PATH,
    ),
    sha256: sha256Schema,
  }).strict(),
  uniqueNodeIdCount: z.number().int().min(1).max(178),
}).strict();
const receiptSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-prior-repository-identity-observation-replay",
  ),
  boundary: z.object({
    candidateManifestFrozen: z.literal(false),
    captureOriginIndependentlyVerified: z.literal(false),
    codexRunReady: z.literal(false),
    externalAuthenticityVerified: z.literal(false),
    formalCensusPermitted: z.literal(false),
    independentCaptureProcessProven: z.literal(false),
    liveNetworkExecutionProven: z.literal(false),
    priorRepositoryNodeIdExclusionComplete: z.literal(false),
    repositoryIdentityReplayAgreementObserved:
      z.literal(true),
    sourceV3SimpleFrozen: z.literal(false),
    status: z.literal(
      "two-observation-set-structures-agree-awaiting-live-provenance-independent-review-and-freeze-ancestry",
    ),
  }).strict(),
  captures: z.object({
    captureA: captureObservationSchema,
    captureB: captureObservationSchema,
  }).strict(),
  comparison: z.object({
    combinedFinalRequestIdProjectionSha256: sha256Schema,
    finalRequestIdIntersectionCount: z.literal(0),
    nodeIdDedupProjectionEqual: z.literal(true),
    nodeIdDedupProjectionSha256: sha256Schema,
    repositoryIdentityProjectionEqual: z.literal(true),
    repositoryIdentityProjectionSha256: sha256Schema,
  }).strict(),
  counts: z.object({
    captureCount: z.literal(2),
    finalRequestIdCountPerCapture: z.literal(356),
    logicalLookupCountPerCapture: z.literal(356),
    totalNetworkAttemptCount: z.number().int().min(712).max(
      2_848,
    ),
    uniqueNodeIdCount: z.number().int().min(1).max(178),
  }).strict(),
  inputs: z.object({
    plan: z.object({
      artifactKind: z.literal(PLAN.artifactKind),
      bytes: z.literal(PLAN.bytes),
      path: z.literal(PLAN.path),
      schemaVersion: z.literal(PLAN.schemaVersion),
      sha256: z.literal(PLAN.sha256),
    }).strict(),
    protocol: z.object({
      artifactKind: z.literal(PROTOCOL.artifactKind),
      bytes: z.literal(PROTOCOL.bytes),
      path: z.literal(PROTOCOL.path),
      schemaVersion: z.literal(PROTOCOL.schemaVersion),
      sha256: z.literal(PROTOCOL.sha256),
    }).strict(),
    sourceUniverse: z.object({
      artifactKind: z.literal(
        SOURCE_UNIVERSE.artifactKind,
      ),
      bytes: z.literal(SOURCE_UNIVERSE.bytes),
      path: z.literal(SOURCE_UNIVERSE.path),
      schemaVersion: z.literal(
        SOURCE_UNIVERSE.schemaVersion,
      ),
      sha256: z.literal(SOURCE_UNIVERSE.sha256),
    }).strict(),
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();

export type C6SourceV3SimplePriorRepositoryIdentityReplayReceipt =
  z.infer<typeof receiptSchema>;

interface ReplayInput {
  captureA: string;
  captureB: string;
  planPath: string;
  protocolPath: string;
  sourceUniversePath: string;
}

interface CaptureObservation {
  finalRequestIds: string[];
  nodeIdDedupProjection: unknown[];
  receipt: z.infer<typeof captureObservationSchema>;
  repositoryIdentityProjection: Array<{
    repositoryNodeId: string;
    requestedNameWithOwner: string;
    resolvedNameWithOwner: string;
    resolvedUrl: string;
  }>;
}

export async function buildC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
  input: ReplayInput,
): Promise<C6SourceV3SimplePriorRepositoryIdentityReplayReceipt> {
  if (resolve(input.captureA) === resolve(input.captureB)) {
    throw new Error(
      "C6 source-v3-simple prior identity replay requires distinct observation sets",
    );
  }
  const [captureA, captureB] = await Promise.all([
    observeCapture(input.captureA, input),
    observeCapture(input.captureB, input),
  ]);
  const projectionA = JSON.stringify(
    captureA.repositoryIdentityProjection,
  );
  const projectionB = JSON.stringify(
    captureB.repositoryIdentityProjection,
  );
  if (projectionA !== projectionB) {
    throw new Error(
      "C6 source-v3-simple prior identity replay repository identities disagree",
    );
  }
  const nodeIdDedupProjectionA = JSON.stringify(
    captureA.nodeIdDedupProjection,
  );
  const nodeIdDedupProjectionB = JSON.stringify(
    captureB.nodeIdDedupProjection,
  );
  if (nodeIdDedupProjectionA !== nodeIdDedupProjectionB) {
    throw new Error(
      "C6 source-v3-simple prior identity replay node ID dedup projections disagree",
    );
  }
  const requestIdsA = new Set(captureA.finalRequestIds);
  const requestIdsB = new Set(captureB.finalRequestIds);
  const intersection = [...requestIdsA].filter(
    (requestId) => requestIdsB.has(requestId),
  );
  if (
    requestIdsA.size !== 356 ||
    requestIdsB.size !== 356 ||
    intersection.length !== 0 ||
    captureA.receipt.outerAssetLock.assetRootSha256 ===
      captureB.receipt.outerAssetLock.assetRootSha256 ||
    captureA.receipt.structure.sha256 ===
      captureB.receipt.structure.sha256
  ) {
    throw new Error(
      "C6 source-v3-simple prior identity replay requires distinct observation sets",
    );
  }
  const repositoryIdentityProjectionSha256 =
    sha256(projectionA);
  return receiptSchema.parse({
    artifactKind:
      "c6-source-v3-simple-prior-repository-identity-observation-replay",
    boundary: {
      candidateManifestFrozen: false,
      captureOriginIndependentlyVerified: false,
      codexRunReady: false,
      externalAuthenticityVerified: false,
      formalCensusPermitted: false,
      independentCaptureProcessProven: false,
      liveNetworkExecutionProven: false,
      priorRepositoryNodeIdExclusionComplete: false,
      repositoryIdentityReplayAgreementObserved: true,
      sourceV3SimpleFrozen: false,
      status:
        "two-observation-set-structures-agree-awaiting-live-provenance-independent-review-and-freeze-ancestry",
    },
    captures: {
      captureA: captureA.receipt,
      captureB: captureB.receipt,
    },
    comparison: {
      combinedFinalRequestIdProjectionSha256: sha256(
        JSON.stringify([
          captureA.finalRequestIds,
          captureB.finalRequestIds,
        ]),
      ),
      finalRequestIdIntersectionCount: 0,
      nodeIdDedupProjectionEqual: true,
      nodeIdDedupProjectionSha256: sha256(
        nodeIdDedupProjectionA,
      ),
      repositoryIdentityProjectionEqual: true,
      repositoryIdentityProjectionSha256,
    },
    counts: {
      captureCount: 2,
      finalRequestIdCountPerCapture: 356,
      logicalLookupCountPerCapture: 356,
      totalNetworkAttemptCount:
        captureA.receipt.networkAttemptCount +
        captureB.receipt.networkAttemptCount,
      uniqueNodeIdCount:
        captureA.receipt.uniqueNodeIdCount,
    },
    inputs: {
      plan: PLAN,
      protocol: PROTOCOL,
      sourceUniverse: SOURCE_UNIVERSE,
    },
    schemaVersion: 1,
  });
}

export async function verifyC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
  bytes: string | Uint8Array,
  input: ReplayInput,
): Promise<C6SourceV3SimplePriorRepositoryIdentityReplayReceipt> {
  const parsed =
    parseC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
      bytes,
    );
  const rebuilt =
    await buildC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
      input,
    );
  if (
    serializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
      parsed,
    ) !==
      serializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
        rebuilt,
      )
  ) {
    throw new Error(
      "C6 source-v3-simple prior identity replay receipt mismatch",
    );
  }
  return parsed;
}

export function serializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
  input: C6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
): string {
  return `${JSON.stringify(receiptSchema.parse(input), null, 2)}\n`;
}

export function parseC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
  input: string | Uint8Array,
): C6SourceV3SimplePriorRepositoryIdentityReplayReceipt {
  const bytes = typeof input === "string"
    ? Buffer.from(input)
    : Buffer.from(input);
  let text: string;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(bytes);
  } catch {
    throw new Error(
      "C6 source-v3-simple prior identity replay receipt is not UTF-8",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 source-v3-simple prior identity replay receipt is not JSON",
    );
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 source-v3-simple prior identity replay receipt is not canonical JSON",
    );
  }
  return receiptSchema.parse(raw);
}

async function observeCapture(
  outputRoot: string,
  input: Pick<
    ReplayInput,
    "planPath" | "protocolPath" | "sourceUniversePath"
  >,
): Promise<CaptureObservation> {
  const evidence =
    await verifyC6SourceV3SimplePriorRepositoryIdentityBundle({
      outputRoot,
      planPath: input.planPath,
      protocolPath: input.protocolPath,
      sourceUniversePath: input.sourceUniversePath,
    });
  const rawEvidenceRoot = join(
    outputRoot,
    "raw-evidence",
  );
  const [
    outerAssetLock,
    rawEvidenceAssetLock,
    structureBytes,
  ] = await Promise.all([
    loadC6AssetLock(outputRoot),
    loadC6AssetLock(rawEvidenceRoot),
    readC6StableRegularFile(
      join(
        outputRoot,
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_STRUCTURE_PATH,
      ),
      "source-v3-simple prior identity replay structure",
    ),
  ]);
  const structure =
    parseC6SourceV3SimplePriorRepositoryIdentityStructure(
      structureBytes,
    );
  if (
    sha256(structureBytes) !== evidence.structureSha256 ||
    structure.counts.uniqueNodeIdCount !==
      evidence.uniqueNodeIdCount
  ) {
    throw new Error(
      "C6 source-v3-simple prior identity replay capture changed after verification",
    );
  }
  const lookups = structure.lookups as
    C6Wave3PriorRepositoryIdentityCaptureLookup[];
  const finalRequestIds = lookups.map((lookup) => {
    const finalAttempt =
      lookup.attempts[lookup.finalAttempt - 1];
    const requestId =
      finalAttempt?.selectedResponseHeaders[
        "x-github-request-id"
      ];
    if (requestId === undefined || requestId === null) {
      throw new Error(
        "C6 source-v3-simple prior identity replay final request ID is missing",
      );
    }
    return requestId;
  });
  const passALookups = new Map(
    lookups.filter((lookup) => lookup.pass === "A").map(
      (lookup) => [
        lookup.requestedNameWithOwner,
        lookup,
      ],
    ),
  );
  const repositoryIdentityProjection =
    structure.mappings.map((mapping) => {
      const lookup = passALookups.get(
        mapping.requestedNameWithOwner,
      );
      if (lookup === undefined) {
        throw new Error(
          "C6 source-v3-simple prior identity replay mapping lookup is missing",
        );
      }
      return {
        repositoryNodeId: mapping.repositoryNodeId,
        requestedNameWithOwner:
          mapping.requestedNameWithOwner,
        resolvedNameWithOwner:
          mapping.resolvedNameWithOwner,
        resolvedUrl: lookup.resolvedUrl,
      };
    });
  return {
    finalRequestIds,
    nodeIdDedupProjection: structure.nodeIdDedup,
    receipt: {
      finalRequestIdProjectionSha256: sha256(
        JSON.stringify(finalRequestIds),
      ),
      networkAttemptCount:
        evidence.networkAttemptCount,
      nodeIdDedupProjectionSha256: sha256(
        JSON.stringify(structure.nodeIdDedup),
      ),
      outerAssetLock: {
        artifactKind: "c6-asset-lock",
        assetRootSha256:
          outerAssetLock.assetLock.assetRootSha256,
        schemaVersion: 1,
        sha256: outerAssetLock.assetLockSha256,
      },
      rawEvidenceAssetLock: {
        artifactKind: "c6-asset-lock",
        assetRootSha256:
          rawEvidenceAssetLock.assetLock.assetRootSha256,
        schemaVersion: 1,
        sha256:
          rawEvidenceAssetLock.assetLockSha256,
      },
      repositoryIdentityProjectionSha256: sha256(
        JSON.stringify(repositoryIdentityProjection),
      ),
      structure: {
        bytes: structureBytes.byteLength,
        path:
          C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_STRUCTURE_PATH,
        sha256: evidence.structureSha256,
      },
      uniqueNodeIdCount:
        evidence.uniqueNodeIdCount,
    },
    repositoryIdentityProjection,
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
