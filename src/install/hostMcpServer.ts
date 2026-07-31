import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { readFileSync } from "node:fs";
import * as z from "zod/v4";
import type {
  BuildContextInput,
  GoodMemory,
  GoodMemoryConfig,
  RecallResult,
} from "../api/contracts";
import type { GoodMemoryRuntimeInfo } from "../api/runtimeInfo";
import { inspectGoodMemoryRuntime } from "../api/runtimeInfo";
import type { HostKind } from "../domain/hostTypes";
import { scopeToKey, type MemoryScope } from "../domain/scope";
import { createHostAdapter } from "../host";
import {
  parseGoodMemoryRecordRef,
  type ProgressiveRecallService,
} from "../progressive/recall";
import { resolveRecallRoutingWarningMessages } from "../recall/router";
import {
  createInstalledHostMemory,
  resolveInstalledHostContext,
  type HostMemoryRuntimeContext,
  type InstalledHostContextDependencies,
  type InstalledHostContextInput,
} from "./hostExecutionContext";
import type { InstalledHostKind } from "./hostInstall";
import {
  createInstalledHostProgressiveRecallService,
  readInstalledHostProgressiveRecordCache,
  resolveInstalledHostProgressiveScopeDigest,
  writeInstalledHostProgressiveRecordCache,
} from "./hostProgressiveRecall";
import { recordRememberToolWriteback } from "./hostWritebackRuntime";
import {
  resolveStandaloneMcpContext,
  type StandaloneMcpConfig,
  type StandaloneMcpPerCallInput,
} from "./standaloneMcpContext";

const DEFAULT_CONTEXT_OUTPUT: BuildContextInput["output"] =
  "developer_prompt_fragment";
const PACKAGE_JSON_URL = new URL("../../package.json", import.meta.url);

let packageVersionCache: string | undefined;

function readPackageVersion(): string {
  if (packageVersionCache) {
    return packageVersionCache;
  }

  const packageJson = JSON.parse(
    readFileSync(PACKAGE_JSON_URL, "utf8"),
  ) as { version?: unknown };
  if (
    typeof packageJson.version !== "string" ||
    packageJson.version.length === 0
  ) {
    throw new Error("Unable to read GoodMemory package version.");
  }

  packageVersionCache = packageJson.version;
  return packageVersionCache;
}

export interface GoodMemoryMcpServerDependencies
  extends InstalledHostContextDependencies {
  createMemory?: (config: GoodMemoryConfig) => GoodMemory;
  // Overrides the installed-host root (config + writeback audit ledger).
  // Defaults to the GOODMEMORY_HOME/home-directory chain.
  homeRoot?: string;
}

const TOOL_SCOPE_SCHEMA = {
  cwd: z.string().optional().describe("Workspace root. Defaults to the current working directory."),
  sessionId: z.string().optional().describe("Optional host session id for session-scoped recall."),
};

// Installed mode reads the managed host config (`goodmemory setup`);
// standalone mode synthesizes the same runtime context from explicit config,
// so any MCP client can run the server without an installed host.
export type GoodMemoryMcpServerInput =
  | {
      // Registers the opt-in goodmemory_remember write tool. Default false:
      // the served surface stays read-only.
      allowWrite?: boolean;
      dependencies?: GoodMemoryMcpServerDependencies;
      host: InstalledHostKind;
      standalone?: undefined;
    }
  | {
      allowWrite?: boolean;
      dependencies?: GoodMemoryMcpServerDependencies;
      host?: undefined;
      standalone: StandaloneMcpConfig;
    };

export async function serveGoodMemoryMcp(
  input: GoodMemoryMcpServerInput,
): Promise<void> {
  const handle = serveStdio(() => createGoodMemoryMcpServer(input));
  try {
    await waitForTransportShutdown();
  } finally {
    await handle.close();
  }
}

