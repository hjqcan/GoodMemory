import { createHash } from "node:crypto";
import { containsSensitiveCredential } from "../language/sensitive";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MemoryScope } from "../domain/scope";
import { normalizeScope, scopeToKey } from "../domain/scope";
import { isRecord } from "./hostConfigValidation";
import type { InstalledHostKind } from "./hostInstall";
import { resolveInstallRoot } from "./hostRuntimeConfig";

// The review queue holds installed-host writeback candidates captured in
// "review" mode: extracted but NOT committed, waiting for an operator to
// approve (promote to durable memory) or reject via the Inspector. It is a
// single JSON file under the install root, modeled on the writeback ledger and
// living beside it so imports flow consumer -> install. Stored content is the
// bounded, secret-redacted candidate *statement* — never the raw transcript.

export type InspectorReviewCandidateKind =
  | "preference"
  | "fact"
  | "feedback"
  | "reference"
  | "episode";

export type InspectorReviewCandidateStatus =
  | "approving"
  | "approved"
  | "pending"
  | "released"
  | "rejected";

export type InspectorReviewCandidateSource = "user" | "assistant" | "host_event";

export interface InspectorReviewCandidate {
  id: string;
  host: InstalledHostKind;
  scope: MemoryScope;
  scopeKey: string;
  kind: InspectorReviewCandidateKind;
  content: string;
  reason: string;
  source: InspectorReviewCandidateSource;
  confidence: number;
  status: InspectorReviewCandidateStatus;
  createdAt: string;
  updatedAt: string;
  memoryIds?: string[];
  reviewError?: string;
  reviewReason?: string;
}

export interface InspectorReviewQueue {
  candidates: InspectorReviewCandidate[];
  version: number;
}

export interface NewReviewCandidate {
  host: InstalledHostKind;
  scope: MemoryScope;
  candidateKey: string;
  kind: InspectorReviewCandidateKind;
  content: string;
  reason: string;
  source: InspectorReviewCandidateSource;
  confidence: number;
}

const REVIEW_QUEUE_VERSION = 1;
const MAX_REVIEW_CANDIDATES = 1_000;
const MAX_REVIEW_CONTENT_CHARS = 1_500;
const MAX_LOCK_ATTEMPTS = 40;
const LOCK_DELAY_MS = 25;
const APPROVAL_LEASE_MS = 10 * 60 * 1000;

export function reviewQueuePath(homeRoot: string | undefined): string {
  return join(resolveInstallRoot(homeRoot), "inspector-review-candidates.json");
}

export function buildReviewCandidateId(input: {
  scope: MemoryScope;
  candidateKey: string;
}): string {
  return `rc_${hashText(`${scopeToKey(input.scope)}\n${input.candidateKey}`, 20)}`;
}

export async function readReviewQueue(
  homeRoot: string | undefined,
): Promise<InspectorReviewQueue> {
  try {
    const parsed = JSON.parse(
      await readFile(reviewQueuePath(homeRoot), "utf8"),
    ) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) {
      throw new Error(
        "GoodMemory inspector review queue must be a JSON object with a candidates array.",
      );
    }
    return {
      candidates: parsed.candidates.filter(isReviewCandidate),
      version: REVIEW_QUEUE_VERSION,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { candidates: [], version: REVIEW_QUEUE_VERSION };
    }
    throw error;
  }
}

