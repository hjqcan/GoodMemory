import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { redactSensitiveCredentialText } from "../language/sensitive";
import { estimateTextTokens } from "../tokenEstimator";
import type {
  CreateRuntimeWorkerJobEnvelopeInput,
  CreateRuntimeWorkerQueueInput,
  RuntimeWorkerAuditEvent,
  RuntimeWorkerDaemonResult,
  RuntimeWorkerDrainOnceInput,
  RuntimeWorkerDrainOnceResult,
  RuntimeWorkerEnqueueResult,
  RuntimeWorkerJobEnvelope,
  RuntimeWorkerJobLastError,
  RuntimeWorkerJobStatus,
  RuntimeWorkerQueue,
  RuntimeWorkerQueueSnapshot,
  RuntimeWorkerRecoverResult,
  RuntimeWorkerRepair,
  RuntimeWorkerStatusInput,
  RuntimeWorkerStatusResult,
} from "./contracts";

const SNAPSHOT_VERSION = 1;
const DEFAULT_STUCK_AFTER_MS = 5 * 60 * 1000;
const MAX_PREVIEW_CHARS = 240;

function timestamp(now: () => Date): string {
  return now().toISOString();
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function redactRuntimeWorkerText(value: string): string {
  return clipText(
    redactSensitiveCredentialText(
      value
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted-email]")
        .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/gu, "[redacted-secret]")
        .replace(
          /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^:\s/@]+:[^\s/@]+@/gu,
          "[redacted-url-auth]@",
        ),
    )
      .replace(/\s+/gu, " ")
      .trim(),
    MAX_PREVIEW_CHARS,
  );
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
    .join(",")}}`;
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableSerialize(value)).digest("hex")}`;
}

function cloneJob(job: RuntimeWorkerJobEnvelope): RuntimeWorkerJobEnvelope {
  return {
    ...job,
    lastError: job.lastError ? { ...job.lastError } : undefined,
    payload: { ...job.payload },
    scopeDigest: { ...job.scopeDigest },
    trace: {
      linkedEvidenceIds: [...job.trace.linkedEvidenceIds],
      linkedMemoryIds: [...job.trace.linkedMemoryIds],
      linkedTraceIds: [...job.trace.linkedTraceIds],
    },
  };
}

function cloneSnapshot(snapshot: RuntimeWorkerQueueSnapshot): RuntimeWorkerQueueSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    daemon: { ...snapshot.daemon },
    jobs: snapshot.jobs.map(cloneJob),
    audits: snapshot.audits.map((audit) => ({ ...audit })),
  };
}

function emptySnapshot(now: string): RuntimeWorkerQueueSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    daemon: {
      enabled: false,
      updatedAt: now,
    },
    jobs: [],
    audits: [],
  };
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function countJobs(input: {
  jobs: RuntimeWorkerJobEnvelope[];
  stuckJobs: RuntimeWorkerJobEnvelope[];
}): Record<RuntimeWorkerJobStatus | "stuck" | "total", number> {
  const counts: Record<RuntimeWorkerJobStatus | "stuck" | "total", number> = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    coalesced: 0,
    stuck: input.stuckJobs.length,
    total: input.jobs.length,
  };

  for (const job of input.jobs) {
    counts[job.status] += 1;
    counts.coalesced += job.coalescedCount;
  }

  return counts;
}

function normalizeMaxJobs(input: RuntimeWorkerDrainOnceInput | undefined): number {
  if (input?.maxJobs === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Math.floor(input.maxJobs));
}

function appendAudit(
  snapshot: RuntimeWorkerQueueSnapshot,
  event: RuntimeWorkerAuditEvent,
): void {
  snapshot.audits.push(event);
}

function isStuck(input: {
  job: RuntimeWorkerJobEnvelope;
  nowMs: number;
  stuckAfterMs: number;
}): boolean {
  if (input.job.status !== "running") {
    return false;
  }

  const updatedAt = Date.parse(input.job.updatedAt);
  return Number.isFinite(updatedAt) && input.nowMs - updatedAt >= input.stuckAfterMs;
}

function getStuckJobs(input: {
  jobs: RuntimeWorkerJobEnvelope[];
  now: Date;
  stuckAfterMs?: number;
}): RuntimeWorkerJobEnvelope[] {
  const stuckAfterMs = input.stuckAfterMs ?? DEFAULT_STUCK_AFTER_MS;
  const nowMs = input.now.getTime();
  return input.jobs.filter((job) => isStuck({ job, nowMs, stuckAfterMs }));
}

