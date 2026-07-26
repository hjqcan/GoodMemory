import { createHash } from "node:crypto";
import {
  lstat,
  open,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  buildC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
} from "./c6-asset-lock";
import type { C6AssetLock } from "./c6-asset-lock";
import {
  parseC6LiveMultiLangNeighborActorPlan,
} from "./c6-live-multilang-neighbor-actor-plan";
import type {
  C6LiveMultiLangNeighborActorPlan,
} from "./c6-live-multilang-neighbor-actor-plan";
import {
  classifyC6ReviewerActor,
  C6_REVIEWER_ACTOR_POLICY_V1,
  serializeC6ReviewerActorPolicy,
} from "./c6-reviewer-actor-policy";
import {
  classifyC6ReviewerActorV2,
  C6_REVIEWER_ACTOR_POLICY_V2,
  serializeC6ReviewerActorPolicyV2,
} from "./c6-reviewer-actor-policy-v2";

const ARTIFACT_KIND =
  "c6-reviewer-actor-derived-classification";
const REVIEW_RECEIPT_KIND =
  "c6-reviewer-actor-policy-v2-review-receipt";
const FROZEN_SOURCE = {
  actorCount: 267,
  actorPlanBytes: 48_002,
  actorPlanPath:
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-reviewer-actor-plan-v1.json",
  actorPlanSha256:
    "abb0a817611c7f5568c0f3390625598a46a1a56c687617815260ee98121a92d3",
  actorRootAssetSha256:
    "f92953b8a0cfbf10e41a54c6912b67541a847c1b11b7b57dc7d5cb647b1a4ab4",
  actorRootCaptureBytes: 101_895,
  actorRootCaptureSha256:
    "ec047aba9c5e862193627d814432bd2d29d9387505de56c1e834891aba511f51",
  actorRootFileCount: 1_069,
  actorRootTotalBytes: 1_035_264,
  sanitizedProjectionBytes: 22_244,
  sanitizedProjectionSha256:
    "7749134e4bf7b3c799188a1f27ca7f48d0d387d3b7e6a7b69a7a9f1e8d089237",
  targetProjectionSha256:
    "8393f1a04a25b3288932b954ab5825ec8ceca37f57dd3d3da8dc9bdd7ac62205",
  v1PolicySha256:
    "ca0014e5e6d47dc63f490b49bff6835b9d5ed99e69b3eb8d8ddf4266edc8643f",
  v2PolicySha256:
    "c243571bc95c44494dca68606ba772c26a7b640d1c2bbe60fc1818603efc0e44",
} as const;
const FROZEN_NEW_EXCLUSIONS = [
  "cubic-dev-ai",
  "esphbot",
  "gemini-code-assist",
  "greptile-apps",
  "mentatbot",
] as const;

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
const v1ReasonSchema = z.enum([
  "eligible-platform-user",
  "known-automation-login",
  "platform-actor-not-user",
  "platform-actor-unresolved",
]);
const v2ReasonSchema = z.enum([
  "automation-style-login-excluded",
  "current-platform-user-no-known-automation-signal",
  "known-automation-login",
  "platform-actor-not-user",
  "platform-actor-unresolved",
]);
const classificationSchema = z.object({
  captureOrder: z.number().int().positive(),
  login: loginSchema,
  v1: z.object({
    eligible: z.boolean(),
    reason: v1ReasonSchema,
  }).strict(),
  v2: z.object({
    eligible: z.boolean(),
    reason: v2ReasonSchema,
  }).strict(),
}).strict();
const artifactReferenceSchema = z.object({
  bytes: z.number().int().positive(),
  path: z.string().min(1).refine(
    (value) => basename(value) === value,
    "artifact path must be a basename",
  ),
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
    actorFilteredSelectionExecuted: z.literal(false),
    automationExclusionComplete: z.literal(false),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    commitAncestryProven: z.literal(false),
    eventTimeActorTypeProven: z.literal(false),
    humanReviewerIdentityProven: z.literal(false),
    independentReviewCompleted: z.literal(false),
    independentReviewReceiptRequired: z.literal(true),
    status: z.literal(
      "policy-v2-independent-review-and-commit-freeze-required",
    ),
  }).strict(),
  chronology: z.object({
    adaptiveAfterActorCapture: z.literal(true),
    commitAncestryProven: z.literal(false),
    policyV2PreregisteredBeforeActorCapture: z.literal(false),
    selectionExecuted: z.literal(false),
  }).strict(),
  classifications: z.array(classificationSchema).length(
    FROZEN_SOURCE.actorCount,
  ),
  counts: z.object({
    actorCount: z.literal(FROZEN_SOURCE.actorCount),
    newlyExcludedActorCount: z.literal(5),
    resolvedActorCount: z.literal(260),
    unresolvedActorCount: z.literal(7),
    v1EligibleActorCount: z.literal(254),
    v1IneligibleActorCount: z.literal(13),
    v2EligibleActorCount: z.literal(249),
    v2IneligibleActorCount: z.literal(18),
  }).strict(),
  independenceBoundary: z.object({
    goldInput: z.literal(false),
    reviewBodyInput: z.literal(false),
    reviewOutcomeInput: z.literal(false),
    selectedSequenceInput: z.literal(false),
  }).strict(),
  inputs: z.object({
    actorPlan: artifactReferenceSchema.extend({
      targetProjectionSha256: sha256Schema,
    }).strict(),
    actorRoot: z.object({
      assetRootSha256: sha256Schema,
      captureManifestSha256: sha256Schema,
      fileCount: z.number().int().positive(),
      totalBytes: z.number().int().positive(),
    }).strict(),
  }).strict(),
  newlyExcludedLogins: z.tuple([
    z.literal("cubic-dev-ai"),
    z.literal("esphbot"),
    z.literal("gemini-code-assist"),
    z.literal("greptile-apps"),
    z.literal("mentatbot"),
  ]),
  policy: z.object({
    v1: policyReferenceSchema.extend({
      policyId: z.literal(
        "reviewer-platform-actor-eligibility-v1",
      ),
      schemaVersion: z.literal(1),
    }).strict(),
    v2: policyReferenceSchema.extend({
      policyId: z.literal(
        "reviewer-platform-actor-eligibility-v2",
      ),
      schemaVersion: z.literal(2),
    }).strict(),
  }).strict(),
  sanitizedProjection: z.object({
    bytes: z.number().int().positive(),
    rows: z.array(sanitizedRowSchema).length(
      FROZEN_SOURCE.actorCount,
    ),
    sha256: sha256Schema,
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();
const rawCaptureSchema = z.object({
  captureDirectory: z.string().regex(/^actor-[a-f0-9]{64}$/u),
  captureOrder: z.number().int().positive(),
  eligible: z.boolean(),
  finalAttempt: z.number().int().positive(),
  login: loginSchema,
  networkAttemptCount: z.number().int().positive(),
  platformType: z.string().min(1).nullable(),
  reason: v1ReasonSchema,
  responseLogin: z.string().min(1).nullable(),
  status: z.union([z.literal(200), z.literal(404)]),
}).strict();
const rawCaptureRootSchema = z.object({
  artifactKind: z.literal(
    "c6-reviewer-actor-identity-capture-root",
  ),
  boundary: z.object({
    captureAttemptCompletenessProven: z.literal(true),
    cryptographicPlatformReceipt: z.literal(false),
    eventTimeActorTypeProven: z.literal(false),
    humanReviewerIdentityProven: z.literal(false),
    transportAttemptCompletenessProven: z.literal(true),
  }).strict(),
  captures: z.array(rawCaptureSchema).length(
    FROZEN_SOURCE.actorCount,
  ),
  counts: z.object({
    capturedTargetCount: z.literal(FROZEN_SOURCE.actorCount),
    eligibleActorCount: z.literal(254),
    ineligibleActorCount: z.literal(13),
    networkAttemptCount: z.literal(FROZEN_SOURCE.actorCount),
    plannedTargetCount: z.literal(FROZEN_SOURCE.actorCount),
    resolvedActorCount: z.literal(260),
    retryCount: z.literal(0),
    unresolvedActorCount: z.literal(7),
  }).strict(),
  plan: z.object({
    bytes: z.literal(FROZEN_SOURCE.actorPlanBytes),
    path: z.literal(FROZEN_SOURCE.actorPlanPath),
    sha256: z.literal(FROZEN_SOURCE.actorPlanSha256),
    targetProjectionSha256: z.literal(
      FROZEN_SOURCE.targetProjectionSha256,
    ),
  }).strict(),
  policy: z.object({
    policyId: z.literal(
      "reviewer-platform-actor-eligibility-v1",
    ),
    sha256: z.literal(FROZEN_SOURCE.v1PolicySha256),
  }).strict(),
  schemaVersion: z.literal(2),
}).strict();
const reviewProvenanceSchema = z.object({
  bytes: z.number().int().positive(),
  path: z.string().min(1).refine(
    (value) => basename(value) === value,
    "review provenance path must be a basename",
  ),
  sha256: sha256Schema,
}).strict();
const reviewReceiptSchema = z.object({
  artifactKind: z.literal(REVIEW_RECEIPT_KIND),
  author: z.object({
    identity: z.string().min(1),
  }).strict(),
  boundary: z.object({
    goldInput: z.literal(false),
    independentReviewerIdentityProven: z.literal(false),
    personnelOutcomeBlindnessProven: z.literal(false),
    reviewBodyInput: z.literal(false),
    reviewOutcomeInput: z.literal(false),
    selectedSequenceInput: z.literal(false),
    status: z.literal("review-receipt-structure-only"),
  }).strict(),
  decision: z.enum(["accepted", "rejected"]),
  inputs: z.object({
    classificationSha256: sha256Schema,
    policySha256: sha256Schema,
    sanitizedProjectionSha256: sha256Schema,
  }).strict(),
  provenance: z.object({
    dispatch: reviewProvenanceSchema,
    input: reviewProvenanceSchema,
    request: reviewProvenanceSchema,
    response: reviewProvenanceSchema,
  }).strict(),
  reviewer: z.object({
    identity: z.string().min(1),
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();

export type C6ReviewerActorDerivedClassification =
  z.infer<typeof derivedClassificationSchema>;
export type C6ReviewerActorPolicyV2ReviewReceipt =
  z.infer<typeof reviewReceiptSchema>;
export type C6ReviewerActorSanitizedRow =
  z.infer<typeof sanitizedRowSchema>;

export interface C6ReviewerActorDerivedClassificationBuildInput {
  actorPlanPath: string;
  actorRoot: string;
  testHooks?: {
    beforeTerminalVerification?: () => Promise<void> | void;
  };
}

interface FrozenSource {
  actorLock: C6AssetLock;
  actorPlan: C6LiveMultiLangNeighborActorPlan;
  actorPlanBytes: Buffer;
  actorPlanPath: string;
  actorRoot: string;
  captureBytes: Buffer;
  captureRoot: z.infer<typeof rawCaptureRootSchema>;
}

export function serializeC6ReviewerActorSanitizedProjection(
  rows: readonly C6ReviewerActorSanitizedRow[],
): string {
  const parsed = z.array(sanitizedRowSchema).length(
    FROZEN_SOURCE.actorCount,
  ).parse(rows);
  return `${JSON.stringify(parsed)}\n`;
}

export function parseC6ReviewerActorSanitizedProjection(
  input: string | Uint8Array,
): C6ReviewerActorSanitizedRow[] {
  const text = toText(input);
  const raw = parseJson(text, "sanitized projection");
  if (text !== `${JSON.stringify(raw)}\n`) {
    throw new Error(
      "C6 reviewer actor sanitized projection requires canonical JSON",
    );
  }
  return z.array(sanitizedRowSchema).length(
    FROZEN_SOURCE.actorCount,
  ).parse(raw);
}

export function serializeC6ReviewerActorDerivedClassification(
  classification: C6ReviewerActorDerivedClassification,
): string {
  return `${JSON.stringify(classification, null, 2)}\n`;
}

export function parseC6ReviewerActorDerivedClassification(
  input: string | Uint8Array,
): C6ReviewerActorDerivedClassification {
  const text = toText(input);
  const raw = parseJson(text, "derived classification");
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 reviewer actor derived classification requires canonical JSON",
    );
  }
  const classification = derivedClassificationSchema.parse(raw);
  assertDerivedClassification(classification);
  return classification;
}

export function parseC6ReviewerActorPolicyV2ReviewReceipt(input: {
  expectedClassificationSha256: string;
  expectedPolicySha256: string;
  expectedSanitizedProjectionSha256: string;
  input: string | Uint8Array;
}): C6ReviewerActorPolicyV2ReviewReceipt {
  const expected = {
    classification: sha256Schema.parse(
      input.expectedClassificationSha256,
    ),
    policy: sha256Schema.parse(input.expectedPolicySha256),
    projection: sha256Schema.parse(
      input.expectedSanitizedProjectionSha256,
    ),
  };
  if (
    expected.policy !== FROZEN_SOURCE.v2PolicySha256 ||
    expected.projection !==
      FROZEN_SOURCE.sanitizedProjectionSha256
  ) {
    throw new Error(
      "C6 reviewer actor policy v2 review receipt frozen input mismatch",
    );
  }
  const text = toText(input.input);
  const raw = parseJson(text, "policy v2 review receipt");
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 reviewer actor policy v2 review receipt requires canonical JSON",
    );
  }
  const receipt = reviewReceiptSchema.parse(raw);
  if (receipt.author.identity === receipt.reviewer.identity) {
    throw new Error(
      "C6 reviewer actor policy v2 reviewer must differ from author",
    );
  }
  if (
    receipt.inputs.classificationSha256 !==
      expected.classification ||
    receipt.inputs.policySha256 !== expected.policy ||
    receipt.inputs.sanitizedProjectionSha256 !==
      expected.projection
  ) {
    throw new Error(
      "C6 reviewer actor policy v2 review receipt input binding mismatch",
    );
  }
  return receipt;
}

export async function buildC6ReviewerActorDerivedClassification(
  input: C6ReviewerActorDerivedClassificationBuildInput,
): Promise<{
  classification: C6ReviewerActorDerivedClassification;
  outputSha256: string;
}> {
  const initial = await readFrozenSource(input);
  const classification = deriveClassification(initial);
  const serialized =
    serializeC6ReviewerActorDerivedClassification(classification);
  parseC6ReviewerActorDerivedClassification(serialized);

  await input.testHooks?.beforeTerminalVerification?.();
  const terminal = await readFrozenSource(input);
  if (
    !terminal.actorPlanBytes.equals(initial.actorPlanBytes) ||
    !terminal.captureBytes.equals(initial.captureBytes) ||
    serializeC6AssetLock(terminal.actorLock) !==
      serializeC6AssetLock(initial.actorLock)
  ) {
    throw new Error(
      "C6 reviewer actor v2 raw input closure changed",
    );
  }
  const terminalClassification = deriveClassification(terminal);
  if (
    serializeC6ReviewerActorDerivedClassification(
      terminalClassification,
    ) !== serialized
  ) {
    throw new Error(
      "C6 reviewer actor v2 terminal classification changed",
    );
  }
  return {
    classification,
    outputSha256: sha256(serialized),
  };
}

export async function materializeC6ReviewerActorDerivedClassification(
  input:
    C6ReviewerActorDerivedClassificationBuildInput & {
      outputPath: string;
    },
): Promise<{
  classification: C6ReviewerActorDerivedClassification;
  outputSha256: string;
}> {
  const result =
    await buildC6ReviewerActorDerivedClassification(input);
  const serialized =
    serializeC6ReviewerActorDerivedClassification(
      result.classification,
    );
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 reviewer actor v2 output parent",
  );
  const handle = await open(outputPath, "wx", 0o644);
  const opened = await handle.stat();
  try {
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const publishedBytes = await readC6StableRegularFile(
      outputPath,
      "reviewer actor v2 published output",
    );
    const published =
      parseC6ReviewerActorDerivedClassification(publishedBytes);
    const replayed =
      await buildC6ReviewerActorDerivedClassification({
        actorPlanPath: input.actorPlanPath,
        actorRoot: input.actorRoot,
      });
    if (
      sha256(publishedBytes) !== result.outputSha256 ||
      replayed.outputSha256 !== result.outputSha256 ||
      serializeC6ReviewerActorDerivedClassification(published) !==
        serialized
    ) {
      throw new Error(
        "C6 reviewer actor v2 post-publication replay mismatch",
      );
    }
  } catch (error) {
    await removeOwnedOutput(outputPath, opened.dev, opened.ino);
    throw error;
  }
  return result;
}

function deriveClassification(
  source: FrozenSource,
): C6ReviewerActorDerivedClassification {
  const projection: C6ReviewerActorSanitizedRow[] = [];
  const classifications = [];
  for (const [index, target] of source.actorPlan.targets.entries()) {
    const capture = source.captureRoot.captures[index]!;
    if (
      capture.captureOrder !== target.captureOrder ||
      capture.captureDirectory !== target.captureDirectory ||
      capture.login !== target.login
    ) {
      throw new Error(
        "C6 reviewer actor v2 plan/capture order mismatch",
      );
    }
    const v1 = classifyC6ReviewerActor({
      plannedLogin: capture.login,
      platformType: capture.platformType,
      responseLogin: capture.responseLogin,
      status: capture.status,
    });
    if (
      v1.eligible !== capture.eligible ||
      v1.reason !== capture.reason
    ) {
      throw new Error(
        "C6 reviewer actor v2 source v1 classification mismatch",
      );
    }
    const v2 = classifyC6ReviewerActorV2({
      plannedLogin: capture.login,
      platformType: capture.platformType,
      responseLogin: capture.responseLogin,
      status: capture.status,
    });
    projection.push({
      captureOrder: capture.captureOrder,
      login: capture.login,
      status: capture.status,
      currentPlatformType: capture.platformType,
    });
    classifications.push({
      captureOrder: capture.captureOrder,
      login: capture.login,
      v1: {
        eligible: v1.eligible,
        reason: v1.reason,
      },
      v2: {
        eligible: v2.eligible,
        reason: v2.reason,
      },
    });
  }
  const projectionBytes =
    serializeC6ReviewerActorSanitizedProjection(projection);
  const newlyExcludedLogins = classifications
    .filter((entry) => entry.v1.eligible && !entry.v2.eligible)
    .map((entry) => entry.login);
  const classification = derivedClassificationSchema.parse({
    artifactKind: ARTIFACT_KIND,
    boundary: {
      actorFilteredSelectionExecuted: false,
      automationExclusionComplete: false,
      candidateManifestFrozen: false,
      codexRunReady: false,
      commitAncestryProven: false,
      eventTimeActorTypeProven: false,
      humanReviewerIdentityProven: false,
      independentReviewCompleted: false,
      independentReviewReceiptRequired: true,
      status:
        "policy-v2-independent-review-and-commit-freeze-required",
    },
    chronology: {
      adaptiveAfterActorCapture: true,
      commitAncestryProven: false,
      policyV2PreregisteredBeforeActorCapture: false,
      selectionExecuted: false,
    },
    classifications,
    counts: {
      actorCount: classifications.length,
      newlyExcludedActorCount: newlyExcludedLogins.length,
      resolvedActorCount: projection.filter(
        (row) => row.status === 200,
      ).length,
      unresolvedActorCount: projection.filter(
        (row) => row.status === 404,
      ).length,
      v1EligibleActorCount: classifications.filter(
        (entry) => entry.v1.eligible,
      ).length,
      v1IneligibleActorCount: classifications.filter(
        (entry) => !entry.v1.eligible,
      ).length,
      v2EligibleActorCount: classifications.filter(
        (entry) => entry.v2.eligible,
      ).length,
      v2IneligibleActorCount: classifications.filter(
        (entry) => !entry.v2.eligible,
      ).length,
    },
    independenceBoundary: {
      goldInput: false,
      reviewBodyInput: false,
      reviewOutcomeInput: false,
      selectedSequenceInput: false,
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
        captureManifestSha256: sha256(source.captureBytes),
        fileCount: source.actorLock.files.length,
        totalBytes: source.actorLock.files.reduce(
          (sum, file) => sum + file.bytes,
          0,
        ),
      },
    },
    newlyExcludedLogins,
    policy: {
      v1: {
        bytes: Buffer.byteLength(
          serializeC6ReviewerActorPolicy(),
        ),
        policyId: C6_REVIEWER_ACTOR_POLICY_V1.policyId,
        schemaVersion: C6_REVIEWER_ACTOR_POLICY_V1.schemaVersion,
        sha256: sha256(serializeC6ReviewerActorPolicy()),
      },
      v2: {
        bytes: Buffer.byteLength(
          serializeC6ReviewerActorPolicyV2(),
        ),
        policyId: C6_REVIEWER_ACTOR_POLICY_V2.policyId,
        schemaVersion: C6_REVIEWER_ACTOR_POLICY_V2.schemaVersion,
        sha256: sha256(serializeC6ReviewerActorPolicyV2()),
      },
    },
    sanitizedProjection: {
      bytes: Buffer.byteLength(projectionBytes),
      rows: projection,
      sha256: sha256(projectionBytes),
    },
    schemaVersion: 1,
  });
  assertDerivedClassification(classification);
  return classification;
}

