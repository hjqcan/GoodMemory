import { createHash } from "node:crypto";
import {
  lstat,
  readdir,
} from "node:fs/promises";
import {
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";
import {
  C6SourceV3SimpleCensusRuntimeAuthorizationSnapshotSchema,
} from "./c6-source-v3-simple-census-activation";
import type {
  C6SourceV3SimpleCensusRuntimeAuthorizationSnapshot,
} from "./c6-source-v3-simple-census-activation";
import {
  C6SourceV3SimpleSecretLeakError,
} from "./c6-source-v3-simple-census-errors";
import {
  commitC6SourceV3SimpleCreateOnlyCanonicalJson,
} from "./c6-source-v3-simple-census-ledger";
import type {
  C6SourceV3SimpleArtifactReference,
} from "./c6-source-v3-simple-census-ledger";
import type {
  C6SourceV3SimpleFrameDefinition,
} from "./c6-source-v3-simple-census-core";
import {
  parseC6SourceV3SimpleFrameDefinition,
} from "./c6-source-v3-simple-census-core";
import type {
  C6SourceV3SimpleCensusFrozenInput,
} from "./c6-source-v3-simple-census-preflight";

const sha256Schema = z.string().regex(
  /^[a-f0-9]{64}$/u,
);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const frozenInputSchema = z.object({
  bytes: z.number().int().nonnegative(),
  label: z.string().min(1),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const frozenInputClosureSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-frozen-input-closure",
  ),
  evaluationId: z.string().min(1),
  executionContractSha256: sha256Schema,
  frame: z.unknown(),
  frozenInputs: z.array(frozenInputSchema).min(1),
  inputClosureSha256: sha256Schema,
  runtimeAuthorization:
    C6SourceV3SimpleCensusRuntimeAuthorizationSnapshotSchema,
  runtimeAuthorizationSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();
const frozenInputMutationObservationSchema =
  z.object({
    expected: frozenInputSchema,
    observed: z.discriminatedUnion("state", [
      z.object({
        bytes: z.number().int().nonnegative(),
        sha256: sha256Schema,
        state: z.literal("regular-file"),
      }).strict(),
      z.object({
        state: z.literal(
          "unavailable-or-unsafe",
        ),
      }).strict(),
    ]),
  }).strict();
const frozenInputMutationEvidenceSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-frozen-input-mutation",
  ),
  evaluationId: z.string().min(1),
  executionContractSha256: sha256Schema,
  frozenInputClosureSha256: sha256Schema,
  inputClosureSha256: sha256Schema,
  observations:
    z.array(frozenInputMutationObservationSchema).min(1),
  runtimeAuthorizationSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();
const assetFileSchema = z.object({
  bytes: z.number().int().nonnegative(),
  mode: z.number().int().min(0).max(0o777),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const assetLockSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-census-asset-lock",
  ),
  assetRootSha256: sha256Schema,
  evaluationId: z.string().min(1),
  executionContractSha256: sha256Schema,
  files: z.array(assetFileSchema).min(1),
  frozenInputClosureSha256: sha256Schema,
  inputClosureSha256: sha256Schema,
  runtimeAuthorizationSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();

export interface C6SourceV3SimpleExpectedFrozenInputs {
  evaluationId: string;
  executionContractSha256: string;
  frame: C6SourceV3SimpleFrameDefinition;
  frozenInputs:
    readonly C6SourceV3SimpleCensusFrozenInput[];
  inputClosureSha256: string;
  runtimeAuthorization:
    C6SourceV3SimpleCensusRuntimeAuthorizationSnapshot;
  runtimeAuthorizationSha256: string;
}

export async function writeC6SourceV3SimpleFrozenInputClosure(
  input: {
    assetRoot: string;
    expected: C6SourceV3SimpleExpectedFrozenInputs;
    repositoryRoot: string;
  },
): Promise<C6SourceV3SimpleArtifactReference> {
  const reference =
    await commitC6SourceV3SimpleFrozenInputClosure({
      assetRoot: input.assetRoot,
      expected: input.expected,
    });
  await assertC6SourceV3SimpleFrozenInputsCurrent({
    expected: input.expected,
    repositoryRoot: input.repositoryRoot,
  });
  return reference;
}

export async function commitC6SourceV3SimpleFrozenInputClosure(
  input: {
    assetRoot: string;
    expected: C6SourceV3SimpleExpectedFrozenInputs;
  },
): Promise<C6SourceV3SimpleArtifactReference> {
  assertFrozenInputClosure(input.expected);
  return await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
    input.assetRoot,
    "frozen-input-closure.json",
    frozenInputClosureSchema.parse({
      artifactKind:
        "c6-source-v3-simple-frozen-input-closure",
      ...input.expected,
      frozenInputs: input.expected.frozenInputs.map(
        (entry) => ({ ...entry }),
      ),
      schemaVersion: 1,
    }),
  );
}

export async function readC6SourceV3SimpleFrozenInputClosureIfExists(
  assetRootInput: string,
): Promise<{
  expected: C6SourceV3SimpleExpectedFrozenInputs;
  reference: C6SourceV3SimpleArtifactReference;
} | null> {
  let assetRoot: string;
  try {
    assetRoot =
      await assertC6NoSymlinkPathComponents(
        assetRootInput,
        "C6 source-v3-simple frozen input closure root",
      );
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
  const path = resolve(
    assetRoot,
    "frozen-input-closure.json",
  );
  let bytes: Buffer;
  try {
    bytes = await readC6StableRegularFile(
      path,
      "source-v3-simple frozen input closure",
      undefined,
      true,
    );
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
  const text = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(bytes);
  const raw = JSON.parse(text) as unknown;
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 source-v3-simple frozen input closure is not canonical JSON",
    );
  }
  const value = frozenInputClosureSchema.parse(raw);
  const expected = {
    evaluationId: value.evaluationId,
    executionContractSha256:
      value.executionContractSha256,
    frame: parseC6SourceV3SimpleFrameDefinition(
      value.frame,
    ),
    frozenInputs: value.frozenInputs,
    inputClosureSha256:
      value.inputClosureSha256,
    runtimeAuthorization:
      value.runtimeAuthorization,
    runtimeAuthorizationSha256:
      value.runtimeAuthorizationSha256,
  };
  assertFrozenInputClosure(expected);
  return {
    expected,
    reference: {
      bytes: bytes.length,
      path: "frozen-input-closure.json",
      sha256: sha256(bytes),
    },
  };
}

export async function verifyC6SourceV3SimpleFrozenInputClosure(
  input: {
    assetRoot: string;
    expected: C6SourceV3SimpleExpectedFrozenInputs;
    reference: C6SourceV3SimpleArtifactReference;
    repositoryRoot: string;
  },
): Promise<void> {
  await assertC6SourceV3SimpleFrozenInputsCurrent({
    expected: input.expected,
    repositoryRoot: input.repositoryRoot,
  });
  await verifyC6SourceV3SimpleFrozenInputClosureArtifact({
    assetRoot: input.assetRoot,
    expected: input.expected,
    reference: input.reference,
  });
}

export async function verifyC6SourceV3SimpleFrozenInputClosureArtifact(
  input: {
    assetRoot: string;
    expected: C6SourceV3SimpleExpectedFrozenInputs;
    reference: C6SourceV3SimpleArtifactReference;
  },
): Promise<void> {
  assertExpectedPath(
    input.reference,
    "frozen-input-closure.json",
  );
  assertFrozenInputClosure(input.expected);
  const value = await readArtifact(
    input.assetRoot,
    input.reference,
    frozenInputClosureSchema,
  );
  if (
    JSON.stringify({
      evaluationId: value.evaluationId,
      executionContractSha256:
        value.executionContractSha256,
      frame: parseC6SourceV3SimpleFrameDefinition(
        value.frame,
      ),
      frozenInputs: value.frozenInputs,
      inputClosureSha256:
        value.inputClosureSha256,
      runtimeAuthorization:
        value.runtimeAuthorization,
      runtimeAuthorizationSha256:
        value.runtimeAuthorizationSha256,
    }) !== JSON.stringify({
      evaluationId: input.expected.evaluationId,
      executionContractSha256:
        input.expected.executionContractSha256,
      frame: input.expected.frame,
      frozenInputs: input.expected.frozenInputs,
      inputClosureSha256:
        input.expected.inputClosureSha256,
      runtimeAuthorization:
        input.expected.runtimeAuthorization,
      runtimeAuthorizationSha256:
        input.expected.runtimeAuthorizationSha256,
    })
  ) {
    throw new Error(
      "C6 source-v3-simple frozen input closure mismatch",
    );
  }
}

export async function assertC6SourceV3SimpleFrozenInputsCurrent(
  input: {
    expected: C6SourceV3SimpleExpectedFrozenInputs;
    repositoryRoot: string;
  },
): Promise<void> {
  assertFrozenInputClosure(input.expected);
  await verifyFrozenInputFiles(
    input.repositoryRoot,
    input.expected.frozenInputs,
  );
}

export async function writeC6SourceV3SimpleFrozenInputMutationEvidence(
  input: {
    assetRoot: string;
    expected: C6SourceV3SimpleExpectedFrozenInputs;
    frozenInputClosureSha256: string;
    repositoryRoot: string;
  },
): Promise<C6SourceV3SimpleArtifactReference> {
  assertFrozenInputClosure(input.expected);
  const observations = [];
  for (const expected of input.expected.frozenInputs) {
    const observed = await observeFrozenInput(
      input.repositoryRoot,
      expected,
    );
    if (
      observed.state === "regular-file" &&
      observed.bytes === expected.bytes &&
      observed.sha256 === expected.sha256
    ) {
      continue;
    }
    observations.push({
      expected: { ...expected },
      observed,
    });
  }
  if (observations.length === 0) {
    throw new Error(
      "C6 source-v3-simple frozen inputs have not mutated",
    );
  }
  return await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
    input.assetRoot,
    "input-mutation-evidence.json",
    frozenInputMutationEvidenceSchema.parse({
      artifactKind:
        "c6-source-v3-simple-frozen-input-mutation",
      evaluationId: input.expected.evaluationId,
      executionContractSha256:
        input.expected.executionContractSha256,
      frozenInputClosureSha256:
        input.frozenInputClosureSha256,
      inputClosureSha256:
        input.expected.inputClosureSha256,
      observations,
      runtimeAuthorizationSha256:
        input.expected.runtimeAuthorizationSha256,
      schemaVersion: 1,
    }),
  );
}

