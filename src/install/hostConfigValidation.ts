import { resolveWorkspaceId } from "../host/managedFiles";

export type InstalledHostConfigTarget = "claude" | "codex";

export interface InstalledHostRuntimeConfig {
  activationMode: InstalledHostActivationMode;
  contextMode: InstalledHostContextMode;
  debug: boolean;
  language?: InstalledHostLanguageConfig;
  maxTokens: number;
  // Opt-in exposure of the goodmemory_remember write tool on the installed
  // MCP surface; absent → read-only tools (today's behavior).
  mcp?: InstalledHostMcpConfig;
  // Session-start injection may spend more than per-prompt injection (the
  // brief runs once per session); absent → maxTokens governs both.
  sessionStartMaxTokens?: number;
  // Opt-in cross-host READ union: this host may read records tagged with
  // these agentIds (writes keep their own agentId). Symmetric sharing means
  // both hosts opt in. Normalized: self stripped, deduped.
  sharedAgents?: string[];
  // Opportunistic session-stop maintenance (dedupe/contradiction/quality/TTL
  // — never consolidation). Guarded by the dream orchestrator's thresholds
  // plus a min-hours cooldown (default 24h when auto is on).
  maintenance?: InstalledHostMaintenanceConfig;
  // relevance_gated skips user-prompt-submit injection when recall carries
  // no query-specific signal; absent → always (today's behavior).
  promptInjection?: InstalledHostPromptInjectionMode;
  providers?: InstalledHostProviderConfig;
  retrieval?: InstalledHostRetrievalConfig;
  retrievalProfile: "coding_agent" | "general_chat";
  // Derived, read-only workspace mirror of the export bundle (ADR-010 §8);
  // absent or disabled → no files are written.
  fileMirror?: InstalledHostFileMirrorConfig;
  storage: {
    provider: "memory" | "postgres" | "sqlite";
    url: string;
  };
  userId: string;
  writeback: InstalledHostWritebackConfig;
}

export type InstalledHostPromptInjectionMode = "always" | "relevance_gated";

export interface InstalledHostFileMirrorConfig {
  enabled: boolean;
  // Defaults to <workspaceRoot>/.goodmemory/memory at runtime.
  root?: string;
}

export interface InstalledHostMcpConfig {
  allowWrite: boolean;
}

export interface InstalledHostLanguageConfig {
  readonly defaultLocale: string;
}

export function canonicalizeInstalledHostDefaultLocale(locale: string): string {
  const trimmed = locale.trim();
  if (!trimmed) {
    throw new Error("Installed host default locale must be a non-empty locale.");
  }
  try {
    return new Intl.Locale(trimmed).toString();
  } catch {
    throw new Error("Installed host default locale must be a valid locale.");
  }
}

export interface InstalledHostMaintenanceConfig {
  auto?: boolean;
  minHoursBetweenRuns?: number;
}

// Mirrors GoodMemoryRetrievalConfig field-for-field so the resolved context
// can hand it to createGoodMemory unchanged. Absence keeps today's
// rules-only behavior byte-identical; fresh installs opt new stores into
// the measured BM25 hybrid tier at install time instead of changing this
// runtime default.
export interface InstalledHostRetrievalConfig {
  bm25Ranking?: boolean;
  longRecordAdmission?: boolean;
  preset?: "recommended";
  semanticCandidates?: {
    maxAdditions?: number;
    minRelativeScore?: number;
    minSimilarity?: number;
    topK?: number;
  };
}

export type InstalledHostActivationMode = "global" | "workspace_opt_in";
export type InstalledHostContextMode = "fragment" | "progressive";
export type InstalledHostAutoLearnSource = "session_stop" | "user_prompt";
export type InstalledHostAutoLearnExtractionStrategy =
  | "auto"
  | "llm-assisted"
  | "rules-only";

export interface InstalledHostAutoLearnConfig {
  enabled: boolean;
  extractionStrategy: InstalledHostAutoLearnExtractionStrategy;
  sources: InstalledHostAutoLearnSource[];
}

