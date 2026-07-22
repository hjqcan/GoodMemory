import { describe, expect, it } from "bun:test";

import { createFactMemory } from "../../src/domain/records";
import { scopeToKey } from "../../src/domain/scope";
import {
  createEvidenceRecord,
  EVIDENCE_COLLECTION,
} from "../../src/evidence/contracts";
import {
  createEnglishLanguagePack,
  createLanguageService,
} from "../../src/language";
import {
  CLAIM_PROJECTIONS_COLLECTION,
  ENTITIES_COLLECTION,
  CLAIM_PROJECTION_STATUS_COLLECTION,
  PROJECTION_MANIFESTS_COLLECTION,
  PROJECTION_REPAIRS_COLLECTION,
  RECALL_DOCUMENTS_COLLECTION,
  SCOPE_CATALOG_COLLECTION,
  type ProjectionRepairRecord,
  type ClaimProjection,
  type ClaimProjectionStatus,
  type RecallProjectionManifest,
  type RecallIndexDocument,
  type ScopeCatalogProjection,
} from "../../src/recall/projections/contracts";
import { createRecallProjectionRuntime } from "../../src/recall/projections/runtime";
import { buildRecallProjectionBuildId } from "../../src/recall/projections/manifest";
import { buildClaimProjectionStatusId } from "../../src/recall/projections/claims";
import type {
  DocumentStore,
  StorageDocument,
} from "../../src/storage/contracts";
import { createInMemoryDocumentStore } from "../../src/storage/memory";

const NOW = "2026-07-09T12:00:00.000Z";
const scope = {
  userId: "user-1",
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  agentId: "agent-1",
  sessionId: "session-1",
};

function createMarkedLanguageService(input: {
  analyzerVersion: string;
  equalityPrefix?: string;
  normalizeForEquality?: (text: string) => string;
  searchTerm: string;
}) {
  const english = createEnglishLanguagePack();
  return createLanguageService({
    packs: [{
      ...english,
      analyzerVersion: input.analyzerVersion,
      buildSearchTerms: () => [input.searchTerm],
      normalizeForEquality: input.normalizeForEquality ??
        (input.equalityPrefix
          ? (text) => `${input.equalityPrefix}:${english.normalizeForEquality(text)}`
          : english.normalizeForEquality),
    }],
  });
}

function buildFact(input: {
  content?: string;
  id?: string;
  lifecycle?: "active" | "inactive" | "superseded";
}) {
  return createFactMemory({
    ...scope,
    id: input.id ?? "fact-1",
    category: "project",
    content:
      input.content ??
      "Alice approved the Atlas migration. The rollout starts in Paris.",
    subject: "Atlas migration",
    tags: ["Atlas", "Paris"],
    lifecycle: input.lifecycle ?? "active",
    isActive: (input.lifecycle ?? "active") === "active",
    source: {
      method: "explicit",
      extractedAt: "2026-07-08T12:00:00.000Z",
    },
    validFrom: "2026-07-08T00:00:00.000Z",
    validUntil: "2026-08-08T00:00:00.000Z",
    createdAt: "2026-07-08T12:00:00.000Z",
    updatedAt: "2026-07-08T12:00:00.000Z",
  });
}

