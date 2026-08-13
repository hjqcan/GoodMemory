import { describe, expect, it } from "bun:test";
import { createFeedbackMemory } from "../../src/domain/records";
import {
  PROMOTION_RECORDS_COLLECTION,
  createExperienceRecord,
  createLearningProposal,
} from "../../src/evolution/contracts";
import {
  attachCompiledGuidance,
  buildBehavioralOutcomeExperienceRecord,
} from "../../src/evolution/behavioralTelemetry";
import { createProposalGateProcessor } from "../../src/evolution/gates";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";
import type { DocumentStore } from "../../src/storage/contracts";
import {
  createMemoryRepositories,
} from "../../src/storage/repositories";

function createFixture() {
  const repositories = createMemoryRepositories({
    documentStore: createInMemoryDocumentStore(),
    sessionStore: createInMemorySessionStore(),
  });
  const processor = createProposalGateProcessor({
    repositories,
    now: () => "2026-04-15T00:00:00.000Z",
    createId: (() => {
      let count = 0;
      return () => `promotion-${String(++count).padStart(4, "0")}`;
    })(),
    createTraceId: (() => {
      let count = 0;
      return () => `gate-trace-${String(++count).padStart(4, "0")}`;
    })(),
  });

  return {
    processor,
    repositories,
  };
}

function createPromotionFailingDocumentStore(): DocumentStore {
  const store = createInMemoryDocumentStore();

  return {
    ...store,
    async set(collection, id, document) {
      if (collection === PROMOTION_RECORDS_COLLECTION) {
        throw new Error("promotion repository unavailable");
      }

      await store.set(collection, id, document);
    },
  };
}

async function seedFeedbackBackedProceduralLineage(input: {
  repositories: ReturnType<typeof createFixture>["repositories"];
  userId?: string;
  workspaceId?: string;
}) {
  const userId = input.userId ?? "u-1";
  const workspaceId = input.workspaceId ?? "workspace-a";

  await input.repositories.feedback.upsert(
    createFeedbackMemory({
      id: "feedback-1",
      userId,
      workspaceId,
      rule: "Use bullet points in summaries.",
      kind: "do",
      appliesTo: "general_response",
      source: {
        method: "explicit",
        extractedAt: "2026-04-14T00:00:00.000Z",
      },
      updatedAt: "2026-04-14T00:00:00.000Z",
    }),
  );
  await input.repositories.experiences.add(
    createExperienceRecord({
      id: "xp-1",
      userId,
      workspaceId,
      kind: "feedback",
      traceId: "trace-1",
      trigger: "api",
      modelInfluence: "rules-only",
      summary: "Feedback confirmed bullet summaries.",
      outcome: "success",
      linkedMemoryIds: ["feedback-1"],
      createdAt: "2026-04-14T00:00:00.000Z",
    }),
  );
  await input.repositories.experiences.add(
    createExperienceRecord({
      id: "xp-2",
      userId,
      workspaceId,
      kind: "feedback",
      traceId: "trace-2",
      trigger: "api",
      modelInfluence: "rules-only",
      summary: "Feedback confirmed bullet summaries again.",
      outcome: "success",
      linkedMemoryIds: ["feedback-1"],
      createdAt: "2026-04-15T00:00:00.000Z",
    }),
  );
}

