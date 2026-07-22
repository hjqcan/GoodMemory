import { createHash } from "node:crypto";
import { containsSensitiveCredential } from "../language/sensitive";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MemoryScope } from "../domain/scope";
import { isRecord } from "./hostConfigValidation";
import type { InstalledHostKind } from "./hostInstall";
import { resolveInstallRoot } from "./hostRuntimeConfig";

export type InstalledHostWritebackAuditStatus =
  | "committed"
  | "dismissed"
  | "failed"
  | "forgotten"
  | "observed"
  | "pending";

export type InstalledHostWritebackAuditReviewOutcome =
  | "false_write"
  | "uncertain"
  | "valid_write";

export interface InstalledHostWritebackLinkedRecordId {
  forgottenAt?: string;
  id: string;
  type: "evidence" | "experience" | "memory";
}

export interface InstalledHostWritebackAuditReview {
  outcome: InstalledHostWritebackAuditReviewOutcome;
  reason?: string;
}

export interface InstalledHostWritebackAuditRecallHit {
  occurredAt: string;
  sessionDigest: string;
}

export interface InstalledHostWritebackAuditEvent {
  candidateKey: string;
  command: "remember-tool" | "session-end" | "turn-end";
  contentPreview: string;
  eventId: string;
  forgottenLinkedRecordIds: InstalledHostWritebackLinkedRecordId[];
  forgottenMemoryIds: string[];
  host: InstalledHostKind;
  kind: "episode" | "fact" | "feedback" | "preference" | "reference";
  linkedRecordIds: InstalledHostWritebackLinkedRecordId[];
  memoryIds: string[];
  mode: "observe" | "off" | "review" | "selective";
  occurredAt: string;
  reason: string;
  recallHitCount: number;
  recalledBy: InstalledHostWritebackAuditRecallHit[];
  scopeDigest: string;
  sessionDigest?: string;
  source: "assistant" | "host_event" | "user";
  status: InstalledHostWritebackAuditStatus;
  updatedAt: string;
  errorCode?: "forget_failed" | "ledger_commit_failed" | "remember_failed" | "write_rejected";
  review?: InstalledHostWritebackAuditReview;
}

export interface InstalledHostWritebackAuditLedger {
  auditEvents: InstalledHostWritebackAuditEvent[];
  events: string[];
  pending: string[];
  version: number;
}

export interface MarkWritebackAuditPendingInput {
  candidateKey: string;
  command: InstalledHostWritebackAuditEvent["command"];
  content: string;
  eventId: string;
  host: InstalledHostKind;
  kind: InstalledHostWritebackAuditEvent["kind"];
  mode: InstalledHostWritebackAuditEvent["mode"];
  now: string;
  reason: string;
  scopeDigest: string;
  source: InstalledHostWritebackAuditEvent["source"];
  sessionDigest?: string;
}

export interface MarkWritebackAuditObservedInput {
  candidateKey: string;
  command: InstalledHostWritebackAuditEvent["command"];
  content: string;
  eventId: string;
  host: InstalledHostKind;
  kind: InstalledHostWritebackAuditEvent["kind"];
  now: string;
  reason: string;
  scopeDigest: string;
  source: InstalledHostWritebackAuditEvent["source"];
  sessionDigest?: string;
}

const MAX_WRITEBACK_LEDGER_EVENTS = 1_000;
const MAX_WRITEBACK_LOCK_ATTEMPTS = 40;
const MAX_WRITEBACK_LOCK_DELAY_MS = 25;
const MAX_AUDIT_PREVIEW_CHARS = 160;
const WRITEBACK_LEDGER_VERSION = 4;

export function buildWritebackAuditEventId(input: {
  candidateKey: string;
  scopeDigest: string;
}): string {
  return `wb_${hashText(`${coerceDigest("scope", input.scopeDigest)}\n${input.candidateKey}`, 20)}`;
}

export function buildScopedWritebackCandidateKey(input: {
  candidateKey: string;
  scopeDigest: string;
}): string {
  return `${coerceDigest("scope", input.scopeDigest)}:${input.candidateKey}`;
}

export function buildWritebackScopeDigest(scope: MemoryScope): string {
  return `scope:${hashText(
    [
      scope.userId,
      scope.tenantId ?? "",
      scope.workspaceId ?? "",
      scope.agentId ?? "",
    ].join("\n"),
    24,
  )}`;
}

export function buildWritebackSessionDigest(
  sessionId: string | undefined,
): string | undefined {
  return sessionId ? `session:${hashText(sessionId, 24)}` : undefined;
}

