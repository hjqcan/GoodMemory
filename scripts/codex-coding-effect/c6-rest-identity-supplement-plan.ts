import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const targetSchema = z.object({
  anchorId: z.string().min(1),
  canonicalAnchorId: z.string().min(1),
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
  owner: z.string().min(1),
  pullNumber: z.number().int().positive(),
  repository: z.string().min(1),
}).passthrough();
const capturePlanSchema = z.object({
  artifactKind: z.literal("c6-source-expansion-rest-capture-plan"),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    captureExecuted: z.literal(false),
    codexRunReady: z.literal(false),
  }).passthrough(),
  counts: z.object({
    targetCount: z.number().int().positive(),
  }).passthrough(),
  independenceBoundary: z.object({
    targetProjectionSha256: sha256Schema,
  }).passthrough(),
  targets: z.array(targetSchema).min(1),
  schemaVersion: z.literal(1),
}).passthrough();
const resultSchema = z.object({
  anchorId: z.string().min(1),
  canonicalAnchorId: z.string().min(1),
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
  status: z.enum([
    "exact-structural-candidate",
    "missing-rest-closure",
    "no-exact-structural-sequence",
  ]),
}).passthrough();
const qualificationSchema = z.object({
  artifactKind: z.literal("c6-source-expansion-rest-qualification"),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    captureAttemptCompletenessProven: z.literal(false),
    codexRunReady: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
  }).passthrough(),
  counts: z.object({
    missingClosureCount: z.number().int().positive(),
    targetCount: z.number().int().positive(),
  }).passthrough(),
  results: z.array(resultSchema).min(1),
  schemaVersion: z.literal(1),
}).passthrough();
const referenceSchema = z.object({
  bytes: z.number().int().positive(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const supplementTargetSchema = z.object({
  anchorId: z.string().min(1),
  canonicalAnchorId: z.string().min(1),
  canonicalOwner: z.string().min(1),
  canonicalRepository: z.string().min(1),
  captureDirectory: z.string().min(1),
  originalCaptureOrder: z.number().int().positive(),
  pullNumber: z.number().int().positive(),
  supplementOrder: z.number().int().positive(),
}).strict();
const supplementPlanSchema = z.object({
  artifactKind: z.literal("c6-rest-identity-supplement-plan"),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    captureExecuted: z.literal(false),
    codexRunReady: z.literal(false),
    status: z.literal("missing-rest-pull-identity-supplement-plan-only"),
  }).strict(),
  counts: z.object({
    originalTargetCount: z.number().int().positive(),
    supplementRepositoryCount: z.number().int().positive(),
    supplementTargetCount: z.number().int().positive(),
  }).strict(),
  independenceBoundary: z.object({
    candidateOrderChanged: z.literal(false),
    machineOutcomeInput: z.literal(false),
    originalTargetProjectionSha256: sha256Schema,
    retryTargetingDependsOnMissingClosure: z.literal(true),
    semanticLedgerInput: z.literal(false),
    supplementTargetProjectionSha256: sha256Schema,
  }).strict(),
  inputs: z.object({
    capturePlan: referenceSchema,
    restQualification: referenceSchema,
  }).strict(),
  rule: z.object({
    endpoint: z.literal("GET /repos/{owner}/{repo}/pulls/{pull_number}"),
    order: z.literal("original-captureOrder-ascending"),
    purpose: z.literal(
      "pull-author-and-canonical-identity-only-no-comment-enumeration",
    ),
  }).strict(),
  schemaVersion: z.literal(1),
  targets: z.array(supplementTargetSchema).min(1),
}).strict();

export type C6RestIdentitySupplementPlan = z.infer<
  typeof supplementPlanSchema
>;

export function projectC6RestIdentitySupplementPlan(input: {
  capturePlanBytes: Uint8Array;
  capturePlanPath: string;
  qualificationBytes: Uint8Array;
  qualificationPath: string;
}): C6RestIdentitySupplementPlan {
  const capturePlanBytes = Buffer.from(input.capturePlanBytes);
  const qualificationBytes = Buffer.from(input.qualificationBytes);
  const rawCapturePlan = parseJson(capturePlanBytes, "capture plan");
  const capturePlan = capturePlanSchema.parse(rawCapturePlan);
  if (
    capturePlan.targets.length !== capturePlan.counts.targetCount ||
    sha256(JSON.stringify(
      (rawCapturePlan as { targets: unknown }).targets,
    )) !== capturePlan.independenceBoundary.targetProjectionSha256
  ) {
    throw new Error(
      "C6 REST identity supplement capture-plan projection mismatch",
    );
  }
  const targets = [...capturePlan.targets].sort(
    (left, right) => left.captureOrder - right.captureOrder,
  );
  assertContiguousOrder(
    targets.map((target) => target.captureOrder),
  );
  const qualification = qualificationSchema.parse(
    parseJson(qualificationBytes, "REST qualification"),
  );
  const results = [...qualification.results].sort(
    (left, right) => left.captureOrder - right.captureOrder,
  );
  assertContiguousOrder(
    results.map((result) => result.captureOrder),
  );
  if (
    qualification.counts.targetCount !== targets.length ||
    results.length !== targets.length ||
    qualification.counts.missingClosureCount !==
      results.filter((result) =>
        result.status === "missing-rest-closure"
      ).length
  ) {
    throw new Error(
      "C6 REST identity supplement qualification count mismatch",
    );
  }
  for (const [index, target] of targets.entries()) {
    const result = results[index]!;
    if (
      result.anchorId !== target.anchorId ||
      result.canonicalAnchorId !== target.canonicalAnchorId ||
      result.captureDirectory !== target.captureDirectory ||
      result.captureOrder !== target.captureOrder
    ) {
      throw new Error(
        "C6 REST identity supplement target identity mismatch",
      );
    }
  }
  const missingTargets = targets.filter((_, index) =>
    results[index]!.status === "missing-rest-closure"
  );
  const supplementTargets = missingTargets.map((target, index) => {
    const requested = parseAnchor(target.anchorId);
    const canonical = parseAnchor(target.canonicalAnchorId);
    if (
      requested.pullNumber !== target.pullNumber ||
      canonical.pullNumber !== target.pullNumber
    ) {
      throw new Error(
        `C6 REST identity supplement pull mismatch ${target.anchorId}`,
      );
    }
    const [canonicalOwner, canonicalRepository] =
      canonical.repository.split("/");
    return {
      anchorId: target.anchorId,
      canonicalAnchorId: target.canonicalAnchorId,
      canonicalOwner: canonicalOwner!,
      canonicalRepository: canonicalRepository!,
      captureDirectory: target.captureDirectory,
      originalCaptureOrder: target.captureOrder,
      pullNumber: target.pullNumber,
      supplementOrder: index + 1,
    };
  });
  const repositories = new Set(
    supplementTargets.map((target) =>
      `${target.canonicalOwner}/${target.canonicalRepository}`
    ),
  );
  return supplementPlanSchema.parse({
    artifactKind: "c6-rest-identity-supplement-plan",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureExecuted: false,
      codexRunReady: false,
      status: "missing-rest-pull-identity-supplement-plan-only",
    },
    counts: {
      originalTargetCount: targets.length,
      supplementRepositoryCount: repositories.size,
      supplementTargetCount: supplementTargets.length,
    },
    independenceBoundary: {
      candidateOrderChanged: false,
      machineOutcomeInput: false,
      originalTargetProjectionSha256:
        capturePlan.independenceBoundary.targetProjectionSha256,
      retryTargetingDependsOnMissingClosure: true,
      semanticLedgerInput: false,
      supplementTargetProjectionSha256:
        sha256(JSON.stringify(supplementTargets)),
    },
    inputs: {
      capturePlan: reference(capturePlanBytes, input.capturePlanPath),
      restQualification: reference(
        qualificationBytes,
        input.qualificationPath,
      ),
    },
    rule: {
      endpoint: "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      order: "original-captureOrder-ascending",
      purpose:
        "pull-author-and-canonical-identity-only-no-comment-enumeration",
    },
    schemaVersion: 1,
    targets: supplementTargets,
  });
}

