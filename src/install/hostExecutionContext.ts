import { join, resolve } from "node:path";
import {
  createGoodMemory,
  createInternalGoodMemory,
} from "../api/createGoodMemory";
import type {
  GoodMemory,
  GoodMemoryConfig,
} from "../api/contracts";
import type { HostKind } from "../domain/hostTypes";
import { normalizeScope, type MemoryScope } from "../domain/scope";
import { resolveWorkspaceId } from "../host/managedFiles";
import type { DocumentStore } from "../storage/contracts";
import { createInMemoryDocumentStore } from "../storage/memory";
import { createPostgresDocumentStore } from "../storage/postgres";
import { createSQLiteDocumentStore } from "../storage/sqlite";
import { wrapDocumentStoreForSharedAgents } from "./hostSharedAgentStores";
import {
  createProviderEmbeddingAdapter,
  createProviderMemoryExtractor,
} from "../provider/layer";
import {
  DEFAULT_INSTALLED_HOST_MAX_TOKENS,
  DEFAULT_INSTALLED_HOST_RETRIEVAL_PROFILE,
  type InstalledHostActivationMode,
  type InstalledHostContextMode,
  type InstalledHostFileMirrorConfig,
  type InstalledHostLanguageConfig,
  type InstalledHostMaintenanceConfig,
  type InstalledHostPromptInjectionMode,
  type InstalledHostProviderConfig,
  type InstalledHostRetrievalConfig,
  type InstalledHostWritebackConfig,
  type WorkspaceHostOptInConfig,
} from "./hostConfigValidation";
import type { InstalledHostKind } from "./hostInstall";
import {
  readInstalledHostRuntimeConfig,
  readWorkspaceHostOptInConfig,
  type InstalledHostRuntimeConfigDependencies,
} from "./hostRuntimeConfig";

export interface InstalledHostContextDependencies
  extends InstalledHostRuntimeConfigDependencies {
  createMemory?: (config: GoodMemoryConfig) => GoodMemory;
}

export interface InstalledHostContextInput {
  cwd?: string;
  homeRoot?: string;
  host: InstalledHostKind;
  maxTokens?: number;
  retrievalProfile?: "coding_agent" | "general_chat";
  sessionId?: string;
}

interface InstalledHostMemoryOptions {
  postRecallMutations?: boolean;
}

export interface InstalledHostResolvedContext {
  activationMode: InstalledHostActivationMode;
  contextMode: InstalledHostContextMode;
  debug: boolean;
  host: InstalledHostKind;
  language?: InstalledHostLanguageConfig;
  maintenance?: InstalledHostMaintenanceConfig;
  maxTokens: number;
  promptInjection?: InstalledHostPromptInjectionMode;
  providers?: InstalledHostProviderConfig;
  fileMirror?: InstalledHostFileMirrorConfig;
  retrieval?: InstalledHostRetrievalConfig;
  retrievalProfile: "coding_agent" | "general_chat";
  scope: MemoryScope;
  sessionStartMaxTokens?: number;
  sharedAgents?: string[];
  storage: GoodMemoryConfig["storage"];
  writeback: InstalledHostWritebackConfig;
  workspaceRoot: string;
}

// Same runtime shape with the host label widened to HostKind, so the MCP
// server's standalone mode (host "generic") can share the memory/progressive
// plumbing. Installed contexts assign cleanly (InstalledHostKind ⊂ HostKind).
export type HostMemoryRuntimeContext = Omit<InstalledHostResolvedContext, "host"> & {
  host: HostKind;
};

export type InstalledHostContextResolution =
  | {
      context: InstalledHostResolvedContext;
      status: "ok";
    }
  | {
      debug: boolean;
      status:
        | "disabled"
        | "invalid_global_config"
        | "invalid_repo_config"
        | "missing_global_config"
        | "missing_repo_config";
      workspaceRoot: string;
    };

