import type {
  EpisodeMemory,
  FactMemory,
  FeedbackMemory,
  NoteMemory,
  PreferenceMemory,
  ReferenceMemory,
  UserProfile,
} from "../domain/records";
import type { MemoryScope } from "../domain/scope";
import type { EvidenceRecord } from "../evidence/contracts";
import type { SessionArchive } from "../evolution/contracts";
import type { MemoryCandidate } from "../domain/memoryCandidate";

export const AUTHORIZED_RECALL_AGENT_SCOPE: unique symbol = Symbol.for(
  "goodmemory.authorizedRecallAgentScope",
);

export function markRecallAgentScopeAuthorized<TRecord extends object>(
  record: TRecord,
  agentId: string,
): TRecord {
  Object.defineProperty(record, AUTHORIZED_RECALL_AGENT_SCOPE, {
    configurable: false,
    enumerable: false,
    value: agentId,
    writable: false,
  });
  return record;
}

export interface PolicyContext {
  scope: MemoryScope;
  query?: string;
  retrievalProfile?: "general_chat" | "coding_agent";
  phase: "remember" | "recall";
  locale: string;
  localeSource: "explicit" | "detected" | "default";
}

export type PolicyMemoryRecord =
  | ({ memoryType: "profile" } & UserProfile)
  | ({ memoryType: "preference" } & PreferenceMemory)
  | ({ memoryType: "reference" } & ReferenceMemory)
  | ({ memoryType: "note" } & NoteMemory)
  | ({ memoryType: "fact" } & FactMemory)
  | ({ memoryType: "feedback" } & FeedbackMemory)
  | ({ memoryType: "evidence" } & EvidenceRecord)
  | ({ memoryType: "archive" } & SessionArchive)
  | ({ memoryType: "episode" } & EpisodeMemory);

export interface ConflictResolution {
  action: "keep_existing" | "supersede_existing";
  reason?: string;
}

type PolicyCandidateRedaction = Pick<
  MemoryCandidate,
  "content" | "explicitness" | "kindHint" | "metadata"
>;

export interface GoodMemoryPolicyHooks {
  shouldRemember?(
    candidate: MemoryCandidate,
    ctx: PolicyContext,
  ): Promise<boolean> | boolean;
  shouldRecall?(
    record: PolicyMemoryRecord,
    ctx: PolicyContext,
  ): Promise<boolean> | boolean;
  redact?(
    candidate: MemoryCandidate,
    ctx: PolicyContext,
  ): Promise<MemoryCandidate> | MemoryCandidate;
  resolveConflict?(
    existing: PolicyMemoryRecord,
    incoming: MemoryCandidate,
    ctx: PolicyContext,
  ): Promise<ConflictResolution> | ConflictResolution;
}

export async function evaluateShouldRemember(
  policy: Pick<GoodMemoryPolicyHooks, "shouldRemember"> | undefined,
  candidate: MemoryCandidate,
  context: PolicyContext,
): Promise<boolean> {
  if (!policy?.shouldRemember) {
    return true;
  }
  return policy.shouldRemember(
    structuredClone(candidate),
    structuredClone(context),
  );
}

export async function redactPolicyCandidate(
  policy: Pick<GoodMemoryPolicyHooks, "redact"> | undefined,
  candidate: MemoryCandidate,
  context: PolicyContext,
): Promise<PolicyCandidateRedaction> {
  if (!policy?.redact) {
    return {
      content: candidate.content,
      explicitness: candidate.explicitness,
      kindHint: candidate.kindHint,
      metadata: candidate.metadata,
    };
  }
  return policy.redact(
    structuredClone(candidate),
    structuredClone(context),
  );
}

export async function resolvePolicyConflict(
  policy: Pick<GoodMemoryPolicyHooks, "resolveConflict"> | undefined,
  existing: PolicyMemoryRecord,
  incoming: MemoryCandidate,
  context: PolicyContext,
): Promise<ConflictResolution | undefined> {
  if (!policy?.resolveConflict) {
    return undefined;
  }
  return policy.resolveConflict(
    structuredClone(existing),
    structuredClone(incoming),
    structuredClone(context),
  );
}

export function toPolicyMemoryRecord(
  record:
    | UserProfile
    | PreferenceMemory
    | ReferenceMemory
    | NoteMemory
    | FactMemory
    | FeedbackMemory
    | EvidenceRecord
    | SessionArchive
    | EpisodeMemory,
  memoryType: PolicyMemoryRecord["memoryType"],
): PolicyMemoryRecord {
  return {
    ...(record as object),
    memoryType,
  } as PolicyMemoryRecord;
}

export function passesDefaultScopeGuard(
  scope: MemoryScope,
  record: {
    tenantId?: string;
    workspaceId?: string;
    agentId?: string;
  },
): boolean {
  if (scope.tenantId === undefined && record.tenantId !== undefined) {
    return false;
  }

  if (scope.workspaceId === undefined && record.workspaceId !== undefined) {
    return false;
  }

  if (scope.agentId === undefined && record.agentId !== undefined) {
    return false;
  }

  return true;
}

export function passesRecallAgentScopeGuard(
  scope: MemoryScope,
  record: { agentId?: string },
): boolean {
  if (record.agentId === scope.agentId) {
    return true;
  }
  return (
    scope.agentId !== undefined &&
    (record as Record<PropertyKey, unknown>)[AUTHORIZED_RECALL_AGENT_SCOPE] ===
      scope.agentId
  );
}