export function serializeC6RestIdentitySupplementPlan(
  plan: C6RestIdentitySupplementPlan,
): string {
  return `${JSON.stringify(supplementPlanSchema.parse(plan), null, 2)}\n`;
}

export async function materializeC6RestIdentitySupplementPlan(input: {
  capturePlanPath: string;
  expectedCapturePlanSha256: string;
  expectedQualificationSha256: string;
  outputPath: string;
  qualificationPath: string;
}): Promise<{
  outputSha256: string;
  plan: C6RestIdentitySupplementPlan;
}> {
  const expectedCapturePlanSha256 = sha256Schema.parse(
    input.expectedCapturePlanSha256,
  );
  const expectedQualificationSha256 = sha256Schema.parse(
    input.expectedQualificationSha256,
  );
  const [capturePlanPath, qualificationPath] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.capturePlanPath,
      "C6 REST identity supplement capture plan",
    ),
    assertC6NoSymlinkPathComponents(
      input.qualificationPath,
      "C6 REST identity supplement qualification",
    ),
  ]);
  const [capturePlanBytes, qualificationBytes] = await Promise.all([
    readC6StableRegularFile(
      capturePlanPath,
      "REST identity supplement capture plan",
    ),
    readC6StableRegularFile(
      qualificationPath,
      "REST identity supplement qualification",
    ),
  ]);
  if (
    sha256(capturePlanBytes) !== expectedCapturePlanSha256 ||
    sha256(qualificationBytes) !== expectedQualificationSha256
  ) {
    throw new Error("C6 REST identity supplement input hash mismatch");
  }
  const plan = projectC6RestIdentitySupplementPlan({
    capturePlanBytes,
    capturePlanPath,
    qualificationBytes,
    qualificationPath,
  });
  const [terminalCapturePlanBytes, terminalQualificationBytes] =
    await Promise.all([
      readC6StableRegularFile(
        capturePlanPath,
        "REST identity supplement terminal capture plan",
      ),
      readC6StableRegularFile(
        qualificationPath,
        "REST identity supplement terminal qualification",
      ),
    ]);
  if (
    !terminalCapturePlanBytes.equals(capturePlanBytes) ||
    !terminalQualificationBytes.equals(qualificationBytes)
  ) {
    throw new Error(
      "C6 REST identity supplement input changed during projection",
    );
  }
  const serialized = serializeC6RestIdentitySupplementPlan(plan);
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 REST identity supplement output parent",
  );
  const handle = await open(outputPath, "wx", 0o644);
  try {
    await handle.writeFile(serialized, "utf8");
  } finally {
    await handle.close();
  }
  return {
    outputSha256: sha256(serialized),
    plan,
  };
}

function assertContiguousOrder(order: readonly number[]): void {
  if (
    order.length === 0 ||
    order.some((value, index) => value !== index + 1)
  ) {
    throw new Error(
      "C6 REST identity supplement capture order must be contiguous",
    );
  }
}

function parseAnchor(value: string): {
  pullNumber: number;
  repository: string;
} {
  const match = /^([^/#]+\/[^/#]+)#([1-9]\d*)$/u.exec(value);
  if (match === null) {
    throw new Error(`C6 REST identity supplement invalid anchor ${value}`);
  }
  return {
    pullNumber: Number(match[2]),
    repository: match[1]!.toLowerCase(),
  };
}

function reference(
  bytes: Buffer,
  path: string,
): {
  bytes: number;
  path: string;
  sha256: string;
} {
  return {
    bytes: bytes.byteLength,
    path: basename(resolve(path)),
    sha256: sha256(bytes),
  };
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(`C6 REST identity supplement invalid ${label} JSON`);
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
