import { describe, expect, it } from "bun:test";
import {
  createGoodMemory,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createLanguageService,
  createRuntimeArchiveStore,
  createRuntimeContextService,
} from "../../src";
import { readGoodMemoryIntegrationSupport } from "../../src/api/integrationSupport";
import type { AgentEventIngestResult } from "../../src/ai-sdk";
import { ingestAgentInputEvent } from "../../src/ai-sdk";
import { EXPERIENCES_COLLECTION } from "../../src/evolution/contracts";
import { ingestHostAgentEvent } from "../../src/host";
import type { DocumentStore } from "../../src/storage/contracts";

function builtinAnalyzerVersion(packId: string): string {
  const pack = createLanguageService()
    .getAnalyzerManifest()
    .packs.find(({ id }) => id === packId);
  if (!pack) {
    throw new Error(`Missing built-in language pack ${packId}.`);
  }
  return pack.analyzerVersion;
}

function createExperienceFailingOnceDocumentStore(): DocumentStore {
  const store = createInMemoryDocumentStore();
  let failed = false;

  return {
    ...store,
    async set(collection, id, document) {
      if (!failed && collection === EXPERIENCES_COLLECTION) {
        failed = true;
        throw new Error("experience repository unavailable");
      }

      await store.set(collection, id, document);
    },
    async writeBatchIfUnchanged(input) {
      if (
        !failed &&
        input.set.some(({ collection }) => collection === EXPERIENCES_COLLECTION)
      ) {
        failed = true;
        throw new Error("experience repository unavailable");
      }
      return store.writeBatchIfUnchanged(input);
    },
  };
}

function createValidatedPatternCompileFailingOnceDocumentStore(): DocumentStore {
  const store = createInMemoryDocumentStore();
  let failed = false;

  return {
    ...store,
    async set(collection, id, document) {
      if (
        !failed &&
        collection === "feedback" &&
        typeof document === "object" &&
        document !== null &&
        "kind" in document &&
        document.kind === "validated_pattern"
      ) {
        failed = true;
        throw new Error("validated pattern compile unavailable");
      }

      await store.set(collection, id, document);
    },
    async writeBatchIfUnchanged(input) {
      if (
        !failed &&
        input.set.some(({ collection, document }) =>
          collection === "feedback" &&
          typeof document === "object" &&
          document !== null &&
          "kind" in document &&
          document.kind === "validated_pattern"
        )
      ) {
        failed = true;
        throw new Error("validated pattern compile unavailable");
      }
      return store.writeBatchIfUnchanged(input);
    },
  };
}

function createFeedbackReceiptBarrierDocumentStore(traceId: string): DocumentStore {
  const store = createInMemoryDocumentStore();
  let receiptQueryCount = 0;
  let releaseReceiptQueries: (() => void) | undefined;
  const receiptBarrier = new Promise<void>((resolve) => {
    releaseReceiptQueries = resolve;
  });

  return {
    ...store,
    async query(collection, filter) {
      if (
        collection === EXPERIENCES_COLLECTION &&
        filter?.kind === "feedback" &&
        filter.traceId === traceId
      ) {
        receiptQueryCount += 1;
        if (receiptQueryCount >= 2) {
          releaseReceiptQueries?.();
        }
        await receiptBarrier;
      }

      return store.query(collection, filter);
    },
  };
}

