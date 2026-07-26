import { createHash } from "node:crypto";
import {
  basename,
  dirname,
  relative,
  resolve,
  sep,
} from "node:path";

import { z } from "zod";

import {
  readC6StableRegularFile,
} from "./c6-asset-lock";
import {
  hashC6SourceV3SimpleNormalizedProjection,
  verifyC6SourceV3SimpleNormalizedPass,
} from "./c6-source-v3-simple-census-core";
import type {
  C6SourceV3SimpleFrameDefinition,
  C6SourceV3SimpleNormalizedPass,
} from "./c6-source-v3-simple-census-core";
import {
  commitC6SourceV3SimpleCreateOnlyCanonicalJson,
} from "./c6-source-v3-simple-census-ledger";
import type {
  C6SourceV3SimpleArtifactReference,
} from "./c6-source-v3-simple-census-ledger";

const sha256Schema = z.string().regex(
  /^[a-f0-9]{64}$/u,
);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const commonSchema = z.object({
  evaluationId: z.string().min(1),
  executionContractSha256: sha256Schema,
  frozenInputClosureSha256: sha256Schema,
  pass: z.enum(["A", "B"]),
  runtimeAuthorizationSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();
const normalizedPassSchema = commonSchema.extend({
  artifactKind: z.literal(
    "c6-source-v3-simple-normalized-pass",
  ),
  normalizedPass: z.unknown(),
}).strict();
const countTreeClosureSchema = commonSchema.extend({
  artifactKind: z.literal(
    "c6-source-v3-simple-count-tree-closure",
  ),
  countTreeCount: z.number().int().nonnegative(),
  normalizedPass: artifactReferenceSchema,
  repositoryLeafClosureCount:
    z.number().int().nonnegative(),
}).strict();
const repositoryClosureSchema = commonSchema.extend({
  artifactKind: z.literal(
    "c6-source-v3-simple-repository-closure",
  ),
  normalizedPass: artifactReferenceSchema,
  repositoryCount: z.number().int().nonnegative(),
  repositoryDecisionCount:
    z.number().int().nonnegative(),
}).strict();
const pullRequestClosureSchema = commonSchema.extend({
  artifactKind: z.literal(
    "c6-source-v3-simple-pull-request-closure",
  ),
  metadataDecisionCount:
    z.number().int().nonnegative(),
  normalizedPass: artifactReferenceSchema,
  pullRequestClosureCount:
    z.number().int().nonnegative(),
  pullRequestCount: z.number().int().nonnegative(),
}).strict();
const normalizedProjectionSchema = commonSchema.extend({
  artifactKind: z.literal(
    "c6-source-v3-simple-normalized-projection",
  ),
  metadataDecisionCount:
    z.number().int().nonnegative(),
  normalizedPass: artifactReferenceSchema,
  normalizedProjectionSha256: sha256Schema,
  pullRequestCount: z.number().int().nonnegative(),
  repositoryCount: z.number().int().nonnegative(),
  repositoryDecisionCount:
    z.number().int().nonnegative(),
}).strict();

export interface C6SourceV3SimplePassArtifactBundle {
  countTreeClosure:
    C6SourceV3SimpleArtifactReference;
  normalizedProjection:
    C6SourceV3SimpleArtifactReference;
  normalizedProjectionSha256: string;
  pullRequestClosure:
    C6SourceV3SimpleArtifactReference;
  repositoryClosure:
    C6SourceV3SimpleArtifactReference;
}

export async function writeC6SourceV3SimplePassArtifactBundle(
  input: {
    assetRoot: string;
    evaluationId: string;
    executionContractSha256: string;
    frozenInputClosureSha256: string;
    frame: C6SourceV3SimpleFrameDefinition;
    normalizedPass: C6SourceV3SimpleNormalizedPass;
    pass: "A" | "B";
    passRoot: string;
    runtimeAuthorizationSha256: string;
  },
): Promise<C6SourceV3SimplePassArtifactBundle> {
  const normalizedPass =
    verifyC6SourceV3SimpleNormalizedPass(
      input.normalizedPass,
      input.frame,
    );
  const common = {
    evaluationId: input.evaluationId,
    executionContractSha256:
      input.executionContractSha256,
    frozenInputClosureSha256:
      input.frozenInputClosureSha256,
    pass: input.pass,
    runtimeAuthorizationSha256:
      input.runtimeAuthorizationSha256,
    schemaVersion: 1 as const,
  };
  const normalizedPassLocal =
    await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
      input.passRoot,
      "normalized-pass.json",
      normalizedPassSchema.parse({
        artifactKind:
          "c6-source-v3-simple-normalized-pass",
        ...common,
        normalizedPass,
      }),
    );
  const normalizedPassReference = rebaseReference(
    input.assetRoot,
    input.passRoot,
    normalizedPassLocal,
  );
  const countTreeClosure =
    await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
      input.passRoot,
      "count-tree-closure.json",
      countTreeClosureSchema.parse({
        artifactKind:
          "c6-source-v3-simple-count-tree-closure",
        ...common,
        countTreeCount:
          normalizedPass.countTrees.length,
        normalizedPass: normalizedPassReference,
        repositoryLeafClosureCount:
          normalizedPass.repositoryLeafClosures.length,
      }),
    );
  const repositoryClosure =
    await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
      input.passRoot,
      "repository-closure.json",
      repositoryClosureSchema.parse({
        artifactKind:
          "c6-source-v3-simple-repository-closure",
        ...common,
        normalizedPass: normalizedPassReference,
        repositoryCount:
          normalizedPass.repositories.length,
        repositoryDecisionCount:
          normalizedPass.repositoryDecisions.length,
      }),
    );
  const pullRequestClosure =
    await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
      input.passRoot,
      "pull-request-closure.json",
      pullRequestClosureSchema.parse({
        artifactKind:
          "c6-source-v3-simple-pull-request-closure",
        ...common,
        metadataDecisionCount:
          normalizedPass.metadataDecisions.length,
        normalizedPass: normalizedPassReference,
        pullRequestClosureCount:
          normalizedPass.pullRequestClosures.length,
        pullRequestCount:
          normalizedPass.pullRequests.length,
      }),
    );
  const normalizedProjectionSha256 =
    hashC6SourceV3SimpleNormalizedProjection(
      normalizedPass,
    );
  const normalizedProjection =
    await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
      input.passRoot,
      "normalized-projection.json",
      normalizedProjectionSchema.parse({
        artifactKind:
          "c6-source-v3-simple-normalized-projection",
        ...common,
        metadataDecisionCount:
          normalizedPass.metadataDecisions.length,
        normalizedPass: normalizedPassReference,
        normalizedProjectionSha256,
        pullRequestCount:
          normalizedPass.pullRequests.length,
        repositoryCount:
          normalizedPass.repositories.length,
        repositoryDecisionCount:
          normalizedPass.repositoryDecisions.length,
      }),
    );
  const localBundle = {
    countTreeClosure,
    normalizedProjection,
    normalizedProjectionSha256,
    pullRequestClosure,
    repositoryClosure,
  };
  await verifyC6SourceV3SimplePassArtifactBundle({
    assetRoot: input.assetRoot,
    bundle: rebaseBundle(
      input.assetRoot,
      input.passRoot,
      localBundle,
    ),
    evaluationId: input.evaluationId,
    executionContractSha256:
      input.executionContractSha256,
    frozenInputClosureSha256:
      input.frozenInputClosureSha256,
    frame: input.frame,
    pass: input.pass,
    runtimeAuthorizationSha256:
      input.runtimeAuthorizationSha256,
  });
  return localBundle;
}

