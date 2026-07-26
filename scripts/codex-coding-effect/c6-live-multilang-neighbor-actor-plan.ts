import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  open,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  resolve,
} from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";
import {
  parseC6LiveMultiLangNeighborStructuralQualification,
  serializeC6LiveMultiLangNeighborStructuralQualification,
} from "./c6-live-multilang-neighbor-structural-qualification";
import type {
  C6LiveMultiLangNeighborStructuralQualification,
} from "./c6-live-multilang-neighbor-structural-qualification";
import {
  C6_REVIEWER_ACTOR_POLICY_V1,
  serializeC6ReviewerActorPolicy,
} from "./c6-reviewer-actor-policy";

const ARTIFACT_KIND = "c6-reviewer-actor-identity-plan";
const FROZEN_QUALIFICATION_PATH =
  "swe-bench-live-multilang-608f7ae9." +
  "neighbor-structural-qualification-v1.json";
const FROZEN_WAVE1 = {
  deepCapturePlanBytes: 518_443,
  deepCapturePlanPath:
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-deep-capture-plan-v1.json",
  deepCapturePlanSha256:
    "9c1ebdafd700a274cffc4dba807a2425013079d1bfe74a1e99f1144399da492a",
  deepEvidenceAssetRootSha256:
    "80c360d58b1959e5a47cbd70c5eb620276ed2105c49a595dccdb4aa178d1f83b",
  deepEvidenceCompletionSha256:
    "62ba6ada2d0ae54f4d43149e592ec06b70899e712a12f97dd503d8650ff2063d",
  deepEvidenceDirectoryCount: 2_771,
  deepEvidenceFileCount: 2_772,
  deepEvidenceFinalSuccessfulResponseCount: 693,
  deepEvidenceLogicalRequestCount: 693,
  deepEvidenceNetworkRequestCount: 693,
  deepEvidenceTargetProjectionSha256:
    "7286f92d0b211ab6830727969d2c40e691e73b1b55197fce221a271ef14edbcf",
  qualificationBytes: 1_358_575,
  qualificationSha256:
    "ae096d86f779cb04f1fb0bb336d6bb4e02ced04e72385d9332d4dba82a9c1210",
  reviewerActorOccurrenceCount: 3_185,
  reviewerActorOccurrenceProjectionSha256:
    "881aafcfad9a9675e353adb8b2a3aaa8fd623ff0525c29ba34a3b08f29ee0c49",
  reviewerLoginProjectionSha256:
    "a26324b895357d9191a0d84baddbca968bea218859d968a743ebdd7b48f0aa34",
  sourceTargetCount: 692,
  uniqueActorCount: 267,
} as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const loginSchema = z.string().min(1).refine(
  (value) =>
    value.trim() === value &&
    !/[/\s]/u.test(value) &&
    value === value.toLowerCase(),
  "actor login must be normalized",
);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().positive(),
  path: z.string().min(1).refine(
    (value) => basename(value) === value,
    "artifact path must be a basename",
  ),
  sha256: sha256Schema,
}).strict();
const actorPolicySchema = z.object({
  actorEligibility: z.object({
    automationLoginRule: z.object({
      containsCaseInsensitive: z.tuple([
        z.literal("coderabbit"),
        z.literal("copilot"),
        z.literal("cursor"),
      ]),
      exactCaseInsensitive: z.tuple([
        z.literal("github-actions"),
        z.literal("github-advanced-security"),
      ]),
      suffixCaseInsensitive: z.literal("[bot]"),
    }).strict(),
    platformType: z.literal("User"),
    unresolvedStatus: z.literal(404),
  }).strict(),
  boundary: z.object({
    automationExclusionComplete: z.literal(false),
    eventTimeActorTypeProven: z.literal(false),
    humanReviewerIdentityProven: z.literal(false),
    platformActorTypeCaptured: z.literal(true),
  }).strict(),
  inputClosure: z.literal(
    "all-broad-target-review-authors-before-actor-filtering",
  ),
  policyId: z.literal("reviewer-platform-actor-eligibility-v1"),
  responseIdentity: z.literal(
    "case-insensitive-login-exact-match",
  ),
  schemaVersion: z.literal(1),
}).strict();
const targetSchema = z.object({
  captureDirectory: z.string().regex(
    /^actor-[a-f0-9]{64}$/u,
  ),
  captureOrder: z.number().int().positive(),
  login: loginSchema,
}).strict();
const planSchema = z.object({
  artifactKind: z.literal(ARTIFACT_KIND),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    actorCaptureExecuted: z.literal(false),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    status: z.literal(
      "reviewer-actor-identity-capture-required",
    ),
  }).strict(),
  counts: z.object({
    sourceReviewReferenceCount: z.number().int().positive(),
    sourceTargetCount: z.number().int().positive(),
    uniqueActorCount: z.number().int().positive(),
  }).strict(),
  independenceBoundary: z.object({
    goldInput: z.literal(false),
    machineOutcomeInput: z.literal(false),
    patchInput: z.literal(false),
    reviewerActorOccurrenceProjectionSha256: sha256Schema,
    reviewerLoginProjectionSha256: sha256Schema,
    semanticLedgerInput: z.literal(false),
    selectedSequenceInput: z.literal(false),
    targetProjectionSha256: sha256Schema,
    testInput: z.literal(false),
  }).strict(),
  inputs: z.object({
    deepCapturePlan: artifactReferenceSchema,
    deepEvidence: z.object({
      assetRootSha256: sha256Schema,
      completionSha256: sha256Schema,
      directoryCount: z.number().int().positive(),
      fileCount: z.number().int().positive(),
      finalSuccessfulResponseCount:
        z.number().int().positive(),
      logicalRequestCount: z.number().int().positive(),
      networkRequestCount: z.number().int().positive(),
      targetProjectionSha256: sha256Schema,
    }).strict(),
    graphqlRootSha256: sha256Schema,
    qualification: artifactReferenceSchema,
  }).strict(),
  policy: z.object({
    definition: actorPolicySchema,
    policyId: z.literal("reviewer-platform-actor-eligibility-v1"),
    schemaVersion: z.literal(1),
    sha256: sha256Schema,
  }).strict(),
  rule: z.object({
    actorSurface: z.literal(
      "all-non-null-whole-review-and-review-thread-comment-authors",
    ),
    captureOrder: z.literal(
      "normalized-login-code-unit-ascending",
    ),
    normalization: z.literal("case-insensitive-login"),
    sourceOccurrenceClosure: z.literal(
      "all-review-and-review-thread-comment-occurrences",
    ),
  }).strict(),
  schemaVersion: z.literal(1),
  targets: z.array(targetSchema).min(1),
}).strict();

