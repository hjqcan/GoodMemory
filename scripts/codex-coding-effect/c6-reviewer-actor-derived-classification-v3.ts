import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  open,
  readdir,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
} from "node:path";

import { z } from "zod";

import type { C6AssetLock } from "./c6-asset-lock";
import {
  assertC6NoSymlinkPathComponents,
  buildC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
} from "./c6-asset-lock";
import type {
  C6LiveMultiLangNeighborActorPlanV2,
} from "./c6-live-multilang-neighbor-actor-plan-v2";
import {
  parseC6LiveMultiLangNeighborActorPlanV2,
} from "./c6-live-multilang-neighbor-actor-plan-v2";
import {
  classifyC6ReviewerActorV2,
  C6_REVIEWER_ACTOR_POLICY_V2,
  serializeC6ReviewerActorPolicyV2,
} from "./c6-reviewer-actor-policy-v2";
import {
  classifyC6ReviewerActorV3,
  C6_REVIEWER_ACTOR_POLICY_V3,
  serializeC6ReviewerActorPolicyV3,
} from "./c6-reviewer-actor-policy-v3";

const ARTIFACT_KIND =
  "c6-reviewer-actor-derived-classification";
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const FROZEN_SOURCE = {
  actorCount: 507,
  actorPlanBytes: 86_991,
  actorPlanPath:
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-reviewer-actor-plan-v2.json",
  actorPlanSha256:
    "9603ab1f3ccf52efb632ca090a0a87b4235dad178f85d1f9b7ecb976b9d0dc17",
  actorRootAssetSha256:
    "4ff26b0d9dd69900f750c8699d30ff588ec9a82eaff73ea4954e8c3db23f5842",
  actorRootCaptureBytes: 159_104,
  actorRootCaptureSha256:
    "a3695941b1d7d12fdaf6d08df46023176ff10e1f12b4f833d3e1ee391a95b2c5",
  actorRootFileCount: 2_029,
  actorRootTotalBytes: 1_883_615,
  resolvedActorCount: 500,
  targetProjectionSha256:
    "68ac8d1823039f7375dc6903676ed146b3704511c4bb79bd077a15d38bc5b53c",
  unresolvedActorCount: 7,
  v2EligibleActorCount: 487,
  v2IneligibleActorCount: 20,
  v2PolicySha256:
    "c243571bc95c44494dca68606ba772c26a7b640d1c2bbe60fc1818603efc0e44",
  v3EligibleActorCount: 486,
  v3IneligibleActorCount: 21,
  v3PolicySha256:
    "a8769b437d8515c9f489639aa90fa4fb3230647cc4508bafaf29d1e970bc2899",
} as const;
const V2_POLICY_BYTES = Buffer.byteLength(
  serializeC6ReviewerActorPolicyV2(),
);
const V3_POLICY_BYTES = Buffer.byteLength(
  serializeC6ReviewerActorPolicyV3(),
);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const loginSchema = z.string().min(1).refine(
  (value) =>
    value.trim() === value &&
    value === value.toLowerCase() &&
    !/[/\s]/u.test(value),
  "actor login must be normalized",
);
const sanitizedRowSchema = z.object({
  captureOrder: z.number().int().positive(),
  login: loginSchema,
  status: z.union([z.literal(200), z.literal(404)]),
  currentPlatformType: z.string().min(1).nullable(),
}).strict();
const v2ReasonSchema = z.enum([
  "automation-style-login-excluded",
  "current-platform-user-no-known-automation-signal",
  "known-automation-login",
  "platform-actor-not-user",
  "platform-actor-unresolved",
]);
const v3ReasonSchema = z.enum([
  "automation-agent-suffix-excluded",
  "automation-style-login-excluded",
  "current-platform-user-no-known-automation-signal",
  "known-automation-login",
  "platform-actor-not-user",
  "platform-actor-unresolved",
]);
const decisionSchema = z.object({
  captureOrder: z.number().int().positive(),
  login: loginSchema,
  v2: z.object({
    eligible: z.boolean(),
    reason: v2ReasonSchema,
  }).strict(),
  v3: z.object({
    eligible: z.boolean(),
    reason: v3ReasonSchema,
  }).strict(),
}).strict();
const decisionDiffSchema = z.object({
  v2ToV3: z.tuple([
    z.object({
      captureOrder: z.literal(235),
      login: z.literal("joestump-agent"),
      v2: z.object({
        eligible: z.literal(true),
        reason: z.literal(
          "current-platform-user-no-known-automation-signal",
        ),
      }).strict(),
      v3: z.object({
        eligible: z.literal(false),
        reason: z.literal(
          "automation-agent-suffix-excluded",
        ),
      }).strict(),
    }).strict(),
  ]),
}).strict();
const artifactReferenceSchema = z.object({
  bytes: z.number().int().positive(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const policyReferenceSchema = z.object({
  bytes: z.number().int().positive(),
  policyId: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  sha256: sha256Schema,
}).strict();
const derivedClassificationSchema = z.object({
  artifactKind: z.literal(ARTIFACT_KIND),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    actorFilteredSelectionExecuted: z.literal(false),
    automationExclusionComplete: z.literal(false),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    commitAncestryProven: z.literal(false),
    eventTimeActorTypeProven: z.literal(false),
    humanReviewerIdentityProven: z.literal(false),
    independentReviewCompleted: z.literal(false),
    independentReviewReceiptRequired: z.literal(true),
    selectionExecuted: z.literal(false),
    status: z.literal(
      "policy-v3-independent-review-and-commit-freeze-required",
    ),
  }).strict(),
  chronology: z.object({
    adaptiveAfterCompleteActorCapture: z.literal(true),
    policyV3PreregisteredBeforeActorCapture: z.literal(false),
    selectionExecuted: z.literal(false),
  }).strict(),
  counts: z.object({
    actorCount: z.literal(FROZEN_SOURCE.actorCount),
    newlyExcludedActorCount: z.literal(1),
    resolvedActorCount: z.literal(
      FROZEN_SOURCE.resolvedActorCount,
    ),
    unresolvedActorCount: z.literal(
      FROZEN_SOURCE.unresolvedActorCount,
    ),
    v2EligibleActorCount: z.literal(
      FROZEN_SOURCE.v2EligibleActorCount,
    ),
    v2IneligibleActorCount: z.literal(
      FROZEN_SOURCE.v2IneligibleActorCount,
    ),
    v3EligibleActorCount: z.literal(
      FROZEN_SOURCE.v3EligibleActorCount,
    ),
    v3IneligibleActorCount: z.literal(
      FROZEN_SOURCE.v3IneligibleActorCount,
    ),
  }).strict(),
  decisionDiff: decisionDiffSchema,
  decisions: z.array(decisionSchema).length(
    FROZEN_SOURCE.actorCount,
  ),
  independenceBoundary: z.object({
    fullStructuralRowsInput: z.literal(false),
    goldInput: z.literal(false),
    reviewBodyInput: z.literal(false),
    reviewOutcomeInput: z.literal(false),
    selectedSequenceInput: z.literal(false),
    structuralReviewerLoginProjectionInput: z.literal(true),
    structuralSelectionOutcomeInput: z.literal(false),
  }).strict(),
  inputs: z.object({
    actorPlan: z.object({
      bytes: z.literal(FROZEN_SOURCE.actorPlanBytes),
      path: z.literal(FROZEN_SOURCE.actorPlanPath),
      sha256: z.literal(FROZEN_SOURCE.actorPlanSha256),
      targetProjectionSha256: z.literal(
        FROZEN_SOURCE.targetProjectionSha256,
      ),
    }).strict(),
    actorRoot: z.object({
      assetRootSha256: z.literal(
        FROZEN_SOURCE.actorRootAssetSha256,
      ),
      captureManifestBytes: z.literal(
        FROZEN_SOURCE.actorRootCaptureBytes,
      ),
      captureManifestSha256: z.literal(
        FROZEN_SOURCE.actorRootCaptureSha256,
      ),
      fileCount: z.literal(FROZEN_SOURCE.actorRootFileCount),
      totalBytes: z.literal(FROZEN_SOURCE.actorRootTotalBytes),
    }).strict(),
  }).strict(),
  policy: z.object({
    v2: policyReferenceSchema.extend({
      bytes: z.literal(V2_POLICY_BYTES),
      policyId: z.literal(
        "reviewer-platform-actor-eligibility-v2",
      ),
      schemaVersion: z.literal(2),
      sha256: z.literal(FROZEN_SOURCE.v2PolicySha256),
    }).strict(),
    v3: policyReferenceSchema.extend({
      bytes: z.literal(V3_POLICY_BYTES),
      policyId: z.literal(
        "reviewer-platform-actor-eligibility-v3",
      ),
      schemaVersion: z.literal(3),
      sha256: z.literal(FROZEN_SOURCE.v3PolicySha256),
    }).strict(),
  }).strict(),
  sanitizedProjection: z.object({
    bytes: z.number().int().positive(),
    rows: z.array(sanitizedRowSchema).length(
      FROZEN_SOURCE.actorCount,
    ),
    sha256: sha256Schema,
  }).strict(),
  schemaVersion: z.literal(2),
}).strict();

const rawCaptureSchema = z.object({
  captureDirectory: z.string().regex(/^actor-[a-f0-9]{64}$/u),
  captureOrder: z.number().int().positive(),
  finalAttempt: z.literal(1),
  login: loginSchema,
  networkAttemptCount: z.literal(1),
  platformType: z.string().min(1).nullable(),
  responseLogin: z.string().min(1).nullable(),
  status: z.union([z.literal(200), z.literal(404)]),
}).strict();
const rawBoundarySchema = z.object({
  acceptedEpisodeCount: z.literal(0),
  actorEligibilityDecisionApplied: z.literal(false),
  cryptographicPlatformReceipt: z.literal(false),
  eventTimeActorTypeProven: z.literal(false),
  humanReviewerIdentityProven: z.literal(false),
  selectionExecuted: z.literal(false),
  transportAttemptCompletenessProven: z.literal(true),
}).strict();
const rawAttemptSchema = z.object({
  attempt: z.literal(1),
  request: artifactReferenceSchema,
  responseHeaders: artifactReferenceSchema,
  response: artifactReferenceSchema.extend({
    httpStatus: z.union([z.literal(200), z.literal(404)]),
    redirected: z.literal(false),
    responseUrl: z.url(),
  }).strict(),
}).strict();
const rawManifestSchema = z.object({
  artifactKind: z.literal(
    "c6-reviewer-actor-identity-capture",
  ),
  attempts: z.tuple([rawAttemptSchema]),
  boundary: rawBoundarySchema,
  capture: rawCaptureSchema,
  schemaVersion: z.literal(3),
}).strict();
const rawRootSchema = z.object({
  artifactKind: z.literal(
    "c6-reviewer-actor-identity-capture-root",
  ),
  boundary: rawBoundarySchema.extend({
    captureAttemptCompletenessProven: z.literal(true),
  }).strict(),
  captures: z.array(rawCaptureSchema).length(
    FROZEN_SOURCE.actorCount,
  ),
  counts: z.object({
    capturedTargetCount: z.literal(FROZEN_SOURCE.actorCount),
    networkAttemptCount: z.literal(FROZEN_SOURCE.actorCount),
    plannedTargetCount: z.literal(FROZEN_SOURCE.actorCount),
    resolvedActorCount: z.literal(
      FROZEN_SOURCE.resolvedActorCount,
    ),
    retryCount: z.literal(0),
    unresolvedActorCount: z.literal(
      FROZEN_SOURCE.unresolvedActorCount,
    ),
  }).strict(),
  plan: z.object({
    bytes: z.literal(FROZEN_SOURCE.actorPlanBytes),
    path: z.literal(FROZEN_SOURCE.actorPlanPath),
    schemaVersion: z.literal(2),
    sha256: z.literal(FROZEN_SOURCE.actorPlanSha256),
    targetProjectionSha256: z.literal(
      FROZEN_SOURCE.targetProjectionSha256,
    ),
  }).strict(),
  schemaVersion: z.literal(3),
}).strict();
const requestSchema = z.object({
  attempt: z.literal(1),
  headers: z.object({
    accept: z.literal("application/vnd.github+json"),
    apiVersion: z.literal("2022-11-28"),
    authorization: z.literal("Bearer <redacted>"),
    userAgent: z.literal(
      "GoodMemory-C6-Reviewer-Actor-Identity",
    ),
  }).strict(),
  method: z.literal("GET"),
  requestTimeoutMilliseconds: z.literal(60_000),
  url: z.url(),
}).strict();
const responseHeadersSchema = z.object({
  "content-type": z.string().min(1),
  date: z.string().min(1),
  etag: z.string().min(1).optional(),
  "x-github-request-id": z.string().min(1),
  "x-ratelimit-limit": z.string().regex(/^\d+$/u),
  "x-ratelimit-remaining": z.string().regex(/^\d+$/u),
  "x-ratelimit-reset": z.string().regex(/^\d+$/u),
  "x-ratelimit-resource": z.literal("core"),
  "x-ratelimit-used": z.string().regex(/^\d+$/u),
}).strict();
const actorResponseSchema = z.object({
  login: z.string().min(1),
  type: z.string().min(1),
}).passthrough();
const notFoundResponseSchema = z.object({
  documentation_url: z.url().optional(),
  message: z.string().min(1),
  status: z.union([z.string(), z.number()]).optional(),
}).strict();

export type C6ReviewerActorDerivedClassificationV3 =
  z.infer<typeof derivedClassificationSchema>;
export type C6ReviewerActorSanitizedRowV3 =
  z.infer<typeof sanitizedRowSchema>;

export interface C6ReviewerActorDerivedClassificationV3BuildInput {
  actorPlanPath: string;
  actorRoot: string;
  testHooks?: {
    afterOutputPublication?: () => Promise<void> | void;
    beforeTerminalVerification?: () => Promise<void> | void;
  };
}

interface FrozenSource {
  actorLock: C6AssetLock;
  actorPlan: C6LiveMultiLangNeighborActorPlanV2;
  actorPlanBytes: Buffer;
  actorPlanPath: string;
  actorRoot: string;
  captureBytes: Buffer;
  captureRoot: z.infer<typeof rawRootSchema>;
}

interface OwnedOutput {
  dev: number;
  ino: number;
}

export function serializeC6ReviewerActorSanitizedProjectionV3(
  rows: readonly C6ReviewerActorSanitizedRowV3[],
): string {
  const parsed = z.array(sanitizedRowSchema).length(
    FROZEN_SOURCE.actorCount,
  ).parse(rows);
  return `${JSON.stringify(parsed)}\n`;
}

export function parseC6ReviewerActorDerivedClassificationV3(
  input: string | Uint8Array,
): C6ReviewerActorDerivedClassificationV3 {
  const text = toText(input);
  const raw = parseJson(text, "derived classification v3");
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 reviewer actor derived classification v3 requires canonical JSON",
    );
  }
  const classification = derivedClassificationSchema.parse(raw);
  assertDerivedClassification(classification);
  return classification;
}

