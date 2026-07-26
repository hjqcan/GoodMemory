import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
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
  C6_REVIEWER_ACTOR_POLICY_V1,
  serializeC6ReviewerActorPolicy,
} from "./c6-reviewer-actor-policy";

const ARTIFACT_KIND = "c6-reviewer-actor-identity-plan";
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const qualificationResultSchema = z.object({
  captureDirectory: z.string().min(1),
  captureOrder: z.number().int().positive(),
}).passthrough();
const multilingualQualificationSchema = z.object({
  artifactKind: z.literal(
    "c6-multilingual-source-expansion-qualification",
  ),
  counts: z.object({
    targetCount: z.number().int().positive(),
  }).passthrough(),
  inputs: z.object({
    graphqlRootSha256: sha256Schema,
  }).passthrough(),
  results: z.array(qualificationResultSchema).min(1),
  schemaVersion: z.literal(1),
}).passthrough();
const restQualificationSchema = z.object({
  artifactKind: z.literal(
    "c6-source-expansion-rest-qualification-v2",
  ),
  counts: z.object({
    targetCount: z.number().int().positive(),
  }).passthrough(),
  inputs: z.object({
    graphqlRootSha256: sha256Schema,
  }).passthrough(),
  results: z.array(qualificationResultSchema).min(1),
  schemaVersion: z.literal(2),
}).passthrough();
const qualificationSchema = z.union([
  multilingualQualificationSchema,
  restQualificationSchema,
]);
const pageSchema = z.object({
  nodes: z.array(z.object({
    author: z.object({
      login: z.string().min(1),
    }).passthrough().nullable(),
  }).passthrough().nullable()),
}).passthrough();
const graphqlSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        reviews: pageSchema,
        reviewThreads: z.object({
          nodes: z.array(z.object({
            comments: pageSchema,
          }).passthrough().nullable()),
        }).passthrough(),
      }).passthrough(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

export interface C6ReviewerActorIdentityPlanTarget {
  captureDirectory: string;
  captureOrder: number;
  login: string;
}

export interface C6ReviewerActorIdentityPlan {
  artifactKind: typeof ARTIFACT_KIND;
  boundary: {
    acceptedEpisodeCount: 0;
    actorCaptureExecuted: false;
    candidateManifestFrozen: false;
    codexRunReady: false;
    status: "reviewer-actor-identity-capture-required";
  };
  counts: {
    sourceReviewReferenceCount: number;
    sourceTargetCount: number;
    uniqueActorCount: number;
  };
  independenceBoundary: {
    goldInput: false;
    machineOutcomeInput: false;
    semanticLedgerInput: false;
    selectedSequenceInput: false;
    targetProjectionSha256: string;
  };
  inputs: {
    graphqlRootSha256: string;
    qualification: {
      bytes: number;
      path: string;
      sha256: string;
    };
  };
  policy: {
    definition: typeof C6_REVIEWER_ACTOR_POLICY_V1;
    policyId: "reviewer-platform-actor-eligibility-v1";
    schemaVersion: 1;
    sha256: string;
  };
  rule: {
    actorSurface:
      "all-non-null-whole-review-and-review-thread-comment-authors";
    captureOrder: "normalized-login-code-unit-ascending";
    normalization: "case-insensitive-login";
  };
  schemaVersion: 1;
  targets: C6ReviewerActorIdentityPlanTarget[];
}

export function deriveC6ReviewerActorIdentityPlan(input: {
  authors: readonly string[];
  graphqlRootSha256: string;
  qualificationBytes: number;
  qualificationPath: string;
  qualificationSha256: string;
  sourceTargetCount: number;
}): C6ReviewerActorIdentityPlan {
  const graphqlRootSha256 = sha256Schema.parse(
    input.graphqlRootSha256,
  );
  const qualificationSha256 = sha256Schema.parse(
    input.qualificationSha256,
  );
  if (
    !Number.isSafeInteger(input.qualificationBytes) ||
    input.qualificationBytes <= 0 ||
    !Number.isSafeInteger(input.sourceTargetCount) ||
    input.sourceTargetCount <= 0
  ) {
    throw new Error("C6 reviewer actor plan invalid input counts");
  }
  const normalizedAuthors = input.authors.map(normalizeAuthor);
  const targets = [...new Set(normalizedAuthors)]
    .sort(compareStrings)
    .map((login, index) => ({
      captureDirectory: `actor-${sha256(login)}`,
      captureOrder: index + 1,
      login,
    }));
  if (targets.length === 0) {
    throw new Error("C6 reviewer actor plan requires at least one actor");
  }
  return {
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      candidateManifestFrozen: false,
      codexRunReady: false,
      status: "reviewer-actor-identity-capture-required",
    },
    counts: {
      sourceReviewReferenceCount: normalizedAuthors.length,
      sourceTargetCount: input.sourceTargetCount,
      uniqueActorCount: targets.length,
    },
    independenceBoundary: {
      goldInput: false,
      machineOutcomeInput: false,
      semanticLedgerInput: false,
      selectedSequenceInput: false,
      targetProjectionSha256: sha256(JSON.stringify(targets)),
    },
    inputs: {
      graphqlRootSha256,
      qualification: {
        bytes: input.qualificationBytes,
        path: basename(input.qualificationPath),
        sha256: qualificationSha256,
      },
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
    },
    schemaVersion: 1,
    targets,
  };
}

