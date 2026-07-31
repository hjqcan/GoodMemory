import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createFactMemory,
  createFeedbackMemory,
  createGoodMemory,
  createReferenceMemory,
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
  createUserProfile,
} from "../../src";
import { createHostAdapter } from "../../src/host";
import { createMemorySource } from "../../src/domain/provenance";
import {
  readInstalledHostProgressiveRecordCache,
} from "../../src/install/hostProgressiveRecall";
import type { ProgressiveRecordDetail } from "../../src/progressive/recall";
import { buildProgressiveScopeDigest } from "../../src/progressive/recall";
import { createInMemoryVectorStore } from "../../src/storage/memory";
import { createMemoryRepositories } from "../../src/storage/repositories";
import { createTempWorkspace } from "../../src/testing/utils";

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

async function seedSQLiteMemory(sqlitePath: string) {
  await mkdir(dirname(sqlitePath), { recursive: true });
  const documentStore = createSQLiteDocumentStore(sqlitePath);
  const sessionStore = createSQLiteSessionStore(sqlitePath);
  const vectorStore = createInMemoryVectorStore();
  const memory = createGoodMemory({
    adapters: {
      documentStore,
      sessionStore,
      vectorStore,
    },
    storage: {
      provider: "sqlite",
      url: sqlitePath,
    },
  });
  const repositories = createMemoryRepositories({
    documentStore,
    sessionStore,
    vectorStore,
  });
  const scope = {
    agentId: "codex",
    sessionId: "session-1",
    userId: "cli-user",
    workspaceId: "workspace-a",
  };
  const timestamp = "2026-01-01T00:00:00.000Z";
  const source = createMemorySource({
    extractedAt: timestamp,
    method: "explicit",
    sessionId: scope.sessionId,
  });

  await repositories.profiles.upsert(
    createUserProfile({
      activeContext: {
        currentProjects: ["release quality program"],
        goals: [],
      },
      createdAt: timestamp,
      identity: {
        location: "Austin, USA",
        name: "Felix",
        role: "climate policy advisor",
      },
      updatedAt: timestamp,
      userId: scope.userId,
    }),
  );
  await repositories.facts.add(
    createFactMemory({
      category: "project",
      content:
        "The current blocker is vendor approval for release quality program.",
      agentId: scope.agentId,
      createdAt: timestamp,
      id: "fact-blocker",
      sessionId: scope.sessionId,
      source,
      updatedAt: timestamp,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    }),
  );
  await repositories.references.add(
    createReferenceMemory({
      createdAt: timestamp,
      id: "ref-runbook",
      agentId: scope.agentId,
      pointer: "docs/release-quality-runbook.md",
      sessionId: scope.sessionId,
      source,
      title: "release-quality-runbook.md",
      updatedAt: timestamp,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    }),
  );
  await repositories.feedback.upsert(
    createFeedbackMemory({
      id: "feedback-style",
      agentId: scope.agentId,
      kind: "do",
      rule: "Use concise bullet points in summaries.",
      sessionId: scope.sessionId,
      source,
      updatedAt: timestamp,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    }),
  );

  return {
    memory,
    scope,
  };
}

