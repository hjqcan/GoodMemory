import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  describe,
  expect,
  it,
} from "bun:test";

import {
  buildC6SourceV4BoundedActivationReceipt,
  claimC6SourceV4BoundedCapture,
  C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH,
  C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_SOURCE,
  finalizeC6SourceV4BoundedCapture,
  resolveC6SourceV4BoundedCaptureRoot,
  sealC6SourceV4BoundedFailedCapture,
  serializeC6SourceV4BoundedActivationReceipt,
  verifyC6SourceV4BoundedActivationLineage,
  verifyC6SourceV4BoundedActivationEvidence,
  verifyC6SourceV4BoundedActivationReceipt,
  verifyC6SourceV4BoundedResumeAuthorization,
} from "../../../scripts/codex-coding-effect/c6-source-v4-bounded-activation";
import {
  buildC6AssetLock,
  loadC6AssetLock,
  serializeC6AssetLock,
  verifyC6AssetClosure,
} from "../../../scripts/codex-coding-effect/c6-asset-lock";
import {
  buildC6SourceV4BoundedCapturePlan,
} from "../../../scripts/codex-coding-effect/c6-source-v4-bounded-replay";
import {
  C6_SOURCE_V4_BOUNDED_ACTIVATION_RECEIPT_PATH,
  C6_SOURCE_V4_BOUNDED_REVIEW_PATHS,
  C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS,
  C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS,
  C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT,
} from "../../../scripts/codex-coding-effect/c6-source-v4-bounded-review";
import {
  prepareC6SourceV4BoundedReview,
} from "../../../scripts/prepare-codex-coding-effect-c6-source-v4-bounded-review";
import {
  recordC6SourceV4BoundedReviewProvenance,
} from "../../../scripts/record-codex-coding-effect-c6-source-v4-bounded-review-provenance";
import {
  withC6GateTemporaryRoot,
} from "../../support/c6-gate-lifecycle";

const execFileAsync = promisify(execFile);
const AUTHOR = "/root";
const REVIEWER =
  "/root/c6_source_v4_bounded_review_v2";
const REVIEWED_AT =
  "2026-07-27T23:00:00.000Z";
const GATE_STARTED_AT = Date.now();
const SNAPSHOT_ROOT =
  process.env
    .GOODMEMORY_TEST_C6_SOURCE_V4_BOUNDED_SNAPSHOT_ROOT
    ?.trim() || undefined;
