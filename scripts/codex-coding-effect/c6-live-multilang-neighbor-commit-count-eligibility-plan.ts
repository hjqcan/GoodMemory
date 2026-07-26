import { createHash, randomUUID } from "node:crypto";
import { link, lstat, open, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";

const ARTIFACT_KIND =
  "c6-live-multilang-neighbor-commit-count-eligibility-plan";
const ENDPOINT = "https://api.github.com/graphql";
const SOURCE_PLAN_KIND =
  "c6-live-multilang-neighbor-deep-capture-plan";
const SOURCE_PLAN_BASENAME =
  "swe-bench-live-multilang-608f7ae9.neighbor-deep-capture-plan-v2.json";
const SOURCE_PLAN_BYTES = 485_101;
const SOURCE_PLAN_SHA256 =
  "9af58b2033aa67d8bb1d056ff0f56fe8db9c1b0c7a75f73ed1a6a784ad0f4472";
const SOURCE_TARGET_PROJECTION_SHA256 =
  "9b1249a93f2878c41d258cdb2212facf26e4c810f2ed7322d1fcd23fe867eacf";
const TARGET_COUNT = 643;
export const C6_LIVE_MULTILANG_NEIGHBOR_PLATFORM_COMMIT_CAP = 250;

const FORBIDDEN_SELECTION_INPUTS = [
  "body",
  "title",
  "files",
  "diff",
  "patch",
  "test",
  "gold",
  "check",
  "outcome",
  "message",
] as const;

export const C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY =
  `query C6NeighborCommitCountEligibility($owner: String!, $name: String!, $number: Int!) {
  rateLimit {
    cost
    remaining
    resetAt
  }
  repository(owner: $owner, name: $name) {
    id
    nameWithOwner
    pullRequest(number: $number) {
      id
      number
      url
      commits(first: 1) {
        totalCount
      }
    }
  }
}`;

export const C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY_POLICY =
  {
    allowedResponsePaths: [
      "rateLimit.cost",
      "rateLimit.remaining",
      "rateLimit.resetAt",
      "repository.id",
      "repository.nameWithOwner",
      "repository.pullRequest.id",
      "repository.pullRequest.number",
      "repository.pullRequest.url",
      "repository.pullRequest.commits.totalCount",
    ],
    endpoint: ENDPOINT,
    forbiddenSelectionInputs: FORBIDDEN_SELECTION_INPUTS,
    oneLogicalRequestPerTarget: true,
    outcomeBlind: true,
    platformCommitCap:
      C6_LIVE_MULTILANG_NEIGHBOR_PLATFORM_COMMIT_CAP,
    policyId:
      "c6-live-multilang-neighbor-commit-count-eligibility-v1",
    schemaVersion: 1,
    targetOrder: "frozen-source-plan-order",
    transportContract: {
      defaultRequestTimeoutMilliseconds: 60_000,
      exponentialBackoffMilliseconds: [1_000, 2_000, 4_000],
      maximumNetworkAttemptsPerTarget: 4,
      maximumRequestTimeoutMilliseconds: 300_000,
      maximumRetryAfterMilliseconds: 60_000,
      retriedTransportPhases: [
        "fetch",
        "body-read",
        "timeout",
      ],
      retryableHttpStatuses: [429, 502, 503, 504],
      transientGraphqlTypes: [
        "INTERNAL",
        "INTERNAL_SERVER_ERROR",
        "RATE_LIMITED",
        "SERVICE_UNAVAILABLE",
        "TIMEOUT",
      ],
    },
  } as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const repositorySchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const anchorSchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*$/u,
);
const sourceSplitSchema = z.enum([
  "c",
  "cpp",
  "go",
  "js",
  "rust",
  "java",
  "ts",
  "cs",
]);
const targetSchema = z.object({
  authorLogin: z.string().min(1).nullable(),
  baseRefOid: commitSchema,
  canonicalAnchorId: anchorSchema,
  canonicalRepository: repositorySchema,
  captureDirectory: z.string().regex(
    /^[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+__[1-9]\d*$/u,
  ),
  captureOrder: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  mergeCommitOid: commitSchema,
  mergedAt: z.iso.datetime(),
  observedReviewCount: z.number().int().nonnegative(),
  observedReviewThreadCount: z.number().int().nonnegative(),
  owner: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  pilotRank: z.number().int().positive(),
  pullNumber: z.number().int().positive(),
  repo: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  responseNodeRank: z.number().int().positive(),
  sourceSplit: sourceSplitSchema,
  url: z.url(),
}).strict();
const sourcePlanSchema = z.object({
  artifactKind: z.literal(SOURCE_PLAN_KIND),
  counts: z.object({
    targetCount: z.literal(TARGET_COUNT),
  }).passthrough(),
  independenceBoundary: z.object({
    targetProjectionSha256: z.literal(
      SOURCE_TARGET_PROJECTION_SHA256,
    ),
  }).passthrough(),
  schemaVersion: z.literal(1),
  targets: z.array(targetSchema).length(TARGET_COUNT),
}).passthrough();
const referenceSchema = z.object({
  artifactKind: z.literal(SOURCE_PLAN_KIND),
  bytes: z.literal(SOURCE_PLAN_BYTES),
  path: z.literal(SOURCE_PLAN_BASENAME),
  schemaVersion: z.literal(1),
  sha256: z.literal(SOURCE_PLAN_SHA256),
  targetProjectionSha256: z.literal(
    SOURCE_TARGET_PROJECTION_SHA256,
  ),
}).strict();
const planSchema = z.object({
  artifactKind: z.literal(ARTIFACT_KIND),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    commitCountCaptureExecuted: z.literal(false),
    machineQualifiedEpisodeCount: z.literal(0),
    semanticallyQualifiedEpisodeCount: z.literal(0),
    status: z.literal("commit-count-eligibility-plan-only"),
  }).strict(),
  counts: z.object({
    expectedRequestCount: z.literal(TARGET_COUNT),
    sourceTargetCount: z.literal(TARGET_COUNT),
  }).strict(),
  independenceBoundary: z.object({
    goldInput: z.literal(false),
    machineOutcomeInput: z.literal(false),
    patchInput: z.literal(false),
    planTargetProjectionSha256: sha256Schema,
    semanticDecisionInput: z.literal(false),
    sourceTargetProjectionSha256: z.literal(
      SOURCE_TARGET_PROJECTION_SHA256,
    ),
    testInput: z.literal(false),
  }).strict(),
  inputs: z.object({
    deepCapturePlan: referenceSchema,
  }).strict(),
  queryContract: z.object({
    endpoint: z.literal(ENDPOINT),
    operationName: z.literal(
      "C6NeighborCommitCountEligibility",
    ),
    policySha256: sha256Schema,
    querySha256: sha256Schema,
  }).strict(),
  registrationBoundary: z.object({
    exploratoryAllTargetCountDiagnosticObserved: z.literal(true),
    frozenBeforeCanonicalCapture: z.literal(true),
    initialPlanV2TransportFailureObserved: z.literal(true),
    preregisteredBeforeExploratoryDiagnostic: z.literal(false),
  }).strict(),
  rule: z.custom<
    typeof C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY_POLICY
  >((value) =>
    JSON.stringify(value) === JSON.stringify(
      C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY_POLICY,
    )
  ),
  schemaVersion: z.literal(1),
  targets: z.array(targetSchema).length(TARGET_COUNT),
}).strict();

