import { access, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createGoodMemory } from "../api/createGoodMemory";
import { resolveStoragePlan } from "../api/runtimeResolution";
import { normalizeScope } from "../domain/scope";
import { createInstalledHostMemory, resolveInstalledHostContext } from "../install/hostExecutionContext";
import { createInMemoryVectorStore } from "../storage/memory";
import {
  canBootstrapPostgresStorageBackend,
  createPostgresDocumentStore,
  createPostgresSessionStore,
  createPostgresVectorStore,
  probeReadOnlyPostgresStorageBackend,
} from "../storage/postgres";
import {
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
  createSQLiteVectorStore,
} from "../storage/sqlite";
import type {
  GoodMemory,
  RecallInput,
  RecallResult,
} from "../api/contracts";
import type { MemoryScope } from "../domain/scope";
import type { InstalledHostResolvedContext } from "../install/hostExecutionContext";
import type { InstalledHostKind } from "../install/hostInstall";
import type {
  CLICommandOutput,
  CLIResult,
  CLIStorageConfig,
  CLIStorageResolutionDependencies,
  DiagnosticMemoryOptions,
  ParsedFlags,
} from "./contracts";

interface InternalDiagnosticGoodMemory extends GoodMemory {
  diagnoseRecall(input: RecallInput): Promise<RecallResult>;
}
export function flagEnabled(flags: ParsedFlags, name: string): boolean {
  return flags[name] === "true";
}

export function requireFlag(flags: ParsedFlags, name: string): string {
  const value = flags[name];
  if (!value) {
    throw new Error(`Missing required flag --${name}`);
  }

  return value;
}

export function clipText(content: string, maxLength = 100): string {
  return content.length <= maxLength
    ? content
    : `${content.slice(0, maxLength - 3)}...`;
}

export function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

