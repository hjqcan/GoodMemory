import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { buildGoodMemoryCapabilityDescriptor } from "../api/capabilityDescriptor";
import { createGoodMemory } from "../api/createGoodMemory";
import { bootstrapHostWorkspace } from "../bootstrap/hostBootstrap";
import { executeInstalledHostAction } from "../install/hostActionRuntime";
import {
  codexRolloutSessionId,
  resolveLatestCodexRolloutPath,
} from "../install/hostCodexRollout";
import {
  DEFAULT_INSTALLED_HOST_ACTIVATION_MODE,
  DEFAULT_INSTALLED_HOST_CONTEXT_MODE,
  DEFAULT_INSTALLED_HOST_WRITEBACK,
  canonicalizeInstalledHostDefaultLocale,
  readContextMode,
  readWritebackMode,
} from "../install/hostConfigValidation";
import {
  createInstalledHostMemory,
  resolveInstalledHostContext,
} from "../install/hostExecutionContext";
import {
  inspectInstalledHostHookRegistration,
  isInstalledHostHookRegistered,
  isInstalledHostPreActionHookRegistered,
  registerInstalledHostHooks,
  resolveInstalledHostHookTargetPath,
} from "../install/hostHookConfig";
import { executeInstalledHostHook } from "../install/hostHookRuntime";
import { readInstalledHostInjectionEvents } from "../install/hostInjectionState";
import {
  disableHostWorkspace,
  enableHostWorkspace,
  installHost,
  uninstallHost,
} from "../install/hostInstall";
import {
  inspectInstalledHostMcpRegistration,
  isInstalledHostMcpRegistered,
  registerInstalledHostMcp,
  resolveInstalledHostMcpTargetPath,
} from "../install/hostMcpConfig";
import {
  readInstalledHostRuntimeConfig,
  resolveInstallRoot,
} from "../install/hostRuntimeConfig";
import {
  buildWritebackScopeDigest,
  readInstalledHostWritebackLedger,
} from "../install/hostWritebackAuditLedger";
import {
  forgetInstalledHostWritebackAuditEvent,
  inspectInstalledHostWritebackAudit,
} from "../install/hostWritebackAuditRuntime";
import { executeInstalledHostWriteback } from "../install/hostWritebackRuntime";
import { createInMemoryVectorStore } from "../storage/memory";
import {
  createPostgresDocumentStore,
  createPostgresSessionStore,
} from "../storage/postgres";
import {
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
} from "../storage/sqlite";

import type { GoodMemoryCapabilityOnboardingPath } from "../api/capabilityDescriptor";
import type { GoodMemory } from "../api/contracts";
import type { BootstrapHostKind } from "../bootstrap/hostBootstrap";
import type { MemoryScope } from "../domain/scope";
import type {
  InstalledHostActivationMode,
  InstalledHostContextMode,
  InstalledHostEmbeddingProviderConfig,
  InstalledHostLanguageConfig,
  InstalledHostModelProviderConfig,
  InstalledHostProviderConfig,
  InstalledHostRuntimeConfig,
  InstalledHostWritebackConfig,
  InstalledHostWritebackMode,
} from "../install/hostConfigValidation";
import type { InstalledHostResolvedContext } from "../install/hostExecutionContext";
import type { InstalledHostHookCommand } from "../install/hostHookRuntime";
import type {
  InstalledHostFileChange,
  InstalledHostKind,
  InstalledHostStorageProvider,
  InstallHostResult,
} from "../install/hostInstall";
import type { InstalledHostWritebackResult } from "../install/hostWritebackRuntime";

import type {
  CLICommandOutput,
  CLIInstallPrompt,
  CLIResult,
  CLIRunDependencies,
  CLIStorageConfig,
  InstallActivationSelection,
  ParsedFlags,
  ResolvedInstallOptions,
  SetupHostSelection,
} from "./contracts";
import {
  clipText,
  compareStrings,
  createDiagnosticMemory,
  describeStorageDisplayValue,
  flagEnabled,
  formatCountBreakdown,
  formatScope,
  isMissingFileError,
  pathExists,
  readNonNegativeIntegerFlag,
  renderOutput,
  requireFlag,
  requireInstalledHostKind,
  resolveStorageConfig,
} from "./shared";

export { requireInstalledHostKind } from "./shared";

interface FileSnapshot {
  content?: string;
  existed: boolean;
  mode?: number;
  path: string;
}
function renderBootstrapPayload(payload: {
  changes: Array<{
    action: "created" | "unchanged" | "updated";
    relativePath: string;
  }>;
  exportRootPath: string;
  host: BootstrapHostKind;
  instructionPath: string;
  scriptPath: string;
  workspaceId: string;
  workspaceRoot: string;
}): string {
  const hostLabel = payload.host === "codex" ? "Codex" : "Claude Code";
  const changeLines = payload.changes.map(
    (change) => `- ${change.relativePath} (${change.action})`,
  );

  return [
    `Bootstrapped ${hostLabel} workspace at ${payload.workspaceRoot}`,
    `- workspaceId: ${payload.workspaceId}`,
    `- instructions: ${payload.instructionPath}`,
    `- script: ${payload.scriptPath}`,
    `- export root: ${payload.exportRootPath}`,
    ...changeLines,
  ].join("\n");
}

function renderInstalledHostPayload(input: {
  actionLabel: "Disabled" | "Enabled" | "Installed" | "Uninstalled";
  payload: {
    activationMode?: string;
    changes: Array<{ action: string; relativePath: string }>;
    configPath?: string;
    host: string;
    instructionPath?: string;
    memoryPath?: string;
    providers?: {
      assistedExtractor: InstalledProviderStatus;
      embedding: InstalledProviderStatus;
    };
    storage?: {
      location: string;
      provider: string;
    };
    userId?: string;
    writeback?: InstalledHostWritebackConfig;
    workspaceRoot?: string;
    contextMode?: string;
  };
}): string {
  const hostLabel = input.payload.host === "codex" ? "Codex" : "Claude Code";
  const lines = [`${input.actionLabel} GoodMemory ${hostLabel} configuration`];

  for (const change of input.payload.changes) {
    lines.push(`- ${change.relativePath} (${change.action})`);
  }
  if (input.payload.configPath) {
    lines.push(`- config: ${input.payload.configPath}`);
  }
  if (input.payload.activationMode) {
    lines.push(`- activation: ${input.payload.activationMode}`);
  }
  if (input.payload.contextMode) {
    lines.push(`- context: ${input.payload.contextMode}`);
  }
  if (input.payload.writeback) {
    lines.push(`- writeback: ${input.payload.writeback.mode}`);
    lines.push(
      ...formatInstalledHostWritebackGuidance(
        input.payload.host,
        input.payload.writeback.mode,
        "- ",
      ),
    );
  }
  if (input.payload.storage) {
    lines.push(
      `- storage: ${input.payload.storage.provider} (${input.payload.storage.location})`,
    );
  }
  if (input.payload.instructionPath) {
    lines.push(`- instructions: ${input.payload.instructionPath}`);
  }
  if (input.payload.memoryPath) {
    lines.push(`- memory path: ${input.payload.memoryPath}`);
  }
  if (input.payload.userId) {
    lines.push(`- userId: ${input.payload.userId}`);
  }
  if (input.payload.workspaceRoot) {
    lines.push(`- workspace: ${input.payload.workspaceRoot}`);
  }
  if (input.payload.providers) {
    lines.push(
      `- embedding provider: ${formatInstalledProviderStatus(input.payload.providers.embedding)}`,
    );
    lines.push(
      `- LLM extraction provider: ${formatInstalledProviderStatus(input.payload.providers.assistedExtractor)}`,
    );
    if (
      !input.payload.providers.embedding.configured ||
      !input.payload.providers.assistedExtractor.configured
    ) {
      lines.push(
        `- provider setup: rerun install with --embedding-* / --llm-* flags or edit ${input.payload.configPath ?? "~/.goodmemory/<host>.json"}`,
      );
    }
  }

  return lines.join("\n");
}

function renderSetupPayload(payload: {
  hosts: Array<{
    activationMode: InstalledHostActivationMode;
    contextMode: InstalledHostContextMode;
    changes: Array<{ action: string; relativePath: string }>;
    host: InstalledHostKind;
    providers?: {
      assistedExtractor: InstalledProviderStatus;
      embedding: InstalledProviderStatus;
    };
    storage: { location: string; provider: string };
    writeback: InstalledHostWritebackConfig;
  }>;
}): string {
  const lines = ["GoodMemory setup complete"];
  for (const host of payload.hosts) {
    lines.push(
      `- ${host.host}: ${host.activationMode}, context=${host.contextMode}, writeback=${host.writeback.mode}, storage=${host.storage.provider}`,
    );
    lines.push(
      ...formatInstalledHostWritebackGuidance(
        host.host,
        host.writeback.mode,
        "  - ",
      ),
    );
    if (host.providers) {
      lines.push(
        `  - embedding provider: ${formatInstalledProviderStatus(host.providers.embedding)}`,
      );
      lines.push(
        `  - LLM extraction provider: ${formatInstalledProviderStatus(host.providers.assistedExtractor)}`,
      );
      if (
        !host.providers.embedding.configured ||
        !host.providers.assistedExtractor.configured
      ) {
        lines.push(
          "  - provider setup: rerun setup with --embedding-* / --llm-* flags or edit ~/.goodmemory/<host>.json",
        );
      }
    }
    for (const change of host.changes) {
      lines.push(`  - ${change.relativePath} (${change.action})`);
    }
  }
  lines.push("- status: run goodmemory status");

  return lines.join("\n");
}

function renderStatusPayload(payload: {
  hosts: Array<Record<string, unknown>>;
}): string {
  const lines = ["GoodMemory status"];
  for (const host of payload.hosts) {
    const hostName = String(host.host);
    lines.push(`- ${hostName}: ${String(host.workspaceStatus)}`);
    lines.push(`  - config: ${String(host.config)}`);
    lines.push(`  - activation: ${String(host.activationMode ?? "unknown")}`);
    lines.push(`  - context: ${String(host.contextMode ?? "unknown")}`);
    if (host.retrievalTier) {
      lines.push(`  - retrieval: ${String(host.retrievalTier)}`);
    }
    if (Array.isArray(host.sharedAgents) && host.sharedAgents.length > 0) {
      lines.push(`  - shared reads: ${host.sharedAgents.join(", ")}`);
    }
    if (host.injectionActivity) {
      const injection = host.injectionActivity as HostInjectionActivity;
      lines.push(
        `  - injection (last ${injection.total}): injected ${injection.injected}, gated ${injection.gated}, avg recall ${injection.avgRecallLatencyMs}ms`,
      );
    }
    const writeback = host.writeback as InstalledHostWritebackConfig | null;
    lines.push(
      `  - writeback: ${writeback?.mode ?? "off"}`,
    );
    lines.push(
      ...formatInstalledHostWritebackGuidance(
        hostName,
        writeback?.mode ?? "off",
        "  - ",
      ),
    );
    lines.push(`  - hook: ${host.hookRegistered ? "registered" : "missing"}`);
    if (hostName === "codex") {
      lines.push(
        `  - pre-action hook: ${host.preActionRegistered ? "registered" : "missing"}`,
      );
    }
    lines.push(`  - MCP: ${host.mcpRegistered ? "registered" : "missing"}`);
    if (host.memoryStatus) {
      lines.push(`  - memory: ${String(host.memoryStatus)}`);
    }
    if (host.scope) {
      lines.push(`  - scope: ${formatScope(host.scope as MemoryScope)}`);
    }
    if (host.counts) {
      const counts = host.counts as Record<string, number>;
      const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
      lines.push(`  - memories: ${total} (${formatCountBreakdown(counts) ?? "empty"})`);
    }
    lines.push(
      ...formatWritebackActivityLines(
        hostName,
        writeback?.mode ?? "off",
        host.writebackActivity as
          | {
              committedTotal: number;
              lastCapturedAt: string | null;
              lastSessionCaptured: number;
              recallHitEvents: number;
            }
          | undefined,
      ),
    );
  }

  return lines.join("\n");
}

function formatWritebackActivityLines(
  hostName: string,
  mode: string,
  activity:
    | {
        committedTotal: number;
        lastCapturedAt: string | null;
        lastSessionCaptured: number;
        recallHitEvents: number;
      }
    | undefined,
): string[] {
  if (mode === "off") {
    return [
      `  - capture: off — enable: goodmemory enable ${hostName} --writeback selective`,
    ];
  }
  if (!activity || activity.committedTotal === 0) {
    return [
      `  - captured: nothing yet — capture runs after each ${hostName} turn once sessions produce durable signals`,
    ];
  }

  const sessionNoun = activity.lastSessionCaptured === 1 ? "memory" : "memories";
  return [
    `  - captured: ${activity.lastSessionCaptured} ${sessionNoun} last session (${activity.recallHitEvents} recalled in later sessions), ${activity.committedTotal} total — inspect: goodmemory ${hostName} writeback inspect`,
  ];
}

