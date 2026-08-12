import { describe, expect, it } from "bun:test";

import { createFactMemory } from "../../src/domain/records";
import { createLanguageService } from "../../src/language";
import { buildClaimProjectionStatusId } from "../../src/recall/projections/claims";
import {
  CLAIM_PROJECTIONS_COLLECTION,
  CLAIM_PROJECTION_STATUS_COLLECTION,
  RECALL_PROJECTION_PIPELINE_VERSION,
} from "../../src/recall/projections/contracts";
import { createRecallProjectionOperations } from "../../src/recall/projections/operations";
import type {
  AppendClaimProjectionInput,
  ClaimProjection,
  ClaimProjectionStatus,
} from "../../src/recall/projections/contracts";
import { createRecallProjectionRuntime } from "../../src/recall/projections/runtime";
import { recallScopeKey } from "../../src/recall/projections/shared";
import type {
  DocumentQueryPageInput,
  DocumentTextSearchInput,
  ProjectionCapableDocumentStore,
  StorageDocument,
} from "../../src/storage/contracts";
import { createInMemoryDocumentStore } from "../../src/storage/memory";

const scope = {
  userId: "claim-revision-user",
  tenantId: "claim-revision-tenant",
  workspaceId: "claim-revision-workspace",
  sessionId: "claim-revision-session",
};
const observedAt = "2026-07-21T09:00:00.000Z";

function buildFact(id = "fact-claim-revision") {
  return createFactMemory({
    ...scope,
    id,
    category: "project",
    content: "Atlas is active.",
    subject: "Atlas",
    source: {
      method: "explicit",
      extractedAt: observedAt,
    },
    createdAt: observedAt,
    updatedAt: observedAt,
  });
}

function claimInput(
  objectText: string,
  ingestedAt: string,
): AppendClaimProjectionInput {
  return {
    ...scope,
    sourceMemoryId: "fact-claim-revision",
    subject: "Atlas",
    claim: {
      predicateKey: "project.status",
      objectText,
    },
    observedAt: ingestedAt,
    ingestedAt,
    evidenceIds: [],
    sourceMessageIds: [],
    extractorVersion: "claim-revision-test-v1",
  };
}

function buildStoredClaim(id: string): ClaimProjection {
  return {
    id,
    schemaVersion: 2,
    ...scope,
    scopeKey: recallScopeKey(scope),
    sourceMemoryId: "fact-search-refill",
    subjectText: "Atlas",
    subjectEntityId: "entity:atlas",
    predicateKey: "project.status",
    objectText: "active",
    text: "Atlas project.status active",
    searchText: "atlas project status active",
    searchLocale: "en-US",
    languagePackId: "en",
    searchAnalyzerVersion: "claim-revision-test-v1",
    searchSchemaVersion: "gm-search-v3",
    polarity: "positive",
    modality: "asserted",
    observedAt,
    ingestedAt: observedAt,
    evidenceIds: [],
    sourceMessageIds: [],
    extractorVersion: "claim-revision-test-v1",
  };
}

function buildStoredStatus(
  sourceMemoryId: string,
  claimIds: string[],
  retiredRevisionIds: string[] = [],
): ClaimProjectionStatus {
  return {
    id: buildClaimProjectionStatusId(scope, sourceMemoryId),
    schemaVersion: 2,
    ...scope,
    scopeKey: recallScopeKey(scope),
    sourceMemoryId,
    state: "projected",
    claimIds,
    retiredRevisionIds,
    extractorVersion: "claim-revision-test-v1",
    sourceUpdatedAt: observedAt,
    updatedAt: observedAt,
  };
}

