import { createHash, randomUUID } from "node:crypto";

import type { MemoryScope } from "../../domain/scope";
import type { LanguageService } from "../../language";
import type {
  DocumentWriteOperation,
  ProjectionCapableDocumentStore,
  StorageDocument,
} from "../../storage/contracts";
import {
  PROJECTION_MANIFESTS_COLLECTION,
  PROJECTION_SEARCH_SCHEMA_VERSION,
  RECALL_PROJECTION_PIPELINE_VERSION,
  type RecallProjectionManifest,
} from "./contracts";
import {
  normalizeRecallScope,
  recallScopeKey,
} from "./shared";

interface UnchangedDocument {
  collection: string;
  document: StorageDocument | null;
  id: string;
}

export interface ProjectionManifestMutation {
  set: DocumentWriteOperation[];
  unchanged: UnchangedDocument[];
}

export interface ProjectionManifestTracker {
  enabled: boolean;
  beginValidation(scope: MemoryScope): Promise<RecallProjectionManifest | null>;
  completeValidation(
    manifest: RecallProjectionManifest | null,
  ): Promise<boolean>;
  hasValidProof(scope: MemoryScope): Promise<boolean>;
  invalidate(scope: MemoryScope): Promise<void>;
  prepareInvalidation(
    scopes: readonly MemoryScope[],
  ): Promise<ProjectionManifestMutation>;
}

function manifestId(scope: MemoryScope): string {
  return `scope:${recallScopeKey(scope)}`;
}

export function buildRecallProjectionBuildId(
  language: LanguageService,
): string | undefined {
  const languageManifest = language.getAnalyzerManifest();
  if (!languageManifest.persistable) {
    return undefined;
  }
  const digest = createHash("sha256")
    .update(JSON.stringify({
      language: languageManifest,
      projectionPipelineVersion: RECALL_PROJECTION_PIPELINE_VERSION,
      schemaVersion: 1,
      searchSchemaVersion: PROJECTION_SEARCH_SCHEMA_VERSION,
    }))
    .digest("hex");
  return `${RECALL_PROJECTION_PIPELINE_VERSION}:${digest}`;
}

function isValidManifest(
  manifest: RecallProjectionManifest | null,
  buildId: string,
): boolean {
  return manifest?.schemaVersion === 1 &&
    manifest.validatedGeneration === manifest.sourceGeneration &&
    manifest.projectionBuildId === buildId;
}

function dirtyManifest(
  buildId: string,
  scope: MemoryScope,
  timestamp: string,
): RecallProjectionManifest {
  const normalized = normalizeRecallScope(scope);
  const scopeKey = recallScopeKey(normalized);
  return {
    id: `scope:${scopeKey}`,
    schemaVersion: 1,
    ...normalized,
    scopeKey,
    sourceGeneration: randomUUID(),
    projectionBuildId: buildId,
    updatedAt: timestamp,
  };
}

export function createProjectionManifestTracker(input: {
  buildId?: string;
  documentStore: ProjectionCapableDocumentStore;
  now: () => string;
}): ProjectionManifestTracker {
  const { buildId, documentStore, now } = input;

  async function prepareInvalidation(
    scopes: readonly MemoryScope[],
  ): Promise<ProjectionManifestMutation> {
    if (!buildId) {
      return { set: [], unchanged: [] };
    }
    const uniqueScopes = new Map<string, MemoryScope>();
    for (const scope of scopes) {
      uniqueScopes.set(recallScopeKey(scope), normalizeRecallScope(scope));
    }
    const set: DocumentWriteOperation[] = [];
    const unchanged: UnchangedDocument[] = [];
    for (const scope of uniqueScopes.values()) {
      const id = manifestId(scope);
      const existing = await documentStore.get<RecallProjectionManifest>(
        PROJECTION_MANIFESTS_COLLECTION,
        id,
      );
      unchanged.push({
        collection: PROJECTION_MANIFESTS_COLLECTION,
        document: existing,
        id,
      });
      set.push({
        collection: PROJECTION_MANIFESTS_COLLECTION,
        document: dirtyManifest(buildId, scope, now()),
        id,
      });
    }
    return { set, unchanged };
  }

  async function invalidate(scope: MemoryScope): Promise<void> {
    if (!buildId) {
      return;
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const mutation = await prepareInvalidation([scope]);
      const expected = mutation.unchanged[0];
      if (!expected) {
        return;
      }
      const committed = await documentStore.writeBatchIfUnchanged({
        expected,
        set: mutation.set,
      });
      if (committed) {
        return;
      }
    }
    throw new Error(
      `Projection source generation changed repeatedly for ${recallScopeKey(scope)}`,
    );
  }

  return {
    enabled: buildId !== undefined,
    async beginValidation(scope) {
      if (!buildId) {
        return null;
      }
      const existing = await documentStore.get<RecallProjectionManifest>(
        PROJECTION_MANIFESTS_COLLECTION,
        manifestId(scope),
      );
      if (
        existing?.schemaVersion === 1 &&
        existing.projectionBuildId === buildId &&
        existing.validatedGeneration !== existing.sourceGeneration
      ) {
        return existing;
      }
      await invalidate(scope);
      return documentStore.get<RecallProjectionManifest>(
        PROJECTION_MANIFESTS_COLLECTION,
        manifestId(scope),
      );
    },
    async completeValidation(manifest) {
      if (!buildId || !manifest) {
        return true;
      }
      const timestamp = now();
      const validated: RecallProjectionManifest = {
        ...manifest,
        validatedGeneration: manifest.sourceGeneration,
        projectionBuildId: buildId,
        updatedAt: timestamp,
        validatedAt: timestamp,
      };
      return documentStore.writeBatchIfUnchanged({
        expected: {
          collection: PROJECTION_MANIFESTS_COLLECTION,
          document: manifest,
          id: manifest.id,
        },
        set: [{
          collection: PROJECTION_MANIFESTS_COLLECTION,
          document: validated,
          id: validated.id,
        }],
      });
    },
    async hasValidProof(scope) {
      if (!buildId) {
        return false;
      }
      const manifest = await documentStore.get<RecallProjectionManifest>(
        PROJECTION_MANIFESTS_COLLECTION,
        manifestId(scope),
      );
      return isValidManifest(manifest, buildId);
    },
    invalidate,
    prepareInvalidation,
  };
}
