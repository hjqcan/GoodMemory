import { createHash } from "node:crypto";
import {
  constants,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";
import {
  buildC6SourceV3SimpleCensusExecutionContract,
} from "./c6-source-v3-simple-census-contract";
import {
  C6SourceV3SimpleSecretLeakError,
} from "./c6-source-v3-simple-census-errors";
import {
  C6SourceV3SimpleGraphqlResponseError,
  projectC6SourceV3SimplePullRequestPage,
  projectC6SourceV3SimpleRepositoryCount,
  projectC6SourceV3SimpleRepositoryPage,
} from "./c6-source-v3-simple-census-graphql";
import type {
  C6SourceV3SimpleProjectedLogicalRequest,
} from "./c6-source-v3-simple-census-replay";
import type {
  C6SourceV3SimpleDurableGraphqlRequest,
} from "./c6-source-v3-simple-census-transport";
import {
  assertC6SourceV3SimpleRateLimitConsistency,
  computeC6SourceV3SimpleRetryNotBefore,
  deriveC6SourceV3SimpleRateLimitMode,
  verifyC6SourceV3SimpleDurableGraphqlRequest,
} from "./c6-source-v3-simple-census-transport";

const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const contextSchema = z.object({
  attemptNumber: z.number().int().min(1).max(4),
  evaluationId: z.string().min(1),
  executionContractSha256: sha256Schema,
  frozenInputClosureSha256: sha256Schema,
  logicalRequestIdentitySha256: sha256Schema,
  logicalRequestOrdinal: z.number().int().positive(),
  pass: z.enum(["A", "B"]),
  runtimeAuthorizationSha256: sha256Schema,
}).strict();
const requestCommittedSchema = contextSchema.extend({
  artifactKind: z.literal(
    "c6-source-v3-simple-request-committed",
  ),
  priorAttemptCommitSha256: sha256Schema.nullable(),
  priorLogicalRequestCompletionSha256: sha256Schema,
  request: artifactReferenceSchema,
  requestBody: artifactReferenceSchema,
  schemaVersion: z.literal(1),
}).strict();
const responseStartedSchema = contextSchema.extend({
  artifactKind: z.literal(
    "c6-source-v3-simple-response-started",
  ),
  headers: z.record(z.string(), z.string()),
  httpStatus: z.number().int().min(100).max(599),
  receivedAt: z.string().datetime({
    offset: false,
    precision: 3,
  }),
  requestCommittedSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();
const responseCompleteSchema = contextSchema.extend({
  artifactKind: z.literal(
    "c6-source-v3-simple-response-complete",
  ),
  responseBody: artifactReferenceSchema,
  responseStartedSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();
const retryReasonSchema = z.enum([
  "graphql-success",
  "maximum-attempts-exhausted",
  "process-interruption-before-response",
  "retryable-graphql-errors",
  "retryable-http-status",
  "retryable-transport-code",
  "terminal-graphql-errors",
  "terminal-http-status",
  "terminal-response-schema",
  "terminal-transport-error",
]);
const retryDecisionSchema = contextSchema.extend({
  artifactKind: z.literal(
    "c6-source-v3-simple-retry-decision",
  ),
  basisArtifactSha256: sha256Schema,
  decision: z.enum([
    "retry",
    "stop-success",
    "stop-terminal",
  ]),
  notBefore: z.string().datetime({
    offset: false,
    precision: 3,
  }).nullable(),
  reason: retryReasonSchema,
  schemaVersion: z.literal(1),
}).strict().superRefine((value, context) => {
  if (
    (value.decision === "retry") !==
      (value.notBefore !== null)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "retry decision not-before does not match decision",
    });
  }
});
const transportErrorSchema = contextSchema.extend({
  artifactKind: z.literal(
    "c6-source-v3-simple-transport-error",
  ),
  code: z.string().min(1).nullable(),
  message: z.string().min(1),
  name: z.string().min(1),
  occurredAt: z.string().datetime({
    offset: false,
    precision: 3,
  }),
  phase: z.enum([
    "fetch",
    "timeout",
    "process-interruption-before-response",
  ]),
  requestCommittedSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();
const attemptSchema = contextSchema.extend({
  artifactKind: z.literal(
    "c6-source-v3-simple-attempt",
  ),
  outcome: z.enum([
    "retry",
    "stop-success",
    "stop-terminal",
  ]),
  priorAttemptCommitSha256: sha256Schema.nullable(),
  requestCommitted: artifactReferenceSchema,
  responseComplete: artifactReferenceSchema.nullable(),
  responseStarted: artifactReferenceSchema.nullable(),
  retryDecision: artifactReferenceSchema,
  schemaVersion: z.literal(1),
  transportError: artifactReferenceSchema.nullable(),
}).strict();
const logicalRequestCompleteSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-logical-request-complete",
  ),
  attempts: z.array(z.object({
    artifact: artifactReferenceSchema,
    attemptNumber: z.number().int().min(1).max(4),
  }).strict()).min(1).max(4),
  evaluationId: z.string().min(1),
  executionContractSha256: sha256Schema,
  frozenInputClosureSha256: sha256Schema,
  logicalRequestIdentitySha256: sha256Schema,
  logicalRequestOrdinal: z.number().int().positive(),
  operationName: z.enum([
    "C6SourceV3SimplePullRequestPage",
    "C6SourceV3SimpleRepositoryCount",
    "C6SourceV3SimpleRepositoryPage",
  ]),
  pass: z.enum(["A", "B"]),
  priorLogicalRequestCompletionSha256: sha256Schema,
  projectedResult: artifactReferenceSchema,
  runtimeAuthorizationSha256: sha256Schema,
  schemaVersion: z.literal(1),
  successfulAttemptSha256: sha256Schema,
}).strict();
const projectedResultSchema = z.object({
  artifactKind: z.literal(
    "c6-source-v3-simple-projected-result",
  ),
  evaluationId: z.string().min(1),
  executionContractSha256: sha256Schema,
  frozenInputClosureSha256: sha256Schema,
  logicalRequestIdentitySha256: sha256Schema,
  logicalRequestOrdinal: z.number().int().positive(),
  operationName: z.enum([
    "C6SourceV3SimplePullRequestPage",
    "C6SourceV3SimpleRepositoryCount",
    "C6SourceV3SimpleRepositoryPage",
  ]),
  pass: z.enum(["A", "B"]),
  result: z.unknown(),
  runtimeAuthorizationSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();

export interface C6SourceV3SimpleArtifactReference {
  bytes: number;
  path: string;
  sha256: string;
}

export interface C6SourceV3SimpleAttemptContext {
  attemptNumber: number;
  attemptRoot: string;
  evaluationId: string;
  executionContractSha256: string;
  frozenInputClosureSha256: string;
  logicalRequestIdentitySha256: string;
  logicalRequestOrdinal: number;
  pass: "A" | "B";
  priorAttemptCommitSha256: string | null;
  priorLogicalRequestCompletionSha256: string;
  runtimeAuthorizationSha256: string;
}

export interface C6SourceV3SimpleFailureChainTipContext {
  artifactKind:
    | "c6-source-v3-simple-attempt"
    | "c6-source-v3-simple-response-started";
  attemptNumber: number;
  evaluationId: string;
  executionContractSha256: string;
  frozenInputClosureSha256: string;
  logicalRequestOrdinal: number;
  pass: "A" | "B";
  priorLogicalRequestCompletionSha256: string;
  reason: z.infer<typeof retryReasonSchema> | null;
  runtimeAuthorizationSha256: string;
}

type WithoutRequest<T> = T extends unknown
  ? Omit<T, "request">
  : never;
type C6SourceV3SimpleProjection =
  WithoutRequest<
    C6SourceV3SimpleProjectedLogicalRequest
  >;

export async function commitC6SourceV3SimpleCreateOnlyBytes(
  root: string,
  path: string,
  bytes: Uint8Array,
): Promise<C6SourceV3SimpleArtifactReference> {
  await prepareAttemptRoot(root);
  return await commitOrVerifyCreateOnlyBytes(
    root,
    path,
    bytes,
  );
}

export async function commitC6SourceV3SimpleCreateOnlyCanonicalJson(
  root: string,
  path: string,
  value: unknown,
): Promise<C6SourceV3SimpleArtifactReference> {
  await prepareAttemptRoot(root);
  return await commitOrVerifyCreateOnlyMarker(
    root,
    path,
    value,
  );
}

export async function recoverC6SourceV3SimplePendingArtifacts(
  root: string,
): Promise<void> {
  await prepareAttemptRoot(root);
}

export async function recoverC6SourceV3SimplePendingArtifactTree(
  root: string,
): Promise<void> {
  await recoverPendingArtifactTree(root, root);
}

async function recoverPendingArtifactTree(
  assetRoot: string,
  root: string,
): Promise<void> {
  await prepareAttemptRoot(root, false);
  const relativeRoot = relative(
    resolve(assetRoot),
    resolve(root),
  );
  await recoverPendingFiles(
    root,
    (name) =>
      isKnownPendingArtifactAtPath(
        relativeRoot,
        name,
      ),
  );
  const entries = await readdir(root, {
    withFileTypes: true,
  });
  entries.sort((left, right) =>
    Buffer.compare(
      Buffer.from(left.name),
      Buffer.from(right.name),
    )
  );
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(
        "C6 source-v3-simple pending artifact tree rejects symlink",
      );
    }
    if (entry.isDirectory()) {
      if (
        !isKnownAssetDirectory(
          relativeRoot,
          entry.name,
        )
      ) {
        throw new Error(
          "C6 source-v3-simple pending artifact tree rejects unknown directory",
        );
      }
      await recoverPendingArtifactTree(
        assetRoot,
        join(root, entry.name),
      );
    } else if (!entry.isFile()) {
      throw new Error(
        "C6 source-v3-simple pending artifact tree rejects non-file",
      );
    }
  }
}

export type C6SourceV3SimpleAttemptResumeState =
  | {
      kind: "not-started";
    }
  | {
      kind: "interrupted-before-response";
      requestCommitted: C6SourceV3SimpleArtifactReference;
    }
  | {
      kind: "terminal-partial-response";
      responseStarted: C6SourceV3SimpleArtifactReference;
    }
  | {
      kind: "classify-local-response";
      responseComplete: C6SourceV3SimpleArtifactReference;
    }
  | {
      kind: "classify-local-transport-error";
      transportError: C6SourceV3SimpleArtifactReference;
    }
  | {
      kind: "finalize-attempt";
      outcome: "retry" | "stop-success" | "stop-terminal";
      retryDecision: C6SourceV3SimpleArtifactReference;
    }
  | {
      attempt: C6SourceV3SimpleArtifactReference;
      kind: "committed";
      outcome: "retry" | "stop-success" | "stop-terminal";
    };

export async function prepareC6SourceV3SimpleAttempt(
  input: {
    context: C6SourceV3SimpleAttemptContext;
    request: C6SourceV3SimpleDurableGraphqlRequest;
  },
): Promise<{
  request: C6SourceV3SimpleArtifactReference;
  requestBody: C6SourceV3SimpleArtifactReference;
  requestCommitted: C6SourceV3SimpleArtifactReference;
}> {
  assertContext(input.context);
  const durableRequest =
    verifyC6SourceV3SimpleDurableGraphqlRequest({
      body: input.request.body,
      persistedRequest:
        input.request.persistedRequest,
    });
  assertLogicalRequestIdentity(
    input.context,
    durableRequest,
  );
  await assertPriorAttemptBinding(input.context);
  await prepareAttemptRoot(input.context.attemptRoot);
  const requestBody = await commitOrVerifyCreateOnlyBytes(
    input.context.attemptRoot,
    "request-body.raw",
    durableRequest.body,
  );
  if (
    requestBody.sha256 !==
      durableRequest.bodySha256 ||
    requestBody.sha256 !==
      durableRequest.persistedRequest.bodySha256 ||
    requestBody.bytes !==
      durableRequest.persistedRequest.bodyBytes
  ) {
    throw new Error(
      "C6 source-v3-simple durable request body mismatch",
    );
  }
  const request = await commitOrVerifyCreateOnlyMarker(
    input.context.attemptRoot,
    "request.json",
    durableRequest.persistedRequest,
  );
  const requestCommitted =
    await commitOrVerifyCreateOnlyMarker(
      input.context.attemptRoot,
      "request-committed.json",
      {
        artifactKind:
          "c6-source-v3-simple-request-committed",
        ...commonMarker(input.context),
        priorAttemptCommitSha256:
          input.context.priorAttemptCommitSha256,
        priorLogicalRequestCompletionSha256:
          input.context
            .priorLogicalRequestCompletionSha256,
        request,
        requestBody,
        schemaVersion: 1,
      },
      requestCommittedSchema,
    );
  return {
    request,
    requestBody,
    requestCommitted,
  };
}

export function computeC6SourceV3SimpleLogicalRequestIdentitySha256(
  input: {
    evaluationId: string;
    executionContractSha256: string;
    frozenInputClosureSha256: string;
    logicalRequestOrdinal: number;
    pass: "A" | "B";
    request: C6SourceV3SimpleDurableGraphqlRequest;
    runtimeAuthorizationSha256: string;
  },
): string {
  contextSchema.pick({
    evaluationId: true,
    executionContractSha256: true,
    frozenInputClosureSha256: true,
    logicalRequestOrdinal: true,
    pass: true,
    runtimeAuthorizationSha256: true,
  }).parse({
    evaluationId: input.evaluationId,
    executionContractSha256:
      input.executionContractSha256,
    frozenInputClosureSha256:
      input.frozenInputClosureSha256,
    logicalRequestOrdinal:
      input.logicalRequestOrdinal,
    pass: input.pass,
    runtimeAuthorizationSha256:
      input.runtimeAuthorizationSha256,
  });
  const request = input.request.persistedRequest;
  return sha256(Buffer.from(JSON.stringify({
    endpoint: request.endpoint,
    evaluationId: input.evaluationId,
    executionContractSha256:
      input.executionContractSha256,
    frozenInputClosureSha256:
      input.frozenInputClosureSha256,
    headersSha256: sha256(
      Buffer.from(JSON.stringify(request.headers)),
    ),
    logicalRequestOrdinal:
      input.logicalRequestOrdinal,
    method: request.method,
    operationName: request.operationName,
    pass: input.pass,
    querySha256: request.querySha256,
    redirect: request.redirect,
    runtimeAuthorizationSha256:
      input.runtimeAuthorizationSha256,
    requestBodySha256: request.bodySha256,
    variablesSha256: request.variablesSha256,
  })));
}

export async function recordC6SourceV3SimpleResponseStarted(
  input: {
    context: C6SourceV3SimpleAttemptContext;
    headers: Readonly<Record<string, string>>;
    httpStatus: number;
    receivedAt: string;
    requestCommitted:
      C6SourceV3SimpleArtifactReference;
    secret: Uint8Array;
  },
): Promise<{
  responseStarted: C6SourceV3SimpleArtifactReference;
}> {
  assertContext(input.context);
  assertExpectedReference(
    input.requestCommitted,
    "request-committed.json",
  );
  await verifyMarkerReference(
    input.context,
    input.requestCommitted,
    "request-committed.json",
    requestCommittedSchema,
  );
  const headers = orderedSelectedHeaders(input.headers);
  assertSecretAbsent(
    Buffer.from(JSON.stringify(headers)),
    input.secret,
  );
  const responseStarted =
    await commitCreateOnlyMarker(
      input.context.attemptRoot,
      "response-started.json",
      {
        artifactKind:
          "c6-source-v3-simple-response-started",
        ...commonMarker(input.context),
        headers,
        httpStatus: input.httpStatus,
        receivedAt: input.receivedAt,
        requestCommittedSha256:
          input.requestCommitted.sha256,
        schemaVersion: 1,
      },
      responseStartedSchema,
    );
  return {
    responseStarted,
  };
}

export async function recordC6SourceV3SimpleResponseComplete(
  input: {
    body: Uint8Array;
    context: C6SourceV3SimpleAttemptContext;
    responseStarted:
      C6SourceV3SimpleArtifactReference;
    secret: Uint8Array;
  },
): Promise<{
  responseBody: C6SourceV3SimpleArtifactReference;
  responseComplete: C6SourceV3SimpleArtifactReference;
}> {
  assertContext(input.context);
  assertExpectedReference(
    input.responseStarted,
    "response-started.json",
  );
  const responseStarted = await verifyMarkerReference(
    input.context,
    input.responseStarted,
    "response-started.json",
    responseStartedSchema,
  );
  const requestCommitted = await readMarker(
    input.context.attemptRoot,
    "request-committed.json",
    requestCommittedSchema,
  );
  assertMarkerContext(
    requestCommitted.value,
    input.context,
  );
  if (
    responseStarted.requestCommittedSha256 !==
      requestCommitted.ref.sha256
  ) {
    throw new Error(
      "C6 source-v3-simple response-started chain mismatch",
    );
  }
  assertSecretAbsent(input.body, input.secret);
  const responseBody = await commitCreateOnlyBytes(
    input.context.attemptRoot,
    "response-body.raw",
    input.body,
  );
  const responseComplete =
    await commitCreateOnlyMarker(
      input.context.attemptRoot,
      "response-complete.json",
      {
        artifactKind:
          "c6-source-v3-simple-response-complete",
        ...commonMarker(input.context),
        responseBody,
        responseStartedSha256:
          input.responseStarted.sha256,
        schemaVersion: 1,
      },
      responseCompleteSchema,
    );
  return {
    responseBody,
    responseComplete,
  };
}

export async function recordC6SourceV3SimpleTransportError(
  input: {
    code: string | null;
    context: C6SourceV3SimpleAttemptContext;
    message: string;
    name: string;
    occurredAt: string;
    phase:
      | "fetch"
      | "timeout"
      | "process-interruption-before-response";
    requestCommitted:
      C6SourceV3SimpleArtifactReference;
    secret: Uint8Array;
  },
): Promise<{
  transportError: C6SourceV3SimpleArtifactReference;
}> {
  assertContext(input.context);
  assertExpectedReference(
    input.requestCommitted,
    "request-committed.json",
  );
  await verifyMarkerReference(
    input.context,
    input.requestCommitted,
    "request-committed.json",
    requestCommittedSchema,
  );
  const value = transportErrorSchema.parse({
    artifactKind:
      "c6-source-v3-simple-transport-error",
    ...commonMarker(input.context),
    code: input.code,
    message: input.message,
    name: input.name,
    occurredAt: input.occurredAt,
    phase: input.phase,
    requestCommittedSha256:
      input.requestCommitted.sha256,
    schemaVersion: 1,
  });
  assertSecretAbsent(
    Buffer.from(JSON.stringify(value)),
    input.secret,
  );
  const transportError = await commitCreateOnlyMarker(
    input.context.attemptRoot,
    "transport-error.json",
    value,
    transportErrorSchema,
  );
  return {
    transportError,
  };
}

export async function recordC6SourceV3SimpleProcessInterruption(
  input: {
    context: C6SourceV3SimpleAttemptContext;
    occurredAt: string;
    requestCommitted:
      C6SourceV3SimpleArtifactReference;
  },
): Promise<{
  transportError: C6SourceV3SimpleArtifactReference;
}> {
  assertContext(input.context);
  assertExpectedReference(
    input.requestCommitted,
    "request-committed.json",
  );
  await verifyMarkerReference(
    input.context,
    input.requestCommitted,
    "request-committed.json",
    requestCommittedSchema,
  );
  const transportError = await commitCreateOnlyMarker(
    input.context.attemptRoot,
    "transport-error.json",
    transportErrorSchema.parse({
      artifactKind:
        "c6-source-v3-simple-transport-error",
      ...commonMarker(input.context),
      code: null,
      message:
        "prior process ended before response-started",
      name: "ProcessInterruption",
      occurredAt: input.occurredAt,
      phase:
        "process-interruption-before-response",
      requestCommittedSha256:
        input.requestCommitted.sha256,
      schemaVersion: 1,
    }),
    transportErrorSchema,
  );
  return {
    transportError,
  };
}

export async function completeC6SourceV3SimpleAttempt(
  input: {
    context: C6SourceV3SimpleAttemptContext;
    decision: "retry" | "stop-success" | "stop-terminal";
    notBefore: string | null;
    reason: z.infer<typeof retryReasonSchema>;
    requestCommitted:
      C6SourceV3SimpleArtifactReference;
    responseComplete:
      C6SourceV3SimpleArtifactReference | null;
    responseStarted:
      C6SourceV3SimpleArtifactReference | null;
    transportError:
      C6SourceV3SimpleArtifactReference | null;
  },
): Promise<{
  attempt: C6SourceV3SimpleArtifactReference;
  retryDecision: C6SourceV3SimpleArtifactReference;
}> {
  assertContext(input.context);
  assertExpectedReference(
    input.requestCommitted,
    "request-committed.json",
  );
  const requestCommitted =
    await verifyMarkerReference(
    input.context,
    input.requestCommitted,
    "request-committed.json",
    requestCommittedSchema,
  );
  if (
    (input.responseStarted === null) !==
      (input.responseComplete === null)
  ) {
    throw new Error(
      "C6 source-v3-simple partial response cannot complete an attempt",
    );
  }
  if (
    (input.responseComplete === null) ===
      (input.transportError === null)
  ) {
    throw new Error(
      "C6 source-v3-simple attempt outcome evidence mismatch",
    );
  }
  if (
    input.decision === "stop-success" &&
    input.responseComplete === null
  ) {
    throw new Error(
      "C6 source-v3-simple stop-success requires a complete HTTP response",
    );
  }
  if (
    input.decision === "retry" &&
    input.context.attemptNumber === 4
  ) {
    throw new Error(
      "C6 source-v3-simple maximum attempts exhausted",
    );
  }
  retryReasonSchema.parse(input.reason);
  if (input.responseComplete !== null) {
    assertExpectedReference(
      input.responseComplete,
      "response-complete.json",
    );
    const started = await verifyMarkerReference(
      input.context,
      input.responseStarted!,
      "response-started.json",
      responseStartedSchema,
    );
    const complete = await verifyMarkerReference(
      input.context,
      input.responseComplete,
      "response-complete.json",
      responseCompleteSchema,
    );
    if (
      started.requestCommittedSha256 !==
        input.requestCommitted.sha256 ||
      complete.responseStartedSha256 !==
        input.responseStarted!.sha256
    ) {
      throw new Error(
        "C6 source-v3-simple response chain mismatch",
      );
    }
    const responseBody = await verifyReference(
      input.context.attemptRoot,
      complete.responseBody,
      "response-body.raw",
    );
    const durableRequest =
      await readDurableRequest(
        input.context.attemptRoot,
        requestCommitted,
      );
    const classification =
      classifyC6SourceV3SimpleHttpResponse({
        attemptNumber:
          input.context.attemptNumber,
        durableRequest,
        responseBody,
        responseStarted: started,
      });
    assertCallerClassification(
      classification,
      input,
    );
  }
  if (input.responseStarted !== null) {
    assertExpectedReference(
      input.responseStarted,
      "response-started.json",
    );
  }
  if (input.transportError !== null) {
    assertExpectedReference(
      input.transportError,
      "transport-error.json",
    );
    const transportError =
      await verifyMarkerReference(
        input.context,
        input.transportError,
        "transport-error.json",
        transportErrorSchema,
      );
    if (
      transportError.requestCommittedSha256 !==
        input.requestCommitted.sha256
    ) {
      throw new Error(
        "C6 source-v3-simple transport-error chain mismatch",
      );
    }
    assertCallerClassification(
      classifyC6SourceV3SimpleTransportError({
        attemptNumber:
          input.context.attemptNumber,
        transportError,
      }),
      input,
    );
  }
  const basisArtifactSha256 =
    input.responseComplete?.sha256 ??
    input.transportError!.sha256;
  const retryDecision =
    await commitOrVerifyCreateOnlyMarker(
      input.context.attemptRoot,
      "retry-decision.json",
      {
        artifactKind:
          "c6-source-v3-simple-retry-decision",
        ...commonMarker(input.context),
        basisArtifactSha256,
        decision: input.decision,
        notBefore: input.notBefore,
        reason: input.reason,
        schemaVersion: 1,
      },
      retryDecisionSchema,
    );
  const attempt = await commitOrVerifyCreateOnlyMarker(
    input.context.attemptRoot,
    "attempt.json",
    {
      artifactKind: "c6-source-v3-simple-attempt",
      ...commonMarker(input.context),
      outcome: input.decision,
      priorAttemptCommitSha256:
        input.context.priorAttemptCommitSha256,
      requestCommitted: input.requestCommitted,
      responseComplete: input.responseComplete,
      responseStarted: input.responseStarted,
      retryDecision,
      schemaVersion: 1,
      transportError: input.transportError,
    },
    attemptSchema,
  );
  return {
    attempt,
    retryDecision,
  };
}

export async function inspectC6SourceV3SimpleAttempt(
  context: C6SourceV3SimpleAttemptContext,
): Promise<C6SourceV3SimpleAttemptResumeState> {
  assertContext(context);
  await prepareAttemptRoot(context.attemptRoot);
  try {
    const requestCommittedExists =
      await pathExists(join(
        context.attemptRoot,
        "request-committed.json",
      ));
    if (!requestCommittedExists) {
      if (
        await anyExists(context.attemptRoot, [
          "response-started.json",
          "response-complete.json",
          "retry-decision.json",
          "attempt.json",
        ])
      ) {
        throw new Error("marker order mismatch");
      }
      return {
        kind: "not-started",
      };
    }
    const requestCommitted = await readMarker(
      context.attemptRoot,
      "request-committed.json",
      requestCommittedSchema,
    );
    assertMarkerContext(requestCommitted.value, context);
    const requestBytes = await verifyReference(
      context.attemptRoot,
      requestCommitted.value.request,
      "request.json",
    );
    const requestBodyBytes = await verifyReference(
      context.attemptRoot,
      requestCommitted.value.requestBody,
      "request-body.raw",
    );
    const durableRequest =
      verifyC6SourceV3SimpleDurableGraphqlRequest({
        body: requestBodyBytes,
        persistedRequest:
          parseCanonicalJson(requestBytes),
      });
    assertLogicalRequestIdentity(
      context,
      durableRequest,
    );
    const attemptExists = await pathExists(join(
      context.attemptRoot,
      "attempt.json",
    ));
    const retryDecisionExists = await pathExists(join(
      context.attemptRoot,
      "retry-decision.json",
    ));
    const responseStartedExists = await pathExists(join(
      context.attemptRoot,
      "response-started.json",
    ));
    const transportErrorExists = await pathExists(join(
      context.attemptRoot,
      "transport-error.json",
    ));
    if (!responseStartedExists) {
      if (
        await anyExists(context.attemptRoot, [
          "response-complete.json",
          "response-body.raw",
        ])
      ) {
        throw new Error("response marker order mismatch");
      }
      if (transportErrorExists) {
        const transportError = await readMarker(
          context.attemptRoot,
          "transport-error.json",
          transportErrorSchema,
        );
        assertMarkerContext(
          transportError.value,
          context,
        );
        if (
          transportError.value
            .requestCommittedSha256 !==
            requestCommitted.ref.sha256
        ) {
          throw new Error(
            "transport-error chain mismatch",
          );
        }
        if (attemptExists) {
          return await inspectCommittedAttempt(
            context,
            requestCommitted.ref,
            null,
            null,
            transportError.ref,
          );
        }
        if (retryDecisionExists) {
          return await inspectFinalizeAttempt(
            context,
            transportError.ref.sha256,
          );
        }
        return {
          kind: "classify-local-transport-error",
          transportError: transportError.ref,
        };
      }
      if (attemptExists) {
        throw new Error(
          "attempt has no outcome evidence",
        );
      }
      if (retryDecisionExists) {
        throw new Error(
          "retry decision has no outcome evidence",
        );
      }
      return {
        kind: "interrupted-before-response",
        requestCommitted: requestCommitted.ref,
      };
    }
    const responseStarted = await readMarker(
      context.attemptRoot,
      "response-started.json",
      responseStartedSchema,
    );
    assertMarkerContext(responseStarted.value, context);
    if (transportErrorExists) {
      throw new Error(
        "HTTP response and transport error coexist",
      );
    }
    if (
      responseStarted.value.requestCommittedSha256 !==
        requestCommitted.ref.sha256
    ) {
      throw new Error("response-started chain mismatch");
    }
    const responseCompleteExists = await pathExists(join(
      context.attemptRoot,
      "response-complete.json",
    ));
    if (!responseCompleteExists) {
      if (retryDecisionExists || attemptExists) {
        throw new Error(
          "partial response has terminal markers",
        );
      }
      return {
        kind: "terminal-partial-response",
        responseStarted: responseStarted.ref,
      };
    }
    const responseComplete = await readMarker(
      context.attemptRoot,
      "response-complete.json",
      responseCompleteSchema,
    );
    assertMarkerContext(responseComplete.value, context);
    if (
      responseComplete.value.responseStartedSha256 !==
        responseStarted.ref.sha256
    ) {
      throw new Error("response-complete chain mismatch");
    }
    await verifyReference(
      context.attemptRoot,
      responseComplete.value.responseBody,
      "response-body.raw",
    );
    if (!attemptExists) {
      if (retryDecisionExists) {
        return await inspectFinalizeAttempt(
          context,
          responseComplete.ref.sha256,
        );
      }
      return {
        kind: "classify-local-response",
        responseComplete: responseComplete.ref,
      };
    }
    return await inspectCommittedAttempt(
      context,
      requestCommitted.ref,
      responseStarted.ref,
      responseComplete.ref,
      null,
    );
  } catch (error) {
    throw new Error(
      "C6 source-v3-simple attempt ledger is corrupt",
      {
        cause: error,
      },
    );
  }
}

export async function finalizeC6SourceV3SimpleAttemptFromLedger(
  context: C6SourceV3SimpleAttemptContext,
): Promise<{
  attempt: C6SourceV3SimpleArtifactReference;
}> {
  const state = await inspectC6SourceV3SimpleAttempt(
    context,
  );
  if (state.kind !== "finalize-attempt") {
    throw new Error(
      "C6 source-v3-simple attempt is not ready for local finalization",
    );
  }
  const requestCommitted = await readMarker(
    context.attemptRoot,
    "request-committed.json",
    requestCommittedSchema,
  );
  const retryDecision = await readMarker(
    context.attemptRoot,
    "retry-decision.json",
    retryDecisionSchema,
  );
  const responseStarted = await readOptionalMarker(
    context.attemptRoot,
    "response-started.json",
    responseStartedSchema,
  );
  const responseComplete = await readOptionalMarker(
    context.attemptRoot,
    "response-complete.json",
    responseCompleteSchema,
  );
  const transportError = await readOptionalMarker(
    context.attemptRoot,
    "transport-error.json",
    transportErrorSchema,
  );
  const attempt =
    await commitOrVerifyCreateOnlyMarker(
      context.attemptRoot,
      "attempt.json",
      {
        artifactKind:
          "c6-source-v3-simple-attempt",
        ...commonMarker(context),
        outcome: retryDecision.value.decision,
        priorAttemptCommitSha256:
          context.priorAttemptCommitSha256,
        requestCommitted: requestCommitted.ref,
        responseComplete:
          responseComplete?.ref ?? null,
        responseStarted:
          responseStarted?.ref ?? null,
        retryDecision: retryDecision.ref,
        schemaVersion: 1,
        transportError:
          transportError?.ref ?? null,
      },
      attemptSchema,
    );
  const completed = await inspectC6SourceV3SimpleAttempt(
    context,
  );
  if (
    completed.kind !== "committed" ||
    !isDeepStrictEqual(completed.attempt, attempt)
  ) {
    throw new Error(
      "C6 source-v3-simple local attempt finalization mismatch",
    );
  }
  return {
    attempt,
  };
}

export async function settleC6SourceV3SimpleAttemptFromLedger(
  context: C6SourceV3SimpleAttemptContext,
): Promise<{
  attempt: C6SourceV3SimpleArtifactReference;
  notBefore: string | null;
  outcome: "retry" | "stop-success" | "stop-terminal";
  reason: z.infer<typeof retryReasonSchema>;
}> {
  let state = await inspectC6SourceV3SimpleAttempt(
    context,
  );
  if (
    state.kind === "classify-local-response" ||
    state.kind === "classify-local-transport-error"
  ) {
    const requestCommitted = await readMarker(
      context.attemptRoot,
      "request-committed.json",
      requestCommittedSchema,
    );
    const responseStarted = await readOptionalMarker(
      context.attemptRoot,
      "response-started.json",
      responseStartedSchema,
    );
    const responseComplete = await readOptionalMarker(
      context.attemptRoot,
      "response-complete.json",
      responseCompleteSchema,
    );
    const transportError = await readOptionalMarker(
      context.attemptRoot,
      "transport-error.json",
      transportErrorSchema,
    );
    let classification:
      C6SourceV3SimpleAttemptClassification;
    if (
      responseStarted !== null &&
      responseComplete !== null
    ) {
      classification =
        classifyC6SourceV3SimpleHttpResponse({
          attemptNumber: context.attemptNumber,
          durableRequest: await readDurableRequest(
            context.attemptRoot,
            requestCommitted.value,
          ),
          responseBody: await verifyReference(
            context.attemptRoot,
            responseComplete.value.responseBody,
            "response-body.raw",
          ),
          responseStarted: responseStarted.value,
        });
    } else if (transportError !== null) {
      classification =
        classifyC6SourceV3SimpleTransportError({
          attemptNumber: context.attemptNumber,
          transportError: transportError.value,
        });
    } else {
      throw new Error(
        "C6 source-v3-simple attempt cannot be classified from ledger",
      );
    }
    await completeC6SourceV3SimpleAttempt({
      context,
      ...classification,
      requestCommitted: requestCommitted.ref,
      responseComplete:
        responseComplete?.ref ?? null,
      responseStarted:
        responseStarted?.ref ?? null,
      transportError: transportError?.ref ?? null,
    });
    state = await inspectC6SourceV3SimpleAttempt(
      context,
    );
  }
  if (state.kind === "finalize-attempt") {
    await finalizeC6SourceV3SimpleAttemptFromLedger(
      context,
    );
    state = await inspectC6SourceV3SimpleAttempt(
      context,
    );
  }
  if (state.kind !== "committed") {
    throw new Error(
      "C6 source-v3-simple attempt is not locally settleable",
    );
  }
  await verifyCommittedAttempt(
    context.attemptRoot,
    state.attempt,
  );
  const retryDecision = await readMarker(
    context.attemptRoot,
    "retry-decision.json",
    retryDecisionSchema,
  );
  return {
    attempt: state.attempt,
    notBefore: retryDecision.value.notBefore,
    outcome: retryDecision.value.decision,
    reason: retryDecision.value.reason,
  };
}

export async function writeC6SourceV3SimpleLogicalRequestComplete(
  input: {
    assetRoot: string;
    attempts: readonly {
      artifact: C6SourceV3SimpleArtifactReference;
      attemptRoot: string;
    }[];
    evaluationId: string;
    executionContractSha256: string;
    frozenInputClosureSha256: string;
    logicalRequestIdentitySha256: string;
    logicalRequestOrdinal: number;
    pass: "A" | "B";
    passRoot: string;
    priorLogicalRequestCompletionSha256: string;
    runtimeAuthorizationSha256: string;
  },
): Promise<C6SourceV3SimpleArtifactReference> {
  if (
    input.attempts.length < 1 ||
    input.attempts.length > 4
  ) {
    throw new Error(
      "C6 source-v3-simple logical request attempt count mismatch",
    );
  }
  const attempts = input.attempts.map(
    (attempt, index) => ({
      artifact: rebaseArtifactReference(
        input.assetRoot,
        attempt.attemptRoot,
        attempt.artifact,
      ),
      attemptNumber: index + 1,
    }),
  );
  const projection = await projectSuccessfulAttempt(
    await verifyCommittedAttempt(
      input.assetRoot,
      attempts.at(-1)!.artifact,
    ),
  );
  const projectedResultLocal =
    await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
      input.passRoot,
      `logical-request-result-${
        String(input.logicalRequestOrdinal).padStart(
          8,
          "0",
        )
      }.json`,
      projectedResultSchema.parse({
        artifactKind:
          "c6-source-v3-simple-projected-result",
        evaluationId: input.evaluationId,
        executionContractSha256:
          input.executionContractSha256,
        frozenInputClosureSha256:
          input.frozenInputClosureSha256,
        logicalRequestIdentitySha256:
          input.logicalRequestIdentitySha256,
        logicalRequestOrdinal:
          input.logicalRequestOrdinal,
        operationName: projection.operationName,
        pass: input.pass,
        result: projection.result,
        runtimeAuthorizationSha256:
          input.runtimeAuthorizationSha256,
        schemaVersion: 1,
      }),
    );
  const projectedResult = rebaseLocalReference(
    input.assetRoot,
    input.passRoot,
    projectedResultLocal,
  );
  const value = logicalRequestCompleteSchema.parse({
    artifactKind:
      "c6-source-v3-simple-logical-request-complete",
    attempts,
    evaluationId: input.evaluationId,
    executionContractSha256:
      input.executionContractSha256,
    frozenInputClosureSha256:
      input.frozenInputClosureSha256,
    logicalRequestIdentitySha256:
      input.logicalRequestIdentitySha256,
    logicalRequestOrdinal:
      input.logicalRequestOrdinal,
    operationName: projection.operationName,
    pass: input.pass,
    priorLogicalRequestCompletionSha256:
      input.priorLogicalRequestCompletionSha256,
    projectedResult,
    runtimeAuthorizationSha256:
      input.runtimeAuthorizationSha256,
    schemaVersion: 1,
    successfulAttemptSha256:
      attempts.at(-1)!.artifact.sha256,
  });
  await validateLogicalRequestComplete(
    input.assetRoot,
    value,
  );
  return await commitC6SourceV3SimpleCreateOnlyCanonicalJson(
    input.passRoot,
    `logical-request-complete-${
      String(input.logicalRequestOrdinal).padStart(
        8,
        "0",
      )
    }.json`,
    value,
  );
}

export async function replayC6SourceV3SimpleLogicalRequestCompleteFromExistingResult(
  input: Omit<
    Parameters<
      typeof writeC6SourceV3SimpleLogicalRequestComplete
    >[0],
    "attempts"
  > & {
    attemptRoots: readonly string[];
  },
): Promise<C6SourceV3SimpleArtifactReference> {
  try {
    await readC6StableRegularFile(
      join(
        input.passRoot,
        `logical-request-result-${
          String(input.logicalRequestOrdinal).padStart(
            8,
            "0",
          )
        }.json`,
      ),
      "C6 source-v3-simple existing projected result",
      undefined,
      true,
    );
    const attempts = [];
    for (const attemptRoot of input.attemptRoots) {
      attempts.push({
        artifact: (
          await readMarker(
            attemptRoot,
            "attempt.json",
            attemptSchema,
          )
        ).ref,
        attemptRoot,
      });
    }
    const {
      attemptRoots: _attemptRoots,
      ...completionInput
    } = input;
    return await writeC6SourceV3SimpleLogicalRequestComplete({
      ...completionInput,
      attempts,
    });
  } catch (cause) {
    throw new Error(
      "C6 source-v3-simple existing projected result is not locally finalizable",
      {
        cause,
      },
    );
  }
}

export async function verifyC6SourceV3SimpleLogicalRequestComplete(
  assetRoot: string,
  reference: C6SourceV3SimpleArtifactReference,
): Promise<z.infer<typeof logicalRequestCompleteSchema>> {
  return (
    await readC6SourceV3SimpleLogicalRequestEvidence(
      assetRoot,
      reference,
    )
  ).completion;
}

export async function readC6SourceV3SimpleProjectedLogicalRequest(
  assetRoot: string,
  reference: C6SourceV3SimpleArtifactReference,
): Promise<C6SourceV3SimpleProjectedLogicalRequest> {
  return (
    await readC6SourceV3SimpleLogicalRequestEvidence(
      assetRoot,
      reference,
    )
  ).projectedRequest;
}

export async function readC6SourceV3SimpleLogicalRequestEvidence(
  assetRoot: string,
  reference: C6SourceV3SimpleArtifactReference,
) {
  const bytes = await readRootReference(
    assetRoot,
    reference,
  );
  const value = logicalRequestCompleteSchema.parse(
    parseCanonicalJson(bytes),
  );
  const validation =
    await validateLogicalRequestComplete(
      assetRoot,
      value,
    );
  return {
    completion: value,
    ...validation,
  };
}

export async function verifyC6SourceV3SimpleFailureChainTipMarker(
  assetRoot: string,
  reference: C6SourceV3SimpleArtifactReference,
): Promise<C6SourceV3SimpleFailureChainTipContext> {
  const match =
    /^pass-([ab])\/logical-request-(\d{8})\/attempt-(\d{2})\/(attempt|response-started)\.json$/u
      .exec(reference.path);
  if (match === null) {
    throw new Error(
      "C6 source-v3-simple failure chain tip marker path mismatch",
    );
  }
  const expectedPass = match[1]!.toUpperCase();
  const expectedOrdinal = Number(match[2]);
  const expectedAttempt = Number(match[3]);
  if (match[4] === "attempt") {
    const verified = await verifyCommittedAttempt(
      assetRoot,
      reference,
    );
    const attempt = verified.attempt;
    if (
      attempt.outcome !== "stop-terminal" ||
      attempt.attemptNumber !== expectedAttempt ||
      attempt.logicalRequestOrdinal !==
        expectedOrdinal ||
      attempt.pass !== expectedPass ||
      attempt.priorAttemptCommitSha256 !==
        verified.requestCommitted
          .priorAttemptCommitSha256
    ) {
      throw new Error(
        "C6 source-v3-simple failure chain tip attempt mismatch",
      );
    }
    await verifyFailureChainTipPriorAttempts({
      assetRoot,
      attemptNumber: attempt.attemptNumber,
      evaluationId: attempt.evaluationId,
      executionContractSha256:
        attempt.executionContractSha256,
      frozenInputClosureSha256:
        attempt.frozenInputClosureSha256,
      logicalRequestIdentitySha256:
        attempt.logicalRequestIdentitySha256,
      logicalRequestOrdinal:
        attempt.logicalRequestOrdinal,
      pass: attempt.pass,
      priorAttemptCommitSha256:
        attempt.priorAttemptCommitSha256,
      priorLogicalRequestCompletionSha256:
        verified.requestCommitted
          .priorLogicalRequestCompletionSha256,
      reference,
      runtimeAuthorizationSha256:
        attempt.runtimeAuthorizationSha256,
    });
    return {
      ...attempt,
      priorLogicalRequestCompletionSha256:
        verified.requestCommitted
          .priorLogicalRequestCompletionSha256,
      reason: verified.retryDecision.reason,
    };
  }
  const marker = responseStartedSchema.parse(
    parseCanonicalJson(
      await readRootReference(assetRoot, reference),
    ),
  );
  const attemptRoot = resolve(
    assetRoot,
    dirname(reference.path),
  );
  const requestCommitted = await readMarker(
    attemptRoot,
    "request-committed.json",
    requestCommittedSchema,
  );
  const context: C6SourceV3SimpleAttemptContext = {
    attemptNumber: marker.attemptNumber,
    attemptRoot,
    evaluationId: marker.evaluationId,
    executionContractSha256:
      marker.executionContractSha256,
    frozenInputClosureSha256:
      marker.frozenInputClosureSha256,
    logicalRequestIdentitySha256:
      marker.logicalRequestIdentitySha256,
    logicalRequestOrdinal:
      marker.logicalRequestOrdinal,
    pass: marker.pass,
    priorAttemptCommitSha256:
      requestCommitted.value
        .priorAttemptCommitSha256,
    priorLogicalRequestCompletionSha256:
      requestCommitted.value
        .priorLogicalRequestCompletionSha256,
    runtimeAuthorizationSha256:
      marker.runtimeAuthorizationSha256,
  };
  const state = await inspectC6SourceV3SimpleAttempt(
    context,
  );
  if (
    marker.attemptNumber !== expectedAttempt ||
    marker.logicalRequestOrdinal !== expectedOrdinal ||
    marker.pass !== expectedPass ||
    marker.requestCommittedSha256 !==
      requestCommitted.ref.sha256 ||
    state.kind !== "terminal-partial-response" ||
    state.responseStarted.bytes !== reference.bytes ||
    state.responseStarted.sha256 !== reference.sha256
  ) {
    throw new Error(
      "C6 source-v3-simple failure chain tip response mismatch",
    );
  }
  await verifyFailureChainTipPriorAttempts({
    assetRoot,
    attemptNumber: marker.attemptNumber,
    evaluationId: marker.evaluationId,
    executionContractSha256:
      marker.executionContractSha256,
    frozenInputClosureSha256:
      marker.frozenInputClosureSha256,
    logicalRequestIdentitySha256:
      marker.logicalRequestIdentitySha256,
    logicalRequestOrdinal:
      marker.logicalRequestOrdinal,
    pass: marker.pass,
    priorAttemptCommitSha256:
      requestCommitted.value.priorAttemptCommitSha256,
    priorLogicalRequestCompletionSha256:
      requestCommitted.value
        .priorLogicalRequestCompletionSha256,
    reference,
    runtimeAuthorizationSha256:
      marker.runtimeAuthorizationSha256,
  });
  return {
    ...marker,
    priorLogicalRequestCompletionSha256:
      requestCommitted.value
        .priorLogicalRequestCompletionSha256,
    reason: null,
  };
}

async function verifyFailureChainTipPriorAttempts(
  input: {
    assetRoot: string;
    attemptNumber: number;
    evaluationId: string;
    executionContractSha256: string;
    frozenInputClosureSha256: string;
    logicalRequestIdentitySha256: string;
    logicalRequestOrdinal: number;
    pass: "A" | "B";
    priorAttemptCommitSha256: string | null;
    priorLogicalRequestCompletionSha256: string;
    reference: C6SourceV3SimpleArtifactReference;
    runtimeAuthorizationSha256: string;
  },
): Promise<void> {
  const logicalRequestPath = dirname(
    dirname(input.reference.path),
  );
  let priorAttemptCommitSha256: string | null = null;
  for (
    let attemptNumber = 1;
    attemptNumber < input.attemptNumber;
    attemptNumber += 1
  ) {
    const path =
      `${logicalRequestPath}/attempt-${
        String(attemptNumber).padStart(2, "0")
      }/attempt.json`;
    let reference: C6SourceV3SimpleArtifactReference;
    try {
      reference = await referenceAtRootPath(
        input.assetRoot,
        path,
      );
    } catch (error) {
      throw new Error(
        "C6 source-v3-simple prior attempt binding is missing",
        { cause: error },
      );
    }
    const verified = await verifyCommittedAttempt(
      input.assetRoot,
      reference,
    );
    if (
      verified.attempt.attemptNumber !== attemptNumber ||
      verified.attempt.evaluationId !==
        input.evaluationId ||
      verified.attempt.executionContractSha256 !==
        input.executionContractSha256 ||
      verified.attempt.frozenInputClosureSha256 !==
        input.frozenInputClosureSha256 ||
      verified.attempt.logicalRequestIdentitySha256 !==
        input.logicalRequestIdentitySha256 ||
      verified.attempt.logicalRequestOrdinal !==
        input.logicalRequestOrdinal ||
      verified.attempt.outcome !== "retry" ||
      verified.attempt.pass !== input.pass ||
      verified.attempt.priorAttemptCommitSha256 !==
        priorAttemptCommitSha256 ||
      verified.requestCommitted
        .priorAttemptCommitSha256 !==
        priorAttemptCommitSha256 ||
      verified.requestCommitted
        .priorLogicalRequestCompletionSha256 !==
        input.priorLogicalRequestCompletionSha256 ||
      verified.retryDecision.decision !== "retry" ||
      verified.attempt.runtimeAuthorizationSha256 !==
        input.runtimeAuthorizationSha256
    ) {
      throw new Error(
        "C6 source-v3-simple prior attempt binding mismatch",
      );
    }
    priorAttemptCommitSha256 = reference.sha256;
  }
  if (
    input.priorAttemptCommitSha256 !==
      priorAttemptCommitSha256
  ) {
    throw new Error(
      "C6 source-v3-simple prior attempt binding mismatch",
    );
  }
}

async function referenceAtRootPath(
  root: string,
  path: string,
): Promise<C6SourceV3SimpleArtifactReference> {
  const bytes = await readC6StableRegularFile(
    resolve(root, path),
    `source-v3-simple ledger ${path}`,
    undefined,
    true,
  );
  return {
    bytes: bytes.length,
    path,
    sha256: sha256(bytes),
  };
}

async function inspectCommittedAttempt(
  context: C6SourceV3SimpleAttemptContext,
  requestCommitted:
    C6SourceV3SimpleArtifactReference,
  responseStarted:
    C6SourceV3SimpleArtifactReference | null = null,
  responseComplete:
    C6SourceV3SimpleArtifactReference | null = null,
  transportError:
    C6SourceV3SimpleArtifactReference | null = null,
): Promise<C6SourceV3SimpleAttemptResumeState> {
  const retryDecision = await readMarker(
    context.attemptRoot,
    "retry-decision.json",
    retryDecisionSchema,
  );
  const attempt = await readMarker(
    context.attemptRoot,
    "attempt.json",
    attemptSchema,
  );
  assertMarkerContext(retryDecision.value, context);
  assertMarkerContext(attempt.value, context);
  if (
    attempt.value.outcome !==
      retryDecision.value.decision ||
    attempt.value.requestCommitted.sha256 !==
      requestCommitted.sha256 ||
    attempt.value.retryDecision.sha256 !==
      retryDecision.ref.sha256 ||
    attempt.value.responseStarted?.sha256 !==
      responseStarted?.sha256 ||
    attempt.value.responseComplete?.sha256 !==
      responseComplete?.sha256 ||
    attempt.value.transportError?.sha256 !==
      transportError?.sha256 ||
    attempt.value.priorAttemptCommitSha256 !==
      context.priorAttemptCommitSha256 ||
    retryDecision.value.basisArtifactSha256 !==
      (
        responseComplete?.sha256 ??
        transportError?.sha256
      ) ||
    !isDeepStrictEqual(
      attempt.value.requestCommitted,
      requestCommitted,
    ) ||
    !isDeepStrictEqual(
      attempt.value.responseStarted,
      responseStarted,
    ) ||
    !isDeepStrictEqual(
      attempt.value.responseComplete,
      responseComplete,
    ) ||
    !isDeepStrictEqual(
      attempt.value.transportError,
      transportError,
    )
  ) {
    throw new Error("attempt chain mismatch");
  }
  return {
    attempt: attempt.ref,
    kind: "committed",
    outcome: attempt.value.outcome,
  };
}

async function validateLogicalRequestComplete(
  assetRoot: string,
  value: z.infer<
    typeof logicalRequestCompleteSchema
  >,
): Promise<{
  pacing: {
    receivedAt: string;
    responseDate: string;
    remaining: number;
    resetUnixSeconds: number;
  };
  projectedRequest:
    C6SourceV3SimpleProjectedLogicalRequest;
}> {
  let priorAttemptCommitSha256: string | null = null;
  let successfulAttempt:
    Awaited<ReturnType<typeof verifyCommittedAttempt>> |
    null = null;
  for (
    const [index, entry] of value.attempts.entries()
  ) {
    if (entry.attemptNumber !== index + 1) {
      throw new Error(
        "C6 source-v3-simple logical request attempt order mismatch",
      );
    }
    const verified = await verifyCommittedAttempt(
      assetRoot,
      entry.artifact,
    );
    if (
      verified.attempt.attemptNumber !==
        entry.attemptNumber ||
      verified.attempt.evaluationId !==
        value.evaluationId ||
      verified.attempt.executionContractSha256 !==
        value.executionContractSha256 ||
      verified.attempt.frozenInputClosureSha256 !==
        value.frozenInputClosureSha256 ||
      verified.attempt.logicalRequestIdentitySha256 !==
        value.logicalRequestIdentitySha256 ||
      verified.attempt.logicalRequestOrdinal !==
        value.logicalRequestOrdinal ||
      verified.attempt.pass !== value.pass ||
      verified.attempt.runtimeAuthorizationSha256 !==
        value.runtimeAuthorizationSha256 ||
      verified.requestCommitted
        .priorLogicalRequestCompletionSha256 !==
        value.priorLogicalRequestCompletionSha256 ||
      verified.attempt.priorAttemptCommitSha256 !==
        priorAttemptCommitSha256 ||
      (
        index < value.attempts.length - 1 &&
        verified.attempt.outcome !== "retry"
      ) ||
      (
        index === value.attempts.length - 1 &&
        verified.attempt.outcome !== "stop-success"
      )
    ) {
      throw new Error(
        "C6 source-v3-simple logical request attempt chain mismatch",
      );
    }
    priorAttemptCommitSha256 = entry.artifact.sha256;
    successfulAttempt = verified;
  }
  if (
    value.successfulAttemptSha256 !==
      value.attempts.at(-1)!.artifact.sha256
  ) {
    throw new Error(
      "C6 source-v3-simple successful attempt mismatch",
    );
  }
  if (successfulAttempt === null) {
    throw new Error(
      "C6 source-v3-simple successful attempt is missing",
    );
  }
  const projection = await projectSuccessfulAttempt(
    successfulAttempt,
  );
  const projectedResult = projectedResultSchema.parse(
    parseCanonicalJson(
      await readRootReference(
        assetRoot,
        value.projectedResult,
      ),
    ),
  );
  if (
    value.operationName !== projection.operationName ||
    projectedResult.evaluationId !==
      value.evaluationId ||
    projectedResult.executionContractSha256 !==
      value.executionContractSha256 ||
    projectedResult.frozenInputClosureSha256 !==
      value.frozenInputClosureSha256 ||
    projectedResult.logicalRequestIdentitySha256 !==
      value.logicalRequestIdentitySha256 ||
    projectedResult.logicalRequestOrdinal !==
      value.logicalRequestOrdinal ||
    projectedResult.operationName !==
      value.operationName ||
    projectedResult.pass !== value.pass ||
    projectedResult.runtimeAuthorizationSha256 !==
      value.runtimeAuthorizationSha256 ||
    !isDeepStrictEqual(
      projectedResult.result,
      projection.result,
    )
  ) {
    throw new Error(
      "C6 source-v3-simple projected result mismatch",
    );
  }
  if (
    projection.operationName ===
      "C6SourceV3SimpleRepositoryCount"
  ) {
    return validationResult(
      projection,
      successfulAttempt,
    );
  }
  if (
    projection.operationName ===
      "C6SourceV3SimpleRepositoryPage"
  ) {
    return validationResult(
      projection,
      successfulAttempt,
    );
  }
  return validationResult(
    projection,
    successfulAttempt,
  );
}

async function verifyCommittedAttempt(
  assetRoot: string,
  reference: C6SourceV3SimpleArtifactReference,
): Promise<{
  attempt: z.infer<typeof attemptSchema>;
  durableRequest: C6SourceV3SimpleDurableGraphqlRequest;
  responseBody: Buffer | null;
  responseStarted:
    z.infer<typeof responseStartedSchema> | null;
  requestCommitted: z.infer<
    typeof requestCommittedSchema
  >;
  retryDecision: z.infer<
    typeof retryDecisionSchema
  >;
}> {
  if (basename(reference.path) !== "attempt.json") {
    throw new Error(
      "C6 source-v3-simple attempt reference path mismatch",
    );
  }
  const bytes = await readRootReference(
    assetRoot,
    reference,
  );
  const attempt = attemptSchema.parse(
    parseCanonicalJson(bytes),
  );
  const attemptRoot = resolve(
    assetRoot,
    dirname(reference.path),
  );
  const requestCommitted = await readMarker(
    attemptRoot,
    "request-committed.json",
    requestCommittedSchema,
  );
  const durableRequest = await readDurableRequest(
    attemptRoot,
    requestCommitted.value,
  );
  const responseStarted = attempt.responseStarted === null
    ? null
    : (
        await readMarker(
          attemptRoot,
          "response-started.json",
          responseStartedSchema,
        )
      ).value;
  const responseComplete =
    attempt.responseComplete === null
      ? null
      : (
          await readMarker(
            attemptRoot,
            "response-complete.json",
            responseCompleteSchema,
          )
        ).value;
  const responseBody = responseComplete === null
    ? null
    : await verifyReference(
        attemptRoot,
        responseComplete.responseBody,
        "response-body.raw",
      );
  const transportError = attempt.transportError === null
    ? null
    : (
        await readMarker(
          attemptRoot,
          "transport-error.json",
          transportErrorSchema,
        )
      ).value;
  const context: C6SourceV3SimpleAttemptContext = {
    attemptNumber: attempt.attemptNumber,
    attemptRoot,
    evaluationId: attempt.evaluationId,
    executionContractSha256:
      attempt.executionContractSha256,
    frozenInputClosureSha256:
      attempt.frozenInputClosureSha256,
    logicalRequestIdentitySha256:
      attempt.logicalRequestIdentitySha256,
    logicalRequestOrdinal:
      attempt.logicalRequestOrdinal,
    pass: attempt.pass,
    priorAttemptCommitSha256:
      attempt.priorAttemptCommitSha256,
    priorLogicalRequestCompletionSha256:
      requestCommitted.value
        .priorLogicalRequestCompletionSha256,
    runtimeAuthorizationSha256:
      attempt.runtimeAuthorizationSha256,
  };
  const state = await inspectC6SourceV3SimpleAttempt(
    context,
  );
  if (
    state.kind !== "committed" ||
    state.attempt.bytes !== reference.bytes ||
    state.attempt.sha256 !== reference.sha256
  ) {
    throw new Error(
      "C6 source-v3-simple attempt replay mismatch",
    );
  }
  const retryDecision = (
    await readMarker(
      attemptRoot,
      "retry-decision.json",
      retryDecisionSchema,
    )
  ).value;
  if (
    responseStarted !== null &&
    responseBody !== null
  ) {
    assertCallerClassification(
      classifyC6SourceV3SimpleHttpResponse({
        attemptNumber: attempt.attemptNumber,
        durableRequest,
        responseBody,
        responseStarted,
      }),
      retryDecision,
    );
  } else if (transportError !== null) {
    assertCallerClassification(
      classifyC6SourceV3SimpleTransportError({
        attemptNumber: attempt.attemptNumber,
        transportError,
      }),
      retryDecision,
    );
  }
  return {
    attempt,
    durableRequest,
    responseBody,
    responseStarted,
    requestCommitted: requestCommitted.value,
    retryDecision,
  };
}

function validationResult(
  projection: C6SourceV3SimpleProjection,
  successfulAttempt: Awaited<
    ReturnType<typeof verifyCommittedAttempt>
  >,
): {
  pacing: {
    receivedAt: string;
    responseDate: string;
    remaining: number;
    resetUnixSeconds: number;
  };
  projectedRequest:
    C6SourceV3SimpleProjectedLogicalRequest;
} {
  const responseStarted =
    successfulAttempt.responseStarted;
  if (responseStarted === null) {
    throw new Error(
      "C6 source-v3-simple pacing evidence is missing",
    );
  }
  const rateLimitHeaders =
    assertC6SourceV3SimpleRateLimitConsistency({
      headers: responseStarted.headers,
      rateLimit: projection.result.rateLimit,
    });
  const pacing = {
    receivedAt: responseStarted.receivedAt,
    responseDate: rateLimitHeaders.date,
    remaining: rateLimitHeaders.remaining,
    resetUnixSeconds:
      rateLimitHeaders.resetUnixSeconds,
  };
  if (
    projection.operationName ===
      "C6SourceV3SimpleRepositoryCount"
  ) {
    return {
      pacing,
      projectedRequest: {
        ...projection,
        request: successfulAttempt.durableRequest,
      },
    };
  }
  if (
    projection.operationName ===
      "C6SourceV3SimpleRepositoryPage"
  ) {
    return {
      pacing,
      projectedRequest: {
        ...projection,
        request: successfulAttempt.durableRequest,
      },
    };
  }
  return {
    pacing,
    projectedRequest: {
      ...projection,
      request: successfulAttempt.durableRequest,
    },
  };
}

async function readDurableRequest(
  attemptRoot: string,
  requestCommitted: z.infer<
    typeof requestCommittedSchema
  >,
): Promise<C6SourceV3SimpleDurableGraphqlRequest> {
  return verifyC6SourceV3SimpleDurableGraphqlRequest({
    body: await verifyReference(
      attemptRoot,
      requestCommitted.requestBody,
      "request-body.raw",
    ),
    persistedRequest: parseCanonicalJson(
      await verifyReference(
        attemptRoot,
        requestCommitted.request,
        "request.json",
      ),
    ),
  });
}

interface C6SourceV3SimpleAttemptClassification {
  decision: "retry" | "stop-success" | "stop-terminal";
  notBefore: string | null;
  reason: z.infer<typeof retryReasonSchema>;
}

function classifyC6SourceV3SimpleTransportError(
  input: {
    attemptNumber: number;
    transportError:
      z.infer<typeof transportErrorSchema>;
  },
): C6SourceV3SimpleAttemptClassification {
  const retryableCodes = new Set([
    "ABORT_ERR",
    "C6_REQUEST_TIMEOUT",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETDOWN",
    "ENETRESET",
    "ENETUNREACH",
    "ENOTFOUND",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
  ]);
  const retryable =
    input.transportError.phase ===
      "process-interruption-before-response" ||
    input.transportError.name === "AbortError" ||
    (
      input.transportError.code !== null &&
      retryableCodes.has(input.transportError.code)
    );
  if (!retryable) {
    return {
      decision: "stop-terminal",
      notBefore: null,
      reason: "terminal-transport-error",
    };
  }
  if (input.attemptNumber === 4) {
    return {
      decision: "stop-terminal",
      notBefore: null,
      reason: "maximum-attempts-exhausted",
    };
  }
  const retry = computeC6SourceV3SimpleRetryNotBefore({
    failedAttemptNumber: input.attemptNumber,
    rateLimitMode: "none",
    rateLimitResetUnixSeconds: null,
    receivedAtMilliseconds: Date.parse(
      input.transportError.occurredAt,
    ),
    responseDate: null,
    retryAfter: null,
  });
  return {
    decision: "retry",
    notBefore: retry.notBefore,
    reason:
      input.transportError.phase ===
        "process-interruption-before-response"
        ? "process-interruption-before-response"
        : "retryable-transport-code",
  };
}

function classifyC6SourceV3SimpleHttpResponse(
  input: {
    attemptNumber: number;
    durableRequest:
      C6SourceV3SimpleDurableGraphqlRequest;
    responseBody: Buffer;
    responseStarted:
      z.infer<typeof responseStartedSchema>;
  },
): C6SourceV3SimpleAttemptClassification {
  const status = input.responseStarted.httpStatus;
  if (status === 200) {
    try {
      projectC6SourceV3SimpleSuccessfulResponse({
        durableRequest: input.durableRequest,
        responseBody: input.responseBody,
        responseStarted: input.responseStarted,
      });
      return {
        decision: "stop-success",
        notBefore: null,
        reason: "graphql-success",
      };
    } catch (error) {
      if (
        error instanceof
          C6SourceV3SimpleGraphqlResponseError
      ) {
        const retryable = error.types.length > 0 &&
          error.types.every((type) =>
            type !== null &&
            [
              "INTERNAL",
              "INTERNAL_SERVER_ERROR",
              "RATE_LIMITED",
              "SERVICE_UNAVAILABLE",
              "TIMEOUT",
            ].includes(type)
          );
        if (!retryable) {
          return {
            decision: "stop-terminal",
            notBefore: null,
            reason: "terminal-graphql-errors",
          };
        }
        return retryableHttpClassification({
          ...input,
          graphqlErrorTypes: error.types,
          rateLimitHeadersRequired: true,
          reason: "retryable-graphql-errors",
        });
      }
      return {
        decision: "stop-terminal",
        notBefore: null,
        reason: "terminal-response-schema",
      };
    }
  }
  if (
    [429, 500, 502, 503, 504].includes(status)
  ) {
    return retryableHttpClassification({
      ...input,
      graphqlErrorTypes: [],
      rateLimitHeadersRequired: false,
      reason: "retryable-http-status",
    });
  }
  if (status === 403) {
    try {
      const headers = optionalRetryHeaders(
        input.responseStarted.headers,
      );
      const mode = headers.remaining === null
        ? headers.retryAfter === null
          ? "none"
          : "secondary"
        : deriveC6SourceV3SimpleRateLimitMode({
          graphqlErrorTypes: [],
          httpStatus: status,
          remaining: headers.remaining,
          responseBody: input.responseBody,
          retryAfter: headers.retryAfter,
        });
      if (mode === "primary" || mode === "secondary") {
        return retryableHttpClassification({
          ...input,
          graphqlErrorTypes: [],
          rateLimitHeadersRequired: false,
          reason: "retryable-http-status",
        });
      }
    } catch {
      return {
        decision: "stop-terminal",
        notBefore: null,
        reason: "terminal-response-schema",
      };
    }
  }
  return {
    decision: "stop-terminal",
    notBefore: null,
    reason: "terminal-http-status",
  };
}

function retryableHttpClassification(
  input: {
    attemptNumber: number;
    durableRequest:
      C6SourceV3SimpleDurableGraphqlRequest;
    graphqlErrorTypes: readonly (string | null)[];
    rateLimitHeadersRequired: boolean;
    reason:
      | "retryable-graphql-errors"
      | "retryable-http-status";
    responseBody: Buffer;
    responseStarted:
      z.infer<typeof responseStartedSchema>;
  },
): C6SourceV3SimpleAttemptClassification {
  if (input.attemptNumber === 4) {
    return {
      decision: "stop-terminal",
      notBefore: null,
      reason: "maximum-attempts-exhausted",
    };
  }
  try {
    const headers = optionalRetryHeaders(
      input.responseStarted.headers,
    );
    if (
      input.rateLimitHeadersRequired &&
      headers.remaining === null
    ) {
      throw new Error(
        "C6 source-v3-simple retry rate-limit headers are missing",
      );
    }
    const rateLimitMode =
      input.responseStarted.httpStatus === 429
        ? "secondary"
        : headers.remaining === null
        ? "none"
        : deriveC6SourceV3SimpleRateLimitMode({
        graphqlErrorTypes: input.graphqlErrorTypes,
        httpStatus:
          input.responseStarted.httpStatus,
        remaining: headers.remaining,
        responseBody: input.responseBody,
        retryAfter: headers.retryAfter,
      });
    const retry = computeC6SourceV3SimpleRetryNotBefore({
      failedAttemptNumber: input.attemptNumber,
      rateLimitMode:
        rateLimitMode === "primary"
          ? "primary"
          : rateLimitMode === "secondary"
          ? "secondary"
          : "none",
      rateLimitResetUnixSeconds:
        rateLimitMode === "primary"
          ? headers.resetUnixSeconds!
          : null,
      receivedAtMilliseconds: Date.parse(
        input.responseStarted.receivedAt,
      ),
      responseDate: headers.date,
      retryAfter: headers.retryAfter,
    });
    return {
      decision: "retry",
      notBefore: retry.notBefore,
      reason: input.reason,
    };
  } catch {
    return {
      decision: "stop-terminal",
      notBefore: null,
      reason: "terminal-response-schema",
    };
  }
}

function retryHeaders(
  headers: Readonly<Record<string, string>>,
): {
  date: string | null;
  remaining: number;
  resetUnixSeconds: number;
  retryAfter: string | null;
} {
  const remaining = parseNonnegativeHeader(
    headers,
    "x-ratelimit-remaining",
  );
  const resetUnixSeconds = parseNonnegativeHeader(
    headers,
    "x-ratelimit-reset",
  );
  return {
    date: headers.date ?? null,
    remaining,
    resetUnixSeconds,
    retryAfter: headers["retry-after"] ?? null,
  };
}

function optionalRetryHeaders(
  headers: Readonly<Record<string, string>>,
): {
  date: string | null;
  remaining: number | null;
  resetUnixSeconds: number | null;
  retryAfter: string | null;
} {
  const hasRemaining =
    headers["x-ratelimit-remaining"] !== undefined;
  const hasReset =
    headers["x-ratelimit-reset"] !== undefined;
  if (hasRemaining !== hasReset) {
    throw new Error(
      "C6 source-v3-simple incomplete rate-limit headers",
    );
  }
  if (!hasRemaining) {
    return {
      date: headers.date ?? null,
      remaining: null,
      resetUnixSeconds: null,
      retryAfter: headers["retry-after"] ?? null,
    };
  }
  return retryHeaders(headers);
}

function parseNonnegativeHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): number {
  const value = headers[name];
  if (
    value === undefined ||
    !/^(0|[1-9]\d*)$/u.test(value)
  ) {
    throw new Error(
      `C6 source-v3-simple invalid ${name}`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(
      `C6 source-v3-simple invalid ${name}`,
    );
  }
  return parsed;
}

function assertCallerClassification(
  expected: C6SourceV3SimpleAttemptClassification,
  actual: {
    decision: "retry" | "stop-success" | "stop-terminal";
    notBefore: string | null;
    reason: z.infer<typeof retryReasonSchema>;
  },
): void {
  if (
    expected.decision !== actual.decision ||
    expected.notBefore !== actual.notBefore ||
    expected.reason !== actual.reason
  ) {
    const suffix =
      expected.reason ===
        "maximum-attempts-exhausted"
        ? ": maximum attempts exhausted"
        : "";
    throw new Error(
      `C6 source-v3-simple attempt classification mismatch${suffix}`,
    );
  }
}

async function projectSuccessfulAttempt(
  verified: Awaited<
    ReturnType<typeof verifyCommittedAttempt>
  >,
): Promise<
  C6SourceV3SimpleProjection
> {
  if (
    verified.attempt.outcome !== "stop-success" ||
    verified.responseStarted === null ||
    verified.responseBody === null
  ) {
    throw new Error(
      "C6 source-v3-simple successful response evidence mismatch",
    );
  }
  return projectC6SourceV3SimpleSuccessfulResponse({
    durableRequest: verified.durableRequest,
    responseBody: verified.responseBody,
    responseStarted: verified.responseStarted,
  });
}

function projectC6SourceV3SimpleSuccessfulResponse(
  input: {
    durableRequest:
      C6SourceV3SimpleDurableGraphqlRequest;
    responseBody: Buffer;
    responseStarted:
      z.infer<typeof responseStartedSchema>;
  },
): C6SourceV3SimpleProjection {
  if (input.responseStarted.httpStatus !== 200) {
    throw new Error(
      "C6 source-v3-simple successful HTTP status mismatch",
    );
  }
  const operationName =
    input.durableRequest.persistedRequest
      .operationName;
  let projection: C6SourceV3SimpleProjection;
  if (
    operationName ===
      "C6SourceV3SimpleRepositoryCount"
  ) {
    projection = {
      operationName,
      result:
        projectC6SourceV3SimpleRepositoryCount(
          input.responseBody,
        ),
    };
  } else if (
    operationName ===
      "C6SourceV3SimpleRepositoryPage"
  ) {
    projection = {
      operationName,
      result:
        projectC6SourceV3SimpleRepositoryPage(
          input.responseBody,
        ),
    };
  } else if (
    operationName ===
      "C6SourceV3SimplePullRequestPage"
  ) {
    const repositoryNodeId =
      input.durableRequest.persistedRequest
        .variables.repositoryNodeId;
    if (typeof repositoryNodeId !== "string") {
      throw new Error(
        "C6 source-v3-simple pull request identity is missing",
      );
    }
    projection = {
      operationName,
      result:
        projectC6SourceV3SimplePullRequestPage({
          body: input.responseBody,
          requestedRepositoryNodeId:
            repositoryNodeId,
        }),
    };
  } else {
    throw new Error(
      "C6 source-v3-simple operation mismatch",
    );
  }
  assertC6SourceV3SimpleRateLimitConsistency({
    headers: input.responseStarted.headers,
    rateLimit: projection.result.rateLimit,
  });
  return projection;
}

async function inspectFinalizeAttempt(
  context: C6SourceV3SimpleAttemptContext,
  basisArtifactSha256: string,
): Promise<C6SourceV3SimpleAttemptResumeState> {
  const retryDecision = await readMarker(
    context.attemptRoot,
    "retry-decision.json",
    retryDecisionSchema,
  );
  assertMarkerContext(retryDecision.value, context);
  if (
    retryDecision.value.basisArtifactSha256 !==
      basisArtifactSha256
  ) {
    throw new Error("retry-decision chain mismatch");
  }
  return {
    kind: "finalize-attempt",
    outcome: retryDecision.value.decision,
    retryDecision: retryDecision.ref,
  };
}

async function commitCreateOnlyMarker<
  T extends z.ZodTypeAny,
>(
  root: string,
  path: string,
  value: z.input<T>,
  schema?: T,
): Promise<C6SourceV3SimpleArtifactReference> {
  const parsed = schema === undefined
    ? value
    : schema.parse(value);
  return await commitCreateOnlyBytes(
    root,
    path,
    Buffer.from(
      `${JSON.stringify(parsed, null, 2)}\n`,
    ),
  );
}

async function commitOrVerifyCreateOnlyMarker<
  T extends z.ZodTypeAny,
>(
  root: string,
  path: string,
  value: z.input<T>,
  schema?: T,
): Promise<C6SourceV3SimpleArtifactReference> {
  const parsed = schema === undefined
    ? value
    : schema.parse(value);
  return await commitOrVerifyCreateOnlyBytes(
    root,
    path,
    Buffer.from(
      `${JSON.stringify(parsed, null, 2)}\n`,
    ),
  );
}

async function commitOrVerifyCreateOnlyBytes(
  root: string,
  path: string,
  bytes: Uint8Array,
): Promise<C6SourceV3SimpleArtifactReference> {
  try {
    return await commitCreateOnlyBytes(
      root,
      path,
      bytes,
    );
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) {
      throw error;
    }
  }
  const existing = await readC6StableRegularFile(
    join(root, path),
    `source-v3-simple ledger ${path}`,
    undefined,
    true,
  );
  if (!Buffer.from(existing).equals(Buffer.from(bytes))) {
    throw new Error(
      "C6 source-v3-simple existing artifact mismatch",
    );
  }
  return {
    bytes: existing.length,
    path,
    sha256: sha256(existing),
  };
}

