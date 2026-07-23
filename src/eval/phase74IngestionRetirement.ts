import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  open,
  readFile,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

import { z } from "zod";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const fileRecordSchema = z.strictObject({
  path: z.string().min(1),
  sha256: sha256Schema,
  sizeBytes: z.number().int().nonnegative(),
});
const restoreVerificationSchema = z.strictObject({
  sha256: sha256Schema,
  sizeBytes: z.number().int().nonnegative(),
});
const phase74IngestionArchiveReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  stage: z.enum(["E1", "E2", "E3", "E4"]),
  ingestionKey: sha256Schema,
  representation: z.string().min(1),
  stageSealSha256: sha256Schema,
  manifest: fileRecordSchema,
  source: fileRecordSchema,
  archive: fileRecordSchema,
  restoreVerification: restoreVerificationSchema,
});

export type Phase74IngestionArchiveReceipt = z.infer<
  typeof phase74IngestionArchiveReceiptSchema
>;

export interface ArchivePhase74IngestionSnapshotInput {
  archiveRoot: string;
  ingestionKey: string;
  receiptPath: string;
  representation: string;
  runId: string;
  sourceManifestPath: string;
  sourceSqlitePath: string;
  stage: "E1" | "E2" | "E3" | "E4";
  stageSealSha256: string;
}

export interface RestorePhase74IngestionSnapshotInput {
  destinationSqlitePath: string;
  expectedIngestionKey?: string;
  expectedRepresentation?: string;
  expectedSourceSqlitePath?: string;
  receiptPath: string;
}

export interface RetirePhase74StageIngestionSnapshotsInput {
  runDirectory: string;
  runId: string;
  snapshots: readonly {
    costTrace?: {
      ingestionKey: string;
      representation: string;
    };
  }[];
  stage: "E1" | "E2" | "E3" | "E4";
  stageSealSha256: string;
}

export async function archivePhase74IngestionSnapshot(
  input: ArchivePhase74IngestionSnapshotInput,
): Promise<Phase74IngestionArchiveReceipt> {
  assertSha256(input.ingestionKey, "ingestion key");
  assertSha256(input.stageSealSha256, "stage seal");
  await assertNoSqliteSidecars(input.sourceSqlitePath);

  const sourceBytes = await readOptional(input.sourceSqlitePath);
  if (sourceBytes === null) {
    const receipt = parseReceipt(await readFile(input.receiptPath));
    assertReceiptMatchesInput(receipt, input);
    await verifyFile(receipt.manifest);
    await verifyArchive(receipt);
    return receipt;
  }

  const manifestBytes = await readFile(input.sourceManifestPath);
  const sourceSha256 = sha256(sourceBytes);
  const archivePath = contentAddressedArchivePath(
    input.archiveRoot,
    sourceSha256,
  );
  const archiveBytes = await gzipAsync(sourceBytes, { level: 1 });
  const receipt = phase74IngestionArchiveReceiptSchema.parse({
    schemaVersion: 1,
    runId: input.runId,
    stage: input.stage,
    ingestionKey: input.ingestionKey,
    representation: input.representation,
    stageSealSha256: input.stageSealSha256,
    manifest: fileRecord(input.sourceManifestPath, manifestBytes),
    source: fileRecord(input.sourceSqlitePath, sourceBytes),
    archive: fileRecord(archivePath, archiveBytes),
    restoreVerification: {
      sha256: sourceSha256,
      sizeBytes: sourceBytes.byteLength,
    },
  });

  await writeCreateOnlyExact(archivePath, archiveBytes);
  await verifyArchive(receipt);
  await assertSourceUnchanged(receipt);
  await assertNoSqliteSidecars(input.sourceSqlitePath);
  await writeCreateOnlyExact(
    input.receiptPath,
    Buffer.from(serializeReceipt(receipt)),
  );
  assertReceiptMatchesInput(
    parseReceipt(await readFile(input.receiptPath)),
    input,
  );
  await assertSourceUnchanged(receipt);
  await assertNoSqliteSidecars(input.sourceSqlitePath);
  await unlink(input.sourceSqlitePath);
  return receipt;
}

