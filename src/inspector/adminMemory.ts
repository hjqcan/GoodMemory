import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import type { MemoryScope } from "../domain/scope";
import { normalizeScope, scopeToKey } from "../domain/scope";
import { SESSION_ARCHIVES_COLLECTION } from "../domain/evolutionRecords";
import {
  PROJECTION_SEARCH_SCHEMA_VERSION,
  RECALL_PROJECTION_PIPELINE_VERSION,
  SCOPE_CATALOG_COLLECTION,
  type ScopeCatalogProjection,
} from "../recall/projections/contracts";
import type { DocumentStore } from "../storage/contracts";
import { listScopes } from "./scopeIndex";
import { sanitizeViewerValue } from "./redaction";

const MEMORY_COLLECTIONS = [
  "episodes",
  "facts",
  "feedback",
  "preferences",
  "profiles",
  "references",
  SESSION_ARCHIVES_COLLECTION,
] as const;
const SCOPE_CATALOG_MIGRATION_ID = "migration:durable-v1";
const SCOPE_CATALOG_PAGE_SIZE = 200;

export type AdminMemoryCollection = (typeof MEMORY_COLLECTIONS)[number];

interface MemoryCursor {
  collection: AdminMemoryCollection;
  id: string;
}

export class InvalidAdminMemoryCursorError extends Error {
  constructor() {
    super("Memory cursor is invalid.");
    this.name = "InvalidAdminMemoryCursorError";
  }
}

interface StoredMemory {
  collection: AdminMemoryCollection;
  document: Record<string, unknown>;
  id: string;
  scope: MemoryScope;
}

export interface AdminMemoryItem {
  collection: AdminMemoryCollection;
  createdAt?: string;
  details: Record<string, unknown>;
  etag: string;
  id: string;
  lifecycle?: string;
  memoryType: string;
  revisable: boolean;
  summary: string;
  supersededBy?: string | null;
  updatedAt?: string;
}

export interface AdminScopeItem {
  counts: Record<string, number>;
  coverage: "complete" | "partial";
  etag: string;
  lastUpdatedAt?: string;
  scope: MemoryScope;
  scopeKey: string;
  totalRecords: number;
}

export function createEntityTag(value: unknown): string {
  return `"${createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`;
}

export async function listAdminScopes(input: {
  cursor?: string;
  documentStore: DocumentStore;
  limit: number;
  now?: () => Date;
}): Promise<{ items: AdminScopeItem[]; nextCursor?: string }> {
  const now = input.now ?? (() => new Date());
  await ensureHistoricalScopeCatalog(input.documentStore, now);
  const catalogs = await readScopeCatalogPage({
    cursor: input.cursor,
    documentStore: input.documentStore,
    limit: input.limit + 1,
  });
  const page = catalogs.slice(0, input.limit);
  const items = await Promise.all(
    page.map((catalog) => buildAdminScopeItem(input.documentStore, catalog)),
  );
  return {
    items,
    ...(catalogs.length > input.limit
      ? { nextCursor: page.at(-1)!.scopeKey }
      : {}),
  };
}

export async function findAdminScope(input: {
  documentStore: DocumentStore;
  scopeKey: string;
  now?: () => Date;
}): Promise<AdminScopeItem | null> {
  const now = input.now ?? (() => new Date());
  await ensureHistoricalScopeCatalog(input.documentStore, now);
  const catalog = await input.documentStore.get<ScopeCatalogProjection>(
    SCOPE_CATALOG_COLLECTION,
    `scope:${input.scopeKey}`,
  );
  return isScopeCatalogProjection(catalog)
    ? buildAdminScopeItem(input.documentStore, catalog)
    : null;
}

export async function resolveAdminScope(
  documentStore: DocumentStore,
  scopeKey: string,
): Promise<MemoryScope | undefined> {
  const scope = await findAdminScope({ documentStore, scopeKey });
  return scope?.scope;
}

