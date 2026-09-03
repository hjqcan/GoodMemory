import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BuildContextInput,
  ExportMemoryInput,
  ExportMemoryResult,
  GoodMemory,
  RecallInput,
  RecallResult,
} from "../../src/api/contracts";
import type { GoodMemoryMcpServerDependencies } from "../../src/install/hostMcpServer";
import { createGoodMemoryMcpServer } from "../../src/install/hostMcpServer";
import { readInstalledHostWritebackLedger } from "../../src/install/hostWritebackAuditLedger";
import { buildPageArtifacts } from "../../src/governance/pageArtifacts";

interface RegisteredMcpTool {
  description?: string;
  handler: (args: Record<string, unknown>) => Promise<McpToolResult>;
  inputSchema?: Record<string, unknown>;
}

interface InspectableMcpServer {
  _registeredTools: Record<string, RegisteredMcpTool>;
  server: {
    _serverInfo: {
      name: string;
      version: string;
    };
  };
}

interface McpToolResult {
  content: Array<{ text: string; type: "text" }>;
  isError?: true;
  structuredContent?: Record<string, unknown>;
}

const WORKSPACE_ROOT = "/tmp/goodmemory-mcp-direct-workspace";
const PACKAGE_JSON_URL = new URL("../../package.json", import.meta.url);

function inspectServer(server: object): InspectableMcpServer {
  return server as unknown as InspectableMcpServer;
}

function readPackageVersion(): string {
  const parsed = JSON.parse(readFileSync(PACKAGE_JSON_URL, "utf8")) as {
    version?: unknown;
  };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error("package.json must define a non-empty version.");
  }
  return parsed.version;
}

function missingFile(path: string): Error & { code: "ENOENT" } {
  return Object.assign(new Error(`missing ${path}`), { code: "ENOENT" as const });
}

