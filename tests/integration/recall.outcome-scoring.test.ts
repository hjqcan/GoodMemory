import { describe, expect, it } from "bun:test";
import { createFactMemory } from "../../src/domain/records";
import { createEvidenceRecord } from "../../src/evidence/contracts";
import { createMemorySource } from "../../src/domain/provenance";
import { createGoodMemory } from "../../src";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";

describe("recall outcome scoring", () => {
  it("keeps year-old explicit facts eligible after the freshness bonus reaches zero", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: {
        now: () => new Date("2026-01-10T00:00:00.000Z"),
      },
    });

    await documentStore.set(
      "facts",
      "fact-old-explicit",
      createFactMemory({
        id: "fact-old-explicit",
        userId: "u-old",
        workspaceId: "workspace-a",
        category: "personal",
        content: "The user's preferred deployment region is eu-west-1.",
        source: { method: "explicit", extractedAt: "2025-01-10T00:00:00.000Z" },
        createdAt: "2025-01-10T00:00:00.000Z",
        updatedAt: "2025-01-10T00:00:00.000Z",
      }),
    );

    const result = await memory.recall({
      scope: { userId: "u-old", workspaceId: "workspace-a" },
      query: "What is the preferred deployment region?",
      retrievalProfile: "general_chat",
    });
    const trace = result.metadata.candidateTraces.find(
      (entry) => entry.memoryId === "fact-old-explicit",
    );

    expect(result.facts.map((fact) => fact.id)).toContain("fact-old-explicit");
    expect(trace?.freshnessScore).toBe(0);
  });

  it("boosts evidence-backed fact candidates and exposes outcome attribution in traces", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: {
        now: () => new Date("2026-01-10T00:00:00.000Z"),
      },
    });

    await documentStore.set(
      "facts",
      "fact-weak",
      createFactMemory({
        id: "fact-weak",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The runtime rollout is blocked by legal signoff.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await documentStore.set(
      "facts",
      "fact-strong",
      createFactMemory({
        id: "fact-strong",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The runtime rollout is blocked by legal signoff.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    const source = createMemorySource({
      method: "explicit",
      extractedAt: "2026-01-09T00:00:00.000Z",
      sessionId: "s-1",
    });
    await documentStore.set(
      "evidence",
      "evidence-1",
      createEvidenceRecord({
        id: "evidence-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        kind: "conversation_excerpt",
        excerpt: "The user reconfirmed the blocker in the latest check-in.",
        source,
        linkedMemoryIds: ["fact-strong"],
      }),
    );
    await documentStore.set(
      "evidence",
      "evidence-2",
      createEvidenceRecord({
        id: "evidence-2",
        userId: "u-1",
        workspaceId: "workspace-a",
        kind: "verification_result",
        excerpt: "Verification still points to the same blocker.",
        source,
        linkedMemoryIds: ["fact-strong"],
      }),
    );

    const result = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "What is the blocker right now?",
      retrievalProfile: "coding_agent",
    });

    expect(result.facts[0]?.id).toBe("fact-strong");
    const trace = result.metadata.candidateTraces.find((entry) => entry.memoryId === "fact-strong");
    expect(trace?.evidenceScore).toBeGreaterThan(0);
    expect(trace !== undefined && "usageScore" in trace).toBe(false);
    expect(trace !== undefined && "outcomeScore" in trace).toBe(false);
    expect(trace?.whyReturned).toContain("evidenceScore=");
    expect(trace?.whyReturned).not.toContain("outcomeScore=");
  });

  it("down-weights stale action-driving facts without pressuring unsurfaced candidates", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
      testing: {
        now: () => new Date("2026-02-15T00:00:00.000Z"),
      },
    });

    await documentStore.set(
      "facts",
      "fact-risky",
      createFactMemory({
        id: "fact-risky",
        userId: "u-verify",
        workspaceId: "workspace-a",
        category: "project",
        content: "The runtime rollout is blocked by legal signoff.",
        source: { method: "explicit", extractedAt: "2025-12-01T00:00:00.000Z" },
        createdAt: "2025-12-01T00:00:00.000Z",
        updatedAt: "2025-12-01T00:00:00.000Z",
      }),
    );
    await documentStore.set(
      "facts",
      "fact-safe",
      createFactMemory({
        id: "fact-safe",
        userId: "u-verify",
        workspaceId: "workspace-a",
        category: "project",
        content: "The runtime rollout is blocked by legal signoff.",
        source: { method: "explicit", extractedAt: "2026-01-25T00:00:00.000Z" },
        createdAt: "2026-01-25T00:00:00.000Z",
        updatedAt: "2026-01-25T00:00:00.000Z",
      }),
    );
    const source = createMemorySource({
      method: "explicit",
      extractedAt: "2026-02-14T00:00:00.000Z",
      sessionId: "s-verify",
    });
    await documentStore.set(
      "evidence",
      "evidence-risky-1",
      createEvidenceRecord({
        id: "evidence-risky-1",
        userId: "u-verify",
        workspaceId: "workspace-a",
        kind: "conversation_excerpt",
        excerpt: "Earlier sessions repeated the same blocker.",
        source,
        linkedMemoryIds: ["fact-risky"],
      }),
    );
    await documentStore.set(
      "evidence",
      "evidence-risky-2",
      createEvidenceRecord({
        id: "evidence-risky-2",
        userId: "u-verify",
        workspaceId: "workspace-a",
        kind: "verification_result",
        excerpt: "A prior verification also pointed to this blocker.",
        source,
        linkedMemoryIds: ["fact-risky"],
      }),
    );
    await documentStore.set(
      "evidence",
      "evidence-safe-1",
      createEvidenceRecord({
        id: "evidence-safe-1",
        userId: "u-verify",
        workspaceId: "workspace-a",
        kind: "conversation_excerpt",
        excerpt: "The recent project note still references the same blocker.",
        source,
        linkedMemoryIds: ["fact-safe"],
      }),
    );
    await documentStore.set(
      "evidence",
      "evidence-safe-2",
      createEvidenceRecord({
        id: "evidence-safe-2",
        userId: "u-verify",
        workspaceId: "workspace-a",
        kind: "verification_result",
        excerpt: "The recent check also supports the safer blocker record.",
        source,
        linkedMemoryIds: ["fact-safe"],
      }),
    );

    const result = await memory.recall({
      scope: { userId: "u-verify", workspaceId: "workspace-a" },
      query: "Proceed with the rollout using the remembered blocker.",
      retrievalProfile: "coding_agent",
    });

    expect(result.facts[0]?.id).toBe("fact-safe");
    const riskyTrace = result.metadata.candidateTraces.find((entry) => entry.memoryId === "fact-risky");
    expect(riskyTrace?.verificationPenaltyScore).toBeGreaterThan(0);

    const exported = await memory.exportMemory({
      scope: { userId: "u-verify", workspaceId: "workspace-a" },
    });
    const riskyFact = exported.durable.facts.find((fact) => fact.id === "fact-risky");
    const safeFact = exported.durable.facts.find((fact) => fact.id === "fact-safe");

    expect(riskyFact?.lifecycle).toBe("active");
    expect(riskyFact?.verificationPressureCount).toBe(0);
    expect(riskyFact?.lastVerificationHintAt).toBeUndefined();
    expect(riskyFact?.demotionReason).toBeUndefined();
    expect(safeFact?.lifecycle).toBe("active");
  });
});