export async function resolveInstalledHostContext(
  input: InstalledHostContextInput,
  dependencies: InstalledHostContextDependencies = {},
): Promise<InstalledHostContextResolution> {
  const workspaceRoot = resolve(input.cwd ?? ".");
  const globalConfig = await readInstalledHostRuntimeConfig(
    input.host,
    input.homeRoot,
    dependencies,
  );
  if (globalConfig.status !== "ok") {
    return {
      debug: false,
      status:
        globalConfig.status === "invalid"
          ? "invalid_global_config"
          : "missing_global_config",
      workspaceRoot,
    };
  }

  const repoConfig = await readWorkspaceHostOptInConfig(
    input.host,
    workspaceRoot,
    dependencies,
  );
  if (repoConfig.status === "invalid") {
    return {
      debug: globalConfig.config.debug,
      status: "invalid_repo_config",
      workspaceRoot,
    };
  }
  if (repoConfig.status === "disabled") {
    return {
      debug: repoConfig.config.debug || globalConfig.config.debug,
      status: "disabled",
      workspaceRoot,
    };
  }
  if (
    repoConfig.status === "missing" &&
    globalConfig.config.activationMode !== "global"
  ) {
    return {
      debug: globalConfig.config.debug,
      status: "missing_repo_config",
      workspaceRoot,
    };
  }

  const workspaceConfig =
    repoConfig.status === "ok"
      ? repoConfig.config
      : createGlobalWorkspaceConfig(workspaceRoot);

  return {
    status: "ok",
    context: {
      activationMode: globalConfig.config.activationMode,
      contextMode:
        workspaceConfig.contextMode ?? globalConfig.config.contextMode,
      debug: globalConfig.config.debug || workspaceConfig.debug,
      host: input.host,
      ...(globalConfig.config.language
        ? { language: globalConfig.config.language }
        : {}),
      maxTokens:
        input.maxTokens ??
        workspaceConfig.maxTokens ??
        globalConfig.config.maxTokens ??
        DEFAULT_INSTALLED_HOST_MAX_TOKENS,
      retrievalProfile:
        input.retrievalProfile ??
        workspaceConfig.retrievalProfile ??
        globalConfig.config.retrievalProfile ??
        DEFAULT_INSTALLED_HOST_RETRIEVAL_PROFILE,
      ...(globalConfig.config.promptInjection
        ? { promptInjection: globalConfig.config.promptInjection }
        : {}),
      ...(globalConfig.config.providers
        ? { providers: globalConfig.config.providers }
        : {}),
      ...(globalConfig.config.retrieval
        ? { retrieval: globalConfig.config.retrieval }
        : {}),
      ...(globalConfig.config.fileMirror
        ? { fileMirror: globalConfig.config.fileMirror }
        : {}),
      ...(workspaceConfig.sessionStartMaxTokens ??
      globalConfig.config.sessionStartMaxTokens
        ? {
            sessionStartMaxTokens:
              workspaceConfig.sessionStartMaxTokens ??
              globalConfig.config.sessionStartMaxTokens,
          }
        : {}),
      ...(globalConfig.config.sharedAgents?.length
        ? { sharedAgents: globalConfig.config.sharedAgents }
        : {}),
      ...(globalConfig.config.maintenance
        ? { maintenance: globalConfig.config.maintenance }
        : {}),
      scope: normalizeScope({
        agentId: input.host,
        sessionId: input.sessionId,
        userId: globalConfig.config.userId,
        workspaceId: workspaceConfig.workspaceId,
      }),
      storage: {
        provider: globalConfig.config.storage.provider,
        url: globalConfig.config.storage.url,
      },
      writeback: globalConfig.config.writeback,
      workspaceRoot,
    },
  };
}

function createGlobalWorkspaceConfig(workspaceRoot: string): WorkspaceHostOptInConfig {
  return {
    debug: false,
    enabled: true,
    workspaceId: resolveWorkspaceId(workspaceRoot, undefined),
  };
}