export function serializeC6ReviewerActorDerivedClassificationV3(
  classification: C6ReviewerActorDerivedClassificationV3,
): string {
  const parsed = derivedClassificationSchema.parse(classification);
  assertDerivedClassification(parsed);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export async function buildC6ReviewerActorDerivedClassificationV3(
  input: C6ReviewerActorDerivedClassificationV3BuildInput,
): Promise<{
  classification: C6ReviewerActorDerivedClassificationV3;
  outputSha256: string;
}> {
  const initial = await readFrozenSource(input);
  const classification = deriveClassification(initial);
  const serialized =
    serializeC6ReviewerActorDerivedClassificationV3(
      classification,
    );
  parseC6ReviewerActorDerivedClassificationV3(serialized);

  await input.testHooks?.beforeTerminalVerification?.();
  const terminal = await readFrozenSource(input);
  if (
    !terminal.actorPlanBytes.equals(initial.actorPlanBytes) ||
    !terminal.captureBytes.equals(initial.captureBytes) ||
    serializeC6AssetLock(terminal.actorLock) !==
      serializeC6AssetLock(initial.actorLock) ||
    serializeC6ReviewerActorDerivedClassificationV3(
      deriveClassification(terminal),
    ) !== serialized
  ) {
    throw new Error(
      "C6 reviewer actor v3 raw input closure changed",
    );
  }
  return {
    classification,
    outputSha256: sha256(serialized),
  };
}

export async function materializeC6ReviewerActorDerivedClassificationV3(
  input:
    C6ReviewerActorDerivedClassificationV3BuildInput & {
      outputPath: string;
    },
): Promise<{
  classification: C6ReviewerActorDerivedClassificationV3;
  outputSha256: string;
}> {
  const result =
    await buildC6ReviewerActorDerivedClassificationV3(input);
  const serialized =
    serializeC6ReviewerActorDerivedClassificationV3(
      result.classification,
    );
  const outputPath = resolve(input.outputPath);
  const outputParent = await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 reviewer actor v3 output parent",
  );
  const temporaryPath = join(
    outputParent,
    `.${basename(outputPath)}.incomplete-${randomUUID()}`,
  );
  let owned: OwnedOutput | null = null;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        (stat.mode & 0o7777) !== 0o600
      ) {
        throw new Error(
          "C6 reviewer actor v3 output ownership mismatch",
        );
      }
      owned = { dev: stat.dev, ino: stat.ino };
      await handle.writeFile(serialized, "utf8");
      await handle.chmod(0o644);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertOwnedOutput(temporaryPath, owned);
    await assertC6NoSymlinkPathComponents(
      outputParent,
      "C6 reviewer actor v3 terminal output parent",
    );
    await link(temporaryPath, outputPath);
    await assertOwnedOutput(temporaryPath, owned);
    await assertOwnedOutput(outputPath, owned);
    await input.testHooks?.afterOutputPublication?.();
    await assertOwnedOutput(temporaryPath, owned);
    await assertOwnedOutput(outputPath, owned);
    const publishedBytes = await readC6StableRegularFile(
      outputPath,
      "reviewer actor v3 published output",
    );
    const replayed =
      await buildC6ReviewerActorDerivedClassificationV3({
        actorPlanPath: input.actorPlanPath,
        actorRoot: input.actorRoot,
      });
    if (
      sha256(publishedBytes) !== result.outputSha256 ||
      replayed.outputSha256 !== result.outputSha256 ||
      serializeC6ReviewerActorDerivedClassificationV3(
        parseC6ReviewerActorDerivedClassificationV3(
          publishedBytes,
        ),
      ) !== serialized
    ) {
      throw new Error(
        "C6 reviewer actor v3 post-publication replay mismatch",
      );
    }
    await assertOwnedOutput(temporaryPath, owned);
    await assertOwnedOutput(outputPath, owned);
    if (!await removeOutputIfOwned(temporaryPath, owned)) {
      throw new Error(
        "C6 reviewer actor v3 temporary output cleanup mismatch",
      );
    }
    return result;
  } catch (error) {
    if (owned !== null) {
      await removeOutputIfOwned(outputPath, owned);
      await removeOutputIfOwned(temporaryPath, owned);
    }
    throw error;
  }
}

