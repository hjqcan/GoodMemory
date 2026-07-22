import { describe, expect, it } from "bun:test";
import type {
  DocumentStore,
  SessionStore,
  VectorStore,
} from "../../src/storage/contracts";

type ContractFixture<TStore> = {
  store: TStore;
  cleanup?: () => Promise<void>;
};

type StoreFactory<TStore> = () => ContractFixture<TStore> | Promise<ContractFixture<TStore>>;

export function runDocumentStoreContract(
  suiteName: string,
  createStore: StoreFactory<DocumentStore>,
): void {
  describe(suiteName, () => {
    it("implements document store behavior", async () => {
      const fixture = await createStore();

      try {
        await fixture.store.set("facts", "f-1", {
          id: "f-1",
          userId: "u-1",
          content: "hello",
        });
        expect(await fixture.store.get("facts", "f-1")).toEqual({
          id: "f-1",
          userId: "u-1",
          content: "hello",
        });

        await fixture.store.update("facts", "f-1", { content: "updated" });
        expect(await fixture.store.get("facts", "f-1")).toEqual({
          id: "f-1",
          userId: "u-1",
          content: "updated",
        });

        expect(
          await fixture.store.query("facts", {
            userId: "u-1",
          }),
        ).toHaveLength(1);

        expect(fixture.store.searchText).toBeFunction();
        await fixture.store.set("recall_documents_v3", "hant-1", {
          id: "hant-1",
          languagePackId: "zh-Hant",
          scopeKey: "u-1::workspace-1",
          searchText: "專案 遷移 狀態",
        });
        await fixture.store.set("recall_documents_v3", "ja-1", {
          id: "ja-1",
          languagePackId: "ja",
          scopeKey: "u-1::workspace-1",
          searchText: "東京 移行 状態",
        });
        await expect(fixture.store.searchText!("recall_documents_v3", {
          field: "searchText",
          filter: { languagePackId: "zh-Hant" },
          limit: 4,
          query: "遷移",
        })).resolves.toEqual([
          expect.objectContaining({ id: "hant-1" }),
        ]);
        await fixture.store.update("recall_documents_v3", "ja-1", {
          searchText: "東京 配備 完了",
        });
        await expect(fixture.store.searchText!("recall_documents_v3", {
          field: "searchText",
          limit: 4,
          query: "移行",
        })).resolves.toEqual([]);

        await fixture.store.set("facts", "f-2", {
          id: "f-2",
          userId: "u-2",
          content: "filtered out",
        });
        await fixture.store.set("facts", "f-3", {
          id: "f-3",
          userId: "u-1",
          content: "second page",
        });
        expect(fixture.store.queryPage).toBeFunction();
        const firstPage = await fixture.store.queryPage!("facts", {
          filter: { userId: "u-1" },
          limit: 1,
        });
        expect(firstPage).toEqual({
          items: [
            {
              id: "f-1",
              userId: "u-1",
              content: "updated",
            },
          ],
          nextCursor: "f-1",
        });
        expect(
          await fixture.store.queryPage!("facts", {
            cursor: firstPage.nextCursor,
            filter: { userId: "u-1" },
            limit: 1,
          }),
        ).toEqual({
          items: [
            {
              id: "f-3",
              userId: "u-1",
              content: "second page",
            },
          ],
        });

        expect(fixture.store.writeBatchIfUnchanged).toBeFunction();
        expect(
          await fixture.store.writeBatchIfUnchanged!({
            expected: {
              collection: "facts",
              id: "f-1",
              document: {
                id: "f-1",
                userId: "u-1",
                content: "updated",
              },
            },
            set: [
              {
                collection: "facts",
                id: "f-1",
                document: {
                  id: "f-1",
                  userId: "u-1",
                  content: "batch-updated",
                },
              },
              {
                collection: "evidence",
                id: "ev-1",
                document: {
                  id: "ev-1",
                  userId: "u-1",
                  excerpt: "batch audit",
                },
              },
            ],
          }),
        ).toBe(true);
        expect(await fixture.store.get("facts", "f-1")).toEqual({
          id: "f-1",
          userId: "u-1",
          content: "batch-updated",
        });
        expect(await fixture.store.get("evidence", "ev-1")).toEqual({
          id: "ev-1",
          userId: "u-1",
          excerpt: "batch audit",
        });
        expect(
          await fixture.store.writeBatchIfUnchanged!({
            expected: {
              collection: "recall_documents_v3",
              id: "hant-1",
              document: {
                id: "hant-1",
                languagePackId: "zh-Hant",
                scopeKey: "u-1::workspace-1",
                searchText: "專案 遷移 狀態",
              },
            },
            set: [{
              collection: "recall_documents_v3",
              id: "hant-1",
              document: {
                id: "hant-1",
                languagePackId: "zh-Hant",
                scopeKey: "u-1::workspace-1",
                searchText: "專案 遷移 完成",
              },
            }],
          }),
        ).toBe(true);
        await expect(fixture.store.searchText!("recall_documents_v3", {
          field: "searchText",
          limit: 4,
          query: "完成",
        })).resolves.toEqual([
          expect.objectContaining({ id: "hant-1" }),
        ]);
        await fixture.store.delete("recall_documents_v3", "hant-1");
        await expect(fixture.store.searchText!("recall_documents_v3", {
          field: "searchText",
          limit: 4,
          query: "完成",
        })).resolves.toEqual([]);
        expect(
          await fixture.store.writeBatchIfUnchanged!({
            expected: {
              collection: "facts",
              id: "f-1",
              document: {
                id: "f-1",
                userId: "u-1",
                content: "updated",
              },
            },
            set: [
              {
                collection: "facts",
                id: "f-1",
                document: {
                  id: "f-1",
                  userId: "u-1",
                  content: "should-not-write",
                },
              },
            ],
          }),
        ).toBe(false);
        expect(await fixture.store.get("facts", "f-1")).toEqual({
          id: "f-1",
          userId: "u-1",
          content: "batch-updated",
        });

        await fixture.store.delete("facts", "f-1");
        expect(await fixture.store.get("facts", "f-1")).toBeNull();
      } finally {
        await fixture.cleanup?.();
      }
    });
  });
}

