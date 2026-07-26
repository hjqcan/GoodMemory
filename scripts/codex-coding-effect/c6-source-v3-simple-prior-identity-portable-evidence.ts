import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  join,
  resolve,
} from "node:path";
import {
  isDeepStrictEqual,
  promisify,
} from "node:util";
import {
  gunzipSync,
  gzipSync,
} from "node:zlib";

import { z } from "zod";

import {
  readC6StableRegularFile,
} from "./c6-asset-lock";
import {
  C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_PATH,
  parseC6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
  serializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
  verifyC6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
} from "./c6-source-v3-simple-prior-repository-identity-replay";
import type {
  C6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
} from "./c6-source-v3-simple-prior-repository-identity-replay";

const execFileAsync = promisify(execFile);
const TAR_BLOCK_BYTES = 512;
const TAR_END_BLOCK_BYTES = TAR_BLOCK_BYTES * 2;
const MAX_ARCHIVE_BYTES = 8 * 1_024 * 1_024;
const MAX_MANIFEST_BYTES = 64 * 1_024;
const MAX_REPLAY_RECEIPT_BYTES = 64 * 1_024;
const MAX_TAR_BYTES = 16 * 1_024 * 1_024;
const MAX_TAR_ENTRY_COUNT = 4_096;

export const C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_CAPTURE_A_ARCHIVE_PATH =
  "capture-a.tar.gz";
export const C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_CAPTURE_B_ARCHIVE_PATH =
  "capture-b.tar.gz";
