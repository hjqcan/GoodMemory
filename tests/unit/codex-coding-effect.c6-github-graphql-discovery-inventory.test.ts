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

import { buildC6AssetLock } from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  captureC6GitHubGraphQLDiscovery,
} from "../../scripts/codex-coding-effect/c6-github-graphql-discovery";
import {
  buildC6GitHubGraphQLDiscoveryInventory,
  serializeC6GitHubGraphQLDiscoveryInventory,
} from "../../scripts/codex-coding-effect/c6-github-graphql-discovery-inventory";
import {
  parseC6GitHubGraphQLDiscoveryInventoryCliOptions,
  runC6GitHubGraphQLDiscoveryInventorySnapshotCommand,
} from "../../scripts/snapshot-codex-coding-effect-c6-github-graphql-discovery-inventory";

const SOURCE_REVISION = "5".repeat(40);
const TOKEN = "github-token-used-only-to-build-the-test-capture";

describe("Codex coding-effect C6 GitHub GraphQL discovery inventory", () => {
  it("accounts for every source anchor and keeps discovery outside evidence gates", async () => {
    const fixture = await createFixture();
    try {
      const inventory = await buildInventory(fixture);
      const replay = await buildInventory(fixture);

      expect(inventory.boundary).toEqual({
        acceptedEpisodeCount: 0,
        candidateManifestFrozen: false,
        codexRunReady: false,
        status: "graphql-discovery-inventory-only-not-accepted-evidence",
        upperBoundClaimPermitted: false,
      });
      expect(inventory.provenance).toEqual({
        platformCryptographicReceipt: false,
        status:
          "https-response-capture-is-not-a-platform-cryptographic-receipt",
        transport: "https-response-body-and-selected-header-capture",
      });
      expect(inventory.counts).toMatchObject({
        completeCaptures: 1,
        discoverySurfaceCompleteCaptures: 1,
        discoverySurfaceIncompleteCaptures: 0,
        effectiveDiscoverySurfaceCompleteCaptures: 1,
        effectiveDiscoverySurfaceIncompleteCaptures: 0,
        expectedCaptures: 2,
        missingCaptures: 1,
        paginationSupplementedCount: 0,
        paginationGaps: 0,
        partialCaptures: 0,
        repositoryRedirects: 0,
        sourceFiles: 2,
        sourceRows: 2,
        uniqueAnchors: 2,
      });
      expect(inventory.missingCaptures).toEqual([{
        anchorId: "example/other#2",
        directory: "example__other__2",
      }]);
      expect(inventory.captureEntries).toHaveLength(1);
      expect(inventory.captureEntries[0]).toMatchObject({
        anchorId: "example/project#1",
        discoverySurfaceComplete: true,
        effectiveDiscoverySurfaceComplete: true,
        paginationSupplement: null,
        rawGraphQLStatistics: {
          closingIssues: 1,
          commits: 2,
          discussionComments: 2,
          parentEdges: 3,
          reviewThreadComments: 2,
          reviewThreadCommentsWithCurrentCommit: 1,
          reviewThreadCommentsWithOriginalAndCurrentCommit: 1,
          reviewThreadCommentsWithOriginalCommit: 2,
          reviewThreads: 1,
          reviews: 2,
          reviewsWithCommit: 1,
        },
      });
      expect(inventory.rawGraphQLStatistics).toEqual(
        inventory.captureEntries[0]?.rawGraphQLStatistics,
      );
      expect(inventory.anchors.map((anchor) => anchor.anchorId)).toEqual([
        "example/other#2",
        "example/project#1",
      ]);
      expect(
        serializeC6GitHubGraphQLDiscoveryInventory(replay),
      ).toBe(serializeC6GitHubGraphQLDiscoveryInventory(inventory));
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("reports partial captures and every nested pagination gap without a silent drop", async () => {
    const fixture = await createFixture({ paginationGaps: true });
    try {
      const partialDirectory = join(
        fixture.captureRoot,
        "example__other__2",
      );
      await mkdir(partialDirectory);
      await writeFile(join(partialDirectory, "request.json"), "{}");

      const inventory = await buildInventory(fixture);

      expect(inventory.counts).toMatchObject({
        completeCaptures: 1,
        discoverySurfaceCompleteCaptures: 0,
        discoverySurfaceIncompleteCaptures: 1,
        effectiveDiscoverySurfaceCompleteCaptures: 0,
        effectiveDiscoverySurfaceIncompleteCaptures: 1,
        expectedCaptures: 2,
        missingCaptures: 0,
        paginationSupplementedCount: 0,
        paginationGaps: 2,
        partialCaptures: 1,
      });
      expect(inventory.partialCaptures).toEqual([{
        anchorId: "example/other#2",
        directory: "example__other__2",
        missingFiles: [
          "capture.json",
          "response-headers.json",
          "response.json",
        ],
      }]);
      expect(inventory.captureEntries[0]?.paginationGaps).toEqual([{
        endCursor: "discussion-cursor",
        path: "data.repository.pullRequest.comments.pageInfo",
      }, {
        endCursor: "parent-cursor",
        path:
          "data.repository.pullRequest.commits.nodes[0].commit.parents.pageInfo",
      }]);
      expect(
        inventory.counts.completeCaptures +
          inventory.counts.partialCaptures +
          inventory.counts.missingCaptures,
      ).toBe(inventory.counts.expectedCaptures);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("cross-binds an explicit repository redirect to old request and canonical response identities", async () => {
    const fixture = await createFixture({ repositoryRedirect: true });
    try {
      const inventory = await buildInventory(fixture);

      expect(inventory.counts.repositoryRedirects).toBe(1);
      expect(inventory.captureEntries[0]).toMatchObject({
        anchorId: "example/project#1",
        repository: {
          redirected: true,
          requested: "example/project",
          resolved: "canonical/project",
        },
      });
      const capturePath = join(
        fixture.captureRoot,
        "example__project__1",
        "capture.json",
      );
      const capture = JSON.parse(await readFile(capturePath, "utf8")) as {
        target: {
          repositoryRedirect: { requestedRepository: string };
        };
      };
      capture.target.repositoryRedirect.requestedRepository = "other/project";
      await writeFile(
        capturePath,
        `${JSON.stringify(capture, null, 2)}\n`,
      );
      await expect(buildInventory(fixture)).rejects.toThrow(
        "repository redirect mismatch",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("uses a strict REST commit-page supplement only for the exact GraphQL gap", async () => {
    const fixture = await createFixture({ commitPaginationGap: true });
    try {
      fixture.restSupplementRoot = await createRestSupplement(fixture);
      const inventory = await buildInventory(fixture);

      expect(inventory.counts).toMatchObject({
        discoverySurfaceCompleteCaptures: 0,
        discoverySurfaceIncompleteCaptures: 1,
        effectiveDiscoverySurfaceCompleteCaptures: 1,
        effectiveDiscoverySurfaceIncompleteCaptures: 0,
        paginationGaps: 1,
        paginationSupplementedCount: 1,
      });
      expect(inventory.captureEntries[0]).toMatchObject({
        discoverySurfaceComplete: false,
        effectiveDiscoverySurfaceComplete: true,
        paginationSupplement: {
          commitCount: 101,
          commitPages: 2,
          type: "github-rest-commits-pagination",
        },
      });

      const manifestPath = join(
        fixture.restSupplementRoot,
        "example__project__1",
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
      const firstCommitPage = manifest.requests.find((request) =>
        request.endpoint === "commits"
      )!;
      firstCommitPage.response.headers.link = null;
      await writeFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      await expect(buildInventory(fixture)).rejects.toThrow(
        "REST pagination Link closure mismatch",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects REST supplement target, raw hash, and extra-file drift", async () => {
    const targetDrift = await createFixture({ commitPaginationGap: true });
    try {
      targetDrift.restSupplementRoot = await createRestSupplement(targetDrift);
      const manifestPath = join(
        targetDrift.restSupplementRoot,
        "example__project__1",
        "manifest.json",
      );
      const manifest = JSON.parse(
        await readFile(manifestPath, "utf8"),
      ) as { input: { owner: string } };
      manifest.input.owner = "other";
      await writeFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      await expect(buildInventory(targetDrift)).rejects.toThrow(
        "REST supplement target mismatch",
      );
    } finally {
      await rm(targetDrift.root, { force: true, recursive: true });
    }

    const rawDrift = await createFixture({ commitPaginationGap: true });
    try {
      rawDrift.restSupplementRoot = await createRestSupplement(rawDrift);
      await writeFile(
        join(
          rawDrift.restSupplementRoot,
          "example__project__1",
          "responses",
          "commits",
          "page-0002.json",
        ),
        " ",
        { flag: "a" },
      );
      await expect(buildInventory(rawDrift)).rejects.toThrow(
        "REST supplement artifact hash mismatch",
      );
    } finally {
      await rm(rawDrift.root, { force: true, recursive: true });
    }

    const extraFile = await createFixture({ commitPaginationGap: true });
    try {
      extraFile.restSupplementRoot = await createRestSupplement(extraFile);
      await writeFile(
        join(
          extraFile.restSupplementRoot,
          "example__project__1",
          "extra.json",
        ),
        "{}",
      );
      await expect(buildInventory(extraFile)).rejects.toThrow(
        "REST supplement file closure mismatch",
      );
    } finally {
      await rm(extraFile.root, { force: true, recursive: true });
    }

    const historyDrift = await createFixture({ commitPaginationGap: true });
    try {
      historyDrift.restSupplementRoot =
        await createRestSupplement(historyDrift);
      await rewriteRestResponse(
        historyDrift.restSupplementRoot,
        "example__project__1",
        "responses/commits/page-0001.json",
        (value) => {
          const commits = value as Array<{ sha: string }>;
          commits[0]!.sha = "e".repeat(40);
          return commits;
        },
      );
      await expect(buildInventory(historyDrift)).rejects.toThrow(
        "REST commit supplement count mismatch",
      );
    } finally {
      await rm(historyDrift.root, { force: true, recursive: true });
    }
  });

  it("fails closed on source, capture, redaction, or directory drift", async () => {
    const hashDrift = await createFixture();
    try {
      await writeFile(
        join(
          hashDrift.captureRoot,
          "example__project__1",
          "response.json",
        ),
        " ",
        { flag: "a" },
      );
      await expect(buildInventory(hashDrift)).rejects.toThrow(
        "capture artifact hash mismatch",
      );
    } finally {
      await rm(hashDrift.root, { force: true, recursive: true });
    }

    const redactionDrift = await createFixture();
    try {
      const capturePath = join(
        redactionDrift.captureRoot,
        "example__project__1",
        "capture.json",
      );
      const capture = JSON.parse(
        await readFile(capturePath, "utf8"),
      ) as {
        request: { headers: { authorization: string } };
      };
      capture.request.headers.authorization = "Bearer leaked-token";
      await writeFile(
        capturePath,
        `${JSON.stringify(capture, null, 2)}\n`,
      );
      await expect(buildInventory(redactionDrift)).rejects.toThrow(
        "token redaction",
      );
    } finally {
      await rm(redactionDrift.root, { force: true, recursive: true });
    }

    const extraDirectory = await createFixture();
    try {
      await mkdir(join(extraDirectory.captureRoot, "unexpected__repo__9"));
      await expect(buildInventory(extraDirectory)).rejects.toThrow(
        "unexpected capture directory",
      );
    } finally {
      await rm(extraDirectory.root, { force: true, recursive: true });
    }

    const sourceDrift = await createFixture();
    try {
      await expect(buildC6GitHubGraphQLDiscoveryInventory({
        captureRoot: sourceDrift.captureRoot,
        expectedSourceRevision: SOURCE_REVISION,
        expectedSourceRootSha256: "f".repeat(64),
        expectedTreeReceiptSha256: sourceDrift.treeReceiptSha256,
        sourceRoot: sourceDrift.sourceRoot,
        treeReceiptPath: sourceDrift.treeReceiptPath,
      })).rejects.toThrow("source root hash mismatch");
    } finally {
      await rm(sourceDrift.root, { force: true, recursive: true });
    }
  });

  it("snapshots only local inputs and refuses to overwrite its inventory", async () => {
    const fixture = await createFixture();
    try {
      const output = join(fixture.root, "output", "inventory.json");
      const args = [
        `--tree-receipt=${fixture.treeReceiptPath}`,
        `--expected-tree-receipt-sha256=${fixture.treeReceiptSha256}`,
        `--source-root=${fixture.sourceRoot}`,
        `--capture-root=${fixture.captureRoot}`,
        `--expected-source-revision=${SOURCE_REVISION}`,
        `--expected-source-root-sha256=${fixture.sourceRootSha256}`,
        `--output=${output}`,
      ];
      expect(parseC6GitHubGraphQLDiscoveryInventoryCliOptions(args))
        .toEqual({
          captureRoot: fixture.captureRoot,
          expectedSourceRevision: SOURCE_REVISION,
          expectedSourceRootSha256: fixture.sourceRootSha256,
          expectedTreeReceiptSha256: fixture.treeReceiptSha256,
          output,
          sourceRoot: fixture.sourceRoot,
          treeReceipt: fixture.treeReceiptPath,
        });

      const result =
        await runC6GitHubGraphQLDiscoveryInventorySnapshotCommand(args);
      const outputBytes = await readFile(output);
      expect(result).toMatchObject({
        boundary: {
          acceptedEpisodeCount: 0,
          candidateManifestFrozen: false,
          codexRunReady: false,
          upperBoundClaimPermitted: false,
        },
        counts: {
          completeCaptures: 1,
          expectedCaptures: 2,
          missingCaptures: 1,
        },
        output,
        outputSha256: sha256(outputBytes),
      });
      await expect(
        runC6GitHubGraphQLDiscoveryInventorySnapshotCommand(args),
      ).rejects.toMatchObject({ code: "EEXIST" });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
});

interface Fixture {
  captureRoot: string;
  restSupplementRoot?: string;
  root: string;
  sourceRoot: string;
  sourceRootSha256: string;
  treeReceiptPath: string;
  treeReceiptSha256: string;
}

async function buildInventory(fixture: Fixture) {
  return buildC6GitHubGraphQLDiscoveryInventory({
    captureRoot: fixture.captureRoot,
    expectedSourceRevision: SOURCE_REVISION,
    expectedSourceRootSha256: fixture.sourceRootSha256,
    expectedTreeReceiptSha256: fixture.treeReceiptSha256,
    restSupplementRoot: fixture.restSupplementRoot,
    sourceRoot: fixture.sourceRoot,
    treeReceiptPath: fixture.treeReceiptPath,
  });
}

async function createFixture(input: {
  commitPaginationGap?: boolean;
  paginationGaps?: boolean;
  repositoryRedirect?: boolean;
} = {}): Promise<Fixture> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "goodmemory-c6-graphql-inventory-")),
  );
  const sourceRoot = join(root, "source");
  const captureRoot = join(root, "captures");
  const sourceFiles = [{
    lfs: false,
    path: "ts/example__project_dataset.jsonl",
    row: {
      number: 1,
      org: "example",
      repo: "project",
    },
  }, {
    lfs: true,
    path: "rust/example__other_dataset.jsonl",
    row: {
      number: 2,
      org: "example",
      repo: "other",
    },
  }];
  const receipt = [];
  for (const source of sourceFiles) {
    const bytes = `${JSON.stringify({
      ...source.row,
      resolved_issues: [],
    })}\n`;
    const path = join(sourceRoot, source.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    receipt.push({
      ...(source.lfs
        ? {
          lfs: {
            oid: sha256(Buffer.from(bytes)),
            pointerSize: 130,
            size: Buffer.byteLength(bytes),
          },
        }
        : {}),
      oid: source.lfs ? "a".repeat(40) : gitBlobOid(bytes),
      path: source.path,
      size: Buffer.byteLength(bytes),
      type: "file",
    });
  }
  const treeReceiptPath = join(root, "hf-tree.json");
  const treeReceiptBytes = Buffer.from(
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  await writeFile(treeReceiptPath, treeReceiptBytes);
  await mkdir(captureRoot);
  await captureC6GitHubGraphQLDiscovery({
    fetchImpl: async () =>
      new Response(JSON.stringify(buildResponse(input)), {
        headers: graphqlHeaders(),
        status: 200,
      }),
    outputDirectory: join(captureRoot, "example__project__1"),
    owner: "example",
    pullNumber: 1,
    repo: "project",
    token: TOKEN,
    ...(input.repositoryRedirect
      ? {
        canonicalOwner: "canonical",
        canonicalRepo: "project",
      }
      : {}),
  });
  return {
    captureRoot,
    root,
    sourceRoot,
    sourceRootSha256: (await buildC6AssetLock(sourceRoot))
      .assetRootSha256,
    treeReceiptPath,
    treeReceiptSha256: sha256(treeReceiptBytes),
  };
}

function buildResponse(input: {
  commitPaginationGap?: boolean;
  paginationGaps?: boolean;
  repositoryRedirect?: boolean;
}) {
  const pageInfo = (
    endCursor: string | null = null,
    hasNextPage = false,
  ) => ({
    endCursor,
    hasNextPage,
  });
  return {
    data: {
      rateLimit: {
        cost: 2,
        remaining: 4_900,
        resetAt: "2026-07-25T19:00:00Z",
      },
      repository: {
        nameWithOwner: input.repositoryRedirect
          ? "canonical/project"
          : "example/project",
        pullRequest: {
          baseRefName: "main",
          baseRefOid: "0".repeat(40),
          baseRepository: {
            nameWithOwner: input.repositoryRedirect
              ? "canonical/project"
              : "example/project",
          },
          closingIssuesReferences: {
            nodes: [{ number: 10 }],
            pageInfo: pageInfo(),
          },
          comments: {
            nodes: [{ id: "comment-1" }, { id: "comment-2" }],
            pageInfo: input.paginationGaps
              ? pageInfo("discussion-cursor", true)
              : pageInfo(),
          },
          commits: {
            nodes: [{
              commit: {
                committedDate: "2026-07-20T12:00:00Z",
                oid: "1".repeat(40),
                parents: {
                  nodes: [{ oid: "0".repeat(40) }],
                  pageInfo: input.paginationGaps
                    ? pageInfo("parent-cursor", true)
                    : pageInfo(),
                },
              },
            }, {
              commit: {
                committedDate: "2026-07-21T12:00:00Z",
                oid: "2".repeat(40),
                parents: {
                  nodes: [
                    { oid: "1".repeat(40) },
                    { oid: "3".repeat(40) },
                  ],
                  pageInfo: pageInfo(),
                },
              },
            }],
            pageInfo: input.commitPaginationGap
              ? pageInfo("commit-cursor", true)
              : pageInfo(),
          },
          headRefName: "feature",
          headRefOid: input.commitPaginationGap
            ? "f".repeat(40)
            : "2".repeat(40),
          mergeCommit: null,
          merged: false,
          mergedAt: null,
          number: 1,
          reviewThreads: {
            nodes: [{
              comments: {
                nodes: [{
                  commit: { oid: "2".repeat(40) },
                  originalCommit: { oid: "1".repeat(40) },
                }, {
                  commit: null,
                  originalCommit: { oid: "1".repeat(40) },
                }],
                pageInfo: pageInfo(),
              },
              id: "thread-1",
              isResolved: true,
            }],
            pageInfo: pageInfo(),
          },
          reviews: {
            nodes: [{
              commit: { oid: "1".repeat(40) },
              state: "CHANGES_REQUESTED",
            }, {
              commit: null,
              state: "COMMENTED",
            }],
            pageInfo: pageInfo(),
          },
          url: input.repositoryRedirect
            ? "https://github.com/canonical/project/pull/1"
            : "https://github.com/example/project/pull/1",
        },
      },
    },
  };
}

async function createRestSupplement(fixture: Fixture): Promise<string> {
  const root = join(fixture.root, "rest-supplement");
  const directory = join(root, "example__project__1");
  const bodies = [{
    bytes: Buffer.from(JSON.stringify({
      base: {
        repo: {
          full_name: "example/project",
          id: 42,
        },
        sha: "0".repeat(40),
      },
      comments: 2,
      commits: 101,
      head: {
        sha: "f".repeat(40),
      },
      html_url: "https://github.com/example/project/pull/1",
      number: 1,
      review_comments: 2,
    })),
    endpoint: "pull",
    issueNumber: null,
    link: null,
    page: null,
    path: "responses/pull.json",
    url: "https://api.github.com/repos/example/project/pulls/1",
  }, {
    bytes: Buffer.from(JSON.stringify(
      Array.from({ length: 100 }, (_, index) => ({
        sha: index === 0
          ? "1".repeat(40)
          : index === 1
          ? "2".repeat(40)
          : (index + 1).toString(16).padStart(40, "0"),
      })),
    )),
    endpoint: "commits",
    issueNumber: null,
    link:
      '<https://api.github.com/repositories/42/pulls/1/commits?per_page=100&page=2>; rel="next", <https://api.github.com/repositories/42/pulls/1/commits?per_page=100&page=2>; rel="last"',
    page: 1,
    path: "responses/commits/page-0001.json",
    url:
      "https://api.github.com/repos/example/project/pulls/1/commits?per_page=100&page=1",
  }, {
    bytes: Buffer.from(JSON.stringify([{
      sha: "f".repeat(40),
    }])),
    endpoint: "commits",
    issueNumber: null,
    link:
      '<https://api.github.com/repositories/42/pulls/1/commits?per_page=100&page=1>; rel="prev", <https://api.github.com/repositories/42/pulls/1/commits?per_page=100&page=1>; rel="first"',
    page: 2,
    path: "responses/commits/page-0002.json",
    url:
      "https://api.github.com/repositories/42/pulls/1/commits?per_page=100&page=2",
  }];
  const requests = bodies.map((body) => ({
    endpoint: body.endpoint,
    issueNumber: body.issueNumber,
    page: body.page,
    request: {
      headers: {
        accept: "application/vnd.github+json",
        authorization: "redacted",
        "user-agent": "goodmemory-c6-github-rest-capture/1",
        "x-github-api-version": "2022-11-28",
      },
      method: "GET",
      url: body.url,
    },
    response: {
      headers: {
        "content-type": "application/json; charset=utf-8",
        date: "Sat, 25 Jul 2026 18:00:00 GMT",
        etag: "\"etag\"",
        "x-github-api-version-selected": "2022-11-28",
        "x-github-request-id": `request-${body.endpoint}-${body.page}`,
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4900",
        "x-ratelimit-reset": "1785006000",
        "x-ratelimit-resource": "core",
        "x-ratelimit-used": "100",
        link: body.link,
      },
      rawBody: {
        bytes: body.bytes.byteLength,
        path: body.path,
        sha256: sha256(body.bytes),
      },
      status: 200,
    },
  }));
  const manifest = {
    boundary: {
      authorizationRecordedAs: "redacted",
      bearerAuthorizationHeaderSent: true,
      cryptographicPlatformReceipt: false,
      httpsUrlEnforced: true,
      platformAuthenticationCryptographicallyProven: false,
      status:
        "https-bearer-rest-session-local-capture-not-cryptographic-platform-receipt",
      tlsPeerReceiptCaptured: false,
    },
    generatedBy: "scripts/codex-coding-effect/c6-github-rest-capture.ts",
    input: {
      owner: "example",
      pullNumber: 1,
      repository: "project",
      resolvedIssueNumbers: [],
    },
    requestProtocol: {
      accept: "application/vnd.github+json",
      apiRoot: "https://api.github.com",
      apiVersion: "2022-11-28",
      pagination: "per-page-100-follow-validated-link-next-until-absent",
      userAgent: "goodmemory-c6-github-rest-capture/1",
    },
    requests,
    responseClosureSha256: sha256(Buffer.from(JSON.stringify(
      requests.map((request) => request.response.rawBody),
    ))),
    schemaVersion: 1,
  };
  for (const body of bodies) {
    const path = join(directory, body.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body.bytes);
  }
  await writeFile(
    join(directory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return root;
}

async function rewriteRestResponse(
  root: string,
  directory: string,
  relativePath: string,
  rewrite: (value: unknown) => unknown,
): Promise<void> {
  const responsePath = join(root, directory, relativePath);
  const responseBytes = Buffer.from(JSON.stringify(
    rewrite(JSON.parse(await readFile(responsePath, "utf8")) as unknown),
  ));
  await writeFile(responsePath, responseBytes);
  const manifestPath = join(root, directory, "manifest.json");
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

function gitBlobOid(value: string): string {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(value)}\0`)
    .update(value)
    .digest("hex");
}

function graphqlHeaders(): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    date: "Sat, 25 Jul 2026 18:00:00 GMT",
    "x-github-request-id": "request-id",
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": "4900",
    "x-ratelimit-reset": "1785006000",
    "x-ratelimit-resource": "graphql",
    "x-ratelimit-used": "100",
  };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
