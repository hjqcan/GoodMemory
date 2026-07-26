import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import {
  basename,
  join,
} from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  loadC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
  verifyC6AssetClosure,
} from "./c6-asset-lock";
import {
  assertC6Wave3PriorRepositoryIdentityCompletionCapability,
} from "./c6-wave3-prior-repository-identity-capture";
import {
  parseC6Wave3SourceUniverseV2,
} from "./c6-wave3-source-universe-v2";
import type {
  LoadedC6AssetLock,
} from "./c6-asset-lock";
import type {
  C6Wave3PriorRepositoryIdentityCompletionCapability,
} from "./c6-wave3-prior-repository-identity-capture";

export const C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_FROZEN = {
  captureBasename:
    "swe-bench-live-multilang-608f7ae9." +
    "wave3-prior-repository-identity-capture-v1.json",
  lookupCount: 356,
  planArtifactKind:
    "c6-wave3-prior-repository-identity-plan",
  planBasename:
    "swe-bench-live-multilang-608f7ae9." +
    "wave3-prior-repository-identity-plan-v1.json",
  planBytes: 76_257,
  planSha256:
    "70b202cd6da6c2c504a0c23168dc9bcb6a73e9697ff98884dcc83ca785cd4ee2",
  repositoryCount: 178,
  repositoryProjectionSha256:
    "360da907fb4dd3c4e3e023c528b90e8f5401e5f52bc13b69fcce034b8b44ab01",
  sourceArtifactKind: "c6-wave3-source-universe",
  sourceBasename:
    "swe-bench-live-multilang-608f7ae9." +
    "wave3-source-universe-v2.json",
  sourceBytes: 631_004,
  sourceSha256:
    "822c458e792ee31f7738cae2526b05dfc3b63fcaac58e3f4f87dcd3803ccdba1",
} as const;

export const C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_QUERY =
  "query C6Wave3PriorRepositoryIdentity(" +
  "$owner: String!, $name: String!) {\n" +
  "  repository(owner: $owner, name: $name, " +
  "followRenames: true) {\n" +
  "    id\n" +
  "    nameWithOwner\n" +
  "    url\n" +
  "  }\n" +
  "  rateLimit {\n" +
  "    cost\n" +
  "    limit\n" +
  "    remaining\n" +
  "    resetAt\n" +
  "    used\n" +
  "  }\n" +
  "}\n";

const {
  captureBasename,
  lookupCount,
  planArtifactKind,
  planBasename,
  planBytes,
  planSha256,
  repositoryCount,
  sourceArtifactKind,
  sourceBasename,
  sourceBytes,
  sourceSha256,
} = C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_FROZEN;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const repositorySchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const targetSchema = z.object({
  passALookupOrder: z.number().int().min(1).max(
    repositoryCount,
  ),
  passBLookupOrder: z.number().int().min(
    repositoryCount + 1,
  ).max(lookupCount),
  repositoryOrder: z.number().int().min(1).max(
    repositoryCount,
  ),
  requestedName: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  requestedNameWithOwner: repositorySchema,
  requestedOwner: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  requestedRepositorySha256: sha256Schema,
}).strict();
const planContextSchema = z.object({
  serialized: z.string().min(1),
  targets: z.array(targetSchema).length(repositoryCount),
}).strict();
const safeRelativePathSchema = z.string().min(1).refine(
  (value) => {
    if (
      value.startsWith("/") ||
      value.includes("\\") ||
      value.includes("\0")
    ) {
      return false;
    }
    return value.split("/").every((component) =>
      component.length > 0 &&
      component !== "." &&
      component !== ".."
    );
  },
  "artifact path must be a safe relative path",
);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().nonnegative().max(
    Number.MAX_SAFE_INTEGER,
  ),
  path: safeRelativePathSchema,
  sha256: sha256Schema,
}).strict();
const planReferenceSchema = artifactReferenceSchema.extend({
  artifactKind: z.literal(planArtifactKind),
  bytes: z.literal(planBytes),
  path: z.literal(planBasename),
  schemaVersion: z.literal(1),
  sha256: z.literal(planSha256),
}).strict();
const sourceUniverseReferenceSchema =
  artifactReferenceSchema.extend({
    artifactKind: z.literal(sourceArtifactKind),
    bytes: z.literal(sourceBytes),
    path: z.literal(sourceBasename),
    schemaVersion: z.literal(2),
    sha256: z.literal(sourceSha256),
  }).strict();
