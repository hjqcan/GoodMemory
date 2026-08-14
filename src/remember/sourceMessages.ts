import { assertStorageSafeExternalValue } from "../domain/semanticText";
import { assertRememberTemporalContext, isIanaTimezone } from "../domain/temporal";
import { SOURCE_MESSAGES_COLLECTION } from "../evidence/contracts";
import type { SourceMessageRecord } from "../evidence/contracts";
import {
  isProjectionCapableDocumentStore,
} from "../storage/contracts";
import type { DocumentStore } from "../storage/contracts";
import type {
  MemoryCandidate,
  MemoryExtractionInput,
  MemoryExtractionResult,
} from "./candidates";
import type { RememberEngineConfig } from "./contracts";

function assertStorageSafeRememberInput(input: MemoryExtractionInput): void {
  assertStorageSafeExternalValue({
    ...input,
    messages: input.messages.map(({ content: _content, ...message }) => message),
  }, "input");
}

export async function prepareTemporalInput(
  input: MemoryExtractionInput,
  repositories: RememberEngineConfig["repositories"],
): Promise<MemoryExtractionInput> {
  assertStorageSafeRememberInput(input);
  assertRememberTemporalContext(input);

  const storedTimezone = (await repositories.profiles.get(input.scope.userId))
    ?.identity.timezone;
  const profileTimezone = storedTimezone && isIanaTimezone(storedTimezone)
    ? storedTimezone
    : undefined;
  return {
    ...input,
    messages: input.messages.map((message) => {
      const timezone = message.timezone ?? input.timezone ?? profileTimezone;
      return {
        ...message,
        ...(message.observedAt
          ? { observedAt: new Date(message.observedAt).toISOString() }
          : {}),
        ...(timezone ? { timezone } : {}),
      };
    }),
  };
}

export function candidateSourceMessageIndexes(candidate: MemoryCandidate): number[] {
  return [...new Set([
    candidate.sourceMessageIndex,
    ...(candidate.sourceMessageIndexes ?? []),
  ])];
}

export function candidateTouchesSourceIndexes(
  candidate: MemoryCandidate,
  sourceIndexes: ReadonlySet<number>,
): boolean {
  return candidateSourceMessageIndexes(candidate).some((index) =>
    sourceIndexes.has(index)
  );
}
export function omitCandidatesFromSourceIndexes(
  extraction: MemoryExtractionResult,
  sourceIndexes: ReadonlySet<number>,
): MemoryExtractionResult {
  if (sourceIndexes.size === 0) {
    return extraction;
  }
  return {
    ...extraction,
    candidates: extraction.candidates.filter((candidate) =>
      !candidateTouchesSourceIndexes(candidate, sourceIndexes)
    ),
  };
}

function sourceMessageRecordsEquivalent(
  existing: SourceMessageRecord,
  incoming: SourceMessageRecord,
): boolean {
  return existing.id === incoming.id &&
    existing.schemaVersion === incoming.schemaVersion &&
    existing.userId === incoming.userId &&
    existing.tenantId === incoming.tenantId &&
    existing.workspaceId === incoming.workspaceId &&
    existing.agentId === incoming.agentId &&
    existing.sessionId === incoming.sessionId &&
    existing.sourceMessageId === incoming.sourceMessageId &&
    existing.role === incoming.role &&
    existing.content === incoming.content &&
    existing.observedAt === incoming.observedAt &&
    existing.timezone === incoming.timezone &&
    existing.contentSha256 === incoming.contentSha256;
}

export async function persistSourceMessageRecords(
  documentStore: DocumentStore,
  incomingRecords: readonly SourceMessageRecord[],
): Promise<Map<string, SourceMessageRecord>> {
  const incomingById = new Map<string, SourceMessageRecord>();
  for (const incoming of incomingRecords) {
    const duplicate = incomingById.get(incoming.id);
    if (duplicate && !sourceMessageRecordsEquivalent(duplicate, incoming)) {
      throw new Error(`Immutable source-message conflict: ${incoming.id}`);
    }
    incomingById.set(incoming.id, incoming);
  }

  if (!isProjectionCapableDocumentStore(documentStore)) {
    const persisted = new Map<string, SourceMessageRecord>();
    for (const incoming of incomingById.values()) {
      const existing = await documentStore.get<SourceMessageRecord>(
        SOURCE_MESSAGES_COLLECTION,
        incoming.id,
      );
      if (existing && !sourceMessageRecordsEquivalent(existing, incoming)) {
        throw new Error(`Immutable source-message conflict: ${incoming.id}`);
      }
      if (!existing) {
        await documentStore.set(
          SOURCE_MESSAGES_COLLECTION,
          incoming.id,
          incoming,
        );
      }
      persisted.set(incoming.id, existing ?? incoming);
    }
    return persisted;
  }

  const ordered = [...incomingById.values()].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  if (ordered.length === 0) {
    return new Map();
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const snapshots = await Promise.all(ordered.map(async (incoming) => ({
      existing: await documentStore.get<SourceMessageRecord>(
        SOURCE_MESSAGES_COLLECTION,
        incoming.id,
      ),
      incoming,
    })));
    for (const { existing, incoming } of snapshots) {
      if (existing && !sourceMessageRecordsEquivalent(existing, incoming)) {
        throw new Error(`Immutable source-message conflict: ${incoming.id}`);
      }
    }
    const missing = snapshots.filter(({ existing }) => existing === null);
    if (missing.length === 0) {
      return new Map(
        snapshots.map(({ existing, incoming }) => [incoming.id, existing!]),
      );
    }
    const missingIds = new Set(missing.map(({ incoming }) => incoming.id));
    const constraints = snapshots.map(({ existing, incoming }) => ({
      collection: SOURCE_MESSAGES_COLLECTION,
      document: existing,
      id: incoming.id,
    }));
    if (await documentStore.writeBatchIfUnchanged({
      expected: constraints[0]!,
      set: [...incomingById.values()]
        .filter((incoming) => missingIds.has(incoming.id))
        .map((incoming) => ({
          collection: SOURCE_MESSAGES_COLLECTION,
          document: incoming,
          id: incoming.id,
        })),
      unchanged: constraints.slice(1),
    })) {
      return new Map(
        snapshots.map(({ existing, incoming }) => [
          incoming.id,
          existing ?? incoming,
        ]),
      );
    }
  }

  throw new Error(
    `Immutable source-message batch changed repeatedly: ${ordered[0]!.id}`,
  );
}
