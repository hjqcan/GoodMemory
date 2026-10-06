import type {
  SessionBuffer,
  SessionJournal,
  WorkingMemorySnapshot,
} from "../domain/records";
import type { MemoryScope } from "../domain/scope";
import {
  listLegacySessionScopes,
  planLegacySessionRecovery,
  planSessionDelete,
  planSessionDeleteByScope,
  planSessionSet,
  readSessionValue,
  type CompatibleSessionStateStore,
  type SessionStatePlan,
} from "./sessionScopeKeys";
import type {
  ConditionalDocumentWriteBatch,
  DocumentQueryPageInput,
  DocumentStore,
  ProjectionCapableDocumentStore,
  DocumentTextSearchInput,
  SessionStore,
  StorageDocument,
  StorageFilter,
  VectorRecord,
  VectorSearchResult,
  VectorStore,
} from "./contracts";
import {
  PROJECTION_BATCH_SEMANTICS,
  QUERY_SNAPSHOT_BATCH_SEMANTICS,
  assertDocumentQueryPageInput,
  assertDocumentTextSearchInput,
  matchesFilter,
  matchesDocumentQuerySnapshot,
  shallowMergeDocument,
} from "./contracts";
import {
  readDocumentSearchText,
  scoreDocumentSearch,
} from "./textSearch";

function clone<TValue>(value: TValue): TValue {
  return structuredClone(value);
}

function documentsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createInMemoryDocumentStore(): ProjectionCapableDocumentStore {
  const collections = new Map<string, Map<string, StorageDocument>>();

  function getCollection(collection: string): Map<string, StorageDocument> {
    const existing = collections.get(collection);
    if (existing) {
      return existing;
    }

    const created = new Map<string, StorageDocument>();
    collections.set(collection, created);
    return created;
  }

  return {
    projectionBatchSemantics: PROJECTION_BATCH_SEMANTICS,
    querySnapshotBatchSemantics: QUERY_SNAPSHOT_BATCH_SEMANTICS,
    async set<TDocument extends StorageDocument>(
      collection: string,
      id: string,
      document: TDocument,
    ) {
      getCollection(collection).set(id, clone(document));
    },

    async get<TDocument extends StorageDocument>(collection: string, id: string) {
      const document = getCollection(collection).get(id);
      return document ? (clone(document) as TDocument) : null;
    },

    async update<TDocument extends StorageDocument>(
      collection: string,
      id: string,
      patch: Partial<TDocument>,
    ) {
      const documents = getCollection(collection);
      const current = documents.get(id);

      if (!current) {
        throw new Error(`Document not found for update: ${collection}/${id}`);
      }

      documents.set(id, clone(shallowMergeDocument(current, patch)));
    },

    async query<TDocument extends StorageDocument>(
      collection: string,
      filter?: StorageFilter,
    ) {
      return [...getCollection(collection).values()]
        .filter((document) => matchesFilter(document, filter))
        .map((document) => clone(document) as TDocument);
    },

    async queryPage<TDocument extends StorageDocument>(
      collection: string,
      input: DocumentQueryPageInput,
    ) {
      assertDocumentQueryPageInput(input);
      const matches = [...getCollection(collection).entries()]
        .filter(
          ([id, document]) =>
            (input.cursor === undefined || id > input.cursor) &&
            matchesFilter(document, input.filter),
        )
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
      const page = matches.slice(0, input.limit);
      return {
        items: page.map(([, document]) => clone(document) as TDocument),
        ...(matches.length > input.limit
          ? { nextCursor: page.at(-1)![0] }
          : {}),
      };
    },

    async searchText<TDocument extends StorageDocument>(
      collection: string,
      input: DocumentTextSearchInput,
    ) {
      assertDocumentTextSearchInput(input);
      if (input.query.trim().length === 0) {
        return [];
      }
      return [...getCollection(collection).entries()]
        .filter(([, document]) => matchesFilter(document, input.filter))
        .map(([id, document]) => ({
          document,
          id,
          score: scoreDocumentSearch(
            input.query,
            readDocumentSearchText(document, input.field) ?? "",
          ),
        }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
        .slice(0, input.limit)
        .map(({ document, ...result }) => ({
          ...result,
          document: clone(document) as TDocument,
        }));
    },

    async writeBatchIfUnchanged(input: ConditionalDocumentWriteBatch) {
      for (const snapshot of input.querySnapshots ?? []) {
        const current = [...getCollection(snapshot.collection).values()]
          .filter(document => matchesFilter(document, snapshot.filter));
        if (!matchesDocumentQuerySnapshot(current, snapshot.documents)) return false;
      }
      const expectations = [input.expected, ...(input.unchanged ?? [])];
      if (expectations.some((expected) => {
        const current = getCollection(expected.collection).get(expected.id);
        return expected.document === null
          ? current !== undefined
          : current === undefined || !documentsEqual(current, expected.document);
      })) {
        return false;
      }

      for (const operation of input.set) {
        getCollection(operation.collection).set(
          operation.id,
          clone(operation.document),
        );
      }

      for (const operation of input.delete ?? []) {
        getCollection(operation.collection).delete(operation.id);
      }

      return true;
    },

    async delete(collection, id) {
      getCollection(collection).delete(id);
    },
  };
}

function createScopedMapStore<TValue>(): CompatibleSessionStateStore<TValue> {
  const records = new Map<string, string>();

  function apply<T>(plan: SessionStatePlan<T>): T {
    for (const [key, value] of plan.set) records.set(key, value);
    for (const key of plan.delete) records.delete(key);
    return plan.result;
  }

  return {
    async set(scope, value) {
      apply(planSessionSet(records, scope, value));
    },
    async setIfUnchanged(scope, expectedValue, nextValue) {
      return apply(planSessionSet(records, scope, nextValue, { value: expectedValue }));
    },
    async get(scope) {
      return readSessionValue<TValue>(records, scope);
    },
    async deleteIfUnchanged(scope, expectedValue) {
      return apply(planSessionDelete(records, scope, expectedValue));
    },
    async deleteByScope(scope) {
      return apply(planSessionDeleteByScope(records, scope));
    },
    async listLegacyScopes(kind) {
      return listLegacySessionScopes(records, kind);
    },
    async recoverLegacyState(scope, legacyKey, expected) {
      return apply(planLegacySessionRecovery(records, scope, legacyKey, expected));
    },
  };
}

export function createInMemorySessionStore(): SessionStore {
  const buffers = createScopedMapStore<SessionBuffer>();
  const workingMemory = createScopedMapStore<WorkingMemorySnapshot>();
  const journals = createScopedMapStore<SessionJournal>();

  return {
    async listLegacyScopes() {
      return (await Promise.all([
        buffers.listLegacyScopes("buffer"),
        workingMemory.listLegacyScopes("working_memory"),
        journals.listLegacyScopes("journal"),
      ])).flat();
    },

    recoverLegacyState(input) {
      switch (input.kind) {
        case "buffer":
          return buffers.recoverLegacyState(input.scope, input.legacyKey, input.expectedValue);
        case "working_memory":
          return workingMemory.recoverLegacyState(input.scope, input.legacyKey, input.expectedValue);
        case "journal":
          return journals.recoverLegacyState(input.scope, input.legacyKey, input.expectedValue);
      }
    },
    saveBuffer(scope, buffer) {
      return buffers.set(scope, buffer);
    },

    saveBufferIfUnchanged(scope, expectedBuffer, nextBuffer) {
      return buffers.setIfUnchanged(scope, expectedBuffer, nextBuffer);
    },

    getBuffer(scope) {
      return buffers.get(scope);
    },

    deleteBufferIfUnchanged(scope, expectedBuffer) {
      return buffers.deleteIfUnchanged(scope, expectedBuffer);
    },

    deleteBuffersByScope(scope) {
      return buffers.deleteByScope(scope);
    },

    saveWorkingMemory(scope, snapshot) {
      return workingMemory.set(scope, snapshot);
    },

    getWorkingMemory(scope) {
      return workingMemory.get(scope);
    },

    deleteWorkingMemoryByScope(scope) {
      return workingMemory.deleteByScope(scope);
    },

    saveJournal(scope, journal) {
      return journals.set(scope, journal);
    },

    getJournal(scope) {
      return journals.get(scope);
    },

    deleteJournalsByScope(scope) {
      return journals.deleteByScope(scope);
    },
  };
}

function scoreDotProduct(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let score = 0;

  for (let index = 0; index < length; index += 1) {
    score += left[index]! * right[index]!;
  }

  return score;
}

export function createInMemoryVectorStore(): VectorStore {
  const collections = new Map<string, Map<string, VectorRecord>>();

  function getCollection(collection: string): Map<string, VectorRecord> {
    const existing = collections.get(collection);
    if (existing) {
      return existing;
    }

    const created = new Map<string, VectorRecord>();
    collections.set(collection, created);
    return created;
  }

  return {
    async upsert(collection, records) {
      const vectors = getCollection(collection);

      for (const record of records) {
        vectors.set(record.id, clone(record));
      }
    },

    async get(collection, id) {
      const record = getCollection(collection).get(id);
      return record ? clone(record) : null;
    },

    async search(collection, queryEmbedding, input) {
      const scored = [...getCollection(collection).values()]
        .filter((record) => matchesFilter(record.metadata, input.filter))
        .map((record) => ({
          record,
          score: scoreDotProduct(record.embedding, queryEmbedding),
        }))
        .sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }

          return left.record.id.localeCompare(right.record.id);
        });

      return scored
        .slice(0, input.topK)
        .map<VectorSearchResult>(({ record, score }) => ({
          ...clone(record),
          score,
        }));
    },

    async delete(collection, id) {
      getCollection(collection).delete(id);
    },
  };
}