function renderInstallerPlanPayload(
  title: string,
  payload: { hosts: InstallerHostPlan[] },
): string {
  const lines = [title];
  for (const host of payload.hosts) {
    lines.push(`- ${host.host}: config=${host.config}, workspace=${host.workspaceStatus}`);
    lines.push(
      `  - hooks: ${[
        `recall=${host.hookRegistered ? "registered" : "missing"}`,
        // Only codex registers a preAction hook; labelling it "missing" on
        // other hosts reads as a defect that does not exist.
        ...(host.host === "codex"
          ? [`preAction=${host.preActionRegistered ? "registered" : "missing"}`]
          : []),
        `mcp=${host.mcpRegistered ? "registered" : "missing"}`,
      ].join(", ")}`,
    );
    lines.push(`  - repairable: ${host.repairable}`);
    if (host.contextMode) {
      lines.push(`  - context: ${host.contextMode}`);
    }
    if (host.language) {
      lines.push(`  - language: ${host.language.defaultLocale}`);
    }
    if (host.writeback) {
      lines.push(`  - writeback: ${host.writeback.mode}`);
    }
    for (const warning of host.warnings) {
      lines.push(`  - warning: ${warning}`);
    }
    for (const command of host.nextCommands) {
      lines.push(`  - next: ${command}`);
    }
    for (const change of host.plannedChanges) {
      lines.push(`  - ${change.path} (${change.action}; ${change.reason})`);
    }
  }

  return lines.join("\n");
}

function renderInstallerRepairPayload(payload: {
  hosts: Array<
    | (ReturnType<typeof buildInstalledHostPayload> & {
        dryRun: boolean;
        nextCommands: string[];
        repairable: boolean;
        skipped: boolean;
        warnings: string[];
      })
    | (ReturnType<typeof buildRepairedHostPayload> & {
        dryRun: boolean;
        nextCommands: string[];
        repairable: boolean;
        skipped: boolean;
        warnings: string[];
      })
    | (InstallerHostPlan & {
        changes: Array<{
          action: InstalledHostFileChange["action"];
          path: string;
          relativePath: string;
        }>;
        skipped: boolean;
      })
  >;
}): string {
  const lines = ["GoodMemory repair complete"];
  for (const host of payload.hosts) {
    lines.push(`- ${host.host}: ${host.skipped ? "skipped" : "repaired"}`);
    if ("writeback" in host && host.writeback) {
      lines.push(`  - writeback: ${host.writeback.mode}`);
    }
    for (const warning of host.warnings) {
      lines.push(`  - warning: ${warning}`);
    }
    for (const command of host.nextCommands) {
      lines.push(`  - next: ${command}`);
    }
    for (const change of host.changes) {
      lines.push(`  - ${change.path} (${change.action})`);
    }
  }

  return lines.join("\n");
}

function formatInstalledHostWritebackGuidance(
  host: string,
  mode: InstalledHostWritebackMode,
  prefix: string,
): string[] {
  if (mode === "off") {
    return [
      `${prefix}writeback mode: recall-only; no after-response candidate extraction`,
      `${prefix}enable candidate review: goodmemory enable ${host} --writeback observe`,
    ];
  }
  if (mode === "observe") {
    return [
      `${prefix}writeback mode: candidate audit only; stores local bounded redacted previews, not raw transcripts or durable memory`,
      `${prefix}review candidates: goodmemory ${host} writeback inspect --json`,
      `${prefix}enable durable writes: goodmemory enable ${host} --writeback selective`,
    ];
  }
  if (mode === "review") {
    return [
      `${prefix}writeback mode: Inspector approval queue; stores local bounded redacted candidates, not raw transcripts or durable memory until approved`,
      `${prefix}review candidates: goodmemory inspector serve`,
      `${prefix}enable automatic durable writes: goodmemory enable ${host} --writeback selective`,
    ];
  }

  return [
    `${prefix}writeback mode: durable remember writeback through public remember()`,
    `${prefix}inspect or undo: goodmemory ${host} writeback inspect --json`,
  ];
}

function formatInstalledProviderStatus(status: InstalledProviderStatus): string {
  if (!status.configured) {
    return "not configured (rules-only/local fallback remains available)";
  }
  if (!status.provider || !status.model) {
    return "configured (provider details unavailable)";
  }

  const providerPrefix = `${status.provider}/`;
  const providerAndModel = status.model.startsWith(providerPrefix)
    ? status.model
    : `${status.provider} / ${status.model}`;

  return [
    providerAndModel,
    status.baseURLConfigured ? "custom base URL" : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" / ");
}

export function requireInstalledHostHookCommand(
  value: string | undefined,
): InstalledHostHookCommand {
  if (
    value === "pre-tool-use" ||
    value === "session-start" ||
    value === "session-stop" ||
    value === "user-prompt-submit"
  ) {
    return value;
  }

  throw new Error(
    `Unknown hook command: ${value ?? "(missing)"}. Use 'pre-tool-use', 'session-start', 'session-stop', or 'user-prompt-submit'.`,
  );
}

function readInstallStorageProviderFlag(
  value: string | undefined,
): InstalledHostStorageProvider | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "sqlite" || value === "postgres") {
    return value;
  }

  throw new Error(
    `Unsupported installed-host storage provider: ${value}. Expected sqlite|postgres.`,
  );
}

function readActivationModeFlag(
  value: string | undefined,
): InstalledHostActivationMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "global" || value === "workspace_opt_in") {
    return value;
  }

  throw new Error(
    `Unsupported installed-host activation mode: ${value}. Expected global|workspace_opt_in.`,
  );
}

function readContextModeFlag(
  value: string | undefined,
): InstalledHostContextMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  const contextMode = readContextMode(value);
  if (contextMode) {
    return contextMode;
  }

  throw new Error(
    `Unsupported installed-host context mode: ${value}. Expected fragment|progressive.`,
  );
}

function readInstallWritebackConfig(flags: ParsedFlags): InstalledHostWritebackConfig {
  const legacyAutoLearn = flagEnabled(flags, "auto-learn");
  const legacyNoAutoLearn = flagEnabled(flags, "no-auto-learn");
  if (legacyAutoLearn && legacyNoAutoLearn) {
    throw new Error("Use either --auto-learn or --no-auto-learn, not both.");
  }
  if (flags.writeback !== undefined && (legacyAutoLearn || legacyNoAutoLearn)) {
    throw new Error("Use --writeback instead of combining it with legacy auto-learn flags.");
  }

  if (flags.writeback !== undefined) {
    return buildWritebackConfig(readWritebackModeFlag(flags.writeback));
  }

  if (legacyAutoLearn || legacyNoAutoLearn) {
    return buildWritebackConfig(legacyAutoLearn ? "selective" : "off");
  }

  return DEFAULT_INSTALLED_HOST_WRITEBACK;
}

function readInstallWritebackConfigOverride(
  flags: ParsedFlags,
): InstalledHostWritebackConfig | undefined {
  if (
    flags.writeback !== undefined ||
    flagEnabled(flags, "auto-learn") ||
    flagEnabled(flags, "no-auto-learn")
  ) {
    return readInstallWritebackConfig(flags);
  }

  return undefined;
}

function buildWritebackConfig(
  mode: InstalledHostWritebackMode,
): InstalledHostWritebackConfig {
  return {
    ...DEFAULT_INSTALLED_HOST_WRITEBACK,
    mode,
  };
}

function readWritebackModeFlag(
  value: string | undefined,
): InstalledHostWritebackMode {
  const mode = readWritebackMode(value);
  if (!mode) {
    throw new Error(
      `Unsupported installed-host writeback mode: ${value ?? "(missing)"}. Expected off|observe|review|selective.`,
    );
  }

  return mode;
}

function readSetupHostSelection(
  value: string | undefined,
): SetupHostSelection | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "codex" || value === "claude" || value === "both") {
    return value;
  }

  throw new Error(
    `Unsupported setup host: ${value}. Expected codex|claude|both.`,
  );
}

function expandSetupHostSelection(selection: SetupHostSelection): InstalledHostKind[] {
  return selection === "both" ? ["codex", "claude"] : [selection];
}

export function readOptionalHostSelection(value: string | undefined): SetupHostSelection {
  return readSetupHostSelection(value) ?? "both";
}

async function detectSetupHostSelection(): Promise<SetupHostSelection> {
  const [codexAvailable, claudeAvailable] = await Promise.all([
    commandAvailable("codex"),
    commandAvailable("claude"),
  ]);
  if (codexAvailable && claudeAvailable) {
    return "both";
  }
  if (claudeAvailable) {
    return "claude";
  }

  return "codex";
}

async function commandAvailable(command: string): Promise<boolean> {
  const result = Bun.spawn({
    cmd: ["which", command],
    stderr: "ignore",
    stdout: "ignore",
  });
  return (await result.exited) === 0;
}

function readOptionalInstalledProviderConfig(input: {
  apiKeyFlag: string;
  baseUrlFlag: string;
  flags: ParsedFlags;
  modelFlag: string;
  providerFlag: string;
  providerLabel: string;
  supportedProviders: Array<InstalledHostModelProviderConfig["provider"]>;
}): InstalledHostModelProviderConfig | undefined {
  const rawProvider = input.flags[input.providerFlag];
  const rawModel = input.flags[input.modelFlag];
  const rawApiKey = input.flags[input.apiKeyFlag];
  const rawBaseURL = input.flags[input.baseUrlFlag];
  const provider = normalizeOptionalFlag(rawProvider);
  const model = normalizeOptionalFlag(rawModel);
  const apiKey = normalizeOptionalFlag(rawApiKey);
  const baseURL = normalizeOptionalFlag(rawBaseURL);
  const anyConfigured = [
    rawProvider,
    rawModel,
    rawApiKey,
    rawBaseURL,
  ].some((value) => value !== undefined);
  if (!anyConfigured) {
    return undefined;
  }

  if (!provider || !model || !apiKey) {
    const missingFlags = [
      provider ? null : `--${input.providerFlag}`,
      model ? null : `--${input.modelFlag}`,
      apiKey ? null : `--${input.apiKeyFlag}`,
    ].filter(Boolean) as string[];
    throw new Error(
      `Incomplete ${input.providerLabel} provider config. Missing ${missingFlags.join(", ")}.`,
    );
  }
  if (
    provider !== "openai" &&
    provider !== "anthropic"
  ) {
    throw new Error(
      `Unsupported ${input.providerLabel} provider: ${provider}. Expected ${input.supportedProviders.join("|")}.`,
    );
  }
  if (!input.supportedProviders.includes(provider)) {
    throw new Error(
      `Unsupported ${input.providerLabel} provider: ${provider}. Expected ${input.supportedProviders.join("|")}.`,
    );
  }

  return {
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    model,
    provider,
  };
}

