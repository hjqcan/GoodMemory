import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
} from "node:fs/promises";
import {
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  buildC6SourceV3SimpleCensusExecutionContract,
} from "./c6-source-v3-simple-census-contract";
import {
  C6SourceV3SimpleProactivePauseExceededError,
} from "./c6-source-v3-simple-census-errors";
import {
  computeC6SourceV3SimpleLogicalRequestIdentitySha256,
  inspectC6SourceV3SimpleAttempt,
  prepareC6SourceV3SimpleAttempt,
  readC6SourceV3SimpleLogicalRequestEvidence,
  replayC6SourceV3SimpleLogicalRequestCompleteFromExistingResult,
  recordC6SourceV3SimpleProcessInterruption,
  recordC6SourceV3SimpleResponseComplete,
  recordC6SourceV3SimpleResponseStarted,
  recordC6SourceV3SimpleTransportError,
  settleC6SourceV3SimpleAttemptFromLedger,
  writeC6SourceV3SimpleLogicalRequestComplete,
} from "./c6-source-v3-simple-census-ledger";
import type {
  C6SourceV3SimpleArtifactReference,
  C6SourceV3SimpleAttemptContext,
} from "./c6-source-v3-simple-census-ledger";
import type {
  C6SourceV3SimpleProjectedLogicalRequest,
} from "./c6-source-v3-simple-census-replay";
import {
  deriveC6SourceV3SimpleProactivePause,
} from "./c6-source-v3-simple-census-transport";
import type {
  C6SourceV3SimpleDurableGraphqlRequest,
} from "./c6-source-v3-simple-census-transport";

const CENSUS_EXECUTION_CONTRACT =
  buildC6SourceV3SimpleCensusExecutionContract();
const SELECTED_RESPONSE_HEADERS = new Set<string>(
  CENSUS_EXECUTION_CONTRACT
    .transport.selectedResponseHeaders,
);
const DEFAULT_MAXIMUM_RESPONSE_BODY_BYTES =
  64 * 1_024 * 1_024;

export type C6SourceV3SimpleFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class C6SourceV3SimplePartialResponseError
  extends Error {
  readonly chainTip: C6SourceV3SimpleArtifactReference;

  constructor(
    chainTip: C6SourceV3SimpleArtifactReference,
  ) {
    super(
      "C6 source-v3-simple response body failed after response-started",
    );
    this.name =
      "C6SourceV3SimplePartialResponseError";
    this.chainTip = chainTip;
  }
}

export class C6SourceV3SimpleTerminalAttemptError
  extends Error {
  readonly chainTip: C6SourceV3SimpleArtifactReference;
  readonly reason: string;

  constructor(
    chainTip: C6SourceV3SimpleArtifactReference,
    reason: string,
  ) {
    super(
      `C6 source-v3-simple logical request terminated: ${reason}`,
    );
    this.name =
      "C6SourceV3SimpleTerminalAttemptError";
    this.chainTip = chainTip;
    this.reason = reason;
  }
}