if (SNAPSHOT_ROOT === undefined) {
  throw new Error(
    "GOODMEMORY_TEST_C6_SOURCE_V4_BOUNDED_SNAPSHOT_ROOT is required",
  );
}
describe("Phase 73 C6 source-v4 bounded review and activation", () => {
  it("closes F -> reviewed R -> bridge-only A -> receipt-only P before one create-only capture claim", async () => {
    await withC6GateTemporaryRoot(
      "goodmemory-c6-v4-review-workflow-",
      async (parent) => {
    const fixture =
      await createFreezeFixture(parent);
    gateProgress("freeze-fixture-created");
    const prepared =
      await prepareC6SourceV4BoundedReview({
        authorTaskName: AUTHOR,
        outputRoot: fixture.repositoryRoot,
        repositoryRoot:
          fixture.repositoryRoot,
        reviewerAgentName: REVIEWER,
        snapshotRoot: SNAPSHOT_ROOT,
      });
    const reviewRoot = join(
      fixture.repositoryRoot,
      dirname(
        C6_SOURCE_V4_BOUNDED_REVIEW_PATHS.input,
      ),
    );
    expect(
      (await readdir(reviewRoot)).sort(),
    ).toEqual([
      "dispatch.json",
      "input.json",
      "request.json",
    ]);
    expect(prepared).toMatchObject({
      freezeCommitSha:
        fixture.freezeCommitSha,
      independentReviewAccepted: false,
      liveCaptureAuthorized: false,
      provenanceMaterialized: false,
      responseMaterialized: false,
    });

    const responseBytes =
      await acceptedResponse(
        fixture.repositoryRoot,
      );
    await writeFile(
      join(
        fixture.repositoryRoot,
        C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
          .response,
      ),
      responseBytes,
      { flag: "wx" },
    );
    const recorded =
      await recordC6SourceV4BoundedReviewProvenance({
        authorTaskName: AUTHOR,
        outputRoot:
          fixture.repositoryRoot,
        repositoryRoot:
          fixture.repositoryRoot,
        reviewerAgentName: REVIEWER,
      });
    expect(
      (await readdir(reviewRoot)).sort(),
    ).toEqual([
      "dispatch.json",
      "input.json",
      "provenance.json",
      "request.json",
      "response.json",
    ]);
    expect(recorded).toMatchObject({
      cryptographicReviewIndependence: false,
      independentReviewAccepted: true,
      liveCaptureAuthorized: false,
      sourceSelectionFrozen: false,
    });

    const reviewCommitSha = await commit(
      fixture.repositoryRoot,
      "review",
    );
    await writeFile(
      join(
        fixture.repositoryRoot,
        C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH,
      ),
      C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_SOURCE,
      { flag: "wx" },
    );
    const activationCommitSha = await commit(
      fixture.repositoryRoot,
      "activation",
    );
    const captureRoot =
      resolveC6SourceV4BoundedCaptureRoot(
        fixture.repositoryRoot,
      );
    await mkdir(dirname(captureRoot), {
      recursive: true,
    });
    const receipt =
      await buildC6SourceV4BoundedActivationReceipt({
        activationCommitSha,
        authorTaskName: AUTHOR,
        freezeCommitSha:
          fixture.freezeCommitSha,
        repositoryRoot:
          fixture.repositoryRoot,
        reviewCommitSha,
        reviewerAgentName: REVIEWER,
        snapshotRoot: SNAPSHOT_ROOT,
      });
    const receiptBytes =
      serializeC6SourceV4BoundedActivationReceipt(
        receipt,
      );
    await writePath(
      fixture.repositoryRoot,
      C6_SOURCE_V4_BOUNDED_ACTIVATION_RECEIPT_PATH,
      receiptBytes,
    );
    const publicationCommitSha =
      await commit(
        fixture.repositoryRoot,
        "publish activation receipt",
      );
    const authorization =
      await verifyC6SourceV4BoundedActivationReceipt({
        publicationCommitSha,
        repositoryRoot:
          fixture.repositoryRoot,
        snapshotRoot: SNAPSHOT_ROOT,
      });
    gateProgress("one-shot-authority-verified");

    expect(authorization.boundary).toEqual({
      candidateManifestFrozen: false,
      codexRunReady: false,
      independentReviewAccepted: true,
      liveCaptureAuthorized: true,
      maxLiveCaptureCount: 1,
      sourceSelectionFrozen: true,
    });
    expect(() =>
      (
        authorization.receipt
          .captureTarget as {
            path: string;
          }
      ).path = "/tmp/substituted-capture"
    ).toThrow();
    expect(() =>
      (
        authorization.freshLiveness as {
          clean: boolean;
        }
      ).clean = false
    ).toThrow();

    await git(
      fixture.repositoryRoot,
      [
        "branch",
        "original-publication",
        publicationCommitSha,
      ],
    );
    await git(
      fixture.repositoryRoot,
      [
        "checkout",
        "--detach",
        activationCommitSha,
      ],
    );
    await writePath(
      fixture.repositoryRoot,
      C6_SOURCE_V4_BOUNDED_ACTIVATION_RECEIPT_PATH,
      receiptBytes,
    );
    const alternatePublicationCommitSha =
      await commit(
        fixture.repositoryRoot,
        "alternate receipt publication",
      );
    await git(
      fixture.repositoryRoot,
      [
        "branch",
        "alternate-publication",
        alternatePublicationCommitSha,
      ],
    );
    await expect(
      verifyC6SourceV4BoundedActivationReceipt({
        publicationCommitSha,
        repositoryRoot:
          fixture.repositoryRoot,
        snapshotRoot: SNAPSHOT_ROOT,
      }),
    ).rejects.toThrow(
      "activation must have one reachable publication child",
    );
    await git(
      fixture.repositoryRoot,
      [
        "checkout",
        "--detach",
        publicationCommitSha,
      ],
    );
    await git(
      fixture.repositoryRoot,
      [
        "branch",
        "-D",
        "alternate-publication",
      ],
    );

    const replayCloneParent = join(
      dirname(fixture.repositoryRoot),
      "isolated-replay-clone",
    );
    await mkdir(replayCloneParent);
    const replayCloneRoot = join(
      replayCloneParent,
      "repository",
    );
    await execFileAsync("git", [
      "clone",
      "--branch",
      "original-publication",
      "--quiet",
      "--local",
      "--no-hardlinks",
      fixture.repositoryRoot,
      replayCloneRoot,
    ]);
    await mkdir(
      dirname(
        resolveC6SourceV4BoundedCaptureRoot(
          replayCloneRoot,
        ),
      ),
      { recursive: true },
    );
    await expect(
      verifyC6SourceV4BoundedActivationReceipt({
        publicationCommitSha,
        repositoryRoot: replayCloneRoot,
        snapshotRoot: SNAPSHOT_ROOT,
      }),
    ).rejects.toThrow(
      "activation receipt static closure mismatch",
    );

    const frozenActivationPath =
      "scripts/codex-coding-effect/c6-source-v4-bounded-activation.ts";
    const frozenActivationBytes =
      await readFile(
        join(
          fixture.repositoryRoot,
          frozenActivationPath,
        ),
      );
    await writeFile(
      join(
        fixture.repositoryRoot,
        frozenActivationPath,
      ),
      Buffer.concat([
        frozenActivationBytes,
        Buffer.from("\n// dirty mutation\n"),
      ]),
    );
    await expect(
      verifyC6SourceV4BoundedActivationReceipt({
        publicationCommitSha,
        repositoryRoot:
          fixture.repositoryRoot,
        snapshotRoot: SNAPSHOT_ROOT,
      }),
    ).rejects.toThrow(
      "requires a clean repository worktree",
    );
    await writeFile(
      join(
        fixture.repositoryRoot,
        frozenActivationPath,
      ),
      frozenActivationBytes,
    );

    const failedClaim =
      await claimC6SourceV4BoundedCapture({
        authorization,
        captureRoot,
      });
    const claimBytesBeforeResume =
      await readFile(
        join(captureRoot, "capture-claim.json"),
      );
    const resumeAuthorization =
      await verifyC6SourceV4BoundedResumeAuthorization({
        publicationCommitSha,
        repositoryRoot:
          fixture.repositoryRoot,
        snapshotRoot: SNAPSHOT_ROOT,
      });
    await expect(
      claimC6SourceV4BoundedCapture({
        authorization:
          resumeAuthorization,
        captureRoot,
      }),
    ).rejects.toThrow(
      "resume authority cannot create a capture claim",
    );
    expect(
      await readFile(
        join(captureRoot, "capture-claim.json"),
      ),
    ).toEqual(claimBytesBeforeResume);
    await sealC6SourceV4BoundedFailedCapture({
      captureRoot: failedClaim.captureRoot,
      errorIdentity: {
        messageSha256: sha256(
          "synthetic token acquisition failure",
        ),
        name: "Error",
      },
      failureStage:
        "before-next-dispatch",
      publicationCommitSha,
      receiptSha256:
        authorization.receiptSha256,
      snapshot: authorization.snapshot,
    });
    gateProgress("failure-capture-sealed");
    expect(
      JSON.parse(
        await readFile(
          join(
            captureRoot,
            "capture-claim.json",
          ),
          "utf8",
        ),
      ),
    ).toMatchObject({
      maxLiveCaptureCount: 1,
      publicationCommitSha,
      status:
        "claimed-once-no-retry-redraw-or-top-up",
    });
    expect(
      await readFile(
        join(
          captureRoot,
          "activation-receipt.json",
        ),
        "utf8",
      ),
    ).toBe(receiptBytes);
    expect(
      JSON.parse(
        await readFile(
          join(
            captureRoot,
            "capture-failure-terminal.json",
          ),
          "utf8",
        ),
      ),
    ).toMatchObject({
      durableLedger: {
        committedRequestAttemptCount: 0,
        completedLogicalRequestCount: 0,
        finalLogicalRequestCompletion:
          null,
        inProgressChainTip: null,
        inProgressLogicalRequestOrdinal:
          null,
        logicalRequestDirectoryCount: 0,
        passAssetRootSha256: null,
        passStructureSha256: null,
      },
      failureStage:
        "before-next-dispatch",
      schemaVersion: 2,
      status:
        "permanently-abandoned-no-retry-redraw-or-top-up",
    });
    const failedCaptureAssetLock =
      await loadC6AssetLock(captureRoot);
    await expect(
      verifyC6AssetClosure(
        captureRoot,
        failedCaptureAssetLock,
      ),
    ).resolves.toBeUndefined();
    const historicalEvidence =
      await verifyC6SourceV4BoundedActivationEvidence({
        publicationCommitSha,
        repositoryRoot:
          fixture.repositoryRoot,
        snapshotRoot: SNAPSHOT_ROOT,
      });
    await expect(
      verifyC6SourceV4BoundedResumeAuthorization({
        publicationCommitSha,
        repositoryRoot:
          fixture.repositoryRoot,
        snapshotRoot: SNAPSHOT_ROOT,
      }),
    ).rejects.toThrow(
      "resume requires a claimed capture without terminal or asset lock",
    );
    expect(
      historicalEvidence.captureState,
    ).toEqual({
      assetRootSha256:
        failedCaptureAssetLock.assetLock
          .assetRootSha256,
      status:
        "claimed-sealed-failure",
    });
    await rm(
      join(captureRoot, "asset-lock.json"),
    );
    const finalizedEvidence =
      await finalizeC6SourceV4BoundedCapture({
        captureRoot,
        publicationCommitSha,
        repositoryRoot:
          fixture.repositoryRoot,
        snapshotRoot: SNAPSHOT_ROOT,
      });
    expect(
      finalizedEvidence.captureState,
    ).toEqual({
      assetRootSha256:
        failedCaptureAssetLock.assetLock
          .assetRootSha256,
      status:
        "claimed-sealed-failure",
    });
    await expect(
      claimC6SourceV4BoundedCapture({
        authorization,
        captureRoot,
      }),
    ).rejects.toThrow(
      "capture authority was already consumed",
    );
    await expect(
      claimC6SourceV4BoundedCapture({
        authorization,
        captureRoot: join(
          dirname(fixture.repositoryRoot),
          "different-capture",
        ),
      }),
    ).rejects.toThrow(
      "capture root does not match",
    );
    await expect(
      verifyC6SourceV4BoundedActivationReceipt({
        publicationCommitSha,
        repositoryRoot:
          fixture.repositoryRoot,
        snapshotRoot: SNAPSHOT_ROOT,
      }),
    ).rejects.toThrow(
      "host-local capture target already exists",
    );

    const failureTerminalPath = join(
      captureRoot,
      "capture-failure-terminal.json",
    );
    const assetLockPath = join(
      captureRoot,
      "asset-lock.json",
    );
    const [
      originalFailureTerminalBytes,
      originalAssetLockBytes,
      originalClaimBytes,
    ] = await Promise.all([
      readFile(failureTerminalPath),
      readFile(assetLockPath),
      readFile(
        join(captureRoot, "capture-claim.json"),
      ),
    ]);
    await rm(assetLockPath);
    await writeFile(
      failureTerminalPath,
      canonicalJson({
        artifactKind:
          "c6-source-v4-bounded-capture-failure-terminal",
        status:
          "permanently-abandoned-no-retry-redraw-or-top-up",
      }),
    );
    await writeFile(
      assetLockPath,
      serializeC6AssetLock(
        await buildC6AssetLock(captureRoot),
      ),
    );
    await expect(
      verifyC6SourceV4BoundedActivationEvidence({
        publicationCommitSha,
        repositoryRoot:
          fixture.repositoryRoot,
        snapshotRoot: SNAPSHOT_ROOT,
      }),
    ).rejects.toThrow(
      "capture failure terminal",
    );
    const originalFailureTerminal =
      JSON.parse(
        originalFailureTerminalBytes.toString(
          "utf8",
        ),
      ) as Record<string, unknown>;
    await writeFile(
      failureTerminalPath,
      canonicalJson({
        ...originalFailureTerminal,
        receiptSha256: "0".repeat(64),
      }),
    );
    await writeFile(
      assetLockPath,
      serializeC6AssetLock(
        await buildC6AssetLock(captureRoot),
      ),
    );
    await expect(
      verifyC6SourceV4BoundedActivationEvidence({
        publicationCommitSha,
        repositoryRoot:
          fixture.repositoryRoot,
        snapshotRoot: SNAPSHOT_ROOT,
      }),
    ).rejects.toThrow(
      "capture terminal lineage mismatch",
    );
    await writeFile(
      failureTerminalPath,
      canonicalJson({
        ...originalFailureTerminal,
        publicationCommitSha:
          "0".repeat(40),
      }),
    );
    await writeFile(
      assetLockPath,
      serializeC6AssetLock(
        await buildC6AssetLock(captureRoot),
      ),
    );
    await expect(
      verifyC6SourceV4BoundedActivationEvidence({
        publicationCommitSha,
        repositoryRoot:
          fixture.repositoryRoot,
        snapshotRoot: SNAPSHOT_ROOT,
      }),
    ).rejects.toThrow(
      "capture terminal lineage mismatch",
    );
    const originalDurableLedger =
      originalFailureTerminal
        .durableLedger as Record<
          string,
          unknown
        >;
    await writeFile(
      failureTerminalPath,
      canonicalJson({
        ...originalFailureTerminal,
        durableLedger: {
          ...originalDurableLedger,
          committedRequestClosureSha256:
            "0".repeat(64),
        },
      }),
    );
    await writeFile(
      assetLockPath,
      serializeC6AssetLock(
        await buildC6AssetLock(captureRoot),
      ),
    );
    await expect(
      verifyC6SourceV4BoundedActivationEvidence({
        publicationCommitSha,
        repositoryRoot:
          fixture.repositoryRoot,
        snapshotRoot: SNAPSHOT_ROOT,
      }),
    ).rejects.toThrow(
      "failure durable ledger closure mismatch",
    );
    await Promise.all([
      writeFile(
        failureTerminalPath,
        originalFailureTerminalBytes,
      ),
      writeFile(
        assetLockPath,
        originalAssetLockBytes,
      ),
    ]);
    gateProgress("failure-mutations-complete");

    const capturePlan =
      buildC6SourceV4BoundedCapturePlan(
        authorization.snapshot,
      );
    const forgedClosures =
      capturePlan.selectedRepositories.map(
        (repository) => ({
          canonicalRepository:
            repository.nameWithOwner.toLowerCase(),
          enumeratedInWindowCount: 0,
          pageCount: 1,
          repositoryNodeId:
            repository.repositoryNodeId,
          skippedAboveUpperBoundCount: 0,
          terminalReason:
            "connection-exhausted",
          totalMergedPullRequestCount: 0,
        }),
      );
    const forgedBody = {
      artifactKind:
        "c6-source-v4-bounded-normalized-capture",
      identity: capturePlan.identity,
      logicalRequestCount:
        forgedClosures.length,
      metadataDecisions: [],
      pullRequestClosures: forgedClosures,
      pullRequests: [],
      schemaVersion: 1,
      selectedRepositories:
        capturePlan.selectedRepositories,
    };
    const forgedProjection = {
      ...forgedBody,
      projectionSha256: sha256(
        JSON.stringify(forgedBody),
      ),
    };
    const forgedProjectionBytes =
      canonicalJson(forgedProjection);
    const forgedNormalizedReference = {
      bytes: Buffer.byteLength(
        forgedProjectionBytes,
      ),
      path: "normalized-capture.json",
      sha256: sha256(
        forgedProjectionBytes,
      ),
    };
    const forgedReplayReceiptValues =
      [1, 2].map((replayOrdinal) => ({
        artifactKind:
          "c6-source-v4-bounded-local-replay-receipt",
        committedRequestClosureSha256:
          "e".repeat(64),
        finalLogicalRequestCompletionSha256:
          "f".repeat(64),
        logicalRequestCount:
          forgedClosures.length,
        networkPermitted: false,
        normalizedCapture:
          forgedNormalizedReference,
        passStructureSha256:
          "d".repeat(64),
        projectionSha256:
          forgedProjection.projectionSha256,
        receiptSha256:
          authorization.receiptSha256,
        replayOrdinal,
        schemaVersion: 1,
      }));
    const forgedReplayReceiptBytes =
      forgedReplayReceiptValues.map(
        canonicalJson,
      );
    const forgedReplayReceiptPaths = [
      "local-replay-receipt-01.json",
      "local-replay-receipt-02.json",
    ];
    const forgedReplayReceiptReferences =
      forgedReplayReceiptPaths.map(
        (path, index) => ({
          bytes: Buffer.byteLength(
            forgedReplayReceiptBytes[index]!,
          ),
          path,
          sha256: sha256(
            forgedReplayReceiptBytes[index]!,
          ),
        }),
      );
    await Promise.all([
      rm(assetLockPath),
      rm(failureTerminalPath),
    ]);
    await writeFile(
      join(
        captureRoot,
        "normalized-capture.json",
      ),
      forgedProjectionBytes,
    );
    await Promise.all(
      forgedReplayReceiptPaths.map(
        async (path, index) =>
          await writeFile(
            join(captureRoot, path),
            forgedReplayReceiptBytes[index]!,
          ),
      ),
    );
    await writeFile(
      join(
        captureRoot,
        "capture-terminal.json",
      ),
      canonicalJson({
        artifactKind:
          "c6-source-v4-bounded-capture-terminal",
        completedAt: REVIEWED_AT,
        finalLogicalRequestCompletionSha256:
          "f".repeat(64),
        logicalRequestCount:
          forgedClosures.length,
        localReplayReceipts:
          forgedReplayReceiptReferences,
        normalizedCapture:
          forgedNormalizedReference,
        projectionSha256:
          forgedProjection.projectionSha256,
        receiptSha256:
          authorization.receiptSha256,
        schemaVersion: 1,
        status:
          "logical-requests-complete-asset-lock-pending",
      }),
    );
    await expect(
      finalizeC6SourceV4BoundedCapture({
        captureRoot,
        publicationCommitSha,
        repositoryRoot:
          fixture.repositoryRoot,
        snapshotRoot: SNAPSHOT_ROOT,
      }),
    ).rejects.toThrow(
      "durable ledger",
    );
    gateProgress("forged-success-rejected");
    await Promise.all([
      rm(
        join(
          captureRoot,
          "capture-terminal.json",
        ),
      ),
      rm(
        join(
          captureRoot,
          "normalized-capture.json",
        ),
      ),
      ...forgedReplayReceiptPaths.map(
        (path) =>
          rm(join(captureRoot, path)),
      ),
    ]);
    await Promise.all([
      writeFile(
        failureTerminalPath,
        originalFailureTerminalBytes,
      ),
      writeFile(
        assetLockPath,
        originalAssetLockBytes,
      ),
    ]);
    await rm(assetLockPath);
    await writeFile(
      join(captureRoot, "capture-claim.json"),
      canonicalJson({
        artifactKind:
          "c6-source-v4-bounded-capture-claim",
        status:
          "claimed-once-no-retry-redraw-or-top-up",
      }),
    );
    await writeFile(
      assetLockPath,
      serializeC6AssetLock(
        await buildC6AssetLock(captureRoot),
      ),
    );
    await expect(
      verifyC6SourceV4BoundedActivationEvidence({
        publicationCommitSha,
        repositoryRoot:
          fixture.repositoryRoot,
        snapshotRoot: SNAPSHOT_ROOT,
      }),
    ).rejects.toThrow("capture claim");
    gateProgress("claim-mutation-rejected");
    await Promise.all([
      writeFile(
        join(captureRoot, "capture-claim.json"),
        originalClaimBytes,
      ),
      writeFile(
        assetLockPath,
        originalAssetLockBytes,
      ),
    ]);

    await git(
      fixture.repositoryRoot,
      [
        "branch",
        "original-activation",
        activationCommitSha,
      ],
    );
    await git(
      fixture.repositoryRoot,
      [
        "checkout",
        "--detach",
        reviewCommitSha,
      ],
    );
    await writePath(
      fixture.repositoryRoot,
      C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH,
      C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_SOURCE,
    );
    const alternateActivationCommitSha =
      await commit(
        fixture.repositoryRoot,
        "alternate activation child",
      );
    await git(
      fixture.repositoryRoot,
      [
        "branch",
        "alternate-activation",
        alternateActivationCommitSha,
      ],
    );
    await expect(
      verifyC6SourceV4BoundedActivationLineage({
        activationCommitSha,
        authorTaskName: AUTHOR,
        freezeCommitSha:
          fixture.freezeCommitSha,
        repositoryRoot:
          fixture.repositoryRoot,
        reviewCommitSha,
        reviewerAgentName: REVIEWER,
      }),
    ).rejects.toThrow(
      "review commit must have one reachable activation child",
    );

    await git(
      fixture.repositoryRoot,
      [
        "checkout",
        "--detach",
        fixture.freezeCommitSha,
      ],
    );
    for (
      const path of
        Object.values(
          C6_SOURCE_V4_BOUNDED_REVIEW_PATHS,
        )
    ) {
      await writePath(
        fixture.repositoryRoot,
        path,
        await gitBytes(
          fixture.repositoryRoot,
          [
            "show",
            `${reviewCommitSha}:${path}`,
          ],
        ),
      );
    }
    await writePath(
      fixture.repositoryRoot,
      "unexpected.txt",
      "not review evidence\n",
    );
    const badReviewCommitSha = await commit(
      fixture.repositoryRoot,
      "bad review child",
    );
    await writePath(
      fixture.repositoryRoot,
      C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH,
      C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_SOURCE,
    );
    const badActivationCommitSha = await commit(
      fixture.repositoryRoot,
      "bad activation child",
    );
    await expect(
      verifyC6SourceV4BoundedActivationLineage({
        activationCommitSha:
          badActivationCommitSha,
        authorTaskName: AUTHOR,
        freezeCommitSha:
          fixture.freezeCommitSha,
        repositoryRoot:
          fixture.repositoryRoot,
        reviewCommitSha:
          badReviewCommitSha,
        reviewerAgentName: REVIEWER,
      }),
    ).rejects.toThrow(
      "review commit must add exactly five review artifacts",
    );
    gateProgress("lineage-mutations-complete");
      },
    );
  }, 1_800_000);
});

