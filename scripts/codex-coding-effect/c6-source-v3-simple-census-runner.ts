import {
  createHash,
} from "node:crypto";
import {
  lstat,
  mkdir,
} from "node:fs/promises";

import {
  requireC6SourceV3SimpleCensusRuntimeAuthorization,
} from "./c6-source-v3-simple-census-activation";
import {
  C6SourceV3SimplePartialResponseError,
  C6SourceV3SimpleTerminalAttemptError,
} from "./c6-source-v3-simple-census-executor";
import type {
  C6SourceV3SimpleFetch,
} from "./c6-source-v3-simple-census-executor";
import {
  C6SourceV3SimpleProactivePauseExceededError,
  C6SourceV3SimpleSecretLeakError,
  C6SourceV3SimpleTwoPassMismatchError,
} from "./c6-source-v3-simple-census-errors";
import {
  assertC6SourceV3SimpleFrozenInputsCurrent,
  assertC6SourceV3SimpleTreeHasNoSecret,
  commitC6SourceV3SimpleFrozenInputClosure,
  readC6SourceV3SimpleFrozenInputClosureIfExists,
  writeC6SourceV3SimpleCensusAssetLock,
  writeC6SourceV3SimpleFrozenInputMutationEvidence,
} from "./c6-source-v3-simple-census-finalization";
import type {
  C6SourceV3SimpleExpectedFrozenInputs,
} from "./c6-source-v3-simple-census-finalization";
import type {
  C6SourceV3SimpleArtifactReference,
} from "./c6-source-v3-simple-census-ledger";
import {
  recoverC6SourceV3SimplePendingArtifactTree,
} from "./c6-source-v3-simple-census-ledger";
import {
  acquireC6SourceV3SimpleCensusWriterLock,
} from "./c6-source-v3-simple-census-lock";
import {
  runC6SourceV3SimpleCensusPass,
} from "./c6-source-v3-simple-census-pass-runner";
import {
  loadC6SourceV3SimpleCensusPreflight,
} from "./c6-source-v3-simple-census-preflight";
import type {
  C6SourceV3SimpleCensusPreflight,
} from "./c6-source-v3-simple-census-preflight";
import {
  resumeC6SourceV3SimpleTerminalFromAssetLock,
  verifyC6SourceV3SimplePublicationOutcome,
  verifyC6SourceV3SimpleTerminalFinalizationState,
  writeC6SourceV3SimpleCensusReceipt,
  writeC6SourceV3SimpleFailureEvidence,
  writeC6SourceV3SimpleTwoPassEqualityReceipt,
} from "./c6-source-v3-simple-census-publication";
import type {
  C6SourceV3SimpleFailureCode,
} from "./c6-source-v3-simple-census-publication";

const ZERO_SHA256 = "0".repeat(64);
const LIVE_CONFIRMATION =
  "execute-goodmemory-c6-source-v3-simple-formal-census";