function deriveClassification(
  source: FrozenSource,
): C6ReviewerActorDerivedClassificationV3 {
  const rows: C6ReviewerActorSanitizedRowV3[] = [];
  const decisions = [];
  for (const capture of source.captureRoot.captures) {
    const input = {
      plannedLogin: capture.login,
      platformType: capture.platformType,
      responseLogin: capture.responseLogin,
      status: capture.status,
    };
    const v2 = classifyC6ReviewerActorV2(input);
    const v3 = classifyC6ReviewerActorV3(input);
    rows.push({
      captureOrder: capture.captureOrder,
      login: capture.login,
      status: capture.status,
      currentPlatformType: capture.platformType,
    });
    decisions.push({
      captureOrder: capture.captureOrder,
      login: capture.login,
      v2: {
        eligible: v2.eligible,
        reason: v2.reason,
      },
      v3: {
        eligible: v3.eligible,
        reason: v3.reason,
      },
    });
  }
  const decisionDiff = {
    v2ToV3: decisions.filter(
      (decision) =>
        decision.v2.eligible && !decision.v3.eligible,
    ),
  };
  const projectionBytes =
    serializeC6ReviewerActorSanitizedProjectionV3(rows);
  const classification = derivedClassificationSchema.parse({
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      actorFilteredSelectionExecuted: false,
      automationExclusionComplete: false,
      candidateManifestFrozen: false,
      codexRunReady: false,
      commitAncestryProven: false,
      eventTimeActorTypeProven: false,
      humanReviewerIdentityProven: false,
      independentReviewCompleted: false,
      independentReviewReceiptRequired: true,
      selectionExecuted: false,
      status:
        "policy-v3-independent-review-and-commit-freeze-required",
    },
    chronology: {
      adaptiveAfterCompleteActorCapture: true,
      policyV3PreregisteredBeforeActorCapture: false,
      selectionExecuted: false,
    },
    counts: countsOf(rows, decisions),
    decisionDiff,
    decisions,
    independenceBoundary: {
      fullStructuralRowsInput: false,
      goldInput: false,
      reviewBodyInput: false,
      reviewOutcomeInput: false,
      selectedSequenceInput: false,
      structuralReviewerLoginProjectionInput: true,
      structuralSelectionOutcomeInput: false,
    },
    inputs: {
      actorPlan: {
        bytes: source.actorPlanBytes.byteLength,
        path: basename(source.actorPlanPath),
        sha256: sha256(source.actorPlanBytes),
        targetProjectionSha256:
          source.actorPlan.independenceBoundary
            .targetProjectionSha256,
      },
      actorRoot: {
        assetRootSha256: source.actorLock.assetRootSha256,
        captureManifestBytes: source.captureBytes.byteLength,
        captureManifestSha256: sha256(source.captureBytes),
        fileCount: source.actorLock.files.length,
        totalBytes: source.actorLock.files.reduce(
          (sum, file) => sum + file.bytes,
          0,
        ),
      },
    },
    policy: {
      v2: {
        bytes: V2_POLICY_BYTES,
        policyId: C6_REVIEWER_ACTOR_POLICY_V2.policyId,
        schemaVersion: C6_REVIEWER_ACTOR_POLICY_V2.schemaVersion,
        sha256: sha256(serializeC6ReviewerActorPolicyV2()),
      },
      v3: {
        bytes: V3_POLICY_BYTES,
        policyId: C6_REVIEWER_ACTOR_POLICY_V3.policyId,
        schemaVersion: C6_REVIEWER_ACTOR_POLICY_V3.schemaVersion,
        sha256: sha256(serializeC6ReviewerActorPolicyV3()),
      },
    },
    sanitizedProjection: {
      bytes: Buffer.byteLength(projectionBytes),
      rows,
      sha256: sha256(projectionBytes),
    },
    schemaVersion: 2,
  });
  assertDerivedClassification(classification);
  return classification;
}