async function commitCreateOnlyBytes(
  root: string,
  path: string,
  bytes: Uint8Array,
): Promise<C6SourceV3SimpleArtifactReference> {
  assertLocalArtifactName(path);
  const finalPath = join(root, path);
  const pendingPath = join(
    dirname(finalPath),
    `.${basename(finalPath)}.pending`,
  );
  await assertC6NoSymlinkPathComponents(
    dirname(finalPath),
    "C6 source-v3-simple ledger directory",
  );
  const handle = await open(
    pendingPath,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    FILE_MODE,
  );
  let linked = false;
  try {
    await handle.writeFile(bytes);
    await handle.chmod(FILE_MODE);
    await handle.sync();
    await handle.close();
    await link(pendingPath, finalPath);
    linked = true;
    await syncDirectory(dirname(finalPath));
    await unlink(pendingPath);
    await syncDirectory(dirname(finalPath));
  } catch (error) {
    await handle.close().catch(() => undefined);
    if (!linked) {
      await unlink(pendingPath).catch(() => undefined);
    }
    throw error;
  }
  return {
    bytes: bytes.byteLength,
    path,
    sha256: sha256(bytes),
  };
}

function assertLocalArtifactName(
  path: string,
): void {
  if (
    basename(path) !== path ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(path) ||
    path.endsWith(".pending")
  ) {
    throw new Error(
      "C6 source-v3-simple invalid artifact name",
    );
  }
}

