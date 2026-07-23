import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as sqliteVss from "sqlite-vss";

export type SQLiteVectorExtensionMode = "off" | "prefer" | "require";
export type SQLiteVectorBackend = "none" | "sql-function" | "sqlite-vss";
export const DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION = "vss_inner_product";

interface EnvironmentMap {
  [key: string]: string | undefined;
}

export interface SQLiteCustomLibraryConfig {
  customLibraryPath?: string;
}

export interface SQLiteVectorExtensionConfig {
  backend: SQLiteVectorBackend;
  entryPoint?: string;
  mode: SQLiteVectorExtensionMode;
  path?: string;
  paths?: string[];
  searchFunction: string;
}

export interface SQLiteRuntimeConfig extends SQLiteCustomLibraryConfig {
  vectorExtension: SQLiteVectorExtensionConfig;
}

export interface SQLiteRuntimeDiagnostics {
  available: boolean;
  backend: SQLiteVectorBackend;
  effectiveMode: SQLiteVectorExtensionMode;
  reason?: string;
  requestedMode: SQLiteVectorExtensionMode;
  source: "bundled-sqlite-vss" | "disabled" | "env" | "unavailable";
}

export interface SQLiteRuntimeResolution {
  config: SQLiteRuntimeConfig;
  diagnostics: SQLiteRuntimeDiagnostics;
}

export interface BundledSQLiteVssRuntime {
  customLibraryPath: string;
  paths: string[];
}

export interface SQLiteVssRuntimeProbeResult {
  loadable: boolean;
  reason?: string;
}

export interface SQLiteVssRuntimeDetectionDependencies {
  exists?: (path: string) => boolean;
  getVectorLoadablePath?: () => string;
  getVssLoadablePath?: () => string;
  libraryCandidatePaths?: readonly string[];
  probeRuntime?: (
    runtime: BundledSQLiteVssRuntime,
  ) => SQLiteVssRuntimeProbeResult;
}

export interface SQLiteRuntimeDependencies {
  detectBundledSQLiteVssRuntime?: () => BundledSQLiteVssRuntime | null;
  inspectBundledSQLiteVssRuntime?: () => {
    runtime: BundledSQLiteVssRuntime | null;
    unavailableReason?: string;
  };
}

export interface SQLiteExtensionLoadResult {
  loaded: boolean;
  reason?: string;
}

interface SQLiteLibraryController {
  setCustomSQLite(path: string): boolean;
}

interface SQLiteLibraryRegistry {
  configuredPaths: WeakMap<SQLiteLibraryController, string>;
}

interface SQLiteExtensionLoader {
  loadExtension(path: string, entryPoint?: string): void;
}

const SQLITE_LIBRARY_REGISTRY_KEY = Symbol.for(
  "goodmemory.sqlite.library-registry",
);

const SQLITE_LIBRARY_CANDIDATE_PATHS = [
  "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
  "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
  "/usr/lib/x86_64-linux-gnu/libsqlite3.so",
  "/usr/lib/aarch64-linux-gnu/libsqlite3.so",
  "/usr/lib64/libsqlite3.so",
  "/usr/lib/libsqlite3.so",
] as const;

const SQLITE_VSS_RUNTIME_PROBE_SOURCE = `
  import { Database } from "bun:sqlite";

  const [customLibraryPath, vectorPath, vssPath] = process.argv.slice(1);
  if (!customLibraryPath || !vectorPath || !vssPath) {
    throw new Error("Missing sqlite-vss probe paths.");
  }

  Database.setCustomSQLite(customLibraryPath);
  const database = new Database(":memory:", { strict: true });

  try {
    database.loadExtension(vectorPath);
    database.loadExtension(vssPath);
    database.query("select vss_version() as version").get();
    database.exec(
      "CREATE VIRTUAL TABLE __goodmemory_vss_probe USING vss0(embedding(3)); DROP TABLE __goodmemory_vss_probe;",
    );
  } finally {
    database.close();
  }
`;

