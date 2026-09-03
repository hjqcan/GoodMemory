import { describe, expect, it } from "bun:test";
import { createGoodMemory } from "../../src";
import { createFeedbackMemory } from "../../src/domain/records";
import {
  createLearningProposal,
  createPromotionRecord,
} from "../../src/evolution/contracts";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";

describe("procedural pattern compiler", () => {
  it("compiles accepted procedural promotions into one active validated pattern and supersedes the source guidance", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
      testing: {
        now: () => new Date("2026-04-17T00:00:00.000Z"),
      },
    });

    await documentStore.set(
      "feedback",
      "feedback-1",
      createFeedbackMemory({
        id: "feedback-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        sessionId: "s-1",
        rule: "Use bullet points in summaries.",
        kind: "do",
        appliesTo: "general_response",
        source: {
          method: "explicit",
          extractedAt: "2026-04-01T00:00:00.000Z",
          locale: "en-US",
          localeSource: "explicit",
          languagePackId: "en",
          languagePackVersion: "1",
        },
        updatedAt: "2026-04-01T00:00:00.000Z",
      }),
    );
    await documentStore.set(
      "learning_proposals",
      "proposal-1",
      createLearningProposal({
        id: "proposal-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        proposalType: "procedural_pattern",
        status: "accepted",
        traceId: "proposal-trace-1",
        summary: "Promote repeated bullet-list guidance into a reusable validated pattern.",
        rationale: "Repeated successful feedback points to stable guidance.",
        linkedMemoryIds: ["feedback-1"],
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
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        decision: "accepted",
        traceId: "promotion-trace-1",
        summary: "accepted proposal: Promote repeated bullet-list guidance into a reusable validated pattern.",
        rationale: "proposal passed deterministic gates",
        linkedMemoryIds: ["feedback-1"],
        sourceExperienceIds: ["xp-1", "xp-2"],
        policyOutcome: "passed",
        verificationOutcome: "passed",
        evalOutcome: "passed",
        createdAt: "2026-04-17T00:00:00.000Z",
        decidedAt: "2026-04-17T00:00:00.000Z",
      }),
    );

    await memory.runMaintenance({
      scope: { userId: "u-1", workspaceId: "workspace-a", agentId: "agent-a" },
      jobs: [],
    });

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a", agentId: "agent-a" },
    });
    const validatedPatterns = exported.durable.feedback.filter(
      (record) => record.kind === "validated_pattern" && record.lifecycle === "active",
    );
    const validatedPattern = validatedPatterns[0];
    const sourceGuidance = exported.durable.feedback.find((record) => record.id === "feedback-1");

    expect(validatedPatterns).toHaveLength(1);
    expect(validatedPattern).toBeDefined();
    if (!validatedPattern) {
      throw new Error("expected one validated pattern");
    }
    expect(validatedPattern.rule).toBe("Use bullet points in summaries.");
    expect(validatedPattern.workspaceId).toBe("workspace-a");
    expect(validatedPattern.agentId).toBe("agent-a");
    expect(validatedPattern.sessionId).toBeUndefined();
    expect(validatedPattern.appliesTo).toBe("general_response");
    expect(validatedPattern.source.method).toBe("confirmed");
    expect(validatedPattern.source).toMatchObject({
      locale: "en-US",
      localeSource: "explicit",
      languagePackId: "en",
      languagePackVersion: "1",
    });
    expect(sourceGuidance?.lifecycle).toBe("superseded");
    expect(sourceGuidance?.supersededBy).toBe(validatedPattern.id);
    expect(
      exported.artifacts.files.some((file) =>
        file.relativePath === "playbooks/use-bullet-points-in-summaries.md",
      ),
    ).toBeTrue();
    expect(
      exported.artifacts.files.find((file) =>
        file.relativePath === "playbooks/use-bullet-points-in-summaries.md",
      )?.content,
    ).toContain("canonicalMemoryId");
    expect(
      exported.artifacts.files.some((file) =>
        file.relativePath === "playbooks/use-bullet-points-in-summaries.prompt.md",
      ),
    ).toBeTrue();
    expect(
      exported.artifacts.files.some((file) =>
        file.relativePath === "playbooks/use-bullet-points-in-summaries.skill.md",
      ),
    ).toBeTrue();
  });

  it("does not compile delayed procedural proposals into validated patterns", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
      testing: {
        now: () => new Date("2026-04-17T00:00:00.000Z"),
      },
    });

    await documentStore.set(
      "feedback",
      "feedback-1",
      createFeedbackMemory({
        id: "feedback-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        rule: "Use bullet points in summaries.",
        kind: "do",
        appliesTo: "general_response",
        source: { method: "explicit", extractedAt: "2026-04-01T00:00:00.000Z" },
        updatedAt: "2026-04-01T00:00:00.000Z",
      }),
    );
    await documentStore.set(
      "learning_proposals",
      "proposal-1",
      createLearningProposal({
        id: "proposal-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        proposalType: "procedural_pattern",
        status: "delayed",
        traceId: "proposal-trace-1",
        summary: "Promote repeated bullet-list guidance into a reusable validated pattern.",
        rationale: "Repeated successful feedback points to stable guidance.",
        linkedMemoryIds: ["feedback-1"],
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
        userId: "u-1",
        workspaceId: "workspace-a",
        decision: "delayed",
        traceId: "promotion-trace-1",
        summary: "delayed proposal: Promote repeated bullet-list guidance into a reusable validated pattern.",
        rationale: "procedural proposal requires later eval review",
        linkedMemoryIds: ["feedback-1"],
        sourceExperienceIds: ["xp-1", "xp-2"],
        policyOutcome: "passed",
        verificationOutcome: "passed",
        evalOutcome: "review_required",
        createdAt: "2026-04-17T00:00:00.000Z",
        decidedAt: "2026-04-17T00:00:00.000Z",
      }),
    );

    await memory.runMaintenance({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      jobs: [],
    });

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    const validatedPatterns = exported.durable.feedback.filter(
      (record) => record.kind === "validated_pattern" && record.lifecycle === "active",
    );
    const sourceGuidance = exported.durable.feedback.find((record) => record.id === "feedback-1");

    expect(validatedPatterns).toHaveLength(0);
    expect(sourceGuidance?.lifecycle).toBe("active");
    expect(sourceGuidance?.supersededBy).toBeNull();
  });

  it("does not reactivate a superseded source guidance into a new validated pattern", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
      testing: {
        now: () => new Date("2026-04-17T00:00:00.000Z"),
      },
    });

    await documentStore.set(
      "feedback",
      "feedback-1",
      createFeedbackMemory({
        id: "feedback-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        sessionId: "s-1",
        rule: "Use bullet points in summaries.",
        kind: "do",
        appliesTo: "general_response",
        source: { method: "explicit", extractedAt: "2026-04-01T00:00:00.000Z" },
        lifecycle: "superseded",
        supersededBy: "feedback-2",
        updatedAt: "2026-04-02T00:00:00.000Z",
      }),
    );
    await documentStore.set(
      "feedback",
      "feedback-2",
      createFeedbackMemory({
        id: "feedback-2",
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        sessionId: "s-2",
        rule: "Keep summaries in short paragraphs.",
        kind: "do",
        appliesTo: "general_response",
        source: { method: "explicit", extractedAt: "2026-04-02T00:00:00.000Z" },
        updatedAt: "2026-04-02T00:00:00.000Z",
      }),
    );
    await documentStore.set(
      "learning_proposals",
      "proposal-1",
      createLearningProposal({
        id: "proposal-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        sessionId: "s-1",
        proposalType: "procedural_pattern",
        status: "accepted",
        traceId: "proposal-trace-1",
        summary: "Promote repeated bullet-list guidance into a reusable validated pattern.",
        rationale: "Repeated successful feedback points to stable guidance.",
        linkedMemoryIds: ["feedback-1"],
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
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        sessionId: "s-1",
        decision: "accepted",
        traceId: "promotion-trace-1",
        summary: "accepted proposal: Promote repeated bullet-list guidance into a reusable validated pattern.",
        rationale: "proposal passed deterministic gates",
        linkedMemoryIds: ["feedback-1"],
        sourceExperienceIds: ["xp-1", "xp-2"],
        policyOutcome: "passed",
        verificationOutcome: "passed",
        evalOutcome: "passed",
        createdAt: "2026-04-17T00:00:00.000Z",
        decidedAt: "2026-04-17T00:00:00.000Z",
      }),
    );

    await memory.runMaintenance({
      scope: {
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        sessionId: "s-2",
      },
      jobs: [],
    });

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a", agentId: "agent-a" },
    });
    const validatedPatterns = exported.durable.feedback.filter(
      (record) => record.kind === "validated_pattern" && record.lifecycle === "active",
    );
    const staleSource = exported.durable.feedback.find((record) => record.id === "feedback-1");

    expect(validatedPatterns).toHaveLength(0);
    expect(staleSource?.lifecycle).toBe("superseded");
    expect(staleSource?.supersededBy).toBe("feedback-2");
  });

  it("deduplicates equivalent procedural patterns across accepted session-scoped promotions", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
      testing: {
        now: () => new Date("2026-04-17T00:00:00.000Z"),
      },
    });

    await documentStore.set(
      "feedback",
      "feedback-1",
      createFeedbackMemory({
        id: "feedback-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        sessionId: "s-1",
        rule: "Use bullet points in summaries.",
        kind: "do",
        appliesTo: "general_response",
        source: { method: "explicit", extractedAt: "2026-04-01T00:00:00.000Z" },
        updatedAt: "2026-04-01T00:00:00.000Z",
      }),
    );
    await documentStore.set(
      "feedback",
      "feedback-2",
      createFeedbackMemory({
        id: "feedback-2",
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        sessionId: "s-2",
        rule: "Use bullet points in summaries.",
        kind: "do",
        appliesTo: "general_response",
        source: { method: "explicit", extractedAt: "2026-04-02T00:00:00.000Z" },
        updatedAt: "2026-04-02T00:00:00.000Z",
      }),
    );
    await documentStore.set(
      "learning_proposals",
      "proposal-1",
      createLearningProposal({
        id: "proposal-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        sessionId: "s-1",
        proposalType: "procedural_pattern",
        status: "accepted",
        traceId: "proposal-trace-1",
        summary: "Promote repeated bullet-list guidance into a reusable validated pattern.",
        rationale: "Repeated successful feedback points to stable guidance.",
        linkedMemoryIds: ["feedback-1"],
        sourceExperienceIds: ["xp-1", "xp-2"],
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
      }),
    );
    await documentStore.set(
      "learning_proposals",
      "proposal-2",
      createLearningProposal({
        id: "proposal-2",
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        sessionId: "s-2",
        proposalType: "procedural_pattern",
        status: "accepted",
        traceId: "proposal-trace-2",
        summary: "Promote repeated bullet-list guidance into a reusable validated pattern.",
        rationale: "Repeated successful feedback points to stable guidance.",
        linkedMemoryIds: ["feedback-2"],
        sourceExperienceIds: ["xp-3", "xp-4"],
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
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        sessionId: "s-1",
        decision: "accepted",
        traceId: "promotion-trace-1",
        summary: "accepted proposal: Promote repeated bullet-list guidance into a reusable validated pattern.",
        rationale: "proposal passed deterministic gates",
        linkedMemoryIds: ["feedback-1"],
        sourceExperienceIds: ["xp-1", "xp-2"],
        policyOutcome: "passed",
        verificationOutcome: "passed",
        evalOutcome: "passed",
        createdAt: "2026-04-17T00:00:00.000Z",
        decidedAt: "2026-04-17T00:00:00.000Z",
      }),
    );
    await documentStore.set(
      "promotion_records",
      "promotion-2",
      createPromotionRecord({
        id: "promotion-2",
        proposalId: "proposal-2",
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        sessionId: "s-2",
        decision: "accepted",
        traceId: "promotion-trace-2",
        summary: "accepted proposal: Promote repeated bullet-list guidance into a reusable validated pattern.",
        rationale: "proposal passed deterministic gates",
        linkedMemoryIds: ["feedback-2"],
        sourceExperienceIds: ["xp-3", "xp-4"],
        policyOutcome: "passed",
        verificationOutcome: "passed",
        evalOutcome: "passed",
        createdAt: "2026-04-17T00:00:00.000Z",
        decidedAt: "2026-04-17T00:00:00.000Z",
      }),
    );

    await memory.runMaintenance({
      scope: {
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        sessionId: "s-2",
      },
      jobs: [],
    });

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a", agentId: "agent-a" },
    });
    const validatedPatterns = exported.durable.feedback.filter(
      (record) => record.kind === "validated_pattern" && record.lifecycle === "active",
    );
    const compiledPatternId = validatedPatterns[0]?.id;
    const sourceGuidance = exported.durable.feedback.filter(
      (record) => record.id === "feedback-1" || record.id === "feedback-2",
    );

    expect(validatedPatterns).toHaveLength(1);
    expect(validatedPatterns[0]?.sessionId).toBeUndefined();
    expect(validatedPatterns[0]?.rule).toBe("Use bullet points in summaries.");
    expect(sourceGuidance.every((record) => record.lifecycle === "superseded")).toBe(true);
    expect(sourceGuidance.map((record) => record.supersededBy)).toEqual([
      compiledPatternId,
      compiledPatternId,
    ]);
  });
});