async function readMarker<T extends z.ZodTypeAny>(
  root: string,
  path: string,
  schema: T,
): Promise<{
  ref: C6SourceV3SimpleArtifactReference;
  value: z.output<T>;
}> {
  const bytes = await readC6StableRegularFile(
    join(root, path),
    `source-v3-simple ledger ${path}`,
    undefined,
    true,
  );
  const text = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(bytes);
  const raw = JSON.parse(text) as unknown;
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error("marker is not canonical JSON");
  }
  return {
    ref: {
      bytes: bytes.length,
      path,
      sha256: sha256(bytes),
    },
    value: schema.parse(raw),
  };
}

async function readOptionalMarker<
  T extends z.ZodTypeAny,
>(
  root: string,
  path: string,
  schema: T,
): Promise<{
  ref: C6SourceV3SimpleArtifactReference;
  value: z.output<T>;
} | null> {
  if (!(await pathExists(join(root, path)))) {
    return null;
  }
  return await readMarker(root, path, schema);
}

async function verifyReference(
  root: string,
  reference: C6SourceV3SimpleArtifactReference,
  expectedPath: string,
): Promise<Buffer> {
  assertExpectedReference(reference, expectedPath);
  const bytes = await readC6StableRegularFile(
    join(root, expectedPath),
    `source-v3-simple ledger ${expectedPath}`,
    undefined,
    true,
  );
  if (
    bytes.length !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error("artifact reference mismatch");
  }
  return bytes;
}