export function markWritebackAuditPending(
  ledger: InstalledHostWritebackAuditLedger,
  input: MarkWritebackAuditPendingInput,
): InstalledHostWritebackAuditLedger {
  const existing = ledger.auditEvents.find(
    (event) => event.eventId === input.eventId,
  );
  if (
    ledger.events.includes(input.candidateKey) ||
    existing?.status === "committed" ||
    existing?.status === "forgotten"
  ) {
    return {
      ...ledger,
      pending: ledger.pending.filter((key) => key !== input.candidateKey),
    };
  }
  const nextEvent: InstalledHostWritebackAuditEvent = {
    candidateKey: input.candidateKey,
    command: input.command,
    contentPreview: createAuditPreview(input.content, input.source),
    eventId: input.eventId,
    forgottenLinkedRecordIds: existing?.forgottenLinkedRecordIds ?? [],
    forgottenMemoryIds: existing?.forgottenMemoryIds ?? [],
    host: input.host,
    kind: input.kind,
    linkedRecordIds: existing?.linkedRecordIds ?? [],
    memoryIds: existing?.memoryIds ?? [],
    mode: input.mode,
    occurredAt: existing?.occurredAt ?? input.now,
    reason: createAuditPreview(input.reason, "user"),
    recallHitCount: existing?.recallHitCount ?? 0,
    recalledBy: existing?.recalledBy ?? [],
    scopeDigest: coerceDigest("scope", input.scopeDigest),
    ...(input.sessionDigest
      ? { sessionDigest: coerceDigest("session", input.sessionDigest) }
      : {}),
    source: input.source,
    status: "pending",
    updatedAt: input.now,
  };

  return {
    ...ledger,
    auditEvents: upsertAuditEvent(ledger.auditEvents, nextEvent),
    pending: appendUnique(ledger.pending, [input.candidateKey]),
  };
}

export function markWritebackAuditObserved(
  ledger: InstalledHostWritebackAuditLedger,
  input: MarkWritebackAuditObservedInput,
): InstalledHostWritebackAuditLedger {
  const existing = ledger.auditEvents.find(
    (event) => event.eventId === input.eventId,
  );
  if (
    ledger.events.includes(input.candidateKey) ||
    ledger.pending.includes(input.candidateKey) ||
    existing?.status === "committed" ||
    existing?.status === "dismissed" ||
    existing?.status === "forgotten" ||
    existing?.status === "pending"
  ) {
    return ledger;
  }

  const nextEvent: InstalledHostWritebackAuditEvent = {
    candidateKey: input.candidateKey,
    command: input.command,
    contentPreview: createAuditPreview(input.content, input.source),
    eventId: input.eventId,
    forgottenLinkedRecordIds: existing?.forgottenLinkedRecordIds ?? [],
    forgottenMemoryIds: existing?.forgottenMemoryIds ?? [],
    host: input.host,
    kind: input.kind,
    linkedRecordIds: existing?.linkedRecordIds ?? [],
    memoryIds: existing?.memoryIds ?? [],
    mode: "observe",
    occurredAt: existing?.occurredAt ?? input.now,
    reason: createAuditPreview(input.reason, "user"),
    recallHitCount: existing?.recallHitCount ?? 0,
    recalledBy: existing?.recalledBy ?? [],
    scopeDigest: coerceDigest("scope", input.scopeDigest),
    ...(input.sessionDigest
      ? { sessionDigest: coerceDigest("session", input.sessionDigest) }
      : {}),
    source: input.source,
    status: "observed",
    updatedAt: input.now,
  };

  return {
    ...ledger,
    auditEvents: upsertAuditEvent(ledger.auditEvents, nextEvent),
  };
}

export function markWritebackAuditCommitted(
  ledger: InstalledHostWritebackAuditLedger,
  input: {
    candidateKey: string;
    eventId: string;
    memoryIds: string[];
    now: string;
    linkedRecordIds?: InstalledHostWritebackLinkedRecordId[];
  },
): InstalledHostWritebackAuditLedger {
  const existing = findRequiredAuditEvent(ledger, input.eventId);
  const { errorCode: _errorCode, ...existingWithoutError } = existing;
  const linkedRecordIds = dedupeLinkedRecordIds([
    ...existing.linkedRecordIds,
    ...input.memoryIds.map((id) => ({ id, type: "memory" as const })),
    ...(input.linkedRecordIds ?? []),
  ]);
  const nextEvent: InstalledHostWritebackAuditEvent = {
    ...existingWithoutError,
    linkedRecordIds,
    memoryIds: appendUnique(existing.memoryIds, input.memoryIds),
    status: "committed",
    updatedAt: input.now,
  };

  return {
    ...ledger,
    auditEvents: upsertAuditEvent(ledger.auditEvents, nextEvent),
    events: appendUnique(ledger.events, [input.candidateKey]),
    pending: ledger.pending.filter((key) => key !== input.candidateKey),
  };
}

