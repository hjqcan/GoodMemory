import { describe, expect, it } from "bun:test";

import {
  createEpisodeMemory,
  createFactMemory,
  createReferenceMemory,
} from "../../src/domain/records";
import type { EmbeddingAdapter } from "../../src/embedding/contracts";
import { createSessionArchive } from "../../src/evolution/contracts";
import {
  createRecallEngine,
  resolveActiveGeneralizedFusionConfig,
  resolveGeneralizedFusionBudget,
} from "../../src/recall/engine";
import { createRecallProjectionRuntime } from "../../src/recall/projections/runtime";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src/storage/memory";
import { createMemoryRepositories } from "../../src/storage/repositories";

const QUERY = "What helps you relax in the evenings?";
const scope = { userId: "user-1", workspaceId: "workspace-1" };

function createFixedEmbeddingAdapter(): EmbeddingAdapter {
  return {
    async embed(texts) {
      return texts.map((text) => {
        if (text === QUERY) {
          return [1, 0, 0];
        }
        if (text.toLowerCase().includes("fishing")) {
          return [0.95, 0.05, 0];
        }
        return [0, 1, 0];
      });
    },
  };
}

describe("generalized fusion through the recall engine", () => {
  it("uses the wider fusion budget only when reranking is enabled", () => {
    const base = { maxCandidates: 8, maxTotalFacts: 10 };
    const reranking = { maxCandidates: 20, maxTotalFacts: 20 };

    expect(
      resolveActiveGeneralizedFusionConfig({
        base,
        rerank: true,
        reranking,
      }),
    ).toBe(reranking);
    expect(
      resolveActiveGeneralizedFusionConfig({
        base,
        rerank: false,
        reranking,
      }),
    ).toBe(base);
  });

  it("keeps an explicit reranker candidate budget wider than the final selection default", () => {
    expect(resolveGeneralizedFusionBudget({
      base: { maxCandidates: 20, maxTotalFacts: 20 },
      plan: {
        entities: [],
        facets: [],
        temporalConstraints: [],
        evidenceNeeds: ["direct"],
        planes: ["semantic"],
        maxHops: 1,
        preRankLimit: 32,
        selectedLimit: 12,
        maxRenderedTokens: 1_200,
        uncertainty: "low",
      },
    })).toMatchObject({
      maxCandidates: 20,
      maxTotalFacts: 20,
    });
  });

  it("uses indexed text search instead of a full projection scan for ordinary recall", async () => {
    const rawStore = createInMemoryDocumentStore();
    const projectionRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-10T00:00:00.000Z",
    });
    let fullScans = 0;
    let searches = 0;
    const projectionIndex = {
      ...projectionRuntime,
      queryDocuments(scopeInput: typeof scope) {
        fullScans += 1;
        return projectionRuntime.queryDocuments(scopeInput);
      },
      queryEntities(scopeInput: typeof scope) {
        fullScans += 1;
        return projectionRuntime.queryEntities(scopeInput);
      },
      queryClaims(scopeInput: typeof scope) {
        fullScans += 1;
        return projectionRuntime.queryClaims(scopeInput);
      },
      queryClaimHistory(scopeInput: typeof scope) {
        fullScans += 1;
        return projectionRuntime.queryClaimHistory(scopeInput);
      },
      searchDocuments(scopeInput: typeof scope, query: string, limit: number) {
        searches += 1;
        return projectionRuntime.searchDocuments(scopeInput, query, limit);
      },
    };
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore: projectionRuntime.documentStore,
      sessionStore,
    });
    let canonicalFullScans = 0;
    const factListByScope = repositories.facts.listByScope.bind(repositories.facts);
    repositories.facts.listByScope = (scopeInput) => {
      canonicalFullScans += 1;
      return factListByScope(scopeInput);
    };
    const referenceListByScope = repositories.references.listByScope.bind(
      repositories.references,
    );
    repositories.references.listByScope = (scopeInput) => {
      canonicalFullScans += 1;
      return referenceListByScope(scopeInput);
    };
    const episodeListByScope = repositories.episodes.listByScope.bind(
      repositories.episodes,
    );
    repositories.episodes.listByScope = (scopeInput) => {
      canonicalFullScans += 1;
      return episodeListByScope(scopeInput);
    };
    const archiveListByScope = repositories.archives.listByScope.bind(
      repositories.archives,
    );
    repositories.archives.listByScope = (scopeInput) => {
      canonicalFullScans += 1;
      return archiveListByScope(scopeInput);
    };
    const preferenceListByScope = repositories.preferences.listByScope.bind(
      repositories.preferences,
    );
    repositories.preferences.listByScope = (scopeInput) => {
      canonicalFullScans += 1;
      return preferenceListByScope(scopeInput);
    };
    const feedbackListByScope = repositories.feedback.listByScope.bind(
      repositories.feedback,
    );
    repositories.feedback.listByScope = (scopeInput) => {
      canonicalFullScans += 1;
      return feedbackListByScope(scopeInput);
    };
    const evidenceListByScope = repositories.evidence.listByScope.bind(
      repositories.evidence,
    );
    repositories.evidence.listByScope = (scopeInput) => {
      canonicalFullScans += 1;
      return evidenceListByScope(scopeInput);
    };
    await repositories.facts.add(createFactMemory({
      id: "fact-atlas",
      ...scope,
      category: "project",
      content: "Atlas deployment uses PostgreSQL.",
      source: { method: "explicit", extractedAt: "2026-07-09T00:00:00.000Z" },
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
    }));
    const engine = createRecallEngine({
      repositories,
      runtime: sessionStore,
      autoStrategyBias: "hybrid",
      generalizedFusion: { maxCandidates: 8 },
      projectionIndex,
    });

    await engine.recall({
      scope,
      query: "Which database does Atlas deployment use?",
      retrievalProfile: "general_chat",
    });

    expect(searches).toBe(1);
    expect(fullScans).toBe(0);
    expect(canonicalFullScans).toBe(0);
  });

  it("falls back to canonical recall without reading an incomplete projection", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-10T00:00:00.000Z",
    });
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore: runtime.documentStore,
      sessionStore,
    });
    await repositories.facts.add(createFactMemory({
      id: "fact-canonical-only",
      ...scope,
      category: "project",
      content: "Atlas deployment uses PostgreSQL.",
      source: { method: "explicit", extractedAt: "2026-07-09T00:00:00.000Z" },
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
    }));
    let projectionSearches = 0;
    const projectionIndex = {
      ...runtime,
      async ensureScopeIndexed() {
        return { complete: false, indexedSources: 0, skipped: false };
      },
      async searchDocuments() {
        projectionSearches += 1;
        return [];
      },
      async searchEntities() {
        projectionSearches += 1;
        return [];
      },
      async searchClaims() {
        projectionSearches += 1;
        return [];
      },
    };
    const engine = createRecallEngine({
      repositories,
      runtime: sessionStore,
      autoStrategyBias: "hybrid",
      generalizedFusion: { maxCandidates: 8 },
      projectionIndex,
    });

    const result = await engine.recall({
      scope,
      query: "Which database does Atlas deployment use?",
      retrievalProfile: "general_chat",
    });

    expect(projectionSearches).toBe(0);
    expect(result.facts.map(({ id }) => id)).toContain("fact-canonical-only");
    expect(result.metadata.retrievalTrace?.fusionRuns?.[0]).toMatchObject({
      fallbackReason: "projection_incomplete",
      projectionCoverage: "partial",
      status: "fallback",
    });
  });

  it("admits a fused dense candidate with generalized attribution and no parallel semantic bypass", async () => {
    const rawStore = createInMemoryDocumentStore();
    const projectionIndex = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-10T00:00:00.000Z",
    });
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore: projectionIndex.documentStore,
      sessionStore,
      vectorStore: createInMemoryVectorStore(),
    });
    const embedding = createFixedEmbeddingAdapter();
    const fact = createFactMemory({
      id: "fact-gold",
      ...scope,
      category: "personal",
      content: "Marco goes fishing at the lake to destress.",
      source: { method: "explicit", extractedAt: "2026-07-09T00:00:00.000Z" },
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
    });
    await repositories.facts.add(fact);
    const [factEmbedding] = await embedding.embed([fact.content]);
    await repositories.vectorIndex!.upsertFactEmbedding([
      {
        id: fact.id,
        embedding: factEmbedding,
        metadata: { ...scope, memoryType: "fact" },
        content: fact.content,
      },
    ]);
    const engine = createRecallEngine({
      repositories,
      runtime: sessionStore,
      embedding,
      autoStrategyBias: "hybrid",
      semanticCandidates: { topK: 4 },
      generalizedFusion: { maxCandidates: 4 },
      projectionIndex,
    });

    const result = await engine.recall({
      scope,
      query: QUERY,
      retrievalProfile: "general_chat",
    });

    expect(result.facts.map((candidate) => candidate.id)).toContain(fact.id);
    const trace = result.metadata.candidateTraces.find(
      (candidate) => candidate.memoryId === fact.id,
    );
    expect(trace?.fallback).toBe("generalized_fusion");
    expect(result.metadata.hits.find((hit) => hit.id === fact.id)?.reason).toBe(
      "generalized_fusion",
    );
    expect(JSON.stringify(result.metadata)).not.toContain('"fallback":"semantic_union"');
  });

  it("keeps provider dense candidates separate from BM25 additive scores", async () => {
    const rawStore = createInMemoryDocumentStore();
    const projectionIndex = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-10T00:00:00.000Z",
    });
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore: projectionIndex.documentStore,
      sessionStore,
      vectorStore: createInMemoryVectorStore(),
    });
    const embedding = createFixedEmbeddingAdapter();
    const lexical = createFactMemory({
      id: "fact-lexical",
      ...scope,
      category: "personal",
      content: "Evenings are relaxing and calm.",
      source: { method: "explicit", extractedAt: "2026-07-09T00:00:00.000Z" },
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
    });
    const dense = createFactMemory({
      id: "fact-dense",
      ...scope,
      category: "personal",
      content: "Marco goes fishing at the lake to destress.",
      source: { method: "explicit", extractedAt: "2026-07-09T00:00:00.000Z" },
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
    });
    await repositories.facts.add(lexical);
    await repositories.facts.add(dense);
    const embeddings = await embedding.embed([lexical.content, dense.content]);
    await repositories.vectorIndex!.upsertFactEmbedding([
      {
        id: lexical.id,
        embedding: embeddings[0]!,
        metadata: { ...scope, memoryType: "fact" },
        content: lexical.content,
      },
      {
        id: dense.id,
        embedding: embeddings[1]!,
        metadata: { ...scope, memoryType: "fact" },
        content: dense.content,
      },
    ]);
    const engine = createRecallEngine({
      repositories,
      runtime: sessionStore,
      embedding,
      autoStrategyBias: "hybrid",
      bm25Ranking: true,
      semanticCandidates: { topK: 4 },
      generalizedFusion: { maxCandidates: 4 },
      projectionIndex,
    });

    const result = await engine.recall({
      scope,
      query: QUERY,
      retrievalProfile: "general_chat",
    });

    expect(result.facts.map((candidate) => candidate.id)).toContain(dense.id);
    expect(
      result.metadata.candidateTraces.find(
        (candidate) => candidate.memoryId === dense.id,
      )?.fallback,
    ).toBe("generalized_fusion");
  });

  it("honors a configured minRelativeStrength when trimming the fused candidate budget", async () => {
    const rawStore = createInMemoryDocumentStore();
    const projectionIndex = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-10T00:00:00.000Z",
    });
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore: projectionIndex.documentStore,
      sessionStore,
    });
    await repositories.facts.add(
      createFactMemory({
        id: "fact-strong",
        ...scope,
        category: "personal",
        content: "A cup of tea helps Marco relax during quiet evenings.",
        source: { method: "explicit", extractedAt: "2026-07-09T00:00:00.000Z" },
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z",
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-weak",
        ...scope,
        category: "personal",
        content: "Grocery planning happens during evenings.",
        source: { method: "explicit", extractedAt: "2026-07-09T00:00:00.000Z" },
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z",
      }),
    );
    const recallInput = {
      scope,
      query: QUERY,
      retrievalProfile: "general_chat" as const,
    };
    const permissive = await createRecallEngine({
      repositories,
      runtime: sessionStore,
      autoStrategyBias: "hybrid",
      generalizedFusion: { maxCandidates: 8 },
      projectionIndex,
    }).recall(recallInput);
    const strict = await createRecallEngine({
      repositories,
      runtime: sessionStore,
      autoStrategyBias: "hybrid",
      generalizedFusion: { maxCandidates: 8, minRelativeStrength: 0.9 },
      projectionIndex,
    }).recall(recallInput);

    const permissiveRun = permissive.metadata.retrievalTrace?.fusionRuns?.[0];
    const strictRun = strict.metadata.retrievalTrace?.fusionRuns?.[0];
    expect(permissiveRun?.candidateCount).toBe(2);
    expect(permissiveRun?.budget).toBe(2);
    expect(strictRun?.candidateCount).toBe(2);
    expect(strictRun?.budget).toBe(1);
  });

  it("admits facts through projected retrieval cues without leaking them into context", async () => {
    const rawStore = createInMemoryDocumentStore();
    const projectionIndex = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-10T00:00:00.000Z",
    });
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore: projectionIndex.documentStore,
      sessionStore,
    });
    // Content shares no useful tokens with the query; only the write-time
    // retrieval cue bridges the phrasing gap.
    await repositories.facts.add(
      createFactMemory({
        id: "fact-handbook",
        ...scope,
        category: "project",
        content: "The infra handbook lives in the ops vault.",
        attributes: {
          retrievalCues:
            "Where is the deploy runbook kept?\nWhich document explains deployments?",
        },
        source: { method: "explicit", extractedAt: "2026-07-09T00:00:00.000Z" },
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z",
      }),
    );
    const engine = createRecallEngine({
      repositories,
      runtime: sessionStore,
      autoStrategyBias: "hybrid",
      generalizedFusion: { maxCandidates: 8 },
      projectionIndex,
    });

    const result = await engine.recall({
      scope,
      query: "Where is the deploy runbook kept?",
      retrievalProfile: "general_chat",
    });

    const fusedIds =
      result.metadata.retrievalTrace?.fusionRuns?.[0]?.candidates.map(
        (candidate) => candidate.sourceMemoryId,
      ) ?? [];
    expect(fusedIds).toContain("fact-handbook");
    // The cue is index-only: canonical fact content reaches the packet, the
    // cue text never does.
    const packetText = JSON.stringify(result.packet);
    expect(packetText).toContain("ops vault");
    expect(packetText).not.toContain("deploy runbook kept");
  });

  it("never applies the dynamic-budget floor to enumeration-count plans", async () => {
    const rawStore = createInMemoryDocumentStore();
    const projectionIndex = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-10T00:00:00.000Z",
    });
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore: projectionIndex.documentStore,
      sessionStore,
    });
    await repositories.facts.add(
      createFactMemory({
        id: "fact-strong-court",
        ...scope,
        category: "personal",
        content: "Marco booked the badminton court for the weekend games.",
        source: { method: "explicit", extractedAt: "2026-07-09T00:00:00.000Z" },
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z",
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-weak-court",
        ...scope,
        category: "personal",
        content: "Weekend plans sometimes include games.",
        source: { method: "explicit", extractedAt: "2026-07-09T00:00:00.000Z" },
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z",
      }),
    );
    const engine = createRecallEngine({
      repositories,
      runtime: sessionStore,
      autoStrategyBias: "hybrid",
      generalizedFusion: { maxCandidates: 8, minRelativeStrength: 0.9 },
      projectionIndex,
    });

    // Enumeration counts need breadth: every instance matters, so the floor
    // must not trim weak-but-real candidates (measured: count questions only
    // ever regressed under the floor).
    const countPlan = await engine.recall({
      scope,
      query: "How many weekend badminton games did Marco book?",
      retrievalProfile: "general_chat",
    });
    const countRun = countPlan.metadata.retrievalTrace?.fusionRuns?.[0];
    expect(countRun?.candidateCount).toBe(2);
    expect(countRun?.budget).toBe(2);

    // Precision questions keep the configured floor.
    const directPlan = await engine.recall({
      scope,
      query: "Which court did Marco book for the weekend games?",
      retrievalProfile: "general_chat",
    });
    const directRun = directPlan.metadata.retrievalTrace?.fusionRuns?.[0];
    expect(directRun?.candidateCount).toBe(2);
    expect(directRun?.budget).toBe(1);
  });

  it("anchors temporal visibility to a per-call referenceTime", async () => {
    const rawStore = createInMemoryDocumentStore();
    const projectionIndex = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-01T00:00:00.000Z",
    });
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore: projectionIndex.documentStore,
      sessionStore,
    });
    await repositories.facts.add(
      createFactMemory({
        id: "fact-window",
        ...scope,
        category: "personal",
        content: "Lakeside cabin rentals are booked for evening relaxation.",
        source: { method: "explicit", extractedAt: "2026-07-01T00:00:00.000Z" },
        validUntil: "2026-07-05T00:00:00.000Z",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-evergreen",
        ...scope,
        category: "personal",
        content: "Evening walks help with relaxation.",
        source: { method: "explicit", extractedAt: "2026-07-01T00:00:00.000Z" },
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      }),
    );
    const engine = createRecallEngine({
      repositories,
      runtime: sessionStore,
      autoStrategyBias: "hybrid",
      generalizedFusion: { maxCandidates: 8 },
      projectionIndex,
    });
    const query = "What does the user do for evening relaxation?";

    const beforeExpiry = await engine.recall({
      scope,
      query,
      referenceTime: "2026-07-01T12:00:00.000Z",
      retrievalProfile: "general_chat",
    });
    const afterExpiry = await engine.recall({
      scope,
      query,
      referenceTime: "2026-07-10T00:00:00.000Z",
      retrievalProfile: "general_chat",
    });

    const fusedIds = (result: typeof beforeExpiry): string[] =>
      result.metadata.retrievalTrace?.fusionRuns?.[0]?.candidates.map(
        (candidate) => candidate.sourceMemoryId,
      ) ?? [];
    expect(fusedIds(beforeExpiry)).toContain("fact-window");
    expect(fusedIds(beforeExpiry)).toContain("fact-evergreen");
    expect(fusedIds(afterExpiry)).not.toContain("fact-window");
    expect(fusedIds(afterExpiry)).toContain("fact-evergreen");
  });

  it("admits projected references, episodes, and archives through content lanes", async () => {
    const rawStore = createInMemoryDocumentStore();
    const projectionIndex = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-10T00:00:00.000Z",
    });
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore: projectionIndex.documentStore,
      sessionStore,
    });
    await repositories.references.add(
      createReferenceMemory({
        id: "reference-nebula",
        ...scope,
        title: "Operations note",
        pointer: "docs/internal.txt",
        attributes: { program: "Nebula escalation checklist" },
        source: { method: "explicit", extractedAt: "2026-07-09T00:00:00.000Z" },
      }),
    );
    await repositories.episodes.add(
      createEpisodeMemory({
        id: "episode-nebula",
        ...scope,
        summary: "The planning session ended with one follow-up.",
        unresolvedItems: ["Approve the Nebula escalation checklist."],
        createdAt: "2026-07-09T00:00:00.000Z",
      }),
    );
    await repositories.archives.add(
      createSessionArchive({
        id: "archive-nebula",
        ...scope,
        sessionId: "session-previous",
        summary: "The Nebula escalation checklist still needs approval.",
        archivedAt: "2026-07-09T00:00:00.000Z",
      }),
    );
    const query = "Where is the Nebula escalation checklist and what needs approval?";
    expect(
      new Set(
        (await projectionIndex.searchDocuments(scope, query, 128))
          .map(({ sourceMemoryId }) => sourceMemoryId),
      ),
    ).toEqual(new Set([
      "reference-nebula",
      "episode-nebula",
      "archive-nebula",
    ]));
    const engine = createRecallEngine({
      repositories,
      runtime: sessionStore,
      autoStrategyBias: "hybrid",
      generalizedFusion: { maxCandidates: 8 },
      projectionIndex,
    });

    const result = await engine.recall({
      scope,
      query,
      retrievalProfile: "general_chat",
    });

    expect(result.references.map(({ id }) => id)).toContain("reference-nebula");
    expect(result.episodes.map(({ id }) => id)).toContain("episode-nebula");
    expect(result.archives.map(({ id }) => id)).toContain("archive-nebula");
    for (const id of [
      "reference-nebula",
      "episode-nebula",
      "archive-nebula",
    ]) {
      expect(
        result.metadata.candidateTraces.find(({ memoryId }) => memoryId === id)
          ?.fallback,
      ).toBe("generalized_fusion");
    }
  });

  it("reports final reference membership instead of the wider fusion budget", async () => {
    const rawStore = createInMemoryDocumentStore();
    const projectionIndex = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-10T00:00:00.000Z",
    });
    const repositories = createMemoryRepositories({
      documentStore: projectionIndex.documentStore,
      sessionStore: createInMemorySessionStore(),
    });
    for (const reference of [
      createReferenceMemory({
        id: "reference-newer",
        ...scope,
        title: "Nebula runbook",
        pointer: "docs/nebula-newer.md",
        source: {
          method: "explicit",
          extractedAt: "2026-07-09T00:00:00.000Z",
        },
      }),
      createReferenceMemory({
        id: "reference-older",
        ...scope,
        title: "Nebula runbook",
        pointer: "docs/nebula-older.md",
        source: {
          method: "explicit",
          extractedAt: "2026-07-08T00:00:00.000Z",
        },
      }),
    ]) {
      await repositories.references.add(reference);
    }
    const engine = createRecallEngine({
      repositories,
      runtime: createInMemorySessionStore(),
      autoStrategyBias: "hybrid",
      generalizedFusion: { maxCandidates: 8 },
      projectionIndex,
    });

    const result = await engine.recall({
      scope,
      query: "Where is the Nebula runbook?",
      retrievalProfile: "general_chat",
    });
    const traces = result.metadata.retrievalTrace?.fusionRuns?.[0]?.candidates ?? [];
    const selectedReferenceIds = traces
      .filter(
        ({ selected, sourceCollection }) =>
          selected && sourceCollection === "references",
      )
      .map(({ sourceMemoryId }) => sourceMemoryId);

    expect(result.references.map(({ id }) => id)).toEqual(["reference-newer"]);
    expect(selectedReferenceIds).toEqual(["reference-newer"]);
    expect(
      traces.find(({ sourceMemoryId }) => sourceMemoryId === "reference-older"),
    ).toMatchObject({
      eliminationReason: "not_selected",
      selected: false,
    });
  });

  it("honors configured content-lane record quotas for fused episodes", async () => {
    const rawStore = createInMemoryDocumentStore();
    const projectionIndex = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-10T00:00:00.000Z",
    });
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore: projectionIndex.documentStore,
      sessionStore,
    });
    for (const [index, summary] of [
      "The Nebula escalation checklist was drafted in the first session.",
      "The Nebula escalation checklist gained an approval step.",
      "The Nebula escalation checklist still needs a final signoff.",
    ].entries()) {
      await repositories.episodes.add(
        createEpisodeMemory({
          id: `episode-nebula-${index}`,
          ...scope,
          summary,
          createdAt: "2026-07-09T00:00:00.000Z",
        }),
      );
    }
    const query = "Where does the Nebula escalation checklist stand?";
    const recallInput = {
      scope,
      query,
      retrievalProfile: "general_chat" as const,
    };

    const defaultQuota = await createRecallEngine({
      repositories,
      runtime: sessionStore,
      autoStrategyBias: "hybrid",
      generalizedFusion: { maxCandidates: 8 },
      projectionIndex,
    }).recall(recallInput);
    const widened = await createRecallEngine({
      repositories,
      runtime: sessionStore,
      autoStrategyBias: "hybrid",
      generalizedFusion: {
        contentLaneRecords: { episodes: 3 },
        maxCandidates: 8,
      },
      projectionIndex,
    }).recall(recallInput);

    const fusedEpisodeIds = (result: typeof widened): string[] =>
      result.episodes
        .map(({ id }) => id)
        .filter((id) => id.startsWith("episode-nebula-"));
    // The default lane quota stays at 2 fused episodes.
    expect(fusedEpisodeIds(defaultQuota).length).toBeLessThanOrEqual(2);
    // A configured quota admits the third fused episode.
    expect(fusedEpisodeIds(widened).sort()).toEqual([
      "episode-nebula-0",
      "episode-nebula-1",
      "episode-nebula-2",
    ]);
  });

  it("feeds provider dense reference and episode channels into generalized fusion", async () => {
    const rawStore = createInMemoryDocumentStore();
    const projectionIndex = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-10T00:00:00.000Z",
    });
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore: projectionIndex.documentStore,
      sessionStore,
      vectorStore: createInMemoryVectorStore(),
    });
    const embedding = createFixedEmbeddingAdapter();
    const reference = createReferenceMemory({
      id: "reference-dense",
      ...scope,
      title: "Fishing permit archive",
      pointer: "vault/permit.txt",
      source: { method: "explicit", extractedAt: "2026-07-09T00:00:00.000Z" },
    });
    const episode = createEpisodeMemory({
      id: "episode-dense",
      ...scope,
      summary: "Marco went fishing at a quiet lake.",
      createdAt: "2026-07-09T00:00:00.000Z",
    });
    await repositories.references.add(reference);
    await repositories.episodes.add(episode);
    const [referenceEmbedding, episodeEmbedding] = await embedding.embed([
      `${reference.title} ${reference.pointer}`,
      episode.summary,
    ]);
    await repositories.vectorIndex!.upsertReferenceEmbedding([
      {
        content: reference.title,
        embedding: referenceEmbedding!,
        id: reference.id,
        metadata: { ...scope, memoryType: "reference" },
      },
    ]);
    await repositories.vectorIndex!.upsertEpisodeEmbedding([
      {
        content: episode.summary,
        embedding: episodeEmbedding!,
        id: episode.id,
        metadata: { ...scope, memoryType: "episode" },
      },
    ]);
    const engine = createRecallEngine({
      repositories,
      runtime: sessionStore,
      embedding,
      autoStrategyBias: "hybrid",
      generalizedFusion: { maxCandidates: 8, maxTotalFacts: 10 },
      projectionIndex,
    });

    const result = await engine.recall({
      scope,
      query: QUERY,
      retrievalProfile: "general_chat",
    });

    for (const id of [reference.id, episode.id]) {
      expect(
        result.metadata.candidateTraces.find(({ memoryId }) => memoryId === id)
          ?.fallback,
      ).toBe("generalized_fusion");
    }
    expect(result.metadata.retrievalTrace?.fusionRuns).toEqual([
      expect.objectContaining({
        status: "applied",
        candidates: expect.arrayContaining([
          expect.objectContaining({
            sourceCollection: "references",
            sourceMemoryId: reference.id,
            selected: true,
            channels: expect.objectContaining({
              dense: expect.objectContaining({ rank: expect.any(Number) }),
            }),
          }),
        ]),
      }),
    ]);
  });

  it("reaches structured claim temporal channels through the public recall engine", async () => {
    const rawStore = createInMemoryDocumentStore();
    const projectionIndex = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-10T00:00:00.000Z",
    });
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore: projectionIndex.documentStore,
      sessionStore,
    });
    const sourceMemoryId = "fact-status";
    await repositories.facts.add(createFactMemory({
      id: sourceMemoryId,
      ...scope,
      category: "project",
      content: "Atlas project status changed from planned to completed.",
      source: { method: "explicit", extractedAt: "2026-07-08T00:00:00.000Z" },
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
    }));
    for (const [objectText, updatedAt] of [
      ["planned", "2026-07-08T00:00:00.000Z"],
      ["completed", "2026-07-09T00:00:00.000Z"],
    ] as const) {
      await projectionIndex.appendClaim({
        ...scope,
        sourceMemoryId,
        subject: "Atlas",
        claim: {
          predicateKey: "project.status",
          objectText,
        },
        observedAt: updatedAt,
        ingestedAt: updatedAt,
        evidenceIds: [],
        sourceMessageIds: [],
        extractorVersion: "claim-test-v1",
      });
    }
    const engine = createRecallEngine({
      repositories,
      runtime: sessionStore,
      autoStrategyBias: "hybrid",
      generalizedFusion: { maxCandidates: 8, maxTotalFacts: 8 },
      projectionIndex,
    });

    const result = await engine.recall({
      scope,
      query: "How did project status change from planned to completed?",
      retrievalProfile: "general_chat",
    });

    expect(result.facts.map(({ content }) => content)).toEqual([
      "Atlas project status changed from planned to completed.",
    ]);
    expect(result.metadata.retrievalTrace?.fusionRuns?.[0]?.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceTypes: expect.arrayContaining(["temporal"]),
        }),
      ]),
    );
  });

  it("selects only the latest canonical source in a current claim group", async () => {
    const rawStore = createInMemoryDocumentStore();
    const projectionIndex = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-10T00:00:00.000Z",
    });
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore: projectionIndex.documentStore,
      sessionStore,
    });
    for (const [id, content, objectText, timestamp] of [
      [
        "fact-project-old",
        "Atlas current project status planned current project status.",
        "planned",
        "2026-07-01T00:00:00.000Z",
      ],
      [
        "fact-project-new",
        "Opaque completion record.",
        "completed",
        "2026-07-09T00:00:00.000Z",
      ],
    ] as const) {
      await repositories.facts.add(createFactMemory({
        id,
        ...scope,
        category: "project",
        content,
        source: { method: "explicit", extractedAt: timestamp },
        createdAt: timestamp,
        updatedAt: timestamp,
      }));
      await projectionIndex.appendClaim({
        ...scope,
        sourceMemoryId: id,
        subject: "Atlas",
        claim: { predicateKey: "project.status", objectText },
        observedAt: timestamp,
        ingestedAt: timestamp,
        evidenceIds: [],
        sourceMessageIds: [],
        extractorVersion: "claim-test-v1",
      });
    }
    const engine = createRecallEngine({
      repositories,
      runtime: sessionStore,
      autoStrategyBias: "hybrid",
      generalizedFusion: { maxCandidates: 8, maxTotalFacts: 8 },
      projectionIndex,
      referenceTime: () => "2026-07-10T00:00:00.000Z",
    });

    const result = await engine.recall({
      scope,
      query: "What is Atlas's current project status?",
      retrievalProfile: "general_chat",
    });

    expect(result.facts.map(({ content }) => content)).toEqual([
      "Opaque completion record.",
    ]);
  });

  it("uses a claim for current selection without rewriting canonical fact content", async () => {
    const rawStore = createInMemoryDocumentStore();
    const projectionIndex = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-10T00:00:00.000Z",
    });
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore: projectionIndex.documentStore,
      sessionStore,
    });
    const fact = createFactMemory({
      id: "fact-canonical-status",
      ...scope,
      category: "project",
      content: "Atlas completed its deployment through Lisbon.",
      source: { method: "explicit", extractedAt: "2026-07-09T00:00:00.000Z" },
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
    });
    await repositories.facts.add(fact);
    await projectionIndex.appendClaim({
      ...scope,
      sourceMemoryId: fact.id,
      subject: "Atlas",
      claim: {
        predicateKey: "project.status",
        objectText: "completed",
      },
      observedAt: "2026-07-09T00:00:00.000Z",
      ingestedAt: "2026-07-09T00:00:00.000Z",
      evidenceIds: [],
      sourceMessageIds: [],
      extractorVersion: "claim-test-v1",
    });
    const engine = createRecallEngine({
      repositories,
      runtime: sessionStore,
      autoStrategyBias: "hybrid",
      generalizedFusion: { maxCandidates: 8, maxTotalFacts: 8 },
      projectionIndex,
      referenceTime: () => "2026-07-10T00:00:00.000Z",
    });

    const result = await engine.recall({
      scope,
      query: "What is Atlas's current project status?",
      retrievalProfile: "general_chat",
    });

    expect(result.facts).toEqual([
      expect.objectContaining({
        id: fact.id,
        content: fact.content,
      }),
    ]);
    expect(result.facts[0]?.attributes?.claimProjectionId).toBeUndefined();
  });

  it("queries claim history and selects the status before an explicit boundary", async () => {
    const rawStore = createInMemoryDocumentStore();
    const projectionIndex = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-01-01T00:00:00.000Z",
    });
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore: projectionIndex.documentStore,
      sessionStore,
    });
    const fact = createFactMemory({
      id: "fact-status",
      ...scope,
      category: "project",
      content: "Atlas project status was old before 2025.",
      source: { method: "explicit", extractedAt: "2024-12-01T00:00:00.000Z" },
      createdAt: "2024-12-01T00:00:00.000Z",
      updatedAt: "2024-12-01T00:00:00.000Z",
    });
    await repositories.facts.add(fact);
    for (const [objectText, ingestedAt] of [
      ["old", "2024-12-01T00:00:00.000Z"],
      ["new", "2025-02-01T00:00:00.000Z"],
    ] as const) {
      await projectionIndex.appendClaim({
        ...scope,
        sourceMemoryId: fact.id,
        subject: "Atlas",
        claim: { predicateKey: "project.status", objectText },
        observedAt: ingestedAt,
        ingestedAt,
        evidenceIds: [],
        sourceMessageIds: [],
        extractorVersion: "claim-test-v1",
      });
    }
    const engine = createRecallEngine({
      repositories,
      runtime: sessionStore,
      autoStrategyBias: "hybrid",
      generalizedFusion: { maxCandidates: 8, maxTotalFacts: 8 },
      projectionIndex,
      referenceTime: () => "2026-01-01T00:00:00.000Z",
    });

    const result = await engine.recall({
      scope,
      query: "What was Atlas project status before 2025?",
      retrievalProfile: "general_chat",
    });
    const temporal = result.metadata.retrievalTrace?.fusionRuns?.[0]?.candidates
      .find(({ sourceMemoryId }) => sourceMemoryId === fact.id)?.channels.temporal;
    const oldClaim = (await projectionIndex.queryClaimHistory(scope)).find(
      ({ objectText }) => objectText === "old",
    );

    expect(oldClaim).toBeDefined();
    expect(temporal?.evidenceDocumentIds).toEqual([oldClaim!.id]);
    expect(temporal?.evidenceDocumentIds).not.toContain(
      (await projectionIndex.queryClaims(scope))[0]?.id,
    );
    expect(result.facts.map(({ content }) => content)).toEqual([
      "Atlas project status was old before 2025.",
    ]);
  });

  it("does not mix a post-boundary current fact into another source's historical answer", async () => {
    const rawStore = createInMemoryDocumentStore();
    const projectionIndex = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-01-01T00:00:00.000Z",
    });
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore: projectionIndex.documentStore,
      sessionStore,
    });
    for (const [id, objectText, timestamp] of [
      ["fact-old", "planned", "2024-12-01T00:00:00.000Z"],
      ["fact-new", "completed", "2025-02-01T00:00:00.000Z"],
    ] as const) {
      await repositories.facts.add(createFactMemory({
        id,
        ...scope,
        category: "project",
        content: objectText,
        source: { method: "explicit", extractedAt: timestamp },
        createdAt: timestamp,
        updatedAt: timestamp,
      }));
      await projectionIndex.appendClaim({
        ...scope,
        sourceMemoryId: id,
        subject: "Atlas",
        claim: { predicateKey: "project.status", objectText },
        observedAt: timestamp,
        ingestedAt: timestamp,
        evidenceIds: [],
        sourceMessageIds: [],
        extractorVersion: "claim-test-v1",
      });
    }
    const engine = createRecallEngine({
      repositories,
      runtime: sessionStore,
      autoStrategyBias: "hybrid",
      generalizedFusion: { maxCandidates: 8, maxTotalFacts: 8 },
      projectionIndex,
      referenceTime: () => "2026-01-01T00:00:00.000Z",
    });

    const result = await engine.recall({
      scope,
      query: "What was Atlas project status before 2025?",
      retrievalProfile: "general_chat",
    });

    expect(result.facts.map(({ content }) => content)).toEqual(["planned"]);
  });
});