export type C6LiveMultiLangNeighborActorPlan =
  z.infer<typeof planSchema>;

export interface C6LiveMultiLangNeighborActorPlanTestHooks {
  afterOutputPublication?: () => Promise<void> | void;
  beforeTerminalReplay?: () => Promise<void> | void;
}

export interface C6LiveMultiLangNeighborActorPlanBuildInput {
  structuralQualificationPath: string;
  testHooks?: C6LiveMultiLangNeighborActorPlanTestHooks;
}

export function deriveC6LiveMultiLangNeighborActorPlan(input: {
  qualification: C6LiveMultiLangNeighborStructuralQualification;
  structuralArtifact: {
    bytes: number;
    path: string;
    sha256: string;
  };
}): C6LiveMultiLangNeighborActorPlan {
  const qualification =
    parseC6LiveMultiLangNeighborStructuralQualification(
      serializeC6LiveMultiLangNeighborStructuralQualification(
        input.qualification,
      ),
    );
  const structuralArtifact = artifactReferenceSchema.parse(
    input.structuralArtifact,
  );
  const reconstructedLogins = [...new Set(
    qualification.reviewerActorOccurrences.map((occurrence) =>
      normalizeLogin(occurrence.actorLogin)
    ),
  )].sort(compareStrings);
  if (
    JSON.stringify(reconstructedLogins) !==
      JSON.stringify(qualification.reviewerLogins) ||
    qualification.counts.reviewerActorOccurrenceCount !==
      qualification.reviewerActorOccurrences.length ||
    qualification.counts.reviewerUniqueLoginCount !==
      reconstructedLogins.length ||
    qualification.independenceBoundary
      .reviewerActorOccurrenceProjectionSha256 !==
        sha256(JSON.stringify(
          qualification.reviewerActorOccurrences,
        )) ||
    qualification.independenceBoundary
      .reviewerLoginProjectionSha256 !==
        sha256(JSON.stringify(reconstructedLogins))
  ) {
    throw new Error(
      "C6 neighbor actor plan reviewer occurrence closure mismatch",
    );
  }
  const targets = reconstructedLogins.map((login, index) => ({
    captureDirectory: `actor-${sha256(login)}`,
    captureOrder: index + 1,
    login,
  }));
  const plan = planSchema.parse({
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      candidateManifestFrozen: false,
      codexRunReady: false,
      status: "reviewer-actor-identity-capture-required",
    },
    counts: {
      sourceReviewReferenceCount:
        qualification.reviewerActorOccurrences.length,
      sourceTargetCount: qualification.counts.targetCount,
      uniqueActorCount: targets.length,
    },
    independenceBoundary: {
      goldInput: false,
      machineOutcomeInput: false,
      patchInput: false,
      reviewerActorOccurrenceProjectionSha256:
        qualification.independenceBoundary
          .reviewerActorOccurrenceProjectionSha256,
      reviewerLoginProjectionSha256:
        qualification.independenceBoundary
          .reviewerLoginProjectionSha256,
      semanticLedgerInput: false,
      selectedSequenceInput: false,
      targetProjectionSha256: sha256(JSON.stringify(targets)),
      testInput: false,
    },
    inputs: {
      deepCapturePlan: qualification.inputs.deepCapturePlan,
      deepEvidence: qualification.inputs.deepEvidence,
      graphqlRootSha256:
        qualification.inputs.deepEvidence.assetRootSha256,
      qualification: structuralArtifact,
    },
    policy: {
      definition: C6_REVIEWER_ACTOR_POLICY_V1,
      policyId: C6_REVIEWER_ACTOR_POLICY_V1.policyId,
      schemaVersion: C6_REVIEWER_ACTOR_POLICY_V1.schemaVersion,
      sha256: sha256(serializeC6ReviewerActorPolicy()),
    },
    rule: {
      actorSurface:
        "all-non-null-whole-review-and-review-thread-comment-authors",
      captureOrder: "normalized-login-code-unit-ascending",
      normalization: "case-insensitive-login",
      sourceOccurrenceClosure:
        "all-review-and-review-thread-comment-occurrences",
    },
    schemaVersion: 1,
    targets,
  });
  assertPlanSelfConsistency(plan);
  return plan;
}

