import { createHash } from "node:crypto";
import {
  createFactMemory,
  createFeedbackMemory,
  createPreferenceMemory,
  createReferenceMemory,
  isActiveMemoryLifecycle,
  type FactMemory,
  type FeedbackMemory,
  type PreferenceMemory,
  type ReferenceMemory,
} from "../domain/records";
import { createMemorySource } from "../domain/provenance";
import {
  assertStorageSafeExternalValue,
  findStorageUnsafeTextPath,
  hasPersistableSemanticText,
} from "../domain/semanticText";
import { isSameDurableScope } from "../domain/scope";
import type { MemoryScope } from "../domain/scope";
import type { EmbeddingAdapter } from "../embedding/contracts";
import {
  buildFactEmbeddingWrite,
  buildReferenceEmbeddingWrite,
  prepareMemoryEmbeddingWrites,
  upsertPreparedMemoryEmbeddings,
} from "../embedding/vectorWrites";
import {
  createEvidenceRecord,
  EVIDENCE_COLLECTION,
  type EvidenceRecord,
} from "../evidence/contracts";
import type {
  LanguageService,
  ResolvedLanguageContext,
} from "../language";
import {
  evaluateShouldRemember,
  passesDefaultScopeGuard,
  redactPolicyCandidate,
  type GoodMemoryPolicyHooks,
  type PolicyContext,
} from "../policy/hooks";
import type { MemoryCandidate } from "../remember/candidates";
import {
  createPreferenceCategoryFence,
  writePreferenceCategoryBatch,
} from "../remember/writeOwnership";
import type { DocumentStore } from "../storage/contracts";
import type { RememberVectorPort } from "../storage/ports";
import type {
  RevisableMemoryType,
  ReviseMemoryEvidenceSource,
  ReviseMemoryInput,
  ReviseMemoryResult,
} from "./contracts";

type RevisableRecord =
  | PreferenceMemory
  | ReferenceMemory
  | FactMemory
  | FeedbackMemory;

type RevisableTarget = {
  collection: "preferences" | "references" | "facts" | "feedback";
  memoryType: RevisableMemoryType;
  record: RevisableRecord;
};

export interface ReviseMemoryServiceConfig {
  documentStore: DocumentStore;
  embedding?: EmbeddingAdapter;
  language: LanguageService;
  now: () => Date;
  policy?: Pick<GoodMemoryPolicyHooks, "redact" | "shouldRemember">;
  vectorIndex?: RememberVectorPort | null;
}

const REVISION_EVIDENCE_EXCERPT_LIMIT = 280;
function resolveRevisionAuditReason(
  reason: ReviseMemoryInput["reason"],
): string {
  if (
    reason === "user_correction" ||
    reason === "manual_review" ||
    reason === "system_repair"
  ) {
    return reason;
  }

  return "custom";
}

function encodeRevisionId(input: {
  idempotencyKey: string;
  memoryId: string;
  scope: MemoryScope;
}): string {
  const digest = createHash("sha256")
    .update(input.scope.userId)
    .update("\0")
    .update(input.scope.tenantId ?? "")
    .update("\0")
    .update(input.scope.workspaceId ?? "")
    .update("\0")
    .update(input.scope.agentId ?? "")
    .update("\0")
    .update(input.scope.sessionId ?? "")
    .update("\0")
    .update(input.memoryId)
    .update("\0")
    .update(input.idempotencyKey)
    .digest("hex")
    .slice(0, 32);

  return digest;
}

function encodeRevisionRequestDigest(input: {
  evidenceExcerpt: string;
  evidenceSource?: ReviseMemoryEvidenceSource;
  idempotencyKey: string;
  locale: string;
  memoryId: string;
  reason: ReviseMemoryInput["reason"];
  revisionContent: string;
  scope: MemoryScope;
  sourceMessageIds: string[];
  sourceUri?: string;
}): string {
  const canonicalRequest = {
    evidenceExcerpt: input.evidenceExcerpt,
    evidenceSource: input.evidenceSource ?? null,
    idempotencyKey: input.idempotencyKey,
    locale: input.locale,
    reason: resolveRevisionAuditReason(input.reason),
    revisionContent: input.revisionContent,
    scope: {
      agentId: input.scope.agentId ?? null,
      sessionId: input.scope.sessionId ?? null,
      tenantId: input.scope.tenantId ?? null,
      userId: input.scope.userId,
      workspaceId: input.scope.workspaceId ?? null,
    },
    sourceMessageIds: input.sourceMessageIds,
    sourceUri: input.sourceUri ?? null,
    targetMemoryId: input.memoryId,
  };

  return createHash("sha256")
    .update(JSON.stringify(canonicalRequest))
    .digest("hex");
}

