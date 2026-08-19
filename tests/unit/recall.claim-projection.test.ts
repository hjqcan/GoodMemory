import { describe, expect, it } from "bun:test";

import { createFactMemory } from "../../src/domain/records";
import { buildClaimProjectionStatusId } from "../../src/recall/projections/claims";
import {
  CLAIM_PROJECTIONS_COLLECTION,
  CLAIM_PROJECTION_STATUS_COLLECTION,
  PROJECTION_REPAIRS_COLLECTION,
  type AppendClaimProjectionInput,
  type ClaimProjection,
  type ClaimProjectionStatus,
  type ProjectionRepairRecord,
} from "../../src/recall/projections/contracts";
import { createRecallProjectionRuntime } from "../../src/recall/projections/runtime";
import { recallScopeKey } from "../../src/recall/projections/shared";
import type { DocumentStore, StorageDocument } from "../../src/storage/contracts";
import { createInMemoryDocumentStore } from "../../src/storage/memory";

const NOW = "2026-07-16T12:00:00.000Z";
const scope = {
  userId: "user-1",
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  sessionId: "session-1",
};

function claimInput(
  objectText: string,
  ingestedAt: string,
): AppendClaimProjectionInput {
  return {
    ...scope,
    sourceMemoryId: "fact-1",
    subject: "Atlas",
    claim: {
      predicateKey: "project.status",
      objectText,
      polarity: "positive",
      modality: "asserted",
    },
    observedAt: "2026-07-15T09:00:00.000Z",
    ingestedAt,
    evidenceIds: [`evidence-${objectText}`],
    sourceMessageIds: [`message-${objectText}`],
    extractorVersion: "extractor-v1",
  };
}

function buildFact() {
  return createFactMemory({
    ...scope,
    id: "fact-1",
    category: "project",
    content: "Atlas is active.",
    subject: "Atlas",
    source: {
      method: "explicit",
      extractedAt: "2026-07-15T09:00:00.000Z",
    },
    validFrom: "2026-07-15T09:00:00.000Z",
    createdAt: "2026-07-15T09:00:00.000Z",
    updatedAt: "2026-07-15T09:00:00.000Z",
  });
}

function createOneShotClaimFailureStore(inner: DocumentStore): DocumentStore {
  let fail = true;

  return {
    projectionBatchSemantics: inner.projectionBatchSemantics,
    async set<TDocument extends StorageDocument>(collection: string, id: string, document: TDocument) {
      if (collection === CLAIM_PROJECTIONS_COLLECTION && fail) {
        fail = false;
        throw new Error("injected claim projection failure");
      }
      await inner.set(collection, id, document);
    },
    get: (collection, id) => inner.get(collection, id),
    update: (collection, id, patch) => inner.update(collection, id, patch),
    query: (collection, filter) => inner.query(collection, filter),
    delete: (collection, id) => inner.delete(collection, id),
    queryPage: inner.queryPage
      ? (collection, input) => inner.queryPage!(collection, input)
      : undefined,
    writeBatchIfUnchanged: async (input) => {
      if (
        input.set.some(({ collection }) =>
          collection === CLAIM_PROJECTIONS_COLLECTION
        ) && fail
      ) {
        fail = false;
        throw new Error("injected claim projection failure");
      }
      return inner.writeBatchIfUnchanged!(input);
    },
  };
}

function createConcurrentFallbackPromotionStore(
  inner: DocumentStore,
  fallbackId: string,
): {
  promotionAttempts: () => number;
  store: DocumentStore;
} {
  let changedFallback = false;
  let promotionAttempts = 0;

  return {
    promotionAttempts: () => promotionAttempts,
    store: {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      set: (collection, id, document) => inner.set(collection, id, document),
      get: (collection, id) => inner.get(collection, id),
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => inner.query(collection, filter),
      delete: (collection, id) => inner.delete(collection, id),
      queryPage: inner.queryPage
        ? (collection, input) => inner.queryPage!(collection, input)
        : undefined,
      async writeBatchIfUnchanged(input) {
        if (
          input.set.some(({ collection, document }) =>
            collection === CLAIM_PROJECTION_STATUS_COLLECTION &&
            (document as ClaimProjectionStatus).retiredRevisionIds?.includes(
              fallbackId,
            )
          )
        ) {
          promotionAttempts += 1;
          if (!changedFallback) {
            changedFallback = true;
            const fallback = await inner.get<ClaimProjection>(
              CLAIM_PROJECTIONS_COLLECTION,
              fallbackId,
            );
            if (fallback) {
              await inner.set(CLAIM_PROJECTIONS_COLLECTION, fallbackId, {
                ...fallback,
                evidenceIds: [...fallback.evidenceIds, "evidence-concurrent"],
              });
            }
          }
        }
        return inner.writeBatchIfUnchanged!(input);
      },
    },
  };
}

function createBlockedRepairStore(inner: DocumentStore): {
  releaseRepair: () => void;
  repairStarted: Promise<void>;
  store: DocumentStore;
} {
  let fail = true;
  let releaseRepair = () => {};
  let markRepairStarted = () => {};
  const repairStarted = new Promise<void>((resolve) => {
    markRepairStarted = resolve;
  });
  const repairRelease = new Promise<void>((resolve) => {
    releaseRepair = resolve;
  });

  return {
    releaseRepair,
    repairStarted,
    store: {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      async set<TDocument extends StorageDocument>(
        collection: string,
        id: string,
        document: TDocument,
      ) {
        if (collection === CLAIM_PROJECTIONS_COLLECTION) {
          if (fail) {
            fail = false;
            throw new Error("injected claim projection failure");
          }
          markRepairStarted();
          await repairRelease;
        }
        await inner.set(collection, id, document);
      },
      get: (collection, id) => inner.get(collection, id),
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => inner.query(collection, filter),
      delete: (collection, id) => inner.delete(collection, id),
      queryPage: inner.queryPage
        ? (collection, input) => inner.queryPage!(collection, input)
        : undefined,
      writeBatchIfUnchanged: async (input) => {
        if (input.set.some(({ collection }) =>
          collection === CLAIM_PROJECTIONS_COLLECTION
        )) {
          if (fail) {
            fail = false;
            throw new Error("injected claim projection failure");
          }
          markRepairStarted();
          await repairRelease;
        }
        return inner.writeBatchIfUnchanged!(input);
      },
    },
  };
}

function createInterleavedRepairStore(inner: DocumentStore): {
  releaseOldRepair: () => void;
  oldRepairStarted: Promise<void>;
  store: DocumentStore;
} {
  let claimBatchCalls = 0;
  let releaseOldRepair = () => {};
  let markOldRepairStarted = () => {};
  const oldRepairStarted = new Promise<void>((resolve) => {
    markOldRepairStarted = resolve;
  });
  const oldRepairRelease = new Promise<void>((resolve) => {
    releaseOldRepair = resolve;
  });
  return {
    releaseOldRepair,
    oldRepairStarted,
    store: {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      set: (collection, id, document) => inner.set(collection, id, document),
      get: (collection, id) => inner.get(collection, id),
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => inner.query(collection, filter),
      delete: (collection, id) => inner.delete(collection, id),
      queryPage: inner.queryPage
        ? (collection, input) => inner.queryPage!(collection, input)
        : undefined,
      writeBatchIfUnchanged: async (input) => {
        if (input.set.some(({ collection }) =>
          collection === CLAIM_PROJECTIONS_COLLECTION
        )) {
          claimBatchCalls += 1;
          if (claimBatchCalls === 1) {
            throw new Error("injected first claim append failure");
          }
          if (claimBatchCalls === 2) {
            markOldRepairStarted();
            await oldRepairRelease;
          }
        }
        return inner.writeBatchIfUnchanged!(input);
      },
    },
  };
}

