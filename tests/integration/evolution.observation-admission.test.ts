import { describe, expect, it } from "bun:test";
import { createGoodMemory } from "../../src";
import type { RecallResult } from "../../src/api/contracts";
import { createEvolutionRuntime } from "../../src/api/evolutionRuntime";
import { createFactMemory } from "../../src/domain/records";
import { createEvidenceRecord } from "../../src/evidence/contracts";
import { createLanguageService } from "../../src/language";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";
import { createMemoryRepositories } from "../../src/storage/repositories";

describe("evolution observation admission", () => {
  it("does not persist ordinary remember or recall operation telemetry", async () => {
    const documentStore = createInMemoryDocumentStore();
    const scope = {
      userId: "operation-observation-user",
      workspaceId: "workspace-a",
    } as const;
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      storage: { provider: "memory" },
    });

    const remembered = await memory.remember({
      messages: [{
        content: "Remember that the deployment region is eu-west-1.",
        role: "user",
      }],
      scope,
    });
    await memory.recall({
      query: "What is the deployment region?",
      scope,
      strategy: "rules-only",
    });
    const exported = await memory.exportMemory({ scope });

    expect(remembered.accepted).toBeGreaterThan(0);
    expect(exported.durable.experiences).toEqual([]);
  });

  it("persists only verification experience records for actionable recall signals", async () => {
    const documentStore = createInMemoryDocumentStore();
    const scope = {
      userId: "verification-observation-user",
      workspaceId: "workspace-a",
    } as const;
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      storage: { provider: "memory" },
      testing: { now: () => new Date("2026-04-02T00:00:00.000Z") },
    });
    await documentStore.set("facts", "stale-fact", createFactMemory({
      category: "project",
      content: "The rollout blocker is vendor approval.",
      createdAt: "2025-12-01T00:00:00.000Z",
      id: "stale-fact",
      source: {
        extractedAt: "2025-12-01T00:00:00.000Z",
        method: "explicit",
      },
      updatedAt: "2025-12-01T00:00:00.000Z",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    }));

    const recall = await memory.recall({
      query: "Proceed using the remembered rollout blocker.",
      retrievalProfile: "coding_agent",
      scope,
    });
    const exported = await memory.exportMemory({ scope });

    expect(recall.metadata.verificationHints).toHaveLength(1);
    expect(exported.durable.experiences).toHaveLength(1);
    expect(exported.durable.experiences[0]).toMatchObject({
      kind: "verify",
      linkedMemoryIds: ["stale-fact"],
    });
  });

  it("reviews actionable observations once and skips routine recall", async () => {
    const documentStore = createInMemoryDocumentStore();
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore: createInMemorySessionStore(),
    });
    const reviewedScopes: string[] = [];
    const runtime = createEvolutionRuntime({
      compiler: { async compile() { return { compiledCount: 0 }; } },
      dreamMaintenance: { async run() { throw new Error("not used"); } },
      governanceRepositories: repositories,
      language: createLanguageService(),
      now: () => "2026-04-02T00:00:00.000Z",
      proposalGate: { async process() { return []; } },
      reviewer: {
        async review({ scope }) {
          reviewedScopes.push(scope.userId);
          return [];
        },
      },
    });
    const scope = { userId: "review-admission-user", workspaceId: "workspace-a" };
    const recallResult: RecallResult = {
      archives: [],
      episodes: [],
      evidence: [],
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
            summary: "rules-only",
            warningMessages: [],
          },
          supportSlots: [],
        },
        tokenCount: 0,
        verificationHints: [],
      },
      packet: {},
      preferences: [],
      profile: null,
      references: [],
      workingMemory: null,
    };

    expect(runtime).not.toHaveProperty("handleRemember");
    await runtime.handleRecall({ result: recallResult, scope });
    expect(reviewedScopes).toEqual([]);

    await runtime.handleRecall({
      result: {
        ...recallResult,
        metadata: {
          ...recallResult.metadata,
          verificationHints: [{
            memoryId: "stale-fact",
            memoryType: "fact",
            reason: "stale action-driving fact",
          }],
        },
      },
      scope,
    });
    expect(reviewedScopes).toEqual([scope.userId]);

    await runtime.handleFeedback({
      result: { accepted: true, kind: "do", outcome: "written" },
      scope,
    });
    expect(reviewedScopes).toHaveLength(2);

    const behavioralOutcome = {
      result: {
        cue: "Copy the report.",
        failureClass: "arg_order",
        firstAction: { kind: "tool_call", name: "copy_file" },
        modelInfluence: "rules-only",
        retrievalProfile: "coding_agent",
        saferAlternative: { kind: "tool_call", name: "copy_file_safely" },
      },
      scope,
      traceId: "review-admission-outcome",
    } satisfies Parameters<typeof runtime.handleBehavioralOutcome>[0];
    await runtime.handleBehavioralOutcome(behavioralOutcome);
    await runtime.handleBehavioralOutcome(behavioralOutcome);
    expect(reviewedScopes).toHaveLength(3);
    expect((await repositories.experiences.listByScope(scope)).map(
      (experience) => experience.kind,
    )).toEqual(["verify", "feedback", "tool_outcome"]);
  });

  it("does not review an actionable observation that failed to persist", async () => {
    const repositories = createMemoryRepositories({
      documentStore: createInMemoryDocumentStore(),
      sessionStore: createInMemorySessionStore(),
    });
    repositories.behavioralOutcomes.add = async () => {
      throw new Error("simulated behavioral outcome write failure");
    };
    let reviewCount = 0;
    const runtime = createEvolutionRuntime({
      compiler: { async compile() { return { compiledCount: 0 }; } },
      dreamMaintenance: { async run() { throw new Error("not used"); } },
      governanceRepositories: repositories,
      language: createLanguageService(),
      now: () => "2026-04-02T00:00:00.000Z",
      proposalGate: { async process() { return []; } },
      reviewer: {
        async review() {
          reviewCount += 1;
          return [];
        },
      },
    });

    await expect(runtime.handleBehavioralOutcome({
      result: {
        cue: "Copy the report.",
        failureClass: "arg_order",
        firstAction: { kind: "tool_call", name: "copy_file" },
        modelInfluence: "rules-only",
        retrievalProfile: "coding_agent",
        saferAlternative: { kind: "tool_call", name: "copy_file_safely" },
      },
      scope: { userId: "failed-actionable-observation" },
    })).rejects.toThrow("simulated behavioral outcome write failure");

    expect(reviewCount).toBe(0);
  });

  it("does not review an evidence-only agent event", async () => {
    const repositories = createMemoryRepositories({
      documentStore: createInMemoryDocumentStore(),
      sessionStore: createInMemorySessionStore(),
    });
    let reviewCount = 0;
    const runtime = createEvolutionRuntime({
      compiler: { async compile() { return { compiledCount: 0 }; } },
      dreamMaintenance: { async run() { throw new Error("not used"); } },
      governanceRepositories: repositories,
      language: createLanguageService(),
      now: () => "2026-04-02T00:00:00.000Z",
      proposalGate: { async process() { return []; } },
      reviewer: {
        async review() {
          reviewCount += 1;
          return [];
        },
      },
    });
    const scope = { userId: "evidence-only-agent-event" };

    await runtime.handleAgentEvent({
      evidence: createEvidenceRecord({
        id: "evidence-only-record",
        userId: scope.userId,
        kind: "conversation_excerpt",
        excerpt: "Evidence persisted before an actionable experience exists.",
        source: { method: "confirmed", extractedAt: "2026-04-02T00:00:00.000Z" },
      }),
      scope,
    });

    expect(reviewCount).toBe(0);
    expect(await repositories.evidence.get("evidence-only-record")).not.toBeNull();
  });
});
