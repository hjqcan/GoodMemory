import { createHash } from "node:crypto";
import {
  link,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  join,
} from "node:path";

import { describe, expect, it } from "bun:test";

import {
  C6SourceV3SimpleSecretLeakError,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-errors";
import {
  commitC6SourceV3SimpleCreateOnlyBytes,
  completeC6SourceV3SimpleAttempt,
  computeC6SourceV3SimpleLogicalRequestIdentitySha256,
  finalizeC6SourceV3SimpleAttemptFromLedger,
  inspectC6SourceV3SimpleAttempt,
  prepareC6SourceV3SimpleAttempt,
  readC6SourceV3SimpleProjectedLogicalRequest,
  recordC6SourceV3SimpleResponseComplete,
  recordC6SourceV3SimpleResponseStarted,
  recordC6SourceV3SimpleTransportError,
  recoverC6SourceV3SimplePendingArtifacts,
  recoverC6SourceV3SimplePendingArtifactTree,
  settleC6SourceV3SimpleAttemptFromLedger,
  verifyC6SourceV3SimpleFailureChainTipMarker,
  verifyC6SourceV3SimpleLogicalRequestComplete,
  writeC6SourceV3SimpleLogicalRequestComplete,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-ledger";
import type {
  C6SourceV3SimpleAttemptContext,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-ledger";
import {
  buildC6SourceV3SimpleDurableGraphqlRequest,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-transport";
import type {
  C6SourceV3SimpleDurableGraphqlRequest,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-transport";

const SHA_A = "a".repeat(64);
const SHA_ZERO = "0".repeat(64);
const FROZEN_INPUT_CLOSURE_SHA = "b".repeat(64);
const RUNTIME_AUTHORIZATION_SHA = "c".repeat(64);
const SUCCESS_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  date: "Sun, 26 Jul 2026 12:00:00 GMT",
  "x-github-request-id": "ABC:123",
  "x-ratelimit-limit": "5000",
  "x-ratelimit-remaining": "4999",
  "x-ratelimit-reset": String(
    Date.parse("2026-07-26T13:00:00Z") / 1_000,
  ),
  "x-ratelimit-resource": "graphql",
  "x-ratelimit-used": "1",
};

describe("C6 source-v3-simple crash-safe attempt ledger", () => {
  it("moves through durable request, partial response, local replay, and committed attempt", async () => {
    await withAttemptRoot(async (attemptRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const context = attemptContext(attemptRoot, request);
      const prepared =
        await prepareC6SourceV3SimpleAttempt({
          context,
          request,
        });
      expect(prepared.requestCommitted).toEqual({
        bytes: 1070,
        path: "request-committed.json",
        sha256:
          "8b1e744f0f6781274520929e27566ad2fb3a2504e3769dbee15157f5760ce3de",
      });
      expect(
        await inspectC6SourceV3SimpleAttempt(context),
      ).toMatchObject({
        kind: "interrupted-before-response",
      });
      const started =
        await recordC6SourceV3SimpleResponseStarted({
          context,
          headers: SUCCESS_HEADERS,
          httpStatus: 200,
          receivedAt: "2026-07-26T12:00:01.000Z",
          requestCommitted: prepared.requestCommitted,
          secret: Buffer.from("secret-token"),
        });
      expect(
        await inspectC6SourceV3SimpleAttempt(context),
      ).toMatchObject({
        kind: "terminal-partial-response",
      });
      const completed =
        await recordC6SourceV3SimpleResponseComplete({
          body: repositoryCountResponse(0),
          context,
          responseStarted: started.responseStarted,
          secret: Buffer.from("secret-token"),
        });
      expect(
        await inspectC6SourceV3SimpleAttempt(context),
      ).toMatchObject({
        kind: "classify-local-response",
      });
      await completeC6SourceV3SimpleAttempt({
        context,
        decision: "stop-success",
        notBefore: null,
        reason: "graphql-success",
        requestCommitted: prepared.requestCommitted,
        responseComplete: completed.responseComplete,
        responseStarted: started.responseStarted,
        transportError: null,
      });
      expect(
        await inspectC6SourceV3SimpleAttempt(context),
      ).toMatchObject({
        kind: "committed",
        outcome: "stop-success",
      });
      expect(
        (await readdir(attemptRoot)).some((name) =>
          name.endsWith(".pending") ||
          name.endsWith(".ready")
        ),
      ).toBe(false);
    });
  });

  it("never persists a response body containing the authorization token", async () => {
    await withAttemptRoot(async (attemptRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const context = attemptContext(attemptRoot, request);
      const prepared =
        await prepareC6SourceV3SimpleAttempt({
          context,
          request,
        });
      const started =
        await recordC6SourceV3SimpleResponseStarted({
          context,
          headers: SUCCESS_HEADERS,
          httpStatus: 200,
          receivedAt: "2026-07-26T12:00:01.000Z",
          requestCommitted: prepared.requestCommitted,
          secret: Buffer.from("secret-token"),
        });

      await expect(
        recordC6SourceV3SimpleResponseComplete({
          body: Buffer.from(
            "{\"echo\":\"secret-token\"}",
          ),
          context,
          responseStarted: started.responseStarted,
          secret: Buffer.from("secret-token"),
        }),
      ).rejects.toBeInstanceOf(
        C6SourceV3SimpleSecretLeakError,
      );
      expect(
        await readFile(
          join(attemptRoot, "response-body.raw"),
        ).catch(() => null),
      ).toBeNull();
    });
  });

  it("treats a truncated final marker as corrupt and never as resumable", async () => {
    await withAttemptRoot(async (attemptRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const context = attemptContext(attemptRoot, request);
      await prepareC6SourceV3SimpleAttempt({
        context,
        request,
      });
      await writeFile(
        join(attemptRoot, "request-committed.json"),
        "{\"truncated\":",
      );

      await expect(
        inspectC6SourceV3SimpleAttempt(context),
      ).rejects.toThrow("corrupt");
    });
  });

  it("finishes an identical durable request after interruption before request-committed", async () => {
    await withAttemptRoot(async (attemptRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const context = attemptContext(attemptRoot, request);
      await commitC6SourceV3SimpleCreateOnlyBytes(
        attemptRoot,
        "request-body.raw",
        request.body,
      );

      const prepared =
        await prepareC6SourceV3SimpleAttempt({
          context,
          request,
        });

      expect(prepared.requestCommitted.path).toBe(
        "request-committed.json",
      );
      expect(
        await inspectC6SourceV3SimpleAttempt(context),
      ).toMatchObject({
        kind: "interrupted-before-response",
      });
    });
  });

  it("resumes after retry-decision is durable but attempt is not", async () => {
    await withAttemptRoot(async (attemptRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const context = attemptContext(attemptRoot, request);
      const prepared =
        await prepareC6SourceV3SimpleAttempt({
          context,
          request,
        });
      const started =
        await recordC6SourceV3SimpleResponseStarted({
          context,
          headers: SUCCESS_HEADERS,
          httpStatus: 503,
          receivedAt: "2026-07-26T12:00:01.000Z",
          requestCommitted: prepared.requestCommitted,
          secret: Buffer.from("secret-token"),
        });
      const completed =
        await recordC6SourceV3SimpleResponseComplete({
          body: Buffer.from("{\"message\":\"retry\"}"),
          context,
          responseStarted: started.responseStarted,
          secret: Buffer.from("secret-token"),
        });
      await completeC6SourceV3SimpleAttempt({
        context,
        decision: "retry",
        notBefore: "2026-07-26T12:00:02.000Z",
        reason: "retryable-http-status",
        requestCommitted: prepared.requestCommitted,
        responseComplete: completed.responseComplete,
        responseStarted: started.responseStarted,
        transportError: null,
      });
      await unlink(join(attemptRoot, "attempt.json"));
      await rename(
        join(attemptRoot, "retry-decision.json"),
        join(
          attemptRoot,
          ".retry-decision.json.ready",
        ),
      );

      expect(
        await inspectC6SourceV3SimpleAttempt(context),
      ).toMatchObject({
        kind: "finalize-attempt",
        outcome: "retry",
      });
      await finalizeC6SourceV3SimpleAttemptFromLedger(
        context,
      );
      expect(
        await inspectC6SourceV3SimpleAttempt(context),
      ).toMatchObject({
        kind: "committed",
        outcome: "retry",
      });
    });
  });

  it("persists a secret-free transport error and binds it into the attempt", async () => {
    await withAttemptRoot(async (attemptRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const context = attemptContext(attemptRoot, request);
      const prepared =
        await prepareC6SourceV3SimpleAttempt({
          context,
          request,
        });
      await expect(
        recordC6SourceV3SimpleTransportError({
          code: "ECONNRESET",
          context,
          message: "leaked secret-token",
          name: "Error",
          occurredAt: "2026-07-26T12:00:01.000Z",
          phase: "fetch",
          requestCommitted: prepared.requestCommitted,
          secret: Buffer.from("secret-token"),
        }),
      ).rejects.toBeInstanceOf(
        C6SourceV3SimpleSecretLeakError,
      );
      const recorded =
        await recordC6SourceV3SimpleTransportError({
          code: "ECONNRESET",
          context,
          message: "socket reset",
          name: "Error",
          occurredAt: "2026-07-26T12:00:01.000Z",
          phase: "fetch",
          requestCommitted: prepared.requestCommitted,
          secret: Buffer.from("secret-token"),
        });
      expect(
        await inspectC6SourceV3SimpleAttempt(context),
      ).toMatchObject({
        kind: "classify-local-transport-error",
      });
      await completeC6SourceV3SimpleAttempt({
        context,
        decision: "retry",
        notBefore: "2026-07-26T12:00:02.000Z",
        reason: "retryable-transport-code",
        requestCommitted: prepared.requestCommitted,
        responseComplete: null,
        responseStarted: null,
        transportError: recorded.transportError,
      });
      expect(
        await inspectC6SourceV3SimpleAttempt(context),
      ).toMatchObject({
        kind: "committed",
        outcome: "retry",
      });
    });
  });

  it("rejects a caller-supplied logical request identity hash", async () => {
    await withAttemptRoot(async (attemptRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const context = {
        ...attemptContext(attemptRoot, request),
        logicalRequestIdentitySha256: "f".repeat(64),
      };
      await expect(
        prepareC6SourceV3SimpleAttempt({
          context,
          request,
        }),
      ).rejects.toThrow("logical request identity");
    });
  });

  it("deletes uncommitted pending bytes and recovers only ready or final artifacts", async () => {
    await withAttemptRoot(async (attemptRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const context = attemptContext(attemptRoot, request);
      await mkdir(attemptRoot, {
        recursive: true,
      });
      await writeFile(
        join(attemptRoot, ".request.json.pending"),
        "{",
      );
      expect(
        await inspectC6SourceV3SimpleAttempt(context),
      ).toEqual({
        kind: "not-started",
      });
      expect(
        (await readdir(attemptRoot)).sort(),
      ).toEqual([]);

      await commitC6SourceV3SimpleCreateOnlyBytes(
        attemptRoot,
        "request-body.raw",
        request.body,
      );
      await link(
        join(attemptRoot, "request-body.raw"),
        join(
          attemptRoot,
          ".request-body.raw.pending",
        ),
      );
      expect(
        await inspectC6SourceV3SimpleAttempt(context),
      ).toEqual({
        kind: "not-started",
      });
      expect(
        (await readdir(attemptRoot)).sort(),
      ).toEqual([
        "request-body.raw",
      ]);
    });
  });

  it("deletes pending-only root publications and promotes ready publications", async () => {
    await withAttemptRoot(async (root) => {
      await mkdir(root, {
        recursive: true,
      });
      const names = [
        "activation-receipt.json",
        "asset-lock.json",
        "capture-claim.json",
        "capture-failure-terminal.json",
        "capture-terminal.json",
        "failure-evidence.json",
        "input-mutation-evidence.json",
        "local-replay-receipt-01.json",
        "local-replay-receipt-02.json",
        "normalized-capture.json",
        "terminal.json",
      ];
      for (const name of names) {
        await writeFile(
          join(root, `.${name}.pending`),
          `${name}\n`,
        );
      }

      await recoverC6SourceV3SimplePendingArtifacts(
        root,
      );

      expect(await readdir(root)).toEqual([]);
      for (const name of names) {
        await writeFile(
          join(root, `.${name}.ready`),
          `${name}\n`,
        );
      }
      await recoverC6SourceV3SimplePendingArtifacts(
        root,
      );

      expect((await readdir(root)).sort()).toEqual(
        names,
      );
    });
  });

  it("recovers known nested pending artifacts without deleting an unknown pending artifact", async () => {
    await withAttemptRoot(async (root) => {
      const nested = join(
        root,
        "pass-a",
        "logical-request-00000001",
        "attempt-01",
      );
      await mkdir(nested, {
        recursive: true,
      });
      const finalPath = join(
        nested,
        "response-started.json",
      );
      const readyPath = join(
        nested,
        ".response-started.json.ready",
      );
      await writeFile(finalPath, "{}\n");
      await link(finalPath, readyPath);

      await recoverC6SourceV3SimplePendingArtifactTree(
        root,
      );

      expect(
        await readFile(finalPath, "utf8"),
      ).toBe("{}\n");
      expect(
        await readFile(readyPath).catch(() => null),
      ).toBeNull();

      const unknownPending = join(
        nested,
        ".unknown.json.pending",
      );
      await writeFile(unknownPending, "{}\n");
      await expect(
        recoverC6SourceV3SimplePendingArtifactTree(
          root,
        ),
      ).rejects.toThrow("unknown pending");
      expect(
        await readFile(unknownPending, "utf8"),
      ).toBe("{}\n");
    });
  });

  it("rejects a known artifact name in the wrong nested ready path", async () => {
    await withAttemptRoot(async (root) => {
      const attemptRoot = join(
        root,
        "pass-a",
        "logical-request-00000001",
        "attempt-01",
      );
      await mkdir(attemptRoot, {
        recursive: true,
      });
      const readyPath = join(
        attemptRoot,
        ".terminal.json.ready",
      );
      await writeFile(readyPath, "{}\n");

      await expect(
        recoverC6SourceV3SimplePendingArtifactTree(
          root,
        ),
      ).rejects.toThrow("unknown ready");
      expect(
        await readFile(readyPath, "utf8"),
      ).toBe("{}\n");
    });
  });

  it("rejects a ready/final pair with different bytes", async () => {
    await withAttemptRoot(async (attemptRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const context = attemptContext(attemptRoot, request);
      await mkdir(attemptRoot, {
        recursive: true,
      });
      await writeFile(
        join(attemptRoot, "request-body.raw"),
        request.body,
      );
      await writeFile(
        join(
          attemptRoot,
          ".request-body.raw.ready",
        ),
        Buffer.from("different"),
      );

      await expect(
        inspectC6SourceV3SimpleAttempt(context),
      ).rejects.toThrow("ready");
    });
  });

  it("rejects an unknown pending artifact instead of promoting it", async () => {
    await withAttemptRoot(async (attemptRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const context = attemptContext(attemptRoot, request);
      await mkdir(attemptRoot, {
        recursive: true,
      });
      await writeFile(
        join(attemptRoot, ".mystery.json.pending"),
        "{}\n",
      );

      await expect(
        inspectC6SourceV3SimpleAttempt(context),
      ).rejects.toThrow("unknown pending");
      expect(
        await readFile(
          join(attemptRoot, "mystery.json"),
        ).catch(() => null),
      ).toBeNull();
    });
  });

  it("verifies marker references before publishing a dependent marker", async () => {
    await withAttemptRoot(async (attemptRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const context = attemptContext(attemptRoot, request);
      const prepared =
        await prepareC6SourceV3SimpleAttempt({
          context,
          request,
        });

      await expect(
        recordC6SourceV3SimpleResponseStarted({
          context,
          headers: {
            date: "Sun, 26 Jul 2026 12:00:00 GMT",
          },
          httpStatus: 200,
          receivedAt: "2026-07-26T12:00:01.000Z",
          requestCommitted: {
            ...prepared.requestCommitted,
            sha256: "f".repeat(64),
          },
          secret: Buffer.from("secret-token"),
        }),
      ).rejects.toThrow("artifact reference");
      expect(
        await readFile(
          join(attemptRoot, "response-started.json"),
        ).catch(() => null),
      ).toBeNull();
    });
  });

  it("promotes a ready-only response-started marker and prohibits redispatch", async () => {
    await withAttemptRoot(async (attemptRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const context = attemptContext(attemptRoot, request);
      const prepared =
        await prepareC6SourceV3SimpleAttempt({
          context,
          request,
        });
      await recordC6SourceV3SimpleResponseStarted({
        context,
        headers: {
          date: "Sun, 26 Jul 2026 12:00:00 GMT",
        },
        httpStatus: 200,
        receivedAt: "2026-07-26T12:00:01.000Z",
        requestCommitted: prepared.requestCommitted,
        secret: Buffer.from("secret-token"),
      });
      await rename(
        join(attemptRoot, "response-started.json"),
        join(
          attemptRoot,
          ".response-started.json.ready",
        ),
      );

      expect(
        await inspectC6SourceV3SimpleAttempt(context),
      ).toMatchObject({
        kind: "terminal-partial-response",
      });
      expect(
        await readdir(attemptRoot),
      ).toContain("response-started.json");
    });
  });

  it("publishes and independently replays a successful logical request chain", async () => {
    await withAttemptRoot(async (attemptRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const context = attemptContext(attemptRoot, request);
      const prepared =
        await prepareC6SourceV3SimpleAttempt({
          context,
          request,
        });
      const started =
        await recordC6SourceV3SimpleResponseStarted({
          context,
          headers: SUCCESS_HEADERS,
          httpStatus: 200,
          receivedAt: "2026-07-26T12:00:01.000Z",
          requestCommitted: prepared.requestCommitted,
          secret: Buffer.from("secret-token"),
        });
      const response =
        await recordC6SourceV3SimpleResponseComplete({
          body: repositoryCountResponse(0),
          context,
          responseStarted: started.responseStarted,
          secret: Buffer.from("secret-token"),
        });
      const completed =
        await completeC6SourceV3SimpleAttempt({
          context,
          decision: "stop-success",
          notBefore: null,
          reason: "graphql-success",
          requestCommitted: prepared.requestCommitted,
          responseComplete: response.responseComplete,
          responseStarted: started.responseStarted,
          transportError: null,
        });
      const passRoot = dirname(attemptRoot);
      const logicalRequestComplete =
        await writeC6SourceV3SimpleLogicalRequestComplete({
          assetRoot: passRoot,
          attempts: [{
            artifact: completed.attempt,
            attemptRoot,
          }],
          evaluationId: context.evaluationId,
          executionContractSha256:
            context.executionContractSha256,
          frozenInputClosureSha256:
            context.frozenInputClosureSha256,
          logicalRequestIdentitySha256:
            context.logicalRequestIdentitySha256,
          logicalRequestOrdinal:
            context.logicalRequestOrdinal,
          pass: context.pass,
          passRoot,
          priorLogicalRequestCompletionSha256:
            context
              .priorLogicalRequestCompletionSha256,
          runtimeAuthorizationSha256:
            context.runtimeAuthorizationSha256,
        });

      expect(logicalRequestComplete.path).toBe(
        "logical-request-complete-00000001.json",
      );
      expect(
        await verifyC6SourceV3SimpleLogicalRequestComplete(
          passRoot,
          logicalRequestComplete,
        ),
      ).toMatchObject({
        logicalRequestOrdinal: 1,
        successfulAttemptSha256:
          completed.attempt.sha256,
      });
      expect(
        await readC6SourceV3SimpleProjectedLogicalRequest(
          passRoot,
          logicalRequestComplete,
        ),
      ).toMatchObject({
        operationName:
          "C6SourceV3SimpleRepositoryCount",
        request: {
          bodySha256: request.bodySha256,
        },
        result: {
          repositoryCount: 0,
        },
      });
      for (const [index, bindings] of [
        {
          frozenInputClosureSha256: "d".repeat(64),
          runtimeAuthorizationSha256:
            context.runtimeAuthorizationSha256,
        },
        {
          frozenInputClosureSha256:
            context.frozenInputClosureSha256,
          runtimeAuthorizationSha256: "e".repeat(64),
        },
      ].entries()) {
        await expect(
          writeC6SourceV3SimpleLogicalRequestComplete({
            assetRoot: passRoot,
            attempts: [{
              artifact: completed.attempt,
              attemptRoot,
            }],
            evaluationId: context.evaluationId,
            executionContractSha256:
              context.executionContractSha256,
            ...bindings,
            logicalRequestIdentitySha256:
              context.logicalRequestIdentitySha256,
            logicalRequestOrdinal:
              context.logicalRequestOrdinal,
            pass: context.pass,
            passRoot: join(
              passRoot,
              `mutated-attempt-context-${index}`,
            ),
            priorLogicalRequestCompletionSha256:
              context
                .priorLogicalRequestCompletionSha256,
          }),
        ).rejects.toThrow("attempt chain");
      }
      expect(
        await writeC6SourceV3SimpleLogicalRequestComplete({
          assetRoot: passRoot,
          attempts: [{
            artifact: completed.attempt,
            attemptRoot,
          }],
          evaluationId: context.evaluationId,
          executionContractSha256:
            context.executionContractSha256,
          frozenInputClosureSha256:
            context.frozenInputClosureSha256,
          logicalRequestIdentitySha256:
            context.logicalRequestIdentitySha256,
          logicalRequestOrdinal:
            context.logicalRequestOrdinal,
          pass: context.pass,
          passRoot,
          priorLogicalRequestCompletionSha256:
            context
              .priorLogicalRequestCompletionSha256,
          runtimeAuthorizationSha256:
            context.runtimeAuthorizationSha256,
        }),
      ).toEqual(logicalRequestComplete);
      const projectedResultPath = join(
        passRoot,
        "logical-request-result-00000001.json",
      );
      const completionPath = join(
        passRoot,
        "logical-request-complete-00000001.json",
      );
      const originalProjectedResultBytes =
        await readFile(projectedResultPath);
      const originalCompletionBytes =
        await readFile(completionPath);
      for (const [field, value] of [
        [
          "frozenInputClosureSha256",
          "d".repeat(64),
        ],
        [
          "runtimeAuthorizationSha256",
          "e".repeat(64),
        ],
      ] as const) {
        const projectedResult = JSON.parse(
          originalProjectedResultBytes.toString("utf8"),
        ) as Record<string, unknown>;
        projectedResult[field] = value;
        const projectedResultBytes = Buffer.from(
          `${JSON.stringify(projectedResult, null, 2)}\n`,
        );
        await writeFile(
          projectedResultPath,
          projectedResultBytes,
        );
        const completion = JSON.parse(
          originalCompletionBytes.toString("utf8"),
        ) as {
          projectedResult: {
            bytes: number;
            path: string;
            sha256: string;
          };
        };
        completion.projectedResult = {
          ...completion.projectedResult,
          bytes: projectedResultBytes.length,
          sha256: sha256(projectedResultBytes),
        };
        const completionBytes = Buffer.from(
          `${JSON.stringify(completion, null, 2)}\n`,
        );
        await writeFile(
          completionPath,
          completionBytes,
        );

        await expect(
          verifyC6SourceV3SimpleLogicalRequestComplete(
            passRoot,
            {
              bytes: completionBytes.length,
              path:
                "logical-request-complete-00000001.json",
              sha256: sha256(completionBytes),
            },
          ),
        ).rejects.toThrow("projected result");
        await writeFile(
          projectedResultPath,
          originalProjectedResultBytes,
        );
        await writeFile(
          completionPath,
          originalCompletionBytes,
        );
      }
      await writeFile(
        join(attemptRoot, "attempt.json"),
        "{\"tampered\":true}\n",
      );
      await expect(
        verifyC6SourceV3SimpleLogicalRequestComplete(
          passRoot,
          logicalRequestComplete,
        ),
      ).rejects.toThrow();
    });
  });

  it("rejects impossible attempt outcomes before writing a retry decision", async () => {
    await withAttemptRoot(async (attemptRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const context = attemptContext(attemptRoot, request);
      const prepared =
        await prepareC6SourceV3SimpleAttempt({
          context,
          request,
        });
      const transportError =
        await recordC6SourceV3SimpleTransportError({
          code: "ECONNRESET",
          context,
          message: "socket reset",
          name: "Error",
          occurredAt: "2026-07-26T12:00:01.000Z",
          phase: "fetch",
          requestCommitted: prepared.requestCommitted,
          secret: Buffer.from("secret-token"),
        });

      await expect(
        completeC6SourceV3SimpleAttempt({
          context,
          decision: "stop-success",
          notBefore: null,
          reason: "graphql-success",
          requestCommitted: prepared.requestCommitted,
          responseComplete: null,
          responseStarted: null,
          transportError:
            transportError.transportError,
        }),
      ).rejects.toThrow("stop-success");
      await expect(
        completeC6SourceV3SimpleAttempt({
          context,
          decision: "retry",
          notBefore: "2026-07-26T12:00:02.000Z",
          reason:
            "secret-token" as "graphql-success",
          requestCommitted: prepared.requestCommitted,
          responseComplete: null,
          responseStarted: null,
          transportError:
            transportError.transportError,
        }),
      ).rejects.toThrow();
      expect(
        await readFile(
          join(attemptRoot, "retry-decision.json"),
        ).catch(() => null),
      ).toBeNull();
    });
    await withAttemptRoot(async (attemptRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const logicalRequestRoot = dirname(attemptRoot);
      let priorAttemptCommitSha256: string | null =
        null;
      for (
        let attemptNumber = 1;
        attemptNumber <= 4;
        attemptNumber += 1
      ) {
        const base = {
          attemptNumber,
          attemptRoot: join(
            logicalRequestRoot,
            `attempt-${
              String(attemptNumber).padStart(2, "0")
            }`,
          ),
          evaluationId:
            "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
          executionContractSha256: SHA_A,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA,
          logicalRequestOrdinal: 1,
          pass: "A" as const,
          priorAttemptCommitSha256,
          priorLogicalRequestCompletionSha256:
            SHA_ZERO,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA,
        };
        const context = {
          ...base,
          logicalRequestIdentitySha256:
            computeC6SourceV3SimpleLogicalRequestIdentitySha256({
              ...base,
              request,
            }),
        };
        const prepared =
          await prepareC6SourceV3SimpleAttempt({
            context,
            request,
          });
        const transportError =
          await recordC6SourceV3SimpleTransportError({
          code: "ECONNRESET",
          context,
          message: "socket reset",
          name: "Error",
          occurredAt: "2026-07-26T12:00:01.000Z",
          phase: "fetch",
          requestCommitted: prepared.requestCommitted,
          secret: Buffer.from("secret-token"),
        });
        const completion =
          completeC6SourceV3SimpleAttempt({
          context,
          decision: "retry",
          notBefore: [
            "2026-07-26T12:00:02.000Z",
            "2026-07-26T12:00:03.000Z",
            "2026-07-26T12:00:05.000Z",
          ][attemptNumber - 1] ??
            "2026-07-26T12:00:05.000Z",
          reason: "retryable-transport-code",
          requestCommitted: prepared.requestCommitted,
          responseComplete: null,
          responseStarted: null,
          transportError:
            transportError.transportError,
        });
        if (attemptNumber === 4) {
          await expect(completion).rejects.toThrow(
            "maximum",
          );
        } else {
          priorAttemptCommitSha256 = (
            await completion
          ).attempt.sha256;
        }
      }
    });
  });

  it("refuses to relabel a valid successful response as a retry", async () => {
    await withAttemptRoot(async (attemptRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const context = attemptContext(attemptRoot, request);
      const prepared =
        await prepareC6SourceV3SimpleAttempt({
          context,
          request,
        });
      const started =
        await recordC6SourceV3SimpleResponseStarted({
          context,
          headers: SUCCESS_HEADERS,
          httpStatus: 200,
          receivedAt: "2026-07-26T12:00:01.000Z",
          requestCommitted: prepared.requestCommitted,
          secret: Buffer.from("secret-token"),
        });
      const completed =
        await recordC6SourceV3SimpleResponseComplete({
          body: repositoryCountResponse(0),
          context,
          responseStarted: started.responseStarted,
          secret: Buffer.from("secret-token"),
        });

      await expect(
        completeC6SourceV3SimpleAttempt({
          context,
          decision: "retry",
          notBefore: "2026-07-26T12:00:02.000Z",
          reason: "retryable-graphql-errors",
          requestCommitted: prepared.requestCommitted,
          responseComplete: completed.responseComplete,
          responseStarted: started.responseStarted,
          transportError: null,
        }),
      ).rejects.toThrow("classification");
      expect(
        await readFile(
          join(attemptRoot, "retry-decision.json"),
        ).catch(() => null),
      ).toBeNull();
    });
  });

  it("returns the replayed terminal reason and rejects a missing prior retry attempt", async () => {
    await withAttemptRoot(async (unusedAttemptRoot) => {
      const assetRoot = dirname(unusedAttemptRoot);
      const logicalRequestRoot = join(
        assetRoot,
        "pass-a",
        "logical-request-00000001",
      );
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      let priorAttemptCommitSha256: string | null =
        null;
      let terminalAttempt:
        Awaited<
          ReturnType<
            typeof settleC6SourceV3SimpleAttemptFromLedger
          >
        >["attempt"] | null = null;
      for (
        let attemptNumber = 1;
        attemptNumber <= 4;
        attemptNumber += 1
      ) {
        const base = {
          attemptNumber,
          attemptRoot: join(
            logicalRequestRoot,
            `attempt-${
              String(attemptNumber).padStart(2, "0")
            }`,
          ),
          evaluationId:
            "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
          executionContractSha256: SHA_A,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA,
          logicalRequestOrdinal: 1,
          pass: "A" as const,
          priorAttemptCommitSha256,
          priorLogicalRequestCompletionSha256:
            SHA_ZERO,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA,
        };
        const context = {
          ...base,
          logicalRequestIdentitySha256:
            computeC6SourceV3SimpleLogicalRequestIdentitySha256({
              ...base,
              request,
            }),
        };
        const prepared =
          await prepareC6SourceV3SimpleAttempt({
            context,
            request,
          });
        await recordC6SourceV3SimpleTransportError({
          code: "ECONNRESET",
          context,
          message: "socket reset",
          name: "Error",
          occurredAt: "2026-07-26T12:00:01.000Z",
          phase: "fetch",
          requestCommitted: prepared.requestCommitted,
          secret: Buffer.from("secret-token"),
        });
        const settled =
          await settleC6SourceV3SimpleAttemptFromLedger(
            context,
          );
        if (attemptNumber < 4) {
          expect(settled.outcome).toBe("retry");
          priorAttemptCommitSha256 =
            settled.attempt.sha256;
        } else {
          expect(settled).toMatchObject({
            outcome: "stop-terminal",
            reason: "maximum-attempts-exhausted",
          });
          terminalAttempt = settled.attempt;
        }
      }
      const chainTip = {
        ...terminalAttempt!,
        path:
          "pass-a/logical-request-00000001/" +
          "attempt-04/attempt.json",
      };
      await expect(
        verifyC6SourceV3SimpleFailureChainTipMarker(
          assetRoot,
          chainTip,
        ),
      ).resolves.toMatchObject({
        artifactKind: "c6-source-v3-simple-attempt",
        reason: "maximum-attempts-exhausted",
      });

      await rm(
        join(logicalRequestRoot, "attempt-01"),
        { recursive: true },
      );
      await expect(
        verifyC6SourceV3SimpleFailureChainTipMarker(
          assetRoot,
          chainTip,
        ),
      ).rejects.toThrow("prior attempt");
    });
  });

  it("rejects every artifact path that can escape or alias its declared root", async () => {
    await withAttemptRoot(async (attemptRoot) => {
      const escaped = join(
        dirname(attemptRoot),
        "escaped.bin",
      );
      await expect(
        commitC6SourceV3SimpleCreateOnlyBytes(
          attemptRoot,
          "../escaped.bin",
          Buffer.from("escape"),
        ),
      ).rejects.toThrow("artifact name");
      await expect(
        commitC6SourceV3SimpleCreateOnlyBytes(
          attemptRoot,
          "/tmp/escaped.bin",
          Buffer.from("escape"),
        ),
      ).rejects.toThrow("artifact name");
      await expect(
        commitC6SourceV3SimpleCreateOnlyBytes(
          attemptRoot,
          "nested\\escaped.bin",
          Buffer.from("escape"),
        ),
      ).rejects.toThrow("artifact name");
      expect(
        await readFile(escaped).catch(() => null),
      ).toBeNull();
    });
  });
});

function attemptContext(
  attemptRoot: string,
  request: C6SourceV3SimpleDurableGraphqlRequest,
): C6SourceV3SimpleAttemptContext {
  const base = {
    attemptNumber: 1,
    attemptRoot,
    evaluationId:
      "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
    executionContractSha256: SHA_A,
    frozenInputClosureSha256:
      FROZEN_INPUT_CLOSURE_SHA,
    logicalRequestOrdinal: 1,
    pass: "A" as const,
    priorAttemptCommitSha256: null,
    priorLogicalRequestCompletionSha256: SHA_ZERO,
    runtimeAuthorizationSha256:
      RUNTIME_AUTHORIZATION_SHA,
  };
  return {
    ...base,
    logicalRequestIdentitySha256:
      computeC6SourceV3SimpleLogicalRequestIdentitySha256({
        ...base,
        request,
      }),
  };
}

function repositoryCountResponse(count: number): Buffer {
  return Buffer.from(JSON.stringify({
    data: {
      rateLimit: {
        cost: 1,
        limit: 5_000,
        remaining: 4_999,
        resetAt: "2026-07-26T13:00:00Z",
        used: 1,
      },
      search: {
        repositoryCount: count,
      },
    },
  }));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256")
    .update(bytes)
    .digest("hex");
}

async function withAttemptRoot(
  run: (attemptRoot: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(
    process.cwd(),
    ".goodmemory-c6-census-ledger-",
  ));
  const attemptRoot = join(root, "attempt-0001");
  try {
    await run(attemptRoot);
  } finally {
    await rm(root, {
      force: true,
      recursive: true,
    });
  }
}