export async function verifyC6SourceV3SimpleFrozenInputMutationEvidence(
  input: {
    assetRoot: string;
    expected: C6SourceV3SimpleExpectedFrozenInputs;
    frozenInputClosureSha256: string;
    reference: C6SourceV3SimpleArtifactReference;
  },
): Promise<void> {
  assertExpectedPath(
    input.reference,
    "input-mutation-evidence.json",
  );
  assertFrozenInputClosure(input.expected);
  const value = await readArtifact(
    input.assetRoot,
    input.reference,
    frozenInputMutationEvidenceSchema,
  );
  const expectedByPath = new Map(
    input.expected.frozenInputs.map((entry) => [
      entry.path,
      entry,
    ]),
  );
  if (
    value.evaluationId !==
      input.expected.evaluationId ||
    value.executionContractSha256 !==
      input.expected.executionContractSha256 ||
    value.frozenInputClosureSha256 !==
      input.frozenInputClosureSha256 ||
    value.inputClosureSha256 !==
      input.expected.inputClosureSha256 ||
    value.runtimeAuthorizationSha256 !==
      input.expected.runtimeAuthorizationSha256 ||
    value.observations.some((observation) => {
      const expected = expectedByPath.get(
        observation.expected.path,
      );
      return expected === undefined ||
        JSON.stringify(expected) !==
          JSON.stringify(observation.expected) ||
        (
          observation.observed.state ===
            "regular-file" &&
          observation.observed.bytes ===
            expected.bytes &&
          observation.observed.sha256 ===
            expected.sha256
        );
    })
  ) {
    throw new Error(
      "C6 source-v3-simple frozen input mutation evidence mismatch",
    );
  }
}

