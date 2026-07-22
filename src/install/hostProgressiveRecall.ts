import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HostKind } from "../domain/hostTypes";
import type {
  GoodMemory,
} from "../api/contracts";
import { readGoodMemoryIntegrationSupport } from "../api/integrationSupport";
import { createLanguageService } from "../language";
import type {
  HostMemoryRuntimeContext,
  InstalledHostContextDependencies,
} from "./hostExecutionContext";
import { createInstalledHostMemory } from "./hostExecutionContext";
import { resolveInstallRoot } from "./hostRuntimeConfig";
import {
  buildProgressiveScopeDigest,
  createProgressiveRecallService,
  type ProgressiveRecallService,
  type ProgressiveRecordDetail,
} from "../progressive/recall";

const PROGRESSIVE_SCOPE_SECRET_PREFIX = "gmpr_";
const PROGRESSIVE_RECORD_CACHE_TTL_MS = 30 * 60 * 1_000;
const PROGRESSIVE_RECORD_CACHE_MAX_PER_SCOPE = 100;

interface ProgressiveRecordCacheEntry {
  expiresAt: string;
  lastSeenAt: string;
  record: ProgressiveRecordDetail;
}

interface ProgressiveRecordCacheScope {
  records: Record<string, ProgressiveRecordCacheEntry>;
}

interface ProgressiveRecordCacheFile {
  scopes: Record<string, ProgressiveRecordCacheScope>;
  version: 1;
}

export async function createInstalledHostProgressiveRecallService(input: {
  context: HostMemoryRuntimeContext;
  dependencies?: InstalledHostContextDependencies;
  homeRoot?: string;
  memory?: GoodMemory;
}): Promise<ProgressiveRecallService> {
  const memory = input.memory ?? createInstalledHostMemory(
    input.context,
    input.dependencies,
  );
  return createProgressiveRecallService({
    language: readGoodMemoryIntegrationSupport(memory)?.language ??
      createLanguageService(input.context.language),
    memory,
    scopeDigestSecret: await resolveInstalledHostProgressiveScopeDigestSecret({
      context: input.context,
      homeRoot: input.homeRoot,
    }),
  });
}

export async function resolveInstalledHostProgressiveScopeDigest(input: {
  context: HostMemoryRuntimeContext;
  homeRoot?: string;
}): Promise<string> {
  return buildProgressiveScopeDigest({
    scope: input.context.scope,
    secret: await resolveInstalledHostProgressiveScopeDigestSecret(input),
  });
}

export async function writeInstalledHostProgressiveRecordCache(input: {
  homeRoot?: string;
  host: HostKind;
  now?: Date;
  records: ProgressiveRecordDetail[];
  scopeDigest: string;
}): Promise<void> {
  if (input.records.length === 0) {
    return;
  }

  const now = input.now ?? new Date();
  const ledger = await readProgressiveRecordCacheFile(input);
  const scope = ledger.scopes[input.scopeDigest] ?? { records: {} };
  const expiresAt = new Date(
    now.getTime() + PROGRESSIVE_RECORD_CACHE_TTL_MS,
  ).toISOString();
  const lastSeenAt = now.toISOString();

  for (const record of input.records) {
    scope.records[record.recordRef] = {
      expiresAt,
      lastSeenAt,
      record,
    };
  }

  pruneProgressiveRecordCacheScope(scope, now);
  ledger.scopes[input.scopeDigest] = scope;
  await writeProgressiveRecordCacheFile(input, ledger);
}

export async function readInstalledHostProgressiveRecordCache(input: {
  homeRoot?: string;
  host: HostKind;
  now?: Date;
  recordRefs: string[];
  scopeDigest: string;
}): Promise<ProgressiveRecordDetail[]> {
  if (input.recordRefs.length === 0) {
    return [];
  }

  const now = input.now ?? new Date();
  const ledger = await readProgressiveRecordCacheFile(input);
  const scope = ledger.scopes[input.scopeDigest];
  if (!scope) {
    return [];
  }

  pruneProgressiveRecordCacheScope(scope, now);
  const records: ProgressiveRecordDetail[] = [];
  for (const recordRef of input.recordRefs) {
    const entry = scope.records[recordRef];
    if (!entry) {
      return [];
    }
    records.push(entry.record);
  }
  await writeProgressiveRecordCacheFile(input, ledger);
  return records;
}