export type C6LiveMultiLangNeighborCommitCountEligibilityPlan =
  z.infer<typeof planSchema>;
export type C6LiveMultiLangNeighborCommitCountEligibilityTarget =
  z.infer<typeof targetSchema>;

assertQueryBoundary();

export function deriveC6LiveMultiLangNeighborCommitCountEligibilityPlan(
  input: {
    sourcePlanBytes: Uint8Array;
    sourcePlanPath: string;
  },
): C6LiveMultiLangNeighborCommitCountEligibilityPlan {
  const sourcePlanBytes = Buffer.from(input.sourcePlanBytes);
  if (sha256(sourcePlanBytes) !== SOURCE_PLAN_SHA256) {
    throw new Error("C6 commit-count eligibility source plan hash mismatch");
  }
  const sourcePlan = sourcePlanSchema.parse(
    canonicalJson(sourcePlanBytes, "source plan"),
  );
  if (basename(input.sourcePlanPath) !== SOURCE_PLAN_BASENAME) {
    throw new Error(
      "C6 commit-count eligibility source plan basename mismatch",
    );
  }
  assertSourceTargets(sourcePlan.targets);
  const plan = {
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      commitCountCaptureExecuted: false,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status: "commit-count-eligibility-plan-only",
    },
    counts: {
      expectedRequestCount: TARGET_COUNT,
      sourceTargetCount: TARGET_COUNT,
    },
    independenceBoundary: {
      goldInput: false,
      machineOutcomeInput: false,
      patchInput: false,
      planTargetProjectionSha256: sha256(
        JSON.stringify(sourcePlan.targets),
      ),
      semanticDecisionInput: false,
      sourceTargetProjectionSha256:
        SOURCE_TARGET_PROJECTION_SHA256,
      testInput: false,
    },
    inputs: {
      deepCapturePlan: {
        artifactKind: sourcePlan.artifactKind,
        bytes: sourcePlanBytes.byteLength,
        path: basename(input.sourcePlanPath),
        schemaVersion: sourcePlan.schemaVersion,
        sha256: SOURCE_PLAN_SHA256,
        targetProjectionSha256:
          SOURCE_TARGET_PROJECTION_SHA256,
      },
    },
    queryContract: {
      endpoint: ENDPOINT,
      operationName: "C6NeighborCommitCountEligibility",
      policySha256: sha256(
        serializeC6LiveMultiLangNeighborCommitCountEligibilityQueryPolicy(),
      ),
      querySha256: sha256(
        C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
      ),
    },
    registrationBoundary: {
      exploratoryAllTargetCountDiagnosticObserved: true,
      frozenBeforeCanonicalCapture: true,
      initialPlanV2TransportFailureObserved: true,
      preregisteredBeforeExploratoryDiagnostic: false,
    },
    rule:
      C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY_POLICY,
    schemaVersion: 1,
    targets: sourcePlan.targets,
  } as const;
  return planSchema.parse(plan);
}