export function createInstalledHostMemory(
  context: HostMemoryRuntimeContext,
  dependencies: InstalledHostContextDependencies = {},
  options: InstalledHostMemoryOptions = {},
): GoodMemory {
  const providerAdapters = buildInstalledHostProviderAdapters(context.providers);
  const sharedDocumentStore = buildSharedAgentDocumentStore(context);
  const adapters =
    providerAdapters || sharedDocumentStore
      ? {
          ...(providerAdapters ?? {}),
          ...(sharedDocumentStore ? { documentStore: sharedDocumentStore } : {}),
        }
      : undefined;
  const config: GoodMemoryConfig = {
    ...(adapters ? { adapters } : {}),
    ...(context.language ? { language: context.language } : {}),
    // 1:1 with GoodMemoryRetrievalConfig; absence keeps rules-only parity.
    ...(context.retrieval ? { retrieval: context.retrieval } : {}),
    // Derived workspace mirror of the export bundle; off unless enabled.
    ...(context.fileMirror?.enabled
      ? {
          governance: {
            fileMirror: {
              root:
                context.fileMirror.root ??
                join(context.workspaceRoot, ".goodmemory", "memory"),
              // Bound to the workspace, not the host agent: every agent
              // writing into this workspace regenerates the same tree.
              scope: {
                userId: context.scope.userId,
                ...(context.scope.tenantId ? { tenantId: context.scope.tenantId } : {}),
                ...(context.scope.workspaceId ? { workspaceId: context.scope.workspaceId } : {}),
              },
            },
          },
        }
      : {}),
    remember: {
      preset: "coding_agent",
      profiles: [
        {
          assistantOutputs: {
            mode: mapWritebackAssistantPolicy(context.writeback.allowAssistantOutput),
          },
          extends: "coding_agent",
          id: `installed-host-${context.host}-writeback`,
          // No `when` matcher: this memory instance is dedicated to the
          // resolved context, so the writeback assistant policy must govern
          // every write through it. Installed scopes carry agentId=<host>,
          // but standalone scopes default to agentId undefined and a
          // host-keyed matcher would silently fall back to mode "ignore".
        },
      ],
    },
    storage: context.storage,
  };
  if (dependencies.createMemory) {
    return dependencies.createMemory(config);
  }
  if (options.postRecallMutations === undefined) {
    return createGoodMemory(config);
  }
  return createInternalGoodMemory(config, {
    postRecallMutations: options.postRecallMutations,
  });
}

function mapWritebackAssistantPolicy(
  policy: InstalledHostWritebackConfig["allowAssistantOutput"],
):
  | "confirmed_only"
  | "confirmed_or_verified_only"
  | "ignore"
  | "verified_only" {
  if (policy === "confirmed") {
    return "confirmed_only";
  }
  if (policy === "verified") {
    return "verified_only";
  }
  if (policy === "confirmed_or_verified") {
    return "confirmed_or_verified_only";
  }

  return "ignore";
}

// sharedAgents read union rides a decorated document store built from the
// same storage config createGoodMemory would use. Session and vector stores
// stay auto-built: runtime continuity is per host+session, and the vector
// path does not union shared agents in v1 (doctor surfaces that limitation
// when an embedding provider is configured alongside sharedAgents).
function buildSharedAgentDocumentStore(
  context: HostMemoryRuntimeContext,
): DocumentStore | undefined {
  const sharedAgentIds = context.sharedAgents ?? [];
  const ownAgentId = context.scope.agentId;
  if (sharedAgentIds.length === 0 || !ownAgentId) {
    return undefined;
  }

  return createInstalledHostDocumentStore(context);
}

export function createInstalledHostDocumentStore(
  context: HostMemoryRuntimeContext,
): DocumentStore {
  const storage = context.storage;
  const base =
    storage?.provider === "sqlite" && storage.url
      ? createSQLiteDocumentStore(storage.url)
      : storage?.provider === "postgres" && storage.url
        ? createPostgresDocumentStore({ url: storage.url })
        : createInMemoryDocumentStore();
  const ownAgentId = context.scope.agentId;
  const sharedAgentIds = context.sharedAgents ?? [];
  return ownAgentId && sharedAgentIds.length > 0
    ? wrapDocumentStoreForSharedAgents(base, { ownAgentId, sharedAgentIds })
    : base;
}

function buildInstalledHostProviderAdapters(
  providers: InstalledHostProviderConfig | undefined,
): GoodMemoryConfig["adapters"] | undefined {
  if (!providers?.embedding && !providers?.assistedExtractor) {
    return undefined;
  }

  return {
    ...(providers.embedding
      ? {
          embeddingAdapter: createProviderEmbeddingAdapter({
            model: providers.embedding,
          }),
        }
      : {}),
    ...(providers.assistedExtractor
      ? {
          assistedExtractor: createProviderMemoryExtractor({
            model: providers.assistedExtractor,
          }),
        }
      : {}),
  };
}
