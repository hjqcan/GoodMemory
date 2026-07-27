import {
  mkdtemp,
  rm,
} from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "bun:test";

import {
  C6_SOURCE_V4_BOUNDED_V3_EVALUATION_ID,
  C6_SOURCE_V4_BOUNDED_V3_EXECUTION_CONTRACT_SHA256,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-contract";
import {
  withC6SourceV4BoundedV3SnapshotLock,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-snapshot";
import {
  acquireC6SourceV3SimpleCensusWriterLock,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-lock";

it("holds the historical source writer lock across snapshot work and releases it afterward", async () => {
  const root = await mkdtemp(join(
    process.cwd(),
    ".goodmemory-c6-v4-source-lock-",
  ));
  try {
    const result =
      await withC6SourceV4BoundedV3SnapshotLock(
        root,
        async () => {
          await expect(
            acquireC6SourceV3SimpleCensusWriterLock({
              assetRoot: root,
              evaluationId:
                C6_SOURCE_V4_BOUNDED_V3_EVALUATION_ID,
              executionContractSha256:
                C6_SOURCE_V4_BOUNDED_V3_EXECUTION_CONTRACT_SHA256,
            }),
          ).rejects.toThrow("single-writer conflict");
          return "locked";
        },
      );
    expect(result).toBe("locked");

    const next =
      await acquireC6SourceV3SimpleCensusWriterLock({
        assetRoot: root,
        evaluationId:
          C6_SOURCE_V4_BOUNDED_V3_EVALUATION_ID,
        executionContractSha256:
          C6_SOURCE_V4_BOUNDED_V3_EXECUTION_CONTRACT_SHA256,
      });
    await next.release();
  } finally {
    await rm(root, {
      force: true,
      recursive: true,
    });
  }
});