export const C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_PORTABLE_EVIDENCE_PATH =
  "portable-evidence.json";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const artifactReferenceSchema = z.object({
  artifactKind: z.string().min(1),
  bytes: z.number().int().positive(),
  path: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  sha256: sha256Schema,
}).strict();
const assetLockReferenceSchema = z.object({
  artifactKind: z.literal("c6-asset-lock"),
  assetRootSha256: sha256Schema,
  schemaVersion: z.literal(1),
  sha256: sha256Schema,
}).strict();
const structureReferenceSchema = z.object({
  bytes: z.number().int().positive(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const archiveReferenceFields = {
  bytes: z.number().int().positive().max(
    MAX_ARCHIVE_BYTES,
  ),
  outerAssetLock: assetLockReferenceSchema,
  rawEvidenceAssetLock: assetLockReferenceSchema,
  sha256: sha256Schema,
  structure: structureReferenceSchema,
};
const manifestSchema = z.object({
  archives: z.object({
    captureA: z.object({
      ...archiveReferenceFields,
      path: z.literal(
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_CAPTURE_A_ARCHIVE_PATH,
      ),
    }).strict(),
    captureB: z.object({
      ...archiveReferenceFields,
      path: z.literal(
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_CAPTURE_B_ARCHIVE_PATH,
      ),
    }).strict(),
  }).strict(),
  artifactKind: z.literal(
    "c6-source-v3-simple-prior-repository-identity-portable-evidence",
  ),
  boundary: z.object({
    candidateManifestFrozen: z.literal(false),
    captureOriginIndependentlyVerified: z.literal(false),
    codexRunReady: z.literal(false),
    externalAuthenticityVerified: z.literal(false),
    formalCensusPermitted: z.literal(false),
    independentCaptureProcessProven: z.literal(false),
    liveNetworkExecutionProven: z.literal(false),
    portableEvidenceClosureVerified: z.literal(true),
    priorRepositoryNodeIdExclusionComplete: z.literal(false),
    repositoryIdentityReplayAgreementObserved:
      z.literal(true),
    sourceV3SimpleFrozen: z.literal(false),
  }).strict(),
  inputs: z.object({
    plan: artifactReferenceSchema,
    protocol: artifactReferenceSchema,
    sourceUniverse: artifactReferenceSchema,
  }).strict(),
  replayReceipt: z.object({
    artifactKind: z.literal(
      "c6-source-v3-simple-prior-repository-identity-observation-replay",
    ),
    bytes: z.number().int().positive(),
    canonicalJson: z.string().min(1).max(
      MAX_REPLAY_RECEIPT_BYTES,
    ),
    path: z.literal(
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_PATH,
    ),
    schemaVersion: z.literal(1),
    sha256: sha256Schema,
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();

export type C6SourceV3SimplePriorIdentityPortableEvidenceManifest =
  z.infer<typeof manifestSchema>;

export interface C6SourceV3SimplePriorIdentityPortableEvidenceInput {
  captureA: string;
  captureB: string;
  outputRoot: string;
  planPath: string;
  protocolPath: string;
  replayReceiptPath: string;
  sourceUniversePath: string;
}

export interface C6SourceV3SimplePriorIdentityPortableEvidenceVerificationInput {
  outputRoot: string;
  planPath: string;
  protocolPath: string;
  sourceUniversePath: string;
}

export interface C6SourceV3SimplePriorIdentityPortableEvidenceVerification {
  candidateManifestFrozen: false;
  captureAArchiveBytes: number;
  captureAArchiveSha256: string;
  captureBArchiveBytes: number;
  captureBArchiveSha256: string;
  captureOriginIndependentlyVerified: false;
  codexRunReady: false;
  externalAuthenticityVerified: false;
  formalCensusPermitted: false;
  independentCaptureProcessProven: false;
  liveNetworkExecutionProven: false;
  manifestBytes: number;
  manifestPath: string;
  manifestSha256: string;
  outputRoot: string;
  portableEvidenceClosureVerified: true;
  priorRepositoryNodeIdExclusionComplete: false;
  repositoryIdentityReplayAgreementObserved: true;
  sourceV3SimpleFrozen: false;
}

export async function publishC6SourceV3SimplePriorIdentityPortableEvidence(
  rawInput: C6SourceV3SimplePriorIdentityPortableEvidenceInput,
): Promise<void> {
  const input = resolvePortableEvidenceInput(rawInput);
  await assertOutputRootAbsent(input.outputRoot);
  const replayReceiptBytes = await readC6StableRegularFile(
    input.replayReceiptPath,
    "source-v3-simple prior identity replay receipt",
    MAX_REPLAY_RECEIPT_BYTES,
    true,
  );
  const replayReceipt =
    await verifyC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
      replayReceiptBytes,
      replayInput(input),
    );
  const canonicalReplayReceipt =
    serializeC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
      replayReceipt,
    );
  if (!replayReceiptBytes.equals(
    Buffer.from(canonicalReplayReceipt),
  )) {
    throw new Error(
      "C6 source-v3-simple prior identity replay receipt changed during verification",
    );
  }

  const temporaryRoot = await mkdtemp(join(
    await realpath(tmpdir()),
    "goodmemory-c6-prior-identity-portable-",
  ));
  try {
    const [captureAArchive, captureBArchive] =
      await Promise.all([
        buildReproducibleArchive({
          captureRoot: input.captureA,
          label: "capture A",
          temporaryRoot,
        }),
        buildReproducibleArchive({
          captureRoot: input.captureB,
          label: "capture B",
          temporaryRoot,
        }),
      ]);
    const manifest = buildManifest({
      captureAArchive,
      captureBArchive,
      canonicalReplayReceipt,
      replayReceipt,
    });
    const manifestBytes = Buffer.from(
      serializeC6SourceV3SimplePriorIdentityPortableEvidenceManifest(
        manifest,
      ),
    );

    const candidateRoot = join(temporaryRoot, "candidate");
    await mkdir(candidateRoot, { mode: 0o700 });
    await publishArtifacts({
      captureAArchive,
      captureBArchive,
      manifestBytes,
      outputRoot: candidateRoot,
    });
    await verifyC6SourceV3SimplePriorIdentityPortableEvidence({
      outputRoot: candidateRoot,
      planPath: input.planPath,
      protocolPath: input.protocolPath,
      sourceUniversePath: input.sourceUniversePath,
    });

    await mkdir(input.outputRoot, { mode: 0o700 });
    await publishArtifacts({
      captureAArchive,
      captureBArchive,
      manifestBytes,
      outputRoot: input.outputRoot,
    });
  } finally {
    await rm(temporaryRoot, {
      force: true,
      recursive: true,
    });
  }
}

export async function verifyC6SourceV3SimplePriorIdentityPortableEvidence(
  rawInput:
    C6SourceV3SimplePriorIdentityPortableEvidenceVerificationInput,
): Promise<C6SourceV3SimplePriorIdentityPortableEvidenceVerification> {
  const input = {
    outputRoot: resolve(rawInput.outputRoot),
    planPath: resolve(rawInput.planPath),
    protocolPath: resolve(rawInput.protocolPath),
    sourceUniversePath: resolve(rawInput.sourceUniversePath),
  };
  const manifestPath = join(
    input.outputRoot,
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_PORTABLE_EVIDENCE_PATH,
  );
  const captureAArchivePath = join(
    input.outputRoot,
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_CAPTURE_A_ARCHIVE_PATH,
  );
  const captureBArchivePath = join(
    input.outputRoot,
    C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_CAPTURE_B_ARCHIVE_PATH,
  );
  const [
    manifestBytes,
    captureAArchive,
    captureBArchive,
  ] = await Promise.all([
    readC6StableRegularFile(
      manifestPath,
      "source-v3-simple prior identity portable evidence manifest",
      MAX_MANIFEST_BYTES,
      true,
    ),
    readC6StableRegularFile(
      captureAArchivePath,
      "source-v3-simple prior identity capture A archive",
      MAX_ARCHIVE_BYTES,
      true,
    ),
    readC6StableRegularFile(
      captureBArchivePath,
      "source-v3-simple prior identity capture B archive",
      MAX_ARCHIVE_BYTES,
      true,
    ),
  ]);
  const manifest =
    parseC6SourceV3SimplePriorIdentityPortableEvidenceManifest(
      manifestBytes,
    );
  assertArchiveReference(
    captureAArchive,
    manifest.archives.captureA,
    "capture A",
  );
  assertArchiveReference(
    captureBArchive,
    manifest.archives.captureB,
    "capture B",
  );
  validateTarArchive(captureAArchive, "capture A");
  validateTarArchive(captureBArchive, "capture B");

  const canonicalReplayReceipt =
    manifest.replayReceipt.canonicalJson;
  if (
    Buffer.byteLength(canonicalReplayReceipt) !==
      manifest.replayReceipt.bytes ||
    sha256(canonicalReplayReceipt) !==
      manifest.replayReceipt.sha256
  ) {
    throw new Error(
      "C6 source-v3-simple prior identity portable replay receipt reference mismatch",
    );
  }
  const replayReceipt =
    parseC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
      canonicalReplayReceipt,
    );
  assertManifestBindings(manifest, replayReceipt);

  const temporaryRoot = await mkdtemp(join(
    await realpath(tmpdir()),
    "goodmemory-c6-prior-identity-portable-verify-",
  ));
  try {
    const captureAArchiveCopy = join(
      temporaryRoot,
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_CAPTURE_A_ARCHIVE_PATH,
    );
    const captureBArchiveCopy = join(
      temporaryRoot,
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_CAPTURE_B_ARCHIVE_PATH,
    );
    const captureARoot = join(temporaryRoot, "capture-a");
    const captureBRoot = join(temporaryRoot, "capture-b");
    await Promise.all([
      writeFile(captureAArchiveCopy, captureAArchive, {
        flag: "wx",
        mode: 0o600,
      }),
      writeFile(captureBArchiveCopy, captureBArchive, {
        flag: "wx",
        mode: 0o600,
      }),
      mkdir(captureARoot, { mode: 0o700 }),
      mkdir(captureBRoot, { mode: 0o700 }),
    ]);
    await Promise.all([
      extractArchive(captureAArchiveCopy, captureARoot),
      extractArchive(captureBArchiveCopy, captureBRoot),
    ]);
    await verifyC6SourceV3SimplePriorRepositoryIdentityReplayReceipt(
      canonicalReplayReceipt,
      {
        captureA: captureARoot,
        captureB: captureBRoot,
        planPath: input.planPath,
        protocolPath: input.protocolPath,
        sourceUniversePath: input.sourceUniversePath,
      },
    );
  } finally {
    await rm(temporaryRoot, {
      force: true,
      recursive: true,
    });
  }

  return {
    candidateManifestFrozen: false,
    captureAArchiveBytes: captureAArchive.byteLength,
    captureAArchiveSha256: sha256(captureAArchive),
    captureBArchiveBytes: captureBArchive.byteLength,
    captureBArchiveSha256: sha256(captureBArchive),
    captureOriginIndependentlyVerified: false,
    codexRunReady: false,
    externalAuthenticityVerified: false,
    formalCensusPermitted: false,
    independentCaptureProcessProven: false,
    liveNetworkExecutionProven: false,
    manifestBytes: manifestBytes.byteLength,
    manifestPath,
    manifestSha256: sha256(manifestBytes),
    outputRoot: input.outputRoot,
    portableEvidenceClosureVerified: true,
    priorRepositoryNodeIdExclusionComplete: false,
    repositoryIdentityReplayAgreementObserved: true,
    sourceV3SimpleFrozen: false,
  };
}

export function serializeC6SourceV3SimplePriorIdentityPortableEvidenceManifest(
  input: C6SourceV3SimplePriorIdentityPortableEvidenceManifest,
): string {
  return `${JSON.stringify(manifestSchema.parse(input), null, 2)}\n`;
}

export function parseC6SourceV3SimplePriorIdentityPortableEvidenceManifest(
  input: string | Uint8Array,
): C6SourceV3SimplePriorIdentityPortableEvidenceManifest {
  const bytes = Buffer.from(input);
  let text: string;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(bytes);
  } catch {
    throw new Error(
      "C6 source-v3-simple prior identity portable evidence manifest is not UTF-8",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 source-v3-simple prior identity portable evidence manifest is not JSON",
    );
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 source-v3-simple prior identity portable evidence manifest is not canonical JSON",
    );
  }
  return manifestSchema.parse(raw);
}

function resolvePortableEvidenceInput(
  input: C6SourceV3SimplePriorIdentityPortableEvidenceInput,
): C6SourceV3SimplePriorIdentityPortableEvidenceInput {
  return {
    captureA: resolve(input.captureA),
    captureB: resolve(input.captureB),
    outputRoot: resolve(input.outputRoot),
    planPath: resolve(input.planPath),
    protocolPath: resolve(input.protocolPath),
    replayReceiptPath: resolve(input.replayReceiptPath),
    sourceUniversePath: resolve(input.sourceUniversePath),
  };
}

function replayInput(
  input: C6SourceV3SimplePriorIdentityPortableEvidenceInput,
): {
  captureA: string;
  captureB: string;
  planPath: string;
  protocolPath: string;
  sourceUniversePath: string;
} {
  return {
    captureA: input.captureA,
    captureB: input.captureB,
    planPath: input.planPath,
    protocolPath: input.protocolPath,
    sourceUniversePath: input.sourceUniversePath,
  };
}

async function assertOutputRootAbsent(
  outputRoot: string,
): Promise<void> {
  try {
    await lstat(outputRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(
    "C6 source-v3-simple prior identity portable evidence output root already exists",
  );
}

async function buildReproducibleArchive(input: {
  captureRoot: string;
  label: string;
  temporaryRoot: string;
}): Promise<Buffer> {
  const slug = input.label.toLowerCase().replaceAll(" ", "-");
  const firstPath = join(
    input.temporaryRoot,
    `${slug}-first.tar.gz`,
  );
  const secondPath = join(
    input.temporaryRoot,
    `${slug}-second.tar.gz`,
  );
  await createArchive(input.captureRoot, firstPath);
  await createArchive(input.captureRoot, secondPath);
  const [first, second] = await Promise.all([
    readC6StableRegularFile(
      firstPath,
      `first portable ${input.label} archive`,
      MAX_ARCHIVE_BYTES,
      true,
    ),
    readC6StableRegularFile(
      secondPath,
      `second portable ${input.label} archive`,
      MAX_ARCHIVE_BYTES,
      true,
    ),
  ]);
  if (!first.equals(second)) {
    throw new Error(
      `C6 source-v3-simple prior identity portable ${input.label} archive is not byte reproducible`,
    );
  }
  validateTarArchive(first, input.label);
  return first;
}

async function createArchive(
  captureRoot: string,
  outputPath: string,
): Promise<void> {
  const rawTarPath = `${outputPath}.tar`;
  await execFileAsync(
    "tar",
    [
      "--no-xattrs",
      "--format=ustar",
      "-cf",
      rawTarPath,
      "-C",
      captureRoot,
      ".",
    ],
    {
      env: {
        ...process.env,
        COPYFILE_DISABLE: "1",
      },
      maxBuffer: 1_048_576,
    },
  );
  const rawTar = await readC6StableRegularFile(
    rawTarPath,
    "portable uncompressed capture archive",
    MAX_TAR_BYTES,
    true,
  );
  const archive = gzipSync(rawTar);
  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(
      "C6 source-v3-simple prior identity portable archive exceeds compressed byte limit",
    );
  }
  await writeFile(outputPath, archive, {
    flag: "wx",
    mode: 0o600,
  });
}

async function extractArchive(
  archivePath: string,
  outputRoot: string,
): Promise<void> {
  await execFileAsync(
    "tar",
    [
      "--no-xattrs",
      "--no-same-owner",
      "--no-same-permissions",
      "-xzf",
      archivePath,
      "-C",
      outputRoot,
    ],
    {
      env: {
        ...process.env,
        COPYFILE_DISABLE: "1",
      },
      maxBuffer: 1_048_576,
    },
  );
}

async function publishArtifacts(input: {
  captureAArchive: Buffer;
  captureBArchive: Buffer;
  manifestBytes: Buffer;
  outputRoot: string;
}): Promise<void> {
  await writeFile(
    join(
      input.outputRoot,
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_CAPTURE_A_ARCHIVE_PATH,
    ),
    input.captureAArchive,
    {
      flag: "wx",
      mode: 0o600,
    },
  );
  await writeFile(
    join(
      input.outputRoot,
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_CAPTURE_B_ARCHIVE_PATH,
    ),
    input.captureBArchive,
    {
      flag: "wx",
      mode: 0o600,
    },
  );
  await writeFile(
    join(
      input.outputRoot,
      C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_PORTABLE_EVIDENCE_PATH,
    ),
    input.manifestBytes,
    {
      flag: "wx",
      mode: 0o600,
    },
  );
}

function buildManifest(input: {
  captureAArchive: Buffer;
  captureBArchive: Buffer;
  canonicalReplayReceipt: string;
  replayReceipt:
    C6SourceV3SimplePriorRepositoryIdentityReplayReceipt;
}): C6SourceV3SimplePriorIdentityPortableEvidenceManifest {
  return manifestSchema.parse({
    archives: {
      captureA: archiveReference(
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_CAPTURE_A_ARCHIVE_PATH,
        input.captureAArchive,
        input.replayReceipt.captures.captureA,
      ),
      captureB: archiveReference(
        C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_CAPTURE_B_ARCHIVE_PATH,
        input.captureBArchive,
        input.replayReceipt.captures.captureB,
      ),
    },
    artifactKind:
      "c6-source-v3-simple-prior-repository-identity-portable-evidence",
    boundary: {
      candidateManifestFrozen: false,
      captureOriginIndependentlyVerified: false,
      codexRunReady: false,
      externalAuthenticityVerified: false,
      formalCensusPermitted: false,
      independentCaptureProcessProven: false,
      liveNetworkExecutionProven: false,
      portableEvidenceClosureVerified: true,
      priorRepositoryNodeIdExclusionComplete: false,
      repositoryIdentityReplayAgreementObserved: true,
      sourceV3SimpleFrozen: false,
    },
    inputs: input.replayReceipt.inputs,
    replayReceipt: {
      artifactKind:
        "c6-source-v3-simple-prior-repository-identity-observation-replay",
      bytes: Buffer.byteLength(
        input.canonicalReplayReceipt,
      ),
      canonicalJson: input.canonicalReplayReceipt,
      path: C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_REPLAY_PATH,
      schemaVersion: 1,
      sha256: sha256(input.canonicalReplayReceipt),
    },
    schemaVersion: 1,
  });
}

function archiveReference(
  path:
    | typeof C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_CAPTURE_A_ARCHIVE_PATH
    | typeof C6_SOURCE_V3_SIMPLE_PRIOR_IDENTITY_CAPTURE_B_ARCHIVE_PATH,
  archive: Buffer,
  capture:
    C6SourceV3SimplePriorRepositoryIdentityReplayReceipt[
      "captures"
    ][keyof C6SourceV3SimplePriorRepositoryIdentityReplayReceipt["captures"]],
): Record<string, unknown> {
  return {
    bytes: archive.byteLength,
    outerAssetLock: capture.outerAssetLock,
    path,
    rawEvidenceAssetLock: capture.rawEvidenceAssetLock,
    sha256: sha256(archive),
    structure: capture.structure,
  };
}

function assertArchiveReference(
  archive: Buffer,
  reference: {
    bytes: number;
    sha256: string;
  },
  label: string,
): void {
  if (
    archive.byteLength !== reference.bytes ||
    sha256(archive) !== reference.sha256
  ) {
    throw new Error(
      `C6 source-v3-simple prior identity portable ${label} archive reference mismatch`,
    );
  }
}

function assertManifestBindings(
  manifest:
    C6SourceV3SimplePriorIdentityPortableEvidenceManifest,
  receipt:
    C6SourceV3SimplePriorRepositoryIdentityReplayReceipt,
): void {
  const expectedCaptureA = {
    outerAssetLock: receipt.captures.captureA.outerAssetLock,
    rawEvidenceAssetLock:
      receipt.captures.captureA.rawEvidenceAssetLock,
    structure: receipt.captures.captureA.structure,
  };
  const expectedCaptureB = {
    outerAssetLock: receipt.captures.captureB.outerAssetLock,
    rawEvidenceAssetLock:
      receipt.captures.captureB.rawEvidenceAssetLock,
    structure: receipt.captures.captureB.structure,
  };
  if (
    !sameJson(manifest.inputs, receipt.inputs) ||
    !sameJson(
      {
        outerAssetLock:
          manifest.archives.captureA.outerAssetLock,
        rawEvidenceAssetLock:
          manifest.archives.captureA.rawEvidenceAssetLock,
        structure: manifest.archives.captureA.structure,
      },
      expectedCaptureA,
    ) ||
    !sameJson(
      {
        outerAssetLock:
          manifest.archives.captureB.outerAssetLock,
        rawEvidenceAssetLock:
          manifest.archives.captureB.rawEvidenceAssetLock,
        structure: manifest.archives.captureB.structure,
      },
      expectedCaptureB,
    )
  ) {
    throw new Error(
      "C6 source-v3-simple prior identity portable evidence manifest binding mismatch",
    );
  }
}

function validateTarArchive(
  archive: Buffer,
  label: string,
): void {
  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(
      `C6 source-v3-simple prior identity portable ${label} archive exceeds compressed byte limit`,
    );
  }
  let tar: Buffer;
  try {
    tar = gunzipSync(archive, {
      maxOutputLength: MAX_TAR_BYTES,
    });
  } catch (error) {
    if (
      error instanceof RangeError ||
      (error as NodeJS.ErrnoException).code ===
        "ERR_BUFFER_TOO_LARGE"
    ) {
      throw new Error(
        `C6 source-v3-simple prior identity portable ${label} archive exceeds uncompressed byte limit`,
      );
    }
    throw new Error(
      `C6 source-v3-simple prior identity portable ${label} archive is not gzip`,
    );
  }
  if (
    tar.byteLength < TAR_END_BLOCK_BYTES ||
    tar.byteLength % TAR_BLOCK_BYTES !== 0
  ) {
    throw new Error(
      `C6 source-v3-simple prior identity portable ${label} archive has invalid tar length`,
    );
  }
  const paths = new Set<string>();
  let entryCount = 0;
  let offset = 0;
  let reachedEnd = false;
  while (offset < tar.byteLength) {
    const header = tar.subarray(
      offset,
      offset + TAR_BLOCK_BYTES,
    );
    if (header.every((byte) => byte === 0)) {
      const remainder = tar.subarray(offset);
      if (
        remainder.byteLength < TAR_END_BLOCK_BYTES ||
        !remainder.every((byte) => byte === 0)
      ) {
        throw new Error(
          `C6 source-v3-simple prior identity portable ${label} archive has invalid end blocks`,
        );
      }
      reachedEnd = true;
      break;
    }
    assertTarChecksum(header, label);
    entryCount += 1;
    if (entryCount > MAX_TAR_ENTRY_COUNT) {
      throw new Error(
        `C6 source-v3-simple prior identity portable ${label} archive exceeds entry limit`,
      );
    }
    const name = readTarText(
      header,
      0,
      100,
      `${label} archive path`,
    );
    const prefix = readTarText(
      header,
      345,
      155,
      `${label} archive prefix`,
    );
    const path = prefix.length === 0
      ? name
      : `${prefix}/${name}`;
    const canonicalPath = canonicalArchivePath(
      path,
      label,
    );
    if (paths.has(canonicalPath)) {
      throw new Error(
        `C6 source-v3-simple prior identity portable ${label} archive has duplicate path ${path}`,
      );
    }
    paths.add(canonicalPath);
    const type = header[156];
    if (
      type !== 0 &&
      type !== "0".charCodeAt(0) &&
      type !== "5".charCodeAt(0)
    ) {
      throw new Error(
        `C6 source-v3-simple prior identity portable ${label} archive has unsupported archive entry ${path}`,
      );
    }
    const size = readTarOctal(
      header,
      124,
      12,
      `${label} archive size`,
    );
    if (
      type === "5".charCodeAt(0) &&
      size !== 0
    ) {
      throw new Error(
        `C6 source-v3-simple prior identity portable ${label} archive directory has content ${path}`,
      );
    }
    if (
      canonicalPath === "." &&
      type !== "5".charCodeAt(0)
    ) {
      throw new Error(
        `C6 source-v3-simple prior identity portable ${label} archive root is not a directory`,
      );
    }
    const dataBlocks = Math.ceil(size / TAR_BLOCK_BYTES);
    offset += TAR_BLOCK_BYTES +
      dataBlocks * TAR_BLOCK_BYTES;
    if (offset > tar.byteLength) {
      throw new Error(
        `C6 source-v3-simple prior identity portable ${label} archive entry exceeds tar bytes`,
      );
    }
  }
  if (!reachedEnd || paths.size === 0) {
    throw new Error(
      `C6 source-v3-simple prior identity portable ${label} archive is incomplete`,
    );
  }
}

function canonicalArchivePath(
  path: string,
  label: string,
): string {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").includes("..")
  ) {
    throw new Error(
      `C6 source-v3-simple prior identity portable ${label} has unsafe archive path ${path}`,
    );
  }
  const withoutPrefix = path.replace(/^(?:\.\/)+/u, "");
  const canonical = withoutPrefix.replace(/\/+$/u, "");
  if (canonical.length === 0) {
    if (path === "." || path === "./") {
      return ".";
    }
    throw new Error(
      `C6 source-v3-simple prior identity portable ${label} has unsafe archive path ${path}`,
    );
  }
  if (
    canonical.split("/").some(
      (component) =>
        component.length === 0 || component === ".",
    )
  ) {
    throw new Error(
      `C6 source-v3-simple prior identity portable ${label} has unsafe archive path ${path}`,
    );
  }
  return canonical;
}

function assertTarChecksum(
  header: Buffer,
  label: string,
): void {
  const expected = readTarOctal(
    header,
    148,
    8,
    `${label} archive checksum`,
  );
  let actual = 0;
  for (let index = 0; index < header.byteLength; index += 1) {
    actual += index >= 148 && index < 156
      ? 0x20
      : header[index]!;
  }
  if (actual !== expected) {
    throw new Error(
      `C6 source-v3-simple prior identity portable ${label} archive checksum mismatch`,
    );
  }
}

function readTarText(
  header: Buffer,
  offset: number,
  length: number,
  label: string,
): string {
  const field = header.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  const content = nul < 0 ? field : field.subarray(0, nul);
  if (
    nul >= 0 &&
    !field.subarray(nul).every((byte) => byte === 0)
  ) {
    throw new Error(
      `C6 source-v3-simple prior identity portable ${label} has invalid NUL padding`,
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(content);
  } catch {
    throw new Error(
      `C6 source-v3-simple prior identity portable ${label} is not UTF-8`,
    );
  }
  return text;
}

function readTarOctal(
  header: Buffer,
  offset: number,
  length: number,
  label: string,
): number {
  const raw = header
    .subarray(offset, offset + length)
    .toString("ascii");
  const text = raw.replace(/\0.*$/u, "").trim();
  if (!/^[0-7]+$/u.test(text)) {
    throw new Error(
      `C6 source-v3-simple prior identity portable ${label} is not octal`,
    );
  }
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `C6 source-v3-simple prior identity portable ${label} is invalid`,
    );
  }
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
