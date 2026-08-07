import type { MemoryScope } from "./scope";
import type { MemoryLifecycleState, MemorySource } from "./provenance";

export interface UserProfile {
  userId: string;
  identity: {
    name?: string;
    role?: string;
    organization?: string;
    location?: string;
    timezone?: string;
    languagePreference?: string;
  };
  expertise: {
    primarySkills: string[];
    domains: string[];
    level?: "beginner" | "intermediate" | "senior" | "expert";
  };
  activeContext: {
    goals: string[];
    currentProjects: string[];
  };
  version: number;
  updatedAt: string;
  createdAt: string;
}

export interface SessionMessage {
  id?: string;
  role: string;
  content: string;
  observedAt?: string;
}

export interface PreferenceMemory {
  id: string;
  userId: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
  category: string;
  value: unknown;
  tags?: string[];
  attributes?: Record<string, MemoryAttributeValue>;
  confidence: number;
  source: MemorySource;
  evidenceCount: number;
  isPinned?: boolean;
  supersededBy?: string | null;
  lifecycle?: MemoryLifecycleState;
  updatedAt: string;
}

export type MemoryCategory =
  | "project"
  | "technical"
  | "personal"
  | "relationship"
  | "event"
  | (string & {});
export type MemoryAttributeValue = string | number | boolean | null;

export function resolveMemoryLifecycle(record: {
  lifecycle?: MemoryLifecycleState;
}): MemoryLifecycleState {
  return record.lifecycle ?? "active";
}

export function isActiveMemoryLifecycle(record: {
  lifecycle?: MemoryLifecycleState;
}): boolean {
  return resolveMemoryLifecycle(record) === "active";
}

// True when a fact's bi-temporal validity window has closed (validUntil) or its
// TTL has elapsed (expiresAt) at `referenceTime`. Facts without either boundary
// never expire, so this is a no-op for memory that does not opt into validity.
export function isFactExpired(
  fact: { validUntil?: string; expiresAt?: string },
  referenceTime: string,
): boolean {
  const reference = new Date(referenceTime).getTime();
  if (Number.isNaN(reference)) {
    return false;
  }
  for (const boundary of [fact.validUntil, fact.expiresAt]) {
    if (boundary === undefined) {
      continue;
    }
    const time = new Date(boundary).getTime();
    if (!Number.isNaN(time) && time <= reference) {
      return true;
    }
  }
  return false;
}

export type FactKind =
  | "blocker"
  | "open_loop"
  | "role_update"
  | "focus_update"
  | "project_state"
  | "generic_project";

export type MemoryScopeKind =
  | "identity"
  | "project"
  | "runtime"
  | "reference"
  | "preference";

export interface FactMemory {
  id: string;
  userId: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
  category: MemoryCategory;
  content: string;
  tags?: string[];
  attributes?: Record<string, MemoryAttributeValue>;
  confidence: number;
  importance: number;
  source: MemorySource;
  factKind?: FactKind;
  scopeKind?: MemoryScopeKind;
  subject?: string;
  /** @deprecated since 0.7.3. Preserved for compatibility; retrieval exposure is no longer recorded or ranked. */
  accessCount: number;
  /** @deprecated since 0.7.3. Preserved for compatibility; retrieval exposure is no longer recorded or ranked. */
  lastAccessedAt?: string;
  verificationPressureCount?: number;
  lastVerificationHintAt?: string;
  // Event time: when the fact was observed/stated in its source conversation
  // (earliest cited source message). Distinct from transaction time
  // (createdAt/updatedAt) and from the validity window below — a fact ingested
  // in bulk months later keeps the session date here.
  observedAt?: string;
  // Bi-temporal validity window in event/world time (distinct from createdAt /
  // updatedAt, which are transaction time) plus an optional hard TTL. When
  // validUntil or expiresAt is at/before the reference time, the opt-in
  // ttlExpiry maintenance job demotes the fact to "inactive". All optional, so
  // facts without them never expire.
  validFrom?: string;
  validUntil?: string;
  expiresAt?: string;
  demotedAt?: string;
  demotionReason?: string;
  supersededBy?: string | null;
  lifecycle: MemoryLifecycleState;
  isActive: boolean;
  embeddingId?: string;
  createdAt: string;
  updatedAt: string;
}