describe("proposal gate processor", () => {
  it("rejects blocked proposals and records an auditable promotion decision", async () => {
    const { processor, repositories } = createFixture();
    const proposal = createLearningProposal({
      id: "proposal-1",
      userId: "u-2",
      workspaceId: "workspace-a",
      proposalType: "memory_revision",
      traceId: "proposal-trace-1",
      summary: "Revise stale memory",
      rationale: "Mismatch scope should block this proposal.",
      sourceExperienceIds: ["xp-1"],
      linkedMemoryIds: ["fact-1"],
      linkedEvidenceIds: ["evidence-1"],
    });

    const decisions = await processor.process({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      proposals: [proposal],
    });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe("rejected");
    expect(decisions[0]?.policyOutcome).toBe("blocked");

    const storedProposal = await repositories.proposals.get("proposal-1");
    const promotions = await repositories.promotions.listByUser("u-2");
    expect(storedProposal?.status).toBe("rejected");
    expect(promotions).toHaveLength(1);
    expect(promotions[0]?.decision).toBe("rejected");
    expect(promotions[0]?.proposalId).toBe("proposal-1");
  });

  it("accepts low-risk maintenance proposals and persists a promotion record", async () => {
    const { processor, repositories } = createFixture();
    const proposal = createLearningProposal({
      id: "proposal-1",
      userId: "u-1",
      workspaceId: "workspace-a",
      proposalType: "maintenance_action",
      traceId: "proposal-trace-1",
      summary: "Re-check stale blocker memory.",
      rationale: "One verification trace suggests a bounded maintenance follow-up.",
      sourceExperienceIds: ["xp-1"],
      linkedMemoryIds: ["fact-1"],
      linkedEvidenceIds: ["evidence-1"],
      modelInfluence: "rules-only",
    });

    const decisions = await processor.process({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      proposals: [proposal],
    });

    expect(decisions[0]?.decision).toBe("accepted");
    expect(decisions[0]?.verificationOutcome).toBe("passed");
    expect(decisions[0]?.evalOutcome).toBe("passed");
    expect((await repositories.proposals.get("proposal-1"))?.status).toBe("accepted");
    expect((await repositories.promotions.get("promotion-0001"))?.decision).toBe("accepted");
  });

  it("accepts feedback-backed procedural proposals when real repeated lineage exists", async () => {
    const { processor, repositories } = createFixture();
    await seedFeedbackBackedProceduralLineage({ repositories });
    const proposal = createLearningProposal({
      id: "proposal-1",
      userId: "u-1",
      workspaceId: "workspace-a",
      proposalType: "procedural_pattern",
      traceId: "proposal-trace-1",
      summary: "Promote repeated guidance into a pattern.",
      rationale: "Repeated feedback suggests a reusable pattern.",
      sourceExperienceIds: ["xp-1", "xp-2"],
      linkedMemoryIds: ["feedback-1"],
      modelInfluence: "rules-only",
    });

    const decisions = await processor.process({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      proposals: [proposal],
    });

    expect(decisions[0]?.decision).toBe("accepted");
    expect(decisions[0]?.verificationOutcome).toBe("passed");
    expect(decisions[0]?.evalOutcome).toBe("passed");
    expect((await repositories.proposals.get("proposal-1"))?.status).toBe("accepted");
    expect((await repositories.promotions.get("promotion-0001"))?.decision).toBe("accepted");
  });

  it("delays procedural proposals that duplicate the same experience id instead of providing repeated evidence", async () => {
    const { processor, repositories } = createFixture();
    await seedFeedbackBackedProceduralLineage({ repositories });
    const proposal = createLearningProposal({
      id: "proposal-1",
      userId: "u-1",
      workspaceId: "workspace-a",
      proposalType: "procedural_pattern",
      traceId: "proposal-trace-1",
      summary: "Promote repeated guidance into a pattern.",
      rationale: "Repeated feedback suggests a reusable pattern.",
      sourceExperienceIds: ["xp-1", "xp-1"],
      linkedMemoryIds: ["feedback-1"],
      modelInfluence: "rules-only",
    });

    const decisions = await processor.process({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      proposals: [proposal],
    });

    expect(decisions[0]?.decision).toBe("delayed");
    expect(decisions[0]?.verificationOutcome).toBe("review_required");
    expect(decisions[0]?.evalOutcome).toBe("review_required");
    expect((await repositories.proposals.get("proposal-1"))?.status).toBe("delayed");
    expect((await repositories.promotions.get("promotion-0001"))?.decision).toBe("delayed");
  });

  it("delays procedural proposals that only reference fake experience lineage", async () => {
    const { processor, repositories } = createFixture();
    const proposal = createLearningProposal({
      id: "proposal-1",
      userId: "u-1",
      workspaceId: "workspace-a",
      proposalType: "procedural_pattern",
      traceId: "proposal-trace-1",
      summary: "Promote repeated guidance into a pattern.",
      rationale: "Repeated feedback suggests a reusable pattern.",
      sourceExperienceIds: ["xp-missing-1", "xp-missing-2"],
      linkedMemoryIds: ["feedback-1"],
      modelInfluence: "rules-only",
    });

    const decisions = await processor.process({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      proposals: [proposal],
    });

    expect(decisions[0]?.decision).toBe("delayed");
    expect(decisions[0]?.verificationOutcome).toBe("review_required");
    expect(decisions[0]?.evalOutcome).toBe("review_required");
    expect((await repositories.proposals.get("proposal-1"))?.status).toBe("delayed");
    expect((await repositories.promotions.get("promotion-0001"))?.decision).toBe("delayed");
  });

  it("delays agent-correction procedural proposals backed only by duplicate rows for one trace", async () => {
    const { processor, repositories } = createFixture();

    for (const [index, experienceId] of [
      "xp-agent-correction-1",
      "xp-agent-correction-2",
    ].entries()) {
      await repositories.experiences.add(
        createExperienceRecord({
          id: experienceId,
          userId: "u-1",
          workspaceId: "workspace-a",
          kind: "feedback",
          traceId: "trace-agent-correction-1",
          summary: "Agent-event correction submitted for proposal review.",
          linkedEvidenceIds: [`evidence-${index + 1}`],
          metadata: {
            feedbackAppliesTo: "coding_agent",
            feedbackKind: "do",
            feedbackOrigin: "agent_event",
            feedbackSignal: "Use bullet points in summaries.",
          },
          modelInfluence: "rules-only",
        }),
      );
    }

    const proposal = attachCompiledGuidance(
      createLearningProposal({
        id: "proposal-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        proposalType: "procedural_pattern",
        traceId: "proposal-trace-1",
        summary: "Promote repeated adapter correction into a governed pattern.",
        rationale: "Repeated corrections suggest a reusable pattern.",
        sourceExperienceIds: ["xp-agent-correction-1", "xp-agent-correction-2"],
        linkedEvidenceIds: ["evidence-1", "evidence-2"],
        modelInfluence: "rules-only",
      }),
      {
        rule: "Use bullet points in summaries.",
        kind: "do",
        appliesTo: "coding_agent",
        confidence: 0.9,
      },
    );

    const decisions = await processor.process({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      proposals: [proposal],
    });

    expect(decisions[0]?.decision).toBe("delayed");
    expect(decisions[0]?.verificationOutcome).toBe("review_required");
    expect(decisions[0]?.evalOutcome).toBe("review_required");
    expect((await repositories.proposals.get("proposal-1"))?.status).toBe("delayed");
    expect((await repositories.promotions.get("promotion-0001"))?.decision).toBe("delayed");
  });

  it("accepts outcome-derived procedural proposals when repeated tool-outcome lineage exists", async () => {
    const { processor, repositories } = createFixture();

    await repositories.experiences.add(
      buildBehavioralOutcomeExperienceRecord({
        scope: { userId: "u-1", workspaceId: "workspace-a" },
        traceId: "trace-tool-outcome-1",
        createdAt: "2026-04-14T00:00:00.000Z",
        createId: () => "xp-tool-outcome-1",
        result: {
          cue: "detailed analysis",
          failureClass: "timeout",
          firstAction: {
            kind: "tool_call",
            name: "DeepAnalyzer",
            raw: "DeepAnalyzer --detailed",
          },
          saferAlternative: {
            kind: "tool_call",
            name: "QuickCheck",
            raw: "QuickCheck --network",
          },
          modelInfluence: "rules-only",
          retrievalProfile: "coding_agent",
        },
      }),
    );
    await repositories.experiences.add(
      buildBehavioralOutcomeExperienceRecord({
        scope: { userId: "u-1", workspaceId: "workspace-a" },
        traceId: "trace-tool-outcome-2",
        createdAt: "2026-04-15T00:00:00.000Z",
        createId: () => "xp-tool-outcome-2",
        result: {
          cue: "detailed analysis",
          failureClass: "timeout",
          firstAction: {
            kind: "tool_call",
            name: "DeepAnalyzer",
            raw: "DeepAnalyzer --detailed",
          },
          saferAlternative: {
            kind: "tool_call",
            name: "QuickCheck",
            raw: "QuickCheck --network",
          },
          modelInfluence: "rules-only",
          retrievalProfile: "coding_agent",
        },
      }),
    );

    const proposal = attachCompiledGuidance(
      createLearningProposal({
        id: "proposal-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        proposalType: "procedural_pattern",
        traceId: "proposal-trace-1",
        summary: "Promote repeated unsafe DeepAnalyzer first actions into a governed pattern.",
        rationale: "Repeated tool failures suggest a reusable avoidance policy.",
        sourceExperienceIds: ["xp-tool-outcome-1", "xp-tool-outcome-2"],
        linkedEvidenceIds: [],
        modelInfluence: "rules-only",
      }),
      {
        rule:
          "When detailed analysis previously caused DeepAnalyzer --detailed timeouts, avoid DeepAnalyzer --detailed on the first action and use QuickCheck --network before proceeding.",
        kind: "dont",
        appliesTo: "coding_agent",
        confidence: 0.9,
      },
    );

    const decisions = await processor.process({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      proposals: [proposal],
    });

    expect(decisions[0]?.decision).toBe("accepted");
    expect(decisions[0]?.verificationOutcome).toBe("passed");
    expect(decisions[0]?.evalOutcome).toBe("passed");
    expect((await repositories.proposals.get("proposal-1"))?.status).toBe("accepted");
  });

  it("delays tool-outcome proposals whose records share one source trace", async () => {
    const { processor, repositories } = createFixture();
    const sourceExperienceIds = ["same-trace-outcome-1", "same-trace-outcome-2"];

    for (const [index, experienceId] of sourceExperienceIds.entries()) {
      await repositories.experiences.add(
        buildBehavioralOutcomeExperienceRecord({
          scope: { userId: "u-1", workspaceId: "workspace-a" },
          traceId: "same-host-trace",
          createdAt: `2026-04-15T00:00:0${index}.000Z`,
          createId: () => experienceId,
          result: {
            cue: "detailed analysis",
            failureClass: "timeout",
            firstAction: { kind: "tool_call", name: "DeepAnalyzer" },
            modelInfluence: "rules-only",
            retrievalProfile: "coding_agent",
            saferAlternative: { kind: "tool_call", name: "QuickCheck" },
          },
        }),
      );
    }
    const proposal = attachCompiledGuidance(
      createLearningProposal({
        id: "same-trace-proposal",
        userId: "u-1",
        workspaceId: "workspace-a",
        proposalType: "procedural_pattern",
        traceId: "same-trace-proposal-review",
        summary: "Do not promote a retried trace.",
        rationale: "One trace is not repeated behavioral evidence.",
        sourceExperienceIds,
        modelInfluence: "rules-only",
      }),
      {
        rule: "Use QuickCheck instead of DeepAnalyzer.",
        kind: "dont",
        appliesTo: "coding_agent",
        confidence: 0.9,
      },
    );

    const decisions = await processor.process({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      proposals: [proposal],
    });

    expect(decisions[0]?.decision).toBe("delayed");
    expect(decisions[0]?.verificationOutcome).toBe("review_required");
  });

  it("delays tool-outcome proposals without an explicit profile and safer alternative", async () => {
    for (const [caseName, retrievalProfile, saferAlternative] of [
      ["missing-profile", undefined, { kind: "tool_call" as const, name: "safe" }],
      ["missing-safer", "coding_agent" as const, undefined],
    ] as const) {
      const { processor, repositories } = createFixture();
      for (const index of [1, 2]) {
        await repositories.experiences.add(
          buildBehavioralOutcomeExperienceRecord({
            scope: { userId: "u-1", workspaceId: "workspace-a" },
            traceId: `${caseName}-trace-${index}`,
            createdAt: `2026-04-15T00:00:0${index}.000Z`,
            createId: () => `${caseName}-experience-${index}`,
            result: {
              cue: caseName,
              failureClass: "unsafe_first_action",
              firstAction: { kind: "tool_call", name: "unsafe" },
              modelInfluence: "rules-only",
              ...(retrievalProfile ? { retrievalProfile } : {}),
              ...(saferAlternative ? { saferAlternative } : {}),
            },
          }),
        );
      }
      const proposal = attachCompiledGuidance(
        createLearningProposal({
          id: `${caseName}-proposal`,
          userId: "u-1",
          workspaceId: "workspace-a",
          proposalType: "procedural_pattern",
          traceId: `${caseName}-proposal-trace`,
          summary: "Unsafe tool outcome proposal without complete profile metadata.",
          rationale: "Incomplete source metadata must fail closed.",
          sourceExperienceIds: [
            `${caseName}-experience-1`,
            `${caseName}-experience-2`,
          ],
          linkedEvidenceIds: [],
          modelInfluence: "rules-only",
        }),
        {
          rule: "Use safe instead of unsafe.",
          kind: "dont",
          appliesTo: retrievalProfile === "coding_agent"
            ? "coding_agent"
            : "general_response",
          confidence: 0.9,
        },
      );

      const decisions = await processor.process({
        scope: { userId: "u-1", workspaceId: "workspace-a" },
        proposals: [proposal],
      });

      expect(decisions[0]?.decision).toBe("delayed");
      expect(decisions[0]?.verificationOutcome).toBe("review_required");
    }
  });

  it("delays outcome-derived procedural proposals when tool outcomes only match by action name", async () => {
    const { processor, repositories } = createFixture();

    await repositories.experiences.add(
      buildBehavioralOutcomeExperienceRecord({
        scope: { userId: "u-1", workspaceId: "workspace-a" },
        traceId: "trace-tool-outcome-1",
        createdAt: "2026-04-14T00:00:00.000Z",
        createId: () => "xp-tool-outcome-1",
        result: {
          cue: "copy the report",
          failureClass: "mismatch",
          firstAction: {
            kind: "command",
            name: "copy_file",
            args: ["/backup/report.txt", "/src/report.txt"],
            raw: "copy_file('/backup/report.txt', '/src/report.txt')",
          },
          saferAlternative: {
            kind: "command",
            name: "copy_file",
            args: ["/src/report.txt", "/backup/report.txt"],
            raw: "copy_file('/src/report.txt', '/backup/report.txt')",
          },
          modelInfluence: "rules-only",
        },
      }),
    );
    await repositories.experiences.add(
      buildBehavioralOutcomeExperienceRecord({
        scope: { userId: "u-1", workspaceId: "workspace-a" },
        traceId: "trace-tool-outcome-2",
        createdAt: "2026-04-15T00:00:00.000Z",
        createId: () => "xp-tool-outcome-2",
        result: {
          cue: "copy the report",
          failureClass: "mismatch",
          firstAction: {
            kind: "command",
            name: "copy_file",
            args: ["/src/report.txt", "/backup/report.txt"],
            raw: "copy_file('/src/report.txt', '/backup/report.txt')",
          },
          saferAlternative: {
            kind: "command",
            name: "copy_file",
            args: ["/backup/report.txt", "/src/report.txt"],
            raw: "copy_file('/backup/report.txt', '/src/report.txt')",
          },
          modelInfluence: "rules-only",
        },
      }),
    );

    const proposal = attachCompiledGuidance(
      createLearningProposal({
        id: "proposal-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        proposalType: "procedural_pattern",
        traceId: "proposal-trace-1",
        summary: "Promote repeated unsafe copy_file first actions into a governed pattern.",
        rationale: "Repeated tool failures suggest a reusable avoidance policy.",
        sourceExperienceIds: ["xp-tool-outcome-1", "xp-tool-outcome-2"],
        linkedEvidenceIds: [],
        modelInfluence: "rules-only",
      }),
      {
        rule:
          "When copy the report previously caused copy_file(/backup/report.txt, /src/report.txt) mismatches, avoid copy_file(/backup/report.txt, /src/report.txt) on the first action and use copy_file(/src/report.txt, /backup/report.txt) before proceeding.",
        kind: "dont",
        appliesTo: "general_response",
        confidence: 0.9,
      },
    );

    const decisions = await processor.process({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      proposals: [proposal],
    });

    expect(decisions[0]?.decision).toBe("delayed");
    expect(decisions[0]?.verificationOutcome).toBe("review_required");
    expect(decisions[0]?.evalOutcome).toBe("review_required");
    expect((await repositories.proposals.get("proposal-1"))?.status).toBe("delayed");
  });

  it("rolls back a finalized proposal when promotion persistence fails", async () => {
    const repositories = createMemoryRepositories({
      documentStore: createPromotionFailingDocumentStore(),
      sessionStore: createInMemorySessionStore(),
    });
    const processor = createProposalGateProcessor({
      repositories,
      now: () => "2026-04-15T00:00:00.000Z",
      createId: () => "promotion-0001",
      createTraceId: () => "gate-trace-0001",
    });
    const proposal = createLearningProposal({
      id: "proposal-1",
      userId: "u-1",
      workspaceId: "workspace-a",
      proposalType: "maintenance_action",
      traceId: "proposal-trace-1",
      summary: "Re-check stale blocker memory.",
      rationale: "One verification trace suggests a bounded maintenance follow-up.",
      sourceExperienceIds: ["xp-1"],
      linkedMemoryIds: ["fact-1"],
      linkedEvidenceIds: ["evidence-1"],
      modelInfluence: "rules-only",
    });

    await expect(
      processor.process({
        scope: { userId: "u-1", workspaceId: "workspace-a" },
        proposals: [proposal],
      }),
    ).rejects.toThrow("promotion repository unavailable");

    expect(await repositories.proposals.get("proposal-1")).toBeNull();
    expect(await repositories.promotions.listByUser("u-1")).toHaveLength(0);
  });

  it("restores the previous delayed proposal when a refreshed decision cannot persist", async () => {
    const repositories = createMemoryRepositories({
      documentStore: createPromotionFailingDocumentStore(),
      sessionStore: createInMemorySessionStore(),
    });
    const processor = createProposalGateProcessor({
      repositories,
      now: () => "2026-04-15T00:00:00.000Z",
      createId: () => "promotion-0001",
      createTraceId: () => "gate-trace-0001",
    });
    const existing = createLearningProposal({
      id: "proposal-1",
      userId: "u-1",
      workspaceId: "workspace-a",
      proposalType: "procedural_pattern",
      status: "delayed",
      traceId: "proposal-trace-1",
      summary: "Promote repeated guidance into a pattern.",
      rationale: "Rules-only reviewer saw 2 successful feedback traces.",
      sourceExperienceIds: ["xp-1", "xp-2"],
      linkedMemoryIds: ["feedback-1"],
      modelInfluence: "rules-only",
      createdAt: "2026-04-14T00:00:00.000Z",
      updatedAt: "2026-04-14T00:00:00.000Z",
    });

    await repositories.proposals.add(existing);

    await expect(
      processor.process({
        scope: { userId: "u-1", workspaceId: "workspace-a" },
        proposals: [
          {
            ...existing,
            rationale: "Rules-only reviewer saw 3 successful feedback traces.",
            sourceExperienceIds: ["xp-1", "xp-2", "xp-3"],
            updatedAt: "2026-04-15T00:00:00.000Z",
          },
        ],
      }),
    ).rejects.toThrow("promotion repository unavailable");

    expect(await repositories.proposals.get("proposal-1")).toEqual(existing);
    expect(await repositories.promotions.listByUser("u-1")).toHaveLength(0);
  });
});
