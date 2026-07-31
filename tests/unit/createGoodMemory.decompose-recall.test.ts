import { describe, expect, it } from "bun:test";
import {
  createEnglishLanguagePack,
  createGoodMemory,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src";
import { createFactMemory } from "../../src/domain/records";
import { createEvidenceRecord } from "../../src/evidence/contracts";

// Planned decomposition remains an experimental opt-in until its promotion
// gate is accepted. The public default stays on the unplanned single pass.
describe("GoodMemory.recall decompose option", () => {
  const scope = { userId: "u-1", workspaceId: "workspace-a" };

  function buildMemory(recallPlanExecution: boolean) {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const memory = createGoodMemory({
      adapters: { documentStore, sessionStore, vectorStore },
      retrieval: { recallPlanExecution },
      storage: { provider: "memory" },
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

  it("uses planned facets only when experimental execution is enabled", async () => {
    const { documentStore, makeFact, memory } = buildMemory(true);
    const facts = [
      makeFact("db", "My production database is PostgreSQL."),
      makeFact("editor", "My preferred code editor is Neovim."),
      makeFact("noise-1", "The quarterly budget review is on Friday."),
      makeFact("noise-2", "Standup happens at 9am daily."),
    ];
    for (const fact of facts) {
      await documentStore.set("facts", fact.id, fact);
    }
    const query = "What database do I use and which code editor do I prefer?";

    const single = await memory.recall({
      scope,
      query,
      strategy: "rules-only",
      decompose: false,
    });
    const singleIds = single.facts.map((fact) => fact.id);

    const decomposed = await memory.recall({
      scope,
      query,
      strategy: "rules-only",
    });
    const decomposedIds = decomposed.facts.map((fact) => fact.id);

    // Both topic-specific facts are retrieved through their focused sub-queries.
    expect(decomposedIds).toContain("db");
    expect(decomposedIds).toContain("editor");
    expect(decomposed.metadata.policyApplied).toContain("decomposed_recall");
    expect(single.metadata.policyApplied).not.toContain("decomposed_recall");
    expect(single.metadata.retrievalTrace).toMatchObject({
      schemaVersion: 2,
      stopReason: "single_pass_complete",
      subQueries: [],
    });
    const retrievalTrace = decomposed.metadata.retrievalTrace;
    const recallPlan = retrievalTrace?.schemaVersion === 2
      ? retrievalTrace.plan
      : undefined;
    expect(decomposed.metadata.retrievalTrace).toMatchObject({
      schemaVersion: 2,
      stopReason: "decomposition_complete",
      subQueries: ["What database do I use", "which code editor do I prefer"],
      queryExecutions: [
        expect.objectContaining({ query, role: "primary" }),
        expect.objectContaining({
          query: "What database do I use",
          role: "subquery",
          subQueryIndex: 0,
        }),
        expect.objectContaining({
          query: "which code editor do I prefer",
          role: "subquery",
          subQueryIndex: 1,
        }),
      ],
    });
    expect(recallPlan).toMatchObject({
      maxRenderedTokens: 6_000,
      preRankLimit: 32,
      selectedLimit: 12,
    });
    // The union never drops what the single recall already found.
    for (const id of singleIds) {
      expect(decomposedIds).toContain(id);
    }
    expect(decomposedIds.length).toBeGreaterThanOrEqual(singleIds.length);
    // The packet is re-rendered over the union, so it reflects the merged facts.
    expect(decomposed.packet).toBeDefined();
    expect(decomposed.packet.renderBudget).toEqual({ maxTokens: 6_000 });
  });

  it("keeps query-plan execution behind the experimental retrieval option", async () => {
    const { documentStore, makeFact, memory } = buildMemory(false);
    for (const fact of [
      makeFact("db", "My production database is PostgreSQL."),
      makeFact("editor", "My preferred code editor is Neovim."),
    ]) {
      await documentStore.set("facts", fact.id, fact);
    }

    const result = await memory.recall({
      scope,
      query: "What database do I use and which code editor do I prefer?",
      strategy: "rules-only",
    });

    expect(result.metadata.policyApplied).not.toContain("decomposed_recall");
    expect(result.metadata.retrievalTrace).toMatchObject({
      schemaVersion: 2,
      stopReason: "single_pass_complete",
      subQueries: [],
    });
  });

  it("honors an explicit decomposition override without enabling planned retrieval", async () => {
    const { documentStore, makeFact, memory } = buildMemory(false);
    for (const fact of [
      makeFact("db", "My production database is PostgreSQL."),
      makeFact("editor", "My preferred code editor is Neovim."),
    ]) {
      await documentStore.set("facts", fact.id, fact);
    }

    const result = await memory.recall({
      scope,
      query: "What database do I use and which code editor do I prefer?",
      strategy: "rules-only",
      decompose: true,
    });

    expect(result.metadata.policyApplied).toContain("decomposed_recall");
    expect(result.metadata.retrievalTrace).toMatchObject({
      schemaVersion: 2,
      stopReason: "decomposition_complete",
      subQueries: ["What database do I use", "which code editor do I prefer"],
    });
  });

  it("executes temporal operands but leaves ordinary alternatives single-pass", async () => {
    const { memory } = buildMemory(false);

    const temporal = await memory.recall({
      scope,
      query:
        "Which event happened first, the laptop repair or the router replacement?",
      strategy: "rules-only",
      decompose: true,
    });
    expect(temporal.metadata.retrievalTrace).toMatchObject({
      schemaVersion: 2,
      stopReason: "decomposition_complete",
      subQueries: ["the laptop repair", "the router replacement"],
    });
    const temporalTrace = temporal.metadata.retrievalTrace;
    expect(
      temporalTrace?.schemaVersion === 2
        ? temporalTrace.queryExecutions
        : [],
    ).toHaveLength(3);

    const ordinary = await memory.recall({
      scope,
      query: "Which database should I use, PostgreSQL or SQLite?",
      strategy: "rules-only",
      decompose: true,
    });
    expect(ordinary.metadata.policyApplied).not.toContain("decomposed_recall");
    expect(ordinary.metadata.retrievalTrace).toMatchObject({
      schemaVersion: 2,
      stopReason: "single_pass_complete",
      subQueries: [],
    });

    const advice = await memory.recall({
      scope,
      query: "Which task should I do first, deploy backend or update docs?",
      strategy: "rules-only",
      decompose: true,
    });
    expect(advice.metadata.retrievalTrace).toMatchObject({
      schemaVersion: 2,
      stopReason: "single_pass_complete",
      subQueries: [],
    });
  });

  it("replans each facet so temporal intent does not leak between subqueries", async () => {
    const { memory } = buildMemory(true);

    const result = await memory.recall({
      scope,
      query: "What changed for Atlas and what is my current blocker?",
      strategy: "rules-only",
    });
    const trace = result.metadata.retrievalTrace;
    const executions = trace?.schemaVersion === 2
      ? trace.queryExecutions
      : [];

    expect(executions[1]?.plan?.aggregation).toBe("change");
    expect(executions[2]?.plan?.aggregation).toBe("current");
    expect(executions[2]?.plan?.temporalConstraints).toEqual([
      expect.objectContaining({ kind: "current" }),
    ]);
  });

  it("reuses the parent locale for every decomposed recall pass", async () => {
    const detectedTexts: string[] = [];
    const query =
      "現在のブロッカーは何ですか？そして過去のプロジェクト履歴は何ですか？";
    const memory = createGoodMemory({
      language: {
        detector: ({ texts }) => {
          const text = texts.join(" ");
          detectedTexts.push(text);
          return text.includes("そして") ? "ja-JP" : "en-US";
        },
        detectorVersion: "test-detector-v1",
      },
      retrieval: { recallPlanExecution: true },
      storage: { provider: "memory" },
    });

    const result = await memory.recall({ query, scope, strategy: "rules-only" });

    expect(result.metadata.retrievalTrace).toMatchObject({
      schemaVersion: 2,
      subQueries: [
        "現在のブロッカーは何ですか",
        "過去のプロジェクト履歴は何ですか",
      ],
    });
    expect(detectedTexts).toEqual([query]);
  });

  it("deduplicates assisted facets with the configured LanguagePack equality semantics", async () => {
    const english = createEnglishLanguagePack();
    const memory = createGoodMemory({
      adapters: {
        recallPlanner: {
          async plan() {
            return {
              entities: ["Atlas"],
              facets: ["Atlas colour choice", "Atlas color choice"],
            };
          },
        },
      },
      language: {
        packs: [{
          ...english,
          analyzerVersion: "custom-equality-v1",
          normalizeForEquality(text) {
            return english.normalizeForEquality(text).replaceAll(
              "colour",
              "color",
            );
          },
        }],
      },
      retrieval: { recallPlanExecution: true },
      storage: { provider: "memory" },
    });

    const result = await memory.recall({
      scope,
      query: "What changed for Atlas?",
      strategy: "rules-only",
    });

    expect(result.metadata.retrievalTrace).toMatchObject({
      schemaVersion: 2,
      subQueries: ["Atlas colour choice"],
    });
  });

  it("keeps the configured LanguagePack behavior when merged recall rebuilds the packet", async () => {
    const english = createEnglishLanguagePack();
    let packetRenderCount = 0;
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      language: {
        packs: [{
          ...english,
          analyzerVersion: "custom-content-analysis-v1",
          analyzeContent(text) {
            return {
              ...english.analyzeContent(text),
              blockerFact: text.includes("ZETA"),
            };
          },
          render(input) {
            if (input.key === "active_context") {
              packetRenderCount += 1;
            }
            return english.render(input);
          },
        }],
      },
      retrieval: { recallPlanExecution: true },
      storage: { provider: "memory" },
    });
    const fact = createFactMemory({
      id: "zeta-support",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      category: "project",
      content: "ZETA handoff signal.",
      source: {
        method: "explicit",
        extractedAt: "2026-01-01T00:00:00.000Z",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await documentStore.set("facts", fact.id, fact);

    const result = await memory.recall({
      scope,
      query: "What is my current role, and what should I do next for ZETA?",
      strategy: "rules-only",
    });

    expect(result.metadata.policyApplied).toContain("decomposed_recall");
    expect(packetRenderCount).toBe(4);
    expect(result.packet.languagePackId).toBe("en");
    expect(result.metadata.languagePackVersion).toBe(
      "custom-content-analysis-v1",
    );
    expect(result.packet.factSummary).toContain("Immediate next-step support:");
    expect(result.packet.factSummary).not.toContain("Additional project state:");
  });

  it("keeps merged evidence complete while deduping excerpts in the rebuilt packet", async () => {
    const { documentStore, makeFact, memory } = buildMemory(true);
    for (const fact of [
      makeFact("db", "My production database is PostgreSQL."),
      makeFact("editor", "My preferred code editor is Neovim."),
    ]) {
      await documentStore.set("facts", fact.id, fact);
    }
    for (const [id, linkedMemoryId, excerpt, extractedAt] of [
      ["evidence-db-repeat", "db", "Repeated preference evidence.", "2026-01-05T00:00:00.000Z"],
      ["evidence-editor-repeat", "editor", "Repeated preference evidence.", "2026-01-04T00:00:00.000Z"],
      ["evidence-db", "db", "PostgreSQL is the production database.", "2026-01-03T00:00:00.000Z"],
      ["evidence-editor", "editor", "Neovim is the preferred editor.", "2026-01-02T00:00:00.000Z"],
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
      query: "What database do I use and which code editor do I prefer?",
      strategy: "rules-only",
      includeEvidence: true,
    });

    expect(result.evidence).toHaveLength(4);
    expect(result.packet.evidenceSummary?.match(/Repeated preference evidence\./gu)).toHaveLength(1);
    expect(result.packet.evidenceSummary).toContain("PostgreSQL is the production database.");
    expect(result.packet.evidenceSummary).toContain("Neovim is the preferred editor.");
  });

  it("is a no-op for a single-part query (no decomposition marker)", async () => {
    const { documentStore, makeFact, memory } = buildMemory(true);
    const fact = makeFact("home", "I live in Seattle.");
    await documentStore.set("facts", fact.id, fact);

    const result = await memory.recall({
      scope,
      query: "Where do I live?",
      strategy: "rules-only",
      decompose: true,
    });
    expect(result.metadata.policyApplied).not.toContain("decomposed_recall");
    expect(result.metadata.retrievalTrace).toMatchObject({
      schemaVersion: 2,
      stopReason: "single_pass_complete",
      subQueries: [],
    });
  });
});