export async function listAdminMemories(input: {
  collection?: AdminMemoryCollection;
  cursor?: string;
  documentStore: DocumentStore;
  limit: number;
  scope: MemoryScope;
}): Promise<{ items: AdminMemoryItem[]; nextCursor?: string }> {
  const cursor = input.cursor ? decodeMemoryCursor(input.cursor) : undefined;
  const collections = input.collection ? [input.collection] : [...MEMORY_COLLECTIONS];
  const stored: StoredMemory[] = [];
  for (const collection of collections) {
    if (cursor && collection < cursor.collection) {
      continue;
    }
    const remaining = input.limit + 1 - stored.length;
    if (remaining <= 0) {
      break;
    }
    const documents = await queryExactScopePage({
      collection,
      cursor: cursor?.collection === collection ? cursor.id : undefined,
      documentStore: input.documentStore,
      limit: remaining,
      scope: input.scope,
    });
    stored.push(...documents);
  }
  const page = stored.slice(0, input.limit);
  return {
    items: page.map(toAdminMemoryItem),
    ...(stored.length > input.limit
      ? {
          nextCursor: encodeMemoryCursor({
            collection: page.at(-1)!.collection,
            id: page.at(-1)!.id,
          }),
        }
      : {}),
  };
}

export async function findAdminMemory(input: {
  documentStore: DocumentStore;
  id: string;
  scopeKey: string;
}): Promise<(StoredMemory & { item: AdminMemoryItem }) | null> {
  for (const collection of MEMORY_COLLECTIONS) {
    const document = await input.documentStore.get<Record<string, unknown>>(
      collection,
      input.id,
    );
    if (!document) {
      continue;
    }
    const scope = readStoredScope(document);
    if (!scope || scopeToKey(scope) !== input.scopeKey) {
      return null;
    }
    const stored = { collection, document, id: input.id, scope };
    return { ...stored, item: toAdminMemoryItem(stored) };
  }
  return null;
}

export function isAdminMemoryCollection(
  value: string,
): value is AdminMemoryCollection {
  return (MEMORY_COLLECTIONS as readonly string[]).includes(value);
}

async function queryExactScopePage(input: {
  collection: AdminMemoryCollection;
  cursor?: string;
  documentStore: DocumentStore;
  limit: number;
  scope: MemoryScope;
}): Promise<StoredMemory[]> {
  const expectedScopeKey = scopeToKey(input.scope);
  if (!input.documentStore.queryPage) {
    return (await input.documentStore.query<Record<string, unknown>>(
      input.collection,
      { ...input.scope },
    ))
      .flatMap((document) => {
        const id = typeof document.id === "string" ? document.id : undefined;
        const scope = readStoredScope(document);
        return id && scope && scopeToKey(scope) === expectedScopeKey
          ? [{ collection: input.collection, document, id, scope }]
          : [];
      })
      .filter(({ id }) => input.cursor === undefined || id > input.cursor)
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, input.limit);
  }

  const matches: StoredMemory[] = [];
  let cursor = input.cursor;
  while (matches.length < input.limit) {
    const page = await input.documentStore.queryPage<Record<string, unknown>>(
      input.collection,
      {
        ...(cursor ? { cursor } : {}),
        filter: { ...input.scope },
        limit: Math.max(50, input.limit),
      },
    );
    for (const document of page.items) {
      const id = typeof document.id === "string" ? document.id : undefined;
      const scope = readStoredScope(document);
      if (id && scope && scopeToKey(scope) === expectedScopeKey) {
        matches.push({ collection: input.collection, document, id, scope });
        if (matches.length >= input.limit) {
          break;
        }
      }
    }
    if (!page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }
  return matches;
}

function toAdminMemoryItem(memory: StoredMemory): AdminMemoryItem {
  const { collection, document, id, scope } = memory;
  const details = sanitizeViewerValue(selectVisibleDetails(collection, document), scope);
  return {
    collection,
    details:
      details && typeof details === "object" && !Array.isArray(details)
        ? (details as Record<string, unknown>)
        : {},
    etag: createEntityTag({ collection, document, id }),
    id,
    memoryType: collection === SESSION_ARCHIVES_COLLECTION
      ? "session_archive"
      : collection.replace(/s$/u, ""),
    revisable:
      ["facts", "feedback", "preferences", "references"].includes(collection) &&
      readString(document.lifecycle) !== "superseded",
    summary: String(
      sanitizeViewerValue(readMemorySummary(collection, document), scope),
    ),
    ...(readString(document.createdAt) ? { createdAt: readString(document.createdAt) } : {}),
    ...(readString(document.updatedAt) ? { updatedAt: readString(document.updatedAt) } : {}),
    ...(readString(document.lifecycle) ? { lifecycle: readString(document.lifecycle) } : {}),
    ...(document.supersededBy === null || readString(document.supersededBy)
      ? { supersededBy: document.supersededBy as string | null }
      : {}),
    ...(document.supersedes === null || readString(document.supersedes)
      ? { supersedes: document.supersedes as string | null }
      : {}),
  };
}