export function createGoodMemoryMcpServer(
  input: GoodMemoryMcpServerInput,
): McpServer {
  const server = new McpServer({
    name: "goodmemory-mcp",
    version: readPackageVersion(),
  });
  const dependencies = input.dependencies ?? {};
  const progressiveServices = new Map<string, ProgressiveRecallService>();
  const hostLabel: HostKind = input.standalone ? "generic" : input.host;
  const loadContext = async (
    args: StandaloneMcpPerCallInput,
  ): Promise<(HostMemoryRuntimeContext & { memory: GoodMemory }) | { error: string }> => {
    if (input.standalone) {
      const context = resolveStandaloneMcpContext(input.standalone, args);
      return {
        ...context,
        memory: createInstalledHostMemory(context, dependencies),
      };
    }
    return loadInstalledHostExecutionContext(
      {
        ...args,
        ...(dependencies.homeRoot ? { homeRoot: dependencies.homeRoot } : {}),
        host: input.host,
      },
      dependencies,
    );
  };

  server.registerTool(
    "goodmemory_get_context",
    {
      description:
        "Fetch a compact memory context fragment for a specific question about this workspace. Call it when hook-injected context is missing or insufficient, or when you need memory for a different question than the current prompt.",
      inputSchema: z.object({
        ...TOOL_SCOPE_SCHEMA,
        maxTokens: z.number().int().positive().optional(),
        output: z
          .enum(["json", "markdown", "system_prompt_fragment", "developer_prompt_fragment"])
          .optional(),
        query: z.string().min(1),
        retrievalProfile: z.enum(["coding_agent", "general_chat"]).optional(),
      }),
    },
    async (args) => {
      const context = await loadContext({
        cwd: args.cwd,
        maxTokens: args.maxTokens,
        retrievalProfile: args.retrievalProfile,
        sessionId: args.sessionId,
      });
      if ("error" in context) {
        return buildMcpErrorResult(context.error);
      }

      const recall = await context.memory.recall({
        query: args.query,
        retrievalProfile: context.retrievalProfile,
        scope: context.scope,
      });
      const built = await context.memory.buildContext({
        maxTokens: context.maxTokens,
        output: args.output ?? DEFAULT_CONTEXT_OUTPUT,
        recall,
      });
      const routing = projectRecallRouting(recall);
      return buildMcpStructuredResult({
        content: built.content,
        estimatedTokens: built.estimatedTokens,
        maxTokens: context.maxTokens,
        omittedSections: built.omittedSections,
        output: built.output,
        query: args.query,
        retrievalProfile: context.retrievalProfile,
        ...(routing ? { routing } : {}),
        scope: context.scope,
      });
    },
  );

  server.registerTool(
    "goodmemory_inspect_memory",
    {
      description:
        "Diagnostic (beyond the primary goodmemory_get_context / goodmemory_remember tools). Use this when you need a read-only snapshot of durable and runtime GoodMemory state for the current workspace.",
      inputSchema: z.object({
        ...TOOL_SCOPE_SCHEMA,
        includeRuntime: z.boolean().optional(),
      }),
    },
    async (args) => {
      const context = await loadContext({
        cwd: args.cwd,
        sessionId: args.sessionId,
      });
      if ("error" in context) {
        return buildMcpErrorResult(context.error);
      }

      const exported = await context.memory.exportMemory({
        includeRuntime: args.includeRuntime === true,
        scope: context.scope,
      });
      const structured = {
        durable: exported.durable,
        runtime: exported.runtime,
        scope: exported.scope,
      };
      return buildMcpStructuredResult(structured);
    },
  );

  server.registerTool(
    "goodmemory_trace_recall",
    {
      description:
        "Diagnostic. Explain a recall: routing, hits, per-candidate scores, and suppression reasons. Call it when a memory that should exist did not surface, or when a surfaced memory looks wrong.",
      inputSchema: z.object({
        ...TOOL_SCOPE_SCHEMA,
        query: z.string().min(1),
        retrievalProfile: z.enum(["coding_agent", "general_chat"]).optional(),
        strategy: z.enum(["auto", "rules-only", "hybrid", "llm-assisted"]).optional(),
      }),
    },
    async (args) => {
      const context = await loadContext({
        cwd: args.cwd,
        retrievalProfile: args.retrievalProfile,
        sessionId: args.sessionId,
      });
      if ("error" in context) {
        return buildMcpErrorResult(context.error);
      }

      const recall = await context.memory.recall({
        query: args.query,
        retrievalProfile: context.retrievalProfile,
        scope: context.scope,
        strategy: args.strategy,
      });
      return buildMcpStructuredResult(
        buildTraceRecallResult({
          query: args.query,
          recall,
          scope: context.scope,
        }),
      );
    },
  );

  server.registerTool(
    "goodmemory_search_index",
    {
      description:
        "Advanced recall (past goodmemory_get_context). Progressive GoodMemory recall step 1: fetch a compact recordRef index for a query, then call goodmemory_get_records for detail. Prefer this over goodmemory_get_context when you need specific records rather than a rendered summary.",
      inputSchema: z.object({
        ...TOOL_SCOPE_SCHEMA,
        includeRuntime: z.boolean().optional(),
        limit: z.number().int().positive().max(50).optional(),
        query: z.string().min(1),
        retrievalProfile: z.enum(["coding_agent", "general_chat"]).optional(),
      }),
    },
    async (args) => {
      const context = await loadContext({
        cwd: args.cwd,
        retrievalProfile: args.retrievalProfile,
        sessionId: args.sessionId,
      });
      if ("error" in context) {
        return buildMcpErrorResult(context.error);
      }

      const service = await getProgressiveRecallService(
        context,
        dependencies,
        progressiveServices,
      );
      const index = await service.searchRecallIndex({
        includeRuntime: args.includeRuntime === true,
        limit: args.limit,
        query: args.query,
        retrievalProfile: context.retrievalProfile,
        scope: context.scope,
      });
      await persistProgressiveRecordCache({
        ...(dependencies.homeRoot ? { homeRoot: dependencies.homeRoot } : {}),
        host: hostLabel,
        recordRefs: index.records.map((record) => record.recordRef),
        scope: context.scope,
        scopeDigest: index.scopeDigest,
        service,
      });
      return buildMcpStructuredResult({ ...index });
    },
  );

  server.registerTool(
    "goodmemory_timeline",
    {
      description:
        "Advanced recall. Use this for progressive GoodMemory recall when you need compact chronological context before drilling into recordRefs.",
      inputSchema: z.object({
        ...TOOL_SCOPE_SCHEMA,
        includeRuntime: z.boolean().optional(),
        limit: z.number().int().positive().max(50).optional(),
        query: z.string().min(1),
        recordsPerBucket: z.number().int().positive().max(20).optional(),
        retrievalProfile: z.enum(["coding_agent", "general_chat"]).optional(),
      }),
    },
    async (args) => {
      const context = await loadContext({
        cwd: args.cwd,
        retrievalProfile: args.retrievalProfile,
        sessionId: args.sessionId,
      });
      if ("error" in context) {
        return buildMcpErrorResult(context.error);
      }

      const service = await getProgressiveRecallService(
        context,
        dependencies,
        progressiveServices,
      );
      const timeline = await service.buildRecallTimeline({
        includeRuntime: args.includeRuntime === true,
        limit: args.limit,
        query: args.query,
        recordsPerBucket: args.recordsPerBucket,
        retrievalProfile: context.retrievalProfile,
        scope: context.scope,
      });
      await persistProgressiveRecordCache({
        ...(dependencies.homeRoot ? { homeRoot: dependencies.homeRoot } : {}),
        host: hostLabel,
        recordRefs: timeline.buckets.flatMap((bucket) =>
          bucket.records.map((record) => record.recordRef)
        ),
        scope: context.scope,
        scopeDigest: timeline.scopeDigest,
        service,
      });
      return buildMcpStructuredResult({ ...timeline });
    },
  );

  server.registerTool(
    "goodmemory_get_records",
    {
      description:
        "Advanced recall. Use this for progressive GoodMemory recall after search_index or timeline returns recordRefs that need detail.",
      inputSchema: z.object({
        ...TOOL_SCOPE_SCHEMA,
        recordRefs: z.array(z.string().min(1)).min(1).max(20),
      }),
    },
    async (args) => {
      const context = await loadContext({
        cwd: args.cwd,
        sessionId: args.sessionId,
      });
      if ("error" in context) {
        return buildMcpErrorResult(context.error);
      }

      const service = await getProgressiveRecallService(
        context,
        dependencies,
        progressiveServices,
      );
      try {
        const records = await service.getProgressiveRecords({
          recordRefs: args.recordRefs,
          scope: context.scope,
        });
        return buildMcpStructuredResult({ ...records });
      } catch (error) {
        const fallbackScopeDigest = await resolveCacheFallbackScopeDigest({
          context,
          error,
          recordRefs: args.recordRefs,
        });
        if (fallbackScopeDigest) {
          try {
            const cachedRecords = await readInstalledHostProgressiveRecordCache({
              ...(dependencies.homeRoot
                ? { homeRoot: dependencies.homeRoot }
                : {}),
              host: hostLabel,
              recordRefs: args.recordRefs,
              scopeDigest: fallbackScopeDigest,
            });
            if (cachedRecords.length === args.recordRefs.length) {
              return buildMcpStructuredResult({
                records: cachedRecords,
                scopeDigest: fallbackScopeDigest,
              });
            }
          } catch (cacheError) {
            console.error(
              `[goodmemory-mcp] Failed to read progressive recall cache for ${hostLabel}/${fallbackScopeDigest}:`,
              cacheError,
            );
          }
        }
        return buildMcpErrorResult(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  );

  server.registerTool(
    "goodmemory_read_artifacts",
    {
      description:
        "Diagnostic. Use this when you need the accepted host-adapter artifact projection for the current workspace.",
      inputSchema: z.object({
        ...TOOL_SCOPE_SCHEMA,
        includeRuntime: z.boolean().optional(),
      }),
    },
    async (args) => {
      const context = await loadContext({
        cwd: args.cwd,
        sessionId: args.sessionId,
      });
      if ("error" in context) {
        return buildMcpErrorResult(context.error);
      }

      const adapter = createHostAdapter({
        hostKind: hostLabel,
        id: "goodmemory-mcp",
        memory: context.memory,
      });
      const artifacts = await adapter.readArtifacts({
        includeRuntime: args.includeRuntime === true,
        scope: context.scope,
      });
      return buildMcpStructuredResult({
        artifacts: artifacts.artifacts,
        exportedAt: artifacts.exportedAt,
        rootPath: artifacts.rootPath,
        scope: artifacts.scope,
      });
    },
  );

  server.registerTool(
    "goodmemory_stats",
    {
      description:
        "Diagnostic. Record counts and runtime metadata (embedding/retrieval status via the `retrieval` field) for the current GoodMemory scope. Call it to check whether memory exists here before assuming an empty store.",
      inputSchema: z.object({
        ...TOOL_SCOPE_SCHEMA,
        includeRuntime: z.boolean().optional(),
      }),
    },
    async (args) => {
      const context = await loadContext({
        cwd: args.cwd,
        sessionId: args.sessionId,
      });
      if ("error" in context) {
        return buildMcpErrorResult(context.error);
      }

      const exported = await context.memory.exportMemory({
        includeRuntime: args.includeRuntime === true,
        scope: context.scope,
      });
      const retrieval = projectRuntimeRetrieval(
        inspectGoodMemoryRuntime(context.memory),
      );
      return buildMcpStructuredResult({
        counts: {
          archives: exported.durable.archives.length,
          episodes: exported.durable.episodes.length,
          evidence: exported.durable.evidence.length,
          experiences: exported.durable.experiences.length,
          facts: exported.durable.facts.length,
          feedback: exported.durable.feedback.length,
          preferences: exported.durable.preferences.length,
          profile: exported.durable.profile ? 1 : 0,
          promotions: exported.durable.promotions.length,
          proposals: exported.durable.proposals.length,
          references: exported.durable.references.length,
        },
        ...(retrieval ? { retrieval } : {}),
        runtime: exported.runtime
          ? {
              journal: exported.runtime.journal ? 1 : 0,
              spills: exported.runtime.spills.length,
              workingMemory: exported.runtime.workingMemory ? 1 : 0,
            }
          : null,
        scope: exported.scope,
      });
    },
  );

  if (input.allowWrite === true) {
    server.registerTool(
      "goodmemory_remember",
      {
        annotations: {
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
          readOnlyHint: false,
        },
        description:
          "Use this to persist a memory-worthy statement as durable GoodMemory. The write is governed: classification and dedupe may reject or merge it (see accepted/rejected and per-event outcomes in the result). If accepted is 0, the explanation field says why. Accepted installed-mode writes are also recorded in the writeback audit ledger; the result's auditEventId works with `goodmemory <host> writeback inspect` and `goodmemory <host> writeback forget --event-id <id>`.",
        inputSchema: z.object({
          ...TOOL_SCOPE_SCHEMA,
          content: z.string().min(1).describe("The memory-worthy statement to persist."),
          extractionStrategy: z.enum(["auto", "rules-only", "llm-assisted"]).optional(),
          kindHint: z
            .enum(["preference", "fact", "feedback", "reference"])
            .optional()
            .describe("Optional memory kind for the statement; classification infers one otherwise."),
          locale: z.string().optional(),
          role: z
            .enum(["user", "assistant"])
            .optional()
            .describe("Message role for governance provenance. Defaults to assistant (the caller); pass user only for user-originated content."),
        }),
      },
      async (args) => {
        const context = await loadContext({
          cwd: args.cwd,
          sessionId: args.sessionId,
        });
        if ("error" in context) {
          return buildMcpErrorResult(context.error);
        }

        const result = await context.memory.remember({
          // The explicit tool call is the deliberate confirming act: the
          // remember-always annotation force-adds the statement even where
          // the deterministic extractor would skip it (assistant role), and
          // confirmed satisfies the assistant-output policy honestly.
          annotations: [
            {
              confirmed: true,
              ...(args.kindHint ? { kindHint: args.kindHint } : {}),
              messageIndex: 0,
              reason: "explicit goodmemory_remember tool call",
              remember: "always",
            },
          ],
          extractionStrategy: args.extractionStrategy,
          locale: args.locale,
          messages: [
            {
              content: args.content,
              role: args.role ?? "assistant",
            },
          ],
          scope: context.scope,
        });
        let auditEventId: string | undefined;
        if (input.standalone === undefined && result.accepted > 0) {
          try {
            const recorded = await recordRememberToolWriteback({
              content: args.content,
              events: result.events,
              ...(dependencies.homeRoot ? { homeRoot: dependencies.homeRoot } : {}),
              host: input.host,
              mode: context.writeback.mode,
              scope: context.scope,
              ...(args.sessionId ? { sessionId: args.sessionId } : {}),
              source: args.role ?? "assistant",
            });
            auditEventId = recorded?.eventId;
          } catch {
            // Fail-open: the durable write already succeeded; a ledger
            // hiccup must not fail the tool call.
          }
        }
        const outcomes = result.events.map((event) => ({
          ...(event.memoryId !== undefined ? { memoryId: event.memoryId } : {}),
          memoryType: event.memoryType,
          outcome: event.outcome,
          ...(event.reason !== undefined ? { reason: event.reason } : {}),
        }));
        return buildMcpStructuredResult({
          accepted: result.accepted,
          ...(auditEventId ? { auditEventId } : {}),
          events: result.events,
          ...(result.accepted === 0
            ? {
                explanation:
                  outcomes.length === 0
                    ? "No candidate survived extraction; the statement may have been filtered as noise before classification."
                    : `Nothing was written: ${outcomes
                        .map((outcome) => `${outcome.outcome}${outcome.reason ? ` (${outcome.reason})` : ""}`)
                        .join(", ")}.`,
              }
            : {}),
          memoryIds: result.events
            .map((event) => event.memoryId)
            .filter((memoryId): memoryId is string => memoryId !== undefined),
          outcomes,
          rejected: result.rejected,
          // Surface the resolved extraction strategy and any non-fatal
          // degradation warnings so the calling agent can see when its write
          // silently ran the rules-only floor or produced no durable memory.
          ...(result.metadata?.resolvedExtractionStrategy
            ? { resolvedExtractionStrategy: result.metadata.resolvedExtractionStrategy }
            : {}),
          scope: context.scope,
          storage: {
            provider: context.storage?.provider,
          },
          ...(result.warnings && result.warnings.length > 0
            ? { warnings: result.warnings }
            : {}),
        });
      },
    );
  }

  return server;
}

async function persistProgressiveRecordCache(input: {
  homeRoot?: string;
  host: HostKind;
  recordRefs: string[];
  scope: MemoryScope;
  scopeDigest: string;
  service: ProgressiveRecallService;
}): Promise<void> {
  if (input.recordRefs.length === 0) {
    return;
  }

  const records = await input.service.getProgressiveRecords({
    recordRefs: input.recordRefs,
    scope: input.scope,
  });
  await writeInstalledHostProgressiveRecordCache({
    ...(input.homeRoot ? { homeRoot: input.homeRoot } : {}),
    host: input.host,
    records: records.records,
    scopeDigest: input.scopeDigest,
  });
}

async function getProgressiveRecallService(
  context: HostMemoryRuntimeContext,
  dependencies: InstalledHostContextDependencies,
  cache: Map<string, ProgressiveRecallService>,
): Promise<ProgressiveRecallService> {
  const cacheKey = [
    context.host,
    context.workspaceRoot,
    context.storage?.provider ?? "",
    context.storage?.url ?? "",
    scopeToKey(context.scope),
  ].join("\n");
  const existing = cache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const service = await createInstalledHostProgressiveRecallService({
    context,
    dependencies,
  });
  cache.set(cacheKey, service);
  return service;
}

async function resolveCacheFallbackScopeDigest(input: {
  context: HostMemoryRuntimeContext;
  error: unknown;
  recordRefs: string[];
}): Promise<string | null> {
  if (!isProgressiveVisibilityMissError(input.error)) {
    return null;
  }

  const parsedRefs = input.recordRefs.map((recordRef) =>
    parseGoodMemoryRecordRef(recordRef),
  );
  if (parsedRefs.some((parsed) => parsed === null)) {
    return null;
  }

  const scopeDigests = new Set(parsedRefs.map((parsed) => parsed!.scopeDigest));
  if (scopeDigests.size !== 1) {
    return null;
  }

  const expectedScopeDigest = await resolveInstalledHostProgressiveScopeDigest({
    context: input.context,
  });
  const requestedScopeDigest = Array.from(scopeDigests)[0]!;
  return requestedScopeDigest === expectedScopeDigest
    ? requestedScopeDigest
    : null;
}

function isProgressiveVisibilityMissError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      "is not available in the current progressive recall visibility set",
    )
  );
}