function createWorkerError(error: unknown): RuntimeWorkerJobLastError {
  return {
    code: "worker_failed",
    message: redactRuntimeWorkerText(error instanceof Error ? error.message : String(error)),
  };
}

async function defaultProcessor(): Promise<void> {
  return;
}

async function readSnapshot(input: {
  now: () => Date;
  queueFile: string;
}): Promise<RuntimeWorkerQueueSnapshot> {
  try {
    const raw = await readFile(input.queueFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<RuntimeWorkerQueueSnapshot>;
    return {
      version: SNAPSHOT_VERSION,
      daemon: parsed.daemon ?? {
        enabled: false,
        updatedAt: timestamp(input.now),
      },
      jobs: (parsed.jobs ?? []).map(cloneJob),
      audits: (parsed.audits ?? []).map((audit) => ({ ...audit })),
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return emptySnapshot(timestamp(input.now));
    }
    throw error;
  }
}

async function writeSnapshot(input: {
  queueFile: string;
  snapshot: RuntimeWorkerQueueSnapshot;
}): Promise<void> {
  await mkdir(dirname(input.queueFile), { recursive: true });
  await writeFile(input.queueFile, `${JSON.stringify(input.snapshot, null, 2)}\n`);
}

export function createRuntimeWorkerJobEnvelope(
  input: CreateRuntimeWorkerJobEnvelopeInput,
): RuntimeWorkerJobEnvelope {
  const redactedPreview = redactRuntimeWorkerText(input.boundedJob.payloadPreview);
  const payloadDigest = sha256({
    hostKind: input.hostKind,
    operation: input.boundedJob.operation,
    preview: redactedPreview,
    scopeDigest: input.scopeDigest,
  });
  const dedupeKey = [
    "runtime-worker",
    input.hostKind,
    sha256(input.scopeDigest),
    input.boundedJob.operation,
    payloadDigest,
  ].join(":");

  return {
    attempts: 0,
    coalescedCount: 0,
    createdAt: input.createdAt,
    dedupeKey,
    hostKind: input.hostKind,
    jobId: input.boundedJob.jobId,
    kind: "remember_candidate",
    operation: input.boundedJob.operation,
    payload: {
      estimatedTokens: estimateTextTokens(redactedPreview),
      fullAssistantOutputPersisted: false,
      rawTranscriptPersisted: false,
      redactedPreview,
    },
    payloadDigest,
    scopeDigest: { ...input.scopeDigest },
    status: "queued",
    trace: {
      linkedEvidenceIds: [],
      linkedMemoryIds: [],
      linkedTraceIds: input.traceId ? [input.traceId] : [],
    },
    updatedAt: input.createdAt,
  };
}

export function createRuntimeWorkerQueue(
  input: CreateRuntimeWorkerQueueInput,
): RuntimeWorkerQueue {
  const now = input.now ?? (() => new Date());
  const processor = input.processor ?? defaultProcessor;

  return {
    async enqueue(job): Promise<RuntimeWorkerEnqueueResult> {
      const snapshot = await readSnapshot({ now, queueFile: input.queueFile });
      const currentTime = timestamp(now);
      const existing = snapshot.jobs.find((candidate) => (
        candidate.dedupeKey === job.dedupeKey
      ));

      if (existing) {
        existing.coalescedCount += 1;
        existing.updatedAt = currentTime;
        appendAudit(snapshot, {
          action: "job_coalesced",
          at: currentTime,
          jobId: existing.jobId,
        });
        await writeSnapshot({ queueFile: input.queueFile, snapshot });
        return {
          coalesced: true,
          job: cloneJob(existing),
        };
      }

      const nextJob = cloneJob({
        ...job,
        updatedAt: currentTime,
      });
      snapshot.jobs.push(nextJob);
      appendAudit(snapshot, {
        action: "job_enqueued",
        at: currentTime,
        jobId: nextJob.jobId,
      });
      await writeSnapshot({ queueFile: input.queueFile, snapshot });

      return {
        coalesced: false,
        job: cloneJob(nextJob),
      };
    },

    async drainOnce(inputOptions): Promise<RuntimeWorkerDrainOnceResult> {
      const snapshot = await readSnapshot({ now, queueFile: input.queueFile });
      const maxJobs = normalizeMaxJobs(inputOptions);
      const drained: RuntimeWorkerJobEnvelope[] = [];

      for (const job of snapshot.jobs) {
        if (drained.length >= maxJobs) {
          break;
        }
        if (job.status !== "queued") {
          continue;
        }

        const startedAt = timestamp(now);
        job.status = "running";
        job.attempts += 1;
        job.updatedAt = startedAt;
        job.lastError = undefined;
        appendAudit(snapshot, {
          action: "job_started",
          at: startedAt,
          jobId: job.jobId,
        });
        await writeSnapshot({ queueFile: input.queueFile, snapshot });

        try {
          await processor(cloneJob(job));
          const succeededAt = timestamp(now);
          job.status = "succeeded";
          job.updatedAt = succeededAt;
          appendAudit(snapshot, {
            action: "job_succeeded",
            at: succeededAt,
            jobId: job.jobId,
          });
        } catch (error) {
          const failedAt = timestamp(now);
          job.status = "failed";
          job.updatedAt = failedAt;
          job.lastError = createWorkerError(error);
          appendAudit(snapshot, {
            action: "job_failed",
            at: failedAt,
            jobId: job.jobId,
            reason: job.lastError.message,
          });
        }

        drained.push(cloneJob(job));
      }

      await writeSnapshot({ queueFile: input.queueFile, snapshot });
      return {
        jobs: drained,
        processed: drained.length,
        queueFile: input.queueFile,
      };
    },

    async recover(options): Promise<RuntimeWorkerRecoverResult> {
      const snapshot = await readSnapshot({ now, queueFile: input.queueFile });
      const stuckJobs = getStuckJobs({
        jobs: snapshot.jobs,
        now: now(),
        stuckAfterMs: options.stuckAfterMs,
      });
      const stuckJobIds = new Set(stuckJobs.map((job) => job.jobId));
      const repairs: RuntimeWorkerRepair[] = snapshot.jobs
        .filter((job) => job.status === "failed" || stuckJobIds.has(job.jobId))
        .map((job) => ({
          action: "requeue",
          fromStatus: job.status === "failed" ? "failed" : "running",
          jobId: job.jobId,
          reason: job.status === "failed" ? "failed" : "stuck",
        }));

      if (!options.dryRun && repairs.length > 0) {
        const currentTime = timestamp(now);
        const repairIds = new Set(repairs.map((repair) => repair.jobId));
        for (const job of snapshot.jobs) {
          if (!repairIds.has(job.jobId)) {
            continue;
          }
          job.status = "queued";
          job.updatedAt = currentTime;
          job.lastError = undefined;
          appendAudit(snapshot, {
            action: "job_requeued",
            at: currentTime,
            jobId: job.jobId,
          });
        }
        await writeSnapshot({ queueFile: input.queueFile, snapshot });
      }

      return {
        dryRun: options.dryRun,
        mutationApplied: !options.dryRun && repairs.length > 0,
        queueFile: input.queueFile,
        repairs,
      };
    },

    async start(): Promise<RuntimeWorkerDaemonResult> {
      const snapshot = await readSnapshot({ now, queueFile: input.queueFile });
      const currentTime = timestamp(now);
      snapshot.daemon = {
        enabled: true,
        updatedAt: currentTime,
      };
      appendAudit(snapshot, {
        action: "daemon_started",
        at: currentTime,
      });
      await writeSnapshot({ queueFile: input.queueFile, snapshot });
      return {
        daemon: { ...snapshot.daemon },
        queueFile: input.queueFile,
      };
    },

    async status(options: RuntimeWorkerStatusInput = {}): Promise<RuntimeWorkerStatusResult> {
      const snapshot = await readSnapshot({ now, queueFile: input.queueFile });
      const jobs = snapshot.jobs.map(cloneJob);
      const stuckJobs = getStuckJobs({
        jobs,
        now: now(),
        stuckAfterMs: options.stuckAfterMs,
      });

      return {
        audits: snapshot.audits.map((audit) => ({ ...audit })),
        counts: countJobs({ jobs, stuckJobs }),
        daemon: { ...snapshot.daemon },
        jobs,
        jobsJson: JSON.stringify(jobs),
        queueFile: input.queueFile,
        stuckJobs,
      };
    },

    async stop(): Promise<RuntimeWorkerDaemonResult> {
      const snapshot = await readSnapshot({ now, queueFile: input.queueFile });
      const currentTime = timestamp(now);
      snapshot.daemon = {
        enabled: false,
        updatedAt: currentTime,
      };
      appendAudit(snapshot, {
        action: "daemon_stopped",
        at: currentTime,
      });
      await writeSnapshot({ queueFile: input.queueFile, snapshot });
      return {
        daemon: { ...snapshot.daemon },
        queueFile: input.queueFile,
      };
    },
  };
}
