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
import type {
  C6LiveMultiLangNeighborStructuralUnion,
} from "./c6-live-multilang-neighbor-structural-union";
import {
  parseC6LiveMultiLangNeighborStructuralUnion,
  serializeC6LiveMultiLangNeighborStructuralUnion,
} from "./c6-live-multilang-neighbor-structural-union";

const ARTIFACT_KIND = "c6-reviewer-actor-identity-plan";
const UNION_ARTIFACT_KIND =
  "c6-live-multilang-neighbor-structural-union";
const FROZEN_UNION = {
  bytes: 2_597_956,
  path:
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-structural-union-v1.json",
  reviewerActorOccurrenceProjectionSha256:
    "d426b898d5bddb5da2a187e5927695b3df6fb850168dc755ba0fd3c8e96c9fc7",
  reviewerLoginProjectionSha256:
    "4c03e130ce0b6c945f2bf526c3cfa0c25e5c17f0734cc34eafb264ebb9d56a61",
  sha256:
    "3a438e999450b96c039dbea6eba7ae971bb03223c42c2b2ff502f85ed76ad208",
  sourceReviewReferenceCount: 5_886,
  sourceTargetCount: 1_334,
  uniqueActorCount: 507,
} as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const loginSchema = z.string().min(1).refine(
  (value) =>
    value.trim() === value &&
    !/[/\s]/u.test(value) &&
    value === value.toLowerCase(),
  "actor login must be normalized",
);
const targetSchema = z.object({
  captureDirectory: z.string().regex(/^actor-[a-f0-9]{64}$/u),
  captureOrder: z.number().int().positive(),
  login: loginSchema,
}).strict();
const planSchema = z.object({
  artifactKind: z.literal(ARTIFACT_KIND),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    actorCaptureExecuted: z.literal(false),
    actorQualifiedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    evaluatorQualifiedEpisodeCount: z.literal(0),
    machineQualifiedEpisodeCount: z.literal(0),
    semanticallyQualifiedEpisodeCount: z.literal(0),
    status: z.literal(
      "reviewer-actor-identity-capture-required",
    ),
  }).strict(),
  counts: z.object({
    sourceReviewReferenceCount: z.literal(
      FROZEN_UNION.sourceReviewReferenceCount,
    ),
    sourceTargetCount: z.literal(FROZEN_UNION.sourceTargetCount),
    uniqueActorCount: z.literal(FROZEN_UNION.uniqueActorCount),
  }).strict(),
  independenceBoundary: z.object({
    acceptedEpisodeInput: z.literal(false),
    actorEligibilityDecisionInput: z.literal(false),
    evaluatorDecisionInput: z.literal(false),
    goldInput: z.literal(false),
    hiddenTestInput: z.literal(false),
    machineOutcomeInput: z.literal(false),
    patchInput: z.literal(false),
    reviewerActorOccurrenceProjectionSha256: z.literal(
      FROZEN_UNION.reviewerActorOccurrenceProjectionSha256,
    ),
    reviewerLoginProjectionSha256: z.literal(
      FROZEN_UNION.reviewerLoginProjectionSha256,
    ),
    selectedSequenceInput: z.literal(false),
    semanticDecisionInput: z.literal(false),
    targetProjectionSha256: sha256Schema,
    testInput: z.literal(false),
  }).strict(),
  inputs: z.object({
    structuralUnion: z.object({
      artifactKind: z.literal(UNION_ARTIFACT_KIND),
      bytes: z.literal(FROZEN_UNION.bytes),
      path: z.literal(FROZEN_UNION.path),
      reviewerLoginProjectionSha256: z.literal(
        FROZEN_UNION.reviewerLoginProjectionSha256,
      ),
      schemaVersion: z.literal(1),
      sha256: z.literal(FROZEN_UNION.sha256),
    }).strict(),
  }).strict(),
  rule: z.object({
    actorEligibilityDecision: z.literal(
      "not-applied-before-identity-capture",
    ),
    actorEligibilityPolicy: z.literal(
      "not-bound-until-complete-identity-capture",
    ),
    actorSurface: z.literal(
      "all-union-review-and-review-thread-comment-authors",
    ),
    captureOrder: z.literal(
      "normalized-login-code-unit-ascending",
    ),
    normalization: z.literal("case-insensitive-login"),
    targetCardinality: z.literal(
      "exactly-one-target-per-normalized-login",
    ),
  }).strict(),
  schemaVersion: z.literal(2),
  targets: z.array(targetSchema).length(
    FROZEN_UNION.uniqueActorCount,
  ),
}).strict();

