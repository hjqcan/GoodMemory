import { createHash } from "node:crypto";

export type ProviderTapeMode = "prefetch" | "replay";
export const PROVIDER_TAPE_TRANSPORT_ERROR_STATUS = 502;
const SAFE_TRANSPORT_ERROR_CODES = new Set([
  "ABORT_ERR",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "UNKNOWN_CERTIFICATE_VERIFICATION_ERROR",
]);
const SAFE_TRANSPORT_ERROR_NAMES = new Set([
  "AbortError",
  "Error",
  "TimeoutError",
  "TypeError",
]);

export interface ProviderResponseTapeEntry {
  fingerprint: string;
  occurrence: number;
  request: {
    canonicalBodySha256: string;
    method: string;
    path: string;
    semanticHeadersSha256: string;
    targetId: string;
  };
  response: {
    bodyBase64: string;
    bytes: number;
    contentType: string | null;
    sha256: string;
    status: number;
    statusText: string;
  };
}

export interface ProviderResponseTape {
  entries: ProviderResponseTapeEntry[];
  schemaVersion: 3;
}

export interface ProviderTapeRequestIdentity {
  canonicalBodySha256: string;
  fingerprint: string;
  method: string;
  path: string;
  semanticHeadersSha256: string;
  targetId: string;
}

export interface ProviderTapeSequenceMismatch {
  actual: ProviderTapeRequestIdentity;
  expected: ProviderTapeRequestIdentity | null;
  index: number;
}

export interface ProviderTapeSessionStats {
  coalesced: number;
  hits: number;
  liveRequests: number;
  misses: number;
  mode: ProviderTapeMode;
  name: string;
  non2xxResponses: number;
  requestFingerprintMultisetSha256: string;
  requestSequence: ProviderTapeRequestIdentity[];
  requestSequenceSha256: string;
  requests: number;
  sequenceMismatchDetails: ProviderTapeSequenceMismatch[];
  sequenceMismatches: number;
  targetCounts: Record<string, number>;
  tapeSha256: string;
  transportAttemptLedger: ProviderTapeTransportAttempt[];
  transportAttemptLedgerSha256: string;
  transportAttempts: number;
  transportErrors: number;
}

interface ProviderTapeTransportAttemptBase {
  fingerprint: string;
  requestIndex: number;
  targetId: string;
}

export type ProviderTapeTransportAttempt = ProviderTapeTransportAttemptBase & (
  | {
    errorCategory: "aborted" | "certificate" | "connection" | "timeout" | "transport";
    errorCode: string | null;
    errorMessageSha256: string;
    errorName: string;
    outcome: "error";
  }
  | {
    outcome: "response";
    responseStatus: number;
  }
);

interface ProviderTapeSessionConfig {
  expectedRequestSequence?: readonly ProviderTapeRequestIdentity[];
  liveOnMiss: boolean;
  mode: ProviderTapeMode;
  name: string;
}

interface ActiveProviderTapeSession extends ProviderTapeSessionConfig {
  coalesced: number;
  hits: number;
  liveRequests: number;
  misses: number;
  non2xxResponses: number;
  requestFingerprintCounts: Map<string, number>;
  replayEntries: Map<string, ProviderResponseTapeEntry[]>;
  replayOffsets: Map<string, number>;
  requestSequence: ProviderTapeRequestIdentity[];
  requests: number;
  sequenceMismatchDetails: ProviderTapeSequenceMismatch[];
  sequenceMismatches: number;
  targetCounts: Map<string, number>;
  transportAttemptLedger: ProviderTapeTransportAttempt[];
  transportErrors: number;
}

export interface ProviderResponseTapeProxy {
  baseUrl(targetId: string): string;
  beginSession(config: ProviderTapeSessionConfig): void;
  endSession(): ProviderTapeSessionStats;
  sessionStats(): ProviderTapeSessionStats;
  snapshot(): ProviderResponseTape;
  stop(): void;
  waitForIdle(): Promise<void>;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expected].sort());
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalizeJson(child)]),
  );
}