export function markWritebackAuditFailed(
  ledger: InstalledHostWritebackAuditLedger,
  input: {
    candidateKey: string;
    errorCode: InstalledHostWritebackAuditEvent["errorCode"];
    eventId: string;
    now: string;
  },
): InstalledHostWritebackAuditLedger {
  const existing = findRequiredAuditEvent(ledger, input.eventId);
  const nextEvent: InstalledHostWritebackAuditEvent = {
    ...existing,
    errorCode: input.errorCode,
    status: "failed",
    updatedAt: input.now,
  };

  return {
    ...ledger,
    auditEvents: upsertAuditEvent(ledger.auditEvents, nextEvent),
    pending: ledger.pending.filter((key) => key !== input.candidateKey),
  };
}

export function clearWritebackAuditPending(
  ledger: InstalledHostWritebackAuditLedger,
  input: {
    candidateKey: string;
    eventId: string;
  },
): InstalledHostWritebackAuditLedger {
  return {
    ...ledger,
    auditEvents: ledger.auditEvents.filter((event) => event.eventId !== input.eventId),
    pending: ledger.pending.filter((key) => key !== input.candidateKey),
  };
}

export function markWritebackAuditForgotten(
  ledger: InstalledHostWritebackAuditLedger,
  input: {
    eventId: string;
    forgottenMemoryIds: string[];
    now: string;
    forgottenLinkedRecordIds?: InstalledHostWritebackLinkedRecordId[];
    review?: InstalledHostWritebackAuditReview;
  },
): InstalledHostWritebackAuditLedger {
  const existing = findRequiredAuditEvent(ledger, input.eventId);
  const { errorCode: _errorCode, ...existingWithoutError } = existing;
  const forgottenLinkedRecordIds = dedupeLinkedRecordIds([
    ...existing.forgottenLinkedRecordIds,
    ...input.forgottenMemoryIds.map((id) => ({
      forgottenAt: input.now,
      id,
      type: "memory" as const,
    })),
    ...(input.forgottenLinkedRecordIds ?? []).map((record) => ({
      ...record,
      forgottenAt: record.forgottenAt ?? input.now,
    })),
  ]);
  const forgottenKeys = new Set(
    forgottenLinkedRecordIds.map((record) => linkedRecordKey(record)),
  );
  const nextEvent: InstalledHostWritebackAuditEvent = {
    ...existingWithoutError,
    forgottenLinkedRecordIds,
    forgottenMemoryIds: appendUnique(existing.forgottenMemoryIds, input.forgottenMemoryIds),
    linkedRecordIds: existing.linkedRecordIds.map((record) =>
      forgottenKeys.has(linkedRecordKey(record))
        ? { ...record, forgottenAt: record.forgottenAt ?? input.now }
        : record,
    ),
    ...(input.review ? { review: sanitizeReview(input.review) } : {}),
    status: "forgotten",
    updatedAt: input.now,
  };

  return {
    ...ledger,
    auditEvents: upsertAuditEvent(ledger.auditEvents, nextEvent),
  };
}

export function markWritebackAuditDismissed(
  ledger: InstalledHostWritebackAuditLedger,
  input: {
    eventId: string;
    now: string;
    review?: InstalledHostWritebackAuditReview;
  },
): InstalledHostWritebackAuditLedger {
  const existing = findRequiredAuditEvent(ledger, input.eventId);
  if (existing.status !== "observed" && existing.status !== "dismissed") {
    return ledger;
  }
  const { errorCode: _errorCode, ...existingWithoutError } = existing;
  const nextEvent: InstalledHostWritebackAuditEvent = {
    ...existingWithoutError,
    ...(input.review ? { review: sanitizeReview(input.review) } : {}),
    status: "dismissed",
    updatedAt: input.now,
  };

  return {
    ...ledger,
    auditEvents: upsertAuditEvent(ledger.auditEvents, nextEvent),
  };
}