const canonicalUnsignedDecimalSchema = z.string().regex(
  /^(0|[1-9][0-9]*)$/u,
);
const imfFixdateSchema = z.string().regex(
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (0[1-9]|[12][0-9]|3[01]) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9] GMT$/u,
).refine(
  (value) =>
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toUTCString() === value,
  "date must be an RFC7231 IMF-fixdate",
);
const isoSecondSchema = z.string().regex(
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/u,
).refine(
  (value) =>
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() ===
      `${value.slice(0, -1)}.000Z`,
  "resetAt must be a canonical UTC second",
);
const selectedResponseHeadersSchema = z.object({
  date: imfFixdateSchema.nullable(),
  "retry-after": z.string().min(1).nullable(),
  "x-github-request-id": z.string().regex(
    /^[A-Za-z0-9][A-Za-z0-9:-]{0,127}$/u,
  ).nullable(),
  "x-ratelimit-limit":
    canonicalUnsignedDecimalSchema.nullable(),
  "x-ratelimit-remaining":
    canonicalUnsignedDecimalSchema.nullable(),
  "x-ratelimit-reset":
    canonicalUnsignedDecimalSchema.nullable(),
  "x-ratelimit-resource": z.literal("graphql").nullable(),
  "x-ratelimit-used":
    canonicalUnsignedDecimalSchema.nullable(),
}).strict();
const requestProjectionSchema = z.object({
  endpoint: z.literal("https://api.github.com/graphql"),
  headers: z.object({
    accept: z.literal("application/vnd.github+json"),
    authorization: z.literal("Bearer <redacted>"),
    "content-type": z.literal("application/json"),
    "user-agent": z.literal(
      "GoodMemory-C6-Wave3-Prior-Repository-Identity/1",
    ),
    "x-github-api-version": z.literal("2022-11-28"),
  }).strict(),
  lookupOrder: z.number().int().min(1).max(lookupCount),
  method: z.literal("POST"),
  redirect: z.literal("error"),
  timeoutMilliseconds: z.literal(60_000),
  variables: z.object({
    name: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
    owner: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  }).strict(),
}).strict();
const retryDecisionSchema = z.object({
  artifact: artifactReferenceSchema,
  decision: z.enum(["abort", "retry", "stop-success"]),
  delayMilliseconds: z.number().int().min(0).max(
    60_000,
  ).nullable(),
  reason: z.enum([
    "complete-graphql-response",
    "graphql-errors-or-partial-data",
    "missing-required-success-header",
    "missing-required-response-field",
    "retryable-http-429",
    "retryable-http-502",
    "retryable-http-503",
    "retryable-http-504",
    "nonretryable-http-status",
    "retry-after-invalid-or-over-maximum",
    "transient-transport-code",
    "terminal-transport-error",
    "maximum-attempts-exhausted",
  ]),
  retryAfter: z.string().min(1).nullable(),
}).strict();
const transportErrorSchema = z.object({
  artifact: artifactReferenceSchema,
  code: z.string().min(1).nullable(),
  message: z.string(),
  phase: z.enum(["body-read", "fetch", "timeout"]),
  transient: z.boolean(),
}).strict();
const captureAttemptSchema = z.object({
  attempt: z.number().int().min(1).max(4),
  attemptArtifact: artifactReferenceSchema,
  httpResponseExists: z.boolean(),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  lookupOrder: z.number().int().min(1).max(lookupCount),
  outcome: z.enum([
    "complete-graphql-http-200",
    "graphql-http-200-invalid",
    "retryable-http-status",
    "terminal-http-status",
    "transient-transport-failure",
    "terminal-transport-failure",
  ]),
  request: artifactReferenceSchema,
  requestBody: artifactReferenceSchema,
  requestProjection: requestProjectionSchema,
  responseBody: artifactReferenceSchema.nullable(),
  responseBodyReadCompleted: z.boolean(),
  responseHeaders: artifactReferenceSchema,
  retryDecision: retryDecisionSchema,
  selectedResponseHeaders: selectedResponseHeadersSchema,
  transportError: transportErrorSchema.nullable(),
}).strict();
const successResponseSchema = z.object({
  rateLimit: z.object({
    cost: z.number().int().nonnegative().max(
      Number.MAX_SAFE_INTEGER,
    ),
    limit: z.number().int().nonnegative().max(
      Number.MAX_SAFE_INTEGER,
    ),
    remaining: z.number().int().nonnegative().max(
      Number.MAX_SAFE_INTEGER,
    ),
    resetAt: isoSecondSchema,
    used: z.number().int().nonnegative().max(
      Number.MAX_SAFE_INTEGER,
    ),
  }).strict(),
  repository: z.object({
    id: z.string().min(1).refine(
      (value) => !value.includes("\0"),
    ),
    nameWithOwner: repositorySchema,
    url: z.string().url(),
  }).strict(),
}).strict();
const captureLookupSchema = z.object({
  attempts: z.array(captureAttemptSchema).min(1).max(4),
  finalAttempt: z.number().int().min(1).max(4),
  lookupOrder: z.number().int().min(1).max(lookupCount),
  pass: z.enum(["A", "B"]),
  repositoryNodeId: z.string().min(1).refine(
    (value) => !value.includes("\0"),
  ),
  repositoryOrder: z.number().int().min(1).max(
    repositoryCount,
  ),
  requestedName: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  requestedNameWithOwner: repositorySchema,
  requestedOwner: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  requestedRepositorySha256: sha256Schema,
  resolvedNameWithOwner: repositorySchema,
  resolvedUrl: z.string().url(),
  response: successResponseSchema,
  success: z.literal(true),
}).strict();
const assetLockReferenceSchema = artifactReferenceSchema.extend({
  artifactKind: z.literal("c6-asset-lock"),
  assetRootSha256: sha256Schema,
  path: z.literal("asset-lock.json"),
  schemaVersion: z.literal(1),
}).strict();
const captureSchema = z.object({
  artifactKind: z.literal(
    "c6-wave3-prior-repository-identity-capture",
  ),
  boundary: z.object({
    captureCompleted: z.literal(true),
    officialWave3SearchPermitted: z.literal(false),
    priorIdentityQualificationExecuted: z.literal(false),
    status: z.literal("capture-complete-awaiting-qualification"),
  }).strict(),
  counts: z.object({
    logicalLookupCount: z.literal(lookupCount),
    networkAttemptCount: z.number().int().min(lookupCount)
      .max(lookupCount * 4),
    successfulLogicalLookupCount: z.literal(lookupCount),
  }).strict(),
  inputs: z.object({
    captureAssetLock: assetLockReferenceSchema,
    plan: planReferenceSchema,
    sourceUniverse: sourceUniverseReferenceSchema,
  }).strict(),
  lookups: z.array(captureLookupSchema).length(lookupCount),
  schemaVersion: z.literal(1),
}).strict();
const qualificationMappingSchema = z.object({
  passAAttemptReferences: z.array(
    artifactReferenceSchema,
  ).min(1).max(4),
  passBAttemptReferences: z.array(
    artifactReferenceSchema,
  ).min(1).max(4),
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
const qualificationSchema = z.object({
  artifactKind: z.literal(
    "c6-wave3-prior-repository-identity-qualification",
  ),
  boundary: z.object({
    officialWave3SearchPermitted: z.literal(false),
    priorRepositoryNodeIdExclusionComplete: z.literal(true),
    status: z.literal(
      "qualified-prior-node-id-closure-awaiting-external-promotion",
    ),
  }).strict(),
  counts: z.object({
    aliasMappingCount: z.literal(repositoryCount),
    successfulLogicalLookupCount: z.literal(lookupCount),
    uniqueNodeIdCount: z.number().int().min(1).max(
      repositoryCount,
    ),
  }).strict(),
  inputs: z.object({
    capture: artifactReferenceSchema.extend({
      artifactKind: z.literal(
        "c6-wave3-prior-repository-identity-capture",
      ),
      path: z.literal(captureBasename),
      schemaVersion: z.literal(1),
    }).strict(),
    captureAssetLock: assetLockReferenceSchema,
    plan: planReferenceSchema,
    sourceUniverse: sourceUniverseReferenceSchema,
  }).strict(),
  mappings: z.array(qualificationMappingSchema).length(
    repositoryCount,
  ),
  nodeIdDedup: z.array(nodeIdDedupSchema).min(1).max(
    repositoryCount,
  ),
  projections: z.object({
    attemptReferenceProjectionSha256: sha256Schema,
    nodeIdDedupProjectionSha256: sha256Schema,
    requestedToResolvedMappingProjectionSha256: sha256Schema,
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();

export type C6Wave3PriorRepositoryIdentityArtifactPlanContext =
  z.infer<typeof planContextSchema>;
export type C6Wave3PriorRepositoryIdentityCapture = z.infer<
  typeof captureSchema
>;
export type C6Wave3PriorRepositoryIdentityCaptureLookup =
  z.infer<typeof captureLookupSchema>;
export type C6Wave3PriorRepositoryIdentityQualification =
  z.infer<typeof qualificationSchema>;
export type C6Wave3PriorRepositoryIdentityAssetLockReference =
  z.infer<typeof assetLockReferenceSchema>;

export interface C6Wave3PriorRepositoryIdentityArtifactTestHooks {
  beforeTerminalInputReplay?: () => Promise<void> | void;
}

type CaptureAttempt =
  C6Wave3PriorRepositoryIdentityCaptureLookup["attempts"][number];
type ArtifactReference = z.infer<
  typeof artifactReferenceSchema
>;
type CaptureContext = {
  assetRoot: string;
  completionCapability?:
    C6Wave3PriorRepositoryIdentityCompletionCapability;
  plan: C6Wave3PriorRepositoryIdentityArtifactPlanContext;
  planPath: string;
  sourceUniversePath: string;
  testHooks?:
    C6Wave3PriorRepositoryIdentityArtifactTestHooks;
};
type QualificationContext = CaptureContext & {
  capture: C6Wave3PriorRepositoryIdentityCapture;
  capturePath: string;
};

export async function buildC6Wave3PriorRepositoryIdentityCaptureArtifact(
  input: {
    assetRoot: string;
    completionCapability?:
      C6Wave3PriorRepositoryIdentityCompletionCapability;
    lookups: readonly C6Wave3PriorRepositoryIdentityCaptureLookup[];
    plan: C6Wave3PriorRepositoryIdentityArtifactPlanContext;
    planPath: string;
    sourceUniversePath: string;
    testHooks?:
      C6Wave3PriorRepositoryIdentityArtifactTestHooks;
  },
): Promise<C6Wave3PriorRepositoryIdentityCapture> {
  const verified = await verifyDraftCaptureEvidence(input);
  assertC6Wave3PriorRepositoryIdentityCompletionCapability(
    input.completionCapability,
    input.assetRoot,
    {
      assetLockSha256:
        verified.loadedAssetLock.assetLockSha256,
      assetRootSha256:
        verified.loadedAssetLock.assetLock.assetRootSha256,
    },
  );
  const capture = captureSchema.parse({
    artifactKind:
      "c6-wave3-prior-repository-identity-capture",
    boundary: {
      captureCompleted: true,
      officialWave3SearchPermitted: false,
      priorIdentityQualificationExecuted: false,
      status: "capture-complete-awaiting-qualification",
    },
    counts: {
      logicalLookupCount: lookupCount,
      networkAttemptCount: verified.networkAttemptCount,
      successfulLogicalLookupCount: lookupCount,
    },
    inputs: {
      captureAssetLock:
        deriveAssetLockReference(verified.loadedAssetLock),
      plan: derivePlanReference(
        verified.frozenInputs.plan.bytes,
      ),
      sourceUniverse: deriveSourceUniverseReference(
        verified.frozenInputs.sourceUniverse.bytes,
      ),
    },
    lookups: verified.lookups,
    schemaVersion: 1,
  });
  assertCaptureConsistency(capture, input.plan);
  assertCaptureInputReferences(
    capture,
    verified.frozenInputs,
  );
  return capture;
}

export async function verifyC6Wave3PriorRepositoryIdentityDraftEvidenceArtifact(
  input: {
    assetRoot: string;
    lookups: readonly C6Wave3PriorRepositoryIdentityCaptureLookup[];
    plan: C6Wave3PriorRepositoryIdentityArtifactPlanContext;
    planPath: string;
    sourceUniversePath: string;
    testHooks?:
      C6Wave3PriorRepositoryIdentityArtifactTestHooks;
  },
): Promise<void> {
  await verifyDraftCaptureEvidence(input);
}

async function verifyDraftCaptureEvidence(
  input: {
    assetRoot: string;
    lookups: readonly C6Wave3PriorRepositoryIdentityCaptureLookup[];
    plan: C6Wave3PriorRepositoryIdentityArtifactPlanContext;
    planPath: string;
    sourceUniversePath: string;
    testHooks?:
      C6Wave3PriorRepositoryIdentityArtifactTestHooks;
  },
): Promise<{
  frozenInputs: FrozenPlanAndSource;
  loadedAssetLock: LoadedC6AssetLock;
  lookups: C6Wave3PriorRepositoryIdentityCaptureLookup[];
  networkAttemptCount: number;
}> {
  const plan = parsePlanContext(input.plan);
  const frozenInputs = await loadFrozenPlanAndSource(
    input,
    plan,
  );
  const lookups = z.array(captureLookupSchema)
    .length(lookupCount)
    .parse(input.lookups);
  const loadedAssetLock = await loadC6AssetLock(
    input.assetRoot,
  );
  const networkAttemptCount =
    assertLookupCollectionConsistency(lookups, plan);
  await verifyRawEvidence(
    input.assetRoot,
    lookups,
    loadedAssetLock,
  );
  await replayFrozenInputs(input, frozenInputs, loadedAssetLock);
  return {
    frozenInputs,
    loadedAssetLock,
    lookups,
    networkAttemptCount,
  };
}

export async function serializeC6Wave3PriorRepositoryIdentityCaptureArtifact(
  capture: C6Wave3PriorRepositoryIdentityCapture,
  context: CaptureContext,
): Promise<string> {
  const loadedAssetLock =
    await loadAssetLockAndAssertCompletionCapability(context);
  const plan = parsePlanContext(context.plan);
  const frozenInputs = await loadFrozenPlanAndSource(
    context,
    plan,
  );
  const parsed = captureSchema.parse(capture);
  assertCaptureConsistency(parsed, plan);
  assertCaptureInputReferences(parsed, frozenInputs);
  assertCaptureAssetLockReference(
    parsed,
    loadedAssetLock,
  );
  await verifyRawEvidence(
    context.assetRoot,
    parsed.lookups,
    loadedAssetLock,
  );
  await replayFrozenInputs(
    context,
    frozenInputs,
    loadedAssetLock,
  );
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export async function parseC6Wave3PriorRepositoryIdentityCaptureArtifact(
  input: string | Uint8Array,
  context: CaptureContext,
): Promise<C6Wave3PriorRepositoryIdentityCapture> {
  const loadedAssetLock =
    await loadAssetLockAndAssertCompletionCapability(context);
  const plan = parsePlanContext(context.plan);
  const frozenInputs = await loadFrozenPlanAndSource(
    context,
    plan,
  );
  const capture = captureSchema.parse(parseCanonicalJson(
    input,
    "C6 Wave3 prior repository identity capture",
  ));
  assertCaptureConsistency(capture, plan);
  assertCaptureInputReferences(capture, frozenInputs);
  assertCaptureAssetLockReference(
    capture,
    loadedAssetLock,
  );
  await verifyRawEvidence(
    context.assetRoot,
    capture.lookups,
    loadedAssetLock,
  );
  await replayFrozenInputs(
    context,
    frozenInputs,
    loadedAssetLock,
  );
  return capture;
}

export async function buildC6Wave3PriorRepositoryIdentityQualificationArtifact(
  input: QualificationContext,
): Promise<C6Wave3PriorRepositoryIdentityQualification> {
  await loadAssetLockAndAssertCompletionCapability(input);
  return await deriveVerifiedQualification(input);
}

export async function serializeC6Wave3PriorRepositoryIdentityQualificationArtifact(
  qualification: C6Wave3PriorRepositoryIdentityQualification,
  context: QualificationContext,
): Promise<string> {
  await loadAssetLockAndAssertCompletionCapability(context);
  const parsed = qualificationSchema.parse(qualification);
  await assertQualificationConsistency(parsed, context);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export async function parseC6Wave3PriorRepositoryIdentityQualificationArtifact(
  input: string | Uint8Array,
  context: QualificationContext,
): Promise<C6Wave3PriorRepositoryIdentityQualification> {
  await loadAssetLockAndAssertCompletionCapability(context);
  const qualification = qualificationSchema.parse(
    parseCanonicalJson(
      input,
      "C6 Wave3 prior repository identity qualification",
    ),
  );
  await assertQualificationConsistency(qualification, context);
  return qualification;
}

async function loadAssetLockAndAssertCompletionCapability(
  context: Pick<
    CaptureContext,
    "assetRoot" | "completionCapability"
  >,
): Promise<LoadedC6AssetLock> {
  const loadedAssetLock = await loadC6AssetLock(
    context.assetRoot,
  );
  assertC6Wave3PriorRepositoryIdentityCompletionCapability(
    context.completionCapability,
    context.assetRoot,
    {
      assetLockSha256: loadedAssetLock.assetLockSha256,
      assetRootSha256:
        loadedAssetLock.assetLock.assetRootSha256,
    },
  );
  return loadedAssetLock;
}

function parsePlanContext(
  input: C6Wave3PriorRepositoryIdentityArtifactPlanContext,
): C6Wave3PriorRepositoryIdentityArtifactPlanContext {
  const plan = planContextSchema.parse(input);
  const raw = parseCanonicalJson(
    plan.serialized,
    "C6 Wave3 prior repository identity plan context",
  );
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("artifactKind" in raw) ||
    raw.artifactKind !== planArtifactKind ||
    !("schemaVersion" in raw) ||
    raw.schemaVersion !== 1 ||
    !("targets" in raw) ||
    JSON.stringify(raw.targets) !==
      JSON.stringify(plan.targets)
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity plan context mismatch",
    );
  }
  return plan;
}

function parseCanonicalJson(
  input: string | Uint8Array,
  label: string,
): unknown {
  const text = typeof input === "string"
    ? input
    : Buffer.from(input).toString("utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} invalid JSON`);
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(`${label} requires canonical JSON`);
  }
  return raw;
}

interface FrozenFile {
  bytes: Buffer;
  dev: number;
  ino: number;
  mode: number;
  mtimeMs: number;
  path: string;
}

interface FrozenPlanAndSource {
  plan: FrozenFile;
  sourceUniverse: FrozenFile;
}

async function loadFrozenPlanAndSource(
  context: CaptureContext,
  plan: C6Wave3PriorRepositoryIdentityArtifactPlanContext,
): Promise<FrozenPlanAndSource> {
  const [planFile, sourceUniverse] = await Promise.all([
    readFrozenFile(
      context.planPath,
      planBasename,
      "plan input",
    ),
    readFrozenFile(
      context.sourceUniversePath,
      sourceBasename,
      "source universe input",
    ),
  ]);
  if (
    planFile.bytes.toString("utf8") !== plan.serialized ||
    planFile.bytes.byteLength !== planBytes ||
    sha256(planFile.bytes) !== planSha256
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity actual plan input mismatch",
    );
  }
  if (
    sourceUniverse.bytes.byteLength !== sourceBytes ||
    sha256(sourceUniverse.bytes) !== sourceSha256
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity actual source universe mismatch",
    );
  }
  const source = parseC6Wave3SourceUniverseV2(
    sourceUniverse.bytes,
  );
  if (
    JSON.stringify(
      source.exclusions.canonicalRepositories,
    ) !== JSON.stringify(
      plan.targets.map(
        (target) => target.requestedNameWithOwner,
      ),
    )
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity source target mismatch",
    );
  }
  return {
    plan: planFile,
    sourceUniverse,
  };
}

async function readFrozenFile(
  pathInput: string,
  expectedBasename: string,
  label: string,
): Promise<FrozenFile> {
  const path = await assertC6NoSymlinkPathComponents(
    pathInput,
    `C6 Wave3 prior repository identity ${label}`,
  );
  if (basename(path) !== expectedBasename) {
    throw new Error(
      `C6 Wave3 prior repository identity ${label} basename mismatch`,
    );
  }
  const before = await lstat(path);
  const bytes = await readC6StableRegularFile(
    path,
    `Wave3 prior repository identity ${label}`,
  );
  const after = await lstat(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    !after.isFile() ||
    after.isSymbolicLink() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mode !== after.mode ||
    before.mtimeMs !== after.mtimeMs ||
    before.size !== after.size
  ) {
    throw new Error(
      `C6 Wave3 prior repository identity ${label} identity mismatch`,
    );
  }
  return {
    bytes,
    dev: after.dev,
    ino: after.ino,
    mode: after.mode,
    mtimeMs: after.mtimeMs,
    path,
  };
}

async function replayFrozenInputs(
  context: CaptureContext,
  frozen: FrozenPlanAndSource & {
    capture?: FrozenFile;
  },
  loadedAssetLock: LoadedC6AssetLock,
): Promise<void> {
  await context.testHooks?.beforeTerminalInputReplay?.();
  const replays = [
    replayFrozenFile(frozen.plan, planBasename, "plan input"),
    replayFrozenFile(
      frozen.sourceUniverse,
      sourceBasename,
      "source universe input",
    ),
  ];
  if (frozen.capture !== undefined) {
    replays.push(replayFrozenFile(
      frozen.capture,
      captureBasename,
      "capture input",
    ));
  }
  await Promise.all(replays);
  await verifyC6AssetClosure(
    context.assetRoot,
    loadedAssetLock,
  );
}

async function replayFrozenFile(
  expected: FrozenFile,
  expectedBasename: string,
  label: string,
): Promise<void> {
  const current = await readFrozenFile(
    expected.path,
    expectedBasename,
    label,
  );
  if (
    current.dev !== expected.dev ||
    current.ino !== expected.ino ||
    current.mode !== expected.mode ||
    current.mtimeMs !== expected.mtimeMs ||
    !current.bytes.equals(expected.bytes)
  ) {
    throw new Error(
      `C6 Wave3 prior repository identity ${label} changed during terminal replay`,
    );
  }
}

function derivePlanReference(
  bytes: string | Uint8Array,
): z.infer<typeof planReferenceSchema> {
  const byteLength = typeof bytes === "string"
    ? Buffer.byteLength(bytes)
    : bytes.byteLength;
  return planReferenceSchema.parse({
    artifactKind: planArtifactKind,
    bytes: byteLength,
    path: planBasename,
    schemaVersion: 1,
    sha256: sha256(bytes),
  });
}

function deriveSourceUniverseReference(
  bytes?: Uint8Array,
): z.infer<
  typeof sourceUniverseReferenceSchema
> {
  if (
    bytes !== undefined &&
    (
      bytes.byteLength !== sourceBytes ||
      sha256(bytes) !== sourceSha256
    )
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity source reference mismatch",
    );
  }
  return sourceUniverseReferenceSchema.parse({
    artifactKind: sourceArtifactKind,
    bytes: sourceBytes,
    path: sourceBasename,
    schemaVersion: 2,
    sha256: sourceSha256,
  });
}

function deriveAssetLockReference(
  loaded: LoadedC6AssetLock,
): C6Wave3PriorRepositoryIdentityAssetLockReference {
  const serialized = serializeC6AssetLock(loaded.assetLock);
  if (sha256(serialized) !== loaded.assetLockSha256) {
    throw new Error(
      "C6 Wave3 prior repository identity asset lock hash mismatch",
    );
  }
  return assetLockReferenceSchema.parse({
    artifactKind: "c6-asset-lock",
    assetRootSha256: loaded.assetLock.assetRootSha256,
    bytes: Buffer.byteLength(serialized),
    path: "asset-lock.json",
    schemaVersion: 1,
    sha256: loaded.assetLockSha256,
  });
}

function assertCaptureConsistency(
  capture: C6Wave3PriorRepositoryIdentityCapture,
  plan: C6Wave3PriorRepositoryIdentityArtifactPlanContext,
): void {
  if (
    JSON.stringify(capture.inputs.plan) !==
      JSON.stringify(derivePlanReference(plan.serialized)) ||
    JSON.stringify(capture.inputs.sourceUniverse) !==
      JSON.stringify(deriveSourceUniverseReference())
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity capture input mismatch",
    );
  }
  const networkAttemptCount =
    assertLookupCollectionConsistency(capture.lookups, plan);
  if (
    capture.counts.networkAttemptCount !==
      networkAttemptCount
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity capture attempt count mismatch",
    );
  }
}

