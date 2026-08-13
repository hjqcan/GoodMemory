import { createHash } from "node:crypto";
import {
  assertStorageSafeExternalValue,
  isStorageSafeText,
} from "../domain/semanticText";
import { assertRememberTemporalContext } from "../domain/temporal";
import type { GoodMemoryTraceLink } from "../observability/contracts";
import type { GoodMemoryTracer } from "../observability/tracer";
import type {
  EnqueueRememberJobInput,
  GoodMemoryJobsDrainInput,
  GoodMemoryJobsDrainResult,
  GoodMemoryJobsFacade,
  GoodMemoryJobsLookupInput,
  MemoryWriteJob,
  MemoryWriteJobErrorCode,
  RememberInput,
  RememberResult,
} from "./contracts";

interface RememberJobRecord {
  job: MemoryWriteJob;
  payloadDigest: string;
  rememberInput: RememberInput | null;
}

class GoodMemoryJobError extends Error {
  readonly code: MemoryWriteJobErrorCode;

  constructor(code: MemoryWriteJobErrorCode, message: string) {
    super(message);
    this.name = "GoodMemoryJobError";
    this.code = code;
  }
}

export interface GoodMemoryJobsFacadeConfig {
  now: () => Date;
  remember(input: RememberInput): Promise<RememberResult>;
  tracer: GoodMemoryTracer;
}

function timestamp(now: () => Date): string {
  return now().toISOString();
}

