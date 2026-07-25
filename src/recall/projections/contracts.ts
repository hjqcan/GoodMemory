import type { MemoryScope } from "../../domain/scope";
import type { MemorySourceMethod } from "../../domain/provenance";
import type {
  AppendClaimProjectionInput,
  MemoryClaimModality,
  MemoryClaimPolarity,
} from "../../domain/memoryCandidate";

export type {
  AppendClaimProjectionInput,
  ClaimProjectionWritePort,
} from "../../domain/memoryCandidate";

export const RECALL_DOCUMENTS_COLLECTION = "recall_documents_v3";
export const ENTITIES_COLLECTION = "entities_v2";
export const SCOPE_CATALOG_COLLECTION = "scope_catalog_v2";
export const PROJECTION_MANIFESTS_COLLECTION =
  "recall_projection_manifests_v1";
export const PROJECTION_REPAIRS_COLLECTION = "recall_projection_repairs_v1";
export const CLAIM_PROJECTIONS_COLLECTION = "claim_projections_v2";
export const CLAIM_PROJECTION_STATUS_COLLECTION = "claim_projection_status_v2";
export const PROJECTION_SEARCH_SCHEMA_VERSION = "gm-search-v2";
export const RECALL_PROJECTION_PIPELINE_VERSION = "gm-projection-v4";

export const LEGACY_RECALL_PROJECTION_COLLECTIONS = [
  "recall_documents_v2",
  "entities_v1",
  "claim_projections_v1",
  "claim_projection_status_v1",
  "scope_catalog_v1",
] as const;

export const RECALL_PROJECTION_SOURCE_COLLECTIONS = [
  "profiles",
  "preferences",
  "references",
  "facts",
  "episodes",
  "feedback",
  "session_archives",
] as const;

export type RecallProjectionSourceCollection =
  (typeof RECALL_PROJECTION_SOURCE_COLLECTIONS)[number];

export type RecallDocumentGranularity = "memory" | "field" | "sentence";

export interface RecallEntityMention {
  canonicalKey: string;
  entityId: string;
  surface: string;
}

export interface RecallIndexDocument extends MemoryScope {
  id: string;
  schemaVersion: 3;
  scopeKey: string;
  sourceCollection: RecallProjectionSourceCollection;
  sourceMemoryId: string;
  sourceMemoryType: string;
  granularity: RecallDocumentGranularity;
  field?: string;
  text: string;
  searchText: string;
  searchLocale: string;
  languagePackId: string;
  searchAnalyzerVersion: string;
  searchSchemaVersion: typeof PROJECTION_SEARCH_SCHEMA_VERSION;
  entityIds: string[];
  entityMentions: RecallEntityMention[];
  effectiveFrom?: string;
  effectiveUntil?: string;
  provenance: {
    method?: MemorySourceMethod;
    extractedAt?: string;
    sessionId?: string;
    locale?: string;
    localeSource?: "explicit" | "detected" | "default";
    languagePackId?: string;
    languagePackVersion?: string;
  };
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
  indexedAt: string;
}

export interface EntityProjection extends MemoryScope {
  id: string;
  schemaVersion: 2;
  scopeKey: string;
  canonicalKey: string;
  aliases: string[];
  description?: string;
  memoryIds: string[];
  validFrom?: string;
  validUntil?: string;
  updatedAt: string;
}

export interface EntityAdjacencyProjection extends MemoryScope {
  id: string;
  schemaVersion: 2;
  scopeKey: string;
  entityId: string;
  canonicalKey: string;
  memoryId: string;
  aliases: string[];
  description?: string;
  text: string;
  searchText: string;
  searchLocale: string;
  languagePackId: string;
  searchAnalyzerVersion: string;
  searchSchemaVersion: typeof PROJECTION_SEARCH_SCHEMA_VERSION;
  validFrom?: string;
  validUntil?: string;
  updatedAt: string;
}

