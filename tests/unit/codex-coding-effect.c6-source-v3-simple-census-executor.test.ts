import {
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  C6SourceV3SimplePartialResponseError,
  executeC6SourceV3SimpleLogicalRequest,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-executor";
import {
  C6SourceV3SimpleProactivePauseExceededError,
  C6SourceV3SimpleSecretLeakError,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-errors";
import {
  computeC6SourceV3SimpleLogicalRequestIdentitySha256,
  prepareC6SourceV3SimpleAttempt,
  readC6SourceV3SimpleLogicalRequestEvidence,
  runC6SourceV3SimpleWithArtifactCommitGuard,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-ledger";
import {
  buildC6SourceV3SimpleDurableGraphqlRequest,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-transport";
import {
  buildC6SourceV4BoundedFailureLedgerClosure,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-v3-runtime";

const EVALUATION_ID =
  "goodmemory-c6-codex-coding-effect-source-v3-simple-v1";
const CONTRACT_SHA = "a".repeat(64);
const RUNTIME_BINDINGS = {
  frozenInputClosureSha256: "b".repeat(64),
  runtimeAuthorizationSha256: "c".repeat(64),
};
const ZERO_SHA = "0".repeat(64);
const RESET_AT = "2026-07-26T13:00:00Z";
const HEADERS = {
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

describe("C6 source-v3-simple logical request executor", () => {
  it("prepares only an actual dispatch and skips the hook during local completion replay", async () => {
    await withRoot(async (root) => {
      const passRoot = join(root, "pass-a");
      let prepareDispatchCount = 0;
      let fetchCount = 0;
      const input = {
        assetRoot: root,
        authorizationTokenProvider: async () =>
          Buffer.from("github-token"),
        evaluationId: EVALUATION_ID,
        executionContractSha256: CONTRACT_SHA,
        ...RUNTIME_BINDINGS,
        fetchImpl: async () => {
          fetchCount += 1;
          return new Response(
            repositoryCountBody(0),
            {
              headers: HEADERS,
              status: 200,
            },
          );
        },
        logicalRequestOrdinal: 1,
        pass: "A" as const,
        passRoot,
        prepareDispatch: async () => {
          prepareDispatchCount += 1;
          await expect(
            lstat(
              join(
                passRoot,
                "logical-request-00000001",
              ),
            ),
          ).rejects.toMatchObject({
            code: "ENOENT",
          });
          return {
            maximumResponseBodyBytes: 1_024,
          };
        },
        priorLogicalRequestCompletionSha256:
          ZERO_SHA,
        request: repositoryCountRequest(),
      };

      await executeC6SourceV3SimpleLogicalRequest(
        input,
      );
      await executeC6SourceV3SimpleLogicalRequest(
        input,
      );

      expect(prepareDispatchCount).toBe(1);
      expect(fetchCount).toBe(1);
    });
  });

  it("leaves a zero-prefix failure closure when pre-dispatch preparation fails", async () => {
    await withRoot(async (root) => {
      const passRoot = join(root, "pass-a");
      let fetchCount = 0;

      await expect(
        executeC6SourceV3SimpleLogicalRequest({
          assetRoot: root,
          authorizationTokenProvider:
            async () =>
              Buffer.from("github-token"),
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            CONTRACT_SHA,
          ...RUNTIME_BINDINGS,
          fetchImpl: async () => {
            fetchCount += 1;
            return new Response(
              repositoryCountBody(0),
              {
                headers: HEADERS,
                status: 200,
              },
            );
          },
          logicalRequestOrdinal: 1,
          pass: "A",
          passRoot,
          prepareDispatch: async () => {
            throw new Error(
              "synthetic pre-dispatch failure",
            );
          },
          priorLogicalRequestCompletionSha256:
            ZERO_SHA,
          request: repositoryCountRequest(),
        }),
      ).rejects.toThrow(
        "synthetic pre-dispatch failure",
      );
      expect(fetchCount).toBe(0);
      await expect(
        lstat(passRoot),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(
        await buildC6SourceV4BoundedFailureLedgerClosure({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            CONTRACT_SHA,
          ...RUNTIME_BINDINGS,
          passRoot,
        }),
      ).toMatchObject({
        committedRequestAttemptCount: 0,
        completedLogicalRequestCount: 0,
        inProgressChainTip: null,
        logicalRequestDirectoryCount: 0,
      });
    });
  });

  it("checks the artifact budget before a local completion repair writes", async () => {
    await withRoot(async (root) => {
      const passRoot = join(root, "pass-a");
      let fetchCount = 0;
      const input = {
        assetRoot: root,
        authorizationTokenProvider: async () =>
          Buffer.from("github-token"),
        evaluationId: EVALUATION_ID,
        executionContractSha256: CONTRACT_SHA,
        ...RUNTIME_BINDINGS,
        fetchImpl: async () => {
          fetchCount += 1;
          return new Response(
            repositoryCountBody(0),
            {
              headers: HEADERS,
              status: 200,
            },
          );
        },
        logicalRequestOrdinal: 1,
        pass: "A" as const,
        passRoot,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA,
        request: repositoryCountRequest(),
      };
      await executeC6SourceV3SimpleLogicalRequest(
        input,
      );
      const completionPath = join(
        passRoot,
        "logical-request-complete-00000001.json",
      );
      await rm(completionPath);
      let guardedCommitCount = 0;

      await expect(
        runC6SourceV3SimpleWithArtifactCommitGuard(
          {
            afterCommit() {},
            async beforeCommit() {
              guardedCommitCount += 1;
              throw new Error(
                "synthetic canonical budget rejection",
              );
            },
          },
          async () =>
            await executeC6SourceV3SimpleLogicalRequest(
              input,
            ),
        ),
      ).rejects.toThrow(
        "existing projected result is not locally finalizable",
      );
      expect(guardedCommitCount).toBe(1);
      expect(fetchCount).toBe(1);
      await expect(
        readFile(completionPath),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  it("replays a fully verified proactive-pause overflow before authorization or dispatch", async () => {
    await withRoot(async (root) => {
      const passRoot = join(root, "pass-a");
      const request = repositoryCountRequest();
      const resetAt = "2026-07-26T14:00:00Z";
      const headers = {
        ...HEADERS,
        "x-ratelimit-remaining": "49",
        "x-ratelimit-reset": String(
          Date.parse(resetAt) / 1_000,
        ),
        "x-ratelimit-used": "4951",
      };
      let fetchCount = 0;
      let tokenProviderCount = 0;
      const input = {
        assetRoot: root,
        authorizationTokenProvider: async () => {
          tokenProviderCount += 1;
          return Buffer.from("github-token");
        },
        evaluationId: EVALUATION_ID,
        executionContractSha256: CONTRACT_SHA,
        ...RUNTIME_BINDINGS,
        fetchImpl: async () => {
          fetchCount += 1;
          return new Response(
            repositoryCountBody(0, {
              remaining: 49,
              resetAt,
              used: 4_951,
            }),
            {
              headers,
              status: 200,
            },
          );
        },
        logicalRequestOrdinal: 1,
        now: () =>
          Date.parse("2026-07-26T12:00:01.000Z"),
        pass: "A" as const,
        passRoot,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA,
        request,
      };

      const firstFailure =
        await executeC6SourceV3SimpleLogicalRequest(
          input,
        ).catch((error: unknown) => error);
      expect(firstFailure).toBeInstanceOf(
        C6SourceV3SimpleProactivePauseExceededError,
      );
      expect(fetchCount).toBe(1);
      expect(tokenProviderCount).toBe(1);

      const chainTip = (
        firstFailure as
          C6SourceV3SimpleProactivePauseExceededError
      ).chainTip;
      expect(chainTip.path).toBe(
        "pass-a/logical-request-complete-00000001.json",
      );
      const evidence =
        await readC6SourceV3SimpleLogicalRequestEvidence(
          root,
          chainTip,
        );
      expect(evidence.completion).toMatchObject({
        logicalRequestOrdinal: 1,
        pass: "A",
        priorLogicalRequestCompletionSha256:
          ZERO_SHA,
      });

      fetchCount = 0;
      tokenProviderCount = 0;
      const resumedFailure =
        await executeC6SourceV3SimpleLogicalRequest(
          input,
        ).catch((error: unknown) => error);
      expect(resumedFailure).toBeInstanceOf(
        C6SourceV3SimpleProactivePauseExceededError,
      );
      expect(
        (
          resumedFailure as
            C6SourceV3SimpleProactivePauseExceededError
        ).chainTip,
      ).toEqual(chainTip);
      expect(fetchCount).toBe(0);
      expect(tokenProviderCount).toBe(0);

      await writeFile(
        join(
          passRoot,
          "logical-request-00000001",
          "attempt-01",
          "response-body.raw",
        ),
        "{}",
      );
      const corruptFailure =
        await executeC6SourceV3SimpleLogicalRequest(
          input,
        ).catch((error: unknown) => error);
      expect(corruptFailure).toBeInstanceOf(Error);
      expect(corruptFailure).not.toBeInstanceOf(
        C6SourceV3SimpleProactivePauseExceededError,
      );
      expect(fetchCount).toBe(0);
      expect(tokenProviderCount).toBe(0);
    });
  });

  it("durably classifies a retry, waits to the exact not-before, and completes the identical request", async () => {
    await withRoot(async (root) => {
      const passRoot = join(root, "pass-a");
      const request = repositoryCountRequest();
      let now = Date.parse(
        "2026-07-26T12:00:01.000Z",
      );
      let fetchCount = 0;
      const waitedUntil: number[] = [];

      const result =
        await executeC6SourceV3SimpleLogicalRequest({
          assetRoot: root,
          authorizationTokenProvider: async () =>
            Buffer.from("github-token"),
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
          ...RUNTIME_BINDINGS,
          fetchImpl: async () => {
            fetchCount += 1;
            return fetchCount === 1
              ? new Response(
                  "{\"message\":\"retry\"}",
                  {
                    headers: HEADERS,
                    status: 503,
                  },
                )
              : new Response(
                  repositoryCountBody(0),
                  {
                    headers: HEADERS,
                    status: 200,
                  },
                );
          },
          logicalRequestOrdinal: 1,
          now: () => now,
          pass: "A",
          passRoot,
          priorLogicalRequestCompletionSha256:
            ZERO_SHA,
          request,
          waitUntil: async (notBefore) => {
            waitedUntil.push(notBefore);
            now = notBefore;
          },
        });

      expect(fetchCount).toBe(2);
      expect(waitedUntil).toEqual([
        Date.parse("2026-07-26T12:00:02.000Z"),
      ]);
      expect(result.attempts).toHaveLength(2);
      expect(result.projectedRequest).toMatchObject({
        operationName:
          "C6SourceV3SimpleRepositoryCount",
        result: {
          repositoryCount: 0,
        },
      });
    });
  });

  it("consumes an interrupted pre-dispatch attempt before retrying and never redispatches it", async () => {
    await withRoot(async (root) => {
      const passRoot = join(root, "pass-a");
      const request = repositoryCountRequest();
      const attemptRoot = join(
        passRoot,
        "logical-request-00000001",
        "attempt-01",
      );
      const contextBase = {
        attemptNumber: 1,
        attemptRoot,
        evaluationId: EVALUATION_ID,
        executionContractSha256: CONTRACT_SHA,
        ...RUNTIME_BINDINGS,
        logicalRequestOrdinal: 1,
        pass: "A" as const,
        priorAttemptCommitSha256: null,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA,
      };
      await prepareC6SourceV3SimpleAttempt({
        context: {
          ...contextBase,
          logicalRequestIdentitySha256:
            computeC6SourceV3SimpleLogicalRequestIdentitySha256({
              ...contextBase,
              request,
            }),
        },
        request,
      });
      let fetchCount = 0;
      let tokenProviderCount = 0;

      const result =
        await executeC6SourceV3SimpleLogicalRequest({
          assetRoot: root,
          authorizationTokenProvider: async () => {
            tokenProviderCount += 1;
            expect(
              JSON.parse(
                await readFile(
                  join(
                    attemptRoot,
                    "transport-error.json",
                  ),
                  "utf8",
                ),
              ),
            ).toMatchObject({
              name: "ProcessInterruption",
              phase:
                "process-interruption-before-response",
            });
            return Buffer.from("github-token");
          },
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
          ...RUNTIME_BINDINGS,
          fetchImpl: async () => {
            fetchCount += 1;
            return new Response(
              repositoryCountBody(0),
              {
                headers: HEADERS,
                status: 200,
              },
            );
          },
          logicalRequestOrdinal: 1,
          now: () =>
            Date.parse(
              "2026-07-26T12:00:01.000Z",
            ),
          pass: "A",
          passRoot,
          priorLogicalRequestCompletionSha256:
            ZERO_SHA,
          request,
          waitUntil: async () => undefined,
        });

      expect(fetchCount).toBe(1);
      expect(tokenProviderCount).toBe(1);
      expect(result.attempts).toHaveLength(2);
    });
  });

  it("retries an ordinary 503 without requiring GitHub rate-limit headers", async () => {
    await withRoot(async (root) => {
      let fetchCount = 0;
      let now = Date.parse(
        "2026-07-26T12:00:01.000Z",
      );

      const result =
        await executeC6SourceV3SimpleLogicalRequest({
          assetRoot: root,
          authorizationTokenProvider: async () =>
            Buffer.from("github-token"),
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
          ...RUNTIME_BINDINGS,
          fetchImpl: async () => {
            fetchCount += 1;
            return fetchCount === 1
              ? new Response("temporarily unavailable", {
                  status: 503,
                })
              : new Response(repositoryCountBody(0), {
                  headers: HEADERS,
                  status: 200,
                });
          },
          logicalRequestOrdinal: 1,
          now: () => now,
          pass: "A",
          passRoot: join(root, "pass-a"),
          priorLogicalRequestCompletionSha256:
            ZERO_SHA,
          request: repositoryCountRequest(),
          waitUntil: async (notBefore) => {
            now = notBefore;
          },
        });

      expect(fetchCount).toBe(2);
      expect(result.attempts).toHaveLength(2);
    });
  });

  it("persists only contract-selected headers from a real GitHub-style response", async () => {
    await withRoot(async (root) => {
      const result =
        await executeC6SourceV3SimpleLogicalRequest({
          assetRoot: root,
          authorizationTokenProvider: async () =>
            Buffer.from("github-token"),
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
          ...RUNTIME_BINDINGS,
          fetchImpl: async () =>
            new Response(repositoryCountBody(0), {
              headers: {
                ...HEADERS,
                "cache-control": "private, max-age=0",
                server: "github.com",
              },
              status: 200,
            }),
          logicalRequestOrdinal: 1,
          now: () =>
            Date.parse(
              "2026-07-26T12:00:01.000Z",
            ),
          pass: "A",
          passRoot: join(root, "pass-a"),
          priorLogicalRequestCompletionSha256:
            ZERO_SHA,
          request: repositoryCountRequest(),
          waitUntil: async () => undefined,
        });

      expect(result.attempts).toHaveLength(1);
      const responseStarted = JSON.parse(
        await readFile(
          join(
            root,
            "pass-a",
            "logical-request-00000001",
            "attempt-01",
            "response-started.json",
          ),
          "utf8",
        ),
      ) as {
        headers: Record<string, string>;
      };
      expect(responseStarted.headers.server).toBeUndefined();
      expect(
        responseStarted.headers["cache-control"],
      ).toBeUndefined();
      expect(responseStarted.headers).toMatchObject(
        HEADERS,
      );
    });
  });

  it("preserves the typed secret-leak error when the response body contains the authorization token", async () => {
    await withRoot(async (root) => {
      const passRoot = join(root, "pass-a");
      let fetchCount = 0;
      let tokenProviderCount = 0;

      await expect(
        executeC6SourceV3SimpleLogicalRequest({
          assetRoot: root,
          authorizationTokenProvider: async () => {
            tokenProviderCount += 1;
            return Buffer.from("github-token");
          },
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
          ...RUNTIME_BINDINGS,
          fetchImpl: async () => {
            fetchCount += 1;
            return new Response(
              "{\"token\":\"github-token\"}",
              {
                headers: HEADERS,
                status: 200,
              },
            );
          },
          logicalRequestOrdinal: 1,
          pass: "A",
          passRoot,
          priorLogicalRequestCompletionSha256:
            ZERO_SHA,
          request: repositoryCountRequest(),
        }),
      ).rejects.toBeInstanceOf(
        C6SourceV3SimpleSecretLeakError,
      );
      expect(fetchCount).toBe(1);
      expect(tokenProviderCount).toBe(1);
      expect(
        await readFile(
          join(
            passRoot,
            "logical-request-00000001",
            "attempt-01",
            "response-body.raw",
          ),
        ).catch(() => null),
      ).toBeNull();
    });
  });

  it("rejects a pass root outside the census asset root before dispatch", async () => {
    await withRoot(async (root) => {
      let fetchCount = 0;

      await expect(
        executeC6SourceV3SimpleLogicalRequest({
          assetRoot: join(root, "asset"),
          authorizationTokenProvider: async () =>
            Buffer.from("github-token"),
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
          ...RUNTIME_BINDINGS,
          fetchImpl: async () => {
            fetchCount += 1;
            return new Response(
              repositoryCountBody(0),
              {
                headers: HEADERS,
                status: 200,
              },
            );
          },
          logicalRequestOrdinal: 1,
          pass: "A",
          passRoot: join(root, "outside"),
          priorLogicalRequestCompletionSha256:
            ZERO_SHA,
          request: repositoryCountRequest(),
        }),
      ).rejects.toThrow("asset root");
      expect(fetchCount).toBe(0);
    });
  });

  it("never redispatches after response-started when the response body cannot be read", async () => {
    await withRoot(async (root) => {
      const input = {
        assetRoot: root,
        authorizationTokenProvider: async () =>
          Buffer.from("github-token"),
        evaluationId: EVALUATION_ID,
        executionContractSha256: CONTRACT_SHA,
        ...RUNTIME_BINDINGS,
        logicalRequestOrdinal: 1,
        now: () =>
          Date.parse(
            "2026-07-26T12:00:01.000Z",
          ),
        pass: "A" as const,
        passRoot: join(root, "pass-a"),
        priorLogicalRequestCompletionSha256:
          ZERO_SHA,
        request: repositoryCountRequest(),
        waitUntil: async () => undefined,
      };
      let fetchCount = 0;
      const fetchImpl = async () => {
        fetchCount += 1;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(
                new Error("body failed"),
              );
            },
          }),
          {
            headers: HEADERS,
            status: 200,
          },
        );
      };

      const firstFailure =
        await executeC6SourceV3SimpleLogicalRequest({
          ...input,
          fetchImpl,
        }).catch((error: unknown) => error);
      expect(firstFailure).toBeInstanceOf(
        C6SourceV3SimplePartialResponseError,
      );
      expect(
        (
          firstFailure as
            C6SourceV3SimplePartialResponseError
        ).chainTip.path,
      ).toBe(
        "pass-a/logical-request-00000001/" +
        "attempt-01/response-started.json",
      );
      await expect(
        executeC6SourceV3SimpleLogicalRequest({
          ...input,
          fetchImpl,
        }),
      ).rejects.toBeInstanceOf(
        C6SourceV3SimplePartialResponseError,
      );
      expect(fetchCount).toBe(1);
    });
  });

  it("stops an oversized streamed response at the frozen body limit and never redispatches it", async () => {
    await withRoot(async (root) => {
      const input = {
        assetRoot: root,
        authorizationTokenProvider: async () =>
          Buffer.from("github-token"),
        evaluationId: EVALUATION_ID,
        executionContractSha256: CONTRACT_SHA,
        ...RUNTIME_BINDINGS,
        logicalRequestOrdinal: 1,
        maximumResponseBodyBytes: 4,
        now: () =>
          Date.parse(
            "2026-07-26T12:00:01.000Z",
          ),
        pass: "A" as const,
        passRoot: join(root, "pass-a"),
        priorLogicalRequestCompletionSha256:
          ZERO_SHA,
        request: repositoryCountRequest(),
        waitUntil: async () => undefined,
      };
      let fetchCount = 0;
      let cancelled = false;
      const fetchImpl = async () => {
        fetchCount += 1;
        return new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true;
            },
            start(controller) {
              controller.enqueue(
                Buffer.from("1234"),
              );
              controller.enqueue(
                Buffer.from("5"),
              );
            },
          }),
          {
            headers: HEADERS,
            status: 200,
          },
        );
      };

      await expect(
        executeC6SourceV3SimpleLogicalRequest({
          ...input,
          fetchImpl,
        }),
      ).rejects.toBeInstanceOf(
        C6SourceV3SimplePartialResponseError,
      );
      await expect(
        executeC6SourceV3SimpleLogicalRequest({
          ...input,
          fetchImpl,
        }),
      ).rejects.toBeInstanceOf(
        C6SourceV3SimplePartialResponseError,
      );
      expect(fetchCount).toBe(1);
      expect(cancelled).toBe(true);
      expect(
        await readFile(
          join(
            root,
            "pass-a",
            "logical-request-00000001",
            "attempt-01",
            "response-body.raw",
          ),
        ).catch(() => null),
      ).toBeNull();
    });
  });

  it("keeps the request deadline active until the response body is complete", async () => {
    await withRoot(async (root) => {
      let abortObserved = false;
      const fetchImpl = async (
        _input: string | URL | Request,
        init?: RequestInit,
      ) => {
        const signal = init?.signal;
        return new Response(
          new ReadableStream({
            start(controller) {
              const fallback = setTimeout(() => {
                controller.error(
                  new Error("fallback body failure"),
                );
              }, 100);
              signal?.addEventListener(
                "abort",
                () => {
                  abortObserved = true;
                  clearTimeout(fallback);
                  controller.error(
                    new Error("body aborted"),
                  );
                },
                { once: true },
              );
            },
          }),
          {
            headers: HEADERS,
            status: 200,
          },
        );
      };

      await expect(
        executeC6SourceV3SimpleLogicalRequest({
          assetRoot: root,
          authorizationTokenProvider: async () =>
            Buffer.from("github-token"),
          evaluationId: EVALUATION_ID,
          executionContractSha256: CONTRACT_SHA,
          ...RUNTIME_BINDINGS,
          fetchImpl,
          logicalRequestOrdinal: 1,
          pass: "A",
          passRoot: join(root, "pass-a"),
          priorLogicalRequestCompletionSha256:
            ZERO_SHA,
          request: repositoryCountRequest(),
          requestTimeoutMilliseconds: 5,
          waitUntil: async () => undefined,
        }),
      ).rejects.toBeInstanceOf(
        C6SourceV3SimplePartialResponseError,
      );
      expect(abortObserved).toBe(true);
    });
  });

  it("rejects an existing completion from another run or authorization before dispatch", async () => {
    await withRoot(async (root) => {
      const passRoot = join(root, "pass-a");
      const request = repositoryCountRequest();
      let tokenProviderCount = 0;
      const baseInput = {
        assetRoot: root,
        authorizationTokenProvider: async () => {
          tokenProviderCount += 1;
          return Buffer.from("github-token");
        },
        evaluationId: EVALUATION_ID,
        executionContractSha256: CONTRACT_SHA,
        ...RUNTIME_BINDINGS,
        logicalRequestOrdinal: 1,
        pass: "A" as const,
        passRoot,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA,
        request,
        waitUntil: async () => undefined,
      };
      let fetchCount = 0;
      const fetchImpl = async () => {
        fetchCount += 1;
        return new Response(
          repositoryCountBody(0),
          {
            headers: HEADERS,
            status: 200,
          },
        );
      };
      await executeC6SourceV3SimpleLogicalRequest({
        ...baseInput,
        fetchImpl,
      });
      expect(fetchCount).toBe(1);
      expect(tokenProviderCount).toBe(1);
      await writeFile(
        join(
          passRoot,
          "logical-request-complete-00000002.json",
        ),
        await readFile(join(
          passRoot,
          "logical-request-complete-00000001.json",
        )),
      );

      const mismatches = [
        {
          evaluationId: `${EVALUATION_ID}-other`,
        },
        {
          executionContractSha256: "d".repeat(64),
        },
        {
          frozenInputClosureSha256: "e".repeat(64),
        },
        {
          logicalRequestOrdinal: 2,
        },
        {
          pass: "B" as const,
        },
        {
          priorLogicalRequestCompletionSha256:
            "f".repeat(64),
        },
        {
          runtimeAuthorizationSha256: "1".repeat(64),
        },
      ];
      for (const mismatch of mismatches) {
        await expect(
          executeC6SourceV3SimpleLogicalRequest({
            ...baseInput,
            ...mismatch,
            fetchImpl,
          }),
        ).rejects.toThrow("existing completion");
      }
      expect(fetchCount).toBe(1);
      expect(tokenProviderCount).toBe(1);
    });
  });
});

function repositoryCountRequest() {
  return buildC6SourceV3SimpleDurableGraphqlRequest({
    operation: "repositoryCount",
    variables: {
      query: "language:TypeScript",
    },
  });
}

function repositoryCountBody(
  count: number,
  rateLimit: {
    remaining: number;
    resetAt: string;
    used: number;
  } = {
    remaining: 4_999,
    resetAt: RESET_AT,
    used: 1,
  },
): string {
  return JSON.stringify({
    data: {
      rateLimit: {
        cost: 1,
        limit: 5_000,
        ...rateLimit,
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
    ".goodmemory-c6-census-executor-",
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
