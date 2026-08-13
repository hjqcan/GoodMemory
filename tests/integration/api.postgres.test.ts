import { SQL } from "bun";
import { describe, expect, it } from "bun:test";
import { createGoodMemory } from "../../src";
import { createAISDKEmbeddingAdapter } from "../../src/provider/ai-sdk-runtime";

const POSTGRES_URL = process.env.GOODMEMORY_TEST_POSTGRES_URL;

async function cleanupUserData(url: string, userId: string): Promise<void> {
  const sql = new SQL(url);

  try {
    await sql.unsafe(
      `
        DELETE FROM "public"."gm_documents"
        WHERE document @> $1::text::jsonb
      `,
      [JSON.stringify({ userId })],
    );
    await sql.unsafe(
      `
        DELETE FROM "public"."gm_session_state"
        WHERE scope_key LIKE $1
      `,
      [`${userId}::%`],
    );
    await sql.unsafe(
      `
        DELETE FROM "public"."gm_vectors"
        WHERE metadata->>'userId' = $1
          AND to_regclass('public.gm_vectors') IS NOT NULL
      `,
      [userId],
    ).catch((error: unknown) => {
      if (
        error &&
        typeof error === "object" &&
        "errno" in error &&
        error.errno === "42P01"
      ) {
        return [];
      }

      throw error;
    });
  } finally {
    await sql.close();
  }
}

