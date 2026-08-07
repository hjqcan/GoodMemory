import { describe, expect, it } from "bun:test";
import { createGoodMemory } from "../../src";
import {
  EVIDENCE_COLLECTION,
  SOURCE_MESSAGES_COLLECTION,
  type SourceMessageRecord,
} from "../../src/evidence/contracts";
import type { DocumentStore, StorageFilter } from "../../src/storage/contracts";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src/storage/memory";
import { createMemoryRepositories } from "../../src/storage/repositories";
import { createFakeEmbeddingAdapter } from "../../src/testing/fakes";
import type { ModelUsageAttempt } from "../../src/provider/model-usage";

describe("public remember API", () => {
  it("retains allowed raw messages when extraction finds no admissible candidate", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: {
        extractor: {
          async extract() {
            return { candidates: [], ignoredMessageCount: 0 };
          },
        },
      },
    });

    const result = await memory.remember({
      scope: { userId: "u-raw", sessionId: "s-raw" },
      messages: [
        { id: "raw-user", role: "user", content: "No durable claim here." },
        { id: "raw-assistant", role: "assistant", content: "Context only." },
        { id: "raw-private", role: "user", content: "Do not retain." },
      ],
      annotations: [{ messageIndex: 2, remember: "never" }],
    });

    expect(result.outcome).toBe("no_admissible_candidate");
    expect(
      await documentStore.query<SourceMessageRecord>(
        SOURCE_MESSAGES_COLLECTION,
        { userId: "u-raw", sessionId: "s-raw" },
      ),
    ).toEqual([
      expect.objectContaining({
        content: "No durable claim here.",
        sourceMessageId: "raw-user",
      }),
      expect.objectContaining({
        content: "Context only.",
        sourceMessageId: "raw-assistant",
      }),
    ]);
  });

  it("writes durable memory through the public API", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    const result = await memory.remember({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "Remember that the robot workflow is blocked on prod migration.",
        },
        {
          role: "user",
          content: "Please keep answers concise and action-oriented.",
        },
      ],
    });

    expect(result.accepted).toBe(2);
    expect(result.events.every((event) => typeof event.reason === "string")).toBe(true);
    expect(result.events.every((event) => typeof event.sourceMethod === "string")).toBe(true);
    expect(await documentStore.query("facts", { userId: "u-1" })).toHaveLength(1);
    expect(await documentStore.query("feedback", { userId: "u-1" })).toHaveLength(1);
  });

  it("writes selective evidence records for durable facts and references", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    const result = await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "Remember that the runtime rollout is blocked on vendor approval.",
        },
        {
          role: "user",
          content: "Use docs/runtime-runbook.md as the source of truth for runtime work.",
        },
      ],
    });

    const evidence = await documentStore.query<{
      excerpt: string;
      linkedMemoryIds: string[];
      userId: string;
      workspaceId?: string;
    }>(EVIDENCE_COLLECTION, {
      userId: "u-1",
      workspaceId: "workspace-a",
    });

    expect(evidence).toHaveLength(2);
    expect(
      evidence.some((record) => record.excerpt.includes("vendor approval")),
    ).toBe(true);
    expect(
      evidence.some((record) =>
        record.excerpt.includes(
          "Use docs/runtime-runbook.md as the source of truth for runtime work.",
        ),
      ),
    ).toBe(true);
    expect(
      evidence.some((record) => record.excerpt.trim() === "docs/runtime-runbook.md"),
    ).toBe(false);
    expect(evidence.every((record) => record.linkedMemoryIds.length === 1)).toBe(true);
    expect(
      result.events
        .filter(
          (event) =>
            event.outcome === "written" &&
            (event.memoryType === "fact" || event.memoryType === "reference"),
        )
        .every((event) => (event.evidenceIds?.length ?? 0) === 1),
    ).toBe(true);
  });

  it("writes fact, reference, and episode embeddings when an embedding adapter is enabled", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const embeddingAdapter = createFakeEmbeddingAdapter();
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore,
      vectorStore,
    });
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
        vectorStore,
        embeddingAdapter,
      },
    });
    const scope = { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" } as const;

    await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that the runtime rollout is blocked on vendor approval.",
        },
        {
          role: "assistant",
          content: "Understood. I will keep the handoff concise.",
        },
        {
          role: "user",
          content: "Use docs/runtime-runbook.md as the source of truth for runtime work.",
        },
      ],
    });

    const facts = await repositories.facts.listByScope(scope);
    const references = await repositories.references.listByScope(scope);
    const episodes = await repositories.episodes.listByScope(scope);
    const [factEmbedding] = await embeddingAdapter.embed([facts[0]!.content]);
    const [referenceEmbedding] = await embeddingAdapter.embed([
      [references[0]!.title, references[0]!.pointer, references[0]!.description ?? ""]
        .filter(Boolean)
        .join("\n"),
    ]);
    const [episodeEmbedding] = await embeddingAdapter.embed([
      [
        episodes[0]!.summary,
        episodes[0]!.keyDecisions.join("\n"),
        episodes[0]!.unresolvedItems.join("\n"),
        episodes[0]!.topics.join("\n"),
      ]
        .filter(Boolean)
        .join("\n"),
    ]);

    expect(
      await repositories.vectorIndex?.searchFactEmbedding(factEmbedding, {
        topK: 1,
        filter: { userId: "u-1", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(1);
    expect(
      await repositories.vectorIndex?.searchReferenceEmbedding(referenceEmbedding, {
        topK: 1,
        filter: { userId: "u-1", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(1);
    expect(
      await repositories.vectorIndex?.searchEpisodeEmbedding(episodeEmbedding, {
        topK: 1,
        filter: { userId: "u-1", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(1);

    const recall = await memory.recall({
      scope,
      query: "Which runbook should I use and what is the blocker?",
      retrievalProfile: "coding_agent",
    });

    expect(recall.references).toHaveLength(1);
    expect(recall.facts).toHaveLength(1);
  });

  it("batches embedding preparation by memory type instead of per written record", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const embedCalls: string[][] = [];
    const embeddingAdapter = {
      async embed(texts: string[]) {
        embedCalls.push([...texts]);
        return texts.map(() => [1, 2, 3]);
      },
    };
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
        vectorStore,
        embeddingAdapter,
      },
    });

    await memory.remember({
      scope: { userId: "u-batch", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "Remember that the runtime rollout is blocked on vendor approval.",
        },
        {
          role: "user",
          content: "Remember that the handoff package still needs legal review.",
        },
        {
          role: "user",
          content: "Use docs/runtime-runbook.md as the source of truth for runtime work.",
        },
        {
          role: "assistant",
          content: "Understood. I will keep the handoff concise.",
        },
      ],
    });

    expect(embedCalls).toHaveLength(3);
    expect(embedCalls[0]).toHaveLength(2);
    expect(embedCalls[1]).toHaveLength(1);
    expect(embedCalls[2]).toHaveLength(1);
  });

  it("rolls back derived writes but retains raw messages when embedding preparation fails", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    let embedCalls = 0;
    const embeddingAdapter = {
      async embed(texts: string[]) {
        embedCalls += 1;
        if (embedCalls === 1) {
          throw new Error("embedding unavailable");
        }

        return texts.map(() => [1, 2, 3]);
      },
    };
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
        vectorStore,
        embeddingAdapter,
      },
    });
    const scope = { userId: "u-rollback", workspaceId: "workspace-a", sessionId: "s-1" } as const;

    await expect(
      memory.remember({
        scope,
        messages: [
          {
            role: "user",
            content: "Remember that the runtime rollout is blocked on vendor approval.",
          },
          {
            role: "user",
            content: "Use docs/runtime-runbook.md as the source of truth for runtime work.",
          },
          {
            role: "assistant",
            content: "Understood. I will keep the handoff concise.",
          },
        ],
      }),
    ).rejects.toThrow("embedding unavailable");

    expect(await documentStore.query("facts", { userId: "u-rollback" })).toHaveLength(0);
    expect(await documentStore.query("references", { userId: "u-rollback" })).toHaveLength(0);
    expect(await documentStore.query("episodes", { userId: "u-rollback" })).toHaveLength(0);
    expect(await documentStore.query(EVIDENCE_COLLECTION, { userId: "u-rollback" })).toHaveLength(
      0,
    );
    expect(await documentStore.query(SOURCE_MESSAGES_COLLECTION, {
      userId: "u-rollback",
    })).toHaveLength(3);
    expect(
      await vectorStore.search("facts", [1, 2, 3], {
        topK: 5,
        filter: { userId: "u-rollback" },
      }),
    ).toHaveLength(0);

    const retry = await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that the runtime rollout is blocked on vendor approval.",
        },
        {
          role: "user",
          content: "Use docs/runtime-runbook.md as the source of truth for runtime work.",
        },
        {
          role: "assistant",
          content: "Understood. I will keep the handoff concise.",
        },
      ],
    });

    expect(retry.accepted).toBeGreaterThanOrEqual(2);
    expect(await documentStore.query("facts", { userId: "u-rollback" })).toHaveLength(1);
    expect(await documentStore.query("references", { userId: "u-rollback" })).toHaveLength(1);
    expect(await documentStore.query("episodes", { userId: "u-rollback" })).toHaveLength(1);
    expect(await documentStore.query(EVIDENCE_COLLECTION, { userId: "u-rollback" })).toHaveLength(
      2,
    );
    expect(await documentStore.query(SOURCE_MESSAGES_COLLECTION, {
      userId: "u-rollback",
    })).toHaveLength(3);
  });

  it("does not let rollback delete a concurrent writer's replacement", async () => {
    const documentStore = createInMemoryDocumentStore();
    let replacementId: string | null = null;
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
        vectorStore: createInMemoryVectorStore(),
        embeddingAdapter: {
          async embed() {
            const [written] = await documentStore.query<{
              content: string;
              id: string;
              updatedAt?: string;
            }>("facts", { userId: "u-concurrent-rollback" });
            replacementId = written!.id;
            await documentStore.set("facts", written!.id, {
              ...written!,
              content: "A concurrent writer committed the replacement.",
              updatedAt: "2026-07-18T12:00:00.000Z",
            });
            throw new Error("embedding unavailable after concurrent write");
          },
        },
      },
    });

    await expect(memory.remember({
      scope: {
        userId: "u-concurrent-rollback",
        workspaceId: "workspace-a",
        sessionId: "s-1",
      },
      messages: [{
        role: "user",
        content: "Remember that the runtime rollout is blocked on vendor approval.",
      }],
    })).rejects.toThrow("embedding unavailable after concurrent write");

    expect(replacementId).not.toBeNull();
    expect(await documentStore.get<{ content: string }>("facts", replacementId!))
      .toMatchObject({ content: "A concurrent writer committed the replacement." });
  });

  it("does not let rollback delete an identical value committed by another runtime", async () => {
    const documentStore = createInMemoryDocumentStore();
    const input = {
      scope: {
        userId: "u-identical-concurrent-rollback",
        workspaceId: "workspace-a",
        sessionId: "s-1",
      },
      messages: [{
        role: "user" as const,
        content: "Remember that the runtime rollout is blocked on vendor approval.",
      }],
    };
    const now = () => new Date("2026-07-18T11:00:00.000Z");
    const concurrentMemory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: { now },
    });
    let concurrentAccepted = 0;
    const failingMemory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
        vectorStore: createInMemoryVectorStore(),
        embeddingAdapter: {
          async embed() {
            concurrentAccepted = (await concurrentMemory.remember(input)).accepted;
            throw new Error("embedding unavailable after identical concurrent write");
          },
        },
      },
      testing: { now },
    });

    await expect(failingMemory.remember(input)).rejects.toThrow(
      "embedding unavailable after identical concurrent write",
    );

    expect(concurrentAccepted).toBeGreaterThan(0);
    expect(await documentStore.query("facts", {
      userId: input.scope.userId,
    })).toHaveLength(1);
    expect(await documentStore.query(SOURCE_MESSAGES_COLLECTION, {
      userId: input.scope.userId,
    })).toHaveLength(1);
  });

  it("can merge llm-assisted extraction into remember while preserving model influence in trace", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const assistedExtractor = {
      async extract() {
        return {
          candidates: [
            {
              id: "llm-1",
              kindHint: "fact" as const,
              explicitness: "explicit" as const,
              content: "Rollback owner is Maya.",
              sourceMessageIndex: 0,
              sourceRole: "user",
              metadata: {
                category: "project" as const,
                factKind: "project_state" as const,
                subject: "rollback owner",
              },
            },
          ],
          ignoredMessageCount: 0,
        };
      },
    };
    const rulesOnly = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
    });
    const llmAssisted = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
        assistedExtractor,
      },
    });
    const input = {
      scope: { userId: "u-llm", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [
        {
          role: "user" as const,
          content: "Maya is the rollback sheriff.",
        },
      ],
    };

    const baseline = await rulesOnly.remember(input);
    const result = await llmAssisted.remember({
      ...input,
      extractionStrategy: "llm-assisted",
    });

    expect(baseline.accepted).toBe(0);
    expect(result.accepted).toBe(1);
    expect(result.metadata?.requestedExtractionStrategy).toBe("llm-assisted");
    expect(result.metadata?.resolvedExtractionStrategy).toBe("llm-assisted");
    expect(result.events[0]?.extractionSources).toEqual(["llm-assisted"]);
    expect(
      await documentStore.query("facts", {
        userId: "u-llm",
        workspaceId: "workspace-a",
      }),
    ).toHaveLength(1);
  });

  it("routes automatic provider extraction usage to the configured observability sink", async () => {
    const originalFetch = globalThis.fetch;
    const events: ModelUsageAttempt[] = [];
    globalThis.fetch = (async () => new Response([
      'data: {"choices":[{"delta":{"content":"{\\"candidates\\":[],\\"ignoredMessageCount\\":1}"},"index":0}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3,"prompt_tokens_details":{"cached_tokens":4}}}',
      "data: [DONE]",
      "",
    ].join("\n\n"), {
      headers: { "content-type": "text/event-stream" },
      status: 200,
    })) as unknown as typeof fetch;

    try {
      const memory = createGoodMemory({
        storage: { provider: "memory" },
        observability: {
          modelUsageSink: { emit(event) { events.push(event); } },
        },
        providers: {
          extraction: {
            apiKey: "test-key",
            baseURL: "https://gateway.example/v1",
            model: "gpt-5.6-terra",
            provider: "openai",
          },
        },
      });

      await memory.remember({
        extractionStrategy: "llm-assisted",
        messages: [{ role: "user", content: "Hello." }],
        scope: { userId: "u-provider-usage", sessionId: "s-1" },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(events).toEqual([
      expect.objectContaining({
        completeness: "complete",
        modelId: "gpt-5.6-terra",
        operation: "assisted_extraction",
        outcome: "succeeded",
        providerId: "openai",
        usage: expect.objectContaining({
          cacheReadInputTokens: 4,
          inputTokens: 12,
          outputTokens: 3,
          uncachedInputTokens: 8,
        }),
      }),
    ]);
  });

  it("keeps policy and write gating ahead of llm-assisted model output", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      policy: {
        async shouldRemember() {
          return false;
        },
      },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
        assistedExtractor: {
          async extract() {
            return {
              candidates: [
                {
                  id: "llm-blocked",
                  kindHint: "fact" as const,
                  explicitness: "explicit" as const,
                  content: "Launch owner is Maya.",
                  sourceMessageIndex: 0,
                  sourceRole: "user",
                  metadata: {
                    category: "project" as const,
                    factKind: "project_state" as const,
                    subject: "launch owner",
                  },
                },
              ],
              ignoredMessageCount: 0,
            };
          },
        },
      },
    });

    const result = await memory.remember({
      scope: { userId: "u-llm-policy", sessionId: "s-1" },
      extractionStrategy: "llm-assisted",
      messages: [
        {
          role: "user",
          content: "Maya owns launch.",
        },
      ],
    });

    expect(result.accepted).toBe(0);
    expect(result.rejected).toBeGreaterThanOrEqual(1);
    expect(
      result.events.some(
        (event) =>
          event.reason === "policy_blocked" &&
          event.extractionSources?.includes("llm-assisted"),
      ),
    ).toBe(true);
    expect(await documentStore.query("facts", { userId: "u-llm-policy" })).toHaveLength(0);
  });

  it("does not write memory for empty or noisy conversation input", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    const result = await memory.remember({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.accepted).toBe(0);
    expect(result.rejected).toBeGreaterThan(0);
    expect(await documentStore.query("facts", { userId: "u-1" })).toHaveLength(0);
  });

  it("counts ignored noise per message instead of per clause", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    const noiseOnly = await memory.remember({
      scope: { userId: "u-1", sessionId: "s-noise" },
      messages: [{ role: "user", content: "hi" }],
    });
    const mixed = await memory.remember({
      scope: { userId: "u-1", sessionId: "s-mixed" },
      messages: [{ role: "user", content: "My name is Felix. Thanks" }],
    });

    expect(noiseOnly.accepted).toBe(0);
    expect(noiseOnly.rejected).toBe(1);
    expect(mixed.accepted).toBe(1);
    expect(mixed.rejected).toBe(0);
  });

  it("compiles preferences, references, and episodes from a multi-turn interaction", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    const result = await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "I prefer bullet points in project summaries.",
        },
        {
          role: "assistant",
          content: "Understood. I will use concise bullet points.",
        },
        {
          role: "user",
          content: "Use docs/migration-runbook.md as the source of truth for migration work.",
        },
      ],
    });

    expect(result.accepted).toBeGreaterThanOrEqual(3);
    expect(
      await documentStore.query("preferences", {
        userId: "u-1",
        workspaceId: "workspace-a",
      }),
    ).toHaveLength(1);
    expect(
      await documentStore.query("references", {
        userId: "u-1",
        workspaceId: "workspace-a",
      }),
    ).toHaveLength(1);
    expect(
      await documentStore.query("episodes", {
        userId: "u-1",
        workspaceId: "workspace-a",
      }),
    ).toHaveLength(1);
    const episodes = await documentStore.query<{
      summary: string;
      keyDecisions: string[];
    }>("episodes", {
      userId: "u-1",
      workspaceId: "workspace-a",
    });
    expect(episodes[0]?.summary).toContain(
      "Assistant follow-through captured.",
    );
    expect(episodes[0]?.keyDecisions).toContain(
      "Assistant follow-through on: bullet points in project summaries",
    );
  });

  it("does not promote assistant-only claims into durable semantic memory", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    const result = await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [
        {
          role: "assistant",
          content:
            "I will use docs/migration-runbook-v2.md and remember that the blocker is vendor approval.",
        },
      ],
    });

    expect(result.accepted).toBe(0);
    expect(await documentStore.query("profiles", { userId: "u-1" })).toHaveLength(0);
    expect(await documentStore.query("references", { userId: "u-1" })).toHaveLength(0);
    expect(await documentStore.query("facts", { userId: "u-1" })).toHaveLength(0);
    expect(await documentStore.query("preferences", { userId: "u-1" })).toHaveLength(0);
    expect(await documentStore.query("episodes", { userId: "u-1" })).toHaveLength(0);
  });

  it("captures assistant follow-through in episodic memory without promoting it to durable facts", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "Use docs/migration-runbook-v2.md as the source of truth.",
        },
        {
          role: "assistant",
          content: "Updated. I will use the newer runbook going forward.",
        },
      ],
    });

    const episodes = await documentStore.query<{
      summary: string;
      keyDecisions: string[];
    }>("episodes", {
      userId: "u-1",
      workspaceId: "workspace-a",
    });
    const facts = await documentStore.query("facts", {
      userId: "u-1",
      workspaceId: "workspace-a",
    });
    const references = await documentStore.query("references", {
      userId: "u-1",
      workspaceId: "workspace-a",
    });

    expect(references).toHaveLength(1);
    expect(facts).toHaveLength(0);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.summary).toContain(
      "Assistant follow-through captured.",
    );
    expect(episodes[0]?.keyDecisions).toContain(
      "Assistant follow-through on: docs/migration-runbook-v2.md",
    );
  });

  it("does not persist duplicate identity facts when remember-that clauses only restate profile", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [
        { role: "user", content: "Remember that my name is Felix." },
        {
          role: "user",
          content: "Remember that I'm a climate policy advisor in Austin, USA.",
        },
      ],
    });

    const profiles = await documentStore.query<{
      identity: Record<string, string>;
    }>("profiles", { userId: "u-1" });
    const facts = await documentStore.query("facts", {
      userId: "u-1",
      workspaceId: "workspace-a",
    });

    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.identity).toEqual({
      name: "Felix",
      role: "climate policy advisor",
      location: "Austin, USA",
    });
    expect(facts).toHaveLength(0);
  });

  it("dedupes identical preferences instead of appending duplicates", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    const first = await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "I prefer bullet points in project summaries.",
        },
      ],
    });
    const second = await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-2" },
      messages: [
        {
          role: "user",
          content: "I prefer bullet points in project summaries.",
        },
      ],
    });

    const preferences = await documentStore.query<{ id: string; value: unknown }>("preferences", {
      userId: "u-1",
      workspaceId: "workspace-a",
    });

    expect(preferences).toHaveLength(1);
    expect(second.events[0]?.memoryId).toBe(first.events[0]?.memoryId);
    expect(second.events.some((event) => event.reason === "duplicate_preference")).toBe(
      true,
    );
  });

  it("supersedes older preferences in the same category so recall only carries the latest guidance", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
    });

    const first = await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "I prefer bullet points in project summaries.",
        },
      ],
    });
    const second = await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-2" },
      messages: [
        {
          role: "user",
          content: "I prefer short paragraphs in project summaries.",
        },
      ],
    });
    const recall = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-2" },
      query: "How should I answer this user?",
    });
    const context = await memory.buildContext({
      recall,
      output: "markdown",
    });

    const preferences = await documentStore.query<{
      id: string;
      category: string;
      lifecycle?: string;
      supersededBy?: string | null;
      value: unknown;
    }>("preferences", {
      userId: "u-1",
      workspaceId: "workspace-a",
    });
    const previousMemoryId = first.events[0]?.memoryId;
    const newMemoryId = second.events[0]?.memoryId;
    const previous = preferences.find((preference) => preference.id === previousMemoryId);
    const active = preferences.find((preference) => preference.id === newMemoryId);

    expect(newMemoryId).not.toBe(previousMemoryId);
    expect(preferences).toHaveLength(2);
    expect(previous).toMatchObject({
      lifecycle: "superseded",
      supersededBy: newMemoryId,
    });
    expect(active).toMatchObject({
      lifecycle: "active",
      supersededBy: null,
    });
    expect(String(active?.value)).toContain("short paragraphs");
    expect(second.events.some((event) => event.reason === "superseded_preference")).toBe(
      true,
    );
    expect(recall.preferences).toHaveLength(1);
    expect(String(recall.preferences[0]?.value)).toContain("short paragraphs");
    expect(context.content).toContain("short paragraphs");
    expect(context.content).not.toContain("bullet points");
  });

  it("serializes concurrent preference replacements into one active lineage", async () => {
    const backingStore = createInMemoryDocumentStore();
    let preferenceSnapshotRead = (): void => {};
    const preferenceSnapshotReady = new Promise<void>((resolve) => {
      preferenceSnapshotRead = resolve;
    });
    let releaseStaleSnapshot = (): void => {};
    const staleSnapshotBlocked = new Promise<void>((resolve) => {
      releaseStaleSnapshot = resolve;
    });
    let blockedPreferenceQuery = false;
    const delayedDocumentStore: DocumentStore = {
      ...backingStore,
      async query<TDocument extends object>(
        collection: string,
        filter?: StorageFilter,
      ): Promise<TDocument[]> {
        const documents = await backingStore.query<TDocument>(collection, filter);
        if (collection === "preferences" && !blockedPreferenceQuery) {
          blockedPreferenceQuery = true;
          preferenceSnapshotRead();
          await staleSnapshotBlocked;
        }
        return documents;
      },
    };
    const scope = {
      userId: "u-concurrent-preference-lineage",
      workspaceId: "workspace-a",
    } as const;
    const firstRuntime = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore: backingStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: {
        now: () => new Date("2026-01-02T00:00:00.000Z"),
      },
    });
    const secondRuntime = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore: delayedDocumentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: {
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    const secondPending = secondRuntime.remember({
      scope: { ...scope, sessionId: "s-2" },
      messages: [{
        role: "user",
        content: "I prefer numbered lists in project summaries.",
      }],
    });
    await preferenceSnapshotReady;
    const first = await firstRuntime.remember({
      scope: { ...scope, sessionId: "s-1" },
      messages: [{
        role: "user",
        content: "I prefer short paragraphs in project summaries.",
      }],
    });
    releaseStaleSnapshot();
    const second = await secondPending;

    const replacements = [first, second];
    const replacementIds = replacements.map((result) => result.events[0]?.memoryId);
    const preferences = await backingStore.query<{
      id: string;
      lifecycle?: string;
      source: { extractedAt: string };
      supersededBy?: string | null;
      updatedAt: string;
    }>("preferences", scope);
    const active = preferences.filter(
      (preference) => (preference.lifecycle ?? "active") === "active",
    );
    const superseded = preferences.filter(
      (preference) => preference.lifecycle === "superseded",
    );

    expect(blockedPreferenceQuery).toBe(true);
    expect(new Set(replacementIds).size).toBe(2);
    expect(preferences).toHaveLength(2);
    expect(active).toHaveLength(1);
    expect(superseded).toHaveLength(1);
    expect(superseded[0]?.supersededBy).toBe(active[0]?.id);
    expect(
      preferences.every(
        (preference) => preference.updatedAt >= preference.source.extractedAt,
      ),
    ).toBe(true);
    expect(active[0]!.updatedAt >= superseded[0]!.updatedAt).toBe(true);
    expect(first.events[0]?.outcome).toBe("written");
    expect(second.events[0]?.outcome).toBe("superseded");
  });

  it("provides only local best-effort rollback without conditional batch support", async () => {
    const backingStore = createInMemoryDocumentStore();
    const scope = {
      userId: "u-fallback-preference-rollback",
      workspaceId: "workspace-a",
    } as const;
    const original = {
      id: "preference-fallback-original",
      ...scope,
      category: "response_style",
      value: "bullet points in project summaries",
      confidence: 1,
      evidenceCount: 1,
      lifecycle: "active",
      source: {
        method: "explicit" as const,
        extractedAt: "2026-01-01T00:00:00.000Z",
      },
      supersededBy: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await backingStore.set("preferences", original.id, original);
    const documentStore: DocumentStore = {
      async set<TDocument extends object>(
        collection: string,
        id: string,
        document: TDocument,
      ): Promise<void> {
        if (
          collection === "preferences" &&
          id === original.id &&
          (document as { lifecycle?: string }).lifecycle === "superseded"
        ) {
          throw new Error("fallback preference replacement failed");
        }
        await backingStore.set(collection, id, document);
      },
      async get<TDocument extends object>(collection: string, id: string) {
        return backingStore.get<TDocument>(collection, id);
      },
      async update<TDocument extends object>(
        collection: string,
        id: string,
        patch: Partial<TDocument>,
      ): Promise<void> {
        await backingStore.update(collection, id, patch);
      },
      async query<TDocument extends object>(
        collection: string,
        filter?: StorageFilter,
      ): Promise<TDocument[]> {
        return backingStore.query<TDocument>(collection, filter);
      },
      async delete(collection: string, id: string): Promise<void> {
        await backingStore.delete(collection, id);
      },
    };
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      storage: { provider: "memory" },
    });

    await expect(memory.remember({
      scope: { ...scope, sessionId: "s-1" },
      messages: [{
        role: "user",
        content: "I prefer short paragraphs in project summaries.",
      }],
    })).rejects.toThrow("fallback preference replacement failed");

    expect(await backingStore.query("preferences", scope)).toEqual([original]);
    expect(await backingStore.query(SOURCE_MESSAGES_COLLECTION, scope)).toHaveLength(1);
  });

  it("retains every active preference sibling as superseded when writing the replacement", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });
    const scope = {
      userId: "u-preference-lineage",
      workspaceId: "workspace-a",
    } as const;

    await documentStore.set("preferences", "preference-old-1", {
      id: "preference-old-1",
      ...scope,
      category: "response_style",
      value: "bullet points in project summaries",
      confidence: 1,
      evidenceCount: 1,
      lifecycle: "active",
      source: {
        method: "explicit",
        extractedAt: "2026-01-01T00:00:00.000Z",
      },
      supersededBy: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await documentStore.set("preferences", "preference-old-2", {
      id: "preference-old-2",
      ...scope,
      category: "response_style",
      value: "numbered lists in project summaries",
      confidence: 1,
      evidenceCount: 1,
      lifecycle: "active",
      source: {
        method: "explicit",
        extractedAt: "2026-01-02T00:00:00.000Z",
      },
      supersededBy: null,
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const result = await memory.remember({
      scope: { ...scope, sessionId: "s-1" },
      messages: [{
        role: "user",
        content: "I prefer short paragraphs in project summaries.",
      }],
    });
    const newMemoryId = result.events[0]?.memoryId;
    const preferences = await documentStore.query<{
      id: string;
      lifecycle?: string;
      supersededBy?: string | null;
    }>("preferences", scope);

    expect(preferences).toHaveLength(3);
    expect(
      preferences.filter((preference) => preference.lifecycle === "active"),
    ).toEqual([expect.objectContaining({ id: newMemoryId, supersededBy: null })]);
    expect(
      preferences
        .filter((preference) => preference.lifecycle === "superseded")
        .map((preference) => ({
          id: preference.id,
          supersededBy: preference.supersededBy,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    ).toEqual([
      { id: "preference-old-1", supersededBy: newMemoryId },
      { id: "preference-old-2", supersededBy: newMemoryId },
    ]);
  });

  it("keeps general-preference history exportable and auditable through later revision", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: {
        extractor: {
          async extract(input) {
            const content = input.messages[0]?.content ?? "";
            return {
              candidates: [{
                content,
                explicitness: "explicit" as const,
                id: `candidate-${content}`,
                kindHint: "preference" as const,
                metadata: { preferenceValue: content },
                sourceMessageIndex: 0,
                sourceRole: "user" as const,
              }],
              ignoredMessageCount: 0,
            };
          },
        },
        now: () => new Date("2026-04-25T00:00:00.000Z"),
      },
    });
    const durableScope = {
      userId: "u-general-preference-lineage",
      workspaceId: "workspace-a",
    } as const;

    const first = await memory.remember({
      scope: { ...durableScope, sessionId: "s-1" },
      messages: [{ role: "user", content: "I prefer jasmine tea." }],
    });
    const second = await memory.remember({
      scope: { ...durableScope, sessionId: "s-2" },
      messages: [{ role: "user", content: "I prefer dark editor themes." }],
    });
    const firstId = first.events[0]?.memoryId;
    const secondId = second.events[0]?.memoryId;
    if (!firstId || !secondId) {
      throw new Error("Expected both general preferences to be stored.");
    }

    const revised = await memory.reviseMemory({
      evidence: {
        message: "Use a dim dark theme instead.",
        source: "user_message",
      },
      idempotencyKey: "general-preference-theme-revision",
      reason: "user_correction",
      revision: { content: "I prefer dim dark editor themes." },
      scope: durableScope,
      target: { memoryId: secondId },
    });
    const revisedId = revised.newMemoryId;
    if (!revisedId) {
      throw new Error("Expected preference revision to create a replacement.");
    }

    const exported = await memory.exportMemory({ scope: durableScope });
    const preferenceById = new Map(
      exported.durable.preferences.map((preference) => [preference.id, preference]),
    );
    const revisionEvidence = exported.durable.evidence.find(
      (record) => record.id === revised.evidenceIds?.[0],
    );
    const recalled = await memory.recall({
      query: "What are the user's preferences?",
      scope: durableScope,
    });

    expect(exported.durable.preferences).toHaveLength(3);
    expect(preferenceById.get(firstId)).toMatchObject({
      category: "general_preference",
      lifecycle: "superseded",
      supersededBy: secondId,
      value: "I prefer jasmine tea.",
    });
    expect(preferenceById.get(secondId)).toMatchObject({
      lifecycle: "superseded",
      supersededBy: revisedId,
      value: "I prefer dark editor themes.",
    });
    expect(preferenceById.get(revisedId)).toMatchObject({
      lifecycle: "active",
      value: "I prefer dim dark editor themes.",
    });
    expect(revisionEvidence?.linkedMemoryIds).toEqual([secondId, revisedId]);
    expect(recalled.preferences.map((preference) => preference.id)).toEqual([
      revisedId,
    ]);
  });

  it("keeps preference supersession isolated to the requested workspace", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    const workspaceA = await memory.remember({
      scope: {
        userId: "u-preference-scopes",
        workspaceId: "workspace-a",
        sessionId: "s-1",
      },
      messages: [{
        role: "user",
        content: "I prefer bullet points in project summaries.",
      }],
    });
    const workspaceB = await memory.remember({
      scope: {
        userId: "u-preference-scopes",
        workspaceId: "workspace-b",
        sessionId: "s-2",
      },
      messages: [{
        role: "user",
        content: "I prefer short paragraphs in project summaries.",
      }],
    });

    const preferences = await documentStore.query<{
      id: string;
      lifecycle?: string;
      supersededBy?: string | null;
      workspaceId?: string;
    }>("preferences", { userId: "u-preference-scopes" });

    expect(workspaceB.events[0]?.outcome).toBe("written");
    expect(preferences).toHaveLength(2);
    expect(preferences).toContainEqual(expect.objectContaining({
      id: workspaceA.events[0]?.memoryId,
      lifecycle: "active",
      supersededBy: null,
      workspaceId: "workspace-a",
    }));
    expect(preferences).toContainEqual(expect.objectContaining({
      id: workspaceB.events[0]?.memoryId,
      lifecycle: "active",
      supersededBy: null,
      workspaceId: "workspace-b",
    }));
  });

  it("treats omitted tenant workspace and agent dimensions as exact durable scope", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: {
        extractor: {
          async extract(input) {
            const content = input.messages[0]?.content ?? "";
            return {
              candidates: [{
                content,
                explicitness: "explicit" as const,
                id: `exact-scope-${input.scope.sessionId}`,
                kindHint: "preference" as const,
                metadata: {
                  preferenceCategory: "response_style",
                  preferenceValue: content,
                },
                sourceMessageIndex: 0,
                sourceRole: "user" as const,
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
    });
    const scopes = [
      { userId: "u-preference-exact-scope", tenantId: "tenant-a" },
      { userId: "u-preference-exact-scope", workspaceId: "workspace-a" },
      { userId: "u-preference-exact-scope", agentId: "agent-a" },
      { userId: "u-preference-exact-scope" },
    ];
    const contents = [
      "I prefer bullet points in project summaries.",
      "I prefer short paragraphs in project summaries.",
      "I prefer numbered lists in project summaries.",
      "I prefer concise headings in project summaries.",
    ];

    const results = [];
    for (const [index, scope] of scopes.entries()) {
      results.push(await memory.remember({
        scope: { ...scope, sessionId: `session-${index}` },
        messages: [{ role: "user", content: contents[index]! }],
      }));
    }
    const preferences = await documentStore.query<{
      category: string;
      id: string;
      lifecycle?: string;
      supersededBy?: string | null;
    }>("preferences", { userId: "u-preference-exact-scope" });

    expect(results.map((result) => result.events[0]?.outcome)).toEqual([
      "written",
      "written",
      "written",
      "written",
    ]);
    expect(preferences).toHaveLength(4);
    expect(new Set(preferences.map(({ category }) => category))).toEqual(
      new Set(["response_style"]),
    );
    expect(
      preferences.every(
        (preference) =>
          preference.lifecycle === "active" && preference.supersededBy === null,
      ),
    ).toBe(true);
  });

  it("restores the active preference when a later remember write fails", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const scope = {
      userId: "u-preference-rollback",
      workspaceId: "workspace-a",
    } as const;
    const baseline = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
    });
    const original = await baseline.remember({
      scope: { ...scope, sessionId: "s-1" },
      messages: [{
        role: "user",
        content: "I prefer bullet points in project summaries.",
      }],
    });
    const failing = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
        vectorStore: createInMemoryVectorStore(),
        embeddingAdapter: {
          async embed() {
            throw new Error("preference lineage rollback");
          },
        },
      },
    });

    await expect(failing.remember({
      scope: { ...scope, sessionId: "s-2" },
      messages: [
        {
          role: "user",
          content: "I prefer short paragraphs in project summaries.",
        },
        {
          role: "user",
          content: "Remember that the rollout is blocked on legal review.",
        },
      ],
    })).rejects.toThrow("preference lineage rollback");

    const preferences = await documentStore.query<{
      id: string;
      lifecycle?: string;
      supersededBy?: string | null;
      value: unknown;
    }>("preferences", scope);

    expect(preferences).toEqual([
      expect.objectContaining({
        id: original.events[0]?.memoryId,
        lifecycle: "active",
        supersededBy: null,
      }),
    ]);
    expect(String(preferences[0]?.value)).toContain("bullet points");
  });

  it("suppresses unrelated preference and feedback lanes for direct factual recall", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
    });

    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "fact-session" },
      messages: [
        {
          role: "user",
          content:
            "Remember that I redeemed a $5 coupon on coffee creamer at Target.",
        },
      ],
    });
    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "preference-session" },
      messages: [
        {
          role: "user",
          content: "I prefer more upbeat and energetic music.",
        },
      ],
    });
    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "feedback-session" },
      messages: [
        {
          role: "user",
          content: "Please avoid spoilers.",
        },
      ],
    });

    const recall = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "Where did I redeem a $5 coupon on coffee creamer?",
    });
    const context = await memory.buildContext({
      recall,
      output: "markdown",
    });

    expect(recall.facts.map((fact) => fact.sessionId)).toEqual(["fact-session"]);
    expect(recall.preferences).toHaveLength(0);
    expect(recall.feedback).toHaveLength(0);
    expect(recall.metadata.policyApplied).toContain(
      "guidance_lanes_suppressed_for_fact_query",
    );
    expect(context.content).toContain("Target");
    expect(context.content).not.toContain("upbeat");
    expect(context.content).not.toContain("spoilers");
  });

  it("keeps preference and feedback lanes for guidance and action-adaptation queries", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
    });

    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "preference-session" },
      messages: [
        {
          role: "user",
          content: "I prefer concise launch risk summaries.",
        },
      ],
    });
    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "feedback-session" },
      messages: [
        {
          role: "user",
          content:
            "Please avoid DeepAnalyzer after detailed analysis timeouts; use QuickCheck first.",
        },
      ],
    });

    const preferenceRecall = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "How should launch updates be written?",
    });
    const feedbackRecall = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "I need a detailed analysis of our network traffic.",
    });
    const feedbackContext = await memory.buildContext({
      recall: feedbackRecall,
      output: "markdown",
    });

    expect(preferenceRecall.preferences).toHaveLength(1);
    expect(String(preferenceRecall.preferences[0]?.value)).toContain(
      "concise launch risk summaries",
    );
    expect(preferenceRecall.metadata.policyApplied).not.toContain(
      "guidance_lanes_suppressed_for_fact_query",
    );
    expect(feedbackRecall.feedback).toHaveLength(1);
    expect(feedbackRecall.feedback[0]?.rule).toContain("DeepAnalyzer");
    expect(feedbackRecall.metadata.policyApplied).not.toContain(
      "guidance_lanes_suppressed_for_fact_query",
    );
    expect(feedbackContext.content).toContain("avoid DeepAnalyzer");
  });

  it("recalls multiple personal open loops for aggregate to-do questions", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
    });
    const baseScope = { userId: "u-1", workspaceId: "workspace-a" };

    await memory.remember({
      scope: { ...baseScope, sessionId: "dry-cleaning-session" },
      messages: [
        {
          role: "user",
          content:
            "I still need to pick up my dry cleaning for the navy blue blazer I wore to a meeting a few weeks ago.",
        },
      ],
    });
    await memory.remember({
      scope: { ...baseScope, sessionId: "return-session" },
      messages: [
        {
          role: "user",
          content:
            "I need to return some boots to Zara, actually. I got them on February 5th, but they were too small.",
        },
      ],
    });
    await memory.remember({
      scope: { ...baseScope, sessionId: "pickup-session" },
      messages: [
        {
          role: "user",
          content:
            "I just exchanged a pair of boots I got from Zara on 2/5, and I still need to pick up the new pair.",
        },
      ],
    });
    await memory.remember({
      scope: { ...baseScope, sessionId: "noise-session" },
      messages: [
        {
          role: "user",
          content:
            "I bought new black jeans from Levi's and a white button-down shirt from H&M.",
        },
      ],
    });

    const recall = await memory.recall({
      scope: baseScope,
      query: "How many items of clothing do I need to pick up or return from a store?",
    });

    expect(recall.facts.map((fact) => fact.sessionId).sort()).toEqual([
      "dry-cleaning-session",
      "pickup-session",
      "return-session",
    ]);
    expect(recall.facts.map((fact) => fact.sessionId)).not.toContain("noise-session");
  });

  it("does not create episodic memory for ordinary chit-chat with no durable signal", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    const result = await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-2" },
      messages: [
        { role: "user", content: "How are you today?" },
        { role: "assistant", content: "Doing well." },
        { role: "user", content: "Nice weather lately." },
      ],
    });

    expect(result.accepted).toBe(0);
    expect(
      await documentStore.query("episodes", {
        userId: "u-1",
        workspaceId: "workspace-a",
      }),
    ).toHaveLength(0);
  });

  it("treats legacy references without lifecycle as active during duplicate handling", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });
    await documentStore.set("references", "ref-legacy", {
      id: "ref-legacy",
      userId: "u-1",
      workspaceId: "workspace-a",
      sessionId: "s-legacy",
      title: "migration-runbook.md",
      pointer: "docs/migration-runbook.md",
      confidence: 1,
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      subject: "migration work",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-2" },
      messages: [
        {
          role: "user",
          content: "Use docs/migration-runbook.md as the source of truth for migration work.",
        },
      ],
    });

    const references = await documentStore.query<{ id: string; pointer: string }>(
      "references",
      {
        userId: "u-1",
        workspaceId: "workspace-a",
      },
    );
    expect(references).toHaveLength(1);
    expect(references[0]?.id).toBe("ref-legacy");
    expect(references[0]?.pointer).toBe("docs/migration-runbook.md");
  });

  it("supersedes stale reference memory when the user corrects the source of truth", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const embeddingAdapter = createFakeEmbeddingAdapter();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
        vectorStore,
        embeddingAdapter,
      },
    });

    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "Use docs/migration-runbook-v1.md as the source of truth for migration work.",
        },
        {
          role: "assistant",
          content: "Understood.",
        },
      ],
    });

    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-2" },
      messages: [
        {
          role: "user",
          content:
            "Correction: docs/migration-runbook-v2.md is now the source of truth, not docs/migration-runbook-v1.md. Please update that.",
        },
        {
          role: "assistant",
          content: "Updated.",
        },
      ],
    });

    const references = await documentStore.query<{
      id: string;
      title: string;
      pointer: string;
      lifecycle: string;
      subject?: string;
    }>("references", {
      userId: "u-1",
      workspaceId: "workspace-a",
    });

    expect(
      references.some(
        (reference) =>
          reference.pointer === "docs/migration-runbook-v1.md" &&
          reference.lifecycle === "superseded",
      ),
    ).toBe(true);
    expect(
      references.some(
        (reference) =>
          reference.pointer === "docs/migration-runbook-v2.md" &&
          reference.lifecycle === "active" &&
          reference.subject === "migration work",
      ),
    ).toBe(true);

    const oldReference = references.find(
      (reference) => reference.pointer === "docs/migration-runbook-v1.md",
    );
    const newReference = references.find(
      (reference) => reference.pointer === "docs/migration-runbook-v2.md",
    );
    const [oldEmbedding] = await embeddingAdapter.embed([
      [
        oldReference?.title ?? "",
        oldReference?.pointer ?? "",
      ].filter(Boolean).join("\n"),
    ]);
    const [newEmbedding] = await embeddingAdapter.embed([
      [
        newReference?.title ?? "",
        newReference?.pointer ?? "",
      ].filter(Boolean).join("\n"),
    ]);

    expect(
      await vectorStore.search("references", oldEmbedding, {
        topK: 5,
        filter: { userId: "u-1", workspaceId: "workspace-a" },
      }),
    ).not.toContainEqual(
      expect.objectContaining({
        id: oldReference?.id,
      }),
    );
    expect(
      await vectorStore.search("references", newEmbedding, {
        topK: 5,
        filter: { userId: "u-1", workspaceId: "workspace-a" },
      }),
    ).toContainEqual(
      expect.objectContaining({
        id: newReference?.id,
      }),
    );
  });

  it("deletes stale vectors on supersede even when no embedding adapter is configured", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const seedingEmbeddingAdapter = createFakeEmbeddingAdapter();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
        vectorStore,
      },
    });

    await documentStore.set("references", "ref-old", {
      id: "ref-old",
      userId: "u-no-embed",
      workspaceId: "workspace-a",
      sessionId: "s-1",
      title: "docs/runbook-v1.md",
      pointer: "docs/runbook-v1.md",
      confidence: 1,
      source: {
        method: "explicit",
        extractedAt: "2026-01-01T00:00:00.000Z",
        locale: "en-US",
      },
      referenceKind: "source_of_truth",
      subject: "migration work",
      lifecycle: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const [oldEmbedding] = await seedingEmbeddingAdapter.embed([
      "docs/runbook-v1.md\ndocs/runbook-v1.md",
    ]);
    await vectorStore.upsert("references", [
      {
        id: "ref-old",
        embedding: oldEmbedding,
        metadata: {
          userId: "u-no-embed",
          workspaceId: "workspace-a",
          sessionId: "s-1",
          memoryType: "reference",
        },
        content: "docs/runbook-v1.md\ndocs/runbook-v1.md",
      },
    ]);

    await memory.remember({
      scope: { userId: "u-no-embed", workspaceId: "workspace-a", sessionId: "s-2" },
      messages: [
        {
          role: "user",
          content:
            "Correction: docs/runbook-v2.md is now the source of truth, not docs/runbook-v1.md. Please update that.",
        },
      ],
    });

    const searchResults = await vectorStore.search("references", oldEmbedding, {
      topK: 5,
      filter: { userId: "u-no-embed", workspaceId: "workspace-a" },
    });

    expect(searchResults).not.toContainEqual(expect.objectContaining({ id: "ref-old" }));
  });

  it("updates the durable profile when the user moves into a new role", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    await memory.remember({
      scope: { userId: "u-role", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "Remember that I am a biomedical researcher in London, UK.",
        },
      ],
    });

    await memory.remember({
      scope: { userId: "u-role", workspaceId: "workspace-a", sessionId: "s-2" },
      messages: [
        {
          role: "user",
          content:
            "Remember that I have now moved into a staff platform engineer leading release quality program.",
        },
      ],
    });

    const profiles = await documentStore.query<{
      identity: {
        role?: string;
        location?: string;
      };
      activeContext?: {
        currentProjects?: string[];
      };
    }>("profiles", { userId: "u-role" });

    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.identity.role).toBe("staff platform engineer");
    expect(profiles[0]?.identity.location).toBe("London, UK");
    expect(profiles[0]?.activeContext?.currentProjects).toContain(
      "release quality program",
    );
  });

  it("writes slot-structured fact and reference metadata during remember", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    await memory.remember({
      scope: { userId: "u-structured", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content:
            "Remember that I have now moved into a staff platform engineer leading release quality program.",
        },
        {
          role: "user",
          content:
            "Remember that my current focus is runtime reliability and platform migration for release quality program.",
        },
        {
          role: "user",
          content:
            "Remember that the current blocker is vendor approval for release quality program.",
        },
        {
          role: "user",
          content:
            "Remember that owner review is still pending for release quality program.",
        },
        {
          role: "user",
          content:
            "Remember that the next milestone is cutover readiness for release quality program.",
        },
        {
          role: "user",
          content:
            "Remember that the next step for the service that has to stay online is vendor validation.",
        },
        {
          role: "user",
          content:
            "Use docs/release-quality-runbook.md as the source of truth for release quality program.",
        },
      ],
    });

    const facts = await documentStore.query<{
      content: string;
      category?: string;
      factKind?: string;
      scopeKind?: string;
      subject?: string;
    }>("facts", {
      userId: "u-structured",
      workspaceId: "workspace-a",
    });
    const references = await documentStore.query<{
      pointer: string;
      referenceKind?: string;
      subject?: string;
    }>("references", {
      userId: "u-structured",
      workspaceId: "workspace-a",
    });

    expect(
      facts.some(
        (fact) =>
          fact.content ===
            "my current role is staff platform engineer leading release quality program." &&
          fact.factKind === "role_update" &&
          fact.scopeKind === "identity" &&
          fact.subject === "release quality program",
      ),
    ).toBe(true);
    expect(
      facts.some(
        (fact) =>
          fact.content ===
            "my current focus is runtime reliability and platform migration for release quality program." &&
          fact.factKind === "focus_update" &&
          fact.scopeKind === "project" &&
          fact.subject === "release quality program",
      ),
    ).toBe(true);
    expect(
      facts.some(
        (fact) =>
          fact.content ===
            "the current blocker is vendor approval for release quality program." &&
          fact.factKind === "blocker" &&
          fact.scopeKind === "project" &&
          fact.subject === "release quality program",
      ),
    ).toBe(true);
    expect(
      facts.some(
        (fact) =>
          fact.content ===
            "owner review is still pending for release quality program." &&
          fact.factKind === "project_state" &&
          fact.scopeKind === "project" &&
          fact.subject === "release quality program",
      ),
    ).toBe(true);
    expect(
      facts.some(
        (fact) =>
          fact.content ===
            "the next milestone is cutover readiness for release quality program." &&
          fact.factKind === "project_state" &&
          fact.scopeKind === "project" &&
          fact.subject === "release quality program",
      ),
    ).toBe(true);
    expect(
      facts.some(
        (fact) =>
          fact.content ===
            "the next step for the service that has to stay online is vendor validation." &&
          fact.factKind === "project_state" &&
          fact.scopeKind === "project" &&
          fact.category !== "personal" &&
          fact.subject === "service that has to stay online",
      ),
    ).toBe(true);
    expect(
      references.some(
        (reference) =>
          reference.pointer === "docs/release-quality-runbook.md" &&
          reference.referenceKind === "source_of_truth" &&
          reference.subject === "release quality program",
      ),
    ).toBe(true);
  });

  it("writes Chinese durable memory through the public API", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    const result = await memory.remember({
      scope: { userId: "u-zh", sessionId: "s-1", workspaceId: "workspace-zh" },
      messages: [
        {
          role: "user",
          content: "请记住迁移流程目前仍然被审批阻塞。",
        },
        {
          role: "user",
          content: "请以后优先使用要点列表回复。",
        },
        {
          role: "user",
          content: "以docs/migration-runbook.md为准。",
        },
      ],
    });

    expect(result.accepted).toBe(3);
    expect(result.metadata?.locale).toBe("zh-CN");
    expect(await documentStore.query("facts", { userId: "u-zh" })).toHaveLength(1);
    expect(await documentStore.query("feedback", { userId: "u-zh" })).toHaveLength(1);
    expect(await documentStore.query("references", { userId: "u-zh" })).toHaveLength(1);
  });

  it("persists Chinese work-location phrasing as location instead of organization", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    await memory.remember({
      scope: { userId: "u-zh-profile", sessionId: "s-1", workspaceId: "workspace-zh" },
      messages: [
        {
          role: "user",
          content: "我在北京工作。我是后端工程师。",
        },
      ],
    });

    const profiles = await documentStore.query<{
      userId: string;
      identity: {
        role?: string;
        organization?: string;
        location?: string;
      };
    }>("profiles", { userId: "u-zh-profile" });

    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.identity.location).toBe("北京");
    expect(profiles[0]?.identity.role).toBe("后端工程师");
    expect(profiles[0]?.identity.organization).toBeUndefined();
  });

  it("does not create an episode for trivial Chinese assistant acknowledgements", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    const result = await memory.remember({
      scope: { userId: "u-zh-ack", sessionId: "s-1", workspaceId: "workspace-zh" },
      messages: [
        {
          role: "user",
          content: "请记住迁移流程目前仍然被审批阻塞。",
        },
        {
          role: "assistant",
          content: "好的。",
        },
      ],
    });

    expect(result.accepted).toBe(1);
    expect(
      await documentStore.query("episodes", {
        userId: "u-zh-ack",
        workspaceId: "workspace-zh",
      }),
    ).toHaveLength(0);
  });

  it("supersedes stale Chinese reference memory when the user corrects the source of truth", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    await memory.remember({
      scope: { userId: "u-zh-ref", workspaceId: "workspace-zh", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "迁移流程以docs/old-runbook.md为准。",
        },
      ],
    });

    await memory.remember({
      scope: { userId: "u-zh-ref", workspaceId: "workspace-zh", sessionId: "s-2" },
      messages: [
        {
          role: "user",
          content: "现在以docs/new-runbook.md为准，不再以docs/old-runbook.md为准。",
        },
      ],
    });

    const references = await documentStore.query<{
      pointer: string;
      lifecycle: string;
      subject?: string;
    }>("references", {
      userId: "u-zh-ref",
      workspaceId: "workspace-zh",
    });

    expect(
      references.some(
        (reference) =>
          reference.pointer === "docs/old-runbook.md" &&
          reference.lifecycle === "superseded",
      ),
    ).toBe(true);
    expect(
      references.some(
        (reference) =>
          reference.pointer === "docs/new-runbook.md" &&
          reference.lifecycle === "active" &&
          reference.subject === "迁移流程",
      ),
    ).toBe(true);
  });
});