export function markWritebackAuditForgetFailed(
  ledger: InstalledHostWritebackAuditLedger,
  input: {
    eventId: string;
    forgottenLinkedRecordIds: InstalledHostWritebackLinkedRecordId[];
    now: string;
  },
): InstalledHostWritebackAuditLedger {
  const existing = findRequiredAuditEvent(ledger, input.eventId);
  const forgottenLinkedRecordIds = dedupeLinkedRecordIds([
    ...existing.forgottenLinkedRecordIds,
    ...input.forgottenLinkedRecordIds.map((record) => ({
      ...record,
      forgottenAt: record.forgottenAt ?? input.now,
    })),
  ]);
  const forgottenKeys = new Set(
    forgottenLinkedRecordIds.map((record) => linkedRecordKey(record)),
  );
  const forgottenMemoryIds = forgottenLinkedRecordIds
    .filter((record) => record.type === "memory")
    .map((record) => record.id);
  const nextEvent: InstalledHostWritebackAuditEvent = {
    ...existing,
    errorCode: "forget_failed",
    forgottenLinkedRecordIds,
    forgottenMemoryIds: appendUnique(existing.forgottenMemoryIds, forgottenMemoryIds),
    linkedRecordIds: existing.linkedRecordIds.map((record) =>
      forgottenKeys.has(linkedRecordKey(record))
        ? { ...record, forgottenAt: record.forgottenAt ?? input.now }
        : record,
    ),
    status: "failed",
    updatedAt: input.now,
  };

  return {
    ...ledger,
    auditEvents: upsertAuditEvent(ledger.auditEvents, nextEvent),
  };
}

export function markWritebackAuditRecalled(
  ledger: InstalledHostWritebackAuditLedger,
  input: {
    eventId: string;
    now: string;
    recallSessionDigest: string;
  },
): InstalledHostWritebackAuditLedger {
  const existing = findRequiredAuditEvent(ledger, input.eventId);
  const recalledBy = appendRecallHit(existing.recalledBy, {
    occurredAt: input.now,
    sessionDigest: coerceDigest("session", input.recallSessionDigest),
  });
  const nextEvent: InstalledHostWritebackAuditEvent = {
    ...existing,
    recallHitCount: recalledBy.length,
    recalledBy,
    updatedAt: input.now,
  };

  return {
    ...ledger,
    auditEvents: upsertAuditEvent(ledger.auditEvents, nextEvent),
  };
}

export async function withInstalledHostWritebackLedgerLock<T>(
  host: InstalledHostKind,
  homeRoot: string | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  const lockPath = `${writebackLedgerPath(host, homeRoot)}.lock`;
  let attempt = 0;
  await mkdir(dirname(lockPath), { recursive: true });

  while (attempt < MAX_WRITEBACK_LOCK_ATTEMPTS) {
    try {
      const lockHandle = await open(lockPath, "wx", 0o600);
      try {
        return await callback();
      } finally {
        await lockHandle.close();
        await rm(lockPath, { force: true });
      }
    } catch (error) {
      if (!isLockAlreadyHeldError(error)) {
        throw error;
      }
    }

    attempt += 1;
    await delay(MAX_WRITEBACK_LOCK_DELAY_MS);
  }

  throw new Error(`Timed out waiting for the ${host} writeback ledger lock.`);
}

