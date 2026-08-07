import { createHash } from "node:crypto";

import { normalizeScope } from "../domain/scope";
import type { MemoryScope } from "../domain/scope";
import {
  isProjectionCapableDocumentStore,
  type ConditionalDocumentWriteBatch,
  type DocumentStore,
  type ProjectionCapableDocumentStore,
  type StorageDocument,
} from "../storage/contracts";
import type {
  PreparedRememberDocumentBatch,
  RollbackAction,
} from "./contracts";

export const REMEMBER_WRITE_OWNERS_COLLECTION = "remember_write_owners_v1";
export const PREFERENCE_CATEGORY_FENCE_KIND = "preference_category_fence";
const MAX_WRITE_CONFLICT_RETRIES = 8;

interface RememberWriteOwner extends StorageDocument {
  id: string;
  kind: "document_write_owner";
  operationId: string;
  writeId: string;
}

export interface PreferenceCategoryFence {
  agentId?: string;
  category: string;
  tenantId?: string;
  userId: string;
  workspaceId?: string;
}

export interface PreferenceCategoryFenceRecord
  extends PreferenceCategoryFence, StorageDocument {
  id: string;
  kind: typeof PREFERENCE_CATEGORY_FENCE_KIND;
  operationId: string;
  writeId: string;
}

function ownerId(collection: string, id: string): string {
  return `owner_${createHash("sha256")
    .update(collection)
    .update("\u0000")
    .update(id)
    .digest("hex")}`;
}

export function createPreferenceCategoryFence(
  scope: MemoryScope,
  category: string,
): PreferenceCategoryFence {
  const normalized = normalizeScope(scope);
  return {
    agentId: normalized.agentId,
    category,
    tenantId: normalized.tenantId,
    userId: normalized.userId,
    workspaceId: normalized.workspaceId,
  };
}

function preferenceCategoryFenceId(fence: PreferenceCategoryFence): string {
  return ownerId(
    PREFERENCE_CATEGORY_FENCE_KIND,
    JSON.stringify([
      fence.userId,
      fence.tenantId ?? "",
      fence.workspaceId ?? "",
      fence.agentId ?? "",
      fence.category,
    ]),
  );
}

function prepareBatchRollback(
  documentStore: ProjectionCapableDocumentStore,
  markerId: string,
  previousFence: PreferenceCategoryFenceRecord | null,
  fenceRecord: PreferenceCategoryFenceRecord,
  batch: ConditionalDocumentWriteBatch,
): RollbackAction {
  const snapshots = new Map<
    string,
    ConditionalDocumentWriteBatch["expected"]
  >(
    [batch.expected, ...(batch.unchanged ?? [])].map((snapshot) => [
      `${snapshot.collection}\u0000${snapshot.id}`,
      snapshot,
    ] as const),
  );
  const finalDocuments = new Map<string, {
    collection: string;
    document: StorageDocument | null;
    id: string;
  }>();
  for (const operation of batch.set) {
    finalDocuments.set(`${operation.collection}\u0000${operation.id}`, {
      collection: operation.collection,
      document: operation.document,
      id: operation.id,
    });
  }
  for (const operation of batch.delete ?? []) {
    finalDocuments.set(`${operation.collection}\u0000${operation.id}`, {
      collection: operation.collection,
      document: null,
      id: operation.id,
    });
  }
  for (const mutationKey of finalDocuments.keys()) {
    if (!snapshots.has(mutationKey)) {
      throw new Error(
        `Remember batch mutation requires an expected snapshot: ${mutationKey}`,
      );
    }
  }

  return async () => {
    await documentStore.writeBatchIfUnchanged({
      expected: {
        collection: REMEMBER_WRITE_OWNERS_COLLECTION,
        document: fenceRecord,
        id: markerId,
      },
      unchanged: [...finalDocuments.values()],
      set: [
        ...[...finalDocuments.keys()].flatMap((mutationKey) => {
          const snapshot = snapshots.get(mutationKey)!;
          return snapshot.document
            ? [{
                collection: snapshot.collection,
                document: snapshot.document,
                id: snapshot.id,
              }]
            : [];
        }),
        ...(previousFence
          ? [{
              collection: REMEMBER_WRITE_OWNERS_COLLECTION,
              document: previousFence,
              id: markerId,
            }]
          : []),
      ],
      delete: [
        ...[...finalDocuments.keys()].flatMap((mutationKey) => {
          const snapshot = snapshots.get(mutationKey)!;
          return snapshot.document === null
            ? [{ collection: snapshot.collection, id: snapshot.id }]
            : [];
        }),
        ...(!previousFence
          ? [{ collection: REMEMBER_WRITE_OWNERS_COLLECTION, id: markerId }]
          : []),
      ],
    });
  };
}