function createRevisionRaceStore(): {
  newClaim: ClaimProjection;
  oldClaim: ClaimProjection;
  store: ProjectionCapableDocumentStore;
} {
  const inner = createInMemoryDocumentStore();
  const oldClaim = {
    ...buildStoredClaim("claim-race-old"),
    sourceMemoryId: "fact-race",
  };
  const newClaim: ClaimProjection = {
    ...oldClaim,
    id: "claim-race-new",
    objectText: "completed",
    text: "Atlas project.status completed",
    searchText: "atlas project status completed",
    observedAt: "2026-07-21T10:00:00.000Z",
    ingestedAt: "2026-07-21T10:00:00.000Z",
  };
  const oldStatus: ClaimProjectionStatus = {
    id: buildClaimProjectionStatusId(scope, oldClaim.sourceMemoryId),
    schemaVersion: 2,
    ...scope,
    scopeKey: recallScopeKey(scope),
    sourceMemoryId: oldClaim.sourceMemoryId,
    state: "projected",
    claimIds: [oldClaim.id],
    retiredRevisionIds: [],
    extractorVersion: oldClaim.extractorVersion,
    sourceUpdatedAt: oldClaim.ingestedAt,
    updatedAt: oldClaim.ingestedAt,
  };
  const newStatus: ClaimProjectionStatus = {
    ...oldStatus,
    claimIds: [newClaim.id],
    retiredRevisionIds: [oldClaim.id],
    sourceUpdatedAt: newClaim.ingestedAt,
    updatedAt: newClaim.ingestedAt,
  };
  let status = oldStatus;
  let history = [oldClaim];
  let shouldRace = true;
  const store: ProjectionCapableDocumentStore = {
    projectionBatchSemantics: inner.projectionBatchSemantics,
    set: (collection, id, document) => inner.set(collection, id, document),
    async get<TDocument extends StorageDocument>(collection: string, id: string) {
      if (collection === CLAIM_PROJECTION_STATUS_COLLECTION) {
        return (id === status.id ? status : null) as TDocument | null;
      }
      if (collection === CLAIM_PROJECTIONS_COLLECTION) {
        return (history.find((claim) => claim.id === id) ?? null) as
          | TDocument
          | null;
      }
      return inner.get<TDocument>(collection, id);
    },
    update: (collection, id, patch) => inner.update(collection, id, patch),
    async query<TDocument extends StorageDocument>(
      collection: string,
      filter?: Record<string, boolean | number | string | null>,
    ) {
      if (collection === CLAIM_PROJECTION_STATUS_COLLECTION) {
        await Promise.resolve();
        return [status] as unknown as TDocument[];
      }
      if (collection === CLAIM_PROJECTIONS_COLLECTION) {
        const snapshot = [...history];
        if (shouldRace) {
          shouldRace = false;
          history = [oldClaim, newClaim];
          status = newStatus;
        }
        return snapshot as unknown as TDocument[];
      }
      return inner.query<TDocument>(collection, filter);
    },
    delete: (collection, id) => inner.delete(collection, id),
    writeBatchIfUnchanged: (input) => inner.writeBatchIfUnchanged(input),
  };
  return { newClaim, oldClaim, store };
}