async function buildAdminScopeItem(
  documentStore: DocumentStore,
  catalog: ScopeCatalogProjection,
): Promise<AdminScopeItem> {
  const scope = normalizeScope(catalog);
  const byCollection = await Promise.all(
    MEMORY_COLLECTIONS.map(async (collection) => ({
      collection,
      documents: await queryExactScopeDocuments(documentStore, collection, scope),
    })),
  );
  const counts = Object.fromEntries(
    byCollection
      .filter(({ documents }) => documents.length > 0)
      .map(({ collection, documents }) => [collection, documents.length]),
  );
  const timestamps = byCollection.flatMap(({ documents }) =>
    documents.flatMap((document) => [
      readString(document.updatedAt),
      readString(document.createdAt),
    ]).filter((value): value is string => value !== undefined),
  );
  const lastUpdatedAt = [catalog.lastSeenAt, ...timestamps].sort().at(-1);
  const base = {
    counts,
    coverage: catalog.coverage,
    ...(lastUpdatedAt ? { lastUpdatedAt } : {}),
    scope,
    scopeKey: catalog.scopeKey,
    totalRecords: Object.values(counts).reduce((total, count) => total + count, 0),
  };
  return { ...base, etag: createEntityTag(base) };
}

async function ensureHistoricalScopeCatalog(
  documentStore: DocumentStore,
  now: () => Date,
): Promise<void> {
  if (
    await documentStore.get(SCOPE_CATALOG_COLLECTION, SCOPE_CATALOG_MIGRATION_ID)
  ) {
    return;
  }
  const index = await listScopes({ documentStore, now });
  for (const summary of index.scopes) {
    const id = `scope:${summary.scopeKey}`;
    if (await documentStore.get(SCOPE_CATALOG_COLLECTION, id)) {
      continue;
    }
    const timestamp = summary.lastUpdatedAt ?? index.generatedAt;
    await documentStore.set<ScopeCatalogProjection>(SCOPE_CATALOG_COLLECTION, id, {
      ...summary.scope,
      coverage: "partial",
      analyzerFingerprint: null,
      firstSeenAt: timestamp,
      id,
      lastSeenAt: timestamp,
      projectionVersion: RECALL_PROJECTION_PIPELINE_VERSION,
      schemaVersion: 2,
      searchSchemaVersion: PROJECTION_SEARCH_SCHEMA_VERSION,
      scopeKey: summary.scopeKey,
    });
  }
  await documentStore.set(SCOPE_CATALOG_COLLECTION, SCOPE_CATALOG_MIGRATION_ID, {
    completedAt: index.generatedAt,
    id: SCOPE_CATALOG_MIGRATION_ID,
    schemaVersion: 1,
  });
}