export function serializeC6LiveMultiLangNeighborActorPlan(
  plan: C6LiveMultiLangNeighborActorPlan,
): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export function parseC6LiveMultiLangNeighborActorPlan(
  input: string | Uint8Array,
): C6LiveMultiLangNeighborActorPlan {
  const text = typeof input === "string"
    ? input
    : Buffer.from(input).toString("utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error("C6 neighbor actor plan invalid JSON");
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 neighbor actor plan requires canonical JSON",
    );
  }
  const plan = planSchema.parse(raw);
  assertPlanSelfConsistency(plan);
  return plan;
}

export async function buildC6LiveMultiLangNeighborActorPlan(
  input: C6LiveMultiLangNeighborActorPlanBuildInput,
): Promise<{
  outputSha256: string;
  plan: C6LiveMultiLangNeighborActorPlan;
}> {
  const initial = await readFrozenQualification(
    input.structuralQualificationPath,
    "neighbor actor plan structural qualification",
  );
  const plan = deriveC6LiveMultiLangNeighborActorPlan({
    qualification: initial.qualification,
    structuralArtifact: {
      bytes: initial.bytes.byteLength,
      path: basename(initial.path),
      sha256: sha256(initial.bytes),
    },
  });
  assertFrozenWave1(plan);

  await input.testHooks?.beforeTerminalReplay?.();
  const terminal = await readFrozenQualification(
    input.structuralQualificationPath,
    "neighbor actor plan terminal structural qualification",
  );
  const terminalPlan = deriveC6LiveMultiLangNeighborActorPlan({
    qualification: terminal.qualification,
    structuralArtifact: {
      bytes: terminal.bytes.byteLength,
      path: basename(terminal.path),
      sha256: sha256(terminal.bytes),
    },
  });
  const serialized = serializeC6LiveMultiLangNeighborActorPlan(plan);
  if (
    !terminal.bytes.equals(initial.bytes) ||
    serializeC6LiveMultiLangNeighborActorPlan(terminalPlan) !==
      serialized
  ) {
    throw new Error(
      "C6 neighbor actor plan input closure changed",
    );
  }
  parseC6LiveMultiLangNeighborActorPlan(serialized);
  return {
    outputSha256: sha256(serialized),
    plan,
  };
}

