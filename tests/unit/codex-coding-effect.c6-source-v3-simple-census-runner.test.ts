import { createHash } from "node:crypto";
import {
  link,
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
  C6SourceV3SimpleProactivePauseExceededError,
  C6SourceV3SimpleSecretLeakError,
  C6SourceV3SimpleTwoPassMismatchError,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-errors";
import {
  writeC6SourceV3SimpleCensusAssetLock,
  writeC6SourceV3SimpleFrozenInputClosure,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-finalization";
import {
  acquireC6SourceV3SimpleCensusWriterLock,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-lock";
import {
  writeC6SourceV3SimpleFailureEvidence,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-publication";
import {
  classifyC6SourceV3SimpleFailureCode,
  isC6SourceV3SimpleLedgerValidatedTerminalOutcome,
  runC6SourceV3SimpleAuthorizedCensus,
  runC6SourceV3SimpleFormalCensus,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-runner";
import {
  createC6SourceV3SimpleTestExpectedFrozenInputs,
} from "./codex-coding-effect.c6-source-v3-simple-census-test-support";

const LIVE_CONFIRMATION =
  "execute-goodmemory-c6-source-v3-simple-formal-census";
const FIXTURE_BYTES = Buffer.from("frozen");
const ACTIVATION_RECEIPT_BYTES =
  Buffer.from("frozen-activation-receipt");

describe("C6 source-v3-simple formal census runner", () => {
  it("allowlists only a typed verified proactive-pause terminal outcome", () => {
    const completion = {
      bytes: 123,
      path:
        "pass-a/logical-request-complete-00000001.json",
      sha256: "a".repeat(64),
    };
    const exceeded =
      new C6SourceV3SimpleProactivePauseExceededError(
        completion,
      );

    expect(
      isC6SourceV3SimpleLedgerValidatedTerminalOutcome(
        exceeded,
      ),
    ).toBe(true);
    expect(
      classifyC6SourceV3SimpleFailureCode(exceeded),
    ).toBe("rate-limit-pause-exceeded");
    expect(exceeded.chainTip).toEqual(completion);

    const generic = new Error(
      "C6 source-v3-simple proactive pause exceeds maximum",
    );
    expect(
      isC6SourceV3SimpleLedgerValidatedTerminalOutcome(
        generic,
      ),
    ).toBe(false);
    expect(
      classifyC6SourceV3SimpleFailureCode(generic),
    ).toBe("publication-failure");
  });

  it("allowlists and classifies only typed verified two-pass mismatch failures", () => {
    const passBComplete = {
      bytes: 123,
      path: "pass-b/pass-complete.json",
      sha256: "b".repeat(64),
    };
    const mismatch =
      new C6SourceV3SimpleTwoPassMismatchError(
        passBComplete,
      );

    expect(
      isC6SourceV3SimpleLedgerValidatedTerminalOutcome(
        mismatch,
      ),
    ).toBe(true);
    expect(
      classifyC6SourceV3SimpleFailureCode(mismatch),
    ).toBe("two-pass-mismatch");
    expect(mismatch.chainTip).toEqual(passBComplete);

    const unverified = new Error(
      "C6 source-v3-simple pass projection mismatch",
    );
    expect(
      isC6SourceV3SimpleLedgerValidatedTerminalOutcome(
        unverified,
      ),
    ).toBe(false);
    expect(
      classifyC6SourceV3SimpleFailureCode(unverified),
    ).toBe("publication-failure");
  });

  it("maps only the shared typed secret guard to secret-leak", () => {
    expect(
      classifyC6SourceV3SimpleFailureCode(
        new C6SourceV3SimpleSecretLeakError(),
      ),
    ).toBe("secret-leak");
    expect(
      classifyC6SourceV3SimpleFailureCode(
        new Error(
          "C6 source-v3-simple secret leak detected",
        ),
      ),
    ).toBe("publication-failure");
  });

  it("finalizes typed body and header secret guards without persisting the leaked values", async () => {
    for (const kind of ["body", "header"] as const) {
      await withAuthorizedCensusRoot(
        async ({
          assetRoot,
          expected,
          repositoryRoot,
        }) => {
          const authorizationToken =
            Buffer.from(`github-token-${kind}`);
          const tokenText =
            authorizationToken.toString("utf8");
          const sentinel =
            `external-${kind}-leak-sentinel`;
          let fetchCount = 0;
          let tokenProviderCount = 0;

          const terminalReference =
            await runC6SourceV3SimpleAuthorizedCensus({
              assetRoot,
              authorizationTokenProvider: async () => {
                tokenProviderCount += 1;
                return authorizationToken;
              },
              expected,
              fetchImpl: async () => {
                fetchCount += 1;
                const headers = {
                  "content-type":
                    "application/json; charset=utf-8",
                  date:
                    "Sun, 26 Jul 2026 12:00:00 GMT",
                  etag: kind === "header"
                    ? `${sentinel}-${tokenText}`
                    : "\"clean-etag\"",
                  "x-github-request-id": "ABC:123",
                  "x-ratelimit-limit": "5000",
                  "x-ratelimit-remaining": "4999",
                  "x-ratelimit-reset": String(
                    Date.parse(
                      "2026-07-26T13:00:00Z",
                    ) / 1_000,
                  ),
                  "x-ratelimit-resource": "graphql",
                  "x-ratelimit-used": "1",
                };
                return new Response(
                  kind === "body"
                    ? `${sentinel}-${tokenText}`
                    : JSON.stringify({
                        data: {
                          rateLimit: {
                            cost: 1,
                            limit: 5_000,
                            remaining: 4_999,
                            resetAt:
                              "2026-07-26T13:00:00Z",
                            used: 1,
                          },
                          search: {
                            repositoryCount: 0,
                          },
                        },
                      }),
                  {
                    headers,
                    status: 200,
                  },
                );
              },
              now: () =>
                Date.parse(
                  "2026-07-26T12:00:01.000Z",
                ),
              repositoryRoot,
              waitUntil: async () => undefined,
            });

          expect(terminalReference.path).toBe(
            "terminal.json",
          );
          expect(fetchCount).toBe(1);
          expect(tokenProviderCount).toBe(1);
          const terminal = JSON.parse(
            await readFile(
              join(assetRoot, "terminal.json"),
              "utf8",
            ),
          ) as {
            chainTip: { path: string };
            failureCode: string;
            outcome: string;
          };
          const failureEvidence = JSON.parse(
            await readFile(
              join(
                assetRoot,
                "failure-evidence.json",
              ),
              "utf8",
            ),
          ) as {
            chainTip: { path: string };
            failureCode: string;
          };
          expect(terminal).toMatchObject({
            chainTip: {
              path: "frozen-input-closure.json",
            },
            failureCode: "secret-leak",
            outcome: "failed",
          });
          expect(failureEvidence).toMatchObject({
            chainTip: {
              path: "frozen-input-closure.json",
            },
            failureCode: "secret-leak",
          });
          const attemptRoot = join(
            assetRoot,
            "pass-a",
            "logical-request-00000001",
            "attempt-01",
          );
          expect(
            await readFile(
              join(attemptRoot, "response-body.raw"),
            ).catch(() => null),
          ).toBeNull();
          if (kind === "header") {
            expect(
              await readFile(
                join(
                  attemptRoot,
                  "response-started.json",
                ),
              ).catch(() => null),
            ).toBeNull();
          }
          const treeBytes =
            await readTreeBytes(assetRoot);
          expect(treeBytes.includes(tokenText)).toBe(
            false,
          );
          expect(treeBytes.includes(sentinel)).toBe(
            false,
          );
          expect(
            authorizationToken.every(
              (byte) => byte === 0,
            ),
          ).toBe(true);
        },
      );
    }
  });

  it("fails closed without terminal publication when the artifact tree already contains the token", async () => {
    await withAuthorizedCensusRoot(
      async ({
        assetRoot,
        expected,
        repositoryRoot,
      }) => {
        const authorizationToken =
          Buffer.from("github-token-tree-leak");
        let fetchCount = 0;
        let tokenProviderCount = 0;

        await expect(
          runC6SourceV3SimpleAuthorizedCensus({
            assetRoot,
            authorizationTokenProvider: async () => {
              tokenProviderCount += 1;
              return authorizationToken;
            },
            expected,
            fetchImpl: async () => {
              fetchCount += 1;
              await writeFile(
                join(assetRoot, "injected-tree-leak"),
                authorizationToken,
              );
              return new Response(
                authorizationToken.toString("utf8"),
                {
                  headers: {
                    "content-type":
                      "application/json; charset=utf-8",
                    date:
                      "Sun, 26 Jul 2026 12:00:00 GMT",
                    "x-github-request-id":
                      "ABC:123",
                    "x-ratelimit-limit": "5000",
                    "x-ratelimit-remaining": "4999",
                    "x-ratelimit-reset": String(
                      Date.parse(
                        "2026-07-26T13:00:00Z",
                      ) / 1_000,
                    ),
                    "x-ratelimit-resource":
                      "graphql",
                    "x-ratelimit-used": "1",
                  },
                  status: 200,
                },
              );
            },
            now: () =>
              Date.parse(
                "2026-07-26T12:00:01.000Z",
              ),
            repositoryRoot,
          }),
        ).rejects.toBeInstanceOf(
          C6SourceV3SimpleSecretLeakError,
        );
        expect(fetchCount).toBe(1);
        expect(tokenProviderCount).toBe(1);
        for (const path of [
          "failure-evidence.json",
          "asset-lock.json",
          "terminal.json",
        ]) {
          expect(
            await readFile(
              join(assetRoot, path),
            ).catch(() => null),
          ).toBeNull();
        }
        expect(
          authorizationToken.every(
            (byte) => byte === 0,
          ),
        ).toBe(true);
      },
    );
  });

  it("rejects missing explicit live confirmation before authorization or dispatch", async () => {
    let fetchCount = 0;
    let tokenProviderCount = 0;

    await expect(
      runC6SourceV3SimpleFormalCensus({
        activationReceiptBytes: "{}\n",
        assetRoot: "/does-not-exist/c6-census",
        authorizationTokenProvider: async () => {
          tokenProviderCount += 1;
          return Buffer.from("github-token");
        },
        fetchImpl: async () => {
          fetchCount += 1;
          throw new Error("must not dispatch");
        },
        liveNetworkConfirmation: "no",
        repositoryRoot: process.cwd(),
      }),
    ).rejects.toThrow("confirmation");
    expect(fetchCount).toBe(0);
    expect(tokenProviderCount).toBe(0);
  });

  it("rejects an invalid activation receipt before dispatch", async () => {
    let fetchCount = 0;
    let tokenProviderCount = 0;

    await expect(
      runC6SourceV3SimpleFormalCensus({
        activationReceiptBytes: "{}\n",
        assetRoot: "/does-not-exist/c6-census",
        authorizationTokenProvider: async () => {
          tokenProviderCount += 1;
          return Buffer.from("github-token");
        },
        fetchImpl: async () => {
          fetchCount += 1;
          throw new Error("must not dispatch");
        },
        liveNetworkConfirmation:
          "execute-goodmemory-c6-source-v3-simple-formal-census",
        repositoryRoot: process.cwd(),
      }),
    ).rejects.toThrow();
    expect(fetchCount).toBe(0);
    expect(tokenProviderCount).toBe(0);
  });

  it("rejects a writer conflict before requesting the authorization token", async () => {
    await withLockedFailureOutcome(
      async ({ assetRoot, expected, repositoryRoot }) => {
        const writer =
          await acquireC6SourceV3SimpleCensusWriterLock({
            assetRoot,
            evaluationId: expected.evaluationId,
            executionContractSha256:
              expected.executionContractSha256,
          });
        let tokenProviderCount = 0;
        try {
          await expect(
            runC6SourceV3SimpleFormalCensus({
              activationReceiptBytes:
                ACTIVATION_RECEIPT_BYTES,
              assetRoot,
              authorizationTokenProvider: async () => {
                tokenProviderCount += 1;
                return Buffer.from("github-token");
              },
              liveNetworkConfirmation:
                LIVE_CONFIRMATION,
              repositoryRoot,
            }),
          ).rejects.toThrow("single-writer conflict");
        } finally {
          await writer.release();
        }
        expect(tokenProviderCount).toBe(0);
      },
    );
  });

  it("finalizes a locked outcome from its durable context after the repository inputs drift", async () => {
    await withLockedFailureOutcome(
      async ({ assetRoot, repositoryRoot }) => {
        await writeFile(
          join(repositoryRoot, "fixture.json"),
          "mutated-after-asset-lock",
        );
        let fetchCount = 0;
        let tokenProviderCount = 0;
        const authorizationToken =
          Buffer.from("github-token");

        const terminal =
          await runC6SourceV3SimpleFormalCensus({
            activationReceiptBytes:
              ACTIVATION_RECEIPT_BYTES,
            assetRoot,
            authorizationTokenProvider: async () => {
              tokenProviderCount += 1;
              return authorizationToken;
            },
            fetchImpl: async () => {
              fetchCount += 1;
              throw new Error("must not dispatch");
            },
            liveNetworkConfirmation: LIVE_CONFIRMATION,
            repositoryRoot,
          });

        expect(terminal.path).toBe("terminal.json");
        expect(fetchCount).toBe(0);
        expect(tokenProviderCount).toBe(1);
        expect(
          authorizationToken.every(
            (byte) => byte === 0,
          ),
        ).toBe(true);
      },
    );
  });

  it("rejects corrupt finalize-only state before requesting the authorization token", async () => {
    await withLockedFailureOutcome(
      async ({ assetRoot, repositoryRoot }) => {
        await writeFile(
          join(assetRoot, "asset-lock.json"),
          "{}\n",
        );
        let tokenProviderCount = 0;

        await expect(
          runC6SourceV3SimpleFormalCensus({
            activationReceiptBytes:
              ACTIVATION_RECEIPT_BYTES,
            assetRoot,
            authorizationTokenProvider: async () => {
              tokenProviderCount += 1;
              return Buffer.from("github-token");
            },
            liveNetworkConfirmation: LIVE_CONFIRMATION,
            repositoryRoot,
          }),
        ).rejects.toThrow();
        expect(tokenProviderCount).toBe(0);
      },
    );
  });

  it("rejects frozen runtime drift before token, dispatch, or writer acquisition", async () => {
    await withLockedFailureOutcome(
      async ({ assetRoot, repositoryRoot }) => {
        let fetchCount = 0;
        let tokenProviderCount = 0;
        const before = await readdir(assetRoot);

        await expect(
          runC6SourceV3SimpleFormalCensus({
            activationReceiptBytes:
              ACTIVATION_RECEIPT_BYTES,
            assetRoot,
            authorizationTokenProvider: async () => {
              tokenProviderCount += 1;
              return Buffer.from("github-token");
            },
            fetchImpl: async () => {
              fetchCount += 1;
              throw new Error("must not dispatch");
            },
            liveNetworkConfirmation: LIVE_CONFIRMATION,
            repositoryRoot,
          }),
        ).rejects.toThrow("frozen runtime");

        expect(fetchCount).toBe(0);
        expect(tokenProviderCount).toBe(0);
        expect(await readdir(assetRoot)).toEqual(before);
        expect(
          await readFile(
            join(assetRoot, "writer-lock.json"),
          ).catch(() => null),
        ).toBeNull();
      },
      {
        bun: "1.3.13",
        node: process.versions.node,
      },
    );
  });

  it("recovers a known nested post-link pending artifact before locked finalization", async () => {
    await withLockedFailureOutcome(
      async ({ assetRoot, repositoryRoot }) => {
        const finalPath = join(
          assetRoot,
          "pass-a",
          "logical-request-result-00000001.json",
        );
        const pendingPath = join(
          assetRoot,
          "pass-a",
          ".logical-request-result-00000001.json.pending",
        );
        await link(finalPath, pendingPath);
        let tokenProviderCount = 0;

        const terminal =
          await runC6SourceV3SimpleFormalCensus({
            activationReceiptBytes:
              ACTIVATION_RECEIPT_BYTES,
            assetRoot,
            authorizationTokenProvider: async () => {
              tokenProviderCount += 1;
              return Buffer.from("github-token");
            },
            liveNetworkConfirmation: LIVE_CONFIRMATION,
            repositoryRoot,
          });

        expect(terminal.path).toBe("terminal.json");
        expect(tokenProviderCount).toBe(1);
        expect(
          await readFile(pendingPath).catch(() => null),
        ).toBeNull();
      },
    );
  });

  it("does not treat an unlocked self-consistent closure as runtime authority", async () => {
    await withLockedFailureOutcome(
      async ({ assetRoot, repositoryRoot }) => {
        await rm(join(assetRoot, "asset-lock.json"));
        let tokenProviderCount = 0;

        await expect(
          runC6SourceV3SimpleFormalCensus({
            activationReceiptBytes:
              ACTIVATION_RECEIPT_BYTES,
            assetRoot,
            authorizationTokenProvider: async () => {
              tokenProviderCount += 1;
              return Buffer.from("github-token");
            },
            liveNetworkConfirmation: LIVE_CONFIRMATION,
            repositoryRoot,
          }),
        ).rejects.toThrow(
          "repository does not match the running repository",
        );
        expect(tokenProviderCount).toBe(0);
      },
    );
  });
});

async function withLockedFailureOutcome(
  run: (input: {
    assetRoot: string;
    expected: ReturnType<
      typeof createC6SourceV3SimpleTestExpectedFrozenInputs
    >;
    repositoryRoot: string;
  }) => Promise<void>,
  runtimeVersions?: {
    bun: string;
    node: string;
  },
): Promise<void> {
  const root = await mkdtemp(join(
    process.cwd(),
    ".goodmemory-c6-runner-",
  ));
  const assetRoot = join(root, "assets");
  const repositoryRoot = join(root, "repository");
  await mkdir(assetRoot);
  await mkdir(repositoryRoot);
  const frozenInputs = [{
    bytes: FIXTURE_BYTES.length,
    label: "fixture",
    path: "fixture.json",
    sha256: createHash("sha256")
      .update(FIXTURE_BYTES)
      .digest("hex"),
  }];
  const expected =
    createC6SourceV3SimpleTestExpectedFrozenInputs({
      activationReceiptBytes:
        ACTIVATION_RECEIPT_BYTES,
      evaluationId:
        "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
      executionContractSha256: "a".repeat(64),
      frozenInputs,
      runtimeVersions,
    });
  try {
    await mkdir(join(assetRoot, "pass-a"), {
      recursive: true,
    });
    await writeFile(
      join(
        assetRoot,
        "pass-a",
        "logical-request-result-00000001.json",
      ),
      "{}\n",
    );
    await writeFile(
      join(repositoryRoot, "fixture.json"),
      FIXTURE_BYTES,
    );
    const frozenInputClosure =
      await writeC6SourceV3SimpleFrozenInputClosure({
        assetRoot,
        expected,
        repositoryRoot,
      });
    await writeC6SourceV3SimpleFailureEvidence({
      assetRoot,
      chainTip: frozenInputClosure,
      expectedFrozenInputs: expected,
      failureCode: "publication-failure",
      frozenInputClosure,
    });
    await writeC6SourceV3SimpleCensusAssetLock({
      assetRoot,
      expectedFrozenInputs: expected,
      frozenInputClosureSha256:
        frozenInputClosure.sha256,
    });
    await run({
      assetRoot,
      expected,
      repositoryRoot,
    });
  } finally {
    await rm(root, {
      force: true,
      recursive: true,
    });
  }
}

async function withAuthorizedCensusRoot(
  run: (input: {
    assetRoot: string;
    expected: ReturnType<
      typeof createC6SourceV3SimpleTestExpectedFrozenInputs
    >;
    repositoryRoot: string;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(
    process.cwd(),
    ".goodmemory-c6-runner-active-",
  ));
  const assetRoot = join(root, "assets");
  const repositoryRoot = join(root, "repository");
  await mkdir(assetRoot);
  await mkdir(repositoryRoot);
  await writeFile(
    join(repositoryRoot, "fixture.json"),
    FIXTURE_BYTES,
  );
  const expected =
    createC6SourceV3SimpleTestExpectedFrozenInputs({
      activationReceiptBytes:
        ACTIVATION_RECEIPT_BYTES,
      evaluationId:
        "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
      executionContractSha256: "a".repeat(64),
      frozenInputs: [{
        bytes: FIXTURE_BYTES.length,
        label: "fixture",
        path: "fixture.json",
        sha256: createHash("sha256")
          .update(FIXTURE_BYTES)
          .digest("hex"),
      }],
    });
  try {
    await run({
      assetRoot,
      expected,
      repositoryRoot,
    });
  } finally {
    await rm(root, {
      force: true,
      recursive: true,
    });
  }
}

async function readTreeBytes(root: string): Promise<string> {
  const chunks: Buffer[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        chunks.push(await readFile(path));
      }
    }
  };
  await visit(root);
  return Buffer.concat(chunks).toString("utf8");
}
