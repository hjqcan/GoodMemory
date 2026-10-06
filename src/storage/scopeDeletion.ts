import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";

import { LegacyScopeKeyError, legacyScopeToKey, normalizeScope, parseScopeKey, scopeToKey } from "../domain/scope";
import type { MemoryScope } from "../domain/scope";
import type {
  ProjectionCapableDocumentStore,
  StorageDocument,
} from "./contracts";
import { PROJECTION_BATCH_SEMANTICS } from "./contracts";

export const SCOPE_DELETION_LOCKS_COLLECTION = "scope_deletion_locks_v1";
export const SCOPE_MUTATION_BARRIERS_COLLECTION = "scope_mutation_barriers_v1";
export const SCOPE_MUTATION_INTENTS_COLLECTION = "scope_mutation_intents_v1";
const MUTATION_DRAIN_POLL_MS = 5;
const LEGACY_DELETION_CLAIMS_COLLECTION = "scope_deletion_legacy_claims_v1";

export interface ScopeDeletionLock extends StorageDocument {
  agentId?: string;
  epoch?: number;
  generation?: string;
  id: string;
  operationId?: string;
  operationKey?: string;
  ownerId?: string;
  phase?: "delete_all" | "open";
  sessionId?: string;
  state?: "deleting" | "failed" | "open";
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
}

interface ScopeMutationIntent extends StorageDocument {
  agentId?: string;
  id: string;
  operationId: string;
  ownerId: string;
  sessionId?: string;
  tenantId?: string;
  userId: string;
  workspaceId?: string;
}

interface ScopeMutationContext {
  id: string;
  operationId: string;
  scope: MemoryScope;
}

const SCOPE_MUTATION_CONTEXT = new AsyncLocalStorage<ScopeMutationContext>();

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

function scopeMutationBarrierId(scope: MemoryScope): string {
  return scopeDeletionLockId({ userId: normalizeScope(scope).userId });
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
    ids.add(legacyScopeToKey(candidate));
  }
  return [...ids];
}

export interface RecoverLegacyDeletionJournalInput {
  confirmPriorRuntimesStopped: true;
  confirmTrustedOwnership: true;
  expectedBarrier: ScopeDeletionLock;
  expectedLock: ScopeDeletionLock;
  scope: MemoryScope;
}

export interface ScopeDeletionCoordinator {
  recoverLegacyDeletionJournal?(input: RecoverLegacyDeletionJournalInput): Promise<boolean>;
  runExclusive<T>(
    scope: MemoryScope,
    operation: () => Promise<T>,
    options?: ScopeDeletionRunOptions,
  ): Promise<T>;
  runMutation<T>(scope: MemoryScope, operation: () => Promise<T>): Promise<T>;
}

export interface RecoveryCapableScopeDeletionCoordinator extends ScopeDeletionCoordinator {
  recoverLegacyDeletionJournal(input: RecoverLegacyDeletionJournalInput): Promise<boolean>;
}