export type ReferenceKind =
  | "source_of_truth"
  | "runbook"
  | "doc"
  | "dashboard"
  | "tracker";

export interface ReferenceMemory {
  id: string;
  userId: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
  title: string;
  pointer: string;
  description?: string;
  confidence: number;
  source: MemorySource;
  referenceKind?: ReferenceKind;
  subject?: string;
  tags?: string[];
  attributes?: Record<string, MemoryAttributeValue>;
  supersededBy?: string | null;
  lifecycle?: MemoryLifecycleState;
  createdAt: string;
  updatedAt: string;
}

export interface EpisodeMemory {
  id: string;
  userId: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
  summary: string;
  keyDecisions: string[];
  unresolvedItems: string[];
  topics: string[];
  entities?: string[];
  emotionalTone?: string;
  importance: number;
  confidence: number;
  locale?: string;
  embeddingId?: string;
  // Event time: when the summarized exchange happened (earliest contributing
  // source message), as opposed to createdAt's transaction time.
  observedAt?: string;
  // Ids of the source messages the episode summarizes, when the caller
  // supplied message ids — the non-lossy pointer back to the dialogue span.
  sourceMessageIds?: string[];
  createdAt: string;
  archivedAt?: string;
}

export type FeedbackKind = "do" | "dont" | "prefer" | "validated_pattern";

export interface FeedbackMemory {
  id: string;
  userId: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
  rule: string;
  kind: FeedbackKind;
  appliesTo?: string;
  why?: string;
  evidence?: string[];
  tags?: string[];
  attributes?: Record<string, MemoryAttributeValue>;
  confidence: number;
  source: MemorySource;
  supersededBy?: string | null;
  lifecycle: MemoryLifecycleState;
  /** @deprecated since 0.7.3. Preserved for compatibility; retrieval exposure is no longer recorded or ranked. */
  lastUsedAt?: string;
  updatedAt: string;
}

export function normalizeFeedbackAppliesTo(appliesTo?: string): string {
  const normalized = appliesTo?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : "general_response";
}

export function buildFeedbackIdentityKey(input: {
  kind: FeedbackKind;
  normalizedRule: string;
  appliesTo?: string;
}): string {
  return [
    input.kind,
    normalizeFeedbackAppliesTo(input.appliesTo),
    input.normalizedRule.trim().toLowerCase(),
  ].join("\u0000");
}

export interface SessionBuffer {
  sessionId: string;
  userId: string;
  messages: SessionMessage[];
  compactedMessages?: SessionMessage[];
  summary: string | null;
  summaryUpToIndex: number;
  createdAt: string;
  lastActiveAt: string;
}

export interface WorkingMemorySnapshot {
  sessionId: string;
  userId: string;
  currentGoal?: string;
  constraints?: string[];
  openLoops: string[];
  temporaryDecisions?: string[];
  toolState?: Record<string, unknown>;
  state?: Record<string, unknown>;
  updatedAt: string;
}

export interface SessionJournal {
  sessionId: string;
  userId: string;
  title?: string;
  currentState?: string;
  taskSpecification?: string;
  filesAndFunctions?: string[];
  workflow?: string[];
  errorsAndCorrections?: string[];
  systemDocumentation?: string[];
  learnings?: string[];
  keyResults?: string[];
  worklog: string[];
  lastSummarizedMessageId?: string;
  updatedAt: string;
}