function createRuntimeConfig(): string {
  return JSON.stringify({
    activationMode: "global",
    host: "codex",
    maxTokens: 64,
    retrievalProfile: "coding_agent",
    storage: {
      provider: "memory",
      url: "memory://mcp-direct",
    },
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

function createWorkspaceConfig(): string {
  return JSON.stringify({
    enabled: true,
    host: "codex",
    workspaceId: "mcp-workspace",
  });
}

function createFakeMemory(): GoodMemory {
  const scope = {
    agentId: "codex",
    sessionId: "session-1",
    userId: "mcp-user",
    workspaceId: "mcp-workspace",
  };
  const recall = {
    metadata: {
      candidateTraces: [
        {
          candidateId: "fact-1",
          reasons: ["keyword_overlap"],
          score: 1,
          selected: true,
        },
      ],
      hits: [],
      policyApplied: ["allow"],
      routingDecision: {
        profile: "coding_agent",
        strategy: "rules-only",
      },
      verificationHints: [],
    },
    memories: [],
  } as unknown as RecallResult;
  const exported: ExportMemoryResult = {
    pages: buildPageArtifacts({ notes: [] }),
    artifacts: {
      files: [
        {
          content: "# Memory\n\n- Release runbook is current.",
          kind: "memory",
          relativePath: "MEMORY.md",
        },
      ],
      rootPath: WORKSPACE_ROOT,
    },
    durable: {
      archives: [],
      episodes: [],
      evidence: [],
      experiences: [],
      facts: [],
      feedback: [],
      preferences: [],
      profile: null,
      promotions: [],
      proposals: [],
      references: [],
    },
    exportedAt: "2026-04-27T00:00:00.000Z",
    runtime: {
      journal: null,
      spills: [],
      workingMemory: null,
    },
    scope,
  };

  return {
    buildContext: async (input: BuildContextInput) => ({
      content: "Developer memory notes:\n- Release runbook is current.",
      estimatedTokens: 9,
      omittedSections: [],
      output: input.output ?? "developer_prompt_fragment",
    }),
    exportMemory: async (input: ExportMemoryInput) => ({
      ...exported,
      runtime: input.includeRuntime === true ? exported.runtime : undefined,
      scope: input.scope,
    }),
    recall: async (input: RecallInput) => ({
      ...recall,
      metadata: {
        ...recall.metadata,
        routingDecision: {
          profile: input.retrievalProfile ?? "coding_agent",
          strategy: input.strategy ?? "rules-only",
        },
      },
    }),
  } as unknown as GoodMemory;
}

function createDependencies(memory = createFakeMemory()): GoodMemoryMcpServerDependencies {
  return {
    createMemory: () => memory,
    readFile: async (path) => {
      if (path === `${WORKSPACE_ROOT}/.goodmemory/codex.json`) {
        return createWorkspaceConfig();
      }
      if (path.endsWith("/.goodmemory/codex.json")) {
        return createRuntimeConfig();
      }
      throw missingFile(path);
    },
  };
}

describe("goodmemory mcp server direct handlers", () => {
  it("registers the stable read-only tool surface in-process", () => {
    const server = inspectServer(
      createGoodMemoryMcpServer({
        dependencies: createDependencies(),
        host: "codex",
      }),
    );

    expect(server.server._serverInfo.name).toBe("goodmemory-mcp");
    expect(server.server._serverInfo.version).toBe(readPackageVersion());
    expect(Object.keys(server._registeredTools).sort()).toEqual([
      "goodmemory_get_context",
      "goodmemory_get_records",
      "goodmemory_inspect_memory",
      "goodmemory_read_artifacts",
      "goodmemory_search_index",
      "goodmemory_stats",
      "goodmemory_timeline",
      "goodmemory_trace_recall",
    ]);
    expect(server._registeredTools.goodmemory_get_records?.description).toContain(
      "progressive GoodMemory recall",
    );
  });

  it("layers the tool surface so get_context and remember read as the primary two", () => {
    const server = inspectServer(
      createGoodMemoryMcpServer({
        allowWrite: true,
        dependencies: createDependencies(),
        host: "codex",
      }),
    );
    const description = (name: string): string =>
      server._registeredTools[name]?.description ?? "";

    // The two primary tools carry no advanced/diagnostic lead.
    expect(description("goodmemory_get_context")).not.toMatch(/^(Advanced|Diagnostic)/);
    expect(description("goodmemory_remember")).not.toMatch(/^(Advanced|Diagnostic)/);

    // Every other tool is marked as advanced/diagnostic so an agent sees the
    // main two first and reaches past them only when needed.
    for (const name of [
      "goodmemory_get_records",
      "goodmemory_inspect_memory",
      "goodmemory_read_artifacts",
      "goodmemory_search_index",
      "goodmemory_stats",
      "goodmemory_timeline",
      "goodmemory_trace_recall",
    ]) {
      expect(description(name)).toMatch(/^(Advanced|Diagnostic)/);
    }
  });

  it("serves non-mutating context, trace, artifact, and stats results from installed host memory", async () => {
    const server = inspectServer(
      createGoodMemoryMcpServer({
        dependencies: createDependencies(),
        host: "codex",
      }),
    );

    const context = await server._registeredTools.goodmemory_get_context!.handler({
      cwd: WORKSPACE_ROOT,
      query: "release runbook",
    });
    expect(context.structuredContent?.content).toContain("Release runbook");
    expect(context.structuredContent?.maxTokens).toBe(64);

    const trace = await server._registeredTools.goodmemory_trace_recall!.handler({
      cwd: WORKSPACE_ROOT,
      query: "release runbook",
      strategy: "rules-only",
    });
    expect(trace.structuredContent?.candidateTraceCount).toBe(1);
    expect(trace.structuredContent?.policyApplied).toEqual(["allow"]);

    const inspected = await server._registeredTools.goodmemory_inspect_memory!.handler({
      cwd: WORKSPACE_ROOT,
      includeRuntime: true,
    });
    expect(inspected.structuredContent?.runtime).toEqual({
      journal: null,
      spills: [],
      workingMemory: null,
    });

    const artifacts = await server._registeredTools.goodmemory_read_artifacts!.handler({
      cwd: WORKSPACE_ROOT,
    });
    expect(artifacts.structuredContent?.rootPath).toBe(WORKSPACE_ROOT);
    expect(JSON.stringify(artifacts.structuredContent?.artifacts)).toContain(
      "MEMORY.md",
    );

    const stats = await server._registeredTools.goodmemory_stats!.handler({
      cwd: WORKSPACE_ROOT,
      includeRuntime: true,
    });
    expect(stats.structuredContent?.counts).toMatchObject({
      facts: 0,
      profile: 0,
    });
    expect(stats.structuredContent?.runtime).toEqual({
      journal: 0,
      spills: 0,
      workingMemory: 0,
    });
  });

  it("surfaces recall routing degradation warnings to the agent via get_context", async () => {
    const memory = createFakeMemory();
    (memory as { recall: unknown }).recall = async () =>
      ({
        memories: [],
        metadata: {
          candidateTraces: [],
          hits: [],
          policyApplied: ["allow"],
          routingDecision: {
            intent: "general_assistance",
            profile: "coding_agent",
            strategy: "rules-only",
            strategyExplanation: {
              fallbackReason: "semantic_search_unavailable",
              hardFloor: "lexical_runtime_procedural_priors",
              llmRefinement: false,
              requestedStrategy: "hybrid",
              resolvedStrategy: "rules-only",
              semanticTieBreaking: false,
              summary: "hybrid requested but semantic search is unavailable",
              warnings: ["semantic_recall_inactive"],
            },
          },
          verificationHints: [],
        },
      }) as unknown as RecallResult;

    const server = inspectServer(
      createGoodMemoryMcpServer({
        dependencies: createDependencies(memory),
        host: "codex",
      }),
    );

    const result = await server._registeredTools.goodmemory_get_context!.handler({
      cwd: WORKSPACE_ROOT,
      query: "where does the user work?",
    });

    expect(result.structuredContent?.routing).toMatchObject({
      resolvedStrategy: "rules-only",
      warningMessages: [
        "semantic recall inactive — set strategy:hybrid + RETRIEVAL_PRESET",
      ],
      warnings: ["semantic_recall_inactive"],
    });
  });

  it("returns structured errors instead of throwing when installed context is unavailable", async () => {
    const server = inspectServer(
      createGoodMemoryMcpServer({
        dependencies: {
          readFile: async (path) => {
            throw missingFile(path);
          },
        },
        host: "codex",
      }),
    );

    const result = await server._registeredTools.goodmemory_search_index!.handler({
      cwd: WORKSPACE_ROOT,
      query: "release runbook",
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error).toBe(
      "GoodMemory codex context is unavailable: missing_global_config.",
    );
  });

  it("records accepted installed-mode writes in the writeback audit ledger", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "goodmemory-mcp-remember-audit-"));
    try {
      const memory = createFakeMemory();
      (memory as { remember?: unknown }).remember = async () => ({
        accepted: 1,
        events: [
          {
            candidateId: "candidate-1",
            evidenceIds: ["ev-1"],
            memoryId: "mem-1",
            memoryType: "fact",
            outcome: "written",
          },
        ],
        rejected: 0,
      });
      const server = inspectServer(
        createGoodMemoryMcpServer({
          allowWrite: true,
          dependencies: { ...createDependencies(memory), homeRoot },
          host: "codex",
        }),
      );

      const result = await server._registeredTools.goodmemory_remember!.handler({
        content: "The staging endpoint is db.internal.example.com.",
        cwd: WORKSPACE_ROOT,
        sessionId: "sess-1",
      });

      expect(result.isError).toBeUndefined();
      const auditEventId = result.structuredContent?.auditEventId;
      expect(typeof auditEventId).toBe("string");

      const ledger = await readInstalledHostWritebackLedger("codex", homeRoot);
      expect(ledger.auditEvents).toEqual([
        expect.objectContaining({
          command: "remember-tool",
          eventId: auditEventId,
          kind: "fact",
          memoryIds: ["mem-1"],
          status: "committed",
        }),
      ]);
      expect(ledger.auditEvents[0]?.sessionDigest).toMatch(/^session:/);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("echoes resolvedExtractionStrategy and degradation warnings from remember", async () => {
    const memory = createFakeMemory();
    (memory as { remember?: unknown }).remember = async () => ({
      accepted: 0,
      events: [],
      metadata: {
        adapterId: "en",
        analysisMode: "rules-only",
        locale: "en-US",
        localeSource: "detected",
        requestedExtractionStrategy: "auto",
        resolvedExtractionStrategy: "rules-only",
      },
      rejected: 0,
      warnings: ["no_durable_facts_extracted"],
    });
    const server = inspectServer(
      createGoodMemoryMcpServer({
        allowWrite: true,
        dependencies: createDependencies(memory),
        host: "codex",
      }),
    );

    const result = await server._registeredTools.goodmemory_remember!.handler({
      content: "just some passing chatter",
      cwd: WORKSPACE_ROOT,
    });

    expect(result.structuredContent?.warnings).toEqual([
      "no_durable_facts_extracted",
    ]);
    expect(result.structuredContent?.resolvedExtractionStrategy).toBe("rules-only");
  });
});
