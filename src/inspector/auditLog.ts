import { chmod, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isRecord } from "../install/hostConfigValidation";
import { resolveInstallRoot } from "../install/hostRuntimeConfig";
import { containsSensitiveCredential } from "../language/sensitive";
import { redactViewerText } from "./redaction";

// Every mutating Inspector action is appended here before the HTTP response is
// returned, so the local admin surface leaves a durable local audit trail
// separate from the writeback ledger. Modeled on hostWritebackAuditLedger.ts:
// a .lock file guards concurrent writers and the log is a ring buffer.

export type InspectorAuditAction =
  | "approve"
  | "reject"
  | "release"
  | "reset-approval"
  | "forget"
  | "revise"
  | "delete-scope";

export interface InspectorAuditEvent {
  actionId: string;
  action: InspectorAuditAction;
  occurredAt: string;
  /** Hashed scope digest — never raw scope ids in the persisted file. */
  scopeDigest: string;
  /** memoryId / candidateId / scopeKey the action targeted. */
  targetId?: string;
  resultStatus: "ok" | "error";
  resultMemoryIds?: string[];
  /** Bounded + redacted; the caller redacts, this module clamps defensively. */
  contentPreview?: string;
  reason?: string;
  errorMessage?: string;
}

export interface InspectorAuditLedger {
  events: InspectorAuditEvent[];
  version: number;
}

const MAX_INSPECTOR_AUDIT_EVENTS = 1_000;
const MAX_INSPECTOR_PREVIEW_CHARS = 160;
const INSPECTOR_AUDIT_VERSION = 1;
const MAX_LOCK_ATTEMPTS = 40;
const LOCK_DELAY_MS = 25;
export function inspectorAuditLedgerPath(homeRoot: string | undefined): string {
  return join(resolveInstallRoot(homeRoot), "inspector-audit.json");
}

export async function readInspectorAuditLedger(
  homeRoot: string | undefined,
): Promise<InspectorAuditLedger> {
  try {
    const parsed = JSON.parse(
      await readFile(inspectorAuditLedgerPath(homeRoot), "utf8"),
    ) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.events)) {
      throw new Error(
        "GoodMemory inspector audit ledger must be a JSON object with an events array.",
      );
    }
    return {
      events: parsed.events.filter(isInspectorAuditEvent),
      version: INSPECTOR_AUDIT_VERSION,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { events: [], version: INSPECTOR_AUDIT_VERSION };
    }
    throw error;
  }
}

export async function writeInspectorAuditLedger(
  homeRoot: string | undefined,
  ledger: InspectorAuditLedger,
): Promise<void> {
  const path = inspectorAuditLedgerPath(homeRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify(
      {
        events: ledger.events.slice(-MAX_INSPECTOR_AUDIT_EVENTS),
        version: INSPECTOR_AUDIT_VERSION,
      },
      null,
      2,
    ) + "\n",
    { encoding: "utf8", mode: 0o600 },
  );
  await chmod(path, 0o600);
}

export async function withInspectorAuditLock<T>(
  homeRoot: string | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  const lockPath = `${inspectorAuditLedgerPath(homeRoot)}.lock`;
  await mkdir(dirname(lockPath), { recursive: true });
  let attempt = 0;
  while (attempt < MAX_LOCK_ATTEMPTS) {
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
    await delay(LOCK_DELAY_MS);
  }
  throw new Error("Timed out waiting for the inspector audit ledger lock.");
}

/**
 * Append one action to the ledger under the lock. The event's `contentPreview`,
 * `reason`, and `errorMessage` are clamped and secret-checked as a backstop even
 * though callers are expected to redact at the route boundary.
 */
export async function appendInspectorAuditEvent(input: {
  event: InspectorAuditEvent;
  homeRoot?: string;
}): Promise<void> {
  const event = sanitizeAuditEvent(input.event);
  await withInspectorAuditLock(input.homeRoot, async () => {
    const ledger = await readInspectorAuditLedger(input.homeRoot);
    await writeInspectorAuditLedger(input.homeRoot, {
      events: [...ledger.events, event].slice(-MAX_INSPECTOR_AUDIT_EVENTS),
      version: INSPECTOR_AUDIT_VERSION,
    });
  });
}

function sanitizeAuditEvent(event: InspectorAuditEvent): InspectorAuditEvent {
  return {
    ...event,
    ...(event.contentPreview !== undefined
      ? { contentPreview: boundedPreview(event.contentPreview) }
      : {}),
    ...(event.reason !== undefined ? { reason: boundedPreview(event.reason) } : {}),
    ...(event.errorMessage !== undefined
      ? { errorMessage: boundedPreview(event.errorMessage) }
      : {}),
  };
}

function boundedPreview(text: string): string {
  if (containsSensitiveCredential(text)) {
    return "[redacted secret-like content]";
  }
  const normalized = redactViewerText(text).replace(/\s+/gu, " ").trim();
  if (normalized.length <= MAX_INSPECTOR_PREVIEW_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_INSPECTOR_PREVIEW_CHARS - 3)}...`;
}

function isInspectorAuditEvent(value: unknown): value is InspectorAuditEvent {
  return (
    isRecord(value) &&
    typeof value.actionId === "string" &&
    typeof value.action === "string" &&
    typeof value.occurredAt === "string" &&
    typeof value.scopeDigest === "string" &&
    (value.resultStatus === "ok" || value.resultStatus === "error")
  );
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isLockAlreadyHeldError(error: unknown): boolean {
  return isRecord(error) && error.code === "EEXIST";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