async function readRootReference(
  root: string,
  reference: C6SourceV3SimpleArtifactReference,
): Promise<Buffer> {
  artifactReferenceSchema.parse(reference);
  const rootPath = resolve(root);
  const path = resolve(rootPath, reference.path);
  const relativePath = relative(rootPath, path);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath.length === 0
  ) {
    throw new Error(
      "C6 source-v3-simple artifact escapes its root",
    );
  }
  const bytes = await readC6StableRegularFile(
    path,
    "source-v3-simple ledger artifact",
    undefined,
    true,
  );
  if (
    bytes.length !== reference.bytes ||
    sha256(bytes) !== reference.sha256
  ) {
    throw new Error(
      "C6 source-v3-simple artifact reference mismatch",
    );
  }
  return bytes;
}

function rebaseArtifactReference(
  assetRoot: string,
  localRoot: string,
  reference: C6SourceV3SimpleArtifactReference,
): C6SourceV3SimpleArtifactReference {
  assertExpectedReference(reference, "attempt.json");
  const path = relative(
    resolve(assetRoot),
    resolve(localRoot, reference.path),
  );
  if (
    path === ".." ||
    path.startsWith(`..${sep}`) ||
    path.length === 0
  ) {
    throw new Error(
      "C6 source-v3-simple attempt escapes asset root",
    );
  }
  return {
    ...reference,
    path,
  };
}

