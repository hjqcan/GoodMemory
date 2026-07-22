import { isDeepStrictEqual } from "node:util";

import { normalizeScope, scopeToKey } from "../domain/scope";
import type { MemoryScope } from "../domain/scope";
import type {
  ProjectionCapableDocumentStore,
  StorageDocument,
} from "./contracts";
import { PROJECTION_BATCH_SEMANTICS } from "./contracts";

export const SCOPE_DELETION_LOCKS_COLLECTION = "scope_deletion_locks_v1";
const DEFAULT_SCOPE_DELETION_LEASE_MS = 60_000;

interface ScopeDeletionLock extends StorageDocument {
  agentId?: string;
  epoch?: number;
  generation?: string;
  id: string;
  leaseExpiresAt?: number;
  operationId?: string;
  ownerId?: string;
  phase?: "delete_all" | "open" | "release";
  sessionId?: string;
  state?: "deleting" | "open";
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
}

const OPTIONAL_SCOPE_KEYS = [
  "tenantId",
  "workspaceId",
  "agentId",
  "sessionId",
] as const;

function documentScope(document: StorageDocument): MemoryScope | null {
  const outer = document as Partial<MemoryScope> & { scope?: unknown };
  const record = typeof outer.userId === "string"
    ? outer
    : typeof outer.scope === "object" && outer.scope !== null
    ? outer.scope as Partial<MemoryScope>
    : null;
  if (!record) {
    return null;
  }
  if (typeof record.userId !== "string" || record.userId.trim().length === 0) {
    return null;
  }

  return normalizeScope({
    userId: record.userId,
    ...(typeof record.tenantId === "string" ? { tenantId: record.tenantId } : {}),
    ...(typeof record.workspaceId === "string"
      ? { workspaceId: record.workspaceId }
      : {}),
    ...(typeof record.agentId === "string" ? { agentId: record.agentId } : {}),
    ...(typeof record.sessionId === "string" ? { sessionId: record.sessionId } : {}),
  });
}

export function scopeDeletionLockId(scope: MemoryScope): string {
  return scopeToKey(normalizeScope(scope));
}

export function scopeDeletionLockIdsForDocument(
  document: StorageDocument,
): string[] {
  const scope = documentScope(document);
  if (!scope) {
    return [];
  }

  const present = OPTIONAL_SCOPE_KEYS.filter((key) => scope[key] !== undefined);
  const ids = new Set<string>();
  for (let mask = 0; mask < 2 ** present.length; mask += 1) {
    const candidate: MemoryScope = { userId: scope.userId };
    present.forEach((key, index) => {
      if ((mask & (1 << index)) !== 0) {
        candidate[key] = scope[key];
      }
    });
    ids.add(scopeDeletionLockId(candidate));
  }
  return [...ids];
}

export interface ScopeDeletionCoordinator {
  runExclusive<T>(scope: MemoryScope, operation: () => Promise<T>): Promise<T>;
  runMutation<T>(scope: MemoryScope, operation: () => Promise<T>): Promise<T>;
}

interface ActiveScopeMutation {
  completion: Promise<void>;
  scope: MemoryScope;
}

interface ScopeMutationGate {
  deletions: Set<MemoryScope>;
  mutations: Set<ActiveScopeMutation>;
}

const SHARED_SCOPE_MUTATION_GATES = new WeakMap<object, ScopeMutationGate>();

function scopesOverlap(left: MemoryScope, right: MemoryScope): boolean {
  if (left.userId !== right.userId) {
    return false;
  }
  return OPTIONAL_SCOPE_KEYS.every((key) =>
    left[key] === undefined ||
    right[key] === undefined ||
    left[key] === right[key]
  );
}

function sharedScopeMutationGate(
  documentStore: ProjectionCapableDocumentStore,
): ScopeMutationGate {
  const identity = documentStore.scopeMutationFenceIdentity ?? documentStore;
  const existing = SHARED_SCOPE_MUTATION_GATES.get(identity);
  if (existing) {
    return existing;
  }
  const created: ScopeMutationGate = {
    deletions: new Set(),
    mutations: new Set(),
  };
  SHARED_SCOPE_MUTATION_GATES.set(identity, created);
  return created;
}

