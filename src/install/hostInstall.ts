import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  buildInvalidManagedConfigError,
  buildUnchangedFileChange,
  removeMarkerManagedFile,
  relativeToRoot,
  resolveWorkspaceId,
  writeManagedFile,
  writeMarkerManagedFile,
} from "../host/managedFiles";
import type { LanguageRenderKey } from "../language";
import { createLanguageService } from "../language";
import {
  DEFAULT_INSTALLED_HOST_ACTIVATION_MODE,
  DEFAULT_INSTALLED_HOST_CONTEXT_MODE,
  DEFAULT_INSTALLED_HOST_MAX_TOKENS,
  DEFAULT_INSTALLED_HOST_RETRIEVAL_PROFILE,
  DEFAULT_INSTALLED_HOST_WRITEBACK,
  isRecord,
  normalizeInstalledHostWritebackConfig,
  canonicalizeInstalledHostDefaultLocale,
  parseInstalledHostRuntimeConfig,
  readPositiveInteger,
  readContextMode,
  readRetrievalProfile,
  type InstalledHostActivationMode,
  type InstalledHostContextMode,
  type InstalledHostEmbeddingProviderConfig,
  type InstalledHostLanguageConfig,
  type InstalledHostModelProviderConfig,
  type InstalledHostProviderConfig,
  type InstalledHostMaintenanceConfig,
  type InstalledHostPromptInjectionMode,
  type InstalledHostRetrievalConfig,
  type InstalledHostRuntimeConfig,
  type InstalledHostWritebackConfig,
  type InstalledHostWritebackMode,
} from "./hostConfigValidation";
import {
  registerInstalledHostMcp,
  resolveInstalledHostMcpTargetPath,
  unregisterInstalledHostMcp,
} from "./hostMcpConfig";
import {
  registerInstalledHostHooks,
  resolveInstalledHostHookTargetPath,
  unregisterInstalledHostHooks,
} from "./hostHookConfig";

export type InstalledHostKind = "claude" | "codex";

export interface InstalledHostFileChange {
  action: "created" | "deleted" | "unchanged" | "updated";
  path: string;
  relativePath: string;
}

export interface InstallHostInput {
  activationMode?: InstalledHostActivationMode;
  assistedExtractor?: InstalledHostModelProviderConfig;
  contextMode?: InstalledHostContextMode;
  embedding?: InstalledHostEmbeddingProviderConfig;
  homeRoot?: string;
  host: InstalledHostKind;
  language?: InstalledHostLanguageConfig;
  memoryPath?: string;
  storageProvider?: InstalledHostStorageProvider;
  storageUrl?: string;
  userId?: string;
  writeback?: InstalledHostWritebackConfig;
}

export interface InstallHostResult {
  activationMode: InstalledHostActivationMode;
  contextMode: InstalledHostContextMode;
  changes: InstalledHostFileChange[];
  configPath: string;
  host: InstalledHostKind;
  installRoot: string;
  language?: InstalledHostLanguageConfig;
  memoryPath: string;
  providers?: InstalledHostProviderConfig;
  storage: InstalledHostStorageSummary;
  userId: string;
  writeback: InstalledHostWritebackConfig;
}

export interface UninstallHostInput {
  homeRoot?: string;
  host: InstalledHostKind;
}

export interface UninstallHostResult {
  changes: InstalledHostFileChange[];
  configPath: string;
  host: InstalledHostKind;
  installRoot: string;
}

export interface EnableHostWorkspaceInput {
  contextMode?: InstalledHostContextMode;
  homeRoot?: string;
  host: InstalledHostKind;
  mcpAllowWrite?: boolean;
  writebackMode?: InstalledHostWritebackMode;
  workspaceId?: string;
  workspaceRoot?: string;
}

export interface EnableHostWorkspaceResult {
  changes: InstalledHostFileChange[];
  configPath: string;
  host: InstalledHostKind;
  instructionPath: string;
  contextMode?: InstalledHostContextMode;
  writeback?: InstalledHostWritebackConfig;
  workspaceId: string;
  workspaceRoot: string;
}

export interface DisableHostWorkspaceInput {
  homeRoot?: string;
  host: InstalledHostKind;
  workspaceRoot?: string;
}

export interface DisableHostWorkspaceResult {
  changes: InstalledHostFileChange[];
  configPath: string;
  host: InstalledHostKind;
  instructionPath: string;
  workspaceRoot: string;
}

interface HostInstallBlueprint {
  configFileName: string;
  host: InstalledHostKind;
  instructionFileName: string;
  installMarker: {
    end: string;
    start: string;
  };
}

interface HostInstallConfigRecord {
  activationMode: InstalledHostActivationMode;
  contextMode: InstalledHostContextMode;
  debug: boolean;
  host: InstalledHostKind;
  language?: InstalledHostLanguageConfig;
  maintenance?: InstalledHostMaintenanceConfig;
  maxTokens: number;
  promptInjection?: InstalledHostPromptInjectionMode;
  providers?: InstalledHostProviderConfig;
  retrieval?: InstalledHostRetrievalConfig;
  retrievalProfile: "coding_agent" | "general_chat";
  sessionStartMaxTokens?: number;
  storage: HostInstallStorageConfigRecord;
  userId: string;
  version: 1;
  writeback: InstalledHostWritebackConfig;
}