export type InstalledHostWritebackMode = "off" | "observe" | "selective" | "review";
export type InstalledHostWritebackAssistantPolicy =
  | "never"
  | "confirmed"
  | "verified"
  | "confirmed_or_verified";

export interface InstalledHostWritebackConfig {
  allowAssistantOutput: InstalledHostWritebackAssistantPolicy;
  dryRun: boolean;
  // Batch pre-extraction control: absent/auto = batch LLM when an assisted
  // provider is configured; rules-only pins the regex floor; llm-assisted is
  // an explicit request (still requires the provider).
  extractionStrategy?: InstalledHostAutoLearnExtractionStrategy;
  maxChars: number;
  maxMessages: number;
  minConfidence: number;
  mode: InstalledHostWritebackMode;
  persistRawTranscript: false;
}

export interface InstalledHostModelProviderConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  provider: "anthropic" | "openai";
}

export interface InstalledHostEmbeddingProviderConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  provider: "openai";
}

export interface InstalledHostProviderConfig {
  assistedExtractor?: InstalledHostModelProviderConfig;
  embedding?: InstalledHostEmbeddingProviderConfig;
}

export interface WorkspaceHostOptInConfig {
  contextMode?: InstalledHostContextMode;
  debug: boolean;
  enabled: boolean;
  maxTokens?: number;
  retrievalProfile?: "coding_agent" | "general_chat";
  sessionStartMaxTokens?: number;
  workspaceId: string;
}

export const DEFAULT_INSTALLED_HOST_MAX_TOKENS = 256;
export const DEFAULT_INSTALLED_HOST_RETRIEVAL_PROFILE = "coding_agent";
export const DEFAULT_INSTALLED_HOST_CONTEXT_MODE: InstalledHostContextMode =
  "fragment";
export const DEFAULT_INSTALLED_HOST_ACTIVATION_MODE = "workspace_opt_in";
export const DEFAULT_INSTALLED_HOST_AUTO_LEARN: InstalledHostAutoLearnConfig = {
  enabled: false,
  extractionStrategy: "auto",
  sources: ["user_prompt", "session_stop"],
};
export const DEFAULT_INSTALLED_HOST_WRITEBACK: InstalledHostWritebackConfig = {
  allowAssistantOutput: "confirmed_or_verified",
  dryRun: false,
  maxChars: 12_000,
  maxMessages: 12,
  minConfidence: 0.7,
  mode: "off",
  persistRawTranscript: false,
};

