import { describe, expect, it } from "bun:test";

import { createGoodMemory } from "../../src";
import { createInternalGoodMemory } from "../../src/api/createGoodMemory";
import { createFactMemory } from "../../src/domain/records";
import {
  PROJECTION_MANIFESTS_COLLECTION,
  PROJECTION_REPAIRS_COLLECTION,
  RECALL_DOCUMENTS_COLLECTION,
  type RecallIndexDocument,
} from "../../src/recall/projections/contracts";
import type {
  DocumentStore,
  StorageDocument,
} from "../../src/storage/contracts";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";

function createOneShotProjectionFailureStore(inner: DocumentStore): DocumentStore {
  let shouldFail = true;
  return {
    projectionBatchSemantics: inner.projectionBatchSemantics,
    async set<TDocument extends StorageDocument>(
      collection: string,
      id: string,
      document: TDocument,
    ) {
      if (collection === RECALL_DOCUMENTS_COLLECTION && shouldFail) {
        shouldFail = false;
        throw new Error("injected projection failure");
      }
      await inner.set(collection, id, document);
    },
    get: (collection, id) => inner.get(collection, id),
    update: (collection, id, patch) => inner.update(collection, id, patch),
    query: (collection, filter) => inner.query(collection, filter),
    delete: (collection, id) => inner.delete(collection, id),
    async writeBatchIfUnchanged(input) {
      if (
        shouldFail &&
        input.set.some(({ collection }) =>
          collection === RECALL_DOCUMENTS_COLLECTION
        )
      ) {
        shouldFail = false;
        throw new Error("injected projection failure");
      }
      return inner.writeBatchIfUnchanged!(input);
    },
  };
}

function createOneShotProjectionDeleteFailureStore(
  inner: DocumentStore,
): DocumentStore {
  let shouldFail = true;
  return {
    projectionBatchSemantics: inner.projectionBatchSemantics,
    set: (collection, id, document) => inner.set(collection, id, document),
    get: (collection, id) => inner.get(collection, id),
    update: (collection, id, patch) => inner.update(collection, id, patch),
    query: (collection, filter) => inner.query(collection, filter),
    async delete(collection, id) {
      if (collection === RECALL_DOCUMENTS_COLLECTION && shouldFail) {
        shouldFail = false;
        throw new Error("injected projection delete failure");
      }
      await inner.delete(collection, id);
    },
    writeBatchIfUnchanged: (input) => inner.writeBatchIfUnchanged!(input),
  };
}

