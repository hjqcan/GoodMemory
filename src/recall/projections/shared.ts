import {
  normalizeScope,
  scopeToKey,
} from "../../domain/scope";
import type { MemoryScope } from "../../domain/scope";
import type { StorageFilter } from "../../storage/contracts";
import { passesRecallAgentScopeGuard } from "../../policy/hooks";
import type { RecallProjectionSourceCollection } from "./contracts";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function memoryProjectionId(
  collection: RecallProjectionSourceCollection,
  id: string,
): string {
  return `${collection}:${id}`;
}

export function sourceMutationKey(collection: string, id: string): string {
  return `${collection}\u0000${id}`;
}

export function normalizeRecallScope(scope: MemoryScope): MemoryScope {
  const { sessionId: _sessionId, ...recallScope } = normalizeScope(scope);
  return recallScope;
}

export function recallScopeKey(scope: MemoryScope): string {
  return scopeToKey(normalizeRecallScope(scope));
}

export function scopeFilter(scope: MemoryScope): StorageFilter {
  const normalized = normalizeRecallScope(scope);
  return Object.fromEntries(
    Object.entries({
      userId: normalized.userId,
      tenantId: normalized.tenantId,
      workspaceId: normalized.workspaceId,
      agentId: normalized.agentId,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export function matchesScopeFilter(
  document: MemoryScope,
  scope: MemoryScope,
): boolean {
  const record = normalizeRecallScope(document);
  const requested = normalizeRecallScope(scope);
  return record.userId === requested.userId &&
    record.tenantId === requested.tenantId &&
    record.workspaceId === requested.workspaceId &&
    passesRecallAgentScopeGuard(requested, document);
}