async function createFreezeFixture(
  parent: string,
) {
  const repositoryRoot = join(parent, "repository");
  await execFileAsync("git", [
    "clone",
    "--quiet",
    "--local",
    "--no-hardlinks",
    process.cwd(),
    repositoryRoot,
  ]);
  await git(repositoryRoot, [
    "checkout",
    "--detach",
    C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT
      .commitSha,
  ]);
  await git(repositoryRoot, [
    "config",
    "user.email",
    "c6-review@example.invalid",
  ]);
  await git(repositoryRoot, [
    "config",
    "user.name",
    "C6 review test",
  ]);
  for (
    const path of
      C6_SOURCE_V4_BOUNDED_REVIEWED_PATHS
  ) {
    const target = join(repositoryRoot, path);
    await cp(
      join(process.cwd(), path),
      target,
      {
        force: true,
        recursive: false,
      },
    );
  }
  await git(repositoryRoot, ["add", "."]);
  await git(repositoryRoot, [
    "commit",
    "--quiet",
    "-m",
    "freeze",
  ]);
  return {
    freezeCommitSha: await gitText(
      repositoryRoot,
      ["rev-parse", "HEAD"],
    ),
    repositoryRoot,
  };
}

async function acceptedResponse(
  root: string,
): Promise<string> {
  const [
    dispatchBytes,
    inputBytes,
    requestBytes,
  ] = await Promise.all([
    readFile(join(
      root,
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
        .dispatch,
    )),
    readFile(join(
      root,
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
        .input,
    )),
    readFile(join(
      root,
      C6_SOURCE_V4_BOUNDED_REVIEW_PATHS
        .request,
    )),
  ]);
  return canonicalJson({
    acceptedChecks:
      C6_SOURCE_V4_BOUNDED_REVIEW_REQUIRED_CHECKS,
    artifactKind:
      "c6-source-v4-bounded-review-response",
    blockingFindings: [],
    boundary: {
      candidateManifestFrozen: false,
      codexRunReady: false,
      liveCaptureAuthorized: false,
      sourceSelectionFrozen: false,
      status:
        "review-accepted-freeze-and-activation-required",
    },
    decision: "accepted-for-freeze",
    dispatchSha256: sha256(dispatchBytes),
    inputSha256: sha256(inputBytes),
    requestSha256: sha256(requestBytes),
    reviewedAt: REVIEWED_AT,
    reviewerAgentName: REVIEWER,
    schemaVersion: 2,
  });
}

async function git(
  root: string,
  args: readonly string[],
): Promise<void> {
  await execFileAsync(
    "git",
    ["-C", root, ...args],
  );
}

async function gitText(
  root: string,
  args: readonly string[],
): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", root, ...args],
  );
  return stdout.trim();
}

async function gitBytes(
  root: string,
  args: readonly string[],
): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", root, ...args],
    {
      encoding: "buffer",
    },
  );
  return Buffer.from(stdout);
}

async function writePath(
  root: string,
  path: string,
  bytes: string | Uint8Array,
): Promise<void> {
  const target = join(root, path);
  await mkdir(dirname(target), {
    recursive: true,
  });
  await writeFile(target, bytes);
}

async function commit(
  root: string,
  message: string,
): Promise<string> {
  await git(root, ["add", "."]);
  await git(root, [
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
  return await gitText(
    root,
    ["rev-parse", "HEAD"],
  );
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(
  value: string | Uint8Array,
): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function gateProgress(stage: string): void {
  process.stderr.write(
    `${JSON.stringify({
      elapsedMs: Date.now() - GATE_STARTED_AT,
      gate:
        "c6-source-v4-bounded-review-activation",
      stage,
    })}\n`,
  );
}
