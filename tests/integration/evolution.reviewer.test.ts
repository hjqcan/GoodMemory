import { describe, expect, it } from "bun:test";
import { createGoodMemory } from "../../src";
import { createInternalGoodMemory } from "../../src/api/createGoodMemory";
import { createFactMemory } from "../../src/domain/records";
import { readBehavioralPolicyFromFeedbackMemory } from "../../src/evolution/behavioralPolicy";
import { readCompiledGuidance } from "../../src/evolution/behavioralTelemetry";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";

describe("reflective reviewer integration", () => {
  it("emits one accepted procedural pattern proposal after repeated feedback and does not duplicate it", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });
    const scope = { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" } as const;

    await memory.feedback({
      scope,
      signal: "Use bullet points in summaries.",
    });
    await memory.feedback({
      scope,
      signal: "Use bullet points in summaries.",
    });
    await memory.feedback({
      scope,
      signal: "Use bullet points in summaries.",
    });

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });

    expect(exported.durable.proposals).toHaveLength(1);
    expect(exported.durable.proposals[0]?.proposalType).toBe("procedural_pattern");
    expect(exported.durable.proposals[0]?.status).toBe("accepted");
    expect(exported.durable.proposals[0]?.linkedMemoryIds).toHaveLength(1);
    expect(exported.durable.proposals[0]?.sourceExperienceIds).toHaveLength(2);
    const compiledGuidance = readCompiledGuidance(exported.durable.proposals[0]!);
    expect(
      compiledGuidance?.behavioralPolicy?.transferMode,
    ).toBe("pattern_bounded");
    expect(exported.durable.promotions).toHaveLength(1);
    expect(
      exported.durable.promotions.every(
        (promotion) => promotion.proposalId === exported.durable.proposals[0]?.id,
      ),
    ).toBe(true);
    expect(exported.durable.promotions[0]?.decision).toBe("accepted");
  });

  it("can run the assisted reviewer profile through the same proposal pipeline", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createInternalGoodMemory(
      {
        storage: { provider: "memory" },
        adapters: {
          documentStore,
          sessionStore: createInMemorySessionStore(),
        },
      },
      {
        assistedReviewer: true,
      },
    );
    const scope = { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" } as const;

    await memory.feedback({
      scope,
      signal: "Use bullet points in summaries.",
    });
    await memory.feedback({
      scope,
      signal: "Use bullet points in summaries.",
    });
    await memory.feedback({
      scope,
      signal: "Use bullet points in summaries.",
    });

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    const proposal = exported.durable.proposals[0];

    expect(proposal?.summary).toContain("[assisted reviewer]");
    expect(proposal?.rationale).toContain("[assisted reviewer]");
    expect(proposal?.modelInfluence).toBe("llm-assisted");
  });

  it("persists a pattern-bounded behavioral policy after repeated feedback is promoted and compiled", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });
    const scope = { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" } as const;

    await memory.feedback({
      scope,
      signal: "Prefer https URLs or warn instead of producing http URLs.",
    });
    await memory.feedback({
      scope,
      signal: "Prefer https URLs or warn instead of producing http URLs.",
    });
    await memory.feedback({
      scope,
      signal: "Prefer https URLs or warn instead of producing http URLs.",
    });

    await memory.recall({
      scope,
      query: "Draft the installer URL.",
      retrievalProfile: "general_chat",
    });

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    const validatedPattern = exported.durable.feedback.find(
      (record) => record.kind === "validated_pattern" && record.lifecycle === "active",
    );
    const behavioralPolicy = validatedPattern
      ? readBehavioralPolicyFromFeedbackMemory(validatedPattern)
      : undefined;

    expect(behavioralPolicy?.transferMode).toBe("pattern_bounded");
    expect(behavioralPolicy?.applicability.replacementPairs).toEqual([
      { from: "http://", to: "https://" },
    ]);
    expect(behavioralPolicy?.applicability.forbiddenFragments).toEqual([
      "http://",
    ]);
    expect(behavioralPolicy?.applicability.textResponsePlan).toEqual(
      expect.objectContaining({
        concise: true,
      }),
    );
  });

  it("persists guarded policy payloads after repeated precondition feedback is promoted and compiled", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });
    const scope = { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" } as const;

    for (let index = 0; index < 3; index += 1) {
      await memory.feedback({
        scope,
        signal:
          "Before using HeavyComputationAPI, check system load first and only proceed when load is Normal or Idle.",
      });
    }

    await memory.recall({
      scope,
      query: "Use HeavyComputationAPI to process the report.",
      retrievalProfile: "general_chat",
    });

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    const validatedPattern = exported.durable.feedback.find(
      (record) => record.kind === "validated_pattern" && record.lifecycle === "active",
    );
    const behavioralPolicy = validatedPattern
      ? readBehavioralPolicyFromFeedbackMemory(validatedPattern)
      : undefined;

    expect(behavioralPolicy?.behavioralKind).toBe("guarded_policy");
    expect(behavioralPolicy?.applicability.guardedBehavior).toEqual({
      allowedWhen: ["load Normal", "Idle"],
        fallbackBehavior: {
          warningMessage:
            "Check system load first and only proceed when load Normal or Idle; otherwise warn or defer instead of assuming it already passed.",
        },
      precondition: "system load",
      subject: "HeavyComputationAPI",
    });
    expect(
      behavioralPolicy?.applicability.textResponsePlan?.operations.some(
        (operation) => operation.kind === "require_precondition_check",
      ),
    ).toBe(true);
  });

  it("emits a maintenance proposal after a stale verification signal is observed and the turn completes", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
    });
    const scope = { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" } as const;

    await documentStore.set(
      "facts",
      "fact-stale-1",
      createFactMemory({
        id: "fact-stale-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The rollout blocker is vendor approval.",
        source: { method: "explicit", extractedAt: "2026-02-01T00:00:00.000Z" },
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      }),
    );

    await memory.recall({
      scope,
      query: "Use the remembered blocker to continue the rollout.",
      retrievalProfile: "coding_agent",
    });

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });

    expect(exported.durable.experiences.map((experience) => experience.kind)).toEqual([
      "verify",
    ]);
    expect(
      exported.durable.proposals.some(
        (proposal) =>
          proposal.proposalType === "maintenance_action" &&
          proposal.linkedMemoryIds.includes("fact-stale-1"),
      ),
    ).toBe(true);
  });
});