export function createScopeDeletionAwareDocumentStore(
  documentStore: ProjectionCapableDocumentStore,
  config: {
    allowLockedBatchSet?: (input: {
      batch: import("./contracts").ConditionalDocumentWriteBatch;
      operation: import("./contracts").DocumentWriteOperation;
    }) => boolean;
  } = {},
): ProjectionCapableDocumentStore {
  function isActiveLock(lock: ScopeDeletionLock | null): boolean {
    return lock !== null && lock.state !== "open";
  }

  async function addGuardSnapshots(
    snapshots: Map<string, ScopeDeletionLock | null>,
    documents: readonly StorageDocument[],
  ): Promise<void> {
    const ids = new Set(
      documents.flatMap((document) => scopeDeletionLockIdsForDocument(document)),
    );
    for (const id of ids) {
      if (snapshots.has(id)) {
        continue;
      }
      const lock = await documentStore.get<ScopeDeletionLock>(
        SCOPE_DELETION_LOCKS_COLLECTION,
        id,
      );
      if (isActiveLock(lock)) {
        throw new Error(`Memory deletion is in progress for scope ${id}`);
      }
      snapshots.set(id, lock);
    }
  }

  function guardConstraints(
    snapshots: ReadonlyMap<string, ScopeDeletionLock | null>,
  ) {
    return [...snapshots].map(([id, document]) => ({
      collection: SCOPE_DELETION_LOCKS_COLLECTION,
      document,
      id,
    }));
  }

  async function changedGuardId(
    snapshots: ReadonlyMap<string, ScopeDeletionLock | null>,
  ): Promise<string | null> {
    for (const [id, snapshot] of snapshots) {
      const current = await documentStore.get<ScopeDeletionLock>(
        SCOPE_DELETION_LOCKS_COLLECTION,
        id,
      );
      if (!isDeepStrictEqual(current, snapshot)) {
        return id;
      }
    }
    return null;
  }

  async function setWithGuards(
    collection: string,
    id: string,
    document: StorageDocument,
  ): Promise<void> {
    const guards = new Map<string, ScopeDeletionLock | null>();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const existing = await documentStore.get<StorageDocument>(collection, id);
      await addGuardSnapshots(
        guards,
        existing ? [existing, document] : [document],
      );
      const committed = await documentStore.writeBatchIfUnchanged({
        expected: { collection, document: existing, id },
        set: [{ collection, document, id }],
        unchanged: guardConstraints(guards),
      });
      if (committed) {
        return;
      }
      const changed = await changedGuardId(guards);
      if (changed) {
        throw new Error(
          `Memory deletion generation changed for scope ${changed}`,
        );
      }
    }
    throw new Error(`Document changed repeatedly while setting ${collection}/${id}`);
  }

  return {
    projectionBatchSemantics: PROJECTION_BATCH_SEMANTICS,
    set: setWithGuards,
    get(collection, id) {
      return documentStore.get(collection, id);
    },
    async update(collection, id, patch) {
      const guards = new Map<string, ScopeDeletionLock | null>();
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const existing = await documentStore.get<StorageDocument>(collection, id);
        if (!existing) {
          const unchanged = await documentStore.writeBatchIfUnchanged({
            expected: { collection, document: null, id },
            set: [],
          });
          if (unchanged) {
            return;
          }
          continue;
        }
        const updated = { ...existing, ...patch };
        await addGuardSnapshots(guards, [existing, updated]);
        const committed = await documentStore.writeBatchIfUnchanged({
          expected: { collection, document: existing, id },
          set: [{ collection, document: updated, id }],
          unchanged: guardConstraints(guards),
        });
        if (committed) {
          return;
        }
        const changed = await changedGuardId(guards);
        if (changed) {
          throw new Error(
            `Memory deletion generation changed for scope ${changed}`,
          );
        }
      }
      throw new Error(
        `Document changed repeatedly while updating ${collection}/${id}`,
      );
    },
    query(collection, filter) {
      return documentStore.query(collection, filter);
    },
    ...(documentStore.queryPage
      ? {
          queryPage(collection, input) {
            return documentStore.queryPage!(collection, input);
          },
        }
      : {}),
    ...(documentStore.searchText
      ? {
          searchText(collection, input) {
            return documentStore.searchText!(collection, input);
          },
        }
      : {}),
    async writeBatchIfUnchanged(input) {
      const guards = new Map<string, ScopeDeletionLock | null>();
      const predecessorConstraints = [];
      for (const operation of input.set) {
        const existing = await documentStore.get<StorageDocument>(
          operation.collection,
          operation.id,
        );
        predecessorConstraints.push({
          collection: operation.collection,
          document: existing,
          id: operation.id,
        });
        if (config.allowLockedBatchSet?.({ batch: input, operation })) {
          continue;
        }
        await addGuardSnapshots(
          guards,
          existing ? [existing, operation.document] : [operation.document],
        );
      }
      const committed = await documentStore.writeBatchIfUnchanged({
        ...input,
        unchanged: [
          ...(input.unchanged ?? []),
          ...predecessorConstraints,
          ...guardConstraints(guards),
        ],
      });
      if (!committed) {
        const changed = await changedGuardId(guards);
        if (changed) {
          throw new Error(
            `Memory deletion generation changed for scope ${changed}`,
          );
        }
        return false;
      }
      return true;
    },
    delete(collection, id) {
      return documentStore.delete(collection, id);
    },
  };
}