function createOneShotProjectionFailureStore(
  inner: DocumentStore,
): DocumentStore {
  let shouldFail = true;

  return {
    projectionBatchSemantics: inner.projectionBatchSemantics,
    set: async <TDocument extends StorageDocument>(
      collection: string,
      id: string,
      document: TDocument,
    ) => {
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

function createCountedProjectionFailureStore(
  inner: DocumentStore,
  failureCount: number,
): DocumentStore {
  let remainingFailures = failureCount;

  return {
    projectionBatchSemantics: inner.projectionBatchSemantics,
    async set<TDocument extends StorageDocument>(
      collection: string,
      id: string,
      document: TDocument,
    ) {
      if (
        collection === RECALL_DOCUMENTS_COLLECTION &&
        remainingFailures > 0
      ) {
        remainingFailures -= 1;
        throw new Error("injected counted projection failure");
      }
      await inner.set(collection, id, document);
    },
    get: (collection, id) => inner.get(collection, id),
    update: (collection, id, patch) => inner.update(collection, id, patch),
    query: (collection, filter) => inner.query(collection, filter),
    delete: (collection, id) => inner.delete(collection, id),
    async writeBatchIfUnchanged(input) {
      if (
        remainingFailures > 0 &&
        input.set.some(({ collection }) =>
          collection === RECALL_DOCUMENTS_COLLECTION
        )
      ) {
        remainingFailures -= 1;
        throw new Error("injected counted projection failure");
      }
      return inner.writeBatchIfUnchanged!(input);
    },
  };
}

function createContentTriggeredProjectionFailureStore(
  inner: DocumentStore,
  trigger: string,
): DocumentStore {
  let shouldFail = true;

  return {
    projectionBatchSemantics: inner.projectionBatchSemantics,
    async set<TDocument extends StorageDocument>(
      collection: string,
      id: string,
      document: TDocument,
    ) {
      if (
        collection === RECALL_DOCUMENTS_COLLECTION &&
        shouldFail &&
        JSON.stringify(document).includes(trigger)
      ) {
        shouldFail = false;
        throw new Error("injected replacement projection failure");
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
        input.set.some(({ collection, document }) =>
          collection === RECALL_DOCUMENTS_COLLECTION &&
          JSON.stringify(document).includes(trigger)
        )
      ) {
        shouldFail = false;
        throw new Error("injected replacement projection failure");
      }
      return inner.writeBatchIfUnchanged!(input);
    },
  };
}

function createPostCommitReadFailureStore(inner: DocumentStore): DocumentStore {
  let canonicalReads = 0;

  return {
    projectionBatchSemantics: inner.projectionBatchSemantics,
    set: (collection, id, document) => inner.set(collection, id, document),
    async get<TDocument extends StorageDocument>(collection: string, id: string) {
      if (collection === "facts") {
        canonicalReads += 1;
        if (canonicalReads === 3) {
          throw new Error("injected post-commit read failure");
        }
      }
      return inner.get<TDocument>(collection, id);
    },
    update: (collection, id, patch) => inner.update(collection, id, patch),
    query: (collection, filter) => inner.query(collection, filter),
    delete: (collection, id) => inner.delete(collection, id),
    writeBatchIfUnchanged: (input) => inner.writeBatchIfUnchanged!(input),
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

function createDelayedOldProjectionStore(inner: DocumentStore): {
  documentStore: DocumentStore;
  oldProjectionStarted: Promise<void>;
  releaseOldProjection(): void;
  secondCanonicalWriteStarted(): boolean;
} {
  let releaseOldProjection = () => {};
  let signalOldProjectionStarted = () => {};
  let shouldDelayOldProjection = true;
  let secondCanonicalWriteStarted = false;
  const oldProjectionStarted = new Promise<void>((resolve) => {
    signalOldProjectionStarted = resolve;
  });
  const oldProjectionRelease = new Promise<void>((resolve) => {
    releaseOldProjection = resolve;
  });

  async function observeWrite(
    collection: string,
    document: StorageDocument,
  ): Promise<void> {
    const serialized = JSON.stringify(document);
    if (collection === "facts" && serialized.includes("Lisbon")) {
      secondCanonicalWriteStarted = true;
    }
    if (
      collection === RECALL_DOCUMENTS_COLLECTION &&
      shouldDelayOldProjection &&
      serialized.includes("Berlin")
    ) {
      shouldDelayOldProjection = false;
      signalOldProjectionStarted();
      await oldProjectionRelease;
    }
  }

  return {
    documentStore: {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      async set<TDocument extends StorageDocument>(
        collection: string,
        id: string,
        document: TDocument,
      ) {
        await observeWrite(collection, document);
        await inner.set(collection, id, document);
      },
      get: (collection, id) => inner.get(collection, id),
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => inner.query(collection, filter),
      delete: (collection, id) => inner.delete(collection, id),
      async writeBatchIfUnchanged(input) {
        for (const operation of input.set) {
          await observeWrite(operation.collection, operation.document);
        }
        return inner.writeBatchIfUnchanged!(input);
      },
    },
    oldProjectionStarted,
    releaseOldProjection,
    secondCanonicalWriteStarted: () => secondCanonicalWriteStarted,
  };
}

describe("recall projection runtime", () => {
  it("builds stable projection identities from the complete language analyzer manifest", () => {
    const first = buildRecallProjectionBuildId(createLanguageService());
    const second = buildRecallProjectionBuildId(createLanguageService());
    const alternateDefault = buildRecallProjectionBuildId(
      createLanguageService({ defaultLocale: "ja-JP" }),
    );

    expect(first).toBe(second);
    expect(first).toStartWith("gm-projection-v2:");
    expect(alternateDefault).not.toBe(first);
  });

  it("refuses persistent projection identity for an unversioned custom detector", () => {
    const buildId = buildRecallProjectionBuildId(createLanguageService({
      detector: () => "en-US",
    }));

    expect(buildId).toBeUndefined();
  });

  it("writes versioned multi-granular, entity, and scope projections after a canonical write", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
    });
    const fact = buildFact({});

    await runtime.documentStore.set("facts", fact.id, fact);

    const documents = await rawStore.query<RecallIndexDocument>(
      RECALL_DOCUMENTS_COLLECTION,
      { sourceCollection: "facts", sourceMemoryId: fact.id },
    );
    expect(documents.length).toBeGreaterThan(1);
    expect(new Set(documents.map((document) => document.granularity))).toEqual(
      new Set(["memory", "field", "sentence"]),
    );
    expect(
      documents.every(
        (document) =>
          document.schemaVersion === 2 &&
          typeof document.searchText === "string" &&
          document.searchText.length > 0 &&
          document.searchAnalyzerVersion.length > 0 &&
          document.searchSchemaVersion === "gm-search-v1" &&
          document.languagePackId === "en" &&
          document.scopeKey === scopeToKey(scope) &&
          document.sourceMemoryId === fact.id &&
          document.effectiveFrom === fact.validFrom &&
          document.effectiveUntil === fact.validUntil &&
          document.provenance.method === "explicit",
      ),
    ).toBe(true);

    const entities = await runtime.queryEntities(scope);
    const alice = entities.find((entity) => entity.canonicalKey === "alice");
    expect(alice?.aliases).toContain("Alice");
    expect(alice?.memoryIds).toContain("facts:fact-1");
    expect(alice?.validFrom).toBe(fact.validFrom);

    const adjacency = await rawStore.query(ENTITIES_COLLECTION, {
      scopeKey: scopeToKey(scope),
    });
    expect(adjacency.every((edge) =>
      typeof (edge as { text?: string }).text === "string"
    )).toBe(true);

    const catalogs = await rawStore.query<ScopeCatalogProjection>(
      SCOPE_CATALOG_COLLECTION,
      { scopeKey: scopeToKey(scope) },
    );
    expect(catalogs).toEqual([
      expect.objectContaining({
        ...scope,
        coverage: "partial",
        searchSchemaVersion: "gm-search-v1",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
        schemaVersion: 1,
      }),
    ]);
  });

  it("searches entity adjacency through its unified indexed text field", async () => {
    const inner = createInMemoryDocumentStore();
    const searchedFields: string[] = [];
    const store: DocumentStore = {
      projectionBatchSemantics: inner.projectionBatchSemantics,
      set: (collection, id, document) => inner.set(collection, id, document),
      get: (collection, id) => inner.get(collection, id),
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => inner.query(collection, filter),
      delete: (collection, id) => inner.delete(collection, id),
      searchText: (collection, input) => {
        searchedFields.push(input.field);
        return inner.searchText!(collection, input);
      },
      writeBatchIfUnchanged: (input) => inner.writeBatchIfUnchanged!(input),
    };
    const runtime = createRecallProjectionRuntime({ documentStore: store });
    const fact = buildFact({});
    await runtime.documentStore.set("facts", fact.id, fact);
    searchedFields.length = 0;

    const matches = await runtime.searchEntities(scope, "Alice Atlas", 5);

    expect(matches.some(({ canonicalKey }) => canonicalKey === "alice")).toBe(
      true,
    );
    expect(searchedFields).toEqual(["searchText"]);
  });

  it("pre-tokenizes Traditional Chinese and Japanese projection search", async () => {
    const runtime = createRecallProjectionRuntime({
      documentStore: createInMemoryDocumentStore(),
      now: () => NOW,
    });
    const traditional = {
      ...buildFact({
        id: "fact-hant",
        content: "目前的資料庫是 PostgreSQL，部署阻礙仍待處理。",
      }),
      subject: "資料庫部署",
      source: {
        method: "explicit" as const,
        extractedAt: "2026-07-08T12:00:00.000Z",
        locale: "zh-TW",
      },
    };
    const japanese = {
      ...buildFact({
        id: "fact-ja",
        content: "現在のブロッカーはデータベース移行です。",
      }),
      subject: "データベース移行",
      source: {
        method: "explicit" as const,
        extractedAt: "2026-07-08T12:00:00.000Z",
        locale: "ja-JP",
      },
    };

    await runtime.documentStore.set("facts", traditional.id, traditional);
    await runtime.documentStore.set("facts", japanese.id, japanese);

    const traditionalMatches = await runtime.searchDocuments(
      scope,
      "資料庫阻礙",
      5,
    );
    const japaneseMatches = await runtime.searchDocuments(
      scope,
      "データベースのブロッカー",
      5,
    );

    expect(traditionalMatches.some(({ sourceMemoryId }) =>
      sourceMemoryId === traditional.id
    )).toBe(true);
    expect(japaneseMatches.some(({ sourceMemoryId }) =>
      sourceMemoryId === japanese.id
    )).toBe(true);
    expect(
      traditionalMatches.every(({ searchLocale }) => searchLocale === "zh-TW"),
    ).toBe(true);
    expect(
      japaneseMatches.every(({ searchLocale }) => searchLocale === "ja-JP"),
    ).toBe(true);
    expect(
      (await runtime.searchEntities(scope, "資料庫部署", 5)).some(
        ({ aliases, canonicalKey }) =>
          canonicalKey === "数据库部署" && aliases.includes("資料庫部署"),
      ),
    ).toBe(true);
    expect(
      (await runtime.searchEntities(scope, "データベース移行", 5)).some(
        ({ canonicalKey }) => canonicalKey === "データベース移行",
      ),
    ).toBe(true);
    expect(
      (await runtime.searchClaims(scope, "資料庫阻礙", 5)).some(
        ({ sourceMemoryId }) => sourceMemoryId === traditional.id,
      ),
    ).toBe(true);
    expect(
      (await runtime.searchClaims(scope, "データベース移行", 5)).some(
        ({ sourceMemoryId }) => sourceMemoryId === japanese.id,
      ),
    ).toBe(true);
  });

  it("uses the earliest validity boundary when both validUntil and TTL exist", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
    });
    const fact = {
      ...buildFact({}),
      expiresAt: "2026-07-20T00:00:00.000Z",
      validUntil: "2026-08-08T00:00:00.000Z",
    };

    await runtime.documentStore.set("facts", fact.id, fact);
    const documents = await runtime.queryDocuments(scope);

    expect(
      documents.every(
        (document) => document.effectiveUntil === fact.expiresAt,
      ),
    ).toBe(true);
  });

  it("splits contiguous CJK sentences into separate projection documents", async () => {
    const runtime = createRecallProjectionRuntime({
      documentStore: createInMemoryDocumentStore(),
      now: () => NOW,
    });
    const fact = buildFact({
      content: "第一句话包含足够多的信息。第二句话也包含足够多的信息！",
    });

    await runtime.documentStore.set("facts", fact.id, fact);
    const sentences = (await runtime.queryDocuments(scope))
      .filter(({ granularity, text }) =>
        granularity === "sentence" && text.includes("句话"),
      )
      .map(({ text }) => text);

    expect(sentences).toEqual([
      "第一句话包含足够多的信息。",
      "第二句话也包含足够多的信息！",
    ]);
  });

  it("caps every projected document and source entity set", async () => {
    const runtime = createRecallProjectionRuntime({
      documentStore: createInMemoryDocumentStore(),
      now: () => NOW,
    });
    const entities = Array.from(
      { length: 180 },
      (_, index) => `Entity${index}`,
    ).join(" ");
    const fact = buildFact({
      id: "fact-large",
      content: `${entities} ${"x".repeat(40_000)}`,
    });

    await runtime.documentStore.set("facts", fact.id, fact);

    const documents = (await runtime.queryDocuments(scope)).filter(
      (document) => document.sourceMemoryId === fact.id,
    );
    expect(documents.every((document) => document.text.length <= 32_000)).toBe(
      true,
    );
    expect(
      new Set(documents.flatMap((document) => document.entityIds)).size,
    ).toBeLessThanOrEqual(128);
  });

  it("keeps projections aligned with a successful conditional revision batch", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
    });
    const previous = buildFact({ id: "fact-old" });
    await runtime.documentStore.set("facts", previous.id, previous);

    const superseded = {
      ...previous,
      lifecycle: "superseded" as const,
      isActive: false,
      supersededBy: "fact-new",
    };
    const next = buildFact({
      id: "fact-new",
      content: "Alice moved the Atlas rollout from Paris to Lisbon.",
    });
    const committed = await runtime.documentStore.writeBatchIfUnchanged?.({
      expected: {
        collection: "facts",
        id: previous.id,
        document: previous,
      },
      set: [
        { collection: "facts", id: superseded.id, document: superseded },
        { collection: "facts", id: next.id, document: next },
      ],
    });

    expect(committed).toBe(true);
    expect(
      await rawStore.query(RECALL_DOCUMENTS_COLLECTION, {
        sourceMemoryId: previous.id,
      }),
    ).toEqual([]);
    expect(
      await rawStore.query(RECALL_DOCUMENTS_COLLECTION, {
        sourceMemoryId: next.id,
      }),
    ).not.toEqual([]);
  });

  it("removes document projections and entity adjacency after canonical deletion", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
    });
    const fact = buildFact({});
    await runtime.documentStore.set("facts", fact.id, fact);

    await runtime.documentStore.delete("facts", fact.id);

    expect(
      await rawStore.query(RECALL_DOCUMENTS_COLLECTION, {
        sourceMemoryId: fact.id,
      }),
    ).toEqual([]);
    const entities = await runtime.queryEntities(scope);
    expect(
      entities.every((entity) => !entity.memoryIds.includes("facts:fact-1")),
    ).toBe(true);
  });

  it("preserves canonical success, queues projection failure, and repairs idempotently", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: createOneShotProjectionFailureStore(rawStore),
      now: () => NOW,
    });
    const fact = buildFact({});

    await expect(runtime.documentStore.set("facts", fact.id, fact)).resolves.toBe(
      undefined,
    );
    expect(await rawStore.get("facts", fact.id)).toEqual(fact);
    expect(
      await rawStore.query<ProjectionRepairRecord>(
        PROJECTION_REPAIRS_COLLECTION,
        { scopeKey: scopeToKey(scope) },
      ),
    ).toHaveLength(1);

    expect(await runtime.repairPending(scope)).toBe(1);
    expect(await runtime.repairPending(scope)).toBe(0);
    expect(
      await rawStore.query(RECALL_DOCUMENTS_COLLECTION, {
        sourceMemoryId: fact.id,
      }),
    ).not.toEqual([]);
    expect(
      await rawStore.query(PROJECTION_REPAIRS_COLLECTION, {
        scopeKey: scopeToKey(scope),
      }),
    ).toEqual([]);
  });

  it("coalesces consecutive source failures into one current repair", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: createCountedProjectionFailureStore(rawStore, 2),
      now: () => NOW,
    });
    const first = buildFact({
      content: "Alice approved the Atlas migration in Berlin.",
    });
    const second = buildFact({
      content: "Alice approved the Atlas migration in Lisbon.",
    });

    await runtime.documentStore.set("facts", first.id, first);
    await runtime.documentStore.set("facts", second.id, second);

    expect(await rawStore.query(PROJECTION_REPAIRS_COLLECTION)).toHaveLength(1);
    expect(await runtime.repairPending(scope)).toBe(1);
    expect(await rawStore.query(PROJECTION_REPAIRS_COLLECTION)).toEqual([]);
  });

  it("keeps volatile repair processing inside the requested scope", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: createCountedProjectionFailureStore(rawStore, 2),
      now: () => NOW,
    });
    const first = buildFact({ id: "fact-scope-a" });
    const second = {
      ...buildFact({ id: "fact-scope-b" }),
      userId: "user-2",
      tenantId: "tenant-2",
      workspaceId: "workspace-2",
      agentId: "agent-2",
      sessionId: "session-2",
    };

    await runtime.documentStore.set("facts", first.id, first);
    await runtime.documentStore.set("facts", second.id, second);

    expect(await runtime.repairPending(scope)).toBe(1);
    expect(
      await rawStore.query(RECALL_DOCUMENTS_COLLECTION, {
        sourceMemoryId: first.id,
      }),
    ).not.toEqual([]);
    expect(
      await rawStore.query(RECALL_DOCUMENTS_COLLECTION, {
        sourceMemoryId: second.id,
      }),
    ).toEqual([]);
    expect(
      await rawStore.query(PROJECTION_REPAIRS_COLLECTION, {
        userId: second.userId,
      }),
    ).toHaveLength(1);
  });

  it("removes stale entity adjacency when repair follows a mid-replacement failure", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: createContentTriggeredProjectionFailureStore(
        rawStore,
        "Lisbon",
      ),
      now: () => NOW,
    });
    const original = buildFact({
      content: "Alice approved the Atlas migration in Berlin.",
    });
    await runtime.documentStore.set("facts", original.id, original);
    const replacement = buildFact({
      content: "Bob approved the Atlas migration in Lisbon.",
    });

    await runtime.documentStore.set("facts", replacement.id, replacement);
    expect(await runtime.repairPending(scope)).toBe(1);

    const entities = await runtime.queryEntities(scope);
    expect(
      entities.find((entity) => entity.canonicalKey === "alice")?.memoryIds ?? [],
    ).not.toContain("facts:fact-1");
    expect(
      entities.find((entity) => entity.canonicalKey === "bob")?.memoryIds,
    ).toContain("facts:fact-1");
  });

  it("does not report a failed canonical write when only post-commit projection read fails", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: createPostCommitReadFailureStore(rawStore),
      now: () => NOW,
    });
    const fact = buildFact({});

    await expect(runtime.documentStore.set("facts", fact.id, fact)).resolves.toBe(
      undefined,
    );
    expect(await rawStore.get("facts", fact.id)).toEqual(fact);
    expect(
      await rawStore.query(PROJECTION_REPAIRS_COLLECTION, {
        scopeKey: scopeToKey(scope),
      }),
    ).toHaveLength(1);
  });

  it("lazily backfills historical canonical records once and marks coverage complete", async () => {
    const rawStore = createInMemoryDocumentStore();
    const historical = buildFact({ id: "fact-historical" });
    await rawStore.set("facts", historical.id, historical);
    let timestamp = NOW;
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => timestamp,
    });

    const first = await runtime.ensureScopeIndexed(scope);
    const firstDocuments = await runtime.queryDocuments(scope);
    expect(first).toMatchObject({ complete: true, indexedSources: 1, skipped: false });
    expect(firstDocuments.some((document) => document.sourceMemoryId === historical.id)).toBe(
      true,
    );
    expect(
      (await runtime.queryEntities(scope)).some(
        (projection) => projection.canonicalKey === "alice",
      ),
    ).toBe(true);
    expect(
      await rawStore.query<ScopeCatalogProjection>(SCOPE_CATALOG_COLLECTION, {
        scopeKey: scopeToKey(scope),
      }),
    ).toEqual([expect.objectContaining({ coverage: "complete" })]);

    timestamp = "2026-07-11T12:00:00.000Z";
    const second = await runtime.ensureScopeIndexed(scope);
    expect(second).toMatchObject({ complete: true, indexedSources: 0, skipped: true });
    expect((await runtime.queryDocuments(scope))[0]?.indexedAt).toBe(
      firstDocuments[0]?.indexedAt,
    );
  });

  it("registers new durable scopes when projection write-through is disabled", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
      writeThrough: false,
    });
    const fact = buildFact({ id: "fact-catalog-only" });

    await runtime.documentStore.set("facts", fact.id, fact);

    expect(
      await rawStore.query<RecallIndexDocument>(RECALL_DOCUMENTS_COLLECTION),
    ).toEqual([]);
    expect(
      await rawStore.query<ScopeCatalogProjection>(SCOPE_CATALOG_COLLECTION, {
        scopeKey: scopeToKey(scope),
      }),
    ).toEqual([
      expect.objectContaining({
        coverage: "partial",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
      }),
    ]);
  });

  it("registers scopes from successful conditional batches without write-through", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
      writeThrough: false,
    });
    const previous = buildFact({ id: "fact-before-batch" });
    const nextScope = {
      ...scope,
      sessionId: "session-batch",
      userId: "user-batch",
      workspaceId: "workspace-batch",
    };
    const next = {
      ...buildFact({ id: "fact-after-batch" }),
      ...nextScope,
    };
    await rawStore.set("facts", previous.id, previous);

    const committed = await runtime.documentStore.writeBatchIfUnchanged?.({
      expected: {
        collection: "facts",
        document: previous,
        id: previous.id,
      },
      set: [{ collection: "facts", document: next, id: next.id }],
    });

    expect(committed).toBe(true);
    expect(
      await rawStore.query<ScopeCatalogProjection>(SCOPE_CATALOG_COLLECTION, {
        scopeKey: scopeToKey(nextScope),
      }),
    ).toEqual([
      expect.objectContaining({
        coverage: "partial",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
      }),
    ]);
  });

  it("reuses recall-scope verification across sessions", async () => {
    const rawStore = createInMemoryDocumentStore();
    const historical = buildFact({ id: "fact-shared-recall-scope" });
    await rawStore.set("facts", historical.id, historical);
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
    });

    await runtime.ensureScopeIndexed(scope);
    const secondSession = await runtime.ensureScopeIndexed({
      ...scope,
      sessionId: "session-2",
    });

    expect(secondSession).toMatchObject({
      complete: true,
      indexedSources: 0,
      skipped: true,
    });
  });

  it("bulk backfill scans projection collections once per scope", async () => {
    const rawStore = createInMemoryDocumentStore();
    for (let index = 0; index < 40; index += 1) {
      const fact = buildFact({
        id: `fact-bulk-${index}`,
        content: `Alice approved Atlas rollout checkpoint ${index} in Paris.`,
      });
      await rawStore.set("facts", fact.id, fact);
    }
    let recallDocumentQueries = 0;
    let entityQueries = 0;
    const countingStore: DocumentStore = {
      projectionBatchSemantics: rawStore.projectionBatchSemantics,
      set: (collection, id, document) => rawStore.set(collection, id, document),
      get: (collection, id) => rawStore.get(collection, id),
      update: (collection, id, patch) => rawStore.update(collection, id, patch),
      async query(collection, filter) {
        if (collection === RECALL_DOCUMENTS_COLLECTION) {
          recallDocumentQueries += 1;
        } else if (collection === ENTITIES_COLLECTION) {
          entityQueries += 1;
        }
        return rawStore.query(collection, filter);
      },
      delete: (collection, id) => rawStore.delete(collection, id),
      writeBatchIfUnchanged: (input) => rawStore.writeBatchIfUnchanged(input),
    };
    const runtime = createRecallProjectionRuntime({
      bulkBackfill: true,
      documentStore: countingStore,
      now: () => NOW,
      writeThrough: false,
    });

    const result = await runtime.ensureScopeIndexed(scope);

    expect(result).toMatchObject({
      complete: true,
      indexedSources: 40,
      skipped: false,
    });
    expect(recallDocumentQueries).toBe(1);
    expect(entityQueries).toBe(1);
  });

  it("does not let a narrow backfill mark the user-wide scope complete", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
    });
    await rawStore.set("profiles", scope.userId, {
      userId: scope.userId,
      identity: { displayName: "Projection User" },
    });
    const workspaceOne = buildFact({ id: "fact-workspace-1" });
    const workspaceTwo = {
      ...buildFact({ id: "fact-workspace-2" }),
      workspaceId: "workspace-2",
    };
    await rawStore.set("facts", workspaceOne.id, workspaceOne);
    await rawStore.set("facts", workspaceTwo.id, workspaceTwo);

    await runtime.ensureScopeIndexed(scope);
    const userWide = await runtime.ensureScopeIndexed({ userId: scope.userId });

    expect(userWide.skipped).toBe(false);
    expect(
      (await runtime.queryDocuments({ userId: scope.userId })).some(
        (document) => document.sourceMemoryId === workspaceTwo.id,
      ),
    ).toBe(false);
    expect(
      (await runtime.queryEntities({ userId: scope.userId }))
        .flatMap(({ memoryIds }) => memoryIds)
        .some((memoryId) => memoryId === `facts:${workspaceTwo.id}`),
    ).toBe(false);
  });

  it("does not let narrow validation rewrite user-wide profile projections", async () => {
    const rawStore = createInMemoryDocumentStore();
    await rawStore.set("profiles", scope.userId, {
      userId: scope.userId,
      identity: { displayName: "Projection User" },
    });
    const newRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      language: createMarkedLanguageService({
        analyzerVersion: "new",
        searchTerm: "new-token",
      }),
      now: () => "2026-07-12T12:00:00.000Z",
      persistentScopeProof: { buildId: "projection-build-new" },
    });
    const oldRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      language: createMarkedLanguageService({
        analyzerVersion: "old",
        searchTerm: "old-token",
      }),
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-old" },
    });

    await newRuntime.ensureScopeIndexed({ userId: scope.userId });
    await oldRuntime.ensureScopeIndexed(scope);
    const afterNarrowValidation = await rawStore.query<RecallIndexDocument>(
      RECALL_DOCUMENTS_COLLECTION,
      { sourceCollection: "profiles", sourceMemoryId: scope.userId },
    );
    const userManifest = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      `scope:${scopeToKey({ userId: scope.userId })}`,
    );

    expect(userManifest?.projectionBuildId).toBe("projection-build-new");
    expect(userManifest?.validatedGeneration).toBe(
      userManifest?.sourceGeneration,
    );
    expect(afterNarrowValidation.length).toBeGreaterThan(0);
    expect(
      afterNarrowValidation.every(
        ({ searchAnalyzerVersion, searchText }) =>
          searchAnalyzerVersion === "new" && searchText === "new-token",
      ),
    ).toBe(true);
    expect(await newRuntime.ensureScopeIndexed({ userId: scope.userId }))
      .toMatchObject({ complete: true, indexedSources: 0, skipped: true });
  });

  it("indexes the global profile for a session-only recall scope", async () => {
    const rawStore = createInMemoryDocumentStore();
    await rawStore.set("profiles", scope.userId, {
      userId: scope.userId,
      identity: { displayName: "Projection User" },
    });
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
    });

    await runtime.ensureScopeIndexed({
      userId: scope.userId,
      sessionId: scope.sessionId,
    });

    expect(
      (await runtime.queryDocuments({ userId: scope.userId })).some(
        ({ sourceCollection, sourceMemoryId }) =>
          sourceCollection === "profiles" && sourceMemoryId === scope.userId,
      ),
    ).toBe(true);
  });

  it("invalidates a complete sessionless scope when a session write needs repair", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: createContentTriggeredProjectionFailureStore(
        rawStore,
        "Lisbon",
      ),
      now: () => NOW,
    });
    const recallScope = { ...scope, sessionId: undefined };
    const original = buildFact({
      content: "Alice approved the Atlas migration in Berlin.",
    });
    await runtime.documentStore.set("facts", original.id, original);
    await runtime.ensureScopeIndexed(recallScope);

    await runtime.documentStore.update("facts", original.id, {
      content: "Alice approved the Atlas migration in Lisbon.",
    });

    const catalogBeforeRepair = await rawStore.get<ScopeCatalogProjection>(
      SCOPE_CATALOG_COLLECTION,
      `scope:${scopeToKey(recallScope)}`,
    );
    expect(catalogBeforeRepair?.coverage).toBe("partial");
    const repaired = await runtime.ensureScopeIndexed(recallScope);
    expect(repaired.skipped).toBe(false);
    const documents = await runtime.queryDocuments(recallScope);
    expect(documents.some(({ text }) => text.includes("Lisbon"))).toBe(true);
    expect(documents.every(({ text }) => !text.includes("Berlin"))).toBe(true);
  });

  it("revalidates persisted complete coverage once per runtime", async () => {
    const rawStore = createInMemoryDocumentStore();
    const firstRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
    });
    const original = buildFact({
      content: "Alice approved the Atlas migration in Berlin.",
    });
    await firstRuntime.documentStore.set("facts", original.id, original);
    await firstRuntime.ensureScopeIndexed(scope);

    await rawStore.set("facts", original.id, {
      ...original,
      content: "Alice approved the Atlas migration in Lisbon.",
    });
    const restartedRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-12T12:00:00.000Z",
    });

    const revalidated = await restartedRuntime.ensureScopeIndexed(scope);
    const documents = await restartedRuntime.queryDocuments(scope);

    expect(revalidated.skipped).toBe(false);
    expect(documents.every((document) => !document.text.includes("Berlin"))).toBe(
      true,
    );
    expect(documents.some((document) => document.text.includes("Lisbon"))).toBe(
      true,
    );
  });

  it("uses a valid persistent manifest to skip all cold-start scope scans", async () => {
    const rawStore = createInMemoryDocumentStore();
    const firstRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });
    const fact = buildFact({ id: "fact-persistent-proof" });
    await firstRuntime.documentStore.set("facts", fact.id, fact);
    await firstRuntime.ensureScopeIndexed(scope);

    let manifestGets = 0;
    let queries = 0;
    const countedStore: DocumentStore = {
      projectionBatchSemantics: rawStore.projectionBatchSemantics,
      set: (collection, id, document) => rawStore.set(collection, id, document),
      async get(collection, id) {
        if (collection === PROJECTION_MANIFESTS_COLLECTION) {
          manifestGets += 1;
        }
        return rawStore.get(collection, id);
      },
      update: (collection, id, patch) => rawStore.update(collection, id, patch),
      async query(collection, filter) {
        queries += 1;
        return rawStore.query(collection, filter);
      },
      delete: (collection, id) => rawStore.delete(collection, id),
      writeBatchIfUnchanged: (input) => rawStore.writeBatchIfUnchanged(input),
    };
    const restartedRuntime = createRecallProjectionRuntime({
      documentStore: countedStore,
      now: () => "2026-07-12T12:00:00.000Z",
      persistentScopeProof: { buildId: "projection-build-a" },
    });

    const result = await restartedRuntime.ensureScopeIndexed(scope);

    expect(result).toEqual({ complete: true, indexedSources: 0, skipped: true });
    expect(manifestGets).toBe(1);
    expect(queries).toBe(0);
  });

  it("does not trust a legacy complete catalog without a source manifest", async () => {
    const rawStore = createInMemoryDocumentStore();
    const fact = buildFact({ id: "fact-legacy-catalog" });
    await rawStore.set("facts", fact.id, fact);
    await rawStore.set(SCOPE_CATALOG_COLLECTION, `scope:${scopeToKey(scope)}`, {
      ...scope,
      id: `scope:${scopeToKey(scope)}`,
      schemaVersion: 1,
      scopeKey: scopeToKey(scope),
      coverage: "complete",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
    });
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });

    const result = await runtime.ensureScopeIndexed(scope);
    const manifests = await rawStore.query<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
    );

    expect(result).toMatchObject({ complete: true, indexedSources: 1, skipped: false });
    expect(manifests).toEqual([
      expect.objectContaining({
        projectionBuildId: "projection-build-a",
        sourceGeneration: expect.any(String),
        validatedGeneration: expect.any(String),
      }),
    ]);
    expect(manifests[0]?.validatedGeneration).toBe(
      manifests[0]?.sourceGeneration,
    );
  });

  it("removes orphan claim history before sealing persistent scope proof", async () => {
    const rawStore = createInMemoryDocumentStore();
    const movedFact = {
      ...buildFact({ id: "fact-orphan-claim" }),
      workspaceId: "workspace-2",
    };
    const orphanClaim: ClaimProjection = {
      id: "claim-orphan-history",
      schemaVersion: 1,
      ...scope,
      scopeKey: scopeToKey(scope),
      sourceMemoryId: movedFact.id,
      subjectEntityId: "entity:legacy-atlas",
      predicateKey: "project.status",
      objectText: "active",
      polarity: "positive",
      modality: "asserted",
      observedAt: movedFact.updatedAt,
      ingestedAt: movedFact.updatedAt,
      evidenceIds: [],
      sourceMessageIds: [],
      extractorVersion: "legacy-v1",
    };
    await rawStore.set("facts", movedFact.id, movedFact);
    await rawStore.set(
      CLAIM_PROJECTIONS_COLLECTION,
      orphanClaim.id,
      orphanClaim,
    );
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });

    const result = await runtime.ensureScopeIndexed(scope);

    expect(result).toMatchObject({ complete: true, skipped: false });
    expect(await runtime.queryClaimHistory(scope)).toEqual([]);
    expect(
      await rawStore.get(CLAIM_PROJECTIONS_COLLECTION, orphanClaim.id),
    ).toBeNull();
  });

  it("rebuilds a missing selected claim before sealing persistent scope proof", async () => {
    const rawStore = createInMemoryDocumentStore();
    const fact = buildFact({ id: "fact-dangling-selected-claim" });
    const status: ClaimProjectionStatus = {
      id: buildClaimProjectionStatusId(scope, fact.id),
      schemaVersion: 1,
      ...scope,
      scopeKey: scopeToKey(scope),
      sourceMemoryId: fact.id,
      state: "projected",
      claimIds: ["claim-missing"],
      extractorVersion: "legacy-v1",
      sourceUpdatedAt: fact.updatedAt,
      updatedAt: fact.updatedAt,
    };
    await rawStore.set("facts", fact.id, fact);
    await rawStore.set(CLAIM_PROJECTION_STATUS_COLLECTION, status.id, status);
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });

    const result = await runtime.ensureScopeIndexed(scope);
    const rebuiltStatus = await rawStore.get<ClaimProjectionStatus>(
      CLAIM_PROJECTION_STATUS_COLLECTION,
      status.id,
    );
    const rebuiltClaims = await rawStore.query<ClaimProjection>(
      CLAIM_PROJECTIONS_COLLECTION,
      { sourceMemoryId: fact.id },
    );
    const manifest = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      `scope:${scopeToKey({ ...scope, sessionId: undefined })}`,
    );

    expect(result).toMatchObject({ complete: true, skipped: false });
    expect(rebuiltStatus).toMatchObject({
      claimIds: [expect.any(String)],
      state: "unstructured",
    });
    expect(rebuiltStatus?.claimIds).not.toContain("claim-missing");
    expect(rebuiltClaims.map(({ id }) => id)).toEqual(
      rebuiltStatus?.claimIds ?? [],
    );
    expect(await runtime.queryClaims(scope)).toEqual([
      expect.objectContaining({ sourceMemoryId: fact.id }),
    ]);
    expect(manifest?.validatedGeneration).toBe(manifest?.sourceGeneration);
  });

  it("fails closed when structured legacy claims lack raw entity inputs", async () => {
    const variants: Array<{
      claimFields: Partial<ClaimProjection>;
      id: string;
    }> = [
      {
        claimFields: {},
        id: "missing-subject-text",
      },
      {
        claimFields: {
          objectEntityId: "entity:legacy-paris",
          subjectText: "Atlas migration",
        },
        id: "missing-object-entity-text",
      },
    ];

    for (const variant of variants) {
      const rawStore = createInMemoryDocumentStore();
      const fact = buildFact({ id: `fact-${variant.id}` });
      const legacyClaim: ClaimProjection = {
        id: `claim-${variant.id}`,
        schemaVersion: 1,
        ...scope,
        scopeKey: scopeToKey(scope),
        sourceMemoryId: fact.id,
        subjectEntityId: "entity:legacy-atlas",
        predicateKey: "project.location",
        objectText: "Paris",
        polarity: "positive",
        modality: "asserted",
        observedAt: fact.updatedAt,
        ingestedAt: fact.updatedAt,
        evidenceIds: [],
        sourceMessageIds: [],
        extractorVersion: "legacy-v1",
        ...variant.claimFields,
      };
      const status: ClaimProjectionStatus = {
        id: buildClaimProjectionStatusId(scope, fact.id),
        schemaVersion: 1,
        ...scope,
        scopeKey: legacyClaim.scopeKey,
        sourceMemoryId: fact.id,
        state: "projected",
        claimIds: [legacyClaim.id],
        extractorVersion: legacyClaim.extractorVersion,
        sourceUpdatedAt: fact.updatedAt,
        updatedAt: fact.updatedAt,
      };
      await rawStore.set("facts", fact.id, fact);
      await rawStore.set(
        CLAIM_PROJECTIONS_COLLECTION,
        legacyClaim.id,
        legacyClaim,
      );
      await rawStore.set(CLAIM_PROJECTION_STATUS_COLLECTION, status.id, status);
      const runtime = createRecallProjectionRuntime({
        documentStore: rawStore,
        now: () => NOW,
        persistentScopeProof: { buildId: "projection-build-a" },
      });

      const result = await runtime.ensureScopeIndexed(scope);
      const manifest = await rawStore.get<RecallProjectionManifest>(
        PROJECTION_MANIFESTS_COLLECTION,
        `scope:${scopeToKey({ ...scope, sessionId: undefined })}`,
      );

      expect(result.complete).toBe(false);
      expect(
        await rawStore.get(CLAIM_PROJECTIONS_COLLECTION, legacyClaim.id),
      ).toEqual(legacyClaim);
      expect(manifest?.validatedGeneration).toBeUndefined();
      expect(
        await rawStore.query<ProjectionRepairRecord>(
          PROJECTION_REPAIRS_COLLECTION,
          { sourceMemoryId: fact.id },
        ),
      ).toHaveLength(1);
    }
  });

  it("rebuilds persistent projections when the build identity changes", async () => {
    const rawStore = createInMemoryDocumentStore();
    const firstRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });
    const fact = buildFact({ id: "fact-build-change" });
    await firstRuntime.documentStore.set("facts", fact.id, fact);
    await firstRuntime.ensureScopeIndexed(scope);

    const restartedRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-12T12:00:00.000Z",
      persistentScopeProof: { buildId: "projection-build-b" },
    });
    const result = await restartedRuntime.ensureScopeIndexed(scope);
    const manifest = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      `scope:${scopeToKey({ ...scope, sessionId: undefined })}`,
    );

    expect(result).toMatchObject({ complete: true, indexedSources: 1, skipped: false });
    expect(manifest?.projectionBuildId).toBe("projection-build-b");
    expect(manifest?.validatedGeneration).toBe(manifest?.sourceGeneration);
  });

  it("reanalyzes complete claim history before sealing a new build identity", async () => {
    const rawStore = createInMemoryDocumentStore();
    const oldLanguage = createMarkedLanguageService({
      analyzerVersion: "marked-old-v1",
      equalityPrefix: "old",
      searchTerm: "old-term",
    });
    const oldBuildId = buildRecallProjectionBuildId(oldLanguage);
    if (!oldBuildId) {
      throw new Error("Expected the built-in marked language service to persist.");
    }
    const oldRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      language: oldLanguage,
      now: () => NOW,
      persistentScopeProof: { buildId: oldBuildId },
    });
    const fact = buildFact({ id: "fact-claim-build-change" });
    await oldRuntime.documentStore.set("facts", fact.id, fact);
    await oldRuntime.appendClaim({
      ...scope,
      sourceMemoryId: fact.id,
      subject: fact.subject ?? fact.userId,
      claim: {
        predicateKey: "project.location",
        objectText: "Paris",
        objectEntity: "Paris",
      },
      observedAt: fact.updatedAt,
      ingestedAt: fact.updatedAt,
      evidenceIds: [],
      sourceMessageIds: [],
      extractorVersion: "extractor-v1",
    });
    await oldRuntime.ensureScopeIndexed(scope);
    const oldClaims = await rawStore.query<ClaimProjection>(
      CLAIM_PROJECTIONS_COLLECTION,
      { sourceMemoryId: fact.id },
    );
    const oldStructured = oldClaims.find(
      ({ predicateKey }) => predicateKey === "project.location",
    );
    expect(oldClaims).toHaveLength(2);
    expect(oldStructured?.objectEntityId).toBeDefined();

    const newLanguage = createMarkedLanguageService({
      analyzerVersion: "marked-new-v1",
      equalityPrefix: "new",
      searchTerm: "new-term",
    });
    const newBuildId = buildRecallProjectionBuildId(newLanguage);
    if (!newBuildId) {
      throw new Error("Expected the rebuilt marked language service to persist.");
    }
    const newRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      language: newLanguage,
      now: () => "2026-07-12T12:00:00.000Z",
      persistentScopeProof: { buildId: newBuildId },
    });

    const rebuilt = await newRuntime.ensureScopeIndexed(scope);
    const newClaims = await rawStore.query<ClaimProjection>(
      CLAIM_PROJECTIONS_COLLECTION,
      { sourceMemoryId: fact.id },
    );
    const newStructured = newClaims.find(
      ({ predicateKey }) => predicateKey === "project.location",
    );
    const manifest = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      `scope:${scopeToKey({ ...scope, sessionId: undefined })}`,
    );

    expect(rebuilt).toMatchObject({ complete: true, skipped: false });
    expect(newClaims).toHaveLength(2);
    expect(newClaims.every((claim) =>
      claim.searchAnalyzerVersion === "marked-new-v1" &&
      claim.searchText === "new-term"
    )).toBe(true);
    expect(newStructured?.subjectEntityId).not.toBe(
      oldStructured?.subjectEntityId,
    );
    expect(newStructured?.objectEntityId).not.toBe(
      oldStructured?.objectEntityId,
    );
    expect(manifest?.projectionBuildId).toBe(newBuildId);
    expect(manifest?.validatedGeneration).toBe(manifest?.sourceGeneration);

    const restartedRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      language: newLanguage,
      persistentScopeProof: { buildId: newBuildId },
    });
    expect(await restartedRuntime.ensureScopeIndexed(scope)).toEqual({
      complete: true,
      indexedSources: 0,
      skipped: true,
    });
  });

  it("replays structured supersession after analyzer slots merge", async () => {
    const rawStore = createInMemoryDocumentStore();
    const oldLanguage = createMarkedLanguageService({
      analyzerVersion: "slot-old-v1",
      normalizeForEquality: (text) => `old:${text}`,
      searchTerm: "old-term",
    });
    const oldBuildId = buildRecallProjectionBuildId(oldLanguage);
    if (!oldBuildId) {
      throw new Error("Expected the old slot analyzer to persist.");
    }
    const firstObservedAt = "2026-07-08T10:00:00.000Z";
    const secondObservedAt = "2026-07-08T11:00:00.000Z";
    const firstFact = {
      ...buildFact({ id: "fact-slot-first" }),
      subject: "Atlas One",
      updatedAt: firstObservedAt,
    };
    const secondFact = {
      ...buildFact({ id: "fact-slot-second" }),
      subject: "Atlas Two",
      updatedAt: secondObservedAt,
    };
    const oldRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      language: oldLanguage,
      persistentScopeProof: { buildId: oldBuildId },
    });
    await oldRuntime.documentStore.set("facts", firstFact.id, firstFact);
    await oldRuntime.appendClaim({
      ...scope,
      sourceMemoryId: firstFact.id,
      subject: firstFact.subject,
      claim: { predicateKey: "project.status", objectText: "planned" },
      observedAt: firstObservedAt,
      ingestedAt: firstObservedAt,
      evidenceIds: [],
      sourceMessageIds: [],
      extractorVersion: "extractor-v1",
    });
    await oldRuntime.documentStore.set("facts", secondFact.id, secondFact);
    await oldRuntime.appendClaim({
      ...scope,
      sourceMemoryId: secondFact.id,
      subject: secondFact.subject,
      claim: { predicateKey: "project.status", objectText: "completed" },
      observedAt: secondObservedAt,
      ingestedAt: secondObservedAt,
      evidenceIds: [],
      sourceMessageIds: [],
      extractorVersion: "extractor-v1",
    });
    await oldRuntime.ensureScopeIndexed(scope);

    const newLanguage = createMarkedLanguageService({
      analyzerVersion: "slot-new-v1",
      normalizeForEquality: (text) =>
        text.startsWith("Atlas") ? "merged-atlas" : `new:${text}`,
      searchTerm: "new-term",
    });
    const newBuildId = buildRecallProjectionBuildId(newLanguage);
    if (!newBuildId) {
      throw new Error("Expected the new slot analyzer to persist.");
    }
    const newRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      language: newLanguage,
      persistentScopeProof: { buildId: newBuildId },
    });

    expect(await newRuntime.ensureScopeIndexed(scope)).toMatchObject({
      complete: true,
      skipped: false,
    });
    const history = await newRuntime.queryClaimHistory(scope);
    const first = history.find(({ sourceMemoryId, predicateKey }) =>
      sourceMemoryId === firstFact.id && predicateKey === "project.status"
    );
    const second = history.find(({ sourceMemoryId, predicateKey }) =>
      sourceMemoryId === secondFact.id && predicateKey === "project.status"
    );
    expect(first?.subjectEntityId).toBe(second?.subjectEntityId);
    expect(first?.validUntil).toBe(secondObservedAt);
    expect(second?.validUntil).toBeUndefined();
  });

  it("rolls back a canonical write when persistent proof invalidation fails", async () => {
    const rawStore = createInMemoryDocumentStore();
    let failManifestWrite = false;
    const failingStore: DocumentStore = {
      projectionBatchSemantics: rawStore.projectionBatchSemantics,
      set: (collection, id, document) => rawStore.set(collection, id, document),
      get: (collection, id) => rawStore.get(collection, id),
      update: (collection, id, patch) => rawStore.update(collection, id, patch),
      query: (collection, filter) => rawStore.query(collection, filter),
      delete: (collection, id) => rawStore.delete(collection, id),
      writeBatchIfUnchanged: async (input) => {
        if (
          failManifestWrite &&
          input.set.some(({ collection }) =>
            collection === PROJECTION_MANIFESTS_COLLECTION
          )
        ) {
          throw new Error("injected manifest transaction failure");
        }
        return rawStore.writeBatchIfUnchanged(input);
      },
    };
    const runtime = createRecallProjectionRuntime({
      documentStore: failingStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });
    const original = buildFact({
      content: "Alice approved the Atlas migration in Berlin.",
    });
    await runtime.documentStore.set("facts", original.id, original);
    await runtime.ensureScopeIndexed(scope);
    const manifestId = `scope:${scopeToKey({ ...scope, sessionId: undefined })}`;
    const manifestBefore = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      manifestId,
    );
    failManifestWrite = true;

    await expect(runtime.documentStore.set("facts", original.id, {
      ...original,
      content: "Alice approved the Atlas migration in Lisbon.",
    })).rejects.toThrow("injected manifest transaction failure");

    expect(await rawStore.get("facts", original.id)).toEqual(original);
    expect(
      await rawStore.get(PROJECTION_MANIFESTS_COLLECTION, manifestId),
    ).toEqual(manifestBefore);
  });

  it("invalidates both recall scopes when an update moves canonical memory", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });
    const fact = buildFact({ id: "fact-scope-move" });
    await runtime.documentStore.set("facts", fact.id, fact);
    await runtime.ensureScopeIndexed(scope);

    await runtime.documentStore.update("facts", fact.id, {
      workspaceId: "workspace-2",
    });

    const oldManifest = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      `scope:${scopeToKey({ ...scope, sessionId: undefined })}`,
    );
    const newManifest = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      `scope:${scopeToKey({
        ...scope,
        sessionId: undefined,
        workspaceId: "workspace-2",
      })}`,
    );
    expect(oldManifest?.validatedGeneration).not.toBe(
      oldManifest?.sourceGeneration,
    );
    expect(newManifest?.validatedGeneration).not.toBe(
      newManifest?.sourceGeneration,
    );
    expect(await runtime.ensureScopeIndexed(scope)).toMatchObject({
      complete: true,
    });
    expect(await runtime.queryClaims(scope)).toEqual([]);
  });

  it("invalidates persistent proof when canonical memory is deleted", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });
    const fact = buildFact({ id: "fact-delete-proof" });
    await runtime.documentStore.set("facts", fact.id, fact);
    await runtime.ensureScopeIndexed(scope);

    await runtime.documentStore.delete("facts", fact.id);

    const manifest = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      `scope:${scopeToKey({ ...scope, sessionId: undefined })}`,
    );
    expect(manifest?.validatedGeneration).not.toBe(manifest?.sourceGeneration);
  });

  it("allows deletion-owned manifest invalidation under the scope lock", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });
    const fact = buildFact({ id: "fact-scope-lock-delete" });
    await runtime.documentStore.set("facts", fact.id, fact);
    await runtime.ensureScopeIndexed(scope);
    const recallScope = { ...scope, sessionId: undefined };

    await expect(runtime.scopeDeletion.runExclusive(recallScope, () =>
      runtime.documentStore.delete("facts", fact.id)
    )).resolves.toBeUndefined();

    expect(await rawStore.get("facts", fact.id)).toBeNull();
    const manifest = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      `scope:${scopeToKey({ ...scope, sessionId: undefined })}`,
    );
    expect(manifest?.validatedGeneration).not.toBe(manifest?.sourceGeneration);
  });

  it("rejects standalone manifest validation while scope deletion owns the lock", async () => {
    const rawStore = createInMemoryDocumentStore();
    const firstRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });
    const fact = buildFact({ id: "fact-scope-lock-validation" });
    await firstRuntime.documentStore.set("facts", fact.id, fact);
    await firstRuntime.ensureScopeIndexed(scope);
    const manifestId = `scope:${scopeToKey({ ...scope, sessionId: undefined })}`;
    const sealed = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      manifestId,
    );
    const secondRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-b" },
    });
    const recallScope = { ...scope, sessionId: undefined };

    await firstRuntime.scopeDeletion.runExclusive(recallScope, async () => {
      await expect(
        secondRuntime.ensureScopeIndexed(recallScope),
      ).rejects.toThrow("Memory deletion is in progress");
    });

    expect(
      await rawStore.get(PROJECTION_MANIFESTS_COLLECTION, manifestId),
    ).toEqual(sealed);
  });

  it("invalidates persistent proof for canonical conditional deletes only on commit", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });
    const fact = buildFact({ id: "fact-conditional-delete" });
    await runtime.documentStore.set("facts", fact.id, fact);
    await runtime.ensureScopeIndexed(scope);
    const manifestId = `scope:${scopeToKey({ ...scope, sessionId: undefined })}`;
    const sealed = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      manifestId,
    );

    const rejected = await runtime.documentStore.writeBatchIfUnchanged({
      expected: { collection: "facts", document: null, id: fact.id },
      set: [],
      delete: [{ collection: "facts", id: fact.id }],
    });
    expect(rejected).toBe(false);
    expect(
      await rawStore.get(PROJECTION_MANIFESTS_COLLECTION, manifestId),
    ).toEqual(sealed);

    const committed = await runtime.documentStore.writeBatchIfUnchanged({
      expected: { collection: "facts", document: fact, id: fact.id },
      set: [],
      delete: [{ collection: "facts", id: fact.id }],
    });
    const dirty = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      manifestId,
    );
    expect(committed).toBe(true);
    expect(dirty?.validatedGeneration).not.toBe(dirty?.sourceGeneration);
  });

  it("cleans projections after a canonical conditional delete without persistent proof", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
    });
    const fact = buildFact({ id: "fact-default-conditional-delete" });
    await runtime.documentStore.set("facts", fact.id, fact);
    expect(await runtime.queryDocuments(scope)).not.toEqual([]);

    const committed = await runtime.documentStore.writeBatchIfUnchanged({
      expected: { collection: "facts", document: fact, id: fact.id },
      set: [],
      delete: [{ collection: "facts", id: fact.id }],
    });

    expect(committed).toBe(true);
    expect(await rawStore.get("facts", fact.id)).toBeNull();
    expect(await runtime.queryDocuments(scope)).toEqual([]);
    expect(await runtime.queryClaims(scope)).toEqual([]);
  });

  it("invalidates persistent proof when immutable evidence changes", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });
    const fact = buildFact({ id: "fact-evidence-proof" });
    await runtime.documentStore.set("facts", fact.id, fact);
    await runtime.ensureScopeIndexed(scope);
    const evidence = createEvidenceRecord({
      ...scope,
      id: "evidence-proof",
      kind: "conversation_excerpt",
      excerpt: "Alice approved the Atlas migration.",
      linkedMemoryIds: [fact.id],
      source: {
        method: "explicit",
        extractedAt: NOW,
      },
    });

    await runtime.documentStore.set(EVIDENCE_COLLECTION, evidence.id, evidence);

    const manifest = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      `scope:${scopeToKey({ ...scope, sessionId: undefined })}`,
    );
    expect(manifest?.validatedGeneration).not.toBe(manifest?.sourceGeneration);
  });

  it("cannot seal the generation scanned before a concurrent canonical write", async () => {
    const rawStore = createInMemoryDocumentStore();
    const fact = buildFact({ id: "fact-before-scan" });
    await rawStore.set("facts", fact.id, fact);
    let releaseFactQuery = () => {};
    let signalFactQuery = () => {};
    const factQueryStarted = new Promise<void>((resolve) => {
      signalFactQuery = resolve;
    });
    const factQueryRelease = new Promise<void>((resolve) => {
      releaseFactQuery = resolve;
    });
    let pauseFactQuery = true;
    const delayedStore: DocumentStore = {
      projectionBatchSemantics: rawStore.projectionBatchSemantics,
      set: (collection, id, document) => rawStore.set(collection, id, document),
      get: (collection, id) => rawStore.get(collection, id),
      update: (collection, id, patch) => rawStore.update(collection, id, patch),
      async query(collection, filter) {
        if (collection === "facts" && pauseFactQuery) {
          pauseFactQuery = false;
          signalFactQuery();
          await factQueryRelease;
        }
        return rawStore.query(collection, filter);
      },
      delete: (collection, id) => rawStore.delete(collection, id),
      writeBatchIfUnchanged: (input) => rawStore.writeBatchIfUnchanged(input),
    };
    const indexingRuntime = createRecallProjectionRuntime({
      documentStore: delayedStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });
    const writingRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });

    const indexing = indexingRuntime.ensureScopeIndexed(scope);
    await factQueryStarted;
    const concurrent = buildFact({ id: "fact-during-scan" });
    await writingRuntime.documentStore.set("facts", concurrent.id, concurrent);
    releaseFactQuery();
    const result = await indexing;
    const manifest = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      `scope:${scopeToKey({ ...scope, sessionId: undefined })}`,
    );

    expect(result.complete).toBe(false);
    expect(manifest?.validatedGeneration).not.toBe(manifest?.sourceGeneration);
  });

  it("fences older build projection writes after a newer generation seals", async () => {
    const rawStore = createInMemoryDocumentStore();
    const fact = buildFact({ id: "fact-build-race" });
    await rawStore.set("facts", fact.id, fact);
    let releaseOldProjection = () => {};
    let signalOldProjection = () => {};
    const oldProjectionStarted = new Promise<void>((resolve) => {
      signalOldProjection = resolve;
    });
    const oldProjectionRelease = new Promise<void>((resolve) => {
      releaseOldProjection = resolve;
    });
    let pauseOldProjection = true;
    const delayedOldStore: DocumentStore = {
      projectionBatchSemantics: rawStore.projectionBatchSemantics,
      set: (collection, id, document) => rawStore.set(collection, id, document),
      get: (collection, id) => rawStore.get(collection, id),
      update: (collection, id, patch) => rawStore.update(collection, id, patch),
      query: (collection, filter) => rawStore.query(collection, filter),
      delete: (collection, id) => rawStore.delete(collection, id),
      async writeBatchIfUnchanged(input) {
        if (
          pauseOldProjection &&
          input.set.some(({ collection }) =>
            collection === RECALL_DOCUMENTS_COLLECTION
          )
        ) {
          pauseOldProjection = false;
          signalOldProjection();
          await oldProjectionRelease;
        }
        return rawStore.writeBatchIfUnchanged(input);
      },
    };
    const oldRuntime = createRecallProjectionRuntime({
      documentStore: delayedOldStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-old" },
    });
    const newRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-12T12:00:00.000Z",
      persistentScopeProof: { buildId: "projection-build-new" },
    });

    const oldIndexing = oldRuntime.ensureScopeIndexed(scope);
    await oldProjectionStarted;
    expect(await newRuntime.ensureScopeIndexed(scope)).toMatchObject({
      complete: true,
    });
    releaseOldProjection();
    expect(await oldIndexing).toMatchObject({ complete: false });
    const manifest = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      `scope:${scopeToKey({ ...scope, sessionId: undefined })}`,
    );
    const recallDocuments = await rawStore.query<RecallIndexDocument>(
      RECALL_DOCUMENTS_COLLECTION,
      { sourceMemoryId: fact.id },
    );

    expect(manifest?.projectionBuildId).toBe("projection-build-new");
    expect(manifest?.validatedGeneration).toBe(manifest?.sourceGeneration);
    expect(recallDocuments.length).toBeGreaterThan(0);
    expect(
      recallDocuments.every(
        ({ indexedAt }) => indexedAt === "2026-07-12T12:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("fences stale repairs after a newer generation seals", async () => {
    const rawStore = createInMemoryDocumentStore();
    const fact = buildFact({ id: "fact-stale-repair-race" });
    await rawStore.set("facts", fact.id, fact);
    let releaseOldProjection = () => {};
    let signalOldProjection = () => {};
    const oldProjectionStarted = new Promise<void>((resolve) => {
      signalOldProjection = resolve;
    });
    const oldProjectionRelease = new Promise<void>((resolve) => {
      releaseOldProjection = resolve;
    });
    let failOldProjection = true;
    const delayedOldStore: DocumentStore = {
      projectionBatchSemantics: rawStore.projectionBatchSemantics,
      set: (collection, id, document) => rawStore.set(collection, id, document),
      get: (collection, id) => rawStore.get(collection, id),
      update: (collection, id, patch) => rawStore.update(collection, id, patch),
      query: (collection, filter) => rawStore.query(collection, filter),
      delete: (collection, id) => rawStore.delete(collection, id),
      async writeBatchIfUnchanged(input) {
        if (
          failOldProjection &&
          input.set.some(({ collection }) =>
            collection === RECALL_DOCUMENTS_COLLECTION
          )
        ) {
          failOldProjection = false;
          signalOldProjection();
          await oldProjectionRelease;
          throw new Error("old projection failed after the new build sealed");
        }
        return rawStore.writeBatchIfUnchanged(input);
      },
    };
    const oldRuntime = createRecallProjectionRuntime({
      documentStore: delayedOldStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-old" },
    });
    const newRuntime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => "2026-07-12T12:00:00.000Z",
      persistentScopeProof: { buildId: "projection-build-new" },
    });

    const oldIndexing = oldRuntime.ensureScopeIndexed(scope);
    await oldProjectionStarted;
    expect(await newRuntime.ensureScopeIndexed(scope)).toMatchObject({
      complete: true,
    });
    releaseOldProjection();
    expect(await oldIndexing).toMatchObject({ complete: false });
    expect(
      await rawStore.query(PROJECTION_REPAIRS_COLLECTION, {
        sourceMemoryId: fact.id,
      }),
    ).toEqual([]);
    expect(await oldRuntime.repairPending(scope)).toBe(0);
    const manifest = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      `scope:${scopeToKey({ ...scope, sessionId: undefined })}`,
    );
    const recallDocuments = await rawStore.query<RecallIndexDocument>(
      RECALL_DOCUMENTS_COLLECTION,
      { sourceMemoryId: fact.id },
    );

    expect(manifest?.projectionBuildId).toBe("projection-build-new");
    expect(manifest?.validatedGeneration).toBe(manifest?.sourceGeneration);
    expect(
      recallDocuments.every(
        ({ indexedAt }) => indexedAt === "2026-07-12T12:00:00.000Z",
      ),
    ).toBe(true);
    expect(await newRuntime.ensureScopeIndexed(scope)).toMatchObject({
      complete: true,
      indexedSources: 0,
      skipped: true,
    });
  });

  it("does not seal persistent proof while a projection repair is pending", async () => {
    const rawStore = createInMemoryDocumentStore();
    const fact = buildFact({ id: "fact-pending-proof" });
    await rawStore.set("facts", fact.id, fact);
    const repair: ProjectionRepairRecord = {
      ...scope,
      id: `facts:${fact.id}:recall`,
      schemaVersion: 1,
      scopeKey: scopeToKey(scope),
      sourceCollection: "facts",
      sourceMemoryId: fact.id,
      attempts: 1,
      firstFailedAt: NOW,
      lastFailedAt: NOW,
      lastError: "pending repair",
      target: "recall",
    };
    await rawStore.set(PROJECTION_REPAIRS_COLLECTION, repair.id, repair);
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });

    const result = await runtime.ensureScopeIndexed(scope);
    const manifest = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      `scope:${scopeToKey({ ...scope, sessionId: undefined })}`,
    );

    expect(result.complete).toBe(false);
    expect(manifest?.validatedGeneration).not.toBe(manifest?.sourceGeneration);
  });

  it("does not seal persistent proof while a claim projection is failed", async () => {
    const rawStore = createInMemoryDocumentStore();
    const fact = buildFact({ id: "fact-failed-claim-proof" });
    await rawStore.set("facts", fact.id, fact);
    const failedStatus: ClaimProjectionStatus = {
      ...scope,
      id: buildClaimProjectionStatusId(scope, fact.id),
      schemaVersion: 1,
      scopeKey: scopeToKey({ ...scope, sessionId: undefined }),
      sourceMemoryId: fact.id,
      state: "failed",
      claimIds: [],
      extractorVersion: "assisted-v1",
      sourceUpdatedAt: fact.updatedAt,
      lastError: "injected claim failure",
      updatedAt: NOW,
    };
    await rawStore.set(
      CLAIM_PROJECTION_STATUS_COLLECTION,
      failedStatus.id,
      failedStatus,
    );
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
      persistentScopeProof: { buildId: "projection-build-a" },
    });

    const result = await runtime.ensureScopeIndexed(scope);
    const manifest = await rawStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      `scope:${scopeToKey({ ...scope, sessionId: undefined })}`,
    );

    expect(result.complete).toBe(false);
    expect(manifest?.validatedGeneration).not.toBe(manifest?.sourceGeneration);
    expect(
      await rawStore.get<ClaimProjectionStatus>(
        CLAIM_PROJECTION_STATUS_COLLECTION,
        failedStatus.id,
      ),
    ).toEqual(failedStatus);
  });

  it("does not rescan all recall documents once per entity during writes", async () => {
    const rawStore = createInMemoryDocumentStore();
    let recallDocumentQueries = 0;
    const countingStore: DocumentStore = {
      projectionBatchSemantics: rawStore.projectionBatchSemantics,
      set: (collection, id, document) => rawStore.set(collection, id, document),
      get: (collection, id) => rawStore.get(collection, id),
      update: (collection, id, patch) => rawStore.update(collection, id, patch),
      async query(collection, filter) {
        if (collection === RECALL_DOCUMENTS_COLLECTION) {
          recallDocumentQueries += 1;
        }
        return rawStore.query(collection, filter);
      },
      delete: (collection, id) => rawStore.delete(collection, id),
      writeBatchIfUnchanged: (input) => rawStore.writeBatchIfUnchanged(input),
    };
    const runtime = createRecallProjectionRuntime({
      documentStore: countingStore,
      now: () => NOW,
    });

    for (let index = 0; index < 12; index += 1) {
      const fact = buildFact({
        id: `fact-${index}`,
        content: `Person${index} approved Project${index} in City${index}.`,
      });
      await runtime.documentStore.set("facts", fact.id, fact);
    }

    // One targeted old-document lookup per source write is enough. An entity
    // implementation that rescans the full projection once per mention blows
    // this budget immediately and becomes quadratic during corpus ingestion.
    expect(recallDocumentQueries).toBeLessThanOrEqual(12);
  });

  it("preserves both direct adjacencies when two memories share an entity concurrently", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
    });
    const first = buildFact({
      id: "fact-concurrent-a",
      content: "Alice approved Atlas in Paris.",
    });
    const second = buildFact({
      id: "fact-concurrent-b",
      content: "Alice reviewed Beacon in Lisbon.",
    });

    await Promise.all([
      runtime.documentStore.set("facts", first.id, first),
      runtime.documentStore.set("facts", second.id, second),
    ]);

    const alice = (await runtime.queryEntities(scope)).find(
      (entity) => entity.canonicalKey === "alice",
    );
    expect(alice?.memoryIds).toEqual([
      "facts:fact-concurrent-a",
      "facts:fact-concurrent-b",
    ]);
  });

  it("canonicalizes one entity across sessions in the same recall scope", async () => {
    const runtime = createRecallProjectionRuntime({
      documentStore: createInMemoryDocumentStore(),
      now: () => NOW,
    });
    const first = buildFact({
      id: "fact-session-a",
      content: "Alice approved Atlas in Paris.",
    });
    const second = {
      ...buildFact({
        id: "fact-session-b",
        content: "Alice reviewed Beacon in Lisbon.",
      }),
      sessionId: "session-2",
    };

    await runtime.documentStore.set("facts", first.id, first);
    await runtime.documentStore.set("facts", second.id, second);

    const alices = (await runtime.queryEntities(scope)).filter(
      (entity) => entity.canonicalKey === "alice",
    );
    expect(alices).toHaveLength(1);
    expect(alices[0]?.memoryIds).toEqual([
      "facts:fact-session-a",
      "facts:fact-session-b",
    ]);
    expect(alices[0]?.scopeKey).toBe(
      scopeToKey({ ...scope, sessionId: undefined }),
    );
    expect(alices[0]?.sessionId).toBeUndefined();
  });

  it("serializes projection replacement when the same memory is written concurrently", async () => {
    const rawStore = createInMemoryDocumentStore();
    const delayedStore = createDelayedOldProjectionStore(rawStore);
    const runtime = createRecallProjectionRuntime({
      documentStore: delayedStore.documentStore,
      now: () => NOW,
    });
    const original = buildFact({
      content: "Alice approved the Atlas migration in Berlin.",
    });
    const replacement = buildFact({
      content: "Alice approved the Atlas migration in Lisbon.",
    });

    const originalWrite = runtime.documentStore.set("facts", original.id, original);
    await delayedStore.oldProjectionStarted;
    const replacementWrite = runtime.documentStore.set(
      "facts",
      replacement.id,
      replacement,
    );
    if (delayedStore.secondCanonicalWriteStarted()) {
      await replacementWrite;
    }
    delayedStore.releaseOldProjection();
    await Promise.all([originalWrite, replacementWrite]);

    const documents = await rawStore.query<RecallIndexDocument>(
      RECALL_DOCUMENTS_COLLECTION,
      { sourceCollection: "facts", sourceMemoryId: original.id },
    );
    expect(documents.length).toBeGreaterThan(0);
    expect(documents.every((document) => !document.text.includes("Berlin"))).toBe(
      true,
    );
    expect(documents.some((document) => document.text.includes("Lisbon"))).toBe(
      true,
    );
  });

  it("converges projection replacement across independent runtime instances", async () => {
    const rawStore = createInMemoryDocumentStore();
    const delayedStore = createDelayedOldProjectionStore(rawStore);
    const firstRuntime = createRecallProjectionRuntime({
      documentStore: delayedStore.documentStore,
      now: () => NOW,
    });
    const secondRuntime = createRecallProjectionRuntime({
      documentStore: delayedStore.documentStore,
      now: () => NOW,
    });
    const original = buildFact({
      content: "Alice approved the Atlas migration in Berlin.",
    });
    const replacement = buildFact({
      content: "Alice approved the Atlas migration in Lisbon.",
    });

    const originalWrite = firstRuntime.documentStore.set(
      "facts",
      original.id,
      original,
    );
    await delayedStore.oldProjectionStarted;
    const replacementWrite = secondRuntime.documentStore.set(
      "facts",
      replacement.id,
      replacement,
    );
    await replacementWrite;
    delayedStore.releaseOldProjection();
    await originalWrite;

    const documents = await rawStore.query<RecallIndexDocument>(
      RECALL_DOCUMENTS_COLLECTION,
      { sourceCollection: "facts", sourceMemoryId: original.id },
    );
    expect(documents.length).toBeGreaterThan(0);
    expect(documents.every((document) => !document.text.includes("Berlin"))).toBe(
      true,
    );
    expect(documents.some((document) => document.text.includes("Lisbon"))).toBe(
      true,
    );
  });

  it("converges a stale delete repair to a memory recreated under the same id", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: createOneShotProjectionDeleteFailureStore(rawStore),
      now: () => NOW,
    });
    const original = buildFact({
      content: "Alice approved the Atlas migration in Berlin.",
    });
    const replacement = buildFact({
      content: "Alice approved the Atlas migration in Lisbon.",
    });

    await runtime.documentStore.set("facts", original.id, original);
    await expect(
      runtime.documentStore.delete("facts", original.id),
    ).rejects.toThrow("projection cleanup is pending");
    await runtime.documentStore.set("facts", replacement.id, replacement);
    expect(await runtime.repairPending(scope)).toBe(1);

    const documents = await rawStore.query<RecallIndexDocument>(
      RECALL_DOCUMENTS_COLLECTION,
      { sourceCollection: "facts", sourceMemoryId: replacement.id },
    );
    expect(documents.length).toBeGreaterThan(0);
    expect(documents.every((document) => !document.text.includes("Berlin"))).toBe(
      true,
    );
    expect(documents.some((document) => document.text.includes("Lisbon"))).toBe(
      true,
    );
  });
});
