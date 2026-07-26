import { createHash } from "node:crypto";

import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const oidSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
const trimmedStringSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "value cannot be whitespace-padded",
);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().positive(),
  path: trimmedStringSchema,
  sha256: sha256Schema,
}).strict();
const originReferenceSchema = artifactReferenceSchema.extend({
  format: z.literal("github-issue-api-json-v2"),
  path: trimmedStringSchema.refine(
    isUpstreamReceiptPath,
    "upstream receipt path is invalid",
  ),
}).strict();
const completionReferenceSchema = artifactReferenceSchema.extend({
  format: z.literal("github-pull-request-api-json-v1"),
  path: trimmedStringSchema.refine(
    isUpstreamReceiptPath,
    "upstream receipt path is invalid",
  ),
}).strict();
const commitReferenceSchema = artifactReferenceSchema.extend({
  oid: oidSchema,
  path: trimmedStringSchema.refine(
    (value) =>
      isNormalizedRelativePath(value) &&
      value.startsWith(
        "provenance/task-origin/repository-objects/",
      ) &&
      value.endsWith(".commit"),
    "Git commit object path is invalid",
  ),
}).strict();
const receiptSchema = z.object({
  commitPath: z.array(commitReferenceSchema).min(1),
  edgeId: trimmedStringSchema,
  episodeId: trimmedStringSchema,
  laterRequest: originReferenceSchema,
  laterStageId: trimmedStringSchema,
  priorCompletion: completionReferenceSchema,
  priorRequest: originReferenceSchema,
  priorStageId: trimmedStringSchema,
  schemaVersion: z.literal(1),
}).strict();
const githubIssueSchema = z.object({
  body: z.string(),
  created_at: z.iso.datetime(),
  html_url: z.url(),
  node_id: trimmedStringSchema,
  number: z.number().int().positive(),
  repository_url: z.url(),
  updated_at: z.iso.datetime(),
});
const githubPullSchema = z.object({
  html_url: z.url(),
  merge_commit_sha: oidSchema,
  merged: z.literal(true),
  merged_at: z.iso.datetime(),
  node_id: trimmedStringSchema,
  number: z.number().int().positive(),
  repository_url: z.url(),
});

export interface C6TaskRelationshipArtifactReference {
  bytes: number;
  path: string;
  sha256: string;
}

export interface C6TaskRelationshipEvidence {
  commitPathSha256: string;
  edgeId: string;
  episodeId: string;
  laterBaseCommit: string;
  laterRequestAt: string;
  laterStageId: string;
  priorCompletionAt: string;
  priorMergeCommit: string;
  priorStageId: string;
  relationshipReceiptSha256: string;
}

export function listC6TaskRelationshipArtifactReferences(
  receiptBytes: string | Uint8Array,
): C6TaskRelationshipArtifactReference[] {
  const bytes = typeof receiptBytes === "string"
    ? Buffer.from(receiptBytes)
    : Buffer.from(receiptBytes);
  const receipt = parseCanonicalReceipt(bytes);
  return [
    receipt.priorRequest,
    receipt.priorCompletion,
    receipt.laterRequest,
    ...receipt.commitPath,
  ];
}

