import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  rebaseC6SourceV3SimplePassLogicalRequestCompletion,
  runC6SourceV3SimpleCensusPass,
  verifyC6SourceV3SimpleActivePassFilesystemClosure,
  verifyC6SourceV3SimplePassFilesystemClosure,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-pass-runner";
import {
  C6SourceV3SimpleTerminalAttemptError,
  executeC6SourceV3SimpleLogicalRequest,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-executor";
import {
  computeC6SourceV3SimpleLogicalRequestIdentitySha256,
  prepareC6SourceV3SimpleAttempt,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-ledger";
import {
  buildC6SourceV3SimpleDurableGraphqlRequest,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-transport";

describe("C6 source-v3-simple census pass runner", () => {
  it("rebases a durable logical-request completion to the asset root", () => {
    expect(
      rebaseC6SourceV3SimplePassLogicalRequestCompletion(
        "B",
        {
          bytes: 123,
          path:
            "logical-request-complete-00000042.json",
          sha256: "a".repeat(64),
        },
      ),
    ).toEqual({
      bytes: 123,
      path:
        "pass-b/logical-request-complete-00000042.json",
      sha256: "a".repeat(64),
    });
    expect(() =>
      rebaseC6SourceV3SimplePassLogicalRequestCompletion(
        "A",
        {
          bytes: 1,
          path: "../outside.json",
          sha256: "b".repeat(64),
        },
      )
    ).toThrow("path mismatch");
  });

  it("rejects files and attempt directories outside the semantic pass closure", async () => {
    await withRoot(async (root) => {
      const logicalRoot = join(
        root,
        "logical-request-00000001",
      );
      await mkdir(
        join(logicalRoot, "attempt-01"),
        { recursive: true },
      );
      await writeFile(
        join(
          root,
          "logical-request-complete-00000001.json",
        ),
        `${JSON.stringify({
          attempts: [{}],
        }, null, 2)}\n`,
      );
      await writeFile(
        join(
          root,
          "logical-request-result-00000001.json",
        ),
        "{}\n",
      );

      await expect(
        verifyC6SourceV3SimplePassFilesystemClosure({
          completionCount: 1,
          passRoot: root,
        }),
      ).resolves.toBeUndefined();

      await writeFile(
        join(root, "unbound-response.raw"),
        "orphan",
      );
      await expect(
        verifyC6SourceV3SimplePassFilesystemClosure({
          completionCount: 1,
          passRoot: root,
        }),
      ).rejects.toThrow("filesystem closure");
      await rm(join(root, "unbound-response.raw"));

      await mkdir(join(logicalRoot, "attempt-02"));
      await expect(
        verifyC6SourceV3SimplePassFilesystemClosure({
          completionCount: 1,
          passRoot: root,
        }),
      ).rejects.toThrow("attempt directory closure");
    });
  });

  it("treats an existing corrupt pass-complete marker as terminal without dispatch", async () => {
    await withRoot(async (root) => {
      const passRoot = join(root, "pass-a");
      await mkdir(passRoot, {
        recursive: true,
      });
      await writeFile(
        join(passRoot, "pass-complete.json"),
        "{}\n",
      );
      let fetchCount = 0;
      let completionCount = 0;
      let tokenProviderCount = 0;

      await expect(
        runC6SourceV3SimpleCensusPass({
          assetRoot: root,
          authorizationTokenProvider: async () => {
            tokenProviderCount += 1;
            return Buffer.from("github-token");
          },
          evaluationId: "evaluation",
          executionContractSha256:
            "a".repeat(64),
          frozenInputClosureSha256:
            "b".repeat(64),
          fetchImpl: async () => {
            fetchCount += 1;
            throw new Error("must not dispatch");
          },
          frame: {
            frozenPreWave3AnchorExclusions: [],
            frozenPreWave3RepositoryExclusions: [],
            priorRepositoryAliases: [],
            priorRepositoryNodeIds: [],
            rootShards: [{
              createdFrom:
                "2017-12-01T00:00:00Z",
              createdTo:
                "2017-12-01T23:59:59Z",
              language: "C",
              query:
                "language:C created:2017-12-01T00:00:00Z.." +
                "2017-12-01T23:59:59Z pushed:>=2024-01-01 " +
                "is:public archived:false mirror:false template:false",
              rootShardId: "c:2017-12-01",
              split: "c",
            }],
          },
          genesisSha256: "0".repeat(64),
          onLogicalRequestComplete: () => {
            completionCount += 1;
          },
          pass: "A",
          runtimeAuthorizationSha256:
            "c".repeat(64),
          waitUntil: async () => undefined,
        }),
      ).rejects.toThrow();
      expect(fetchCount).toBe(0);
      expect(completionCount).toBe(0);
      expect(tokenProviderCount).toBe(0);
    });
  });

  it("rejects non-contiguous active logical requests before credentials or dispatch", async () => {
    const cases = [
      {
        completions: [],
        directories: [2],
        name: "jumped first directory",
        results: [],
      },
      {
        completions: [],
        directories: [1, 2],
        name: "two in-progress directories",
        results: [],
      },
      {
        completions: [1],
        directories: [1],
        name: "completion without result",
        results: [],
      },
      {
        completions: [],
        directories: [1],
        name: "future result after in-progress request",
        results: [1, 2],
      },
      {
        completions: [1],
        directories: [1, 3],
        name: "future directory after completion",
        results: [1],
      },
    ];
    for (const testCase of cases) {
      await withRoot(async (root) => {
        const passRoot = join(root, "pass-a");
        await writeLogicalRequestEntries(
          passRoot,
          testCase,
        );
        let fetchCount = 0;
        let tokenProviderCount = 0;

        await expect(
          runC6SourceV3SimpleCensusPass({
            ...passInput(root),
            authorizationTokenProvider: async () => {
              tokenProviderCount += 1;
              return Buffer.from("github-token");
            },
            fetchImpl: async () => {
              fetchCount += 1;
              throw new Error("must not dispatch");
            },
          }),
        ).rejects.toThrow(
          "active pass filesystem closure",
        );
        expect(
          tokenProviderCount,
          testCase.name,
        ).toBe(0);
        expect(fetchCount, testCase.name).toBe(0);
      });
    }
  });

  it("allows contiguous completions and one empty in-progress request", async () => {
    await withRoot(async (root) => {
      const passRoot = join(root, "pass-a");
      await writeLogicalRequestEntries(passRoot, {
        completions: [1, 2],
        directories: [1, 2, 3],
        results: [1, 2],
      });

      await expect(
        verifyC6SourceV3SimpleActivePassFilesystemClosure({
          passRoot,
        }),
      ).resolves.toEqual({
        hasStaticPassArtifacts: false,
        mustCompleteLocally: false,
      });

      await mkdir(
        join(
          passRoot,
          "logical-request-00000003",
          "attempt-02",
        ),
      );
      await expect(
        verifyC6SourceV3SimpleActivePassFilesystemClosure({
          passRoot,
        }),
      ).rejects.toThrow(
        "active pass attempt directory closure",
      );
    });
  });

  it("replays a result-first completion crash entirely from the committed ledger", async () => {
    await withRoot(async (root) => {
      const { passRoot, request } =
        await seedResultBeforeCompletionCrash(root);
      let fetchCount = 0;
      let tokenProviderCount = 0;

      await expect(
        verifyC6SourceV3SimpleActivePassFilesystemClosure({
          passRoot,
        }),
      ).resolves.toEqual({
        hasStaticPassArtifacts: false,
        mustCompleteLocally: true,
      });
      await expect(
        executeC6SourceV3SimpleLogicalRequest({
          ...logicalRequestInput(root, request),
          authorizationTokenProvider: async () => {
            tokenProviderCount += 1;
            return Buffer.from("github-token");
          },
          fetchImpl: async () => {
            fetchCount += 1;
            throw new Error("must not dispatch");
          },
          localOnly: true,
        }),
      ).resolves.toBeDefined();

      expect(tokenProviderCount).toBe(0);
      expect(fetchCount).toBe(0);
      expect(
        JSON.parse(
          await readFile(
            join(
              passRoot,
              "logical-request-complete-00000001.json",
            ),
            "utf8",
          ),
        ),
      ).toMatchObject({
        artifactKind:
          "c6-source-v3-simple-logical-request-complete",
        logicalRequestOrdinal: 1,
      });
    });
  });

  it("unlocks the real provider only after a result-first completion is replayed locally", async () => {
    await withRoot(async (root) => {
      const baseInput = passInput(root);
      const input = {
        ...baseInput,
        frame: {
          ...baseInput.frame,
          priorRepositoryNodeIds: ["R_repo_1"],
        },
      };
      const { passRoot } =
        await seedResultBeforeCompletionCrash(root, {
          count: 1,
          query: input.frame.rootShards[0]!.query,
        });
      const requestOneRoot = join(
        passRoot,
        "logical-request-00000001",
      );
      const requestOneBefore =
        await snapshotTree(requestOneRoot);
      let fetchCount = 0;
      let tokenProviderCount = 0;
      const operations: string[] = [];

      const failure =
        await runC6SourceV3SimpleCensusPass({
          ...input,
          authorizationTokenProvider: async () => {
            tokenProviderCount += 1;
            return Buffer.from("github-token");
          },
          fetchImpl: async (_url, init) => {
            fetchCount += 1;
            const body = JSON.parse(
              Buffer.from(
                init?.body as ArrayBuffer,
              ).toString("utf8"),
            ) as {
              operationName: string;
            };
            operations.push(body.operationName);
            return new Response(
              repositoryPageBody(),
              {
                headers: SUCCESS_HEADERS,
                status: 200,
              },
            );
          },
          now: () =>
            Date.parse(
              "2026-07-26T12:00:01.000Z",
            ),
        }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(
        "1,536 root shards",
      );
      expect(tokenProviderCount).toBe(1);
      expect(fetchCount).toBe(1);
      expect(operations).toEqual([
        "C6SourceV3SimpleRepositoryPage",
      ]);
      expect(
        await snapshotTree(requestOneRoot),
      ).toEqual(requestOneBefore);
      expect(
        JSON.parse(
          await readFile(
            join(
              passRoot,
              "logical-request-complete-00000001.json",
            ),
            "utf8",
          ),
        ),
      ).toMatchObject({
        logicalRequestOrdinal: 1,
      });
    });
  });

  it("rejects a corrupt result-first crash locally without credentials or dispatch", async () => {
    await withRoot(async (root) => {
      const { passRoot, request } =
        await seedResultBeforeCompletionCrash(root);
      await writeFile(
        join(
          passRoot,
          "logical-request-result-00000001.json",
        ),
        "{}\n",
      );
      let fetchCount = 0;
      let tokenProviderCount = 0;

      await expect(
        verifyC6SourceV3SimpleActivePassFilesystemClosure({
          passRoot,
        }),
      ).resolves.toEqual({
        hasStaticPassArtifacts: false,
        mustCompleteLocally: true,
      });
      await expect(
        executeC6SourceV3SimpleLogicalRequest({
          ...logicalRequestInput(root, request),
          authorizationTokenProvider: async () => {
            tokenProviderCount += 1;
            return Buffer.from("github-token");
          },
          fetchImpl: async () => {
            fetchCount += 1;
            throw new Error("must not dispatch");
          },
          localOnly: true,
        }),
      ).rejects.toThrow(
        "existing projected result is not locally finalizable",
      );

      expect(tokenProviderCount).toBe(0);
      expect(fetchCount).toBe(0);
    });
  });

  it("keeps an orphan result with an incomplete attempt behind the local-only credential gate", async () => {
    await withRoot(async (root) => {
      const input = passInput(root);
      const passRoot = join(root, "pass-a");
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query:
              input.frame.rootShards[0]!.query,
          },
        });
      const context = {
        attemptNumber: 1,
        attemptRoot: join(
          passRoot,
          "logical-request-00000001",
          "attempt-01",
        ),
        evaluationId: input.evaluationId,
        executionContractSha256:
          input.executionContractSha256,
        frozenInputClosureSha256:
          input.frozenInputClosureSha256,
        logicalRequestIdentitySha256:
          computeC6SourceV3SimpleLogicalRequestIdentitySha256({
            evaluationId: input.evaluationId,
            executionContractSha256:
              input.executionContractSha256,
            frozenInputClosureSha256:
              input.frozenInputClosureSha256,
            logicalRequestOrdinal: 1,
            pass: input.pass,
            request,
            runtimeAuthorizationSha256:
              input.runtimeAuthorizationSha256,
          }),
        logicalRequestOrdinal: 1,
        pass: input.pass,
        priorAttemptCommitSha256: null,
        priorLogicalRequestCompletionSha256:
          input.genesisSha256,
        runtimeAuthorizationSha256:
          input.runtimeAuthorizationSha256,
      };
      await prepareC6SourceV3SimpleAttempt({
        context,
        request,
      });
      await writeFile(
        join(
          passRoot,
          "logical-request-result-00000001.json",
        ),
        "{}\n",
      );
      const before = (
        await readdir(passRoot, {
          recursive: true,
        })
      ).sort();
      let fetchCount = 0;
      let tokenProviderCount = 0;

      for (let resume = 1; resume <= 5; resume += 1) {
        await expect(
          runC6SourceV3SimpleCensusPass({
            ...input,
            authorizationTokenProvider: async () => {
              tokenProviderCount += 1;
              return Buffer.from("github-token");
            },
            fetchImpl: async () => {
              fetchCount += 1;
              throw new Error("must not dispatch");
            },
            now: () =>
              Date.parse(
                "2026-07-26T12:00:01.000Z",
              ),
          }),
        ).rejects.toThrow(
          "existing projected result is not locally finalizable",
        );

        expect(tokenProviderCount).toBe(0);
        expect(fetchCount).toBe(0);
        expect(
          (
            await readdir(passRoot, {
              recursive: true,
            })
          ).sort(),
        ).toEqual(before);
      }
    });
  });

  it("keeps a static network-continuation crash byte-for-byte stable across repeated resumes", async () => {
    await withRoot(async (root) => {
      const passRoot = join(root, "pass-a");
      await mkdir(passRoot);
      await writeFile(
        join(passRoot, "normalized-pass.json"),
        "{}\n",
      );
      const before = await snapshotTree(passRoot);
      let fetchCount = 0;
      let tokenProviderCount = 0;

      for (let resume = 1; resume <= 5; resume += 1) {
        const failure =
          await runC6SourceV3SimpleCensusPass({
            ...passInput(root),
            authorizationTokenProvider: async () => {
              tokenProviderCount += 1;
              return Buffer.from("github-token");
            },
            fetchImpl: async () => {
              fetchCount += 1;
              throw new Error("must not dispatch");
            },
          }).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain(
          "active pass requires local-only replay",
        );
        expect(failure).not.toBeInstanceOf(
          C6SourceV3SimpleTerminalAttemptError,
        );
        expect(tokenProviderCount).toBe(0);
        expect(fetchCount).toBe(0);
        expect(await snapshotTree(passRoot)).toEqual(
          before,
        );
      }
    });
  });

  it("does not promote a known pending artifact under the wrong owner", async () => {
    await withRoot(async (root) => {
      const passRoot = join(root, "pass-a");
      await mkdir(passRoot);
      const pendingPath = join(
        passRoot,
        ".terminal.json.pending",
      );
      await writeFile(pendingPath, "{}\n");
      let tokenProviderCount = 0;

      await expect(
        runC6SourceV3SimpleCensusPass({
          ...passInput(root),
          authorizationTokenProvider: async () => {
            tokenProviderCount += 1;
            return Buffer.from("github-token");
          },
        }),
      ).rejects.toThrow("unknown pending");
      expect(tokenProviderCount).toBe(0);
      expect(
        await readFile(
          join(passRoot, "terminal.json"),
        ).catch(() => null),
      ).toBeNull();
      expect(
        await readFile(pendingPath, "utf8"),
      ).toBe("{}\n");
    });
  });
});

function passInput(root: string) {
  return {
    assetRoot: root,
    evaluationId: "evaluation",
    executionContractSha256: "a".repeat(64),
    frame: {
      frozenPreWave3AnchorExclusions: [],
      frozenPreWave3RepositoryExclusions: [],
      priorRepositoryAliases: [],
      priorRepositoryNodeIds: [],
      rootShards: [{
        createdFrom: "2017-12-01T00:00:00Z",
        createdTo: "2017-12-01T23:59:59Z",
        language: "C",
        query:
          "language:C created:2017-12-01T00:00:00Z.." +
          "2017-12-01T23:59:59Z pushed:>=2024-01-01 " +
          "is:public archived:false mirror:false template:false",
        rootShardId: "c:2017-12-01",
        split: "c" as const,
      }],
    },
    frozenInputClosureSha256: "b".repeat(64),
    genesisSha256: "0".repeat(64),
    pass: "A" as const,
    runtimeAuthorizationSha256: "c".repeat(64),
    waitUntil: async () => undefined,
  };
}

async function writeLogicalRequestEntries(
  passRoot: string,
  input: {
    completions: readonly number[];
    directories: readonly number[];
    results: readonly number[];
  },
): Promise<void> {
  await mkdir(passRoot, {
    recursive: true,
  });
  for (const ordinal of input.directories) {
    await mkdir(
      join(
        passRoot,
        `logical-request-${formatOrdinal(ordinal)}`,
      ),
    );
  }
  for (const ordinal of input.completions) {
    await writeFile(
      join(
        passRoot,
        `logical-request-complete-${
          formatOrdinal(ordinal)
        }.json`,
      ),
      "{}\n",
    );
  }
  for (const ordinal of input.results) {
    await writeFile(
      join(
        passRoot,
        `logical-request-result-${
          formatOrdinal(ordinal)
        }.json`,
      ),
      "{}\n",
    );
  }
}

function formatOrdinal(ordinal: number): string {
  return String(ordinal).padStart(8, "0");
}

async function seedResultBeforeCompletionCrash(
  root: string,
  input: {
    count?: number;
    query?: string;
  } = {},
): Promise<{
  passRoot: string;
  request: ReturnType<
    typeof buildC6SourceV3SimpleDurableGraphqlRequest
  >;
}> {
  let fetchCount = 0;
  let tokenProviderCount = 0;
  const request =
    buildC6SourceV3SimpleDurableGraphqlRequest({
      operation: "repositoryCount",
      variables: {
        query: input.query ?? "language:C",
      },
    });
  await executeC6SourceV3SimpleLogicalRequest({
    ...logicalRequestInput(root, request),
    authorizationTokenProvider: async () => {
      tokenProviderCount += 1;
      return Buffer.from("github-token");
    },
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response(
        repositoryCountBody(input.count ?? 0),
        {
          headers: SUCCESS_HEADERS,
          status: 200,
        },
      );
    },
    now: () =>
      Date.parse("2026-07-26T12:00:01.000Z"),
  });
  expect(tokenProviderCount).toBe(1);
  expect(fetchCount).toBe(1);

  const passRoot = join(root, "pass-a");
  await rm(join(
    passRoot,
    "logical-request-complete-00000001.json",
  ));
  return {
    passRoot,
    request,
  };
}