describe("recall projections through the public API", () => {
  it("runs an explicit projectionMigration maintenance job from canonical memory", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      retrieval: { preset: "recommended" },
    });
    const scope = {
      userId: "migration-user",
      workspaceId: "migration-workspace",
    };
    const fact = createFactMemory({
      id: "fact-maintenance-migration",
      ...scope,
      category: "project",
      content: "Atlas uses PostgreSQL.",
      source: { method: "explicit", extractedAt: "2026-07-10T00:00:00.000Z" },
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    });
    await documentStore.set("facts", fact.id, fact);

    const report = await memory.runMaintenance({
      scope,
      jobs: ["projectionMigration"],
    });

    expect(report.maintenance?.jobs).toContainEqual({
      name: "projectionMigration",
      applied: 1,
    });
    expect(
      await documentStore.query(RECALL_DOCUMENTS_COLLECTION, {
        sourceMemoryId: fact.id,
      }),
    ).not.toEqual([]);
  });

  it("does not persist projection trust proof for caller-owned stores", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      retrieval: { preset: "recommended" },
    });
    const scope = {
      userId: "custom-proof-user",
      workspaceId: "custom-proof-workspace",
    };
    await memory.remember({
      scope,
      messages: [{
        role: "user",
        content: "Remember that Atlas rollout is active.",
      }],
    });

    await memory.recall({ scope, query: "What is the Atlas rollout status?" });

    expect(
      await documentStore.query(PROJECTION_MANIFESTS_COLLECTION),
    ).toEqual([]);
  });

  it("lets internal bulk ingestion defer projections until first recall", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createInternalGoodMemory(
      {
        adapters: {
          documentStore,
          sessionStore: createInMemorySessionStore(),
        },
        retrieval: { preset: "recommended" },
        storage: { provider: "memory" },
      },
      { environment: {}, projectionWriteThrough: false },
    );
    const scope = { userId: "bulk-user", sessionId: "bulk-session" };

    await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that Atlas rollout is blocked on Paris approval.",
        },
      ],
    });

    expect(await documentStore.query(RECALL_DOCUMENTS_COLLECTION)).toEqual([]);

    const recalled = await memory.recall({
      scope: { userId: scope.userId },
      query: "What is blocking the Atlas rollout?",
    });

    expect(recalled.facts.length).toBeGreaterThan(0);
    expect(await documentStore.query(RECALL_DOCUMENTS_COLLECTION)).not.toEqual(
      [],
    );
  });

  it("does not amplify default writes when generalized retrieval is disabled", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      storage: { provider: "memory" },
    });

    const remembered = await memory.remember({
      scope: { userId: "default-user", sessionId: "default-session" },
      messages: [
        {
          role: "user",
          content: "Remember that Atlas rollout is blocked on Paris approval.",
        },
      ],
    });

    expect(remembered.events.some((event) => event.memoryType === "fact")).toBe(
      true,
    );
    expect(await documentStore.query(RECALL_DOCUMENTS_COLLECTION)).toEqual([]);
  });

  it("keeps projections aligned across remember, revise, and forget", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      retrieval: { preset: "recommended" },
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: {
        now: () => new Date("2026-07-10T12:00:00.000Z"),
      },
    });
    const scope = {
      userId: "projection-user",
      workspaceId: "projection-workspace",
      sessionId: "projection-session",
    };

    const remembered = await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "I prefer VS Code as my editor.",
        },
      ],
    });
    const previousMemoryId = remembered.events.find(
      (event) => event.memoryType === "preference",
    )?.memoryId;
    expect(previousMemoryId).toBeString();
    expect(
      await documentStore.query<RecallIndexDocument>(
        RECALL_DOCUMENTS_COLLECTION,
        { sourceMemoryId: previousMemoryId! },
      ),
    ).not.toEqual([]);

    const revised = await memory.reviseMemory({
      scope,
      target: { memoryId: previousMemoryId! },
      revision: { content: "My preferred editor is Cursor, not VS Code." },
      reason: "user_correction",
      idempotencyKey: "projection-editor-revision",
    });
    expect(revised.accepted).toBe(true);
    expect(revised.newMemoryId).toBeString();
    expect(
      await documentStore.query(RECALL_DOCUMENTS_COLLECTION, {
        sourceMemoryId: previousMemoryId!,
      }),
    ).toEqual([]);
    expect(
      await documentStore.query(RECALL_DOCUMENTS_COLLECTION, {
        sourceMemoryId: revised.newMemoryId!,
      }),
    ).not.toEqual([]);

    const forgotten = await memory.forget({
      scope,
      memoryId: revised.newMemoryId,
    });
    expect(forgotten.forgotten).toBe(true);
    expect(
      await documentStore.query(RECALL_DOCUMENTS_COLLECTION, {
        sourceMemoryId: revised.newMemoryId!,
      }),
    ).toEqual([]);
  });

  it("repairs queued projection failures through public maintenance", async () => {
    const rawStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      retrieval: { preset: "recommended" },
      storage: { provider: "memory" },
      adapters: {
        documentStore: createOneShotProjectionFailureStore(rawStore),
        sessionStore: createInMemorySessionStore(),
      },
      testing: {
        now: () => new Date("2026-07-10T12:00:00.000Z"),
      },
    });
    const scope = {
      userId: "repair-user",
      workspaceId: "repair-workspace",
      sessionId: "repair-session",
    };

    const remembered = await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that Atlas rollout is blocked on Paris approval.",
        },
      ],
    });
    const memoryId = remembered.events.find(
      (event) => event.memoryType === "fact",
    )?.memoryId;
    expect(memoryId).toBeString();
    expect(await rawStore.query(PROJECTION_REPAIRS_COLLECTION)).toHaveLength(1);

    const maintenance = await memory.runMaintenance({
      scope,
      jobs: ["projectionRepair"],
    });

    expect(maintenance.ran).toBe(true);
    expect(
      await rawStore.query(RECALL_DOCUMENTS_COLLECTION, {
        sourceMemoryId: memoryId!,
      }),
    ).not.toEqual([]);
    expect(await rawStore.query(PROJECTION_REPAIRS_COLLECTION)).toEqual([]);
  });

  it("does not report forget success while projection cleanup is pending", async () => {
    const rawStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore: createOneShotProjectionDeleteFailureStore(rawStore),
        sessionStore: createInMemorySessionStore(),
      },
      retrieval: { preset: "recommended" },
      storage: { provider: "memory" },
    });
    const scope = {
      userId: "forget-repair-user",
      sessionId: "forget-repair-session",
    };
    const remembered = await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that Atlas rollout is blocked on Paris approval.",
        },
      ],
    });
    const memoryId = remembered.events.find(
      (event) => event.memoryType === "fact",
    )?.memoryId;
    expect(memoryId).toBeString();

    await expect(memory.forget({ scope, memoryId })).rejects.toThrow(
      "projection cleanup is pending",
    );
    expect(await rawStore.get("facts", memoryId!)).toBeNull();
    expect(
      await rawStore.query(RECALL_DOCUMENTS_COLLECTION, {
        sourceMemoryId: memoryId!,
      }),
    ).not.toEqual([]);

    await memory.runMaintenance({ scope, jobs: ["projectionRepair"] });

    expect(
      await rawStore.query(RECALL_DOCUMENTS_COLLECTION, {
        sourceMemoryId: memoryId!,
      }),
    ).toEqual([]);
  });

  it("uses a structured singleton claim only in the relation fusion channel", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      retrieval: { preset: "recommended", recallPlanExecution: true },
      testing: {
        extractor: {
          async extract() {
            return {
              candidates: [{
                id: "candidate-atlas-lisbon",
                kindHint: "fact" as const,
                explicitness: "explicit" as const,
                content: "Atlas currently deploys through Lisbon.",
                sourceMessageIndex: 0,
                sourceRole: "user",
                extractorIds: ["test-claim-v1"],
                metadata: {
                  subject: "Atlas",
                  claim: {
                    predicateKey: "deployment.relation",
                    objectText: "deploys through Lisbon",
                    objectEntity: "Lisbon",
                    validFrom: "2026-07-01T00:00:00.000Z",
                  },
                },
              }],
              ignoredMessageCount: 0,
            };
          },
        },
        now: () => new Date("2026-07-10T12:00:00.000Z"),
      },
    });
    const scope = { userId: "claim-channel-user" };
    const remembered = await memory.remember({
      scope,
      messages: [{
        id: "message-atlas-lisbon",
        role: "user",
        content: "Atlas currently deploys through Lisbon.",
        observedAt: "2026-07-01T00:00:00.000Z",
      }],
    });
    const memoryId = remembered.events.find(({ memoryType }) => memoryType === "fact")
      ?.memoryId;
    if (!memoryId) {
      throw new Error("Expected the claim fixture to create a fact memory.");
    }

    const recalled = await memory.recall({
      scope,
      query: "How is Atlas currently connected to Lisbon?",
      strategy: "hybrid",
    });
    const traceCandidate = recalled.metadata.retrievalTrace?.fusionRuns
      ?.flatMap(({ candidates }) => candidates)
      .find(({ sourceMemoryId }) => sourceMemoryId === memoryId);

    expect(traceCandidate?.channels.temporal).toBeUndefined();
    expect(traceCandidate?.channels.relation).toBeDefined();
    expect(recalled.facts).toEqual([
      expect.objectContaining({
        id: memoryId,
        content: "Atlas currently deploys through Lisbon.",
      }),
    ]);
    expect("evidenceLedger" in recalled).toBe(false);

    const withEvidence = await memory.recall({
      scope,
      query: "How is Atlas currently connected to Lisbon?",
      strategy: "hybrid",
      includeEvidence: true,
    });

    expect(withEvidence.facts.map(({ id }) => id)).toEqual([memoryId]);
    expect(withEvidence.evidence[0]?.sourceRecordIds).toEqual([
      expect.any(String),
    ]);
    expect(withEvidence.metadata.candidateTraces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memoryId, returned: true }),
      ]),
    );
    expect(withEvidence.metadata.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: memoryId,
          evidenceIds: [withEvidence.evidence[0]?.id],
          type: "fact",
        }),
      ]),
    );
    expect(withEvidence.evidenceLedger).toEqual([
      expect.objectContaining({
        evidenceId: withEvidence.evidence[0]?.id,
        sourceMemoryId: memoryId,
        relation: "supports",
        temporalStatus: "current",
        claim: expect.objectContaining({
          predicateKey: "deployment.relation",
        }),
      }),
    ]);
  });
});
