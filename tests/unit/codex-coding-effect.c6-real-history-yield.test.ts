import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  buildC6RealHistoryYieldCensus,
} from "../../scripts/codex-coding-effect/c6-real-history-yield";
import type {
  C6RealHistoryYieldCensus,
} from "../../scripts/codex-coding-effect/c6-real-history-yield";

describe("Codex coding-effect C6 real-history yield census", () => {
  it("scans the provided local review surface without inferring quota feasibility", async () => {
    const fixture = await createFixture();
    try {
      const census = await buildC6RealHistoryYieldCensus({
        captureRoot: fixture.captureRoot,
        expectedTreeReceiptSha256: fixture.treeReceiptSha256,
        maximumSourceFileBytes: 15_000_000,
        minimumRequiredEpisodes: 48,
        sourceRoot: fixture.sourceRoot,
        treeReceiptPath: fixture.treeReceiptPath,
      });

      expect(census.boundary).toEqual({
        acceptedEpisodeCount: 0,
        candidateManifestFrozen: false,
        status:
          "strict-partial-review-signal-scan-not-accepted-episodes",
      });
      expect(census.captureBoundary).toEqual({
        pageRequestsCaptured: false,
        paginationClosureVerified: false,
        platformAuthenticityVerified: false,
        responseHeadersCaptured: false,
        status:
          "local-response-bodies-only-request-pagination-and-authenticity-unverified",
      });
      expect(census.counts).toMatchObject({
        canonicalAnchors: 2,
        localApiBodyFiles: 8,
        sourceFiles: 1,
        sourceRows: 2,
        strictHeuristicSignals: 1,
      });
      expect(census.quota).toEqual({
        feasibilityConclusion:
          "not-estimable-from-partial-review-signal-surface",
        minimumRealHistoryEpisodes: 48,
        observedGapToMinimum: 47,
        strictHeuristicSignals: 1,
      });
      expect(census.source.treeReceipt.path).toBe("tree.json");
      expect(census.decisions[0]).toMatchObject({
        anchorId: "example/project#1",
        decision: "strict-heuristic-signal",
        sequence: {
          firstReview: {
            bodySha256: sha256("Please add a regression test."),
            reviewedCommitSha: "1".repeat(40),
          },
          firstFixCommitSha: "2".repeat(40),
          secondReview: {
            bodySha256: sha256("Please remove the fallback."),
            reviewedCommitSha: "2".repeat(40),
          },
          secondFixCommitSha: "3".repeat(40),
        },
      });
      expect(census.decisions[1]).toMatchObject({
        anchorId: "example/project#2",
        decision: "fewer-than-two-review-events",
      });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("does not count a review without a later distinct commit", async () => {
    const fixture = await createFixture({
      secondReviewCommitSha: "3".repeat(40),
    });
    try {
      const census = await buildC6RealHistoryYieldCensus({
        captureRoot: fixture.captureRoot,
        expectedTreeReceiptSha256: fixture.treeReceiptSha256,
        maximumSourceFileBytes: 15_000_000,
        minimumRequiredEpisodes: 1,
        sourceRoot: fixture.sourceRoot,
        treeReceiptPath: fixture.treeReceiptPath,
      });

      expect(census.counts.strictHeuristicSignals).toBe(0);
      expect(census.decisions[0]?.decision).toBe(
        "no-review-fix-review-fix-sequence",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("requires the caller to choose the source-file byte ceiling", async () => {
    const fixture = await createFixture();
    try {
      const census = await buildC6RealHistoryYieldCensus({
        captureRoot: fixture.captureRoot,
        expectedTreeReceiptSha256: fixture.treeReceiptSha256,
        maximumSourceFileBytes: 1_000_000,
        minimumRequiredEpisodes: 1,
        sourceRoot: fixture.sourceRoot,
        treeReceiptPath: fixture.treeReceiptPath,
      });

      expect(census.source.maximumSourceFileBytes).toBe(1_000_000);
      await expect(buildC6RealHistoryYieldCensus({
        captureRoot: fixture.captureRoot,
        expectedTreeReceiptSha256: fixture.treeReceiptSha256,
        maximumSourceFileBytes: 1,
        minimumRequiredEpisodes: 1,
        sourceRoot: fixture.sourceRoot,
        treeReceiptPath: fixture.treeReceiptPath,
      })).rejects.toThrow(
        "selected source population is empty",
      );
      await expect(buildC6RealHistoryYieldCensus({
        captureRoot: fixture.captureRoot,
        expectedTreeReceiptSha256: fixture.treeReceiptSha256,
        maximumSourceFileBytes: 0,
        minimumRequiredEpisodes: 1,
        sourceRoot: fixture.sourceRoot,
        treeReceiptPath: fixture.treeReceiptPath,
      })).rejects.toThrow(
        "source-file byte ceiling must be a positive safe integer",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("normalizes GitHub repository identity without changing capture paths", async () => {
    const fixture = await createFixture({
      org: "BurntSushi",
      repo: "ripgrep",
    });
    try {
      const census = await buildC6RealHistoryYieldCensus({
        captureRoot: fixture.captureRoot,
        expectedTreeReceiptSha256: fixture.treeReceiptSha256,
        maximumSourceFileBytes: 15_000_000,
        minimumRequiredEpisodes: 1,
        sourceRoot: fixture.sourceRoot,
        treeReceiptPath: fixture.treeReceiptPath,
      });

      expect(census.decisions[0]?.anchorId).toBe("burntsushi/ripgrep#1");
      expect(census.decisions[0]?.decision).toBe(
        "strict-heuristic-signal",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("binds downloaded Git LFS content to the revision tree LFS digest", async () => {
    const fixture = await createFixture({ lfs: true });
    try {
      const census = await buildC6RealHistoryYieldCensus({
        captureRoot: fixture.captureRoot,
        expectedTreeReceiptSha256: fixture.treeReceiptSha256,
        maximumSourceFileBytes: 15_000_000,
        minimumRequiredEpisodes: 1,
        sourceRoot: fixture.sourceRoot,
        treeReceiptPath: fixture.treeReceiptPath,
      });

      expect(census.source.sourceFiles[0]).toMatchObject({
        revisionIdentity: "git-lfs-sha256",
        receiptReportedRevisionObjectOid: "a".repeat(40),
      });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("ignores GitHub review comments that are not bound to a commit", async () => {
    const fixture = await createFixture({ nullCommitReviewComment: true });
    try {
      const census = await buildC6RealHistoryYieldCensus({
        captureRoot: fixture.captureRoot,
        expectedTreeReceiptSha256: fixture.treeReceiptSha256,
        maximumSourceFileBytes: 15_000_000,
        minimumRequiredEpisodes: 1,
        sourceRoot: fixture.sourceRoot,
        treeReceiptPath: fixture.treeReceiptPath,
      });

      expect(census.decisions[0]?.decision).toBe(
        "strict-heuristic-signal",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("ignores GitHub review events whose author account is unavailable", async () => {
    const fixture = await createFixture({ nullReviewUser: true });
    try {
      const census = await buildC6RealHistoryYieldCensus({
        captureRoot: fixture.captureRoot,
        expectedTreeReceiptSha256: fixture.treeReceiptSha256,
        maximumSourceFileBytes: 15_000_000,
        minimumRequiredEpisodes: 1,
        sourceRoot: fixture.sourceRoot,
        treeReceiptPath: fixture.treeReceiptPath,
      });

      expect(census.decisions[0]?.decision).toBe(
        "strict-heuristic-signal",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("excludes a capture that resolves to a different upstream repository", async () => {
    const fixture = await createFixture({ observedOrg: "moved-example" });
    try {
      const census = await buildC6RealHistoryYieldCensus({
        captureRoot: fixture.captureRoot,
        expectedTreeReceiptSha256: fixture.treeReceiptSha256,
        maximumSourceFileBytes: 15_000_000,
        minimumRequiredEpisodes: 1,
        sourceRoot: fixture.sourceRoot,
        treeReceiptPath: fixture.treeReceiptPath,
      });

      expect(census.counts.upstreamIdentityMismatch).toBe(1);
      expect(census.decisions[0]).toMatchObject({
        anchorId: "example/project#1",
        decision: "upstream-identity-mismatch",
        observedPullIdentity: {
          number: 1,
          repository: "moved-example/project",
          url: "https://github.com/moved-example/project/pull/1",
        },
      });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("keeps timestamp-only force-push histories only as heuristic signals", async () => {
    const fixture = await createFixture({ forcePushedReviewedCommit: true });
    try {
      const census = await buildC6RealHistoryYieldCensus({
        captureRoot: fixture.captureRoot,
        expectedTreeReceiptSha256: fixture.treeReceiptSha256,
        maximumSourceFileBytes: 15_000_000,
        minimumRequiredEpisodes: 1,
        sourceRoot: fixture.sourceRoot,
        treeReceiptPath: fixture.treeReceiptPath,
      });

      expect(census.decisions[0]).toMatchObject({
        decision: "strict-heuristic-signal",
        sequence: {
          method:
            "event-and-commit-timestamp-heuristic-no-ancestry-proof",
        },
      });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("anchors inline review history to original_commit_id", async () => {
    const fixture = await createFixture({
      mutatedCurrentReviewCommit: true,
    });
    try {
      const census = await buildC6RealHistoryYieldCensus({
        captureRoot: fixture.captureRoot,
        expectedTreeReceiptSha256: fixture.treeReceiptSha256,
        maximumSourceFileBytes: 15_000_000,
        minimumRequiredEpisodes: 1,
        sourceRoot: fixture.sourceRoot,
        treeReceiptPath: fixture.treeReceiptPath,
      });

      expect(census.decisions[0]?.sequence?.firstReview).toMatchObject({
        currentCommitSha: "f".repeat(40),
        reviewedCommitSha: "1".repeat(40),
      });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("includes request-like COMMENTED review bodies in the partial surface", async () => {
    const fixture = await createFixture({ secondEventInReviewBody: true });
    try {
      const census = await buildC6RealHistoryYieldCensus({
        captureRoot: fixture.captureRoot,
        expectedTreeReceiptSha256: fixture.treeReceiptSha256,
        maximumSourceFileBytes: 15_000_000,
        minimumRequiredEpisodes: 1,
        sourceRoot: fixture.sourceRoot,
        treeReceiptPath: fixture.treeReceiptPath,
      });

      expect(census.decisions[0]).toMatchObject({
        decision: "strict-heuristic-signal",
        sequence: {
          secondReview: {
            source: "review-body",
          },
        },
      });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("requires an external tree-receipt hash and rejects symlink roots", async () => {
    const fixture = await createFixture();
    try {
      await expect(buildC6RealHistoryYieldCensus({
        captureRoot: fixture.captureRoot,
        expectedTreeReceiptSha256: "f".repeat(64),
        maximumSourceFileBytes: 15_000_000,
        minimumRequiredEpisodes: 1,
        sourceRoot: fixture.sourceRoot,
        treeReceiptPath: fixture.treeReceiptPath,
      })).rejects.toThrow("tree receipt does not match expected hash");

      const symlinkedSourceRoot = join(fixture.root, "source-link");
      await symlink(fixture.sourceRoot, symlinkedSourceRoot);
      await expect(buildC6RealHistoryYieldCensus({
        captureRoot: fixture.captureRoot,
        expectedTreeReceiptSha256: fixture.treeReceiptSha256,
        maximumSourceFileBytes: 15_000_000,
        minimumRequiredEpisodes: 1,
        sourceRoot: symlinkedSourceRoot,
        treeReceiptPath: fixture.treeReceiptPath,
      })).rejects.toThrow("rejects symlink path component");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects an incomplete source or API capture closure", async () => {
    const fixture = await createFixture();
    try {
      await rm(join(
        fixture.captureRoot,
        "example__project__1",
        "commits.json",
      ));
      await expect(buildC6RealHistoryYieldCensus({
        captureRoot: fixture.captureRoot,
        expectedTreeReceiptSha256: fixture.treeReceiptSha256,
        maximumSourceFileBytes: 15_000_000,
        minimumRequiredEpisodes: 48,
        sourceRoot: fixture.sourceRoot,
        treeReceiptPath: fixture.treeReceiptPath,
      })).rejects.toThrow("C6 real-history census capture is incomplete");

      await rm(join(fixture.sourceRoot, fixture.sourcePath));
      await expect(buildC6RealHistoryYieldCensus({
        captureRoot: fixture.captureRoot,
        expectedTreeReceiptSha256: fixture.treeReceiptSha256,
        maximumSourceFileBytes: 15_000_000,
        minimumRequiredEpisodes: 48,
        sourceRoot: fixture.sourceRoot,
        treeReceiptPath: fixture.treeReceiptPath,
      })).rejects.toThrow();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("tracks a partial-surface scan without accepting an episode", async () => {
    const bytes = await readFile(join(
      import.meta.dir,
      "../../fixtures/codex-coding-effect/c6-source-pool",
      "multi-swe-under-15mb-56ff018.real-history-yield.json",
    ));
    const artifact = JSON.parse(bytes.toString("utf8")) as {
      boundary: C6RealHistoryYieldCensus["boundary"];
      captureBoundary: C6RealHistoryYieldCensus["captureBoundary"];
      counts: C6RealHistoryYieldCensus["counts"];
      quota: C6RealHistoryYieldCensus["quota"];
    };

    expect(bytes.byteLength).toBe(876_631);
    expect(sha256(bytes)).toBe(
      "afe795834113e1b859783948d2977511e77d6126563d6c5f481385d085a3b076",
    );
    expect(artifact.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      status: "strict-partial-review-signal-scan-not-accepted-episodes",
    });
    expect(artifact.captureBoundary).toMatchObject({
      paginationClosureVerified: false,
      platformAuthenticityVerified: false,
    });
    expect(artifact.counts).toMatchObject({
      canonicalAnchors: 561,
      localApiBodyFiles: 2_244,
      strictHeuristicSignals: 39,
      upstreamIdentityMismatch: 2,
    });
    expect(artifact.quota).toEqual({
      feasibilityConclusion:
        "not-estimable-from-partial-review-signal-surface",
      minimumRealHistoryEpisodes: 48,
      observedGapToMinimum: 9,
      strictHeuristicSignals: 39,
    });
  });

});

async function createFixture(input: {
  forcePushedReviewedCommit?: boolean;
  lfs?: boolean;
  mutatedCurrentReviewCommit?: boolean;
  nullCommitReviewComment?: boolean;
  nullReviewUser?: boolean;
  observedOrg?: string;
  observedRepo?: string;
  org?: string;
  repo?: string;
  secondEventInReviewBody?: boolean;
  secondReviewCommitSha?: string;
} = {}): Promise<{
  captureRoot: string;
  root: string;
  sourcePath: string;
  sourceRoot: string;
  treeReceiptPath: string;
  treeReceiptSha256: string;
}> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "goodmemory-c6-yield-")),
  );
  const sourceRoot = join(root, "source");
  const captureRoot = join(root, "captures");
  const org = input.org ?? "example";
  const repo = input.repo ?? "project";
  const sourcePath = `ts/${org}__${repo}_dataset.jsonl`;
  const sourceBytes = [1, 2].map((number) => JSON.stringify({
    number,
    org,
    repo,
    resolved_issues: [{
      body: `Issue ${number}`,
      number: 100 + number,
      title: `Issue ${number}`,
    }],
  })).join("\n") + "\n";
  await mkdir(dirname(join(sourceRoot, sourcePath)), { recursive: true });
  await writeFile(join(sourceRoot, sourcePath), sourceBytes);
  const treeReceiptPath = join(root, "tree.json");
  const treeReceiptBytes = `${JSON.stringify([{
    ...(input.lfs
      ? {
        lfs: {
          oid: sha256(sourceBytes),
          pointerSize: 133,
          size: Buffer.byteLength(sourceBytes),
        },
      }
      : {}),
    oid: input.lfs ? "a".repeat(40) : gitBlobOid(sourceBytes),
    path: sourcePath,
    size: Buffer.byteLength(sourceBytes),
    type: "file",
  }], null, 2)}\n`;
  await writeFile(treeReceiptPath, treeReceiptBytes);

  const reviewComments: unknown[] = [{
    body: "Please add a regression test.",
    commit_id: input.mutatedCurrentReviewCommit
      ? "f".repeat(40)
      : "1".repeat(40),
    created_at: "2026-01-02T01:00:00Z",
    original_commit_id: "1".repeat(40),
    user: { login: "reviewer" },
  }];
  if (!input.secondEventInReviewBody) {
    reviewComments.push({
      body: "Please remove the fallback.",
      commit_id: input.secondReviewCommitSha ?? "2".repeat(40),
      created_at: "2026-01-03T01:00:00Z",
      original_commit_id:
        input.secondReviewCommitSha ?? "2".repeat(40),
      user: { login: "reviewer" },
    });
  }
  if (input.nullCommitReviewComment) {
    reviewComments.push({
      body: "Please update the documentation.",
      commit_id: null,
      created_at: "2026-01-04T01:00:00Z",
      original_commit_id: null,
      user: { login: "reviewer" },
    });
  }
  if (input.nullReviewUser) {
    reviewComments.push({
      body: "Please update the documentation.",
      commit_id: "2".repeat(40),
      created_at: "2026-01-04T01:00:00Z",
      original_commit_id: "2".repeat(40),
      user: null,
    });
  }
  await writeCapture(
    captureRoot,
    org,
    repo,
    input.observedOrg ?? org,
    input.observedRepo ?? repo,
    1,
    {
      commits: (
        input.forcePushedReviewedCommit
          ? [
            ["0", "2026-01-01T00:00:00Z"],
            ["2", "2026-01-03T00:00:00Z"],
            ["3", "2026-01-04T00:00:00Z"],
            ["1", "2026-01-05T00:00:00Z"],
          ]
          : [
            ["0", "2026-01-01T00:00:00Z"],
            ["1", "2026-01-02T00:00:00Z"],
            ["2", "2026-01-03T00:00:00Z"],
            ["3", "2026-01-04T00:00:00Z"],
          ]
      ).map(([digit, date]) => ({
        commit: {
          committer: {
            date,
          },
        },
        sha: digit!.repeat(40),
      })),
      reviewComments,
      reviews: input.secondEventInReviewBody
        ? [{
          body: "Please remove the fallback.",
          commit_id: "2".repeat(40),
          state: "COMMENTED",
          submitted_at: "2026-01-03T01:00:00Z",
          user: { login: "reviewer" },
        }]
        : [],
    },
  );
  await writeCapture(captureRoot, org, repo, org, repo, 2, {
    commits: ["0", "1"].map((digit, index) => ({
      commit: {
        committer: {
          date: `2026-02-0${index + 1}T00:00:00Z`,
        },
      },
      sha: digit.repeat(40),
    })),
    reviewComments: [],
    reviews: [],
  });
  return {
    captureRoot,
    root,
    sourcePath,
    sourceRoot,
    treeReceiptPath,
    treeReceiptSha256: sha256(treeReceiptBytes),
  };
}

async function writeCapture(
  captureRoot: string,
  org: string,
  repo: string,
  observedOrg: string,
  observedRepo: string,
  number: number,
  input: {
    commits: unknown[];
    reviewComments: unknown[];
    reviews: unknown[];
  },
): Promise<void> {
  const root = join(captureRoot, `${org}__${repo}__${number}`);
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(join(root, "pull.json"), `${JSON.stringify({
      base: {
        repo: {
          full_name: `${observedOrg}/${observedRepo}`,
        },
      },
      html_url:
        `https://github.com/${observedOrg}/${observedRepo}/pull/${number}`,
      number,
      user: {
        login: "author",
      },
    })}\n`),
    writeFile(
      join(root, "review-comments.json"),
      `${JSON.stringify([input.reviewComments])}\n`,
    ),
    writeFile(
      join(root, "reviews.json"),
      `${JSON.stringify([input.reviews])}\n`,
    ),
    writeFile(
      join(root, "commits.json"),
      `${JSON.stringify([input.commits])}\n`,
    ),
  ]);
}

function gitBlobOid(value: string): string {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(value)}\0`)
    .update(value)
    .digest("hex");
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
