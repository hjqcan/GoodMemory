import { createHash } from "node:crypto";
import { join } from "node:path";

import { z } from "zod";

import {
  loadC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
} from "./c6-asset-lock";
import {
  parseC6SourceV3SimpleProtocol,
} from "./c6-source-v3-simple";
import {
  parseC6Wave3SourceUniverseV2,
} from "./c6-wave3-source-universe-v2";
import type {
  C6Wave3PriorRepositoryIdentityCaptureLookup,
} from "./c6-wave3-prior-repository-identity-artifacts";
import type {
  C6Wave3PriorRepositoryIdentityPlan,
} from "./c6-wave3-prior-repository-identity-plan";

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

export const C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_STRUCTURE_PATH =
  "swe-bench-live-multilang-608f7ae9." +
  "source-v3-simple-prior-repository-identity-structure-v1.json";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const repositorySchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const mappingSchema = z.object({
  passAAttemptReferences:
    z.array(artifactReferenceSchema).min(1).max(4),
  passBAttemptReferences:
    z.array(artifactReferenceSchema).min(1).max(4),
  repositoryNodeId: z.string().min(1),
  requestedNameWithOwner: repositorySchema,
  resolvedNameWithOwner: repositorySchema,
}).strict();
const nodeIdDedupSchema = z.object({
  repositoryNodeId: z.string().min(1),
  requestedAliases: z.array(repositorySchema).min(1),
  resolvedNameWithOwnerAsciiFold: repositorySchema,
  resolvedNameWithOwnerExactValues:
    z.array(repositorySchema).min(1),
}).strict();
const structureSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-prior-repository-identity-structure",
  ),
  boundary: z.object({
    candidateManifestFrozen: z.literal(false),
    captureOriginIndependentlyVerified: z.literal(false),
    codexRunReady: z.literal(false),
    formalCensusPermitted: z.literal(false),
    legacySourceV2CaptureAuthorized: z.literal(false),
    officialWave3SearchPermitted: z.literal(false),
    priorRepositoryNodeIdExclusionComplete: z.literal(false),
    priorRepositoryNodeIdExclusionStructureComplete:
      z.literal(true),
    sourceV3SimpleFrozen: z.literal(false),
    status: z.literal(
      "source-v3-prior-identity-structure-only-awaiting-independent-live-origin-verification",
    ),
  }).strict(),
  counts: z.object({
    aliasMappingCount: z.literal(178),
    logicalLookupCount: z.literal(356),
    networkAttemptCount: z.number().int().min(356).max(
      1_424,
    ),
    uniqueNodeIdCount: z.number().int().min(1).max(178),
  }).strict(),
  inputs: z.object({
    plan: artifactReferenceSchema.extend({
      artifactKind: z.literal(PLAN.artifactKind),
      bytes: z.literal(PLAN.bytes),
      path: z.literal(PLAN.path),
      schemaVersion: z.literal(PLAN.schemaVersion),
      sha256: z.literal(PLAN.sha256),
    }).strict(),
    protocol: artifactReferenceSchema.extend({
      artifactKind: z.literal(PROTOCOL.artifactKind),
      bytes: z.literal(PROTOCOL.bytes),
      path: z.literal(PROTOCOL.path),
      schemaVersion: z.literal(PROTOCOL.schemaVersion),
      sha256: z.literal(PROTOCOL.sha256),
    }).strict(),
    rawEvidenceAssetLock: artifactReferenceSchema.extend({
      artifactKind: z.literal("c6-asset-lock"),
      assetRootSha256: sha256Schema,
      path: z.literal("raw-evidence/asset-lock.json"),
      schemaVersion: z.literal(1),
    }).strict(),
    sourceUniverse: artifactReferenceSchema.extend({
      artifactKind: z.literal(SOURCE_UNIVERSE.artifactKind),
      bytes: z.literal(SOURCE_UNIVERSE.bytes),
      path: z.literal(SOURCE_UNIVERSE.path),
      schemaVersion: z.literal(
        SOURCE_UNIVERSE.schemaVersion,
      ),
      sha256: z.literal(SOURCE_UNIVERSE.sha256),
    }).strict(),
  }).strict(),
  lookups: z.array(z.unknown()).length(356),
  mappings: z.array(mappingSchema).length(178),
  nodeIdDedup: z.array(nodeIdDedupSchema).min(1).max(178),
  projections: z.object({
    attemptReferenceProjectionSha256: sha256Schema,
    nodeIdDedupProjectionSha256: sha256Schema,
    requestedToResolvedMappingProjectionSha256:
      sha256Schema,
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();

export type C6SourceV3SimplePriorRepositoryIdentityStructure =
  z.infer<typeof structureSchema>;

interface StructureContext {
  assetRoot: string;
  plan: C6Wave3PriorRepositoryIdentityPlan;
  planPath: string;
  protocolPath: string;
  sourceUniversePath: string;
}

export async function buildC6SourceV3SimplePriorRepositoryIdentityStructure(
  input: StructureContext & {
    lookups: readonly C6Wave3PriorRepositoryIdentityCaptureLookup[];
  },
): Promise<C6SourceV3SimplePriorRepositoryIdentityStructure> {
  const frozen = await loadFrozenInputs(input);
  const artifactModule = await import(
    "./c6-wave3-prior-repository-identity-artifacts"
  );
  await artifactModule
    .verifyC6Wave3PriorRepositoryIdentityDraftEvidenceArtifact({
      assetRoot: input.assetRoot,
      lookups: input.lookups,
      plan: {
        serialized: frozen.planBytes.toString("utf8"),
        targets: input.plan.targets,
      },
      planPath: input.planPath,
      sourceUniversePath: input.sourceUniversePath,
    });
  const assetLock = await loadC6AssetLock(input.assetRoot);
  const mappings = input.plan.targets.map((target) => {
    const passA =
      input.lookups[target.passALookupOrder - 1]!;
    const passB =
      input.lookups[target.passBLookupOrder - 1]!;
    return {
      passAAttemptReferences: passA.attempts.map(
        (attempt) => attempt.attemptArtifact,
      ),
      passBAttemptReferences: passB.attempts.map(
        (attempt) => attempt.attemptArtifact,
      ),
      repositoryNodeId: passA.repositoryNodeId,
      requestedNameWithOwner:
        target.requestedNameWithOwner,
      resolvedNameWithOwner:
        passA.resolvedNameWithOwner,
    };
  }).sort((left, right) =>
    compareStrings(
      left.requestedNameWithOwner,
      right.requestedNameWithOwner,
    )
  );
  const nodeIdDedup = deriveNodeIdDedup(mappings);
  const attemptReferenceProjection = mappings.map(
    (mapping) => ({
      passAAttemptReferences:
        mapping.passAAttemptReferences,
      passBAttemptReferences:
        mapping.passBAttemptReferences,
      requestedNameWithOwner:
        mapping.requestedNameWithOwner,
    }),
  );
  const assetLockBytes = Buffer.from(
    serializeC6AssetLock(assetLock.assetLock),
  );
  return structureSchema.parse({
    artifactKind:
      "c6-source-v3-simple-prior-repository-identity-structure",
    boundary: {
      candidateManifestFrozen: false,
      captureOriginIndependentlyVerified: false,
      codexRunReady: false,
      formalCensusPermitted: false,
      legacySourceV2CaptureAuthorized: false,
      officialWave3SearchPermitted: false,
      priorRepositoryNodeIdExclusionComplete: false,
      priorRepositoryNodeIdExclusionStructureComplete: true,
      sourceV3SimpleFrozen: false,
      status:
        "source-v3-prior-identity-structure-only-awaiting-independent-live-origin-verification",
    },
    counts: {
      aliasMappingCount: mappings.length,
      logicalLookupCount: input.lookups.length,
      networkAttemptCount: input.lookups.reduce(
        (count, lookup) => count + lookup.attempts.length,
        0,
      ),
      uniqueNodeIdCount: nodeIdDedup.length,
    },
    inputs: {
      plan: PLAN,
      protocol: PROTOCOL,
      rawEvidenceAssetLock: {
        artifactKind: "c6-asset-lock",
        assetRootSha256:
          assetLock.assetLock.assetRootSha256,
        ...artifactReference(
          "raw-evidence/asset-lock.json",
          assetLockBytes,
        ),
        schemaVersion: 1,
      },
      sourceUniverse: SOURCE_UNIVERSE,
    },
    lookups: input.lookups,
    mappings,
    nodeIdDedup,
    projections: {
      attemptReferenceProjectionSha256: sha256(
        JSON.stringify(attemptReferenceProjection),
      ),
      nodeIdDedupProjectionSha256: sha256(
        JSON.stringify(nodeIdDedup),
      ),
      requestedToResolvedMappingProjectionSha256: sha256(
        JSON.stringify(mappings),
      ),
    },
    schemaVersion: 1,
  });
}

export async function verifyC6SourceV3SimplePriorRepositoryIdentityStructure(
  bytes: string | Uint8Array,
  context: StructureContext,
): Promise<C6SourceV3SimplePriorRepositoryIdentityStructure> {
  const parsed =
    parseC6SourceV3SimplePriorRepositoryIdentityStructure(
      bytes,
    );
  const rebuilt =
    await buildC6SourceV3SimplePriorRepositoryIdentityStructure({
      ...context,
      lookups: parsed.lookups as
        C6Wave3PriorRepositoryIdentityCaptureLookup[],
    });
  if (
    serializeC6SourceV3SimplePriorRepositoryIdentityStructure(
      parsed,
    ) !==
      serializeC6SourceV3SimplePriorRepositoryIdentityStructure(
        rebuilt,
      )
  ) {
    throw new Error(
      "C6 source-v3-simple prior identity structure replay mismatch",
    );
  }
  return parsed;
}

export function serializeC6SourceV3SimplePriorRepositoryIdentityStructure(
  input: C6SourceV3SimplePriorRepositoryIdentityStructure,
): string {
  return `${JSON.stringify(structureSchema.parse(input), null, 2)}\n`;
}

export function parseC6SourceV3SimplePriorRepositoryIdentityStructure(
  input: string | Uint8Array,
): C6SourceV3SimplePriorRepositoryIdentityStructure {
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
      "C6 source-v3-simple prior identity structure is not UTF-8",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 source-v3-simple prior identity structure is not JSON",
    );
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 source-v3-simple prior identity structure is not canonical JSON",
    );
  }
  return structureSchema.parse(raw);
}

