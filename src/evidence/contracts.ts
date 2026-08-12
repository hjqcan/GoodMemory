// Write-time provenance: an EvidenceRecord links a stored memory back to the
// excerpt that justified writing it (citation/audit trail). Not to be confused
// with src/eval/protocol-reader, which owns benchmark-specific answer shaping.
import type { MemorySource } from "../domain/provenance";
import type { MemoryScope } from "../domain/scope";

export const EVIDENCE_COLLECTION = "evidence";
export const SOURCE_MESSAGES_COLLECTION = "source_messages_v1";

export type EvidenceAttributeValue = string | number | boolean | null;

export type EvidenceKind =
  | "conversation_excerpt"
  | "tool_result_excerpt"
  | "document_excerpt"
  | "verification_result"
  | "correction_context";

export interface EvidenceRecord {
  id: string;
  userId: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
  kind: EvidenceKind;
  excerpt: string;
  source: MemorySource;
  sourceUri?: string;
  sourceMessageIds: string[];
  sourceRecordIds?: string[];
  attributes?: Record<string, EvidenceAttributeValue>;
  linkedMemoryIds: string[];
  linkedArchiveIds: string[];
  createdAt: string;
}

export interface SourceMessageRecord extends MemoryScope {
  id: string;
  schemaVersion: 1;
  sourceMessageId?: string;
  role: string;
  content: string;
  observedAt?: string;
  timezone?: string;
  ingestedAt: string;
  contentSha256: string;
}

function resolveCreatedAt(
  source: MemorySource | undefined,
  createdAt: string | undefined,
): string {
  return createdAt ?? source?.extractedAt ?? new Date(0).toISOString();
}

export function createEvidenceRecord(
  input: Pick<EvidenceRecord, "excerpt" | "id" | "kind" | "source" | "userId"> &
    Partial<Omit<EvidenceRecord, "excerpt" | "id" | "kind" | "source" | "userId">>,
): EvidenceRecord {
  return {
    id: input.id,
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    kind: input.kind,
    excerpt: input.excerpt,
    source: input.source,
    sourceUri: input.sourceUri,
    sourceMessageIds: input.sourceMessageIds ?? [],
    sourceRecordIds: input.sourceRecordIds ?? [],
    attributes: input.attributes,
    linkedMemoryIds: input.linkedMemoryIds ?? [],
    linkedArchiveIds: input.linkedArchiveIds ?? [],
    createdAt: resolveCreatedAt(input.source, input.createdAt),
  };
}
