import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  buildC6SourceV3SimpleCensusExecutionContract,
} from "./c6-source-v3-simple-census-contract";
import type {
  C6SourceV3SimpleRateLimit,
} from "./c6-source-v3-simple-census-graphql";

const TRANSPORT_CONTRACT =
  buildC6SourceV3SimpleCensusExecutionContract()
    .transport;
const repositoryCountVariablesSchema = z.object({
  query: z.string().min(1),
}).strict();
const repositoryPageVariablesSchema = z.object({
  after: z.string().min(1).nullable(),
  query: z.string().min(1),
}).strict();
const pullRequestPageVariablesSchema = z.object({
  after: z.string().min(1).nullable(),
  repositoryNodeId: z.string().min(1),
}).strict();
const persistedRequestSchema = z.object({
  bodyBytes: z.number().int().nonnegative(),
  bodySha256: z.string().regex(/^[a-f0-9]{64}$/u),
  endpoint: z.string().url(),
  headers: z.record(z.string(), z.string()),
  method: z.literal("POST"),
  operationName: z.string().min(1),
  queryBytes: z.number().int().nonnegative(),
  querySha256: z.string().regex(/^[a-f0-9]{64}$/u),
  redirect: z.literal("error"),
  variables: z.record(z.string(), z.unknown()),
  variablesSha256:
    z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

type RequestInput =
  | {
      operation: "repositoryCount";
      variables: z.infer<
        typeof repositoryCountVariablesSchema
      >;
    }
  | {
      operation: "repositoryPage";
      variables: z.infer<
        typeof repositoryPageVariablesSchema
      >;
    }
  | {
      operation: "pullRequestPage";
      variables: z.infer<
        typeof pullRequestPageVariablesSchema
      >;
    };

export interface C6SourceV3SimpleDurableGraphqlRequest {
  body: Buffer;
  bodySha256: string;
  persistedRequest: {
    bodyBytes: number;
    bodySha256: string;
    endpoint: string;
    headers: Record<string, string>;
    method: "POST";
    operationName: string;
    queryBytes: number;
    querySha256: string;
    redirect: "error";
    variables: Record<string, unknown>;
    variablesSha256: string;
  };
}

export function buildC6SourceV3SimpleDurableGraphqlRequest(
  input: RequestInput,
): C6SourceV3SimpleDurableGraphqlRequest {
  const contract =
    buildC6SourceV3SimpleCensusExecutionContract();
  const operation = contract.graphql.operations[
    input.operation
  ];
  const variables = orderedVariables(input);
  const body = Buffer.from(JSON.stringify({
    operationName: operation.operationName,
    query: operation.query,
    variables,
  }));
  const bodySha256 = sha256(body);
  const persistedHeaders = {
    ...contract.graphql.requestHeaders,
  };
  return {
    body,
    bodySha256,
    persistedRequest: {
      bodyBytes: body.length,
      bodySha256,
      endpoint: contract.graphql.endpoint,
      headers: persistedHeaders,
      method: contract.transport.method,
      operationName: operation.operationName,
      queryBytes: operation.queryBytes,
      querySha256: operation.querySha256,
      redirect: contract.transport.redirect,
      variables,
      variablesSha256: sha256(
        JSON.stringify(variables),
      ),
    },
  };
}

export function verifyC6SourceV3SimpleDurableGraphqlRequest(
  input: {
    body: Uint8Array;
    persistedRequest: unknown;
  },
): C6SourceV3SimpleDurableGraphqlRequest {
  const persistedRequest =
    persistedRequestSchema.parse(
      input.persistedRequest,
    );
  const requestInput = requestInputFromPersisted(
    persistedRequest.operationName,
    persistedRequest.variables,
  );
  const expected =
    buildC6SourceV3SimpleDurableGraphqlRequest(
      requestInput,
    );
  if (
    !Buffer.from(input.body).equals(expected.body) ||
    !isDeepStrictEqual(
      persistedRequest,
      expected.persistedRequest,
    )
  ) {
    throw new Error(
      "C6 source-v3-simple durable request mismatch",
    );
  }
  return expected;
}

export function parseC6SourceV3SimpleRetryAfter(input: {
  receivedAtMilliseconds: number;
  responseDate: string | null;
  value: string;
}): number {
  assertTimestamp(
    input.receivedAtMilliseconds,
    "received timestamp",
  );
  const responseDateMilliseconds =
    input.responseDate === null
      ? null
      : parseHttpDate(input.responseDate);
  let targetMilliseconds: number;
  if (/^(0|[1-9]\d*)$/u.test(input.value)) {
    const seconds = Number(input.value);
    if (!Number.isSafeInteger(seconds)) {
      throw new Error(
        "C6 source-v3-simple invalid Retry-After",
      );
    }
    targetMilliseconds =
      input.receivedAtMilliseconds +
      seconds * 1_000;
  } else {
    if (responseDateMilliseconds === null) {
      throw new Error(
        "C6 source-v3-simple invalid Retry-After: HTTP-date requires response Date",
      );
    }
    const serverTargetMilliseconds =
      parseHttpDate(input.value);
    targetMilliseconds =
      input.receivedAtMilliseconds +
      Math.max(
        0,
        serverTargetMilliseconds -
          responseDateMilliseconds,
      );
  }
  if (
    targetMilliseconds -
      input.receivedAtMilliseconds >
      60_000
  ) {
    throw new Error(
      "C6 source-v3-simple Retry-After exceeds maximum",
    );
  }
  return targetMilliseconds;
}

export function computeC6SourceV3SimpleRetryNotBefore(
  input: {
    failedAttemptNumber: number;
    rateLimitMode: "none" | "primary" | "secondary";
    rateLimitResetUnixSeconds: number | null;
    receivedAtMilliseconds: number;
    responseDate: string | null;
    retryAfter: string | null;
  },
): {
  backoffNotBefore: string;
  notBefore: string;
  rateLimitResetNotBefore: string | null;
  retryAfterNotBefore: string | null;
} {
  if (
    !Number.isInteger(input.failedAttemptNumber) ||
    input.failedAttemptNumber < 1 ||
    input.failedAttemptNumber > 3
  ) {
    throw new Error(
      "C6 source-v3-simple failed attempt cannot be retried",
    );
  }
  assertTimestamp(
    input.receivedAtMilliseconds,
    "received timestamp",
  );
  const backoff = [1_000, 2_000, 4_000][
    input.failedAttemptNumber - 1
  ]!;
  const backoffNotBefore =
    input.receivedAtMilliseconds + backoff;
  const retryAfterNotBefore =
    input.retryAfter === null
      ? null
      : parseC6SourceV3SimpleRetryAfter({
          receivedAtMilliseconds:
            input.receivedAtMilliseconds,
          responseDate: input.responseDate,
          value: input.retryAfter,
        });
  let rateLimitResetNotBefore: number | null = null;
  if (input.rateLimitMode === "primary") {
    if (
      input.rateLimitResetUnixSeconds === null ||
      input.responseDate === null ||
      !Number.isSafeInteger(
        input.rateLimitResetUnixSeconds,
      ) ||
      input.rateLimitResetUnixSeconds < 0
    ) {
      throw new Error(
        "C6 source-v3-simple rate-limit reset is invalid",
      );
    }
    rateLimitResetNotBefore =
      correctedRateLimitResetNotBefore({
        receivedAtMilliseconds:
          input.receivedAtMilliseconds,
        resetUnixSeconds:
          input.rateLimitResetUnixSeconds,
        responseDate: input.responseDate,
      });
  } else if (
    input.rateLimitResetUnixSeconds !== null
  ) {
    throw new Error(
      "C6 source-v3-simple unexpected rate-limit reset",
    );
  }
  const notBefore = Math.max(
    backoffNotBefore,
    retryAfterNotBefore ?? 0,
    rateLimitResetNotBefore ?? 0,
  );
  if (
    notBefore - input.receivedAtMilliseconds >
      3_700_000
  ) {
    throw new Error(
      "C6 source-v3-simple retry pause exceeds maximum",
    );
  }
  return {
    backoffNotBefore:
      new Date(backoffNotBefore).toISOString(),
    notBefore: new Date(notBefore).toISOString(),
    rateLimitResetNotBefore:
      rateLimitResetNotBefore === null
        ? null
        : new Date(
            rateLimitResetNotBefore,
          ).toISOString(),
    retryAfterNotBefore:
      retryAfterNotBefore === null
        ? null
        : new Date(retryAfterNotBefore).toISOString(),
  };
}

export function deriveC6SourceV3SimpleRateLimitMode(
  input: {
    graphqlErrorTypes: readonly (string | null)[];
    httpStatus: number;
    remaining: number;
    responseBody: Uint8Array;
    retryAfter: string | null;
  },
):
  | "none"
  | "primary"
  | "proactive"
  | "secondary" {
  if (
    !Number.isInteger(input.httpStatus) ||
    !Number.isSafeInteger(input.remaining) ||
    input.remaining < 0
  ) {
    throw new Error(
      "C6 source-v3-simple rate-limit mode input is invalid",
    );
  }
  if (input.remaining === 0) {
    return "primary";
  }
  const rateLimited = input.graphqlErrorTypes.includes(
    "RATE_LIMITED",
  );
  const foldedBody = Buffer.from(input.responseBody)
    .toString("utf8")
    .toLowerCase();
  const secondaryBody = [
    "secondary rate limit",
    "abuse detection mechanism",
  ].some((value) => foldedBody.includes(value));
  if (
    input.httpStatus === 429 ||
    rateLimited ||
    (
      input.httpStatus === 403 &&
      (input.retryAfter !== null || secondaryBody)
    )
  ) {
    return "secondary";
  }
  if (
    input.httpStatus === 200 &&
    input.graphqlErrorTypes.length === 0 &&
    input.remaining < 50
  ) {
    return "proactive";
  }
  return "none";
}

export function computeC6SourceV3SimpleProactiveNotBefore(
  input: {
    receivedAtMilliseconds: number;
    remaining: number;
    resetUnixSeconds: number;
    responseDate: string;
  },
): string | null {
  const pause =
    deriveC6SourceV3SimpleProactivePause(input);
  if (pause.exceedsMaximum) {
    throw new Error(
      "C6 source-v3-simple proactive pause exceeds maximum",
    );
  }
  return pause.notBefore;
}

export function deriveC6SourceV3SimpleProactivePause(
  input: {
    receivedAtMilliseconds: number;
    remaining: number;
    resetUnixSeconds: number;
    responseDate: string;
  },
): {
  exceedsMaximum: boolean;
  notBefore: string | null;
} {
  if (
    !Number.isSafeInteger(input.remaining) ||
    input.remaining < 0
  ) {
    throw new Error(
      "C6 source-v3-simple remaining quota is invalid",
    );
  }
  if (
    input.remaining >=
      TRANSPORT_CONTRACT.rateLimitPacing
        .minimumRemainingBeforePause
  ) {
    return {
      exceedsMaximum: false,
      notBefore: null,
    };
  }
  const notBefore = correctedRateLimitResetNotBefore({
    receivedAtMilliseconds:
      input.receivedAtMilliseconds,
    resetUnixSeconds: input.resetUnixSeconds,
    responseDate: input.responseDate,
  });
  return {
    exceedsMaximum:
      notBefore - input.receivedAtMilliseconds >
        TRANSPORT_CONTRACT
          .maximumRateLimitPauseMilliseconds,
    notBefore: new Date(notBefore).toISOString(),
  };
}

export function assertC6SourceV3SimpleRateLimitConsistency(
  input: {
    headers: Readonly<Record<string, string>>;
    rateLimit: C6SourceV3SimpleRateLimit;
  },
): {
  date: string;
  limit: number;
  remaining: number;
  requestId: string;
  resetUnixSeconds: number;
  used: number;
} {
  const contentType = requiredHeader(
    input.headers,
    "content-type",
  ).toLowerCase();
  if (
    !/^application\/(?:json|[^;]+\+json)(?:;|$)/u.test(
      contentType,
    )
  ) {
    throw new Error(
      "C6 source-v3-simple success content-type mismatch",
    );
  }
  const date = requiredHeader(input.headers, "date");
  parseHttpDate(date);
  const requestId = requiredHeader(
    input.headers,
    "x-github-request-id",
  );
  const limit = integerHeader(
    input.headers,
    "x-ratelimit-limit",
  );
  const remaining = integerHeader(
    input.headers,
    "x-ratelimit-remaining",
  );
  const resetUnixSeconds = integerHeader(
    input.headers,
    "x-ratelimit-reset",
  );
  const used = integerHeader(
    input.headers,
    "x-ratelimit-used",
  );
  if (
    requiredHeader(
      input.headers,
      "x-ratelimit-resource",
    ) !== "graphql" ||
    input.rateLimit.limit !== limit ||
    input.rateLimit.remaining !== remaining ||
    input.rateLimit.used !== used ||
    Date.parse(input.rateLimit.resetAt) / 1_000 !==
      resetUnixSeconds ||
    remaining + used !== limit
  ) {
    throw new Error(
      "C6 source-v3-simple rate-limit mismatch",
    );
  }
  return {
    date,
    limit,
    remaining,
    requestId,
    resetUnixSeconds,
    used,
  };
}

function orderedVariables(
  input: RequestInput,
): Record<string, unknown> {
  if (input.operation === "repositoryCount") {
    const parsed = repositoryCountVariablesSchema.parse(
      input.variables,
    );
    return {
      query: parsed.query,
    };
  }
  if (input.operation === "repositoryPage") {
    const parsed = repositoryPageVariablesSchema.parse(
      input.variables,
    );
    return {
      query: parsed.query,
      after: parsed.after,
    };
  }
  const parsed = pullRequestPageVariablesSchema.parse(
    input.variables,
  );
  return {
    repositoryNodeId: parsed.repositoryNodeId,
    after: parsed.after,
  };
}

function requestInputFromPersisted(
  operationName: string,
  variables: Record<string, unknown>,
): RequestInput {
  if (
    operationName ===
      "C6SourceV3SimpleRepositoryCount"
  ) {
    return {
      operation: "repositoryCount",
      variables:
        repositoryCountVariablesSchema.parse(variables),
    };
  }
  if (
    operationName ===
      "C6SourceV3SimpleRepositoryPage"
  ) {
    return {
      operation: "repositoryPage",
      variables:
        repositoryPageVariablesSchema.parse(variables),
    };
  }
  if (
    operationName ===
      "C6SourceV3SimplePullRequestPage"
  ) {
    return {
      operation: "pullRequestPage",
      variables:
        pullRequestPageVariablesSchema.parse(variables),
    };
  }
  throw new Error(
    "C6 source-v3-simple durable request operation mismatch",
  );
}

function integerHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): number {
  const value = requiredHeader(headers, name);
  if (!/^(0|[1-9]\d*)$/u.test(value)) {
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

function requiredHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): string {
  const value = headers[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `C6 source-v3-simple missing ${name}`,
    );
  }
  return value;
}

function parseHttpDate(value: string): number {
  const milliseconds = Date.parse(value);
  if (
    !Number.isSafeInteger(milliseconds) ||
    new Date(milliseconds).toUTCString() !== value
  ) {
    throw new Error(
      "C6 source-v3-simple invalid Retry-After or response Date",
    );
  }
  return milliseconds;
}

function correctedRateLimitResetNotBefore(input: {
  receivedAtMilliseconds: number;
  resetUnixSeconds: number;
  responseDate: string;
}): number {
  assertTimestamp(
    input.receivedAtMilliseconds,
    "received timestamp",
  );
  if (
    !Number.isSafeInteger(input.resetUnixSeconds) ||
    input.resetUnixSeconds < 0
  ) {
    throw new Error(
      "C6 source-v3-simple rate-limit reset is invalid",
    );
  }
  const serverDateMilliseconds = parseHttpDate(
    input.responseDate,
  );
  return input.receivedAtMilliseconds +
    Math.max(
      0,
      input.resetUnixSeconds * 1_000 -
        serverDateMilliseconds,
    ) +
    TRANSPORT_CONTRACT.rateLimitPacing
      .resetSafetyMilliseconds;
}

function assertTimestamp(
  value: number,
  label: string,
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `C6 source-v3-simple invalid ${label}`,
    );
  }
}

function sha256(
  value: string | Uint8Array,
): string {
  return createHash("sha256").update(value).digest("hex");
}
