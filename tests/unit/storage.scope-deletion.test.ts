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