async function loadFrozenInputs(
  input: StructureContext,
): Promise<{
  planBytes: Buffer;
}> {
  const [planBytes, protocolBytes, sourceUniverseBytes] =
    await Promise.all([
      readC6StableRegularFile(
        input.planPath,
        "source-v3 prior identity structure plan",
      ),
      readC6StableRegularFile(
        input.protocolPath,
        "source-v3 prior identity structure protocol",
      ),
      readC6StableRegularFile(
        input.sourceUniversePath,
        "source-v3 prior identity structure source universe",
      ),
    ]);
  assertExactInput(planBytes, PLAN);
  assertExactInput(protocolBytes, PROTOCOL);
  assertExactInput(sourceUniverseBytes, SOURCE_UNIVERSE);
  const planModule = await import(
    "./c6-wave3-prior-repository-identity-plan"
  );
  const parsedPlan =
    planModule.parseC6Wave3PriorRepositoryIdentityPlan(
      planBytes,
    );
  const protocol =
    parseC6SourceV3SimpleProtocol(protocolBytes);
  parseC6Wave3SourceUniverseV2(sourceUniverseBytes);
  if (
    JSON.stringify(parsedPlan) !== JSON.stringify(input.plan) ||
    protocol.sourceFrame.sourceV2.sha256 !==
      SOURCE_UNIVERSE.sha256
  ) {
    throw new Error(
      "C6 source-v3-simple prior identity structure input mismatch",
    );
  }
  return { planBytes };
}