export function formatCountBreakdown(
  counts: Record<string, number> | undefined,
): string | null {
  if (!counts || Object.keys(counts).length === 0) {
    return null;
  }

  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

export function formatCountLine(
  label: string,
  total: number | undefined,
  counts: Record<string, number> | undefined,
): string {
  if (total === undefined) {
    return `${label}: unknown`;
  }

  const breakdown = formatCountBreakdown(counts);
  return breakdown ? `${label}: ${total} (${breakdown})` : `${label}: ${total}`;
}

export function formatScope(scope: MemoryScope): string {
  const parts = [
    `user=${scope.userId}`,
    ...(scope.tenantId ? [`tenant=${scope.tenantId}`] : []),
    ...(scope.workspaceId ? [`workspace=${scope.workspaceId}`] : []),
    ...(scope.agentId ? [`agent=${scope.agentId}`] : []),
    ...(scope.sessionId ? [`session=${scope.sessionId}`] : []),
  ];

  return parts.join(", ");
}

export function resolveSQLiteURL(rawPath: string | undefined): string {
  if (!rawPath || rawPath.trim().length === 0) {
    return resolve(".goodmemory/memory.sqlite");
  }

  return rawPath === ":memory:" ? rawPath : resolve(rawPath);
}

export function describeStorageProbeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

export async function resolveStorageConfig(
  flags: ParsedFlags,
  options?: DiagnosticMemoryOptions,
  dependencies?: CLIStorageResolutionDependencies,
): Promise<CLIStorageConfig> {
  const pathExistsFn = dependencies?.pathExists ?? pathExists;
  const mkdirFn = dependencies?.mkdir ?? mkdir;
  const canBootstrapPostgresBackend =
    dependencies?.canBootstrapPostgresStorageBackend ??
    canBootstrapPostgresStorageBackend;
  const probeReadOnlyPostgresBackend =
    dependencies?.probeReadOnlyPostgresStorageBackend ??
    probeReadOnlyPostgresStorageBackend;
  const plan = resolveStoragePlan({
    storage: {
      provider:
        flags["storage-provider"] === undefined
          ? undefined
          : (flags["storage-provider"] as CLIStorageConfig["provider"]),
      url: flags["storage-url"],
    },
  });

  if (plan.mode === "explicit") {
    if (plan.storage.provider === "postgres") {
      return {
        provider: "postgres",
        url: plan.storage.url,
        displayValue: "configured",
      };
    }

    if (plan.storage.provider === "memory") {
      return {
        provider: "memory",
        displayValue: "in-memory",
      };
    }

    const url = resolveSQLiteURL(plan.storage.url);
    if (options?.readOnlyStorage && url !== ":memory:" && !(await pathExistsFn(url))) {
      throw new Error(
        `Read-only CLI commands require an existing sqlite database at ${url}; they do not create local sqlite state implicitly.`,
      );
    }

    if (!options?.readOnlyStorage && url !== ":memory:") {
      await mkdirFn(dirname(url), { recursive: true });
    }

    return {
      provider: "sqlite",
      url,
      displayValue: url,
    };
  }

  if (plan.postgresUrl) {
    try {
      if (options?.readOnlyStorage) {
        const probe = await probeReadOnlyPostgresBackend({
          url: plan.postgresUrl,
        });

        if (probe === "readable") {
          return {
            provider: "postgres",
            url: plan.postgresUrl,
            displayValue: "configured",
          };
        }

        if (probe === "inconclusive") {
          throw new Error(
            [
              "CLI auto storage could not safely determine whether the configured postgres backend remains the durable authority without mutating state.",
              "Falling back to sqlite would inspect the wrong durable authority.",
            ].join(" "),
          );
        }
      } else if (
        await canBootstrapPostgresBackend({
          url: plan.postgresUrl,
        })
      ) {
        return {
          provider: "postgres",
          url: plan.postgresUrl,
          displayValue: "configured",
        };
      }
    } catch (error) {
      if (options?.readOnlyStorage) {
        throw new Error(
          [
            "CLI auto storage could not verify the configured postgres backend without mutating durable authority.",
            "Falling back to sqlite would inspect the wrong durable authority.",
            `Underlying error: ${describeStorageProbeError(error)}`,
          ].join(" "),
        );
      }

      throw new Error(
        [
          "CLI auto storage could not establish the configured postgres backend as usable durable authority.",
          "Falling back to sqlite would inspect the wrong durable authority.",
          `Underlying error: ${describeStorageProbeError(error)}`,
        ].join(" "),
      );
    }
  }

  const url = resolveSQLiteURL(
    "sqliteUrl" in plan ? plan.sqliteUrl : undefined,
  );
  if (options?.readOnlyStorage && url !== ":memory:" && !(await pathExistsFn(url))) {
    throw new Error(
      `Read-only CLI commands require an existing sqlite database at ${url}; they do not create local sqlite state implicitly.`,
    );
  }

  if (!options?.readOnlyStorage && url !== ":memory:") {
    await mkdirFn(dirname(url), { recursive: true });
  }

  return {
    provider: "sqlite",
    url,
    displayValue: url,
  };
}

export async function createDiagnosticMemory(
  flags: ParsedFlags,
  options?: DiagnosticMemoryOptions,
): Promise<{
  memory: InternalDiagnosticGoodMemory;
  storage: CLIStorageConfig;
}> {
  const storage = await resolveStorageConfig(flags, options);
  const readOnlySQLiteAdapters =
    options?.readOnlyStorage &&
    storage.provider === "sqlite" &&
    storage.url &&
    storage.url !== ":memory:"
      ? {
          documentStore: createSQLiteDocumentStore(storage.url, {
            readOnly: true,
          }),
          sessionStore: createSQLiteSessionStore(storage.url, {
            readOnly: true,
          }),
          vectorStore:
            options?.includeVectorStore === false
              ? createInMemoryVectorStore()
              : createSQLiteVectorStore(storage.url, {
                  readOnly: true,
                }),
        }
      : undefined;
  const readOnlyPostgresAdapters =
    options?.readOnlyStorage &&
    storage.provider === "postgres" &&
    storage.url
      ? {
          documentStore: createPostgresDocumentStore(
            { url: storage.url },
            { readOnly: true },
          ),
          sessionStore: createPostgresSessionStore(
            { url: storage.url },
            { readOnly: true },
          ),
          vectorStore:
            options?.includeVectorStore === false
              ? createInMemoryVectorStore()
              : createPostgresVectorStore(
                  { url: storage.url },
                  { readOnly: true },
                ),
        }
      : undefined;

  return {
    memory: createGoodMemory({
      adapters: readOnlySQLiteAdapters ?? readOnlyPostgresAdapters,
      storage: {
        provider: storage.provider,
        url: storage.url,
      },
    }) as InternalDiagnosticGoodMemory,
    storage,
  };
}

export function createIgnoredDiagnosticMemory(): {
  memory: InternalDiagnosticGoodMemory;
  storage: CLIStorageConfig;
} {
  return {
    memory: createGoodMemory({
      storage: {
        provider: "memory",
      },
    }) as InternalDiagnosticGoodMemory,
    storage: {
      provider: "memory",
      displayValue: "ignored (--ignore-memory)",
    },
  };
}

interface WriteExecutionContext {
  host?: InstalledHostKind;
  memory: GoodMemory;
  scope: MemoryScope;
  storage: CLIStorageConfig;
  workspaceRoot?: string;
}

export async function resolveWriteExecutionContext(
  flags: ParsedFlags,
): Promise<WriteExecutionContext> {
  const host = flags.host ? requireInstalledHostKind(flags.host) : undefined;

  if (!host) {
    const storage = await resolveStorageConfig(flags);
    return {
      memory: createGoodMemory({
        storage: {
          provider: storage.provider,
          url: storage.url,
        },
      }),
      scope: resolveScopeFromFlags(flags),
      storage,
    };
  }

  const resolved = await resolveInstalledHostContext({
    cwd: flags["workspace-root"],
    host,
    sessionId: flags["session-id"],
  });
  if (resolved.status !== "ok") {
    throw new Error(buildInstalledHostWriteErrorMessage(host, resolved));
  }

  const hasExplicitStorage =
    flags["storage-provider"] !== undefined || flags["storage-url"] !== undefined;
  const storage = hasExplicitStorage
    ? await resolveStorageConfig(flags)
    : {
        provider: resolved.context.storage?.provider ?? "memory",
        url: resolved.context.storage?.url,
        displayValue: describeStorageDisplayValue({
          provider: resolved.context.storage?.provider ?? "memory",
          url: resolved.context.storage?.url ?? "",
        }),
      };
  const scope = normalizeScope({
    userId: flags["user-id"] ?? resolved.context.scope.userId,
    tenantId: flags["tenant-id"],
    workspaceId: flags["workspace-id"] ?? resolved.context.scope.workspaceId,
    agentId: flags["agent-id"] ?? resolved.context.scope.agentId,
    sessionId: flags["session-id"] ?? resolved.context.scope.sessionId,
  });

  return {
    host,
    memory: hasExplicitStorage
      ? createGoodMemory({
          storage: {
            provider: storage.provider,
            url: storage.url,
          },
        })
      : createInstalledHostMemory(resolved.context),
    scope,
    storage,
    workspaceRoot: resolved.context.workspaceRoot,
  };
}

export function buildInstalledHostWriteErrorMessage(
  host: InstalledHostKind,
  resolved: Exclude<
    Awaited<ReturnType<typeof resolveInstalledHostContext>>,
    { status: "ok" }
  >,
): string {
  if (resolved.status === "missing_global_config") {
    return `Run 'goodmemory install ${host}' first before using '--host ${host}'.`;
  }
  if (resolved.status === "invalid_global_config") {
    return `Installed ${host} host config is invalid. Reinstall with 'goodmemory install ${host}' or fix ~/.goodmemory/${host}.json before using '--host ${host}'.`;
  }
  if (resolved.status === "invalid_repo_config") {
    return `Installed ${host} repo config at ${join(resolved.workspaceRoot, ".goodmemory", `${host}.json`)} is invalid. Fix it before using '--host ${host}'.`;
  }

  return `Run 'goodmemory enable ${host} --workspace-root ${resolved.workspaceRoot}' first before using '--host ${host}'.`;
}

export function resolveScopeFromFlags(flags: ParsedFlags): MemoryScope {
  return normalizeScope({
    userId: requireFlag(flags, "user-id"),
    tenantId: flags["tenant-id"],
    workspaceId: flags["workspace-id"],
    agentId: flags["agent-id"],
    sessionId: flags["session-id"],
  });
}

export function shouldIncludeRuntime(flags: ParsedFlags, scope: MemoryScope): boolean {
  return flagEnabled(flags, "include-runtime") || scope.sessionId !== undefined;
}

export function describeStorageDisplayValue(storage: {
  provider: "memory" | "postgres" | "sqlite";
  url?: string;
}): string {
  if (storage.provider === "memory") {
    return "in-memory";
  }
  if (storage.provider === "postgres") {
    return "configured";
  }

  return storage.url ?? "configured";
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export function renderOutput(
  output: CLICommandOutput,
  flags: ParsedFlags,
): CLIResult {
  return {
    exitCode: output.exitCode ?? 0,
    stderr: "",
    stdout: flagEnabled(flags, "json")
      ? `${JSON.stringify(output.json, null, 2)}\n`
      : output.text,
  };
}

export function normalizeOptionalFlag(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function readNonNegativeIntegerFlag(value: string, flagName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Unsupported --${flagName}: ${value}. Expected a non-negative integer.`);
  }
  return parsed;
}

export function requireInstalledHostKind(
  value: string | undefined,
): InstalledHostKind {
  if (value === "codex" || value === "claude") {
    return value;
  }

  throw new Error(
    `Unknown host target: ${value ?? "(missing)"}. Use 'codex' or 'claude'.`,
  );
}
