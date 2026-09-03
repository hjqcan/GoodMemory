import {
  EXPERIENCES_COLLECTION,
  LEARNING_PROPOSALS_COLLECTION,
  PROMOTION_RECORDS_COLLECTION,
  SESSION_ARCHIVES_COLLECTION,
} from "../domain/evolutionRecords";
import type { MemoryScope } from "../domain/scope";
import { normalizeScope, scopeToKey } from "../domain/scope";
import { EVIDENCE_COLLECTION } from "../evidence/contracts";
import { ARTIFACT_SPILL_COLLECTION } from "../runtime/spillover";
import type { DocumentStore } from "../storage/contracts";
import type { ScopeIndexResult, ScopeSummary } from "./contracts";

// Durable collections whose records carry the scope tuple at the top level.
// Sourced from the exported collection constants where they exist so this list
// tracks the storage layer instead of drifting from it.
const TOP_LEVEL_SCOPE_COLLECTIONS = [
  "facts",
  "feedback",
  "profiles",
  "preferences",
  "references",
  "notes",
  "episodes",
  SESSION_ARCHIVES_COLLECTION,
  EVIDENCE_COLLECTION,
  EXPERIENCES_COLLECTION,
  LEARNING_PROPOSALS_COLLECTION,
  PROMOTION_RECORDS_COLLECTION,
] as const;

// artifact_spills nests the scope under `.scope` (ArtifactSpillRecord).
const NESTED_SCOPE_COLLECTIONS = [ARTIFACT_SPILL_COLLECTION] as const;

const INDEXED_COLLECTIONS: readonly string[] = [
  ...TOP_LEVEL_SCOPE_COLLECTIONS,
  ...NESTED_SCOPE_COLLECTIONS,
];

// Transaction-time fields we treat as record recency. ISO-8601 (…Z) strings
// sort lexicographically, so a plain string max is chronological.
const TIMESTAMP_FIELDS = [
  "updatedAt",
  "decidedAt",
  "archivedAt",
  "createdAt",
] as const;

const SESSION_BLIND_SPOT =
  "Session-only scopes are not listed: the session store (working memory, journals, buffers) has no enumeration primitive and keys its tables on an opaque scope hash.";
const VECTOR_BLIND_SPOT =
  "Vector-only scopes are not listed: the vector store exposes no enumeration primitive.";
const DURABLE_ONLY_BLIND_SPOT =
  "A scope that only ever wrote runtime/session or vector state (never a durable record) is not discoverable in this index.";

export interface ListScopesDeps {
  documentStore: DocumentStore;
  now?: () => Date;
}

interface ScopeAccumulator {
  scope: MemoryScope;
  counts: Record<string, number>;
  totalRecords: number;
  lastUpdatedAt?: string;
}

/**
 * Build a read-only cross-scope index by scanning every durable DocumentStore
 * collection with no filter and de-duplicating the scope tuple on each record
 * via `scopeToKey`. Pure read: it never writes and never constructs a store —
 * the caller injects a (read-only) `documentStore`. Coverage blind spots
 * (session-only / vector-only scopes) are disclosed, not hidden.
 */
export async function listScopes(deps: ListScopesDeps): Promise<ScopeIndexResult> {
  const now = deps.now ?? (() => new Date());
  const accumulators = new Map<string, ScopeAccumulator>();
  const collectionsScanned: string[] = [];
  const blindSpots: string[] = [
    SESSION_BLIND_SPOT,
    VECTOR_BLIND_SPOT,
    DURABLE_ONLY_BLIND_SPOT,
  ];

  for (const collection of INDEXED_COLLECTIONS) {
    let documents: Record<string, unknown>[];
    try {
      documents = await deps.documentStore.query<Record<string, unknown>>(collection);
    } catch (error) {
      blindSpots.push(
        `Collection "${collection}" could not be scanned: ${describeError(error)}`,
      );
      continue;
    }
    collectionsScanned.push(collection);
    const nested = collection === ARTIFACT_SPILL_COLLECTION;

    for (const document of documents) {
      const rawScope = deriveScope(document, nested);
      if (!rawScope) {
        continue;
      }
      let scope: MemoryScope;
      try {
        scope = normalizeScope(rawScope);
      } catch {
        // Missing/empty userId — not an addressable scope.
        continue;
      }
      const key = scopeToKey(scope);
      const accumulator = accumulators.get(key) ?? {
        scope,
        counts: {},
        totalRecords: 0,
      };
      accumulator.counts[collection] = (accumulator.counts[collection] ?? 0) + 1;
      accumulator.totalRecords += 1;
      const timestamp = latestTimestamp(document);
      if (
        timestamp &&
        (!accumulator.lastUpdatedAt || timestamp > accumulator.lastUpdatedAt)
      ) {
        accumulator.lastUpdatedAt = timestamp;
      }
      accumulators.set(key, accumulator);
    }
  }

  const scopes: ScopeSummary[] = [...accumulators.entries()]
    .map(([scopeKey, accumulator]) => ({
      scope: accumulator.scope,
      scopeKey,
      counts: accumulator.counts,
      totalRecords: accumulator.totalRecords,
      ...(accumulator.lastUpdatedAt
        ? { lastUpdatedAt: accumulator.lastUpdatedAt }
        : {}),
    }))
    .sort(
      (left, right) =>
        right.totalRecords - left.totalRecords ||
        left.scopeKey.localeCompare(right.scopeKey),
    );

  return {
    generatedAt: now().toISOString(),
    scopes,
    coverage: {
      collectionsScanned,
      sessionStoreScanned: false,
      vectorStoreScanned: false,
      blindSpots,
    },
  };
}

function deriveScope(
  document: Record<string, unknown>,
  nested: boolean,
): MemoryScope | undefined {
  const source = nested ? document.scope : document;
  if (!source || typeof source !== "object") {
    return undefined;
  }
  const record = source as Record<string, unknown>;
  if (typeof record.userId !== "string") {
    return undefined;
  }
  return {
    userId: record.userId,
    ...(typeof record.tenantId === "string" ? { tenantId: record.tenantId } : {}),
    ...(typeof record.workspaceId === "string"
      ? { workspaceId: record.workspaceId }
      : {}),
    ...(typeof record.agentId === "string" ? { agentId: record.agentId } : {}),
    ...(typeof record.sessionId === "string" ? { sessionId: record.sessionId } : {}),
  };
}

function latestTimestamp(document: Record<string, unknown>): string | undefined {
  let latest: string | undefined;
  for (const field of TIMESTAMP_FIELDS) {
    const value = document[field];
    if (typeof value === "string" && value.length > 0 && (!latest || value > latest)) {
      latest = value;
    }
  }
  return latest;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