function assertDerivedClassification(
  classification: C6ReviewerActorDerivedClassificationV3,
): void {
  const rows = classification.sanitizedProjection.rows;
  const decisions = rows.map((row) => {
    const input = {
      plannedLogin: row.login,
      platformType: row.currentPlatformType,
      responseLogin: row.status === 200 ? row.login : null,
      status: row.status,
    };
    const v2 = classifyC6ReviewerActorV2(input);
    const v3 = classifyC6ReviewerActorV3(input);
    return {
      captureOrder: row.captureOrder,
      login: row.login,
      v2: {
        eligible: v2.eligible,
        reason: v2.reason,
      },
      v3: {
        eligible: v3.eligible,
        reason: v3.reason,
      },
    };
  });
  const decisionDiff = {
    v2ToV3: decisions.filter(
      (decision) =>
        decision.v2.eligible && !decision.v3.eligible,
    ),
  };
  const projectionBytes =
    serializeC6ReviewerActorSanitizedProjectionV3(rows);
  const logins = rows.map((row) => row.login);
  if (
    classification.sanitizedProjection.bytes !==
      Buffer.byteLength(projectionBytes) ||
    classification.sanitizedProjection.sha256 !==
      sha256(projectionBytes) ||
    JSON.stringify(logins) !==
      JSON.stringify([...logins].sort(compareStrings)) ||
    !rows.every(
      (row, index) => row.captureOrder === index + 1,
    ) ||
    JSON.stringify(classification.decisions) !==
      JSON.stringify(decisions) ||
    JSON.stringify(classification.decisionDiff) !==
      JSON.stringify(decisionDiff) ||
    JSON.stringify(classification.counts) !==
      JSON.stringify(countsOf(rows, decisions))
  ) {
    throw new Error(
      "C6 reviewer actor derived classification v3 self-consistency mismatch",
    );
  }
}