function repositoryPageBody(): string {
  return JSON.stringify({
    data: {
      rateLimit: {
        cost: 1,
        limit: 5_000,
        remaining: 4_999,
        resetAt: RESET_AT,
        used: 1,
      },
      search: {
        nodes: [{
          __typename: "Repository",
          createdAt: "2017-12-01T12:00:00Z",
          id: "R_repo_1",
          isArchived: false,
          isFork: false,
          isMirror: false,
          isTemplate: false,
          nameWithOwner: "Example/Repository",
          primaryLanguage: {
            name: "C",
          },
          pushedAt: "2024-06-01T00:00:00Z",
          visibility: "PUBLIC",
        }],
        pageInfo: {
          endCursor: null,
          hasNextPage: false,
        },
        repositoryCount: 1,
      },
    },
  });
}

async function snapshotTree(root: string) {
  const paths = (
    await readdir(root, {
      recursive: true,
    })
  ).sort();
  const snapshot = [];
  for (const path of paths) {
    const absolutePath = join(root, path);
    const stats = await lstat(absolutePath);
    snapshot.push(
      stats.isDirectory()
        ? {
            kind: "directory",
            path,
          }
        : {
            bytes: (
              await readFile(absolutePath)
            ).toString("base64"),
            kind: "file",
            path,
          },
    );
  }
  return snapshot;
}

