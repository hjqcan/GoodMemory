import {
  createHash,
} from "node:crypto";
import {
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  join,
} from "node:path";

import { describe, expect, it } from "bun:test";

import {
  computeC6SourceV3SimpleLogicalRequestIdentitySha256,
  completeC6SourceV3SimpleAttempt,
  prepareC6SourceV3SimpleAttempt,
  recordC6SourceV3SimpleProcessInterruption,
  recordC6SourceV3SimpleResponseComplete,
  recordC6SourceV3SimpleResponseStarted,
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
import {
  buildC6SourceV4BoundedFailureLedgerClosure,
  removeC6SourceV4BoundedEmptyPrecommitTailDirectories,
  scanC6SourceV4BoundedV3CommittedRequests,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-v3-runtime";

const EVALUATION_ID =
  "goodmemory-c6-codex-coding-effect-source-v3-simple-v1";
const EXECUTION_CONTRACT_SHA256 = "a".repeat(64);
const FROZEN_INPUT_CLOSURE_SHA256 = "b".repeat(64);
const RUNTIME_AUTHORIZATION_SHA256 = "c".repeat(64);
const ZERO_SHA256 = "0".repeat(64);
const SUCCESS_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  date: "Mon, 27 Jul 2026 13:00:00 GMT",
  "x-github-request-id": "ABC:123",
  "x-ratelimit-limit": "5000",
  "x-ratelimit-remaining": "4999",
  "x-ratelimit-reset": String(
    Date.parse("2026-07-27T14:00:00Z") / 1_000,
  ),
  "x-ratelimit-resource": "graphql",
  "x-ratelimit-used": "1",
};

describe("C6 source-v4 bounded v3 durable observation scan", () => {
  it("includes every committed PR request even when it has no response", async () => {
    await withPassRoot(async (passRoot) => {
      const first = await completeSuccessfulRequest({
        ordinal: 1,
        passRoot,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA256,
        request:
          buildC6SourceV3SimpleDurableGraphqlRequest({
            operation: "repositoryCount",
            variables: {
              query: "language:TypeScript",
            },
          }),
      });
      await prepareRequest({
        ordinal: 2,
        passRoot,
        priorLogicalRequestCompletionSha256:
          first.sha256,
        request:
          buildC6SourceV3SimpleDurableGraphqlRequest({
            operation: "pullRequestPage",
            variables: {
              after: null,
              repositoryNodeId: "R_in_flight",
            },
          }),
      });

      const result =
        await scanC6SourceV4BoundedV3CommittedRequests({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        });

      expect(result.requests).toHaveLength(2);
      expect(
        result.projectedRequests,
      ).toHaveLength(1);
      expect(
        result.completedLogicalRequestCount,
      ).toBe(1);
      expect(
        result.logicalRequestDirectoryCount,
      ).toBe(2);
      expect(
        result.inProgressLogicalRequestOrdinal,
      ).toBe(2);
      expect(
        result
          .finalLogicalRequestCompletionSha256,
      ).toBe(first.sha256);
      expect(
        result.committedRequestClosureSha256,
      ).toMatch(/^[a-f0-9]{64}$/u);
      expect(result.structureSha256).toMatch(
        /^[a-f0-9]{64}$/u,
      );
      expect(result.entries.map((entry) => ({
        attemptNumber: entry.attemptNumber,
        logicalRequestOrdinal:
          entry.logicalRequestOrdinal,
        operationName:
          entry.request.persistedRequest.operationName,
      }))).toEqual([
        {
          attemptNumber: 1,
          logicalRequestOrdinal: 1,
          operationName:
            "C6SourceV3SimpleRepositoryCount",
        },
        {
          attemptNumber: 1,
          logicalRequestOrdinal: 2,
          operationName:
            "C6SourceV3SimplePullRequestPage",
        },
      ]);
      const failureClosure =
        await buildC6SourceV4BoundedFailureLedgerClosure({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        });
      expect(failureClosure).toMatchObject({
        committedRequestAttemptCount: 2,
        committedRequestClosureSha256:
          result.committedRequestClosureSha256,
        completedLogicalRequestCount: 1,
        finalLogicalRequestCompletion: {
          path:
            "pass-a/logical-request-complete-00000001.json",
          sha256: first.sha256,
        },
        inProgressChainTip: {
          path:
            "pass-a/logical-request-00000002/attempt-01/request-committed.json",
          state: "request-committed",
        },
        inProgressLogicalRequestOrdinal: 2,
        logicalRequestDirectoryCount: 2,
        passAssetRootSha256:
          expect.stringMatching(
            /^[a-f0-9]{64}$/u,
          ),
        passStructureSha256:
          result.structureSha256,
      });
      const hiddenPath = join(
        passRoot,
        "hidden-tail.json",
      );
      await writeFile(hiddenPath, "{}");
      await expect(
        buildC6SourceV4BoundedFailureLedgerClosure({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).rejects.toThrow(
        "failure durable ledger exact pass-root entry set mismatch",
      );
      await rm(hiddenPath);
      await expect(
        scanC6SourceV4BoundedV3CommittedRequests({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          requireCompletePass: true,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).rejects.toThrow(
        "complete durable ledger",
      );
    });
  });

  it("binds a partial response as the exact failure chain tip", async () => {
    await withPassRoot(async (passRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "pullRequestPage",
          variables: {
            after: null,
            repositoryNodeId:
              "R_partial_response",
          },
        });
      const context = requestContext({
        ordinal: 1,
        passRoot,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA256,
        request,
      });
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
          receivedAt:
            "2026-07-27T13:00:01.000Z",
          requestCommitted:
            prepared.requestCommitted,
          secret: Buffer.from("secret-token"),
        });

      const closure =
        await buildC6SourceV4BoundedFailureLedgerClosure({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        });

      expect(closure).toMatchObject({
        committedRequestAttemptCount: 1,
        completedLogicalRequestCount: 0,
        inProgressChainTip: {
          ...started.responseStarted,
          path:
            "pass-a/logical-request-00000001/attempt-01/response-started.json",
          state: "response-started",
        },
        inProgressLogicalRequestOrdinal: 1,
        logicalRequestDirectoryCount: 1,
      });
    });
  });

  it("seals every exact precommit tail without claiming a committed request", async () => {
    for (
      const depth of [
        "pass",
        "logical",
        "attempt",
      ] as const
    ) {
      await withPassRoot(async (passRoot) => {
        if (depth !== "pass") {
          const logicalRoot = join(
            passRoot,
            "logical-request-00000001",
          );
          await mkdir(logicalRoot);
          if (depth === "attempt") {
            await mkdir(
              join(logicalRoot, "attempt-01"),
            );
          }
        }
        await removeC6SourceV4BoundedEmptyPrecommitTailDirectories(
          passRoot,
        );
        await expect(
          lstat(passRoot),
        ).rejects.toMatchObject({
          code: "ENOENT",
        });
        expect(
          await buildC6SourceV4BoundedFailureLedgerClosure({
            evaluationId: EVALUATION_ID,
            executionContractSha256:
              EXECUTION_CONTRACT_SHA256,
            frozenInputClosureSha256:
              FROZEN_INPUT_CLOSURE_SHA256,
            passRoot,
            runtimeAuthorizationSha256:
              RUNTIME_AUTHORIZATION_SHA256,
          }),
        ).toMatchObject({
          committedRequestAttemptCount: 0,
          inProgressChainTip: null,
          logicalRequestDirectoryCount: 0,
        });
      });
    }
    const cases = [
      {
        files: ["request-body.raw"] as const,
        path:
          "pass-a/logical-request-00000001/attempt-01/request-body.raw",
        state: "precommit-request-body",
      },
      {
        files: [
          "request-body.raw",
          "request.json",
        ] as const,
        path:
          "pass-a/logical-request-00000001/attempt-01/request.json",
        state: "precommit-request",
      },
    ] as const;

    for (const value of cases) {
      await withPassRoot(async (passRoot) => {
        const request =
          buildC6SourceV3SimpleDurableGraphqlRequest({
            operation: "repositoryCount",
            variables: {
              query: "language:TypeScript",
            },
          });
        const attemptRoot = join(
          passRoot,
          "logical-request-00000001",
          "attempt-01",
        );
        await mkdir(attemptRoot, {
          recursive: true,
        });
        if (
          value.files.some(
            (file) =>
              file === "request-body.raw",
          )
        ) {
          await writeFile(
            join(
              attemptRoot,
              "request-body.raw",
            ),
            request.body,
          );
        }
        if (
          value.files.some(
            (file) => file === "request.json",
          )
        ) {
          await writeFile(
            join(attemptRoot, "request.json"),
            canonicalJson(
              request.persistedRequest,
            ),
          );
        }

        const closure =
          await buildC6SourceV4BoundedFailureLedgerClosure({
            evaluationId: EVALUATION_ID,
            executionContractSha256:
              EXECUTION_CONTRACT_SHA256,
            frozenInputClosureSha256:
              FROZEN_INPUT_CLOSURE_SHA256,
            passRoot,
            runtimeAuthorizationSha256:
              RUNTIME_AUTHORIZATION_SHA256,
          });

        expect(closure).toMatchObject({
          committedRequestAttemptCount: 0,
          completedLogicalRequestCount: 0,
          inProgressChainTip: {
            bytes: expect.any(Number),
            path: value.path,
            sha256:
              expect.stringMatching(
                /^[a-f0-9]{64}$/u,
              ),
            state: value.state,
          },
          inProgressLogicalRequestOrdinal: 1,
          logicalRequestDirectoryCount: 1,
          passAssetRootSha256:
            expect.stringMatching(
              /^[a-f0-9]{64}$/u,
            ),
          passStructureSha256:
            expect.stringMatching(
              /^[a-f0-9]{64}$/u,
            ),
        });
      });
    }
  });

  it("strict success mode rejects an unknown pass-root entry", async () => {
    await withPassRoot(async (passRoot) => {
      await completeSuccessfulRequest({
        ordinal: 1,
        passRoot,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA256,
        request:
          buildC6SourceV3SimpleDurableGraphqlRequest({
            operation: "repositoryCount",
            variables: {
              query: "language:TypeScript",
            },
          }),
      });
      await writeFile(
        join(passRoot, "unexpected.json"),
        "{}\n",
      );

      await expect(
        scanC6SourceV4BoundedV3CommittedRequests({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          requireCompletePass: true,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).rejects.toThrow(
        "exact pass-root entry set",
      );
    });
  });

  it("rejects a committed request outside the logical-request completion chain", async () => {
    await withPassRoot(async (passRoot) => {
      await completeSuccessfulRequest({
        ordinal: 1,
        passRoot,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA256,
        request:
          buildC6SourceV3SimpleDurableGraphqlRequest({
            operation: "repositoryCount",
            variables: {
              query: "language:TypeScript",
            },
          }),
      });
      await prepareRequest({
        ordinal: 2,
        passRoot,
        priorLogicalRequestCompletionSha256:
          "d".repeat(64),
        request:
          buildC6SourceV3SimpleDurableGraphqlRequest({
            operation: "pullRequestPage",
            variables: {
              after: null,
              repositoryNodeId: "R_detached",
            },
          }),
      });

      await expect(
        scanC6SourceV4BoundedV3CommittedRequests({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).rejects.toThrow(
        "logical request completion chain mismatch",
      );
    });
  });

  it("rejects arbitrary logical-request completion bytes", async () => {
    await withPassRoot(async (passRoot) => {
      await prepareRequest({
        ordinal: 1,
        passRoot,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA256,
        request:
          buildC6SourceV3SimpleDurableGraphqlRequest({
            operation: "repositoryCount",
            variables: {
              query: "language:TypeScript",
            },
          }),
      });
      await writeFile(
        join(
          passRoot,
          "logical-request-complete-00000001.json",
        ),
        "{}\n",
      );
      await prepareRequest({
        ordinal: 2,
        passRoot,
        priorLogicalRequestCompletionSha256:
          sha256(Buffer.from("{}\n")),
        request:
          buildC6SourceV3SimpleDurableGraphqlRequest({
            operation: "pullRequestPage",
            variables: {
              after: null,
              repositoryNodeId: "R_detached",
            },
          }),
      });

      await expect(
        scanC6SourceV4BoundedV3CommittedRequests({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).rejects.toThrow(
        "logical request completion is invalid",
      );
    });
  });

  it("rejects a schema-valid completion without real response and projected-result evidence", async () => {
    await withPassRoot(async (passRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const context = requestContext({
        ordinal: 1,
        passRoot,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA256,
        request,
      });
      const attemptRoot = await prepareRequest({
        ordinal: 1,
        passRoot,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA256,
        request,
      });
      const requestCommittedBytes =
        await readFile(
          join(
            attemptRoot,
            "request-committed.json",
          ),
        );
      const retryDecisionBytes =
        Buffer.from("{}\n");
      await writeFile(
        join(attemptRoot, "retry-decision.json"),
        retryDecisionBytes,
      );
      const attempt = {
        artifactKind:
          "c6-source-v3-simple-attempt",
        attemptNumber: 1,
        evaluationId: context.evaluationId,
        executionContractSha256:
          context.executionContractSha256,
        frozenInputClosureSha256:
          context.frozenInputClosureSha256,
        logicalRequestIdentitySha256:
          context.logicalRequestIdentitySha256,
        logicalRequestOrdinal: 1,
        outcome: "stop-success",
        pass: "A",
        priorAttemptCommitSha256: null,
        requestCommitted: artifactReference(
          "request-committed.json",
          requestCommittedBytes,
        ),
        responseComplete: null,
        responseStarted: null,
        retryDecision: artifactReference(
          "retry-decision.json",
          retryDecisionBytes,
        ),
        runtimeAuthorizationSha256:
          context.runtimeAuthorizationSha256,
        schemaVersion: 1,
        transportError: null,
      };
      const attemptBytes =
        Buffer.from(canonicalJson(attempt));
      await writeFile(
        join(attemptRoot, "attempt.json"),
        attemptBytes,
      );
      const projectedResultBytes =
        Buffer.from("{}\n");
      await writeFile(
        join(
          passRoot,
          "logical-request-result-00000001.json",
        ),
        projectedResultBytes,
      );
      await writeFile(
        join(
          passRoot,
          "logical-request-complete-00000001.json",
        ),
        canonicalJson({
          artifactKind:
            "c6-source-v3-simple-logical-request-complete",
          attempts: [{
            artifact: artifactReference(
              "pass-a/logical-request-00000001/attempt-01/attempt.json",
              attemptBytes,
            ),
            attemptNumber: 1,
          }],
          evaluationId: context.evaluationId,
          executionContractSha256:
            context.executionContractSha256,
          frozenInputClosureSha256:
            context.frozenInputClosureSha256,
          logicalRequestIdentitySha256:
            context.logicalRequestIdentitySha256,
          logicalRequestOrdinal: 1,
          operationName:
            "C6SourceV3SimpleRepositoryCount",
          pass: "A",
          priorLogicalRequestCompletionSha256:
            ZERO_SHA256,
          projectedResult: artifactReference(
            "pass-a/logical-request-result-00000001.json",
            projectedResultBytes,
          ),
          runtimeAuthorizationSha256:
            context.runtimeAuthorizationSha256,
          schemaVersion: 1,
          successfulAttemptSha256:
            sha256(attemptBytes),
        }),
      );

      await expect(
        scanC6SourceV4BoundedV3CommittedRequests({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).rejects.toThrow(
        "attempt ledger is corrupt",
      );
    });
  });

  it("rejects a retry detached from the prior committed attempt", async () => {
    await withPassRoot(async (passRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "pullRequestPage",
          variables: {
            after: null,
            repositoryNodeId: "R_retry",
          },
        });
      const firstContext = attemptContext({
        attemptNumber: 1,
        passRoot,
        priorAttemptCommitSha256: null,
        request,
      });
      const first =
        await prepareC6SourceV3SimpleAttempt({
          context: firstContext,
          request,
        });
      const interrupted =
        await recordC6SourceV3SimpleProcessInterruption({
          context: firstContext,
          occurredAt: "2026-07-27T13:00:00.000Z",
          requestCommitted: first.requestCommitted,
        });
      const completed =
        await completeC6SourceV3SimpleAttempt({
          context: firstContext,
          decision: "retry",
          notBefore: "2026-07-27T13:00:01.000Z",
          reason:
            "process-interruption-before-response",
          requestCommitted: first.requestCommitted,
          responseComplete: null,
          responseStarted: null,
          transportError:
            interrupted.transportError,
        });
      const secondContext = attemptContext({
        attemptNumber: 2,
        passRoot,
        priorAttemptCommitSha256:
          completed.attempt.sha256,
        request,
      });
      const second =
        await prepareC6SourceV3SimpleAttempt({
          context: secondContext,
          request,
        });
      const committedPath = join(
        secondContext.attemptRoot,
        second.requestCommitted.path,
      );
      const committed = JSON.parse(
        await readFile(committedPath, "utf8"),
      ) as Record<string, unknown>;
      committed.priorAttemptCommitSha256 =
        "e".repeat(64);
      await writeFile(
        committedPath,
        `${JSON.stringify(committed, null, 2)}\n`,
      );

      await expect(
        scanC6SourceV4BoundedV3CommittedRequests({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).rejects.toThrow("attempt chain mismatch");
    });
  });

  it("accepts an incomplete result only for an exact stop-success projection", async () => {
    await withPassRoot(async (passRoot) => {
      await prepareRequest({
        ordinal: 1,
        passRoot,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA256,
        request:
          buildC6SourceV3SimpleDurableGraphqlRequest({
            operation: "repositoryCount",
            variables: {
              query: "language:TypeScript",
            },
          }),
      });
      await writeFile(
        join(
          passRoot,
          "logical-request-result-00000001.json",
        ),
        "{}\n",
      );

      await expect(
        buildC6SourceV4BoundedFailureLedgerClosure({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).rejects.toThrow("stop-success");
    });

    await withPassRoot(async (passRoot) => {
      await completeTerminalAttempt({
        ordinal: 1,
        passRoot,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA256,
        request:
          buildC6SourceV3SimpleDurableGraphqlRequest({
            operation: "repositoryCount",
            variables: {
              query: "language:TypeScript",
            },
          }),
      });
      await writeFile(
        join(
          passRoot,
          "logical-request-result-00000001.json",
        ),
        "{}\n",
      );

      await expect(
        buildC6SourceV4BoundedFailureLedgerClosure({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).rejects.toThrow("stop-success");
    });

    await withPassRoot(async (passRoot) => {
      await completeSuccessfulRequest({
        ordinal: 1,
        passRoot,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA256,
        request:
          buildC6SourceV3SimpleDurableGraphqlRequest({
            operation: "repositoryCount",
            variables: {
              query: "language:TypeScript",
            },
          }),
      });
      await rm(join(
        passRoot,
        "logical-request-complete-00000001.json",
      ));

      expect(
        await buildC6SourceV4BoundedFailureLedgerClosure({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).toMatchObject({
        inProgressChainTip: {
          path:
            "pass-a/logical-request-result-00000001.json",
          sha256:
            expect.stringMatching(
              /^[a-f0-9]{64}$/u,
            ),
          state: "projected-result",
        },
      });
      await writeFile(
        join(
          passRoot,
          "logical-request-result-00000001.json",
        ),
        "{}\n",
      );
      await expect(
        buildC6SourceV4BoundedFailureLedgerClosure({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).rejects.toThrow("projected result");
    });

    await withPassRoot(async (passRoot) => {
      await completeSuccessfulRequest({
        ordinal: 1,
        passRoot,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA256,
        request:
          buildC6SourceV3SimpleDurableGraphqlRequest({
            operation: "repositoryCount",
            variables: {
              query: "language:TypeScript",
            },
          }),
      });
      await Promise.all([
        rm(join(
          passRoot,
          "logical-request-complete-00000001.json",
        )),
        rm(join(
          passRoot,
          "logical-request-result-00000001.json",
        )),
      ]);

      expect(
        await buildC6SourceV4BoundedFailureLedgerClosure({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).toMatchObject({
        inProgressChainTip: {
          state: "attempt-stop-success",
        },
      });
    });
  });

  it("replays prior retry classification before sealing an incomplete tail", async () => {
    await withPassRoot(async (passRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const firstContext = attemptContext({
        attemptNumber: 1,
        passRoot,
        priorAttemptCommitSha256: null,
        request,
      });
      const first =
        await prepareC6SourceV3SimpleAttempt({
          context: firstContext,
          request,
        });
      const interrupted =
        await recordC6SourceV3SimpleProcessInterruption({
          context: firstContext,
          occurredAt:
            "2026-07-27T13:00:00.000Z",
          requestCommitted:
            first.requestCommitted,
        });
      const completed =
        await completeC6SourceV3SimpleAttempt({
          context: firstContext,
          decision: "retry",
          notBefore:
            "2026-07-27T13:00:01.000Z",
          reason:
            "process-interruption-before-response",
          requestCommitted:
            first.requestCommitted,
          responseComplete: null,
          responseStarted: null,
          transportError:
            interrupted.transportError,
        });
      const transportPath = join(
        firstContext.attemptRoot,
        "transport-error.json",
      );
      const transport = JSON.parse(
        await readFile(transportPath, "utf8"),
      ) as Record<string, unknown>;
      transport.code = "EACCES";
      transport.name = "Error";
      transport.phase = "fetch";
      const transportBytes =
        Buffer.from(canonicalJson(transport));
      await writeFile(
        transportPath,
        transportBytes,
      );
      const decisionPath = join(
        firstContext.attemptRoot,
        "retry-decision.json",
      );
      const decision = JSON.parse(
        await readFile(decisionPath, "utf8"),
      ) as Record<string, unknown>;
      decision.basisArtifactSha256 =
        sha256(transportBytes);
      const decisionBytes =
        Buffer.from(canonicalJson(decision));
      await writeFile(
        decisionPath,
        decisionBytes,
      );
      const attemptPath = join(
        firstContext.attemptRoot,
        completed.attempt.path,
      );
      const attempt = JSON.parse(
        await readFile(attemptPath, "utf8"),
      ) as Record<string, unknown>;
      attempt.retryDecision =
        artifactReference(
          "retry-decision.json",
          decisionBytes,
        );
      attempt.transportError =
        artifactReference(
          "transport-error.json",
          transportBytes,
        );
      const attemptBytes =
        Buffer.from(canonicalJson(attempt));
      await writeFile(attemptPath, attemptBytes);
      const secondContext = attemptContext({
        attemptNumber: 2,
        passRoot,
        priorAttemptCommitSha256:
          sha256(attemptBytes),
        request,
      });
      await prepareC6SourceV3SimpleAttempt({
        context: secondContext,
        request,
      });

      await expect(
        buildC6SourceV4BoundedFailureLedgerClosure({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).rejects.toThrow(
        "attempt classification mismatch",
      );
    });
  });

  it("replays a durable retry decision before sealing its pre-attempt crash state", async () => {
    await withPassRoot(async (passRoot) => {
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: "language:TypeScript",
          },
        });
      const context = requestContext({
        ordinal: 1,
        passRoot,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA256,
        request,
      });
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
          receivedAt:
            "2026-07-27T13:00:01.000Z",
          requestCommitted:
            prepared.requestCommitted,
          secret: Buffer.from("secret-token"),
        });
      const response =
        await recordC6SourceV3SimpleResponseComplete({
          body: repositoryCountResponse(0),
          context,
          responseStarted:
            started.responseStarted,
          secret: Buffer.from("secret-token"),
        });
      const completed =
        await completeC6SourceV3SimpleAttempt({
          context,
          decision: "stop-success",
          notBefore: null,
          reason: "graphql-success",
          requestCommitted:
            prepared.requestCommitted,
          responseComplete:
            response.responseComplete,
          responseStarted:
            started.responseStarted,
          transportError: null,
        });
      await rm(join(
        context.attemptRoot,
        completed.attempt.path,
      ));

      expect(
        await buildC6SourceV4BoundedFailureLedgerClosure({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).toMatchObject({
        inProgressChainTip: {
          path:
            "pass-a/logical-request-00000001/attempt-01/retry-decision.json",
          state: "retry-decision",
        },
      });

      const decisionPath = join(
        context.attemptRoot,
        completed.retryDecision.path,
      );
      const decision = JSON.parse(
        await readFile(decisionPath, "utf8"),
      ) as Record<string, unknown>;
      decision.decision = "stop-terminal";
      decision.reason = "terminal-http-status";
      await writeFile(
        decisionPath,
        canonicalJson(decision),
      );
      await expect(
        buildC6SourceV4BoundedFailureLedgerClosure({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).rejects.toThrow(
        "attempt ledger is corrupt",
      );
    });
  });

  it("rejects request mutation and response evidence without a committed request", async () => {
    await withPassRoot(async (passRoot) => {
      const attemptRoot = await prepareRequest({
        ordinal: 1,
        passRoot,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA256,
        request:
          buildC6SourceV3SimpleDurableGraphqlRequest({
            operation: "pullRequestPage",
            variables: {
              after: null,
              repositoryNodeId: "R_pilot",
            },
          }),
      });
      await writeFile(
        join(attemptRoot, "request.json"),
        "{}\n",
      );
      await expect(
        scanC6SourceV4BoundedV3CommittedRequests({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).rejects.toThrow("artifact reference mismatch");
    });

    await withPassRoot(async (passRoot) => {
      const attemptRoot = join(
        passRoot,
        "logical-request-00000001",
        "attempt-01",
      );
      await mkdir(attemptRoot, { recursive: true });
      await writeFile(
        join(attemptRoot, "response-started.json"),
        "{}\n",
      );
      await expect(
        scanC6SourceV4BoundedV3CommittedRequests({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).rejects.toThrow(
        "response evidence without request-committed",
      );
    });
  });

  it("rejects a symlinked logical request instead of omitting it from the exclusion scan", async () => {
    await withPassRoot(async (passRoot) => {
      await symlink(
        passRoot,
        join(
          passRoot,
          "logical-request-00000001",
        ),
      );
      await expect(
        scanC6SourceV4BoundedV3CommittedRequests({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).rejects.toThrow("rejects symlink");
    });
  });

  it("rejects hard-linked request artifacts", async () => {
    await withPassRoot(async (passRoot) => {
      const attemptRoot = await prepareRequest({
        ordinal: 1,
        passRoot,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA256,
        request:
          buildC6SourceV3SimpleDurableGraphqlRequest({
            operation: "pullRequestPage",
            variables: {
              after: null,
              repositoryNodeId: "R_pilot",
            },
          }),
      });
      await link(
        join(attemptRoot, "request.json"),
        join(passRoot, "request-hardlink-copy.json"),
      );
      await expect(
        scanC6SourceV4BoundedV3CommittedRequests({
          evaluationId: EVALUATION_ID,
          executionContractSha256:
            EXECUTION_CONTRACT_SHA256,
          frozenInputClosureSha256:
            FROZEN_INPUT_CLOSURE_SHA256,
          passRoot,
          runtimeAuthorizationSha256:
            RUNTIME_AUTHORIZATION_SHA256,
        }),
      ).rejects.toThrow("non-hard-linked");
    });
  });
});

async function prepareRequest(input: {
  ordinal: number;
  passRoot: string;
  priorLogicalRequestCompletionSha256: string;
  request: C6SourceV3SimpleDurableGraphqlRequest;
}): Promise<string> {
  const context = requestContext(input);
  await prepareC6SourceV3SimpleAttempt({
    context,
    request: input.request,
  });
  return context.attemptRoot;
}

async function completeSuccessfulRequest(input: {
  ordinal: number;
  passRoot: string;
  priorLogicalRequestCompletionSha256: string;
  request: C6SourceV3SimpleDurableGraphqlRequest;
}): Promise<{ sha256: string }> {
  const context = requestContext(input);
  const prepared =
    await prepareC6SourceV3SimpleAttempt({
      context,
      request: input.request,
    });
  const started =
    await recordC6SourceV3SimpleResponseStarted({
      context,
      headers: SUCCESS_HEADERS,
      httpStatus: 200,
      receivedAt: "2026-07-27T13:00:01.000Z",
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
  return await writeC6SourceV3SimpleLogicalRequestComplete({
    assetRoot: dirname(input.passRoot),
    attempts: [{
      artifact: completed.attempt,
      attemptRoot: context.attemptRoot,
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
    passRoot: input.passRoot,
    priorLogicalRequestCompletionSha256:
      context.priorLogicalRequestCompletionSha256,
    runtimeAuthorizationSha256:
      context.runtimeAuthorizationSha256,
  });
}

async function completeTerminalAttempt(input: {
  ordinal: number;
  passRoot: string;
  priorLogicalRequestCompletionSha256: string;
  request: C6SourceV3SimpleDurableGraphqlRequest;
}): Promise<void> {
  const context = requestContext(input);
  const prepared =
    await prepareC6SourceV3SimpleAttempt({
      context,
      request: input.request,
    });
  const started =
    await recordC6SourceV3SimpleResponseStarted({
      context,
      headers: SUCCESS_HEADERS,
      httpStatus: 400,
      receivedAt: "2026-07-27T13:00:01.000Z",
      requestCommitted:
        prepared.requestCommitted,
      secret: Buffer.from("secret-token"),
    });
  const response =
    await recordC6SourceV3SimpleResponseComplete({
      body: Buffer.from("{}"),
      context,
      responseStarted:
        started.responseStarted,
      secret: Buffer.from("secret-token"),
    });
  await completeC6SourceV3SimpleAttempt({
    context,
    decision: "stop-terminal",
    notBefore: null,
    reason: "terminal-http-status",
    requestCommitted:
      prepared.requestCommitted,
    responseComplete:
      response.responseComplete,
    responseStarted:
      started.responseStarted,
    transportError: null,
  });
}

function requestContext(input: {
  ordinal: number;
  passRoot: string;
  priorLogicalRequestCompletionSha256: string;
  request: C6SourceV3SimpleDurableGraphqlRequest;
}): C6SourceV3SimpleAttemptContext {
  return {
    attemptNumber: 1,
    attemptRoot: join(
      input.passRoot,
      `logical-request-${
        String(input.ordinal).padStart(8, "0")
      }`,
      "attempt-01",
    ),
    evaluationId: EVALUATION_ID,
    executionContractSha256:
      EXECUTION_CONTRACT_SHA256,
    frozenInputClosureSha256:
      FROZEN_INPUT_CLOSURE_SHA256,
    logicalRequestIdentitySha256:
      computeC6SourceV3SimpleLogicalRequestIdentitySha256({
        evaluationId: EVALUATION_ID,
        executionContractSha256:
          EXECUTION_CONTRACT_SHA256,
        frozenInputClosureSha256:
          FROZEN_INPUT_CLOSURE_SHA256,
        logicalRequestOrdinal: input.ordinal,
        pass: "A",
        request: input.request,
        runtimeAuthorizationSha256:
          RUNTIME_AUTHORIZATION_SHA256,
      }),
    logicalRequestOrdinal: input.ordinal,
    pass: "A",
    priorAttemptCommitSha256: null,
    priorLogicalRequestCompletionSha256:
      input.priorLogicalRequestCompletionSha256,
    runtimeAuthorizationSha256:
      RUNTIME_AUTHORIZATION_SHA256,
  };
}

function attemptContext(input: {
  attemptNumber: number;
  passRoot: string;
  priorAttemptCommitSha256: string | null;
  request: C6SourceV3SimpleDurableGraphqlRequest;
}): C6SourceV3SimpleAttemptContext {
  return {
    attemptNumber: input.attemptNumber,
    attemptRoot: join(
      input.passRoot,
      "logical-request-00000001",
      `attempt-${
        String(input.attemptNumber).padStart(2, "0")
      }`,
    ),
    evaluationId: EVALUATION_ID,
    executionContractSha256:
      EXECUTION_CONTRACT_SHA256,
    frozenInputClosureSha256:
      FROZEN_INPUT_CLOSURE_SHA256,
    logicalRequestIdentitySha256:
      computeC6SourceV3SimpleLogicalRequestIdentitySha256({
        evaluationId: EVALUATION_ID,
        executionContractSha256:
          EXECUTION_CONTRACT_SHA256,
        frozenInputClosureSha256:
          FROZEN_INPUT_CLOSURE_SHA256,
        logicalRequestOrdinal: 1,
        pass: "A",
        request: input.request,
        runtimeAuthorizationSha256:
          RUNTIME_AUTHORIZATION_SHA256,
      }),
    logicalRequestOrdinal: 1,
    pass: "A",
    priorAttemptCommitSha256:
      input.priorAttemptCommitSha256,
    priorLogicalRequestCompletionSha256:
      ZERO_SHA256,
    runtimeAuthorizationSha256:
      RUNTIME_AUTHORIZATION_SHA256,
  };
}

async function withPassRoot(
  run: (passRoot: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(
    process.cwd(),
    ".goodmemory-c6-v4-v3-runtime-",
  ));
  const passRoot = join(root, "pass-a");
  await mkdir(passRoot);
  try {
    await run(passRoot);
  } finally {
    await rm(root, {
      force: true,
      recursive: true,
    });
  }
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function artifactReference(
  path: string,
  bytes: Uint8Array,
) {
  return {
    bytes: bytes.length,
    path,
    sha256: sha256(bytes),
  };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function repositoryCountResponse(count: number): Buffer {
  return Buffer.from(JSON.stringify({
    data: {
      rateLimit: {
        cost: 1,
        limit: 5_000,
        remaining: 4_999,
        resetAt: "2026-07-27T14:00:00Z",
        used: 1,
      },
      search: {
        repositoryCount: count,
      },
    },
  }));
}