export async function writeInstalledHostWritebackLedger(
  host: InstalledHostKind,
  homeRoot: string | undefined,
  ledger: InstalledHostWritebackAuditLedger,
): Promise<void> {
  const path = writebackLedgerPath(host, homeRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify(
      {
        auditEvents: ledger.auditEvents.slice(-MAX_WRITEBACK_LEDGER_EVENTS),
        events: ledger.events.slice(-MAX_WRITEBACK_LEDGER_EVENTS),
        pending: ledger.pending.slice(-MAX_WRITEBACK_LEDGER_EVENTS),
        version: WRITEBACK_LEDGER_VERSION,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

export async function readInstalledHostWritebackLedger(
  host: InstalledHostKind,
  homeRoot: string | undefined,
): Promise<InstalledHostWritebackAuditLedger> {
  try {
    const parsed = JSON.parse(
      await readFile(writebackLedgerPath(host, homeRoot), "utf8"),
    ) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.events)) {
      throw new Error(
        "GoodMemory writeback ledger must be a JSON object with an events array.",
      );
    }

    return {
      auditEvents: Array.isArray(parsed.auditEvents)
        ? parsed.auditEvents.flatMap(readAuditEvent)
        : [],
      events: parsed.events.filter((event): event is string => typeof event === "string"),
      pending: Array.isArray(parsed.pending)
        ? parsed.pending.filter((event): event is string => typeof event === "string")
        : [],
      version: WRITEBACK_LEDGER_VERSION,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        auditEvents: [],
        events: [],
        pending: [],
        version: WRITEBACK_LEDGER_VERSION,
      };
    }
    throw error;
  }
}

export function writebackLedgerPath(
  host: InstalledHostKind,
  homeRoot: string | undefined,
): string {
  return join(resolveInstallRoot(homeRoot), `${host}-writeback-events.json`);
}

function readAuditEvent(value: unknown): InstalledHostWritebackAuditEvent[] {
  if (!isRecord(value)) {
    return [];
  }
  const eventId = readString(value.eventId);
  const candidateKey = readString(value.candidateKey);
  const source = readAuditSource(value.source);
  const contentPreview = readString(value.contentPreview);
  const host = value.host === "codex" || value.host === "claude" ? value.host : undefined;
  const status = readAuditStatus(value.status);
  if (!eventId || !candidateKey || !contentPreview || !host || !status) {
    return [];
  }

  return [
    {
      candidateKey,
      command: value.command === "turn-end" || value.command === "remember-tool"
        ? value.command
        : "session-end",
      contentPreview: createAuditPreview(contentPreview, source),
      eventId,
      forgottenLinkedRecordIds: readLinkedRecordIds(value.forgottenLinkedRecordIds),
      forgottenMemoryIds: readStringArray(value.forgottenMemoryIds),
      host,
      kind: readAuditKind(value.kind),
      linkedRecordIds: readLinkedRecordIds(value.linkedRecordIds),
      memoryIds: readStringArray(value.memoryIds),
      mode: value.mode === "observe" || value.mode === "off" ? value.mode : "selective",
      occurredAt: readString(value.occurredAt) ?? new Date(0).toISOString(),
      reason: createAuditPreview(readString(value.reason) ?? "unknown", "user"),
      recallHitCount: typeof value.recallHitCount === "number"
        ? Math.max(0, Math.floor(value.recallHitCount))
        : 0,
      recalledBy: readRecallHits(value.recalledBy),
      scopeDigest: coerceDigest("scope", readString(value.scopeDigest) ?? "scope:unknown"),
      ...(readString(value.sessionDigest)
        ? { sessionDigest: coerceDigest("session", readString(value.sessionDigest)!) }
        : {}),
      source,
      status,
      updatedAt: readString(value.updatedAt) ?? new Date(0).toISOString(),
      ...(readErrorCode(value.errorCode) ? { errorCode: readErrorCode(value.errorCode) } : {}),
      ...(readReview(value.review) ? { review: readReview(value.review) } : {}),
    },
  ];
}

function readLinkedRecordIds(value: unknown): InstalledHostWritebackLinkedRecordId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return dedupeLinkedRecordIds(
    value.flatMap((record): InstalledHostWritebackLinkedRecordId[] => {
      if (!isRecord(record)) {
        return [];
      }
      const id = readString(record.id);
      const type = record.type === "evidence" ||
        record.type === "experience" ||
        record.type === "memory"
        ? record.type
        : undefined;
      if (!id || !type) {
        return [];
      }
      return [
        {
          ...(readString(record.forgottenAt)
            ? { forgottenAt: readString(record.forgottenAt)! }
            : {}),
          id,
          type,
        },
      ];
    }),
  );
}

function readRecallHits(value: unknown): InstalledHostWritebackAuditRecallHit[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((record): InstalledHostWritebackAuditRecallHit[] => {
    if (!isRecord(record)) {
      return [];
    }
    const occurredAt = readString(record.occurredAt);
    const sessionDigest = readString(record.sessionDigest);
    return occurredAt && sessionDigest
      ? [{ occurredAt, sessionDigest: coerceDigest("session", sessionDigest) }]
      : [];
  });
}

function readReview(value: unknown): InstalledHostWritebackAuditReview | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const outcome = value.outcome === "false_write" ||
    value.outcome === "uncertain" ||
    value.outcome === "valid_write"
    ? value.outcome
    : undefined;
  if (!outcome) {
    return undefined;
  }
  return {
    outcome,
    ...(readString(value.reason)
      ? { reason: createAuditPreview(readString(value.reason)!, "user") }
      : {}),
  };
}

function sanitizeReview(
  review: InstalledHostWritebackAuditReview,
): InstalledHostWritebackAuditReview {
  return {
    outcome: review.outcome,
    ...(review.reason ? { reason: createAuditPreview(review.reason, "user") } : {}),
  };
}

