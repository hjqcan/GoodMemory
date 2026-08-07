import { describe, expect, it } from "bun:test";

import {
  createPreferenceCategoryFence,
  createRememberWriteCoordinator,
  REMEMBER_WRITE_OWNERS_COLLECTION,
} from "../../src/remember/writeOwnership";
import type {
  ConditionalDocumentWriteBatch,
  DocumentStore,
  ProjectionCapableDocumentStore,
  StorageDocument,
} from "../../src/storage/contracts";
import { createInMemoryDocumentStore } from "../../src/storage/memory";

function batchIds(input: ConditionalDocumentWriteBatch): string[] {
  return [
    input.expected,
    ...(input.unchanged ?? []),
    ...input.set,
    ...(input.delete ?? []),
  ].map(({ id }) => id);
}

describe("remember write ownership", () => {
  it("uses storage-safe marker ids for atomic ownership", async () => {
    const inner = createInMemoryDocumentStore();
    const observedIds: string[] = [];
    const store: ProjectionCapableDocumentStore = {
      ...inner,
      async get<TDocument extends StorageDocument>(
        collection: string,
        id: string,
      ) {
        observedIds.push(id);
        return inner.get<TDocument>(collection, id);
      },
      async writeBatchIfUnchanged(input) {
        observedIds.push(...batchIds(input));
        return inner.writeBatchIfUnchanged(input);
      },
    };
    const coordinator = createRememberWriteCoordinator(store);

    await coordinator.setDocument("facts", "fact:1", { content: "safe" });
    await coordinator.releaseOwnership();

    expect(observedIds.length).toBeGreaterThan(0);
    expect(observedIds.every((id) => !id.includes("\u0000"))).toBe(true);
    expect(await inner.get("facts", "fact:1")).toEqual({ content: "safe" });
  });

  it("does not claim cross-runtime serialization for fallback preference writes", async () => {
    const inner = createInMemoryDocumentStore();
    const store: DocumentStore = {
      delete: inner.delete,
      get: inner.get,
      query: inner.query,
      set: inner.set,
      update: inner.update,
    };
    const coordinator = createRememberWriteCoordinator(store);

    await coordinator.writeDocumentBatchWithRollback(
      createPreferenceCategoryFence(
        { userId: "fallback-owner", workspaceId: "workspace-a" },
        "response_style",
      ),
      async () => ({
        batch: {
          expected: {
            collection: "preferences",
            document: null,
            id: "fallback-preference",
          },
          set: [{
            collection: "preferences",
            document: { id: "fallback-preference", value: "concise" },
            id: "fallback-preference",
          }],
        },
        result: undefined,
      }),
    );

    expect(await inner.get("preferences", "fallback-preference")).toEqual({
      id: "fallback-preference",
      value: "concise",
    });
    expect(await inner.query(REMEMBER_WRITE_OWNERS_COLLECTION)).toEqual([]);
  });
});
