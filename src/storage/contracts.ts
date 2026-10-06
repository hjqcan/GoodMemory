import type {
  SessionBuffer,
  SessionJournal,
  WorkingMemorySnapshot,
} from "../domain/records";
import type { MemoryScope } from "../domain/scope";

export type StorageDocument = object;
export type StorageFilter = Record<
  string,
  boolean | number | string | null
>;

export const PROJECTION_BATCH_SEMANTICS = "unchanged-delete-v1" as const;

export interface DocumentQueryPageInput {
  cursor?: string;
  filter?: StorageFilter;
  limit: number;
}

export interface DocumentQueryPage<
  TDocument extends StorageDocument = StorageDocument,
> {
  items: TDocument[];
  nextCursor?: string;
}

export interface DocumentTextSearchInput {
  field: string;
  filter?: StorageFilter;
  limit: number;
  query: string;
}

export interface DocumentTextSearchResult<
  TDocument extends StorageDocument = StorageDocument,
> {
  document: TDocument;
  id: string;
  score: number;
}

export interface DocumentWriteOperation<
  TDocument extends StorageDocument = StorageDocument,
> {
  collection: string;
  id: string;
  document: TDocument;
}

export const QUERY_SNAPSHOT_BATCH_SEMANTICS = "exact-query-snapshot-v1" as const;

export interface ConditionalDocumentQuerySnapshot {
  collection: string;
  documents: StorageDocument[];
  filter?: StorageFilter;
}

export function matchesDocumentQuerySnapshot(
  current: StorageDocument[],
  expected: StorageDocument[],
): boolean {
  const serialize = (documents: StorageDocument[]) => documents.map(document => JSON.stringify(document)).sort();
  return JSON.stringify(serialize(current)) === JSON.stringify(serialize(expected));
}

export interface ConditionalDocumentWriteBatch {
  /** Requires QUERY_SNAPSHOT_BATCH_SEMANTICS; checked inside the write transaction. */
  querySnapshots?: ConditionalDocumentQuerySnapshot[];
  delete?: Array<{
    collection: string;
    id: string;
  }>;
  expected: {
    collection: string;
    document: StorageDocument | null;
    id: string;
  };
  set: DocumentWriteOperation[];
  unchanged?: Array<{
    collection: string;
    document: StorageDocument | null;
    id: string;
  }>;
}

export interface DocumentStore {
  querySnapshotBatchSemantics?: typeof QUERY_SNAPSHOT_BATCH_SEMANTICS;
  projectionBatchSemantics?: string;
  set<TDocument extends StorageDocument>(
    collection: string,
    id: string,
    document: TDocument,
  ): Promise<void>;
  get<TDocument extends StorageDocument>(
    collection: string,
    id: string,
  ): Promise<TDocument | null>;
  update<TDocument extends StorageDocument>(
    collection: string,
    id: string,
    patch: Partial<TDocument>,
  ): Promise<void>;
  query<TDocument extends StorageDocument>(
    collection: string,
    filter?: StorageFilter,
  ): Promise<TDocument[]>;
  queryPage?<TDocument extends StorageDocument>(
    collection: string,
    input: DocumentQueryPageInput,
  ): Promise<DocumentQueryPage<TDocument>>;
  searchText?<TDocument extends StorageDocument>(
    collection: string,
    input: DocumentTextSearchInput,
  ): Promise<DocumentTextSearchResult<TDocument>[]>;
  writeBatchIfUnchanged?(input: ConditionalDocumentWriteBatch): Promise<boolean>;
  delete(collection: string, id: string): Promise<void>;
}

export interface ProjectionCapableDocumentStore extends DocumentStore {
  projectionBatchSemantics: typeof PROJECTION_BATCH_SEMANTICS;
  scopeMutationFenceIdentity?: object;
  writeBatchIfUnchanged(input: ConditionalDocumentWriteBatch): Promise<boolean>;
}

export function isProjectionCapableDocumentStore(
  store: DocumentStore,
): store is ProjectionCapableDocumentStore {
  return store.projectionBatchSemantics === PROJECTION_BATCH_SEMANTICS &&
    typeof store.writeBatchIfUnchanged === "function";
}

export function assertDocumentQueryPageInput(
  input: DocumentQueryPageInput,
): void {
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
    throw new Error("Document query page limit must be a positive integer.");
  }
  assertStorageFilter(input.filter);
}