function assertLookupCollectionConsistency(
  lookups: readonly C6Wave3PriorRepositoryIdentityCaptureLookup[],
  plan: C6Wave3PriorRepositoryIdentityArtifactPlanContext,
): number {
  let networkAttemptCount = 0;
  for (
    let lookupIndex = 0;
    lookupIndex < lookupCount;
    lookupIndex += 1
  ) {
    const lookup = lookups[lookupIndex]!;
    const lookupOrder = lookupIndex + 1;
    const pass = lookupOrder <= repositoryCount ? "A" : "B";
    const target = plan.targets[
      pass === "A"
        ? lookupIndex
        : lookupIndex - repositoryCount
    ]!;
    assertLookupConsistency(lookup, target, lookupOrder, pass);
    networkAttemptCount += lookup.attempts.length;
  }
  for (const target of plan.targets) {
    const passA =
      lookups[target.passALookupOrder - 1]!;
    const passB =
      lookups[target.passBLookupOrder - 1]!;
    if (
      passA.requestedNameWithOwner !==
        passB.requestedNameWithOwner ||
      passA.repositoryNodeId !== passB.repositoryNodeId ||
      passA.resolvedNameWithOwner !==
        passB.resolvedNameWithOwner ||
      passA.resolvedUrl !== passB.resolvedUrl
    ) {
      throw new Error(
        "C6 Wave3 prior repository identity capture cross-pass mismatch",
      );
    }
  }
  return networkAttemptCount;
}