export async function materializeC6LiveMultiLangNeighborActorPlan(
  input:
    C6LiveMultiLangNeighborActorPlanBuildInput & {
      outputPath: string;
    },
): Promise<{
  outputSha256: string;
  plan: C6LiveMultiLangNeighborActorPlan;
}> {
  const result = await buildC6LiveMultiLangNeighborActorPlan(input);
  const serialized =
    serializeC6LiveMultiLangNeighborActorPlan(result.plan);
  const outputPath = resolve(input.outputPath);
  const outputParent = await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 neighbor actor plan output parent",
  );
  const temporaryPath = join(
    outputParent,
    `.${basename(outputPath)}.incomplete-${randomUUID()}`,
  );
  let ownedIdentity: OwnedFileIdentity | null = null;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      const openedStat = await handle.stat();
      if (
        !openedStat.isFile() ||
        (openedStat.mode & 0o7777) !== 0o600
      ) {
        throw new Error(
          "C6 neighbor actor plan temporary output identity mismatch",
        );
      }
      ownedIdentity = {
        dev: openedStat.dev,
        ino: openedStat.ino,
      };
      await handle.writeFile(serialized, "utf8");
      await handle.chmod(0o644);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const temporaryBytes = await readC6StableRegularFile(
      temporaryPath,
      "neighbor actor plan temporary output",
    );
    if (temporaryBytes.toString("utf8") !== serialized) {
      throw new Error(
        "C6 neighbor actor plan temporary output mismatch",
      );
    }
    await assertC6NoSymlinkPathComponents(
      outputParent,
      "C6 neighbor actor plan terminal output parent",
    );
    await link(temporaryPath, outputPath);
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });

    await input.testHooks?.afterOutputPublication?.();
    const replayed = await buildC6LiveMultiLangNeighborActorPlan({
      structuralQualificationPath:
        input.structuralQualificationPath,
    });
    if (
      replayed.outputSha256 !== result.outputSha256 ||
      serializeC6LiveMultiLangNeighborActorPlan(replayed.plan) !==
        serialized
    ) {
      throw new Error(
        "C6 neighbor actor plan post-publication replay mismatch",
      );
    }
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });
    const publishedBytes = await readC6StableRegularFile(
      outputPath,
      "neighbor actor plan published output",
    );
    const publishedPlan =
      parseC6LiveMultiLangNeighborActorPlan(publishedBytes);
    if (
      serializeC6LiveMultiLangNeighborActorPlan(publishedPlan) !==
        serialized
    ) {
      throw new Error(
        "C6 neighbor actor plan published output mismatch",
      );
    }
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });
    if (!await removePathIfOwned(temporaryPath, ownedIdentity)) {
      throw new Error(
        "C6 neighbor actor plan temporary output cleanup mismatch",
      );
    }
  } catch (error) {
    if (ownedIdentity !== null) {
      await removePathIfOwned(outputPath, ownedIdentity);
      await removePathIfOwned(temporaryPath, ownedIdentity);
    }
    throw error;
  }
  return result;
}

interface OwnedFileIdentity {
  dev: number;
  ino: number;
}

async function readFrozenQualification(
  inputPath: string,
  label: string,
): Promise<{
  bytes: Buffer;
  path: string;
  qualification: C6LiveMultiLangNeighborStructuralQualification;
}> {
  const path = await assertC6NoSymlinkPathComponents(
    inputPath,
    `C6 ${label}`,
  );
  const bytes = await readC6StableRegularFile(path, label);
  if (
    basename(path) !== FROZEN_QUALIFICATION_PATH ||
    bytes.byteLength !== FROZEN_WAVE1.qualificationBytes ||
    sha256(bytes) !== FROZEN_WAVE1.qualificationSha256
  ) {
    throw new Error(
      "C6 neighbor actor plan structural qualification hash mismatch",
    );
  }
  return {
    bytes,
    path,
    qualification:
      parseC6LiveMultiLangNeighborStructuralQualification(bytes),
  };
}

