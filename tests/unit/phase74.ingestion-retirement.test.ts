import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

import {
  archivePhase74IngestionSnapshot,
  restorePhase74IngestionSnapshot,
} from "../../src/eval/phase74IngestionRetirement";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const INGESTION_KEY = "a".repeat(64);
const RUN_ID = "phase74-run-1";
const STAGE_SEAL_SHA256 = "b".repeat(64);
const SQLITE_BYTES = Buffer.from(
  "SQLite format 3\u0000phase-74-ingestion-snapshot\n".repeat(256),
  "utf8",
);

describe("Phase 74 ingestion retirement", () => {
  it("archives and verifies the SQLite bytes before unlinking the source", async () => {
    await withDirectory(async (root) => {
      const paths = await writeSnapshot(root);
      const receiptBlocker = join(root, "receipt-parent");
      await writeFile(receiptBlocker, "not a directory", "utf8");

      await expect(archivePhase74IngestionSnapshot(archiveInput({
        ...paths,
        archiveRoot: join(root, "archive"),
        receiptPath: join(receiptBlocker, "receipt.json"),
      }))).rejects.toThrow();

      expect(await readFile(paths.sourceSqlitePath)).toEqual(SQLITE_BYTES);
      expect(await readFile(paths.sourceManifestPath, "utf8"))
        .toContain(INGESTION_KEY);

      const sourceSha256 = sha256(SQLITE_BYTES);
      const archivePath = contentAddressedArchivePath(
        join(root, "archive"),
        sourceSha256,
      );
      expect(await gunzipAsync(await readFile(archivePath)))
        .toEqual(SQLITE_BYTES);
    });
  });

  it("restores the exact source bytes and verifies both source hashes", async () => {
    await withDirectory(async (root) => {
      const paths = await writeSnapshot(root);
      const archiveRoot = join(root, "archive");
      const receiptPath = join(root, "receipts", "fact-only.json");
      const receipt = await archivePhase74IngestionSnapshot(archiveInput({
        ...paths,
        archiveRoot,
        receiptPath,
      }));
      const sourceSha256 = sha256(SQLITE_BYTES);
      const manifestBytes = await readFile(paths.sourceManifestPath);

      expect(receipt).toMatchObject({
        archive: {
          path: contentAddressedArchivePath(archiveRoot, sourceSha256),
        },
        ingestionKey: INGESTION_KEY,
        manifest: {
          path: paths.sourceManifestPath,
          sha256: sha256(manifestBytes),
          sizeBytes: manifestBytes.byteLength,
        },
        representation: "fact-only",
        restoreVerification: {
          sha256: sourceSha256,
          sizeBytes: SQLITE_BYTES.byteLength,
        },
        runId: RUN_ID,
        schemaVersion: 1,
        source: {
          path: paths.sourceSqlitePath,
          sha256: sourceSha256,
          sizeBytes: SQLITE_BYTES.byteLength,
        },
        stage: "E1",
        stageSealSha256: STAGE_SEAL_SHA256,
      });
      expect(await exists(paths.sourceSqlitePath)).toBe(false);
      expect(await exists(paths.sourceManifestPath)).toBe(true);

      const destinationSqlitePath = join(root, "restored", "memory.sqlite");
      await expect(restorePhase74IngestionSnapshot({
        destinationSqlitePath,
        receiptPath,
      })).resolves.toEqual(receipt);

      const restored = await readFile(destinationSqlitePath);
      expect(restored).toEqual(SQLITE_BYTES);
      expect(sha256(restored)).toBe(receipt.source.sha256);
      expect(sha256(restored)).toBe(receipt.restoreVerification.sha256);
    });
  });

  it("reuses one durable receipt and one content-addressed archive idempotently", async () => {
    await withDirectory(async (root) => {
      const paths = await writeSnapshot(root);
      const archiveRoot = join(root, "archive");
      const receiptPath = join(root, "receipts", "fact-only.json");
      const input = archiveInput({
        ...paths,
        archiveRoot,
        receiptPath,
      });

      const first = await archivePhase74IngestionSnapshot(input);
      const firstReceiptBytes = await readFile(receiptPath);
      const second = await archivePhase74IngestionSnapshot(input);

      expect(second).toEqual(first);
      expect(await readFile(receiptPath)).toEqual(firstReceiptBytes);
      expect(await readdir(dirname(first.archive.path))).toEqual([
        `${first.source.sha256}.sqlite.gz`,
      ]);
      expect(await exists(paths.sourceSqlitePath)).toBe(false);
    });
  });

  it("fails closed when the gzip or the decompressed source bytes are corrupted", async () => {
    await withDirectory(async (root) => {
      const paths = await writeSnapshot(root);
      const receiptPath = join(root, "receipts", "fact-only.json");
      const receipt = await archivePhase74IngestionSnapshot(archiveInput({
        ...paths,
        archiveRoot: join(root, "archive"),
        receiptPath,
      }));
      const destinationSqlitePath = join(root, "restored", "memory.sqlite");

      await writeFile(receipt.archive.path, "corrupt gzip", "utf8");
      await expect(restorePhase74IngestionSnapshot({
        destinationSqlitePath,
        receiptPath,
      })).rejects.toThrow();
      expect(await exists(destinationSqlitePath)).toBe(false);

      const wrongSourceBytes = Buffer.from("SQLite format 3\u0000wrong source");
      const wrongArchiveBytes = await gzipAsync(wrongSourceBytes, { level: 1 });
      await writeFile(receipt.archive.path, wrongArchiveBytes);
      await writeFile(receiptPath, `${JSON.stringify({
        ...receipt,
        archive: {
          ...receipt.archive,
          sha256: sha256(wrongArchiveBytes),
          sizeBytes: wrongArchiveBytes.byteLength,
        },
      })}\n`, "utf8");

      await expect(restorePhase74IngestionSnapshot({
        destinationSqlitePath,
        receiptPath,
      })).rejects.toThrow();
      expect(await exists(destinationSqlitePath)).toBe(false);
    });
  });

  it("refuses retirement while a SQLite WAL or SHM sidecar exists", async () => {
    for (const sidecarSuffix of ["-wal", "-shm"]) {
      await withDirectory(async (root) => {
        const paths = await writeSnapshot(root);
        const archiveRoot = join(root, "archive");
        const receiptPath = join(root, "receipts", "fact-only.json");
        await writeFile(
          `${paths.sourceSqlitePath}${sidecarSuffix}`,
          "uncheckpointed state",
          "utf8",
        );

        await expect(archivePhase74IngestionSnapshot(archiveInput({
          ...paths,
          archiveRoot,
          receiptPath,
        }))).rejects.toThrow();

        expect(await readFile(paths.sourceSqlitePath)).toEqual(SQLITE_BYTES);
        expect(await exists(receiptPath)).toBe(false);
        expect(await exists(archiveRoot)).toBe(false);
      });
    }
  });
});

function archiveInput(input: {
  archiveRoot: string;
  receiptPath: string;
  sourceManifestPath: string;
  sourceSqlitePath: string;
}) {
  return {
    ...input,
    ingestionKey: INGESTION_KEY,
    representation: "fact-only",
    runId: RUN_ID,
    stage: "E1" as const,
    stageSealSha256: STAGE_SEAL_SHA256,
  };
}

async function writeSnapshot(root: string): Promise<{
  sourceManifestPath: string;
  sourceSqlitePath: string;
}> {
  const directory = join(root, "run", "ingestion", INGESTION_KEY);
  const sourceManifestPath = join(directory, "manifest.json");
  const sourceSqlitePath = join(directory, "memory.sqlite");
  await mkdir(directory, { recursive: true });
  await writeFile(sourceManifestPath, `${JSON.stringify({
    key: INGESTION_KEY,
    representation: "fact-only",
    schemaVersion: 8,
  })}\n`, "utf8");
  await writeFile(sourceSqlitePath, SQLITE_BYTES);
  return { sourceManifestPath, sourceSqlitePath };
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

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function withDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "phase74-retirement-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
