import { randomBytes } from "node:crypto";
import {
  constants,
  open,
  rename,
  unlink,
} from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";

const FILE_MODE = 0o600;
const LOCK_NAME = "writer-lock.json";
const sha256Schema = z.string().regex(
  /^[a-f0-9]{64}$/u,
);
const writerLockSchema = z.object({
  acquiredAt: z.string().datetime({
    offset: false,
    precision: 3,
  }),
  artifactKind: z.literal(
    "c6-source-v3-simple-census-writer-lock",
  ),
  evaluationId: z.string().min(1),
  executionContractSha256: sha256Schema,
  hostname: z.string().min(1),
  ownerNonce: z.string().regex(/^[a-f0-9]{32}$/u),
  pid: z.number().int().positive(),
  schemaVersion: z.literal(1),
}).strict();

export async function acquireC6SourceV3SimpleCensusWriterLock(
  input: {
    assetRoot: string;
    evaluationId: string;
    executionContractSha256: string;
  },
) {
  const root = await assertC6NoSymlinkPathComponents(
    input.assetRoot,
    "C6 source-v3-simple writer-lock root",
  );
  const owner = writerLockSchema.parse({
    acquiredAt: new Date().toISOString(),
    artifactKind:
      "c6-source-v3-simple-census-writer-lock",
    evaluationId: input.evaluationId,
    executionContractSha256:
      input.executionContractSha256,
    hostname: hostname(),
    ownerNonce: randomBytes(16).toString("hex"),
    pid: process.pid,
    schemaVersion: 1,
  });
  const bytes = canonicalJson(owner);
  const lockPath = join(root, LOCK_NAME);
  for (let recoveryAttempt = 0; recoveryAttempt < 3; recoveryAttempt += 1) {
    if (await createLock(lockPath, root, bytes)) {
      let released = false;
      return {
        owner,
        release: async (): Promise<void> => {
          if (released) {
            return;
          }
          const current = await readLock(lockPath);
          if (
            current.ownerNonce !== owner.ownerNonce ||
            current.pid !== owner.pid ||
            current.hostname !== owner.hostname
          ) {
            throw new Error(
              "C6 source-v3-simple writer-lock ownership mismatch",
            );
          }
          await unlink(lockPath);
          await syncDirectory(root);
          released = true;
        },
      };
    }
    const current = await readLock(lockPath);
    if (
      current.evaluationId !== input.evaluationId ||
      current.executionContractSha256 !==
        input.executionContractSha256 ||
      current.hostname !== hostname() ||
      processExists(current.pid)
    ) {
      throw new Error(
        "C6 source-v3-simple single-writer conflict",
      );
    }
    const stalePath = join(
      root,
      `.writer-lock.stale-${current.ownerNonce}.json`,
    );
    try {
      await rename(lockPath, stalePath);
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        continue;
      }
      throw error;
    }
    await syncDirectory(root);
    await unlink(stalePath);
    await syncDirectory(root);
  }
  throw new Error(
    "C6 source-v3-simple single-writer recovery conflict",
  );
}

async function createLock(
  path: string,
  root: string,
  bytes: Buffer,
): Promise<boolean> {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      FILE_MODE,
    );
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      return false;
    }
    throw error;
  }
  try {
    await handle.writeFile(bytes);
    await handle.chmod(FILE_MODE);
    await handle.sync();
  } catch (error) {
    await unlink(path).catch(() => undefined);
    throw error;
  } finally {
    await handle.close();
  }
  await syncDirectory(root);
  return true;
}

async function readLock(
  path: string,
): Promise<z.infer<typeof writerLockSchema>> {
  const bytes = await readC6StableRegularFile(
    path,
    "C6 source-v3-simple writer lock",
    undefined,
    true,
  );
  const text = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(bytes);
  const raw = JSON.parse(text) as unknown;
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 source-v3-simple writer lock is not canonical JSON",
    );
  }
  return writerLockSchema.parse(raw);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasErrorCode(error, "ESRCH");
  }
}

function canonicalJson(value: unknown): Buffer {
  return Buffer.from(
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
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