export function validateC6TaskRelationshipReceipt(input: {
  artifactsByPath: ReadonlyMap<string, Uint8Array>;
  episodeId: string;
  laterBaseCommit: string;
  laterStageId: string;
  laterStageOrigin: C6TaskRelationshipArtifactReference;
  priorStageId: string;
  priorStageOrigin: C6TaskRelationshipArtifactReference;
  receiptBytes: string | Uint8Array;
  repositoryUrl: string;
}): C6TaskRelationshipEvidence {
  const receiptBytes = typeof input.receiptBytes === "string"
    ? Buffer.from(input.receiptBytes)
    : Buffer.from(input.receiptBytes);
  const receipt = parseCanonicalReceipt(receiptBytes);
  const expectedEdgeId =
    `${input.episodeId}/${input.priorStageId}->${input.laterStageId}`;
  if (
    receipt.episodeId !== input.episodeId ||
    receipt.priorStageId !== input.priorStageId ||
    receipt.laterStageId !== input.laterStageId ||
    receipt.edgeId !== expectedEdgeId
  ) {
    throw new Error("C6 task relationship receipt edge identity mismatch");
  }
  if (!sameReference(receipt.priorRequest, input.priorStageOrigin)) {
    throw new Error(
      "C6 task relationship prior request does not match the prior stage origin",
    );
  }
  if (!sameReference(receipt.laterRequest, input.laterStageOrigin)) {
    throw new Error(
      "C6 task relationship later request does not match the later stage origin",
    );
  }
  for (const reference of [
    receipt.priorRequest,
    receipt.priorCompletion,
    receipt.laterRequest,
  ]) {
    if (
      !reference.path.startsWith(
        "provenance/task-origin/upstream-receipts/",
      ) ||
      !reference.path.endsWith(".json") ||
      !isNormalizedRelativePath(reference.path)
    ) {
      throw new Error(
        "C6 task relationship upstream receipt path is invalid",
      );
    }
  }

  const priorRequest = parseArtifact(
    readReferencedArtifact(
      input.artifactsByPath,
      receipt.priorRequest,
    ),
    githubIssueSchema,
    "prior request",
  );
  const priorCompletion = parseArtifact(
    readReferencedArtifact(
      input.artifactsByPath,
      receipt.priorCompletion,
    ),
    githubPullSchema,
    "prior completion",
  );
  const laterRequest = parseArtifact(
    readReferencedArtifact(
      input.artifactsByPath,
      receipt.laterRequest,
    ),
    githubIssueSchema,
    "later request",
  );
  const repositoryUrl = normalizeRepositoryUrl(input.repositoryUrl);
  for (const sourceRepository of [
    repositoryUrlFromReceipt(priorRequest, "issues"),
    repositoryUrlFromReceipt(priorCompletion, "pull"),
    repositoryUrlFromReceipt(laterRequest, "issues"),
  ]) {
    if (sourceRepository !== repositoryUrl) {
      throw new Error(
        "C6 task relationship source repository does not match the episode",
      );
    }
  }
  if (
    priorRequest.node_id === laterRequest.node_id ||
    priorRequest.number === laterRequest.number ||
    priorRequest.html_url === laterRequest.html_url
  ) {
    throw new Error(
      "C6 task relationship prior and later requests must be distinct",
    );
  }
  if (
    Date.parse(priorRequest.created_at) !==
      Date.parse(priorRequest.updated_at) ||
    Date.parse(laterRequest.created_at) !==
      Date.parse(laterRequest.updated_at)
  ) {
    throw new Error(
      "C6 task relationship request was modified after creation",
    );
  }
  if (
    Date.parse(priorRequest.created_at) >=
      Date.parse(priorCompletion.merged_at) ||
    Date.parse(priorCompletion.merged_at) >=
      Date.parse(laterRequest.created_at)
  ) {
    throw new Error(
      "C6 task relationship prior completion must precede later request",
    );
  }

  const laterBaseCommit = oidSchema.parse(input.laterBaseCommit);
  if (
    priorCompletion.merge_commit_sha.length !== laterBaseCommit.length ||
    receipt.commitPath.some((reference) =>
      reference.oid.length !== laterBaseCommit.length
    )
  ) {
    throw new Error(
      "C6 task relationship Git commit path mixes object formats",
    );
  }
  if (
    receipt.commitPath[0]?.oid !== laterBaseCommit ||
    receipt.commitPath.at(-1)?.oid !==
      priorCompletion.merge_commit_sha
  ) {
    throw new Error(
      "C6 task relationship Git commit path endpoints do not match",
    );
  }
  const commitBodies = receipt.commitPath.map((reference) => {
    if (
      reference.path !==
        `provenance/task-origin/repository-objects/${reference.oid}.commit`
    ) {
      throw new Error(
        "C6 task relationship Git commit object path does not match its OID",
      );
    }
    const bytes = readReferencedArtifact(
      input.artifactsByPath,
      reference,
    );
    if (gitObjectOid(bytes, reference.oid.length) !== reference.oid) {
      throw new Error(
        "C6 task relationship Git commit object OID does not match raw bytes",
      );
    }
    return bytes;
  });
  for (let index = 0; index < commitBodies.length - 1; index += 1) {
    const nextOid = receipt.commitPath[index + 1]!.oid;
    if (!gitCommitParents(commitBodies[index]!).includes(nextOid)) {
      throw new Error(
        "C6 task relationship Git commit path is not an ancestry chain",
      );
    }
  }

  return {
    commitPathSha256: sha256(JSON.stringify(receipt.commitPath)),
    edgeId: receipt.edgeId,
    episodeId: receipt.episodeId,
    laterBaseCommit,
    laterRequestAt: laterRequest.created_at,
    laterStageId: receipt.laterStageId,
    priorCompletionAt: priorCompletion.merged_at,
    priorMergeCommit: priorCompletion.merge_commit_sha,
    priorStageId: receipt.priorStageId,
    relationshipReceiptSha256: sha256(receiptBytes),
  };
}