function rebaseLocalReference(
  assetRoot: string,
  localRoot: string,
  reference: C6SourceV3SimpleArtifactReference,
): C6SourceV3SimpleArtifactReference {
  if (basename(reference.path) !== reference.path) {
    throw new Error(
      "C6 source-v3-simple local artifact path mismatch",
    );
  }
  const path = relative(
    resolve(assetRoot),
    resolve(localRoot, reference.path),
  );
  if (
    path === ".." ||
    path.startsWith(`..${sep}`) ||
    path.length === 0
  ) {
    throw new Error(
      "C6 source-v3-simple local artifact escapes asset root",
    );
  }
  return {
    ...reference,
    path,
  };
}

async function verifyMarkerReference<
  T extends z.ZodTypeAny,
>(
  context: C6SourceV3SimpleAttemptContext,
  reference: C6SourceV3SimpleArtifactReference,
  path: string,
  schema: T,
): Promise<z.output<T>> {
  assertExpectedReference(reference, path);
  const marker = await readMarker(
    context.attemptRoot,
    path,
    schema,
  );
  if (!isDeepStrictEqual(marker.ref, reference)) {
    throw new Error(
      "C6 source-v3-simple artifact reference mismatch",
    );
  }
  assertMarkerContext(
    contextSchema.passthrough().parse(marker.value),
    context,
  );
  return marker.value;
}