function normalizeOptionalFlag(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readOptionalEmbeddingProviderConfig(
  flags: ParsedFlags,
): InstalledHostEmbeddingProviderConfig | undefined {
  const config = readOptionalInstalledProviderConfig({
    apiKeyFlag: "embedding-api-key",
    baseUrlFlag: "embedding-base-url",
    flags,
    modelFlag: "embedding-model",
    providerFlag: "embedding-provider",
    providerLabel: "embedding",
    supportedProviders: ["openai"],
  });
  if (!config) {
    return undefined;
  }

  return {
    ...config,
    provider: "openai",
  };
}

function readOptionalAssistedExtractorProviderConfig(
  flags: ParsedFlags,
): InstalledHostModelProviderConfig | undefined {
  return readOptionalInstalledProviderConfig({
    apiKeyFlag: "llm-api-key",
    baseUrlFlag: "llm-base-url",
    flags,
    modelFlag: "llm-model",
    providerFlag: "llm-provider",
    providerLabel: "LLM",
    supportedProviders: ["openai", "anthropic"],
  });
}

interface InstalledProviderStatus {
  baseURLConfigured?: boolean;
  configured: boolean;
  model?: string;
  provider?: "anthropic" | "openai";
}

function summarizeInstalledProviderStatus(
  provider: InstalledHostModelProviderConfig | undefined,
): InstalledProviderStatus {
  return provider
    ? {
        baseURLConfigured: Boolean(provider.baseURL),
        configured: true,
        model: provider.model,
        provider: provider.provider,
      }
    : {
        configured: false,
      };
}

function summarizeInstalledProviders(
  providers: InstalledHostProviderConfig | undefined,
): {
  assistedExtractor: InstalledProviderStatus;
  embedding: InstalledProviderStatus;
} {
  return {
    assistedExtractor: summarizeInstalledProviderStatus(
      providers?.assistedExtractor,
    ),
    embedding: summarizeInstalledProviderStatus(providers?.embedding),
  };
}

const EMBEDDING_INSTALL_FLAGS = [
  "embedding-api-key",
  "embedding-base-url",
  "embedding-model",
  "embedding-provider",
];
const LLM_INSTALL_FLAGS = [
  "llm-api-key",
  "llm-base-url",
  "llm-model",
  "llm-provider",
];

async function resolveInteractiveInstallFlags(
  host: InstalledHostKind,
  flags: ParsedFlags,
  dependencies: CLIRunDependencies = {},
): Promise<ResolvedInstallOptions> {
  const prompt = resolveInstallPrompt(flags, dependencies);
  if (!prompt) {
    return {
      flags,
      writeback: readInstallWritebackConfigOverride(flags),
    };
  }

  try {
    const resolvedFlags = { ...flags };
    const activationSelection = await promptInstallActivationSelection(
      resolvedFlags,
      prompt,
    );
    const configPathHint = `~/.goodmemory/${host}.json`;
    await promptOptionalFlag({
      flagName: "user-id",
      flags: resolvedFlags,
      message:
        "GoodMemory user id for this host install (leave empty to use the OS account)",
      prompt,
    });
    await promptInstallStorage(resolvedFlags, prompt);
    await promptEmbeddingInstallConfig(resolvedFlags, prompt, configPathHint);
    await promptAssistedExtractorInstallConfig(resolvedFlags, prompt, configPathHint);
    const writeback = await promptWritebackInstallConfig({
      flags: resolvedFlags,
      host,
      prompt,
    });

    return {
      activationSelection,
      flags: resolvedFlags,
      writeback,
    };
  } finally {
    await prompt.close?.();
  }
}

async function promptInstallActivationSelection(
  flags: ParsedFlags,
  prompt: CLIInstallPrompt,
): Promise<InstallActivationSelection> {
  const flagMode = readActivationModeFlag(flags["activation-mode"]);
  if (flagMode === "global") {
    return "global";
  }
  if (flagMode === "workspace_opt_in") {
    return "manual";
  }

  return (await askChoice({
    choices: ["global", "current-workspace", "manual"],
    defaultValue: "global",
    message:
      "Where should GoodMemory memory enhancement run? [global/current-workspace/manual]",
    prompt,
  })) as InstallActivationSelection;
}

async function promptWritebackInstallConfig(input: {
  flags: ParsedFlags;
  host: InstalledHostKind;
  prompt: CLIInstallPrompt;
}): Promise<InstalledHostWritebackConfig | undefined> {
  if (
    input.flags.writeback !== undefined ||
    flagEnabled(input.flags, "auto-learn") ||
    flagEnabled(input.flags, "no-auto-learn")
  ) {
    return readInstallWritebackConfig(input.flags);
  }

  const existing = await readInstalledHostRuntimeConfig(input.host, undefined, {});
  if (existing.status === "ok") {
    const mode = await askChoice({
      choices: ["keep-current", "off", "observe", "review", "selective"],
      defaultValue: "keep-current",
      message:
        `Installed-host writeback mode for ${input.host}? current=${existing.config.writeback.mode} [keep-current/off/observe/review/selective]`,
      prompt: input.prompt,
    });
    if (mode === "keep-current") {
      return undefined;
    }

    return buildWritebackConfig(mode as InstalledHostWritebackMode);
  }

  // Fresh installs recommend selective: it is the only mode that actually
  // accumulates durable memory, and every write stays auditable via
  // `writeback inspect` and reversible via `writeback forget`.
  const mode = await askChoice({
    choices: ["selective", "review", "observe", "off"],
    defaultValue: "selective",
    message: [
      `Auto-save durable memory from ${input.host} sessions?`,
      "  selective - save high-signal statements (auditable, reversible) [recommended]",
      "  review    - queue candidates for Inspector approval before saving",
      "  observe   - only log redacted candidates for review, write nothing",
      "  off       - recall only",
      "[selective/review/observe/off]",
    ].join("\n"),
    prompt: input.prompt,
  });

  return buildWritebackConfig(mode as InstalledHostWritebackMode);
}

function resolveInstallPrompt(
  flags: ParsedFlags,
  dependencies: CLIRunDependencies,
): CLIInstallPrompt | undefined {
  if (flagEnabled(flags, "interactive") && flagEnabled(flags, "no-interactive")) {
    throw new Error("Use either --interactive or --no-interactive, not both.");
  }
  if (flagEnabled(flags, "no-interactive")) {
    return undefined;
  }

  const shouldPrompt =
    flagEnabled(flags, "interactive") ||
    dependencies.interactive === true ||
    (dependencies.interactive !== false &&
      !flagEnabled(flags, "json") &&
      isProcessInteractive());
  if (!shouldPrompt) {
    return undefined;
  }

  const prompt = dependencies.prompt ?? createProcessInstallPrompt();
  if (!prompt) {
    throw new Error(
      "Interactive install requires a TTY. Re-run without --interactive for non-interactive mode, or pass provider flags directly.",
    );
  }

  return prompt;
}

function isProcessInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

function createProcessInstallPrompt(): CLIInstallPrompt | undefined {
  if (!isProcessInteractive()) {
    return undefined;
  }

  return {
    ask: askProcessLine,
    askSecret: askProcessSecret,
  };
}

async function askProcessLine(message: string): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    return await readline.question(message);
  } finally {
    readline.close();
  }
}

async function askProcessSecret(message: string): Promise<string> {
  if (typeof process.stdin.setRawMode !== "function") {
    return askProcessLine(message);
  }

  process.stderr.write(message);
  const wasRaw = process.stdin.isRaw === true;
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return await new Promise<string>((resolve, reject) => {
    let value = "";

    const cleanup = (): void => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(wasRaw);
      process.stderr.write("\n");
    };
    const onData = (chunk: Buffer): void => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Interactive install cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (char === "\u0008" || char === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }

        value += char;
      }
    };

    process.stdin.on("data", onData);
  });
}

async function promptOptionalFlag(input: {
  flagName: string;
  flags: ParsedFlags;
  message: string;
  prompt: CLIInstallPrompt;
}): Promise<void> {
  if (input.flags[input.flagName] !== undefined) {
    return;
  }

  const answer = await askPrompt(input.prompt, `${input.message}: `);
  if (answer) {
    input.flags[input.flagName] = answer;
  }
}

async function promptInstallStorage(
  flags: ParsedFlags,
  prompt: CLIInstallPrompt,
): Promise<void> {
  if (flags["memory-path"] !== undefined) {
    return;
  }

  const existingProvider = flags["storage-provider"];
  if (existingProvider !== undefined) {
    const provider = readInstallStorageProviderFlag(existingProvider);
    if (
      provider === "postgres" &&
      normalizeOptionalFlag(flags["storage-url"]) === undefined
    ) {
      const storageUrl = await askPrompt(
        prompt,
        "Postgres connection string for GoodMemory storage (leave empty to skip Postgres for now): ",
      );
      if (storageUrl) {
        flags["storage-url"] = storageUrl;
      } else {
        clearInstallStorageFlags(flags);
      }
    }
    return;
  }

  const choice = await askChoice({
    choices: ["sqlite", "postgres", "skip"],
    defaultValue: "sqlite",
    message:
      "Storage provider for GoodMemory host memory [sqlite/postgres/skip]",
    prompt,
  });
  if (choice === "skip") {
    return;
  }
  if (choice === "sqlite") {
    flags["storage-provider"] = "sqlite";
    return;
  }

  const storageUrl = await askPrompt(
    prompt,
    "Postgres connection string for GoodMemory storage (leave empty to skip Postgres for now): ",
  );
  if (storageUrl) {
    flags["storage-provider"] = "postgres";
    flags["storage-url"] = storageUrl;
  }
}

function clearInstallStorageFlags(flags: ParsedFlags): void {
  delete flags["storage-provider"];
  delete flags["storage-url"];
}

async function promptEmbeddingInstallConfig(
  flags: ParsedFlags,
  prompt: CLIInstallPrompt,
  configPathHint: string,
): Promise<void> {
  const requestedByFlags = hasAnyFlag(flags, EMBEDDING_INSTALL_FLAGS);
  if (!requestedByFlags) {
    const shouldConfigure = await askYesNo({
      defaultValue: false,
      message: "Embedding provider improves semantic recall. Configure OpenAI embeddings now?",
      prompt,
    });
    if (!shouldConfigure) {
      return;
    }
    flags["embedding-provider"] = "openai";
  } else if (flags["embedding-provider"] === undefined) {
    flags["embedding-provider"] = "openai";
  }

  await promptOptionalFlag({
    flagName: "embedding-model",
    flags,
    message:
      "Embedding model (for example text-embedding-3-small; leave empty to skip embeddings)",
    prompt,
  });
  await promptOptionalSecretFlag({
    flagName: "embedding-api-key",
    flags,
    message:
      `Embedding API key (stored in ${configPathHint}; leave empty to skip embeddings)`,
    prompt,
  });
  await promptOptionalFlag({
    flagName: "embedding-base-url",
    flags,
    message: "Embedding base URL (optional, leave empty for provider default)",
    prompt,
  });
  clearProviderFlagsIfRequiredValuesMissing(flags, EMBEDDING_INSTALL_FLAGS, [
    "embedding-api-key",
    "embedding-model",
    "embedding-provider",
  ]);
}

async function promptAssistedExtractorInstallConfig(
  flags: ParsedFlags,
  prompt: CLIInstallPrompt,
  configPathHint: string,
): Promise<void> {
  const requestedByFlags = hasAnyFlag(flags, LLM_INSTALL_FLAGS);
  if (!requestedByFlags) {
    const shouldConfigure = await askYesNo({
      defaultValue: false,
      message:
        "LLM extraction provider improves memory writes. Configure LLM extraction now?",
      prompt,
    });
    if (!shouldConfigure) {
      return;
    }
  }

  if (flags["llm-provider"] === undefined) {
    flags["llm-provider"] = await askChoice({
      choices: ["openai", "anthropic"],
      defaultValue: "openai",
      message: "LLM extraction provider [openai/anthropic]",
      prompt,
    });
  }
  await promptOptionalFlag({
    flagName: "llm-model",
    flags,
    message:
      "LLM extraction model (required; leave empty to skip LLM extraction)",
    prompt,
  });
  await promptOptionalSecretFlag({
    flagName: "llm-api-key",
    flags,
    message:
      `LLM API key (stored in ${configPathHint}; leave empty to skip LLM extraction)`,
    prompt,
  });
  await promptOptionalFlag({
    flagName: "llm-base-url",
    flags,
    message: "LLM base URL (optional, leave empty for provider default)",
    prompt,
  });
  clearProviderFlagsIfRequiredValuesMissing(flags, LLM_INSTALL_FLAGS, [
    "llm-api-key",
    "llm-model",
    "llm-provider",
  ]);
}

async function promptOptionalSecretFlag(input: {
  flagName: string;
  flags: ParsedFlags;
  message: string;
  prompt: CLIInstallPrompt;
}): Promise<void> {
  if (input.flags[input.flagName] !== undefined) {
    return;
  }

  const answer = await askSecretPrompt(input.prompt, `${input.message}: `);
  if (answer) {
    input.flags[input.flagName] = answer;
  }
}

async function askPrompt(
  prompt: CLIInstallPrompt,
  message: string,
): Promise<string | undefined> {
  const answer = (await prompt.ask(message)).trim();
  return answer.length > 0 ? answer : undefined;
}

async function askSecretPrompt(
  prompt: CLIInstallPrompt,
  message: string,
): Promise<string | undefined> {
  const answer = (await (prompt.askSecret ?? prompt.ask)(message)).trim();
  return answer.length > 0 ? answer : undefined;
}

async function askChoice(input: {
  choices: string[];
  defaultValue: string;
  message: string;
  prompt: CLIInstallPrompt;
}): Promise<string> {
  const answer =
    (await askPrompt(input.prompt, `${input.message} (${input.defaultValue}): `)) ??
    input.defaultValue;
  const normalized = answer.toLowerCase();
  if (!input.choices.includes(normalized)) {
    throw new Error(
      `Unsupported install prompt answer: ${answer}. Expected ${input.choices.join("|")}.`,
    );
  }

  return normalized;
}