function readAuditStatus(value: unknown): InstalledHostWritebackAuditStatus | undefined {
  return value === "committed" ||
    value === "dismissed" ||
    value === "failed" ||
    value === "forgotten" ||
    value === "observed" ||
    value === "pending"
    ? value
    : undefined;
}

function readAuditKind(
  value: unknown,
): InstalledHostWritebackAuditEvent["kind"] {
  return value === "preference" ||
    value === "feedback" ||
    value === "reference" ||
    value === "episode"
    ? value
    : "fact";
}

function readAuditSource(
  value: unknown,
): InstalledHostWritebackAuditEvent["source"] {
  return value === "assistant" || value === "host_event" ? value : "user";
}

function readErrorCode(
  value: unknown,
): InstalledHostWritebackAuditEvent["errorCode"] | undefined {
  return value === "ledger_commit_failed" ||
    value === "forget_failed" ||
    value === "remember_failed" ||
    value === "write_rejected"
    ? value
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function createAuditPreview(
  content: string,
  source: InstalledHostWritebackAuditEvent["source"],
): string {
  if (source === "assistant") {
    return "[redacted assistant-originated candidate]";
  }
  if (containsSensitiveCredential(content)) {
    return "[redacted secret-like content]";
  }
  if (/"?(messages|transcript|rawTranscript|rawContent)"?\s*:/iu.test(content)) {
    return "[redacted transcript-like content]";
  }
  if (/"?role"?\s*:\s*"?(assistant|user|system|tool)"?/iu.test(content)) {
    return "[redacted transcript-like content]";
  }
  if (/"?content"?\s*:/iu.test(content)) {
    return "[redacted transcript-like content]";
  }
  if (/(^|\n)\s*(assistant|system|tool|user|host|host_event)\s*:/iu.test(content)) {
    return "[redacted transcript-like content]";
  }
  const withoutRolePrefix = content.replace(/^\s*(assistant|user|host|host_event)\s*:\s*/iu, "");
  const normalized = withoutRolePrefix.replace(/\s+/gu, " ").trim();
  if (normalized.length <= MAX_AUDIT_PREVIEW_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_AUDIT_PREVIEW_CHARS - 3)}...`;
}

function coerceDigest(prefix: "scope" | "session", value: string): string {
  const pattern = prefix === "scope"
    ? /^scope:[a-f0-9]{16,64}$/u
    : /^session:[a-f0-9]{16,64}$/u;
  return pattern.test(value) ? value : `${prefix}:${hashText(value, 24)}`;
}

function upsertAuditEvent(
  events: InstalledHostWritebackAuditEvent[],
  next: InstalledHostWritebackAuditEvent,
): InstalledHostWritebackAuditEvent[] {
  const filtered = events.filter((event) => event.eventId !== next.eventId);
  return [...filtered, next].slice(-MAX_WRITEBACK_LEDGER_EVENTS);
}

function appendUnique(values: string[], next: string[]): string[] {
  return [...new Set([...values, ...next])].slice(-MAX_WRITEBACK_LEDGER_EVENTS);
}

function appendRecallHit(
  values: InstalledHostWritebackAuditRecallHit[],
  next: InstalledHostWritebackAuditRecallHit,
): InstalledHostWritebackAuditRecallHit[] {
  return values.some((value) => value.sessionDigest === next.sessionDigest)
    ? values
    : [...values, next];
}

function dedupeLinkedRecordIds(
  records: InstalledHostWritebackLinkedRecordId[],
): InstalledHostWritebackLinkedRecordId[] {
  const byKey = new Map<string, InstalledHostWritebackLinkedRecordId>();
  for (const record of records) {
    const key = linkedRecordKey(record);
    const existing = byKey.get(key);
    byKey.set(key, {
      ...existing,
      ...record,
      forgottenAt: record.forgottenAt ?? existing?.forgottenAt,
    });
  }
  return [...byKey.values()];
}

function linkedRecordKey(record: InstalledHostWritebackLinkedRecordId): string {
  return `${record.type}:${record.id}`;
}

function findRequiredAuditEvent(
  ledger: InstalledHostWritebackAuditLedger,
  eventId: string,
): InstalledHostWritebackAuditEvent {
  const event = ledger.auditEvents.find((item) => item.eventId === eventId);
  if (!event) {
    throw new Error(`Missing writeback audit event: ${eventId}`);
  }
  return event;
}

function hashText(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isLockAlreadyHeldError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