export function parseInstalledHostRuntimeConfig(
  parsed: unknown,
  host: InstalledHostConfigTarget,
):
  | { config: InstalledHostRuntimeConfig; status: "ok" }
  | { detail: string; status: "invalid" } {
  if (!isRecord(parsed)) {
    return { detail: "root value must be a JSON object", status: "invalid" };
  }
  if (parsed.host !== host) {
    return {
      detail: "host value does not match the managed config target",
      status: "invalid",
    };
  }
  if (parsed.debug !== undefined && typeof parsed.debug !== "boolean") {
    return { detail: "debug must be a boolean", status: "invalid" };
  }

  const activationMode =
    parsed.activationMode === undefined
      ? DEFAULT_INSTALLED_HOST_ACTIVATION_MODE
      : readActivationMode(parsed.activationMode);
  if (activationMode === undefined) {
    return {
      detail: "activationMode must be global or workspace_opt_in",
      status: "invalid",
    };
  }

  const contextMode =
    parsed.contextMode === undefined
      ? DEFAULT_INSTALLED_HOST_CONTEXT_MODE
      : readContextMode(parsed.contextMode);
  if (contextMode === undefined) {
    return {
      detail: "contextMode must be fragment or progressive",
      status: "invalid",
    };
  }

  const writeback = readWritebackConfig({
    legacyAutoLearn: parsed.autoLearn,
    value: parsed.writeback,
  });
  if (writeback.status === "invalid") {
    return {
      detail: writeback.detail,
      status: "invalid",
    };
  }

  const maxTokens =
    parsed.maxTokens === undefined
      ? DEFAULT_INSTALLED_HOST_MAX_TOKENS
      : readPositiveInteger(parsed.maxTokens);
  if (maxTokens === undefined) {
    return { detail: "maxTokens must be a positive integer", status: "invalid" };
  }

  const retrievalProfile =
    parsed.retrievalProfile === undefined
      ? DEFAULT_INSTALLED_HOST_RETRIEVAL_PROFILE
      : readRetrievalProfile(parsed.retrievalProfile);
  if (retrievalProfile === undefined) {
    return {
      detail: "retrievalProfile must be coding_agent or general_chat",
      status: "invalid",
    };
  }

  const sessionStartMaxTokens = readOptionalPositiveInteger(
    parsed.sessionStartMaxTokens,
  );
  if (parsed.sessionStartMaxTokens !== undefined && sessionStartMaxTokens === undefined) {
    return {
      detail: "sessionStartMaxTokens must be a positive integer",
      status: "invalid",
    };
  }

  if (
    parsed.promptInjection !== undefined &&
    parsed.promptInjection !== "always" &&
    parsed.promptInjection !== "relevance_gated"
  ) {
    return {
      detail: "promptInjection must be always or relevance_gated",
      status: "invalid",
    };
  }

  const storage = isRecord(parsed.storage) ? parsed.storage : null;
  const provider = readStorageProvider(storage?.provider);
  if (provider === undefined) {
    return {
      detail: "storage.provider must be memory, sqlite, or postgres",
      status: "invalid",
    };
  }

  const url = readStorageUrl(storage);
  if (url === null) {
    return {
      detail: "storage.path or storage.url must be a non-empty string",
      status: "invalid",
    };
  }

  const userId = normalizeText(readOptionalText(parsed, "userId"));
  if (userId === null) {
    return { detail: "userId must be a non-empty string", status: "invalid" };
  }

  const language = readInstalledHostLanguageConfig(parsed.language);
  if (language.status === "invalid") {
    return language;
  }

  const providers = readInstalledHostProviders(parsed.providers);
  if (providers.status === "invalid") {
    return {
      detail: providers.detail,
      status: "invalid",
    };
  }

  const retrieval = readInstalledHostRetrievalConfig(parsed.retrieval);
  if (retrieval.status === "invalid") {
    return {
      detail: retrieval.detail,
      status: "invalid",
    };
  }
  const fileMirror = readInstalledHostFileMirrorConfig(parsed.fileMirror);
  if (fileMirror.status === "invalid") {
    return { detail: fileMirror.detail, status: "invalid" };
  }

  let sharedAgents: string[] | undefined;
  if (parsed.sharedAgents !== undefined) {
    if (
      !Array.isArray(parsed.sharedAgents) ||
      parsed.sharedAgents.some(
        (agent) => typeof agent !== "string" || agent.trim().length === 0,
      )
    ) {
      return {
        detail: "sharedAgents must be an array of non-empty strings",
        status: "invalid",
      };
    }
    sharedAgents = [
      ...new Set(
        parsed.sharedAgents
          .map((agent) => (agent as string).trim())
          .filter((agent) => agent !== host),
      ),
    ];
  }

  let maintenance: InstalledHostMaintenanceConfig | undefined;
  if (parsed.maintenance !== undefined) {
    if (!isRecord(parsed.maintenance)) {
      return { detail: "maintenance must be a JSON object", status: "invalid" };
    }
    if (
      parsed.maintenance.auto !== undefined &&
      typeof parsed.maintenance.auto !== "boolean"
    ) {
      return { detail: "maintenance.auto must be a boolean", status: "invalid" };
    }
    const minHours =
      parsed.maintenance.minHoursBetweenRuns === undefined
        ? undefined
        : readPositiveInteger(parsed.maintenance.minHoursBetweenRuns);
    if (parsed.maintenance.minHoursBetweenRuns !== undefined && minHours === undefined) {
      return {
        detail: "maintenance.minHoursBetweenRuns must be a positive integer",
        status: "invalid",
      };
    }
    maintenance = {
      ...(typeof parsed.maintenance.auto === "boolean"
        ? { auto: parsed.maintenance.auto }
        : {}),
      ...(minHours !== undefined ? { minHoursBetweenRuns: minHours } : {}),
    };
  }

  if (parsed.mcp !== undefined) {
    if (!isRecord(parsed.mcp)) {
      return { detail: "mcp must be a JSON object", status: "invalid" };
    }
    if (
      parsed.mcp.allowWrite !== undefined &&
      typeof parsed.mcp.allowWrite !== "boolean"
    ) {
      return { detail: "mcp.allowWrite must be a boolean", status: "invalid" };
    }
  }

  return {
    status: "ok",
    config: {
      activationMode,
      contextMode,
      debug: parsed.debug === true,
      ...(language.config ? { language: language.config } : {}),
      maxTokens,
      ...(isRecord(parsed.mcp)
        ? { mcp: { allowWrite: parsed.mcp.allowWrite === true } }
        : {}),
      ...(providers.config ? { providers: providers.config } : {}),
      ...(parsed.promptInjection === "always" ||
      parsed.promptInjection === "relevance_gated"
        ? { promptInjection: parsed.promptInjection }
        : {}),
      ...(retrieval.config ? { retrieval: retrieval.config } : {}),
      retrievalProfile,
      ...(fileMirror.config ? { fileMirror: fileMirror.config } : {}),
      ...(sessionStartMaxTokens !== undefined ? { sessionStartMaxTokens } : {}),
      ...(sharedAgents !== undefined ? { sharedAgents } : {}),
      ...(maintenance !== undefined ? { maintenance } : {}),
      storage: {
        provider,
        url,
      },
      userId,
      writeback: writeback.config,
    },
  };
}