export async function runC6SourceV3SimpleFormalCensus(
  input: {
    activationReceiptBytes: string | Uint8Array;
    assetRoot: string;
    authorizationTokenProvider:
      () => Promise<Uint8Array>;
    fetchImpl?: C6SourceV3SimpleFetch;
    liveNetworkConfirmation: string;
    now?: () => number;
    repositoryRoot: string;
    requestTimeoutMilliseconds?: number;
    waitUntil?: (notBefore: number) => Promise<void>;
  },
): Promise<C6SourceV3SimpleArtifactReference> {
  if (
    input.liveNetworkConfirmation !==
      LIVE_CONFIRMATION
  ) {
    throw new Error(
      "C6 source-v3-simple live census confirmation is missing",
    );
  }
  const durableStateExists =
    await exists(input.assetRoot, "asset-lock.json") ||
    await exists(input.assetRoot, "terminal.json");
  const durableClosure = durableStateExists
    ? await readC6SourceV3SimpleFrozenInputClosureIfExists(
        input.assetRoot,
      )
    : null;
  if (durableStateExists && durableClosure === null) {
    throw new Error(
      "C6 source-v3-simple locked state is missing its frozen input closure",
    );
  }
  let expected: C6SourceV3SimpleExpectedFrozenInputs;
  if (durableClosure !== null) {
    expected = durableClosure.expected;
    assertActivationReceiptBinding(
      input.activationReceiptBytes,
      expected,
    );
    assertRuntimeBoundary({
      candidateManifestFrozen:
        expected.runtimeAuthorization.boundary
          .candidateManifestFrozen,
      candidateSelectionPermitted:
        expected.runtimeAuthorization.boundary
          .candidateSelectionPermitted,
      codexRunReady:
        expected.runtimeAuthorization.boundary
          .codexRunReady,
      evaluationId:
        expected.runtimeAuthorization.evaluationId,
      formalCensusLiveNetworkPermitted:
        expected.runtimeAuthorization.boundary
          .formalCensusLiveNetworkPermitted,
    }, expected.evaluationId);
  } else {
    const authorization =
      await requireC6SourceV3SimpleCensusRuntimeAuthorization({
        activationReceiptBytes:
          input.activationReceiptBytes,
        repositoryRoot: input.repositoryRoot,
      });
    const preflight =
      await loadC6SourceV3SimpleCensusPreflight({
        repositoryRoot: input.repositoryRoot,
      });
    expected = expectedFrozenInputs(
      preflight,
      authorization,
    );
    assertRuntimeBoundary(
      authorization,
      expected.evaluationId,
    );
  }
  return await runC6SourceV3SimpleAuthorizedCensus({
    ...input,
    expected,
  });
}

/** @internal Activation is enforced by the formal entrypoint. */
export async function runC6SourceV3SimpleAuthorizedCensus(
  input: {
    assetRoot: string;
    authorizationTokenProvider:
      () => Promise<Uint8Array>;
    expected: C6SourceV3SimpleExpectedFrozenInputs;
    fetchImpl?: C6SourceV3SimpleFetch;
    now?: () => number;
    repositoryRoot: string;
    requestTimeoutMilliseconds?: number;
    waitUntil?: (notBefore: number) => Promise<void>;
  },
): Promise<C6SourceV3SimpleArtifactReference> {
  const { expected } = input;
  await mkdir(input.assetRoot, {
    mode: 0o700,
    recursive: true,
  });
  log("preflight-accepted", {
    assetRoot: input.assetRoot,
    evaluationId: expected.evaluationId,
  });
  const writer =
    await acquireC6SourceV3SimpleCensusWriterLock({
      assetRoot: input.assetRoot,
      evaluationId: expected.evaluationId,
      executionContractSha256:
        expected.executionContractSha256,
    });
  const authorizationTokenLease: {
    promise: Promise<Uint8Array> | null;
    token: Uint8Array | null;
  } = {
    promise: null,
    token: null,
  };
  const getAuthorizationToken =
    async (): Promise<Uint8Array> => {
      authorizationTokenLease.promise ??=
        input.authorizationTokenProvider();
      const token =
        await authorizationTokenLease.promise;
      if (token.length === 0) {
        throw new Error(
          "C6 source-v3-simple authorization token is empty",
        );
      }
      authorizationTokenLease.token = token;
      return token;
    };
  try {
    await recoverC6SourceV3SimplePendingArtifactTree(
      input.assetRoot,
    );
    const hasTerminal = await exists(
      input.assetRoot,
      "terminal.json",
    );
    const hasAssetLock = await exists(
      input.assetRoot,
      "asset-lock.json",
    );
    if (hasTerminal || hasAssetLock) {
      log(
        hasTerminal
          ? "terminal-resume"
          : "asset-lock-finalize-only",
        {},
      );
      await verifyC6SourceV3SimpleTerminalFinalizationState({
        assetRoot: input.assetRoot,
        expectedFrozenInputs: expected,
        repositoryRoot: input.repositoryRoot,
      });
      return await resumeTerminal({
        assetRoot: input.assetRoot,
        authorizationToken:
          await getAuthorizationToken(),
        expected,
        repositoryRoot: input.repositoryRoot,
      });
    }
    const hasFailureEvidence = await exists(
      input.assetRoot,
      "failure-evidence.json",
    );
    const hasCensusReceipt = await exists(
      input.assetRoot,
      "census-receipt.json",
    );
    if (hasFailureEvidence || hasCensusReceipt) {
      if (hasFailureEvidence === hasCensusReceipt) {
        throw new Error(
          "C6 source-v3-simple publication outcome is ambiguous before asset lock",
        );
      }
      await verifyC6SourceV3SimplePublicationOutcome({
        assetRoot: input.assetRoot,
        expectedFrozenInputs: expected,
      });
      const frozenInputClosure =
        await commitC6SourceV3SimpleFrozenInputClosure({
          assetRoot: input.assetRoot,
          expected,
        });
      const token = await getAuthorizationToken();
      await assertC6SourceV3SimpleTreeHasNoSecret({
        assetRoot: input.assetRoot,
        secret: token,
      });
      await writeC6SourceV3SimpleCensusAssetLock({
        assetRoot: input.assetRoot,
        expectedFrozenInputs: expected,
        frozenInputClosureSha256:
          frozenInputClosure.sha256,
      });
      return await resumeTerminal({
        assetRoot: input.assetRoot,
        authorizationToken: token,
        expected,
        repositoryRoot: input.repositoryRoot,
      });
    }
    const frozenInputClosure =
      await commitC6SourceV3SimpleFrozenInputClosure({
        assetRoot: input.assetRoot,
        expected,
      });
    try {
      await assertC6SourceV3SimpleFrozenInputsCurrent({
        expected,
        repositoryRoot: input.repositoryRoot,
      });
    } catch (error) {
      return await finalizeFailure({
        assetRoot: input.assetRoot,
        authorizationToken:
          await getAuthorizationToken(),
        chainTip: frozenInputClosure,
        error,
        expected,
        frozenInputClosure,
        repositoryRoot: input.repositoryRoot,
      });
    }
    return await runActiveCensus({
      ...input,
      authorizationTokenProvider:
        getAuthorizationToken,
      frozenInputClosure,
      hasAuthorizationToken: () =>
        authorizationTokenLease.token !== null,
    });
  } finally {
    zeroAuthorizationToken(
      authorizationTokenLease.token,
    );
    await writer.release();
  }
}