export async function buildC6LiveMultiLangNeighborCommitCountEligibilityPlan(
  input: {
    sourcePlanPath: string;
    testHooks?: {
      afterOutputPublication?: () => Promise<void> | void;
      beforeTerminalVerification?: () => Promise<void> | void;
    };
  },
): Promise<{
  outputSha256: string;
  plan: C6LiveMultiLangNeighborCommitCountEligibilityPlan;
}> {
  const sourcePlanPath = await assertC6NoSymlinkPathComponents(
    input.sourcePlanPath,
    "C6 commit-count eligibility source plan",
  );
  const sourcePlanBytes = await readC6StableRegularFile(
    sourcePlanPath,
    "commit-count eligibility source plan",
  );
  const plan =
    deriveC6LiveMultiLangNeighborCommitCountEligibilityPlan({
      sourcePlanBytes,
      sourcePlanPath,
    });
  await input.testHooks?.beforeTerminalVerification?.();
  const terminalBytes = await readC6StableRegularFile(
    sourcePlanPath,
    "commit-count eligibility terminal source plan",
  );
  if (
    !terminalBytes.equals(sourcePlanBytes) ||
    sha256(terminalBytes) !== SOURCE_PLAN_SHA256
  ) {
    throw new Error(
      "C6 commit-count eligibility source plan changed during projection",
    );
  }
  const serialized =
    serializeC6LiveMultiLangNeighborCommitCountEligibilityPlan(plan);
  return {
    outputSha256: sha256(serialized),
    plan,
  };
}