function readRevisionRequestDigest(evidence: EvidenceRecord | null): string | null {
  const digest = evidence?.attributes?.revisionRequestDigest;
  return typeof digest === "string" ? digest : null;
}

function recordMatchesRevisionScope(
  record: {
    userId: string;
    tenantId?: string;
    workspaceId?: string;
    agentId?: string;
    sessionId?: string;
  },
  scope: MemoryScope,
): boolean {
  if (record.userId !== scope.userId) {
    return false;
  }

  if (!passesDefaultScopeGuard(scope, record)) {
    return false;
  }

  const optionalKeys: Array<keyof Omit<MemoryScope, "userId">> = [
    "tenantId",
    "workspaceId",
    "agentId",
    "sessionId",
  ];

  return optionalKeys.every((key) => {
    const expected = scope[key];
    if (expected === undefined) {
      return true;
    }

    return record[key] === expected;
  });
}

async function findTarget(
  documentStore: DocumentStore,
  input: ReviseMemoryInput,
): Promise<RevisableTarget | null> {
  const candidates: Array<Omit<RevisableTarget, "record">> = [
    { collection: "preferences", memoryType: "preference" },
    { collection: "references", memoryType: "reference" },
    { collection: "facts", memoryType: "fact" },
    { collection: "feedback", memoryType: "feedback" },
  ];

  for (const candidate of candidates) {
    const record = await documentStore.get<RevisableRecord>(
      candidate.collection,
      input.target.memoryId,
    );
    if (!record) {
      continue;
    }
    if (!recordMatchesRevisionScope(record, input.scope)) {
      return null;
    }

    return {
      ...candidate,
      record,
    };
  }

  return null;
}

function redactedBoundedExcerpt(
  value: string,
  language: LanguageService,
  context: ResolvedLanguageContext,
): string {
  const structurallyRedacted = value
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, "[redacted secret-like content]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted token-like content]")
    .trim();
  const redacted = language.analyzeContent(value, context).sensitiveCredential
    ? "[redacted-secret]"
    : structurallyRedacted;
  if (redacted.length <= REVISION_EVIDENCE_EXCERPT_LIMIT) {
    return redacted;
  }

  return `${redacted.slice(0, REVISION_EVIDENCE_EXCERPT_LIMIT - 3)}...`;
}

function buildRevisionCandidate(input: {
  content: string;
  digest: string;
  memoryType: RevisableMemoryType;
  record: RevisableRecord;
}): MemoryCandidate {
  const base = {
    content: input.content,
    explicitness: "explicit",
    id: `revision-candidate-${input.digest}`,
    sourceMessageIndex: 0,
    sourceRole: "user",
  } as const;

  if (input.memoryType === "preference") {
    const record = input.record as PreferenceMemory;
    return {
      ...base,
      kindHint: "preference",
      metadata: {
        attributes: record.attributes,
        preferenceCategory: record.category,
        preferenceValue: input.content,
        tags: record.tags,
      },
    };
  }

  if (input.memoryType === "reference") {
    const record = input.record as ReferenceMemory;
    return {
      ...base,
      kindHint: "reference",
      metadata: {
        attributes: record.attributes,
        referenceKind: record.referenceKind,
        referencePointer: input.content,
        referenceTitle: input.content.split("/").at(-1) ?? input.content,
        subject: record.subject,
        tags: record.tags,
      },
    };
  }

  if (input.memoryType === "feedback") {
    const record = input.record as FeedbackMemory;
    return {
      ...base,
      kindHint: "feedback",
      metadata: {
        appliesTo: record.appliesTo,
        attributes: record.attributes,
        feedbackKind: record.kind,
        tags: record.tags,
      },
    };
  }

  const record = input.record as FactMemory;
  return {
    ...base,
    kindHint: "fact",
    metadata: {
      attributes: record.attributes,
      category: record.category,
      factKind: record.factKind,
      scopeKind: record.scopeKind,
      subject: record.subject,
      tags: record.tags,
    },
  };
}