interface WorkspaceOptInConfigRecord {
  contextMode?: InstalledHostContextMode;
  debug?: boolean;
  enabled: boolean;
  host: InstalledHostKind;
  maxTokens?: number;
  retrievalProfile?: "coding_agent" | "general_chat";
  version: 1;
  workspaceId: string;
}

const HOST_INSTALL_BLUEPRINTS: Record<InstalledHostKind, HostInstallBlueprint> = {
  codex: {
    configFileName: "codex.json",
    host: "codex",
    instructionFileName: "AGENTS.md",
    installMarker: {
      end: "<!-- GOODMEMORY-INSTALL:CODEX END -->",
      start: "<!-- GOODMEMORY-INSTALL:CODEX START -->",
    },
  },
  claude: {
    configFileName: "claude.json",
    host: "claude",
    instructionFileName: "CLAUDE.md",
    installMarker: {
      end: "<!-- GOODMEMORY-INSTALL:CLAUDE END -->",
      start: "<!-- GOODMEMORY-INSTALL:CLAUDE START -->",
    },
  },
};

const DEFAULT_MAX_TOKENS = DEFAULT_INSTALLED_HOST_MAX_TOKENS;
// Fresh-install injection budgets: the runtime fallback stays 256 (hand
// written configs unchanged), but new installs write explicit right-sized
// values — a once-per-session 1024-token brief and 512 per prompt behind the
// relevance gate.
const INSTALL_DEFAULT_MAX_TOKENS = 512;
const INSTALL_DEFAULT_SESSION_START_MAX_TOKENS = 1024;
const DEFAULT_RETRIEVAL_PROFILE = DEFAULT_INSTALLED_HOST_RETRIEVAL_PROFILE;
const PRIVATE_INSTALL_CONFIG_MODE = 0o600;
const PRIVATE_INSTALL_DIRECTORY_MODE = 0o700;

export type InstalledHostStorageProvider = "postgres" | "sqlite";

export type HostInstallStorageConfigRecord =
  | {
      path: string;
      provider: "sqlite";
    }
  | {
      provider: "postgres";
      url: string;
    };

export interface InstalledHostStorageSummary {
  location: string;
  provider: InstalledHostStorageProvider;
}

export async function installHost(
  input: InstallHostInput,
): Promise<InstallHostResult> {
  const blueprint = HOST_INSTALL_BLUEPRINTS[input.host];
  const installRoot = resolveInstallRoot(input.homeRoot);
  const configPath = join(installRoot, blueprint.configFileName);
  const storageUrl = normalizeInstallStorageUrl(input.storageUrl);
  const language = normalizeInstallLanguage(input.language);
  const managedSnapshots = await readManagedInstallSnapshots({
    configPath,
    homeRoot: input.homeRoot,
    host: input.host,
    installRoot,
  });
  validateInstallStorageInput({
    memoryPath: input.memoryPath,
    storageProvider: input.storageProvider,
    storageUrl,
  });
  const resolvedMemoryPath = resolveSQLiteMemoryPath(
    input.memoryPath ?? join(installRoot, "memory.sqlite"),
  );
  const nextConfig = await mergeInstallConfig({
    activationMode: input.activationMode,
    assistedExtractor: input.assistedExtractor,
    contextMode: input.contextMode,
    configPath,
    embedding: input.embedding,
    host: input.host,
    installRoot,
    language,
    memoryPath: resolvedMemoryPath,
    preferInputMemoryPath: input.memoryPath !== undefined,
    storageProvider: input.storageProvider,
    storageUrl,
    preferInputUserId: input.userId !== undefined,
    userId: resolveUserId(input.userId, input.homeRoot),
    writeback: input.writeback,
  });
  const storageSummary = summarizeInstallStorage(nextConfig.storage);

  try {
    const changes = mergeInstalledFileChanges([
      await writeManagedFile(
        configPath,
        installRoot,
        JSON.stringify(nextConfig, null, 2) + "\n",
        {
          directoryMode: PRIVATE_INSTALL_DIRECTORY_MODE,
          existingContent: managedSnapshots.config.content,
          mode: PRIVATE_INSTALL_CONFIG_MODE,
        },
      ),
      await registerInstalledHostMcp({
        homeRoot: input.homeRoot,
        host: input.host,
      }),
      ...(await registerInstalledHostHooks({
        homeRoot: input.homeRoot,
        host: input.host,
      })),
    ]);
  return {
    activationMode: nextConfig.activationMode,
    contextMode: nextConfig.contextMode,
    changes,
    configPath,
      host: input.host,
      installRoot,
      memoryPath: storageSummary.location,
      ...(nextConfig.providers ? { providers: nextConfig.providers } : {}),
      ...(nextConfig.language ? { language: nextConfig.language } : {}),
      storage: storageSummary,
      userId: nextConfig.userId,
      writeback: nextConfig.writeback,
    };
  } catch (error) {
    await restoreManagedInstallSnapshots(managedSnapshots);
    throw error;
  }
}

