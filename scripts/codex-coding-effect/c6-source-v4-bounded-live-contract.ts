import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  buildC6SourceV3SimpleCensusExecutionContract,
  serializeC6SourceV3SimpleCensusExecutionContract,
} from "./c6-source-v3-simple-census-contract";
import {
  C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
  C6_SOURCE_V4_BOUNDED_MAX_CANONICAL_ASSET_BYTES,
  C6_SOURCE_V4_BOUNDED_MAX_LIVE_LOGICAL_REQUEST_COUNT,
} from "./c6-source-v4-bounded-contract";

export const C6_SOURCE_V4_BOUNDED_MAX_ASSET_LOCK_BYTES =
  1_024 ** 3;
export const C6_SOURCE_V4_BOUNDED_FINALIZATION_RESERVE_BYTES =
  C6_SOURCE_V4_BOUNDED_MAX_ASSET_LOCK_BYTES;
export const C6_SOURCE_V4_BOUNDED_MAX_TOTAL_CAPTURE_ROOT_BYTES =
  C6_SOURCE_V4_BOUNDED_MAX_CANONICAL_ASSET_BYTES +
  C6_SOURCE_V4_BOUNDED_MAX_ASSET_LOCK_BYTES;
export const C6_SOURCE_V4_BOUNDED_MAX_RESPONSE_BODY_BYTES =
  16 * 1_024 ** 2;
export const C6_SOURCE_V4_BOUNDED_NON_RESPONSE_ASSET_RESERVE_BYTES =
  512 * 1_024 ** 2;

const CONTRACT = {
  artifactKind:
    "c6-source-v4-bounded-live-contract",
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
    overflowPolicy:
      "seal-failed-evaluation-id-no-redraw-replacement-or-top-up",
  },
  evaluationId:
    C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
  failureEvidence: {
    committedAttemptClassificationReplayed:
      true,
    durableLedgerDerivedFromDisk: true,
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
    receiptsRequired: true,
  },
  schemaVersion: 1,
  stateMachine: {
    claimCount: 1,
    interruptedInitialClaimMayBeCompleted:
      true,
    normalizedCaptureResume:
      "local-only-no-token-or-network",
    resumeCreatesClaim: false,
    resumeRedrawsOrTopsUp: false,
    resumeSequence:
      "restart-frozen-plan-at-ordinal-one-replay-durable-prefix-then-continue-first-missing-request",
    singleWriterRequired: true,
    terminalFinalizationOnly: true,
  },
  token: {
    dedicatedCredentialEvidence:
      "external-preflight-required-not-inferred-from-token-bytes",
    dispatchBufferZeroedAfterAttempt: true,
    environmentVariable:
      "GOODMEMORY_C6_GITHUB_TOKEN",
    masterBufferZeroedOnExit: true,
    syntaxValidatedBeforeClaim: true,
    treeAbsenceScanBeforeTerminal: true,
  },
  transport: {
    proactivePausePosition:
      "before-next-dispatch",
    responseBodyRead:
      "bounded-stream-after-response-started-overflow-is-terminal-no-redispatch",
    sourceV3ExecutionContractSha256:
      sha256(
        serializeC6SourceV3SimpleCensusExecutionContract(
          buildC6SourceV3SimpleCensusExecutionContract(),
        ),
      ),
  },
} as const;

export type C6SourceV4BoundedLiveContract =
  typeof CONTRACT;

export const C6_SOURCE_V4_BOUNDED_LIVE_CONTRACT_SHA256 =
  sha256(
    serializeC6SourceV4BoundedLiveContract(
      structuredClone(CONTRACT),
    ),
  );

export function buildC6SourceV4BoundedLiveContract():
  C6SourceV4BoundedLiveContract {
  return structuredClone(CONTRACT);
}

export function serializeC6SourceV4BoundedLiveContract(
  input: C6SourceV4BoundedLiveContract,
): string {
  if (!isDeepStrictEqual(input, CONTRACT)) {
    throw new Error(
      "C6 source-v4 bounded live contract mismatch",
    );
  }
  return `${JSON.stringify(input, null, 2)}\n`;
}

export function parseC6SourceV4BoundedLiveContract(
  input: string | Uint8Array,
): C6SourceV4BoundedLiveContract {
  const text = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(
    typeof input === "string"
      ? Buffer.from(input)
      : input,
  );
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 source-v4 bounded live contract is not JSON",
    );
  }
  if (
    text !== `${JSON.stringify(raw, null, 2)}\n` ||
    !isDeepStrictEqual(raw, CONTRACT)
  ) {
    throw new Error(
      "C6 source-v4 bounded live contract mismatch",
    );
  }
  return structuredClone(CONTRACT);
}

function sha256(value: string): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}
