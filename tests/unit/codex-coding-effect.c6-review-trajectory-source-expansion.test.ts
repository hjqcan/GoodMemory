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
import { join } from "node:path";

import { buildC6AssetLock } from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  materializeC6ReviewTrajectorySourceExpansion,
  projectC6ReviewTrajectorySourceExpansion,
  serializeC6ReviewTrajectorySourceExpansion,
} from "../../scripts/codex-coding-effect/c6-review-trajectory-source-expansion";

describe("Codex coding-effect C6 review trajectory source expansion", () => {
  it("excludes the complete legacy frame and projects one canonical lineage per PR", () => {
    const fixture = createProjectionFixture();
    const expansion = projectC6ReviewTrajectorySourceExpansion(fixture);
    const replay = projectC6ReviewTrajectorySourceExpansion({
      ...fixture,
      responsesByDirectory: new Map(
        [...fixture.responsesByDirectory].reverse(),
      ),
    });

    expect(replay).toEqual(expansion);
    expect(expansion.boundary).toEqual({
      acceptedEpisodeCount: 0,
      adaptiveProspective: true,
      candidateManifestFrozen: false,
      codexRunReady: false,
      pretargetsRequireExactRestClosure: true,
      status: "prospective-structural-pretargets-not-episodes",
      upperBoundClaimPermitted: false,
    });
    expect(expansion.counts).toEqual({
      canonicalLegacyExclusionCount: 1,
      discoverySurfaceUnsupportedCount: 0,
      inventoryAnchorCount: 3,
      prospectiveAnchorCount: 2,
      repositoryCappedStructuralCeiling: 2,
      structuralPretargetCount: 2,
      structuralPretargetRepositoryCount: 2,
    });
    expect(expansion.legacyFrame).toMatchObject({
      candidateCount: 1,
      candidateProjectionSha256: fixture.frameCandidateProjectionSha256,
    });
    expect(
      expansion.pretargets.map((candidate) => ({
        anchorId: candidate.anchorId,
        canonicalAnchorId: candidate.canonicalAnchorId,
        repository: candidate.repository,
        repositoryRank: candidate.repositoryRank,
      })),
    ).toEqual(expect.arrayContaining([{
      anchorId: "example/alpha#2",
      canonicalAnchorId: "example/alpha#2",
      repository: "example/alpha",
      repositoryRank: 1,
    }, {
      anchorId: "legacy/renamed#3",
      canonicalAnchorId: "canonical/renamed#3",
      repository: "canonical/renamed",
      repositoryRank: 1,
    }]));
    expect(
      expansion.pretargets.some(
        (candidate) => candidate.anchorId === "example/alpha#1",
      ),
    ).toBe(false);
    expect(
      expansion.pretargets.map((candidate) => candidate.pretargetRank),
    ).toEqual([1, 2]);
    expect(
      expansion.pretargets.map((candidate) => candidate.restCaptureOrder)
        .sort((left, right) => left - right),
    ).toEqual([1, 2]);
    expect(serializeC6ReviewTrajectorySourceExpansion(expansion)).toBe(
      `${JSON.stringify(expansion, null, 2)}\n`,
    );
  });

  it("keeps candidate identity invariant to forbidden and array-order fields", () => {
    const baseline = createProjectionFixture();
    const mutated = createProjectionFixture({
      mutateResponse(response) {
        const pull = response.data.repository.pullRequest;
        const extendedPull = pull as typeof pull & {
          body: string;
          sourceTestSignals: unknown;
        };
        extendedPull.body =
          "gold and outcome text must remain irrelevant";
        extendedPull.sourceTestSignals = { f2p: ["hidden"] };
        pull.reviews.nodes.reverse();
        pull.commits.nodes.reverse();
        pull.reviewThreads.nodes.reverse();
        for (const thread of pull.reviewThreads.nodes) {
          thread.isResolved = !thread.isResolved;
          thread.comments.nodes.reverse();
          for (const comment of thread.comments.nodes) {
            comment.commit = { oid: oid("f") };
          }
        }
      },
    });

    const first = projectC6ReviewTrajectorySourceExpansion(baseline);
    const second = projectC6ReviewTrajectorySourceExpansion(mutated);
    const selection = (value: typeof first) =>
      value.pretargets.map((candidate) => ({
        anchorId: candidate.anchorId,
        canonicalAnchorId: candidate.canonicalAnchorId,
        lineageIdentitySha256: candidate.lineageIdentitySha256,
        pretargetRank: candidate.pretargetRank,
        rankSha256: candidate.rankSha256,
        repositoryRank: candidate.repositoryRank,
        restCaptureOrder: candidate.restCaptureOrder,
        sequence: candidate.linearReviewSequence,
      }));

    expect(selection(second)).toEqual(selection(first));
  });

  it("fails closed on frame identity, raw-response identity, and canonical collisions", () => {
    const frameDrift = createProjectionFixture();
    const frame = JSON.parse(
      frameDrift.legacyFrameBytes.toString("utf8"),
    ) as {
      candidates: Array<{ anchorId: string }>;
    };
    frame.candidates[0]!.anchorId = "unknown/repository#99";
    expect(() =>
      projectC6ReviewTrajectorySourceExpansion({
        ...frameDrift,
        legacyFrameBytes: bytes(frame),
      })
    ).toThrow("legacy frame candidate projection mismatch");

    const rawDrift = createProjectionFixture();
    rawDrift.responsesByDirectory.set(
      "example__alpha__2",
      Buffer.from("{}\n"),
    );
    expect(() =>
      projectC6ReviewTrajectorySourceExpansion(rawDrift)
    ).toThrow("raw response hash mismatch");

    const collision = createProjectionFixture();
    const inventory = JSON.parse(
      collision.inventoryBytes.toString("utf8"),
    ) as ProjectionInventory;
    inventory.anchors[2]!.anchorId = "legacy/renamed#2";
    inventory.anchors[2]!.number = 2;
    inventory.captureEntries[2]!.anchorId = "legacy/renamed#2";
    inventory.captureEntries[2]!.repository.resolved = "example/alpha";
    const response = parseResponse(
      collision.responsesByDirectory.get("legacy__renamed__3")!,
    );
    response.data.repository.nameWithOwner = "example/alpha";
    response.data.repository.pullRequest.number = 2;
    const responseBytes = bytes(response);
    inventory.captureEntries[2]!.responseSha256 = sha256(responseBytes);
    collision.responsesByDirectory.set(
      "legacy__renamed__3",
      responseBytes,
    );
    expect(() =>
      projectC6ReviewTrajectorySourceExpansion({
        ...collision,
        inventoryBytes: bytes(inventory),
      })
    ).toThrow("canonical anchor collision");
  });

  it("materializes only from an exact raw root and refuses overwrite", async () => {
    const fixture = createProjectionFixture();
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "goodmemory-c6-expansion-")),
    );
    try {
      const captureRoot = join(root, "graphql");
      for (const [directory, responseBytes] of
        fixture.responsesByDirectory) {
        const target = join(captureRoot, directory);
        await mkdir(target, { recursive: true });
        await writeFile(join(target, "response.json"), responseBytes);
      }
      const inventory = JSON.parse(
        fixture.inventoryBytes.toString("utf8"),
      ) as ProjectionInventory;
      inventory.capture.rootSha256 = (
        await buildC6AssetLock(captureRoot)
      ).assetRootSha256;
      const inventoryBytes = bytes(inventory);
      const inventoryPath = join(root, "inventory.json");
      const framePath = join(root, "frame.json");
      const outputPath = join(root, "expansion.json");
      await writeFile(inventoryPath, inventoryBytes);
      await writeFile(framePath, fixture.legacyFrameBytes);

      const result = await materializeC6ReviewTrajectorySourceExpansion({
        expectedInventorySha256: sha256(inventoryBytes),
        expectedLegacyFrameSha256: sha256(fixture.legacyFrameBytes),
        graphqlCaptureRoot: captureRoot,
        inventoryPath,
        legacyFramePath: framePath,
        outputPath,
      });

      expect(
        await readFile(outputPath, "utf8"),
      ).toBe(serializeC6ReviewTrajectorySourceExpansion(result.expansion));
      await expect(materializeC6ReviewTrajectorySourceExpansion({
        expectedInventorySha256: sha256(inventoryBytes),
        expectedLegacyFrameSha256: sha256(fixture.legacyFrameBytes),
        graphqlCaptureRoot: captureRoot,
        inventoryPath,
        legacyFramePath: framePath,
        outputPath,
      })).rejects.toThrow();
      await writeFile(join(captureRoot, "unexpected.json"), "{}\n");
      await expect(materializeC6ReviewTrajectorySourceExpansion({
        expectedInventorySha256: sha256(inventoryBytes),
        expectedLegacyFrameSha256: sha256(fixture.legacyFrameBytes),
        graphqlCaptureRoot: captureRoot,
        inventoryPath,
        legacyFramePath: framePath,
        outputPath: join(root, "drifted.json"),
      })).rejects.toThrow("GraphQL root hash mismatch");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

interface ProjectionInventory {
  anchors: Array<{
    anchorId: string;
    captureDirectory: string;
    number: number;
    org: string;
    repo: string;
    repository: string;
    source: {
      path: string;
      rowIndex: number;
      rowSha256: string;
    };
  }>;
  artifactKind: string;
  capture: {
    rootSha256: string;
    structureSha256: string;
  };
  captureEntries: Array<{
    anchorId: string;
    captureManifestSha256: string;
    directory: string;
    discoverySurfaceComplete: boolean;
    effectiveDiscoverySurfaceComplete: boolean;
    paginationGaps: unknown[];
    paginationSupplement: unknown;
    repository: {
      redirected: boolean;
      requested: string;
      resolved: string;
    };
    responseSha256: string;
  }>;
  schemaVersion: number;
  source: {
    datasetId: string;
    revision: string;
    rootSha256: string;
    treeReceipt: {
      bytes: number;
      path: string;
      sha256: string;
    };
  };
  sourcePopulationSha256: string;
}

type ProjectionResponse = ReturnType<typeof response>;

function createProjectionFixture(options: {
  mutateResponse?: (response: ProjectionResponse) => void;
} = {}) {
  const anchors = [
    anchor("example", "alpha", 1, 0),
    anchor("example", "alpha", 2, 1),
    anchor("legacy", "renamed", 3, 2),
  ];
  const responses = [
    response("example/alpha", 1),
    response("example/alpha", 2),
    response("canonical/renamed", 3),
  ];
  for (const value of responses) {
    options.mutateResponse?.(value);
  }
  const responseBytes = responses.map(bytes);
  const captureEntries = anchors.map((value, index) => ({
    anchorId: value.anchorId,
    captureManifestSha256: sha256(`capture-${index}`),
    directory: value.captureDirectory,
    discoverySurfaceComplete: true,
    effectiveDiscoverySurfaceComplete: true,
    paginationGaps: [],
    paginationSupplement: null,
    repository: {
      redirected: index === 2,
      requested: value.repository,
      resolved: index === 2 ? "canonical/renamed" : value.repository,
    },
    responseSha256: sha256(responseBytes[index]!),
  }));
  const inventory: ProjectionInventory = {
    anchors,
    artifactKind: "c6-github-graphql-discovery-inventory",
    capture: {
      rootSha256: sha256("capture-root"),
      structureSha256: sha256("capture-structure"),
    },
    captureEntries,
    schemaVersion: 1,
    source: {
      datasetId: "ByteDance-Seed/Multi-SWE-bench",
      revision: oid("e"),
      rootSha256: sha256("source-root"),
      treeReceipt: {
        bytes: 123,
        path: "tree.json",
        sha256: sha256("tree"),
      },
    },
    sourcePopulationSha256: sha256("population"),
  };
  const candidates = [{
    anchorId: "example/alpha#1",
    ignoredMetadata: "must not define the exclusion identity",
  }];
  const frameCandidateProjectionSha256 = sha256(
    JSON.stringify(candidates),
  );
  const legacyFrame = {
    artifactKind: "c6-real-history-screening-frame",
    candidates,
    counts: {
      eligibleCandidateCount: candidates.length,
    },
    independenceBoundary: {
      candidateProjectionSha256: frameCandidateProjectionSha256,
    },
    schemaVersion: 1,
  };
  return {
    frameCandidateProjectionSha256,
    inventoryBytes: bytes(inventory),
    inventoryPath: "inventory.json",
    legacyFrameBytes: bytes(legacyFrame),
    legacyFramePath: "legacy-frame.json",
    responsesByDirectory: new Map(
      anchors.map((value, index) => [
        value.captureDirectory,
        responseBytes[index]!,
      ]),
    ),
  };
}

function anchor(
  org: string,
  repo: string,
  number: number,
  rowIndex: number,
) {
  return {
    anchorId: `${org}/${repo}#${number}`.toLowerCase(),
    captureDirectory: `${org}__${repo}__${number}`,
    number,
    org,
    repo,
    repository: `${org}/${repo}`.toLowerCase(),
    source: {
      path: `typescript/${org}__${repo}_dataset.jsonl`,
      rowIndex,
      rowSha256: sha256(`source-row-${number}`),
    },
  };
}

function response(repository: string, pullNumber: number) {
  return {
    data: {
      repository: {
        nameWithOwner: repository,
        pullRequest: {
          closingIssuesReferences: {
            nodes: [{ number: pullNumber + 1000 }],
            pageInfo: completePage(),
          },
          commits: {
            nodes: [
              graphCommit("a", "2026-01-01T00:00:00Z", []),
              graphCommit("b", "2026-01-01T02:00:00Z", ["a"]),
              graphCommit("c", "2026-01-01T04:00:00Z", ["b"]),
            ],
            pageInfo: completePage(),
          },
          number: pullNumber,
          reviewThreads: {
            nodes: [{
              comments: {
                nodes: [{
                  author: { login: "reviewer-two" },
                  body: "Second structural correction.",
                  commit: { oid: oid("c") },
                  createdAt: "2026-01-01T03:00:00Z",
                  id: `thread-comment-${pullNumber}`,
                  originalCommit: { oid: oid("b") },
                }],
                pageInfo: completePage(),
              },
              id: `thread-${pullNumber}`,
              isResolved: false,
            }],
            pageInfo: completePage(),
          },
          reviews: {
            nodes: [{
              author: { login: "reviewer-one" },
              body: "First structural correction.",
              commit: { oid: oid("a") },
              id: `review-${pullNumber}`,
              state: "CHANGES_REQUESTED",
              submittedAt: "2026-01-01T01:00:00Z",
            }],
            pageInfo: completePage(),
          },
        },
      },
    },
  };
}

function graphCommit(
  label: string,
  committedDate: string,
  parents: string[],
) {
  return {
    commit: {
      committedDate,
      oid: oid(label),
      parents: {
        nodes: parents.map((parent) => ({ oid: oid(parent) })),
        pageInfo: completePage(),
      },
    },
  };
}

function completePage() {
  return {
    endCursor: null,
    hasNextPage: false,
  };
}

function parseResponse(value: Uint8Array): ProjectionResponse {
  return JSON.parse(Buffer.from(value).toString("utf8")) as ProjectionResponse;
}

function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function oid(label: string): string {
  return label.repeat(40).slice(0, 40);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
