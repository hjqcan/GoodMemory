import { describe, expect, it } from "bun:test";
import { createFactMemory } from "../../src/domain/records";
import { createRecallEngine } from "../../src/recall/engine";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src/storage/memory";
import { createMemoryRepositories } from "../../src/storage/repositories";

describe("recall engine", () => {
  it("captures the clock when the engine is created", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const config = {
      now: () => 100,
      repositories: createMemoryRepositories({
        documentStore,
        sessionStore,
      }),
      runtime: sessionStore,
    };
    const engine = createRecallEngine(config);
    config.now = () => 999;

    const result = await engine.recall({
      ignoreMemory: true,
      query: "What changed?",
      scope: { userId: "u-clock", workspaceId: "workspace-a" },
    });

    expect(result.metadata.latencyMs).toBe(0);
  });

  it("keeps fact selector overrides instance-scoped", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore,
    });
    const fact = createFactMemory({
      id: "fact-atlas-status",
      userId: "u-selector",
      workspaceId: "workspace-a",
      category: "project",
      content: "Atlas rollout status is active.",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await repositories.facts.add(fact);
    const overridden = createRecallEngine({
      factSelector: () => ({ facts: [], traces: [] }),
      repositories,
      runtime: sessionStore,
    });
    const defaultEngine = createRecallEngine({
      repositories,
      runtime: sessionStore,
    });
    const input = {
      scope: { userId: "u-selector", workspaceId: "workspace-a" },
      query: "What is the Atlas rollout status?",
      retrievalProfile: "general_chat" as const,
      strategy: "rules-only" as const,
    };

    expect((await overridden.recall(input)).facts).toEqual([]);
    expect((await defaultEngine.recall(input)).facts.map(({ id }) => id)).toContain(
      fact.id,
    );
  });

  it("uses repositories.vectorIndex by default so legacy engine wiring still enables hybrid recall", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore,
      vectorStore,
    });
    const query = "What is the current blocker?";
    const wrongFact = createFactMemory({
      id: "fact-wrong",
      userId: "u-1",
      workspaceId: "workspace-a",
      category: "project",
      factKind: "blocker",
      content: "The current blocker is vendor approval for the runtime dashboard.",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const rightFact = createFactMemory({
      id: "fact-right",
      userId: "u-1",
      workspaceId: "workspace-a",
      category: "project",
      factKind: "blocker",
      content: "The current blocker is service account rotation for migration rollout.",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const embeddingByText = new Map<string, number[]>([
      [query, [1, 0, 0]],
      [wrongFact.content, [0, 1, 0]],
      [rightFact.content, [1, 0, 0]],
    ]);
    const embeddingAdapter = {
      async embed(texts: string[]) {
        return texts.map((text) => embeddingByText.get(text) ?? [0, 0, 0]);
      },
    };
    const engine = createRecallEngine({
      repositories,
      runtime: sessionStore,
      embedding: embeddingAdapter,
    });

    await repositories.facts.add(wrongFact);
    await repositories.facts.add(rightFact);
    await repositories.vectorIndex!.upsertFactEmbedding([
      {
        id: wrongFact.id,
        embedding: embeddingByText.get(wrongFact.content)!,
        metadata: {
          userId: "u-1",
          workspaceId: "workspace-a",
          memoryType: "fact",
        },
        content: wrongFact.content,
      },
      {
        id: rightFact.id,
        embedding: embeddingByText.get(rightFact.content)!,
        metadata: {
          userId: "u-1",
          workspaceId: "workspace-a",
          memoryType: "fact",
        },
        content: rightFact.content,
      },
    ]);

    const result = await engine.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query,
      retrievalProfile: "general_chat",
      strategy: "hybrid",
    });

    expect(result.metadata.routingDecision.strategy).toBe("hybrid");
    expect(result.metadata.routingDecision.strategyExplanation.semanticTieBreaking).toBe(true);
    expect(result.facts[0]?.id).toBe("fact-right");
  });
});
