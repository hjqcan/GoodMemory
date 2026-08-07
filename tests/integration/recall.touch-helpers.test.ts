import { describe, expect, it } from "bun:test";
import { createGoodMemory } from "../../src";
import {
  createFactMemory,
  createFeedbackMemory,
} from "../../src/domain/records";
import type { FactMemory } from "../../src/domain/records";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";

describe("recall retrieval telemetry", () => {
  it("keeps a 365-day-old highly relevant explicit fact active and recallable", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: { now: () => new Date("2026-01-01T00:00:00.000Z") },
    });
    const oldFact = createFactMemory({
      id: "fact-old-explicit",
      userId: "u-old-explicit",
      workspaceId: "workspace-a",
      category: "project",
      content: "The cobalt launch code is ORCHID-7319.",
      source: { method: "explicit", extractedAt: "2025-01-01T00:00:00.000Z" },
      confidence: 1,
      importance: 1,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    await documentStore.set("facts", oldFact.id, oldFact);

    const result = await memory.recall({
      scope: { userId: oldFact.userId, workspaceId: oldFact.workspaceId },
      query: "What is the cobalt launch code?",
      strategy: "rules-only",
    });
    const persisted = await documentStore.get<FactMemory>("facts", oldFact.id);

    expect(result.facts.map((fact) => fact.id)).toContain(oldFact.id);
    expect(persisted).toMatchObject({
      accessCount: 0,
      confidence: 1,
      importance: 1,
      isActive: true,
      lifecycle: "active",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    expect(persisted?.lastAccessedAt).toBeUndefined();
  });

  it("keeps stored access telemetry frozen across repeated recalls", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    let now = new Date("2026-01-10T00:00:00.000Z");
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
      testing: { now: () => now },
    });

    await documentStore.set(
      "facts",
      "fact-1",
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The runtime rollout has a legal signoff blocker.",
        source: { method: "explicit", extractedAt: "2026-01-09T00:00:00.000Z" },
        accessCount: 7,
        lastAccessedAt: "2026-01-08T00:00:00.000Z",
        createdAt: "2026-01-09T00:00:00.000Z",
        updatedAt: "2026-01-09T00:00:00.000Z",
      }),
    );
    await documentStore.set(
      "feedback",
      "feedback-1",
      createFeedbackMemory({
        id: "feedback-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        rule: "Use bullet points in summaries.",
        kind: "validated_pattern",
        source: { method: "explicit", extractedAt: "2026-01-09T00:00:00.000Z" },
        lastUsedAt: "2026-01-08T00:00:00.000Z",
        updatedAt: "2026-01-09T00:00:00.000Z",
      }),
    );

    await documentStore.set(
      "facts",
      "fact-2",
      createFactMemory({
        id: "fact-2",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The runtime rollout has a security approval blocker.",
        source: { method: "explicit", extractedAt: "2026-01-09T00:00:00.000Z" },
        createdAt: "2026-01-09T00:00:00.000Z",
        updatedAt: "2026-01-09T00:00:00.000Z",
      }),
    );

    const returnedOrders: string[][] = [];
    let omittedFromContextId: string | undefined;
    for (let index = 0; index < 20; index += 1) {
      now = new Date(`2026-01-10T00:${String(index).padStart(2, "0")}:00.000Z`);
      const result = await memory.recall({
        scope: { userId: "u-1", workspaceId: "workspace-a" },
        query: "What are the runtime rollout blockers right now?",
        retrievalProfile: "coding_agent",
      });
      returnedOrders.push(result.facts.map((record) => record.id));
      if (index === 0) {
        const context = await memory.buildContext({
          maxTokens: 24,
          output: "markdown",
          recall: result,
        });
        omittedFromContextId = result.facts.find(
          (record) => !context.content.includes(record.content),
        )?.id;
      }
    }

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    const fact = exported.durable.facts.find((record) => record.id === "fact-1");
    const untouchedFact = exported.durable.facts.find(
      (record) => record.id === "fact-2",
    );
    const feedback = exported.durable.feedback.find(
      (record) => record.id === "feedback-1",
    );
    const recallExperiences = exported.durable.experiences.filter(
      (record) => record.kind === "recall",
    );

    expect(fact?.accessCount).toBe(7);
    expect(fact?.lastAccessedAt).toBe("2026-01-08T00:00:00.000Z");
    expect(fact?.confidence).toBe(1);
    expect(fact?.lifecycle).toBe("active");
    expect(feedback?.lastUsedAt).toBe("2026-01-08T00:00:00.000Z");
    expect(omittedFromContextId).toBeString();
    expect(untouchedFact?.accessCount).toBe(0);
    expect(untouchedFact?.lastAccessedAt).toBeUndefined();
    expect(returnedOrders[0]).toEqual(["fact-1", "fact-2"]);
    expect(returnedOrders.every((order) => order.join(",") === "fact-1,fact-2")).toBe(
      true,
    );
    expect(recallExperiences).toHaveLength(20);
    expect(
      recallExperiences.every(
        (record) =>
          !("touchedFactCount" in record.metrics) &&
          !("reinforcedFeedbackCount" in record.metrics),
      ),
    ).toBe(true);
    expect(
      recallExperiences.every(
        (record) =>
          !record.summary.includes("touched") &&
          !record.summary.includes("reinforced"),
      ),
    ).toBe(true);
  });

  it("does not persist query-time fact classification during recall", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: { now: () => new Date("2026-01-10T00:00:00.000Z") },
    });
    const canonicalFact = createFactMemory({
      id: "fact-derived-classification",
      userId: "u-1",
      workspaceId: "workspace-a",
      category: "project",
      content: "The runtime rollout is blocked by legal signoff.",
      source: { method: "explicit", extractedAt: "2026-01-09T00:00:00.000Z" },
      createdAt: "2026-01-09T00:00:00.000Z",
      updatedAt: "2026-01-09T00:00:00.000Z",
    });
    await documentStore.set("facts", canonicalFact.id, canonicalFact);

    const result = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "What is blocking the runtime rollout?",
      retrievalProfile: "coding_agent",
    });
    const recalledFact = result.facts.find((fact) => fact.id === canonicalFact.id);
    const persistedFact = await documentStore.get<FactMemory>(
      "facts",
      canonicalFact.id,
    );

    expect(recalledFact).toMatchObject({
      accessCount: 0,
      factKind: "blocker",
      scopeKind: "project",
      subject: "unknown",
    });
    expect(recalledFact?.lastAccessedAt).toBeUndefined();
    expect(persistedFact?.accessCount).toBe(0);
    expect(persistedFact?.lastAccessedAt).toBeUndefined();
    expect(persistedFact?.factKind).toBeUndefined();
    expect(persistedFact?.scopeKind).toBeUndefined();
    expect(persistedFact?.subject).toBeUndefined();
  });

  it("preserves verification-pressure writes without reinforcing access", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: { now: () => new Date("2026-04-02T00:00:00.000Z") },
    });

    await documentStore.set(
      "facts",
      "fact-1",
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The runtime rollout is blocked by legal signoff.",
        source: { method: "explicit", extractedAt: "2025-12-01T00:00:00.000Z" },
        accessCount: 3,
        lastAccessedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2025-12-01T00:00:00.000Z",
        updatedAt: "2025-12-01T00:00:00.000Z",
      }),
    );

    const result = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "Proceed with the rollout using the remembered blocker.",
      retrievalProfile: "coding_agent",
    });
    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    const fact = exported.durable.facts.find((record) => record.id === "fact-1");
    const recallExperience = exported.durable.experiences.find(
      (record) => record.kind === "recall",
    );

    expect(result.metadata.verificationHints.map((hint) => hint.memoryId)).toContain(
      "fact-1",
    );
    expect(fact?.accessCount).toBe(3);
    expect(fact?.lastAccessedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(fact?.verificationPressureCount).toBe(1);
    expect(fact?.lastVerificationHintAt).toBe("2026-04-02T00:00:00.000Z");
    expect(recallExperience?.metrics.verificationPressureFactCount).toBe(1);
    expect("touchedFactCount" in (recallExperience?.metrics ?? {})).toBe(false);
    expect("reinforcedFeedbackCount" in (recallExperience?.metrics ?? {})).toBe(
      false,
    );
  });

  it("caps persisted verification pressure for repeated stale hinted recalls", async () => {
    const documentStore = createInMemoryDocumentStore();
    let now = new Date("2026-04-02T00:00:00.000Z");
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: { now: () => now },
    });

    await documentStore.set(
      "facts",
      "fact-1",
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "The runtime rollout is blocked by legal signoff.",
        source: { method: "explicit", extractedAt: "2025-12-01T00:00:00.000Z" },
        createdAt: "2025-12-01T00:00:00.000Z",
        updatedAt: "2025-12-01T00:00:00.000Z",
      }),
    );

    for (let index = 0; index < 6; index += 1) {
      now = new Date(`2026-04-02T00:0${index}:00.000Z`);
      await memory.recall({
        scope: { userId: "u-1", workspaceId: "workspace-a" },
        query: "Proceed with the rollout using the remembered blocker.",
        retrievalProfile: "coding_agent",
      });
    }

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    const fact = exported.durable.facts.find((record) => record.id === "fact-1");
    const recallExperiences = exported.durable.experiences.filter(
      (record) => record.kind === "recall",
    );

    expect(fact?.verificationPressureCount).toBe(4);
    expect(fact?.lastVerificationHintAt).toBe("2026-04-02T00:05:00.000Z");
    expect(
      recallExperiences.every(
        (record) => record.metrics.verificationPressureFactCount === 1,
      ),
    ).toBe(true);
  });
});
