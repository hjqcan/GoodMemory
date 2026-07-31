import { describe, expect, it } from "bun:test";
import type { DocumentStore } from "../../src/storage/contracts";
import {
  createFactMemory,
  createFeedbackMemory,
} from "../../src/domain/records";
import type { FactMemory } from "../../src/domain/records";
import { createGoodMemory } from "../../src";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";

describe("recall touch helpers", () => {
  it("serializes fact touch writes that share one projection manifest", async () => {
    const baseDocumentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    let activeFactWrites = 0;
    let maxConcurrentFactWrites = 0;
    const documentStore: DocumentStore = {
      async set(collection, id, document) {
        if (collection === "facts" && id.startsWith("fact-")) {
          activeFactWrites += 1;
          maxConcurrentFactWrites = Math.max(
            maxConcurrentFactWrites,
            activeFactWrites,
          );
          await new Promise((resolve) => setTimeout(resolve, 5));
          activeFactWrites -= 1;
        }
        return baseDocumentStore.set(collection, id, document);
      },
      get: baseDocumentStore.get.bind(baseDocumentStore),
      update: baseDocumentStore.update.bind(baseDocumentStore),
      query: baseDocumentStore.query.bind(baseDocumentStore),
      writeBatchIfUnchanged: baseDocumentStore.writeBatchIfUnchanged!.bind(
        baseDocumentStore,
      ),
      delete: baseDocumentStore.delete.bind(baseDocumentStore),
    };
    const now = new Date("2026-01-10T00:00:00.000Z");
    const memory = createGoodMemory({
      adapters: { documentStore, sessionStore },
      storage: { provider: "memory" },
      testing: { now: () => now },
    });

    for (let index = 1; index <= 3; index += 1) {
      await baseDocumentStore.set(
        "facts",
        `fact-${index}`,
        createFactMemory({
          category: "project",
          content: `The shared rollout blocker is dependency ${index}.`,
          createdAt: "2026-01-01T00:00:00.000Z",
          id: `fact-${index}`,
          source: {
            extractedAt: "2026-01-01T00:00:00.000Z",
            method: "explicit",
          },
          updatedAt: "2026-01-01T00:00:00.000Z",
          userId: "u-1",
          workspaceId: "workspace-a",
        }),
      );
    }

    const result = await memory.recall({
      query: "What are the shared rollout blockers?",
      retrievalProfile: "coding_agent",
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });

    expect(result.facts.map(({ id }) => id).sort()).toEqual([
      "fact-1",
      "fact-2",
      "fact-3",
    ]);
    expect(maxConcurrentFactWrites).toBe(1);
  });

  it("starts bounded feedback reinforcement writes concurrently on the recall hot path", async () => {
    const baseDocumentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const feedbackWriteResolvers: Array<() => void> = [];
    let activeFeedbackWrites = 0;
    let maxConcurrentFeedbackWrites = 0;
    const documentStore: DocumentStore = {
      async set(collection, id, document) {
        if (collection === "feedback" && id.startsWith("feedback-")) {
          activeFeedbackWrites += 1;
          maxConcurrentFeedbackWrites = Math.max(
            maxConcurrentFeedbackWrites,
            activeFeedbackWrites,
          );
          await new Promise<void>((resolve) => {
            feedbackWriteResolvers.push(resolve);
          });
          activeFeedbackWrites -= 1;
        }

        return baseDocumentStore.set(collection, id, document);
      },
      get: baseDocumentStore.get.bind(baseDocumentStore),
      update: baseDocumentStore.update.bind(baseDocumentStore),
      query: baseDocumentStore.query.bind(baseDocumentStore),
      writeBatchIfUnchanged: baseDocumentStore.writeBatchIfUnchanged!.bind(
        baseDocumentStore,
      ),
      delete: baseDocumentStore.delete.bind(baseDocumentStore),
    };
    const now = new Date("2026-01-10T00:00:00.000Z");
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
      testing: {
        now: () => now,
      },
    });

    for (const [index, updatedAt] of [
      "2026-01-03T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ].entries()) {
      const id = `feedback-${index + 1}`;
      await baseDocumentStore.set(
        "feedback",
        id,
        createFeedbackMemory({
          id,
          userId: "u-1",
          workspaceId: "workspace-a",
          rule: `Concurrent rule ${index + 1}`,
          kind: "validated_pattern",
          source: { method: "explicit", extractedAt: updatedAt },
          updatedAt,
        }),
      );
    }

    const recallPromise = memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "How should I answer this user?",
      retrievalProfile: "general_chat",
    });
    let recallSettled = false;
    const trackedRecallPromise = recallPromise.finally(() => {
      recallSettled = true;
    });

    try {
      for (let attempt = 0; attempt < 50 && feedbackWriteResolvers.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      expect(feedbackWriteResolvers).toHaveLength(3);
      expect(maxConcurrentFeedbackWrites).toBe(3);
    } finally {
      while (!recallSettled || feedbackWriteResolvers.length > 0) {
        const pendingResolvers = feedbackWriteResolvers.splice(0);
        for (const resolve of pendingResolvers) {
          resolve();
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      await trackedRecallPromise;
    }
  });

  it("only reinforces feedback that fits inside the recall budget", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const now = new Date("2026-01-10T00:00:00.000Z");
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
      testing: {
        now: () => now,
      },
    });

    for (const [index, updatedAt] of [
      "2026-01-04T00:00:00.000Z",
      "2026-01-03T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ].entries()) {
      const id = `feedback-${index + 1}`;
      await documentStore.set(
        "feedback",
        id,
        createFeedbackMemory({
          id,
          userId: "u-1",
          workspaceId: "workspace-a",
          rule: `Feedback rule ${index + 1}`,
          kind: "validated_pattern",
          source: { method: "explicit", extractedAt: updatedAt },
          updatedAt,
        }),
      );
    }

    const result = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "How should I answer this user?",
      retrievalProfile: "general_chat",
    });

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    const touchedFeedback = exported.durable.feedback.filter(
      (record) => record.lastUsedAt === "2026-01-10T00:00:00.000Z",
    );
    const recallExperience = exported.durable.experiences.find((record) => record.kind === "recall");

    expect(result.feedback.map((record) => record.id)).toEqual([
      "feedback-1",
      "feedback-2",
      "feedback-3",
    ]);
    expect(result.metadata.hits.filter((hit) => hit.type === "feedback")).toHaveLength(3);
    expect(touchedFeedback.map((record) => record.id)).toEqual([
      "feedback-1",
      "feedback-2",
      "feedback-3",
    ]);
    expect(recallExperience?.metrics.reinforcedFeedbackCount).toBe(3);
  });

  it("touches recalled facts and feedback without mutating canonical content", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const now = new Date("2026-01-10T00:00:00.000Z");
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
      testing: {
        now: () => now,
      },
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
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        accessCount: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
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
        source: { method: "explicit", extractedAt: "2026-01-02T00:00:00.000Z" },
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
    );

    await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "What is the blocker right now?",
      retrievalProfile: "coding_agent",
    });

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    const fact = exported.durable.facts.find((record) => record.id === "fact-1");
    const feedback = exported.durable.feedback.find((record) => record.id === "feedback-1");
    const recallExperience = exported.durable.experiences.find((record) => record.kind === "recall");

    expect(fact?.content).toBe("The runtime rollout is blocked by legal signoff.");
    expect(fact?.accessCount).toBe(2);
    expect(fact?.lastAccessedAt).toBe("2026-01-10T00:00:00.000Z");
    expect(feedback?.rule).toBe("Use bullet points in summaries.");
    expect(feedback?.lastUsedAt).toBe("2026-01-10T00:00:00.000Z");
    expect(recallExperience?.metrics.touchedFactCount).toBe(1);
    expect(recallExperience?.metrics.reinforcedFeedbackCount).toBe(1);
    expect(recallExperience?.summary).toContain("touched 1 fact counter");
  });

  it("does not persist query-time fact classification during a recall touch", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const now = new Date("2026-01-10T00:00:00.000Z");
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
      testing: {
        now: () => now,
      },
    });

    const canonicalFact = createFactMemory({
      id: "fact-derived-classification",
      userId: "u-1",
      workspaceId: "workspace-a",
      category: "project",
      content: "The runtime rollout is blocked by legal signoff.",
      source: {
        method: "explicit",
        extractedAt: "2026-01-01T00:00:00.000Z",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await documentStore.set(
      "facts",
      canonicalFact.id,
      canonicalFact,
    );

    const result = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "What is blocking the runtime rollout?",
      retrievalProfile: "coding_agent",
    });
    const recalledFact = result.facts.find(
      (fact) => fact.id === canonicalFact.id,
    );
    const persistedFact = await documentStore.get<FactMemory>(
      "facts",
      canonicalFact.id,
    );

    expect(recalledFact).toMatchObject({
      accessCount: 1,
      factKind: "blocker",
      lastAccessedAt: "2026-01-10T00:00:00.000Z",
      scopeKind: "project",
      subject: "unknown",
    });
    expect(persistedFact).toMatchObject({
      accessCount: 1,
      lastAccessedAt: "2026-01-10T00:00:00.000Z",
    });
    expect(persistedFact?.factKind).toBeUndefined();
    expect(persistedFact?.scopeKind).toBeUndefined();
    expect(persistedFact?.subject).toBeUndefined();
  });

  it("does not reinforce fact access when the same recall raises a verification hint", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const now = new Date("2026-04-02T00:00:00.000Z");
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
      testing: {
        now: () => now,
      },
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
        accessCount: 1,
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
    const recallExperience = exported.durable.experiences.find((record) => record.kind === "recall");

    expect(result.metadata.verificationHints.map((hint) => hint.memoryId)).toContain("fact-1");
    expect(fact?.accessCount).toBe(1);
    expect(fact?.lastAccessedAt).toBeUndefined();
    expect(fact?.verificationPressureCount).toBe(1);
    expect(fact?.lastVerificationHintAt).toBe("2026-04-02T00:00:00.000Z");
    expect(recallExperience?.metrics.touchedFactCount).toBeUndefined();
    expect(recallExperience?.metrics.verificationPressureFactCount).toBe(1);
  });

  it("caps persisted verification pressure for repeated stale hinted recalls", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    let now = new Date("2026-04-02T00:00:00.000Z");
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
      testing: {
        now: () => now,
      },
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

  it("keeps low-risk recall touches idempotent inside the bounded window", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    let now = new Date("2026-01-10T00:00:00.000Z");
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
      },
      testing: {
        now: () => now,
      },
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
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
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
        source: { method: "explicit", extractedAt: "2026-01-02T00:00:00.000Z" },
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
    );

    await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "What is the blocker right now?",
      retrievalProfile: "coding_agent",
    });
    await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "What is the blocker right now?",
      retrievalProfile: "coding_agent",
    });

    let exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    expect(exported.durable.facts.find((record) => record.id === "fact-1")?.accessCount).toBe(1);
    expect(exported.durable.feedback.find((record) => record.id === "feedback-1")?.lastUsedAt).toBe(
      "2026-01-10T00:00:00.000Z",
    );

    now = new Date("2026-01-10T00:10:00.000Z");
    await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      query: "What is the blocker right now?",
      retrievalProfile: "coding_agent",
    });

    exported = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    expect(exported.durable.facts.find((record) => record.id === "fact-1")?.accessCount).toBe(2);
    expect(exported.durable.facts.find((record) => record.id === "fact-1")?.lastAccessedAt).toBe(
      "2026-01-10T00:10:00.000Z",
    );
    expect(exported.durable.feedback.find((record) => record.id === "feedback-1")?.lastUsedAt).toBe(
      "2026-01-10T00:10:00.000Z",
    );
  });
});