async function loadInstalledHostExecutionContext(
  input: InstalledHostContextInput,
  dependencies: InstalledHostContextDependencies,
): Promise<
  | (HostMemoryRuntimeContext & { memory: GoodMemory })
  | { error: string }
> {
  const resolved = await resolveInstalledHostContext(
    input,
    dependencies,
  );
  if (resolved.status !== "ok") {
    return {
      error: `GoodMemory ${input.host} context is unavailable: ${resolved.status}.`,
    };
  }
  return {
    ...resolved.context,
    memory: createInstalledHostMemory(resolved.context, dependencies),
  };
}

// A slim, agent-facing recall routing projection for goodmemory_get_context:
// which strategy actually ran, its one-line summary, and any degradation
// warnings — so a consuming agent can see it is on the rules-only floor rather
// than getting a silently poor result. (trace_recall carries the full decision.)
function projectRecallRouting(
  recall: RecallResult,
):
  | {
      resolvedStrategy?: string;
      summary?: string;
      warningMessages?: string[];
      warnings?: string[];
    }
  | undefined {
  const decision = recall.metadata?.routingDecision;
  if (!decision) {
    return undefined;
  }
  const explanation = decision.strategyExplanation;
  const resolvedStrategy = explanation?.resolvedStrategy ?? decision.strategy;
  const routing: {
    resolvedStrategy?: string;
    summary?: string;
    warningMessages?: string[];
    warnings?: string[];
  } = {};
  if (resolvedStrategy) {
    routing.resolvedStrategy = resolvedStrategy;
  }
  if (explanation?.summary) {
    routing.summary = explanation.summary;
  }
  if (explanation?.warnings && explanation.warnings.length > 0) {
    routing.warnings = explanation.warnings;
  }
  const warningMessages = resolveRecallRoutingWarningMessages({
    existingMessages: explanation?.warningMessages,
    warnings: explanation?.warnings,
  });
  if (warningMessages.length > 0) {
    routing.warningMessages = warningMessages;
  }
  return Object.keys(routing).length > 0 ? routing : undefined;
}