function readInstalledHostLanguageConfig(
  value: unknown,
):
  | { config?: InstalledHostLanguageConfig; status: "ok" }
  | { detail: string; status: "invalid" } {
  if (value === undefined) {
    return { status: "ok" };
  }
  if (!isRecord(value)) {
    return { detail: "language must be a JSON object", status: "invalid" };
  }
  if (Object.keys(value).some((key) => key !== "defaultLocale")) {
    return { detail: "language supports only defaultLocale", status: "invalid" };
  }
  if (typeof value.defaultLocale !== "string") {
    return {
      detail: "language.defaultLocale must be a valid non-empty locale",
      status: "invalid",
    };
  }
  try {
    return {
      config: Object.freeze({
        defaultLocale: canonicalizeInstalledHostDefaultLocale(value.defaultLocale),
      }),
      status: "ok",
    };
  } catch {
    return {
      detail: "language.defaultLocale must be a valid non-empty locale",
      status: "invalid",
    };
  }
}

function readActivationMode(
  value: unknown,
): InstalledHostActivationMode | undefined {
  return value === "global" || value === "workspace_opt_in" ? value : undefined;
}

export function readContextMode(value: unknown): InstalledHostContextMode | undefined {
  return value === "fragment" || value === "progressive" ? value : undefined;
}

function readAutoLearnConfig(
  value: unknown,
):
  | { config: InstalledHostAutoLearnConfig; status: "ok" }
  | { detail: string; status: "invalid" } {
  if (value === undefined) {
    return {
      config: DEFAULT_INSTALLED_HOST_AUTO_LEARN,
      status: "ok",
    };
  }
  if (!isRecord(value)) {
    return { detail: "autoLearn must be a JSON object", status: "invalid" };
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    return { detail: "autoLearn.enabled must be a boolean", status: "invalid" };
  }

  const extractionStrategy =
    value.extractionStrategy === undefined
      ? DEFAULT_INSTALLED_HOST_AUTO_LEARN.extractionStrategy
      : readAutoLearnExtractionStrategy(value.extractionStrategy);
  if (extractionStrategy === undefined) {
    return {
      detail: "autoLearn.extractionStrategy must be auto, rules-only, or llm-assisted",
      status: "invalid",
    };
  }

  const sources = readAutoLearnSources(value.sources);
  if (sources === undefined) {
    return {
      detail: "autoLearn.sources must be an array of user_prompt and session_stop",
      status: "invalid",
    };
  }

  return {
    config: {
      enabled: value.enabled === true,
      extractionStrategy,
      sources,
    },
    status: "ok",
  };
}

