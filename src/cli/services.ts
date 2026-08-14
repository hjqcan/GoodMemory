import { join, resolve } from "node:path";
import { createGoodMemory } from "../api/createGoodMemory";
import { serveGoodMemoryMcp } from "../install/hostMcpServer";
import { resolveInstallRoot } from "../install/hostRuntimeConfig";
import {
  ensureStandaloneStorageReady,
  resolveInstalledHostMcpAllowWrite,
  resolveMcpServeOptions,
} from "../install/standaloneMcpContext";
import {
  buildDescriptor,
  createInspectorToken,
  normalizeInspectorBindHost,
  serveInspector,
} from "../inspector/public";
import { createRuntimeWorkerQueue } from "../runtime-worker/public";
import {
  createRuntimeViewerToken,
  normalizeRuntimeViewerBindHost,
  serveRuntimeViewer,
} from "../runtime-viewer/public";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../storage/memory";
import {
  createPostgresDocumentStore,
  createPostgresSessionStore,
  createPostgresVectorStore,
} from "../storage/postgres";
import { migratePostgresStorageBackend } from "../storage/postgresPublic";
import {
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
  createSQLiteVectorStore,
} from "../storage/sqlite";
import type {
  CLICommandOutput,
  CLIResult,
  CLIRunDependencies,
  CLIStorageConfig,
  ParsedFlags,
} from "./contracts";
import {
  flagEnabled,
  normalizeOptionalFlag,
  readNonNegativeIntegerFlag,
  renderOutput,
  requireFlag,
  requireInstalledHostKind,
  resolveStorageConfig,
} from "./shared";

const activeRuntimeViewerServers: Array<{ stop(): void }> = [];

function resolveRuntimeWorkerQueueFile(flags: ParsedFlags): string {
  return flags["queue-file"]
    ? resolve(flags["queue-file"])
    : join(resolveInstallRoot(undefined), "runtime-worker.json");
}
async function handleRuntimeWorker(
  command: string | undefined,
  flags: ParsedFlags,
): Promise<CLICommandOutput> {
  if (!command) {
    throw new Error("Runtime worker command is required. Run 'goodmemory runtime worker --help'.");
  }

  const queueFile = resolveRuntimeWorkerQueueFile(flags);
  const queue = createRuntimeWorkerQueue({ queueFile });
  if (command === "status") {
    const result = await queue.status();
    return {
      json: result,
      text: `${JSON.stringify(result, null, 2)}\n`,
    };
  }
  if (command === "drain-once") {
    const result = await queue.drainOnce({
      ...(flags["max-jobs"] !== undefined
        ? { maxJobs: readNonNegativeIntegerFlag(flags["max-jobs"], "max-jobs") }
        : {}),
    });
    return {
      json: result,
      text: `${JSON.stringify(result, null, 2)}\n`,
    };
  }
  if (command === "recover") {
    const result = await queue.recover({
      dryRun: !flagEnabled(flags, "apply"),
    });
    return {
      json: result,
      text: `${JSON.stringify(result, null, 2)}\n`,
    };
  }
  if (command === "start") {
    const result = await queue.start();
    return {
      json: result,
      text: `${JSON.stringify(result, null, 2)}\n`,
    };
  }
  if (command === "stop") {
    const result = await queue.stop();
    return {
      json: result,
      text: `${JSON.stringify(result, null, 2)}\n`,
    };
  }

  throw new Error(`Unknown runtime worker command: ${command}. Run 'goodmemory runtime worker --help'.`);
}

async function handleRuntimeViewer(flags: ParsedFlags): Promise<CLICommandOutput> {
  const host = requireInstalledHostKind(flags.host);
  const bindHost = normalizeRuntimeViewerBindHost(flags.bind);
  const port = flags.port !== undefined
    ? readNonNegativeIntegerFlag(flags.port, "port")
    : 0;
  const token = normalizeOptionalFlag(flags.token) ?? createRuntimeViewerToken();
  const payload = {
    bindHost,
    cors: false,
    deprecated: true,
    host,
    mutationRoutes: false,
    port,
    readOnly: true,
    rawTranscript: false,
    token,
    tokenRequired: true,
    url: `http://${bindHost}:${port}/#token=${encodeURIComponent(token)}`,
  };

  if (flagEnabled(flags, "dry-run")) {
    return {
      json: payload,
      text: `${JSON.stringify(payload, null, 2)}\n`,
    };
  }

  const server = await serveRuntimeViewer({
    bindHost,
    cwd: flags["workspace-root"],
    homeRoot: flags["home-root"],
    host,
    port,
    queueFile: flags["queue-file"],
    token,
  });
  activeRuntimeViewerServers.push(server);

  return {
    json: {
      ...payload,
      port: server.port,
      url: server.url,
    },
    text: [
      `GoodMemory runtime viewer is deprecated; read-only Inspector listening on ${server.url}`,
      "Bind: 127.0.0.1",
      "Mode: scope-bound read-only Inspector",
      "",
    ].join("\n"),
  };
}

function buildInspectorStores(storage: CLIStorageConfig) {
  if (storage.provider === "sqlite" && storage.url && storage.url !== ":memory:") {
    return {
      documentStore: createSQLiteDocumentStore(storage.url),
      sessionStore: createSQLiteSessionStore(storage.url),
      vectorStore: createSQLiteVectorStore(storage.url),
    };
  }
  if (storage.provider === "postgres" && storage.url) {
    return {
      documentStore: createPostgresDocumentStore({ url: storage.url }),
      sessionStore: createPostgresSessionStore({ url: storage.url }),
      vectorStore: createPostgresVectorStore({ url: storage.url }),
    };
  }
  return {
    documentStore: createInMemoryDocumentStore(),
    sessionStore: createInMemorySessionStore(),
    vectorStore: createInMemoryVectorStore(),
  };
}

