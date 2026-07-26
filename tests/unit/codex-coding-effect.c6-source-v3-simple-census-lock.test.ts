import { hostname } from "node:os";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  acquireC6SourceV3SimpleCensusWriterLock,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-lock";

const EVALUATION_ID =
  "goodmemory-c6-codex-coding-effect-source-v3-simple-v1";
const CONTRACT_SHA = "a".repeat(64);

describe("C6 source-v3-simple single-writer lock", () => {
  it("admits exactly one writer and releases only its own lock", async () => {
    await withRoot(async (root) => {
      const lock =
        await acquireC6SourceV3SimpleCensusWriterLock({
          assetRoot: root,
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
        });
      await expect(
        acquireC6SourceV3SimpleCensusWriterLock({
          assetRoot: root,
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
        }),
      ).rejects.toThrow("single-writer conflict");
      expect(
        JSON.parse(
          await readFile(
            join(root, "writer-lock.json"),
            "utf8",
          ),
        ),
      ).toMatchObject({
        evaluationId: EVALUATION_ID,
        ownerNonce: lock.owner.ownerNonce,
        pid: process.pid,
      });

      await lock.release();
      const next =
        await acquireC6SourceV3SimpleCensusWriterLock({
          assetRoot: root,
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
        });
      await next.release();
    });
  });

  it("atomically recovers a well-formed local lock whose process no longer exists", async () => {
    await withRoot(async (root) => {
      await writeFile(
        join(root, "writer-lock.json"),
        `${JSON.stringify({
          acquiredAt: "2026-07-26T12:00:00.000Z",
          artifactKind:
            "c6-source-v3-simple-census-writer-lock",
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
          hostname: hostname(),
          ownerNonce: "f".repeat(32),
          pid: 99_999_999,
          schemaVersion: 1,
        }, null, 2)}\n`,
      );

      const lock =
        await acquireC6SourceV3SimpleCensusWriterLock({
          assetRoot: root,
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
        });
      expect(lock.owner.pid).toBe(process.pid);
      expect(lock.owner.ownerNonce).not.toBe(
        "f".repeat(32),
      );
      await lock.release();
    });
  });
});

async function withRoot(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(
    process.cwd(),
    ".goodmemory-c6-census-lock-",
  ));
  try {
    await run(root);
  } finally {
    await rm(root, {
      force: true,
      recursive: true,
    });
  }
}