export async function writeReviewQueue(
  homeRoot: string | undefined,
  queue: InspectorReviewQueue,
): Promise<void> {
  const path = reviewQueuePath(homeRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify(
      {
        candidates: queue.candidates.slice(-MAX_REVIEW_CANDIDATES),
        version: REVIEW_QUEUE_VERSION,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

export async function withReviewQueueLock<T>(
  homeRoot: string | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  const lockPath = `${reviewQueuePath(homeRoot)}.lock`;
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
  throw new Error("Timed out waiting for the inspector review queue lock.");
}

/**
 * Persist newly-extracted candidates as `pending`. De-dupes by stable id so an
 * already-reviewed candidate (approved/rejected) is never resurrected.
 */
export async function persistReviewCandidates(input: {
  homeRoot?: string;
  now: () => Date;
  candidates: NewReviewCandidate[];
}): Promise<{ persisted: number }> {
  if (input.candidates.length === 0) {
    return { persisted: 0 };
  }
  const nowIso = input.now().toISOString();
  return withReviewQueueLock(input.homeRoot, async () => {
    const queue = await readReviewQueue(input.homeRoot);
    const byId = new Map(queue.candidates.map((candidate) => [candidate.id, candidate]));
    let persisted = 0;
    for (const candidate of input.candidates) {
      const scope = normalizeScope(candidate.scope);
      const id = buildReviewCandidateId({ scope, candidateKey: candidate.candidateKey });
      if (byId.has(id)) {
        continue;
      }
      byId.set(id, {
        id,
        host: candidate.host,
        scope,
        scopeKey: scopeToKey(scope),
        kind: candidate.kind,
        content: boundedContent(candidate.content),
        reason: boundedContent(candidate.reason),
        source: candidate.source,
        confidence: candidate.confidence,
        status: "pending",
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      persisted += 1;
    }
    await writeReviewQueue(input.homeRoot, {
      candidates: [...byId.values()].slice(-MAX_REVIEW_CANDIDATES),
      version: REVIEW_QUEUE_VERSION,
    });
    return { persisted };
  });
}

export async function getReviewCandidate(input: {
  homeRoot?: string;
  id: string;
}): Promise<InspectorReviewCandidate | undefined> {
  const queue = await readReviewQueue(input.homeRoot);
  return queue.candidates.find((candidate) => candidate.id === input.id);
}

export async function listReviewCandidates(input: {
  homeRoot?: string;
  scopeKey?: string;
  status?: InspectorReviewCandidateStatus;
}): Promise<InspectorReviewCandidate[]> {
  const queue = await readReviewQueue(input.homeRoot);
  return queue.candidates.filter(
    (candidate) =>
      (input.scopeKey === undefined || candidate.scopeKey === input.scopeKey) &&
      (input.status === undefined || candidate.status === input.status),
  );
}

export async function updateReviewCandidateStatus(input: {
  homeRoot?: string;
  id: string;
  status: InspectorReviewCandidateStatus;
  memoryIds?: string[];
  reviewError?: string;
  reviewReason?: string;
  now: () => Date;
}): Promise<InspectorReviewCandidate | undefined> {
  return withReviewQueueLock(input.homeRoot, async () => {
    const queue = await readReviewQueue(input.homeRoot);
    const index = queue.candidates.findIndex((candidate) => candidate.id === input.id);
    if (index === -1) {
      return undefined;
    }
    const current = queue.candidates[index];
    if (!current) {
      return undefined;
    }
    const updated: InspectorReviewCandidate = {
      ...current,
      status: input.status,
      updatedAt: input.now().toISOString(),
      ...(input.memoryIds ? { memoryIds: input.memoryIds } : {}),
      reviewError: input.reviewError ? boundedContent(input.reviewError) : undefined,
      ...(input.reviewReason ? { reviewReason: boundedContent(input.reviewReason) } : {}),
    };
    const candidates = [...queue.candidates];
    candidates[index] = updated;
    await writeReviewQueue(input.homeRoot, {
      candidates,
      version: REVIEW_QUEUE_VERSION,
    });
    return updated;
  });
}

export async function reserveReviewCandidateApproval(input: {
  homeRoot?: string;
  id: string;
  now: () => Date;
  reviewReason?: string;
  scopeKey: string;
}): Promise<
  | { candidate: InspectorReviewCandidate; status: "reserved" }
  | {
      candidate?: InspectorReviewCandidate;
      status: "not_found" | "not_pending" | "scope_mismatch";
    }
> {
  return withReviewQueueLock(input.homeRoot, async () => {
    const queue = await readReviewQueue(input.homeRoot);
    const index = queue.candidates.findIndex((candidate) => candidate.id === input.id);
    if (index === -1) {
      return { status: "not_found" };
    }
    const current = queue.candidates[index];
    if (!current) {
      return { status: "not_found" };
    }
    if (current.status !== "pending") {
      return { candidate: current, status: "not_pending" };
    }
    if (current.scopeKey !== input.scopeKey) {
      return { candidate: current, status: "scope_mismatch" };
    }

    const updated: InspectorReviewCandidate = {
      ...current,
      reviewError: undefined,
      status: "approving",
      updatedAt: input.now().toISOString(),
      ...(input.reviewReason ? { reviewReason: boundedContent(input.reviewReason) } : {}),
    };
    const candidates = [...queue.candidates];
    candidates[index] = updated;
    await writeReviewQueue(input.homeRoot, {
      candidates,
      version: REVIEW_QUEUE_VERSION,
    });
    return { candidate: updated, status: "reserved" };
  });
}

export async function releaseReviewCandidateApproval(input: {
  homeRoot?: string;
  id: string;
  now: () => Date;
  reviewError?: string;
}): Promise<InspectorReviewCandidate | undefined> {
  return withReviewQueueLock(input.homeRoot, async () => {
    const queue = await readReviewQueue(input.homeRoot);
    const index = queue.candidates.findIndex((candidate) => candidate.id === input.id);
    if (index === -1) {
      return undefined;
    }
    const current = queue.candidates[index];
    if (!current || current.status !== "approving") {
      return current;
    }
    const updated: InspectorReviewCandidate = {
      ...current,
      reviewError: input.reviewError ? boundedContent(input.reviewError) : undefined,
      status: "pending",
      updatedAt: input.now().toISOString(),
    };
    const candidates = [...queue.candidates];
    candidates[index] = updated;
    await writeReviewQueue(input.homeRoot, {
      candidates,
      version: REVIEW_QUEUE_VERSION,
    });
    return updated;
  });
}

export function isReviewCandidateApprovalStale(
  candidate: InspectorReviewCandidate,
  now: Date = new Date(),
): boolean {
  if (candidate.status !== "approving") {
    return false;
  }
  const updatedAtMs = Date.parse(candidate.updatedAt);
  return Number.isFinite(updatedAtMs) && now.getTime() - updatedAtMs > APPROVAL_LEASE_MS;
}

function boundedContent(text: string): string {
  if (containsSensitiveCredential(text)) {
    return "[redacted secret-like content]";
  }
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized.length <= MAX_REVIEW_CONTENT_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_REVIEW_CONTENT_CHARS - 3)}...`;
}

function isReviewCandidate(value: unknown): value is InspectorReviewCandidate {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.scopeKey === "string" &&
    typeof value.content === "string" &&
    isRecord(value.scope) &&
    typeof value.scope.userId === "string" &&
    (value.status === "pending" ||
      value.status === "approving" ||
      value.status === "approved" ||
      value.status === "released" ||
      value.status === "rejected")
  );
}

function hashText(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
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
