import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGoodMemory } from "../../src";
import type { GoodMemoryConfig } from "../../src";
import type { GoodMemoryMcpServerDependencies } from "../../src/install/hostMcpServer";
import { createGoodMemoryMcpServer } from "../../src/install/hostMcpServer";

const WORKSPACE_ROOT = "/tmp/goodmemory-note-tool-workspace";
const BODY = "# Reading MediaWiki\n\nMost MediaWiki sites expose api.php.\n";

interface InspectableTool {
  description?: string;
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  }>;
  inputSchema?: { safeParse(value: unknown): { success: boolean } };
}

function inspectServer(server: object): { _registeredTools: Record<string, InspectableTool | undefined> } {
  return server as unknown as { _registeredTools: Record<string, InspectableTool | undefined> };
}

function runtimeConfig(): string {
  return JSON.stringify({
    activationMode: "global",
    host: "codex",
    maxTokens: 64,
    retrievalProfile: "coding_agent",
    storage: { provider: "memory", url: "memory://note-tool" },
    userId: "mcp-user",
    version: 1,
    writeback: {
      allowAssistantOutput: "confirmed_or_verified",
      dryRun: false,
      maxChars: 12_000,
      maxMessages: 12,
      minConfidence: 0.7,
      mode: "off",
      persistRawTranscript: false,
    },
  });
}

function createDependencies(homeRoot: string): GoodMemoryMcpServerDependencies {
  let memory: ReturnType<typeof createGoodMemory> | undefined;
  return {
    createMemory: (config: GoodMemoryConfig) => {
      memory ??= createGoodMemory({ ...config, storage: { provider: "memory" } });
      return memory;
    },
    homeRoot,
    readFile: async (path: string) => {
      if (path === `${WORKSPACE_ROOT}/.goodmemory/codex.json`) {
        return JSON.stringify({ enabled: true, host: "codex", workspaceId: "mcp-workspace" });
      }
      if (path.endsWith("/.goodmemory/codex.json")) {
        return runtimeConfig();
      }
      throw Object.assign(new Error(`missing ${path}`), { code: "ENOENT" as const });
    },
  };
}

describe("goodmemory_write_note MCP tool", () => {
  it("is registered only when writes are allowed", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "goodmemory-note-tool-"));
    try {
      const readOnly = inspectServer(createGoodMemoryMcpServer({ dependencies: createDependencies(homeRoot), host: "codex" }));
      expect(readOnly._registeredTools.goodmemory_write_note).toBeUndefined();

      const writable = inspectServer(createGoodMemoryMcpServer({ allowWrite: true, dependencies: createDependencies(homeRoot), host: "codex" }));
      expect(writable._registeredTools.goodmemory_write_note?.description).toContain("page");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("writes a verbatim note, supersedes on rewrite, and exposes the note through get_context", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "goodmemory-note-tool-"));
    try {
      const server = inspectServer(createGoodMemoryMcpServer({ allowWrite: true, dependencies: createDependencies(homeRoot), host: "codex" }));
      const tool = server._registeredTools.goodmemory_write_note!;

      const first = await tool.handler({ body: BODY, cwd: WORKSPACE_ROOT, sessionId: "sess-1", title: "Reading MediaWiki sites as an agent" });
      expect(first.isError).toBeUndefined();
      expect(first.structuredContent).toMatchObject({ outcome: "written", memoryType: "note" });
      expect(typeof first.structuredContent?.noteId).toBe("string");

      const second = await tool.handler({ body: `${BODY}\nPrefer the REST summary endpoint.\n`, cwd: WORKSPACE_ROOT, sessionId: "sess-1", title: "Reading MediaWiki sites as an agent" });
      expect(second.structuredContent).toMatchObject({ outcome: "superseded", memoryType: "note" });

      const context = await server._registeredTools.goodmemory_get_context!.handler({ cwd: WORKSPACE_ROOT, output: "markdown", query: "How do MediaWiki sites expose api.php?" });
      expect(String(context.structuredContent?.content)).toContain("## Notes");
      expect(String(context.structuredContent?.content)).toContain("Prefer the REST summary endpoint.");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("rejects an oversize body at the schema and accepts a note kind hint on goodmemory_remember", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "goodmemory-note-tool-"));
    try {
      const server = inspectServer(createGoodMemoryMcpServer({ allowWrite: true, dependencies: createDependencies(homeRoot), host: "codex" }));
      const schema = server._registeredTools.goodmemory_write_note!.inputSchema!;
      expect(schema.safeParse({ body: "x".repeat(8193), cwd: WORKSPACE_ROOT, title: "Too big" }).success).toBe(false);
      expect(schema.safeParse({ body: "x".repeat(8192), cwd: WORKSPACE_ROOT, title: "Fits" }).success).toBe(true);

      const remembered = await server._registeredTools.goodmemory_remember!.handler({ content: BODY, cwd: WORKSPACE_ROOT, kindHint: "note" });
      expect(remembered.structuredContent?.accepted).toBe(1);
      expect((remembered.structuredContent?.events as Array<{ memoryType: string }>)[0]?.memoryType).toBe("note");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });
});