export async function restorePhase74IngestionSnapshot(
  input: RestorePhase74IngestionSnapshotInput,
): Promise<Phase74IngestionArchiveReceipt> {
  const receipt = parseReceipt(await readFile(input.receiptPath));
  if (
    (input.expectedIngestionKey !== undefined &&
      receipt.ingestionKey !== input.expectedIngestionKey) ||
    (input.expectedRepresentation !== undefined &&
      receipt.representation !== input.expectedRepresentation) ||
    (input.expectedSourceSqlitePath !== undefined &&
      receipt.source.path !== input.expectedSourceSqlitePath)
  ) {
    throw new Error("Phase 74 ingestion restore identity drifted.");
  }
  await verifyFile(receipt.manifest);
  const sourceBytes = await verifyArchive(receipt);
  await writeCreateOnlyExact(input.destinationSqlitePath, sourceBytes);
  assertFileBytes(
    receipt.restoreVerification,
    await readFile(input.destinationSqlitePath),
    "restored SQLite",
  );
  return receipt;
}

export async function retirePhase74StageIngestionSnapshots(
  input: RetirePhase74StageIngestionSnapshotsInput,
): Promise<Phase74IngestionArchiveReceipt[]> {
  const representations = input.stage === "E1"
    ? new Set(["fact-only", "raw-only"])
    : input.stage === "E3"
      ? new Set(["atomic-contextual-raw-pointer"])
      : new Set<string>();
  if (representations.size === 0) {
    return [];
  }
  const selected = new Map<string, string>();
  for (const snapshot of input.snapshots) {
    const trace = snapshot.costTrace;
    if (trace === undefined || !representations.has(trace.representation)) {
      continue;
    }
    const existing = selected.get(trace.ingestionKey);
    if (existing !== undefined && existing !== trace.representation) {
      throw new Error("Phase 74 ingestion retirement representation drifted.");
    }
    selected.set(trace.ingestionKey, trace.representation);
  }
  const entries = [...selected].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const receipts = new Array<Phase74IngestionArchiveReceipt>(entries.length);
  let next = 0;
  await Promise.all(Array.from(
    { length: Math.min(4, entries.length) },
    async () => {
      while (next < entries.length) {
        const index = next;
        next += 1;
        const [ingestionKey, representation] = entries[index]!;
        const directory = join(input.runDirectory, "ingestion", ingestionKey);
        receipts[index] = await archivePhase74IngestionSnapshot({
          archiveRoot: join(input.runDirectory, "ingestion-archive"),
          ingestionKey,
          receiptPath: join(
            input.runDirectory,
            "ingestion-retirement",
            `${ingestionKey}.json`,
          ),
          representation,
          runId: input.runId,
          sourceManifestPath: join(directory, "manifest.json"),
          sourceSqlitePath: join(directory, "memory.sqlite"),
          stage: input.stage,
          stageSealSha256: input.stageSealSha256,
        });
      }
    },
  ));
  return receipts;
}

function parseReceipt(
  bytes: Uint8Array,
): Phase74IngestionArchiveReceipt {
  const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  const receipt = phase74IngestionArchiveReceiptSchema.parse(value);
  if (
    receipt.source.sha256 !== receipt.restoreVerification.sha256 ||
    receipt.source.sizeBytes !== receipt.restoreVerification.sizeBytes ||
    basename(receipt.archive.path) !==
      `${receipt.source.sha256}.sqlite.gz`
  ) {
    throw new Error("Phase 74 ingestion archive receipt is inconsistent.");
  }
  return receipt;
}