async function askYesNo(input: {
  defaultValue: boolean;
  message: string;
  prompt: CLIInstallPrompt;
}): Promise<boolean> {
  const suffix = input.defaultValue ? "[Y/n]" : "[y/N]";
  const answer = await askPrompt(input.prompt, `${input.message} ${suffix}: `);
  if (answer === undefined) {
    return input.defaultValue;
  }

  const normalized = answer.toLowerCase();
  if (normalized === "y" || normalized === "yes") {
    return true;
  }
  if (
    normalized === "n" ||
    normalized === "no" ||
    normalized === "skip" ||
    normalized === "later"
  ) {
    return false;
  }

  throw new Error(`Unsupported yes/no answer: ${answer}. Expected yes|no.`);
}

function hasAnyFlag(flags: ParsedFlags, names: string[]): boolean {
  return names.some((name) => flags[name] !== undefined);
}

function clearProviderFlagsIfRequiredValuesMissing(
  flags: ParsedFlags,
  allFlagNames: string[],
  requiredFlagNames: string[],
): void {
  const hasRequiredValues = requiredFlagNames.every(
    (name) => normalizeOptionalFlag(flags[name]) !== undefined,
  );
  if (hasRequiredValues) {
    return;
  }

  for (const name of allFlagNames) {
    delete flags[name];
  }
}

async function handleHostBootstrap(
  host: BootstrapHostKind,
  flags: ParsedFlags,
): Promise<CLICommandOutput> {
  const result = await bootstrapHostWorkspace({
    host,
    userId: requireFlag(flags, "user-id"),
    workspaceId: flags["workspace-id"],
    workspaceRoot: flags["workspace-root"],
  });
  const payload = {
    changes: result.changes.map((change) => ({
      action: change.action,
      path: change.path,
      relativePath: change.relativePath,
    })),
    exportRootPath: result.exportRootPath,
    host: result.host,
    instructionPath: result.instructionPath,
    scriptPath: result.scriptPath,
    userId: result.userId,
    workspaceId: result.workspaceId,
    workspaceRoot: result.workspaceRoot,
  };

  return {
    json: payload,
    text: renderBootstrapPayload(payload),
  };
}

async function handleHostInstall(
  host: InstalledHostKind,
  flags: ParsedFlags,
  dependencies: CLIRunDependencies = {},
): Promise<CLICommandOutput> {
  const installOptions = await resolveInteractiveInstallFlags(host, flags, dependencies);
  const installFlags = installOptions.flags;
  const workspaceRoot =
    installOptions.activationSelection === "current-workspace"
      ? resolve(installFlags["workspace-root"] ?? ".")
      : undefined;

  if (flagEnabled(installFlags, "dry-run")) {
    const activationMode =
      installOptions.activationSelection === "global"
        ? "global"
        : readActivationModeFlag(installFlags["activation-mode"]) ?? "workspace_opt_in";
    const payload = {
      dryRun: true,
      hosts: [
        await buildInstallerHostPlan({
          host,
          mode: "install",
          requested: buildInstallerRequestedOptions({
            activationMode,
            flags: installFlags,
            writeback: installOptions.writeback,
          }),
          workspaceRoot,
        }),
      ],
    };

    return {
      json: payload,
      text: renderInstallerPlanPayload("GoodMemory install dry-run", payload),
    };
  }

  return withManagedFileTransaction(
    resolveHostMutationPaths([
      {
        host,
        workspaceRoot,
      },
    ]),
    async () => {
      const activationMode =
        installOptions.activationSelection === "global"
          ? "global"
          : readActivationModeFlag(installFlags["activation-mode"]) ?? "workspace_opt_in";
      const result = await installHost({
        activationMode,
        assistedExtractor: readOptionalAssistedExtractorProviderConfig(installFlags),
        contextMode: readContextModeFlag(installFlags["context-mode"]),
        embedding: readOptionalEmbeddingProviderConfig(installFlags),
        host,
        language: readInstallLanguageConfig(installFlags),
        memoryPath: installFlags["memory-path"],
        storageProvider: readInstallStorageProviderFlag(installFlags["storage-provider"]),
        storageUrl: installFlags["storage-url"],
        userId: installFlags["user-id"],
        writeback: installOptions.writeback,
      });
      const workspaceEnableResult =
        installOptions.activationSelection === "current-workspace"
          ? await enableHostWorkspace({
              contextMode: readContextModeFlag(installFlags["context-mode"]),
              host,
              workspaceId: installFlags["workspace-id"],
              workspaceRoot: installFlags["workspace-root"],
            })
          : null;
      const providerSummary = summarizeInstalledProviders(result.providers);
      const payload = {
        activationMode: result.activationMode,
        changes: [
          ...result.changes,
          ...(workspaceEnableResult?.changes ?? []),
        ].map((change) => ({
          action: change.action,
          path: change.path,
          relativePath: change.relativePath,
        })),
        configPath: result.configPath,
        contextMode: result.contextMode,
        host: result.host,
        installRoot: result.installRoot,
        ...(result.storage.provider === "sqlite" ? { memoryPath: result.memoryPath } : {}),
        providers: providerSummary,
        ...(result.language ? { language: result.language } : {}),
        storage: result.storage,
        userId: result.userId,
        writeback: result.writeback,
        ...(workspaceEnableResult
          ? {
              instructionPath: workspaceEnableResult.instructionPath,
              workspaceRoot: workspaceEnableResult.workspaceRoot,
            }
          : {}),
      };

      return {
        json: payload,
        text: renderInstalledHostPayload({
          actionLabel: "Installed",
          payload,
        }),
      };
    },
  );
}

const RECOMMENDED_SETUP_COMMITMENTS = [
  "GoodMemory recommended setup will:",
  "  - activate memory globally (hooks inject a session brief and per-prompt context in every workspace)",
  "  - enable selective writeback: durable memory extracted from your sessions after each turn, auditable and reversible",
  "  - never persist raw transcripts; secret-like content is redacted; assistant output stays non-durable unless explicitly confirmed",
  "  - review captures: goodmemory <host> writeback inspect · undo: goodmemory <host> writeback forget --event-id <id> · turn off: goodmemory enable <host> --writeback off",
].join("\n");

interface AdoptHostState {
  host: InstalledHostKind;
  hookRegistered: boolean;
  mcpRegistered: boolean;
  wired: boolean;
}

interface AdoptPlan {
  version: string;
  environment: {
    codexCliAvailable: boolean;
    claudeCliAvailable: boolean;
    forcedHost: InstalledHostKind | null;
    homeRoot: string;
    installedHosts: AdoptHostState[];
  };
  recommended: {
    path: "installed-host" | "standalone-mcp";
    reason: string;
    alreadyWired: boolean;
    command: string;
    next: string[];
  };
  paths: readonly GoodMemoryCapabilityOnboardingPath[];
  resources: {
    llmsTxt: string;
    capabilityDescriptor: string;
    readme: string;
  };
}

async function inspectAdoptHost(
  host: InstalledHostKind,
): Promise<AdoptHostState> {
  const [hookRegistered, mcpRegistered] = await Promise.all([
    isInstalledHostHookRegistered({ host }),
    isInstalledHostMcpRegistered({ host }),
  ]);
  return {
    host,
    hookRegistered,
    mcpRegistered,
    wired: hookRegistered || mcpRegistered,
  };
}

function renderAdoptText(plan: AdoptPlan): string {
  const yesNo = (value: boolean): string => (value ? "yes" : "no");
  const wired = plan.environment.installedHosts
    .filter((state) => state.wired)
    .map((state) => state.host);
  const lines: string[] = [
    "GoodMemory adopt — environment scan",
    "",
    "Detected",
    `  Codex CLI:  ${yesNo(plan.environment.codexCliAvailable)}`,
    `  Claude CLI: ${yesNo(plan.environment.claudeCliAvailable)}`,
    `  Wired hosts: ${wired.length > 0 ? wired.join(", ") : "none"}`,
    "",
    `Recommended path: ${plan.recommended.path}`,
    `  ${plan.recommended.reason}`,
    `  Run: ${plan.recommended.command}`,
    "",
    "All onboarding paths",
  ];
  plan.paths.forEach((path, index) => {
    lines.push(`  ${index + 1}. ${path.audience} (${path.method}) — ${path.when}`);
  });
  lines.push(
    "",
    "Machine-readable",
    `  llms.txt:   ${plan.resources.llmsTxt}`,
    `  descriptor: ${plan.resources.capabilityDescriptor}`,
  );
  return `${lines.join("\n")}\n`;
}

// Read-only onboarding advisor: detect what this environment is and print the
// single path an adopting agent should take, or a machine-readable plan with
// `--json`. It never mutates host config — the recommended command (e.g.
// `goodmemory setup`) is left for the operator/agent to run deliberately.
async function handleAdopt(
  flags: ParsedFlags,
  dependencies: CLIRunDependencies = {},
): Promise<CLICommandOutput> {
  const probe = dependencies.commandAvailable ?? commandAvailable;
  const forcedHost =
    flags.host === undefined ? undefined : requireInstalledHostKind(flags.host);

  const [codexCliAvailable, claudeCliAvailable] = await Promise.all([
    probe("codex"),
    probe("claude"),
  ]);

  const installedHosts = await Promise.all(
    (["codex", "claude"] as InstalledHostKind[]).map(inspectAdoptHost),
  );
  const wiredHosts = installedHosts.filter((state) => state.wired);
  const relevantWiredHosts = forcedHost
    ? wiredHosts.filter((state) => state.host === forcedHost)
    : wiredHosts;

  const availableHosts: InstalledHostKind[] = forcedHost
    ? [forcedHost]
    : [
        ...(codexCliAvailable ? (["codex"] as InstalledHostKind[]) : []),
        ...(claudeCliAvailable ? (["claude"] as InstalledHostKind[]) : []),
      ];

  const descriptor = buildGoodMemoryCapabilityDescriptor();

  let recommended: AdoptPlan["recommended"];
  if (relevantWiredHosts.length > 0) {
    const primaryWired =
      (forcedHost
        ? relevantWiredHosts.find((state) => state.host === forcedHost)
        : undefined) ?? relevantWiredHosts[0]!;
    recommended = {
      path: "installed-host",
      alreadyWired: true,
      reason: `GoodMemory is already wired into ${relevantWiredHosts
        .map((state) => state.host)
        .join(" + ")}. Verify it instead of reinstalling.`,
      command: `goodmemory status ${primaryWired.host}`,
      next: [
        `goodmemory status ${primaryWired.host}`,
        `goodmemory doctor --host ${primaryWired.host}`,
      ],
    };
  } else if (availableHosts.length > 0) {
    const hostArg =
      availableHosts.length === 1 ? ` --host ${availableHosts[0]}` : "";
    const command = `goodmemory setup${hostArg}`;
    recommended = {
      path: "installed-host",
      alreadyWired: false,
      reason: `Detected ${availableHosts.join(
        " + ",
      )}. Install managed host memory; recall injection and opt-in writeback wire automatically.`,
      command,
      next: [command, "goodmemory status"],
    };
  } else {
    const command = `${descriptor.mcp.command} ${descriptor.mcp.standaloneArgs.join(
      " ",
    )}`;
    recommended = {
      path: "standalone-mcp",
      alreadyWired: false,
      reason:
        "No Codex or Claude CLI detected. Use the standalone MCP server (any MCP client) or the HTTP bridge (framework agents and backends).",
      command,
      next: [
        command,
        "or self-host the HTTP bridge: goodmemory-http-bridge --recommended",
      ],
    };
  }

  const plan: AdoptPlan = {
    version: descriptor.version,
    environment: {
      codexCliAvailable,
      claudeCliAvailable,
      forcedHost: forcedHost ?? null,
      homeRoot: process.env.GOODMEMORY_HOME ?? homedir(),
      installedHosts,
    },
    recommended,
    paths: descriptor.onboarding,
    resources: {
      llmsTxt: descriptor.documentation.llmsTxt,
      capabilityDescriptor: `${descriptor.repository}/blob/main/.well-known/goodmemory.json`,
      readme: descriptor.documentation.readme,
    },
  };

  return { json: plan, text: renderAdoptText(plan) };
}

