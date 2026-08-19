import { describe, expect, test } from "bun:test";
import { delimiter, join } from "node:path";
import { createGoodMemory } from "../../src";
import { createGoodMemoryHttpMemoryBridge } from "../../src/http";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src/storage/memory";

const repoRoot = process.cwd();

describe("LongMemEval-V2 GoodMemory adapter", () => {
  test("passes its Python contract tests", async () => {
    const child = Bun.spawn({
      cmd: [
        "python3",
        "-m",
        "unittest",
        "discover",
        "-s",
        "scripts/research/longmemeval-v2/tests",
        "-p",
        "test_*.py",
      ],
      cwd: repoRoot,
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONPATH: [
          join(repoRoot, "clients/python"),
          join(repoRoot, "scripts/research/longmemeval-v2"),
        ].join(delimiter),
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    const [exitCode, stderr, stdout] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);

    expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
  });

  test("round-trips one trajectory through the real HTTP bridge", async () => {
    const memory = createGoodMemory({
      adapters: {
        documentStore: createInMemoryDocumentStore(),
        embeddingAdapter: {
          async embed(texts: string[]) {
            return texts.map((value) =>
              /\blink\b/iu.test(value) ? [1, 0, 0] : [0, 1, 0]
            );
          },
        },
        sessionStore: createInMemorySessionStore(),
        vectorStore: createInMemoryVectorStore(),
      },
      retrieval: { semanticCandidates: { topK: 8 } },
      storage: { provider: "memory" },
    });
    const bridge = createGoodMemoryHttpMemoryBridge({ memory });
    const server = Bun.serve({
      fetch: bridge.fetch,
      hostname: "127.0.0.1",
      port: 0,
    });

    try {
      const child = Bun.spawn({
        cmd: [
          "python3",
          "scripts/research/longmemeval-v2/tests/live_bridge_smoke.py",
          `http://127.0.0.1:${server.port}`,
        ],
        cwd: repoRoot,
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONPATH: [
            join(repoRoot, "clients/python"),
            join(repoRoot, "scripts/research/longmemeval-v2"),
          ].join(delimiter),
        },
        stderr: "pipe",
        stdout: "pipe",
      });
      const [exitCode, stderr, stdout] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
        new Response(child.stdout).text(),
      ]);

      expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
      const payload = JSON.parse(stdout) as {
        context: Array<{ type: string; value: string }>;
      };
      const exported = await memory.exportMemory({
        scope: {
          agentId: "longmemeval-v2",
          userId: "longmemeval-v2-smoke",
          workspaceId: "longmemeval-v2-smoke",
        },
      });
      expect(
        exported.durable.facts.map(({ content }) => content),
        `${stdout}\n${stderr}`,
      ).toEqual(expect.arrayContaining([
        expect.stringContaining("View all comments"),
      ]));
      expect(payload.context.some(({ type, value }) =>
        type === "text" && value.includes("View all comments")
      ), `${stdout}\n${stderr}`).toBe(true);
      expect(
        payload.context.some(({ type }) => type === "image"),
        `${stdout}\n${stderr}`,
      ).toBe(true);
      expect(stderr).toContain('"event": "trajectory_inserted"');
      expect(stderr).toContain('"event": "query_completed"');
    } finally {
      server.stop(true);
    }
  });
});
