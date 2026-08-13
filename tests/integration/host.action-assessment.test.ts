import { describe, expect, it } from "bun:test";
import {
  createFeedbackMemory,
  createGoodMemory,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createMemorySource,
} from "../../src";
import { createEvidenceRecord, EVIDENCE_COLLECTION } from "../../src/evidence/contracts";
import { createHostAdapter } from "../../src/host";

describe("host action assessment integration", () => {
  it("rejects storage-unsafe command intents before persisting an audit experience", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const scope = {
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
    } as const;
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
    });
    const adapter = createHostAdapter({
      id: "codex-storage-safe",
      hostKind: "codex",
      memory,
    });

    await expect(
      adapter.assessAction({
        actionId: "action-unsafe",
        runId: "run-1",
        turnId: "turn-1",
        sequence: 0,
        occurredAt: "2026-04-22T00:00:00.000Z",
        hostKind: "codex",
        scope,
        action: {
          kind: "command",
          command: "deploy\u0000 production",
        },
      }),
    ).rejects.toThrow(
      "Storage-unsafe text at actionIntent.action.command",
    );

    const exported = await memory.exportMemory({ scope });
    expect(exported.durable.evidence).toEqual([]);
    expect(exported.durable.experiences).toEqual([]);
  });

  it("records an auditable maintenance experience for repeated assessments of the same scoped action lineage", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const scope = {
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
    } as const;
    const source = createMemorySource({
      method: "explicit",
      extractedAt: "2026-04-22T00:00:00.000Z",
      sessionId: scope.sessionId,
    });

    await documentStore.set(
      "feedback",
      "feedback-1",
      createFeedbackMemory({
        id: "feedback-1",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        sessionId: scope.sessionId,
        kind: "validated_pattern",
        appliesTo: "coding_agent",
        rule: "Before deploy, run smoke verification.",
        evidence: ["evidence-1"],
        source,
      }),
    );
    await documentStore.set(
      EVIDENCE_COLLECTION,
      "evidence-1",
      createEvidenceRecord({
        id: "evidence-1",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        sessionId: scope.sessionId,
        kind: "verification_result",
        excerpt: "Production deploy was blocked because smoke verification was skipped.",
        source,
        sourceMessageIds: ["verify-1"],
      }),
    );

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
    });
    const adapter = createHostAdapter({
      id: "codex-audit",
      hostKind: "codex",
      memory,
    });
    const input = {
      actionId: "action-1",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "codex",
      scope,
      action: {
        kind: "command",
        command: "deploy production",
      },
    } as const;

    const first = await adapter.assessAction(input);
    const second = await adapter.assessAction(input);
    const exported = await memory.exportMemory({ scope });

    expect(first.decision).toBe("review_required");
    expect(first.auditRecorded).toBe(true);
    expect(first.assessmentExperienceId).toBeDefined();
    expect(second.auditRecorded).toBe(false);
    expect(second.assessmentExperienceId).toBe(first.assessmentExperienceId);

    const auditExperience = exported.durable.experiences.find(
      (record) => record.id === first.assessmentExperienceId,
    );
    expect(auditExperience).toBeDefined();
    expect(auditExperience?.traceId).toBe("action-1");
    expect(auditExperience?.kind).toBe("maintenance");
    expect(auditExperience?.linkedMemoryIds).toEqual(["feedback-1"]);
    expect(auditExperience?.linkedEvidenceIds).toEqual(["evidence-1"]);
    expect(auditExperience?.policyApplied).toContain("host_pre_action_policy");
  });

  it("records separate audits when the same actionId is reused in different scopes", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const firstScope = {
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
    } as const;
    const secondScope = {
      userId: "u-2",
      workspaceId: "ws-2",
      sessionId: "s-2",
    } as const;
    const firstSource = createMemorySource({
      method: "explicit",
      extractedAt: "2026-04-22T00:00:00.000Z",
      sessionId: firstScope.sessionId,
    });
    const secondSource = createMemorySource({
      method: "explicit",
      extractedAt: "2026-04-22T00:00:01.000Z",
      sessionId: secondScope.sessionId,
    });

    await documentStore.set(
      "feedback",
      "feedback-1",
      createFeedbackMemory({
        id: "feedback-1",
        userId: firstScope.userId,
        workspaceId: firstScope.workspaceId,
        sessionId: firstScope.sessionId,
        kind: "validated_pattern",
        appliesTo: "coding_agent",
        rule: "Before deploy, run smoke verification.",
        evidence: ["evidence-1"],
        source: firstSource,
      }),
    );
    await documentStore.set(
      EVIDENCE_COLLECTION,
      "evidence-1",
      createEvidenceRecord({
        id: "evidence-1",
        userId: firstScope.userId,
        workspaceId: firstScope.workspaceId,
        sessionId: firstScope.sessionId,
        kind: "verification_result",
        excerpt: "Production deploy was blocked because smoke verification was skipped.",
        source: firstSource,
        sourceMessageIds: ["verify-1"],
      }),
    );
    await documentStore.set(
      "feedback",
      "feedback-2",
      createFeedbackMemory({
        id: "feedback-2",
        userId: secondScope.userId,
        workspaceId: secondScope.workspaceId,
        sessionId: secondScope.sessionId,
        kind: "validated_pattern",
        appliesTo: "coding_agent",
        rule: "Before deploy, run smoke verification.",
        evidence: ["evidence-2"],
        source: secondSource,
      }),
    );
    await documentStore.set(
      EVIDENCE_COLLECTION,
      "evidence-2",
      createEvidenceRecord({
        id: "evidence-2",
        userId: secondScope.userId,
        workspaceId: secondScope.workspaceId,
        sessionId: secondScope.sessionId,
        kind: "verification_result",
        excerpt: "Production deploy was blocked in a second workspace because smoke verification was skipped.",
        source: secondSource,
        sourceMessageIds: ["verify-2"],
      }),
    );

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
    });
    const adapter = createHostAdapter({
      id: "codex-audit",
      hostKind: "codex",
      memory,
    });

    const first = await adapter.assessAction({
      actionId: "action-1",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "codex",
      scope: firstScope,
      action: {
        kind: "command",
        command: "deploy production",
      },
    });
    const second = await adapter.assessAction({
      actionId: "action-1",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:01.000Z",
      hostKind: "codex",
      scope: secondScope,
      action: {
        kind: "command",
        command: "deploy production",
      },
    });

    expect(first.auditRecorded).toBe(true);
    expect(second.auditRecorded).toBe(true);
    expect(second.assessmentExperienceId).not.toBe(first.assessmentExperienceId);

    const firstExport = await memory.exportMemory({ scope: firstScope });
    const secondExport = await memory.exportMemory({ scope: secondScope });

    expect(
      firstExport.durable.experiences.find(
        (record) => record.id === first.assessmentExperienceId,
      ),
    ).toBeDefined();
    expect(
      secondExport.durable.experiences.find(
        (record) => record.id === second.assessmentExperienceId,
      ),
    ).toBeDefined();
  });

  it("records separate audits when the same actionId is reused across different run lineage in the same scope", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const scope = {
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
    } as const;
    const source = createMemorySource({
      method: "explicit",
      extractedAt: "2026-04-22T00:00:00.000Z",
      sessionId: scope.sessionId,
    });

    await documentStore.set(
      "feedback",
      "feedback-1",
      createFeedbackMemory({
        id: "feedback-1",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        sessionId: scope.sessionId,
        kind: "validated_pattern",
        appliesTo: "coding_agent",
        rule: "Before deploy, run smoke verification.",
        evidence: ["evidence-1"],
        source,
      }),
    );
    await documentStore.set(
      EVIDENCE_COLLECTION,
      "evidence-1",
      createEvidenceRecord({
        id: "evidence-1",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        sessionId: scope.sessionId,
        kind: "verification_result",
        excerpt: "Production deploy was blocked because smoke verification was skipped.",
        source,
        sourceMessageIds: ["verify-1"],
      }),
    );

    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
    });
    const adapter = createHostAdapter({
      id: "codex-audit",
      hostKind: "codex",
      memory,
    });

    const first = await adapter.assessAction({
      actionId: "action-1",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "codex",
      scope,
      action: {
        kind: "command",
        command: "deploy production",
      },
    });
    const second = await adapter.assessAction({
      actionId: "action-1",
      runId: "run-2",
      turnId: "turn-9",
      sequence: 0,
      occurredAt: "2026-04-22T00:05:00.000Z",
      hostKind: "codex",
      scope,
      action: {
        kind: "command",
        command: "deploy production",
      },
    });

    expect(first.auditRecorded).toBe(true);
    expect(second.auditRecorded).toBe(true);
    expect(second.assessmentExperienceId).not.toBe(first.assessmentExperienceId);

    const exported = await memory.exportMemory({ scope });
    expect(
      exported.durable.experiences.filter(
        (record) =>
          record.id === first.assessmentExperienceId
          || record.id === second.assessmentExperienceId,
      ),
    ).toHaveLength(2);
  });
});