export async function executeC6SourceV3SimpleLogicalRequest(
  input: {
    assetRoot: string;
    authorizationTokenProvider:
      () => Promise<Uint8Array>;
    evaluationId: string;
    executionContractSha256: string;
    frozenInputClosureSha256: string;
    fetchImpl?: C6SourceV3SimpleFetch;
    localOnly?: boolean;
    logicalRequestOrdinal: number;
    maximumResponseBodyBytes?: number;
    now?: () => number;
    pass: "A" | "B";
    passRoot: string;
    prepareDispatch?: () => Promise<{
      maximumResponseBodyBytes: number;
    }>;
    priorLogicalRequestCompletionSha256: string;
    request: C6SourceV3SimpleDurableGraphqlRequest;
    requestTimeoutMilliseconds?: number;
    runtimeAuthorizationSha256: string;
    waitUntil?: (notBefore: number) => Promise<void>;
  },
): Promise<{
  attempts: C6SourceV3SimpleArtifactReference[];
  completion: C6SourceV3SimpleArtifactReference;
  pacing: {
    receivedAt: string;
    responseDate: string;
    remaining: number;
    resetUnixSeconds: number;
  };
  projectedRequest:
    C6SourceV3SimpleProjectedLogicalRequest;
  replayedExistingResult: boolean;
}> {
  assertPassRoot(input.assetRoot, input.passRoot);
  const maximumResponseBodyBytes =
    assertMaximumResponseBodyBytes(
      input.maximumResponseBodyBytes ??
        DEFAULT_MAXIMUM_RESPONSE_BODY_BYTES,
    );
  const now = input.now ?? Date.now;
  const waitUntil = input.waitUntil ??
    defaultWaitUntil;
  let authorizationToken: Uint8Array | null = null;
  const getAuthorizationToken =
    async (): Promise<Uint8Array> => {
      authorizationToken ??=
        await input.authorizationTokenProvider();
      if (authorizationToken.length === 0) {
        throw new Error(
          "C6 source-v3-simple authorization token is empty",
        );
      }
      return authorizationToken;
    };
  const existing = await readExistingCompletion(
    input,
  );
  if (existing !== null) {
    return {
      ...existing,
      replayedExistingResult: false,
    };
  }
  const requestIdentity =
    computeC6SourceV3SimpleLogicalRequestIdentitySha256({
      evaluationId: input.evaluationId,
      executionContractSha256:
        input.executionContractSha256,
      frozenInputClosureSha256:
        input.frozenInputClosureSha256,
      logicalRequestOrdinal:
        input.logicalRequestOrdinal,
      pass: input.pass,
      request: input.request,
      runtimeAuthorizationSha256:
        input.runtimeAuthorizationSha256,
    });
  const logicalRoot = join(
    input.passRoot,
    `logical-request-${
      String(input.logicalRequestOrdinal).padStart(
        8,
        "0",
      )
    }`,
  );
  if (
    await existingProjectedResultExists(
      input.passRoot,
      input.logicalRequestOrdinal,
    )
  ) {
    const attemptRoots =
      await readLocalCompletionAttemptRoots(
        logicalRoot,
      );
    await replayC6SourceV3SimpleLogicalRequestCompleteFromExistingResult({
      assetRoot: input.assetRoot,
      attemptRoots,
      evaluationId: input.evaluationId,
      executionContractSha256:
        input.executionContractSha256,
      frozenInputClosureSha256:
        input.frozenInputClosureSha256,
      logicalRequestIdentitySha256:
        requestIdentity,
      logicalRequestOrdinal:
        input.logicalRequestOrdinal,
      pass: input.pass,
      passRoot: input.passRoot,
      priorLogicalRequestCompletionSha256:
        input.priorLogicalRequestCompletionSha256,
      runtimeAuthorizationSha256:
        input.runtimeAuthorizationSha256,
    });
    const replayed = await readExistingCompletion(
      input,
    );
    if (replayed === null) {
      throw new Error(
        "C6 source-v3-simple local completion replay did not write completion",
      );
    }
    return {
      ...replayed,
      replayedExistingResult: true,
    };
  }
  if (input.localOnly) {
    throw new Error(
      "C6 source-v3-simple active pass requires local-only replay",
    );
  }
  const attempts: Array<{
    artifact: C6SourceV3SimpleArtifactReference;
    attemptRoot: string;
  }> = [];
  let priorAttemptCommitSha256: string | null = null;
  for (
    let attemptNumber = 1;
    attemptNumber <= 4;
    attemptNumber += 1
  ) {
    const context: C6SourceV3SimpleAttemptContext = {
      attemptNumber,
      attemptRoot: join(
        logicalRoot,
        `attempt-${
          String(attemptNumber).padStart(2, "0")
        }`,
      ),
      evaluationId: input.evaluationId,
      executionContractSha256:
        input.executionContractSha256,
      frozenInputClosureSha256:
        input.frozenInputClosureSha256,
      logicalRequestIdentitySha256:
        requestIdentity,
      logicalRequestOrdinal:
        input.logicalRequestOrdinal,
      pass: input.pass,
      priorAttemptCommitSha256,
      priorLogicalRequestCompletionSha256:
        input.priorLogicalRequestCompletionSha256,
      runtimeAuthorizationSha256:
        input.runtimeAuthorizationSha256,
    };
    let state = await inspectC6SourceV3SimpleAttempt(
      context,
    );
    if (state.kind === "not-started") {
      const dispatchMaximumResponseBodyBytes =
        input.prepareDispatch === undefined
          ? maximumResponseBodyBytes
          : assertMaximumResponseBodyBytes(
              (
                await input.prepareDispatch()
              ).maximumResponseBodyBytes,
            );
      const prepared =
        await prepareC6SourceV3SimpleAttempt({
          context,
          request: input.request,
        });
      try {
        const token = await getAuthorizationToken();
        await dispatchAttempt({
          authorizationToken: token,
          context,
          fetchImpl: input.fetchImpl ?? fetch,
          maximumResponseBodyBytes:
            dispatchMaximumResponseBodyBytes,
          now,
          request: input.request,
          requestCommitted:
            prepared.requestCommitted,
          requestTimeoutMilliseconds:
            input.requestTimeoutMilliseconds ??
            60_000,
        });
      } catch (error) {
        if (
          error instanceof
            C6SourceV3SimplePartialResponseError
        ) {
          throw new C6SourceV3SimplePartialResponseError(
            rebaseReference(
              input.assetRoot,
              context.attemptRoot,
              error.chainTip,
            ),
          );
        }
        throw error;
      }
    } else if (
      state.kind === "interrupted-before-response"
    ) {
      await recordC6SourceV3SimpleProcessInterruption({
        context,
        occurredAt: timestamp(now()),
        requestCommitted: state.requestCommitted,
      });
    } else if (
      state.kind === "terminal-partial-response"
    ) {
      throw new C6SourceV3SimplePartialResponseError(
        rebaseReference(
          input.assetRoot,
          context.attemptRoot,
          state.responseStarted,
        ),
      );
    }
    state = await inspectC6SourceV3SimpleAttempt(
      context,
    );
    if (
      state.kind === "terminal-partial-response"
    ) {
      throw new C6SourceV3SimplePartialResponseError(
        rebaseReference(
          input.assetRoot,
          context.attemptRoot,
          state.responseStarted,
        ),
      );
    }
    const settled =
      await settleC6SourceV3SimpleAttemptFromLedger(
        context,
      );
    attempts.push({
      artifact: settled.attempt,
      attemptRoot: context.attemptRoot,
    });
    if (settled.outcome === "stop-terminal") {
      throw new C6SourceV3SimpleTerminalAttemptError(
        rebaseReference(
          input.assetRoot,
          context.attemptRoot,
          settled.attempt,
        ),
        settled.reason,
      );
    }
    if (settled.outcome === "retry") {
      if (settled.notBefore === null) {
        throw new Error(
          "C6 source-v3-simple retry has no not-before",
        );
      }
      const target = Date.parse(settled.notBefore);
      if (now() < target) {
        await waitUntil(target);
      }
      priorAttemptCommitSha256 =
        settled.attempt.sha256;
      continue;
    }
    const completion =
      await writeC6SourceV3SimpleLogicalRequestComplete({
        assetRoot: input.assetRoot,
        attempts,
        evaluationId: input.evaluationId,
    executionContractSha256:
      input.executionContractSha256,
    frozenInputClosureSha256:
      input.frozenInputClosureSha256,
        logicalRequestIdentitySha256:
          requestIdentity,
        logicalRequestOrdinal:
          input.logicalRequestOrdinal,
        pass: input.pass,
        passRoot: input.passRoot,
    priorLogicalRequestCompletionSha256:
      input.priorLogicalRequestCompletionSha256,
    runtimeAuthorizationSha256:
      input.runtimeAuthorizationSha256,
      });
    const completionChainTip = rebaseReference(
      input.assetRoot,
      input.passRoot,
      completion,
    );
    const evidence =
      await readC6SourceV3SimpleLogicalRequestEvidence(
        input.assetRoot,
        completionChainTip,
      );
    assertVerifiedProactivePauseWithinLimit({
      chainTip: completionChainTip,
      pacing: evidence.pacing,
    });
    return {
      attempts: attempts.map(
        (attempt) => attempt.artifact,
      ),
      completion,
      pacing: evidence.pacing,
      projectedRequest:
        evidence.projectedRequest,
      replayedExistingResult: false,
    };
  }
  throw new Error(
    "C6 source-v3-simple logical request exceeded maximum attempts",
  );
}