export function normalizeInstalledHostWritebackConfig(input: {
  legacyAutoLearn?: unknown;
  value?: unknown;
}): InstalledHostWritebackConfig {
  const parsed = readWritebackConfig(input);
  return parsed.status === "ok" ? parsed.config : DEFAULT_INSTALLED_HOST_WRITEBACK;
}

function readWritebackConfig(input: {
  legacyAutoLearn?: unknown;
  value?: unknown;
}):
  | { config: InstalledHostWritebackConfig; status: "ok" }
  | { detail: string; status: "invalid" } {
  if (input.value === undefined) {
    return {
      config: readLegacyAutoLearnWritebackConfig(input.legacyAutoLearn),
      status: "ok",
    };
  }
  if (!isRecord(input.value)) {
    return { detail: "writeback must be a JSON object", status: "invalid" };
  }

  const mode =
    input.value.mode === undefined
      ? DEFAULT_INSTALLED_HOST_WRITEBACK.mode
      : readWritebackMode(input.value.mode);
  if (mode === undefined) {
    return {
      detail: "writeback.mode must be off, observe, review, or selective",
      status: "invalid",
    };
  }

  const allowAssistantOutput =
    input.value.allowAssistantOutput === undefined
      ? DEFAULT_INSTALLED_HOST_WRITEBACK.allowAssistantOutput
      : readWritebackAssistantPolicy(input.value.allowAssistantOutput);
  if (allowAssistantOutput === undefined) {
    return {
      detail:
        "writeback.allowAssistantOutput must be never, confirmed, verified, or confirmed_or_verified",
      status: "invalid",
    };
  }

  if (
    input.value.persistRawTranscript !== undefined &&
    input.value.persistRawTranscript !== false
  ) {
    return {
      detail: "writeback.persistRawTranscript must be false",
      status: "invalid",
    };
  }
  if (
    input.value.dryRun !== undefined &&
    typeof input.value.dryRun !== "boolean"
  ) {
    return { detail: "writeback.dryRun must be a boolean", status: "invalid" };
  }

  const maxMessages =
    input.value.maxMessages === undefined
      ? DEFAULT_INSTALLED_HOST_WRITEBACK.maxMessages
      : readPositiveInteger(input.value.maxMessages);
  if (maxMessages === undefined) {
    return {
      detail: "writeback.maxMessages must be a positive integer",
      status: "invalid",
    };
  }

  const maxChars =
    input.value.maxChars === undefined
      ? DEFAULT_INSTALLED_HOST_WRITEBACK.maxChars
      : readPositiveInteger(input.value.maxChars);
  if (maxChars === undefined) {
    return {
      detail: "writeback.maxChars must be a positive integer",
      status: "invalid",
    };
  }

  const minConfidence =
    input.value.minConfidence === undefined
      ? DEFAULT_INSTALLED_HOST_WRITEBACK.minConfidence
      : readConfidence(input.value.minConfidence);
  if (minConfidence === undefined) {
    return {
      detail: "writeback.minConfidence must be a number between 0 and 1",
      status: "invalid",
    };
  }

  const extractionStrategy =
    input.value.extractionStrategy === undefined
      ? undefined
      : readAutoLearnExtractionStrategy(input.value.extractionStrategy);
  if (input.value.extractionStrategy !== undefined && extractionStrategy === undefined) {
    return {
      detail:
        "writeback.extractionStrategy must be auto, rules-only, or llm-assisted",
      status: "invalid",
    };
  }

  return {
    config: {
      allowAssistantOutput,
      dryRun: input.value.dryRun === true,
      ...(extractionStrategy !== undefined ? { extractionStrategy } : {}),
      maxChars,
      maxMessages,
      minConfidence,
      mode,
      persistRawTranscript: false,
    },
    status: "ok",
  };
}

function readLegacyAutoLearnWritebackConfig(
  value: unknown,
): InstalledHostWritebackConfig {
  const legacy = readAutoLearnConfig(value);
  if (legacy.status === "invalid") {
    return DEFAULT_INSTALLED_HOST_WRITEBACK;
  }

  return {
    ...DEFAULT_INSTALLED_HOST_WRITEBACK,
    mode: legacy.config.enabled ? "selective" : "off",
  };
}