function assertCaptureInputReferences(
  capture: C6Wave3PriorRepositoryIdentityCapture,
  frozen: FrozenPlanAndSource,
): void {
  if (
    JSON.stringify(capture.inputs.plan) !==
      JSON.stringify(derivePlanReference(frozen.plan.bytes)) ||
    JSON.stringify(capture.inputs.sourceUniverse) !==
      JSON.stringify(
        deriveSourceUniverseReference(
          frozen.sourceUniverse.bytes,
        ),
      )
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity actual input reference mismatch",
    );
  }
}

function assertCaptureAssetLockReference(
  capture: C6Wave3PriorRepositoryIdentityCapture,
  loaded: LoadedC6AssetLock,
): void {
  if (
    JSON.stringify(capture.inputs.captureAssetLock) !==
      JSON.stringify(deriveAssetLockReference(loaded))
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity capture asset lock reference mismatch",
    );
  }
}

async function verifyRawEvidence(
  assetRoot: string,
  lookups: readonly C6Wave3PriorRepositoryIdentityCaptureLookup[],
  loaded: LoadedC6AssetLock,
): Promise<void> {
  const lockEntries = new Map(
    loaded.assetLock.files.map((file) => [file.path, file]),
  );
  const seenPaths = new Set<string>();
  for (const lookup of lookups) {
    for (const attempt of lookup.attempts) {
      const evidence = await readAttemptEvidence({
        assetRoot,
        attempt,
        lockEntries,
        seenPaths,
      });
      assertAttemptEvidenceProjection(
        lookup,
        attempt,
        evidence,
      );
    }
  }
  if (
    seenPaths.size !== lockEntries.size ||
    [...lockEntries.keys()].some(
      (path) => !seenPaths.has(path),
    )
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity asset lock has missing or extra evidence",
    );
  }
}

