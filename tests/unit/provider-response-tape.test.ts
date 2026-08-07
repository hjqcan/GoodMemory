import { createHash } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
  createProviderResponseTapeProxy,
  fingerprintProviderRequest,
  fingerprintProviderRequestSequence,
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