async function readFrozenSource(
  input: C6ReviewerActorDerivedClassificationV3BuildInput,
): Promise<FrozenSource> {
  const [actorPlanPath, actorRoot] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.actorPlanPath,
      "C6 reviewer actor v3 plan",
    ),
    assertC6NoSymlinkPathComponents(
      input.actorRoot,
      "C6 reviewer actor v3 root",
    ),
  ]);
  const [actorPlanBytes, actorLock] = await Promise.all([
    readC6StableRegularFile(
      actorPlanPath,
      "reviewer actor v3 plan",
    ),
    buildC6AssetLock(actorRoot),
  ]);
  if (
    actorPlanBytes.byteLength !== FROZEN_SOURCE.actorPlanBytes ||
    basename(actorPlanPath) !== FROZEN_SOURCE.actorPlanPath ||
    sha256(actorPlanBytes) !== FROZEN_SOURCE.actorPlanSha256
  ) {
    throw new Error(
      "C6 reviewer actor v3 actor plan hash mismatch",
    );
  }
  const actorPlan =
    parseC6LiveMultiLangNeighborActorPlanV2(actorPlanBytes);
  if (
    actorLock.assetRootSha256 !==
      FROZEN_SOURCE.actorRootAssetSha256 ||
    actorLock.files.length !==
      FROZEN_SOURCE.actorRootFileCount ||
    actorLock.files.reduce(
      (sum, file) => sum + file.bytes,
      0,
    ) !== FROZEN_SOURCE.actorRootTotalBytes
  ) {
    throw new Error(
      "C6 reviewer actor v3 actor root hash mismatch",
    );
  }
  await assertExactRawTree(actorRoot, actorPlan);
  const files = new Map(
    actorLock.files.map((file) => [file.path, file]),
  );
  const captureBytes = await readBoundFile({
    actorRoot,
    expectedPath: "capture.json",
    files,
  });
  if (
    captureBytes.byteLength !==
      FROZEN_SOURCE.actorRootCaptureBytes ||
    sha256(captureBytes) !==
      FROZEN_SOURCE.actorRootCaptureSha256
  ) {
    throw new Error(
      "C6 reviewer actor v3 capture root hash mismatch",
    );
  }
  const captureRoot = rawRootSchema.parse(
    parseCanonicalJson(captureBytes, "capture root"),
  );
  if (
    actorPlan.targets.length !== FROZEN_SOURCE.actorCount ||
    actorPlan.independenceBoundary.targetProjectionSha256 !==
      FROZEN_SOURCE.targetProjectionSha256 ||
    captureRoot.captures.length !== actorPlan.targets.length ||
    captureRoot.plan.sha256 !== sha256(actorPlanBytes) ||
    captureRoot.plan.targetProjectionSha256 !==
      actorPlan.independenceBoundary.targetProjectionSha256
  ) {
    throw new Error(
      "C6 reviewer actor v3 source binding mismatch",
    );
  }
  for (
    let offset = 0;
    offset < actorPlan.targets.length;
    offset += 16
  ) {
    await Promise.all(
      actorPlan.targets.slice(offset, offset + 16).map(
        (target, index) =>
          verifyActorTarget({
            actorRoot,
            capture:
              captureRoot.captures[offset + index]!,
            files,
            target,
          }),
      ),
    );
  }
  return {
    actorLock,
    actorPlan,
    actorPlanBytes,
    actorPlanPath,
    actorRoot,
    captureBytes,
    captureRoot,
  };
}