function assertDerivedClassification(
  classification: C6ReviewerActorDerivedClassification,
): void {
  const projectionBytes =
    serializeC6ReviewerActorSanitizedProjection(
      classification.sanitizedProjection.rows,
    );
  const recomputedClassifications =
    classification.sanitizedProjection.rows.map((row) => {
      const common = {
        plannedLogin: row.login,
        platformType: row.currentPlatformType,
        responseLogin: row.status === 200 ? row.login : null,
        status: row.status,
      };
      const v1 = classifyC6ReviewerActor(common);
      const v2 = classifyC6ReviewerActorV2(common);
      return {
        captureOrder: row.captureOrder,
        login: row.login,
        v1: {
          eligible: v1.eligible,
          reason: v1.reason,
        },
        v2: {
          eligible: v2.eligible,
          reason: v2.reason,
        },
      };
    });
  const newlyExcludedLogins = recomputedClassifications
    .filter((entry) => entry.v1.eligible && !entry.v2.eligible)
    .map((entry) => entry.login);
  const logins = classification.sanitizedProjection.rows.map(
    (row) => row.login,
  );
  if (
    classification.inputs.actorPlan.bytes !==
      FROZEN_SOURCE.actorPlanBytes ||
    classification.inputs.actorPlan.path !==
      FROZEN_SOURCE.actorPlanPath ||
    classification.inputs.actorPlan.sha256 !==
      FROZEN_SOURCE.actorPlanSha256 ||
    classification.inputs.actorPlan.targetProjectionSha256 !==
      FROZEN_SOURCE.targetProjectionSha256 ||
    classification.inputs.actorRoot.assetRootSha256 !==
      FROZEN_SOURCE.actorRootAssetSha256 ||
    classification.inputs.actorRoot.captureManifestSha256 !==
      FROZEN_SOURCE.actorRootCaptureSha256 ||
    classification.inputs.actorRoot.fileCount !==
      FROZEN_SOURCE.actorRootFileCount ||
    classification.inputs.actorRoot.totalBytes !==
      FROZEN_SOURCE.actorRootTotalBytes ||
    classification.policy.v1.sha256 !==
      FROZEN_SOURCE.v1PolicySha256 ||
    classification.policy.v2.sha256 !==
      FROZEN_SOURCE.v2PolicySha256 ||
    classification.sanitizedProjection.bytes !==
      FROZEN_SOURCE.sanitizedProjectionBytes ||
    classification.sanitizedProjection.sha256 !==
      FROZEN_SOURCE.sanitizedProjectionSha256 ||
    sha256(projectionBytes) !==
      classification.sanitizedProjection.sha256 ||
    JSON.stringify(logins) !==
      JSON.stringify([...logins].sort(compareStrings)) ||
    !classification.sanitizedProjection.rows.every(
      (row, index) => row.captureOrder === index + 1,
    ) ||
    JSON.stringify(classification.classifications) !==
      JSON.stringify(recomputedClassifications) ||
    JSON.stringify(classification.newlyExcludedLogins) !==
      JSON.stringify(newlyExcludedLogins) ||
    JSON.stringify(newlyExcludedLogins) !==
      JSON.stringify(FROZEN_NEW_EXCLUSIONS) ||
    JSON.stringify(classification.counts) !==
      JSON.stringify(countsOf(
        classification.sanitizedProjection.rows,
        recomputedClassifications,
      ))
  ) {
    throw new Error(
      "C6 reviewer actor derived classification self-consistency mismatch",
    );
  }
}