async function handleSetup(
  flags: ParsedFlags,
  dependencies: CLIRunDependencies = {},
): Promise<CLICommandOutput> {
  if (flagEnabled(flags, "recommended")) {
    return handleRecommendedSetup(flags, dependencies);
  }
  const setup = await resolveSetupOptions(flags, dependencies);
  const workspaceRoot =
    setup.activationSelection === "current-workspace"
      ? resolve(setup.flags["workspace-root"] ?? ".")
      : undefined;

  if (flagEnabled(setup.flags, "dry-run")) {
    const payload = {
      dryRun: true,
      hosts: await Promise.all(
        setup.hosts.map((host) => {
          const activationMode =
            setup.activationSelection === "global" ? "global" : "workspace_opt_in";
          return buildInstallerHostPlan({
            host,
            mode: "install",
            requested: buildInstallerRequestedOptions({
              activationMode,
              flags: setup.flags,
              writeback: setup.writebackByHost[host],
            }),
            workspaceRoot,
          });
        }),
      ),
    };

    return {
      json: payload,
      text: renderInstallerPlanPayload("GoodMemory setup dry-run", payload),
    };
  }

  return withManagedFileTransaction(
    resolveHostMutationPaths(
      setup.hosts.map((host) => ({
        host,
        workspaceRoot,
      })),
    ),
    async () => {
      const installPayloads = [];

      for (const host of setup.hosts) {
        const activationMode =
          setup.activationSelection === "global" ? "global" : "workspace_opt_in";
        const result = await installHost({
          activationMode,
          assistedExtractor: readOptionalAssistedExtractorProviderConfig(setup.flags),
          contextMode: readContextModeFlag(setup.flags["context-mode"]),
          embedding: readOptionalEmbeddingProviderConfig(setup.flags),
          host,
          language: readInstallLanguageConfig(setup.flags),
          memoryPath: setup.flags["memory-path"],
          storageProvider: readInstallStorageProviderFlag(setup.flags["storage-provider"]),
          storageUrl: setup.flags["storage-url"],
          userId: setup.flags["user-id"],
          writeback: setup.writebackByHost[host],
        });
        const workspaceEnableResult =
          setup.activationSelection === "current-workspace"
            ? await enableHostWorkspace({
                contextMode: readContextModeFlag(setup.flags["context-mode"]),
                host,
                workspaceId: setup.flags["workspace-id"],
                workspaceRoot: setup.flags["workspace-root"],
              })
            : null;
        installPayloads.push(buildInstalledHostPayload(result, workspaceEnableResult));
      }

      const payload = {
        hosts: installPayloads,
      };

      return {
        json: payload,
        text: renderSetupPayload(payload),
      };
    },
  );
}

async function withManagedFileTransaction<T>(
  paths: string[],
  callback: () => Promise<T>,
): Promise<T> {
  const snapshots = await captureFileSnapshots(paths);

  try {
    return await callback();
  } catch (error) {
    try {
      await restoreFileSnapshots(snapshots);
    } catch (restoreError) {
      const primary = error instanceof Error ? error.message : String(error);
      const rollback =
        restoreError instanceof Error ? restoreError.message : String(restoreError);
      throw new Error(
        `GoodMemory CLI command failed and rollback was incomplete.\nPrimary error: ${primary}\nRollback error: ${rollback}`,
      );
    }
    throw error;
  }
}

async function captureFileSnapshots(paths: string[]): Promise<FileSnapshot[]> {
  const uniquePaths = [...new Set(paths)];
  return Promise.all(uniquePaths.map((path) => captureFileSnapshot(path)));
}

async function captureFileSnapshot(path: string): Promise<FileSnapshot> {
  try {
    const [content, details] = await Promise.all([
      readFile(path, "utf8"),
      stat(path),
    ]);
    return {
      content,
      existed: true,
      mode: details.mode & 0o777,
      path,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        existed: false,
        path,
      };
    }
    throw error;
  }
}

async function restoreFileSnapshots(snapshots: FileSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    if (!snapshot.existed) {
      await rm(snapshot.path, { force: true });
      continue;
    }

    await mkdir(dirname(snapshot.path), { recursive: true });
    await writeFile(snapshot.path, snapshot.content ?? "", "utf8");
    if (snapshot.mode !== undefined) {
      await chmod(snapshot.path, snapshot.mode);
    }
  }
}

function resolveHostMutationPaths(
  inputs: Array<{ host: InstalledHostKind; workspaceRoot?: string }>,
): string[] {
  const installRoot = resolveInstallRoot(undefined);
  const homeRoot = dirname(installRoot);
  const paths = inputs.flatMap((input) => {
    const basePaths = [
      join(installRoot, `${input.host}.json`),
      resolveInstalledHostHookTargetPath(input.host, homeRoot).path,
      resolveInstalledHostMcpTargetPath(input.host, homeRoot).path,
    ];

    if (!input.workspaceRoot) {
      return basePaths;
    }

    return [
      ...basePaths,
      join(input.workspaceRoot, ".goodmemory", `${input.host}.json`),
      join(
        input.workspaceRoot,
        input.host === "codex" ? "AGENTS.md" : "CLAUDE.md",
      ),
    ];
  });

  return [...new Set(paths)];
}

function resolveHostRepairMutationPaths(
  inputs: Array<{ host: InstalledHostKind; workspaceRoot?: string }>,
): string[] {
  const installRoot = resolveInstallRoot(undefined);
  const homeRoot = dirname(installRoot);
  const paths = inputs.flatMap((input) => {
    const basePaths = [
      resolveInstalledHostHookTargetPath(input.host, homeRoot).path,
      resolveInstalledHostMcpTargetPath(input.host, homeRoot).path,
    ];

    if (!input.workspaceRoot) {
      return basePaths;
    }

    return [
      ...basePaths,
      join(input.workspaceRoot, ".goodmemory", `${input.host}.json`),
      join(
        input.workspaceRoot,
        input.host === "codex" ? "AGENTS.md" : "CLAUDE.md",
      ),
    ];
  });

  return [...new Set(paths)];
}

// `setup --recommended`: one comprehensible consent decision. The explicit
// gate (--yes, --json, or an interactive Y) is the consent act; the shipped
// defaults stay untouched — nothing flips silently.
async function handleRecommendedSetup(
  flags: ParsedFlags,
  dependencies: CLIRunDependencies = {},
): Promise<CLICommandOutput> {
  const consented =
    flagEnabled(flags, "yes") ||
    flagEnabled(flags, "json") ||
    (await askRecommendedSetupConsent(flags, dependencies));
  if (!consented) {
    throw new Error(
      `Recommended setup enables global activation and selective writeback.\n${RECOMMENDED_SETUP_COMMITMENTS}\nRe-run with --yes to confirm (or answer y interactively).`,
    );
  }

  const composedFlags: ParsedFlags = {
    ...flags,
    "activation-mode": "global",
    writeback: "selective",
  };
  delete composedFlags.recommended;
  const result = await handleSetup(composedFlags, {
    ...dependencies,
    // Consent given: run the composed install non-interactively.
    interactive: false,
  });
  return {
    ...result,
    text: `${RECOMMENDED_SETUP_COMMITMENTS}\n\n${result.text}`,
  };
}

async function askRecommendedSetupConsent(
  flags: ParsedFlags,
  dependencies: CLIRunDependencies,
): Promise<boolean> {
  const prompt = resolveInstallPrompt(flags, dependencies);
  if (!prompt) {
    return false;
  }
  const answer = await askChoice({
    choices: ["y", "n"],
    defaultValue: "y",
    message: `${RECOMMENDED_SETUP_COMMITMENTS}\nApply recommended setup? [Y/n]`,
    prompt,
  });
  return answer === "y";
}

async function resolveSetupOptions(
  flags: ParsedFlags,
  dependencies: CLIRunDependencies,
): Promise<{
  activationSelection: InstallActivationSelection;
  flags: ParsedFlags;
  hosts: InstalledHostKind[];
  writebackByHost: Partial<Record<InstalledHostKind, InstalledHostWritebackConfig>>;
}> {
  const prompt = resolveInstallPrompt(flags, dependencies);
  if (!prompt) {
    const hostSelection =
      readSetupHostSelection(flags.host) ?? (await detectSetupHostSelection());
    const hosts = expandSetupHostSelection(hostSelection);
    const writeback = readInstallWritebackConfigOverride(flags);
    const writebackByHost: Partial<
      Record<InstalledHostKind, InstalledHostWritebackConfig>
    > = {};
    if (writeback) {
      for (const host of hosts) {
        writebackByHost[host] = writeback;
      }
    }
    return {
      activationSelection:
        readActivationModeFlag(flags["activation-mode"]) === "workspace_opt_in"
          ? "manual"
          : "global",
      flags,
      hosts,
      writebackByHost,
    };
  }

  try {
    const resolvedFlags = { ...flags };
    const hostSelection =
      readSetupHostSelection(resolvedFlags.host) ??
      ((await askChoice({
        choices: ["codex", "claude", "both"],
        defaultValue: await detectSetupHostSelection(),
        message: "Enable GoodMemory for which host? [codex/claude/both]",
        prompt,
      })) as SetupHostSelection);
    const hosts = expandSetupHostSelection(hostSelection);
    const activationSelection = await promptInstallActivationSelection(
      resolvedFlags,
      prompt,
    );
    await promptOptionalFlag({
      flagName: "user-id",
      flags: resolvedFlags,
      message:
        "GoodMemory user id for this setup (leave empty to use the OS account)",
      prompt,
    });
    await promptInstallStorage(resolvedFlags, prompt);
    await promptEmbeddingInstallConfig(
      resolvedFlags,
      prompt,
      "~/.goodmemory/<host>.json",
    );
    await promptAssistedExtractorInstallConfig(
      resolvedFlags,
      prompt,
      "~/.goodmemory/<host>.json",
    );
    const writebackByHost: Partial<
      Record<InstalledHostKind, InstalledHostWritebackConfig>
    > = {};
    for (const host of hosts) {
      const writeback = await promptWritebackInstallConfig({
        flags: resolvedFlags,
        host,
        prompt,
      });
      if (writeback) {
        writebackByHost[host] = writeback;
      }
    }

    return {
      activationSelection,
      flags: resolvedFlags,
      hosts,
      writebackByHost,
    };
  } finally {
    await prompt.close?.();
  }
}

function buildInstalledHostPayload(
  result: InstallHostResult,
  workspaceEnableResult: Awaited<ReturnType<typeof enableHostWorkspace>> | null,
): {
  activationMode: InstalledHostActivationMode;
  contextMode: InstalledHostContextMode;
  changes: Array<{
    action: string;
    path: string;
    relativePath: string;
  }>;
  configPath: string;
  host: InstalledHostKind;
  installRoot: string;
  instructionPath?: string;
  language?: InstalledHostLanguageConfig;
  memoryPath?: string;
  providers: {
    assistedExtractor: InstalledProviderStatus;
    embedding: InstalledProviderStatus;
  };
  storage: {
    location: string;
    provider: string;
  };
  userId: string;
  writeback: InstalledHostWritebackConfig;
  workspaceRoot?: string;
} {
  return {
    activationMode: result.activationMode,
    contextMode: result.contextMode,
    changes: [
      ...result.changes,
      ...(workspaceEnableResult?.changes ?? []),
    ].map((change) => ({
      action: change.action,
      path: change.path,
      relativePath: change.relativePath,
    })),
    configPath: result.configPath,
    host: result.host,
    installRoot: result.installRoot,
    ...(result.language ? { language: result.language } : {}),
    ...(result.storage.provider === "sqlite" ? { memoryPath: result.memoryPath } : {}),
    providers: summarizeInstalledProviders(result.providers),
    storage: result.storage,
    userId: result.userId,
    writeback: result.writeback,
    ...(workspaceEnableResult
      ? {
          instructionPath: workspaceEnableResult.instructionPath,
          workspaceRoot: workspaceEnableResult.workspaceRoot,
        }
      : {}),
  };
}

async function repairInstalledHostWiring(input: {
  host: InstalledHostKind;
  plan: InstallerHostPlan;
}): Promise<InstalledHostFileChange[]> {
  const changes: InstalledHostFileChange[] = [];
  if (!input.plan.mcpRegistered) {
    changes.push(
      await registerInstalledHostMcp({
        host: input.host,
      }),
    );
  }
  if (!input.plan.hookRegistered || !input.plan.preActionRegistered) {
    changes.push(
      ...(await registerInstalledHostHooks({
        host: input.host,
      })),
    );
  }

  return mergeInstallerFileChanges(changes);
}