function buildRevisedRecords(input: {
  candidate: MemoryCandidate;
  evidenceId: string;
  newMemoryId: string;
  record: RevisableRecord;
  timestamp: string;
  memoryType: RevisableMemoryType;
  language: ResolvedLanguageContext;
  scope: MemoryScope;
}): {
  previous: RevisableRecord;
  next: RevisableRecord;
} {
  const source = createMemorySource({
    method: "confirmed",
    extractedAt: input.timestamp,
    locale: input.language.locale,
    localeSource: input.language.localeSource,
    languagePackId: input.language.languagePackId,
    languagePackVersion: input.language.languagePackVersion,
    sessionId: input.scope.sessionId,
  });

  if (input.memoryType === "preference") {
    const record = input.record as PreferenceMemory;
    const metadata = input.candidate.metadata;
    return {
      previous: createPreferenceMemory({
        ...record,
        lifecycle: "superseded",
        supersededBy: input.newMemoryId,
        updatedAt: input.timestamp,
      }),
      next: createPreferenceMemory({
        agentId: record.agentId,
        attributes: metadata?.attributes,
        category: metadata?.preferenceCategory ?? "general_preference",
        confidence: record.confidence,
        evidenceCount: record.evidenceCount + 1,
        id: input.newMemoryId,
        isPinned: record.isPinned,
        lifecycle: "active",
        sessionId: record.sessionId,
        source,
        supersededBy: null,
        tags: metadata?.tags,
        tenantId: record.tenantId,
        updatedAt: input.timestamp,
        userId: record.userId,
        value: metadata?.preferenceValue ?? input.candidate.content,
        workspaceId: record.workspaceId,
      }),
    };
  }

  if (input.memoryType === "reference") {
    const record = input.record as ReferenceMemory;
    const metadata = input.candidate.metadata;
    const pointer = metadata?.referencePointer ?? input.candidate.content;
    const title = metadata?.referenceTitle?.trim();
    return {
      previous: createReferenceMemory({
        ...record,
        lifecycle: "superseded",
        supersededBy: input.newMemoryId,
        updatedAt: input.timestamp,
      }),
      next: createReferenceMemory({
        agentId: record.agentId,
        attributes: metadata?.attributes,
        confidence: record.confidence,
        createdAt: input.timestamp,
        description: record.description,
        id: input.newMemoryId,
        lifecycle: "active",
        pointer,
        referenceKind: metadata?.referenceKind,
        sessionId: record.sessionId,
        source,
        subject: metadata?.subject ?? "unknown",
        supersededBy: null,
        tags: metadata?.tags,
        tenantId: record.tenantId,
        title: title && title.length > 0
          ? title
          : pointer.split("/").at(-1) ?? pointer,
        updatedAt: input.timestamp,
        userId: record.userId,
        workspaceId: record.workspaceId,
      }),
    };
  }

  if (input.memoryType === "feedback") {
    const record = input.record as FeedbackMemory;
    const metadata = input.candidate.metadata;
    return {
      previous: createFeedbackMemory({
        ...record,
        lifecycle: "superseded",
        supersededBy: input.newMemoryId,
        updatedAt: input.timestamp,
      }),
      next: createFeedbackMemory({
        agentId: record.agentId,
        appliesTo: metadata?.appliesTo,
        attributes: metadata?.attributes,
        confidence: record.confidence,
        evidence: [...new Set([...(record.evidence ?? []), input.evidenceId])],
        id: input.newMemoryId,
        kind: metadata?.feedbackKind ?? "do",
        lastUsedAt: undefined,
        lifecycle: "active",
        rule: input.candidate.content,
        sessionId: record.sessionId,
        source,
        supersededBy: null,
        tags: metadata?.tags,
        tenantId: record.tenantId,
        updatedAt: input.timestamp,
        userId: record.userId,
        why: record.why,
        workspaceId: record.workspaceId,
      }),
    };
  }

  const record = input.record as FactMemory;
  const metadata = input.candidate.metadata;
  return {
    previous: createFactMemory({
      ...record,
      lifecycle: "superseded",
      isActive: false,
      supersededBy: input.newMemoryId,
      updatedAt: input.timestamp,
    }),
    next: createFactMemory({
      accessCount: 0,
      agentId: record.agentId,
      attributes: metadata?.attributes,
      category: metadata?.category ?? "project",
      confidence: record.confidence,
      content: input.candidate.content,
      createdAt: input.timestamp,
      demotedAt: record.demotedAt,
      demotionReason: record.demotionReason,
      embeddingId: record.embeddingId,
      expiresAt: record.expiresAt,
      factKind: metadata?.factKind,
      id: input.newMemoryId,
      importance: record.importance,
      isActive: true,
      lastAccessedAt: undefined,
      lastVerificationHintAt: record.lastVerificationHintAt,
      lifecycle: "active",
      observedAt: record.observedAt,
      occurrence: input.candidate.content === record.content
        ? record.occurrence
        : undefined,
      scopeKind: metadata?.scopeKind,
      sessionId: record.sessionId,
      source,
      subject: metadata?.subject ?? "unknown",
      supersededBy: null,
      tags: metadata?.tags,
      tenantId: record.tenantId,
      updatedAt: input.timestamp,
      userId: record.userId,
      validFrom: record.validFrom,
      validUntil: record.validUntil,
      verificationPressureCount: record.verificationPressureCount,
      workspaceId: record.workspaceId,
    }),
  };
}

