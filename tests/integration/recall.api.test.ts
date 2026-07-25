import { describe, expect, it } from "bun:test";
import { createGoodMemory } from "../../src";
import { createInternalGoodMemory } from "../../src/api/createGoodMemory";
import {
  createEpisodeMemory,
  createFactMemory,
  createFeedbackMemory,
  createPreferenceMemory,
  createReferenceMemory,
  createUserProfile,
} from "../../src/domain/records";
import { createEvidenceRecord } from "../../src/evidence/contracts";
import { createSessionArchive } from "../../src/evolution/contracts";
import { renderMemoryPacket } from "../../src/recall/contextBuilder";
import {
  createRuntimeContextService,
} from "../../src/runtime/contextService";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src/storage/memory";
import {
  createMemoryRepositories,
} from "../../src/storage/repositories";
import type { RetrievalStrategyPromotionAuthorization } from "../../src/governance/retrievalInternalRollout";
import {
  createFakeEmbeddingAdapter,
  createFakeRecallRouter,
} from "../../src/testing/fakes";
import { createEnglishLanguagePack } from "../../src/language";

function seedMemory() {
  const documentStore = createInMemoryDocumentStore();
  const sessionStore = createInMemorySessionStore();
  const repositories = createMemoryRepositories({
    documentStore,
    sessionStore,
  });
  const runtime = createRuntimeContextService({
    sessionStore,
    archiveStore: repositories.archives,
    now: () => "2026-01-01T00:00:00.000Z",
  });

  return {
    documentStore,
    sessionStore,
    repositories,
    runtime,
  };
}

function buildInternalRetrievalPromotionAuthorization(): RetrievalStrategyPromotionAuthorization {
  return {
    expiresAt: "2026-01-08T00:00:00.000Z",
    family: "retrieval",
    issuedAt: "2026-01-01T00:00:00.000Z",
    pairedObserve: {
      promotionGate: {
        decision: "accepted",
        outcome: "passed",
        promotedStrategyLabel: "rules-only",
        targetStrategyLabel: "llm-assisted",
      },
      source: {
        runId: "run-observe",
      },
      summary: {
        assertionPassRate: 1,
        completedCases: 5,
        executionFailures: 0,
        regressionCases: [],
        safeObserveCases: 5,
        totalCases: 5,
        unknownObserveCases: 0,
      },
    },
    promotionGate: {
      decision: "accepted",
      outcome: "passed",
      promotedStrategyLabel: "rules-only",
      targetStrategyLabel: "llm-assisted",
    },
    publicSurfaceDecision: {
      surfaces: [
        {
          decision: "accepted",
          exposure: "public",
          surface: "core_config",
        },
        {
          decision: "accepted",
          exposure: "public",
          surface: "eval_artifact_cli",
        },
        {
          decision: "accepted",
          exposure: "public",
          surface: "official_memory_cli",
        },
        {
          decision: "delayed",
          exposure: "internal",
          surface: "strategy_rollout_config",
        },
        {
          decision: "delayed",
          exposure: "internal",
          surface: "promotion_gate_runtime",
        },
        {
          decision: "delayed",
          exposure: "internal",
          surface: "evolution_namespace",
        },
      ],
    },
    regressionDashboardSummary: {
      executionFailureCount: 0,
      totalBlockingCases: 0,
    },
    source: {
      generatedBy: "tests",
      runId: "run-assist",
    },
    targetStrategyLabel: "llm-assisted",
  };
}