export type C6LiveMultiLangNeighborActorPlanV2 =
  z.infer<typeof planSchema>;

export interface C6LiveMultiLangNeighborActorPlanV2TestHooks {
  afterOutputPublication?: () => Promise<void> | void;
  beforeTerminalReplay?: () => Promise<void> | void;
}

export interface C6LiveMultiLangNeighborActorPlanV2BuildInput {
  structuralUnionPath: string;
  testHooks?: C6LiveMultiLangNeighborActorPlanV2TestHooks;
}

export function deriveC6LiveMultiLangNeighborActorPlanV2(
  input: C6LiveMultiLangNeighborStructuralUnion,
): C6LiveMultiLangNeighborActorPlanV2 {
  assertReviewerLoginClosure(input);
  const union = canonicalFrozenUnion(input);
  const targets = union.reviewerLogins.map((login, index) => ({
    captureDirectory: `actor-${sha256(login)}`,
    captureOrder: index + 1,
    login,
  }));
  const plan = planSchema.parse({
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      actorQualifiedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      evaluatorQualifiedEpisodeCount: 0,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status: "reviewer-actor-identity-capture-required",
    },
    counts: {
      sourceReviewReferenceCount:
        union.reviewerActorOccurrences.length,
      sourceTargetCount: union.results.length,
      uniqueActorCount: targets.length,
    },
    independenceBoundary: {
      acceptedEpisodeInput: false,
      actorEligibilityDecisionInput: false,
      evaluatorDecisionInput: false,
      goldInput: false,
      hiddenTestInput: false,
      machineOutcomeInput: false,
      patchInput: false,
      reviewerActorOccurrenceProjectionSha256:
        union.independenceBoundary
          .reviewerActorOccurrenceProjectionSha256,
      reviewerLoginProjectionSha256:
        union.independenceBoundary
          .reviewerLoginProjectionSha256,
      selectedSequenceInput: false,
      semanticDecisionInput: false,
      targetProjectionSha256: sha256(JSON.stringify(targets)),
      testInput: false,
    },
    inputs: {
      structuralUnion: {
        artifactKind: UNION_ARTIFACT_KIND,
        bytes: FROZEN_UNION.bytes,
        path: FROZEN_UNION.path,
        reviewerLoginProjectionSha256:
          FROZEN_UNION.reviewerLoginProjectionSha256,
        schemaVersion: 1,
        sha256: FROZEN_UNION.sha256,
      },
    },
    rule: {
      actorEligibilityDecision:
        "not-applied-before-identity-capture",
      actorEligibilityPolicy:
        "not-bound-until-complete-identity-capture",
      actorSurface:
        "all-union-review-and-review-thread-comment-authors",
      captureOrder: "normalized-login-code-unit-ascending",
      normalization: "case-insensitive-login",
      targetCardinality:
        "exactly-one-target-per-normalized-login",
    },
    schemaVersion: 2,
    targets,
  });
  assertPlanSelfConsistency(plan);
  return plan;
}

export function serializeC6LiveMultiLangNeighborActorPlanV2(
  plan: C6LiveMultiLangNeighborActorPlanV2,
): string {
  const parsed = planSchema.parse(plan);
  assertPlanSelfConsistency(parsed);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function parseC6LiveMultiLangNeighborActorPlanV2(
  input: string | Uint8Array,
): C6LiveMultiLangNeighborActorPlanV2 {
  const text = typeof input === "string"
    ? input
    : Buffer.from(input).toString("utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error("C6 neighbor actor plan v2 invalid JSON");
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 neighbor actor plan v2 requires canonical JSON",
    );
  }
  const plan = planSchema.parse(raw);
  assertPlanSelfConsistency(plan);
  return plan;
}