export async function uninstallHost(
  input: UninstallHostInput,
): Promise<UninstallHostResult> {
  const blueprint = HOST_INSTALL_BLUEPRINTS[input.host];
  const installRoot = resolveInstallRoot(input.homeRoot);
  const configPath = join(installRoot, blueprint.configFileName);
  const managedSnapshots = await readManagedInstallSnapshots({
    configPath,
    homeRoot: input.homeRoot,
    host: input.host,
    installRoot,
  });
  const existing = managedSnapshots.config.content;

  if (existing === null) {
    try {
      const changes = mergeInstalledFileChanges([
        {
          action: "unchanged",
          path: configPath,
          relativePath: relativeToRoot(configPath, installRoot),
        },
        ...(await unregisterInstalledHostHooks({
          homeRoot: input.homeRoot,
          host: input.host,
        })),
        await unregisterInstalledHostMcp({
          homeRoot: input.homeRoot,
          host: input.host,
        }),
      ]);
      return {
        changes,
        configPath,
        host: input.host,
        installRoot,
      };
    } catch (error) {
      await restoreManagedInstallSnapshots(managedSnapshots);
      throw error;
    }
  }

  try {
    await rm(configPath, { force: true });
    const changes = mergeInstalledFileChanges([
      {
        action: "deleted",
        path: configPath,
        relativePath: relativeToRoot(configPath, installRoot),
      },
      ...(await unregisterInstalledHostHooks({
        homeRoot: input.homeRoot,
        host: input.host,
      })),
      await unregisterInstalledHostMcp({
        homeRoot: input.homeRoot,
        host: input.host,
      }),
    ]);
    return {
      changes,
      configPath,
      host: input.host,
      installRoot,
    };
  } catch (error) {
    await restoreManagedInstallSnapshots(managedSnapshots);
    throw error;
  }
}

export async function enableHostWorkspace(
  input: EnableHostWorkspaceInput,
): Promise<EnableHostWorkspaceResult> {
  const blueprint = HOST_INSTALL_BLUEPRINTS[input.host];
  const workspaceRoot = resolve(input.workspaceRoot ?? ".");
  const installedConfig = await assertInstalledHostConfigExists({
    homeRoot: input.homeRoot,
    host: input.host,
  });
  const configPath = join(workspaceRoot, ".goodmemory", blueprint.configFileName);
  const instructionPath = join(workspaceRoot, blueprint.instructionFileName);
  const installRoot = resolveInstallRoot(input.homeRoot);
  const globalConfigPath = join(installRoot, blueprint.configFileName);
  const snapshots = {
    globalConfig: {
      content: await readFileIfPresent(globalConfigPath),
      path: globalConfigPath,
      root: installRoot,
    },
    instruction: {
      content: await readFileIfPresent(instructionPath),
      path: instructionPath,
      root: workspaceRoot,
    },
    workspaceConfig: {
      content: await readFileIfPresent(configPath),
      path: configPath,
      root: workspaceRoot,
    },
  };
  const nextConfig = await mergeWorkspaceConfig({
    configPath,
    contextMode: input.contextMode,
    host: input.host,
    preferInputWorkspaceId: input.workspaceId !== undefined,
    workspaceId: resolveWorkspaceId(workspaceRoot, input.workspaceId),
    workspaceRoot,
  });

  try {
    const workspaceConfigChange = await writeManagedFile(
      configPath,
      workspaceRoot,
      JSON.stringify(nextConfig, null, 2) + "\n",
    );
    const instructionChange = await writeMarkerManagedFile(
      instructionPath,
      workspaceRoot,
      blueprint.installMarker,
      buildInstallInstructionBlock(
        blueprint,
        installedConfig.language?.defaultLocale,
      ),
    );
    const writebackChange = input.writebackMode
      ? await updateInstalledHostWritebackMode({
          homeRoot: input.homeRoot,
          host: input.host,
          mode: input.writebackMode,
        })
      : null;
    const mcpChange =
      input.mcpAllowWrite === undefined
        ? null
        : await updateInstalledHostMcpAllowWrite({
            allowWrite: input.mcpAllowWrite,
            homeRoot: input.homeRoot,
            host: input.host,
          });

    return {
      changes: [
        workspaceConfigChange,
        instructionChange,
        ...(writebackChange ? [writebackChange.change] : []),
        ...(mcpChange ? [mcpChange] : []),
      ],
      configPath,
      host: input.host,
      instructionPath,
      ...(nextConfig.contextMode ? { contextMode: nextConfig.contextMode } : {}),
      ...(writebackChange ? { writeback: writebackChange.writeback } : {}),
      workspaceId: nextConfig.workspaceId,
      workspaceRoot,
    };
  } catch (error) {
    await restoreManagedFile(
      snapshots.instruction.path,
      snapshots.instruction.root,
      snapshots.instruction.content,
    );
    await restoreManagedFile(
      snapshots.workspaceConfig.path,
      snapshots.workspaceConfig.root,
      snapshots.workspaceConfig.content,
    );
    await restoreManagedFile(
      snapshots.globalConfig.path,
      snapshots.globalConfig.root,
      snapshots.globalConfig.content,
      {
        directoryMode: PRIVATE_INSTALL_DIRECTORY_MODE,
        mode: PRIVATE_INSTALL_CONFIG_MODE,
      },
    );
    throw error;
  }
}