function assertMaximumResponseBodyBytes(
  value: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new Error(
      "C6 source-v3-simple maximum response body bytes must be a positive safe integer",
    );
  }
  return value;
}

function assertPassRoot(
  assetRootInput: string,
  passRootInput: string,
): void {
  const assetRoot = resolve(assetRootInput);
  const passRoot = resolve(passRootInput);
  const path = relative(assetRoot, passRoot);
  if (
    path.length === 0 ||
    path === ".." ||
    path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(path)
  ) {
    throw new Error(
      "C6 source-v3-simple pass root escapes asset root",
    );
  }
}

async function dispatchAttempt(
  input: {
    authorizationToken: Uint8Array;
    context: C6SourceV3SimpleAttemptContext;
    fetchImpl: C6SourceV3SimpleFetch;
    maximumResponseBodyBytes: number;
    now: () => number;
    request: C6SourceV3SimpleDurableGraphqlRequest;
    requestCommitted:
      C6SourceV3SimpleArtifactReference;
    requestTimeoutMilliseconds: number;
  },
): Promise<void> {
  const dispatchToken = Uint8Array.from(
    input.authorizationToken,
  );
  const token = decodeToken(dispatchToken);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.requestTimeoutMilliseconds,
  );
  timeout.unref?.();
  try {
    let response: Response;
    try {
      response = await input.fetchImpl(
        input.request.persistedRequest.endpoint,
        {
          body: Uint8Array.from(
            input.request.body,
          ).buffer,
          headers: {
            ...input.request.persistedRequest.headers,
            authorization: `Bearer ${token}`,
          },
          method: "POST",
          redirect: "error",
          signal: controller.signal,
        },
      );
    } catch (error) {
      await recordC6SourceV3SimpleTransportError({
        code: controller.signal.aborted
          ? "C6_REQUEST_TIMEOUT"
          : errorCode(error),
        context: input.context,
        message: controller.signal.aborted
          ? "request timeout"
          : "network dispatch failed",
        name: errorName(error),
        occurredAt: timestamp(input.now()),
        phase: controller.signal.aborted
          ? "timeout"
          : "fetch",
        requestCommitted:
          input.requestCommitted,
        secret: dispatchToken,
      });
      return;
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      if (SELECTED_RESPONSE_HEADERS.has(name)) {
        headers[name] = value;
      }
    });
    const responseStarted =
      await recordC6SourceV3SimpleResponseStarted({
        context: input.context,
        headers,
        httpStatus: response.status,
        receivedAt: timestamp(input.now()),
        requestCommitted:
          input.requestCommitted,
        secret: dispatchToken,
      });
    let body: Uint8Array;
    try {
      body = await readBoundedResponseBody({
        maximumBytes:
          input.maximumResponseBodyBytes,
        response,
      });
    } catch {
      throw new C6SourceV3SimplePartialResponseError(
        responseStarted.responseStarted,
      );
    }
    await recordC6SourceV3SimpleResponseComplete({
      body,
      context: input.context,
      responseStarted:
        responseStarted.responseStarted,
      secret: dispatchToken,
    });
  } finally {
    clearTimeout(timeout);
    dispatchToken.fill(0);
  }
}