async function readFrozenSource(
  input: C6ReviewerActorDerivedClassificationBuildInput,
): Promise<FrozenSource> {
  const [actorPlanPath, actorRoot] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.actorPlanPath,
      "C6 reviewer actor v2 plan",
    ),
    assertC6NoSymlinkPathComponents(
      input.actorRoot,
      "C6 reviewer actor v2 root",
    ),
  ]);
  const capturePath = join(actorRoot, "capture.json");
  const [actorPlanBytes, actorLock, captureBytes] =
    await Promise.all([
      readC6StableRegularFile(
        actorPlanPath,
        "reviewer actor v2 plan",
      ),
      buildC6AssetLock(actorRoot),
      readC6StableRegularFile(
        capturePath,
        "reviewer actor v2 capture root",
      ),
    ]);
  if (
    actorPlanBytes.byteLength !== FROZEN_SOURCE.actorPlanBytes ||
    basename(actorPlanPath) !== FROZEN_SOURCE.actorPlanPath ||
    sha256(actorPlanBytes) !== FROZEN_SOURCE.actorPlanSha256
  ) {
    throw new Error(
      "C6 reviewer actor v2 actor plan hash mismatch",
    );
  }
  if (
    actorLock.assetRootSha256 !==
      FROZEN_SOURCE.actorRootAssetSha256 ||
    actorLock.files.length !== FROZEN_SOURCE.actorRootFileCount ||
    actorLock.files.reduce(
      (sum, file) => sum + file.bytes,
      0,
    ) !== FROZEN_SOURCE.actorRootTotalBytes ||
    captureBytes.byteLength !==
      FROZEN_SOURCE.actorRootCaptureBytes ||
    sha256(captureBytes) !==
      FROZEN_SOURCE.actorRootCaptureSha256
  ) {
    throw new Error(
      "C6 reviewer actor v2 actor root hash mismatch",
    );
  }
  const actorPlan =
    parseC6LiveMultiLangNeighborActorPlan(actorPlanBytes);
  const captureRoot = rawCaptureRootSchema.parse(
    parseCanonicalJson(captureBytes, "raw capture root"),
  );
  if (
    actorPlan.targets.length !== FROZEN_SOURCE.actorCount ||
    actorPlan.independenceBoundary.targetProjectionSha256 !==
      FROZEN_SOURCE.targetProjectionSha256 ||
    captureRoot.captures.length !== actorPlan.targets.length ||
    captureRoot.plan.sha256 !== sha256(actorPlanBytes) ||
    captureRoot.policy.sha256 !==
      sha256(serializeC6ReviewerActorPolicy())
  ) {
    throw new Error(
      "C6 reviewer actor v2 source binding mismatch",
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

function countsOf(
  rows: readonly C6ReviewerActorSanitizedRow[],
  classifications: readonly z.infer<
    typeof classificationSchema
  >[],
) {
  const v1Eligible = classifications.filter(
    (entry) => entry.v1.eligible,
  ).length;
  const v2Eligible = classifications.filter(
    (entry) => entry.v2.eligible,
  ).length;
  return {
    actorCount: rows.length,
    newlyExcludedActorCount: classifications.filter(
      (entry) => entry.v1.eligible && !entry.v2.eligible,
    ).length,
    resolvedActorCount: rows.filter(
      (row) => row.status === 200,
    ).length,
    unresolvedActorCount: rows.filter(
      (row) => row.status === 404,
    ).length,
    v1EligibleActorCount: v1Eligible,
    v1IneligibleActorCount:
      classifications.length - v1Eligible,
    v2EligibleActorCount: v2Eligible,
    v2IneligibleActorCount:
      classifications.length - v2Eligible,
  };
}

function parseCanonicalJson(
  bytes: Buffer,
  label: string,
): unknown {
  const text = bytes.toString("utf8");
  const raw = parseJson(text, label);
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(`C6 reviewer actor v2 ${label} is not canonical`);
  }
  return raw;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`C6 reviewer actor v2 invalid ${label} JSON`);
  }
}

async function removeOwnedOutput(
  path: string,
  expectedDev: number,
  expectedIno: number,
): Promise<void> {
  try {
    const stat = await lstat(path);
    if (
      stat.isFile() &&
      stat.dev === expectedDev &&
      stat.ino === expectedIno
    ) {
      await rm(path);
    }
  } catch {
    return;
  }
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
