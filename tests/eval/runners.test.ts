import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createGoodMemory } from "../../src";
import type { GoodMemory } from "../../src/api/contracts";
import { attachGoodMemoryEvalSupport } from "../../src/api/evalSupport";
import { createFeedbackMemory } from "../../src/domain/records";
import {
  createLearningProposal,
  createPromotionRecord,
} from "../../src/evolution/contracts";
import { createSessionArchive } from "../../src/evolution/contracts";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src/storage/memory";
import { createMemoryRepositories } from "../../src/storage/repositories";
import { createFakeEmbeddingAdapter } from "../../src/testing/fakes";
import {
  loadPersonaSpec,
  loadScenarioFixture,
} from "../../src/eval/dataset";
import {
  runBaselineScenario,
  buildEvalUserId,
  buildEvalWorkspaceId,
  runGoodMemoryScenario,
} from "../../src/eval/runners";

function buildEmptyExportMemoryResult(userId: string, workspaceId: string) {
  return {
    artifacts: {
      markdown: "",
      manifest: {
        scope: { userId, workspaceId },
        sections: [],
        generatedAt: "2026-04-15T00:00:00.000Z",
      },
      files: {},
    },
    scope: { userId, workspaceId },
    exportedAt: "2026-04-15T00:00:00.000Z",
    durable: {
      profile: null,
      preferences: [],
      references: [],
      facts: [],
      feedback: [],
      episodes: [],
      archives: [],
      evidence: [],
      experiences: [],
      proposals: [],
      promotions: [],
    },
  };
}

