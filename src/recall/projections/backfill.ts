import { normalizeScope } from "../../domain/scope";
import type { MemoryScope } from "../../domain/scope";
import { EVIDENCE_COLLECTION } from "../../evidence/contracts";
import type { EvidenceRecord } from "../../evidence/contracts";
import type {
  ProjectionCapableDocumentStore,
  StorageDocument,
} from "../../storage/contracts";
import {
  RECALL_DOCUMENTS_COLLECTION,
  RECALL_PROJECTION_SOURCE_COLLECTIONS,
  CLAIM_PROJECTION_STATUS_COLLECTION,
  LEGACY_RECALL_PROJECTION_COLLECTIONS,
  PROJECTION_REPAIRS_COLLECTION,
  PROJECTION_SEARCH_SCHEMA_VERSION,
  RECALL_PROJECTION_PIPELINE_VERSION,
  SCOPE_CATALOG_COLLECTION,
} from "./contracts";
import type {
  RecallIndexDocument,
  ClaimProjectionStatus,
  ProjectionRepairRecord,
  RecallProjectionSearchPort,
  RecallProjectionSourceCollection,
  ScopeCatalogProjection,
} from "./contracts";
import type { KeyedMutationLock } from "./mutationLock";
import type { ProjectionManifestTracker } from "./manifest";
import type { RecallProjectionOperations } from "./operations";
import type { RecallProjectionCanonicalSource } from "./operations";
import { resolveProjectionScope } from "./projector";
import type { RecallProjectionRepairs } from "./repairs";
import {
  isProjectionValidationChangedError,
  type ProjectionValidationFence,
} from "./validationFence";
import {
  errorMessage,
  matchesScopeFilter,
  memoryProjectionId,
  normalizeRecallScope,
  recallScopeKey,
  scopeFilter,
  sourceMutationKey,
} from "./shared";

export type EnsureScopeIndexed = RecallProjectionSearchPort["ensureScopeIndexed"];

