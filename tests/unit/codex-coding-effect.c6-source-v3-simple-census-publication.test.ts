import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  writeC6SourceV3SimplePassArtifactBundle,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-artifacts";
import {
  C6SourceV3SimpleTwoPassMismatchError,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-errors";
import type {
  C6SourceV3SimpleFrameDefinition,
  C6SourceV3SimpleNormalizedPass,
  C6SourceV3SimpleRootShard,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-core";
import {
  writeC6SourceV3SimpleCensusAssetLock,
  writeC6SourceV3SimpleFrozenInputClosure,
  writeC6SourceV3SimpleFrozenInputMutationEvidence,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-finalization";
import {
  commitC6SourceV3SimpleCreateOnlyBytes,
  completeC6SourceV3SimpleAttempt,
  computeC6SourceV3SimpleLogicalRequestIdentitySha256,
  prepareC6SourceV3SimpleAttempt,
  recordC6SourceV3SimpleResponseComplete,
  recordC6SourceV3SimpleResponseStarted,
  recordC6SourceV3SimpleTransportError,
  settleC6SourceV3SimpleAttemptFromLedger,
  writeC6SourceV3SimpleLogicalRequestComplete,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-ledger";
import {
  buildC6SourceV3SimpleDurableGraphqlRequest,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-transport";
import {
  assertC6SourceV3SimpleVerifiedPassProjectionMismatch,
  assertC6SourceV3SimpleVerifiedPassProjectionEquality,
  commitC6SourceV3SimpleTwoPassEqualityReceiptAfterPassValidation,
  hashC6SourceV3SimpleAttemptLedgerRoot,
  parseC6SourceV3SimpleTerminal,
  resumeC6SourceV3SimpleTerminalFromAssetLock,
  verifyC6SourceV3SimplePublicationOutcome,
  verifyC6SourceV3SimpleTerminalClosure,
  writeC6SourceV3SimpleCensusReceipt,
  writeC6SourceV3SimpleFailureEvidence,
  writeC6SourceV3SimplePassComplete,
  writeC6SourceV3SimpleTerminal,
  writeC6SourceV3SimpleTwoPassEqualityReceipt,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-publication";
import {
  createC6SourceV3SimpleTestExpectedFrozenInputs,
} from "./codex-coding-effect.c6-source-v3-simple-census-test-support";

const CONTRACT_SHA = "a".repeat(64);
const ZERO_SHA = "0".repeat(64);
const FIXTURE_BYTES = Buffer.from("abc");
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
const FROZEN_INPUTS = [{
  bytes: FIXTURE_BYTES.length,
  label: "fixture",
  path: "fixture.json",
  sha256: createHash("sha256")
    .update(FIXTURE_BYTES)
    .digest("hex"),
}];
const EXPECTED_FROZEN_INPUTS =
  createC6SourceV3SimpleTestExpectedFrozenInputs({
  evaluationId:
    "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
  executionContractSha256: CONTRACT_SHA,
  frozenInputs: FROZEN_INPUTS,
  });
const INPUT_SHA =
  EXPECTED_FROZEN_INPUTS.inputClosureSha256;
const ROOT_SHARD: C6SourceV3SimpleRootShard = {
  createdFrom: "2020-01-01T00:00:00Z",
  createdTo: "2020-01-01T00:00:03Z",
  language: "TypeScript",
  query:
    "language:TypeScript " +
    "created:2020-01-01T00:00:00Z..2020-01-01T00:00:03Z " +
    "pushed:>=2024-01-01 is:public archived:false " +
    "mirror:false template:false",
  rootShardId: "ts:2020-01-01",
  split: "ts",
};
const ROOT_SHARDS = [
  ROOT_SHARD,
  ...Array.from({ length: 1_535 }, (_, index) => ({
    ...ROOT_SHARD,
    rootShardId:
      `zz:test-${String(index).padStart(4, "0")}`,
  })),
];
const FRAME: C6SourceV3SimpleFrameDefinition = {
  frozenPreWave3AnchorExclusions: [],
  frozenPreWave3RepositoryExclusions: [],
  priorRepositoryAliases: [],
  priorRepositoryNodeIds: [],
  rootShards: ROOT_SHARDS,
};
describe("C6 source-v3-simple pass and terminal publication", () => {
  it("types only a verified projection mismatch and keeps corrupt passes before authorization", async () => {
    const passBComplete = {
      bytes: 123,
      path: "pass-b/pass-complete.json",
      sha256: "b".repeat(64),
    };
    expect(() =>
      assertC6SourceV3SimpleVerifiedPassProjectionEquality({
        passANormalizedProjectionSha256:
          "c".repeat(64),
        passBComplete,
        passBNormalizedProjectionSha256:
          "c".repeat(64),
      })
    ).not.toThrow();

    let mismatch: unknown;
    try {
      assertC6SourceV3SimpleVerifiedPassProjectionEquality({
        passANormalizedProjectionSha256:
          "c".repeat(64),
        passBComplete,
        passBNormalizedProjectionSha256:
          "d".repeat(64),
      });
    } catch (error) {
      mismatch = error;
    }
    expect(mismatch).toBeInstanceOf(
      C6SourceV3SimpleTwoPassMismatchError,
    );
    expect(
      (
        mismatch as
          C6SourceV3SimpleTwoPassMismatchError
      ).chainTip,
    ).toEqual(passBComplete);
    expect(() =>
      assertC6SourceV3SimpleVerifiedPassProjectionMismatch({
        passANormalizedProjectionSha256:
          "c".repeat(64),
        passBNormalizedProjectionSha256:
          "d".repeat(64),
      })
    ).not.toThrow();
    expect(() =>
      assertC6SourceV3SimpleVerifiedPassProjectionMismatch({
        passANormalizedProjectionSha256:
          "c".repeat(64),
        passBNormalizedProjectionSha256:
          "c".repeat(64),
      })
    ).toThrow("projection equality");

    await withPublicationRoot(async (root) => {
      const passA =
        await writeUnverifiedPassCompleteEnvelope({
          frozenInputClosureSha256: "b".repeat(64),
          genesisSha256: ZERO_SHA,
          pass: "A",
          root,
        });
      const passB =
        await writeUnverifiedPassCompleteEnvelope({
          frozenInputClosureSha256: "b".repeat(64),
          genesisSha256: passA.sha256,
          pass: "B",
          root,
        });
      let providerCount = 0;
      let thrown: unknown;
      try {
        await writeC6SourceV3SimpleTwoPassEqualityReceipt({
          assetRoot: root,
          authorizationTokenProvider: async () => {
            providerCount += 1;
            return Buffer.from("secret-token");
          },
          evaluationId:
            EXPECTED_FROZEN_INPUTS.evaluationId,
          executionContractSha256: CONTRACT_SHA,
          frame: FRAME,
          frozenInputClosureSha256: "b".repeat(64),
          passAComplete: passA,
          passBComplete: passB,
          runtimeAuthorizationSha256:
            EXPECTED_FROZEN_INPUTS
              .runtimeAuthorizationSha256,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).not.toBeInstanceOf(
        C6SourceV3SimpleTwoPassMismatchError,
      );
      expect(providerCount).toBe(0);
    });
  });

  it("hashes a contiguous logical-request ledger with a known vector", () => {
    expect(hashC6SourceV3SimpleAttemptLedgerRoot([
      {
        logicalRequestOrdinal: 1,
        sha256: "1".repeat(64),
      },
      {
        logicalRequestOrdinal: 2,
        sha256: "2".repeat(64),
      },
    ])).toBe(
      "3a47138245d7d12da1a228cef3a9c55bf3b89d01f9a3b5fc6af62afdc4457f69",
    );
    expect(() =>
      hashC6SourceV3SimpleAttemptLedgerRoot([{
        logicalRequestOrdinal: 2,
        sha256: "2".repeat(64),
      }])
    ).toThrow("contiguous");
  });

  it("rejects a self-reported semantic pass that is not rebuilt from every projected request", async () => {
    await withPublicationRoot(async (root) => {
      await writeFile(
        join(root, "fixture.json"),
        FIXTURE_BYTES,
      );
      const frozenInputClosure =
        await writeC6SourceV3SimpleFrozenInputClosure({
          assetRoot: root,
          expected: EXPECTED_FROZEN_INPUTS,
          repositoryRoot: root,
        });
      await expect(
        createPass(
          root,
          "A",
          ZERO_SHA,
          frozenInputClosure.sha256,
          undefined,
          false,
        ),
      ).rejects.toThrow(
        "durable request sequence mismatch",
      );
    });
  });

  it("rejects pass publication after any terminal proactive pause completion", async () => {
    await withPublicationRoot(async (root) => {
      await writeFile(
        join(root, "fixture.json"),
        FIXTURE_BYTES,
      );
      const frozenInputClosure =
        await writeC6SourceV3SimpleFrozenInputClosure({
          assetRoot: root,
          expected: EXPECTED_FROZEN_INPUTS,
          repositoryRoot: root,
        });

      await expect(
        createPass(
          root,
          "A",
          ZERO_SHA,
          frozenInputClosure.sha256,
          undefined,
          false,
          {
            remaining: 49,
            resetAt:
              "2026-07-26T13:02:00Z",
          },
        ),
      ).rejects.toThrow(
        "continued after terminal proactive pause",
      );
    });
  });

  it("keeps every local equality replay and mutation before the authorization boundary", async () => {
    await withPublicationRoot(async (root) => {
      const input = {
        assetRoot: root,
        evaluationId:
          EXPECTED_FROZEN_INPUTS.evaluationId,
        executionContractSha256: CONTRACT_SHA,
        frozenInputClosureSha256: "b".repeat(64),
        normalizedProjectionSha256:
          "c".repeat(64),
        passAComplete: {
          bytes: 1,
          path: "pass-a/pass-complete.json",
          sha256: "d".repeat(64),
        },
        passBComplete: {
          bytes: 1,
          path: "pass-b/pass-complete.json",
          sha256: "e".repeat(64),
        },
        runtimeAuthorizationSha256:
          EXPECTED_FROZEN_INPUTS
            .runtimeAuthorizationSha256,
      };
      let tokenProviderCount = 0;

      const first =
        await commitC6SourceV3SimpleTwoPassEqualityReceiptAfterPassValidation({
          ...input,
          authorizationTokenProvider: async () => {
            tokenProviderCount += 1;
            return Buffer.from("secret-token");
          },
        });
      expect(tokenProviderCount).toBe(1);
      expect(first.equalityReceipt.path).toBe(
        "two-pass-equality.json",
      );

      tokenProviderCount = 0;
      await expect(
        commitC6SourceV3SimpleTwoPassEqualityReceiptAfterPassValidation({
          ...input,
          authorizationTokenProvider: async () => {
            tokenProviderCount += 1;
            return Buffer.from("secret-token");
          },
        }),
      ).resolves.toEqual(first);
      expect(tokenProviderCount).toBe(1);
      tokenProviderCount = 0;

      const receiptPath = join(
        root,
        "two-pass-equality.json",
      );
      const receiptBytes = await readFile(receiptPath);
      const receipt = JSON.parse(
        receiptBytes.toString("utf8"),
      ) as Record<string, unknown>;
      await writeFile(
        receiptPath,
        `${JSON.stringify({
          ...receipt,
          evaluationId: "another-evaluation",
        }, null, 2)}\n`,
      );
      await expect(
        commitC6SourceV3SimpleTwoPassEqualityReceiptAfterPassValidation({
          ...input,
          authorizationTokenProvider: async () => {
            tokenProviderCount += 1;
            return Buffer.from("secret-token");
          },
        }),
      ).rejects.toThrow("equality receipt mismatch");
      expect(tokenProviderCount).toBe(0);

      await writeFile(receiptPath, "{}\n");
      await expect(
        commitC6SourceV3SimpleTwoPassEqualityReceiptAfterPassValidation({
          ...input,
          authorizationTokenProvider: async () => {
            tokenProviderCount += 1;
            return Buffer.from("secret-token");
          },
        }),
      ).rejects.toThrow();
      expect(tokenProviderCount).toBe(0);
    });
  });

  it("rejects a truncated authoritative terminal marker", async () => {
    await withPublicationRoot(async (root) => {
      await writeFile(
        join(root, "terminal.json"),
        "{\"outcome\":",
      );
      expect(() =>
        parseC6SourceV3SimpleTerminal(
          Buffer.from("{\"outcome\":"),
        )
      ).toThrow("terminal");
    });
  });

  it("binds a failed terminal to verified failure evidence and its exact chain tip", async () => {
    await withPublicationRoot(async (root) => {
      await writeFile(
        join(root, "fixture.json"),
        FIXTURE_BYTES,
      );
      const frozenInputClosure =
        await writeC6SourceV3SimpleFrozenInputClosure({
          assetRoot: root,
          expected: EXPECTED_FROZEN_INPUTS,
          repositoryRoot: root,
        });
      const chainTip = frozenInputClosure;
      const failureEvidence =
        await writeC6SourceV3SimpleFailureEvidence({
          assetRoot: root,
          chainTip,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          failureCode: "publication-failure",
          frozenInputClosure,
        });
      const assetLock =
        await writeC6SourceV3SimpleCensusAssetLock({
          assetRoot: root,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          frozenInputClosureSha256:
            frozenInputClosure.sha256,
        });
      const terminal =
        await resumeC6SourceV3SimpleTerminalFromAssetLock({
        assetRoot: root,
        expectedFrozenInputs:
          EXPECTED_FROZEN_INPUTS,
        repositoryRoot: root,
        secret: Buffer.from("secret-token"),
      });
      expect(terminal.path).toBe("terminal.json");
      await expect(
        resumeC6SourceV3SimpleTerminalFromAssetLock({
          assetRoot: root,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          repositoryRoot: root,
          secret: Buffer.from("secret-token"),
        }),
      ).resolves.toEqual(terminal);
      await expect(
        verifyC6SourceV3SimpleTerminalClosure({
          assetRoot: root,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          repositoryRoot: root,
          secret: Buffer.from("secret-token"),
        }),
      ).resolves.toMatchObject({
        chainTip,
        failureCode: "publication-failure",
        outcome: "failed",
      });
      await writeFile(
        join(root, chainTip.path),
        "{\"tampered\":true}\n",
      );
      await expect(
        verifyC6SourceV3SimpleTerminalClosure({
          assetRoot: root,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          repositoryRoot: root,
          secret: Buffer.from("secret-token"),
        }),
      ).rejects.toThrow();
    });
  });

  it("replays a failed publication outcome before asset lock and rejects a mutated chain tip", async () => {
    await withPublicationRoot(async (root) => {
      await writeFile(
        join(root, "fixture.json"),
        FIXTURE_BYTES,
      );
      const frozenInputClosure =
        await writeC6SourceV3SimpleFrozenInputClosure({
          assetRoot: root,
          expected: EXPECTED_FROZEN_INPUTS,
          repositoryRoot: root,
        });
      const chainTip = frozenInputClosure;
      const failureEvidence =
        await writeC6SourceV3SimpleFailureEvidence({
          assetRoot: root,
          chainTip,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          failureCode: "publication-failure",
          frozenInputClosure,
        });

      await expect(
        verifyC6SourceV3SimplePublicationOutcome({
          assetRoot: root,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
        }),
      ).resolves.toEqual({
        chainTip,
        failureCode: "publication-failure",
        failureEvidence,
        frozenInputClosure,
        outcome: "failed",
      });
      await writeFile(
        join(root, chainTip.path),
        "{\"tampered\":true}\n",
      );
      await expect(
        verifyC6SourceV3SimplePublicationOutcome({
          assetRoot: root,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
        }),
      ).rejects.toThrow();
    });
  });

  it("rejects an arbitrary regular JSON file as a failure chain tip", async () => {
    await withPublicationRoot(async (root) => {
      await writeFile(
        join(root, "fixture.json"),
        FIXTURE_BYTES,
      );
      const frozenInputClosure =
        await writeC6SourceV3SimpleFrozenInputClosure({
          assetRoot: root,
          expected: EXPECTED_FROZEN_INPUTS,
          repositoryRoot: root,
        });
      const chainTip =
        await commitC6SourceV3SimpleCreateOnlyBytes(
          root,
          "failure-chain-tip.json",
          Buffer.from("{}\n"),
        );
      await expect(
        writeC6SourceV3SimpleFailureEvidence({
          assetRoot: root,
          chainTip,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          failureCode: "transport-terminal",
          frozenInputClosure,
        }),
      ).rejects.toThrow(
        "failure chain tip path mismatch",
      );
    });
  });

  it("rejects terminal failure codes without a replayed terminal attempt", async () => {
    await withPublicationRoot(async (root) => {
      await writeFile(
        join(root, "fixture.json"),
        FIXTURE_BYTES,
      );
      const frozenInputClosure =
        await writeC6SourceV3SimpleFrozenInputClosure({
          assetRoot: root,
          expected: EXPECTED_FROZEN_INPUTS,
          repositoryRoot: root,
        });

      for (const failureCode of [
        "maximum-attempts-exhausted",
        "rate-limit-pause-exceeded",
        "response-terminal",
        "transport-terminal",
      ] as const) {
        await expect(
          writeC6SourceV3SimpleFailureEvidence({
            assetRoot: root,
            chainTip: frozenInputClosure,
            expectedFrozenInputs:
              EXPECTED_FROZEN_INPUTS,
            failureCode,
            frozenInputClosure,
          }),
        ).rejects.toThrow(
          "failure code or chain tip mismatch",
        );
      }
    });
  });

  it("accepts rate-limit pause failure evidence only for a replayed overflowing success completion", async () => {
    await withPublicationRoot(async (root) => {
      await writeFile(
        join(root, "fixture.json"),
        FIXTURE_BYTES,
      );
      const frozenInputClosure =
        await writeC6SourceV3SimpleFrozenInputClosure({
          assetRoot: root,
          expected: EXPECTED_FROZEN_INPUTS,
          repositoryRoot: root,
        });
      const completion =
        await createSuccessfulLogicalRequestCompletion({
          frozenInputClosureSha256:
            frozenInputClosure.sha256,
          logicalRequestOrdinal: 1,
          pacing: {
            remaining: 49,
            resetAt:
              "2026-07-26T13:02:00Z",
          },
          priorLogicalRequestCompletionSha256:
            ZERO_SHA,
          query: ROOT_SHARDS[0]!.query,
          root,
        });

      await expect(
        writeC6SourceV3SimpleFailureEvidence({
          assetRoot: root,
          chainTip: completion,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          failureCode: "rate-limit-pause-exceeded",
          frozenInputClosure,
        }),
      ).resolves.toMatchObject({
        path: "failure-evidence.json",
      });
    });

    await withPublicationRoot(async (root) => {
      await writeFile(
        join(root, "fixture.json"),
        FIXTURE_BYTES,
      );
      const frozenInputClosure =
        await writeC6SourceV3SimpleFrozenInputClosure({
          assetRoot: root,
          expected: EXPECTED_FROZEN_INPUTS,
          repositoryRoot: root,
        });
      const completion =
        await createSuccessfulLogicalRequestCompletion({
          frozenInputClosureSha256:
            frozenInputClosure.sha256,
          logicalRequestOrdinal: 1,
          priorLogicalRequestCompletionSha256:
            ZERO_SHA,
          query: ROOT_SHARDS[0]!.query,
          root,
        });

      await expect(
        writeC6SourceV3SimpleFailureEvidence({
          assetRoot: root,
          chainTip: completion,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          failureCode: "rate-limit-pause-exceeded",
          frozenInputClosure,
        }),
      ).rejects.toThrow(
        "failure code or chain tip mismatch",
      );
    });

    await withPublicationRoot(async (root) => {
      await writeFile(
        join(root, "fixture.json"),
        FIXTURE_BYTES,
      );
      const frozenInputClosure =
        await writeC6SourceV3SimpleFrozenInputClosure({
          assetRoot: root,
          expected: EXPECTED_FROZEN_INPUTS,
          repositoryRoot: root,
        });
      const first =
        await createSuccessfulLogicalRequestCompletion({
          frozenInputClosureSha256:
            frozenInputClosure.sha256,
          logicalRequestOrdinal: 1,
          pacing: {
            remaining: 49,
            resetAt:
              "2026-07-26T13:02:00Z",
          },
          priorLogicalRequestCompletionSha256:
            ZERO_SHA,
          query: ROOT_SHARDS[0]!.query,
          root,
        });
      const second =
        await createSuccessfulLogicalRequestCompletion({
          frozenInputClosureSha256:
            frozenInputClosure.sha256,
          logicalRequestOrdinal: 2,
          pacing: {
            remaining: 49,
            resetAt:
              "2026-07-26T13:02:00Z",
          },
          priorLogicalRequestCompletionSha256:
            first.sha256,
          query: ROOT_SHARDS[1]!.query,
          root,
        });

      await expect(
        writeC6SourceV3SimpleFailureEvidence({
          assetRoot: root,
          chainTip: second,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          failureCode: "rate-limit-pause-exceeded",
          frozenInputClosure,
        }),
      ).rejects.toThrow(
        "logical request completion prefix",
      );
    });
  });

  it("binds each terminal failure code to its replayed retry reason", async () => {
    for (const testCase of [
      {
        failureCode:
          "transport-terminal" as const,
        kind: "transport" as const,
      },
      {
        failureCode:
          "response-terminal" as const,
        kind: "response" as const,
      },
      {
        failureCode:
          "maximum-attempts-exhausted" as const,
        kind: "maximum-attempts" as const,
      },
    ]) {
      await withPublicationRoot(async (root) => {
        await writeFile(
          join(root, "fixture.json"),
          FIXTURE_BYTES,
        );
        const frozenInputClosure =
          await writeC6SourceV3SimpleFrozenInputClosure({
            assetRoot: root,
            expected: EXPECTED_FROZEN_INPUTS,
            repositoryRoot: root,
          });
        const chainTip =
          await createTerminalAttemptChainTip({
            frozenInputClosureSha256:
              frozenInputClosure.sha256,
            kind: testCase.kind,
            root,
          });
        for (const wrongCode of [
          "maximum-attempts-exhausted",
          "response-terminal",
          "transport-terminal",
        ] as const) {
          if (wrongCode === testCase.failureCode) {
            continue;
          }
          await expect(
            writeC6SourceV3SimpleFailureEvidence({
              assetRoot: root,
              chainTip,
              expectedFrozenInputs:
                EXPECTED_FROZEN_INPUTS,
              failureCode: wrongCode,
              frozenInputClosure,
            }),
          ).rejects.toThrow(
            "failure code or chain tip mismatch",
          );
        }
        await expect(
          writeC6SourceV3SimpleFailureEvidence({
            assetRoot: root,
            chainTip,
            expectedFrozenInputs:
              EXPECTED_FROZEN_INPUTS,
            failureCode: testCase.failureCode,
            frozenInputClosure,
          }),
        ).resolves.toMatchObject({
          path: "failure-evidence.json",
        });
      });
    }
  });

  it("rejects a logical completion chain tip when its prior completion is missing", async () => {
    await withPublicationRoot(async (root) => {
      await writeFile(
        join(root, "fixture.json"),
        FIXTURE_BYTES,
      );
      const frozenInputClosure =
        await writeC6SourceV3SimpleFrozenInputClosure({
          assetRoot: root,
          expected: EXPECTED_FROZEN_INPUTS,
          repositoryRoot: root,
        });
      const first =
        await createSuccessfulLogicalRequestCompletion({
          frozenInputClosureSha256:
            frozenInputClosure.sha256,
          logicalRequestOrdinal: 1,
          priorLogicalRequestCompletionSha256:
            ZERO_SHA,
          query: ROOT_SHARDS[0]!.query,
          root,
        });
      const second =
        await createSuccessfulLogicalRequestCompletion({
          frozenInputClosureSha256:
            frozenInputClosure.sha256,
          logicalRequestOrdinal: 2,
          priorLogicalRequestCompletionSha256:
            first.sha256,
          query: ROOT_SHARDS[1]!.query,
          root,
        });
      await rm(join(root, first.path));

      await expect(
        writeC6SourceV3SimpleFailureEvidence({
          assetRoot: root,
          chainTip: second,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          failureCode: "rate-limit-pause-exceeded",
          frozenInputClosure,
        }),
      ).rejects.toThrow(
        "logical request completion prefix",
      );
    });
  });

  it("rejects pass B when its genesis is not the actual pass A completion", async () => {
    await withPublicationRoot(async (root) => {
      await writeFile(
        join(root, "fixture.json"),
        FIXTURE_BYTES,
      );
      const frozenInputClosure =
        await writeC6SourceV3SimpleFrozenInputClosure({
          assetRoot: root,
          expected: EXPECTED_FROZEN_INPUTS,
          repositoryRoot: root,
        });
      const passA =
        await writeUnverifiedPassCompleteEnvelope({
          frozenInputClosureSha256:
            frozenInputClosure.sha256,
          genesisSha256: ZERO_SHA,
          pass: "A",
          root,
        });
      const arbitraryGenesis =
        passA.sha256 === "f".repeat(64)
          ? "e".repeat(64)
          : "f".repeat(64);
      const passB =
        await writeUnverifiedPassCompleteEnvelope({
          frozenInputClosureSha256:
            frozenInputClosure.sha256,
          genesisSha256: arbitraryGenesis,
          pass: "B",
          root,
        });

      await expect(
        writeC6SourceV3SimpleFailureEvidence({
          assetRoot: root,
          chainTip: passB,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          failureCode: "two-pass-mismatch",
          frozenInputClosure,
        }),
      ).rejects.toThrow("pass chain mismatch");
    });
  });

  it("requires two-pass mismatch evidence to use pass B instead of a generic committed tip", async () => {
    await withPublicationRoot(async (root) => {
      await writeFile(
        join(root, "fixture.json"),
        FIXTURE_BYTES,
      );
      const frozenInputClosure =
        await writeC6SourceV3SimpleFrozenInputClosure({
          assetRoot: root,
          expected: EXPECTED_FROZEN_INPUTS,
          repositoryRoot: root,
        });
      await expect(
        writeC6SourceV3SimpleFailureEvidence({
          assetRoot: root,
          chainTip: frozenInputClosure,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          failureCode: "two-pass-mismatch",
          frozenInputClosure,
        }),
      ).rejects.toThrow(
        "failure code or chain tip mismatch",
      );
      const passA =
        await writeUnverifiedPassCompleteEnvelope({
          frozenInputClosureSha256:
            frozenInputClosure.sha256,
          genesisSha256: ZERO_SHA,
          pass: "A",
          root,
        });
      await expect(
        writeC6SourceV3SimpleFailureEvidence({
          assetRoot: root,
          chainTip: passA,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          failureCode: "two-pass-mismatch",
          frozenInputClosure,
        }),
      ).rejects.toThrow(
        "failure code or chain tip mismatch",
      );
    });
  });

  it("rejects a response chain tip bound to another runtime authorization", async () => {
    await withPublicationRoot(async (root) => {
      await writeFile(
        join(root, "fixture.json"),
        FIXTURE_BYTES,
      );
      const frozenInputClosure =
        await writeC6SourceV3SimpleFrozenInputClosure({
          assetRoot: root,
          expected: EXPECTED_FROZEN_INPUTS,
          repositoryRoot: root,
        });
      const request =
        buildC6SourceV3SimpleDurableGraphqlRequest({
          operation: "repositoryCount",
          variables: {
            query: ROOT_SHARDS[0]!.query,
          },
        });
      const runtimeAuthorizationSha256 =
        "f".repeat(64);
      const context = {
        attemptNumber: 1,
        attemptRoot: join(
          root,
          "pass-a",
          "logical-request-00000001",
          "attempt-01",
        ),
        evaluationId:
          EXPECTED_FROZEN_INPUTS.evaluationId,
        executionContractSha256: CONTRACT_SHA,
        frozenInputClosureSha256:
          frozenInputClosure.sha256,
        logicalRequestIdentitySha256:
          computeC6SourceV3SimpleLogicalRequestIdentitySha256({
            evaluationId:
              EXPECTED_FROZEN_INPUTS.evaluationId,
            executionContractSha256: CONTRACT_SHA,
            frozenInputClosureSha256:
              frozenInputClosure.sha256,
            logicalRequestOrdinal: 1,
            pass: "A" as const,
            request,
            runtimeAuthorizationSha256,
          }),
        logicalRequestOrdinal: 1,
        pass: "A" as const,
        priorAttemptCommitSha256: null,
        priorLogicalRequestCompletionSha256:
          ZERO_SHA,
        runtimeAuthorizationSha256,
      };
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
            "2026-07-26T12:00:00.000Z",
          requestCommitted:
            prepared.requestCommitted,
          secret: Buffer.from("secret-token"),
        });
      const chainTip = {
        ...started.responseStarted,
        path:
          "pass-a/logical-request-00000001/" +
          "attempt-01/response-started.json",
      };

      await expect(
        writeC6SourceV3SimpleFailureEvidence({
          assetRoot: root,
          chainTip,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          failureCode: "partial-response",
          frozenInputClosure,
        }),
      ).rejects.toThrow(
        "failure chain tip context mismatch",
      );
    });
  });

  it("publishes a stable failed terminal when a frozen repository input mutates", async () => {
    await withPublicationRoot(async (root) => {
      const assetRoot = join(root, "artifacts");
      const repositoryRoot = join(root, "repository");
      await mkdir(assetRoot);
      await mkdir(repositoryRoot);
      await writeFile(
        join(repositoryRoot, "fixture.json"),
        FIXTURE_BYTES,
      );
      const frozenInputClosure =
        await writeC6SourceV3SimpleFrozenInputClosure({
          assetRoot,
          expected: EXPECTED_FROZEN_INPUTS,
          repositoryRoot,
        });
      await writeFile(
        join(repositoryRoot, "fixture.json"),
        "mutated",
      );
      const chainTip =
        await writeC6SourceV3SimpleFrozenInputMutationEvidence({
          assetRoot,
          expected: EXPECTED_FROZEN_INPUTS,
          frozenInputClosureSha256:
            frozenInputClosure.sha256,
          repositoryRoot,
        });
      const failureEvidence =
        await writeC6SourceV3SimpleFailureEvidence({
          assetRoot,
          chainTip,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          failureCode: "input-mutation",
          frozenInputClosure,
        });
      const assetLock =
        await writeC6SourceV3SimpleCensusAssetLock({
          assetRoot,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          frozenInputClosureSha256:
            frozenInputClosure.sha256,
        });

      await writeC6SourceV3SimpleTerminal({
        assetRoot,
        expectedFrozenInputs:
          EXPECTED_FROZEN_INPUTS,
        repositoryRoot,
        secret: Buffer.from("secret-token"),
        terminal: {
          assetLock,
          chainTip,
          evaluationId:
            EXPECTED_FROZEN_INPUTS.evaluationId,
          executionContractSha256: CONTRACT_SHA,
          failureCode: "input-mutation",
          failureEvidence,
          frozenInputClosure,
          frozenInputClosureSha256:
            frozenInputClosure.sha256,
          outcome: "failed",
          runtimeAuthorizationSha256:
            EXPECTED_FROZEN_INPUTS
              .runtimeAuthorizationSha256,
          inputClosureSha256: INPUT_SHA,
        },
      });
      await writeFile(
        join(repositoryRoot, "fixture.json"),
        "changed-again-after-terminal",
      );
      await expect(
        verifyC6SourceV3SimpleTerminalClosure({
          assetRoot,
          expectedFrozenInputs:
            EXPECTED_FROZEN_INPUTS,
          repositoryRoot,
          secret: Buffer.from("secret-token"),
        }),
      ).resolves.toMatchObject({
        failureCode: "input-mutation",
        outcome: "failed",
      });
    });
  });

});

async function createTerminalAttemptChainTip(input: {
  frozenInputClosureSha256: string;
  kind:
    | "maximum-attempts"
    | "response"
    | "transport";
  root: string;
}) {
  const passRoot = join(input.root, "pass-a");
  const logicalRequestRoot = join(
    passRoot,
    "logical-request-00000001",
  );
  const request =
    buildC6SourceV3SimpleDurableGraphqlRequest({
      operation: "repositoryCount",
      variables: {
        query: ROOT_SHARDS[0]!.query,
      },
    });
  const attemptCount =
    input.kind === "maximum-attempts" ? 4 : 1;
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
    attemptNumber <= attemptCount;
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
        EXPECTED_FROZEN_INPUTS.evaluationId,
      executionContractSha256: CONTRACT_SHA,
      frozenInputClosureSha256:
        input.frozenInputClosureSha256,
      logicalRequestOrdinal: 1,
      pass: "A" as const,
      priorAttemptCommitSha256,
      priorLogicalRequestCompletionSha256:
        ZERO_SHA,
      runtimeAuthorizationSha256:
        EXPECTED_FROZEN_INPUTS
          .runtimeAuthorizationSha256,
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
    if (input.kind === "response") {
      const responseStarted =
        await recordC6SourceV3SimpleResponseStarted({
          context,
          headers: SUCCESS_HEADERS,
          httpStatus: 401,
          receivedAt:
            "2026-07-26T12:00:01.000Z",
          requestCommitted:
            prepared.requestCommitted,
          secret: Buffer.from("secret-token"),
        });
      await recordC6SourceV3SimpleResponseComplete({
        body: Buffer.from("{}"),
        context,
        responseStarted:
          responseStarted.responseStarted,
        secret: Buffer.from("secret-token"),
      });
    } else {
      await recordC6SourceV3SimpleTransportError({
        code:
          input.kind === "maximum-attempts"
            ? "ECONNRESET"
            : "EACCES",
        context,
        message: "transport failed",
        name: "Error",
        occurredAt:
          "2026-07-26T12:00:01.000Z",
        phase: "fetch",
        requestCommitted: prepared.requestCommitted,
        secret: Buffer.from("secret-token"),
      });
    }
    const settled =
      await settleC6SourceV3SimpleAttemptFromLedger(
        context,
      );
    if (attemptNumber < attemptCount) {
      if (settled.outcome !== "retry") {
        throw new Error(
          "test terminal attempt prefix did not retry",
        );
      }
      priorAttemptCommitSha256 =
        settled.attempt.sha256;
    } else {
      if (settled.outcome !== "stop-terminal") {
        throw new Error(
          "test terminal attempt did not stop",
        );
      }
      terminalAttempt = settled.attempt;
    }
  }
  return {
    ...terminalAttempt!,
    path:
      "pass-a/logical-request-00000001/" +
      `attempt-${
        String(attemptCount).padStart(2, "0")
      }/attempt.json`,
  };
}

async function createSuccessfulLogicalRequestCompletion(
  input: {
    frozenInputClosureSha256: string;
    logicalRequestOrdinal: number;
    pacing?: {
      remaining: number;
      resetAt: string;
    };
    priorLogicalRequestCompletionSha256: string;
    query: string;
    root: string;
  },
) {
  const passRoot = join(input.root, "pass-a");
  const ordinal = String(
    input.logicalRequestOrdinal,
  ).padStart(8, "0");
  const request =
    buildC6SourceV3SimpleDurableGraphqlRequest({
      operation: "repositoryCount",
      variables: { query: input.query },
    });
  const base = {
    attemptNumber: 1,
    attemptRoot: join(
      passRoot,
      `logical-request-${ordinal}`,
      "attempt-01",
    ),
    evaluationId:
      EXPECTED_FROZEN_INPUTS.evaluationId,
    executionContractSha256: CONTRACT_SHA,
    frozenInputClosureSha256:
      input.frozenInputClosureSha256,
    logicalRequestOrdinal:
      input.logicalRequestOrdinal,
    pass: "A" as const,
    priorAttemptCommitSha256: null,
    priorLogicalRequestCompletionSha256:
      input.priorLogicalRequestCompletionSha256,
    runtimeAuthorizationSha256:
      EXPECTED_FROZEN_INPUTS
        .runtimeAuthorizationSha256,
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
  const remaining =
    input.pacing?.remaining ?? 4_999;
  const resetAt =
    input.pacing?.resetAt ??
    "2026-07-26T13:00:00Z";
  const headers = {
    ...SUCCESS_HEADERS,
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-reset": String(
      Date.parse(resetAt) / 1_000,
    ),
    "x-ratelimit-used": String(
      5_000 - remaining,
    ),
  };
  const responseStarted =
    await recordC6SourceV3SimpleResponseStarted({
      context,
      headers,
      httpStatus: 200,
      receivedAt: "2026-07-26T12:00:01.000Z",
      requestCommitted: prepared.requestCommitted,
      secret: Buffer.from("secret-token"),
    });
  const responseComplete =
    await recordC6SourceV3SimpleResponseComplete({
      body: repositoryCountResponse(0, {
        remaining,
        resetAt,
      }),
      context,
      responseStarted:
        responseStarted.responseStarted,
      secret: Buffer.from("secret-token"),
    });
  const completedAttempt =
    await completeC6SourceV3SimpleAttempt({
      context,
      decision: "stop-success",
      notBefore: null,
      reason: "graphql-success",
      requestCommitted: prepared.requestCommitted,
      responseComplete:
        responseComplete.responseComplete,
      responseStarted:
        responseStarted.responseStarted,
      transportError: null,
    });
  const completion =
    await writeC6SourceV3SimpleLogicalRequestComplete({
      assetRoot: input.root,
      attempts: [{
        artifact: completedAttempt.attempt,
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
      passRoot,
      priorLogicalRequestCompletionSha256:
        context.priorLogicalRequestCompletionSha256,
      runtimeAuthorizationSha256:
        context.runtimeAuthorizationSha256,
    });
  return {
    ...completion,
    path: `pass-a/${completion.path}`,
  };
}

async function writeUnverifiedPassCompleteEnvelope(
  input: {
    frozenInputClosureSha256: string;
    genesisSha256: string;
    pass: "A" | "B";
    root: string;
  },
) {
  const passDirectory =
    `pass-${input.pass.toLowerCase()}`;
  const reference = (path: string) => ({
    bytes: 1,
    path,
    sha256: "d".repeat(64),
  });
  const logicalRequestCompletion = reference(
    `${passDirectory}/logical-request-complete-00000001.json`,
  );
  const passRoot = join(input.root, passDirectory);
  await mkdir(passRoot, {
    recursive: true,
  });
  const committed =
    await commitC6SourceV3SimpleCreateOnlyBytes(
    passRoot,
    "pass-complete.json",
    Buffer.from(`${JSON.stringify({
      artifactKind:
        "c6-source-v3-simple-pass-complete",
      attemptLedgerRootSha256: "d".repeat(64),
      countTreeClosure: reference(
        `${passDirectory}/count-tree-closure.json`,
      ),
      evaluationId:
        EXPECTED_FROZEN_INPUTS.evaluationId,
      executionContractSha256: CONTRACT_SHA,
      frozenInputClosureSha256:
        input.frozenInputClosureSha256,
      genesisSha256: input.genesisSha256,
      lastLogicalRequestCompletionSha256:
        logicalRequestCompletion.sha256,
      logicalRequestCompletionArtifacts: [{
        artifact: logicalRequestCompletion,
        logicalRequestOrdinal: 1,
      }],
      logicalRequestCount: 1,
      normalizedProjection: reference(
        `${passDirectory}/normalized-projection.json`,
      ),
      normalizedProjectionSha256: "d".repeat(64),
      pass: input.pass,
      pullRequestClosure: reference(
        `${passDirectory}/pull-request-closure.json`,
      ),
      repositoryClosure: reference(
        `${passDirectory}/repository-closure.json`,
      ),
      runtimeAuthorizationSha256:
        EXPECTED_FROZEN_INPUTS
          .runtimeAuthorizationSha256,
      schemaVersion: 1,
    }, null, 2)}\n`),
  );
  return {
    ...committed,
    path: `${passDirectory}/${committed.path}`,
  };
}

async function createPass(
  root: string,
  pass: "A" | "B",
  genesisSha256: string,
  frozenInputClosureSha256: string,
  normalizedProjectionSha256Override?: string,
  causal = true,
  pacing?: {
    remaining: number;
    resetAt: string;
  },
) {
  const passRoot = join(root, `pass-${pass.toLowerCase()}`);
  const artifacts =
    await writeC6SourceV3SimplePassArtifactBundle({
      assetRoot: root,
      evaluationId:
        "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
      executionContractSha256: CONTRACT_SHA,
      frozenInputClosureSha256,
      frame: FRAME,
      normalizedPass: emptyPass(),
      pass,
      passRoot,
      runtimeAuthorizationSha256:
        EXPECTED_FROZEN_INPUTS
          .runtimeAuthorizationSha256,
    });
  const queries = causal
    ? ROOT_SHARDS.map((rootShard) => rootShard.query)
    : ["language:TypeScript"];
  const logicalRequestCompletions = [];
  let priorLogicalRequestCompletionSha256 =
    genesisSha256;
  for (const [index, query] of queries.entries()) {
    const logicalRequestOrdinal = index + 1;
    const ordinal = String(
      logicalRequestOrdinal,
    ).padStart(8, "0");
    const request =
      buildC6SourceV3SimpleDurableGraphqlRequest({
        operation: "repositoryCount",
        variables: { query },
      });
    const contextBase = {
      attemptNumber: 1,
      attemptRoot: join(
        passRoot,
        `logical-request-${ordinal}`,
        "attempt-01",
      ),
      evaluationId:
        "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
      executionContractSha256: CONTRACT_SHA,
      frozenInputClosureSha256:
        frozenInputClosureSha256,
      logicalRequestOrdinal,
      pass,
      priorAttemptCommitSha256: null,
      priorLogicalRequestCompletionSha256,
      runtimeAuthorizationSha256:
        EXPECTED_FROZEN_INPUTS
          .runtimeAuthorizationSha256,
    };
    const context = {
      ...contextBase,
      logicalRequestIdentitySha256:
        computeC6SourceV3SimpleLogicalRequestIdentitySha256({
          ...contextBase,
          request,
        }),
    };
    const prepared =
      await prepareC6SourceV3SimpleAttempt({
        context,
        request,
      });
    const remaining =
      pacing?.remaining ?? 4_999;
    const resetAt =
      pacing?.resetAt ??
      "2026-07-26T13:00:00Z";
    const responseStarted =
      await recordC6SourceV3SimpleResponseStarted({
        context,
        headers: {
          ...SUCCESS_HEADERS,
          "x-ratelimit-remaining":
            String(remaining),
          "x-ratelimit-reset": String(
            Date.parse(resetAt) / 1_000,
          ),
          "x-ratelimit-used": String(
            5_000 - remaining,
          ),
        },
        httpStatus: 200,
        receivedAt: "2026-07-26T12:00:01.000Z",
        requestCommitted: prepared.requestCommitted,
        secret: Buffer.from("secret-token"),
      });
    const responseComplete =
      await recordC6SourceV3SimpleResponseComplete({
        body: repositoryCountResponse(0, {
          remaining,
          resetAt,
        }),
        context,
        responseStarted:
          responseStarted.responseStarted,
        secret: Buffer.from("secret-token"),
      });
    const completedAttempt =
      await completeC6SourceV3SimpleAttempt({
        context,
        decision: "stop-success",
        notBefore: null,
        reason: "graphql-success",
        requestCommitted: prepared.requestCommitted,
        responseComplete:
          responseComplete.responseComplete,
        responseStarted:
          responseStarted.responseStarted,
        transportError: null,
      });
    const logicalRequestCompletion =
      await writeC6SourceV3SimpleLogicalRequestComplete({
        assetRoot: root,
        attempts: [{
          artifact: completedAttempt.attempt,
          attemptRoot: context.attemptRoot,
        }],
        evaluationId: context.evaluationId,
        executionContractSha256:
          context.executionContractSha256,
        frozenInputClosureSha256:
          context.frozenInputClosureSha256,
        logicalRequestIdentitySha256:
          context.logicalRequestIdentitySha256,
        logicalRequestOrdinal,
        pass,
        passRoot,
        priorLogicalRequestCompletionSha256,
        runtimeAuthorizationSha256:
          context.runtimeAuthorizationSha256,
      });
    logicalRequestCompletions.push({
      artifact: logicalRequestCompletion,
      logicalRequestOrdinal,
    });
    priorLogicalRequestCompletionSha256 =
      logicalRequestCompletion.sha256;
  }
  return await writeC6SourceV3SimplePassComplete({
    assetRoot: root,
    countTreeClosure:
      artifacts.countTreeClosure,
    evaluationId:
      "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
    executionContractSha256: CONTRACT_SHA,
    frame: FRAME,
    frozenInputClosureSha256,
    genesisSha256,
    logicalRequestCompletions,
    normalizedProjection:
      artifacts.normalizedProjection,
    normalizedProjectionSha256:
      normalizedProjectionSha256Override ??
      artifacts.normalizedProjectionSha256,
    pass,
    passRoot,
    pullRequestClosure:
      artifacts.pullRequestClosure,
    repositoryClosure:
      artifacts.repositoryClosure,
    runtimeAuthorizationSha256:
      EXPECTED_FROZEN_INPUTS
        .runtimeAuthorizationSha256,
  });
}

function emptyPass(): C6SourceV3SimpleNormalizedPass {
  const countTrees = ROOT_SHARDS.map((rootShard) => {
    const leaf = {
      count: 0,
      createdFrom: rootShard.createdFrom,
      createdTo: rootShard.createdTo,
      depth: 0,
      leaf: true as const,
      query: rootShard.query,
    };
    return {
      leaves: [leaf],
      nodes: [leaf],
      rootShardId: rootShard.rootShardId,
    };
  });
  return {
    countTrees,
    metadataDecisions: [],
    pullRequestClosures: [],
    pullRequests: [],
    repositoryDecisions: [],
    repositoryLeafClosures: countTrees.map(
      (tree) => ({
        expectedRepositoryCount: 0,
        leafCreatedFrom:
          tree.leaves[0]!.createdFrom,
        leafCreatedTo: tree.leaves[0]!.createdTo,
        pageCount: 0,
        rootShardId: tree.rootShardId,
        terminalReason:
          "zero-count-leaf" as const,
      }),
    ),
    repositories: [],
  };
}

function repositoryCountResponse(
  count: number,
  pacing: {
    remaining: number;
    resetAt: string;
  } = {
    remaining: 4_999,
    resetAt: "2026-07-26T13:00:00Z",
  },
): Buffer {
  return Buffer.from(JSON.stringify({
    data: {
      rateLimit: {
        cost: 1,
        limit: 5_000,
        remaining: pacing.remaining,
        resetAt: pacing.resetAt,
        used: 5_000 - pacing.remaining,
      },
      search: {
        repositoryCount: count,
      },
    },
  }));
}

async function createFinalizationArtifacts(input: {
  equalityReceipt: {
    bytes: number;
    path: string;
    sha256: string;
  };
  passA: {
    bytes: number;
    path: string;
    sha256: string;
  };
  passB: {
    bytes: number;
    path: string;
    sha256: string;
  };
  root: string;
}) {
  const frozenInputClosure =
    await writeC6SourceV3SimpleFrozenInputClosure({
      assetRoot: input.root,
      expected: EXPECTED_FROZEN_INPUTS,
      repositoryRoot: input.root,
    });
  const censusReceipt =
    await writeC6SourceV3SimpleCensusReceipt({
      assetRoot: input.root,
      expectedFrozenInputs:
        EXPECTED_FROZEN_INPUTS,
      frozenInputClosure,
      passAComplete: input.passA,
      passBComplete: input.passB,
      repositoryRoot: input.root,
      twoPassEqualityReceipt:
        input.equalityReceipt,
    });
  const assetLock =
    await writeC6SourceV3SimpleCensusAssetLock({
      assetRoot: input.root,
      expectedFrozenInputs:
        EXPECTED_FROZEN_INPUTS,
      frozenInputClosureSha256:
        frozenInputClosure.sha256,
    });
  return {
    assetLock,
    censusReceipt,
    frozenInputClosure,
  };
}

async function withPublicationRoot(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(
    process.cwd(),
    ".goodmemory-c6-census-publication-",
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