describe("eval runners", () => {
  it("builds a baseline answer package without memory context", async () => {
    const persona = await loadPersonaSpec(
      join(import.meta.dir, "../../fixtures/personas/eval/medium-01.json"),
    );
    const scenario = await loadScenarioFixture(
      join(import.meta.dir, "../../fixtures/scenarios/eval/scenario-medium-01.json"),
    );

    const result = await runBaselineScenario({
      persona,
      scenario,
      answerGenerator: async (input) => ({
        content: input.memoryContext ? "unexpected" : "baseline-answer",
      }),
    });

    expect(result.mode).toBe("baseline");
    expect(result.memoryContext).toBeUndefined();
    expect(result.answer).toBe("baseline-answer");
    expect(result.trace.sessionsReplayed).toBe(0);
  });

  it("replays scenario history through GoodMemory and builds a memory-backed answer package", async () => {
    const persona = await loadPersonaSpec(
      join(import.meta.dir, "../../fixtures/personas/eval/medium-01.json"),
    );
    const scenario = await loadScenarioFixture(
      join(import.meta.dir, "../../fixtures/scenarios/eval/scenario-medium-01.json"),
    );
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await runGoodMemoryScenario({
      memory,
      persona,
      scenario,
      answerGenerator: async (input) => ({
        content: input.memoryContext?.includes("runbook")
          ? "goodmemory-answer"
          : "missing-context",
      }),
    });

    expect(result.mode).toBe("goodmemory");
    expect(result.strategyLabel).toBe("auto");
    expect(result.memoryContext).toContain("runbook");
    expect(result.answer).toBe("goodmemory-answer");
    expect(result.trace.sessionsReplayed).toBeGreaterThan(0);
    expect(result.trace.rememberEvents.length).toBeGreaterThan(0);
    expect(result.trace.recallHitCount).toBeGreaterThan(0);
    expect(
      result.trace.rememberEvents.some((session) => session.events.length > 0),
    ).toBe(true);
    expect(
      result.trace.rememberEvents
        .flatMap((session) => session.events)
        .some((event) => event.memoryType === "reference"),
    ).toBe(true);
    expect(result.retrieved?.references.length).toBeGreaterThan(0);
    expect(result.retrieved?.evidence.length).toBeGreaterThan(0);
    expect(result.retrieved?.hits.some((hit) => hit.type === "reference")).toBe(true);
    expect(result.retrieved?.candidateTraces.length).toBeGreaterThan(0);
    expect(
      result.retrieved?.candidateTraces.some(
        (trace) => trace.returned && typeof trace.whyReturned === "string",
      ),
    ).toBe(true);
    expect(result.retrieved?.renderedMemoryContext).toContain("runbook");
    expect(result.memoryContext).toContain("final verification for migration rollout");
    expect(
      result.retrieved?.feedback.some((feedback) =>
        feedback.rule.includes("Please confirm the updated runbook"),
      ) ?? false,
    ).toBe(false);
    expect(result.trace.proposalLifecycle?.experienceCount).toBeGreaterThan(0);
    expect(result.trace.proposalLifecycle?.proposalCount).toBeGreaterThanOrEqual(0);
    expect(result.trace.proposalLifecycle?.promotionCount).toBeGreaterThanOrEqual(
      result.trace.proposalLifecycle?.proposalCount ?? 0,
    );
    expect(result.trace.maintenanceSummary?.activeValidatedPatternCount).toBeGreaterThanOrEqual(0);
    expect(result.trace.maintenanceSummary?.compiledValidatedPatternCount).toBeGreaterThanOrEqual(0);
    expect(result.trace.maintenanceSummary?.pressuredFactCount).toBeGreaterThanOrEqual(0);
    expect(result.transcript).not.toContain("I can do that once I have the full remembered context.");
  });

  it("preserves auto routing when no rollout is configured", async () => {
    const persona = await loadPersonaSpec(
      join(import.meta.dir, "../../fixtures/personas/eval/medium-01.json"),
    );
    const scenario = await loadScenarioFixture(
      join(import.meta.dir, "../../fixtures/scenarios/eval/scenario-medium-01.json"),
    );
    const recallStrategies: string[] = [];
    const workspaceId = `eval-${persona.lifecycle_bucket}`;
    const memory = {
      async remember() {
        return {
          accepted: 0,
          rejected: 0,
          events: [],
          metadata: {
            locale: "en-US",
            localeSource: "default" as const,
            languagePackId: "en",
            analysisMode: "rules-only" as const,
            requestedExtractionStrategy: "auto" as const,
            resolvedExtractionStrategy: "rules-only" as const,
          },
        };
      },
      async feedback() {
        return { accepted: false };
      },
      async recall(input: { strategy?: string }) {
        recallStrategies.push(input.strategy ?? "missing");

        return {
          profile: null,
          preferences: [],
          references: [],
          facts: [],
          feedback: [],
          archives: [],
          evidence: [],
          episodes: [],
          workingMemory: null,
          journal: null,
          packet: {
            locale: "en-US",
            profile: null,
            preferences: [],
            references: [],
            facts: [],
            feedback: [],
            archives: [],
            evidence: [],
            episodes: [],
            workingMemory: null,
            journal: null,
            routingDecision: {
              retrievalProfile: "general_chat",
              intent: "general_assistance",
              strategy: "rules-only" as const,
              strategyExplanation: {
                requestedStrategy: "auto" as const,
                resolvedStrategy: "rules-only" as const,
                summary: "auto routing stayed rules-only",
                hardFloor: "lexical_runtime_procedural_priors" as const,
                semanticTieBreaking: false,
                llmRefinement: false,
              },
              sourcePriorities: ["profile", "feedback", "fact"],
              requestedSlots: [],
              supportSlots: [],
              actionDriving: false,
              referenceSeeking: false,
              continuation: false,
            },
          },
          metadata: {
            routingDecision: {
              retrievalProfile: "general_chat",
              intent: "general_assistance",
              strategy: "rules-only" as const,
              strategyExplanation: {
                requestedStrategy: "auto" as const,
                resolvedStrategy: "rules-only" as const,
                summary: "auto routing stayed rules-only",
                hardFloor: "lexical_runtime_procedural_priors" as const,
                semanticTieBreaking: false,
                llmRefinement: false,
              },
              sourcePriorities: ["profile", "feedback", "fact"],
              requestedSlots: [],
              supportSlots: [],
              actionDriving: false,
              referenceSeeking: false,
              continuation: false,
            },
            tokenCount: 0,
            latencyMs: 0,
            hits: [],
            candidateTraces: [],
            verificationHints: [],
            policyApplied: [],
          },
        };
      },
      async buildContext() {
        return {
          output: "markdown" as const,
          content: "memory context",
          estimatedTokens: 3,
          omittedSections: [],
        };
      },
      async forget() {
        return { forgotten: false };
      },
      async deleteAllMemory(input: { scope: { userId: string; workspaceId: string } }) {
        return {
          scope: input.scope,
          deleted: {
            profiles: 0,
            preferences: 0,
            references: 0,
            facts: 0,
            feedback: 0,
            episodes: 0,
            archives: 0,
            evidence: 0,
            experiences: 0,
            proposals: 0,
            promotions: 0,
            workingMemory: 0,
            journal: 0,
            artifactSpills: 0,
          },
        };
      },
      async exportMemory() {
        return buildEmptyExportMemoryResult(persona.persona_id, workspaceId);
      },
      async runMaintenance() {
        return {
          compiledCount: 0,
          maintenance: null,
          promotionDecisionCounts: {},
          proposalCount: 0,
          ran: false,
          reason: "threshold" as const,
        };
      },
    } as unknown as GoodMemory;

    const result = await runGoodMemoryScenario({
      memory,
      persona,
      scenario,
      answerGenerator: async (input) => ({
        content: input.memoryContext ?? "missing-context",
      }),
    });

    expect(recallStrategies).toEqual(["auto"]);
    expect(result.strategyLabel).toBe("auto");
    expect(result.strategyMode).toBeUndefined();
    expect(result.promotedStrategyLabel).toBeUndefined();
    expect(result.candidateInfluencedExecution).toBeUndefined();
  });

  it("runs reviewer assist rollout as an eval-only proposal annotation path without changing recall routing", async () => {
    const persona = await loadPersonaSpec(
      join(import.meta.dir, "../../fixtures/personas/eval/medium-01.json"),
    );
    const scenario = await loadScenarioFixture(
      join(import.meta.dir, "../../fixtures/scenarios/eval/scenario-medium-01.json"),
    );
    const recallStrategies: string[] = [];
    const workspaceId = `eval-${persona.lifecycle_bucket}`;
    const memory = {
      async remember() {
        return {
          accepted: 0,
          rejected: 0,
          events: [],
          metadata: {
            locale: "en-US",
            localeSource: "default" as const,
            languagePackId: "en",
            analysisMode: "rules-only" as const,
            requestedExtractionStrategy: "auto" as const,
            resolvedExtractionStrategy: "rules-only" as const,
          },
        };
      },
      async feedback() {
        return { accepted: false };
      },
      async recall(input: { strategy?: string }) {
        recallStrategies.push(input.strategy ?? "missing");

        return {
          profile: null,
          preferences: [],
          references: [],
          facts: [],
          feedback: [],
          archives: [],
          evidence: [],
          episodes: [],
          workingMemory: null,
          journal: null,
          packet: {
            locale: "en-US",
            profile: null,
            preferences: [],
            references: [],
            facts: [],
            feedback: [],
            archives: [],
            evidence: [],
            episodes: [],
            workingMemory: null,
            journal: null,
            routingDecision: {
              retrievalProfile: "general_chat",
              intent: "general_assistance",
              strategy: "rules-only" as const,
              strategyExplanation: {
                requestedStrategy: "rules-only" as const,
                resolvedStrategy: "rules-only" as const,
                summary: "rules-only retrieval stayed on the executed path",
                hardFloor: "lexical_runtime_procedural_priors" as const,
                semanticTieBreaking: false,
                llmRefinement: false,
              },
              sourcePriorities: ["profile", "feedback", "fact"],
              requestedSlots: [],
              supportSlots: [],
              actionDriving: false,
              referenceSeeking: false,
              continuation: false,
            },
          },
          metadata: {
            routingDecision: {
              retrievalProfile: "general_chat",
              intent: "general_assistance",
              strategy: "rules-only" as const,
              strategyExplanation: {
                requestedStrategy: "rules-only" as const,
                resolvedStrategy: "rules-only" as const,
                summary: "rules-only retrieval stayed on the executed path",
                hardFloor: "lexical_runtime_procedural_priors" as const,
                semanticTieBreaking: false,
                llmRefinement: false,
              },
              sourcePriorities: ["profile", "feedback", "fact"],
              requestedSlots: [],
              supportSlots: [],
              actionDriving: false,
              referenceSeeking: false,
              continuation: false,
            },
            tokenCount: 0,
            latencyMs: 0,
            hits: [],
            candidateTraces: [],
            verificationHints: [],
            policyApplied: [],
          },
        };
      },
      async buildContext() {
        return {
          output: "markdown" as const,
          content: "memory context",
          estimatedTokens: 3,
          omittedSections: [],
        };
      },
      async forget() {
        return { forgotten: false };
      },
      async deleteAllMemory(input: { scope: { userId: string; workspaceId: string } }) {
        return {
          scope: input.scope,
          deleted: {
            profiles: 0,
            preferences: 0,
            references: 0,
            facts: 0,
            feedback: 0,
            episodes: 0,
            archives: 0,
            evidence: 0,
            experiences: 0,
            proposals: 0,
            promotions: 0,
            workingMemory: 0,
            journal: 0,
            artifactSpills: 0,
          },
        };
      },
      async exportMemory() {
        const exported = buildEmptyExportMemoryResult(persona.persona_id, workspaceId);
        return {
          ...exported,
          durable: {
            ...exported.durable,
            proposals: [
              {
                id: "proposal-1",
                userId: persona.persona_id,
                workspaceId,
                proposalType: "procedural_pattern" as const,
                status: "accepted" as const,
                traceId: "proposal-trace-1",
                summary: "[assisted reviewer] Promote stable review opening guidance.",
                rationale:
                  "[assisted reviewer] Rules-only reviewer found repeated successful feedback lineage.",
                sourceExperienceIds: ["xp-1", "xp-2"],
                linkedMemoryIds: ["feedback-1"],
                linkedArchiveIds: [],
                linkedEvidenceIds: ["evidence-1"],
                modelInfluence: "llm-assisted" as const,
                createdAt: "2026-04-15T00:00:00.000Z",
                updatedAt: "2026-04-15T00:00:00.000Z",
              },
            ],
            promotions: [],
          },
        };
      },
      async runMaintenance() {
        return {
          compiledCount: 0,
          maintenance: null,
          promotionDecisionCounts: {},
          proposalCount: 0,
          ran: false,
          reason: "threshold" as const,
        };
      },
    } as unknown as GoodMemory;
    attachGoodMemoryEvalSupport(memory, {
      assistedReviewer: true,
    });

    const result = await runGoodMemoryScenario({
      memory,
      persona,
      scenario,
      strategy: "rules-only",
      strategyRollout: {
        family: "reviewer",
        mode: "assist",
      },
      answerGenerator: async (input) => ({
        content: input.memoryContext ?? "missing-context",
      }),
    });

    expect(recallStrategies).toEqual(["rules-only"]);
    expect(result.strategyFamily).toBe("reviewer");
    expect(result.strategyMode).toBe("assist");
    expect(result.strategyLabel).toBe("assisted");
    expect(result.resolvedStrategyLabel).toBe("assisted");
    expect(result.promotedStrategyLabel).toBe("rules-only");
    expect(result.candidateInfluencedExecution).toBe(true);
    expect(result.trace.proposalLifecycle?.proposals[0]).toMatchObject({
      summary: "[assisted reviewer] Promote stable review opening guidance.",
      rationale:
        "[assisted reviewer] Rules-only reviewer found repeated successful feedback lineage.",
      modelInfluence: "llm-assisted",
    });
  });

  it("runs maintenance assist rollout through the public maintenance API before the final recall", async () => {
    const persona = await loadPersonaSpec(
      join(import.meta.dir, "../../fixtures/personas/eval/medium-01.json"),
    );
    const scenario = await loadScenarioFixture(
      join(import.meta.dir, "../../fixtures/scenarios/eval/scenario-medium-01.json"),
    );
    const recallStrategies: string[] = [];
    const maintenanceRuns: Array<{
      jobs?: string[];
      scope: { userId: string; workspaceId: string };
    }> = [];
    const workspaceId = `eval-${persona.lifecycle_bucket}`;
    const memory = {
      async remember() {
        return {
          accepted: 0,
          rejected: 0,
          events: [],
          metadata: {
            locale: "en-US",
            localeSource: "default" as const,
            languagePackId: "en",
            analysisMode: "rules-only" as const,
            requestedExtractionStrategy: "auto" as const,
            resolvedExtractionStrategy: "rules-only" as const,
          },
        };
      },
      async feedback() {
        return { accepted: false };
      },
      async recall(input: { strategy?: string }) {
        recallStrategies.push(input.strategy ?? "missing");

        return {
          profile: null,
          preferences: [],
          references: [],
          facts: [],
          feedback: [],
          archives: [],
          evidence: [],
          episodes: [],
          workingMemory: null,
          journal: null,
          packet: {
            locale: "en-US",
            profile: null,
            preferences: [],
            references: [],
            facts: [],
            feedback: [],
            archives: [],
            evidence: [],
            episodes: [],
            workingMemory: null,
            journal: null,
            routingDecision: {
              retrievalProfile: "general_chat",
              intent: "general_assistance",
              strategy: "rules-only" as const,
              strategyExplanation: {
                requestedStrategy: "rules-only" as const,
                resolvedStrategy: "rules-only" as const,
                summary: "rules-only retrieval stayed on the executed path",
                hardFloor: "lexical_runtime_procedural_priors" as const,
                semanticTieBreaking: false,
                llmRefinement: false,
              },
              sourcePriorities: ["profile", "feedback", "fact"],
              requestedSlots: [],
              supportSlots: [],
              actionDriving: false,
              referenceSeeking: false,
              continuation: false,
            },
          },
          metadata: {
            routingDecision: {
              retrievalProfile: "general_chat",
              intent: "general_assistance",
              strategy: "rules-only" as const,
              strategyExplanation: {
                requestedStrategy: "rules-only" as const,
                resolvedStrategy: "rules-only" as const,
                summary: "rules-only retrieval stayed on the executed path",
                hardFloor: "lexical_runtime_procedural_priors" as const,
                semanticTieBreaking: false,
                llmRefinement: false,
              },
              sourcePriorities: ["profile", "feedback", "fact"],
              requestedSlots: [],
              supportSlots: [],
              actionDriving: false,
              referenceSeeking: false,
              continuation: false,
            },
            tokenCount: 0,
            latencyMs: 0,
            hits: [],
            candidateTraces: [],
            verificationHints: [],
            policyApplied: [],
          },
        };
      },
      async buildContext() {
        return {
          output: "markdown" as const,
          content: "memory context",
          estimatedTokens: 3,
          omittedSections: [],
        };
      },
      async forget() {
        return { forgotten: false };
      },
      async deleteAllMemory(input: { scope: { userId: string; workspaceId: string } }) {
        return {
          scope: input.scope,
          deleted: {
            profiles: 0,
            preferences: 0,
            references: 0,
            facts: 0,
            feedback: 0,
            episodes: 0,
            archives: 0,
            evidence: 0,
            experiences: 0,
            proposals: 0,
            promotions: 0,
            workingMemory: 0,
            journal: 0,
            artifactSpills: 0,
          },
        };
      },
      async exportMemory() {
        return buildEmptyExportMemoryResult(persona.persona_id, workspaceId);
      },
      async runMaintenance(input: {
        jobs?: string[];
        scope: { userId: string; workspaceId: string };
      }) {
        maintenanceRuns.push(input);
        return {
          compiledCount: 1,
          maintenance: null,
          promotionDecisionCounts: {},
          proposalCount: 0,
          ran: true,
          reason: "completed" as const,
        };
      },
    } as unknown as GoodMemory;

    const result = await runGoodMemoryScenario({
      memory,
      persona,
      scenario,
      strategy: "rules-only",
      strategyRollout: {
        family: "maintenance",
        mode: "assist",
      },
      answerGenerator: async (input) => ({
        content: input.memoryContext ?? "missing-context",
      }),
    });

    expect(recallStrategies).toEqual(["rules-only"]);
    expect(maintenanceRuns).toEqual([
      {
        scope: {
          userId: persona.persona_id,
          workspaceId,
        },
        jobs: [
          "qualityRepair",
          "dedupe",
          "contradiction",
          "consolidation",
          "embeddingRepair",
        ],
      },
    ]);
    expect(result.strategyFamily).toBe("maintenance");
    expect(result.strategyMode).toBe("assist");
    expect(result.strategyLabel).toBe("outcome-aware");
    expect(result.resolvedStrategyLabel).toBe("outcome-aware");
    expect(result.promotedStrategyLabel).toBe("default-hygiene");
    expect(result.candidateInfluencedExecution).toBe(true);
  });

  it("captures governed procedural reuse when accepted procedural promotions compile before the final recall", async () => {
    const persona = await loadPersonaSpec(
      join(import.meta.dir, "../../fixtures/personas/eval/medium-01.json"),
    );
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
      testing: {
        now: () => new Date("2026-04-17T00:00:00.000Z"),
      },
    });
    const userId = buildEvalUserId(persona);
    const workspaceId = buildEvalWorkspaceId(persona);

    await documentStore.set(
      "feedback",
      "feedback-source",
      createFeedbackMemory({
        id: "feedback-source",
        userId,
        workspaceId,
        rule: "Use bullet points in summaries.",
        kind: "do",
        appliesTo: "general_response",
        source: {
          method: "explicit",
          extractedAt: "2026-04-01T00:00:00.000Z",
        },
        updatedAt: "2026-04-01T00:00:00.000Z",
      }),
    );
    await documentStore.set(
      "learning_proposals",
      "proposal-1",
      createLearningProposal({
        id: "proposal-1",
        userId,
        workspaceId,
        proposalType: "procedural_pattern",
        status: "accepted",
        traceId: "proposal-trace-1",
        summary: "Promote repeated bullet-summary guidance into a governed pattern.",
        rationale: "Repeated successful feedback established stable summary guidance.",
        linkedMemoryIds: ["feedback-source"],
        sourceExperienceIds: ["xp-1", "xp-2"],
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
      }),
    );
    await documentStore.set(
      "promotion_records",
      "promotion-1",
      createPromotionRecord({
        id: "promotion-1",
        proposalId: "proposal-1",
        userId,
        workspaceId,
        decision: "accepted",
        traceId: "promotion-trace-1",
        summary:
          "accepted proposal: Promote repeated bullet-summary guidance into a governed pattern.",
        rationale: "proposal passed deterministic gates",
        linkedMemoryIds: ["feedback-source"],
        sourceExperienceIds: ["xp-1", "xp-2"],
        policyOutcome: "passed",
        verificationOutcome: "passed",
        evalOutcome: "passed",
        createdAt: "2026-04-17T00:00:00.000Z",
        decidedAt: "2026-04-17T00:00:00.000Z",
      }),
    );

    await memory.runMaintenance({
      scope: { userId, workspaceId },
      jobs: [],
    });

    const result = await runGoodMemoryScenario({
      memory,
      persona,
      scenario: {
        scenario_id: "scenario-phase-16-governed-procedural-reuse",
        persona_id: persona.persona_id,
        lifecycle_bucket: persona.lifecycle_bucket,
        task_family: "preference_continuation",
        domain: "work_ops",
        memory_source_domains: ["work_ops"],
        evaluation_setting: "single_domain",
        required_phenomena: [
          "confirmation",
          "correction",
          "historical_task_continuation",
          "identity_reveal",
          "open_loop",
          "stale_info",
        ],
        sessions: [
          {
            session_id: "session-1",
            objective: "Create a replay step that can trigger compilation before the final recall.",
            turns: [
              {
                role: "user",
                content: "We are preparing a release status summary for rollout readiness.",
              },
              {
                role: "assistant",
                content: "Understood. I will keep the status summary tight and actionable.",
              },
            ],
          },
          {
            session_id: "session-2",
            objective: "Check whether the compiled procedural pattern is reused on recall.",
            turns: [
              {
                role: "user",
                content: "Please summarize the current rollout status.",
              },
            ],
          },
        ],
        evaluation: {
          prompt: "Please summarize the current rollout status.",
          rubric_focus: ["history_open_loop"],
          expected_identity_signals: [],
          expected_history_signals: ["bullet points"],
          expected_transfer_signals: ["Use bullet points in summaries."],
          expected_non_transfer_signals: [],
          expected_update_wins: [],
          expected_stale_suppression: [],
          wrong_personalization_signals: [],
          improvement_hypothesis:
            "GoodMemory should reuse governed procedural guidance once the accepted promotion has compiled.",
          user_satisfaction_hypothesis:
            "The answer should already carry the promoted summary style without asking the user again.",
        },
      },
      answerGenerator: async (input) => ({
        content: input.memoryContext ?? "missing-context",
      }),
    });

    expect(result.trace.proposalLifecycle?.proposalStatusCounts.accepted).toBe(1);
    expect(result.trace.proposalLifecycle?.promotionDecisionCounts.accepted).toBe(1);
    expect(result.trace.maintenanceSummary).toEqual({
      activeValidatedPatternCount: 1,
      compiledValidatedPatternCount: 1,
      supersededFeedbackCount: 1,
      pressuredFactCount: 0,
      demotedFactCount: 0,
      correctionRepairFactCount: 0,
      acceptedProceduralPromotionCount: 1,
    });
    expect(
      result.retrieved?.feedback.some(
        (record) =>
          record.kind === "validated_pattern" &&
          record.source.method === "confirmed" &&
          record.rule === "Use bullet points in summaries.",
      ),
    ).toBe(true);
    expect(result.memoryContext).toContain("Use bullet points in summaries.");
  });

  it("records proposal lifecycle from exported governance artifacts", async () => {
    const persona = await loadPersonaSpec(
      join(import.meta.dir, "../../fixtures/personas/eval/medium-01.json"),
    );
    const scenario = await loadScenarioFixture(
      join(import.meta.dir, "../../fixtures/scenarios/eval/scenario-medium-01.json"),
    );
    const workspaceId = `eval-${persona.lifecycle_bucket}`;
    const memory = {
      async remember() {
        return {
          accepted: 0,
          rejected: 0,
          events: [],
          metadata: {
            locale: "en-US",
            localeSource: "default" as const,
            languagePackId: "en",
            analysisMode: "rules-only" as const,
            requestedExtractionStrategy: "auto" as const,
            resolvedExtractionStrategy: "rules-only" as const,
          },
        };
      },
      async feedback() {
        return { accepted: false };
      },
      async recall() {
        return {
          profile: null,
          preferences: [],
          references: [],
          facts: [],
          feedback: [],
          archives: [],
          evidence: [],
          episodes: [],
          workingMemory: null,
          journal: null,
          packet: {
            locale: "en-US",
            profile: null,
            preferences: [],
            references: [],
            facts: [],
            feedback: [],
            archives: [],
            evidence: [],
            episodes: [],
            workingMemory: null,
            journal: null,
            routingDecision: {
              retrievalProfile: "general_chat",
              intent: "general_assistance",
              strategy: "rules-only" as const,
              strategyExplanation: {
                requestedStrategy: "auto" as const,
                resolvedStrategy: "rules-only" as const,
                summary: "auto routing stayed rules-only",
                hardFloor: "lexical_runtime_procedural_priors" as const,
                semanticTieBreaking: false,
                llmRefinement: false,
              },
              sourcePriorities: ["profile", "feedback", "fact"],
              requestedSlots: [],
              supportSlots: [],
              actionDriving: false,
              referenceSeeking: false,
              continuation: false,
            },
          },
          metadata: {
            routingDecision: {
              retrievalProfile: "general_chat",
              intent: "general_assistance",
              strategy: "rules-only" as const,
              strategyExplanation: {
                requestedStrategy: "auto" as const,
                resolvedStrategy: "rules-only" as const,
                summary: "auto routing stayed rules-only",
                hardFloor: "lexical_runtime_procedural_priors" as const,
                semanticTieBreaking: false,
                llmRefinement: false,
              },
              sourcePriorities: ["profile", "feedback", "fact"],
              requestedSlots: [],
              supportSlots: [],
              actionDriving: false,
              referenceSeeking: false,
              continuation: false,
            },
            tokenCount: 0,
            latencyMs: 0,
            hits: [],
            candidateTraces: [],
            verificationHints: [],
            policyApplied: [],
          },
        };
      },
      async buildContext() {
        return {
          output: "markdown" as const,
          content: "memory context",
          estimatedTokens: 3,
          omittedSections: [],
        };
      },
      async forget() {
        return { forgotten: false };
      },
      async exportMemory() {
        return {
          ...buildEmptyExportMemoryResult(persona.persona_id, workspaceId),
          durable: {
            ...buildEmptyExportMemoryResult(persona.persona_id, workspaceId).durable,
            experiences: [
              {
                id: "xp-1",
                userId: persona.persona_id,
                workspaceId,
                kind: "verify" as const,
                traceId: "trace-1",
                sourceTraceIds: ["trace-1"],
                trigger: "api" as const,
                modelInfluence: "rules-only" as const,
                summary: "Verification hint for rollout blocker.",
                outcome: "success" as const,
                policyApplied: [],
                metrics: {},
                linkedMemoryIds: ["fact-1"],
                linkedArchiveIds: [],
                linkedEvidenceIds: ["evidence-1"],
                linkedProposalIds: ["proposal-1"],
                createdAt: "2026-04-15T00:00:00.000Z",
              },
            ],
            proposals: [
              {
                id: "proposal-1",
                userId: persona.persona_id,
                workspaceId,
                proposalType: "maintenance_action" as const,
                status: "accepted" as const,
                traceId: "proposal-trace-1",
                summary: "Re-check stale blocker memory.",
                rationale: "One verification trace suggests a bounded maintenance follow-up.",
                sourceExperienceIds: ["xp-1"],
                linkedMemoryIds: ["fact-1"],
                linkedArchiveIds: [],
                linkedEvidenceIds: ["evidence-1"],
                modelInfluence: "rules-only" as const,
                createdAt: "2026-04-15T00:00:00.000Z",
                updatedAt: "2026-04-15T00:00:00.000Z",
              },
            ],
            promotions: [
              {
                id: "promotion-1",
                proposalId: "proposal-1",
                userId: persona.persona_id,
                workspaceId,
                traceId: "promotion-trace-1",
                decision: "accepted" as const,
                summary: "accepted proposal: Re-check stale blocker memory.",
                rationale: "proposal passed deterministic gates",
                sourceExperienceIds: ["xp-1"],
                linkedMemoryIds: ["fact-1"],
                linkedArchiveIds: [],
                linkedEvidenceIds: ["evidence-1"],
                policyOutcome: "passed" as const,
                verificationOutcome: "passed" as const,
                evalOutcome: "passed" as const,
                createdAt: "2026-04-15T00:00:00.000Z",
                decidedAt: "2026-04-15T00:00:00.000Z",
              },
            ],
          },
        };
      },
      async deleteAllMemory() {
        return {
          scope: { userId: persona.persona_id },
          deleted: {
            profiles: 0,
            preferences: 0,
            references: 0,
            facts: 0,
            feedback: 0,
            episodes: 0,
            archives: 0,
            evidence: 0,
            experiences: 0,
            proposals: 0,
            promotions: 0,
            workingMemory: 0,
            journal: 0,
            artifactSpills: 0,
          },
        };
      },
    };

    const result = await runGoodMemoryScenario({
      memory: memory as never,
      persona,
      scenario,
      answerGenerator: async (input) => ({
        content: input.memoryContext ?? "missing-context",
      }),
    });

    expect(result.trace.proposalLifecycle).toEqual({
      experienceCount: 1,
      experienceKindCounts: {
        verify: 1,
      },
      proposalCount: 1,
      proposalStatusCounts: {
        accepted: 1,
      },
      promotionCount: 1,
      promotionDecisionCounts: {
        accepted: 1,
      },
      proposals: [
        {
          id: "proposal-1",
          proposalType: "maintenance_action",
          status: "accepted",
          summary: "Re-check stale blocker memory.",
          rationale: "One verification trace suggests a bounded maintenance follow-up.",
          modelInfluence: "rules-only",
          sourceExperienceIds: ["xp-1"],
          linkedMemoryIds: ["fact-1"],
          linkedArchiveIds: [],
          linkedEvidenceIds: ["evidence-1"],
        },
      ],
      promotions: [
        {
          id: "promotion-1",
          proposalId: "proposal-1",
          decision: "accepted",
          summary: "accepted proposal: Re-check stale blocker memory.",
          rationale: "proposal passed deterministic gates",
          policyOutcome: "passed",
          verificationOutcome: "passed",
          evalOutcome: "passed",
        },
      ],
    });
    expect(result.trace.maintenanceSummary).toEqual({
      activeValidatedPatternCount: 0,
      compiledValidatedPatternCount: 0,
      supersededFeedbackCount: 0,
      pressuredFactCount: 0,
      demotedFactCount: 0,
      correctionRepairFactCount: 0,
      acceptedProceduralPromotionCount: 0,
    });
  });

  it("forwards requested recall strategy into eval replay when semantic adapters exist", async () => {
    const persona = await loadPersonaSpec(
      join(import.meta.dir, "../../fixtures/personas/eval/medium-01.json"),
    );
    const scenario = await loadScenarioFixture(
      join(import.meta.dir, "../../fixtures/scenarios/eval/scenario-medium-01.json"),
    );
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore: createInMemoryDocumentStore(),
        sessionStore: createInMemorySessionStore(),
        vectorStore: createInMemoryVectorStore(),
        embeddingAdapter: createFakeEmbeddingAdapter(),
      },
    });

    const result = await runGoodMemoryScenario({
      memory,
      persona,
      scenario,
      strategy: "hybrid",
      answerGenerator: async (input) => ({
        content: input.memoryContext ?? "missing-context",
      }),
    });

    expect(result.retrieved?.routingDecision?.strategy).toBe("hybrid");
    expect(result.retrieved?.routingDecision?.strategyExplanation.semanticTieBreaking).toBe(
      true,
    );
  });

  it("forwards requested remember extraction strategy into eval replay", async () => {
    const persona = await loadPersonaSpec(
      join(import.meta.dir, "../../fixtures/personas/eval/medium-01.json"),
    );
    const scenario = await loadScenarioFixture(
      join(import.meta.dir, "../../fixtures/scenarios/eval/scenario-medium-01.json"),
    );
    const rememberStrategies: Array<string | undefined> = [];
    const memory = {
      async remember(input: {
        extractionStrategy?: string;
      }) {
        rememberStrategies.push(input.extractionStrategy);
        return {
          accepted: 0,
          rejected: 0,
          events: [],
          metadata: {
            locale: "en-US",
            localeSource: "default" as const,
            languagePackId: "en",
            analysisMode: "rules-only" as const,
            requestedExtractionStrategy: "auto" as const,
            resolvedExtractionStrategy: "rules-only" as const,
          },
        };
      },
      async feedback() {
        return {
          accepted: false,
        };
      },
      async recall() {
        return {
          profile: null,
          preferences: [],
          references: [],
          facts: [],
          feedback: [],
          archives: [],
          evidence: [],
          episodes: [],
          workingMemory: null,
          journal: null,
          packet: {
            locale: "en-US",
            profile: null,
            preferences: [],
            references: [],
            facts: [],
            feedback: [],
            archives: [],
            evidence: [],
            episodes: [],
            workingMemory: null,
            journal: null,
            routingDecision: {
              retrievalProfile: "general_chat",
              intent: "general_assistance",
              strategy: "rules-only" as const,
              strategyExplanation: {
                requestedStrategy: "auto" as const,
                resolvedStrategy: "rules-only" as const,
                summary: "auto routing stayed rules-only",
                hardFloor: "lexical_runtime_procedural_priors" as const,
                semanticTieBreaking: false,
                llmRefinement: false,
              },
              sourcePriorities: ["profile", "feedback", "fact"],
              requestedSlots: [],
              supportSlots: [],
              actionDriving: false,
              referenceSeeking: false,
              continuation: false,
            },
          },
          metadata: {
            routingDecision: {
              retrievalProfile: "general_chat",
              intent: "general_assistance",
              strategy: "rules-only" as const,
              strategyExplanation: {
                requestedStrategy: "auto" as const,
                resolvedStrategy: "rules-only" as const,
                summary: "auto routing stayed rules-only",
                hardFloor: "lexical_runtime_procedural_priors" as const,
                semanticTieBreaking: false,
                llmRefinement: false,
              },
              sourcePriorities: ["profile", "feedback", "fact"],
              requestedSlots: [],
              supportSlots: [],
              actionDriving: false,
              referenceSeeking: false,
              continuation: false,
            },
            tokenCount: 0,
            latencyMs: 0,
            hits: [],
            candidateTraces: [],
            verificationHints: [],
            policyApplied: [],
          },
        };
      },
      async buildContext() {
        return {
          output: "markdown" as const,
          content: "memory context",
          estimatedTokens: 3,
          omittedSections: [],
        };
      },
      async forget() {
        return { forgotten: false };
      },
      async exportMemory() {
        return buildEmptyExportMemoryResult(persona.persona_id, `eval-${persona.lifecycle_bucket}`);
      },
      async deleteAllMemory() {
        return {
          scope: { userId: persona.persona_id },
          deleted: {
            profiles: 0,
            preferences: 0,
            references: 0,
            facts: 0,
            feedback: 0,
            episodes: 0,
            archives: 0,
            evidence: 0,
            experiences: 0,
            proposals: 0,
            promotions: 0,
            workingMemory: 0,
            journal: 0,
            artifactSpills: 0,
          },
        };
      },
    };

    await runGoodMemoryScenario({
      memory: memory as never,
      persona,
      scenario,
      rememberExtractionStrategy: "auto",
      answerGenerator: async (input) => ({
        content: input.memoryContext ?? "missing-context",
      }),
    });

    expect(rememberStrategies.every((strategy) => strategy === "auto")).toBe(true);
  });

  it("records remember extraction metadata in eval traces", async () => {
    const persona = await loadPersonaSpec(
      join(import.meta.dir, "../../fixtures/personas/eval/medium-01.json"),
    );
    const scenario = await loadScenarioFixture(
      join(import.meta.dir, "../../fixtures/scenarios/eval/scenario-medium-01.json"),
    );
    const memory = {
      async remember() {
        return {
          accepted: 1,
          rejected: 0,
          events: [],
          metadata: {
            locale: "en-US",
            localeSource: "default" as const,
            languagePackId: "en",
            analysisMode: "rules-only" as const,
            requestedExtractionStrategy: "auto" as const,
            resolvedExtractionStrategy: "llm-assisted" as const,
          },
        };
      },
      async feedback() {
        return { accepted: false };
      },
      async recall() {
        return {
          profile: null,
          preferences: [],
          references: [],
          facts: [],
          feedback: [],
          archives: [],
          evidence: [],
          episodes: [],
          workingMemory: null,
          journal: null,
          packet: {
            locale: "en-US",
            profile: null,
            preferences: [],
            references: [],
            facts: [],
            feedback: [],
            archives: [],
            evidence: [],
            episodes: [],
            workingMemory: null,
            journal: null,
            routingDecision: {
              retrievalProfile: "general_chat",
              intent: "general_assistance",
              strategy: "rules-only" as const,
              strategyExplanation: {
                requestedStrategy: "auto" as const,
                resolvedStrategy: "rules-only" as const,
                summary: "auto routing stayed rules-only",
                hardFloor: "lexical_runtime_procedural_priors" as const,
                semanticTieBreaking: false,
                llmRefinement: false,
              },
              sourcePriorities: ["profile", "feedback", "fact"],
              requestedSlots: [],
              supportSlots: [],
              actionDriving: false,
              referenceSeeking: false,
              continuation: false,
            },
          },
          metadata: {
            routingDecision: {
              retrievalProfile: "general_chat",
              intent: "general_assistance",
              strategy: "rules-only" as const,
              strategyExplanation: {
                requestedStrategy: "auto" as const,
                resolvedStrategy: "rules-only" as const,
                summary: "auto routing stayed rules-only",
                hardFloor: "lexical_runtime_procedural_priors" as const,
                semanticTieBreaking: false,
                llmRefinement: false,
              },
              sourcePriorities: ["profile", "feedback", "fact"],
              requestedSlots: [],
              supportSlots: [],
              actionDriving: false,
              referenceSeeking: false,
              continuation: false,
            },
            tokenCount: 0,
            latencyMs: 0,
            hits: [],
            candidateTraces: [],
            verificationHints: [],
            policyApplied: [],
          },
        };
      },
      async buildContext() {
        return {
          output: "markdown" as const,
          content: "memory context",
          estimatedTokens: 3,
          omittedSections: [],
        };
      },
      async forget() {
        return { forgotten: false };
      },
      async exportMemory() {
        return buildEmptyExportMemoryResult(persona.persona_id, `eval-${persona.lifecycle_bucket}`);
      },
      async deleteAllMemory() {
        return {
          scope: { userId: persona.persona_id },
          deleted: {
            profiles: 0,
            preferences: 0,
            references: 0,
            facts: 0,
            feedback: 0,
            episodes: 0,
            archives: 0,
            evidence: 0,
            experiences: 0,
            proposals: 0,
            promotions: 0,
            workingMemory: 0,
            journal: 0,
            artifactSpills: 0,
          },
        };
      },
    };

    const result = await runGoodMemoryScenario({
      memory: memory as never,
      persona,
      scenario,
      rememberExtractionStrategy: "auto",
      answerGenerator: async (input) => ({
        content: input.memoryContext ?? "missing-context",
      }),
    });

    expect(result.trace.rememberEvents[0]?.metadata).toEqual({
      locale: "en-US",
      localeSource: "default",
      languagePackId: "en",
      analysisMode: "rules-only",
      requestedExtractionStrategy: "auto",
      resolvedExtractionStrategy: "llm-assisted",
    });
  });

  it("isolates eval replay scopes with a case namespace across user and workspace ids", async () => {
    const persona = await loadPersonaSpec(
      join(import.meta.dir, "../../fixtures/personas/eval/medium-01.json"),
    );
    const scenario = await loadScenarioFixture(
      join(import.meta.dir, "../../fixtures/scenarios/eval/scenario-medium-01.json"),
    );
    const rememberedScopes: Array<{
      userId: string;
      workspaceId?: string;
      sessionId?: string;
    }> = [];
    const recalledScopes: Array<{
      userId: string;
      workspaceId?: string;
      sessionId?: string;
    }> = [];

    const result = await runGoodMemoryScenario({
      memory: {
        async remember(input: {
          scope: { userId: string; workspaceId?: string; sessionId?: string };
        }) {
          rememberedScopes.push(input.scope);
          return {
            accepted: 0,
            rejected: 0,
            events: [],
            metadata: {
              locale: "en-US",
              localeSource: "default" as const,
              languagePackId: "en",
              analysisMode: "rules-only" as const,
              requestedExtractionStrategy: "auto" as const,
              resolvedExtractionStrategy: "rules-only" as const,
            },
          };
        },
        async feedback() {
          return { accepted: false };
        },
        async recall(input: {
          scope: { userId: string; workspaceId?: string; sessionId?: string };
        }) {
          recalledScopes.push(input.scope);
          return {
            profile: null,
            preferences: [],
            references: [],
            facts: [],
            feedback: [],
            archives: [],
            evidence: [],
            episodes: [],
            workingMemory: null,
            journal: null,
            packet: {
              locale: "en-US",
              profile: null,
              preferences: [],
              references: [],
              facts: [],
              feedback: [],
              archives: [],
              evidence: [],
              episodes: [],
              workingMemory: null,
              journal: null,
              routingDecision: {
                retrievalProfile: "general_chat",
                intent: "general_assistance",
                strategy: "rules-only" as const,
                strategyExplanation: {
                  requestedStrategy: "auto" as const,
                  resolvedStrategy: "rules-only" as const,
                  summary: "auto routing stayed rules-only",
                  hardFloor: "lexical_runtime_procedural_priors" as const,
                  semanticTieBreaking: false,
                  llmRefinement: false,
                },
                sourcePriorities: ["profile", "feedback", "fact"],
                requestedSlots: [],
                supportSlots: [],
                actionDriving: false,
                referenceSeeking: false,
                continuation: false,
              },
            },
            metadata: {
              routingDecision: {
                retrievalProfile: "general_chat",
                intent: "general_assistance",
                strategy: "rules-only" as const,
                strategyExplanation: {
                  requestedStrategy: "auto" as const,
                  resolvedStrategy: "rules-only" as const,
                  summary: "auto routing stayed rules-only",
                  hardFloor: "lexical_runtime_procedural_priors" as const,
                  semanticTieBreaking: false,
                  llmRefinement: false,
                },
                sourcePriorities: ["profile", "feedback", "fact"],
                requestedSlots: [],
                supportSlots: [],
                actionDriving: false,
                referenceSeeking: false,
                continuation: false,
              },
              tokenCount: 0,
              latencyMs: 0,
              hits: [],
              candidateTraces: [],
              verificationHints: [],
              policyApplied: [],
            },
          };
        },
        async buildContext() {
          return {
            output: "markdown" as const,
            content: "memory context",
            estimatedTokens: 3,
            omittedSections: [],
          };
        },
        async forget() {
          return { forgotten: false };
        },
        async exportMemory() {
          return buildEmptyExportMemoryResult(
            persona.persona_id,
            `eval-${persona.lifecycle_bucket}-run-live-memory-scenario-medium-01__hybrid`,
          );
        },
        async deleteAllMemory() {
          return {
            scope: { userId: persona.persona_id },
            deleted: {
              profiles: 0,
              preferences: 0,
              references: 0,
              facts: 0,
              feedback: 0,
              episodes: 0,
              archives: 0,
              evidence: 0,
              experiences: 0,
              proposals: 0,
              promotions: 0,
              workingMemory: 0,
              journal: 0,
              artifactSpills: 0,
            },
          };
        },
      } as never,
      persona,
      scenario,
      scopeNamespace: "run-live-memory-scenario-medium-01__hybrid",
      answerGenerator: async (input) => ({
        content: input.memoryContext ?? "missing-context",
      }),
    });

    const usedScopes = [...rememberedScopes, ...recalledScopes];

    expect(result.answer).toBe("memory context");
    expect(usedScopes.length).toBeGreaterThan(0);
    expect(new Set(usedScopes.map((scope) => scope.userId)).size).toBe(1);
    expect(usedScopes[0]?.userId).not.toBe(persona.persona_id);
    expect(
      usedScopes.every((scope) =>
        scope.workspaceId?.includes("run-live-memory-scenario-medium-01__hybrid"),
      ),
    ).toBe(true);
  });

  it("records render-time context tokens separately from packet tokens in eval traces", async () => {
    const persona = await loadPersonaSpec(
      join(import.meta.dir, "../../fixtures/personas/eval/medium-13.json"),
    );
    const scenario = await loadScenarioFixture(
      join(
        import.meta.dir,
        "../../fixtures/scenarios/eval/scenario-medium-13-reference-next-step.json",
      ),
    );
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore: createInMemoryDocumentStore(),
        sessionStore: createInMemorySessionStore(),
      },
    });

    const result = await runGoodMemoryScenario({
      memory,
      persona,
      scenario,
      answerGenerator: async (input) => ({
        content: input.memoryContext ?? "missing-context",
      }),
    });

    const contextBuild = result.trace.contextBuild as Record<string, unknown> | null;

    expect(contextBuild).not.toBeNull();
    expect(contextBuild?.contextEstimatedTokens).toBe(
      Math.ceil((result.memoryContext?.length ?? 0) / 4),
    );
    expect(contextBuild?.packetTokenCountBeforeRender).toBeGreaterThan(0);
    expect(contextBuild?.recallTokenCount).toBeUndefined();
  });

  it("can force ignore-memory during eval replay and still produce a valid answer package", async () => {
    const persona = await loadPersonaSpec(
      join(import.meta.dir, "../../fixtures/personas/eval/medium-01.json"),
    );
    const scenario = await loadScenarioFixture(
      join(import.meta.dir, "../../fixtures/scenarios/eval/scenario-medium-01.json"),
    );
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });

    const result = await runGoodMemoryScenario({
      memory,
      persona,
      scenario,
      ignoreMemory: true,
      answerGenerator: async () => ({
        content: "answer-without-memory",
      }),
    });

    expect(result.answer).toBe("answer-without-memory");
    expect(result.retrieved?.facts).toHaveLength(0);
    expect(result.retrieved?.candidateTraces).toHaveLength(0);
    expect(result.retrieved?.policyApplied).toContain("ignore_memory");
  });

  it("replays complex profile context so role and location survive into retrieved memory", async () => {
    const persona = await loadPersonaSpec(
      join(import.meta.dir, "../../fixtures/personas/eval/complex-01.json"),
    );
    const scenario = await loadScenarioFixture(
      join(import.meta.dir, "../../fixtures/scenarios/eval/scenario-complex-01.json"),
    );
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore: createInMemoryDocumentStore(),
        sessionStore: createInMemorySessionStore(),
      },
    });

    const result = await runGoodMemoryScenario({
      memory,
      persona,
      scenario,
      answerGenerator: async (input) => ({
        content: input.memoryContext ?? "missing-context",
      }),
    });

    expect(result.retrieved?.profile?.identity.name).toBe("Felix");
    expect(result.retrieved?.profile?.identity.role).toBe("climate policy advisor");
    expect(result.retrieved?.profile?.identity.location).toBe("Austin, USA");
    expect(result.retrieved?.profile?.activeContext.currentProjects).toContain(
      "incident playbook refresh",
    );
    expect(result.retrieved?.renderedMemoryContext).toContain(
      "Felix - climate policy advisor - Austin, USA",
    );
    expect(result.retrieved?.renderedMemoryContext).toContain("## Active Context");
    expect(result.retrieved?.renderedMemoryContext).toContain(
      "Current projects: incident playbook refresh",
    );
    expect(
      result.trace.rememberEvents
        .flatMap((session) => session.events)
        .some((event) => event.reason === "explicit_profile_role"),
    ).toBe(true);
    expect(
      result.trace.rememberEvents
        .flatMap((session) => session.events)
        .some((event) => event.reason === "explicit_profile_location"),
    ).toBe(true);
    expect(
      result.trace.rememberEvents
        .flatMap((session) => session.events)
        .some((event) => event.reason === "explicit_profile_current_project"),
    ).toBe(true);
  });

  it("surfaces explicit current-role updates in long-lifecycle eval context", async () => {
    const persona = await loadPersonaSpec(
      join(import.meta.dir, "../../fixtures/personas/eval/long-01.json"),
    );
    const scenario = await loadScenarioFixture(
      join(import.meta.dir, "../../fixtures/scenarios/eval/scenario-long-01.json"),
    );
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore: createInMemoryDocumentStore(),
        sessionStore: createInMemorySessionStore(),
      },
    });

    const result = await runGoodMemoryScenario({
      memory,
      persona,
      scenario,
      answerGenerator: async (input) => ({
        content: input.memoryContext ?? "missing-context",
      }),
    });

    expect(
      result.retrieved?.facts.some((fact) =>
        fact.content ===
          "my current role is staff platform engineer leading release quality program.",
      ) ?? false,
    ).toBe(true);
    expect(result.memoryContext).toContain(
      "my current role is staff platform engineer leading release quality program.",
    );
    expect(result.memoryContext).toContain(
      "my current focus is runtime reliability and platform migration for release quality program, not the old backlog cleanup.",
    );
  });

  it("does not surface scoped carry-over avoidance rules in cross-domain eval context", async () => {
    const persona = await loadPersonaSpec(
      join(import.meta.dir, "../../fixtures/personas/eval/medium-11.json"),
    );
    const scenario = await loadScenarioFixture(
      join(import.meta.dir, "../../fixtures/scenarios/eval/scenario-medium-11.json"),
    );
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore: createInMemoryDocumentStore(),
        sessionStore: createInMemorySessionStore(),
      },
    });

    const result = await runGoodMemoryScenario({
      memory,
      persona,
      scenario,
      answerGenerator: async (input) => ({
        content: input.memoryContext ?? "missing-context",
      }),
    });

    expect(result.memoryContext).not.toContain(
      "avoid irrelevant carry-over from hobby preferences",
    );
  });

  it("can surface archive-backed continuity in eval answer packages", async () => {
    const persona = await loadPersonaSpec(
      join(import.meta.dir, "../../fixtures/personas/eval/medium-01.json"),
    );
    const scenario = await loadScenarioFixture(
      join(import.meta.dir, "../../fixtures/scenarios/eval/scenario-medium-01.json"),
    );
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore,
    });
    await repositories.archives.add(
      createSessionArchive({
        id: "archive-eval-1",
        userId: persona.persona_id,
        workspaceId: `eval-${persona.lifecycle_bucket}`,
        sessionId: "archive-s1",
        summary: "Previous session paused after step 2 and still needs final verification.",
        unresolvedItems: ["final verification for migration rollout"],
        keyDecisions: ["Resume from the final verification checklist."],
        createdAt: "2026-03-31T00:00:00.000Z",
        archivedAt: "2026-03-31T00:00:00.000Z",
      }),
    );
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    const result = await runGoodMemoryScenario({
      memory,
      persona,
      scenario,
      retrievalProfile: "coding_agent",
      answerGenerator: async (input) => ({
        content: input.memoryContext ?? "missing-context",
      }),
    });

    expect(result.retrieved?.archives.length).toBeGreaterThan(0);
    expect(result.retrieved?.hits.some((hit) => hit.type === "session_archive")).toBe(true);
    expect(result.retrieved?.archives[0]?.summary).toContain(
      "Previous session paused after step 2",
    );
    expect(result.retrieved?.archives[0]?.unresolvedItems).toContain(
      "final verification for migration rollout",
    );
  });
});