function parseCanonicalJson(bytes: Uint8Array): unknown {
  const text = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(bytes);
  const raw = JSON.parse(text) as unknown;
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error("artifact is not canonical JSON");
  }
  return raw;
}

function assertExpectedReference(
  reference: C6SourceV3SimpleArtifactReference,
  expectedPath: string,
): void {
  artifactReferenceSchema.parse(reference);
  if (reference.path !== expectedPath) {
    throw new Error(
      "C6 source-v3-simple artifact path mismatch",
    );
  }
}

function commonMarker(
  context: C6SourceV3SimpleAttemptContext,
) {
  return {
    attemptNumber: context.attemptNumber,
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
    runtimeAuthorizationSha256:
      context.runtimeAuthorizationSha256,
  };
}

function assertContext(
  context: C6SourceV3SimpleAttemptContext,
): void {
  contextSchema.parse(commonMarker(context));
  sha256Schema.nullable().parse(
    context.priorAttemptCommitSha256,
  );
  sha256Schema.parse(
    context.priorLogicalRequestCompletionSha256,
  );
  if (
    (context.attemptNumber === 1) !==
      (context.priorAttemptCommitSha256 === null)
  ) {
    throw new Error(
      "C6 source-v3-simple prior attempt binding mismatch",
    );
  }
}