export function assertC6TaskRelationshipEdgeCoverage(input: {
  edges: ReadonlyArray<Pick<
    C6TaskRelationshipEvidence,
    "edgeId" | "episodeId" | "laterStageId" | "priorStageId"
  >>;
  episodeId: string;
  stageIds: readonly string[];
}): void {
  if (
    input.stageIds.length < 2 ||
    new Set(input.stageIds).size !== input.stageIds.length ||
    input.stageIds.some((stageId) =>
      stageId.length === 0 || stageId.trim() !== stageId
    )
  ) {
    throw new Error(
      "C6 task relationship coverage requires ordered unique stage IDs",
    );
  }
  const expected = input.stageIds.slice(1).map((laterStageId, index) => ({
    edgeId:
      `${input.episodeId}/${input.stageIds[index]}->${laterStageId}`,
    episodeId: input.episodeId,
    laterStageId,
    priorStageId: input.stageIds[index]!,
  }));
  const actual = input.edges.map((edge) => ({
    edgeId: edge.edgeId,
    episodeId: edge.episodeId,
    laterStageId: edge.laterStageId,
    priorStageId: edge.priorStageId,
  }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      "C6 task relationship edges do not cover adjacent stages",
    );
  }
}

function parseCanonicalReceipt(bytes: Buffer): z.infer<typeof receiptSchema> {
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("C6 task relationship receipt is invalid JSON");
  }
  if (bytes.toString("utf8") !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error("C6 task relationship receipt requires canonical JSON");
  }
  return receiptSchema.parse(raw);
}

function readReferencedArtifact(
  artifactsByPath: ReadonlyMap<string, Uint8Array>,
  reference: C6TaskRelationshipArtifactReference,
): Buffer {
  const bytes = artifactsByPath.get(reference.path);
  if (
    bytes === undefined ||
    bytes.byteLength !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(
      `C6 task relationship artifact ${reference.path} does not match`,
    );
  }
  return Buffer.from(bytes);
}

function parseArtifact<T>(
  bytes: Buffer,
  schema: z.ZodType<T>,
  label: string,
): T {
  try {
    return schema.parse(JSON.parse(bytes.toString("utf8")) as unknown);
  } catch {
    throw new Error(`C6 task relationship ${label} is invalid`);
  }
}

function sameReference(
  left: C6TaskRelationshipArtifactReference,
  right: C6TaskRelationshipArtifactReference,
): boolean {
  return (
    left.bytes === right.bytes &&
    left.path === right.path &&
    left.sha256 === right.sha256
  );
}

function repositoryUrlFromReceipt(input: {
  html_url: string;
  number: number;
  repository_url: string;
}, expectedKind: "issues" | "pull"): string {
  const api = new URL(input.repository_url);
  const html = new URL(input.html_url);
  const apiParts = api.pathname.split("/").filter(Boolean);
  const htmlParts = html.pathname.split("/").filter(Boolean);
  if (
    api.protocol !== "https:" ||
    api.hostname !== "api.github.com" ||
    api.port.length > 0 ||
    api.username.length > 0 ||
    api.password.length > 0 ||
    api.search.length > 0 ||
    api.hash.length > 0 ||
    apiParts.length !== 3 ||
    apiParts[0] !== "repos" ||
    html.protocol !== "https:" ||
    html.hostname !== "github.com" ||
    html.port.length > 0 ||
    html.username.length > 0 ||
    html.password.length > 0 ||
    html.search.length > 0 ||
    html.hash.length > 0 ||
    htmlParts.length !== 4 ||
    htmlParts[2] !== expectedKind ||
    htmlParts[3] !== String(input.number) ||
    apiParts[1] !== htmlParts[0] ||
    apiParts[2] !== htmlParts[1]
  ) {
    throw new Error("C6 task relationship GitHub locator is invalid");
  }
  return `https://github.com/${apiParts[1]}/${apiParts[2]}.git`;
}

function normalizeRepositoryUrl(value: string): string {
  const parsed = new URL(value);
  const pathParts = parsed.pathname.split("/").filter(Boolean);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.port.length > 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    pathParts.length !== 2
  ) {
    throw new Error("C6 task relationship repository URL is invalid");
  }
  const repository = pathParts[1]!.replace(/\.git$/u, "");
  if (repository.length === 0) {
    throw new Error("C6 task relationship repository URL is invalid");
  }
  return `https://github.com/${pathParts[0]}/${repository}.git`;
}

function isUpstreamReceiptPath(value: string): boolean {
  return (
    isNormalizedRelativePath(value) &&
    value.startsWith("provenance/task-origin/upstream-receipts/") &&
    value.endsWith(".json")
  );
}

function isNormalizedRelativePath(value: string): boolean {
  return (
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((part) =>
      part.length > 0 && part !== "." && part !== ".."
    )
  );
}

function gitObjectOid(bytes: Buffer, oidLength: number): string {
  const algorithm = oidLength === 40 ? "sha1" : "sha256";
  return createHash(algorithm)
    .update(`commit ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function gitCommitParents(bytes: Buffer): string[] {
  const headers = bytes.toString("utf8").split("\n\n", 1)[0] ?? "";
  return headers
    .split("\n")
    .filter((line) => line.startsWith("parent "))
    .map((line) => oidSchema.parse(line.slice("parent ".length)));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
