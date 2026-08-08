import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
  createProviderResponseTapeProxy,
  fingerprintProviderRequest,
  fingerprintProviderRequestSequence,
  fingerprintProviderTransportAttemptLedger,
  parseProviderResponseTape,
  serializeProviderResponseTape,
} from "../../scripts/provider-response-tape";

describe("provider response tape", () => {
  it("uses a canonical JSON request fingerprint without collapsing roles or paths", () => {
    const first = fingerprintProviderRequest({
      body: '{"model":"m","messages":[{"role":"user","content":"hi"}]}',
      method: "POST",
      path: "/chat/completions",
      targetId: "answer",
    });
    const reordered = fingerprintProviderRequest({
      body: '{"messages":[{"content":"hi","role":"user"}],"model":"m"}',
      method: "post",
      path: "/chat/completions",
      targetId: "answer",
    });

    expect(reordered).toBe(first);
    expect(fingerprintProviderRequest({
      body: '{"messages":[{"content":"hi","role":"user"}],"model":"m"}',
      method: "POST",
      path: "/chat/completions",
      targetId: "judge",
    })).not.toBe(first);
    expect(fingerprintProviderRequest({
      body: '{"messages":[{"content":"hi","role":"user"}],"model":"m"}',
      method: "POST",
      path: "/embeddings",
      targetId: "answer",
    })).not.toBe(first);
    expect(fingerprintProviderRequest({
      body: '{"messages":[{"content":"second","role":"user"},{"content":"hi","role":"user"}],"model":"m"}',
      method: "POST",
      path: "/chat/completions",
      targetId: "answer",
    })).not.toBe(fingerprintProviderRequest({
      body: '{"messages":[{"content":"hi","role":"user"},{"content":"second","role":"user"}],"model":"m"}',
      method: "POST",
      path: "/chat/completions",
      targetId: "answer",
    }));
    expect(fingerprintProviderRequest({
      body: "{}",
      headers: { authorization: "Bearer first", "openai-beta": "v1" },
      method: "POST",
      path: "/chat/completions",
      targetId: "answer",
    })).toBe(fingerprintProviderRequest({
      body: "{}",
      headers: { authorization: "Bearer second", "openai-beta": "v1" },
      method: "POST",
      path: "/chat/completions",
      targetId: "answer",
    }));
    expect(fingerprintProviderRequest({
      body: "{}",
      headers: { "openai-beta": "v2" },
      method: "POST",
      path: "/chat/completions",
      targetId: "answer",
    })).not.toBe(fingerprintProviderRequest({
      body: "{}",
      headers: { "openai-beta": "v1" },
      method: "POST",
      path: "/chat/completions",
      targetId: "answer",
    }));
  });

  it("records once and returns byte-identical responses for canonical hits", async () => {
    let upstreamRequests = 0;
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        upstreamRequests += 1;
        expect(request.headers.get("authorization")).toBe("Bearer secret");
        return new Response(
          'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n',
          {
            headers: { "content-type": "text/event-stream" },
            status: 200,
          },
        );
      },
    });
    const proxy = createProviderResponseTapeProxy({
      targets: {
        answer: `http://127.0.0.1:${upstream.port}/v1`,
      },
    });

    try {
      proxy.beginSession({ liveOnMiss: true, mode: "prefetch", name: "record" });
      const first = await fetch(`${proxy.baseUrl("answer")}/chat/completions`, {
        body: '{"model":"m","messages":[{"role":"user","content":"hi"}]}',
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        method: "POST",
      });
      const second = await fetch(`${proxy.baseUrl("answer")}/chat/completions`, {
        body: '{"messages":[{"content":"hi","role":"user"}],"model":"m"}',
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        method: "POST",
      });

      expect(await first.text()).toBe(await second.text());
      expect(upstreamRequests).toBe(1);
      expect(proxy.endSession()).toMatchObject({
        hits: 1,
        liveRequests: 1,
        misses: 1,
        requests: 2,
      });
      const raw = serializeProviderResponseTape(proxy.snapshot());
      expect(raw).not.toContain("secret");
      expect(parseProviderResponseTape(raw)).toEqual(proxy.snapshot());
      const tampered = JSON.parse(raw) as {
        entries: Array<{ request: { path: string } }>;
      };
      tampered.entries[0]!.request.path = "/tampered";
      expect(() => parseProviderResponseTape(JSON.stringify(tampered))).toThrow(
        "provider response tape request fingerprint is invalid",
      );
    } finally {
      proxy.stop();
      upstream.stop(true);
    }
  });

  it("fails closed on an unrecorded formal replay request", async () => {
    let upstreamRequests = 0;
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        upstreamRequests += 1;
        return new Response("should not run");
      },
    });
    const proxy = createProviderResponseTapeProxy({
      targets: {
        embedding: `http://127.0.0.1:${upstream.port}/v1`,
      },
    });

    try {
      proxy.beginSession({ liveOnMiss: false, mode: "replay", name: "formal" });
      const response = await fetch(`${proxy.baseUrl("embedding")}/embeddings`, {
        body: '{"input":["x"],"model":"e"}',
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      expect(response.status).toBe(502);
      expect(upstreamRequests).toBe(0);
      expect(proxy.sessionStats()).toMatchObject({
        hits: 0,
        liveRequests: 0,
        misses: 1,
        requests: 1,
      });
      expect(proxy.endSession()).toMatchObject({
        hits: 0,
        liveRequests: 0,
        misses: 1,
        requests: 1,
      });
    } finally {
      proxy.stop();
      upstream.stop(true);
    }
  });

  it("freezes provider inputs in order and rejects an out-of-order cached response", async () => {
    let upstreamRequests = 0;
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        upstreamRequests += 1;
        return new Response(await request.text());
      },
    });
    const discovery = createProviderResponseTapeProxy({
      targets: { eval: `http://127.0.0.1:${upstream.port}/v1` },
    });
    try {
      discovery.beginSession({
        liveOnMiss: true,
        mode: "prefetch",
        name: "discovery",
      });
      for (const content of ["first", "second"]) {
        const response = await fetch(
          `${discovery.baseUrl("eval")}/chat/completions`,
          {
            body: JSON.stringify({ content, model: "m" }),
            headers: { "content-type": "application/json" },
            method: "POST",
          },
        );
        expect(response.status).toBe(200);
      }
      const discovered = discovery.endSession();
      expect(discovered.requestSequence).toHaveLength(2);
      expect(discovered.requestSequenceSha256).toBe(
        fingerprintProviderRequestSequence(discovered.requestSequence),
      );
      expect(JSON.stringify(discovered.requestSequence)).not.toContain("first");

      const replay = createProviderResponseTapeProxy({
        initialTape: discovery.snapshot(),
        targets: { eval: `http://127.0.0.1:${upstream.port}/v1` },
      });
      try {
        replay.beginSession({
          expectedRequestSequence: discovered.requestSequence,
          liveOnMiss: false,
          mode: "replay",
          name: "formal",
        });
        const response = await fetch(
          `${replay.baseUrl("eval")}/chat/completions`,
          {
            body: JSON.stringify({ content: "second", model: "m" }),
            headers: { "content-type": "application/json" },
            method: "POST",
          },
        );

        expect(response.status).toBe(409);
        const replayStats = replay.endSession();
        expect(replayStats).toMatchObject({
          hits: 0,
          liveRequests: 0,
          misses: 0,
          requests: 1,
          sequenceMismatchDetails: [{
            actual: discovered.requestSequence[1],
            expected: discovered.requestSequence[0],
            index: 0,
          }],
          sequenceMismatches: 1,
        });
        expect(JSON.stringify(replayStats.sequenceMismatchDetails)).not.toContain(
          "second",
        );
        expect(upstreamRequests).toBe(2);
      } finally {
        replay.stop();
      }
    } finally {
      discovery.stop();
      upstream.stop(true);
    }
  });

  it("single-flights concurrent misses for the same fingerprint", async () => {
    let upstreamRequests = 0;
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async () => {
        upstreamRequests += 1;
        await Bun.sleep(10);
        return Response.json({ data: [{ embedding: [0.1, 0.2] }] });
      },
    });
    const proxy = createProviderResponseTapeProxy({
      targets: {
        embedding: `http://127.0.0.1:${upstream.port}/v1`,
      },
    });

    try {
      proxy.beginSession({ liveOnMiss: true, mode: "prefetch", name: "record" });
      const request = () => fetch(`${proxy.baseUrl("embedding")}/embeddings`, {
        body: '{"input":["x"],"model":"e"}',
        headers: { "content-type": "application/json" },
        method: "POST",
      }).then((response) => response.text());
      const [first, second] = await Promise.all([request(), request()]);

      expect(first).toBe(second);
      expect(upstreamRequests).toBe(1);
      expect(proxy.endSession()).toMatchObject({
        coalesced: 1,
        liveRequests: 1,
        misses: 1,
        requests: 2,
      });
    } finally {
      proxy.stop();
      upstream.stop(true);
    }
  });

  it("records thrown upstream transport errors without proxy retry or raw error text", async () => {
    const secretMarker = "transport-error-secret-marker";
    let upstreamAttempts = 0;
    const proxy = createProviderResponseTapeProxy({
      targets: { embedding: "https://embedding.example/v1" },
      upstreamFetch: async () => {
        upstreamAttempts += 1;
        if (upstreamAttempts === 1) {
          throw Object.assign(
            new TypeError(`unknown certificate verification error ${secretMarker}`),
            { cause: { code: "UNKNOWN_CERTIFICATE_VERIFICATION_ERROR" } },
          );
        }
        return Response.json({ data: [{ embedding: [0.1, 0.2] }] });
      },
    });

    try {
      proxy.beginSession({ liveOnMiss: true, mode: "prefetch", name: "record" });
      const response = await fetch(`${proxy.baseUrl("embedding")}/embeddings`, {
        body: '{"input":["x"],"model":"e"}',
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: {
          code: "provider_transport_error",
          message: "upstream provider transport failed",
          type: "provider_transport_error",
        },
      });
      expect(upstreamAttempts).toBe(1);

      const recovered = await fetch(
        `${proxy.baseUrl("embedding")}/embeddings`,
        {
          body: '{"input":["x"],"model":"e"}',
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      expect(recovered.status).toBe(200);
      expect(upstreamAttempts).toBe(2);

      const discovery = proxy.endSession();
      expect(discovery.requests).toBe(2);
      expect(discovery.transportAttempts).toBe(2);
      expect(discovery.transportErrors).toBe(1);
      expect(discovery.transportAttemptLedger).toEqual([
        expect.objectContaining({
          errorCategory: "certificate",
          errorCode: "UNKNOWN_CERTIFICATE_VERIFICATION_ERROR",
          errorName: "TypeError",
          outcome: "error",
          requestIndex: 0,
          targetId: "embedding",
        }),
        expect.objectContaining({
          outcome: "response",
          requestIndex: 1,
          responseStatus: 200,
          targetId: "embedding",
        }),
      ]);
      expect(discovery.transportAttemptLedgerSha256).toBe(
        fingerprintProviderTransportAttemptLedger(
          discovery.transportAttemptLedger,
        ),
      );
      expect(JSON.stringify(discovery.transportAttemptLedger)).not.toContain(
        secretMarker,
      );
    } finally {
      proxy.stop();
    }
  });

  it("treats response-body failures as transport errors and allowlists error identity", async () => {
    const secretCode = "TOKENABC123";
    const secretMessage = "response-body-secret-marker";
    const secretName = "TransportSecretName";
    let upstreamAttempts = 0;
    const proxy = createProviderResponseTapeProxy({
      targets: { eval: "https://eval.example/v1" },
      upstreamFetch: async () => {
        upstreamAttempts += 1;
        if (upstreamAttempts === 1) {
          const failure = Object.assign(
            new TypeError(`socket closed ${secretMessage}`),
            { cause: { code: secretCode } },
          );
          failure.name = secretName;
          const response = new Response("unreadable", { status: 200 });
          Object.defineProperty(response, "arrayBuffer", {
            value: async () => {
              throw failure;
            },
          });
          return response;
        }
        return Response.json({ choices: [] });
      },
    });

    try {
      proxy.beginSession({ liveOnMiss: true, mode: "prefetch", name: "record" });
      const first = await fetch(`${proxy.baseUrl("eval")}/chat/completions`, {
        body: '{"model":"m"}',
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(first.status).toBe(502);

      const second = await fetch(`${proxy.baseUrl("eval")}/chat/completions`, {
        body: '{"model":"m"}',
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(second.status).toBe(200);
      expect(upstreamAttempts).toBe(2);

      const discovery = proxy.endSession();
      expect(discovery.transportErrors).toBe(1);
      expect(discovery.transportAttemptLedger).toEqual([
        expect.objectContaining({
          errorCategory: "connection",
          errorCode: null,
          errorName: "Error",
          outcome: "error",
          requestIndex: 0,
        }),
        expect.objectContaining({
          outcome: "response",
          requestIndex: 1,
          responseStatus: 200,
        }),
      ]);
      const ledgerRaw = JSON.stringify(discovery.transportAttemptLedger);
      expect(ledgerRaw).not.toContain(secretCode);
      expect(ledgerRaw).not.toContain(secretMessage);
      expect(ledgerRaw).not.toContain(secretName);
    } finally {
      proxy.stop();
    }
  });

  it("does not close a session while a live request can cross its boundary", async () => {
    let releaseUpstream: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseUpstream = resolve;
    });
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async () => {
        markStarted!();
        await released;
        return Response.json({ ok: true });
      },
    });
    const proxy = createProviderResponseTapeProxy({
      targets: { eval: `http://127.0.0.1:${upstream.port}/v1` },
    });
    try {
      proxy.beginSession({ liveOnMiss: true, mode: "prefetch", name: "record" });
      const pending = fetch(`${proxy.baseUrl("eval")}/chat/completions`, {
        body: '{"model":"m"}',
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      await started;

      expect(() => proxy.endSession()).toThrow(
        "provider tape session still has live requests",
      );
      releaseUpstream!();
      expect((await pending).status).toBe(200);
      expect(proxy.endSession()).toMatchObject({ liveRequests: 1, misses: 1 });
    } finally {
      proxy.stop();
      upstream.stop(true);
    }
  });

  it("rejects corrupt bytes and duplicate fingerprints instead of accepting last-write-wins evidence", () => {
    const body = "{}";
    const fingerprint = fingerprintProviderRequest({
      body,
      method: "POST",
      path: "/chat/completions",
      targetId: "answer",
    });
    const entry = {
      fingerprint,
      request: {
        canonicalBodySha256: createHash("sha256").update(body).digest("hex"),
        method: "POST",
        path: "/chat/completions",
        semanticHeadersSha256: createHash("sha256")
          .update(JSON.stringify([]))
          .digest("hex"),
        targetId: "answer",
      },
      response: {
        bodyBase64: Buffer.from("ok").toString("base64"),
        bytes: 2,
        contentType: "text/plain",
        sha256: "2689367b205c16ce32ed4200942b8b8b1e262dfc70d9bc9fbc77c49699a4f1df",
        status: 200,
        statusText: "OK",
      },
    };

    expect(() => parseProviderResponseTape(JSON.stringify({
      entries: [entry, { ...entry, response: { ...entry.response, status: 201 } }],
      schemaVersion: 2,
    }))).toThrow("duplicate provider response tape fingerprint");
    expect(() => parseProviderResponseTape(JSON.stringify({
      entries: [{
        ...entry,
        response: { ...entry.response, bodyBase64: Buffer.from("no").toString("base64") },
      }],
      schemaVersion: 2,
    }))).toThrow("provider response tape response fingerprint is invalid");

    const invalidLedger = [{
      errorCategory: "transport",
      errorCode: null,
      errorMessageSha256: "a".repeat(64),
      errorName: "Error",
      fingerprint,
      outcome: "unknown",
      requestIndex: 0,
      targetId: "answer",
    }] as unknown as Parameters<
      typeof fingerprintProviderTransportAttemptLedger
    >[0];
    expect(() => fingerprintProviderTransportAttemptLedger(invalidLedger))
      .toThrow("provider transport attempt ledger is invalid");
  });

  it("does not freeze transient non-2xx responses", async () => {
    let upstreamRequests = 0;
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        upstreamRequests += 1;
        return Response.json({ error: "temporary" }, { status: 503 });
      },
    });
    const proxy = createProviderResponseTapeProxy({
      targets: { eval: `http://127.0.0.1:${upstream.port}/v1` },
    });
    try {
      proxy.beginSession({ liveOnMiss: true, mode: "prefetch", name: "errors" });
      const request = () => fetch(`${proxy.baseUrl("eval")}/chat/completions`, {
        body: '{"model":"m"}',
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect((await request()).status).toBe(503);
      expect((await request()).status).toBe(503);
      expect(upstreamRequests).toBe(2);
      expect(proxy.snapshot().entries).toEqual([]);
      expect(proxy.endSession()).toMatchObject({
        liveRequests: 2,
        misses: 2,
        non2xxResponses: 2,
        transportAttempts: 2,
        transportErrors: 0,
      });
    } finally {
      proxy.stop();
      upstream.stop(true);
    }
  });

  it("does not follow an upstream redirect or attribute another origin to the target", async () => {
    let redirectedRequests = 0;
    const redirected = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        redirectedRequests += 1;
        return Response.json({ wrongOrigin: true });
      },
    });
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(null, {
        headers: {
          location: `http://127.0.0.1:${redirected.port}/elsewhere`,
        },
        status: 307,
      }),
    });
    const proxy = createProviderResponseTapeProxy({
      targets: { eval: `http://127.0.0.1:${upstream.port}/v1` },
    });
    try {
      proxy.beginSession({ liveOnMiss: true, mode: "prefetch", name: "redirect" });
      const response = await fetch(`${proxy.baseUrl("eval")}/chat/completions`, {
        body: '{"model":"m"}',
        headers: { authorization: "Bearer secret" },
        method: "POST",
      });
      expect(response.status).toBe(307);
      expect(redirectedRequests).toBe(0);
      expect(proxy.snapshot().entries).toEqual([]);
      proxy.endSession();
    } finally {
      proxy.stop();
      upstream.stop(true);
      redirected.stop(true);
    }
  });
});