function buildRepairedHostPayload(
  plan: InstallerHostPlan,
  repairChanges: InstalledHostFileChange[],
  workspaceEnableResult: Awaited<ReturnType<typeof enableHostWorkspace>> | null,
): {
  activationMode: InstalledHostActivationMode | null;
  changes: Array<{
    action: string;
    path: string;
    relativePath: string;
  }>;
  contextMode: InstalledHostContextMode | null;
  host: InstalledHostKind;
  providers?: {
    assistedExtractor: InstalledProviderStatus;
    embedding: InstalledProviderStatus;
  };
  storage?: {
    location: string;
    provider: string;
  };
  userId?: string;
  writeback: InstalledHostWritebackConfig | null;
  workspaceRoot?: string;
} {
  return {
    activationMode: plan.activationMode,
    changes: [
      ...repairChanges,
      ...(workspaceEnableResult?.changes ?? []),
    ].map((change) => ({
      action: change.action,
      path: change.path,
      relativePath: change.relativePath,
    })),
    contextMode: plan.contextMode,
    host: plan.host,
    ...(plan.providers ? { providers: plan.providers } : {}),
    ...(plan.storage ? { storage: plan.storage } : {}),
    ...(plan.userId ? { userId: plan.userId } : {}),
    writeback: plan.writeback,
    ...(workspaceEnableResult
      ? { workspaceRoot: workspaceEnableResult.workspaceRoot }
      : {}),
  };
}

function mergeInstallerFileChanges(
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
      action: mergeInstallerFileAction(previous.action, change.action),
    });
  }

  return order.map((path) => merged.get(path)!);
}

function mergeInstallerFileAction(
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

async function handleHostUninstall(
  host: InstalledHostKind,
): Promise<CLICommandOutput> {
  const result = await uninstallHost({ host });
  const payload = {
    changes: result.changes.map((change) => ({
      action: change.action,
      path: change.path,
      relativePath: change.relativePath,
    })),
    configPath: result.configPath,
    host: result.host,
  };

  return {
    json: payload,
    text: renderInstalledHostPayload({
      actionLabel: "Uninstalled",
      payload,
    }),
  };
}

async function handleStatus(
  host: InstalledHostKind | undefined,
  flags: ParsedFlags,
): Promise<CLICommandOutput> {
  const hosts = host ? [host] : (["codex", "claude"] as InstalledHostKind[]);
  const payload = {
    hosts: await Promise.all(hosts.map((target) => buildHostStatus(target, flags))),
  };

  return {
    json: payload,
    text: renderStatusPayload(payload),
  };
}

interface InstallerPlannedChange {
  action: "create" | "update";
  path: string;
  reason: string;
}

interface InstallerHostPlan {
  activationMode: InstalledHostActivationMode | null;
  config: string;
  contextMode: InstalledHostContextMode | null;
  hookRegistered: boolean;
  host: InstalledHostKind;
  language?: InstalledHostLanguageConfig;
  mcpRegistered: boolean;
  nextCommands: string[];
  plannedChanges: InstallerPlannedChange[];
  preActionRegistered: boolean;
  providers?: {
    assistedExtractor: InstalledProviderStatus;
    embedding: InstalledProviderStatus;
  };
  repairable: boolean;
  storage?: {
    location: string;
    provider: string;
  };
  userId?: string;
  warnings: string[];
  workspaceStatus: string;
  writeback: InstalledHostWritebackConfig | null;
}

interface InstallerRequestedOptions {
  activationMode?: InstalledHostActivationMode;
  assistedExtractor?: InstalledHostModelProviderConfig;
  contextMode?: InstalledHostContextMode;
  embedding?: InstalledHostEmbeddingProviderConfig;
  language?: InstalledHostLanguageConfig;
  memoryPath?: string;
  storageExplicit: boolean;
  storageProvider?: InstalledHostStorageProvider;
  storageUrl?: string;
  userId?: string;
  userIdExplicit: boolean;
  writeback?: InstalledHostWritebackConfig;
}

async function handleDoctor(
  selection: SetupHostSelection,
  flags: ParsedFlags,
): Promise<CLICommandOutput> {
  const payload = {
    dryRun: true,
    hosts: await Promise.all(
      expandSetupHostSelection(selection).map((host) =>
        buildInstallerHostPlan({
          host,
          mode: "doctor",
          workspaceRoot: flags["workspace-root"],
        }),
      ),
    ),
  };

  return {
    json: payload,
    text: renderInstallerPlanPayload("GoodMemory doctor", payload),
  };
}

async function handleRepair(
  selection: SetupHostSelection,
  flags: ParsedFlags,
): Promise<CLICommandOutput> {
  const hosts = expandSetupHostSelection(selection);
  if (flagEnabled(flags, "dry-run")) {
    const payload = {
      dryRun: true,
      hosts: await Promise.all(
        hosts.map((host) =>
          buildInstallerHostPlan({
            host,
            mode: "repair",
            workspaceRoot: flags["workspace-root"],
          }),
        ),
      ),
    };

    return {
      json: payload,
      text: renderInstallerPlanPayload("GoodMemory repair dry-run", payload),
    };
  }

  return withManagedFileTransaction(
    resolveHostRepairMutationPaths(
      hosts.map((host) => ({
        host,
        workspaceRoot: flags["workspace-root"],
      })),
    ),
    async () => {
      const repairedHosts = [];
      let blockedRepair = false;
      for (const host of hosts) {
        const plan = await buildInstallerHostPlan({
          host,
          mode: "repair",
          workspaceRoot: flags["workspace-root"],
        });
        if (!plan.repairable) {
          const skippedReason =
            plan.config !== "ok" || plan.warnings.length > 0
              ? "manual_fix_required"
              : "nothing_to_repair";
          if (skippedReason === "manual_fix_required") {
            blockedRepair = true;
          }
          repairedHosts.push({
            ...plan,
            changes: [] as Array<{
              action: InstalledHostFileChange["action"];
              path: string;
              relativePath: string;
            }>,
            skipped: true,
            skippedReason,
          });
          continue;
        }

        const repairChanges = await repairInstalledHostWiring({
          host,
          plan,
        });
        const workspaceEnableResult =
          plan.workspaceStatus === "missing_repo_config"
            ? await enableHostWorkspace({
                host,
                workspaceRoot: flags["workspace-root"],
              })
            : null;
        repairedHosts.push({
          ...buildRepairedHostPayload(plan, repairChanges, workspaceEnableResult),
          dryRun: false,
          nextCommands: [] as string[],
          repairable: false,
          skipped: false,
          warnings: [] as string[],
        });
      }

      const payload = {
        dryRun: false,
        hosts: repairedHosts,
      };

      return {
        exitCode: blockedRepair ? 1 : 0,
        json: payload,
        text: renderInstallerRepairPayload(payload),
      };
    },
  );
}

async function buildInstallerHostPlan(input: {
  host: InstalledHostKind;
  mode: "doctor" | "enable" | "install" | "repair";
  requested?: InstallerRequestedOptions;
  workspaceRoot?: string;
}): Promise<InstallerHostPlan> {
  const status = await buildHostStatus(input.host, {
    ...(input.workspaceRoot ? { "workspace-root": input.workspaceRoot } : {}),
  });
  const config = String(status.config ?? "missing");
  const workspaceStatus = String(status.workspaceStatus ?? "missing_global_config");
  const hookRegistered = status.hookRegistered === true;
  const mcpRegistered = status.mcpRegistered === true;
  const preActionRegistered = status.preActionRegistered === true;
  const preActionReady = input.host !== "codex" || preActionRegistered;
  const wiringNeedsRepair = !hookRegistered || !mcpRegistered || !preActionReady;
  const hookInspection = await inspectInstalledHostHookRegistration({
    host: input.host,
  });
  const mcpInspection = await inspectInstalledHostMcpRegistration({
    host: input.host,
  });
  const existingGlobalConfig = await readInstalledHostRuntimeConfig(
    input.host,
    undefined,
    {},
  );
  const existingConfig =
    existingGlobalConfig.status === "ok" ? existingGlobalConfig.config : null;
  const installDefaultsApply =
    input.requested !== undefined && input.mode === "install";
  const activationMode =
    input.requested?.activationMode ??
    (status.activationMode === "global" || status.activationMode === "workspace_opt_in"
      ? status.activationMode
      : installDefaultsApply
        ? DEFAULT_INSTALLED_HOST_ACTIVATION_MODE
        : null);
  const contextMode =
    input.requested?.contextMode ??
    existingConfig?.contextMode ??
    (status.contextMode === "fragment" || status.contextMode === "progressive"
      ? status.contextMode
      : installDefaultsApply
        ? DEFAULT_INSTALLED_HOST_CONTEXT_MODE
        : null);
  const writeback =
    input.requested?.writeback ??
    existingConfig?.writeback ??
    (isInstalledWritebackConfig(status.writeback)
      ? status.writeback
      : installDefaultsApply
        ? DEFAULT_INSTALLED_HOST_WRITEBACK
        : null);
  const storage = input.requested
    ? summarizeInstallerPlanStorage({
        existingConfig,
        requested: input.requested,
      })
    : undefined;
  const language = input.requested?.language ?? existingConfig?.language;
  const providers = input.requested
    ? summarizeInstalledProviders(
        mergeInstallerPlanProviders({
          existingConfig,
          requested: input.requested,
        }),
      )
    : undefined;
  const userId = input.requested
    ? input.requested.userIdExplicit
      ? resolveInstallerRequestedUserId(input.requested)
      : existingConfig?.userId ?? resolveInstallerRequestedUserId(input.requested)
    : undefined;
  const warnings: string[] = [];
  const nextCommands: string[] = [];
  const enableWritebackUpdate =
    input.mode === "enable" && input.requested?.writeback !== undefined;
  const plannedChanges = await buildInstallerPlannedChanges({
    host: input.host,
    includeGlobalConfig:
      input.mode === "install" || enableWritebackUpdate,
    includeGlobalWiring:
      input.mode === "install" ||
      (input.mode === "repair" && wiringNeedsRepair),
    includeWorkspace:
      input.mode === "enable" ||
      (input.mode === "install" && input.workspaceRoot !== undefined) ||
      (input.mode === "repair" && workspaceStatus === "missing_repo_config"),
    workspaceRoot: input.workspaceRoot,
  });

  if (config === "missing") {
    nextCommands.push(`goodmemory setup --host ${input.host}`);
  }
  if (config === "invalid") {
    warnings.push(`Installed ${input.host} config is invalid and must be fixed manually.`);
  }
  if (
    (existingConfig?.sharedAgents?.length ?? 0) > 0 &&
    existingConfig?.providers?.embedding
  ) {
    warnings.push(
      "sharedAgents unions document reads only; semantic vector search does not include shared agents yet.",
    );
  }
  if (hookInspection.status === "blocked") {
    warnings.push(
      `Hook registration requires manual repair: ${hookInspection.detail ?? "blocked"}`,
    );
  }
  if (mcpInspection.status === "blocked") {
    warnings.push(
      `MCP registration requires manual repair: ${mcpInspection.detail ?? "blocked"}`,
    );
  }
  const wiringBlocked =
    hookInspection.status === "blocked" || mcpInspection.status === "blocked";
  if (
    config === "ok" &&
    !wiringBlocked &&
    wiringNeedsRepair
  ) {
    nextCommands.push(`goodmemory repair ${input.host}`);
  }
  if (workspaceStatus === "missing_repo_config") {
    nextCommands.push(
      `goodmemory enable ${input.host} --workspace-root ${resolve(input.workspaceRoot ?? ".")}`,
    );
  }

  const repairable =
    config === "ok" &&
    !wiringBlocked &&
    (wiringNeedsRepair || workspaceStatus === "missing_repo_config");

  return {
    activationMode,
    config,
    contextMode,
    hookRegistered,
    host: input.host,
    ...(language ? { language } : {}),
    mcpRegistered,
    nextCommands,
    plannedChanges,
    preActionRegistered,
    ...(providers ? { providers } : {}),
    repairable,
    ...(storage ? { storage } : {}),
    ...(userId ? { userId } : {}),
    warnings,
    workspaceStatus,
    writeback,
  };
}

async function buildInstallerPlannedChanges(input: {
  host: InstalledHostKind;
  includeGlobalConfig: boolean;
  includeGlobalWiring: boolean;
  includeWorkspace: boolean;
  workspaceRoot?: string;
}): Promise<InstallerPlannedChange[]> {
  const installRoot = resolveInstallRoot(undefined);
  const homeRoot = dirname(installRoot);
  const paths: Array<{ path: string; reason: string }> = [];

  if (input.includeGlobalConfig) {
    paths.push({
      path: join(installRoot, `${input.host}.json`),
      reason: "installed host config",
    });
  }

  if (input.includeGlobalWiring) {
    paths.push(
      {
        path: resolveInstalledHostHookTargetPath(input.host, homeRoot).path,
        reason: "managed host hooks",
      },
      {
        path: resolveInstalledHostMcpTargetPath(input.host, homeRoot).path,
        reason: "managed MCP registration",
      },
    );
  }

  if (input.includeWorkspace) {
    const workspaceRoot = resolve(input.workspaceRoot ?? ".");
    paths.push(
      {
        path: join(workspaceRoot, ".goodmemory", `${input.host}.json`),
        reason: "workspace opt-in config",
      },
      {
        path: join(workspaceRoot, input.host === "codex" ? "AGENTS.md" : "CLAUDE.md"),
        reason: "workspace instruction marker",
      },
    );
  }

  const unique = [...new Map(paths.map((item) => [item.path, item])).values()];
  const changes: InstallerPlannedChange[] = [];
  for (const item of unique) {
    changes.push({
      action: (await pathExists(item.path)) ? "update" : "create",
      path: item.path,
      reason: item.reason,
    });
  }

  return changes;
}

function isInstalledWritebackConfig(
  value: unknown,
): value is InstalledHostWritebackConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "mode" in value &&
    readWritebackMode(value.mode) !== undefined
  );
}

