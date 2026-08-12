import { describe, expect, it } from "bun:test";
import type { GoodMemory } from "../../src";
import { createGoodMemory } from "../../src";
import { createFactMemory } from "../../src/domain/records";
import {
  createGoodMemoryHttpMemoryBridge,
  createLifeCoachHttpRememberConfig,
  toOneLifeMemoryContextResponse,
} from "../../src/http";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src/storage/memory";

const AUTH_HEADERS = {
  "x-goodmemory-user-id": "python-user",
  "x-goodmemory-workspace-id": "life-workspace",
  "x-goodmemory-operations": "recall-context,remember,feedback,export,forget,revise",
};

function scopedBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scope: {
      userId: "python-user",
      workspaceId: "life-workspace",
      agentId: "life-coach",
      sessionId: "session-1",
    },
    ...extra,
  };
}

async function runGoodMemoryHttpBridgeRequest(input: {
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  memory: GoodMemory;
  path: string;
}) {
  const bridge = createGoodMemoryHttpMemoryBridge({ memory: input.memory });
  const request = new Request(`http://localhost${input.path}`, {
    body: JSON.stringify(input.body),
    headers: {
      "content-type": "application/json",
      ...input.headers,
    },
    method: "POST",
  });

  return bridge.handle(request);
}

async function allocateBridgePort(): Promise<number> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    let server: Bun.Server<undefined> | undefined;
    try {
      server = Bun.serve({
        fetch: () => new Response("ok"),
        hostname: "127.0.0.1",
        port: 0,
      });
      if (server.port === undefined) {
        throw new Error("Bun did not report an allocated bridge test port.");
      }

      return server.port;
    } catch (error) {
      lastError = error;
      await Bun.sleep(20);
    } finally {
      server?.stop(true);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to allocate a bridge test server port.");
}

async function startBridgeTestServer(
  fetch: (request: Request) => Response | Promise<Response>,
): Promise<Bun.Server<undefined>> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return Bun.serve({
        fetch,
        hostname: "127.0.0.1",
        port: 0,
      });
    } catch (error) {
      lastError = error;
      await Bun.sleep(20);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to allocate a bridge test server port.");
}

