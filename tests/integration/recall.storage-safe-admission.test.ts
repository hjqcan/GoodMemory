import { describe, expect, it } from "bun:test";

import { createGoodMemory } from "../../src";
import { EXPERIENCES_COLLECTION } from "../../src/evolution/contracts";
import type { ExperienceRecord } from "../../src/evolution/contracts";
import { createInMemoryDocumentStore } from "../../src/storage/memory";

function createMemoryFixture() {
  const documentStore = createInMemoryDocumentStore();
  const memory = createGoodMemory({
    adapters: { documentStore },
    storage: { provider: "memory" },
  });
  return { documentStore, memory };
}

describe("public recall storage-safe admission", () => {
  it("records a recall experience for storage-safe input with the memory provider", async () => {
    const { documentStore, memory } = createMemoryFixture();
    const scope = {
      sessionId: "session-safe",
      userId: "user-safe",
      workspaceId: "workspace-safe",
    };

    await memory.recall({
      query: "What is the project status?",
      scope,
      strategy: "rules-only",
    });

    const experiences = await documentStore.query<ExperienceRecord>(
      EXPERIENCES_COLLECTION,
    );
    expect(experiences).toEqual([
      expect.objectContaining({
        kind: "recall",
        sessionId: scope.sessionId,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
      }),
    ]);
  });

  it("rejects a NUL-containing userId before writing the recall experience", async () => {
    const { documentStore, memory } = createMemoryFixture();
    let error: unknown;

    try {
      await memory.recall({
        query: "What is the project status?",
        scope: {
          sessionId: "session-unsafe",
          userId: "user\u0000unsafe",
          workspaceId: "workspace-safe",
        },
        strategy: "rules-only",
      });
    } catch (caught) {
      error = caught;
    }

    expect(
      await documentStore.query(EXPERIENCES_COLLECTION),
    ).toEqual([]);
    expect(error).toMatchObject({
      code: "ERR_GOODMEMORY_STORAGE_UNSAFE_TEXT",
      path: "input.scope.userId",
    });
  });

  for (const [name, input, path] of [
    [
      "query",
      {
        query: "What is the project\u0000status?",
        scope: { userId: "unsafe-query-user" },
      },
      "input.query",
    ],
    [
      "nested scope string",
      {
        query: "What is the project status?",
        scope: {
          userId: "unsafe-scope-user",
          workspaceId: "workspace\u0000unsafe",
        },
      },
      "input.scope.workspaceId",
    ],
  ] as const) {
    it(`rejects a storage-unsafe ${name} before any recall experience write`, async () => {
      const { documentStore, memory } = createMemoryFixture();

      await expect(memory.recall(input)).rejects.toMatchObject({
        code: "ERR_GOODMEMORY_STORAGE_UNSAFE_TEXT",
        path,
      });
      expect(
        await documentStore.query(EXPERIENCES_COLLECTION),
      ).toEqual([]);
    });
  }
});