async function readScopeCatalogPage(input: {
  cursor?: string;
  documentStore: DocumentStore;
  limit: number;
}): Promise<ScopeCatalogProjection[]> {
  if (!input.documentStore.queryPage) {
    return (await input.documentStore.query<ScopeCatalogProjection>(
      SCOPE_CATALOG_COLLECTION,
    ))
      .filter(isScopeCatalogProjection)
      .filter((catalog) => input.cursor === undefined || catalog.scopeKey > input.cursor)
      .sort((left, right) => left.scopeKey.localeCompare(right.scopeKey))
      .slice(0, input.limit);
  }

  const catalogs: ScopeCatalogProjection[] = [];
  let cursor = input.cursor ? `scope:${input.cursor}` : undefined;
  while (catalogs.length < input.limit) {
    const page = await input.documentStore.queryPage<ScopeCatalogProjection>(
      SCOPE_CATALOG_COLLECTION,
      {
        ...(cursor ? { cursor } : {}),
        limit: Math.max(SCOPE_CATALOG_PAGE_SIZE, input.limit),
      },
    );
    catalogs.push(...page.items.filter(isScopeCatalogProjection));
    if (!page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }
  return catalogs
    .sort((left, right) => left.scopeKey.localeCompare(right.scopeKey))
    .slice(0, input.limit);
}

async function queryExactScopeDocuments(
  documentStore: DocumentStore,
  collection: AdminMemoryCollection,
  scope: MemoryScope,
): Promise<Record<string, unknown>[]> {
  const expectedScopeKey = scopeToKey(scope);
  const queried = await documentStore.query<Record<string, unknown>>(
    collection,
    { ...scope },
  );
  return queried.filter((document) => {
    const storedScope = readStoredScope(document);
    return storedScope !== undefined && scopeToKey(storedScope) === expectedScopeKey;
  });
}

function isScopeCatalogProjection(
  value: unknown,
): value is ScopeCatalogProjection {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === 2 &&
    typeof record.id === "string" &&
    record.id.startsWith("scope:") &&
    typeof record.scopeKey === "string" &&
    typeof record.userId === "string" &&
    (record.coverage === "partial" || record.coverage === "complete") &&
    (record.analyzerFingerprint === null ||
      typeof record.analyzerFingerprint === "string") &&
    record.projectionVersion === RECALL_PROJECTION_PIPELINE_VERSION &&
    record.searchSchemaVersion === PROJECTION_SEARCH_SCHEMA_VERSION &&
    typeof record.firstSeenAt === "string" &&
    typeof record.lastSeenAt === "string"
  );
}

function selectVisibleDetails(
  collection: AdminMemoryCollection,
  document: Record<string, unknown>,
): Record<string, unknown> {
  const allowedByCollection: Record<AdminMemoryCollection, string[]> = {
    episodes: ["summary", "unresolvedItems", "createdAt"],
    facts: ["category", "content", "subject", "object", "factKind"],
    feedback: ["kind", "rule", "strength"],
    preferences: ["category", "value", "strength"],
    profiles: [
      "role",
      "organization",
      "location",
      "responseStyle",
      "currentFocus",
    ],
    references: ["title", "pointer", "referenceKind"],
    [SESSION_ARCHIVES_COLLECTION]: ["summary", "keyDecisions", "unresolvedItems"],
  };
  return Object.fromEntries(
    allowedByCollection[collection]
      .filter((key) => document[key] !== undefined)
      .map((key) => [key, document[key]]),
  );
}

function readMemorySummary(
  collection: AdminMemoryCollection,
  document: Record<string, unknown>,
): string {
  if (collection === "profiles") {
    return [document.role, document.organization, document.currentFocus]
      .filter((value): value is string => typeof value === "string")
      .join(" · ") || "User profile";
  }
  for (const field of ["content", "value", "title", "rule", "summary", "pointer"]) {
    const value = readString(document[field]);
    if (value) {
      return value;
    }
  }
  return `${collection}:${readString(document.id) ?? "memory"}`;
}

function readStoredScope(document: Record<string, unknown>): MemoryScope | undefined {
  if (typeof document.userId !== "string") {
    return undefined;
  }
  try {
    return normalizeScope({
      userId: document.userId,
      ...(readString(document.tenantId) ? { tenantId: readString(document.tenantId) } : {}),
      ...(readString(document.workspaceId)
        ? { workspaceId: readString(document.workspaceId) }
        : {}),
      ...(readString(document.agentId) ? { agentId: readString(document.agentId) } : {}),
      ...(readString(document.sessionId)
        ? { sessionId: readString(document.sessionId) }
        : {}),
    });
  } catch {
    return undefined;
  }
}

function encodeMemoryCursor(cursor: MemoryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeMemoryCursor(value: string): MemoryCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new InvalidAdminMemoryCursorError();
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("collection" in parsed) ||
    typeof parsed.collection !== "string" ||
    !isAdminMemoryCollection(parsed.collection) ||
    !("id" in parsed) ||
    typeof parsed.id !== "string" ||
    parsed.id.length === 0
  ) {
    throw new InvalidAdminMemoryCursorError();
  }
  return { collection: parsed.collection, id: parsed.id };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