async function runActiveCensus(
  input: {
    assetRoot: string;
    authorizationTokenProvider:
      () => Promise<Uint8Array>;
    expected: C6SourceV3SimpleExpectedFrozenInputs;
    fetchImpl?: C6SourceV3SimpleFetch;
    frozenInputClosure:
      C6SourceV3SimpleArtifactReference;
    hasAuthorizationToken: () => boolean;
    now?: () => number;
    repositoryRoot: string;
    requestTimeoutMilliseconds?: number;
    waitUntil?:
      (notBefore: number) => Promise<void>;
  },
): Promise<C6SourceV3SimpleArtifactReference> {
  const { expected, frozenInputClosure } = input;
  let chainTip = frozenInputClosure;
  try {
    log("pass-start", { pass: "A" });
    const passA =
      await runC6SourceV3SimpleCensusPass({
        assetRoot: input.assetRoot,
        authorizationTokenProvider:
          input.authorizationTokenProvider,
        evaluationId: expected.evaluationId,
        executionContractSha256:
          expected.executionContractSha256,
        frozenInputClosureSha256:
          frozenInputClosure.sha256,
        fetchImpl: input.fetchImpl,
        frame: expected.frame,
        genesisSha256: ZERO_SHA256,
        now: input.now,
        onLogicalRequestComplete: (reference) => {
          chainTip = reference;
        },
        pass: "A",
        requestTimeoutMilliseconds:
          input.requestTimeoutMilliseconds,
        runtimeAuthorizationSha256:
          expected.runtimeAuthorizationSha256,
        waitUntil: input.waitUntil,
      });
    chainTip = passA.passComplete;
    log("pass-complete", {
      pass: "A",
      sha256: passA.passComplete.sha256,
    });
    log("pass-start", { pass: "B" });
    const passB =
      await runC6SourceV3SimpleCensusPass({
        assetRoot: input.assetRoot,
        authorizationTokenProvider:
          input.authorizationTokenProvider,
        evaluationId: expected.evaluationId,
        executionContractSha256:
          expected.executionContractSha256,
        frozenInputClosureSha256:
          frozenInputClosure.sha256,
        fetchImpl: input.fetchImpl,
        frame: expected.frame,
        genesisSha256: passA.passComplete.sha256,
        initialNotBefore:
          passA.nextRequestNotBefore,
        now: input.now,
        onLogicalRequestComplete: (reference) => {
          chainTip = reference;
        },
        pass: "B",
        requestTimeoutMilliseconds:
          input.requestTimeoutMilliseconds,
        runtimeAuthorizationSha256:
          expected.runtimeAuthorizationSha256,
        waitUntil: input.waitUntil,
      });
    chainTip = passB.passComplete;
    log("pass-complete", {
      pass: "B",
      sha256: passB.passComplete.sha256,
    });
    const {
      authorizationToken,
      equalityReceipt: equality,
    } =
      await writeC6SourceV3SimpleTwoPassEqualityReceipt({
        assetRoot: input.assetRoot,
        authorizationTokenProvider:
          input.authorizationTokenProvider,
        evaluationId: expected.evaluationId,
        executionContractSha256:
          expected.executionContractSha256,
        frame: expected.frame,
        frozenInputClosureSha256:
          frozenInputClosure.sha256,
        passAComplete: passA.passComplete,
        passBComplete: passB.passComplete,
        runtimeAuthorizationSha256:
          expected.runtimeAuthorizationSha256,
      });
    chainTip = equality;
    await assertC6SourceV3SimpleTreeHasNoSecret({
      assetRoot: input.assetRoot,
      secret: authorizationToken,
    });
    const censusReceipt =
      await writeC6SourceV3SimpleCensusReceipt({
        assetRoot: input.assetRoot,
        expectedFrozenInputs: expected,
        frozenInputClosure,
        passAComplete: passA.passComplete,
        passBComplete: passB.passComplete,
        repositoryRoot: input.repositoryRoot,
        twoPassEqualityReceipt: equality,
      });
    chainTip = censusReceipt;
    await verifyC6SourceV3SimplePublicationOutcome({
      assetRoot: input.assetRoot,
      expectedFrozenInputs: expected,
    });
    await writeC6SourceV3SimpleCensusAssetLock({
      assetRoot: input.assetRoot,
      expectedFrozenInputs: expected,
      frozenInputClosureSha256:
        frozenInputClosure.sha256,
    });
    return await resumeTerminal({
      assetRoot: input.assetRoot,
      authorizationToken,
      expected,
      repositoryRoot: input.repositoryRoot,
    });
  } catch (error) {
    if (
      !input.hasAuthorizationToken() &&
      !isC6SourceV3SimpleLedgerValidatedTerminalOutcome(
        error,
      )
    ) {
      throw error;
    }
    const authorizationToken =
      await input.authorizationTokenProvider();
    if (await exists(input.assetRoot, "asset-lock.json")) {
      return await resumeTerminal({
        assetRoot: input.assetRoot,
        authorizationToken,
        expected,
        repositoryRoot: input.repositoryRoot,
      });
    }
    if (
      await exists(
        input.assetRoot,
        "census-receipt.json",
      )
    ) {
      throw error;
    }
    return await finalizeFailure({
      assetRoot: input.assetRoot,
      authorizationToken,
      chainTip,
      error,
      expected,
      frozenInputClosure,
      repositoryRoot: input.repositoryRoot,
    });
  }
}