function appendUnique(values: string[], next: string | undefined): string[] {
  if (!next || values.includes(next)) {
    return values;
  }

  return [...values, next];
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

function digestRememberInput(input: EnqueueRememberJobInput): string {
  return `sha256:${createHash("sha256")
    .update(
      stableSerialize({
        annotations: input.annotations,
        extractionStrategy: input.extractionStrategy,
        locale: input.locale,
        messages: input.messages,
        operation: "remember",
        scope: input.scope,
        timezone: input.timezone,
      }),
    )
    .digest("hex")}`;
}

function digestRememberScope(input: EnqueueRememberJobInput): string {
  return createHash("sha256")
    .update(stableSerialize(input.scope))
    .digest("hex");
}

function cloneRememberInput(input: EnqueueRememberJobInput): RememberInput {
  return {
    scope: { ...input.scope },
    messages: input.messages.map((message) => ({
      ...message,
      content: isStorageSafeText(message.content) ? message.content : "",
    })),
    ...(input.annotations
      ? {
          annotations: input.annotations.map((annotation) => ({
            ...annotation,
            ...(annotation.metadataPatch
              ? {
                  metadataPatch: {
                    ...annotation.metadataPatch,
                    ...(annotation.metadataPatch.attributes
                      ? { attributes: { ...annotation.metadataPatch.attributes } }
                      : {}),
                    ...(annotation.metadataPatch.tags
                      ? { tags: [...annotation.metadataPatch.tags] }
                      : {}),
                  },
                }
              : {}),
          })),
        }
      : {}),
    ...(input.extractionStrategy ? { extractionStrategy: input.extractionStrategy } : {}),
    ...(input.locale ? { locale: input.locale } : {}),
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
  };
}

function assertStorageSafeRememberJobInput(input: EnqueueRememberJobInput): void {
  assertStorageSafeExternalValue({
    ...input,
    messages: input.messages.map(({ content: _content, ...message }) => message),
  }, "input");
}

function cloneJob(job: MemoryWriteJob): MemoryWriteJob {
  return {
    ...job,
    ...(job.lastError ? { lastError: { ...job.lastError } } : {}),
    linkedEvidenceIds: [...job.linkedEvidenceIds],
    linkedMemoryIds: [...job.linkedMemoryIds],
    linkedTraceIds: [...job.linkedTraceIds],
  };
}

function createQueuedRememberJob(input: {
  idempotencyKey: string;
  now: string;
}): MemoryWriteJob {
  return {
    jobId: `job_${crypto.randomUUID()}`,
    idempotencyKey: input.idempotencyKey,
    operation: "remember",
    status: "queued",
    attempts: 0,
    createdAt: input.now,
    updatedAt: input.now,
    linkedTraceIds: [],
    linkedMemoryIds: [],
    linkedEvidenceIds: [],
  };
}

function extractRememberLinks(result: RememberResult): {
  evidenceIds: string[];
  links: GoodMemoryTraceLink[];
  memoryIds: string[];
} {
  const evidenceIds: string[] = [];
  const links: GoodMemoryTraceLink[] = [];
  const memoryIds: string[] = [];

  for (const event of result.events) {
    if (
      event.memoryId &&
      event.memoryType !== "profile" &&
      !memoryIds.includes(event.memoryId)
    ) {
      memoryIds.push(event.memoryId);
      links.push({ type: "memory", id: event.memoryId });
    }
    for (const evidenceId of event.evidenceIds ?? []) {
      if (!evidenceIds.includes(evidenceId)) {
        evidenceIds.push(evidenceId);
        links.push({ type: "evidence", id: evidenceId });
      }
    }
  }

  return { evidenceIds, links, memoryIds };
}

function isRememberBlocked(result: RememberResult): boolean {
  if (result.accepted > 0 || result.events.length === 0) {
    return false;
  }

  return result.events.every((event) => {
    if (event.outcome !== "rejected") {
      return false;
    }

    return (
      event.reason === "assistant_policy_blocked" ||
      event.reason === "policy_blocked" ||
      event.reason === "policy_rejected" ||
      event.reason?.startsWith("policy_") === true
    );
  });
}

function normalizeMaxJobs(input: GoodMemoryJobsDrainInput | undefined): number {
  if (input?.maxJobs === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Math.floor(input.maxJobs));
}

export function createGoodMemoryJobsFacade(
  config: GoodMemoryJobsFacadeConfig,
): GoodMemoryJobsFacade {
  const records = new Map<string, RememberJobRecord>();
  const idempotencyIndex = new Map<string, string>();

  async function processRememberJob(record: RememberJobRecord): Promise<MemoryWriteJob> {
    const currentTime = timestamp(config.now);
    record.job = {
      ...record.job,
      status: "running",
      attempts: record.job.attempts + 1,
      updatedAt: currentTime,
    };
    const trace = await config.tracer.start({
      name: "writeback.job.commit",
      scope: record.rememberInput?.scope,
      attributes: {
        attempt: record.job.attempts,
        operation: "remember",
      },
    });
    record.job = {
      ...record.job,
      linkedTraceIds: appendUnique(record.job.linkedTraceIds, trace.traceId),
    };

    try {
      if (!record.rememberInput) {
        record.job = {
          ...record.job,
          status: "failed",
          updatedAt: timestamp(config.now),
          lastError: {
            code: "job_payload_unavailable",
            message: "Memory job payload is no longer available.",
          },
        };
        await trace.failed({
          error: new Error("job_payload_unavailable"),
          links: [{ type: "job", id: record.job.jobId }],
        });
        return cloneJob(record.job);
      }

      const result = await config.remember(record.rememberInput);
      const linked = extractRememberLinks(result);
      const extractionFailed = result.outcome === "failed";
      const blocked = !extractionFailed && isRememberBlocked(result);
      record.job = {
        ...record.job,
        status: extractionFailed ? "failed" : blocked ? "blocked" : "succeeded",
        updatedAt: timestamp(config.now),
        linkedEvidenceIds: linked.evidenceIds,
        linkedMemoryIds: linked.memoryIds,
        linkedTraceIds: appendUnique(
          record.job.linkedTraceIds,
          result.metadata?.traceId,
        ),
        lastError: extractionFailed
          ? {
              code: "remember_failed",
              message: "Assisted memory extraction failed and must be retried.",
            }
          : blocked
            ? {
              code: "write_blocked",
              message: "Remember job was blocked before writing memory.",
            }
            : undefined,
      };
      if (!extractionFailed) {
        record.rememberInput = null;
      }

      const completion = {
        attributes: {
          accepted: result.accepted,
          rejected: result.rejected,
        },
        links: [{ type: "job" as const, id: record.job.jobId }, ...linked.links],
      };
      if (record.job.status === "failed") {
        await trace.failed({
          ...completion,
          error: new Error("assisted_extraction_failed"),
        });
      } else if (record.job.status === "blocked") {
        await trace.blocked(completion);
      } else {
        await trace.succeeded(completion);
      }

      return cloneJob(record.job);
    } catch (error) {
      record.job = {
        ...record.job,
        status: "failed",
        updatedAt: timestamp(config.now),
        lastError: {
          code: "remember_failed",
          message: "Remember job failed.",
        },
      };
      await trace.failed({
        attributes: {
          status: "failed",
        },
        error,
        links: [{ type: "job", id: record.job.jobId }],
      });

      return cloneJob(record.job);
    }
  }

  return {
    async enqueueRemember(input: EnqueueRememberJobInput): Promise<MemoryWriteJob> {
      assertStorageSafeRememberJobInput(input);
      assertRememberTemporalContext(input);
      const trace = await config.tracer.start({
        name: "writeback.job.enqueue",
        scope: input.scope,
        attributes: {
          hasReason: Boolean(input.reason),
          operation: "remember",
        },
      });
      const idempotencyKey = [
        "remember",
        digestRememberScope(input),
        input.idempotencyKey,
      ].join(":");
      const payloadDigest = digestRememberInput(input);
      const existingJobId = idempotencyIndex.get(idempotencyKey);

      if (existingJobId) {
        const existing = records.get(existingJobId);
        if (existing?.payloadDigest !== payloadDigest) {
          await trace.blocked({
            attributes: {
              reason: "idempotency_conflict",
            },
          });
          throw new GoodMemoryJobError(
            "idempotency_conflict",
            "GoodMemory job idempotency key already exists for a different payload.",
          );
        }

        if (existing) {
          existing.job = {
            ...existing.job,
            updatedAt: timestamp(config.now),
            linkedTraceIds: appendUnique(existing.job.linkedTraceIds, trace.traceId),
          };
          await trace.succeeded({
            attributes: {
              duplicate: true,
              status: existing.job.status,
            },
            links: [{ type: "job", id: existing.job.jobId }],
          });
          return cloneJob(existing.job);
        }
      }

      const now = timestamp(config.now);
      const job = createQueuedRememberJob({
        idempotencyKey: input.idempotencyKey,
        now,
      });
      const record: RememberJobRecord = {
        job: {
          ...job,
          linkedTraceIds: appendUnique(job.linkedTraceIds, trace.traceId),
        },
        payloadDigest,
        rememberInput: cloneRememberInput(input),
      };
      records.set(job.jobId, record);
      idempotencyIndex.set(idempotencyKey, job.jobId);
      await trace.succeeded({
        attributes: {
          duplicate: false,
          status: "queued",
        },
        links: [{ type: "job", id: job.jobId }],
      });

      return cloneJob(record.job);
    },

    async getJob(input: GoodMemoryJobsLookupInput): Promise<MemoryWriteJob | null> {
      const record = records.get(input.jobId);
      return record ? cloneJob(record.job) : null;
    },

    async retryJob(input: GoodMemoryJobsLookupInput): Promise<MemoryWriteJob | null> {
      const record = records.get(input.jobId);
      if (!record) {
        return null;
      }

      if (record.job.status === "failed" && record.rememberInput) {
        record.job = {
          ...record.job,
          status: "queued",
          updatedAt: timestamp(config.now),
          lastError: undefined,
        };
      }

      return cloneJob(record.job);
    },

    async drain(input?: GoodMemoryJobsDrainInput): Promise<GoodMemoryJobsDrainResult> {
      const maxJobs = normalizeMaxJobs(input);
      const drained: MemoryWriteJob[] = [];

      for (const record of records.values()) {
        if (drained.length >= maxJobs) {
          break;
        }
        if (record.job.status !== "queued") {
          continue;
        }

        drained.push(await processRememberJob(record));
      }

      return {
        processed: drained.length,
        jobs: drained,
      };
    },
  };
}