export function serializeC6ReviewerActorIdentityPlan(
  plan: C6ReviewerActorIdentityPlan,
): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export async function buildC6ReviewerActorIdentityPlan(input: {
  expectedGraphqlRootSha256: string;
  expectedQualificationSha256: string;
  graphqlRoot: string;
  qualificationPath: string;
  testHooks?: {
    beforeTerminalVerification?: () => Promise<void> | void;
  };
}): Promise<{
  outputSha256: string;
  plan: C6ReviewerActorIdentityPlan;
}> {
  const expectedGraphqlRootSha256 = sha256Schema.parse(
    input.expectedGraphqlRootSha256,
  );
  const expectedQualificationSha256 = sha256Schema.parse(
    input.expectedQualificationSha256,
  );
  const [graphqlRoot, qualificationPath] = await Promise.all([
    assertC6NoSymlinkPathComponents(
      input.graphqlRoot,
      "C6 reviewer actor plan GraphQL root",
    ),
    assertC6NoSymlinkPathComponents(
      input.qualificationPath,
      "C6 reviewer actor plan qualification",
    ),
  ]);
  const [graphqlLock, qualificationBytes] = await Promise.all([
    buildC6AssetLock(graphqlRoot),
    readC6StableRegularFile(
      qualificationPath,
      "reviewer actor plan qualification",
    ),
  ]);
  if (
    graphqlLock.assetRootSha256 !== expectedGraphqlRootSha256 ||
    sha256(qualificationBytes) !== expectedQualificationSha256
  ) {
    throw new Error("C6 reviewer actor plan input hash mismatch");
  }
  const qualification = qualificationSchema.parse(
    parseJson(qualificationBytes, "qualification"),
  );
  if (
    qualification.inputs.graphqlRootSha256 !==
      expectedGraphqlRootSha256 ||
    qualification.results.length !== qualification.counts.targetCount
  ) {
    throw new Error(
      "C6 reviewer actor plan qualification binding mismatch",
    );
  }
  assertQualificationOrder(qualification.results);
  const files = new Map(
    graphqlLock.files.map((file) => [file.path, file]),
  );
  const authors: string[] = [];
  for (const result of qualification.results) {
    const path = `${result.captureDirectory}/response.json`;
    const bytes = await readBoundFile(graphqlRoot, path, files);
    const pull = graphqlSchema.parse(
      parseJson(bytes, "GraphQL response"),
    ).data.repository.pullRequest;
    for (const review of pull.reviews.nodes) {
      if (review?.author !== null && review?.author !== undefined) {
        authors.push(review.author.login);
      }
    }
    for (const thread of pull.reviewThreads.nodes) {
      if (thread === null) {
        continue;
      }
      for (const comment of thread.comments.nodes) {
        if (
          comment?.author !== null &&
          comment?.author !== undefined
        ) {
          authors.push(comment.author.login);
        }
      }
    }
  }
  const plan = deriveC6ReviewerActorIdentityPlan({
    authors,
    graphqlRootSha256: expectedGraphqlRootSha256,
    qualificationBytes: qualificationBytes.byteLength,
    qualificationPath,
    qualificationSha256: expectedQualificationSha256,
    sourceTargetCount: qualification.results.length,
  });

  await input.testHooks?.beforeTerminalVerification?.();
  const [terminalGraphqlLock, terminalQualificationBytes] =
    await Promise.all([
      buildC6AssetLock(graphqlRoot),
      readC6StableRegularFile(
        qualificationPath,
        "reviewer actor plan terminal qualification",
      ),
    ]);
  if (
    serializeC6AssetLock(terminalGraphqlLock) !==
      serializeC6AssetLock(graphqlLock) ||
    !terminalQualificationBytes.equals(qualificationBytes)
  ) {
    throw new Error(
      "C6 reviewer actor plan input closure changed during projection",
    );
  }
  const serialized = serializeC6ReviewerActorIdentityPlan(plan);
  return {
    outputSha256: sha256(serialized),
    plan,
  };
}