async function observeFrozenInput(
  repositoryRootInput: string,
  input: C6SourceV3SimpleCensusFrozenInput,
): Promise<
  | {
      bytes: number;
      sha256: string;
      state: "regular-file";
    }
  | {
      state: "unavailable-or-unsafe";
    }
> {
  try {
    const repositoryRoot =
      await assertC6NoSymlinkPathComponents(
        repositoryRootInput,
        "C6 source-v3-simple repository root",
      );
    const path = resolve(repositoryRoot, input.path);
    const relativePath = relative(
      repositoryRoot,
      path,
    );
    if (
      relativePath.length === 0 ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`)
    ) {
      return {
        state: "unavailable-or-unsafe",
      };
    }
    await assertC6NoSymlinkPathComponents(
      path,
      `C6 source-v3-simple frozen input ${input.label}`,
    );
    const bytes = await readC6StableRegularFile(
      path,
      `C6 source-v3-simple frozen input ${input.label}`,
      undefined,
      true,
    );
    return {
      bytes: bytes.length,
      sha256: sha256(bytes),
      state: "regular-file",
    };
  } catch {
    return {
      state: "unavailable-or-unsafe",
    };
  }
}

async function verifyFrozenInputFiles(
  repositoryRootInput: string,
  frozenInputs:
    readonly C6SourceV3SimpleCensusFrozenInput[],
): Promise<void> {
  const repositoryRoot =
    await assertC6NoSymlinkPathComponents(
      repositoryRootInput,
      "C6 source-v3-simple repository root",
    );
  for (const input of frozenInputs) {
    const path = resolve(repositoryRoot, input.path);
    const relativePath = relative(
      repositoryRoot,
      path,
    );
    if (
      relativePath.length === 0 ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`)
    ) {
      throw new Error(
        `C6 source-v3-simple frozen input ${input.label} escapes repository root`,
      );
    }
    await assertC6NoSymlinkPathComponents(
      path,
      `C6 source-v3-simple frozen input ${input.label}`,
    );
    const bytes = await readC6StableRegularFile(
      path,
      `C6 source-v3-simple frozen input ${input.label}`,
      input.bytes,
    );
    if (
      bytes.length !== input.bytes ||
      sha256(bytes) !== input.sha256
    ) {
      throw new Error(
        `C6 source-v3-simple frozen input ${input.label} binding mismatch`,
      );
    }
  }
}