function normalizeNonEmpty(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeExtensionPaths(value: string | undefined): string[] {
  const normalized = normalizeNonEmpty(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function validateSearchFunction(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(
      `Unsupported GOODMEMORY_SQLITE_VECTOR_SEARCH_FUNCTION: ${value}. Expected a valid SQLite function identifier.`,
    );
  }

  return value;
}

function parseExplicitVectorMode(
  value: string | undefined,
): SQLiteVectorExtensionMode | undefined {
  const normalized = normalizeNonEmpty(value);
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "off" ||
    normalized === "prefer" ||
    normalized === "require"
  ) {
    return normalized;
  }

  throw new Error(
    `Unsupported GOODMEMORY_SQLITE_VECTOR_MODE: ${normalized}. Expected off|prefer|require.`,
  );
}

function buildConfig(input: {
  backend: SQLiteVectorBackend;
  customLibraryPath?: string;
  entryPoint?: string;
  mode: SQLiteVectorExtensionMode;
  path?: string;
  paths: string[];
  searchFunction: string;
}): SQLiteRuntimeConfig {
  const { backend, customLibraryPath, entryPoint, mode, path, paths, searchFunction } =
    input;

  return {
    customLibraryPath,
    vectorExtension: {
      backend,
      entryPoint,
      mode,
      path,
      paths,
      searchFunction,
    },
  };
}

function buildDisabledResolution(input: {
  customLibraryPath?: string;
  requestedMode: SQLiteVectorExtensionMode;
  searchFunction: string;
  source: "disabled" | "unavailable";
  reason?: string;
}): SQLiteRuntimeResolution {
  return {
    config: buildConfig({
      backend: "none",
      customLibraryPath: input.customLibraryPath,
      entryPoint: undefined,
      mode: "off",
      path: undefined,
      paths: [],
      searchFunction: input.searchFunction,
    }),
    diagnostics: {
      available: input.source === "disabled",
      backend: "none",
      effectiveMode: "off",
      reason: input.reason,
      requestedMode: input.requestedMode,
      source: input.source,
    },
  };
}

export function probeBundledSQLiteVssRuntime(
  runtime: BundledSQLiteVssRuntime,
): SQLiteVssRuntimeProbeResult {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      SQLITE_VSS_RUNTIME_PROBE_SOURCE,
      "--",
      runtime.customLibraryPath,
      ...runtime.paths,
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
    },
  );

  if (result.error) {
    return {
      loadable: false,
      reason: result.error.message,
    };
  }

  if (result.status !== 0) {
    const output = `${result.stdout}${result.stderr}`.trim();
    return {
      loadable: false,
      reason: output || `sqlite-vss probe exited with status ${result.status}`,
    };
  }

  return {
    loadable: true,
  };
}

function inspectBundledSQLiteVssRuntime(
  dependencies: SQLiteVssRuntimeDetectionDependencies = {},
): {
  runtime: BundledSQLiteVssRuntime | null;
  unavailableReason?: string;
} {
  const exists = dependencies.exists ?? existsSync;
  const customLibraryPath = (
    dependencies.libraryCandidatePaths ?? SQLITE_LIBRARY_CANDIDATE_PATHS
  ).find((path) => exists(path));

  if (!customLibraryPath) {
    return {
      runtime: null,
    };
  }

  try {
    const module = sqliteVss as typeof sqliteVss & {
      getVectorLoadablePath?: () => string;
      getVssLoadablePath?: () => string;
    };
    const getVectorLoadablePath = Object.hasOwn(
      dependencies,
      "getVectorLoadablePath",
    )
      ? dependencies.getVectorLoadablePath
      : module.getVectorLoadablePath;
    const getVssLoadablePath = Object.hasOwn(
      dependencies,
      "getVssLoadablePath",
    )
      ? dependencies.getVssLoadablePath
      : module.getVssLoadablePath;
    if (!getVectorLoadablePath || !getVssLoadablePath) {
      return {
        runtime: null,
      };
    }
    const vectorPath = getVectorLoadablePath();
    const vssPath = getVssLoadablePath();

    if (!exists(vectorPath) || !exists(vssPath)) {
      return {
        runtime: null,
      };
    }

    const runtime = {
      customLibraryPath,
      paths: [vectorPath, vssPath],
    };
    const probe = (dependencies.probeRuntime ?? probeBundledSQLiteVssRuntime)(
      runtime,
    );

    if (!probe.loadable) {
      return {
        runtime: null,
        unavailableReason:
          probe.reason ?? "Bundled sqlite-vss runtime probe failed.",
      };
    }

    return {
      runtime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      runtime: null,
      unavailableReason: `Failed to inspect bundled sqlite-vss runtime: ${message}`,
    };
  }
}

