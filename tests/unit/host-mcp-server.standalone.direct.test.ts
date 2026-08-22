import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createGoodMemory } from "../../src/api/createGoodMemory";
import type {
  BuildContextInput,
  ExportMemoryInput,
  GoodMemory,
  RecallInput,
  RememberInput,
} from "../../src/api/contracts";
import { createFactMemory } from "../../src/domain/records";
import type { GoodMemoryMcpServerDependencies } from "../../src/install/hostMcpServer";
import { createGoodMemoryMcpServer } from "../../src/install/hostMcpServer";
import type { StandaloneMcpConfig } from "../../src/install/standaloneMcpContext";

// Standalone mode serves the same read-only tool surface as installed mode
// without reading any host config file: the context is synthesized from the
// standalone config plus per-call arguments.

interface RegisteredMcpTool {
  annotations?: Record<string, unknown>;
  description?: string;
  handler: (args: Record<string, unknown>) => Promise<McpToolResult>;
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

const READ_ONLY_TOOLS = [
  "goodmemory_get_context",
  "goodmemory_get_records",
  "goodmemory_inspect_memory",
  "goodmemory_read_artifacts",
  "goodmemory_search_index",
  "goodmemory_stats",
  "goodmemory_timeline",
  "goodmemory_trace_recall",
];

function inspectServer(server: object): InspectableMcpServer {
  return server as unknown as InspectableMcpServer;
}

interface FakeMemoryCalls {
  buildContext: BuildContextInput[];
  exportMemory: ExportMemoryInput[];
  recall: RecallInput[];
  remember: RememberInput[];
}

function createFakeMemory(): { calls: FakeMemoryCalls; memory: GoodMemory } {
  const calls: FakeMemoryCalls = {
    buildContext: [],
    exportMemory: [],
    recall: [],
    remember: [],
  };
  const memory = {
    remember: async (input: RememberInput) => {
      calls.remember.push(input);
      return {
        accepted: 1,
        events: [
          {
            candidateId: "candidate-1",
            memoryId: "fact-new",
            memoryType: "fact",
            outcome: "written",
          },
        ],
        rejected: 0,
      };
    },
    buildContext: async (input: BuildContextInput) => {
      calls.buildContext.push(input);
      return {
        content: "standalone context",
        estimatedTokens: 3,
        omittedSections: [],
        output: input.output,
      };
    },
    exportMemory: async (input: ExportMemoryInput) => {
      calls.exportMemory.push(input);
      return {
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
        runtime: null,
        scope: input.scope,
      };
    },
    recall: async (input: RecallInput) => {
      calls.recall.push(input);
      return {
        archives: [],
        episodes: [],
        evidence: [],
        facts: [],
        feedback: [],
        journal: null,
        metadata: {
          candidateTraces: [],
          hits: [],
          latencyMs: 0,
          policyApplied: [],
          routingDecision: {},
          tokenCount: 0,
          verificationHints: [],
        },
        packet: {},
        preferences: [],
        profile: null,
        references: [],
        workingMemory: null,
      };
    },
  } as unknown as GoodMemory;

  return { calls, memory };
}

// readFile that always fails: standalone mode must never depend on installed
// host config files.
function createConfiglessDependencies(
  memory: GoodMemory,
): GoodMemoryMcpServerDependencies {
  return {
    createMemory: () => memory,
    readFile: async (path: string) => {
      throw Object.assign(new Error(`unexpected config read: ${path}`), {
        code: "ENOENT" as const,
      });
    },
  };
}

const STANDALONE_CONFIG: StandaloneMcpConfig = {
  storage: { provider: "memory" },
  userId: "standalone-user",
};

describe("goodmemory mcp server standalone direct handlers", () => {
  it("registers the same read-only tool surface without any host config", () => {
    const { memory } = createFakeMemory();
    const server = inspectServer(
      createGoodMemoryMcpServer({
        dependencies: createConfiglessDependencies(memory),
        standalone: STANDALONE_CONFIG,
      }),
    );

    expect(server.server._serverInfo.name).toBe("goodmemory-mcp");
    expect(Object.keys(server._registeredTools).sort()).toEqual(READ_ONLY_TOOLS);
  });

  it("describes read tools as when-to-call directives", async () => {
    const { memory } = createFakeMemory();
    const server = inspectServer(
      createGoodMemoryMcpServer({
        dependencies: createConfiglessDependencies(memory),
        standalone: STANDALONE_CONFIG,
      }),
    );
    const description = (name: string): string =>
      server._registeredTools[name]?.description ?? "";

    // Directive phrasing shapes whether agents actually reach for memory.
    expect(description("goodmemory_get_context")).toContain(
      "Call it when hook-injected context is missing or insufficient",
    );
    expect(description("goodmemory_trace_recall")).toContain(
      "did not surface",
    );
    expect(description("goodmemory_search_index")).toContain(
      "specific records rather than a rendered summary",
    );
    expect(description("goodmemory_stats")).toContain(
      "before assuming an empty store",
    );
    // The progressive pairing stays discoverable from get_records itself.
    expect(description("goodmemory_get_records")).toContain(
      "progressive GoodMemory recall",
    );
  });

  it("serves get_context from the synthesized standalone scope", async () => {
    const { calls, memory } = createFakeMemory();
    const server = inspectServer(
      createGoodMemoryMcpServer({
        dependencies: createConfiglessDependencies(memory),
        standalone: STANDALONE_CONFIG,
      }),
    );

    const result = await server._registeredTools.goodmemory_get_context!.handler({
      cwd: "/tmp/standalone-project",
      query: "release runbook",
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.content).toBe("standalone context");
    // Default maxTokens (256) flows through to buildContext.
    expect(result.structuredContent?.maxTokens).toBe(256);
    expect(calls.buildContext[0]?.maxTokens).toBe(256);
    // The standalone scope omits agentId by default (agent-less records
    // only; --agent-id opts into a specific host's agent-tagged memory).
    expect(calls.recall[0]?.scope).toEqual({
      agentId: undefined,
      sessionId: undefined,
      tenantId: undefined,
      userId: "standalone-user",
      workspaceId: basename(resolve("/tmp/standalone-project")),
    });
  });

  it("forwards temporal context through every recall tool and remember", async () => {
    const { calls, memory } = createFakeMemory();
    const server = inspectServer(
      createGoodMemoryMcpServer({
        allowWrite: true,
        dependencies: createConfiglessDependencies(memory),
        standalone: STANDALONE_CONFIG,
      }),
    );
    const temporal = {
      referenceTime: "2026-11-01T05:30:00.000Z",
      timezone: "America/New_York",
    };

    await server._registeredTools.goodmemory_get_context!.handler({
      query: "What happened yesterday?",
      ...temporal,
    });
    await server._registeredTools.goodmemory_trace_recall!.handler({
      query: "What happened yesterday?",
      ...temporal,
    });
    await server._registeredTools.goodmemory_search_index!.handler({
      query: "What happened yesterday?",
      ...temporal,
    });
    await server._registeredTools.goodmemory_timeline!.handler({
      query: "What happened yesterday?",
      ...temporal,
    });
    await server._registeredTools.goodmemory_remember!.handler({
      content: "The release review is tomorrow.",
      observedAt: "2026-11-01T05:29:00.000Z",
      timezone: "America/New_York",
    });
    await server._registeredTools.goodmemory_remember!.handler({
      content: "Core validates these temporal values.",
      observedAt: "",
      timezone: "",
    });

    expect(calls.recall).toHaveLength(4);
    for (const input of calls.recall) {
      expect(input).toMatchObject(temporal);
    }
    expect(calls.remember[0]).toMatchObject({
      timezone: "America/New_York",
      messages: [
        {
          content: "The release review is tomorrow.",
          observedAt: "2026-11-01T05:29:00.000Z",
          role: "assistant",
          timezone: "America/New_York",
        },
      ],
    });
    expect(calls.remember[1]).toMatchObject({
      timezone: "",
      messages: [{ observedAt: "", timezone: "" }],
    });
  });

  it("preserves retrieval trace and resolved during constraints", async () => {
    const { memory } = createFakeMemory();
    const recall = memory.recall.bind(memory);
    memory.recall = async (input) => {
      const result = await recall(input);
      return {
        ...result,
        metadata: {
          ...result.metadata,
          retrievalTrace: {
            plan: {
              entities: [],
              evidenceNeeds: ["direct", "temporal"],
              facets: [],
              maxHops: 1,
              maxRenderedTokens: 6_000,
              planes: ["semantic", "episodic"],
              preRankLimit: 32,
              selectedLimit: 12,
              temporalConstraints: [{
                interval: {
                  endExclusive: "2026-08-11T16:00:00.000Z",
                  precision: "day",
                  start: "2026-08-10T16:00:00.000Z",
                  timezone: "Asia/Shanghai",
                },
                kind: "during",
              }],
              uncertainty: "medium",
            },
            queryExecutions: [],
            schemaVersion: 2,
            stopReason: "single_pass_complete",
            subQueries: [],
          },
        },
      };
    };
    const server = inspectServer(
      createGoodMemoryMcpServer({
        dependencies: createConfiglessDependencies(memory),
        standalone: STANDALONE_CONFIG,
      }),
    );

    const result = await server._registeredTools.goodmemory_trace_recall!.handler({
      query: "What did I eat yesterday?",
      referenceTime: "2026-08-12T03:00:00.000Z",
      timezone: "Asia/Shanghai",
    });

    expect(result.structuredContent?.retrievalTrace).toMatchObject({
      plan: {
        temporalConstraints: [{
          interval: {
            endExclusive: "2026-08-11T16:00:00.000Z",
            precision: "day",
            start: "2026-08-10T16:00:00.000Z",
            timezone: "Asia/Shanghai",
          },
          kind: "during",
        }],
      },
      schemaVersion: 2,
    });
  });

  it("returns occurrence-local event dates from the standalone timeline", async () => {
    const { memory } = createFakeMemory();
    const recall = memory.recall.bind(memory);
    const temporalMemory = {
      ...memory,
      async recall(input: RecallInput) {
        return {
          ...await recall(input),
          facts: [createFactMemory({
            category: "event",
            content: "I ate tomato omelet.",
            id: "shanghai-event",
            occurrence: {
              start: "2026-08-10T16:00:00.000Z",
              endExclusive: "2026-08-11T16:00:00.000Z",
              precision: "day",
              timezone: "Asia/Shanghai",
            },
            source: {
              extractedAt: "2026-08-12T00:00:00.000Z",
              method: "explicit",
            },
            updatedAt: "2026-08-12T00:00:00.000Z",
            userId: "standalone-user",
          })],
        };
      },
    } as GoodMemory;
    const server = inspectServer(createGoodMemoryMcpServer({
      dependencies: createConfiglessDependencies(temporalMemory),
      standalone: STANDALONE_CONFIG,
    }));

    const result = await server._registeredTools.goodmemory_timeline!.handler({
      query: "tomato",
    });
    const buckets = result.structuredContent?.buckets as
      | Array<{ label: string }>
      | undefined;

    expect(buckets?.[0]?.label).toBe("2026-08-11");
  });

  it("derives workspaceId from the per-call cwd", async () => {
    const { calls, memory } = createFakeMemory();
    const server = inspectServer(
      createGoodMemoryMcpServer({
        dependencies: createConfiglessDependencies(memory),
        standalone: STANDALONE_CONFIG,
      }),
    );

    await server._registeredTools.goodmemory_stats!.handler({
      cwd: "/tmp/project-alpha",
    });
    await server._registeredTools.goodmemory_stats!.handler({
      cwd: "/tmp/project-beta",
    });

    expect(calls.exportMemory[0]?.scope?.workspaceId).toBe("project-alpha");
    expect(calls.exportMemory[1]?.scope?.workspaceId).toBe("project-beta");
  });

  it("registers goodmemory_remember only when allowWrite is set", async () => {
    const { memory } = createFakeMemory();

    const withWrite = inspectServer(
      createGoodMemoryMcpServer({
        allowWrite: true,
        dependencies: createConfiglessDependencies(memory),
        standalone: STANDALONE_CONFIG,
      }),
    );
    expect(Object.keys(withWrite._registeredTools).sort()).toEqual(
      [...READ_ONLY_TOOLS, "goodmemory_remember"].sort(),
    );
    const writeTool = withWrite._registeredTools.goodmemory_remember;
    expect(writeTool?.description).toContain("durable");
    expect(writeTool?.annotations?.readOnlyHint).toBe(false);

    // Explicit allowWrite: false keeps the read-only surface.
    const withoutWrite = inspectServer(
      createGoodMemoryMcpServer({
        allowWrite: false,
        dependencies: createConfiglessDependencies(memory),
        standalone: STANDALONE_CONFIG,
      }),
    );
    expect(Object.keys(withoutWrite._registeredTools).sort()).toEqual(
      READ_ONLY_TOOLS,
    );
  });

  it("writes through memory.remember with the standalone scope", async () => {
    const { calls, memory } = createFakeMemory();
    const server = inspectServer(
      createGoodMemoryMcpServer({
        allowWrite: true,
        dependencies: createConfiglessDependencies(memory),
        standalone: STANDALONE_CONFIG,
      }),
    );

    const result = await server._registeredTools.goodmemory_remember!.handler({
      content: "The deploy is blocked on smoke verification.",
      cwd: "/tmp/standalone-project",
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      accepted: 1,
      memoryIds: ["fact-new"],
      rejected: 0,
    });
    // Standalone mode has no installed-host ledger; the audit surface for
    // standalone writes stays exportMemory, so no auditEventId is reported.
    expect(result.structuredContent?.auditEventId).toBeUndefined();
    expect(calls.remember[0]?.messages).toEqual([
      {
        content: "The deploy is blocked on smoke verification.",
        role: "assistant",
      },
    ]);
    expect(calls.remember[0]?.scope?.userId).toBe("standalone-user");
    expect("agentId" in (calls.remember[0]?.scope ?? {})).toBe(true);
    expect(calls.remember[0]?.scope?.agentId).toBeUndefined();

    const asUser = await server._registeredTools.goodmemory_remember!.handler({
      content: "The user confirmed the rollout completed.",
      extractionStrategy: "rules-only",
      role: "user",
    });
    expect(asUser.isError).toBeUndefined();
    expect(calls.remember[1]?.messages[0]?.role).toBe("user");
    expect(calls.remember[1]?.extractionStrategy).toBe("rules-only");
  });

  it("annotates explicit tool writes as confirmed remember-always", async () => {
    const { calls, memory } = createFakeMemory();
    const server = inspectServer(
      createGoodMemoryMcpServer({
        allowWrite: true,
        dependencies: createConfiglessDependencies(memory),
        standalone: STANDALONE_CONFIG,
      }),
    );

    const result = await server._registeredTools.goodmemory_remember!.handler({
      content: "The deploy is blocked on smoke verification.",
    });

    // The explicit tool call is the deliberate confirming act: without the
    // remember-always + confirmed annotation, assistant-role content is
    // silently dropped by the default extractor and assistant policy.
    expect(calls.remember[0]?.annotations).toEqual([
      {
        confirmed: true,
        messageIndex: 0,
        reason: "explicit goodmemory_remember tool call",
        remember: "always",
      },
    ]);
    expect(result.structuredContent?.outcomes).toEqual([
      {
        memoryId: "fact-new",
        memoryType: "fact",
        outcome: "written",
      },
    ]);

    await server._registeredTools.goodmemory_remember!.handler({
      content: "Prefer bun test over npm test in this repo.",
      kindHint: "preference",
    });
    expect(calls.remember[1]?.annotations?.[0]).toMatchObject({
      kindHint: "preference",
      remember: "always",
    });
  });

  it("explains why nothing was written when the pipeline rejects", async () => {
    const { memory } = createFakeMemory();
    const rejectingMemory = {
      ...memory,
      remember: async () => ({
        accepted: 0,
        events: [
          {
            candidateId: "candidate-1",
            memoryType: "fact" as const,
            outcome: "rejected" as const,
            reason: "below_threshold",
          },
        ],
        rejected: 1,
      }),
    } as unknown as GoodMemory;
    const server = inspectServer(
      createGoodMemoryMcpServer({
        allowWrite: true,
        dependencies: createConfiglessDependencies(rejectingMemory),
        standalone: STANDALONE_CONFIG,
      }),
    );

    const result = await server._registeredTools.goodmemory_remember!.handler({
      content: "maybe",
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.accepted).toBe(0);
    expect(result.structuredContent?.outcomes).toEqual([
      {
        memoryType: "fact",
        outcome: "rejected",
        reason: "below_threshold",
      },
    ]);
    expect(String(result.structuredContent?.explanation)).toContain(
      "below_threshold",
    );
  });

  it("persists default-role writes through the real governed pipeline", async () => {
    // Regression: default role is assistant and the deterministic extractor
    // skips assistant messages, so without the tool annotation this write
    // silently no-ops (accepted 0). Real createGoodMemory, no fakes.
    const server = inspectServer(
      createGoodMemoryMcpServer({
        allowWrite: true,
        standalone: STANDALONE_CONFIG,
      }),
    );

    const result = await server._registeredTools.goodmemory_remember!.handler({
      content: "The rollout decision is to ship behind the beta flag.",
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.accepted).toBe(1);
    expect(result.structuredContent?.rejected).toBe(0);
    expect(
      (result.structuredContent?.memoryIds as string[] | undefined)?.length,
    ).toBe(1);
  });

  it("keeps context recall storage-read-only when the write tool is enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-mcp-read-only-"));
    const storageUrl = join(root, "memory.sqlite");
    const scope = {
      userId: "standalone-read-only-user",
      workspaceId: "standalone-read-only-workspace",
    };
    const server = inspectServer(
      createGoodMemoryMcpServer({
        allowWrite: true,
        standalone: {
          storage: { provider: "sqlite", url: storageUrl },
          ...scope,
        },
      }),
    );

    try {
      const memory = createGoodMemory({
        storage: { provider: "sqlite", url: storageUrl },
      });
      const written = await memory.remember({
        annotations: [
          {
            confirmed: true,
            messageIndex: 0,
            remember: "always",
          },
        ],
        extractionStrategy: "rules-only",
        messages: [
          {
            content: "Remember this project decision: use SQLite in WAL mode.",
            observedAt: "2020-01-01T00:00:00.000Z",
            role: "user",
          },
        ],
        scope,
      });
      expect(written.accepted).toBeGreaterThan(0);

      const before = await memory.exportMemory({ scope });
      expect(before.durable.experiences).toHaveLength(0);
      expect(before.durable.promotions).toHaveLength(0);
      expect(before.durable.proposals).toHaveLength(0);

      const recalled = await server._registeredTools.goodmemory_get_context!.handler({
        query: "Which database and journal mode does this project use?",
      });
      expect(recalled.isError).toBeUndefined();

      const after = await memory.exportMemory({ scope });
      expect(after.durable.facts.length).toBeGreaterThan(0);
      expect(after.durable.experiences).toHaveLength(0);
      expect(after.durable.promotions).toHaveLength(0);
      expect(after.durable.proposals).toHaveLength(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("routes installed-mode writes through the installed context", async () => {
    const { memory } = createFakeMemory();
    // All-ENOENT readFile: installed mode without config must surface the
    // structured context error, not throw.
    const server = inspectServer(
      createGoodMemoryMcpServer({
        allowWrite: true,
        dependencies: createConfiglessDependencies(memory),
        host: "codex",
      }),
    );

    expect(Object.keys(server._registeredTools)).toContain(
      "goodmemory_remember",
    );
    const result = await server._registeredTools.goodmemory_remember!.handler({
      content: "note",
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error).toContain("missing_global_config");
  });

  it("honors per-call session and config-level overrides", async () => {
    const { calls, memory } = createFakeMemory();
    const server = inspectServer(
      createGoodMemoryMcpServer({
        dependencies: createConfiglessDependencies(memory),
        standalone: {
          ...STANDALONE_CONFIG,
          maxTokens: 96,
          retrievalProfile: "general_chat",
          workspaceId: "workspace-fixed",
        },
      }),
    );

    const result = await server._registeredTools.goodmemory_get_context!.handler({
      query: "current focus",
      sessionId: "s-42",
    });

    expect(result.structuredContent?.maxTokens).toBe(96);
    expect(calls.recall[0]?.retrievalProfile).toBe("general_chat");
    expect(calls.recall[0]?.scope?.sessionId).toBe("s-42");
    expect(calls.recall[0]?.scope?.workspaceId).toBe("workspace-fixed");
  });
});