async function verifyActorTarget(input: {
  actorRoot: string;
  capture: z.infer<typeof rawCaptureSchema>;
  files: ReadonlyMap<string, C6AssetLock["files"][number]>;
  target: C6LiveMultiLangNeighborActorPlanV2["targets"][number];
}): Promise<void> {
  const { capture, target } = input;
  if (
    capture.captureDirectory !== target.captureDirectory ||
    capture.captureOrder !== target.captureOrder ||
    capture.login !== target.login
  ) {
    throw new Error(
      "C6 reviewer actor v3 plan/capture order mismatch",
    );
  }
  const manifestPath = `${target.captureDirectory}/manifest.json`;
  const manifestBytes = await readBoundFile({
    actorRoot: input.actorRoot,
    expectedPath: manifestPath,
    files: input.files,
  });
  const manifest = rawManifestSchema.parse(
    parseCanonicalJson(manifestBytes, "actor manifest"),
  );
  if (
    JSON.stringify(manifest.capture) !==
      JSON.stringify(capture)
  ) {
    throw new Error(
      "C6 reviewer actor v3 root/manifest capture mismatch",
    );
  }
  const attempt = manifest.attempts[0];
  const attemptRoot = `${target.captureDirectory}/attempt-01`;
  const expectedUrl =
    `https://api.github.com/users/${encodeURIComponent(target.login)}`;
  const [requestBytes, headerBytes, responseBytes] =
    await Promise.all([
      readReferencedFile({
        actorRoot: input.actorRoot,
        attemptRoot,
        expectedReferencePath: "attempt-01/request.json",
        files: input.files,
        reference: attempt.request,
      }),
      readReferencedFile({
        actorRoot: input.actorRoot,
        attemptRoot,
        expectedReferencePath:
          "attempt-01/response-headers.json",
        files: input.files,
        reference: attempt.responseHeaders,
      }),
      readReferencedFile({
        actorRoot: input.actorRoot,
        attemptRoot,
        expectedReferencePath: "attempt-01/response.json",
        files: input.files,
        reference: attempt.response,
      }),
    ]);
  const request = requestSchema.parse(
    parseCanonicalJson(requestBytes, "actor request"),
  );
  const headers = responseHeadersSchema.parse(
    parseCanonicalJson(headerBytes, "actor response headers"),
  );
  if (
    request.url !== expectedUrl ||
    attempt.response.httpStatus !== capture.status ||
    attempt.response.responseUrl !== expectedUrl ||
    !headers["content-type"].toLowerCase().startsWith(
      "application/json",
    ) ||
    !Number.isFinite(Date.parse(headers.date))
  ) {
    throw new Error(
      "C6 reviewer actor v3 request/response binding mismatch",
    );
  }
  const response = parseJson(
    responseBytes.toString("utf8"),
    "actor response",
  );
  if (capture.status === 200) {
    const actor = actorResponseSchema.parse(response);
    if (
      capture.platformType === null ||
      capture.responseLogin === null ||
      actor.type !== capture.platformType ||
      actor.login !== capture.responseLogin ||
      normalizeLogin(actor.login) !== target.login
    ) {
      throw new Error(
        "C6 reviewer actor v3 response identity mismatch",
      );
    }
    return;
  }
  notFoundResponseSchema.parse(response);
  if (
    capture.platformType !== null ||
    capture.responseLogin !== null
  ) {
    throw new Error(
      "C6 reviewer actor v3 unresolved identity mismatch",
    );
  }
}

