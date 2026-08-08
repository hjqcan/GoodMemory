import { isDeepStrictEqual } from "node:util";
import { isActiveMemoryLifecycle } from "../../domain/records";
import { normalizeScope, scopeToKey } from "../../domain/scope";
import type { MemoryScope } from "../../domain/scope";
import type { EvidenceRecord } from "../../evidence/contracts";
import type { LanguageService } from "../../language";
import type {
  ProjectionCapableDocumentStore,
  StorageDocument,
} from "../../storage/contracts";
import { scoreDocumentSearch } from "../../storage/textSearch";
import {
  CLAIM_PROJECTIONS_COLLECTION,
  CLAIM_PROJECTION_STATUS_COLLECTION,
  ENTITIES_COLLECTION,
  PROJECTION_SEARCH_SCHEMA_VERSION,
  RECALL_PROJECTION_PIPELINE_VERSION,
  RECALL_DOCUMENTS_COLLECTION,
  SCOPE_CATALOG_COLLECTION,
} from "./contracts";
import {
  buildClaimProjectionStatusId,
  createClaimProjectionIndex,
} from "./claims";
import type { ClaimProjectionIndex } from "./claims";
import type {
  AppendClaimProjectionInput,
  ClaimProjectionStatus,
  ClaimProjection,
  EntityAdjacencyProjection,
  EntityProjection,
  RecallIndexDocument,
  RecallProjectionSourceCollection,
  ScopeCatalogProjection,
} from "./contracts";
import {
  buildEntityAdjacencyProjections,
  createEntityProjectionIndex,
} from "./entityIndex";
import type { EntityProjectionIndex } from "./entityIndex";
import { buildRecallIndexDocuments, resolveProjectionScope } from "./projector";
import {
  matchesScopeFilter,
  normalizeRecallScope,
  recallScopeKey,
  scopeFilter,
} from "./shared";

const MAX_SOURCE_STABILIZATION_ATTEMPTS = 4;

