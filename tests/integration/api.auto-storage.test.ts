import { describe, expect, it } from "bun:test";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { createGoodMemory } from "../../src";
import { createFactMemory } from "../../src/domain/records";
import { createMemorySource } from "../../src/domain/provenance";
import { createAutoStorageAdapters } from "../../src/storage/auto";
import { createMemoryRepositories } from "../../src/storage/repositories";
import {
  createSQLiteDocumentStore,
  createSQLiteVectorStore,
} from "../../src/storage/sqlite";
import { createTempWorkspace } from "../../src/testing/utils";

function createFakeEmbeddingAdapter(embeddingByText: Map<string, number[]>) {
  return {
    async embed(texts: string[]) {
      return texts.map((text) => embeddingByText.get(text) ?? [0, 0, 0]);
    },
  };
}

describe("auto storage runtime", () => {
  it("defaults to a durable cwd sqlite database when storage is omitted", async () => {
    const workspace = await createTempWorkspace("goodmemory-auto-storage-default");
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace.root);

      const memory = createGoodMemory({});
      await memory.remember({
        scope: {
          userId: "auto-user",
          sessionId: "session-1",
        },
        messages: [
          {
            role: "user",
            content: "Remember that my name is Avery.",
          },
        ],
      });

      await expect(
        access(join(workspace.root, ".goodmemory", "memory.sqlite")),
      ).resolves.toBeNull();
    } finally {
      process.chdir(previousCwd);
      await workspace.cleanup();
    }
  });

  it("reuses the default sqlite database across memory instances", async () => {
    const workspace = await createTempWorkspace("goodmemory-auto-storage-reuse");
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace.root);

      const first = createGoodMemory({});
      const scope = {
        userId: "auto-user",
        sessionId: "session-1",
      };
      await first.remember({
        scope,
        messages: [
          {
            role: "user",
            content: "Remember that my favorite editor theme is high contrast.",
          },
        ],
      });

      const second = createGoodMemory({});
      const exported = await second.exportMemory({
        scope,
      });

      expect(
        exported.durable.preferences.some((record) =>
          JSON.stringify(record.value).includes("high contrast"),
        ) ||
          exported.durable.facts.some((record) =>
            record.content.includes("high contrast"),
          ),
      ).toBe(true);
    } finally {
      process.chdir(previousCwd);
      await workspace.cleanup();
    }
  });

  it("supports forget and deleteAllMemory on the default auto sqlite path", async () => {
    const workspace = await createTempWorkspace("goodmemory-auto-storage-governance");
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace.root);

      const memory = createGoodMemory({});
      const scope = {
        userId: "auto-user",
        workspaceId: "workspace-a",
        sessionId: "session-1",
      };
      const rememberResult = await memory.remember({
        scope,
        messages: [
          {
            role: "user",
            content:
              "Remember that the current blocker is vendor approval for the release quality program.",
          },
        ],
      });
      await memory.feedback({
        scope,
        signal: "Use concise bullet points in rollout summaries.",
      });

      const factId = rememberResult.events.find(
        (event) => event.memoryType === "fact" && event.memoryId,
      )?.memoryId;

      expect(factId).toBeTruthy();
      await expect(
        access(join(workspace.root, ".goodmemory", "memory.sqlite")),
      ).resolves.toBeNull();

      const forgotten = await memory.forget({
        scope,
        memoryId: factId,
      });

      expect(forgotten.forgotten).toBe(true);

      const afterForget = await memory.recall({
        scope,
        query: "What is the current blocker and how should I summarize it?",
      });

      expect(afterForget.facts).toHaveLength(0);
      expect(
        afterForget.feedback.some(
          (item) =>
            item.lifecycle === "active" &&
            item.rule.includes("concise bullet points"),
        ),
      ).toBe(true);

      const deleted = await memory.deleteAllMemory({
        scope,
      });
      const exported = await memory.exportMemory({
        scope,
        includeRuntime: true,
      });

      expect(deleted.deleted.facts).toBe(0);
      expect(deleted.deleted.feedback).toBe(1);
      expect(exported.durable.facts).toHaveLength(0);
      expect(exported.durable.feedback).toHaveLength(0);
      expect(exported.runtime?.workingMemory).toBeNull();
      expect(exported.runtime?.journal).toBeNull();
    } finally {
      process.chdir(previousCwd);
      await workspace.cleanup();
    }
  });

  it("supports durable local hybrid retrieval when storage is omitted and an embedding adapter is provided", async () => {
    const workspace = await createTempWorkspace("goodmemory-auto-storage-hybrid");
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace.root);

      const sqlitePath = join(workspace.root, ".goodmemory", "memory.sqlite");
      const documentStore = createSQLiteDocumentStore(sqlitePath);
      const vectorStore = createSQLiteVectorStore(sqlitePath);
      const repositories = createMemoryRepositories({
        documentStore,
        sessionStore: {
          async saveBuffer() {},
          async saveBufferIfUnchanged() {
            return false;
          },
          async getBuffer() {
            return null;
          },
          async deleteBufferIfUnchanged() {
            return false;
          },
          async deleteBuffersByScope() {
            return 0;
          },
          async saveWorkingMemory() {},
          async getWorkingMemory() {
            return null;
          },
          async deleteWorkingMemoryByScope() {
            return 0;
          },
          async saveJournal() {},
          async getJournal() {
            return null;
          },
          async deleteJournalsByScope() {
            return 0;
          },
        },
        vectorStore,
      });
      const scope = {
        userId: "auto-user",
        workspaceId: "workspace-a",
      };
      const query = "What is the current blocker?";
      const wrongFact = createFactMemory({
        id: "fact-wrong",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "project",
        factKind: "blocker",
        content: "The current blocker is vendor approval for the runtime dashboard.",
        source: createMemorySource({
          method: "explicit",
          extractedAt: "2026-01-01T00:00:00.000Z",
        }),
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      const rightFact = createFactMemory({
        id: "fact-right",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "project",
        factKind: "blocker",
        content: "The current blocker is service account rotation for migration rollout.",
        source: createMemorySource({
          method: "explicit",
          extractedAt: "2026-01-01T00:00:00.000Z",
        }),
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      const embeddingByText = new Map<string, number[]>([
        [query, [1, 0, 0]],
        [wrongFact.content, [0, 1, 0]],
        [rightFact.content, [1, 0, 0]],
      ]);
      const adapters = {
        embeddingAdapter: createFakeEmbeddingAdapter(embeddingByText),
      };

      await repositories.facts.add(wrongFact);
      await repositories.facts.add(rightFact);
      await repositories.vectorIndex!.upsertFactEmbedding([
        {
          id: wrongFact.id,
          embedding: embeddingByText.get(wrongFact.content)!,
          metadata: {
            userId: scope.userId,
            workspaceId: scope.workspaceId,
            memoryType: "fact",
          },
          content: wrongFact.content,
        },
        {
          id: rightFact.id,
          embedding: embeddingByText.get(rightFact.content)!,
          metadata: {
            userId: scope.userId,
            workspaceId: scope.workspaceId,
            memoryType: "fact",
          },
          content: rightFact.content,
        },
      ]);

      const second = createGoodMemory({
        adapters,
      });
      const recall = await second.recall({
        scope,
        query,
        strategy: "hybrid",
      });

      expect(
        recall.facts.some((fact) => fact.id === rightFact.id),
      ).toBe(true);
    } finally {
      process.chdir(previousCwd);
      await workspace.cleanup();
    }
  });

  it("defaults explicit sqlite without a url to the cwd sqlite database", async () => {
    const workspace = await createTempWorkspace("goodmemory-explicit-sqlite-default");
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace.root);

      const memory = createGoodMemory({
        storage: {
          provider: "sqlite",
        },
      });

      await memory.remember({
        scope: {
          userId: "sqlite-user",
          sessionId: "session-1",
        },
        messages: [
          {
            role: "user",
            content: "Remember that I prefer release checklists over freeform notes.",
          },
        ],
      });

      await expect(
        access(join(workspace.root, ".goodmemory", "memory.sqlite")),
      ).resolves.toBeNull();
    } finally {
      process.chdir(previousCwd);
      await workspace.cleanup();
    }
  });

  it("auto-resolves assisted extraction on the public default createGoodMemory({}) path", async () => {
    const workspace = await createTempWorkspace("goodmemory-auto-assisted-extractor");
    const previousCwd = process.cwd();
    const originalFetch = globalThis.fetch;
    const originalStorageProvider = process.env.GOODMEMORY_STORAGE_PROVIDER;
    const originalStorageUrl = process.env.GOODMEMORY_STORAGE_URL;
    const originalEmbeddingProvider = process.env.GOODMEMORY_EMBEDDING_PROVIDER;
    const originalEmbeddingModel = process.env.GOODMEMORY_EMBEDDING_MODEL;
    const originalEmbeddingApiKey = process.env.GOODMEMORY_EMBEDDING_API_KEY;
    const originalEmbeddingBaseURL = process.env.GOODMEMORY_EMBEDDING_BASE_URL;
    const originalExtractorProvider = process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER;
    const originalExtractorModel = process.env.GOODMEMORY_ASSISTED_EXTRACTOR_MODEL;
    const originalExtractorApiKey = process.env.GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY;
    const originalExtractorBaseURL = process.env.GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL;
    const requests: string[] = [];

    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER = "openai";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_MODEL = "gpt-4o-mini";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY = "test-key";
    process.env.GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL = "https://extractor.test/v1";
    delete process.env.GOODMEMORY_STORAGE_PROVIDER;
    delete process.env.GOODMEMORY_STORAGE_URL;
    delete process.env.GOODMEMORY_EMBEDDING_PROVIDER;
    delete process.env.GOODMEMORY_EMBEDDING_MODEL;
    delete process.env.GOODMEMORY_EMBEDDING_API_KEY;
    delete process.env.GOODMEMORY_EMBEDDING_BASE_URL;

    globalThis.fetch = (async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      requests.push(url);

      return new Response(
        JSON.stringify({
          id: "chatcmpl-assisted-extractor",
          object: "chat.completion",
          model: "gpt-4o-mini",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({
                  candidates: [
                    {
                      id: "llm-1",
                      kindHint: "fact",
                      explicitness: "explicit",
                      content: "The current blocker is prod verification.",
                      sourceMessageIndex: 0,
                      sourceRole: "user",
                      metadata: {
                        category: "project",
                        factKind: "blocker",
                      },
                    },
                  ],
                  ignoredMessageCount: 0,
                }),
              },
              finish_reason: "stop",
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    try {
      process.chdir(workspace.root);

      const memory = createGoodMemory({});
      const scope = {
        userId: "auto-user",
        workspaceId: "workspace-a",
        sessionId: "session-1",
      };

      const remembered = await memory.remember({
        scope,
        extractionStrategy: "auto",
        messages: [
          {
            role: "user",
            content:
              "Remember that the current blocker is prod verification instead of QA sign-off.",
          },
        ],
      });
      const recalled = await memory.recall({
        scope,
        query: "What is the current blocker?",
        retrievalProfile: "general_chat",
      });
      const deleted = await memory.deleteAllMemory({
        scope,
        includeRuntime: true,
      });
      const exported = await memory.exportMemory({
        scope,
        includeRuntime: true,
      });

      expect(remembered.metadata?.resolvedExtractionStrategy).toBe("llm-assisted");
      expect(requests.some((url) => url.includes("/chat/completions"))).toBe(true);
      expect(
        recalled.facts.some((record) =>
          record.content.includes("prod verification"),
        ),
      ).toBe(true);
      expect(deleted.deleted.facts).toBeGreaterThan(0);
      expect(exported.durable.facts).toHaveLength(0);
      await expect(
        access(join(workspace.root, ".goodmemory", "memory.sqlite")),
      ).resolves.toBeNull();
    } finally {
      process.chdir(previousCwd);
      globalThis.fetch = originalFetch;
      if (originalStorageProvider === undefined) {
        delete process.env.GOODMEMORY_STORAGE_PROVIDER;
      } else {
        process.env.GOODMEMORY_STORAGE_PROVIDER = originalStorageProvider;
      }
      if (originalStorageUrl === undefined) {
        delete process.env.GOODMEMORY_STORAGE_URL;
      } else {
        process.env.GOODMEMORY_STORAGE_URL = originalStorageUrl;
      }
      if (originalEmbeddingProvider === undefined) {
        delete process.env.GOODMEMORY_EMBEDDING_PROVIDER;
      } else {
        process.env.GOODMEMORY_EMBEDDING_PROVIDER = originalEmbeddingProvider;
      }
      if (originalEmbeddingModel === undefined) {
        delete process.env.GOODMEMORY_EMBEDDING_MODEL;
      } else {
        process.env.GOODMEMORY_EMBEDDING_MODEL = originalEmbeddingModel;
      }
      if (originalEmbeddingApiKey === undefined) {
        delete process.env.GOODMEMORY_EMBEDDING_API_KEY;
      } else {
        process.env.GOODMEMORY_EMBEDDING_API_KEY = originalEmbeddingApiKey;
      }
      if (originalEmbeddingBaseURL === undefined) {
        delete process.env.GOODMEMORY_EMBEDDING_BASE_URL;
      } else {
        process.env.GOODMEMORY_EMBEDDING_BASE_URL = originalEmbeddingBaseURL;
      }
      if (originalExtractorProvider === undefined) {
        delete process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER;
      } else {
        process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER = originalExtractorProvider;
      }
      if (originalExtractorModel === undefined) {
        delete process.env.GOODMEMORY_ASSISTED_EXTRACTOR_MODEL;
      } else {
        process.env.GOODMEMORY_ASSISTED_EXTRACTOR_MODEL = originalExtractorModel;
      }
      if (originalExtractorApiKey === undefined) {
        delete process.env.GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY;
      } else {
        process.env.GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY = originalExtractorApiKey;
      }
      if (originalExtractorBaseURL === undefined) {
        delete process.env.GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL;
      } else {
        process.env.GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL = originalExtractorBaseURL;
      }
      await workspace.cleanup();
    }
  });

  it("does not fall back to local sqlite when configured postgres auto storage cannot be reached", async () => {
    const workspace = await createTempWorkspace("goodmemory-auto-storage-postgres-error");
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace.root);

      const memory = createGoodMemory({
        storage: {
          url: "postgres://127.0.0.1:1/goodmemory",
        },
      });

      await expect(
        memory.remember({
          scope: {
            userId: "auto-user",
            sessionId: "session-1",
          },
          messages: [
            {
              role: "user",
              content: "Remember that durable memory should stay in postgres.",
            },
          ],
        }),
      ).rejects.toThrow(/configured postgres backend/i);

      await expect(
        access(join(workspace.root, ".goodmemory", "memory.sqlite")),
      ).rejects.toThrow();
    } finally {
      process.chdir(previousCwd);
      await workspace.cleanup();
    }
  });

  it("uses postgres as the durable authority when auto storage can bootstrap it", async () => {
    const postgresUrl = process.env.GOODMEMORY_TEST_POSTGRES_URL;
    if (!postgresUrl) {
      expect(postgresUrl).toBeUndefined();
      return;
    }

    const workspace = await createTempWorkspace("goodmemory-auto-storage-postgres");
    const sqliteUrl = join(workspace.root, "fallback.sqlite");
    const adapters = createAutoStorageAdapters({
      postgresUrl,
      sqliteUrl,
    });
    const collection = `auto_postgres_${Date.now()}_${Math.random()}`;
    const scope = {
      userId: `auto-postgres-user-${Date.now()}`,
      workspaceId: "workspace-a",
      sessionId: "session-1",
    };

    try {
      await adapters.documentStore.set(collection, "doc-1", {
        id: "doc-1",
        kind: "fact",
        value: "postgres",
      });
      await adapters.vectorStore.upsert(collection, [
        {
          id: "vector-1",
          embedding: [1, 0, 0],
          metadata: { userId: scope.userId },
          content: "postgres vector",
        },
      ]);
      await adapters.sessionStore.saveBuffer(scope, {
        sessionId: scope.sessionId,
        userId: scope.userId,
        messages: [],
        summary: null,
        summaryUpToIndex: 0,
        createdAt: "2026-04-21T00:00:00.000Z",
        lastActiveAt: "2026-04-21T00:00:00.000Z",
      });

      expect(await adapters.documentStore.get(collection, "doc-1")).toMatchObject({
        value: "postgres",
      });
      expect(
        await adapters.vectorStore.search(collection, [1, 0, 0], {
          topK: 1,
          filter: { userId: scope.userId },
        }),
      ).toHaveLength(1);
      expect((await adapters.sessionStore.getBuffer(scope))?.sessionId).toBe(
        "session-1",
      );
      await expect(access(sqliteUrl)).rejects.toThrow();
    } finally {
      await adapters.vectorStore.delete(collection, "vector-1");
      await adapters.documentStore.delete(collection, "doc-1");
      await adapters.sessionStore.deleteBuffersByScope(scope);
      await workspace.cleanup();
    }
  });
});
