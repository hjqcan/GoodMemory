import { describe, expect, it } from "bun:test";

import {
  buildC6SourceV4BoundedLiveContract,
  C6_SOURCE_V4_BOUNDED_FINALIZATION_RESERVE_BYTES,
  C6_SOURCE_V4_BOUNDED_MAX_ASSET_LOCK_BYTES,
  C6_SOURCE_V4_BOUNDED_MAX_RESPONSE_BODY_BYTES,
  C6_SOURCE_V4_BOUNDED_MAX_TOTAL_CAPTURE_ROOT_BYTES,
  C6_SOURCE_V4_BOUNDED_NON_RESPONSE_ASSET_RESERVE_BYTES,
  parseC6SourceV4BoundedLiveContract,
  serializeC6SourceV4BoundedLiveContract,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-live-contract";
import {
  C6_SOURCE_V4_BOUNDED_MAX_CANONICAL_ASSET_BYTES,
  C6_SOURCE_V4_BOUNDED_MAX_LIVE_LOGICAL_REQUEST_COUNT,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-contract";

describe("C6 source-v4 bounded live contract", () => {
  it("freezes the resumable one-shot transport and resource state machine", () => {
    const contract =
      buildC6SourceV4BoundedLiveContract();

    expect(contract).toMatchObject({
      budgets: {
        everyDurableWriteGuarded: true,
        failureFinalizationReserveBytes:
          C6_SOURCE_V4_BOUNDED_FINALIZATION_RESERVE_BYTES,
        maximumAssetLockBytes:
          C6_SOURCE_V4_BOUNDED_MAX_ASSET_LOCK_BYTES,
        maximumCanonicalAssetBytes:
          C6_SOURCE_V4_BOUNDED_MAX_CANONICAL_ASSET_BYTES,
        maximumLiveLogicalRequestCount:
          C6_SOURCE_V4_BOUNDED_MAX_LIVE_LOGICAL_REQUEST_COUNT,
        maximumResponseBodyBytes:
          C6_SOURCE_V4_BOUNDED_MAX_RESPONSE_BODY_BYTES,
        maximumTotalCaptureRootBytes:
          C6_SOURCE_V4_BOUNDED_MAX_TOTAL_CAPTURE_ROOT_BYTES,
        nonResponseAssetReserveBytes:
          C6_SOURCE_V4_BOUNDED_NON_RESPONSE_ASSET_RESERVE_BYTES,
      },
      failureEvidence: {
        committedAttemptClassificationReplayed:
          true,
        durableLedgerDerivedFromDisk:
          true,
        exactCompletedPrefix: true,
        finalizationVerification:
          "semantic-scan-asset-lock-semantic-reverify",
        finalizeDecisionClassificationReplayed:
          true,
        maximumInProgressLogicalRequests: 1,
        pendingOnlyRecovery:
          "delete-uncommitted-bytes",
        readyOnlyRecovery:
          "hardlink-to-final-then-remove-ready",
        resultRequiresStopSuccessProjectionReplay:
          true,
        stagedWriteProtocol:
          "write-fsync-pending-hardlink-ready-unlink-pending-hardlink-final",
      },
      replay: {
        independentLocalReplayCount: 2,
        networkPermitted: false,
      },
      stateMachine: {
        claimCount: 1,
        resumeCreatesClaim: false,
        resumeRedrawsOrTopsUp: false,
        singleWriterRequired: true,
      },
      token: {
        masterBufferZeroedOnExit: true,
        syntaxValidatedBeforeClaim: true,
        treeAbsenceScanBeforeTerminal: true,
      },
      transport: {
        proactivePausePosition:
          "before-next-dispatch",
      },
    });
    expect(
      C6_SOURCE_V4_BOUNDED_NON_RESPONSE_ASSET_RESERVE_BYTES,
    ).toBe(512 * 1_024 ** 2);
    expect(
      parseC6SourceV4BoundedLiveContract(
        serializeC6SourceV4BoundedLiveContract(
          contract,
        ),
      ),
    ).toEqual(contract);
  });

  it("rejects any drift from the frozen live state machine", () => {
    const mutated = structuredClone(
      buildC6SourceV4BoundedLiveContract(),
    );
    (
      mutated.stateMachine as {
        resumeRedrawsOrTopsUp: boolean;
      }
    ).resumeRedrawsOrTopsUp = true;
    expect(() =>
      serializeC6SourceV4BoundedLiveContract(
        mutated,
      )
    ).toThrow("live contract mismatch");
  });
});