export function assertDocumentTextSearchInput(
  input: DocumentTextSearchInput,
): void {
  if (input.field.trim().length === 0) {
    throw new Error("Document text search field must be non-empty.");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
    throw new Error("Document text search limit must be a positive integer.");
  }
  assertStorageFilter(input.filter);
}

export function assertStorageFilter(filter?: StorageFilter): void {
  for (const value of Object.values(filter ?? {}) as unknown[]) {
    if (
      value !== null &&
      typeof value !== "boolean" &&
      typeof value !== "string" &&
      (typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new Error("Storage filters only support scalar equality values.");
    }
  }
}

export interface VectorRecord {
  id: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  content: string;
}

export interface VectorSearchInput {
  topK: number;
  filter?: StorageFilter;
}

export interface VectorSearchResult extends VectorRecord {
  score: number;
}

export interface VectorStore {
  upsert(collection: string, records: VectorRecord[]): Promise<void>;
  get(collection: string, id: string): Promise<VectorRecord | null>;
  search(
    collection: string,
    queryEmbedding: number[],
    input: VectorSearchInput,
  ): Promise<VectorSearchResult[]>;
  delete(collection: string, id: string): Promise<void>;
}

export type SessionStateKind = "buffer" | "working_memory" | "journal";

/** Legacy key metadata only. Payloads require an externally verified owner. */
export interface LegacySessionScope {
  kind: SessionStateKind;
  legacyKey: string;
  /** Present only when the legacy encoding proves a unique normalized owner. */
  scope: MemoryScope | null;
  /** A durable resolution. Normal owner deletion also erases the original payload. */
  resolvedTo: MemoryScope | null;
}

export type RecoverLegacySessionStateInput = {
  legacyKey: string;
  scope: MemoryScope;
} & (
  | { kind: "buffer"; expectedValue: SessionBuffer }
  | { kind: "working_memory"; expectedValue: WorkingMemorySnapshot }
  | { kind: "journal"; expectedValue: SessionJournal }
);

export interface SessionStore {
  /** Inspect preserved legacy keys without exposing their payloads or mutating. */
  listLegacyScopes?(): Promise<LegacySessionScope[]>;
  /**
   * Explicit trusted ownership assertion. The caller must independently verify
   * the full scope and original payload. Atomically claims one owner per legacy
   * key/state kind, preserves the original until normal owner deletion, and
   * never replaces a differing v2
   * target. Returns false on an owner, original, or target conflict. Repeating
   * the same claim succeeds only while the original and target remain unchanged.
   * Invalid claim metadata throws LegacyScopeKeyError. Owner deletion also
   * refuses to erase an original changed after its durable ownership claim.
   */
  recoverLegacyState?(input: RecoverLegacySessionStateInput): Promise<boolean>;
  saveBuffer(scope: MemoryScope, buffer: SessionBuffer): Promise<void>;
  saveBufferIfUnchanged(
    scope: MemoryScope,
    expectedBuffer: SessionBuffer | null,
    nextBuffer: SessionBuffer,
  ): Promise<boolean>;
  getBuffer(scope: MemoryScope): Promise<SessionBuffer | null>;
  deleteBufferIfUnchanged(
    scope: MemoryScope,
    expectedBuffer: SessionBuffer,
  ): Promise<boolean>;
  deleteBuffersByScope(scope: MemoryScope): Promise<number>;
  saveWorkingMemory(
    scope: MemoryScope,
    snapshot: WorkingMemorySnapshot,
  ): Promise<void>;
  getWorkingMemory(scope: MemoryScope): Promise<WorkingMemorySnapshot | null>;
  deleteWorkingMemoryByScope(scope: MemoryScope): Promise<number>;
  saveJournal(scope: MemoryScope, journal: SessionJournal): Promise<void>;
  getJournal(scope: MemoryScope): Promise<SessionJournal | null>;
  deleteJournalsByScope(scope: MemoryScope): Promise<number>;
}

export function matchesFilter(
  document: StorageDocument,
  filter?: StorageFilter,
): boolean {
  if (!filter) {
    return true;
  }

  const record = document as Record<string, unknown>;

  return Object.entries(filter).every(([key, value]) => record[key] === value);
}

export function shallowMergeDocument<TDocument extends StorageDocument>(
  base: TDocument,
  patch: Partial<TDocument>,
): TDocument {
  return {
    ...base,
    ...patch,
  };
}
