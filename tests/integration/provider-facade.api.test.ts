import { afterEach, describe, expect, it } from "bun:test";
import {
  createGoodMemory,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src";
import { createFactMemory } from "../../src/domain/records";

const providerEnvKeys = [
  "GOODMEMORY_EMBEDDING_PROVIDER",
  "GOODMEMORY_EMBEDDING_MODEL",
  "GOODMEMORY_EMBEDDING_API_KEY",
  "GOODMEMORY_EMBEDDING_BASE_URL",
  "GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER",
  "GOODMEMORY_ASSISTED_EXTRACTOR_MODEL",
  "GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY",
  "GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL",
] as const;

const originalEnv = Object.fromEntries(
  providerEnvKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof providerEnvKeys)[number], string | undefined>;
const originalFetch = globalThis.fetch;

function restoreProviderEnv(): void {
  for (const key of providerEnvKeys) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("public provider facade", () => {
  afterEach(() => {
    restoreProviderEnv();
    globalThis.fetch = originalFetch;
  });

  it("maps providers.embedding and providers.extraction onto existing adapters", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const requests: string[] = [];

    for (const key of providerEnvKeys) {
      delete process.env[key];
    }

    globalThis.fetch = (async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      requests.push(url);

      if (url.includes("/embeddings")) {
        const payload = init?.body
          ? JSON.parse(String(init.body)) as { input?: string | string[] }
          : {};
        const values = Array.isArray(payload.input)
          ? payload.input
          : payload.input
            ? [payload.input]
            : [];

        return new Response(
          JSON.stringify({
            object: "list",
            data: values.map((value, index) => ({
              object: "embedding",
              index,
              embedding: String(value).includes("staging smoke")
                ? [1, 0, 0]
                : [0, 0, 1],
            })),
            model: "text-embedding-3-small",
            usage: {
              prompt_tokens: values.length,
              total_tokens: values.length,
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          id: "chatcmpl-provider-facade",
          object: "chat.completion",
          model: "gpt-4o-mini",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({
                  candidates: [
                    {
                      id: "provider-fact-1",
                      kindHint: "fact",
                      explicitness: "explicit",
                      content:
                        "The migration rollout is blocked on staging smoke verification.",
                      sourceMessageIndex: 0,
                      sourceRole: "user",
                      metadata: {
                        category: "project",
                        factKind: "blocker",
                        scopeKind: "project",
                      },
                    },
                  ],
                  ignoredMessageCount: 0,
                }),
              },
              finish_reason: "stop",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      providers: {
        embedding: {
          provider: "openai",
          model: "text-embedding-3-small",
          apiKey: "embedding-key",
          baseURL: "https://embedding-provider.test/v1",
        },
        extraction: {
          provider: "openai",
          model: "gpt-4o-mini",
          apiKey: "extractor-key",
          baseURL: "https://extractor-provider.test/v1",
        },
      },
      adapters: {
        documentStore,
        sessionStore,
        vectorStore,
      },
    });
    const scope = {
      userId: "provider-facade-user",
      workspaceId: "provider-facade-workspace",
      sessionId: "provider-facade-session",
    };

    const remembered = await memory.remember({
      scope,
      extractionStrategy: "llm-assisted",
      messages: [
        {
          role: "user",
          content:
            "Remember that the migration rollout is blocked on staging smoke verification.",
        },
      ],
    });

    const [writtenFact] = await documentStore.query<{ id: string }>("facts", {
      userId: scope.userId,
    });

    expect(remembered.accepted).toBeGreaterThan(0);
    expect(remembered.metadata?.resolvedExtractionStrategy).toBe("llm-assisted");
    expect(requests.some((url) => url.includes("/chat/completions"))).toBe(true);
    expect(requests.some((url) => url.includes("/embeddings"))).toBe(true);
    expect(writtenFact?.id).toBeString();
    expect(await vectorStore.get("facts", writtenFact!.id)).toEqual(
      expect.objectContaining({
        embedding: [1, 0, 0],
      }),
    );
  });

  it("maps providers.reranking to independent pointwise calls and auditable trace", async () => {
    const documentStore = createInMemoryDocumentStore();
    const prompts: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: string; role: string }>;
      };
      const prompt = request.messages.at(-1)?.content ?? "";
      prompts.push(prompt);
      return new Response(
        JSON.stringify({
          id: "chatcmpl-reranker",
          object: "chat.completion",
          model: "gpt-5.6-terra",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({
                  score: prompt.includes("legal approval") ? 0.95 : 0.1,
                }),
              },
              finish_reason: "stop",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      providers: {
        reranking: {
          provider: "openai",
          model: "gpt-5.6-terra",
          apiKey: "must-not-appear-in-trace",
          baseURL: "https://ai.gurkiai.com/v1",
        },
      },
      adapters: { documentStore },
    });
    const scope = {
      userId: "reranker-user",
      workspaceId: "reranker-workspace",
    };
    for (const fact of [
      createFactMemory({
        id: "fact-routine",
        ...scope,
        category: "project",
        content: "The migration review follows the normal weekly routine.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      createFactMemory({
        id: "fact-blocker",
        ...scope,
        category: "project",
        content: "The migration is blocked on legal approval.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ]) {
      await documentStore.set("facts", fact.id, fact);
    }

    const result = await memory.recall({
      scope,
      query: "What blocks the migration review?",
      strategy: "rules-only",
    });

    expect(result.facts[0]?.id).toBe("fact-blocker");
    expect(prompts).toHaveLength(2);
    expect(prompts.every((prompt) =>
      !(prompt.includes("weekly routine") && prompt.includes("legal approval")),
    )).toBe(true);
    expect(result.metadata.retrievalTrace?.reranker).toMatchObject({
      adapter: "provider",
      gateway: "https://ai.gurkiai.com/v1",
      model: "gpt-5.6-terra",
      provider: "openai",
      role: "reranker",
      status: "applied",
    });
    expect(JSON.stringify(result.metadata.retrievalTrace)).not.toContain(
      "must-not-appear-in-trace",
    );
  });

  it("uses one bounded listwise call for recommended retrieval and keeps packet output narrow", async () => {
    const documentStore = createInMemoryDocumentStore();
    const prompts: string[] = [];
    let orderedCandidateIds: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: string; role: string }>;
      };
      const prompt = request.messages.at(-1)?.content ?? "";
      prompts.push(prompt);
      orderedCandidateIds = [
        ...prompt.matchAll(/\{"id":"([^"]+)"/gu),
      ].map((match) => match[1]!).reverse();
      return new Response(
        JSON.stringify({
          id: "chatcmpl-listwise-reranker",
          object: "chat.completion",
          model: "gpt-5.6-terra",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({ orderedCandidateIds }),
              },
              finish_reason: "stop",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      retrieval: { preset: "recommended" },
      providers: {
        reranking: {
          provider: "openai",
          model: "gpt-5.6-terra",
          apiKey: "must-not-appear-in-trace",
          baseURL: "https://ai.gurkiai.com/v1",
        },
      },
      adapters: { documentStore },
    });
    const scope = {
      userId: "listwise-reranker-user",
      workspaceId: "listwise-reranker-workspace",
    };
    for (let index = 0; index < 24; index += 1) {
      const id = `fact-migration-${String(index).padStart(2, "0")}`;
      await documentStore.set(
        "facts",
        id,
        createFactMemory({
          id,
          ...scope,
          category: "project",
          content: `Migration evidence item ${index} documents the approval state.`,
          source: {
            method: "explicit",
            extractedAt: "2026-01-01T00:00:00.000Z",
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      );
    }

    const result = await memory.recall({
      scope,
      query: "What migration evidence documents the approval state?",
    });

    expect(prompts).toHaveLength(1);
    expect(orderedCandidateIds).toHaveLength(24);
    expect(orderedCandidateIds.length).toBeLessThanOrEqual(32);
    expect(orderedCandidateIds[0]).toBe("candidate-24");
    expect(prompts[0]).not.toContain('"id":"fact-migration-');
    expect(result.facts).toHaveLength(12);
    expect(result.facts[0]?.id).toBe("fact-migration-23");
    expect(result.packet.factSummary?.match(/^- /gmu)).toHaveLength(6);
    expect(result.metadata.retrievalTrace?.reranker).toMatchObject({
      adapter: "provider",
      candidateCount: 24,
      status: "applied",
      strategy: "listwise",
    });
    expect(result.metadata.retrievalTrace?.fusionRuns?.[0]?.budget).toBe(24);

    const disabled = await memory.recall({
      scope,
      query: "What migration evidence documents the approval state?",
      rerank: false,
    });
    expect(prompts).toHaveLength(1);
    expect(disabled.metadata.retrievalTrace?.fusionRuns?.[0]?.budget).toBe(8);
    expect(disabled.metadata.retrievalTrace?.reranker).toMatchObject({
      fallbackReason: "disabled",
      status: "skipped",
      strategy: "listwise",
    });
  });
});