export async function verifyC6SourceV3SimplePassArtifactBundle(
  input: {
    assetRoot: string;
    bundle: C6SourceV3SimplePassArtifactBundle;
    evaluationId: string;
    executionContractSha256: string;
    frozenInputClosureSha256: string;
    frame: C6SourceV3SimpleFrameDefinition;
    pass: "A" | "B";
    runtimeAuthorizationSha256: string;
  },
): Promise<{
  normalizedPass: C6SourceV3SimpleNormalizedPass;
  normalizedProjectionSha256: string;
}> {
  const passDirectory = `pass-${
    input.pass.toLowerCase()
  }`;
  assertExpectedPath(
    input.bundle.countTreeClosure,
    `${passDirectory}/count-tree-closure.json`,
  );
  assertExpectedPath(
    input.bundle.repositoryClosure,
    `${passDirectory}/repository-closure.json`,
  );
  assertExpectedPath(
    input.bundle.pullRequestClosure,
    `${passDirectory}/pull-request-closure.json`,
  );
  assertExpectedPath(
    input.bundle.normalizedProjection,
    `${passDirectory}/normalized-projection.json`,
  );
  const countTree = await readArtifact(
    input.assetRoot,
    input.bundle.countTreeClosure,
    countTreeClosureSchema,
  );
  const repository = await readArtifact(
    input.assetRoot,
    input.bundle.repositoryClosure,
    repositoryClosureSchema,
  );
  const pullRequest = await readArtifact(
    input.assetRoot,
    input.bundle.pullRequestClosure,
    pullRequestClosureSchema,
  );
  const projection = await readArtifact(
    input.assetRoot,
    input.bundle.normalizedProjection,
    normalizedProjectionSchema,
  );
  for (const artifact of [
    countTree,
    repository,
    pullRequest,
    projection,
  ]) {
    assertContext(artifact, input);
  }
  const normalizedPassReference =
    projection.normalizedPass;
  assertExpectedPath(
    normalizedPassReference,
    `${passDirectory}/normalized-pass.json`,
  );
  for (const artifact of [
    countTree,
    repository,
    pullRequest,
  ]) {
    if (
      !referencesEqual(
        artifact.normalizedPass,
        normalizedPassReference,
      )
    ) {
      throw new Error(
        "C6 source-v3-simple closure normalized-pass reference mismatch",
      );
    }
  }
  const envelope = await readArtifact(
    input.assetRoot,
    normalizedPassReference,
    normalizedPassSchema,
  );
  assertContext(envelope, input);
  const normalizedPass =
    verifyC6SourceV3SimpleNormalizedPass(
      envelope.normalizedPass,
      input.frame,
    );
  const normalizedProjectionSha256 =
    hashC6SourceV3SimpleNormalizedProjection(
      normalizedPass,
    );
  if (
    countTree.countTreeCount !==
      normalizedPass.countTrees.length ||
    countTree.repositoryLeafClosureCount !==
      normalizedPass.repositoryLeafClosures.length ||
    repository.repositoryCount !==
      normalizedPass.repositories.length ||
    repository.repositoryDecisionCount !==
      normalizedPass.repositoryDecisions.length ||
    pullRequest.pullRequestCount !==
      normalizedPass.pullRequests.length ||
    pullRequest.pullRequestClosureCount !==
      normalizedPass.pullRequestClosures.length ||
    pullRequest.metadataDecisionCount !==
      normalizedPass.metadataDecisions.length ||
    projection.repositoryCount !==
      normalizedPass.repositories.length ||
    projection.repositoryDecisionCount !==
      normalizedPass.repositoryDecisions.length ||
    projection.pullRequestCount !==
      normalizedPass.pullRequests.length ||
    projection.metadataDecisionCount !==
      normalizedPass.metadataDecisions.length ||
    projection.normalizedProjectionSha256 !==
      normalizedProjectionSha256 ||
    input.bundle.normalizedProjectionSha256 !==
      normalizedProjectionSha256
  ) {
    throw new Error(
      "C6 source-v3-simple pass artifact closure mismatch",
    );
  }
  return {
    normalizedPass,
    normalizedProjectionSha256,
  };
}