export interface ScopeDeletionRunOptions {
  operationKey?: string;
  resumeInterrupted?: {
    confirmPriorRuntimesStopped: true;
  };
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

function isActiveLock(lock: ScopeDeletionLock | null): boolean {
  return lock !== null && lock.state !== "open";
}

function lockScope(lock: ScopeDeletionLock): MemoryScope | null {
  if (typeof lock.userId !== "string" || lock.userId.trim().length === 0) {
    return null;
  }
  return normalizeScope({
    userId: lock.userId,
    ...(lock.tenantId ? { tenantId: lock.tenantId } : {}),
    ...(lock.workspaceId ? { workspaceId: lock.workspaceId } : {}),
    ...(lock.agentId ? { agentId: lock.agentId } : {}),
    ...(lock.sessionId ? { sessionId: lock.sessionId } : {}),
  });
}

function assertLegacyLockOwnership(lock: ScopeDeletionLock, collection: string): void {
  const owner = lockScope(lock);
  if (!parseScopeKey(lock.id) && (!owner || (
    legacyScopeToKey(owner) !== lock.id &&
    !(collection === SCOPE_MUTATION_BARRIERS_COLLECTION &&
      legacyScopeToKey({ userId: owner.userId }) === lock.id)
  ))) {
    throw new LegacyScopeKeyError(
      lock.id,
      "A legacy deletion fence has missing or inconsistent scope ownership. Its journal " +
        "is preserved; use recoverLegacyDeletionJournal with verified ownership " +
        "and exact lock/barrier snapshots before interrupted-deletion recovery.",
    );
  }
}

interface LegacyDeletionClaim extends StorageDocument {
  id: string;
  legacyKey: string;
  originalDocument: ScopeDeletionLock;
  scope: MemoryScope;
  scopeKey: string;
  sourceCollection: string;
  schemaVersion: 1;
}

function deletionClaimId(collection: string, id: string): string {
  return JSON.stringify([collection, id]);
}

async function resolveLegacyFence(
  documentStore: ProjectionCapableDocumentStore,
  collection: string,
  lock: ScopeDeletionLock | null,
): Promise<ScopeDeletionLock | null> {
  if (!lock || !isActiveLock(lock) || parseScopeKey(lock.id)) {
    return lock;
  }
  try {
    assertLegacyLockOwnership(lock, collection);
    return lock;
  } catch (error) {
    if (!(error instanceof LegacyScopeKeyError)) {
      throw error;
    }
    const id = deletionClaimId(collection, lock.id);
    const claim = await documentStore.get<LegacyDeletionClaim>(LEGACY_DELETION_CLAIMS_COLLECTION, id);
    if (!claim || claim.schemaVersion !== 1 || claim.id !== id ||
      claim.sourceCollection !== collection || claim.legacyKey !== lock.id ||
      !isDeepStrictEqual(claim.originalDocument, lock)) {
      throw error;
    }
    const resolved = { ...lock, ...normalizeScope(claim.scope) };
    if (scopeToKey(claim.scope) !== claim.scopeKey) {
      throw error;
    }
    assertLegacyLockOwnership(resolved, collection);
    return resolved;
  }
}

function activeLockOverlaps(
  lock: ScopeDeletionLock | null,
  scope: MemoryScope,
  collection = SCOPE_DELETION_LOCKS_COLLECTION,
): boolean {
  if (!isActiveLock(lock) || !lock) {
    return false;
  }
  assertLegacyLockOwnership(lock, collection);
  const persistedScope = lockScope(lock);
  return !persistedScope || scopesOverlap(persistedScope, scope);
}

interface ScopeGuardSnapshot {
  collection: string;
  document: ScopeDeletionLock | null;
  id: string;
}

async function activePersistentLock(
  documentStore: ProjectionCapableDocumentStore,
  scope: MemoryScope,
): Promise<ScopeDeletionLock | null> {
  const normalized = normalizeScope(scope);
  const directIds = scopeDeletionLockIdsForDocument(normalized);
  const directLocks = await Promise.all(directIds.map((id) =>
    documentStore.get<ScopeDeletionLock>(SCOPE_DELETION_LOCKS_COLLECTION, id)
  ));
  const scopedLocks = await documentStore.query<ScopeDeletionLock>(
    SCOPE_DELETION_LOCKS_COLLECTION,
    { userId: normalized.userId },
  );
  const locks = new Map<string, ScopeDeletionLock>();
  for (const lock of [...directLocks, ...scopedLocks]) {
    if (lock) {
      locks.set(lock.id, lock);
    }
  }
  for (const lock of locks.values()) {
    const resolved = await resolveLegacyFence(documentStore, SCOPE_DELETION_LOCKS_COLLECTION, lock);
    if (activeLockOverlaps(resolved, normalized)) {
      return lock;
    }
  }
  return null;
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
  async function addGuardSnapshots(
    snapshots: Map<string, ScopeGuardSnapshot>,
    documents: readonly StorageDocument[],
  ): Promise<void> {
    for (const document of documents) {
      const scope = documentScope(document);
      if (!scope) {
        continue;
      }
      const references = [
        ...scopeDeletionLockIdsForDocument(document).map((id) => ({
          collection: SCOPE_DELETION_LOCKS_COLLECTION,
          id,
        })),
        ...[scopeMutationBarrierId(scope), legacyScopeToKey({ userId: scope.userId })]
          .map((id) => ({ collection: SCOPE_MUTATION_BARRIERS_COLLECTION, id })),
      ];
      for (const reference of references) {
        const key = JSON.stringify([reference.collection, reference.id]);
        const snapshot = snapshots.get(key) ?? {
          ...reference,
          document: await documentStore.get<ScopeDeletionLock>(reference.collection, reference.id),
        };
        const lock = await resolveLegacyFence(documentStore, reference.collection, snapshot.document);
        if (activeLockOverlaps(lock, scope, reference.collection)) {
          const mutation = SCOPE_MUTATION_CONTEXT.getStore();
          const persistedMutation = mutation
            ? await documentStore.get<ScopeMutationIntent>(
                SCOPE_MUTATION_INTENTS_COLLECTION,
                mutation.id,
              )
            : null;
          const deletionScope = lock ? lockScope(lock) : null;
          if (
            mutation &&
            persistedMutation?.operationId === mutation.operationId &&
            deletionScope &&
            scopesOverlap(deletionScope, mutation.scope)
          ) {
            continue;
          }
          throw new Error(`Memory deletion is in progress for scope ${reference.id}`);
        }
        snapshots.set(key, snapshot);
      }
    }
  }

  function guardConstraints(snapshots: ReadonlyMap<string, ScopeGuardSnapshot>) {
    return [...snapshots.values()];
  }

  async function changedGuardId(
    snapshots: ReadonlyMap<string, ScopeGuardSnapshot>,
  ): Promise<string | null> {
    for (const snapshot of snapshots.values()) {
      const current = await documentStore.get<ScopeDeletionLock>(
        snapshot.collection,
        snapshot.id,
      );
      if (!isDeepStrictEqual(current, snapshot.document)) {
        return snapshot.id;
      }
    }
    return null;
  }

  async function setWithGuards(
    collection: string,
    id: string,
    document: StorageDocument,
  ): Promise<void> {
    const guards = new Map<string, ScopeGuardSnapshot>();
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
    querySnapshotBatchSemantics: documentStore.querySnapshotBatchSemantics,
    scopeMutationFenceIdentity:
      documentStore.scopeMutationFenceIdentity ?? documentStore,
    set: setWithGuards,
    get(collection, id) {
      return documentStore.get(collection, id);
    },
    async update(collection, id, patch) {
      const guards = new Map<string, ScopeGuardSnapshot>();
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
      const guards = new Map<string, ScopeGuardSnapshot>();
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

export interface ScopeDeletionCoordinatorConfig {
  ownerId?: string;
}

export function createScopeDeletionCoordinator(
  documentStore: ProjectionCapableDocumentStore,
  config: ScopeDeletionCoordinatorConfig = {},
): RecoveryCapableScopeDeletionCoordinator {
  const gate = sharedScopeMutationGate(documentStore);
  const ownerId = config.ownerId ?? crypto.randomUUID();

  function localDeletion(scope: MemoryScope): boolean {
    return [...gate.deletions].some((deletionScope) =>
      scopesOverlap(deletionScope, scope)
    );
  }

  async function replaceLockPair(
    expectedLock: ScopeDeletionLock,
    expectedBarrier: ScopeDeletionLock,
    lock: ScopeDeletionLock,
    barrier: ScopeDeletionLock,
  ): Promise<boolean> {
    return documentStore.writeBatchIfUnchanged({
      expected: {
        collection: SCOPE_DELETION_LOCKS_COLLECTION,
        document: expectedLock,
        id: expectedLock.id,
      },
      set: [
        {
          collection: SCOPE_DELETION_LOCKS_COLLECTION,
          document: lock,
          id: expectedLock.id,
        },
        {
          collection: SCOPE_MUTATION_BARRIERS_COLLECTION,
          document: barrier,
          id: expectedBarrier.id,
        },
      ],
      unchanged: [{
        collection: SCOPE_MUTATION_BARRIERS_COLLECTION,
        document: expectedBarrier,
        id: expectedBarrier.id,
      }],
    });
  }

  function deletionJournalMatches(
    lock: ScopeDeletionLock,
    barrier: ScopeDeletionLock,
    scope: MemoryScope,
  ): boolean {
    const persistedScope = lockScope(lock);
    const barrierScope = lockScope(barrier);
    return (
      isActiveLock(lock) &&
      isActiveLock(barrier) &&
      (lock.state === "deleting" || lock.state === "failed") &&
      lock.phase === "delete_all" &&
      typeof lock.epoch === "number" &&
      typeof lock.generation === "string" &&
      typeof lock.operationId === "string" &&
      typeof lock.operationKey === "string" &&
      typeof lock.ownerId === "string" &&
      persistedScope !== null &&
      barrierScope !== null &&
      scopeDeletionLockId(persistedScope) === scopeDeletionLockId(scope) &&
      scopeDeletionLockId(barrierScope) === scopeDeletionLockId(scope) &&
      (barrier.id === scopeMutationBarrierId(scope) ||
        barrier.id === legacyScopeToKey({ userId: scope.userId })) &&
      (lock.id === scopeDeletionLockId(scope) || lock.id === legacyScopeToKey(scope)) &&
      lock.epoch === barrier.epoch &&
      lock.generation === barrier.generation &&
      lock.operationId === barrier.operationId &&
      lock.operationKey === barrier.operationKey &&
      lock.ownerId === barrier.ownerId &&
      lock.phase === barrier.phase &&
      lock.state === barrier.state
    );
  }

  async function listPersistentMutations(
    scope: MemoryScope,
  ): Promise<ScopeMutationIntent[]> {
    const intents = await documentStore.query<ScopeMutationIntent>(
      SCOPE_MUTATION_INTENTS_COLLECTION,
      { userId: scope.userId },
    );
    return intents.filter((intent) => {
      const mutationScope = lockScope(intent);
      return mutationScope && scopesOverlap(scope, mutationScope);
    });
  }

  async function drainPersistentMutations(scope: MemoryScope): Promise<void> {
    while (true) {
      const overlapping = await listPersistentMutations(scope);
      if (overlapping.length === 0) {
        return;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, MUTATION_DRAIN_POLL_MS);
      });
    }
  }

  async function runWithPersistentMutationIntent<T>(
    scope: MemoryScope,
    operation: () => Promise<T>,
  ): Promise<T> {
    const id = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const barrierId = scopeMutationBarrierId(scope);
    let ownedIntent: ScopeMutationIntent | null = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const legacyBarrierId = legacyScopeToKey({ userId: scope.userId });
      const [barrier, legacyBarrier] = await Promise.all([
        documentStore.get<ScopeDeletionLock>(SCOPE_MUTATION_BARRIERS_COLLECTION, barrierId),
        documentStore.get<ScopeDeletionLock>(SCOPE_MUTATION_BARRIERS_COLLECTION, legacyBarrierId),
      ]);
      const resolvedLegacyBarrier = await resolveLegacyFence(
        documentStore, SCOPE_MUTATION_BARRIERS_COLLECTION, legacyBarrier,
      );
      if (
        activeLockOverlaps(barrier, scope, SCOPE_MUTATION_BARRIERS_COLLECTION) ||
        activeLockOverlaps(resolvedLegacyBarrier, scope, SCOPE_MUTATION_BARRIERS_COLLECTION)
      ) {
        throw new Error(
          `Memory deletion is in progress for scope ${scopeDeletionLockId(scope)}`,
        );
      }
      const candidate: ScopeMutationIntent = {
        ...scope,
        id,
        operationId,
        ownerId,
      };
      const acquired = await documentStore.writeBatchIfUnchanged({
        expected: {
          collection: SCOPE_MUTATION_INTENTS_COLLECTION,
          document: null,
          id,
        },
        set: [{
          collection: SCOPE_MUTATION_INTENTS_COLLECTION,
          document: candidate,
          id,
        }],
        unchanged: [{
          collection: SCOPE_MUTATION_BARRIERS_COLLECTION,
          document: barrier,
          id: barrierId,
        }, {
          collection: SCOPE_MUTATION_BARRIERS_COLLECTION,
          document: legacyBarrier,
          id: legacyBarrierId,
        }],
      });
      if (acquired) {
        ownedIntent = candidate;
        break;
      }
    }
    if (!ownedIntent) {
      throw new Error(
        `Memory mutation intent changed repeatedly for scope ${scopeDeletionLockId(scope)}`,
      );
    }

    let outcome: { ok: true; value: T } | { error: unknown; ok: false };
    try {
      const value = await SCOPE_MUTATION_CONTEXT.run(
        { id, operationId, scope },
        operation,
      );
      outcome = { ok: true, value };
    } catch (error) {
      outcome = { error, ok: false };
    }
    const released = await documentStore.writeBatchIfUnchanged({
      delete: [{
        collection: SCOPE_MUTATION_INTENTS_COLLECTION,
        id,
      }],
      expected: {
        collection: SCOPE_MUTATION_INTENTS_COLLECTION,
        document: ownedIntent,
        id,
      },
      set: [],
    });
    if (!released) {
      throw new Error(
        `Memory mutation intent was lost before release for ${scopeDeletionLockId(scope)}`,
      );
    }
    if (!outcome.ok) {
      throw outcome.error;
    }
    return outcome.value;
  }

  async function runWithPersistentLock<T>(
    scope: MemoryScope,
    operation: () => Promise<T>,
    options: ScopeDeletionRunOptions,
  ): Promise<T> {
    const currentId = scopeDeletionLockId(scope);
    const currentBarrierId = scopeMutationBarrierId(scope);
    const legacyId = legacyScopeToKey(scope);
    const legacyBarrierId = legacyScopeToKey({ userId: scope.userId });
    let id = currentId;
    let barrierId = currentBarrierId;
    const operationId = crypto.randomUUID();
    const resumeInterrupted =
      options.resumeInterrupted?.confirmPriorRuntimesStopped === true;
    let ownedLock: ScopeDeletionLock | null = null;
    let ownedBarrier: ScopeDeletionLock | null = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const [current, currentBarrier, legacy, legacyBarrier, interruptedMutations] = await Promise.all([
        documentStore.get<ScopeDeletionLock>(SCOPE_DELETION_LOCKS_COLLECTION, currentId),
        documentStore.get<ScopeDeletionLock>(SCOPE_MUTATION_BARRIERS_COLLECTION, currentBarrierId),
        documentStore.get<ScopeDeletionLock>(SCOPE_DELETION_LOCKS_COLLECTION, legacyId),
        documentStore.get<ScopeDeletionLock>(SCOPE_MUTATION_BARRIERS_COLLECTION, legacyBarrierId),
        resumeInterrupted ? listPersistentMutations(scope) : Promise.resolve([]),
      ]);
      // Recover a validated old journal in place. Never create a parallel journal
      // or rewrite a legacy record whose owner cannot be established.
      const resolvedLegacy = await resolveLegacyFence(documentStore, SCOPE_DELETION_LOCKS_COLLECTION, legacy);
      const resolvedLegacyBarrier = await resolveLegacyFence(documentStore, SCOPE_MUTATION_BARRIERS_COLLECTION, legacyBarrier);
      const legacyLockActive = activeLockOverlaps(resolvedLegacy, scope);
      const legacyBarrierActive = activeLockOverlaps(
        resolvedLegacyBarrier, scope, SCOPE_MUTATION_BARRIERS_COLLECTION,
      );
      const useLegacy = legacyLockActive || legacyBarrierActive;
      if (useLegacy && (isActiveLock(current) || isActiveLock(currentBarrier))) {
        throw new Error(`Memory persistent deletion journal spans key versions for scope ${currentId}; reconcile both journals before recovery`);
      }
      id = useLegacy ? legacyId : currentId;
      barrierId = useLegacy ? legacyBarrierId : currentBarrierId;
      const existing = useLegacy ? legacy : current;
      const barrier = useLegacy ? legacyBarrier : currentBarrier;
      const otherSnapshots = useLegacy
        ? [
            { collection: SCOPE_DELETION_LOCKS_COLLECTION, document: current, id: currentId },
            { collection: SCOPE_MUTATION_BARRIERS_COLLECTION, document: currentBarrier, id: currentBarrierId },
          ]
        : [
            { collection: SCOPE_DELETION_LOCKS_COLLECTION, document: legacy, id: legacyId },
            { collection: SCOPE_MUTATION_BARRIERS_COLLECTION, document: legacyBarrier, id: legacyBarrierId },
          ];
      const operationKey = options.operationKey ?? `scope-deletion:v1:${id}`;
      const hasActiveLock = isActiveLock(existing);
      const hasActiveBarrier = isActiveLock(barrier);
      let canResume = false;
      if (
        resumeInterrupted &&
        (hasActiveLock || hasActiveBarrier)
      ) {
        if (
          !existing ||
          !barrier ||
          !deletionJournalMatches(
            useLegacy ? resolvedLegacy! : existing,
            useLegacy ? resolvedLegacyBarrier! : barrier,
            scope,
          )
        ) {
          throw new Error(
            `Memory persistent deletion journal is incomplete for scope ${id}`,
          );
        }
        if (existing.operationKey !== operationKey) {
          throw new Error(
            `Memory recovery request does not match the interrupted deletion contract for scope ${id}`,
          );
        }
        canResume = true;
      }
      if (
        hasActiveLock &&
        !canResume
      ) {
        throw new Error(
          `Memory deletion is already in progress for scope ${id}; automatic takeover is disabled`,
        );
      }
      if (
        hasActiveBarrier &&
        !canResume
      ) {
        throw new Error(
          `Memory deletion is already in progress for user ${scope.userId}; automatic takeover is disabled`,
        );
      }
      const candidate: ScopeDeletionLock = {
        ...scope,
        epoch: Math.max(existing?.epoch ?? 0, barrier?.epoch ?? 0) + 1,
        generation: crypto.randomUUID(),
        id,
        operationId,
        operationKey,
        ownerId,
        phase: "delete_all",
        state: "deleting",
      };
      const barrierCandidate: ScopeDeletionLock = {
        ...candidate,
        id: barrierId,
      };
      const acquired = await documentStore.writeBatchIfUnchanged({
        expected: {
          collection: SCOPE_DELETION_LOCKS_COLLECTION,
          document: existing,
          id,
        },
        set: [
          {
            collection: SCOPE_DELETION_LOCKS_COLLECTION,
            document: candidate,
            id,
          },
          {
            collection: SCOPE_MUTATION_BARRIERS_COLLECTION,
            document: barrierCandidate,
            id: barrierId,
          },
        ],
        ...(resumeInterrupted && interruptedMutations.length > 0
          ? {
              delete: interruptedMutations.map((intent) => ({
                collection: SCOPE_MUTATION_INTENTS_COLLECTION,
                id: intent.id,
              })),
            }
          : {}),
        unchanged: [
          ...otherSnapshots,
          {
            collection: SCOPE_MUTATION_BARRIERS_COLLECTION,
            document: barrier,
            id: barrierId,
          },
          ...interruptedMutations.map((intent) => ({
            collection: SCOPE_MUTATION_INTENTS_COLLECTION,
            document: intent,
            id: intent.id,
          })),
        ],
      });
      if (acquired) {
        ownedLock = candidate;
        ownedBarrier = barrierCandidate;
        break;
      }
      if (resumeInterrupted) {
        throw new Error(
          `Memory mutation journal changed during recovery for scope ${id}`,
        );
      }
    }
    if (!ownedLock || !ownedBarrier) {
      throw new Error(`Memory deletion lock changed repeatedly for scope ${id}`);
    }

    let outcome: { ok: true; value: T } | { error: unknown; ok: false };
    try {
      if (
        resumeInterrupted &&
        (await listPersistentMutations(scope)).length > 0
      ) {
        throw new Error(
          `Memory mutation journal changed during recovery for scope ${id}`,
        );
      }
      await drainPersistentMutations(scope);
      outcome = { ok: true, value: await operation() };
    } catch (error) {
      outcome = { error, ok: false };
    }
    if (!outcome.ok) {
      const failed: ScopeDeletionLock = {
        ...ownedLock,
        state: "failed",
      };
      const failedBarrier: ScopeDeletionLock = {
        ...ownedBarrier,
        state: "failed",
      };
      await replaceLockPair(
        ownedLock,
        ownedBarrier,
        failed,
        failedBarrier,
      );
      throw outcome.error;
    }

    const open: ScopeDeletionLock = {
      ...scope,
      epoch: ownedLock.epoch,
      generation: ownedLock.generation,
      id,
      operationKey: ownedLock.operationKey,
      phase: "open",
      state: "open",
    };
    const openBarrier: ScopeDeletionLock = {
      ...open,
      id: barrierId,
    };
    if (!await replaceLockPair(
      ownedLock,
      ownedBarrier,
      open,
      openBarrier,
    )) {
      const failed: ScopeDeletionLock = {
        ...ownedLock,
        state: "failed",
      };
      const failedBarrier: ScopeDeletionLock = {
        ...ownedBarrier,
        state: "failed",
      };
      await replaceLockPair(
        ownedLock,
        ownedBarrier,
        failed,
        failedBarrier,
      );
      throw new Error(`Memory deletion ownership changed before release for ${id}`);
    }
    return outcome.value;
  }