export async function materializeC6ReviewerActorIdentityPlan(input: {
  expectedGraphqlRootSha256: string;
  expectedQualificationSha256: string;
  graphqlRoot: string;
  outputPath: string;
  qualificationPath: string;
}): Promise<{
  outputSha256: string;
  plan: C6ReviewerActorIdentityPlan;
}> {
  const result = await buildC6ReviewerActorIdentityPlan(input);
  const outputPath = resolve(input.outputPath);
  await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 reviewer actor plan output parent",
  );
  const handle = await open(outputPath, "wx", 0o644);
  try {
    await handle.writeFile(
      serializeC6ReviewerActorIdentityPlan(result.plan),
      "utf8",
    );
  } finally {
    await handle.close();
  }
  return result;
}

export async function replayC6ReviewerActorIdentityPlan(input: {
  expectedGraphqlRootSha256: string;
  expectedPlanSha256: string;
  expectedQualificationSha256: string;
  graphqlRoot: string;
  planPath: string;
  qualificationPath: string;
}): Promise<{
  plan: C6ReviewerActorIdentityPlan;
  reproduced: true;
}> {
  const expectedPlanSha256 = sha256Schema.parse(
    input.expectedPlanSha256,
  );
  const planPath = await assertC6NoSymlinkPathComponents(
    input.planPath,
    "C6 reviewer actor plan artifact",
  );
  const planBytes = await readC6StableRegularFile(
    planPath,
    "reviewer actor plan artifact",
  );
  if (sha256(planBytes) !== expectedPlanSha256) {
    throw new Error("C6 reviewer actor plan artifact hash mismatch");
  }
  const result = await buildC6ReviewerActorIdentityPlan(input);
  if (
    serializeC6ReviewerActorIdentityPlan(result.plan) !==
      planBytes.toString("utf8")
  ) {
    throw new Error(
      "C6 reviewer actor plan projection does not match recomputation",
    );
  }
  const terminalPlanBytes = await readC6StableRegularFile(
    planPath,
    "reviewer actor plan terminal artifact",
  );
  if (!terminalPlanBytes.equals(planBytes)) {
    throw new Error(
      "C6 reviewer actor plan artifact changed during replay",
    );
  }
  return { plan: result.plan, reproduced: true };
}

function assertQualificationOrder(
  results: readonly z.infer<typeof qualificationResultSchema>[],
): void {
  let prior = 0;
  const directories = new Set<string>();
  for (const result of results) {
    if (
      result.captureOrder <= prior ||
      directories.has(result.captureDirectory)
    ) {
      throw new Error(
        "C6 reviewer actor plan qualification order mismatch",
      );
    }
    prior = result.captureOrder;
    directories.add(result.captureDirectory);
  }
}

async function readBoundFile(
  root: string,
  path: string,
  files: ReadonlyMap<string, C6AssetLock["files"][number]>,
): Promise<Buffer> {
  const reference = files.get(path);
  if (reference === undefined) {
    throw new Error(
      `C6 reviewer actor plan missing GraphQL response ${path}`,
    );
  }
  const bytes = await readC6StableRegularFile(
    join(root, ...path.split("/")),
    "reviewer actor plan GraphQL response",
  );
  if (
    bytes.byteLength !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(
      `C6 reviewer actor plan changed GraphQL response ${path}`,
    );
  }
  return bytes;
}

function normalizeAuthor(value: string): string {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    /[/\s]/u.test(value)
  ) {
    throw new Error(`C6 reviewer actor plan invalid author ${value}`);
  }
  return value.toLowerCase();
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(`C6 reviewer actor plan invalid ${label} JSON`);
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