export function rebaseC6SourceV3SimplePassArtifactBundle(
  assetRoot: string,
  passRoot: string,
  bundle: C6SourceV3SimplePassArtifactBundle,
): C6SourceV3SimplePassArtifactBundle {
  return rebaseBundle(assetRoot, passRoot, bundle);
}

function rebaseBundle(
  assetRoot: string,
  passRoot: string,
  bundle: C6SourceV3SimplePassArtifactBundle,
): C6SourceV3SimplePassArtifactBundle {
  return {
    countTreeClosure: rebaseReference(
      assetRoot,
      passRoot,
      bundle.countTreeClosure,
    ),
    normalizedProjection: rebaseReference(
      assetRoot,
      passRoot,
      bundle.normalizedProjection,
    ),
    normalizedProjectionSha256:
      bundle.normalizedProjectionSha256,
    pullRequestClosure: rebaseReference(
      assetRoot,
      passRoot,
      bundle.pullRequestClosure,
    ),
    repositoryClosure: rebaseReference(
      assetRoot,
      passRoot,
      bundle.repositoryClosure,
    ),
  };
}

async function readArtifact<T extends z.ZodTypeAny>(
  root: string,
  reference: C6SourceV3SimpleArtifactReference,
  schema: T,
): Promise<z.output<T>> {
  artifactReferenceSchema.parse(reference);
  const rootPath = resolve(root);
  const path = resolve(rootPath, reference.path);
  const relativePath = relative(rootPath, path);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath.length === 0
  ) {
    throw new Error(
      "C6 source-v3-simple pass artifact escapes root",
    );
  }
  const bytes = await readC6StableRegularFile(
    path,
    "source-v3-simple pass artifact",
    undefined,
    true,
  );
  if (
    bytes.length !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(
      "C6 source-v3-simple pass artifact reference mismatch",
    );
  }
  const text = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(bytes);
  const raw = JSON.parse(text) as unknown;
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 source-v3-simple pass artifact is not canonical JSON",
    );
  }
  return schema.parse(raw);
}