function assertFrozenWave1(
  plan: C6LiveMultiLangNeighborActorPlan,
): void {
  const expectedDeepEvidence = {
    assetRootSha256:
      FROZEN_WAVE1.deepEvidenceAssetRootSha256,
    completionSha256:
      FROZEN_WAVE1.deepEvidenceCompletionSha256,
    directoryCount: FROZEN_WAVE1.deepEvidenceDirectoryCount,
    fileCount: FROZEN_WAVE1.deepEvidenceFileCount,
    finalSuccessfulResponseCount:
      FROZEN_WAVE1.deepEvidenceFinalSuccessfulResponseCount,
    logicalRequestCount:
      FROZEN_WAVE1.deepEvidenceLogicalRequestCount,
    networkRequestCount:
      FROZEN_WAVE1.deepEvidenceNetworkRequestCount,
    targetProjectionSha256:
      FROZEN_WAVE1.deepEvidenceTargetProjectionSha256,
  };
  if (
    plan.counts.sourceReviewReferenceCount !==
      FROZEN_WAVE1.reviewerActorOccurrenceCount ||
    plan.counts.sourceTargetCount !==
      FROZEN_WAVE1.sourceTargetCount ||
    plan.counts.uniqueActorCount !==
      FROZEN_WAVE1.uniqueActorCount ||
    plan.independenceBoundary
      .reviewerActorOccurrenceProjectionSha256 !==
        FROZEN_WAVE1
          .reviewerActorOccurrenceProjectionSha256 ||
    plan.independenceBoundary
      .reviewerLoginProjectionSha256 !==
        FROZEN_WAVE1.reviewerLoginProjectionSha256 ||
    plan.inputs.deepCapturePlan.bytes !==
      FROZEN_WAVE1.deepCapturePlanBytes ||
    plan.inputs.deepCapturePlan.path !==
      FROZEN_WAVE1.deepCapturePlanPath ||
    plan.inputs.deepCapturePlan.sha256 !==
      FROZEN_WAVE1.deepCapturePlanSha256 ||
    JSON.stringify(plan.inputs.deepEvidence) !==
      JSON.stringify(expectedDeepEvidence) ||
    plan.inputs.graphqlRootSha256 !==
      FROZEN_WAVE1.deepEvidenceAssetRootSha256 ||
    plan.inputs.qualification.bytes !==
      FROZEN_WAVE1.qualificationBytes ||
    plan.inputs.qualification.path !==
      FROZEN_QUALIFICATION_PATH ||
    plan.inputs.qualification.sha256 !==
      FROZEN_WAVE1.qualificationSha256
  ) {
    throw new Error(
      "C6 neighbor actor plan frozen Wave1 baseline mismatch",
    );
  }
}

function assertPlanSelfConsistency(
  plan: C6LiveMultiLangNeighborActorPlan,
): void {
  const logins = plan.targets.map((target) => target.login);
  const expectedLogins = [...new Set(logins)].sort(compareStrings);
  for (const [index, target] of plan.targets.entries()) {
    if (
      target.captureOrder !== index + 1 ||
      target.captureDirectory !== `actor-${sha256(target.login)}`
    ) {
      throw new Error(
        "C6 neighbor actor plan target order mismatch",
      );
    }
  }
  if (
    plan.counts.uniqueActorCount !== plan.targets.length ||
    JSON.stringify(logins) !== JSON.stringify(expectedLogins) ||
    plan.independenceBoundary.targetProjectionSha256 !==
      sha256(JSON.stringify(plan.targets)) ||
    plan.independenceBoundary.reviewerLoginProjectionSha256 !==
      sha256(JSON.stringify(logins)) ||
    plan.inputs.graphqlRootSha256 !==
      plan.inputs.deepEvidence.assetRootSha256 ||
    JSON.stringify(plan.policy.definition) !==
      JSON.stringify(C6_REVIEWER_ACTOR_POLICY_V1) ||
    plan.policy.sha256 !==
      sha256(serializeC6ReviewerActorPolicy())
  ) {
    throw new Error(
      "C6 neighbor actor plan self-consistency mismatch",
    );
  }
}

async function assertPublishedOutputOwnership(input: {
  outputPath: string;
  ownedIdentity: OwnedFileIdentity;
  temporaryPath: string;
}): Promise<void> {
  const [outputStat, temporaryStat] = await Promise.all([
    lstat(input.outputPath),
    lstat(input.temporaryPath),
  ]);
  if (
    !outputStat.isFile() ||
    outputStat.isSymbolicLink() ||
    !temporaryStat.isFile() ||
    temporaryStat.isSymbolicLink() ||
    outputStat.dev !== input.ownedIdentity.dev ||
    outputStat.ino !== input.ownedIdentity.ino ||
    temporaryStat.dev !== input.ownedIdentity.dev ||
    temporaryStat.ino !== input.ownedIdentity.ino ||
    (outputStat.mode & 0o7777) !== 0o644 ||
    (temporaryStat.mode & 0o7777) !== 0o644
  ) {
    throw new Error(
      "C6 neighbor actor plan published output ownership mismatch",
    );
  }
}

async function removePathIfOwned(
  path: string,
  ownedIdentity: OwnedFileIdentity,
): Promise<boolean> {
  const stat = await lstat(path).catch(() => null);
  if (
    stat === null ||
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.dev !== ownedIdentity.dev ||
    stat.ino !== ownedIdentity.ino
  ) {
    return false;
  }
  await rm(path, { force: true });
  return true;
}

function normalizeLogin(value: string): string {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    /[/\s]/u.test(value)
  ) {
    throw new Error(`C6 neighbor actor plan invalid login ${value}`);
  }
  return value.toLowerCase();
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