export function isC6SourceV3SimpleLedgerValidatedTerminalOutcome(
  error: unknown,
): error is
  | C6SourceV3SimplePartialResponseError
  | C6SourceV3SimpleProactivePauseExceededError
  | C6SourceV3SimpleTerminalAttemptError
  | C6SourceV3SimpleTwoPassMismatchError {
  return (
    error instanceof
      C6SourceV3SimplePartialResponseError ||
    error instanceof
      C6SourceV3SimpleProactivePauseExceededError ||
    error instanceof
      C6SourceV3SimpleTerminalAttemptError ||
    error instanceof
      C6SourceV3SimpleTwoPassMismatchError
  );
}

function zeroAuthorizationToken(
  token: Uint8Array | null,
): void {
  token?.fill(0);
}

function expectedFrozenInputs(
  preflight: C6SourceV3SimpleCensusPreflight,
  authorization: Awaited<
    ReturnType<
      typeof requireC6SourceV3SimpleCensusRuntimeAuthorization
    >
  >,
): C6SourceV3SimpleExpectedFrozenInputs {
  const contract = preflight.frozenInputs.find(
    (entry) => entry.label === "execution contract",
  );
  if (contract === undefined) {
    throw new Error(
      "C6 source-v3-simple execution contract binding is missing",
    );
  }
  const frozenInputs = [
    ...preflight.frozenInputs,
    {
      ...authorization.snapshot.activationBridge,
      label: "runtime activation bridge",
    },
    {
      ...authorization.snapshot.activationReceipt,
      label: "runtime activation receipt",
    },
    {
      ...authorization.snapshot.runtimeSourceManifest,
      label: "runtime source manifest",
    },
  ].map((entry) => ({
    bytes: entry.bytes,
    label: entry.label,
    path: entry.path,
    sha256: entry.sha256,
  }));
  const inputClosureSha256 = createHash("sha256")
    .update(JSON.stringify({
      frame: preflight.frame,
      frozenInputs,
      runtimeAuthorization:
        authorization.snapshot,
      runtimeAuthorizationSha256:
        authorization.runtimeAuthorizationSha256,
    }))
    .digest("hex");
  return {
    evaluationId: preflight.contract.evaluationId,
    executionContractSha256: contract.sha256,
    frame: preflight.frame,
    frozenInputs,
    inputClosureSha256,
    runtimeAuthorization:
      authorization.snapshot,
    runtimeAuthorizationSha256:
      authorization.runtimeAuthorizationSha256,
  };
}