export async function materializeC6LiveMultiLangNeighborCommitCountEligibilityPlan(
  input: Parameters<
    typeof buildC6LiveMultiLangNeighborCommitCountEligibilityPlan
  >[0] & {
    outputPath: string;
  },
): Promise<{
  outputSha256: string;
  plan: C6LiveMultiLangNeighborCommitCountEligibilityPlan;
}> {
  const result =
    await buildC6LiveMultiLangNeighborCommitCountEligibilityPlan(
      input,
    );
  const serialized =
    serializeC6LiveMultiLangNeighborCommitCountEligibilityPlan(
      result.plan,
    );
  const outputPath = resolve(input.outputPath);
  const outputParent = await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 commit-count eligibility plan output parent",
  );
  const temporaryPath = join(
    outputParent,
    `.${basename(outputPath)}.incomplete-${randomUUID()}`,
  );
  let identity: OwnedFileIdentity | null = null;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600) {
        throw new Error(
          "C6 commit-count eligibility temporary output identity mismatch",
        );
      }
      identity = { dev: stat.dev, ino: stat.ino };
      await handle.writeFile(serialized, "utf8");
      await handle.chmod(0o644);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const temporaryBytes = await readC6StableRegularFile(
      temporaryPath,
      "commit-count eligibility temporary output",
    );
    if (temporaryBytes.toString("utf8") !== serialized) {
      throw new Error(
        "C6 commit-count eligibility temporary output mismatch",
      );
    }
    await link(temporaryPath, outputPath);
    await assertOwnedPlanOutput(outputPath, temporaryPath, identity);
    await input.testHooks?.afterOutputPublication?.();
    const replay =
      await buildC6LiveMultiLangNeighborCommitCountEligibilityPlan({
        sourcePlanPath: input.sourcePlanPath,
      });
    if (
      replay.outputSha256 !== result.outputSha256 ||
      serializeC6LiveMultiLangNeighborCommitCountEligibilityPlan(
        replay.plan,
      ) !== serialized
    ) {
      throw new Error(
        "C6 commit-count eligibility post-publication replay mismatch",
      );
    }
    await assertOwnedPlanOutput(outputPath, temporaryPath, identity);
    const outputBytes = await readC6StableRegularFile(
      outputPath,
      "commit-count eligibility published output",
    );
    if (
      outputBytes.toString("utf8") !== serialized ||
      sha256(outputBytes) !== result.outputSha256
    ) {
      throw new Error(
        "C6 commit-count eligibility published output mismatch",
      );
    }
    if (!await removeIfOwned(temporaryPath, identity)) {
      throw new Error(
        "C6 commit-count eligibility temporary cleanup mismatch",
      );
    }
    return result;
  } catch (error) {
    if (identity !== null) {
      await removeIfOwned(outputPath, identity);
      await removeIfOwned(temporaryPath, identity);
    }
    throw error;
  }
}

export function serializeC6LiveMultiLangNeighborCommitCountEligibilityPlan(
  plan: C6LiveMultiLangNeighborCommitCountEligibilityPlan,
): string {
  return `${JSON.stringify(planSchema.parse(plan), null, 2)}\n`;
}

