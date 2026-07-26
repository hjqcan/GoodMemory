import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  loadC6MultiSWERelationshipDiscovery,
  serializeC6MultiSWERelationshipDiscovery,
} from "../../../scripts/codex-coding-effect/c6-multi-swe-relationship-discovery";
import {
  runC6MultiSWERelationshipDiscoverySnapshotCommand,
} from "../../../scripts/snapshot-codex-coding-effect-c6-multi-swe-relationship-discovery";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_ROOT =
  process.env.GOODMEMORY_TEST_C6_MULTI_SWE_SOURCE_ROOT?.trim();
const README_FILE =
  process.env.GOODMEMORY_TEST_C6_MULTI_SWE_README_FILE?.trim();
const maybeDescribe = SOURCE_ROOT && README_FILE ? describe : describe.skip;

setDefaultTimeout(120_000);

maybeDescribe("Codex coding-effect C6 Multi-SWE relationship replay", () => {
  it("replays the complete loader and refuses to overwrite its output", async () => {
    const sourceRoot = requiredExternalPath(
      SOURCE_ROOT,
      "GOODMEMORY_TEST_C6_MULTI_SWE_SOURCE_ROOT",
    );
    const readmeFile = requiredExternalPath(
      README_FILE,
      "GOODMEMORY_TEST_C6_MULTI_SWE_README_FILE",
    );
    const artifactPath = join(
      REPOSITORY_ROOT,
      "fixtures/codex-coding-effect/c6-source-pool",
      "multi-swe-under-1mb-56ff018.relationship-discovery.json",
    );
    const expectedBytes = await readFile(artifactPath);
    const expectedText = expectedBytes.toString("utf8");
    const input = exactInput(sourceRoot, readmeFile);
    const snapshot = await loadC6MultiSWERelationshipDiscovery(input);
    const replayedBytes = serializeC6MultiSWERelationshipDiscovery(snapshot);

    expect(replayedBytes).toBe(expectedText);
    expect(snapshot.evidenceBoundary).toMatchObject({
      localMergeOrderAndAncestryVerifiedCandidates: 1,
      orderedOriginalRequestChronologyVerifiedCandidates: 0,
    });

    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-c6-multi-swe-replay-"),
    );
    try {
      const output = join(temporaryRoot, "relationship-discovery.json");
      const args = exactArgs(input, output);
      const result =
        await runC6MultiSWERelationshipDiscoverySnapshotCommand(args);

      expect(result).toMatchObject({
        candidateTriples: 1,
        observedRows: 261,
        output,
        outputSha256: sha256(expectedBytes),
        sourceFiles: 24,
      });
      await expect(
        runC6MultiSWERelationshipDiscoverySnapshotCommand(args),
      ).rejects.toThrow();
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("fails closed when a chronology receipt is mutated", async () => {
    const sourceRoot = requiredExternalPath(
      SOURCE_ROOT,
      "GOODMEMORY_TEST_C6_MULTI_SWE_SOURCE_ROOT",
    );
    const readmeFile = requiredExternalPath(
      README_FILE,
      "GOODMEMORY_TEST_C6_MULTI_SWE_README_FILE",
    );
    const input = exactInput(sourceRoot, readmeFile);
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-c6-multi-swe-mutation-"),
    );
    try {
      const mutatedPullPath = join(temporaryRoot, "pull-2896.json");
      const receipt = JSON.parse(
        await readFile(input.pull2896, "utf8"),
      ) as { created_at: string };
      receipt.created_at = "2024-08-26T00:00:00Z";
      await writeFile(
        mutatedPullPath,
        `${JSON.stringify(receipt, null, 2)}\n`,
        "utf8",
      );

      await expect(loadC6MultiSWERelationshipDiscovery({
        ...input,
        pull2896: mutatedPullPath,
      })).rejects.toThrow(
        "C6 Multi-SWE bat receipt pull2896 does not match its frozen",
      );
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });
});

function exactInput(sourceRoot: string, readmeFile: string) {
  const sourcePoolRoot = join(
    REPOSITORY_ROOT,
    "fixtures/codex-coding-effect/c6-source-pool",
  );
  const receiptRoot = join(
    sourcePoolRoot,
    "multi-swe-under-1mb-56ff018-receipts",
  );
  return {
    compare2896To3189: join(receiptRoot, "compare-2896-to-3189.json"),
    compare3075To2896: join(receiptRoot, "compare-3075-to-2896.json"),
    existingSourcePool: join(
      sourcePoolRoot,
      "swe-bench-multilingual-e5c585e.source-pool.json",
    ),
    issue1746: join(receiptRoot, "issue-1746.json"),
    issue3073: join(receiptRoot, "issue-3073.json"),
    issue3188: join(receiptRoot, "issue-3188.json"),
    pull2896: join(receiptRoot, "pull-2896.json"),
    pull3075: join(receiptRoot, "pull-3075.json"),
    pull3189: join(receiptRoot, "pull-3189.json"),
    readmeFile,
    sourceRoot,
    treeReceipt: join(receiptRoot, "hf-tree.json"),
  };
}

function exactArgs(
  input: ReturnType<typeof exactInput>,
  output: string,
): string[] {
  return [
    `--source-root=${input.sourceRoot}`,
    `--readme-file=${input.readmeFile}`,
    `--tree-receipt=${input.treeReceipt}`,
    `--existing-source-pool=${input.existingSourcePool}`,
    `--pull-3075=${input.pull3075}`,
    `--pull-2896=${input.pull2896}`,
    `--pull-3189=${input.pull3189}`,
    `--issue-3073=${input.issue3073}`,
    `--issue-1746=${input.issue1746}`,
    `--issue-3188=${input.issue3188}`,
    `--compare-3075-to-2896=${input.compare3075To2896}`,
    `--compare-2896-to-3189=${input.compare2896To3189}`,
    `--output=${output}`,
  ];
}

function requiredExternalPath(
  value: string | undefined,
  name: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for the C6 Multi-SWE replay gate`);
  }
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