export interface ArtifactSpillRecord {
  id: string;
  scope: MemoryScope;
  kind: "tool_result" | "retrieval_result" | "attachment" | "search_result";
  sourceId: string;
  preview: string;
  replacementText: string;
  storageUri: string;
  contentHash?: string;
  originalBytes: number;
  createdAt: string;
}

function resolveTimestamp(source?: MemorySource): string {
  return source?.extractedAt ?? new Date(0).toISOString();
}

export function createUserProfile(
  input: Partial<UserProfile> & Pick<UserProfile, "userId">,
): UserProfile {
  const timestamp = input.updatedAt ?? input.createdAt ?? new Date(0).toISOString();

  return {
    userId: input.userId,
    identity: input.identity ?? {},
    expertise: input.expertise ?? {
      primarySkills: [],
      domains: [],
    },
    activeContext: input.activeContext ?? {
      goals: [],
      currentProjects: [],
    },
    version: input.version ?? 1,
    updatedAt: input.updatedAt ?? timestamp,
    createdAt: input.createdAt ?? timestamp,
  };
}

export function createPreferenceMemory(
  input: Pick<PreferenceMemory, "id" | "userId" | "category" | "value" | "source"> &
    Partial<Omit<PreferenceMemory, "id" | "userId" | "category" | "value" | "source">>,
): PreferenceMemory {
  return {
    id: input.id,
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    category: input.category,
    value: input.value,
    tags: input.tags,
    attributes: input.attributes,
    confidence: input.confidence ?? 1,
    source: input.source,
    evidenceCount: input.evidenceCount ?? 1,
    isPinned: input.isPinned,
    supersededBy: input.supersededBy ?? null,
    lifecycle: input.lifecycle ?? "active",
    updatedAt: input.updatedAt ?? resolveTimestamp(input.source),
  };
}

export function createFactMemory(
  input: Pick<FactMemory, "id" | "userId" | "category" | "content" | "source"> &
    Partial<Omit<FactMemory, "id" | "userId" | "category" | "content" | "source">>,
): FactMemory {
  const timestamp = input.createdAt ?? input.updatedAt ?? resolveTimestamp(input.source);

  return {
    id: input.id,
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    category: input.category,
    content: input.content,
    tags: input.tags,
    attributes: input.attributes,
    // Full trust unless the writer says otherwise; the remember classifier's
    // accept/reject score is ephemeral and never lands here.
    confidence: input.confidence ?? 1,
    importance: input.importance ?? 1,
    source: input.source,
    factKind: input.factKind,
    scopeKind: input.scopeKind,
    subject: input.subject,
    accessCount: input.accessCount ?? 0,
    lastAccessedAt: input.lastAccessedAt,
    verificationPressureCount: input.verificationPressureCount ?? 0,
    lastVerificationHintAt: input.lastVerificationHintAt,
    observedAt: input.observedAt,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    expiresAt: input.expiresAt,
    demotedAt: input.demotedAt,
    demotionReason: input.demotionReason,
    supersededBy: input.supersededBy ?? null,
    lifecycle: input.lifecycle ?? "active",
    isActive: input.isActive ?? true,
    embeddingId: input.embeddingId,
    createdAt: input.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp,
  };
}

export function createReferenceMemory(
  input: Pick<
    ReferenceMemory,
    "id" | "userId" | "title" | "pointer" | "source"
  > &
    Partial<Omit<ReferenceMemory, "id" | "userId" | "title" | "pointer" | "source">>,
): ReferenceMemory {
  const timestamp = input.createdAt ?? input.updatedAt ?? resolveTimestamp(input.source);

  return {
    id: input.id,
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    title: input.title,
    pointer: input.pointer,
    description: input.description,
    confidence: input.confidence ?? 1,
    source: input.source,
    referenceKind: input.referenceKind,
    subject: input.subject,
    tags: input.tags,
    attributes: input.attributes,
    supersededBy: input.supersededBy ?? null,
    lifecycle: input.lifecycle ?? "active",
    createdAt: input.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp,
  };
}