export function parseC6LiveMultiLangNeighborCommitCountEligibilityPlan(
  input: string | Uint8Array,
): C6LiveMultiLangNeighborCommitCountEligibilityPlan {
  const bytes = typeof input === "string"
    ? Buffer.from(input)
    : Buffer.from(input);
  const raw = canonicalJson(bytes, "eligibility plan");
  const plan = planSchema.parse(raw);
  assertSourceTargets(plan.targets);
  if (
    plan.queryContract.querySha256 !==
      sha256(
        C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
      ) ||
    plan.queryContract.policySha256 !==
      sha256(
        serializeC6LiveMultiLangNeighborCommitCountEligibilityQueryPolicy(),
      )
  ) {
    throw new Error(
      "C6 commit-count eligibility plan query contract mismatch",
    );
  }
  if (
    plan.independenceBoundary.planTargetProjectionSha256 !==
      sha256(JSON.stringify(plan.targets))
  ) {
    throw new Error(
      "C6 commit-count eligibility plan target projection mismatch",
    );
  }
  return plan;
}

export function serializeC6LiveMultiLangNeighborCommitCountEligibilityQueryPolicy():
  string {
  return JSON.stringify(
    C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY_POLICY,
  );
}

function assertSourceTargets(
  targets: readonly C6LiveMultiLangNeighborCommitCountEligibilityTarget[],
): void {
  const anchors = new Set<string>();
  const directories = new Set<string>();
  for (const [index, target] of targets.entries()) {
    if (
      target.captureOrder !== index + 1 ||
      target.canonicalRepository !==
        `${target.owner}/${target.repo}`.toLowerCase() ||
      target.canonicalAnchorId !==
        `${target.canonicalRepository}#${target.pullNumber}` ||
      target.captureDirectory !==
        `${target.owner.toLowerCase()}__${
          target.repo.toLowerCase()
        }__${target.pullNumber}` ||
      anchors.has(target.canonicalAnchorId) ||
      directories.has(target.captureDirectory)
    ) {
      throw new Error(
        `C6 commit-count eligibility source target mismatch ${
          index + 1
        }`,
      );
    }
    anchors.add(target.canonicalAnchorId);
    directories.add(target.captureDirectory);
  }
  if (
    sha256(JSON.stringify(targets)) !==
      SOURCE_TARGET_PROJECTION_SHA256
  ) {
    throw new Error(
      "C6 commit-count eligibility source target projection mismatch",
    );
  }
}

function assertQueryBoundary(): void {
  const lowered =
    C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY
      .toLowerCase();
  for (const forbidden of FORBIDDEN_SELECTION_INPUTS) {
    if (lowered.includes(forbidden.toLowerCase())) {
      throw new Error(
        `C6 commit-count eligibility query includes forbidden field ${forbidden}`,
      );
    }
  }
}

function canonicalJson(bytes: Uint8Array, label: string): unknown {
  let raw: unknown;
  const text = Buffer.from(bytes).toString("utf8");
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`C6 commit-count eligibility invalid ${label} JSON`);
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      `C6 commit-count eligibility noncanonical ${label}`,
    );
  }
  return raw;
}

interface OwnedFileIdentity {
  dev: number;
  ino: number;
}

async function assertOwnedPlanOutput(
  outputPath: string,
  temporaryPath: string,
  identity: OwnedFileIdentity,
): Promise<void> {
  const [outputStat, temporaryStat] = await Promise.all([
    lstat(outputPath),
    lstat(temporaryPath),
  ]);
  if (
    !outputStat.isFile() ||
    outputStat.isSymbolicLink() ||
    !temporaryStat.isFile() ||
    temporaryStat.isSymbolicLink() ||
    outputStat.dev !== identity.dev ||
    outputStat.ino !== identity.ino ||
    temporaryStat.dev !== identity.dev ||
    temporaryStat.ino !== identity.ino ||
    (outputStat.mode & 0o7777) !== 0o644 ||
    (temporaryStat.mode & 0o7777) !== 0o644
  ) {
    throw new Error(
      "C6 commit-count eligibility output identity mismatch",
    );
  }
}

async function removeIfOwned(
  path: string,
  identity: OwnedFileIdentity,
): Promise<boolean> {
  try {
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.dev !== identity.dev ||
      stat.ino !== identity.ino
    ) {
      return false;
    }
    await rm(path);
    return true;
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