function deriveNodeIdDedup(
  mappings: readonly z.infer<typeof mappingSchema>[],
): z.infer<typeof nodeIdDedupSchema>[] {
  assertCaseFoldConsistency(mappings);
  const rows = new Map<
    string,
    {
      aliases: Set<string>;
      exactNames: Set<string>;
      resolvedFold: string;
    }
  >();
  for (const mapping of mappings) {
    const resolvedFold = asciiCaseFold(
      mapping.resolvedNameWithOwner,
    );
    const row = rows.get(mapping.repositoryNodeId);
    if (row === undefined) {
      rows.set(mapping.repositoryNodeId, {
        aliases: new Set([
          mapping.requestedNameWithOwner,
        ]),
        exactNames: new Set([
          mapping.resolvedNameWithOwner,
        ]),
        resolvedFold,
      });
      continue;
    }
    row.aliases.add(mapping.requestedNameWithOwner);
    row.exactNames.add(mapping.resolvedNameWithOwner);
  }
  return [...rows.entries()].map(
    ([repositoryNodeId, row]) => ({
      repositoryNodeId,
      requestedAliases: [...row.aliases].sort(compareStrings),
      resolvedNameWithOwnerAsciiFold: row.resolvedFold,
      resolvedNameWithOwnerExactValues:
        [...row.exactNames].sort(compareStrings),
    }),
  ).sort((left, right) =>
    compareStrings(
      left.repositoryNodeId,
      right.repositoryNodeId,
    ) ||
    compareStrings(
      left.resolvedNameWithOwnerAsciiFold,
      right.resolvedNameWithOwnerAsciiFold,
    )
  );
}

