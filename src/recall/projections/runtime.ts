import type { MemoryScope } from "../../domain/scope";
import { EVIDENCE_COLLECTION } from "../../evidence/contracts";
import {
  createLanguageService,
  type LanguageService,
} from "../../language";
import {
  createScopeDeletionAwareDocumentStore,
  createScopeDeletionCoordinator,
  type ScopeDeletionCoordinator,
} from "../../storage/scopeDeletion";
import {
  isProjectionCapableDocumentStore,
  type DocumentStore,
  type ProjectionCapableDocumentStore,
} from "../../storage/contracts";
import { createEnsureScopeIndexed } from "./backfill";
import type {
  ClaimProjectionWritePort,
  RecallProjectionSearchPort,
} from "./contracts";
import {
  isRecallProjectionSourceCollection,
  PROJECTION_MANIFESTS_COLLECTION,
} from "./contracts";
import {
  buildRecallProjectionBuildId,
  createProjectionManifestTracker,
} from "./manifest";
import { createKeyedMutationLock } from "./mutationLock";
import { createRecallProjectionOperations } from "./operations";
import { createRecallProjectionRepairs } from "./repairs";
import { createProjectionAwareDocumentStore } from "./storeDecorator";
import { createProjectionValidationFence } from "./validationFence";
import { errorMessage, sourceMutationKey } from "./shared";

export interface RecallProjectionRuntime extends
  ClaimProjectionWritePort,
  RecallProjectionSearchPort {
  documentStore: ProjectionCapableDocumentStore;
  repairPending(scope: MemoryScope): Promise<number>;
  scopeDeletion: ScopeDeletionCoordinator;
}

export interface RecallProjectionRuntimeConfig {
  bulkBackfill?: boolean;
  documentStore: DocumentStore;
  language?: LanguageService;
  now?: () => string;
  persistentScopeProof?: {
    buildId: string;
  };
  writeThrough?: boolean;
}

export function createRecallProjectionRuntime(
  config: RecallProjectionRuntimeConfig,
): RecallProjectionRuntime {
  if (!isProjectionCapableDocumentStore(config.documentStore)) {
    throw new Error(
      "Recall projection requires document-store atomic conditional batches.",
    );
  }
  const rawDocumentStore = config.documentStore;
  const scopeAwareDocumentStore = createScopeDeletionAwareDocumentStore(
    rawDocumentStore,
    {
    allowLockedBatchSet: ({ batch, operation }) =>
      operation.collection === PROJECTION_MANIFESTS_COLLECTION &&
      (batch.delete ?? []).some(({ collection }) =>
        collection === EVIDENCE_COLLECTION ||
        isRecallProjectionSourceCollection(collection)
      ),
    },
  );
  const now = config.now ?? (() => new Date().toISOString());
  const language = config.language ?? createLanguageService();
  const analyzerFingerprint =
    config.persistentScopeProof?.buildId ??
    buildRecallProjectionBuildId(language) ??
    null;
  const mutationLock = createKeyedMutationLock();
  const manifests = createProjectionManifestTracker({
    buildId: config.persistentScopeProof?.buildId,
    documentStore: scopeAwareDocumentStore,
    now,
  });
  const validationFence = createProjectionValidationFence(
    scopeAwareDocumentStore,
  );
  const documentStore = validationFence.documentStore;
  const operations = createRecallProjectionOperations({
    analyzerFingerprint,
    documentStore,
    language,
    now,
  });
  const repairs = createRecallProjectionRepairs({
    documentStore,
    mutationLock,
    now,
    operations,
  });
  const ensureScopeIndexed = createEnsureScopeIndexed({
    analyzerFingerprint,
    bulkBackfill: config.bulkBackfill,
    documentStore,
    mutationLock,
    now,
    operations,
    repairs,
    manifests,
    validationFence,
  });

  return {
    documentStore: createProjectionAwareDocumentStore({
      documentStore,
      mutationLock,
      now,
      operations,
      repairs,
      manifests,
      writeThrough: config.writeThrough ?? true,
    }),
    scopeDeletion: createScopeDeletionCoordinator(rawDocumentStore),
    ensureScopeIndexed,
    async appendClaim(claimInput) {
      await mutationLock.runExclusive(
        [sourceMutationKey("facts", claimInput.sourceMemoryId)],
        async () => {
          await manifests.invalidate(claimInput);
          try {
            await operations.appendClaimUnsafe(claimInput);
          } catch (error) {
            console.error(
              "[goodmemory:claim-projection] structured claim append failed; queued for repair",
              {
                error: errorMessage(error),
                extractorVersion: claimInput.extractorVersion,
                predicateKey: claimInput.claim.predicateKey,
                sourceMemoryId: claimInput.sourceMemoryId,
              },
            );
            try {
              await operations.markClaimFailed(claimInput, error);
            } catch (statusError) {
              console.error(
                "[goodmemory:claim-projection] failed to persist projection failure status",
                {
                  error: errorMessage(statusError),
                  sourceMemoryId: claimInput.sourceMemoryId,
                },
              );
            }
            await repairs.queue({
              claimInput,
              collection: "facts",
              error,
              scope: claimInput,
              sourceMemoryId: claimInput.sourceMemoryId,
              target: "claim",
            });
          }
        },
      );
    },
    queryClaims(scope) {
      return operations.queryClaims(scope);
    },
    queryClaimsBySourceMemoryIds(scope, sourceMemoryIds) {
      return operations.queryClaimsBySourceMemoryIds(scope, sourceMemoryIds);
    },
    queryClaimsForSourceMemoryGroups(scope, sourceMemoryIds) {
      return operations.queryClaimsForSourceMemoryGroups(scope, sourceMemoryIds);
    },
    queryClaimHistory(scope) {
      return operations.queryClaimHistory(scope);
    },
    sweepClaimSlots(scope) {
      return operations.sweepClaimSlots(scope);
    },
    queryDocuments(scope) {
      return operations.queryDocuments(scope);
    },
    searchDocuments(scope, query, limit, locale) {
      return operations.searchDocuments(scope, query, limit, locale);
    },
    searchEntities(scope, query, limit, locale) {
      return operations.searchEntities(scope, query, limit, locale);
    },
    searchClaims(scope, query, limit, history, locale) {
      return operations.searchClaims(scope, query, limit, history, locale);
    },
    queryEntities(scope) {
      return operations.queryEntities(scope);
    },
    repairPending(scope) {
      return repairs.repairPending(scope);
    },
  };
}