function assertContext(
  artifact: {
    evaluationId: string;
    executionContractSha256: string;
    frozenInputClosureSha256: string;
    pass: "A" | "B";
    runtimeAuthorizationSha256: string;
  },
  expected: {
    evaluationId: string;
    executionContractSha256: string;
    frozenInputClosureSha256: string;
    pass: "A" | "B";
    runtimeAuthorizationSha256: string;
  },
): void {
  if (
    artifact.evaluationId !== expected.evaluationId ||
    artifact.executionContractSha256 !==
      expected.executionContractSha256 ||
    artifact.frozenInputClosureSha256 !==
      expected.frozenInputClosureSha256 ||
    artifact.pass !== expected.pass ||
    artifact.runtimeAuthorizationSha256 !==
      expected.runtimeAuthorizationSha256
  ) {
    throw new Error(
      "C6 source-v3-simple pass artifact context mismatch",
    );
  }
}

function assertExpectedPath(
  reference: C6SourceV3SimpleArtifactReference,
  expectedPath: string,
): void {
  artifactReferenceSchema.parse(reference);
  if (reference.path !== expectedPath) {
    throw new Error(
      "C6 source-v3-simple pass artifact path mismatch",
    );
  }
}

function referencesEqual(
  left: C6SourceV3SimpleArtifactReference,
  right: C6SourceV3SimpleArtifactReference,
): boolean {
  return left.bytes === right.bytes &&
    left.path === right.path &&
    left.sha256 === right.sha256;
}

function rebaseReference(
  assetRoot: string,
  localRoot: string,
  reference: C6SourceV3SimpleArtifactReference,
): C6SourceV3SimpleArtifactReference {
  if (basename(reference.path) !== reference.path) {
    throw new Error(
      "C6 source-v3-simple local pass artifact path mismatch",
    );
  }
  const path = relative(
    resolve(assetRoot),
    resolve(localRoot, reference.path),
  );
  if (
    path === ".." ||
    path.startsWith(`..${sep}`) ||
    dirname(path) === "." ||
    path.length === 0
  ) {
    throw new Error(
      "C6 source-v3-simple pass artifact escapes asset root",
    );
  }
  return {
    ...reference,
    path,
  };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