// Agent-facing retrieval runtime status for goodmemory_stats: whether an
// embedding endpoint and assisted extraction are wired, which preset (if any)
// is active, and storage durability — so an agent can see, alongside empty
// counts, whether it is on a degraded config (e.g. embedding on but no preset).
// Returns null when runtime info is unavailable (e.g. an injected fake memory).
function projectRuntimeRetrieval(
  info: GoodMemoryRuntimeInfo | undefined,
): {
  assistedExtractionEnabled: boolean;
  embeddingEnabled: boolean;
  retrievalPreset: string | null;
  storageDurability: string;
} | null {
  if (!info) {
    return null;
  }
  return {
    assistedExtractionEnabled: info.assistedExtractionEnabled,
    embeddingEnabled: info.embeddingEnabled,
    retrievalPreset: info.retrievalPreset?.requested ?? null,
    storageDurability: info.storage.durability,
  };
}

function buildTraceRecallResult(input: {
  query: string;
  recall: RecallResult;
  scope: MemoryScope;
}): Record<string, unknown> {
  return {
    candidateTraceCount: input.recall.metadata.candidateTraces.length,
    candidateTraces: input.recall.metadata.candidateTraces,
    hits: input.recall.metadata.hits,
    policyApplied: input.recall.metadata.policyApplied,
    query: input.query,
    routingDecision: input.recall.metadata.routingDecision,
    scope: input.scope,
    verificationHints: input.recall.metadata.verificationHints,
  };
}

function buildMcpStructuredResult<T extends object>(
  structuredContent: T,
): {
  content: Array<{ text: string; type: "text" }>;
  structuredContent: T;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
  };
}

function buildMcpErrorResult(error: string): {
  content: Array<{ text: string; type: "text" }>;
  isError: true;
  structuredContent: { error: string };
} {
  return {
    content: [
      {
        type: "text",
        text: error,
      },
    ],
    isError: true,
    structuredContent: {
      error,
    },
  };
}

function waitForTransportShutdown(): Promise<void> {
  if (process.stdin.destroyed) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      process.stdin.off("close", finish);
      process.stdin.off("end", finish);
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      resolve();
    };

    process.stdin.once("close", finish);
    process.stdin.once("end", finish);
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}