async function handleInspectorServe(flags: ParsedFlags): Promise<CLICommandOutput> {
  const bindHost = normalizeInspectorBindHost(flags.bind);
  const port = flags.port !== undefined
    ? readNonNegativeIntegerFlag(flags.port, "port")
    : 0;
  const token = normalizeOptionalFlag(flags.token) ?? createInspectorToken();
  const payload = {
    ...buildDescriptor(bindHost),
    port,
    token,
    url: `http://${bindHost}:${port}/#token=${encodeURIComponent(token)}`,
  };

  if (flagEnabled(flags, "dry-run")) {
    return {
      json: payload,
      text: `${JSON.stringify(payload, null, 2)}\n`,
    };
  }

  const storage = await resolveStorageConfig(flags);
  const stores = buildInspectorStores(storage);
  const memory = createGoodMemory({
    adapters: stores,
    retrieval: { preset: "recommended" },
  });
  const homeRoot = normalizeOptionalFlag(flags["home-root"]);
  const server = serveInspector({
    documentStore: stores.documentStore,
    memory,
    ...(homeRoot ? { homeRoot } : {}),
    bindHost,
    port,
    token,
  });
  activeRuntimeViewerServers.push(server);

  return {
    json: { ...payload, port: server.port, url: server.url },
    text: [
      `GoodMemory Inspector listening on ${server.url}`,
      "Bind: 127.0.0.1",
      "Mode: read-only reads, gated writes (audited)",
      "",
    ].join("\n"),
  };
}

async function handleStorageMigration(
  flags: ParsedFlags,
  dependencies: CLIRunDependencies,
): Promise<CLICommandOutput> {
  const provider = normalizeOptionalFlag(flags["storage-provider"]);
  if (!provider) {
    throw new Error(
      "Storage migration requires explicit --storage-provider postgres.",
    );
  }
  if (provider !== "postgres") {
    throw new Error(
      "Storage migration only supports --storage-provider postgres.",
    );
  }

  const url = normalizeOptionalFlag(flags["storage-url"]);
  if (!url || url === "true") {
    throw new Error("Postgres storage migration requires --storage-url <url>.");
  }
  const schema = normalizeOptionalFlag(flags["storage-schema"]);
  const effectiveSchema = schema ?? "public";
  const migrate = dependencies.migratePostgresStorageBackend ??
    migratePostgresStorageBackend;

  try {
    await migrate({
      ...(schema ? { schema } : {}),
      url,
    });
  } catch {
    throw new Error("Postgres document-index migration failed.");
  }

  const payload = {
    provider: "postgres",
    schema: effectiveSchema,
    component: "document_indexes",
    status: "migrated",
  } as const;
  return {
    json: payload,
    text: `Postgres document-index migration completed for schema ${effectiveSchema}.\n`,
  };
}

async function handleMcpServe(flags: ParsedFlags): Promise<void> {
  const options = resolveMcpServeOptions({
    env: process.env,
    flags,
  });
  if (options.mode === "error") {
    throw new Error(options.message);
  }

  if (options.mode === "standalone") {
    ensureStandaloneStorageReady(options.config);
    await serveGoodMemoryMcp({
      allowWrite: options.allowWrite,
      standalone: options.config,
    });
    return;
  }

  await serveGoodMemoryMcp({
    // Installed hosts opt into the write tool via mcp.allowWrite in the host
    // config (flag/env still win); managed registration args stay untouched.
    allowWrite:
      options.allowWrite ||
      (await resolveInstalledHostMcpAllowWrite({ host: options.host })),
    host: options.host,
  });
}


export async function runServicesCommand(
  primary: string,
  commands: string[],
  flags: ParsedFlags,
  dependencies: CLIRunDependencies,
): Promise<CLIResult> {
  const secondary = commands[1];
  switch (primary) {
    case "mcp":
      if (secondary === "serve") {
        await handleMcpServe(flags);
        return { exitCode: 0, stderr: "", stdout: "" };
      }
      throw new Error(`Unknown MCP command: ${secondary}. Run 'goodmemory mcp --help'.`);
    case "storage":
      if (secondary === "migrate") {
        return renderOutput(await handleStorageMigration(flags, dependencies), flags);
      }
      throw new Error(
        `Unknown storage command: ${secondary}. Run 'goodmemory storage --help'.`,
      );
    case "runtime":
      if (secondary === "worker") {
        return renderOutput(await handleRuntimeWorker(commands[2], flags), flags);
      }
      if (secondary === "viewer") {
        return renderOutput(await handleRuntimeViewer(flags), flags);
      }
      throw new Error(`Unknown runtime command: ${secondary}. Run 'goodmemory runtime --help'.`);
    case "inspector":
      if (!secondary || secondary === "serve") {
        return renderOutput(await handleInspectorServe(flags), flags);
      }
      throw new Error(
        `Unknown inspector command: ${secondary}. Run 'goodmemory inspector --help'.`,
      );
    default:
      throw new Error(`Unknown command: ${primary}. Run 'goodmemory --help'.`);
  }
}