export async function buildC6LiveMultiLangNeighborActorPlanV2(
  input: C6LiveMultiLangNeighborActorPlanV2BuildInput,
): Promise<{
  outputSha256: string;
  plan: C6LiveMultiLangNeighborActorPlanV2;
}> {
  const initial = await readFrozenUnion(input.structuralUnionPath);
  const plan = deriveC6LiveMultiLangNeighborActorPlanV2(
    initial.union,
  );

  await input.testHooks?.beforeTerminalReplay?.();
  const terminal = await readFrozenUnion(input.structuralUnionPath);
  const terminalPlan = deriveC6LiveMultiLangNeighborActorPlanV2(
    terminal.union,
  );
  const serialized =
    serializeC6LiveMultiLangNeighborActorPlanV2(plan);
  if (
    !terminal.bytes.equals(initial.bytes) ||
    serializeC6LiveMultiLangNeighborActorPlanV2(terminalPlan) !==
      serialized
  ) {
    throw new Error(
      "C6 neighbor actor plan v2 input closure changed",
    );
  }
  parseC6LiveMultiLangNeighborActorPlanV2(serialized);
  return {
    outputSha256: sha256(serialized),
    plan,
  };
}

export async function materializeC6LiveMultiLangNeighborActorPlanV2(
  input:
    C6LiveMultiLangNeighborActorPlanV2BuildInput & {
      outputPath: string;
    },
): Promise<{
  outputSha256: string;
  plan: C6LiveMultiLangNeighborActorPlanV2;
}> {
  const result = await buildC6LiveMultiLangNeighborActorPlanV2(input);
  const serialized =
    serializeC6LiveMultiLangNeighborActorPlanV2(result.plan);
  const outputPath = resolve(input.outputPath);
  const outputParent = await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 neighbor actor plan v2 output parent",
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
          "C6 neighbor actor plan v2 temporary output identity mismatch",
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
      "C6 neighbor actor plan v2 temporary output",
    );
    if (temporaryBytes.toString("utf8") !== serialized) {
      throw new Error(
        "C6 neighbor actor plan v2 temporary output mismatch",
      );
    }
    await assertC6NoSymlinkPathComponents(
      outputParent,
      "C6 neighbor actor plan v2 terminal output parent",
    );
    await link(temporaryPath, outputPath);
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });

    await input.testHooks?.afterOutputPublication?.();
    const replayed =
      await buildC6LiveMultiLangNeighborActorPlanV2({
        structuralUnionPath: input.structuralUnionPath,
      });
    if (
      replayed.outputSha256 !== result.outputSha256 ||
      serializeC6LiveMultiLangNeighborActorPlanV2(
        replayed.plan,
      ) !== serialized
    ) {
      throw new Error(
        "C6 neighbor actor plan v2 post-publication replay mismatch",
      );
    }
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });
    const publishedBytes = await readC6StableRegularFile(
      outputPath,
      "C6 neighbor actor plan v2 published output",
    );
    if (
      serializeC6LiveMultiLangNeighborActorPlanV2(
        parseC6LiveMultiLangNeighborActorPlanV2(publishedBytes),
      ) !== serialized
    ) {
      throw new Error(
        "C6 neighbor actor plan v2 published output mismatch",
      );
    }
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });
    if (!await removePathIfOwned(temporaryPath, ownedIdentity)) {
      throw new Error(
        "C6 neighbor actor plan v2 temporary output cleanup mismatch",
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

interface FrozenUnion {
  bytes: Buffer;
  union: C6LiveMultiLangNeighborStructuralUnion;
}

interface OwnedFileIdentity {
  dev: number;
  ino: number;
}

async function readFrozenUnion(pathInput: string): Promise<FrozenUnion> {
  const path = await assertC6NoSymlinkPathComponents(
    pathInput,
    "C6 neighbor actor plan v2 structural union",
  );
  const bytes = await readC6StableRegularFile(
    path,
    "C6 neighbor actor plan v2 structural union",
  );
  if (
    basename(path) !== FROZEN_UNION.path ||
    bytes.byteLength !== FROZEN_UNION.bytes ||
    sha256(bytes) !== FROZEN_UNION.sha256
  ) {
    throw new Error(
      "C6 neighbor actor plan v2 structural union hash mismatch",
    );
  }
  return {
    bytes,
    union: parseC6LiveMultiLangNeighborStructuralUnion(bytes),
  };
}

function canonicalFrozenUnion(
  union: C6LiveMultiLangNeighborStructuralUnion,
): C6LiveMultiLangNeighborStructuralUnion {
  const serialized =
    serializeC6LiveMultiLangNeighborStructuralUnion(union);
  if (
    Buffer.byteLength(serialized) !== FROZEN_UNION.bytes ||
    sha256(serialized) !== FROZEN_UNION.sha256
  ) {
    throw new Error(
      "C6 neighbor actor plan v2 structural union hash mismatch",
    );
  }
  return parseC6LiveMultiLangNeighborStructuralUnion(serialized);
}

function assertReviewerLoginClosure(
  union: C6LiveMultiLangNeighborStructuralUnion,
): void {
  const reconstructed = [...new Set(
    union.reviewerActorOccurrences.map((occurrence) =>
      normalizeLogin(occurrence.actorLogin)
    ),
  )].sort(compareStrings);
  if (
    JSON.stringify(union.reviewerLogins) !==
      JSON.stringify(reconstructed) ||
    union.reviewerLogins.length !== FROZEN_UNION.uniqueActorCount ||
    union.counts.reviewerUniqueLoginCount !==
      FROZEN_UNION.uniqueActorCount ||
    union.counts.reviewerActorOccurrenceCount !==
      FROZEN_UNION.sourceReviewReferenceCount ||
    union.counts.targetCount !== FROZEN_UNION.sourceTargetCount ||
    union.independenceBoundary.reviewerLoginProjectionSha256 !==
      FROZEN_UNION.reviewerLoginProjectionSha256 ||
    sha256(JSON.stringify(union.reviewerLogins)) !==
      FROZEN_UNION.reviewerLoginProjectionSha256
  ) {
    throw new Error(
      "C6 neighbor actor plan v2 reviewer login closure mismatch",
    );
  }
}

function assertPlanSelfConsistency(
  plan: C6LiveMultiLangNeighborActorPlanV2,
): void {
  const logins = plan.targets.map((target) => target.login);
  const expectedLogins = [...new Set(logins)].sort(compareStrings);
  for (const [index, target] of plan.targets.entries()) {
    if (
      target.captureOrder !== index + 1 ||
      target.captureDirectory !== `actor-${sha256(target.login)}`
    ) {
      throw new Error(
        "C6 neighbor actor plan v2 target order mismatch",
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
    plan.inputs.structuralUnion
      .reviewerLoginProjectionSha256 !==
        plan.independenceBoundary.reviewerLoginProjectionSha256
  ) {
    throw new Error(
      "C6 neighbor actor plan v2 self-consistency mismatch",
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
      "C6 neighbor actor plan v2 published output ownership mismatch",
    );
  }
}

async function removePathIfOwned(
  path: string,
  ownedIdentity: OwnedFileIdentity,
): Promise<boolean> {
  let pathStat;
  try {
    pathStat = await lstat(path);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
  if (
    !pathStat.isFile() ||
    pathStat.isSymbolicLink() ||
    pathStat.dev !== ownedIdentity.dev ||
    pathStat.ino !== ownedIdentity.ino
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

function normalizeLogin(value: string): string {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    /[/\s]/u.test(value)
  ) {
    throw new Error(
      `C6 neighbor actor plan v2 invalid login ${value}`,
    );
  }
  return value.toLowerCase();
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
