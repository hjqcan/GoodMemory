import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  parseC6RealHistoryYieldSnapshotCliOptions,
  runC6RealHistoryYieldSnapshotCommand,
} from "../../scripts/snapshot-codex-coding-effect-c6-real-history-yield";

describe("Codex coding-effect C6 real-history yield snapshot CLI", () => {
  it("requires every explicit option exactly once and parses positive safe integers", () => {
    expect(parseC6RealHistoryYieldSnapshotCliOptions([
      "--source-root=/evidence/source",
      "--tree-receipt=/evidence/tree.json",
      "--capture-root=/evidence/captures",
      `--expected-tree-receipt-sha256=${"a".repeat(64)}`,
      "--maximum-source-file-bytes=15000000",
      "--minimum-required-episodes=48",
      "--output=/evidence/yield.json",
    ])).toEqual({
      captureRoot: "/evidence/captures",
      expectedTreeReceiptSha256: "a".repeat(64),
      maximumSourceFileBytes: 15_000_000,
      minimumRequiredEpisodes: 48,
      output: "/evidence/yield.json",
      sourceRoot: "/evidence/source",
      treeReceipt: "/evidence/tree.json",
    });

    expect(() =>
      parseC6RealHistoryYieldSnapshotCliOptions([
        "--source-root=/evidence/source",
      ])
    ).toThrow("--tree-receipt is required exactly once");
    expect(() =>
      parseC6RealHistoryYieldSnapshotCliOptions([
        "--source-root=/evidence/source",
        "--source-root=/evidence/other",
        "--tree-receipt=/evidence/tree.json",
        "--capture-root=/evidence/captures",
        `--expected-tree-receipt-sha256=${"a".repeat(64)}`,
        "--maximum-source-file-bytes=15000000",
        "--minimum-required-episodes=48",
        "--output=/evidence/yield.json",
      ])
    ).toThrow("--source-root cannot be specified more than once");
    expect(() =>
      parseC6RealHistoryYieldSnapshotCliOptions([
        "--source-root=/evidence/source",
        "--tree-receipt=/evidence/tree.json",
        "--capture-root=/evidence/captures",
        `--expected-tree-receipt-sha256=${"a".repeat(64)}`,
        "--minimum-required-episodes=48",
        "--output=/evidence/yield.json",
      ])
    ).toThrow("--maximum-source-file-bytes is required exactly once");
    for (const value of ["0", "-1", "1.5", "9007199254740992"]) {
      expect(() =>
        parseC6RealHistoryYieldSnapshotCliOptions([
          "--source-root=/evidence/source",
          "--tree-receipt=/evidence/tree.json",
          "--capture-root=/evidence/captures",
          `--expected-tree-receipt-sha256=${"a".repeat(64)}`,
          "--maximum-source-file-bytes=15000000",
          `--minimum-required-episodes=${value}`,
          "--output=/evidence/yield.json",
        ])
      ).toThrow(
        "--minimum-required-episodes must be a positive safe integer",
      );
    }
    for (const value of ["0", "-1", "1.5", "9007199254740992"]) {
      expect(() =>
        parseC6RealHistoryYieldSnapshotCliOptions([
          "--source-root=/evidence/source",
          "--tree-receipt=/evidence/tree.json",
          "--capture-root=/evidence/captures",
          `--expected-tree-receipt-sha256=${"a".repeat(64)}`,
          `--maximum-source-file-bytes=${value}`,
          "--minimum-required-episodes=48",
          "--output=/evidence/yield.json",
        ])
      ).toThrow(
        "--maximum-source-file-bytes must be a positive safe integer",
      );
    }
  });

  it("writes one deterministic snapshot and returns counts, hash, and boundary", async () => {
    const fixture = await createFixture();
    try {
      const output = join(fixture.root, "nested", "yield.json");
      const result = await runC6RealHistoryYieldSnapshotCommand([
        `--source-root=${fixture.sourceRoot}`,
        `--tree-receipt=${fixture.treeReceipt}`,
        `--capture-root=${fixture.captureRoot}`,
        `--expected-tree-receipt-sha256=${fixture.treeReceiptSha256}`,
        "--maximum-source-file-bytes=15000000",
        "--minimum-required-episodes=2",
        `--output=${output}`,
      ]);
      const bytes = await readFile(output);

      expect(result).toEqual({
        boundary: {
          acceptedEpisodeCount: 0,
          candidateManifestFrozen: false,
          status:
            "strict-partial-review-signal-scan-not-accepted-episodes",
        },
        counts: {
          canonicalAnchors: 1,
          fewerThanTwoReviewEvents: 1,
          localApiBodyFiles: 4,
          noResolvedIssueReference: 0,
          noReviewFixReviewFixSequence: 0,
          sourceAliases: 0,
          sourceFiles: 1,
          sourceRows: 1,
          strictHeuristicSignals: 0,
          upstreamIdentityMismatch: 0,
        },
        output,
        outputSha256: sha256(bytes),
      });
      expect(bytes.toString("utf8")).toEndWith("\n");

      await expect(runC6RealHistoryYieldSnapshotCommand([
        `--source-root=${fixture.sourceRoot}`,
        `--tree-receipt=${fixture.treeReceipt}`,
        `--capture-root=${fixture.captureRoot}`,
        `--expected-tree-receipt-sha256=${fixture.treeReceiptSha256}`,
        "--maximum-source-file-bytes=15000000",
        "--minimum-required-episodes=2",
        `--output=${output}`,
      ])).rejects.toMatchObject({ code: "EEXIST" });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
});

async function createFixture(): Promise<{
  captureRoot: string;
  root: string;
  sourceRoot: string;
  treeReceipt: string;
  treeReceiptSha256: string;
}> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "goodmemory-c6-yield-cli-")),
  );
  const sourceRoot = join(root, "source");
  const captureRoot = join(root, "captures");
  const sourcePath = "ts/example__project_dataset.jsonl";
  const sourceBytes = `${JSON.stringify({
    number: 1,
    org: "example",
    repo: "project",
    resolved_issues: [{ number: 101 }],
  })}\n`;
  await mkdir(dirname(join(sourceRoot, sourcePath)), { recursive: true });
  await writeFile(join(sourceRoot, sourcePath), sourceBytes);
  const treeReceipt = join(root, "tree.json");
  const treeReceiptBytes = `${JSON.stringify([{
    oid: gitBlobOid(sourceBytes),
    path: sourcePath,
    size: Buffer.byteLength(sourceBytes),
    type: "file",
  }])}\n`;
  await writeFile(treeReceipt, treeReceiptBytes);

  const captureDirectory = join(captureRoot, "example__project__1");
  await mkdir(captureDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(captureDirectory, "pull.json"), `${JSON.stringify({
      base: { repo: { full_name: "example/project" } },
      html_url: "https://github.com/example/project/pull/1",
      number: 1,
      user: { login: "author" },
    })}\n`),
    writeFile(join(captureDirectory, "review-comments.json"), "[[]]\n"),
    writeFile(join(captureDirectory, "reviews.json"), "[[]]\n"),
    writeFile(
      join(captureDirectory, "commits.json"),
      `${JSON.stringify([[{
        commit: {
          committer: {
            date: "2026-01-01T00:00:00Z",
          },
        },
        sha: "0".repeat(40),
      }]])}\n`,
    ),
  ]);
  return {
    captureRoot,
    root,
    sourceRoot,
    treeReceipt,
    treeReceiptSha256: sha256(Buffer.from(treeReceiptBytes)),
  };
}

function gitBlobOid(value: string): string {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(value)}\0`)
    .update(value)
    .digest("hex");
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