function assertLogicalRequestIdentity(
  context: C6SourceV3SimpleAttemptContext,
  request: C6SourceV3SimpleDurableGraphqlRequest,
): void {
  const actual =
    computeC6SourceV3SimpleLogicalRequestIdentitySha256({
      evaluationId: context.evaluationId,
      executionContractSha256:
        context.executionContractSha256,
      frozenInputClosureSha256:
        context.frozenInputClosureSha256,
      logicalRequestOrdinal:
        context.logicalRequestOrdinal,
      pass: context.pass,
      request,
      runtimeAuthorizationSha256:
        context.runtimeAuthorizationSha256,
    });
  if (
    context.logicalRequestIdentitySha256 !== actual
  ) {
    throw new Error(
      "C6 source-v3-simple logical request identity mismatch",
    );
  }
}

async function assertPriorAttemptBinding(
  context: C6SourceV3SimpleAttemptContext,
): Promise<void> {
  if (context.attemptNumber === 1) {
    return;
  }
  const expectedName =
    `attempt-${String(context.attemptNumber).padStart(
      2,
      "0",
    )}`;
  if (basename(context.attemptRoot) !== expectedName) {
    throw new Error(
      "C6 source-v3-simple attempt directory name mismatch",
    );
  }
  const previousRoot = join(
    dirname(context.attemptRoot),
    `attempt-${
      String(context.attemptNumber - 1).padStart(
        2,
        "0",
      )
    }`,
  );
  const previousAttempt = await readMarker(
    previousRoot,
    "attempt.json",
    attemptSchema,
  ).catch((error: unknown) => {
    throw new Error(
      "C6 source-v3-simple prior attempt binding is missing",
      {
        cause: error,
      },
    );
  });
  const previousRequestCommitted = await readMarker(
    previousRoot,
    "request-committed.json",
    requestCommittedSchema,
  );
  const previousContext:
    C6SourceV3SimpleAttemptContext = {
      attemptNumber:
        previousAttempt.value.attemptNumber,
      attemptRoot: previousRoot,
      evaluationId:
        previousAttempt.value.evaluationId,
      executionContractSha256:
        previousAttempt.value
          .executionContractSha256,
      frozenInputClosureSha256:
        previousAttempt.value
          .frozenInputClosureSha256,
      logicalRequestIdentitySha256:
        previousAttempt.value
          .logicalRequestIdentitySha256,
      logicalRequestOrdinal:
        previousAttempt.value.logicalRequestOrdinal,
      pass: previousAttempt.value.pass,
      priorAttemptCommitSha256:
        previousAttempt.value
          .priorAttemptCommitSha256,
      priorLogicalRequestCompletionSha256:
        previousRequestCommitted.value
          .priorLogicalRequestCompletionSha256,
      runtimeAuthorizationSha256:
        previousAttempt.value
          .runtimeAuthorizationSha256,
    };
  const state = await inspectC6SourceV3SimpleAttempt(
    previousContext,
  );
  if (
    state.kind !== "committed" ||
    state.outcome !== "retry" ||
    previousAttempt.value.attemptNumber !==
      context.attemptNumber - 1 ||
    previousAttempt.value.evaluationId !==
      context.evaluationId ||
    previousAttempt.value.executionContractSha256 !==
      context.executionContractSha256 ||
    previousAttempt.value.frozenInputClosureSha256 !==
      context.frozenInputClosureSha256 ||
    previousAttempt.value.logicalRequestIdentitySha256 !==
      context.logicalRequestIdentitySha256 ||
    previousAttempt.value.logicalRequestOrdinal !==
      context.logicalRequestOrdinal ||
    previousAttempt.value.pass !== context.pass ||
    previousAttempt.value.runtimeAuthorizationSha256 !==
      context.runtimeAuthorizationSha256 ||
    previousRequestCommitted.value
      .priorLogicalRequestCompletionSha256 !==
      context.priorLogicalRequestCompletionSha256 ||
    state.attempt.sha256 !==
      context.priorAttemptCommitSha256
  ) {
    throw new Error(
      "C6 source-v3-simple prior attempt binding mismatch",
    );
  }
}