async function readReferencedFile(input: {
  actorRoot: string;
  attemptRoot: string;
  expectedReferencePath: string;
  files: ReadonlyMap<string, C6AssetLock["files"][number]>;
  reference: z.infer<typeof artifactReferenceSchema>;
}): Promise<Buffer> {
  if (input.reference.path !== input.expectedReferencePath) {
    throw new Error(
      "C6 reviewer actor v3 artifact reference path mismatch",
    );
  }
  const expectedPath = join(
    input.attemptRoot,
    basename(input.reference.path),
  );
  const bytes = await readBoundFile({
    actorRoot: input.actorRoot,
    expectedPath,
    files: input.files,
  });
  if (
    bytes.byteLength !== input.reference.bytes ||
    sha256(bytes) !== input.reference.sha256
  ) {
    throw new Error(
      "C6 reviewer actor v3 artifact reference mismatch",
    );
  }
  return bytes;
}

async function readBoundFile(input: {
  actorRoot: string;
  expectedPath: string;
  files: ReadonlyMap<string, C6AssetLock["files"][number]>;
}): Promise<Buffer> {
  const file = input.files.get(input.expectedPath);
  if (
    file === undefined ||
    file.mode !== FILE_MODE ||
    file.path !== input.expectedPath
  ) {
    throw new Error(
      `C6 reviewer actor v3 missing bound file ${input.expectedPath}`,
    );
  }
  const bytes = await readC6StableRegularFile(
    join(input.actorRoot, input.expectedPath),
    `reviewer actor v3 ${input.expectedPath}`,
  );
  if (
    bytes.byteLength !== file.bytes ||
    sha256(bytes) !== file.sha256
  ) {
    throw new Error(
      `C6 reviewer actor v3 bound file changed ${input.expectedPath}`,
    );
  }
  return bytes;
}

