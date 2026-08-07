import { createHash } from "node:crypto";

export type ProviderTapeMode = "prefetch" | "replay";

export interface ProviderResponseTapeEntry {
  fingerprint: string;
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
  schemaVersion: 2;
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
}

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
  requestSequence: ProviderTapeRequestIdentity[];
  requests: number;
  sequenceMismatchDetails: ProviderTapeSequenceMismatch[];
  sequenceMismatches: number;
  targetCounts: Map<string, number>;
}

export interface ProviderResponseTapeProxy {
  baseUrl(targetId: string): string;
  beginSession(config: ProviderTapeSessionConfig): void;
  endSession(): ProviderTapeSessionStats;
  sessionStats(): ProviderTapeSessionStats;
  snapshot(): ProviderResponseTape;
  stop(): void;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
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
  const sorted: ProviderResponseTape = {
    entries: [...tape.entries].sort((left, right) =>
      left.fingerprint.localeCompare(right.fingerprint)
    ),
    schemaVersion: 2,
  };
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

export function parseProviderResponseTape(raw: string): ProviderResponseTape {
  const parsed = JSON.parse(raw) as unknown;
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("schemaVersion" in parsed) ||
    parsed.schemaVersion !== 2 ||
    !("entries" in parsed) ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error("provider response tape must use schemaVersion 2");
  }
  const fingerprints = new Set<string>();
  const entries = parsed.entries.map((value): ProviderResponseTapeEntry => {
    const entry = value as ProviderResponseTapeEntry;
    if (!/^[0-9a-f]{64}$/u.test(entry.fingerprint)) {
      throw new Error("provider response tape request fingerprint is invalid");
    }
    if (fingerprints.has(entry.fingerprint)) {
      throw new Error("duplicate provider response tape fingerprint");
    }
    fingerprints.add(entry.fingerprint);
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
      entry.response.status > 299 ||
      typeof entry.response.statusText !== "string" ||
      (entry.response.contentType !== null &&
        typeof entry.response.contentType !== "string")
    ) {
      throw new Error("provider response tape response fingerprint is invalid");
    }
    return entry;
  });
  return {
    entries: entries.sort((left, right) =>
      left.fingerprint.localeCompare(right.fingerprint)
    ),
    schemaVersion: 2,
  };
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

export function createProviderResponseTapeProxy(input: {
  initialTape?: ProviderResponseTape;
  targets: Readonly<Record<string, string>>;
}): ProviderResponseTapeProxy {
  const targets = new Map(
    Object.entries(input.targets).map(([targetId, upstreamBaseUrl]) => [
      targetId,
      upstreamBaseUrl.replace(/\/+$/u, ""),
    ]),
  );
  const entries = new Map(
    (input.initialTape?.entries ?? []).map((entry) => [entry.fingerprint, entry]),
  );
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

      const recorded = entries.get(fingerprint);
      if (recorded !== undefined) {
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
        return responseFromTape(await pending);
      }

      session.misses += 1;
      session.liveRequests += 1;
      const liveRequest = (async (): Promise<ProviderResponseTapeEntry> => {
        const response = await fetch(`${upstreamBaseUrl}${path}`, {
          body: request.method === "GET" || request.method === "HEAD"
            ? undefined
            : bodyBytes,
          headers: forwardedHeaders(request),
          method: request.method,
          redirect: "manual",
          signal: request.signal,
        });
        const responseBody = new Uint8Array(await response.arrayBuffer());
        if (!response.ok) {
          session.non2xxResponses += 1;
        }
        const entry: ProviderResponseTapeEntry = {
          fingerprint,
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
        if (response.ok) {
          entries.set(fingerprint, entry);
        }
        return entry;
      })();
      inFlight.set(fingerprint, liveRequest);
      try {
        return responseFromTape(await liveRequest);
      } finally {
        inFlight.delete(fingerprint);
      }
    },
  });

  const snapshot = (): ProviderResponseTape => ({
    entries: [...entries.values()].sort((left, right) =>
      left.fingerprint.localeCompare(right.fingerprint)
    ),
    schemaVersion: 2,
  });

  const sessionStats = (): ProviderTapeSessionStats => {
    if (activeSession === null) {
      throw new Error("provider tape session is not active");
    }
    if (inFlight.size !== 0) {
      throw new Error("provider tape session still has live requests");
    }
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
        requestSequence: [],
        requests: 0,
        sequenceMismatchDetails: [],
        sequenceMismatches: 0,
        targetCounts: new Map(),
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
  };
}