describe("goodmemory mcp server", () => {
  it("exposes the documented read-only tools and matches public API output", async () => {
    const home = await createTempWorkspace("goodmemory-mcp-home");
    const workspace = await createTempWorkspace("goodmemory-mcp-workspace");
    const sqlitePath = join(home.root, ".goodmemory", "memory.sqlite");
    const mcpScript = join(import.meta.dir, "../../scripts/goodmemory-mcp.ts");
    let transport: StdioClientTransport | null = null;

    try {
      await mkdir(join(home.root, ".goodmemory"), { recursive: true });
      await mkdir(join(workspace.root, ".goodmemory"), { recursive: true });
      await writeFile(
        join(home.root, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            debug: false,
            host: "codex",
            maxTokens: 96,
            retrievalProfile: "coding_agent",
            storage: {
              path: sqlitePath,
              provider: "sqlite",
            },
            userId: "cli-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(workspace.root, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            enabled: true,
            host: "codex",
            version: 1,
            workspaceId: "workspace-a",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      const progressiveSecretPath = join(
        home.root,
        ".goodmemory",
        "codex-progressive-scope-secret",
      );
      await writeFile(
        progressiveSecretPath,
        "gmpr_existing-secret-for-permission-regression-1234567890\n",
        "utf8",
      );
      await chmod(progressiveSecretPath, 0o644);

      const seeded = await seedSQLiteMemory(sqlitePath);
      const installedScope = seeded.scope;

      transport = new StdioClientTransport({
        args: [mcpScript, "--host", "codex"],
        command: "bun",
        cwd: workspace.root,
        env: createChildEnv({
          GOODMEMORY_HOME: home.root,
        }),
        stderr: "pipe",
      });

      const client = new Client(
        {
          name: "goodmemory-mcp-test-client",
          version: "0.0.0",
        },
        {
          capabilities: {},
          versionNegotiation: {
            mode: "legacy",
          },
        },
      );
      await client.connect(transport);
      expect(client.getProtocolEra()).toBe("legacy");
      expect(client.getNegotiatedProtocolVersion()).toBe("2025-11-25");
      const packageJson = JSON.parse(
        await readFile(join(import.meta.dir, "../../package.json"), "utf8"),
      ) as { version?: string };
      if (
        typeof packageJson.version !== "string" ||
        packageJson.version.length === 0
      ) {
        throw new Error("package.json must define a non-empty version.");
      }

      expect(client.getServerVersion()).toEqual({
        name: "goodmemory-mcp",
        version: packageJson.version,
      });

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
        maxTokens: 96,
        omittedSections: [],
        output: "developer_prompt_fragment",
        query: "Check the release runbook before editing files.",
        retrievalProfile: "coding_agent",
        scope: installedScope,
      });
      const structuredContext = contextResult.structuredContent as {
        content?: unknown;
      };
      expect(String(structuredContext.content)).toContain(
        "vendor approval for release quality program",
      );
      expect(String(structuredContext.content)).toContain(
        "docs/release-quality-runbook.md",
      );
      expect(contextResult.structuredContent).toHaveProperty("estimatedTokens");

      const inspectResult = await client.callTool({
        arguments: {
          cwd: workspace.root,
          sessionId: "session-1",
        },
        name: "goodmemory_inspect_memory",
      });
      expect(inspectResult.structuredContent).toMatchObject({
        durable: {
          facts: [expect.objectContaining({ id: "fact-blocker" })],
          feedback: [expect.objectContaining({ id: "feedback-style" })],
          references: [expect.objectContaining({ id: "ref-runbook" })],
        },
        scope: installedScope,
      });

      const traceResult = await client.callTool({
        arguments: {
          cwd: workspace.root,
          query: "Check the release runbook before editing files.",
          sessionId: "session-1",
        },
        name: "goodmemory_trace_recall",
      });
      expect(traceResult.structuredContent).toMatchObject({
        query: "Check the release runbook before editing files.",
        scope: installedScope,
      });

      const searchIndexResult = await client.callTool({
        arguments: {
          cwd: workspace.root,
          includeRuntime: true,
          limit: 6,
          query: "release quality vendor approval runbook",
          sessionId: "session-1",
        },
        name: "goodmemory_search_index",
      });
      expect(JSON.stringify(searchIndexResult.structuredContent)).not.toContain(
        installedScope.userId,
      );
      expect(JSON.stringify(searchIndexResult.structuredContent)).not.toContain(
        installedScope.workspaceId,
      );
      const searchIndex = searchIndexResult.structuredContent as {
        query: string;
        records: Array<{ recordKind: string; recordRef: string; summary: string }>;
        scopeDigest: string;
        totalRecordCount: number;
      };
      expect(searchIndex.query).toBe("release quality vendor approval runbook");
      expect(searchIndex.scopeDigest).toMatch(/^scope_[a-f0-9]{32}$/u);
      const localProgressiveSecret = (
        await readFile(progressiveSecretPath, "utf8")
      ).trim();
      expect(localProgressiveSecret).toMatch(/^gmpr_[A-Za-z0-9_-]{32,}$/u);
      expect((await stat(progressiveSecretPath)).mode & 0o777).toBe(0o600);
      const predictableSecret = createHash("sha256")
        .update("goodmemory-progressive-recall-v1")
        .update("\n")
        .update("codex")
        .update("\n")
        .update("sqlite")
        .update("\n")
        .update(sqlitePath)
        .digest("hex");
      expect(searchIndex.scopeDigest).not.toBe(
        buildProgressiveScopeDigest({
          scope: installedScope,
          secret: predictableSecret,
        }),
      );
      const searchRecords = searchIndex.records;
      expect(searchRecords.map((record) => record.recordKind)).toContain("fact");
      expect(searchRecords.map((record) => record.recordKind)).toContain("reference");
      const factRecordRef = searchRecords.find(
        (record) => record.recordKind === "fact",
      )?.recordRef;
      if (!factRecordRef) {
        throw new Error("Expected progressive search index to include a fact recordRef.");
      }
      await expect(
        readInstalledHostProgressiveRecordCache({
          homeRoot: home.root,
          host: "codex",
          recordRefs: [factRecordRef],
          scopeDigest: searchIndex.scopeDigest,
        }),
      ).resolves.toHaveLength(1);

      const progressiveRecordsResult = await client.callTool({
        arguments: {
          cwd: workspace.root,
          recordRefs: [factRecordRef],
          sessionId: "session-1",
        },
        name: "goodmemory_get_records",
      });
      const progressiveRecords = progressiveRecordsResult.structuredContent as {
        records: ProgressiveRecordDetail[];
        scopeDigest: string;
      };
      expect(progressiveRecords.scopeDigest).toBe(searchIndex.scopeDigest);
      expect(progressiveRecords.records).toMatchObject([
        {
          recordKind: "fact",
          recordRef: factRecordRef,
        },
      ]);
      expect(JSON.stringify(progressiveRecordsResult.structuredContent)).toContain(
        "vendor approval",
      );

      const timelineResult = await client.callTool({
        arguments: {
          cwd: workspace.root,
          includeRuntime: true,
          query: "release quality vendor approval runbook",
          recordsPerBucket: 3,
          sessionId: "session-1",
        },
        name: "goodmemory_timeline",
      });
      const timeline = timelineResult.structuredContent as {
        buckets: Array<{ records: Array<{ recordRef: string }> }>;
        scopeDigest: string;
        totalRecordCount: number;
      };
      expect(timeline.scopeDigest).toBe(searchIndex.scopeDigest);
      expect(timeline.totalRecordCount).toBeGreaterThan(0);
      expect(
        timeline.buckets.some((bucket) => bucket.records.length > 0),
      ).toBe(true);

      const artifactsResult = await client.callTool({
        arguments: {
          cwd: workspace.root,
          sessionId: "session-1",
        },
        name: "goodmemory_read_artifacts",
      });
      const directArtifacts = await createHostAdapter({
        hostKind: "codex",
        id: "goodmemory-mcp-test",
        memory: seeded.memory,
      }).readArtifacts({
        scope: installedScope,
      });
      expect(artifactsResult.structuredContent).toMatchObject({
        artifacts: directArtifacts.artifacts,
        rootPath: directArtifacts.rootPath,
        scope: directArtifacts.scope,
      });
      expect(artifactsResult.structuredContent).toHaveProperty("exportedAt");

      const statsResult = await client.callTool({
        arguments: {
          cwd: workspace.root,
          sessionId: "session-1",
        },
        name: "goodmemory_stats",
      });
      expect(statsResult.structuredContent).toMatchObject({
        runtime: null,
        scope: installedScope,
      });
      expect(statsResult.structuredContent).toHaveProperty("counts.facts", 1);
      expect(statsResult.structuredContent).toHaveProperty("counts.feedback", 1);
      expect(statsResult.structuredContent).toHaveProperty("counts.references", 1);

      const cachedDetail = progressiveRecords;
      await expect(
        readInstalledHostProgressiveRecordCache({
          homeRoot: home.root,
          host: "codex",
          recordRefs: [factRecordRef],
          scopeDigest: cachedDetail.scopeDigest,
        }),
      ).resolves.toHaveLength(1);
      await transport.close();
      transport = null;

      transport = new StdioClientTransport({
        args: [mcpScript, "--host", "codex"],
        command: "bun",
        cwd: workspace.root,
        env: createChildEnv({
          GOODMEMORY_HOME: home.root,
        }),
        stderr: "pipe",
      });
      const freshClient = new Client(
        {
          name: "goodmemory-mcp-cache-test-client",
          version: "0.0.0",
        },
        {
          capabilities: {},
        },
      );
      await freshClient.connect(transport);
      const crossScopeCachedRecordsResult = await freshClient.callTool({
        arguments: {
          cwd: workspace.root,
          recordRefs: [factRecordRef],
          sessionId: "session-2",
        },
        name: "goodmemory_get_records",
      });
      expect(crossScopeCachedRecordsResult.isError).toBe(true);
      expect(crossScopeCachedRecordsResult.structuredContent).toMatchObject({
        error: expect.stringContaining("does not belong to the requested scope"),
      });

      const cachedRecordsResult = await freshClient.callTool({
        arguments: {
          cwd: workspace.root,
          recordRefs: [factRecordRef],
          sessionId: "session-1",
        },
        name: "goodmemory_get_records",
      });
      expect(cachedRecordsResult.structuredContent).toMatchObject({
        records: [
          {
            recordKind: "fact",
            recordRef: factRecordRef,
          },
        ],
        scopeDigest: cachedDetail.scopeDigest,
      });
    } finally {
      if (transport) {
        await transport.close();
      }
      await workspace.cleanup();
      await home.cleanup();
    }
  });
});