export async function writePreferenceCategoryBatch<TResult>(input: {
  documentStore: DocumentStore;
  fence: PreferenceCategoryFence;
  prepare: () => Promise<PreparedRememberDocumentBatch<TResult>>;
  rollbackActions?: RollbackAction[];
}): Promise<TResult> {
  const writeBatchIfUnchanged = input.documentStore.writeBatchIfUnchanged?.bind(
    input.documentStore,
  );
  if (!writeBatchIfUnchanged) {
    throw new Error("Preference category writes require conditional batches.");
  }
  const markerId = preferenceCategoryFenceId(input.fence);
  const fenceRecord: PreferenceCategoryFenceRecord = {
    ...input.fence,
    id: markerId,
    kind: PREFERENCE_CATEGORY_FENCE_KIND,
    operationId: crypto.randomUUID(),
    writeId: crypto.randomUUID(),
  };

  for (let attempt = 0; attempt < MAX_WRITE_CONFLICT_RETRIES; attempt += 1) {
    const previousFence = await input.documentStore.get<
      PreferenceCategoryFenceRecord
    >(REMEMBER_WRITE_OWNERS_COLLECTION, markerId);
    const prepared = await input.prepare();
    const rollback = prepareBatchRollback(
      input.documentStore as ProjectionCapableDocumentStore,
      markerId,
      previousFence,
      fenceRecord,
      prepared.batch,
    );
    let committed: boolean;
    try {
      committed = await writeBatchIfUnchanged({
        expected: {
          collection: REMEMBER_WRITE_OWNERS_COLLECTION,
          document: previousFence,
          id: markerId,
        },
        unchanged: [
          prepared.batch.expected,
          ...(prepared.batch.unchanged ?? []),
        ],
        set: [
          ...prepared.batch.set,
          {
            collection: REMEMBER_WRITE_OWNERS_COLLECTION,
            document: fenceRecord,
            id: markerId,
          },
        ],
        delete: prepared.batch.delete,
      });
    } catch (error) {
      const currentFence = await input.documentStore.get<
        PreferenceCategoryFenceRecord
      >(REMEMBER_WRITE_OWNERS_COLLECTION, markerId);
      if (currentFence?.writeId !== fenceRecord.writeId) {
        throw error;
      }
      if (input.rollbackActions) {
        input.rollbackActions.push(rollback);
        throw error;
      }
      return prepared.result;
    }
    if (committed) {
      input.rollbackActions?.push(rollback);
      return prepared.result;
    }
  }

  throw new Error(
    `Preference category changed repeatedly: ${input.fence.category}`,
  );
}

export interface RememberWriteCoordinator {
  deleteDocument(collection: string, id: string): Promise<void>;
  releaseOwnership(): Promise<void>;
  rollbackActions: RollbackAction[];
  setDocument<TDocument extends object>(
    collection: string,
    id: string,
    document: TDocument,
  ): Promise<void>;
  writeDocumentBatchWithRollback<TResult>(
    fence: PreferenceCategoryFence,
    prepare: () => Promise<PreparedRememberDocumentBatch<TResult>>,
  ): Promise<TResult>;
}