function buildInstallerRequestedOptions(input: {
  activationMode: InstalledHostActivationMode;
  flags: ParsedFlags;
  writeback?: InstalledHostWritebackConfig;
}): InstallerRequestedOptions {
  const memoryPath = input.flags["memory-path"];
  const storageProvider = readInstallStorageProviderFlag(input.flags["storage-provider"]);
  const rawStorageUrl = input.flags["storage-url"];
  const storageUrl = rawStorageUrl === undefined ? undefined : rawStorageUrl.trim();
  validateInstallerRequestedStorage({
    memoryPath,
    rawStorageUrl,
    storageProvider,
    storageUrl,
  });

  return {
    activationMode: input.activationMode,
    assistedExtractor: readOptionalAssistedExtractorProviderConfig(input.flags),
    contextMode: readContextModeFlag(input.flags["context-mode"]),
    embedding: readOptionalEmbeddingProviderConfig(input.flags),
    language: readInstallLanguageConfig(input.flags),
    memoryPath,
    storageExplicit:
      memoryPath !== undefined ||
      storageProvider !== undefined ||
      rawStorageUrl !== undefined,
    storageProvider,
    storageUrl,
    userId: input.flags["user-id"],
    userIdExplicit: input.flags["user-id"] !== undefined,
    writeback: input.writeback,
  };
}

function readInstallLanguageConfig(
  flags: ParsedFlags,
): InstalledHostLanguageConfig | undefined {
  const locale = flags["default-locale"];
  return locale === undefined
    ? undefined
    : {
        defaultLocale: canonicalizeInstalledHostDefaultLocale(locale),
      };
}

function validateInstallerRequestedStorage(input: {
  memoryPath?: string;
  rawStorageUrl?: string;
  storageProvider?: InstalledHostStorageProvider;
  storageUrl?: string;
}): void {
  if (
    input.memoryPath &&
    (input.storageProvider !== undefined || input.rawStorageUrl !== undefined)
  ) {
    throw new Error(
      "Use either --memory-path or --storage-provider/--storage-url, not both.",
    );
  }
  if (input.storageProvider === "postgres" && !input.storageUrl) {
    throw new Error("Postgres installed-host storage requires --storage-url.");
  }
  if (
    input.rawStorageUrl !== undefined &&
    input.storageUrl !== undefined &&
    input.storageUrl.length === 0
  ) {
    throw new Error("Installed-host --storage-url must be a non-empty string.");
  }
  if (input.storageProvider === undefined && input.rawStorageUrl !== undefined) {
    throw new Error(
      "Installed-host --storage-url requires --storage-provider <sqlite|postgres>.",
    );
  }
}

function summarizeInstallerPlanStorage(input: {
  existingConfig: InstalledHostRuntimeConfig | null;
  requested: InstallerRequestedOptions;
}): {
  location: string;
  provider: string;
} {
  if (input.requested.storageExplicit) {
    return summarizeInstallerRequestedStorage(input.requested);
  }
  const existingStorage = input.existingConfig?.storage;
  if (existingStorage) {
    return existingStorage.provider === "postgres"
      ? {
          location: "configured",
          provider: "postgres",
        }
      : {
          location: existingStorage.url,
          provider: existingStorage.provider,
        };
  }

  return summarizeInstallerRequestedStorage(input.requested);
}

function summarizeInstallerRequestedStorage(input: InstallerRequestedOptions): {
  location: string;
  provider: string;
} {
  if (input.storageProvider === "postgres") {
    return {
      location: "configured",
      provider: "postgres",
    };
  }

  const installRoot = resolveInstallRoot(undefined);
  return {
    location: resolve(input.storageUrl ?? input.memoryPath ?? join(installRoot, "memory.sqlite")),
    provider: "sqlite",
  };
}

function mergeInstallerPlanProviders(input: {
  existingConfig: InstalledHostRuntimeConfig | null;
  requested: InstallerRequestedOptions;
}): InstalledHostProviderConfig | undefined {
  const providers: InstalledHostProviderConfig = {
    ...(input.existingConfig?.providers ?? {}),
    ...(input.requested.assistedExtractor
      ? { assistedExtractor: input.requested.assistedExtractor }
      : {}),
    ...(input.requested.embedding ? { embedding: input.requested.embedding } : {}),
  };

  return Object.keys(providers).length > 0 ? providers : undefined;
}

function resolveInstallerRequestedUserId(input: InstallerRequestedOptions): string {
  const explicit = input.userId?.trim();
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  for (const candidate of [
    process.env.GOODMEMORY_DEFAULT_USER_ID,
    process.env.USER,
    process.env.LOGNAME,
    process.env.USERNAME,
  ]) {
    const trimmed = candidate?.trim();
    if (trimmed && trimmed.length > 0) {
      return trimmed;
    }
  }

  return "goodmemory-user";
}

async function buildHostStatus(
  host: InstalledHostKind,
  flags: ParsedFlags,
): Promise<Record<string, unknown>> {
  const installRoot = resolveInstallRoot(undefined);
  const homeRoot = dirname(installRoot);
  const globalConfig = await readInstalledHostRuntimeConfig(host, undefined, {});
  const resolved = await resolveInstalledHostContext({
    cwd: flags["workspace-root"],
    host,
  });
  const base = {
    activationMode:
      globalConfig.status === "ok" ? globalConfig.config.activationMode : null,
    config: globalConfig.status,
    ...(globalConfig.status === "ok"
      ? { retrievalTier: resolveHostRetrievalTier(globalConfig.config) }
      : {}),
    contextMode:
      resolved.status === "ok"
        ? resolved.context.contextMode
        : globalConfig.status === "ok"
          ? globalConfig.config.contextMode
          : null,
    hookRegistered: await isInstalledHostHookRegistered({ homeRoot, host }),
    host,
    mcpRegistered: await isInstalledHostMcpRegistered({ homeRoot, host }),
    preActionRegistered: await isInstalledHostPreActionHookRegistered({
      homeRoot,
      host,
    }),
    writeback: globalConfig.status === "ok" ? globalConfig.config.writeback : null,
    workspaceStatus: resolved.status,
  };

  if (resolved.status !== "ok") {
    return base;
  }

  const writebackActivity = await buildHostWritebackActivity(
    host,
    resolved.context,
  );
  const injectionActivity = await buildHostInjectionActivity(host);
  const sharedAgents = resolved.context.sharedAgents ?? [];

  try {
    const memoryStatus = await exportInstalledHostMemoryStatus(resolved.context);
    return {
      ...base,
      ...memoryStatus,
      ...(injectionActivity ? { injectionActivity } : {}),
      scope: resolved.context.scope,
      ...(sharedAgents.length > 0 ? { sharedAgents } : {}),
      storage: resolved.context.storage,
      workspaceRoot: resolved.context.workspaceRoot,
      writebackActivity,
    };
  } catch (error) {
    return {
      ...base,
      countsError: error instanceof Error ? error.message : String(error),
      ...(injectionActivity ? { injectionActivity } : {}),
      scope: resolved.context.scope,
      ...(sharedAgents.length > 0 ? { sharedAgents } : {}),
      storage: resolved.context.storage,
      workspaceRoot: resolved.context.workspaceRoot,
      writebackActivity,
    };
  }
}

interface HostInjectionActivity {
  avgRecallLatencyMs: number;
  gated: number;
  injected: number;
  total: number;
}

// Injection telemetry from the event ring: how often hook context actually
// lands versus gets gated, and what recall latency the hooks are paying.
async function buildHostInjectionActivity(
  host: InstalledHostKind,
): Promise<HostInjectionActivity | null> {
  try {
    const events = await readInstalledHostInjectionEvents(host, undefined);
    if (events.length === 0) {
      return null;
    }
    const recent = events.slice(-20);
    const injected = recent.filter((event) => event.decision === "injected").length;
    return {
      avgRecallLatencyMs: Math.round(
        recent.reduce((sum, event) => sum + event.recallLatencyMs, 0) /
          recent.length,
      ),
      gated: recent.length - injected,
      injected,
      total: recent.length,
    };
  } catch {
    return null;
  }
}

// The effective retrieval quality tier for an installed host, derived from
// its managed config. Env-only embedding (GOODMEMORY_EMBEDDING_*) also
// upgrades recall at runtime but is not visible here.
function resolveHostRetrievalTier(config: InstalledHostRuntimeConfig): string {
  const retrieval = config.retrieval;
  if (retrieval?.preset === "recommended") {
    return "preset-recommended";
  }
  if (config.providers?.embedding && retrieval?.semanticCandidates) {
    return retrieval.bm25Ranking ? "semantic-union+bm25" : "semantic-union";
  }
  if (retrieval?.bm25Ranking) {
    return "bm25-hybrid";
  }
  return "rules-only";
}

interface HostWritebackActivity {
  committedTotal: number;
  lastCapturedAt: string | null;
  lastSessionCaptured: number;
  recallHitEvents: number;
}

// Proof-of-life for capture: committed writeback events in the current
// scope, read straight from the audit ledger. Pure read; failures degrade to
// an empty summary instead of breaking status.
async function buildHostWritebackActivity(
  host: InstalledHostKind,
  context: InstalledHostResolvedContext,
): Promise<HostWritebackActivity> {
  const empty: HostWritebackActivity = {
    committedTotal: 0,
    lastCapturedAt: null,
    lastSessionCaptured: 0,
    recallHitEvents: 0,
  };
  try {
    const ledger = await readInstalledHostWritebackLedger(host, undefined);
    const scopeDigest = buildWritebackScopeDigest(context.scope);
    const committed = ledger.auditEvents.filter(
      (event) => event.scopeDigest === scopeDigest && event.status === "committed",
    );
    if (committed.length === 0) {
      return empty;
    }

    const latest = committed.reduce((left, right) =>
      left.occurredAt >= right.occurredAt ? left : right,
    );
    return {
      committedTotal: committed.length,
      lastCapturedAt: latest.occurredAt,
      lastSessionCaptured: latest.sessionDigest
        ? committed.filter((event) => event.sessionDigest === latest.sessionDigest)
            .length
        : 1,
      recallHitEvents: committed.filter((event) => event.recallHitCount > 0).length,
    };
  } catch {
    return empty;
  }
}

async function exportInstalledHostMemoryStatus(
  context: InstalledHostResolvedContext,
): Promise<{
  counts: Record<string, number>;
  memoryStatus: "ok" | "uninitialized";
}> {
  if (await isUninitializedInstalledHostStorage(context)) {
    return {
      counts: buildEmptyInstalledHostMemoryCounts(),
      memoryStatus: "uninitialized",
    };
  }

  const exported = await createReadOnlyInstalledHostMemory(context).exportMemory({
    includeRuntime: false,
    scope: context.scope,
  });

  return {
    counts: {
      archives: exported.durable.archives.length,
      episodes: exported.durable.episodes.length,
      facts: exported.durable.facts.length,
      feedback: exported.durable.feedback.length,
      preferences: exported.durable.preferences.length,
      profile: exported.durable.profile ? 1 : 0,
      references: exported.durable.references.length,
    },
    memoryStatus: "ok",
  };
}

async function isUninitializedInstalledHostStorage(
  context: InstalledHostResolvedContext,
): Promise<boolean> {
  const storage = context.storage;
  return (
    storage?.provider === "sqlite" &&
    storage.url !== undefined &&
    storage.url !== ":memory:" &&
    !(await pathExists(storage.url))
  );
}