export function detectBundledSQLiteVssRuntime(
  dependencies: SQLiteVssRuntimeDetectionDependencies = {},
): BundledSQLiteVssRuntime | null {
  return inspectBundledSQLiteVssRuntime(dependencies).runtime;
}

export function resolveSQLiteRuntimeConfig(
  env: EnvironmentMap = process.env,
): SQLiteRuntimeConfig {
  const customLibraryPath = normalizeNonEmpty(
    env.GOODMEMORY_SQLITE_CUSTOM_LIBRARY_PATH,
  );
  const extensionPath = normalizeNonEmpty(
    env.GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH,
  );
  const extensionPaths = normalizeExtensionPaths(
    env.GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH,
  );
  const explicitMode = parseExplicitVectorMode(
    env.GOODMEMORY_SQLITE_VECTOR_MODE,
  );
  const searchFunction = validateSearchFunction(
    normalizeNonEmpty(env.GOODMEMORY_SQLITE_VECTOR_SEARCH_FUNCTION) ??
      DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION,
  );
  const mode =
    explicitMode ?? (extensionPaths.length > 0 ? "prefer" : "off");

  if (mode !== "off" && extensionPaths.length === 0) {
    throw new Error(
      "GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH is required when GOODMEMORY_SQLITE_VECTOR_MODE is prefer or require.",
    );
  }

  return buildConfig({
    backend: mode === "off" ? "none" : "sql-function",
    customLibraryPath,
    entryPoint: normalizeNonEmpty(
      env.GOODMEMORY_SQLITE_VECTOR_EXTENSION_ENTRYPOINT,
    ),
    mode,
    path: extensionPath,
    paths: mode === "off" ? [] : extensionPaths,
    searchFunction,
  });
}

export function resolveSQLiteRuntimeResolution(
  env: EnvironmentMap = process.env,
  dependencies?: SQLiteRuntimeDependencies,
): SQLiteRuntimeResolution {
  const explicitCustomLibraryPath = normalizeNonEmpty(
    env.GOODMEMORY_SQLITE_CUSTOM_LIBRARY_PATH,
  );
  const extensionPath = normalizeNonEmpty(
    env.GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH,
  );
  const extensionPaths = normalizeExtensionPaths(
    env.GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH,
  );
  const explicitMode = parseExplicitVectorMode(
    env.GOODMEMORY_SQLITE_VECTOR_MODE,
  );
  const searchFunction = validateSearchFunction(
    normalizeNonEmpty(env.GOODMEMORY_SQLITE_VECTOR_SEARCH_FUNCTION) ??
      DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION,
  );
  const entryPoint = normalizeNonEmpty(
    env.GOODMEMORY_SQLITE_VECTOR_EXTENSION_ENTRYPOINT,
  );
  const bundledRuntimeInspection = dependencies?.inspectBundledSQLiteVssRuntime
    ? dependencies.inspectBundledSQLiteVssRuntime()
    : dependencies?.detectBundledSQLiteVssRuntime
      ? {
          runtime: dependencies.detectBundledSQLiteVssRuntime(),
        }
      : inspectBundledSQLiteVssRuntime();
  const detectedRuntime = bundledRuntimeInspection.runtime;
  const bundledRuntimeUnavailableReason =
    bundledRuntimeInspection.unavailableReason;
  const requestedMode =
    explicitMode ??
    (extensionPaths.length > 0 ||
    detectedRuntime ||
    bundledRuntimeUnavailableReason
      ? "prefer"
      : "off");

  if (requestedMode === "off") {
    return buildDisabledResolution({
      customLibraryPath: explicitCustomLibraryPath,
      requestedMode,
      searchFunction,
      source: "disabled",
    });
  }

  if (extensionPaths.length > 0) {
    return {
      config: buildConfig({
        backend: "sql-function",
        customLibraryPath: explicitCustomLibraryPath,
        entryPoint,
        mode: requestedMode,
        path: extensionPath,
        paths: extensionPaths,
        searchFunction,
      }),
      diagnostics: {
        available: true,
        backend: "sql-function",
        effectiveMode: requestedMode,
        requestedMode,
        source: "env",
      },
    };
  }

  if (detectedRuntime) {
    const effectiveMode = requestedMode === "require" ? "require" : "prefer";
    return {
      config: buildConfig({
        backend: "sqlite-vss",
        customLibraryPath:
          explicitCustomLibraryPath ?? detectedRuntime.customLibraryPath,
        entryPoint,
        mode: effectiveMode,
        path: detectedRuntime.paths.join(","),
        paths: detectedRuntime.paths,
        searchFunction,
      }),
      diagnostics: {
        available: true,
        backend: "sqlite-vss",
        effectiveMode,
        requestedMode,
        source: "bundled-sqlite-vss",
      },
    };
  }

  return buildDisabledResolution({
    customLibraryPath: explicitCustomLibraryPath,
    requestedMode,
    searchFunction,
    source: "unavailable",
    reason:
      bundledRuntimeUnavailableReason ??
      "SQLite vector acceleration was requested, but no supported sqlite-vss runtime assets were detected and no manual GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH was configured.",
  });
}