export function createRememberWriteCoordinator(
  documentStore: DocumentStore,
): RememberWriteCoordinator {
  const atomicStore: ProjectionCapableDocumentStore | null =
    isProjectionCapableDocumentStore(documentStore) ? documentStore : null;
  const operationId = crypto.randomUUID();
  const ownedMarkers = new Map<string, RememberWriteOwner>();
  const rollbackActions: RollbackAction[] = [];

  async function commitOwnedBatch(
    id: string,
    owner: RememberWriteOwner,
    batch: ConditionalDocumentWriteBatch,
    rollback: RollbackAction,
  ): Promise<boolean> {
    if (!atomicStore) {
      return false;
    }

    const recordOwnership = (): void => {
      ownedMarkers.set(id, owner);
      rollbackActions.push(rollback);
    };
    try {
      const committed = await atomicStore.writeBatchIfUnchanged(batch);
      if (committed) {
        recordOwnership();
      }
      return committed;
    } catch (error) {
      const current = await atomicStore.get<RememberWriteOwner>(
        REMEMBER_WRITE_OWNERS_COLLECTION,
        id,
      );
      if (current?.writeId === owner.writeId) {
        recordOwnership();
      }
      throw error;
    }
  }

  async function setDocumentFallback<TDocument extends object>(
    collection: string,
    id: string,
    document: TDocument,
  ): Promise<void> {
    const previous = await documentStore.get<StorageDocument>(collection, id);
    rollbackActions.push(async () => {
      if (previous) {
        await documentStore.set(collection, id, previous);
        return;
      }
      await documentStore.delete(collection, id);
    });
    await documentStore.set(collection, id, document);
  }

  async function deleteDocumentFallback(
    collection: string,
    id: string,
  ): Promise<void> {
    const previous = await documentStore.get<StorageDocument>(collection, id);
    if (!previous) {
      return;
    }
    rollbackActions.push(async () => {
      await documentStore.set(collection, id, previous);
    });
    await documentStore.delete(collection, id);
  }

  return {
    rollbackActions,
    async setDocument(collection, id, document) {
      if (!atomicStore) {
        await setDocumentFallback(collection, id, document);
        return;
      }

      const markerId = ownerId(collection, id);
      const owner: RememberWriteOwner = {
        id: markerId,
        kind: "document_write_owner",
        operationId,
        writeId: crypto.randomUUID(),
      };
      for (let attempt = 0; attempt < MAX_WRITE_CONFLICT_RETRIES; attempt += 1) {
        const [previous, previousOwner] = await Promise.all([
          atomicStore.get<StorageDocument>(collection, id),
          atomicStore.get<RememberWriteOwner>(
            REMEMBER_WRITE_OWNERS_COLLECTION,
            markerId,
          ),
        ]);
        const committed = await commitOwnedBatch(
          markerId,
          owner,
          {
            expected: { collection, document: previous, id },
            unchanged: [{
              collection: REMEMBER_WRITE_OWNERS_COLLECTION,
              document: previousOwner,
              id: markerId,
            }],
            set: [
              { collection, document, id },
              {
                collection: REMEMBER_WRITE_OWNERS_COLLECTION,
                document: owner,
                id: markerId,
              },
            ],
          },
          async () => {
            await atomicStore.writeBatchIfUnchanged({
              expected: {
                collection: REMEMBER_WRITE_OWNERS_COLLECTION,
                document: owner,
                id: markerId,
              },
              unchanged: [{ collection, document, id }],
              set: [
                ...(previous ? [{ collection, document: previous, id }] : []),
                ...(previousOwner
                  ? [{
                      collection: REMEMBER_WRITE_OWNERS_COLLECTION,
                      document: previousOwner,
                      id: markerId,
                    }]
                  : []),
              ],
              delete: [
                ...(!previous ? [{ collection, id }] : []),
                ...(!previousOwner
                  ? [{
                      collection: REMEMBER_WRITE_OWNERS_COLLECTION,
                      id: markerId,
                    }]
                  : []),
              ],
            });
          },
        );
        if (committed) {
          return;
        }
      }

      throw new Error(`Remember write changed repeatedly: ${collection}/${id}`);
    },
    async deleteDocument(collection, id) {
      if (!atomicStore) {
        await deleteDocumentFallback(collection, id);
        return;
      }

      const markerId = ownerId(collection, id);
      const owner: RememberWriteOwner = {
        id: markerId,
        kind: "document_write_owner",
        operationId,
        writeId: crypto.randomUUID(),
      };
      for (let attempt = 0; attempt < MAX_WRITE_CONFLICT_RETRIES; attempt += 1) {
        const [previous, previousOwner] = await Promise.all([
          atomicStore.get<StorageDocument>(collection, id),
          atomicStore.get<RememberWriteOwner>(
            REMEMBER_WRITE_OWNERS_COLLECTION,
            markerId,
          ),
        ]);
        if (!previous) {
          return;
        }
        const committed = await commitOwnedBatch(
          markerId,
          owner,
          {
            expected: { collection, document: previous, id },
            unchanged: [{
              collection: REMEMBER_WRITE_OWNERS_COLLECTION,
              document: previousOwner,
              id: markerId,
            }],
            set: [{
              collection: REMEMBER_WRITE_OWNERS_COLLECTION,
              document: owner,
              id: markerId,
            }],
            delete: [{ collection, id }],
          },
          async () => {
            await atomicStore.writeBatchIfUnchanged({
              expected: {
                collection: REMEMBER_WRITE_OWNERS_COLLECTION,
                document: owner,
                id: markerId,
              },
              unchanged: [{ collection, document: null, id }],
              set: [
                { collection, document: previous, id },
                ...(previousOwner
                  ? [{
                      collection: REMEMBER_WRITE_OWNERS_COLLECTION,
                      document: previousOwner,
                      id: markerId,
                    }]
                  : []),
              ],
              ...(!previousOwner
                ? {
                    delete: [{
                      collection: REMEMBER_WRITE_OWNERS_COLLECTION,
                      id: markerId,
                    }],
                  }
                : {}),
            });
          },
        );
        if (committed) {
          return;
        }
      }

      throw new Error(`Remember delete changed repeatedly: ${collection}/${id}`);
    },
    async writeDocumentBatchWithRollback(fence, prepare) {
      if (!atomicStore) {
        // Custom stores without conditional batches only support local,
        // best-effort rollback. They do not serialize preference writers
        // across runtimes or processes.
        const prepared = await prepare();
        for (const operation of prepared.batch.set) {
          await setDocumentFallback(
            operation.collection,
            operation.id,
            operation.document,
          );
        }
        for (const operation of prepared.batch.delete ?? []) {
          await deleteDocumentFallback(operation.collection, operation.id);
        }
        return prepared.result;
      }
      return writePreferenceCategoryBatch({
        documentStore: atomicStore,
        fence,
        prepare,
        rollbackActions,
      });
    },
    async releaseOwnership() {
      if (!atomicStore) {
        return;
      }
      for (const [id, owner] of ownedMarkers) {
        try {
          await atomicStore.writeBatchIfUnchanged({
            expected: {
              collection: REMEMBER_WRITE_OWNERS_COLLECTION,
              document: owner,
              id,
            },
            set: [],
            delete: [{ collection: REMEMBER_WRITE_OWNERS_COLLECTION, id }],
          });
        } catch (error) {
          console.error("[goodmemory:remember] failed to release write ownership", {
            error: error instanceof Error ? error.message : String(error),
            ownerId: id,
          });
        }
      }
    },
  };
}
