import { describe, expect, it } from "bun:test";

import { createGoodMemory } from "../../src";
import type { RecallResult } from "../../src/api/contracts";
import { renderMemoryPacket } from "../../src/recall/contextBuilder";

function createRecallResult(): RecallResult {
  return {
    archives: [],
    episodes: [],
    evidence: [],
    evidenceLedger: [{
      actor: "Alice",
      evidenceId: "evidence-1",
      excerpt: `Atlas is active. ${"detail ".repeat(100)}`,
      relation: "supports",
      sourceMemoryId: "memory-1",
      temporalStatus: "current",
      claim: {
        evidenceIds: ["evidence-1"],
        extractorVersion: "test-v1",
        id: "claim-1",
        ingestedAt: "2026-07-03T00:00:00.000Z",
        modality: "asserted",
        objectText: "Atlas",
        observedAt: "2026-07-03T00:00:00.000Z",
        polarity: "positive",
        predicateKey: "profile.current_project",
        schemaVersion: 2,
        text: "profile.current_project Atlas",
        searchText: "profile current project atlas",
        searchLocale: "en-US",
        languagePackId: "en",
        searchAnalyzerVersion: "test-v1",
        searchSchemaVersion: "gm-search-v2",
        scopeKey: "user-1::::workspace-1::::",
        sourceMemoryId: "memory-1",
        sourceMessageIds: ["message-1"],
        subjectEntityId: "entity-alice",
        userId: "user-1",
        workspaceId: "workspace-1",
      },
    }],
    facts: [],
    feedback: [],
    journal: null,
    metadata: {
      candidateTraces: [],
      hits: [],
      latencyMs: 0,
      policyApplied: [],
      routingDecision: {
        actionDriving: false,
        continuation: false,
        intent: "general_assistance",
        referenceSeeking: false,
        requestedSlots: [],
        retrievalProfile: "general_chat",
        sourcePriorities: [],
        strategy: "rules-only",
        strategyExplanation: {
          hardFloor: "lexical_runtime_procedural_priors",
          llmRefinement: false,
          requestedStrategy: "rules-only",
          resolvedStrategy: "rules-only",
          semanticTieBreaking: false,
          summary: "test",
        },
        supportSlots: [],
      },
      tokenCount: 0,
      verificationHints: [],
    },
    packet: {
      debug: { estimatedTokens: 4, omittedSections: [] },
      evidenceSummary: "legacy raw evidence summary",
      renderBudget: { maxTokens: 6_000 },
    },
    preferences: [],
    profile: null,
    references: [],
    workingMemory: null,
  };
}

describe("buildContext evidence-ledger answer wiring", () => {
  it("keeps default context byte-identical when ledger rendering is not requested", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const recall = createRecallResult();
    const expected = renderMemoryPacket(recall.packet, "markdown");

    const context = await memory.buildContext({ recall, output: "markdown" });

    expect(context.content).toBe(expected.content);
    expect(context.content).toContain("legacy raw evidence summary");
    expect(context.content).not.toContain("profile.current_project");
  });

  it("replaces raw evidence summary with the selected typed-ledger format", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const recall = createRecallResult();

    const context = await memory.buildContext({
      evidenceLedgerFormat: "compact_json",
      recall,
      output: "markdown",
    });

    expect(context.content).not.toContain("legacy raw evidence summary");
    expect(context.content).toContain('"predicate":"profile.current_project"');
    expect(context.content).toContain('"status":"current"');
  });

  it("applies the existing unified render budget after ledger replacement", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });

    const context = await memory.buildContext({
      evidenceLedgerFormat: "prose",
      maxTokens: 20,
      output: "markdown",
      recall: createRecallResult(),
    });

    expect(context.estimatedTokens).toBeLessThanOrEqual(20);
    expect(Buffer.byteLength(context.content, "utf8")).toBeLessThanOrEqual(80);
    expect(context.content).not.toContain("detail ".repeat(100));
  });
});