function buildEvidence(input: {
  excerpt: string;
  evidenceId: string;
  input: ReviseMemoryInput;
  newMemoryId: string;
  previousMemoryId: string;
  requestDigest: string;
  timestamp: string;
  language: ResolvedLanguageContext;
  languageService: LanguageService;
}): EvidenceRecord {
  return createEvidenceRecord({
    id: input.evidenceId,
    userId: input.input.scope.userId,
    tenantId: input.input.scope.tenantId,
    workspaceId: input.input.scope.workspaceId,
    agentId: input.input.scope.agentId,
    sessionId: input.input.scope.sessionId,
    kind: "correction_context",
    source: createMemorySource({
      method: "confirmed",
      extractedAt: input.timestamp,
      locale: input.language.locale,
      localeSource: input.language.localeSource,
      languagePackId: input.language.languagePackId,
      languagePackVersion: input.language.languagePackVersion,
      sessionId: input.input.scope.sessionId,
    }),
    sourceUri: input.input.evidence?.sourceUri,
    sourceMessageIds: input.input.evidence?.sourceMessageIds ?? [],
    attributes: {
      revisionReason: resolveRevisionAuditReason(input.input.reason),
      revisionRequestDigest: input.requestDigest,
      ...(input.input.evidence?.source
        ? { revisionEvidenceSource: input.input.evidence.source }
        : {}),
    },
    excerpt: redactedBoundedExcerpt(
      input.excerpt,
      input.languageService,
      input.language,
    ),
    linkedMemoryIds: [input.previousMemoryId, input.newMemoryId],
    createdAt: input.timestamp,
  });
}

async function resolveEvidenceExcerpt(input: {
  candidate: MemoryCandidate;
  config: ReviseMemoryServiceConfig;
  digest: string;
  memoryType: RevisableMemoryType;
  policyContext: PolicyContext;
  record: RevisableRecord;
  revisionInput: ReviseMemoryInput;
}): Promise<string> {
  const explicitEvidence =
    input.revisionInput.evidence?.excerpt ??
    input.revisionInput.evidence?.message;
  if (explicitEvidence === undefined) {
    return input.candidate.content;
  }

  if (!input.config.policy?.redact) {
    return explicitEvidence;
  }

  const evidenceCandidate = buildRevisionCandidate({
    content: explicitEvidence,
    digest: `${input.digest}-evidence`,
    memoryType: input.memoryType,
    record: input.record,
  });
  const redacted = await redactPolicyCandidate(
    input.config.policy,
    evidenceCandidate,
    input.policyContext,
  );

  return redacted.content;
}