function assertActivationReceiptBinding(
  activationReceiptBytes: string | Uint8Array,
  expected: C6SourceV3SimpleExpectedFrozenInputs,
): void {
  const bytes = Buffer.from(activationReceiptBytes);
  const reference =
    expected.runtimeAuthorization.activationReceipt;
  if (
    bytes.length !== reference.bytes ||
    createHash("sha256").update(bytes).digest("hex") !==
      reference.sha256
  ) {
    throw new Error(
      "C6 source-v3-simple durable activation receipt mismatch",
    );
  }
}

function assertRuntimeBoundary(
  input: {
    candidateManifestFrozen: boolean;
    candidateSelectionPermitted: boolean;
    codexRunReady: boolean;
    evaluationId: string;
    formalCensusLiveNetworkPermitted: boolean;
  },
  expectedEvaluationId: string,
): void {
  if (
    !input.formalCensusLiveNetworkPermitted ||
    input.candidateSelectionPermitted ||
    input.candidateManifestFrozen ||
    input.codexRunReady ||
    input.evaluationId !== expectedEvaluationId
  ) {
    throw new Error(
      "C6 source-v3-simple runtime activation boundary mismatch",
    );
  }
}

async function finalizeFailure(input: {
  assetRoot: string;
  authorizationToken: Uint8Array;
  chainTip: C6SourceV3SimpleArtifactReference;
  error: unknown;
  expected: C6SourceV3SimpleExpectedFrozenInputs;
  frozenInputClosure:
    C6SourceV3SimpleArtifactReference;
  repositoryRoot: string;
}): Promise<C6SourceV3SimpleArtifactReference> {
  await recoverC6SourceV3SimplePendingArtifactTree(
    input.assetRoot,
  );
  let failureCode: C6SourceV3SimpleFailureCode =
    classifyC6SourceV3SimpleFailureCode(input.error);
  // `secret-leak` records a trusted runtime guard
  // incident; its tip is the last durable artifact,
  // not independently replayable proof of the cause.
  let chainTip = errorChainTip(input.error) ??
    input.chainTip;
  try {
    await assertC6SourceV3SimpleFrozenInputsCurrent({
      expected: input.expected,
      repositoryRoot: input.repositoryRoot,
    });
  } catch {
    failureCode = "input-mutation";
    chainTip =
      await writeC6SourceV3SimpleFrozenInputMutationEvidence({
        assetRoot: input.assetRoot,
        expected: input.expected,
        frozenInputClosureSha256:
          input.frozenInputClosure.sha256,
        repositoryRoot: input.repositoryRoot,
      });
  }
  log("terminal-failure", {
    chainTip: chainTip.path,
    failureCode,
  });
  await assertC6SourceV3SimpleTreeHasNoSecret({
    assetRoot: input.assetRoot,
    secret: input.authorizationToken,
  });
  await writeC6SourceV3SimpleFailureEvidence({
    assetRoot: input.assetRoot,
    chainTip,
    expectedFrozenInputs: input.expected,
    failureCode,
    frozenInputClosure: input.frozenInputClosure,
  });
  await verifyC6SourceV3SimplePublicationOutcome({
    assetRoot: input.assetRoot,
    expectedFrozenInputs: input.expected,
  });
  await writeC6SourceV3SimpleCensusAssetLock({
    assetRoot: input.assetRoot,
    expectedFrozenInputs: input.expected,
    frozenInputClosureSha256:
      input.frozenInputClosure.sha256,
  });
  return await resumeC6SourceV3SimpleTerminalFromAssetLock({
    assetRoot: input.assetRoot,
    expectedFrozenInputs: input.expected,
    repositoryRoot: input.repositoryRoot,
    secret: input.authorizationToken,
  });
}