export interface ScopeCatalogProjection extends MemoryScope {
  id: string;
  schemaVersion: 2;
  scopeKey: string;
  coverage: "partial" | "complete";
  analyzerFingerprint: string | null;
  projectionVersion: typeof RECALL_PROJECTION_PIPELINE_VERSION;
  searchSchemaVersion: typeof PROJECTION_SEARCH_SCHEMA_VERSION;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface RecallProjectionManifest extends MemoryScope {
  id: string;
  schemaVersion: 1;
  scopeKey: string;
  sourceGeneration: string;
  validatedGeneration?: string;
  projectionBuildId?: string;
  updatedAt: string;
  validatedAt?: string;
}

export interface ClaimProjection extends MemoryScope {
  id: string;
  schemaVersion: 2;
  scopeKey: string;
  sourceMemoryId: string;
  subjectText?: string;
  subjectEntityId: string;
  predicateKey: string;
  objectText: string;
  text: string;
  searchText: string;
  searchLocale: string;
  languagePackId: string;
  searchAnalyzerVersion: string;
  searchSchemaVersion: typeof PROJECTION_SEARCH_SCHEMA_VERSION;
  objectEntityText?: string;
  objectEntityId?: string;
  polarity: MemoryClaimPolarity;
  modality: MemoryClaimModality;
  validFrom?: string;
  validUntil?: string;
  observedAt: string;
  ingestedAt: string;
  evidenceIds: string[];
  sourceMessageIds: string[];
  extractorVersion: string;
  confidence?: number;
  contextualDescriptor?: string;
}

export type ClaimProjectionState = "projected" | "unstructured" | "failed";

export interface ClaimProjectionStatus extends MemoryScope {
  id: string;
  schemaVersion: 2;
  scopeKey: string;
  sourceMemoryId: string;
  state: ClaimProjectionState;
  claimIds: string[];
  retiredRevisionIds?: string[];
  extractorVersion: string;
  sourceUpdatedAt?: string;
  lastError?: string;
  updatedAt: string;
}

export interface ProjectionRepairRecord extends MemoryScope {
  id: string;
  schemaVersion: 1;
  scopeKey: string;
  sourceCollection: RecallProjectionSourceCollection;
  sourceMemoryId: string;
  attempts: number;
  firstFailedAt: string;
  lastFailedAt: string;
  lastError: string;
  target?: "recall" | "claim";
  claimInput?: AppendClaimProjectionInput;
}

export interface RecallProjectionSearchPort {
  ensureScopeIndexed(scope: MemoryScope): Promise<{
    complete: boolean;
    indexedSources: number;
    skipped: boolean;
  }>;
  queryDocuments(scope: MemoryScope): Promise<RecallIndexDocument[]>;
  searchDocuments(
    scope: MemoryScope,
    query: string,
    limit: number,
    locale?: string,
  ): Promise<RecallIndexDocument[]>;
  searchEntities(
    scope: MemoryScope,
    query: string,
    limit: number,
    locale?: string,
  ): Promise<EntityProjection[]>;
  searchClaims(
    scope: MemoryScope,
    query: string,
    limit: number,
    history?: boolean,
    locale?: string,
  ): Promise<ClaimProjection[]>;
  queryEntities(scope: MemoryScope): Promise<EntityProjection[]>;
  queryClaims(scope: MemoryScope): Promise<ClaimProjection[]>;
  queryClaimsBySourceMemoryIds(
    scope: MemoryScope,
    sourceMemoryIds: readonly string[],
  ): Promise<ClaimProjection[]>;
  queryClaimsForSourceMemoryGroups(
    scope: MemoryScope,
    sourceMemoryIds: readonly string[],
  ): Promise<ClaimProjection[]>;
  queryClaimHistory(scope: MemoryScope): Promise<ClaimProjection[]>;
  // R4.1's batch form (R9.4): close stale open values in multi-value claim
  // slots; returns the number of claims closed.
  sweepClaimSlots(scope: MemoryScope): Promise<number>;
}

export function isRecallProjectionSourceCollection(
  collection: string,
): collection is RecallProjectionSourceCollection {
  return (RECALL_PROJECTION_SOURCE_COLLECTIONS as readonly string[]).includes(
    collection,
  );
}