function assertMarkerContext(
  marker: z.infer<typeof contextSchema>,
  context: C6SourceV3SimpleAttemptContext,
): void {
  if (
    marker.attemptNumber !== context.attemptNumber ||
    marker.evaluationId !== context.evaluationId ||
    marker.executionContractSha256 !==
      context.executionContractSha256 ||
    marker.frozenInputClosureSha256 !==
      context.frozenInputClosureSha256 ||
    marker.logicalRequestIdentitySha256 !==
      context.logicalRequestIdentitySha256 ||
    marker.logicalRequestOrdinal !==
      context.logicalRequestOrdinal ||
    marker.pass !== context.pass ||
    marker.runtimeAuthorizationSha256 !==
      context.runtimeAuthorizationSha256
  ) {
    throw new Error("marker context mismatch");
  }
}

function orderedSelectedHeaders(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const selected = new Set(
    buildC6SourceV3SimpleCensusExecutionContract()
      .transport.selectedResponseHeaders,
  );
  const entries = Object.entries(headers).sort(
    ([left], [right]) =>
      Buffer.compare(
        Buffer.from(left),
        Buffer.from(right),
      ),
  );
  if (
    entries.some(([name]) =>
      !selected.has(name as never)
    )
  ) {
    throw new Error(
      "C6 source-v3-simple response header is not allowlisted",
    );
  }
  return Object.fromEntries(entries);
}

function assertSecretAbsent(
  bytes: Uint8Array,
  secret: Uint8Array,
): void {
  const needle = Buffer.from(secret);
  if (
    needle.length === 0 ||
    Buffer.from(bytes).includes(needle)
  ) {
    throw new C6SourceV3SimpleSecretLeakError();
  }
}

async function prepareAttemptRoot(
  root: string,
  recoverPending = true,
): Promise<void> {
  let existing = resolve(root);
  while (!(await pathExistsOrDirectory(existing))) {
    const parent = dirname(existing);
    if (parent === existing) {
      throw new Error(
        "C6 source-v3-simple attempt root has no existing ancestor",
      );
    }
    existing = parent;
  }
  await assertC6NoSymlinkPathComponents(
    existing,
    "C6 source-v3-simple attempt root parent",
  );
  await mkdir(root, {
    mode: DIRECTORY_MODE,
    recursive: true,
  });
  await assertC6NoSymlinkPathComponents(
    root,
    "C6 source-v3-simple attempt root",
  );
  if (recoverPending) {
    await recoverPendingFiles(root);
  }
}

async function pathExistsOrDirectory(
  path: string,
): Promise<boolean> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw new Error(
        "C6 source-v3-simple attempt root parent is a symlink",
      );
    }
    if (!stats.isDirectory()) {
      throw new Error(
        "C6 source-v3-simple attempt root parent is not a directory",
      );
    }
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function recoverPendingFiles(
  root: string,
  isKnown: (name: string) => boolean =
    isKnownPendingArtifactName,
): Promise<void> {
  const entries = (await readdir(root))
    .filter((entry) => entry.endsWith(".pending"))
    .sort();
  for (const entry of entries) {
    const match = /^\.([^/]+)\.pending$/u.exec(entry);
    if (match === null) {
      throw new Error(
        "C6 source-v3-simple invalid pending artifact",
      );
    }
    if (!isKnown(match[1]!)) {
      throw new Error(
        "C6 source-v3-simple unknown pending artifact",
      );
    }
    const pendingPath = join(root, entry);
    const finalPath = join(root, match[1]!);
    const pendingStats = await lstat(pendingPath);
    if (
      pendingStats.isSymbolicLink() ||
      !pendingStats.isFile()
    ) {
      throw new Error(
        "C6 source-v3-simple pending artifact is not a regular file",
      );
    }
    const finalStats = await lstat(finalPath).catch(
      (error: unknown) => {
        if (hasErrorCode(error, "ENOENT")) {
          return null;
        }
        throw error;
      },
    );
    if (
      finalStats !== null &&
      (
        finalStats.isSymbolicLink() ||
        !finalStats.isFile() ||
        finalStats.dev !== pendingStats.dev ||
        finalStats.ino !== pendingStats.ino
      )
    ) {
      throw new Error(
        "C6 source-v3-simple pending/final inode mismatch",
      );
    }
    if (finalStats === null) {
      await link(pendingPath, finalPath);
      await syncDirectory(root);
    }
    await unlink(pendingPath);
    await syncDirectory(root);
  }
}

function isKnownPendingArtifactName(
  name: string,
): boolean {
  return new Set([
    "asset-lock.json",
    "attempt.json",
    "census-receipt.json",
    "count-tree-closure.json",
    "failure-evidence.json",
    "frozen-input-closure.json",
    "input-mutation-evidence.json",
    "normalized-pass.json",
    "normalized-projection.json",
    "pass-complete.json",
    "pull-request-closure.json",
    "repository-closure.json",
    "request-body.raw",
    "request-committed.json",
    "request.json",
    "response-body.raw",
    "response-complete.json",
    "response-started.json",
    "retry-decision.json",
    "terminal.json",
    "transport-error.json",
    "two-pass-equality.json",
  ]).has(name) ||
    /^logical-request-complete-\d{8}\.json$/u.test(
      name,
    ) ||
    /^logical-request-result-\d{8}\.json$/u.test(
      name,
    );
}

function isKnownPendingArtifactAtPath(
  relativeRoot: string,
  name: string,
): boolean {
  if (relativeRoot.length === 0) {
    return new Set([
      "asset-lock.json",
      "census-receipt.json",
      "failure-evidence.json",
      "frozen-input-closure.json",
      "input-mutation-evidence.json",
      "terminal.json",
      "two-pass-equality.json",
    ]).has(name);
  }
  if (/^pass-[ab]$/u.test(relativeRoot)) {
    return new Set([
      "count-tree-closure.json",
      "normalized-pass.json",
      "normalized-projection.json",
      "pass-complete.json",
      "pull-request-closure.json",
      "repository-closure.json",
    ]).has(name) ||
      /^logical-request-(?:complete|result)-\d{8}\.json$/u
        .test(name);
  }
  if (
    /^pass-[ab]\/logical-request-\d{8}\/attempt-\d{2}$/u
      .test(relativeRoot)
  ) {
    return new Set([
      "attempt.json",
      "request-body.raw",
      "request-committed.json",
      "request.json",
      "response-body.raw",
      "response-complete.json",
      "response-started.json",
      "retry-decision.json",
      "transport-error.json",
    ]).has(name);
  }
  return false;
}

function isKnownAssetDirectory(
  relativeRoot: string,
  name: string,
): boolean {
  if (relativeRoot.length === 0) {
    return /^pass-[ab]$/u.test(name);
  }
  if (/^pass-[ab]$/u.test(relativeRoot)) {
    return /^logical-request-\d{8}$/u.test(name);
  }
  return /^pass-[ab]\/logical-request-\d{8}$/u
      .test(relativeRoot) &&
    /^attempt-\d{2}$/u.test(name);
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("ledger path is not a regular file");
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

async function anyExists(
  root: string,
  paths: readonly string[],
): Promise<boolean> {
  for (const path of paths) {
    if (await pathExists(join(root, path))) {
      return true;
    }
  }
  const entries = await readdir(root);
  return entries.some((entry) =>
    entry.endsWith(".pending")
  );
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

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
