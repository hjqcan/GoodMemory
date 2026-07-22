import { randomBytes } from "node:crypto";

import type { GoodMemory } from "../api/contracts";
import { scopeToKey } from "../domain/scope";
import {
  createInstalledHostDocumentStore,
  createInstalledHostMemory,
  resolveInstalledHostContext,
} from "../install/hostExecutionContext";
import {
  PROJECTION_SEARCH_SCHEMA_VERSION,
  RECALL_PROJECTION_PIPELINE_VERSION,
  SCOPE_CATALOG_COLLECTION,
  type ScopeCatalogProjection,
} from "../recall/projections/contracts";
import {
  createInspectorApp,
  normalizeInspectorBindHost,
  serveInspector,
} from "../inspector/public";
import {
  redactScopeText,
  redactViewerText,
  sanitizeViewerValue,
} from "../inspector/redaction";
import { createInMemoryDocumentStore } from "../storage/memory";
import type { DocumentStore, StorageDocument } from "../storage/contracts";
import type {
  CreateInstalledHostRuntimeViewerAppInput,
  CreateRuntimeViewerAppInput,
  RuntimeViewerApp,
  RuntimeViewerServerHandle,
} from "./contracts";

export { redactScopeText, redactViewerText, sanitizeViewerValue };

export function createRuntimeViewerToken(): string {
  return `gmviewer_${randomBytes(32).toString("base64url")}`;
}

export function normalizeRuntimeViewerBindHost(
  value: string | undefined,
): "127.0.0.1" {
  try {
    return normalizeInspectorBindHost(value);
  } catch {
    throw new Error("GoodMemory runtime viewer only binds 127.0.0.1.");
  }
}

/** @deprecated Use createInspectorApp({ readOnly: true }) instead. */
export function createRuntimeViewerApp(
  input: CreateRuntimeViewerAppInput,
): RuntimeViewerApp {
  const token = input.token ?? createRuntimeViewerToken();
  const bindHost = normalizeRuntimeViewerBindHost(input.bindHost);
  let delegate: Promise<ReturnType<typeof createInspectorApp>> | undefined;

  return {
    token,
    fetch(request) {
      delegate ??= createSnapshotInspector(input, bindHost, token);
      return delegate.then((app) => app.fetch(request));
    },
  };
}

/** @deprecated Use GoodMemory Inspector in read-only mode instead. */
export async function createInstalledHostRuntimeViewerApp(
  input: CreateInstalledHostRuntimeViewerAppInput,
): Promise<RuntimeViewerApp> {
  const resolved = await resolveInstalledHostContext({
    cwd: input.cwd,
    homeRoot: input.homeRoot,
    host: input.host,
  });
  if (resolved.status !== "ok") {
    throw new Error(`Cannot start GoodMemory runtime viewer: ${resolved.status}.`);
  }
  const token = input.token ?? createRuntimeViewerToken();
  return createInspectorApp({
    allowedScopeKey: scopeToKey(resolved.context.scope),
    bindHost: normalizeRuntimeViewerBindHost(input.bindHost),
    documentStore: createInstalledHostDocumentStore(resolved.context),
    homeRoot: input.homeRoot,
    memory: createInstalledHostMemory(resolved.context),
    readOnly: true,
    token,
  });
}

/** @deprecated Runs the scope-bound, read-only Inspector. */
export async function serveRuntimeViewer(
  input: CreateInstalledHostRuntimeViewerAppInput,
): Promise<RuntimeViewerServerHandle> {
  const resolved = await resolveInstalledHostContext({
    cwd: input.cwd,
    homeRoot: input.homeRoot,
    host: input.host,
  });
  if (resolved.status !== "ok") {
    throw new Error(`Cannot start GoodMemory runtime viewer: ${resolved.status}.`);
  }
  return serveInspector({
    allowedScopeKey: scopeToKey(resolved.context.scope),
    bindHost: normalizeRuntimeViewerBindHost(input.bindHost),
    documentStore: createInstalledHostDocumentStore(resolved.context),
    homeRoot: input.homeRoot,
    memory: createInstalledHostMemory(resolved.context),
    port: input.port,
    readOnly: true,
    token: input.token ?? createRuntimeViewerToken(),
  });
}

async function createSnapshotInspector(
  input: CreateRuntimeViewerAppInput,
  bindHost: "127.0.0.1",
  token: string,
): Promise<ReturnType<typeof createInspectorApp>> {
  const documentStore = createInMemoryDocumentStore();
  const exported = await input.memory.exportMemory({
    includeRuntime: true,
    scope: input.scope,
  });
  await materializeDurableSnapshot(documentStore, exported.durable, input.scope);
  const timestamp = input.now?.().toISOString() ?? new Date().toISOString();
  const scopeKey = scopeToKey(input.scope);
  await documentStore.set<ScopeCatalogProjection>(
    SCOPE_CATALOG_COLLECTION,
    `scope:${scopeKey}`,
    {
      ...input.scope,
      analyzerFingerprint: null,
      coverage: "complete",
      firstSeenAt: timestamp,
      id: `scope:${scopeKey}`,
      lastSeenAt: timestamp,
      projectionVersion: RECALL_PROJECTION_PIPELINE_VERSION,
      schemaVersion: 2,
      searchSchemaVersion: PROJECTION_SEARCH_SCHEMA_VERSION,
      scopeKey,
    },
  );
  return createInspectorApp({
    allowedScopeKey: scopeKey,
    bindHost,
    documentStore,
    memory: input.memory as GoodMemory,
    readOnly: true,
    token,
    webRoot: input.webRoot,
  });
}

async function materializeDurableSnapshot(
  documentStore: DocumentStore,
  durable: Awaited<ReturnType<GoodMemory["exportMemory"]>>["durable"],
  scope: CreateRuntimeViewerAppInput["scope"],
): Promise<void> {
  const collections: Array<[string, StorageDocument[]]> = [
    ["episodes", durable.episodes],
    ["facts", durable.facts],
    ["feedback", durable.feedback],
    ["preferences", durable.preferences],
    ["references", durable.references],
    ["session_archives", durable.archives],
    ["profiles", durable.profile ? [durable.profile] : []],
  ];
  for (const [collection, documents] of collections) {
    for (const document of documents) {
      const record = document as Record<string, unknown>;
      const id = typeof record.id === "string"
        ? record.id
        : collection === "profiles"
          ? scope.userId
          : undefined;
      if (id) {
        await documentStore.set(collection, id, { ...scope, ...document, id });
      }
    }
  }
}