interface AttemptEvidence {
  attempt: Buffer;
  request: Buffer;
  requestBody: Buffer;
  responseBody: Buffer | null;
  responseHeaders: Buffer;
  retryDecision: Buffer;
  transportError: Buffer | null;
}

async function readAttemptEvidence(input: {
  assetRoot: string;
  attempt: CaptureAttempt;
  lockEntries: ReadonlyMap<
    string,
    LoadedC6AssetLock["assetLock"]["files"][number]
  >;
  seenPaths: Set<string>;
}): Promise<AttemptEvidence> {
  return {
    attempt: await readEvidenceReference(
      input,
      input.attempt.attemptArtifact,
    ),
    request: await readEvidenceReference(
      input,
      input.attempt.request,
    ),
    requestBody: await readEvidenceReference(
      input,
      input.attempt.requestBody,
    ),
    responseBody: input.attempt.responseBody === null
      ? null
      : await readEvidenceReference(
        input,
        input.attempt.responseBody,
      ),
    responseHeaders: await readEvidenceReference(
      input,
      input.attempt.responseHeaders,
    ),
    retryDecision: await readEvidenceReference(
      input,
      input.attempt.retryDecision.artifact,
    ),
    transportError: input.attempt.transportError === null
      ? null
      : await readEvidenceReference(
        input,
        input.attempt.transportError.artifact,
      ),
  };
}

async function readEvidenceReference(
  input: {
    assetRoot: string;
    lockEntries: ReadonlyMap<
      string,
      LoadedC6AssetLock["assetLock"]["files"][number]
    >;
    seenPaths: Set<string>;
  },
  reference: ArtifactReference,
): Promise<Buffer> {
  if (input.seenPaths.has(reference.path)) {
    throw new Error(
      "C6 Wave3 prior repository identity duplicate evidence path",
    );
  }
  input.seenPaths.add(reference.path);
  const entry = input.lockEntries.get(reference.path);
  if (
    entry === undefined ||
    entry.bytes !== reference.bytes ||
    entry.sha256 !== reference.sha256
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity evidence reference does not match asset lock",
    );
  }
  const bytes = await readC6StableRegularFile(
    join(input.assetRoot, reference.path),
    "Wave3 prior repository identity raw evidence",
  );
  if (
    bytes.byteLength !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity evidence bytes mismatch",
    );
  }
  return bytes;
}

