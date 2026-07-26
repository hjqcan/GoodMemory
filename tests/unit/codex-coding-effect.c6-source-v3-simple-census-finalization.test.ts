import { createHash } from "node:crypto";
import {
  link,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  C6SourceV3SimpleSecretLeakError,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-errors";
import {
  assertC6SourceV3SimpleTreeHasNoSecret,
  verifyC6SourceV3SimpleCensusAssetLock,
  verifyC6SourceV3SimpleFrozenInputClosure,
  writeC6SourceV3SimpleCensusAssetLock,
  writeC6SourceV3SimpleFrozenInputClosure,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-finalization";
import {
  commitC6SourceV3SimpleCreateOnlyBytes,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-ledger";
import {
  acquireC6SourceV3SimpleCensusWriterLock,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-lock";
import {
  createC6SourceV3SimpleTestExpectedFrozenInputs,
} from "./codex-coding-effect.c6-source-v3-simple-census-test-support";

const CONTRACT_SHA = "a".repeat(64);
const EVALUATION_ID =
  "goodmemory-c6-codex-coding-effect-source-v3-simple-v1";
const fixtureBytes = Buffer.from("abc");
const frozenInputs = [{
  bytes: fixtureBytes.length,
  label: "fixture",
  path: "fixture.json",
  sha256: createHash("sha256")
    .update(fixtureBytes)
    .digest("hex"),
}];
const expected =
  createC6SourceV3SimpleTestExpectedFrozenInputs({
  evaluationId: EVALUATION_ID,
  executionContractSha256: CONTRACT_SHA,
  frozenInputs,
  });

describe("C6 source-v3-simple finalization closure", () => {
  it("binds exact frozen inputs and permits only terminal after the asset lock", async () => {
    await withRoot(async (root) => {
      await writeFile(
        join(root, "fixture.json"),
        fixtureBytes,
      );
      const frozen =
        await writeC6SourceV3SimpleFrozenInputClosure({
          assetRoot: root,
          expected,
          repositoryRoot: root,
        });
      await verifyC6SourceV3SimpleFrozenInputClosure({
        assetRoot: root,
        expected,
        reference: frozen,
        repositoryRoot: root,
      });
      await writeFile(
        join(root, "fixture.json"),
        "mutated",
      );
      await expect(
        verifyC6SourceV3SimpleFrozenInputClosure({
          assetRoot: root,
          expected,
          reference: frozen,
          repositoryRoot: root,
        }),
      ).rejects.toThrow("fixture");
      await writeFile(
        join(root, "fixture.json"),
        fixtureBytes,
      );
      await commitC6SourceV3SimpleCreateOnlyBytes(
        root,
        "census-receipt.json",
        Buffer.from("{}\n"),
      );
      const writerLock =
        await acquireC6SourceV3SimpleCensusWriterLock({
          assetRoot: root,
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
        });
      const lock =
        await writeC6SourceV3SimpleCensusAssetLock({
          assetRoot: root,
          expectedFrozenInputs: expected,
          frozenInputClosureSha256: frozen.sha256,
        });
      await verifyC6SourceV3SimpleFrozenInputClosure({
        assetRoot: root,
        expected,
        reference: frozen,
        repositoryRoot: root,
      });
      await verifyC6SourceV3SimpleCensusAssetLock({
        assetRoot: root,
        expectedFrozenInputs: expected,
        frozenInputClosureSha256: frozen.sha256,
        reference: lock,
      });
      await expect(
        verifyC6SourceV3SimpleCensusAssetLock({
          assetRoot: root,
          expectedFrozenInputs: expected,
          frozenInputClosureSha256: "b".repeat(64),
          reference: lock,
        }),
      ).rejects.toThrow("frozen input closure mismatch");
      await writerLock.release();
      await verifyC6SourceV3SimpleCensusAssetLock({
        assetRoot: root,
        expectedFrozenInputs: expected,
        frozenInputClosureSha256: frozen.sha256,
        reference: lock,
      });
      await commitC6SourceV3SimpleCreateOnlyBytes(
        root,
        "terminal.json",
        Buffer.from("{}\n"),
      );
      await verifyC6SourceV3SimpleCensusAssetLock({
        assetRoot: root,
        expectedFrozenInputs: expected,
        frozenInputClosureSha256: frozen.sha256,
        reference: lock,
      });
      await writeFile(
        join(root, "late-artifact.json"),
        "{}\n",
      );
      await expect(
        verifyC6SourceV3SimpleCensusAssetLock({
          assetRoot: root,
          expectedFrozenInputs: expected,
          frozenInputClosureSha256: frozen.sha256,
          reference: lock,
        }),
      ).rejects.toThrow("asset lock");
    });
  });

  it("rejects a secret anywhere in the recursive artifact tree", async () => {
    await withRoot(async (root) => {
      await writeFile(
        join(root, "artifact.json"),
        "{\"value\":\"secret-token\"}\n",
      );
      await expect(
        assertC6SourceV3SimpleTreeHasNoSecret({
          assetRoot: root,
          secret: Buffer.from("secret-token"),
        }),
      ).rejects.toBeInstanceOf(
        C6SourceV3SimpleSecretLeakError,
      );
    });
  });

  it("does not lock a linked pending publication artifact into the asset closure", async () => {
    await withRoot(async (root) => {
      await writeFile(
        join(root, "fixture.json"),
        fixtureBytes,
      );
      const frozen =
        await writeC6SourceV3SimpleFrozenInputClosure({
          assetRoot: root,
          expected,
          repositoryRoot: root,
        });
      await commitC6SourceV3SimpleCreateOnlyBytes(
        root,
        "census-receipt.json",
        Buffer.from("{}\n"),
      );
      await link(
        join(root, "census-receipt.json"),
        join(root, ".census-receipt.json.pending"),
      );

      await expect(
        writeC6SourceV3SimpleCensusAssetLock({
          assetRoot: root,
          expectedFrozenInputs: expected,
          frozenInputClosureSha256: frozen.sha256,
        }),
      ).rejects.toThrow("pending");
    });
  });

  it("durably writes the expected closure before reporting current input mutation", async () => {
    await withRoot(async (root) => {
      await writeFile(
        join(root, "fixture.json"),
        "mutated",
      );

      await expect(
        writeC6SourceV3SimpleFrozenInputClosure({
          assetRoot: root,
          expected,
          repositoryRoot: root,
        }),
      ).rejects.toThrow("fixture");
      expect(
        await readFile(
          join(root, "frozen-input-closure.json"),
          "utf8",
        ),
      ).toContain(
        "\"c6-source-v3-simple-frozen-input-closure\"",
      );
    });
  });
});

async function withRoot(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(
    process.cwd(),
    ".goodmemory-c6-census-finalization-",
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
