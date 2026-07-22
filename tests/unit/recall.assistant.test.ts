import { describe, expect, it } from "bun:test";
import {
  createEpisodeMemory,
  createFactMemory,
  createReferenceMemory,
} from "../../src/domain/records";
import { createSessionArchive } from "../../src/evolution/contracts";
import {
  applyRecallAssistantPlan,
  applyRecallAssistantRerank,
  buildRecallAssistantCandidates,
} from "../../src/recall/assistant";
import type { RoutingDecision } from "../../src/recall/router";

function buildRoutingDecision(): RoutingDecision {
  return {
    retrievalProfile: "general_chat",
    intent: "general_assistance",
    strategy: "llm-assisted",
    strategyExplanation: {
      requestedStrategy: "llm-assisted",
      resolvedStrategy: "llm-assisted",
      summary: "llm-assisted routing enabled refinement.",
      hardFloor: "lexical_runtime_procedural_priors",
      semanticTieBreaking: false,
      llmRefinement: true,
    },
    sourcePriorities: [
      "profile",
      "feedback",
      "fact",
      "episode",
      "working_memory",
      "session_journal",
    ],
    requestedSlots: ["role"],
    supportSlots: [],
    actionDriving: false,
    referenceSeeking: false,
    continuation: false,
  };
}