function assertAttemptEvidenceProjection(
  lookup: C6Wave3PriorRepositoryIdentityCaptureLookup,
  attempt: CaptureAttempt,
  evidence: AttemptEvidence,
): void {
  const {
    attemptArtifact: _attemptArtifact,
    ...attemptReceipt
  } = attempt;
  assertCanonicalReceipt(
    evidence.attempt,
    attemptReceipt,
    "attempt",
  );
  assertCanonicalReceipt(
    evidence.request,
    {
      attempt: attempt.attempt,
      body: attempt.requestBody,
      ...attempt.requestProjection,
    },
    "request",
  );
  if (
    evidence.requestBody.toString("utf8") !==
      JSON.stringify({
        query: C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_QUERY,
        variables: attempt.requestProjection.variables,
      })
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity request body projection mismatch",
    );
  }
  assertCanonicalReceipt(
    evidence.responseHeaders,
    attempt.selectedResponseHeaders,
    "response headers",
  );
  const {
    artifact: _retryArtifact,
    ...retryDecisionReceipt
  } = attempt.retryDecision;
  assertCanonicalReceipt(
    evidence.retryDecision,
    retryDecisionReceipt,
    "retry decision",
  );
  if (attempt.transportError === null) {
    if (evidence.transportError !== null) {
      throw new Error(
        "C6 Wave3 prior repository identity transport evidence mismatch",
      );
    }
  } else {
    const {
      artifact: _transportArtifact,
      ...transportErrorReceipt
    } = attempt.transportError;
    if (evidence.transportError === null) {
      throw new Error(
        "C6 Wave3 prior repository identity transport evidence missing",
      );
    }
    assertCanonicalReceipt(
      evidence.transportError,
      transportErrorReceipt,
      "transport error",
    );
  }
  if (
    attempt.outcome === "complete-graphql-http-200"
  ) {
    if (evidence.responseBody === null) {
      throw new Error(
        "C6 Wave3 prior repository identity success response body missing",
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(evidence.responseBody.toString("utf8"));
    } catch {
      throw new Error(
        "C6 Wave3 prior repository identity success response body invalid JSON",
      );
    }
    const body = z.object({
      data: successResponseSchema,
    }).strict().parse(raw);
    if (
      JSON.stringify(body.data) !==
        JSON.stringify(lookup.response)
    ) {
      throw new Error(
        "C6 Wave3 prior repository identity response body projection mismatch",
      );
    }
  }
}

function assertCanonicalReceipt(
  bytes: Uint8Array,
  expected: unknown,
  label: string,
): void {
  if (
    Buffer.from(bytes).toString("utf8") !==
      `${JSON.stringify(expected, null, 2)}\n`
  ) {
    throw new Error(
      `C6 Wave3 prior repository identity ${label} projection mismatch`,
    );
  }
}

function assertLookupConsistency(
  lookup: C6Wave3PriorRepositoryIdentityCaptureLookup,
  target:
    C6Wave3PriorRepositoryIdentityArtifactPlanContext["targets"][number],
  lookupOrder: number,
  pass: "A" | "B",
): void {
  if (
    lookup.lookupOrder !== lookupOrder ||
    lookup.pass !== pass ||
    lookup.repositoryOrder !== target.repositoryOrder ||
    lookup.requestedName !== target.requestedName ||
    lookup.requestedNameWithOwner !==
      target.requestedNameWithOwner ||
    lookup.requestedOwner !== target.requestedOwner ||
    lookup.requestedRepositorySha256 !==
      target.requestedRepositorySha256
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity capture lookup order or target mismatch",
    );
  }
  if (lookup.finalAttempt !== lookup.attempts.length) {
    throw new Error(
      "C6 Wave3 prior repository identity capture final attempt mismatch",
    );
  }
  if (
    lookup.response.repository.id !==
      lookup.repositoryNodeId ||
    lookup.response.repository.nameWithOwner !==
      lookup.resolvedNameWithOwner ||
    lookup.response.repository.url !== lookup.resolvedUrl ||
    lookup.resolvedUrl !==
      `https://github.com/${lookup.resolvedNameWithOwner}`
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity capture final response mismatch",
    );
  }
  for (
    let attemptIndex = 0;
    attemptIndex < lookup.attempts.length;
    attemptIndex += 1
  ) {
    const attempt = lookup.attempts[attemptIndex]!;
    const attemptNumber = attemptIndex + 1;
    if (attempt.attempt !== attemptNumber) {
      throw new Error(
        "C6 Wave3 prior repository identity capture attempts must be contiguous",
      );
    }
    assertAttemptConsistency(
      attempt,
      target,
      lookup.response,
      lookupOrder,
      attemptNumber,
      attemptIndex === lookup.attempts.length - 1,
    );
  }
}

function assertAttemptConsistency(
  attempt: CaptureAttempt,
  target:
    C6Wave3PriorRepositoryIdentityArtifactPlanContext["targets"][number],
  response: z.infer<typeof successResponseSchema>,
  lookupOrder: number,
  attemptNumber: number,
  final: boolean,
): void {
  const root = `lookup-${lookupOrder.toString().padStart(4, "0")}/` +
    `attempt-${attemptNumber.toString().padStart(2, "0")}`;
  if (
    attempt.lookupOrder !== lookupOrder ||
    attempt.attempt !== attemptNumber
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity capture attempt order mismatch",
    );
  }
  assertReferencePath(
    attempt.attemptArtifact,
    `${root}/attempt.json`,
  );
  assertReferencePath(attempt.request, `${root}/request.json`);
  assertReferencePath(
    attempt.requestBody,
    `${root}/request-body.raw`,
  );
  assertReferencePath(
    attempt.responseHeaders,
    `${root}/response-headers.json`,
  );
  assertReferencePath(
    attempt.retryDecision.artifact,
    `${root}/retry-decision.json`,
  );
  if (attempt.responseBody !== null) {
    assertReferencePath(
      attempt.responseBody,
      `${root}/response-body.raw`,
    );
  }
  if (attempt.transportError !== null) {
    assertReferencePath(
      attempt.transportError.artifact,
      `${root}/transport-error.json`,
    );
  }

  const requestBody = JSON.stringify({
    query: C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_QUERY,
    variables: {
      name: target.requestedName,
      owner: target.requestedOwner,
    },
  });
  if (
    attempt.requestBody.bytes !==
      Buffer.byteLength(requestBody) ||
    attempt.requestBody.sha256 !== sha256(requestBody) ||
    JSON.stringify(attempt.requestProjection) !==
      JSON.stringify({
        endpoint: "https://api.github.com/graphql",
        headers: {
          accept: "application/vnd.github+json",
          authorization: "Bearer <redacted>",
          "content-type": "application/json",
          "user-agent":
            "GoodMemory-C6-Wave3-Prior-Repository-Identity/1",
          "x-github-api-version": "2022-11-28",
        },
        lookupOrder,
        method: "POST",
        redirect: "error",
        timeoutMilliseconds: 60_000,
        variables: {
          name: target.requestedName,
          owner: target.requestedOwner,
        },
      })
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity capture request mismatch",
    );
  }

  const hasTransportError =
    attempt.outcome === "transient-transport-failure" ||
    attempt.outcome === "terminal-transport-failure";
  if (
    (attempt.httpStatus !== null) !==
      attempt.httpResponseExists ||
    (attempt.responseBody !== null) !==
      attempt.responseBodyReadCompleted ||
    (
      attempt.responseBodyReadCompleted &&
      !attempt.httpResponseExists
    ) ||
    (attempt.transportError !== null) !== hasTransportError
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity capture response body or transport relation mismatch",
    );
  }
  if (
    !attempt.httpResponseExists &&
    Object.values(attempt.selectedResponseHeaders).some(
      (value) => value !== null,
    )
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity capture response headers mismatch",
    );
  }
  if (attempt.transportError !== null) {
    if (
      attempt.transportError.phase === "body-read"
        ? (
          !attempt.httpResponseExists ||
          attempt.responseBodyReadCompleted
        )
        : (
          attempt.httpResponseExists ||
          attempt.responseBodyReadCompleted
        )
    ) {
      throw new Error(
        "C6 Wave3 prior repository identity capture body-read transport mismatch",
      );
    }
  }
  if (final) {
    assertSuccessfulFinalAttempt(attempt, response);
    return;
  }
  assertRetryAttempt(attempt, attemptNumber);
}

