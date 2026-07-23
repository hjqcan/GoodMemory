import { describe, expect, it } from "bun:test";
import { createGoodMemory } from "../../src";
import { createMemorySource } from "../../src/domain/provenance";
import {
  createEvidenceRecord,
  EVIDENCE_COLLECTION,
  SOURCE_MESSAGES_COLLECTION,
} from "../../src/evidence/contracts";
import {
  createExperienceRecord,
  createLearningProposal,
  createPromotionRecord,
  createSessionArchive,
  EXPERIENCES_COLLECTION,
  LEARNING_PROPOSALS_COLLECTION,
  PROMOTION_RECORDS_COLLECTION,
  SESSION_ARCHIVES_COLLECTION,
} from "../../src/evolution/contracts";
import {
  CLAIM_PROJECTIONS_COLLECTION,
  CLAIM_PROJECTION_STATUS_COLLECTION,
  PROJECTION_REPAIRS_COLLECTION,
} from "../../src/recall/projections/contracts";
import type { DocumentStore } from "../../src/storage/contracts";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src/storage/memory";
import { createFakeEmbeddingAdapter } from "../../src/testing/fakes";

describe("public forget API", () => {
  it("deletes a stored memory record by id", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "Remember that the robot workflow is blocked on prod migration.",
        },
      ],
    });

    const stored = await documentStore.query<{ id: string }>("facts", {
      userId: "u-1",
      workspaceId: "workspace-a",
    });
    const forgotten = await memory.forget({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      memoryId: String(stored[0]?.id),
    });

    expect(forgotten.forgotten).toBe(true);
    expect(
      await documentStore.query("facts", {
        userId: "u-1",
        workspaceId: "workspace-a",
      }),
    ).toHaveLength(0);
  });

  it("deletes vector embeddings alongside forgettable durable memory", async () => {
    const documentStore = createInMemoryDocumentStore();
    const vectorStore = createInMemoryVectorStore();
    const embeddingAdapter = createFakeEmbeddingAdapter();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
        vectorStore,
        embeddingAdapter,
      },
    });
    const scope = { userId: "u-vector", workspaceId: "workspace-a", sessionId: "s-1" } as const;

    await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that the robot workflow is blocked on prod migration.",
        },
      ],
    });

    const stored = await documentStore.query<{ id: string; content: string }>("facts", {
      userId: "u-vector",
      workspaceId: "workspace-a",
    });
    const [embedding] = await embeddingAdapter.embed([String(stored[0]?.content)]);

    expect(
      await vectorStore.search("facts", embedding, {
        topK: 1,
        filter: { userId: "u-vector", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(1);

    await memory.forget({
      scope: { userId: "u-vector", workspaceId: "workspace-a" },
      memoryId: String(stored[0]?.id),
    });

    expect(
      await vectorStore.search("facts", embedding, {
        topK: 1,
        filter: { userId: "u-vector", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(0);
  });

  it("deletes source evidence and claim projections linked only to the forgotten memory", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: {
        extractor: {
          async extract() {
            return {
              candidates: [{
                id: "candidate-1",
                kindHint: "fact" as const,
                explicitness: "explicit" as const,
                content: "Atlas uses the partner API.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                extractorIds: ["test-claim-v1"],
                metadata: {
                  subject: "Atlas",
                  claim: {
                    predicateKey: "integration.partner_api",
                    objectText: "partner API",
                  },
                },
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
    });
    const scope = { userId: "u-provenance", workspaceId: "workspace-a" };
    const remembered = await memory.remember({
      scope,
      messages: [{
        id: "source-message-1",
        role: "user",
        content: "Atlas uses the partner API.",
        observedAt: "2026-07-15T00:00:00.000Z",
      }],
    });
    const memoryId = remembered.events.find(({ memoryType }) => memoryType === "fact")
      ?.memoryId;

    expect(await documentStore.query(EVIDENCE_COLLECTION, scope)).toHaveLength(1);
    expect(await documentStore.query(SOURCE_MESSAGES_COLLECTION, scope)).toHaveLength(1);
    expect(await documentStore.query(CLAIM_PROJECTIONS_COLLECTION, {
      sourceMemoryId: memoryId!,
    })).toHaveLength(1);

    await memory.forget({ scope, memoryId });

    expect(await documentStore.query(EVIDENCE_COLLECTION, scope)).toHaveLength(0);
    expect(await documentStore.query(SOURCE_MESSAGES_COLLECTION, scope)).toHaveLength(0);
    expect(await documentStore.query(CLAIM_PROJECTIONS_COLLECTION, {
      sourceMemoryId: memoryId!,
    })).toHaveLength(0);
    expect(await documentStore.query(CLAIM_PROJECTION_STATUS_COLLECTION, {
      sourceMemoryId: memoryId!,
    })).toHaveLength(0);
  });

  it("removes pending claim repairs and their sensitive payload when forgetting a fact", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });
    const scope = { userId: "u-repair-forget", workspaceId: "workspace-a" };
    const remembered = await memory.remember({
      scope,
      messages: [{ role: "user", content: "Remember that Atlas is blocked." }],
    });
    const memoryId = remembered.events.find(({ memoryType }) => memoryType === "fact")
      ?.memoryId!;
    await documentStore.set(PROJECTION_REPAIRS_COLLECTION, "repair-sensitive", {
      ...scope,
      id: "repair-sensitive",
      schemaVersion: 1,
      scopeKey: "u-repair-forget/workspace-a",
      sourceCollection: "facts",
      sourceMemoryId: memoryId,
      attempts: 1,
      firstFailedAt: "2026-07-17T00:00:00.000Z",
      lastFailedAt: "2026-07-17T00:00:00.000Z",
      lastError: "injected",
      target: "claim",
      claimInput: {
        ...scope,
        sourceMemoryId: memoryId,
        subject: "Atlas",
        claim: {
          predicateKey: "project.status",
          objectText: "sensitive-object-text",
        },
        observedAt: "2026-07-17T00:00:00.000Z",
        ingestedAt: "2026-07-17T00:00:00.000Z",
        evidenceIds: [],
        sourceMessageIds: [],
        extractorVersion: "test-v1",
      },
    });

    const result = await memory.forget({ scope, memoryId });

    expect(result.forgotten).toBe(true);
    expect(await documentStore.query(PROJECTION_REPAIRS_COLLECTION, {
      sourceMemoryId: memoryId,
    })).toEqual([]);
    expect(JSON.stringify(await documentStore.query(
      PROJECTION_REPAIRS_COLLECTION,
      {},
    ))).not.toContain("sensitive-object-text");
  });

  it("deletes only the raw source record owned by forgotten evidence when an external message id is reused", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: {
        extractor: {
          async extract(input) {
            return {
              candidates: [{
                id: `candidate-${input.messages[0]!.content}`,
                kindHint: "fact" as const,
                explicitness: "explicit" as const,
                content: input.messages[0]!.content,
                sourceMessageIndex: 0,
                sourceRole: "user",
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
    });
    const scope = { userId: "u-reused-source", workspaceId: "workspace-a" };
    const first = await memory.remember({
      scope,
      messages: [{ id: "external-message-1", role: "user", content: "Atlas is blocked." }],
    });
    await memory.remember({
      scope,
      messages: [{ id: "external-message-1", role: "user", content: "Borealis is healthy." }],
    });

    await memory.forget({
      scope,
      memoryId: first.events.find((event) => event.memoryType === "fact")?.memoryId,
    });

    const rawMessages = await documentStore.query<{ content: string }>(
      SOURCE_MESSAGES_COLLECTION,
      scope,
    );
    expect(rawMessages.map((message) => message.content)).toEqual([
      "Borealis is healthy.",
    ]);
  });

  it("returns false when the requested memory id does not exist", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });

    const result = await memory.forget({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
      memoryId: "missing-memory",
    });

    expect(result.forgotten).toBe(false);
  });

  it("does not delete memory outside the requested scope", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "Remember that the robot workflow is blocked on prod migration.",
        },
      ],
    });

    const stored = await documentStore.query<{ id: string }>("facts", {
      userId: "u-1",
      workspaceId: "workspace-a",
    });

    const result = await memory.forget({
      scope: { userId: "u-1", workspaceId: "workspace-b" },
      memoryId: String(stored[0]?.id),
    });

    expect(result.forgotten).toBe(false);
    expect(
      await documentStore.query("facts", {
        userId: "u-1",
        workspaceId: "workspace-a",
      }),
    ).toHaveLength(1);
  });

  it("deletes archive, evidence, experience, proposal, and promotion records by id", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    const scope = { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" };
    const source = createMemorySource({
      method: "explicit",
      extractedAt: "2026-04-10T00:00:00.000Z",
      sessionId: "s-1",
    });
    await documentStore.set(
      SESSION_ARCHIVES_COLLECTION,
      "archive-1",
      createSessionArchive({
        id: "archive-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        summary: "Archive handoff summary.",
        unresolvedItems: ["confirm rollback owner"],
      }),
    );
    await documentStore.set(
      EVIDENCE_COLLECTION,
      "evidence-1",
      createEvidenceRecord({
        id: "evidence-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        kind: "conversation_excerpt",
        excerpt: "Need to confirm rollback owner before rollout resumes.",
        source,
      }),
    );
    await documentStore.set(
      EXPERIENCES_COLLECTION,
      "experience-1",
      createExperienceRecord({
        id: "experience-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        kind: "session_end",
        traceId: "trace-1",
        summary: "Archived one unresolved rollback task.",
      }),
    );
    await documentStore.set(
      LEARNING_PROPOSALS_COLLECTION,
      "proposal-1",
      createLearningProposal({
        id: "proposal-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        proposalType: "memory_revision",
        traceId: "trace-proposal-1",
        summary: "Revise the rollout blocker after a newer correction.",
        rationale: "Later evidence supersedes the older blocker statement.",
        sourceExperienceIds: ["experience-1"],
      }),
    );
    await documentStore.set(
      PROMOTION_RECORDS_COLLECTION,
      "promotion-1",
      createPromotionRecord({
        id: "promotion-1",
        proposalId: "proposal-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        traceId: "trace-promotion-1",
        decision: "delayed",
        summary: "Delay the memory revision until verify reruns.",
        rationale: "The correction should not auto-promote yet.",
        sourceExperienceIds: ["experience-1"],
      }),
    );

    expect(
      await memory.forget({
        scope,
        memoryId: "archive-1",
      }),
    ).toEqual({ forgotten: true });
    expect(
      await memory.forget({
        scope,
        memoryId: "evidence-1",
      }),
    ).toEqual({ forgotten: true });
    expect(
      await memory.forget({
        scope,
        memoryId: "experience-1",
      }),
    ).toEqual({ forgotten: true });
    expect(
      await memory.forget({
        scope,
        memoryId: "proposal-1",
      }),
    ).toEqual({ forgotten: true });
    expect(
      await memory.forget({
        scope,
        memoryId: "promotion-1",
      }),
    ).toEqual({ forgotten: true });

    expect(await documentStore.get(SESSION_ARCHIVES_COLLECTION, "archive-1")).toBeNull();
    expect(await documentStore.get(EVIDENCE_COLLECTION, "evidence-1")).toBeNull();
    expect(await documentStore.get(EXPERIENCES_COLLECTION, "experience-1")).toBeNull();
    expect(await documentStore.get(LEARNING_PROPOSALS_COLLECTION, "proposal-1")).toBeNull();
    expect(await documentStore.get(PROMOTION_RECORDS_COLLECTION, "promotion-1")).toBeNull();
  });

  it("lets the canonical store own evidence deletion exactly once", async () => {
    const rawStore = createInMemoryDocumentStore();
    let evidenceDeleteCount = 0;
    const documentStore: DocumentStore = {
      ...rawStore,
      async delete(collection, id) {
        if (collection === EVIDENCE_COLLECTION && id === "evidence-once") {
          evidenceDeleteCount += 1;
        }
        await rawStore.delete(collection, id);
      },
    };
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });
    const scope = { userId: "u-evidence-owner", workspaceId: "workspace-a" };
    await rawStore.set(EVIDENCE_COLLECTION, "evidence-once", createEvidenceRecord({
      id: "evidence-once",
      ...scope,
      kind: "conversation_excerpt",
      excerpt: "One owner deletes this evidence.",
      source: createMemorySource({
        method: "explicit",
        extractedAt: "2026-07-16T00:00:00.000Z",
      }),
    }));

    expect(await memory.forget({ scope, memoryId: "evidence-once" })).toEqual({
      forgotten: true,
    });
    expect(evidenceDeleteCount).toBe(1);
  });

  it("preserves the projection store repair contract when forget cleanup fails", async () => {
    const rawStore = createInMemoryDocumentStore();
    let failProjectionDelete = false;
    const documentStore: DocumentStore = {
      ...rawStore,
      async delete(collection, id) {
        if (failProjectionDelete && collection === CLAIM_PROJECTIONS_COLLECTION) {
          throw new Error("injected projection delete failure");
        }
        await rawStore.delete(collection, id);
      },
    };
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: {
        extractor: {
          async extract() {
            return {
              candidates: [{
                id: "candidate-projection-failure",
                kindHint: "fact" as const,
                explicitness: "explicit" as const,
                content: "Atlas is active.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                metadata: {
                  subject: "Atlas",
                  claim: {
                    predicateKey: "project.status",
                    objectText: "active",
                  },
                },
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
    });
    const scope = { userId: "u-projection-owner", workspaceId: "workspace-a" };
    const remembered = await memory.remember({
      scope,
      messages: [{ role: "user", content: "Atlas is active." }],
    });
    const memoryId = remembered.events.find((event) => event.memoryType === "fact")
      ?.memoryId;
    failProjectionDelete = true;

    await expect(memory.forget({ scope, memoryId })).rejects.toThrow(
      "projection cleanup is pending",
    );
    expect(await rawStore.get("facts", memoryId!)).toBeNull();
    expect(await rawStore.query(PROJECTION_REPAIRS_COLLECTION, {
      sourceMemoryId: memoryId!,
    })).toHaveLength(1);
  });
});