describe("recall assistant helpers", () => {
  it("merges safe plan hints without removing deterministic slots", () => {
    const result = applyRecallAssistantPlan({
      influence: {
        addedRequestedSlots: [],
        addedSupportSlots: [],
        decisions: [],
        planApplied: false,
        rerankApplied: false,
        rerankedCandidateIds: [],
        suppressedCandidateIds: [],
      },
      plan: {
        querySummary: "source of truth for the migration",
        rationale: "reference lookup needs project-state support",
        requestedSlotAdditions: ["reference"],
        sourcePriorityOrder: [
          "fact",
          "profile",
          "feedback",
          "episode",
          "working_memory",
          "session_journal",
        ],
        supportSlotAdditions: ["project_state_support"],
      },
      routingDecision: buildRoutingDecision(),
    });

    expect(result.routingDecision.requestedSlots).toEqual(["role", "reference"]);
    expect(result.routingDecision.supportSlots).toEqual(["project_state_support"]);
    expect(result.routingDecision.sourcePriorities[0]).toBe("fact");
    expect(result.influence.planApplied).toBe(true);
    expect(result.influence.querySummary).toContain("source of truth");
    expect(result.influence.routerInfluenceStatus).toBe("applied");
  });

  it("falls back when a plan proposes unknown sources", () => {
    const result = applyRecallAssistantPlan({
      influence: {
        addedRequestedSlots: [],
        addedSupportSlots: [],
        decisions: [],
        planApplied: false,
        rerankApplied: false,
        rerankedCandidateIds: [],
        suppressedCandidateIds: [],
      },
      plan: {
        querySummary: "bad plan",
        rationale: "bad source",
        sourcePriorityOrder: ["fact", "profile", "evidence"],
      },
      routingDecision: buildRoutingDecision(),
    });

    expect(result.routingDecision.sourcePriorities).toEqual(
      buildRoutingDecision().sourcePriorities,
    );
    expect(result.influence.fallbackReason).toBe("invalid_plan_sources");
    expect(result.influence.fallbackStage).toBeUndefined();
    expect(result.influence.routerInfluenceStatus).toBe("full_fallback");
  });

  it("keeps plan influence unapplied when the planner only repeats the deterministic state", () => {
    const routingDecision = buildRoutingDecision();
    const result = applyRecallAssistantPlan({
      influence: {
        addedRequestedSlots: [],
        addedSupportSlots: [],
        decisions: [],
        planApplied: false,
        rerankApplied: false,
        rerankedCandidateIds: [],
        suppressedCandidateIds: [],
      },
      plan: {
        querySummary: "same plan",
        rationale: "same ordering",
        sourcePriorityOrder: [...routingDecision.sourcePriorities],
      },
      routingDecision,
    });

    expect(result.routingDecision).toEqual(routingDecision);
    expect(result.influence.planApplied).toBe(false);
    expect(result.influence.sourcePrioritiesAfter).toBeUndefined();
    expect(result.influence.sourcePrioritiesBefore).toBeUndefined();
    expect(result.influence.routerInfluenceStatus).toBe("applied");
  });

  it("applies bounded rerank within the provided durable candidate pool", () => {
    const fact = createFactMemory({
      id: "fact-1",
      userId: "u-1",
      content: "Current blocker is service account rotation.",
      category: "project",
      factKind: "blocker",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });
    const reference = createReferenceMemory({
      id: "ref-1",
      userId: "u-1",
      title: "Migration runbook",
      pointer: "docs/migration-runbook.md",
      referenceKind: "source_of_truth",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });
    const archive = createSessionArchive({
      id: "archive-1",
      userId: "u-1",
      sessionId: "s-1",
      summary: "Paused while waiting for the runbook confirmation.",
      archivedAt: "2026-01-01T00:00:00.000Z",
    });
    const episode = createEpisodeMemory({
      id: "episode-1",
      userId: "u-1",
      summary: "Investigated the migration blocker and updated the runbook pointer.",
      topics: ["migration"],
    });

    const selection = {
      facts: [fact],
      references: [reference],
      archives: [archive],
      episodes: [episode],
    };
    const candidates = buildRecallAssistantCandidates(selection);

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "fact-1",
      "ref-1",
      "archive-1",
      "episode-1",
    ]);
    expect(candidates.map((candidate) => candidate.protected)).toEqual([
      true,
      true,
      false,
      false,
    ]);

    const reranked = applyRecallAssistantRerank({
      influence: {
        addedRequestedSlots: [],
        addedSupportSlots: [],
        decisions: [],
        planApplied: true,
        querySummary: "runbook source of truth",
        rerankApplied: false,
        rerankedCandidateIds: [],
        suppressedCandidateIds: [],
      },
      rerank: {
        orderedCandidateIds: ["ref-1", "fact-1", "archive-1", "episode-1"],
        rationale: "runbook should lead before blocker detail",
        suppressCandidateIds: ["archive-1"],
        decisions: [
          {
            candidateId: "ref-1",
            decision: "promote",
            reason: "source_of_truth",
          },
          {
            candidateId: "archive-1",
            decision: "suppress",
            reason: "query_alignment",
          },
        ],
      },
      selection,
    });

    expect(reranked.selection.references.map((item) => item.id)).toEqual(["ref-1"]);
    expect(reranked.selection.facts.map((item) => item.id)).toEqual(["fact-1"]);
    expect(reranked.selection.archives).toEqual([]);
    expect(reranked.influence.rerankApplied).toBe(true);
    expect(reranked.influence.routerInfluenceStatus).toBe("applied");
    expect(reranked.influence.suppressedCandidateIds).toEqual(["archive-1"]);
  });

  it("keeps cross-collection ID collisions distinct during assisted rerank", () => {
    const selection = {
      facts: [
        createFactMemory({
          id: "shared-id",
          userId: "u-1",
          content: "Alpha status is awaiting approval.",
          category: "project",
          source: {
            method: "explicit",
            extractedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
        createFactMemory({
          id: "kept-id",
          userId: "u-1",
          content: "Alpha owner is Lin.",
          category: "project",
          source: {
            method: "explicit",
            extractedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ],
      references: [createReferenceMemory({
        id: "shared-id",
        userId: "u-1",
        title: "Alpha approval guide",
        pointer: "docs/alpha.md",
        source: {
          method: "explicit",
          extractedAt: "2026-01-01T00:00:00.000Z",
        },
      })],
      archives: [],
      episodes: [],
    };

    expect(
      buildRecallAssistantCandidates(selection).map(({ id }) => id),
    ).toEqual(["facts:shared-id", "kept-id", "references:shared-id"]);

    const reranked = applyRecallAssistantRerank({
      influence: {
        addedRequestedSlots: [],
        addedSupportSlots: [],
        decisions: [],
        planApplied: true,
        rerankApplied: false,
        rerankedCandidateIds: [],
        suppressedCandidateIds: [],
      },
      rerank: {
        orderedCandidateIds: [
          "kept-id",
          "references:shared-id",
          "facts:shared-id",
        ],
        rationale: "Keep the reference but suppress the stale status.",
        suppressCandidateIds: ["facts:shared-id"],
      },
      selection,
    });

    expect(reranked.selection.facts.map(({ id }) => id)).toEqual(["kept-id"]);
    expect(reranked.selection.references.map(({ id }) => id)).toEqual([
      "shared-id",
    ]);
    expect(reranked.influence.suppressedCandidateIds).toEqual([
      "facts:shared-id",
    ]);
  });

  it("uses a single qualified namespace even when raw IDs resemble candidate keys", () => {
    const selection = {
      facts: [createFactMemory({
        id: "references:x",
        userId: "u-1",
        content: "Alpha status is stale.",
        category: "project",
        source: {
          method: "explicit",
          extractedAt: "2026-01-01T00:00:00.000Z",
        },
      })],
      references: [createReferenceMemory({
        id: "x",
        userId: "u-1",
        title: "Alpha guide",
        pointer: "docs/alpha.md",
        source: {
          method: "explicit",
          extractedAt: "2026-01-01T00:00:00.000Z",
        },
      })],
      archives: [],
      episodes: [],
    };

    expect(
      buildRecallAssistantCandidates(selection).map(({ id }) => id),
    ).toEqual(["facts:references:x", "references:x"]);

    const reranked = applyRecallAssistantRerank({
      influence: {
        addedRequestedSlots: [],
        addedSupportSlots: [],
        decisions: [],
        planApplied: true,
        rerankApplied: false,
        rerankedCandidateIds: [],
        suppressedCandidateIds: [],
      },
      rerank: {
        orderedCandidateIds: ["references:x", "facts:references:x"],
        rationale: "Keep the guide and suppress only the stale fact.",
        suppressCandidateIds: ["facts:references:x"],
      },
      selection,
    });

    expect(reranked.selection.facts).toEqual([]);
    expect(reranked.selection.references.map(({ id }) => id)).toEqual(["x"]);
    expect(reranked.influence.suppressedCandidateIds).toEqual([
      "facts:references:x",
    ]);
  });

  it("does not treat raw protected IDs as aliases for qualified candidates", () => {
    const selection = {
      facts: [createFactMemory({
        id: "shared-id",
        userId: "u-1",
        content: "Alpha status is current.",
        category: "project",
        source: {
          method: "explicit",
          extractedAt: "2026-01-01T00:00:00.000Z",
        },
      })],
      references: [createReferenceMemory({
        id: "shared-id",
        userId: "u-1",
        title: "Alpha guide",
        pointer: "docs/alpha.md",
        source: {
          method: "explicit",
          extractedAt: "2026-01-01T00:00:00.000Z",
        },
      })],
      archives: [],
      episodes: [],
    };

    expect(
      buildRecallAssistantCandidates(selection, {
        protectedCandidateIds: new Set(["shared-id"]),
      }).map(({ id, protected: isProtected }) => ({ id, isProtected })),
    ).toEqual([
      { id: "facts:shared-id", isProtected: false },
      { id: "references:shared-id", isProtected: false },
    ]);
  });

  it("drops explainability decisions that do not match the executed rerank outcome", () => {
    const fact = createFactMemory({
      id: "fact-1",
      userId: "u-1",
      content: "Current blocker is service account rotation.",
      category: "project",
      factKind: "blocker",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });
    const reference = createReferenceMemory({
      id: "ref-1",
      userId: "u-1",
      title: "Migration runbook",
      pointer: "docs/migration-runbook.md",
      referenceKind: "source_of_truth",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });
    const archive = createSessionArchive({
      id: "archive-1",
      userId: "u-1",
      sessionId: "s-1",
      summary: "Paused while waiting for the runbook confirmation.",
      archivedAt: "2026-01-01T00:00:00.000Z",
    });

    const reranked = applyRecallAssistantRerank({
      influence: {
        addedRequestedSlots: [],
        addedSupportSlots: [],
        decisions: [],
        planApplied: true,
        rerankApplied: false,
        rerankedCandidateIds: [],
        suppressedCandidateIds: [],
      },
      rerank: {
        orderedCandidateIds: ["ref-1", "fact-1", "archive-1"],
        rationale: "runbook should lead before blocker detail",
        suppressCandidateIds: ["archive-1"],
        decisions: [
          {
            candidateId: "ref-1",
            decision: "promote",
            reason: "source_of_truth",
          },
          {
            candidateId: "fact-1",
            decision: "suppress",
            reason: "query_alignment",
          },
          {
            candidateId: "archive-1",
            decision: "suppress",
            reason: "query_alignment",
          },
        ],
      },
      selection: {
        facts: [fact],
        references: [reference],
        archives: [archive],
        episodes: [],
      },
    });

    expect(reranked.selection.references.map((item) => item.id)).toEqual(["ref-1"]);
    expect(reranked.selection.facts.map((item) => item.id)).toEqual(["fact-1"]);
    expect(reranked.selection.archives).toEqual([]);
    expect(reranked.influence.decisions).toEqual([
      {
        candidateId: "ref-1",
        decision: "promote",
        reason: "source_of_truth",
      },
      {
        candidateId: "archive-1",
        decision: "suppress",
        reason: "query_alignment",
      },
    ]);
  });

  it("rejects assistant suppression of deterministic hard-floor candidates", () => {
    const fact = createFactMemory({
      id: "fact-1",
      userId: "u-1",
      content: "Current blocker is service account rotation.",
      category: "project",
      factKind: "blocker",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });
    const reference = createReferenceMemory({
      id: "ref-1",
      userId: "u-1",
      title: "Migration runbook",
      pointer: "docs/migration-runbook.md",
      referenceKind: "source_of_truth",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });
    const selection = {
      facts: [fact],
      references: [reference],
      archives: [],
      episodes: [],
    };

    const reranked = applyRecallAssistantRerank({
      influence: {
        addedRequestedSlots: [],
        addedSupportSlots: [],
        decisions: [],
        planApplied: true,
        rerankApplied: false,
        rerankedCandidateIds: [],
        suppressedCandidateIds: [],
      },
      rerank: {
        orderedCandidateIds: ["ref-1", "fact-1"],
        rationale: "drop blocker detail",
        suppressCandidateIds: ["fact-1"],
      },
      selection,
    });

    expect(reranked.selection.facts.map((item) => item.id)).toEqual(["fact-1"]);
    expect(reranked.selection.references.map((item) => item.id)).toEqual(["ref-1"]);
    expect(reranked.influence.fallbackReason).toBe("unsafe_suppress");
    expect(reranked.influence.fallbackStage).toBe("rerank");
    expect(reranked.influence.routerInfluenceStatus).toBe("partial_fallback");
    expect(reranked.influence.rerankApplied).toBe(false);
  });

  it("marks planner success followed by rerank rejection as a partial fallback", () => {
    const fact = createFactMemory({
      id: "fact-1",
      userId: "u-1",
      content: "Current blocker is service account rotation.",
      category: "project",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });

    const reranked = applyRecallAssistantRerank({
      influence: {
        addedRequestedSlots: [],
        addedSupportSlots: [],
        decisions: [],
        planApplied: true,
        rerankApplied: false,
        rerankedCandidateIds: [],
        routerInfluenceStatus: "applied",
        sourcePrioritiesAfter: ["fact", "profile", "feedback", "episode"],
        sourcePrioritiesBefore: ["profile", "feedback", "fact", "episode"],
        suppressedCandidateIds: [],
      },
      rerank: {
        orderedCandidateIds: ["fact-1", "unknown-id"],
        rationale: "bad candidate injection",
      },
      selection: {
        facts: [fact],
        references: [],
        archives: [],
        episodes: [],
      },
    });

    expect(reranked.influence.fallbackReason).toBe("invalid_rerank_candidates");
    expect(reranked.influence.fallbackStage).toBe("rerank");
    expect(reranked.influence.routerInfluenceStatus).toBe("partial_fallback");
  });

  it("falls back when rerank injects unknown candidate ids", () => {
    const fact = createFactMemory({
      id: "fact-1",
      userId: "u-1",
      content: "Current blocker is service account rotation.",
      category: "project",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });

    const reranked = applyRecallAssistantRerank({
      influence: {
        addedRequestedSlots: [],
        addedSupportSlots: [],
        decisions: [],
        planApplied: true,
        rerankApplied: false,
        rerankedCandidateIds: [],
        suppressedCandidateIds: [],
      },
      rerank: {
        orderedCandidateIds: ["fact-1", "unknown-id"],
        rationale: "bad candidate injection",
      },
      selection: {
        facts: [fact],
        references: [],
        archives: [],
        episodes: [],
      },
    });

    expect(reranked.selection.facts.map((item) => item.id)).toEqual(["fact-1"]);
    expect(reranked.influence.fallbackReason).toBe("invalid_rerank_candidates");
    expect(reranked.influence.routerInfluenceStatus).toBe("partial_fallback");
  });

  it("falls back when rerank omits every candidate id", () => {
    const fact = createFactMemory({
      id: "fact-1",
      userId: "u-1",
      content: "Current blocker is service account rotation.",
      category: "project",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });

    const reranked = applyRecallAssistantRerank({
      influence: {
        addedRequestedSlots: [],
        addedSupportSlots: [],
        decisions: [],
        planApplied: true,
        rerankApplied: false,
        rerankedCandidateIds: [],
        suppressedCandidateIds: [],
      },
      rerank: {
        orderedCandidateIds: [],
        rationale: "no candidates",
      },
      selection: {
        facts: [fact],
        references: [],
        archives: [],
        episodes: [],
      },
    });

    expect(reranked.influence.fallbackReason).toBe("invalid_rerank_candidates");
    expect(reranked.influence.fallbackStage).toBe("rerank");
    expect(reranked.influence.routerInfluenceStatus).toBe("partial_fallback");
  });

  it("falls back when rerank suppresses an unknown candidate id", () => {
    const fact = createFactMemory({
      id: "fact-1",
      userId: "u-1",
      content: "Current blocker is service account rotation.",
      category: "project",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });

    const reranked = applyRecallAssistantRerank({
      influence: {
        addedRequestedSlots: [],
        addedSupportSlots: [],
        decisions: [],
        planApplied: true,
        rerankApplied: false,
        rerankedCandidateIds: [],
        suppressedCandidateIds: [],
      },
      rerank: {
        orderedCandidateIds: ["fact-1"],
        rationale: "bad suppress",
        suppressCandidateIds: ["missing-id"],
      },
      selection: {
        facts: [fact],
        references: [],
        archives: [],
        episodes: [],
      },
    });

    expect(reranked.selection.facts.map((item) => item.id)).toEqual(["fact-1"]);
    expect(reranked.influence.fallbackReason).toBe("invalid_rerank_candidates");
    expect(reranked.influence.fallbackStage).toBe("rerank");
    expect(reranked.influence.routerInfluenceStatus).toBe("partial_fallback");
  });

  it("falls back when rerank suppresses every retained candidate", () => {
    const fact = createFactMemory({
      id: "fact-1",
      userId: "u-1",
      content: "Current blocker is service account rotation.",
      category: "project",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });
    const archive = createSessionArchive({
      id: "archive-1",
      userId: "u-1",
      sessionId: "s-1",
      summary: "Paused while waiting on the migration runbook confirmation.",
      archivedAt: "2026-01-01T00:00:00.000Z",
    });

    const reranked = applyRecallAssistantRerank({
      influence: {
        addedRequestedSlots: [],
        addedSupportSlots: [],
        decisions: [],
        planApplied: true,
        rerankApplied: false,
        rerankedCandidateIds: [],
        suppressedCandidateIds: [],
      },
      rerank: {
        orderedCandidateIds: ["archive-1"],
        rationale: "suppress all",
        suppressCandidateIds: ["archive-1"],
      },
      selection: {
        facts: [fact],
        references: [],
        archives: [archive],
        episodes: [],
      },
    });

    expect(reranked.influence.fallbackReason).toBe("empty_rerank");
    expect(reranked.influence.fallbackStage).toBe("rerank");
    expect(reranked.influence.routerInfluenceStatus).toBe("partial_fallback");
  });

  it("keeps omitted candidates in stable order after ranked hits", () => {
    const fact = createFactMemory({
      id: "fact-1",
      userId: "u-1",
      content: "Current blocker is service account rotation.",
      category: "project",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });
    const archiveA = createSessionArchive({
      id: "archive-1",
      userId: "u-1",
      sessionId: "s-1",
      summary: "First archive summary.",
      archivedAt: "2026-01-01T00:00:00.000Z",
    });
    const archiveB = createSessionArchive({
      id: "archive-2",
      userId: "u-1",
      sessionId: "s-2",
      summary: "Second archive summary.",
      archivedAt: "2026-01-01T00:00:00.000Z",
    });

    const reranked = applyRecallAssistantRerank({
      influence: {
        addedRequestedSlots: [],
        addedSupportSlots: [],
        decisions: [],
        planApplied: true,
        rerankApplied: false,
        rerankedCandidateIds: [],
        suppressedCandidateIds: [],
      },
      rerank: {
        orderedCandidateIds: ["fact-1"],
        rationale: "rank the fact but leave archives alone",
      },
      selection: {
        facts: [fact],
        references: [],
        archives: [archiveA, archiveB],
        episodes: [],
      },
    });

    expect(reranked.selection.facts.map((item) => item.id)).toEqual(["fact-1"]);
    expect(reranked.selection.archives.map((item) => item.id)).toEqual([
      "archive-1",
      "archive-2",
    ]);
    expect(reranked.influence.rerankApplied).toBe(true);
  });
});