export function readWritebackMode(
  value: unknown,
): InstalledHostWritebackMode | undefined {
  return value === "off" ||
    value === "observe" ||
    value === "selective" ||
    value === "review"
    ? value
    : undefined;
}

function readWritebackAssistantPolicy(
  value: unknown,
): InstalledHostWritebackAssistantPolicy | undefined {
  return value === "never" ||
    value === "confirmed" ||
    value === "verified" ||
    value === "confirmed_or_verified"
    ? value
    : undefined;
}

function readConfidence(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : undefined;
}

function readAutoLearnExtractionStrategy(
  value: unknown,
): InstalledHostAutoLearnExtractionStrategy | undefined {
  return value === "auto" || value === "rules-only" || value === "llm-assisted"
    ? value
    : undefined;
}

function readAutoLearnSources(
  value: unknown,
): InstalledHostAutoLearnSource[] | undefined {
  if (value === undefined) {
    return [...DEFAULT_INSTALLED_HOST_AUTO_LEARN.sources];
  }
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sources = new Set<InstalledHostAutoLearnSource>();
  for (const candidate of value) {
    if (candidate !== "user_prompt" && candidate !== "session_stop") {
      return undefined;
    }
    sources.add(candidate);
  }

  return sources.size > 0
    ? [...sources]
    : [...DEFAULT_INSTALLED_HOST_AUTO_LEARN.sources];
}