export function classifyC6SourceV3SimpleFailureCode(
  error: unknown,
): C6SourceV3SimpleFailureCode {
  if (
    error instanceof
      C6SourceV3SimplePartialResponseError
  ) {
    return "partial-response";
  }
  if (
    error instanceof
      C6SourceV3SimpleTerminalAttemptError
  ) {
    if (
      error.reason ===
        "maximum-attempts-exhausted"
    ) {
      return "maximum-attempts-exhausted";
    }
    return error.reason ===
      "terminal-transport-error"
      ? "transport-terminal"
      : "response-terminal";
  }
  if (
    error instanceof
      C6SourceV3SimpleProactivePauseExceededError
  ) {
    return "rate-limit-pause-exceeded";
  }
  if (
    error instanceof
      C6SourceV3SimpleTwoPassMismatchError
  ) {
    return "two-pass-mismatch";
  }
  if (
    error instanceof
      C6SourceV3SimpleSecretLeakError
  ) {
    return "secret-leak";
  }
  const message = error instanceof Error
    ? error.message
    : "";
  if (
    message.includes("retry pause exceeds maximum") ||
    message.includes("Retry-After exceeds maximum")
  ) {
    return "rate-limit-pause-exceeded";
  }
  if (
    message.includes("ledger") ||
    message.includes("attempt chain") ||
    message.includes("truncated") ||
    message.includes("corrupt")
  ) {
    return "corrupt-ledger";
  }
  return "publication-failure";
}

function errorChainTip(
  error: unknown,
): C6SourceV3SimpleArtifactReference | null {
  if (
    error instanceof
      C6SourceV3SimplePartialResponseError ||
    error instanceof
      C6SourceV3SimpleProactivePauseExceededError ||
    error instanceof
      C6SourceV3SimpleTerminalAttemptError ||
    error instanceof
      C6SourceV3SimpleTwoPassMismatchError
  ) {
    return error.chainTip;
  }
  return null;
}

async function resumeTerminal(input: {
  assetRoot: string;
  authorizationToken: Uint8Array;
  expected: C6SourceV3SimpleExpectedFrozenInputs;
  repositoryRoot: string;
}): Promise<C6SourceV3SimpleArtifactReference> {
  const terminal =
    await resumeC6SourceV3SimpleTerminalFromAssetLock({
      assetRoot: input.assetRoot,
      expectedFrozenInputs: input.expected,
      repositoryRoot: input.repositoryRoot,
      secret: input.authorizationToken,
    });
  log("terminal-verified", {
    sha256: terminal.sha256,
  });
  return terminal;
}

async function exists(
  root: string,
  path: string,
): Promise<boolean> {
  try {
    const stats = await lstat(`${root}/${path}`);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(
        `C6 source-v3-simple publication path is not a regular file: ${path}`,
      );
    }
    return true;
  } catch (error) {
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

function log(
  event: string,
  details: Readonly<Record<string, unknown>>,
): void {
  process.stderr.write(`${JSON.stringify({
    event: `c6-source-v3-simple-${event}`,
    ...details,
  })}\n`);
}
