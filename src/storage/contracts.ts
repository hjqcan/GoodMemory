import type {
  SessionBuffer,
  SessionJournal,
  WorkingMemorySnapshot,
} from "../domain/records";
import type { MemoryScope } from "../domain/scope";

export type StorageDocument = object;
export type StorageFilter = Record<string, unknown>;

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

export interface ConditionalDocumentWriteBatch {
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

export interface SessionStore {
  saveBuffer(scope: MemoryScope, buffer: SessionBuffer): Promise<void>;
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