function createDelayedFailingAppendStore(inner: DocumentStore): {
  appendStarted: Promise<void>;
  releaseAppend: () => void;
  store: DocumentStore;
} {
  let blockFirstClaimBatch = true;
  let markAppendStarted = () => {};
  let releaseAppend = () => {};
  const appendStarted = new Promise<void>((resolve) => {
    markAppendStarted = resolve;
  });
  const appendRelease = new Promise<void>((resolve) => {
    releaseAppend = resolve;
  });
  return {
    appendStarted,
    releaseAppend,
    store: {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      set: (collection, id, document) => inner.set(collection, id, document),
      get: (collection, id) => inner.get(collection, id),
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => inner.query(collection, filter),
      delete: (collection, id) => inner.delete(collection, id),
      queryPage: inner.queryPage
        ? (collection, input) => inner.queryPage!(collection, input)
        : undefined,
      writeBatchIfUnchanged: async (input) => {
        if (
          blockFirstClaimBatch &&
          input.set.some(({ collection }) =>
            collection === CLAIM_PROJECTIONS_COLLECTION
          )
        ) {
          blockFirstClaimBatch = false;
          markAppendStarted();
          await appendRelease;
          throw new Error("delayed claim append failure");
        }
        return inner.writeBatchIfUnchanged!(input);
      },
    },
  };
}

function createDeleteRepairRaceStore(inner: DocumentStore): {
  deletionStarted: Promise<void>;
  releaseDeletion: () => void;
  store: DocumentStore;
} {
  let failClaim = true;
  let blockDelete = true;
  let markDeletionStarted = () => {};
  let releaseDeletion = () => {};
  const deletionStarted = new Promise<void>((resolve) => {
    markDeletionStarted = resolve;
  });
  const deletionRelease = new Promise<void>((resolve) => {
    releaseDeletion = resolve;
  });
  return {
    deletionStarted,
    releaseDeletion,
    store: {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      set: (collection, id, document) => inner.set(collection, id, document),
      get: (collection, id) => inner.get(collection, id),
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => inner.query(collection, filter),
      delete: (collection, id) => inner.delete(collection, id),
      queryPage: inner.queryPage,
      writeBatchIfUnchanged: async (input) => {
        if (
          failClaim &&
          input.set.some(({ collection }) =>
            collection === CLAIM_PROJECTIONS_COLLECTION
          )
        ) {
          failClaim = false;
          throw new Error("injected claim append failure");
        }
        if (
          blockDelete &&
          input.delete?.some(({ collection, id }) =>
            collection === "facts" && id === "fact-1"
          )
        ) {
          blockDelete = false;
          markDeletionStarted();
          await deletionRelease;
        }
        return inner.writeBatchIfUnchanged!(input);
      },
    },
  };
}

function createBlockedLifecycleStore(inner: DocumentStore): {
  lifecycleStarted: Promise<void>;
  releaseLifecycle: () => void;
  store: DocumentStore;
} {
  let blockLifecycle = true;
  let markLifecycleStarted = () => {};
  let releaseLifecycle = () => {};
  const lifecycleStarted = new Promise<void>((resolve) => {
    markLifecycleStarted = resolve;
  });
  const lifecycleRelease = new Promise<void>((resolve) => {
    releaseLifecycle = resolve;
  });
  return {
    lifecycleStarted,
    releaseLifecycle,
    store: {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      set: (collection, id, document) => inner.set(collection, id, document),
      get: (collection, id) => inner.get(collection, id),
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => inner.query(collection, filter),
      delete: (collection, id) => inner.delete(collection, id),
      queryPage: inner.queryPage,
      writeBatchIfUnchanged: async (input) => {
        const expected = input.expected.document;
        if (
          blockLifecycle &&
          expected &&
          "lifecycle" in expected &&
          expected.lifecycle === "superseded"
        ) {
          blockLifecycle = false;
          markLifecycleStarted();
          await lifecycleRelease;
        }
        return inner.writeBatchIfUnchanged!(input);
      },
    },
  };
}

function createConcurrentAppendStore(inner: DocumentStore): {
  newAppendStarted: Promise<void>;
  oldAppendStarted: Promise<void>;
  releaseNewAppend: () => void;
  releaseOldAppend: () => void;
  store: DocumentStore;
} {
  let claimBatchCount = 0;
  let markNewAppendStarted = () => {};
  let markOldAppendStarted = () => {};
  let releaseNewAppend = () => {};
  let releaseOldAppend = () => {};
  const newAppendStarted = new Promise<void>((resolve) => {
    markNewAppendStarted = resolve;
  });
  const oldAppendStarted = new Promise<void>((resolve) => {
    markOldAppendStarted = resolve;
  });
  const newAppendRelease = new Promise<void>((resolve) => {
    releaseNewAppend = resolve;
  });
  const oldAppendRelease = new Promise<void>((resolve) => {
    releaseOldAppend = resolve;
  });
  return {
    newAppendStarted,
    oldAppendStarted,
    releaseNewAppend,
    releaseOldAppend,
    store: {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      set: (collection, id, document) => inner.set(collection, id, document),
      get: (collection, id) => inner.get(collection, id),
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => inner.query(collection, filter),
      delete: (collection, id) => inner.delete(collection, id),
      queryPage: inner.queryPage,
      writeBatchIfUnchanged: async (input) => {
        if (input.set.some(({ collection }) =>
          collection === CLAIM_PROJECTIONS_COLLECTION
        )) {
          claimBatchCount += 1;
          if (claimBatchCount === 1) {
            markOldAppendStarted();
            await oldAppendRelease;
          } else if (claimBatchCount === 2) {
            markNewAppendStarted();
            await newAppendRelease;
          }
        }
        return inner.writeBatchIfUnchanged!(input);
      },
    },
  };
}

