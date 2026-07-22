import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";
import type { GoodMemoryScopeDigest } from "../../src";
import {
  createRuntimeWorkerJobEnvelope,
  createRuntimeWorkerQueue,
} from "../../src/runtime-worker/public";

const scopeDigest: GoodMemoryScopeDigest = {
  userIdHash: "hmac-sha256:user",
  workspaceIdHash: "hmac-sha256:workspace",
  sessionIdHash: "hmac-sha256:session",
};

async function withTempQueue<T>(callback: (queueFile: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "goodmemory-runtime-worker-"));
  try {
    return await callback(join(root, "queue.json"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function createEnvelope(overrides: {
  jobId?: string;
  payloadPreview?: string;
} = {}) {
  return createRuntimeWorkerJobEnvelope({
    boundedJob: {
      jobId: overrides.jobId ?? "runtime-kit-candidate-1",
      operation: "remember",
      payloadPreview:
        overrides.payloadPreview ??
        "user: me@example.com | assistant: use token sk-phase435secret",
      rawTranscriptPersisted: false,
      reason: "after_model_call",
      status: "candidate",
    },
    createdAt: "2026-04-26T13:30:00.000Z",
    hostKind: "codex",
    scopeDigest,
    traceId: "trace-1",
  });
}

describe("runtime worker", () => {
  it("creates bounded redacted job envelopes without raw transcript payloads", () => {
    const envelope = createEnvelope();
    const serialized = JSON.stringify(envelope);

    expect(envelope.scopeDigest).toEqual(scopeDigest);
    expect(envelope.payload.rawTranscriptPersisted).toBe(false);
    expect(envelope.payload.fullAssistantOutputPersisted).toBe(false);
    expect(envelope.payload.redactedPreview).toContain("[redacted-email]");
    expect(envelope.payload.redactedPreview).toContain("[redacted-secret]");
    expect(serialized).not.toContain("me@example.com");
    expect(serialized).not.toContain("sk-phase435secret");
    expect(serialized).not.toContain("runtime-worker-user");
  });

  it("redacts localized credential assignments before queue persistence", () => {
    for (const payloadPreview of [
      "user: 密碼：worker-credential",
      "user: パスワード: worker-credential",
      "user: 비밀번호: worker-credential",
      "user: mot de passe : worker-credential",
      "user: contraseña: worker-credential",
    ]) {
      const envelope = createEnvelope({ payloadPreview });
      const serialized = JSON.stringify(envelope);

      expect(envelope.payload.redactedPreview).toContain("[redacted-secret]");
      expect(serialized).not.toContain("worker-credential");
    }
  });

  it("coalesces equivalent jobs and drains queued work once", async () => {
    await withTempQueue(async (queueFile) => {
      const queue = createRuntimeWorkerQueue({
        queueFile,
        now: () => new Date("2026-04-26T13:30:00.000Z"),
      });
      const envelope = createEnvelope();

      const first = await queue.enqueue(envelope);
      const duplicate = await queue.enqueue({
        ...envelope,
        jobId: "runtime-kit-candidate-duplicate",
      });
      const status = await queue.status();
      const drained = await queue.drainOnce();
      const secondDrain = await queue.drainOnce();

      expect(first.coalesced).toBe(false);
      expect(duplicate.coalesced).toBe(true);
      expect(duplicate.job.jobId).toBe(first.job.jobId);
      expect(status.counts).toMatchObject({
        queued: 1,
        coalesced: 1,
      });
      expect(drained.processed).toBe(1);
      expect(drained.jobs[0]?.status).toBe("succeeded");
      expect(secondDrain.processed).toBe(0);

      const persisted = await readFile(queueFile, "utf8");
      expect(persisted).not.toContain("me@example.com");
      expect(persisted).not.toContain("sk-phase435secret");
    });
  });

  it("keeps worker failures auditable and recoverable without throwing", async () => {
    await withTempQueue(async (queueFile) => {
      const queue = createRuntimeWorkerQueue({
        queueFile,
        now: () => new Date("2026-04-26T13:30:00.000Z"),
        async processor() {
          throw new Error("worker sink unavailable for phase435@example.com token sk-workersecret");
        },
      });
      await queue.enqueue(createEnvelope());

      const drained = await queue.drainOnce();
      const recover = await queue.recover({ dryRun: true });
      const statusAfterDryRun = await queue.status();

      expect(drained.processed).toBe(1);
      expect(drained.jobs[0]?.status).toBe("failed");
      expect(drained.jobs[0]?.lastError?.code).toBe("worker_failed");
      expect(drained.jobs[0]?.lastError?.message).not.toContain("phase435@example.com");
      expect(drained.jobs[0]?.lastError?.message).not.toContain("sk-workersecret");
      expect(recover.mutationApplied).toBe(false);
      expect(recover.repairs[0]).toMatchObject({
        action: "requeue",
        fromStatus: "failed",
      });
      expect(statusAfterDryRun.counts.failed).toBe(1);
      expect(JSON.stringify(statusAfterDryRun.audits)).not.toContain("phase435@example.com");
      expect(JSON.stringify(statusAfterDryRun.audits)).not.toContain("sk-workersecret");
    });
  });

  it("persists running state before processor execution", async () => {
    await withTempQueue(async (queueFile) => {
      const queue = createRuntimeWorkerQueue({
        queueFile,
        now: () => new Date("2026-04-26T13:30:00.000Z"),
        async processor() {
          const persisted = JSON.parse(await readFile(queueFile, "utf8")) as {
            jobs: Array<{ status: string }>;
          };
          expect(persisted.jobs[0]?.status).toBe("running");
        },
      });
      await queue.enqueue(createEnvelope());

      const drained = await queue.drainOnce();

      expect(drained.jobs[0]?.status).toBe("succeeded");
    });
  });

  it("detects stuck running jobs and can requeue them only when explicitly applied", async () => {
    await withTempQueue(async (queueFile) => {
      const stale = createEnvelope({ jobId: "runtime-kit-stuck" });
      await writeFile(
        queueFile,
        `${JSON.stringify({
          version: 1,
          daemon: { enabled: false, updatedAt: stale.updatedAt },
          jobs: [
            {
              ...stale,
              status: "running",
              updatedAt: "2026-04-26T13:00:00.000Z",
            },
          ],
          audits: [],
        }, null, 2)}\n`,
      );
      const queue = createRuntimeWorkerQueue({
        queueFile,
        now: () => new Date("2026-04-26T13:30:00.000Z"),
      });

      const status = await queue.status({ stuckAfterMs: 60_000 });
      const dryRun = await queue.recover({ dryRun: true, stuckAfterMs: 60_000 });
      const applied = await queue.recover({ dryRun: false, stuckAfterMs: 60_000 });
      const finalStatus = await queue.status({ stuckAfterMs: 60_000 });

      expect(status.stuckJobs).toHaveLength(1);
      expect(dryRun.mutationApplied).toBe(false);
      expect(applied.mutationApplied).toBe(true);
      expect(finalStatus.counts.queued).toBe(1);
      expect(finalStatus.stuckJobs).toEqual([]);
    });
  });
});