export async function disableHostWorkspace(
  input: DisableHostWorkspaceInput,
): Promise<DisableHostWorkspaceResult> {
  const blueprint = HOST_INSTALL_BLUEPRINTS[input.host];
  const workspaceRoot = resolve(input.workspaceRoot ?? ".");
  const configPath = join(workspaceRoot, ".goodmemory", blueprint.configFileName);
  const instructionPath = join(workspaceRoot, blueprint.instructionFileName);
  const existingConfig = await readFileIfPresent(configPath);
  const shouldCreateDisableOverride =
    existingConfig === null
      ? await shouldWriteDisableOverrideForGlobalMode(input)
      : false;
  const configChange =
    existingConfig === null && !shouldCreateDisableOverride
      ? buildUnchangedFileChange(configPath, workspaceRoot)
      : await writeManagedFile(
          configPath,
          workspaceRoot,
          JSON.stringify(
            await mergeWorkspaceConfig({
              configPath,
              enabled: false,
              host: input.host,
              workspaceId: resolveWorkspaceId(workspaceRoot, undefined),
              workspaceRoot,
            }),
            null,
            2,
          ) + "\n",
        );

  return {
    changes: [
      configChange,
      await removeMarkerManagedFile(
        instructionPath,
        workspaceRoot,
        blueprint.installMarker,
      ),
    ],
    configPath,
    host: input.host,
    instructionPath,
    workspaceRoot,
  };
}

function resolveInstallRoot(homeRoot: string | undefined): string {
  const resolvedHome = resolve(
    homeRoot ?? process.env.GOODMEMORY_HOME ?? homedir(),
  );
  return join(resolvedHome, ".goodmemory");
}

function resolveSQLiteMemoryPath(path: string): string {
  return path === ":memory:" ? path : resolve(path);
}

function resolveUserId(
  userId: string | undefined,
  homeRoot: string | undefined,
): string {
  const normalized = userId?.trim();
  if (normalized && normalized.length > 0) {
    return normalized;
  }

  const envCandidates = [
    process.env.GOODMEMORY_DEFAULT_USER_ID,
    process.env.USER,
    process.env.LOGNAME,
    process.env.USERNAME,
  ];
  for (const candidate of envCandidates) {
    const trimmed = candidate?.trim();
    if (trimmed && trimmed.length > 0) {
      return trimmed;
    }
  }

  const base = basename(
    resolve(homeRoot ?? process.env.GOODMEMORY_HOME ?? homedir()),
  ).trim();
  return base.length > 0 ? base : "goodmemory-user";
}

