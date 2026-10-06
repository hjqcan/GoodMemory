import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";

import type {
  ConditionalDocumentWriteBatch,
  DocumentQueryPageInput,
  DocumentTextSearchInput,
  ProjectionCapableDocumentStore,
  StorageDocument,
} from "../../storage/contracts";
import {
  PROJECTION_BATCH_SEMANTICS,
  shallowMergeDocument,
} from "../../storage/contracts";
import {
  CLAIM_PROJECTIONS_COLLECTION,
  CLAIM_PROJECTION_STATUS_COLLECTION,
  ENTITIES_COLLECTION,
  PROJECTION_MANIFESTS_COLLECTION,
  PROJECTION_REPAIRS_COLLECTION,
  RECALL_DOCUMENTS_COLLECTION,
  SCOPE_CATALOG_COLLECTION,
  type RecallProjectionManifest,
} from "./contracts";

const PROJECTION_OUTPUT_COLLECTIONS = new Set([
  CLAIM_PROJECTIONS_COLLECTION,
  CLAIM_PROJECTION_STATUS_COLLECTION,
  ENTITIES_COLLECTION,
  PROJECTION_REPAIRS_COLLECTION,
  RECALL_DOCUMENTS_COLLECTION,
  SCOPE_CATALOG_COLLECTION,
]);

class ProjectionValidationChangedError extends Error {
  constructor(scopeKey: string) {
    super(`Projection validation generation changed for ${scopeKey}`);
    this.name = "ProjectionValidationChangedError";
  }
}

export function isProjectionValidationChangedError(
  error: unknown,
): boolean {
  return error instanceof ProjectionValidationChangedError;
}

export interface ProjectionValidationFence {
  documentStore: ProjectionCapableDocumentStore;
  run<T>(
    manifest: RecallProjectionManifest,
    operation: () => Promise<T>,
  ): Promise<T>;
}

function mutatesProjectionOutput(
  batch: ConditionalDocumentWriteBatch,
): boolean {
  return batch.set.some(({ collection }) =>
    PROJECTION_OUTPUT_COLLECTIONS.has(collection)
  ) || (batch.delete ?? []).some(({ collection }) =>
    PROJECTION_OUTPUT_COLLECTIONS.has(collection)
  );
}

export function createProjectionValidationFence(
  documentStore: ProjectionCapableDocumentStore,
): ProjectionValidationFence {
  const context = new AsyncLocalStorage<RecallProjectionManifest>();

  function manifestExpectation(manifest: RecallProjectionManifest) {
    return {
      collection: PROJECTION_MANIFESTS_COLLECTION,
      document: manifest,
      id: manifest.id,
    };
  }

  async function assertManifestUnchanged(
    manifest: RecallProjectionManifest,
  ): Promise<void> {
    const current = await documentStore.get<RecallProjectionManifest>(
      PROJECTION_MANIFESTS_COLLECTION,
      manifest.id,
    );
    if (!isDeepStrictEqual(current, manifest)) {
      throw new ProjectionValidationChangedError(manifest.scopeKey);
    }
  }

  async function setFenced(
    collection: string,
    id: string,
    document: StorageDocument,
    manifest: RecallProjectionManifest,
  ): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const existing = await documentStore.get<StorageDocument>(collection, id);
      const committed = await documentStore.writeBatchIfUnchanged({
        expected: { collection, document: existing, id },
        set: [{ collection, document, id }],
        unchanged: [manifestExpectation(manifest)],
      });
      if (committed) {
        return;
      }
      await assertManifestUnchanged(manifest);
    }
    throw new Error(
      `Projection output changed repeatedly during validation: ${collection}/${id}`,
    );
  }

  async function updateFenced<TDocument extends StorageDocument>(
    collection: string,
    id: string,
    patch: Partial<TDocument>,
    manifest: RecallProjectionManifest,
  ): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const existing = await documentStore.get<TDocument>(collection, id);
      if (!existing) {
        throw new Error(`Document not found for update: ${collection}/${id}`);
      }
      const document = shallowMergeDocument(existing, patch);
      const committed = await documentStore.writeBatchIfUnchanged({
        expected: { collection, document: existing, id },
        set: [{ collection, document, id }],
        unchanged: [manifestExpectation(manifest)],
      });
      if (committed) {
        return;
      }
      await assertManifestUnchanged(manifest);
    }
    throw new Error(
      `Projection output changed repeatedly during validation: ${collection}/${id}`,
    );
  }

  async function deleteFenced(
    collection: string,
    id: string,
    manifest: RecallProjectionManifest,
  ): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const existing = await documentStore.get<StorageDocument>(collection, id);
      if (!existing) {
        await assertManifestUnchanged(manifest);
        return;
      }
      const committed = await documentStore.writeBatchIfUnchanged({
        delete: [{ collection, id }],
        expected: { collection, document: existing, id },
        set: [],
        unchanged: [manifestExpectation(manifest)],
      });
      if (committed) {
        return;
      }
      await assertManifestUnchanged(manifest);
    }
    throw new Error(
      `Projection output changed repeatedly during validation: ${collection}/${id}`,
    );
  }

  const fenced: ProjectionCapableDocumentStore = {
    projectionBatchSemantics: PROJECTION_BATCH_SEMANTICS,
    querySnapshotBatchSemantics: documentStore.querySnapshotBatchSemantics,
    async set(collection, id, document) {
      const manifest = context.getStore();
      if (!manifest || !PROJECTION_OUTPUT_COLLECTIONS.has(collection)) {
        await documentStore.set(collection, id, document);
        return;
      }
      await setFenced(collection, id, document, manifest);
    },
    get(collection, id) {
      return documentStore.get(collection, id);
    },
    async update(collection, id, patch) {
      const manifest = context.getStore();
      if (!manifest || !PROJECTION_OUTPUT_COLLECTIONS.has(collection)) {
        await documentStore.update(collection, id, patch);
        return;
      }
      await updateFenced(collection, id, patch, manifest);
    },
    query(collection, filter) {
      return documentStore.query(collection, filter);
    },
    async delete(collection, id) {
      const manifest = context.getStore();
      if (!manifest || !PROJECTION_OUTPUT_COLLECTIONS.has(collection)) {
        await documentStore.delete(collection, id);
        return;
      }
      await deleteFenced(collection, id, manifest);
    },
    async writeBatchIfUnchanged(batch) {
      const manifest = context.getStore();
      if (!manifest || !mutatesProjectionOutput(batch)) {
        return documentStore.writeBatchIfUnchanged(batch);
      }
      const committed = await documentStore.writeBatchIfUnchanged({
        ...batch,
        unchanged: [
          ...(batch.unchanged ?? []),
          manifestExpectation(manifest),
        ],
      });
      if (!committed) {
        await assertManifestUnchanged(manifest);
      }
      return committed;
    },
  };

  const queryPage = documentStore.queryPage;
  if (queryPage) {
    fenced.queryPage = function queryPageFenced<
      TDocument extends StorageDocument,
    >(collection: string, input: DocumentQueryPageInput) {
      return queryPage<TDocument>(collection, input);
    };
  }
  const searchText = documentStore.searchText;
  if (searchText) {
    fenced.searchText = function searchTextFenced<
      TDocument extends StorageDocument,
    >(collection: string, input: DocumentTextSearchInput) {
      return searchText<TDocument>(collection, input);
    };
  }

  return {
    documentStore: fenced,
    run(manifest, operation) {
      return context.run(manifest, operation);
    },
  };
}