describe("claim projection revision visibility", () => {
  it("uses the v5 projection pipeline to migrate revision metadata", () => {
    expect(RECALL_PROJECTION_PIPELINE_VERSION).toBe("gm-projection-v5");
  });

  it("keeps a promoted fallback physically while retiring it from logical history", async () => {
    const store = createInMemoryDocumentStore();
    const fact = buildFact();
    await store.set("facts", fact.id, fact);
    const runtime = createRecallProjectionRuntime({ documentStore: store });

    await runtime.ensureScopeIndexed(scope);
    const [fallback] = await runtime.queryClaims(scope);
    await runtime.appendClaim(claimInput("active", fact.updatedAt));

    const physical = await store.query<ClaimProjection>(
      CLAIM_PROJECTIONS_COLLECTION,
      { sourceMemoryId: fact.id },
    );
    const status = await store.get<ClaimProjectionStatus>(
      CLAIM_PROJECTION_STATUS_COLLECTION,
      buildClaimProjectionStatusId(scope, fact.id),
    );

    expect(physical.map(({ id }) => id)).toContain(fallback!.id);
    expect(physical).toHaveLength(2);
    expect(status?.retiredRevisionIds).toContain(fallback!.id);
    expect((await runtime.queryClaimHistory(scope)).map(({ predicateKey }) =>
      predicateKey
    )).toEqual(["project.status"]);
  });

  it("does not retire ordinary semantic history when the source advances", async () => {
    const store = createInMemoryDocumentStore();
    const fact = buildFact();
    await store.set("facts", fact.id, fact);
    const runtime = createRecallProjectionRuntime({ documentStore: store });

    await runtime.appendClaim(
      claimInput("planned", "2026-07-21T10:00:00.000Z"),
    );
    await runtime.appendClaim(
      claimInput("completed", "2026-07-21T11:00:00.000Z"),
    );

    const status = await store.get<ClaimProjectionStatus>(
      CLAIM_PROJECTION_STATUS_COLLECTION,
      buildClaimProjectionStatusId(scope, fact.id),
    );
    expect(status?.retiredRevisionIds).toEqual([]);
    expect((await runtime.queryClaimHistory(scope)).map(({ objectText }) =>
      objectText
    ).sort()).toEqual(["completed", "planned"]);
  });

  it("reads current claims from one immutable status head during a revision race", async () => {
    const { oldClaim, store } = createRevisionRaceStore();
    const runtime = createRecallProjectionRuntime({ documentStore: store });

    expect(await runtime.queryClaims(scope)).toEqual([oldClaim]);
  });

  it("retries logical history when a revision commits between status and claim reads", async () => {
    const { newClaim, store } = createRevisionRaceStore();
    const runtime = createRecallProjectionRuntime({ documentStore: store });

    expect(await runtime.queryClaimHistory(scope)).toEqual([newClaim]);
  });

  it("retries indexed search when its result predates the loaded status head", async () => {
    const { newClaim, oldClaim, store: revisionStore } =
      createRevisionRaceStore();
    let searchCalls = 0;
    const store: ProjectionCapableDocumentStore = {
      ...revisionStore,
      async searchText<TDocument extends StorageDocument>() {
        searchCalls += 1;
        return (searchCalls === 1 ? [oldClaim] : [oldClaim, newClaim]).map(
          (document) => ({
            document: document as unknown as TDocument,
            id: document.id,
            score: 1,
          }),
        );
      },
    };
    await revisionStore.query(CLAIM_PROJECTIONS_COLLECTION);
    const runtime = createRecallProjectionRuntime({ documentStore: store });

    expect(
      await runtime.searchClaims(scope, "atlas project status", 5),
    ).toEqual([newClaim]);
    expect(searchCalls).toBe(2);
  });

  it("retries a partially visible indexed page after one source advances", async () => {
    const inner = createInMemoryDocumentStore();
    const oldA = {
      ...buildStoredClaim("claim-a-old"),
      sourceMemoryId: "fact-a",
    };
    const newA = {
      ...oldA,
      id: "claim-a-new",
      objectText: "completed",
      text: "Atlas project.status completed",
      searchText: "atlas project status completed",
    };
    const stableB = {
      ...buildStoredClaim("claim-b-stable"),
      sourceMemoryId: "fact-b",
    };
    const statuses = new Map([
      [
        "fact-a",
        buildStoredStatus("fact-a", [newA.id], [oldA.id]),
      ],
      ["fact-b", buildStoredStatus("fact-b", [stableB.id])],
    ]);
    let searchCalls = 0;
    const store: ProjectionCapableDocumentStore = {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      set: (collection, id, document) => inner.set(collection, id, document),
      async get<TDocument extends StorageDocument>(collection: string, id: string) {
        if (collection === CLAIM_PROJECTION_STATUS_COLLECTION) {
          const sourceMemoryId = [...statuses.keys()].find((source) =>
            buildClaimProjectionStatusId(scope, source) === id
          );
          return (sourceMemoryId ? statuses.get(sourceMemoryId) ?? null : null) as
            | TDocument
            | null;
        }
        return inner.get<TDocument>(collection, id);
      },
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => inner.query(collection, filter),
      delete: (collection, id) => inner.delete(collection, id),
      writeBatchIfUnchanged: (input) => inner.writeBatchIfUnchanged(input),
      async searchText<TDocument extends StorageDocument>() {
        searchCalls += 1;
        const documents = searchCalls === 1
          ? [oldA, stableB]
          : [oldA, newA, stableB];
        return documents.map((document, index) => ({
          document: document as unknown as TDocument,
          id: document.id,
          score: documents.length - index,
        }));
      },
    };
    const runtime = createRecallProjectionRuntime({ documentStore: store });

    expect(
      (await runtime.searchClaims(scope, "atlas project status", 5)).map(
        ({ id }) => id,
      ),
    ).toEqual([newA.id, stableB.id]);
    expect(searchCalls).toBe(2);
  });

  it("replaces an earlier search window when a revision advances during refill", async () => {
    const inner = createInMemoryDocumentStore();
    const oldA = {
      ...buildStoredClaim("claim-a-old"),
      sourceMemoryId: "fact-a",
    };
    const newA = {
      ...oldA,
      id: "claim-a-new",
      objectText: "completed",
      text: "Atlas project.status completed",
      searchText: "atlas project status completed",
    };
    const retiredX = {
      ...buildStoredClaim("claim-x-retired"),
      sourceMemoryId: "fact-x",
    };
    const stableB = {
      ...buildStoredClaim("claim-b-stable"),
      sourceMemoryId: "fact-b",
    };
    const statuses = new Map([
      ["fact-a", buildStoredStatus("fact-a", [oldA.id])],
      [
        "fact-x",
        buildStoredStatus("fact-x", [], [retiredX.id]),
      ],
      ["fact-b", buildStoredStatus("fact-b", [stableB.id])],
    ]);
    let searchCalls = 0;
    const store: ProjectionCapableDocumentStore = {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      set: (collection, id, document) => inner.set(collection, id, document),
      async get<TDocument extends StorageDocument>(collection: string, id: string) {
        if (collection === CLAIM_PROJECTION_STATUS_COLLECTION) {
          const sourceMemoryId = [...statuses.keys()].find((source) =>
            buildClaimProjectionStatusId(scope, source) === id
          );
          return (sourceMemoryId ? statuses.get(sourceMemoryId) ?? null : null) as
            | TDocument
            | null;
        }
        return inner.get<TDocument>(collection, id);
      },
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => inner.query(collection, filter),
      delete: (collection, id) => inner.delete(collection, id),
      writeBatchIfUnchanged: (input) => inner.writeBatchIfUnchanged(input),
      async searchText<TDocument extends StorageDocument>() {
        searchCalls += 1;
        if (searchCalls === 1) {
          return [oldA, retiredX].map((document, index) => ({
            document: document as unknown as TDocument,
            id: document.id,
            score: 10 - index,
          }));
        }
        statuses.set(
          "fact-a",
          buildStoredStatus("fact-a", [newA.id], [oldA.id]),
        );
        return [oldA, newA, stableB].map((document, index) => ({
          document: document as unknown as TDocument,
          id: document.id,
          score: 10 - index,
        }));
      },
    };
    const runtime = createRecallProjectionRuntime({ documentStore: store });

    expect(
      (await runtime.searchClaims(scope, "atlas project status", 2)).map(
        ({ id }) => id,
      ),
    ).toEqual([newA.id, stableB.id]);
    expect(searchCalls).toBe(2);
  });

  it("rejects and never selects claim heads bound to another source", async () => {
    const store = createInMemoryDocumentStore();
    const factA = buildFact("fact-source-a");
    const factB = buildFact("fact-source-b");
    const claimA = {
      ...buildStoredClaim("claim-source-a"),
      sourceMemoryId: factA.id,
    };
    const claimB = {
      ...buildStoredClaim("claim-source-b"),
      sourceMemoryId: factB.id,
    };
    const statusA: ClaimProjectionStatus = {
      id: buildClaimProjectionStatusId(scope, factA.id),
      schemaVersion: 2,
      ...scope,
      scopeKey: recallScopeKey(scope),
      sourceMemoryId: factA.id,
      state: "projected",
      claimIds: [claimB.id],
      retiredRevisionIds: [],
      extractorVersion: claimA.extractorVersion,
      sourceUpdatedAt: claimA.ingestedAt,
      updatedAt: claimA.ingestedAt,
    };
    const statusB: ClaimProjectionStatus = {
      ...statusA,
      id: buildClaimProjectionStatusId(scope, factB.id),
      sourceMemoryId: factB.id,
      claimIds: [claimB.id],
      retiredRevisionIds: [claimA.id],
    };
    for (const claim of [claimA, claimB]) {
      await store.set(CLAIM_PROJECTIONS_COLLECTION, claim.id, claim);
    }
    for (const status of [statusA, statusB]) {
      await store.set(CLAIM_PROJECTION_STATUS_COLLECTION, status.id, status);
    }
    const runtime = createRecallProjectionRuntime({ documentStore: store });
    const operations = createRecallProjectionOperations({
      analyzerFingerprint: null,
      documentStore: store,
      language: createLanguageService(),
      now: () => observedAt,
    });

    expect(
      await runtime.queryClaimsBySourceMemoryIds(scope, [factA.id]),
    ).toEqual([]);
    const integrity = await operations.validateScopeUnsafe(
      scope,
      [
        { collection: "facts", document: factA, id: factA.id },
        { collection: "facts", document: factB, id: factB.id },
      ],
      new Set(),
    );
    expect(integrity.issues).toContain(
      `claim_source_mismatch:${claimB.id}`,
    );
    expect(integrity.issues).toContain(
      `retired_claim_source_mismatch:${claimA.id}`,
    );
  });

  it("accepts retained claim history for a superseded canonical fact", async () => {
    const store = createInMemoryDocumentStore();
    const fact = buildFact();
    const runtime = createRecallProjectionRuntime({
      documentStore: store,
      now: () => observedAt,
    });
    await runtime.documentStore.set("facts", fact.id, fact);
    await runtime.appendClaim(claimInput("active", fact.updatedAt));
    const supersededFact = {
      ...fact,
      isActive: false,
      lifecycle: "superseded" as const,
      updatedAt: "2026-07-21T10:00:00.000Z",
    };
    await runtime.documentStore.set("facts", fact.id, supersededFact);
    const operations = createRecallProjectionOperations({
      analyzerFingerprint: null,
      documentStore: store,
      language: createLanguageService(),
      now: () => observedAt,
    });

    expect(
      await operations.validateScopeUnsafe(
        scope,
        [{ collection: "facts", document: supersededFact, id: fact.id }],
        new Set(),
      ),
    ).toEqual({ complete: true, issues: [] });
  });

  it("rejects noncanonical claim and status scope keys", async () => {
    const store = createInMemoryDocumentStore();
    const fact = buildFact("fact-forged-scope-key");
    const claim = {
      ...buildStoredClaim("claim-forged-scope-key"),
      scopeKey: "forged-claim-scope-key",
      sourceMemoryId: fact.id,
    };
    const status = {
      ...buildStoredStatus(fact.id, [claim.id]),
      scopeKey: "forged-status-scope-key",
    };
    await store.set(CLAIM_PROJECTIONS_COLLECTION, claim.id, claim);
    await store.set(CLAIM_PROJECTION_STATUS_COLLECTION, status.id, status);
    const runtime = createRecallProjectionRuntime({ documentStore: store });
    const operations = createRecallProjectionOperations({
      analyzerFingerprint: null,
      documentStore: store,
      language: createLanguageService(),
      now: () => observedAt,
    });

    expect(
      await runtime.queryClaimsBySourceMemoryIds(scope, [fact.id]),
    ).toEqual([]);
    const integrity = await operations.validateScopeUnsafe(
      scope,
      [{ collection: "facts", document: fact, id: fact.id }],
      new Set(),
    );
    expect(integrity.issues).toContain(
      `claim_status_scope_key_mismatch:${status.id}`,
    );
    expect(integrity.issues).toContain(
      `claim_scope_key_mismatch:${claim.id}`,
    );
  });

  it("refills native text search after retired revisions occupy the first page", async () => {
    const inner = createInMemoryDocumentStore();
    const retiredOne = buildStoredClaim("a-retired");
    const retiredTwo = buildStoredClaim("b-retired");
    const active = buildStoredClaim("z-active");
    for (const claim of [retiredOne, retiredTwo, active]) {
      await inner.set(CLAIM_PROJECTIONS_COLLECTION, claim.id, claim);
    }
    const status: ClaimProjectionStatus = {
      id: buildClaimProjectionStatusId(scope, active.sourceMemoryId),
      schemaVersion: 2,
      ...scope,
      scopeKey: recallScopeKey(scope),
      sourceMemoryId: active.sourceMemoryId,
      state: "projected",
      claimIds: [active.id],
      retiredRevisionIds: [retiredOne.id, retiredTwo.id],
      extractorVersion: active.extractorVersion,
      sourceUpdatedAt: active.ingestedAt,
      updatedAt: active.ingestedAt,
    };
    await inner.set(CLAIM_PROJECTION_STATUS_COLLECTION, status.id, status);
    const searchedLimits: number[] = [];
    const store: ProjectionCapableDocumentStore = {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      set: (collection, id, document) => inner.set(collection, id, document),
      get: (collection, id) => inner.get(collection, id),
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => inner.query(collection, filter),
      queryPage: <TDocument extends StorageDocument>(
        collection: string,
        input: DocumentQueryPageInput,
      ) => inner.queryPage!<TDocument>(collection, input),
      delete: (collection, id) => inner.delete(collection, id),
      writeBatchIfUnchanged: (input) => inner.writeBatchIfUnchanged(input),
      async searchText<TDocument extends StorageDocument>(
        collection: string,
        input: DocumentTextSearchInput,
      ) {
        searchedLimits.push(input.limit);
        return inner.searchText!<TDocument>(collection, input);
      },
    };
    const runtime = createRecallProjectionRuntime({ documentStore: store });

    const matches = await runtime.searchClaims(
      scope,
      "atlas project status active",
      1,
      true,
    );

    expect(matches.map(({ id }) => id)).toEqual([active.id]);
    expect(searchedLimits).toEqual([1, 2, 4]);
  });

  it("bounds retired-revision FTS expansion without scanning the full match set", async () => {
    const inner = createInMemoryDocumentStore();
    const retired = Array.from({ length: 512 }, (_, index) =>
      buildStoredClaim(`retired-${String(index).padStart(3, "0")}`)
    );
    const status: ClaimProjectionStatus = {
      id: buildClaimProjectionStatusId(scope, retired[0]!.sourceMemoryId),
      schemaVersion: 2,
      ...scope,
      scopeKey: recallScopeKey(scope),
      sourceMemoryId: retired[0]!.sourceMemoryId,
      state: "projected",
      claimIds: [],
      retiredRevisionIds: retired.map(({ id }) => id),
      extractorVersion: retired[0]!.extractorVersion,
      sourceUpdatedAt: retired[0]!.ingestedAt,
      updatedAt: retired[0]!.ingestedAt,
    };
    await inner.set(CLAIM_PROJECTION_STATUS_COLLECTION, status.id, status);
    const searchedLimits: number[] = [];
    const store: ProjectionCapableDocumentStore = {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      set: (collection, id, document) => inner.set(collection, id, document),
      get: (collection, id) => inner.get(collection, id),
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => inner.query(collection, filter),
      delete: (collection, id) => inner.delete(collection, id),
      writeBatchIfUnchanged: (input) => inner.writeBatchIfUnchanged(input),
      async searchText<TDocument extends StorageDocument>(
        _collection: string,
        input: DocumentTextSearchInput,
      ) {
        searchedLimits.push(input.limit);
        if (input.limit > 512) {
          throw new Error("claim search expanded beyond its bounded pool");
        }
        return retired.slice(0, input.limit).map((document) => ({
          document: document as unknown as TDocument,
          id: document.id,
          score: 1,
        }));
      },
    };
    const runtime = createRecallProjectionRuntime({ documentStore: store });

    expect(
      await runtime.searchClaims(
        scope,
        "atlas project status active",
        1,
        true,
      ),
    ).toEqual([]);
    expect(Math.max(...searchedLimits)).toBe(512);
  });
});