export function createScopeDeletionCoordinator(
  documentStore: ProjectionCapableDocumentStore,
): ScopeDeletionCoordinator {
  const gate = sharedScopeMutationGate(documentStore);

  async function runWithPersistentLock<T>(
    scope: MemoryScope,
    operation: () => Promise<T>,
  ): Promise<T> {
    const id = scopeDeletionLockId(scope);
    const lock: ScopeDeletionLock = {
      generation: crypto.randomUUID(),
      id,
      operationId: crypto.randomUUID(),
      state: "deleting",
    };
    let acquired = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const existing = await documentStore.get<ScopeDeletionLock>(
        SCOPE_DELETION_LOCKS_COLLECTION,
        id,
      );
      if (existing && existing.state !== "open") {
        throw new Error(
          `Memory deletion is already in progress for scope ${id}`,
        );
      }
      acquired = await documentStore.writeBatchIfUnchanged({
        expected: {
          collection: SCOPE_DELETION_LOCKS_COLLECTION,
          document: existing,
          id,
        },
        set: [{
          collection: SCOPE_DELETION_LOCKS_COLLECTION,
          document: lock,
          id,
        }],
      });
      if (acquired) {
        break;
      }
    }
    if (!acquired) {
      throw new Error(`Memory deletion lock changed repeatedly for scope ${id}`);
    }

    try {
      return await operation();
    } finally {
      const released = await documentStore.writeBatchIfUnchanged({
        expected: {
          collection: SCOPE_DELETION_LOCKS_COLLECTION,
          document: lock,
          id,
        },
        set: [{
          collection: SCOPE_DELETION_LOCKS_COLLECTION,
          document: {
            generation: crypto.randomUUID(),
            id,
            state: "open",
          } satisfies ScopeDeletionLock,
          id,
        }],
      });
      if (!released) {
        throw new Error(`Memory deletion lock changed before release for ${id}`);
      }
    }
  }

  return {
    async runMutation<T>(
      scope: MemoryScope,
      operation: () => Promise<T>,
    ): Promise<T> {
      const normalized = normalizeScope(scope);
      if ([...gate.deletions].some((deletionScope) =>
        scopesOverlap(deletionScope, normalized)
      )) {
        throw new Error(
          `Memory deletion is in progress for scope ${scopeDeletionLockId(normalized)}`,
        );
      }
      let finish = () => {};
      const mutation: ActiveScopeMutation = {
        completion: new Promise<void>((resolve) => {
          finish = resolve;
        }),
        scope: normalized,
      };
      gate.mutations.add(mutation);
      try {
        return await operation();
      } finally {
        gate.mutations.delete(mutation);
        finish();
      }
    },
    async runExclusive<T>(
      scope: MemoryScope,
      operation: () => Promise<T>,
    ): Promise<T> {
      const normalized = normalizeScope(scope);
      if ([...gate.deletions].some((deletionScope) =>
        scopesOverlap(deletionScope, normalized)
      )) {
        throw new Error(
          `Memory deletion is already in progress for scope ${scopeDeletionLockId(normalized)}`,
        );
      }
      gate.deletions.add(normalized);
      try {
        await Promise.all([...gate.mutations]
          .filter(({ scope: mutationScope }) =>
            scopesOverlap(normalized, mutationScope)
          )
          .map(({ completion }) => completion));
        return await runWithPersistentLock(normalized, operation);
      } finally {
        gate.deletions.delete(normalized);
      }
    },
  };
}