async function assertExactRawTree(
  actorRoot: string,
  actorPlan: C6LiveMultiLangNeighborActorPlanV2,
): Promise<void> {
  const expectedDirectories = new Set<string>([""]);
  const expectedFiles = new Set<string>(["capture.json"]);
  for (const target of actorPlan.targets) {
    const attemptRoot = `${target.captureDirectory}/attempt-01`;
    expectedDirectories.add(target.captureDirectory);
    expectedDirectories.add(attemptRoot);
    expectedFiles.add(`${target.captureDirectory}/manifest.json`);
    expectedFiles.add(`${attemptRoot}/request.json`);
    expectedFiles.add(`${attemptRoot}/response-headers.json`);
    expectedFiles.add(`${attemptRoot}/response.json`);
  }
  const actual = await walkRawTree(actorRoot, actorRoot);
  if (
    JSON.stringify([...actual.directories].sort(compareStrings)) !==
      JSON.stringify(
        [...expectedDirectories].sort(compareStrings),
      ) ||
    JSON.stringify([...actual.files].sort(compareStrings)) !==
      JSON.stringify([...expectedFiles].sort(compareStrings))
  ) {
    throw new Error(
      "C6 reviewer actor v3 raw tree closure mismatch",
    );
  }
}

async function walkRawTree(
  root: string,
  path: string,
): Promise<{
  directories: string[];
  files: string[];
}> {
  const stat = await lstat(path);
  const relativePath = relative(root, path);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (stat.mode & 0o7777) !== DIRECTORY_MODE
  ) {
    throw new Error(
      `C6 reviewer actor v3 directory identity mismatch ${relativePath}`,
    );
  }
  const directories = [relativePath];
  const files: string[] = [];
  for (const entry of await readdir(path)) {
    const child = join(path, entry);
    const childStat = await lstat(child);
    const childRelativePath = relative(root, child);
    if (childStat.isSymbolicLink()) {
      throw new Error(
        `C6 reviewer actor v3 rejects symlink ${childRelativePath}`,
      );
    }
    if (childStat.isDirectory()) {
      const nested = await walkRawTree(root, child);
      directories.push(...nested.directories);
      files.push(...nested.files);
      continue;
    }
    if (
      !childStat.isFile() ||
      (childStat.mode & 0o7777) !== FILE_MODE
    ) {
      throw new Error(
        `C6 reviewer actor v3 file identity mismatch ${childRelativePath}`,
      );
    }
    files.push(childRelativePath);
  }
  return { directories, files };
}

function countsOf(
  rows: readonly C6ReviewerActorSanitizedRowV3[],
  decisions: readonly z.infer<typeof decisionSchema>[],
) {
  const v2EligibleActorCount = decisions.filter(
    (decision) => decision.v2.eligible,
  ).length;
  const v3EligibleActorCount = decisions.filter(
    (decision) => decision.v3.eligible,
  ).length;
  return {
    actorCount: rows.length,
    newlyExcludedActorCount: decisions.filter(
      (decision) =>
        decision.v2.eligible && !decision.v3.eligible,
    ).length,
    resolvedActorCount: rows.filter(
      (row) => row.status === 200,
    ).length,
    unresolvedActorCount: rows.filter(
      (row) => row.status === 404,
    ).length,
    v2EligibleActorCount,
    v2IneligibleActorCount:
      decisions.length - v2EligibleActorCount,
    v3EligibleActorCount,
    v3IneligibleActorCount:
      decisions.length - v3EligibleActorCount,
  };
}

function parseCanonicalJson(
  bytes: Uint8Array,
  label: string,
): unknown {
  const text = Buffer.from(bytes).toString("utf8");
  const raw = parseJson(text, label);
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      `C6 reviewer actor v3 ${label} is not canonical`,
    );
  }
  return raw;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `C6 reviewer actor v3 invalid ${label} JSON`,
    );
  }
}

function normalizeLogin(value: string): string {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    /[/\s]/u.test(value)
  ) {
    throw new Error(
      "C6 reviewer actor v3 response login is invalid",
    );
  }
  return value.toLowerCase();
}

async function assertOwnedOutput(
  path: string,
  owned: OwnedOutput,
): Promise<void> {
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.dev !== owned.dev ||
    stat.ino !== owned.ino ||
    (stat.mode & 0o7777) !== 0o644
  ) {
    throw new Error(
      "C6 reviewer actor v3 output ownership mismatch",
    );
  }
}

async function removeOutputIfOwned(
  path: string,
  owned: OwnedOutput,
): Promise<boolean> {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.dev !== owned.dev ||
    stat.ino !== owned.ino
  ) {
    return false;
  }
  await rm(path);
  return true;
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function toText(input: string | Uint8Array): string {
  return typeof input === "string"
    ? input
    : Buffer.from(input).toString("utf8");
}