export function createEpisodeMemory(
  input: Pick<EpisodeMemory, "id" | "userId" | "summary"> &
    Partial<Omit<EpisodeMemory, "id" | "userId" | "summary">>,
): EpisodeMemory {
  return {
    id: input.id,
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    summary: input.summary,
    keyDecisions: input.keyDecisions ?? [],
    unresolvedItems: input.unresolvedItems ?? [],
    topics: input.topics ?? [],
    entities: input.entities,
    emotionalTone: input.emotionalTone,
    importance: input.importance ?? 1,
    confidence: input.confidence ?? 1,
    locale: input.locale,
    embeddingId: input.embeddingId,
    observedAt: input.observedAt,
    sourceMessageIds: input.sourceMessageIds,
    createdAt: input.createdAt ?? new Date(0).toISOString(),
    archivedAt: input.archivedAt,
  };
}

export function createFeedbackMemory(
  input: Pick<FeedbackMemory, "id" | "userId" | "rule" | "kind" | "source"> &
    Partial<Omit<FeedbackMemory, "id" | "userId" | "rule" | "kind" | "source">>,
): FeedbackMemory {
  return {
    id: input.id,
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    rule: input.rule,
    kind: input.kind,
    appliesTo: input.appliesTo,
    why: input.why,
    evidence: input.evidence ?? [],
    tags: input.tags,
    attributes: input.attributes,
    confidence: input.confidence ?? 1,
    source: input.source,
    supersededBy: input.supersededBy ?? null,
    lifecycle: input.lifecycle ?? "active",
    lastUsedAt: input.lastUsedAt,
    updatedAt: input.updatedAt ?? resolveTimestamp(input.source),
  };
}

export function createSessionBuffer(
  input: Pick<SessionBuffer, "sessionId" | "userId"> &
    Partial<Omit<SessionBuffer, "sessionId" | "userId">>,
): SessionBuffer {
  const timestamp = input.createdAt ?? input.lastActiveAt ?? new Date(0).toISOString();

  return {
    sessionId: input.sessionId,
    userId: input.userId,
    messages: input.messages ?? [],
    compactedMessages: input.compactedMessages ?? [],
    summary: input.summary ?? null,
    summaryUpToIndex: input.summaryUpToIndex ?? 0,
    createdAt: input.createdAt ?? timestamp,
    lastActiveAt: input.lastActiveAt ?? timestamp,
  };
}

export function createWorkingMemorySnapshot(
  input: Pick<WorkingMemorySnapshot, "sessionId" | "userId"> &
    Partial<Omit<WorkingMemorySnapshot, "sessionId" | "userId">>,
): WorkingMemorySnapshot {
  return {
    sessionId: input.sessionId,
    userId: input.userId,
    currentGoal: input.currentGoal,
    constraints: input.constraints,
    openLoops: input.openLoops ?? [],
    temporaryDecisions: input.temporaryDecisions,
    toolState: input.toolState,
    state: input.state,
    updatedAt: input.updatedAt ?? new Date(0).toISOString(),
  };
}

export function createSessionJournal(
  input: Pick<SessionJournal, "sessionId" | "userId"> &
    Partial<Omit<SessionJournal, "sessionId" | "userId">>,
): SessionJournal {
  return {
    sessionId: input.sessionId,
    userId: input.userId,
    title: input.title,
    currentState: input.currentState,
    taskSpecification: input.taskSpecification,
    filesAndFunctions: input.filesAndFunctions ?? [],
    workflow: input.workflow ?? [],
    errorsAndCorrections: input.errorsAndCorrections ?? [],
    systemDocumentation: input.systemDocumentation ?? [],
    learnings: input.learnings ?? [],
    keyResults: input.keyResults ?? [],
    worklog: input.worklog ?? [],
    lastSummarizedMessageId: input.lastSummarizedMessageId,
    updatedAt: input.updatedAt ?? new Date(0).toISOString(),
  };
}