async function waitForBridgeReady(input: {
  token: string;
  url: string;
}): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      // Liveness probe: GET /healthz needs no token, no scope headers, and
      // touches no memory — the shape Docker HEALTHCHECK and clients use.
      const response = await fetch(`${input.url}/healthz`, {
        method: "GET",
      });

      if (response.status === 200) {
        const body = (await response.json()) as { ok?: unknown };
        if (body.ok === true) {
          return;
        }
      }

      lastError = new Error(`Bridge returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }

    await Bun.sleep(50);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("GoodMemory HTTP bridge did not become ready.");
}

async function waitForBridgeReadyOrExit(input: {
  process: {
    exited: Promise<number>;
  };
  token: string;
  url: string;
}): Promise<void> {
  await Promise.race([
    waitForBridgeReady({ token: input.token, url: input.url }),
    input.process.exited.then((exitCode) => {
      throw new Error(
        `GoodMemory HTTP bridge exited before it became ready with code ${exitCode}.`,
      );
    }),
  ]);
}

async function startPackagedBridgeProcess(input: {
  args?: string[];
  env?: Record<string, string | undefined>;
  token: string;
}): Promise<{
  serverProcess: ReturnType<typeof Bun.spawn>;
  stderrPromise: Promise<string>;
  stdoutPromise: Promise<string>;
  url: string;
}> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const port = await allocateBridgePort();
    const url = `http://127.0.0.1:${port}`;
    const serverProcess = Bun.spawn({
      cmd: [
        "bun",
        "--env-file=/dev/null",
        "run",
        "scripts/goodmemory-http-bridge.ts",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        ...(input.args ?? []),
      ],
      env: {
        ...process.env,
        ...input.env,
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const stdoutPromise = new Response(serverProcess.stdout).text();
    const stderrPromise = new Response(serverProcess.stderr).text();

    try {
      await waitForBridgeReadyOrExit({
        process: serverProcess,
        token: input.token,
        url,
      });
      return {
        serverProcess,
        stderrPromise,
        stdoutPromise,
        url,
      };
    } catch (error) {
      lastError = error;
      try {
        serverProcess.kill("SIGTERM");
      } catch {
        // The process may already have exited before the retry cleanup runs.
      }
      await serverProcess.exited;
      await Promise.allSettled([stdoutPromise, stderrPromise]);
      await Bun.sleep(50);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("GoodMemory HTTP bridge did not start.");
}

// GET /healthz is the auth-free liveness endpoint: it answers before body
// parsing, caller resolution, or any memory access, so container health checks
// and client ready-probes need no token and touch no data.
describe("HTTP bridge healthz endpoint", () => {
  it("answers GET /healthz with the contract version and no auth", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const bridge = createGoodMemoryHttpMemoryBridge({ memory });

    const response = await bridge.handle(
      new Request("http://localhost/healthz", { method: "GET" }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      contractVersion: "phase-39.http-memory.v1",
      ok: true,
      status: "ok",
    });
  });

  it("echoes health metadata without letting it override reserved fields", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const bridge = createGoodMemoryHttpMemoryBridge({
      healthMetadata: {
        contractVersion: "spoofed",
        profile: "life-coach",
        status: "degraded",
      },
      memory,
    });

    const response = await bridge.handle(
      new Request("http://localhost/healthz", { method: "GET" }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      contractVersion: "phase-39.http-memory.v1",
      ok: true,
      profile: "life-coach",
      status: "ok",
    });
  });

  it("keeps POST /healthz and GET /memory/* behavior unchanged", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const bridge = createGoodMemoryHttpMemoryBridge({ memory });

    const postHealthz = await bridge.handle(
      new Request("http://localhost/healthz", { method: "POST" }),
    );
    expect(postHealthz.statusCode).toBe(404);

    const getMemory = await bridge.handle(
      new Request("http://localhost/memory/recall-context", { method: "GET" }),
    );
    expect(getMemory.statusCode).toBe(405);
  });

  it("performs no memory access", async () => {
    const throwingMemory = new Proxy(
      {},
      {
        get() {
          throw new Error("healthz must not touch memory");
        },
      },
    ) as GoodMemory;
    const bridge = createGoodMemoryHttpMemoryBridge({ memory: throwingMemory });

    const response = await bridge.handle(
      new Request("http://localhost/healthz", { method: "GET" }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ ok: true, status: "ok" });
  });
});

describe("Phase 39 Python HTTP memory bridge", () => {
  it("preserves fact occurrence in structured recall items", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
        vectorStore: createInMemoryVectorStore(),
      },
      storage: { provider: "memory" },
    });
    await documentStore.set(
      "facts",
      "http-dated-event",
      createFactMemory({
        agentId: "life-coach",
        category: "event",
        content: "I ate tomato and eggs.",
        createdAt: "2026-08-12T02:00:00.000Z",
        id: "http-dated-event",
        occurrence: {
          endExclusive: "2026-08-11T16:00:00.000Z",
          precision: "day",
          start: "2026-08-10T16:00:00.000Z",
          timezone: "Asia/Shanghai",
        },
        source: {
          extractedAt: "2026-08-12T02:00:00.000Z",
          method: "explicit",
        },
        updatedAt: "2026-08-12T02:00:00.000Z",
        userId: "python-user",
        workspaceId: "life-workspace",
      }),
    );

    const response = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody({
        query: "tomato and eggs",
        strategy: "rules-only",
      }),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/recall-context",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.items).toContainEqual(
      expect.objectContaining({
        memoryId: "http-dated-event",
        occurrence: {
          endExclusive: "2026-08-11T16:00:00.000Z",
          precision: "day",
          start: "2026-08-10T16:00:00.000Z",
          timezone: "Asia/Shanghai",
        },
        type: "fact",
      }),
    );
  });

  it("preserves message provenance and forwards recall temporal context", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const rememberInputs: Parameters<GoodMemory["remember"]>[0][] = [];
    const recallInputs: Parameters<GoodMemory["recall"]>[0][] = [];
    const enqueueInputs: Parameters<GoodMemory["jobs"]["enqueueRemember"]>[0][] = [];
    const remember = memory.remember.bind(memory);
    const recall = memory.recall.bind(memory);
    const enqueueRemember = memory.jobs.enqueueRemember.bind(memory.jobs);
    memory.remember = async (input) => {
      rememberInputs.push(input);
      return remember(input);
    };
    memory.recall = async (input) => {
      recallInputs.push(input);
      return recall(input);
    };
    memory.jobs.enqueueRemember = async (input) => {
      enqueueInputs.push(input);
      return enqueueRemember(input);
    };
    const temporalMessage = {
      id: "message-1",
      content: "Remember that the release review is tomorrow.",
      observedAt: "2026-11-01T05:29:00.000Z",
      role: "user",
      timezone: "Europe/Paris",
    };

    const sync = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody({
        messages: [temporalMessage],
        mode: "sync",
        timezone: "America/New_York",
      }),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/remember",
    });
    const asyncWrite = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody({
        idempotencyKey: "temporal-async-turn",
        messages: [temporalMessage],
        mode: "async",
        timezone: "America/New_York",
      }),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/remember",
    });
    const recalled = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody({
        query: "What happened yesterday?",
        referenceTime: "2026-11-01T05:30:00.000Z",
        timezone: "America/New_York",
      }),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/recall-context",
    });

    expect(sync.statusCode).toBe(200);
    expect(asyncWrite.statusCode).toBe(200);
    expect(recalled.statusCode).toBe(200);
    expect(rememberInputs[0]).toMatchObject({
      messages: [temporalMessage],
      timezone: "America/New_York",
    });
    expect(enqueueInputs[0]).toMatchObject({
      messages: [temporalMessage],
      timezone: "America/New_York",
    });
    expect(recallInputs[0]).toMatchObject({
      referenceTime: "2026-11-01T05:30:00.000Z",
      timezone: "America/New_York",
    });
  });

  it("rejects non-string temporal wire values instead of dropping them", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const cases = [
      {
        body: scopedBody({ query: "What happened?", referenceTime: 123 }),
        code: "invalid_temporal_context",
        path: "/memory/recall-context",
      },
      {
        body: scopedBody({ query: "What happened?", timezone: {} }),
        code: "invalid_temporal_context",
        path: "/memory/recall-context",
      },
      {
        body: scopedBody({
          messages: [{ role: "user", content: "Remember this.", observedAt: 123 }],
          mode: "sync",
        }),
        code: "invalid_messages",
        path: "/memory/remember",
      },
      {
        body: scopedBody({
          messages: [{ role: "user", content: "Remember this." }],
          mode: "sync",
          timezone: [],
        }),
        code: "invalid_temporal_context",
        path: "/memory/remember",
      },
      {
        body: scopedBody({
          idempotencyKey: "invalid-temporal-async",
          messages: [{ role: "user", content: "Remember this." }],
          mode: "async",
          timezone: 123,
        }),
        code: "invalid_temporal_context",
        path: "/memory/remember",
      },
    ] as const;

    for (const fixture of cases) {
      const response = await runGoodMemoryHttpBridgeRequest({
        body: fixture.body,
        headers: AUTH_HEADERS,
        memory,
        path: fixture.path,
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).toMatchObject({
        error: { code: fixture.code },
        ok: false,
      });
    }
  });

  it("rejects invalid temporal strings before sync execution or async enqueue", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    let enqueued = 0;
    const enqueueRemember = memory.jobs.enqueueRemember.bind(memory.jobs);
    memory.jobs.enqueueRemember = async (input) => {
      enqueued += 1;
      return enqueueRemember(input);
    };

    const cases = [
      {
        body: scopedBody({ query: "What happened?", referenceTime: "not-a-time" }),
        path: "/memory/recall-context",
      },
      {
        body: scopedBody({ query: "What happened?", timezone: "Mars/Olympus" }),
        path: "/memory/recall-context",
      },
      {
        body: scopedBody({
          messages: [
            {
              role: "user",
              content: "Remember this.",
              observedAt: "not-a-time",
            },
          ],
          mode: "sync",
        }),
        path: "/memory/remember",
      },
      {
        body: scopedBody({
          idempotencyKey: "invalid-observed-at-async",
          messages: [
            {
              role: "user",
              content: "Remember this.",
              observedAt: "not-a-time",
            },
          ],
          mode: "async",
        }),
        path: "/memory/remember",
      },
      {
        body: scopedBody({
          messages: [
            {
              role: "user",
              content: "Remember this.",
              timezone: "Mars/Olympus",
            },
          ],
          mode: "sync",
        }),
        path: "/memory/remember",
      },
    ] as const;

    for (const fixture of cases) {
      const response = await runGoodMemoryHttpBridgeRequest({
        body: fixture.body,
        headers: AUTH_HEADERS,
        memory,
        path: fixture.path,
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).toMatchObject({
        error: { code: "invalid_temporal_context" },
        ok: false,
      });
    }
    expect(enqueued).toBe(0);
  });

  it("validates scope, caller authorization, and targeted-only revise requests at the HTTP boundary", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });

    const malformed = await runGoodMemoryHttpBridgeRequest({
      body: {
        scope: { workspaceId: "life-workspace" },
        query: "What should I remember?",
      },
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/recall-context",
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).toMatchObject({
      error: {
        code: "invalid_scope",
      },
      ok: false,
    });

    const unauthorizedExport = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody(),
      headers: {
        "x-goodmemory-user-id": "python-user",
        "x-goodmemory-workspace-id": "life-workspace",
      },
      memory,
      path: "/memory/export",
    });
    expect(unauthorizedExport.statusCode).toBe(403);
    expect(unauthorizedExport.body).toMatchObject({
      error: {
        code: "operation_not_authorized",
      },
      ok: false,
    });

    await memory.remember({
      messages: [
        {
          content: "Remember that workspace-b private goal must stay scoped.",
          role: "user",
        },
      ],
      scope: {
        userId: "python-user",
        workspaceId: "workspace-b",
      },
    });
    const workspaceBExport = await memory.exportMemory({
      scope: {
        userId: "python-user",
        workspaceId: "workspace-b",
      },
    });
    const workspaceBMemoryId = workspaceBExport.durable.facts[0]?.id;
    expect(workspaceBMemoryId).toBeString();

    const broadenedExport = await runGoodMemoryHttpBridgeRequest({
      body: {
        scope: { userId: "python-user" },
      },
      headers: {
        "x-goodmemory-user-id": "python-user",
        "x-goodmemory-workspace-id": "workspace-a",
        "x-goodmemory-operations": "export",
      },
      memory,
      path: "/memory/export",
    });
    expect(broadenedExport.statusCode).toBe(403);
    expect(broadenedExport.body).toMatchObject({
      error: {
        code: "scope_not_authorized",
      },
      ok: false,
    });

    const broadenedForget = await runGoodMemoryHttpBridgeRequest({
      body: {
        memoryId: workspaceBMemoryId,
        scope: { userId: "python-user" },
      },
      headers: {
        "x-goodmemory-user-id": "python-user",
        "x-goodmemory-workspace-id": "workspace-a",
        "x-goodmemory-operations": "forget",
      },
      memory,
      path: "/memory/forget",
    });
    expect(broadenedForget.statusCode).toBe(403);
    expect(broadenedForget.body).toMatchObject({
      error: {
        code: "scope_not_authorized",
      },
      ok: false,
    });

    const malformedOptionalScope = await runGoodMemoryHttpBridgeRequest({
      body: {
        scope: {
          userId: "python-user",
          workspaceId: 123,
        },
      },
      headers: {
        "x-goodmemory-user-id": "python-user",
        "x-goodmemory-operations": "export",
      },
      memory,
      path: "/memory/export",
    });
    expect(malformedOptionalScope.statusCode).toBe(400);
    expect(malformedOptionalScope.body).toMatchObject({
      error: {
        code: "invalid_scope",
      },
      ok: false,
    });

    const malformedAnnotation = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody({
        annotations: [
          {
            messageIndex: "0",
            remember: "always",
          },
        ],
        messages: [
          {
            content: "Remember that malformed annotations should be rejected.",
            role: "user",
          },
        ],
        mode: "sync",
      }),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/remember",
    });
    expect(malformedAnnotation.statusCode).toBe(400);
    expect(malformedAnnotation.body).toMatchObject({
      error: {
        code: "invalid_annotations",
      },
      ok: false,
    });

    const queryResolvedRevise = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody({
        evidence: {
          message: "Actually, correct the sleep goal.",
          source: "user_message",
        },
        idempotencyKey: "revise-query-target",
        reason: "user_correction",
        revision: { content: "The visible goal is rebuilding my sleep routine." },
        target: { query: "sleep goal" },
      }),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/revise",
    });
    expect(queryResolvedRevise.statusCode).toBe(400);
    expect(queryResolvedRevise.body).toMatchObject({
      error: {
        code: "target_memory_id_required",
      },
      ok: false,
    });
  });

  it("serves prompt-ready recall context plus compact structured items for a OneLife-style backend", async () => {
    const memory = createGoodMemory({
      remember: createLifeCoachHttpRememberConfig(),
      storage: { provider: "memory" },
    });

    const remember = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody({
        idempotencyKey: "turn-1",
        messages: [
          {
            content:
              "My top priority this quarter is rebuilding my sleep routine.",
            role: "user",
          },
        ],
        annotations: [
          {
            confirmed: true,
            messageIndex: 0,
            metadataPatch: {
              category: "project",
              tags: ["coach"],
            },
            remember: "always",
          },
        ],
        mode: "sync",
      }),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/remember",
    });
    expect(remember.statusCode).toBe(200);
    expect(remember.body).toMatchObject({
      idempotency: {
        handledBy: "consumer_provenance_only",
        key: "turn-1",
      },
      mode: "sync",
      ok: true,
    });

    const recall = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody({
        query: "What is my quarterly priority?",
      }),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/recall-context",
    });

    expect(recall.statusCode).toBe(200);
    expect(recall.body).toMatchObject({
      hasContext: true,
      ok: true,
      operation: "recall-context",
    });
    expect(recall.body.contextText).toContain("rebuilding my sleep routine");
    expect(recall.body.itemCount).toBeGreaterThanOrEqual(1);
    expect(recall.body.items).toBeArray();
    const oneLife = toOneLifeMemoryContextResponse(recall.body);
    const recallItems = recall.body.items ?? [];

    expect(recallItems[0]).toMatchObject({
      memoryId: expect.any(String),
      source: "goodmemory",
      type: "fact",
    });
    expect(oneLife.context).toContain("rebuilding my sleep routine");
    expect(oneLife.memories[0]).toMatchObject({
      id: expect.any(String),
      source: "goodmemory-http-bridge",
    });
    expect(oneLife.metadata).toMatchObject({
      hasContext: true,
      itemCount: recall.body.itemCount,
      policyBoundary: "product_owned",
    });
  });

  it("routes async remember through memory.jobs without widening the root remember input", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });

    const asyncRemember = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody({
        idempotencyKey: "async-turn-1",
        messages: [
          {
            content:
              "Remember that the next coaching session should revisit the sleep experiment.",
            role: "user",
          },
        ],
        mode: "async",
      }),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/remember",
    });

    expect(asyncRemember.statusCode).toBe(200);
    expect(asyncRemember.body).toMatchObject({
      idempotency: {
        handledBy: "goodmemory_jobs",
        key: "async-turn-1",
      },
      mode: "async",
      ok: true,
    });
    expect(asyncRemember.body.job).toMatchObject({
      idempotencyKey: "async-turn-1",
      operation: "remember",
      status: "queued",
    });

    const drained = await memory.jobs.drain({ maxJobs: 1 });
    expect(drained.jobs[0]?.status).toBe("succeeded");
  });

  it("accepts explicit provider-backed recall strategy and exposes bridge routing diagnostics", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const query = "Which blocker should guide the provider rollout?";
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        embeddingAdapter: {
          async embed(texts: string[]) {
            return texts.map((text) =>
              text === query || text.includes("embedding bridge token")
                ? [1, 0, 0]
                : [0, 1, 0]
            );
          },
        },
        sessionStore,
        vectorStore,
      },
      storage: { provider: "memory" },
    });
    const scope = {
      agentId: "life-coach",
      userId: "python-user",
      workspaceId: "life-workspace",
    };
    const wrongFact = createFactMemory({
      id: "phase47-bridge-wrong",
      agentId: scope.agentId,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      category: "project",
      content: "Provider rollout blocker is vendor approval.",
      source: { method: "explicit", extractedAt: "2026-04-28T00:00:00.000Z" },
      createdAt: "2026-04-28T00:00:00.000Z",
      updatedAt: "2026-04-28T00:00:00.000Z",
    });
    const rightFact = createFactMemory({
      id: "phase47-bridge-right",
      agentId: scope.agentId,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      category: "project",
      content: "Provider rollout blocker is embedding bridge token validation.",
      source: { method: "explicit", extractedAt: "2026-04-28T00:00:00.000Z" },
      createdAt: "2026-04-28T00:00:00.000Z",
      updatedAt: "2026-04-28T00:00:00.000Z",
    });

    await documentStore.set("facts", wrongFact.id, wrongFact);
    await documentStore.set("facts", rightFact.id, rightFact);
    await vectorStore.upsert("facts", [
      {
        id: wrongFact.id,
        embedding: [0, 1, 0],
        metadata: scope,
        content: wrongFact.content,
      },
      {
        id: rightFact.id,
        embedding: [1, 0, 0],
        metadata: scope,
        content: rightFact.content,
      },
    ]);

    const recall = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody({
        query,
        strategy: "hybrid",
      }),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/recall-context",
    });

    expect(recall.statusCode).toBe(200);
    expect(recall.body).toMatchObject({
      hasContext: true,
      ok: true,
      operation: "recall-context",
      routing: {
        requestedStrategy: "hybrid",
        resolvedStrategy: "hybrid",
        semanticTieBreaking: true,
      },
    });
    expect(recall.body.contextText).toContain("embedding bridge token validation");
  });

  it("keeps provider-backed bridge fallback fail-visible when semantic search is unavailable", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });

    const recall = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody({
        query: "Which blocker should guide the provider rollout?",
        strategy: "hybrid",
      }),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/recall-context",
    });

    expect(recall.statusCode).toBe(200);
    expect(recall.body).toMatchObject({
      ok: true,
      routing: {
        fallbackReason: "semantic_search_unavailable",
        requestedStrategy: "hybrid",
        resolvedStrategy: "rules-only",
        semanticTieBreaking: false,
      },
    });
  });

  it("falls back to rules-only context when an enabled provider-backed bridge call fails", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        embeddingAdapter: {
          async embed() {
            throw new Error("fetch failed");
          },
        },
        sessionStore,
        vectorStore,
      },
      storage: { provider: "memory" },
    });

    await documentStore.set(
      "facts",
      "phase47-provider-failure-fallback",
      createFactMemory({
        id: "phase47-provider-failure-fallback",
        agentId: "life-coach",
        userId: "python-user",
        workspaceId: "life-workspace",
        category: "project",
        content: "Provider failure fallback blocker is rules-only recovery.",
        source: { method: "explicit", extractedAt: "2026-04-28T00:00:00.000Z" },
        createdAt: "2026-04-28T00:00:00.000Z",
        updatedAt: "2026-04-28T00:00:00.000Z",
      }),
    );

    const recall = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody({
        query: "Which provider failure fallback blocker is active?",
        strategy: "hybrid",
      }),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/recall-context",
    });

    expect(recall.statusCode).toBe(200);
    expect(recall.body).toMatchObject({
      hasContext: true,
      ok: true,
      routing: {
        fallbackReason: "provider_error",
        providerFallback: {
          reason: "provider_error",
          recoveredStrategy: "rules-only",
        },
        requestedStrategy: "hybrid",
        resolvedStrategy: "rules-only",
        semanticTieBreaking: false,
      },
    });
    expect(recall.body.contextText).toContain("rules-only recovery");
  });

  it("keeps auto and omitted bridge strategies on rules-only when no retrieval preset is active", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        embeddingAdapter: {
          async embed() {
            throw new Error("fetch failed");
          },
        },
        sessionStore,
        vectorStore,
      },
      storage: { provider: "memory" },
    });

    await documentStore.set(
      "facts",
      "phase47-auto-provider-failure-fallback",
      createFactMemory({
        id: "phase47-auto-provider-failure-fallback",
        agentId: "life-coach",
        userId: "python-user",
        workspaceId: "life-workspace",
        category: "project",
        content: "Provider failure fallback blocker is rules-only recovery.",
        source: { method: "explicit", extractedAt: "2026-04-28T00:00:00.000Z" },
        createdAt: "2026-04-28T00:00:00.000Z",
        updatedAt: "2026-04-28T00:00:00.000Z",
      }),
    );

    for (const strategy of [undefined, "auto"] as const) {
      const recall = await runGoodMemoryHttpBridgeRequest({
        body: scopedBody({
          query: "What should I do next about the provider failure fallback blocker?",
          ...(strategy ? { strategy } : {}),
        }),
        headers: AUTH_HEADERS,
        memory,
        path: "/memory/recall-context",
      });

      expect(recall.statusCode).toBe(200);
      // With no retrieval preset active, the bridge stays conservative: auto /
      // omitted strategies run the deterministic rules-only floor and never
      // engage the (failing) provider — so no provider fallback is reported.
      // (A preset-active bridge instead lets auto reach the router; covered in
      // the recommended-preset test.)
      expect(recall.body).toMatchObject({
        hasContext: true,
        ok: true,
        routing: {
          requestedStrategy: "auto",
          resolvedStrategy: "rules-only",
          semanticTieBreaking: false,
        },
      });
      expect(recall.body.routing?.fallbackReason).toBeUndefined();
      expect(recall.body.routing?.providerFallback).toBeUndefined();
      expect(recall.body.contextText).toContain("rules-only recovery");
    }
  });

  it("does not mask non-provider recall failures as provider-backed fallback", async () => {
    const realMemory = createGoodMemory({ storage: { provider: "memory" } });
    await realMemory.remember({
      messages: [
        {
          content: "Provider fallback masking should preserve real storage errors.",
          role: "user",
        },
      ],
      scope: {
        agentId: "life-coach",
        sessionId: "session-1",
        userId: "python-user",
        workspaceId: "life-workspace",
      },
    });
    const memory = {
      jobs: realMemory.jobs,
      runtime: realMemory.runtime,
      buildContext: realMemory.buildContext.bind(realMemory),
      recall: async (input) => {
        if (input.strategy === "hybrid") {
          throw new Error("embedding storage adapter invariant violated");
        }
        return await realMemory.recall(input);
      },
    } as GoodMemory;

    const recall = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody({
        query: "Which provider failure fallback blocker is active?",
        strategy: "hybrid",
      }),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/recall-context",
    });

    expect(recall.statusCode).toBe(500);
    expect(recall.body).toMatchObject({
      error: {
        code: "bridge_operation_failed",
      },
      ok: false,
    });
  });

  it("does not expose llm-assisted recall through the public HTTP bridge body", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });

    const recall = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody({
        query: "Which provider rollout blocker is active?",
        strategy: "llm-assisted",
      }),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/recall-context",
    });

    expect(recall.statusCode).toBe(400);
    expect(recall.body).toMatchObject({
      error: {
        code: "invalid_recall_strategy",
      },
      ok: false,
    });
  });

  it("keeps feedback procedural, export runtime off by default, forget scoped, and revise targeted by memoryId", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const seed = await memory.remember({
      messages: [
        {
          content: "Remember that I prefer weekly planning prompts.",
          role: "user",
        },
      ],
      scope: {
        userId: "python-user",
        workspaceId: "life-workspace",
        agentId: "life-coach",
        sessionId: "session-1",
      },
    });
    const targetMemoryId = seed.events.find(
      (event) => event.memoryType === "preference",
    )?.memoryId;
    expect(targetMemoryId).toBeString();

    const feedback = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody({
        idempotencyKey: "feedback-1",
        signal: "Use checklist summaries after coaching sessions.",
        source: {
          eventId: "coach-review-1",
          system: "onelife",
        },
      }),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/feedback",
    });
    expect(feedback.statusCode).toBe(200);
    expect(feedback.body).toMatchObject({
      idempotency: {
        handledBy: "consumer_provenance_only",
        key: "feedback-1",
      },
      ok: true,
      provenance: {
        eventId: "coach-review-1",
        system: "onelife",
      },
    });

    const exported = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody(),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/export",
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.body.includeRuntime).toBe(false);
    expect(exported.body.exported).toBeDefined();
    expect(exported.body.exported?.runtime).toBeUndefined();

    const revised = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody({
        evidence: {
          message: "Actually, weekly planning prompts should be short.",
          source: "user_message",
        },
        idempotencyKey: "revise-1",
        reason: "user_correction",
        revision: {
          content: "I prefer short weekly planning prompts.",
        },
        target: {
          memoryId: targetMemoryId,
        },
      }),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/revise",
    });
    expect(revised.statusCode).toBe(200);
    expect(revised.body).toMatchObject({
      idempotency: {
        handledBy: "goodmemory_revision",
        key: "revise-1",
      },
    });
    expect(revised.body.result).toMatchObject({
      accepted: true,
      outcome: "superseded",
      previousMemoryId: targetMemoryId,
    });
    const revisedResult = revised.body.result as { newMemoryId?: string };
    expect(revisedResult.newMemoryId).toBeString();

    const forgotten = await runGoodMemoryHttpBridgeRequest({
      body: scopedBody({ memoryId: revisedResult.newMemoryId }),
      headers: AUTH_HEADERS,
      memory,
      path: "/memory/forget",
    });
    expect(forgotten.statusCode).toBe(200);
    expect(forgotten.body.result).toMatchObject({
      forgotten: true,
    });
  });

  it("is consumable from a Python backend process over HTTP", async () => {
    const memory = createGoodMemory({
      remember: createLifeCoachHttpRememberConfig(),
      storage: { provider: "memory" },
    });
    const bridge = createGoodMemoryHttpMemoryBridge({ memory });
    const server = await startBridgeTestServer(bridge.fetch);

    try {
      const child = Bun.spawn({
        cmd: ["python3", "examples/python-fastapi-memory-consumer.py"],
        env: {
          ...process.env,
          GOODMEMORY_BRIDGE_URL: `http://127.0.0.1:${server.port}`,
        },
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      const payload = JSON.parse(stdout) as {
        feedbackAccepted: boolean;
        hasContext: boolean;
        itemCount: number;
        revised: boolean;
      };

      expect(payload.hasContext).toBe(true);
      expect(payload.itemCount).toBeGreaterThanOrEqual(1);
      expect(payload.feedbackAccepted).toBe(true);
      expect(payload.revised).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  it("passes the official Python client's stdlib unit suite", async () => {
    const child = Bun.spawn({
      cmd: [
        "python3",
        "-m",
        "unittest",
        "discover",
        "-s",
        "clients/python/tests",
        "-t",
        "clients/python",
      ],
      env: {
        ...process.env,
        PYTHONPATH: "clients/python",
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(exitCode).toBe(0);
    // unittest reports to stderr; "OK" is the pass marker.
    expect(stderr).toContain("OK");
    expect(stderr).not.toContain("FAILED");
  });

  it("drives the full endpoint surface through the official Python client", async () => {
    const memory = createGoodMemory({
      remember: createLifeCoachHttpRememberConfig(),
      storage: { provider: "memory" },
    });
    const bridge = createGoodMemoryHttpMemoryBridge({
      healthMetadata: { profile: "life-coach" },
      memory,
    });
    const server = await startBridgeTestServer(bridge.fetch);

    try {
      const child = Bun.spawn({
        cmd: ["python3", "clients/python/tests/live_smoke.py"],
        env: {
          ...process.env,
          GOODMEMORY_BRIDGE_URL: `http://127.0.0.1:${server.port}`,
          PYTHONPATH: "clients/python",
        },
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      const summary = JSON.parse(stdout) as {
        asyncHandledBy: string;
        contractVersion: string;
        feedbackAccepted: boolean;
        forgot: boolean;
        hasContext: boolean;
        healthOk: boolean;
        itemCount: number;
        rememberAccepted: number;
        requestedStrategy: string;
        revised: boolean;
      };

      expect(summary.healthOk).toBe(true);
      expect(summary.contractVersion).toBe("phase-39.http-memory.v1");
      expect(summary.rememberAccepted).toBeGreaterThanOrEqual(1);
      expect(summary.asyncHandledBy).toBe("goodmemory_jobs");
      expect(summary.hasContext).toBe(true);
      expect(summary.itemCount).toBeGreaterThanOrEqual(1);
      expect(summary.requestedStrategy).toBe("auto");
      expect(summary.feedbackAccepted).toBe(true);
      expect(summary.revised).toBe(true);
      expect(summary.forgot).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  it(
    "starts the packaged HTTP bridge entrypoint with bearer auth for a Python backend",
    async () => {
      const token = "phase-39-http-bridge-test-token";
      const { serverProcess, stderrPromise, stdoutPromise, url } =
        await startPackagedBridgeProcess({
          args: ["--profile", "life-coach", "--token", token],
          env: {
            GOODMEMORY_STORAGE_PROVIDER: "memory",
          },
          token,
        });

      try {
        // The packaged bin serves healthz auth-free and reports its profile.
        const healthz = await fetch(`${url}/healthz`, { method: "GET" });
        expect(healthz.status).toBe(200);
        expect(await healthz.json()).toMatchObject({
          contractVersion: "phase-39.http-memory.v1",
          ok: true,
          profile: "life-coach",
          status: "ok",
        });

        // The official client's bearer + header path against the real bin.
        const clientSmoke = Bun.spawn({
          cmd: ["python3", "clients/python/tests/live_smoke.py"],
          env: {
            ...process.env,
            GOODMEMORY_BRIDGE_TOKEN: token,
            GOODMEMORY_BRIDGE_URL: url,
            PYTHONPATH: "clients/python",
          },
          stderr: "pipe",
          stdout: "pipe",
        });
        const [clientStdout, clientStderr, clientExitCode] = await Promise.all([
          new Response(clientSmoke.stdout).text(),
          new Response(clientSmoke.stderr).text(),
          clientSmoke.exited,
        ]);
        expect(clientStderr).toBe("");
        expect(clientExitCode).toBe(0);
        expect(JSON.parse(clientStdout)).toMatchObject({
          contractVersion: "phase-39.http-memory.v1",
          healthOk: true,
        });

        const python = Bun.spawn({
          cmd: ["python3", "examples/python-fastapi-memory-consumer.py"],
          env: {
            ...process.env,
            GOODMEMORY_BRIDGE_TOKEN: token,
            GOODMEMORY_BRIDGE_URL: url,
          },
          stderr: "pipe",
          stdout: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(python.stdout).text(),
          new Response(python.stderr).text(),
          python.exited,
        ]);

        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        const payload = JSON.parse(stdout) as {
          feedbackAccepted: boolean;
          hasContext: boolean;
          itemCount: number;
          revised: boolean;
        };

        expect(payload.hasContext).toBe(true);
        expect(payload.itemCount).toBeGreaterThanOrEqual(1);
        expect(payload.feedbackAccepted).toBe(true);
        expect(payload.revised).toBe(true);
      } finally {
        serverProcess.kill("SIGTERM");
        await serverProcess.exited;
      }

      const [serverStdout, serverStderr] = await Promise.all([
        stdoutPromise,
        stderrPromise,
      ]);
      expect(serverStderr).toBe("");
      expect(serverStdout).toContain('"event":"ready"');
      expect(serverStdout).toContain('"auth":"bearer"');
    },
    15_000,
  );

  it(
    "accepts the VibeNest-compatible bridge auth env alias",
    async () => {
      const token = "phase-39-http-bridge-auth-alias-token";
      const { serverProcess, stderrPromise, stdoutPromise, url } =
        await startPackagedBridgeProcess({
          env: {
            GOODMEMORY_HTTP_BRIDGE_AUTH: token,
            GOODMEMORY_HTTP_BRIDGE_TOKEN: "stale-reserved-token-value",
            GOODMEMORY_STORAGE_PROVIDER: "memory",
          },
          token,
        });

      try {
        const health = await fetch(`${url}/healthz`, { method: "GET" });
        expect(health.status).toBe(200);
        expect(await health.json()).toMatchObject({
          authMode: "bearer",
          bridgeFeatures: "auth-env-alias,body-auth,body-caller",
        });

        const scope = {
          userId: "python-user",
          workspaceId: "life-workspace",
        };
        const response = await fetch(`${url}/memory/recall-context`, {
          body: JSON.stringify({
            bridgeAuth: `Bearer ${token}`,
            caller: {
              ...scope,
              authorizedOperations: ["recall-context"],
            },
            query: "today",
            scope,
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        });

        expect(response.status).toBe(200);
      } finally {
        serverProcess.kill("SIGTERM");
        await serverProcess.exited;
      }

      const [serverStdout, serverStderr] = await Promise.all([
        stdoutPromise,
        stderrPromise,
      ]);
      expect(serverStderr).toBe("");
      expect(serverStdout).toContain('"event":"ready"');
      expect(serverStdout).toContain('"auth":"bearer"');
    },
    15_000,
  );
});
