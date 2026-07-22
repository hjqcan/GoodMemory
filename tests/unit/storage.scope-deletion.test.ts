import { describe, expect, it } from "bun:test";
import type {
  ProjectionCapableDocumentStore,
  StorageDocument,
} from "../../src/storage/contracts";
import { createInMemoryDocumentStore } from "../../src/storage/memory";
import {
  createScopeDeletionAwareDocumentStore,
  createScopeDeletionCoordinator,
  SCOPE_DELETION_LOCKS_COLLECTION,
  SCOPE_MUTATION_INTENTS_COLLECTION,
  scopeDeletionLockId,
} from "../../src/storage/scopeDeletion";

describe("scope deletion coordination", () => {
  it("shares a write gate across coordinators and drains prior overlapping writes", async () => {
    const rawStore = createInMemoryDocumentStore();
    const writer = createScopeDeletionCoordinator(rawStore);
    const deleter = createScopeDeletionCoordinator(rawStore);
    const scope = { userId: "u-shared-gate", workspaceId: "workspace-a" };
    let releaseWrite = () => {};
    let signalWrite = () => {};
    const writeStarted = new Promise<void>((resolve) => {
      signalWrite = resolve;
    });
    const writeRelease = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const events: string[] = [];

    const activeWrite = writer.runMutation(
      { ...scope, sessionId: "session-a" },
      async () => {
        events.push("write-started");
        signalWrite();
        await writeRelease;
        events.push("write-finished");
      },
    );
    await writeStarted;
    const deletion = deleter.runExclusive(scope, async () => {
      events.push("deletion-started");
    });

    await expect(writer.runMutation(scope, async () => {
      events.push("late-write");
    })).rejects.toThrow("Memory deletion is in progress");
    expect(events).toEqual(["write-started"]);

    releaseWrite();
    await activeWrite;
    await deletion;
    expect(events).toEqual([
      "write-started",
      "write-finished",
      "deletion-started",
    ]);
  });

  it("shares a stable mutation gate across wrappers for the same backing store", async () => {
    const rawStore = createInMemoryDocumentStore();
    const scopeMutationFenceIdentity = {};
    const writerStore = {
      ...rawStore,
      scopeMutationFenceIdentity,
    };
    const deleterStore = {
      ...rawStore,
      scopeMutationFenceIdentity,
    };
    const writer = createScopeDeletionCoordinator(writerStore);
    const deleter = createScopeDeletionCoordinator(deleterStore);
    const scope = { userId: "u-wrapper-gate", workspaceId: "workspace-a" };
    let releaseWrite = () => {};
    let signalWrite = () => {};
    const writeStarted = new Promise<void>((resolve) => {
      signalWrite = resolve;
    });
    const writeRelease = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const events: string[] = [];

    const activeWrite = writer.runMutation(scope, async () => {
      events.push("write-started");
      signalWrite();
      await writeRelease;
      events.push("write-finished");
    });
    await writeStarted;
    let signalDeletion = () => {};
    const deletionStarted = new Promise<void>((resolve) => {
      signalDeletion = resolve;
    });
    const deletion = deleter.runExclusive(scope, async () => {
      events.push("deletion-started");
      signalDeletion();
    });
    const deletionStartedBeforeRelease = await Promise.race([
      deletionStarted.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 0)),
    ]);

    const eventsBeforeRelease = [...events];
    releaseWrite();
    await activeWrite;
    await deletion;
    expect(deletionStartedBeforeRelease).toBe(false);
    expect(eventsBeforeRelease).toEqual(["write-started"]);
    expect(events).toEqual([
      "write-started",
      "write-finished",
      "deletion-started",
    ]);
  });

  it("drains a mutation admitted through an independent coordinator before deletion", async () => {
    const rawStore = createInMemoryDocumentStore();
    const writer = createScopeDeletionCoordinator({ ...rawStore });
    const deleter = createScopeDeletionCoordinator({ ...rawStore });
    const scope = { userId: "u-persistent-writer", workspaceId: "workspace-a" };
    const sessionValues = new Map<string, string>();
    const vectorValues = new Set<string>();
    let releaseWrite = () => {};
    let signalWrite = () => {};
    const writeStarted = new Promise<void>((resolve) => {
      signalWrite = resolve;
    });
    const writeRelease = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let deletionEntered = false;

    const activeWrite = writer.runMutation(scope, async () => {
      signalWrite();
      await writeRelease;
      sessionValues.set("goal", "late-session-write");
      vectorValues.add("late-vector-write");
    });
    await writeStarted;
    const deletion = deleter.runExclusive(scope, async () => {
      deletionEntered = true;
      sessionValues.clear();
      vectorValues.clear();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deletionEntered).toBe(false);

    releaseWrite();
    await activeWrite;
    await deletion;
    expect(sessionValues.size).toBe(0);
    expect(vectorValues.size).toBe(0);
  });

  it("drains a persistent mutation intent across wrappers without shared object identity", async () => {
    const rawStore = createInMemoryDocumentStore();
    const writer = createScopeDeletionCoordinator({ ...rawStore });
    const deleter = createScopeDeletionCoordinator({ ...rawStore });
    const scope = {
      userId: "u-persistent-mutation",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    };
    let releaseWrite = () => {};
    let signalWrite = () => {};
    const writeStarted = new Promise<void>((resolve) => {
      signalWrite = resolve;
    });
    const writeRelease = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const events: string[] = [];

    const activeWrite = writer.runMutation(scope, async () => {
      events.push("write-started");
      signalWrite();
      await writeRelease;
      events.push("write-committed");
    });
    await writeStarted;
    const deletion = deleter.runExclusive(scope, async () => {
      events.push("deletion-started");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toEqual(["write-started"]);
    releaseWrite();
    await activeWrite;
    await deletion;
    expect(events).toEqual([
      "write-started",
      "write-committed",
      "deletion-started",
    ]);
  });

  it("rejects a mutation through another wrapper while the persistent lock is active", async () => {
    const rawStore = createInMemoryDocumentStore();
    const writer = createScopeDeletionCoordinator({ ...rawStore });
    const deleter = createScopeDeletionCoordinator({ ...rawStore });
    const scope = { userId: "u-persistent-gate", workspaceId: "workspace-a" };
    let releaseDeletion = () => {};
    let signalDeletion = () => {};
    const deletionStarted = new Promise<void>((resolve) => {
      signalDeletion = resolve;
    });
    const deletionRelease = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });
    const deletion = deleter.runExclusive(scope, async () => {
      signalDeletion();
      await deletionRelease;
    });
    await deletionStarted;

    const mutationOutcome = await writer.runMutation(scope, async () => "written").then(
      () => "resolved" as const,
      () => "rejected" as const,
    );
    releaseDeletion();
    await deletion;
    expect(mutationOutcome).toBe("rejected");
  });

  it("allows writes whose scopes cannot overlap the active deletion", async () => {
    const rawStore = createInMemoryDocumentStore();
    const coordinator = createScopeDeletionCoordinator(rawStore);
    const deletionScope = {
      userId: "u-disjoint-gate",
      workspaceId: "workspace-a",
    };
    let releaseDeletion = () => {};
    let signalDeletion = () => {};
    const deletionStarted = new Promise<void>((resolve) => {
      signalDeletion = resolve;
    });
    const deletionRelease = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });
    const deletion = coordinator.runExclusive(deletionScope, async () => {
      signalDeletion();
      await deletionRelease;
    });
    await deletionStarted;

    await expect(coordinator.runMutation({
      userId: deletionScope.userId,
      workspaceId: "workspace-b",
    }, async () => "written")).resolves.toBe("written");
    await expect(coordinator.runMutation({
      ...deletionScope,
      sessionId: "session-a",
    }, async () => "blocked")).rejects.toThrow(
      "Memory deletion is in progress",
    );
    await expect(coordinator.runMutation({
      userId: deletionScope.userId,
    }, async () => "also-blocked")).rejects.toThrow(
      "Memory deletion is in progress",
    );

    releaseDeletion();
    await deletion;
  });

  it("lets a later deletion replace the released open tombstone", async () => {
    const rawStore = createInMemoryDocumentStore();
    const coordinator = createScopeDeletionCoordinator(rawStore);
    const scope = { userId: "u-repeat-delete", workspaceId: "workspace-a" };
    const operations: string[] = [];

    await coordinator.runExclusive(scope, async () => {
      operations.push("first");
    });
    await coordinator.runExclusive(scope, async () => {
      operations.push("second");
    });

    expect(operations).toEqual(["first", "second"]);
    expect(
      await rawStore.get<Record<string, unknown>>(
        SCOPE_DELETION_LOCKS_COLLECTION,
        scopeDeletionLockId(scope),
      ),
    ).toMatchObject({ state: "open", generation: expect.any(String) });
  });

  it("does not automatically take over an expired deletion owner", async () => {
    const rawStore = createInMemoryDocumentStore();
    const scope = { userId: "u-expired-lease", workspaceId: "workspace-a" };
    const id = scopeDeletionLockId(scope);
    const staleLock = {
      ...scope,
      epoch: 4,
      generation: "stale-generation",
      id,
      leaseExpiresAt: Date.now() - 1,
      operationId: "stale-operation",
      ownerId: "stale-owner",
      phase: "delete_all",
      state: "deleting",
    };
    await rawStore.set(SCOPE_DELETION_LOCKS_COLLECTION, id, staleLock);
    const coordinator = createScopeDeletionCoordinator(rawStore);

    await expect(coordinator.runExclusive(scope, async () => {})).rejects.toThrow(
      "Memory deletion is already in progress",
    );
    expect(
      await rawStore.get<Record<string, unknown>>(
        SCOPE_DELETION_LOCKS_COLLECTION,
        id,
      ),
    ).toEqual(staleLock);
  });

  it("keeps a failed deletion closed and lets only the same live coordinator retry", async () => {
    const rawStore = createInMemoryDocumentStore();
    const scope = { userId: "u-failed-delete", workspaceId: "workspace-a" };
    const coordinator = createScopeDeletionCoordinator(rawStore, {
      ownerId: "same-live-owner",
    });

    await expect(coordinator.runExclusive(scope, async () => {
      throw new Error("partial deletion failed");
    })).rejects.toThrow("partial deletion failed");
    expect(
      await rawStore.get<Record<string, unknown>>(
        SCOPE_DELETION_LOCKS_COLLECTION,
        scopeDeletionLockId(scope),
      ),
    ).toMatchObject({ ownerId: "same-live-owner", state: "deleting" });
    await expect(coordinator.runMutation(scope, async () => "late"))
      .rejects.toThrow("Memory deletion is in progress");
    const sameNamedOwner = createScopeDeletionCoordinator(rawStore, {
      ownerId: "same-live-owner",
    });
    await expect(sameNamedOwner.runExclusive(scope, async () => "unsafe"))
      .rejects.toThrow("Memory deletion is already in progress");

    await expect(coordinator.runExclusive(scope, async () => "recovered"))
      .resolves.toBe("recovered");
    expect(
      await rawStore.get<Record<string, unknown>>(
        SCOPE_DELETION_LOCKS_COLLECTION,
        scopeDeletionLockId(scope),
      ),
    ).toMatchObject({ state: "open" });
  });

  it("keeps ownership retryable when the final open transition is rejected", async () => {
    const rawStore = createInMemoryDocumentStore();
    let rejectOpenOnce = true;
    const store: ProjectionCapableDocumentStore = {
      ...rawStore,
      async writeBatchIfUnchanged(input) {
        if (
          rejectOpenOnce &&
          input.set.some(({ collection, document }) =>
            collection === SCOPE_DELETION_LOCKS_COLLECTION &&
            (document as { state?: string }).state === "open"
          )
        ) {
          rejectOpenOnce = false;
          return false;
        }
        return rawStore.writeBatchIfUnchanged(input);
      },
    };
    const coordinator = createScopeDeletionCoordinator(store);
    const scope = { userId: "u-release-retry", workspaceId: "workspace-a" };
    let operationCount = 0;

    await expect(coordinator.runExclusive(scope, async () => {
      operationCount += 1;
    })).rejects.toThrow("ownership changed before release");
    await expect(coordinator.runExclusive(scope, async () => {
      operationCount += 1;
      return "recovered";
    })).resolves.toBe("recovered");

    expect(operationCount).toBe(2);
  });

  it("does not discard a mutation intent based on expired lease metadata", async () => {
    const rawStore = createInMemoryDocumentStore();
    const scope = {
      userId: "u-expired-mutation",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    };
    const staleIntent = {
      ...scope,
      id: "stale-mutation",
      leaseExpiresAt: 1,
      operationId: "stale-operation",
      ownerId: "dead-owner",
    };
    await rawStore.set(
      SCOPE_MUTATION_INTENTS_COLLECTION,
      staleIntent.id,
      staleIntent,
    );
    const coordinator = createScopeDeletionCoordinator(rawStore);
    let deletionEntered = false;

    const deletion = coordinator.runExclusive(scope, async () => {
      deletionEntered = true;
      return "deleted";
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const intentBeforeRecovery = await rawStore.get(
      SCOPE_MUTATION_INTENTS_COLLECTION,
      staleIntent.id,
    );
    const enteredBeforeRecovery = deletionEntered;
    await rawStore.delete(SCOPE_MUTATION_INTENTS_COLLECTION, staleIntent.id);
    await expect(deletion).resolves.toBe("deleted");

    expect(enteredBeforeRecovery).toBe(false);
    expect(intentBeforeRecovery).toEqual(staleIntent);
  });

  it("does not take over an active deletion owner", async () => {
    const rawStore = createInMemoryDocumentStore();
    const scope = { userId: "u-active-lease", workspaceId: "workspace-a" };
    const id = scopeDeletionLockId(scope);
    await rawStore.set(SCOPE_DELETION_LOCKS_COLLECTION, id, {
      ...scope,
      epoch: 2,
      generation: "active-generation",
      id,
      operationId: "active-operation",
      ownerId: "active-owner",
      phase: "delete_all",
      state: "deleting",
    });
    const coordinator = createScopeDeletionCoordinator(rawStore);

    await expect(coordinator.runExclusive(scope, async () => {})).rejects.toThrow(
      "Memory deletion is already in progress",
    );
  });

  it("does not let a second deletion owner replace an active scope lock", async () => {
    const rawStore = createInMemoryDocumentStore();
    const guardedStore = createScopeDeletionAwareDocumentStore(rawStore);
    const coordinator = createScopeDeletionCoordinator(rawStore);
    const scope = { userId: "u-exclusive-delete", workspaceId: "workspace-a" };
    let releaseFirst = () => {};
    let signalFirst = () => {};
    const firstEntered = new Promise<void>((resolve) => {
      signalFirst = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = coordinator.runExclusive(scope, async () => {
      signalFirst();
      await firstRelease;
    });
    await firstEntered;
    let secondEntered = false;

    await expect(coordinator.runExclusive(scope, async () => {
      secondEntered = true;
    })).rejects.toThrow("Memory deletion is already in progress");
    expect(secondEntered).toBe(false);
    await expect(guardedStore.set("facts", "late", {
      ...scope,
      id: "late",
    })).rejects.toThrow("Memory deletion is in progress");

    releaseFirst();
    await first;
  });

  it("blocks nested-scope runtime records while deletion is in progress", async () => {
    const rawStore = createInMemoryDocumentStore();
    const guardedStore = createScopeDeletionAwareDocumentStore(rawStore);
    const coordinator = createScopeDeletionCoordinator(rawStore);
    const scope = {
      userId: "u-runtime-delete",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    };
    const spill = {
      id: "spill-late",
      scope,
      content: "sensitive runtime spill",
    };

    await coordinator.runExclusive(scope, async () => {
      await expect(
        guardedStore.set("artifact_spills_v1", spill.id, spill),
      ).rejects.toThrow("Memory deletion is in progress");
    });

    expect(await rawStore.get("artifact_spills_v1", spill.id)).toBeNull();
    await guardedStore.set("artifact_spills_v1", spill.id, spill);
    expect(await rawStore.get("artifact_spills_v1", spill.id)).toEqual(spill);
  });

  it("guards both predecessor and destination scopes for every write entrypoint", async () => {
    const sourceScope = {
      userId: "u-scope-move",
      workspaceId: "workspace-a",
    };
    const destinationScope = {
      ...sourceScope,
      workspaceId: "workspace-b",
    };
    const variants: Array<{
      name: string;
      write: (
        store: ReturnType<typeof createScopeDeletionAwareDocumentStore>,
        existing: StorageDocument,
      ) => Promise<unknown>;
    }> = [
      {
        name: "set",
        write: (store, existing) =>
          store.set("facts", "fact-move", {
            ...existing,
            ...destinationScope,
          }),
      },
      {
        name: "update",
        write: (store) =>
          store.update("facts", "fact-move", {
            workspaceId: destinationScope.workspaceId,
          }),
      },
      {
        name: "conditional batch",
        write: (store, existing) =>
          store.writeBatchIfUnchanged({
            expected: {
              collection: "facts",
              document: existing,
              id: "fact-move",
            },
            set: [{
              collection: "facts",
              document: { ...existing, ...destinationScope },
              id: "fact-move",
            }],
          }),
      },
    ];

    for (const variant of variants) {
      const rawStore = createInMemoryDocumentStore();
      const guardedStore = createScopeDeletionAwareDocumentStore(rawStore);
      const coordinator = createScopeDeletionCoordinator(rawStore);
      const existing = {
        ...sourceScope,
        id: "fact-move",
        content: `sensitive-${variant.name}`,
      };
      await rawStore.set("facts", existing.id, existing);

      await coordinator.runExclusive(sourceScope, async () => {
        await expect(variant.write(guardedStore, existing)).rejects.toThrow(
          "Memory deletion is in progress",
        );
      });

      expect(await rawStore.get("facts", existing.id)).toEqual(existing);
    }
  });

  it("rejects a writer that spans a complete deletion generation", async () => {
    const rawStore = createInMemoryDocumentStore();
    let releaseWrite = () => {};
    let signalWrite = () => {};
    let shouldBlock = true;
    const writeStarted = new Promise<void>((resolve) => {
      signalWrite = resolve;
    });
    const writeRelease = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const blockingStore: ProjectionCapableDocumentStore = {
      projectionBatchSemantics: rawStore.projectionBatchSemantics,
      async set(collection, id, document) {
        if (collection === "facts" && shouldBlock) {
          shouldBlock = false;
          signalWrite();
          await writeRelease;
        }
        await rawStore.set(collection, id, document);
      },
      get: (collection, id) => rawStore.get(collection, id),
      update: (collection, id, patch) => rawStore.update(collection, id, patch),
      query: (collection, filter) => rawStore.query(collection, filter),
      delete: (collection, id) => rawStore.delete(collection, id),
      async writeBatchIfUnchanged(input) {
        if (
          shouldBlock &&
          input.set.some(({ collection }) => collection === "facts")
        ) {
          shouldBlock = false;
          signalWrite();
          await writeRelease;
        }
        return rawStore.writeBatchIfUnchanged(input);
      },
    };
    const guardedStore = createScopeDeletionAwareDocumentStore(blockingStore);
    const coordinator = createScopeDeletionCoordinator(blockingStore);
    const deletionScope = {
      userId: "u-generation",
      workspaceId: "workspace-a",
    };
    const lateFact = {
      ...deletionScope,
      id: "late-fact",
      content: "sensitive late write",
    };

    const write = guardedStore.set("facts", lateFact.id, lateFact);
    await writeStarted;
    await coordinator.runExclusive(deletionScope, async () => {
      await rawStore.delete("facts", lateFact.id);
    });
    releaseWrite();

    await expect(write).rejects.toThrow("Memory deletion generation changed");
    expect(await rawStore.get("facts", lateFact.id)).toBeNull();
    expect(
      await rawStore.get<Record<string, unknown>>(
        SCOPE_DELETION_LOCKS_COLLECTION,
        scopeDeletionLockId(deletionScope),
      ),
    ).toMatchObject({ state: "open", generation: expect.any(String) });
  });
});