function assertReceiptMatchesInput(
  receipt: Phase74IngestionArchiveReceipt,
  input: ArchivePhase74IngestionSnapshotInput,
): void {
  if (
    receipt.runId !== input.runId ||
    receipt.stage !== input.stage ||
    receipt.ingestionKey !== input.ingestionKey ||
    receipt.representation !== input.representation ||
    receipt.stageSealSha256 !== input.stageSealSha256 ||
    receipt.manifest.path !== input.sourceManifestPath ||
    receipt.source.path !== input.sourceSqlitePath ||
    receipt.archive.path !== contentAddressedArchivePath(
      input.archiveRoot,
      receipt.source.sha256,
    )
  ) {
    throw new Error("Phase 74 ingestion archive receipt identity drifted.");
  }
}

async function verifyArchive(
  receipt: Phase74IngestionArchiveReceipt,
): Promise<Buffer> {
  const archiveBytes = await readFile(receipt.archive.path);
  assertFileBytes(receipt.archive, archiveBytes, "gzip archive");
  const sourceBytes = await gunzipAsync(archiveBytes);
  assertFileBytes(receipt.source, sourceBytes, "archived SQLite");
  assertFileBytes(
    receipt.restoreVerification,
    sourceBytes,
    "archive restore verification",
  );
  return sourceBytes;
}

async function verifyFile(record: FileRecord): Promise<void> {
  assertFileBytes(record, await readFile(record.path), "retained manifest");
}

async function assertSourceUnchanged(
  receipt: Phase74IngestionArchiveReceipt,
): Promise<void> {
  assertFileBytes(
    receipt.source,
    await readFile(receipt.source.path),
    "source SQLite",
  );
}

type FileRecord = z.infer<typeof fileRecordSchema>;

function fileRecord(path: string, bytes: Uint8Array): FileRecord {
  return {
    path,
    sha256: sha256(bytes),
    sizeBytes: bytes.byteLength,
  };
}

function assertFileBytes(
  record: Pick<FileRecord, "sha256" | "sizeBytes">,
  bytes: Uint8Array,
  label: string,
): void {
  if (bytes.byteLength !== record.sizeBytes || sha256(bytes) !== record.sha256) {
    throw new Error(`Phase 74 ${label} digest drifted.`);
  }
}

function contentAddressedArchivePath(
  archiveRoot: string,
  sourceSha256: string,
): string {
  return join(
    archiveRoot,
    "sha256",
    sourceSha256.slice(0, 2),
    `${sourceSha256}.sqlite.gz`,
  );
}

function serializeReceipt(receipt: Phase74IngestionArchiveReceipt): string {
  return `${JSON.stringify(receipt)}\n`;
}

async function assertNoSqliteSidecars(sqlitePath: string): Promise<void> {
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    if (await pathExists(`${sqlitePath}${suffix}`)) {
      throw new Error(
        `Phase 74 ingestion retirement refused SQLite sidecar ${suffix}.`,
      );
    }
  }
}

async function writeCreateOnlyExact(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const existing = await readOptional(path);
  if (existing !== null) {
    assertExactBytes(path, existing, bytes);
    return;
  }

  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(
    directory,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let created = false;
  try {
    const handle = await open(temporaryPath, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporaryPath, path);
      created = true;
    } catch (error) {
      if (!isErrno(error, "EEXIST")) {
        throw error;
      }
      assertExactBytes(path, await readFile(path), bytes);
    }
  } finally {
    await removeIfPresent(temporaryPath);
  }
  if (created) {
    await syncDirectory(directory);
  }
}

function assertExactBytes(
  path: string,
  actual: Uint8Array,
  expected: Uint8Array,
): void {
  if (!Buffer.from(actual).equals(Buffer.from(expected))) {
    throw new Error(`Phase 74 create-only artifact drifted at ${path}.`);
  }
}

async function readOptional(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) {
      throw error;
    }
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function assertSha256(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`Phase 74 ${label} must be a SHA-256 digest.`);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === code
  );
}