export function applySQLiteCustomLibrary(
  config: SQLiteCustomLibraryConfig,
  controller: SQLiteLibraryController,
): void {
  if (!config.customLibraryPath) {
    return;
  }

  const globalRegistry = globalThis as typeof globalThis & {
    [key: symbol]: unknown;
  };
  const registry =
    (globalRegistry[SQLITE_LIBRARY_REGISTRY_KEY] as
      | SQLiteLibraryRegistry
      | undefined) ?? {
      configuredPaths: new WeakMap<SQLiteLibraryController, string>(),
    };
  globalRegistry[SQLITE_LIBRARY_REGISTRY_KEY] = registry;

  const configuredPath = registry.configuredPaths.get(controller);
  if (configuredPath === config.customLibraryPath) {
    return;
  }
  if (configuredPath) {
    throw new Error(
      `SQLite runtime already uses ${configuredPath} and cannot switch to ${config.customLibraryPath}.`,
    );
  }

  controller.setCustomSQLite(config.customLibraryPath);
  registry.configuredPaths.set(controller, config.customLibraryPath);
}

export function loadSQLiteVectorExtension(
  config: SQLiteVectorExtensionConfig,
  loader: SQLiteExtensionLoader,
): SQLiteExtensionLoadResult {
  if (config.mode === "off" || !(config.paths?.length ?? 0)) {
    return {
      loaded: false,
      reason: "SQLite vector acceleration is disabled.",
    };
  }

  try {
    for (const path of config.paths!) {
      loader.loadExtension(path, config.entryPoint);
    }

    return {
      loaded: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (config.mode === "prefer") {
      return {
        loaded: false,
        reason: `Failed to load SQLite vector extension at ${config.path}: ${message}`,
      };
    }

    throw new Error(
      `Failed to load SQLite vector extension at ${config.path}: ${message}`,
    );
  }
}

export function resolveSQLiteCustomLibraryConfig(
  env: EnvironmentMap = process.env,
): SQLiteCustomLibraryConfig {
  return {
    customLibraryPath: normalizeNonEmpty(
      env.GOODMEMORY_SQLITE_CUSTOM_LIBRARY_PATH,
    ),
  };
}

export function resolveSQLiteVectorExtensionConfig(
  env: EnvironmentMap = process.env,
): SQLiteVectorExtensionConfig {
  return resolveSQLiteRuntimeConfig(env).vectorExtension;
}
