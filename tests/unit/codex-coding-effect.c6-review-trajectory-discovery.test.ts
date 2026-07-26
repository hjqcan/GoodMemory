import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildC6AssetLock } from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  captureC6GitHubGraphQLDiscovery,
} from "../../scripts/codex-coding-effect/c6-github-graphql-discovery";
import {
  captureC6GitHubRestToDirectory,
} from "../../scripts/codex-coding-effect/c6-github-rest-capture";
import {
  buildC6ReviewTrajectoryDiscovery,
  serializeC6ReviewTrajectoryDiscovery,
} from "../../scripts/codex-coding-effect/c6-review-trajectory-discovery";
import {
  parseC6ReviewTrajectoryDiscoveryCliOptions,
  runC6ReviewTrajectoryDiscoverySnapshotCommand,
} from "../../scripts/snapshot-codex-coding-effect-c6-review-trajectory-discovery";

const SOURCE_REVISION = "5".repeat(40);
const TOKEN = "fixture-token";

describe("Codex coding-effect C6 review trajectory discovery", () => {
  it("recomputes signals, filters the pull author, and requires GraphQL ancestry", async () => {
    const fixture = await createFixture();
    try {
      const discovery = await buildDiscovery(fixture);
      const replay = await buildDiscovery(fixture);

      expect(discovery.boundary).toEqual({
        acceptedEpisodeCount: 0,
        candidateManifestFrozen: false,
        codexRunReady: false,
        signalsNotEpisodes: true,
        status: "review-trajectory-signals-not-episodes",
        upperBoundClaimPermitted: false,
      });
      expect(discovery.provenance).toEqual({
        platformCryptographicReceipt: false,
        status:
          "capture-local-https-responses-not-platform-authenticity-receipts",
        transport: "https-response-body-and-selected-header-capture",
      });
      expect(discovery.source).toMatchObject({
        declaredRevision: SOURCE_REVISION,
        revisionReceiptBound: false,
        revisionStatus:
          "declared-source-revision-not-bound-by-tree-receipt",
      });
      expect(discovery.counts).toEqual({
        f2pAndP2pNonempty: 1,
        f2pNonempty: 1,
        graphqlParentAncestrySequences: 5,
        graphqlPaginationIncomplete: 1,
        linearReviewAncestrySequences: 3,
        linearReviewF2pAndP2pNonempty: 1,
        linearReviewF2pNonempty: 1,
        nonAuthorRequestEventsAtLeast2: 7,
        preliminarySignalCandidates: 9,
        restExpectedClosures: 9,
        restMissingClosures: 1,
        restStrictCompleteClosures: 8,
        sourceAnchors: 10,
        sourceFiles: 1,
        timestampSequences: 7,
      });
      expect(discovery.selectionAudit).toEqual({
        fullAncestrySearchSequences: 5,
        legacyTimestampFirstPairwiseAncestrySequences: 5,
        linearReviewAncestrySequences: 3,
        nonlinearThreeEdgeSignals: [
          "example/merge-trajectory#9",
          "example/late-reviewed-commit#10",
        ],
        recoveredByFullSearch: ["example/recoverable-trajectory#8"],
        rejectedByFullSearch: ["example/forked-trajectory#6"],
        status:
          "legacy-timestamp-first-is-diagnostic-not-canonical-selection",
      });
      expect(discovery.missingRestClosures).toEqual([{
        anchorId: "example/missing#2",
        directory: "example__missing__2",
        status: "missing-strict-rest-closure",
      }]);
      expect(discovery.targets.map((target) => ({
        anchorId: target.anchorId,
        ancestry: target.rest.status === "strict-rest-closure"
          ? target.rest.graphqlParentAncestryValid
          : null,
        eventCount: target.rest.status === "strict-rest-closure"
          ? target.rest.nonAuthorRequestEventCount
          : null,
        linear: target.rest.status === "strict-rest-closure"
          ? target.rest.linearReviewAncestryValid
          : null,
        restStatus: target.rest.status,
        timestampSequence: target.rest.status === "strict-rest-closure"
          ? target.rest.timestampSequence !== null
          : false,
      }))).toEqual([{
        anchorId: "example/valid#1",
        ancestry: true,
        eventCount: 2,
        linear: true,
        restStatus: "strict-rest-closure",
        timestampSequence: true,
      }, {
        anchorId: "example/missing#2",
        ancestry: null,
        eventCount: null,
        linear: null,
        restStatus: "missing-strict-rest-closure",
        timestampSequence: false,
      }, {
        anchorId: "example/author-filtered#3",
        ancestry: false,
        eventCount: 0,
        linear: false,
        restStatus: "strict-rest-closure",
        timestampSequence: false,
      }, {
        anchorId: "example/no-ancestry#4",
        ancestry: false,
        eventCount: 2,
        linear: false,
        restStatus: "strict-rest-closure",
        timestampSequence: true,
      }, {
        anchorId: "example/forked-trajectory#6",
        ancestry: false,
        eventCount: 2,
        linear: false,
        restStatus: "strict-rest-closure",
        timestampSequence: true,
      }, {
        anchorId: "example/transferred#7",
        ancestry: true,
        eventCount: 2,
        linear: true,
        restStatus: "strict-rest-closure",
        timestampSequence: true,
      }, {
        anchorId: "example/recoverable-trajectory#8",
        ancestry: true,
        eventCount: 2,
        linear: true,
        restStatus: "strict-rest-closure",
        timestampSequence: true,
      }, {
        anchorId: "example/merge-trajectory#9",
        ancestry: true,
        eventCount: 2,
        linear: false,
        restStatus: "strict-rest-closure",
        timestampSequence: true,
      }, {
        anchorId: "example/late-reviewed-commit#10",
        ancestry: true,
        eventCount: 2,
        linear: false,
        restStatus: "strict-rest-closure",
        timestampSequence: true,
      }]);
      expect(
        discovery.targets.find(
          (target) => target.anchorId === "example/transferred#7",
        )!.graphql.repositoryIdentity,
      ).toEqual({
        requested: "example/transferred",
        resolved: "example/renamed",
        status: "redirect-observed",
      });
      const valid = discovery.targets.find(
        (target) => target.anchorId === "example/valid#1",
      )!;
      expect(
        valid.rest.status === "strict-rest-closure"
          ? {
            edgeKinds: valid.rest.linearReviewAncestryEvidence?.edges.map(
              (edge) => edge.kind,
            ),
            timing:
              valid.rest.linearReviewAncestryEvidence?.reviewedCommitTiming
                .status,
          }
          : null,
      ).toEqual({
        edgeKinds: [
          "first-fix-descends-first-reviewed-commit",
          "second-reviewed-commit-descends-first-fix",
          "second-fix-descends-second-reviewed-commit",
          "second-fix-descends-first-fix",
        ],
        timing: "reviewed-commits-not-after-review-events",
      });
      const recovered = discovery.targets.find(
        (target) =>
          target.anchorId === "example/recoverable-trajectory#8",
      )!;
      expect(
        recovered.rest.status === "strict-rest-closure"
          ? {
            ancestryEdges:
              recovered.rest.graphqlParentAncestryEvidence?.edges.map(
                (edge) => edge.kind,
              ),
            closure: recovered.rest.commitClosure,
            closureMatchedCommits:
              recovered.rest.commitClosure.matchedCommits.length,
            constrainedFirstFix:
              recovered.rest.graphqlParentAncestrySequence?.firstFixCommit,
            timestampFirstFix:
              recovered.rest.timestampSequence?.firstFixCommit,
            timestampOnlyPairwise:
              recovered.rest.timestampOnlyPairwiseAncestryValid,
          }
          : null,
      ).toMatchObject({
        ancestryEdges: [
          "first-fix-descends-first-reviewed-commit",
          "second-fix-descends-second-reviewed-commit",
          "second-fix-descends-first-fix",
        ],
        closure: {
          commitCount: 4,
          status: "rest-graphql-parent-and-committed-at-exact-match",
        },
        closureMatchedCommits: 4,
        constrainedFirstFix: commitIds(
          FIXTURE_ROWS.find(
            (row) => row.name === "recoverable-trajectory",
          )!,
        )[1],
        timestampFirstFix: sha1("recoverable-trajectory-decoy-fix"),
        timestampOnlyPairwise: false,
      });
      expect(
        serializeC6ReviewTrajectoryDiscovery(replay),
      ).toBe(serializeC6ReviewTrajectoryDiscovery(discovery));
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("fails closed on target, raw artifact, and symlink drift", async () => {
    const targetDrift = await createFixture();
    try {
      await expect(buildC6ReviewTrajectoryDiscovery({
        ...buildInput(targetDrift),
        expectedTargetsSha256: "f".repeat(64),
      })).rejects.toThrow("target receipt hash mismatch");
    } finally {
      await rm(targetDrift.root, { force: true, recursive: true });
    }

    const rawDrift = await createFixture();
    try {
      const responsePath = join(
        rawDrift.restRoot,
        "example__valid__1",
        "responses",
        "review-comments",
        "page-0001.json",
      );
      await writeFile(responsePath, " ", { flag: "a" });
      const restRootSha256 = (await buildC6AssetLock(rawDrift.restRoot))
        .assetRootSha256;
      await expect(buildC6ReviewTrajectoryDiscovery({
        ...buildInput(rawDrift),
        expectedRestRootSha256: restRootSha256,
      })).rejects.toThrow("REST artifact reference mismatch");
    } finally {
      await rm(rawDrift.root, { force: true, recursive: true });
    }

    const symlinkDrift = await createFixture();
    try {
      const linkedSource = join(symlinkDrift.root, "linked-source");
      await symlink(symlinkDrift.sourceRoot, linkedSource);
      await expect(buildC6ReviewTrajectoryDiscovery({
        ...buildInput(symlinkDrift),
        sourceRoot: linkedSource,
      })).rejects.toThrow("symlink path component");
    } finally {
      await rm(symlinkDrift.root, { force: true, recursive: true });
    }

    const terminalSymlinkDrift = await createFixture();
    try {
      await expect(buildC6ReviewTrajectoryDiscovery({
        ...buildInput(terminalSymlinkDrift),
        testHooks: {
          beforeTerminalVerification: async () => {
            const movedSource = `${terminalSymlinkDrift.sourceRoot}-moved`;
            await rename(terminalSymlinkDrift.sourceRoot, movedSource);
            await symlink(movedSource, terminalSymlinkDrift.sourceRoot);
          },
        },
      })).rejects.toThrow("terminal source root rejects symlink path component");
    } finally {
      await rm(terminalSymlinkDrift.root, { force: true, recursive: true });
    }

    const linkDrift = await createFixture();
    try {
      const manifestPath = join(
        linkDrift.restRoot,
        "example__valid__1",
        "manifest.json",
      );
      const manifest = JSON.parse(
        await readFile(manifestPath, "utf8"),
      ) as {
        requests: Array<{
          endpoint: string;
          response: { headers: { link: string | null } };
        }>;
      };
      manifest.requests.find(
        (request) => request.endpoint === "review-comments",
      )!.response.headers.link =
        '<https://api.github.com/repos/example/valid/pulls/1/comments?per_page=100&page=2>; rel="next"';
      await writeFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      const restRootSha256 = (await buildC6AssetLock(linkDrift.restRoot))
        .assetRootSha256;
      await expect(buildC6ReviewTrajectoryDiscovery({
        ...buildInput(linkDrift),
        expectedRestRootSha256: restRootSha256,
      })).rejects.toThrow("REST Link closure mismatch");
    } finally {
      await rm(linkDrift.root, { force: true, recursive: true });
    }

    for (const drift of ["parents", "timestamp"] as const) {
      const commitDrift = await createFixture();
      try {
        await rewriteRestResponse(
          commitDrift,
          "example__valid__1",
          "responses/commits/page-0001.json",
          (value) => {
            const commits = value as Array<{
              commit: { committer: { date: string } };
              parents: Array<{ sha: string }>;
            }>;
            if (drift === "parents") {
              commits[2]!.parents = [{ sha: sha1("conflicting-parent") }];
            } else {
              commits[1]!.commit.committer.date =
                "2026-07-25T12:01:00Z";
            }
          },
        );
        const restRootSha256 = (await buildC6AssetLock(
          commitDrift.restRoot,
        )).assetRootSha256;
        await expect(buildC6ReviewTrajectoryDiscovery({
          ...buildInput(commitDrift),
          expectedRestRootSha256: restRootSha256,
        })).rejects.toThrow("REST/GraphQL commit closure mismatch");
      } finally {
        await rm(commitDrift.root, { force: true, recursive: true });
      }
    }
  });

  it("snapshots explicit local inputs and refuses overwrite", async () => {
    const fixture = await createFixture();
    try {
      const output = join(fixture.root, "output", "discovery.json");
      const args = buildArgs(fixture, output);
      expect(parseC6ReviewTrajectoryDiscoveryCliOptions(args)).toEqual({
        declaredSourceRevision: SOURCE_REVISION,
        expectedGraphqlRootSha256: fixture.graphqlRootSha256,
        expectedRestRootSha256: fixture.restRootSha256,
        expectedSourceRootSha256: fixture.sourceRootSha256,
        expectedTargetsSha256: fixture.targetsSha256,
        expectedTreeReceiptSha256: fixture.treeReceiptSha256,
        graphqlCaptureRoot: fixture.graphqlRoot,
        output,
        restCaptureRoot: fixture.restRoot,
        sourceRoot: fixture.sourceRoot,
        targets: fixture.targetsPath,
        treeReceipt: fixture.treeReceiptPath,
      });

      const result = await runC6ReviewTrajectoryDiscoverySnapshotCommand(args);
      const outputBytes = await readFile(output);
      expect(result).toMatchObject({
        boundary: {
          acceptedEpisodeCount: 0,
          candidateManifestFrozen: false,
          upperBoundClaimPermitted: false,
        },
        counts: {
          graphqlParentAncestrySequences: 5,
          linearReviewAncestrySequences: 3,
          preliminarySignalCandidates: 9,
        },
        output,
        outputSha256: sha256(outputBytes),
      });
      await expect(
        runC6ReviewTrajectoryDiscoverySnapshotCommand(args),
      ).rejects.toMatchObject({ code: "EEXIST" });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
});

interface Fixture {
  graphqlRoot: string;
  graphqlRootSha256: string;
  restRoot: string;
  restRootSha256: string;
  root: string;
  sourceRoot: string;
  sourceRootSha256: string;
  targetsPath: string;
  targetsSha256: string;
  treeReceiptPath: string;
  treeReceiptSha256: string;
}

interface FixtureRow {
  canonicalName?: string;
  f2p: number;
  forkedTrajectory?: boolean;
  graphqlPaginationIncomplete?: boolean;
  graphqlParentsValid: boolean;
  lateReviewedCommit?: boolean;
  mergeTrajectory?: boolean;
  name: string;
  number: number;
  p2p: number;
  recoverableTrajectory?: boolean;
  rest: "author-filtered" | "missing" | "requests";
}

async function buildDiscovery(fixture: Fixture) {
  return buildC6ReviewTrajectoryDiscovery(buildInput(fixture));
}

const FIXTURE_ROWS: FixtureRow[] = [{
  f2p: 1,
  graphqlParentsValid: true,
  name: "valid",
  number: 1,
  p2p: 1,
  rest: "requests",
}, {
  f2p: 1,
  graphqlParentsValid: true,
  name: "missing",
  number: 2,
  p2p: 0,
  rest: "missing",
}, {
  f2p: 1,
  graphqlParentsValid: true,
  name: "author-filtered",
  number: 3,
  p2p: 1,
  rest: "author-filtered",
}, {
  f2p: 0,
  graphqlParentsValid: false,
  name: "no-ancestry",
  number: 4,
  p2p: 0,
  rest: "requests",
}, {
  f2p: 1,
  graphqlPaginationIncomplete: true,
  graphqlParentsValid: true,
  name: "pagination-gap",
  number: 5,
  p2p: 1,
  rest: "missing",
}, {
  f2p: 1,
  forkedTrajectory: true,
  graphqlParentsValid: true,
  name: "forked-trajectory",
  number: 6,
  p2p: 1,
  rest: "requests",
}, {
  canonicalName: "renamed",
  f2p: 0,
  graphqlParentsValid: true,
  name: "transferred",
  number: 7,
  p2p: 0,
  rest: "requests",
}, {
  f2p: 0,
  graphqlParentsValid: true,
  name: "recoverable-trajectory",
  number: 8,
  p2p: 0,
  recoverableTrajectory: true,
  rest: "requests",
}, {
  f2p: 0,
  graphqlParentsValid: true,
  mergeTrajectory: true,
  name: "merge-trajectory",
  number: 9,
  p2p: 0,
  rest: "requests",
}, {
  f2p: 0,
  graphqlParentsValid: true,
  lateReviewedCommit: true,
  name: "late-reviewed-commit",
  number: 10,
  p2p: 0,
  rest: "requests",
}];

async function createFixture(): Promise<Fixture> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "goodmemory-c6-review-trajectory-")),
  );
  const sourceRoot = join(root, "source");
  const graphqlRoot = join(root, "graphql");
  const restRoot = join(root, "rest");
  await Promise.all([
    mkdir(join(sourceRoot, "ts"), { recursive: true }),
    mkdir(graphqlRoot),
    mkdir(restRoot),
  ]);
  const sourcePath = "ts/example_dataset.jsonl";
  const sourceBytes = Buffer.from(FIXTURE_ROWS.map((row) => JSON.stringify({
    f2p_tests: Object.fromEntries(
      Array.from({ length: row.f2p }, (_, index) => [`f2p-${index}`, true]),
    ),
    fix_patch: "patch",
    fixed_tests: {},
    n2p_tests: {},
    number: row.number,
    org: "example",
    p2p_tests: Object.fromEntries(
      Array.from({ length: row.p2p }, (_, index) => [`p2p-${index}`, true]),
    ),
    repo: row.name,
    resolved_issues: [{ number: row.number + 100 }],
    s2p_tests: {},
    test_patch: "test patch",
  })).join("\n") + "\n");
  await writeFile(join(sourceRoot, sourcePath), sourceBytes);
  const treeReceiptPath = join(root, "tree.json");
  const treeReceiptBytes = Buffer.from(`${JSON.stringify([{
    oid: gitBlobOid(sourceBytes),
    path: sourcePath,
    size: sourceBytes.byteLength,
    type: "file",
  }], null, 2)}\n`);
  await writeFile(treeReceiptPath, treeReceiptBytes);

  for (const row of FIXTURE_ROWS) {
    await captureC6GitHubGraphQLDiscovery({
      ...(row.canonicalName === undefined
        ? {}
        : {
          canonicalOwner: "example",
          canonicalRepo: row.canonicalName,
        }),
      fetchImpl: async () =>
        new Response(JSON.stringify(buildGraphqlResponse(row)), {
          headers: graphqlHeaders(),
          status: 200,
        }),
      outputDirectory: join(
        graphqlRoot,
        `example__${row.name}__${row.number}`,
      ),
      owner: "example",
      pullNumber: row.number,
      repo: row.name,
      token: TOKEN,
    });
    if (row.rest !== "missing") {
      await captureC6GitHubRestToDirectory({
        authorizationToken: TOKEN,
        outputDirectory: join(
          restRoot,
          `example__${row.name}__${row.number}`,
        ),
        owner: "example",
        pullNumber: row.number,
        repository: row.name,
        resolvedIssueNumbers: [row.number + 100],
      }, {
        fetch: buildRestFetch(row),
      });
      if (row.canonicalName !== undefined) {
        await rewriteRestResponseAtRoot(
          restRoot,
          `example__${row.name}__${row.number}`,
          "responses/pull.json",
          (value) => {
            const pull = value as {
              base: {
                repo: {
                  full_name: string;
                  name: string;
                };
              };
              html_url: string;
            };
            pull.base.repo.full_name = `example/${row.canonicalName}`;
            pull.base.repo.name = row.canonicalName!;
            pull.html_url =
              `https://github.com/example/${row.canonicalName}/pull/${row.number}`;
          },
        );
      }
    }
  }
  const targetRows = FIXTURE_ROWS
    .filter((row) => !row.graphqlPaginationIncomplete)
    .map((row) =>
      `example\t${row.name}\t${row.number}\t${row.number + 100}\n`
    )
    .join("");
  const targetsPath = join(root, "targets.tsv");
  await writeFile(targetsPath, targetRows);
  return {
    graphqlRoot,
    graphqlRootSha256: (await buildC6AssetLock(graphqlRoot)).assetRootSha256,
    restRoot,
    restRootSha256: (await buildC6AssetLock(restRoot)).assetRootSha256,
    root,
    sourceRoot,
    sourceRootSha256: (await buildC6AssetLock(sourceRoot)).assetRootSha256,
    targetsPath,
    targetsSha256: sha256(Buffer.from(targetRows)),
    treeReceiptPath,
    treeReceiptSha256: sha256(treeReceiptBytes),
  };
}

function buildInput(fixture: Fixture) {
  return {
    expectedGraphqlRootSha256: fixture.graphqlRootSha256,
    expectedRestRootSha256: fixture.restRootSha256,
    declaredSourceRevision: SOURCE_REVISION,
    expectedSourceRootSha256: fixture.sourceRootSha256,
    expectedTargetsSha256: fixture.targetsSha256,
    expectedTreeReceiptSha256: fixture.treeReceiptSha256,
    graphqlCaptureRoot: fixture.graphqlRoot,
    restCaptureRoot: fixture.restRoot,
    sourceRoot: fixture.sourceRoot,
    targetsPath: fixture.targetsPath,
    treeReceiptPath: fixture.treeReceiptPath,
  };
}

function buildArgs(fixture: Fixture, output: string): string[] {
  return [
    `--tree-receipt=${fixture.treeReceiptPath}`,
    `--expected-tree-receipt-sha256=${fixture.treeReceiptSha256}`,
    `--source-root=${fixture.sourceRoot}`,
    `--declared-source-revision=${SOURCE_REVISION}`,
    `--expected-source-root-sha256=${fixture.sourceRootSha256}`,
    `--graphql-capture-root=${fixture.graphqlRoot}`,
    `--expected-graphql-root-sha256=${fixture.graphqlRootSha256}`,
    `--rest-capture-root=${fixture.restRoot}`,
    `--expected-rest-root-sha256=${fixture.restRootSha256}`,
    `--targets=${fixture.targetsPath}`,
    `--expected-targets-sha256=${fixture.targetsSha256}`,
    `--output=${output}`,
  ];
}

function buildGraphqlResponse(row: FixtureRow) {
  const [initial, firstFix, secondFix] = commitIds(row);
  const canonicalName = row.canonicalName ?? row.name;
  const forkReviewCommit = sha1(`${row.name}-fork-review`);
  const lateReviewCommit = sha1(`${row.name}-late-review`);
  const decoyFix = sha1(`${row.name}-decoy-fix`);
  const secondReviewedCommit = row.lateReviewedCommit
    ? lateReviewCommit
    : row.forkedTrajectory || row.mergeTrajectory
    ? forkReviewCommit
    : firstFix;
  const pageInfo = (hasNextPage = false) => ({
    endCursor: hasNextPage ? "cursor" : null,
    hasNextPage,
  });
  const requestAuthor = row.rest === "author-filtered"
    ? `author-${row.number}`
    : "reviewer";
  return {
    data: {
      rateLimit: {
        cost: 1,
        remaining: 4_999,
        resetAt: "2026-07-25T20:00:00Z",
      },
      repository: {
        nameWithOwner: `example/${canonicalName}`,
        pullRequest: {
          baseRefName: "main",
          baseRefOid: initial,
          baseRepository: {
            nameWithOwner: `example/${canonicalName}`,
          },
          closingIssuesReferences: {
            nodes: [{ number: row.number + 100 }],
            pageInfo: pageInfo(),
          },
          comments: { nodes: [], pageInfo: pageInfo() },
          commits: {
            nodes: [{
              commit: {
                committedDate: "2026-07-25T10:00:00Z",
                oid: initial,
                parents: { nodes: [], pageInfo: pageInfo() },
              },
            }, ...(row.recoverableTrajectory
              ? [{
                commit: {
                  committedDate: "2026-07-25T11:30:00Z",
                  oid: decoyFix,
                  parents: {
                    nodes: [{ oid: sha1("decoy-external-parent") }],
                    pageInfo: pageInfo(),
                  },
                },
              }]
              : []), {
              commit: {
                committedDate: "2026-07-25T12:00:00Z",
                oid: firstFix,
                parents: {
                  nodes: [{
                    oid: row.graphqlParentsValid ? initial : sha1("other-1"),
                  }],
                  pageInfo: pageInfo(),
                },
              },
            }, ...(row.forkedTrajectory || row.mergeTrajectory
              ? [{
                commit: {
                  committedDate: "2026-07-25T12:30:00Z",
                  oid: forkReviewCommit,
                  parents: {
                    nodes: [{ oid: sha1("fork-external-parent") }],
                    pageInfo: pageInfo(),
                  },
                },
              }]
              : []), ...(row.lateReviewedCommit
              ? [{
                commit: {
                  committedDate: "2026-07-25T13:30:00Z",
                  oid: lateReviewCommit,
                  parents: {
                    nodes: [{ oid: firstFix }],
                    pageInfo: pageInfo(),
                  },
                },
              }]
              : []), {
              commit: {
                committedDate: "2026-07-25T14:00:00Z",
                oid: secondFix,
                parents: {
                  nodes: [{
                    oid: row.forkedTrajectory
                      ? forkReviewCommit
                      : row.lateReviewedCommit
                      ? lateReviewCommit
                      : row.graphqlParentsValid
                      ? firstFix
                      : sha1("other-2"),
                  }, ...(row.mergeTrajectory
                    ? [{ oid: forkReviewCommit }]
                    : [])],
                  pageInfo: pageInfo(),
                },
              },
            }],
            pageInfo: pageInfo(row.graphqlPaginationIncomplete),
          },
          headRefName: "feature",
          headRefOid: secondFix,
          mergeCommit: null,
          merged: false,
          mergedAt: null,
          number: row.number,
          reviewThreads: {
            nodes: [{
              comments: {
                nodes: [{
                  author: { login: requestAuthor },
                  body: "Please change this implementation.",
                  commit: { oid: initial },
                  createdAt: "2026-07-25T11:00:00Z",
                  id: `comment-${row.number}-1`,
                  originalCommit: { oid: initial },
                }, {
                  author: { login: requestAuthor },
                  body: "Please add a focused test.",
                  commit: { oid: secondReviewedCommit },
                  createdAt: "2026-07-25T13:00:00Z",
                  id: `comment-${row.number}-2`,
                  originalCommit: { oid: secondReviewedCommit },
                }],
                pageInfo: pageInfo(),
              },
              id: `thread-${row.number}`,
              isResolved: true,
            }],
            pageInfo: pageInfo(),
          },
          reviews: { nodes: [], pageInfo: pageInfo() },
          url:
            `https://github.com/example/${canonicalName}/pull/${row.number}`,
        },
      },
    },
  };
}

function buildRestFetch(row: FixtureRow) {
  const [initial, firstFix, secondFix] = commitIds(row);
  const forkReviewCommit = sha1(`${row.name}-fork-review`);
  const lateReviewCommit = sha1(`${row.name}-late-review`);
  const decoyFix = sha1(`${row.name}-decoy-fix`);
  const secondReviewedCommit = row.lateReviewedCommit
    ? lateReviewCommit
    : row.forkedTrajectory || row.mergeTrajectory
    ? forkReviewCommit
    : firstFix;
  const author = `author-${row.number}`;
  const requestAuthor = row.rest === "author-filtered"
    ? author
    : "reviewer";
  const reviewComments = [{
    body: "Please change this implementation.",
    created_at: "2026-07-25T11:00:00Z",
    original_commit_id: initial,
    user: { login: requestAuthor },
  }, {
    body: "Please add a focused test.",
    created_at: "2026-07-25T13:00:00Z",
    original_commit_id: secondReviewedCommit,
    user: { login: requestAuthor },
  }];
  return async (value: string) => {
    const url = new URL(value);
    const pullRoot = `/repos/example/${row.name}/pulls/${row.number}`;
    const issueNumber = row.number + 100;
    let body: unknown;
    if (url.pathname === pullRoot) {
      body = {
        base: {
          repo: {
            full_name: `example/${row.name}`,
            id: 1_000 + row.number,
            name: row.name,
            owner: { login: "example" },
          },
          sha: initial,
        },
        comments: 0,
        commits:
          row.forkedTrajectory || row.mergeTrajectory ||
            row.lateReviewedCommit ||
            row.recoverableTrajectory
            ? 4
            : 3,
        head: { sha: secondFix },
        html_url:
          `https://github.com/example/${row.name}/pull/${row.number}`,
        number: row.number,
        review_comments: 2,
        user: { login: author },
      };
    } else if (url.pathname === `${pullRoot}/comments`) {
      body = reviewComments;
    } else if (url.pathname === `${pullRoot}/reviews`) {
      body = [];
    } else if (url.pathname === `${pullRoot}/commits`) {
      body = [{
        commit: { committer: { date: "2026-07-25T10:00:00Z" } },
        parents: [],
        sha: initial,
      }, ...(row.recoverableTrajectory
        ? [{
          commit: { committer: { date: "2026-07-25T11:30:00Z" } },
          parents: [{ sha: sha1("decoy-external-parent") }],
          sha: decoyFix,
        }]
        : []), {
        commit: { committer: { date: "2026-07-25T12:00:00Z" } },
        parents: [{
          sha: row.graphqlParentsValid ? initial : sha1("other-1"),
        }],
        sha: firstFix,
      }, ...(row.forkedTrajectory || row.mergeTrajectory
        ? [{
          commit: { committer: { date: "2026-07-25T12:30:00Z" } },
          parents: [{ sha: sha1("fork-external-parent") }],
          sha: forkReviewCommit,
        }]
        : []), ...(row.lateReviewedCommit
        ? [{
          commit: { committer: { date: "2026-07-25T13:30:00Z" } },
          parents: [{ sha: firstFix }],
          sha: lateReviewCommit,
        }]
        : []), {
        commit: { committer: { date: "2026-07-25T14:00:00Z" } },
        parents: [{
          sha: row.forkedTrajectory
            ? forkReviewCommit
            : row.lateReviewedCommit
            ? lateReviewCommit
            : row.graphqlParentsValid
            ? firstFix
            : sha1("other-2"),
        }, ...(row.mergeTrajectory ? [{ sha: forkReviewCommit }] : [])],
        sha: secondFix,
      }];
    } else if (
      url.pathname ===
        `/repos/example/${row.name}/issues/${row.number}/comments`
    ) {
      body = [];
    } else if (
      url.pathname ===
        `/repos/example/${row.name}/issues/${issueNumber}/comments`
    ) {
      body = [];
    } else if (
      url.pathname === `/repos/example/${row.name}/issues/${issueNumber}`
    ) {
      body = { comments: 0, number: issueNumber };
    } else {
      throw new Error(`unexpected REST fixture URL ${value}`);
    }
    return new Response(JSON.stringify(body), {
      headers: restHeaders(),
      status: 200,
    });
  };
}

function commitIds(row: FixtureRow): [string, string, string] {
  return [
    sha1(`${row.name}-initial`),
    sha1(`${row.name}-first-fix`),
    sha1(`${row.name}-second-fix`),
  ];
}

function graphqlHeaders(): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    date: "Sat, 25 Jul 2026 18:00:00 GMT",
    "x-github-request-id": "graphql-request",
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": "4999",
    "x-ratelimit-reset": "1785006000",
    "x-ratelimit-resource": "graphql",
    "x-ratelimit-used": "1",
  };
}