function createReadOnlyInstalledHostMemory(
  context: InstalledHostResolvedContext,
): GoodMemory {
  const storage = context.storage;
  if (storage?.provider === "sqlite" && storage.url !== undefined) {
    return createGoodMemory({
      adapters: {
        documentStore: createSQLiteDocumentStore(storage.url, {
          readOnly: true,
        }),
        sessionStore: createSQLiteSessionStore(storage.url, {
          readOnly: true,
        }),
        vectorStore: createInMemoryVectorStore(),
      },
      storage: {
        provider: "sqlite",
        url: storage.url,
      },
    });
  }
  if (storage?.provider === "postgres" && storage.url !== undefined) {
    return createGoodMemory({
      adapters: {
        documentStore: createPostgresDocumentStore(
          { url: storage.url },
          { readOnly: true },
        ),
        sessionStore: createPostgresSessionStore(
          { url: storage.url },
          { readOnly: true },
        ),
        vectorStore: createInMemoryVectorStore(),
      },
      storage: {
        provider: "postgres",
        url: storage.url,
      },
    });
  }

  return createInstalledHostMemory(context);
}

function buildEmptyInstalledHostMemoryCounts(): Record<string, number> {
  return {
    archives: 0,
    episodes: 0,
    facts: 0,
    feedback: 0,
    preferences: 0,
    profile: 0,
    references: 0,
  };
}

async function handleHostEnable(
  host: InstalledHostKind,
  flags: ParsedFlags,
): Promise<CLICommandOutput> {
  if (flagEnabled(flags, "dry-run")) {
    const payload = {
      dryRun: true,
      hosts: [
        await buildInstallerHostPlan({
          host,
          mode: "enable",
          requested: {
            contextMode: readContextModeFlag(flags["context-mode"]),
            storageExplicit: false,
            userIdExplicit: false,
            writeback:
              flags.writeback === undefined
                ? undefined
                : buildWritebackConfig(readWritebackModeFlag(flags.writeback)),
          },
          workspaceRoot: flags["workspace-root"],
        }),
      ],
    };

    return {
      json: payload,
      text: renderInstallerPlanPayload("GoodMemory enable dry-run", payload),
    };
  }

  const result = await enableHostWorkspace({
    contextMode: readContextModeFlag(flags["context-mode"]),
    host,
    mcpAllowWrite:
      flags["mcp-allow-write"] === undefined
        ? undefined
        : flagEnabled(flags, "mcp-allow-write"),
    writebackMode:
      flags.writeback === undefined ? undefined : readWritebackModeFlag(flags.writeback),
    workspaceId: flags["workspace-id"],
    workspaceRoot: flags["workspace-root"],
  });
  const payload = {
    changes: result.changes.map((change) => ({
      action: change.action,
      path: change.path,
      relativePath: change.relativePath,
    })),
    configPath: result.configPath,
    host: result.host,
    ...(result.contextMode ? { contextMode: result.contextMode } : {}),
    instructionPath: result.instructionPath,
    ...(result.writeback ? { writeback: result.writeback } : {}),
    workspaceId: result.workspaceId,
    workspaceRoot: result.workspaceRoot,
  };

  return {
    json: payload,
    text: renderInstalledHostPayload({
      actionLabel: "Enabled",
      payload,
    }),
  };
}

async function handleHostDisable(
  host: InstalledHostKind,
  flags: ParsedFlags,
): Promise<CLICommandOutput> {
  const result = await disableHostWorkspace({
    host,
    workspaceRoot: flags["workspace-root"],
  });
  const payload = {
    changes: result.changes.map((change) => ({
      action: change.action,
      path: change.path,
      relativePath: change.relativePath,
    })),
    configPath: result.configPath,
    host: result.host,
    instructionPath: result.instructionPath,
    workspaceRoot: result.workspaceRoot,
  };

  return {
    json: payload,
    text: renderInstalledHostPayload({
      actionLabel: "Disabled",
      payload,
    }),
  };
}

async function handleCodexAction(
  flags: ParsedFlags,
  positionals: string[],
): Promise<CLICommandOutput> {
  const sessionId = normalizeOptionalFlag(flags["session-id"]);
  if (!sessionId) {
    throw new Error(
      "Codex action gate requires --session-id <session-id> to bind memory-backed policy to a real host session.",
    );
  }

  const command =
    normalizeOptionalFlag(flags.command) ??
    normalizeOptionalFlag(shellEscapeArgs(positionals));
  if (!command) {
    throw new Error(
      "Codex action gate requires --command <command> or command tokens after --.",
    );
  }

  const result = await executeInstalledHostAction({
    ...(flags["action-id"] ? { actionId: flags["action-id"] } : {}),
    ...(flags["attempt-id"] ? { attemptId: flags["attempt-id"] } : {}),
    command,
    cwd: process.cwd(),
    host: "codex",
    ...(flags["run-id"] ? { runId: flags["run-id"] } : {}),
    ...(flags.sequence !== undefined
      ? { sequence: readNonNegativeIntegerFlag(flags.sequence, "sequence") }
      : {}),
    sessionId,
    ...(flags["turn-id"] ? { turnId: flags["turn-id"] } : {}),
  });

  return {
    exitCode: result.exitCode,
    json: result.payload,
    text: JSON.stringify(result.payload, null, 2),
  };
}

function shellEscapeArgs(tokens: string[]): string {
  return tokens
    .map((token) => `'${token.replace(/'/g, "'\\''")}'`)
    .join(" ");
}

async function handleHostHook(
  host: InstalledHostKind,
  command: InstalledHostHookCommand,
): Promise<CLICommandOutput> {
  const rawInput = await new Response(Bun.stdin.stream()).text();
  if (rawInput.trim().length === 0) {
    return {
      json: {},
      text: JSON.stringify({}, null, 2),
    };
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawInput) as Record<string, unknown>;
  } catch {
    return {
      json: {},
      text: JSON.stringify({}, null, 2),
    };
  }
  const result = await executeInstalledHostHook({
    command,
    host,
    payload,
  });
  const rendered = JSON.stringify(result.output ?? {}, null, 2);

  return {
    json: result.output ?? {},
    text: rendered,
  };
}

async function handleHostWriteback(
  host: InstalledHostKind,
  command: string | undefined,
  flags: ParsedFlags,
): Promise<CLICommandOutput> {
  if (command === "inspect") {
    const result = await inspectInstalledHostWritebackAudit({
      cwd: flags["workspace-root"] ? resolve(flags["workspace-root"]) : process.cwd(),
      host,
      limit: flags.limit === undefined ? undefined : Number(flags.limit),
    });
    return {
      json: result,
      text: JSON.stringify(result, null, 2),
    };
  }

  if (command === "forget") {
    const reviewOutcome = readWritebackReviewOutcome(flags["review-outcome"]);
    const result = await forgetInstalledHostWritebackAuditEvent({
      cwd: flags["workspace-root"] ? resolve(flags["workspace-root"]) : process.cwd(),
      eventId: requireFlag(flags, "event-id"),
      host,
      ...(reviewOutcome || flags["review-reason"]
        ? {
            review: {
              outcome: reviewOutcome ?? "uncertain",
              ...(flags["review-reason"] ? { reason: flags["review-reason"] } : {}),
            },
          }
        : {}),
    });
    return {
      json: result,
      text: JSON.stringify(result, null, 2),
    };
  }

  if (command !== undefined) {
    throw new Error(`Unknown ${host} writeback command: ${command}.`);
  }

  // Native Stop hooks are primary. --from-rollout explicitly feeds a selected
  // session rollout through the same transcript-hydration pipeline.
  let payload: Record<string, unknown>;
  if (flagEnabled(flags, "from-rollout")) {
    if (host !== "codex") {
      throw new Error("--from-rollout is only supported for the codex host.");
    }
    const rolloutPath =
      flags["rollout-path"] ??
      (await resolveLatestCodexRolloutPath({
        ...(flags["sessions-root"] ? { sessionsRoot: flags["sessions-root"] } : {}),
      }));
    if (!rolloutPath) {
      throw new Error(
        "No codex rollout files found under ~/.codex/sessions. Pass --rollout-path <file> explicitly.",
      );
    }
    payload = {
      cwd: flags["workspace-root"] ? resolve(flags["workspace-root"]) : process.cwd(),
      session_id: codexRolloutSessionId(rolloutPath),
      transcript_path: resolve(rolloutPath),
    };
  } else {
    const rawInput = await new Response(Bun.stdin.stream()).text();
    payload = rawInput.trim().length > 0
      ? JSON.parse(rawInput) as Record<string, unknown>
      : {};
  }
  const result = await executeInstalledHostWriteback({
    command: "session-end",
    dryRun: flagEnabled(flags, "dry-run"),
    host,
    mode: flags.mode === undefined ? undefined : readWritebackModeFlag(flags.mode),
    payload,
  });

  return {
    exitCode: hostWritebackExitCode(result.reason),
    json: result,
    text: JSON.stringify(result, null, 2),
  };
}

function readWritebackReviewOutcome(
  value: string | undefined,
): "false_write" | "uncertain" | "valid_write" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "false_write" || value === "uncertain" || value === "valid_write") {
    return value;
  }
  throw new Error(
    `Unsupported writeback review outcome: ${value}. Expected valid_write|false_write|uncertain.`,
  );
}

function hostWritebackExitCode(
  reason: InstalledHostWritebackResult["reason"],
): number {
  return reason === "missing_config" ||
    reason === "audit_failed" ||
    reason === "missing_repo_opt_in" ||
    reason === "transcript_read_failed" ||
    reason === "write_failed"
    ? 1
    : 0;
}


export async function runHostCommand(
  primary: string,
  commands: string[],
  flags: ParsedFlags,
  dependencies: CLIRunDependencies,
): Promise<CLIResult> {
  switch (primary) {
    case "adopt":
      return renderOutput(await handleAdopt(flags, dependencies), flags);
    case "setup":
      return renderOutput(await handleSetup(flags, dependencies), flags);
    case "status":
      return renderOutput(
        await handleStatus(
          commands[1] ? requireInstalledHostKind(commands[1]) : undefined,
          flags,
        ),
        flags,
      );
    case "doctor":
      return renderOutput(
        await handleDoctor(readOptionalHostSelection(commands[1]), flags),
        flags,
      );
    case "install":
      return renderOutput(
        await handleHostInstall(
          requireInstalledHostKind(commands[1]),
          flags,
          dependencies,
        ),
        flags,
      );
    case "uninstall":
      return renderOutput(
        await handleHostUninstall(requireInstalledHostKind(commands[1])),
        flags,
      );
    case "enable":
      return renderOutput(
        await handleHostEnable(requireInstalledHostKind(commands[1]), flags),
        flags,
      );
    case "disable":
      return renderOutput(
        await handleHostDisable(requireInstalledHostKind(commands[1]), flags),
        flags,
      );
    case "repair":
      return renderOutput(
        await handleRepair(readOptionalHostSelection(commands[1]), flags),
        flags,
      );
    case "codex":
      return runCodexCommand(commands, flags);
    case "claude":
      return runClaudeCommand(commands, flags);
    default:
      throw new Error(`Unknown command: ${primary}. Run 'goodmemory --help'.`);
  }
}

async function runCodexCommand(
  commands: string[],
  flags: ParsedFlags,
): Promise<CLIResult> {
  const secondary = commands[1];
  switch (secondary) {
    case "action":
      return renderOutput(await handleCodexAction(flags, commands.slice(2)), flags);
    case "bootstrap":
      return renderOutput(await handleHostBootstrap("codex", flags), flags);
    case "hook":
      return renderOutput(
        await handleHostHook(
          "codex",
          requireInstalledHostHookCommand(commands[2]),
        ),
        flags,
      );
    case "writeback":
      return renderOutput(await handleHostWriteback("codex", commands[2], flags), flags);
    default:
      throw new Error(`Unknown Codex command: ${secondary}. Run 'goodmemory codex --help'.`);
  }
}

async function runClaudeCommand(
  commands: string[],
  flags: ParsedFlags,
): Promise<CLIResult> {
  const secondary = commands[1];
  switch (secondary) {
    case "bootstrap":
      return renderOutput(await handleHostBootstrap("claude", flags), flags);
    case "hook":
      return renderOutput(
        await handleHostHook(
          "claude",
          requireInstalledHostHookCommand(commands[2]),
        ),
        flags,
      );
    case "writeback":
      return renderOutput(await handleHostWriteback("claude", commands[2], flags), flags);
    default:
      throw new Error(`Unknown Claude command: ${secondary}. Run 'goodmemory claude --help'.`);
  }
}
