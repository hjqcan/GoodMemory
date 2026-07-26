import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildC6AssetLock } from "../../scripts/codex-coding-effect/c6-asset-lock";
import { captureC6GitHubGraphQLDiscovery } from "../../scripts/codex-coding-effect/c6-github-graphql-discovery";
import {
  deriveC6MultilingualReviewTrajectoryExpansion,
  materializeC6MultilingualReviewTrajectoryExpansion,
  serializeC6MultilingualReviewTrajectoryExpansion,
} from "../../scripts/codex-coding-effect/c6-multilingual-review-trajectory-expansion";

describe("Codex coding-effect C6 multilingual review trajectory expansion", () => {
  it("projects broad pretargets in frozen source order and fails pagination closed", () => {
    const input = fixture();
    const expansion = deriveC6MultilingualReviewTrajectoryExpansion(input);
    const replay = deriveC6MultilingualReviewTrajectoryExpansion({
      ...input,
      capturesByDirectory: new Map(
        [...input.capturesByDirectory].reverse(),
      ),
    });

    expect(replay).toEqual(expansion);
    expect(expansion.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      pullAuthorQualified: false,
      status: "multilingual-broad-structural-pretargets-only",
    });
    expect(expansion.counts).toEqual({
      broadStructuralPretargetCount: 2,
      broadStructuralRepositoryCount: 2,
      capturedClosureCount: 4,
      discoveryCompleteCount: 3,
      freshBroadStructuralPretargetCount: 1,
      priorFrameOverlapCount: 1,
      repositoryCappedFreshCeiling: 1,
      sourceTargetCount: 4,
      unsupportedPaginationCount: 1,
    });
    expect(
      expansion.results.map((result) => ({
        anchor: result.canonicalAnchorId,
        order: result.captureOrder,
        status: result.status,
      })),
    ).toEqual([
      {
        anchor: "example/legacy#1",
        order: 1,
        status: "prior-frame-overlap",
      },
      {
        anchor: "example/fresh#2",
        order: 2,
        status: "broad-structural-pretarget",
      },
      {
        anchor: "example/none#3",
        order: 3,
        status: "no-broad-structural-sequence",
      },
      {
        anchor: "example/gap#4",
        order: 4,
        status: "unsupported-pagination",
      },
    ]);
    expect(expansion.policy.sha256).toBe(
      "b51613368026c09ad1aab3e4d08fe19197ddc1beea9499c9d8e068830527703a",
    );
    expect(expansion.results[1]).toMatchObject({
      canonicalAnchorId: "example/fresh#2",
      legalSequenceCount: 1,
      sequence: {
        firstFixCommit: oid("b"),
        initialCommit: oid("a"),
        secondFixCommit: oid("c"),
      },
      status: "broad-structural-pretarget",
    });
  });

  it("keeps construction independent of evaluator, semantic, and machine fields", () => {
    const baseline = fixture();
    const mutated = fixture();
    const mutatedTargets = mutated.targets as Array<
      (typeof mutated.targets)[number] & Record<string, unknown>
    >;
    mutatedTargets[1]!.goldPatchSha256 = "f".repeat(64);
    mutatedTargets[1]!.semanticScreeningDecision = "accept";
    mutatedTargets[1]!.machineQualificationDecision = "pass";
    const capture = mutated.capturesByDirectory.get("example__fresh__2")! as
      typeof mutated.capturesByDirectory extends ReadonlyMap<string, infer T>
        ? T & Record<string, unknown>
        : never;
    capture.outcome = "PASS";

    const first = deriveC6MultilingualReviewTrajectoryExpansion(baseline);
    const second = deriveC6MultilingualReviewTrajectoryExpansion(mutated);

    expect(second.independenceBoundary).toEqual(
      first.independenceBoundary,
    );
    expect(second.results).toEqual(first.results);
  });

  it("requires an exact one-to-one capture closure", () => {
    const missing = fixture();
    missing.capturesByDirectory.delete("example__fresh__2");
    expect(() =>
      deriveC6MultilingualReviewTrajectoryExpansion(missing)
    ).toThrow("missing capture example__fresh__2");

    const unexpected = fixture();
    unexpected.capturesByDirectory.set(
      "unexpected__repo__9",
      completeCapture("unexpected/repo"),
    );
    expect(() =>
      deriveC6MultilingualReviewTrajectoryExpansion(unexpected)
    ).toThrow("unexpected capture unexpected__repo__9");
  });

  it("carries an optional pinned source descriptor without changing review policy", () => {
    const input = fixture();
    const targets = input.targets.map((value, index) => ({
      ...value,
      sourceSplit: index % 2 === 0 ? "go" : "rust",
      sourceSplitRowIndex: index,
    }));
    const expansion = deriveC6MultilingualReviewTrajectoryExpansion({
      ...input,
      sourceDataset: {
        datasetId: "SWE-bench-Live/MultiLang",
        revision: "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b",
      },
      targets,
    });

    expect(expansion.sourceDataset).toEqual({
      datasetId: "SWE-bench-Live/MultiLang",
      revision: "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b",
    });
    expect(expansion.results[0]).toMatchObject({
      sourceSplit: "go",
      sourceSplitRowIndex: 0,
    });
    expect(expansion.policy.sha256).toBe(
      "b51613368026c09ad1aab3e4d08fe19197ddc1beea9499c9d8e068830527703a",
    );
  });

  it("materializes only from the frozen plan, frame, and complete capture root", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "goodmemory-c6-multilingual-")),
    );
    try {
      const captureRoot = join(root, "graphql");
      const input = fixture();
      for (const target of input.targets) {
        await captureC6GitHubGraphQLDiscovery({
          fetchImpl: async () => responseFor(target),
          outputDirectory: join(captureRoot, target.captureDirectory),
          owner: target.owner,
          pullNumber: target.pullNumber,
          repo: target.repo,
          token: "test-token",
        });
      }
      const plan = {
        artifactKind: "c6-multilingual-source-expansion-plan",
        boundary: {
          acceptedEpisodeCount: 0,
          adaptiveProspective: true,
          candidateManifestFrozen: false,
          codexRunReady: false,
          status: "multilingual-graphql-capture-plan-only",
        },
        counts: {
          repositoryCount: 4,
          sourceRowCount: input.targets.length,
          targetCount: input.targets.length,
        },
        independenceBoundary: {
          canonicalDeduplicationDeferredToPostCapture: true,
          machineOutcomeInput: false,
          selectionUsesEvaluatorFields: false,
          semanticLedgerInput: false,
          targetProjectionSha256: sha256(
            JSON.stringify(input.targets),
          ),
        },
        rule: {
          captureOrder: "source-rowIndex-ascending",
          forbiddenSelectionInputs: [],
          selection: "all-frozen-source-rows",
        },
        schemaVersion: 1,
        sourcePool: {
          bytes: 1,
          datasetId: "SWE-bench/SWE-bench_Multilingual",
          path: "source-pool.json",
          revision:
            "e5c585e008e2cb5eecc7c64192d855c53279d788",
          sha256: "5".repeat(64),
        },
        targets: input.targets,
      };
      const priorCandidates = [{
        canonicalAnchorId: "example/legacy#1",
      }];
      const frame = {
        artifactKind: "c6-source-expansion-screening-frame",
        candidates: priorCandidates,
        counts: {
          combinedStructuralCandidateCount: priorCandidates.length,
        },
        independenceBoundary: {
          candidateProjectionSha256: sha256(
            JSON.stringify(priorCandidates),
          ),
        },
        schemaVersion: 2,
      };
      const planBytes = bytes(plan);
      const frameBytes = bytes(frame);
      const planPath = join(root, "plan.json");
      const framePath = join(root, "frame.json");
      const outputPath = join(root, "expansion.json");
      await Promise.all([
        writeFile(planPath, planBytes),
        writeFile(framePath, frameBytes),
      ]);
      const captureLock = await buildC6AssetLock(captureRoot);

      const result =
        await materializeC6MultilingualReviewTrajectoryExpansion({
          capturePlanPath: planPath,
          expectedCapturePlanSha256: sha256(planBytes),
          expectedGraphqlRootSha256: captureLock.assetRootSha256,
          expectedPriorFrameSha256: sha256(frameBytes),
          graphqlRoot: captureRoot,
          outputPath,
          priorFramePath: framePath,
        });

      expect(await readFile(outputPath, "utf8")).toBe(
        serializeC6MultilingualReviewTrajectoryExpansion(
          result.expansion,
        ),
      );
      await expect(
        materializeC6MultilingualReviewTrajectoryExpansion({
          capturePlanPath: planPath,
          expectedCapturePlanSha256: sha256(planBytes),
          expectedGraphqlRootSha256: captureLock.assetRootSha256,
          expectedPriorFrameSha256: sha256(frameBytes),
          graphqlRoot: captureRoot,
          outputPath,
          priorFramePath: framePath,
        }),
      ).rejects.toThrow();
      await writeFile(join(captureRoot, "unexpected.json"), "{}\n");
      await expect(
        materializeC6MultilingualReviewTrajectoryExpansion({
          capturePlanPath: planPath,
          expectedCapturePlanSha256: sha256(planBytes),
          expectedGraphqlRootSha256: captureLock.assetRootSha256,
          expectedPriorFrameSha256: sha256(frameBytes),
          graphqlRoot: captureRoot,
          outputPath: join(root, "drifted.json"),
          priorFramePath: framePath,
        }),
      ).rejects.toThrow("GraphQL root hash mismatch");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function fixture() {
  const targets = [
    target("example/legacy", 1, 1),
    target("example/fresh", 2, 2),
    target("example/none", 3, 3),
    target("example/gap", 4, 4),
  ];
  return {
    capturePlanSha256: "1".repeat(64),
    capturesByDirectory: new Map([
      ["example__legacy__1", completeCapture("example/legacy")],
      ["example__fresh__2", completeCapture("example/fresh")],
      ["example__none__3", {
        ...completeCapture("example/none"),
        reviews: [],
        reviewThreads: [],
      }],
      ["example__gap__4", {
        ...completeCapture("example/gap"),
        paginationGaps: [{
          endCursor: "cursor",
          path: "data.repository.pullRequest.reviews.pageInfo",
        }],
      }],
    ]),
    graphqlRootSha256: "2".repeat(64),
    priorCandidateProjectionSha256: "3".repeat(64),
    priorFrameCanonicalAnchorIds: new Set(["example/legacy#1"]),
    priorFrameSha256: "4".repeat(64),
    targets,
  };
}

function target(repository: string, pullNumber: number, captureOrder: number) {
  const [owner, repo] = repository.split("/");
  return {
    agentVisibleRequestSha256: String(captureOrder).repeat(64),
    captureDirectory: `${owner}__${repo}__${pullNumber}`,
    captureOrder,
    instanceId: `${owner}__${repo}-${pullNumber}`,
    owner: owner!,
    pullNumber,
    repo: repo!,
    requestedAnchorId: `${repository}#${pullNumber}`,
    rowIndex: captureOrder - 1,
  };
}

function completeCapture(canonicalRepository: string) {
  return {
    canonicalRepository,
    captureManifestSha256: "a".repeat(64),
    commits: [
      commit("a", "2026-01-01T00:00:00Z", []),
      commit("b", "2026-01-01T02:00:00Z", ["a"]),
      commit("c", "2026-01-01T04:00:00Z", ["b"]),
    ],
    paginationGaps: [],
    responseSha256: "b".repeat(64),
    reviews: [{
      author: "reviewer-one",
      body: "First structural correction.",
      commit: oid("a"),
      id: "review-one",
      state: "CHANGES_REQUESTED",
      submittedAt: "2026-01-01T01:00:00Z",
    }],
    reviewThreads: [{
      comments: [{
        author: "reviewer-two",
        body: "Second structural correction.",
        createdAt: "2026-01-01T03:00:00Z",
        id: "review-two",
        originalCommit: oid("b"),
      }],
      id: "thread-one",
    }],
  };
}

function commit(label: string, committedAt: string, parents: string[]) {
  return {
    committedAt,
    oid: oid(label),
    parents: parents.map(oid),
  };
}

function oid(label: string): string {
  return label.repeat(40).slice(0, 40);
}

function responseFor(
  targetValue: ReturnType<typeof target>,
): Response {
  const capture = completeCapture(
    `${targetValue.owner}/${targetValue.repo}`,
  );
  const isGap = targetValue.pullNumber === 4;
  const noSequence = targetValue.pullNumber === 3;
  const body = {
    data: {
      rateLimit: {
        cost: 1,
        remaining: 4999,
        resetAt: "2026-01-01T10:00:00Z",
      },
      repository: {
        nameWithOwner: `${targetValue.owner}/${targetValue.repo}`,
        pullRequest: {
          baseRefName: "main",
          baseRefOid: oid("0"),
          baseRepository: {
            nameWithOwner:
              `${targetValue.owner}/${targetValue.repo}`,
          },
          closingIssuesReferences: connection([]),
          comments: connection([]),
          commits: connection(
            capture.commits.map((value) => ({
              commit: {
                committedDate: value.committedAt,
                oid: value.oid,
                parents: connection(
                  value.parents.map((parent) => ({ oid: parent })),
                ),
              },
            })),
          ),
          headRefName: "feature",
          headRefOid: oid("c"),
          mergeCommit: null,
          merged: true,
          mergedAt: "2026-01-01T05:00:00Z",
          number: targetValue.pullNumber,
          reviewThreads: connection(
            noSequence
              ? []
              : capture.reviewThreads.map((thread) => ({
                comments: connection(
                  thread.comments.map((comment) => ({
                    author: { login: comment.author },
                    body: comment.body,
                    commit: { oid: oid("b") },
                    createdAt: comment.createdAt,
                    id: comment.id,
                    originalCommit: {
                      oid: comment.originalCommit,
                    },
                  })),
                ),
                id: thread.id,
                isResolved: false,
              })),
          ),
          reviews: connection(
            noSequence
              ? []
              : capture.reviews.map((review) => ({
                author: { login: review.author },
                body: review.body,
                commit: { oid: review.commit },
                id: review.id,
                state: review.state,
                submittedAt: review.submittedAt,
              })),
            isGap,
          ),
          url:
            `https://github.com/${targetValue.owner}/` +
            `${targetValue.repo}/pull/${targetValue.pullNumber}`,
        },
      },
    },
  };
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: "Thu, 01 Jan 2026 00:00:00 GMT",
      "x-github-request-id": `request-${targetValue.pullNumber}`,
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4999",
      "x-ratelimit-reset": "1767225600",
      "x-ratelimit-resource": "graphql",
      "x-ratelimit-used": "1",
    },
    status: 200,
  });
}

function connection<T>(nodes: T[], hasNextPage = false) {
  return {
    nodes,
    pageInfo: {
      endCursor: hasNextPage ? "cursor" : null,
      hasNextPage,
    },
  };
}

function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