function logicalRequestInput(
  root: string,
  request: ReturnType<
    typeof buildC6SourceV3SimpleDurableGraphqlRequest
  >,
) {
  return {
    assetRoot: root,
    evaluationId: "evaluation",
    executionContractSha256: "a".repeat(64),
    frozenInputClosureSha256: "b".repeat(64),
    logicalRequestOrdinal: 1,
    now: () =>
      Date.parse("2026-07-26T12:00:01.000Z"),
    pass: "A" as const,
    passRoot: join(root, "pass-a"),
    priorLogicalRequestCompletionSha256:
      "0".repeat(64),
    request,
    runtimeAuthorizationSha256: "c".repeat(64),
    waitUntil: async () => undefined,
  };
}

const RESET_AT = "2026-07-26T13:00:00Z";
const SUCCESS_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  date: "Sun, 26 Jul 2026 12:00:00 GMT",
  "x-github-request-id": "ABC:123",
  "x-ratelimit-limit": "5000",
  "x-ratelimit-remaining": "4999",
  "x-ratelimit-reset": String(
    Date.parse(RESET_AT) / 1_000,
  ),
  "x-ratelimit-resource": "graphql",
  "x-ratelimit-used": "1",
};

function repositoryCountBody(count: number): string {
  return JSON.stringify({
    data: {
      rateLimit: {
        cost: 1,
        limit: 5_000,
        remaining: 4_999,
        resetAt: RESET_AT,
        used: 1,
      },
      search: {
        repositoryCount: count,
      },
    },
  });
}

async function withRoot(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(
    process.cwd(),
    ".goodmemory-c6-census-pass-runner-",
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