describe("claim projection runtime", () => {
  it("searches projection text through the document-store query contract", async () => {
    const store = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({ documentStore: store, now: () => NOW });
    const fact = buildFact();
    await runtime.documentStore.set("facts", fact.id, fact);

    const matches = await runtime.searchDocuments(scope, "Atlas active", 2);

    expect(matches).toHaveLength(2);
    expect(matches.every(({ sourceMemoryId }) => sourceMemoryId === fact.id)).toBe(true);
  });

  it("token-scores natural-language queries when an adapter has no native search", async () => {
    const inner = createInMemoryDocumentStore();
    const store: DocumentStore = {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      set: (collection, id, document) => inner.set(collection, id, document),
      get: (collection, id) => inner.get(collection, id),
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => inner.query(collection, filter),
      delete: (collection, id) => inner.delete(collection, id),
      writeBatchIfUnchanged: (input) => inner.writeBatchIfUnchanged(input),
    };
    const runtime = createRecallProjectionRuntime({ documentStore: store });
    const fact = buildFact();
    await runtime.documentStore.set("facts", fact.id, fact);

    const matches = await runtime.searchDocuments(
      scope,
      "What is the current Atlas project status?",
      5,
    );

    expect(matches.some(({ sourceMemoryId }) => sourceMemoryId === fact.id)).toBe(true);
  });

  it("keeps append-only history while exposing only the latest source projection", async () => {
    const store = createInMemoryDocumentStore();
    const fact = buildFact();
    await store.set("facts", fact.id, fact);
    const runtime = createRecallProjectionRuntime({ documentStore: store, now: () => NOW });

    await runtime.appendClaim(claimInput("planned", "2026-07-16T10:00:00.000Z"));
    await runtime.appendClaim(claimInput("completed", "2026-07-16T11:00:00.000Z"));

    const current = await runtime.queryClaims(scope);
    const history = await runtime.queryClaimHistory(scope);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({
      objectText: "completed",
      polarity: "positive",
      modality: "asserted",
    });
    expect(current[0]?.text).toContain("Atlas");
    expect(current[0]?.text).toContain("project.status");
    expect(current[0]?.text).toContain("completed");
    expect(history.map(({ objectText }) => objectText).sort()).toEqual([
      "completed",
      "planned",
    ]);

    const status = await store.query<ClaimProjectionStatus>(
      CLAIM_PROJECTION_STATUS_COLLECTION,
      { sourceMemoryId: "fact-1" },
    );
    expect(status).toEqual([
      expect.objectContaining({ state: "projected", claimIds: [current[0]!.id] }),
    ]);
  });

  it("closes an older slot value when the replacement becomes valid", async () => {
    const store = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({ documentStore: store });
    const oldFact = buildFact();
    const replacementFact = {
      ...buildFact(),
      id: "fact-2",
      content: "Atlas is completed.",
    };
    await store.set("facts", oldFact.id, oldFact);
    await store.set("facts", replacementFact.id, replacementFact);
    const oldValidFrom = "2026-07-01T00:00:00.000Z";
    const replacementObservedAt = "2026-07-10T00:00:00.000Z";
    const replacementValidFrom = "2026-08-01T00:00:00.000Z";
    const planned = claimInput("planned", oldValidFrom);
    const completed = claimInput("completed", replacementObservedAt);

    await runtime.appendClaim({
      ...planned,
      claim: {
        ...planned.claim,
        validFrom: oldValidFrom,
      },
      observedAt: oldValidFrom,
      sourceMemoryId: oldFact.id,
    });
    await runtime.appendClaim({
      ...completed,
      claim: {
        ...completed.claim,
        validFrom: replacementValidFrom,
      },
      observedAt: replacementObservedAt,
      sourceMemoryId: replacementFact.id,
    });

    const history = await runtime.queryClaimHistory(scope);
    expect(history.find(({ objectText }) => objectText === "planned")?.validUntil)
      .toBe(replacementValidFrom);
    expect(history.find(({ objectText }) => objectText === "completed")?.validUntil)
      .toBeUndefined();
  });

  it("bounds a late-ingested retroactive slot value immediately", async () => {
    const store = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({ documentStore: store });
    const currentFact = buildFact();
    const retroactiveFact = {
      ...buildFact(),
      id: "fact-2",
      content: "Atlas was planned.",
    };
    await store.set("facts", currentFact.id, currentFact);
    await store.set("facts", retroactiveFact.id, retroactiveFact);
    const retroactiveValidFrom = "2026-07-01T00:00:00.000Z";
    const currentValidFrom = "2026-07-10T00:00:00.000Z";
    const lateObservation = "2026-07-20T00:00:00.000Z";
    const completed = claimInput("completed", currentValidFrom);
    const planned = claimInput("planned", lateObservation);

    await runtime.appendClaim({
      ...completed,
      claim: {
        ...completed.claim,
        validFrom: currentValidFrom,
      },
      observedAt: currentValidFrom,
      sourceMemoryId: currentFact.id,
    });
    await runtime.appendClaim({
      ...planned,
      claim: {
        ...planned.claim,
        validFrom: retroactiveValidFrom,
      },
      observedAt: lateObservation,
      sourceMemoryId: retroactiveFact.id,
    });

    const history = await runtime.queryClaimHistory(scope);
    expect(history.find(({ objectText }) => objectText === "planned")?.validUntil)
      .toBe(currentValidFrom);
    expect(history.find(({ objectText }) => objectText === "completed")?.validUntil)
      .toBeUndefined();
    expect(await runtime.sweepClaimSlots(scope)).toBe(0);
  });

  it("loads current claims for selected memories without scanning the whole scope", async () => {
    const inner = createInMemoryDocumentStore();
    const projectionGets: Array<{ collection: string; id: string }> = [];
    let projectionQueries = 0;
    const store: DocumentStore = {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      set: (collection, id, document) => inner.set(collection, id, document),
      get: (collection, id) => {
        if (
          collection === CLAIM_PROJECTIONS_COLLECTION ||
          collection === CLAIM_PROJECTION_STATUS_COLLECTION
        ) {
          projectionGets.push({ collection, id });
        }
        return inner.get(collection, id);
      },
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => {
        if (
          collection === CLAIM_PROJECTIONS_COLLECTION ||
          collection === CLAIM_PROJECTION_STATUS_COLLECTION
        ) {
          projectionQueries += 1;
        }
        return inner.query(collection, filter);
      },
      delete: (collection, id) => inner.delete(collection, id),
      searchText: (collection, input) => inner.searchText!(collection, input),
      writeBatchIfUnchanged: (input) => inner.writeBatchIfUnchanged(input),
    };
    const runtime = createRecallProjectionRuntime({ documentStore: store });
    const factOne = buildFact();
    const factTwo = {
      ...buildFact(),
      id: "fact-2",
      content: "Beacon is paused.",
      subject: "Beacon",
    };
    await runtime.documentStore.set("facts", factOne.id, factOne);
    await runtime.documentStore.set("facts", factTwo.id, factTwo);
    await runtime.appendClaim(claimInput("planned", "2026-07-16T10:00:00.000Z"));
    await runtime.appendClaim(claimInput("completed", "2026-07-16T11:00:00.000Z"));
    await runtime.appendClaim({
      ...claimInput("paused", "2026-07-16T11:30:00.000Z"),
      sourceMemoryId: "fact-2",
      subject: "Beacon",
    });
    projectionGets.length = 0;
    projectionQueries = 0;

    const selected = await runtime.queryClaimsBySourceMemoryIds(scope, [
      "fact-1",
      "missing-memory",
    ]);

    expect(selected).toEqual([
      expect.objectContaining({
        sourceMemoryId: "fact-1",
        objectText: "completed",
      }),
    ]);
    expect(projectionQueries).toBe(0);
    expect(projectionGets.map(({ collection }) => collection)).toEqual([
      CLAIM_PROJECTION_STATUS_COLLECTION,
      CLAIM_PROJECTION_STATUS_COLLECTION,
      CLAIM_PROJECTIONS_COLLECTION,
    ]);
  });

  it("loads current peers for the selected memories' subject and predicate groups", async () => {
    const inner = createInMemoryDocumentStore();
    const claimQueries: Array<Record<string, unknown> | undefined> = [];
    const store: DocumentStore = {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      set: (collection, id, document) => inner.set(collection, id, document),
      get: (collection, id) => inner.get(collection, id),
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => {
        if (collection === CLAIM_PROJECTIONS_COLLECTION) {
          claimQueries.push(filter);
        }
        return inner.query(collection, filter);
      },
      delete: (collection, id) => inner.delete(collection, id),
      searchText: (collection, input) => inner.searchText!(collection, input),
      writeBatchIfUnchanged: (input) => inner.writeBatchIfUnchanged(input),
    };
    const runtime = createRecallProjectionRuntime({ documentStore: store });
    const factOne = buildFact();
    const factTwo = {
      ...buildFact(),
      id: "fact-2",
      content: "Atlas is paused.",
    };
    await runtime.documentStore.set("facts", factOne.id, factOne);
    await runtime.documentStore.set("facts", factTwo.id, factTwo);
    await runtime.appendClaim(claimInput("active", "2026-07-16T10:00:00.000Z"));
    await runtime.appendClaim({
      ...claimInput("paused", "2026-07-16T11:00:00.000Z"),
      sourceMemoryId: "fact-2",
    });
    claimQueries.length = 0;

    const grouped = await runtime.queryClaimsForSourceMemoryGroups(scope, [
      "fact-1",
    ]);

    expect(grouped.map(({ sourceMemoryId }) => sourceMemoryId).sort()).toEqual([
      "fact-1",
      "fact-2",
    ]);
    expect(claimQueries).toEqual(Array.from({ length: 2 }, () => ({
      predicateKey: "project.status",
      scopeKey: recallScopeKey(scope),
      subjectEntityId: grouped[0]!.subjectEntityId,
    })));
  });

  it("searches one indexed claim text field and resolves status by deterministic id", async () => {
    const inner = createInMemoryDocumentStore();
    const searchedFields: string[] = [];
    let projectionQueries = 0;
    const store: DocumentStore = {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      set: (collection, id, document) => inner.set(collection, id, document),
      get: (collection, id) => inner.get(collection, id),
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => {
        if (
          collection === CLAIM_PROJECTIONS_COLLECTION ||
          collection === CLAIM_PROJECTION_STATUS_COLLECTION
        ) {
          projectionQueries += 1;
        }
        return inner.query(collection, filter);
      },
      delete: (collection, id) => inner.delete(collection, id),
      searchText: (collection, input) => {
        searchedFields.push(input.field);
        return inner.searchText!(collection, input);
      },
      writeBatchIfUnchanged: (input) => inner.writeBatchIfUnchanged(input),
    };
    const runtime = createRecallProjectionRuntime({ documentStore: store });
    const fact = buildFact();
    await runtime.documentStore.set("facts", fact.id, fact);
    await runtime.appendClaim(claimInput(
      "completed",
      "2026-07-16T11:00:00.000Z",
    ));
    searchedFields.length = 0;
    projectionQueries = 0;

    const matches = await runtime.searchClaims(
      scope,
      "Atlas completed project status",
      5,
    );

    expect(matches).toEqual([
      expect.objectContaining({ objectText: "completed" }),
    ]);
    expect(searchedFields).toEqual(["searchText", "searchText"]);
    expect(projectionQueries).toBe(0);
  });

  it("backfills indexed text onto legacy claim projections", async () => {
    const store = createInMemoryDocumentStore();
    const fact = buildFact();
    const legacyClaim = {
      id: "legacy-claim",
      schemaVersion: 1,
      ...scope,
      scopeKey: recallScopeKey(scope),
      sourceMemoryId: fact.id,
      subjectEntityId: "legacy-entity-atlas",
      predicateKey: `fact.unstructured.${fact.id}`,
      objectText: "active",
      polarity: "positive",
      modality: "asserted",
      observedAt: fact.updatedAt,
      ingestedAt: fact.updatedAt,
      evidenceIds: [],
      sourceMessageIds: [],
      extractorVersion: "deterministic-fact-v1",
    } as unknown as ClaimProjection;
    const legacyStatus = {
      id: buildClaimProjectionStatusId(scope, fact.id),
      schemaVersion: 1,
      ...scope,
      scopeKey: legacyClaim.scopeKey,
      sourceMemoryId: fact.id,
      state: "unstructured",
      claimIds: [legacyClaim.id],
      extractorVersion: legacyClaim.extractorVersion,
      sourceUpdatedAt: fact.updatedAt,
      updatedAt: fact.updatedAt,
    } as unknown as ClaimProjectionStatus;
    await store.set("facts", fact.id, fact);
    await store.set(CLAIM_PROJECTIONS_COLLECTION, legacyClaim.id, legacyClaim);
    await store.set(
      CLAIM_PROJECTION_STATUS_COLLECTION,
      legacyStatus.id,
      legacyStatus,
    );
    const runtime = createRecallProjectionRuntime({ documentStore: store });

    await runtime.ensureScopeIndexed(scope);

    expect(await runtime.queryClaims(scope)).toEqual([
      expect.objectContaining({
        text: expect.stringContaining("Atlas"),
      }),
    ]);
    expect(
      await store.get(CLAIM_PROJECTIONS_COLLECTION, legacyClaim.id),
    ).toEqual(legacyClaim);
    expect(await store.get<ClaimProjectionStatus>(
      CLAIM_PROJECTION_STATUS_COLLECTION,
      legacyStatus.id,
    )).toMatchObject({
      schemaVersion: 2,
      retiredRevisionIds: [legacyClaim.id],
    });
  });

  it("retries a concurrent claim append instead of silently dropping the newer value", async () => {
    const rawStore = createInMemoryDocumentStore();
    await rawStore.set("facts", "fact-1", buildFact());
    const concurrent = createConcurrentAppendStore(rawStore);
    const oldRuntime = createRecallProjectionRuntime({ documentStore: concurrent.store });
    const newRuntime = createRecallProjectionRuntime({ documentStore: concurrent.store });

    const oldAppend = oldRuntime.appendClaim(
      claimInput("planned", "2026-07-16T10:00:00.000Z"),
    );
    await concurrent.oldAppendStarted;
    const newAppend = newRuntime.appendClaim(
      claimInput("completed", "2026-07-16T11:00:00.000Z"),
    );
    await concurrent.newAppendStarted;
    concurrent.releaseOldAppend();
    await oldAppend;
    concurrent.releaseNewAppend();
    await newAppend;

    expect(await newRuntime.queryClaims(scope)).toEqual([
      expect.objectContaining({ objectText: "completed" }),
    ]);
    expect((await newRuntime.queryClaimHistory(scope)).map(({ objectText }) =>
      objectText
    ).sort()).toEqual(["completed", "planned"]);
  });

  it("backfills old facts with evidence and retires the fallback after structured promotion", async () => {
    const store = createInMemoryDocumentStore();
    const fact = buildFact();
    await store.set("facts", fact.id, fact);
    await store.set("evidence", "evidence-1", {
      ...scope,
      id: "evidence-1",
      kind: "conversation_excerpt",
      excerpt: fact.content,
      source: fact.source,
      sourceMessageIds: ["message-1"],
      linkedMemoryIds: [fact.id],
      linkedArchiveIds: [],
      createdAt: fact.createdAt,
    });
    const runtime = createRecallProjectionRuntime({ documentStore: store, now: () => NOW });

    await runtime.ensureScopeIndexed(scope);
    const fallbackClaims = await runtime.queryClaims(scope);
    expect(fallbackClaims).toEqual([
      expect.objectContaining({
        sourceMemoryId: fact.id,
        predicateKey: `fact.unstructured.${fact.id}`,
        objectText: fact.content,
        evidenceIds: ["evidence-1"],
        sourceMessageIds: ["message-1"],
      }),
    ]);

    await runtime.appendClaim(claimInput("active", fact.updatedAt));

    expect(await runtime.queryClaims(scope)).toEqual([
      expect.objectContaining({ predicateKey: "project.status", objectText: "active" }),
    ]);
    expect(await runtime.queryClaimHistory(scope)).toHaveLength(1);
    expect(await store.get(
      CLAIM_PROJECTIONS_COLLECTION,
      fallbackClaims[0]!.id,
    )).toEqual(fallbackClaims[0]);
    expect(await store.get<ClaimProjectionStatus>(
      CLAIM_PROJECTION_STATUS_COLLECTION,
      buildClaimProjectionStatusId(scope, fact.id),
    )).toMatchObject({
      retiredRevisionIds: [fallbackClaims[0]!.id],
    });
  });

  it("retries same-version fallback promotion when the retired claim changes", async () => {
    const store = createInMemoryDocumentStore();
    const fact = buildFact();
    await store.set("facts", fact.id, fact);
    const bootstrap = createRecallProjectionRuntime({ documentStore: store });
    await bootstrap.ensureScopeIndexed(scope);
    const [fallback] = await bootstrap.queryClaims(scope);
    const concurrent = createConcurrentFallbackPromotionStore(
      store,
      fallback!.id,
    );
    const runtime = createRecallProjectionRuntime({
      documentStore: concurrent.store,
    });

    await runtime.appendClaim(claimInput("active", fact.updatedAt));

    expect(concurrent.promotionAttempts()).toBe(2);
    expect(
      await store.get(CLAIM_PROJECTIONS_COLLECTION, fallback!.id),
    ).not.toBeNull();
    expect(await runtime.queryClaimHistory(scope)).toHaveLength(1);
  });

  it("closes the selected claim when its canonical fact is superseded and erases it on privacy deletion", async () => {
    const store = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({ documentStore: store, now: () => NOW });
    const fact = buildFact();
    await runtime.documentStore.set("facts", fact.id, fact);
    await runtime.appendClaim(claimInput("active", "2026-07-16T11:00:00.000Z"));
    const [openClaim] = await runtime.queryClaims(scope);

    await runtime.documentStore.set("facts", fact.id, {
      ...fact,
      lifecycle: "superseded",
      isActive: false,
      updatedAt: NOW,
    });

    expect(await runtime.queryClaims(scope)).toEqual([
      expect.objectContaining({ objectText: "active", validUntil: NOW }),
    ]);
    expect(await runtime.queryClaimHistory(scope)).toHaveLength(2);
    expect(
      await store.get(CLAIM_PROJECTIONS_COLLECTION, openClaim!.id),
    ).toEqual(openClaim);
    expect(await store.get<ClaimProjectionStatus>(
      CLAIM_PROJECTION_STATUS_COLLECTION,
      buildClaimProjectionStatusId(scope, fact.id),
    )).toMatchObject({
      retiredRevisionIds: expect.arrayContaining([openClaim!.id]),
    });

    await runtime.documentStore.delete("facts", fact.id);
    expect(await store.query<ClaimProjection>(CLAIM_PROJECTIONS_COLLECTION, {})).toEqual([]);
    expect(await store.query<ClaimProjectionStatus>(CLAIM_PROJECTION_STATUS_COLLECTION, {})).toEqual([]);
  });

  it("removes old-scope claims when a canonical fact moves scope", async () => {
    const store = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: store,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });
    const fact = buildFact();
    await runtime.documentStore.set("facts", fact.id, fact);
    await runtime.appendClaim(
      claimInput("active", "2026-07-16T11:00:00.000Z"),
    );
    await runtime.ensureScopeIndexed(scope);
    const nextScope = { ...scope, workspaceId: "workspace-2" };

    await runtime.documentStore.set("facts", fact.id, {
      ...fact,
      workspaceId: nextScope.workspaceId,
      updatedAt: NOW,
    });

    expect(await runtime.queryClaims(scope)).toEqual([]);
    expect(await runtime.queryClaimHistory(scope)).toEqual([]);
    expect(await runtime.queryClaims(nextScope)).toEqual([
      expect.objectContaining({
        objectText: fact.content,
        sourceMemoryId: fact.id,
        workspaceId: nextScope.workspaceId,
      }),
    ]);
    expect(
      await store.get(
        CLAIM_PROJECTION_STATUS_COLLECTION,
        buildClaimProjectionStatusId(scope, fact.id),
      ),
    ).toBeNull();
    expect(
      (await store.query<ClaimProjection>(CLAIM_PROJECTIONS_COLLECTION, {
        sourceMemoryId: fact.id,
      })).every(({ workspaceId }) => workspaceId === nextScope.workspaceId),
    ).toBe(true);
    expect(
      (await store.query<ClaimProjectionStatus>(
        CLAIM_PROJECTION_STATUS_COLLECTION,
        { sourceMemoryId: fact.id },
      )).every(({ workspaceId }) => workspaceId === nextScope.workspaceId),
    ).toBe(true);
  });

  it("removes old-scope claims after a conditional scope move", async () => {
    const store = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: store,
      now: () => NOW,
    });
    const fact = buildFact();
    await runtime.documentStore.set("facts", fact.id, fact);
    await runtime.appendClaim(
      claimInput("active", "2026-07-16T11:00:00.000Z"),
    );
    const nextScope = { ...scope, workspaceId: "workspace-2" };
    const moved = {
      ...fact,
      workspaceId: nextScope.workspaceId,
      updatedAt: NOW,
    };

    expect(await runtime.documentStore.writeBatchIfUnchanged({
      expected: { collection: "facts", document: fact, id: fact.id },
      set: [{ collection: "facts", document: moved, id: fact.id }],
    })).toBe(true);

    expect(await runtime.queryClaims(scope)).toEqual([]);
    expect(await runtime.queryClaims(nextScope)).toEqual([
      expect.objectContaining({
        sourceMemoryId: fact.id,
        workspaceId: nextScope.workspaceId,
      }),
    ]);
  });

  it("rejects a conditional scope move when its source snapshot changed", async () => {
    const rawStore = createInMemoryDocumentStore();
    const writer = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
    });
    const fact = buildFact();
    await writer.documentStore.set("facts", fact.id, fact);
    await writer.appendClaim(
      claimInput("active", "2026-07-16T11:00:00.000Z"),
    );
    const gate = { id: "gate-1", value: "open" };
    await rawStore.set("gates", gate.id, gate);
    let releaseSourceRead = () => {};
    let signalSourceRead = () => {};
    const sourceRead = new Promise<void>((resolve) => {
      signalSourceRead = resolve;
    });
    const sourceRelease = new Promise<void>((resolve) => {
      releaseSourceRead = resolve;
    });
    let pauseSourceRead = true;
    const delayedStore: DocumentStore = {
      projectionBatchSemantics: rawStore.projectionBatchSemantics,
      set: (collection, id, document) => rawStore.set(collection, id, document),
      async get<TDocument extends StorageDocument>(collection: string, id: string) {
        const document = await rawStore.get<TDocument>(collection, id);
        if (pauseSourceRead && collection === "facts" && id === fact.id) {
          pauseSourceRead = false;
          signalSourceRead();
          await sourceRelease;
        }
        return document;
      },
      update: (collection, id, patch) => rawStore.update(collection, id, patch),
      query: (collection, filter) => rawStore.query(collection, filter),
      delete: (collection, id) => rawStore.delete(collection, id),
      writeBatchIfUnchanged: (input) => rawStore.writeBatchIfUnchanged(input),
    };
    const conditionalRuntime = createRecallProjectionRuntime({
      documentStore: delayedStore,
      now: () => NOW,
    });
    const workspaceTwo = { ...fact, workspaceId: "workspace-2", updatedAt: NOW };
    const workspaceThree = { ...fact, workspaceId: "workspace-3", updatedAt: NOW };

    const conditional = conditionalRuntime.documentStore.writeBatchIfUnchanged({
      expected: { collection: "gates", document: gate, id: gate.id },
      set: [{ collection: "facts", document: workspaceThree, id: fact.id }],
    });
    await sourceRead;
    await writer.documentStore.set("facts", fact.id, workspaceTwo);
    releaseSourceRead();

    expect(await conditional).toBe(false);
    expect(await writer.queryClaims(scope)).toEqual([]);
    expect(await writer.queryClaims({ ...scope, workspaceId: "workspace-2" }))
      .not.toEqual([]);
    expect(await writer.queryClaims({ ...scope, workspaceId: "workspace-3" }))
      .toEqual([]);
  });

  it("retries a proof-off set from the actual predecessor scope", async () => {
    const rawStore = createInMemoryDocumentStore();
    const writer = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
    });
    const fact = buildFact();
    await writer.documentStore.set("facts", fact.id, fact);
    await writer.appendClaim(
      claimInput("active", "2026-07-16T11:00:00.000Z"),
    );
    let releaseWorkspaceThree = () => {};
    let signalWorkspaceThree = () => {};
    const workspaceThreeStarted = new Promise<void>((resolve) => {
      signalWorkspaceThree = resolve;
    });
    const workspaceThreeRelease = new Promise<void>((resolve) => {
      releaseWorkspaceThree = resolve;
    });
    let pauseWorkspaceThree = true;
    const shouldPause = (document: StorageDocument) =>
      "id" in document &&
      "workspaceId" in document &&
      document.id === fact.id &&
      document.workspaceId === "workspace-3";
    const delayedStore: DocumentStore = {
      projectionBatchSemantics: rawStore.projectionBatchSemantics,
      async set(collection, id, document) {
        if (
          pauseWorkspaceThree &&
          collection === "facts" &&
          shouldPause(document)
        ) {
          pauseWorkspaceThree = false;
          signalWorkspaceThree();
          await workspaceThreeRelease;
        }
        await rawStore.set(collection, id, document);
      },
      get: (collection, id) => rawStore.get(collection, id),
      update: (collection, id, patch) => rawStore.update(collection, id, patch),
      query: (collection, filter) => rawStore.query(collection, filter),
      delete: (collection, id) => rawStore.delete(collection, id),
      async writeBatchIfUnchanged(input) {
        if (
          pauseWorkspaceThree &&
          input.set.some(({ collection, document }) =>
            collection === "facts" && shouldPause(document)
          )
        ) {
          pauseWorkspaceThree = false;
          signalWorkspaceThree();
          await workspaceThreeRelease;
        }
        return rawStore.writeBatchIfUnchanged(input);
      },
    };
    const delayedRuntime = createRecallProjectionRuntime({
      documentStore: delayedStore,
      now: () => NOW,
    });
    const workspaceTwo = { ...fact, workspaceId: "workspace-2", updatedAt: NOW };
    const workspaceThree = { ...fact, workspaceId: "workspace-3", updatedAt: NOW };

    const finalWrite = delayedRuntime.documentStore.set(
      "facts",
      fact.id,
      workspaceThree,
    );
    await workspaceThreeStarted;
    await writer.documentStore.set("facts", fact.id, workspaceTwo);
    releaseWorkspaceThree();
    await finalWrite;

    expect(await writer.queryClaims(scope)).toEqual([]);
    expect(await writer.queryClaims({ ...scope, workspaceId: "workspace-2" }))
      .toEqual([]);
    expect(await writer.queryClaims({ ...scope, workspaceId: "workspace-3" }))
      .not.toEqual([]);
  });

  it("queues a failed append and replays the exact structured input through repair", async () => {
    const rawStore = createInMemoryDocumentStore();
    const fact = buildFact();
    await rawStore.set("facts", fact.id, fact);
    const runtime = createRecallProjectionRuntime({
      documentStore: createOneShotClaimFailureStore(rawStore),
      now: () => NOW,
    });

    await runtime.appendClaim(claimInput("active", "2026-07-16T11:00:00.000Z"));
    expect(await rawStore.query(PROJECTION_REPAIRS_COLLECTION, {})).toHaveLength(1);
    expect(await runtime.queryClaims(scope)).toEqual([]);

    expect(await runtime.repairPending(scope)).toBe(1);
    expect(await runtime.queryClaims(scope)).toEqual([
      expect.objectContaining({ predicateKey: "project.status", objectText: "active" }),
    ]);
    expect(await rawStore.query(PROJECTION_REPAIRS_COLLECTION, {})).toEqual([]);
  });

  it("retires the fallback when a same-version structured promotion repairs", async () => {
    const rawStore = createInMemoryDocumentStore();
    const fact = buildFact();
    await rawStore.set("facts", fact.id, fact);
    const bootstrap = createRecallProjectionRuntime({ documentStore: rawStore });
    await bootstrap.ensureScopeIndexed(scope);
    const [fallback] = await bootstrap.queryClaims(scope);
    const runtime = createRecallProjectionRuntime({
      documentStore: createOneShotClaimFailureStore(rawStore),
      now: () => NOW,
    });

    await runtime.appendClaim(claimInput("active", fact.updatedAt));
    expect(await runtime.repairPending(scope)).toBe(1);

    expect(
      await rawStore.get(CLAIM_PROJECTIONS_COLLECTION, fallback!.id),
    ).not.toBeNull();
    expect(await runtime.queryClaimHistory(scope)).toEqual([
      expect.objectContaining({
        objectText: "active",
        predicateKey: "project.status",
      }),
    ]);
  });

  it("resolves an obsolete failed claim before consuming its repair", async () => {
    const rawStore = createInMemoryDocumentStore();
    const fact = buildFact();
    await rawStore.set("facts", fact.id, fact);
    const runtime = createRecallProjectionRuntime({
      documentStore: createOneShotClaimFailureStore(rawStore),
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });

    await runtime.appendClaim(
      claimInput("active", "2026-07-16T11:00:00.000Z"),
    );
    expect(
      await rawStore.get<ClaimProjectionStatus>(
        CLAIM_PROJECTION_STATUS_COLLECTION,
        buildClaimProjectionStatusId(scope, fact.id),
      ),
    ).toMatchObject({ state: "failed" });

    await runtime.documentStore.set("facts", fact.id, {
      ...fact,
      lifecycle: "superseded",
      isActive: false,
      updatedAt: NOW,
    });

    expect(await runtime.repairPending(scope)).toBe(1);
    expect(await rawStore.query(PROJECTION_REPAIRS_COLLECTION, {})).toEqual([]);
    expect(
      await rawStore.get<ClaimProjectionStatus>(
        CLAIM_PROJECTION_STATUS_COLLECTION,
        buildClaimProjectionStatusId(scope, fact.id),
      ),
    ).toBeNull();
    expect(await runtime.ensureScopeIndexed(scope)).toMatchObject({
      complete: true,
      skipped: false,
    });
    expect(await runtime.ensureScopeIndexed(scope)).toEqual({
      complete: true,
      indexedSources: 0,
      skipped: true,
    });
  });

  it("does not let an older repair replace a newer selected claim", async () => {
    const rawStore = createInMemoryDocumentStore();
    const fact = buildFact();
    await rawStore.set("facts", fact.id, fact);
    const runtime = createRecallProjectionRuntime({
      documentStore: createOneShotClaimFailureStore(rawStore),
      now: () => NOW,
    });

    await runtime.appendClaim(claimInput("planned", "2026-07-16T10:00:00.000Z"));
    await runtime.appendClaim(claimInput("completed", "2026-07-16T11:00:00.000Z"));
    expect(await runtime.queryClaims(scope)).toEqual([
      expect.objectContaining({ objectText: "completed" }),
    ]);

    expect(await runtime.repairPending(scope)).toBe(1);
    expect(await runtime.queryClaims(scope)).toEqual([
      expect.objectContaining({ objectText: "completed" }),
    ]);
  });

  it("does not delete a newer repair written under the same deterministic ID", async () => {
    const rawStore = createInMemoryDocumentStore();
    await rawStore.set("facts", "fact-1", buildFact());
    const blocked = createBlockedRepairStore(rawStore);
    const runtime = createRecallProjectionRuntime({ documentStore: blocked.store });

    await runtime.appendClaim(
      claimInput("planned", "2026-07-16T10:00:00.000Z"),
    );
    const repairRun = runtime.repairPending(scope);
    await blocked.repairStarted;
    const [oldRepair] = await rawStore.query<ProjectionRepairRecord>(
      PROJECTION_REPAIRS_COLLECTION,
      {},
    );
    const nextInput = claimInput("completed", "2026-07-16T11:00:00.000Z");
    await rawStore.set(PROJECTION_REPAIRS_COLLECTION, oldRepair!.id, {
      ...oldRepair!,
      claimInput: nextInput,
      lastError: "new repair",
      lastFailedAt: "2026-07-16T11:00:00.000Z",
    });
    blocked.releaseRepair();

    expect(await repairRun).toBe(0);
    expect(await rawStore.get<ProjectionRepairRecord>(
      PROJECTION_REPAIRS_COLLECTION,
      oldRepair!.id,
    )).toMatchObject({ lastError: "new repair", claimInput: nextInput });
    expect(await runtime.repairPending(scope)).toBe(1);
    expect(await runtime.queryClaims(scope)).toEqual([
      expect.objectContaining({ objectText: "completed" }),
    ]);
  });

  it("discards a pending claim repair after its canonical fact is deleted", async () => {
    const rawStore = createInMemoryDocumentStore();
    const fact = buildFact();
    await rawStore.set("facts", fact.id, fact);
    const runtime = createRecallProjectionRuntime({
      documentStore: createOneShotClaimFailureStore(rawStore),
      now: () => NOW,
    });

    await runtime.appendClaim(claimInput("active", "2026-07-16T11:00:00.000Z"));
    expect(await rawStore.query(PROJECTION_REPAIRS_COLLECTION, {})).toHaveLength(1);

    await runtime.documentStore.delete("facts", fact.id);
    expect(await rawStore.query(PROJECTION_REPAIRS_COLLECTION, {})).toEqual([]);
    expect(await runtime.repairPending(scope)).toBe(0);
    expect(await runtime.queryClaims(scope)).toEqual([]);
  });

  it("serializes claim repair with canonical deletion so a fact cannot be revived", async () => {
    const rawStore = createInMemoryDocumentStore();
    const fact = buildFact();
    await rawStore.set("facts", fact.id, fact);
    const blocked = createBlockedRepairStore(rawStore);
    const runtime = createRecallProjectionRuntime({
      documentStore: blocked.store,
      now: () => NOW,
    });

    await runtime.appendClaim(
      claimInput("sensitive-object-text", "2026-07-16T11:00:00.000Z"),
    );
    const repair = runtime.repairPending(scope);
    await blocked.repairStarted;
    const deletion = runtime.documentStore.delete("facts", fact.id);
    blocked.releaseRepair();
    await Promise.all([repair, deletion]);

    expect(await rawStore.get("facts", fact.id)).toBeNull();
    expect(await rawStore.query(CLAIM_PROJECTIONS_COLLECTION, {
      sourceMemoryId: fact.id,
    })).toEqual([]);
    expect(await rawStore.query(PROJECTION_REPAIRS_COLLECTION, {})).toEqual([]);
  });

  it("does not let a repair in one runtime revive a fact deleted by another runtime", async () => {
    const rawStore = createInMemoryDocumentStore();
    const fact = buildFact();
    await rawStore.set("facts", fact.id, fact);
    const blocked = createBlockedRepairStore(rawStore);
    const repairRuntime = createRecallProjectionRuntime({
      documentStore: blocked.store,
      now: () => NOW,
    });
    const deleteRuntime = createRecallProjectionRuntime({
      documentStore: blocked.store,
      now: () => NOW,
    });

    await repairRuntime.appendClaim(
      claimInput("sensitive-object-text", "2026-07-16T11:00:00.000Z"),
    );
    const repair = repairRuntime.repairPending(scope);
    await blocked.repairStarted;
    await deleteRuntime.documentStore.delete("facts", fact.id);
    blocked.releaseRepair();
    await repair;

    expect(await rawStore.get("facts", fact.id)).toBeNull();
    expect(await rawStore.query(CLAIM_PROJECTIONS_COLLECTION, {
      sourceMemoryId: fact.id,
    })).toEqual([]);
    expect(await rawStore.query(PROJECTION_REPAIRS_COLLECTION, {})).toEqual([]);
  });

  it("does not let an older repair overwrite a newer status across runtimes", async () => {
    const rawStore = createInMemoryDocumentStore();
    await rawStore.set("facts", "fact-1", buildFact());
    const interleaved = createInterleavedRepairStore(rawStore);
    const oldRuntime = createRecallProjectionRuntime({
      documentStore: interleaved.store,
      now: () => NOW,
    });
    const newRuntime = createRecallProjectionRuntime({
      documentStore: interleaved.store,
      now: () => NOW,
    });
    await oldRuntime.appendClaim(
      claimInput("planned", "2026-07-16T10:00:00.000Z"),
    );
    const oldRepair = oldRuntime.repairPending(scope);
    await interleaved.oldRepairStarted;
    await newRuntime.appendClaim(
      claimInput("completed", "2026-07-16T11:00:00.000Z"),
    );
    interleaved.releaseOldRepair();
    await oldRepair;

    expect(await newRuntime.queryClaims(scope)).toEqual([
      expect.objectContaining({ objectText: "completed" }),
    ]);
  });

  it("does not queue sensitive repair state after a concurrent canonical delete", async () => {
    const rawStore = createInMemoryDocumentStore();
    await rawStore.set("facts", "fact-1", buildFact());
    const delayed = createDelayedFailingAppendStore(rawStore);
    const appendRuntime = createRecallProjectionRuntime({
      documentStore: delayed.store,
      now: () => NOW,
    });
    const deleteRuntime = createRecallProjectionRuntime({
      documentStore: delayed.store,
      now: () => NOW,
    });
    const append = appendRuntime.appendClaim(
      claimInput("sensitive-object-text", "2026-07-16T11:00:00.000Z"),
    );
    await delayed.appendStarted;
    await deleteRuntime.documentStore.delete("facts", "fact-1");
    delayed.releaseAppend();
    await append;

    expect(await rawStore.query(CLAIM_PROJECTION_STATUS_COLLECTION, {})).toEqual([]);
    expect(await rawStore.query(PROJECTION_REPAIRS_COLLECTION, {})).toEqual([]);
  });

  it("atomically removes a repair inserted while another runtime forgets", async () => {
    const rawStore = createInMemoryDocumentStore();
    await rawStore.set("facts", "fact-1", buildFact());
    const raced = createDeleteRepairRaceStore(rawStore);
    const deleteRuntime = createRecallProjectionRuntime({
      documentStore: raced.store,
      now: () => NOW,
    });
    const appendRuntime = createRecallProjectionRuntime({
      documentStore: raced.store,
      now: () => NOW,
    });

    const deletion = deleteRuntime.documentStore.delete("facts", "fact-1");
    await raced.deletionStarted;
    await appendRuntime.appendClaim(
      claimInput("sensitive-object-text", "2026-07-16T11:00:00.000Z"),
    );
    expect(JSON.stringify(await rawStore.query(PROJECTION_REPAIRS_COLLECTION)))
      .toContain("sensitive-object-text");
    raced.releaseDeletion();
    await deletion;

    expect(await rawStore.get("facts", "fact-1")).toBeNull();
    expect(await rawStore.query(PROJECTION_REPAIRS_COLLECTION)).toEqual([]);
  });

  it("does not let a stale lifecycle sync overwrite a newer CAS status", async () => {
    const rawStore = createInMemoryDocumentStore();
    const fact = buildFact();
    await rawStore.set("facts", fact.id, fact);
    const blocked = createBlockedLifecycleStore(rawStore);
    const oldRuntime = createRecallProjectionRuntime({
      documentStore: blocked.store,
      now: () => NOW,
    });
    const newRuntime = createRecallProjectionRuntime({
      documentStore: blocked.store,
      now: () => NOW,
    });
    await oldRuntime.appendClaim(
      claimInput("planned", "2026-07-16T10:00:00.000Z"),
    );
    const staleSync = oldRuntime.documentStore.set("facts", fact.id, {
      ...fact,
      lifecycle: "superseded",
      isActive: false,
      updatedAt: "2026-07-16T10:30:00.000Z",
    });
    await blocked.lifecycleStarted;
    await newRuntime.documentStore.set("facts", fact.id, {
      ...fact,
      updatedAt: "2026-07-16T11:00:00.000Z",
    });
    await newRuntime.appendClaim(
      claimInput("completed", "2026-07-16T11:00:00.000Z"),
    );
    blocked.releaseLifecycle();
    await staleSync;

    expect(await newRuntime.queryClaims(scope)).toEqual([
      expect.objectContaining({ objectText: "completed" }),
    ]);
  });

  it("does not retain an unpersisted volatile repair after deletion and ID reuse", async () => {
    const rawStore = createInMemoryDocumentStore();
    await rawStore.set("facts", "fact-1", buildFact());
    let failClaim = true;
    const store: DocumentStore = {
      projectionBatchSemantics: rawStore.projectionBatchSemantics,
      set: async (collection, id, document) => {
        if (collection === PROJECTION_REPAIRS_COLLECTION) {
          throw new Error("repair persistence unavailable");
        }
        await rawStore.set(collection, id, document);
      },
      get: (collection, id) => rawStore.get(collection, id),
      update: (collection, id, patch) => rawStore.update(collection, id, patch),
      query: (collection, filter) => rawStore.query(collection, filter),
      delete: (collection, id) => rawStore.delete(collection, id),
      queryPage: rawStore.queryPage,
      writeBatchIfUnchanged: async (input) => {
        if (input.set.some(({ collection }) =>
          collection === PROJECTION_REPAIRS_COLLECTION
        )) {
          throw new Error("repair persistence unavailable");
        }
        if (
          failClaim &&
          input.set.some(({ collection }) =>
            collection === CLAIM_PROJECTIONS_COLLECTION
          )
        ) {
          failClaim = false;
          throw new Error("claim persistence unavailable");
        }
        return rawStore.writeBatchIfUnchanged!(input);
      },
    };
    const runtime = createRecallProjectionRuntime({ documentStore: store, now: () => NOW });

    await expect(runtime.appendClaim(
      claimInput("sensitive-object-text", "2026-07-16T11:00:00.000Z"),
    )).rejects.toThrow("repair persistence unavailable");
    await rawStore.delete("facts", "fact-1");
    await rawStore.set("facts", "fact-1", buildFact());

    expect(await runtime.repairPending(scope)).toBe(0);
    expect(await runtime.queryClaims(scope)).toEqual([]);
  });

  it("rejects a document adapter without atomic conditional batches", () => {
    const inner = createInMemoryDocumentStore();
    const unsupported = {
      delete: inner.delete,
      get: inner.get,
      query: inner.query,
      set: inner.set,
      update: inner.update,
    } as unknown as DocumentStore;

    expect(() => createRecallProjectionRuntime({ documentStore: unsupported }))
      .toThrow("atomic conditional batches");
  });

  it("does not infer current projection semantics from an old same-named method", () => {
    const inner = createInMemoryDocumentStore();
    const oldAdapter: DocumentStore = {
      delete: inner.delete,
      get: inner.get,
      query: inner.query,
      set: inner.set,
      update: inner.update,
      writeBatchIfUnchanged: async () => true,
    };

    expect(() => createRecallProjectionRuntime({ documentStore: oldAdapter }))
      .toThrow("atomic conditional batches");
  });
});