function canonicalRequestBody(body: string): string {
  if (body.trim().length === 0) {
    return "";
  }
  try {
    return JSON.stringify(canonicalizeJson(JSON.parse(body) as unknown));
  } catch {
    return body;
  }
}

const NON_SEMANTIC_HEADER_NAMES = new Set([
  "api-key",
  "authorization",
  "connection",
  "content-length",
  "host",
  "openai-api-key",
  "proxy-authorization",
  "proxy-connection",
  "traceparent",
  "tracestate",
  "transfer-encoding",
  "x-api-key",
  "x-request-id",
]);

function semanticHeadersSha256(headers?: HeadersInit): string {
  const entries = [...new Headers(headers).entries()]
    .filter(([name]) => !NON_SEMANTIC_HEADER_NAMES.has(name.toLowerCase()))
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return sha256(JSON.stringify(entries));
}

export function fingerprintProviderRequestIdentity(input: {
  canonicalBodySha256: string;
  method: string;
  path: string;
  semanticHeadersSha256: string;
  targetId: string;
}): string {
  return sha256(JSON.stringify({
    canonicalBodySha256: input.canonicalBodySha256,
    method: input.method.toUpperCase(),
    path: input.path,
    schemaVersion: 2,
    semanticHeadersSha256: input.semanticHeadersSha256,
    targetId: input.targetId,
  }));
}

function isProviderTapeRequestIdentity(
  value: ProviderTapeRequestIdentity,
): boolean {
  return /^[0-9a-f]{64}$/u.test(value.canonicalBodySha256) &&
    /^[0-9a-f]{64}$/u.test(value.fingerprint) &&
    value.method.length > 0 &&
    value.method === value.method.toUpperCase() &&
    value.path.length > 0 &&
    /^[0-9a-f]{64}$/u.test(value.semanticHeadersSha256) &&
    value.targetId.length > 0 &&
    fingerprintProviderRequestIdentity(value) === value.fingerprint;
}

export function fingerprintProviderRequestSequence(
  sequence: readonly ProviderTapeRequestIdentity[],
): string {
  if (sequence.some((identity) => !isProviderTapeRequestIdentity(identity))) {
    throw new Error("provider input sequence contains an invalid request identity");
  }
  return sha256(JSON.stringify(sequence));
}

export function fingerprintProviderTransportAttemptLedger(
  ledger: readonly ProviderTapeTransportAttempt[],
): string {
  for (const entry of ledger) {
    const keys = Object.keys(entry).sort();
    const expectedKeys = entry.outcome === "response"
      ? ["fingerprint", "outcome", "requestIndex", "responseStatus", "targetId"]
      : [
        "errorCategory",
        "errorCode",
        "errorMessageSha256",
        "errorName",
        "fingerprint",
        "outcome",
        "requestIndex",
        "targetId",
      ];
    if (
      JSON.stringify(keys) !== JSON.stringify(expectedKeys) ||
      (entry.outcome !== "error" && entry.outcome !== "response") ||
      !/^[0-9a-f]{64}$/u.test(entry.fingerprint) ||
      !Number.isSafeInteger(entry.requestIndex) ||
      entry.requestIndex < 0 ||
      entry.targetId.length === 0 ||
      (entry.outcome === "response"
        ? !Number.isSafeInteger(entry.responseStatus) ||
          entry.responseStatus < 200 ||
          entry.responseStatus > 599
        : !/^[0-9a-f]{64}$/u.test(entry.errorMessageSha256) ||
          ![
            "aborted",
            "certificate",
            "connection",
            "timeout",
            "transport",
          ].includes(entry.errorCategory) ||
          (entry.errorCode !== null &&
            !SAFE_TRANSPORT_ERROR_CODES.has(entry.errorCode)) ||
          !SAFE_TRANSPORT_ERROR_NAMES.has(entry.errorName))
    ) {
      throw new Error("provider transport attempt ledger is invalid");
    }
  }
  return sha256(JSON.stringify(ledger));
}