function assertSuccessfulFinalAttempt(
  attempt: CaptureAttempt,
  response: z.infer<typeof successResponseSchema>,
): void {
  const headers = attempt.selectedResponseHeaders;
  if (
    attempt.outcome !== "complete-graphql-http-200" ||
    !attempt.httpResponseExists ||
    attempt.httpStatus !== 200 ||
    !attempt.responseBodyReadCompleted ||
    attempt.responseBody === null ||
    attempt.transportError !== null ||
    attempt.retryDecision.decision !== "stop-success" ||
    attempt.retryDecision.delayMilliseconds !== null ||
    attempt.retryDecision.reason !==
      "complete-graphql-response" ||
    attempt.retryDecision.retryAfter !== null ||
    headers["retry-after"] !== null ||
    headers.date === null ||
    headers["x-github-request-id"] === null ||
    headers["x-ratelimit-limit"] === null ||
    headers["x-ratelimit-remaining"] === null ||
    headers["x-ratelimit-reset"] === null ||
    headers["x-ratelimit-resource"] === null ||
    headers["x-ratelimit-used"] === null
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity capture final outcome mismatch",
    );
  }
  const limit = parseCanonicalUnsignedDecimal(
    headers["x-ratelimit-limit"],
  );
  const remaining = parseCanonicalUnsignedDecimal(
    headers["x-ratelimit-remaining"],
  );
  const reset = parseCanonicalUnsignedDecimal(
    headers["x-ratelimit-reset"],
  );
  const used = parseCanonicalUnsignedDecimal(
    headers["x-ratelimit-used"],
  );
  const resetAtMilliseconds = Date.parse(
    response.rateLimit.resetAt,
  );
  if (
    !Number.isFinite(resetAtMilliseconds) ||
    resetAtMilliseconds % 1_000 !== 0
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity resetAt epoch mismatch",
    );
  }
  const resetAtEpochSeconds = BigInt(
    resetAtMilliseconds / 1_000,
  );
  if (
    headers["x-ratelimit-resource"] !== "graphql" ||
    limit !== BigInt(response.rateLimit.limit) ||
    remaining !== BigInt(response.rateLimit.remaining) ||
    used !== BigInt(response.rateLimit.used) ||
    reset !== resetAtEpochSeconds ||
    remaining > limit ||
    used > limit
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity success rate-limit header mismatch",
    );
  }
}

function parseCanonicalUnsignedDecimal(
  value: string | null,
): bigint {
  if (
    value === null ||
    !/^(0|[1-9][0-9]*)$/u.test(value)
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity success header decimal mismatch",
    );
  }
  return BigInt(value);
}

function assertRetryAttempt(
  attempt: CaptureAttempt,
  attemptNumber: number,
): void {
  if (
    attempt.retryDecision.decision !== "retry" ||
    attempt.retryDecision.retryAfter !==
      attempt.selectedResponseHeaders["retry-after"] ||
    attempt.retryDecision.delayMilliseconds !==
      deriveRetryDelay(
        attempt.retryDecision.retryAfter,
        attemptNumber,
      )
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity capture retry delay mismatch",
    );
  }
  if (attempt.outcome === "retryable-http-status") {
    if (
      !attempt.httpResponseExists ||
      !attempt.responseBodyReadCompleted ||
      attempt.transportError !== null ||
      attempt.httpStatus === null ||
      ![429, 502, 503, 504].includes(attempt.httpStatus) ||
      attempt.retryDecision.reason !==
        `retryable-http-${attempt.httpStatus}`
    ) {
      throw new Error(
        "C6 Wave3 prior repository identity capture retryable HTTP outcome mismatch",
      );
    }
    return;
  }
  if (
    attempt.outcome !== "transient-transport-failure" ||
    attempt.transportError === null ||
    !attempt.transportError.transient ||
    attempt.transportError.code === null ||
    ![
      "EAI_AGAIN",
      "ECONNREFUSED",
      "ECONNRESET",
      "EHOSTUNREACH",
      "ENETDOWN",
      "ENETRESET",
      "ENETUNREACH",
      "ENOTFOUND",
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(attempt.transportError.code) ||
    attempt.retryDecision.reason !==
      "transient-transport-code"
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity capture retry outcome mismatch",
    );
  }
}

function deriveRetryDelay(
  retryAfter: string | null,
  attemptNumber: number,
): number {
  if (retryAfter === null) {
    return 1_000 * (2 ** (attemptNumber - 1));
  }
  if (!/^(0|[1-9][0-9]*)$/u.test(retryAfter)) {
    throw new Error(
      "C6 Wave3 prior repository identity capture retry-after is invalid",
    );
  }
  const seconds = Number(retryAfter);
  if (seconds > 60) {
    throw new Error(
      "C6 Wave3 prior repository identity capture retry-after exceeds maximum",
    );
  }
  return seconds * 1_000;
}

function assertReferencePath(
  reference: ArtifactReference,
  expectedPath: string,
): void {
  if (reference.path !== expectedPath) {
    throw new Error(
      "C6 Wave3 prior repository identity artifact reference path mismatch",
    );
  }
}

