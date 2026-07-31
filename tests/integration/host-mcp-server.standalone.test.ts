import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "bun:test";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createFactMemory,
  createGoodMemory,
  createReferenceMemory,
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
} from "../../src";
import { createMemorySource } from "../../src/domain/provenance";
import { createInMemoryVectorStore } from "../../src/storage/memory";
import { createMemoryRepositories } from "../../src/storage/repositories";
import { createTempWorkspace } from "../../src/testing/utils";

// Standalone mode runs the MCP server with zero installed-host config files:
// scope and storage come from flags/env. Visibility follows the default scope
// guard's containment rule: the agent-less standalone scope sees agent-less
// records only, and reading an installed host's agent-tagged memory requires
// the explicit --agent-id opt-in.

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

async function seedSQLiteMemoryAsCodex(sqlitePath: string) {
  await mkdir(dirname(sqlitePath), { recursive: true });
  const documentStore = createSQLiteDocumentStore(sqlitePath);
  const sessionStore = createSQLiteSessionStore(sqlitePath);
  const vectorStore = createInMemoryVectorStore();
  const memory = createGoodMemory({
    adapters: { documentStore, sessionStore, vectorStore },
    storage: { provider: "sqlite", url: sqlitePath },
  });
  const repositories = createMemoryRepositories({
    documentStore,
    sessionStore,
    vectorStore,
  });
  const timestamp = "2026-01-01T00:00:00.000Z";
  const source = createMemorySource({
    extractedAt: timestamp,
    method: "explicit",
    sessionId: "session-1",
  });

  // Written under the codex agent, as an installed host would: private to
  // codex unless the standalone caller opts in with --agent-id codex.
  await repositories.facts.add(
    createFactMemory({
      agentId: "codex",
      category: "project",
      content: "The current blocker is vendor approval for release quality program.",
      createdAt: timestamp,
      id: "fact-blocker",
      sessionId: "session-1",
      source,
      updatedAt: timestamp,
      userId: "cli-user",
      workspaceId: "workspace-a",
    }),
  );
  // Agent-less record: visible to the default (agent-less) standalone scope.
  // Worded as a blocker with strong query overlap so it wins the blocker slot
  // outright — the codex-tagged fact competes for the same slot but is policy
  // filtered under the agent-less scope, and slot picks do not backfill.
  await repositories.facts.add(
    createFactMemory({
      category: "project",
      content: "The current blocker is the release quality vendor approval runbook sign-off.",
      createdAt: timestamp,
      id: "fact-shared",
      sessionId: "session-1",
      source,
      updatedAt: timestamp,
      userId: "cli-user",
      workspaceId: "workspace-a",
    }),
  );
  await repositories.references.add(
    createReferenceMemory({
      createdAt: timestamp,
      id: "ref-runbook",
      pointer: "docs/release-quality-runbook.md",
      sessionId: "session-1",
      source,
      title: "release-quality-runbook.md",
      updatedAt: timestamp,
      userId: "cli-user",
      workspaceId: "workspace-a",
    }),
  );

  return { memory };
}

function standaloneArgs(mcpScript: string, sqlitePath: string, extra: string[] = []) {
  return [
    mcpScript,
    "--standalone",
    "--user-id",
    "cli-user",
    "--workspace-id",
    "workspace-a",
    "--storage-provider",
    "sqlite",
    "--storage-url",
    sqlitePath,
    ...extra,
  ];
}