async function writeRevisionVector(input: {
  embedding?: EmbeddingAdapter;
  memoryType: RevisableMemoryType;
  next: RevisableRecord;
  previousMemoryId: string;
  vectorIndex: RememberVectorPort | null | undefined;
}): Promise<void> {
  if (!input.vectorIndex) {
    return;
  }

  if (input.memoryType === "fact") {
    await input.vectorIndex.deleteFactEmbedding(input.previousMemoryId);
    if (!input.embedding) {
      return;
    }
    await upsertPreparedMemoryEmbeddings(
      await prepareMemoryEmbeddingWrites(
        [buildFactEmbeddingWrite(input.next as FactMemory)],
        input.embedding,
      ),
      input.vectorIndex,
    );
    return;
  }

  if (input.memoryType === "reference") {
    await input.vectorIndex.deleteReferenceEmbedding(input.previousMemoryId);
    if (!input.embedding) {
      return;
    }
    await upsertPreparedMemoryEmbeddings(
      await prepareMemoryEmbeddingWrites(
        [buildReferenceEmbeddingWrite(input.next as ReferenceMemory)],
        input.embedding,
      ),
      input.vectorIndex,
    );
  }
}

function buildSuccessResult(input: {
  evidenceId: string;
  memoryType: RevisableMemoryType;
  newMemoryId: string;
  previousMemoryId: string;
  policyApplied: string[];
  warnings?: string[];
}): ReviseMemoryResult {
  return {
    accepted: true,
    outcome: "superseded",
    memoryType: input.memoryType,
    previousMemoryId: input.previousMemoryId,
    newMemoryId: input.newMemoryId,
    evidenceIds: [input.evidenceId],
    supersedeLineage: {
      supersedes: input.previousMemoryId,
      supersededBy: input.newMemoryId,
    },
    policyApplied: input.policyApplied,
    ...(input.warnings && input.warnings.length > 0
      ? { warnings: input.warnings }
      : {}),
  };
}

async function buildIdempotentResult(input: {
  documentStore: DocumentStore;
  evidenceId: string;
  memoryType: RevisableMemoryType;
  newMemoryId: string;
  previousMemoryId: string;
  requestDigest: string;
  policyApplied: string[];
}): Promise<ReviseMemoryResult> {
  const existingEvidence = await input.documentStore.get<EvidenceRecord>(
    EVIDENCE_COLLECTION,
    input.evidenceId,
  );
  const existingRequestDigest = readRevisionRequestDigest(existingEvidence);
  if (existingRequestDigest && existingRequestDigest !== input.requestDigest) {
    return {
      accepted: false,
      outcome: "blocked",
      memoryType: input.memoryType,
      previousMemoryId: input.previousMemoryId,
      policyApplied: input.policyApplied,
      reason: "idempotency_conflict",
    };
  }

  return buildSuccessResult({
    evidenceId: input.evidenceId,
    memoryType: input.memoryType,
    newMemoryId: input.newMemoryId,
    previousMemoryId: input.previousMemoryId,
    policyApplied: input.policyApplied,
  });
}

function buildAcceptedPolicyApplied(
  policy: ReviseMemoryServiceConfig["policy"] | undefined,
): string[] {
  return [
    "revision.target.memory_id",
    policy?.redact ? "policy.redact" : undefined,
    policy?.shouldRemember ? "policy.shouldRemember.allowed" : undefined,
  ].filter((entry): entry is string => Boolean(entry));
}

type PreferenceRevisionConflictReason =
  | "idempotent"
  | "target_changed"
  | "target_not_active"
  | "target_not_found_or_out_of_scope";

class PreferenceRevisionConflict extends Error {
  constructor(readonly reason: PreferenceRevisionConflictReason) {
    super(reason);
  }
}

function preferenceRevisionTimestamp(
  requestedTimestamp: string,
  preferences: readonly PreferenceMemory[],
): string {
  return new Date(Math.max(
    Date.parse(requestedTimestamp),
    ...preferences.flatMap((preference) => [
      Date.parse(preference.source.extractedAt),
      Date.parse(preference.updatedAt),
    ]),
  )).toISOString();
}

