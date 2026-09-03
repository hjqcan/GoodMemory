import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createTempWorkspace } from "../../src/testing/utils";

const EXPECTED_TOOLS = [
  "goodmemory_get_context",
  "goodmemory_get_records",
  "goodmemory_inspect_memory",
  "goodmemory_read_artifacts",
  "goodmemory_remember",
  "goodmemory_search_index",
  "goodmemory_stats",
  "goodmemory_timeline",
  "goodmemory_trace_recall",
  "goodmemory_write_note",
] as const;

interface KimiManifest {
  mcpServers: {
    goodmemory: {
      args: string[];
      env: Record<string, string>;
    };
  };
}

function createChildEnv(
  overrides: Record<string, string | undefined>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env;
}

async function readManifest(): Promise<KimiManifest> {
  return JSON.parse(
    await readFile(join(import.meta.dir, "../../kimi.plugin.json"), "utf8"),
  ) as KimiManifest;
}

async function connectPluginServer(input: {
  homeRoot: string;
  manifest: KimiManifest;
  workspaceRoot: string;
}): Promise<{ client: Client; transport: StdioClientTransport }> {
  const server = input.manifest.mcpServers.goodmemory;
  const pluginFlags = server.args.slice(4);
  const mcpScript = join(import.meta.dir, "../../scripts/goodmemory-mcp.ts");
  const transport = new StdioClientTransport({
    args: [mcpScript, ...pluginFlags],
    command: "bun",
    cwd: input.workspaceRoot,
    env: createChildEnv({
      ...server.env,
      GOODMEMORY_HOME: input.homeRoot,
    }),
    stderr: "pipe",
  });
  const client = new Client(
    { name: "goodmemory-kimi-plugin-test", version: "0.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return { client, transport };
}

describe("Kimi Code plugin MCP flow", () => {
  it("persists across sessions, traces recall, and isolates project cwd scopes", async () => {
    const home = await createTempWorkspace("goodmemory-kimi-home");
    const projectA = await createTempWorkspace("goodmemory-kimi-project-a");
    const projectB = await createTempWorkspace("goodmemory-kimi-project-b");
    const manifest = await readManifest();
    let transport: StdioClientTransport | null = null;

    try {
      let client: Client;
      ({ client, transport } = await connectPluginServer({
        homeRoot: home.root,
        manifest,
        workspaceRoot: projectA.root,
      }));

      expect(
        (await client.listTools()).tools.map((tool) => tool.name).sort(),
      ).toEqual([...EXPECTED_TOOLS]);

      const emptyStats = await client.callTool({
        arguments: { cwd: projectA.root },
        name: "goodmemory_stats",
      });
      const emptyCounts = (
        emptyStats.structuredContent as { counts: Record<string, number> }
      ).counts;
      expect(Object.values(emptyCounts).reduce((sum, count) => sum + count, 0)).toBe(0);

      const statement =
        "The Kimi plugin release decision is to use blue-green deployment for Atlas.";
      const rememberedResult = await client.callTool({
        arguments: {
          content: statement,
          cwd: projectA.root,
          role: "user",
        },
        name: "goodmemory_remember",
      });
      const remembered = rememberedResult.structuredContent as {
        accepted: number;
        memoryIds: string[];
        rejected: number;
      };
      expect(remembered.accepted).toBeGreaterThanOrEqual(1);
      expect(remembered.memoryIds.length).toBeGreaterThanOrEqual(1);
      const memoryId = remembered.memoryIds[0];
      if (!memoryId) {
        throw new Error("Expected the Kimi plugin write to return one memory id.");
      }

      await transport.close();
      transport = null;
      ({ client, transport } = await connectPluginServer({
        homeRoot: home.root,
        manifest,
        workspaceRoot: projectA.root,
      }));

      const recalledResult = await client.callTool({
        arguments: {
          cwd: projectA.root,
          query: "What deployment decision did we make for Atlas?",
        },
        name: "goodmemory_get_context",
      });
      expect(recalledResult.structuredContent).toHaveProperty(
        "content",
        expect.stringContaining("blue-green deployment"),
      );

      const traceResult = await client.callTool({
        arguments: {
          cwd: projectA.root,
          query: "What deployment decision did we make for Atlas?",
        },
        name: "goodmemory_trace_recall",
      });
      expect(JSON.stringify(traceResult.structuredContent)).toContain(memoryId);

      const isolatedResult = await client.callTool({
        arguments: {
          cwd: projectB.root,
          query: "What deployment decision did we make for Atlas?",
        },
        name: "goodmemory_get_context",
      });
      expect(JSON.stringify(isolatedResult.structuredContent)).not.toContain(
        "blue-green deployment",
      );

      const duplicateResult = await client.callTool({
        arguments: {
          content: statement,
          cwd: projectA.root,
          role: "user",
        },
        name: "goodmemory_remember",
      });
      const duplicate = duplicateResult.structuredContent as {
        accepted: number;
        explanation?: string;
        outcomes: Array<{ outcome: string }>;
        rejected: number;
      };
      expect(duplicate.accepted + duplicate.rejected).toBeGreaterThanOrEqual(1);
      expect(duplicate.outcomes.length).toBeGreaterThanOrEqual(1);
      if (duplicate.accepted === 0) {
        expect(duplicate.explanation?.length ?? 0).toBeGreaterThan(0);
      }
    } finally {
      if (transport) {
        await transport.close();
      }
      await projectB.cleanup();
      await projectA.cleanup();
      await home.cleanup();
    }
  }, 40_000);

  it("fails actionably without Bun and does not create storage", async () => {
    const home = await createTempWorkspace("goodmemory-kimi-missing-bun");
    const wrapper = join(import.meta.dir, "../../scripts/goodmemory-mcp.js");
    const sqlitePath = join(home.root, "standalone.sqlite");

    try {
      const child = Bun.spawn(
        ["node", wrapper, "--standalone", "--user-id", "kimi-code", "--allow-write"],
        {
          env: createChildEnv({
            GOODMEMORY_BUN_BINARY: "missing-goodmemory-bun",
            GOODMEMORY_HOME: home.root,
          }),
          stderr: "pipe",
          stdin: "ignore",
          stdout: "pipe",
        },
      );
      const [exitCode, stderr, stdout] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
        new Response(child.stdout).text(),
      ]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("GoodMemory MCP currently requires Bun");
      expect(stderr).toContain("GOODMEMORY_BUN_BINARY");
      expect(stdout).toBe("");
      expect(await Bun.file(sqlitePath).exists()).toBe(false);
    } finally {
      await home.cleanup();
    }
  });
});