function assertCaseFoldConsistency(
  mappings: readonly z.infer<typeof mappingSchema>[],
): void {
  const requested = new Map<
    string,
    { nodeId: string; resolvedFold: string }
  >();
  const resolved = new Map<string, string>();
  const nodeIds = new Map<string, string>();
  for (const mapping of mappings) {
    const requestedFold = asciiCaseFold(
      mapping.requestedNameWithOwner,
    );
    const resolvedFold = asciiCaseFold(
      mapping.resolvedNameWithOwner,
    );
    const priorRequested = requested.get(requestedFold);
    const priorResolved = resolved.get(resolvedFold);
    const priorNode = nodeIds.get(mapping.repositoryNodeId);
    if (
      (
        priorRequested !== undefined &&
        (
          priorRequested.nodeId !== mapping.repositoryNodeId ||
          priorRequested.resolvedFold !== resolvedFold
        )
      ) ||
      (
        priorResolved !== undefined &&
        priorResolved !== mapping.repositoryNodeId
      ) ||
      (
        priorNode !== undefined &&
        priorNode !== resolvedFold
      )
    ) {
      throw new Error(
        "C6 source-v3-simple prior identity structure case-fold conflict",
      );
    }
    requested.set(requestedFold, {
      nodeId: mapping.repositoryNodeId,
      resolvedFold,
    });
    resolved.set(resolvedFold, mapping.repositoryNodeId);
    nodeIds.set(mapping.repositoryNodeId, resolvedFold);
  }
}

function asciiCaseFold(value: string): string {
  return value.replace(/[A-Z]/gu, (character) =>
    character.toLowerCase()
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertExactInput(
  bytes: Uint8Array,
  expected: {
    bytes: number;
    sha256: string;
  },
): void {
  if (
    bytes.byteLength !== expected.bytes ||
    sha256(bytes) !== expected.sha256
  ) {
    throw new Error(
      "C6 source-v3-simple prior identity structure frozen input mismatch",
    );
  }
}

function artifactReference(
  path: string,
  bytes: Uint8Array,
) {
  return {
    bytes: bytes.byteLength,
    path,
    sha256: sha256(bytes),
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