function durablePreferenceFilter(scope: MemoryScope): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      agentId: scope.agentId,
      tenantId: scope.tenantId,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export async function reviseMemory(input: {
  config: ReviseMemoryServiceConfig;
  input: ReviseMemoryInput;
}): Promise<ReviseMemoryResult> {
  const { content: _content, ...revision } = input.input.revision;
  assertStorageSafeExternalValue({
    ...input.input,
    revision,
  }, "input");
  const policyApplied = ["revision.target.memory_id"];
  const target = await findTarget(input.config.documentStore, input.input);
  if (!target) {
    return {
      accepted: false,
      outcome: "not_found",
      policyApplied,
      reason: "target_not_found_or_out_of_scope",
    };
  }

  const digest = encodeRevisionId({
    idempotencyKey: input.input.idempotencyKey,
    memoryId: input.input.target.memoryId,
    scope: input.input.scope,
  });
  const newMemoryId = `rev_${digest}`;
  const evidenceId = `ev_rev_${digest}`;

  const writeBatchIfUnchanged =
    input.config.documentStore.writeBatchIfUnchanged?.bind(
      input.config.documentStore,
    );
  if (!writeBatchIfUnchanged) {
    return {
      accepted: false,
      outcome: "unsupported",
      memoryType: target.memoryType,
      previousMemoryId: target.record.id,
      policyApplied,
      reason: "document_store_batch_unsupported",
    };
  }

  const content = input.input.revision.content.trim();
  if (!hasPersistableSemanticText(content)) {
    return {
      accepted: false,
      outcome: "blocked",
      memoryType: target.memoryType,
      previousMemoryId: target.record.id,
      policyApplied,
      reason: "empty_revision",
    };
  }

  const resolvedLanguage = input.config.language.resolveFromText({
    locale: input.input.locale,
    text: content,
  });
  let candidate = buildRevisionCandidate({
    content,
    digest,
    memoryType: target.memoryType,
    record: target.record,
  });
  const policyContext = {
    scope: input.input.scope,
    phase: "remember" as const,
    locale: resolvedLanguage.locale,
    localeSource: resolvedLanguage.localeSource,
  };

  if (input.config.policy?.redact) {
    candidate = await redactPolicyCandidate(
      input.config.policy,
      candidate,
      policyContext,
    );
    policyApplied.push("policy.redact");
  }
  if (!hasPersistableSemanticText(candidate.content)) {
    return {
      accepted: false,
      outcome: "blocked",
      memoryType: target.memoryType,
      previousMemoryId: target.record.id,
      policyApplied,
      reason: "invalid_after_redaction",
    };
  }
  if (findStorageUnsafeTextPath(candidate, "candidate")) {
    return {
      accepted: false,
      outcome: "blocked",
      memoryType: target.memoryType,
      previousMemoryId: target.record.id,
      policyApplied,
      reason: "storage_unsafe",
    };
  }

  if (input.config.policy?.shouldRemember) {
    const allowed = await evaluateShouldRemember(
      input.config.policy,
      candidate,
      policyContext,
    );
    if (!allowed) {
      policyApplied.push("policy.shouldRemember.blocked");
      return {
        accepted: false,
        outcome: "blocked",
        memoryType: target.memoryType,
        previousMemoryId: target.record.id,
        policyApplied,
        reason: "policy_should_remember_blocked",
      };
    }
    policyApplied.push("policy.shouldRemember.allowed");
  }

  const timestamp = input.config.now().toISOString();
  const evidenceExcerpt = await resolveEvidenceExcerpt({
    candidate,
    config: input.config,
    digest,
    memoryType: target.memoryType,
    policyContext,
    record: target.record,
    revisionInput: input.input,
  });
  const requestDigest = encodeRevisionRequestDigest({
    evidenceExcerpt: redactedBoundedExcerpt(
      evidenceExcerpt,
      input.config.language,
      resolvedLanguage,
    ),
    evidenceSource: input.input.evidence?.source,
    idempotencyKey: input.input.idempotencyKey,
    locale: resolvedLanguage.locale,
    memoryId: input.input.target.memoryId,
    reason: input.input.reason,
    revisionContent: candidate.content.trim(),
    scope: input.input.scope,
    sourceMessageIds: input.input.evidence?.sourceMessageIds ?? [],
    sourceUri: input.input.evidence?.sourceUri,
  });
  const existing = await input.config.documentStore.get<RevisableRecord>(
    target.collection,
    newMemoryId,
  );
  if (existing) {
    return buildIdempotentResult({
      documentStore: input.config.documentStore,
      evidenceId,
      memoryType: target.memoryType,
      newMemoryId,
      previousMemoryId: target.record.id,
      requestDigest,
      policyApplied: buildAcceptedPolicyApplied(input.config.policy),
    });
  }

  if (!isActiveMemoryLifecycle(target.record)) {
    return {
      accepted: false,
      outcome: "blocked",
      memoryType: target.memoryType,
      previousMemoryId: target.record.id,
      policyApplied,
      reason: "target_not_active",
    };
  }

  if (target.memoryType === "preference") {
    const initialPreference = target.record as PreferenceMemory;
    let committedNext: PreferenceMemory;
    try {
      committedNext = await writePreferenceCategoryBatch({
        documentStore: input.config.documentStore,
        fence: createPreferenceCategoryFence(
          initialPreference,
          initialPreference.category,
        ),
        prepare: async () => {
          const [
            currentTarget,
            currentNew,
            currentEvidence,
            scopedPreferences,
          ] = await Promise.all([
            input.config.documentStore.get<PreferenceMemory>(
              target.collection,
              target.record.id,
            ),
            input.config.documentStore.get<PreferenceMemory>(
              target.collection,
              newMemoryId,
            ),
            input.config.documentStore.get<EvidenceRecord>(
              EVIDENCE_COLLECTION,
              evidenceId,
            ),
            input.config.documentStore.query<PreferenceMemory>(
              "preferences",
              durablePreferenceFilter(initialPreference),
            ),
          ]);
          if (currentNew) {
            throw new PreferenceRevisionConflict("idempotent");
          }
          if (
            !currentTarget ||
            !isSameDurableScope(currentTarget, initialPreference)
          ) {
            throw new PreferenceRevisionConflict(
              "target_not_found_or_out_of_scope",
            );
          }
          if (currentTarget.category !== initialPreference.category) {
            throw new PreferenceRevisionConflict("target_changed");
          }
          if (!isActiveMemoryLifecycle(currentTarget)) {
            throw new PreferenceRevisionConflict("target_not_active");
          }

          const activePreferences = scopedPreferences.filter((preference) =>
            isSameDurableScope(preference, initialPreference) &&
            preference.category === initialPreference.category &&
            isActiveMemoryLifecycle(preference)
          );
          const siblings = activePreferences.filter(
            (preference) => preference.id !== currentTarget.id,
          );
          const commitTimestamp = preferenceRevisionTimestamp(
            timestamp,
            [currentTarget, ...siblings],
          );
          const revised = buildRevisedRecords({
            candidate,
            evidenceId,
            language: resolvedLanguage,
            memoryType: "preference",
            newMemoryId,
            record: currentTarget,
            scope: input.input.scope,
            timestamp: commitTimestamp,
          });
          const next = revised.next as PreferenceMemory;
          const evidence = buildEvidence({
            evidenceId,
            excerpt: evidenceExcerpt,
            input: input.input,
            language: resolvedLanguage,
            languageService: input.config.language,
            newMemoryId,
            previousMemoryId: currentTarget.id,
            requestDigest,
            timestamp: commitTimestamp,
          });

          return {
            batch: {
              expected: {
                collection: target.collection,
                document: currentTarget,
                id: currentTarget.id,
              },
              unchanged: [
                {
                  collection: target.collection,
                  document: currentNew,
                  id: newMemoryId,
                },
                {
                  collection: EVIDENCE_COLLECTION,
                  document: currentEvidence,
                  id: evidenceId,
                },
                ...siblings.map((preference) => ({
                  collection: target.collection,
                  document: preference,
                  id: preference.id,
                })),
              ],
              set: [
                {
                  collection: EVIDENCE_COLLECTION,
                  document: evidence,
                  id: evidenceId,
                },
                {
                  collection: target.collection,
                  document: revised.previous,
                  id: revised.previous.id,
                },
                {
                  collection: target.collection,
                  document: next,
                  id: next.id,
                },
                ...siblings.map((preference) => ({
                  collection: target.collection,
                  document: createPreferenceMemory({
                    ...preference,
                    lifecycle: "superseded",
                    supersededBy: next.id,
                    updatedAt: commitTimestamp,
                  }),
                  id: preference.id,
                })),
              ],
            },
            result: next,
          };
        },
      });
    } catch (error) {
      if (!(error instanceof PreferenceRevisionConflict)) {
        throw error;
      }
      if (error.reason === "idempotent") {
        return buildIdempotentResult({
          documentStore: input.config.documentStore,
          evidenceId,
          memoryType: target.memoryType,
          newMemoryId,
          previousMemoryId: target.record.id,
          requestDigest,
          policyApplied: buildAcceptedPolicyApplied(input.config.policy),
        });
      }
      return {
        accepted: false,
        outcome: error.reason === "target_not_found_or_out_of_scope"
          ? "not_found"
          : "blocked",
        memoryType: target.memoryType,
        previousMemoryId: target.record.id,
        policyApplied,
        reason: error.reason,
      };
    }

    const warnings: string[] = [];
    try {
      await writeRevisionVector({
        embedding: input.config.embedding,
        memoryType: target.memoryType,
        next: committedNext,
        previousMemoryId: target.record.id,
        vectorIndex: input.config.vectorIndex,
      });
    } catch {
      warnings.push("vector_write_failed");
    }

    return buildSuccessResult({
      evidenceId,
      memoryType: target.memoryType,
      newMemoryId,
      previousMemoryId: target.record.id,
      policyApplied,
      warnings,
    });
  }

  const { previous, next } = buildRevisedRecords({
    candidate,
    evidenceId,
    newMemoryId,
    record: target.record,
    timestamp,
    memoryType: target.memoryType,
    language: resolvedLanguage,
    scope: input.input.scope,
  });
  const evidence = buildEvidence({
    excerpt: evidenceExcerpt,
    evidenceId,
    input: input.input,
    newMemoryId,
    previousMemoryId: target.record.id,
    requestDigest,
    timestamp,
    language: resolvedLanguage,
    languageService: input.config.language,
  });
  const committed = await writeBatchIfUnchanged({
    expected: {
      collection: target.collection,
      id: target.record.id,
      document: target.record,
    },
    set: [
      {
        collection: EVIDENCE_COLLECTION,
        id: evidenceId,
        document: evidence,
      },
      {
        collection: target.collection,
        id: previous.id,
        document: previous,
      },
      {
        collection: target.collection,
        id: next.id,
        document: next,
      },
    ],
  });

  if (!committed) {
    const committedIdempotentRecord =
      await input.config.documentStore.get<RevisableRecord>(
        target.collection,
        newMemoryId,
    );
    if (committedIdempotentRecord) {
      return buildIdempotentResult({
        documentStore: input.config.documentStore,
        evidenceId,
        memoryType: target.memoryType,
        newMemoryId,
        previousMemoryId: target.record.id,
        requestDigest,
        policyApplied: buildAcceptedPolicyApplied(input.config.policy),
      });
    }

    const currentTarget = await input.config.documentStore.get<RevisableRecord>(
      target.collection,
      target.record.id,
    );

    return {
      accepted: false,
      outcome: currentTarget ? "blocked" : "not_found",
      memoryType: target.memoryType,
      previousMemoryId: target.record.id,
      policyApplied,
      reason: currentTarget
        ? (isActiveMemoryLifecycle(currentTarget)
            ? "target_changed"
            : "target_not_active")
        : "target_not_found_or_out_of_scope",
    };
  }

  const warnings: string[] = [];
  try {
    await writeRevisionVector({
      embedding: input.config.embedding,
      memoryType: target.memoryType,
      next,
      previousMemoryId: target.record.id,
      vectorIndex: input.config.vectorIndex,
    });
  } catch {
    warnings.push("vector_write_failed");
  }

  return buildSuccessResult({
    evidenceId,
    memoryType: target.memoryType,
    newMemoryId,
    previousMemoryId: target.record.id,
    policyApplied,
    warnings,
  });
}