export function createEnsureScopeIndexed(input: {
  analyzerFingerprint: string | null;
  bulkBackfill?: boolean;
  documentStore: ProjectionCapableDocumentStore;
  mutationLock: KeyedMutationLock;
  now: () => string;
  operations: RecallProjectionOperations;
  repairs: RecallProjectionRepairs;
  manifests: ProjectionManifestTracker;
  validationFence: ProjectionValidationFence;
}): EnsureScopeIndexed {
  const {
    documentStore,
    manifests,
    mutationLock,
    now,
    operations,
    repairs,
    validationFence,
  } = input;
  const verifiedScopeKeys = new Set<string>();

  async function cleanupLegacyProjectionRows(scope: MemoryScope): Promise<void> {
    const recallScope = normalizeRecallScope(scope);
    for (const collection of LEGACY_RECALL_PROJECTION_COLLECTIONS) {
      const rows = await documentStore.query<StorageDocument & MemoryScope & { id: string }>(
        collection,
        scopeFilter(recallScope),
      );
      for (const row of rows.filter((candidate) =>
        matchesScopeFilter(candidate as MemoryScope, recallScope)
      )) {
        await documentStore.delete(collection, row.id);
      }
    }
  }

  async function hasPendingProjectionWork(scope: MemoryScope): Promise<boolean> {
    const [queriedRepairs, queriedStatuses] = await Promise.all([
      documentStore.query<ProjectionRepairRecord>(
        PROJECTION_REPAIRS_COLLECTION,
        scopeFilter(scope),
      ),
      documentStore.query<ClaimProjectionStatus>(
        CLAIM_PROJECTION_STATUS_COLLECTION,
        scopeFilter(scope),
      ),
    ]);
    return queriedRepairs.some((repair) => matchesScopeFilter(repair, scope)) ||
      queriedStatuses.some((status) =>
        status.state === "failed" && matchesScopeFilter(status, scope)
      );
  }

  async function sealValidation(
    scope: MemoryScope,
    manifest: Awaited<ReturnType<ProjectionManifestTracker["beginValidation"]>>,
  ): Promise<boolean> {
    const sealed = await manifests.completeValidation(manifest);
    if (!sealed && manifest) {
      await manifests.invalidate(scope);
    }
    return sealed;
  }

  async function ensureScopeIndexedLocked(scope: MemoryScope) {
    const normalized = normalizeScope(scope);
    const recallScope = normalizeRecallScope(normalized);
    const requestedScopeKey = recallScopeKey(normalized);
    if (await manifests.hasValidProof(normalized)) {
      return { complete: true, indexedSources: 0, skipped: true };
    }
    const validationManifest = await manifests.beginValidation(normalized);
    if (!validationManifest) {
      const requestedCatalog = await documentStore.get<ScopeCatalogProjection>(
        SCOPE_CATALOG_COLLECTION,
        `scope:${requestedScopeKey}`,
      );
      if (
        requestedCatalog?.schemaVersion === 2 &&
        requestedCatalog?.coverage === "complete" &&
        requestedCatalog.analyzerFingerprint === input.analyzerFingerprint &&
        requestedCatalog.projectionVersion === RECALL_PROJECTION_PIPELINE_VERSION &&
        requestedCatalog.searchSchemaVersion === PROJECTION_SEARCH_SCHEMA_VERSION &&
        verifiedScopeKeys.has(requestedScopeKey)
      ) {
        return { complete: true, indexedSources: 0, skipped: true };
      }
    }

    const indexScope = async () => {
    const canonicalSources: RecallProjectionCanonicalSource[] = [];
    const queriedEvidence = await documentStore.query<EvidenceRecord>(
      EVIDENCE_COLLECTION,
      scopeFilter(normalized),
    );
    const evidenceByMemoryId = new Map<string, EvidenceRecord[]>();
    const evidenceIds = new Set(queriedEvidence.map(({ id }) => id));
    for (const evidence of queriedEvidence.filter((record) =>
      matchesScopeFilter(record, normalized),
    )) {
      for (const memoryId of evidence.linkedMemoryIds) {
        const records = evidenceByMemoryId.get(memoryId) ?? [];
        records.push(evidence);
        evidenceByMemoryId.set(memoryId, records);
      }
    }
    for (const collection of RECALL_PROJECTION_SOURCE_COLLECTIONS) {
      if (
        collection === "profiles" &&
        (recallScope.tenantId !== undefined ||
          recallScope.workspaceId !== undefined ||
          recallScope.agentId !== undefined)
      ) {
        continue;
      }
      const queriedDocuments = await documentStore.query<StorageDocument>(
        collection,
        collection === "profiles"
          ? { userId: normalized.userId }
          : scopeFilter(normalized),
      );
      const documents = collection === "profiles"
        ? queriedDocuments
        : queriedDocuments.filter((document) =>
            matchesScopeFilter(document as MemoryScope, normalized),
          );
      for (const document of documents) {
        const record = document as Record<string, unknown>;
        const id =
          collection === "profiles"
            ? typeof record.userId === "string"
              ? record.userId
              : undefined
            : typeof record.id === "string"
              ? record.id
              : undefined;
        if (id) {
          canonicalSources.push({
            collection,
            document,
            evidence: evidenceByMemoryId.get(id) ?? [],
            id,
          });
        }
      }
    }

    if (input.bulkBackfill) {
      // Bulk mode is for isolated eval/backfill runs and assumes canonical
      // sources are not being written concurrently.
      try {
        const indexedSources = await operations.rebuildScopeUnsafe(
          normalized,
          canonicalSources,
        );
        const integrity = await operations.validateScopeUnsafe(
          normalized,
          canonicalSources,
          evidenceIds,
        );
        if (!integrity.complete) {
          console.error(
            "[goodmemory:recall-projection] bulk scope validation failed",
            { issues: integrity.issues, scopeKey: requestedScopeKey },
          );
          await operations.registerScope(normalized, now(), "partial");
          verifiedScopeKeys.delete(requestedScopeKey);
          return { complete: false, indexedSources, skipped: false };
        }
        if (
          validationManifest &&
          await hasPendingProjectionWork(normalized)
        ) {
          await operations.registerScope(normalized, now(), "partial");
          verifiedScopeKeys.delete(requestedScopeKey);
          return { complete: false, indexedSources, skipped: false };
        }
        await cleanupLegacyProjectionRows(normalized);
        await operations.registerScope(normalized, now(), "complete");
        if (!await sealValidation(normalized, validationManifest)) {
          verifiedScopeKeys.delete(requestedScopeKey);
          return { complete: false, indexedSources, skipped: false };
        }
        verifiedScopeKeys.add(requestedScopeKey);
        return { complete: true, indexedSources, skipped: false };
      } catch (error) {
        if (isProjectionValidationChangedError(error)) {
          throw error;
        }
        console.error(
          "[goodmemory:recall-projection] bulk scope backfill failed; retrying incrementally",
          {
            error: errorMessage(error),
            scopeKey: requestedScopeKey,
          },
        );
      }
    }

    const canonicalKeys = new Set(
      canonicalSources.map((source) =>
        memoryProjectionId(source.collection, source.id),
      ),
    );
    let complete = true;
    let indexedSources = 0;
    for (const source of canonicalSources) {
      const sourceScope = resolveProjectionScope(source.document);
      try {
        await mutationLock.runExclusive(
          [sourceMutationKey(source.collection, source.id)],
          () =>
            operations.synchronizeUnsafe(
              source.collection,
              source.id,
              sourceScope ?? undefined,
              false,
              source.evidence,
            ),
        );
        indexedSources += 1;
      } catch (error) {
        if (isProjectionValidationChangedError(error)) {
          throw error;
        }
        complete = false;
        console.error(
          "[goodmemory:recall-projection] lazy scope backfill failed",
          {
            collection: source.collection,
            error: errorMessage(error),
            sourceMemoryId: source.id,
          },
        );
        await repairs.queue({
          collection: source.collection,
          error,
          scope: sourceScope ?? normalized,
          sourceMemoryId: source.id,
        });
      }
    }

    const queriedProjections = await documentStore.query<RecallIndexDocument>(
      RECALL_DOCUMENTS_COLLECTION,
      scopeFilter(normalized),
    );
    const projected = queriedProjections.filter((document) =>
      matchesScopeFilter(document, normalized),
    );
    const projectedSources = new Map<
      string,
      {
        collection: RecallProjectionSourceCollection;
        id: string;
        scope?: MemoryScope;
      }
    >();
    for (const document of projected) {
      const key = memoryProjectionId(
        document.sourceCollection,
        document.sourceMemoryId,
      );
      if (!projectedSources.has(key)) {
        projectedSources.set(key, {
          collection: document.sourceCollection,
          id: document.sourceMemoryId,
          scope: resolveProjectionScope(document) ?? undefined,
        });
      }
    }
    for (const [key, source] of projectedSources) {
      if (canonicalKeys.has(key)) {
        continue;
      }
      try {
        await mutationLock.runExclusive(
          [sourceMutationKey(source.collection, source.id)],
          () =>
            operations.synchronizeUnsafe(
              source.collection,
              source.id,
              source.scope,
              true,
            ),
        );
      } catch (error) {
        if (isProjectionValidationChangedError(error)) {
          throw error;
        }
        complete = false;
        await repairs.queue({
          collection: source.collection,
          error,
          scope: source.scope ?? normalized,
          sourceMemoryId: source.id,
        });
      }
    }
    try {
      await operations.reconcileClaimScopeUnsafe(normalized, canonicalSources);
    } catch (error) {
      if (isProjectionValidationChangedError(error)) {
        throw error;
      }
      complete = false;
      console.error(
        "[goodmemory:claim-projection] scope reconciliation failed",
        {
          error: errorMessage(error),
          scopeKey: requestedScopeKey,
        },
      );
    }

    if (complete) {
      const integrity = await operations.validateScopeUnsafe(
        normalized,
        canonicalSources,
        evidenceIds,
      );
      if (!integrity.complete) {
        complete = false;
        console.error(
          "[goodmemory:recall-projection] scope validation failed",
          { issues: integrity.issues, scopeKey: requestedScopeKey },
        );
        await operations.registerScope(normalized, now(), "partial");
      }
    }

    if (complete) {
      const timestamp = now();
      if (
        validationManifest &&
        await hasPendingProjectionWork(normalized)
      ) {
        complete = false;
        await operations.registerScope(normalized, timestamp, "partial");
      } else {
        await cleanupLegacyProjectionRows(normalized);
        await operations.registerScope(normalized, timestamp, "complete");
        complete = await sealValidation(normalized, validationManifest);
      }
      if (complete) {
        verifiedScopeKeys.add(requestedScopeKey);
      } else {
        verifiedScopeKeys.delete(requestedScopeKey);
      }
    } else {
      verifiedScopeKeys.delete(requestedScopeKey);
    }
    return { complete, indexedSources, skipped: false };
    };
    if (!validationManifest) {
      return indexScope();
    }
    try {
      return await validationFence.run(validationManifest, indexScope);
    } catch (error) {
      if (!isProjectionValidationChangedError(error)) {
        throw error;
      }
      verifiedScopeKeys.delete(requestedScopeKey);
      return { complete: false, indexedSources: 0, skipped: false };
    }
  }

  return async function ensureScopeIndexed(scope: MemoryScope) {
    const scopeKey = recallScopeKey(normalizeScope(scope));
    return mutationLock.runExclusive(
      [`scope-migration:${scopeKey}`],
      () => ensureScopeIndexedLocked(scope),
    );
  };
}