  return {
    async recoverLegacyDeletionJournal(recovery) {
      if (recovery.confirmTrustedOwnership !== true ||
        recovery.confirmPriorRuntimesStopped !== true) {
        throw new Error("Legacy deletion recovery requires trustworthy ownership and stopped prior runtimes.");
      }
      const scope = normalizeScope(recovery.scope);
      const scopeKey = scopeToKey(scope);
      const legacyId = legacyScopeToKey(scope);
      const legacyBarrierId = legacyScopeToKey({ userId: scope.userId });
      const expectedLock = recovery.expectedLock;
      const expectedBarrier = recovery.expectedBarrier;
      if (expectedLock.id !== legacyId || expectedBarrier.id !== legacyBarrierId) {
        return false;
      }
      for (const original of [expectedLock, expectedBarrier]) {
        const owner = lockScope(original);
        if (owner && scopeToKey(owner) !== scopeKey) {
          return false;
        }
      }
      if (!deletionJournalMatches(
        { ...expectedLock, ...scope }, { ...expectedBarrier, ...scope }, scope,
      )) {
        return false;
      }
      const references = [
        { collection: SCOPE_DELETION_LOCKS_COLLECTION, id: legacyId, expected: expectedLock },
        { collection: SCOPE_MUTATION_BARRIERS_COLLECTION, id: legacyBarrierId, expected: expectedBarrier },
      ];
      const snapshots = await Promise.all(references.map(async (reference) => ({
        ...reference,
        current: await documentStore.get<ScopeDeletionLock>(reference.collection, reference.id),
        claim: await documentStore.get<LegacyDeletionClaim>(
          LEGACY_DELETION_CLAIMS_COLLECTION, deletionClaimId(reference.collection, reference.id),
        ),
      })));
      if (snapshots.some(({ claim }) => claim !== null)) {
        return snapshots.every(({ collection, id, claim, current, expected }) =>
          claim?.schemaVersion === 1 && claim.id === deletionClaimId(collection, id) &&
          claim.scopeKey === scopeKey && claim.sourceCollection === collection &&
          claim.legacyKey === id && scopeToKey(claim.scope) === scopeKey &&
          isDeepStrictEqual(claim.originalDocument, expected) && current !== null &&
          (isDeepStrictEqual(current, expected) ||
            (lockScope(current) !== null && scopeToKey(lockScope(current)!) === scopeKey))
        );
      }
      if (snapshots.some(({ current, expected }) => !isDeepStrictEqual(current, expected))) {
        return false;
      }
      const targets = [
        { collection: SCOPE_DELETION_LOCKS_COLLECTION, id: scopeDeletionLockId(scope) },
        { collection: SCOPE_MUTATION_BARRIERS_COLLECTION, id: scopeMutationBarrierId(scope) },
      ];
      const targetSnapshots = await Promise.all(targets.map(async (target) => ({
        ...target, document: await documentStore.get<ScopeDeletionLock>(target.collection, target.id),
      })));
      if (targetSnapshots.some(({ document }) => document !== null)) {
        return false;
      }
      const claims = snapshots.map(({ collection, id, expected }) => ({
        collection: LEGACY_DELETION_CLAIMS_COLLECTION,
        id: deletionClaimId(collection, id),
        document: {
          id: deletionClaimId(collection, id),
          legacyKey: id,
          originalDocument: expected,
          scope,
          scopeKey,
          sourceCollection: collection,
          schemaVersion: 1,
        },
      }));
      return documentStore.writeBatchIfUnchanged({
        expected: { collection: claims[0]!.collection, id: claims[0]!.id, document: null },
        unchanged: [
          { collection: claims[1]!.collection, id: claims[1]!.id, document: null },
          ...snapshots.map(({ collection, id, current }) => ({ collection, id, document: current })),
          ...targetSnapshots,
        ],
        set: claims,
      });
    },
    async runMutation<T>(
      scope: MemoryScope,
      operation: () => Promise<T>,
    ): Promise<T> {
      const normalized = normalizeScope(scope);
      if (localDeletion(normalized)) {
        throw new Error(
          `Memory deletion is in progress for scope ${scopeDeletionLockId(normalized)}`,
        );
      }
      if (await activePersistentLock(documentStore, normalized)) {
        throw new Error(
          `Memory deletion is in progress for scope ${scopeDeletionLockId(normalized)}`,
        );
      }
      if (localDeletion(normalized)) {
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
        return await runWithPersistentMutationIntent(normalized, operation);
      } finally {
        gate.mutations.delete(mutation);
        finish();
      }
    },
    async runExclusive<T>(
      scope: MemoryScope,
      operation: () => Promise<T>,
      options: ScopeDeletionRunOptions = {},
    ): Promise<T> {
      const normalized = normalizeScope(scope);
      if (localDeletion(normalized)) {
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
        return await runWithPersistentLock(normalized, operation, options);
      } finally {
        gate.deletions.delete(normalized);
      }
    },
  };
}