export async function writeC6SourceV3SimpleCensusAssetLock(
  input: {
    assetRoot: string;
    expectedFrozenInputs:
      C6SourceV3SimpleExpectedFrozenInputs;
    frozenInputClosureSha256: string;
  },
): Promise<C6SourceV3SimpleArtifactReference> {
  assertFrozenInputClosure(
    input.expectedFrozenInputs,
  );
  const terminalPath = join(
    input.assetRoot,
    "terminal.json",
  );
  if (await exists(terminalPath)) {
    throw new Error(
      "C6 source-v3-simple terminal exists before asset lock",
    );
  }
  const files = await buildAssetFiles(input.assetRoot);
  const closure = assertAssetClosureBinding(
    files,
    input.frozenInputClosureSha256,
  );
  await verifyC6SourceV3SimpleFrozenInputClosureArtifact({
    assetRoot: input.assetRoot,
    expected: input.expectedFrozenInputs,
    reference: closure,
  });
  return await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
    input.assetRoot,
    "asset-lock.json",
    assetLockSchema.parse({
      artifactKind:
        "c6-source-v3-simple-census-asset-lock",
      assetRootSha256: sha256(
        Buffer.from(JSON.stringify(files)),
      ),
      evaluationId:
        input.expectedFrozenInputs.evaluationId,
      executionContractSha256:
        input.expectedFrozenInputs
          .executionContractSha256,
      files,
      frozenInputClosureSha256:
        input.frozenInputClosureSha256,
      inputClosureSha256:
        input.expectedFrozenInputs
          .inputClosureSha256,
      runtimeAuthorizationSha256:
        input.expectedFrozenInputs
          .runtimeAuthorizationSha256,
      schemaVersion: 1,
    }),
  );
}

