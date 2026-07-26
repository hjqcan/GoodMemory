import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  captureC6LiveMultiLangNeighborDeep,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-deep-capture";
import type {
  C6LiveMultiLangNeighborDeepFetch,
  C6LiveMultiLangNeighborDeepQueryHashes,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-deep-capture";
import {
  C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_PARENTS_PAGE_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_COMMITS_PAGE_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_DEEP_INITIAL_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREAD_COMMENTS_PAGE_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREADS_PAGE_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_REVIEWS_PAGE_QUERY,
  deriveC6LiveMultiLangNeighborDeepCapturePlan,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-deep-capture-plan";
import {
  parseC6LiveMultiLangNeighborDeepCaptureCliOptions,
} from "../../scripts/capture-codex-coding-effect-c6-live-multilang-neighbor-deep";

const TOKEN = "github_pat_never_persist_this_secret_123456789";
const BASE_OID = "a".repeat(40);
const MERGE_OID = "b".repeat(40);
const COMMIT_ONE = "1".repeat(40);
const COMMIT_TWO = "2".repeat(40);
const PARENT_ONE = "3".repeat(40);
const PARENT_TWO = "4".repeat(40);
const PARENT_THREE = "5".repeat(40);

describe("Codex coding-effect C6 Live/MultiLang neighbor deep capture", () => {
  it("captures every query family, recursively closes pages, retries, and publishes atomically", async () => {
    const root = await temporaryRoot();
    try {
      const fixture = await writePlan(root, {
        reviewCount: 3,
        reviewThreadCount: 2,
      });
      const outputRoot = join(root, "capture");
      const progress: string[] = [];
      const sleeps: number[] = [];
      const queue: FakeReply[] = [
        reply("initial", initialBody({
          commits: connection(2, [
            commitNode("commit-1", COMMIT_ONE, [PARENT_ONE], {
              endCursor: "parents-1",
              hasNextPage: true,
              totalCount: 2,
            }),
          ], "commits-1", true),
          reviews: connection(3, [review("review-1")], "reviews-1", true),
          reviewThreads: connection(2, [
            thread("thread-1", connection(
              3,
              [comment("comment-1")],
              "comments-1",
              true,
            )),
          ], "threads-1", true),
        })),
        reply(
          "commitParents",
          { message: "temporary upstream failure" },
          502,
          { "retry-after": "0" },
        ),
        reply("commitParents", nodeBody({
          __typename: "Commit",
          id: "commit-1",
          oid: COMMIT_ONE,
          parents: connection(
            2,
            [{ oid: PARENT_TWO }],
            "parents-2",
            false,
          ),
        })),
        reply("commits", repositoryPageBody("commits", connection(
          2,
          [commitNode("commit-2", COMMIT_TWO, [PARENT_THREE])],
          "commits-2",
          false,
        ))),
        reply("reviews", repositoryPageBody("reviews", connection(
          3,
          [review("review-2")],
          "reviews-2",
          true,
        ))),
        reply("reviews", repositoryPageBody("reviews", connection(
          3,
          [review("review-3")],
          "reviews-3",
          false,
        ))),
        reply("reviewThreadComments", nodeBody({
          __typename: "PullRequestReviewThread",
          comments: connection(
            3,
            [comment("comment-2")],
            "comments-2",
            true,
          ),
          id: "thread-1",
        })),
        reply("reviewThreadComments", nodeBody({
          __typename: "PullRequestReviewThread",
          comments: connection(
            3,
            [comment("comment-3")],
            "comments-3",
            false,
          ),
          id: "thread-1",
        })),
        reply("reviewThreads", repositoryPageBody(
          "reviewThreads",
          connection(2, [
            thread("thread-2", connection(
              1,
              [comment("comment-4")],
              "thread-2-comments",
              false,
            )),
          ], "threads-2", false),
        )),
      ];
      const result = await captureC6LiveMultiLangNeighborDeep({
        authorizationToken: TOKEN,
        expectedDeepCaptureTargetProjectionSha256:
          fixture.deepTargetProjectionSha256,
        expectedPlanSha256: fixture.planSha256,
        expectedQueryHashes: fixture.queryHashes,
        expectedTargetCount: 1,
        fetchImpl: fakeFetch(queue),
        outputRoot,
        planPath: fixture.planPath,
        progress: (message) => progress.push(message),
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      });

      expect(queue).toHaveLength(0);
      expect(sleeps).toEqual([0]);
      expect(result).toMatchObject({
        captureCompletenessProven: true,
        capturedTargetCount: 1,
        logicalRequestCount: 8,
        networkRequestCount: 9,
        outputRoot,
      });
      expect(progress.some((message) =>
        message.includes("target=1/1") &&
        message.includes("anchor=example/alpha#11") &&
        message.includes("family=commitParents") &&
        message.includes("page=2") &&
        message.includes("retry=1/3")
      )).toBe(true);
      expect(progress.some((message) =>
        message.includes("family=reviewThreads") &&
        message.includes("rateRemaining=")
      )).toBe(true);

      const completion = JSON.parse(
        await readFile(join(outputRoot, "completion.json"), "utf8"),
      ) as {
        boundary: Record<string, unknown>;
        captures: Array<{ captureDirectory: string }>;
        counts: Record<string, number>;
      };
      expect(completion.boundary).toEqual({
        acceptedEpisodeCount: 0,
        actorCaptureExecuted: false,
        actorQualifiedEpisodeCount: 0,
        candidateManifestFrozen: false,
        captureCompletenessProven: true,
        codexRunReady: false,
        deepCaptureExecuted: true,
        machineQualifiedEpisodeCount: 0,
        semanticallyQualifiedEpisodeCount: 0,
        status: "neighbor-structural-review-deep-capture-complete",
      });
      expect(completion.counts).toMatchObject({
        capturedTargetCount: 1,
        logicalRequestCount: 8,
        networkRequestCount: 9,
        plannedTargetCount: 1,
      });
      const captureDirectory =
        completion.captures[0]!.captureDirectory;
      const manifest = JSON.parse(
        await readFile(
          join(outputRoot, captureDirectory, "capture.json"),
          "utf8",
        ),
      ) as {
        counts: Record<string, number>;
        requests: Array<{
          attempts: unknown[];
          connections: Array<{ connectionKey: string }>;
          family: string;
        }>;
      };
      expect(manifest.counts).toMatchObject({
        commitCount: 2,
        parentEdgeCount: 3,
        reviewCount: 3,
        reviewThreadCommentCount: 4,
        reviewThreadCount: 2,
      });
      expect(manifest.requests.map((request) => request.family)).toEqual([
        "initial",
        "commitParents",
        "commits",
        "reviews",
        "reviews",
        "reviewThreadComments",
        "reviewThreadComments",
        "reviewThreads",
      ]);
      expect(
        manifest.requests[0]!.connections.map(
          (connection) => connection.connectionKey,
        ),
      ).toEqual([
        "commits",
        "commitParents:commit-1",
        "reviews",
        "reviewThreads",
        "reviewThreadComments:thread-1",
      ]);
      expect(manifest.requests[1]!.attempts).toHaveLength(2);
      for (const path of await walkFiles(outputRoot)) {
        expect(await readFile(path, "utf8")).not.toContain(TOKEN);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed with target/family/page context for malformed captures", async () => {
    const cases: Array<{
      mutate: (
        body: ReturnType<typeof initialBody>,
      ) => unknown;
      name: string;
      replies?: (body: ReturnType<typeof initialBody>) => FakeReply[];
      token?: string;
    }> = [{
      name: "GraphQL errors",
      mutate: () => ({
        data: null,
        errors: [{ message: "denied" }],
      }),
    }, {
      name: "identity mismatch",
      mutate: (body) => ({
        ...body,
        data: {
          ...body.data,
          repository: {
            ...body.data.repository,
            nameWithOwner: "wrong/repository",
          },
        },
      }),
    }, {
      name: "cursor cycle",
      mutate: (body) => ({
        ...body,
        data: {
          ...body.data,
          repository: {
            ...body.data.repository,
            pullRequest: {
              ...body.data.repository.pullRequest,
              commits: connection(
                2,
                [commitNode("commit-1", COMMIT_ONE, [])],
                "same-cursor",
                true,
              ),
            },
          },
        },
      }),
      replies: (body) => [
        reply("initial", body),
        reply("commits", repositoryPageBody("commits", connection(
          2,
          [commitNode("commit-2", COMMIT_TWO, [])],
          "same-cursor",
          true,
        ))),
      ],
    }, {
      name: "supplement identity mismatch",
      mutate: (body) => ({
        ...body,
        data: {
          ...body.data,
          repository: {
            ...body.data.repository,
            pullRequest: {
              ...body.data.repository.pullRequest,
              reviews: connection(
                2,
                [review("review-1")],
                "reviews-1",
                true,
              ),
            },
          },
        },
      }),
      replies: (body) => {
        const supplement = repositoryPageBody(
          "reviews",
          connection(
            2,
            [review("review-2")],
            "reviews-2",
            false,
          ),
        );
        supplement.data.repository.pullRequest.id =
          "different-pull-id";
        return [
          reply("initial", body),
          reply("reviews", supplement),
        ];
      },
    }, {
      name: "supplement totalCount drift",
      mutate: (body) => ({
        ...body,
        data: {
          ...body.data,
          repository: {
            ...body.data.repository,
            pullRequest: {
              ...body.data.repository.pullRequest,
              reviews: connection(
                2,
                [review("review-1")],
                "reviews-1",
                true,
              ),
            },
          },
        },
      }),
      replies: (body) => [
        reply("initial", body),
        reply("reviews", repositoryPageBody(
          "reviews",
          connection(
            3,
            [review("review-2"), review("review-3")],
            "reviews-3",
            false,
          ),
        )),
      ],
    }, {
      name: "duplicate node",
      mutate: (body) => ({
        ...body,
        data: {
          ...body.data,
          repository: {
            ...body.data.repository,
            pullRequest: {
              ...body.data.repository.pullRequest,
              commits: connection(2, [
                commitNode("commit-1", COMMIT_ONE, []),
                commitNode("commit-1", COMMIT_ONE, []),
              ], "duplicate", false),
            },
          },
        },
      }),
    }, {
      name: "schema drift",
      mutate: (body) => ({
        ...body,
        data: {
          ...body.data,
          rateLimit: {
            ...body.data.rateLimit,
            remaining: "not-a-number",
          },
        },
      }),
    }, {
      name: "token reflection",
      mutate: (body) => ({
        ...body,
        data: {
          ...body.data,
          repository: {
            ...body.data.repository,
            pullRequest: {
              ...body.data.repository.pullRequest,
              reviews: connection(
                1,
                [{ ...review("review-token"), body: TOKEN }],
                "review-token",
                false,
              ),
            },
          },
        },
      }),
      token: TOKEN,
    }];

    for (const testCase of cases) {
      const root = await temporaryRoot();
      try {
        const fixture = await writePlan(root);
        const outputRoot = join(root, "capture");
        const body = testCase.mutate(initialBody());
        const queue = testCase.replies?.(
          body as ReturnType<typeof initialBody>,
        ) ?? [reply("initial", body)];
        await expect(
          captureC6LiveMultiLangNeighborDeep({
            authorizationToken: testCase.token ?? TOKEN,
            expectedDeepCaptureTargetProjectionSha256:
              fixture.deepTargetProjectionSha256,
            expectedPlanSha256: fixture.planSha256,
            expectedQueryHashes: fixture.queryHashes,
            expectedTargetCount: 1,
            fetchImpl: fakeFetch(queue),
            outputRoot,
            planPath: fixture.planPath,
            progress: () => {},
            sleep: async () => {},
          }),
        ).rejects.toThrow(
          /target=1\/1.*family=(?:initial|commits|reviews)/u,
        );
        expect(await exists(outputRoot)).toBe(false);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  });

  it("bounds retries for 429, 502, 503, and 504", async () => {
    for (const status of [429, 502, 503, 504]) {
      const root = await temporaryRoot();
      try {
        const fixture = await writePlan(root);
        const queue = [
          reply(
            "initial",
            { message: "retry" },
            status,
            { "retry-after": "0" },
          ),
          reply("initial", initialBody()),
        ];
        const sleeps: number[] = [];
        await captureC6LiveMultiLangNeighborDeep({
          authorizationToken: TOKEN,
          expectedDeepCaptureTargetProjectionSha256:
            fixture.deepTargetProjectionSha256,
          expectedPlanSha256: fixture.planSha256,
          expectedQueryHashes: fixture.queryHashes,
          expectedTargetCount: 1,
          fetchImpl: fakeFetch(queue),
          outputRoot: join(root, `capture-${status}`),
          planPath: fixture.planPath,
          progress: () => {},
          sleep: async (milliseconds) => {
            sleeps.push(milliseconds);
          },
        });
        expect(queue).toHaveLength(0);
        expect(sleeps).toEqual([0]);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }

    const root = await temporaryRoot();
    try {
      const fixture = await writePlan(root);
      const queue = Array.from({ length: 4 }, () =>
        reply(
          "initial",
          { message: "still unavailable" },
          503,
          { "retry-after": "120" },
        )
      );
      const sleeps: number[] = [];
      await expect(
        captureC6LiveMultiLangNeighborDeep({
          authorizationToken: TOKEN,
          expectedDeepCaptureTargetProjectionSha256:
            fixture.deepTargetProjectionSha256,
          expectedPlanSha256: fixture.planSha256,
          expectedQueryHashes: fixture.queryHashes,
          expectedTargetCount: 1,
          fetchImpl: fakeFetch(queue),
          outputRoot: join(root, "capture-exhausted"),
          planPath: fixture.planPath,
          progress: () => {},
          sleep: async (milliseconds) => {
            sleeps.push(milliseconds);
          },
        }),
      ).rejects.toThrow(/target=1\/1.*family=initial.*HTTP 503/u);
      expect(sleeps).toEqual([60_000, 60_000, 60_000]);
      expect(queue).toHaveLength(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("retries fetch rejection, body-read failure, and bounded timeout with redacted provenance", async () => {
    const scenarios: Array<{
      firstAttempt: () => Promise<Response>;
      phase: "body-read" | "fetch" | "timeout";
      requestTimeoutMilliseconds?: number;
    }> = [{
      firstAttempt: async () => {
        throw new Error(`fetch rejected ${TOKEN}`);
      },
      phase: "fetch",
    }, {
      firstAttempt: async () => {
        const failed = response(initialBody(), 200);
        Object.defineProperty(failed, "arrayBuffer", {
          value: async () => {
            throw new Error(`body read failed ${TOKEN}`);
          },
        });
        return failed;
      },
      phase: "body-read",
    }, {
      firstAttempt: async () => {
        await new Promise((resolveDelay) => {
          setTimeout(resolveDelay, 25);
        });
        return response(initialBody(), 200);
      },
      phase: "timeout",
      requestTimeoutMilliseconds: 5,
    }];

    for (const scenario of scenarios) {
      const root = await temporaryRoot();
      try {
        const fixture = await writePlan(root);
        const outputRoot = join(root, `capture-${scenario.phase}`);
        const sleeps: number[] = [];
        let calls = 0;
        const result = await captureC6LiveMultiLangNeighborDeep({
          authorizationToken: TOKEN,
          expectedDeepCaptureTargetProjectionSha256:
            fixture.deepTargetProjectionSha256,
          expectedPlanSha256: fixture.planSha256,
          expectedQueryHashes: fixture.queryHashes,
          expectedTargetCount: 1,
          fetchImpl: async () => {
            calls += 1;
            return calls === 1
              ? scenario.firstAttempt()
              : response(initialBody(), 200);
          },
          outputRoot,
          planPath: fixture.planPath,
          progress: () => {},
          requestTimeoutMilliseconds:
            scenario.requestTimeoutMilliseconds,
          sleep: async (milliseconds) => {
            sleeps.push(milliseconds);
          },
        });

        expect(result.networkRequestCount).toBe(2);
        expect(calls).toBe(2);
        expect(sleeps).toEqual([1_000]);
        const manifest = JSON.parse(await readFile(
          join(
            outputRoot,
            "example__alpha__11",
            "capture.json",
          ),
          "utf8",
        )) as {
          requests: Array<{
            attempts: Array<{
              transportError?: {
                path: string;
                phase: string;
              };
            }>;
          }>;
        };
        expect(manifest.requests[0]!.attempts).toHaveLength(2);
        expect(
          manifest.requests[0]!.attempts[0]!.transportError,
        ).toMatchObject({ phase: scenario.phase });
        const transportErrorPath =
          manifest.requests[0]!.attempts[0]!.transportError!.path;
        expect(await readFile(
          join(
            outputRoot,
            "example__alpha__11",
            transportErrorPath,
          ),
          "utf8",
        )).not.toContain(TOKEN);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }

    const exhaustedRoot = await temporaryRoot();
    try {
      const fixture = await writePlan(exhaustedRoot);
      const sleeps: number[] = [];
      let calls = 0;
      await expect(
        captureC6LiveMultiLangNeighborDeep({
          authorizationToken: TOKEN,
          expectedDeepCaptureTargetProjectionSha256:
            fixture.deepTargetProjectionSha256,
          expectedPlanSha256: fixture.planSha256,
          expectedQueryHashes: fixture.queryHashes,
          expectedTargetCount: 1,
          fetchImpl: async () => {
            calls += 1;
            throw new Error(`still rejected ${TOKEN}`);
          },
          outputRoot: join(exhaustedRoot, "capture"),
          planPath: fixture.planPath,
          progress: () => {},
          sleep: async (milliseconds) => {
            sleeps.push(milliseconds);
          },
        }),
      ).rejects.toThrow("fetch failed after 4 attempts");
      expect(calls).toBe(4);
      expect(sleeps).toEqual([1_000, 2_000, 4_000]);
    } finally {
      await rm(exhaustedRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("retries only rate-limited 403 and explicit transient GraphQL errors", async () => {
    const rateLimitedRoot = await temporaryRoot();
    try {
      const fixture = await writePlan(rateLimitedRoot);
      const queue = [
        reply("initial", { message: "retry after" }, 403, {
          "retry-after": "0",
        }),
        reply("initial", { message: "rate limited" }, 403, {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "9999999999",
        }),
        reply("initial", initialBody()),
      ];
      const sleeps: number[] = [];
      await captureC6LiveMultiLangNeighborDeep({
        authorizationToken: TOKEN,
        expectedDeepCaptureTargetProjectionSha256:
          fixture.deepTargetProjectionSha256,
        expectedPlanSha256: fixture.planSha256,
        expectedQueryHashes: fixture.queryHashes,
        expectedTargetCount: 1,
        fetchImpl: fakeFetch(queue),
        outputRoot: join(rateLimitedRoot, "capture"),
        planPath: fixture.planPath,
        progress: () => {},
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      });
      expect(queue).toHaveLength(0);
      expect(sleeps).toEqual([0, 60_000]);
    } finally {
      await rm(rateLimitedRoot, {
        force: true,
        recursive: true,
      });
    }

    const forbiddenRoot = await temporaryRoot();
    try {
      const fixture = await writePlan(forbiddenRoot);
      let calls = 0;
      await expect(
        captureC6LiveMultiLangNeighborDeep({
          authorizationToken: TOKEN,
          expectedDeepCaptureTargetProjectionSha256:
            fixture.deepTargetProjectionSha256,
          expectedPlanSha256: fixture.planSha256,
          expectedQueryHashes: fixture.queryHashes,
          expectedTargetCount: 1,
          fetchImpl: async () => {
            calls += 1;
            return response({ message: "forbidden" }, 403);
          },
          outputRoot: join(forbiddenRoot, "capture"),
          planPath: fixture.planPath,
          progress: () => {},
          sleep: async () => {
            throw new Error("ordinary 403 must not sleep");
          },
        }),
      ).rejects.toThrow("HTTP 403");
      expect(calls).toBe(1);
    } finally {
      await rm(forbiddenRoot, {
        force: true,
        recursive: true,
      });
    }

    const transientRoot = await temporaryRoot();
    try {
      const fixture = await writePlan(transientRoot);
      const queue = [
        reply("initial", {
          data: null,
          errors: [{
            message: "temporary backend failure",
            type: "INTERNAL",
          }],
        }),
        reply("initial", initialBody()),
      ];
      const sleeps: number[] = [];
      await captureC6LiveMultiLangNeighborDeep({
        authorizationToken: TOKEN,
        expectedDeepCaptureTargetProjectionSha256:
          fixture.deepTargetProjectionSha256,
        expectedPlanSha256: fixture.planSha256,
        expectedQueryHashes: fixture.queryHashes,
        expectedTargetCount: 1,
        fetchImpl: fakeFetch(queue),
        outputRoot: join(transientRoot, "capture"),
        planPath: fixture.planPath,
        progress: () => {},
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      });
      expect(queue).toHaveLength(0);
      expect(sleeps).toEqual([1_000]);
    } finally {
      await rm(transientRoot, {
        force: true,
        recursive: true,
      });
    }

    const permanentRoot = await temporaryRoot();
    try {
      const fixture = await writePlan(permanentRoot);
      let calls = 0;
      await expect(
        captureC6LiveMultiLangNeighborDeep({
          authorizationToken: TOKEN,
          expectedDeepCaptureTargetProjectionSha256:
            fixture.deepTargetProjectionSha256,
          expectedPlanSha256: fixture.planSha256,
          expectedQueryHashes: fixture.queryHashes,
          expectedTargetCount: 1,
          fetchImpl: async () => {
            calls += 1;
            return response({
              data: null,
              errors: [{
                message: "permission denied",
                type: "FORBIDDEN",
              }],
            }, 200);
          },
          outputRoot: join(permanentRoot, "capture"),
          planPath: fixture.planPath,
          progress: () => {},
          sleep: async () => {
            throw new Error(
              "permanent GraphQL error must not sleep",
            );
          },
        }),
      ).rejects.toThrow("GraphQL errors returned");
      expect(calls).toBe(1);
    } finally {
      await rm(permanentRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("captures null review submittedAt without normalization", async () => {
    const root = await temporaryRoot();
    try {
      const fixture = await writePlan(root);
      const outputRoot = join(root, "capture");
      await captureC6LiveMultiLangNeighborDeep({
        authorizationToken: TOKEN,
        expectedDeepCaptureTargetProjectionSha256:
          fixture.deepTargetProjectionSha256,
        expectedPlanSha256: fixture.planSha256,
        expectedQueryHashes: fixture.queryHashes,
        expectedTargetCount: 1,
        fetchImpl: fakeFetch([
          reply("initial", initialBody({
            reviews: connection(
              1,
              [review("review-null", null)],
              "reviews-final",
              false,
            ),
          })),
        ]),
        outputRoot,
        planPath: fixture.planPath,
        progress: () => {},
        sleep: async () => {},
      });
      const raw = JSON.parse(await readFile(
        join(
          outputRoot,
          "example__alpha__11",
          "requests",
          "0001__initial__page-001",
          "attempt-01",
          "response.json",
        ),
        "utf8",
      )) as {
        data: {
          repository: {
            pullRequest: {
              reviews: {
                nodes: Array<{ submittedAt: string | null }>;
              };
            };
          };
        };
      };
      expect(
        raw.data.repository.pullRequest.reviews.nodes[0]!
          .submittedAt,
      ).toBeNull();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects plan drift, query-binding drift, symlinks, and existing output", async () => {
    const root = await temporaryRoot();
    try {
      const fixture = await writePlan(root);
      const outputRoot = join(root, "capture");
      await expect(
        captureC6LiveMultiLangNeighborDeep({
          authorizationToken: TOKEN,
          expectedDeepCaptureTargetProjectionSha256:
            fixture.deepTargetProjectionSha256,
          expectedPlanSha256: fixture.planSha256,
          expectedQueryHashes: fixture.queryHashes,
          expectedTargetCount: 1,
          fetchImpl: fakeFetch([reply("initial", initialBody())]),
          outputRoot,
          planPath: fixture.planPath,
          progress: () => {},
          sleep: async () => {},
          testHooks: {
            beforeTerminalVerification: async () => {
              await writeFile(fixture.planPath, "{}\n");
            },
          },
        }),
      ).rejects.toThrow("plan changed during capture");
      expect(await exists(outputRoot)).toBe(false);

      const secondFixture = await writePlan(
        join(root, "query-drift"),
      );
      const badHashes = {
        ...secondFixture.queryHashes,
        reviews: "0".repeat(64),
      };
      await expect(
        captureC6LiveMultiLangNeighborDeep({
          authorizationToken: TOKEN,
          expectedDeepCaptureTargetProjectionSha256:
            secondFixture.deepTargetProjectionSha256,
          expectedPlanSha256: secondFixture.planSha256,
          expectedQueryHashes: badHashes,
          expectedTargetCount: 1,
          fetchImpl: fakeFetch([]),
          outputRoot: join(root, "query-drift-output"),
          planPath: secondFixture.planPath,
          progress: () => {},
          sleep: async () => {},
        }),
      ).rejects.toThrow("query hash mismatch");

      const linkPath = join(root, "plan-link.json");
      await symlink(secondFixture.planPath, linkPath);
      await expect(
        captureC6LiveMultiLangNeighborDeep({
          authorizationToken: TOKEN,
          expectedDeepCaptureTargetProjectionSha256:
            secondFixture.deepTargetProjectionSha256,
          expectedPlanSha256: secondFixture.planSha256,
          expectedQueryHashes: secondFixture.queryHashes,
          expectedTargetCount: 1,
          fetchImpl: fakeFetch([]),
          outputRoot: join(root, "link-output"),
          planPath: linkPath,
          progress: () => {},
          sleep: async () => {},
        }),
      ).rejects.toThrow("rejects symlink path component");

      const existingOutput = join(root, "existing-output");
      await mkdir(existingOutput);
      await expect(
        captureC6LiveMultiLangNeighborDeep({
          authorizationToken: TOKEN,
          expectedDeepCaptureTargetProjectionSha256:
            secondFixture.deepTargetProjectionSha256,
          expectedPlanSha256: secondFixture.planSha256,
          expectedQueryHashes: secondFixture.queryHashes,
          expectedTargetCount: 1,
          fetchImpl: fakeFetch([]),
          outputRoot: existingOutput,
          planPath: secondFixture.planPath,
          progress: () => {},
          sleep: async () => {},
        }),
      ).rejects.toThrow("output root already exists");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects files and directories outside the manifest-derived exact tree", async () => {
    const cases: Array<{
      expected: string;
      inject: (root: string) => Promise<void>;
      stage: "prepublication" | "published";
    }> = [{
      expected: "unexpected file asset-lock.json",
      inject: async (root) => {
        await writeFile(join(root, "asset-lock.json"), "{}\n");
      },
      stage: "prepublication",
    }, {
      expected: "unexpected directory empty",
      inject: async (root) => {
        await mkdir(join(root, "empty"));
      },
      stage: "prepublication",
    }, {
      expected: "unexpected file orphan.json",
      inject: async (root) => {
        await writeFile(join(root, "orphan.json"), "{}\n");
      },
      stage: "published",
    }, {
      expected: "published asset closure mismatch",
      inject: async (root) => {
        await chmod(join(root, "completion.json"), 0o644);
      },
      stage: "published",
    }];

    for (const testCase of cases) {
      const root = await temporaryRoot();
      try {
        const fixture = await writePlan(root);
        const outputRoot = join(root, "capture");
        await expect(
          captureC6LiveMultiLangNeighborDeep({
            authorizationToken: TOKEN,
            expectedDeepCaptureTargetProjectionSha256:
              fixture.deepTargetProjectionSha256,
            expectedPlanSha256: fixture.planSha256,
            expectedQueryHashes: fixture.queryHashes,
            expectedTargetCount: 1,
            fetchImpl: fakeFetch([
              reply("initial", initialBody()),
            ]),
            outputRoot,
            planPath: fixture.planPath,
            progress: () => {},
            sleep: async () => {},
            testHooks: testCase.stage === "prepublication"
              ? {
                beforePrepublicationVerification: testCase.inject,
              }
              : {
                beforePublishedVerification: testCase.inject,
              },
          }),
        ).rejects.toThrow(testCase.expected);
        expect(await exists(outputRoot)).toBe(false);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  });

  it("parses every CLI binding exactly once", () => {
    const hash = "a".repeat(64);
    const args = [
      "--plan=plan.json",
      "--output-root=/capture/root",
      "--token-env=GITHUB_TOKEN",
      "--expected-target-count=1",
      `--expected-plan-sha256=${hash}`,
      `--expected-deep-target-projection-sha256=${hash}`,
      `--expected-initial-query-sha256=${hash}`,
      `--expected-commits-query-sha256=${hash}`,
      `--expected-reviews-query-sha256=${hash}`,
      `--expected-review-threads-query-sha256=${hash}`,
      `--expected-review-thread-comments-query-sha256=${hash}`,
      `--expected-commit-parents-query-sha256=${hash}`,
    ];
    expect(
      parseC6LiveMultiLangNeighborDeepCaptureCliOptions(args),
    ).toEqual({
      expectedDeepCaptureTargetProjectionSha256: hash,
      expectedPlanSha256: hash,
      expectedQueryHashes: {
        commitParents: hash,
        commits: hash,
        initial: hash,
        reviewThreadComments: hash,
        reviewThreads: hash,
        reviews: hash,
      },
      expectedTargetCount: 1,
      outputRoot: "/capture/root",
      plan: "plan.json",
      tokenEnv: "GITHUB_TOKEN",
    });
    expect(() =>
      parseC6LiveMultiLangNeighborDeepCaptureCliOptions([
        ...args,
        `--expected-plan-sha256=${hash}`,
      ])
    ).toThrow("--expected-plan-sha256 cannot be specified more than once");
  });
});

interface FakeReply {
  body: unknown;
  family: keyof C6LiveMultiLangNeighborDeepQueryHashes;
  headers?: Record<string, string>;
  status: number;
}

function reply(
  family: FakeReply["family"],
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): FakeReply {
  return { body, family, headers, status };
}

function fakeFetch(queue: FakeReply[]): C6LiveMultiLangNeighborDeepFetch {
  return async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as {
      query: string;
    };
    const family = queryFamily(request.query);
    const next = queue.shift();
    expect(next?.family).toBe(family);
    return response(next!.body, next!.status, next!.headers);
  };
}

function queryFamily(
  query: string,
): keyof C6LiveMultiLangNeighborDeepQueryHashes {
  const families = new Map<string, keyof C6LiveMultiLangNeighborDeepQueryHashes>([
    [C6_LIVE_MULTILANG_NEIGHBOR_DEEP_INITIAL_QUERY, "initial"],
    [C6_LIVE_MULTILANG_NEIGHBOR_COMMITS_PAGE_QUERY, "commits"],
    [C6_LIVE_MULTILANG_NEIGHBOR_REVIEWS_PAGE_QUERY, "reviews"],
    [
      C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREADS_PAGE_QUERY,
      "reviewThreads",
    ],
    [
      C6_LIVE_MULTILANG_NEIGHBOR_REVIEW_THREAD_COMMENTS_PAGE_QUERY,
      "reviewThreadComments",
    ],
    [
      C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_PARENTS_PAGE_QUERY,
      "commitParents",
    ],
  ]);
  const family = families.get(query);
  if (family === undefined) {
    throw new Error("unexpected query");
  }
  return family;
}

function response(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: "Sun, 26 Jul 2026 12:00:00 GMT",
      "x-github-request-id": `request-${status}`,
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4900",
      "x-ratelimit-reset": "1785074400",
      "x-ratelimit-resource": "graphql",
      "x-ratelimit-used": "100",
      ...extraHeaders,
    },
    status,
  });
}

function initialBody(input: {
  commits?: ReturnType<typeof connection>;
  reviews?: ReturnType<typeof connection>;
  reviewThreads?: ReturnType<typeof connection>;
} = {}) {
  return {
    data: {
      rateLimit: rateLimit(),
      repository: {
        id: "repository-id",
        nameWithOwner: "example/alpha",
        pullRequest: {
          author: { login: "alice" },
          baseRefOid: BASE_OID,
          baseRepository: {
            id: "repository-id",
            nameWithOwner: "example/alpha",
          },
          commits: input.commits ?? connection(
            1,
            [commitNode("commit-1", COMMIT_ONE, [PARENT_ONE])],
            "commits-final",
            false,
          ),
          createdAt: "2026-07-01T00:00:00Z",
          id: "pull-id",
          mergeCommit: { oid: MERGE_OID },
          mergedAt: "2026-07-02T00:00:00Z",
          number: 11,
          reviewThreads: input.reviewThreads ??
            connection(0, [], null, false),
          reviews: input.reviews ??
            connection(1, [review("review-1")], "reviews-final", false),
          url: "https://github.com/example/alpha/pull/11",
        },
      },
    },
  };
}

function repositoryPageBody(
  field: "commits" | "reviews" | "reviewThreads",
  value: ReturnType<typeof connection>,
) {
  return {
    data: {
      rateLimit: rateLimit(),
      repository: {
        id: "repository-id",
        nameWithOwner: "example/alpha",
        pullRequest: {
          [field]: value,
          id: "pull-id",
          number: 11,
          url: "https://github.com/example/alpha/pull/11",
        },
      },
    },
  };
}

function nodeBody(node: Record<string, unknown>) {
  return {
    data: {
      node,
      rateLimit: rateLimit(),
      repository: {
        id: "repository-id",
        nameWithOwner: "example/alpha",
        pullRequest: {
          id: "pull-id",
          number: 11,
          url: "https://github.com/example/alpha/pull/11",
        },
      },
    },
  };
}

function rateLimit() {
  return {
    cost: 2,
    remaining: 4900,
    resetAt: "2026-07-26T13:00:00Z",
  };
}

function connection(
  totalCount: number,
  nodes: unknown[],
  endCursor: string | null,
  hasNextPage: boolean,
) {
  return {
    nodes,
    pageInfo: { endCursor, hasNextPage },
    totalCount,
  };
}

function commitNode(
  id: string,
  oid: string,
  parents: string[],
  page: {
    endCursor: string | null;
    hasNextPage: boolean;
    totalCount: number;
  } = {
    endCursor: parents.length === 0 ? null : "parents-final",
    hasNextPage: false,
    totalCount: parents.length,
  },
) {
  return {
    commit: {
      committedDate: "2026-07-01T01:00:00Z",
      id,
      oid,
      parents: connection(
        page.totalCount,
        parents.map((parent) => ({ oid: parent })),
        page.endCursor,
        page.hasNextPage,
      ),
    },
  };
}

function review(
  id: string,
  submittedAt: string | null = "2026-07-01T02:00:00Z",
) {
  return {
    author: { login: `reviewer-${id}` },
    body: `structural feedback for ${id}`,
    commit: { oid: COMMIT_ONE },
    id,
    state: "CHANGES_REQUESTED",
    submittedAt,
  };
}

function thread(
  id: string,
  comments: ReturnType<typeof connection>,
) {
  return { comments, id };
}

function comment(id: string) {
  return {
    author: { login: `reviewer-${id}` },
    body: `thread feedback for ${id}`,
    createdAt: "2026-07-01T03:00:00Z",
    id,
    originalCommit: { oid: COMMIT_ONE },
  };
}

async function writePlan(
  root: string,
  counts: {
    reviewCount?: number;
    reviewThreadCount?: number;
  } = {},
) {
  await mkdir(root, { recursive: true });
  const qualification = qualificationFixture({
    reviewCount: counts.reviewCount ?? 1,
    reviewThreadCount: counts.reviewThreadCount ?? 0,
  });
  const qualificationBytes = bytes(qualification);
  const plan = deriveC6LiveMultiLangNeighborDeepCapturePlan({
    expectedTargetCount: 1,
    qualificationBytes,
    qualificationPath: "/frozen/qualification.json",
  });
  const planBytes = bytes(plan);
  const planPath = join(root, "plan.json");
  await writeFile(planPath, planBytes);
  return {
    deepTargetProjectionSha256:
      plan.inputs.qualification.deepCaptureTargetProjectionSha256,
    plan,
    planBytes,
    planPath,
    planSha256: sha256(planBytes),
    queryHashes: {
      commitParents:
        plan.queryContract.supplements.commitParents.sha256,
      commits: plan.queryContract.supplements.commits.sha256,
      initial: plan.queryContract.initial.sha256,
      reviewThreadComments:
        plan.queryContract.supplements.reviewThreadComments.sha256,
      reviewThreads:
        plan.queryContract.supplements.reviewThreads.sha256,
      reviews: plan.queryContract.supplements.reviews.sha256,
    },
  };
}

function qualificationFixture(input: {
  reviewCount: number;
  reviewThreadCount: number;
}) {
  const result = {
    authorLogin: "alice",
    baseRefOid: BASE_OID,
    canonicalAnchorId: "example/alpha#11",
    canonicalRepository: "example/alpha",
    commentCount: 0,
    createdAt: "2026-07-01T00:00:00Z",
    deepCaptureOrder: 1,
    mergeCommitOid: MERGE_OID,
    mergedAt: "2026-07-02T00:00:00Z",
    observationRefs: [{
      captureDirectory: "001__example__alpha",
      pilotRank: 1,
      responseNodeRank: 1,
      sourceSplit: "c",
    }],
    pilotRank: 1,
    responseNodeRank: 1,
    reviewCount: input.reviewCount,
    reviewThreadCount: input.reviewThreadCount,
    sourceSplit: "c",
    status:
      "novel-review-surface-deep-capture-target" as const,
    url: "https://github.com/example/alpha/pull/11",
  };
  const projection = [{
    canonicalAnchorId: result.canonicalAnchorId,
    canonicalRepository: result.canonicalRepository,
    deepCaptureOrder: result.deepCaptureOrder,
    pilotRank: result.pilotRank,
    responseNodeRank: result.responseNodeRank,
    sourceSplit: result.sourceSplit,
  }];
  const emptyBreakdown = {
    deepCaptureTargetCount: 0,
    existingAnchorOverlapCount: 0,
    novelCanonicalPullCount: 0,
    rawObservationCount: 0,
    uniqueCanonicalPullCount: 0,
  };
  return {
    artifactKind:
      "c6-live-multilang-neighbor-census-qualification",
    boundary: {
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      actorQualifiedEpisodeCount: 0,
      candidateManifestFrozen: false,
      canonicalPullDeduplicationComplete: true,
      codexRunReady: false,
      deepCaptureExecuted: false,
      existingAnchorExclusionComplete: true,
      machineQualifiedEpisodeCount: 0,
      populationRepresentativenessProven: false,
      semanticallyQualifiedEpisodeCount: 0,
      status:
        "novel-review-surface-pretargets-deep-capture-required",
    },
    counts: {
      capturedRepositoryCount: 1,
      deepCaptureTargetCount: 1,
      duplicateObservationCount: 0,
      existingAnchorOverlapCount: 0,
      novelCanonicalPullCount: 1,
      novelWithReviewSurfaceCount: 1,
      novelWithoutReviewSurfaceCount: 0,
      rawObservationCount: 1,
      sourceCanonicalAnchorCount: 743,
      truncatedRepositoryCount: 0,
      uniqueCanonicalPullCount: 1,
    },
    independenceBoundary: {
      canonicalPullProjectionSha256: "1".repeat(64),
      deepCaptureTargetProjectionSha256:
        sha256(JSON.stringify(projection)),
      excludedAnchorProjectionSha256: "2".repeat(64),
      existingAnchorProjectionSha256: "3".repeat(64),
      goldInput: false,
      machineOutcomeInput: false,
      metadataQuerySha256: "4".repeat(64),
      patchInput: false,
      postMergeStructuralMetadataInput: true,
      qualificationPolicySha256: "5".repeat(64),
      semanticDecisionInput: false,
      testInput: false,
    },
    inputs: {
      actorFrame: {
        bytes: 1,
        path: "actor-frame.json",
        sha256: "6".repeat(64),
      },
      actorFrameCandidateProjectionSha256: "7".repeat(64),
      neighborCompletion: {
        bytes: 1,
        path: "completion.json",
        sha256: "8".repeat(64),
      },
      neighborPlan: {
        bytes: 1,
        path: "neighbor-plan.json",
        sha256: "9".repeat(64),
      },
      neighborRootSha256: "a".repeat(64),
      sourceCapturePlan: {
        bytes: 1,
        path: "source-plan.json",
        sha256: "b".repeat(64),
      },
      sourceGraphqlRootSha256: "c".repeat(64),
      sourcePool: {
        bytes: 1,
        path: "source-pool.json",
        sha256: "d".repeat(64),
      },
    },
    repositoryCounts: [{
      canonicalRepository: "example/alpha",
      deepCaptureTargetCount: 1,
      existingAnchorOverlapCount: 0,
      novelCanonicalPullCount: 1,
      rawObservationCount: 1,
      uniqueCanonicalPullCount: 1,
    }],
    results: [result],
    rule: {
      canonicalIdentity:
        "lowercase-resolved-repository-plus-pull-number",
      classification:
        "reviewCount-positive-or-reviewThreadCount-positive",
      deduplication:
        "canonicalize-then-group-before-existing-anchor-exclusion",
      existingAnchorExclusion:
        "exclude-all-743-reconstructed-canonical-source-anchors",
      forbiddenSelectionInputs: [
        "body",
        "diff",
        "files",
        "gold",
        "machineDecision",
        "outcome",
        "patch",
        "semanticDecision",
        "test",
      ],
      noRepositoryCapOrResampling: true,
      resultOrder: "pilotRank-then-responseNodeRank",
      schemaVersion: 1,
    },
    sampleBoundary: {
      adaptiveRepositoryExclusion: true,
      mergedPullRequestsOnly: true,
      newestPerRepositoryCap: 16,
      postMergeStructuralMetadataInput: true,
      repositorySampleRandom: false,
      reviewSurfaceEnrichmentApplied: true,
    },
    schemaVersion: 2,
    sourceDataset: {
      datasetId: "SWE-bench-Live/MultiLang",
      revision: "608f7ae9ab8ea1f9f0d030fe04562cf6bd1a0c8b",
    },
    splitCounts: {
      c: {
        deepCaptureTargetCount: 1,
        existingAnchorOverlapCount: 0,
        novelCanonicalPullCount: 1,
        rawObservationCount: 1,
        uniqueCanonicalPullCount: 1,
      },
      cpp: emptyBreakdown,
      go: emptyBreakdown,
      js: emptyBreakdown,
      rust: emptyBreakdown,
      java: emptyBreakdown,
      ts: emptyBreakdown,
      cs: emptyBreakdown,
    },
  };
}

async function temporaryRoot(): Promise<string> {
  return realpath(
    await mkdtemp(join(tmpdir(), "goodmemory-c6-neighbor-deep-")),
  );
}

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EISDIR"
    ) {
      return true;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