async function assertInstalledHostConfigExists(input: {
  homeRoot?: string;
  host: InstalledHostKind;
}): Promise<InstalledHostRuntimeConfig> {
  const blueprint = HOST_INSTALL_BLUEPRINTS[input.host];
  const installRoot = resolveInstallRoot(input.homeRoot);
  const configPath = join(installRoot, blueprint.configFileName);
  const existing = await readFileIfPresent(configPath);

  if (existing === null || existing.trim().length === 0) {
    throw new Error(
      `Run 'goodmemory install ${input.host}' first to create ${configPath} before enabling this repository.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    throw buildInvalidManagedConfigError(
      relativeToRoot(configPath, installRoot),
      "file is not valid JSON",
    );
  }

  if (!isRecord(parsed)) {
    throw buildInvalidManagedConfigError(
      relativeToRoot(configPath, installRoot),
      "root value must be a JSON object",
    );
  }

  const validation = parseInstalledHostRuntimeConfig(parsed, input.host);
  if (validation.status !== "ok") {
    throw buildInvalidManagedConfigError(
      relativeToRoot(configPath, installRoot),
      validation.detail,
    );
  }
  return validation.config;
}

async function mergeInstallConfig(input: {
  activationMode?: InstalledHostActivationMode;
  assistedExtractor?: InstalledHostModelProviderConfig;
  configPath: string;
  contextMode?: InstalledHostContextMode;
  embedding?: InstalledHostEmbeddingProviderConfig;
  host: InstalledHostKind;
  installRoot: string;
  language?: InstalledHostLanguageConfig;
  memoryPath: string;
  preferInputMemoryPath: boolean;
  preferInputUserId: boolean;
  storageProvider?: InstalledHostStorageProvider;
  storageUrl?: string;
  userId: string;
  writeback?: InstalledHostWritebackConfig;
}): Promise<HostInstallConfigRecord> {
  const existing = await readFileIfPresent(input.configPath);

  if (existing === null || existing.trim().length === 0) {
    return {
      activationMode: input.activationMode ?? DEFAULT_INSTALLED_HOST_ACTIVATION_MODE,
      contextMode: input.contextMode ?? DEFAULT_INSTALLED_HOST_CONTEXT_MODE,
      debug: false,
      host: input.host,
      ...(input.language ? { language: input.language } : {}),
      maintenance: { auto: true },
      maxTokens: INSTALL_DEFAULT_MAX_TOKENS,
      promptInjection: "relevance_gated",
      sessionStartMaxTokens: INSTALL_DEFAULT_SESSION_START_MAX_TOKENS,
      ...mergeProviderConfig(undefined, {
        assistedExtractor: input.assistedExtractor,
        embedding: input.embedding,
      }),
      // Fresh stores start on the measured BM25 hybrid retrieval tier
      // (deterministic, zero egress, activates via the coding_agent hybrid
      // signal without any embedding). Written explicitly so reinstalls of
      // pre-existing configs never change behavior: the merge branch below
      // preserves whatever retrieval setting (or absence) is already there.
      retrieval: { bm25Ranking: true },
      retrievalProfile: DEFAULT_RETRIEVAL_PROFILE,
      storage: resolveInstallStorageConfig({
        memoryPath: input.memoryPath,
        storageProvider: input.storageProvider,
        storageUrl: input.storageUrl,
      }),
      userId: input.userId,
      version: 1,
      writeback: input.writeback ?? DEFAULT_INSTALLED_HOST_WRITEBACK,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    throw buildInvalidManagedConfigError(
      relativeToRoot(input.configPath, input.installRoot),
      "file is not valid JSON",
    );
  }

  if (!isRecord(parsed)) {
    throw buildInvalidManagedConfigError(
      relativeToRoot(input.configPath, input.installRoot),
      "root value must be a JSON object",
    );
  }

  if (parsed.host !== undefined && parsed.host !== input.host) {
    throw buildInvalidManagedConfigError(
      relativeToRoot(input.configPath, input.installRoot),
      "host value does not match the managed config target",
    );
  }

  const storage = isRecord(parsed.storage) ? parsed.storage : {};
  const maxTokens = readPositiveInteger(parsed.maxTokens) ?? DEFAULT_MAX_TOKENS;
  const debug = parsed.debug === true;
  const existingActivationMode =
    parsed.activationMode === "global" || parsed.activationMode === "workspace_opt_in"
      ? parsed.activationMode
      : DEFAULT_INSTALLED_HOST_ACTIVATION_MODE;
  if (parsed.contextMode !== undefined && readContextMode(parsed.contextMode) === undefined) {
    throw buildInvalidManagedConfigError(
      relativeToRoot(input.configPath, input.installRoot),
      "contextMode must be fragment or progressive",
    );
  }
  const existingContextMode =
    readContextMode(parsed.contextMode) ?? DEFAULT_INSTALLED_HOST_CONTEXT_MODE;
  const existingWriteback = normalizeInstalledHostWritebackConfig({
    legacyAutoLearn: parsed.autoLearn,
    value: parsed.writeback,
  });
  const retrievalProfile =
    readRetrievalProfile(parsed.retrievalProfile) ?? DEFAULT_RETRIEVAL_PROFILE;
  const providers = mergeProviderConfig(
    readExistingProviders(parsed.providers),
    {
      assistedExtractor: input.assistedExtractor,
      embedding: input.embedding,
    },
  ).providers;

  const {
    autoLearn: _legacyAutoLearn,
    writeback: _existingWriteback,
    ...rest
  } = parsed;

  return {
    ...rest,
    activationMode: input.activationMode ?? existingActivationMode,
    contextMode: input.contextMode ?? existingContextMode,
    debug,
    host: input.host,
    ...(input.language ? { language: input.language } : {}),
    maxTokens,
    providers,
    retrievalProfile,
    storage: resolveInstallStorageConfig({
      existingStorage: storage,
      memoryPath: input.memoryPath,
      preferInputMemoryPath: input.preferInputMemoryPath,
      storageProvider: input.storageProvider,
      storageUrl: input.storageUrl,
    }),
    userId:
      input.preferInputUserId ||
      !(typeof parsed.userId === "string" && parsed.userId.trim().length > 0)
        ? input.userId
        : parsed.userId,
    version: 1,
    writeback: input.writeback ?? existingWriteback,
  } as HostInstallConfigRecord;
}

function normalizeInstallLanguage(
  language: InstalledHostLanguageConfig | undefined,
): InstalledHostLanguageConfig | undefined {
  return language
    ? Object.freeze({
        defaultLocale: canonicalizeInstalledHostDefaultLocale(
          language.defaultLocale,
        ),
      })
    : undefined;
}

async function updateInstalledHostWritebackMode(input: {
  homeRoot?: string;
  host: InstalledHostKind;
  mode: InstalledHostWritebackMode;
}): Promise<{
  change: InstalledHostFileChange;
  writeback: InstalledHostWritebackConfig;
}> {
  const blueprint = HOST_INSTALL_BLUEPRINTS[input.host];
  const installRoot = resolveInstallRoot(input.homeRoot);
  const configPath = join(installRoot, blueprint.configFileName);
  const existing = await readFileIfPresent(configPath);
  if (existing === null || existing.trim().length === 0) {
    throw new Error(
      `Run 'goodmemory install ${input.host}' first to create ${configPath} before enabling writeback.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    throw buildInvalidManagedConfigError(
      relativeToRoot(configPath, installRoot),
      "file is not valid JSON",
    );
  }
  if (!isRecord(parsed)) {
    throw buildInvalidManagedConfigError(
      relativeToRoot(configPath, installRoot),
      "root value must be a JSON object",
    );
  }
  const validation = parseInstalledHostRuntimeConfig(parsed, input.host);
  if (validation.status !== "ok") {
    throw buildInvalidManagedConfigError(
      relativeToRoot(configPath, installRoot),
      validation.detail,
    );
  }

  const { autoLearn: _legacyAutoLearn, writeback: _existingWriteback, ...rest } = parsed;
  const writeback = {
    ...validation.config.writeback,
    mode: input.mode,
  };
  const nextConfig = {
    ...rest,
    host: input.host,
    version: 1,
    writeback,
  };

  return {
    change: await writeManagedFile(
      configPath,
      installRoot,
      JSON.stringify(nextConfig, null, 2) + "\n",
      {
        directoryMode: PRIVATE_INSTALL_DIRECTORY_MODE,
        existingContent: existing,
        mode: PRIVATE_INSTALL_CONFIG_MODE,
      },
    ),
    writeback,
  };
}

// Toggles the goodmemory_remember write-tool exposure in the managed global
// config. Mirrors updateInstalledHostWritebackMode: validate, then rewrite
// the file with only the mcp section changed. The MCP registration args
// stay untouched — the serve entrypoints read this at startup.
async function updateInstalledHostMcpAllowWrite(input: {
  allowWrite: boolean;
  homeRoot?: string;
  host: InstalledHostKind;
}): Promise<InstalledHostFileChange> {
  const blueprint = HOST_INSTALL_BLUEPRINTS[input.host];
  const installRoot = resolveInstallRoot(input.homeRoot);
  const configPath = join(installRoot, blueprint.configFileName);
  const existing = await readFileIfPresent(configPath);
  if (existing === null || existing.trim().length === 0) {
    throw new Error(
      `Run 'goodmemory install ${input.host}' first to create ${configPath} before enabling the MCP write tool.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    throw buildInvalidManagedConfigError(
      relativeToRoot(configPath, installRoot),
      "file is not valid JSON",
    );
  }
  if (!isRecord(parsed)) {
    throw buildInvalidManagedConfigError(
      relativeToRoot(configPath, installRoot),
      "root value must be a JSON object",
    );
  }
  const validation = parseInstalledHostRuntimeConfig(parsed, input.host);
  if (validation.status !== "ok") {
    throw buildInvalidManagedConfigError(
      relativeToRoot(configPath, installRoot),
      validation.detail,
    );
  }

  const nextConfig = {
    ...parsed,
    host: input.host,
    mcp: { allowWrite: input.allowWrite },
    version: 1,
  };

  return writeManagedFile(
    configPath,
    installRoot,
    JSON.stringify(nextConfig, null, 2) + "\n",
    {
      directoryMode: PRIVATE_INSTALL_DIRECTORY_MODE,
      existingContent: existing,
      mode: PRIVATE_INSTALL_CONFIG_MODE,
    },
  );
}

async function shouldWriteDisableOverrideForGlobalMode(
  input: DisableHostWorkspaceInput,
): Promise<boolean> {
  const blueprint = HOST_INSTALL_BLUEPRINTS[input.host];
  const installRoot = resolveInstallRoot(input.homeRoot);
  const configPath = join(installRoot, blueprint.configFileName);
  const existing = await readFileIfPresent(configPath);
  if (existing === null || existing.trim().length === 0) {
    return false;
  }

  try {
    const parsed = JSON.parse(existing) as unknown;
    const validation = parseInstalledHostRuntimeConfig(parsed, input.host);
    return validation.status === "ok" && validation.config.activationMode === "global";
  } catch {
    return false;
  }
}

function validateInstallStorageInput(input: {
  memoryPath?: string;
  storageProvider?: InstalledHostStorageProvider;
  storageUrl?: string;
}): void {
  const storageUrl = normalizeInstallStorageUrl(input.storageUrl);
  if (
    input.memoryPath &&
    (input.storageProvider !== undefined || input.storageUrl !== undefined)
  ) {
    throw new Error(
      "Use either --memory-path or --storage-provider/--storage-url, not both.",
    );
  }
  if (input.storageProvider === "postgres" && !storageUrl) {
    throw new Error("Postgres installed-host storage requires --storage-url.");
  }
  if (
    input.storageUrl !== undefined &&
    storageUrl !== undefined &&
    storageUrl.length === 0
  ) {
    throw new Error("Installed-host --storage-url must be a non-empty string.");
  }
  if (input.storageProvider === undefined && input.storageUrl !== undefined) {
    throw new Error(
      "Installed-host --storage-url requires --storage-provider <sqlite|postgres>.",
    );
  }
}

function normalizeInstallStorageUrl(
  value: string | undefined,
): string | undefined {
  return value === undefined ? undefined : value.trim();
}

function resolveInstallStorageConfig(input: {
  existingStorage?: Record<string, unknown>;
  memoryPath: string;
  preferInputMemoryPath?: boolean;
  storageProvider?: InstalledHostStorageProvider;
  storageUrl?: string;
}): HostInstallStorageConfigRecord {
  if (input.storageProvider === "postgres") {
    return {
      provider: "postgres",
      url: input.storageUrl!,
    };
  }
  if (input.storageProvider === "sqlite") {
    return {
      path: resolveSQLiteMemoryPath(input.storageUrl ?? input.memoryPath),
      provider: "sqlite",
    };
  }
  if (input.preferInputMemoryPath) {
    return {
      path: input.memoryPath,
      provider: "sqlite",
    };
  }

  const existingStorage = input.existingStorage;
  if (existingStorage?.provider === "postgres") {
    const url =
      typeof existingStorage.url === "string" &&
      existingStorage.url.trim().length > 0
        ? existingStorage.url.trim()
        : undefined;
    if (url) {
      return {
        provider: "postgres",
        url,
      };
    }
  }

  const existingPath =
    typeof existingStorage?.path === "string" &&
    existingStorage.path.trim().length > 0
      ? existingStorage.path.trim()
      : typeof existingStorage?.url === "string" &&
          existingStorage.url.trim().length > 0
        ? existingStorage.url.trim()
        : undefined;

  return {
    path: existingPath ?? input.memoryPath,
    provider: "sqlite",
  };
}

function summarizeInstallStorage(
  storage: HostInstallStorageConfigRecord,
): InstalledHostStorageSummary {
  return storage.provider === "postgres"
    ? {
        location: "configured",
        provider: "postgres",
      }
    : {
        location: storage.path,
        provider: "sqlite",
      };
}

function readExistingProviders(value: unknown): InstalledHostProviderConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const embedding = isProviderConfig(value.embedding)
    ? normalizeEmbeddingProviderConfig(value.embedding)
    : undefined;
  const assistedExtractor = isProviderConfig(value.assistedExtractor)
    ? normalizeModelProviderConfig(value.assistedExtractor)
    : undefined;
  const providers: InstalledHostProviderConfig = {
    ...(embedding ? { embedding } : {}),
    ...(assistedExtractor ? { assistedExtractor } : {}),
  };

  return Object.keys(providers).length > 0 ? providers : undefined;
}

function mergeProviderConfig(
  existing: InstalledHostProviderConfig | undefined,
  updates: {
    assistedExtractor?: InstalledHostModelProviderConfig;
    embedding?: InstalledHostEmbeddingProviderConfig;
  },
): { providers?: InstalledHostProviderConfig } {
  const providers: InstalledHostProviderConfig = {
    ...(existing ?? {}),
    ...(updates.embedding ? { embedding: updates.embedding } : {}),
    ...(updates.assistedExtractor
      ? { assistedExtractor: updates.assistedExtractor }
      : {}),
  };

  return Object.keys(providers).length > 0 ? { providers } : {};
}

function isProviderConfig(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

function normalizeModelProviderConfig(
  value: Record<string, unknown>,
): InstalledHostModelProviderConfig | undefined {
  const provider = value.provider;
  const model = typeof value.model === "string" ? value.model.trim() : "";
  const apiKey = typeof value.apiKey === "string" ? value.apiKey.trim() : "";
  const baseURL = typeof value.baseURL === "string" ? value.baseURL.trim() : "";

  if (
    (provider !== "openai" && provider !== "anthropic") ||
    model.length === 0 ||
    apiKey.length === 0
  ) {
    return undefined;
  }

  return {
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    model,
    provider,
  };
}

function normalizeEmbeddingProviderConfig(
  value: Record<string, unknown>,
): InstalledHostEmbeddingProviderConfig | undefined {
  const config = normalizeModelProviderConfig(value);
  if (!config || config.provider !== "openai") {
    return undefined;
  }

  return {
    ...config,
    provider: "openai",
  };
}

async function mergeWorkspaceConfig(input: {
  configPath: string;
  contextMode?: InstalledHostContextMode;
  enabled?: boolean;
  host: InstalledHostKind;
  preferInputWorkspaceId?: boolean;
  workspaceId: string;
  workspaceRoot: string;
}): Promise<WorkspaceOptInConfigRecord> {
  const existing = await readFileIfPresent(input.configPath);

  if (existing === null || existing.trim().length === 0) {
    return {
      enabled: input.enabled ?? true,
      host: input.host,
      ...(input.contextMode ? { contextMode: input.contextMode } : {}),
      version: 1,
      workspaceId: input.workspaceId,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    throw buildInvalidManagedConfigError(
      relativeToRoot(input.configPath, input.workspaceRoot),
      "file is not valid JSON",
    );
  }

  if (!isRecord(parsed)) {
    throw buildInvalidManagedConfigError(
      relativeToRoot(input.configPath, input.workspaceRoot),
      "root value must be a JSON object",
    );
  }

  if (parsed.host !== undefined && parsed.host !== input.host) {
    throw buildInvalidManagedConfigError(
      relativeToRoot(input.configPath, input.workspaceRoot),
      "host value does not match the managed config target",
    );
  }
  if (parsed.enabled !== undefined && typeof parsed.enabled !== "boolean") {
    throw buildInvalidManagedConfigError(
      relativeToRoot(input.configPath, input.workspaceRoot),
      "enabled must be a boolean",
    );
  }
  if (parsed.debug !== undefined && typeof parsed.debug !== "boolean") {
    throw buildInvalidManagedConfigError(
      relativeToRoot(input.configPath, input.workspaceRoot),
      "debug must be a boolean",
    );
  }
  const maxTokens = readPositiveInteger(parsed.maxTokens);
  const retrievalProfile = readRetrievalProfile(parsed.retrievalProfile);
  if (parsed.contextMode !== undefined && readContextMode(parsed.contextMode) === undefined) {
    throw buildInvalidManagedConfigError(
      relativeToRoot(input.configPath, input.workspaceRoot),
      "contextMode must be fragment or progressive",
    );
  }
  const contextMode = readContextMode(parsed.contextMode);

  return {
    ...parsed,
    ...(parsed.debug === undefined ? {} : { debug: parsed.debug === true }),
    enabled: input.enabled ?? true,
    host: input.host,
    contextMode: input.contextMode ?? contextMode,
    maxTokens,
    retrievalProfile,
    version: 1,
    workspaceId:
      input.preferInputWorkspaceId ||
      !(typeof parsed.workspaceId === "string" && parsed.workspaceId.trim().length > 0)
        ? input.workspaceId
        : parsed.workspaceId,
  } as WorkspaceOptInConfigRecord;
}

// The managed instruction block is the agent-facing memory protocol: it is
// what makes the host actually read injected context and use the MCP tools
// instead of re-deriving project facts every session. Markers stay stable so
// repair/enable can refresh the prose between them on existing repos.
function buildInstallInstructionBlock(
  blueprint: HostInstallBlueprint,
  defaultLocale?: string,
): string {
  const hostLabel = blueprint.host === "codex" ? "Codex" : "Claude Code";
  const language = createLanguageService({
    ...(defaultLocale ? { defaultLocale } : {}),
    detection: "default_only",
  });
  const context = language.resolveFromText({ text: "" });
  const render = (key: LanguageRenderKey): string =>
    language.render({ key, values: { host: hostLabel } }, context);
  return [
    `## GoodMemory ${hostLabel}`,
    "",
    render("installed_host_intro"),
    "",
    render("installed_host_protocol_heading"),
    `- ${render("installed_host_injected_context_protocol")}`,
    `- ${render("installed_host_context_tool_protocol")}`,
    `- ${render("installed_host_record_tools_protocol")}`,
    `- ${render("installed_host_remember_protocol")}`,
    `- ${render("installed_host_projection_protocol")}`,
    ...(blueprint.host === "claude"
      ? [
          "",
          render("installed_host_claude_memory_protocol"),
        ]
      : []),
  ].join("\n");
}

async function readFileIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function restoreManagedFile(
  path: string,
  root: string,
  content: string | null,
  options?: {
    directoryMode?: number;
    mode?: number;
  },
): Promise<void> {
  if (content === null) {
    await rm(path, { force: true });
    return;
  }

  await writeManagedFile(path, root, content, {
    ...options,
    existingContent: null,
  });
}

interface ManagedInstallFileSnapshot {
  content: string | null;
  path: string;
  root: string;
}

interface ManagedInstallSnapshots {
  config: ManagedInstallFileSnapshot;
  hooks: ManagedInstallFileSnapshot;
  mcp: ManagedInstallFileSnapshot;
}

async function readManagedInstallSnapshots(input: {
  configPath: string;
  homeRoot?: string;
  host: InstalledHostKind;
  installRoot: string;
}): Promise<ManagedInstallSnapshots> {
  const resolvedHomeRoot = resolve(
    input.homeRoot ?? process.env.GOODMEMORY_HOME ?? homedir(),
  );
  const mcpTarget = resolveInstalledHostMcpTargetPath(
    input.host,
    resolvedHomeRoot,
  );
  const hookTarget = resolveInstalledHostHookTargetPath(
    input.host,
    resolvedHomeRoot,
  );

  return {
    config: {
      content: await readFileIfPresent(input.configPath),
      path: input.configPath,
      root: input.installRoot,
    },
    hooks: {
      content: await readFileIfPresent(hookTarget.path),
      path: hookTarget.path,
      root: hookTarget.root,
    },
    mcp: {
      content: await readFileIfPresent(mcpTarget.path),
      path: mcpTarget.path,
      root: mcpTarget.root,
    },
  };
}

async function restoreManagedInstallSnapshots(
  snapshots: ManagedInstallSnapshots,
): Promise<void> {
  await restoreManagedFile(
    snapshots.hooks.path,
    snapshots.hooks.root,
    snapshots.hooks.content,
  );
  await restoreManagedFile(
    snapshots.mcp.path,
    snapshots.mcp.root,
    snapshots.mcp.content,
  );
  await restoreManagedFile(
    snapshots.config.path,
    snapshots.config.root,
    snapshots.config.content,
    {
      directoryMode: PRIVATE_INSTALL_DIRECTORY_MODE,
      mode: PRIVATE_INSTALL_CONFIG_MODE,
    },
  );
}

function mergeInstalledFileChanges(
  changes: InstalledHostFileChange[],
): InstalledHostFileChange[] {
  const merged = new Map<string, InstalledHostFileChange>();
  const order: string[] = [];

  for (const change of changes) {
    if (!merged.has(change.path)) {
      merged.set(change.path, change);
      order.push(change.path);
      continue;
    }

    const previous = merged.get(change.path)!;
    merged.set(change.path, {
      ...change,
      action: mergeInstalledFileAction(previous.action, change.action),
    });
  }

  return order.map((path) => merged.get(path)!);
}

function mergeInstalledFileAction(
  previous: InstalledHostFileChange["action"],
  next: InstalledHostFileChange["action"],
): InstalledHostFileChange["action"] {
  if (next === "unchanged") {
    return previous;
  }
  if (previous === "unchanged") {
    return next;
  }
  if (previous === "created" || next === "created") {
    return "created";
  }
  if (previous === "deleted" || next === "deleted") {
    return "deleted";
  }
  return next;
}