export function fingerprintProviderRequest(input: {
  body: string;
  headers?: HeadersInit;
  method: string;
  path: string;
  targetId: string;
}): string {
  return fingerprintProviderRequestIdentity({
    canonicalBodySha256: sha256(canonicalRequestBody(input.body)),
    method: input.method,
    path: input.path,
    semanticHeadersSha256: semanticHeadersSha256(input.headers),
    targetId: input.targetId,
  });
}

export function serializeProviderResponseTape(
  tape: ProviderResponseTape,
): string {
  const ordered: ProviderResponseTape = {
    entries: [...tape.entries].sort((left, right) =>
      left.fingerprint.localeCompare(right.fingerprint) ||
      left.occurrence - right.occurrence
    ),
    schemaVersion: 3,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function parseProviderResponseTape(raw: string): ProviderResponseTape {
  const parsed = JSON.parse(raw) as unknown;
  if (
    !hasExactKeys(parsed, ["entries", "schemaVersion"]) ||
    parsed.schemaVersion !== 3 ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error("provider response tape must use schemaVersion 3");
  }
  const nextOccurrence = new Map<string, number>();
  const entries = parsed.entries.map((value): ProviderResponseTapeEntry => {
    if (
      !hasExactKeys(value, ["fingerprint", "occurrence", "request", "response"])
    ) {
      throw new Error("provider response tape schema is invalid");
    }
    const entry = value as unknown as ProviderResponseTapeEntry;
    if (
      !hasExactKeys(entry.request, [
        "canonicalBodySha256",
        "method",
        "path",
        "semanticHeadersSha256",
        "targetId",
      ]) ||
      !hasExactKeys(entry.response, [
        "bodyBase64",
        "bytes",
        "contentType",
        "sha256",
        "status",
        "statusText",
      ])
    ) {
      throw new Error("provider response tape schema is invalid");
    }
    if (!/^[0-9a-f]{64}$/u.test(entry.fingerprint)) {
      throw new Error("provider response tape request fingerprint is invalid");
    }
    const expectedOccurrence = nextOccurrence.get(entry.fingerprint) ?? 0;
    if (entry.occurrence !== expectedOccurrence) {
      throw new Error("provider response tape occurrence sequence is invalid");
    }
    nextOccurrence.set(entry.fingerprint, expectedOccurrence + 1);
    if (
      !/^[0-9a-f]{64}$/u.test(entry.request?.canonicalBodySha256) ||
      typeof entry.request.method !== "string" ||
      entry.request.method !== entry.request.method.toUpperCase() ||
      typeof entry.request.path !== "string" ||
      entry.request.path.length === 0 ||
      !/^[0-9a-f]{64}$/u.test(entry.request.semanticHeadersSha256) ||
      typeof entry.request.targetId !== "string" ||
      entry.request.targetId.length === 0 ||
      fingerprintProviderRequestIdentity(entry.request) !== entry.fingerprint
    ) {
      throw new Error("provider response tape request fingerprint is invalid");
    }
    const responseBytes = Buffer.from(entry.response?.bodyBase64 ?? "", "base64");
    if (
      responseBytes.toString("base64") !== entry.response?.bodyBase64 ||
      responseBytes.byteLength !== entry.response?.bytes ||
      sha256(responseBytes) !== entry.response?.sha256 ||
      !Number.isSafeInteger(entry.response?.status) ||
      entry.response.status < 200 ||
      entry.response.status > 599 ||
      typeof entry.response.statusText !== "string" ||
      (entry.response.contentType !== null &&
        typeof entry.response.contentType !== "string")
    ) {
      throw new Error("provider response tape response fingerprint is invalid");
    }
    return entry;
  });
  const canonicalOrder = [...entries].sort((left, right) =>
    left.fingerprint.localeCompare(right.fingerprint) ||
    left.occurrence - right.occurrence
  );
  if (entries.some((entry, index) => entry !== canonicalOrder[index])) {
    throw new Error("provider response tape occurrence order is invalid");
  }
  return {
    entries,
    schemaVersion: 3,
  };
}

function responseEntriesForSequence(
  tape: ProviderResponseTape,
  sequence: readonly ProviderTapeRequestIdentity[],
): ProviderResponseTapeEntry[] {
  const entriesByFingerprint = new Map<string, ProviderResponseTapeEntry[]>();
  for (const entry of tape.entries) {
    const entries = entriesByFingerprint.get(entry.fingerprint) ?? [];
    entries.push(entry);
    entriesByFingerprint.set(entry.fingerprint, entries);
  }
  const offsets = new Map<string, number>();
  return sequence.map((identity) => {
    const occurrence = offsets.get(identity.fingerprint) ?? 0;
    offsets.set(identity.fingerprint, occurrence + 1);
    const entry = entriesByFingerprint.get(identity.fingerprint)?.[occurrence];
    if (
      entry === undefined ||
      entry.request.targetId !== identity.targetId
    ) {
      throw new Error("provider response tape does not cover request sequence");
    }
    return entry;
  });
}

export function assertProviderResponseFailuresRecovered(
  tape: ProviderResponseTape,
  sequence: readonly ProviderTapeRequestIdentity[],
): void {
  const entries = responseEntriesForSequence(tape, sequence);
  entries.forEach((entry, index) => {
    if (entry.response.status >= 200 && entry.response.status <= 299) {
      return;
    }
    if (sequence[index + 1]?.fingerprint !== sequence[index]!.fingerprint) {
      throw new Error(
        "provider failure was not recovered by an immediate same-request retry",
      );
    }
  });
}

export function assertProviderResponseTapeCoversSequences(
  tape: ProviderResponseTape,
  sequences: readonly (readonly ProviderTapeRequestIdentity[])[],
): void {
  const expectedCounts = new Map<string, number>();
  for (const sequence of sequences) {
    const counts = new Map<string, number>();
    for (const identity of sequence) {
      counts.set(identity.fingerprint, (counts.get(identity.fingerprint) ?? 0) + 1);
    }
    for (const [fingerprint, count] of counts) {
      expectedCounts.set(
        fingerprint,
        Math.max(expectedCounts.get(fingerprint) ?? 0, count),
      );
    }
  }
  const actualCounts = new Map<string, number>();
  for (const entry of tape.entries) {
    actualCounts.set(entry.fingerprint, (actualCounts.get(entry.fingerprint) ?? 0) + 1);
  }
  const canonical = (counts: Map<string, number>) => JSON.stringify(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
  if (canonical(actualCounts) !== canonical(expectedCounts)) {
    throw new Error(
      "provider response tape does not exactly cover discovery sequences",
    );
  }
  for (const sequence of sequences) {
    responseEntriesForSequence(tape, sequence);
  }
}

function responseFromTape(entry: ProviderResponseTapeEntry): Response {
  const headers = new Headers();
  if (entry.response.contentType !== null) {
    headers.set("content-type", entry.response.contentType);
  }
  return new Response(Buffer.from(entry.response.bodyBase64, "base64"), {
    headers,
    status: entry.response.status,
    statusText: entry.response.statusText,
  });
}

function forwardedHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  for (const name of [
    "connection",
    "content-length",
    "host",
    "proxy-authorization",
    "proxy-connection",
    "transfer-encoding",
  ]) {
    headers.delete(name);
  }
  return headers;
}

function rawTransportErrorCode(error: unknown): string | null {
  const values = [
    error instanceof Error ? (error as Error & { code?: unknown }).code : null,
    error instanceof Error && error.cause !== null &&
        typeof error.cause === "object" && "code" in error.cause
      ? error.cause.code
      : null,
  ];
  return values.find((value): value is string => typeof value === "string") ?? null;
}

function transportErrorCode(error: unknown): string | null {
  const code = rawTransportErrorCode(error);
  return code !== null && SAFE_TRANSPORT_ERROR_CODES.has(code) ? code : null;
}

function transportErrorAttempt(input: {
  error: unknown;
  fingerprint: string;
  requestIndex: number;
  targetId: string;
}): ProviderTapeTransportAttempt {
  const message = input.error instanceof Error
    ? input.error.message
    : String(input.error);
  const normalized = `${rawTransportErrorCode(input.error) ?? ""} ${message}`
    .toLowerCase();
  const errorCategory = normalized.includes("certificate") ||
      normalized.includes("tls_cert")
    ? "certificate"
    : normalized.includes("abort")
      ? "aborted"
      : normalized.includes("timeout") || normalized.includes("timed out")
        ? "timeout"
        : normalized.includes("connection") ||
            normalized.includes("econnreset") ||
            normalized.includes("socket")
          ? "connection"
          : "transport";
  return {
    errorCategory,
    errorCode: transportErrorCode(input.error),
    errorMessageSha256: sha256(message),
    errorName: input.error instanceof Error &&
        SAFE_TRANSPORT_ERROR_NAMES.has(input.error.name)
      ? input.error.name
      : "Error",
    fingerprint: input.fingerprint,
    outcome: "error",
    requestIndex: input.requestIndex,
    targetId: input.targetId,
  };
}

function transportFailureResponse(): Response {
  return Response.json({
    error: {
      code: "provider_transport_error",
      message: "upstream provider transport failed",
      type: "provider_transport_error",
    },
  }, { status: PROVIDER_TAPE_TRANSPORT_ERROR_STATUS });
}

export function createProviderResponseTapeProxy(input: {
  initialTape?: ProviderResponseTape;
  targets: Readonly<Record<string, string>>;
  upstreamFetch?: (
    request: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
}): ProviderResponseTapeProxy {
  const upstreamFetch = input.upstreamFetch ?? globalThis.fetch.bind(globalThis);
  const targets = new Map(
    Object.entries(input.targets).map(([targetId, upstreamBaseUrl]) => [
      targetId,
      upstreamBaseUrl.replace(/\/+$/u, ""),
    ]),
  );
  const entries = [...(input.initialTape?.entries ?? [])];
  const nextOccurrences = entries.reduce((counts, entry) => {
    counts.set(
      entry.fingerprint,
      Math.max(counts.get(entry.fingerprint) ?? 0, entry.occurrence + 1),
    );
    return counts;
  }, new Map<string, number>());
  const inFlight = new Map<string, Promise<ProviderResponseTapeEntry>>();
  let activeSession: ActiveProviderTapeSession | null = null;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const session = activeSession;
      if (session === null) {
        return Response.json(
          { error: "provider tape session is not active" },
          { status: 503 },
        );
      }
      const url = new URL(request.url);
      const [targetId, ...pathParts] = url.pathname.slice(1).split("/");
      const upstreamBaseUrl = targetId ? targets.get(targetId) : undefined;
      if (!targetId || upstreamBaseUrl === undefined || pathParts.length === 0) {
        return Response.json({ error: "unknown provider tape target" }, { status: 404 });
      }
      const path = `/${pathParts.join("/")}${url.search}`;
      const bodyBytes = new Uint8Array(await request.arrayBuffer());
      const body = new TextDecoder().decode(bodyBytes);
      const requestIdentity: ProviderTapeRequestIdentity = {
        canonicalBodySha256: sha256(canonicalRequestBody(body)),
        fingerprint: fingerprintProviderRequest({
          body,
          headers: request.headers,
          method: request.method,
          path,
          targetId,
        }),
        method: request.method.toUpperCase(),
        path,
        semanticHeadersSha256: semanticHeadersSha256(request.headers),
        targetId,
      };
      const { fingerprint } = requestIdentity;
      session.requests += 1;
      session.requestFingerprintCounts.set(
        fingerprint,
        (session.requestFingerprintCounts.get(fingerprint) ?? 0) + 1,
      );
      session.requestSequence.push(requestIdentity);
      session.targetCounts.set(
        targetId,
        (session.targetCounts.get(targetId) ?? 0) + 1,
      );

      const expected = session.expectedRequestSequence?.[
        session.requestSequence.length - 1
      ];
      if (
        session.expectedRequestSequence !== undefined &&
        expected?.fingerprint !== fingerprint
      ) {
        session.sequenceMismatches += 1;
        session.sequenceMismatchDetails.push({
          actual: { ...requestIdentity },
          expected: expected === undefined ? null : { ...expected },
          index: session.requestSequence.length - 1,
        });
        return Response.json(
          {
            actual: fingerprint,
            error: "provider input sequence mismatch",
            expected: expected?.fingerprint ?? null,
            index: session.requestSequence.length - 1,
          },
          { status: 409 },
        );
      }

      const replayEntries = session.replayEntries.get(fingerprint) ?? [];
      const replayOffset = session.replayOffsets.get(fingerprint) ?? 0;
      const recorded = replayEntries[replayOffset];
      if (recorded !== undefined) {
        session.replayOffsets.set(fingerprint, replayOffset + 1);
        session.hits += 1;
        return responseFromTape(recorded);
      }

      if (!session.liveOnMiss) {
        session.misses += 1;
        return Response.json(
          { error: "provider response tape miss", fingerprint },
          { status: 502 },
        );
      }
      const pending = inFlight.get(fingerprint);
      if (pending !== undefined) {
        session.coalesced += 1;
        try {
          return responseFromTape(await pending);
        } catch {
          return transportFailureResponse();
        }
      }

      session.misses += 1;
      session.liveRequests += 1;
      const requestIndex = session.requestSequence.length - 1;
      const liveRequest = (async (): Promise<ProviderResponseTapeEntry> => {
        let response: Response;
        let responseBody: Uint8Array;
        let transportFailed = false;
        try {
          response = await upstreamFetch(`${upstreamBaseUrl}${path}`, {
            body: request.method === "GET" || request.method === "HEAD"
              ? undefined
              : bodyBytes,
            headers: forwardedHeaders(request),
            method: request.method,
            redirect: "manual",
            signal: request.signal,
          });
          responseBody = new Uint8Array(await response.arrayBuffer());
          session.transportAttemptLedger.push({
            fingerprint,
            outcome: "response",
            requestIndex,
            responseStatus: response.status,
            targetId,
          });
        } catch (error) {
          transportFailed = true;
          session.transportErrors += 1;
          session.transportAttemptLedger.push(transportErrorAttempt({
            error,
            fingerprint,
            requestIndex,
            targetId,
          }));
          response = transportFailureResponse();
          responseBody = new Uint8Array(await response.arrayBuffer());
        }
        if (!response.ok && !transportFailed) {
          session.non2xxResponses += 1;
        }
        const entry: ProviderResponseTapeEntry = {
          fingerprint,
          occurrence: nextOccurrences.get(fingerprint) ?? 0,
          request: {
            canonicalBodySha256: sha256(canonicalRequestBody(body)),
            method: request.method.toUpperCase(),
            path,
            semanticHeadersSha256: semanticHeadersSha256(request.headers),
            targetId,
          },
          response: {
            bodyBase64: Buffer.from(responseBody).toString("base64"),
            bytes: responseBody.byteLength,
            contentType: response.headers.get("content-type"),
            sha256: sha256(responseBody),
            status: response.status,
            statusText: response.statusText,
          },
        };
        nextOccurrences.set(fingerprint, entry.occurrence + 1);
        entries.push(entry);
        return entry;
      })();
      inFlight.set(fingerprint, liveRequest);
      try {
        return responseFromTape(await liveRequest);
      } catch {
        return transportFailureResponse();
      } finally {
        inFlight.delete(fingerprint);
      }
    },
  });

  const snapshot = (): ProviderResponseTape => ({
    entries: [...entries].sort((left, right) =>
      left.fingerprint.localeCompare(right.fingerprint) ||
      left.occurrence - right.occurrence
    ),
    schemaVersion: 3,
  });

  const sessionStats = (): ProviderTapeSessionStats => {
    if (activeSession === null) {
      throw new Error("provider tape session is not active");
    }
    if (inFlight.size !== 0) {
      throw new Error("provider tape session still has live requests");
    }
    const transportAttemptLedger = activeSession.transportAttemptLedger
      .map((entry) => ({ ...entry }))
      .sort((left, right) => left.requestIndex - right.requestIndex);
    return {
      coalesced: activeSession.coalesced,
      hits: activeSession.hits,
      liveRequests: activeSession.liveRequests,
      misses: activeSession.misses,
      mode: activeSession.mode,
      name: activeSession.name,
      non2xxResponses: activeSession.non2xxResponses,
      requestFingerprintMultisetSha256: sha256(JSON.stringify(
        [...activeSession.requestFingerprintCounts.entries()].sort(
          ([left], [right]) => left.localeCompare(right),
        ),
      )),
      requestSequence: activeSession.requestSequence.map((identity) => ({
        ...identity,
      })),
      requestSequenceSha256: fingerprintProviderRequestSequence(
        activeSession.requestSequence,
      ),
      requests: activeSession.requests,
      sequenceMismatchDetails: activeSession.sequenceMismatchDetails.map(
        ({ actual, expected, index }) => ({
          actual: { ...actual },
          expected: expected === null ? null : { ...expected },
          index,
        }),
      ),
      sequenceMismatches: activeSession.sequenceMismatches,
      targetCounts: Object.fromEntries(
        [...activeSession.targetCounts.entries()].sort(
          ([left], [right]) => left.localeCompare(right),
        ),
      ),
      tapeSha256: sha256(serializeProviderResponseTape(snapshot())),
      transportAttemptLedger,
      transportAttemptLedgerSha256: fingerprintProviderTransportAttemptLedger(
        transportAttemptLedger,
      ),
      transportAttempts: transportAttemptLedger.length,
      transportErrors: activeSession.transportErrors,
    };
  };

  return {
    baseUrl(targetId) {
      if (!targets.has(targetId)) {
        throw new Error(`unknown provider tape target ${targetId}`);
      }
      return `http://${server.hostname}:${server.port}/${targetId}`;
    },
    beginSession(config) {
      if (activeSession !== null) {
        throw new Error("provider tape session is already active");
      }
      if (inFlight.size !== 0) {
        throw new Error("provider tape proxy still has live requests");
      }
      if (
        config.expectedRequestSequence !== undefined &&
        (config.mode !== "replay" || config.liveOnMiss)
      ) {
        throw new Error("expected provider inputs require offline replay mode");
      }
      const expectedRequestSequence = config.expectedRequestSequence?.map(
        (identity) => ({ ...identity }),
      );
      if (expectedRequestSequence !== undefined) {
        fingerprintProviderRequestSequence(expectedRequestSequence);
      }
      activeSession = {
        ...config,
        ...(expectedRequestSequence === undefined
          ? {}
          : { expectedRequestSequence }),
        coalesced: 0,
        hits: 0,
        liveRequests: 0,
        misses: 0,
        non2xxResponses: 0,
        requestFingerprintCounts: new Map(),
        replayEntries: entries.reduce((grouped, entry) => {
          const variants = grouped.get(entry.fingerprint) ?? [];
          variants.push(entry);
          grouped.set(entry.fingerprint, variants);
          return grouped;
        }, new Map<string, ProviderResponseTapeEntry[]>()),
        replayOffsets: new Map(),
        requestSequence: [],
        requests: 0,
        sequenceMismatchDetails: [],
        sequenceMismatches: 0,
        targetCounts: new Map(),
        transportAttemptLedger: [],
        transportErrors: 0,
      };
    },
    endSession() {
      const stats = sessionStats();
      activeSession = null;
      return stats;
    },
    sessionStats,
    snapshot,
    stop() {
      server.stop(true);
    },
    async waitForIdle() {
      while (inFlight.size !== 0) {
        await Promise.allSettled([...inFlight.values()]);
      }
    },
  };
}