async function readBoundedResponseBody(
  input: {
    maximumBytes: number;
    response: Response;
  },
): Promise<Uint8Array> {
  const declaredLength =
    input.response.headers.get(
      "content-length",
    );
  if (
    declaredLength !== null &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) >
      input.maximumBytes
  ) {
    void input.response.body
      ?.cancel()
      .catch(() => undefined);
    throw new Error(
      "C6 source-v3-simple response body exceeds byte limit",
    );
  }
  if (input.response.body === null) {
    return new Uint8Array();
  }
  const reader =
    input.response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } =
        await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (
        totalBytes >
          input.maximumBytes
      ) {
        void reader
          .cancel(
            "C6 source-v3-simple response body exceeds byte limit",
          )
          .catch(() => undefined);
        throw new Error(
          "C6 source-v3-simple response body exceeds byte limit",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function existingProjectedResultExists(
  passRoot: string,
  logicalRequestOrdinal: number,
): Promise<boolean> {
  try {
    await lstat(join(
      passRoot,
      `logical-request-result-${
        String(logicalRequestOrdinal).padStart(
          8,
          "0",
        )
      }.json`,
    ));
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function readLocalCompletionAttemptRoots(
  logicalRoot: string,
): Promise<string[]> {
  try {
    const stats = await lstat(logicalRoot);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink()
    ) {
      throw new Error(
        "logical request root is not a regular directory",
      );
    }
    const entries = await readdir(logicalRoot, {
      withFileTypes: true,
    });
    const names = entries
      .filter((entry) =>
        entry.isDirectory() &&
        /^attempt-\d{2}$/u.test(entry.name)
      )
      .map((entry) => entry.name)
      .sort();
    const expected = Array.from(
      { length: names.length },
      (_, index) =>
        `attempt-${
          String(index + 1).padStart(2, "0")
        }`,
    );
    if (
      names.length < 1 ||
      names.length > 4 ||
      names.length !== entries.length ||
      !isDeepStrictEqual(names, expected)
    ) {
      throw new Error(
        "logical request attempt directory closure mismatch",
      );
    }
    return names.map((name) =>
      join(logicalRoot, name)
    );
  } catch (cause) {
    throw new Error(
      "C6 source-v3-simple existing projected result is not locally finalizable",
      {
        cause,
      },
    );
  }
}

async function readExistingCompletion(
  input: {
    assetRoot: string;
    evaluationId: string;
    executionContractSha256: string;
    frozenInputClosureSha256: string;
    logicalRequestOrdinal: number;
    pass: "A" | "B";
    passRoot: string;
    priorLogicalRequestCompletionSha256: string;
    request: C6SourceV3SimpleDurableGraphqlRequest;
    runtimeAuthorizationSha256: string;
  },
): Promise<{
  attempts: C6SourceV3SimpleArtifactReference[];
  completion: C6SourceV3SimpleArtifactReference;
  pacing: {
    receivedAt: string;
    responseDate: string;
    remaining: number;
    resetUnixSeconds: number;
  };
  projectedRequest:
    C6SourceV3SimpleProjectedLogicalRequest;
} | null> {
  const name = `logical-request-complete-${
    String(input.logicalRequestOrdinal).padStart(
      8,
      "0",
    )
  }.json`;
  const path = join(input.passRoot, name);
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(
        "C6 source-v3-simple existing completion is not a regular file",
      );
    }
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
  const bytes = await readFile(path);
  const local = {
    bytes: bytes.length,
    path: name,
    sha256: createHash("sha256")
      .update(bytes)
      .digest("hex"),
  };
  const completion = rebaseReference(
    input.assetRoot,
    input.passRoot,
    local,
  );
  const evidence =
    await readC6SourceV3SimpleLogicalRequestEvidence(
      input.assetRoot,
      completion,
    );
  const expectedLogicalRequestIdentitySha256 =
    computeC6SourceV3SimpleLogicalRequestIdentitySha256({
      evaluationId: input.evaluationId,
      executionContractSha256:
        input.executionContractSha256,
      frozenInputClosureSha256:
        input.frozenInputClosureSha256,
      logicalRequestOrdinal:
        input.logicalRequestOrdinal,
      pass: input.pass,
      request: input.request,
      runtimeAuthorizationSha256:
        input.runtimeAuthorizationSha256,
    });
  if (
    evidence.completion.evaluationId !==
      input.evaluationId ||
    evidence.completion.executionContractSha256 !==
      input.executionContractSha256 ||
    evidence.completion.frozenInputClosureSha256 !==
      input.frozenInputClosureSha256 ||
    evidence.completion.logicalRequestIdentitySha256 !==
      expectedLogicalRequestIdentitySha256 ||
    evidence.completion.logicalRequestOrdinal !==
      input.logicalRequestOrdinal ||
    evidence.completion.pass !== input.pass ||
    evidence.completion
      .priorLogicalRequestCompletionSha256 !==
      input.priorLogicalRequestCompletionSha256 ||
    evidence.completion.runtimeAuthorizationSha256 !==
      input.runtimeAuthorizationSha256 ||
    !evidence.projectedRequest.request.body.equals(
      input.request.body,
    ) ||
    !isDeepStrictEqual(
      evidence.projectedRequest.request.persistedRequest,
      input.request.persistedRequest,
    )
  ) {
    throw new Error(
      "C6 source-v3-simple existing completion context or request mismatch",
    );
  }
  assertVerifiedProactivePauseWithinLimit({
    chainTip: completion,
    pacing: evidence.pacing,
  });
  return {
    attempts: evidence.completion.attempts.map(
      (attempt) => attempt.artifact,
    ),
    completion: local,
    pacing: evidence.pacing,
    projectedRequest:
      evidence.projectedRequest,
  };
}

function assertVerifiedProactivePauseWithinLimit(
  input: {
    chainTip: C6SourceV3SimpleArtifactReference;
    pacing: {
      receivedAt: string;
      remaining: number;
      resetUnixSeconds: number;
      responseDate: string;
    };
  },
): void {
  const proactivePause =
    deriveC6SourceV3SimpleProactivePause({
      receivedAtMilliseconds: Date.parse(
        input.pacing.receivedAt,
      ),
      remaining: input.pacing.remaining,
      resetUnixSeconds:
        input.pacing.resetUnixSeconds,
      responseDate: input.pacing.responseDate,
    });
  if (proactivePause.exceedsMaximum) {
    throw new C6SourceV3SimpleProactivePauseExceededError(
      input.chainTip,
    );
  }
}

function rebaseReference(
  assetRoot: string,
  localRoot: string,
  reference: C6SourceV3SimpleArtifactReference,
): C6SourceV3SimpleArtifactReference {
  const prefix = relative(assetRoot, localRoot)
    .split("\\")
    .join("/");
  return {
    ...reference,
    path: prefix.length === 0
      ? reference.path
      : `${prefix}/${reference.path}`,
  };
}

function decodeToken(tokenInput: Uint8Array): string {
  const token = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(tokenInput);
  if (
    token.length === 0 ||
    /[\u0000-\u0020\u007f]/u.test(token)
  ) {
    throw new Error(
      "C6 source-v3-simple authorization token is invalid",
    );
  }
  return token;
}

function timestamp(milliseconds: number): string {
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 0
  ) {
    throw new Error(
      "C6 source-v3-simple clock is invalid",
    );
  }
  return new Date(milliseconds).toISOString();
}

async function defaultWaitUntil(
  notBefore: number,
): Promise<void> {
  while (Date.now() < notBefore) {
    const duration = Math.min(
      60_000,
      notBefore - Date.now(),
    );
    process.stderr.write(`${JSON.stringify({
      event: "c6-source-v3-simple-wait",
      notBefore: new Date(notBefore).toISOString(),
      remainingMilliseconds: duration,
    })}\n`);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, duration);
    });
  }
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
    ? error.code
    : null;
}

function errorName(error: unknown): string {
  return error instanceof Error
    ? error.name
    : "Error";
}

function hasErrorCode(
  error: unknown,
  code: string,
): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code;
}