describe("agent event ingestion", () => {
  it("rejects storage-unsafe event identity and structured tool fields before persistence", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = {
      sessionId: "s-storage-safe",
      userId: "u-storage-safe",
      workspaceId: "workspace-a",
    } as const;
    const base = {
      surface: "host" as const,
      kind: "tool_call" as const,
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "codex" as const,
      scope,
      toolName: "QuickCheck",
    };

    await expect(ingestHostAgentEvent(memory, {
      ...base,
      eventId: "event\u0000id",
    })).rejects.toThrow("Storage-unsafe text at event.eventId");
    await expect(ingestHostAgentEvent(memory, {
      ...base,
      eventId: "event-safe",
      payload: { note: "visible\u0000metadata" },
    })).rejects.toThrow("Storage-unsafe text at event.payload.note");
    const support = readGoodMemoryIntegrationSupport(memory);
    await expect(support!.ingestHostAgentEvent({
      event: {
        ...base,
        eventId: "event-direct-support",
        payload: { note: "visible\u0000metadata" },
      },
    })).rejects.toThrow("Storage-unsafe text at event.payload.note");

    const exported = await memory.exportMemory({ scope });
    expect(exported.durable.evidence).toEqual([]);
    expect(exported.durable.experiences).toEqual([]);
  });

  it("persists selective tool-result evidence and experience and dedupes by event id", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });
    const scope = {
      userId: "u-1",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    } as const;

    const first = await ingestHostAgentEvent(memory, {
      surface: "host",
      kind: "tool_result",
      eventId: "event-1",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "codex",
      scope,
      toolName: "QuickCheck",
      outcome: "timeout",
      excerpt: "QuickCheck timed out while probing the endpoint.",
    });
    const duplicate = await ingestHostAgentEvent(memory, {
      surface: "host",
      kind: "tool_result",
      eventId: "event-1",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "codex",
      scope,
      toolName: "QuickCheck",
      outcome: "timeout",
      excerpt: "QuickCheck timed out while probing the endpoint.",
    });
    const exported = await memory.exportMemory({ scope });

    expect(first.recorded).toBe(true);
    expect(first.evidenceId).toStartWith("agent_event.evidence.");
    expect(first.evidenceId).toContain("event=event-1");
    expect(first.experienceId).toStartWith("agent_event.experience.");
    expect(first.experienceId).toContain("event=event-1");
    expect(duplicate).toEqual({
      recorded: false,
      skippedReason: "duplicate_event",
    });
    expect(exported.durable.evidence).toHaveLength(1);
    expect(exported.durable.evidence[0]?.kind).toBe("tool_result_excerpt");
    expect(exported.durable.evidence[0]?.excerpt).toContain("QuickCheck timed out");
    expect(exported.durable.evidence[0]?.source).toMatchObject({
      languagePackId: "en",
      languagePackVersion: builtinAnalyzerVersion("en"),
      locale: "en-US",
      localeSource: "default",
    });
    expect(exported.durable.experiences).toHaveLength(1);
    expect(exported.durable.experiences[0]?.traceId).toBe("event-1");
    expect(exported.durable.experiences[0]?.kind).toBe("maintenance");
    expect(exported.durable.experiences[0]?.policyApplied).toContain("agent_event");
    expect(exported.durable.experiences[0]?.policyApplied).toContain(
      "agent_event.kind=tool_result",
    );
  });

  it("keeps event-backed persistence isolated across scopes even when event ids match", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });
    const firstScope = {
      userId: "u-1",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    } as const;
    const secondScope = {
      userId: "u-2",
      workspaceId: "workspace-b",
      sessionId: "s-2",
    } as const;

    const first = await ingestHostAgentEvent(memory, {
      surface: "host",
      kind: "tool_result",
      eventId: "shared-event",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "codex",
      scope: firstScope,
      toolName: "QuickCheck",
      outcome: "failure",
      excerpt: "Workspace A failed the quick check.",
    });
    const second = await ingestHostAgentEvent(memory, {
      surface: "host",
      kind: "tool_result",
      eventId: "shared-event",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "codex",
      scope: secondScope,
      toolName: "QuickCheck",
      outcome: "failure",
      excerpt: "Workspace B failed the quick check.",
    });
    const exportedFirst = await memory.exportMemory({ scope: firstScope });
    const exportedSecond = await memory.exportMemory({ scope: secondScope });

    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(true);
    expect(first.evidenceId).toBeDefined();
    expect(second.evidenceId).toBeDefined();
    expect(first.evidenceId).not.toBe(second.evidenceId);
    expect(first.experienceId).not.toBe(second.experienceId);
    expect(exportedFirst.durable.evidence).toHaveLength(1);
    expect(exportedFirst.durable.evidence[0]?.excerpt).toContain("Workspace A");
    expect(exportedFirst.durable.experiences).toHaveLength(1);
    expect(exportedSecond.durable.evidence).toHaveLength(1);
    expect(exportedSecond.durable.evidence[0]?.excerpt).toContain("Workspace B");
    expect(exportedSecond.durable.experiences).toHaveLength(1);
  });

  it("fails closed and lets a retry fill missing artifacts after experience storage errors", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore: createExperienceFailingOnceDocumentStore(),
      },
    });
    const scope = {
      userId: "u-1",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    } as const;
    const event = {
      surface: "host",
      kind: "tool_result",
      eventId: "event-retry",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "codex",
      scope,
      toolName: "QuickCheck",
      outcome: "timeout",
      excerpt: "QuickCheck timed out while probing the endpoint.",
    } as const;

    await expect(ingestHostAgentEvent(memory, event)).rejects.toThrow(
      "experience repository unavailable",
    );

    const retry = await ingestHostAgentEvent(memory, event);
    const exported = await memory.exportMemory({ scope });

    expect(retry.recorded).toBe(true);
    expect(exported.durable.evidence).toHaveLength(1);
    expect(exported.durable.experiences).toHaveLength(1);
    expect(exported.durable.experiences[0]?.linkedEvidenceIds).toEqual([
      retry.evidenceId!,
    ]);
  });

  it("applies redaction and shouldRemember before persisting event excerpts", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      policy: {
        redact(candidate) {
          return {
            ...candidate,
            content: candidate.content.replaceAll("SECRET", "[redacted]"),
          };
        },
        shouldRemember(candidate) {
          return !candidate.content.includes("skip me");
        },
      },
    });
    const scope = {
      userId: "u-1",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    } as const;

    const kept = await ingestHostAgentEvent(memory, {
      surface: "host",
      kind: "tool_result",
      eventId: "event-keep",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "codex",
      scope,
      toolName: "QuickCheck",
      outcome: "failure",
      excerpt: "SECRET token leaked in tool output",
    });
    const blocked = await ingestHostAgentEvent(memory, {
      surface: "host",
      kind: "file_edit",
      eventId: "event-block",
      runId: "run-1",
      turnId: "turn-2",
      sequence: 1,
      occurredAt: "2026-04-22T00:00:01.000Z",
      hostKind: "codex",
      scope,
      operation: "update",
      relativePath: "src/secret.txt",
      summary: "skip me from event persistence",
    });
    const exported = await memory.exportMemory({ scope });

    expect(kept.recorded).toBe(true);
    expect(blocked).toEqual({
      recorded: false,
      skippedReason: "policy_blocked",
    });
    expect(exported.durable.evidence).toHaveLength(1);
    expect(exported.durable.evidence[0]?.excerpt).toContain("[redacted]");
    expect(exported.durable.evidence[0]?.excerpt).not.toContain("SECRET");
  });

  it("rejects non-persistable public agent events before policy or persistence", async () => {
    let policyCalls = 0;
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      policy: {
        redact(candidate) {
          policyCalls += 1;
          return candidate;
        },
      },
    });
    const scope = {
      userId: "u-semantic-empty",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    } as const;
    const invalidTexts = [
      "\u200B",
      "\u0000",
      " \t\n\u2060 ",
      "visible\u0000text",
    ];

    for (const [index, text] of invalidTexts.entries()) {
      const hostResult = await ingestHostAgentEvent(memory, {
        surface: "host",
        kind: "tool_result",
        eventId: `event-empty-host-${index}`,
        runId: "run-empty",
        turnId: `turn-host-${index}`,
        sequence: index,
        occurredAt: `2026-04-22T00:00:0${index}.000Z`,
        hostKind: "codex",
        scope,
        toolName: "QuickCheck",
        outcome: "failure",
        excerpt: text,
      });
      const agentResult = await ingestAgentInputEvent(memory, {
        surface: "ai-sdk",
        kind: "user_correction",
        eventId: `event-empty-agent-${index}`,
        runId: "run-empty",
        turnId: `turn-agent-${index}`,
        sequence: index,
        occurredAt: `2026-04-22T00:00:1${index}.000Z`,
        hostKind: "generic",
        scope,
        correction: text,
        retrievalProfile: "coding_agent",
      });

      expect(hostResult).toEqual({
        recorded: false,
        skippedReason: "empty_excerpt",
      });
      expect(agentResult).toEqual({
        recorded: false,
        skippedReason: "empty_excerpt",
      });
    }

    const exported = await memory.exportMemory({ scope });

    expect(policyCalls).toBe(0);
    expect(exported.durable.evidence).toHaveLength(0);
    expect(exported.durable.experiences).toHaveLength(0);
    expect(exported.durable.feedback).toHaveLength(0);
    expect(exported.durable.proposals).toHaveLength(0);
    expect(exported.durable.promotions).toHaveLength(0);
  });

  it("rejects public agent events that become semantically empty after redaction", async () => {
    let shouldRememberCalls = 0;
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      policy: {
        redact(candidate) {
          return {
            ...candidate,
            content: " \u200B\u0000\u2060 ",
          };
        },
        shouldRemember() {
          shouldRememberCalls += 1;
          return true;
        },
      },
    });
    const scope = {
      userId: "u-empty-after-redaction",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    } as const;

    const hostResult = await ingestHostAgentEvent(memory, {
      surface: "host",
      kind: "tool_result",
      eventId: "event-redacted-empty-host",
      runId: "run-empty",
      turnId: "turn-host",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "codex",
      scope,
      toolName: "QuickCheck",
      outcome: "failure",
      excerpt: "Visible host excerpt",
    });
    const agentResult = await ingestAgentInputEvent(memory, {
      surface: "ai-sdk",
      kind: "user_correction",
      eventId: "event-redacted-empty-agent",
      runId: "run-empty",
      turnId: "turn-agent",
      sequence: 1,
      occurredAt: "2026-04-22T00:00:01.000Z",
      hostKind: "generic",
      scope,
      correction: "Visible correction",
      retrievalProfile: "coding_agent",
    });
    const exported = await memory.exportMemory({ scope });

    expect(hostResult).toEqual({
      recorded: false,
      skippedReason: "empty_excerpt",
    });
    expect(agentResult).toEqual({
      recorded: false,
      skippedReason: "empty_excerpt",
    });
    expect(shouldRememberCalls).toBe(0);
    expect(exported.durable.evidence).toHaveLength(0);
    expect(exported.durable.experiences).toHaveLength(0);
    expect(exported.durable.feedback).toHaveLength(0);
    expect(exported.durable.proposals).toHaveLength(0);
    expect(exported.durable.promotions).toHaveLength(0);
  });

  it("bounds durable experience summaries so large host payloads do not become transcript dumps", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });
    const scope = {
      userId: "u-1",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    } as const;
    const rawPayload = `${"DeepAnalyzer --trace ".repeat(24)}TAIL_SENTINEL`;

    const result = await ingestHostAgentEvent(memory, {
      surface: "host",
      kind: "tool_call",
      eventId: "event-large-tool-call",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "codex",
      scope,
      toolName: "DeepAnalyzer",
      raw: rawPayload,
    });
    const exported = await memory.exportMemory({ scope });

    expect(result.recorded).toBe(true);
    expect(exported.durable.evidence).toHaveLength(0);
    expect(exported.durable.experiences).toHaveLength(1);
    expect(exported.durable.experiences[0]?.summary.length).toBeLessThanOrEqual(280);
    expect(exported.durable.experiences[0]?.summary).toContain(
      "Host host invoked DeepAnalyzer:",
    );
    expect(exported.durable.experiences[0]?.summary).not.toContain("TAIL_SENTINEL");
  });

  it("routes repeated user correction events through correction lineage and proposal compilation", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });
    const scope = {
      userId: "u-1",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    } as const;

    const receipts: Array<Awaited<ReturnType<typeof ingestAgentInputEvent>>> = [];

    for (const [index, eventId] of ["event-1", "event-2", "event-3"].entries()) {
      const result = await ingestAgentInputEvent(memory, {
        surface: "ai-sdk",
        kind: "user_correction",
        eventId,
        runId: "run-1",
        turnId: `turn-${index + 1}`,
        sequence: index,
        occurredAt: `2026-04-22T00:00:0${index}.000Z`,
        hostKind: "generic",
        scope,
        correction: "Use bullet points in summaries.",
        retrievalProfile: "coding_agent",
      });

      expect(result.recorded).toBe(true);
      expect(result.feedbackMemoryId).toBeUndefined();
      receipts.push(result);
    }

    const exported = await memory.exportMemory({
      scope: {
        userId: "u-1",
        workspaceId: "workspace-a",
      },
    });

    expect(
      exported.durable.feedback.some(
        (record) =>
          record.kind === "validated_pattern" &&
          record.appliesTo === "coding_agent" &&
          record.rule.includes("Use bullet points in summaries."),
      ),
    ).toBe(true);
    expect(
      exported.durable.feedback.some(
        (record) =>
          record.kind !== "validated_pattern" &&
          record.rule.includes("Use bullet points in summaries."),
      ),
    ).toBe(false);
    expect(
      exported.durable.proposals.some(
        (proposal) => proposal.proposalType === "procedural_pattern",
      ),
    ).toBe(true);
    expect(
      exported.durable.experiences.filter((record) => record.kind === "feedback"),
    ).toHaveLength(3);
    expect(
      exported.durable.evidence.filter((record) => record.kind === "correction_context"),
    ).toHaveLength(3);
    const receiptBearingResult = receipts.find(
      (result) =>
        (result.proposalReceipts?.length ?? 0) > 0 ||
        (result.promotionReceipts?.length ?? 0) > 0,
    );
    expect(receiptBearingResult?.proposalReceipts).toHaveLength(1);
    expect(receiptBearingResult?.proposalReceipts?.[0]?.proposalType).toBe(
      "procedural_pattern",
    );
    expect(receiptBearingResult?.promotionReceipts).toHaveLength(1);
    expect(receiptBearingResult?.promotionReceipts?.[0]?.decision).toBe("accepted");
  });

  it("keeps adapter user corrections proposal-first while public feedback writes durable procedural memory", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });
    const support = readGoodMemoryIntegrationSupport(memory);
    const scope = {
      userId: "u-proposal-first",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    } as const;
    const correction = "Run typecheck before closing CI fixes.";
    const correctionResults: AgentEventIngestResult[] = [];

    expect(support).toBeDefined();

    for (const [index, eventId] of ["event-1", "event-2"].entries()) {
      const result = await support!.ingestAgentInputEvent({
        event: {
          surface: "ai-sdk",
          kind: "user_correction",
          eventId,
          runId: "run-proposal-first",
          turnId: `turn-${index + 1}`,
          sequence: index,
          occurredAt: `2026-04-22T00:01:0${index}.000Z`,
          hostKind: "codex",
          scope,
          correction,
          retrievalProfile: "coding_agent",
        },
      });

      expect(result.recorded).toBe(true);
      expect(result.evidenceId).toStartWith("agent_event.evidence.");
      expect(result.experienceId).toBeUndefined();
      expect(result.feedbackMemoryId).toBeUndefined();
      correctionResults.push(result);
    }

    const receiptBearingResult = correctionResults.find(
      (result) =>
        (result.proposalReceipts?.length ?? 0) > 0 ||
        (result.promotionReceipts?.length ?? 0) > 0,
    );
    const afterCorrection = await memory.exportMemory({
      scope: {
        userId: scope.userId,
        workspaceId: scope.workspaceId,
      },
    });

    expect(receiptBearingResult?.proposalReceipts).toHaveLength(1);
    expect(receiptBearingResult?.promotionReceipts).toHaveLength(1);
    expect(
      afterCorrection.durable.evidence.filter(
        (record) =>
          record.kind === "correction_context" &&
          record.excerpt.includes(correction),
      ),
    ).toHaveLength(2);
    expect(
      afterCorrection.durable.feedback.filter((record) =>
        record.rule.includes(correction)
      ),
    ).toEqual([
      expect.objectContaining({
        appliesTo: "coding_agent",
        kind: "validated_pattern",
      }),
    ]);

    const explicitFeedback = await memory.feedback({
      scope,
      signal: "Use numbered release notes for public changelog summaries.",
    });
    const afterExplicitFeedback = await memory.exportMemory({ scope });

    expect(explicitFeedback.memoryId).toBeDefined();
    const explicitFeedbackRecord = afterExplicitFeedback.durable.feedback.find(
      (record) => record.id === explicitFeedback.memoryId,
    );
    expect(explicitFeedbackRecord?.source).toMatchObject({
      languagePackId: "en",
      languagePackVersion: builtinAnalyzerVersion("en"),
      locale: "en-US",
      localeSource: "default",
    });
    expect(
      afterExplicitFeedback.durable.feedback.some(
        (record) =>
          record.id === explicitFeedback.memoryId &&
          record.kind !== "validated_pattern" &&
          record.rule.includes("Use numbered release notes"),
      ),
    ).toBe(true);
  });

  it("does not let concurrent duplicate user corrections self-promote from one logical trace", async () => {
    const traceId = "event-concurrent-correction";
    const documentStore = createFeedbackReceiptBarrierDocumentStore(traceId);
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
      },
    });
    const scope = {
      userId: "u-concurrent",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    } as const;
    const event = {
      surface: "ai-sdk",
      kind: "user_correction",
      eventId: traceId,
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "generic",
      scope,
      correction: "Use bullet points in summaries.",
      retrievalProfile: "coding_agent",
    } as const;

    const [first, second] = await Promise.all([
      ingestAgentInputEvent(memory, event),
      ingestAgentInputEvent(memory, event),
    ]);
    const duplicate = await ingestAgentInputEvent(memory, event);
    const exported = await memory.exportMemory({
      scope: {
        userId: "u-concurrent",
        workspaceId: "workspace-a",
      },
    });

    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(true);
    expect(duplicate).toEqual({
      recorded: false,
      skippedReason: "duplicate_event",
    });
    expect(
      exported.durable.evidence.filter((record) => record.kind === "correction_context"),
    ).toHaveLength(1);
    expect(
      exported.durable.experiences.filter((record) => record.kind === "feedback"),
    ).toHaveLength(1);
    expect(
      exported.durable.proposals.filter(
        (proposal) => proposal.proposalType === "procedural_pattern",
      ),
    ).toHaveLength(0);
    expect(exported.durable.promotions).toHaveLength(0);
    expect(
      exported.durable.feedback.filter(
        (record) =>
          record.kind === "validated_pattern" &&
          record.lifecycle === "active" &&
          record.rule.includes("Use bullet points in summaries."),
      ),
    ).toHaveLength(0);
  });

  it("maps general-chat user corrections to general_response guidance instead of coding-agent policy", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });
    const scope = {
      userId: "u-general",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    } as const;

    for (const [index, eventId] of ["event-1", "event-2", "event-3"].entries()) {
      await ingestAgentInputEvent(memory, {
        surface: "ai-sdk",
        kind: "user_correction",
        eventId,
        runId: "run-general",
        turnId: `turn-${index + 1}`,
        sequence: index,
        occurredAt: `2026-04-22T00:00:1${index}.000Z`,
        hostKind: "generic",
        scope,
        correction: "Use short paragraphs in chat answers.",
        retrievalProfile: "general_chat",
      });
    }

    const exported = await memory.exportMemory({
      scope: {
        userId: "u-general",
        workspaceId: "workspace-a",
      },
    });

    expect(
      exported.durable.feedback.some(
        (record) =>
          record.kind === "validated_pattern" &&
          record.appliesTo === "general_response" &&
          record.rule.includes("Use short paragraphs in chat answers."),
      ),
    ).toBe(true);
    expect(
      exported.durable.feedback.some(
        (record) =>
          record.kind === "validated_pattern" &&
          record.appliesTo === "coding_agent" &&
          record.rule.includes("Use short paragraphs in chat answers."),
      ),
    ).toBe(false);
  });

  it("defaults host user corrections to coding-agent guidance when retrievalProfile is omitted", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });
    const scope = {
      userId: "u-host",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    } as const;

    for (const [index, eventId] of ["event-1", "event-2", "event-3"].entries()) {
      await ingestHostAgentEvent(memory, {
        surface: "host",
        kind: "user_correction",
        eventId,
        runId: "run-host",
        turnId: `turn-${index + 1}`,
        sequence: index,
        occurredAt: `2026-04-22T00:00:2${index}.000Z`,
        hostKind: "codex",
        scope,
        correction: "Run verification before finalizing changes.",
      });
    }

    const exported = await memory.exportMemory({
      scope: {
        userId: "u-host",
        workspaceId: "workspace-a",
      },
    });

    expect(
      exported.durable.feedback.some(
        (record) =>
          record.kind === "validated_pattern" &&
          record.appliesTo === "coding_agent" &&
          record.rule.includes("Run verification before finalizing changes."),
      ),
    ).toBe(true);
    expect(
      exported.durable.feedback.some(
        (record) =>
          record.kind === "validated_pattern" &&
          record.appliesTo === "general_response" &&
          record.rule.includes("Run verification before finalizing changes."),
      ),
    ).toBe(false);
  });

  it("retries user correction proposal submission after evidence-only partial persistence", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore: createExperienceFailingOnceDocumentStore(),
      },
    });
    const scope = {
      userId: "u-1",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    } as const;
    const event = {
      surface: "ai-sdk",
      kind: "user_correction",
      eventId: "event-feedback-retry",
      runId: "run-1",
      turnId: "turn-1",
      sequence: 0,
      occurredAt: "2026-04-22T00:00:00.000Z",
      hostKind: "generic",
      scope,
      correction: "Use bullet points in summaries.",
      retrievalProfile: "coding_agent",
    } as const;

    await expect(ingestAgentInputEvent(memory, event)).rejects.toThrow(
      "experience repository unavailable",
    );

    const retry = await ingestAgentInputEvent(memory, event);
    const duplicate = await ingestAgentInputEvent(memory, event);
    const exported = await memory.exportMemory({ scope });

    expect(retry.recorded).toBe(true);
    expect(retry.evidenceId).toBeDefined();
    expect(retry.feedbackMemoryId).toBeUndefined();
    expect(duplicate).toEqual({
      recorded: false,
      skippedReason: "duplicate_event",
    });
    expect(
      exported.durable.evidence.filter((record) => record.kind === "correction_context"),
    ).toHaveLength(1);
    expect(exported.durable.experiences).toHaveLength(1);
    expect(exported.durable.feedback).toHaveLength(0);
  });

  it("keeps proposal and promotion receipts when compile fails after gate persistence", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore: createValidatedPatternCompileFailingOnceDocumentStore(),
      },
    });
    const scope = {
      userId: "u-lineage",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    } as const;

    const receipts: Array<Awaited<ReturnType<typeof ingestAgentInputEvent>>> = [];
    const originalConsoleError = console.error;
    console.error = (() => {}) as typeof console.error;

    try {
      for (const [index, eventId] of ["event-1", "event-2"].entries()) {
        receipts.push(await ingestAgentInputEvent(memory, {
          surface: "ai-sdk",
          kind: "user_correction",
          eventId,
          runId: "run-lineage",
          turnId: `turn-${index + 1}`,
          sequence: index,
          occurredAt: `2026-04-22T00:00:2${index}.000Z`,
          hostKind: "generic",
          scope,
          correction: "Use bullet points in summaries.",
          retrievalProfile: "coding_agent",
        }));
      }
    } finally {
      console.error = originalConsoleError;
    }

    const receiptBearingResult = receipts.find(
      (result) =>
        (result.proposalReceipts?.length ?? 0) > 0 ||
        (result.promotionReceipts?.length ?? 0) > 0,
    );
    const exported = await memory.exportMemory({
      scope: {
        userId: "u-lineage",
        workspaceId: "workspace-a",
      },
    });

    expect(receiptBearingResult?.proposalReceipts).toHaveLength(1);
    expect(receiptBearingResult?.promotionReceipts).toHaveLength(1);
    expect(exported.durable.proposals).toHaveLength(1);
    expect(exported.durable.promotions).toHaveLength(1);
    expect(
      exported.durable.feedback.some((record) => record.kind === "validated_pattern"),
    ).toBe(false);
  });

  it("feeds event-backed validated patterns into coding-agent recall and context assembly", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const runtime = createRuntimeContextService({
      sessionStore,
      archiveStore: createRuntimeArchiveStore({ documentStore }),
      now: () => "2026-04-22T00:00:00.000Z",
    });
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
    });
    const scope = {
      userId: "u-1",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    } as const;

    await runtime.startSession(scope);
    await runtime.updateWorkingMemory(scope, {
      currentGoal: "Finish the rollout note",
      openLoops: ["capture the handoff summary"],
    });
    await runtime.updateSessionJournal(scope, {
      currentState: "Preparing the final coding handoff.",
      appendWorklog: ["Validated the rollout note format."],
    });

    for (const [index, eventId] of ["event-1", "event-2", "event-3"].entries()) {
      await ingestAgentInputEvent(memory, {
        surface: "ai-sdk",
        kind: "user_correction",
        eventId,
        runId: "run-1",
        turnId: `turn-${index + 1}`,
        sequence: index,
        occurredAt: `2026-04-22T00:00:0${index}.000Z`,
        hostKind: "generic",
        scope,
        correction: "Use bullet points in summaries.",
        retrievalProfile: "coding_agent",
      });
    }

    const recall = await memory.recall({
      scope,
      query: "Continue the coding task from last time.",
      retrievalProfile: "coding_agent",
    });
    const context = await memory.buildContext({
      recall,
      output: "markdown",
      maxTokens: 220,
    });

    expect(
      recall.feedback.some(
        (record) =>
          record.kind === "validated_pattern" &&
          record.appliesTo === "coding_agent" &&
          record.rule.includes("Use bullet points in summaries."),
      ),
    ).toBe(true);
    expect(
      recall.evidence.some(
        (record) =>
          record.kind === "correction_context" &&
          record.excerpt.includes("Use bullet points in summaries."),
      ),
    ).toBe(true);
    expect(recall.workingMemory?.currentGoal).toBe("Finish the rollout note");
    expect(recall.workingMemory?.openLoops).toContain("capture the handoff summary");
    expect(context.content).toContain("Use bullet points in summaries.");
    expect(context.content.match(/- Use bullet points in summaries\./g)?.length ?? 0).toBe(1);
    expect(context.content).toContain("Finish the rollout note");
    expect(context.content).toContain("capture the handoff summary");
    expect(context.content).toContain("## Evidence");
  });

  it("returns unsupported_memory when helper is used with a non-goodmemory object", async () => {
    const result = await ingestAgentInputEvent(
      {
        async recall() {
          throw new Error("not implemented");
        },
        async buildContext() {
          throw new Error("not implemented");
        },
        async remember() {
          throw new Error("not implemented");
        },
        async forget() {
          throw new Error("not implemented");
        },
        async exportMemory() {
          throw new Error("not implemented");
        },
        async deleteAllMemory() {
          throw new Error("not implemented");
        },
        async feedback() {
          throw new Error("not implemented");
        },
        async runMaintenance() {
          throw new Error("not implemented");
        },
      } as never,
      {
        surface: "ai-sdk",
        kind: "task_transition",
        eventId: "event-unsupported",
        runId: "run-1",
        turnId: "turn-1",
        sequence: 0,
        occurredAt: "2026-04-22T00:00:00.000Z",
        hostKind: "generic",
        scope: {
          userId: "u-1",
        },
        nextState: "review",
        summary: "Move to review.",
      },
    );

    expect(result).toEqual({
      recorded: false,
      skippedReason: "unsupported_memory",
    });
  });
});