async function readOrCreateProgressiveScopeDigestSecret(input: {
  homeRoot?: string;
  host: HostKind;
}): Promise<string> {
  const installRoot = resolveInstallRoot(input.homeRoot);
  const secretPath = join(
    installRoot,
    `${input.host}-progressive-scope-secret`,
  );
  await mkdir(installRoot, {
    mode: 0o700,
    recursive: true,
  });

  try {
    const existing = (await readFile(secretPath, "utf8")).trim();
    if (existing.startsWith(PROGRESSIVE_SCOPE_SECRET_PREFIX) && existing.length >= 32) {
      await chmod(secretPath, 0o600);
      return existing;
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const secret = `${PROGRESSIVE_SCOPE_SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
  await writeFile(secretPath, `${secret}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(secretPath, 0o600);
  return secret;
}

async function resolveInstalledHostProgressiveScopeDigestSecret(input: {
  context: HostMemoryRuntimeContext;
  homeRoot?: string;
}): Promise<string> {
  const localSecret = await readOrCreateProgressiveScopeDigestSecret({
    homeRoot: input.homeRoot,
    host: input.context.host,
  });

  return buildProgressiveScopeDigestSecret({
    context: input.context,
    localSecret,
  });
}

function buildProgressiveScopeDigestSecret(input: {
  context: HostMemoryRuntimeContext;
  localSecret: string;
}): string {
  return createHash("sha256")
    .update("goodmemory-progressive-recall-v1")
    .update("\n")
    .update(input.localSecret)
    .update("\n")
    .update(input.context.host)
    .update("\n")
    .update(input.context.storage?.provider ?? "")
    .update("\n")
    .update(input.context.storage?.url ?? "")
    .digest("hex");
}

async function readProgressiveRecordCacheFile(input: {
  homeRoot?: string;
  host: HostKind;
}): Promise<ProgressiveRecordCacheFile> {
  try {
    const parsed = JSON.parse(
      await readFile(progressiveRecordCachePath(input), "utf8"),
    ) as unknown;
    if (!isProgressiveRecordCacheFile(parsed)) {
      return createEmptyProgressiveRecordCacheFile();
    }
    return parsed;
  } catch (error) {
    if (isMissingFileError(error)) {
      return createEmptyProgressiveRecordCacheFile();
    }
    throw error;
  }
}

async function writeProgressiveRecordCacheFile(
  input: {
    homeRoot?: string;
    host: HostKind;
  },
  ledger: ProgressiveRecordCacheFile,
): Promise<void> {
  const installRoot = resolveInstallRoot(input.homeRoot);
  await mkdir(installRoot, {
    mode: 0o700,
    recursive: true,
  });
  const path = progressiveRecordCachePath(input);
  await writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

function progressiveRecordCachePath(input: {
  homeRoot?: string;
  host: HostKind;
}): string {
  return join(
    resolveInstallRoot(input.homeRoot),
    `${input.host}-progressive-records.json`,
  );
}

function createEmptyProgressiveRecordCacheFile(): ProgressiveRecordCacheFile {
  return {
    scopes: {},
    version: 1,
  };
}

function pruneProgressiveRecordCacheScope(
  scope: ProgressiveRecordCacheScope,
  now: Date,
): void {
  const nowMs = now.getTime();
  for (const [recordRef, entry] of Object.entries(scope.records)) {
    const expiresAt = Date.parse(entry.expiresAt);
    if (Number.isNaN(expiresAt) || expiresAt <= nowMs) {
      delete scope.records[recordRef];
    }
  }

  const entries = Object.entries(scope.records);
  if (entries.length <= PROGRESSIVE_RECORD_CACHE_MAX_PER_SCOPE) {
    return;
  }

  const keep = new Set(
    entries
      .sort((left, right) => Date.parse(right[1].lastSeenAt) - Date.parse(left[1].lastSeenAt))
      .slice(0, PROGRESSIVE_RECORD_CACHE_MAX_PER_SCOPE)
      .map(([recordRef]) => recordRef),
  );
  for (const recordRef of Object.keys(scope.records)) {
    if (!keep.has(recordRef)) {
      delete scope.records[recordRef];
    }
  }
}

function isProgressiveRecordCacheFile(
  value: unknown,
): value is ProgressiveRecordCacheFile {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { version?: unknown }).version === 1 &&
    Boolean((value as { scopes?: unknown }).scopes) &&
    typeof (value as { scopes?: unknown }).scopes === "object" &&
    !Array.isArray((value as { scopes?: unknown }).scopes)
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