describe("public recall API", () => {
  it("retrieves semantic and procedural memory for general chat", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.profiles.upsert(
      createUserProfile({
        userId: "u-1",
        identity: { name: "Lin", role: "Robotics engineer" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Robot workflow is blocked on prod migration.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-2",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "personal",
        content: "User likes weekend hiking in Hangzhou.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.feedback.upsert(
      createFeedbackMemory({
        id: "fb-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        rule: "Keep answers concise and action-oriented.",
        kind: "do",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.preferences.upsert(
      createPreferenceMemory({
        id: "pref-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "response_style",
        value: "concise",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.references.add(
      createReferenceMemory({
        id: "ref-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        title: "Migration runbook",
        pointer: "docs/migration-runbook.md",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "How should I answer this user?",
      retrievalProfile: "general_chat",
    });

    expect(result.profile?.identity.name).toBe("Lin");
    expect(result.facts).toHaveLength(1);
    expect(result.feedback).toHaveLength(1);
    expect(result.preferences).toHaveLength(1);
    expect(result.references).toHaveLength(1);
    expect(result.facts[0]?.content).toContain("prod migration");
    expect(result.packet.profileSummary).toContain("Lin");
    expect(result.packet.preferenceSummary).toContain("response_style");
    expect(result.packet.referenceSummary).toContain("Migration runbook");
    expect(result.metadata.hits.some((hit) => hit.type === "feedback")).toBe(true);
    expect(result.metadata.hits.some((hit) => hit.reason === "semantic_preference")).toBe(true);
    expect(result.metadata.routingDecision.strategy).toBe("rules-only");
    expect(result.metadata.routingDecision.strategyExplanation.resolvedStrategy).toBe(
      "rules-only",
    );
    expect(
      result.metadata.hits.find((hit) => hit.type === "fact")?.sourceMethod,
    ).toBe("explicit");
  });

  it("uses semantic tie-breaking only when hybrid recall is actually available", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore,
      vectorStore,
    });
    const runtime = createRuntimeContextService({
      sessionStore,
      archiveStore: repositories.archives,
      now: () => "2026-01-01T00:00:00.000Z",
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
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const withoutSemanticAdapters = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });
    const withSemanticAdapters = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
        vectorStore,
        embeddingAdapter,
      },
    });

    const fallback = await withoutSemanticAdapters.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query,
      retrievalProfile: "general_chat",
      strategy: "hybrid",
    });
    const hybrid = await withSemanticAdapters.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query,
      retrievalProfile: "general_chat",
      strategy: "hybrid",
    });

    expect(fallback.metadata.routingDecision.strategy).toBe("rules-only");
    expect(fallback.metadata.routingDecision.strategyExplanation.fallbackReason).toBe(
      "semantic_search_unavailable",
    );
    expect(fallback.facts[0]?.id).toBe("fact-wrong");
    expect(hybrid.metadata.routingDecision.strategy).toBe("hybrid");
    expect(hybrid.metadata.routingDecision.strategyExplanation.semanticTieBreaking).toBe(true);
    expect(hybrid.facts[0]?.id).toBe("fact-right");
  });

  it("allows an internal llm-assisted recall router to add bounded support hints and reorder durable candidates", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.references.add(
      createReferenceMemory({
        id: "ref-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        title: "Migration runbook",
        pointer: "docs/migration-runbook.md",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        factKind: "blocker",
        content: "Service account rotation is the current blocker for the migration rollout.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createInternalGoodMemory(
      {
        storage: { provider: "memory" },
        adapters: { documentStore, sessionStore },
      },
      {
        assistedRecallRouter: {
          async plan() {
            return {
              querySummary: "source of truth plus immediate blocker context",
              rationale: "reference lookup also needs project-state support",
              supportSlotAdditions: ["project_state_support"],
              sourcePriorityOrder: [
                "fact",
                "profile",
                "feedback",
                "episode",
                "working_memory",
                "session_journal",
              ],
            };
          },
          async rerank() {
            return {
              orderedCandidateIds: ["references:ref-1", "facts:fact-1"],
              rationale: "runbook should lead before blocker detail",
              decisions: [
                {
                  candidateId: " references:ref-1 ",
                  decision: "promote",
                  reason: "source_of_truth",
                },
              ],
            };
          },
        },
      },
    );

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "Which runbook is the source of truth for the migration rollout?",
      retrievalProfile: "general_chat",
      strategy: "llm-assisted",
    });

    expect(result.metadata.routingDecision.strategy).toBe("llm-assisted");
    expect(result.metadata.routingDecision.supportSlots).toContain(
      "project_state_support",
    );
    expect(result.references[0]?.id).toBe("ref-1");
    expect(result.facts[0]?.id).toBe("fact-1");
    expect(result.metadata.assistantInfluence?.planApplied).toBe(true);
    expect(result.metadata.assistantInfluence?.rerankApplied).toBe(true);
    expect(result.metadata.assistantInfluence?.routerInfluenceStatus).toBe("applied");
    expect(result.metadata.assistantInfluence?.rerankedCandidateIds).toEqual([
      "references:ref-1",
      "facts:fact-1",
    ]);
    const markdown = renderMemoryPacket(result.packet, "markdown");
    expect(markdown.content.indexOf("Migration runbook")).toBeLessThan(
      markdown.content.indexOf("Service account rotation"),
    );
    expect(
      result.metadata.candidateTraces.find((trace) => trace.memoryId === "ref-1")?.whyReturned,
    ).toContain("llmDecision=promote:source_of_truth");
  });

  it("treats legacy references without lifecycle as active during recall", async () => {
    const { documentStore, sessionStore, runtime } = seedMemory();
    const legacyReference = createReferenceMemory({
      id: "ref-legacy",
      userId: "u-1",
      workspaceId: "workspace-a",
      title: "Migration runbook",
      pointer: "docs/migration-runbook.md",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    delete (legacyReference as Partial<typeof legacyReference>).lifecycle;
    await documentStore.set("references", legacyReference.id, legacyReference);
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
      testing: {
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "Which migration runbook should I use?",
      retrievalProfile: "general_chat",
    });

    expect(result.references.map((reference) => reference.id)).toContain("ref-legacy");
    expect(
      result.metadata.candidateTraces.find((trace) => trace.memoryId === "ref-legacy")
        ?.whySuppressed,
    ).not.toBe("inactive lifecycle");
  });

  it("promotes auto recall to llm-assisted for authorized high-value queries in the internal runtime", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.references.add(
      createReferenceMemory({
        id: "ref-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        title: "Migration runbook",
        pointer: "docs/migration-runbook.md",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        factKind: "blocker",
        content: "Service account rotation is the current blocker for the migration rollout.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createInternalGoodMemory(
      {
        storage: { provider: "memory" },
        adapters: { documentStore, sessionStore },
        testing: {
          now: () => new Date("2026-01-01T00:00:00.000Z"),
        },
      },
      {
        assistedRecallRouter: createFakeRecallRouter(),
        retrievalStrategyRollout: {
          family: "retrieval",
          mode: "promote",
          promotedStrategy: "llm-assisted",
          promotionAuthorization: buildInternalRetrievalPromotionAuthorization(),
        },
      },
    );

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "Which runbook is the source of truth for the migration rollout?",
      retrievalProfile: "general_chat",
    });

    expect(result.metadata.routingDecision.strategy).toBe("llm-assisted");
    expect(result.metadata.routingDecision.strategyExplanation.requestedStrategy).toBe(
      "auto",
    );
    expect(result.metadata.routingDecision.strategyExplanation.summary).toContain(
      "internal promote rollout elevated auto recall to llm-assisted",
    );
    expect(result.metadata.assistantInfluence?.planApplied).toBe(true);
  });

  it("reuses one typed query analysis across internal rollout and recall", async () => {
    const english = createEnglishLanguagePack();
    let analysisCalls = 0;
    const memory = createInternalGoodMemory(
      {
        language: {
          packs: [{
            ...english,
            analyzeQuery(query) {
              analysisCalls += 1;
              return english.analyzeQuery(query);
            },
          }],
        },
        storage: { provider: "memory" },
        testing: {
          now: () => new Date("2026-01-01T00:00:00.000Z"),
        },
      },
      {
        assistedRecallRouter: createFakeRecallRouter(),
        retrievalStrategyRollout: {
          family: "retrieval",
          mode: "promote",
          promotedStrategy: "llm-assisted",
          promotionAuthorization: buildInternalRetrievalPromotionAuthorization(),
        },
      },
    );

    await memory.recall({
      scope: { userId: "u-analysis", workspaceId: "workspace-a" },
      query: "Which runbook is the source of truth?",
    });

    expect(analysisCalls).toBe(1);
  });

  it("rechecks internal retrieval promotion authorization expiry when recall applies promotion", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();
    let now = new Date("2026-01-01T00:00:00.000Z");

    await repositories.references.add(
      createReferenceMemory({
        id: "ref-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        title: "Migration runbook",
        pointer: "docs/migration-runbook.md",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createInternalGoodMemory(
      {
        storage: { provider: "memory" },
        adapters: { documentStore, sessionStore },
        testing: {
          now: () => now,
        },
      },
      {
        assistedRecallRouter: createFakeRecallRouter(),
        retrievalStrategyRollout: {
          family: "retrieval",
          mode: "promote",
          promotedStrategy: "llm-assisted",
          promotionAuthorization: buildInternalRetrievalPromotionAuthorization(),
        },
      },
    );

    now = new Date("2026-01-09T00:00:00.000Z");

    await expect(
      memory.recall({
        scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
        query: "Which runbook is the source of truth for the migration rollout?",
        retrievalProfile: "general_chat",
      }),
    ).rejects.toThrow(
      "Retrieval strategy llm-assisted cannot become the promoted default because trusted strategy-promotion authorization expired at 2026-01-08T00:00:00.000Z.",
    );
  });

  it("keeps profile-only auto queries on rules-only even when llm-assisted promotion is authorized", async () => {
    const { documentStore, sessionStore, repositories } = seedMemory();

    await repositories.profiles.upsert(
      createUserProfile({
        userId: "u-1",
        identity: { name: "Lin", role: "Robotics engineer" },
      }),
    );

    const memory = createInternalGoodMemory(
      {
        storage: { provider: "memory" },
        adapters: { documentStore, sessionStore },
        testing: {
          now: () => new Date("2026-01-01T00:00:00.000Z"),
        },
      },
      {
        assistedRecallRouter: createFakeRecallRouter(),
        retrievalStrategyRollout: {
          family: "retrieval",
          mode: "promote",
          promotedStrategy: "llm-assisted",
          promotionAuthorization: buildInternalRetrievalPromotionAuthorization(),
        },
      },
    );

    const result = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "What is my role?",
      retrievalProfile: "general_chat",
    });

    expect(result.metadata.routingDecision.strategy).toBe("rules-only");
    expect(result.metadata.assistantInfluence).toBeUndefined();
  });

  it("preserves explicit retrieval strategy overrides even when llm-assisted promotion is authorized", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.references.add(
      createReferenceMemory({
        id: "ref-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        title: "Migration runbook",
        pointer: "docs/migration-runbook.md",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createInternalGoodMemory(
      {
        storage: { provider: "memory" },
        adapters: {
          documentStore,
          embeddingAdapter: createFakeEmbeddingAdapter(),
          sessionStore,
        },
        testing: {
          now: () => new Date("2026-01-01T00:00:00.000Z"),
        },
      },
      {
        assistedRecallRouter: createFakeRecallRouter(),
        retrievalStrategyRollout: {
          family: "retrieval",
          mode: "promote",
          promotedStrategy: "llm-assisted",
          promotionAuthorization: buildInternalRetrievalPromotionAuthorization(),
        },
      },
    );

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "Which runbook is the source of truth for the migration rollout?",
      retrievalProfile: "general_chat",
      strategy: "hybrid",
    });

    expect(result.metadata.routingDecision.strategy).toBe("hybrid");
    expect(result.metadata.routingDecision.strategyExplanation.requestedStrategy).toBe(
      "hybrid",
    );
    expect(result.metadata.assistantInfluence).toBeUndefined();
  });

  it("does not emit contradictory llmDecision traces when provider decisions disagree with the executed rerank", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        factKind: "blocker",
        content: "Service account rotation is the current blocker for the migration rollout.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createInternalGoodMemory(
      {
        storage: { provider: "memory" },
        adapters: { documentStore, sessionStore },
      },
      {
        assistedRecallRouter: {
          async plan() {
            return {
              querySummary: "migration blocker context",
              rationale: "keep the blocker fact in focus",
            };
          },
          async rerank() {
            return {
              orderedCandidateIds: ["facts:fact-1"],
              rationale: "keep blocker detail",
              decisions: [
                {
                  candidateId: "facts:fact-1",
                  decision: "suppress",
                  reason: "query_alignment",
                },
              ],
            };
          },
        },
      },
    );

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "What is the migration rollout status?",
      retrievalProfile: "general_chat",
      strategy: "llm-assisted",
    });

    const blockerTrace = result.metadata.candidateTraces.find(
      (trace) => trace.memoryId === "fact-1",
    );

    expect(result.facts[0]?.id).toBe("fact-1");
    expect(result.metadata.assistantInfluence?.rerankApplied).toBe(true);
    expect(result.metadata.assistantInfluence?.rerankedCandidateIds).toEqual([
      "facts:fact-1",
    ]);
    expect(result.metadata.assistantInfluence?.suppressedCandidateIds).toEqual([]);
    expect(result.metadata.assistantInfluence?.decisions).toEqual([]);
    expect(blockerTrace?.returned).toBe(true);
    expect(blockerTrace?.whyReturned).toBeDefined();
    expect(blockerTrace?.whyReturned).not.toContain("llmDecision=");
  });

  it("attributes LLM suppress traces only to candidates the assistant actually suppressed", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-policy",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Migration rollout status policy note for customer messaging.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-suppress",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Migration rollout status stale optional detail for customer messaging.",
        source: { method: "explicit", extractedAt: "2026-01-02T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-keep",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Migration rollout status confirmed detail for customer messaging.",
        source: { method: "explicit", extractedAt: "2026-01-03T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createInternalGoodMemory(
      {
        storage: { provider: "memory" },
        adapters: { documentStore, sessionStore },
        policy: {
          shouldRecall(record) {
            return !(record.memoryType === "fact" && record.id === "fact-policy");
          },
        },
      },
      {
        assistedRecallRouter: {
          async plan() {
            return {
              querySummary: "customer messaging status",
              rationale: "deterministic route is sufficient",
            };
          },
          async rerank(input) {
            const orderedCandidateIds = input.candidates.map((candidate) => candidate.id);

            return {
              orderedCandidateIds,
              rationale: "remove stale optional detail",
              suppressCandidateIds: orderedCandidateIds.includes("facts:fact-suppress")
                ? ["facts:fact-suppress"]
                : [],
            };
          },
        },
      },
    );

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "How should I reply to the user about migration rollout status?",
      retrievalProfile: "general_chat",
      strategy: "llm-assisted",
    });

    const policyTrace = result.metadata.candidateTraces.find(
      (trace) => trace.memoryId === "fact-policy",
    );
    const suppressTrace = result.metadata.candidateTraces.find(
      (trace) => trace.memoryId === "fact-suppress",
    );

    expect(result.facts.map((fact) => fact.id)).toEqual(["fact-keep"]);
    expect(result.metadata.assistantInfluence?.routerInfluenceStatus).toBe("applied");
    expect(policyTrace?.returned).toBe(false);
    expect(policyTrace?.whySuppressed).toBe("policy filtered");
    expect(suppressTrace?.returned).toBe(false);
    expect(suppressTrace?.whySuppressed).toBe("llm-assisted suppress");
  });

  it("falls back to deterministic recall when the internal llm-assisted router errors", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        factKind: "blocker",
        content: "Service account rotation is the current blocker for the migration rollout.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createInternalGoodMemory(
      {
        storage: { provider: "memory" },
        adapters: { documentStore, sessionStore },
      },
      {
        assistedRecallRouter: {
          async plan() {
            throw new Error("Structured model response schema validation failed");
          },
          async rerank() {
            throw new Error("should not run");
          },
        },
      },
    );

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "What is the current blocker?",
      retrievalProfile: "general_chat",
      strategy: "llm-assisted",
    });

    expect(result.metadata.routingDecision.strategy).toBe("llm-assisted");
    expect(result.facts[0]?.id).toBe("fact-1");
    expect(result.metadata.assistantInfluence?.fallbackReason).toBe("schema_invalid");
    expect(result.metadata.assistantInfluence?.fallbackStage).toBe("plan");
    expect(result.metadata.assistantInfluence?.routerInfluenceStatus).toBe("full_fallback");
    expect(result.metadata.assistantInfluence?.providerDiagnostics?.[0]).toMatchObject({
      reason: "schema_invalid",
      stage: "plan",
    });
    expect(result.metadata.assistantInfluence?.rerankApplied).toBe(false);
  });

  it("keeps planner influence visible when rerank falls back after a successful plan", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Migration rollout status depends on service account rotation.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createInternalGoodMemory(
      {
        storage: { provider: "memory" },
        adapters: { documentStore, sessionStore },
      },
      {
        assistedRecallRouter: {
          async plan() {
            return {
              querySummary: "migration rollout status",
              rationale: "prioritize fact source",
              sourcePriorityOrder: [
                "fact",
                "profile",
                "feedback",
                "episode",
                "working_memory",
                "session_journal",
              ],
            };
          },
          async rerank() {
            throw new Error("Structured model response schema validation failed");
          },
        },
      },
    );

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "What is the migration rollout status?",
      retrievalProfile: "general_chat",
      strategy: "llm-assisted",
    });

    expect(result.metadata.assistantInfluence?.planApplied).toBe(true);
    expect(result.metadata.assistantInfluence?.rerankApplied).toBe(false);
    expect(result.metadata.assistantInfluence?.fallbackStage).toBe("rerank");
    expect(result.metadata.assistantInfluence?.fallbackReason).toBe("schema_invalid");
    expect(result.metadata.assistantInfluence?.routerInfluenceStatus).toBe(
      "partial_fallback",
    );
  });

  it("retrieves runtime continuity for coding-agent recalls and builds markdown context", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Runtime refactor touches recall and context builder.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });
    await runtime.updateWorkingMemory(
      { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      {
        currentGoal: "Finish recall engine",
        openLoops: ["wire buildContext output"],
      },
    );
    await runtime.updateSessionJournal(
      { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      {
        currentState: "Phase 6 in progress",
        appendWorklog: ["Recall router implemented."],
      },
    );

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "Continue the recall engine implementation.",
      retrievalProfile: "coding_agent",
    });

    expect(result.workingMemory?.currentGoal).toBe("Finish recall engine");
    expect(result.journal?.currentState).toBe("Phase 6 in progress");
    expect(result.packet.workingMemorySummary).toContain("Finish recall engine");

    const context = await memory.buildContext({
      recall: result,
      output: "markdown",
      maxTokens: 80,
    });

    expect(context.content).toContain("## Working Memory");
    expect(context.content).toContain("## Session Journal");
  });

  it("retrieves episodic memory for continuation-style prompts", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-prev",
        summary: "Last session narrowed the recall work to episodic retrieval and context sections.",
        keyDecisions: ["Implement episode retrieval before verification layer."],
        unresolvedItems: ["Add episode section to context builder."],
        topics: ["recall", "episodes"],
        importance: 0.9,
        confidence: 0.95,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "Continue the recall work from last time.",
      retrievalProfile: "coding_agent",
    });

    expect(result.episodes).toHaveLength(1);
    expect(result.packet.episodeSummary).toContain("episodic retrieval");
    expect(result.metadata.hits.some((hit) => hit.type === "episode")).toBe(true);
    // Without span pointers the episode line stays summary-only.
    expect(result.packet.episodeSummary).not.toContain("  > ");

    const context = await memory.buildContext({
      recall: result,
      output: "markdown",
      maxTokens: 120,
    });

    expect(context.content).toContain("## Relevant Episodes");
  });

  it("hydrates episode dialogue spans from stored source messages", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await documentStore.set("source_messages_v1", "sm-1", {
      content: "Let's continue the episodic retrieval refactor tomorrow.",
      contentSha256: "sha-1",
      id: "sm-1",
      ingestedAt: "2026-01-01T10:00:00.000Z",
      observedAt: "2026-01-01T09:30:00.000Z",
      role: "user",
      schemaVersion: 1,
      userId: "u-1",
      workspaceId: "workspace-a",
    });
    await documentStore.set("source_messages_v1", "sm-2", {
      content: "Agreed - the context sections still need the episode lane.",
      contentSha256: "sha-2",
      id: "sm-2",
      ingestedAt: "2026-01-01T10:00:01.000Z",
      role: "assistant",
      schemaVersion: 1,
      userId: "u-1",
      workspaceId: "workspace-a",
    });
    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-span",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-prev",
        summary: "Last session narrowed the recall work to episodic retrieval.",
        keyDecisions: [],
        unresolvedItems: [],
        topics: ["recall", "episodes"],
        importance: 0.9,
        confidence: 0.95,
        createdAt: "2026-01-02T00:00:00.000Z",
        observedAt: "2026-01-01T09:30:00.000Z",
        sourceMessageIds: ["sm-1", "sm-2"],
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "Continue the recall work from last time.",
      retrievalProfile: "coding_agent",
    });

    expect(result.episodes).toHaveLength(1);
    expect(result.packet.episodeSummary).toContain(
      "- [2026-01-01] Last session narrowed the recall work to episodic retrieval.",
    );
    expect(result.packet.episodeSummary).toContain(
      "  > [2026-01-01] user: Let's continue the episodic retrieval refactor tomorrow.",
    );
    expect(result.packet.episodeSummary).toContain(
      "  > assistant: Agreed - the context sections still need the episode lane.",
    );
  });

  it("retrieves session archive summaries for continuation queries when prior sessions were archived", async () => {
    const { documentStore, sessionStore, runtime } = seedMemory();

    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-prev",
      workspaceId: "workspace-a",
    });
    await runtime.appendToSession(
      { userId: "u-1", sessionId: "s-prev", workspaceId: "workspace-a" },
      {
        role: "user",
        content: "Last time we narrowed the archive recall work to summary fusion.",
      },
    );
    await runtime.updateWorkingMemory(
      { userId: "u-1", sessionId: "s-prev", workspaceId: "workspace-a" },
      {
        currentGoal: "Finish archive recall",
        openLoops: ["wire archive summary into context builder"],
        temporaryDecisions: ["Prefer archive before generic episodic fallback."],
      },
    );
    await runtime.updateSessionJournal(
      { userId: "u-1", sessionId: "s-prev", workspaceId: "workspace-a" },
      {
        currentState: "Archive recall drafted",
        appendWorklog: ["Session archive support is the next checkpoint."],
        filesAndFunctions: ["src/recall/engine.ts"],
      },
    );
    await runtime.endSession({
      userId: "u-1",
      sessionId: "s-prev",
      workspaceId: "workspace-a",
    });
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-current",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-current", workspaceId: "workspace-a" },
      query: "Continue the archive recall work from last time.",
      retrievalProfile: "coding_agent",
    });

    expect(result.archives).toHaveLength(1);
    expect(result.archives[0]?.summary).toContain("Archive recall drafted");
    expect(result.packet.archiveSummary).toContain("Archive recall drafted");
    expect(result.metadata.hits.some((hit) => hit.type === "session_archive")).toBe(true);

    const context = await memory.buildContext({
      recall: result,
      output: "markdown",
      maxTokens: 160,
    });

    expect(context.content).toContain("## Session Archive");
    expect(context.content).toContain("Archive recall drafted");
  });

  it("prefers the archive whose unresolved handoff matches the continuation query", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.archives.add(
      createSessionArchive({
        id: "archive-relevant",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-prev-relevant",
        summary: "Previous session paused after a generic checkpoint.",
        keyDecisions: ["Keep the rollback plan staged until ownership is confirmed."],
        unresolvedItems: ["confirm rollback owner before resuming rollout"],
        createdAt: "2026-01-01T00:00:00.000Z",
        archivedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await repositories.archives.add(
      createSessionArchive({
        id: "archive-latest",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-prev-latest",
        summary: "Most recent session covered unrelated docs cleanup.",
        keyDecisions: ["Leave the docs index as-is for now."],
        unresolvedItems: ["polish the docs nav labels"],
        createdAt: "2026-01-02T00:00:00.000Z",
        archivedAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-current",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-current", workspaceId: "workspace-a" },
      query: "Continue the rollback owner follow-up from last time.",
      retrievalProfile: "coding_agent",
    });

    expect(result.archives).toHaveLength(1);
    expect(result.archives[0]?.id).toBe("archive-relevant");
    expect(result.packet.archiveSummary).toContain("confirm rollback owner before resuming rollout");
    expect(result.packet.archiveSummary).toContain(
      "Keep the rollback plan staged until ownership is confirmed.",
    );
  });

  it("does not surface session archive summaries for non-continuation general queries", async () => {
    const { documentStore, sessionStore, runtime } = seedMemory();

    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-prev",
      workspaceId: "workspace-a",
    });
    await runtime.updateWorkingMemory(
      { userId: "u-1", sessionId: "s-prev", workspaceId: "workspace-a" },
      {
        currentGoal: "Finish archive recall",
        openLoops: ["wire archive summary into context builder"],
      },
    );
    await runtime.updateSessionJournal(
      { userId: "u-1", sessionId: "s-prev", workspaceId: "workspace-a" },
      {
        currentState: "Archive recall drafted",
      },
    );
    await runtime.endSession({
      userId: "u-1",
      sessionId: "s-prev",
      workspaceId: "workspace-a",
    });
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-current",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-current", workspaceId: "workspace-a" },
      query: "How should I answer this user?",
      retrievalProfile: "general_chat",
    });

    expect(result.archives).toHaveLength(0);
    expect(result.packet.archiveSummary).toBeUndefined();
    expect(result.metadata.hits.some((hit) => hit.type === "session_archive")).toBe(false);
  });

  it("surfaces evidence linked to selected fact and reference hits", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The current blocker is vendor approval for runtime reliability.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.references.add(
      createReferenceMemory({
        id: "ref-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        title: "Runtime runbook",
        pointer: "docs/runtime-runbook.md",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.evidence.add(
      createEvidenceRecord({
        id: "evidence-fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        kind: "conversation_excerpt",
        excerpt: "The user said vendor approval is still pending for runtime reliability.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        linkedMemoryIds: ["fact-1"],
      }),
    );
    await repositories.evidence.add(
      createEvidenceRecord({
        id: "evidence-ref-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        kind: "conversation_excerpt",
        excerpt: "The user said docs/runtime-runbook.md is the source of truth.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        linkedMemoryIds: ["ref-1"],
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "Which runbook should I use and what is the current blocker?",
      retrievalProfile: "coding_agent",
    });

    expect(result.evidence).toHaveLength(2);
    expect(result.packet.evidenceSummary).toContain("vendor approval");
    expect(result.packet.evidenceSummary).toContain("docs/runtime-runbook.md");
    expect(result.metadata.hits.some((hit) => hit.type === "evidence")).toBe(true);
    expect(
      result.metadata.hits.find((hit) => hit.id === "fact-1")?.evidenceIds,
    ).toEqual(["evidence-fact-1"]);
    expect(
      result.metadata.hits.find((hit) => hit.id === "ref-1")?.evidenceIds,
    ).toEqual(["evidence-ref-1"]);
    expect(
      result.metadata.candidateTraces.find((trace) => trace.memoryId === "fact-1")?.evidenceIds,
    ).toEqual(["evidence-fact-1"]);
    expect(
      result.metadata.candidateTraces.find((trace) => trace.memoryId === "ref-1")?.evidenceIds,
    ).toEqual(["evidence-ref-1"]);

    const context = await memory.buildContext({
      recall: result,
      output: "markdown",
      maxTokens: 180,
    });

    expect(context.content).toContain("## Evidence");
  });

  it("keeps evidenceIds complete even when visible evidence is truncated to the top three records", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The current blocker is vendor approval for runtime reliability.",
        source: { method: "explicit", extractedAt: "2025-01-01T00:00:00.000Z" },
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      }),
    );
    await repositories.references.add(
      createReferenceMemory({
        id: "ref-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        title: "Runtime runbook",
        pointer: "docs/runtime-runbook.md",
        source: { method: "explicit", extractedAt: "2026-03-20T00:00:00.000Z" },
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      }),
    );
    await repositories.evidence.add(
      createEvidenceRecord({
        id: "evidence-fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        kind: "conversation_excerpt",
        excerpt: "The user said vendor approval is still pending for runtime reliability.",
        source: { method: "explicit", extractedAt: "2025-01-02T00:00:00.000Z" },
        createdAt: "2025-01-02T00:00:00.000Z",
        linkedMemoryIds: ["fact-1"],
      }),
    );
    for (const [id, extractedAt, excerpt] of [
      [
        "evidence-ref-1",
        "2026-04-01T00:00:00.000Z",
        "The user said docs/runtime-runbook.md is the latest runtime runbook.",
      ],
      [
        "evidence-ref-2",
        "2026-03-31T00:00:00.000Z",
        "The user repeated that docs/runtime-runbook.md is the source of truth.",
      ],
      [
        "evidence-ref-3",
        "2026-03-30T00:00:00.000Z",
        "The team confirmed docs/runtime-runbook.md during the handoff.",
      ],
    ] as const) {
      await repositories.evidence.add(
        createEvidenceRecord({
          id,
          userId: "u-1",
          workspaceId: "workspace-a",
          sessionId: "s-1",
          kind: "conversation_excerpt",
          excerpt,
          source: { method: "explicit", extractedAt },
          createdAt: extractedAt,
          linkedMemoryIds: ["ref-1"],
        }),
      );
    }
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
      testing: {
        now: () => new Date("2026-04-02T00:00:00.000Z"),
      },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "Which runbook should I use and what is the current blocker before I proceed?",
      retrievalProfile: "coding_agent",
    });

    expect(result.evidence.map((record) => record.id)).toEqual([
      "evidence-ref-1",
      "evidence-ref-2",
      "evidence-ref-3",
    ]);
    expect(
      result.metadata.hits.find((hit) => hit.id === "fact-1")?.evidenceIds,
    ).toEqual(["evidence-fact-1"]);
    expect(
      result.metadata.hits.find((hit) => hit.id === "ref-1")?.evidenceIds,
    ).toEqual(["evidence-ref-1", "evidence-ref-2", "evidence-ref-3"]);
    expect(
      result.metadata.candidateTraces.find((trace) => trace.memoryId === "fact-1")?.evidenceIds,
    ).toEqual(["evidence-fact-1"]);
    expect(
      result.metadata.candidateTraces.find((trace) => trace.memoryId === "ref-1")?.evidenceIds,
    ).toEqual(["evidence-ref-1", "evidence-ref-2", "evidence-ref-3"]);
    expect(
      result.metadata.verificationHints.find((hint) => hint.memoryId === "fact-1")?.evidenceIds,
    ).toEqual(["evidence-fact-1"]);

    const resultWithEvidence = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "Which runbook should I use and what is the current blocker before I proceed?",
      retrievalProfile: "coding_agent",
      includeEvidence: true,
    });

    expect(resultWithEvidence.evidence.map((record) => record.id)).toEqual([
      "evidence-ref-1",
      "evidence-ref-2",
      "evidence-ref-3",
      "evidence-fact-1",
    ]);
    expect(resultWithEvidence.evidenceLedger?.map(({ evidenceId }) => evidenceId)).toEqual([
      "evidence-fact-1",
      "evidence-ref-1",
      "evidence-ref-2",
      "evidence-ref-3",
    ]);
    expect(resultWithEvidence.packet.evidenceSummary).not.toContain(
      "vendor approval",
    );

  });

  it("keeps evidenceIds on suppressed candidate traces", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.references.add(
      createReferenceMemory({
        id: "ref-win",
        userId: "u-1",
        workspaceId: "workspace-a",
        title: "Runtime runbook",
        pointer: "docs/runtime-runbook.md",
        source: { method: "explicit", extractedAt: "2026-04-01T00:00:00.000Z" },
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      }),
    );
    await repositories.references.add(
      createReferenceMemory({
        id: "ref-lose",
        userId: "u-1",
        workspaceId: "workspace-a",
        title: "Payments runbook",
        pointer: "docs/payments-runbook.md",
        source: { method: "explicit", extractedAt: "2026-03-31T00:00:00.000Z" },
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z",
      }),
    );
    await repositories.evidence.add(
      createEvidenceRecord({
        id: "evidence-ref-win",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        kind: "conversation_excerpt",
        excerpt: "The user said docs/runtime-runbook.md is the runtime source of truth.",
        source: { method: "explicit", extractedAt: "2026-04-01T00:00:00.000Z" },
        createdAt: "2026-04-01T00:00:00.000Z",
        linkedMemoryIds: ["ref-win"],
      }),
    );
    await repositories.evidence.add(
      createEvidenceRecord({
        id: "evidence-ref-lose",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        kind: "conversation_excerpt",
        excerpt: "The user also mentioned docs/payments-runbook.md for a different flow.",
        source: { method: "explicit", extractedAt: "2026-03-31T00:00:00.000Z" },
        createdAt: "2026-03-31T00:00:00.000Z",
        linkedMemoryIds: ["ref-lose"],
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "Which runtime runbook should I use?",
      retrievalProfile: "general_chat",
    });

    expect(result.references.map((reference) => reference.id)).toEqual(["ref-win"]);
    expect(
      result.metadata.candidateTraces.find((trace) => trace.memoryId === "ref-win")?.evidenceIds,
    ).toEqual(["evidence-ref-win"]);
    expect(
      result.metadata.candidateTraces.find((trace) => trace.memoryId === "ref-lose")?.evidenceIds,
    ).toEqual(["evidence-ref-lose"]);
    expect(
      result.metadata.candidateTraces.find((trace) => trace.memoryId === "ref-lose")
        ?.whySuppressed,
    ).toBe("same-slot candidate not chosen");
  });

  it("keeps the evidence layer closed for non-action general assistance queries", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The current blocker is vendor approval for runtime reliability.",
        source: { method: "explicit", extractedAt: "2025-01-01T00:00:00.000Z" },
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      }),
    );
    await repositories.evidence.add(
      createEvidenceRecord({
        id: "evidence-fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        kind: "conversation_excerpt",
        excerpt: "The user said vendor approval is still pending for runtime reliability.",
        source: { method: "explicit", extractedAt: "2025-01-01T00:00:00.000Z" },
        createdAt: "2025-01-01T00:00:00.000Z",
        linkedMemoryIds: ["fact-1"],
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
      testing: {
        now: () => new Date("2026-04-02T00:00:00.000Z"),
      },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "How should I answer this user?",
      retrievalProfile: "general_chat",
    });

    expect(result.facts).toHaveLength(1);
    expect(result.evidence).toHaveLength(0);
    expect(result.packet.evidenceSummary).toBeUndefined();
    expect(result.metadata.hits.some((hit) => hit.type === "evidence")).toBe(false);
    expect(
      result.metadata.hits.find((hit) => hit.id === "fact-1")?.evidenceIds,
    ).toEqual(["evidence-fact-1"]);
    expect(
      result.metadata.candidateTraces.find((trace) => trace.memoryId === "fact-1")?.evidenceIds,
    ).toEqual(["evidence-fact-1"]);
    expect(
      result.metadata.verificationHints.find((hint) => hint.memoryId === "fact-1")?.evidenceIds,
    ).toEqual(["evidence-fact-1"]);

    const withEvidence = await memory.recall({
      includeEvidence: true,
      scope: { userId: "u-1", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "How should I answer this user?",
      retrievalProfile: "general_chat",
    });

    expect(withEvidence.evidence.map((record) => record.id)).toEqual([
      "evidence-fact-1",
    ]);
    expect(withEvidence.packet.evidenceSummary).toContain(
      "vendor approval is still pending",
    );
    expect(withEvidence.metadata.hits.some((hit) => hit.type === "evidence")).toBe(
      true,
    );
  });

  it("does not inject unrelated long-term memory when the query has no relevant signal", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.references.add(
      createReferenceMemory({
        id: "ref-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        title: "Migration runbook",
        pointer: "docs/migration-runbook.md",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        summary: "Previous session discussed rollout cleanup.",
        topics: ["rollout", "cleanup"],
        keyDecisions: [],
        unresolvedItems: [],
        importance: 0.8,
        confidence: 0.9,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-9",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-9", workspaceId: "workspace-a" },
      query: "Translate this sentence into Chinese.",
      retrievalProfile: "general_chat",
    });

    expect(result.references).toHaveLength(0);
    expect(result.episodes).toHaveLength(0);
  });

  it("does not surface unrelated personal facts for answer-composition recalls", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "personal",
        content: "For education tasks, avoid irrelevant carry-over from hobby preferences.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-11",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-11", workspaceId: "workspace-a" },
      query:
        "Please confirm the updated runbook, my role, and the open loop before proposing the next step for release quality program.",
      retrievalProfile: "general_chat",
    });

    expect(result.facts).toHaveLength(0);
    expect(result.packet.factSummary).toBeUndefined();
  });

  it("does not promote unrelated project facts when confirming preferred response style", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Robot workflow is blocked on prod migration.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.preferences.upsert(
      createPreferenceMemory({
        id: "pref-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "response_style",
        value: "concise bullet points",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-confirm-style",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: {
        userId: "u-1",
        sessionId: "s-confirm-style",
        workspaceId: "workspace-a",
      },
      query: "Please confirm my preferred response style.",
      retrievalProfile: "general_chat",
    });

    expect(result.preferences).toHaveLength(1);
    expect(result.preferences[0]?.value).toBe("concise bullet points");
    expect(result.facts).toHaveLength(0);
    expect(result.packet.factSummary).toBeUndefined();
  });

  it("filters preferences by query relevance for topical recommendation requests", async () => {
    const { documentStore, sessionStore, repositories } = seedMemory();

    await repositories.preferences.upsert(
      createPreferenceMemory({
        id: "pref-video-editing",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "learning_resources",
        value: "Adobe Premiere Pro resources when learning video editing",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.preferences.upsert(
      createPreferenceMemory({
        id: "pref-music",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "music_recommendations",
        value: "upbeat music recommendations",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "Can you recommend resources where I can learn more about video editing?",
    });

    expect(result.preferences.map((preference) => preference.id)).toEqual([
      "pref-video-editing",
    ]);
  });

  it("filters feedback and episodic carry-over for topical recommendation requests", async () => {
    const { documentStore, sessionStore, repositories } = seedMemory();

    await repositories.feedback.upsert(
      createFeedbackMemory({
        id: "fb-video-editing",
        userId: "u-1",
        workspaceId: "workspace-a",
        kind: "dont",
        rule: "Avoid beginner-only resources when recommending video editing tutorials.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.feedback.upsert(
      createFeedbackMemory({
        id: "fb-table",
        userId: "u-1",
        workspaceId: "workspace-a",
        kind: "dont",
        rule: "Do not add a big table with budget activities.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-video-editing",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-video-editing",
        summary: "A prior session discussed video editing workflow options.",
        keyDecisions: [],
        unresolvedItems: [],
        topics: ["video editing"],
        importance: 0.8,
        confidence: 0.9,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "Can you recommend resources where I can learn more about video editing?",
    });

    expect(result.feedback.map((feedback) => feedback.id)).toEqual([
      "fb-video-editing",
    ]);
    expect(result.episodes).toHaveLength(0);
  });

  it("returns multiple matching facts for aggregate personal count queries", async () => {
    const { documentStore, sessionStore, repositories } = seedMemory();

    for (const [index, content] of [
      "I worked on or got the model kit: Revell F-15 Eagle kit.",
      "I worked on or got the model kit: Tamiya 1/48 scale Spitfire Mk.V.",
      "I worked on or got the model kit: 1/72 scale B-29 bomber model kit.",
      "I worked on or got the model kit: 1/24 scale '69 Camaro.",
    ].entries()) {
      await repositories.facts.add(
        createFactMemory({
          id: `fact-model-kit-${index + 1}`,
          userId: "u-1",
          workspaceId: "workspace-a",
          sessionId: `s-model-kit-${index + 1}`,
          category: "personal",
          content,
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        }),
      );
    }

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "How many model kits have I worked on or bought?",
    });

    expect(result.facts.map((fact) => fact.sessionId).sort()).toEqual([
      "s-model-kit-1",
      "s-model-kit-2",
      "s-model-kit-3",
      "s-model-kit-4",
    ]);
  });

  it("prefers the latest relationship relocation for direct move-location queries", async () => {
    const { documentStore, sessionStore, repositories } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-rachel-city",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-rachel-city",
        category: "relationship",
        content: "Rachel moved to a new apartment in the city.",
        attributes: { claimKey: "relationship.location" },
        subject: "Rachel",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-rachel-suburbs",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-rachel-suburbs",
        category: "relationship",
        content: "Rachel moved back to the suburbs again.",
        attributes: { claimKey: "relationship.location" },
        subject: "Rachel",
        source: { method: "explicit", extractedAt: "2026-01-02T00:00:00.000Z" },
      }),
    );

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "Where did Rachel move to after her recent relocation?",
    });

    expect(result.facts.map((fact) => fact.sessionId)).toEqual([
      "s-rachel-suburbs",
    ]);
  });

  it("selects technical research interests for broad publication recommendations", async () => {
    const { documentStore, sessionStore, repositories } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-medical-ai-interest",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-medical-ai-interest",
        category: "technical",
        content:
          "I am interested in explainable AI in medical image analysis research papers and articles.",
        scopeKind: "project",
        subject: "explainable AI in medical image analysis",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-video-editing-tool",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-video-editing-tool",
        category: "personal",
        content: "I use Adobe Premiere Pro for video editing.",
        scopeKind: "identity",
        subject: "video editing",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query:
        "Can you recommend some recent publications or conferences that I might find interesting?",
    });

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-medical-ai-interest",
    ]);
  });

  it("keeps latest direct count and achievement updates without dropping aggregate lists", async () => {
    const { documentStore, sessionStore, repositories } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        attributes: { claimKey: "korean-restaurants-tried-count" },
        id: "fact-korean-three",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-korean-three",
        category: "personal",
        content: "I have tried three Korean restaurants in my city.",
        scopeKind: "identity",
        subject: "korean restaurants in my city",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        attributes: { claimKey: "korean-restaurants-tried-count" },
        id: "fact-korean-four",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-korean-four",
        category: "personal",
        content: "I have tried four Korean restaurants in my city.",
        scopeKind: "identity",
        subject: "korean restaurants in my city",
        source: { method: "explicit", extractedAt: "2026-01-02T00:00:00.000Z" },
      }),
    );
    for (const [index, content] of [
      "I worked on or got the model kit: simple Revell F-15 Eagle kit.",
      "I worked on or got the model kit: Tamiya 1/48 scale Spitfire Mk.V.",
      "I worked on or got the model kit: 1/72 scale B-29 bomber model kit.",
    ].entries()) {
      await repositories.facts.add(
        createFactMemory({
          id: `fact-update-model-kit-${index + 1}`,
          userId: "u-1",
          workspaceId: "workspace-a",
          sessionId: `s-update-model-kit-${index + 1}`,
          category: "personal",
          content,
          scopeKind: "identity",
          subject: content.replace(/^I worked on or got the model kit: /, ""),
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        }),
      );
    }

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const koreanResult = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "How many Korean restaurants have I tried in my city?",
    });
    const modelKitResult = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "How many model kits have I worked on or bought?",
    });

    expect(koreanResult.facts.map((fact) => fact.id)).toEqual([
      "fact-korean-four",
    ]);
    expect(modelKitResult.facts.map((fact) => fact.id).sort()).toEqual([
      "fact-update-model-kit-1",
      "fact-update-model-kit-2",
      "fact-update-model-kit-3",
    ]);
  });

  it("adds same-session store context for coupon redemption location queries", async () => {
    const { documentStore, sessionStore, repositories } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-target-app",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-target-coupon",
        category: "personal",
        content: "I use the Cartwheel app from Target.",
        scopeKind: "identity",
        subject: "target",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-coffee-creamer-coupon",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-target-coupon",
        category: "event",
        content: "I redeemed a $5 coupon on coffee creamer last Sunday.",
        scopeKind: "identity",
        subject: "coffee creamer coupon",
        source: { method: "explicit", extractedAt: "2026-01-02T00:00:00.000Z" },
      }),
    );

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "Where did I redeem a $5 coupon on coffee creamer?",
    });

    expect(result.facts.map((fact) => fact.id)).toEqual([
      "fact-coffee-creamer-coupon",
      "fact-target-app",
    ]);
  });

  it("does not pull unrelated project facts into reference-only runbook queries", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.references.add(
      createReferenceMemory({
        id: "ref-runtime",
        userId: "u-1",
        workspaceId: "workspace-a",
        title: "Runtime runbook",
        pointer: "docs/runtime-runbook.md",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-blocker",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Vendor approval is still blocking the migration rollout.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-runbook-only",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: {
        userId: "u-1",
        sessionId: "s-runbook-only",
        workspaceId: "workspace-a",
      },
      query: "Which runbook should I use for runtime work?",
      retrievalProfile: "general_chat",
    });

    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.pointer).toBe("docs/runtime-runbook.md");
    expect(result.facts).toHaveLength(0);
    expect(result.packet.factSummary).toBeUndefined();
  });

  it("does not let workflow-doc queries pull workflow status facts into recall", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.references.add(
      createReferenceMemory({
        id: "ref-workflow",
        userId: "u-1",
        workspaceId: "workspace-a",
        title: "Workflow guide",
        pointer: "docs/workflow-guide.md",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-workflow-status",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Robot workflow is blocked on prod migration.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-workflow-doc-only",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: {
        userId: "u-1",
        sessionId: "s-workflow-doc-only",
        workspaceId: "workspace-a",
      },
      query: "Which workflow doc should I use?",
      retrievalProfile: "general_chat",
    });

    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.pointer).toBe("docs/workflow-guide.md");
    expect(result.facts).toHaveLength(0);
    expect(result.packet.factSummary).toBeUndefined();
  });

  it("does not pull unrelated project facts into blocker confirmation queries", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-blocker",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The current blocker is vendor approval for runtime migration.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-role",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "my current role is staff platform engineer leading runtime reliability.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-blocker-only",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: {
        userId: "u-1",
        sessionId: "s-blocker-only",
        workspaceId: "workspace-a",
      },
      query: "What is the current blocker?",
      retrievalProfile: "general_chat",
    });

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.content).toContain("vendor approval");
    expect(result.facts[0]?.content).not.toContain("current role");
  });

  it("records explainability traces for returned and suppressed fact candidates", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-blocker-trace",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        factKind: "blocker",
        scopeKind: "project",
        subject: "migration rollout",
        content: "The current blocker is vendor approval for migration rollout.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-role-trace",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        factKind: "role_update",
        scopeKind: "identity",
        subject: "migration rollout",
        content: "my current role is staff platform engineer leading migration rollout.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-trace-blocker",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: {
        userId: "u-1",
        sessionId: "s-trace-blocker",
        workspaceId: "workspace-a",
      },
      query: "What is the current blocker?",
      retrievalProfile: "general_chat",
    });

    const blockerTrace = result.metadata.candidateTraces.find(
      (trace) => trace.memoryId === "fact-blocker-trace",
    );
    const roleTrace = result.metadata.candidateTraces.find(
      (trace) => trace.memoryId === "fact-role-trace",
    );

    expect(blockerTrace?.returned).toBe(true);
    expect(blockerTrace?.slot).toBe("blocker");
    expect(blockerTrace?.whyReturned).toContain("slot=blocker");
    expect(roleTrace?.returned).toBe(false);
    expect(roleTrace?.whySuppressed).toBe("slot mismatch");
  });

  it("does not fall back to open-loop facts for blocker queries", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-open-loop-only",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The open loop is pending signoff.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-blocker-slot-only",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: {
        userId: "u-1",
        sessionId: "s-blocker-slot-only",
        workspaceId: "workspace-a",
      },
      query: "What is the current blocker?",
      retrievalProfile: "general_chat",
    });

    expect(result.facts).toHaveLength(0);
    expect(result.packet.factSummary).toBeUndefined();
  });

  it("does not fall back to blocker facts for open-loop queries", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-blocker-only",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The blocker is vendor approval.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-open-loop-slot-only",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: {
        userId: "u-1",
        sessionId: "s-open-loop-slot-only",
        workspaceId: "workspace-a",
      },
      query: "What is the open loop?",
      retrievalProfile: "general_chat",
    });

    expect(result.facts).toHaveLength(0);
    expect(result.packet.factSummary).toBeUndefined();
  });

  it("does not fall back to unrelated blocker facts for role queries", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.profiles.upsert(
      createUserProfile({
        userId: "u-1",
        identity: { name: "Lin", role: "Staff platform engineer" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-blocker",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The blocker is vendor approval for migration rollout.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-role-only",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: {
        userId: "u-1",
        sessionId: "s-role-only",
        workspaceId: "workspace-a",
      },
      query: "What is my current role?",
      retrievalProfile: "general_chat",
    });

    expect(result.profile?.identity.role).toBe("Staff platform engineer");
    expect(result.facts).toHaveLength(0);
    expect(result.packet.factSummary).toBeUndefined();
  });

  it("does not pull role or blocker facts into focus-only queries", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.profiles.upsert(
      createUserProfile({
        userId: "u-1",
        identity: { name: "Lin", role: "Staff platform engineer" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-focus-only",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        factKind: "focus_update",
        scopeKind: "project",
        subject: "runtime reliability",
        content: "my current focus is runtime reliability and platform migration.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-role-noise",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        factKind: "role_update",
        scopeKind: "identity",
        subject: "runtime reliability",
        content: "my current role is staff platform engineer leading runtime reliability.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-blocker-noise",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        factKind: "blocker",
        scopeKind: "project",
        subject: "runtime reliability",
        content: "The current blocker is vendor approval for runtime reliability.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-focus-only",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: {
        userId: "u-1",
        sessionId: "s-focus-only",
        workspaceId: "workspace-a",
      },
      query: "What is my current focus?",
      retrievalProfile: "general_chat",
    });

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.content).toContain("current focus");
    expect(result.facts[0]?.content).not.toContain("current role");
    expect(result.facts[0]?.content).not.toContain("current blocker");
    expect(
      result.metadata.candidateTraces.find((trace) => trace.memoryId === "fact-role-noise")
        ?.whySuppressed,
    ).toBe("slot mismatch");
    expect(
      result.metadata.candidateTraces.find((trace) => trace.memoryId === "fact-blocker-noise")
        ?.whySuppressed,
    ).toBe("slot mismatch");
  });

  it("keeps project-state facts for mixed role and next-step queries", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.profiles.upsert(
      createUserProfile({
        userId: "u-1",
        identity: { name: "Lin", role: "Staff platform engineer" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-blocker",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The blocker is vendor approval for migration rollout.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-role-next-step",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: {
        userId: "u-1",
        sessionId: "s-role-next-step",
        workspaceId: "workspace-a",
      },
      query: "What is my current role, and what should I do next for the migration rollout?",
      retrievalProfile: "general_chat",
    });

    expect(result.profile?.identity.role).toBe("Staff platform engineer");
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.content).toContain("vendor approval");
  });

  it("falls back to a unique active state fact for mixed role and next-step queries without lexical overlap", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.profiles.upsert(
      createUserProfile({
        userId: "u-1",
        identity: { name: "Lin", role: "Staff platform engineer" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-blocker-unique",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The blocker is vendor approval.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-role-next-step-implicit-blocker",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: {
        userId: "u-1",
        sessionId: "s-role-next-step-implicit-blocker",
        workspaceId: "workspace-a",
      },
      query: "What is my current role, and what should I do next for the migration rollout?",
      retrievalProfile: "general_chat",
    });

    expect(result.profile?.identity.role).toBe("Staff platform engineer");
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.content).toBe("The blocker is vendor approval.");
    expect(
      result.metadata.candidateTraces.find(
        (trace) => trace.memoryId === "fact-blocker-unique",
      )?.fallback,
    ).toBe("same_slot_unique_candidate");
  });

  it("does not treat generic project facts as project-state support for next-step queries", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.profiles.upsert(
      createUserProfile({
        userId: "u-1",
        identity: { name: "Lin", role: "Staff platform engineer" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-generic-next-step",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        factKind: "generic_project",
        scopeKind: "project",
        subject: "runtime reliability",
        content: "The architecture uses Kafka.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-role-next-step-generic-project",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: {
        userId: "u-1",
        sessionId: "s-role-next-step-generic-project",
        workspaceId: "workspace-a",
      },
      query: "What is my current role, and what should I do next for runtime reliability?",
      retrievalProfile: "general_chat",
    });

    expect(result.profile?.identity.role).toBe("Staff platform engineer");
    expect(result.facts).toHaveLength(0);
    expect(
      result.metadata.candidateTraces.find(
        (trace) => trace.memoryId === "fact-generic-next-step",
      )?.whySuppressed,
    ).toBe("slot mismatch");
  });

  it("keeps project-state facts available to project-state support for next-step queries", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.profiles.upsert(
      createUserProfile({
        userId: "u-1",
        identity: { name: "Lin", role: "Staff platform engineer" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-project-state-next-step",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        factKind: "project_state",
        scopeKind: "project",
        subject: "runtime reliability",
        content: "Owner signoff is still pending for runtime reliability rollout.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-role-next-step-project-state",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: {
        userId: "u-1",
        sessionId: "s-role-next-step-project-state",
        workspaceId: "workspace-a",
      },
      query: "What is my current role, and what should I do next for runtime reliability?",
      retrievalProfile: "general_chat",
    });

    expect(result.profile?.identity.role).toBe("Staff platform engineer");
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.content).toContain("Owner signoff is still pending");
  });

  it("recognizes legacy next-milestone facts as project-state support for next-step queries", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.profiles.upsert(
      createUserProfile({
        userId: "u-1",
        identity: { name: "Lin", role: "Staff platform engineer" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-legacy-next-milestone",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        subject: "runtime reliability",
        content: "The next milestone is cutover readiness for runtime reliability.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-role-next-step-next-milestone",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: {
        userId: "u-1",
        sessionId: "s-role-next-step-next-milestone",
        workspaceId: "workspace-a",
      },
      query: "What is my current role, and what should I do next for runtime reliability?",
      retrievalProfile: "general_chat",
    });

    expect(result.profile?.identity.role).toBe("Staff platform engineer");
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.content).toContain("next milestone");
  });

  it("does not guess among multiple state facts for mixed role and next-step queries without lexical overlap", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.profiles.upsert(
      createUserProfile({
        userId: "u-1",
        identity: { name: "Lin", role: "Staff platform engineer" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-blocker-a",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The blocker is vendor approval.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-blocker-b",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The open loop is pending signoff.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-role-next-step-ambiguous",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: {
        userId: "u-1",
        sessionId: "s-role-next-step-ambiguous",
        workspaceId: "workspace-a",
      },
      query: "What is my current role, and what should I do next for the migration rollout?",
      retrievalProfile: "general_chat",
    });

    expect(result.profile?.identity.role).toBe("Staff platform engineer");
    expect(result.facts).toHaveLength(0);
    expect(result.packet.factSummary).toBeUndefined();
  });

  it("keeps references primary and project-state support narrow for reference plus next-step queries", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.references.add(
      createReferenceMemory({
        id: "ref-next-step",
        userId: "u-1",
        workspaceId: "workspace-a",
        title: "Release runbook",
        pointer: "docs/release-runbook.md",
        referenceKind: "source_of_truth",
        subject: "release quality",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-support-blocker",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        factKind: "blocker",
        scopeKind: "project",
        subject: "release quality",
        content: "The current blocker is vendor approval for release quality.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-support-open-loop",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        factKind: "open_loop",
        scopeKind: "project",
        subject: "release quality",
        content: "The open loop is final verification for release quality.",
        source: { method: "explicit", extractedAt: "2026-01-02T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-role-noise-reference",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        factKind: "role_update",
        scopeKind: "identity",
        subject: "release quality",
        content: "my current role is staff platform engineer leading release quality.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-reference-next-step",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: {
        userId: "u-1",
        sessionId: "s-reference-next-step",
        workspaceId: "workspace-a",
      },
      query: "Which runbook is the source of truth, and what should I do next for release quality?",
      retrievalProfile: "general_chat",
    });

    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.pointer).toBe("docs/release-runbook.md");
    expect(result.facts.map((fact) => fact.content)).toEqual([
      "The current blocker is vendor approval for release quality.",
      "The open loop is final verification for release quality.",
    ]);
    expect(result.facts.some((fact) => fact.content.includes("current role"))).toBe(false);
    expect(
      result.metadata.candidateTraces.find((trace) => trace.memoryId === "fact-role-noise-reference")
        ?.whySuppressed,
    ).toBe("slot mismatch");
  });

  it("keeps corrected source-of-truth recall bound to the superseded project's subject across multiple projects", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    await memory.remember({
      scope: { userId: "u-ref", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "Use docs/runbook-v1.md as the source of truth for migration work.",
        },
      ],
    });
    await memory.remember({
      scope: { userId: "u-ref", workspaceId: "workspace-a", sessionId: "s-2" },
      messages: [
        {
          role: "user",
          content:
            "Correction: docs/runbook-v2.md is now the source of truth, not docs/runbook-v1.md. Please update that.",
        },
      ],
    });
    await memory.remember({
      scope: { userId: "u-ref", workspaceId: "workspace-a", sessionId: "s-3" },
      messages: [
        {
          role: "user",
          content: "Use docs/current-runbook.md as the source of truth for payments work.",
        },
      ],
    });

    const result = await memory.recall({
      scope: {
        userId: "u-ref",
        workspaceId: "workspace-a",
        sessionId: "s-4",
      },
      query: "Which runbook is the source of truth for migration work?",
      retrievalProfile: "general_chat",
    });

    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.pointer).toBe("docs/runbook-v2.md");
    expect(result.references[0]?.subject).toBe("migration work");
  });

  it("explains recalled preferences and references even when no profile exists", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.preferences.upsert(
      createPreferenceMemory({
        id: "pref-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "response_style",
        value: "concise",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.references.add(
      createReferenceMemory({
        id: "ref-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        title: "Runbook",
        pointer: "docs/runbook.md",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-1",
      sessionId: "s-10",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-10", workspaceId: "workspace-a" },
      query: "How should I answer this user?",
      retrievalProfile: "general_chat",
    });

    expect(result.profile).toBeNull();
    expect(result.metadata.hits.some((hit) => hit.type === "preference")).toBe(true);
    expect(result.metadata.hits.some((hit) => hit.type === "reference")).toBe(true);
  });

  it("retrieves Chinese facts for Chinese queries without faking English lexical matches", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-zh",
        userId: "u-zh",
        workspaceId: "workspace-a",
        category: "project",
        content: "迁移流程目前仍然被审批阻塞。",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-zh",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const zhResult = await memory.recall({
      scope: { userId: "u-zh", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "现在项目卡在哪里？",
    });
    const enResult = await memory.recall({
      scope: { userId: "u-zh", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "What is the current project blocker?",
      locale: "en-US",
    });

    expect(zhResult.facts).toHaveLength(1);
    expect(zhResult.metadata.locale).toBe("zh-CN");
    expect(enResult.facts).toHaveLength(0);
  });

  it("keeps Chinese blocker-only queries inside the blocker slot", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-zh-blocker",
        userId: "u-zh",
        workspaceId: "workspace-a",
        category: "project",
        factKind: "blocker",
        scopeKind: "project",
        subject: "迁移流程",
        content: "当前阻塞是供应商审批。",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z", locale: "zh-CN" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-zh-open-loop-noise",
        userId: "u-zh",
        workspaceId: "workspace-a",
        category: "project",
        factKind: "open_loop",
        scopeKind: "project",
        subject: "迁移流程",
        content: "当前开环是最终验收。",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z", locale: "zh-CN" },
      }),
    );
    await runtime.startSession({
      userId: "u-zh",
      sessionId: "s-zh-blocker-only",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-zh", sessionId: "s-zh-blocker-only", workspaceId: "workspace-a" },
      query: "当前阻塞是什么？",
      locale: "zh-CN",
      retrievalProfile: "general_chat",
    });

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.content).toBe("当前阻塞是供应商审批。");
    expect(
      result.metadata.candidateTraces.find((trace) => trace.memoryId === "fact-zh-open-loop-noise")
        ?.whySuppressed,
    ).toBe("slot mismatch");
  });

  it("does not leak English facts into Chinese answer-style queries", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.facts.add(
      createFactMemory({
        id: "fact-en",
        userId: "u-zh",
        workspaceId: "workspace-a",
        category: "project",
        content: "The migration is blocked on approval.",
        source: {
          method: "explicit",
          extractedAt: "2026-01-01T00:00:00.000Z",
          locale: "en-US",
        },
      }),
    );
    await runtime.startSession({
      userId: "u-zh",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-zh", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "我应该怎么回复这个用户？",
    });

    expect(result.facts).toHaveLength(0);
  });

  it("does not fall back to English references for Chinese reference-seeking queries", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.references.add(
      createReferenceMemory({
        id: "ref-en",
        userId: "u-zh",
        workspaceId: "workspace-a",
        title: "Migration runbook",
        pointer: "docs/migration-runbook.md",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await runtime.startSession({
      userId: "u-zh",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-zh", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "应该参考哪份文档？",
    });

    expect(result.references).toHaveLength(0);
  });

  it("retrieves Chinese-authored ASCII references for Chinese reference-seeking queries", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    await memory.remember({
      scope: { userId: "u-zh-ref", sessionId: "s-1", workspaceId: "workspace-a" },
      messages: [
        {
          role: "user",
          content: "以docs/migration-runbook.md为准。",
        },
      ],
    });

    const result = await memory.recall({
      scope: { userId: "u-zh-ref", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "应该参考哪份文档？",
    });

    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.pointer).toBe("docs/migration-runbook.md");
  });

  it("does not surface English episodes for Chinese continuation queries", async () => {
    const { documentStore, sessionStore, repositories, runtime } = seedMemory();

    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-en",
        userId: "u-zh",
        workspaceId: "workspace-a",
        sessionId: "s-prev",
        summary: "Last session continued the rollout cleanup and dependency review.",
        keyDecisions: ["Continue with the old rollout checklist."],
        unresolvedItems: ["Review the migration plan."],
        topics: ["rollout", "checklist"],
        importance: 0.8,
        confidence: 0.9,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await runtime.startSession({
      userId: "u-zh",
      sessionId: "s-1",
      workspaceId: "workspace-a",
    });

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await memory.recall({
      scope: { userId: "u-zh", sessionId: "s-1", workspaceId: "workspace-a" },
      query: "继续上次的工作流修复。",
    });

    expect(result.episodes).toHaveLength(0);
  });
});