function sameIds(
  left: readonly { id: string }[],
  right: readonly { id: string }[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightIds = new Set(right.map(({ id }) => id));
  return left.every(({ id }) => rightIds.has(id));
}

export interface RecallProjectionOperations {
  appendClaimUnsafe(input: AppendClaimProjectionInput): Promise<void>;
  markClaimFailed(input: AppendClaimProjectionInput, error: unknown): Promise<void>;
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
  sweepClaimSlots(scope: MemoryScope): Promise<number>;
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
  registerScope(
    scope: MemoryScope,
    timestamp: string,
    coverage?: ScopeCatalogProjection["coverage"],
  ): Promise<void>;
  rebuildScopeUnsafe(
    scope: MemoryScope,
    sources: readonly RecallProjectionCanonicalSource[],
  ): Promise<number>;
  reconcileClaimScopeUnsafe(
    scope: MemoryScope,
    sources: readonly RecallProjectionCanonicalSource[],
  ): Promise<void>;
  synchronizeUnsafe(
    collection: RecallProjectionSourceCollection,
    sourceMemoryId: string,
    fallbackScope?: MemoryScope,
    recoverStaleAdjacency?: boolean,
    evidence?: readonly EvidenceRecord[],
  ): Promise<void>;
  validateScopeUnsafe(
    scope: MemoryScope,
    sources: readonly RecallProjectionCanonicalSource[],
    evidenceIds: ReadonlySet<string>,
  ): Promise<{ complete: boolean; issues: string[] }>;
}

export interface RecallProjectionCanonicalSource {
  collection: RecallProjectionSourceCollection;
  document: StorageDocument;
  evidence?: readonly EvidenceRecord[];
  id: string;
}

export function createRecallProjectionOperations(input: {
  analyzerFingerprint: string | null;
  documentStore: ProjectionCapableDocumentStore;
  language: LanguageService;
  now: () => string;
  entityIndex?: EntityProjectionIndex;
  claimIndex?: ClaimProjectionIndex;
}): RecallProjectionOperations {
  const { analyzerFingerprint, documentStore, language, now } = input;
  const entityIndex =
    input.entityIndex ?? createEntityProjectionIndex(documentStore, language);
  const claimIndex =
    input.claimIndex ?? createClaimProjectionIndex(documentStore, language);

  async function removeSourceDocuments(
    collection: RecallProjectionSourceCollection,
    sourceMemoryId: string,
  ): Promise<RecallIndexDocument[]> {
    const existing = await documentStore.query<RecallIndexDocument>(
      RECALL_DOCUMENTS_COLLECTION,
      { sourceCollection: collection, sourceMemoryId },
    );
    for (const document of existing) {
      await documentStore.delete(RECALL_DOCUMENTS_COLLECTION, document.id);
    }
    return existing;
  }

  async function registerScope(
    scope: MemoryScope,
    timestamp: string,
    coverage?: ScopeCatalogProjection["coverage"],
  ): Promise<void> {
    const normalized = normalizeScope(scope);
    const scopes = new Map<string, MemoryScope>();
    for (const candidate of [normalized, normalizeRecallScope(normalized)]) {
      scopes.set(scopeToKey(candidate), candidate);
    }
    for (const [key, candidate] of scopes) {
      const id = `scope:${key}`;
      const existing = await documentStore.get<ScopeCatalogProjection>(
        SCOPE_CATALOG_COLLECTION,
        id,
      );
      const catalog: ScopeCatalogProjection = {
        id,
        schemaVersion: 2,
        ...candidate,
        scopeKey: key,
        coverage: coverage ?? existing?.coverage ?? "partial",
        analyzerFingerprint,
        projectionVersion: RECALL_PROJECTION_PIPELINE_VERSION,
        searchSchemaVersion: PROJECTION_SEARCH_SCHEMA_VERSION,
        firstSeenAt: existing?.firstSeenAt ?? timestamp,
        lastSeenAt: timestamp,
      };
      await documentStore.set(SCOPE_CATALOG_COLLECTION, id, catalog);
    }
  }

  async function updateRemovedSource(input: {
    collection: RecallProjectionSourceCollection;
    existing: RecallIndexDocument[];
    fallbackScope?: MemoryScope;
    evidence?: readonly EvidenceRecord[];
    recoverStaleAdjacency: boolean;
    sourceMemoryId: string;
    timestamp: string;
  }): Promise<void> {
    const scopes = new Map<string, MemoryScope>();
    if (input.fallbackScope) {
      scopes.set(scopeToKey(input.fallbackScope), input.fallbackScope);
    }
    for (const document of input.existing) {
      const scope = resolveProjectionScope(document);
      if (scope) {
        scopes.set(scopeToKey(scope), scope);
      }
    }
    for (const scope of scopes.values()) {
      await entityIndex.updateForSource({
        collection: input.collection,
        existingDocuments: input.existing,
        newDocuments: [],
        recoverStaleAdjacency: input.recoverStaleAdjacency,
        scope,
        sourceMemoryId: input.sourceMemoryId,
        timestamp: input.timestamp,
      });
    }
  }

  async function replaceSourceSnapshot(input: {
    collection: RecallProjectionSourceCollection;
    document: StorageDocument | null;
    evidence?: readonly EvidenceRecord[];
    fallbackScope?: MemoryScope;
    recoverStaleAdjacency: boolean;
    sourceMemoryId: string;
    timestamp: string;
  }): Promise<void> {
    const scope = input.document
      ? resolveProjectionScope(input.document) ?? input.fallbackScope
      : input.fallbackScope;
    const existing = await removeSourceDocuments(
      input.collection,
      input.sourceMemoryId,
    );
    if (!input.document || !scope) {
      await updateRemovedSource({
        collection: input.collection,
        existing,
        fallbackScope: scope,
        recoverStaleAdjacency: input.recoverStaleAdjacency,
        sourceMemoryId: input.sourceMemoryId,
        timestamp: input.timestamp,
      });
      if (input.collection === "facts") {
        await claimIndex.synchronizeFact({
          document: input.document,
          evidence: input.evidence,
          fallbackScope: scope,
          sourceMemoryId: input.sourceMemoryId,
          timestamp: input.timestamp,
        });
      }
      return;
    }

    const projections = buildRecallIndexDocuments({
      collection: input.collection,
      document: input.document,
      indexedAt: input.timestamp,
      language,
      sourceMemoryId: input.sourceMemoryId,
    });
    for (const projection of projections) {
      await documentStore.set(
        RECALL_DOCUMENTS_COLLECTION,
        projection.id,
        projection,
      );
    }
    await registerScope(scope, input.timestamp);
    await entityIndex.updateForSource({
      collection: input.collection,
      existingDocuments: existing,
      newDocuments: projections,
      recoverStaleAdjacency: input.recoverStaleAdjacency,
      scope,
      sourceMemoryId: input.sourceMemoryId,
      timestamp: input.timestamp,
    });
    if (input.collection === "facts") {
      await claimIndex.synchronizeFact({
        document: input.document,
        evidence: input.evidence,
        fallbackScope: input.fallbackScope,
        sourceMemoryId: input.sourceMemoryId,
        timestamp: input.timestamp,
      });
    }
  }

  return {
    async appendClaimUnsafe(claimInput) {
      await claimIndex.append(claimInput);
    },
    markClaimFailed(claimInput, error) {
      return claimIndex.markFailed(claimInput, error);
    },
    queryClaims(scope) {
      return claimIndex.query(scope);
    },
    queryClaimsBySourceMemoryIds(scope, sourceMemoryIds) {
      return claimIndex.queryBySourceMemoryIds(scope, sourceMemoryIds);
    },
    queryClaimsForSourceMemoryGroups(scope, sourceMemoryIds) {
      return claimIndex.queryForSourceMemoryGroups(scope, sourceMemoryIds);
    },
    queryClaimHistory(scope) {
      return claimIndex.queryHistory(scope);
    },
    sweepClaimSlots(scope) {
      return claimIndex.sweepSlotSupersession(scope);
    },
    searchClaims(scope, query, limit, history = false, locale) {
      return claimIndex.search(scope, query, limit, history, locale);
    },
    async queryDocuments(scope) {
      const documents = await documentStore.query<RecallIndexDocument>(
        RECALL_DOCUMENTS_COLLECTION,
        scopeFilter(scope),
      );
      return documents.filter((document) => matchesScopeFilter(document, scope));
    },
    async searchDocuments(scope, query, limit, locale) {
      const queryContext = language.resolveFromText({
        ...(locale ? { locale } : {}),
        text: query,
      });
      const searchQuery = language.buildSearchTerms(query, queryContext).join(" ");
      if (!searchQuery) {
        return [];
      }
      if (documentStore.searchText) {
        const results = await documentStore.searchText<RecallIndexDocument>(
          RECALL_DOCUMENTS_COLLECTION,
          {
            field: "searchText",
            filter: scopeFilter(scope),
            limit,
            query: searchQuery,
          },
        );
        return results
          .map(({ document }) => document)
          .filter((document) => matchesScopeFilter(document, scope));
      }
      const queried = await documentStore.query<RecallIndexDocument>(
        RECALL_DOCUMENTS_COLLECTION,
        scopeFilter(scope),
      );
      const documents = queried.filter((document) =>
        matchesScopeFilter(document, scope),
      );
      return documents
        .map((document) => ({
          document,
          score: scoreDocumentSearch(searchQuery, document.searchText),
        }))
        .filter(({ score }) => score > 0)
        .sort((left, right) =>
          right.score - left.score || left.document.id.localeCompare(right.document.id)
        )
        .map(({ document }) => document)
        .slice(0, limit);
    },
    queryEntities(scope) {
      return entityIndex.query(scope);
    },
    searchEntities(scope, query, limit, locale) {
      return entityIndex.search(scope, query, limit, locale);
    },
    async validateScopeUnsafe(scope, sources, evidenceIds) {
      const timestamp = now();
      const expectedDocuments = sources.flatMap((source) =>
        buildRecallIndexDocuments({
          collection: source.collection,
          document: source.document,
          indexedAt: timestamp,
          language,
          sourceMemoryId: source.id,
        })
      );
      const expectedEdges = buildEntityAdjacencyProjections({
        documents: expectedDocuments,
        language,
        timestamp,
      });
      const [queriedDocuments, queriedEdges, queriedClaims, queriedStatuses] =
        await Promise.all([
          documentStore.query<RecallIndexDocument>(
            RECALL_DOCUMENTS_COLLECTION,
            scopeFilter(scope),
          ),
          documentStore.query<EntityAdjacencyProjection>(
            ENTITIES_COLLECTION,
            scopeFilter(scope),
          ),
          documentStore.query<ClaimProjection>(
            CLAIM_PROJECTIONS_COLLECTION,
            scopeFilter(scope),
          ),
          documentStore.query<ClaimProjectionStatus>(
            CLAIM_PROJECTION_STATUS_COLLECTION,
            scopeFilter(scope),
          ),
        ]);
      const documents = queriedDocuments.filter((document) =>
        matchesScopeFilter(document, scope)
      );
      const edges = queriedEdges.filter((edge) => matchesScopeFilter(edge, scope));
      const claims = queriedClaims.filter((claim) => matchesScopeFilter(claim, scope));
      const statuses = queriedStatuses.filter((status) =>
        matchesScopeFilter(status, scope)
      );
      const canonicalScopeKey = recallScopeKey(scope);
      const issues: string[] = [];
      if (!sameIds(documents, expectedDocuments)) {
        issues.push("document_set_mismatch");
      }
      if (!sameIds(edges, expectedEdges)) {
        issues.push("entity_adjacency_set_mismatch");
      }
      const canonicalFactIds = new Set(
        sources
          .filter(({ collection }) => collection === "facts")
          .map(({ id }) => id),
      );
      const activeFactIds = new Set(
        sources
          .filter(({ collection, document }) =>
            collection === "facts" &&
            isActiveMemoryLifecycle(document) &&
            (document as { isActive?: boolean }).isActive !== false
          )
          .map(({ id }) => id),
      );
      const statusBySource = new Map(statuses.map((status) => [
        status.sourceMemoryId,
        status,
      ]));
      for (const sourceMemoryId of activeFactIds) {
        if (!statusBySource.has(sourceMemoryId)) {
          issues.push(`missing_claim_status:${sourceMemoryId}`);
        }
      }
      const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
      for (const status of statuses) {
        if (!canonicalFactIds.has(status.sourceMemoryId)) {
          issues.push(`orphan_claim_status:${status.id}`);
        }
        if (status.scopeKey !== canonicalScopeKey) {
          issues.push(`claim_status_scope_key_mismatch:${status.id}`);
        }
        if (
          status.id !==
            buildClaimProjectionStatusId(scope, status.sourceMemoryId)
        ) {
          issues.push(`claim_status_id_mismatch:${status.id}`);
        }
        for (const claimId of status.claimIds) {
          const claim = claimsById.get(claimId);
          if (!claim) {
            issues.push(`missing_claim:${claimId}`);
          } else if (claim.sourceMemoryId !== status.sourceMemoryId) {
            issues.push(`claim_source_mismatch:${claimId}`);
          }
        }
        for (const retiredRevisionId of status.retiredRevisionIds ?? []) {
          if (status.claimIds.includes(retiredRevisionId)) {
            issues.push(`active_claim_is_retired:${retiredRevisionId}`);
          }
          const claim = claimsById.get(retiredRevisionId);
          if (!claim) {
            issues.push(`missing_retired_claim:${retiredRevisionId}`);
          } else if (claim.sourceMemoryId !== status.sourceMemoryId) {
            issues.push(
              `retired_claim_source_mismatch:${retiredRevisionId}`,
            );
          }
        }
      }
      for (const claim of claims) {
        if (!canonicalFactIds.has(claim.sourceMemoryId)) {
          issues.push(`orphan_claim:${claim.id}`);
        }
        if (claim.scopeKey !== canonicalScopeKey) {
          issues.push(`claim_scope_key_mismatch:${claim.id}`);
        }
        for (const evidenceId of claim.evidenceIds) {
          if (!evidenceIds.has(evidenceId)) {
            issues.push(`missing_evidence:${claim.id}:${evidenceId}`);
          }
        }
      }
      return { complete: issues.length === 0, issues };
    },
    registerScope,
    async rebuildScopeUnsafe(scope, sources) {
      const timestamp = now();
      const projections = sources.flatMap((source) =>
        buildRecallIndexDocuments({
          collection: source.collection,
          document: source.document,
          indexedAt: timestamp,
          language,
          sourceMemoryId: source.id,
        }),
      );
      const edges = buildEntityAdjacencyProjections({
        documents: projections,
        language,
        timestamp,
      });
      const [queriedDocuments, queriedEdges] = await Promise.all([
        documentStore.query<RecallIndexDocument>(
          RECALL_DOCUMENTS_COLLECTION,
          scopeFilter(scope),
        ),
        documentStore.query<EntityAdjacencyProjection>(
          ENTITIES_COLLECTION,
          scopeFilter(scope),
        ),
      ]);
      const existingDocuments = queriedDocuments.filter((document) =>
        matchesScopeFilter(document, scope),
      );
      const existingEdges = queriedEdges.filter((edge) =>
        matchesScopeFilter(edge, scope),
      );
      for (const document of existingDocuments) {
        await documentStore.delete(RECALL_DOCUMENTS_COLLECTION, document.id);
      }
      for (const edge of existingEdges) {
        await documentStore.delete(ENTITIES_COLLECTION, edge.id);
      }
      for (const projection of projections) {
        await documentStore.set(
          RECALL_DOCUMENTS_COLLECTION,
          projection.id,
          projection,
        );
      }
      for (const edge of edges) {
        await documentStore.set(ENTITIES_COLLECTION, edge.id, edge);
      }

      const sourceScopes = new Map<string, MemoryScope>();
      for (const source of sources) {
        const sourceScope = resolveProjectionScope(source.document);
        if (sourceScope) {
          sourceScopes.set(scopeToKey(sourceScope), sourceScope);
        }
      }
      for (const sourceScope of sourceScopes.values()) {
        await registerScope(sourceScope, timestamp);
      }
      await claimIndex.rebuildScope({
        scope,
        sources,
        timestamp,
      });
      await registerScope(scope, timestamp, "partial");
      return sources.length;
    },
    reconcileClaimScopeUnsafe(scope, sources) {
      return claimIndex.reconcileScope({
        canonicalSourceIds: new Set(
          sources
            .filter(({ collection }) => collection === "facts")
            .map(({ id }) => id),
        ),
        scope,
      });
    },
    async synchronizeUnsafe(
      collection,
      sourceMemoryId,
      fallbackScope,
      recoverStaleAdjacency = false,
      evidence = [],
    ) {
      let expected = await documentStore.get<StorageDocument>(
        collection,
        sourceMemoryId,
      );
      for (
        let attempt = 0;
        attempt < MAX_SOURCE_STABILIZATION_ATTEMPTS;
        attempt += 1
      ) {
        await replaceSourceSnapshot({
          collection,
          document: expected,
          fallbackScope,
          evidence,
          recoverStaleAdjacency: recoverStaleAdjacency || attempt > 0,
          sourceMemoryId,
          timestamp: now(),
        });
        const current = await documentStore.get<StorageDocument>(
          collection,
          sourceMemoryId,
        );
        if (isDeepStrictEqual(current, expected)) {
          return;
        }
        expected = current;
      }
      throw new Error(
        `Recall projection source did not stabilize after ${MAX_SOURCE_STABILIZATION_ATTEMPTS} attempts: ${collection}/${sourceMemoryId}`,
      );
    },
  };
}