function restHeaders(): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    date: "Sat, 25 Jul 2026 18:00:00 GMT",
    etag: "\"fixture\"",
    "x-github-api-version-selected": "2022-11-28",
    "x-github-request-id": "rest-request",
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": "4999",
    "x-ratelimit-reset": "1785006000",
    "x-ratelimit-resource": "core",
    "x-ratelimit-used": "1",
  };
}

function gitBlobOid(value: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${value.byteLength}\0`)
    .update(value)
    .digest("hex");
}

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function rewriteRestResponse(
  fixture: Fixture,
  directory: string,
  relativePath: string,
  mutate: (value: unknown) => void,
): Promise<void> {
  await rewriteRestResponseAtRoot(
    fixture.restRoot,
    directory,
    relativePath,
    mutate,
  );
}

async function rewriteRestResponseAtRoot(
  restRoot: string,
  directory: string,
  relativePath: string,
  mutate: (value: unknown) => void,
): Promise<void> {
  const responsePath = join(restRoot, directory, relativePath);
  const value = JSON.parse(await readFile(responsePath, "utf8")) as unknown;
  mutate(value);
  const responseBytes = Buffer.from(JSON.stringify(value));
  await writeFile(responsePath, responseBytes);

  const manifestPath = join(restRoot, directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    requests: Array<{
      response: {
        rawBody: {
          bytes: number;
          path: string;
          sha256: string;
        };
      };
    }>;
    responseClosureSha256: string;
  };
  const reference = manifest.requests.find(
    (request) => request.response.rawBody.path === relativePath,
  )!.response.rawBody;
  reference.bytes = responseBytes.byteLength;
  reference.sha256 = sha256(responseBytes);
  manifest.responseClosureSha256 = sha256(Buffer.from(JSON.stringify(
    manifest.requests.map((request) => request.response.rawBody),
  )));
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}