export function parseWorkspaceHostOptInConfig(
  parsed: unknown,
  host: InstalledHostConfigTarget,
  workspaceRoot: string,
):
  | { config: WorkspaceHostOptInConfig; status: "disabled" | "ok" }
  | { detail: string; status: "invalid" } {
  if (!isRecord(parsed)) {
    return { detail: "root value must be a JSON object", status: "invalid" };
  }
  if (parsed.host !== host) {
    return {
      detail: "host value does not match the managed config target",
      status: "invalid",
    };
  }
  if (parsed.enabled !== undefined && typeof parsed.enabled !== "boolean") {
    return { detail: "enabled must be a boolean", status: "invalid" };
  }
  if (parsed.debug !== undefined && typeof parsed.debug !== "boolean") {
    return { detail: "debug must be a boolean", status: "invalid" };
  }

  const maxTokens = readOptionalPositiveInteger(parsed.maxTokens);
  if (parsed.maxTokens !== undefined && maxTokens === undefined) {
    return { detail: "maxTokens must be a positive integer", status: "invalid" };
  }

  const sessionStartMaxTokens = readOptionalPositiveInteger(
    parsed.sessionStartMaxTokens,
  );
  if (parsed.sessionStartMaxTokens !== undefined && sessionStartMaxTokens === undefined) {
    return {
      detail: "sessionStartMaxTokens must be a positive integer",
      status: "invalid",
    };
  }

  const retrievalProfile = readOptionalRetrievalProfile(parsed.retrievalProfile);
  if (parsed.retrievalProfile !== undefined && retrievalProfile === undefined) {
    return {
      detail: "retrievalProfile must be coding_agent or general_chat",
      status: "invalid",
    };
  }

  const contextMode = readOptionalContextMode(parsed.contextMode);
  if (parsed.contextMode !== undefined && contextMode === undefined) {
    return {
      detail: "contextMode must be fragment or progressive",
      status: "invalid",
    };
  }

  const enabled = parsed.enabled !== false;
  return {
    status: enabled ? "ok" : "disabled",
    config: {
      debug: parsed.debug === true,
      enabled,
      contextMode,
      maxTokens,
      retrievalProfile,
      sessionStartMaxTokens,
      workspaceId:
        normalizeText(readOptionalText(parsed, "workspaceId")) ??
        resolveWorkspaceId(workspaceRoot, undefined),
    },
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

export function readOptionalText(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

export function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
  return value === undefined ? undefined : readPositiveInteger(value);
}

export function readRetrievalProfile(
  value: unknown,
): "coding_agent" | "general_chat" | undefined {
  return value === "coding_agent" || value === "general_chat" ? value : undefined;
}

function readOptionalRetrievalProfile(
  value: unknown,
): "coding_agent" | "general_chat" | undefined {
  return value === undefined ? undefined : readRetrievalProfile(value);
}

export function readOptionalContextMode(
  value: unknown,
): InstalledHostContextMode | undefined {
  return value === undefined ? undefined : readContextMode(value);
}

export function readStorageProvider(
  value: unknown,
): "memory" | "postgres" | "sqlite" | undefined {
  return value === "memory" || value === "postgres" || value === "sqlite"
    ? value
    : undefined;
}

export function readStorageUrl(storage: Record<string, unknown> | null): string | null {
  if (!storage) {
    return null;
  }
  return normalizeText(
    typeof storage.path === "string"
      ? storage.path
      : typeof storage.url === "string"
        ? storage.url
        : undefined,
  );
}

function readInstalledHostFileMirrorConfig(
  value: unknown,
):
  | { config?: InstalledHostFileMirrorConfig; status: "ok" }
  | { detail: string; status: "invalid" } {
  if (value === undefined) {
    return { status: "ok" };
  }
  if (!isRecord(value)) {
    return { detail: "fileMirror must be a JSON object", status: "invalid" };
  }
  if (typeof value.enabled !== "boolean") {
    return { detail: "fileMirror.enabled must be a boolean", status: "invalid" };
  }
  if (
    value.root !== undefined &&
    (typeof value.root !== "string" || value.root.trim().length === 0)
  ) {
    return { detail: "fileMirror.root must be a non-empty string", status: "invalid" };
  }
  return {
    config: {
      enabled: value.enabled,
      ...(typeof value.root === "string" ? { root: value.root } : {}),
    },
    status: "ok",
  };
}

function readInstalledHostRetrievalConfig(
  value: unknown,
):
  | { config?: InstalledHostRetrievalConfig; status: "ok" }
  | { detail: string; status: "invalid" } {
  if (value === undefined) {
    return { status: "ok" };
  }
  if (!isRecord(value)) {
    return { detail: "retrieval must be a JSON object", status: "invalid" };
  }

  if (value.bm25Ranking !== undefined && typeof value.bm25Ranking !== "boolean") {
    return {
      detail: "retrieval.bm25Ranking must be a boolean",
      status: "invalid",
    };
  }

  if (
    value.longRecordAdmission !== undefined &&
    typeof value.longRecordAdmission !== "boolean"
  ) {
    return {
      detail: "retrieval.longRecordAdmission must be a boolean",
      status: "invalid",
    };
  }

  if (value.preset !== undefined && value.preset !== "recommended") {
    return { detail: "retrieval.preset must be recommended", status: "invalid" };
  }

  let semanticCandidates:
    | InstalledHostRetrievalConfig["semanticCandidates"]
    | undefined;
  if (value.semanticCandidates !== undefined) {
    if (!isRecord(value.semanticCandidates)) {
      return {
        detail: "retrieval.semanticCandidates must be a JSON object",
        status: "invalid",
      };
    }
    const candidates = value.semanticCandidates;
    const topK =
      candidates.topK === undefined
        ? undefined
        : readPositiveInteger(candidates.topK);
    if (candidates.topK !== undefined && topK === undefined) {
      return {
        detail: "retrieval.semanticCandidates.topK must be a positive integer",
        status: "invalid",
      };
    }
    const maxAdditions =
      candidates.maxAdditions === undefined
        ? undefined
        : readPositiveInteger(candidates.maxAdditions);
    if (candidates.maxAdditions !== undefined && maxAdditions === undefined) {
      return {
        detail:
          "retrieval.semanticCandidates.maxAdditions must be a positive integer",
        status: "invalid",
      };
    }
    const minSimilarity =
      candidates.minSimilarity === undefined
        ? undefined
        : readConfidence(candidates.minSimilarity);
    if (candidates.minSimilarity !== undefined && minSimilarity === undefined) {
      return {
        detail:
          "retrieval.semanticCandidates.minSimilarity must be a number between 0 and 1",
        status: "invalid",
      };
    }
    const minRelativeScore =
      candidates.minRelativeScore === undefined
        ? undefined
        : readConfidence(candidates.minRelativeScore);
    if (
      candidates.minRelativeScore !== undefined &&
      minRelativeScore === undefined
    ) {
      return {
        detail:
          "retrieval.semanticCandidates.minRelativeScore must be a number between 0 and 1",
        status: "invalid",
      };
    }
    semanticCandidates = {
      ...(maxAdditions !== undefined ? { maxAdditions } : {}),
      ...(minRelativeScore !== undefined ? { minRelativeScore } : {}),
      ...(minSimilarity !== undefined ? { minSimilarity } : {}),
      ...(topK !== undefined ? { topK } : {}),
    };
  }

  return {
    config: {
      ...(typeof value.bm25Ranking === "boolean"
        ? { bm25Ranking: value.bm25Ranking }
        : {}),
      ...(typeof value.longRecordAdmission === "boolean"
        ? { longRecordAdmission: value.longRecordAdmission }
        : {}),
      ...(value.preset === "recommended" ? { preset: value.preset } : {}),
      ...(semanticCandidates !== undefined ? { semanticCandidates } : {}),
    },
    status: "ok",
  };
}

function readInstalledHostProviders(
  value: unknown,
):
  | { config?: InstalledHostProviderConfig; status: "ok" }
  | { detail: string; status: "invalid" } {
  if (value === undefined) {
    return { status: "ok" };
  }
  if (!isRecord(value)) {
    return { detail: "providers must be a JSON object", status: "invalid" };
  }

  const embedding = readEmbeddingProviderConfig(value.embedding);
  if (embedding.status === "invalid") {
    return embedding;
  }

  const assistedExtractor = readModelProviderConfig(
    value.assistedExtractor,
    "providers.assistedExtractor",
  );
  if (assistedExtractor.status === "invalid") {
    return assistedExtractor;
  }

  const config: InstalledHostProviderConfig = {
    ...(embedding.config ? { embedding: embedding.config } : {}),
    ...(assistedExtractor.config
      ? { assistedExtractor: assistedExtractor.config }
      : {}),
  };

  return Object.keys(config).length > 0
    ? { config, status: "ok" }
    : { status: "ok" };
}

function readEmbeddingProviderConfig(
  value: unknown,
):
  | { config?: InstalledHostEmbeddingProviderConfig; status: "ok" }
  | { detail: string; status: "invalid" } {
  const result = readModelProviderConfig(value, "providers.embedding");
  if (result.status === "invalid") {
    return result;
  }
  if (!result.config) {
    return { status: "ok" };
  }
  if (result.config.provider !== "openai") {
    return {
      detail: "providers.embedding.provider must be openai",
      status: "invalid",
    };
  }

  return {
    config: {
      ...result.config,
      provider: "openai",
    },
    status: "ok",
  };
}

function readModelProviderConfig(
  value: unknown,
  field: string,
):
  | { config?: InstalledHostModelProviderConfig; status: "ok" }
  | { detail: string; status: "invalid" } {
  if (value === undefined) {
    return { status: "ok" };
  }
  if (!isRecord(value)) {
    return { detail: `${field} must be a JSON object`, status: "invalid" };
  }

  const provider = readModelProvider(value.provider);
  if (!provider) {
    return {
      detail: `${field}.provider must be openai or anthropic`,
      status: "invalid",
    };
  }

  const model = normalizeText(
    typeof value.model === "string" ? value.model : undefined,
  );
  if (!model) {
    return { detail: `${field}.model must be a non-empty string`, status: "invalid" };
  }

  const apiKey = normalizeText(
    typeof value.apiKey === "string" ? value.apiKey : undefined,
  );
  if (!apiKey) {
    return { detail: `${field}.apiKey must be a non-empty string`, status: "invalid" };
  }

  const baseURL = normalizeText(
    typeof value.baseURL === "string" ? value.baseURL : undefined,
  );

  return {
    config: {
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      model,
      provider,
    },
    status: "ok",
  };
}

function readModelProvider(value: unknown): "anthropic" | "openai" | undefined {
  return value === "anthropic" || value === "openai" ? value : undefined;
}
