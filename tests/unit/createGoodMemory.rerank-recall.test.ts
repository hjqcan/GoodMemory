import { describe, expect, it } from "bun:test";
import {
  createEnglishLanguagePack,
  createGoodMemory,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
  type Reranker,
} from "../../src";
import { createFactMemory } from "../../src/domain/records";
import { createEvidenceRecord } from "../../src/evidence/contracts";
import {
  mergeDurableCandidateOrder,
  resolveRerankerTopK,
  sanitizeRerankerGateway,
} from "../../src/api/recallReranking";

// The reranker adapter is opt-in: configure one and recalled facts are reranked
// over their top-K window (packet re-rendered); omit it and recall is unchanged.
describe("GoodMemory.recall reranker adapter", () => {
  const scope = { userId: "u-1", workspaceId: "workspace-a" };
  const query = "alpha topic";

  it("removes credentials and query data from the traced gateway", () => {
    expect(
      sanitizeRerankerGateway(
        "https://user:password@ai.gurkiai.com/v1/?token=secret#fragment",
      ),
    ).toBe("https://ai.gurkiai.com/v1");
  });

  it("preserves non-fact durable slots while applying the new fact order", () => {
    expect(
      mergeDurableCandidateOrder({
        factIdsAfter: ["fact-b", "fact-a"],
        factIdsBefore: ["fact-a", "fact-b"],
        originalOrder: ["reference-1", "fact-a", "archive-1", "fact-b"],
      }),
    ).toEqual(["reference-1", "fact-b", "archive-1", "fact-a"]);
  });

  it("caps the first-party listwise window while preserving pointwise defaults", () => {
    expect(
      resolveRerankerTopK({
        candidateCount: 80,
        target: {
          adapter: "provider",
          candidateLimit: 32,
          strategy: "listwise",
        },
      }),
    ).toBe(32);
    expect(
      resolveRerankerTopK({
        candidateCount: 80,
        target: { adapter: "provider", strategy: "pointwise" },
      }),
    ).toBeUndefined();
  });

  // Promotes fact-b above its first-stage position regardless of original order.
  const promoteBReranker: Reranker = {
    async rerank({ documents }) {
      return documents.map((document) => ({
        id: document.id,
        score: document.id === "fact-b" ? 1 : 0,
      }));
    },
  };

  function buildMemory(reranker?: Reranker) {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const memory = createGoodMemory({
      adapters: { documentStore, sessionStore, vectorStore, reranker },
      storage: { provider: "memory" },
      testing: { now: () => new Date("2026-01-02T00:00:00.000Z") },
    });
    const makeFact = (id: string, content: string) =>
      createFactMemory({
        id,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "project",
        content,
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    return { documentStore, makeFact, memory };
  }

  async function seed(documentStore: ReturnType<typeof createInMemoryDocumentStore>, makeFact: (id: string, content: string) => ReturnType<typeof createFactMemory>) {
    for (const fact of [
      makeFact("fact-a", "alpha topic update one"),
      makeFact("fact-b", "alpha topic detail two"),
      makeFact("fact-c", "alpha topic note three"),
    ]) {
      await documentStore.set("facts", fact.id, fact);
    }
  }

  it("reorders facts and marks the recall as reranked when configured", async () => {
    const { documentStore, makeFact, memory } = buildMemory(promoteBReranker);
    await seed(documentStore, makeFact);

    const result = await memory.recall({ scope, query, strategy: "rules-only" });
    const ids = result.facts.map((fact) => fact.id);
    // fact-b is promoted above fact-a, reversing the first-stage order.
    expect(ids.indexOf("fact-b")).toBeLessThan(ids.indexOf("fact-a"));
    expect(result.metadata.policyApplied).toContain("reranked");
    expect(result.metadata.retrievalTrace?.reranker).toMatchObject({
      adapter: "custom",
      candidateCount: 3,
      role: "reranker",
      status: "applied",
    });
    expect(result.metadata.retrievalTrace?.reranker?.scores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memoryId: "fact-b",
          rankAfter: 1,
          score: 1,
        }),
      ]),
    );
    expect(result.packet.renderBudget).toEqual({ maxTokens: 6_000 });
  });

  it("keeps the configured LanguagePack when reranking rebuilds the packet", async () => {
    const english = createEnglishLanguagePack();
    let packetRenderCount = 0;
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        reranker: promoteBReranker,
        sessionStore: createInMemorySessionStore(),
      },
      language: {
        packs: [{
          ...english,
          analyzerVersion: "custom-rerank-render-v1",
          render(input) {
            if (input.key === "active_context") {
              packetRenderCount += 1;
            }
            return english.render(input);
          },
        }],
      },
      storage: { provider: "memory" },
      testing: { now: () => new Date("2026-01-02T00:00:00.000Z") },
    });
    const makeFact = (id: string, content: string) =>
      createFactMemory({
        id,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "project",
        content,
        source: {
          method: "explicit",
          extractedAt: "2026-01-01T00:00:00.000Z",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    await seed(documentStore, makeFact);

    const result = await memory.recall({ scope, query, strategy: "rules-only" });

    expect(result.metadata.policyApplied).toContain("reranked");
    expect(result.metadata.languagePackVersion).toBe(
      "custom-rerank-render-v1",
    );
    expect(packetRenderCount).toBe(2);
  });

  it("lets the reranker change final membership over the global pre-rank pool", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
        reranker: {
          async rerank({ documents }) {
            return documents.map(({ id }) => ({
              id,
              score: id === "fact-15" ? 1 : 0,
            }));
          },
        },
      },
      retrieval: { preset: "recommended" },
      testing: { now: () => new Date("2026-01-02T00:00:00.000Z") },
    });
    for (let index = 1; index <= 15; index += 1) {
      const id = `fact-${String(index).padStart(2, "0")}`;
      await documentStore.set("facts", id, createFactMemory({
        id,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "project",
        content: `alpha topic shared detail ${index}`,
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }));
    }

    const result = await memory.recall({ scope, query, strategy: "hybrid" });

    expect(result.facts).toHaveLength(12);
    expect(result.facts[0]?.id).toBe("fact-15");
    expect(result.metadata.retrievalTrace?.reranker?.candidateCount).toBe(15);
    expect(result.metadata.retrievalTrace?.reranker?.scores).toContainEqual(
      expect.objectContaining({ memoryId: "fact-15", rankAfter: 1 }),
    );
  });

  it("includes supplementary RecallPlan candidates in the global reranker pool", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
        recallPlanner: {
          async plan() {
            return {
              entities: ["Needle"],
              facets: ["Needle facet"],
            };
          },
        },
        reranker: {
          async rerank({ documents }) {
            return documents.map(({ id }) => ({
              id,
              score: id === "supplementary-target" ? 1 : 0,
            }));
          },
        },
      },
      retrieval: {
        preset: "recommended",
        recallPlanExecution: true,
      },
      testing: { now: () => new Date("2026-01-02T00:00:00.000Z") },
    });
    for (let index = 1; index <= 40; index += 1) {
      const id = `primary-${String(index).padStart(2, "0")}`;
      await documentStore.set("facts", id, createFactMemory({
        id,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "project",
        content: `overview alpha distractor ${index}`,
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }));
    }
    await documentStore.set("facts", "supplementary-target", createFactMemory({
      id: "supplementary-target",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      category: "project",
      content: "needle facet singular answer",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));

    const result = await memory.recall({
      scope,
      query: "current overview alpha",
      strategy: "hybrid",
    });

    expect(result.metadata.policyApplied).toContain("decomposed_recall");
    expect(result.metadata.retrievalTrace?.reranker?.candidateCount).toBe(32);
    expect(result.metadata.retrievalTrace?.reranker?.scores).toContainEqual(
      expect.objectContaining({
        memoryId: "supplementary-target",
        rankAfter: 1,
      }),
    );
    expect(result.facts[0]?.id).toBe("supplementary-target");
  });

  it("keeps primary top evidence in the global reranker pool when facets repeat distractors", async () => {
    const documentStore = createInMemoryDocumentStore();
    let candidateIds: string[] = [];
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
        recallPlanner: {
          async plan() {
            return {
              entities: ["Needle"],
              facets: ["Needle facet one", "Needle facet two"],
            };
          },
        },
        reranker: {
          async rerank({ documents }) {
            candidateIds = documents.map(({ id }) => id);
            return documents.map(({ id }) => ({
              id,
              score: id === "supplementary-target" ? 1 : 0,
            }));
          },
        },
      },
      retrieval: {
        preset: "recommended",
        recallPlanExecution: true,
      },
      testing: { now: () => new Date("2026-01-02T00:00:00.000Z") },
    });

    for (let index = 1; index <= 12; index += 1) {
      const id = `primary-${String(index).padStart(2, "0")}`;
      await documentStore.set("facts", id, createFactMemory({
        id,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "project",
        content: `primary anchor evidence ${index}`,
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }));
    }
    for (let index = 1; index <= 40; index += 1) {
      const id = index === 1
        ? "supplementary-target"
        : `supplementary-${String(index).padStart(2, "0")}`;
      await documentStore.set("facts", id, createFactMemory({
        id,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "project",
        content: index === 1
          ? "Needle facet one Needle facet two"
          : `Needle facet one facet two repeated distractor ${index}`,
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }));
    }

    const result = await memory.recall({
      scope,
      query: "current primary anchor",
      strategy: "hybrid",
    });

    expect(candidateIds).toHaveLength(32);
    for (let index = 1; index <= 12; index += 1) {
      expect(candidateIds).toContain(
        `primary-${String(index).padStart(2, "0")}`,
      );
    }
    expect(candidateIds).toContain("supplementary-target");
    expect(result.facts[0]?.id).toBe("supplementary-target");
  });

  it("keeps complete requested evidence without letting duplicate excerpts consume packet slots", async () => {
    const { documentStore, makeFact, memory } = buildMemory(promoteBReranker);
    await seed(documentStore, makeFact);
    for (const [id, linkedMemoryId, excerpt, extractedAt] of [
      ["evidence-a-new", "fact-a", "Repeated alpha evidence.", "2026-01-05T00:00:00.000Z"],
      ["evidence-a-old", "fact-a", "Repeated alpha evidence.", "2026-01-04T00:00:00.000Z"],
      ["evidence-b", "fact-b", "Unique beta evidence.", "2026-01-03T00:00:00.000Z"],
      ["evidence-c", "fact-c", "Unique gamma evidence.", "2026-01-02T00:00:00.000Z"],
    ] as const) {
      await documentStore.set("evidence", id, createEvidenceRecord({
        id,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        kind: "conversation_excerpt",
        excerpt,
        source: { method: "explicit", extractedAt },
        linkedMemoryIds: [linkedMemoryId],
      }));
    }

    const result = await memory.recall({
      scope,
      query,
      strategy: "rules-only",
      includeEvidence: true,
    });

    expect(result.evidence).toHaveLength(4);
    expect(result.packet.evidenceSummary?.match(/Repeated alpha evidence\./gu)).toHaveLength(1);
    expect(result.packet.evidenceSummary).toContain("Unique beta evidence.");
    expect(result.packet.evidenceSummary).toContain("Unique gamma evidence.");
  });

  it("is a no-op when no reranker is configured", async () => {
    const { documentStore, makeFact, memory } = buildMemory();
    await seed(documentStore, makeFact);

    const result = await memory.recall({ scope, query, strategy: "rules-only" });
    const ids = result.facts.map((fact) => fact.id);
    // Baseline first-stage order keeps fact-a ahead of fact-b.
    expect(ids.indexOf("fact-a")).toBeLessThan(ids.indexOf("fact-b"));
    expect(result.metadata.policyApplied).not.toContain("reranked");
    expect(result.metadata.retrievalTrace).toMatchObject({
      schemaVersion: 2,
      stopReason: "single_pass_complete",
      subQueries: [],
    });
    expect(result.metadata.retrievalTrace?.reranker).toBeUndefined();
  });

  it("can be disabled per call with rerank: false", async () => {
    const { documentStore, makeFact, memory } = buildMemory(promoteBReranker);
    await seed(documentStore, makeFact);

    const result = await memory.recall({
      scope,
      query,
      strategy: "rules-only",
      rerank: false,
    });
    expect(result.metadata.policyApplied).not.toContain("reranked");
    expect(result.metadata.retrievalTrace?.reranker).toMatchObject({
      adapter: "custom",
      fallbackReason: "disabled",
      role: "reranker",
      status: "skipped",
    });
  });

  it("does not call the reranker when fewer than two facts survive recall", async () => {
    let calls = 0;
    const { documentStore, makeFact, memory } = buildMemory({
      async rerank() {
        calls += 1;
        return [];
      },
    });
    const fact = makeFact("only-fact", "alpha topic only fact");
    await documentStore.set("facts", fact.id, fact);

    const result = await memory.recall({
      scope,
      query,
      strategy: "rules-only",
    });

    expect(calls).toBe(0);
    expect(result.metadata.retrievalTrace?.reranker).toMatchObject({
      candidateCount: 1,
      fallbackReason: "insufficient_candidates",
      status: "skipped",
    });
  });

  it("preserves deterministic recall when the reranker fails", async () => {
    const baseline = buildMemory();
    const failing = buildMemory({
      async rerank() {
        throw new Error("provider unavailable");
      },
    });
    await seed(baseline.documentStore, baseline.makeFact);
    await seed(failing.documentStore, failing.makeFact);

    const baselineResult = await baseline.memory.recall({
      scope,
      query,
      strategy: "rules-only",
    });
    const fallbackResult = await failing.memory.recall({
      scope,
      query,
      strategy: "rules-only",
    });

    expect(fallbackResult.facts).toEqual(baselineResult.facts);
    expect(fallbackResult.packet).toEqual(baselineResult.packet);
    expect(fallbackResult.metadata.policyApplied).toContain("reranker_fallback");
    expect(fallbackResult.metadata.retrievalTrace?.reranker).toMatchObject({
      adapter: "custom",
      candidateCount: 3,
      fallbackReason: "adapter_error",
      role: "reranker",
      status: "fallback",
    });
  });
});