export async function verifyC6SourceV3SimpleCensusAssetLock(
  input: {
    assetRoot: string;
    expectedFrozenInputs:
      C6SourceV3SimpleExpectedFrozenInputs;
    frozenInputClosureSha256: string;
    reference: C6SourceV3SimpleArtifactReference;
  },
): Promise<void> {
  assertExpectedPath(input.reference, "asset-lock.json");
  assertFrozenInputClosure(
    input.expectedFrozenInputs,
  );
  const value = await readArtifact(
    input.assetRoot,
    input.reference,
    assetLockSchema,
  );
  const files = await buildAssetFiles(input.assetRoot);
  const closure = assertAssetClosureBinding(
    files,
    input.frozenInputClosureSha256,
  );
  await verifyC6SourceV3SimpleFrozenInputClosureArtifact({
    assetRoot: input.assetRoot,
    expected: input.expectedFrozenInputs,
    reference: closure,
  });
  if (
    value.evaluationId !==
      input.expectedFrozenInputs.evaluationId ||
    value.executionContractSha256 !==
      input.expectedFrozenInputs
        .executionContractSha256 ||
    value.frozenInputClosureSha256 !==
      input.frozenInputClosureSha256 ||
    value.inputClosureSha256 !==
      input.expectedFrozenInputs
        .inputClosureSha256 ||
    value.runtimeAuthorizationSha256 !==
      input.expectedFrozenInputs
        .runtimeAuthorizationSha256 ||
    value.assetRootSha256 !==
      sha256(Buffer.from(JSON.stringify(files))) ||
    JSON.stringify(value.files) !== JSON.stringify(files)
  ) {
    throw new Error(
      "C6 source-v3-simple census asset lock mismatch",
    );
  }
}

export async function assertC6SourceV3SimpleTreeHasNoSecret(
  input: {
    assetRoot: string;
    secret: Uint8Array;
  },
): Promise<void> {
  const secret = Buffer.from(input.secret);
  if (secret.length === 0) {
    throw new Error(
      "C6 source-v3-simple secret is empty",
    );
  }
  const root = await assertC6NoSymlinkPathComponents(
    input.assetRoot,
    "C6 source-v3-simple secret scan root",
  );
  for (const path of await walk(root)) {
    const bytes = await readC6StableRegularFile(
      path,
      "source-v3-simple secret scan",
      undefined,
      true,
    );
    if (bytes.includes(secret)) {
      throw new C6SourceV3SimpleSecretLeakError();
    }
  }
}

function assertFrozenInputClosure(
  expected: C6SourceV3SimpleExpectedFrozenInputs,
): void {
  frozenInputClosureSchema.omit({
    artifactKind: true,
    schemaVersion: true,
  }).parse(expected);
  const runtimeAuthorization =
    C6SourceV3SimpleCensusRuntimeAuthorizationSnapshotSchema
      .parse(expected.runtimeAuthorization);
  const frame = parseC6SourceV3SimpleFrameDefinition(
    expected.frame,
  );
  if (
    sha256(
      Buffer.from(JSON.stringify(runtimeAuthorization)),
    ) !== expected.runtimeAuthorizationSha256 ||
    runtimeAuthorization.evaluationId !==
      expected.evaluationId ||
    runtimeAuthorization.executionContract.sha256 !==
      expected.executionContractSha256
  ) {
    throw new Error(
      "C6 source-v3-simple runtime authorization hash mismatch",
    );
  }
  const projection = expected.frozenInputs.map(
    (entry) => ({
      bytes: entry.bytes,
      label: entry.label,
      path: entry.path,
      sha256: entry.sha256,
    }),
  );
  if (
    sha256(Buffer.from(JSON.stringify({
      frame,
      frozenInputs: projection,
      runtimeAuthorization,
      runtimeAuthorizationSha256:
        expected.runtimeAuthorizationSha256,
    }))) !==
      expected.inputClosureSha256
  ) {
    throw new Error(
      "C6 source-v3-simple frozen input hash mismatch",
    );
  }
}