describe("goodmemory mcp server standalone mode", () => {
  it("serves the read-only tools from flags/env with no installed host config", async () => {
    const home = await createTempWorkspace("goodmemory-mcp-standalone-home");
    const workspace = await createTempWorkspace("goodmemory-mcp-standalone-ws");
    const sqlitePath = join(home.root, ".goodmemory", "standalone.sqlite");
    const mcpScript = join(import.meta.dir, "../../scripts/goodmemory-mcp.ts");
    let transport: StdioClientTransport | null = null;

    try {
      await seedSQLiteMemoryAsCodex(sqlitePath);
      // The standalone scope omits agentId, so direct recall should mirror
      // agent-less standalone visibility: the codex-written record stays
      // private unless the caller opts in below.
      const standaloneScope = {
        sessionId: "session-1",
        userId: "cli-user",
        workspaceId: "workspace-a",
      };
      transport = new StdioClientTransport({
        args: standaloneArgs(mcpScript, sqlitePath),
        command: "bun",
        cwd: workspace.root,
        env: createChildEnv({
          GOODMEMORY_HOME: home.root,
        }),
        stderr: "pipe",
      });
      const client = new Client(
        { name: "goodmemory-mcp-standalone-test-client", version: "0.0.0" },
        {
          capabilities: {},
          versionNegotiation: {
            mode: {
              pin: "2026-07-28",
            },
          },
        },
      );
      await client.connect(transport);
      expect(client.getProtocolEra()).toBe("modern");
      expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");

      const listedTools = await client.listTools();
      expect(listedTools.tools.map((tool) => tool.name).sort()).toEqual([
        "goodmemory_get_context",
        "goodmemory_get_records",
        "goodmemory_inspect_memory",
        "goodmemory_read_artifacts",
        "goodmemory_search_index",
        "goodmemory_stats",
        "goodmemory_timeline",
        "goodmemory_trace_recall",
      ]);

      const contextResult = await client.callTool({
        arguments: {
          cwd: workspace.root,
          query: "Check the release runbook before editing files.",
          sessionId: "session-1",
        },
        name: "goodmemory_get_context",
      });
      expect(contextResult.structuredContent).toMatchObject({
        maxTokens: 256,
        output: "developer_prompt_fragment",
        query: "Check the release runbook before editing files.",
        scope: standaloneScope,
      });
      expect(contextResult.structuredContent).toHaveProperty(
        "content",
        expect.stringContaining(
          "The current blocker is the release quality vendor approval runbook sign-off.",
        ),
      );
      expect(contextResult.structuredContent).toHaveProperty(
        "content",
        expect.stringContaining("docs/release-quality-runbook.md"),
      );
      const echoedScope = (
        contextResult.structuredContent as { scope: Record<string, unknown> }
      ).scope;
      expect("agentId" in echoedScope).toBe(false);

      // Storage is shared (stats counts the whole store slice), but recall
      // containment below only surfaces the agent-less fact.
      const statsResult = await client.callTool({
        arguments: {
          cwd: workspace.root,
          sessionId: "session-1",
        },
        name: "goodmemory_stats",
      });
      expect(statsResult.structuredContent).toHaveProperty("counts.facts", 2);
      expect(statsResult.structuredContent).toHaveProperty(
        "counts.references",
        1,
      );
      // Retrieval runtime status lets an agent see the active config (here a
      // bare in-memory store: no embedding, no preset) alongside the counts.
      expect(statsResult.structuredContent).toHaveProperty(
        "retrieval.embeddingEnabled",
        false,
      );
      expect(statsResult.structuredContent).toHaveProperty(
        "retrieval.retrievalPreset",
        null,
      );

      // Progressive flow works and provisions the generic-host secret. The
      // agent-less scope surfaces the agent-less fact only.
      const searchIndexResult = await client.callTool({
        arguments: {
          cwd: workspace.root,
          query: "release quality vendor approval runbook",
          sessionId: "session-1",
        },
        name: "goodmemory_search_index",
      });
      const searchIndex = searchIndexResult.structuredContent as {
        records: Array<{ recordKind: string; recordRef: string }>;
        scopeDigest: string;
      };
      expect(searchIndex.scopeDigest).toMatch(/^scope_[a-f0-9]{32}$/u);
      const factRecordRef = searchIndex.records.find(
        (record) => record.recordKind === "fact",
      )?.recordRef;
      if (!factRecordRef) {
        throw new Error("Expected the standalone search index to include a fact.");
      }

      const recordsResult = await client.callTool({
        arguments: {
          cwd: workspace.root,
          recordRefs: [factRecordRef],
          sessionId: "session-1",
        },
        name: "goodmemory_get_records",
      });
      const recordsJson = JSON.stringify(recordsResult.structuredContent);
      expect(recordsJson).toContain("runbook sign-off");
      // The codex-tagged fact stays private to codex under the agent-less scope.
      expect(recordsJson).not.toContain("vendor approval for release quality program");

      const secretPath = join(
        home.root,
        ".goodmemory",
        "generic-progressive-scope-secret",
      );
      expect(((await stat(secretPath)).mode & 0o777)).toBe(0o600);
      await transport.close();
      transport = null;

      // Explicit --agent-id codex opts into the installed host's agent-tagged
      // memory: this is the documented cross-host sharing recipe.
      transport = new StdioClientTransport({
        args: standaloneArgs(mcpScript, sqlitePath, ["--agent-id", "codex"]),
        command: "bun",
        cwd: workspace.root,
        env: createChildEnv({
          GOODMEMORY_HOME: home.root,
        }),
        stderr: "pipe",
      });
      const codexClient = new Client(
        { name: "goodmemory-mcp-standalone-agent-client", version: "0.0.0" },
        { capabilities: {} },
      );
      await codexClient.connect(transport);
      const codexContext = await codexClient.callTool({
        arguments: {
          cwd: workspace.root,
          query: "release quality vendor approval runbook",
          sessionId: "session-1",
        },
        name: "goodmemory_trace_recall",
      });
      const codexTrace = codexContext.structuredContent as {
        hits: Array<{ id: string }>;
        scope: Record<string, unknown>;
      };
      expect(codexTrace.scope.agentId).toBe("codex");
      expect(codexTrace.hits.map((hit) => hit.id)).toContain("fact-blocker");
    } finally {
      if (transport) {
        await transport.close();
      }
      await workspace.cleanup();
      await home.cleanup();
    }
  }, 30_000);

  it("registers and serves the write tool behind --allow-write", async () => {
    const home = await createTempWorkspace("goodmemory-mcp-standalone-write");
    const workspace = await createTempWorkspace("goodmemory-mcp-standalone-write-ws");
    const sqlitePath = join(home.root, ".goodmemory", "standalone.sqlite");
    const mcpScript = join(import.meta.dir, "../../scripts/goodmemory-mcp.ts");
    let transport: StdioClientTransport | null = null;

    try {
      transport = new StdioClientTransport({
        args: standaloneArgs(mcpScript, sqlitePath, ["--allow-write"]),
        command: "bun",
        cwd: workspace.root,
        env: createChildEnv({
          GOODMEMORY_HOME: home.root,
        }),
        stderr: "pipe",
      });
      const client = new Client(
        { name: "goodmemory-mcp-standalone-write-client", version: "0.0.0" },
        { capabilities: {} },
      );
      await client.connect(transport);

      const listedTools = await client.listTools();
      const toolNames = listedTools.tools.map((tool) => tool.name);
      expect(toolNames).toContain("goodmemory_remember");
      expect(toolNames).toHaveLength(9);

      const rememberResult = await client.callTool({
        arguments: {
          content:
            "Remember that the deploy is blocked on smoke verification.",
          cwd: workspace.root,
          role: "user",
          sessionId: "session-1",
        },
        name: "goodmemory_remember",
      });
      expect(rememberResult.isError ?? false).toBe(false);
      const remembered = rememberResult.structuredContent as {
        accepted: number;
        memoryIds: string[];
      };
      expect(remembered.accepted).toBeGreaterThanOrEqual(1);
      expect(remembered.memoryIds.length).toBeGreaterThanOrEqual(1);

      const statsResult = await client.callTool({
        arguments: {
          cwd: workspace.root,
          sessionId: "session-1",
        },
        name: "goodmemory_stats",
      });
      const stats = statsResult.structuredContent as {
        counts: Record<string, number>;
      };
      const totalDurable = Object.values(stats.counts).reduce(
        (sum, count) => sum + count,
        0,
      );
      expect(totalDurable).toBeGreaterThanOrEqual(1);
      await transport.close();
      transport = null;

      // Env opt-in is equivalent to the flag (the managed-config-safe form
      // for installed hosts).
      transport = new StdioClientTransport({
        args: standaloneArgs(mcpScript, sqlitePath),
        command: "bun",
        cwd: workspace.root,
        env: createChildEnv({
          GOODMEMORY_HOME: home.root,
          GOODMEMORY_MCP_ALLOW_WRITE: "1",
        }),
        stderr: "pipe",
      });
      const envClient = new Client(
        { name: "goodmemory-mcp-standalone-env-write-client", version: "0.0.0" },
        { capabilities: {} },
      );
      await envClient.connect(transport);
      const envTools = await envClient.listTools();
      expect(envTools.tools.map((tool) => tool.name)).toContain(
        "goodmemory_remember",
      );
    } finally {
      if (transport) {
        await transport.close();
      }
      await workspace.cleanup();
      await home.cleanup();
    }
  }, 30_000);

  it("exits promptly when the host sends SIGTERM", async () => {
    const home = await createTempWorkspace("goodmemory-mcp-shutdown-home");
    const workspace = await createTempWorkspace("goodmemory-mcp-shutdown-ws");
    const mcpScript = join(import.meta.dir, "../../scripts/goodmemory-mcp.ts");
    const child = Bun.spawn(
      [
        "bun",
        mcpScript,
        "--standalone",
        "--user-id",
        "shutdown-user",
        "--storage-provider",
        "memory",
      ],
      {
        cwd: workspace.root,
        env: createChildEnv({
          GOODMEMORY_HOME: home.root,
        }),
        stderr: "pipe",
        stdin: "pipe",
        stdout: "pipe",
      },
    );

    try {
      await Bun.sleep(300);
      expect(child.exitCode).toBeNull();
      child.kill("SIGTERM");
      const exitCode = await Promise.race([
        child.exited,
        Bun.sleep(1_500).then(() => null),
      ]);
      expect(exitCode).not.toBeNull();
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await child.exited;
      }
      await workspace.cleanup();
      await home.cleanup();
    }
  }, 5_000);

  it("forwards SIGTERM through the published CLI wrapper", async () => {
    const temp = await createTempWorkspace("goodmemory-mcp-wrapper-shutdown");
    const fakeBun = join(temp.root, "fake-bun.cjs");
    const pidPath = join(temp.root, "fake-bun.pid");
    const signalPath = join(temp.root, "fake-bun.signal");
    const wrapper = join(import.meta.dir, "../../scripts/goodmemory-mcp.js");
    let fakeBunPid: number | null = null;

    await writeFile(
      fakeBun,
      [
        "#!/usr/bin/env node",
        'const { writeFileSync } = require("node:fs");',
        'process.once("SIGTERM", () => {',
        '  writeFileSync(process.env.GOODMEMORY_FAKE_BUN_SIGNAL, "SIGTERM");',
        "  process.exit(0);",
        "});",
        'writeFileSync(process.env.GOODMEMORY_FAKE_BUN_PID, String(process.pid));',
        "setInterval(() => {}, 1_000);",
        "",
      ].join("\n"),
    );
    await chmod(fakeBun, 0o755);

    const child = Bun.spawn(["node", wrapper], {
      env: createChildEnv({
        GOODMEMORY_BUN_BINARY: fakeBun,
        GOODMEMORY_FAKE_BUN_PID: pidPath,
        GOODMEMORY_FAKE_BUN_SIGNAL: signalPath,
      }),
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    });

    try {
      const ready = await waitForPath(pidPath, 1_000);
      if (!ready) {
        child.kill("SIGKILL");
        await child.exited;
        throw new Error(await new Response(child.stderr).text());
      }
      expect(ready).toBe(true);
      fakeBunPid = Number(await readFile(pidPath, "utf8"));

      child.kill("SIGTERM");
      const exitCode = await Promise.race([
        child.exited,
        Bun.sleep(1_500).then(() => null),
      ]);
      expect(exitCode).not.toBeNull();

      expect(await waitForPath(signalPath, 1_000)).toBe(true);
      expect(await readFile(signalPath, "utf8")).toBe("SIGTERM");
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await child.exited;
      }
      if (fakeBunPid !== null) {
        try {
          process.kill(fakeBunPid, "SIGKILL");
        } catch {
          // The wrapper forwarded SIGTERM and the fake child already exited.
        }
      }
      await temp.cleanup();
    }
  }, 5_000);

  it("fails fast on a bare invocation, naming both modes on stderr", async () => {
    const mcpScript = join(import.meta.dir, "../../scripts/goodmemory-mcp.ts");
    const child = Bun.spawn(["bun", mcpScript], {
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    });
    const exitCode = await child.exited;
    const stderr = await new Response(child.stderr).text();
    const stdout = await new Response(child.stdout).text();

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--host");
    expect(stderr).toContain("--standalone");
    // stdout must stay clean: it is the MCP stdio transport channel.
    expect(stdout).toBe("");
  });
});

async function waitForPath(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await stat(path);
      return true;
    } catch {
      await Bun.sleep(25);
    }
  }
  return false;
}