async function deriveVerifiedQualification(
  context: QualificationContext,
): Promise<C6Wave3PriorRepositoryIdentityQualification> {
  const plan = parsePlanContext(context.plan);
  const frozenInputs = await loadFrozenPlanAndSource(
    context,
    plan,
  );
  const capture = captureSchema.parse(context.capture);
  assertCaptureConsistency(capture, plan);
  assertCaptureInputReferences(capture, frozenInputs);
  const captureFile = await readFrozenFile(
    context.capturePath,
    captureBasename,
    "capture input",
  );
  const captureFromFile = captureSchema.parse(
    parseCanonicalJson(
      captureFile.bytes,
      "C6 Wave3 prior repository identity capture input",
    ),
  );
  assertCaptureConsistency(captureFromFile, plan);
  assertCaptureInputReferences(captureFromFile, frozenInputs);
  if (
    JSON.stringify(captureFromFile) !==
      JSON.stringify(capture)
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity actual capture input mismatch",
    );
  }
  const loadedAssetLock = await loadC6AssetLock(
    context.assetRoot,
  );
  assertCaptureAssetLockReference(
    capture,
    loadedAssetLock,
  );
  await verifyRawEvidence(
    context.assetRoot,
    capture.lookups,
    loadedAssetLock,
  );
  const qualification = deriveQualification(
    plan,
    capture,
    deriveAssetLockReference(loadedAssetLock),
    frozenInputs,
    captureFile.bytes,
  );
  await replayFrozenInputs(
    context,
    {
      ...frozenInputs,
      capture: captureFile,
    },
    loadedAssetLock,
  );
  return qualification;
}

function deriveQualification(
  plan: C6Wave3PriorRepositoryIdentityArtifactPlanContext,
  capture: C6Wave3PriorRepositoryIdentityCapture,
  captureAssetLock:
    C6Wave3PriorRepositoryIdentityAssetLockReference,
  frozenInputs: FrozenPlanAndSource,
  captureBytes: Uint8Array,
): C6Wave3PriorRepositoryIdentityQualification {
  const mappings = plan.targets.map((target) => {
    const passA =
      capture.lookups[target.passALookupOrder - 1]!;
    const passB =
      capture.lookups[target.passBLookupOrder - 1]!;
    return {
      passAAttemptReferences: passA.attempts.map(
        (attempt) => attempt.attemptArtifact,
      ),
      passBAttemptReferences: passB.attempts.map(
        (attempt) => attempt.attemptArtifact,
      ),
      repositoryNodeId: passA.repositoryNodeId,
      requestedNameWithOwner: target.requestedNameWithOwner,
      resolvedNameWithOwner: passA.resolvedNameWithOwner,
    };
  }).sort((left, right) =>
    compareStrings(
      left.requestedNameWithOwner,
      right.requestedNameWithOwner,
    )
  );
  assertCaseFoldIdentityConsistency(mappings);

  const rowsByNodeId = new Map<
    string,
    {
      requestedAliases: Set<string>;
      resolvedExactValues: Set<string>;
      resolvedFold: string;
    }
  >();
  for (const mapping of mappings) {
    const resolvedFold = asciiCaseFold(
      mapping.resolvedNameWithOwner,
    );
    const row = rowsByNodeId.get(mapping.repositoryNodeId);
    if (row === undefined) {
      rowsByNodeId.set(mapping.repositoryNodeId, {
        requestedAliases: new Set([
          mapping.requestedNameWithOwner,
        ]),
        resolvedExactValues: new Set([
          mapping.resolvedNameWithOwner,
        ]),
        resolvedFold,
      });
      continue;
    }
    row.requestedAliases.add(mapping.requestedNameWithOwner);
    row.resolvedExactValues.add(mapping.resolvedNameWithOwner);
  }
  const nodeIdDedup = [...rowsByNodeId.entries()].map(
    ([repositoryNodeId, row]) => ({
      repositoryNodeId,
      requestedAliases: sortedUnique([
        ...row.requestedAliases,
      ]),
      resolvedNameWithOwnerAsciiFold: row.resolvedFold,
      resolvedNameWithOwnerExactValues: sortedUnique([
        ...row.resolvedExactValues,
      ]),
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
  const attemptReferenceProjection = mappings.map(
    (mapping) => ({
      requestedNameWithOwner:
        mapping.requestedNameWithOwner,
      passAAttemptReferences:
        mapping.passAAttemptReferences,
      passBAttemptReferences:
        mapping.passBAttemptReferences,
    }),
  );
  return qualificationSchema.parse({
    artifactKind:
      "c6-wave3-prior-repository-identity-qualification",
    boundary: {
      officialWave3SearchPermitted: false,
      priorRepositoryNodeIdExclusionComplete: true,
      status:
        "qualified-prior-node-id-closure-awaiting-external-promotion",
    },
    counts: {
      aliasMappingCount: repositoryCount,
      successfulLogicalLookupCount: lookupCount,
      uniqueNodeIdCount: nodeIdDedup.length,
    },
    inputs: {
      capture: {
        artifactKind:
          "c6-wave3-prior-repository-identity-capture",
        bytes: captureBytes.byteLength,
        path: captureBasename,
        schemaVersion: 1,
        sha256: sha256(captureBytes),
      },
      captureAssetLock,
      plan: derivePlanReference(frozenInputs.plan.bytes),
      sourceUniverse: deriveSourceUniverseReference(
        frozenInputs.sourceUniverse.bytes,
      ),
    },
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

async function assertQualificationConsistency(
  qualification: C6Wave3PriorRepositoryIdentityQualification,
  context: QualificationContext,
): Promise<void> {
  const expected = await deriveVerifiedQualification(context);
  if (
    JSON.stringify(qualification) !== JSON.stringify(expected)
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity qualification projection or input mismatch",
    );
  }
}

function assertCaseFoldIdentityConsistency(
  mappings: readonly z.infer<
    typeof qualificationMappingSchema
  >[],
): void {
  const requestedFoldToNodeIds =
    new Map<string, Set<string>>();
  const resolvedFoldToNodeIds =
    new Map<string, Set<string>>();
  const nodeIdToResolvedFolds =
    new Map<string, Set<string>>();
  for (const mapping of mappings) {
    addSetValue(
      requestedFoldToNodeIds,
      asciiCaseFold(mapping.requestedNameWithOwner),
      mapping.repositoryNodeId,
    );
    const resolvedFold = asciiCaseFold(
      mapping.resolvedNameWithOwner,
    );
    addSetValue(
      resolvedFoldToNodeIds,
      resolvedFold,
      mapping.repositoryNodeId,
    );
    addSetValue(
      nodeIdToResolvedFolds,
      mapping.repositoryNodeId,
      resolvedFold,
    );
  }
  if (
    [...requestedFoldToNodeIds.values()].some(
      (nodeIds) => nodeIds.size !== 1,
    ) ||
    [...resolvedFoldToNodeIds.values()].some(
      (nodeIds) => nodeIds.size !== 1,
    ) ||
    [...nodeIdToResolvedFolds.values()].some(
      (folds) => folds.size !== 1,
    )
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity qualification case-fold identity conflict",
    );
  }
}

function addSetValue(
  map: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  const values = map.get(key);
  if (values === undefined) {
    map.set(key, new Set([value]));
    return;
  }
  values.add(value);
}

function asciiCaseFold(value: string): string {
  return value.replace(
    /[A-Z]/gu,
    (character) => character.toLowerCase(),
  );
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