function hasErrorCode(
  error: unknown,
  code: string,
): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code;
}

function assertAssetClosureBinding(
  files: readonly z.infer<typeof assetFileSchema>[],
  frozenInputClosureSha256: string,
): C6SourceV3SimpleArtifactReference {
  const closure = files.find(
    (file) =>
      file.path === "frozen-input-closure.json",
  );
  if (
    closure === undefined ||
    closure.sha256 !== frozenInputClosureSha256
  ) {
    throw new Error(
      "C6 source-v3-simple asset lock frozen input closure mismatch",
    );
  }
  return {
    bytes: closure.bytes,
    path: closure.path,
    sha256: closure.sha256,
  };
}

async function buildAssetFiles(
  rootInput: string,
): Promise<Array<z.infer<typeof assetFileSchema>>> {
  const root = await assertC6NoSymlinkPathComponents(
    rootInput,
    "C6 source-v3-simple census asset root",
  );
  const files = [];
  for (const path of await walk(root)) {
    const relativePath = relative(root, path)
      .split("\\")
      .join("/");
    if (
      relativePath.endsWith(".pending") ||
      relativePath.endsWith(".ready")
    ) {
      throw new Error(
        "C6 source-v3-simple census asset contains staged artifact",
      );
    }
    if (
      relativePath === "asset-lock.json" ||
      relativePath === "terminal.json" ||
      relativePath === "writer-lock.json"
    ) {
      continue;
    }
    const stats = await lstat(path);
    const bytes = await readC6StableRegularFile(
      path,
      "source-v3-simple census asset",
      undefined,
      true,
    );
    files.push({
      bytes: bytes.length,
      mode: stats.mode & 0o777,
      path: relativePath,
      sha256: sha256(bytes),
    });
  }
  files.sort((left, right) =>
    Buffer.compare(
      Buffer.from(left.path),
      Buffer.from(right.path),
    )
  );
  return files;
}

async function walk(root: string): Promise<string[]> {
  const entries = await readdir(root, {
    withFileTypes: true,
  });
  entries.sort((left, right) =>
    Buffer.compare(
      Buffer.from(left.name),
      Buffer.from(right.name),
    )
  );
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        "C6 source-v3-simple census asset rejects symlink",
      );
    }
    if (entry.isDirectory()) {
      files.push(...await walk(path));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      throw new Error(
        "C6 source-v3-simple census asset rejects non-file",
      );
    }
  }
  return files;
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
      "C6 source-v3-simple finalization artifact escapes root",
    );
  }
  const bytes = await readC6StableRegularFile(
    path,
    "source-v3-simple finalization artifact",
    undefined,
    true,
  );
  if (
    bytes.length !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(
      "C6 source-v3-simple finalization artifact reference mismatch",
    );
  }
  const text = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(bytes);
  const raw = JSON.parse(text) as unknown;
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 source-v3-simple finalization artifact is not canonical JSON",
    );
  }
  return schema.parse(raw);
}

function assertExpectedPath(
  reference: C6SourceV3SimpleArtifactReference,
  path: string,
): void {
  artifactReferenceSchema.parse(reference);
  if (reference.path !== path) {
    throw new Error(
      "C6 source-v3-simple finalization artifact path mismatch",
    );
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