export function runSessionStoreContract(
  suiteName: string,
  createStore: StoreFactory<SessionStore>,
): void {
  describe(suiteName, () => {
    it("implements session store behavior", async () => {
      const fixture = await createStore();
      const scope = { userId: "u-1", sessionId: "s-1" };
      const buffer = {
        sessionId: "s-1",
        userId: "u-1",
        messages: [],
        summary: null,
        summaryUpToIndex: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastActiveAt: "2026-01-01T00:00:00.000Z",
      };
      const workingMemory = {
        sessionId: "s-1",
        userId: "u-1",
        currentGoal: "finish storage adapter",
        openLoops: ["verify postgres runtime"],
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      const journal = {
        sessionId: "s-1",
        userId: "u-1",
        worklog: ["session store contract"],
        updatedAt: "2026-01-01T00:00:00.000Z",
      };

      try {
        await fixture.store.saveBuffer(scope, buffer);
        expect(await fixture.store.getBuffer(scope)).toEqual(buffer);

        const appendedBuffer = {
          ...buffer,
          messages: [
            {
              role: "user" as const,
              content: "arrived while endSession was finishing",
            },
          ],
          lastActiveAt: "2026-01-01T00:01:00.000Z",
        };
        await fixture.store.saveBuffer(scope, appendedBuffer);
        expect(
          await fixture.store.deleteBufferIfUnchanged(scope, buffer),
        ).toBe(false);
        expect(await fixture.store.getBuffer(scope)).toEqual(appendedBuffer);
        expect(
          await fixture.store.deleteBufferIfUnchanged(scope, appendedBuffer),
        ).toBe(true);
        expect(await fixture.store.getBuffer(scope)).toBeNull();
        expect(
          await fixture.store.deleteBufferIfUnchanged(scope, appendedBuffer),
        ).toBe(false);

        await fixture.store.saveBuffer(scope, buffer);

        await fixture.store.saveWorkingMemory(scope, workingMemory);
        expect(await fixture.store.getWorkingMemory(scope)).toEqual(workingMemory);

        await fixture.store.saveJournal(scope, journal);
        expect(await fixture.store.getJournal(scope)).toEqual(journal);

        expect(await fixture.store.deleteBuffersByScope(scope)).toBe(1);
        expect(await fixture.store.getBuffer(scope)).toBeNull();

        expect(await fixture.store.deleteWorkingMemoryByScope(scope)).toBe(1);
        expect(await fixture.store.getWorkingMemory(scope)).toBeNull();

        expect(await fixture.store.deleteJournalsByScope(scope)).toBe(1);
        expect(await fixture.store.getJournal(scope)).toBeNull();
      } finally {
        await fixture.cleanup?.();
      }
    });
  });
}

export function runVectorStoreContract(
  suiteName: string,
  createStore: StoreFactory<VectorStore>,
  timeoutMs?: number,
): void {
  describe(suiteName, () => {
    it("implements vector store behavior", async () => {
      const fixture = await createStore();

      try {
        await fixture.store.upsert("episodes", [
          {
            id: "e-1",
            embedding: [1, 0, 0],
            metadata: { userId: "u-1" },
            content: "robot migration issue",
          },
          {
            id: "e-2",
            embedding: [0, 1, 0],
            metadata: { userId: "u-1" },
            content: "frontend styling preference",
          },
        ]);

        const result = await fixture.store.search("episodes", [1, 0, 0], {
          topK: 1,
          filter: { userId: "u-1" },
        });

        expect(result[0]?.id).toBe("e-1");
        result[0]!.embedding[0] = 0;
        result[0]!.metadata.userId = "mutated";
        expect(await fixture.store.get("episodes", "e-1")).toEqual({
          id: "e-1",
          embedding: [1, 0, 0],
          metadata: { userId: "u-1" },
          content: "robot migration issue",
        });

        await fixture.store.delete("episodes", "e-1");
        expect(await fixture.store.get("episodes", "e-1")).toBeNull();
        const afterDelete = await fixture.store.search("episodes", [1, 0, 0], {
          topK: 2,
          filter: { userId: "u-1" },
        });

        expect(afterDelete.some((record) => record.id === "e-1")).toBe(false);
      } finally {
        await fixture.cleanup?.();
      }
    }, timeoutMs);
  });
}