if (POSTGRES_URL) {
  describe("public postgres API", () => {
    it("preserves event occurrence and day-fenced recall across postgres instances", async () => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const userId = `pg-temporal-${unique}`;
      const durableScope = {
        userId,
        workspaceId: "workspace-a",
      };
      const storage = {
        provider: "postgres" as const,
        url: POSTGRES_URL,
      };

      try {
        const writer = createGoodMemory({ storage });
        await writer.remember({
          extractionStrategy: "rules-only",
          locale: "zh-CN",
          messages: [{
            content: "我昨天吃了番茄炒蛋。",
            observedAt: "2026-08-12T02:00:00.000Z",
            role: "user",
            timezone: "Asia/Shanghai",
          }],
          scope: { ...durableScope, sessionId: "write" },
        });

        const reader = createGoodMemory({ storage });
        const exported = await reader.exportMemory({ scope: durableScope });
        const sameDay = await reader.recall({
          locale: "zh-CN",
          query: "我昨天吃了什么？",
          referenceTime: "2026-08-12T03:00:00.000Z",
          scope: { ...durableScope, sessionId: "read-same-day" },
          strategy: "rules-only",
          timezone: "Asia/Shanghai",
        });
        const nextDay = await reader.recall({
          locale: "zh-CN",
          query: "我昨天吃了什么？",
          referenceTime: "2026-08-13T03:00:00.000Z",
          scope: { ...durableScope, sessionId: "read-next-day" },
          strategy: "rules-only",
          timezone: "Asia/Shanghai",
        });

        expect(exported.durable.facts[0]?.occurrence).toEqual({
          endExclusive: "2026-08-11T16:00:00.000Z",
          precision: "day",
          start: "2026-08-10T16:00:00.000Z",
          timezone: "Asia/Shanghai",
        });
        expect(sameDay.facts.map(({ content }) => content)).toEqual([
          "我吃了番茄炒蛋。",
        ]);
        expect(nextDay.facts).toEqual([]);
      } finally {
        await cleanupUserData(POSTGRES_URL, userId);
      }
    }, 15_000);

    it("rejects NUL-containing facts before JSONB persistence", async () => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const userId = `pg-nul-${unique}`;
      const scope = {
        userId,
        sessionId: `s-${unique}`,
        workspaceId: "workspace-a",
      };
      const memory = createGoodMemory({
        storage: {
          provider: "postgres",
          url: POSTGRES_URL,
        },
        testing: {
          extractor: {
            async extract() {
              return {
                candidates: [{
                  id: "visible-with-nul",
                  kindHint: "fact" as const,
                  explicitness: "explicit" as const,
                  content: "project\u0000code=Tachikoma",
                  sourceMessageIndex: 0,
                  sourceRole: "user" as const,
                }],
                ignoredMessageCount: 0,
              };
            },
          },
        },
      });

      try {
        const remembered = await memory.remember({
          scope,
          messages: [{ role: "user", content: "source" }],
        });
        const exported = await memory.exportMemory({ scope });

        expect(remembered).toMatchObject({
          accepted: 0,
          rejected: 1,
          events: [expect.objectContaining({ reason: "invalid_payload" })],
        });
        expect(exported.durable.facts).toEqual([]);
      } finally {
        await cleanupUserData(POSTGRES_URL, userId);
      }
    }, 15_000);

    it("rejects NUL-containing raw messages before JSONB persistence", async () => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const userId = `pg-nul-source-${unique}`;
      const scope = {
        userId,
        sessionId: `s-${unique}`,
        workspaceId: "workspace-a",
      };
      const memory = createGoodMemory({
        storage: {
          provider: "postgres",
          url: POSTGRES_URL,
        },
      });

      try {
        const remembered = await memory.remember({
          extractionStrategy: "rules-only",
          scope,
          messages: [{ role: "user", content: "ordinary\u0000context" }],
        });
        const exported = await memory.exportMemory({ scope });

        expect(remembered.accepted).toBe(0);
        expect(exported.durable.sourceMessages).toEqual([]);
      } finally {
        await cleanupUserData(POSTGRES_URL, userId);
      }
    }, 15_000);

    it("rejects storage-unsafe external strings before any JSONB write", async () => {
      const fixtures = [
        ["subject", { subject: "project\u0000alpha" }],
        ["attributes", { attributes: { note: "visible\u0000metadata" } }],
        ["tags", { tags: Array.of("release\u0000private") }],
        ["unpaired-high-surrogate", { subject: "project\uD800alpha" }],
        ["unpaired-low-surrogate", { subject: "project\uDC00alpha" }],
      ] as const;

      for (const [name, metadata] of fixtures) {
        const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const userId = `pg-storage-unsafe-${name}-${unique}`;
        const scope = {
          userId,
          sessionId: `s-${unique}`,
          workspaceId: "workspace-a",
        };
        const memory = createGoodMemory({
          storage: { provider: "postgres", url: POSTGRES_URL },
          testing: {
            extractor: {
              async extract() {
                return {
                  candidates: [{
                    id: `unsafe-${name}`,
                    kindHint: "fact" as const,
                    explicitness: "explicit" as const,
                    content: "project code=Tachikoma",
                    metadata,
                    sourceMessageIndex: 0,
                    sourceRole: "user" as const,
                  }],
                  ignoredMessageCount: 0,
                };
              },
            },
          },
        });

        try {
          const remembered = await memory.remember({
            messages: [{ role: "user", content: "safe source" }],
            scope,
          });
          const exported = await memory.exportMemory({ scope });

          expect(remembered).toMatchObject({
            accepted: 0,
            rejected: 1,
            events: [expect.objectContaining({ reason: "storage_unsafe" })],
          });
          expect(exported.durable.facts).toEqual([]);
          expect(exported.durable.evidence).toEqual([]);
          expect(exported.durable.sourceMessages).toEqual([]);
        } finally {
          await cleanupUserData(POSTGRES_URL, userId);
        }
      }

      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const userId = `pg-storage-unsafe-id-${unique}`;
      const scope = {
        userId,
        sessionId: `s-${unique}`,
        workspaceId: "workspace-a",
      };
      const memory = createGoodMemory({
        storage: { provider: "postgres", url: POSTGRES_URL },
      });
      try {
        await expect(memory.remember({
          messages: [{
            id: "message\u0000id",
            role: "user",
            content: "Remember that editor=Neovim.",
          }],
          scope,
        })).rejects.toThrow("Storage-unsafe text at input.messages[0].id");
        expect((await memory.exportMemory({ scope })).durable.sourceMessages).toEqual([]);
      } finally {
        await cleanupUserData(POSTGRES_URL, userId);
      }
    }, 30_000);

    it("rejects storage-unsafe recall scope before a Postgres experience write", async () => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const userId = `pg-storage-unsafe-recall-${unique}`;
      const memory = createGoodMemory({
        storage: { provider: "postgres", url: POSTGRES_URL },
      });

      try {
        await expect(memory.recall({
          query: "What is the project status?",
          scope: {
            sessionId: `s-${unique}`,
            userId,
            workspaceId: "workspace\u0000unsafe",
          },
          strategy: "rules-only",
        })).rejects.toMatchObject({
          code: "ERR_GOODMEMORY_STORAGE_UNSAFE_TEXT",
          path: "input.scope.workspaceId",
        });

        const exported = await memory.exportMemory({ scope: { userId } });
        expect(exported.durable.experiences).toEqual([]);
      } finally {
        await cleanupUserData(POSTGRES_URL, userId);
      }
    }, 15_000);

    it("runs remember, recall, feedback, forget, and buildContext against postgres", async () => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const userId = `pg-e2e-${unique}`;
      const sessionId = `s-${unique}`;
      const workspaceId = "workspace-a";
      const scope = {
        userId,
        sessionId,
        workspaceId,
      };
      const memory = createGoodMemory({
        storage: {
          provider: "postgres",
          url: POSTGRES_URL,
        },
      });

      try {
        const rememberResult = await memory.remember({
          scope,
          messages: [
            {
              role: "user",
              content: "Remember that the robot workflow is blocked on prod migration.",
            },
            {
              role: "user",
              content: "Please keep answers concise and action-oriented.",
            },
          ],
        });

        expect(rememberResult.accepted).toBe(2);

        const recallResult = await memory.recall({
          scope,
          query: "How should I answer this user?",
          retrievalProfile: "general_chat",
        });

        expect(recallResult.facts).toHaveLength(1);
        expect(recallResult.feedback).toHaveLength(1);
        expect(recallResult.facts[0]?.content).toContain("prod migration");

        const context = await memory.buildContext({
          recall: recallResult,
          output: "markdown",
        });

        expect(context.content).toContain("## Procedural Memory");
        expect(context.content).toContain("## Facts");

        const feedbackResult = await memory.feedback({
          scope,
          signal: "Please use bullet points when summarizing project status.",
        });

        expect(feedbackResult.accepted).toBe(true);
        expect(feedbackResult.outcome).toBe("superseded");

        const factId = rememberResult.events.find(
          (event) => event.memoryType === "fact" && event.memoryId,
        )?.memoryId;

        expect(factId).toBeTruthy();

        const forgetResult = await memory.forget({
          scope,
          memoryId: factId,
        });

        expect(forgetResult.forgotten).toBe(true);

        const afterForget = await memory.recall({
          scope,
          query: "How should I answer this user?",
          retrievalProfile: "general_chat",
        });

        expect(afterForget.facts).toHaveLength(0);
        expect(
          afterForget.feedback.some(
            (item) =>
              item.lifecycle === "active" &&
              item.rule.includes("bullet points"),
          ),
        ).toBe(true);
      } finally {
        await cleanupUserData(POSTGRES_URL, userId);
      }
    }, 15_000);

    it("writes provider-backed embeddings into pgvector and uses them during hybrid recall", async () => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const userId = `pg-embed-${unique}`;
      const sessionId = `s-${unique}`;
      const workspaceId = "workspace-a";
      const scope = {
        userId,
        sessionId,
        workspaceId,
      };
      const query = "What is the current blocker?";
      const wrongFactText =
        "The current blocker is vendor approval for the runtime dashboard.";
      const rightFactText =
        "The current blocker is service account rotation for migration rollout.";
      const embeddingByText = new Map<string, number[]>([
        [query, [1, 0, 0]],
        [wrongFactText, [0, 1, 0]],
        [rightFactText, [1, 0, 0]],
      ]);
      const embeddingAdapter = createAISDKEmbeddingAdapter({
        model: {
          provider: "openai",
          model: "text-embedding-3-small",
        },
        dependencies: {
          resolveEmbeddingModel: (config) => ({ resolvedFrom: config.model }) as never,
          embedMany: async ({ values }) => ({
            embeddings: values.map((value) => embeddingByText.get(value) ?? [0, 0, 0]),
          }) as never,
        },
      });
      const memory = createGoodMemory({
        storage: {
          provider: "postgres",
          url: POSTGRES_URL,
        },
        adapters: {
          embeddingAdapter,
        },
      });
      const sql = new SQL(POSTGRES_URL);

      try {
        const rememberResult = await memory.remember({
          scope,
          messages: [
            {
              role: "user",
              content: `Remember that ${wrongFactText}`,
            },
            {
              role: "user",
              content: `Remember that ${rightFactText}`,
            },
          ],
        });

        expect(rememberResult.accepted).toBe(2);

        const vectorRows = await sql.unsafe<Array<{ collection: string; content: string }>>(
          `
            SELECT collection, content
            FROM "public"."gm_vectors"
            WHERE metadata->>'userId' = $1
              AND metadata->>'workspaceId' = $2
            ORDER BY collection ASC, id ASC
          `,
          [userId, workspaceId],
        );

        expect(vectorRows.filter((row) => row.collection === "facts")).toHaveLength(2);
        expect(vectorRows.some((row) => row.content === rightFactText)).toBe(true);

        const result = await memory.recall({
          scope,
          query,
          retrievalProfile: "general_chat",
          strategy: "hybrid",
        });

        expect(result.metadata.routingDecision.strategy).toBe("hybrid");
        expect(result.facts[0]?.content).toBe(rightFactText);
      } finally {
        await sql.close();
        await cleanupUserData(POSTGRES_URL, userId);
      }
    }, 15_000);
  });
} else {
  describe.skip("public postgres API", () => {
    it("requires GOODMEMORY_TEST_POSTGRES_URL", () => {});
  });
}
